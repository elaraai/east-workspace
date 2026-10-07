/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { NullType, OptionType, some, none, variant } from '@elaraai/east';
import { ArrayType } from '@elaraai/east';
import {
  PackageJobResponseType, WorkspaceDeployStatusType, WorkspaceStateType, parsePackageRef, type TreePath, type WorkspaceDeployRequest,
} from '@elaraai/e3-types';
import {
  workspaceList,
  workspaceCreate,
  workspaceCopy,
  workspaceRemove,
  workspaceGetState,
  workspaceLockStatus,
  workspaceStatus,
  packageGetLatestVersion,
  packageResolve,
  checkName,
  PackageNotFoundError,
  WorkspaceNotDeployedError,
  WorkspaceNotFoundError,
} from '@elaraai/e3-core/portable';
import type { StorageBackend, TaskRunner, WorkspaceDeployStore } from '@elaraai/e3-core/portable';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { LockStatusType, WorkspaceInfoType, WorkspaceStatusResultType } from '../types.js';

/**
 * List all workspaces in the repository.
 */
export async function listWorkspaces(
  storage: StorageBackend,
  repoPath: string
): Promise<Response> {
  try {
    const workspaces = await workspaceList(storage, repoPath);
    const result = await Promise.all(
      workspaces.map(async (name) => {
        const state = await workspaceGetState(storage, repoPath, name);
        if (state) {
          return {
            name,
            deployed: true,
            packageName: some(state.packageName),
            packageVersion: some(state.packageVersion),
          };
        } else {
          return {
            name,
            deployed: false,
            packageName: none,
            packageVersion: none,
          };
        }
      })
    );
    return sendSuccess(ArrayType(WorkspaceInfoType), result);
  } catch (err) {
    return sendError(ArrayType(WorkspaceInfoType), errorToVariant(err));
  }
}

/**
 * Create a new workspace.
 */
export async function createWorkspace(
  storage: StorageBackend,
  repoPath: string,
  name: string
): Promise<Response> {
  try {
    await workspaceCreate(storage, repoPath, name);
    return sendSuccess(WorkspaceInfoType, {
      name,
      deployed: false,
      packageName: none,
      packageVersion: none,
    });
  } catch (err) {
    return sendError(WorkspaceInfoType, errorToVariant(err));
  }
}

/**
 * Copy a workspace within its repository: the target becomes the source as it
 * is now, its refs only written, so the copy costs what the workspace has of
 * datasets, never what they weigh.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param from - The workspace copied
 * @param to - The workspace it is copied to, made or replaced whole
 * @returns The response: the target, as the workspace list gives it; or
 *   `workspace_not_found` for a source that does not exist,
 *   `workspace_locked` for a target a dataflow runs in or something else holds
 *   (or a source held exclusively), or `invalid_name` for a name no workspace
 *   can have, or a target that is the source
 */
export async function copyWorkspace(
  storage: StorageBackend,
  repoPath: string,
  from: string,
  to: string,
): Promise<Response> {
  try {
    await workspaceCopy(storage, repoPath, from, to);
    const state = await workspaceGetState(storage, repoPath, to);
    return sendSuccess(WorkspaceInfoType, {
      name: to,
      deployed: state !== null,
      packageName: state === null ? none : some(state.packageName),
      packageVersion: state === null ? none : some(state.packageVersion),
    });
  } catch (err) {
    return sendError(WorkspaceInfoType, errorToVariant(err));
  }
}

/**
 * Get workspace state.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param name - Workspace name
 * @returns The response: the deployed state; `workspace_not_deployed` for a
 *   workspace nothing is deployed to yet, as while its first deploy runs; or
 *   `workspace_not_found`
 */
export async function getWorkspace(
  storage: StorageBackend,
  repoPath: string,
  name: string
): Promise<Response> {
  try {
    const state = await workspaceGetState(storage, repoPath, name);
    if (!state) {
      const exists = (await workspaceList(storage, repoPath)).includes(name);
      throw exists ? new WorkspaceNotDeployedError(name) : new WorkspaceNotFoundError(name);
    }
    return sendSuccess(WorkspaceStateType, state);
  } catch (err) {
    return sendError(WorkspaceStateType, errorToVariant(err));
  }
}

