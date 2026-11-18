/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local in-process dataflow orchestrator.
 *
 * Executes dataflow using an async loop with step functions.
 * This is the default orchestrator for CLI and local API server usage.
 *
 * A run follows its inputs: after each task completes, and whenever a start
 * that finds it in flight wakes it, it looks for root input changes. Every
 * result lands, and a task whose inputs moved while it ran runs once more on
 * the newest. A task that reads several results reads them all as of one
 * commit of each record — the oldest its inputs came from, a newer result
 * read there from the execution cache or made there by a catch-up run — and
 * is deferred only where its inputs read a plain input at two values.
 * Whatever takes its workspace whole — a deploy, a removal, a copy onto it or
 * an export of it — announces itself, and stops it.
 *
 * It runs wherever its host does: a run's tasks go to the runner its start
 * names, or else to its host's ({@link LocalOrchestratorHost}), and a split
 * task's own execution is recorded under the owner its host names. The root
 * entry of `@elaraai/e3-core` exports it with this process as its host
 * (`execution/local-orchestrator.ts`): tasks run locally, owned by this
 * process.
 */

import { StringType, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant } from '@elaraai/east';
import type {
  DataflowRun, ExecutionOwner, StageUnit, TaskExecutionRecord, Structure, TaskObject, UnitWait, VersionVector, WorkspaceState,
} from '@elaraai/e3-types';
import { WorkspaceRecordType, decodePackageObject, decodeTaskObject } from '@elaraai/e3-types';
import type { StorageBackend, LockHandle } from '../../storage/interfaces.js';
import type { SplitUnit, TaskExecuteOptions } from '../../execution/interfaces.js';
import type { ExecutionResult } from '../../execution/cache.js';
import { SplitTask, isSplitTask, type ThrownUnit } from '../../execution/engine.js';
import { WorkspaceLockError, DataflowAbortedError, DataflowError, DataflowSupersededError, checkName } from '../../errors.js';
import { INTENT_PROBE_MS, acquireWorkspaceShared, announcedIntent, intentWords, workspaceLockRefusal } from '../../deploy-lock.js';
import type { TaskExecutionResult } from '../../dataflow.js';
import { inputsHash } from '../../executions.js';
import { uuidv7 } from '../../uuid.js';
import type {
  DataflowOrchestrator,
  ExecutionHandle,
  ExecutionProgress,
  ExecutionStatus,
  OrchestratorStartOptions,
  ResumeOptions,
} from './interfaces.js';
import { stateToStatus } from './interfaces.js';
import type { ExecutionStateStore, ExecutionStatusDetails, StateWriteOutcome } from '../state-store/interfaces.js';
import { cloneExecutionState } from '../state-store/clone.js';
import type {
  CatchUpRun,
  DataflowExecutionState,
  ExecutionEvent,
  FinalizeResult,
  PrepareTaskResult,
  TaskCommits,
  TaskState,
} from '../types.js';
import {
  stepInitialize,
  stepGetReady,
  stepPrepareTask,
  stepTaskStarted,
  stepTaskSplit,
  stepTaskMergeStarted,
  stepTaskMergeCompleted,
  stepUnitRequeued,
  stepTaskCompleted,
  stepTaskFailed,
  stepTasksSkipped,
  stepTasksWaiting,
  stepIsComplete,
  stepFinalize,
  stepCancel,
  stepYield,
  stepApplyTreeUpdate,
  stepDetectInputChanges,
  stepTasksDue,
  stepTaskDueAgain,
  stepTaskCommits,
  deferralPath,
  stepGetRunSet,
  stepTaskForced,
  waitingTasks,
} from '../steps.js';
import type { Mutable } from '../types.js';

/** Whether two inputs hashes are the same: what tells a task's own run over
 *  a set of inputs from a catch-up run of it over the same. */
const sameInputs = equalFor(StringType);

/** Whether two names are one: a repository's, or a workspace's. */
const sameName = equalFor(StringType);

/** The tasks and units the loop keeps in flight unless its caller sets a
 *  width. */
const DEFAULT_LOOP_WIDTH = 4;

/** Refuses a width the loop could never launch under: it would report a run
 *  it cannot start as stuck. */
function checkWidth(width: number | undefined): void {
  if (width !== undefined && !(Number.isInteger(width) && width >= 1)) {
    throw new RangeError(`width must be a positive integer, got ${width}`);
  }
}

// =============================================================================
// Async Mutex for State Mutations
// =============================================================================

/**
 * Simple async mutex to serialize state mutations.
 *
 * When multiple tasks complete concurrently, their `.then()` callbacks
 * mutate shared DataflowExecutionState. Between `await` points
 * (stepApplyTreeUpdate, handleInputChanges), another callback can run
 * and corrupt counters/version vectors. This mutex ensures only one
 * state mutation runs at a time while task execution itself runs in parallel.
 */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  /**
   * Acquire the mutex, execute the callback, then release.
   * If the mutex is already held, waits until it's available.
   */
  async runExclusive<T>(fn: () => T): Promise<Awaited<T>> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

// =============================================================================
// The Run's Writer
// =============================================================================

/**
 * A write of a run's state: a snapshot of it as it stands, carrying the events
 * the run added since its last write, which the run's state then holds no
 * more. An event, once added, is never changed, so the write takes them over
 * rather than copy them, and carries none written before: the store keeps a
 * run's events apart from its state.
 *
 * @param state - The run's state, which the loop goes on changing
 * @returns The write
 */
function takeWrite(state: DataflowExecutionState): DataflowExecutionState {
  const events = state.events;
  (state as Mutable<DataflowExecutionState>).events = [];
  return { ...cloneExecutionState(state), events };
}

/**
 * A run's one writer of its state: every write of the run goes through it, and
 * reaches the store a write at a time, in the order the writes were made.
 *
 * @remarks
 * A write is a snapshot of the state as it stood when the write was made, so a
 * write waiting its turn carries that state, however the loop changes its own
 * meanwhile, and the events the run added since the write before it
 * ({@link takeWrite}), which the store appends to the run's. The store never
 * has two of the run's writes at once, which a store that moves a run's state
 * by compare-and-set would refuse as another process's.
 *
 * Once the store takes a write otherwise than applying it — `dropped`, the run
 * having ended, or `refused`, another process having moved it on — the writer
 * writes nothing more: every later write answers that outcome unwritten, and
 * `onStop` hears it once.
 *
 * A write that fails — the store briefly down — fails alone, and the next one
 * still goes, carrying the events the failed one did not write before its own:
 * the store appends a run's events by their numbers, so none is lost, and none
 * kept twice.
 */
class RunWriter {
  /** Settles once every write made so far has landed, or failed. */
  private tail: Promise<unknown> = Promise.resolve();
  /** The outcome that stopped the writer, once a write was not applied. */
  private stopped: 'dropped' | 'refused' | null = null;
  /** The events the writes that failed carried, which the next write carries. */
  private unwritten: ExecutionEvent[] = [];

  /**
   * @param store - The store the run's state is kept in
   * @param onStop - Hears the outcome that stopped the writer, once
   */
  constructor(
    private readonly store: ExecutionStateStore,
    private readonly onStop: (outcome: 'dropped' | 'refused') => void,
  ) {}

  /**
   * Writes the run's whole state, as it stands now.
   *
   * @param state - The run's state, which the loop may change as soon as this
   *   returns
   * @returns How the store took it
   */
  write(state: DataflowExecutionState): Promise<StateWriteOutcome> {
    const snapshot = takeWrite(state);
    return this.enqueue(async () => {
      const write = this.unwritten.length === 0 ? snapshot : { ...snapshot, events: [...this.unwritten, ...snapshot.events] };
      this.unwritten = [];
      try {
        return await this.store.update(write);
      } catch (err) {
        this.unwritten = write.events;
        throw err;
      }
    });
  }

  /**
   * Sets the run's status, over the state the writes before this one left.
   *
   * @param repo - Repository identifier
   * @param workspace - Workspace name
   * @param id - The run's id
   * @param status - Its status
   * @param details - Its error and summary
   * @returns How the store took it
   */
  writeStatus(
    repo: string,
    workspace: string,
    id: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled',
    details: ExecutionStatusDetails,
  ): Promise<StateWriteOutcome> {
    return this.enqueue(() => this.store.updateStatus(repo, workspace, id, status, details));
  }

  /** Applies a write once every write before it has settled. */
  private enqueue(apply: () => Promise<StateWriteOutcome>): Promise<StateWriteOutcome> {
    const written = this.tail.then(async (): Promise<StateWriteOutcome> => {
      if (this.stopped !== null) return this.stopped;
      const outcome = await apply();
      if (outcome !== 'applied') {
        this.stopped = outcome;
        this.onStop(outcome);
      }
      return outcome;
    });
    // A write that failed fails itself alone: the next one still goes.
    this.tail = written.catch(() => {});
    return written;
  }
}

/**
 * How a task's execution ended, as the loop completes it.
 */
interface TaskOutcome {
  state: 'success' | 'failed' | 'error';
  cached: boolean;
  outputHash?: string;
  executionId: string;
  exitCode?: number;
  error?: string;
  cancelled?: boolean;
  duration: number;
  peakBytes?: number;
}

/** A split task's execution, as the loop completes it. */
function outcomeOf(result: ExecutionResult, startTime: number): TaskOutcome {
  return {
    state: result.state,
    cached: result.cached,
    outputHash: result.outputHash ?? undefined,
    executionId: result.executionId,
    exitCode: result.exitCode ?? undefined,
    error: result.error ?? undefined,
    cancelled: result.cancelled,
    duration: Date.now() - startTime,
    ...(result.peakBytes !== undefined && { peakBytes: result.peakBytes }),
  };
}

/**
 * What a split task's units are run for: the task's own run, whose result
 * lands in the workspace, or a catch-up run of it.
 */
interface SplitTarget {
  /** The task whose units run, by name. */
  readonly task: string;
  /** Its task object's hash. */
  readonly taskHash: string;
  /** The inputs it runs over. */
  readonly inputHashes: string[];
  /** Whether the run is the task's own: the run's state records its stages,
   *  a resumed run takes them up, and its units' progress and requeues are
   *  told. A catch-up run's is none of these. */
  readonly own: boolean;
  /** Completes the run once its last stage has ended, or it was cancelled. */
  complete(outcome: TaskOutcome): Promise<void>;
  /** Fails the run when planning it, or advancing its stages, threw. */
  fail(err: unknown): Promise<void>;
}

/**
 * A task split into pieces while the loop runs its units beside every other
 * task's: the stage in progress, and where its units are.
 */
interface SplitRun {
  /** The task's stages. */
  readonly split: SplitTask;
  /** What the units are run for. */
  readonly target: SplitTarget;
  /** When the task was launched. */
  readonly startTime: number;
  /** The stage's next unit to launch. */
  next: number;
  /** The stage's units in flight. */
  inFlight: number;
  /** Set once a unit of the stage failed or threw: the stage launches no
   *  more, and ends when its units in flight have settled. */
  stopped: boolean;
  /** Each unit's result, as it settles. */
  results: (ExecutionResult | undefined)[];
  /** The units whose runner threw. */
  thrown: ThrownUnit[];
}

/**
 * Internal state for a running execution.
 */
