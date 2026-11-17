/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Step functions for resumable dataflow execution.
 *
 * Each step function represents a single unit of work that can be:
 * - Called locally in a loop (LocalOrchestrator)
 * - Invoked as a Lambda handler (Step Functions orchestration)
 *
 * Step functions are designed to be:
 * - Small and focused (one step = one Lambda invocation)
 * - Deterministic where possible (pure functions marked as such)
 * - Idempotent for retries
 *
 * Reactive step functions (stepDetectInputChanges, stepTasksDue,
 * stepTaskDueAgain, stepTaskCommits) make a run follow its inputs: every
 * result lands, a task whose inputs moved runs once more on the newest, and a
 * task that reads several results reads them all as of one commit of each
 * record.
 */

import { variant, some, none, equalFor, StringType } from '@elaraai/east';
import { E3_RELEASE, dataflowForce, type StageUnit, type VersionVector, type Structure } from '@elaraai/e3-types';
import type { StorageBackend } from '../storage/interfaces.js';
import type { UnitRequeue } from '../execution/interfaces.js';
import { DataflowError, TaskNotFoundError } from '../errors.js';
import {
  dataflowGetGraph,
  dataflowGetReadyTasks,
  dataflowGetDependentsToSkip,
  dataflowGetDependencyClosure,
  dataflowRecords,
  dataflowResolveInputs,
  dataflowSnapshotTaken,
  dataflowCheckCache,
  recordCommitOrder,
  type ResolveInputsOptions,
} from '../dataflow.js';
import {
  workspaceGetDatasetHash,
  workspaceSetDatasetByHash,
} from '../trees.js';
import {
  inputVersionVector,
  snapshotInputVersions,
  detectInputChanges,
  versionRoots,
} from '../dataset-refs.js';
import type { DataflowGraph } from '../dataflow.js';
import type {
  DataflowExecutionState,
  TaskState,
  InitializeResult,
  PrepareTaskBehind,
  PrepareTaskResult,
  PrepareTaskWaiting,
  TaskCommits,
  TaskCompletedResult,
  TaskFailedResult,
  TasksWaitingResult,
  FinalizeResult,
  TreeUpdateResult,
  ExecutionEvent,
  Mutable,
} from './types.js';

// =============================================================================
// Initialization
// =============================================================================

/**
 * Options for initializing a dataflow execution.
 */
export interface StepInitializeOptions {
  /** The tasks the run re-executes even where the cache holds their results:
   *  `true` for every task — under a filter, the filter's task — the names of
   *  the tasks, or `false` for none (default) */
  force?: boolean | readonly string[];
  /** One task's exact name: the run runs it and its dependency closure */
  filter?: string;
}

/**
 * Initialize a new dataflow execution.
 *
 * Builds the dependency graph, snapshots root input versions, initializes
 * version vectors, and creates the initial execution state.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param workspace - Workspace name
 * @param executionId - The run's id, a UUIDv7
 * @param options - Execution options
 * @returns Initial state and ready tasks
 *
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace has no package deployed
 * @throws {TaskNotFoundError} If the filter, or a task the run forces, names
 *   a task that doesn't exist
 * @throws {DataflowError} If the run forces a task its filter's run set
 *   leaves out
 */
export async function stepInitialize(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  executionId: string,
  options: StepInitializeOptions = {}
): Promise<InitializeResult> {
  const force = dataflowForce(options.force);
  const filter = options.filter ?? null;

  // Build the dependency graph, and refuse a start that names a task it does
  // not have, before anything runs.
  const graph = await dataflowGetGraph(storage, repo, workspace);
  checkDataflowStart(graph, options);

  // Compute task output paths (datasets produced by tasks)
  const taskOutputPathsSet = new Set<string>();
  for (const task of graph.tasks) {
    taskOutputPathsSet.add(task.output);
  }
  const taskOutputPaths = Array.from(taskOutputPathsSet);

  // Read package structure for input snapshot
  const structure = await getWorkspaceStructure(storage, repo, workspace);

  // Snapshot root input hashes
  const inputSnapshotMap = await snapshotInputVersions(
    storage, repo, workspace, structure, taskOutputPathsSet
  );

  // Initialize version vectors for root inputs
  const versionVectors = new Map<string, Map<string, string>>();
  for (const [keypath, hash] of inputSnapshotMap) {
    versionVectors.set(keypath, inputVersionVector(keypath, hash));
  }

  // Initialize task states
  const tasks = new Map<string, TaskState>();
  for (const task of graph.tasks) {
    tasks.set(task.name, {
      name: task.name,
      status: 'pending',
      cached: none,
      outputHash: none,
      error: none,
      exitCode: none,
      startedAt: none,
      completedAt: none,
      duration: none,
      plan: none,
      execution: none,
    } as TaskState);
  }

  // Create initial state
  const state = {
    release: E3_RELEASE,
    id: executionId,
    repo,
    workspace,
    startedAt: new Date(),
    force,
    filter: filter !== null ? some(filter) : none,
    graph: some(graph),
    graphHash: none,
    tasks,
    executed: 0n,
    cached: 0n,
    failed: 0n,
    skipped: 0n,
    status: 'running' as const,
    completedAt: none,
    error: none,
    versionVectors,
    inputSnapshot: inputSnapshotMap,
    taskOutputPaths,
    reexecuted: 0n,
    events: [] as ExecutionEvent[],
    eventSeq: 0n,
  } as DataflowExecutionState;

  // Find initially ready tasks
  const readyTasks = stepGetReady(state);

  // Update task states to 'ready' (cast to mutable)
  for (const taskName of readyTasks) {
    const taskState = tasks.get(taskName) as Mutable<TaskState>;
    if (taskState) {
      taskState.status = 'ready';
    }
  }

  return { state, readyTasks };
}

