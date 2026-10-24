// Pure helpers for checking templates against the contract in templates/vocabulary.json
// (docs/templates.md in the kit repo). No renderer exists yet (Phase 3), so miniRender is
// the smallest render that the lint test needs: drop or keep kit:if blocks, fill tokens,
// leave kit:adapt markers alone. Phase 3's render script should keep the same semantics.
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

/** Every {{TOKEN}} with its 1-based line, plus lines with a "{{" that is not a well-formed token. */
export function findTokens(text) {
  const tokens = [];
  const malformed = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(TOKEN_RE)) tokens.push({ name: m[1], line: i + 1 });
    if (line.replace(TOKEN_RE, "").includes("{{")) malformed.push(i + 1);
  });
  return { tokens, malformed };
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

/**
 * Minimal render: keep or drop kit:if blocks (marker lines always go), then fill tokens.
 * NAME_JSON is the JSON literal of NAME's value. Throws on an unknown or unfilled token.
 */
export function miniRender(text, { style, values, flags }) {
  const { blocks, errors } = parseConditionals(text, style);
  if (errors.length) throw new Error(errors.join("; "));
  const drop = new Set();
  for (const b of blocks) {
    drop.add(b.start);
    drop.add(b.end);
    if (!evalFlag(b.flag, flags)) for (let n = b.start + 1; n < b.end; n++) drop.add(n);
  }
  const kept = text.split("\n").filter((_, i) => !drop.has(i + 1)).join("\n");
  return kept.replace(TOKEN_RE, (_, name) => {
    if (Object.hasOwn(values, name)) {
      const v = values[name];
      return Array.isArray(v) ? JSON.stringify(v) : String(v);
    }
    const base = name.endsWith("_JSON") ? name.slice(0, -"_JSON".length) : null;
    if (base && Object.hasOwn(values, base)) return JSON.stringify(values[base]);
    throw new Error(`unfilled token: ${name}`);
  });
}

/**
 * Problems in a rendered file's YAML frontmatter, if it has one: it must close, and each
 * line must be a block-style "key: value", "key:" or "- item" (nested by even indentation),
 * with no HTML comment and no unquoted ": " inside a value.
 */
export function frontmatterErrors(text) {
  if (!text.startsWith("---\n")) return [];
  const lines = text.split("\n");
  const close = lines.indexOf("---", 1);
  if (close === -1) return ["frontmatter never closes"];
  const errors = [];
  lines.slice(1, close).forEach((line, i) => {
    const n = i + 2;
    if (line.includes("<!--")) errors.push(`line ${n}: HTML comment in frontmatter`);
    else {
      const m = line.match(/^((?: {2})*)(- )?(.*)$/);
      const body = m[3];
      const keyValue = body.match(/^[A-Za-z_][\w-]*:( (\S.*))?$/);
      if (!keyValue && !(m[2] && /^\S/.test(body))) {
        errors.push(`line ${n}: not a "key: value" or "- item" line with even indentation`);
      } else if (keyValue?.[2] && /: /.test(keyValue[2]) && !/^["']/.test(keyValue[2])) {
        errors.push(`line ${n}: unquoted ": " in a value`);
      }
    }
  });
  return errors;
}

/** Does a value match its vocabulary entry (type pattern, then the entry's own pattern)? */
export function valueMatches(entry, types, value) {
  if (entry.type === "json-array") {
    const item = entry.itemPattern && new RegExp(entry.itemPattern, "u");
    return Array.isArray(value) && value.every((v) => typeof v === "string" && (!item || item.test(v)));
  }
  if (typeof value !== "string") return false;
  const patterns = [types[entry.type]?.pattern, entry.pattern].filter(Boolean);
  return patterns.every((p) => new RegExp(p, "u").test(value));
}

/** The token names a template may use: each vocabulary token, and NAME_JSON for non-arrays. */
export function knownTokenNames(vocabulary) {
  const names = new Map();
  for (const [name, entry] of Object.entries(vocabulary.tokens)) {
    names.set(name, { base: name, entry });
    if (entry.type !== "json-array") names.set(`${name}_JSON`, { base: name, entry });
  }
  return names;
}
