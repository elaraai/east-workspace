/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record mutation execution — the write half of the function machinery.
 *
 * A mutation is a pure East reducer `(State, ...Args) => State` run via the
 * graph-free {@link runDetached} kernel in a compare-and-swap retry loop:
 * read state → reduce → write new state + commit objects → conditional ref
 * write; retry on conflict. A crash at any point leaves only unreferenced
 * objects (GC reclaims them) — never a torn record. The reducer's purity is
 * what makes re-running against fresher state safe.
 */

import { variant, some, none, ArrayType, BlobType, encodeBeast2For, decodeBeast2For, type EastTypeValue } from '@elaraai/east';
import {
  RecordObjectType,
  MutationObjectType,
  RecordCommitType,
  decodePackageObject,
  type RecordCommit,
} from '@elaraai/e3-types';
import { workspaceGetPackage } from './workspaces.js';
import { refPathToKeypath } from './dataset-refs.js';
import { DatasetRefConflictError, WorkspaceLockError } from './errors.js';
import type { StorageBackend, LockHandle } from './storage/interfaces.js';
import type { TaskRunner } from './execution/interfaces.js';
import type { DetachedResult } from './execution/runDetached.js';

const encodeCommit = encodeBeast2For(RecordCommitType);
const decodeCommit = decodeBeast2For(RecordCommitType);
const decodeRecordObject = decodeBeast2For(RecordObjectType);
const decodeMutationObject = decodeBeast2For(MutationObjectType);
const encodeArgsTuple = encodeBeast2For(ArrayType(BlobType));

/** Mutations persist their (potentially large) new state, so the result cap is
 *  far higher than the 1 MB inline-result default for function calls. */
export interface RecordMutateLimits {
  timeoutMs: number;
  maxResultBytes: number;
  maxLogBytes: number;
}

const DEFAULT_LIMITS: RecordMutateLimits = {
  timeoutMs: 60_000,
  maxResultBytes: 64 * 1024 * 1024,
  maxLogBytes: 64 * 1024,
};

/** Wall-clock budget for the compare-and-swap retry loop. Because each conflict
 *  means another writer committed (real progress), a hot record converges; the
 *  loop is deadline-bounded rather than capped at a fixed attempt count (which a
 *  thundering herd would exhaust, dropping a write). */
const DEFAULT_MAX_RETRY_MS = 30_000;

/** Reserved version-vector slot holding the last committed idempotency key. The
 *  `$`-prefix keeps it out of the structural keypath space, so change detection
 *  (snapshotInputVersions) never reads it and dataflow staleness is unaffected.
 *  Stored in the ref (not the commit) so adding it changes no persisted struct
 *  schema — old commit/ref blobs still decode. */
const IDEM_SLOT = '$idem';

/**
 * The outcome of a mutation attempt. Only `committed` writes anything durable;
 * every other outcome leaves the repo byte-identical (bar unreferenced objects
 * GC reclaims).
 */
export type MutationOutcome =
  /** New state + commit written, record ref swung to the new commit. */
  | { kind: 'committed'; commitHash: string; stateHash: string }
  /** Lookup/arity error — nothing ran. */
  | { kind: 'invalid'; message: string }
  /** The reducer process exited non-zero (incl. a reducer `$.error`). */
  | { kind: 'failed'; exitCode: number; stderr: string }
  /** The reducer exceeded its time budget. */
  | { kind: 'timed_out'; ms: number; stderr: string }
  /** The new state exceeded the result-size cap. */
  | { kind: 'too_large'; bytes: number; limit: number; stderr: string }
  /** The compare-and-swap lost the race `attempts` times. */
  | { kind: 'conflict'; attempts: number };

export interface RecordMutateOptions {
  /** Caller identity recorded on the commit (auth principal / `cli:<user>`). */
  actor: string;
  /** Execution limits; sensible record defaults applied when omitted. */
  limits?: RecordMutateLimits;
  /** Wall-clock budget for CAS retries (default 30s); on expiry returns conflict. */
  maxRetryMs?: number;
  /** Hard wall-clock budget for the WHOLE call (reducer runs included). When set,
   *  the loop returns a typed `conflict`/`timed_out` before this deadline rather
   *  than risking a caller's gateway timeout: each iteration is gated on the
   *  deadline and each reducer run's `timeoutMs` is clamped to the time
   *  remaining. Omit for the unbounded local behaviour. */
  budgetMs?: number;
  /** Optional client idempotency key. When the record's last mutation carried
   *  this same key, the reducer is NOT re-run and the prior commit is returned —
   *  so a client retrying after a gateway timeout cannot double-apply. */
  idempotencyKey?: string;
  /** Optional hard cap on CAS attempts (mainly for tests forcing a conflict). */
  maxAttempts?: number;
  /** Cancellation — aborts the in-flight reducer execution (how is the runner's
   *  concern: a local runner kills the process group, a remote one cancels the
   *  invocation). */
  signal?: AbortSignal;
  /** Externally-held shared workspace lock; acquired internally when omitted. */
  lock?: LockHandle;
  /** Pass `-v` to the reducer's runner (known runtimes only) so it prints
   *  timing/perf to stderr. Runtime-only; never affects hashing or caching. */
  verbose?: boolean;
}