/**
 * Refuses a run's start that names a task its graph does not run: a filter
 * naming no task, a task the run forces that the graph lacks, or one its
 * filter's run set leaves out, which would never run. The checks
 * {@link stepInitialize} makes before anything runs, for a host that starts a
 * run in one process and initializes it in another, and refuses a start in the
 * first.
 *
 * @param graph - The workspace's dataflow graph (`dataflowGetGraph`)
 * @param options - The run's force and filter
 * @throws {TaskNotFoundError} When the filter, or a task the run forces, names
 *   a task the graph lacks
 * @throws {DataflowError} When the run forces a task its filter's run set
 *   leaves out
 */
export function checkDataflowStart(graph: DataflowGraph, options: StepInitializeOptions): void {
  const force = dataflowForce(options.force);
  const filter = options.filter ?? null;
  if (filter !== null && !graph.tasks.some(t => t.name === filter)) {
    throw new TaskNotFoundError(filter);
  }

  // Each task the run forces is named as a filter is. One its filter's run
  // set leaves out would never run, so the start is refused before anything
  // does, rather than run without it.
  if (force.type === 'tasks') {
    const unknown = force.value.find(name => !graph.tasks.some(t => t.name === name));
    if (unknown !== undefined) throw new TaskNotFoundError(unknown);
    if (filter !== null) {
      const runSet = dataflowGetDependencyClosure(graph, filter);
      const outside = force.value.filter(name => !runSet.has(name));
      if (outside.length > 0) {
        throw new DataflowError(
          `the run forces ${outside.map(name => `'${name}'`).join(', ')}, which the filter '${filter}' leaves out: ` +
          `a filtered run runs '${filter}' and the tasks it depends on, and no other`
        );
      }
    }
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the graph from state, throwing if not available.
 *
 * For cloud execution, the graph may be stored separately and loaded
 * via graphHash. This helper ensures the graph is present before use.
 */
function getGraph(state: DataflowExecutionState): DataflowGraph {
  if (state.graph.type !== 'some') {
    throw new Error(
      'Execution state has no graph. For cloud execution, load the graph using graphHash before calling step functions.'
    );
  }
  return state.graph.value;
}

/**
 * Read workspace structure from storage.
 *
 * @internal
 */
async function getWorkspaceStructure(
  storage: StorageBackend,
  repo: string,
  workspace: string
): Promise<Structure> {
  const { decodeBeast2For } = await import('@elaraai/east');
  const { decodePackageObject, WorkspaceRecordType } = await import('@elaraai/e3-types');

  const wsData = await storage.refs.workspaceRead(repo, workspace);
  const record = wsData === null ? null : decodeBeast2For(WorkspaceRecordType)(wsData);
  if (record === null || record.type === 'none') {
    throw new Error(`Workspace '${workspace}' not found or not deployed`);
  }

  const pkgData = await storage.objects.read(repo, record.value.packageHash);
  const pkgObject = decodePackageObject(pkgData);

  return pkgObject.data.structure;
}

// =============================================================================
// Pure Step Functions
// =============================================================================

/**
 * Resolve the set of tasks a run is permitted to schedule.
 *
 * With no `--filter`, every task may run (returns null — "no restriction"). A
 * `--filter <task>` scopes the run to that task's dependency closure — the
 * target plus its transitive producers — so the target's (usually cached)
 * upstream can run and make it ready. Restricting to the bare target instead
 * would strand it `pending` on dependencies that never get scheduled.
 *
 * @param state - Current execution state
 * @returns Set of task names permitted to run, or null if unrestricted
 */
export function stepGetRunSet(state: DataflowExecutionState): Set<string> | null {
  const filterValue = state.filter.type === 'some' ? state.filter.value : null;
  if (filterValue === null) return null;
  return dataflowGetDependencyClosure(getGraph(state), filterValue);
}

/**
 * Decide whether a task's cache should be bypassed (force re-execution).
 *
 * A run forces none of its tasks, all of them, or the ones it names
 * (`DataflowForceType`). All of them, under `--filter <task>`, is the named
 * target only — the target's dependencies run from cache — so "re-run just
 * this task" does not re-execute the whole upstream tree. Named tasks are
 * forced wherever they sit in the graph, each time the run launches them, and
 * their dependents are not: they re-run when a forced task's output changes.
 * Keeping this scope in one place keeps the cache-bypass decision in
 * {@link stepPrepareTask} and the runner's force flag in agreement.
 *
 * @param state - Current execution state
 * @param taskName - Name of the task being prepared or executed
 * @returns True if the task must re-execute regardless of a cached result
 */
export function stepTaskForced(state: DataflowExecutionState, taskName: string): boolean {
  switch (state.force.type) {
    case 'none':
      return false;
    case 'all': {
      const filterValue = state.filter.type === 'some' ? state.filter.value : null;
      return filterValue === null || taskName === filterValue;
    }
    case 'tasks':
      return state.force.value.includes(taskName);
  }
}

/**
 * Get tasks that are ready to execute.
 *
 * A task is ready when:
 * 1. Every task it depends on holds a result in the run, whatever that
 *    task's status, save one that waits, failed or was skipped: a task due
 *    again keeps its result while it runs again, so a change travels a step at
 *    a time, and none of its dependents is reset to wait for it
 * 2. It passes the filter (if any)
 * 3. It is not already completed, in-progress, failed, skipped, or deferred
 *
 * This is a pure function - it only reads state.
 *
 * @param state - Current execution state
 * @returns Array of task names that are ready to execute
 */
export function stepGetReady(state: DataflowExecutionState): string[] {
  const completedTasks = new Set<string>();
  const resultTasks = new Set<string>();
  for (const [name, taskState] of state.tasks) {
    if (taskState.status === 'completed') {
      completedTasks.add(name);
    }
    if (
      taskState.outputHash.type === 'some' &&
      taskState.status !== 'waiting' && taskState.status !== 'failed' && taskState.status !== 'skipped'
    ) {
      resultTasks.add(name);
    }
  }

  // Get ready tasks from graph
  const graphReady = dataflowGetReadyTasks(getGraph(state), completedTasks, resultTasks);

  // Restrict to the filter's dependency closure (null = no filter)
  const runSet = stepGetRunSet(state);

  return graphReady.filter(taskName => {
    const taskState = state.tasks.get(taskName);
    if (!taskState) return false;

    // Skip tasks that are already being processed or deferred
    if (
      taskState.status !== 'pending' &&
      taskState.status !== 'ready'
    ) {
      return false;
    }

    // Apply task filter (target + its transitive dependencies)
    if (runSet !== null && !runSet.has(taskName)) {
      return false;
    }

    return true;
  });
}

/**
 * Check if the execution is complete.
 *
 * An execution is complete when all tasks are in a terminal state
 * (completed, failed, skipped, or waiting on an unassigned input) or have
 * permanently unresolvable dependencies. Returns false if any non-terminal
 * tasks remain.
 *
 * This is a pure function - it only reads state.
 *
 * @param state - Current execution state
 * @returns True if execution is complete
 */
export function stepIsComplete(state: DataflowExecutionState): boolean {
  const runSet = stepGetRunSet(state);

  for (const taskState of state.tasks.values()) {
    if (
      taskState.status === 'pending' ||
      taskState.status === 'ready' ||
      taskState.status === 'in_progress' ||
      taskState.status === 'deferred'
    ) {
      if (taskState.status === 'in_progress') {
        return false;
      }

      if (taskState.status === 'deferred') {
        return false;
      }

      // pending or ready — check if it can ever become ready
      const task = getGraph(state).tasks.find(t => t.name === taskState.name);
      if (task) {
        const hasUnmetDeps = task.dependsOn.some(dep => {
          const depState = state.tasks.get(dep);
          return depState && (depState.status === 'failed' || depState.status === 'skipped' || depState.status === 'waiting');
        });
        if (!hasUnmetDeps) {
          if (runSet !== null && !runSet.has(taskState.name)) {
            continue; // Outside the filter's run set, doesn't affect completion
          }
          return false;
        }
      }
    }
  }

  return true;
}

// =============================================================================
// Reactive Step Functions
// =============================================================================

/**
 * Detect input changes since the last snapshot.
 *
 * Reads current root input dataset hashes from storage and compares
 * against the snapshot stored in state. For each change, updates the
 * input snapshot and version vectors, and emits input_changed events.
 *
 * @param storage - Storage backend
 * @param state - Execution state to mutate (inputSnapshot, versionVectors)
 * @returns Changes detected and events emitted
 */
export async function stepDetectInputChanges(
  storage: StorageBackend,
  state: DataflowExecutionState,
  cachedStructure?: Structure | null
): Promise<{
  changes: Array<{ path: string; previousHash: string | null; newHash: string }>;
  events: ExecutionEvent[];
}> {
  const structure = cachedStructure ?? await getWorkspaceStructure(storage, state.repo, state.workspace);
  const taskOutputPathsSet = new Set(state.taskOutputPaths);

  const changes = await detectInputChanges(
    storage, state.repo, state.workspace,
    state.inputSnapshot, structure, taskOutputPathsSet
  );

  const events: ExecutionEvent[] = [];
  const mutableState = state as Mutable<DataflowExecutionState>;

  for (const change of changes) {
    // Update input snapshot, numbered in the order the run takes them
    dataflowSnapshotTaken(state, change.path, change.newHash);
    state.inputSnapshot.set(change.path, change.newHash);

    // Update version vector for this input
    state.versionVectors.set(change.path, inputVersionVector(change.path, change.newHash));

    // Emit event
    mutableState.eventSeq = state.eventSeq + 1n;
    const event: ExecutionEvent = variant('input_changed', {
      seq: mutableState.eventSeq,
      timestamp: new Date(),
      path: change.path,
      previousHash: change.previousHash ?? '',
      newHash: change.newHash,
    });
    (mutableState.events as ExecutionEvent[]).push(event);
    events.push(event);
  }

  return { changes, events };
}

/** Whether two of a version vector's versions are the same. */
const sameVersion = equalFor(StringType);

/**
 * Whether two version vectors name the same versions of the same roots. The
 * reserved slots a ref's vector carries, whose keys begin `$`, are no roots,
 * and are left out.
 */
function sameVersions(a: VersionVector, b: VersionVector): boolean {
  const left = versionRoots(a);
  if (left.length !== versionRoots(b).length) return false;
  return left.every(([root, version]) => {
    const other = b.get(root);
    return other !== undefined && sameVersion(other, version);
  });
}

/**
 * The version of each root a task reads: for a record, one commit.
 *
 * @remarks
 * A task reads its inputs, some of them other tasks' results, each made from
 * versions of the run's roots. It reads them all as of one version of each
 * root, so it never computes on a mix, and it never waits for results made
 * from different commits to agree:
 *
 * - **A record**: the oldest commit of it its inputs name — the run's
 *   snapshot, for a record the task reads directly, and a result's own for
 *   one it reads through that result. The record is read there from its
 *   history, and a result made from a newer commit from the execution cache,
 *   or by a catch-up run ({@link stepPrepareTask}).
 * - **A plain input**: the value its inputs agree on. A plain input keeps no
 *   earlier value to read, so a task whose inputs read one at different
 *   values is deferred until they agree.
 *
 * A reserved slot of a vector, whose key begins `$`, is no root, and is left
 * out.
 *
 * @param storage - Storage backend
 * @param state - Execution state
 * @param taskName - The task
 * @returns The version of each root the task reads, or why it is deferred
 */
export async function stepTaskCommits(
  storage: StorageBackend,
  state: DataflowExecutionState,
  taskName: string
): Promise<TaskCommits> {
  const graph = getGraph(state);
  const task = graph.tasks.find(t => t.name === taskName);
  if (!task) {
    throw new Error(`Task '${taskName}' not found in graph`);
  }

  // Each root the task's inputs name, at the version each names it at, with
  // the input that does: a task by its name, or the root itself
  const producerOf = new Map(graph.tasks.map((each) => [each.output, each.name] as const));
  const named = new Map<string, Array<{ version: string; through: string }>>();
  for (const inputPath of new Set(task.inputs)) {
    const through = producerOf.get(inputPath) ?? inputPath;
    for (const [root, version] of versionRoots(state.versionVectors.get(inputPath) ?? new Map())) {
      let names = named.get(root);
      if (names === undefined) {
        names = [];
        named.set(root, names);
      }
      names.push({ version, through });
    }
  }

  const versions = new Map<string, string>();
  for (const [root, names] of named) {
    let version = names[0]!.version;
    if (names.some((each) => !sameVersion(each.version, version))) {
      if (!(await dataflowRecords(storage, state)).has(root)) {
        const through = [...new Set(names.map((each) => each.through))];
        return {
          kind: 'deferred',
          conflictPath: root,
          reason: { kind: 'plain', input: root, through: [...through.filter((each) => each === root), ...through.filter((each) => each !== root)] },
        };
      }
      for (const each of names.slice(1)) {
        version = await recordCommitOrder(storage, state, root, version, each.version);
      }
    }
    versions.set(root, version);
  }
  return { kind: 'commits', versions };
}

/**
 * Whether a task that holds a result would now read other inputs than the
 * result was made from: another commit of a record, another result of a
 * task, or another value of a plain input, at the versions it reads now
 * ({@link stepTaskCommits}). A result is known by the versions it was made
 * from.
 */
async function wouldReadOther(storage: StorageBackend, state: DataflowExecutionState, taskName: string, output: string): Promise<boolean> {
  const made = state.versionVectors.get(output);
  if (made === undefined) return true;
  const at = await stepTaskCommits(storage, state, taskName);
  // Deferred: its inputs read a plain input at two values, which the launch
  // says, once they are decided again
  return at.kind === 'deferred' || !sameVersions(at.versions, made);
}

/**
 * Puts a completed task back to pending, to run once more: it keeps its
 * result — its output, its execution and its output's versions — which stays
 * in the workspace and which its dependents go on reading.
 */
function taskDue(state: DataflowExecutionState, taskState: Mutable<TaskState>, reason: string): ExecutionEvent {
  const mutableState = state as Mutable<DataflowExecutionState>;
  taskState.status = 'pending';
  // It counts again as it lands again
  if (taskState.cached.type === 'some' && taskState.cached.value) {
    mutableState.cached = state.cached - 1n;
  } else {
    mutableState.executed = state.executed - 1n;
  }
  mutableState.reexecuted = state.reexecuted + 1n;

  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('task_invalidated', {
    seq: mutableState.eventSeq,
    timestamp: new Date(),
    task: taskState.name,
    reason,
  });
  (mutableState.events as ExecutionEvent[]).push(event);
  return event;
}

/**
 * Ask each task that reads a changed dataset directly whether it is due: a
 * root whose snapshot moved ({@link stepDetectInputChanges}), or a task's
 * output whose result landed.
 *
 * A change travels a step at a time: a task's dependents are asked once its
 * next result lands, not when the root moves, and none is reset to wait for
 * it. For each task that reads a changed dataset:
 * - completed: due when it would now read other inputs than its result was
 *   made from — back to pending, to run once on the newest commits for every
 *   change that arrived meanwhile, counted a re-execution, `task_invalidated`
 *   emitted. It keeps its result, which stays in the workspace and which its
 *   dependents go on reading
 * - in_progress: left — it is asked as it lands ({@link stepTaskDueAgain})
 * - deferred: reset to pending, and decided again as it next launches
 * - waiting: reset to pending — the input it waited on may be the one that
 *   changed, and the loop decides it again — unless a task it depends on
 *   still waits, which decides it again as that task completes
 *   ({@link stepTaskCompleted})
 * - pending/ready: left as-is (it reads the newest commits as it launches)
 * - skipped: left as-is (upstream failure still applies)
 * - failed: left as-is (task already failed; the run is winding down)
 *
 * @param storage - Storage backend
 * @param state - Execution state to mutate
 * @param changed - The datasets that changed, by keypath
 * @returns The tasks now due that held a result, and the events emitted
 */
export async function stepTasksDue(
  storage: StorageBackend,
  state: DataflowExecutionState,
  changed: ReadonlyArray<{ path: string }>
): Promise<{
  due: string[];
  events: ExecutionEvent[];
}> {
  const graph = getGraph(state);
  const paths = new Set(changed.map((change) => change.path));
  const due: string[] = [];
  const events: ExecutionEvent[] = [];

  for (const task of graph.tasks) {
    const read = [...new Set(task.inputs.filter((input) => paths.has(input)))];
    if (read.length === 0) continue;
    const taskState = state.tasks.get(task.name) as Mutable<TaskState> | undefined;
    if (!taskState) continue;

    if (taskState.status === 'completed') {
      if (!(await wouldReadOther(storage, state, task.name, task.output))) continue;
      events.push(taskDue(state, taskState, `input changed: ${read.join(', ')}`));
      due.push(task.name);
    } else if (taskState.status === 'deferred') {
      // Un-defer — it is decided again as it next launches
      taskState.status = 'pending';
    } else if (taskState.status === 'waiting' && !waitsOnDependency(state, graph, task.name)) {
      // Stop waiting — the input it waited on may be the one that changed,
      // and the loop decides it again — unless a task it reads still waits,
      // which decides it again as that task completes
      taskState.status = 'pending';
    }
  }

  return { due, events };
}

/**
 * Ask a task whose result has just landed whether it is still due: its
 * inputs moved while it ran, so it would now read others than the ones it
 * was launched with. It then goes back to pending, keeping the result that
 * landed, and runs once more on the newest commits, for everything that
 * arrived meanwhile.
 *
 * @param storage - Storage backend
 * @param state - Execution state to mutate
 * @param taskName - The task whose result landed
 * @returns The `task_invalidated` event when the task is due again, or `null`
 */
export async function stepTaskDueAgain(
  storage: StorageBackend,
  state: DataflowExecutionState,
  taskName: string
): Promise<ExecutionEvent | null> {
  const task = getGraph(state).tasks.find(t => t.name === taskName);
  const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
  if (!task || !taskState || taskState.status !== 'completed') return null;
  if (!(await wouldReadOther(storage, state, taskName, task.output))) return null;
  return taskDue(state, taskState, 'its inputs moved while it ran');
}

// =============================================================================
// Async Step Functions (I/O operations)
// =============================================================================

/**
 * Prepare a task for execution by resolving inputs and checking cache.
 *
 * This async operation:
 * 1. Resolves the task's inputs at the versions it reads
 *    (`dataflowResolveInputs`): each record at its commit, and each result it
 *    reads as made from those versions
 * 2. Checks if there's a valid cached execution
 *
 * A task an input of which is unassigned — one nothing has set, or a record
 * whose first state is not yet committed — cannot run: the answer names the
 * inputs, and the loop leaves the task waiting ({@link stepTasksWaiting})
 * rather than fail the run.
 *
 * A task that reads a result made from newer versions than its own, which
 * the execution cache does not hold at its own, is behind: the answer names
 * the catch-up runs that make what is missing. The loop runs them, tells the
 * step their outputs (`options.landed`), and prepares the task again at the
 * same versions, so it never chases newer ones.
 *
 * @param storage - Storage backend
 * @param state - Current execution state
 * @param taskName - Name of the task to prepare
 * @param versions - The version of each root the task reads
 *   ({@link stepTaskCommits})
 * @param options - The catch-up runs the loop holds the outputs of
 * @returns Preparation result with input hashes and cache status, the inputs
 *   the task waits on, or the catch-up runs it waits for
 */
export async function stepPrepareTask(
  storage: StorageBackend,
  state: DataflowExecutionState,
  taskName: string,
  versions: VersionVector,
  options: Pick<ResolveInputsOptions, 'landed'> = {}
): Promise<PrepareTaskResult | PrepareTaskWaiting | PrepareTaskBehind> {
  const graph = getGraph(state);
  const task = graph.tasks.find(t => t.name === taskName);
  if (!task) {
    throw new Error(`Task '${taskName}' not found in graph`);
  }

  // Resolve the inputs at the task's versions
  const resolved = await dataflowResolveInputs(storage, state, task, versions, {
    landed: options.landed,
    forced: (name) => stepTaskForced(state, name),
  });

  // An unassigned input: the task waits for it
  if (resolved.kind === 'unassigned') return { kind: 'waiting', task: taskName, unassigned: resolved.inputs };
  // A result it reads is not at hand at its versions: catch-up runs make it
  if (resolved.kind === 'behind') return { kind: 'behind', task: taskName, runs: resolved.runs };
  const validInputHashes = resolved.hashes;

  // Check cache unless the run forces this task: every task, the filter's
  // target, or the ones it names (stepTaskForced).
  let cached: PrepareTaskResult['cached'] = null;
  if (!stepTaskForced(state, taskName)) {
    cached = await dataflowCheckCache(
      storage,
      state.repo,
      task.hash,
      validInputHashes
    );

    // Also verify the workspace output matches the cached output
    if (cached !== null) {
      const { parsePathString } = await import('../dataflow.js');
      const outputPath = parsePathString(task.output);
      const { refType, hash: wsOutputHash } = await workspaceGetDatasetHash(
        storage,
        state.repo,
        state.workspace,
        outputPath
      );
      if (refType !== 'value' || wsOutputHash !== cached.outputHash) {
        // Workspace output doesn't match cached output, need to re-execute
        cached = null;
      }
    }
  }

  return {
    kind: 'prepared',
    task: taskName,
    taskHash: task.hash,
    inputHashes: validInputHashes,
    outputPath: task.output,
    cached,
  };
}

// =============================================================================
// State Mutation Step Functions
// =============================================================================

/**
 * The tasks a run's state holds `waiting`: those left waiting on an
 * unassigned input, and their dependents, in the state's order.
 *
 * This is a pure function - it only reads state.
 *
 * @param state - Execution state
 * @returns Their names
 */
export function waitingTasks(state: DataflowExecutionState): string[] {
  const waiting: string[] = [];
  for (const [name, taskState] of state.tasks) {
    if (taskState.status === 'waiting') waiting.push(name);
  }
  return waiting;
}

/** Whether a task depends on a task left waiting: it cannot run until that
 *  task has, however its own inputs stand, so it keeps waiting. */
function waitsOnDependency(state: DataflowExecutionState, graph: DataflowGraph, taskName: string): boolean {
  const task = graph.tasks.find((each) => each.name === taskName);
  return task !== undefined && task.dependsOn.some((dep) => state.tasks.get(dep)?.status === 'waiting');
}

/**
 * Leave a task waiting on an unassigned input, and its dependents with it.
 *
 * Mutates the execution state: the task's status is `waiting`, and so is
 * every task downstream of it that has not run — within the filter's run set,
 * when the run has one, as a failure's skips are — since none can have its
 * inputs while this one waits. The run goes on without them and ends
 * completed once the rest has run: a waiting task counts against no outcome,
 * and is no failure. It goes back to pending once the input is assigned
 * while the run is in flight ({@link stepTasksDue}), as a task it
 * waited on completes ({@link stepTaskCompleted}), or as a run that yielded
 * resumes ({@link stepYield}), and the loop decides it again.
 *
 * No event records it: a run's events are a stored form, which a new event
 * would change. The state's task statuses say which tasks wait
 * ({@link waitingTasks}), and a store derives the summary's count from them.
 *
 * @param state - Execution state to mutate
 * @param taskName - The task whose input is unassigned
 * @param unassigned - The task's inputs that are unassigned, as keypaths
 * @returns Each task left waiting, the named one first, with the inputs it
 *   waits on
 */
export function stepTasksWaiting(
  state: DataflowExecutionState,
  taskName: string,
  unassigned: readonly string[],
): TasksWaitingResult {
  const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }
  const graph = getGraph(state);
  taskState.status = 'waiting';
  const waiting: TasksWaitingResult['waiting'] = [{ task: taskName, inputs: [...unassigned] }];

  // Its dependents that have not run wait with it, as a failure's are
  // skipped: those in the filter's run set, and none already settled
  const runSet = stepGetRunSet(state);
  const completed = new Set<string>();
  const settled = new Set<string>();
  for (const [name, ts] of state.tasks) {
    if (ts.status === 'completed') completed.add(name);
    else if (ts.status === 'skipped' || ts.status === 'waiting') settled.add(name);
  }
  const dependents = dataflowGetDependentsToSkip(graph, taskName, completed, settled).filter((name) => {
    const ts = state.tasks.get(name);
    if (!ts || (ts.status !== 'pending' && ts.status !== 'ready' && ts.status !== 'deferred')) return false;
    return runSet === null || runSet.has(name);
  });
  const producerOf = new Map(graph.tasks.map((task) => [task.output, task.name] as const));
  const nowWaiting = new Set([taskName, ...dependents]);
  for (const name of dependents) {
    (state.tasks.get(name) as Mutable<TaskState>).status = 'waiting';
    const task = graph.tasks.find((each) => each.name === name)!;
    waiting.push({
      task: name,
      inputs: task.inputs.filter((input) => {
        const producer = producerOf.get(input);
        return producer !== undefined && nowWaiting.has(producer);
      }),
    });
  }
  return { waiting };
}

/**
 * Mark a task as started (in-progress).
 *
 * Mutates the execution state to record that a task has begun execution.
 *
 * @param state - Execution state to mutate
 * @param taskName - Name of the task
 * @returns Event to record
 */
export function stepTaskStarted(
  state: DataflowExecutionState,
  taskName: string
): ExecutionEvent {
  const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }

  const now = new Date();
  taskState.status = 'in_progress';
  taskState.startedAt = some(now);

  const mutableState = state as Mutable<DataflowExecutionState>;
  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('task_started', {
    seq: mutableState.eventSeq,
    timestamp: now,
    task: taskName,
  });
  (mutableState.events as ExecutionEvent[]).push(event);
  return event;
}

