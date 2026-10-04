/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Workspace status - dry-run analysis of dataflow execution state.
 *
 * Provides a complete view of workspace state including:
 * - Lock status (who holds it, since when)
 * - Dataset status (unset, stale, up-to-date)
 * - Task status (up-to-date, ready, waiting, in-progress)
 *
 * This is read-only and does not require a lock.
 */

import { decodeBeast2For, variant } from '@elaraai/east';
import {
  decodePackageObject,
  WorkspaceRecordType,
  pathToString,
  type DatasetRef,
  type StopReason,
  type TaskObject,
  type TreePath,
  type Structure,
  decodeTaskObject,
} from '@elaraai/e3-types';
import {
  executionGetLatest,
  inputsHash,
} from './executions.js';
import { OBJECT_CONCURRENCY, eachAtMost } from './concurrency.js';
import {
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
  lockStateToHolderInfo,
  type LockHolderInfo,
} from './errors.js';
import type { TaskRunner } from './execution/interfaces.js';
import type { StorageBackend } from './storage/interfaces.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Status of a dataset in the workspace.
 */
export type DatasetStatus =
  | { type: 'unset' }           // No value assigned
  | { type: 'stale' }           // Value exists but is outdated (upstream task needs rerun)
  | { type: 'up-to-date' };     // Value is current

/**
 * Status of a task in the workspace.
 */
export type TaskStatus =
  | { type: 'up-to-date'; cached: boolean }  // Output matches cached execution
  | { type: 'ready' }                         // Can run immediately (all inputs ready)
  | { type: 'waiting'; reason: string }       // Waiting on upstream tasks or unset inputs
  | { type: 'in-progress'; pid?: number; startedAt?: string }  // Currently executing
  | { type: 'failed'; exitCode: number; completedAt?: string }  // Last execution failed (non-zero exit)
  | { type: 'error'; message: string; completedAt?: string }    // Last execution had internal error
  | { type: 'stale-running'; pid?: number; startedAt?: string };  // Marked running, but can no longer finish

/**
 * Information about a dataset in the status report.
 */
export interface DatasetStatusInfo {
  /** Dataset path (e.g., "inputs.sales_data") */
  path: string;
  /** Current status */
  status: DatasetStatus;
  /** Hash of current value (if set) */
  hash: string | null;
  /** True if this is a task output */
  isTaskOutput: boolean;
  /** Name of task that produces this (if any) */
  producedBy: string | null;
}

/**
 * Information about a task in the status report.
 */
export interface TaskStatusInfo {
  /** Task name */
  name: string;
  /** Task hash */
  hash: string;
  /** Current status */
  status: TaskStatus;
  /** Input dataset paths */
  inputs: string[];
  /** Output dataset path */
  output: string;
  /** Tasks this one depends on */
  dependsOn: string[];
  /** The highest peak resident memory, in bytes, a runner of the execution
   *  the status comes from reached — the one the output came from, or the
   *  failure — or `null` when it recorded none, or while it runs */
  peakBytes: number | null;
  /** Why the latest attempt over the task's current inputs stopped, when it
   *  was cancelled or interrupted and the task therefore reads `ready`;
   *  `null` otherwise */
  stopped: StopReason | null;
}

/**
 * What {@link workspaceStatus} answers for.
 */
export interface WorkspaceStatusOptions {
  /**
   * The datasets to answer for, such as those a UI binds. The answer then
   * holds those the workspace has, and the tasks that produce them, each with
   * the status the whole workspace's answer gives it, and its summary counts
   * them. A path that names no dataset of the workspace — one a redeploy
   * removed, or a tree — is left out. Every dataset and task when omitted.
   */
  paths?: readonly TreePath[];
}

/**
 * Complete workspace status report.
 */
export interface WorkspaceStatusResult {
  /** Workspace name */
  workspace: string;
  /** Lock status - null if not locked */
  lock: LockHolderInfo | null;
  /** Status of all datasets */
  datasets: DatasetStatusInfo[];
  /** Status of all tasks */
  tasks: TaskStatusInfo[];
  /** Summary counts */
  summary: {
    datasets: {
      total: number;
      unset: number;
      stale: number;
      upToDate: number;
    };
    tasks: {
      total: number;
      upToDate: number;
      ready: number;
      waiting: number;
      inProgress: number;
      failed: number;
      error: number;
      staleRunning: number;
    };
  };
}

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Information about a task in the dependency graph.
 */
