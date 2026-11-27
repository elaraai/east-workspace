/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A replica's run: a selection granted to another repository, made a replica
 * there and run with e3's own loop, which answers, task by task, for the
 * result of what its origin asks.
 *
 * The replica's run orders the selection's tasks itself: it plans each split
 * task, runs its pieces and merges, and takes what its own cache answers. Its
 * origin asks for a task by the identity its own run computed, `(taskHash,
 * inputsHash)`, and is answered from the replica's records once the replica's
 * run has settled that task: its result, with every object its output reaches
 * handed to the origin first; that its runner could not run it here; or that
 * the replica has no result for those inputs. Each output's objects are sent
 * as the task completes, before anything asks for it.
 */

import type { SyncDescription } from '@elaraai/e3-types';
import { TOUCH_BATCH } from '../concurrency.js';
import { dataflowGetGraph, parsePathString } from '../dataflow.js';
import { LocalOrchestrator } from '../dataflow/orchestrator/LocalOrchestrator.js';
import type { ExecutionHandle, TaskCompletedCallback } from '../dataflow/orchestrator/interfaces.js';
import { InMemoryStateStore } from '../dataflow/state-store/InMemoryStateStore.js';
import type { TaskExecuteOptions, TaskResult, TaskRunner } from '../execution/interfaces.js';
import { gcObjectReaders, markReachable } from '../gc-graph.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { workspaceGetDatasetHash } from '../trees.js';
import { uuidv7 } from '../uuid.js';
import { replicaCreate, withReadThrough, type OriginObjects } from './replica.js';

/** The most bytes of objects one write to the origin carries. */
const WRITE_BYTES = 16 * 1024 * 1024;

/** What a replica's run needs of its origin. */
export interface ReplicaRunOrigin {
  /** Objects within the description's closure */
  readonly objects: OriginObjects;
  /**
   * Which of these objects the origin holds.
   *
   * @param hashes - The objects' hashes
   * @returns For each, in order, whether the origin holds it
   */
  have(hashes: readonly string[]): Promise<boolean[]>;
  /**
   * Gives the origin objects.
   *
   * @param objects - Each object's bytes, by its hash
   * @returns Once the origin holds them
   */
  write(objects: ReadonlyMap<string, Uint8Array>): Promise<void>;
}

/** How a replica's run is opened. */
export interface ReplicaRunOptions {
  /** The replica's backend */
  readonly storage: StorageBackend;
  /** The replica's repository */
  readonly repo: string;
  /** Runs each body of the replica's run */
  readonly runner: TaskRunner;
  /** Its origin */
  readonly origin: ReplicaRunOrigin;
  /** The tasks and units its loop keeps in flight */
  readonly width: number;
}

/** What a replica's run is granted. */
export interface ReplicaRunGrant {
  /** The selection, described */
  readonly description: SyncDescription;
  /** The tasks the run executes even where the cache holds their results:
   *  every task, the ones named, or none */
  readonly force: boolean | readonly string[];
}

/** An origin's ask for a task's result. */
export interface ReplicaRunAsk {
  /** The task's name */
  readonly taskName: string;
  /** Its task object's hash */
  readonly taskHash: string;
  /** The hash of the inputs the origin's run found it with */
  readonly inputsHash: string;
  /** Called with the log of the execution that answers, from its first byte,
   *  in order, each byte once */
  readonly onLog?: (stream: 'stdout' | 'stderr', text: string) => void;
  /** Aborting it stops the wait: the ask answers `unknown` */
  readonly signal?: AbortSignal;
}

/** A replica's answer to an ask. */
export type ReplicaRunAnswer =
  /** Its execution over the inputs asked, ended: a success's objects are the
   *  origin's already */
  | {
    readonly kind: 'done';
    readonly state: 'success' | 'failed' | 'error';
    readonly outputHash?: string;
    readonly exitCode?: number;
    readonly error?: string;
    readonly peakBytes?: number;
    readonly startedAtMs: number;
    readonly durationMs: number;
  }
  /** Its runner could not run it here, for a reason that is not the task's */
  | { readonly kind: 'handed-back'; readonly reason: string }
  /** The replica has no result over those inputs, and its run will make none */
  | { readonly kind: 'unknown' };

