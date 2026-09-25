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
 * @packageDocumentation
 */

import {
  ConflictError,
  SortedMap,
  SortedSet,
  applyFor,
  compareFor,
  decodeBeast2For,
  segmentKeyTypeOf,
  variant,
  type EastTypeValue,
} from '@elaraai/east';
import { DELTA_CONFLICT } from '@elaraai/e3-types';
import { DatasetSegments } from './dataset-open.js';
import { storeCollection, type CollectionSource } from './store-collection.js';
import type { StorageBackend } from './storage/interfaces.js';

/** One entry of a delta: the target it changes, the key, and the op. */
interface DeltaEntry {
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
  const written = new Map<string, string>();
  const cursor = new DeltaCursor(deltaEntries(storage, repo, deltaHash)[Symbol.asyncIterator]());
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
      summary = { target: entry.target, insert: 0, update: 0, delete: 0 };
      summaries.push(summary);
    }
    const tag = (entry.op as { type: string }).type;
    if (tag === 'insert' || tag === 'update' || tag === 'delete') summary[tag]++;
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
 * ops applied. A run cut by the current rule is carried over wherever the
 * edited value still starts a segment at it; one cut under another rule — an
 * earlier version of this one, or a legacy blob's own geometry — is read and
 * written again, so a target's first write lays it out under the current rule
 * and the writes after it are incremental.
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
    const after = applyOps(apply, target, before, new SortedMap<unknown, unknown>(ops, keyCompare));
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
