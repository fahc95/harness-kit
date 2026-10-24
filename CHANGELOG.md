# Changelog

All notable changes to harness-kit. Versions follow `plugins/harness-kit/.claude-plugin/plugin.json`; bump it in the same PR as the entry.

## 0.1.0 (unreleased)

- Marketplace manifest (`.claude-plugin/marketplace.json`) and plugin manifest (`plugins/harness-kit/.claude-plugin/plugin.json`).
- CI: `claude plugin validate --strict` for both manifests and `node --test`.
- Docs: README, AGENTS.md, design notes and the kit's ADR log.
- Template contract: `templates/vocabulary.json` (tokens and flags), `docs/templates.md` and ADR-002, enforced by `plugins/harness-kit/scripts/template-lint.test.mjs`.
- Core templates: `AGENTS.md`, `CLAUDE.md`, the architect, planner, reviewer, retro and researcher personas, the plan, review, retro and feature workflows with their command wrappers, the commands, env-and-secrets and production-parity rules, and memory seeds. Registered as the `core` module in `templates/modules.json`.
- Repo tooling: `.githooks/pre-push` refuses pushes to `main` (enable with `git config core.hooksPath .githooks`), with tests in CI. Not part of the installed plugin.