/**
 * Record that a task was split into pieces: its units start as the pieces,
 * and the task's state names their `$plan`, so a resumed run takes the stage
 * up where it stopped.
 *
 * @param state - Execution state to mutate
 * @param taskName - Name of the task
 * @param plan - Hash of the pieces' `$plan` object
 * @param pieces - The number of pieces
 * @returns Event to record
 */
export function stepTaskSplit(
  state: DataflowExecutionState,
  taskName: string,
  plan: string,
  pieces: number
): ExecutionEvent {
  const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }
  taskState.plan = some(plan);

  const mutableState = state as Mutable<DataflowExecutionState>;
  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('task_split', {
    seq: mutableState.eventSeq,
    timestamp: new Date(),
    task: taskName,
    pieces: BigInt(pieces),
  });
  (mutableState.events as ExecutionEvent[]).push(event);
  return event;
}

/**
 * Record that a level of the merges assembling a split task's pieces started:
 * the task's state names the level's `$plan`.
 *
 * @param state - Execution state to mutate
 * @param taskName - Name of the task
 * @param plan - Hash of the level's `$plan` object
 * @param level - The level, from 1
 * @param levels - The number of levels the merges take
 * @param units - The merge units of the level
 * @returns Event to record
 */
export function stepTaskMergeStarted(
  state: DataflowExecutionState,
  taskName: string,
  plan: string,
  level: number,
  levels: number,
  units: number
): ExecutionEvent {
  const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }
  taskState.plan = some(plan);

  const mutableState = state as Mutable<DataflowExecutionState>;
  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('task_merge_started', {
    seq: mutableState.eventSeq,
    timestamp: new Date(),
    task: taskName,
    level: BigInt(level),
    levels: BigInt(levels),
    units: BigInt(units),
  });
  (mutableState.events as ExecutionEvent[]).push(event);
  return event;
}