/** A replica's run. */
export interface ReplicaRun {
  /**
   * Makes the replica of a selection and starts its run. Taken once.
   *
   * @param grant - The selection and what the run forces
   * @returns Once the run has started: it does not wait for the run
   * @throws {Error} When the run was granted before
   */
  grant(grant: ReplicaRunGrant): Promise<void>;
  /**
   * The result of a task over the inputs asked, once the run has settled the
   * task, or ended.
   *
   * @param ask - The task, its identity and where its log goes
   * @returns The answer
   */
  ask(ask: ReplicaRunAsk): Promise<ReplicaRunAnswer>;
  /** Cancels the run: every ask still waiting answers `unknown`, and it
   *  resolves once the run has ended, so nothing of it is written after. */
  cancel(): Promise<void>;
}

/** A promise and its resolution, which another part of the run settles. */
interface Settled {
  readonly promise: Promise<void>;
  resolve(): void;
}

function settledOf(): Settled {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

const UNKNOWN: ReplicaRunAnswer = { kind: 'unknown' };

/**
 * One ask's log, read from the replica's log store by offset as the run says
 * the task wrote some, and to its end once the ask is answered.
 */
class LogFollower {
  private readonly offsets = { stdout: 0, stderr: 0 };
  private executionId: string | undefined;
  private reading: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: StorageBackend,
    private readonly repo: string,
    private readonly ask: ReplicaRunAsk & { readonly onLog: NonNullable<ReplicaRunAsk['onLog']> },
    private readonly runStartedAt: number,
  ) {}

  /** Reads what the run has written of the execution, to where it stands. */
  poll(): Promise<void> {
    this.reading = this.reading.then(() => this.read(undefined, false)).catch(() => undefined);
    return this.reading;
  }

  /** Reads the rest of the execution that answers, once it has ended; for
   *  an answer no execution gives, nothing more. */
  finish(executionId: string | undefined): Promise<void> {
    if (executionId === undefined) return this.reading;
    this.reading = this.reading.then(() => this.read(executionId, true));
    return this.reading;
  }

  private async read(answering: string | undefined, final: boolean): Promise<void> {
    if (this.executionId === undefined) {
      if (answering !== undefined) this.executionId = answering;
      else {
        // Only an execution this run started, or one running: never an
        // earlier run's log
        const status = await this.storage.refs.executionGetLatest(this.repo, this.ask.taskHash, this.ask.inputsHash);
        if (status === null) return;
        if (status.type !== 'running' && status.value.startedAt.getTime() < this.runStartedAt) return;
        this.executionId = status.value.executionId;
      }
    }
    // One execution's log, once it is followed: another's is not mixed in
    if (answering !== undefined && answering !== this.executionId) return;
    for (const stream of ['stdout', 'stderr'] as const) {
      for (;;) {
        const chunk = await this.storage.logs.read(this.repo, this.ask.taskHash, this.ask.inputsHash, this.executionId, stream, { offset: this.offsets[stream] });
        if (chunk.size === 0) break;
        let { data, size } = chunk;
        // A read that reaches the end of a log still written may end in a
        // character cut short: it is read again whole next time
        if (!final && chunk.offset + chunk.size >= chunk.totalSize && data.endsWith('�')) {
          data = data.slice(0, -1);
          size = new TextEncoder().encode(data).length;
        }
        if (data.length > 0) this.ask.onLog(stream, data);
        this.offsets[stream] += size;
        if (size === 0 || chunk.complete) break;
      }
    }
  }
}

/** A replica's run, as {@link replicaRunOpen} opens it. */
class Run implements ReplicaRun {
  private granted = false;
  private cancelled = false;
  private ws = '';
  private store: StorageBackend;
  private handle: ExecutionHandle | undefined;
  /** Settles once the run has ended */
  private ending: Promise<void> = Promise.resolve();
  private runStartedAt = 0;
  private forced: (name: string) => boolean = () => false;
  private readonly orchestrator = new LocalOrchestrator(new InMemoryStateStore());
  /** Each task of the grant's output keypath, by its name */
  private readonly outputs = new Map<string, string>();
  private readonly settled = new Map<string, Settled>();
  private readonly completions = new Map<string, TaskCompletedCallback>();
  private readonly handedBack = new Map<string, string>();
  private readonly waiting = new Set<string>();
  private readonly sent = new Map<string, Promise<void>>();
  private readonly followers = new Map<string, Set<LogFollower>>();

