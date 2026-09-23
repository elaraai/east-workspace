/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ONE encoder that decides how a dataset value is stored.
 *
 * Collection-rooted values (Array / Set / Dict) are ALWAYS stored segmented
 * with a trailing index, at every size: one uniform encoding per logical value,
 * so the paged read API can decode just the segments a window touches and the
 * key search can bisect the segment fences. Every other root is stored whole.
 *
 * Given a `sink` — an object store to write through — a collection goes in as
 * **segment objects plus a {@link CollectionManifestType} naming them**, and it
 * is the manifest the dataset ref points at. That is what makes a one-row edit
 * cost one segment: the new manifest names the same objects as the old one bar
 * the segment that changed, and a content-addressed store deduplicates the
 * rest. Without a sink the value is one blob, as it has always been.
 *
 * This lives in `e3-types` — the floor both `e3` and `e3-core` stand on —
 * because the rule has to hold at EVERY door a value enters the store through,
 * and it did not. The store path (`e3-core`'s `datasetWrite`) segmented; the
 * package export path (`e3`'s `export_`) encoded flat regardless of root kind.
 * Since `workspaceDeploy` copies package refs verbatim, a freshly deployed
 * collection input pointed at an unindexed blob and could not be paged at all
 * — `dataset_not_indexed`, with no whole-decode fallback — until something
 * happened to WRITE the dataset, at which point it silently started working.
 * A demo poked by hand behaved differently from a workspace only deployed.
 *
 * So: one branch, one home, and both doors call it.
 *
 * @packageDocumentation
 */

import {
  carveBeast2,
  decodeBeast2For,
  encodeBeast2For,
  encodeBeast2FenceFor,
  encodeBeast2PagedFor,
  isContentCut,
  isVariant,
  openBeast2PagesFor,
  readBeast2Extents,
  readBeast2SegmentLogicalBytes,
  segmentKeyTypeOf,
  segmentRuleFor,
  toEastTypeValue,
  type EastType,
  type EastTypeValue,
} from '@elaraai/east';
import {
  COLLECTION_MANIFEST_KIND,
  encodeCollectionManifest,
  type CollectionManifest,
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
    return encodeBeast2For(typeValue)(value);
  }
  const blob = encodeBeast2PagedFor(typeValue)(value);
  return sink === undefined ? blob : cutDatasetBlob(blob, sink);
}

/**
 * Take an existing segmented collection blob into the store as segment objects
 * plus a manifest.
 *
 * @remarks
 * The other half of the door: a runner writes ONE blob to its output file, and
 * this is what turns it into the layout. A blob whose segmentation already
 * satisfies the boundary rule — which every runtime's encoder produces — is
 * carved by **byte copy**, so adopting a task output costs no decode and
 * unchanged segments deduplicate against the previous run's by hash. A blob cut
 * some other way (a positional batcher, a writer predating the rule) is decoded
 * and re-encoded once, because a value that is not cut canonically would
 * otherwise give two equal values two different manifests.
 *
 * An Array's cut hashes whole elements, which no fence carries, so it cannot
 * be checked without a decode and is adopted as it stands; every runtime's
 * writer cuts an Array by the rule too.
 *
 * @param blob - a segmented, indexed v5 collection blob
 * @param sink - writes one object and returns its hash
 * @returns the manifest's bytes
 * @throws {Error} When the blob is not a segmented, indexed, self-contained v5
 *   collection — the form every writer of a collection dataset produces.
 */
export async function cutDatasetBlob(blob: Uint8Array, sink: SegmentSink): Promise<Uint8Array> {
  let extents = readBeast2Extents(blob);
  if (!extents.selfContained) {
    throw new Error('collection manifest: blob has cross-segment aliasing — segments must decode independently');
  }
  const typeValue = extents.typeValue;
  const keyType = segmentKeyTypeOf(typeValue);
  const fence = keyType === null ? null : encodeBeast2FenceFor(keyType);
  let source = blob;
  // An Array root has no key, so its fences are empty and there is nothing to
  // check them against: its segmentation is adopted as it is.
  let fences: Uint8Array[] = [];

  if (fence !== null) {
    const pages = openBeast2PagesFor(typeValue)(source);
    fences = Array.from({ length: pages.segmentCount }, (_, i) => fence(pages.fence(i)));
    if (!isContentCut(fences, [...pages.counts], readBeast2SegmentLogicalBytes(source, extents))) {
      // Not cut by the rule: the only way to reach the canonical segmentation
      // is to lay the value out again. Costs one decode + one encode, once,
      // and every later write of an equal value is a byte-copy carve.
      source = encodeBeast2PagedFor(typeValue)(decodeBeast2For(typeValue)(source));
      extents = readBeast2Extents(source);
      const recut = openBeast2PagesFor(typeValue)(source);
      fences = Array.from({ length: recut.segmentCount }, (_, i) => fence(recut.fence(i)));
    }
  }

  const header = await sink(source.subarray(0, extents.prefixEnd));
  const entries: CollectionManifestEntry[] = [];
  for (let i = 0; i < extents.offsets.length; i++) {
    const segment = carveBeast2(source, i, i + 1, extents);
    entries.push({
      hash: await sink(segment),
      fence: fences[i] ?? new Uint8Array(0),
      count: BigInt(extents.counts[i]!),
      bytes: BigInt(segment.byteLength),
    });
  }

  const manifest: CollectionManifest = {
    kind: COLLECTION_MANIFEST_KIND,
    level: 0n,
    type: typeValue,
    rule: segmentRuleFor(typeValue),
    header,
    entries,
  };
  return encodeCollectionManifest(manifest);
}
