/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Applying a mutation delta — the write path that costs what a write touched.
 *
 * A delta is one sorted collection of every target's changes addressed by key:
 * the record's own collection under `primary`, and one arm per secondary index.
 * Applying it never rebuilds a target, and holds neither a target nor all of
 * its changes: the delta is read in order, a segment at a time, and the
 * changes that fall in one segment of a target are applied to that segment
 * alone, which is then re-cut and let go. The rest of the manifest names the
 * objects it already named, which a content-addressed store stores once.
 *
 * The segments that come out are the segments a rebuild would write, byte for
 * byte. That is a property of the boundary rule rather than of this code:
 * segmentation is a pure function of the value, so the re-cut carries every
 * untouched segment over wherever the edited value still starts a segment at
 * it, and re-cuts only between the edits and the first such segment on each
 * side.
 *
 * A summary index's arm (#1039) carries what to add to each of its totals,
 * not a patch of them: a write's program reads the record, never the summary.
 * Its ops are added to the totals the summary holds, a key inserted when the
 * summary holds none and deleted when its count reaches zero, so the totals
 * kept are the ones a rebuild sums.
 *
 * @packageDocumentation
 */

import {
  ConflictError,
  SortedMap,
  SortedSet,
  applyFor,
  compareFor,
  decodeBeast2For,
  fromEastTypeValue,
  printFor,
  segmentKeyTypeOf,
  variant,
  type EastTypeValue,
} from '@elaraai/east';
import { DELTA_CONFLICT, type RecordSummaryOp, type RecordSummaryTotals } from '@elaraai/e3-types';
import { DatasetSegments } from './dataset-open.js';
import { storeCollection, type CollectionSource } from './store-collection.js';
import type { StorageBackend } from './storage/interfaces.js';

/** One entry of a delta: the target it changes, the key, and the op. */
export interface DeltaEntry {
  /** `primary`, an index name, or {@link DELTA_CONFLICT}. */
  target: string;
  /** The key in the target's own key type. */
  key: unknown;
  /** The op, in the target's patch op type. */
  op: unknown;
}

/** A delta could not be applied to the state it was handed: the message says
 *  which key, and why. */
export class DeltaConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeltaConflictError';
  }
}

/**
 * A summary index disagrees with its record (#1039): a write's change would
 * leave a total no rebuild could sum — a count below zero, milliseconds below
 * zero or left without a row, or a key the summary does not hold taken from.
 * Never a stale write, so never retried: a rebuild (`e3 reindex`) answers it.
 */
export class SummaryIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SummaryIntegrityError';
  }
}

/** A summary's totals for one key, decoded. */
type Totals = RecordSummaryTotals;

/** The largest Integer: a total past it cannot be stored. */
const INTEGER_MAX = (1n << 63n) - 1n;

/** A delta's entries, read in order a segment at a time, with the next one in
 *  view. */
class DeltaCursor {
  private next: DeltaEntry | undefined;
  private ended = false;

  constructor(private readonly entries: AsyncIterator<DeltaEntry>) {}

  /** The next entry, not yet taken, or `undefined` at the end. */
  async peek(): Promise<DeltaEntry | undefined> {
    if (this.next === undefined && !this.ended) {
      const read = await this.entries.next();
      if (read.done === true) this.ended = true;
      else this.next = read.value;
    }
    return this.next;
  }

  /** Takes the entry in view. */
  take(): void {
    this.next = undefined;
  }
}

/**
 * Apply a mutation delta to a record's targets.
 *
 * @remarks
 * Reads the delta in order. Its canonical order puts each target's ops in one
 * contiguous run, in that target's key order, so the ops of one target
 * segment arrive together: the apply holds one segment of the delta, one
 * segment of a target, and the changes that fall in it. A target the delta
 * does not name keeps the manifest hash it had.
 *
 * A delta whose program found the write stale opens with a
 * {@link DELTA_CONFLICT} entry, which sorts before every target, so it is
 * refused before anything is written.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param targets - target name -> the manifest hash it currently holds
 * @param deltaHash - the delta object's content hash
 * @returns target name -> its new manifest hash, for the targets that changed
 * @throws {DeltaConflictError} When the delta says the write is stale, or an op
 *   disagrees with the state it lands on — never a silent clobber.
 * @throws {Error} When the delta names a target the record does not have.
 */
export async function applyDelta(
  storage: StorageBackend,
  repo: string,
  targets: Map<string, string>,
  deltaHash: string,
): Promise<Map<string, string>> {
  return applyDeltaEntries(storage, repo, targets, deltaEntries(storage, repo, deltaHash));
}

/**
 * Apply a mutation delta given as its entries: how a caller that holds the
 * delta applies it, rather than reading back the object it stored.
 *
 * @remarks
 * As {@link applyDelta}, over the entries in the delta's canonical order:
 * each target's ops one contiguous run, in that target's key order.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param targets - target name -> the manifest hash it currently holds
 * @param entries - the delta's entries, in canonical order
 * @returns target name -> its new manifest hash, for the targets that changed
 * @throws {DeltaConflictError} As {@link applyDelta} does.
 * @throws {Error} When the delta names a target the record does not have.
 */