  constructor(private readonly options: ReplicaRunOptions) {
    this.store = options.storage;
  }

  async grant(grant: ReplicaRunGrant): Promise<void> {
    if (this.granted) throw new Error('A replica run takes one grant');
    this.granted = true;
    const { storage, repo, origin } = this.options;
    this.ws = `replica-${uuidv7()}`;
    await replicaCreate(storage, repo, this.ws, grant.description, origin.objects);
    this.store = withReadThrough(storage, repo, origin.objects);
    for (const task of (await dataflowGetGraph(this.store, repo, this.ws)).tasks) {
      this.outputs.set(task.name, task.output);
      this.settled.set(task.name, settledOf());
    }
    const { force } = grant;
    this.forced = (name) => force === true || (Array.isArray(force) && force.includes(name));

    this.runStartedAt = Date.now();
    this.handle = await this.orchestrator.start(this.store, repo, this.ws, {
      runner: this.noting(this.options.runner),
      width: this.options.width,
      force,
      onTaskComplete: (done) => {
        this.completions.set(done.name, done);
        if (done.state === 'success') this.send(done.name);
        this.settle(done.name);
      },
      onTaskWaiting: (name) => {
        this.waiting.add(name);
        this.settle(name);
      },
      onStdout: (name) => { this.signal(name); },
      onStderr: (name) => { this.signal(name); },
    });
    this.ending = this.orchestrator.wait(this.handle).then(() => undefined, () => undefined).finally(() => {
      for (const name of this.settled.keys()) this.settle(name);
    });
  }

