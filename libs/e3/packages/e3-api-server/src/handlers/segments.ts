/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Decoded segments, kept (#1351): what every dataset route reads a collection
 * through.
 *
 * A collection is a manifest of segment objects, and a segment is the unit a
 * read fetches. It is not the unit a read decodes: a segment is walked once —
 * its keys checked, where each row starts noted, no value built (east's
 * `beast2SegmentRowsFor`) — and a search's bounds and a read's rows are then
 * decoded from its bytes, each when it is asked for. So a search of a
 * segment's keys, or a read of a few of its rows, costs the walk and those
 * rows, never every row the segment holds.
 *
 * The routes read the segments a request touches here, several at a time,
 * each once, and each is kept by its content hash, bounded by its weight: the
 * bytes it holds its rows in, which is a fraction of what the rows weigh
 * built. So a pan, a repeated window or a second search of the same segment
 * fetches and walks nothing. A segment two requests ask for at once is read
 * once, for both. A Set's segment, and one whose rows hold a function, cannot
 * be read from its bytes: it is decoded whole, kept at its decoded weight —
 * the measure every runtime's pager cache counts a segment by (east's
 * `decodedWeightFor`) — and read the same way.
 *
 * A row is decoded frozen, and anew for each read, so no request can change
 * what a later one is served. An entry is keyed by the backend it was read
 * through and the repository it was read from as well as its hash, as the
 * routes' cache of opened datasets is, so two backends, or two repositories,
 * holding the same bytes never share one.
 *
 * @packageDocumentation
 */

import { compareFor, openBeast2PagesFor, segmentKeyTypeOf, type EastTypeValue } from '@elaraai/east';
import { beast2SegmentRowsFor, type Beast2SegmentRows } from '@elaraai/east/internal';
import { eachAtMost, type DatasetSegments, type StorageBackend } from '@elaraai/e3-core/portable';

/** How many segment objects one request reads at once. */
export const SEGMENT_READ_CONCURRENCY = 8;

/**
 * The weight the kept segments may hold between them, in bytes: 64 MiB. The
 * segment read last always stays, so one segment over the budget is still
 * kept, alone.
 */
export const DECODED_SEGMENTS_MAX_WEIGHT = 64 * 1024 * 1024;

/** One segment, read: its rows, each decoded when it is asked for. */
export interface DecodedSegment {
  /** How many elements (pairs, for a Dict) it holds. */
  readonly count: number;
  /**
   * A Set's element or a Dict's key at a row — what a search bisects.
   *
   * @param row - The row, from 0, within the segment
   * @returns The key, frozen
   * @throws {SegmentCorruptError} When the row's bytes do not decode
   */
  key(row: number): unknown;
  /**
   * The row as an element of its collection: an Array's item, a Set's element
   * or a Dict's `[key, value]` pair.
   *
   * @param row - The row, from 0, within the segment
   * @returns The element, its values frozen
   * @throws {SegmentCorruptError} When the row's bytes do not decode
   */
  element(row: number): unknown;
}

/** A segment's rows as east reads them, a row that does not decode answered
 *  as the segment's fault, as a segment that does not walk is. */
class Rows implements DecodedSegment {
  readonly count: number;

  constructor(private readonly rows: Beast2SegmentRows) {
    this.count = rows.count;
  }

  key(row: number): unknown {
    try {
      return this.rows.key(row);
    } catch (err) {
      throw corrupt(err);
    }
  }

  element(row: number): unknown {
    try {
      return this.rows.element(row);
    } catch (err) {
      throw corrupt(err);
    }
  }
}

/** What a segment's bytes threw, as the segment's fault: the store gave the
 *  bytes its name holds, so that they do not read as this collection's
 *  segment is never the store's. */
function corrupt(err: unknown): SegmentCorruptError {
  return new SegmentCorruptError(err instanceof Error ? err.message : String(err));
}

/** A kept segment: its read, shared while it is in flight, and its weight
 *  once it has landed. */
interface Kept {
  readonly decoded: Promise<DecodedSegment>;
  /** The weight it counts for; 0 until it has landed. */
  weight: number;
  landed: boolean;
}

/** The kept segments, least recently used first: the Map's order is the
 *  recency list, and a hit moves its entry last. */
const kept = new Map<string, Kept>();
let keptWeight = 0;

/** What the cache has done, for {@link decodedSegmentStats}. */
let decodes = 0;
let hits = 0;

/** A backend's number in a cache key — lazily, and without keeping it alive. */
const backendIds = new WeakMap<object, number>();
let nextBackendId = 0;

