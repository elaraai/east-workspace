/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Handlers for record mutations and history.
 *
 * A mutation is the only write door into a record: it runs a pure East reducer
 * server-side under optimistic concurrency and appends an audited commit.
 * History is a read of the commit chain. Both are workspace-scoped — a record's
 * state is live, so there is no package-scoped form.
 */

import { variant } from '@elaraai/east';
import { recordMutate, recordHistory, recordDescribe, recordCompact, DatasetNotFoundError } from '@elaraai/e3-core';
import type { StorageBackend, TaskRunner, MutationOutcome } from '@elaraai/e3-core';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import {
  MutationResultType,
  RecordHistoryResultType,
  RecordSignatureType,
  type MutationResult,
  type MutationCallRequest,
  type ExecuteLimits,
} from '../types.js';

// Mutations persist their new state, so the result cap is far higher than the
// 1 MB inline-result default for function calls.
const DEFAULT_LIMITS = { timeoutMs: 60_000, maxResultBytes: 64 * 1024 * 1024, maxLogBytes: 64 * 1024 };
const MAX_TIMEOUT_MS = 10 * 60_000;
const MAX_RESULT_BYTES = 256 * 1024 * 1024;
const MAX_LOG_BYTES = 256 * 1024;

/** Wall-clock reserved (ms) below a caller's mutation budget for the final,
 *  non-preemptible commit write + response encode. Best-effort: a very large
 *  remote state write can still overrun, so the budget is a strong-but-not-hard
 *  bound on a typed terminal. Must stay below the smallest supported budget. */
const MUTATION_BUDGET_HEADROOM_MS = 2_000;

/** Reduce a caller's wall-clock mutation budget by the commit/encode headroom,
 *  flooring at 1ms. Returns undefined when no budget is supplied (the default
 *  local behaviour — no gateway, so no cap). Pure; unit-tested directly. */
export function effectiveBudgetMs(budgetMs: number | undefined): number | undefined {
  if (budgetMs === undefined) return undefined;
  return Math.max(1, budgetMs - MUTATION_BUDGET_HEADROOM_MS);
}

/** Per-call mutation controls supplied by the server boundary (not the client
 *  body): a wall-clock budget, a request/deadline abort signal, and an
 *  idempotency key carried out-of-band (HTTP header). */
export interface MutationCallControls {
  /** Wall-clock budget for the whole call (e.g. a cloud gateway timeout). */
  budgetMs?: number;
  /** Request abort signal (e.g. client disconnect). */
  signal?: AbortSignal;
  /** Client idempotency key (the `Idempotency-Key` header). */
  idempotencyKey?: string;
  /** Pass `-v` to the reducer's runner (known runtimes only) — timing/perf to
   *  stderr. Runtime-only; never affects hashing or caching. */
  verbose?: boolean;
}

function resolveLimits(limits: { type: 'some'; value: ExecuteLimits } | { type: 'none'; value: null }) {
  const req = limits.type === 'some' ? limits.value : undefined;
  const timeoutMs = Math.min(req && req.timeoutMs.type === 'some' ? Number(req.timeoutMs.value) : DEFAULT_LIMITS.timeoutMs, MAX_TIMEOUT_MS);
  const maxResultBytes = Math.min(req && req.maxResultBytes.type === 'some' ? Number(req.maxResultBytes.value) : DEFAULT_LIMITS.maxResultBytes, MAX_RESULT_BYTES);
  const maxLogBytes = Math.min(req && req.maxLogBytes.type === 'some' ? Number(req.maxLogBytes.value) : DEFAULT_LIMITS.maxLogBytes, MAX_LOG_BYTES);
  return { timeoutMs: Math.max(1, timeoutMs), maxResultBytes: Math.max(1, maxResultBytes), maxLogBytes: Math.max(0, maxLogBytes) };
}

