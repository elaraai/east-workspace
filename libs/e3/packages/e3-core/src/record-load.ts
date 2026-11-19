/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Loading a delivery into an external source of a composite record: the
 * source's run of the record, and the commit of a load's delta.
 *
 * A load reads the record's entries of its source — the source's run, stored
 * as a collection of its own — and its pieces compute the delta that turns
 * them into what the delivery says. The commit applies that delta once, onto
 * whatever head the record has moved to meanwhile: people's saves, and other
 * sources' loads, land while a load runs, and its commit folds each in from
 * its own few ops rather than apply the delta again. A commit that cannot
 * tell what landed — a system commit, a load of the same source, a chain a
 * compaction cut — reads the source's run again, and commits when it is the
 * one the delta was computed from, or sends the load back to its pieces.
 *
 * @packageDocumentation
 */

import {
  DateTimeType, StringType, compareFor, encodeBeast2For, equalFor, isTypeValueEqual, none, parseFor, printFor, some, variant,
} from '@elaraai/east';
import {
  RecordLoadArgsType, decodeRecordCommit, decodeRecordLoadObject, loadCommitName, loadCommitSource, pathToString,
  type LockOperation, type PartitionProgress, type RecordCommit, type RecordLoadArgs, type RecordLoadObject, type RecordLoadProgress,
  type RecordLoadResult, type RecordSignature,
} from '@elaraai/e3-types';
import { DeltaStoppedError, applyDelta, applyDeltaSummarized, type DeltaArmSummary } from './record-apply.js';
import { PENDING_SLOT, pendingSources, sourceEntriesIn, sourceLoadSlots, sourceSegments, sourcesSlot } from './record-slots.js';
import {
  casBackoffMs, encodeMutationArgs, named, nextVersions, readRecordState, resolveRecord, stateTargets, stateWritten, storeCommit,
  type RecordStateRefs, type ResolvedRecord,
} from './records.js';
import { DatasetSegments } from './dataset-open.js';
import { adoptProgressToIntakeFile, deliveryAdoptStored } from './dataset-adopt.js';
import { INTENT_PROBE_MS, acquireWorkspaceShared, announcedIntent, intentWords, workspaceIntentLock } from './deploy-lock.js';
import { inputsHash } from './executions.js';
import { touchReachable } from './gc-graph.js';
import { withRunningWork } from './running-work.js';
import { storeCollection, type CollectionSource } from './store-collection.js';
import {
  DatasetRefConflictError, ObjectNotFoundError, RecordLoadRefusedError, RecordLoadStoppedError,
} from './errors.js';
import type { TaskRunner } from './execution/interfaces.js';
import type { LockHandle, StorageBackend } from './storage/interfaces.js';

const encodeLoadArgs = encodeBeast2For(RecordLoadArgsType);
const printTime = printFor(DateTimeType);
const parseTime = parseFor(DateTimeType);
const byTime = compareFor(DateTimeType);

/** Whether two names are one: a source's, a case of the record's key. */
const sameName = equalFor(StringType);

/** Whether two objects are one, by their hashes. */
const sameObject = equalFor(StringType);

/**
 * Stores a composite record's entries of one source as a collection of its
 * own: the source's run.
 *
 * @remarks
 * What a load's pieces read beside its delivery, and what its commit reads
 * again to tell whether the entries it was computed from still stand. The
 * run's bounds are found among the fences the record's manifest holds
 * ({@link sourceSegments}), and every segment inside it is carried over by
 * reference: only the two segments at its ends are read, and re-cut. So equal
 * entries store as one collection however the record around them was cut,
 * and a run that other sources' writes did not touch keeps its hash, and the
 * load's pieces their cached results.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param state - The record's state: its ref's hash, a record state or its
 *   rows' manifest
 * @param source - The source's name: a case of the record's key
 * @returns The run's manifest, of the record's own type; the empty
 *   collection's for a source the record holds no entry of
 * @throws {Error} When the record's keys are not a variant's, or its rows
 *   are stored as one blob
 *
 * @example
 * ```ts
 * const head = await storage.datasets.read(repo, 'main', 'records/orders');
 * if (head?.type === 'value') {
 *   const run = await recordSourceRun(storage, repo, head.value.hash, 'erp'); // the ERP's entries alone
 * }
 * ```
 */
export async function recordSourceRun(storage: StorageBackend, repo: string, state: string, source: string): Promise<string> {
  const segments = await DatasetSegments.open(storage, repo, state);
  const { from, to } = await sourceSegments(segments, source);
  const sources: CollectionSource[] = [];
  // The run may begin inside the segment before the first that starts in it
  if (from > 0) sources.push({ elements: sourceEntriesIn(segments, from - 1, source) });
  if (to > from) {
    // Every segment that starts in the run but its last is the run's, whole
    if (to - 1 > from) sources.push({ stored: segments.hash, from, to: to - 1, manifest: segments.manifest });
    // The last may hold the next source's first entries
    sources.push({ elements: sourceEntriesIn(segments, to - 1, source) });
  }
  return storeCollection(storage, repo, segments.typeValue, sources);
}

/** What a load's commit came to. */
export type RecordLoadCommitOutcome =
  /** The delta committed: the commit, the state it left, and what its
   *  `args` record. */
  | { readonly kind: 'committed'; readonly commit: string; readonly state: string; readonly args: RecordLoadArgs }
  /** The source's entries changed under the load: it goes back to its
   *  pieces, over the record's new head, for the reason given. Nothing was
   *  written. */
  | { readonly kind: 'restart'; readonly reason: string }
  /** The load's signal fired before the commit's write. Nothing was
   *  written. */
  | { readonly kind: 'stopped' };

