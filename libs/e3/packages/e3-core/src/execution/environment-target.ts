/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Installing an environment for a platform that is not this machine's, and
 * over the tier a rack runs it over: the platforms environments are
 * installed for, what a build for one may not hold, the interpreter it
 * carries, and what it leaves to the tier (#1655).
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { promises as fs, type Stats } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { extract as tarExtract } from 'tar-stream';
import { canonicalPythonName } from '@elaraai/e3';
import {
  pythonMinor, readDistributionMetadata, recordedSiteFiles, tierImports, type InstalledDistribution, type TierManifest,
} from '../tier-manifest.js';
import { TIER_GATE_MODULE, TIER_GATE_PATH_FILE, tierGateModule } from '../tier-gate.js';
import type { ProcessSettings } from './processExec.js';
import { pathExists, run } from './environment-install.js';

/**
 * The platform an environment is installed for, when it is not installed to
 * run on this machine: a rack's, whose guest is another machine.
 */
export interface EnvironmentTarget {
  /**
   * The platform, by the name uv gives it (its `--python-platform`): an
   * `x86_64` or `aarch64` Linux with glibc (`x86_64-manylinux_2_28`,
   * `aarch64-manylinux_2_17`, `x86_64-unknown-linux-gnu`), or macOS
   * (`aarch64-apple-darwin`, `x86_64-apple-darwin`).
   */
  readonly platform: string;
  /**
   * The tier the environment is built over, by what its image holds: the
   * rack then composes it over that tier. For an environment that fits it
   * alone (`environmentFitsTier`). Absent, it is built whole, with an
   * interpreter of its own.
   */
  readonly over?: TierManifest;
}

/**
 * Why an environment is not installed for another platform:
 * - `tools`, `image`: its kind is files or an image of one platform;
 * - `windows-host`: this machine is Windows, where a built environment has
 *   another layout than the target's;
 * - `no-wheel:<package>`: a dependency has no wheel for the platform;
 * - `native-package:<package>`: one of the project's own packages holds
 *   native code, built for the platform it was captured on;
 * - `pnpm`: its lock is pnpm's, and this machine's pnpm installs for its own
 *   platform alone.
 */
export type EnvironmentTargetReason =
  | 'tools' | 'image' | 'windows-host' | 'pnpm'
  | `no-wheel:${string}` | `native-package:${string}`;

/**
 * An environment that cannot be installed for another platform, and why: no
 * failure of a build, but a thing no build does. Nothing is compiled for a
 * platform that is not this machine's.
 */
export class EnvironmentTargetRefused extends Error {
  /**
   * @param reason - Why, as a caller reports it
   * @param message - The same in words
   */
  constructor(readonly reason: EnvironmentTargetReason, message: string) {
    super(message);
    this.name = 'EnvironmentTargetRefused';
  }
}

/** An environment installed for another platform. */
export interface TargetEnvironment {
  /** The directory it was installed in, absolute. */
  readonly dir: string;
  /** The directory of the interpreter it carries, relative to {@link dir};
   *  `null` for an environment that carries none. */
  readonly interpreter: string | null;
  /** The files and links the project's own packages installed, relative to
   *  {@link dir} with `/` between segments, sorted: what changes when the
   *  project's code does. Everything else is what its lock names. */
  readonly project: readonly string[];
  /** How many distributions were left to the tier it was built over, which
   *  holds them the same; `null` for an environment built whole. */
  readonly fromTier: number | null;
}

/**
 * A platform environments are installed for.
 *
 * @internal
 */
export interface TargetPlatform {
  /** uv's name for it. */
  readonly name: string;
  /** The interpreter build uv is asked for, after `cpython-<minor>-`. */
  readonly python: string;
  /** npm's and pnpm's flags for it. */
  readonly node: readonly string[];
  /** Whether this machine is of the platform. */
  readonly host: boolean;
}

/** Where a python environment built for another platform keeps its
 *  interpreter, relative to its tree. */
const CARRIED_INTERPRETER_DIR = '.python';

/** This machine's glibc, as `[major, minor]`; `null` where it has none, or
 *  it cannot be told. Read once: Node writes a whole report to tell it. */
let glibc: [number, number] | null | undefined;
function glibcVersion(): [number, number] | null {
  if (glibc === undefined) {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
    const version = /^(\d+)\.(\d+)/.exec(report?.header?.glibcVersionRuntime ?? '');
    glibc = version === null ? null : [Number(version[1]), Number(version[2])];
  }
  return glibc;
}

/**
 * This machine's own platform, as an {@link EnvironmentTarget} names one: what
 * an agent that runs environments on the machine it is on says it runs.
 *
 * @returns The platform, a glibc Linux's as the oldest of `manylinux_2_28` and
 *   `manylinux_2_17` it meets; `null` on Windows, a Linux without glibc, and a
 *   processor that is neither x86-64 nor arm64
 *
 * @example
 * ```ts
 * const target = hostEnvironmentPlatform(); // 'x86_64-manylinux_2_28'
 * ```
 */
export function hostEnvironmentPlatform(): string | null {
  const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : null;
  if (arch === null) return null;
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  if (process.platform !== 'linux') return null;
  const version = glibcVersion();
  if (version === null || version[0] < 2 || (version[0] === 2 && version[1] < 17)) return null;
  return `${arch}-manylinux_${version[0] > 2 || version[1] >= 28 ? '2_28' : '2_17'}`;
}

/**
 * Reads a platform's name (see {@link EnvironmentTarget.platform}).
 *
 * @internal
 * @param platform - The name
 * @returns The platform
 * @throws {Error} When it is not one environments are installed for
 */
export function targetPlatformOf(platform: string): TargetPlatform {
  const match = /^(x86_64|aarch64)-(?:(manylinux2014|manylinux_\d+_\d+|unknown-linux-gnu)|apple-darwin)$/.exec(platform);
  if (match === null) {
    throw new Error(`environment materialization: no environment is installed for the platform '${platform}': ` +
      'an x86_64 or aarch64 Linux with glibc (as x86_64-manylinux_2_28) or macOS (as aarch64-apple-darwin) is');
  }
  const arch = match[1]!;
  const cpu = arch === 'x86_64' ? 'x64' : 'arm64';
  const linux = match[2] !== undefined;
  return {
    name: platform,
    python: linux ? `linux-${arch}-gnu` : `macos-${arch}-none`,
    node: linux ? ['--os=linux', `--cpu=${cpu}`, '--libc=glibc'] : ['--os=darwin', `--cpu=${cpu}`],
    host: process.arch === cpu && (linux ? process.platform === 'linux' && glibcVersion() !== null : process.platform === 'darwin'),
  };
}

/** One thing in an installed tree. */
export interface InstalledEntry {
  /** Its path, relative to the tree, with `/` between segments */
  readonly rel: string;
  /** What `lstat` says of it: a link is itself, never what it names */
  readonly stat: Stats;
}

/**
 * Every file, directory and link under a tree an environment was installed
 * in, in no order. A link is not followed, so a directory it names is walked
 * only where it is.
 *
 * @internal
 * @param root - The tree
 * @returns Its entries
 */
export async function installedTree(root: string): Promise<InstalledEntry[]> {
  const into: InstalledEntry[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      into.push({ rel: path.relative(root, full).split(path.sep).join('/'), stat: await fs.lstat(full) });
      if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(root);
  return into;
}

/**
 * Every file and link under `root`, relative to it with `/` between segments,
 * each with what tells one written since from one left alone: its size, when
 * it was changed, and its inode.
 *
 * @internal
 * @param root - The tree
 * @returns Each file and link, by its path
 */
export async function treeEntries(root: string): Promise<Map<string, string>> {
  return new Map((await installedTree(root)).filter(({ stat }) => !stat.isDirectory())
    .map(({ rel, stat }) => [rel, `${stat.size}:${stat.mtimeMs}:${stat.ino}`]));
}

/**
 * The files and links of `after` that `before` lacks, or holds otherwise.
 *
 * @internal
 * @param before - A tree's entries ({@link treeEntries})
 * @param after - The same tree's entries since
 * @returns Their paths
 */
export function changedSince(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...after].filter(([file, state]) => before.get(file) !== state).map(([file]) => file);
}

/**
 * A wheel's distribution, and whether it runs on every platform, from its file
 * name: `{distribution}-{version}(-{build})?-{python}-{abi}-{platform}.whl`,
 * pure when its ABI tag is `none` and its platform tag `any`.
 *
 * @internal
 * @param filename - The wheel's file name
 * @returns Its distribution, and whether it is pure
 * @throws {Error} When it is not a wheel's file name
 */
export function wheelOf(filename: string): { distribution: string; pure: boolean } {
  const parts = filename.replace(/\.whl$/, '').split('-');
  if (parts.length < 5) throw new Error(`environment materialization: '${filename}' is not a wheel's file name`);
  return { distribution: parts[0]!, pure: parts[parts.length - 2] === 'none' && parts[parts.length - 1] === 'any' };
}

/**
 * The refusal a failed sync is, when uv says a dependency has no wheel for the
 * platform.
 *
 * @internal
 * @param err - What the sync threw
 * @param platform - The platform it installed for
 * @returns The refusal, or `null` for any other failure
 */
export function unbuiltWheel(err: unknown, platform: TargetPlatform): EnvironmentTargetRefused | null {
  const said = err instanceof Error ? err.message : String(err);
  const match = /Distribution `([^`\s=]+)==[^`]*` can't be installed because it is marked as `--no-build` but has no binary distribution/.exec(said);
  if (match === null) return null;
  return new EnvironmentTargetRefused(`no-wheel:${match[1]!}`,
    `environment materialization: ${match[1]!} has no wheel for ${platform.name}, and nothing is built for a platform that is not this machine's`);
}

