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

import { decodeBeast2For, variant } from '@elaraai/east';
import {
  WorkspaceRecordType,
  pathToString,
  type TaskObject,
  type TreePath,
} from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, eachAtMost } from './concurrency.js';
import { taskInputRead } from './dataset-open.js';
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
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  DataflowError,
  TaskNotFoundError,
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
  /** External workspace lock to use. */
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
  /** Callback when a task is deferred due to inconsistent input versions */
  onTaskDeferred?: (taskName: string, conflictPath: string) => void;
  /** Callback when a task is left waiting on an input it cannot read — an
   *  unassigned one, or an index its record's state does not hold — and for
   *  each of its dependents, naming the inputs each waits on */
  onTaskWaiting?: (taskName: string, inputs: string[]) => void;
}

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
 * Find all tasks affected by input changes (transitive dependents).
 * An affected task is one whose output could change due to the input change.
 *
 * @param graph - The dependency graph
 * @param changes - Array of changed input paths
 * @returns Array of affected task names
 */
export function findAffectedTasks(
  graph: DataflowGraph,
  changes: Array<{ path: string }>,
): string[] {
  const changedPaths = new Set(changes.map(c => c.path));
  const affected = new Set<string>();
  const queue: string[] = [];

  // Build forward dep map: task name → tasks that depend on its output
  const taskToDependents = new Map<string, string[]>();
  for (const task of graph.tasks) {
    for (const dep of task.dependsOn) {
      if (!taskToDependents.has(dep)) taskToDependents.set(dep, []);
      taskToDependents.get(dep)!.push(task.name);
    }
  }

  // Seed: tasks that directly read a changed input
  for (const task of graph.tasks) {
    if (task.inputs.some(inp => changedPaths.has(inp))) {
      queue.push(task.name);
    }
  }

  // BFS through dependency graph
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (affected.has(name)) continue;
    affected.add(name);
    for (const dep of taskToDependents.get(name) ?? []) {
      queue.push(dep);
    }
  }

  return Array.from(affected);
}

/**
 * Get tasks that are ready to execute given the set of completed tasks.
 *
 * A task is ready when all tasks it depends on have completed.
 *
 * @param graph - The dependency graph from dataflowGetGraph
 * @param completedTasks - Set of task names that have completed
 * @returns Array of task names that are ready to execute
 */
