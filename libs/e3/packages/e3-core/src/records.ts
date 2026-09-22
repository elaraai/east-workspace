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

import { variant, some, none, ArrayType, BlobType, encodeBeast2For, decodeBeast2For, fromEastTypeValue, readBeast2Type, toEastTypeValue, type EastType, type EastTypeValue } from '@elaraai/east';
import {
  MutationObjectType,
  RECORD_STATE_KIND,
  RecordCommitType,
  RecordIndexObjectType,
  RecordStateType,
  decodePackageObject,
  decodeRecordObject,
  indexCollectionType,
  indexWindowType,
  isRecordStateType,
  type RecordCommit,
  type RecordIndexObject,
} from '@elaraai/e3-types';
import { adoptDatasetBlob, readDatasetWhole, readManifest } from './dataset-open.js';
import { workspaceGetPackage } from './workspaces.js';
import { refPathToKeypath } from './dataset-refs.js';
import { DatasetRefConflictError, WorkspaceLockError } from './errors.js';
import type { StorageBackend, LockHandle } from './storage/interfaces.js';
import type { TaskRunner } from './execution/interfaces.js';
import type { DetachedResult } from './execution/runDetached.js';

const encodeCommit = encodeBeast2For(RecordCommitType);
const decodeCommit = decodeBeast2For(RecordCommitType);
const decodeMutationObject = decodeBeast2For(MutationObjectType);
const decodeIndexObject = decodeBeast2For(RecordIndexObjectType);
const encodeRecordState = encodeBeast2For(RecordStateType);
const decodeRecordState = decodeBeast2For(RecordStateType);
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
  /** Index name -> RecordIndexObject hash, as the deployed package declares
   *  them. What the state names is what was BUILT; deploy reconciles the two. */
  indexes: Map<string, string>;
}

/**
 * What a record's state names: the primary's manifest, and each index's
 * manifest with the index object it was built under.
 */
export interface RecordStateRefs {
  /** CollectionManifest hash of the primary. */
  primary: string;
  /** Index name -> `{ manifest, index }`. */
  indexes: Map<string, { manifest: string; index: string }>;
}

/**
 * Resolve a record's state object.
 *
 * @remarks
 * The door every reader of a record's `value.hash` goes through. A record with
 * no index keeps the plain manifest as its state, so this accepts both shapes:
 * a `$record` table naming the primary and every index, or the primary itself.
 * That is what makes indexes additive — a record that never declares one is
 * stored exactly as it was.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - the state object's hash (a record ref's `value.hash`)
 * @returns the primary and the indexes the state names
 */
export async function readRecordState(storage: StorageBackend, repo: string, hash: string): Promise<RecordStateRefs> {
  const head = await storage.objects.read(repo, hash);
  let typeValue: EastTypeValue;
  try {
    typeValue = readBeast2Type(head);
  } catch {
    return { primary: hash, indexes: new Map() };
  }
  if (!isRecordStateType(typeValue)) return { primary: hash, indexes: new Map() };
  const state = decodeRecordState(head);
  if (state.kind !== RECORD_STATE_KIND) return { primary: hash, indexes: new Map() };
  return { primary: state.primary, indexes: state.indexes };
}

/**
 * Write a record's state object and return what the ref should name.
 *
 * @remarks
 * A record with no index names its primary manifest directly — one object
 * fewer, and the shape every record had before indexes existed. With indexes
 * it names one small `$record` object, so the primary and every index swing
 * together under one conditional ref write and can never be seen apart.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param state - the primary and the indexes to name
 * @returns the hash the record ref should carry
 */
