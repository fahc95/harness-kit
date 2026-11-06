---
name: harness-init
description: Install the harness-kit agentic development harness (AGENTS.md, GEMINI.md, CLAUDE.md, personas, skills, rules, guard hooks, memory) into the current repo, adapted to it, on a fresh branch for a PR. Run only when the owner asks for it.
disable-model-invocation: true
argument-hint: "[path to the target repo, default: current directory]"
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/detect.mjs *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs plan *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs show *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/manifest.mjs check *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/manifest.mjs answers *) Bash(git status *) Bash(git fetch *) Bash(git config --get *) Bash(git diff *) Bash(git log *)
---

# harness-init

Install harness-kit into the target repo (`$ARGUMENTS`, or the current directory). The owner is the human running this session. Everything lands as uncommitted changes on a fresh branch, for a normal PR. The target owns its copy afterwards.

The kit's scripts do the mechanical parts. Never write a rendered file by hand, never edit the kit's templates, and never hand-edit `.agents/harness.json`.

Resolve the plugin root (`<kit-root>`) as `${CLAUDE_PLUGIN_ROOT}` when set (Claude Code), or as the `plugins/harness-kit` directory two levels above this `SKILL.md` file (Antigravity):

- `node <kit-root>/scripts/detect.mjs --repo <repo>` ([detect.mjs](../../scripts/detect.mjs)): read-only report (git state, stack, commands, existing harness, suggestions).
- `node <kit-root>/scripts/render.mjs plan|show|apply --answers <file> --repo <repo>` ([render.mjs](../../scripts/render.mjs)): validate the answers and render.
- `node <kit-root>/scripts/manifest.mjs check|write --answers <file> --repo <repo>` ([manifest.mjs](../../scripts/manifest.mjs)): what's left to do, then the manifest.