/**
 * A storage backend's number, as the dataset routes' caches name it in their
 * keys: every cache entry names the backend it was read through.
 *
 * @param storage - The backend
 * @returns Its number, the same for as long as the backend lives
 */
export function backendIdOf(storage: StorageBackend): number {
  let id = backendIds.get(storage);
  if (id === undefined) {
    id = nextBackendId++;
    backendIds.set(storage, id);
  }
  return id;
}

/** Each collection type's reader of one segment object's rows, built once. */
const readers = new WeakMap<EastTypeValue, (bytes: Uint8Array) => Beast2SegmentRows>();

function readerFor(typeValue: EastTypeValue): (bytes: Uint8Array) => Beast2SegmentRows {
  let reader = readers.get(typeValue);
  if (reader === undefined) {
    const open = openBeast2PagesFor(typeValue, { frozen: true });
    const rowsOf = beast2SegmentRowsFor(typeValue);
    // A segment object holds its one segment.
    reader = (bytes) => rowsOf(open(bytes), 0);
    readers.set(typeValue, reader);
  }
  return reader;
}

/** Lets the least recently used landed segments go until the kept weight is
 *  within the budget, keeping the one that just landed whatever it weighs. */
function evict(landed: string): void {
  for (const [key, entry] of kept) {
    if (keptWeight <= DECODED_SEGMENTS_MAX_WEIGHT) return;
    if (!entry.landed || key === landed) continue;
    kept.delete(key);
    keptWeight -= entry.weight;
  }
}

/** Reads segment `i` of a collection through its backend, and walks it. */
async function decode(segments: DatasetSegments, i: number): Promise<{ segment: DecodedSegment; weight: number }> {
  const read = readerFor(segments.typeValue);
  const bytes = await segments.segment(i);
  let rows: Beast2SegmentRows;
  try {
    rows = read(bytes);
  } catch (err) {
    throw corrupt(err);
  }
  decodes++;
  return { segment: new Rows(rows), weight: rows.weight };
}

/**
 * Segment `i` of a collection, its rows to read: from the kept segments, or
 * read and walked once and kept.
 *
 * @param storage - The backend the collection is read through
 * @param repo - The repository it is in
 * @param segments - The opened collection
 * @param i - The segment's index
 * @returns The segment's rows
 * @throws {SegmentCorruptError} When the segment does not hold what its manifest
 *   says of it: another element count, a first key that is not its fence, or
 *   a last key at or past the next segment's fence
 */
async function decodedSegment(
  storage: StorageBackend, repo: string, segments: DatasetSegments, i: number,
): Promise<DecodedSegment> {
  const key = `${backendIdOf(storage)}\u0000${repo}\u0000${segments.manifest.entries[i]!.hash}`;
  let entry = kept.get(key);
  if (entry !== undefined) {
    hits++;
    kept.delete(key);
    kept.set(key, entry); // the most recently used goes last
  } else {
    // The decode settles after this turn, by which time the entry is set.
    let fresh: Kept | undefined;
    const decoded = decode(segments, i).then(({ segment, weight }) => {
      if (fresh !== undefined && kept.get(key) === fresh) {
        fresh.weight = weight;
        fresh.landed = true;
        keptWeight += weight;
        evict(key);
      }
      return segment;
    }, (err: unknown) => {
      // A read that failed is not kept: the next asks the store again.
      if (fresh !== undefined && kept.get(key) === fresh) kept.delete(key);
      throw err;
    });
    fresh = { decoded, weight: 0, landed: false };
    kept.set(key, fresh);
    entry = fresh;
  }
  const segment = await entry.decoded;
  await checkSegmentOrder(segments, i, segment);
  return segment;
}

/**
 * The segments of a collection a request touches, their rows to read: each
 * read once, {@link SEGMENT_READ_CONCURRENCY} at a time, through the kept
 * segments.
 *
 * @param storage - The backend the collection is read through
 * @param repo - The repository it is in
 * @param segments - The opened collection
 * @param indices - The segments, in any order, repeats and all
 * @returns Each segment's rows, by its index
 * @throws {SegmentCorruptError} When a segment does not hold what its manifest
 *   says of it
 */
export async function decodedSegments(
  storage: StorageBackend, repo: string, segments: DatasetSegments, indices: Iterable<number>,
): Promise<Map<number, DecodedSegment>> {
  const wanted = [...new Set(indices)].sort((a, b) => a - b);
  const out = new Map<number, DecodedSegment>();
  await eachAtMost(wanted, SEGMENT_READ_CONCURRENCY, async (i) => {
    out.set(i, await decodedSegment(storage, repo, segments, i));
  });
  return out;
}

