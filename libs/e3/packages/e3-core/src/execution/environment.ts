/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local materialization of execution environments.
 *
 * A task/function whose object carries an `environment` hash references a
 * content-addressed {@link EnvironmentSpec}: the project's manifest +
 * lockfile blobs plus the project's own built packages (sdists / tarballs).
 * Before spawning the runner, the environment is materialized into a cache
 * directory keyed by the environment hash — cold: create + install from the
 * locked closure; warm: reuse — and the environment's executable dir is
 * prepended to the child PATH so its runner entry points win.
 *
 * Cache layout: `<repo>/envs/<envHash>/` — sibling to the repo's object
 * store, one directory per distinct environment. Materialization builds in a
 * temp sibling and atomically renames into place, so a cache directory's
 * existence means it is complete; concurrent builders race benignly (the
 * loser discards its build) and in-process duplicates are deduped with a
 * keyed lock. gc removes an environment once nothing it keeps names the spec,
 * and a build whose builder died ({@link sweepEnvironments}).
 *
 * An environment is also installed for a platform that is not this machine's
 * ({@link materializeEnvironmentFor}): a rack's, whose guest is another
 * machine. The installs are the same frozen ones, asked for that platform's
 * packages, and nothing is compiled for it: a package with no wheel for it,
 * or a project package with native code, refuses the environment by name
 * ({@link EnvironmentTargetRefused}). A python environment then carries an
 * interpreter of its own, so it runs wherever its tree is put.
 */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { extract as tarExtract } from 'tar-stream';
import { BlobType, decodeBeast2For, isTypeValueEqual, readBeast2Type, toEastTypeValue } from '@elaraai/east';
import { EnvironmentSpecType, type EnvironmentSpec } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/index.js';
import { withKeyedLock } from '../keyed-mutex.js';
import { getPidStartTime, processExited } from './processHelpers.js';
import { checkProcessSettings, giveDirectory, type ProcessSettings } from './processExec.js';

const execFileAsync = promisify(execFile);

const decodeEnvironmentSpec = decodeBeast2For(EnvironmentSpecType);

/** An environment's files are objects holding their bytes as beast2 Blobs. */
const FILE_TYPE = toEastTypeValue(BlobType);
const decodeFile = decodeBeast2For(BlobType);

