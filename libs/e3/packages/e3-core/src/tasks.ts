/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Task operations for e3 repositories.
 *
 * Tasks are computations with input/output dataset paths. They are stored
 * as TaskObjects in the object store and referenced by packages via their hash.
 *
 * This module provides APIs to:
 * - List tasks in packages and workspaces
 * - Get task details (runner, inputs, output paths)
 *
 * A listing of a workspace's tasks reads the workspace's record once and
 * decodes its package once, and every task object read here is read once
 * per object and then from memory ({@link taskObjectRead}): an object's hash
 * fixes what it decodes to.
 */

import { decodeBeast2For } from '@elaraai/east';
import {
  WorkspaceRecordType,
  type PackageObject,
  type TaskObject,
  decodeTaskObject,
} from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, eachAtMost } from './concurrency.js';
import { hashMemo, memoKey } from './memo.js';
import { packageObjectRead, packageRead } from './packages.js';
import {
  TaskNotFoundError,
  WorkspaceNotFoundError,
  WorkspaceNotDeployedError,
} from './errors.js';
import type { StorageBackend } from './storage/interfaces.js';

/** How many decoded task objects {@link taskObjectRead} keeps. */
const TASK_OBJECTS_KEPT = 4096;

/** What task objects decoded to, by repository and hash: a task is read on
 *  every list, status and log read of its workspace. */
const taskObjects = hashMemo<TaskObject>(TASK_OBJECTS_KEPT);

/**
 * Read and decode a task object by its hash: once per object of a
 * repository, since its hash fixes what it decodes to, and then from memory
 * ({@link hashMemo}) however many lists, statuses and log reads name it.
 *
 * @remarks
 * What it answers is shared by every reader, which reads it and never
 * changes it. A repository's objects are kept apart from another's
 * ({@link memoKey}), so an object one repository holds is read from the
 * store when another first names it, and refused there when that one does
 * not hold it.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - The task object's hash
 * @returns The task object
 * @throws {ObjectNotFoundError} When the store does not hold the object, and
 *   nothing has read it from the repository before
 */
export async function taskObjectRead(storage: StorageBackend, repo: string, hash: string): Promise<TaskObject> {
  const key = memoKey(repo, hash);
  const known = taskObjects.get(key);
  if (known !== undefined) return known;
  const task = decodeTaskObject(await storage.objects.read(repo, hash));
  taskObjects.set(key, task);
  return task;
}

// =============================================================================
// Package Task Operations
// =============================================================================

/**
 * List task names in a package.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Package name
 * @param version - Package version
 * @returns Array of task names
 * @throws If package not found
 */
export async function packageListTasks(
  storage: StorageBackend,
  repo: string,
  name: string,
  version: string
): Promise<string[]> {
  const pkg = await packageRead(storage, repo, name, version);
  return Array.from(pkg.tasks.keys());
}

/**
 * Get task details from a package.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Package name
 * @param version - Package version
 * @param taskName - Name of the task
 * @returns The TaskObject containing runner, inputs, and output
 * @throws {PackageNotFoundError} If package not found
 * @throws {TaskNotFoundError} If task not found in package
 */
export async function packageGetTask(
  storage: StorageBackend,
  repo: string,
  name: string,
  version: string,
  taskName: string
): Promise<TaskObject> {
  const pkg = await packageRead(storage, repo, name, version);
  const taskHash = pkg.tasks.get(taskName);

  if (!taskHash) {
    throw new TaskNotFoundError(taskName);
  }

  return taskObjectRead(storage, repo, taskHash);
}

// =============================================================================
// Workspace Task Operations
// =============================================================================

/**
 * Read workspace state from storage.
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 * @throws {WorkspaceNotDeployedError} If workspace exists but not deployed
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

/**
 * Get the deployed package object for a workspace: its record read once,
 * and its package decoded once ({@link packageObjectRead}).
 */
async function getWorkspacePackageObject(storage: StorageBackend, repo: string, ws: string): Promise<PackageObject> {
  const state = await readWorkspaceState(storage, repo, ws);
  return packageObjectRead(storage, repo, state.packageHash);
}