interface RunningExecution {
  state: DataflowExecutionState;
  lock: LockHandle;
  /** Shared workspace lock (allows concurrent set operations) */
  sharedLock: LockHandle | null;
  externalLock: boolean;
  options: OrchestratorStartOptions;
  aborted: boolean;
  /** The run's abort: fired by the caller's signal or by cancel(), and passed
   *  to every task execution, so a cancelled run stops its running tasks */
  abortController: AbortController;
  /** Set when a yield checkpoint has been taken — suppresses further persists */
  yielded: boolean;
  /** Set as the run's end is recorded — completed, failed or cancelled — or
   *  as the store stops taking its writes: nothing the run persists after it
   *  is written */
  ended: boolean;
  /** The run's one writer of its state; `null` when the orchestrator keeps no
   *  state store */
  writer: RunWriter | null;
  /** Why the store stopped taking the run's writes — `dropped`, another
   *  process having ended the run, or `refused`, another having moved it on —
   *  or `null` while it takes them */
  stoppedBy: 'dropped' | 'refused' | null;
  /**
   * Yield result, resolved into completionPromise from the loop's `finally`
   * (after locks are released) so a caller awaiting wait() can resume()
   * immediately without racing the lock release.
   */
  yieldResult?: FinalizeResult;
  /** What is in flight, each counting against the loop's width: a task by
   *  its name, a split task's planning by its name, each of its units by a
   *  key of its own, and a catch-up run by its key ({@link catchUpKey}) */
  runningTasks: Map<string, Promise<void>>;
  /** Split tasks in progress, in the order they started: a task's own run by
   *  its name, and a catch-up run by its key */
  splits: Map<string, SplitRun>;
  /** The hash of the inputs each task in flight was launched over, by name:
   *  a task another waits to read at exactly those inputs is waited for, and
   *  nothing runs twice */
  launches: Map<string, string>;
  /** The tasks that wait for catch-up runs: the versions each reads, which it
   *  is prepared at again once its runs have settled, and every run it has
   *  waited for, by key */
  catchingUp: Map<string, { versions: VersionVector; waits: Map<string, CatchUpRun> }>;
  /** The outputs of the runs a task that waits reads, by key: catch-up runs
   *  that landed, and a task's own run over exactly those inputs */
  caughtUp: Map<string, string>;
  /** What each deferred task was last told deferred for, until it launches:
   *  a deferral is told once */
  deferredFor: Map<string, string>;
  /** Why the run stopped itself — something that takes its workspace whole
   *  announced itself — or `undefined` */
  stopReason?: string;
  /** Wakes whose look for changed inputs is still under way: the loop does
   *  not end the run while one is */
  wakes: number;
  /** How many times the run moved on outside a pass of the loop: a wake's
   *  look ended, or something in flight settled. A pass during which it did
   *  takes the ready tasks again before it waits, or ends the run: what
   *  settled is no longer in flight to wake it */
  moved: number;
  /** How many runs have left flight, their results landed: a task's own, or
   *  a catch-up run. A task found behind while one did is resolved again,
   *  since a run it would wait for may be at hand now. A split task's units
   *  do not count: none of them lands a result */
  landed: number;
  /** The changed datasets whose readers have not been asked whether they are
   *  due: a look that failed once it had recorded a change leaves them here,
   *  and the next look asks them again, so no change is lost to it */
  unasked: Set<string>;
  /** Whether the run looks for changed inputs before its first pass: a run
   *  resumed, whose snapshot is the one it yielded with, takes in what was
   *  edited meanwhile before it decides a task again */
  lookFirst: boolean;
  /** Settles as a wake's look ends: what the pass of the loop that made it
   *  waits on beside what it has in flight */
  woken: { promise: Promise<void>; resolve: () => void };
  /** Set as the loop leaves off launching, to end the run: a wake after it
   *  is not taken */
  closing: boolean;
  /** Set while the run asks whether something that takes its workspace
   *  whole has announced itself */
  probing: boolean;
  /** The tasks and units waiting for room in the runner's budget, by the key
   *  each is tracked under in runningTasks. A wait matters only while it
   *  lasts, so nothing stores it. */
  waiting: Map<string, UnitWait>;
  /** The next key a split task's unit takes in runningTasks */
  unitSeq: number;
  /** Set once a task has failed: the loop launches no more tasks */
  hasFailure: boolean;
  /** The workspace's package structure, read once for the execution */
  structure: Structure | null;
  /** Mutex to serialize state mutations from concurrent task completions */
  mutex: AsyncMutex;
  /** Task execution records for DataflowRun */
  taskExecutions: Map<string, TaskExecutionRecord>;
  /** Cleanup function to remove abort listener on normal completion */
  abortCleanup?: () => void;
  completionPromise: Promise<FinalizeResult>;
  resolveCompletion: (result: FinalizeResult) => void;
  rejectCompletion: (error: Error) => void;
}

/** A promise, and what settles it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

/** A catch-up run's key: what it is tracked in flight under, and what its
 *  output is kept under once it has landed. A task's own run over the same
 *  inputs would have the same. */
function catchUpKey(run: Pick<CatchUpRun, 'task' | 'inputsHash'>): string {
  return `${run.task}@${run.inputsHash}`;
}

/**
 * What a {@link LocalOrchestrator} takes from the host it runs in: the runner
 * a run's tasks go to when its start names none, and the owner a split task's
 * own execution is recorded under when its start names none.
 *
 * @remarks
 * The root entry of `@elaraai/e3-core` gives its `LocalOrchestrator` this
 * process as its host: tasks run on this machine (`taskExecute`,
 * `taskExecuteUnit`), and this process owns a split task's execution. A host
 * with no processes of its own to run tasks in — a browser, say — gives
 * neither, and each run names its runner.
 */
export interface LocalOrchestratorHost {
  /** Runs a task, or one unit of a split task, when a run's start names no
   *  runner: on this host, reporting the execution as the execution cache
   *  records it. */
  readonly runner?: {
    /**
     * Executes a task.
     *
     * @param storage - Storage backend
     * @param repo - Repository identifier
     * @param taskHash - Hash of the task object
     * @param inputHashes - The task's input hashes
     * @param options - The run's options for the task
     * @returns The task's execution
     */
    execute(storage: StorageBackend, repo: string, taskHash: string, inputHashes: string[], options: TaskExecuteOptions): Promise<ExecutionResult>;
    /**
     * Executes one unit of a split task.
     *
     * @param storage - Storage backend
     * @param repo - Repository identifier
     * @param taskHash - Hash of the task object
     * @param unit - The unit
     * @param options - The run's options for the unit
     * @returns The unit's execution
     */
    executeUnit(storage: StorageBackend, repo: string, taskHash: string, unit: SplitUnit, options: TaskExecuteOptions): Promise<ExecutionResult>;
  };
  /**
   * The owner a split task's own execution is recorded under when a run's
   * start names none (see {@link OrchestratorStartOptions.owner}). Absent, it
   * is recorded under none.
   */
  owner?(): Promise<ExecutionOwner | null>;
}

/**
 * Local orchestrator for in-process dataflow execution.
 *
 * @remarks
 * - Uses step functions for each operation
 * - Per-dataset ref writes are atomic and independent (no mutex needed)
 * - Supports AbortSignal for cancellation
 * - Persists state through the provided state store, as each run's one
 *   writer: a write at a time, in the order they were made, each a snapshot of
 *   the state when made. A cancel writes the run's end whole, as its last word.
 *   A run whose write the store drops, another process having ended it, stops
 *   what it runs; one whose write the store refuses, another process having
 *   moved it on, leaves what it launched to that process — its runners hear
 *   why they are stopped, a split task is left mid-stage and no completion is
 *   applied. Either launches and writes nothing more, and fails no task.
 * - Follows its inputs: every result lands, a task whose inputs moved runs
 *   once more on the newest, and the run ends once no task is due, ready, in
 *   flight or catching up. What a task waits for catch-up runs at, and what
 *   those runs made, is kept in memory: a run resumed in another process
 *   decides each task again, and the execution cache answers what finished
 * - Takes a wake from a start that finds it in flight ({@link wake}), and
 *   stops itself once a deploy, a removal, a copy onto its workspace or an
 *   export of it has announced itself
 * - Runs a run's tasks on the runner its start names, or else on its host's
 *   ({@link LocalOrchestratorHost})
 * - Checks the workspace's name before a start or a resume takes a lock: a
 *   name no workspace can have is refused as an `InvalidNameError` of a
 *   workspace, never as a lock's name, and `main#dataflow` never reads as
 *   locked while main's dataflow runs
 */
export class LocalOrchestrator implements DataflowOrchestrator {
  private executions = new Map<string, RunningExecution>();

  /**
   * Create a new LocalOrchestrator.
   *
   * @param stateStore - Optional state store for persistence.
   *   If not provided, state is only kept in memory.
   * @param host - The runner a run's tasks go to when its start names none,
   *   and the owner of a split task's own execution. Without a runner, every
   *   run's start must name one.
   */
  constructor(
    private readonly stateStore?: ExecutionStateStore,
    private readonly host: LocalOrchestratorHost = {},
  ) {}

  async start(
    storage: StorageBackend,
    repo: string,
    workspace: string,
    options: OrchestratorStartOptions = {}
  ): Promise<ExecutionHandle> {
    checkWidth(options.width);
    this.checkRunner(options);
    // The name is checked as a workspace's before a lock is taken: a lock's
    // name may hold the `#` and `~` no workspace's may, so `main#dataflow`
    // would otherwise take main's dataflow lock as its own workspace's.
    checkName('workspace', workspace);

    // Acquire locks if not provided externally.
    // Dual-lock model:
    //   - Shared lock on workspace (allows concurrent e3 set)
    //   - Exclusive lock on workspace#dataflow (prevents concurrent starts)
    const externalLock = !!options.lock;

    let sharedLock: LockHandle | null = null;
    let dataflowLock: LockHandle | null = null;

    if (externalLock) {
      // Caller's lock serves as shared workspace lock
      sharedLock = options.lock!;
      // Still acquire exclusive dataflow lock (prevents concurrent starts)
      dataflowLock = await storage.locks.acquire(repo, `${workspace}#dataflow`, variant('dataflow', null));
      if (!dataflowLock) {
        throw new WorkspaceLockError(workspace);
      }
    } else {
      // Acquire shared workspace lock first (coexists with e3 set); whatever
      // takes the workspace whole refuses it once it has announced itself, as
      // one holding the workspace does
      sharedLock = await acquireWorkspaceShared(storage, repo, workspace, variant('dataflow', null));
      if (!sharedLock) throw await workspaceLockRefusal(storage, repo, workspace);

      // Acquire exclusive dataflow lock (prevents concurrent starts)
      dataflowLock = await storage.locks.acquire(repo, `${workspace}#dataflow`, variant('dataflow', null));
      if (!dataflowLock) {
        await sharedLock.release();
        throw new WorkspaceLockError(workspace);
      }
    }

    try {
      // The run's one id: its execution state's, and its run record's.
      const { state, readyTasks: _ } = await stepInitialize(
        storage,
        repo,
        workspace,
        uuidv7(),
        {
          force: options.force,
          filter: options.filter,
        }
      );

      // Persist initial state, and its events, which the run's state then
      // holds no more
      if (this.stateStore) {
        await this.stateStore.create(takeWrite(state));
      }

      return this.beginExecution(storage, repo, state, {
        dataflowLock,
        sharedLock,
        externalLock,
        options,
        taskExecutions: new Map(),
        resumed: false,
      });
    } catch (err) {
      // Always release the dataflow lock on initialization failure
      await dataflowLock!.release();
      // Release shared workspace lock only if we acquired it (not external)
      if (!externalLock && sharedLock) {
        await sharedLock.release();
      }
      throw err;
    }
  }