export async function applyDeltaEntries(
  storage: StorageBackend,
  repo: string,
  targets: Map<string, string>,
  entries: Iterable<DeltaEntry> | AsyncIterable<DeltaEntry>,
): Promise<Map<string, string>> {
  const written = new Map<string, string>();
  const cursor = new DeltaCursor(inOrder(entries));
  for (let entry = await cursor.peek(); entry !== undefined; entry = await cursor.peek()) {
    if (entry.target === DELTA_CONFLICT) throw new DeltaConflictError(entry.key as string);
    const hash = targets.get(entry.target);
    if (hash === undefined) {
      throw new Error(
        `the mutation delta names target '${entry.target}', which this record does not hold` +
        ` — it has ${[...targets.keys()].join(', ')}`);
    }
    written.set(entry.target, await applyTarget(storage, repo, entry.target, hash, cursor));
  }
  return written;
}

/** A delta's entries as the cursor takes them, held or read. */
async function* inOrder(entries: Iterable<DeltaEntry> | AsyncIterable<DeltaEntry>): AsyncGenerator<DeltaEntry> {
  yield* entries;
}

/**
 * Reads a delta's entries in order, a segment at a time.
 *
 * @remarks
 * A delta's key is `variant(target, key)` and variant values order by case
 * NAME, so every target's ops are one contiguous ascending run, in the order
 * the target's own segments are laid out.
 */
async function* deltaEntries(
  storage: StorageBackend,
  repo: string,
  deltaHash: string,
): AsyncGenerator<DeltaEntry> {
  const delta = await DatasetSegments.open(storage, repo, deltaHash);
  const decode = decodeBeast2For(delta.typeValue) as (bytes: Uint8Array) => SortedMap<unknown, unknown>;
  for (let i = 0; i < delta.segmentCount; i++) {
    for (const [key, op] of decode(await delta.segment(i))) {
      const { type: target, value } = key as { type: string; value: unknown };
      yield { target, key: value, op: (op as { value: unknown }).value };
    }
  }
}

/** What one target's arm of a delta did, by op. */
export interface DeltaArmSummary {
  /** `primary`, or an index name. */
  target: string;
  insert: number;
  update: number;
  delete: number;
  /** Changes added to a summary's totals (#1039). */
  add: number;
}

/**
 * What a delta changed, per target — what `e3 history --delta` prints.
 *
 * @remarks
 * Reads the delta the way the apply does, so it costs one pass over an object
 * that is O(what the mutation touched) rather than a diff of two states.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param deltaHash - the delta object's content hash
 * @returns one summary per target the delta names, in canonical order
 */
export async function summarizeDelta(
  storage: StorageBackend,
  repo: string,
  deltaHash: string,
): Promise<DeltaArmSummary[]> {
  const summaries: DeltaArmSummary[] = [];
  for await (const entry of deltaEntries(storage, repo, deltaHash)) {
    let summary = summaries.at(-1);
    if (summary === undefined || summary.target !== entry.target) {
      summary = { target: entry.target, insert: 0, update: 0, delete: 0, add: 0 };
      summaries.push(summary);
    }
    const tag = (entry.op as { type: string }).type;
    if (tag === 'insert' || tag === 'update' || tag === 'delete' || tag === 'add') summary[tag]++;
  }
  return summaries;
}

/**
 * Apply one target's ops, taken from the cursor as far as they run, to the
 * segments they fall in, and write the target's new manifest.
 *
 * @remarks
 * The target goes through the store's door as the runs of segments no op
 * touches, as they are stored, and each touched segment's elements with its
 * ops applied. A run is carried over wherever the edited value still starts a
 * segment at it. A target an older e3 wrote — one blob, or a manifest cut
 * under an earlier rule — is refused, by the opener or the door.
 *
 * @returns the new manifest object's hash
 */
