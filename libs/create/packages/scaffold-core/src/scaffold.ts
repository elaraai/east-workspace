/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

import { deriveNames, type ProjectNames } from "./names.js";

export type ProjectKind = "e3" | "east";

/**
 * Feature toggles passed to {@link scaffold}, keyed by the feature names a
 * template's `template.json` declares (e.g. `tests`, `ui`, `runner:east-py`).
 * A missing key falls back to the feature's manifest `default`.
 */
export type Features = Record<string, boolean>;

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
  /** Feature toggles; unspecified features use the manifest default. */
  features?: Features;
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

/** One feature in a template's `template.json` manifest. */
interface FeatureSpec {
  /** Enabled state when the caller does not specify the feature. Defaults to `true`. */
  default?: boolean;
  /** Other features that must be ON whenever this feature is ON (else scaffolding errors). */
  requires?: string[];
  /** Template-relative files that exist only while this feature is ON. */
  files?: string[];
  /** Template-relative files dropped while this feature is ON (the base a variant replaces). */
  disable?: string[];
  /** Template-relative `source -> dest` renames applied while this feature is ON. */
  rename?: Record<string, string>;
  /** package.json `dependencies` entries dropped while this feature is OFF. */
  dependencies?: string[];
  /** package.json `devDependencies` entries dropped while this feature is OFF. */
  devDependencies?: string[];
  /** package.json `scripts` entries dropped while this feature is OFF. */
  scripts?: string[];
  /** Fields deep-merged into the emitted package.json while this feature is ON. */
  packageJson?: Record<string, unknown>;
}

/**
 * A combo-conditional variant of the entry-point file. The FIRST variant whose
 * `when` features are all enabled wins: its `source` is renamed onto the
 * catch-all (`when: []`) variant's `source`, and every other variant `source`
 * is dropped. Lets several features (e.g. `ui` and `platform`) each replace the
 * entry point without the renames colliding on a shared destination — which the
 * per-feature `rename` map cannot express.
 */
interface IndexVariant {
  /** Features that must all be enabled for this variant to win. */
  when: string[];
  /** Template-relative entry-point source for this combination. */
  source: string;
}

/**
 * `template.json` describes how features prune the template. `features` maps
 * each feature to the files / deps / scripts it owns; `scriptVariants` rebuilds
 * composite scripts whose body depends on more than one feature (the first
 * variant whose `when` features are all enabled wins; none → the script is
 * dropped).
 */
interface TemplateManifest {
  features: Record<string, FeatureSpec>;
  scriptVariants?: Record<string, { when: string[]; value: string }[]>;
  /** Combo-conditional entry-point selection (see {@link IndexVariant}). */
  indexVariants?: IndexVariant[];
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

/** Manifest filename; describes feature pruning and is never emitted into the project. */
const MANIFEST_FILE = "template.json";

function substituteTokens(content: string, names: ProjectNames): string {
  return content
    .replaceAll("__PROJECT_NAME__", names.projectName)
    .replaceAll("__DISPLAY_NAME__", names.displayName)
    .replaceAll("__WORKSPACE_NAME__", names.workspaceName);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-merge `source` into `target` in place; nested plain objects merge, everything else overwrites. */
function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(source)) {
    const existing = target[k];
    if (isPlainObject(existing) && isPlainObject(v)) mergeInto(existing, v);
    else target[k] = v;
  }
}