  /**
   * Resume an execution that yielded (shouldYield checkpoint) or whose host
   * died mid-run. See DataflowOrchestrator.resume.
   */
  async resume(
    storage: StorageBackend,
    repo: string,
    workspace: string,
    executionId: string,
    options: ResumeOptions = {}
  ): Promise<ExecutionHandle> {
    if (!this.stateStore) {
      throw new DataflowError('Cannot resume: orchestrator has no state store');
    }
    checkWidth(options.width);
    this.checkRunner(options);
    // The name is checked before a lock is taken, as start() checks it.
    checkName('workspace', workspace);

    // Same dual-lock model as start()
    const externalLock = !!options.lock;

    let sharedLock: LockHandle | null = null;
    let dataflowLock: LockHandle | null = null;

    if (externalLock) {
      sharedLock = options.lock!;
      dataflowLock = await storage.locks.acquire(repo, `${workspace}#dataflow`, variant('dataflow', null));
      if (!dataflowLock) {
        throw new WorkspaceLockError(workspace);
      }
    } else {
      sharedLock = await acquireWorkspaceShared(storage, repo, workspace, variant('dataflow', null));
      if (!sharedLock) throw await workspaceLockRefusal(storage, repo, workspace);
      dataflowLock = await storage.locks.acquire(repo, `${workspace}#dataflow`, variant('dataflow', null));
      if (!dataflowLock) {
        await sharedLock.release();
        throw new WorkspaceLockError(workspace);
      }
    }

    try {
      const state = await this.stateStore.read(repo, workspace, executionId);
      if (!state) {
        throw new DataflowError(`Execution ${executionId} not found for workspace '${workspace}'`);
      }
      if (state.status !== 'running') {
        throw new DataflowError(
          `Cannot resume execution ${executionId}: status is '${state.status}', expected 'running'`
        );
      }

      // Crash recovery: tasks stranded in_progress by a dead host are reset
      // to pending (a clean yield already did this — then it's a no-op).
      // Work they actually finished is recovered via the execution cache.
      // The write is the resumed run's first: one the store does not take
      // leaves nothing to resume.
      stepYield(state);
      const resumed = await this.stateStore.update(takeWrite(state));
      if (resumed !== 'applied') {
        throw new DataflowError(
          `Cannot resume execution ${executionId}: ${resumed === 'dropped' ? 'it has ended' : 'another process has moved it on'}`
        );
      }

      // Re-seed DataflowRun task executions for already-completed tasks so
      // the final run record covers the whole execution, not just this
      // incarnation: each names the execution its task completed with. Output
      // VVs come from the persisted version vectors.
      const taskExecutions = new Map<string, TaskExecutionRecord>();
      const graph = state.graph.type === 'some' ? state.graph.value : null;
      if (graph) {
        for (const task of graph.tasks) {
          const ts = state.tasks.get(task.name);
          // A task with a result in the run, completed or due again
          if (ts && ts.outputHash.type === 'some' && ts.execution.type === 'some') {
            taskExecutions.set(task.name, {
              executionId: ts.execution.value.executionId,
              taskHash: task.hash,
              inputsHash: ts.execution.value.inputsHash,
              cached: ts.cached.type === 'some' ? ts.cached.value : false,
              outputVersions: new Map(state.versionVectors.get(task.output) ?? []),
              executionCount: 1n,
            });
          }
        }
      }

      return this.beginExecution(storage, repo, state, {
        dataflowLock,
        sharedLock,
        externalLock,
        options,
        taskExecutions,
        resumed: true,
      });
    } catch (err) {
      await dataflowLock!.release();
      if (!externalLock && sharedLock) {
        await sharedLock.release();
      }
      throw err;
    }
  }

