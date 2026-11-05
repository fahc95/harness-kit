#!/usr/bin/env node
// Read-only project detection for /harness-kit:harness-init. It reports what it finds as
// suggestions and candidates; the installer confirms each one with the owner before it
// becomes an answer. It never runs project commands and never touches the network.
//
//   node detect.mjs [--repo <dir>]   prints the report as JSON
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rejectedCommand, valueError } from "./contract.mjs";
import { loadKit } from "./render.mjs";

const git = (repo, ...args) => {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

const exists = (repo, rel) => fs.existsSync(path.join(repo, rel));
const readJson = (repo, rel) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(repo, rel), "utf8"));
  } catch {
    return null;
  }
};

/** owner/name from a GitHub remote URL (https, ssh or scp-style), or null. */
export function githubRepoFrom(url) {
  const m = String(url ?? "").match(/^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

/** Git state: branch, cleanliness, freshness against origin/main, worktree, hooks, remote. */
export function detectGit(repo) {
  const top = git(repo, "rev-parse", "--show-toplevel");
  if (!top) return { isRepo: false };
  const gitDir = git(repo, "rev-parse", "--absolute-git-dir");
  const commonDir = path.resolve(repo, git(repo, "rev-parse", "--git-common-dir"));
  const status = git(repo, "status", "--porcelain", "--untracked-files=all") ?? "";
  const originUrl = git(repo, "remote", "get-url", "origin");
  const remoteBranches = (git(repo, "branch", "-r", "--format=%(refname:short)") ?? "").split("\n").filter(Boolean);
  const originHead = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  const base = remoteBranches.includes("origin/main") ? "origin/main" : git(repo, "rev-parse", "--verify", "--quiet", "main") ? "main" : null;
  const count = (range) => (base ? Number(git(repo, "rev-list", "--count", range) ?? NaN) : null);
  return {
    isRepo: true,
    root: top,
    branch: git(repo, "branch", "--show-current") || null,
    clean: status === "",
    dirty: status ? status.split("\n").slice(0, 20) : [],
    linkedWorktree: path.resolve(gitDir) !== commonDir,
    mainCheckout: path.basename(commonDir) === ".git" ? path.dirname(commonDir) : null,
    base,
    defaultBranch: originHead ? originHead.replace(/^origin\//, "") : null,
    // behind: commits on the base this branch lacks; ahead: commits on this branch only.
    behindBase: count(`HEAD..${base}`),
    aheadOfBase: count(`${base}..HEAD`),
    originUrl,
    githubRepo: githubRepoFrom(originUrl),
    remoteBranches,
    hooksPath: git(repo, "config", "--get", "core.hooksPath"),
    userName: git(repo, "config", "--get", "user.name"),
  };
}

/** Package manager from package.json's packageManager field, then lockfiles. */
export function detectPackageManager(repo, pkg) {
  const declared = pkg?.packageManager?.match(/^(npm|pnpm|yarn|bun)@/)?.[1];
  if (declared) return { name: declared, source: "packageManager" };
  for (const [file, name] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ]) {
    if (exists(repo, file)) return { name, source: file };
  }
  return pkg ? { name: "npm", source: "default" } : null;
}

/** The command line that runs a package.json script with this package manager. */
export function scriptCommand(pm, script) {
  if (script === "test" && pm !== "bun") return `${pm} test`;
  return `${pm} run ${script}`;
}

const NPM_NO_TEST = /no test specified/;
const CHECK_SCRIPTS = {
  typecheck: ["typecheck", "type-check", "check-types", "types", "tsc"],
  lint: ["lint"],
  test: ["test"],
};
const DB_SCRIPT = /(^|[:_-])(db|prisma|drizzle|migrat\w*|seed\w*|schema)([:_-]|$)/;

/** A candidate command, checked against the contract the way render will check it. */
export function classifyCommand(kit, command, type = "command") {
  const entry = type === "item" ? kit.vocabulary.tokens.DB_COMMANDS_JSON : { type: "command" };
  const err = valueError(entry, kit.vocabulary, type === "item" ? [command] : command);
  const hit = rejectedCommand(kit.vocabulary, command);
  return { command, ok: !err, rejected: hit ? hit.list : null, reason: err };
}

/** Check and database commands from package.json scripts. */
export function detectCommands(kit, pkg, pm) {
  const scripts = pkg?.scripts ?? {};
  const checks = {};
  for (const [kind, names] of Object.entries(CHECK_SCRIPTS)) {
    const name = names.find((n) => typeof scripts[n] === "string" && !NPM_NO_TEST.test(scripts[n]));
    checks[kind] = name ? { script: name, body: scripts[name], ...classifyCommand(kit, scriptCommand(pm, name)) } : null;
  }
  const db = Object.keys(scripts)
    .filter((n) => DB_SCRIPT.test(n))
    .map((n) => ({ script: n, body: scripts[n], ...classifyCommand(kit, scriptCommand(pm, n), "item") }));
  return { checks, db };
}

const DB_DIRS = ["prisma", "drizzle", "db", "database", "migrations", "supabase/migrations", "alembic", "priv/repo/migrations"];
const UI_DEPS = ["react", "react-dom", "vue", "svelte", "@sveltejs/kit", "next", "nuxt", "@angular/core", "solid-js", "astro", "preact", "@remix-run/react", "lit"];
const RISKY = [".github/workflows/", "Dockerfile", "Containerfile", "fly.toml", "railway.json", "railway.toml", "vercel.json", "netlify.toml", "render.yaml", "Procfile", "deploy/", "infra/", "terraform/", "k8s/", "helm/"];
const INSTRUCTION_FILES = [
  "AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "GEMINI.md", ".cursorrules", ".cursor/rules", ".windsurfrules",
  ".clinerules", ".github/copilot-instructions.md", ".agents", ".agents/hooks.json", ".agents/mcp_config.json",
  ".agents/plugins.json", ".agents/skills.json", ".claude/agents", ".claude/commands",
  ".claude/skills", ".claude/hooks", ".claude/rules", ".claude/settings.json", ".claude/settings.local.json",
];
const HOOK_TOOLS = [".husky", "lefthook.yml", ".lefthook.yml", "lefthook.yaml", ".pre-commit-config.yaml", ".githooks"];

/** Git Flow signs: a long-lived dev branch, and workflows that name it. */
export function detectGitFlow(repo, remoteBranches) {
  const branches = remoteBranches.filter((b) => /^origin\/(dev|develop|development)$/.test(b));
  const workflows = [];
  const dir = path.join(repo, ".github/workflows");
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      if (/(^|[\s[,'"-])(dev|develop|development)(?=[\s\],'"]|$)/m.test(text)) workflows.push(`.github/workflows/${f}`);
    }
  }
  return { candidate: branches.length > 0, branches, workflows };
}

/** The whole report. Each value is a suggestion for the owner to confirm. */
export function detect(repo, kit = loadKit()) {
  const root = path.resolve(repo);
  const g = detectGit(root);
  const pkg = readJson(root, "package.json");
  const pm = detectPackageManager(root, pkg);
  const commands = pm ? detectCommands(kit, pkg, pm.name) : { checks: { typecheck: null, lint: null, test: null }, db: [] };
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const dbPaths = DB_DIRS.filter((d) => exists(root, d)).map((d) => `${d}/`);
  const container = ["Dockerfile", "Containerfile"].filter((f) => exists(root, f));
  const nested = g.isRepo
    ? (git(root, "ls-files", "--", "*AGENTS.md", "*CLAUDE.md", "*GEMINI.md") ?? "").split("\n").filter((f) => f.includes("/"))
    : [];
  const manifest = readJson(root, ".agents/harness.json");
  const uiDeps = UI_DEPS.filter((d) => d in deps);
  const gitFlow = g.isRepo ? detectGitFlow(root, g.remoteBranches) : null;
  const mcpServers = [
    ...new Set([
      ...Object.keys(readJson(root, ".mcp.json")?.mcpServers ?? {}),
      ...Object.keys(readJson(root, ".agents/mcp_config.json")?.mcpServers ?? {}),
    ]),
  ].sort();

  return {
    kitVersion: kit.version,
    git: g,
    ecosystems: [
      ["node", "package.json"],
      ["python", "pyproject.toml"],
      ["python", "requirements.txt"],
      ["rust", "Cargo.toml"],
      ["go", "go.mod"],
      ["ruby", "Gemfile"],
      ["php", "composer.json"],
      ["java", "pom.xml"],
      ["java", "build.gradle"],
    ]
      .filter(([, f]) => exists(root, f))
      .map(([name, file]) => ({ name, file })),
    packageManager: pm,
    commands,
    existing: {
      harnessManifest: manifest ? { kitVersion: manifest.kit?.version ?? null, modules: manifest.modules ?? [] } : null,
      instructions: INSTRUCTION_FILES.filter((f) => exists(root, f)),
      nestedInstructions: nested,
      hookTools: HOOK_TOOLS.filter((f) => exists(root, f)),
      // Project-scoped MCP servers, a hint for the pm module's PM tool. Servers the owner
      // connected elsewhere (Plugins Manager, claude.ai connectors, user scope) don't show here.
      mcpServers,
    },
    suggestions: {
      values: {
        PROJECT_NAME: (pkg?.name ?? "").replace(/^@[^/]+\//, "") || path.basename(g.mainCheckout ?? root),
        OWNER: g.userName ?? null,
        GH_REPO: g.githubRepo ?? null,
        CMD_TYPECHECK: commands.checks.typecheck?.ok ? commands.checks.typecheck.command : null,
        CMD_LINT: commands.checks.lint?.ok ? commands.checks.lint.command : null,
        CMD_TEST: commands.checks.test?.ok ? commands.checks.test.command : null,
        DB_PATH: dbPaths[0] ?? null,
        DB_COMMANDS_JSON: commands.db.filter((c) => c.ok).map((c) => c.command),
        RISKY_PATHS_JSON: [...RISKY.filter((p) => exists(root, p)), ...dbPaths],
      },
      flags: {
        "has.db": dbPaths.length > 0,
        "has.ui": uiDeps.length > 0 || exists(root, "index.html"),
        "has.container": container.length > 0,
        "has.github": Boolean(g.githubRepo),
        "flow.gitFlow": gitFlow?.candidate ?? false,
      },
      evidence: {
        dbPaths,
        uiDeps,
        container,
        gitFlow,
      },
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const i = args.indexOf("--repo");
    const repo = i === -1 ? "." : args[i + 1];
    if (i !== -1 && !repo) throw new Error("--repo needs a directory");
    process.stdout.write(`${JSON.stringify(detect(repo), null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`harness-kit detect: ${e.message}\n`);
    process.exitCode = 1;
  }
}
