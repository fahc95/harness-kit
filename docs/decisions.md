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
