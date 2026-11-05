// Tests for project detection (detect.mjs), on throwaway git repos.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyCommand,
  detect,
  detectCommands,
  detectPackageManager,
  githubRepoFrom,
  scriptCommand,
} from "./detect.mjs";
import { kit, put, withTempRepo } from "./test-support.mjs";

const SCRIPT = fileURLToPath(new URL("./detect.mjs", import.meta.url));

const sh = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

/** A git repo on main with one commit, plus a bare origin that has main pushed. */
const gitRepo = (root) => {
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  sh(root, "init", "-q", "--bare", "-b", "main", origin);
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.name", "Test Owner");
  sh(repo, "config", "user.email", "owner@example.com");
  sh(repo, "config", "commit.gpgsign", "false");
  put(repo, "README.md", "# demo\n");
  sh(repo, "add", ".");
  sh(repo, "commit", "-q", "-m", "init");
  sh(repo, "remote", "add", "origin", origin);
  sh(repo, "push", "-q", "origin", "main");
  return repo;
};

describe("helpers", () => {
  test("githubRepoFrom reads https, ssh and scp-style remotes", () => {
    assert.equal(githubRepoFrom("https://github.com/acme/app.git"), "acme/app");
    assert.equal(githubRepoFrom("https://token@github.com/acme/app"), "acme/app");
    assert.equal(githubRepoFrom("git@github.com:acme/my.app.git"), "acme/my.app");
    assert.equal(githubRepoFrom("ssh://git@github.com/acme/app.git"), "acme/app");
    assert.equal(githubRepoFrom("https://gitlab.com/acme/app.git"), null);
    assert.equal(githubRepoFrom(null), null);
  });

  test("package manager comes from packageManager, then lockfiles", () =>
    withTempRepo((root) => {
      assert.equal(detectPackageManager(root, null), null);
      assert.deepEqual(detectPackageManager(root, {}), { name: "npm", source: "default" });
      put(root, "pnpm-lock.yaml", "");
      assert.equal(detectPackageManager(root, {}).name, "pnpm");
      assert.deepEqual(detectPackageManager(root, { packageManager: "yarn@4.1.0" }), { name: "yarn", source: "packageManager" });
    }));

  test("scriptCommand uses the package manager's own test shortcut", () => {
    assert.equal(scriptCommand("npm", "test"), "npm test");
    assert.equal(scriptCommand("npm", "lint"), "npm run lint");
    assert.equal(scriptCommand("bun", "test"), "bun run test");
  });

  test("commands are classified the way render checks them", () => {
    assert.deepEqual(classifyCommand(kit, "npm test"), { command: "npm test", ok: true, rejected: null, reason: null });
    const deploy = classifyCommand(kit, "npm run deploy");
    assert.equal(deploy.ok, false);
    assert.equal(deploy.rejected, "production");
    assert.equal(classifyCommand(kit, "npm run db:push", "item").rejected, "production");
  });

  test("detectCommands finds checks and database scripts and skips npm's placeholder test", () => {
    const pkg = {
      scripts: {
        "type-check": "tsc --noEmit",
        lint: "eslint .",
        test: 'echo "Error: no test specified" && exit 1',
        "db:generate": "x",
        "db:push": "x",
        "migrate:local": "x",
        seed: "x",
        build: "x",
      },
    };
    const { checks, db } = detectCommands(kit, pkg, "npm");
    assert.equal(checks.typecheck.command, "npm run type-check");
    assert.equal(checks.lint.command, "npm run lint");
    assert.equal(checks.test, null);
    assert.deepEqual(
      db.map((c) => [c.command, c.ok]),
      [
        ["npm run db:generate", true],
        ["npm run db:push", false],
        ["npm run migrate:local", true],
        ["npm run seed", true],
      ],
    );
  });
});

