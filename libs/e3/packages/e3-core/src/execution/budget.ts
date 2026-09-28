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
 * On Linux and macOS a guard watches what the runners use (`memory.ts`). A
 * runner counts against the memory at the larger of its reservation and what
 * it uses, so nothing more starts near the budget. Past the budget, the guard
 * stops the most recently started engine unit — a piece, or a merge or fold,
 * of a split task — that is not running alone, one at a time, and the unit's
 * execution runs it again once the most it reached fits: a unit is pure and
 * content-addressed, so it reruns to the same bytes. A user task — a task run
 * as one unit, a mutation, a function call — may touch outside systems, so it
 * is stopped only when the machine would otherwise run out. On Windows the
 * guard does not run, and the budget admits by reservations alone.
 *
 * The default capacity is what this process may use: the CPUs of its
 * affinity mask capped by the cgroup v2 CPU quota, the way east-c sizes its
 * own pools, and the tightest cgroup v2 `memory.max` up the hierarchy, else
 * physical memory, less a reserve for e3 itself and the OS.
 */

import { availableParallelism, totalmem } from 'node:os';
import { cgroupCpuQuota, cgroupMemoryMax } from './cgroups.js';
import { defaultMemorySampler, type MeasuredRunner, type MemorySampler } from './memory.js';

/**
 * What a grant runs, as the guard treats it: an engine unit (`unit`) — a
 * piece, or a merge or fold, of a split task — which it stops past the budget
 * and its execution runs again; or a user task (`task`), which may touch
 * outside systems, and which it stops only when the machine would otherwise
 * run out.
 */
export type GrantKind = 'unit' | 'task';

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
  /** What the grant runs (default `task`). */
  kind?: GrantKind;
  /** Called once, when the request cannot be granted at once and waits. */
  onWaiting?: () => void;
}

/** A runner a grant runs, as the guard watches it. */
export interface WatchedRunner extends MeasuredRunner {
  /** Stops the runner and every process it started. */
  stop(): void;
}

/** Why the guard stopped a grant's runner. */
export interface GuardStop {
  /** `budget` when what the runners used went past the budget, `machine`
   *  when the machine was nearly out of memory. */
  readonly reason: 'budget' | 'machine';
  /** The most the grant's runners were measured using, in bytes. */
  readonly peak: number;
}

/** A core and a memory reservation, held for one execution's runners until
 *  released. */
export interface Grant {
  /** The bytes reserved: all of the budget's for a grant that runs alone. */
  readonly memory: number;
  /** What the grant runs. */
  readonly kind: GrantKind;
  /** Whether it asked for more than the whole budget, and so runs alone. */
  readonly alone: boolean;
  /** Why the guard stopped its runner, or `null` while it has not. */
  readonly stopped: GuardStop | null;
  /**
   * Watches a runner the grant runs, from its spawn, so what it uses counts
   * and the guard may stop it.
   *
   * @param runner - The runner
   */
  watch(runner: WatchedRunner): void;
  /** Stops watching the runner, once it has exited. */
  unwatch(): void;
  /** Releases the core and the memory; calling it again does nothing. */
  release(): void;
}

/** How a budget admits and guards. */
export interface BudgetOptions {
  /** How long a request whose memory does not fit lets later ones pass, in
   *  milliseconds (default ten seconds). */
  bypassMs?: number;
  /** What measures the runners and the machine: this platform's by default,
   *  and none on Windows. `null` runs no guard. */
  sampler?: MemorySampler | null;
  /** How often the guard measures, in milliseconds (default a quarter
   *  second); `0` leaves it to {@link Budget.check}. */
  sampleMs?: number;
}

/** How long a request whose memory does not fit lets later ones pass, in
 *  milliseconds, before it holds the line. */
const BYPASS_MS = 10_000;

/** How often the guard measures, in milliseconds. */
const SAMPLE_MS = 250;

/** The share of the machine's memory under which the guard stops runners
 *  that are not over the budget: user tasks, and units running alone. */
const MACHINE_FLOOR = 0.05;

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
  kind: GrantKind;
  /** When it was made, for the time it may let later requests pass. */
  since: number;
  grant: () => void;
  refuse: (error: Error) => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
}