  async ask(ask: ReplicaRunAsk): Promise<ReplicaRunAnswer> {
    const settled = this.settled.get(ask.taskName);
    if (settled === undefined || this.cancelled) return UNKNOWN;
    const follower = ask.onLog === undefined ? undefined
      : new LogFollower(this.store, this.options.repo, { ...ask, onLog: ask.onLog }, this.runStartedAt);
    if (follower !== undefined) {
      const following = this.followers.get(ask.taskName) ?? new Set();
      following.add(follower);
      this.followers.set(ask.taskName, following);
      void follower.poll();
    }
    try {
      const aborted = new Promise<'aborted'>((resolve) => {
        if (ask.signal?.aborted) resolve('aborted');
        ask.signal?.addEventListener('abort', () => resolve('aborted'), { once: true });
      });
      if (await Promise.race([settled.promise.then(() => 'settled' as const), aborted]) === 'aborted') return UNKNOWN;
      const answer = await this.answer(ask);
      await follower?.finish(answer.executionId);
      return answer.answer;
    } finally {
      if (follower !== undefined) this.followers.get(ask.taskName)?.delete(follower);
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    for (const name of this.settled.keys()) this.settle(name);
    if (this.handle === undefined) return;
    await this.orchestrator.cancel(this.handle).catch(() => undefined);
    await this.ending;
  }

  /** The answer to an ask whose task the run has settled, and the execution
   *  that answers it. */
  private async answer(ask: ReplicaRunAsk): Promise<{ answer: ReplicaRunAnswer; executionId?: string }> {
    const { taskName } = ask;
    if (this.cancelled) return { answer: UNKNOWN };
    const reason = this.handedBack.get(taskName);
    if (reason !== undefined) return { answer: { kind: 'handed-back', reason } };
    if (this.waiting.has(taskName) || this.completions.get(taskName)?.state === 'skipped') return { answer: UNKNOWN };
    const status = await this.store.refs.executionGetLatest(this.options.repo, ask.taskHash, ask.inputsHash);
    if (status === null || status.type === 'running') return { answer: UNKNOWN };
    // A task the grant forces is answered only by an execution this run started
    if (this.forced(taskName) && status.value.startedAt.getTime() < this.runStartedAt) return { answer: UNKNOWN };
    const { executionId } = status.value;
    const timing = { startedAtMs: status.value.startedAt.getTime(), durationMs: status.value.completedAt.getTime() - status.value.startedAt.getTime() };
    switch (status.type) {
      case 'success': {
        await (this.sent.get(taskName) ?? this.sendOutput(status.value.outputHash));
        return {
          executionId,
          answer: {
            kind: 'done', state: 'success', outputHash: status.value.outputHash, ...timing,
            ...(status.value.peakBytes.type === 'some' && { peakBytes: Number(status.value.peakBytes.value) }),
          },
        };
      }
      case 'failed': {
        const error = this.completions.get(taskName)?.error;
        return {
          executionId,
          answer: {
            kind: 'done', state: 'failed', exitCode: Number(status.value.exitCode), ...timing,
            ...(error !== undefined && { error }),
            ...(status.value.peakBytes.type === 'some' && { peakBytes: Number(status.value.peakBytes.value) }),
          },
        };
      }
      case 'error':
        return { executionId, answer: { kind: 'done', state: 'error', error: status.value.message, ...timing } };
      default:
        return { answer: UNKNOWN };
    }
  }

  /** The runner, with each hand-back noted under its task's name. */
  private noting(runner: TaskRunner): TaskRunner {
    const note = (result: TaskResult, options: TaskExecuteOptions | undefined): TaskResult => {
      if (result.handedBack !== undefined && options?.taskName !== undefined && !this.handedBack.has(options.taskName)) {
        this.handedBack.set(options.taskName, result.handedBack);
      }
      return result;
    };
    return new Proxy(runner, {
      get(target, key) {
        const member: unknown = Reflect.get(target, key, target);
        if (typeof member !== 'function') return member;
        if (key === 'execute' || key === 'executeUnit') {
          return async (...args: unknown[]): Promise<TaskResult> =>
            note(await (Reflect.apply(member, target, args) as Promise<TaskResult>), args[3] as TaskExecuteOptions | undefined);
        }
        return (...args: unknown[]): unknown => Reflect.apply(member, target, args);
      },
    });
  }

  /** Starts sending a completed task's output to the origin. */
  private send(name: string): void {
    const output = this.outputs.get(name);
    if (output === undefined || this.sent.has(name)) return;
    const sending = (async () => {
      const ref = await workspaceGetDatasetHash(this.options.storage, this.options.repo, this.ws, parsePathString(output));
      if (ref.refType === 'value' && ref.hash !== null) await this.sendOutput(ref.hash);
    })();
    // Observed where an ask waits on it
    sending.catch(() => undefined);
    this.sent.set(name, sending);
  }

  /** Hands the origin every object an output reaches that it lacks. */
  private async sendOutput(root: string): Promise<void> {
    const { repo, origin } = this.options;
    const { readObject, readHead } = gcObjectReaders(this.store, repo);
    const reached = await markReachable(readObject, new Set([root]), { readHead });
    reached.add(root);
    const hashes = [...reached];
    for (let from = 0; from < hashes.length; from += TOUCH_BATCH) {
      const batch = hashes.slice(from, from + TOUCH_BATCH);
      const held = await origin.have(batch);
      let pending = new Map<string, Uint8Array>();
      let bytes = 0;
      for (const [i, hash] of batch.entries()) {
        if (held[i] === true) continue;
        const data = await this.store.objects.read(repo, hash);
        if (bytes + data.length > WRITE_BYTES && pending.size > 0) {
          await origin.write(pending);
          pending = new Map();
          bytes = 0;
        }
        pending.set(hash, data);
        bytes += data.length;
      }
      if (pending.size > 0) await origin.write(pending);
    }
  }

  private settle(name: string): void {
    this.settled.get(name)?.resolve();
  }

  private signal(name: string): void {
    for (const follower of this.followers.get(name) ?? []) void follower.poll();
  }
}

/**
 * Opens a replica's run, to be granted a selection.
 *
 * @param options - The replica's backend and repository, the runner its run
 *   runs bodies with, its origin and its width
 * @returns The run
 *
 * @example
 * ```ts
 * const run = replicaRunOpen({ storage, repo: replica, runner: new LocalTaskRunner(replica), origin, width: 8 });
 * await run.grant({ description, force: false });
 * const answer = await run.ask({ taskName: 'first', taskHash, inputsHash });
 * ```
 */
export function replicaRunOpen(options: ReplicaRunOptions): ReplicaRun {
  return new Run(options);
}