/** The executable dir a materialized environment contributes to PATH. */
function environmentBinDir(envDir: string, spec: EnvironmentSpec): string {
  switch (spec.type) {
    case 'python':
      return path.join(envDir, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
    case 'node':
    case 'workspace_node':
      return path.join(envDir, 'node_modules', '.bin');
    case 'tools':
      return path.join(envDir, 'bin');
    case 'image':
      // Rejected before this is reached (materializeEnvironment throws on
      // image); present only to keep the switch exhaustive.
      throw new Error('image environments have no local bin dir');
  }
}

/** Runs an install in the build directory, as the settings say: from their
 *  environment, as is, and as their user and group. */
async function run(command: string, args: string[], cwd: string, what: string, settings: ProcessSettings): Promise<void> {
  try {
    await execFileAsync(command, args, {
      cwd,
      // npm is npm.cmd on Windows; a shell resolves both.
      shell: process.platform === 'win32',
      maxBuffer: 16 * 1024 * 1024,
      env: settings.env,
      uid: settings.uid,
      gid: settings.gid,
    });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? String(err);
    throw new Error(`environment materialization: ${what} ('${command} ${args.join(' ')}') failed:\n${stderr}`);
  }
}

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

/** Reads a file an environment names (see {@link decodeEnvironmentFile}). */
async function readFile(storage: StorageBackend, repo: string, hash: string): Promise<Buffer> {
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

/**
 * What a sync of a python environment's locked third-party closure is asked,
 * for every platform: the whole closure but no first-party code.
 * `--no-install-workspace` skips every workspace member and the root,
 * `--no-install-local` skips any local/path source (a sibling member's dir
 * need not even exist on this machine). The project's own code comes from the
 * captured sdists. Superset of the old `--no-install-project` for a
 * single-project env (verified equivalent).
 */
const SYNC = ['sync', '--frozen', '--all-packages', '--no-install-workspace', '--no-install-local'];

/** Writes a python environment's manifest and lock into the build directory. */
async function writePythonProject(
  storage: StorageBackend, repo: string, spec: Extract<EnvironmentSpec, { type: 'python' }>, buildDir: string,
): Promise<void> {
  await writeBlob(storage, repo, spec.value.pyproject, path.join(buildDir, 'pyproject.toml'));
  await writeBlob(storage, repo, spec.value.lock, path.join(buildDir, 'uv.lock'));
}

/** Writes a python environment's captured sdists under the build directory's
 *  `.sdists`, and answers their paths. */
async function writeSdists(
  storage: StorageBackend, repo: string, spec: Extract<EnvironmentSpec, { type: 'python' }>, buildDir: string,
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

async function buildPython(
  storage: StorageBackend, repo: string,
  spec: Extract<EnvironmentSpec, { type: 'python' }>, buildDir: string, settings: ProcessSettings,
): Promise<void> {
  await writePythonProject(storage, repo, spec, buildDir);
  // Relocatable: the venv is built in a temp sibling and atomically renamed
  // into the cache path — absolute shebangs would break on rename.
  await run('uv', ['venv', '--relocatable', '.venv'], buildDir, 'virtualenv creation', settings);
  await run('uv', SYNC, buildDir, 'locked dependency sync', settings);
  if (spec.value.sdists.length > 0) {
    const files = await writeSdists(storage, repo, spec, buildDir);
    // `--no-deps`: the sdist install must NOT resolve anything from a
    // registry — every dependency is already pinned and installed by the
    // sync above (or is another captured sdist). Without it, a missing
    // first-party dep would be silently satisfied by a same-named PyPI
    // package (a stale-code hazard). `uv pip check` then verifies the
    // environment is internally consistent and fails loudly otherwise, so
    // an incomplete capture is a materialization error, never a silent
    // wrong-code env.
    await run('uv', ['pip', 'install', '--python', path.join(buildDir, '.venv'), '--no-deps', ...files],
      buildDir, 'project sdist install', settings);
  }
  await run('uv', ['pip', 'check', '--python', path.join(buildDir, '.venv')], buildDir,
    'environment consistency check', settings);
}

async function buildNode(
  storage: StorageBackend, repo: string,
  spec: Extract<EnvironmentSpec, { type: 'node' }>, buildDir: string, settings: ProcessSettings,
): Promise<void> {
  await writeBlob(storage, repo, spec.value.packageJson, path.join(buildDir, 'package.json'));
  const lockData = await readFile(storage, repo, spec.value.lock);
  const lockName = nodeLockFilename(lockData);
  await fs.writeFile(path.join(buildDir, lockName), lockData);
  if (lockName === 'pnpm-lock.yaml') {
    await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], buildDir,
      'locked dependency install', settings);
  } else {
    await run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts'], buildDir,
      'locked dependency install', settings);
  }
  if (spec.value.tarballs.length > 0) {
    const packDir = path.join(buildDir, '.tarballs');
    await fs.mkdir(packDir);
    const files: string[] = [];
    for (let i = 0; i < spec.value.tarballs.length; i++) {
      const f = path.join(packDir, `pack-${i}.tgz`);
      await writeBlob(storage, repo, spec.value.tarballs[i]!, f);
      files.push(f);
    }
    // --ignore-scripts, as every install here: a project's own packages
    // arrive built — `npm pack` ran `prepack` at capture — and one that
    // builds a native addon ships it prebuilt.
    await run('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', ...files], buildDir,
      'project tarball install', settings);
  }
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

async function buildTools(
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
 * @param platform - The platform it is installed for, when not this machine's
 * @returns The members' own files, relative to the build directory, when a
 *   platform is given; else none
 * @throws {EnvironmentTargetRefused} When a platform is given and a member
 *   holds a native addon
 */
async function buildWorkspaceNode(
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

async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Gives `dir` and every directory under it to the user and group the
 *  installs run as, so they can write in each; settings that name neither
 *  give nothing. */
async function giveDirectories(dir: string, settings: ProcessSettings): Promise<void> {
  if (settings.uid === undefined && settings.gid === undefined) return;
  await giveDirectory(dir, settings);
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await giveDirectories(path.join(dir, entry.name), settings);
  }
}

// =============================================================================
// For another platform
// =============================================================================

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
}

