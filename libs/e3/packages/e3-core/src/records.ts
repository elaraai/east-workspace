/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Record mutation execution — the write half of the function machinery.
 *
 * A mutation runs its program — the delta program its declaration generates,
 * or an unkeyed record's reducer — as one unit through the task executor, in a
 * compare-and-swap retry loop: read state → run → write new state + commit
 * objects → conditional ref write; retry on conflict. A crash at any point
 * leaves only unreferenced objects (GC reclaims them) — never a torn record.
 * The program's purity is what makes re-running against fresher state safe,
 * and what lets a run over a state and arguments seen before be served from
 * the execution cache.
 */

import { variant, some, none, ArrayType, BlobType, PatchType, SortedMap, compareFor, encodeBeast2For, decodeBeast2For, fromEastTypeValue, readBeast2Type, toEastTypeValue, type EastType, type EastTypeValue } from '@elaraai/east';
import {
  RECORD_STATE_KIND,
  RecordCommitType,
  RecordIndexObjectType,
  RecordStateType,
  TASK_OBJECT_KIND,
  TaskObjectType,
  decodeMutationObject,
  decodePackageObject,
  decodeRecordCommit,
  decodeRecordObject,
  encodeDatasetBlob,
  indexCollectionType,
  indexWindowType,
  isRecordStateType,
  mutationDeltaType,
  type DeltaTarget,
  type MutationObject,
  type RecordCommit,
  type RecordIndexObject,
} from '@elaraai/e3-types';
import { DeltaConflictError, applyDelta } from './record-apply.js';
import { readManifest } from './dataset-open.js';
import { inputsHash } from './executions.js';
import { workspaceGetPackage } from './workspaces.js';
import { refPathToKeypath } from './dataset-refs.js';
import { DatasetRefConflictError, WorkspaceLockError } from './errors.js';
import { withRunningWork } from './storage/local/gc.js';
import type { StorageBackend, LockHandle } from './storage/interfaces.js';
import type { TaskResult, TaskRunner } from './execution/interfaces.js';

const encodeCommit = encodeBeast2For(RecordCommitType);
const decodeIndexObject = decodeBeast2For(RecordIndexObjectType);
const encodeRecordState = encodeBeast2For(RecordStateType);
const decodeRecordState = decodeBeast2For(RecordStateType);
const encodeArgsTuple = encodeBeast2For(ArrayType(BlobType));
const encodeTaskObject = encodeBeast2For(TaskObjectType);

/** How long a mutation's program may run, and how much of its stderr a
 *  failure returns. Its output is stored as segments and never read whole, so
 *  it has no size cap. */
export interface RecordMutateLimits {
  timeoutMs: number;
  maxLogBytes: number;
}

const DEFAULT_LIMITS: RecordMutateLimits = {
  timeoutMs: 60_000,
  maxLogBytes: 64 * 1024,
};

/** Wall-clock budget for the compare-and-swap retry loop. Because each conflict
 *  means another writer committed (real progress), a hot record converges; the
 *  loop is deadline-bounded rather than capped at a fixed attempt count (which a
 *  thundering herd would exhaust, dropping a write). */
const DEFAULT_MAX_RETRY_MS = 30_000;

/** Reserved version-vector slot holding the last committed idempotency key. The
 *  `$`-prefix keeps it out of the structural keypath space, so change detection
 *  (snapshotInputVersions) never reads it and dataflow staleness is unaffected. */
const IDEM_SLOT = '$idem';

/** Reserved slot beside {@link IDEM_SLOT} naming the commit its key answers,
 *  which stops being the head once a reindex commits; a retry returns it. */
const IDEM_COMMIT_SLOT = '$idem.commit';

/** Reserved slot naming the migrations a record's state has had applied, in
 *  order, separated by commas, and absent when none has. Only a deploy writes
 *  it. A step is known by its name, an identifier, and never by its object's
 *  hash, which changes with the SDK that exported it. */
const SCHEMA_SLOT = '$schema';

/** A record's ref once it holds a state: the state object and the version
 *  vector. */
export interface RecordRef {
  /** The state object's hash. */
  hash: string;
  /** The version vector: the record's own keypath names its head commit, and
   *  `$` slots hold the commit protocol's bookkeeping. */
  versions: ReadonlyMap<string, string>;
}

/**
 * The migrations a record's state has had applied, in order.
 *
 * @param versions - the record ref's version vector
 * @returns the steps' names; none when the ref names none, as for every record
 *   deployed before a migration could be declared
 */
