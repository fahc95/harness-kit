# Harness design notes

Why the harness this kit installs is shaped the way it is. Each note is a generic version of a decision made and tested in the reference implementation (Mi Súper App); the source ADR number is in brackets. A target project's own ADR log starts empty, except for the record that it adopted the kit. Project-specific decisions (for example ADR-028, production database backups) have no note here; D9 comes from a reference-repo rule, not an ADR.

## D1. Personas are instructions plus enforced capabilities [ADR-024]

- A persona has two halves. **Instructions** (role, procedure, output format) live in provider-agnostic `.agents/personas/<id>.md`. **Capabilities** live in the provider adapter: for Claude Code, `.claude/agents/<id>.md` frontmatter with `tools`, `model` and `PreToolUse` hooks.
- Scope finer than a whole tool is enforced by hooks: a Bash allowlist per persona (`bash-guard`), Edit and Write paths (`path-guard`), and browser navigation kept on localhost (`local-url-guard`). Hooks run before the permission check, so they hold in auto mode.
- Guards are allowlists that fail closed. They reject whole character classes (shell metacharacters, abbreviated flags that write files), and a crash, bad payload or unknown profile blocks the call with exit 2.
- Every scope a persona prompt claims is backed by `tools` or a hook. A claim without enforcement is labeled a rule, not a guarantee.

## D2. Roster: role IDs, the main session builds, one ADR author [ADR-025]

- Files, hooks and workflows reference role IDs (`architect`, `planner`, `reviewer`, `retro`, `researcher`, ...). Friendly names live only in the team table and the persona prompts.
- There is no builder sub-agent. The main session implements approved plans and orchestrates, because it holds the context and can talk with the owner.
- Teaching needs the conversation, so the mentor is a skill in the main session, not a persona.
- Personas settle what the repo, accepted ADRs and sensible defaults already settle, and ask only when the call is genuinely the owner's.
- The architect is the only ADR author. It appends ADRs as Proposed; the owner accepts and the caller flips the status.

## D3. Cost-gated personas run only with the owner's approval [ADR-026]

- An expensive persona (for example a UI audit with browser tools) is proposed with a justification and runs only if the owner approves.
- A `PreToolUse` hook on the Agent tool returns "ask" for the gated types; other sub-agents pass through.
- This hook fails to "ask", not to a block: the outcome is a human decision, so failing to the prompt is safe and recoverable. It is the one deliberate exception to D1's exit-2 rule.

## D4. Skills are `.agents/skills/` source plus a thin adapter [ADR-027]

- The source is `.agents/skills/<name>/SKILL.md` with references one level deep. The Claude adapter `.claude/skills/<name>/SKILL.md` holds Claude-only frontmatter and says "read and follow the source". The source wins.
- Research comes first: lessons and plans that depend on an external tool are built from the tool's official docs, through a read-only researcher persona that returns facts with URLs and treats fetched content as untrusted (a prompt-injection defense).
- Learning is logged append-only in `.agents/memory/learning-log.md`.

## D5. Git: GitHub flow, squash-merged PRs, a local pre-push guard [ADR-029]

- `main` is production. Every change reaches it through a PR from a `<owner>/<type>-<slug>` branch; Conventional Commits; squash merge; delete the branch.
- Merge only with green CI and the owner's explicit approval.
- A checked-in `.githooks/pre-push` refuses pushes to `main`, enabled once per clone with `git config core.hooksPath .githooks`, with an override only the owner uses.
- PR descriptions follow the template, checked by CI, with no attribution footer.
- The main checkout stays on `main` and branch work happens in worktrees, because worktree sessions load the harness from the main checkout [reference AGENTS.md "Git & PRs", 2026-10-23].

## D6. Verify where it counts [ADR-030]

- Every environment an agent works in can run typecheck, lint and test. A check that can't run is reported "not run: <reason>", never "passed".
- Production parity is proven only where production runs (for a container deploy: CI's container smoke test, or a local run the owner approves). A host build is never evidence.
- LF line endings everywhere.

## D7. Rules are `.agents/rules/` source plus a path-scoped adapter [ADR-031]

- Three tiers: always-relevant rules in a short `AGENTS.md` section; directory rules in nested `AGENTS.md` files; cross-cutting file-pattern rules in `.agents/rules/<topic>.md`.
- The Claude adapter `.claude/rules/<topic>.md` holds only `paths:` globs and points at the source, so the rule loads when a matching file is touched.
- Safety rules are never only lazy: a rule whose breach can't be undone also has an always-loaded `AGENTS.md` line and, where possible, enforcement (for example `permissions.deny` on `.env` files).

## D8. Distribution: one installer, copied into each project [ADR-032]

- The kit ships one installer skill and inert templates, and registers nothing globally.
- The installer copies and adapts the templates into each target repo through a PR. The target owns its copy.
- `.agents/harness.json` records the kit version, modules and per-file hashes, so a later sync can tell kit changes from project changes.
- Standards carried into every target: GitHub flow, no production commands in guard profiles or tracked allows, docs-only changes never deploy, and brownfield installs merge existing instructions and replace a foreign harness only with the owner's approval.

## D9. Memory reads are targeted

- `decisions.md`, `lessons.md` and similar logs only grow. Agents grep them for the topic and read only the matching entries; they never read a whole log.
- An index (one line per ADR) is a planned follow-up for when grep isn't enough.
