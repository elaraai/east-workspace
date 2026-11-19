/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record mutation and history client methods. Records are workspace-scoped —
 * a mutation runs its program server-side under optimistic concurrency and
 * returns the terminal MutationResult; history reads the commit chain; and a
 * delivery is loaded into a composite record's external source as a job the
 * client follows.
 */

import { NullType, none } from '@elaraai/east';
import { PackageJobResponseType } from '@elaraai/e3-types';
import type {
  MutationCallRequest, MutationResult, RecordHistoryResult, RecordLoadProgress, RecordLoadRequest, RecordLoadResult, RecordLoadStatus,
  RecordSignature,
} from './types.js';
import {
  MutationCallRequestType, MutationResultType, RecordHistoryResultType, RecordLoadRequestType, RecordLoadStatusType, RecordSignatureType,
} from './types.js';
import { get, post, sleep, verboseQuery, type RequestOptions } from './http.js';
import { JOB_POLL_MAX_MS, JOB_POLL_MIN_MS } from './packages.js';

const enc = encodeURIComponent;

function recordBase(repo: string, ws: string, record: string): string {
  return `/repos/${enc(repo)}/workspaces/${enc(ws)}/records/${enc(record)}`;
}

/** Describe a record's mutations (name + extra arg types), for encoding args. */
export async function workspaceRecordDescribe(
  url: string,
  repo: string,
  ws: string,
  record: string,
  options: RequestOptions,
): Promise<RecordSignature> {
  return get(url, recordBase(repo, ws, record), RecordSignatureType, options);
}

/**
 * Apply a mutation to a record synchronously, returning its terminal result.
 * @param idempotencyKey - Sent as the `Idempotency-Key` header so a retry after a gateway timeout cannot double-apply.
 */
export async function workspaceRecordMutate(
  url: string,
  repo: string,
  ws: string,
  record: string,
  mutation: string,
  req: MutationCallRequest,
  options: RequestOptions,
  idempotencyKey?: string,
): Promise<MutationResult> {
  // Idempotency travels as a header (not the Beast2 body), so retrying a call
  // after a gateway timeout cannot double-apply, and adding it changes no wire
  // type — an un-upgraded server simply ignores the header.
  const extraHeaders = idempotencyKey !== undefined ? { 'Idempotency-Key': idempotencyKey } : undefined;
  return post(url, verboseQuery(`${recordBase(repo, ws, record)}/mutations/${enc(mutation)}`, options), req,
    MutationCallRequestType, MutationResultType, options, extraHeaders);
}

/** Compact a record's history (drops the prior chain), returning the result of
 *  the `$compact` commit. Elevated role when the server has auth configured. */
export async function workspaceRecordCompact(
  url: string,
  repo: string,
  ws: string,
  record: string,
  options: RequestOptions,
): Promise<MutationResult> {
  return post(url, `${recordBase(repo, ws, record)}/compact`, { args: [], actor: none, limits: none },
    MutationCallRequestType, MutationResultType, options);
}

/** Fetch a record's commit history (newest first); page with `from` (a commit
 *  hash to start the walk at) and bound with `limit`. */
export async function workspaceRecordHistory(
  url: string,
  repo: string,
  ws: string,
  record: string,
  limit: number | undefined,
  options: RequestOptions,
  from?: string,
): Promise<RecordHistoryResult> {
  const params = new URLSearchParams();
  if (from !== undefined) params.set('from', from);
  if (limit !== undefined) params.set('limit', String(limit));
  const query = params.toString();
  return get(url, `${recordBase(repo, ws, record)}/history${query ? `?${query}` : ''}`, RecordHistoryResultType, options);
}

/** A record source's loads, under its record's routes. */
function loadBase(repo: string, ws: string, record: string, source: string): string {
  return `${recordBase(repo, ws, record)}/loads/${enc(source)}`;
}

/**
 * Launch a load of a delivery into an external source of a composite record,
 * as a job the caller polls. {@link workspaceRecordLoad} launches one and
 * follows it to its end.
 *
 * @remarks
 * The job takes its turn among its source's loads, so it may wait for an
 * earlier one first. A record or source no delivery is loaded into, and a
 * source the dataflow loads from its feed, fail the job at once, saying why.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - Workspace name
 * @param record - The record's name
 * @param source - The source's name: one a delivery is loaded into
 * @param request - The delivery, by the hash of an object the repository
 *   holds ({@link objectUpload} uploads one), its as-of, and who asks
 * @param options - Request options including auth token
 * @returns The job's id
 * @throws {ApiError} `permission_denied` (`path` `<record>.<source>`) for a
 *   caller the host does not let load it, and other application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceRecordLoadLaunch(
  url: string,
  repo: string,
  ws: string,
  record: string,
  source: string,
  request: RecordLoadRequest,
  options: RequestOptions,
): Promise<{ id: string }> {
  return post(url, loadBase(repo, ws, record, source), request, RecordLoadRequestType, PackageJobResponseType, options);
}

/**
 * A load's status: how far its job has got, what the load did, why it did
 * not, or that it was cancelled.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace the load was launched in
 * @param record - The record's name
 * @param source - The source's name
 * @param id - The job's id
 * @param options - Request options including auth token
 * @returns The status
 * @throws {ApiError} `internal` when the workspace launched no such load of
 *   the record's source, and other application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceRecordLoadStatus(
  url: string,
  repo: string,
  ws: string,
  record: string,
  source: string,
  id: string,
  options: RequestOptions,
): Promise<RecordLoadStatus> {
  return get(url, `${loadBase(repo, ws, record, source)}/${enc(id)}`, RecordLoadStatusType, options);
}

/**
 * Ask a load to cancel.
 *
 * @remarks
 * The job reads the request within a second as it runs, and only the job
 * writes its end: stopped before its commit wrote, it ends `cancelled`, and
 * its finished pieces stay cached for a load of the delivery again; once its
 * commit has written, the load has landed, and it ends `completed`. A load
 * that has ended is left as it is.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace the load was launched in
 * @param record - The record's name
 * @param source - The source's name
 * @param id - The job's id
 * @param options - Request options including auth token
 * @returns The job's status as it stands once the request is recorded: still
 *   `processing`, to be followed to its end, or the end it had come to
 * @throws {ApiError} `permission_denied` as {@link workspaceRecordLoadLaunch}
 *   throws it, and `internal` as {@link workspaceRecordLoadStatus} does
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceRecordLoadCancel(
  url: string,
  repo: string,
  ws: string,
  record: string,
  source: string,
  id: string,
  options: RequestOptions,
): Promise<RecordLoadStatus> {
  return post(url, `${loadBase(repo, ws, record, source)}/${enc(id)}/cancel`, null, NullType, RecordLoadStatusType, options);
}

/** Options for {@link workspaceRecordLoad}. */
export interface RecordLoadOptions {
  /** Called with the job's progress each time a poll finds it running and
   *  saying how far it has got, until a cancel is asked. */
  onProgress?: (progress: RecordLoadProgress) => void;
  /** Cancels the load: once it aborts, the job is asked to cancel
   *  ({@link workspaceRecordLoadCancel}) and followed to the end it writes. */
  signal?: AbortSignal;
}