Keep the answers in `${CLAUDE_PLUGIN_DATA}/installs/${CLAUDE_SESSION_ID}/answers.json` when `CLAUDE_PLUGIN_DATA` is set (create the folder with `mkdir -p`), or in a temp folder created with `mktemp -d "${TMPDIR:-/tmp}/harness-kit-XXXXXX"` (or the session's artifact scratch directory in Antigravity). It is outside the repo, so it never gets committed.

## Hard rules

- Ask before anything that writes outside the working tree or changes git config. Never commit, push or open a PR without the owner's explicit go-ahead.
- Never overwrite an existing file. The renderer writes the kit's version of an existing file next to it as `<file>.kit-new`; you merge or decide with the owner (step 7).
- A command the renderer rejects (production-reaching, or one bash-guard would block) is never put back by rewording it. Tell the owner why it was rejected and leave it out.
- No production command in any answer: no ssh, deploys, pushes, remote database commands or connection URLs, even if the owner's existing instructions allow them.
- If a script fails, show its error and fix the answers. Don't work around the script.

## 1. Check the starting point

Run `git fetch origin`, then `detect.mjs`, and read `git` in the report. Stop and tell the owner what to do if any of these fail:

- `isRepo` is true.
- `existing.harnessManifest` is null. If the repo already has `.agents/harness.json`, it was installed before: follow [Add modules to an existing install](#add-modules-to-an-existing-install) instead of steps 2 to 10. Upgrading an install's existing files to a newer kit is not supported yet.
- `clean` is true (list `dirty`).
- `branch` is not `main` (or `defaultBranch`), `behindBase` is 0 and `aheadOfBase` is 0: a fresh branch cut from an up-to-date `main`.
- `linkedWorktree` is true. If not, recommend a worktree so the main checkout stays on `main`, and suggest the exact command, for example `git worktree add ../<repo>-harness -b <prefix>/chore-adopt-harness-kit origin/main`. Continue in the main checkout only if the owner says so.

If the repo has no `origin/main` (`base` is null or `main`), say so: the harness assumes GitHub flow on `main`. Ask the owner whether to continue.

## 2. Read the project

From the report and the repo itself, build a short picture: ecosystems and package manager, the check commands (`commands.checks`, with any `rejected` reason), database folders and scripts, container files, UI, the GitHub remote, Git Flow evidence, hook tools (husky, lefthook, pre-commit, an existing `core.hooksPath`), and every existing instruction file (`existing.instructions`, `existing.nestedInstructions`). Read those instruction files in full: their rules get merged in step 7.

A foreign harness (`.claude/agents`, `.claude/commands`, `.claude/hooks`, `.agents/hooks.json`, `.cursor/rules` and similar) is replaced only with the owner's approval, file by file.

## 3. Baseline checks

Run each detected check command marked `ok` in `commands.checks` once, from the repo root, and record pass or fail with a one-line summary. A command that can't run is "not run: <reason>", never "passed". Don't fix failures here; note them for the owner and for `docs/next-steps.md`. Never run a command marked `rejected`.

## 4. Ask the owner

Ask in a few short rounds, offering the detected suggestion as the default each time. Use the owner's wording when they correct you.

1. **Modules.** Read `<kit-root>/templates/modules.json` ([modules.json](../../templates/modules.json)). `core` is always installed. Ask which provider adapter modules to install (`claude`, `antigravity`, or both; at least one is required, and both are offered by default). Offer each other module by its `offer` text, only when its `when` flag is true, and respect `requires`. `flow-migration` is offered only when the owner confirms the repo uses Git Flow.
2. **Flags.** Confirm `has.db`, `has.ui`, `has.container`, `has.github` and `flow.gitFlow` with the evidence behind each. The check flags (`has.typecheck`, `has.lint`, `has.test`, `has.checks`) and `module.*` flags are derived; don't ask for them.
3. **Values.** Read `<kit-root>/templates/vocabulary.json` ([vocabulary.json](../../templates/vocabulary.json)) for each token's description and pattern. Ask for `PROJECT_NAME`, `OWNER`, `BRANCH_PREFIX`, and confirm `ENV_PREFIX` (derived from the project name if not set). Confirm the check commands, and with `has.db` the `DB_PATH` and each `DB_COMMANDS_JSON` entry (local database only). With `open-pr`: `GH_REPO`, `GH_ACCOUNT` and `RISKY_PATHS_JSON`. Persona display names default to the vocabulary's `default`; offer to change them in one question.
4. **PM tool** (only with the `pm` module). Ask where the backlog should live. The default is Linear; Notion, Jira, GitHub Issues or any other tool with an MCP server work too (`existing.mcpServers` lists project-scoped servers from `.mcp.json` and `.agents/mcp_config.json` as a hint). For a tool, set `has.pmTool` to true, `PM_TOOL` to its name, and `PM_SCOPE` to where this project's items live (a project, team, board or database). Ask for the scope even when the workspace looks dedicated, because the persona filters every query by it. Tell the owner the persona reaches the tool only through its MCP server, signed in with their own OAuth login, and that no token goes in any file. Check that the server is connected in this session: if its tools aren't available, give the owner the steps to connect it (in Antigravity, the Plugins Manager or `.agents/mcp_config.json`; in Claude Code, a claude.ai connector or `claude mcp add`), and go on with the install anyway. If the owner wants no PM tool, set `has.pmTool` to false: the backlog becomes `docs/backlog.md`, which the persona manages as plain Markdown.
5. **Allow list** (only with the `claude` module). Propose `ALLOW_RULES_JSON` from the local commands found (the checks, install, dev server) plus `Bash(git status)`, `Bash(git diff *)` and `Bash(git log *)`. If you leave it out, the renderer uses the checks plus those three git rules.

Write the answers file:

```json
{
  "modules": ["core", "claude", "antigravity", "open-pr", "githooks-pre-push"],
  "date": "YYYY-MM-DD",
  "flags": { "has.db": false, "has.ui": true, "has.container": false, "has.github": true, "flow.gitFlow": false },
  "values": { "PROJECT_NAME": "...", "OWNER": "...", "BRANCH_PREFIX": "...", "CMD_TEST": "..." }
}
```

Leave a `CMD_*` value out when the project has no such command, and leave `when`-gated tokens out when their flag is false. Don't set derived tokens (`KIT_VERSION`, `DATE`, `DATE_YM`, `CMD_CHECKS`, `CMD_HOOK_TESTS`, `VERIFY_COMMANDS_JSON`). Then run `render.mjs plan`. If it fails, explain each error in plain words, ask, update the file and plan again.

## 5. Preview

From the plan, show the owner a table of targets by action: `create`, `unchanged`, `merge` (the kit's version goes to `<file>.kit-new` and you merge it), `kit-new` (an existing file the owner decides on), `skip` and `omit`. When `claude` is selected, show the settings merge: `conflicts` (the project's value is kept) and `riskyExistingAllow` (existing allow rules that look production-reaching; recommend removing them, but only with approval).

Show the proposed `AGENTS.md` (plus `GEMINI.md` if `antigravity` is selected, and `CLAUDE.md` if `claude` is selected) before writing anything. Get the kit's version with `render.mjs show --target AGENTS.md` (and `GEMINI.md` / `CLAUDE.md`). Where the project already has these files, draft the merge (see step 7) and show that instead. Ask the owner to approve, or adjust and preview again.

## 6. Render

Run `render.mjs apply`. It creates new files, writes `<file>.kit-new` beside existing ones, sets git hook modes and, when `claude` is selected, merges the settings fragment into `.claude/settings.json`. Report what it wrote.

## 7. Merge and decide existing files

For each `merge` target (for example `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, `docs/next-steps.md`, `docs/backlog.md`, `.github/pull_request_template.md`): the kit's `<file>.kit-new` is the skeleton. Fold every rule, fact and command from the project's existing file into the matching section (project rules, do-not list, stack, layout). Drop nothing silently: list what you dropped or rewrote and why. Rules from other providers' files (`.cursorrules`, `.github/copilot-instructions.md` and similar) belong in `AGENTS.md`; ask whether to delete the old file. Write the result to the target and delete the `.kit-new`.

For each `kit-new` target, show the diff and ask: take the kit's version, keep the project's, or merge. Then delete the `.kit-new`.

With the `pm` module, open work moves to the backlog. While merging `docs/next-steps.md`, move every open-work item (TODO lists, ideas, known bugs) out of the handoff: into `docs/backlog.md` with `has.pmTool` false, or, with a PM tool, into a list you show the owner at hand-off, to file with `/pm intake` once the install merges. Never create items in the PM tool during the install.

## 8. Resolve every adapt marker

Each `<!-- kit:adapt: <instruction> -->` marks text only this project can supply. For each marker reported by `manifest.mjs check`, in file order: follow its instruction using the repo, the README, the old instructions and the owner's answers. Ask the owner when the repo doesn't settle it; never invent goals, rollback paths or deploy facts. Replace the marker line with the result (or delete it when its instruction says to). Show the owner each finished section, or batch small ones.

With `flow-migration`, the runbook's markers describe changes to CI workflows. Make each workflow change only with the owner's approval, in this same branch.

Repeat `manifest.mjs check` until it reports `"done": true`: no markers, no `.kit-new` files, nothing missing.

## 9. Verify

Run the rendered harness's tests: the `CMD_HOOK_TESTS` value from the plan (for example `node --test ".claude/hooks/*.test.mjs" ".agents/hooks/*.test.mjs"`). Rerun the baseline checks and compare with step 3. Report each as passed, failed or "not run: <reason>".

## 10. Manifest

Run `manifest.mjs write`. It refuses while anything is pending. It records the kit version, the modules, the resolved values and flags, and two sha256 hashes per file: `rendered` (the kit's output) and `installed` (the file now).

## 11. Post-install steps

For each `postInstall` entry in the plan, propose it and run it only with approval. Before `git config core.hooksPath .githooks`, read the current value (`git config --get core.hooksPath`) and check `existing.hookTools`. If it is already set to something else (husky, lefthook), show that and ask; never overwrite it silently. Offer to add the harness tests to CI as a follow-up, not in this PR, unless the owner asks.

## 12. Hand off

Summarize: modules installed, files created and merged, decisions the owner made, rejected commands, baseline results, and open items (also written to `docs/next-steps.md`). Propose a Conventional Commit, for example `chore: adopt harness-kit v<version>`, and a PR following the repo's template. Commit, push and open the PR only when the owner says to.

## Add modules to an existing install

For a repo that already has `.agents/harness.json` (ADR-005). Step 1's other checks still apply: a clean, fresh branch, ideally in a worktree, for example `<prefix>/chore-add-<module>`.

1. **Starting answers.** Run `node <kit-root>/scripts/manifest.mjs answers --repo <repo>` and save the output as the answers file. It holds the install's modules, values, flags and date. Tell the owner which kit version installed the repo (`existing.harnessManifest.kitVersion`) and which version is running.
2. **Pick modules.** Offer each module from `modules.json` that isn't installed, by its `offer` text, as in step 4 of the full install (respect `when` and `requires`). Add the chosen ids to `modules` and list them in `add`. Read the project (step 2) only as far as the new modules need.
3. **Flags and values.** Ask only what the new modules need: their tokens from `vocabulary.json`, and any flag they depend on that is false or stale in the recorded answers (for example `has.container` when a `Dockerfile` arrived after the install). Show the detect evidence. Leave every other recorded value as it is.
4. **Plan.** Run `render.mjs plan`. Show the owner a table by action: the added modules' files (`create`, `merge`, `kit-new`, `skip`), installed files that apply only now, `delta` files, `missing` files (a delta whose target the project deleted: ask whether to recreate it) and `retired` files (they no longer apply; the owner decides whether to delete them). For each delta, show `render.mjs show --target <file>`: a line diff between the file as the kit rendered it before and with the new answers.
5. **Render.** Run `render.mjs apply`. It writes the new files and `.kit-new` files and merges the added settings fragments. It never touches a delta file.
6. **Apply the deltas.** For each delta, make the same change in the installed file by hand, fitted to how the project adapted it, and show the owner the result. Then merge `.kit-new` files and resolve `kit:adapt` markers in the new files (steps 7 and 8).
7. **Finish.** Repeat `manifest.mjs check` until `"done": true` (it also lists `unappliedDeltas`). Run the harness tests and the baseline checks (step 9), then `manifest.mjs write`, which updates the record and its `history`. Then steps 11 and 12 for the added modules, with a commit like `chore: add <module> from harness-kit v<version>`.
