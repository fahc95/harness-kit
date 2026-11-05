// Lint-only helpers for checking templates against the contract in templates/vocabulary.json
// (docs/templates.md in the kit repo). The contract itself lives in contract.mjs and the
// renderer in render.mjs; they are re-exported here so the lint test checks the same code
// the installer runs.
import { TOKEN_RE } from "./contract.mjs";
import { renderText } from "./render.mjs";

export {
  commentStyle,
  deriveTarget,
  evalFlag,
  findAdaptMarkers,
  FLAG_RE,
  knownTokenNames,
  listTemplateFiles,
  parseConditionals,
  TOKEN_RE,
  valueMatches,
} from "./contract.mjs";

/** The renderer the installer uses, under the name the lint test has always called it. */
export const miniRender = renderText;

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