/** What a load commits, and how. */
export interface RecordLoadCommitOptions {
  /** The load's delta: its task's output, a mutation delta of the record. */
  readonly delta: string;
  /** The source's run the delta was computed from ({@link recordSourceRun}). */
  readonly run: string;
  /** The head commit the run was read at: what the delta holds on. None for
   *  a load that cannot say — one another process took up — which reads the
   *  run again at its first attempt. */
  readonly base?: string;
  /** The stored hash of the delivery the delta applies. */
  readonly delivery: string;
  /** The hash of the load object the delta was computed under. */
  readonly load: string;
  /** The time the delivery says its data is as of, when it says one. */
  readonly asOf?: Date;
  /** The execution that made the delta, by its inputs' hash and its id. */
  readonly execution: { readonly inputsHash: string; readonly executionId: string };
  /** Who the commit names. */
  readonly actor: string;
  /** Stops the commit before its next attempt, between two segments of the
   *  delta as it is applied and counted, and before its write. */
  readonly signal?: AbortSignal;
}

/**
 * Commits a load's delta to a composite record.
 *
 * @remarks
 * The caller holds the workspace's lock, shared, and the repository's running
 * work, as a record write does: no deploy lands meanwhile, and nothing is
 * swept before the commit roots it. Each attempt reads the record's head and
 * brings the load's result to it:
 *
 * - **Replay.** When every commit since the last head the result held on is a
 *   save, or another source's load, and each stored its delta, the delta is
 *   applied once — held to the source's entries — and each of those commits'
 *   deltas after it, oldest first. Neither writes the other's entries, so the
 *   order does not change what they come to, and the load's delta is never
 *   applied twice, however many saves land.
 * - **Run check.** Otherwise — a system commit, a load of this source, a chain
 *   a compaction cut, or no head to start from — the source's run is read
 *   again. The one the delta was computed from, the delta is applied onto the
 *   head; another, the load restarts.
 *
 * The commit is named `$load:<source>`, with its delta and its arguments, a
 * {@link RecordLoadArgs}; the ref's slots name the delivery, the load, the
 * commit and the execution, keep the later as-of, and take the source out of
 * the sources the record waits on. Only a ref conflict is retried, with no
 * cap: each attempt applies only what landed since the one before. A delta
 * whose program found a key outside its source, or its piece, opens with a
 * conflict entry, and the apply refuses it before anything is written.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param ws - The workspace
 * @param record - The record, as {@link resolveRecord} finds it
 * @param source - The external source loaded
 * @param options - The delta, the run and the head it was computed at, and
 *   what the commit records
 * @returns The commit; or that the load restarts, or was stopped
 * @throws {Error} When the record holds no state, the delta does not apply —
 *   a key outside the source or its piece, which the error names, or a summary
 *   it cannot hold — or the store fails
 *
 * @example
 * ```ts
 * const committed = await recordLoadCommit(storage, repo, 'main', record, 'erp', {
 *   delta, run, base, delivery, load, execution: { inputsHash, executionId }, actor: 'system:load',
 * });
 * if (committed.kind === 'restart') console.log(`Loading again: ${committed.reason}`);
 * ```
 */
export async function recordLoadCommit(
  storage: StorageBackend,
  repo: string,
  ws: string,
  record: Pick<ResolvedRecord, 'refPath' | 'selfKeypath'>,
  source: string,
  options: RecordLoadCommitOptions,
): Promise<RecordLoadCommitOutcome> {
  const { delta, run, signal } = options;
  // Read afresh each time: a stop comes while the commit awaits the store
  const stopped = (): boolean => signal?.aborted === true;
  const own = new Set([source]);
  // The last head the result holds on, and the result: the record's targets with the load applied, and what it did
  let checked = options.base;
  let result: { readonly refs: RecordStateRefs; readonly counts: Pick<RecordLoadArgs, 'set' | 'deleted' | 'unchanged'> } | undefined;
  // The load's own delta applied to a state, held to its source's entries, and counted in that one read of it
  const ownApplied = async (state: RecordStateRefs): Promise<NonNullable<typeof result>> => {
    const { written, summary } = await applyDeltaSummarized(storage, repo, stateTargets(state), delta, { cases: own, ...(signal !== undefined && { signal }) });
    return { refs: stateWritten(state, written), counts: await loadCounts(storage, repo, summary, run) };
  };
  for (let attempt = 1; ; attempt++) {
    if (stopped()) return { kind: 'stopped' };
    const read = await storage.datasets.readVersioned(repo, ws, record.refPath);
    if (read === null || read.ref.type !== 'value') throw new Error(`record ${record.selfKeypath} holds no state`);
    const { hash: stateHash, versions } = read.ref.value;
    const head = versions.get(record.selfKeypath);
    if (head === undefined) throw new Error(`record ${record.selfKeypath} names no head commit`);

    // Bringing the result to the head reads the delta, and counts it as it is
    // read: stopped between two of the delta's segments, so a load whose delta
    // is millions of ops lets its workspace go as soon as it is asked
    try {
      const passed = checked === undefined ? null : await commitsSince(storage, repo, head, checked);
      if (passed !== null && passed.every((commit) => replays(commit, source))) {
        if (result === undefined) result = await ownApplied(await readRecordState(storage, repo, stateHash));
        // Oldest first, as they landed: each a save's few ops, or another source's load
        else for (const commit of passed.reverse()) if (commit.delta.type === 'some') result = { ...result, refs: await applied(storage, repo, result.refs, commit.delta.value, signal) };
      } else {
        if (!sameObject(await recordSourceRun(storage, repo, stateHash, source), run)) {
          return { kind: 'restart', reason: `the entries of source '${source}' changed under its load` };
        }
        result = await ownApplied(await readRecordState(storage, repo, stateHash));
      }
      checked = head;
    } catch (err) {
      if (err instanceof DeltaStoppedError) return { kind: 'stopped' };
      throw err;
    }

    const pending = pendingSources(versions);
    const args: RecordLoadArgs = {
      delivery: options.delivery,
      load: options.load,
      asOf: options.asOf === undefined ? none : some(options.asOf),
      first: pending.some((name) => sameName(name, source)),
      execution: { ...options.execution },
      ...result.counts,
    };
    const { stateHash: committed, commitHash } = await storeCommit(storage, repo, result.refs,
      { parent: some(head), mutation: loadCommitName(source), actor: options.actor, at: new Date(), delta: some(delta) },
      named(encodeMutationArgs([encodeLoadArgs(args)])));
    const slots = sourceLoadSlots(source);
    const asOf = laterAsOf(versions.get(slots.asOf), options.asOf);
    const next = nextVersions(versions, record.selfKeypath, commitHash, {
      [slots.delivery]: options.delivery,
      [slots.load]: options.load,
      [slots.commit]: commitHash,
      [slots.execution]: `${options.execution.inputsHash}/${options.execution.executionId}`,
      ...(asOf !== undefined && { [slots.asOf]: asOf }),
      [PENDING_SLOT]: sourcesSlot(pending.filter((name) => !sameName(name, source))),
    });
    // A stop that came while the result was brought to the head writes nothing
    if (stopped()) return { kind: 'stopped' };
    try {
      await storage.datasets.writeIf(repo, ws, record.refPath, variant('value', { hash: committed, versions: next }), read.revision);
      return { kind: 'committed', commit: commitHash, state: committed, args };
    } catch (err) {
      if (!(err instanceof DatasetRefConflictError)) throw err;
      await new Promise((resolve) => setTimeout(resolve, casBackoffMs(attempt)));
    }
  }
}

