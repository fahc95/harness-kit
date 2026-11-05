// Tests for the renderer behind /harness-kit:harness-init (render.mjs).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { deriveTarget, findAdaptMarkers, valueError } from "./contract.mjs";
import {
  applyPlan,
  envPrefixFrom,
  hookTestsCommand,
  KIT_NEW,
  main,
  mergeSettings,
  planInstall,
  renderAll,
  renderText,
  resolveAnswers,
  resolveTarget,
  riskyAllowRules,
  SETTINGS_TARGET,
} from "./render.mjs";
import { exampleAnswers, kit, markdownBacklogAnswers, put, withTempRepo } from "./test-support.mjs";

const SCRIPT = fileURLToPath(new URL("./render.mjs", import.meta.url));

const resolve = (answers) => {
  const r = resolveAnswers(kit, answers);
  assert.deepEqual(r.errors, []);
  return r;
};

describe("renderText", () => {
  const md = (lines) => lines.join("\n");

  test("keeps, drops and negates blocks in all three comment styles", () => {
    const cases = {
      html: ["<!-- kit:if has.db -->", "<!-- kit:if !has.db -->", "<!-- kit:end -->"],
      slash: ["// kit:if has.db", "// kit:if !has.db", "// kit:end"],
      hash: ["# kit:if has.db", "# kit:if !has.db", "# kit:end"],
    };
    for (const [style, [on, off, end]] of Object.entries(cases)) {
      const text = md(["a", on, "db", end, off, "no db", end, "z"]);
      assert.equal(renderText(text, { style, values: {}, flags: { "has.db": true } }), "a\ndb\nz", style);
      assert.equal(renderText(text, { style, values: {}, flags: { "has.db": false } }), "a\nno db\nz", style);
    }
  });

  test("fills tokens, NAME_JSON twins and arrays as JSON literals", () => {
    const out = renderText('{{OWNER}} {{OWNER_JSON}} {{LIST_JSON}}', {
      style: "slash",
      values: { OWNER: 'A "q"', LIST_JSON: ["a", "b"] },
      flags: {},
    });
    assert.equal(out, 'A "q" "A \\"q\\"" ["a","b"]');
  });

  test("a value with $ patterns lands verbatim", () => {
    assert.equal(renderText("{{X}}", { style: "html", values: { X: "$& $1 $$" }, flags: {} }), "$& $1 $$");
  });

  test("reports every unfilled token, but not ones in a dropped block", () => {
    assert.throws(() => renderText("{{A}} {{B}}", { style: "html", values: {}, flags: {} }), /unfilled token: A, B/);
    const text = md(["<!-- kit:if has.db -->", "{{DB_PATH}}", "<!-- kit:end -->"]);
    assert.equal(renderText(text, { style: "html", values: {}, flags: { "has.db": false } }), "");
  });

  test("rejects bad conditionals and unknown flags", () => {
    assert.throws(() => renderText("<!-- kit:if has.db -->", { style: "html", values: {}, flags: { "has.db": true } }), /never closed/);
    assert.throws(() => renderText("<!-- kit:if has.x -->\n<!-- kit:end -->", { style: "html", values: {}, flags: {} }), /unknown flag/);
    assert.throws(() => renderText("// kit:if has.db\n// kit:end", { style: "none", values: {}, flags: {} }), /not allowed/);
  });

  test("leaves kit:adapt markers in place, with their tokens filled", () => {
    const text = "<!-- kit:adapt: ask {{OWNER}} -->";
    const out = renderText(text, { style: "html", values: { OWNER: "Al" }, flags: {} });
    assert.deepEqual(findAdaptMarkers(out).markers.map((m) => m.instruction), ["ask Al"]);
  });
});