/**
 * A segment whose bytes do not decode as its collection's segment, or that
 * does not hold what the collection's manifest says of it: the wire must hold
 * the canonical value, split into disjoint ascending ranges, so such a segment
 * is corrupt, or was written before that contract. A route answers it as the
 * refusal of the read it was making: `dataset_not_canonical` for a window or a
 * search, `dataset_not_segmented` for one writer segment.
 */
export class SegmentCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SegmentCorruptError';
  }
}

/**
 * Checks a segment against its manifest: its element count, and, for a Set or
 * a Dict, that its first key is its fence and its last key falls before the
 * next segment's fence — the checks a pager's window makes across the segments
 * it reads, made for each segment a route reads. A kept segment is checked
 * for each collection it is read as a segment of: it is kept by its content,
 * and what a manifest says of it is the manifest's.
 *
 * @param segments - The opened collection
 * @param i - The segment's index
 * @param segment - Its rows
 * @throws {SegmentCorruptError} When it does not hold what the manifest says
 */
async function checkSegmentOrder(segments: DatasetSegments, i: number, segment: DecodedSegment): Promise<void> {
  if (segment.count !== segments.counts[i]) {
    throw new SegmentCorruptError(`beast2 v5: segment ${i} holds ${segment.count} elements, and its manifest says ${segments.counts[i]}`);
  }
  const keyType = segmentKeyTypeOf(segments.typeValue);
  if (keyType === null || segment.count === 0) return;
  const cmp = comparators(keyType);
  const noun = segments.typeValue.type === 'Dict' ? 'key' : 'element';
  if (cmp(segment.key(0), await segments.fence(i)) !== 0) {
    throw new SegmentCorruptError(`beast2 v5: segment ${i}'s first ${noun} is not its fence — the wire must hold the canonical value (corrupt or pre-contract blob)`);
  }
  if (i + 1 < segments.segmentCount && cmp(segment.key(segment.count - 1), await segments.fence(i + 1)) >= 0) {
    throw new SegmentCorruptError(`beast2 v5: segments ${i} and ${i + 1} are not disjoint ascending ${noun} ranges — the wire must hold the canonical value (corrupt or pre-contract blob)`);
  }
}

/** Each key type's comparator, built once. */
const comparatorCache = new WeakMap<EastTypeValue, (a: unknown, b: unknown) => number>();

/**
 * A key type's East comparator, built once per type object.
 *
 * @param keyType - The key type
 * @returns Its comparator
 */
export function comparators(keyType: EastTypeValue): (a: unknown, b: unknown) => number {
  let cmp = comparatorCache.get(keyType);
  if (cmp === undefined) {
    cmp = compareFor(keyType as never) as (a: unknown, b: unknown) => number;
    comparatorCache.set(keyType, cmp);
  }
  return cmp;
}

/**
 * The first of some rows, in order, that a predicate holds at, where it is
 * false, then true, over them: a binary search, which asks of some ten rows of
 * a thousand.
 *
 * @param count - How many rows there are
 * @param pred - The monotone predicate, of a row from 0
 * @returns The first row it holds at, or `count` when it holds at none
 */
export function firstWhere(count: number, pred: (row: number) => boolean): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Where a key falls in a Dict's segment, and the pair the segment holds under
 * it: found by bisection of its keys, the one value decoded when the key is
 * there.
 *
 * @param segment - The segment that can hold the key
 * @param cmp - The key type's comparator
 * @param key - The key
 * @returns The row the key is at, or would take — the segment's count when it
 *   is past its last — and the `[key, value]` pair held under it, if any
 * @throws {SegmentCorruptError} When a row's bytes do not decode
 */
export function rowUnder(
  segment: DecodedSegment, cmp: (a: unknown, b: unknown) => number, key: unknown,
): { at: number; pair: readonly [unknown, unknown] | undefined } {
  const at = firstWhere(segment.count, (row) => cmp(segment.key(row), key) >= 0);
  const held = at < segment.count && cmp(segment.key(at), key) === 0;
  return { at, pair: held ? segment.element(at) as [unknown, unknown] : undefined };
}

/**
 * What the kept segments have done, and what they hold now.
 *
 * @returns The segments read and walked (`decodes`), the reads the kept
 *   segments served, the segments kept, their weight and the budget
 */
export function decodedSegmentStats(): { decodes: number; hits: number; segments: number; weight: number; budget: number } {
  return { decodes, hits, segments: kept.size, weight: keptWeight, budget: DECODED_SEGMENTS_MAX_WEIGHT };
}
