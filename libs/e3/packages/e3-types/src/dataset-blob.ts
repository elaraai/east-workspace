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
 * @param type - The collection type (Array / Set / Dict)
 * @param pieces - The collection's pieces, in order
 * @param sink - Writes one object and returns its hash
 * @returns The manifest's bytes — the caller stores them, and its hash is the
 *   dataset's content address
 * @throws {Error} When a piece's elements do not ascend (Set / Dict), a
 *   segment's blob is not the one segment its reference describes, or the sink
 *   rejects.
 */
export async function writeCollectionManifest(
  type: EastType | EastTypeValue,
  pieces: Iterable<CollectionPiece> | AsyncIterable<CollectionPiece>,
  sink: SegmentSink,
): Promise<Uint8Array> {
  const typeValue = asTypeValue(type);
  const entries: CollectionManifestEntry[] = [];
  // Frames deflate on the worker pool once the value is large enough to be
  // worth it; the pool holds the frames in flight and nothing more.
  const recut = recutBeast2For<EastType, CollectionSegmentRef>(typeValue, { parallel: true });
  const stats = await recut(pieces, {
    written: async (segment) => {
      entries.push({
        hash: await sink(segment.blob),
        fence: segment.fence,
        count: BigInt(segment.count),
        bytes: BigInt(segment.blob.byteLength),
      });
    },
    carried: async (ref) => {
      if (ref.entry !== undefined) {
        entries.push(ref.entry);
        return;
      }
      const blob = await ref.read();
      entries.push({ hash: await sink(blob), fence: ref.fence, count: BigInt(ref.count), bytes: BigInt(blob.byteLength) });
    },
  });
  return encodeCollectionManifest({
    kind: COLLECTION_MANIFEST_KIND,
    level: 0n,
    type: typeValue,
    rule: segmentRuleFor(typeValue),
    header: await sink(stats.header),
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
