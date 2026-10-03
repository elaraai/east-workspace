/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, NullType, OptionType, encodeBeast2For, decodeBeast2For, some, none, variant } from '@elaraai/east';
import {
  WorkspaceStateType,
  type WorkspaceState,
  PackageJobResponseType,
  pathToString,
  type PackageExportProgress,
  type TreePath,
} from '@elaraai/e3-types';
import type {
  LockStatus, SchemaPolicy, WorkspaceDeployProgress, WorkspaceDeployResult, WorkspaceInfo, WorkspaceStatusResult,
} from './types.js';
import {
  WorkspaceInfoType,
  WorkspaceCreateRequestType,
  WorkspaceDeployRequestType,
  WorkspaceDeployStatusType,
  WorkspaceStatusResultType,
  WorkspaceExportRequestType,
  LockStatusType,
  ResponseType,
} from './types.js';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { get, post, del, fetchWithAuth, fetchWithProgress, ApiError, type RequestOptions } from './http.js';
import { JOB_POLL_MAX_MS, JOB_POLL_MIN_MS, pollExport } from './packages.js';

/**
 * List all workspaces in the repository.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param options - Request options including auth token
 * @returns Array of workspace info
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceList(url: string, repo: string, options: RequestOptions): Promise<WorkspaceInfo[]> {
  return get(url, `/repos/${encodeURIComponent(repo)}/workspaces`, ArrayType(WorkspaceInfoType), options);
}

/**
 * Create a new empty workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param options - Request options including auth token
 * @returns Created workspace info
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceCreate(url: string, repo: string, name: string, options: RequestOptions): Promise<WorkspaceInfo> {
  return post(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces`,
    { name },
    WorkspaceCreateRequestType,
    WorkspaceInfoType,
    options
  );
}

/**
 * Get workspace state (deployed package info and current root hash).
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param options - Request options including auth token
 * @returns Workspace state
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceGet(url: string, repo: string, name: string, options: RequestOptions): Promise<WorkspaceState> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(name)}`,
    WorkspaceStateType,
    options
  );
}

/** What {@link workspaceStatus} answers for. */
export interface WorkspaceStatusQuery {
  /**
   * The datasets to answer for, such as those a view binds. The answer then
   * holds those the workspace has, and the tasks that produce them, each with
   * the status the whole workspace's answer gives it; a path that names no
   * dataset of the workspace is left out. The whole workspace when omitted or
   * empty.
   */
  paths?: readonly TreePath[];
}

/**
 * Get comprehensive workspace status including datasets, tasks, and lock info.
 *
 * Use this to poll for execution progress after calling dataflowExecuteLaunch().
 * A poll that follows a few datasets asks for those (`query.paths`), and costs
 * the server what it follows rather than the workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param options - Request options including auth token
 * @param query - The datasets to answer for; the whole workspace when omitted
 * @returns Workspace status with datasets, tasks, and summary
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceStatus(
  url: string,
  repo: string,
  name: string,
  options: RequestOptions,
  query: WorkspaceStatusQuery = {},
): Promise<WorkspaceStatusResult> {
  const params = new URLSearchParams();
  for (const path of query.paths ?? []) params.append('path', pathToString(path));
  const search = params.toString();
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(name)}/status${search === '' ? '' : `?${search}`}`,
    WorkspaceStatusResultType,
    options
  );
}

/**
 * What holds a workspace exclusively, and how far that operation says it has
 * got.
 *
 * @remarks
 * A workspace deployed for the first time has no status until its deploy
 * ends: {@link workspaceStatus} answers `workspace_not_deployed` meanwhile. Its
 * lock says a deploy holds it, and how far the deploy has got with its file
 * sources and its records.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param options - Request options including auth token
 * @returns The lock's state and what its holder last reported, or null when
 *   nothing holds the workspace exclusively
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceLockStatus(url: string, repo: string, name: string, options: RequestOptions): Promise<LockStatus | null> {
  const status = await get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(name)}/lock`,
    OptionType(LockStatusType),
    options
  );
  return status.type === 'some' ? status.value : null;
}

/**
 * Remove a workspace.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param options - Request options including auth token
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceRemove(url: string, repo: string, name: string, options: RequestOptions): Promise<void> {
  await del(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(name)}`,
    NullType,
    options
  );
}

/**
 * Options for a workspace deploy.
 */