describe("detect", () => {
  test("a plain folder is reported as not a repo, without throwing", () =>
    withTempRepo((root) => {
      const r = detect(root, kit);
      assert.equal(r.git.isRepo, false);
      assert.equal(r.suggestions.values.PROJECT_NAME, path.basename(root));
      assert.equal(r.suggestions.flags["flow.gitFlow"], false);
    }));

  test("a node project on a fresh branch", () =>
    withTempRepo((root) => {
      const repo = gitRepo(root);
      sh(repo, "remote", "set-url", "origin", path.join(root, "origin.git"));
      put(repo, "package.json", JSON.stringify({
        name: "@acme/shop",
        packageManager: "pnpm@9.0.0",
        scripts: { typecheck: "tsc", lint: "eslint .", test: "node --test", "db:migrate:local": "x", "deploy": "x" },
        dependencies: { react: "19" },
      }));
      put(repo, "Dockerfile", "FROM node\n");
      put(repo, "prisma/schema.prisma", "");
      put(repo, ".github/workflows/ci.yml", "on:\n  push:\n    branches: [main]\n");
      put(repo, "CLAUDE.md", "# old\n");
      put(repo, "packages/api/AGENTS.md", "# api\n");
      sh(repo, "add", ".");
      sh(repo, "commit", "-q", "-m", "app");
      sh(repo, "push", "-q", "origin", "main");
      sh(repo, "fetch", "-q", "origin");
      sh(repo, "switch", "-q", "-c", "owner/chore-install-harness");

      const r = detect(repo, kit);
      assert.equal(r.git.isRepo, true);
      assert.equal(r.git.branch, "owner/chore-install-harness");
      assert.equal(r.git.clean, true);
      assert.equal(r.git.base, "origin/main");
      assert.equal(r.git.behindBase, 0);
      assert.equal(r.git.aheadOfBase, 0);
      assert.equal(r.git.linkedWorktree, false);
      assert.equal(r.git.hooksPath, null);
      assert.equal(r.packageManager.name, "pnpm");
      assert.deepEqual(r.ecosystems, [{ name: "node", file: "package.json" }]);
      const v = r.suggestions.values;
      assert.equal(v.PROJECT_NAME, "shop");
      assert.equal(v.OWNER, "Test Owner");
      assert.equal(v.CMD_TYPECHECK, "pnpm run typecheck");
      assert.equal(v.CMD_TEST, "pnpm test");
      assert.equal(v.DB_PATH, "prisma/");
      assert.deepEqual(v.DB_COMMANDS_JSON, ["pnpm run db:migrate:local"]);
      assert.deepEqual(v.RISKY_PATHS_JSON, [".github/workflows/", "Dockerfile", "prisma/"]);
      assert.equal(v.GH_REPO, null, "a local origin is not GitHub");
      const f = r.suggestions.flags;
      assert.equal(f["has.db"], true);
      assert.equal(f["has.ui"], true);
      assert.equal(f["has.container"], true);
      assert.equal(f["has.github"], false);
      assert.deepEqual(r.existing.instructions, ["CLAUDE.md"]);
      assert.deepEqual(r.existing.nestedInstructions, ["packages/api/AGENTS.md"]);
      assert.equal(r.existing.harnessManifest, null);
    }));

  test("dirty trees, stale branches, hooks and a previous install are reported", () =>
    withTempRepo((root) => {
      const repo = gitRepo(root);
      sh(repo, "switch", "-q", "-c", "owner/old");
      // main moves on after the branch was cut.
      const other = path.join(root, "other");
      sh(root, "clone", "-q", path.join(root, "origin.git"), other);
      sh(other, "config", "user.name", "x");
      sh(other, "config", "user.email", "x@example.com");
      sh(other, "commit", "-q", "--allow-empty", "-m", "later");
      sh(other, "push", "-q", "origin", "main");
      sh(repo, "fetch", "-q", "origin");
      put(repo, "scratch.txt", "x");
      put(repo, ".husky/pre-commit", "");
      put(repo, ".agents/harness.json", JSON.stringify({ kit: { version: "0.1.0" }, modules: ["core"] }));
      sh(repo, "config", "core.hooksPath", ".husky");

      const r = detect(repo, kit);
      assert.equal(r.git.clean, false);
      assert.ok(r.git.dirty.some((l) => l.includes("scratch.txt")));
      assert.equal(r.git.behindBase, 1);
      assert.equal(r.git.hooksPath, ".husky");
      assert.deepEqual(r.existing.hookTools, [".husky"]);
      assert.deepEqual(r.existing.harnessManifest, { kitVersion: "0.1.0", modules: ["core"] });
    }));

  test("Git Flow: a dev branch on origin and workflows that name it", () =>
    withTempRepo((root) => {
      const repo = gitRepo(root);
      put(repo, ".github/workflows/deploy.yml", "on:\n  push:\n    branches: [dev]\n");
      put(repo, ".github/workflows/ci.yml", "on:\n  pull_request:\n    branches:\n      - main\n");
      sh(repo, "add", ".");
      sh(repo, "commit", "-q", "-m", "wf");
      sh(repo, "push", "-q", "origin", "main:dev");
      sh(repo, "fetch", "-q", "origin");
      const r = detect(repo, kit);
      assert.equal(r.suggestions.flags["flow.gitFlow"], true);
      assert.deepEqual(r.suggestions.evidence.gitFlow, {
        candidate: true,
        branches: ["origin/dev"],
        workflows: [".github/workflows/deploy.yml"],
      });
    }));

  test("the CLI prints JSON", () =>
    withTempRepo((root) => {
      const r = spawnSync(process.execPath, [SCRIPT, "--repo", root], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).git.isRepo, false);
    }));
});
