#!/usr/bin/env node
// The template renderer behind /harness-kit:harness-init. It turns the owner's answers into
// rendered files, following the contract in templates/vocabulary.json (docs/templates.md in
// the kit repo), and never writes a file the contract would reject.
//
//   node render.mjs plan  --answers <file> [--repo <dir>]   what apply would do, as JSON
//   node render.mjs show  --answers <file> --target <path>  one rendered file, for previews
//   node render.mjs apply --answers <file> [--repo <dir>]   write the files
//
// The answers file is JSON: { "modules": [...ids], "values": { TOKEN: value }, "flags":
// { "has.db": true, ... }, "date": "YYYY-MM-DD" }. Derived tokens and flags are computed here
// (see resolveAnswers), so the answers hold only what detect found and the owner confirmed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commentStyle,
  evalFlag,
  parseConditionals,
  rejectedCommand,
  TOKEN_RE,
  valueError,
} from "./contract.mjs";

export const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SETTINGS_TARGET = ".claude/settings.json";
/** Suffix of the kit's version of a file the target already has (merge and kit-new). */
export const KIT_NEW = ".kit-new";
/** The install record (written by manifest.mjs); add mode reads it to know what is installed. */
export const MANIFEST_TARGET = ".agents/harness.json";

// Tokens and flags the renderer computes; answers may not set them.
export const DERIVED_TOKENS =["KIT_VERSION", "DATE", "DATE_YM", "CMD_CHECKS", "CMD_HOOK_TESTS", "VERIFY_COMMANDS_JSON"];
const CHECKS = [
  ["CMD_TYPECHECK", "has.typecheck"],
  ["CMD_LINT", "has.lint"],
  ["CMD_TEST", "has.test"],
];
export const DERIVED_FLAGS = ["has.typecheck", "has.lint", "has.test", "has.checks"];
const GIT_ALLOW_RULES = ["Bash(git status)", "Bash(git diff *)", "Bash(git log *)"];

export const sha256 = (text) => `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;

/** The kit's data files and version. */
export function loadKit(root = KIT_ROOT) {
  const templatesDir = path.join(root, "templates");
  const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  return {
    root,
    templatesDir,
    vocabulary: readJson(path.join(templatesDir, "vocabulary.json")),
    registry: readJson(path.join(templatesDir, "modules.json")),
    version: readJson(path.join(root, ".claude-plugin", "plugin.json")).version,
    read: (template) => fs.readFileSync(path.join(templatesDir, template), "utf8"),
  };
}

/**
 * Render one template's text: drop kit:if marker lines, drop the content of blocks whose
 * flag is false, then fill tokens. NAME_JSON is the JSON literal of NAME's value; an array
 * value is always inserted as JSON. kit:adapt markers are left for the installer skill.
 * Throws on a malformed conditional, an unknown flag, or an unfilled token.
 */
export function renderText(text, { style, values, flags }) {
  const { blocks, errors } = parseConditionals(text, style);
  if (errors.length) throw new Error(errors.join("; "));
  const drop = new Set();
  for (const b of blocks) {
    drop.add(b.start);
    drop.add(b.end);
    if (!evalFlag(b.flag, flags)) for (let n = b.start + 1; n < b.end; n++) drop.add(n);
  }
  const kept = text.split("\n").filter((_, i) => !drop.has(i + 1)).join("\n");
  const missing = new Set();
  const out = kept.replace(TOKEN_RE, (whole, name) => {
    if (Object.hasOwn(values, name)) {
      const v = values[name];
      return Array.isArray(v) ? JSON.stringify(v) : String(v);
    }
    const base = name.endsWith("_JSON") ? name.slice(0, -"_JSON".length) : null;
    if (base && Object.hasOwn(values, base)) return JSON.stringify(values[base]);
    missing.add(name);
    return whole;
  });
  if (missing.size) throw new Error(`unfilled token: ${[...missing].join(", ")}`);
  return out;
}

/** ENV_PREFIX suggestion from a project name: "Example App" -> "EXAMPLE_APP". */
export function envPrefixFrom(projectName) {
  const s = String(projectName)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!s) return "PROJECT";
  return /^[A-Z]/.test(s) ? s : `P_${s}`;
}

const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The modules to render, in registry order, with each file's `when` applied. */
const selectedModules = (kit, ids) => kit.registry.modules.filter((m) => ids.includes(m.id));

/**
 * The command that runs the installed harness's own tests: one quoted glob per folder that
 * gets a .test.mjs, with skill folders collapsed to .agents/skills/<star>/.
 */
export function hookTestsCommand(modules, flags) {
  const globs = [];
  for (const m of modules) {
    for (const f of m.files) {
      if (!f.target.endsWith(".test.mjs") || (f.when && !evalFlag(f.when, flags))) continue;
      const dir = path.posix.dirname(f.target).replace(/^\.agents\/skills\/[^/]+\//, ".agents/skills/*/");
      const glob = `${dir}/*.test.mjs`;
      if (!globs.includes(glob)) globs.push(glob);
    }
  }
  return ["node --test", ...globs.map((g) => `"${g}"`)].join(" ");
}

/**
 * Turn the owner's answers into the full set of values and flags a render needs, or errors.
 * Answers set detect and owner tokens and flags; this adds defaults (persona names,
 * ENV_PREFIX, the allow list), the derived tokens and flags, and the module.* flags, then
 * checks every value against the vocabulary, including rejectCommandPatterns.
 */