/**
 * Record that a level of the merges assembling a split task's pieces
 * finished: every unit of it succeeded.
 *
 * @param state - Execution state to mutate
 * @param taskName - Name of the task
 * @param level - The level, from 1
 * @param levels - The number of levels the merges take
 * @returns Event to record
 */
export function stepTaskMergeCompleted(
  state: DataflowExecutionState,
  taskName: string,
  level: number,
  levels: number
): ExecutionEvent {
  if (!state.tasks.has(taskName)) {
    throw new Error(`Task '${taskName}' not found in state`);
  }
  const mutableState = state as Mutable<DataflowExecutionState>;
  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('task_merge_completed', {
    seq: mutableState.eventSeq,
    timestamp: new Date(),
    task: taskName,
    level: BigInt(level),
    levels: BigInt(levels),
  });
  (mutableState.events as ExecutionEvent[]).push(event);
  return event;
}

/**
 * Record that a unit of a split task was stopped — by the budget's guard, or
 * its cgroup's cap — and requeued: it runs again, under the same execution,
 * once the memory it reserves fits.
 *
 * @param state - Execution state to mutate
 * @param taskName - Name of the task
 * @param unit - The unit, by its place in the task
 * @param requeue - Why its runner was stopped, the most it was measured using,
 *   and what it reserves when it runs again
 * @returns Event to record
 */