/** A load's job once it has ended: every status but `processing`. */
type RecordLoadEnd = Exclude<RecordLoadStatus, { type: 'processing' }>;

/**
 * Load a delivery into an external source of a composite record: launch the
 * load as a job, and poll it to its end, 100 ms apart at first, backing off to
 * a second.
 *
 * @remarks
 * A signal that aborts asks the job to cancel and follows it to the end the
 * job writes, telling `onProgress` nothing more. A load stopped before its
 * commit wrote ends cancelled, and this rejects with the signal's reason. One
 * whose commit had written has landed, and this answers what it did, as it
 * would have: the caller tells it was too late to cancel by its signal.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - Workspace name
 * @param record - The record's name
 * @param source - The source's name: one a delivery is loaded into
 * @param request - The delivery, by the hash of an object the repository
 *   holds ({@link objectUpload} uploads one), its as-of, and who asks
 * @param options - Request options including auth token
 * @param loadOptions - Its progress, and the signal that cancels it
 * @returns What the load did: the delivery `loaded` in one commit, with its
 *   counts; the source's last delivery loaded `again`, which ran nothing; or
 *   a delivery `superseded` by a later one, which ran nothing
 * @throws {ApiError} As {@link workspaceRecordLoadLaunch} does
 * @throws {AuthError} On 401 Unauthorized
 * @throws {Error} When the load failed, in its job's words; or it was
 *   cancelled by another caller, so nothing was loaded
 * @throws The signal's reason once it aborts and the load is cancelled, or
 *   before it is launched
 */
export async function workspaceRecordLoad(
  url: string,
  repo: string,
  ws: string,
  record: string,
  source: string,
  request: RecordLoadRequest,
  options: RequestOptions,
  loadOptions: RecordLoadOptions = {},
): Promise<RecordLoadResult> {
  const { signal } = loadOptions;
  signal?.throwIfAborted();
  const { id } = await workspaceRecordLoadLaunch(url, repo, ws, record, source, request, options);
  const end = await recordLoadEnd(url, repo, ws, record, source, id, options, loadOptions);
  if (end.type === 'completed') return end.value;
  if (end.type === 'failed') throw new Error(end.value.message);
  if (signal?.aborted === true) throw signal.reason;
  throw new Error(`the load of ${record}.${source} was cancelled before it committed: nothing loaded`);
}

/**
 * Polls a load's job until it ends, telling `onProgress` how far it has got.
 * Once `signal` aborts, it asks the job to cancel and follows it to the end
 * the job writes (ruling 28).
 *
 * @returns The status it ended with
 */
async function recordLoadEnd(
  url: string,
  repo: string,
  ws: string,
  record: string,
  source: string,
  id: string,
  options: RequestOptions,
  loadOptions: RecordLoadOptions,
): Promise<RecordLoadEnd> {
  const { signal } = loadOptions;
  for (let wait = JOB_POLL_MIN_MS; ; wait = Math.min(wait * 2, JOB_POLL_MAX_MS)) {
    if (signal?.aborted === true) {
      // Only the job writes its end: cancelled before its commit wrote,
      // completed after, so the request is followed to it.
      let status = await workspaceRecordLoadCancel(url, repo, ws, record, source, id, options);
      for (let pause = JOB_POLL_MIN_MS; status.type === 'processing'; pause = Math.min(pause * 2, JOB_POLL_MAX_MS)) {
        await sleep(pause);
        status = await workspaceRecordLoadStatus(url, repo, ws, record, source, id, options);
      }
      return status;
    }
    const status = await workspaceRecordLoadStatus(url, repo, ws, record, source, id, options);
    if (status.type !== 'processing') return status;
    if (status.value.type === 'some') loadOptions.onProgress?.(status.value.value);
    // An abort ends the wait at once, and the next turn asks the job to cancel
    await sleep(wait, signal).catch(() => undefined);
  }
}
