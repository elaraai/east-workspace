/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Decoded segments, kept (#1351): what every dataset route reads a collection
 * through.
 *
 * A collection is a manifest of segment objects, and a segment is the unit of
 * every read: nothing reads inside one, so a window, a key search or a row
 * looked up by its key costs that segment's read and decode. The routes read
 * the segments a request touches here, several at a time, each once, and each
 * decoded segment is kept by its content hash, bounded by its decoded weight —
 * the measure every runtime's pager cache counts a segment by (east's
 * `decodedWeightFor`) — so a pan, a repeated window or a second search of the
 * same segment decodes nothing. A segment two requests ask for at once is
 * read once, for both.
 *
 * A decoded segment is pure data, and it is decoded frozen: every request it
 * serves shares it, and none can change what a later one is served. An entry
 * is keyed by the backend it was read through and the repository it was read
 * from as well as its hash, as the routes' cache of opened datasets is, so two
 * backends, or two repositories, holding the same bytes never share one.
 *
 * @packageDocumentation
 */

import { compareFor, openBeast2PagesFor, segmentKeyTypeOf, type EastTypeValue } from '@elaraai/east';
import { decodedWeightFor } from '@elaraai/east/internal';
import { eachAtMost, type DatasetSegments, type StorageBackend } from '@elaraai/e3-core/portable';

/** How many segment objects one request reads at once. */
export const SEGMENT_READ_CONCURRENCY = 8;

/**
 * The decoded weight the kept segments may hold between them, in bytes: 64
 * MiB. The segment decoded last always stays, so one segment over the budget
 * is still kept, alone.
 */
export const DECODED_SEGMENTS_MAX_WEIGHT = 64 * 1024 * 1024;

/** One segment, decoded. */
export interface DecodedSegment {
  /** The segment's collection, frozen: an array, a `SortedSet` or a `SortedMap`. */
  readonly value: unknown;
  /** A Set's elements or a Dict's keys, in order — what a search bisects. Empty
   *  for an Array, which has no key order. */
  readonly keys: readonly unknown[];
  /** A Dict's values, in its keys' order. Empty for a Set or an Array. */
  readonly values: readonly unknown[];
  /** How many elements (pairs, for a Dict) it holds. */
  readonly count: number;
}

/** A kept segment: its decode, shared while it is in flight, and its weight
 *  once it has landed. */
interface Kept {
  readonly decoded: Promise<DecodedSegment>;
  /** The decoded weight it counts for; 0 until it has landed. */
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

/** Each collection type's decode and weigher, built once. */
const decoders = new WeakMap<EastTypeValue, { open: (bytes: Uint8Array) => { segment(i: number): unknown }; weigh: (value: unknown) => number }>();

function decoderFor(typeValue: EastTypeValue): { open: (bytes: Uint8Array) => { segment(i: number): unknown }; weigh: (value: unknown) => number } {
  let decoder = decoders.get(typeValue);
  if (decoder === undefined) {
    decoder = { open: openBeast2PagesFor(typeValue, { frozen: true }), weigh: decodedWeightFor(typeValue) };
    decoders.set(typeValue, decoder);
  }
  return decoder;
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

/** Decodes segment `i` of a collection, read through its backend. */
async function decode(segments: DatasetSegments, i: number): Promise<{ segment: DecodedSegment; weight: number }> {
  const { open, weigh } = decoderFor(segments.typeValue);
  const bytes = await segments.segment(i);
  let value: unknown;
  try {
    value = open(bytes).segment(0);
  } catch (err) {
    // The store gave the bytes its name holds; that they do not decode as
    // this collection's segment is the segment's fault, never the store's.
    throw new SegmentCorruptError(err instanceof Error ? err.message : String(err));
  }
  decodes++;
  const kind = segments.typeValue.type;
  let keys: unknown[] = [];
  let values: unknown[] = [];
  let count: number;
  if (kind === 'Dict') {
    const map = value as ReadonlyMap<unknown, unknown>;
    keys = new Array<unknown>(map.size);
    values = new Array<unknown>(map.size);
    let at = 0;
    for (const [key, item] of map) {
      keys[at] = key;
      values[at] = item;
      at++;
    }
    count = map.size;
  } else if (kind === 'Set') {
    keys = [...(value as ReadonlySet<unknown>)];
    count = keys.length;
  } else {
    count = (value as readonly unknown[]).length;
  }
  // The arrays a search bisects cost a reference an element beside the value.
  const weight = weigh(value) + 8 * (keys.length + values.length);
  return { segment: { value, keys, values, count }, weight };
}

/**
 * Segment `i` of a collection, decoded: from the kept segments, or read and
 * decoded once and kept.
 *
 * @param storage - The backend the collection is read through
 * @param repo - The repository it is in
 * @param segments - The opened collection
 * @param i - The segment's index
 * @returns The decoded segment
 * @throws {SegmentCorruptError} When the segment does not hold what its manifest
 *   says of it: another element count, a first key that is not its fence, or
 *   a last key at or past the next segment's fence
 */
export async function decodedSegment(
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
 * The segments of a collection a request touches, decoded: each read once,
 * {@link SEGMENT_READ_CONCURRENCY} at a time, through the kept segments.
 *
 * @param storage - The backend the collection is read through
 * @param repo - The repository it is in
 * @param segments - The opened collection
 * @param indices - The segments, in any order, repeats and all
 * @returns Each segment's decode, by its index
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
 * Checks a decoded segment against its manifest: its element count, and, for
 * a Set or a Dict, that its first key is its fence and its last key falls
 * before the next segment's fence — the checks a pager's window makes across
 * the segments it reads, made for each segment a route reads.
 *
 * @param segments - The opened collection
 * @param i - The segment's index
 * @param segment - Its decode
 * @throws {SegmentCorruptError} When it does not hold what the manifest says
 */
async function checkSegmentOrder(segments: DatasetSegments, i: number, segment: DecodedSegment): Promise<void> {
  if (segment.count !== segments.counts[i]) {
    throw new SegmentCorruptError(`beast2 v5: segment ${i} holds ${segment.count} elements, and its manifest says ${segments.counts[i]}`);
  }
  const keyType = segmentKeyTypeOf(segments.typeValue);
  if (keyType === null || segment.keys.length === 0) return;
  const cmp = comparators(keyType);
  const noun = segments.typeValue.type === 'Dict' ? 'key' : 'element';
  if (cmp(segment.keys[0], await segments.fence(i)) !== 0) {
    throw new SegmentCorruptError(`beast2 v5: segment ${i}'s first ${noun} is not its fence — the wire must hold the canonical value (corrupt or pre-contract blob)`);
  }
  if (i + 1 < segments.segmentCount && cmp(segment.keys[segment.keys.length - 1], await segments.fence(i + 1)) >= 0) {
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
 * The first index whose element satisfies a predicate that is false, then
 * true, over the elements in order: a binary search.
 *
 * @param items - The elements, in order
 * @param pred - The monotone predicate
 * @returns The first index it holds at, or `items.length` when it holds at none
 */
export function firstWhere(items: readonly unknown[], pred: (item: unknown) => boolean): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(items[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * What the kept segments have done, and what they hold now.
 *
 * @returns The decodes made, the reads the kept segments served, the segments
 *   kept, their decoded weight and the budget
 */
export function decodedSegmentStats(): { decodes: number; hits: number; segments: number; weight: number; budget: number } {
  return { decodes, hits, segments: kept.size, weight: keptWeight, budget: DECODED_SEGMENTS_MAX_WEIGHT };
}