/** Rewrite a template package.json into the emitted project's manifest. */
function transformPackageJson(
  raw: string,
  names: ProjectNames,
  version: string,
  manifest: TemplateManifest | null,
  enabled: (feature: string) => boolean,
): string {
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  pkg.name = `@elaraai/${names.projectName}`;
  pkg.description = names.displayName;
  pkg.version = "0.0.1";
  delete pkg.private;

  if (manifest) {
    const deps = pkg.dependencies as Record<string, string> | undefined;
    const devDeps = pkg.devDependencies as Record<string, string> | undefined;
    const scripts = pkg.scripts as Record<string, string> | undefined;
    for (const [feature, spec] of Object.entries(manifest.features)) {
      if (enabled(feature)) continue;
      for (const d of spec.dependencies ?? []) delete deps?.[d];
      for (const d of spec.devDependencies ?? []) delete devDeps?.[d];
      for (const s of spec.scripts ?? []) delete scripts?.[s];
    }
    for (const [name, variants] of Object.entries(manifest.scriptVariants ?? {})) {
      const match = variants.find((v) => v.when.every(enabled));
      if (match) scripts![name] = match.value;
      else delete scripts?.[name];
    }
    // Deep-merge each enabled feature's package.json fragment (e.g. the
    // platform feature's `./platform` subpath export). Runs after dep/script
    // pruning so a feature can add fields the base manifest lacks.
    for (const [feature, spec] of Object.entries(manifest.features)) {
      if (enabled(feature) && spec.packageJson) mergeInto(pkg, spec.packageJson);
    }
  }

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

function loadManifest(templateDir: string): TemplateManifest | null {
  const path = join(templateDir, MANIFEST_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as TemplateManifest;
}

export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const { kind, name, templateDir, version } = options;
  const cwd = options.cwd ?? process.cwd();
  const log = options.log ?? ((m: string) => console.log(m));

  if (!existsSync(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }

  const manifest = loadManifest(templateDir);
  const enabled = (feature: string): boolean =>
    options.features?.[feature] ?? manifest?.features[feature]?.default ?? true;

  // Enforce feature prerequisites (e.g. `platform` requires the east-py runner)
  // before writing anything, so an invalid combination fails fast and clearly.
  if (manifest) {
    for (const [feature, spec] of Object.entries(manifest.features)) {
      if (!enabled(feature)) continue;
      for (const req of spec.requires ?? []) {
        if (enabled(req)) continue;
        const label = req.startsWith("runner:") ? `the ${req.slice("runner:".length)} runner` : `the ${req} feature`;
        throw new Error(`--${feature} requires ${label}`);
      }
    }
  }

  // Resolve which template files are skipped or renamed by the feature toggles.
  const skip = new Set<string>();
  const renames: Record<string, string> = {};
  if (manifest) {
    for (const [feature, spec] of Object.entries(manifest.features)) {
      if (enabled(feature)) {
        for (const f of spec.disable ?? []) skip.add(f);
        for (const [src, dest] of Object.entries(spec.rename ?? {})) renames[src] = dest;
      } else {
        for (const f of spec.files ?? []) skip.add(f);
      }
    }
    // Combo-conditional entry-point selection: the first variant whose `when`
    // features are all enabled wins (its source is renamed onto the catch-all
    // variant's source); every other variant source is dropped. The catch-all
    // (`when: []`) variant's source is the canonical destination.
    const variants = manifest.indexVariants ?? [];
    if (variants.length > 0) {
      const dest = (variants.find((v) => v.when.length === 0) ?? variants[variants.length - 1]!).source;
      const winner = variants.find((v) => v.when.every(enabled)) ?? variants[variants.length - 1]!;
      for (const v of variants) {
        if (v.source !== winner.source) skip.add(v.source);
      }
      if (winner.source !== dest) renames[winner.source] = dest;
    }
  }

  const names = deriveNames(name, cwd);
  const inPlace = name === ".";
  const projectDir = inPlace ? cwd : join(cwd, names.projectName);

  if (!inPlace && existsSync(projectDir)) {
    throw new Error(`Directory already exists: ${projectDir}`);
  }
  mkdirSync(projectDir, { recursive: true });

  for (const srcPath of walk(templateDir)) {
    const rel = relative(templateDir, srcPath).replaceAll("\\", "/");
    if (rel === MANIFEST_FILE) continue;
    if (skip.has(rel)) continue;

    const destRel = renames[rel] ?? rel;
    const segments = destRel.split("/");
    const last = segments[segments.length - 1]!;
    segments[segments.length - 1] = DOTFILE_RENAMES[last] ?? last;
    const destPath = join(projectDir, segments.join("/"));

    mkdirSync(join(destPath, ".."), { recursive: true });

    const baseName = segments[segments.length - 1]!;
    if (baseName === "package.json") {
      const transformed = transformPackageJson(readFileSync(srcPath, "utf8"), names, version, manifest, enabled);
      writeFileSync(destPath, substituteTokens(transformed, names));
    } else if (TEXT_REPLACE_EXT.has(extOf(srcPath)) || baseName.startsWith(".")) {
      writeFileSync(destPath, substituteTokens(readFileSync(srcPath, "utf8"), names));
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }

  log(`Created ${names.projectName} (${kind}) at ${projectDir}`);

  if (options.install) {
    runInstall(kind, projectDir, enabled, log);
  }

  return { ...names, projectDir, inPlace };
}

function hasCommand(cmd: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [cmd], { stdio: "ignore" }).status === 0;
}

function runInstall(
  kind: ProjectKind,
  projectDir: string,
  enabled: (feature: string) => boolean,
  log: (m: string) => void,
): void {
  log("Installing Node dependencies (npm install)...");
  const npm = spawnSync("npm", ["install"], { cwd: projectDir, stdio: "inherit", shell: process.platform === "win32" });
  if (npm.status !== 0) {
    log("npm install failed — fix the issue and re-run `npm install`.");
    return;
  }

  if (kind === "e3" && enabled("runner:east-py")) {
    if (hasCommand("uv")) {
      log("Installing Python dependencies (uv sync)...");
      const uv = spawnSync("uv", ["sync"], { cwd: projectDir, stdio: "inherit", shell: process.platform === "win32" });
      if (uv.status !== 0) log("uv sync failed — fix the issue and re-run `uv sync`.");
    } else {
      log("uv not found — install it (https://docs.astral.sh/uv/) then run `uv sync` to set up Python.");
    }
  }
}