/** Map the e3-core mutation outcome to the wire result. */
function outcomeToResult(outcome: MutationOutcome): MutationResult {
  switch (outcome.kind) {
    case 'committed':
      return { outcome: variant('committed', { commitHash: outcome.commitHash, stateHash: outcome.stateHash }) };
    case 'invalid':
      return { outcome: variant('invalid', { message: outcome.message }) };
    case 'failed':
      return { outcome: variant('failed', { exitCode: BigInt(outcome.exitCode), stderr: outcome.stderr }) };
    case 'too_large':
      return { outcome: variant('too_large', { bytes: BigInt(outcome.bytes), limit: BigInt(outcome.limit), stderr: outcome.stderr }) };
    case 'timed_out':
      return { outcome: variant('timed_out', { ms: BigInt(outcome.ms), stderr: outcome.stderr }) };
    case 'conflict':
      return { outcome: variant('conflict', { attempts: BigInt(outcome.attempts) }) };
  }
}

/**
 * Describe a record's mutations (name + extra arg types) so dynamic callers
 * can encode arguments.
 */
export async function describeRecord(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  record: string,
): Promise<Response> {
  try {
    const sig = await recordDescribe(storage, repoPath, workspace, record);
    if (!sig) {
      return sendError(RecordSignatureType, errorToVariant(new DatasetNotFoundError(workspace, record)));
    }
    return sendSuccess(RecordSignatureType, sig);
  } catch (err) {
    return sendError(RecordSignatureType, errorToVariant(err));
  }
}

/**
 * Apply a mutation to a record synchronously, returning the terminal
 * MutationResult.
 *
 * When `authoritative` is true (an authenticated request), the server-derived
 * `actor` is recorded and the client-supplied `req.actor` is ignored, so the
 * audit trail attributes the commit to the verified principal and cannot be
 * forged. Without auth (single-tenant local), `req.actor` is honoured.
 *
 * `controls` carries server-boundary concerns the client body does not: a
 * wall-clock `budgetMs` (so the CAS loop returns a typed terminal before a
 * gateway timeout), an abort `signal` (e.g. client disconnect), and an
 * `idempotencyKey` (the `Idempotency-Key` header) so a retried call after a
 * gateway timeout does not double-apply.
 *
 * @param controls - Optional per-call budget / abort signal / idempotency key.
 */
export async function callMutationSync(
  storage: StorageBackend,
  repoPath: string,
  runner: TaskRunner,
  workspace: string,
  record: string,
  mutation: string,
  req: MutationCallRequest,
  actor: string,
  authoritative: boolean,
  controls: MutationCallControls = {},
): Promise<Response> {
  try {
    const effectiveActor = !authoritative && req.actor.type === 'some' ? req.actor.value : actor;
    const outcome = await recordMutate(
      storage, runner, repoPath, workspace, record, mutation,
      req.args,
      {
        actor: effectiveActor,
        limits: resolveLimits(req.limits),
        budgetMs: effectiveBudgetMs(controls.budgetMs),
        signal: controls.signal,
        idempotencyKey: controls.idempotencyKey,
        verbose: controls.verbose,
      },
    );
    return sendSuccess(MutationResultType, outcomeToResult(outcome));
  } catch (err) {
    return sendError(MutationResultType, errorToVariant(err));
  }
}

/**
 * Compact a record's history, returning the terminal MutationResult of the
 * `$compact` commit.
 */
export async function compactRecord(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  record: string,
  actor: string,
): Promise<Response> {
  try {
    const outcome = await recordCompact(storage, repoPath, workspace, record, { actor });
    return sendSuccess(MutationResultType, outcomeToResult(outcome));
  } catch (err) {
    return sendError(MutationResultType, errorToVariant(err));
  }
}

/**
 * Return a record's commit history, newest first.
 */
export async function getRecordHistory(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  record: string,
  limit: number | undefined,
  from: string | undefined,
): Promise<Response> {
  try {
    const entries = await recordHistory(storage, repoPath, workspace, record, { limit, from });
    const commits = entries.map((e) => ({
      hash: e.hash,
      parent: e.commit.parent,
      state: e.commit.state,
      mutation: e.commit.mutation,
      actor: e.commit.actor,
      at: e.commit.at,
    }));
    return sendSuccess(RecordHistoryResultType, { commits });
  } catch (err) {
    return sendError(RecordHistoryResultType, errorToVariant(err));
  }
}
