/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Dataflow execution for e3 workspaces.
 *
 * Provides the shared graph-building utilities used by both local and cloud
 * execution paths, and the types of a dataflow's run. The high-level
 * `dataflowExecute` entry point, which runs the root entry's
 * `LocalOrchestrator` on this machine, is `execution/local-orchestrator.ts`'s.
 *
 * The reactive execution logic (input change detection, task invalidation,
 * version vector consistency) lives in `dataflow/steps.ts` and is orchestrated
 * by `dataflow/orchestrator/LocalOrchestrator.ts`.
 */

import { StringType, compareFor, decodeBeast2For, variant } from '@elaraai/east';
import {
  WorkspaceRecordType,
  decodeRecordCommit,
  decodeRecordObject,
  pathToString,
  type TaskObject,
  type TreePath,
  type VersionVector,
} from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, eachAtMost } from './concurrency.js';
import type { CatchUpRun, DataflowExecutionState, DeferReason } from './dataflow/types.js';
import { taskInputRead } from './dataset-open.js';
import { keypathToRefPath, madeAt, refPathToKeypath, sameVersion, versionRoots } from './dataset-refs.js';
import {
  executionGetOutput,
  inputsHash,
} from './executions.js';
import { packageObjectRead } from './packages.js';
import { taskObjectRead } from './tasks.js';
import type { TaskRunner } from './execution/interfaces.js';
import {
  workspaceGetDatasetHash,
} from './trees.js';
import {
  E3Error,
  ObjectNotFoundError,
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  DataflowError,
} from './errors.js';
import type { StorageBackend, LockHandle } from './storage/interfaces.js';

// =============================================================================
// Path Parsing Helper
// =============================================================================

/**
 * Parse a keypath string (from pathToString) back to TreePath.
 *
 * The keypath format is: .field1.field2 (dot-separated field names)
 * Quoted identifiers use backticks: .field1.`complex/name`
 *
 * @param pathStr - The path string in keypath format
 * @returns TreePath array of path segments
 */
