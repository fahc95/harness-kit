// The template contract (templates/vocabulary.json, docs/templates.md in the kit repo) as
// code: path mapping, kit:if parsing and value checks. Shared by the renderer, the detector,
// the manifest writer and the template lint, so they can never disagree.
import fs from "node:fs";
import path from "node:path";

export const TOKEN_RE = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;
export const FLAG_RE = /^!?(has|flow|module)\.[a-z][A-Za-z]*$/;
const ADAPT_RE = /^\s*<!-- kit:adapt: (\S.*?) -->\s*$/;

// Comment syntax for kit:if / kit:end, by the rendered file's type.
const MARKERS = {
  html: { if: /^\s*<!-- kit:if (\S+) -->\s*$/, end: /^\s*<!-- kit:end -->\s*$/ },
  slash: { if: /^\s*\/\/ kit:if (\S+)\s*$/, end: /^\s*\/\/ kit:end\s*$/ },
  hash: { if: /^\s*# kit:if (\S+)\s*$/, end: /^\s*# kit:end\s*$/ },
  none: null,
};

/** Every file under dir, as sorted posix paths relative to dir. */
export function listTemplateFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else out.push(next);
    }
  };
  walk("");
  return out.sort();
}

/**
 * Target path in the installed repo for a template path relative to templates/:
 * strip the module root (core/, common/<id>/, examples/<id>/) and the .tmpl suffix,
 * and turn each dot-<x> segment into .<x>.
 */
export function deriveTarget(templatePath) {
  const parts = templatePath.split("/");
  let rest;
  if (parts[0] === "core") rest = parts.slice(1);
  else if (parts[0] === "common" || parts[0] === "examples") rest = parts.slice(2);
  else throw new Error(`not under a module root: ${templatePath}`);
  if (rest.length === 0 || !templatePath.endsWith(".tmpl")) {
    throw new Error(`not a template file: ${templatePath}`);
  }
  rest[rest.length - 1] = rest[rest.length - 1].slice(0, -".tmpl".length);
  return rest.map((s) => (s.startsWith("dot-") ? `.${s.slice(4)}` : s)).join("/");
}

/** Comment style for kit:if markers, from the target path. */
export function commentStyle(target) {
  const base = path.posix.basename(target);
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")) : "";
  if (ext === ".md") return "html";
  if (ext === ".mjs" || ext === ".js") return "slash";
  if (ext === ".json") return "none";
  if (ext === "" || ext === ".sh" || ext === ".yml" || ext === ".yaml") return "hash";
  throw new Error(`no comment style for ${target}`);
}

/**
 * kit:if blocks as { flag, start, end } (1-based marker lines). Errors for markers in the
 * wrong syntax or not alone on their line, bad flags, nesting, and unbalanced blocks.
 */
export function parseConditionals(text, style) {
  const blocks = [];
  const errors = [];
  const syntax = MARKERS[style];
  let open = null;
  text.split("\n").forEach((line, i) => {
    const n = i + 1;
    if (!/kit:(if|end)\b/.test(line)) return;
    if (!syntax) return void errors.push(`line ${n}: kit:if is not allowed in this file type`);
    const mIf = line.match(syntax.if);
    if (mIf) {
      if (!FLAG_RE.test(mIf[1])) errors.push(`line ${n}: bad flag "${mIf[1]}"`);
      if (open) errors.push(`line ${n}: nested kit:if (block opened on line ${open.start})`);
      else open = { flag: mIf[1], start: n };
      return;
    }
    if (syntax.end.test(line)) {
      if (!open) errors.push(`line ${n}: kit:end without kit:if`);
      else blocks.push({ ...open, end: n });
      open = null;
      return;
    }
    errors.push(`line ${n}: malformed kit:if/kit:end marker (wrong syntax for this file type, or not alone on its line)`);
  });
  if (open) errors.push(`line ${open.start}: kit:if ${open.flag} is never closed`);
  return { blocks, errors };
}

