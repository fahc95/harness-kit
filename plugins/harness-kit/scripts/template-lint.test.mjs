// Checks every file under templates/ against the contract (templates/vocabulary.json,
// docs/templates.md in the kit repo) and the registry (templates/modules.json).
// CI runs it with node --test. Template files end in .tmpl, so they never run here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  commentStyle,
  deriveTarget,
  evalFlag,
  findAdaptMarkers,
  findTokens,
  frontmatterErrors,
  knownTokenNames,
  listTemplateFiles,
  miniRender,
  parseConditionals,
  valueMatches,
} from "./template-lint.mjs";

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");
const DATA_FILES = new Set(["modules.json", "vocabulary.json"]);
const vocabulary = JSON.parse(fs.readFileSync(path.join(TEMPLATES, "vocabulary.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(TEMPLATES, "modules.json"), "utf8"));
const allFiles = listTemplateFiles(TEMPLATES);
const templates = allFiles.filter((f) => !DATA_FILES.has(f));
const read = (f) => fs.readFileSync(path.join(TEMPLATES, f), "utf8");
const known = knownTokenNames(vocabulary);
const flagNames = Object.keys(vocabulary.flags);
const baseFlag = (f) => f.replace(/^!/, "");
const examples = Object.fromEntries(
  Object.entries(vocabulary.tokens).map(([name, entry]) => [name, entry.example]),
);
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const allFlags = (value) => Object.fromEntries(flagNames.map((f) => [f, value]));

// Names of the reference implementation and its stack. Templates carry tokens instead.
// Persona display names are allowed only as vocabulary defaults. The first target's names
// are private and are never listed in this public file; grep for them locally.
const FORBIDDEN = [
  /misuper/i,
  /mi s[uú]per/i,
  /tanstack/i,
  /nicaragu/i,
  /voseo/i,
  /fahc95\//i,
  /fredz\//i,
  /freddy/i,
  /HARNESS_KIT_ALLOW/,
  /\bprisma\b/i,
  /\brailway\b/i,
  /\bbiome\b/i,
  /\bpnpm\b/i,
  /\bvitest\b/i,
  /\bhousehold/i,
  ...Object.values(vocabulary.tokens)
    .filter((e) => e.default)
    // \b is ASCII-only, so names like "Gaudí" need Unicode letter lookarounds.
    .map((e) => new RegExp(`(?<!\\p{L})${escapeRegExp(e.default)}(?!\\p{L})`, "iu")),
];

const registryFiles = registry.modules.flatMap((m) =>
  m.files.map((f) => ({ ...f, module: m.id })),
);
const registryFlags = registry.modules.flatMap((m) => [
  m.when,
  ...m.files.map((f) => f.when),
]).filter(Boolean);

describe("helpers", () => {
  test("deriveTarget maps module roots, dot folders and the suffix", () => {
    assert.equal(deriveTarget("core/AGENTS.md.tmpl"), "AGENTS.md");
    assert.equal(deriveTarget("core/dot-agents/personas/planner.md.tmpl"), ".agents/personas/planner.md");
    assert.equal(deriveTarget("common/open-pr/dot-github/x.md.tmpl"), ".github/x.md");
    assert.throws(() => deriveTarget("core/AGENTS.md"));
    assert.throws(() => deriveTarget("other/AGENTS.md.tmpl"));
  });

  test("commentStyle follows the target type", () => {
    assert.equal(commentStyle("AGENTS.md"), "html");
    assert.equal(commentStyle(".claude/hooks/x.mjs"), "slash");
    assert.equal(commentStyle(".githooks/pre-push"), "hash");
    assert.equal(commentStyle("x.json"), "none");
  });

  test("parseConditionals rejects nesting, imbalance and inline markers", () => {
    const ok = parseConditionals("a\n<!-- kit:if has.db -->\nb\n<!-- kit:end -->\n", "html");
    assert.deepEqual(ok, { blocks: [{ flag: "has.db", start: 2, end: 4 }], errors: [] });
    const nested = "<!-- kit:if has.db -->\n<!-- kit:if has.ui -->\n<!-- kit:end -->\n<!-- kit:end -->";
    assert.match(parseConditionals(nested, "html").errors.join(), /nested/);
    assert.match(parseConditionals("<!-- kit:if has.db -->", "html").errors.join(), /never closed/);
    assert.match(parseConditionals("<!-- kit:end -->", "html").errors.join(), /without kit:if/);
    assert.match(parseConditionals("x <!-- kit:if has.db -->", "html").errors.join(), /malformed/);
    assert.match(parseConditionals("// kit:if has.db", "html").errors.join(), /malformed/);
    assert.match(parseConditionals("<!-- kit:if db -->\n<!-- kit:end -->", "html").errors.join(), /bad flag/);
    assert.match(parseConditionals("x kit:if", "none").errors.join(), /not allowed/);
  });

  test("findTokens and findAdaptMarkers report malformed uses", () => {
    assert.deepEqual(findTokens("a {{OWNER}} b\n{{ lower }}"), {
      tokens: [{ name: "OWNER", line: 1 }],
      malformed: [2],
    });
    assert.equal(findAdaptMarkers("<!-- kit:adapt: write it -->").markers[0].instruction, "write it");
    assert.equal(findAdaptMarkers("text <!-- kit:adapt: x -->").errors.length, 1);
    assert.equal(findAdaptMarkers("<!-- kit:adapt: -->").errors.length, 1);
  });

  test("miniRender keeps, drops and negates blocks, fills tokens and _JSON twins", () => {
    const text = [
      "{{OWNER}}",
      "<!-- kit:if has.db -->",
      "db",
      "<!-- kit:end -->",
      "<!-- kit:if !has.db -->",
      "no db",
      "<!-- kit:end -->",
      "{{OWNER_JSON}}",
    ].join("\n");
    const opts = { style: "html", values: { OWNER: "Al" } };
    assert.equal(miniRender(text, { ...opts, flags: { "has.db": true } }), 'Al\ndb\n"Al"');
    assert.equal(miniRender(text, { ...opts, flags: { "has.db": false } }), 'Al\nno db\n"Al"');
    assert.throws(() => miniRender("{{NOPE}}", { ...opts, flags: {} }), /unfilled token: NOPE/);
    assert.throws(() => evalFlag("has.x", {}), /unknown flag/);
    assert.equal(miniRender("{{L}}", { style: "slash", values: { L: ["a", "b"] }, flags: {} }), '["a","b"]');
  });

  test("frontmatterErrors needs a closed block of key: value lines", () => {
    assert.deepEqual(frontmatterErrors("---\nname: x\npaths:\n  - \"a\"\n---\nbody\n---\n"), []);
    assert.deepEqual(frontmatterErrors("no frontmatter"), []);
    assert.match(frontmatterErrors("---\nname: x\n").join(), /never closes/);
    assert.match(frontmatterErrors("---\n<!-- kit:adapt: x -->\n---\n").join(), /HTML comment/);
    assert.match(frontmatterErrors("---\njust text\n---\n").join(), /not a/);
    assert.match(frontmatterErrors("---\ndescription: a: b\n---\n").join(), /unquoted/);
  });
});

describe("vocabulary", () => {
  test("every token has a known type, a description, a source and a valid example", () => {
    for (const [name, entry] of Object.entries(vocabulary.tokens)) {
      assert.ok(vocabulary.types[entry.type], `${name}: unknown type ${entry.type}`);
      assert.ok(entry.description && entry.source, `${name}: description and source required`);
      assert.ok(valueMatches(entry, vocabulary.types, entry.example), `${name}: bad example`);
      if (entry.default !== undefined) {
        assert.ok(valueMatches(entry, vocabulary.types, entry.default), `${name}: bad default`);
      }
      if (entry.when) assert.ok(flagNames.includes(entry.when), `${name}: unknown when flag`);
    }
  });

  test("DB_PATH can't widen the architect's scope, and OWNER can't break a table", () => {
    const ok = (name, v) => valueMatches(vocabulary.tokens[name], vocabulary.types, v);
    for (const bad of [".", "./", ".git/", ".claude/", "db/.hidden", "a/../b", "/abs"]) {
      assert.equal(ok("DB_PATH", bad), false, bad);
    }
    assert.equal(ok("DB_PATH", "packages/db/"), true);
    assert.equal(ok("OWNER", "a|b"), false);
  });

  test("flag names follow the grammar", () => {
    for (const f of flagNames) assert.match(f, /^(has|flow|module)\.[a-z][A-Za-z]*$/);
  });
});

describe("template tree", () => {
  test("every template ends in .tmpl; only the two data files don't", () => {
    for (const f of allFiles) {
      assert.ok(f.endsWith(".tmpl") || DATA_FILES.has(f), `${f}: missing .tmpl suffix`);
    }
  });

  test("no path segment starts with a dot, and no token appears in a path except DATE_YM", () => {
    for (const f of allFiles) {
      for (const seg of f.split("/")) assert.ok(!seg.startsWith("."), `${f}: dot segment`);
      assert.ok(!f.replaceAll("{{DATE_YM}}", "").includes("{{"), `${f}: token in path`);
    }
  });

  for (const f of templates) {
    describe(f, () => {
      const text = read(f);
      const target = deriveTarget(f);
      const style = commentStyle(target);
      const { blocks, errors } = parseConditionals(text, style);

      test("kit:if blocks are balanced, unnested and use known flags", () => {
        assert.deepEqual(errors, []);
        for (const b of blocks) assert.ok(flagNames.includes(baseFlag(b.flag)), `unknown flag ${b.flag}`);
      });

      test("tokens are in the vocabulary, fit the file type and sit inside their when block", () => {
        const { tokens, malformed } = findTokens(text);
        assert.deepEqual(malformed, [], "malformed {{ on these lines");
        for (const t of tokens) {
          const where = `line ${t.line} {{${t.name}}}`;
          const k = known.get(t.name);
          assert.ok(k, `${where}: unknown token`);
          if (style === "slash" || style === "none") {
            assert.ok(t.name.endsWith("_JSON"), `${where}: .mjs and .json allow only _JSON tokens`);
          }
          if (style === "hash") assert.equal(k.entry.type, "identifier", `${where}: shell and YAML allow only identifier tokens`);
          if (k.entry.when) {
            const inside = blocks.some((b) => b.flag === k.entry.when && b.start < t.line && t.line < b.end);
            assert.ok(inside, `${where}: must sit inside a kit:if ${k.entry.when} block`);
          }
        }
      });

      test("kit:adapt markers are well-formed and only in Markdown", () => {
        const { markers, errors: adaptErrors } = findAdaptMarkers(text);
        assert.deepEqual(adaptErrors, []);
        if (style !== "html") assert.equal(markers.length, 0, "kit:adapt is Markdown-only");
      });

      test("no reference-implementation names", () => {
        for (const re of FORBIDDEN) assert.doesNotMatch(text, re);
      });

      for (const value of [true, false]) {
        test(`renders with every flag ${value}: no token left, valid frontmatter`, () => {
          const out = miniRender(text, { style, values: examples, flags: allFlags(value) });
          assert.ok(!out.includes("{{"), "a {{ is left after render");
          assert.deepEqual(frontmatterErrors(out), []);
        });
      }
    });
  }

  test("modules.json is free of reference names too", () => {
    const text = read("modules.json");
    for (const re of FORBIDDEN) assert.doesNotMatch(text, re);
  });
});

describe("contract usage", () => {
  const usedTokens = new Set();
  const usedFlags = new Set(registryFlags.map(baseFlag));
  for (const f of templates) {
    const text = read(f);
    for (const t of findTokens(text).tokens) usedTokens.add(known.get(t.name)?.base ?? t.name);
    for (const b of parseConditionals(text, commentStyle(deriveTarget(f))).blocks) usedFlags.add(baseFlag(b.flag));
  }

  test("every vocabulary token is used by some template", () => {
    const dead = Object.keys(vocabulary.tokens).filter((n) => !usedTokens.has(n));
    assert.deepEqual(dead, []);
  });

  test("every vocabulary flag is used by a template or the registry", () => {
    assert.deepEqual(flagNames.filter((n) => !usedFlags.has(n)), []);
  });
});

describe("modules.json", () => {
  const ids = registry.modules.map((m) => m.id);

  test("ids are unique and requires point at known modules without cycles", () => {
    assert.equal(new Set(ids).size, ids.length);
    const byId = new Map(registry.modules.map((m) => [m.id, m]));
    const visit = (id, trail) => {
      assert.ok(byId.has(id), `unknown module ${id}`);
      assert.ok(!trail.includes(id), `cycle: ${[...trail, id].join(" -> ")}`);
      for (const r of byId.get(id).requires) visit(r, [...trail, id]);
    };
    for (const id of ids) visit(id, []);
  });

  test("each module has the required fields and known flags", () => {
    for (const m of registry.modules) {
      assert.ok(["core", "common", "example"].includes(m.tier), `${m.id}: tier`);
      assert.ok(m.title && m.offer, `${m.id}: title and offer`);
      assert.equal(typeof m.default, "boolean", `${m.id}: default`);
      for (const k of ["requires", "files", "settings", "postInstall"]) {
        assert.ok(Array.isArray(m[k]), `${m.id}: ${k} must be an array`);
      }
      for (const f of [m.when, ...m.files.map((x) => x.when)].filter(Boolean)) {
        assert.ok(flagNames.includes(baseFlag(f)), `${m.id}: unknown flag ${f}`);
      }
    }
  });

  test("every file entry exists, targets its derived path and has a valid mode", () => {
    for (const f of registryFiles) {
      assert.ok(templates.includes(f.template), `${f.module}: missing ${f.template}`);
      assert.equal(f.target, deriveTarget(f.template), `${f.template}: target`);
      assert.ok(["merge", "kit-new", "skip"].includes(f.onExisting), `${f.template}: onExisting`);
      if (f.mode !== undefined) assert.ok(f.target.startsWith(".githooks/"), `${f.template}: mode only on .githooks`);
    }
  });

  test("adapt is set exactly on the templates that carry kit:adapt markers", () => {
    for (const f of registryFiles) {
      const has = findAdaptMarkers(read(f.template)).markers.length > 0;
      assert.equal(f.adapt === true, has, `${f.template}: adapt should be ${has}`);
    }
  });

  test("no two file entries render to the same target", () => {
    const targets = registryFiles.map((f) => f.target);
    assert.deepEqual(targets.filter((t, i) => targets.indexOf(t) !== i), []);
  });

  test("settings fragments exist", () => {
    for (const m of registry.modules) {
      for (const t of m.settings) assert.ok(templates.includes(t), `${m.id}: missing settings ${t}`);
    }
  });

  test("every template belongs to exactly one module", () => {
    const counts = new Map();
    for (const m of registry.modules) {
      for (const t of [...m.files.map((f) => f.template), ...m.settings]) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    for (const t of templates) assert.equal(counts.get(t), 1, `${t}: listed ${counts.get(t) ?? 0} times`);
  });
});
