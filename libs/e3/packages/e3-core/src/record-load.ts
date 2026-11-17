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

import { DateTimeType, StringType, compareFor, encodeBeast2For, equalFor, none, parseFor, printFor, some, variant } from '@elaraai/east';
import {
  RecordLoadArgsType, decodeRecordCommit, loadCommitName, loadCommitSource, type RecordCommit, type RecordLoadArgs,
} from '@elaraai/e3-types';
import { applyDelta, summarizeDelta } from './record-apply.js';
import { PENDING_SLOT, pendingSources, sourceEntriesIn, sourceLoadSlots, sourceSegments, sourcesSlot } from './record-slots.js';
import {
  casBackoffMs, encodeMutationArgs, named, nextVersions, readRecordState, storeCommit, type RecordStateRefs, type ResolvedRecord,
} from './records.js';
import { DatasetSegments } from './dataset-open.js';
import { storeCollection, type CollectionSource } from './store-collection.js';
import { DatasetRefConflictError, ObjectNotFoundError } from './errors.js';
import type { StorageBackend } from './storage/interfaces.js';

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
  /** Stops the commit before its next attempt, and before its write. */
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
  // The last head the result holds on, and the result: the record's targets with the load applied
  let checked = options.base;
  let result: RecordStateRefs | undefined;
  let counts: Pick<RecordLoadArgs, 'set' | 'deleted' | 'unchanged'> | undefined;
  for (let attempt = 1; ; attempt++) {
    if (stopped()) return { kind: 'stopped' };
    const read = await storage.datasets.readVersioned(repo, ws, record.refPath);
    if (read === null || read.ref.type !== 'value') throw new Error(`record ${record.selfKeypath} holds no state`);
    const { hash: stateHash, versions } = read.ref.value;
    const head = versions.get(record.selfKeypath);
    if (head === undefined) throw new Error(`record ${record.selfKeypath} names no head commit`);

    const passed = checked === undefined ? null : await commitsSince(storage, repo, head, checked);
    if (passed !== null && passed.every((commit) => replays(commit, source))) {
      if (result === undefined) result = await applied(storage, repo, await readRecordState(storage, repo, stateHash), delta, own);
      // Oldest first, as they landed: each a save's few ops, or another source's load
      else for (const commit of passed.reverse()) if (commit.delta.type === 'some') result = await applied(storage, repo, result, commit.delta.value);
    } else {
      if (!sameObject(await recordSourceRun(storage, repo, stateHash, source), run)) {
        return { kind: 'restart', reason: `the entries of source '${source}' changed under its load` };
      }
      result = await applied(storage, repo, await readRecordState(storage, repo, stateHash), delta, own);
    }
    checked = head;
    counts ??= await loadCounts(storage, repo, delta, run);

    const pending = pendingSources(versions);
    const args: RecordLoadArgs = {
      delivery: options.delivery,
      load: options.load,
      asOf: options.asOf === undefined ? none : some(options.asOf),
      first: pending.some((name) => sameName(name, source)),
      execution: { ...options.execution },
      ...counts,
    };
    const { stateHash: committed, commitHash } = await storeCommit(storage, repo, result,
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
 * A record's targets once a delta is applied to them.
 *
 * @param state - The targets the delta applies to
 * @param delta - The delta
 * @param cases - The sources the delta may write, for the load's own; none
 *   for a replay of a commit checked when it committed
 */
async function applied(storage: StorageBackend, repo: string, state: RecordStateRefs, delta: string, cases?: ReadonlySet<string>): Promise<RecordStateRefs> {
  const targets = new Map<string, string>([['primary', state.primary]]);
  for (const [name, entry] of state.indexes) targets.set(name, entry.manifest);
  const written = await applyDelta(storage, repo, targets, delta, cases === undefined ? {} : { cases });
  const indexes = new Map(state.indexes);
  for (const [name, manifest] of written) {
    if (name !== 'primary') indexes.set(name, { manifest, index: state.indexes.get(name)!.index });
  }
  return { primary: written.get('primary') ?? state.primary, indexes };
}

/**
 * What a load's delta does to its source's entries: those it sets, those it
 * deletes, and those of the run it leaves as they were.
 */
async function loadCounts(storage: StorageBackend, repo: string, delta: string, run: string): Promise<Pick<RecordLoadArgs, 'set' | 'deleted' | 'unchanged'>> {
  const primary = (await summarizeDelta(storage, repo, delta)).find((arm) => sameName(arm.target, 'primary'));
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