export function stepUnitRequeued(
  state: DataflowExecutionState,
  taskName: string,
  unit: StageUnit,
  requeue: UnitRequeue
): ExecutionEvent {
  if (!state.tasks.has(taskName)) {
    throw new Error(`Task '${taskName}' not found in state`);
  }
  const mutableState = state as Mutable<DataflowExecutionState>;
  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('unit_requeued', {
    seq: mutableState.eventSeq,
    timestamp: new Date(),
    task: taskName,
    unit,
    reason: variant(requeue.reason, null),
    peak: BigInt(requeue.peak),
    reserves: BigInt(requeue.reserves),
  });
  (mutableState.events as ExecutionEvent[]).push(event);
  return event;
}

/**
 * Mark a task as completed successfully.
 *
 * Mutates the execution state, records for the task's output the versions
 * the task was launched with — what the result was made from, whatever the
 * run's inputs have moved to since — and returns the newly ready tasks. A
 * dependent the loop deferred, its inputs' versions disagreeing, goes back to
 * pending: one of its inputs is produced anew, which may resolve the
 * disagreement, and a deferral is decided again as the task next launches. So
 * does a dependent left waiting with this task ({@link stepTasksWaiting}),
 * unless another task it reads still waits.
 *
 * Every result lands: whether the task is due again, its inputs having moved
 * while it ran, is asked after ({@link stepTaskDueAgain}), and its dependents
 * are asked whether they are ({@link stepTasksDue}).
 *
 * @param state - Execution state to mutate
 * @param taskName - Name of the task
 * @param outputHash - Hash of the output dataset
 * @param cached - Whether the result was from cache
 * @param duration - Execution duration in milliseconds
 * @param execution - The execution the task completed with, which ran or
 *   which the cache served: its inputs hash and its id
 * @param versions - The version of each root the task was launched with
 *   ({@link stepTaskCommits})
 * @param peakBytes - The highest peak resident memory, in bytes, a runner of
 *   the execution reached, when one reported it
 * @returns Result with newly ready tasks and event
 */