/**
 * What holds a workspace exclusively, and how far that operation says it has
 * got: a deploy taking its file sources in and deploying its records, while a
 * workspace deployed for the first time has no status to show.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param name - Workspace name
 * @returns The response: the lock's status, `none` when nothing holds the
 *   workspace exclusively, or the error
 */
export async function getWorkspaceLockStatus(
  storage: StorageBackend,
  repoPath: string,
  name: string
): Promise<Response> {
  try {
    const status = await workspaceLockStatus(storage, repoPath, name);
    return sendSuccess(OptionType(LockStatusType), status === null ? none : some(status));
  } catch (err) {
    return sendError(OptionType(LockStatusType), errorToVariant(err));
  }
}

/**
 * Get comprehensive workspace status.
 *
 * @param storage - Storage backend
 * @param runner - The runner the repository's tasks run on, which says
 *   whether an execution recorded running can still finish
 * @param repoPath - Repository identifier
 * @param name - Workspace name
 * @param paths - The datasets to answer for, such as those a UI binds: the
 *   answer then holds those the workspace has, and the tasks that produce
 *   them. The whole workspace when omitted.
 * @returns The response: the status, or the error
 */
export async function getWorkspaceStatus(
  storage: StorageBackend,
  runner: TaskRunner,
  repoPath: string,
  name: string,
  paths?: readonly TreePath[],
): Promise<Response> {
  try {
    const status = await workspaceStatus(storage, runner, repoPath, name, paths === undefined ? {} : { paths });
    // Convert numbers to bigints for BEAST2 serialization
    const result = {
      workspace: status.workspace,
      lock: status.lock ? some({
        pid: BigInt(status.lock.pid ?? 0),
        acquiredAt: status.lock.acquiredAt,
        bootId: status.lock.bootId ? some(status.lock.bootId) : none,
        command: status.lock.command ? some(status.lock.command) : none,
      }) : none,
      datasets: status.datasets.map(d => ({
        path: d.path,
        status: convertDatasetStatus(d.status),
        hash: d.hash ? some(d.hash) : none,
        isTaskOutput: d.isTaskOutput,
        producedBy: d.producedBy ? some(d.producedBy) : none,
      })),
      tasks: status.tasks.map(t => ({
        name: t.name,
        hash: t.hash,
        status: convertTaskStatus(t.status),
        inputs: t.inputs,
        output: t.output,
        dependsOn: t.dependsOn,
        peakBytes: t.peakBytes === null ? none : some(BigInt(t.peakBytes)),
        stopped: t.stopped === null ? none : some(t.stopped),
      })),
      summary: {
        datasets: {
          total: BigInt(status.summary.datasets.total),
          unset: BigInt(status.summary.datasets.unset),
          stale: BigInt(status.summary.datasets.stale),
          upToDate: BigInt(status.summary.datasets.upToDate),
        },
        tasks: {
          total: BigInt(status.summary.tasks.total),
          upToDate: BigInt(status.summary.tasks.upToDate),
          ready: BigInt(status.summary.tasks.ready),
          waiting: BigInt(status.summary.tasks.waiting),
          inProgress: BigInt(status.summary.tasks.inProgress),
          failed: BigInt(status.summary.tasks.failed),
          error: BigInt(status.summary.tasks.error),
          staleRunning: BigInt(status.summary.tasks.staleRunning),
        },
      },
    };
    return sendSuccess(WorkspaceStatusResultType, result);
  } catch (err) {
    return sendError(WorkspaceStatusResultType, errorToVariant(err));
  }
}

// Helper to convert dataset status to variant format
function convertDatasetStatus(status: { type: string }) {
  switch (status.type) {
    case 'unset': return variant('unset', null);
    case 'stale': return variant('stale', null);
    case 'up-to-date': return variant('up-to-date', null);
    default: return variant('unset', null);
  }
}