export function resolveAnswers(kit, answers) {
  const { vocabulary, registry } = kit;
  const errors = [];
  const input = answers ?? {};
  for (const k of Object.keys(input)) {
    if (!["modules", "values", "flags", "date", "add"].includes(k)) errors.push(`answers: unknown key "${k}"`);
  }

  // Modules: known, core included, requires and when satisfied. Order follows the registry.
  const ids = Array.isArray(input.modules) ? input.modules : [];
  if (!Array.isArray(input.modules)) errors.push("answers.modules must be an array of module ids");
  const byId = new Map(registry.modules.map((m) => [m.id, m]));
  for (const id of ids) if (!byId.has(id)) errors.push(`unknown module "${id}"`);
  if (!ids.includes("core")) errors.push('the "core" module is required');
  if (ids.includes("core") && !ids.includes("claude") && !ids.includes("antigravity")) {
    errors.push('at least one provider adapter ("claude" or "antigravity") is required');
  }
  for (const id of ids) {
    for (const r of byId.get(id)?.requires ?? []) {
      if (!ids.includes(r)) errors.push(`module "${id}" requires "${r}"`);
    }
  }
  const modules = selectedModules(kit, ids);

  // Add mode: modules joining an existing install. They must be selected, and not core.
  let add = null;
  if (input.add !== undefined) {
    if (!Array.isArray(input.add) || input.add.length === 0) errors.push("answers.add must be a non-empty array of module ids");
    else {
      add = [...input.add];
      for (const id of add) {
        if (!ids.includes(id)) errors.push(`added module "${id}" must also be in answers.modules`);
        if (id === "core") errors.push('"core" is part of every install; it can\'t be added');
      }
    }
  }

  // Flags: every vocabulary flag, false unless answered; derived flags are computed below.
  const flags = Object.fromEntries(Object.keys(vocabulary.flags).map((f) => [f, false]));
  for (const [name, v] of Object.entries(input.flags ?? {})) {
    if (!(name in vocabulary.flags)) errors.push(`unknown flag "${name}"`);
    else if (name.startsWith("module.") || DERIVED_FLAGS.includes(name)) {
      errors.push(`flag "${name}" is derived; set it through ${name.startsWith("module.") ? "answers.modules" : "the matching CMD_* value"}`);
    } else if (typeof v !== "boolean") errors.push(`flag "${name}" must be true or false`);
    else flags[name] = v;
  }
  for (const m of registry.modules) if (m.flag) flags[m.flag] = ids.includes(m.id);
  for (const m of modules) {
    if (m.when && !evalFlag(m.when, flags)) errors.push(`module "${m.id}" needs ${m.when}, which is false`);
  }

  // Values: only vocabulary tokens, never a derived one, never one whose when flag is off.
  const given = { ...(input.values ?? {}) };
  for (const name of Object.keys(given)) {
    if (!(name in vocabulary.tokens)) errors.push(`unknown token "${name}"`);
    else if (DERIVED_TOKENS.includes(name)) errors.push(`token "${name}" is derived; don't set it`);
  }
  for (const [cmd, flag] of CHECKS) flags[flag] = given[cmd] !== undefined;
  flags["has.checks"] = CHECKS.some(([, flag]) => flags[flag]);
  for (const [name, v] of Object.entries(given)) {
    const when = vocabulary.tokens[name]?.when;
    if (when && !flags[when] && v !== undefined) errors.push(`token "${name}" is set but ${when} is false`);
  }

  const values = {};
  for (const [name, entry] of Object.entries(vocabulary.tokens)) {
    if (given[name] !== undefined && !DERIVED_TOKENS.includes(name)) values[name] = given[name];
    else if (entry.default !== undefined) values[name] = entry.default;
  }
  if (values.ENV_PREFIX === undefined && typeof values.PROJECT_NAME === "string") {
    values.ENV_PREFIX = envPrefixFrom(values.PROJECT_NAME);
  }

  const date = input.date ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`answers.date must be YYYY-MM-DD, not ${JSON.stringify(date)}`);
  values.KIT_VERSION = kit.version;
  values.DATE = date;
  values.DATE_YM = String(date).slice(0, 7);
  const checks = CHECKS.map(([cmd]) => given[cmd]).filter((v) => v !== undefined);
  values.VERIFY_COMMANDS_JSON = checks;
  if (flags["has.checks"]) values.CMD_CHECKS = checks.join(" && ");
  values.CMD_HOOK_TESTS = hookTestsCommand(modules, flags);
  if (values.ALLOW_RULES_JSON === undefined) {
    values.ALLOW_RULES_JSON = [...checks.map((c) => `Bash(${c})`), ...GIT_ALLOW_RULES];
  }

  for (const [name, v] of Object.entries(values)) {
    const err = valueError(vocabulary.tokens[name], vocabulary, v);
    if (err) errors.push(`${name}: ${err}`);
  }
  const out = { modules: modules.map((m) => m.id), values, flags, errors };
  if (add) out.add = add;
  return out;
}