export function stepTaskCompleted(
  state: DataflowExecutionState,
  taskName: string,
  outputHash: string,
  cached: boolean,
  duration: number,
  execution: { inputsHash: string; executionId: string },
  versions: VersionVector,
  peakBytes?: number
): { result: TaskCompletedResult; event: ExecutionEvent } {
  const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }

  const now = new Date();
  const mutableState = state as Mutable<DataflowExecutionState>;

  taskState.status = 'completed';
  taskState.cached = some(cached);
  taskState.outputHash = some(outputHash);
  taskState.completedAt = some(now);
  taskState.duration = some(BigInt(duration));
  taskState.plan = none;
  taskState.execution = some(execution);

  // Update counters
  if (cached) {
    mutableState.cached = state.cached + 1n;
  } else {
    mutableState.executed = state.executed + 1n;
  }

  // The output's versions are those the task was launched with
  const graph = getGraph(state);
  const task = graph.tasks.find(t => t.name === taskName);
  if (task) {
    state.versionVectors.set(task.output, new Map(versions));
  }

  // Its deferred dependents are decided again, and so are its waiting ones
  // that wait on no other task: left waiting with this task, which has since
  // run
  for (const dependent of graph.tasks) {
    if (!dependent.dependsOn.includes(taskName)) continue;
    const ts = state.tasks.get(dependent.name) as Mutable<TaskState> | undefined;
    if (ts?.status === 'deferred') ts.status = 'pending';
    else if (ts?.status === 'waiting' && !waitsOnDependency(state, graph, dependent.name)) ts.status = 'pending';
  }

  // Find newly ready tasks
  const newlyReady = stepGetReady(state);
  for (const name of newlyReady) {
    const ts = state.tasks.get(name) as Mutable<TaskState> | undefined;
    if (ts && ts.status === 'pending') {
      ts.status = 'ready';
    }
  }

  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('task_completed', {
    seq: mutableState.eventSeq,
    timestamp: now,
    task: taskName,
    cached,
    outputHash,
    duration: BigInt(duration),
    peakBytes: peakBytes === undefined ? none : some(BigInt(peakBytes)),
  });
  (mutableState.events as ExecutionEvent[]).push(event);

  return { result: { newlyReady }, event };
}

