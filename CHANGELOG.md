# Changelog

All notable changes to harness-kit. Versions follow `plugins/harness-kit/.claude-plugin/plugin.json`; bump it in the same PR as the entry.

## 0.2.0 (unreleased)

- The `/harness-kit:harness-init` installer skill (`skills/harness-init/SKILL.md`): checks for a clean, fresh branch off an up-to-date `main`, detects the project, runs baseline checks, asks for modules and answers, previews `AGENTS.md` and `CLAUDE.md`, renders, merges existing files, resolves every `kit:adapt` marker with the owner, writes the manifest and proposes post-install steps.
- `scripts/render.mjs`: the template renderer (`plan`, `show`, `apply`). Validates answers against `vocabulary.json`, including `rejectCommandPatterns`, derives the computed tokens and flags, renders `kit:if` blocks in all three comment styles, merges settings fragments into `.claude/settings.json`, and never overwrites an existing file (the kit's version goes to `<file>.kit-new`). ADR-003.
- `scripts/detect.mjs`: read-only detection of git state, package manager, check and database commands, database, container, UI, GitHub remote, Git Flow, hook tools and existing instructions.
- `scripts/manifest.mjs`: writes `.agents/harness.json` with the kit version, modules, resolved values and flags, and `rendered` and `installed` sha256 hashes per file. Refuses while `kit:adapt` markers, `.kit-new` files or missing targets remain.
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