export function dataflowGetReadyTasks(
  graph: DataflowGraph,
  completedTasks: Set<string>
): string[] {
  const ready: string[] = [];

  for (const task of graph.tasks) {
    if (completedTasks.has(task.name)) {
      continue;
    }

    const allDepsCompleted = task.dependsOn.every(dep => completedTasks.has(dep));
    if (allDepsCompleted) {
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
 * @param overlay - Values to read inputs by, in place of their refs: keypath
 *   to the dataset's object hash. What follows the value — an index read
 *   from a record's state — is read as it is for a ref's.
 * @returns Each input's object, in order; `null` for one the task cannot read
 *   now
 */
export async function dataflowResolveInputHashes(
  storage: StorageBackend,
  repo: string,
  ws: string,
  task: DataflowGraph['tasks'][0],
  overlay?: ReadonlyMap<string, string>,
): Promise<Array<string | null>> {
  const hashes: Array<string | null> = [];
  // Which index each input reads is the task object's, read once and then
  // from memory; the graph names each input by its dataset's path alone.
  const { inputs } = await taskObjectRead(storage, repo, task.hash);
  const held = new Map<string, string | null>();

  for (const [at, inputPathStr] of task.inputs.entries()) {
    let hash = held.get(inputPathStr);
    if (hash === undefined) {
      const given = overlay?.get(inputPathStr);
      if (given !== undefined) hash = given;
      else {
        const ref = await workspaceGetDatasetHash(storage, repo, ws, parsePathString(inputPathStr));
        hash = ref.refType === 'value' ? ref.hash : null;
      }
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
// Prediction
// =============================================================================

/**
 * What a run will take from its execution cache, worked out before it starts
 * ({@link dataflowPredict}).
 */
export interface DataflowPrediction {
  /** Tasks the cache answers, with the output and the execution it answers
   *  them with, in the graph's order */
  readonly answered: ReadonlyMap<string, { readonly outputHash: string; readonly executionId: string }>;
  /** Tasks the run will have to execute, in the graph's order */
  readonly unanswered: readonly string[];
  /** Tasks the run will leave waiting on an unassigned input, and their
   *  dependents, in the graph's order */
  readonly waiting: readonly string[];
}

/**
 * Predicts, before a run starts, which of its tasks the execution cache
 * answers, and with which output, and which it has to execute.
 *
 * @remarks
 * Visits the run's tasks (the whole graph, or a filter's dependency closure)
 * in dependency order, reading each task's inputs as the run will find them:
 * the output of each task above it that the cache answers, and the refs
 * otherwise. A task is decided as the run decides it:
 *
 * - **waiting** when an input is unassigned, or a task it depends on waits;
 * - **unanswered** when the run forces it, a task it depends on is
 *   unanswered, or the cache holds no success over its inputs;
 * - **answered** when the cache holds one, and the run will take it: either
 *   the task's output ref holds that success's output already, which the
 *   loop serves from its own cache check, or the latest attempt over those
 *   inputs is that success, which the runner's own probe serves
 *   (`probeExecutionCache`). A success followed by an attempt that did not
 *   succeed, with the output ref holding something else, is executed again.
 *
 * One difference with the run is allowed, and only in one direction: a task
 * below an unanswered one is predicted unanswered, though if the task above
 * recomputes the output it had, the run answers it from the cache. A task
 * predicted answered is never executed by a run started with the same
 * options over the same workspace.
 *
 * Reads refs and records; writes nothing.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param options - The run's force and filter, as a start is given them
 * @returns The prediction
 * @throws {TaskNotFoundError} When the filter, or a task forced, names no task
 * @throws {DataflowError} When the run forces a task its filter's run set
 *   leaves out
 */
export async function dataflowPredict(
  storage: StorageBackend,
  repo: string,
  ws: string,
  options: { readonly force?: boolean | readonly string[]; readonly filter?: string } = {},
): Promise<DataflowPrediction> {
  const graph = await dataflowGetGraph(storage, repo, ws);
  const filter = options.filter ?? null;
  if (filter !== null && !graph.tasks.some((task) => task.name === filter)) throw new TaskNotFoundError(filter);
  const runSet = filter === null ? null : dataflowGetDependencyClosure(graph, filter);
  const named = Array.isArray(options.force) ? options.force : null;
  for (const name of named ?? []) {
    if (!graph.tasks.some((task) => task.name === name)) throw new TaskNotFoundError(name);
    if (runSet !== null && !runSet.has(name)) {
      throw new DataflowError(`the run forces '${name}', which the filter '${filter}' leaves out: a filtered run runs '${filter}' and the tasks it depends on, and no other`);
    }
  }
  // As a run forces: every task, or the filter's target alone under a
  // filter; or the tasks named
  const forced = (name: string): boolean => named !== null ? named.includes(name)
    : options.force === true && (filter === null || name === filter);

  const tasks = graph.tasks.filter((task) => runSet === null || runSet.has(task.name));
  const byName = new Map(tasks.map((task) => [task.name, task]));
  const outputOf = new Map(tasks.map((task) => [task.name, task.output]));
  const decided = new Map<string, 'answered' | 'unanswered' | 'waiting'>();
  const answered = new Map<string, { outputHash: string; executionId: string }>();
  // Each decided task's output as the run will find it: an answered task's
  // output, and for an unanswered one a stand-in, as the run makes it. A
  // task's output is no record, so no index is read from a stand-in, and a
  // task reading one is unanswered before any hash of its inputs is used.
  const overlay = new Map<string, string>();
  const MADE_IN_THE_RUN = '0'.repeat(64);

  const decide = async (name: string): Promise<'answered' | 'unanswered' | 'waiting'> => {
    const task = byName.get(name)!;
    const above = task.dependsOn.filter((dep) => byName.has(dep)).map((dep) => decided.get(dep)!);
    if (above.includes('waiting')) return 'waiting';
    // An input no task of the run makes, unassigned: the task waits
    const inputs = await dataflowResolveInputHashes(storage, repo, ws, task, overlay);
    if (inputs.some((hash) => hash === null)) return 'waiting';
    if (above.includes('unanswered') || forced(name)) return 'unanswered';
    const inHash = inputsHash(inputs as string[]);
    const cached = await executionGetOutput(storage, repo, task.hash, inHash);
    if (cached === null) return 'unanswered';
    // The loop takes it from its own check when the output ref holds it; the
    // runner's probe otherwise, which serves only the latest attempt
    const output = await workspaceGetDatasetHash(storage, repo, ws, parsePathString(task.output));
    if (output.refType !== 'value' || output.hash !== cached.outputHash) {
      const latest = await storage.refs.executionGetLatest(repo, task.hash, inHash);
      if (latest?.type !== 'success' || latest.value.executionId !== cached.executionId) return 'unanswered';
    }
    answered.set(name, cached);
    overlay.set(outputOf.get(name)!, cached.outputHash);
    return 'answered';
  };

  // Dependency order: a task once every task of the run it depends on is decided
  let left = tasks.map((task) => task.name);
  while (left.length > 0) {
    const ready = left.filter((name) => byName.get(name)!.dependsOn.every((dep) => !byName.has(dep) || decided.has(dep)));
    if (ready.length === 0) throw new DataflowError(`the graph has a cycle among ${left.map((name) => `'${name}'`).join(', ')}`);
    for (const name of ready) {
      const decision = await decide(name);
      decided.set(name, decision);
      if (decision === 'unanswered') overlay.set(outputOf.get(name)!, MADE_IN_THE_RUN);
    }
    const done = new Set(ready);
    left = left.filter((name) => !done.has(name));
  }

  const inOrder = (kind: 'answered' | 'unanswered' | 'waiting'): string[] => tasks.map((task) => task.name).filter((name) => decided.get(name) === kind);
  return {
    answered: new Map(inOrder('answered').map((name) => [name, answered.get(name)!])),
    unanswered: inOrder('unanswered'),
    waiting: inOrder('waiting'),
  };
}