/**
 * A task of a workspace: its name, the hash of its task object, and the task
 * object.
 */
export interface WorkspaceTask {
  /** The task's name */
  readonly name: string;
  /** The hash of its task object */
  readonly hash: string;
  /** Its task object: runner, inputs, output and role */
  readonly task: TaskObject;
}

/**
 * List task names in a workspace.
 *
 * Tasks are defined by the deployed package.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @returns Array of task names
 * @throws If workspace not found or not deployed
 */
export async function workspaceListTasks(
  storage: StorageBackend,
  repo: string,
  ws: string
): Promise<string[]> {
  const pkg = await getWorkspacePackageObject(storage, repo, ws);
  return Array.from(pkg.tasks.keys());
}

/**
 * List a workspace's tasks with their task objects: what a task list serves.
 *
 * @remarks
 * The workspace's record is read once and its package decoded once, and the
 * task objects are read a few at a time ({@link OBJECT_CONCURRENCY}), each
 * once per object and then from memory ({@link taskObjectRead}): a list of
 * two hundred tasks costs one read of the record and, the first time, one
 * read per task object, where it read the record once per task and decoded
 * the package as often.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @returns Each task, in the package's order
 * @throws {WorkspaceNotFoundError} If workspace not found
 * @throws {WorkspaceNotDeployedError} If workspace not deployed
 */
export async function workspaceListTaskObjects(
  storage: StorageBackend,
  repo: string,
  ws: string
): Promise<WorkspaceTask[]> {
  const pkg = await getWorkspacePackageObject(storage, repo, ws);
  const packaged = [...pkg.tasks];
  const tasks: WorkspaceTask[] = new Array<WorkspaceTask>(packaged.length);
  await eachAtMost(packaged.map((_, i) => i), OBJECT_CONCURRENCY, async (i) => {
    const [name, hash] = packaged[i]!;
    tasks[i] = { name, hash, task: await taskObjectRead(storage, repo, hash) };
  });
  return tasks;
}

/**
 * Find a task in a workspace: its hash and its task object, the workspace's
 * record read once and its package decoded once.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param taskName - Name of the task
 * @returns The task
 * @throws {WorkspaceNotFoundError} If workspace not found
 * @throws {WorkspaceNotDeployedError} If workspace not deployed
 * @throws {TaskNotFoundError} If task not found
 */
export async function workspaceFindTask(
  storage: StorageBackend,
  repo: string,
  ws: string,
  taskName: string
): Promise<WorkspaceTask> {
  const pkg = await getWorkspacePackageObject(storage, repo, ws);
  const hash = pkg.tasks.get(taskName);

  if (!hash) {
    throw new TaskNotFoundError(taskName);
  }

  return { name: taskName, hash, task: await taskObjectRead(storage, repo, hash) };
}

/**
 * Get task hash from a workspace.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param taskName - Name of the task
 * @returns The hash of the TaskObject
 * @throws {WorkspaceNotFoundError} If workspace not found
 * @throws {WorkspaceNotDeployedError} If workspace not deployed
 * @throws {TaskNotFoundError} If task not found
 */
export async function workspaceGetTaskHash(
  storage: StorageBackend,
  repo: string,
  ws: string,
  taskName: string
): Promise<string> {
  const pkg = await getWorkspacePackageObject(storage, repo, ws);
  const taskHash = pkg.tasks.get(taskName);

  if (!taskHash) {
    throw new TaskNotFoundError(taskName);
  }

  return taskHash;
}

/**
 * Get task details from a workspace.
 *
 * Tasks are defined by the deployed package.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param taskName - Name of the task
 * @returns The TaskObject containing runner, inputs, and output
 * @throws If workspace not deployed or task not found
 */
export async function workspaceGetTask(
  storage: StorageBackend,
  repo: string,
  ws: string,
  taskName: string
): Promise<TaskObject> {
  return (await workspaceFindTask(storage, repo, ws, taskName)).task;
}