/** A platform environments are installed for. */
interface TargetPlatform {
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

/** Reads a platform's name (see {@link EnvironmentTarget.platform}). */
function targetPlatformOf(platform: string): TargetPlatform {
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

/**
 * Every file and link under `root`, relative to it with `/` between segments,
 * each with what tells one written since from one left alone: its size, when
 * it was changed, and its inode.
 */
async function treeEntries(root: string, dir: string = root, into = new Map<string, string>()): Promise<Map<string, string>> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await treeEntries(root, full, into);
      continue;
    }
    const stat = await fs.lstat(full);
    into.set(path.relative(root, full).split(path.sep).join('/'), `${stat.size}:${stat.mtimeMs}:${stat.ino}`);
  }
  return into;
}

/** The files and links of `after` that `before` lacks, or holds otherwise. */
function changedSince(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...after].filter(([file, state]) => before.get(file) !== state).map(([file]) => file);
}

/**
 * A wheel's distribution, and whether it runs on every platform, from its file
 * name: `{distribution}-{version}(-{build})?-{python}-{abi}-{platform}.whl`,
 * pure when its ABI tag is `none` and its platform tag `any`.
 */
function wheelOf(filename: string): { distribution: string; pure: boolean } {
  const parts = filename.replace(/\.whl$/, '').split('-');
  if (parts.length < 5) throw new Error(`environment materialization: '${filename}' is not a wheel's file name`);
  return { distribution: parts[0]!, pure: parts[parts.length - 2] === 'none' && parts[parts.length - 1] === 'any' };
}

/** The refusal a failed sync is, when uv says a dependency has no wheel for
 *  the platform; `null` for any other failure. */
function unbuiltWheel(err: unknown, platform: TargetPlatform): EnvironmentTargetRefused | null {
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
 * @param platform - The platform the environment is installed for
 * @throws {EnvironmentTargetRefused} When the package holds a `.node` file
 */
async function refuseNativeAddon(tarball: Buffer, name: string | null, platform: TargetPlatform): Promise<void> {
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
 * @returns The interpreter's directory, relative to the tree
 */
async function carryInterpreter(buildDir: string, platform: TargetPlatform, settings: ProcessSettings): Promise<string> {
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

/** What a build for another platform made, beside its tree. */
type TargetParts = Pick<TargetEnvironment, 'interpreter'> & { project: string[] };

async function buildPythonFor(
  storage: StorageBackend, repo: string,
  spec: Extract<EnvironmentSpec, { type: 'python' }>, buildDir: string, settings: ProcessSettings, platform: TargetPlatform,
): Promise<TargetParts> {
  await writePythonProject(storage, repo, spec, buildDir);
  const venv = path.join(buildDir, '.venv');
  await run('uv', ['venv', '--relocatable', '.venv'], buildDir, 'virtualenv creation', settings);
  // Wheels alone, the platform's: nothing is built. Copied, since the tree
  // is packed and sent, never linked into this machine's cache.
  try {
    await run('uv', [...SYNC, '--python-platform', platform.name, '--no-build', '--link-mode=copy'],
      buildDir, 'locked dependency sync', settings);
  } catch (err) {
    throw unbuiltWheel(err, platform) ?? err;
  }
  const before = await treeEntries(buildDir);
  if (spec.value.sdists.length > 0) {
    // Each of the project's packages is built to a wheel here, which runs on
    // the platform only if it is pure: uv takes a wheel this machine built
    // for one of its own kind, so its tags are read here.
    const sdists = await writeSdists(storage, repo, spec, buildDir);
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
    // `--no-deps`, as a build for this machine: every dependency is pinned
    // and installed by the sync, or is another of the project's packages.
    await run('uv', ['pip', 'install', '--python', venv, '--no-deps', '--no-build', '--python-platform', platform.name, '--link-mode=copy',
      ...wheels.map((wheel) => path.join(wheelDir, wheel))], buildDir, 'project wheel install', settings);
    await fs.rm(wheelDir, { recursive: true, force: true });
    await fs.rm(path.join(buildDir, '.sdists'), { recursive: true, force: true });
  }
  const project = changedSince(before, await treeEntries(buildDir));
  // Checked while the virtualenv's interpreter is still this machine's,
  // which uv asks what it is.
  await run('uv', ['pip', 'check', '--python', venv, '--python-platform', platform.name], buildDir,
    'environment consistency check', settings);
  return { interpreter: await carryInterpreter(buildDir, platform, settings), project };
}

async function buildNodeFor(
  storage: StorageBackend, repo: string,
  spec: Extract<EnvironmentSpec, { type: 'node' }>, buildDir: string, settings: ProcessSettings, platform: TargetPlatform,
): Promise<TargetParts> {
  // The project's own packages are looked at first: one that cannot go to the
  // platform refuses the environment before anything is installed.
  const tarballs: Buffer[] = [];
  for (const hash of spec.value.tarballs) {
    const tarball = await readFile(storage, repo, hash);
    await refuseNativeAddon(tarball, null, platform);
    tarballs.push(tarball);
  }
  await writeBlob(storage, repo, spec.value.packageJson, path.join(buildDir, 'package.json'));
  const lockData = await readFile(storage, repo, spec.value.lock);
  const lockName = nodeLockFilename(lockData);
  await fs.writeFile(path.join(buildDir, lockName), lockData);
  if (lockName === 'pnpm-lock.yaml') {
    // pnpm takes the platform's flags from version 11. One that does not
    // installs for its own platform, which is the platform's on a machine of
    // its kind.
    try {
      await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', ...(platform.host ? [] : platform.node)], buildDir,
        'locked dependency install', settings);
    } catch (err) {
      if (!platform.host && /Unknown options?:/.test(err instanceof Error ? err.message : String(err))) {
        throw new EnvironmentTargetRefused('pnpm',
          `environment materialization: this machine's pnpm installs for its own platform alone, not for ${platform.name}`);
      }
      throw err;
    }
  } else {
    await run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts', ...platform.node], buildDir,
      'locked dependency install', settings);
  }
  const before = await treeEntries(buildDir);
  if (tarballs.length > 0) {
    const packDir = path.join(buildDir, '.tarballs');
    await fs.mkdir(packDir);
    const files: string[] = [];
    for (const [i, tarball] of tarballs.entries()) {
      const f = path.join(packDir, `pack-${i}.tgz`);
      await fs.writeFile(f, tarball);
      files.push(f);
    }
    await run('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', ...platform.node, ...files], buildDir,
      'project tarball install', settings);
    await fs.rm(packDir, { recursive: true, force: true });
  }
  return { interpreter: null, project: changedSince(before, await treeEntries(buildDir)) };
}