/**
 * Run a record operation under a shared workspace lock (acquired internally
 * unless the caller already holds one), so mutations coexist with dataflow but
 * are fenced out by an exclusive deploy/remove — the §8 concurrency contract.
 */
async function withSharedWorkspaceLock<T>(
  storage: StorageBackend,
  repo: string,
  ws: string,
  externalLock: LockHandle | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  let lock: LockHandle | null = externalLock ?? null;
  if (!lock) {
    lock = await storage.locks.acquire(repo, ws, variant('dataset_write', null), { mode: 'shared' });
    if (!lock) {
      const state = await storage.locks.getState(repo, ws);
      throw new WorkspaceLockError(ws, state ? { acquiredAt: state.acquiredAt.toISOString(), operation: state.operation.type } : undefined);
    }
  }
  try {
    return await fn();
  } finally {
    if (!externalLock) await lock.release();
  }
}

/** Jittered exponential backoff (ms) before a compare-and-swap retry, so hot
 *  records don't lock-step their (expensive) reducer re-runs under contention. */
function casBackoffMs(attempt: number): number {
  return Math.min(2 ** attempt, 64) * (0.5 + Math.random());
}

interface ResolvedRecord {
  refPath: string;
  selfKeypath: string;
  mutations: Map<string, string>;
}

/** Resolve a record name in a workspace's deployed package to its ref path and
 *  mutation table. Returns null if the workspace has no such record. */
async function resolveRecord(
  storage: StorageBackend,
  repo: string,
  ws: string,
  recordName: string,
): Promise<ResolvedRecord | null> {
  const { hash } = await workspaceGetPackage(storage, repo, ws);
  const pkg = decodePackageObject(await storage.objects.read(repo, hash));
  const recHash = pkg.records.get(recordName);
  if (!recHash) return null;
  const recObj = decodeRecordObject(await storage.objects.read(repo, recHash));
  return {
    refPath: recObj.path,
    selfKeypath: refPathToKeypath(recObj.path),
    mutations: recObj.mutations,
  };
}

/** Map a non-success reducer run to its mutation outcome (nothing written).
 *  The reducer's captured stderr is forwarded on every failure so a human
 *  debugging a hand-written reducer sees its diagnostics. */
function failureOutcome(result: Exclude<DetachedResult, { kind: 'success' }>): MutationOutcome {
  switch (result.kind) {
    case 'failed':
      return { kind: 'failed', exitCode: result.exitCode, stderr: result.stderr };
    case 'timed_out':
      return { kind: 'timed_out', ms: result.ms, stderr: result.stderr };
    case 'too_large':
      return { kind: 'too_large', bytes: result.bytes, limit: result.limit, stderr: result.stderr };
  }
}

/**
 * Apply a named mutation to a record under optimistic concurrency.
 *
 * Resolves the mutation, then loops: read the current state + revision, run the
 * reducer against it, write the new state and a commit object, and conditionally
 * swing the record ref. On a concurrent commit the conditional write conflicts
 * and the loop retries against fresher state. Two mutations on the same record
 * serialize; mutations on different records never contend.
 */