/**
 * The commits since a head, newest first: those a walk back from `head`
 * passes before it reaches `since`.
 *
 * @returns The commits; none when `head` is `since`; `null` when the chain
 *   never reaches it — a compaction cut it, or a commit is gone
 */
async function commitsSince(storage: StorageBackend, repo: string, head: string, since: string): Promise<RecordCommit[] | null> {
  const passed: RecordCommit[] = [];
  for (let at = head; !sameObject(at, since);) {
    let commit: RecordCommit;
    try {
      commit = decodeRecordCommit(await storage.objects.read(repo, at));
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return null;
      throw err;
    }
    passed.push(commit);
    if (commit.parent.type === 'none') return null;
    at = commit.parent.value;
  }
  return passed;
}

/**
 * Whether a load's result is brought past a commit by replaying its delta:
 * a save, or another source's load, which stored its delta. Neither writes the
 * load's own entries.
 */
function replays(commit: RecordCommit, source: string): boolean {
  if (commit.delta.type === 'none') return false;
  const loaded = loadCommitSource(commit.mutation);
  if (loaded !== null) return !sameName(loaded, source);
  // A system commit's name begins with `$`, and a save's never does
  return !commit.mutation.startsWith('$');
}

/**
 * A record's targets once the delta of a commit that landed is applied to
 * them: a replay, held to no source, since the commit was checked when it
 * committed.
 *
 * @param state - The targets the delta applies to
 * @param delta - The delta
 * @param signal - Stops the apply between two of the delta's segments
 */
async function applied(
  storage: StorageBackend, repo: string, state: RecordStateRefs, delta: string, signal: AbortSignal | undefined,
): Promise<RecordStateRefs> {
  return stateWritten(state, await applyDelta(storage, repo, stateTargets(state), delta, signal === undefined ? {} : { signal }));
}

/**
 * What a load's delta does to its source's entries: those it sets, those it
 * deletes, and those of the run it leaves as they were.
 *
 * @param summary - What the delta did to each target, counted as it was
 *   applied
 * @param run - The source's run the delta was computed from
 */
async function loadCounts(
  storage: StorageBackend, repo: string, summary: readonly DeltaArmSummary[], run: string,
): Promise<Pick<RecordLoadArgs, 'set' | 'deleted' | 'unchanged'>> {
  const primary = summary.find((arm) => sameName(arm.target, 'primary'));
  const [inserted, updated, deleted] = [primary?.insert ?? 0, primary?.update ?? 0, primary?.delete ?? 0];
  const held = (await DatasetSegments.open(storage, repo, run)).elementCount;
  return { set: BigInt(inserted + updated), deleted: BigInt(deleted), unchanged: BigInt(held - updated - deleted) };
}

/**
 * The as-of a source's slot holds once a delivery commits: the later of the
 * one it held and the delivery's, as East prints a DateTime.
 *
 * @param held - The slot's text, when it holds one
 * @param asOf - The delivery's, when it says one
 * @returns The slot's new text; `undefined` when the delivery says none,
 *   which leaves the slot as it is
 */
function laterAsOf(held: string | undefined, asOf: Date | undefined): string | undefined {
  if (asOf === undefined) return undefined;
  const parsed = held === undefined ? undefined : parseTime(held);
  return parsed?.success === true && byTime(parsed.value, asOf) > 0 ? printTime(parsed.value) : printTime(asOf);
}

// =============================================================================
// The load job
// =============================================================================

/**
 * How long one turn of a load's wait asks for a lock — its turn among its
 * source's loads, or a deploy's end — before it re-references its delivery
 * and asks again.
 *
 * @remarks
 * The waits themselves have no bound: the load ahead may take hours. A turn
 * is how often a waiting load renews what keeps its delivery.
 */
export const LOAD_WAIT_TURN_MS = 30_000;

/**
 * The lock one source's loads take in turn, so they apply one at a time, in
 * the order asked.
 *
 * @param ws - Workspace name
 * @param record - The record
 * @param source - The external source
 * @returns `<ws>#load~<record>~<source>`, which no workspace's lock can be: a
 *   lock's name may hold the `#` a workspace's may not
 */
export function loadQueueLock(ws: string, record: string, source: string): string {
  return `${ws}#load~${record}~${source}`;
}

/** How {@link recordLoad} loads a delivery. */
export interface RecordLoadOptions {
  /** Who the load's commit names. */
  readonly actor: string;
  /** The time the delivery says its data is as of. A delivery older than the
   *  source's last is answered `superseded`, and nothing runs. */
  readonly asOf?: Date;
  /** Hears how far the load has got, each step as it happens. */
  readonly onProgress?: (progress: RecordLoadProgress) => void;
  /** Stops the load — its waits, its intake, its pieces, and its commit
   *  before it writes — which then throws {@link RecordLoadStoppedError}. */
  readonly signal?: AbortSignal;
  /** Told once, when the load has asked for its source's turn: it holds the
   *  turn, or has asked a lock service that queues its waiters for it, and so
   *  has its place among them. What starts several loads of one source lets
   *  the next ask then, so they are given the turn in the order it started
   *  them. A load refused, or stopped, before it asks is never told. */
  readonly onAsked?: () => void;
}