/**
 * Mark a task as failed.
 *
 * Mutates the execution state and returns tasks that should be skipped.
 *
 * @param state - Execution state to mutate
 * @param taskName - Name of the failed task
 * @param error - Error message (optional)
 * @param exitCode - Exit code if process failed (optional)
 * @param duration - Execution duration in milliseconds
 * @returns Result with tasks to skip and event
 */
export function stepTaskFailed(
  state: DataflowExecutionState,
  taskName: string,
  error: string | undefined,
  exitCode: number | undefined,
  duration: number
): { result: TaskFailedResult; event: ExecutionEvent } {
  const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
  if (!taskState) {
    throw new Error(`Task '${taskName}' not found in state`);
  }

  const now = new Date();
  const mutableState = state as Mutable<DataflowExecutionState>;

  taskState.status = 'failed';
  taskState.error = error !== undefined ? some(error) : none;
  taskState.exitCode = exitCode !== undefined ? some(BigInt(exitCode)) : none;
  taskState.completedAt = some(now);
  taskState.duration = some(BigInt(duration));
  taskState.plan = none;

  // Update counters
  mutableState.failed = state.failed + 1n;

  // Restrict skips to the filter's run set (null = no filter)
  const runSet = stepGetRunSet(state);

  // Find tasks to skip (transitive dependents)
  const completedSet = new Set<string>();
  const skippedSet = new Set<string>();
  for (const [name, ts] of state.tasks) {
    if (ts.status === 'completed') completedSet.add(name);
    if (ts.status === 'skipped') skippedSet.add(name);
  }

  const toSkip = dataflowGetDependentsToSkip(
    getGraph(state),
    taskName,
    completedSet,
    skippedSet
  ).filter(name => {
    // Also exclude in-progress tasks and apply filter
    const ts = state.tasks.get(name);
    if (!ts || ts.status === 'in_progress') return false;
    if (runSet !== null && !runSet.has(name)) return false;
    return true;
  });

  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('task_failed', {
    seq: mutableState.eventSeq,
    timestamp: now,
    task: taskName,
    error: error !== undefined ? some(error) : none,
    exitCode: exitCode !== undefined ? some(BigInt(exitCode)) : none,
    duration: BigInt(duration),
  });
  (mutableState.events as ExecutionEvent[]).push(event);

  return { result: { toSkip }, event };
}

