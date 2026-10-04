/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ONE encoder that decides how a dataset value is stored.
 *
 * Collection-rooted values (Array / Set / Dict) are ALWAYS stored segmented
 * under the content-defined cut rule, at every size: one uniform encoding per
 * logical value, so the paged read API can decode just the segments a window
 * touches and the key search can bisect the segment fences. Every other root is
 * stored whole.
 *
 * Given a `sink` — an object store to write through — a collection goes in as
 * **segment objects plus a {@link CollectionManifestType} naming them**, and it
 * is the manifest the dataset ref points at. That is what makes a one-row edit
 * cost one segment: the new manifest names the same objects as the old one bar
 * the segment that changed, and a content-addressed store deduplicates the
 * rest. Without a sink the value is one blob, which is what travels over the
 * wire.
 *
 * This lives in `e3-types` — the floor both `e3` and `e3-core` stand on —
 * because the rule has to hold at EVERY door a value enters the store through:
 * the store's own door (`e3-core`'s `storeCollection`) and the package export
 * both write collections through {@link writeCollectionManifest}.
 *
 * @packageDocumentation
 */

import {
  SortedMap,
  SortedSet,
  compareFor,
  encodeBeast2For,
  encodeBeast2PagedFor,
  isVariant,
  recutBeast2For,
  segmentRuleFor,
  toEastTypeValue,
  type Beast2RecutPiece,
  type Beast2SegmentRef,
  type EastType,
  type EastTypeValue,
} from '@elaraai/east';
import {
  COLLECTION_MANIFEST_KIND,
  encodeCollectionManifest,
  type CollectionManifestEntry,
} from './collection-manifest.js';

/**
 * Writes one object and answers with its content hash.
 *
 * @remarks
 * The whole of the object store this module needs. Content-addressed, so
 * writing bytes already stored is a no-op that returns the same hash — which is
 * exactly how a new state shares its unchanged segments with the old one.
 */
export type SegmentSink = (bytes: Uint8Array) => Promise<string>;

/**
 * How many objects {@link writeCollectionManifest} has a sink write at once,
 * unless its caller says otherwise: a store whose writes are round trips is
 * waited on once for this many segments, rather than once for each.
 */
export const SEGMENT_WRITES_IN_FLIGHT = 16;

/**
 * The writes of one manifest's objects: each started in the order it is
 * handed over, at most `width` in flight, and none left running once the
 * manifest's writer returns.
 *
 * @internal
 */
class SinkWrites {
  private readonly inFlight = new Set<Promise<void>>();
  private failure: { error: unknown } | undefined;

  constructor(private readonly sink: SegmentSink, private readonly width: number) {}

  /**
   * Starts writing `bytes` once fewer than `width` writes are in flight.
   *
   * @param bytes - The object
   * @param named - Told the object's hash once it is stored
   * @throws The first failed write's error, once one has failed: nothing more
   *   is started after it.
   */
  async start(bytes: Uint8Array, named: (hash: string) => void): Promise<void> {
    while (this.failure === undefined && this.inFlight.size >= this.width) await Promise.race(this.inFlight);
    if (this.failure !== undefined) throw this.failure.error;
    const write: Promise<void> = this.sink(bytes)
      .then(named, (error: unknown) => {
        this.failure ??= { error };
      })
      .finally(() => {
        this.inFlight.delete(write);
      });
    this.inFlight.add(write);
  }

  /** Waits for every write started, whatever its outcome. */
  async settled(): Promise<void> {
    await Promise.all(this.inFlight);
  }

  /**
   * Waits for every write started.
   *
   * @throws The first failed write's error.
   */
  async stored(): Promise<void> {
    await this.settled();
    if (this.failure !== undefined) throw this.failure.error;
  }
}

/**
 * Whether a dataset root type is a collection — the kinds stored segmented +
 * indexed so the paged read API can seek.
 *
 * @param typeValue - The dataset's root type
 * @returns true for Array / Set / Dict roots
 */
export function isCollectionRoot(typeValue: EastTypeValue): boolean {
  return typeValue.type === 'Array' || typeValue.type === 'Set' || typeValue.type === 'Dict';
}

/** The caller's type argument as an {@link EastTypeValue}. */
function asTypeValue(type: EastType | EastTypeValue): EastTypeValue {
  return isVariant(type) ? (type as EastTypeValue) : toEastTypeValue(type as EastType);
}

/**
 * A segment a collection's manifest may carry over as it stands: the segment
 * as a re-cut takes it, and the manifest entry that already names it in the
 * store, when it is there.
 */
export interface CollectionSegmentRef extends Beast2SegmentRef {
  /** The entry naming the segment in the manifest it came from. A carried
   *  segment with one is named by it again, never read or written; one
   *  without is read and written as it stands. */
  readonly entry?: CollectionManifestEntry;
}

/** A piece of a collection, in order, as {@link writeCollectionManifest}
 *  takes it: a run of segments the Writer wrote, under the canonical header
 *  for the type, or elements. */
export type CollectionPiece = Beast2RecutPiece<EastType, CollectionSegmentRef>;

