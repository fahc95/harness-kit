# Changelog

All notable changes to harness-kit. Versions follow `plugins/harness-kit/.claude-plugin/plugin.json` and `plugins/harness-kit/plugin.json`; bump both in the same PR as the entry.

## 0.5.0 (unreleased)

- Verification modules (ADR-006), upstreamed from the reference implementation and made stack-agnostic. Each is a generic Node engine plus a JSON config the installer fills from discovery:
  - `smoke-local` (when `has.container`): builds the production image and boots it against a throwaway Postgres, with an optional second boot on the same database, optional migrate commands run in the image, and a boot without each required secret that must fail. Owner-run.
  - `e2e-verify` (when `has.ui`): runs the E2E suite against the production build served on the host, or the production image with `--docker`, and a throwaway database, then has the agent review every state screenshot. The installer offers to scaffold a first test runner setup when the repo has none.
  - `db-backup` (when `has.db`, Postgres only): an owner-only `pg_dump` of production to a folder outside the repo, verified with `pg_restore --list` and pruned to the newest few. The URL lives in a git-ignored env file only the script reads; with the host provider's MCP server (`has.dbProviderMcp`), the skill uses it read-only for checks that expose no credential. `--check` is a self-test that never contacts production.
  - `detect.mjs` reports a `verification` section: Dockerfile, exposed port and entrypoint, health route, database engine and image (Prisma, Drizzle, dependencies, compose), the database URL variable, secret, local URL and build-arg candidates from `.env.example`, build, start (with a hard-coded port), migrate and seed scripts, the E2E runner and spec folders (monorepo workspaces included), and the local machine (Docker, OS, WSL, Node).
  - `AGENTS.md` mentions each installed skill in "Where to build and verify" and the Definition of Done. New flags `module.smokeLocal`, `module.endToEnd`, `module.dbBackup` and `has.dbProviderMcp`, and the `VERIFY_*`, `SMOKE_*`, `E2E_*`, `BACKUP_*` and `DB_PROVIDER*` tokens.

## 0.4.0 (unreleased)

