/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { StringType, NullType } from '@elaraai/east';
import { RepositoryRecordType, type RepositoryRecord } from '@elaraai/e3-types';
import type {
  RepositoryStatus,
  RepositoryRemoval,
  GcRequest,
  GcResult,
  GcStartResult,
  GcStatusResult,
} from './types.js';
import {
  RepositoryStatusType,
  RepositoryRemovalType,
  GcRequestType,
  GcStartResultType,
  GcStatusResultType,
} from './types.js';
import { ApiError, get, post, putEmpty, requestAnswered, type RequestOptions } from './http.js';

/**
 * Get repository status.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param options - Request options including auth token
 * @returns Repository status including object, package, and workspace counts
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoStatus(url: string, repo: string, options: RequestOptions): Promise<RepositoryStatus> {
  return get(url, `/repos/${encodeURIComponent(repo)}/status`, RepositoryStatusType, options);
}

/**
 * Get a repository's record: the release of e3 that last wrote it, and the
 * store upgrades it has had, which an open applies to a repository an older
 * release wrote.
 *
 * @remarks
 * A read: the server applies no upgrade for it. A repository that owes one the
 * server has not yet applied is answered 503, which is asked again as its
 * `Retry-After` says, as long as the retry policy allows.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param options - Request options including auth token
 * @returns The repository's record
 * @throws {ApiError} `repository_upgrade_pending` when the repository still
 *   owes an upgrade once the retries are spent; another code on another
 *   application-level error
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoRecord(url: string, repo: string, options: RequestOptions): Promise<RepositoryRecord> {
  return get(url, `/repos/${encodeURIComponent(repo)}/record`, RepositoryRecordType, options);
}

/**
 * Start garbage collection (async).
 *
 * Returns immediately with an executionId. Use repoGcStatus() to poll for completion.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param gcOptions - GC options (dryRun to preview without deleting)
 * @param options - Request options including auth token
 * @returns GC start result with executionId
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoGcStart(url: string, repo: string, gcOptions: GcRequest, options: RequestOptions): Promise<GcStartResult> {
  return post(url, `/repos/${encodeURIComponent(repo)}/gc`, gcOptions, GcRequestType, GcStartResultType, options);
}

/**
 * Get garbage collection status.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param executionId - Execution ID from repoGcStart()
 * @param options - Request options including auth token
 * @returns GC status with stats when complete
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoGcStatus(url: string, repo: string, executionId: string, options: RequestOptions): Promise<GcStatusResult> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/gc/${encodeURIComponent(executionId)}`,
    GcStatusResultType,
    options
  );
}

/**
 * Run garbage collection and wait for completion (convenience wrapper).
 *
 * Starts GC and polls until complete. Throws on error.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param gcOptions - GC options (dryRun to preview without deleting)
 * @param options - Request options including auth token
 * @param pollOptions - Polling options (interval in ms, default 500)
 * @returns GC result with counts and freed bytes
 */
export async function repoGc(
  url: string,
  repo: string,
  gcOptions: GcRequest,
  options: RequestOptions,
  pollOptions: { pollInterval?: number } = {}
): Promise<GcResult> {
  const pollInterval = pollOptions.pollInterval ?? 500;

  // Start GC
  const { executionId } = await repoGcStart(url, repo, gcOptions, options);

  // Poll until complete
  while (true) {
    const status = await repoGcStatus(url, repo, executionId, options);

    if (status.status.type === 'succeeded') {
      if (status.stats.type !== 'some') {
        throw new Error('GC succeeded but no stats returned');
      }
      return status.stats.value;
    }

    if (status.status.type === 'failed') {
      const errorMsg = status.error.type === 'some' ? status.error.value : 'Unknown error';
      throw new Error(`GC failed: ${errorMsg}`);
    }

    // Still running, wait and poll again
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

/**
 * Create a new repository.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Name for the new repository
 * @param options - Request options including auth token
 * @returns The created repository name
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoCreate(url: string, name: string, options: RequestOptions): Promise<string> {
  return putEmpty(url, `/repos/${encodeURIComponent(name)}`, StringType, options);
}

/** How long {@link repoRemove} waits between asks of a removal under way
 *  when its server names no `Retry-After`, in milliseconds. */
const REMOVAL_POLL_MS = 1_000;

/** The longest {@link repoRemove} waits between asks of a removal under way,
 *  whatever its server's `Retry-After`, in milliseconds. */
const REMOVAL_POLL_MAX_MS = 30_000;

/**
 * How {@link repoRemove} follows a removal its server finishes after
 * answering.
 */
export interface RepoRemoveOptions {
  /** Called once when the server answers that the removal is under way, as
   *  the client waits for it to finish */
  onWaiting?: () => void;
}

/**
 * Remove a repository, and answer once it is gone.
 *
 * @remarks
 * A server that removes the repository within the request answers 200, as
 * the local one does. One whose removal outlasts a request answers
 * `202 Accepted`, naming in `Location` the route that says how the removal
 * goes ({@link RepositoryRemovalType}) and in `Retry-After` when to ask: the
 * client asks it, as each answer's `Retry-After` says, until it answers
 * `removed` or `repository_not_found`, and raises the reason it gives when it
 * answers `failed`. So a repository removed and then created again under its
 * name is created once the removal is done. A 202 that names no route is taken
 * as done, as every answer was before servers named one.
 *
 * @param url - Base URL of the e3 API server
 * @param name - Repository name to remove
 * @param options - Request options including auth token
 * @param removeOptions - What hears that the removal is under way
 * @throws {ApiError} On application-level errors; `repository_removal_failed`,
 *   with its reason, when the removal stopped
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoRemove(
  url: string,
  name: string,
  options: RequestOptions,
  removeOptions: RepoRemoveOptions = {},
): Promise<void> {
  const removing = await requestAnswered(`${url}/api/repos/${encodeURIComponent(name)}`, 'DELETE', NullType, options);
  if (!removing.accepted || removing.location === null) return;
  removeOptions.onWaiting?.();

  let wait = removing.retryAfterMs;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait ?? REMOVAL_POLL_MS, REMOVAL_POLL_MAX_MS)));
    let removal: RepositoryRemoval;
    try {
      const asked = await requestAnswered(removing.location, 'GET', RepositoryRemovalType, options);
      removal = asked.value;
      wait = asked.retryAfterMs;
    } catch (err) {
      // A route of a repository that is gone may say so.
      if (err instanceof ApiError && err.code === 'repository_not_found') return;
      throw err;
    }
    if (removal.type === 'removed') return;
    if (removal.type === 'failed') throw new ApiError('repository_removal_failed', removal.value.message);
  }
}

