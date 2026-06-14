/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record mutation and history client methods. Records are workspace-scoped —
 * a mutation runs the reducer server-side under optimistic concurrency and
 * returns the terminal MutationResult; history reads the commit chain.
 */

import type { MutationCallRequest, MutationResult, RecordHistoryResult, RecordSignature } from './types.js';
import { MutationCallRequestType, MutationResultType, RecordHistoryResultType, RecordSignatureType } from './types.js';
import { get, post, type RequestOptions } from './http.js';

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

/** Apply a mutation to a record synchronously, returning its terminal result. */
export async function workspaceRecordMutate(
  url: string,
  repo: string,
  ws: string,
  record: string,
  mutation: string,
  req: MutationCallRequest,
  options: RequestOptions,
): Promise<MutationResult> {
  return post(url, `${recordBase(repo, ws, record)}/mutations/${enc(mutation)}`, req, MutationCallRequestType, MutationResultType, options);
}

/** Fetch a record's commit history (newest first), optionally limited. */
export async function workspaceRecordHistory(
  url: string,
  repo: string,
  ws: string,
  record: string,
  limit: number | undefined,
  options: RequestOptions,
): Promise<RecordHistoryResult> {
  const query = limit !== undefined ? `?limit=${limit}` : '';
  return get(url, `${recordBase(repo, ws, record)}/history${query}`, RecordHistoryResultType, options);
}
