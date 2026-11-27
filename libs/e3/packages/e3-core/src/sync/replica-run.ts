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
import type { TaskRunner } from '../execution/interfaces.js';
import { gcObjectReaders, markReachable } from '../gc-graph.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { workspaceGetDatasetHash } from '../trees.js';
import { uuidv7 } from '../uuid.js';
import { workspaceRemove } from '../workspaces.js';
import { replicaCreate, withReadThrough, type OriginObjects } from './replica.js';

/** The most bytes of objects one write to the origin carries: a larger
 *  object goes alone, as a stream. */
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
   * Gives the origin objects: each whole, in writes of at most 16 MiB, or, one
   * larger, alone, as a stream of its bytes.
   *
   * @param objects - Each object's bytes, or a stream of them, by its hash
   * @returns Once the origin holds them
   */
  write(objects: ReadonlyMap<string, Uint8Array | AsyncIterable<Uint8Array>>): Promise<void>;
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
   * task, or ended: only ever from the execution this run settled it with.
   *
   * @param ask - The task, its identity and where its log goes
   * @returns The answer
   */
  ask(ask: ReplicaRunAsk): Promise<ReplicaRunAnswer>;
  /** Cancels the run, or a grant still being made, which then starts none:
   *  every ask still waiting answers `unknown`. It resolves once the run has
   *  ended and what it was writing to the origin is written, so nothing of it
   *  is written after, and the replica's workspace is removed. */
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

/** An object's bytes, read a range at a time as they are wanted. */
async function* streamOf(storage: StorageBackend, repo: string, hash: string, size: number): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < size; offset += WRITE_BYTES) {
    yield await storage.objects.readRange(repo, hash, offset, Math.min(WRITE_BYTES, size - offset));
  }
}

/**
 * One ask's log, read from the replica's log store by offset as the run says
 * the task wrote some, and to its end once the ask is answered.
 */
