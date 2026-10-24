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