/** What a project's packed package holds that matters to another platform:
 *  its name, and the first native addon in it. */
function scanTarball(tarball: Buffer): Promise<{ name: string | null; addon: string | null }> {
  return new Promise((resolve, reject) => {
    const found: { name: string | null; addon: string | null } = { name: null, addon: null };
    const ex = tarExtract();
    ex.on('entry', (header, stream, next) => {
      // Past the leading `package/` segment npm pack adds.
      const rel = header.name.replace(/^[^/]+\//, '');
      if (found.addon === null && rel.endsWith('.node')) found.addon = rel;
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => { if (rel === 'package.json') chunks.push(chunk); });
      stream.on('error', reject);
      stream.on('end', () => {
        if (rel === 'package.json') {
          try {
            const manifest = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { name?: unknown };
            if (typeof manifest.name === 'string') found.name = manifest.name;
          } catch {
            // Not a manifest npm would install either: the install says so.
          }
        }
        next();
      });
    });
    ex.on('error', reject);
    ex.on('finish', () => resolve(found));
    Readable.from(gunzipSync(tarball)).pipe(ex);
  });
}

/**
 * Refuses a project's packed package that holds a native addon: it was built
 * for the platform it was packed on, and no install here builds one.
 *
 * @param tarball - The package, as `npm pack` wrote it
 * @param name - The package's name, when its environment gives it
 * @internal
 * @param platform - The platform the environment is installed for
 * @throws {EnvironmentTargetRefused} When the package holds a `.node` file
 */