export interface WorkspaceDeployOptions {
  /** What the deploy does with a record it cannot keep as it is (default
   *  `migrate`). */
  schema?: SchemaPolicy;
  /** Whether a record the package no longer declares may be dropped, with its
   *  state and history (default false). */
  allowDropRecords?: boolean;
  /** Say what the deploy would do, and write nothing (default false). */
  plan?: boolean;
  /** Called with the job's progress each time a poll finds it running. */
  onProgress?: (progress: WorkspaceDeployProgress) => void;
  signal?: AbortSignal;
}

/**
 * Deploy a package to a workspace.
 *
 * @remarks
 * The server runs the deploy as a job, since one that migrates a record, or
 * builds an index over one, can outlast a request. This starts the job and
 * polls it until it answers: 100 ms apart at first, backing off to a second.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param name - Workspace name
 * @param packageRef - Package reference (name or name@version)
 * @param options - Request options including auth token
 * @param deployOptions - What the deploy does with a record it cannot keep,
 *   whether it only plans, and its progress and cancellation
 * @returns What the deploy decided for each record and index, and the inputs
 *   it left unassigned
 * @throws {ApiError} When the server does not start the deploy, such as for a
 *   package the repository does not hold
 * @throws {AuthError} On 401 Unauthorized
 * @throws {Error} When the deploy fails, or refuses a record
 */
export async function workspaceDeploy(
  url: string,
  repo: string,
  name: string,
  packageRef: string,
  options: RequestOptions,
  deployOptions: WorkspaceDeployOptions = {},
): Promise<WorkspaceDeployResult> {
  const path = `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(name)}/deploy`;
  const { id } = await post(
    url,
    path,
    {
      packageRef,
      schema: variant(deployOptions.schema ?? 'migrate', null),
      allowDropRecords: deployOptions.allowDropRecords ?? false,
      plan: deployOptions.plan ?? false,
    },
    WorkspaceDeployRequestType,
    PackageJobResponseType,
    options,
  );

  for (let wait = JOB_POLL_MIN_MS; ; wait = Math.min(wait * 2, JOB_POLL_MAX_MS)) {
    deployOptions.signal?.throwIfAborted();
    const status = await get(url, `${path}/${encodeURIComponent(id)}`, WorkspaceDeployStatusType, options);
    if (status.type === 'completed') return status.value;
    if (status.type === 'failed') throw new Error(`Workspace deploy failed: ${status.value.message}`);
    deployOptions.onProgress?.(status.value);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/**
 * Options for workspace export progress reporting.
 */
export interface WorkspaceExportOptions {
  name?: string;
  version?: string;
  onProgress?: (progress: PackageExportProgress) => void;
  onDownloadProgress?: (downloaded: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Export workspace as a package zip archive.
 *
 * Uses the async transfer protocol: POST to trigger → poll for progress → download.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param options - Request options including auth token
 * @param exportOptions - Optional progress callbacks
 * @returns Zip archive as bytes
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceExport(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions,
  exportOptions?: WorkspaceExportOptions,
): Promise<Uint8Array> {
  const repoEncoded = encodeURIComponent(repo);
  const wsEncoded = encodeURIComponent(workspace);
  const signal = exportOptions?.signal;

  // 1. Trigger workspace export
  const encodeReq = encodeBeast2For(WorkspaceExportRequestType);
  const body = encodeReq({
    name: exportOptions?.name ? some(exportOptions.name) : none,
    version: exportOptions?.version ? some(exportOptions.version) : none,
  });
  const triggerRes = await fetchWithAuth(`${url}/api/repos/${repoEncoded}/workspaces/${wsEncoded}/export`, {
    method: 'POST',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
    },
    body,
    signal,
  }, options);

  if (!triggerRes.ok) throw new Error(`Workspace export failed: ${triggerRes.status} ${triggerRes.statusText}`);

  const triggerBuffer = new Uint8Array(await triggerRes.arrayBuffer());
  const decodeTrigger = decodeBeast2For(ResponseType(PackageJobResponseType));
  const triggerResult = decodeTrigger(triggerBuffer) as { type: 'success'; value: { id: string } } | { type: 'error'; value: { type: string; value: string } };
  if (triggerResult.type === 'error') throw new ApiError(triggerResult.value.type, triggerResult.value.value);

  // 2. Poll for result
  const status = await pollExport(url, repoEncoded, triggerResult.value.id, options, exportOptions?.onProgress, signal);

  if (status.type === 'failed') {
    throw new Error(`Workspace export failed: ${status.value.message}`);
  }
  if (status.type !== 'completed') {
    throw new Error('Unexpected job status');
  }

  const { downloadUrl } = status.value;

  // 3. Download zip (no auth — URL may be a presigned S3 URL)
  return fetchWithProgress(downloadUrl, exportOptions?.onDownloadProgress, signal, options.fetch);
}