interface TaskNode {
  name: string;
  hash: string;
  task: TaskObject;
  inputPaths: TreePath[];
  outputPath: TreePath;
}

// =============================================================================
// Workspace State Reader
// =============================================================================

/**
 * Read workspace state.
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
// Main Function
// =============================================================================

/**
 * Get comprehensive status of a workspace.
 *
 * Performs a dry-run analysis of the workspace to determine:
 * - Whether the workspace is locked (and by whom)
 * - Status of each dataset (unset, stale, up-to-date)
 * - Status of each task (up-to-date, ready, waiting, in-progress)
 *
 * This is a read-only operation that does not modify workspace state
 * and does not require acquiring a lock.
 *
 * A task whose execution is recorded running is in progress while the runner
 * says the execution can still finish ({@link TaskRunner.executionAlive}), and
 * stale once it cannot: the runner that started it knows, wherever it runs.
 *
 * Asked for named datasets (`options.paths`), it answers those and the tasks
 * that produce them, and reads no other task's executions: a UI's poll costs
 * what it binds, not the workspace. It reads every task object either way,
 * since which task produces which dataset is in its task object. Its reads go
 * a few at a time — the task objects, the tasks' statuses, the dataset refs —
 * so a backend whose reads are requests pays its latency a few times over,
 * not once per object.
 *
 * What it reads is the workspace's and what runs in it, never its history:
 * each dataset ref once — a whole workspace's in one call
 * (`DatasetRefStore.readAll`), named datasets' and their tasks' inputs and
 * outputs each on its own — and of each task's executions, those recorded
 * running (`RefStore.executionListRunning`) and the latest over its current
 * inputs. So a poll costs the same on the day a workspace is deployed and a
 * year on.
 *
 * @param storage - Storage backend
 * @param runner - The runner the workspace's tasks run on
 * @param repo - Repository identifier (for local storage, the path to e3 repository directory)
 * @param ws - Workspace name
 * @param options - The datasets to answer for; every one when omitted
 * @returns Complete status report
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace has no package deployed
 */