export function appliedMigrations(versions: ReadonlyMap<string, string>): string[] {
  const slot = versions.get(SCHEMA_SLOT);
  return slot === undefined || slot === '' ? [] : slot.split(',');
}

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
  /** The program failed (incl. a body's `$.error`), or the call was aborted. */
  | { kind: 'failed'; exitCode: number; stderr: string }
  /** The program exceeded its time budget. */
  | { kind: 'timed_out'; ms: number; stderr: string }
  /** The compare-and-swap lost the race `attempts` times, or a delta op
   *  disagreed with the state it landed on — `detail` names the key. */
  | { kind: 'conflict'; attempts: number; detail?: string };

export interface RecordMutateOptions {
  /** Caller identity recorded on the commit (auth principal / `cli:<user>`). */
  actor: string;
  /** How long each run of the program may take, and how much of its stderr
   *  a failure returns; record defaults apply when omitted. */
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
   *  this same key, the reducer is NOT re-run and that mutation's commit and
   *  state are returned, whatever reindex has committed since — so a client
   *  retrying after a gateway timeout cannot double-apply. */
  idempotencyKey?: string;
  /** Optional hard cap on CAS attempts (mainly for tests forcing a conflict). */
  maxAttempts?: number;
  /** Cancellation — aborts the program's run in flight (how is the runner's
   *  concern: a local runner kills the process group, a remote one cancels the
   *  invocation). */
  signal?: AbortSignal;
  /** Externally-held shared workspace lock; acquired internally when omitted. */
  lock?: LockHandle;
  /** Pass `-v` to the program's runner (known runtimes only) so it prints
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
    // A record write produces objects before anything names them — a delta,
    // the new segments, a build's partials and the slices it carved — which
    // only its commit roots.
    return await withRunningWork(storage, repo, fn);
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

/**
 * Runs a record's program as one unit through the task executor, stopped at
 * the run's time limit.
 *
 * @remarks
 * The unit is an execution like a task's: recorded, logged, cancellable, and
 * served from the execution cache when it ran before over the same inputs. The
 * time limit is this call's own: the unit is aborted once it passes, which the
 * executor records `cancelled` and the mutation reports as `timed_out`. A run
 * that did not succeed returns the tail of its stderr log, so a human debugging
 * a hand-written body sees its diagnostics.
 *
 * @param storage - Storage backend
 * @param runner - Task runner the unit runs on
 * @param repo - Repository identifier
 * @param taskHash - The program's task object
 * @param inputs - The unit's input hashes, in the program's parameter order
 * @param run - The time limit, cancellation and verbosity
 * @returns The unit's output hash, or the mutation's outcome when it did not
 *   succeed
 */
async function runUnit(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  taskHash: string,
  inputs: string[],
  run: RunContext,
): Promise<{ output: string } | { failure: MutationOutcome }> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), run.limits.timeoutMs);
  let result: TaskResult;
  try {
    result = await runner.execute(storage, taskHash, inputs, {
      signal: run.signal === undefined ? deadline.signal : AbortSignal.any([run.signal, deadline.signal]),
      ...(run.verbose !== undefined && { verbose: run.verbose }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (result.state === 'success' && result.outputHash !== undefined) return { output: result.outputHash };
  if (result.cancelled && run.signal?.aborted) return { failure: { kind: 'failed', exitCode: -1, stderr: 'aborted' } };
  let stderr = '';
  if (result.executionId !== undefined) {
    const inHash = inputsHash(inputs);
    const { totalSize } = await storage.logs.read(repo, taskHash, inHash, result.executionId, 'stderr', { offset: 0, limit: 0 });
    const offset = Math.max(0, totalSize - run.limits.maxLogBytes);
    stderr = (await storage.logs.read(repo, taskHash, inHash, result.executionId, 'stderr', { offset, limit: totalSize - offset })).data;
  }
  if (stderr === '') stderr = result.error ?? '';
  if (result.cancelled) return { failure: { kind: 'timed_out', ms: run.limits.timeoutMs, stderr } };
  return { failure: { kind: 'failed', exitCode: result.exitCode ?? -1, stderr } };
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

    // A whole-state write rewrites the primary and no index. Only a Dict record
    // declares one, and every Dict record's mutation writes a delta, so one
    // that does not came from a package that mixes the two.
    if (mutObj.programIr === '' && resolved.indexes.size > 0) {
      return { kind: 'invalid', message: `mutation '${mutationName}' writes record '${recordName}' whole, and the record has indexes: re-export its package` };
    }
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
      // under this key, return that commit, and the state it wrote, without
      // re-running the reducer.
      if (opts.idempotencyKey !== undefined && existing.ref.value.versions.get(IDEM_SLOT) === opts.idempotencyKey) {
        const keyed = existing.ref.value.versions.get(IDEM_COMMIT_SLOT);
        if (keyed !== undefined) {
          return { kind: 'committed', commitHash: keyed, stateHash: decodeRecordCommit(await storage.objects.read(repo, keyed)).state };
        }
      }

      // Clamp the program's time budget to what remains of the hard deadline,
      // so a single run cannot overrun it.
      const runLimits = hardDeadline !== undefined
        ? { ...limits, timeoutMs: Math.max(1, Math.min(limits.timeoutMs, hardDeadline - Date.now())) }
        : limits;
      const state = await readRecordState(storage, repo, existing.ref.value.hash);
      // Objects written before the conditional ref swing are invisible until the
      // ref references them; a conflict simply orphans them for GC.
      const run: RunContext = {
        limits: runLimits,
        ...(opts.signal !== undefined && { signal: opts.signal }),
        ...(opts.verbose !== undefined && { verbose: opts.verbose }),
      };
      const write = mutObj.programIr === ''
        ? await writeWholeState(storage, runner, repo, mutObj, state, args, run)
        : await writeDelta(storage, runner, repo, mutObj, state, args, run);
      if ('failure' in write) return write.failure;
      if ('conflictDetail' in write) return { kind: 'conflict', attempts: attempt, detail: write.conflictDetail };

      const newStateHash = await writeRecordState(storage, repo, { primary: write.primary, indexes: write.indexes });
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
        delta: write.delta !== undefined ? some(write.delta) : none,
      };
      const commitHash = await storage.objects.write(repo, encodeCommit(commit));

      // Self-vector carries the head commit; the idempotency slots (when keyed)
      // let the next retry short-circuit. Every mutation rewrites them — one
      // with no key drops them — so the map stays bounded; any other reserved
      // slot rides along untouched.
      const versions = nextVersions(existing.ref.value.versions, resolved.selfKeypath, commitHash, {
        [IDEM_SLOT]: opts.idempotencyKey,
        [IDEM_COMMIT_SLOT]: opts.idempotencyKey !== undefined ? commitHash : undefined,
      });

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
 * The version vector a record's next commit carries.
 *
 * @remarks
 * A `$`-prefixed slot is reserved bookkeeping whose owner is whichever writer
 * set it — the last idempotency key and the commit it answers, and the
 * applied-schema frontier deploy keeps — so a commit that does not own one
 * **carries it forward verbatim**.
 * That is not automatic and it fails silently when it is missed: every commit
 * path builds its vector fresh, so a path that forgets erases the slot, and
 * the writer that set it reads the record afterwards as one that never had it.
 *
 * The self-entry is always rewritten to the new commit, which is what makes
 * change detection commit-granular rather than state-granular.
 *
 * @param previous - the vector on the ref being replaced
 * @param selfKeypath - the record's own keypath
 * @param commitHash - the commit this write appends
 * @param owned - reserved slots this writer owns: a value writes it, `undefined`
 *   drops it
 * @returns the vector to write
 */
function nextVersions(
  previous: ReadonlyMap<string, string> | undefined,
  selfKeypath: string,
  commitHash: string,
  owned: Record<string, string | undefined> = {},
): Map<string, string> {
  const versions = new Map<string, string>();
  for (const [slot, value] of previous ?? []) {
    if (slot.startsWith('$') && !(slot in owned)) versions.set(slot, value);
  }
  versions.set(selfKeypath, commitHash);
  for (const [slot, value] of Object.entries(owned)) {
    if (value !== undefined) versions.set(slot, value);
  }
  return versions;
}

/** What a write produced: the targets it moved, or why it did not. */
type MutationWrite =
  | { primary: string; indexes: Map<string, { manifest: string; index: string }>; delta?: string }
  | { failure: MutationOutcome }
  /** A delta op disagreed with the state it landed on — the key is in the text. */
  | { conflictDetail: string };

/** How a program's run is bounded: the limits, and the caller's cancellation
 *  and verbosity. */
interface RunContext {
  limits: RecordMutateLimits;
  signal?: AbortSignal;
  verbose?: boolean;
}

/**
 * The whole-state protocol: run the reducer, take its result as the new
 * state.
 *
 * @remarks
 * What a record whose collection has no delta addressed by key does — a
 * struct, a scalar or an Array, where "what changed" is the whole value — its
 * mutation object naming no program. The reducer runs as a unit whose output
 * is the new state, taken into the store through its door. No such record has
 * an index: only a Dict record declares one, and every Dict record's mutation
 * writes a delta. It is O(state) per write, which is the cost the delta exists
 * to remove.
 */
async function writeWholeState(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  mutObj: MutationObject,
  state: RecordStateRefs,
  args: Uint8Array[],
  run: RunContext,
): Promise<MutationWrite> {
  const taskHash = await storage.objects.write(repo, encodeTaskObject({
    kind: TASK_OBJECT_KIND,
    body: variant('east', { program: mutObj.bodyIr }),
    runner: mutObj.runner,
    inputs: [state.primary, ...args].map(() => ({ path: [], partition: none })),
    output: { path: [], kind: variant('value', null) },
    role: variant('data', null),
    environment: none,
  }));
  const inputs = [state.primary];
  for (const arg of args) inputs.push(await storage.objects.write(repo, arg));
  const ran = await runUnit(storage, runner, repo, taskHash, inputs, run);
  if ('failure' in ran) return ran;
  return { primary: ran.output, indexes: state.indexes };
}

/**
 * The delta protocol: run the mutation's program, apply what it emits.
 *
 * @remarks
 * One run, whatever the form, and one apply that rewrites the touched segments
 * of the primary and of every index: applying a one-row edit to a
 * two-million-row record reads and writes a segment per target rather than
 * the record. A target the delta does not name keeps the manifest it had, so
 * an index no write touched is never rewritten. The run reads what it touches
 * too: the state is staged as its manifest with the segments linked, which
 * the program opens lazily, so an edit decodes the segments its keys live in
 * and nothing is copied through this process.
 *
 * The `patch` form on a record with no index skips the run outright: the
 * client already computed the change, and with no index function to evaluate
 * there is no user East to run. That is the interactive door — its cost is the
 * rows the edit touched, with no process anywhere.
 */
async function writeDelta(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  mutObj: MutationObject,
  state: RecordStateRefs,
  args: Uint8Array[],
  run: RunContext,
): Promise<MutationWrite> {
  const targets = new Map<string, string>([['primary', state.primary]]);
  for (const [name, entry] of state.indexes) targets.set(name, entry.manifest);

  let deltaHash = mutObj.form === 'patch' && state.indexes.size === 0 && args[0] !== undefined
    ? await patchAsDelta(storage, repo, state.primary, args[0])
    : null;
  if (deltaHash === null) {
    const taskHash = await storage.objects.write(repo, encodeTaskObject({
      kind: TASK_OBJECT_KIND,
      body: variant('east', { program: mutObj.programIr }),
      runner: mutObj.runner,
      inputs: [state.primary, ...args].map(() => ({ path: [], partition: none })),
      output: { path: [], kind: variant('dict', { merge: none }) },
      role: variant('data', null),
      environment: none,
    }));
    const inputs = [state.primary];
    for (const arg of args) inputs.push(await storage.objects.write(repo, arg));
    const ran = await runUnit(storage, runner, repo, taskHash, inputs, run);
    if ('failure' in ran) return ran;
    deltaHash = ran.output;
  }

  // A program that found the write stale says so in the delta's first entry,
  // as the apply says so of an op that disagrees with the state: a caller
  // retries a conflict and gives up on a failure, so the two doors agree on
  // which a stale write is.
  let written: Map<string, string>;
  try {
    written = await applyDelta(storage, repo, targets, deltaHash);
  } catch (err) {
    if (err instanceof DeltaConflictError) return { conflictDetail: err.message };
    throw err;
  }

  const indexes = new Map(state.indexes);
  for (const [name, manifest] of written) {
    if (name === 'primary') continue;
    indexes.set(name, { manifest, index: state.indexes.get(name)!.index });
  }
  return { primary: written.get('primary') ?? state.primary, indexes, delta: deltaHash };
}

/**
 * The delta a client's patch already is, stored — or `null` when the patch is
 * not one this can read without running the program.
 *
 * @remarks
 * A `patch` arm of `PatchType(State)` IS the delta's `primary` arm: the same
 * keys, the same ops, the same conflict semantics. Only a `replace` arm needs
 * the program, which checks its `before` against the state before turning it
 * into per-key ops.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param primary - CollectionManifest hash of the record's own collection
 * @param patchBytes - the client's encoded `PatchType(State)`
 * @returns the delta object's hash, or `null`
 */
async function patchAsDelta(
  storage: StorageBackend,
  repo: string,
  primary: string,
  patchBytes: Uint8Array,
): Promise<string | null> {
  const manifest = await readManifest(storage, repo, primary);
  if (manifest === null) return null;
  // The state's own type, not the package's: a patch applies to what is
  // stored, and a manifest carries the type it was written under.
  const primaryType = fromEastTypeValue(manifest.type as EastTypeValue) as unknown as EastType;
  const collection = primaryType as unknown as { type: string; key: EastType };
  if (collection.type !== 'Dict' && collection.type !== 'Set') return null;
  let patch: { type: string; value: unknown };
  try {
    patch = decodeBeast2For(PatchType(primaryType))(patchBytes) as { type: string; value: unknown };
  } catch {
    return null; // not a patch of this state — let the program refuse it by name
  }
  if (patch.type !== 'patch') return null;

  const deltaTargets: DeltaTarget[] = [{ name: 'primary', keyType: collection.key, collectionType: primaryType }];
  const deltaType = mutationDeltaType(deltaTargets);
  const deltaKeyType = (deltaType as unknown as { key: EastType }).key;
  const entries = new SortedMap<unknown, unknown>(
    undefined, compareFor(toEastTypeValue(deltaKeyType)) as (a: unknown, b: unknown) => -1 | 0 | 1);
  for (const [key, op] of patch.value as Iterable<[unknown, unknown]>) {
    entries.set(variant('primary', key), variant('primary', op));
  }
  const blob = await encodeDatasetBlob(deltaType, entries, (bytes) => storage.objects.write(repo, bytes));
  return storage.objects.write(repo, blob);
}

/**
 * Build every index of a record over one primary state.
 *
 * @remarks
 * Each index builds as a task split over the primary. Its task object is
 * written from the index object: the build program as the body, on the runner
 * its author chose, over the primary, partitioned with no `by`, into a `dict`
 * output with no merge. It runs as any task does, so a build over a primary it
 * has built before is served from the execution cache, and a larger one runs
 * as the engine's pieces and the merges where their outputs overlap. No entry
 * is emitted by two pieces, since an entry's `k` is one piece's. e3-core never
 * evaluates the index functions: it runs a program and takes what it emits
 * into the store.
 *
 * @param storage - Storage backend
 * @param runner - Task runner the builds run on
 * @param repo - Repository identifier
 * @param indexes - Index name -> RecordIndexObject hash, from the record object
 * @param primary - CollectionManifest hash of the primary to build over
 * @param opts - Cancellation and verbosity
 * @returns The built indexes, or the first build's failure
 */
async function buildRecordIndexes(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  indexes: Map<string, string>,
  primary: string,
  opts: { signal?: AbortSignal; verbose?: boolean },
): Promise<{ built: Map<string, { manifest: string; index: string }> } | { failure: MutationOutcome }> {
  const built = new Map<string, { manifest: string; index: string }>();
  for (const [name, indexHash] of indexes) {
    const indexObj: RecordIndexObject = decodeIndexObject(await storage.objects.read(repo, indexHash));
    const taskHash = await storage.objects.write(repo, encodeTaskObject({
      kind: TASK_OBJECT_KIND,
      body: variant('east', { program: indexObj.buildIr }),
      runner: indexObj.runner,
      inputs: [{ path: [], partition: some({ by: [] }) }],
      output: { path: [], kind: variant('dict', { merge: none }) },
      role: variant('data', null),
      environment: none,
    }));
    const result = await runner.execute(storage, taskHash, [primary], {
      ...(opts.signal !== undefined && { signal: opts.signal }),
      ...(opts.verbose !== undefined && { verbose: opts.verbose }),
    });
    if (result.cancelled) return { failure: { kind: 'failed', exitCode: -1, stderr: 'aborted' } };
    if (result.state === 'failed') {
      return { failure: { kind: 'failed', exitCode: result.exitCode ?? -1, stderr: `building index '${name}': ${result.error ?? `exit code ${result.exitCode}`}` } };
    }
    if (result.state !== 'success' || result.outputHash === undefined) {
      return { failure: { kind: 'invalid', message: `building index '${name}': ${result.error ?? 'the build wrote no output'}` } };
    }
    built.set(name, { manifest: result.outputHash, index: indexHash });
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

    const deadline = Date.now() + (opts.maxRetryMs ?? DEFAULT_MAX_RETRY_MS);
    for (let attempt = 1; ; attempt++) {
      const existing = await storage.datasets.readVersioned(repo, ws, resolved.refPath);
      if (!existing || existing.ref.type !== 'value') {
        return { kind: 'invalid', message: `record '${recordName}' has no state` };
      }
      const state = await readRecordState(storage, repo, existing.ref.value.hash);
      const outcome = await buildRecordIndexes(storage, runner, repo, wanted, state.primary, {
        ...(opts.signal !== undefined && { signal: opts.signal }),
        ...(opts.verbose !== undefined && { verbose: opts.verbose }),
      });
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
        delta: none,
      }));

      try {
        // A reindex changes no row a retry could apply twice, so it carries
        // the last idempotency key and the commit that key answers.
        await storage.datasets.writeIf(
          repo, ws, resolved.refPath,
          variant('value', {
            hash: stateHash,
            versions: nextVersions(existing.ref.value.versions, resolved.selfKeypath, commitHash),
          }),
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

/** What a deploy decided about one of a record's indexes. */
export interface RecordIndexPlan {
  /** The record's dataset ref path. */
  record: string;
  /** The index's name. */
  index: string;
  /** `build` — the state names no index under the package's declaration;
   *  `drop` — the state names one the package does not declare; `keep` —
   *  the two already agree and nothing runs. */
  action: 'build' | 'drop' | 'keep';
}

/**
 * What a deploy built for one record's indexes before it wrote anything, for
 * {@link commitDeployIndexes} to commit once the new refs are in place.
 */
export interface DeployIndexBuild {
  /** The record's dataset ref path. */
  path: string;
  /** The state the indexes were built over: the one the deploy writes. */
  state: string;
  /** CollectionManifest hash of the record's primary. */
  primary: string;
  /** Index name -> the manifest it is held in and the index object it was
   *  built under: the table the record's new state names. */
  indexes: Map<string, { manifest: string; index: string }>;
}

/**
 * Build the indexes a deploy owes, before it writes anything.
 *
 * @remarks
 * For each record, an index the package declares whose object hash is not the
 * one the state names is BUILT (a freshly minted record names none, so all of
 * them are); one the state names and the package does not is DROPPED; one
 * that matches is KEPT and nothing runs. A record whose indexes all match is
 * left out, so a redeploy that changes no declaration costs nothing and
 * appends no commit.
 *
 * A build runs user East, which makes it the step of a deploy likeliest to
 * fail, so it runs before the deploy replaces a single ref: a deploy that
 * fails leaves the workspace as it found it. What a build writes is named by
 * nothing until {@link commitDeployIndexes} commits it, so the caller holds
 * the tasks lock ({@link withRunningWork}) across both.
 *
 * No `--schema`-style policy governs this: an index is derived, and building
 * one changes no state the audit chain protects.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param pkg - the package being deployed
 * @param stateOf - the state hash a record will hold once the deploy has
 *   written its refs, by the record's ref path; `undefined` when it holds none
 * @param runner - Task runner for the build programs
 * @param onPlan - told what the deploy decided for each index
 * @param planOnly - decide and tell, and build nothing: a deploy's `--plan`
 * @returns one build per record whose indexes change; none when `planOnly`
 * @throws {Error} When a build is owed and no runner was given, or a build
 *   program fails.
 */
export async function buildDeployIndexes(
  storage: StorageBackend,
  repo: string,
  pkg: { records: Map<string, string> },
  stateOf: (path: string) => string | undefined,
  runner?: TaskRunner,
  onPlan?: (plan: RecordIndexPlan) => void,
  planOnly = false,
): Promise<DeployIndexBuild[]> {
  const builds: DeployIndexBuild[] = [];
  for (const recHash of pkg.records.values()) {
    const recObj = decodeRecordObject(await storage.objects.read(repo, recHash));
    const stateHash = stateOf(recObj.path);
    if (stateHash === undefined) continue;
    const state = await readRecordState(storage, repo, stateHash);

    const build = new Map<string, string>();
    for (const [name, indexHash] of recObj.indexes) {
      if (state.indexes.get(name)?.index !== indexHash) build.set(name, indexHash);
    }
    const dropped = [...state.indexes.keys()].filter((name) => !recObj.indexes.has(name));
    if (onPlan !== undefined) {
      for (const name of recObj.indexes.keys()) {
        onPlan({ record: recObj.path, index: name, action: build.has(name) ? 'build' : 'keep' });
      }
      for (const name of dropped) onPlan({ record: recObj.path, index: name, action: 'drop' });
    }
    if (planOnly || (build.size === 0 && dropped.length === 0)) continue;

    if (build.size > 0 && runner === undefined) {
      throw new Error(
        `deploying record '${recObj.path}' must build ${[...build.keys()].join(', ')}, ` +
        `but this deploy was given no task runner — an index read would answer from nothing.`,
      );
    }
    const outcome = build.size === 0
      ? { built: new Map<string, { manifest: string; index: string }>() }
      : await buildRecordIndexes(storage, runner!, repo, build, state.primary, {});
    if ('failure' in outcome) {
      const failure = outcome.failure;
      const detail = failure.kind === 'failed' ? failure.stderr : failure.kind === 'invalid' ? failure.message : failure.kind;
      throw new Error(`building the indexes of record '${recObj.path}' failed: ${detail}`);
    }

    // Kept indexes carry over; dropped ones simply are not in the package.
    const indexes = new Map<string, { manifest: string; index: string }>();
    for (const name of recObj.indexes.keys()) {
      indexes.set(name, outcome.built.get(name) ?? state.indexes.get(name)!);
    }
    builds.push({ path: recObj.path, state: stateHash, primary: state.primary, indexes });
  }
  return builds;
}

/**
 * Commit a deploy's index builds: one `$reindex` commit per record, on the ref
 * the deploy has just written.
 *
 * @remarks
 * The commit is what names the objects a build wrote, so the caller still
 * holds the tasks lock the builds ran under. Deploy holds the workspace lock
 * exclusively, so every ref write here is uncontended.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param builds - what {@link buildDeployIndexes} built
 * @throws {Error} When a record does not hold the state its indexes were
 *   built over — the deploy wrote a ref the builds did not expect.
 */
export async function commitDeployIndexes(
  storage: StorageBackend,
  repo: string,
  ws: string,
  builds: readonly DeployIndexBuild[],
): Promise<void> {
  const at = new Date();
  for (const { path, state, primary, indexes } of builds) {
    const existing = await storage.datasets.read(repo, ws, path);
    if (!existing || existing.type !== 'value' || existing.value.hash !== state) {
      throw new Error(`record '${path}' does not hold the state its indexes were built over (${state})`);
    }
    const stateHash = await writeRecordState(storage, repo, { primary, indexes });
    const selfKeypath = refPathToKeypath(path);
    const prevCommit = existing.value.versions.get(selfKeypath);
    const commitHash = await storage.objects.write(repo, encodeCommit({
      parent: prevCommit !== undefined ? some(prevCommit) : none,
      state: stateHash,
      mutation: '$reindex',
      args: none,
      actor: 'system:deploy',
      at,
      delta: none,
    }));
    // A reindex, like the one recordReindex commits: the idempotency slots
    // ride along.
    await storage.datasets.write(repo, ws, path,
      variant('value', {
        hash: stateHash,
        versions: nextVersions(existing.value.versions, selfKeypath, commitHash),
      }));
  }
}

/**
 * What a deploy commits to one record once its refs are written.
 */
export type DeployRecordCommit =
  /** Minted from the package's initial value: a `$init` root commit, and the
   *  whole chain counted applied, since the value is at the package's type. */
  | { kind: 'mint'; path: string; state: string; applied: readonly string[] }
  /** Kept as the workspace holds it: its ref restored, and a `$deploy` commit
   *  when the package under it changed, so its history says so. */
  | { kind: 'keep'; path: string; prior: RecordRef; deployed: boolean }
  /** Migrated: a `$migrate:<name>` commit per step over that step's state,
   *  chained onto the ref's head, and the whole chain counted applied. */
  | { kind: 'migrate'; path: string; prior: RecordRef; steps: readonly { name: string; state: string }[]; applied: readonly string[] }
  /** Reset to the package's initial value: a `$reset` root commit, and the
   *  whole chain counted applied. */
  | { kind: 'reset'; path: string; prior: RecordRef; state: string; applied: readonly string[] };

/**
 * Commit what a deploy decided for each record, on the refs it has just
 * written.
 *
 * @remarks
 * What each commit does to the reserved slots is the commit protocol's, and it
 * decides whether a keyed retry is answered or applied again:
 * - `$init` writes `$schema`, and there is no key to answer;
 * - `$deploy` carries every slot, since it changes no row;
 * - `$migrate` points `$idem.commit` at itself, since its state holds the
 *   keyed write in the type the record now has, and the last one writes
 *   `$schema`;
 * - `$reset` drops the idempotency slots, since the keyed write went with the
 *   state, and writes `$schema`.
 *
 * Deploy holds the workspace lock exclusively, so every ref write here is
 * uncontended, and the tasks lock, since a migration's states are named by
 * nothing until these commits.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param commits - what the deploy decided, one entry per record it keeps
 */
export async function commitDeployRecords(
  storage: StorageBackend,
  repo: string,
  ws: string,
  commits: readonly DeployRecordCommit[],
): Promise<void> {
  const at = new Date();
  const system = (parent: string | undefined, state: string, mutation: string): Promise<string> =>
    storage.objects.write(repo, encodeCommit({
      parent: parent !== undefined ? some(parent) : none,
      state,
      mutation,
      args: none,
      actor: 'system:deploy',
      at,
      delta: none,
    }));
  for (const commit of commits) {
    const selfKeypath = refPathToKeypath(commit.path);
    const schema = commit.kind === 'keep' || commit.applied.length === 0 ? undefined : commit.applied.join(',');
    switch (commit.kind) {
      case 'mint': {
        const head = await system(undefined, commit.state, '$init');
        await storage.datasets.write(repo, ws, commit.path, variant('value', {
          hash: commit.state,
          versions: nextVersions(undefined, selfKeypath, head, { [SCHEMA_SLOT]: schema }),
        }));
        break;
      }
      case 'keep': {
        const versions = commit.deployed
          ? nextVersions(commit.prior.versions, selfKeypath,
            await system(commit.prior.versions.get(selfKeypath), commit.prior.hash, '$deploy'))
          : new Map(commit.prior.versions);
        await storage.datasets.write(repo, ws, commit.path, variant('value', { hash: commit.prior.hash, versions }));
        break;
      }
      case 'migrate': {
        let head = commit.prior.versions.get(selfKeypath);
        for (const step of commit.steps) head = await system(head, step.state, `$migrate:${step.name}`);
        await storage.datasets.write(repo, ws, commit.path, variant('value', {
          hash: commit.steps[commit.steps.length - 1]!.state,
          versions: nextVersions(commit.prior.versions, selfKeypath, head!, {
            [SCHEMA_SLOT]: schema,
            ...(commit.prior.versions.has(IDEM_SLOT) && { [IDEM_COMMIT_SLOT]: head }),
          }),
        }));
        break;
      }
      case 'reset': {
        const head = await system(undefined, commit.state, '$reset');
        await storage.datasets.write(repo, ws, commit.path, variant('value', {
          hash: commit.state,
          versions: nextVersions(commit.prior.versions, selfKeypath, head, {
            [IDEM_SLOT]: undefined,
            [IDEM_COMMIT_SLOT]: undefined,
            [SCHEMA_SLOT]: schema,
          }),
        }));
        break;
      }
    }
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

/** A record's mutation surface: each mutation's name, write form and EXTRA arg
 *  types. The form tells a caller what the arguments MEAN — a `patch`
 *  mutation's one argument is a `PatchType(State)`, not a value of the
 *  record's own type. */
export interface RecordSignature {
  name: string;
  mutations: Array<{ name: string; form: string; argTypes: EastTypeValue[] }>;
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
  const mutations: RecordSignature['mutations'] = [];
  for (const [name, mutHash] of resolved.mutations) {
    const mutObj = decodeMutationObject(await storage.objects.read(repo, mutHash));
    mutations.push({ name, form: mutObj.form, argTypes: mutObj.argTypes });
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
        delta: none,
      };
      const commitHash = await storage.objects.write(repo, encodeCommit(commit));
      try {
        // A compaction cuts the keyed commit out of the chain, and its state
        // holds the keyed write, so it answers the key: a retry arriving after
        // it is answered, not applied again.
        const keyed = existing.ref.value.versions.has(IDEM_SLOT);
        await storage.datasets.writeIf(
          repo, ws, resolved.refPath,
          variant('value', {
            hash: stateHash,
            versions: nextVersions(existing.ref.value.versions, resolved.selfKeypath, commitHash,
              keyed ? { [IDEM_COMMIT_SLOT]: commitHash } : {}),
          }),
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
      commit = decodeRecordCommit(await storage.objects.read(repo, next));
    } catch {
      break; // missing object or non-commit cursor — end the walk gracefully
    }
    entries.push({ hash: next, commit });
    next = commit.parent.type === 'some' ? commit.parent.value : undefined;
  }
  return entries;
}