/**
 * Mark tasks as skipped due to upstream failure.
 *
 * @param state - Execution state to mutate
 * @param taskNames - Names of tasks to skip
 * @param cause - Name of the task that caused the skip
 * @returns Array of events to record
 */
export function stepTasksSkipped(
  state: DataflowExecutionState,
  taskNames: string[],
  cause: string
): ExecutionEvent[] {
  const events: ExecutionEvent[] = [];
  const now = new Date();
  const mutableState = state as Mutable<DataflowExecutionState>;

  for (const taskName of taskNames) {
    const taskState = state.tasks.get(taskName) as Mutable<TaskState> | undefined;
    if (!taskState) continue;

    taskState.status = 'skipped';
    taskState.completedAt = some(now);
    taskState.duration = some(0n);

    mutableState.skipped = mutableState.skipped + 1n;

    mutableState.eventSeq = mutableState.eventSeq + 1n;
    const event: ExecutionEvent = variant('task_skipped', {
      seq: mutableState.eventSeq,
      timestamp: now,
      task: taskName,
      cause,
    });
    (mutableState.events as ExecutionEvent[]).push(event);
    events.push(event);
  }

  return events;
}

/**
 * Finalize the execution and return the result.
 *
 * Mutates the execution state to mark it as completed or failed.
 *
 * @param state - Execution state to mutate, whose id is its run's
 * @returns Final result
 */
export function stepFinalize(state: DataflowExecutionState): {
  result: FinalizeResult;
  event: ExecutionEvent;
} {
  const now = new Date();
  const startTime = state.startedAt.getTime();
  const duration = Date.now() - startTime;
  const mutableState = state as Mutable<DataflowExecutionState>;

  // Determine success
  const success = state.failed === 0n;

  // Update state
  mutableState.status = success ? 'completed' : 'failed';
  mutableState.completedAt = some(now);

  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('execution_completed', {
    seq: mutableState.eventSeq,
    timestamp: now,
    success,
    executed: state.executed,
    cached: state.cached,
    failed: state.failed,
    skipped: state.skipped,
    duration: BigInt(duration),
  });
  (mutableState.events as ExecutionEvent[]).push(event);

  const result: FinalizeResult = {
    success,
    runId: state.id,
    executed: Number(state.executed),
    cached: Number(state.cached),
    failed: Number(state.failed),
    skipped: Number(state.skipped),
    waiting: waitingTasks(state).length,
    reexecuted: Number(state.reexecuted),
    duration,
  };

  return { result, event };
}

/**
 * Cancel the execution.
 *
 * @param state - Execution state to mutate
 * @param reason - Reason for cancellation
 * @returns Event to record
 */
export function stepCancel(
  state: DataflowExecutionState,
  reason?: string
): ExecutionEvent {
  const now = new Date();
  const mutableState = state as Mutable<DataflowExecutionState>;

  mutableState.status = 'cancelled';
  mutableState.completedAt = some(now);
  mutableState.error = some(reason ?? 'Execution was cancelled');

  mutableState.eventSeq = state.eventSeq + 1n;
  const event: ExecutionEvent = variant('execution_cancelled', {
    seq: mutableState.eventSeq,
    timestamp: now,
    reason: reason !== undefined ? some(reason) : none,
  });
  (mutableState.events as ExecutionEvent[]).push(event);
  return event;
}

/**
 * Prepare the execution state for a yield checkpoint (or crash recovery).
 *
 * Resets all `in_progress` tasks to `pending` so the persisted state is
 * resumable: a resumed loop re-launches them via stepGetReady, and tasks
 * that actually finished in the meantime are served from the execution
 * cache. `deferred` tasks are also reset — deferral is a launch-time
 * decision and the version-vector conflict may have resolved since; the
 * consistency check at re-launch re-defers if it genuinely persists. So are
 * `waiting` tasks: the input one waits on may have been assigned since, and
 * a resumed loop decides each again, leaving it waiting if it still is.
 * The execution status stays 'running' — yield is a pause, not a
 * terminal state. A split task keeps its `plan`: a resumed loop takes its
 * stage up again, and finds the units that finished in the execution cache.
 *
 * @param state - Execution state to mutate
 * @returns Names of tasks that were reset to pending
 */
export function stepYield(state: DataflowExecutionState): { reset: string[] } {
  const reset: string[] = [];
  for (const [name, taskState] of state.tasks) {
    if (taskState.status === 'in_progress' || taskState.status === 'deferred' || taskState.status === 'waiting') {
      (taskState as Mutable<TaskState>).status = 'pending';
      reset.push(name);
    }
  }
  return { reset };
}

// =============================================================================
// Tree Update Step Function
// =============================================================================

/**
 * Apply a task's output to the workspace tree with version vector.
 *
 * Writes the output ref file with the merged version vector from the task's
 * inputs. Per-dataset ref writes are atomic and independent, so no
 * serialization is needed for concurrent writes to different paths.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param workspace - Workspace name
 * @param outputPathStr - Output path as a keypath string (e.g., ".results.data")
 * @param outputHash - Hash of the output dataset to write
 * @param versions - Merged version vector for provenance tracking
 * @returns Result indicating success
 */
export async function stepApplyTreeUpdate(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  outputPathStr: string,
  outputHash: string,
  versions: VersionVector
): Promise<TreeUpdateResult> {
  const { parsePathString } = await import('../dataflow.js');
  const outputPath = parsePathString(outputPathStr);

  // Write the output ref with version vector
  await workspaceSetDatasetByHash(
    storage,
    repo,
    workspace,
    outputPath,
    outputHash,
    versions
  );

  return { ok: true };
}