/** The mode bits a built environment's files lose when it is taken back: set
 *  user and group id, which a chown by root keeps on BSD, and writing by the
 *  group or anyone. */
const NOT_TAKEN = 0o6022;

/**
 * Takes a built environment back from the user its installs ran as: every
 * file, directory and link in it becomes this process's own, and no file or
 * directory keeps a mode by which another may write it or run as its owner.
 * Every execution of the repository reads an environment, and no runner may
 * change what the others run.
 */
async function takeBack(dir: string): Promise<void> {
  if (process.getuid === undefined || process.getgid === undefined) return;
  const uid = process.getuid();
  const gid = process.getgid();
  const take = async (at: string): Promise<void> => {
    // A link is taken itself, never what it names; a link has no mode of its
    // own to strip.
    await fs.lchown(at, uid, gid);
    const { mode } = await fs.lstat(at);
    if ((mode & fs.constants.S_IFMT) !== fs.constants.S_IFLNK && (mode & NOT_TAKEN) !== 0) {
      await fs.chmod(at, mode & 0o7777 & ~NOT_TAKEN);
    }
    if ((mode & fs.constants.S_IFMT) === fs.constants.S_IFDIR) {
      for (const name of await fs.readdir(at)) await take(path.join(at, name));
    }
  };
  await take(dir);
}

/**
 * Removes from `<repo>/envs` each built environment whose spec object gc's
 * mark no longer reached, and each build directory whose builder has exited.
 *
 * @param repo - Repository path
 * @param reachable - The objects the mark reached
 * @returns How many directories were removed
 */