export async function refuseNativeAddon(tarball: Buffer, name: string | null, platform: TargetPlatform): Promise<void> {
  const found = await scanTarball(tarball);
  if (found.addon === null) return;
  const named = name ?? found.name ?? 'a project package';
  throw new EnvironmentTargetRefused(`native-package:${named}`,
    `environment materialization: ${named} holds a native addon (${found.addon}), built for the platform it was packed on, ` +
    `and nothing is built for ${platform.name}`);
}

/**
 * Gives a python environment built for another platform an interpreter of its
 * own: that platform's build of the Python its virtualenv was made with, kept
 * in the tree, and the virtualenv's `python` a relative link to it.
 *
 * @remarks
 * Python finds a virtualenv's interpreter through that link, wherever the
 * tree is put, so the `home` its `pyvenv.cfg` names is not read; it is set to
 * where the interpreter is beside the virtualenv, in place of a path of this
 * machine's. `--no-bin` keeps uv from linking the interpreter into the user's
 * own bin directory.
 *
 * @internal
 * @returns The interpreter's directory, relative to the tree
 * @throws {Error} When the virtualenv names no Python, or uv installs none
 *   for the platform
 */
export async function carryInterpreter(buildDir: string, platform: TargetPlatform, settings: ProcessSettings): Promise<string> {
  const venv = path.join(buildDir, '.venv');
  const config = await fs.readFile(path.join(venv, 'pyvenv.cfg'), 'utf-8');
  const version = /^version_info\s*=\s*(\d+)\.(\d+)/m.exec(config);
  if (version === null) throw new Error('environment materialization: the virtualenv names no Python version');
  const minor = `${version[1]!}.${version[2]!}`;
  const carried = path.join(buildDir, CARRIED_INTERPRETER_DIR);
  await run('uv', ['python', 'install', '--no-bin', '--install-dir', carried, `cpython-${minor}-${platform.python}`],
    buildDir, 'interpreter install', settings);
  // Beside the interpreter uv leaves a link to it by its minor version, which
  // names this machine's path, and files of its own: the interpreter alone
  // is the environment's.
  let installed: string | null = null;
  for (const entry of await fs.readdir(carried, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(`cpython-${minor}.`)) installed = entry.name;
    else await fs.rm(path.join(carried, entry.name), { recursive: true, force: true });
  }
  const python = `python${minor}`;
  if (installed === null || !await pathExists(path.join(carried, installed, 'bin', python))) {
    throw new Error(`environment materialization: uv installed no ${python} for ${platform.name}`);
  }
  const link = path.join(venv, 'bin', 'python');
  await fs.rm(link, { force: true });
  await fs.symlink(path.posix.join('..', '..', CARRIED_INTERPRETER_DIR, installed, 'bin', python), link);
  await fs.writeFile(path.join(venv, 'pyvenv.cfg'),
    config.replace(/^home\s*=.*$/m, `home = ${path.posix.join('..', CARRIED_INTERPRETER_DIR, installed, 'bin')}`));
  return CARRIED_INTERPRETER_DIR;
}

