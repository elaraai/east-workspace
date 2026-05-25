/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

import { deriveNames, type ProjectNames } from "./names.js";

export type ProjectKind = "e3" | "east";

export interface ScaffoldOptions {
  /** Project type to scaffold. */
  kind: ProjectKind;
  /** Raw project name, or "." to scaffold into the current directory. */
  name: string;
  /** Where to create the project (the parent dir, or the project dir for "."). Defaults to process.cwd(). */
  cwd?: string;
  /** Directory holding the template trees: `<templatesDir>` IS the chosen kind's template root. */
  templateDir: string;
  /** Version to pin `@elaraai/*` deps to when rewriting `workspace:*` (e.g. "1.4.0"). */
  version: string;
  /** Install dependencies after writing files (npm install, plus uv sync for e3). */
  install?: boolean;
  /** Logger; defaults to console.log. */
  log?: (msg: string) => void;
}

export interface ScaffoldResult extends ProjectNames {
  /** Absolute path of the created project. */
  projectDir: string;
  /** True when scaffolding into an existing current directory ("."). */
  inPlace: boolean;
}

const TEXT_REPLACE_EXT = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".json", ".toml", ".md", ".txt",
  ".yml", ".yaml", ".py", ".nvmrc", ".python-version", "",
]);

/** Files stored under a sanitized name in the template (npm mangles real dotfiles on publish). */
const DOTFILE_RENAMES: Record<string, string> = {
  gitignore: ".gitignore",
  npmrc: ".npmrc",
};

function substituteTokens(content: string, names: ProjectNames): string {
  return content
    .replaceAll("__PROJECT_NAME__", names.projectName)
    .replaceAll("__DISPLAY_NAME__", names.displayName)
    .replaceAll("__WORKSPACE_NAME__", names.workspaceName);
}

/** Rewrite a template package.json into the emitted project's manifest. */
function transformPackageJson(raw: string, names: ProjectNames, version: string): string {
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  pkg.name = `@elaraai/${names.projectName}`;
  pkg.description = names.displayName;
  pkg.version = "0.0.1";
  delete pkg.private;

  const pin = `^${version}`;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[field] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (spec.startsWith("workspace:")) deps[name] = pin;
    }
  }
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot);
}

export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const { kind, name, templateDir, version } = options;
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? ((m: string) => console.log(m));

  if (!existsSync(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }

  const names = deriveNames(name, cwd);
  const inPlace = name === ".";
  const projectDir = inPlace ? cwd : join(cwd, names.projectName);

  if (!inPlace && existsSync(projectDir)) {
    throw new Error(`Directory already exists: ${projectDir}`);
  }
  mkdirSync(projectDir, { recursive: true });

  for (const srcPath of walk(templateDir)) {
    const rel = relative(templateDir, srcPath);
    const segments = rel.split(/[/\\]/);
    const last = segments[segments.length - 1]!;
    segments[segments.length - 1] = DOTFILE_RENAMES[last] ?? last;
    const destRel = segments.join("/");
    const destPath = join(projectDir, destRel);

    mkdirSync(join(destPath, ".."), { recursive: true });

    const baseName = segments[segments.length - 1]!;
    if (baseName === "package.json") {
      const manifest = transformPackageJson(readFileSync(srcPath, "utf8"), names, version);
      writeFileSync(destPath, substituteTokens(manifest, names));
    } else if (TEXT_REPLACE_EXT.has(extOf(srcPath)) || baseName.startsWith(".")) {
      writeFileSync(destPath, substituteTokens(readFileSync(srcPath, "utf8"), names));
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }

  log(`Created ${names.projectName} (${kind}) at ${projectDir}`);

  if (options.install) {
    runInstall(kind, projectDir, log);
  }

  return { ...names, projectDir, inPlace };
}

function hasCommand(cmd: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [cmd], { stdio: "ignore" }).status === 0;
}

function runInstall(kind: ProjectKind, projectDir: string, log: (m: string) => void): void {
  log("Installing Node dependencies (npm install)...");
  const npm = spawnSync("npm", ["install"], { cwd: projectDir, stdio: "inherit", shell: process.platform === "win32" });
  if (npm.status !== 0) {
    log("npm install failed — fix the issue and re-run `npm install`.");
    return;
  }

  if (kind === "e3") {
    if (hasCommand("uv")) {
      log("Installing Python dependencies (uv sync)...");
      const uv = spawnSync("uv", ["sync"], { cwd: projectDir, stdio: "inherit", shell: process.platform === "win32" });
      if (uv.status !== 0) log("uv sync failed — fix the issue and re-run `uv sync`.");
    } else {
      log("uv not found — install it (https://docs.astral.sh/uv/) then run `uv sync` to set up Python.");
    }
  }
}
