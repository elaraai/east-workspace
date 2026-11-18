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

import { StringType, compareFor, decodeBeast2For, equalFor, none, parseFor, some, variant } from '@elaraai/east';
import {
  VersionVectorType,
  WorkspaceRecordType,
  decodeRecordCommit,
  decodeRecordLoadObject,
  decodeRecordObject,
  loadNodeName,
  loadStepProblem,
  pathToString,
  type DataflowGraph,
  type DataflowLoad,
  type PackageObject,
  type TaskObject,
  type TreePath,
  type VersionVector,
} from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, eachAtMost } from './concurrency.js';
import type { CatchUpRun, DataflowExecutionState, DeferReason, InputWait } from './dataflow/types.js';
import { keypathToRefPath, madeAt, refPathToKeypath, sameVersion, versionRoots, type RootRead } from './dataset-refs.js';
import {
  executionGetOutput,
  inputsHash,
} from './executions.js';
import { taskInputRead, type InputHeld } from './input-read.js';
import { packageObjectRead } from './packages.js';
import { EXTERNAL_SLOT, pendingSources, slotNames, sourceLoadSlots } from './record-slots.js';
import { recordPendingAt } from './records.js';
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
 * A node of the dependency graph: a task of the package, or the load of a
 * composite record's fed source.
 */
