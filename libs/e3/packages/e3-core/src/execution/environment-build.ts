/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Building an environment of each kind in its build directory: a python
 * project's or workspace's, a node project's or workspace's, and a set of
 * tools, for this machine or for another platform (`environment-target.ts`).
 *
 * @packageDocumentation
 */

import * as path from 'node:path';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { extract as tarExtract } from 'tar-stream';
import { BlobType, decodeBeast2For, isTypeValueEqual, readBeast2Type, toEastTypeValue } from '@elaraai/east';
import { canonicalPythonName, pythonLeftOut, pythonLockSettings, readRequiredDistribution } from '@elaraai/e3';
import type { EnvironmentSpec } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/index.js';
import { pythonMinor, type TierManifest } from '../tier-manifest.js';
import { giveDirectory, type ProcessSettings } from './processExec.js';
import { giveDirectories, pathExists, run } from './environment-install.js';
import {
  carryInterpreter, changedSince, EnvironmentTargetRefused, leaveToTier, refuseNativeAddon, treeEntries, unbuiltWheel, wheelOf,
  type TargetParts, type TargetPlatform,
} from './environment-target.js';

/** An environment's files are objects holding their bytes as beast2 Blobs. */
const FILE_TYPE = toEastTypeValue(BlobType);
const decodeFile = decodeBeast2For(BlobType);

/**
 * Decodes the object an environment names for one of its files: the file's
 * bytes, which an export stores as a beast2 Blob.
 *
 * @remarks
 * Whatever reads an environment's files decodes them here, so a file an older
 * SDK stored raw is refused in one set of words wherever it is read.
 *
 * @param data - The object's bytes
 * @param hash - The object's hash, which a refusal names
 * @returns The file's bytes
 * @throws {Error} When the object is not a beast2 Blob: the raw file an older
 *   e3 SDK exported, whose package is re-exported
 */
export function decodeEnvironmentFile(data: Uint8Array, hash: string): Uint8Array {
  let isFile = false;
  try {
    isFile = isTypeValueEqual(readBeast2Type(data), FILE_TYPE);
  } catch {
    // Not beast2 at all
  }
  if (!isFile) {
    throw new Error(`the environment file ${hash} was exported by an older e3 SDK — re-export its package with the current one`);
  }
  return decodeFile(data);
}

/**
 * Reads a file an environment names (see {@link decodeEnvironmentFile}).
 *
 * @internal
 * @param storage - Storage backend holding it
 * @param repo - Repository path
 * @param hash - The object it is stored as
 * @returns Its bytes
 * @throws {Error} When the object is not a file as the current SDK stores one
 */
export async function readFile(storage: StorageBackend, repo: string, hash: string): Promise<Buffer> {
  return Buffer.from(decodeEnvironmentFile(await storage.objects.read(repo, hash), hash));
}

async function writeBlob(storage: StorageBackend, repo: string, hash: string, dest: string): Promise<void> {
  await fs.writeFile(dest, await readFile(storage, repo, hash));
}

/**
 * The file a node environment's lockfile is written as: npm's, which is JSON,
 * or pnpm's, which is YAML.
 *
 * @remarks
 * An environment spec stores a lockfile's bytes and not its name, so the name
 * is told from the content.
 *
 * @param lock - The lockfile's bytes
 * @returns Its file name
 */
export function nodeLockFilename(lock: Uint8Array): 'package-lock.json' | 'pnpm-lock.yaml' {
  const head = new TextDecoder().decode(lock.subarray(0, 512)).trimStart();
  return head.startsWith('{') ? 'package-lock.json' : 'pnpm-lock.yaml';
}

/** A python environment's spec: a project that is its own root, or members
 *  of a workspace. */
type PythonSpec = Extract<EnvironmentSpec, { type: 'python' | 'workspace_python' }>;

/**
 * What a sync of a python environment's locked third-party closure is asked,
 * for every platform: third-party code alone. `--no-install-workspace` skips
 * every workspace member and the root, `--no-install-local` skips any
 * local/path source (a sibling member's dir need not even exist on this
 * machine: a frozen sync reads the lock, and no member's manifest). The
 * project's own code comes from the captured sdists.
 */
