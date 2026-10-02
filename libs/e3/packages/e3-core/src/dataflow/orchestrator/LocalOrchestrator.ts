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
 * Supports reactive execution: after each task completes, checks for
 * root input changes. If inputs changed, affected tasks are invalidated
 * and re-executed. Version vector consistency checks defer tasks whose
 * inputs have conflicting provenance (diamond dependency protection).
 *
 * It runs wherever its host does: a run's tasks go to the runner its start
 * names, or else to its host's ({@link LocalOrchestratorHost}), and a split
 * task's own execution is recorded under the owner its host names. The root
 * entry of `@elaraai/e3-core` exports it with this process as its host
 * (`execution/local-orchestrator.ts`): tasks run locally, owned by this
 * process.
 */

import { decodeBeast2For, encodeBeast2For, none, some, variant } from '@elaraai/east';
import type {
  DataflowRun, ExecutionOwner, StageUnit, TaskExecutionRecord, Structure, TaskObject, UnitWait, VersionVector, WorkspaceState,
} from '@elaraai/e3-types';
import { WorkspaceRecordType, decodePackageObject, decodeTaskObject } from '@elaraai/e3-types';
import type { StorageBackend, LockHandle } from '../../storage/interfaces.js';
import type { SplitUnit, TaskExecuteOptions } from '../../execution/interfaces.js';
import type { ExecutionResult } from '../../execution/cache.js';
import { SplitTask, isSplitTask, type ThrownUnit } from '../../execution/engine.js';
import { WorkspaceLockError, DataflowAbortedError, DataflowError, DataflowSupersededError } from '../../errors.js';
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
  DataflowExecutionState,
  ExecutionEvent,
  FinalizeResult,
  PrepareTaskResult,
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
  stepIsComplete,
  stepFinalize,
  stepCancel,
  stepYield,
  stepApplyTreeUpdate,
  stepDetectInputChanges,
  stepInvalidateTasks,
  stepCheckVersionConsistency,
  stepGetRunSet,
  stepTaskForced,
} from '../steps.js';
import type { Mutable } from '../types.js';

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
 * A run's one writer of its state: every write of the run goes through it, and
 * reaches the store a write at a time, in the order the writes were made.
 *
 * @remarks
 * A write is a snapshot of the state as it stood when the write was made, so a
 * write waiting its turn carries that state, however the loop changes its own
 * meanwhile. The store never has two of the run's writes at once, which a
 * store that moves a run's state by compare-and-set would refuse as another
 * process's.
 *
 * Once the store takes a write otherwise than applying it — `dropped`, the run
 * having ended, or `refused`, another process having moved it on — the writer
 * writes nothing more: every later write answers that outcome unwritten, and
 * `onStop` hears it once.
 */
class RunWriter {
  /** Settles once every write made so far has landed, or failed. */
  private tail: Promise<unknown> = Promise.resolve();
  /** The outcome that stopped the writer, once a write was not applied. */
  private stopped: 'dropped' | 'refused' | null = null;

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
    const snapshot = cloneExecutionState(state);
    return this.enqueue(() => this.store.update(snapshot));
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
 * A task split into pieces while the loop runs its units beside every other
 * task's: the stage in progress, and where its units are.
 */
interface SplitRun {
  /** The task's stages. */
  readonly split: SplitTask;
  /** The task as it was prepared: its hash, inputs and output. */
  readonly prepared: PrepareTaskResult;
  /** The merged version vector the task was launched with. */
  readonly launchVV: VersionVector;
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
   *  its name, a split task's planning by its name, and each of its units by
   *  a key of its own */
  runningTasks: Map<string, Promise<void>>;
  /** Split tasks in progress, by name, in the order they started */
  splits: Map<string, SplitRun>;
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
 *   A run whose write the store drops, another process having ended it, or
 *   refuses, another having moved it on, stops what it runs, launches and
 *   writes nothing more, and fails no task.
 * - Reactive: detects input changes after each task, invalidates and
 *   re-executes affected tasks until fixpoint
 * - Runs a run's tasks on the runner its start names, or else on its host's
 *   ({@link LocalOrchestratorHost})
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
      // Acquire shared workspace lock first (coexists with e3 set)
      sharedLock = await storage.locks.acquire(repo, workspace, variant('dataflow', null), { mode: 'shared' });
      if (!sharedLock) {
        throw new WorkspaceLockError(workspace);
      }

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