// Helper to convert task status to variant format
function convertTaskStatus(status: any) {
  switch (status.type) {
    case 'up-to-date':
      return variant('up-to-date', { cached: status.cached });
    case 'ready':
      return variant('ready', null);
    case 'waiting':
      return variant('waiting', { reason: status.reason });
    case 'in-progress':
      return variant('in-progress', {
        pid: status.pid != null ? some(BigInt(status.pid)) : none,
        startedAt: status.startedAt ? some(status.startedAt) : none,
      });
    case 'failed':
      return variant('failed', {
        exitCode: BigInt(status.exitCode),
        completedAt: status.completedAt ? some(status.completedAt) : none,
      });
    case 'error':
      return variant('error', {
        message: status.message,
        completedAt: status.completedAt ? some(status.completedAt) : none,
      });
    case 'stale-running':
      return variant('stale-running', {
        pid: status.pid != null ? some(BigInt(status.pid)) : none,
        startedAt: status.startedAt ? some(status.startedAt) : none,
      });
    default:
      return variant('ready', null);
  }
}

/**
 * Delete a workspace.
 */
export async function deleteWorkspace(
  storage: StorageBackend,
  repoPath: string,
  name: string
): Promise<Response> {
  try {
    await workspaceRemove(storage, repoPath, name);
    return sendSuccess(NullType, null);
  } catch (err) {
    return sendError(NullType, errorToVariant(err));
  }
}

/**
 * Start deploying a package to a workspace, as a job the client polls.
 *
 * @remarks
 * A deploy that migrates a record, or builds an index over one, takes as long
 * as the record is large, which outlasts a request. So the deploy runs as a
 * job, in the compute the store dispatches it to: a local server's own
 * process, or a cloud's. The workspace's name is checked and the package
 * resolved before the job is filed, so a deploy to a name no workspace can have
 * (`invalid_name`), or of a package the repository does not hold
 * (`package_not_found`), is refused at once and files nothing, and the job
 * deploys exactly the version resolved.
 *
 * The job never opens a path-initialised input's file: its path is on the
 * machine that exported the package. Each such input is left unassigned, and
 * `e3 workspace deploy <url>` completes it over the dataset transfer protocol
 * once the job has finished.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param repo - The repository's name, which the job is filed under
 * @param workspace - Workspace name
 * @param request - The package, what the deploy does with a record it cannot
 *   keep as it is, and with an input someone set
 * @param deployStore - Where the job is filed, and dispatched from
 * @returns The response: the job's id, or the error
 */
export async function startWorkspaceDeploy(
  storage: StorageBackend,
  repoPath: string,
  repo: string,
  workspace: string,
  request: WorkspaceDeployRequest,
  deployStore: WorkspaceDeployStore,
): Promise<Response> {
  try {
    checkName('workspace', workspace);
    const { name, version: maybeVersion } = parsePackageRef(request.packageRef);
    const version = maybeVersion ?? await packageGetLatestVersion(storage, repoPath, name);
    if (version === undefined) throw new PackageNotFoundError(name);
    await packageResolve(storage, repoPath, name, version);

    const id = globalThis.crypto.randomUUID();
    await deployStore.create(id, {
      repo,
      workspace,
      packageName: name,
      packageVersion: version,
      schema: request.schema,
      inputs: request.inputs,
      allowDropRecords: request.allowDropRecords,
      plan: request.plan,
      status: variant('processing', variant('pending', null)),
      createdAt: new Date(),
    });
    await deployStore.execute(id, repo);
    return sendSuccess(PackageJobResponseType, { id });
  } catch (err) {
    return sendError(PackageJobResponseType, errorToVariant(err));
  }
}

/**
 * A deploy job's status: still running, what the deploy did, or why it did
 * not.
 *
 * @param deployStore - Where the job is filed
 * @param repo - The repository's name
 * @param workspace - Workspace name
 * @param id - The job's id
 * @returns The response: the status, or the error when this workspace started
 *   no such job
 */
export async function getWorkspaceDeployStatus(
  deployStore: WorkspaceDeployStore,
  repo: string,
  workspace: string,
  id: string,
): Promise<Response> {
  try {
    const job = await deployStore.get(id);
    if (job === null || job.repo !== repo || job.workspace !== workspace) {
      return sendError(WorkspaceDeployStatusType, variant('internal', {
        message: `workspace '${workspace}' has no deploy job '${id}'`,
      }));
    }
    return sendSuccess(WorkspaceDeployStatusType, job.status);
  } catch (err) {
    return sendError(WorkspaceDeployStatusType, errorToVariant(err));
  }
}
