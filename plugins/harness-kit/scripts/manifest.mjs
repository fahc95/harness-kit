#!/usr/bin/env node
// Writes .agents/harness.json, the record of an install: kit version, modules, the resolved
// values and flags, and two hashes per file. `rendered` is the kit's output before the
// project adapted it; `installed` is the file as committed by the install. A later sync can
// re-render the old version with the same values and tell kit changes from project changes.
//
//   node manifest.mjs check --answers <file> [--repo <dir>]   what still blocks the manifest
//   node manifest.mjs write --answers <file> [--repo <dir>]   write .agents/harness.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findAdaptMarkers } from "./contract.mjs";
import { KIT_NEW, loadAnswers, loadKit, parseArgs, renderAll, resolveTarget, SETTINGS_TARGET, sha256 } from "./render.mjs";

export const MANIFEST_TARGET = ".agents/harness.json";
export const MANIFEST_SCHEMA_VERSION = 1;

/**
 * What still has to happen before the install is done: kit:adapt markers left in installed
 * files, <target>.kit-new files not yet merged or decided, and targets that don't exist.
 */
export function pendingWork(kit, resolved, repoRoot) {
  const { files, settings } = renderAll(kit, resolved);
  const adaptMarkers = [];
  const kitNew = [];
  const missing = [];
  for (const f of files.filter((x) => !x.omitted)) {
    const abs = resolveTarget(repoRoot, f.target);
    if (fs.existsSync(abs + KIT_NEW)) kitNew.push(f.target + KIT_NEW);
    if (!fs.existsSync(abs)) {
      missing.push(f.target);
      continue;
    }
    if (f.target.endsWith(".md")) {
      for (const m of findAdaptMarkers(fs.readFileSync(abs, "utf8")).markers) {
        adaptMarkers.push({ target: f.target, line: m.line, instruction: m.instruction });
      }
    }
  }
  if (settings.length && !fs.existsSync(resolveTarget(repoRoot, SETTINGS_TARGET))) missing.push(SETTINGS_TARGET);
  return { adaptMarkers, kitNew, missing, done: !adaptMarkers.length && !kitNew.length && !missing.length };
}

/** The manifest object. Throws if the install is not finished (see pendingWork). */
export function buildManifest(kit, resolved, repoRoot) {
  const pending = pendingWork(kit, resolved, repoRoot);
  if (!pending.done) {
    const lines = [
      ...pending.missing.map((t) => `missing: ${t}`),
      ...pending.kitNew.map((t) => `not merged or decided yet: ${t}`),
      ...pending.adaptMarkers.map((m) => `kit:adapt left: ${m.target}:${m.line}`),
    ];
    throw new Error(`the install is not finished:\n${lines.map((l) => `  ${l}`).join("\n")}`);
  }
  const { files, settings } = renderAll(kit, resolved);
  const hashOnDisk = (target) => sha256(fs.readFileSync(resolveTarget(repoRoot, target), "utf8"));
  const entries = files
    .filter((f) => !f.omitted)
    .map((f) => ({
      target: f.target,
      module: f.module,
      template: f.template,
      onExisting: f.onExisting,
      ...(f.mode ? { mode: f.mode } : {}),
      rendered: sha256(f.content),
      installed: hashOnDisk(f.target),
    }))
    .sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kit: { name: "harness-kit", version: kit.version },
    installedAt: resolved.values.DATE,
    modules: resolved.modules,
    values: resolved.values,
    flags: resolved.flags,
    files: entries,
    settings: settings.length
      ? { target: SETTINGS_TARGET, fragments: settings.map((s) => s.template), installed: hashOnDisk(SETTINGS_TARGET) }
      : null,
  };
}

export function writeManifest(kit, resolved, repoRoot) {
  const manifest = buildManifest(kit, resolved, repoRoot);
  const abs = resolveTarget(repoRoot, MANIFEST_TARGET);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function main(argv, { kit = loadKit(), out = process.stdout } = {}) {
  const { command, opts } = parseArgs(argv);
  const repo = path.resolve(opts.repo ?? ".");
  const resolved = loadAnswers(kit, opts.answers);
  if (command === "check") {
    const pending = pendingWork(kit, resolved, repo);
    out.write(`${JSON.stringify(pending, null, 2)}\n`);
    return pending.done ? 0 : 1;
  }
  if (command === "write") {
    const m = writeManifest(kit, resolved, repo);
    out.write(`wrote ${MANIFEST_TARGET}: kit ${m.kit.version}, ${m.modules.length} modules, ${m.files.length} files\n`);
    return 0;
  }
  throw new Error(`unknown command "${command}"; use check or write`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`harness-kit manifest: ${e.message}\n`);
    process.exitCode = 1;
  }
}