/**
 * Loads a delivery into an external source of a composite record: the whole
 * of a load, from the delivery the store holds to its one commit.
 *
 * @remarks
 * What `e3 load` runs in process, and a load job runs on a server. Its steps:
 *
 * 1. It holds the repository's running work for its whole length, so no sweep
 *    runs meanwhile, and re-references the delivery: one the store no longer
 *    holds fails the load. A record or source that is not in the workspace, a
 *    solution's source, and a source the dataflow loads from its feed, are
 *    refused here.
 * 2. It takes its turn among its source's loads ({@link loadQueueLock}), so
 *    they apply one at a time, in the order asked, reporting `queued` once
 *    when an earlier one holds it, and telling `onAsked` once it has asked.
 * 3. A delivery the source last loaded, under the same load, is answered
 *    `again` with the commit that applied it; one older than the source's
 *    as-of is answered `superseded`. Nothing runs for either. A repeat that
 *    carries a later as-of than the source's moves the source's as-of to it,
 *    holding the workspace as step 4 does, and changes nothing else: no
 *    commit is made, and a delivery that arrives afterwards with an as-of
 *    between the two is answered `superseded`.
 * 4. It holds the workspace shared, as a record's write does, once nothing
 *    has announced itself on the workspace's intent.
 * 5. It takes the delivery in as a stored value of the source's delivery
 *    type, reporting `intake`.
 * 6. It stores the source's run of the record's head ({@link recordSourceRun}).
 * 7. It runs the load's task over the delivery and the run, its pieces on
 *    any runtime and each cached, reporting `pieces`.
 * 8. It commits the delta ({@link recordLoadCommit}), reporting `commit`. A
 *    commit that finds the source's entries changed sends the load back to
 *    step 6, reporting `restarted`; its pieces whose inputs did not change come
 *    from the cache.
 *
 * Its waits — its turn, and a deploy's end — have no bound, and re-reference
 * the delivery every {@link LOAD_WAIT_TURN_MS}. Its turn is one wait where
 * the lock service queues its waiters, so the source's loads apply in the
 * order asked (ruling 37), and turns of that length elsewhere; a deploy's end
 * is waited for in such turns.
 *
 * While it holds the workspace it asks once a second whether something that
 * takes the workspace whole has announced itself. A deploy or an export of
 * it stops the load's work, and the load lets the workspace go, reports
 * `stopped`, waits until it is done, and goes on from step 4, keeping its
 * turn: what changed under it fails it, naming the change, and a changed load
 * function runs. A removal of the workspace, or a copy onto it, stops the
 * load the same way, and the load waits it out: where it took the workspace
 * — removed it, or replaced it — the load fails, saying so, and where it left
 * the workspace as it was, having been refused or having failed, the load
 * goes on (rulings 26 and 34).
 *
 * @param storage - Storage backend
 * @param runner - The runner that takes the delivery in and runs the pieces
 * @param repo - Repository identifier
 * @param ws - Workspace name
 * @param record - The composite record
 * @param source - The external source the delivery is for
 * @param delivery - The stored hash of the delivery: an object the store holds
 * @param options - Who loads, the delivery's as-of, progress and a signal
 * @returns What the load did: `loaded`, with its commit and its counts;
 *   `again`; or `superseded`
 * @throws {RecordLoadRefusedError} When the record or the source is not one a
 *   delivery is loaded into, or the dataflow loads the source from its feed
 * @throws {RecordLoadStoppedError} When its signal stopped it before its
 *   commit wrote: nothing was loaded
 * @throws {Error} When the store no longer holds the delivery, the delivery
 *   is not of the source's delivery type, a piece fails, the delta does not
 *   apply, a deploy removed or changed the source, or the workspace was
 *   removed or copied onto
 *
 * @example
 * ```ts
 * const loaded = await recordLoad(storage, runner, repo, 'main', 'orders', 'erp', delivery, {
 *   actor: 'cli:ada', asOf: new Date('2026-11-02T03:00:00Z'),
 *   onProgress: (progress) => console.log(progress.type),
 * });
 * if (loaded.outcome.type === 'loaded') console.log(`${loaded.set} set, ${loaded.deleted} deleted`);
 * ```
 */
export async function recordLoad(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  ws: string,
  record: string,
  source: string,
  delivery: string,
  options: RecordLoadOptions,
): Promise<RecordLoadResult> {
  const name = `${record}.${source}`;
  const { signal } = options;
  const report = (progress: RecordLoadProgress): void => options.onProgress?.(progress);
  const stopIfAsked = (): void => {
    if (signal?.aborted === true) throw new RecordLoadStoppedError(name);
  };
  // A load asked to stop before it starts reads nothing: it is stopped, and
  // not failed for a delivery or a source it never looked at
  stopIfAsked();
  return withRunningWork(storage, repo, async () => {
    await reference(storage, repo, delivery);
    const began = await sourceToLoad(storage, repo, ws, record, source);
    // The record's head as the load last saw it, with nothing announced on
    // the workspace: what a removal or a copy it waits out is judged against
    let head = await recordHead(storage, repo, ws, began.record);
    const queue = await queueTaken(storage, repo, ws, record, source, delivery, name, signal, report, options.onAsked);
    try {
      stopIfAsked();
      // A deploy that landed while it waited its turn may have changed the source
      const answered = await answeredAlready(storage, repo, ws, await sourceToLoad(storage, repo, ws, record, source, began), source, delivery, options.asOf);
      // A repeat that carries a later as-of goes on to hold the workspace, where it moves the source's as-of
      if (answered !== null && answered.later === undefined) return answered.result;
      // The words the load last said of what stopped it, while that holds the workspace's intent
      let told: string | undefined;
      // A removal or a copy that stopped the load while it held the workspace
      let taking: LockOperation | null = null;
      for (;;) {
        taking = await intentWaitedOut(storage, repo, ws, name, delivery, signal, report, told) ?? taking;
        told = undefined;
        // It has ended: the load fails where it took the workspace, and goes on where it left it
        if (taking !== null) {
          if (head === undefined || await workspaceTaken(storage, repo, ws, began.record, head)) throw new Error(intentStop(taking, ws).took);
          taking = null;
        }
        const lock = await acquireWorkspaceShared(storage, repo, ws, variant('dataset_write', null));
        // Something announced itself since the look: wait it out
        if (lock === null) continue;
        const watch = watchIntent(storage, repo, ws, signal);
        try {
          const declared = await sourceToLoad(storage, repo, ws, record, source, began);
          head = await recordHead(storage, repo, ws, declared.record);
          // Asked again of the workspace as it is held: a deploy since may have made the record forget the delivery
          const repeat = answered === null ? null : await answeredAlready(storage, repo, ws, declared, source, delivery, options.asOf);
          if (repeat !== null) {
            if (repeat.later !== undefined) await asOfMoved(storage, repo, ws, declared.record, source, repeat.later);
            return repeat.result;
          }
          const loaded = await loadHeld(storage, runner, repo, ws, name, declared, source, delivery, options, watch.signal, report);
          if (loaded !== null) return loaded;
        } catch (err) {
          // What stopped it is told below: its caller, or the intent
          if (!watch.signal.aborted) throw err;
        } finally {
          watch.stop();
          await lock.release();
        }
        stopIfAsked();
        // What stopped it, as the watch saw it: it may be done by now, but the
        // load was stopped by it, so says so, and waits it out
        const seen = watch.seen();
        if (seen !== null) {
          told = stoppedFor(seen, ws, undefined, report);
          if (intentStop(seen, ws).took !== undefined) taking = seen;
        }
      }
    } finally {
      await queue.release();
    }
  });
}

