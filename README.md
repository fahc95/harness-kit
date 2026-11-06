# harness-kit

A plugin for Google Antigravity and Claude Code that installs a provider-agnostic agentic development harness into a project: personas, skills, rules, guard hooks and memory, adapted to that project.

> **Status: v0.3.0, unreleased.** The templates, the `/harness-init` installer, and the Antigravity and Claude Code provider adapters exist. Tests on throwaway repos and a brownfield fixture are next (see [Roadmap](#roadmap)).

## What it does

The plugin ships one user-invoked skill, `/harness-init` (`/harness-kit:harness-init` in Claude Code), plus inert templates. It registers no agents, hooks or commands globally. Run inside a target repo, the installer:

1. checks that it runs in a clean worktree on a branch cut from an up-to-date `main`;
2. detects the stack, the git flow, the commands and any existing agent harness;
3. runs the project's checks once, as a baseline;
4. asks which provider adapters (`claude`, `antigravity`, or both) and modules to install, and confirms what it detected;
5. merges the project's existing instructions into `AGENTS.md` (and `GEMINI.md` / `CLAUDE.md` when selected), and shows the result before writing it;
6. renders the templates into the repo (`AGENTS.md`, `.agents/`, plus `GEMINI.md` and `.agents/hooks.json` for Antigravity and `CLAUDE.md` and `.claude/` for Claude Code), never overwriting an existing file without the owner's say;
7. fills in the project-specific sections with the owner;
8. writes `.agents/harness.json`, a manifest of the kit version and every installed file;
9. proposes post-install steps such as `git config core.hooksPath .githooks`, without replacing existing hook tooling.

The install lands through a normal PR. The project owns its copy and adapts it.

## Install

### Antigravity

Register the plugin in `~/.gemini/config/plugins.json` (or `.agents/plugins.json` in a workspace):

```json
{
  "entries": [
    { "path": "/path/to/harness-kit/plugins" }
  ]
}
```

Then, inside the target repo, in a worktree on a fresh branch, run `/harness-init`.

### Claude Code

```bash
claude plugin marketplace add fahc95/harness-kit
```

```bash
claude plugin install harness-kit@harness-kit
```

Then, inside the target repo, in a worktree on a fresh branch, run `/harness-kit:harness-init`.

## Layout

```
harness-kit/
├── .claude-plugin/marketplace.json   # the Claude Code marketplace (this repo)
├── .githooks/pre-push                # repo tooling: refuses pushes to main
├── .github/workflows/ci.yml          # validate manifests, run script tests
├── docs/design.md                    # why the harness is shaped this way
├── docs/decisions.md                 # the kit's own ADR log
└── plugins/harness-kit/
    ├── plugin.json                   # Antigravity plugin manifest
    ├── .claude-plugin/plugin.json    # Claude Code plugin manifest
    ├── scripts/                      # installer scripts and the template lint, each with tests
    │   ├── contract.mjs              # the template contract as code
    │   ├── detect.mjs                # read-only project detection
    │   ├── render.mjs                # validate answers, render, merge settings
    │   ├── manifest.mjs              # .agents/harness.json
    │   └── template-lint.mjs         # template checks
    ├── skills/harness-init/          # the installer skill
    └── templates/                    # inert templates (docs/templates.md)
        ├── vocabulary.json           # every {{TOKEN}} and kit:if flag
        ├── modules.json              # the module registry
        ├── core/                     # AGENTS.md, .agents/ (personas, skills, rules, memory)
        └── common/                   # claude, antigravity, open-pr, githooks-pre-push, pm, flow-migration
```

Templates never sit in the plugin's top-level `agents/`, `hooks/`, `rules/` or `commands/` folders, because Antigravity and Claude Code would load those as live components in every project.

## Roadmap

| Phase | What |
|---|---|
| 1 | This skeleton: marketplace, plugin manifest, CI, docs |
| 2 | Core templates, plus `open-pr`, `pre-push` and `flow-migration` (done) |
| 3 | The `/harness-init` installer, `pm` module, and Antigravity + Claude adapters (done) |
| 4 | Tests on throwaway repos and a brownfield fixture |
| 5 | First real install on a brownfield project (the v1 finish line) |

Ideas that aren't planned yet, such as the verification modules and an adversarial PR reviewer, are in [docs/intentions.md](docs/intentions.md).

The full plan lives in the reference implementation's `docs/plans/2026-10-harness-kit.md`, in a private repo.

## Requirements

- Google Antigravity or Claude Code with plugin support
- Node 22 in the target project's environment (the guard hooks are `.mjs` scripts)
- git, and the GitHub CLI for the `open-pr` module

## Reference implementation

The harness is developed in Freddy's Mi Súper App repo and upstreamed here deliberately. See [docs/design.md](docs/design.md).
