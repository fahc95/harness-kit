// Tests for add mode: modules joining an existing install (render.mjs planAdd, manifest.mjs).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { MANIFEST_TARGET, pendingWork, writeManifest } from "./manifest.mjs";
import { addedLines, answersFromManifest, applyPlan, lineDiff, planInstall, resolveAnswers } from "./render.mjs";
import { exampleAnswers, kit, put, withTempRepo } from "./test-support.mjs";

const MANIFEST_SCRIPT = fileURLToPath(new URL("./manifest.mjs", import.meta.url));
const RENDER_SCRIPT = fileURLToPath(new URL("./render.mjs", import.meta.url));

const resolve = (answers) => {
  const r = resolveAnswers(kit, answers);
  assert.deepEqual(r.errors, []);
  return r;
};

/** Stand-in for the skill's adapt step: replace every kit:adapt marker line in the repo. */
const resolveAdaptMarkers = (root, plan) => {
  for (const f of plan.files.filter((x) => x.adapt && ["create", "unchanged"].includes(x.action))) {
    const abs = path.join(root, f.target);
    fs.writeFileSync(abs, fs.readFileSync(abs, "utf8").replace(/^\s*<!-- kit:adapt: .* -->$/gm, "Adapted by the owner."));
  }
};

/** A finished install without the pm module and without a container. */
const installWithoutPm = (root) => {
  const answers = exampleAnswers({ modules: ["core", "claude", "antigravity", "open-pr", "githooks-pre-push"] });
  answers.flags = { "has.db": true, "has.ui": true, "has.container": false, "has.github": true, "has.pmTool": false };
  delete answers.values.PM_TOOL;
  delete answers.values.PM_SCOPE;
  const r = resolve(answers);
  const plan = planInstall(kit, r, root);
  applyPlan(plan, root);
  resolveAdaptMarkers(root, plan);
  writeManifest(kit, r, root);
  return JSON.parse(fs.readFileSync(path.join(root, MANIFEST_TARGET), "utf8"));
};

/** Add-mode answers: the install's own plus pm, with a PM tool. */
const addPmAnswers = (manifest, extraFlags = {}) => {
  const a = answersFromManifest(manifest);
  a.modules.push("pm");
  a.add = ["pm"];
  a.date = "2026-02-01";
  a.flags = { ...a.flags, "has.pmTool": true, ...extraFlags };
  a.values.PM_TOOL = kit.vocabulary.tokens.PM_TOOL.example;
  a.values.PM_SCOPE = kit.vocabulary.tokens.PM_SCOPE.example;
  return a;
};

/** Stand-in for the installer applying a delta by hand: add the lines the file lacks. */
const applyDeltas = (root, plan) => {
  for (const f of plan.files.filter((x) => x.action === "delta")) {
    const abs = path.join(root, f.target);
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    const lacking = addedLines(f.diff).filter((l) => !lines.includes(l));
    fs.appendFileSync(abs, `${lacking.join("\n")}\n`);
  }
};

describe("lineDiff", () => {
  test("shows added and removed lines with context, and nothing for equal text", () => {
    const a = ["one", "two", "three", "four", "five", "six", "seven"].join("\n");
    const b = ["one", "two", "THREE", "four", "five", "six", "seven", "eight"].join("\n");
    const d = lineDiff(a, b, 1);
    assert.equal(d, ["@@ near line 2 @@", " two", "-three", "+THREE", " four", "@@ near line 7 @@", " seven", "+eight"].join("\n"));
    assert.deepEqual(addedLines(d), ["THREE", "eight"]);
    assert.equal(lineDiff(a, a), "");
  });
});

describe("answersFromManifest", () => {
  test("drops derived values and flags, keeps the install's modules and date", () =>
    withTempRepo((root) => {
      const m = installWithoutPm(root);
      const a = answersFromManifest(m);
      assert.deepEqual(a.modules, m.modules);
      assert.equal(a.date, m.installedAt);
      for (const k of ["KIT_VERSION", "DATE", "CMD_HOOK_TESTS", "VERIFY_COMMANDS_JSON", "CMD_CHECKS"]) assert.ok(!(k in a.values), k);
      assert.ok(!Object.keys(a.flags).some((f) => f.startsWith("module.") || f === "has.checks"));
      assert.deepEqual(resolveAnswers(kit, a).errors, []);
    }));
});