interface GraphNode {
  /** The task's name, or the load's `<record>.<source>` */
  readonly name: string;
  /** Hash of its task object: the load's own, for a load */
  readonly hash: string;
  /** Input dataset paths: a load's feed alone */
  readonly inputPaths: readonly TreePath[];
  /** Output dataset path: a load's record */
  readonly outputPath: TreePath;
  /** The record and source a load loads; undefined for a task */
  readonly load?: DataflowLoad;
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
   *  unassigned one, an index its record's state does not hold, or a composite
   *  record that waits for an external source's first delivery — and of their
   *  dependents, which the run went on without: they run once it can be read */
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
   *  unassigned one, an index its record's state does not hold, or a
   *  composite record that waits for an external source's first delivery —
   *  and for each of its dependents, naming the inputs each waits on, with
   *  why */
  onTaskWaiting?: (taskName: string, waits: InputWait[]) => void;
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
 * Build the dependency graph for a workspace: a node for each task of its
 * package, and after them one for each fed source of its composite records,
 * the source's load.
 *
 * @remarks
 * A load node reads its feed and writes its record, and the record stays a
 * root of the run: no node depends on a load node, and `outputToTask` names
 * none. A load named as a task is, and a cycle through a load — what feeds it
 * reading its record — are refused as the SDK refuses them
 * ({@link loadStepProblem}), for a package built otherwise.
 *
 * @throws {DataflowError} Naming the task that has a load's name, or the
 *   cycle's steps
 */
async function buildDependencyGraph(
  storage: StorageBackend,
  repo: string,
  ws: string
): Promise<{
  nodes: Map<string, GraphNode>;
  outputToTask: Map<string, string>;
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

  const nodes = new Map<string, GraphNode>();
  const outputToTask = new Map<string, string>();

  packaged.forEach(([taskName, taskHash], i) => {
    const task = tasks[i]!;
    outputToTask.set(pathToString(task.output.path), taskName);
    nodes.set(taskName, {
      name: taskName,
      hash: taskHash,
      inputPaths: task.inputs.map((input) => input.path),
      outputPath: task.output.path,
    });
  });

  const loads = await loadNodesOf(storage, repo, pkgObject);
  const problem = loadStepProblem([...nodes.values(), ...loads].map((node) => ({
    inputs: node.inputPaths.map(pathToString),
    output: pathToString(node.outputPath),
    ...(node.load === undefined ? { task: node.name } : { load: node.load }),
  })));
  if (problem !== null) throw new DataflowError(problem);
  for (const node of loads) nodes.set(node.name, node);

  return { nodes, outputToTask };
}

/**
 * The task objects of a package's load nodes: what a workspace's executions
 * name beside its package's tasks.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param pkg - The package
 * @returns The hash of each fed source's load task
 * @internal
 */
export async function packageLoadTasks(storage: StorageBackend, repo: string, pkg: PackageObject): Promise<Set<string>> {
  return new Set((await loadNodesOf(storage, repo, pkg)).map((node) => node.hash));
}

/**
 * What feeds a package's loads: each fed source's feed, by its ref path, to
 * the loads it feeds, `<record>.<source>`, joined with commas where it feeds
 * several. A deploy reads its inputs' entries (`planInputDeployments`).
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param pkg - The package
 * @returns The loads each feed feeds, by the feed's ref path (`inputs/erp_extract`)
 * @internal
 */
export async function packageLoadFeeds(storage: StorageBackend, repo: string, pkg: PackageObject): Promise<Map<string, string>> {
  const feeds = new Map<string, string>();
  for (const node of await loadNodesOf(storage, repo, pkg)) {
    const feed = keypathToRefPath(pathToString(node.inputPaths[0]!));
    const fed = feeds.get(feed);
    feeds.set(feed, fed === undefined ? node.name : `${fed}, ${node.name}`);
  }
  return feeds;
}

/**
 * The load nodes of a package: one for each fed source of each of its
 * composite records, in the order of the records' names and then the
 * sources'. A source `e3 load` delivers has none.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param pkg - The deployed package
 * @returns The nodes, each reading its feed and writing its record
 */
async function loadNodesOf(storage: StorageBackend, repo: string, pkg: PackageObject): Promise<GraphNode[]> {
  const records = [...pkg.records];
  const fed: GraphNode[][] = new Array<GraphNode[]>(records.length);
  await eachAtMost(records.map((_, i) => i), OBJECT_CONCURRENCY, async (i) => {
    const [record, hash] = records[i]!;
    const object = decodeRecordObject(await storage.objects.read(repo, hash));
    const outputPath = parsePathString(refPathToKeypath(object.path));
    const nodes: GraphNode[] = [];
    for (const [source, writer] of object.sources) {
      if (writer.type !== 'load') continue;
      const load = decodeRecordLoadObject(await storage.objects.read(repo, writer.value));
      if (load.feed.type === 'none') continue;
      nodes.push({ name: loadNodeName(record, source), hash: load.task, inputPaths: [load.feed.value], outputPath, load: { record, source } });
    }
    fed[i] = nodes;
  });
  return fed.flat();
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
): Promise<DataflowGraph> {
  let nodes: Map<string, GraphNode>;
  let outputToTask: Map<string, string>;

  try {
    const graph = await buildDependencyGraph(storage, repo, ws);
    nodes = graph.nodes;
    outputToTask = graph.outputToTask;
  } catch (err) {
    if (err instanceof E3Error) throw err;
    throw new DataflowError(`Failed to build dependency graph: ${err instanceof Error ? err.message : err}`);
  }

  const tasks: DataflowGraph['tasks'] = [];

  for (const [name, node] of nodes) {
    // The tasks that write what it reads: a load node's feed's, when a task writes it. No load writes what a node
    // depends on, so the record a load writes stays a root.
    const dependsOn: string[] = [];
    for (const inputPath of node.inputPaths) {
      const producerTask = outputToTask.get(pathToString(inputPath));
      if (producerTask) dependsOn.push(producerTask);
    }

    tasks.push({
      name,
      hash: node.hash,
      inputs: node.inputPaths.map(pathToString),
      output: pathToString(node.outputPath),
      dependsOn,
      load: node.load === undefined ? none : some(node.load),
    });
  }

  return { tasks };
}

// =============================================================================
// Graph Traversal Helpers (for distributed execution)
// =============================================================================

/**
 * Graph structure returned by dataflowGetGraph: a run's graph, as its state
 * stores it (e3-types' `DataflowGraphType`).
 */
export type { DataflowGraph };

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
 * builds it once, however many tasks land. A load node is not among them: the
 * record it writes stays a root.
 *
 * @param graph - The run's graph
 * @returns Each task, by its output's keypath
 */
export function taskProducers(graph: DataflowGraph): ReadonlyMap<string, DataflowGraph['tasks'][number]> {
  let producers = producersOf.get(graph);
  if (producers === undefined) {
    producers = new Map(graph.tasks.filter((task) => task.load.type === 'none').map((task) => [task.output, task] as const));
    producersOf.set(graph, producers);
  }
  return producers;
}

/** Each graph's load nodes by the record each writes, built once for the graph. */
const loadNodesByRecord = new WeakMap<DataflowGraph, ReadonlyMap<string, readonly DataflowGraph['tasks'][number][]>>();

/**
 * The load nodes of a run's graph by the record each loads: what a task that
 * reads a record waits on while one of them waits, and what the record
 * carries of the roots their feeds read ({@link dataflowCarried}). No node
 * depends on a load node.
 *
 * @remarks
 * Built once for a graph and kept with it, as {@link taskProducers} is.
 *
 * @param graph - The run's graph
 * @returns Each record's load nodes, by the record's keypath (`.records.orders`); a record no load writes is not in it
 */
export function loadsOf(graph: DataflowGraph): ReadonlyMap<string, readonly DataflowGraph['tasks'][number][]> {
  let loads = loadNodesByRecord.get(graph);
  if (loads === undefined) {
    const byRecord = new Map<string, DataflowGraph['tasks'][number][]>();
    for (const task of graph.tasks) {
      if (task.load.type === 'some') byRecord.set(task.output, [...(byRecord.get(task.output) ?? []), task]);
    }
    loads = byRecord;
    loadNodesByRecord.set(graph, loads);
  }
  return loads;
}

/** What a run asks of its graph's shape at every decision, built once for the graph. */
interface GraphShape {
  readonly byName: ReadonlyMap<string, DataflowGraph['tasks'][number]>;
  readonly dependents: ReadonlyMap<string, readonly DataflowGraph['tasks'][number][]>;
  readonly readers: ReadonlyMap<string, readonly DataflowGraph['tasks'][number][]>;
}

const shapes = new WeakMap<DataflowGraph, GraphShape>();

/** A graph's shape, built in one pass over its nodes and kept with it. */
function shapeOf(graph: DataflowGraph): GraphShape {
  let shape = shapes.get(graph);
  if (shape === undefined) {
    const byName = new Map<string, DataflowGraph['tasks'][number]>();
    const dependents = new Map<string, DataflowGraph['tasks'][number][]>();
    const readers = new Map<string, DataflowGraph['tasks'][number][]>();
    const listed = (lists: Map<string, DataflowGraph['tasks'][number][]>, key: string, node: DataflowGraph['tasks'][number]): void => {
      const list = lists.get(key);
      if (list === undefined) lists.set(key, [node]);
      else list.push(node);
    };
    for (const node of graph.tasks) {
      byName.set(node.name, node);
      for (const dependency of new Set(node.dependsOn)) listed(dependents, dependency, node);
      for (const input of new Set(node.inputs)) listed(readers, input, node);
    }
    shape = { byName, dependents, readers };
    shapes.set(graph, shape);
  }
  return shape;
}

/**
 * The nodes of a run's graph by name: its tasks and its load nodes.
 *
 * @remarks
 * Built once for a graph and kept with it, as {@link taskProducers} is: a run
 * asks for a node by its name for every node it prepares and every unit it
 * launches.
 *
 * @param graph - The run's graph
 * @returns Each node, by its name
 */
export function graphNodes(graph: DataflowGraph): ReadonlyMap<string, DataflowGraph['tasks'][number]> {
  return shapeOf(graph).byName;
}

/**
 * The nodes of a run's graph that depend on each task: what cannot run while
 * the task has not, and is decided again as it settles.
 *
 * @remarks
 * Built once for a graph and kept with it, as {@link taskProducers} is.
 *
 * @param graph - The run's graph
 * @returns The nodes naming each task in their `dependsOn`, by the task's
 *   name, in the graph's order; a task nothing depends on is not in it
 */
export function taskDependents(graph: DataflowGraph): ReadonlyMap<string, readonly DataflowGraph['tasks'][number][]> {
  return shapeOf(graph).dependents;
}

/**
 * The nodes of a run's graph that read each dataset directly: a record's
 * readers, which wait while its load waits and are decided again as it
 * settles.
 *
 * @remarks
 * Built once for a graph and kept with it, as {@link taskProducers} is.
 *
 * @param graph - The run's graph
 * @returns The nodes naming each dataset among their inputs, by the dataset's
 *   keypath, in the graph's order; a dataset nothing reads is not in it
 */
export function datasetReaders(graph: DataflowGraph): ReadonlyMap<string, readonly DataflowGraph['tasks'][number][]> {
  return shapeOf(graph).readers;
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
 * no value, a composite record that waits for an external source's first
 * delivery, or an index its record's state does not hold (`taskInputRead`).
 * The run leaves such a task waiting and goes on without it, the gc's history
 * keeps no execution over its inputs, and its status says why it waits.
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
  const held = new Map<string, InputHeld | null>();

  for (const [at, inputPathStr] of task.inputs.entries()) {
    let ref = held.get(inputPathStr);
    if (ref === undefined) {
      const { hash, versions } = await workspaceGetDatasetHash(storage, repo, ws, parsePathString(inputPathStr));
      ref = hash === null || versions === null ? null : { hash, pending: pendingSources(versions) };
      held.set(inputPathStr, ref);
    }
    if (ref === null) {
      hashes.push(null);
      continue;
    }
    const index = inputs[at]?.index.type === 'some' ? inputs[at].index.value : null;
    // A record that waits for a first delivery, or an index its state does not hold: the task waits, as its status says
    const read = await taskInputRead(storage, repo, inputPathStr, ref, index);
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
  /** The commits of each record the store was found to hold no more, as a
   *  task was launched: the store is not asked for one again */
  gone: Map<string, Set<string>>;
  /** What each root's ref held at a version a look of the run took, by the
   *  root and the version: its hash, and its version vector, whose slots say
   *  what a composite record waited for and what its loads read */
  looked: Map<string, Map<string, RootRead>>;
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
    roots = { records: null, taken: new Map(), next: 0, older: new Map(), gone: new Map(), looked: new Map() };
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

/**
 * Notes what a look of the run read of each root's ref, at the version of it
 * the run's snapshot now holds: its hash and its version vector, whose slots
 * say what a composite record waited for and what its loads read.
 *
 * @remarks
 * A run reads a record at a version it took, which the record's ref may have
 * moved on from by the time a task reads it: a source may have delivered for
 * the first time since, or loaded again. So the record is judged at that
 * version, as the look that took it read it: whether it waits
 * ({@link dataflowResolveInputs}), and what it carries of the roots its loads'
 * feeds read ({@link dataflowCarried}). No task reads the record as it stood
 * before a source first delivered, and the record's readers run once the run
 * looks again and takes the delivery in. Called after each look, once the
 * run's state holds what it took.
 *
 * @param state - The run's state, holding the look's snapshot
 * @param looked - What each root's ref held at the version the look read, by
 *   its keypath
 * @internal
 */
export function dataflowSnapshotLooked(state: DataflowExecutionState, looked: ReadonlyMap<string, RootRead>): void {
  const roots = rootsOf(state);
  for (const [path, version] of state.inputSnapshot) {
    const read = looked.get(path);
    if (read === undefined) continue;
    let at = roots.looked.get(path);
    if (at === undefined) {
      at = new Map();
      roots.looked.set(path, at);
    }
    at.set(version, read);
  }
}

/** What a root's ref held at a version of it, as the look of the run that
 *  took that version read it; `undefined` for a version no look of the run
 *  read, such as one a result made before the run names. */
function lookedAt(state: DataflowExecutionState, path: string, version: string): RootRead | undefined {
  return runRoots.get(state)?.looked.get(path)?.get(version);
}

/** What a root waited for at a version of it, as the look of the run that
 *  took that version read it ({@link lookedAt}): the external sources a
 *  composite record waited for, and none for any other root. */
function waitedAt(state: DataflowExecutionState, path: string, version: string): readonly string[] | undefined {
  const read = lookedAt(state, path, version);
  return read === undefined ? undefined : pendingSources(read.versions);
}

/** The version a fed record carries of a root its feed reads when nothing
 *  says which version its delivery was made from: a rollback, a restore or a
 *  migration made it forget the delivery. */
export const UNKNOWN_VERSION = '$unknown';

/** What one source the dataflow loads carries, at a version of its record. */
export interface CarriedFeed {
  /** The source, by name */
  readonly source: string;
  /** The version of each root its feed reads that the record's delivery was
   *  made from: {@link UNKNOWN_VERSION} for each, where nothing says */
  readonly versions: VersionVector;
}

/** Whether two objects, or two names, are one. */
const sameText = equalFor(StringType);

/** Reads a version vector as a `.feed` slot holds it: as East prints it. */
const parseVersionVector = parseFor(VersionVectorType);

/**
 * What a fed record carries at a version of it a look of the run read: for
 * each of its sources the dataflow loads, the version vector of the feed its
 * delivery was made from.
 *
 * @remarks
 * - **The slot.** `$load.<source>.feed`, as the look that took the version
 *   read the record's ref, read through East.
 * - **The feed in the run.** When the feed's output in the run is the
 *   source's delivery (`$load.<source>`), the feed's vector in the run
 *   instead: the same value, from versions of its roots at least as new, so a
 *   feed whose roots moved without changing the delivery leaves the record's
 *   readers reading them as they are now.
 * - **A forgotten delivery.** A source the record holds no delivery of — a
 *   rollback, a restore or a migration made it forget it — carries
 *   {@link UNKNOWN_VERSION} for each root its feed reads, through the graph;
 *   and so does one whose slot says nothing of its feed.
 * - **A source yet to deliver** carries nothing: the record's readers wait.
 *
 * A version no look of the run read carries nothing.
 *
 * @param state - The run's state
 * @param record - The record's keypath
 * @param version - Its version: a commit a look of the run took
 * @returns What each of its fed sources carries, in the graph's order
 * @internal
 */
export function dataflowCarried(state: DataflowExecutionState, record: string, version: string): CarriedFeed[] {
  const graph = state.graph.type === 'some' ? state.graph.value : null;
  const read = lookedAt(state, record, version);
  if (graph === null || read === undefined) return [];
  const waits = pendingSources(read.versions);
  const carried: CarriedFeed[] = [];
  for (const node of loadsOf(graph).get(record) ?? []) {
    if (node.load.type !== 'some') continue;
    const { source } = node.load.value;
    if (waits.some((name) => sameText(name, source))) continue;
    const feed = node.inputs[0]!;
    const slots = sourceLoadSlots(source);
    const delivery = read.versions.get(slots.delivery);
    const inRun = delivery === undefined ? null : feedInRun(state, graph, feed);
    if (delivery !== undefined && inRun !== null && sameText(inRun.hash, delivery)) {
      carried.push({ source, versions: inRun.versions });
      continue;
    }
    const slot = delivery === undefined ? undefined : read.versions.get(slots.feed);
    const parsed = slot === undefined ? null : parseVersionVector(slot);
    carried.push({ source, versions: parsed?.success === true ? parsed.value : unknownRoots(graph, feed) });
  }
  return carried;
}

/** A feed's output in the run, and the versions it was made from: a task's
 *  result; or a root's value as the run's snapshot holds it, read by the look
 *  that took it. `null` while the run holds neither. */
function feedInRun(state: DataflowExecutionState, graph: DataflowGraph, feed: string): RootRead | null {
  const producer = taskProducers(graph).get(feed);
  if (producer !== undefined) {
    const output = state.tasks.get(producer.name)?.outputHash;
    const made = state.versionVectors.get(feed);
    return output?.type === 'some' && made !== undefined ? { hash: output.value, versions: made } : null;
  }
  const version = state.inputSnapshot.get(feed);
  const read = version === undefined ? undefined : lookedAt(state, feed, version);
  return version === undefined || read === undefined ? null : { hash: read.hash, versions: new Map([[feed, version]]) };
}

/** Each root a feed reads, through the graph's tasks, at {@link UNKNOWN_VERSION}. */
function unknownRoots(graph: DataflowGraph, feed: string): VersionVector {
  return new Map(feedRoots(graph, feed).map((root) => [root, UNKNOWN_VERSION]));
}

/**
 * The roots a dataset of a run's graph is made from, through the tasks that
 * write it and those they read: a root itself, a task's output its task's.
 *
 * @param graph - The run's graph
 * @param path - The dataset's keypath: a load's feed, say
 * @returns The roots' keypaths, each once, in the order they are first met
 * @internal
 */
export function feedRoots(graph: DataflowGraph, path: string): string[] {
  const producers = taskProducers(graph);
  const roots: string[] = [];
  const seen = new Set<string>();
  const walk = (at: string): void => {
    if (seen.has(at)) return;
    seen.add(at);
    const producer = producers.get(at);
    if (producer === undefined) roots.push(at);
    else for (const input of producer.inputs) walk(input);
  };
  walk(path);
  return roots;
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
  // What a look read of a version's ref goes with the version
  for (const [root, looked] of roots.looked) {
    const taken = roots.taken.get(root);
    for (const version of [...looked.keys()]) {
      if (taken?.has(version) !== true) looked.delete(version);
    }
  }
  for (const key of [...roots.older.keys()]) {
    const [record, first, second] = key.split('\n') as [string, string, string];
    const versions = named.get(record);
    if (versions === undefined || !versions.has(first) || !versions.has(second)) roots.older.delete(key);
  }
  for (const [record, gone] of [...roots.gone]) {
    const versions = named.get(record);
    for (const commit of [...gone]) {
      if (versions === undefined || !versions.has(commit)) gone.delete(commit);
    }
    if (gone.size === 0) roots.gone.delete(record);
  }
}

/**
 * What a run's memory holds of its roots: the versions its snapshots
 * numbered, the orders of pairs of commits it never took, and the commits it
 * found the store to hold no more.
 *
 * @param state - The run's state
 * @returns How many of each it holds
 * @internal
 */
export function dataflowRootsHeld(state: DataflowExecutionState): { versions: number; pairs: number; gone: number } {
  const roots = runRoots.get(state);
  if (roots === undefined) return { versions: 0, pairs: 0, gone: 0 };
  let versions = 0;
  for (const taken of roots.taken.values()) versions += taken.size;
  let gone = 0;
  for (const commits of roots.gone.values()) gone += commits.size;
  return { versions, pairs: roots.older.size, gone };
}

/**
 * Notes a commit of a record the store was found to hold no more, as a task
 * that would read the record there was launched: a compaction cut it from the
 * record's history, and garbage collection swept it.
 *
 * @remarks
 * The run keeps it until its state names the commit no more
 * ({@link dataflowSnapshotTaken}), so what a task would read is decided the
 * same without asking the store again ({@link dataflowCommitGone}).
 *
 * @param state - The run's state
 * @param record - The record's keypath
 * @param commit - The commit the store holds no more
 * @internal
 */
export function dataflowCommitSwept(state: DataflowExecutionState, record: string, commit: string): void {
  const roots = rootsOf(state);
  let gone = roots.gone.get(record);
  if (gone === undefined) {
    gone = new Set();
    roots.gone.set(record, gone);
  }
  gone.add(commit);
}

/**
 * Whether the run found the store to hold a commit of a record no more
 * ({@link dataflowCommitSwept}).
 *
 * @param state - The run's state
 * @param record - The record's keypath
 * @param commit - A commit of the record
 * @returns True when a launch of the run found it gone
 * @internal
 */
export function dataflowCommitGone(state: DataflowExecutionState, record: string, commit: string): boolean {
  return runRoots.get(state)?.gone.get(record)?.has(commit) === true;
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
 * A catch-up run's key: what a run tracks it in flight under, keeps its
 * output under once it has landed, and tells it from another by among the
 * runs a task waits for. A task's own run over the same inputs has the same.
 *
 * @param run - The run's task, and the hash of the inputs it runs over
 * @returns The key
 * @internal
 */
export function catchUpKey(run: Pick<CatchUpRun, 'task' | 'inputsHash'>): string {
  return `${run.task}@${run.inputsHash}`;
}

/**
 * A task's inputs at the versions it reads: each input's object, the inputs
 * it cannot read, or the catch-up runs that make what is missing.
 */
export type ResolvedInputs =
  /** Every input is at hand: each one's object, in the task's input order */
  | { readonly kind: 'resolved'; readonly hashes: string[] }
  /** The inputs the task cannot read, in its input order, each with why: one
   *  with no value, an index its record's state does not hold, or a composite
   *  record that waits for an external source's first delivery */
  | { readonly kind: 'unassigned'; readonly waits: InputWait[] }
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

/** One input of a task, or one task's result, as read at a set of versions:
 *  its object; that it cannot be read, `pending` naming the external sources
 *  its record waits for when that is why; or that it is behind. */
type ReadAt =
  | { readonly kind: 'object'; readonly hash: string }
  | { readonly kind: 'unassigned'; readonly pending?: readonly string[] }
  | { readonly kind: 'behind' };

/** A root as read at its version: its dataset object there, with the sources
 *  its ref says it waits for; or that it has no value. */
type RootAt = ({ readonly kind: 'object' } & InputHeld) | { readonly kind: 'unassigned' };

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
 * A composite record that waits for an external source's first delivery
 * (`$pending`, in its ref's version vector) cannot be read, though it holds a
 * state: the solution's own entries alone. Its ref says so, and that is asked
 * before an index of it is looked for (`taskInputRead`, where every reader of
 * an input decides): so a task reading the record, or an index of it, waits
 * naming the sources yet to deliver, and a task reading that task's output
 * waits on an output not set. It is asked at the version the task reads, as
 * the run's look that took that version read the ref
 * ({@link dataflowSnapshotLooked}): a first delivery that landed since leaves
 * the task waiting until the run looks again and takes it in, so no task
 * reads the record as it stood before. The run's memory of its looks is this
 * process's alone: a version it holds no look of — one a result made before
 * the run names, or any version in a host that runs a step an invocation — is
 * asked of the ref where the ref still stands at it, and otherwise read back
 * from the record's history, by the loads committed since
 * (`recordPendingAt`). Where the history cannot say, the record is taken to
 * wait for each of its external sources until the run looks again.
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
  const roots = new Map<string, Promise<RootAt>>();
  const outputs = new Map<string, Promise<ReadAt>>();
  const runs = new Map<string, CatchUpRun>();

  // A root's dataset object at its version, with the sources it waits for
  // there; or that it has no value
  const rootAt = (path: string): Promise<RootAt> => {
    let read = roots.get(path);
    if (read === undefined) {
      read = (async (): Promise<RootAt> => {
        const wanted = versions.get(path);
        if (wanted === undefined) return { kind: 'unassigned' };
        const ref = await storage.datasets.read(repo, workspace, keypathToRefPath(path));
        const held = ref !== null && ref.type === 'value' ? ref.value : null;
        // What the record waits for is judged at the version read, as the look
        // that took it read its ref: a delivery that landed since is the run's
        // once it looks again
        const looked = waitedAt(state, path, wanted);
        if (held !== null && sameVersion(held.versions.get(path) ?? held.hash, wanted)) {
          return { kind: 'object', hash: held.hash, pending: looked ?? pendingSources(held.versions) };
        }
        // It has moved on since the run's snapshot: a record's commit is
        // read from its history, and a plain input's version is its value
        const record = (await dataflowRecords(storage, state)).has(path);
        const hash = record ? decodeRecordCommit(await storage.objects.read(repo, wanted)).state : wanted;
        if (looked !== undefined || !record || held === null) return { kind: 'object', hash, pending: looked ?? [] };
        // A version this process holds no look of: what the record waited for
        // there is read back from its history, and where that cannot say, it
        // is taken to wait for each external source until the run looks again
        const external = slotNames(held.versions, EXTERNAL_SLOT);
        const pending = external.length === 0 ? [] : await recordPendingAt(storage, repo, held.versions, path, wanted) ?? external;
        return { kind: 'object', hash, pending };
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
      const root = await rootAt(path);
      if (root.kind === 'unassigned') {
        read.push(root);
        continue;
      }
      const index = inputs[at]?.index.type === 'some' ? inputs[at].index.value : null;
      // A record that waits for a first delivery, or an index its state does not hold: the task waits, as its status says
      const object = await taskInputRead(storage, repo, path, root, index);
      read.push('object' in object ? { kind: 'object', hash: object.object }
        : object.pending === undefined ? { kind: 'unassigned' } : { kind: 'unassigned', pending: object.pending });
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
        const run: CatchUpRun = { task: of.name, taskHash: of.hash, inputHashes, inputsHash: inHash, versions: at };
        runs.set(catchUpKey(run), run);
        return { kind: 'behind' };
      })();
      outputs.set(of.name, read);
    }
    return read;
  };

  const inputs = await inputsAt(task);
  const waits: InputWait[] = [];
  for (const [at, input] of task.inputs.entries()) {
    const read = inputs[at]!;
    if (read.kind !== 'unassigned') continue;
    waits.push(read.pending === undefined ? { input, kind: 'unset' } : { input, kind: 'pending', sources: [...read.pending] });
  }
  if (waits.length > 0) return { kind: 'unassigned', waits };
  if (inputs.some((input) => input.kind === 'behind')) return { kind: 'behind', runs: [...runs.values()] };
  return { kind: 'resolved', hashes: inputs.map((input) => (input as { hash: string }).hash) };
}
