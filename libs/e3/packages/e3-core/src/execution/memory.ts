/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What the guard measures: the memory each runner uses now, and what the
 * machine has left.
 *
 * A runner is measured whole, every process it started. Where it runs in a
 * cgroup, that is the cgroup's working set. Otherwise, on Linux, it is the
 * resident memory of its process tree, walked through `/proc` from the runner
 * down, a child list per thread: a few reads a runner, where a scan of every
 * process on the machine reads one per process, some 25 ms of CPU a scan on a
 * busy host. On macOS it is the resident memory of its process group, from one
 * `ps` of every process. Windows has no sampler, so there the guard does not
 * run and a budget admits by reservations alone.
 */

import { readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { totalmem } from 'node:os';
import { posix } from 'node:path';
import { promisify } from 'node:util';
import { cgroupLevels, cgroupWorkingSet, readTextFile } from './cgroups.js';

const execFileAsync = promisify(execFile);

/** How long macOS's memory level is taken as read, in milliseconds: reading
 *  it starts a process. */
const MACOS_LEVEL_MS = 1_000;

/** A runner as the guard measures it. */
export interface MeasuredRunner {
  /** Its pid: the leader of its process group, and the root of its process
   *  tree. */
  readonly pid: number;
  /** The cgroup it runs in, if any. */
  readonly cgroup?: string;
}

/** The machine's memory: a container's limit, where one leaves less. */
export interface MachineMemory {
  /** Bytes the machine has left. */
  readonly available: number;
  /** Bytes it has in all. */
  readonly total: number;
}

/** Measures runners, and the machine they run on. */
export interface MemorySampler {
  /**
   * Measures what each runner uses now.
   *
   * @param runners - The runners
   * @returns Each runner's resident memory in bytes, by its pid; a runner that
   *   could not be measured is left out
   */
  sample(runners: readonly MeasuredRunner[]): Promise<Map<number, number>>;
  /**
   * Measures the machine.
   *
   * @returns What it has left and in all, or `null` when that cannot be read
   */
  machine(): Promise<MachineMemory | null>;
}

/**
 * This platform's sampler.
 *
 * @returns Linux's or macOS's sampler, or `null` on a platform the guard does
 *   not run on
 */
export function defaultMemorySampler(): MemorySampler | null {
  if (process.platform === 'linux') return linuxMemorySampler();
  if (process.platform === 'darwin') return macosMemorySampler();
  return null;
}

/**
 * Linux's sampler: a runner's cgroup's working set where it has one, else the
 * resident memory of its process tree; and the machine's available memory, or
 * a container's, where a cgroup limit up this process's hierarchy leaves less.
 *
 * @param proc - The proc filesystem's mount point
 * @param cgroupRoot - The cgroup filesystem's mount point
 * @returns The sampler
 */
export function linuxMemorySampler(proc = '/proc', cgroupRoot = '/sys/fs/cgroup'): MemorySampler {
  return {
    sample: (runners) => {
      const usage = new Map<number, number>();
      for (const runner of runners) {
        const bytes = runner.cgroup !== undefined ? cgroupWorkingSet(runner.cgroup) : processTreeResident(proc, runner.pid);
        if (bytes !== null) usage.set(runner.pid, bytes);
      }
      return Promise.resolve(usage);
    },
    machine: () => Promise.resolve(linuxMachineMemory(proc, cgroupRoot)),
  };
}

/** Linux's memory available, or a container's, where a cgroup limit up this
 *  process's hierarchy leaves less; `null` when meminfo cannot be read. */
function linuxMachineMemory(proc: string, cgroupRoot: string): MachineMemory | null {
  const meminfo = readTextFile(posix.join(proc, 'meminfo'));
  const field = (name: string): number | null => {
    const match = meminfo === null ? null : new RegExp(`^${name}:\\s+(\\d+) kB$`, 'm').exec(meminfo);
    return match === null ? null : Number(match[1]) * 1024;
  };
  const available = field('MemAvailable');
  const total = field('MemTotal');
  if (available === null || total === null) return null;
  let machine: MachineMemory = { available, total };
  for (const level of cgroupLevels(readTextFile, posix.join(proc, 'self', 'cgroup'), cgroupRoot)) {
    const max = Number(readTextFile(posix.join(level, 'memory.max'))?.trim());
    const used = Number.isSafeInteger(max) ? cgroupWorkingSet(level) : null;
    if (used !== null && max - used < machine.available) machine = { available: Math.max(0, max - used), total: max };
  }
  return machine;
}

/** The resident memory, in bytes, of a process and every process beneath it,
 *  or `null` once the process has gone. */
function processTreeResident(proc: string, pid: number): number | null {
  const pending = [pid];
  const seen = new Set<number>();
  let bytes = 0;
  let found = false;
  while (pending.length > 0) {
    const next = pending.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const status = readTextFile(posix.join(proc, String(next), 'status'));
    if (status === null) continue;
    if (next === pid) found = true;
    const resident = /^VmRSS:\s+(\d+) kB$/m.exec(status);
    if (resident !== null) bytes += Number(resident[1]) * 1024;
    let tasks: string[];
    try {
      tasks = readdirSync(posix.join(proc, String(next), 'task'));
    } catch {
      continue;
    }
    // A process's children are listed per thread: the thread that forked each.
    for (const task of tasks) {
      const children = readTextFile(posix.join(proc, String(next), 'task', task, 'children'));
      for (const child of children?.trim().split(/\s+/) ?? []) {
        if (child !== '') pending.push(Number(child));
      }
    }
  }
  return found ? bytes : null;
}

/**
 * macOS's sampler: a runner's process group's resident memory, from one `ps`
 * of every process; and the machine's available memory, from its memory
 * level, the share of memory the kernel counts free for new work.
 *
 * @returns The sampler
 */
export function macosMemorySampler(): MemorySampler {
  let level: { at: number; machine: MachineMemory | null } | undefined;
  return {
    sample: async (runners) => {
      const { stdout } = await execFileAsync('/bin/ps', ['-A', '-o', 'pgid=,rss=']);
      const groups = psGroupResident(stdout);
      const usage = new Map<number, number>();
      for (const runner of runners) {
        const bytes = groups.get(runner.pid);
        if (bytes !== undefined) usage.set(runner.pid, bytes);
      }
      return usage;
    },
    machine: async () => {
      if (level === undefined || Date.now() - level.at >= MACOS_LEVEL_MS) {
        let machine: MachineMemory | null = null;
        try {
          const { stdout } = await execFileAsync('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_level']);
          const percent = Number(stdout.trim());
          if (stdout.trim() !== '' && Number.isFinite(percent)) {
            machine = { available: Math.floor((totalmem() * percent) / 100), total: totalmem() };
          }
        } catch {
          // Unread: the guard does not act on the machine this time.
        }
        level = { at: Date.now(), machine };
      }
      return level.machine;
    },
  };
}

/**
 * The resident memory of each process group a `ps -A -o pgid=,rss=` listing
 * names.
 *
 * @param listing - The listing: a process group and a resident size in KiB
 *   per line, one line per process
 * @returns Bytes by process group
 */
export function psGroupResident(listing: string): Map<number, number> {
  const groups = new Map<number, number>();
  for (const line of listing.split('\n')) {
    const [pgid, rss] = line.trim().split(/\s+/);
    if (pgid === undefined || rss === undefined) continue;
    const group = Number(pgid);
    const kib = Number(rss);
    if (!Number.isInteger(group) || !Number.isFinite(kib)) continue;
    groups.set(group, (groups.get(group) ?? 0) + kib * 1024);
  }
  return groups;
}