export async function workspaceStatus(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  ws: string,
  options: WorkspaceStatusOptions = {},
): Promise<WorkspaceStatusResult> {
  // Check lock status first
  const lockState = await storage.locks.getState(repo, ws);
  const lock = lockState ? lockStateToHolderInfo(lockState) : null;

  // Read workspace state
  const state = await readWorkspaceState(storage, repo, ws);

  // Read package object to get tasks and structure
  const pkgData = await storage.objects.read(repo, state.packageHash);
  const pkgObject = decodePackageObject(pkgData);

  // Every task object, a few at a time: which task produces which dataset is
  // in its task object, whatever the answer is for.
  const packaged = [...pkgObject.tasks];
  const taskObjects: TaskObject[] = new Array<TaskObject>(packaged.length);
  await eachAtMost(packaged.map((_, i) => i), OBJECT_CONCURRENCY, async (i) => {
    taskObjects[i] = decodeTaskObject(await storage.objects.read(repo, packaged[i]![1]));
  });

  // Build task nodes
  const taskNodes = new Map<string, TaskNode>();
  const outputToTask = new Map<string, string>(); // output path -> task name
  packaged.forEach(([taskName, taskHash], i) => {
    const task = taskObjects[i]!;
    outputToTask.set(pathToString(task.output.path), taskName);
    taskNodes.set(taskName, {
      name: taskName,
      hash: taskHash,
      task,
      inputPaths: task.inputs.map((input) => input.path),
      outputPath: task.output.path,
    });
  });

  // The datasets answered for: every one the structure holds, or those of
  // them named.
  const structurePaths: TreePath[] = [];
  collectDatasetPaths(pkgObject.data.structure, [], structurePaths);
  const named = options.paths === undefined ? null : new Set(options.paths.map(pathToString));
  const datasetPaths = named === null ? structurePaths : structurePaths.filter((path) => named.has(pathToString(path)));

  // Determine task dependencies
  const taskDependsOn = new Map<string, string[]>();
  for (const [taskName, node] of taskNodes) {
    const deps: string[] = [];
    for (const inputPath of node.inputPaths) {
      const inputPathStr = pathToString(inputPath);
      const producerTask = outputToTask.get(inputPathStr);
      if (producerTask) {
        deps.push(producerTask);
      }
    }
    taskDependsOn.set(taskName, deps);
  }

  // The tasks answered for: every one, or those producing the datasets
  // answered for. Each one's status is computed, and so is each of its direct
  // upstream tasks', whose staleness makes a ready one wait; no other task's
  // executions are read.
  const producers = new Set(datasetPaths.map((path) => outputToTask.get(pathToString(path))));
  const answered = [...taskNodes.keys()].filter((taskName) => named === null || producers.has(taskName));
  const computed = new Set(answered);
  for (const taskName of answered) {
    for (const depName of taskDependsOn.get(taskName) ?? []) computed.add(depName);
  }

  // The refs read, each once: the whole workspace's in one store call, or
  // those of the datasets answered for and of the inputs and outputs of the
  // tasks whose statuses are computed, a few at a time.
  const refs = named === null
    ? await storage.datasets.readAll(repo, ws)
    : await readRefs(storage, repo, ws, [
      ...datasetPaths,
      ...[...computed].flatMap((taskName) => [...taskNodes.get(taskName)!.inputPaths, taskNodes.get(taskName)!.outputPath]),
    ]);

  // Determine which tasks are stale (need to rerun)
  // A task is stale if:
  // 1. No cached execution for current inputs, OR
  // 2. Cached output doesn't match current workspace output, OR
  // 3. Any upstream task is stale
  const taskIsStale = new Map<string, boolean>();
  const taskStatus = new Map<string, TaskStatus>();
  const taskPeak = new Map<string, number | null>();
  const taskStopped = new Map<string, StopReason | null>();

  // First pass: determine which tasks have valid cached executions.
  // Tasks are independent here (computeTaskStatus reads nothing cross-task),
  // so they run a few at a time — wall clock becomes the slowest tasks'
  // lookups instead of the sum over all tasks.
  await eachAtMost([...computed], OBJECT_CONCURRENCY, async (taskName) => {
    const { status, peakBytes, stopped } = await computeTaskStatus(
      storage,
      runner,
      repo,
      refs,
      taskNodes.get(taskName)!,
      outputToTask,
      taskNodes,
      taskIsStale
    );
    taskStatus.set(taskName, status);
    taskPeak.set(taskName, peakBytes ?? null);
    taskStopped.set(taskName, stopped ?? null);
    taskIsStale.set(taskName, status.type !== 'up-to-date');
  });

  // Second pass: mark tasks as waiting if their upstream is stale. A task that
  // waits no longer reads ready for its stopped attempt, so its reason goes.
  for (const taskName of answered) {
    const currentStatus = taskStatus.get(taskName)!;
    if (currentStatus.type === 'ready') {
      // Check if any upstream task is stale
      const deps = taskDependsOn.get(taskName) ?? [];
      for (const depName of deps) {
        if (taskIsStale.get(depName)) {
          taskStatus.set(taskName, {
            type: 'waiting',
            reason: `Waiting for task '${depName}'`,
          });
          taskStopped.set(taskName, null);
          break;
        }
      }
    }
  }

  // Build dataset status, from the refs read
  const datasetStatusInfos = datasetPaths.map((datasetPath): DatasetStatusInfo => {
    const pathStr = pathToString(datasetPath);
    const { refType, hash } = refOf(refs, datasetPath);

    const producerTask = outputToTask.get(pathStr) ?? null;
    const isTaskOutput = producerTask !== null;

    let status: DatasetStatus;
    if (refType === 'unassigned') {
      status = { type: 'unset' };
    } else if (isTaskOutput && producerTask && taskIsStale.get(producerTask)) {
      status = { type: 'stale' };
    } else {
      status = { type: 'up-to-date' };
    }

    return {
      path: pathStr,
      status,
      hash,
      isTaskOutput,
      producedBy: producerTask,
    };
  });

  // Build task status info
  const taskStatusInfos: TaskStatusInfo[] = [];
  for (const taskName of answered) {
    const node = taskNodes.get(taskName)!;
    taskStatusInfos.push({
      name: taskName,
      hash: node.hash,
      status: taskStatus.get(taskName)!,
      inputs: node.inputPaths.map(pathToString),
      output: pathToString(node.outputPath),
      dependsOn: taskDependsOn.get(taskName) ?? [],
      peakBytes: taskPeak.get(taskName) ?? null,
      stopped: taskStopped.get(taskName) ?? null,
    });
  }

  // Compute summary
  const summary = {
    datasets: {
      total: datasetStatusInfos.length,
      unset: datasetStatusInfos.filter((d) => d.status.type === 'unset').length,
      stale: datasetStatusInfos.filter((d) => d.status.type === 'stale').length,
      upToDate: datasetStatusInfos.filter((d) => d.status.type === 'up-to-date').length,
    },
    tasks: {
      total: taskStatusInfos.length,
      upToDate: taskStatusInfos.filter((t) => t.status.type === 'up-to-date').length,
      ready: taskStatusInfos.filter((t) => t.status.type === 'ready').length,
      waiting: taskStatusInfos.filter((t) => t.status.type === 'waiting').length,
      inProgress: taskStatusInfos.filter((t) => t.status.type === 'in-progress').length,
      failed: taskStatusInfos.filter((t) => t.status.type === 'failed').length,
      error: taskStatusInfos.filter((t) => t.status.type === 'error').length,
      staleRunning: taskStatusInfos.filter((t) => t.status.type === 'stale-running').length,
    },
  };

  return {
    workspace: ws,
    lock,
    datasets: datasetStatusInfos,
    tasks: taskStatusInfos,
    summary,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Recursively collect all dataset paths from a structure.
 */
function collectDatasetPaths(
  structure: Structure,
  currentPath: TreePath,
  result: TreePath[]
): void {
  if (structure.type === 'value') {
    result.push(currentPath);
  } else if (structure.type === 'struct') {
    for (const [fieldName, childStructure] of structure.value) {
      const childPath: TreePath = [...currentPath, variant('field', fieldName)];
      collectDatasetPaths(childStructure, childPath, result);
    }
  }
}

/**
 * Reads the refs at `paths`, each once however often it is named, a few at a
 * time.
 *
 * @returns Each ref there is, by its dataset path
 */
async function readRefs(storage: StorageBackend, repo: string, ws: string, paths: readonly TreePath[]): Promise<Map<string, DatasetRef>> {
  const refPaths = [...new Set(paths.map(refPathOf))];
  const refs = new Map<string, DatasetRef>();
  await eachAtMost(refPaths, OBJECT_CONCURRENCY, async (refPath) => {
    const ref = await storage.datasets.read(repo, ws, refPath);
    if (ref !== null) refs.set(refPath, ref);
  });
  return refs;
}

/** A dataset's ref path, as its store keys it: `inputs/sales` for `.inputs.sales`. */
function refPathOf(path: TreePath): string {
  return path.map((segment) => segment.value).join('/');
}

/**
 * A dataset's ref, as status reads it from the refs read: whether it is
 * assigned, and its value's hash. A dataset with no ref is unassigned.
 */
function refOf(refs: ReadonlyMap<string, DatasetRef>, path: TreePath): { refType: DatasetRef['type']; hash: string | null } {
  const ref = refs.get(refPathOf(path));
  if (ref === undefined || ref.type === 'unassigned') return { refType: 'unassigned', hash: null };
  if (ref.type === 'null') return { refType: 'null', hash: null };
  return { refType: 'value', hash: ref.value.hash };
}

/**
 * Compute the status of a task, and the peak memory of the execution it comes
 * from: the one its output came from, or its failure; or, for a task that
 * reads ready because its latest attempt was cancelled or interrupted, why
 * that attempt stopped. Its inputs and output are read from the refs read.
 */
async function computeTaskStatus(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  refs: ReadonlyMap<string, DatasetRef>,
  node: TaskNode,
  outputToTask: Map<string, string>,
  _taskNodes: Map<string, TaskNode>,
  _taskIsStale: Map<string, boolean>
): Promise<{ status: TaskStatus; peakBytes?: number; stopped?: StopReason }> {
  // First, check if execution is in progress
  const inProgressStatus = await checkInProgress(storage, runner, repo, node.hash);
  if (inProgressStatus) {
    return { status: inProgressStatus };
  }

  // Gather current input hashes
  const currentInputHashes: string[] = [];
  let hasUnsetInputs = false;
  let waitingOnTasks: string[] = [];

  for (const inputPath of node.inputPaths) {
    const inputPathStr = pathToString(inputPath);
    const { refType, hash } = refOf(refs, inputPath);

    if (refType === 'unassigned' || hash === null) {
      hasUnsetInputs = true;

      // Check if this is produced by another task
      const producerTask = outputToTask.get(inputPathStr);
      if (producerTask) {
        waitingOnTasks.push(producerTask);
      } else {
        // External input that is unset
        return { status: { type: 'waiting', reason: `Input '${inputPathStr}' is not set` } };
      }
    } else {
      currentInputHashes.push(hash);
    }
  }

  // If any inputs are unset and produced by tasks, we're waiting
  if (hasUnsetInputs && waitingOnTasks.length > 0) {
    return { status: { type: 'waiting', reason: `Waiting for task(s): ${waitingOnTasks.join(', ')}` } };
  }

  // If any inputs are unset (external), we're waiting
  if (hasUnsetInputs) {
    return { status: { type: 'waiting', reason: 'Some inputs are not set' } };
  }

  // Check the execution status for these inputs
  const inHash = inputsHash(currentInputHashes);
  const execStatus = await executionGetLatest(storage, repo, node.hash, inHash);

  if (execStatus === null) {
    // No execution attempted - task is ready to run
    return { status: { type: 'ready' } };
  }

  // Check the execution status type
  switch (execStatus.type) {
    case 'running': {
      // checkInProgress asked the runner, which says it can no longer finish
      return {
        status: {
          type: 'stale-running',
          pid: Number(execStatus.value.pid),
          startedAt: execStatus.value.startedAt.toISOString(),
        },
      };
    }

    case 'failed': {
      // Task ran but returned non-zero exit code
      return {
        status: {
          type: 'failed',
          exitCode: Number(execStatus.value.exitCode),
          completedAt: execStatus.value.completedAt.toISOString(),
        },
        ...(execStatus.value.peakBytes.type === 'some' && { peakBytes: Number(execStatus.value.peakBytes.value) }),
      };
    }

    case 'error': {
      // Internal error during execution
      return {
        status: {
          type: 'error',
          message: execStatus.value.message,
          completedAt: execStatus.value.completedAt.toISOString(),
        },
      };
    }

    case 'cancelled':
    case 'interrupted':
      // e3 stopped the execution, or it can no longer finish, before the task
      // finished: it neither succeeded nor failed, and can run again. Its
      // record says why.
      return { status: { type: 'ready' }, stopped: execStatus.value.reason };

    case 'success': {
      // Execution succeeded - check if workspace output matches
      const cachedOutputHash = execStatus.value.outputHash;
      const { refType, hash: wsOutputHash } = refOf(refs, node.outputPath);

      if (refType !== 'value' || wsOutputHash !== cachedOutputHash) {
        // Workspace output doesn't match - task needs to run
        // (This might happen if workspace was modified externally)
        return { status: { type: 'ready' } };
      }

      // Everything matches - task is up-to-date
      return {
        status: { type: 'up-to-date', cached: true },
        ...(execStatus.value.peakBytes.type === 'some' && { peakBytes: Number(execStatus.value.peakBytes.value) }),
      };
    }

    default:
      // Unknown status type - treat as ready
      return { status: { type: 'ready' } };
  }
}

/**
 * Check if an execution is currently in progress for a task.
 *
 * Looks for a 'running' execution status the runner says can still finish:
 * whose judgement is `true`, where `false` and a host's reason both say it
 * cannot. Only the task's attempts recorded running are read, from the
 * store's index of them, whatever the task has run before.
 */
async function checkInProgress(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  taskHash: string
): Promise<TaskStatus | null> {
  const running = await storage.refs.executionListRunning(repo, taskHash);

  for (const { inputsHash: inHash, status } of running) {
    // A split task's units are recorded under its hash too; while they run,
    // the task's own execution is recorded running, from when it started.
    if (status.type === 'running' && !status.value.unit) {
      if (Object.is(await runner.executionAlive(storage, taskHash, inHash, status.value), true)) {
        return {
          type: 'in-progress',
          pid: Number(status.value.pid),
          startedAt: status.value.startedAt.toISOString(),
        };
      }
      // It can no longer finish: reported stale-running if it is the
      // execution of the current inputs
    }
  }

  return null;
}
