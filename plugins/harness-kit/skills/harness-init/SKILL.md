---
name: harness-init
description: Install the harness-kit agentic development harness (AGENTS.md, CLAUDE.md, personas, workflows, rules, guard hooks, memory) into the current repo, adapted to it, on a fresh branch for a PR. Run only when the owner asks for it.
disable-model-invocation: true
argument-hint: "[path to the target repo, default: current directory]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs plan *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs show *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/manifest.mjs check *) Bash(git status *) Bash(git fetch *) Bash(git config --get *) Bash(git diff *) Bash(git log *)
---

# harness-init

Install harness-kit into the target repo (`$ARGUMENTS`, or the current directory). The owner is the human running this session. Everything lands as uncommitted changes on a fresh branch, for a normal PR. The target owns its copy afterwards.

The kit's scripts do the mechanical parts. Never write a rendered file by hand, never edit the kit's templates, and never hand-edit `.agents/harness.json`.

- `node ${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs --repo <repo>`: read-only report (git state, stack, commands, existing harness, suggestions).
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs plan|show|apply --answers <file> --repo <repo>`: validate the answers and render.
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/manifest.mjs check|write --answers <file> --repo <repo>`: what's left to do, then the manifest.

Keep the answers in `${CLAUDE_PLUGIN_DATA}/installs/${CLAUDE_SESSION_ID}/answers.json` (create the folder with `mkdir -p`). It is outside the repo, so it never gets committed.

## Hard rules

- Ask before anything that writes outside the working tree or changes git config. Never commit, push or open a PR without the owner's explicit go-ahead.
- Never overwrite an existing file. The renderer writes the kit's version of an existing file next to it as `<file>.kit-new`; you merge or decide with the owner (step 7).
- A command the renderer rejects (production-reaching, or one bash-guard would block) is never put back by rewording it. Tell the owner why it was rejected and leave it out.
- No production command in any answer: no ssh, deploys, pushes, remote database commands or connection URLs, even if the owner's existing instructions allow them.
- If a script fails, show its error and fix the answers. Don't work around the script.

## 1. Check the starting point

Run `git fetch origin`, then `detect.mjs`, and read `git` in the report. Stop and tell the owner what to do if any of these fail:

- `isRepo` is true.
- `existing.harnessManifest` is null. If the repo already has `.agents/harness.json`, it was installed before; upgrading an install is not supported yet.
- `clean` is true (list `dirty`).
- `branch` is not `main` (or `defaultBranch`), `behindBase` is 0 and `aheadOfBase` is 0: a fresh branch cut from an up-to-date `main`.
- `linkedWorktree` is true. If not, recommend a worktree so the main checkout stays on `main`, and suggest the exact command, for example `git worktree add ../<repo>-harness -b <prefix>/chore-adopt-harness-kit origin/main`. Continue in the main checkout only if the owner says so.

If the repo has no `origin/main` (`base` is null or `main`), say so: the harness assumes GitHub flow on `main`. Ask the owner whether to continue.

## 2. Read the project

From the report and the repo itself, build a short picture: ecosystems and package manager, the check commands (`commands.checks`, with any `rejected` reason), database folders and scripts, container files, UI, the GitHub remote, Git Flow evidence, hook tools (husky, lefthook, pre-commit, an existing `core.hooksPath`), and every existing instruction file (`existing.instructions`, `existing.nestedInstructions`). Read those instruction files in full: their rules get merged in step 7.

A foreign harness (`.claude/agents`, `.claude/commands`, `.claude/hooks`, `.cursor/rules` and similar) is replaced only with the owner's approval, file by file.

## 3. Baseline checks

Run each detected check command marked `ok` in `commands.checks` once, from the repo root, and record pass or fail with a one-line summary. A command that can't run is "not run: <reason>", never "passed". Don't fix failures here; note them for the owner and for `docs/next-steps.md`. Never run a command marked `rejected`.

## 4. Ask the owner

Ask in a few short rounds, offering the detected suggestion as the default each time. Use the owner's wording when they correct you.

1. **Modules.** Read `${CLAUDE_PLUGIN_ROOT}/templates/modules.json`. `core` is always installed. Offer each other module by its `offer` text, only when its `when` flag is true, and respect `requires`. `flow-migration` is offered only when the owner confirms the repo uses Git Flow.
2. **Flags.** Confirm `has.db`, `has.ui`, `has.container`, `has.github` and `flow.gitFlow` with the evidence behind each. The check flags (`has.typecheck`, `has.lint`, `has.test`, `has.checks`) and `module.*` flags are derived; don't ask for them.
3. **Values.** Read `${CLAUDE_PLUGIN_ROOT}/templates/vocabulary.json` for each token's description and pattern. Ask for `PROJECT_NAME`, `OWNER`, `BRANCH_PREFIX`, and confirm `ENV_PREFIX` (derived from the project name if not set). Confirm the check commands, and with `has.db` the `DB_PATH` and each `DB_COMMANDS_JSON` entry (local database only). With `open-pr`: `GH_REPO`, `GH_ACCOUNT` and `RISKY_PATHS_JSON`. Persona display names default to the vocabulary's `default`; offer to change them in one question.
4. **Allow list.** Propose `ALLOW_RULES_JSON` from the local commands found (the checks, install, dev server) plus `Bash(git status)`, `Bash(git diff *)` and `Bash(git log *)`. If you leave it out, the renderer uses the checks plus those three git rules.