  /**
   * Shared tail of start() and resume(): register the RunningExecution,
   * wire the abort listener, and kick off the loop (non-blocking).
   */
  private beginExecution(
    storage: StorageBackend,
    repo: string,
    state: DataflowExecutionState,
    init: {
      dataflowLock: LockHandle;
      sharedLock: LockHandle | null;
      externalLock: boolean;
      options: OrchestratorStartOptions;
      taskExecutions: Map<string, TaskExecutionRecord>;
      /** Whether the run is one resumed, which looks for changed inputs first */
      resumed: boolean;
    }
  ): ExecutionHandle {
    const { options } = init;
    const workspace = state.workspace;
    const executionId = state.id;

    // Create completion promise
    let resolveCompletion!: (result: FinalizeResult) => void;
    let rejectCompletion!: (error: Error) => void;
    const completionPromise = new Promise<FinalizeResult>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    // The run is this orchestrator's, and so is its end: how it ended is in
    // its state, which a poll reads, and a caller that starts a run and never
    // waits on it — a server's route — leaves no rejection unhandled. wait()
    // still rejects with the run's error.
    completionPromise.catch(() => {});

    // Create running execution state
    const execution: RunningExecution = {
      state,
      lock: init.dataflowLock,
      sharedLock: init.sharedLock,
      externalLock: init.externalLock,
      options,
      aborted: false,
      abortController: new AbortController(),
      yielded: false,
      ended: false,
      writer: null,
      stoppedBy: null,
      runningTasks: new Map(),
      splits: new Map(),
      launches: new Map(),
      catchingUp: new Map(),
      caughtUp: new Map(),
      deferredFor: new Map(),
      wakes: 0,
      moved: 0,
      landed: 0,
      unasked: new Set(),
      lookFirst: init.resumed,
      woken: deferred(),
      closing: false,
      probing: false,
      waiting: new Map(),
      unitSeq: 0,
      hasFailure: false,
      structure: null,
      mutex: new AsyncMutex(),
      taskExecutions: init.taskExecutions,
      completionPromise,
      resolveCompletion,
      rejectCompletion,
    };

    // Every write of the run's state goes through its one writer.
    if (this.stateStore) {
      execution.writer = new RunWriter(this.stateStore, (outcome) => this.stopped(execution, outcome));
    }

    const key = this.executionKey(repo, workspace, executionId);
    this.executions.set(key, execution);

    // Listen for abort signal to persist cancellation immediately. The run's
    // own abort follows it.
    if (options.signal?.aborted) {
      execution.abortController.abort();
    } else if (options.signal) {
      const onAbort = () => {
        execution.aborted = true;
        execution.abortController.abort();
        void this.endCancelled(execution, 'Execution was cancelled').catch(() => { /* ignore errors during shutdown */ });
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
      execution.abortCleanup = () => options.signal!.removeEventListener('abort', onAbort);
    }

    // Start the execution loop (non-blocking)
    this.runExecutionLoop(storage, repo, execution).catch(err => {
      rejectCompletion(err);
    });

    return { id: executionId, repo, workspace };
  }

  async wait(handle: ExecutionHandle): Promise<FinalizeResult> {
    const key = this.executionKey(handle.repo, handle.workspace, handle.id);
    const execution = this.executions.get(key);

    if (!execution) {
      throw new Error(`Execution ${handle.id} not found for workspace '${handle.workspace}'`);
    }

    return execution.completionPromise;
  }

  async getStatus(handle: ExecutionHandle): Promise<ExecutionStatus> {
    const key = this.executionKey(handle.repo, handle.workspace, handle.id);
    const execution = this.executions.get(key);

    if (!execution) {
      // Try to read from state store
      if (this.stateStore) {
        const state = await this.stateStore.read(handle.repo, handle.workspace, handle.id);
        if (state) {
          return stateToStatus(state);
        }
      }
      throw new Error(`Execution ${handle.id} not found for workspace '${handle.workspace}'`);
    }

    return { ...stateToStatus(execution.state), ...this.progressOf(execution) };
  }

  /** What this orchestrator holds of a run it runs; none for any other, of
   *  which it reads nothing. */
  getProgress(handle: ExecutionHandle): Promise<ExecutionProgress> {
    const execution = this.executions.get(this.executionKey(handle.repo, handle.workspace, handle.id));
    return Promise.resolve(execution === undefined ? { waiting: [], splits: [] } : this.progressOf(execution));
  }

  /** A run's waits for room and its split tasks' progress, as the loop holds
   *  them. */
  private progressOf(execution: RunningExecution): ExecutionProgress {
    return {
      waiting: [...execution.waiting.values()],
      // A task's own run: a catch-up run is no progress of the task's
      splits: [...execution.splits.values()].filter((run) => run.target.own).map((run) => {
        const { merge, units } = run.split.stage;
        return {
          task: run.target.task,
          merge: merge === null ? none : some({ level: BigInt(merge.level), levels: BigInt(merge.levels) }),
          done: BigInt(run.results.filter((result) => result?.state === 'success').length),
          units: BigInt(units.length),
        };
      }),
    };
  }

  async cancel(handle: ExecutionHandle): Promise<void> {
    const key = this.executionKey(handle.repo, handle.workspace, handle.id);
    const execution = this.executions.get(key);

    if (!execution) {
      throw new Error(`Execution ${handle.id} not found for workspace '${handle.workspace}'`);
    }

    execution.aborted = true;
    // Stops the running tasks too.
    execution.abortController.abort();
    await this.endCancelled(execution, 'Execution was cancelled');
  }

  /**
   * Hands a look for changed inputs to the run in flight on a workspace. See
   * DataflowOrchestrator.wake: the run is one of this orchestrator's, in this
   * process.
   */
  async wake(storage: StorageBackend, repo: string, workspace: string): Promise<boolean> {
    const execution = [...this.executions.values()].find((each) => sameName(each.state.repo, repo) && sameName(each.state.workspace, workspace));
    // A run with a failed task launches nothing more, and ends once what is in
    // flight has settled: a change handed to it would never run
    const stopping = (run: RunningExecution): boolean =>
      run.closing || run.aborted || run.ended || run.yielded || run.hasFailure || run.abortController.signal.aborted;
    // A run started with a filter leaves the edit's other readers out
    if (execution === undefined || stopping(execution) || execution.state.filter.type === 'some') return false;
    // What takes the workspace whole stops the run within a second of its
    // intent: the run takes nothing in meanwhile, and the start is refused as
    // every start is while one waits, naming it. An intent that cannot be told
    // of is not handed a start either.
    try {
      if (await announcedIntent(storage, repo, workspace) !== null) {
        void this.probeIntent(storage, repo, execution);
        return false;
      }
    } catch {
      return false;
    }
    if (stopping(execution)) return false;
    // Counted before the look starts, so the loop does not end the run under it
    execution.wakes++;
    try {
      await execution.mutex.runExclusive(async () => {
        if (stopping(execution)) return;
        await this.handleInputChanges(storage, execution);
        await this.persistState(execution, execution.state);
      });
      return !stopping(execution);
    } catch {
      // The look failed, and is not handed over. What it found changed
      // before it failed is asked again by the loop, at once
      return false;
    } finally {
      execution.wakes--;
      execution.moved++;
      execution.woken.resolve();
    }
  }

  /**
   * Stops the run once something that takes its workspace whole — a deploy, a
   * removal, a copy onto it or an export of it — has announced itself, as a
   * stop request does, recording why: `a removal of main started`. A run that
   * people keep editing under does not end by itself, so every run in flight
   * asks, at each `INTENT_PROBE_MS`.
   */
  private async probeIntent(storage: StorageBackend, repo: string, execution: RunningExecution): Promise<void> {
    if (execution.probing || execution.aborted || execution.ended || execution.yielded) return;
    execution.probing = true;
    try {
      const announced = await announcedIntent(storage, repo, execution.state.workspace);
      if (announced === null) return;
      if (execution.aborted || execution.ended || execution.yielded) return;
      execution.stopReason = `${intentWords(announced, execution.state.workspace)} started`;
      execution.aborted = true;
      // Stops the running tasks too.
      execution.abortController.abort();
      await this.endCancelled(execution, execution.stopReason);
    } catch {
      // A probe that failed is made again at the next
    } finally {
      execution.probing = false;
    }
  }

  async getEvents(handle: ExecutionHandle, sinceSeq: number): Promise<ExecutionEvent[]> {
    if (!this.stateStore) {
      return [];
    }
    return this.stateStore.getEventsSince(handle.repo, handle.workspace, handle.id, sinceSeq);
  }

  /**
   * Main execution loop.
   *
   * After each task completes, and at each wake, it looks for input changes
   * and asks the tasks that read them whether they are due. Each task
   * launches at the commits its inputs came from, deferred only where they
   * read a plain input at two values. Execution continues until no task is
   * due, ready, in flight or catching up.
   */
  private async runExecutionLoop(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution
  ): Promise<void> {
    const { state, options } = execution;

    // Resolved into completionPromise from the `finally`, AFTER locks are
    // released — never inline on the success path. A bounded-lifetime host
    // (e.g. a cloud orchestrator Lambda) returns as soon as `wait()` resolves,
    // and its environment then freezes; resolving before the (awaited) lock
    // release in the finally lets the host return — and freeze — with the
    // release still in flight, leaking the workspace lock. The yield path
    // already resolves from the finally for the same reason.
    let completionResult: FinalizeResult | undefined;

    // The workspace's deployed state, which the run's record names: read
    // first, and kept for however the run ends.
    let wsState: WorkspaceState | null = null;

    // Whatever takes the workspace whole stops the run once it announces itself
    const probe = setInterval(() => { void this.probeIntent(storage, repo, execution); }, INTENT_PROBE_MS);
    (probe as unknown as { unref?: () => void }).unref?.();

    try {
      // Read workspace state for DataflowRun recording
      const wsData = await storage.refs.workspaceRead(repo, state.workspace);
      const wsRecord = wsData === null ? null : decodeBeast2For(WorkspaceRecordType)(wsData);
      wsState = wsRecord?.type === 'some' ? wsRecord.value : null;

      // Cache structure for the entire execution (immutable during execution)
      const structure = wsState ? await this.readStructure(storage, repo, wsState.packageHash) : null;
      execution.structure = structure;

      // Write initial DataflowRun record
      if (wsState) {
        const initialRun: DataflowRun = {
          runId: state.id,
          workspaceName: state.workspace,
          packageRef: `${wsState.packageName}@${wsState.packageVersion}`,
          startedAt: state.startedAt,
          completedAt: none,
          status: variant('running', {}),
          inputVersions: new Map(state.inputSnapshot),
          outputVersions: none,
          taskExecutions: new Map(),
          summary: {
            total: BigInt(state.tasks.size),
            completed: 0n,
            cached: 0n,
            failed: 0n,
            skipped: 0n,
            reexecuted: 0n,
          },
        };
        await storage.refs.dataflowRunWrite(repo, state.workspace, initialRun);
      }

      // Check for the run's abort (the caller's signal or cancel())
      const checkAborted = () => {
        if (execution.abortController.signal.aborted && !execution.aborted) {
          execution.aborted = true;
        }
        return execution.aborted;
      };

      while (true) {
        // A wake's look that failed once it had recorded a change left that
        // change's readers unasked: they are asked before the run goes on, or
        // ends. A look that fails again fails the run, which would otherwise
        // end having recorded a change none of its tasks ran on. A run
        // resumed looks first of all, for what was edited while it yielded.
        if ((execution.unasked.size > 0 || execution.lookFirst) && execution.wakes === 0 && !checkAborted()) {
          await execution.mutex.runExclusive(async () => {
            await this.handleInputChanges(storage, execution);
            await this.persistState(execution, state);
          });
          execution.lookFirst = false;
        }

        // Check if we're done: no task is due, ready, in flight or catching
        // up, and no wake is looking for changed inputs
        if (execution.runningTasks.size === 0 && execution.wakes === 0 && stepIsComplete(state)) {
          break;
        }

        // What a wake that ends during this pass settles, and how far the
        // run had moved on as the pass began: the tasks a wake made due, or a
        // result that landed made ready, while the pass is under way are not
        // among those it takes next
        const woken = deferred();
        execution.woken = woken;
        const moved = execution.moved;

        // Get ready tasks
        const readyTasks = stepGetReady(state);

        // Track whether any task was completed synchronously (via cache hit)
        // in this iteration. If so, new downstream tasks may have become ready
        // that aren't in the stale readyTasks array.
        let hadSyncCompletion = false;

        // The loop keeps `width` tasks and units in flight; the runner
        // decides which of them spawn.
        const width = options.width ?? DEFAULT_LOOP_WIDTH;

        // The units of split tasks in progress launch first, in the order the
        // tasks started, each counting against the width as a task does. A
        // stage's first unit launches alone, to measure the stage's peak, and
        // the rest once it has settled — unless the stage started with an
        // estimate (`firstWave`), when all may launch. A split task in progress finishes, as
        // a running task does, even once another task has failed; nothing
        // starts once the run is aborted.
        for (const [key, run] of execution.splits) {
          while (
            !checkAborted() &&
            execution.runningTasks.size < width &&
            !run.stopped &&
            run.next < run.split.stage.units.length &&
            (run.inFlight === 0 || !run.split.measuring)
          ) {
            this.launchUnit(storage, repo, execution, key, run);
          }
        }

        // Launch tasks up to the width if no failure and not aborted
        while (
          !execution.hasFailure &&
          !checkAborted() &&
          readyTasks.length > 0 &&
          execution.runningTasks.size < width
        ) {
          const taskName = readyTasks.shift()!;
          const taskState = state.tasks.get(taskName);

          // Skip if already terminal/running, OR if a previous execution's
          // promise is still tracked. A completion handler that resets a task
          // to `pending` (stale-input re-execution) does so while holding the
          // mutex and still owns its `runningTasks` slot until its `.finally`
          // runs. The launch path is not under that mutex, so without this
          // `has()` guard the loop could re-launch the task here — overwriting
          // the live slot — and the old promise's `.finally` would then evict
          // the new one, orphaning a task in `in_progress` (Dataflow stuck).
          // Defer the re-launch until the prior promise has fully settled. A
          // split task's units are tracked under keys of their own, so its
          // split guards it until its completion has run.
          if (
            !taskState ||
            taskState.status === 'in_progress' ||
            taskState.status === 'completed' ||
            // Left waiting since the ready list was taken
            taskState.status === 'waiting' ||
            execution.runningTasks.has(taskName) ||
            execution.splits.has(taskName)
          ) {
            continue;
          }

          // The versions the task reads: those it waits for catch-up runs
          // at, which it is prepared at again once they have settled, so it
          // never chases newer ones; or else its commits, as its inputs stand
          let versions: VersionVector;
          const catchingUp = execution.catchingUp.get(taskName);
          if (catchingUp !== undefined) {
            if ([...catchingUp.waits.values()].some((run) => this.catchUpInFlight(execution, run))) continue;
            versions = catchingUp.versions;
          } else {
            const at = await stepTaskCommits(storage, state, taskName);
            if (at.kind === 'deferred') {
              this.deferTask(execution, taskName, at);
              continue;
            }
            versions = at.versions;
          }

          // Prepare task (resolve inputs at its versions, check cache)
          const landed = execution.landed;
          const prepared = await stepPrepareTask(storage, state, taskName, versions, {
            landed: (task, inHash) => execution.caughtUp.get(catchUpKey({ task, inputsHash: inHash })),
          });

          // Its status may have moved while it was prepared: a failure
          // skipped it, or a task it reads was left waiting
          const status = state.tasks.get(taskName)?.status;
          if (status !== 'pending' && status !== 'ready') {
            this.releaseCatchUps(execution, taskName);
            continue;
          }

          // An input of it is unassigned: the task waits for it, and its
          // dependents with it, and the run goes on without them. Their
          // statuses may have ended the run: the top of the loop checks.
          if (prepared.kind === 'waiting') {
            hadSyncCompletion = true;
            this.releaseCatchUps(execution, taskName);
            await execution.mutex.runExclusive(async () => {
              const { waiting } = stepTasksWaiting(state, taskName, prepared.unassigned);
              await this.persistState(execution, state);
              for (const each of waiting) options.onTaskWaiting?.(each.task, each.inputs);
            });
            continue;
          }

          // A result it reads is not at hand at its versions: it waits for
          // the catch-up runs that make it, each taking a place in the width.
          // One there is no room for yet is launched at a later pass.
          if (prepared.kind === 'behind') {
            // A run left flight while its inputs were resolved: one it would
            // wait for may have landed since, so it is resolved again rather
            // than a run launched for what is now at hand. A split task's
            // units settling do not count, or a task beside a busy one
            // would be resolved again for as long as its units kept settling
            if (execution.landed !== landed) {
              hadSyncCompletion = true;
              continue;
            }
            const waits = catchingUp?.waits ?? new Map<string, CatchUpRun>();
            for (const run of prepared.runs) {
              const key = catchUpKey(run);
              if (!this.catchUpInFlight(execution, run)) {
                if (execution.runningTasks.size >= width) continue;
                this.launchCatchUp(storage, repo, execution, taskName, run);
              }
              waits.set(key, run);
            }
            execution.catchingUp.set(taskName, { versions, waits });
            continue;
          }
          this.releaseCatchUps(execution, taskName);
          execution.deferredFor.delete(taskName);

          // Check cache
          const cached = prepared.cached;
          if (cached !== null) {
            hadSyncCompletion = true;
            // Cache hit — wrap in mutex to serialize with concurrent .then() callbacks
            await execution.mutex.runExclusive(async () => {
              await this.landResult(storage, repo, execution, taskName, prepared, versions, {
                outputHash: cached.outputHash,
                cached: true,
                duration: 0,
                // The execution the cache serves the task from.
                executionId: cached.executionId,
              });

              // Update state store
              await this.persistState(execution, state);
            });
            continue;
          }

          // A catch-up run of the task over these very inputs is in flight: its
          // execution lands in the cache, which answers the task once it has,
          // so nothing runs twice over the same inputs. The task stays ready,
          // and the loop waits on the run
          const inHash = inputsHash(prepared.inputHashes);
          const catchingUpOver = catchUpKey({ task: taskName, inputsHash: inHash });
          if (execution.runningTasks.has(catchingUpOver) || execution.splits.has(catchingUpOver)) continue;

          // Mark as started (event added by step function), under the mutex
          // as every other change of the run's state is
          await execution.mutex.runExclusive(async () => {
            stepTaskStarted(state, taskName);
            await this.persistState(execution, state);
          });
          options.onTaskStart?.(taskName);
          execution.launches.set(taskName, inHash);

          // A task whose work is split over its inputs runs as the units of
          // its stages, which join the loop's; any other task runs as one.
          const task = await this.readSplitTask(storage, repo, prepared.taskHash);
          if (task !== null) {
            this.launchSplit(storage, repo, execution, taskName, {
              task: taskName,
              taskHash: prepared.taskHash,
              inputHashes: prepared.inputHashes,
              own: true,
              complete: (outcome) => this.completeTask(storage, repo, execution, taskName, prepared, versions, outcome),
              fail: (err) => this.failTask(execution, taskName, err),
            }, task);
          } else {
            this.launchTask(storage, repo, execution, taskName, prepared, versions);
          }
        }

        // Yield checkpoint: stop here rather than waiting on running tasks —
        // anything they finish is recovered from the execution cache on
        // resume. Skipped on failure/abort: the loop is about to finalize
        // those terminally anyway.
        if (!execution.hasFailure && !checkAborted() && options.shouldYield?.()) {
          await this.checkpointYield(execution);
          // A checkpoint the store did not take is no yield: the run was
          // ended, or moved on, elsewhere.
          if (execution.stoppedBy !== null) await this.endStopped(storage, repo, execution, wsState);
          return;
        }

        // A task the cache answered, or one left waiting, may have made
        // others ready: they are taken before the loop waits on what is in
        // flight, so a task starts in the pass that made it ready.
        // So are the tasks a wake made due, and those a result that landed
        // made ready, while the pass was under way.
        if (hadSyncCompletion || execution.moved !== moved) continue;

        // Wait for a task to complete, or for a wake, if we can't launch more
        if (execution.runningTasks.size > 0 || execution.wakes > 0) {
          await Promise.race([...execution.runningTasks.values(), woken.promise]);
        } else if (readyTasks.length === 0 || checkAborted() || execution.hasFailure) {
          break;
        }
      }
      // The loop launches no more: a wake from here on is not taken
      execution.closing = true;

      // A split task the run was aborted before its units could start — its
      // pieces just planned, or its next stage — ends cancelled, as its
      // units in flight would have; unless another process took the run up,
      // which takes the task up too.
      if (checkAborted() && execution.stoppedBy !== 'refused') {
        await this.cancelSplits(execution);
      }

      // Wait for any remaining tasks
      if (execution.runningTasks.size > 0) {
        await Promise.all(execution.runningTasks.values());
      }

      // Check for stuck state: non-terminal tasks remain but none are ready or running.
      // When a filter is active, only its run set (the target and the
      // dependency closure needed to produce it) is relevant — tasks outside it
      // are expected to remain pending.
      const runSet = stepGetRunSet(state);
      const stuckTasks = [...state.tasks.entries()]
        .filter(([name, ts]) => {
          if (ts.status !== 'pending' && ts.status !== 'ready' && ts.status !== 'deferred') {
            return false;
          }
          // Tasks outside the filter's run set staying pending is expected
          if (runSet !== null && !runSet.has(name)) {
            return false;
          }
          return true;
        })
        .map(([name, ts]) => `${name} (${ts.status})`)
        .join(', ');
      if (stuckTasks.length > 0 && !checkAborted() && !execution.hasFailure) {
        throw new DataflowError(`Dataflow stuck: ${stuckTasks}`);
      }

      // Check for abort one final time
      if (checkAborted()) {
        // A run whose writes the store stopped taking was ended, or moved
        // on, elsewhere; any other is cancelled, unless its cancel recorded
        // its end already.
        if (execution.stoppedBy !== null) await this.endStopped(storage, repo, execution, wsState);
        await this.endCancelled(execution, 'Execution was aborted');
        if (execution.stoppedBy !== null) await this.endStopped(storage, repo, execution, wsState);

        // Write cancelled DataflowRun record
        if (wsState) {
          await storage.refs.dataflowRunWrite(repo, state.workspace, this.endedRun(state, wsState, execution, variant('cancelled', {})));
        }

        // Build partial results for abort error, which says why a run that
        // stopped itself did
        const partialResults = this.buildPartialResults(state);
        throw new DataflowAbortedError(partialResults, execution.stopReason);
      }

      // Finalize (event added by step function)
      const { result } = stepFinalize(state);
      execution.ended = true;
      await execution.writer?.write(state);
      // An end the store did not take is another process's: the run was
      // ended, or moved on, there.
      if (execution.stoppedBy !== null) await this.endStopped(storage, repo, execution, wsState);

      // Write final DataflowRun record
      if (wsState) {
        let finalStatus: DataflowRun['status'];
        if (!result.success) {
          // Find the failed task for the error record
          const failedTaskEntry = [...state.tasks.entries()]
            .find(([, ts]) => ts.status === 'failed');
          const failedTaskName = failedTaskEntry?.[0] ?? 'unknown';
          const failedError = failedTaskEntry?.[1].error.type === 'some'
            ? failedTaskEntry[1].error.value
            : 'Task failed';
          finalStatus = variant('failed', {
            failedTask: failedTaskName,
            error: failedError,
          });
        } else {
          finalStatus = variant('completed', {});
        }

        await storage.refs.dataflowRunWrite(repo, state.workspace, this.endedRun(state, wsState, execution, finalStatus));

        // Update workspace state with currentRunId on success
        if (result.success) {
          const currentWsData = await storage.refs.workspaceRead(repo, state.workspace);
          const currentRecord = currentWsData === null ? null : decodeBeast2For(WorkspaceRecordType)(currentWsData);
          if (currentRecord?.type === 'some') {
            await storage.refs.workspaceWrite(repo, state.workspace, encodeBeast2For(WorkspaceRecordType)(some({
              ...currentRecord.value,
              currentRunId: some(state.id),
            })));
          }
        }
      }

      // Defer resolution to the finally (after lock release) — see the
      // completionResult declaration above.
      completionResult = result;
    } catch (err) {
      // A run that was cancelled has recorded its end already, as has one
      // another process ended or moved on, and ends here by rejecting: its
      // abort is what wait() answers.
      if (err instanceof DataflowAbortedError || err instanceof DataflowSupersededError) throw err;

      // An unexpected error escaped the execution loop (e.g. a store refused
      // a read the loop made). The success-path finalization above is skipped,
      // so without this the run's persisted status stays 'running' forever —
      // any client polling it (e.g. a remote `dataflow run` over the API) then
      // hangs until timeout instead of seeing the failure. Persist a terminal
      // 'failed' status so pollers observe the error promptly.
      //
      // What the loop launched is stopped and settled first, as a cancel
      // stops it, while the run still holds its locks: a completion landing
      // after the terminal record would write the run's state back to
      // 'running', and its task's output ref with the locks let go.
      await this.stopLaunched(execution);
      execution.ended = true;
      const failMsg = err instanceof Error ? err.message : String(err);
      await execution.writer
        ?.writeStatus(repo, state.workspace, state.id, 'failed', { error: failMsg })
        .catch(() => { /* best effort — don't mask the original error */ });
      // And so does its record, which would otherwise read 'running' for good
      // — unless the store stopped taking the run's writes, another process
      // having ended it, or moved it on.
      if (wsState !== null && execution.stoppedBy === null) {
        const failedTask = [...state.tasks.entries()].find(([, ts]) => ts.status === 'failed')?.[0] ?? 'unknown';
        await storage.refs
          .dataflowRunWrite(repo, state.workspace, this.endedRun(state, wsState, execution, variant('failed', { failedTask, error: failMsg })))
          .catch(() => { /* best effort — don't mask the original error */ });
      }
      throw err;
    } finally {
      execution.closing = true;
      clearInterval(probe);
      // Remove abort listener to avoid leaking execution object
      execution.abortCleanup?.();

      // The shared workspace lock goes first, if we acquired it (not
      // external), and the dataflow lock, which we always acquire, last: the
      // dataflow lock is then held for as long as the run holds the workspace
      // at all, which is how a server tells a request the run still refuses
      // to ask again (#1286).
      try {
        if (!execution.externalLock && execution.sharedLock) {
          await execution.sharedLock.release();
        }
      } finally {
        await execution.lock.release();
      }

      // Clean up execution state
      const key = this.executionKey(repo, state.workspace, state.id);
      this.executions.delete(key);

      // Resolve completion (terminal or yield) only after locks are released,
      // so a caller doing `await wait()` then an exclusive op (resume, or a
      // workspace export/deploy) can't race the lock release. The error path
      // rejects via the rethrow below, which also propagates after this finally.
      if (execution.yieldResult) {
        execution.resolveCompletion(execution.yieldResult);
      } else if (completionResult) {
        execution.resolveCompletion(completionResult);
      }
    }
  }

  /**
   * Ends every split task in progress cancelled, as its units in flight
   * would have: one the run stopped before its units could start — its pieces
   * just planned, or its next stage.
   */
  private async cancelSplits(execution: RunningExecution): Promise<void> {
    for (const [key, run] of [...execution.splits]) {
      const cancelled = await run.split.cancel();
      await run.target.complete(outcomeOf(cancelled, run.startTime));
      execution.splits.delete(key);
    }
  }

  /**
   * Stops what the loop launched, as a cancel does, and waits for it to
   * settle: the run's abort reaches every task and unit in flight, each one's
   * completion lands, and a split task left between stages ends cancelled.
   * Nothing the loop launched still runs, or completes, once this returns.
   *
   * @remarks
   * For a loop that threw: its own error is the run's, so what fails here
   * fails quietly. Each in-flight task and unit already turns its own failure
   * into the task's.
   */
  private async stopLaunched(execution: RunningExecution): Promise<void> {
    execution.abortController.abort();
    await Promise.allSettled(execution.runningTasks.values());
    await this.cancelSplits(execution).catch(() => { /* the loop's error is the run's */ });
  }

  /**
   * Records the run's end as cancelled, once: its tasks in progress back to
   * pending — the run's abort stops them — and the run cancelled, written whole
   * as the run's last word, since nothing written after it is taken. Under the
   * mutex, so no completion is half applied in what is written.
   *
   * @remarks
   * The run has ended once the write has landed. A write that fails leaves it
   * to the next call — the loop's own, once what it launched has settled —
   * which writes the run as it was cancelled, for the reason given first: a
   * run whose end was never written would read running for good to whatever
   * polls it.
   */
  private async endCancelled(execution: RunningExecution, reason: string): Promise<void> {
    await execution.mutex.runExclusive(async () => {
      if (execution.ended) return;
      if (execution.state.status !== 'cancelled') {
        stepYield(execution.state);
        stepCancel(execution.state, reason);
      }
      await execution.writer?.write(execution.state);
      execution.ended = true;
    });
  }

  /**
   * Stops a run whose writes the store no longer takes — another process ended
   * it, or moved it on: nothing more of its state is written, and nothing more
   * is launched. The run's abort reaches what runs: as a cancel stops it, for a
   * run another process ended; and, for one another process took up, with a
   * {@link DataflowSupersededError} as its reason, so a runner whose executions
   * that process attaches to may leave them running. The loop then ends it
   * ({@link endStopped}).
   */
  private stopped(execution: RunningExecution, outcome: 'dropped' | 'refused'): void {
    execution.stoppedBy ??= outcome;
    execution.ended = true;
    execution.aborted = true;
    if (outcome === 'refused') execution.abortController.abort(new DataflowSupersededError(execution.state.id));
    else execution.abortController.abort();
  }

  /**
   * Ends a run whose writes the store no longer takes, once what the loop
   * launched has settled, failing no task for it.
   *
   * @remarks
   * A run another process cancelled has what the loop launched stopped as a
   * cancel stops it, and its record ended as its state was, while the record
   * still reads running. A run another process moved on is that process's,
   * and so is what this loop launched: a split task is left mid-stage, its plan
   * rooted, for that process to take up, no completion is applied, and nothing
   * more is written, its record included.
   *
   * @throws {DataflowSupersededError} When another process moved the run on
   * @throws {DataflowAbortedError} When another process ended it
   */
  private async endStopped(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    wsState: WorkspaceState | null
  ): Promise<never> {
    const { state } = execution;
    if (execution.stoppedBy === 'refused') {
      await Promise.allSettled(execution.runningTasks.values());
      for (const [taskName, run] of [...execution.splits]) {
        await this.leaveSplit(run, 'superseded').catch(() => { /* the task is the other process's to end */ });
        execution.splits.delete(taskName);
      }
      throw new DataflowSupersededError(state.id);
    }
    await this.stopLaunched(execution);
    if (wsState !== null) {
      await this.recordCancelledElsewhere(storage, repo, execution, wsState).catch(() => { /* its end is its state's */ });
    }
    throw new DataflowAbortedError(this.buildPartialResults(state));
  }

  /**
   * Ends the record of a run another process cancelled, as its state says,
   * unless the record has ended already: a run another process completed or
   * failed has its record from that process.
   */
  private async recordCancelledElsewhere(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    wsState: WorkspaceState
  ): Promise<void> {
    const { state } = execution;
    const stored = await this.stateStore?.read(repo, state.workspace, state.id);
    if (stored?.status !== 'cancelled') return;
    const record = await storage.refs.dataflowRunGet(repo, state.workspace, state.id);
    if (record !== null && record.status.type !== 'running') return;
    await storage.refs.dataflowRunWrite(repo, state.workspace, this.endedRun(state, wsState, execution, variant('cancelled', {})));
  }

  /**
   * Take a yield checkpoint: reset in-flight tasks to pending, persist the
   * still-'running' state, and stage the yielded FinalizeResult (resolved
   * from the loop's finally, after locks are released).
   *
   * Runs under the mutex so completion handlers already queued ahead of it
   * land their results first (and ARE included in the checkpoint); handlers
   * settling after it only mutate memory — persistState is suppressed by
   * the yielded flag, keeping the checkpoint as the last persisted word.
   */
  private async checkpointYield(execution: RunningExecution): Promise<void> {
    const { state } = execution;
    execution.yielded = true;
    await execution.mutex.runExclusive(async () => {
      // A split task in progress is left mid-stage: its state keeps naming
      // the stage's plan, which a resumed run takes up again. A catch-up run
      // is no task's, and is ended for good.
      for (const run of execution.splits.values()) {
        await this.leaveSplit(run, 'yielded');
      }
      stepYield(state);
      await execution.writer?.write(state);
    });
    // A checkpoint the store did not take yields nothing: the loop ends the
    // run as another process left it.
    if (execution.stoppedBy !== null) return;
    execution.yieldResult = {
      success: false,
      runId: state.id,
      executed: Number(state.executed),
      cached: Number(state.cached),
      failed: Number(state.failed),
      skipped: Number(state.skipped),
      waiting: waitingTasks(state).length,
      reexecuted: Number(state.reexecuted),
      duration: Date.now() - state.startedAt.getTime(),
      yielded: true,
    };
  }

  /**
   * Looks for input changes, and asks the tasks that read a changed input
   * directly whether they are due.
   *
   * Called after each result lands, and at each wake, under the run's mutex.
   *
   * A change is recorded in the run's state as it is found, before its
   * readers are asked, and asking them reads the store. So each change is
   * held as unasked until its readers have been: a look that fails part way
   * leaves it for the next look, which would otherwise find nothing changed
   * and never ask them.
   */
  private async handleInputChanges(storage: StorageBackend, execution: RunningExecution): Promise<void> {
    const { state, options } = execution;
    const { changes, events: changeEvents } = await stepDetectInputChanges(storage, state, execution.structure);
    for (const change of changes) execution.unasked.add(change.path);

    // Notify via callbacks
    for (const evt of changeEvents) {
      if (evt.type === 'input_changed') {
        options.onInputChanged?.(evt.value.path, evt.value.previousHash, evt.value.newHash);
      }
    }

    if (execution.unasked.size === 0) return;
    const asked = [...execution.unasked];
    await this.tasksDue(storage, state, options, asked.map((path) => ({ path })));
    for (const path of asked) execution.unasked.delete(path);
  }

  /** Asks the tasks that read a changed dataset directly whether they are
   *  due, and tells the run's caller of each that is. */
  private async tasksDue(
    storage: StorageBackend,
    state: DataflowExecutionState,
    options: OrchestratorStartOptions,
    changed: ReadonlyArray<{ path: string }>
  ): Promise<void> {
    const { events } = await stepTasksDue(storage, state, changed);
    for (const evt of events) {
      if (evt.type === 'task_invalidated') {
        options.onTaskInvalidated?.(evt.value.task, evt.value.reason);
      }
    }
  }

  /**
   * Defers a task whose inputs read a plain input at two values, telling its
   * caller why once: a task deferred again for the same reason, with no launch
   * between, is not told again and records no second event.
   */
  private deferTask(execution: RunningExecution, taskName: string, at: Extract<TaskCommits, { kind: 'deferred' }>): void {
    const { state, options } = execution;
    const ts = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
    if (ts) ts.status = 'deferred';

    const path = deferralPath(at.reason);
    const told = `${at.reason.kind}:${path}`;
    if (execution.deferredFor.get(taskName) === told) return;
    execution.deferredFor.set(taskName, told);

    // Emit task_deferred event, whose conflict path is the input the reason
    // names
    const mutableState = state as Mutable<DataflowExecutionState>;
    mutableState.eventSeq = state.eventSeq + 1n;
    const deferEvent: ExecutionEvent = variant('task_deferred', {
      seq: mutableState.eventSeq,
      timestamp: new Date(),
      task: taskName,
      conflictPath: path,
    });
    (mutableState.events as ExecutionEvent[]).push(deferEvent);

    options.onTaskDeferred?.(taskName, at.reason);
  }

  /**
   * Lands a task's result, under the mutex: its output written to the
   * workspace with the versions the task was launched with, the task
   * completed, and then asked whether it is due again, its inputs having
   * moved while it ran, and its readers whether they are.
   */
  private async landResult(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    taskName: string,
    prepared: PrepareTaskResult,
    versions: VersionVector,
    result: { outputHash: string; cached: boolean; duration: number; executionId: string; peakBytes?: number }
  ): Promise<void> {
    const { state, options } = execution;
    if (result.outputHash) {
      // Write output ref with the versions the result was made from
      await stepApplyTreeUpdate(storage, repo, state.workspace, prepared.outputPath, result.outputHash, versions);
    }

    const completed = { inputsHash: inputsHash(prepared.inputHashes), executionId: result.executionId };
    stepTaskCompleted(state, taskName, result.outputHash, result.cached, result.duration, completed, versions, result.peakBytes);

    // Track task execution for DataflowRun
    const existing = execution.taskExecutions.get(taskName);
    execution.taskExecutions.set(taskName, {
      ...completed,
      taskHash: prepared.taskHash,
      cached: result.cached,
      outputVersions: new Map(versions),
      executionCount: (existing?.executionCount ?? 0n) + 1n,
    });

    options.onTaskComplete?.({
      name: taskName,
      cached: result.cached,
      state: 'success',
      duration: result.duration,
    });

    // A task that waits to read this one over exactly these inputs reads the
    // result that landed
    const key = catchUpKey({ task: taskName, inputsHash: completed.inputsHash });
    if ([...execution.catchingUp.values()].some((waiting) => waiting.waits.has(key))) {
      execution.caughtUp.set(key, result.outputHash);
    }

    // Every result lands. Its task is asked whether it is due again, and its
    // readers whether they are: a change travels a step at a time. The asks
    // read the store. One that fails leaves the result landed, and what it was
    // to ask unasked — the task's inputs, whose readers it is among, and its
    // output — for the loop to ask before it goes on: a second failure fails
    // the run, as a wake's failed look does.
    try {
      const again = await stepTaskDueAgain(storage, state, taskName);
      if (again?.type === 'task_invalidated') options.onTaskInvalidated?.(taskName, again.value.reason);
      await this.tasksDue(storage, state, options, [{ path: prepared.outputPath }]);

      // Detect input changes after the result
      await this.handleInputChanges(storage, execution);
    } catch {
      const graph = state.graph.type === 'some' ? state.graph.value : null;
      for (const input of graph?.tasks.find((each) => each.name === taskName)?.inputs ?? []) execution.unasked.add(input);
      execution.unasked.add(prepared.outputPath);
    }
  }

  /** Whether a catch-up run is in flight: as itself, or as its task's own
   *  run over exactly its inputs, which is then waited for. */
  private catchUpInFlight(execution: RunningExecution, run: CatchUpRun): boolean {
    const key = catchUpKey(run);
    if (execution.runningTasks.has(key) || execution.splits.has(key)) return true;
    const launched = execution.launches.get(run.task);
    return launched !== undefined && sameInputs(launched, run.inputsHash) &&
      (execution.runningTasks.has(run.task) || execution.splits.has(run.task));
  }

  /** Lets go of what a task that waited for catch-up runs held: the versions
   *  it was prepared at, and each run's output no other task waits to read. */
  private releaseCatchUps(execution: RunningExecution, taskName: string): void {
    const held = execution.catchingUp.get(taskName);
    if (held === undefined) return;
    execution.catchingUp.delete(taskName);
    for (const key of held.waits.keys()) {
      if (![...execution.catchingUp.values()].some((other) => other.waits.has(key))) execution.caughtUp.delete(key);
    }
  }

  /**
   * Launches a catch-up run: a task run once over the inputs it had at
   * earlier versions, for a task that reads its result there. It is tracked
   * under a key of its own, and its completion applies to no task and writes
   * no ref: the execution cache records it, and nothing else.
   */
  private launchCatchUp(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    forTask: string,
    run: CatchUpRun
  ): void {
    const key = catchUpKey(run);
    const startTime = Date.now();
    execution.options.onCatchUp?.(run.task, forTask, { state: 'started' });
    // The run has landed, or failed, once its completion is applied: counted
    // then, before it leaves flight, as one run or as a split task's units,
    // so a task resolved meanwhile is resolved again rather than launch it anew
    const complete = async (outcome: TaskOutcome): Promise<void> => {
      try {
        await this.completeCatchUp(execution, run, forTask, outcome);
      } finally {
        execution.landed++;
      }
    };
    const fail = (err: unknown): Promise<void> => complete({
      state: 'error', cached: false, executionId: '', error: err instanceof Error ? err.message : String(err), duration: Date.now() - startTime,
    });
    const launched = (async () => {
      const task = await this.readSplitTask(storage, repo, run.taskHash);
      if (task !== null) {
        this.launchSplit(storage, repo, execution, key, {
          task: run.task, taskHash: run.taskHash, inputHashes: run.inputHashes, own: false, complete, fail,
        }, task);
        return;
      }
      await complete(await this.executeTask(storage, repo, execution, run.task, run, key));
    })()
      .catch(fail)
      .finally(() => {
        execution.moved++;
        if (execution.runningTasks.get(key) === launched) {
          execution.runningTasks.delete(key);
          execution.waiting.delete(key);
        }
      });
    execution.runningTasks.set(key, launched);
  }

  /**
   * Completes a catch-up run: its output is kept for the tasks that wait to
   * read it, which are prepared again; or, when it failed, each of them
   * fails, naming the run's task and the versions it ran at. A task another
   * path settled meanwhile — skipped for a failure upstream, left waiting, or
   * failed — keeps what it was, and lets go of the runs it waited for.
   */
  private async completeCatchUp(execution: RunningExecution, run: CatchUpRun, forTask: string, outcome: TaskOutcome): Promise<void> {
    const { state, options } = execution;
    // A run another process took up decides its tasks again there
    if (execution.stoppedBy === 'refused') return;
    const key = catchUpKey(run);
    if (outcome.state === 'success' && outcome.outputHash) {
      // Kept for the tasks that wait to read it, which let it go as they are
      // prepared again: none waits once each was settled otherwise
      if ([...execution.catchingUp.values()].some((waiting) => waiting.waits.has(key))) {
        execution.caughtUp.set(key, outcome.outputHash);
      }
      options.onCatchUp?.(run.task, forTask, { state: 'completed', duration: outcome.duration });
      return;
    }
    // e3 stopped it because the run was aborted: no task's failure
    if (outcome.cancelled) return;

    const at = [...run.versions].map(([root, version]) => `${root} ${version.slice(0, 8)}`).join(', ');
    const error = `the catch-up run of '${run.task}' at ${at} failed: ${outcome.error ?? `exit code ${outcome.exitCode ?? 'unknown'}`}`;
    await execution.mutex.runExclusive(async () => {
      for (const [taskName, waiting] of [...execution.catchingUp]) {
        if (!waiting.waits.has(key)) continue;
        this.releaseCatchUps(execution, taskName);
        // Only a task still waiting to launch waits for this run: one settled
        // otherwise is counted, and told of, as it was settled
        const status = state.tasks.get(taskName)?.status;
        if (status !== 'pending' && status !== 'ready') continue;
        execution.hasFailure = true;
        const { result: failed } = stepTaskFailed(state, taskName, error, outcome.exitCode, 0);
        options.onTaskComplete?.({ name: taskName, cached: false, state: 'error', error, exitCode: outcome.exitCode, duration: 0 });
        for (const skipEvent of stepTasksSkipped(state, failed.toSkip, taskName)) {
          if (skipEvent.type === 'task_skipped') {
            options.onTaskComplete?.({ name: skipEvent.value.task, cached: false, state: 'skipped', duration: 0 });
          }
        }
      }
      await this.persistState(execution, state);
    });
  }

  /**
   * Completes a task the loop launched: its completion is applied to the
   * run's state ({@link applyCompletion}), and its run then leaves flight.
   */
  private async completeTask(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    taskName: string,
    prepared: PrepareTaskResult,
    versions: VersionVector,
    result: TaskOutcome
  ): Promise<void> {
    try {
      await this.applyCompletion(storage, repo, execution, taskName, prepared, versions, result);
    } finally {
      // The run stays in flight, for a task that waits to read its result,
      // until that result has landed, and the count moves in the same tick:
      // a task whose inputs were resolved while it landed either finds the
      // run in flight and waits for it, or is resolved again and finds its
      // result at hand. It never launches a catch-up run for what just landed.
      execution.launches.delete(taskName);
      execution.landed++;
    }
  }

  /**
   * Applies a task's completion to the run's state, under the mutex: its
   * result landed ({@link landResult}), whatever its inputs have moved to
   * since; or back to pending, when the run was aborted; or failed, its
   * dependents skipped.
   */
  private async applyCompletion(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    taskName: string,
    prepared: PrepareTaskResult,
    versions: VersionVector,
    result: TaskOutcome
  ): Promise<void> {
    const { state, options } = execution;
    await execution.mutex.runExclusive(async () => {
      // A run another process took up completes its tasks there, from the
      // executions this loop's runners recorded: this loop applies none.
      if (execution.stoppedBy === 'refused') return;

      // Handle task completion
      if (result.state === 'success') {
        await this.landResult(storage, repo, execution, taskName, prepared, versions, {
          outputHash: result.outputHash ?? '',
          cached: result.cached,
          duration: result.duration,
          executionId: result.executionId,
          ...(result.peakBytes !== undefined && { peakBytes: result.peakBytes }),
        });
      } else if (result.cancelled) {
        // e3 stopped the task because the run was aborted — not the
        // task's failure. It goes back to pending, keeping the result it
        // held, and the run ends through the abort path as cancelled.
        const ts = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
        if (ts) {
          ts.status = 'pending';
          ts.plan = none;
        }

        options.onTaskComplete?.({
          name: taskName,
          cached: false,
          state: 'cancelled',
          duration: result.duration,
        });
      } else {
        execution.hasFailure = true;

        const { result: failedResult } = stepTaskFailed(
          state,
          taskName,
          result.error,
          result.exitCode,
          result.duration
        );

        options.onTaskComplete?.({
          name: taskName,
          cached: false,
          state: result.state === 'failed' ? 'failed' : 'error',
          error: result.error,
          exitCode: result.exitCode,
          duration: result.duration,
        });

        // Skip dependents (events added by step function)
        const skipEvents = stepTasksSkipped(state, failedResult.toSkip, taskName);
        for (const skipEvent of skipEvents) {
          if (skipEvent.type === 'task_skipped') {
            options.onTaskComplete?.({
              name: skipEvent.value.task,
              cached: false,
              state: 'skipped',
              duration: 0,
            });
          }
        }
      }

      // Update state store
      await this.persistState(execution, state);
    });
  }

  /**
   * Fails a task whose completion threw — writing its output ref, re-reading
   * inputs, persisting state, or advancing its stages. Left alone, it would
   * stay in whatever status it had when the throw happened — `in_progress` if
   * it failed before stepTaskCompleted — while the loop no longer tracks it,
   * and the dataflow would report a spurious "Dataflow stuck". The rejection
   * is otherwise swallowed (a settled Promise.race keeps a handler on it), so
   * it never surfaces. Mark the task failed with the real error instead.
   */
  private async failTask(execution: RunningExecution, taskName: string, err: unknown): Promise<void> {
    const { state, options } = execution;
    const msg = err instanceof Error ? err.message : String(err);
    execution.launches.delete(taskName);
    execution.landed++;
    await execution.mutex.runExclusive(async () => {
      execution.hasFailure = true;
      try {
        stepTaskFailed(state, taskName, msg, undefined, 0);
        await this.persistState(execution, state);
      } catch {
        // best-effort — the original error above is what matters
      }
    });
    options.onTaskComplete?.({
      name: taskName,
      cached: false,
      state: 'error',
      error: msg,
      duration: 0,
    });
  }

  /** Launches a task that runs as one execution, tracked under its name. */
  private launchTask(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    taskName: string,
    prepared: PrepareTaskResult,
    versions: VersionVector
  ): void {
    const taskPromise = this.executeTask(storage, repo, execution, taskName, prepared)
      .then((result) => this.completeTask(storage, repo, execution, taskName, prepared, versions, result))
      .catch((err) => this.failTask(execution, taskName, err))
      .finally(() => {
        execution.moved++;
        // Identity-checked delete: only clear the slot if it still holds
        // THIS promise. If a re-launch replaced it, a blind delete-by-name
        // would drop the newer promise's tracking and orphan the task.
        if (execution.runningTasks.get(taskName) === taskPromise) {
          execution.runningTasks.delete(taskName);
          execution.waiting.delete(taskName);
        }
      });
    execution.runningTasks.set(taskName, taskPromise);
  }

  /**
   * Launches a run of a task whose work is split over its inputs — the task's
   * own, or a catch-up run of it: plans its pieces, or takes up the stage the
   * task's state names, and hands the stage's units to the loop. The planning
   * is tracked under the run's key, so the loop launches other work meanwhile.
   */
  private launchSplit(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    key: string,
    target: SplitTarget,
    task: TaskObject
  ): void {
    const { state, options } = execution;
    const startTime = Date.now();
    const planned = (async () => {
      // A catch-up run plans its own pieces: the state's plan is the task's own
      const taskState = target.own ? state.tasks.get(target.task) : undefined;
      const split = await SplitTask.open(
        storage,
        repo,
        target.taskHash,
        task,
        target.inputHashes,
        { inHash: inputsHash(target.inputHashes), executionId: uuidv7(), startTime },
        {
          signal: execution.abortController.signal,
          onPartitionProgress: target.own && options.onPartitionProgress
            ? (progress) => options.onPartitionProgress!(target.task, progress)
            : undefined,
          firstWave: options.firstWave,
        },
        taskState?.plan.type === 'some' ? taskState.plan.value : null,
        options.owner === undefined ? await this.hostOwner() : options.owner
      );
      if (!(split instanceof SplitTask)) {
        await target.complete(outcomeOf(split, startTime));
        return;
      }
      if (execution.yielded || execution.stoppedBy === 'refused') {
        // The run yielded while the task was planned, or another process took
        // it up: a run that takes the run up takes the task up too.
        await this.leaveSplit({ split, target }, execution.yielded ? 'yielded' : 'superseded');
        return;
      }
      execution.splits.set(key, { split, target, startTime, next: 0, inFlight: 0, stopped: false, results: [], thrown: [] });
      const { plan, units } = split.stage;
      if (target.own && plan !== null && !split.resumed) {
        await execution.mutex.runExclusive(async () => {
          stepTaskSplit(state, target.task, plan, units.length);
          await this.persistState(execution, state);
        });
      }
    })()
      .catch(async (err) => {
        execution.splits.delete(key);
        await target.fail(err);
      })
      .finally(() => {
        execution.moved++;
        if (execution.runningTasks.get(key) === planned) {
          execution.runningTasks.delete(key);
        }
      });
    execution.runningTasks.set(key, planned);
  }

  /**
   * Leaves a split task's run where the loop stops mid-stage — the run yields,
   * or another process took it up. The task's own is left mid-stage, its plan
   * rooted, for the run that takes the run up to take the stage up again. A
   * catch-up run lives in this loop's memory alone, so no run takes it up: it
   * is ended for good, its plan let go, and a run that still reads its result
   * there makes it again, its finished units answered from the cache.
   */
  private async leaveSplit(run: Pick<SplitRun, 'split' | 'target'>, by: 'yielded' | 'superseded'): Promise<void> {
    if (run.target.own) {
      await run.split.suspend(by);
      return;
    }
    await run.split.abandon(by === 'yielded'
      ? 'cancelled: the run yielded, and no run takes a catch-up run up again: the resumed run makes it again where a task still reads it'
      : 'cancelled: another process took the run up, and no run takes a catch-up run up again: that process makes it again where a task still reads it');
  }

  /**
   * Launches the next unit of a split task's stage, expecting to need the
   * largest peak a unit of the stage has reached. The unit that ends the
   * stage — the last in flight, once no more will start — advances the task.
   */
  private launchUnit(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    key: string,
    run: SplitRun
  ): void {
    const index = run.next++;
    const { merge, units } = run.split.stage;
    const unit = units[index]!;
    // The unit's place in the task, which its wait and its requeue name.
    const place: StageUnit = {
      merge: merge === null ? none : some({ level: BigInt(merge.level), levels: BigInt(merge.levels) }),
      index: BigInt(index),
      units: BigInt(units.length),
    };
    const expectedPeakBytes = run.split.stagePeak;
    const guessed = run.split.stagePeakGuessed;
    const unitKey = `${key}\u0000${execution.unitSeq++}`;
    run.inFlight++;
    run.split.unitStarted(index);
    const launched = (async () => {
      try {
        const result = await this.executeUnit(storage, repo, execution, run.target, unit, expectedPeakBytes, guessed, unitKey, place);
        run.results[index] = result;
        run.split.unitSettled(index, result);
        // A unit e3 stopped because the run was aborted is not a failure.
        if ((result.state !== 'success' || result.outputHash === null) && !result.cancelled) run.stopped = true;
      } catch (error) {
        run.thrown.push({ index, error });
        run.stopped = true;
      }
      run.inFlight--;
      const more = !run.stopped && !execution.abortController.signal.aborted && run.next < run.split.stage.units.length;
      // After a yield the task was left mid-stage, for a resumed run; and so
      // it is for a run another process took up.
      if (run.inFlight > 0 || more || execution.yielded || execution.stoppedBy === 'refused') return;
      await this.advanceSplit(execution, key, run);
    })()
      .catch(async (err) => {
        execution.splits.delete(key);
        await run.target.fail(err);
      })
      .finally(() => {
        execution.moved++;
        execution.waiting.delete(unitKey);
        if (execution.runningTasks.get(unitKey) === launched) {
          execution.runningTasks.delete(unitKey);
        }
      });
    execution.runningTasks.set(unitKey, launched);
  }

  /**
   * Advances a split task whose stage has ended: the next stage's units join
   * the loop's, or the run completes — the task's own as any task does, a
   * catch-up run as one does.
   */
  private async advanceSplit(execution: RunningExecution, key: string, run: SplitRun): Promise<void> {
    const { state } = execution;
    const { target } = run;
    const ended = run.split.stage.merge;
    const result = await run.split.advance(run.results, run.thrown);
    if (result === null) {
      const { plan, units, merge } = run.split.stage;
      run.next = 0;
      run.inFlight = 0;
      run.stopped = false;
      run.results = [];
      run.thrown = [];
      if (target.own) {
        await execution.mutex.runExclusive(async () => {
          if (ended !== null) stepTaskMergeCompleted(state, target.task, ended.level, ended.levels);
          stepTaskMergeStarted(state, target.task, plan!, merge!.level, merge!.levels, units.length);
          await this.persistState(execution, state);
        });
      }
      return;
    }
    if (target.own && ended !== null && result.state === 'success') {
      await execution.mutex.runExclusive(() => {
        stepTaskMergeCompleted(state, target.task, ended.level, ended.levels);
      });
    }
    await target.complete(outcomeOf(result, run.startTime));
    execution.splits.delete(key);
  }

  /**
   * The task object of a task whose work is split over its inputs; `null` for
   * any other task, and for one whose object does not read, which its runner
   * then reports.
   */
  private async readSplitTask(storage: StorageBackend, repo: string, taskHash: string): Promise<TaskObject | null> {
    try {
      const task = decodeTaskObject(await storage.objects.read(repo, taskHash));
      return isSplitTask(task) ? task : null;
    } catch {
      return null;
    }
  }

  /**
   * Refuses a run that names no runner when the host gives none: nothing
   * would run its tasks. Checked before the run takes a lock.
   *
   * @throws {DataflowError} When neither the run nor the host names a runner.
   */
  private checkRunner(options: OrchestratorStartOptions): void {
    if (options.runner === undefined && this.host.runner === undefined) {
      throw new DataflowError(
        'this LocalOrchestrator has no runner of its own: a run names the runner its tasks run on (options.runner), ' +
        'or the orchestrator is the root entry\'s, which runs them on this machine'
      );
    }
  }

  /** The host's runner, which runs a task or a unit when the run names no
   *  runner: every run that names none has one ({@link checkRunner}). */
  private hostRunner(): NonNullable<LocalOrchestratorHost['runner']> {
    const runner = this.host.runner;
    if (runner === undefined) throw new DataflowError('this LocalOrchestrator has no runner of its own, and the run named none');
    return runner;
  }

  /** The owner a split task's own execution is recorded under when the run
   *  names none: the host's, or none. */
  private hostOwner(): Promise<ExecutionOwner | null> {
    return this.host.owner === undefined ? Promise.resolve(null) : this.host.owner();
  }

  /**
   * Execute one unit of a split task, through the run's runner or the host's:
   * its wait for room is kept, under the key it is tracked by, while it lasts,
   * and a requeue of a unit of the task's own run is recorded as an event of
   * the run, naming its place.
   */
  private async executeUnit(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    target: SplitTarget,
    unit: SplitUnit,
    expectedPeakBytes: number | undefined,
    guessed: boolean,
    key: string,
    place: StageUnit
  ): Promise<ExecutionResult> {
    const { options } = execution;
    const { task: taskName, taskHash } = target;
    const execOptions: TaskExecuteOptions = {
      taskName,
      // Scoped as the task's own cache bypass is: under a filter, only the
      // target's units re-run.
      force: stepTaskForced(execution.state, taskName),
      verbose: options.verbose,
      signal: execution.abortController.signal,
      onStdout: options.onStdout ? (data) => options.onStdout!(taskName, data) : undefined,
      onStderr: options.onStderr ? (data) => options.onStderr!(taskName, data) : undefined,
      expectedPeakBytes,
      expectedPeakGuessed: guessed,
      onWaiting: (needs) => {
        if (needs === null) execution.waiting.delete(key);
        else execution.waiting.set(key, { task: taskName, unit: some(place), needs: BigInt(needs), since: new Date() });
      },
      // A catch-up run's requeue is no event of the run's
      onRequeued: !target.own ? undefined : (requeue) => {
        options.onUnitRequeued?.(taskName, place, requeue);
        void execution.mutex.runExclusive(async () => {
          stepUnitRequeued(execution.state, taskName, place, requeue);
          await this.persistState(execution, execution.state);
        }).catch(() => {
          // The event is in the state already, which the run's next write
          // persists.
        });
      },
    };
    if (!options.runner) {
      return this.hostRunner().executeUnit(storage, repo, taskHash, unit, execOptions);
    }
    const startTime = Date.now();
    const result = await options.runner.executeUnit(storage, taskHash, unit, execOptions);
    return {
      inputsHash: inputsHash(unit.inputs),
      executionId: result.executionId,
      cached: result.cached,
      state: result.state,
      outputHash: result.outputHash ?? null,
      exitCode: result.exitCode ?? null,
      duration: Date.now() - startTime,
      error: result.error ?? null,
      cancelled: result.cancelled ?? false,
      ...(result.peakBytes !== undefined && { peakBytes: result.peakBytes }),
    };
  }

  /**
   * Execute a single task: its own run, or a catch-up run of it, whose wait
   * for room is kept under the key the run is tracked by.
   */
  private async executeTask(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    taskName: string,
    prepared: { taskHash: string; inputHashes: string[] },
    key: string = taskName
  ): Promise<TaskOutcome> {
    const { options } = execution;
    const startTime = Date.now();

    const execOptions: TaskExecuteOptions = {
      taskName,
      // Scoped like the cache bypass in stepPrepareTask: a filtered run forces
      // only the target, so a launched dependency still honours its own cache.
      force: stepTaskForced(execution.state, taskName),
      verbose: options.verbose,
      signal: execution.abortController.signal,
      onStdout: options.onStdout ? (data) => options.onStdout!(taskName, data) : undefined,
      onStderr: options.onStderr ? (data) => options.onStderr!(taskName, data) : undefined,
      // Unit progress goes to the caller's callback only. The state records
      // a split task's stages, not each unit: a per-unit state rewrite would
      // make persistence O(units²) under the orchestrator mutex. A catch-up
      // run's is no progress of the task's.
      onPartitionProgress: key === taskName && options.onPartitionProgress
        ? (progress) => options.onPartitionProgress!(taskName, progress)
        : undefined,
      // A wait for room is kept, under the run's key, while it lasts.
      onWaiting: (needs) => {
        if (needs === null) execution.waiting.delete(key);
        else execution.waiting.set(key, { task: taskName, unit: none, needs: BigInt(needs), since: new Date() });
      },
    };

    // Use provided runner if available, otherwise the host's
    if (options.runner) {
      const result = await options.runner.execute(storage, prepared.taskHash, prepared.inputHashes, execOptions);
      return {
        state: result.state,
        cached: result.cached,
        outputHash: result.outputHash,
        executionId: result.executionId,
        exitCode: result.exitCode,
        error: result.error,
        cancelled: result.cancelled,
        duration: Date.now() - startTime,
        ...(result.peakBytes !== undefined && { peakBytes: result.peakBytes }),
      };
    } else {
      const result = await this.hostRunner().execute(storage, repo, prepared.taskHash, prepared.inputHashes, execOptions);
      return {
        state: result.state,
        cached: result.cached,
        outputHash: result.outputHash ?? undefined,
        executionId: result.executionId,
        exitCode: result.exitCode ?? undefined,
        error: result.error ?? undefined,
        cancelled: result.cancelled,
        duration: Date.now() - startTime,
        ...(result.peakBytes !== undefined && { peakBytes: result.peakBytes }),
      };
    }
  }

  /**
   * Build partial results for abort error: a task with a result in the run
   * counts as completed, whatever its status — one due again keeps its result
   * while it runs again, and goes back to pending when the run stops.
   */
  private buildPartialResults(state: DataflowExecutionState): TaskExecutionResult[] {
    const results: TaskExecutionResult[] = [];

    for (const [name, taskState] of state.tasks) {
      const landed = taskState.outputHash.type === 'some' && taskState.status !== 'failed' && taskState.status !== 'skipped';
      if (landed || taskState.status === 'failed' || taskState.status === 'skipped') {
        // Extract values from Option types
        const cached = taskState.cached.type === 'some' ? taskState.cached.value : false;
        const error = taskState.error.type === 'some' ? taskState.error.value : undefined;
        const exitCode = taskState.exitCode.type === 'some' ? Number(taskState.exitCode.value) : undefined;
        const duration = taskState.duration.type === 'some' ? Number(taskState.duration.value) : 0;

        results.push({
          name,
          cached,
          state: landed ? 'success' : taskState.status === 'failed' ? 'failed' : 'skipped',
          error,
          exitCode,
          duration,
        });
      }
    }

    return results;
  }

  /**
   * The record of a run that has ended, as it ended: when, the inputs it
   * started from and the outputs it left, the execution each task used, and
   * its summary.
   */
  private endedRun(
    state: DataflowExecutionState,
    wsState: WorkspaceState,
    execution: RunningExecution,
    status: DataflowRun['status'],
  ): DataflowRun {
    return {
      runId: state.id,
      workspaceName: state.workspace,
      packageRef: `${wsState.packageName}@${wsState.packageVersion}`,
      startedAt: state.startedAt,
      completedAt: some(new Date()),
      status,
      inputVersions: new Map(state.inputSnapshot),
      outputVersions: some(this.buildOutputVersions(state)),
      taskExecutions: new Map(execution.taskExecutions),
      summary: {
        total: BigInt(state.tasks.size),
        completed: state.executed + state.cached,
        cached: state.cached,
        failed: state.failed,
        skipped: state.skipped,
        reexecuted: state.reexecuted,
      },
    };
  }

  /**
   * Build output versions map from completed task states.
   */
  private buildOutputVersions(state: DataflowExecutionState): Map<string, string> {
    const outputVersions = new Map<string, string>();
    const graph = state.graph.type === 'some' ? state.graph.value : null;
    if (graph) {
      for (const task of graph.tasks) {
        const ts = state.tasks.get(task.name);
        if (ts && ts.outputHash.type === 'some') {
          outputVersions.set(task.output, ts.outputHash.value);
        }
      }
    }
    return outputVersions;
  }

  /**
   * Read workspace structure from storage.
   */
  private async readStructure(
    storage: StorageBackend,
    repo: string,
    packageHash: string
  ): Promise<Structure> {
    const pkgData = await storage.objects.read(repo, packageHash);
    const pkgObject = decodePackageObject(pkgData);
    return pkgObject.data.structure;
  }

  /**
   * Persist state through the run's writer, skipping the write once the run's
   * end is recorded or the store has stopped taking its writes, once the run
   * is aborted — its cancel writes its end — and after a yield checkpoint.
   */
  private async persistState(
    execution: RunningExecution,
    state: DataflowExecutionState
  ): Promise<void> {
    if (execution.writer === null) return;
    // The run's end is the last word, however it ended.
    if (execution.ended) return;
    if (execution.aborted) return;
    // After a yield checkpoint the checkpoint write is the last word —
    // late-settling completion handlers must not overwrite it.
    if (execution.yielded) return;
    await execution.writer.write(state);
  }

  /**
   * Generate unique key for an execution.
   */
  private executionKey(repo: string, workspace: string, id: string): string {
    return `${repo}::${workspace}:${id}`;
  }
}