export async function writeRecordState(storage: StorageBackend, repo: string, state: RecordStateRefs): Promise<string> {
  if (state.indexes.size === 0) return state.primary;
  return storage.objects.write(repo, encodeRecordState({
    kind: RECORD_STATE_KIND,
    primary: state.primary,
    indexes: state.indexes,
  }));
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
    indexes: recObj.indexes,
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
      // The reducer takes a value, not a layout: a state held as a segment
      // manifest is spliced back into one blob for it, exactly as a task
      // input is staged.
      const state = await readRecordState(storage, repo, existing.ref.value.hash);
      // The reducer takes a value, not a layout: a primary held as a segment
      // manifest is spliced back into one blob for it, exactly as a task
      // input is staged.
      const stateBytes = await readDatasetWhole(storage, repo, state.primary);
      const result = await runner.runDetached(
        { bodyIr, args: [stateBytes, ...args], runner: mutObj.runner, limits: runLimits },
        { signal: opts.signal, verbose: opts.verbose },
      );
      if (result.kind !== 'success') return failureOutcome(result);

      // Objects written before the conditional ref swing are invisible until the
      // ref references them; a conflict simply orphans them for GC.
      const newPrimary = await adoptDatasetBlob(storage, repo, result.value);
      // A commit either updates every index or none. The reduce form hands
      // back a whole state, so every index is rebuilt over it — correct, and
      // O(state) until a mutation carries the delta of what it changed.
      const rebuilt = await buildRecordIndexes(storage, runner, repo, resolved.indexes, newPrimary,
        { limits: runLimits, ...(opts.signal !== undefined && { signal: opts.signal }), ...(opts.verbose !== undefined && { verbose: opts.verbose }) });
      if ('failure' in rebuilt) return rebuilt.failure;
      const newStateHash = await writeRecordState(storage, repo, { primary: newPrimary, indexes: rebuilt.built });
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

/**
 * Build every index of a record over one primary state.
 *
 * @remarks
 * Each index's build program runs on the runner its author chose, with the
 * primary as its only input and the runner's emit sink as its output — `run`
 * with `--stream 0 --emit dict`, no new runner command. e3-core never
 * evaluates the index functions: it runs a program and takes what it emits
 * into the store. The emitted collection is canonical by construction (the
 * program emits in order), so it goes through the encoder door like any other
 * collection and lands as a manifest.
 *
 * @param storage - Storage backend
 * @param runner - Task runner for the detached runs
 * @param repo - Repository identifier
 * @param indexes - Index name -> RecordIndexObject hash, from the record object
 * @param primary - CollectionManifest hash of the primary to build over
 * @param opts - Execution limits, cancellation and verbosity
 * @returns The built indexes, or the first program's failure
 */
async function buildRecordIndexes(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  indexes: Map<string, string>,
  primary: string,
  opts: { limits: RecordMutateLimits; signal?: AbortSignal; verbose?: boolean },
): Promise<{ built: Map<string, { manifest: string; index: string }> } | { failure: MutationOutcome }> {
  const built = new Map<string, { manifest: string; index: string }>();
  if (indexes.size === 0) return { built };

  // The program opens the primary lazily from its own file, so the bytes are
  // written once here and paged there.
  const primaryBytes = await readDatasetWhole(storage, repo, primary);
  for (const [name, indexHash] of indexes) {
    const indexObj: RecordIndexObject = decodeIndexObject(await storage.objects.read(repo, indexHash));
    const result = await runner.runDetached(
      {
        bodyIr: await storage.objects.read(repo, indexObj.buildIr),
        args: [primaryBytes],
        runner: indexObj.runner,
        limits: opts.limits,
        streaming: { emit: 'dict', stream: [0] },
      },
      { signal: opts.signal, verbose: opts.verbose },
    );
    if (result.kind !== 'success') return { failure: failureOutcome(result) };
    built.set(name, { manifest: await adoptDatasetBlob(storage, repo, result.value), index: indexHash });
  }
  return { built };
}

/**
 * Rebuild a record's indexes from its primary and commit the result.
 *
 * @remarks
 * An index is derived state, so this is always available and never loses
 * anything: it is the operator's exit when an index function turns out to be
 * wrong (fix the function, redeploy, and the deploy plan rebuilds), and it is
 * what deploy itself runs when a declaration changes. The rebuild appends a
 * `$reindex` commit, so the audit chain records that it happened — the state's
 * primary is untouched, and only the index manifests move.
 *
 * At every commit a maintained index equals the one this writes, byte for
 * byte: content-defined segment boundaries make that a property of the value
 * rather than of the edit history.
 *
 * @param storage - Storage backend
 * @param runner - Task runner for the build programs
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param recordName - The record to reindex
 * @param opts - One index by name (default: all), plus the mutation options
 * @returns `committed` / `invalid` / a program failure / `conflict`
 */
export async function recordReindex(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  ws: string,
  recordName: string,
  opts: RecordMutateOptions & { index?: string },
): Promise<MutationOutcome> {
  return withSharedWorkspaceLock(storage, repo, ws, opts.lock, async () => {
    const resolved = await resolveRecord(storage, repo, ws, recordName);
    if (!resolved) return { kind: 'invalid', message: `record '${recordName}' not found` };
    if (opts.index !== undefined && !resolved.indexes.has(opts.index)) {
      const declared = [...resolved.indexes.keys()];
      return {
        kind: 'invalid',
        message: `record '${recordName}' declares no index '${opts.index}'`
          + (declared.length > 0 ? ` — it has ${declared.join(', ')}` : ''),
      };
    }
    const wanted = opts.index === undefined
      ? resolved.indexes
      : new Map([[opts.index, resolved.indexes.get(opts.index)!]]);

    const limits = opts.limits ?? DEFAULT_LIMITS;
    const deadline = Date.now() + (opts.maxRetryMs ?? DEFAULT_MAX_RETRY_MS);
    for (let attempt = 1; ; attempt++) {
      const existing = await storage.datasets.readVersioned(repo, ws, resolved.refPath);
      if (!existing || existing.ref.type !== 'value') {
        return { kind: 'invalid', message: `record '${recordName}' has no state` };
      }
      const state = await readRecordState(storage, repo, existing.ref.value.hash);
      const outcome = await buildRecordIndexes(storage, runner, repo, wanted, state.primary,
        { limits, ...(opts.signal !== undefined && { signal: opts.signal }), ...(opts.verbose !== undefined && { verbose: opts.verbose }) });
      if ('failure' in outcome) return outcome.failure;

      // Rebuilding one index leaves the others where they are; rebuilding all
      // of them replaces the table, so an index the package has dropped goes
      // with it.
      const indexes = opts.index === undefined ? outcome.built : new Map([...state.indexes, ...outcome.built]);
      const stateHash = await writeRecordState(storage, repo, { primary: state.primary, indexes });
      const prevCommit = existing.ref.value.versions.get(resolved.selfKeypath);
      const commitHash = await storage.objects.write(repo, encodeCommit({
        parent: prevCommit !== undefined ? some(prevCommit) : none,
        state: stateHash,
        mutation: opts.index === undefined ? '$reindex' : `$reindex:${opts.index}`,
        args: none,
        actor: opts.actor,
        at: new Date(),
      }));

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

/**
 * Bring every record's indexes into line with what its package declares.
 *
 * @remarks
 * Run by deploy, once the refs are in place. For each record, an index the
 * package declares whose object hash is not the one the state names is BUILT
 * (a freshly minted record names none, so all of them are); one the state
 * names and the package does not is DROPPED; one that matches is KEPT and
 * nothing runs. A record whose indexes all match is not touched at all, so a
 * redeploy that changes no declaration costs nothing and appends no commit.
 *
 * No `--schema`-style policy governs this: an index is derived, and building
 * one changes no state the audit chain protects. What it does append is one
 * `$reindex` commit per record that changed, so the chain records that the
 * views over the record moved.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param pkg - the package just deployed
 * @param runner - Task runner for the build programs
 * @throws {Error} When a build is owed and no runner was given, or a build
 *   program fails — deploy is all-or-nothing, so this surfaces rather than
 *   leaving a record whose index reads answer from nothing.
 */
export async function reconcileRecordIndexes(
  storage: StorageBackend,
  repo: string,
  ws: string,
  pkg: { records: Map<string, string> },
  runner?: TaskRunner,
): Promise<void> {
  const at = new Date();
  for (const recHash of pkg.records.values()) {
    const recObj = decodeRecordObject(await storage.objects.read(repo, recHash));
    const existing = await storage.datasets.read(repo, ws, recObj.path);
    if (!existing || existing.type !== 'value') continue;
    const state = await readRecordState(storage, repo, existing.value.hash);

    const build = new Map<string, string>();
    for (const [name, indexHash] of recObj.indexes) {
      if (state.indexes.get(name)?.index !== indexHash) build.set(name, indexHash);
    }
    const dropped = [...state.indexes.keys()].filter((name) => !recObj.indexes.has(name));
    if (build.size === 0 && dropped.length === 0) continue;

    if (build.size > 0 && runner === undefined) {
      throw new Error(
        `deploying record '${recObj.path}' must build ${[...build.keys()].join(', ')}, ` +
        `but this deploy was given no task runner — an index read would answer from nothing.`,
      );
    }
    const outcome = build.size === 0
      ? { built: new Map<string, { manifest: string; index: string }>() }
      : await buildRecordIndexes(storage, runner!, repo, build, state.primary, { limits: DEFAULT_LIMITS });
    if ('failure' in outcome) {
      const detail = outcome.failure.kind === 'failed' ? outcome.failure.stderr : outcome.failure.kind;
      throw new Error(`building the indexes of record '${recObj.path}' failed: ${detail}`);
    }

    // Kept indexes carry over; dropped ones simply are not in the package.
    const indexes = new Map<string, { manifest: string; index: string }>();
    for (const [name, indexHash] of recObj.indexes) {
      const rebuilt = outcome.built.get(name);
      indexes.set(name, rebuilt ?? state.indexes.get(name)!);
      void indexHash;
    }
    const stateHash = await writeRecordState(storage, repo, { primary: state.primary, indexes });

    const selfKeypath = refPathToKeypath(recObj.path);
    const prevCommit = existing.value.versions.get(selfKeypath);
    const commitHash = await storage.objects.write(repo, encodeCommit({
      parent: prevCommit !== undefined ? some(prevCommit) : none,
      state: stateHash,
      mutation: '$reindex',
      args: none,
      actor: 'system:deploy',
      at,
    }));
    // Deploy holds the workspace lock exclusively, so this is uncontended.
    await storage.datasets.write(repo, ws, recObj.path,
      variant('value', { hash: stateHash, versions: new Map([[selfKeypath, commitHash]]) }));
  }
}

/**
 * What a read through a record's index needs: the collection to page, and the
 * types to decode and answer in.
 */
export interface ResolvedRecordIndex {
  /** CollectionManifest hash of the index collection. */
  manifest: string;
  /** The index collection's type, `Dict<{ik, k}, P>` — what a page of it
   *  decodes as. */
  collectionType: EastTypeValue;
  /** CollectionManifest hash of the primary, for a joined read. */
  primary: string;
  /** The primary's type, `Dict<K, V>`. */
  primaryType: EastTypeValue;
  /** The window a read answers with, `Array<{ik, key, value, row}>`. */
  windowType: EastTypeValue;
}

/**
 * Resolve one of a record's indexes for reading.
 *
 * @remarks
 * The types come from the state itself rather than from the package: a
 * manifest carries the collection type it describes, so a page read at an
 * older commit decodes under the type that state was written with — which is
 * the same reason a blob carries its own type section.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param refPath - the record's dataset ref path, e.g. `records/plans`
 * @param stateHash - the record ref's `value.hash`
 * @param indexName - the index to read through
 * @returns the resolved index, or `null` when the state names no such index
 */
export async function resolveRecordIndex(
  storage: StorageBackend,
  repo: string,
  ws: string,
  refPath: string,
  stateHash: string,
  indexName: string,
): Promise<ResolvedRecordIndex | null> {
  void ws;
  void refPath;
  const state = await readRecordState(storage, repo, stateHash);
  const entry = state.indexes.get(indexName);
  if (entry === undefined) return null;

  const indexObj: RecordIndexObject = decodeIndexObject(await storage.objects.read(repo, entry.index));
  const primaryManifest = await readManifest(storage, repo, state.primary);
  if (primaryManifest === null) return null;
  // The manifest carries the collection's type as a homoiconic VALUE; the type
  // constructors below build from EastTypes, so it is read back into one. A
  // state written under an older declaration therefore decodes under the type
  // it was written with, which is the same reason a blob carries its own type
  // section.
  const primaryType = fromEastTypeValue(primaryManifest.type as EastTypeValue) as unknown as
    { type: string; key: EastType; value: EastType };
  if (primaryType.type !== 'Dict') return null;
  const indexKeyType = fromEastTypeValue(indexObj.keyType as EastTypeValue) as unknown as EastType;
  const projectionType = fromEastTypeValue(indexObj.valueType as EastTypeValue) as unknown as EastType;

  return {
    manifest: entry.manifest,
    collectionType: toEastTypeValue(indexCollectionType(primaryType.key, indexKeyType, projectionType)),
    primary: state.primary,
    primaryType: primaryManifest.type as EastTypeValue,
    windowType: toEastTypeValue(indexWindowType(primaryType.key, indexKeyType, projectionType, primaryType.value)),
  };
}

/**
 * The indexes a record's state names, by name.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param stateHash - the record ref's `value.hash`
 * @returns the index names, in declaration order
 */
export async function recordIndexNames(storage: StorageBackend, repo: string, stateHash: string): Promise<string[]> {
  return [...(await readRecordState(storage, repo, stateHash)).indexes.keys()];
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