/** Removes every directory under `dir` that holds nothing, and so each that
 *  held only such directories; `dir` itself stays. */
async function removeEmptyDirectories(dir: string): Promise<boolean> {
  let empty = true;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory() && await removeEmptyDirectories(at)) await fs.rmdir(at);
    else empty = false;
  }
  return empty;
}

/**
 * Leaves to its tier what the tier holds of a python environment built for
 * it, and points the environment's virtualenv at the tier.
 *
 * @remarks
 * Once the environment is installed whole and checked:
 * - the code of each distribution the tier holds the same, by its name, its
 *   version and the files it installed, is removed from the site directory
 *   (`leftToTier` says which). Its metadata stays, so whatever lists
 *   what is installed — `importlib.metadata`, `pkg_resources`, a scan of
 *   `sys.path` — finds it, its version and its entry points, as where the
 *   environment runs whole; its record names files the tier holds. Its
 *   scripts stay: they run on the environment's interpreter, which finds the
 *   distribution in the tier. The bytecode uv compiled of a module that is
 *   removed goes with it: no record lists it;
 * - the virtualenv's `pyvenv.cfg` names the tier's base interpreter's
 *   directory as its `home`, and the tier's Python as its version;
 * - the environment imports from the tier through a gate of its own
 *   (`tier-gate.ts`), which a path file in the site directory imports, after
 *   every path file of the environment's: the tier's site directory is not
 *   put on `sys.path`, nor any directory of it on a package's path, and the
 *   gate finds in it the code left to it, and nothing else, as
 *   {@link tierImports} says. Inside a namespace package both hold parts of,
 *   a name not left to the tier is looked for in the environment's own parts
 *   alone;
 * - the link to this machine's interpreter is removed. No layer holds a link
 *   that leads out of the environment, so the agent that composes it over
 *   its tier makes the link to the tier's interpreter
 *   (`composeEnvironmentOverTier`).
 *
 * @internal
 * @returns How many distributions were left to the tier
 * @throws {Error} When the virtualenv is not of the tier's Python
 */
