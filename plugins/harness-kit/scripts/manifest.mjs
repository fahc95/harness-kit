#!/usr/bin/env node
// Writes .agents/harness.json, the record of an install: kit version, modules, the resolved
// values and flags, and two hashes per file. `rendered` is the kit's output before the
// project adapted it; `installed` is the file as committed by the install. A later sync can
// re-render the old version with the same values and tell kit changes from project changes.
//
//   node manifest.mjs check   --answers <file> [--repo <dir>]   what still blocks the manifest
//   node manifest.mjs write   --answers <file> [--repo <dir>]   write .agents/harness.json
//   node manifest.mjs answers [--repo <dir>]                    the install's answers, as JSON,
//                                                               to start an add-mode answers file
//
// With answers.add (modules joining an existing install), check and write cover only what
// the add plan touches, and write updates the existing record instead of replacing it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findAdaptMarkers } from "./contract.mjs";
import {
  addedLines,
  answersFromManifest,
  DERIVED_TOKENS,
  KIT_NEW,
  loadAnswers,
  loadKit,
  MANIFEST_TARGET,
  parseArgs,
  planAdd,
  readManifest,
  renderAll,
  resolveTarget,
  SETTINGS_TARGET,
  sha256,
} from "./render.mjs";

export { MANIFEST_TARGET };
export const MANIFEST_SCHEMA_VERSION = 1;

// Add-plan actions that install a file the manifest then records.
const INSTALLS = ["create", "unchanged", "merge", "kit-new", "skip"];

/**
 * The files an install (or an add) is responsible for: the rendered files it installs, and
 * in add mode the installed files that take a delta.
 */
function scope(kit, resolved, repoRoot) {
  if (!resolved.add) {
    const { files, settings } = renderAll(kit, resolved);
    return { files: files.filter((f) => !f.omitted), deltas: [], settings };
  }
  const plan = planAdd(kit, resolved, repoRoot);
  return {
    plan,
    files: plan.files.filter((f) => INSTALLS.includes(f.action)),
    deltas: plan.files.filter((f) => f.action === "delta" || f.action === "missing"),
    settings: plan.settings ? plan.settings.fragments : [],
  };
}

/**
 * What still has to happen before the install is done: kit:adapt markers left in installed
 * files, <target>.kit-new files not yet merged or decided, and targets that don't exist. In
 * add mode, also deltas not applied yet: an added line of the diff that the file lacks.
 */
export function pendingWork(kit, resolved, repoRoot) {
  const { files, deltas, settings } = scope(kit, resolved, repoRoot);
  const adaptMarkers = [];
  const kitNew = [];
  const missing = [];
  const unappliedDeltas = [];
  for (const f of files) {
    const abs = resolveTarget(repoRoot, f.target);
    if (fs.existsSync(abs + KIT_NEW)) kitNew.push(f.target + KIT_NEW);
    if (!fs.existsSync(abs)) {
      missing.push(f.target);
      continue;
    }
    if (f.target.endsWith(".md")) {
      for (const m of findAdaptMarkers(fs.readFileSync(abs, "utf8")).markers) {
        adaptMarkers.push({ target: f.target, line: m.line, instruction: m.instruction });
      }
    }
  }
  for (const d of deltas) {
    const abs = resolveTarget(repoRoot, d.target);
    if (!fs.existsSync(abs)) {
      missing.push(d.target);
      continue;
    }
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    const lacking = addedLines(d.diff).filter((l) => !lines.includes(l));
    if (lacking.length) unappliedDeltas.push({ target: d.target, lacking });
  }
  if (settings.length && !fs.existsSync(resolveTarget(repoRoot, SETTINGS_TARGET))) missing.push(SETTINGS_TARGET);
  const done = !adaptMarkers.length && !kitNew.length && !missing.length && !unappliedDeltas.length;
  return { adaptMarkers, kitNew, missing, ...(resolved.add ? { unappliedDeltas } : {}), done };
}

const hashOnDisk = (repoRoot, target) => sha256(fs.readFileSync(resolveTarget(repoRoot, target), "utf8"));

const byTarget = (a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0);

function fileEntry(kit, repoRoot, f, extra = {}) {
  return {
    target: f.target,
    module: f.module,
    template: f.template,
    onExisting: f.onExisting,
    ...(f.mode ? { mode: f.mode } : {}),
    rendered: sha256(f.content),
    installed: hashOnDisk(repoRoot, f.target),
    ...extra,
  };
}

