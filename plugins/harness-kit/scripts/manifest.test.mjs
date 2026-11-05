// Tests for the install manifest (manifest.mjs).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildManifest, MANIFEST_TARGET, pendingWork, writeManifest } from "./manifest.mjs";
import { applyPlan, KIT_NEW, planInstall, resolveAnswers, sha256 } from "./render.mjs";
import { exampleAnswers, kit, put, withTempRepo } from "./test-support.mjs";

const SCRIPT = fileURLToPath(new URL("./manifest.mjs", import.meta.url));

const resolved = () => {
  const r = resolveAnswers(kit, exampleAnswers());
  assert.deepEqual(r.errors, []);
  return r;
};

/** Stand-in for the skill's adapt step: replace every kit:adapt marker line. */
const resolveAdaptMarkers = (root, plan) => {
  for (const f of plan.files.filter((x) => x.adapt && x.action !== "omit")) {
    const abs = path.join(root, f.target);
    const text = fs.readFileSync(abs, "utf8").replace(/^\s*<!-- kit:adapt: .* -->$/gm, "Adapted by the owner.");
    fs.writeFileSync(abs, text);
  }
};

describe("pendingWork", () => {
  test("lists missing files, adapt markers and .kit-new files until they are dealt with", () =>
    withTempRepo((root) => {
      const r = resolved();
      const before = pendingWork(kit, r, root);
      assert.equal(before.done, false);
      assert.ok(before.missing.includes("AGENTS.md"));
      assert.ok(before.missing.includes(".claude/settings.json"));

      put(root, "CLAUDE.md", "# ours\n");
      const plan = planInstall(kit, r, root);
      applyPlan(plan, root);
      const after = pendingWork(kit, r, root);
      assert.deepEqual(after.missing, []);
      assert.deepEqual(after.kitNew, [`CLAUDE.md${KIT_NEW}`]);
      assert.ok(after.adaptMarkers.some((m) => m.target === "AGENTS.md" && m.instruction.startsWith("Describe the project")));
      const adaptTargets = new Set(after.adaptMarkers.map((m) => m.target));
      const flagged = new Set(plan.files.filter((f) => f.adapt && f.action !== "omit").map((f) => f.target));
      assert.deepEqual([...adaptTargets].sort(), [...flagged].sort());

      resolveAdaptMarkers(root, plan);
      fs.rmSync(path.join(root, `CLAUDE.md${KIT_NEW}`));
      assert.equal(pendingWork(kit, r, root).done, true);
    }));
});

describe("buildManifest and writeManifest", () => {
  test("refuses an unfinished install", () =>
    withTempRepo((root) => {
      const r = resolved();
      applyPlan(planInstall(kit, r, root), root);
      assert.throws(() => buildManifest(kit, r, root), /not finished[\s\S]*kit:adapt left: AGENTS.md:/);
      assert.ok(!fs.existsSync(path.join(root, MANIFEST_TARGET)));
    }));

  test("records the kit, modules, values and both hashes of every installed file", () =>
    withTempRepo((root) => {
      const r = resolved();
      const plan = planInstall(kit, r, root);
      applyPlan(plan, root);
      resolveAdaptMarkers(root, plan);
      const m = writeManifest(kit, r, root);
      const onDisk = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_TARGET), "utf8"));
      assert.deepEqual(onDisk, m);

      assert.equal(m.schemaVersion, 1);
      assert.deepEqual(m.kit, { name: "harness-kit", version: kit.version });
      assert.equal(m.installedAt, "2026-01-15");
      assert.deepEqual(m.modules, ["core", "open-pr", "githooks-pre-push"]);
      assert.equal(m.values.PROJECT_NAME, "Example App");
      assert.equal(m.flags["has.db"], true);

      const installed = plan.files.filter((f) => f.action !== "omit");
      assert.equal(m.files.length, installed.length);
      const targets = m.files.map((f) => f.target);
      assert.deepEqual(targets, [...targets].sort());
      assert.ok(!targets.includes(MANIFEST_TARGET));
      for (const f of m.files) {
        const p = installed.find((x) => x.target === f.target);
        assert.equal(f.rendered, p.sha256, f.target);
        assert.equal(f.installed, sha256(fs.readFileSync(path.join(root, f.target), "utf8")), f.target);
        assert.equal(f.rendered === f.installed, !p.adapt, `${f.target}: only adapted files differ`);
        assert.match(f.rendered, /^sha256:[0-9a-f]{64}$/);
      }
      assert.equal(m.files.find((f) => f.target === ".githooks/pre-push").mode, "0755");
      assert.deepEqual(m.settings.fragments, ["core/settings.fragment.json.tmpl"]);
      assert.equal(m.settings.installed, sha256(fs.readFileSync(path.join(root, ".claude/settings.json"), "utf8")));
    }));
});

describe("CLI", () => {
  test("check exits 1 while work is pending, write refuses, then both succeed", () =>
    withTempRepo((root) => {
      const repo = path.join(root, "repo");
      fs.mkdirSync(repo);
      const answers = path.join(root, "answers.json");
      fs.writeFileSync(answers, JSON.stringify(exampleAnswers()));
      const run = (cmd) => spawnSync(process.execPath, [SCRIPT, cmd, "--answers", answers, "--repo", repo], { encoding: "utf8" });

      const r = resolved();
      const plan = planInstall(kit, r, repo);
      applyPlan(plan, repo);
      const check = run("check");
      assert.equal(check.status, 1);
      assert.equal(JSON.parse(check.stdout).done, false);
      const refused = run("write");
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /not finished/);

      resolveAdaptMarkers(repo, plan);
      assert.equal(run("check").status, 0);
      const write = run("write");
      assert.equal(write.status, 0, write.stderr);
      assert.match(write.stdout, /wrote \.agents\/harness\.json/);
    }));
});