export async function sweepEnvironments(repo: string, reachable: ReadonlySet<string>): Promise<number> {
  const envsDir = path.join(repo, 'envs');
  let entries: string[];
  try {
    entries = await fs.readdir(envsDir);
  } catch {
    return 0; // nothing built yet
  }
  let removed = 0;
  for (const entry of entries) {
    // <envHash>, or <envHash>.building-<pid>-<pidStartTime>
    const built = /^[0-9a-f]{64}$/.test(entry);
    const building = /^[0-9a-f]{64}\.building-(\d+)-(\d+)$/.exec(entry);
    const gone = built
      ? !reachable.has(entry)
      : building !== null && await processExited(Number(building[1]), Number(building[2]));
    if (!gone) continue;
    try {
      await fs.rm(path.join(envsDir, entry), { recursive: true, force: true });
      removed++;
    } catch {
      // Left for the next sweep
    }
  }
  return removed;
}

/**
 * Materializes an environment into the repo-local cache and returns the
 * executable dirs to prepend to the runner's PATH.
 *
 * Warm environments (cache dir present) return immediately. Cold
 * environments build in a temp sibling directory and atomically rename into
 * place; when two processes race, the loser keeps the winner's build.
 *
 * The cache directory is absolute whatever the repository's path, which a
 * backend that names its repositories gives relative to the working
 * directory: each build tool runs in the build directory and resolves a
 * relative path it is given against that, and a runner resolves a relative
 * PATH entry against its own.
 *
 * Every install runs as `settings` say ({@link ProcessSettings}): from their
 * environment as it is, which names the home and caches the installs write,
 * and as their user and group. That user is given the build directory, and a
 * workspace's member directories, which the installs write in; once built,
 * the environment is taken back, every file of it, before it is put in place.
 * No npm or pnpm install runs a package's lifecycle script.
 *
 * @param storage - Storage backend holding the spec + blobs
 * @param repo - Repository path (the cache lives at `<repo>/envs/<hash>`),
 *   absolute or relative to the working directory
 * @param envHash - Object hash of the beast2-encoded {@link EnvironmentSpec}
 * @param settings - How the installs run: their environment, user and group.
 *   Absent, this process's own.
 * @returns PATH entries for the materialized environment, absolute
 * @throws {Error} for `image` environments (cloud-only), failed builds, and
 *   settings that name a user or group on Windows
 * @throws {RangeError} When a user or group id is not a non-negative integer.
 */
export async function materializeEnvironment(
  storage: StorageBackend,
  repo: string,
  envHash: string,
  settings: ProcessSettings = {},
): Promise<string[]> {
  checkProcessSettings(settings);
  const specData = await storage.objects.read(repo, envHash);
  const spec = decodeEnvironmentSpec(Buffer.from(specData));

  if (spec.type === 'image') {
    throw new Error(
      `environment ${envHash.slice(0, 12)} is a container image (${spec.value.digest}) — ` +
      `image environments are not supported by the local runner; deploy to a cloud workspace ` +
      `or use a python/node environment locally`,
    );
  }

  // Absolute, so every path built from it — the build directory, what the
  // tools are given, the PATH entry — names the same place wherever it is
  // resolved.
  const envDir = path.resolve(repo, 'envs', envHash);
  const binDir = environmentBinDir(envDir, spec);

  // Warm path: an existing cache dir is complete by construction.
  try {
    await fs.access(envDir);
    return [binDir];
  } catch {
    // cold — build below
  }

  await withKeyedLock(`env:${envHash}`, async () => {
    // Re-check under the in-process lock.
    try {
      await fs.access(envDir);
      return;
    } catch {
      // still cold
    }

    // Named after this process, so gc removes it once the process is gone.
    const buildDir = `${envDir}.building-${process.pid}-${await getPidStartTime(process.pid)}`;
    await fs.rm(buildDir, { recursive: true, force: true });
    await fs.mkdir(buildDir, { recursive: true });
    try {
      // The installs write here, as the user they run as.
      await giveDirectory(buildDir, settings);
      switch (spec.type) {
        case 'python':
          await buildPython(storage, repo, spec, buildDir, settings);
          break;
        case 'node':
          await buildNode(storage, repo, spec, buildDir, settings);
          break;
        case 'tools':
          await buildTools(storage, repo, spec, buildDir);
          break;
        case 'workspace_node':
          await buildWorkspaceNode(storage, repo, spec, buildDir, envDir, settings);
          break;
      }
      // e3's before any runner reads it.
      if (settings.uid !== undefined || settings.gid !== undefined) await takeBack(buildDir);
      try {
        await fs.rename(buildDir, envDir);
      } catch {
        // Another process won the race — its build is complete; drop ours.
        await fs.rm(buildDir, { recursive: true, force: true });
        await fs.access(envDir);
      }
    } catch (err) {
      await fs.rm(buildDir, { recursive: true, force: true });
      throw err;
    }
  });

  return [binDir];
}

