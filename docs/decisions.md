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