class LogFollower {
  private readonly offsets = { stdout: 0, stderr: 0 };
  private executionId: string | undefined;
  /** Whether any of the log has been given */
  private given = false;
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
    // The execution that answers is the one read: one followed before it was
    // known gives way to it while nothing of the one followed has been given
    if (answering !== undefined && answering !== this.executionId && !this.given) {
      this.executionId = answering;
      this.offsets.stdout = 0;
      this.offsets.stderr = 0;
    }
    if (this.executionId === undefined) {
      // Only an execution this run started: never an earlier run's, nor one a
      // process that went away left recorded running
      const status = await this.storage.refs.executionGetLatest(this.repo, this.ask.taskHash, this.ask.inputsHash);
      if (status === null || status.value.startedAt.getTime() < this.runStartedAt) return;
      this.executionId = status.value.executionId;
    }
    const executionId = this.executionId;
    // One execution's log, once it is followed: another's is not mixed in
    if (answering !== undefined && answering !== executionId) return;
    for (const stream of ['stdout', 'stderr'] as const) {
      const read = (limit?: number) => this.storage.logs.read(this.repo, this.ask.taskHash, this.ask.inputsHash, executionId, stream,
        { offset: this.offsets[stream], ...(limit !== undefined && { limit }) });
      for (;;) {
        let chunk = await read();
        if (chunk.size === 0) break;
        // A read that reaches the end of a log still written may end in a
        // character cut short: it is read again a byte at a time shorter, by
        // the store's own count of bytes, until it ends whole, and the rest
        // is read whole next time
        if (!final && chunk.offset + chunk.size >= chunk.totalSize) {
          const whole = chunk.size;
          for (let cut = 1; cut <= 3 && chunk.size > 0 && chunk.data.endsWith('�'); cut++) chunk = await read(whole - cut);
        }
        if (chunk.data.length > 0) {
          this.ask.onLog(stream, chunk.data);
          this.given = true;
        }
        this.offsets[stream] += chunk.size;
        if (chunk.size === 0 || chunk.complete) break;
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
  /** Settles once the grant has been made, or given up */
  private granting: Promise<void> = Promise.resolve();
  /** Settles once the run has ended */
  private ending: Promise<void> = Promise.resolve();
  private runStartedAt = 0;
  private readonly orchestrator = new LocalOrchestrator(new InMemoryStateStore());
  /** Each task of the grant's output keypath, by its name */
  private readonly outputs = new Map<string, string>();
  private readonly settled = new Map<string, Settled>();
  private readonly completions = new Map<string, TaskCompletedCallback>();
  /** The execution this run settled each task with, by its name */
  private readonly executions = new Map<string, string>();
  private readonly handedBack = new Map<string, string>();
  private readonly waiting = new Set<string>();
  private readonly sent = new Map<string, Promise<void>>();
  /** Each object the run has written to its origin, or is writing: an
   *  object is written once at a time, whichever outputs reach it */
  private readonly writes = new Map<string, Promise<void>>();
  private readonly followers = new Map<string, Set<LogFollower>>();

  constructor(private readonly options: ReplicaRunOptions) {
    this.store = options.storage;
  }

  grant(grant: ReplicaRunGrant): Promise<void> {
    if (this.granted) return Promise.reject(new Error('A replica run takes one grant'));
    this.granted = true;
    const begun = this.begin(grant);
    this.granting = begun.then(() => undefined, () => undefined);
    return begun;
  }

  /** Makes the replica and starts its run, unless the run is cancelled first. */
  private async begin(grant: ReplicaRunGrant): Promise<void> {
    const { storage, repo, origin } = this.options;
    this.ws = `replica-${uuidv7()}`;
    await replicaCreate(storage, repo, this.ws, grant.description, origin.objects);
    if (this.cancelled) return;
    this.store = withReadThrough(storage, repo, origin.objects);
    for (const task of (await dataflowGetGraph(this.store, repo, this.ws)).tasks) {
      this.outputs.set(task.name, task.output);
      this.settled.set(task.name, settledOf());
    }
    if (this.cancelled) return;

    this.runStartedAt = Date.now();
    this.handle = await this.orchestrator.start(this.store, repo, this.ws, {
      runner: this.options.runner,
      width: this.options.width,
      force: grant.force,
      onTaskComplete: (done) => {
        this.completions.set(done.name, done);
        if (done.executionId !== undefined) this.executions.set(done.name, done.executionId);
        if (done.state === 'success' && !this.cancelled) this.send(done.name);
        this.settle(done.name);
      },
      onTaskWaiting: (name) => {
        this.waiting.add(name);
        this.settle(name);
      },
      onTaskHandedBack: (name, reason) => {
        this.handedBack.set(name, reason);
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
    let stop!: () => void;
    const aborted = new Promise<'aborted'>((resolve) => { stop = () => resolve('aborted'); });
    if (ask.signal?.aborted) stop();
    else ask.signal?.addEventListener('abort', stop, { once: true });
    try {
      if (await Promise.race([settled.promise.then(() => 'settled' as const), aborted]) === 'aborted') return UNKNOWN;
      const answer = await this.answer(ask);
      // A log that cannot be read to its end costs the ask its log, not its answer
      await follower?.finish(answer.executionId).catch(() => undefined);
      return answer.answer;
    } finally {
      ask.signal?.removeEventListener('abort', stop);
      if (follower !== undefined) this.followers.get(ask.taskName)?.delete(follower);
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    for (const name of this.settled.keys()) this.settle(name);
    // A grant still being made starts no run; a run it started is cancelled
    await this.granting;
    for (const name of this.settled.keys()) this.settle(name);
    if (this.handle !== undefined) {
      await this.orchestrator.cancel(this.handle).catch(() => undefined);
      await this.ending;
    }
    // What the run was writing to the origin is written, or has failed
    await Promise.allSettled([...this.sent.values(), ...this.writes.values()]);
    // Its workspace goes with it: what it made stays the repository's, rooted
    // by its executions
    if (this.ws !== '') await workspaceRemove(this.options.storage, this.options.repo, this.ws).catch(() => undefined);
  }

  /** The answer to an ask whose task the run has settled, and the execution
   *  that answers it. */
  private async answer(ask: ReplicaRunAsk): Promise<{ answer: ReplicaRunAnswer; executionId?: string }> {
    const { taskName } = ask;
    if (this.cancelled) return { answer: UNKNOWN };
    const reason = this.handedBack.get(taskName);
    if (reason !== undefined) return { answer: { kind: 'handed-back', reason } };
    if (this.waiting.has(taskName) || this.completions.get(taskName)?.state === 'skipped') return { answer: UNKNOWN };
    // Only the execution this run settled the task with answers, over the
    // inputs asked: never another run's of the same repository
    const settledWith = this.executions.get(taskName);
    if (settledWith === undefined) return { answer: UNKNOWN };
    const status = await this.store.refs.executionGet(this.options.repo, ask.taskHash, ask.inputsHash, settledWith);
    if (status === null || status.type === 'running') return { answer: UNKNOWN };
    const { executionId } = status.value;
    const timing = { startedAtMs: status.value.startedAt.getTime(), durationMs: status.value.completedAt.getTime() - status.value.startedAt.getTime() };
    switch (status.type) {
      case 'success': {
        // Its own output's objects, whatever the workspace's ref names now
        await this.sendOutput(status.value.outputHash);
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

  /** Starts sending a completed task's output to the origin, before anything
   *  asks for it. */
  private send(name: string): void {
    const output = this.outputs.get(name);
    if (output === undefined || this.sent.has(name)) return;
    const sending = (async () => {
      const ref = await workspaceGetDatasetHash(this.options.storage, this.options.repo, this.ws, parsePathString(output));
      if (ref.refType === 'value' && ref.hash !== null) await this.sendOutput(ref.hash);
    })();
    // An ask sends again what this could not
    sending.catch(() => undefined);
    this.sent.set(name, sending);
  }

  /**
   * Hands the origin every object an output reaches that it lacks. An object
   * another output is writing, or wrote, is waited for, not sent again: an
   * origin through a hub refuses a second write of an object whose first it
   * has taken in while the second was in flight. One whose write failed is
   * written again, by this output.
   */
  private async sendOutput(root: string): Promise<void> {
    const { readObject, readHead } = gcObjectReaders(this.store, this.options.repo);
    const reached = await markReachable(readObject, new Set([root]), { readHead });
    reached.add(root);
    for (let attempt = 1; ; attempt++) {
      // Taken, with no wait between, so that no two outputs take one object
      const theirs = new Set<Promise<void>>();
      const mine: string[] = [];
      for (const hash of reached) {
        const writing = this.writes.get(hash);
        if (writing === undefined) mine.push(hash);
        else theirs.add(writing);
      }
      const writing = this.sendObjects(mine);
      for (const hash of mine) this.writes.set(hash, writing);
      writing.catch(() => {
        for (const hash of mine) if (this.writes.get(hash) === writing) this.writes.delete(hash);
      });
      const [own, ...others] = await Promise.allSettled([writing, ...theirs]);
      if (own!.status === 'rejected') throw own!.reason;
      const failed = others.find((each): each is PromiseRejectedResult => each.status === 'rejected');
      if (failed === undefined) return;
      if (attempt === 3) throw failed.reason;
    }
  }

  /** Writes to the origin each of a list of objects it does not hold: in
   *  writes of at most {@link WRITE_BYTES}, a larger one alone, as a stream. */
  private async sendObjects(hashes: readonly string[]): Promise<void> {
    const { repo, origin } = this.options;
    for (let from = 0; from < hashes.length; from += TOUCH_BATCH) {
      const batch = hashes.slice(from, from + TOUCH_BATCH);
      const held = await origin.have(batch);
      let pending = new Map<string, Uint8Array>();
      let bytes = 0;
      for (const [i, hash] of batch.entries()) {
        if (held[i] === true) continue;
        const { size } = await this.store.objects.stat(repo, hash);
        if (size > WRITE_BYTES) {
          await origin.write(new Map([[hash, streamOf(this.store, repo, hash, size)]]));
          continue;
        }
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
 * await run.cancel();
 * ```
 */
export function replicaRunOpen(options: ReplicaRunOptions): ReplicaRun {
  return new Run(options);
}
