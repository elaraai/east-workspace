/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The budget of an e3 process: its cores and its memory.
 *
 * Every runner process e3 spawns holds one core and a memory reservation
 * while it runs, and starts only when both fit: a dataflow's tasks, the
 * pieces and merges of its split tasks, function calls, mutations and index
 * builds alike. An e3 process holds one budget — a server's is shared by
 * every run and every unit it spawns, since the memory is the machine's, and
 * each CLI command that runs units holds its own. The dataflow's loop, and
 * the pool of a task run on its own, decide what is *ready*; the budget
 * decides what *runs*. It is a runtime collaborator, like an abort signal:
 * never persisted, never part of an execution's identity, and never seen by a
 * remote backend (e3-cloud), whose capacity is its own.
 *
 * Requests are granted first come first served, but one whose memory does
 * not fit yet lets later ones that do fit pass — for a bounded time, after
 * which it holds the line until it fits, so a stream of small units never
 * starves a large one. A request for more memory than the whole budget runs
 * alone: it starts once nothing else holds the budget, and nothing starts
 * beside it.
 *
 * The default capacity is what this process may use: the CPUs of its
 * affinity mask capped by the cgroup v2 CPU quota, the way east-c sizes its
 * own pools, and the tightest cgroup v2 `memory.max` up the hierarchy, else
 * physical memory, less a reserve for e3 itself and the OS.
 */

import { readFileSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { posix } from 'node:path';

/** Releases what a grant holds; calling it again does nothing. */
export type ReleaseSlot = () => void;

/** A budget's capacity. */
export interface BudgetCapacity {
  /** Runner processes at once, one core each: a positive integer. */
  cores: number;
  /** Bytes of memory the runners may reserve between them. */
  memory: number;
}

/** What a runner asks of the budget. */
export interface BudgetRequest {
  /** Bytes of memory the runner reserves while it runs (default 0). */
  memory?: number;
  /** Aborting it while the request waits withdraws it. */
  signal?: AbortSignal;
}

/** How long a request whose memory does not fit lets later ones pass, in
 *  milliseconds, before it holds the line. */
const BYPASS_MS = 10_000;

/** The most the default memory budget keeps back for e3 and the OS; a
 *  smaller machine keeps back a quarter of its memory. */
const RESERVE_MAX_BYTES = 1024 ** 3;

/**
 * The most threads a unit is granted. A runner frames a large output on that
 * many workers, in bursts: measured on a lone unit, one thread wrote a large
 * output up to 2.6× slower than four, and past four nothing gained, while
 * each thread costs a runner about 25 MiB.
 */
export const UNIT_MAX_THREADS = 4;

/**
 * The workers of the frame pool e3's own door frames on (`configureFramePool`
 * in `@elaraai/east`), when the budget has the cores: the door's writing thread
 * is the bottleneck, and two gave it all the speed-up measured.
 */
export const DOOR_FRAME_WORKERS = 2;

/** A request waiting for its grant. */
interface Waiter {
  memory: number;
  /** When it was made, for the time it may let later requests pass. */
  since: number;
  grant: () => void;
  refuse: (error: Error) => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
}

/**
 * A budget of cores and memory, handed out to runner processes.
 *
 * @example
 * ```ts
 * const budget = new Budget({ cores: 4, memory: 8 * 1024 ** 3 });
 * const release = await budget.acquire({ memory: 512 * 1024 ** 2, signal });
 * try {
 *   await spawnRunner();
 * } finally {
 *   release();
 * }
 * ```
 */
export class Budget {
  /** Runner processes at once. */
  readonly cores: number;
  /** Bytes of memory the runners may reserve between them. */
  readonly memory: number;
  private readonly bypassMs: number;
  private held = 0;
  private reservedBytes = 0;
  /** Set while a request for more than the whole memory budget runs. */
  private alone = false;
  private peakHeld = 0;
  private readonly queue: Waiter[] = [];

  /**
   * @param capacity - The cores and memory the budget hands out
   * @param options - How long a request that does not fit lets later ones
   *   pass, in milliseconds (default ten seconds)
   * @throws {RangeError} When the cores are not a positive integer, or the
   *   memory is not a positive number of bytes.
   */
  constructor(capacity: BudgetCapacity, options: { bypassMs?: number } = {}) {
    if (!Number.isInteger(capacity.cores) || capacity.cores < 1) {
      throw new RangeError(`cores must be a positive integer, got ${capacity.cores}`);
    }
    if (!Number.isFinite(capacity.memory) || capacity.memory <= 0) {
      throw new RangeError(`memory must be a positive number of bytes, got ${capacity.memory}`);
    }
    this.cores = capacity.cores;
    this.memory = capacity.memory;
    this.bypassMs = options.bypassMs ?? BYPASS_MS;
  }

  /** Runner processes holding the budget right now. */
  get inFlight(): number {
    return this.held;
  }

  /** Requests waiting for their grant. */
  get queued(): number {
    return this.queue.length;
  }

  /** The most runner processes that held the budget at once. */
  get peak(): number {
    return this.peakHeld;
  }

  /** Bytes of memory reserved right now: all of it while a request larger
   *  than the budget runs alone. */
  get reserved(): number {
    return this.reservedBytes;
  }

  /**
   * Takes a core and the memory asked for, waiting until both fit.
   *
   * @param request - The memory to reserve, and a signal to withdraw by
   * @returns The grant's release
   * @throws {Error} With name `AbortError` when the signal aborts before the
   *   grant; the request then holds nothing.
   * @throws {RangeError} When the memory asked for is negative or not a number.
   */
  acquire(request: BudgetRequest = {}): Promise<ReleaseSlot> {
    const { memory = 0, signal } = request;
    if (!(memory >= 0)) {
      return Promise.reject(new RangeError(`a request's memory must be a non-negative number of bytes, got ${memory}`));
    }
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<ReleaseSlot>((resolve, reject) => {
      const waiter: Waiter = { memory, since: Date.now(), grant: () => resolve(this.take(memory)), refuse: reject, signal, onAbort: undefined };
      if (signal !== undefined) {
        waiter.onAbort = () => {
          const at = this.queue.indexOf(waiter);
          if (at >= 0) this.queue.splice(at, 1);
          waiter.refuse(abortError());
          // A withdrawn request that held the line lets the rest through.
          this.grantNext();
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
      this.grantNext();
    });
  }

  /** Whether a request for `memory` bytes fits now. */
  private fits(memory: number): boolean {
    if (this.alone || this.held >= this.cores) return false;
    if (memory > this.memory) return this.held === 0;
    return this.reservedBytes + memory <= this.memory;
  }

  private take(memory: number): ReleaseSlot {
    const alone = memory > this.memory;
    const reserved = alone ? this.memory : memory;
    this.held++;
    this.reservedBytes += reserved;
    if (alone) this.alone = true;
    this.peakHeld = Math.max(this.peakHeld, this.held);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held--;
      this.reservedBytes -= reserved;
      if (alone) this.alone = false;
      this.grantNext();
    };
  }

  /** Grants the waiting requests that fit, in order. The first that does not
   *  fit lets later ones pass until it has waited the bypass time. */
  private grantNext(): void {
    let blocked = false;
    for (let at = 0; at < this.queue.length;) {
      const waiter = this.queue[at]!;
      if (this.fits(waiter.memory)) {
        this.queue.splice(at, 1);
        if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
          waiter.signal.removeEventListener('abort', waiter.onAbort);
        }
        waiter.grant();
        continue;
      }
      // Every request needs a core: with none free, nothing fits.
      if (this.alone || this.held >= this.cores) return;
      if (!blocked) {
        if (Date.now() - waiter.since >= this.bypassMs) return;
        blocked = true;
      }
      at++;
    }
  }
}

function abortError(): Error {
  const error = new Error('aborted while waiting for the budget');
  error.name = 'AbortError';
  return error;
}

/**
 * The threads a unit is granted: up to {@link UNIT_MAX_THREADS}, and no more
 * than the budget's cores, or the CPUs this process may use without one.
 *
 * @param budget - The budget the unit runs under, if any
 * @returns The unit's `threads`
 */
export function unitThreads(budget: Budget | undefined): number {
  return Math.min(UNIT_MAX_THREADS, budget?.cores ?? availableParallelism());
}

/** A file's text, or `null` when it cannot be read. */
function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The tightest of a cgroup v2 control file's limits, from the process's own
 * cgroup up to the root, or `null` when no level sets one.
 *
 * The paths are Linux paths, joined with `/` whatever the host, so the walk
 * reads the same files wherever it is exercised.
 */
function tightestCgroupLimit(
  read: (path: string) => string | null,
  cgroupFile: string,
  root: string,
  file: string,
  parse: (text: string) => number | null,
): number | null {
  const membership = read(cgroupFile);
  if (membership === null) return null;
  const line = membership.split('\n').find((entry) => entry.startsWith('0::'));
  if (line === undefined) return null;
  let relative = line.slice(3).trim();
  if (relative === '') relative = '/';
  let tightest: number | null = null;
  for (;;) {
    const text = read(posix.join(root, relative, file));
    const limit = text === null ? null : parse(text.trim());
    if (limit !== null && (tightest === null || limit < tightest)) tightest = limit;
    if (relative === '/') break;
    const slash = relative.lastIndexOf('/');
    relative = slash <= 0 ? '/' : relative.slice(0, slash);
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
 * The default cores: the CPUs available to this process — its affinity mask,
 * capped by the cgroup v2 CPU quota on Linux — and at least one.
 *
 * @returns The runner processes an e3 process keeps in flight by default
 */
export function defaultCores(): number {
  const cpus = Math.max(1, availableParallelism());
  const quota = process.platform === 'linux' ? cgroupCpuQuota() : null;
  return quota === null ? cpus : Math.max(1, Math.min(cpus, quota));
}

/**
 * The default memory: the cgroup v2 limit on Linux, else physical memory,
 * less a reserve for e3 and the OS — a quarter of it, and at most 1 GiB.
 *
 * @returns The bytes of memory runners may reserve by default
 */
export function defaultMemory(): number {
  const limit = process.platform === 'linux' ? cgroupMemoryMax() : null;
  const total = limit === null ? totalmem() : Math.min(limit, totalmem());
  return total - Math.min(RESERVE_MAX_BYTES, Math.floor(total / 4));
}

/** Binary multiples of the size suffixes {@link parseMemory} reads. */
const SIZE_UNITS: Record<string, number> = { k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };

/**
 * Reads a memory size: bytes, or a number with a `K`, `M`, `G` or `T` suffix in
 * binary units (`8G`, `512M`, `1.5GiB`, `8gb`).
 *
 * @param text - The size, as given
 * @returns The bytes, or `null` when the text is not a positive size
 */
export function parseMemory(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(?:([kmgt])(?:i?b)?|b)?$/i.exec(text.trim());
  if (match === null) return null;
  const bytes = Math.floor(Number(match[1]) * (match[2] === undefined ? 1 : SIZE_UNITS[match[2].toLowerCase()]!));
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

/** The budget's settings, as a person gives them. */
export interface BudgetSettings {
  /** The cores (`-j` / `--jobs`); else `E3_JOBS`, else {@link defaultCores}. */
  jobs?: string;
  /** The memory (`--memory`); else `E3_MEMORY`, else {@link defaultMemory}. */
  memory?: string;
}

/**
 * The budget a flag, an environment variable or the machine gives, in that
 * order, for each of the cores and the memory.
 *
 * @param settings - The flags given
 * @param env - The environment (default: this process's)
 * @returns The budget
 * @throws {RangeError} When a value given is not a positive integer of cores
 *   or a positive memory size, naming the flag or variable it came from.
 */
export function resolveBudget(settings: BudgetSettings = {}, env: Record<string, string | undefined> = process.env): Budget {
  const given = (flag: string, value: string | undefined, variable: string): [string, string] | null =>
    value !== undefined ? [flag, value]
      : env[variable] !== undefined && env[variable] !== '' ? [variable, env[variable]]
        : null;
  const jobs = given('--jobs', settings.jobs, 'E3_JOBS');
  let cores = defaultCores();
  if (jobs !== null) {
    cores = Number(jobs[1].trim());
    if (!Number.isInteger(cores) || cores < 1) throw new RangeError(`${jobs[0]} must be a positive integer, got '${jobs[1]}'`);
  }
  const size = given('--memory', settings.memory, 'E3_MEMORY');
  let memory = defaultMemory();
  if (size !== null) {
    const bytes = parseMemory(size[1]);
    if (bytes === null) {
      throw new RangeError(`${size[0]} must be a size in bytes, or with a K, M, G or T suffix (binary units, as 8G), got '${size[1]}'`);
    }
    memory = bytes;
  }
  return new Budget({ cores, memory });
}
