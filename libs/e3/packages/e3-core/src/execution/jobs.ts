/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The jobs budget of a local run (issue #770).
 *
 * A run keeps at most `jobs` runner processes in flight at once, whatever
 * launched them: the dataflow's tasks, the pieces and merges of its split
 * tasks, and a record operation's units all pass through one budget, one slot
 * per spawned runner. The dataflow's loop, and the pool of a task run on its
 * own, decide what is *ready*; the budget decides what *runs*, first come
 * first served. It is a runtime collaborator of a local run, like its abort
 * signal: never persisted, never part of an execution's identity, and never
 * seen by a remote backend (e3-cloud), whose capacity is its own.
 *
 * The default budget is the CPUs available to this process: its affinity
 * mask (`os.availableParallelism`) capped by the cgroup v2 CPU quota, the
 * way east-c sizes its own thread pool, so a container's limit is honoured.
 */

import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { posix } from 'node:path';

/** Releases a slot; calling it again does nothing. */
export type ReleaseSlot = () => void;

/** An acquisition waiting for a slot. */
interface Waiter {
  grant: () => void;
  refuse: (error: Error) => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
}

/**
 * A budget of `capacity` slots, handed out first come first served.
 *
 * @example
 * ```ts
 * const jobs = new JobSlots(4);
 * const release = await jobs.acquire(signal);
 * try {
 *   await spawnRunner();
 * } finally {
 *   release();
 * }
 * ```
 */
export class JobSlots {
  /** Slots in the budget. */
  readonly capacity: number;
  private held = 0;
  private peakHeld = 0;
  private readonly queue: Waiter[] = [];

  /**
   * @param capacity - Slots in the budget; a positive integer
   * @throws {RangeError} When `capacity` is not a positive integer.
   */
  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`jobs must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
  }

  /** Slots held right now. */
  get inFlight(): number {
    return this.held;
  }

  /** Acquisitions waiting for a slot. */
  get queued(): number {
    return this.queue.length;
  }

  /** The most slots held at once. */
  get peak(): number {
    return this.peakHeld;
  }

  /**
   * Takes a slot, waiting behind earlier acquisitions while none is free.
   *
   * @param signal - Aborting it while waiting withdraws the acquisition
   * @returns The slot's release
   * @throws {Error} With name `AbortError` when `signal` is aborted before
   *   a slot was granted; the acquisition then holds nothing.
   */
  acquire(signal?: AbortSignal): Promise<ReleaseSlot> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.held < this.capacity && this.queue.length === 0) {
      return Promise.resolve(this.take());
    }
    return new Promise<ReleaseSlot>((resolve, reject) => {
      const waiter: Waiter = { grant: () => resolve(this.take()), refuse: reject, signal, onAbort: undefined };
      if (signal !== undefined) {
        waiter.onAbort = () => {
          const at = this.queue.indexOf(waiter);
          if (at >= 0) this.queue.splice(at, 1);
          waiter.refuse(abortError());
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  private take(): ReleaseSlot {
    this.held++;
    this.peakHeld = Math.max(this.peakHeld, this.held);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held--;
      this.grantNext();
    };
  }

  private grantNext(): void {
    while (this.held < this.capacity && this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (next.signal !== undefined && next.onAbort !== undefined) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      next.grant();
    }
  }
}

function abortError(): Error {
  const error = new Error('aborted while waiting for a job slot');
  error.name = 'AbortError';
  return error;
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
 * The CPUs a cgroup v2 quota allows this process, or `null` without one.
 *
 * Walks from the process's own cgroup up to the root, reading each level's
 * `cpu.max` (`<quota> <period>` in microseconds, or `max`), and returns the
 * tightest ceiling of `quota / period` — as east-c's `east_cpu_count` does,
 * so e3 and its runners agree on a container's limit.
 *
 * The paths are Linux paths, joined with `/` whatever the host, so the walk
 * reads the same files wherever it is exercised.
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
  const membership = read(cgroupFile);
  if (membership === null) return null;
  const line = membership.split('\n').find((entry) => entry.startsWith('0::'));
  if (line === undefined) return null;
  let relative = line.slice(3).trim();
  if (relative === '') relative = '/';
  let tightest: number | null = null;
  for (;;) {
    const max = read(posix.join(root, relative, 'cpu.max'));
    if (max !== null) {
      const [quota, period] = max.trim().split(/\s+/);
      if (quota !== undefined && quota !== 'max') {
        const micros = Number(quota);
        const per = Number(period ?? '100000');
        if (micros > 0 && per > 0) {
          const cpus = Math.ceil(micros / per);
          if (tightest === null || cpus < tightest) tightest = cpus;
        }
      }
    }
    if (relative === '/') break;
    const slash = relative.lastIndexOf('/');
    relative = slash <= 0 ? '/' : relative.slice(0, slash);
  }
  return tightest;
}

/**
 * The default jobs budget: the CPUs available to this process — its affinity
 * mask, capped by the cgroup v2 CPU quota on Linux — and at least one.
 *
 * @returns The number of runner processes a run keeps in flight by default
 */
export function defaultJobs(): number {
  const cpus = Math.max(1, availableParallelism());
  const quota = process.platform === 'linux' ? cgroupCpuQuota() : null;
  return quota === null ? cpus : Math.max(1, Math.min(cpus, quota));
}