const SYNC = ['sync', '--frozen', '--no-install-workspace', '--no-install-local'];

/**
 * A distribution's name as an environment's spec carries it, which is wire
 * data given to an install as an argument.
 *
 * @throws {Error} When it is not a package's name, as PEP 508 writes one
 */
function distributionName(name: string, what: string): string {
  if (!/^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(name)) {
    throw new Error(`environment materialization: ${what} '${name}' is not a package's name`);
  }
  return name;
}

/**
 * A distribution an environment's spec requires, which is wire data given to
 * an install as an argument: a package's name, or one with the extras it is
 * installed with (`elaraai-east-py-datascience[lightning]`).
 *
 * @throws {Error} When it is neither
 */
function requiredDistribution(required: string): string {
  const read = readRequiredDistribution(required);
  if (read === null) throw new Error(`environment materialization: the required distribution '${required}' is not a package's name`);
  distributionName(read.name, 'the required distribution');
  for (const extra of read.extras) distributionName(extra, `the extra of the required distribution '${read.name}'`);
  return required;
}

/**
 * Whose locked dependencies a python environment's sync installs: the whole
 * lock, for a project that is its own root, whose lock is all its own; and
 * for members of a workspace, theirs alone — what `uv export --frozen
 * --no-default-groups --package <member>` lists — so nothing the workspace's
 * root or another member depends on is installed (#1654), and none of a
 * member's development groups, which are its tests' and its tools' and no
 * task's.
 *
 * @throws {Error} When a workspace environment names no member, or one that
 *   is not a package's name
 */
function syncedPackages(spec: PythonSpec): string[] {
  if (spec.type === 'python') return ['--all-packages'];
  if (spec.value.subjects.length === 0) throw new Error('environment materialization: a workspace environment names no member');
  return ['--no-default-groups', ...spec.value.subjects.flatMap((subject) => ['--package', distributionName(subject, 'the member')])];
}

/** Writes a python environment's manifest and lock into the build directory. */
async function writePythonProject(
  storage: StorageBackend, repo: string, spec: PythonSpec, buildDir: string,
): Promise<void> {
  await writeBlob(storage, repo, spec.value.pyproject, path.join(buildDir, 'pyproject.toml'));
  await writeBlob(storage, repo, spec.value.lock, path.join(buildDir, 'uv.lock'));
}

/**
 * Whether a python environment's lock explains every incompatibility a failed
 * `uv pip check` of it found: each a distribution installed at another
 * version than a package depending on it asks, which the lock's workspace
 * overrides, or one not installed, which it excludes or overrides away
 * ({@link pythonLockSettings}).
 *
 * @remarks
 * The check reads each installed distribution's own requirements, and knows
 * nothing of the settings the lock was resolved under: under an override of
 * `shap>=0.51.0`, econml's `shap<0.49.0` fails it, though the sync installed
 * the shap the lock holds. An override may also install nothing of a name
 * (`nvidia-nccl-cu12 ; sys_platform == 'never'`, the idiom from before
 * excludes). Any other incompatibility is the build's fault, a local package
 * the capture missed among them, and so is a line of any other kind, and a
 * count of incompatibilities that its lines do not make up.
 *
 * Every backend that builds an environment from its spec checks it with
 * this, so a lock's settings pass alike wherever it is built; e3-core's spec
 * runs the real `uv pip check`, so a uv that words its account otherwise
 * fails there first.
 *
 * @param said - What the failed check said, its error output among it
 * @param settings - The distributions the lock's workspace overrides and
 *   excludes, by PEP 503 name
 * @returns Whether the lock explains them all
 * @example
 * lockExplainsCheck('Found 1 incompatibility\nThe package `econml` requires `shap<0.49.0`, but `0.52.0` is installed',
 *   { overrides: ['shap'], excludes: [] }); // true
 */