export async function recordMutate(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  ws: string,
  recordName: string,
  mutationName: string,
  args: Uint8Array[],
  opts: RecordMutateOptions,
): Promise<MutationOutcome> {
  return withSharedWorkspaceLock(storage, repo, ws, opts.lock, async () => {
    const resolved = await resolveRecord(storage, repo, ws, recordName);
    if (!resolved) return { kind: 'invalid', message: `record '${recordName}' not found` };

    const mutHash = resolved.mutations.get(mutationName);
    if (!mutHash) return { kind: 'invalid', message: `mutation '${mutationName}' not found on record '${recordName}'` };
    const mutObj = decodeMutationObject(await storage.objects.read(repo, mutHash));

    if (args.length !== mutObj.argTypes.length) {
      return { kind: 'invalid', message: `mutation '${mutationName}' expects ${mutObj.argTypes.length} argument(s), got ${args.length}` };
    }

    const bodyIr = await storage.objects.read(repo, mutObj.bodyIr);
    const limits = opts.limits ?? DEFAULT_LIMITS;
    const deadline = Date.now() + (opts.maxRetryMs ?? DEFAULT_MAX_RETRY_MS);
    // Hard wall-clock cap for the whole call (OPS-1): when set, no reducer run
    // may overrun it and the loop returns a typed terminal before a caller's
    // gateway would cut the connection.
    const hardDeadline = opts.budgetMs !== undefined ? Date.now() + opts.budgetMs : undefined;

    for (let attempt = 1; ; attempt++) {
      if (opts.signal?.aborted) return { kind: 'failed', exitCode: -1, stderr: 'aborted' };
      // Stop before starting another reducer run once the budget is spent.
      if (hardDeadline !== undefined && Date.now() >= hardDeadline) {
        return { kind: 'conflict', attempts: attempt - 1 };
      }

      const existing = await storage.datasets.readVersioned(repo, ws, resolved.refPath);
      if (!existing || existing.ref.type !== 'value') {
        return { kind: 'invalid', message: `record '${recordName}' has no state` };
      }

      // Idempotent retry (OPS-3): if the record's last mutation already committed
      // under this key, return that commit without re-running the reducer.
      if (opts.idempotencyKey !== undefined && existing.ref.value.versions.get(IDEM_SLOT) === opts.idempotencyKey) {
        const head = existing.ref.value.versions.get(resolved.selfKeypath);
        if (head !== undefined) {
          return { kind: 'committed', commitHash: head, stateHash: existing.ref.value.hash };
        }
      }

      // Clamp the reducer's time budget to what remains of the hard deadline, so
      // a single run cannot overrun it.
      const runLimits = hardDeadline !== undefined
        ? { ...limits, timeoutMs: Math.max(1, Math.min(limits.timeoutMs, hardDeadline - Date.now())) }
        : limits;
      const stateBytes = await storage.objects.read(repo, existing.ref.value.hash);
      const result = await runner.runDetached(
        { bodyIr, args: [stateBytes, ...args], runner: mutObj.runner, limits: runLimits },
        { signal: opts.signal, verbose: opts.verbose },
      );
      if (result.kind !== 'success') return failureOutcome(result);

      // Objects written before the conditional ref swing are invisible until the
      // ref references them; a conflict simply orphans them for GC.
      const newStateHash = await storage.objects.write(repo, result.value);
      const argsHash = args.length > 0
        ? await storage.objects.write(repo, encodeArgsTuple(args))
        : undefined;
      const prevCommit = existing.ref.value.versions.get(resolved.selfKeypath);
      const commit: RecordCommit = {
        parent: prevCommit !== undefined ? some(prevCommit) : none,
        state: newStateHash,
        mutation: mutationName,
        args: argsHash !== undefined ? some(argsHash) : none,
        actor: opts.actor,
        at: new Date(),
      };
      const commitHash = await storage.objects.write(repo, encodeCommit(commit));

      // Self-vector carries the head commit; the idempotency slot (when keyed)
      // lets the next retry short-circuit. Both are rewritten each commit, so the
      // map stays bounded.
      const versions = new Map([[resolved.selfKeypath, commitHash]]);
      if (opts.idempotencyKey !== undefined) versions.set(IDEM_SLOT, opts.idempotencyKey);

      try {
        await storage.datasets.writeIf(
          repo, ws, resolved.refPath,
          variant('value', { hash: newStateHash, versions }),
          existing.revision,
        );
        return { kind: 'committed', commitHash, stateHash: newStateHash };
      } catch (err) {
        if (!(err instanceof DatasetRefConflictError)) throw err;
        const budgetSpent = hardDeadline !== undefined && Date.now() >= hardDeadline;
        if ((opts.maxAttempts !== undefined && attempt >= opts.maxAttempts) || Date.now() >= deadline || budgetSpent) {
          return { kind: 'conflict', attempts: attempt };
        }
        await new Promise((resolve) => setTimeout(resolve, casBackoffMs(attempt)));
      }
    }
  });
}

/** A record's mutation surface: each mutation's name and EXTRA arg types. */
export interface RecordSignature {
  name: string;
  mutations: Array<{ name: string; argTypes: EastTypeValue[] }>;
}

/**
 * Describe a record's mutations (name + extra arg types), so dynamic callers
 * can encode arguments. Returns null if the workspace has no such record.
 */