Write the answers file:

```json
{
  "modules": ["core", "open-pr", "githooks-pre-push"],
  "date": "YYYY-MM-DD",
  "flags": { "has.db": false, "has.ui": true, "has.container": false, "has.github": true, "flow.gitFlow": false },
  "values": { "PROJECT_NAME": "...", "OWNER": "...", "BRANCH_PREFIX": "...", "CMD_TEST": "..." }
}
```

Leave a `CMD_*` value out when the project has no such command, and leave `when`-gated tokens out when their flag is false. Don't set derived tokens (`KIT_VERSION`, `DATE`, `DATE_YM`, `CMD_CHECKS`, `CMD_HOOK_TESTS`, `VERIFY_COMMANDS_JSON`). Then run `render.mjs plan`. If it fails, explain each error in plain words, ask, update the file and plan again.

## 5. Preview

From the plan, show the owner a table of targets by action: `create`, `unchanged`, `merge` (the kit's version goes to `<file>.kit-new` and you merge it), `kit-new` (an existing file the owner decides on), `skip` and `omit`. Show the settings merge: `conflicts` (the project's value is kept) and `riskyExistingAllow` (existing allow rules that look production-reaching; recommend removing them, but only with approval).

Show the proposed `AGENTS.md` and `CLAUDE.md` before writing anything. Get the kit's version with `render.mjs show --target AGENTS.md` (and `CLAUDE.md`). Where the project already has these files, draft the merge (see step 7) and show that instead. Ask the owner to approve, or adjust and preview again.

## 6. Render

Run `render.mjs apply`. It creates new files, writes `<file>.kit-new` beside existing ones, sets git hook modes and merges the settings fragment into `.claude/settings.json`. Report what it wrote.

## 7. Merge and decide existing files

For each `merge` target (for example `AGENTS.md`, `CLAUDE.md`, `docs/next-steps.md`, `.github/pull_request_template.md`): the kit's `<file>.kit-new` is the skeleton. Fold every rule, fact and command from the project's existing file into the matching section (project rules, do-not list, stack, layout). Drop nothing silently: list what you dropped or rewrote and why. Rules from other providers' files (`.cursorrules`, `.github/copilot-instructions.md` and similar) belong in `AGENTS.md`; ask whether to delete the old file. Write the result to the target and delete the `.kit-new`.

For each `kit-new` target, show the diff and ask: take the kit's version, keep the project's, or merge. Then delete the `.kit-new`.

## 8. Resolve every adapt marker

Each `<!-- kit:adapt: <instruction> -->` marks text only this project can supply. For each marker reported by `manifest.mjs check`, in file order: follow its instruction using the repo, the README, the old instructions and the owner's answers. Ask the owner when the repo doesn't settle it; never invent goals, rollback paths or deploy facts. Replace the marker line with the result (or delete it when its instruction says to). Show the owner each finished section, or batch small ones.

With `flow-migration`, the runbook's markers describe changes to CI workflows. Make each workflow change only with the owner's approval, in this same branch.

Repeat `manifest.mjs check` until it reports `"done": true`: no markers, no `.kit-new` files, nothing missing.

## 9. Verify

Run the rendered harness's tests: the `CMD_HOOK_TESTS` value from the plan (for example `node --test ".claude/hooks/*.test.mjs"`). Rerun the baseline checks and compare with step 3. Report each as passed, failed or "not run: <reason>".

## 10. Manifest

Run `manifest.mjs write`. It refuses while anything is pending. It records the kit version, the modules, the resolved values and flags, and two sha256 hashes per file: `rendered` (the kit's output) and `installed` (the file now).

## 11. Post-install steps

For each `postInstall` entry in the plan, propose it and run it only with approval. Before `git config core.hooksPath .githooks`, read the current value (`git config --get core.hooksPath`) and check `existing.hookTools`. If it is already set to something else (husky, lefthook), show that and ask; never overwrite it silently. Offer to add the harness tests to CI as a follow-up, not in this PR, unless the owner asks.

## 12. Hand off

Summarize: modules installed, files created and merged, decisions the owner made, rejected commands, baseline results, and open items (also written to `docs/next-steps.md`). Propose a Conventional Commit, for example `chore: adopt harness-kit v<version>`, and a PR following the repo's template. Commit, push and open the PR only when the owner says to.