export function lockExplainsCheck(said: string, settings: { readonly overrides: readonly string[]; readonly excludes: readonly string[] }): boolean {
  const lines = said.split(/\r?\n/);
  const counts = lines.map((line) => /^Found (\d+) incompatibilit(?:y|ies)$/.exec(line)).filter((count): count is RegExpExecArray => count !== null);
  const found = lines.filter((line) => line.startsWith('The package `'));
  if (counts.length !== 1 || found.length === 0 || found.length !== Number(counts[0]![1])) return false;
  return found.every((line) => {
    const read = /^The package `[^`]+` requires `([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)[^`]*`, but (?:(`[^`]+` is installed)|it's not installed)$/.exec(line);
    if (read === null) return false;
    const name = canonicalPythonName(read[1]!);
    // Another version installed: an override's. None installed: an exclude's, or an override's that installs none.
    return settings.overrides.includes(name) || (read[2] === undefined && settings.excludes.includes(name));
  });
}

/**
 * Checks that what a python environment installed is whole, with `uv pip
 * check`: a failure its lock explains ({@link lockExplainsCheck}) is the
 * resolution its workspace asked for, and passes; any other fails the build.
 */
async function checkPython(buildDir: string, venv: string, settings: ProcessSettings, platform?: TargetPlatform): Promise<void> {
  try {
    await run('uv', ['pip', 'check', '--python', venv, ...(platform === undefined ? [] : ['--python-platform', platform.name])], buildDir,
      'environment consistency check', settings);
  } catch (err) {
    const said = err instanceof Error ? err.message : String(err);
    if (!lockExplainsCheck(said, pythonLockSettings(await fs.readFile(path.join(buildDir, 'uv.lock'), 'utf-8')))) throw err;
  }
}

/** Writes a python environment's captured sdists under the build directory's
 *  `.sdists`, and answers their paths. */
async function writeSdists(
  storage: StorageBackend, repo: string, spec: PythonSpec, buildDir: string,
): Promise<string[]> {
  const sdistDir = path.join(buildDir, '.sdists');
  await fs.mkdir(sdistDir);
  const files: string[] = [];
  for (const sdist of spec.value.sdists) {
    // Installers derive the package name from `name-version.tar.gz`;
    // basename() guards against path segments in wire data.
    const f = path.join(sdistDir, path.basename(sdist.filename));
    await writeBlob(storage, repo, sdist.hash, f);
    files.push(f);
  }
  return files;
}

/**
 * Builds a python environment in `buildDir`.
 *
 * @remarks
 * Installed ({@link installPython}), and then, for another platform, given an
 * interpreter of its own, or over a tier, left to the tier what the tier
 * holds the same ({@link leaveToTier}). A build over a tier installs every
 * distribution before it leaves to the tier what the tier holds, so its
 * install is the same for every tier of one Python and platform: the builds
 * over tiers of one Python that run together share it ({@link sharedInstall}).
 *
 * @param platform - The platform it is installed for, when not this machine's:
 *   its dependencies are then the platform's wheels alone, copied, the
 *   project's packages are built to wheels here and must be pure, and it
 *   carries the platform's build of its Python
 * @param over - The tier it is built over, with a platform, and the hash of
 *   the environment's spec: its virtualenv is then of the tier's Python, what
 *   the tier holds the same is left to it once all is installed and checked,
 *   and it carries no interpreter
 * @internal
 * @returns The interpreter it carries and the project's own files, when a
 *   platform is given, and how many distributions were left to a tier; else
 *   none of them
 * @throws {EnvironmentTargetRefused} When a platform is given and a
 *   dependency has no wheel for it, or a project package builds native code
 */
export async function buildPython(
  storage: StorageBackend, repo: string,
  spec: PythonSpec, buildDir: string, settings: ProcessSettings,
  platform?: TargetPlatform, over?: { readonly tier: TierManifest; readonly envHash: string },
): Promise<TargetParts> {
  if (platform === undefined) {
    await installPython(storage, repo, spec, buildDir, settings);
    return { interpreter: null, project: [], fromTier: null };
  }
  if (over === undefined) {
    const project = await installPython(storage, repo, spec, buildDir, settings, platform);
    return { interpreter: await carryInterpreter(buildDir, platform, settings), project, fromTier: null };
  }
  // The same install for every tier of one Python and platform: shared by the
  // builds over each that run together
  const python = pythonMinor(over.tier.python.version);
  const key = JSON.stringify([path.resolve(repo), over.envHash, platform.name, python, settings.uid ?? null, settings.gid ?? null, settings.env ?? null]);
  const project = await sharedInstall(key, buildDir, settings, (dir) => installPython(storage, repo, spec, dir, settings, platform, python));
  const fromTier = await leaveToTier(buildDir, over.tier);
  // What was left to the tier is no longer the project's to pack
  const kept: string[] = [];
  for (const file of project) if (await pathExists(path.join(buildDir, ...file.split('/')))) kept.push(file);
  return { interpreter: null, project: kept, fromTier };
}

/** The installs builds share while they run, by what they install
 *  ({@link sharedInstall}). */
const sharedInstalls = new Map<string, { readonly dir: string; readonly made: Promise<string[]>; users: number }>();

/**
 * Installs in `buildDir` what `install` installs, once for the builds of the
 * same install that run together.
 *
 * @remarks
 * The first build that needs the install installs it beside its own
 * directory, as the user the installs run as; each copies it into its own, a
 * reflink where the file system makes one, its links as they are written.
 * The install is removed once the last of them has copied it, or found it
 * failed; a build that starts after is one of its own.
 *
 * @internal
 * @param key - What is installed: builds of one key share an install
 * @param buildDir - The build's directory, empty
 * @param settings - The user and group the installs run as
 * @param install - Installs into the directory it is given, answering the
 *   project's own files, relative to it
 * @returns The project's own files, relative to `buildDir`
 * @throws What `install` throws, to every build sharing it
 * @example
 * const project = await sharedInstall(key, buildDir, settings, (dir) => installPython(storage, repo, spec, dir, settings, platform, '3.11'));
 */
export async function sharedInstall(key: string, buildDir: string, settings: ProcessSettings, install: (dir: string) => Promise<string[]>): Promise<string[]> {
  let shared = sharedInstalls.get(key);
  if (shared === undefined) {
    const dir = `${buildDir}.install`;
    const made = (async (): Promise<string[]> => {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      // The installs write here, as the user they run as
      await giveDirectory(dir, settings);
      return install(dir);
    })();
    shared = { dir, made, users: 0 };
    sharedInstalls.set(key, shared);
  }
  shared.users++;
  try {
    const project = await shared.made;
    await fs.cp(shared.dir, buildDir, { recursive: true, verbatimSymlinks: true, mode: fsConstants.COPYFILE_FICLONE });
    return project;
  } finally {
    if (--shared.users === 0) {
      sharedInstalls.delete(key);
      await fs.rm(shared.dir, { recursive: true, force: true });
    }
  }
}

/**
 * Installs a python environment in `buildDir`, and checks it.
 *
 * @remarks
 * The locked third-party dependencies first ({@link syncedPackages}); then,
 * for members of a workspace, the distributions the environment requires
 * beside its members' own, each with the extras its spec names, with what it
 * depends on: by a second sync of the lock, which leaves out everything else
 * the lock installs (`pythonLeftOut`), so each is installed as the lock pins
 * it and from where the lock pins it — an explicit index of the workspace's
 * among them — and none of the local packages they depend on is taken from a
 * registry; then the project's own packages, from their sdists; and a check
 * that what is installed is whole, which what the lock's workspace overrides
 * or excludes passes ({@link lockExplainsCheck}).
 *
 * @param platform - The platform it is installed for, when not this machine's
 * @param python - The Python its virtualenv is of, as `3.11`: a tier's; uv's
 *   choice for the project unless given
 * @returns The project's own files, relative to `buildDir`, when a platform
 *   is given; else none
 */
async function installPython(
  storage: StorageBackend, repo: string,
  spec: PythonSpec, buildDir: string, settings: ProcessSettings,
  platform?: TargetPlatform, python?: string,
): Promise<string[]> {
  // Wire data, read before anything is installed by it
  const synced = syncedPackages(spec);
  const required = spec.type === 'python' ? [] : spec.value.requires.map(requiredDistribution);
  await writePythonProject(storage, repo, spec, buildDir);
  const venv = path.join(buildDir, '.venv');
  // Relocatable: the venv is built in a temp sibling and atomically renamed
  // into the cache path, or copied for another tier — absolute shebangs would
  // break. Over a tier, of the tier's Python: what is installed for it is the
  // tier's to run.
  await run('uv', ['venv', '--relocatable', ...(python === undefined ? [] : ['--python', python]), '.venv'], buildDir,
    'virtualenv creation', settings);
  // For another platform, its wheels alone: nothing is built. Copied, since
  // the tree is packed and sent, never linked into this machine's cache.
  const forPlatform = platform === undefined ? [] : ['--python-platform', platform.name, '--no-build', '--link-mode=copy'];
  try {
    await run('uv', [...SYNC, ...synced, ...forPlatform], buildDir, 'locked dependency sync', settings);
    if (required.length > 0) {
      // A sync of the whole workspace's lock, its default groups among it as
      // any sync of it has, that leaves out all but the required
      // distributions and what they and their extras need. It installs each
      // from where the lock pins it, as no install that resolves again from a
      // registry does; `--inexact` keeps what the members' own sync installed.
      const leftOut = pythonLeftOut(await fs.readFile(path.join(buildDir, 'uv.lock'), 'utf-8'), required)
        .map((name) => distributionName(name, 'the locked distribution'));
      await run('uv', [...SYNC, '--inexact', '--all-packages', ...leftOut.flatMap((name) => ['--no-install-package', name]), ...forPlatform],
        buildDir, 'required distribution sync', settings);
    }
  } catch (err) {
    throw (platform === undefined ? null : unbuiltWheel(err, platform)) ?? err;
  }
  const before = platform === undefined ? undefined : await treeEntries(buildDir);
  if (spec.value.sdists.length > 0) {
    const sdists = await writeSdists(storage, repo, spec, buildDir);
    // `--no-deps`: the project's install must NOT resolve anything from a
    // registry — every dependency is already pinned and installed by the
    // sync above (or is another captured sdist). Without it, a missing
    // first-party dep would be silently satisfied by a same-named PyPI
    // package (a stale-code hazard). `uv pip check` then verifies the
    // environment is internally consistent and fails loudly otherwise, so
    // an incomplete capture is a materialization error, never a silent
    // wrong-code env; what the lock's workspace overrides or excludes is
    // the resolution it asked for (checkPython).
    if (platform === undefined) {
      await run('uv', ['pip', 'install', '--python', venv, '--no-deps', ...sdists], buildDir, 'project sdist install', settings);
    } else {
      // Each of the project's packages is built to a wheel here, which runs
      // on the platform only if it is pure: uv takes a wheel this machine
      // built for one of its own kind, so its tags are read here.
      const wheelDir = path.join(buildDir, '.wheels');
      for (const sdist of sdists) {
        await run('uv', ['build', '--wheel', '--python', venv, '--out-dir', wheelDir, sdist], buildDir, 'project wheel build', settings);
      }
      const wheels = (await fs.readdir(wheelDir)).filter((name) => name.endsWith('.whl')).sort();
      for (const wheel of wheels) {
        const { distribution, pure } = wheelOf(wheel);
        if (!pure) {
          throw new EnvironmentTargetRefused(`native-package:${distribution}`,
            `environment materialization: ${distribution} builds native code (its wheel is ${wheel}), ` +
            `and nothing is built for ${platform.name}`);
        }
      }
      await run('uv', ['pip', 'install', '--python', venv, '--no-deps', ...forPlatform, ...wheels.map((wheel) => path.join(wheelDir, wheel))],
        buildDir, 'project wheel install', settings);
      await fs.rm(wheelDir, { recursive: true, force: true });
      await fs.rm(path.join(buildDir, '.sdists'), { recursive: true, force: true });
    }
  }
  const project = before === undefined ? [] : changedSince(before, await treeEntries(buildDir));
  // For another platform, checked while the virtualenv's interpreter is still
  // this machine's, which uv asks what it is; and, over a tier, while it
  // still holds everything it runs with.
  await checkPython(buildDir, venv, settings, platform);
  return project;
}

/**
 * Builds a node environment in `buildDir`.
 *
 * @internal
 * @param platform - The platform it is installed for, when not this machine's:
 *   its dependencies are then the platform's, and the project's own packages
 *   must hold no native addon, which is looked at before anything is installed
 * @returns The project's own files, when a platform is given; else none
 * @throws {EnvironmentTargetRefused} When a platform is given and a project
 *   package holds a native addon, or the lock is pnpm's and this machine's
 *   pnpm installs for its own platform alone
 */
export async function buildNode(
  storage: StorageBackend, repo: string,
  spec: Extract<EnvironmentSpec, { type: 'node' }>, buildDir: string, settings: ProcessSettings,
  platform?: TargetPlatform,
): Promise<TargetParts> {
  const tarballs: Buffer[] = [];
  for (const hash of spec.value.tarballs) {
    const tarball = await readFile(storage, repo, hash);
    if (platform !== undefined) await refuseNativeAddon(tarball, null, platform);
    tarballs.push(tarball);
  }
  await writeBlob(storage, repo, spec.value.packageJson, path.join(buildDir, 'package.json'));
  const lockData = await readFile(storage, repo, spec.value.lock);
  const lockName = nodeLockFilename(lockData);
  await fs.writeFile(path.join(buildDir, lockName), lockData);
  const forPlatform = platform?.node ?? [];
  if (lockName === 'pnpm-lock.yaml') {
    // pnpm takes the platform's flags from version 11. One that does not
    // installs for its own platform, which is the platform's on a machine of
    // its kind.
    const away = platform !== undefined && !platform.host;
    try {
      await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', ...(away ? forPlatform : [])], buildDir,
        'locked dependency install', settings);
    } catch (err) {
      if (away && /Unknown options?:/.test(err instanceof Error ? err.message : String(err))) {
        throw new EnvironmentTargetRefused('pnpm',
          `environment materialization: this machine's pnpm installs for its own platform alone, not for ${platform.name}`);
      }
      throw err;
    }
  } else {
    await run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts', ...forPlatform], buildDir,
      'locked dependency install', settings);
  }
  const before = platform === undefined ? undefined : await treeEntries(buildDir);
  if (tarballs.length > 0) {
    const packDir = path.join(buildDir, '.tarballs');
    await fs.mkdir(packDir);
    const files: string[] = [];
    for (const [i, tarball] of tarballs.entries()) {
      const f = path.join(packDir, `pack-${i}.tgz`);
      await fs.writeFile(f, tarball);
      files.push(f);
    }
    // --ignore-scripts, as every install here: a project's own packages
    // arrive built — `npm pack` ran `prepack` at capture — and one that
    // builds a native addon ships it prebuilt.
    await run('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', ...forPlatform, ...files], buildDir,
      'project tarball install', settings);
    // A tree for another platform is packed and sent: the tarballs are not of it.
    if (platform !== undefined) await fs.rm(packDir, { recursive: true, force: true });
  }
  return { interpreter: null, project: before === undefined ? [] : changedSince(before, await treeEntries(buildDir)), fromTier: null };
}