describe("resolveAnswers", () => {
  test("derives the computed tokens and flags", () => {
    const r = resolve(exampleAnswers());
    const ex = (n) => kit.vocabulary.tokens[n].example;
    assert.equal(r.values.KIT_VERSION, kit.version);
    assert.equal(r.values.DATE, "2026-01-15");
    assert.equal(r.values.DATE_YM, "2026-01");
    assert.equal(r.values.CMD_CHECKS, ex("CMD_CHECKS"));
    assert.deepEqual(r.values.VERIFY_COMMANDS_JSON, ex("VERIFY_COMMANDS_JSON"));
    assert.equal(r.values.CMD_HOOK_TESTS, ex("CMD_HOOK_TESTS"));
    assert.equal(r.values.ENV_PREFIX, ex("ENV_PREFIX"));
    assert.equal(r.values.PERSONA_NAME_PLANNER, kit.vocabulary.tokens.PERSONA_NAME_PLANNER.default);
    for (const f of ["has.typecheck", "has.lint", "has.test", "has.checks", "module.openPr", "module.prePush"]) {
      assert.equal(r.flags[f], true, f);
    }
    assert.equal(r.flags["flow.gitFlow"], false);
    assert.deepEqual(r.modules, ["core", "open-pr", "githooks-pre-push", "pm"]);
  });

  test("check flags follow the commands that exist", () => {
    const a = exampleAnswers();
    delete a.values.CMD_TYPECHECK;
    delete a.values.CMD_LINT;
    const r = resolve(a);
    assert.equal(r.flags["has.typecheck"], false);
    assert.equal(r.flags["has.test"], true);
    assert.equal(r.values.CMD_CHECKS, "npm test");
    const none = exampleAnswers();
    for (const k of ["CMD_TYPECHECK", "CMD_LINT", "CMD_TEST"]) delete none.values[k];
    const rn = resolve(none);
    assert.equal(rn.flags["has.checks"], false);
    assert.equal(rn.values.CMD_CHECKS, undefined);
    assert.deepEqual(rn.values.VERIFY_COMMANDS_JSON, []);
  });

  test("defaults the allow list to the checks plus read-only git", () => {
    const r = resolve(exampleAnswers());
    assert.deepEqual(r.values.ALLOW_RULES_JSON, [
      "Bash(npm run typecheck)",
      "Bash(npm run lint)",
      "Bash(npm test)",
      "Bash(git status)",
      "Bash(git diff *)",
      "Bash(git log *)",
    ]);
    const given = exampleAnswers();
    given.values.ALLOW_RULES_JSON = ["Bash(git status)"];
    assert.deepEqual(resolve(given).values.ALLOW_RULES_JSON, ["Bash(git status)"]);
  });

  test("CMD_HOOK_TESTS has one glob per installed module that ships tests", () => {
    const r = resolve({ ...exampleAnswers(), modules: ["core"] });
    assert.equal(r.values.CMD_HOOK_TESTS, 'node --test ".claude/hooks/*.test.mjs"');
    const mods = kit.registry.modules.filter((m) => m.id !== "flow-migration");
    assert.equal(hookTestsCommand(mods, r.flags), kit.vocabulary.tokens.CMD_HOOK_TESTS.example);
  });

  const errorsFor = (mutate) => {
    const a = exampleAnswers();
    mutate(a);
    return resolveAnswers(kit, a).errors.join("\n");
  };

  test("rejects production-reaching and guard-blocked commands", () => {
    assert.match(errorsFor((a) => (a.values.CMD_TEST = "npm run deploy")), /CMD_TEST: .*production/);
    assert.match(errorsFor((a) => (a.values.CMD_LINT = "NODE_ENV=x npm run lint")), /CMD_LINT: .*bash-guard/);
    assert.match(errorsFor((a) => (a.values.DB_COMMANDS_JSON = ["npm run db:push"])), /DB_COMMANDS_JSON: item "npm run db:push"/);
    assert.match(errorsFor((a) => (a.values.ALLOW_RULES_JSON = ["Bash(ssh host)"])), /ALLOW_RULES_JSON/);
    assert.match(errorsFor((a) => (a.values.CMD_TEST = "npm test; rm -rf /")), /CMD_TEST: .*does not match/);
  });

  test("rejects values that break their type or pattern", () => {
    assert.match(errorsFor((a) => (a.values.OWNER = "a|b")), /OWNER/);
    assert.match(errorsFor((a) => (a.values.PROJECT_NAME = "x {{OWNER}}")), /PROJECT_NAME/);
    assert.match(errorsFor((a) => (a.values.DB_PATH = ".claude/")), /DB_PATH/);
    assert.match(errorsFor((a) => (a.values.GH_REPO = "no-slash")), /GH_REPO/);
    assert.match(errorsFor((a) => (a.values.PROJECT_NAME = 42)), /PROJECT_NAME: must be a string/);
    assert.match(errorsFor((a) => (a.date = "2026/01/15")), /answers.date/);
  });

  test("rejects unknown, derived and switched-off answers", () => {
    assert.match(errorsFor((a) => (a.values.NOPE = "x")), /unknown token "NOPE"/);
    assert.match(errorsFor((a) => (a.values.CMD_CHECKS = "x")), /CMD_CHECKS" is derived/);
    assert.match(errorsFor((a) => (a.values.OWNER_JSON = "x")), /unknown token "OWNER_JSON"/);
    assert.match(errorsFor((a) => (a.flags["has.nope"] = true)), /unknown flag/);
    assert.match(errorsFor((a) => (a.flags["module.openPr"] = true)), /derived/);
    assert.match(errorsFor((a) => (a.flags["has.test"] = true)), /derived/);
    assert.match(errorsFor((a) => (a.flags["has.db"] = "yes")), /true or false/);
    assert.match(errorsFor((a) => (a.flags["has.db"] = false)), /DB_PATH" is set but has.db is false/);
    assert.match(errorsFor((a) => (a.extra = 1)), /unknown key "extra"/);
  });

  test("checks the module selection", () => {
    assert.match(errorsFor((a) => (a.modules = ["open-pr"])), /"core" module is required/);
    assert.match(errorsFor((a) => (a.modules = ["core", "nope"])), /unknown module "nope"/);
    assert.match(errorsFor((a) => (a.modules = ["core", "flow-migration"])), /requires "open-pr"/);
    assert.match(errorsFor((a) => (a.flags["has.github"] = false)), /"open-pr" needs has.github/);
    assert.match(errorsFor((a) => (a.modules = ["core", "open-pr", "flow-migration"])), /needs flow.gitFlow/);
  });

  test("every token value from a full answer set passes the vocabulary", () => {
    const a = exampleAnswers();
    a.flags["flow.gitFlow"] = true;
    const r = resolve(a);
    for (const [n, v] of Object.entries(r.values)) assert.equal(valueError(kit.vocabulary.tokens[n], kit.vocabulary, v), null, n);
  });
});

describe("envPrefixFrom", () => {
  test("upper-snakes the project name and keeps it a valid identifier", () => {
    assert.equal(envPrefixFrom("Example App"), "EXAMPLE_APP");
    assert.equal(envPrefixFrom("Café-Shop 2"), "CAFE_SHOP_2");
    assert.equal(envPrefixFrom("42 things"), "P_42_THINGS");
    assert.equal(envPrefixFrom("!!!"), "PROJECT");
  });
});

describe("renderAll", () => {
  for (const pmTool of [true, false]) {
    test(`renders every file of every module with no token left and the registry's targets (has.pmTool ${pmTool})`, () => {
      const a = pmTool ? exampleAnswers() : markdownBacklogAnswers();
      a.modules = kit.registry.modules.map((m) => m.id);
      Object.assign(a.flags, { "has.db": true, "has.github": true, "flow.gitFlow": true, "has.container": true });
      const r = resolve(a);
      const { files, settings } = renderAll(kit, r);
      const total = kit.registry.modules.reduce((n, m) => n + m.files.length, 0);
      assert.equal(files.length, total);
      const omitted = files.filter((f) => f.omitted).map((f) => f.target);
      assert.deepEqual(omitted, pmTool ? ["docs/backlog.md"] : []);
      for (const f of files.filter((x) => !x.omitted)) {
        assert.ok(!f.content.includes("{{"), `${f.target}: token left`);
        assert.ok(!/kit:(if|end)\b/.test(f.content), `${f.target}: kit:if left`);
        if (!f.template.includes("{{")) assert.equal(f.target, deriveTarget(f.template));
      }
      assert.ok(files.some((f) => f.target === "docs/plans/2026-01-github-flow-migration.md"));
      assert.equal(settings.length, 1);
      assert.ok(settings[0].fragment.permissions.deny.includes("Read(**/.env)"));
    });
  }

  test("omits files whose when flag is false", () => {
    const a = exampleAnswers();
    a.flags["has.container"] = false;
    const { files } = renderAll(kit, resolve(a));
    const parity = files.filter((f) => f.target.endsWith("production-parity.md"));
    assert.equal(parity.length, 2);
    for (const f of parity) assert.equal(f.omitted, true);
  });

  test("an unfilled token in a selected module fails with the template named", () => {
    const r = resolve(exampleAnswers());
    delete r.values.GH_ACCOUNT;
    assert.throws(() => renderAll(kit, r), /open-pr.*unfilled token: GH_ACCOUNT/s);
  });
});

describe("mergeSettings", () => {
  test("unions arrays, merges objects and keeps the project's scalars", () => {
    const existing = { $schema: "mine", permissions: { allow: ["Bash(make)"], deny: ["Read(x)"] }, model: "a" };
    const fragment = { $schema: "kit", permissions: { allow: ["Bash(make)", "Bash(git status)"], deny: ["Read(.env)"] }, hooks: {} };
    const { merged, conflicts } = mergeSettings(existing, fragment);
    assert.deepEqual(merged, {
      $schema: "mine",
      permissions: { allow: ["Bash(make)", "Bash(git status)"], deny: ["Read(x)", "Read(.env)"] },
      model: "a",
      hooks: {},
    });
    assert.deepEqual(conflicts, [{ path: "$schema", kept: "mine", kit: "kit" }]);
  });

  test("a type clash keeps the project's value and is reported", () => {
    const { merged, conflicts } = mergeSettings({ permissions: "x" }, { permissions: { allow: [] } });
    assert.deepEqual(merged, { permissions: "x" });
    assert.equal(conflicts[0].path, "permissions");
  });

  test("riskyAllowRules flags production-reaching existing allows", () => {
    const risky = riskyAllowRules(kit, { permissions: { allow: ["Bash(npm test)", "Bash(ssh host *)", "Read(x)"] } });
    assert.deepEqual(risky, ["Bash(ssh host *)"]);
  });
});

describe("planInstall and applyPlan", () => {
  test("a fresh repo gets every file created, git hook modes and merged settings", () =>
    withTempRepo((root) => {
      const r = resolve(exampleAnswers());
      const plan = planInstall(kit, r, root);
      const actions = new Set(plan.files.map((f) => f.action));
      assert.deepEqual([...actions].sort(), ["create", "omit"]);
      // With a PM tool the backlog lives there, so docs/backlog.md is not rendered.
      assert.deepEqual(plan.files.filter((f) => f.action === "omit").map((f) => f.target), ["docs/backlog.md"]);
      assert.equal(plan.settings.action, "create");
      assert.deepEqual(plan.postInstall, [{ module: "githooks-pre-push", command: "git config core.hooksPath .githooks" }]);
      const written = applyPlan(plan, root);
      assert.equal(written.length, plan.files.filter((f) => f.action === "create").length + 1);
      assert.ok(fs.statSync(path.join(root, ".githooks/pre-push")).mode & 0o111);
      const settings = JSON.parse(fs.readFileSync(path.join(root, SETTINGS_TARGET), "utf8"));
      assert.deepEqual(settings.permissions.allow, r.values.ALLOW_RULES_JSON);
      // A second plan sees everything in place.
      const again = planInstall(kit, r, root);
      assert.deepEqual([...new Set(again.files.map((f) => f.action))].sort(), ["omit", "unchanged"]);
      assert.equal(again.settings.action, "unchanged");
      assert.deepEqual(applyPlan(again, root), []);
    }));

  test("existing files are never overwritten: merge and kit-new go to .kit-new, skip stays", () =>
    withTempRepo((root) => {
      put(root, "AGENTS.md", "# Ours\n");
      put(root, ".claude/agents/planner.md", "our planner\n");
      put(root, SETTINGS_TARGET, JSON.stringify({ permissions: { allow: ["Bash(ssh box)"] }, model: "x" }));
      const plan = planInstall(kit, resolve(exampleAnswers()), root);
      const byTarget = Object.fromEntries(plan.files.map((f) => [f.target, f]));
      assert.equal(byTarget["AGENTS.md"].action, "merge");
      assert.equal(byTarget[".claude/agents/planner.md"].action, "kit-new");
      assert.equal(plan.settings.action, "update");
      assert.deepEqual(plan.settings.riskyExistingAllow, ["Bash(ssh box)"]);
      applyPlan(plan, root);
      assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), "# Ours\n");
      assert.match(fs.readFileSync(path.join(root, `AGENTS.md${KIT_NEW}`), "utf8"), /^# AGENTS.md: Example App/);
      assert.equal(fs.readFileSync(path.join(root, ".claude/agents/planner.md"), "utf8"), "our planner\n");
      assert.ok(fs.existsSync(path.join(root, `.claude/agents/planner.md${KIT_NEW}`)));
      const settings = JSON.parse(fs.readFileSync(path.join(root, SETTINGS_TARGET), "utf8"));
      assert.equal(settings.model, "x");
      assert.ok(settings.permissions.allow.includes("Bash(ssh box)"), "the project's allow stays for the owner to decide");
      assert.ok(settings.permissions.deny.includes("Read(**/.env)"));

      const registry = structuredClone(kit.registry);
      registry.modules[0].files.find((f) => f.target === "AGENTS.md").onExisting = "skip";
      const skipPlan = planInstall({ ...kit, registry }, resolve(exampleAnswers()), root);
      assert.equal(skipPlan.files.find((f) => f.target === "AGENTS.md").action, "skip");
    }));

  test("invalid existing settings stop the plan", () =>
    withTempRepo((root) => {
      put(root, SETTINGS_TARGET, "{ nope");
      assert.throws(() => planInstall(kit, resolve(exampleAnswers()), root), /not valid JSON/);
      put(root, SETTINGS_TARGET, "[]");
      assert.throws(() => planInstall(kit, resolve(exampleAnswers()), root), /JSON object/);
    }));

  test("targets can't escape the repo or go through a symlink", () =>
    withTempRepo((root) => {
      assert.throws(() => resolveTarget(root, "../x"), /outside the repo/);
      assert.throws(() => resolveTarget(root, "/etc/x"), /outside the repo/);
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "kit-elsewhere-"));
      try {
        fs.symlinkSync(elsewhere, path.join(root, ".claude"));
        assert.throws(() => planInstall(kit, resolve(exampleAnswers()), root), /symlink: \.claude/);
      } finally {
        fs.rmSync(elsewhere, { recursive: true, force: true });
      }
    }));
});

