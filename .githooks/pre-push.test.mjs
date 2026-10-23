// Tests for the pre-push guard (AGENTS.md "Git and PRs"). CI runs them with node --test.
// Git feeds the hook one line per ref: <local ref> <local sha> <remote ref> <remote sha>.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "pre-push");
const SHA = "1111111111111111111111111111111111111111";
const ZERO = "0000000000000000000000000000000000000000";
const line = (remoteRef, localSha = SHA) => `refs/heads/x ${localSha} ${remoteRef} ${SHA}\n`;

const run = (input, env = {}) => {
  const { HARNESS_KIT_ALLOW_PUSH_MAIN: _drop, ...base } = process.env;
  return spawnSync("sh", [HOOK, "origin", "url"], {
    input,
    encoding: "utf8",
    env: { ...base, ...env },
  });
};

describe("pre-push", () => {
  test("allows a feature branch", () =>
    assert.equal(run(line("refs/heads/fredz/feat-x")).status, 0));
  test("refuses main", () => {
    const r = run(line("refs/heads/main"));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing/);
  });
  test("refuses deleting main", () => assert.equal(run(line("refs/heads/main", ZERO)).status, 1));
  test("refuses a mixed push that includes main", () =>
    assert.equal(run(line("refs/heads/fredz/feat-x") + line("refs/heads/main")).status, 1));
  test("allows main with HARNESS_KIT_ALLOW_PUSH_MAIN=1", () =>
    assert.equal(run(line("refs/heads/main"), { HARNESS_KIT_ALLOW_PUSH_MAIN: "1" }).status, 0));
  test("refuses main with HARNESS_KIT_ALLOW_PUSH_MAIN=true", () =>
    assert.equal(run(line("refs/heads/main"), { HARNESS_KIT_ALLOW_PUSH_MAIN: "true" }).status, 1));
  test("allows an empty push", () => assert.equal(run("").status, 0));
  test("is executable", () => assert.ok(fs.statSync(HOOK).mode & 0o111));
});