describe("planAdd", () => {
  test("installs only the added module's files, and turns changes to installed files into deltas", () =>
    withTempRepo((root) => {
      const m = installWithoutPm(root);
      const plan = planInstall(kit, resolve(addPmAnswers(m)), root);
      assert.equal(plan.mode, "add");
      assert.deepEqual(plan.add, ["pm"]);
      const by = (action) => plan.files.filter((f) => f.action === action).map((f) => f.target);
      assert.ok(by("create").includes(".agents/personas/pm.md"));
      assert.ok(by("create").includes(".claude/agents/pm.md"));
      assert.ok(by("omit").includes("docs/backlog.md"));
      // AGENTS.md mentions pm behind kit:if module.pm: a delta, never a re-render.
      const agents = plan.files.find((f) => f.target === "AGENTS.md");
      assert.equal(agents.action, "delta");
      assert.equal(agents.content, undefined);
      assert.match(agents.diff, /^\+.*pm/im);
      // Every file the plan names belongs to pm or changes; untouched files are left out.
      assert.ok(!plan.files.some((f) => f.target === ".githooks/pre-push"));
      assert.deepEqual(plan.postInstall, []);
      assert.equal(plan.settings, null);
    }));

  test("a file that applies only now is created; a dated file doesn't show up as a delta", () =>
    withTempRepo((root) => {
      const m = installWithoutPm(root);
      const plan = planInstall(kit, resolve(addPmAnswers(m, { "has.container": true })), root);
      const parity = plan.files.find((f) => f.target === ".agents/rules/production-parity.md");
      assert.equal(parity.action, "create");
      assert.ok(!plan.files.some((f) => f.action === "delta" && /\b2026-02-01\b/.test(f.diff)));
    }));

  test("applying writes the new files and leaves deltas to the installer", () =>
    withTempRepo((root) => {
      const m = installWithoutPm(root);
      const agentsBefore = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
      const r = resolve(addPmAnswers(m));
      const written = applyPlan(planInstall(kit, r, root), root);
      assert.ok(written.includes(".agents/personas/pm.md"));
      assert.ok(!written.includes("AGENTS.md"));
      assert.equal(fs.readFileSync(path.join(root, "AGENTS.md"), "utf8"), agentsBefore);
    }));

  test("refuses a repo without an install, a module already installed and a wrong module list", () =>
    withTempRepo((root) => {
      const bare = exampleAnswers({ add: ["pm"] });
      assert.throws(() => planInstall(kit, resolve(bare), root), /needs an existing install/);
      const m = installWithoutPm(root);
      const again = answersFromManifest(m);
      again.add = ["open-pr"];
      assert.throws(() => planInstall(kit, resolve(again), root), /already installed: open-pr/);
      const wrong = addPmAnswers(m);
      wrong.modules = wrong.modules.filter((id) => id !== "githooks-pre-push");
      assert.throws(() => planInstall(kit, resolve(wrong), root), /must be the installed modules/);
    }));

  test("answers.add is checked against answers.modules", () => {
    const a = exampleAnswers({ add: ["core", "nope"] });
    const errors = resolveAnswers(kit, a).errors.join("\n");
    assert.match(errors, /"core" is part of every install/);
    assert.match(errors, /added module "nope" must also be in answers.modules/);
    assert.match(resolveAnswers(kit, exampleAnswers({ add: [] })).errors.join("\n"), /non-empty array/);
  });
});

