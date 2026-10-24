# Template contract

How templates under `plugins/harness-kit/templates/` are written. The machine-readable source is [`templates/vocabulary.json`](../plugins/harness-kit/templates/vocabulary.json); `plugins/harness-kit/scripts/template-lint.test.mjs` enforces everything below. The decision is ADR-002 in [decisions.md](decisions.md).

## Layout and path mapping

- Each module has a root: `templates/core/`, `templates/common/<id>/` or `templates/examples/<id>/`. Under it, files mirror their path in the target repo.
- The target path is the template path with the module root and the `.tmpl` suffix removed, and every `dot-<x>` segment turned into `.<x>`. For example, `core/dot-agents/personas/planner.md.tmpl` renders to `.agents/personas/planner.md`.
- Every template file ends in `.tmpl` and no path segment starts with a dot, so a session in this repo never loads a template as a live rule, skill, agent or `CLAUDE.md`, and `node --test` never runs a template test.
- The only files under `templates/` without `.tmpl` are the data files `modules.json` (the module registry) and `vocabulary.json` (this contract). Nothing auto-loads them.
- The only token allowed in a path is `{{DATE_YM}}`.

## Tokens

- Written `{{UPPER_SNAKE}}`. Each one is declared in `vocabulary.json` with a type, a description, a source (detect, answers, render, kit or derived) and a generic example.
- Types: `string` (one line, no braces, angle brackets or backticks), `identifier`, `path`, `date`, `command` (no shell metacharacters) and `json-array`. A token can narrow its type with its own `pattern`.
- Every non-array token has an implicit `NAME_JSON` twin: its value as a JSON literal. A `json-array` token is itself named `NAME_JSON`, has no twin, and declares an `itemPattern` that every item must match (for example, guard commands must be single command lines with no shell metacharacters).
- `.mjs` and `.json` templates may use only `_JSON` tokens, so a value always lands as a JSON literal, never as code, a raw regex or a broken string. Shell and YAML templates may use only `identifier` tokens.
- A token with a `when` flag (for example `CMD_TEST` with `has.test`) may appear only inside a `kit:if` block on that flag, because it has no value when the flag is false.
- Rendering fails on an unknown or unfilled token, and on a value that doesn't match its type.
- Every command value (a `command` token, an item of a `commandItems` array, or the command inside a `Bash(...)` rule) is also checked against `rejectCommandPatterns`: its `production` list (remote hosts, deploy CLIs, connection URLs, push, deploy and release scripts) and its `blockedByGuard` list (what bash-guard blocks anyway). The installed `guards.test.mjs` keeps a copy of the production list, and the lint test checks the two match. A match is never rendered; the installer asks the owner instead. This backs the hard rule that no production command reaches a guard profile or a tracked `permissions.allow`.
- Persona display names are tokens (`{{PERSONA_NAME_PLANNER}}`). The reference implementation's names are their defaults and appear only in `vocabulary.json`.
- There is no escape for a literal `{{` yet. Add one to the contract when a template first needs it.

## Conditionals

| File type | Syntax |
|---|---|
| Markdown | `<!-- kit:if has.db -->` … `<!-- kit:end -->` |
| `.mjs` | `// kit:if has.db` … `// kit:end` |
| shell, YAML | `# kit:if has.db` … `# kit:end` |
| JSON | not allowed |

- Each marker sits alone on its line. Blocks don't nest.
- A flag is `has.*`, `flow.*` or `module.*`, from detect or the owner's answers, declared in `vocabulary.json`. Prefix `!` to negate: `<!-- kit:if !has.db -->`.
- Render drops the marker lines, and drops the block's content when the flag is false.
- In YAML frontmatter, a conditional makes the file invalid YAML until it is rendered. The lint test renders each template with every flag on, then every flag off, and checks the frontmatter: it closes, and every line is a block-style `key: value` or `- item`, nested by two spaces. Keep `kit:adapt` markers out of frontmatter. This is a line-shape lint, not a YAML parser: it doesn't check that a nested key has a parent or that quotes close.

## Adapt markers

- `<!-- kit:adapt: <instruction> -->`, alone on its line, Markdown only.
- It marks prose only the target project can supply: goals, stack rules, drift checks, feature layers. Render leaves it in place; the installer skill has the model replace each one and greps until none remain.
- A marker may sit inside a `kit:if` block.

## Adding a template or module

1. Write the file under the module root, ending in `.tmpl`, from a reference-implementation file. Strip reference names and stack; use tokens, `kit:if` and `kit:adapt`.
2. Add any new token or flag to `vocabulary.json`. Every entry must be used: the lint test rejects dead ones, so add an entry in the same PR as its first use.
3. List the file in its module in `modules.json`, with its `target` (the derived path), `onExisting` (`merge`, `kit-new` or `skip`), `when` if the file depends on a flag, `adapt: true` if it carries `kit:adapt` markers, and `mode` only for `.githooks/` files.
4. A settings fragment (`settings.fragment.json.tmpl`) is listed under the module's `settings`, not `files`: the installer merges it into `.claude/settings.json` instead of copying it.
5. `postInstall` lists commands the installer proposes after writing the files. Each one runs only with the owner's approval, and never silently replaces existing state: for `git config core.hooksPath .githooks`, the installer first reads the current value, and if it is set to something else (husky, lefthook), it shows that and asks instead of overwriting it.
6. A module that templates can gate on gets a `flag` (`module.<name>`) in `modules.json` and the same flag in `vocabulary.json`. The lint test checks they pair up.
7. Run `node --test "plugins/**/*.test.mjs"`. It also renders each module into a temp repo, the way the installer will, and runs the rendered tests there.
