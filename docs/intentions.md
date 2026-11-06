# Intentions

Work the owner wants in the kit that isn't planned yet. Each entry has the idea, what is decided, and what is still open. An entry moves into a plan, and its decisions into [decisions.md](decisions.md), when work starts.

## I1. Verification modules from the reference implementation (2026-11-06)

**Idea.** Upstream three skills from the reference implementation as optional modules: `e2e-verify` (Playwright E2E against a production build and a throwaway database, plus a visual review of screenshots), `smoke-local` (build the production image and boot it the way CI does) and `db-backup` (an off-platform dump of the production database). The first target is NoLine (TanStack Start, Drizzle, Postgres, Docker, Railway), which already has kit 0.3.0 installed.

**Decided.**

- Each skill becomes a generic engine shipped by the kit, plus a per-project config written at install time (services, step commands, health URL, required secrets, viewport and locale, backup source and destination). The config is JSON, so the renderer validates it with the existing `command` type and production reject list.
- `detect.mjs` gains read-only, offline discovery: database engine (Prisma provider, Drizzle config, compose services, `.env.example`), migrate and seed scripts, build and start commands, health route, dev port, Playwright, required secrets, and the local machine (Docker, macOS or WSL, Node version).
- Two install paths. A recognized stack (Node, Postgres and Docker first) fills the config automatically and the owner confirms it. Anything else gets `kit:adapt` markers: the model proposes values from the repo and asks, and offers a scaffold where a piece is missing (for example a first Playwright config and spec).
- `db-backup` stays owner-invoked only, and never sits in a guard profile or a tracked `permissions.allow`, even though it is a read-only dump. At install it asks for the database host provider's MCP server or, failing that, a connection URL the owner stores in a git-ignored env file. The URL never enters the agent's context: the script reads it, writes a mode-600 credential file, and redacts errors. An MCP server is used only for what doesn't expose the credential (finding the database, its version, whether public access is on, or a provider-native backup), because an MCP tool result lands in the context. This needs an ADR that refines the "Production stays out" rule for owner-invoked, read-only skills.

**Open.**

- Adding modules to an existing install. `harness-init` stops when `.agents/harness.json` exists, so NoLine needs an "add module" path that reads the manifest, renders only the new modules and updates it.
- Which database engines besides Postgres get an automatic path.
- Whether the e2e PR-review poster (inline findings with screenshots on an orphan branch) is part of `e2e-verify` or its own module.

## I2. Adversarial code review persona that comments on PRs (2026-11-06)

**Idea.** A reviewer persona that tries to break the change rather than approve it, run with a frontier model at high effort, and posts its findings as inline comments on the GitHub PR without a human relaying them.

**Decided.** Nothing yet beyond the shape: a persona plus a skill, provider-agnostic like the rest of the kit, and it comments only (it never approves, requests changes as a merge gate, or pushes).

**Open.**

- **Trigger.** CI on `pull_request` (automatic, needs an LLM API key as a repository secret) or local and owner-invoked (uses the owner's own sign-in, no key in CI). Possibly both: local by default, CI as an opt-in.
- **Provider in CI.** Each provider has its own headless runner, to verify against official docs before planning: Claude Code (`claude -p` and its GitHub Action), Codex (`codex exec` and its GitHub Action), and Gemini (Gemini CLI and its GitHub Action), which is the likely route for an Antigravity key since Antigravity itself is an IDE. The alternative is one kit script that calls a provider API directly and posts the review through the GitHub API, which keeps the posting logic the same for every provider.
- **Posting.** Reuse the reference implementation's review poster (a review spec JSON, a dry-run, then one review of `event: COMMENT` with comments anchored to path and line) so every provider's output goes through the same validator.
- **Cost and noise.** A high-effort run on every push is expensive. Options: run on `ready_for_review` and on demand (a label or a comment command), skip docs-only diffs, and cap the number of findings.
- **Secrets.** The API key lives only in the repository's secret store, never in a file, and the workflow must not run on PRs from forks with access to it.

## I3. Moving tools between projects, the kit and a personal home (2026-11-06)

**Idea.** Make it routine to move a tool in any direction: from a project up to the kit, from the kit down to a project (new or already installed), and between the kit and a personal, project-independent home that syncs across machines.

**Decided.**

- Two homes, one rule. A tool that needs project facts (commands, database, ports, deploy target) is a kit template: it would need a `{{TOKEN}}` or a `kit:adapt` marker elsewhere. A tool that works unchanged in any repo (teaching, writing and commit rules, general research habits) is personal.
- The personal home is a private GitHub repo with a live personal plugin and marketplace (skills, agents, commands, hooks) plus a small dotfiles folder for what a plugin can't carry (the global `CLAUDE.md` and `settings.json`), linked into `~/.claude/` by a setup script. Every machine is a clone; none is the hub. It syncs a curated set, never all of `~/.claude/` (transcripts, memory, caches and auth data stay local).
- The kit ships the flows as skills, so the steps aren't remembered by hand: `harness-upstream` (run in the kit, pointed at a project's skill: copy, strip names and stack into tokens, adapt markers and discovered config, register, test) and an add-modules path in `harness-init` for repos that already have the kit.

**Open.**

- Where Antigravity reads global skills and instructions, for the personal repo's setup script.
- Whether private-repo marketplaces auto-update without a token on every machine (to verify against the plugin docs).
- Upgrading an install to a newer kit version (re-render the old version from the manifest's values, three-way merge with the installed file) after add-modules lands.