/**
 * Write a collection as segment objects and return the manifest naming them.
 *
 * @remarks
 * The pieces are re-cut into the canonical whole (`recutBeast2For`): a segment
 * the whole shares with its piece is carried over, and everything else — the
 * seams between pieces, and pieces given as elements — is cut by the rule and
 * written. What comes out is what the Writer writes for the whole value,
 * whichever pieces it came in, so two equal values have one manifest.
 *
 * Every segment is written under the canonical header for the type, the
 * Writer's own: a piece's segments are carried over only when that is the
 * header they are under, which is the caller's to establish.
 *
 * The objects are written at once, `inFlight` at a time — the segments in
 * order, then the header — and the manifest is returned once every one is
 * stored, so the caller stores the manifest after the objects it names. The
 * sink is called in segment order, and each segment's blob is held until its
 * write ends.
 *
 * @param type - The collection type (Array / Set / Dict)
 * @param pieces - The collection's pieces, in order
 * @param sink - Writes one object and returns its hash
 * @param options - `inFlight`, the most objects the sink writes at once
 *   (default {@link SEGMENT_WRITES_IN_FLIGHT})
 * @returns The manifest's bytes — the caller stores them, and its hash is the
 *   dataset's content address
 * @throws {Error} When a piece's elements do not ascend (Set / Dict), a
 *   segment's blob is not the one segment its reference describes, or the sink
 *   rejects: once the writes in flight have ended, so none runs on after the
 *   writer returns.
 */
export async function writeCollectionManifest(
  type: EastType | EastTypeValue,
  pieces: Iterable<CollectionPiece> | AsyncIterable<CollectionPiece>,
  sink: SegmentSink,
  options: { inFlight?: number } = {},
): Promise<Uint8Array> {
  const typeValue = asTypeValue(type);
  const entries: CollectionManifestEntry[] = [];
  const writes = new SinkWrites(sink, options.inFlight ?? SEGMENT_WRITES_IN_FLIGHT);
  /** Writes a segment the manifest names at the place it takes now. */
  const write = (blob: Uint8Array, fence: Uint8Array, count: number): Promise<void> => {
    const at = entries.push({ hash: '', fence, count: BigInt(count), bytes: BigInt(blob.byteLength) }) - 1;
    return writes.start(blob, (hash) => {
      entries[at] = { ...entries[at]!, hash };
    });
  };
  // Frames deflate on the worker pool once the value is large enough to be
  // worth it; the pool holds the frames in flight and nothing more.
  const recut = recutBeast2For<EastType, CollectionSegmentRef>(typeValue, { parallel: true });
  let header = '';
  try {
    const stats = await recut(pieces, {
      written: (segment) => write(segment.blob, segment.fence, segment.count),
      carried: async (ref) => {
        if (ref.entry !== undefined) {
          entries.push(ref.entry);
          return;
        }
        await write(await ref.read(), ref.fence, ref.count);
      },
    });
    await writes.start(stats.header, (hash) => {
      header = hash;
    });
  } catch (error) {
    await writes.settled();
    throw error;
  }
  await writes.stored();
  return encodeCollectionManifest({
    kind: COLLECTION_MANIFEST_KIND,
    level: 0n,
    type: typeValue,
    rule: segmentRuleFor(typeValue),
    header,
    entries,
  });
}

/**
 * Encode a dataset value for the object store.
 *
 * @remarks
 * The single point where segmentation is decided. Callers must not choose an
 * encoder themselves: a value that reaches the store unsegmented is one the
 * paged endpoints refuse, and nothing on the read path can repair it.
 *
 * With a `sink`, a collection root is written as segment objects and the
 * returned bytes are the manifest naming them; a non-collection root ignores
 * the sink and returns its whole blob, which is what it has always been.
 * Without one, a collection is its canonical segmented blob — the form it
 * travels over the wire in.
 *
 * @param type - The dataset's declared type (an `EastType` or its homoiconic value)
 * @param value - The value to encode
 * @param sink - Writes one object and returns its hash
 * @returns The beast2 bytes to store — the manifest, for a collection written
 *   through a sink; otherwise the value's own blob
 */
export function encodeDatasetBlob(type: EastType | EastTypeValue, value: unknown): Uint8Array;
export function encodeDatasetBlob(type: EastType | EastTypeValue, value: unknown, sink: SegmentSink): Promise<Uint8Array>;
export function encodeDatasetBlob(
  type: EastType | EastTypeValue,
  value: unknown,
  sink?: SegmentSink,
): Uint8Array | Promise<Uint8Array> {
  const typeValue = asTypeValue(type);
  if (!isCollectionRoot(typeValue)) {
    const blob = encodeBeast2For(typeValue)(value);
    return sink === undefined ? blob : Promise.resolve(blob);
  }
  if (sink === undefined) return encodeBeast2PagedFor(typeValue)(value);
  return writeCollectionManifest(typeValue, [{ elements: canonicalElements(typeValue, value) }], sink);
}

/** A collection value's elements in canonical order: an Array's as they
 *  stand, a Set's or a Dict's ascending in East order — a plain `Set` or
 *  `Map` iterates in insertion order, and is sorted first. */
function canonicalElements(typeValue: EastTypeValue, value: unknown): Iterable<unknown> {
  if (typeValue.type === 'Array') return value as unknown[];
  if (typeValue.type === 'Set') {
    return value instanceof SortedSet ? value : [...(value as Set<unknown>)].sort(compareFor(typeValue.value as EastTypeValue));
  }
  const cmp = compareFor((typeValue.value as { key: EastTypeValue }).key);
  return value instanceof SortedMap
    ? (value as SortedMap<unknown, unknown>).entries()
    : [...(value as Map<unknown, unknown>).entries()].sort((a, b) => cmp(a[0], b[0]));
}