/**
 * Resolve a `tools` spec's env-relative file path to an absolute path inside
 * `buildDir`, rejecting anything that could escape it.
 *
 * The `path` field is wire data (it rides in an imported bundle), so it is
 * validated defensively: it must be relative, use no `.`/`..`/empty
 * segments, and — after resolution — still live under `buildDir`. Backslash
 * separators are treated as separators too, so a Windows-style path in a
 * spec can't smuggle a segment past the POSIX split.
 *
 * @throws {Error} if the path is absolute, empty, or escapes the build dir
 */
function resolveToolsPath(buildDir: string, relPath: string): string {
  if (relPath.length === 0) {
    throw new Error('tools file has an empty path');
  }
  if (path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) {
    throw new Error(`tools file path must be relative, got '${relPath}'`);
  }
  const segments = relPath.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new Error(`tools file path '${relPath}' has an invalid segment '${seg}'`);
    }
  }
  const dest = path.resolve(buildDir, ...segments);
  const root = path.resolve(buildDir);
  if (dest !== root && !dest.startsWith(root + path.sep)) {
    throw new Error(`tools file path '${relPath}' escapes the environment directory`);
  }
  return dest;
}

/**
 * Builds a tools environment in `buildDir`: each file at its path, runnable.
 *
 * @internal
 * @throws {Error} When a file's path is absolute, empty, or leads out of the
 *   build directory
 */
