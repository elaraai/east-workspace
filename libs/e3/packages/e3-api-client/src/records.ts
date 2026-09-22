/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record mutation and history client methods. Records are workspace-scoped —
 * a mutation runs the reducer server-side under optimistic concurrency and
 * returns the terminal MutationResult; history reads the commit chain.
 */

import {
  ArrayType, DateTimeType, EastTypeType, IntegerType, OptionType, StringType, StructType, VariantType, none, variant,
} from '@elaraai/east';
import type { MutationCallRequest, MutationResult, RecordHistoryResult, RecordSignature } from './types.js';
import { MutationCallRequestType, MutationResultType, RecordHistoryResultType, RecordSignatureType } from './types.js';
import { get, post, verboseQuery, type LegacyResponse, type RequestOptions } from './http.js';

const enc = encodeURIComponent;

// The record responses as servers that predate a field send them. Each is a
// frozen snapshot of the wire — never derived from the current type, which is
// exactly what moved — and its reader defaults the field as the stored-object
// decoders do: a mutation with no form is a `reduce`, a commit with no delta
// wrote none, and a conflict with no detail names no key.

/** The describe response before each mutation carried its `form`. */
const PreFormSignatureType = StructType({
  name: StringType,
  mutations: ArrayType(StructType({ name: StringType, argTypes: ArrayType(EastTypeType) })),
});

/** The history response before each commit named its `delta`. */
const PreDeltaHistoryType = StructType({
  commits: ArrayType(StructType({
    hash: StringType,
    parent: OptionType(StringType),
    state: StringType,
    mutation: StringType,
    actor: StringType,
    at: DateTimeType,
  })),
});

/** The mutation result before a conflict carried its `detail`. */
const PreDetailResultType = StructType({
  outcome: VariantType({
    committed: StructType({ commitHash: StringType, stateHash: StringType }),
    invalid:   StructType({ message: StringType }),
    failed:    StructType({ exitCode: IntegerType, stderr: StringType }),
    too_large: StructType({ bytes: IntegerType, limit: IntegerType, stderr: StringType }),
    timed_out: StructType({ ms: IntegerType, stderr: StringType }),
    conflict:  StructType({ attempts: IntegerType }),
  }),
});

const PRE_FORM_SIGNATURE: LegacyResponse<typeof RecordSignatureType, typeof PreFormSignatureType> = {
  type: PreFormSignatureType,
  upgrade: (sig) => ({
    ...sig,
    mutations: sig.mutations.map((m) => ({ ...m, form: 'reduce' })),
  }),
};

const PRE_DELTA_HISTORY: LegacyResponse<typeof RecordHistoryResultType, typeof PreDeltaHistoryType> = {
  type: PreDeltaHistoryType,
  upgrade: (history) => ({
    commits: history.commits.map((c) => ({ ...c, delta: none })),
  }),
};

const PRE_DETAIL_RESULT: LegacyResponse<typeof MutationResultType, typeof PreDetailResultType> = {
  type: PreDetailResultType,
  upgrade: ({ outcome }) => ({
    outcome: outcome.type === 'conflict' ? variant('conflict', { ...outcome.value, detail: none }) : outcome,
  }),
};

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
  return get(url, recordBase(repo, ws, record), RecordSignatureType, options, PRE_FORM_SIGNATURE);
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
    MutationCallRequestType, MutationResultType, options, extraHeaders, PRE_DETAIL_RESULT);
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
    MutationCallRequestType, MutationResultType, options, undefined, PRE_DETAIL_RESULT);
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
  return get(url, `${recordBase(repo, ws, record)}/history${query ? `?${query}` : ''}`, RecordHistoryResultType, options, PRE_DELTA_HISTORY);
}