- Add modules to an existing install (ADR-005). `harness-init` no longer stops when `.agents/harness.json` exists: it offers the modules not installed yet. `manifest.mjs answers` prints the install's recorded answers as the starting point; the answers file names the new modules in `add`. In add mode, `render.mjs` installs only the added modules' files (plus installed modules' files that apply only now, for example after the owner confirms `has.container`), and reports each installed file whose render changes as a `delta` with a line diff the installer applies by hand, never re-rendering an adapted file. `manifest.mjs check` also waits for every delta, and `write` updates the record: new entries (with `kitVersion` when the kit is newer than the install), new `installed` hashes for files that took a delta, merged values, the new flags and a `history` of the install and each add.

## 0.3.0

- Google Antigravity optimization (ADR-004):
  - Native Antigravity plugin manifest (`plugins/harness-kit/plugin.json`), kept in sync with `.claude-plugin/plugin.json` by `template-lint.test.mjs`, and provider-agnostic path and scratch resolution in `skills/harness-init/SKILL.md`.
  - Split provider adapters into selectable `claude` (`module.claude`) and `antigravity` (`module.antigravity`) modules around the universal `core` module (`AGENTS.md` and `.agents/`). `resolveAnswers` requires at least one provider adapter.
  - New `antigravity` module: `GEMINI.md` (sub-agent wiring via `define_subagent` and `invoke_subagent` for every persona in `.agents/personas/`), `.agents/hooks.json`, and `.agents/hooks/agy-guard.mjs` (plus `agy-guard.test.mjs`), a fail-closed `PreToolUse` guard speaking Antigravity's camelCase JSON contract that blocks `.env` access across file and command tools, blocks `git push` to `main` and `--no-verify`, and gates production-reaching commands with `force_ask`.
  - Converted core workflow playbooks (`plan`, `review`, `feature`, `retro`) and the `pm` playbook into `.agents/skills/<name>/SKILL.md` with YAML frontmatter so Antigravity discovers `/plan`, `/review`, `/feature`, `/retro` and `/pm` natively as skills and slash commands, while `.claude/commands/*.md` wraps the same files when `claude` is installed.
  - `detect.mjs` now detects `GEMINI.md`, `.agents/hooks.json`, `.agents/mcp_config.json`, `.agents/plugins.json`, `.agents/skills.json`, and project-scoped MCP servers in `.agents/mcp_config.json`.

## 0.2.0 (unreleased)

- The `/harness-kit:harness-init` installer skill (`skills/harness-init/SKILL.md`): checks for a clean, fresh branch off an up-to-date `main`, detects the project, runs baseline checks, asks for modules and answers, previews `AGENTS.md` and `CLAUDE.md`, renders, merges existing files, resolves every `kit:adapt` marker with the owner, writes the manifest and proposes post-install steps.
- `scripts/render.mjs`: the template renderer (`plan`, `show`, `apply`). Validates answers against `vocabulary.json`, including `rejectCommandPatterns`, derives the computed tokens and flags, renders `kit:if` blocks in all three comment styles, merges settings fragments into `.claude/settings.json`, and never overwrites an existing file (the kit's version goes to `<file>.kit-new`). ADR-003.
- `scripts/detect.mjs`: read-only detection of git state, package manager, check and database commands, database, container, UI, GitHub remote, Git Flow, hook tools and existing instructions.
- `scripts/manifest.mjs`: writes `.agents/harness.json` with the kit version, modules, resolved values and flags, and `rendered` and `installed` sha256 hashes per file. Refuses while `kit:adapt` markers, `.kit-new` files or missing targets remain.
- `pm` module: a product manager persona (`.agents/personas/pm.md`), its Claude sub-agent and a `/pm` command. It owns what gets built and in what order, in six modes: `next`, `intake`, `shape`, `sync`, `groom` and `roadmap`. The backlog lives in a PM tool the owner picks at install, reached through its MCP server (the installer suggests Linear; Notion, Jira, GitHub Issues and others work too) and scoped to one project. With no tool, it lives in `docs/backlog.md`, and path-guard lets the persona edit only that file. When installed, the retro workflow syncs the backlog, the plan loop shapes features first, and `docs/next-steps.md` stays a handoff that points at the backlog. New tokens `PERSONA_NAME_PM`, `PM_TOOL` and `PM_SCOPE`, and flags `module.pm` and `has.pmTool`. `detect.mjs` lists project-scoped MCP servers as a hint.
- `scripts/contract.mjs`: the contract helpers, shared by the renderer, the detector and the template lint, so the lint now checks the installer's own renderer.

## 0.1.0

- Marketplace manifest (`.claude-plugin/marketplace.json`) and plugin manifest (`plugins/harness-kit/.claude-plugin/plugin.json`).
- CI: `claude plugin validate --strict` for both manifests and `node --test`.
- Docs: README, AGENTS.md, design notes and the kit's ADR log.
- Template contract: `templates/vocabulary.json` (tokens and flags), `docs/templates.md` and ADR-002, enforced by `plugins/harness-kit/scripts/template-lint.test.mjs`.
- Core templates: `AGENTS.md`, `CLAUDE.md`, the architect, planner, reviewer, retro and researcher personas, the plan, review, retro and feature workflows with their command wrappers, the commands, env-and-secrets and production-parity rules, and memory seeds. Registered as the `core` module in `templates/modules.json`.
- Guard templates: `bash-guard`, `path-guard`, `repo-root` and `guards.test`, with the Bash allowlists in a generated `guard-profiles.mjs` (exact-match, regex-escaped commands; fails closed), the five sub-agent wrappers, `HOOKS-GUIDE.md`, and a `.claude/settings.json` fragment with the `.env` deny list. The lint test renders the hooks and runs their tests.
- Common module templates, registered in `templates/modules.json`: `open-pr` (the skill, `check-pr.mjs` with its test, and the PR template), `githooks-pre-push` (the hook, mode 0755, with its test) and `flow-migration` (a Git Flow to GitHub Flow runbook). The lint test renders each module and runs its tests.
- Repo tooling: `.githooks/pre-push` refuses pushes to `main` (enable with `git config core.hooksPath .githooks`), with tests in CI. Not part of the installed plugin.
