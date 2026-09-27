/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * cgroup v2, as e3 reads and uses it: the limits of the cgroups this process
 * runs in, and a cgroup of its own for each unit where this process's cgroup
 * is delegated to e3.
 *
 * A unit's cgroup caps it (`memory.max`), so a unit that runs away dies alone,
 * and measures it whole, whatever processes it starts. cgroup v2 lets a cgroup
 * hand the memory controller to its children only once it holds no process
 * itself, so e3 first moves itself into a child cgroup of its own, `e3`; each
 * unit's cgroup is then made beside it. e3 does so where its cgroup is
 * delegated to it — it may write the cgroup's `cgroup.procs` and
 * `cgroup.subtree_control`, the memory controller is available there, and no
 * other process shares the cgroup, as under
 * `systemd-run --user --scope -p Delegate=yes` — unless `E3_CGROUPS` is `0`.
 * Anywhere else, units run in e3's cgroup, as they always have.
 */

import { constants as fsConstants, readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { posix } from 'node:path';

/** The least a unit's cap leaves above its reservation. */
const MIN_CAP_MARGIN = 64 * 1024 ** 2;

/** How long a unit's cgroup is waited on to empty before its processes are
 *  killed, and then before it is left for its parent's removal. */
const REMOVE_WAIT_MS = 1_000;

/**
 * A file's text, or `null` when it cannot be read.
 *
 * @param path - The file
 * @returns Its text
 */
export function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The cgroups this process runs in: its own, then each above it up to the
 * root, as directories of the cgroup filesystem.
 *
 * The paths are Linux paths, joined with `/` whatever the host, so the walk
 * reads the same files wherever it is exercised.
 *
 * @param read - Reads a file's text, or `null` when it cannot be read
 * @param cgroupFile - The process's cgroup membership (`/proc/self/cgroup`)
 * @param root - The cgroup filesystem's mount point
 * @returns The directories, the process's own first; none when cgroup v2 does
 *   not describe the process
 */
export function cgroupLevels(
  read: (path: string) => string | null = readTextFile,
  cgroupFile = '/proc/self/cgroup',
  root = '/sys/fs/cgroup',
): string[] {
  const membership = read(cgroupFile);
  if (membership === null) return [];
  const line = membership.split('\n').find((entry) => entry.startsWith('0::'));
  if (line === undefined) return [];
  let relative = line.slice(3).trim();
  if (relative === '') relative = '/';
  const levels: string[] = [];
  for (;;) {
    levels.push(posix.join(root, relative));
    if (relative === '/') return levels;
    const slash = relative.lastIndexOf('/');
    relative = slash <= 0 ? '/' : relative.slice(0, slash);
  }
}

/** The tightest of a cgroup v2 control file's limits up the hierarchy, or
 *  `null` when no level sets one. */
function tightestCgroupLimit(
  read: (path: string) => string | null,
  cgroupFile: string,
  root: string,
  file: string,
  parse: (text: string) => number | null,
): number | null {
  let tightest: number | null = null;
  for (const level of cgroupLevels(read, cgroupFile, root)) {
    const text = read(posix.join(level, file));
    const limit = text === null ? null : parse(text.trim());
    if (limit !== null && (tightest === null || limit < tightest)) tightest = limit;
  }
  return tightest;
}

/**
 * The CPUs a cgroup v2 quota allows this process, or `null` without one.
 *
 * Walks from the process's own cgroup up to the root, reading each level's
 * `cpu.max` (`<quota> <period>` in microseconds, or `max`), and returns the
 * tightest ceiling of `quota / period` — as east-c's `east_cpu_count` does,
 * so e3 and its runners agree on a container's limit.
 *
 * @param read - Reads a file's text, or `null` when it cannot be read
 * @param cgroupFile - The process's cgroup membership (`/proc/self/cgroup`)
 * @param root - The cgroup filesystem's mount point
 * @returns The quota in whole CPUs, or `null` when no level sets one
 */
export function cgroupCpuQuota(
  read: (path: string) => string | null = readTextFile,
  cgroupFile = '/proc/self/cgroup',
  root = '/sys/fs/cgroup',
): number | null {
  return tightestCgroupLimit(read, cgroupFile, root, 'cpu.max', (text) => {
    const [quota, period] = text.split(/\s+/);
    if (quota === undefined || quota === 'max') return null;
    const micros = Number(quota);
    const per = Number(period ?? '100000');
    return micros > 0 && per > 0 ? Math.ceil(micros / per) : null;
  });
}

/**
 * The memory a cgroup v2 limit allows this process, or `null` without one.
 *
 * Walks from the process's own cgroup up to the root, reading each level's
 * `memory.max` (bytes, or `max`), and returns the tightest.
 *
 * @param read - Reads a file's text, or `null` when it cannot be read
 * @param cgroupFile - The process's cgroup membership (`/proc/self/cgroup`)
 * @param root - The cgroup filesystem's mount point
 * @returns The limit in bytes, or `null` when no level sets one
 */
export function cgroupMemoryMax(
  read: (path: string) => string | null = readTextFile,
  cgroupFile = '/proc/self/cgroup',
  root = '/sys/fs/cgroup',
): number | null {
  return tightestCgroupLimit(read, cgroupFile, root, 'memory.max', (text) => {
    if (text === 'max') return null;
    const bytes = Number(text);
    return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
  });
}

/**
 * The memory a cgroup's processes hold that the kernel does not reclaim
 * first: `memory.current` less the inactive file cache, which is what a unit
 * reading and writing files fills.
 *
 * @param dir - The cgroup's directory
 * @param read - Reads a file's text, or `null` when it cannot be read
 * @returns The bytes, or `null` when the cgroup cannot be read
 */
export function cgroupWorkingSet(dir: string, read: (path: string) => string | null = readTextFile): number | null {
  const current = Number(read(posix.join(dir, 'memory.current'))?.trim() ?? NaN);
  if (!Number.isFinite(current)) return null;
  const stat = read(posix.join(dir, 'memory.stat'));
  const inactive = stat === null ? null : /^inactive_file (\d+)$/m.exec(stat);
  return Math.max(0, current - (inactive === null ? 0 : Number(inactive[1])));
}

/**
 * The cap of a unit expected to need `reservation` bytes: half as much again,
 * and at least 64 MiB more, so a unit whose stage measured a little low still
 * fits, and one that runs away dies alone.
 *
 * @param reservation - The bytes the unit reserves from the budget
 * @returns The unit cgroup's `memory.max`
 */
export function unitCap(reservation: number): number {
  return reservation + Math.max(Math.ceil(reservation / 2), MIN_CAP_MARGIN);
}

/** The cgroups units run in, beside e3's own, under the cgroup delegated to
 *  e3. */
export interface UnitCgroups {
  /** The cgroup delegated to e3: its units' cgroups are its children. */
  readonly dir: string;
  /**
   * Makes a cgroup for one attempt at a unit.
   *
   * @param name - Its name, unique among the units this process runs
   * @param cap - Its `memory.max` in bytes, or `null` to leave it uncapped
   * @returns Its directory
   */
  create(name: string, cap: number | null): Promise<string>;
  /**
   * The argv that runs `argv` in a cgroup: a shell that moves itself into the
   * cgroup, then executes the runner in its place, so everything the runner
   * does is counted there from its first instruction.
   *
   * @param cgroup - The cgroup's directory
   * @param argv - The runner's argv
   * @returns The argv to spawn
   */
  enter(cgroup: string, argv: readonly string[]): string[];
  /**
   * Whether the cgroup's cap killed a process in it.
   *
   * @param cgroup - The cgroup's directory
   */
  capKilled(cgroup: string): Promise<boolean>;
  /**
   * Removes a cgroup once its runner has exited: a process the runner left
   * behind in it is killed first, and a cgroup that will not empty is left for
   * its parent's removal.
   *
   * @param cgroup - The cgroup's directory
   */
  remove(cgroup: string): Promise<void>;
}

/** Where e3's cgroup is found, and whose it is: this process's by default. */
export interface CgroupSource {
  /** The platform (default: this process's). */
  platform?: NodeJS.Platform;
  /** The environment `E3_CGROUPS` is read from (default: this process's). */
  env?: Record<string, string | undefined>;
  /** The process that moves into the `e3` cgroup (default: this one). */
  pid?: number;
  /** The process's cgroup membership (default `/proc/self/cgroup`). */
  cgroupFile?: string;
  /** The cgroup filesystem's mount point (default `/sys/fs/cgroup`). */
  root?: string;
}

let shared: Promise<UnitCgroups | null> | undefined;

/**
 * The cgroups this process's units run in, set up the first time they are
 * asked for.
 *
 * @returns The units' cgroups, or `null` where this process's cgroup is not
 *   delegated to it, or `E3_CGROUPS` is `0`
 */
export function unitCgroups(): Promise<UnitCgroups | null> {
  shared ??= delegatedCgroups();
  return shared;
}

/**
 * Sets up the cgroups a process's units run in, where its cgroup is delegated
 * to it: moves the process into a child cgroup, `e3`, and hands the memory
 * controller to its cgroup's children.
 *
 * @remarks
 * A cgroup that looked delegated but could not be set up is reported once, as
 * a process warning (`E3_NO_CGROUPS`), and its units run without cgroups.
 *
 * @param source - Whose cgroup, and where it is found
 * @returns The units' cgroups, or `null` where the cgroup is not delegated, or
 *   `E3_CGROUPS` is `0`
 */
export async function delegatedCgroups(source: CgroupSource = {}): Promise<UnitCgroups | null> {
  const {
    platform = process.platform,
    env = process.env,
    pid = process.pid,
    cgroupFile = '/proc/self/cgroup',
    root = '/sys/fs/cgroup',
  } = source;
  if (platform !== 'linux' || env.E3_CGROUPS === '0') return null;
  const own = cgroupLevels(readTextFile, cgroupFile, root)[0];
  if (own === undefined) return null;
  const controllers = readTextFile(posix.join(own, 'cgroup.controllers'))?.trim().split(/\s+/) ?? [];
  if (!controllers.includes('memory')) return null;
  // The cgroup's processes must be this one alone: a cgroup that holds any
  // other cannot hand its children a controller, and moving another's
  // process is not e3's to do.
  const procs = readTextFile(posix.join(own, 'cgroup.procs'))?.split('\n').filter((line) => line !== '');
  if (procs === undefined || procs.length !== 1 || procs[0] !== String(pid)) return null;
  try {
    await fs.access(own, fsConstants.W_OK);
    await fs.access(posix.join(own, 'cgroup.procs'), fsConstants.W_OK);
    await fs.access(posix.join(own, 'cgroup.subtree_control'), fsConstants.W_OK);
  } catch {
    return null;
  }

  try {
    const self = posix.join(own, 'e3');
    await fs.mkdir(self).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw err;
    });
    await fs.writeFile(posix.join(self, 'cgroup.procs'), String(pid));
    await fs.writeFile(posix.join(own, 'cgroup.subtree_control'), '+memory');
  } catch (err) {
    process.emitWarning(
      `e3's cgroup ${own} is delegated to it, but its units' cgroups could not be set up there ` +
      `(${err instanceof Error ? err.message : String(err)}): units run in e3's own cgroup`,
      { code: 'E3_NO_CGROUPS' },
    );
    return null;
  }

  return {
    dir: own,
    async create(name, cap) {
      const cgroup = posix.join(own, name);
      await fs.mkdir(cgroup);
      try {
        // The unit's processes die together, so a runaway runner leaves no
        // half of itself behind.
        await fs.writeFile(posix.join(cgroup, 'memory.oom.group'), '1');
        if (cap !== null) await fs.writeFile(posix.join(cgroup, 'memory.max'), String(cap));
      } catch (err) {
        await fs.rmdir(cgroup).catch(() => {});
        throw err;
      }
      // A capped unit that outgrows its cap would otherwise swap, running on
      // slowly where it should die and run again under a larger cap. A kernel
      // that accounts no swap has no such file.
      if (cap !== null) await fs.writeFile(posix.join(cgroup, 'memory.swap.max'), '0').catch(() => {});
      return cgroup;
    },
    enter(cgroup, argv) {
      // Writing 0 to cgroup.procs moves the writer: the shell, which then
      // becomes the runner.
      return ['/bin/sh', '-c', 'echo 0 > "$0/cgroup.procs" && exec "$@"', cgroup, ...argv];
    },
    capKilled(cgroup) {
      const events = readTextFile(posix.join(cgroup, 'memory.events'));
      const kills = events === null ? null : /^oom_kill (\d+)$/m.exec(events);
      return Promise.resolve(kills !== null && Number(kills[1]) > 0);
    },
    async remove(cgroup) {
      // A cgroup empties as its processes are reaped; one the runner left a
      // process in is killed, and one that still will not empty is left.
      for (const kill of [false, true]) {
        if (kill) {
          try {
            await fs.writeFile(posix.join(cgroup, 'cgroup.kill'), '1');
          } catch {
            return;
          }
        }
        const until = Date.now() + REMOVE_WAIT_MS;
        for (;;) {
          try {
            await fs.rmdir(cgroup);
            return;
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EBUSY') return;
          }
          if (Date.now() >= until) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    },
  };
}