/**
 * Installs an environment for a platform that is not this machine's, in a
 * directory of the caller's: what a rack's guest runs it from.
 *
 * @remarks
 * The installs are {@link materializeEnvironment}'s, asked for the platform's
 * packages, and nothing is built for it:
 * - a python environment's dependencies are wheels alone, the project's own
 *   packages are built to wheels here and must be pure, and the environment
 *   carries the platform's build of the Python its virtualenv was made with,
 *   so it needs none where it runs;
 * - a node or workspace environment's dependencies are the platform's, and
 *   the project's own packages must hold no native addon.
 *
 * The tree is not this machine's to run, and is not cached: its caller packs
 * it. It may be put anywhere, as the links in it are relative. Every install
 * runs as `settings` say, as a build for this machine does, and the tree is
 * taken back from the user they ran as.
 *
 * @param storage - Storage backend holding the spec and its files
 * @param repo - Repository path
 * @param envHash - Object hash of the beast2-encoded {@link EnvironmentSpec}
 * @param target - The platform to install for
 * @param dir - The directory to install in: empty, or not there yet
 * @param settings - How the installs run: their environment, user and group.
 *   Absent, this process's own.
 * @returns The tree, the interpreter it carries, and the project's own files
 * @throws {EnvironmentTargetRefused} For an environment no install makes for
 *   another platform, with its reason; the directory is removed
 * @throws {Error} For a platform that is not one environments are installed
 *   for, a directory that is not empty, and a failed install, whose directory
 *   is removed
 *
 * @example
 * ```ts
 * const built = await materializeEnvironmentFor(storage, repo, envHash, { platform: 'x86_64-manylinux_2_28' }, scratch);
 * // built.interpreter === '.python'; built.project lists the project's own files
 * ```
 */
export async function materializeEnvironmentFor(
  storage: StorageBackend,
  repo: string,
  envHash: string,
  target: EnvironmentTarget,
  dir: string,
  settings: ProcessSettings = {},
): Promise<TargetEnvironment> {
  checkProcessSettings(settings);
  const spec = decodeEnvironmentSpec(Buffer.from(await storage.objects.read(repo, envHash)));
  const named = `environment ${envHash.slice(0, 12)}`;
  if (spec.type === 'image') {
    throw new EnvironmentTargetRefused('image', `${named} is a container image (${spec.value.digest}), which no install makes for another platform`);
  }
  if (spec.type === 'tools') {
    throw new EnvironmentTargetRefused('tools', `${named} is files of the platform they were captured on, which no install makes for another`);
  }
  if (process.platform === 'win32') {
    throw new EnvironmentTargetRefused('windows-host',
      `${named} is not installed for ${target.platform} on Windows, where a built environment has another layout`);
  }
  const platform = targetPlatformOf(target.platform);

  const buildDir = path.resolve(dir);
  await fs.mkdir(buildDir, { recursive: true });
  if ((await fs.readdir(buildDir)).length > 0) {
    throw new Error(`environment materialization: ${buildDir} is not empty`);
  }
  try {
    // The installs write here, as the user they run as.
    await giveDirectory(buildDir, settings);
    let parts: TargetParts;
    switch (spec.type) {
      case 'python':
        parts = await buildPythonFor(storage, repo, spec, buildDir, settings, platform);
        break;
      case 'node':
        parts = await buildNodeFor(storage, repo, spec, buildDir, settings, platform);
        break;
      case 'workspace_node':
        parts = { interpreter: null, project: await buildWorkspaceNode(storage, repo, spec, buildDir, buildDir, settings, platform) };
        break;
    }
    if (settings.uid !== undefined || settings.gid !== undefined) await takeBack(buildDir);
    return { dir: buildDir, interpreter: parts.interpreter, project: [...parts.project].sort() };
  } catch (err) {
    await fs.rm(buildDir, { recursive: true, force: true });
    throw err;
  }
}