export async function leaveToTier(buildDir: string, tier: TierManifest): Promise<number> {
  const venv = path.join(buildDir, '.venv');
  const minor = pythonMinor(tier.python.version);
  const config = await fs.readFile(path.join(venv, 'pyvenv.cfg'), 'utf-8');
  const made = /^version_info\s*=\s*(\d+)\.(\d+)/m.exec(config);
  if (made === null || `${made[1]!}.${made[2]!}` !== minor) {
    throw new Error(`environment materialization: the virtualenv is of Python ${made === null ? 'no version' : `${made[1]!}.${made[2]!}`}, ` +
      `not the tier's ${minor}: an environment whose lock does not take the tier's Python is built whole`);
  }
  const site = path.join(venv, 'lib', `python${minor}`, 'site-packages');
  const installed: Array<InstalledDistribution & { info: string }> = [];
  for (const info of (await fs.readdir(site)).filter((name) => name.endsWith('.dist-info')).sort()) {
    let metadata: string;
    let record: string;
    try {
      metadata = await fs.readFile(path.join(site, info, 'METADATA'), 'utf-8');
      record = await fs.readFile(path.join(site, info, 'RECORD'), 'utf-8');
    } catch (err) {
      // One that does not say what it installed cannot be told from the
      // tier's: it stays
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    const read = readDistributionMetadata(metadata);
    if (read !== null) installed.push({ ...read, record, info });
  }
  // What it leaves to the tier, and imports from it, worked out once
  const imports = tierImports(installed, tier);
  const left = new Set(imports.distributions);
  const root = `${site}${path.sep}`;
  // The modules removed, by their directory: what uv compiled of each, which
  // no record lists, goes with it
  const modules = new Map<string, Set<string>>();
  for (const distribution of installed) {
    if (!left.has(canonicalPythonName(distribution.name))) continue;
    for (const { file } of recordedSiteFiles(distribution.record)) {
      // Its metadata stays
      if (file.split('/')[0] === distribution.info) continue;
      // A record is a wheel's own account of itself: only what it names in
      // the site directory is removed
      const at = path.resolve(site, ...file.split('/'));
      if (!at.startsWith(root)) continue;
      await fs.rm(at, { force: true });
      if (at.endsWith('.py')) {
        const dir = path.dirname(at);
        modules.set(dir, (modules.get(dir) ?? new Set()).add(path.basename(at, '.py')));
      }
    }
  }
  for (const [dir, names] of modules) {
    const cache = path.join(dir, '__pycache__');
    let compiled: string[];
    try {
      compiled = await fs.readdir(cache);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    // `<module>.<interpreter tag>.pyc`, and `.opt-1`, `.opt-2` among its tags
    for (const name of compiled) if (name.endsWith('.pyc') && names.has(name.slice(0, name.indexOf('.')))) await fs.rm(path.join(cache, name), { force: true });
  }
  await removeEmptyDirectories(site);

  // The interpreter is the tier's. This machine's is linked by its path here
  const bin = path.join(venv, 'bin');
  for (const name of await fs.readdir(bin)) {
    const at = path.join(bin, name);
    if ((await fs.lstat(at)).isSymbolicLink() && path.isAbsolute(await fs.readlink(at))) await fs.rm(at);
  }
  await fs.writeFile(path.join(venv, 'pyvenv.cfg'), config
    .replace(/^home\s*=.*$/m, `home = ${path.posix.dirname(tier.python.base)}`)
    .replace(/^version_info\s*=.*$/m, `version_info = ${tier.python.version}`));
  // What it imports from the tier, through its gate: a line that begins
  // `import` is run as the site directory is read
  await fs.writeFile(path.join(site, `${TIER_GATE_MODULE}.py`), tierGateModule(tier.python.site, imports));
  await fs.writeFile(path.join(site, TIER_GATE_PATH_FILE), `import ${TIER_GATE_MODULE}\n`);
  return left.size;
}

/**
 * What a build for another platform made, beside its tree.
 *
 * @internal
 */
export type TargetParts = Pick<TargetEnvironment, 'interpreter' | 'fromTier'> & { project: string[] };
