/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The segment-object layout: a collection dataset is a **manifest naming
 * standalone segment objects**, not one segmented blob.
 *
 * A v5 collection blob is already `header · tag · segment frames · terminator ·
 * index · footer`, and each segment frame is a self-contained piece of the
 * canonical value. This layout takes the last step and stores each segment as
 * its own content-addressed object, with a small manifest naming them in order.
 * Three properties follow, and every one of them is why records at millions of
 * entries are affordable:
 *
 * - **A one-row edit costs one segment.** The new state names the same objects
 *   as the old one bar the segment that changed, so a commit's new storage is
 *   the touched segments plus a manifest — not the whole value.
 * - **Two states diff in O(changed segments)**, by comparing entry hashes. No
 *   value is decoded to find out what moved.
 * - **A reader budgets before it reads.** The manifest carries every segment's
 *   fence, count and byte size, so bisecting to a key, sizing a page, or
 *   planning a partition needs the manifest alone.
 *
 * The manifest is the envelope the garbage collector recognizes, which is why
 * {@link COLLECTION_MANIFEST_KIND} is a stored field rather than something
 * inferred: an object whose entries name other objects MUST be traversable by
 * shape, or the first sweep deletes a record's segments.
 *
 * Segmentation is a pure function of the value ({@link CollectionManifest.rule}
 * names the boundary rule the segments were cut under), so equal values produce
 * equal manifests whatever edit history produced them.
 *
 * @packageDocumentation
 */

import {
  ArrayType,
  BlobType,
  EastTypeType,
  IntegerType,
  StringType,
  StructType,
  decodeBeast2For,
  encodeBeast2For,
  toEastTypeValue,
  type EastTypeValue,
  type ValueTypeOf,
} from '@elaraai/east';

/** The `kind` tag every collection manifest carries — the GC recognizer's
 *  handle, and what tells a reader that an object naming other objects is a
 *  collection rather than a user value that happens to hold strings. */
export const COLLECTION_MANIFEST_KIND = '$segments';

/** One entry of a {@link CollectionManifestType}: a segment object at level 0,
 *  a child manifest above it. */
export const CollectionManifestEntryType = StructType({
  /** The segment (or child manifest) object's content hash. */
  hash: StringType,
  /** The entry's first key, in the canonical bare encoding
   *  `encodeBeast2FenceFor` produces; empty for an Array root, which has no
   *  key order to bisect. */
  fence: BlobType,
  /** Elements (pairs, for a Dict root) in the segment or subtree. */
  count: IntegerType,
  /** The object's size in bytes, so a reader budgets a page without a stat. */
  bytes: IntegerType,
});
export type CollectionManifestEntryType = typeof CollectionManifestEntryType;
export type CollectionManifestEntry = ValueTypeOf<typeof CollectionManifestEntryType>;

/**
 * A collection dataset's manifest: the object a dataset ref's `value.hash`
 * names when the dataset's root is an Array, Set or Dict.
 *
 * @remarks
 * `level` and the nesting it allows are carried from the first version on
 * purpose. BEAST2 struct encoding is positional, so a field appended later is
 * another dual-decode tier on every reader in three runtimes — and a second
 * index level is exactly what a manifest too large to hold whole would need.
 * The byte is paid now.
 */
export const CollectionManifestType = StructType({
  /** Always {@link COLLECTION_MANIFEST_KIND}. */
  kind: StringType,
  /** `0` when entries name segment objects; `n` when they name level `n - 1`
   *  manifests. */
  level: IntegerType,
  /** The root collection type — the manifest is self-describing about what it
   *  holds, exactly as a blob's type section is. */
  type: EastTypeType,
  /** The boundary-rule id the segments were cut under (`segmentRuleFor`), so a
   *  reader knows whether a blob is already cut the way this build cuts. */
  rule: StringType,
  /** Hash of the canonical header bytes every segment object is written under
   *  — what makes the segments spliceable into one blob. */
  header: StringType,
  /** The segments, in canonical order. */
  entries: ArrayType(CollectionManifestEntryType),
});
export type CollectionManifestType = typeof CollectionManifestType;
export type CollectionManifest = ValueTypeOf<typeof CollectionManifestType>;

/** The manifest type's field names, in wire order — read from the type itself
 *  so the recognizer and the type cannot drift. */
const MANIFEST_FIELDS: readonly string[] =
  (toEastTypeValue(CollectionManifestType).value as { name: string }[]).map((f) => f.name);

/**
 * Whether a decoded object's root type is a {@link CollectionManifestType}.
 *
 * @remarks
 * Matched on the **exact** field set, as every other object recognizer here
 * is: a record's state is an arbitrary user struct flowing through the same
 * dispatch, and a name-subset match would classify one as a manifest and probe
 * its fields as object hashes. The `kind` field is checked separately, after a
 * decode, by {@link isCollectionManifest}.
 *
 * @param typeValue - the object's decoded root type
 * @returns whether the type is exactly the manifest struct
 */
export function isCollectionManifestType(typeValue: EastTypeValue): boolean {
  if (typeValue.type !== 'Struct') return false;
  const fields = typeValue.value as { name: string }[];
  return fields.length === MANIFEST_FIELDS.length
    && fields.every((f, i) => f.name === MANIFEST_FIELDS[i]);
}

/**
 * Whether a decoded value is a collection manifest — its type is the manifest
 * struct and its `kind` is {@link COLLECTION_MANIFEST_KIND}.
 *
 * @param typeValue - the object's decoded root type
 * @param value - the decoded value
 * @returns whether the object is a manifest
 */
export function isCollectionManifest(typeValue: EastTypeValue, value: unknown): boolean {
  return isCollectionManifestType(typeValue)
    && (value as CollectionManifest | null)?.kind === COLLECTION_MANIFEST_KIND;
}

/**
 * Encodes a collection manifest for the object store.
 *
 * @param manifest - the manifest
 * @returns the beast2 bytes to store
 */
export const encodeCollectionManifest: (manifest: CollectionManifest) => Uint8Array =
  encodeBeast2For(CollectionManifestType);

/**
 * Decodes a collection manifest from the object store.
 *
 * @param data - the stored bytes
 * @returns the manifest
 * @throws {Error} When the bytes are not a manifest, or its `kind` is not
 *   {@link COLLECTION_MANIFEST_KIND} — a struct of the right shape carrying
 *   another tag is a different object that must not be read as segments.
 */
export function decodeCollectionManifest(data: Uint8Array): CollectionManifest {
  const manifest = decodeManifestStruct(data);
  if (manifest.kind !== COLLECTION_MANIFEST_KIND) {
    throw new Error(`collection manifest: unknown kind '${manifest.kind}' (expected '${COLLECTION_MANIFEST_KIND}')`);
  }
  return manifest;
}

const decodeManifestStruct = decodeBeast2For(CollectionManifestType);

/**
 * The total element (pair) count a manifest describes.
 *
 * @param manifest - the manifest
 * @returns the sum of its entries' counts
 */
export function manifestElementCount(manifest: CollectionManifest): number {
  let total = 0;
  for (const entry of manifest.entries) total += Number(entry.count);
  return total;
}

/**
 * The total byte size of the segment objects a manifest names — the value's
 * stored size, the manifest's own bytes aside.
 *
 * @param manifest - the manifest
 * @returns the sum of its entries' byte sizes
 */
export function manifestByteSize(manifest: CollectionManifest): number {
  let total = 0;
  for (const entry of manifest.entries) total += Number(entry.bytes);
  return total;
}