/** What a budget does for a grant it holds. */
interface GrantHost {
  watch(holder: Holder, runner: WatchedRunner): void;
  unwatch(holder: Holder): void;
  release(holder: Holder): void;
}

/** A grant, as the budget holding it keeps it. */
class Holder implements Grant {
  /** What its runner was last measured using, in bytes. */
  usage = 0;
  /** The most its runners were measured using, in bytes. */
  measured = 0;
  /** The runner it watches now. */
  runner: WatchedRunner | null = null;
  /** When the runner was watched, in the budget's order of watches. */
  watchedAt = 0;
  /** Why the guard stopped it. */
  stop: GuardStop | null = null;
  private released = false;

  constructor(
    private readonly host: GrantHost,
    readonly memory: number,
    readonly kind: GrantKind,
    readonly alone: boolean,
  ) {}

  get stopped(): GuardStop | null {
    return this.stop;
  }

  watch(runner: WatchedRunner): void {
    if (!this.released) this.host.watch(this, runner);
  }

  unwatch(): void {
    if (!this.released) this.host.unwatch(this);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.host.release(this);
  }
}

/**
 * A budget of cores and memory, handed out to runner processes.
 *
 * @example
 * ```ts
 * const budget = new Budget({ cores: 4, memory: 8 * 1024 ** 3 });
 * const grant = await budget.acquire({ memory: 512 * 1024 ** 2, kind: 'unit', signal });
 * try {
 *   await spawnRunner({ onSpawned: (pid, stop) => grant.watch({ pid, stop }) });
 * } finally {
 *   grant.release();
 * }
 * ```
 */
export class Budget {
  /** Runner processes at once. */
  readonly cores: number;
  /** Bytes of memory the runners may reserve between them. */
  readonly memory: number;
  private readonly bypassMs: number;
  private readonly sampler: MemorySampler | null;
  private readonly sampleMs: number;
  private readonly holders = new Set<Holder>();
  private reservedBytes = 0;
  /** Set while a request for more than the whole memory budget runs. */
  private alone = false;
  private peakHeld = 0;
  private readonly queue: Waiter[] = [];
  private watches = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking = false;
  private readonly host: GrantHost = {
    watch: (holder, runner) => {
      holder.runner = runner;
      holder.usage = 0;
      holder.watchedAt = ++this.watches;
      if (this.timer === undefined && this.sampler !== null && this.sampleMs > 0) {
        this.timer = setInterval(() => void this.check(), this.sampleMs);
        this.timer.unref();
      }
    },
    unwatch: (holder) => {
      holder.runner = null;
      holder.usage = 0;
      this.idle();
      this.grantNext();
    },
    release: (holder) => {
      if (!this.holders.delete(holder)) return;
      this.reservedBytes -= holder.memory;
      if (holder.alone) this.alone = false;
      this.idle();
      this.grantNext();
    },
  };

  /**
   * @param capacity - The cores and memory the budget hands out
   * @param options - How long a request that does not fit lets later ones
   *   pass, and how the guard measures
   * @throws {RangeError} When the cores are not a positive integer, or the
   *   memory is not a positive number of bytes.
   */
  constructor(capacity: BudgetCapacity, options: BudgetOptions = {}) {
    if (!Number.isInteger(capacity.cores) || capacity.cores < 1) {
      throw new RangeError(`cores must be a positive integer, got ${capacity.cores}`);
    }
    if (!Number.isFinite(capacity.memory) || capacity.memory <= 0) {
      throw new RangeError(`memory must be a positive number of bytes, got ${capacity.memory}`);
    }
    this.cores = capacity.cores;
    this.memory = capacity.memory;
    this.bypassMs = options.bypassMs ?? BYPASS_MS;
    this.sampler = options.sampler === undefined ? defaultMemorySampler() : options.sampler;
    this.sampleMs = options.sampleMs ?? SAMPLE_MS;
  }