async function applyTarget(
  storage: StorageBackend,
  repo: string,
  target: string,
  hash: string,
  cursor: DeltaCursor,
): Promise<string> {
  const segments = await DatasetSegments.open(storage, repo, hash);
  const typeValue = segments.typeValue;
  const keyType = segmentKeyTypeOf(typeValue);
  if (keyType === null) {
    throw new Error(`a mutation delta addresses Set and Dict targets by key; '${target}' holds Array`);
  }
  const keyCompare = compareFor(keyType as never) as (a: unknown, b: unknown) => number;
  const apply = applyFor(typeValue);
  const decodeSegment = decodeBeast2For(typeValue) as (bytes: Uint8Array) => unknown;
  // A summary's arm adds to its totals (#1039): told by its first op, as every
  // op of one target is the same kind.
  const first = await cursor.peek();
  const summary = first !== undefined && first.target === target && (first.op as { type: string }).type === 'add';
  const printKey = summary ? printFor(fromEastTypeValue(keyType as EastTypeValue)) : undefined;

  // Which segment a key falls in. A key before every fence lands in segment 0
  // and one past them all in the last, so an insert always has a segment to
  // join — that is what makes a growing collection re-cut rather than
  // accumulate a segment per write.
  const segmentOf = async (key: unknown): Promise<number> =>
    segments.segmentCount === 0 ? 0 : segments.segmentFor(key);

  /** Segment `i` with `ops` applied, as elements. */
  async function* editedElements(i: number, ops: Array<[unknown, unknown]>): AsyncGenerator<unknown> {
    const before = i < segments.segmentCount
      ? decodeSegment(await segments.segment(i))
      : emptyOf(typeValue, keyCompare);
    const after = summary
      ? addToTotals(target, before as SortedMap<unknown, Totals>, ops, keyCompare, printKey!)
      : applyOps(apply, target, before, new SortedMap<unknown, unknown>(ops, keyCompare));
    yield* typeValue.type === 'Set'
      ? after as SortedSet<unknown>
      : (after as SortedMap<unknown, unknown>).entries();
  }

  async function* sources(): AsyncGenerator<CollectionSource> {
    let at = 0;
    let entry = await cursor.peek();
    let seg = entry !== undefined && entry.target === target ? await segmentOf(entry.key) : 0;
    while (entry !== undefined && entry.target === target) {
      // The ops of one segment, which arrive together: the ops ascend, and so
      // do the segments they fall in.
      const i = seg;
      const ops: Array<[unknown, unknown]> = [];
      while (entry !== undefined && entry.target === target && seg === i) {
        ops.push([entry.key, entry.op]);
        cursor.take();
        entry = await cursor.peek();
        if (entry !== undefined && entry.target === target) seg = await segmentOf(entry.key);
      }
      if (at < i) yield { stored: hash, from: at, to: i };
      yield { elements: editedElements(i, ops) };
      at = i + 1;
    }
    if (at < segments.segmentCount) yield { stored: hash, from: at, to: segments.segmentCount };
  }

  return storeCollection(storage, repo, typeValue, sources());
}

/**
 * A summary's totals with a write's changes added (#1039): each key's change
 * added to the total held, a key the summary does not hold inserted, and a
 * total whose count reaches zero deleted.
 *
 * @remarks
 * A count is how many rows touch a key's period, so a total held has a positive
 * count, and the milliseconds the rows cover are never negative and are none
 * without a row. A change that would break either — or carry a total past the
 * largest Integer — says the summary disagrees with its record, and the write
 * fails naming the key rather than store a total no rebuild could sum.
 *
 * @param target - The summary's name, for the refusal
 * @param before - The segment's totals, by key
 * @param ops - The segment's ops, each `add` and its change, in key order
 * @param keyCompare - The summary's key order
 * @param printKey - Prints a key, for the refusal
 * @returns The segment's totals after the changes
 * @throws {SummaryIntegrityError} When a change leaves a total no rebuild sums
 */
function addToTotals(
  target: string,
  before: SortedMap<unknown, Totals>,
  ops: Array<[unknown, unknown]>,
  keyCompare: (a: unknown, b: unknown) => number,
  printKey: (key: unknown) => string,
): SortedMap<unknown, Totals> {
  const after = new SortedMap<unknown, Totals>([...before], keyCompare);
  for (const [key, op] of ops) {
    // Every op of a summary's arm is an `add`, as its first op said; one of
    // another kind is a delta no program writes.
    const change = op as RecordSummaryOp;
    if (change.type !== 'add') {
      throw new SummaryIntegrityError(`${target}: a summary's arm carries '${String((op as { type: unknown }).type)}' under ${printKey(key)}, where every op adds to a total`);
    }
    const held = after.get(key);
    const count = (held?.count ?? 0n) + change.value.count;
    const ms = (held?.ms ?? 0n) + change.value.ms;
    const refuse = (why: string) => new SummaryIntegrityError(
      `${target}: the total under ${printKey(key)} would be ${count} rows covering ${ms} ms — ${why}: ` +
      'the summary disagrees with its record; rebuild it (e3 reindex)');
    if (count < 0n) throw refuse('fewer than no rows');
    if (ms < 0n) throw refuse('less than no time');
    if (count > INTEGER_MAX || ms > INTEGER_MAX) throw refuse('past the largest Integer');
    if (count === 0n) {
      if (ms !== 0n) throw refuse('time with no row');
      after.delete(key);
    } else {
      after.set(key, { count, ms });
    }
  }
  return after;
}

/** A value with the target's ops applied; an op that disagrees with it is the
 *  stale-write conflict, reported against the target. */
function applyOps(
  apply: (value: unknown, patch: unknown) => unknown,
  target: string,
  before: unknown,
  ops: SortedMap<unknown, unknown>,
): unknown {
  try {
    return apply(before, variant('patch', ops));
  } catch (err) {
    if (err instanceof ConflictError) throw new DeltaConflictError(`${target}: ${err.message}`);
    throw err;
  }
}

/** An empty value of a target's collection type, in its own key order. */
function emptyOf(typeValue: EastTypeValue, keyCompare: (a: unknown, b: unknown) => number): unknown {
  return typeValue.type === 'Set'
    ? new SortedSet<unknown>(undefined, keyCompare)
    : new SortedMap<unknown, unknown>(undefined, keyCompare);
}