export async function buildTools(
  storage: StorageBackend, repo: string,
  spec: Extract<EnvironmentSpec, { type: 'tools' }>, buildDir: string,
): Promise<void> {
  for (const file of spec.value.files) {
    const dest = resolveToolsPath(buildDir, file.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await writeBlob(storage, repo, file.hash, dest);
    // Uniform executable mode: the spec stores no mode (an exec-bit-only
    // change must not alter the env hash), so every captured file is made
    // runnable. No-op on Windows, which has no POSIX exec bit.
    if (process.platform !== 'win32') {
      await fs.chmod(dest, 0o755);
    }
  }
}

/** Rejects a member path from a workspace_node spec that could escape the
 *  build dir (wire data). Returns the absolute member dir under buildDir. */
function resolveMemberDir(buildDir: string, memberPath: string): string {
  const segments = memberPath.split(/[/\\]/);
  if (segments.length === 0 || path.isAbsolute(memberPath) || /^[a-zA-Z]:/.test(memberPath)) {
    throw new Error(`workspace member path must be relative, got '${memberPath}'`);
  }
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new Error(`workspace member path '${memberPath}' has an invalid segment '${seg}'`);
    }
  }
  const dest = path.resolve(buildDir, ...segments);
  const root = path.resolve(buildDir);
  if (!dest.startsWith(root + path.sep)) {
    throw new Error(`workspace member path '${memberPath}' escapes the environment directory`);
  }
  return dest;
}