/** The manifest object. Throws if the install is not finished (see pendingWork). */
export function buildManifest(kit, resolved, repoRoot) {
  const pending = pendingWork(kit, resolved, repoRoot);
  if (!pending.done) {
    const lines = [
      ...pending.missing.map((t) => `missing: ${t}`),
      ...pending.kitNew.map((t) => `not merged or decided yet: ${t}`),
      ...pending.adaptMarkers.map((m) => `kit:adapt left: ${m.target}:${m.line}`),
      ...(pending.unappliedDeltas ?? []).map((d) => `delta not applied yet: ${d.target}`),
    ];
    throw new Error(`the install is not finished:\n${lines.map((l) => `  ${l}`).join("\n")}`);
  }
  if (resolved.add) return buildAddManifest(kit, resolved, repoRoot);
  const { files, settings } = renderAll(kit, resolved);
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kit: { name: "harness-kit", version: kit.version },
    installedAt: resolved.values.DATE,
    modules: resolved.modules,
    values: resolved.values,
    flags: resolved.flags,
    files: files
      .filter((f) => !f.omitted)
      .map((f) => fileEntry(kit, repoRoot, f))
      .sort(byTarget),
    settings: settings.length
      ? { target: SETTINGS_TARGET, fragments: settings.map((s) => s.template), installed: hashOnDisk(repoRoot, SETTINGS_TARGET) }
      : null,
  };
}

/**
 * The existing record updated for an add. Entries of installed files keep their `rendered`
 * hash (the kit output they were installed from); a file that took a delta gets a new
 * `installed` hash, so a later sync treats the delta as the project's change and keeps it.
 * New entries carry `kitVersion` when this kit differs from the one that installed the rest.
 * Recorded values keep the install's derived ones and gain the new answers; flags are the
 * new ones. `history` lists the install and every add.
 */
function buildAddManifest(kit, resolved, repoRoot) {
  const { plan, files, deltas, settings } = scope(kit, resolved, repoRoot);
  const old = readManifest(repoRoot);
  const installedVersion = old.kit?.version ?? null;
  const extra = installedVersion === kit.version ? {} : { kitVersion: kit.version };
  const rendered = new Map(renderAll(kit, resolved).files.map((f) => [f.template, f]));
  const entries = new Map((old.files ?? []).map((e) => [e.target, { ...e }]));
  for (const f of files) entries.set(f.target, fileEntry(kit, repoRoot, rendered.get(f.template), extra));
  for (const d of deltas) {
    const e = entries.get(d.target);
    if (e) e.installed = hashOnDisk(repoRoot, d.target);
  }
  const newValues = Object.fromEntries(Object.entries(resolved.values).filter(([k]) => !DERIVED_TOKENS.includes(k)));
  let settingsRecord = old.settings ?? null;
  if (settings.length) {
    settingsRecord = {
      target: SETTINGS_TARGET,
      fragments: [...new Set([...(old.settings?.fragments ?? []), ...settings])],
      installed: hashOnDisk(repoRoot, SETTINGS_TARGET),
    };
  }
  const history = old.history ?? [
    { date: old.installedAt, kitVersion: installedVersion, action: "install", modules: old.modules ?? [] },
  ];
  return {
    ...old,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    modules: resolved.modules,
    values: { ...old.values, ...newValues },
    flags: resolved.flags,
    files: [...entries.values()].sort(byTarget),
    settings: settingsRecord,
    history: [...history, { date: resolved.values.DATE, kitVersion: kit.version, action: "add", modules: plan.add }],
  };
}

export function writeManifest(kit, resolved, repoRoot) {
  const manifest = buildManifest(kit, resolved, repoRoot);
  const abs = resolveTarget(repoRoot, MANIFEST_TARGET);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function main(argv, { kit = loadKit(), out = process.stdout } = {}) {
  const { command, opts } = parseArgs(argv);
  const repo = path.resolve(opts.repo ?? ".");
  if (command === "answers") {
    const manifest = readManifest(repo);
    if (!manifest) throw new Error(`no ${MANIFEST_TARGET} in ${repo}: the kit isn't installed there`);
    out.write(`${JSON.stringify(answersFromManifest(manifest), null, 2)}\n`);
    return 0;
  }
  const resolved = loadAnswers(kit, opts.answers);
  if (command === "check") {
    const pending = pendingWork(kit, resolved, repo);
    out.write(`${JSON.stringify(pending, null, 2)}\n`);
    return pending.done ? 0 : 1;
  }
  if (command === "write") {
    const m = writeManifest(kit, resolved, repo);
    const verb = resolved.add ? `added ${resolved.add.join(", ")}` : `${m.modules.length} modules`;
    out.write(`wrote ${MANIFEST_TARGET}: kit ${kit.version}, ${verb}, ${m.files.length} files\n`);
    return 0;
  }
  throw new Error(`unknown command "${command}"; use check, write or answers`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`harness-kit manifest: ${e.message}\n`);
    process.exitCode = 1;
  }
}
