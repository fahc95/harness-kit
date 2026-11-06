# Decisions (harness-kit)

Append-only ADR log for decisions about the kit itself. Decisions about the harness's shape are summarized in [design.md](design.md) and made in the reference implementation first. Grep this file for the topic; never read the whole log.

---

## ADR-001: The Kit Distributes the Harness as One Installer Plus Inert Templates
**Date**: 2026-10-23
**Status**: Accepted

**Context**: The harness was built and tested in Mi Súper App. Reusing it elsewhere meant copying files by hand. Mi Súper's ADR-032, which Freddy accepted on 2026-10-23, decided to distribute it through this repo.

**Decision**:
1. This public repo is both the marketplace and the home of one plugin, `plugins/harness-kit/`, using the documented subfolder layout rather than a `"./"` self-source.
2. The plugin registers one user-invoked skill, `/harness-kit:harness-init`, plus inert templates. No agents, hooks or commands are registered globally.
3. The installer copies and adapts templates into a target repo through a PR, and writes `.agents/harness.json`.
4. Mi Súper App stays the reference implementation; improvements are upstreamed here deliberately.

**Alternatives considered**: live plugin agents and hooks (global scope, can't be adapted per project); a loose personal skill (no versioning); a git submodule or symlinks (fragile across worktrees and WSL, not adaptable).

**Consequences**:
- Easier: one versioned install path; each project keeps an editable copy.
- Harder: two places to evolve, so drift is a risk, mitigated by the manifest and deliberate upstreaming. Targets need Node 22 for the `.mjs` hooks.

---

## ADR-002: Template Contract: Vocabulary, Syntax and Path Mapping
**Date**: 2026-10-24
**Status**: Accepted (Freddy, 2026-10-24)

**Context**: The plan fixes the template syntax (`{{TOKENS}}`, `kit:if` blocks, `kit:adapt` markers) but not the token list, how values enter code, or how a template path maps to a target path. Phase 2 writes the templates before the Phase 3 renderer exists, so both need a contract they can be checked against now.

**Decision**:
1. `templates/vocabulary.json` declares every token (type, pattern, source, generic example) and every flag. A lint test (`plugins/harness-kit/scripts/template-lint.test.mjs`) rejects unknown, unused or misplaced ones. Details in [templates.md](templates.md).
2. Every non-array token has an implicit `NAME_JSON` twin. `.mjs` and `.json` templates use only `_JSON` tokens, so a value lands as a JSON literal, never as code, raw regex or a broken string. Shell and YAML templates use only `identifier` tokens.
3. `kit:if` accepts a `!` negation (`<!-- kit:if !has.db -->`), so a template can carry both variants of a sentence without nesting.
4. `templates/modules.json` and `templates/vocabulary.json` are the only files under `templates/` without a `.tmpl` suffix. They are data that nothing auto-loads.
5. Target path = template path minus the module root and `.tmpl`, with each `dot-<x>` segment turned into `.<x>`.

**Alternatives considered**: raw string substitution into `.mjs` (a value could inject code or regex); listing tokens only in prose (drifts from the templates); `.json.tmpl` for the data files (they would need a render step just to be read).

**Consequences**:
- Easier: Phase 3's render script has a fixed contract, and every Phase 2 PR is checked mechanically without it.
- Harder: a new token or flag needs a vocabulary entry in the same PR as its first use.

---

## ADR-003: The Installer Never Overwrites a File, and the Manifest Keeps Two Hashes
**Date**: 2026-11-05
**Status**: Proposed

**Context**: ADR-002 fixes how templates render, but not what happens when a target file already exists, how settings fragments land, or what `.agents/harness.json` records. Phase 3 needs all three, and a later sync needs to tell kit changes from project changes.

**Decision**:
1. `render.mjs` never overwrites an existing file. For `onExisting: merge` and `kit-new`, it writes the kit's version beside the file as `<target>.kit-new`. The installer skill merges `merge` targets with the owner, and asks the owner about each `kit-new` target. `skip` keeps the file. A file identical to the render is `unchanged`.
2. Settings fragments merge into `.claude/settings.json` key by key: arrays gain the fragment's missing items, and where a scalar differs the project's value stays and the clash is shown. Existing allow rules that match the production list are shown, never removed silently.
3. Answers hold only detected and owner-confirmed values. The renderer derives `KIT_VERSION`, `DATE`, `DATE_YM`, `CMD_CHECKS`, `CMD_HOOK_TESTS`, `VERIFY_COMMANDS_JSON`, the check flags and the `module.*` flags, and rejects answers that try to set them.
4. `.agents/harness.json` records the kit version, modules, the resolved values and flags, and per file a `rendered` hash (the kit's output) and an `installed` hash (the file at install). The manifest is written only when no `kit:adapt` marker, `.kit-new` file or missing target remains.
5. The contract helpers live in `scripts/contract.mjs`, shared by the renderer and the template lint.

**Alternatives considered**: overwrite with a backup (a silent change to a file the owner didn't review); a staging folder (harder to diff beside the original); one hash per file (a sync couldn't tell an adapted file from a kit change without re-rendering and diffing); storing only the answers (a sync would re-derive values with newer kit code).

**Consequences**:
- Easier: a brownfield install can't lose project content; a sync can re-render the old version from the stored values and compare both hashes.
- Harder: the skill must clear every `.kit-new` file before the manifest can be written. The manifest holds the project's commands and names, which is fine in a repo but must never hold secrets.

---

## ADR-004: Multi-Provider Adapters (`claude` and `antigravity`) and Universal `.agents/skills/` Playbooks
**Date**: 2026-11-05
**Status**: Proposed

**Context**: `.agents/` and `AGENTS.md` hold the provider-agnostic harness, while provider-specific wiring originally lived inside `core` for Claude Code only (`CLAUDE.md`, `.claude/**`, `.claude/settings.json`), and playbooks lived in `.agents/workflows/*.md`. Google Antigravity natively discovers `AGENTS.md`, `.agents/rules/*.md`, `.agents/skills/<name>/SKILL.md` (with `/<name>` slash command support; `.agents/workflows/` is deprecated in Antigravity), and `.agents/hooks.json` (using a camelCase `PreToolUse` JSON contract on stdin/stdout).

**Decision**:
1. `core` holds only the universal `.agents/` and `AGENTS.md` files (`AGENTS.md`, `docs/next-steps.md`, `.agents/memory/*`, `.agents/personas/*`, `.agents/rules/*`, and `.agents/skills/{plan,review,feature,retro}/SKILL.md`).
2. Provider adapters are selectable modules in `modules.json` (`claude` with flag `module.claude`, and `antigravity` with flag `module.antigravity`), both enabled by default. `resolveAnswers` requires at least one provider adapter.
3. The `antigravity` module installs `GEMINI.md` (wiring `.agents/personas/` to `define_subagent` and `invoke_subagent`), `.agents/hooks.json`, and `.agents/hooks/agy-guard.mjs` (plus `agy-guard.test.mjs`), which fails closed and enforces `.env` read/edit/command blocks, `main` push and `--no-verify` blocks, and `force_ask` confirmation on production-reaching commands.
4. Playbooks (`plan`, `review`, `feature`, `retro`, and `pm` in the `pm` module) live in `.agents/skills/<name>/SKILL.md` with YAML frontmatter so Antigravity discovers them directly as skills and slash commands, while `.claude/commands/<name>.md` `@`-imports the same files when `module.claude` is installed.
5. `plugins/harness-kit/plugin.json` is shipped alongside `.claude-plugin/plugin.json` (and kept in sync by `template-lint.test.mjs`) so Antigravity can load the plugin natively, and `skills/harness-init/SKILL.md` resolves scripts relative to the plugin root when `${CLAUDE_PLUGIN_ROOT}` is unset.

**Alternatives considered**: keeping `.claude/` inside `core` (forces Claude files into Antigravity-only repos); duplicating playbooks across `.agents/workflows/` and `.agents/skills/` (two sources of truth that can drift).

**Consequences**:
- Easier: target repos can install Claude Code, Antigravity, or both around one `.agents/` core; every playbook is a first-class skill and slash command in both providers.
- Harder: `template-lint.test.mjs` runs both `.claude/hooks/guards.test.mjs` and `.agents/hooks/agy-guard.test.mjs` and checks that both keep the vocabulary's production command list in sync.

---

## ADR-005: Adding Modules to an Existing Install
**Date**: 2026-11-06
**Status**: Proposed

**Context**: `harness-init` stopped on any repo with `.agents/harness.json`, so a project installed with an older kit (NoLine, on 0.3.0) couldn't take a new module. A full re-install would re-render files the project already adapted. Installed files also mention modules and flags in `kit:if` blocks (for example `AGENTS.md` and `module.pm`), so adding a module changes files the add doesn't own.

**Decision**:
1. Add mode is an answers file with `add: [module ids]`, built from the install's recorded answers (`manifest.mjs answers`) plus the new modules and any values or flags the owner confirms. `answers.modules` must equal the installed modules plus the added ones.
2. The renderer installs the added modules' files with the usual actions, and installed modules' files that apply only now. Every installed file is compared between a render of the recorded answers and a render of the new ones, both with the current kit and the install's dates. A file whose render changes is a `delta`: the plan carries a line diff that the installer applies by hand with the owner. An adapted file is never re-rendered. A file that no longer applies is reported as `retired`, never deleted.
3. `manifest.mjs check` waits until every added line of each delta is in its file (a heuristic, not a merge check), alongside the usual adapt markers, `.kit-new` files and missing targets.
4. `manifest.mjs write` updates the record instead of replacing it: installed files keep their `rendered` hash; a file that took a delta gets a new `installed` hash, so a later sync treats the delta as a project change and keeps it; new entries carry `kitVersion` when the kit is newer than the install; values keep the install's derived ones and gain the new answers; flags are the new ones; `history` lists the install and each add.

**Alternatives considered**: re-rendering the whole install (loses adaptations or floods the owner with `.kit-new` files); forbidding new modules from appearing in other modules' files (keeps add simple but bans the `AGENTS.md` mentions every module has today); writing deltas as `.kit-new` files (the owner would merge a full kit file to get a two-line change).

**Consequences**:
- Easier: a project takes a new module in one PR, with every change to an existing file shown as a small diff.
- Harder: a delta computed with a newer kit isolates only the add's own changes; upgrading the rest of the install to the newer kit is still a separate, unbuilt flow. The applied-delta check only looks for added lines.

---

## ADR-006: Verification Modules Are Generic Engines Plus a Discovered Config, and db-backup Is the One Owner-Invoked Production Read
**Date**: 2026-11-06
**Status**: Proposed

**Context**: The reference implementation's `e2e-verify`, `smoke-local` and `db-backup` skills work well but hard-code its stack: its package manager and workspace names, its ORM's commands, its server, its health route, its auth secret, its env file and its hosting provider. The template contract allows only `identifier` tokens in shell templates, so the scripts can't be templated as they are. `db-backup` also reaches production by design, which the "Production stays out" hard rule didn't account for.

**Decision**:
1. Each skill is a generic engine shipped as a static template (Node `.mjs`, no tokens) plus a per-project JSON config (`smoke.json`, `e2e.json`, `backup.json`) rendered from `_JSON` tokens. Config commands are single command lines with no shell syntax, run without a shell, and checked against the production reject list at render time. smoke-local and e2e-verify each carry a copy of one shared `verify-lib.mjs`, and the lint keeps the copies identical.
2. Engines are Node rather than bash: JSON configs parse natively, commands run as argument arrays, the macOS bash 3.2 limits go away, and the engines' tests run in the kit's lint on the rendered output without Docker.
3. `detect.mjs` gains a read-only `verification` section (container, health route, database engine and image, `.env.example` names, scripts, E2E runner, local machine). The installer proposes every config value from it with its evidence and asks only about gaps. Unrecognized stacks fall back to the owner's answers, and `kit:adapt` markers cover what only the project can say (review checklists, risky paths, restore verification).
4. Modules are gated by an existing flag (`has.container`, `has.ui`, `has.db`) and default to off. Each installed one is mentioned in `AGENTS.md` behind its module flag, which add mode turns into a delta.
5. `db-backup` is the one owner-invoked, read-only production skill. It runs only when the owner invokes it; it is never in a guard profile, a tracked `permissions.allow` (only `--check` is pre-approved in the Claude adapter), a schedule or an agent's own initiative. The URL lives in a git-ignored env file the owner fills by hand; the script refuses a tracked or un-ignored file, keeps the URL inside its own process, and redacts errors. The host provider's MCP server, when the owner uses one, is allowed read-only and only for checks that return no credential, because an MCP tool result lands in the agent's context.

**Alternatives considered**: templating the reference bash scripts with new token types (widens the shell token rule for little gain); letting the model write each project's scripts at install time (unreviewable, untested output that drifts per project); one combined verification module (forces container and UI assumptions on projects that have only one); reading the URL through the provider's MCP server (puts the credential in the conversation).

**Consequences**:
- Easier: a project gets tested engines and changes its behavior by editing a small JSON file in a PR; the kit tests every engine on every change.
- Harder: Postgres is the only database engine for the throwaway servers and the backup; another engine needs engine code, not just config. A start script that ignores `PORT` needs `E2E_START_PORT_ARGS_JSON`. The two `verify-lib.mjs` copies must change together.