/**
 * Extracts an `npm pack` tarball (gzipped tar) into `destDir`, stripping the
 * leading `package/` directory every npm tarball carries.
 *
 * Entries are validated defensively (they ride in an imported bundle):
 * path traversal is rejected, and symlink/hardlink/other special entries are
 * refused (a workspace member must be plain files). File modes are floored
 * so an extracted file is at least readable/executable as npm would leave it.
 *
 * @throws {Error} on a traversal path, a link entry, or a malformed archive
 */
async function extractMemberTarball(tarball: Buffer, destDir: string): Promise<void> {
  const tarBytes = gunzipSync(tarball);
  await new Promise<void>((resolve, reject) => {
    const ex = tarExtract();
    ex.on('entry', (header, stream, next) => {
      void (async () => {
        try {
          if (header.type !== 'file' && header.type !== 'directory') {
            throw new Error(`unsupported tar entry type '${header.type ?? 'unknown'}' in workspace member tarball`);
          }
          // Strip the leading `package/` segment npm pack adds.
          const rel = header.name.replace(/^[^/]+\//, '');
          if (rel === '') { stream.resume(); return next(); }
          const segments = rel.split('/');
          if (segments.some((s) => s === '..' || s === '')) {
            throw new Error(`illegal path '${header.name}' in workspace member tarball`);
          }
          const dest = path.resolve(destDir, ...segments);
          if (!dest.startsWith(path.resolve(destDir) + path.sep)) {
            throw new Error(`path '${header.name}' escapes the member directory`);
          }
          if (header.type === 'directory') {
            await fs.mkdir(dest, { recursive: true });
            stream.resume();
            return next();
          }
          await fs.mkdir(path.dirname(dest), { recursive: true });
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            const mode = ((header.mode ?? 0) & 0o777) | 0o644;
            fs.writeFile(dest, Buffer.concat(chunks), { mode }).then(() => next(), reject);
          });
          stream.on('error', reject);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });
    ex.on('error', reject);
    ex.on('finish', resolve);
    Readable.from(tarBytes).pipe(ex);
  });
}

/**
 * On Windows, `npm ci` materializes workspace members as directory
 * *junctions* holding an **absolute** target under `buildDir`. After the
 * atomic rename of `buildDir` → `envDir` those junctions dangle. This
 * re-points every symlink/junction under `buildDir` whose target lies inside
 * `buildDir` to the equivalent path under the final `envDir`. No-op on POSIX
 * (npm uses relative symlinks there, which survive the rename).
 */
async function retargetWindowsJunctions(buildDir: string, envDir: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const buildRoot = path.resolve(buildDir);
  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string;
        try { target = await fs.readlink(full); } catch { continue; }
        if (path.isAbsolute(target) && target.startsWith(buildRoot + path.sep)) {
          const rebased = path.join(envDir, path.relative(buildRoot, target));
          await fs.rm(full, { recursive: true, force: true });
          await fs.symlink(rebased, full, 'junction');
        }
      } else if (entry.isDirectory()) {
        await walk(full);
      }
    }
  };
  await walk(buildDir);
}

