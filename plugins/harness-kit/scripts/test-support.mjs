// Shared fixtures for the script tests. Not a test file itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DERIVED_TOKENS, loadKit } from "./render.mjs";

export const kit = loadKit();

/** Answers for a full install, built from the vocabulary's generic examples. */
export const exampleAnswers = (overrides = {}) => {
  const ex = (name) => kit.vocabulary.tokens[name].example;
  return {
    modules: ["core", "claude", "antigravity", "open-pr", "githooks-pre-push", "pm"],
    date: "2026-01-15",
    flags: { "has.db": true, "has.ui": true, "has.container": true, "has.github": true, "has.pmTool": true },
    values: Object.fromEntries(
      ["PROJECT_NAME", "OWNER", "BRANCH_PREFIX", "CMD_TYPECHECK", "CMD_LINT", "CMD_TEST", "DB_PATH", "DB_COMMANDS_JSON", "GH_REPO", "GH_ACCOUNT", "RISKY_PATHS_JSON", "PM_TOOL", "PM_SCOPE"].map(
        (n) => [n, ex(n)],
      ),
    ),
    ...overrides,
  };
};

/** The same answers with the backlog in docs/backlog.md instead of a PM tool. */
export const markdownBacklogAnswers = () => {
  const a = exampleAnswers();
  a.flags["has.pmTool"] = false;
  delete a.values.PM_TOOL;
  delete a.values.PM_SCOPE;
  return a;
};

/** Run fn with a fresh temp directory, removed afterwards. */
export const withTempRepo = (fn) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "kit-test-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

/** Write a file under root, creating folders. */
export const put = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

/** Example values for the verification modules' tokens (smoke-local, e2e-verify, db-backup). */
export const verifyModuleValues = () =>
  Object.fromEntries(
    Object.entries(kit.vocabulary.tokens)
      .filter(([name, e]) => /^(VERIFY|SMOKE|E2E|BACKUP)_|^DB_PROVIDER$/.test(name) && !e.when && !DERIVED_TOKENS.includes(name))
      .map(([name, e]) => [name, e.example]),
  );