/** kit:adapt markers with their instruction, and errors for malformed ones. */
export function findAdaptMarkers(text) {
  const markers = [];
  const errors = [];
  text.split("\n").forEach((line, i) => {
    if (!line.includes("kit:adapt")) return;
    const m = line.match(ADAPT_RE);
    if (m) markers.push({ line: i + 1, instruction: m[1] });
    else errors.push(`line ${i + 1}: malformed kit:adapt marker (must be "<!-- kit:adapt: <instruction> -->" alone on its line)`);
  });
  return { markers, errors };
}

export function evalFlag(flag, flags) {
  const negate = flag.startsWith("!");
  const name = negate ? flag.slice(1) : flag;
  if (!(name in flags)) throw new Error(`unknown flag: ${name}`);
  return negate ? !flags[name] : Boolean(flags[name]);
}

/** The command inside a value or array item: a Bash(...) rule's content, minus its " *". */
export const commandOf = (v) => v.match(/^Bash\((.*?)( \*)?\)$/)?.[1] ?? v;

/**
 * The rejectCommandPatterns entry a command matches, as { list, pattern }, or null.
 * Production patterns ignore case (PROD is still prod); bash-guard's own rules don't.
 */
export function rejectedCommand(vocabulary, value) {
  const { production = [], blockedByGuard = [] } = vocabulary.rejectCommandPatterns ?? {};
  const cmd = commandOf(value);
  for (const p of production) if (new RegExp(p, "iu").test(cmd)) return { list: "production", pattern: p };
  for (const p of blockedByGuard) if (new RegExp(p, "u").test(cmd)) return { list: "blockedByGuard", pattern: p };
  return null;
}

const rejectReason = (hit) =>
  hit.list === "production"
    ? `looks production-reaching (matches /${hit.pattern}/); ask the owner, never allow it`
    : `bash-guard would block it anyway (matches /${hit.pattern}/)`;

/**
 * Why a value does not fit its vocabulary entry, or null when it does. It must match the
 * type pattern and the entry's own pattern (or, for an array, each item its itemPattern),
 * and no command in it may match vocabulary.rejectCommandPatterns.
 */
export function valueError(entry, vocabulary, value) {
  if (entry.type === "json-array") {
    if (!Array.isArray(value)) return "must be a JSON array of strings";
    const item = entry.itemPattern && new RegExp(entry.itemPattern, "u");
    for (const v of value) {
      if (typeof v !== "string") return `item ${JSON.stringify(v)} is not a string`;
      if (item && !item.test(v)) return `item ${JSON.stringify(v)} does not match ${entry.itemPattern}`;
      const hit = entry.commandItems && rejectedCommand(vocabulary, v);
      if (hit) return `item ${JSON.stringify(v)} ${rejectReason(hit)}`;
    }
    return null;
  }
  if (typeof value !== "string") return "must be a string";
  for (const p of [vocabulary.types[entry.type]?.pattern, entry.pattern].filter(Boolean)) {
    if (!new RegExp(p, "u").test(value)) return `${JSON.stringify(value)} does not match ${p}`;
  }
  const hit = entry.type === "command" && rejectedCommand(vocabulary, value);
  return hit ? `${JSON.stringify(value)} ${rejectReason(hit)}` : null;
}

/** Does a value fit its vocabulary entry? See valueError. */
export const valueMatches = (entry, vocabulary, value) => valueError(entry, vocabulary, value) === null;

/** The token names a template may use: each vocabulary token, and NAME_JSON for non-arrays. */
export function knownTokenNames(vocabulary) {
  const names = new Map();
  for (const [name, entry] of Object.entries(vocabulary.tokens)) {
    names.set(name, { base: name, entry });
    if (entry.type !== "json-array") names.set(`${name}_JSON`, { base: name, entry });
  }
  return names;
}