/**
 * Builds a workspace environment in `buildDir`, to be put at `envDir`.
 *
 * @internal
 * @param platform - The platform it is installed for, when not this machine's
 * @returns The members' own files, relative to the build directory, when a
 *   platform is given; else none
 * @throws {EnvironmentTargetRefused} When a platform is given and a member
 *   holds a native addon
 */
export async function buildWorkspaceNode(
  storage: StorageBackend, repo: string,
  spec: Extract<EnvironmentSpec, { type: 'workspace_node' }>, buildDir: string, envDir: string, settings: ProcessSettings,
  platform?: TargetPlatform,
): Promise<string[]> {
  // v1 supports npm workspaces only; pnpm capture ships later.
  const lockData = await readFile(storage, repo, spec.value.lock);
  if (nodeLockFilename(lockData) !== 'package-lock.json') {
    throw new Error('workspace_node: only npm workspaces are supported by the local runner yet');
  }

  // Root package.json with `workspaces` pinned to exactly the closure members
  // (explicit paths, no globs) so npm ci links only them — non-closure
  // members and their third-party deps are pruned.
  const rootPkg = JSON.parse((await readFile(storage, repo, spec.value.packageJson)).toString('utf-8'));
  rootPkg.workspaces = spec.value.members.map((m) => m.path);
  await fs.writeFile(path.join(buildDir, 'package.json'), JSON.stringify(rootPkg, null, 2));
  await fs.writeFile(path.join(buildDir, 'package-lock.json'), lockData);

  // Materialize each member's packed code at its workspace path.
  for (const member of spec.value.members) {
    const memberDir = resolveMemberDir(buildDir, member.path);
    await fs.mkdir(memberDir, { recursive: true });
    const tarball = await readFile(storage, repo, member.tarball);
    if (platform !== undefined) await refuseNativeAddon(tarball, member.name, platform);
    await extractMemberTarball(tarball, memberDir);
    const memberPkg = JSON.parse(await fs.readFile(path.join(memberDir, 'package.json'), 'utf-8'));
    if (memberPkg.name !== member.name) {
      throw new Error(`workspace member at '${member.path}' is '${memberPkg.name}', expected '${member.name}'`);
    }
  }
  // The members' own files: everything here but the root manifest and lock,
  // before the install adds what they depend on.
  const members = platform === undefined ? []
    : [...(await treeEntries(buildDir)).keys()].filter((file) => file !== 'package.json' && file !== 'package-lock.json');

  // npm installs a dependency a member cannot share in that member's
  // directory, as the user the install runs as.
  await giveDirectories(buildDir, settings);

  // Frozen install against the verbatim root lock. --ignore-scripts: member
  // code arrives by extraction, already built (prepack ran at capture).
  await run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts', ...(platform?.node ?? [])], buildDir,
    'workspace install', settings);

  await retargetWindowsJunctions(buildDir, envDir);

  // Sanity: every member is present and resolvable — guards the silent
  // "npm ci said up-to-date but installed nothing" class of failure.
  for (const member of spec.value.members) {
    const pkgJson = path.join(buildDir, ...member.path.split('/'), 'package.json');
    const linked = path.join(buildDir, 'node_modules', ...member.name.split('/'));
    if (!await pathExists(pkgJson) || !await pathExists(linked)) {
      throw new Error(`materialized workspace is incomplete: member '${member.name}' missing after install`);
    }
  }
  return members;
}
