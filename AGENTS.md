# AGENTS.md: harness-kit

Read this at the start of every session that works on this repo. It is the provider-agnostic source for how we work here.

## What this repo is

A Claude Code plugin, distributed through the marketplace in this same repo, that installs an agentic development harness into other projects. The plugin ships one user-invoked installer skill and inert templates. The harness itself evolves in the reference implementation (Mi Súper App) and is upstreamed here on purpose, never automatically ([docs/decisions.md](docs/decisions.md) ADR-001).

## Hard rules

- **No live components from templates.** Nothing under `plugins/harness-kit/` may sit in a folder Claude Code auto-discovers (`agents/`, `commands/`, `skills/`, `hooks/hooks.json`, `output-styles/`, `bin/`, `.mcp.json`, `.lsp.json`, `settings.json`, or any other default component path in the Claude Code plugin docs) unless it is meant to run in every project where the plugin is enabled. Planned: only `skills/harness-init/`.
- **Templates are inert.** They live under `plugins/harness-kit/templates/`. Dot folders are spelled `dot-agents/`, `dot-claude/` and so on, and every template file has a `.tmpl` suffix, so a session in this repo never loads a template rule, skill or `CLAUDE.md` as a live one, and `node --test` never runs a template test. The only exceptions are the data files `templates/modules.json` and `templates/vocabulary.json`, which nothing auto-loads. The syntax is in [docs/templates.md](docs/templates.md).
- **Everything inside the plugin folder.** Installs copy only `plugins/harness-kit/`, so no `../` references and no symlinks out of it.
- **No project names in templates.** Outside `templates/examples/`, templates carry `{{TOKENS}}`, never a real project's names, URLs or stack.
- **Production stays out.** No template puts a production-reaching command (ssh to a host, deploys, data-restore or write scripts, MCP servers that reach production) in a guard profile or a tracked `permissions.allow`.
- **No secrets.** This repo is public.

## Git and PRs

- GitHub flow: `main` is the released plugin. Every change reaches `main` through a PR, squash-merged, with Freddy's explicit approval. Never push to `main`. `.githooks/pre-push` refuses it once you run `git config core.hooksPath .githooks` (once per clone; worktrees share it). Only Freddy uses the `HARNESS_KIT_ALLOW_PUSH_MAIN=1` override. Never use `--no-verify`. Server-side branch protection is not set up.
- Branch from `main` as `fredz/<type>-<slug>` (a Conventional Commit type plus 2 to 5 kebab-case words), in a worktree; the main checkout stays on `main`.
- Commits and PR titles are Conventional Commits. PR descriptions have no em dashes, no "Generated with Claude Code" footer and no co-author line.
- A user-visible change bumps `version` in `plugins/harness-kit/.claude-plugin/plugin.json` and adds a `CHANGELOG.md` entry in the same PR.

## Checks

Run before declaring done. CI runs the same.

```bash
claude plugin validate --strict .
```

```bash
claude plugin validate --strict plugins/harness-kit
```

```bash
node --test "plugins/**/*.test.mjs" ".githooks/*.test.mjs"
```

Tests live next to the installer scripts, the template lint (`plugins/harness-kit/scripts/`) and the git hooks. Fixture repos under `test/fixtures/` are inputs, not tests, and may contain failing tests on purpose.

If a check can't run, report "not run: <reason>", never "passed".

## Decisions

- Kit decisions go in [docs/decisions.md](docs/decisions.md), append-only. Grep it for the topic and read only the matching ADRs; never read the whole log.
- [docs/design.md](docs/design.md) explains the harness's shape (why personas, skills and rules are split the way they are). Change it only when the reference implementation's decisions change.