  /** Runner processes holding the budget right now. */
  get inFlight(): number {
    return this.holders.size;
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

  /** Bytes the grants hold right now, as admission counts them: each at the
   *  larger of its reservation and what its runner was last measured using. */
  get used(): number {
    let bytes = 0;
    for (const holder of this.holders) bytes += Math.max(holder.memory, holder.usage);
    return bytes;
  }

  /**
   * Takes a core and the memory asked for, waiting until both fit.
   *
   * @param request - The memory to reserve, what the grant runs, and a signal
   *   to withdraw by
   * @returns The grant
   * @throws {Error} With name `AbortError` when the signal aborts before the
   *   grant; the request then holds nothing.
   * @throws {RangeError} When the memory asked for is negative or not a number.
   */
  acquire(request: BudgetRequest = {}): Promise<Grant> {
    const { memory = 0, signal, kind = 'task', onWaiting } = request;
    if (!(memory >= 0)) {
      return Promise.reject(new RangeError(`a request's memory must be a non-negative number of bytes, got ${memory}`));
    }
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<Grant>((resolve, reject) => {
      const waiter: Waiter = {
        memory, kind, since: Date.now(), grant: () => resolve(this.take(memory, kind)), refuse: reject, signal, onAbort: undefined,
      };
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
      if (this.queue.includes(waiter)) onWaiting?.();
    });
  }

  /**
   * Measures the runners the grants watch, and acts on what it finds: admits
   * what now fits, and past the budget, or with the machine nearly out of
   * memory, stops one runner. The guard's timer calls it every
   * {@link BudgetOptions.sampleMs}; a measurement still in progress makes a
   * call return at once.
   *
   * @remarks
   * One runner is stopped at a time: the next only once the stopped one's
   * grant is released, its memory freed.
   */
  async check(): Promise<void> {
    if (this.sampler === null || this.checking) return;
    const watched = [...this.holders].filter((holder) => holder.runner !== null);
    if (watched.length === 0) return;
    this.checking = true;
    try {
      let usage: Map<number, number>;
      try {
        usage = await this.sampler.sample(watched.map((holder) => holder.runner!));
      } catch {
        return;
      }
      for (const holder of watched) {
        // A runner that exited while it was measured is no longer counted.
        const bytes = holder.runner === null ? undefined : usage.get(holder.runner.pid);
        if (bytes === undefined) continue;
        holder.usage = bytes;
        holder.measured = Math.max(holder.measured, bytes);
      }
      if (![...this.holders].some((holder) => holder.stop !== null)) await this.guard();
      this.grantNext();
    } finally {
      this.checking = false;
    }
  }

  /** Stops the runner the measurements call for, if any. */
  private async guard(): Promise<void> {
    const live = [...this.holders].filter((holder) => holder.runner !== null);
    const newest = (eligible: (holder: Holder) => boolean): Holder | undefined =>
      live.filter(eligible).reduce<Holder | undefined>((last, holder) => (last === undefined || holder.watchedAt > last.watchedAt ? holder : last), undefined);
    const inUse = live.reduce((bytes, holder) => bytes + holder.usage, 0);
    let target = inUse > this.memory ? newest((holder) => holder.kind === 'unit' && !holder.alone) : undefined;
    let reason: GuardStop['reason'] = 'budget';
    if (target === undefined && this.sampler !== null) {
      let machine = null;
      try {
        machine = await this.sampler.machine();
      } catch {
        // Unread: the machine is left alone this time.
      }
      if (machine !== null && machine.available < machine.total * MACHINE_FLOOR) {
        target = newest((holder) => holder.kind === 'unit') ?? newest(() => true);
        reason = 'machine';
      }
    }
    // The target may have exited while the machine was read.
    if (target === undefined || target.runner === null) return;
    target.stop = { reason, peak: target.measured };
    target.runner.stop();
  }

  /** Stops the guard's timer once no grant watches a runner. */
  private idle(): void {
    if (this.timer === undefined || [...this.holders].some((holder) => holder.runner !== null)) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Whether a request for `memory` bytes fits now. */
  private fits(memory: number): boolean {
    if (this.alone || this.holders.size >= this.cores) return false;
    if (memory > this.memory) return this.holders.size === 0;
    return this.used + memory <= this.memory;
  }

  private take(memory: number, kind: GrantKind): Grant {
    const alone = memory > this.memory;
    const holder = new Holder(this.host, alone ? this.memory : memory, kind, alone);
    this.holders.add(holder);
    this.reservedBytes += holder.memory;
    if (alone) this.alone = true;
    this.peakHeld = Math.max(this.peakHeld, this.holders.size);
    return holder;
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
      if (this.alone || this.holders.size >= this.cores) return;
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