/**
 * Every file the selected modules render, with its content, before looking at the target
 * repo. Files whose `when` flag is false come back with `omitted: true` and no content.
 * Throws one error listing every file that fails to render (for example an unfilled token).
 */
export function renderAll(kit, resolved) {
  const { values, flags } = resolved;
  const files = [];
  const settings = [];
  const errors = [];
  for (const m of selectedModules(kit, resolved.modules)) {
    for (const f of m.files) {
      const entry = { module: m.id, template: f.template, onExisting: f.onExisting, adapt: f.adapt === true };
      if (f.mode) entry.mode = f.mode;
      try {
        entry.target = renderText(f.target, { style: "none", values, flags });
        if (f.when && !evalFlag(f.when, flags)) entry.omitted = true;
        else entry.content = renderText(kit.read(f.template), { style: commentStyle(f.target), values, flags });
      } catch (e) {
        errors.push(`${f.template}: ${e.message}`);
      }
      files.push(entry);
    }
    for (const t of m.settings) {
      try {
        const fragment = JSON.parse(renderText(kit.read(t), { style: "none", values, flags }));
        settings.push({ module: m.id, template: t, fragment });
      } catch (e) {
        errors.push(`${t}: ${e.message}`);
      }
    }
  }
  if (errors.length) throw new Error(`render failed:\n${errors.map((e) => `  ${e}`).join("\n")}`);
  return { files, settings };
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Merge a settings fragment into existing settings without losing anything the project set:
 * objects merge key by key, arrays keep their items and gain the fragment's missing ones,
 * and where a scalar differs the project's value stays and the clash is reported.
 */
export function mergeSettings(existing, fragment, at = "") {
  const conflicts = [];
  const merge = (a, b, where) => {
    if (isObject(a) && isObject(b)) {
      const out = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = k in a ? merge(a[k], v, `${where}.${k}`) : v;
      return out;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      const seen = new Set(a.map((x) => JSON.stringify(x)));
      return [...a, ...b.filter((x) => !seen.has(JSON.stringify(x)))];
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) conflicts.push({ path: where.slice(1), kept: a, kit: b });
    return a;
  };
  return { merged: merge(existing, fragment, at), conflicts };
}

/** Existing allow rules that look production-reaching: shown to the owner, never removed silently. */
export function riskyAllowRules(kit, settings) {
  const allow = settings?.permissions?.allow;
  if (!Array.isArray(allow)) return [];
  return allow
    .filter((r) => typeof r === "string" && /^Bash\(/.test(r))
    .filter((r) => rejectedCommand(kit.vocabulary, r)?.list === "production");
}

/** Resolve a repo-relative target, refusing anything that would land outside the repo. */
export function resolveTarget(repoRoot, target) {
  const abs = path.resolve(repoRoot, target);
  const rel = path.relative(repoRoot, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`target outside the repo: ${target}`);
  // A symlinked folder or file on the way could send a write elsewhere.
  let p = repoRoot;
  for (const seg of rel.split(path.sep)) {
    p = path.join(p, seg);
    if (fs.lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`target goes through a symlink: ${path.relative(repoRoot, p)}`);
    }
  }
  return abs;
}

const readIfExists = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

/**
 * What installing the rendered files into repoRoot would do. Each file gets an action:
 *   create     the target doesn't exist; write it
 *   unchanged  the target already has exactly this content
 *   merge      the target exists and the registry says merge: the kit's version goes to
 *              <target>.kit-new and the installer merges the two with the owner
 *   kit-new    the target exists (maybe a foreign harness): the kit's version goes to
 *              <target>.kit-new and the owner decides; it never replaces the file silently
 *   skip       the target exists and the registry says keep it
 *   omit       the file's `when` flag is false
 * The settings fragments merge into .claude/settings.json (create, unchanged or update).
 */
export function planInstall(kit, resolved, repoRoot) {
  if (resolved.add) return planAdd(kit, resolved, repoRoot);
  const { files, settings } = renderAll(kit, resolved);
  const planned = files.map((f) => (f.omitted ? { ...f, action: "omit" } : fileAction(f, repoRoot)));
  return {
    modules: resolved.modules,
    files: planned,
    settings: planSettings(kit, settings, repoRoot),
    postInstall: postInstallFor(kit, resolved.modules),
  };
}

/** A rendered file's install action against what the repo holds now (see planInstall). */
function fileAction(f, repoRoot) {
  const current = readIfExists(resolveTarget(repoRoot, f.target));
  let action = "create";
  if (current === f.content) action = "unchanged";
  else if (current !== null) action = f.onExisting === "skip" ? "skip" : f.onExisting;
  return { ...f, action, sha256: sha256(f.content) };
}

const postInstallFor = (kit, ids) =>
  selectedModules(kit, ids).flatMap((m) => m.postInstall.map((command) => ({ module: m.id, command })));

/** How the settings fragments merge into .claude/settings.json, or null with no fragments. */
function planSettings(kit, settings, repoRoot) {
  if (!settings.length) return null;
  const abs = resolveTarget(repoRoot, SETTINGS_TARGET);
  const raw = readIfExists(abs);
  let existing = {};
  if (raw !== null) {
    try {
      existing = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${SETTINGS_TARGET} is not valid JSON (${e.message}); fix it before installing`);
    }
    if (!isObject(existing)) throw new Error(`${SETTINGS_TARGET} must hold a JSON object`);
  }
  let merged = existing;
  const conflicts = [];
  for (const s of settings) {
    const r = mergeSettings(merged, s.fragment);
    merged = r.merged;
    conflicts.push(...r.conflicts);
  }
  const content = `${JSON.stringify(merged, null, 2)}\n`;
  const same = raw !== null && JSON.stringify(JSON.parse(raw)) === JSON.stringify(merged);
  return {
    target: SETTINGS_TARGET,
    fragments: settings.map((s) => s.template),
    action: raw === null ? "create" : same ? "unchanged" : "update",
    conflicts,
    riskyExistingAllow: riskyAllowRules(kit, existing),
    content,
  };
}

/** The repo's install record, or null when the kit was never installed there. */
export function readManifest(repoRoot) {
  const raw = readIfExists(resolveTarget(repoRoot, MANIFEST_TARGET));
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${MANIFEST_TARGET} is not valid JSON (${e.message})`);
  }
}

/**
 * Answers that reproduce an existing install: its modules, values and flags without the
 * derived ones, and its install date. The starting point for an add-mode answers file.
 */
export function answersFromManifest(manifest) {
  const values = Object.fromEntries(Object.entries(manifest.values ?? {}).filter(([k]) => !DERIVED_TOKENS.includes(k)));
  const flags = Object.fromEntries(
    Object.entries(manifest.flags ?? {}).filter(([k]) => !k.startsWith("module.") && !DERIVED_FLAGS.includes(k)),
  );
  return { modules: [...(manifest.modules ?? [])], date: manifest.installedAt, flags, values };
}

/**
 * Add mode: modules joining an existing install (answers.add). The answers are the install's
 * own (see answersFromManifest) plus the new modules and any values or flags the owner
 * confirmed. Only the added modules' files are installed, with the usual actions. Files of
 * installed modules are compared between a render of the install's recorded answers and a
 * render of the new ones, both with this kit:
 *   create, merge, ...  a file that applies only now (its when flag turned true): as usual
 *   delta               an installed file whose render changes (a module or flag it
 *                       mentions, or a derived value such as CMD_HOOK_TESTS): the plan
 *                       carries a line diff the installer applies by hand, because the
 *                       installed file was adapted and is never re-rendered
 *   retired             a file that no longer applies: reported, never deleted
 * Files whose render doesn't change are left out. Settings merge only the added fragments.
 */
export function planAdd(kit, resolved, repoRoot) {
  const manifest = readManifest(repoRoot);
  if (!manifest) throw new Error(`add mode needs an existing install, and ${MANIFEST_TARGET} is missing`);
  const installed = manifest.modules ?? [];
  const already = resolved.add.filter((id) => installed.includes(id));
  if (already.length) throw new Error(`already installed: ${already.join(", ")}`);
  const expected = [...installed, ...resolved.add].sort();
  if (JSON.stringify([...resolved.modules].sort()) !== JSON.stringify(expected)) {
    throw new Error(`answers.modules must be the installed modules (${installed.join(", ")}) plus the added ones`);
  }
  const before = resolveAnswers(kit, answersFromManifest(manifest));
  if (before.errors.length) {
    throw new Error(`the install's recorded answers don't fit this kit:\n${before.errors.map((e) => `  ${e}`).join("\n")}`);
  }
  // The dates stay the install's, so a file that prints {{DATE}} doesn't show up as a delta.
  const comparable = { ...resolved, values: { ...resolved.values, DATE: before.values.DATE, DATE_YM: before.values.DATE_YM } };
  const after = renderAll(kit, resolved);
  const afterOld = new Map(renderAll(kit, comparable).files.map((f) => [f.template, f]));
  const prev = new Map(renderAll(kit, before).files.map((f) => [f.template, f]));

  const files = [];
  for (const f of after.files) {
    if (resolved.add.includes(f.module)) {
      files.push(f.omitted ? { ...f, action: "omit" } : fileAction(f, repoRoot));
      continue;
    }
    const was = prev.get(f.template);
    const now = afterOld.get(f.template);
    if (now.omitted && was.omitted) continue;
    if (!now.omitted && was.omitted) files.push(fileAction(f, repoRoot));
    else if (now.omitted) files.push({ ...f, action: "retired" });
    else if (now.content !== was.content) {
      const exists = fs.existsSync(resolveTarget(repoRoot, f.target));
      const { content: _c, ...rest } = now;
      files.push({ ...rest, action: exists ? "delta" : "missing", diff: lineDiff(was.content, now.content) });
    }
  }
  const added = after.settings.filter((s) => resolved.add.includes(s.module));
  return {
    mode: "add",
    modules: resolved.modules,
    add: resolved.add,
    installedKitVersion: manifest.kit?.version ?? null,
    files,
    settings: planSettings(kit, added, repoRoot),
    postInstall: postInstallFor(kit, resolved.add),
  };
}

/**
 * A unified-style line diff (no file headers), with `context` lines around each change.
 * Small files only: it is a plain LCS table.
 */
export function lineDiff(a, b, context = 2) {
  const x = a.split("\n");
  const y = b.split("\n");
  const lcs = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) ops.push({ t: " ", s: x[i++], at: j++ });
    else if (j < y.length && (i >= x.length || lcs[i][j + 1] > lcs[i + 1][j])) ops.push({ t: "+", s: y[j], at: j++ });
    else ops.push({ t: "-", s: x[i++], at: j });
  }
  const keep = new Set();
  ops.forEach((o, k) => {
    if (o.t === " ") return;
    for (let n = Math.max(0, k - context); n <= Math.min(ops.length - 1, k + context); n++) keep.add(n);
  });
  const out = [];
  let last = -2;
  ops.forEach((o, k) => {
    if (!keep.has(k)) return;
    if (k !== last + 1) out.push(`@@ near line ${o.at + 1} @@`);
    out.push(`${o.t}${o.s}`);
    last = k;
  });
  return out.join("\n");
}