/** The source a delivery loads, as the workspace's package declares it. */
interface LoadDeclared {
  /** The record, as it resolves. */
  readonly record: ResolvedRecord;
  /** The hash of the source's load object, which its `.load` slot names. */
  readonly loadHash: string;
  /** The source's load object. */
  readonly load: RecordLoadObject;
}

/** What the workspace's package declares of a source a delivery is for. */
type Declared =
  | { readonly kind: 'loaded'; readonly declared: LoadDeclared }
  | { readonly kind: 'no_record' }
  | { readonly kind: 'no_source' }
  | { readonly kind: 'mutations' }
  | { readonly kind: 'fed'; readonly feed: string };

/** What the workspace's package declares of a source, read now. */
async function declaredSource(storage: StorageBackend, repo: string, ws: string, record: string, source: string): Promise<Declared> {
  const resolved = await resolveRecord(storage, repo, ws, record);
  if (resolved === null) return { kind: 'no_record' };
  const declared = resolved.sources.get(source);
  if (declared === undefined) return { kind: 'no_source' };
  if (declared.type !== 'load') return { kind: 'mutations' };
  const load = decodeRecordLoadObject(await storage.objects.read(repo, declared.value));
  if (load.feed.type === 'some') return { kind: 'fed', feed: pathToString(load.feed.value) };
  return { kind: 'loaded', declared: { record: resolved, loadHash: declared.value, load } };
}

/**
 * The source a load is for, as the workspace's package declares it now.
 *
 * @param began - The source as the load found it when it began; none at its
 *   start
 * @returns The source, declared now
 * @throws {RecordLoadRefusedError} At the load's start, when the source is not
 *   one a delivery is loaded into
 * @throws {Error} Once the load has begun, when a deploy removed the record or
 *   the source, or changed what it loads: the deploy's words
 */
async function sourceToLoad(
  storage: StorageBackend, repo: string, ws: string, record: string, source: string, began?: LoadDeclared,
): Promise<LoadDeclared> {
  const name = `${record}.${source}`;
  const now = await declaredSource(storage, repo, ws, record, source);
  if (began === undefined) {
    if (now.kind === 'loaded') return now.declared;
    throw new RecordLoadRefusedError(name, refusalWords(now, record, source));
  }
  const of = `source '${source}' of record '${record}'`;
  if (now.kind !== 'loaded') throw new Error(changedWords(now, record, source));
  if (!isTypeValueEqual(now.declared.load.key, began.load.key)) throw new Error(`the deploy changed the key type of ${of}`);
  if (!isTypeValueEqual(now.declared.load.delivery, began.load.delivery)) throw new Error(`the deploy changed the delivery type of ${of}`);
  return now.declared;
}

/** Why a load is refused at its start. */
function refusalWords(declared: Exclude<Declared, { kind: 'loaded' }>, record: string, source: string): string {
  switch (declared.kind) {
    case 'no_record': return `record '${record}' not found`;
    case 'no_source': return `record '${record}' has no source '${source}'`;
    case 'mutations': return `source '${source}' of record '${record}' is the solution's: its mutations write it, and no delivery is loaded into it`;
    case 'fed': return `${record}.${source} is fed by ${declared.feed}, and the dataflow loads it`;
  }
}

/**
 * Why no delivery is loaded into a source, read from its record's
 * description: what a load refuses at its start ({@link recordLoad}), in the
 * same words, for a caller that holds the description and would refuse before
 * it stores or sends a delivery.
 *
 * @param record - The record's name
 * @param source - The source's name
 * @param described - The record, as `recordDescribe` or a server's describe
 *   route answers it; `null` when the workspace has no such record
 * @returns The refusal's words; `null` for a source a delivery is loaded into
 *
 * @example
 * ```ts
 * const refusal = recordLoadRefusal('orders', 'own', await recordDescribe(storage, repo, 'main', 'orders'));
 * // source 'own' of record 'orders' is the solution's: its mutations write it, and no delivery is loaded into it
 * if (refusal !== null) throw new RecordLoadRefusedError('orders.own', refusal);
 * ```
 */
export function recordLoadRefusal(record: string, source: string, described: Pick<RecordSignature, 'sources'> | null): string | null {
  if (described === null) return refusalWords({ kind: 'no_record' }, record, source);
  const declared = described.sources.find((each) => sameName(each.name, source));
  if (declared === undefined) return refusalWords({ kind: 'no_source' }, record, source);
  if (!declared.external) return refusalWords({ kind: 'mutations' }, record, source);
  return declared.feed.type === 'some' ? refusalWords({ kind: 'fed', feed: pathToString(declared.feed.value) }, record, source) : null;
}

