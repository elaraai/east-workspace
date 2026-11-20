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
 * interpreter of its own, so it runs wherever its tree is put; or it is built
 * over the tier its rack boots it over, without the interpreter and without
 * each distribution the tier's image holds the same (#1655). A node
 * environment built over a tier is without East's packages the image holds,
 * and what only they need (#1697). A workspace member's node environment,
 * wherever it is built, keeps what its members and the runner need, and
 * nothing else its workspace's root depends on (#1700).
 *
 * And an environment built ahead of the call that declares it is placed where
 * this module looks for one. A directory already at `<repo>/envs/<hash>` is
 * taken as built ({@link materializeEnvironment}), so a host that holds an
 * environment built before the call — a container image that installed one as
 * it was built, a rack's guest whose image was composed with one — names it
 * in two variables ({@link prebuiltEnvironment}): `E3_BAKED_ENV_HASH`, the
 * environment's hash, and `E3_BAKED_ENV_DIR`, the directory it is in. Before
 * a call that declares that environment, its runner links `<repo>/envs/<hash>`
 * to the directory ({@link linkPrebuiltEnvironment}), and nothing is
 * installed.
 *
 * How the installs run is `environment-install.ts`'s, how each kind is built
 * `environment-build.ts`'s, and what a build for another platform or over a
 * tier does beside `environment-target.ts`'s; this module's exports name them.
 */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { decodeEnvironmentSpec, type EnvironmentSpec } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/index.js';
import { withKeyedLock } from '../keyed-mutex.js';
import { isObjectHash } from '../objects.js';
import { pythonSatisfies, type TierManifest } from '../tier-manifest.js';
import { getPidStartTime, processExited } from './processHelpers.js';
import { checkProcessSettings, giveDirectory, type ProcessSettings } from './processExec.js';
import { buildNode, buildPython, buildTools, buildWorkspaceNode, nodeLockFilename, readFile } from './environment-build.js';
import {
  EnvironmentTargetRefused, targetPlatformOf, type EnvironmentTarget, type TargetEnvironment, type TargetParts,
} from './environment-target.js';

export { installShell } from './environment-install.js';
export { decodeEnvironmentFile, nodeLockFilename } from './environment-build.js';
export {
  EnvironmentTargetRefused, hostEnvironmentPlatform, installedTree,
  type EnvironmentTarget, type EnvironmentTargetReason, type InstalledEntry, type TargetEnvironment,
} from './environment-target.js';

/** The executable dir a materialized environment contributes to PATH. */
function environmentBinDir(envDir: string, spec: EnvironmentSpec): string {
  switch (spec.type) {
    case 'python':
    case 'workspace_python':
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
  const spec = decodeEnvironmentSpec(await storage.objects.read(repo, envHash), envHash);

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
        case 'workspace_python':
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
 * With `target.over`, an environment is built over that tier instead. A
 * python environment's virtualenv is of the tier's Python, what the tier's
 * image holds the same is left to it, and it carries no interpreter. It runs
 * once the agent that composes it over the tier has linked the tier's
 * interpreter (`composeEnvironmentOverTier`). Every distribution is still
 * installed here first, which is how one is told to be the tier's; builds
 * over tiers of one Python that run together share that install. A node
 * environment is installed whole, and then each of East's packages its lock
 * resolved from the registry at a version the tier's image holds is left to
 * the tier, with every package only they need: the agent links each to the
 * image's copy.
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
 *   for, a directory that is not empty, an environment that does not fit the
 *   tier it is asked to be built over ({@link environmentFitsTier}), and a
 *   failed install, whose directory is removed
 *
 * @example
 * ```ts
 * const built = await materializeEnvironmentFor(storage, repo, envHash, { platform: 'x86_64-manylinux_2_28' }, scratch);
 * // built.interpreter === '.python'; built.project lists the project's own files
 * const small = await materializeEnvironmentFor(storage, repo, envHash, { platform: 'x86_64-manylinux_2_28', over: tier }, scratch);
 * // small.interpreter === null; small.fromTier counts what the tier's image holds for it
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
  const spec = decodeEnvironmentSpec(await storage.objects.read(repo, envHash), envHash);
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
  const over = target.over;
  if (over !== undefined && !await fitsTier(storage, repo, spec, over)) {
    throw new Error(`environment materialization: ${named} does not fit the tier it is asked to be built over: a python environment ` +
      'whose lock takes the tier\'s Python does, and a node one locked by npm over a tier that holds Node');
  }

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
      case 'workspace_python':
        parts = await buildPython(storage, repo, spec, buildDir, settings, platform, over?.python === undefined ? undefined : { tier: over.python, envHash });
        break;
      case 'node':
        parts = await buildNode(storage, repo, spec, buildDir, settings, platform, over?.node);
        break;
      case 'workspace_node':
        parts = await buildWorkspaceNode(storage, repo, spec, buildDir, buildDir, settings, platform, over?.node);
        break;
    }
    if (settings.uid !== undefined || settings.gid !== undefined) await takeBack(buildDir);
    return { dir: buildDir, interpreter: parts.interpreter, project: [...parts.project].sort(), fromTier: parts.fromTier };
  } catch (err) {
    await fs.rm(buildDir, { recursive: true, force: true });
    throw err;
  }
}

/** Whether a decoded environment fits a tier ({@link environmentFitsTier}). */
async function fitsTier(storage: StorageBackend, repo: string, spec: EnvironmentSpec, tier: TierManifest): Promise<boolean> {
  switch (spec.type) {
    case 'python':
    case 'workspace_python': {
      if (tier.python === undefined) return false;
      // The lock's own account of the Pythons it was resolved for
      const lock = (await readFile(storage, repo, spec.value.lock)).toString('utf-8');
      const requires = /^requires-python\s*=\s*"([^"]*)"/m.exec(lock)?.[1];
      return requires !== undefined && pythonSatisfies(tier.python.version, requires);
    }
    case 'node':
    case 'workspace_node':
      // npm's lock: what is left to the tier is read from npm's account of
      // the tree it installs, and pnpm lays one out otherwise
      return tier.node !== undefined && nodeLockFilename(await readFile(storage, repo, spec.value.lock)) === 'package-lock.json';
    default:
      return false;
  }
}

/**
 * Whether an environment can be built over a tier ({@link EnvironmentTarget.over}):
 * a python environment whose lock takes the tier's Python, and a node one
 * that npm locked, over a tier that holds Node. Any other is built whole, a
 * python one with an interpreter of its own.
 *
 * @param storage - Storage backend holding the spec and its files
 * @param repo - Repository path
 * @param envHash - Object hash of the beast2-encoded {@link EnvironmentSpec}
 * @param tier - The tier's manifest
 * @returns Whether it fits
 *
 * @example
 * ```ts
 * const over = await environmentFitsTier(storage, repo, envHash, tier) ? tier : undefined;
 * const built = await materializeEnvironmentFor(storage, repo, envHash, { platform, ...(over !== undefined && { over }) }, scratch);
 * ```
 */
export async function environmentFitsTier(storage: StorageBackend, repo: string, envHash: string, tier: TierManifest): Promise<boolean> {
  return fitsTier(storage, repo, decodeEnvironmentSpec(await storage.objects.read(repo, envHash), envHash), tier);
}

// =============================================================================
// An environment built ahead of its call
// =============================================================================

/** The variable a host names its pre-built environment's hash in. */
export const PREBUILT_ENV_HASH_VAR = 'E3_BAKED_ENV_HASH';

/** The variable a host names its pre-built environment's directory in. */
export const PREBUILT_ENV_DIR_VAR = 'E3_BAKED_ENV_DIR';

/** An environment built ahead of the call that declares it. */
export interface PrebuiltEnvironment {
  /** The environment's hash: the hash of its spec object. */
  readonly hash: string;
  /** The absolute directory it is in. */
  readonly dir: string;
}

/**
 * The environment a host holds pre-built, as its variables name it.
 *
 * @param env - The process's environment variables
 * @returns The pre-built environment, or undefined when the host names none
 * @throws {Error} When only one of the two variables is set, the hash is not
 *   an object hash, or the directory is not absolute: the host was set up
 *   wrongly
 *
 * @example
 * ```ts
 * const prebuilt = prebuiltEnvironment(process.env);
 * if (prebuilt !== undefined && prebuilt.hash === task.environment) await linkPrebuiltEnvironment(repo, prebuilt);
 * ```
 */
export function prebuiltEnvironment(env: Readonly<Record<string, string | undefined>>): PrebuiltEnvironment | undefined {
  const hash = env[PREBUILT_ENV_HASH_VAR];
  const dir = env[PREBUILT_ENV_DIR_VAR];
  if (hash === undefined && dir === undefined) return undefined;
  if (hash === undefined || dir === undefined) {
    const [set, unset] = hash === undefined ? [PREBUILT_ENV_DIR_VAR, PREBUILT_ENV_HASH_VAR] : [PREBUILT_ENV_HASH_VAR, PREBUILT_ENV_DIR_VAR];
    throw new Error(`${set} is set and ${unset} is not: a pre-built environment is named by both`);
  }
  if (!isObjectHash(hash)) {
    throw new Error(`${PREBUILT_ENV_HASH_VAR} '${hash}' is not an object hash`);
  }
  if (!path.isAbsolute(dir)) {
    throw new Error(`${PREBUILT_ENV_DIR_VAR} '${dir}' is not an absolute path`);
  }
  return { hash, dir };
}

/**
 * Links the path an environment is materialized at, `<repo>/envs/<hash>`
 * resolved against the working directory, to the directory it was built in
 * ahead of the call.
 *
 * @remarks
 * - What is already at the path is kept: a link an earlier call made, or the
 *   environment built there.
 * - The directory must exist. A link that leads nowhere is taken as an
 *   environment not yet built, and none could then be installed in its place.
 * - On Windows the link is a junction, which needs no privilege.
 *
 * @param repo - The repository the call runs for
 * @param prebuilt - The environment built ahead
 * @returns The link's path, absolute, as {@link materializeEnvironment} names it
 * @throws {Error} When the directory does not exist, or the link cannot be
 *   made
 *
 * @example
 * ```ts
 * await linkPrebuiltEnvironment(repo, { hash: envHash, dir: '/var/task/.e3-env' });
 * const bins = await materializeEnvironment(storage, repo, envHash); // installs nothing
 * ```
 */
export async function linkPrebuiltEnvironment(repo: string, prebuilt: PrebuiltEnvironment): Promise<string> {
  // Where materializeEnvironment looks, named as it names it: an absolute
  // path, whatever the repository's.
  const envDir = path.resolve(repo, 'envs', prebuilt.hash);
  await fs.access(prebuilt.dir);
  await fs.mkdir(path.dirname(envDir), { recursive: true });
  try {
    await fs.symlink(prebuilt.dir, envDir, 'junction');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return envDir;
}