describe("CLI", () => {
  const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

  test("plan, show and apply against a temp repo", () =>
    withTempRepo((root) => {
      const answers = path.join(root, "..", `${path.basename(root)}-answers.json`);
      fs.writeFileSync(answers, JSON.stringify(exampleAnswers()));
      try {
        const plan = run(["plan", "--answers", answers, "--repo", root]);
        assert.equal(plan.status, 0, plan.stderr);
        const parsed = JSON.parse(plan.stdout);
        assert.ok(parsed.files.every((f) => !("content" in f)));
        assert.equal(fs.readdirSync(root).length, 0, "plan writes nothing");

        const show = run(["show", "--answers", answers, "--repo", root, "--target", "CLAUDE.md"]);
        assert.equal(show.status, 0, show.stderr);
        assert.match(show.stdout, /^# CLAUDE.md: Example App/);
        assert.match(run(["show", "--answers", answers, "--repo", root, "--target", SETTINGS_TARGET]).stdout, /"deny"/);
        assert.equal(run(["show", "--answers", answers, "--repo", root, "--target", "nope.md"]).status, 1);

        const apply = run(["apply", "--answers", answers, "--repo", root]);
        assert.equal(apply.status, 0, apply.stderr);
        assert.ok(JSON.parse(apply.stdout).written.includes("AGENTS.md"));
      } finally {
        fs.rmSync(answers, { force: true });
      }
    }));

  test("bad answers fail with every problem listed and write nothing", () =>
    withTempRepo((root) => {
      const answers = path.join(root, "..", `${path.basename(root)}-bad.json`);
      const a = exampleAnswers();
      a.values.CMD_TEST = "npm run deploy";
      a.values.OWNER = "a|b";
      fs.writeFileSync(answers, JSON.stringify(a));
      try {
        const r = run(["apply", "--answers", answers, "--repo", root]);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /CMD_TEST/);
        assert.match(r.stderr, /OWNER/);
        assert.equal(fs.readdirSync(root).length, 0);
      } finally {
        fs.rmSync(answers, { force: true });
      }
    }));

  test("main rejects unknown commands and missing arguments", () => {
    assert.throws(() => main(["plan"]), /--answers/);
    assert.throws(() => main(["plan", "--answers"]), /bad argument/);
  });
});