      // Persist initial state
      if (this.stateStore) {
        await this.stateStore.create(state);
      }

      return this.beginExecution(storage, repo, state, {
        dataflowLock,
        sharedLock,
        externalLock,
        options,
        taskExecutions: new Map(),
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
      sharedLock = await storage.locks.acquire(repo, workspace, variant('dataflow', null), { mode: 'shared' });
      if (!sharedLock) {
        throw new WorkspaceLockError(workspace);
      }
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
      const resumed = await this.stateStore.update(state);
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
          if (ts && ts.status === 'completed' && ts.execution.type === 'some') {
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
      splits: [...execution.splits].map(([task, run]) => {
        const { merge, units } = run.split.stage;
        return {
          task,
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

  async getEvents(handle: ExecutionHandle, sinceSeq: number): Promise<ExecutionEvent[]> {
    if (!this.stateStore) {
      return [];
    }
    return this.stateStore.getEventsSince(handle.repo, handle.workspace, handle.id, sinceSeq);
  }

  /**
   * Main execution loop with reactive fixpoint.
   *
   * After each task completes, checks for input changes and invalidates
   * affected tasks. Uses version vector consistency checks to defer tasks
   * whose inputs have conflicting provenance. Execution continues until
   * fixpoint (no more ready, running, or deferred tasks).
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
        // Check if we're done
        if (execution.runningTasks.size === 0 && stepIsComplete(state)) {
          break;
        }

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
        // the rest once it has settled. A split task in progress finishes, as
        // a running task does, even once another task has failed; nothing
        // starts once the run is aborted.
        for (const [taskName, run] of execution.splits) {
          while (
            !checkAborted() &&
            execution.runningTasks.size < width &&
            !run.stopped &&
            run.next < run.split.stage.units.length &&
            (run.inFlight === 0 || !run.split.measuring)
          ) {
            this.launchUnit(storage, repo, execution, taskName, run);
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
            execution.runningTasks.has(taskName) ||
            execution.splits.has(taskName)
          ) {
            continue;
          }

          // Version vector consistency check before launching
          const vvCheck = stepCheckVersionConsistency(state, taskName);
          if (!vvCheck.consistent) {
            // Defer: inputs have inconsistent versions of the same root input
            const ts = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
            if (ts) ts.status = 'deferred';

            // Emit task_deferred event
            const mutableState = state as Mutable<DataflowExecutionState>;
            mutableState.eventSeq = state.eventSeq + 1n;
            const deferEvent: ExecutionEvent = variant('task_deferred', {
              seq: mutableState.eventSeq,
              timestamp: new Date(),
              task: taskName,
              conflictPath: vvCheck.conflictPath,
            });
            (mutableState.events as ExecutionEvent[]).push(deferEvent);

            options.onTaskDeferred?.(taskName, vvCheck.conflictPath);
            continue;
          }

          // Prepare task (resolve inputs, check cache)
          const prepared = await stepPrepareTask(storage, state, taskName);

          // Check cache
          const cached = prepared.cached;
          if (cached !== null) {
            hadSyncCompletion = true;
            // The execution the cache serves the task from.
            const served = { inputsHash: inputsHash(prepared.inputHashes), executionId: cached.executionId };
            // Cache hit — wrap in mutex to serialize with concurrent .then() callbacks
            await execution.mutex.runExclusive(async () => {
              // Write ref with merged VV and update state
              await stepApplyTreeUpdate(
                storage, repo, state.workspace,
                prepared.outputPath, cached.outputHash, vvCheck.mergedVV
              );

              stepTaskCompleted(
                state,
                taskName,
                cached.outputHash,
                true,
                0,
                served
              );

              // Track task execution for DataflowRun
              const existingCached = execution.taskExecutions.get(taskName);
              execution.taskExecutions.set(taskName, {
                ...served,
                taskHash: prepared.taskHash,
                cached: true,
                outputVersions: new Map(vvCheck.mergedVV),
                executionCount: (existingCached?.executionCount ?? 0n) + 1n,
              });

              // Notify callback
              options.onTaskComplete?.({
                name: taskName,
                cached: true,
                state: 'success',
                duration: 0,
              });

              // Detect input changes after cached result
              await this.handleInputChanges(storage, state, options, structure);

              // Update state store
              await this.persistState(execution, state);
            });
            continue;
          }

          // Mark as started (event added by step function), under the mutex
          // as every other change of the run's state is
          await execution.mutex.runExclusive(async () => {
            stepTaskStarted(state, taskName);
            await this.persistState(execution, state);
          });
          options.onTaskStart?.(taskName);

          // A task whose work is split over its inputs runs as the units of
          // its stages, which join the loop's; any other task runs as one.
          const task = await this.readSplitTask(storage, repo, prepared.taskHash);
          if (task !== null) {
            this.launchSplit(storage, repo, execution, taskName, prepared, vvCheck.mergedVV, task);
          } else {
            this.launchTask(storage, repo, execution, taskName, prepared, vvCheck.mergedVV);
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

        // Wait for at least one task to complete if we can't launch more
        if (execution.runningTasks.size > 0) {
          await Promise.race(execution.runningTasks.values());
        } else if (hadSyncCompletion) {
          // A cached task completed synchronously, which may have made new
          // downstream tasks ready. Continue to re-check at the top of the loop.
          continue;
        } else if (readyTasks.length === 0 || checkAborted() || execution.hasFailure) {
          break;
        }
      }

      // A split task the run was aborted before its units could start — its
      // pieces just planned, or its next stage — ends cancelled, as its
      // units in flight would have.
      if (checkAborted()) {
        await this.cancelSplits(storage, repo, execution);
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

        // Build partial results for abort error
        const partialResults = this.buildPartialResults(state);
        throw new DataflowAbortedError(partialResults);
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

      // An unexpected error escaped the execution loop (e.g. a task has an
      // unassigned input). The success-path finalization above is skipped, so
      // without this the run's persisted status stays 'running' forever — any
      // client polling it (e.g. a remote `dataflow run` over the API) then hangs
      // until timeout instead of seeing the failure. Persist a terminal 'failed'
      // status so pollers observe the error promptly.
      //
      // What the loop launched is stopped and settled first, as a cancel
      // stops it, while the run still holds its locks: a completion landing
      // after the terminal record would write the run's state back to
      // 'running', and its task's output ref with the locks let go.
      await this.stopLaunched(storage, repo, execution);
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
      // Remove abort listener to avoid leaking execution object
      execution.abortCleanup?.();

      // Always release the dataflow lock (we always acquire it)
      await execution.lock.release();
      // Release shared workspace lock only if we acquired it (not external)
      if (!execution.externalLock && execution.sharedLock) {
        await execution.sharedLock.release();
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
  private async cancelSplits(storage: StorageBackend, repo: string, execution: RunningExecution): Promise<void> {
    for (const [taskName, run] of [...execution.splits]) {
      const cancelled = await run.split.cancel();
      await this.completeTask(storage, repo, execution, taskName, run.prepared, run.launchVV, outcomeOf(cancelled, run.startTime));
      execution.splits.delete(taskName);
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
  private async stopLaunched(storage: StorageBackend, repo: string, execution: RunningExecution): Promise<void> {
    execution.abortController.abort();
    await Promise.allSettled(execution.runningTasks.values());
    await this.cancelSplits(storage, repo, execution).catch(() => { /* the loop's error is the run's */ });
  }

  /**
   * Records the run's end as cancelled, once: its tasks in progress back to
   * pending — the run's abort stops them — and the run cancelled, written whole
   * as the run's last word, since nothing written after it is taken. Under the
   * mutex, so no completion is half applied in what is written.
   */
  private async endCancelled(execution: RunningExecution, reason: string): Promise<void> {
    await execution.mutex.runExclusive(async () => {
      if (execution.ended) return;
      execution.ended = true;
      stepYield(execution.state);
      stepCancel(execution.state, reason);
      await execution.writer?.write(execution.state);
    });
  }

  /**
   * Stops a run whose writes the store no longer takes — another process ended
   * it, or moved it on: nothing more of its state is written, what runs is
   * stopped as a cancel stops it, and nothing more is launched. The loop then
   * ends it ({@link endStopped}).
   */
  private stopped(execution: RunningExecution, outcome: 'dropped' | 'refused'): void {
    execution.stoppedBy ??= outcome;
    execution.ended = true;
    execution.aborted = true;
    execution.abortController.abort();
  }

  /**
   * Ends a run whose writes the store no longer takes: what the loop launched
   * is stopped and settled, and no task is failed for it. A run another
   * process cancelled gets its record ended as its state was, while the
   * record still reads running; one another process moved on gets nothing more
   * written, its record included.
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
    await this.stopLaunched(storage, repo, execution);
    const { state } = execution;
    if (execution.stoppedBy === 'refused') throw new DataflowSupersededError(state.id);
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
      // the stage's plan, which a resumed run takes up again.
      for (const run of execution.splits.values()) {
        await run.split.suspend();
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
      reexecuted: Number(state.reexecuted),
      duration: Date.now() - state.startedAt.getTime(),
      yielded: true,
    };
  }

  /**
   * Detect input changes and invalidate affected tasks.
   *
   * Called after each task completion to implement the reactive loop.
   */
  private async handleInputChanges(
    storage: StorageBackend,
    state: DataflowExecutionState,
    options: OrchestratorStartOptions,
    structure: Structure | null
  ): Promise<void> {
    const { changes, events: changeEvents } = await stepDetectInputChanges(storage, state, structure);

    // Notify via callbacks
    for (const evt of changeEvents) {
      if (evt.type === 'input_changed') {
        options.onInputChanged?.(evt.value.path, evt.value.previousHash, evt.value.newHash);
      }
    }

    if (changes.length > 0) {
      const mutableState = state as Mutable<DataflowExecutionState>;
      const { invalidated, events: invEvents } = stepInvalidateTasks(state, changes);

      // Track re-executions (tasks that were completed and are now invalidated)
      mutableState.reexecuted = state.reexecuted + BigInt(invalidated.length);

      for (const evt of invEvents) {
        if (evt.type === 'task_invalidated') {
          options.onTaskInvalidated?.(evt.value.task, evt.value.reason);
        }
      }
    }
  }

  /**
   * Completes a task the loop launched, under the mutex: its output applied
   * and its dependents made ready; or back to pending, when its inputs changed
   * while it ran or the run was aborted; or failed, its dependents skipped.
   */
  private async completeTask(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    taskName: string,
    prepared: PrepareTaskResult,
    launchMergedVV: VersionVector,
    result: TaskOutcome
  ): Promise<void> {
    const { state, options } = execution;
    await execution.mutex.runExclusive(async () => {
      // Handle task completion
      if (result.state === 'success') {
        // Check if task's inputs changed during execution by comparing
        // the launch-time merged VV against current. handleInputChanges may
        // have updated root input VVs while this task was in_progress,
        // making its result stale.
        const currentVVCheck = stepCheckVersionConsistency(state, taskName);
        const inputsStale = !currentVVCheck.consistent || (() => {
          const current = currentVVCheck.mergedVV;
          if (launchMergedVV.size !== current.size) return true;
          for (const [key, value] of launchMergedVV) {
            if (current.get(key) !== value) return true;
          }
          return false;
        })();

        if (inputsStale) {
          // Task computed with stale inputs — discard result, reset to pending.
          // The reactive loop will re-execute it with the updated inputs.
          const ts = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
          if (ts) {
            ts.status = 'pending';
            ts.plan = none;
          }

          const mutableState = state as Mutable<DataflowExecutionState>;
          mutableState.eventSeq = state.eventSeq + 1n;
          const invalidEvent: ExecutionEvent = variant('task_invalidated', {
            seq: mutableState.eventSeq,
            timestamp: new Date(),
            task: taskName,
            reason: 'inputs changed during execution',
          });
          (mutableState.events as ExecutionEvent[]).push(invalidEvent);
          mutableState.reexecuted = state.reexecuted + 1n;

          options.onTaskInvalidated?.(taskName, 'inputs changed during execution');
        } else {
          // Use launch-time VV for the output — it reflects what the task
          // actually consumed, not what state.versionVectors says now.
          const mergedVV = launchMergedVV;

          if (result.outputHash) {
            // Write output ref with merged VV
            await stepApplyTreeUpdate(
              storage, repo, state.workspace,
              prepared.outputPath, result.outputHash, mergedVV
            );
          }

          const completed = { inputsHash: inputsHash(prepared.inputHashes), executionId: result.executionId };
          stepTaskCompleted(
            state,
            taskName,
            result.outputHash ?? '',
            result.cached,
            result.duration,
            completed,
            result.peakBytes
          );

          // Track task execution for DataflowRun
          const existing = execution.taskExecutions.get(taskName);
          execution.taskExecutions.set(taskName, {
            ...completed,
            taskHash: prepared.taskHash,
            cached: result.cached,
            outputVersions: new Map(mergedVV),
            executionCount: (existing?.executionCount ?? 0n) + 1n,
          });

          options.onTaskComplete?.({
            name: taskName,
            cached: result.cached,
            state: 'success',
            duration: result.duration,
          });
        }

        // Detect input changes after task completion
        await this.handleInputChanges(storage, state, options, execution.structure);
      } else if (result.cancelled) {
        // e3 stopped the task because the run was aborted — not the
        // task's failure. It goes back to pending, as a stale result
        // does, and the run ends through the abort path as cancelled.
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
    launchMergedVV: VersionVector
  ): void {
    const taskPromise = this.executeTask(storage, repo, execution, taskName, prepared)
      .then((result) => this.completeTask(storage, repo, execution, taskName, prepared, launchMergedVV, result))
      .catch((err) => this.failTask(execution, taskName, err))
      .finally(() => {
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
   * Launches a task whose work is split over its inputs: plans its pieces, or
   * takes up the stage its state names, and hands the stage's units to the
   * loop. The planning is tracked under the task's name, so the loop launches
   * other work meanwhile.
   */
  private launchSplit(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    taskName: string,
    prepared: PrepareTaskResult,
    launchMergedVV: VersionVector,
    task: TaskObject
  ): void {
    const { state, options } = execution;
    const startTime = Date.now();
    const planned = (async () => {
      const taskState = state.tasks.get(taskName);
      const split = await SplitTask.open(
        storage,
        repo,
        prepared.taskHash,
        task,
        prepared.inputHashes,
        { inHash: inputsHash(prepared.inputHashes), executionId: uuidv7(), startTime },
        {
          signal: execution.abortController.signal,
          onPartitionProgress: options.onPartitionProgress
            ? (progress) => options.onPartitionProgress!(taskName, progress)
            : undefined,
        },
        taskState?.plan.type === 'some' ? taskState.plan.value : null,
        options.owner === undefined ? await this.hostOwner() : options.owner
      );
      if (!(split instanceof SplitTask)) {
        await this.completeTask(storage, repo, execution, taskName, prepared, launchMergedVV, outcomeOf(split, startTime));
        return;
      }
      if (execution.yielded) {
        // The run yielded while the task was planned: a resumed run takes it up.
        await split.suspend();
        return;
      }
      execution.splits.set(taskName, {
        split, prepared, launchVV: launchMergedVV, startTime, next: 0, inFlight: 0, stopped: false, results: [], thrown: [],
      });
      const { plan, units } = split.stage;
      if (plan !== null && !split.resumed) {
        await execution.mutex.runExclusive(async () => {
          stepTaskSplit(state, taskName, plan, units.length);
          await this.persistState(execution, state);
        });
      }
    })()
      .catch(async (err) => {
        execution.splits.delete(taskName);
        await this.failTask(execution, taskName, err);
      })
      .finally(() => {
        if (execution.runningTasks.get(taskName) === planned) {
          execution.runningTasks.delete(taskName);
        }
      });
    execution.runningTasks.set(taskName, planned);
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
    taskName: string,
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
    const key = `${taskName}\u0000${execution.unitSeq++}`;
    run.inFlight++;
    run.split.unitStarted(index);
    const launched = (async () => {
      try {
        const result = await this.executeUnit(storage, repo, execution, taskName, run.prepared.taskHash, unit, expectedPeakBytes, key, place);
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
      // After a yield the task was left mid-stage, for a resumed run.
      if (run.inFlight > 0 || more || execution.yielded) return;
      await this.advanceSplit(storage, repo, execution, taskName, run);
    })()
      .catch(async (err) => {
        execution.splits.delete(taskName);
        await this.failTask(execution, taskName, err);
      })
      .finally(() => {
        execution.waiting.delete(key);
        if (execution.runningTasks.get(key) === launched) {
          execution.runningTasks.delete(key);
        }
      });
    execution.runningTasks.set(key, launched);
  }

  /**
   * Advances a split task whose stage has ended: the next stage's units join
   * the loop's, or the task completes as any task does.
   */
  private async advanceSplit(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    taskName: string,
    run: SplitRun
  ): Promise<void> {
    const { state } = execution;
    const ended = run.split.stage.merge;
    const result = await run.split.advance(run.results, run.thrown);
    if (result === null) {
      const { plan, units, merge } = run.split.stage;
      run.next = 0;
      run.inFlight = 0;
      run.stopped = false;
      run.results = [];
      run.thrown = [];
      await execution.mutex.runExclusive(async () => {
        if (ended !== null) stepTaskMergeCompleted(state, taskName, ended.level, ended.levels);
        stepTaskMergeStarted(state, taskName, plan!, merge!.level, merge!.levels, units.length);
        await this.persistState(execution, state);
      });
      return;
    }
    if (ended !== null && result.state === 'success') {
      await execution.mutex.runExclusive(() => {
        stepTaskMergeCompleted(state, taskName, ended.level, ended.levels);
      });
    }
    await this.completeTask(storage, repo, execution, taskName, run.prepared, run.launchVV, outcomeOf(result, run.startTime));
    execution.splits.delete(taskName);
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
   * and a requeue is recorded as an event of the run, naming its place.
   */
  private async executeUnit(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    taskName: string,
    taskHash: string,
    unit: SplitUnit,
    expectedPeakBytes: number | undefined,
    key: string,
    place: StageUnit
  ): Promise<ExecutionResult> {
    const { options } = execution;
    const execOptions: TaskExecuteOptions = {
      // Scoped as the task's own cache bypass is: under a filter, only the
      // target's units re-run.
      force: stepTaskForced(execution.state, taskName),
      verbose: options.verbose,
      signal: execution.abortController.signal,
      onStdout: options.onStdout ? (data) => options.onStdout!(taskName, data) : undefined,
      onStderr: options.onStderr ? (data) => options.onStderr!(taskName, data) : undefined,
      expectedPeakBytes,
      onWaiting: (needs) => {
        if (needs === null) execution.waiting.delete(key);
        else execution.waiting.set(key, { task: taskName, unit: some(place), needs: BigInt(needs), since: new Date().toISOString() });
      },
      onRequeued: (requeue) => {
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
   * Execute a single task.
   */
  private async executeTask(
    storage: StorageBackend,
    repo: string,
    execution: RunningExecution,
    taskName: string,
    prepared: { taskHash: string; inputHashes: string[] }
  ): Promise<TaskOutcome> {
    const { options } = execution;
    const startTime = Date.now();

    const execOptions: TaskExecuteOptions = {
      // Scoped like the cache bypass in stepPrepareTask: a filtered run forces
      // only the target, so a launched dependency still honours its own cache.
      force: stepTaskForced(execution.state, taskName),
      verbose: options.verbose,
      signal: execution.abortController.signal,
      onStdout: options.onStdout ? (data) => options.onStdout!(taskName, data) : undefined,
      onStderr: options.onStderr ? (data) => options.onStderr!(taskName, data) : undefined,
      // Unit progress goes to the caller's callback only. The state records
      // a split task's stages, not each unit: a per-unit state rewrite would
      // make persistence O(units²) under the orchestrator mutex.
      onPartitionProgress: options.onPartitionProgress
        ? (progress) => options.onPartitionProgress!(taskName, progress)
        : undefined,
      // A wait for room is kept, under the task's name, while it lasts.
      onWaiting: (needs) => {
        if (needs === null) execution.waiting.delete(taskName);
        else execution.waiting.set(taskName, { task: taskName, unit: none, needs: BigInt(needs), since: new Date().toISOString() });
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
   * Build partial results for abort error.
   */
  private buildPartialResults(state: DataflowExecutionState): TaskExecutionResult[] {
    const results: TaskExecutionResult[] = [];

    for (const [name, taskState] of state.tasks) {
      if (taskState.status === 'completed' || taskState.status === 'failed' || taskState.status === 'skipped') {
        // Extract values from Option types
        const cached = taskState.cached.type === 'some' ? taskState.cached.value : false;
        const error = taskState.error.type === 'some' ? taskState.error.value : undefined;
        const exitCode = taskState.exitCode.type === 'some' ? Number(taskState.exitCode.value) : undefined;
        const duration = taskState.duration.type === 'some' ? Number(taskState.duration.value) : 0;

        results.push({
          name,
          cached,
          state: taskState.status === 'completed' ? 'success' : taskState.status,
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