describe("add-mode manifest", () => {
  test("pending until the new files are adapted and every delta is applied", () =>
    withTempRepo((root) => {
      const m = installWithoutPm(root);
      const r = resolve(addPmAnswers(m));
      const plan = planInstall(kit, r, root);
      applyPlan(plan, root);
      const p1 = pendingWork(kit, r, root);
      assert.equal(p1.done, false);
      assert.ok(p1.adaptMarkers.some((x) => x.target === ".agents/personas/pm.md"));
      assert.ok(p1.unappliedDeltas.some((x) => x.target === "AGENTS.md"));
      assert.ok(!p1.adaptMarkers.some((x) => x.target === "AGENTS.md"), "installed files aren't re-checked for markers");
      assert.throws(() => writeManifest(kit, r, root), /delta not applied yet: AGENTS.md/);

      resolveAdaptMarkers(root, plan);
      applyDeltas(root, plan);
      assert.equal(pendingWork(kit, r, root).done, true);
    }));

  test("updates the record: new entries, delta hashes, values, flags and history", () =>
    withTempRepo((root) => {
      const m = installWithoutPm(root);
      const r = resolve(addPmAnswers(m));
      const plan = planInstall(kit, r, root);
      applyPlan(plan, root);
      resolveAdaptMarkers(root, plan);
      applyDeltas(root, plan);
      const next = writeManifest(kit, r, root);

      assert.deepEqual(next.modules, ["core", "claude", "antigravity", "open-pr", "githooks-pre-push", "pm"]);
      assert.equal(next.installedAt, m.installedAt);
      assert.deepEqual(next.kit, m.kit);
      assert.equal(next.values.PM_TOOL, kit.vocabulary.tokens.PM_TOOL.example);
      assert.equal(next.values.DATE, m.values.DATE, "the install's derived values stay");
      assert.equal(next.flags["module.pm"], true);
      assert.equal(next.flags["has.pmTool"], true);
      assert.deepEqual(
        next.history.map((h) => [h.action, h.date, h.modules.includes("pm")]),
        [
          ["install", m.installedAt, false],
          ["add", "2026-02-01", true],
        ],
      );
      const pm = next.files.find((f) => f.target === ".agents/personas/pm.md");
      assert.equal(pm.module, "pm");
      assert.equal(pm.kitVersion, undefined, "same kit version: no per-file version");
      const oldAgents = m.files.find((f) => f.target === "AGENTS.md");
      const newAgents = next.files.find((f) => f.target === "AGENTS.md");
      assert.equal(newAgents.rendered, oldAgents.rendered);
      assert.notEqual(newAgents.installed, oldAgents.installed);
      const hook = (x) => x.files.find((f) => f.target === ".githooks/pre-push");
      assert.deepEqual(hook(next), hook(m));
    }));

  test("files from a newer kit carry their kitVersion", () =>
    withTempRepo((root) => {
      const m = installWithoutPm(root);
      m.kit.version = "0.0.1";
      put(root, MANIFEST_TARGET, `${JSON.stringify(m, null, 2)}\n`);
      const r = resolve(addPmAnswers(m));
      const plan = planInstall(kit, r, root);
      assert.equal(plan.installedKitVersion, "0.0.1");
      applyPlan(plan, root);
      resolveAdaptMarkers(root, plan);
      applyDeltas(root, plan);
      const next = writeManifest(kit, r, root);
      assert.equal(next.files.find((f) => f.target === ".agents/personas/pm.md").kitVersion, kit.version);
      assert.equal(next.files.find((f) => f.target === "AGENTS.md").kitVersion, undefined);
      assert.equal(next.history[0].kitVersion, "0.0.1");
    }));
});

describe("CLI in add mode", () => {
  test("manifest answers, render plan and show print the add plan and deltas", () =>
    withTempRepo((root) => {
      installWithoutPm(root);
      const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
      const ans = run(MANIFEST_SCRIPT, "answers", "--repo", root);
      assert.equal(ans.status, 0, ans.stderr);
      const answers = JSON.parse(ans.stdout);
      const file = path.join(root, "..", `${path.basename(root)}-answers.json`);
      try {
        fs.writeFileSync(file, JSON.stringify(addPmAnswers({ ...answers, installedAt: answers.date })));
        const plan = run(RENDER_SCRIPT, "plan", "--answers", file, "--repo", root);
        assert.equal(plan.status, 0, plan.stderr);
        const out = JSON.parse(plan.stdout);
        assert.equal(out.mode, "add");
        assert.ok(out.files.some((f) => f.action === "delta" && f.target === "AGENTS.md"));
        const show = run(RENDER_SCRIPT, "show", "--answers", file, "--repo", root, "--target", "AGENTS.md");
        assert.equal(show.status, 0, show.stderr);
        assert.match(show.stdout, /^@@ near line \d+ @@/);
      } finally {
        fs.rmSync(file, { force: true });
      }
      const none = withTempRepo((empty) => run(MANIFEST_SCRIPT, "answers", "--repo", empty));
      assert.equal(none.status, 1);
      assert.match(none.stderr, /isn't installed there/);
    }));
});
