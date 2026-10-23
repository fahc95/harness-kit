# Changelog

All notable changes to harness-kit. Versions follow `plugins/harness-kit/.claude-plugin/plugin.json`; bump it in the same PR as the entry.

## 0.1.0 (unreleased)

- Marketplace manifest (`.claude-plugin/marketplace.json`) and plugin manifest (`plugins/harness-kit/.claude-plugin/plugin.json`).
- CI: `claude plugin validate --strict` for both manifests and `node --test`.
- Docs: README, AGENTS.md, design notes and the kit's ADR log.
- Repo tooling: `.githooks/pre-push` refuses pushes to `main` (enable with `git config core.hooksPath .githooks`), with tests in CI. Not part of the installed plugin.