export function parsePathString(pathStr: string): TreePath {
  if (!pathStr.startsWith('.')) {
    throw new Error(`Invalid path string: expected '.' prefix, got '${pathStr}'`);
  }

  const segments: TreePath = [];
  let i = 1; // Skip the leading '.'

  while (i < pathStr.length) {
    let fieldName: string;

    if (pathStr[i] === '`') {
      // Quoted identifier: find closing backtick
      const endQuote = pathStr.indexOf('`', i + 1);
      if (endQuote === -1) {
        throw new Error(`Invalid path string: unclosed backtick at position ${i}`);
      }
      fieldName = pathStr.slice(i + 1, endQuote);
      i = endQuote + 1;
    } else {
      // Unquoted identifier: read until '.' or end
      let end = pathStr.indexOf('.', i);
      if (end === -1) end = pathStr.length;
      fieldName = pathStr.slice(i, end);
      i = end;
    }

    if (fieldName) {
      segments.push(variant('field', fieldName));
    }

    // Skip the '.' separator
    if (i < pathStr.length && pathStr[i] === '.') {
      i++;
    }
  }

  return segments;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Information about a task in the dependency graph.
 */
interface TaskNode {
  /** Task name */
  name: string;
  /** Hash of the TaskObject in object store */
  hash: string;
  /** The decoded TaskObject */
  task: TaskObject;
  /** Input dataset paths */
  inputPaths: TreePath[];
  /** Output dataset path */
  outputPath: TreePath;
  /** Number of unresolved dependencies (inputs that are unassigned) */
  unresolvedCount: number;
}

/**
 * Result of executing a single task in the dataflow.
 */
export interface TaskExecutionResult {
  /** Task name */
  name: string;
  /** Whether the task was cached */
  cached: boolean;
  /** Execution ID (UUIDv7) - present for executed or cached tasks */
  executionId?: string;
  /** Final state — `cancelled` when e3 stopped the task because the run was
   *  aborted */
  state: 'success' | 'failed' | 'error' | 'skipped' | 'cancelled';
  /** Error message if state is 'error' */
  error?: string;
  /** Exit code if state is 'failed' */
  exitCode?: number;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Result of a dataflow execution.
 */
export interface DataflowResult {
  /** Overall success - true if all tasks completed successfully */
  success: boolean;
  /** Dataflow run ID (UUIDv7) */
  runId: string;
  /** Number of tasks executed (not from cache) */
  executed: number;
  /** Number of tasks served from cache */
  cached: number;
  /** Number of tasks that failed */
  failed: number;
  /** Number of tasks skipped due to upstream failure */
  skipped: number;
  /** Number of tasks left waiting on an input they cannot read — an
   *  unassigned one, or an index its record's state does not hold — and of
   *  their dependents, which the run went on without: they run once it can be
   *  read */
  waiting: number;
  /** Number of tasks re-executed due to input changes */
  reexecuted: number;
  /** Per-task results: the tasks that ran, were served from the cache,
   *  failed or were skipped; a task left waiting is in none */
  tasks: TaskExecutionResult[];
  /** Total duration in milliseconds */
  duration: number;
}

/**
 * Options for dataflow execution.
 */
export interface DataflowOptions {
  /** The tasks the run re-executes even where the cache holds their results:
   *  `true` for every task — under a filter, the filter's task — the names of
   *  the tasks, or `false` for none (default) */
  force?: boolean | readonly string[];
  /** One task's exact name: the run runs it and its dependency closure */
  filter?: string;
  /** External workspace lock to use: a shared hold of the workspace. Never
   *  one that takes the workspace whole (`acquireWorkspaceExclusive`): a run
   *  reads the workspace's intent whoever holds it, and stops itself for it. */
  lock?: LockHandle;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Task runner for executing individual tasks. */
  runner?: TaskRunner;
  /** The tasks and units the run keeps in flight (default four); a runner
   *  that holds a budget decides which of them spawn. */
  width?: number;
  /** Callback when a task starts */
  onTaskStart?: (name: string) => void;
  /** Callback when a task completes */
  onTaskComplete?: (result: TaskExecutionResult) => void;
  /** Callback for task stdout */
  onStdout?: (taskName: string, data: string) => void;
  /** Callback for task stderr */
  onStderr?: (taskName: string, data: string) => void;
  /** Callback when an input dataset changes during execution (reactive dataflow) */
  onInputChanged?: (path: string, previousHash: string, newHash: string) => void;
  /** Callback when a task is invalidated due to input change */
  onTaskInvalidated?: (taskName: string, reason: string) => void;
  /** Callback when a task is deferred because nothing says which version of
   *  an input it reads, with why: told once for each reason until the task
   *  next starts */
  onTaskDeferred?: (taskName: string, reason: DeferReason) => void;
  /** Callback as a catch-up run starts and as it lands: `task` run once at
   *  earlier versions of its inputs, for `forTask`, which reads its result
   *  there */
  onCatchUp?: (task: string, forTask: string, phase: CatchUpPhase) => void;
  /** Callback when a task is left waiting on an input it cannot read — an
   *  unassigned one, or an index its record's state does not hold — and for
   *  each of its dependents, naming the inputs each waits on */
  onTaskWaiting?: (taskName: string, inputs: string[]) => void;
}

/**
 * Where a catch-up run is, as the run's caller hears it: started, or landed
 * after `duration` milliseconds.
 */
export type CatchUpPhase = { state: 'started' } | { state: 'completed'; duration: number };

// =============================================================================
// Workspace State Reader
// =============================================================================

/**
 * Read workspace state.
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace has no package deployed
 */
async function readWorkspaceState(storage: StorageBackend, repo: string, ws: string) {
  const data = await storage.refs.workspaceRead(repo, ws);
  if (data === null) {
    throw new WorkspaceNotFoundError(ws);
  }
  const record = decodeBeast2For(WorkspaceRecordType)(data);
  if (record.type === 'none') {
    throw new WorkspaceNotDeployedError(ws);
  }
  return record.value;
}

// =============================================================================
// Dependency Graph Building
// =============================================================================

/**
 * Build the dependency graph for a workspace.
 */
async function buildDependencyGraph(
  storage: StorageBackend,
  repo: string,
  ws: string
): Promise<{
  taskNodes: Map<string, TaskNode>;
  outputToTask: Map<string, string>;
  taskDependents: Map<string, Set<string>>;
}> {
  const state = await readWorkspaceState(storage, repo, ws);

  // The package decoded once, and each task object read once, from memory
  // after; the task objects a few at a time.
  const pkgObject = await packageObjectRead(storage, repo, state.packageHash);
  const packaged = [...pkgObject.tasks];
  const tasks: TaskObject[] = new Array<TaskObject>(packaged.length);
  await eachAtMost(packaged.map((_, i) => i), OBJECT_CONCURRENCY, async (i) => {
    tasks[i] = await taskObjectRead(storage, repo, packaged[i]![1]);
  });

  const taskNodes = new Map<string, TaskNode>();
  const outputToTask = new Map<string, string>();

  packaged.forEach(([taskName, taskHash], i) => {
    const task = tasks[i]!;

    const outputPathStr = pathToString(task.output.path);
    outputToTask.set(outputPathStr, taskName);

    taskNodes.set(taskName, {
      name: taskName,
      hash: taskHash,
      task,
      inputPaths: task.inputs.map((input) => input.path),
      outputPath: task.output.path,
      unresolvedCount: 0,
    });
  });

  const taskDependents = new Map<string, Set<string>>();
  for (const taskName of taskNodes.keys()) {
    taskDependents.set(taskName, new Set());
  }

  for (const [taskName, node] of taskNodes) {
    for (const inputPath of node.inputPaths) {
      const inputPathStr = pathToString(inputPath);
      const producerTask = outputToTask.get(inputPathStr);

      if (producerTask) {
        taskDependents.get(producerTask)!.add(taskName);
        node.unresolvedCount++;
      } else {
        const { refType } = await workspaceGetDatasetHash(storage, repo, ws, inputPath);
        if (refType === 'unassigned') {
          node.unresolvedCount++;
        }
      }
    }
  }

  return { taskNodes, outputToTask, taskDependents };
}

// =============================================================================
// Graph Queries (shared between local and cloud execution)
// =============================================================================

/**
 * Get the dependency graph for a workspace (for visualization/debugging).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @returns Graph information
 *
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace has no package deployed
 * @throws {DataflowError} If graph building fails for other reasons
 */
export async function dataflowGetGraph(
  storage: StorageBackend,
  repo: string,
  ws: string
): Promise<{
  tasks: Array<{
    name: string;
    hash: string;
    inputs: string[];
    output: string;
    dependsOn: string[];
  }>;
}> {
  let taskNodes: Map<string, TaskNode>;
  let outputToTask: Map<string, string>;

  try {
    const graph = await buildDependencyGraph(storage, repo, ws);
    taskNodes = graph.taskNodes;
    outputToTask = graph.outputToTask;
  } catch (err) {
    if (err instanceof E3Error) throw err;
    throw new DataflowError(`Failed to build dependency graph: ${err instanceof Error ? err.message : err}`);
  }

  const tasks: Array<{
    name: string;
    hash: string;
    inputs: string[];
    output: string;
    dependsOn: string[];
  }> = [];

  for (const [taskName, node] of taskNodes) {
    const dependsOn: string[] = [];

    for (const inputPath of node.inputPaths) {
      const inputPathStr = pathToString(inputPath);
      const producerTask = outputToTask.get(inputPathStr);
      if (producerTask) {
        dependsOn.push(producerTask);
      }
    }

    tasks.push({
      name: taskName,
      hash: node.hash,
      inputs: node.inputPaths.map(pathToString),
      output: pathToString(node.outputPath),
      dependsOn,
    });
  }

  return { tasks };
}

// =============================================================================
// Graph Traversal Helpers (for distributed execution)
// =============================================================================

/**
 * Graph structure returned by dataflowGetGraph.
 */
export interface DataflowGraph {
  tasks: Array<{
    name: string;
    hash: string;
    inputs: string[];
    output: string;
    dependsOn: string[];
  }>;
}

/**
 * Get tasks that are ready to execute given the tasks that have completed and
 * those that hold a result.
 *
 * A task is ready when every task it depends on holds a result. A task due
 * again keeps its result while it runs again, so its dependents are ready on
 * the result it holds, and are due themselves once its next one lands.
 *
 * @param graph - The dependency graph from dataflowGetGraph
 * @param completedTasks - The tasks that have completed and are not due
 *   again: none of them is ready
 * @param resultTasks - The tasks that hold a result a dependent may read,
 *   completed or due again; the completed tasks, when omitted
 * @returns Array of task names that are ready to execute
 */
export function dataflowGetReadyTasks(
  graph: DataflowGraph,
  completedTasks: Set<string>,
  resultTasks: Set<string> = completedTasks,
): string[] {
  const ready: string[] = [];

  for (const task of graph.tasks) {
    if (completedTasks.has(task.name)) {
      continue;
    }

    if (task.dependsOn.every(dep => resultTasks.has(dep))) {
      ready.push(task.name);
    }
  }

  return ready;
}

/**
 * Get the dependency closure of a task: the task itself plus every task it
 * transitively depends on (its upstream producers).
 *
 * A `--filter <task>` run is scoped to this closure so the target's upstream
 * can run — resolving from cache — and make the target ready. Without it the
 * filtered target would wait forever on dependencies the filter excluded from
 * scheduling.
 *
 * @param graph - The dependency graph from dataflowGetGraph
 * @param target - Name of the task whose closure to compute
 * @returns Set of task names: the target plus all transitive dependencies
 */
export function dataflowGetDependencyClosure(
  graph: DataflowGraph,
  target: string
): Set<string> {
  const byName = new Map(graph.tasks.map(task => [task.name, task]));
  const closure = new Set<string>();
  const queue = [target];

  while (queue.length > 0) {
    const name = queue.shift()!;
    if (closure.has(name)) continue;
    closure.add(name);
    for (const dep of byName.get(name)?.dependsOn ?? []) {
      queue.push(dep);
    }
  }

  return closure;
}

/** Each graph's tasks by the output each writes, built once for the graph. */
const producersOf = new WeakMap<DataflowGraph, ReadonlyMap<string, DataflowGraph['tasks'][number]>>();

/**
 * Each task of a run's graph by the output it writes: what tells a task's
 * input that is another task's result from one that is a root.
 *
 * @remarks
 * Built once for a graph and kept with it, so a run that asks for it at every
 * decision — a task's commits, its inputs, the tasks left waiting with it —
 * builds it once, however many tasks land.
 *
 * @param graph - The run's graph
 * @returns Each task, by its output's keypath
 */
export function taskProducers(graph: DataflowGraph): ReadonlyMap<string, DataflowGraph['tasks'][number]> {
  let producers = producersOf.get(graph);
  if (producers === undefined) {
    producers = new Map(graph.tasks.map((task) => [task.output, task] as const));
    producersOf.set(graph, producers);
  }
  return producers;
}

/**
 * Check if a task execution is cached for the given inputs.
 *
 * @param storage - Storage backend
 * @param repo - Repository path
 * @param taskHash - Hash of the TaskObject
 * @param inputHashes - Array of input dataset hashes (in order)
 * @returns The output and the id of the execution the cache serves, or null
 *   if execution is needed
 */
export async function dataflowCheckCache(
  storage: StorageBackend,
  repo: string,
  taskHash: string,
  inputHashes: string[]
): Promise<{ outputHash: string; executionId: string } | null> {
  const inHash = inputsHash(inputHashes);
  return executionGetOutput(storage, repo, taskHash, inHash);
}

/**
 * Find tasks that should be skipped when a task fails.
 *
 * Returns all tasks that transitively depend on the failed task,
 * excluding already completed or already skipped tasks.
 *
 * @param graph - The dependency graph from dataflowGetGraph
 * @param failedTask - Name of the task that failed
 * @param completedTasks - Set of task names already completed
 * @param skippedTasks - Set of task names already skipped
 * @returns Array of task names that should be skipped
 */
export function dataflowGetDependentsToSkip(
  graph: DataflowGraph,
  failedTask: string,
  completedTasks: Set<string>,
  skippedTasks: Set<string>
): string[] {
  const dependents = new Map<string, string[]>();
  for (const task of graph.tasks) {
    dependents.set(task.name, []);
  }
  for (const task of graph.tasks) {
    for (const dep of task.dependsOn) {
      dependents.get(dep)?.push(task.name);
    }
  }

  const toSkip: string[] = [];
  const visited = new Set<string>();
  const queue = [failedTask];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const deps = dependents.get(current) ?? [];

    for (const dep of deps) {
      if (visited.has(dep)) continue;
      visited.add(dep);

      if (completedTasks.has(dep)) continue;

      if (skippedTasks.has(dep)) {
        queue.push(dep);
        continue;
      }

      toSkip.push(dep);
      queue.push(dep);
    }
  }

  return toSkip;
}

/**
 * Resolve input hashes for a task from current workspace state: the object
 * each input reads, which the task's execution is keyed by and its runner is
 * handed.
 *
 * @remarks
 * A dataset's object is the one its ref holds. An input that is an index of a
 * record ({@link TaskObject}'s `inputs`) reads the index's manifest, found in
 * the state the record's ref holds (`taskInputRead`): so a task that reads an
 * index is decided again whenever its record changes, and runs again when the
 * index it reads did, the execution cache serving it otherwise.
 *
 * Each dataset's ref is read once, however many of the task's inputs read it:
 * the inputs of one record — the record, and any of its indexes — are of one
 * state of it, so a body never meets an index entry for a row it reads
 * otherwise.
 *
 * An input the task cannot read now is `null`, whichever way: a dataset with
 * no value, or an index its record's state does not hold. The run leaves such
 * a task waiting and goes on without it, the gc's history keeps no execution
 * over its inputs, and its status says why it waits.
 *
 * @param storage - Storage backend
 * @param repo - Repository path
 * @param ws - Workspace name
 * @param task - Task info from the graph
 * @returns Each input's object, in order; `null` for one the task cannot read
 *   now
 */
export async function dataflowResolveInputHashes(
  storage: StorageBackend,
  repo: string,
  ws: string,
  task: DataflowGraph['tasks'][0]
): Promise<Array<string | null>> {
  const hashes: Array<string | null> = [];
  // Which index each input reads is the task object's, read once and then
  // from memory; the graph names each input by its dataset's path alone.
  const { inputs } = await taskObjectRead(storage, repo, task.hash);
  const held = new Map<string, string | null>();

  for (const [at, inputPathStr] of task.inputs.entries()) {
    let hash = held.get(inputPathStr);
    if (hash === undefined) {
      const ref = await workspaceGetDatasetHash(storage, repo, ws, parsePathString(inputPathStr));
      hash = ref.refType === 'value' ? ref.hash : null;
      held.set(inputPathStr, hash);
    }
    if (hash === null) {
      hashes.push(null);
      continue;
    }
    const index = inputs[at]?.index.type === 'some' ? inputs[at].index.value : null;
    // An index its record's state does not hold: the task waits, as its status says
    const read = await taskInputRead(storage, repo, inputPathStr, hash, index);
    hashes.push('object' in read ? read.object : null);
  }

  return hashes;
}

// =============================================================================
// What a run reads: its records' commits, and each input at them
// =============================================================================

/** The order of two versions as strings, for an answer that must only be the
 *  same each time. */
const compareVersions = compareFor(StringType);

/**
 * What a run keeps in memory of the roots it reads, by its state: nothing
 * stores it, and a run resumed in another process starts it again.
 */
interface RunRoots {
  /** The workspace's records, by keypath, read once for the run */
  records: Promise<ReadonlySet<string>> | null;
  /** Each root's versions the run took a snapshot of, by the number of the
   *  snapshot that first held it */
  taken: Map<string, Map<string, number>>;
  /** The next snapshot's number */
  next: number;
  /** The older of two commits of a record the run never took, by the record
   *  and the two */
  older: Map<string, Promise<string>>;
}

const runRoots = new WeakMap<DataflowExecutionState, RunRoots>();

/** Numbers a root's version, unless the run numbered it before. */
function numberVersion(roots: RunRoots, path: string, version: string): void {
  let taken = roots.taken.get(path);
  if (taken === undefined) {
    taken = new Map();
    roots.taken.set(path, taken);
  }
  if (!taken.has(version)) taken.set(version, roots.next++);
}

/** A run's memory of its roots, begun from the snapshot its state holds: the
 *  first the run took, or the last the run it resumes took. */
function rootsOf(state: DataflowExecutionState): RunRoots {
  let roots = runRoots.get(state);
  if (roots === undefined) {
    roots = { records: null, taken: new Map(), next: 0, older: new Map() };
    runRoots.set(state, roots);
    for (const [path, version] of state.inputSnapshot) numberVersion(roots, path, version);
  }
  return roots;
}

/**
 * Notes the snapshots the run takes of its roots in one look, in the order
 * the run takes them: what {@link recordCommitOrder} tells two commits of a
 * record apart by.
 *
 * @remarks
 * Called before the run's state takes the snapshots, so the ones they
 * replace are numbered before them where the run's memory begins here. A
 * look's snapshots are noted together, so what the run holds of older
 * versions is let go by one read of the run's state, however many roots the
 * look found changed.
 *
 * A run that follows people's edits takes a snapshot of every commit, for as
 * long as it lives, so each snapshot lets go of what the run's memory holds of
 * the versions older than every one it still names — its snapshots, and the
 * versions its results were made from. A version let go is older than every
 * version kept, which is what {@link recordCommitOrder} answers for one it
 * holds no number of, and two let go are ordered by the record's history, as
 * two the run never took are: a result made at one — a task's in flight,
 * which lands with the versions it was launched at — is ordered as before.
 * The order of two commits the run never took is let go once either is
 * named no more.
 *
 * @param state - The run's state
 * @param taken - Each root's keypath, and its version in the snapshot: a
 *   record's commit
 * @internal
 */
export function dataflowSnapshotTaken(
  state: DataflowExecutionState,
  taken: ReadonlyArray<{ readonly path: string; readonly version: string }>,
): void {
  if (taken.length === 0) return;
  const roots = rootsOf(state);
  for (const each of taken) numberVersion(roots, each.path, each.version);
  letGoVersions(state, roots);
}

/** Lets go of the versions older than every one the run's state names, and of
 *  the order of each pair of commits it never took that it names no more. */
function letGoVersions(state: DataflowExecutionState, roots: RunRoots): void {
  const named = new Map<string, Set<string>>();
  const name = (root: string, version: string): void => {
    let versions = named.get(root);
    if (versions === undefined) {
      versions = new Set();
      named.set(root, versions);
    }
    versions.add(version);
  };
  for (const [root, version] of state.inputSnapshot) name(root, version);
  for (const vector of state.versionVectors.values()) {
    for (const [root, version] of versionRoots(vector)) name(root, version);
  }
  for (const [root, taken] of roots.taken) {
    let least: number | undefined;
    for (const version of named.get(root) ?? []) {
      const number = taken.get(version);
      if (number !== undefined && (least === undefined || number < least)) least = number;
    }
    if (least === undefined) continue;
    for (const [version, number] of [...taken]) {
      if (number < least) taken.delete(version);
    }
  }
  for (const key of [...roots.older.keys()]) {
    const [record, first, second] = key.split('\n') as [string, string, string];
    const versions = named.get(record);
    if (versions === undefined || !versions.has(first) || !versions.has(second)) roots.older.delete(key);
  }
}

/**
 * What a run's memory holds of its roots: the versions its snapshots
 * numbered, and the orders of pairs of commits it never took.
 *
 * @param state - The run's state
 * @returns How many of each it holds
 * @internal
 */
export function dataflowRootsHeld(state: DataflowExecutionState): { versions: number; pairs: number } {
  const roots = runRoots.get(state);
  if (roots === undefined) return { versions: 0, pairs: 0 };
  let versions = 0;
  for (const taken of roots.taken.values()) versions += taken.size;
  return { versions, pairs: roots.older.size };
}

/**
 * The records among a run's roots, by keypath: the datasets whose versions
 * are commits, each read at any of them from the record's history.
 *
 * @remarks
 * Read from the workspace's deployed package once for the run, which a deploy
 * ends.
 *
 * @param storage - Storage backend
 * @param state - The run's state
 * @returns The records' keypaths (`.records.orders`)
 */
export function dataflowRecords(storage: StorageBackend, state: DataflowExecutionState): Promise<ReadonlySet<string>> {
  const roots = rootsOf(state);
  roots.records ??= (async () => {
    const deployed = await readWorkspaceState(storage, state.repo, state.workspace);
    const pkg = await packageObjectRead(storage, state.repo, deployed.packageHash);
    const records = new Set<string>();
    await eachAtMost([...pkg.records.values()], OBJECT_CONCURRENCY, async (hash) => {
      records.add(refPathToKeypath(decodeRecordObject(await storage.objects.read(state.repo, hash)).path));
    });
    return records;
  })();
  // A read that failed is made again by the next to ask
  roots.records.catch(() => { roots.records = null; });
  return roots.records;
}

/**
 * Which of two commits of a record is the older.
 *
 * @remarks
 * The run numbers each snapshot of a record it takes, so two commits it took
 * compare by number. A commit it never took — one a result named before the
 * run resumed — or one it let go ({@link dataflowSnapshotTaken}) is older than
 * the first snapshot it holds. Two such are ordered by
 * walking back from that snapshot a parent at a time: the first of the two
 * met is the newer, and one never met, which a compaction cut from the
 * record's history, is the older. The history ends at a commit the store no
 * longer holds. The run keeps each answer, and asks again after a walk that
 * failed.
 *
 * @param storage - Storage backend
 * @param state - The run's state
 * @param record - The record's keypath
 * @param a - A commit of the record
 * @param b - Another
 * @returns The older of the two
 * @throws {Error} When a commit of the record's history cannot be read,
 *   other than one the store no longer holds
 */
export async function recordCommitOrder(
  storage: StorageBackend,
  state: DataflowExecutionState,
  record: string,
  a: string,
  b: string,
): Promise<string> {
  if (sameVersion(a, b)) return a;
  const roots = rootsOf(state);
  const taken = roots.taken.get(record);
  const takenA = taken?.get(a);
  const takenB = taken?.get(b);
  if (takenA !== undefined && takenB !== undefined) return takenA < takenB ? a : b;
  if (takenA !== undefined) return b;
  if (takenB !== undefined) return a;

  const [first, second] = compareVersions(a, b) < 0 ? [a, b] : [b, a];
  const key = `${record}\n${first}\n${second}`;
  const kept = roots.older.get(key);
  if (kept !== undefined) return kept;
  const older = (async () => {
    // The run's first snapshot of the record is the commit it numbered first
    let at: string | null = taken === undefined ? null : [...taken].reduce((least, each) => (each[1] < least[1] ? each : least))[0];
    while (at !== null) {
      if (sameVersion(at, first)) return second;
      if (sameVersion(at, second)) return first;
      let parent: string | null;
      try {
        const commit = decodeRecordCommit(await storage.objects.read(state.repo, at));
        parent = commit.parent.type === 'some' ? commit.parent.value : null;
      } catch (err) {
        // The history ends at a commit the store no longer holds: a
        // compaction cut what came before. A read that failed any other way
        // is no end of it, and an order taken from it would be a guess.
        if (!(err instanceof ObjectNotFoundError)) throw err;
        parent = null;
      }
      at = parent;
    }
    // Neither is in the record's history: either answer, the same each time
    return first;
  })();
  roots.older.set(key, older);
  // A walk that failed is made again by the next to ask
  older.catch(() => {
    if (roots.older.get(key) === older) roots.older.delete(key);
  });
  return older;
}

/**
 * A task's inputs at the versions it reads: each input's object, the inputs
 * it cannot read, or the catch-up runs that make what is missing.
 */
export type ResolvedInputs =
  /** Every input is at hand: each one's object, in the task's input order */
  | { readonly kind: 'resolved'; readonly hashes: string[] }
  /** Inputs the task cannot read, as keypaths in its input order: one with
   *  no value, or an index its record's state does not hold */
  | { readonly kind: 'unassigned'; readonly inputs: string[] }
  /** A result the task reads is not at hand at its versions: the catch-up
   *  runs that make it, those whose own inputs are at hand, the deepest
   *  first */
  | { readonly kind: 'behind'; readonly runs: CatchUpRun[] };

/** What {@link dataflowResolveInputs} is told of the run it resolves for. */
export interface ResolveInputsOptions {
  /** The output of a catch-up run the run holds, by its task and its inputs'
   *  hash; `undefined` when it holds none */
  landed?: (task: string, inputsHash: string) => string | undefined;
  /** Whether the run forces a task, whose result at earlier versions the
   *  execution cache is then not asked for */
  forced?: (task: string) => boolean;
}

/** One input of a task, or one task's result, as read at a set of versions. */
type ReadAt = { readonly kind: 'object'; readonly hash: string } | { readonly kind: 'unassigned' } | { readonly kind: 'behind' };

/**
 * Resolve a task's inputs at the versions it reads: the object each input
 * reads, which the task's execution is keyed by and its runner is handed.
 *
 * @remarks
 * A task that reads several results reads them all as of one version of each
 * root (`stepTaskCommits`), so it never computes on a mix:
 *
 * - a root at its version: a record's state at that commit, from the record's
 *   history where its head has moved on, and a plain input's value, whose
 *   version is its hash;
 * - a task's output, the first of these that holds: its last result, when
 *   that was made from these versions; the output of a catch-up run the run
 *   holds; the execution cache, asked for that task's execution over its own
 *   inputs resolved at the same versions; and otherwise a catch-up run, that
 *   task run once over those inputs.
 *
 * An input that is an index of a record (a `TaskObject`'s `inputs`) reads the
 * index's manifest in the state the record's commit holds (`taskInputRead`),
 * and each root is read once, however many inputs read it: the inputs of one
 * record — the record, and any of its indexes — are of one state of it. So a
 * task that reads an index is decided again whenever its record's commit
 * moves, and the execution cache answers it when the index it reads did not.
 *
 * @param storage - Storage backend
 * @param state - The run's state
 * @param task - The task, from the run's graph
 * @param versions - The version of each root the task reads
 * @param options - The catch-up runs the run holds, and the tasks it forces
 * @returns Each input's object; or the inputs the task cannot read now; or
 *   the catch-up runs that make what is missing
 */
export async function dataflowResolveInputs(
  storage: StorageBackend,
  state: DataflowExecutionState,
  task: DataflowGraph['tasks'][0],
  versions: VersionVector,
  options: ResolveInputsOptions = {},
): Promise<ResolvedInputs> {
  const { repo, workspace } = state;
  const graph = state.graph.type === 'some' ? state.graph.value : null;
  if (graph === null) throw new DataflowError('Execution state has no graph');
  const producerOf = taskProducers(graph);
  const roots = new Map<string, Promise<string | null>>();
  const outputs = new Map<string, Promise<ReadAt>>();
  const runs = new Map<string, CatchUpRun>();

  // A root's dataset object at its version; null for one with no value
  const rootAt = (path: string): Promise<string | null> => {
    let read = roots.get(path);
    if (read === undefined) {
      read = (async () => {
        const wanted = versions.get(path);
        if (wanted === undefined) return null;
        const ref = await storage.datasets.read(repo, workspace, keypathToRefPath(path));
        if (ref !== null && ref.type === 'value' && sameVersion(ref.value.versions.get(path) ?? ref.value.hash, wanted)) {
          return ref.value.hash;
        }
        // It has moved on since the run's snapshot: a record's commit is
        // read from its history, and a plain input's version is its value
        if ((await dataflowRecords(storage, state)).has(path)) {
          return decodeRecordCommit(await storage.objects.read(repo, wanted)).state;
        }
        return wanted;
      })();
      roots.set(path, read);
    }
    return read;
  };

  // Each input of a task at the versions, in its input order
  const inputsAt = async (of: DataflowGraph['tasks'][0]): Promise<ReadAt[]> => {
    // Which index each input reads is the task object's, read once and then
    // from memory; the graph names each input by its dataset's path alone.
    const { inputs } = await taskObjectRead(storage, repo, of.hash);
    const read: ReadAt[] = [];
    for (const [at, path] of of.inputs.entries()) {
      const producer = producerOf.get(path);
      if (producer !== undefined) {
        read.push(await outputAt(producer));
        continue;
      }
      const hash = await rootAt(path);
      if (hash === null) {
        read.push({ kind: 'unassigned' });
        continue;
      }
      const index = inputs[at]?.index.type === 'some' ? inputs[at].index.value : null;
      // An index its record's state does not hold: the task waits, as its status says
      const object = await taskInputRead(storage, repo, path, hash, index);
      read.push('object' in object ? { kind: 'object', hash: object.object } : { kind: 'unassigned' });
    }
    return read;
  };

  // A task's result at the versions
  const outputAt = (of: DataflowGraph['tasks'][0]): Promise<ReadAt> => {
    let read = outputs.get(of.name);
    if (read === undefined) {
      read = (async (): Promise<ReadAt> => {
        const made = state.versionVectors.get(of.output);
        const result = state.tasks.get(of.name)?.outputHash;
        // The task holds no result in the run: its reader is not ready
        if (made === undefined || result === undefined || result.type !== 'some') return { kind: 'unassigned' };
        if (madeAt(made, versions)) return { kind: 'object', hash: result.value };
        const inputs = await inputsAt(of);
        if (inputs.some((input) => input.kind === 'unassigned')) return { kind: 'unassigned' };
        if (inputs.some((input) => input.kind === 'behind')) return { kind: 'behind' };
        const inputHashes = inputs.map((input) => (input as { hash: string }).hash);
        const inHash = inputsHash(inputHashes);
        const landed = options.landed?.(of.name, inHash);
        if (landed !== undefined) return { kind: 'object', hash: landed };
        if (options.forced?.(of.name) !== true) {
          const cached = await dataflowCheckCache(storage, repo, of.hash, inputHashes);
          if (cached !== null) return { kind: 'object', hash: cached.outputHash };
        }
        const at = new Map<string, string>();
        for (const [root] of versionRoots(made)) {
          const wanted = versions.get(root);
          if (wanted !== undefined) at.set(root, wanted);
        }
        runs.set(`${of.name}@${inHash}`, { task: of.name, taskHash: of.hash, inputHashes, inputsHash: inHash, versions: at });
        return { kind: 'behind' };
      })();
      outputs.set(of.name, read);
    }
    return read;
  };

  const inputs = await inputsAt(task);
  const unassigned = task.inputs.filter((_, at) => inputs[at]!.kind === 'unassigned');
  if (unassigned.length > 0) return { kind: 'unassigned', inputs: unassigned };
  if (inputs.some((input) => input.kind === 'behind')) return { kind: 'behind', runs: [...runs.values()] };
  return { kind: 'resolved', hashes: inputs.map((input) => (input as { hash: string }).hash) };
}