export async function recordDescribe(
  storage: StorageBackend,
  repo: string,
  ws: string,
  recordName: string,
): Promise<RecordSignature | null> {
  const resolved = await resolveRecord(storage, repo, ws, recordName);
  if (!resolved) return null;
  const mutations: Array<{ name: string; argTypes: EastTypeValue[] }> = [];
  for (const [name, mutHash] of resolved.mutations) {
    const mutObj = decodeMutationObject(await storage.objects.read(repo, mutHash));
    mutations.push({ name, argTypes: mutObj.argTypes });
  }
  return { name: recordName, mutations };
}

/**
 * Compact a record's history: write a fresh `$compact` root commit
 * (`parent: none`) over the current state and swing the ref to it. The prior
 * commit chain becomes unreachable and is reclaimed by GC; the state itself is
 * unchanged. Returns `committed` / `invalid` / `conflict` like a mutation.
 */
export async function recordCompact(
  storage: StorageBackend,
  repo: string,
  ws: string,
  recordName: string,
  opts: { actor: string; maxRetryMs?: number; maxAttempts?: number; lock?: LockHandle },
): Promise<MutationOutcome> {
  return withSharedWorkspaceLock(storage, repo, ws, opts.lock, async () => {
    const resolved = await resolveRecord(storage, repo, ws, recordName);
    if (!resolved) return { kind: 'invalid', message: `record '${recordName}' not found` };

    const deadline = Date.now() + (opts.maxRetryMs ?? DEFAULT_MAX_RETRY_MS);
    for (let attempt = 1; ; attempt++) {
      const existing = await storage.datasets.readVersioned(repo, ws, resolved.refPath);
      if (!existing || existing.ref.type !== 'value') {
        return { kind: 'invalid', message: `record '${recordName}' has no state` };
      }
      const stateHash = existing.ref.value.hash;
      const commit: RecordCommit = {
        parent: none,
        state: stateHash,
        mutation: '$compact',
        args: none,
        actor: opts.actor,
        at: new Date(),
      };
      const commitHash = await storage.objects.write(repo, encodeCommit(commit));
      try {
        await storage.datasets.writeIf(
          repo, ws, resolved.refPath,
          variant('value', { hash: stateHash, versions: new Map([[resolved.selfKeypath, commitHash]]) }),
          existing.revision,
        );
        return { kind: 'committed', commitHash, stateHash };
      } catch (err) {
        if (!(err instanceof DatasetRefConflictError)) throw err;
        if ((opts.maxAttempts !== undefined && attempt >= opts.maxAttempts) || Date.now() >= deadline) {
          return { kind: 'conflict', attempts: attempt };
        }
        await new Promise((resolve) => setTimeout(resolve, casBackoffMs(attempt)));
      }
    }
  });
}

/** A commit in a record's history, with its content hash. */
export interface RecordHistoryEntry {
  hash: string;
  commit: RecordCommit;
}

/**
 * Walk a record's commit chain newest-first.
 *
 * @param opts.limit - Maximum commits to return (default: the whole chain)
 * @param opts.from - Commit hash to start the walk at (a cursor for paging,
 *   trusted to be a hash this endpoint previously returned for this record);
 *   defaults to the record's head commit. A missing/undecodable cursor (or a
 *   corrupt link mid-walk) terminates the walk rather than throwing.
 */
export async function recordHistory(
  storage: StorageBackend,
  repo: string,
  ws: string,
  recordName: string,
  opts: { limit?: number; from?: string } = {},
): Promise<RecordHistoryEntry[]> {
  const resolved = await resolveRecord(storage, repo, ws, recordName);
  if (!resolved) return [];

  const ref = await storage.datasets.read(repo, ws, resolved.refPath);
  if (!ref || ref.type !== 'value') return [];

  const entries: RecordHistoryEntry[] = [];
  const seen = new Set<string>();
  let next = opts.from ?? ref.value.versions.get(resolved.selfKeypath);
  const limit = opts.limit ?? Infinity;
  while (next !== undefined && entries.length < limit) {
    // Bound the walk by distinct objects so a corrupted/cyclic parent can't hang.
    if (seen.has(next)) break;
    seen.add(next);
    let commit: RecordCommit;
    try {
      commit = decodeCommit(await storage.objects.read(repo, next));
    } catch {
      break; // missing object or non-commit cursor — end the walk gracefully
    }
    entries.push({ hash: next, commit });
    next = commit.parent.type === 'some' ? commit.parent.value : undefined;
  }
  return entries;
}
