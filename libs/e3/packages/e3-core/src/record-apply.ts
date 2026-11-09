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
  isVariant,
  printFor,
  segmentKeyTypeOf,
  variant,
  type EastTypeValue,
} from '@elaraai/east';
import { DELTA_CONFLICT, type RecordSummaryOp, type RecordSummaryTotals } from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, readInOrder } from './concurrency.js';
import { DatasetSegments } from './dataset-open.js';
import { storeCollection, type CollectionSource } from './store-collection.js';
import type { StorageBackend } from './storage/interfaces.js';

/**
 * How many of a target's ops the apply takes ahead of the segment it applies:
 * the segments they fall in are read while it does, {@link OBJECT_CONCURRENCY}
 * at a time, rather than each when the apply reaches it — a remote store's
 * round trip each (#1573). What it holds is bounded by this, and by the
 * segments in flight.
 */
const OPS_AHEAD = 4096;

/** How many of a delta's own segments are read ahead of the one its entries
 *  are taken from. */
const DELTA_SEGMENTS_AHEAD = 4;

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
 * A summary index's write would leave a total it cannot hold (#1039): one no
 * rebuild could sum — a count below zero, milliseconds below zero or left
 * without a row, or a key the summary does not hold taken from — which a
 * rebuild (`e3 reindex`) answers; or one past the largest Integer, which a
 * rebuild sums too, and a finer tile answers. Never a stale write, so never
 * retried.
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
  const cursor = new DeltaCursor(inOrder(entries));
  // Each target's write, in the delta's order. A target is written while the
  // next takes its ops: the cursor is a target's until it has taken its last
  // (#1573), and every write has ended before the apply returns or throws.
  // A target's manifest is opened as the delta reaches it — beside the write
  // of the one before — so one the delta does not name is never read.
  const writes: Array<{ target: string; written: Promise<string> }> = [];
  try {
    for (let entry = await cursor.peek(); entry !== undefined; entry = await cursor.peek()) {
      if (entry.target === DELTA_CONFLICT) throw new DeltaConflictError(entry.key as string);
      const hash = targets.get(entry.target);
      if (hash === undefined) {
        throw new Error(
          `the mutation delta names target '${entry.target}', which this record does not hold` +
          ` — it has ${[...targets.keys()].join(', ')}`);
      }
      const write = applyTarget(storage, repo, entry.target, await DatasetSegments.open(storage, repo, hash), cursor);
      write.written.catch(() => { /* raised in the delta's order, below */ });
      writes.push({ target: entry.target, written: write.written });
      // A write that fails before its target has taken its ops stops the apply
      await Promise.race([write.taken, write.written]);
    }
  } finally {
    await Promise.allSettled(writes.map(({ written }) => written));
  }
  const written = new Map<string, string>();
  for (const write of writes) written.set(write.target, await write.written);
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
  const decode = decodeBeast2For(delta.typeValue);
  // Its segments are read a few ahead of the one taken from (#1573)
  for await (const segment of readInOrder(delta.segmentCount, DELTA_SEGMENTS_AHEAD, (i) => delta.segment(i))) {
    const entries: SortedMap<unknown, unknown> = decode(segment);
    for (const [key, op] of entries) {
      // Each entry is a target's: its key and its op are variants of the target's name.
      if (!isVariant(key) || !isVariant(op)) throw new Error(`delta ${deltaHash} holds an entry that is no target's`);
      yield { target: key.type, key: key.value, op: op.value };
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
 * The ops are taken a batch at a time, {@link OPS_AHEAD} of them, and the
 * segments a batch falls in are read in order, {@link OBJECT_CONCURRENCY} at
 * a time, while the segments before them are applied and written (#1573). A
 * segment's ops are never split between two batches. Once the target has
 * taken its last op it touches the cursor no more, and says so, so the next
 * target's ops are taken while its segments are written.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param target - The target, as the delta names it
 * @param segments - The manifest it holds, opened
 * @param cursor - The delta, at the target's first op
 * @returns `taken`, settled once the target has taken its last op from the
 *   cursor, or its write has failed; and `written`, the new manifest object's
 *   hash
 */
function applyTarget(
  storage: StorageBackend,
  repo: string,
  target: string,
  segments: DatasetSegments,
  cursor: DeltaCursor,
): { taken: Promise<void>; written: Promise<string> } {
  let release!: () => void;
  const taken = new Promise<void>((resolve) => { release = resolve; });
  const written = writeTarget(storage, repo, target, segments, cursor, release);
  // A write that fails before its last op is taken releases the cursor too
  written.then(release, release);
  return { taken, written };
}

/**
 * The write of {@link applyTarget}: `release` is called once the target's
 * last op is taken, and the cursor is not touched again.
 */
async function writeTarget(
  storage: StorageBackend,
  repo: string,
  target: string,
  segments: DatasetSegments,
  cursor: DeltaCursor,
  release: () => void,
): Promise<string> {
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

  /** A segment, as its bytes were read — or `null`, one past the last, which
   *  an insert after every key joins — with `ops` applied, as elements, once
   *  the door reads them. */
  function* editedElements(bytes: Uint8Array | null, ops: Array<[unknown, unknown]>): Generator<unknown> {
    const before = bytes !== null ? decodeSegment(bytes) : emptyOf(typeValue, keyCompare);
    const after = summary
      ? addToTotals(target, before as SortedMap<unknown, Totals>, ops, keyCompare, printKey!)
      : applyOps(apply, target, before, new SortedMap<unknown, unknown>(ops, keyCompare));
    yield* typeValue.type === 'Set'
      ? after as SortedSet<unknown>
      : (after as SortedMap<unknown, unknown>).entries();
  }

  /** Whether the target's last op is taken: the cursor is the next target's. */
  let ended = false;

  /** The target's next ops by the segment each falls in, which arrive
   *  together — the ops ascend, and so do the segments they fall in — at
   *  least {@link OPS_AHEAD} of them unless its run ends first, and none of a
   *  segment held back for the next batch. Once the run ends, the cursor is
   *  released and none is taken. */
  async function nextBatch(): Promise<Array<{ segment: number; ops: Array<[unknown, unknown]> }>> {
    const groups: Array<{ segment: number; ops: Array<[unknown, unknown]> }> = [];
    let taken = 0;
    while (!ended) {
      const entry = await cursor.peek();
      if (entry === undefined || entry.target !== target) {
        ended = true;
        release();
        break;
      }
      const segment = await segmentOf(entry.key);
      let last = groups.at(-1);
      if (last === undefined || last.segment !== segment) {
        if (taken >= OPS_AHEAD) break;
        last = { segment, ops: [] };
        groups.push(last);
      }
      last.ops.push([entry.key, entry.op]);
      cursor.take();
      taken++;
    }
    return groups;
  }

  /** The target's segments `[from, to)`, as they are stored: carrying the
   *  manifest, which the door then reads no part of again (#1573). */
  const untouched = (from: number, to: number): CollectionSource => ({ stored: segments.hash, from, to, manifest: segments.manifest });

  async function* sources(): AsyncGenerator<CollectionSource> {
    let at = 0;
    for (let groups = await nextBatch(); groups.length > 0; groups = await nextBatch()) {
      const reads = readInOrder(groups.length, OBJECT_CONCURRENCY, (k) => {
        const i = groups[k]!.segment;
        return i < segments.segmentCount ? segments.segment(i) : Promise.resolve(null);
      });
      for (const { segment, ops } of groups) {
        if (at < segment) yield untouched(at, segment);
        const read = await reads.next();
        yield { elements: editedElements(read.done === true ? null : read.value, ops) };
        at = segment + 1;
      }
    }
    if (at < segments.segmentCount) yield untouched(at, segments.segmentCount);
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
 * without a row. A change that would break either says the summary disagrees
 * with its record, and the write fails naming the key and `e3 reindex` rather
 * than store a total no rebuild could sum. One that would carry a total past
 * the largest Integer fails too, naming a finer tile: that total agrees with
 * the record, and a rebuild sums it, and refuses it, alike.
 *
 * @param target - The summary's name, for the refusal
 * @param before - The segment's totals, by key
 * @param ops - The segment's ops, each `add` and its change, in key order
 * @param keyCompare - The summary's key order
 * @param printKey - Prints a key, for the refusal
 * @returns The segment's totals after the changes
 * @throws {SummaryIntegrityError} When a change leaves a total the summary cannot hold
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
    const refuse = (why: string, remedy = 'the summary disagrees with its record; rebuild it (e3 reindex)') => new SummaryIntegrityError(
      `${target}: the total under ${printKey(key)} would be ${count} rows covering ${ms} ms — ${why}: ${remedy}`);
    if (count < 0n) throw refuse('fewer than no rows');
    if (ms < 0n) throw refuse('less than no time');
    // Agreeing with its record: a rebuild sums the same total, and refuses it too.
    if (count > INTEGER_MAX || ms > INTEGER_MAX) {
      throw refuse('past the largest Integer, which no total holds and a rebuild sums too', 'declare a finer tile, whose totals are smaller');
    }
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