/** The lines a diff adds, ignoring blank ones: what an applied delta must leave in the file. */
export const addedLines = (diff) =>
  diff
    .split("\n")
    .filter((l) => l.startsWith("+") && l.slice(1).trim())
    .map((l) => l.slice(1));

/** Write a plan into repoRoot. Returns the repo-relative paths written. */
export function applyPlan(plan, repoRoot) {
  const written = [];
  const write = (rel, content, mode) => {
    const abs = resolveTarget(repoRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    if (mode) fs.chmodSync(abs, Number.parseInt(mode, 8));
    written.push(rel);
  };
  for (const f of plan.files) {
    if (f.action === "create") write(f.target, f.content, f.mode);
    else if (f.action === "merge" || f.action === "kit-new") write(f.target + KIT_NEW, f.content);
    else if (f.action === "unchanged" && f.mode) fs.chmodSync(resolveTarget(repoRoot, f.target), Number.parseInt(f.mode, 8));
  }
  const s = plan.settings;
  if (s && s.action !== "unchanged") write(s.target, s.content);
  return written;
}

/** The plan without file contents, for printing. */
export function summarize(plan, resolved) {
  return {
    ...(plan.mode ? { mode: plan.mode, add: plan.add, installedKitVersion: plan.installedKitVersion } : {}),
    modules: plan.modules,
    values: resolved.values,
    flags: resolved.flags,
    files: plan.files.map(({ content: _c, ...f }) => f),
    settings: plan.settings && (({ content: _c, ...s }) => s)(plan.settings),
    postInstall: plan.postInstall,
  };
}

/** Parse --name value pairs. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const m = rest[i].match(/^--([a-z-]+)$/);
    if (!m || rest[i + 1] === undefined) throw new Error(`bad argument: ${rest[i]}`);
    opts[m[1]] = rest[++i];
  }
  return { command, opts };
}

/** Load and resolve an answers file; throws with every problem listed. */
export function loadAnswers(kit, file) {
  if (!file) throw new Error("--answers <file> is required");
  const resolved = resolveAnswers(kit, JSON.parse(fs.readFileSync(file, "utf8")));
  if (resolved.errors.length) {
    throw new Error(`the answers don't fit the contract:\n${resolved.errors.map((e) => `  ${e}`).join("\n")}`);
  }
  return resolved;
}

export function main(argv, { kit = loadKit(), out = process.stdout } = {}) {
  const { command, opts } = parseArgs(argv);
  const repo = path.resolve(opts.repo ?? ".");
  const resolved = loadAnswers(kit, opts.answers);
  const plan = planInstall(kit, resolved, repo);
  if (command === "plan") {
    out.write(`${JSON.stringify(summarize(plan, resolved), null, 2)}\n`);
  } else if (command === "show") {
    if (!opts.target) throw new Error("--target <path> is required");
    const hit =
      opts.target === SETTINGS_TARGET
        ? plan.settings
        : plan.files.find((f) => f.target === opts.target && (f.content !== undefined || f.diff !== undefined));
    if (!hit) throw new Error(`no rendered file targets ${opts.target}`);
    out.write(hit.content ?? `${hit.diff}\n`);
  } else if (command === "apply") {
    const written = applyPlan(plan, repo);
    out.write(`${JSON.stringify({ ...summarize(plan, resolved), written }, null, 2)}\n`);
  } else {
    throw new Error(`unknown command "${command}"; use plan, show or apply`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`harness-kit render: ${e.message}\n`);
    process.exitCode = 1;
  }
}