/** Why a load that has begun fails once a deploy changed its source. */
function changedWords(declared: Exclude<Declared, { kind: 'loaded' }>, record: string, source: string): string {
  const of = `source '${source}' of record '${record}'`;
  switch (declared.kind) {
    case 'no_record': return `the deploy removed record '${record}'`;
    case 'no_source': return `the deploy removed ${of}`;
    case 'mutations': return `the deploy gave ${of} to its mutations: nothing loaded`;
    case 'fed': return `the deploy fed ${of} from ${declared.feed}, and the dataflow loads it: nothing loaded`;
  }
}

/**
 * Re-references a delivery, and all it names, so a sweep keeps it.
 *
 * @throws {Error} When the store no longer holds it
 */
async function reference(storage: StorageBackend, repo: string, delivery: string): Promise<void> {
  if (!await touchReachable(storage, repo, [delivery])) {
    throw new Error(`delivery ${delivery} is not in the repository: upload it again`);
  }
}

/** What a lock asked for with a wait came to once its asker was stopped. */
const STOPPED = Symbol('stopped');

/**
 * A lock asked for with a wait, given up at once when the signal fires: a
 * lock that comes after it is let go as it comes.
 */
async function unlessStopped(asked: Promise<LockHandle | null>, signal: AbortSignal | undefined): Promise<LockHandle | null | typeof STOPPED> {
  if (signal === undefined) return asked;
  return new Promise((resolve, reject) => {
    let settled = false;
    const stop = (): void => {
      if (settled) return;
      settled = true;
      // The lock may still come: it is let go when it does
      asked.then((handle) => handle?.release(), () => undefined);
      resolve(STOPPED);
    };
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener('abort', stop, { once: true });
    asked.then((handle) => {
      signal.removeEventListener('abort', stop);
      if (settled) return;
      settled = true;
      resolve(handle);
    }, (err: unknown) => {
      signal.removeEventListener('abort', stop);
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

/**
 * Takes the load's turn among its source's loads: at once when no other holds
 * it or waits for it, and otherwise after a wait, reporting `queued` once and
 * re-referencing the delivery every {@link LOAD_WAIT_TURN_MS}.
 *
 * @remarks
 * Of a lock service that queues its waiters the load makes one wait, with no
 * bound, which keeps its place: its source's loads are given the turn in the
 * order they asked (ruling 37). Of any other it asks in turns of
 * {@link LOAD_WAIT_TURN_MS}, as often as it takes, and is served in no set
 * order: such a backend keeps its loads' order in its own queue.
 *
 * @param asked - Told once the load holds the turn, or has asked for it with
 *   a wait: a lock service that queues its waiters takes a waiter's place as
 *   it is asked
 * @returns The turn, which the load lets go once it ends
 * @throws {RecordLoadStoppedError} When the signal fires while it waits
 * @throws {Error} When the store no longer holds the delivery
 */
async function queueTaken(
  storage: StorageBackend, repo: string, ws: string, record: string, source: string, delivery: string, name: string,
  signal: AbortSignal | undefined, report: (progress: RecordLoadProgress) => void, asked: (() => void) | undefined,
): Promise<LockHandle> {
  const lock = loadQueueLock(ws, record, source);
  const operation = variant('dataset_write', null);
  const free = await storage.locks.acquire(repo, lock, operation);
  if (free !== null) {
    asked?.();
    return free;
  }
  report(variant('queued', null));
  // One wait with no bound where the lock service queues its waiters, which
  // keeps the load's place; turns elsewhere. Either is given up when the load
  // is stopped or its delivery is gone: a lock that comes after that is let go
  // as it comes
  const unbounded = storage.locks.queuesWaiters === true;
  const given = new AbortController();
  const stop = (): void => given.abort();
  if (signal?.aborted === true) stop();
  signal?.addEventListener('abort', stop, { once: true });
  let gone: unknown = null;
  // A wait with no bound has no turn to re-reference the delivery at
  const kept = !unbounded ? undefined : setInterval(() => {
    reference(storage, repo, delivery).catch((err: unknown) => {
      gone ??= err;
      stop();
    });
  }, LOAD_WAIT_TURN_MS);
  let told = false;
  try {
    for (;;) {
      const waiting = storage.locks.acquire(repo, lock, operation, { wait: true, timeout: unbounded ? Infinity : LOAD_WAIT_TURN_MS });
      // Its place among the waiters is taken as the lock is asked for
      if (!told) asked?.();
      told = true;
      const turn = await unlessStopped(waiting, given.signal);
      if (turn !== STOPPED && turn !== null) return turn;
      if (gone !== null) throw gone;
      if (turn === STOPPED) throw new RecordLoadStoppedError(name);
      // Not given: its turn ran out, and it asks again
      await reference(storage, repo, delivery);
    }
  } finally {
    clearInterval(kept);
    signal?.removeEventListener('abort', stop);
  }
}

/**
 * What a load says of what has announced itself on its workspace's intent,
 * each of which it waits out: a deploy or an export, after which it goes on;
 * and a removal of the workspace or a copy onto it, after which it goes on
 * unless that took the workspace ({@link workspaceTaken}), when it fails with
 * `took`, since nothing is left to load into (rulings 26 and 34).
 */
function intentStop(operation: LockOperation, ws: string): { readonly words: string; readonly took?: string } {
  const started = intentWords(operation, ws);
  switch (operation.type) {
    case 'deployment': return { words: `${started} started. The load goes on once the deploy is done…` };
    case 'removal': return {
      words: `${started} started. The load goes on once it is done, unless it removes the workspace…`,
      took: `${started} removed the workspace: nothing loaded`,
    };
    case 'workspace_copy': return {
      words: `${started} started. The load goes on once it is done, unless it replaces the workspace…`,
      took: `${started} replaced the workspace: nothing loaded`,
    };
    // An export reads the workspace, and leaves it as it was; nothing else announces itself
    case 'export':
    case 'dataflow':
    case 'dataset_write': return { words: `${started} started. The load goes on once it is done…` };
  }
}

/**
 * What a load does about an operation that stopped it: it reports `stopped`,
 * unless it said these words last.
 *
 * @param told - The words the load said last of what stopped it
 * @returns The words it said
 */
function stoppedFor(operation: LockOperation, ws: string, told: string | undefined, report: (progress: RecordLoadProgress) => void): string {
  const stop = intentStop(operation, ws);
  if (stop.words !== told) report(variant('stopped', stop.words));
  return stop.words;
}

/**
 * Whether a removal of the workspace, or a copy onto it, that the load waited
 * out took the workspace: it then holds the record no more, or holds another
 * than the one the load began on.
 *
 * @remarks
 * A copy's wait for its target, or a removal's for the workspace, may run
 * out once it has announced itself, so either can announce itself and then
 * leave the workspace as it was: the load goes on. Nothing writes the workspace
 * while its intent is held but what held it before, so the record's head is
 * then the one the load last saw, or a commit made onto it. A workspace
 * removed holds no record, and one copied onto holds its source's record,
 * whose history does not pass through that head.
 *
 * @param record - The record, as the load resolved it
 * @param head - The record's head commit as the load last saw it
 * @returns True when the record is gone, or its head is not a commit made
 *   onto `head`
 */
async function workspaceTaken(
  storage: StorageBackend, repo: string, ws: string, record: Pick<ResolvedRecord, 'refPath' | 'selfKeypath'>, head: string,
): Promise<boolean> {
  if (await storage.refs.workspaceRead(repo, ws) === null) return true;
  const now = await recordHead(storage, repo, ws, record);
  return now === undefined || await commitsSince(storage, repo, now, head) === null;
}

/** The record's head commit, as its ref names it; none for a record that holds no state. */
async function recordHead(
  storage: StorageBackend, repo: string, ws: string, record: Pick<ResolvedRecord, 'refPath' | 'selfKeypath'>,
): Promise<string | undefined> {
  const read = await storage.datasets.readVersioned(repo, ws, record.refPath);
  return read !== null && read.ref.type === 'value' ? read.ref.value.versions.get(record.selfKeypath) : undefined;
}

/**
 * Waits until nothing has announced itself on the workspace's intent: a
 * deploy, an export, a removal of the workspace or a copy onto it, each in
 * turns of {@link LOAD_WAIT_TURN_MS} with no bound, reporting `stopped` once
 * for each, and re-referencing the delivery each turn.
 *
 * @param told - The words the load last said of what stopped it, which it
 *   does not say again while the same holds the intent
 * @returns The last removal or copy it waited out, which may have taken the
 *   workspace; none when it waited for neither
 * @throws {RecordLoadStoppedError} When the signal fires while it waits
 */
async function intentWaitedOut(
  storage: StorageBackend, repo: string, ws: string, name: string, delivery: string,
  signal: AbortSignal | undefined, report: (progress: RecordLoadProgress) => void, told: string | undefined,
): Promise<LockOperation | null> {
  let taking: LockOperation | null = null;
  for (;;) {
    if (signal?.aborted === true) throw new RecordLoadStoppedError(name);
    const operation = await announcedIntent(storage, repo, ws);
    if (operation === null) return taking;
    if (intentStop(operation, ws).took !== undefined) taking = operation;
    told = stoppedFor(operation, ws, told, report);
    // A turn: the intent taken shared, which comes once what announced itself
    // lets it go, and let go at once, so nothing reads the load as an intent
    const turn = await unlessStopped(storage.locks.acquire(repo, workspaceIntentLock(ws), variant('dataset_write', null), {
      mode: 'shared', wait: true, timeout: LOAD_WAIT_TURN_MS,
    }), signal);
    if (turn === STOPPED) throw new RecordLoadStoppedError(name);
    await turn?.release();
    await reference(storage, repo, delivery);
  }
}

/** What watches the workspace's intent while a load holds the workspace. */
interface IntentWatch {
  /** Fires once something announces itself on the intent, or once the
   *  load's own signal does. */
  readonly signal: AbortSignal;
  /** What announced itself, once something has: what stopped the load. */
  seen(): LockOperation | null;
  /** Stops the watch. */
  stop(): void;
}

/**
 * Asks, every {@link INTENT_PROBE_MS}, whether something that takes the
 * workspace whole has announced itself, as a run in flight asks.
 */
function watchIntent(storage: StorageBackend, repo: string, ws: string, outer: AbortSignal | undefined): IntentWatch {
  const announced = new AbortController();
  let seen: LockOperation | null = null;
  let probing = false;
  const timer = setInterval(() => {
    if (probing || announced.signal.aborted) return;
    probing = true;
    announcedIntent(storage, repo, ws)
      .then((operation) => {
        if (operation === null) return;
        seen = operation;
        announced.abort();
      })
      // A probe that failed is made again at the next, as a run's is
      .catch(() => undefined)
      .finally(() => {
        probing = false;
      });
  }, INTENT_PROBE_MS);
  return {
    signal: outer === undefined ? announced.signal : AbortSignal.any([outer, announced.signal]),
    seen: () => seen,
    stop: () => clearInterval(timer),
  };
}

/**
 * Moves a source's as-of to the later one a repeat of its last delivery
 * carried: the slot alone.
 *
 * @remarks
 * No commit is made: the record's head, its state and every other slot stand,
 * so nothing that reads the record is due again. The caller holds the
 * workspace's lock, shared, as a record's write does. The write is
 * conditional on the ref it read, and tried again when a save landed
 * meanwhile, with no cap, as a load's commit is.
 *
 * @param record - The record, as the load resolved it
 * @param source - The source the delivery is of
 * @param asOf - The as-of the repeat carried
 */
async function asOfMoved(
  storage: StorageBackend, repo: string, ws: string, record: Pick<ResolvedRecord, 'refPath' | 'selfKeypath'>, source: string, asOf: Date,
): Promise<void> {
  const slot = sourceLoadSlots(source).asOf;
  for (let attempt = 1; ; attempt++) {
    const read = await storage.datasets.readVersioned(repo, ws, record.refPath);
    if (read === null || read.ref.type !== 'value') return;
    const { hash, versions } = read.ref.value;
    const head = versions.get(record.selfKeypath);
    const held = versions.get(slot);
    const later = laterAsOf(held, asOf);
    // Another repeat moved it as far already
    if (head === undefined || later === undefined || (held !== undefined && sameObject(held, later))) return;
    try {
      await storage.datasets.writeIf(repo, ws, record.refPath,
        variant('value', { hash, versions: nextVersions(versions, record.selfKeypath, head, { [slot]: later }) }), read.revision);
      return;
    } catch (err) {
      if (!(err instanceof DatasetRefConflictError)) throw err;
      await new Promise((resolve) => setTimeout(resolve, casBackoffMs(attempt)));
    }
  }
}

/**
 * Answers a delivery the source last loaded, under the same load (`again`),
 * or one older than the source's as-of (`superseded`).
 *
 * @returns The answer, or null when the delivery is to be loaded; and, for a
 *   repeat that carries a later as-of than the source's, that as-of, which the
 *   source's is moved to
 */
async function answeredAlready(
  storage: StorageBackend, repo: string, ws: string, declared: LoadDeclared, source: string, delivery: string, asOf: Date | undefined,
): Promise<{ readonly result: RecordLoadResult; readonly later?: Date } | null> {
  const held = await storage.datasets.read(repo, ws, declared.record.refPath);
  if (held === null || held.type !== 'value') return null;
  const { versions } = held.value;
  const slots = sourceLoadSlots(source);
  const last = versions.get(slots.delivery);
  const lastLoad = versions.get(slots.load);
  const none0 = { set: 0n, deleted: 0n, unchanged: 0n };
  if (last !== undefined && lastLoad !== undefined && sameObject(last, delivery) && sameObject(lastLoad, declared.loadHash)) {
    // The commit that applied it, unless a compaction cut it from the chain
    const commit = versions.get(slots.commit);
    const state = commit === undefined || commit.length === 0 ? null : await commitState(storage, repo, commit);
    const result: RecordLoadResult = {
      commit: commit !== undefined && state !== null ? some(commit) : none, state: state === null ? none : some(state), delivery, ...none0,
      outcome: variant('again', null),
    };
    const dated = asOf === undefined ? undefined : versions.get(slots.asOf);
    const stands = dated === undefined ? undefined : parseTime(dated);
    // Later than the source's, or the source has none: the repeat moves it
    const moves = asOf !== undefined && (stands?.success !== true || byTime(stands.value, asOf) < 0);
    return moves ? { result, later: asOf } : { result };
  }
  if (asOf === undefined) return null;
  const heldAsOf = versions.get(slots.asOf);
  const parsed = heldAsOf === undefined ? undefined : parseTime(heldAsOf);
  if (parsed?.success !== true || byTime(parsed.value, asOf) <= 0) return null;
  return { result: { commit: none, state: none, delivery, ...none0, outcome: variant('superseded', parsed.value) } };
}

/** The state a commit left, or null once the store no longer holds it. */
async function commitState(storage: StorageBackend, repo: string, commit: string): Promise<string | null> {
  try {
    return decodeRecordCommit(await storage.objects.read(repo, commit)).state;
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return null;
    throw err;
  }
}

/**
 * Steps 5 to 8 of a load, while it holds the workspace: the intake, the
 * source's run, the pieces and the commit, with a restart back to the run.
 *
 * @param work - Fires when the load is to stop: its caller's signal, or the
 *   intent's watch
 * @returns What the load did, or null once `work` stopped it before its
 *   commit wrote
 */
async function loadHeld(
  storage: StorageBackend, runner: TaskRunner, repo: string, ws: string, name: string, declared: LoadDeclared, source: string,
  delivery: string, options: RecordLoadOptions, work: AbortSignal, report: (progress: RecordLoadProgress) => void,
): Promise<RecordLoadResult | null> {
  const { record, load, loadHash } = declared;
  const adopted = await deliveryAdoptStored(storage, repo, ws, { address: name, type: load.delivery }, delivery, {
    runner, signal: work, onProgress: (progress) => report(variant('intake', adoptProgressToIntakeFile(name, progress))),
  });
  for (;;) {
    const held = await storage.datasets.read(repo, ws, record.refPath);
    if (held === null || held.type !== 'value') throw new Error(`record ${record.selfKeypath} holds no state`);
    const base = held.value.versions.get(record.selfKeypath);
    const run = await recordSourceRun(storage, repo, held.value.hash, source);
    let cached = 0;
    const ran = await runner.execute(storage, load.task, [adopted.hash, run], {
      anyRuntime: true,
      // As a load in a run is named
      taskName: name,
      signal: work,
      onPartitionProgress: (progress: PartitionProgress) => {
        if (progress.phase !== 'partition') return;
        if (progress.state === 'completed' && progress.cached === true) cached++;
        report(variant('pieces', { done: BigInt(progress.completed), total: BigInt(progress.total), cached: BigInt(cached) }));
      },
    });
    if (work.aborted) return null;
    if (ran.state !== 'success' || ran.outputHash === undefined) {
      throw new Error(`the load of ${name} failed: ${ran.error ?? `exit code ${ran.exitCode ?? 'unknown'}`}`);
    }
    report(variant('commit', null));
    const committed = await recordLoadCommit(storage, repo, ws, record, source, {
      delta: ran.outputHash,
      run,
      ...(base !== undefined && { base }),
      delivery,
      load: loadHash,
      ...(options.asOf !== undefined && { asOf: options.asOf }),
      execution: { inputsHash: inputsHash([adopted.hash, run]), executionId: ran.executionId },
      actor: options.actor,
      signal: work,
    });
    if (committed.kind === 'stopped') return null;
    if (committed.kind === 'committed') {
      const { set, deleted, unchanged } = committed.args;
      return {
        commit: some(committed.commit), state: some(committed.state), delivery, set, deleted, unchanged, outcome: variant('loaded', null),
      };
    }
    report(variant('restarted', committed.reason));
  }
}
