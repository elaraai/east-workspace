/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The segment manifest: a collection held as N standalone segment blobs plus
 * a small object naming them in order.
 *
 * A v5 collection blob is already `header · tag · segment frames · terminator ·
 * index · footer`, and each segment frame is a self-contained piece of the
 * canonical value. A manifest takes the last step and lets each segment be its
 * own blob, so a store can address them individually: equal values then name
 * equal segments, a one-row edit re-cuts one of them, and two values diff by
 * comparing hashes rather than by decoding anything.
 *
 * This type lives here, beside the container it describes, because **every
 * runtime must read it**. A task input staged as a manifest is one file naming
 * sibling segment files, and a body that iterates it, or reads one key from it,
 * pays for the segments it touches rather than for a splice of the whole value
 * — which is the difference between a 2 GB input costing 2 GB and costing the
 * rows it reads. {@link Beast2ManifestSource} is what a reader hands
 * {@link Beast2Pages} to get that.
 *
 * Nothing about the manifest changes what a segment is, so any reader in any
 * runtime still opens a segment blob on its own, and splicing the segments
 * back under their shared header reproduces the single-blob form exactly.
 */

import {
  ArrayType,
  BlobType,
  IntegerType,
  StringType,
  StructType,
  type ValueTypeOf,
} from "../../../types.js";
import { EastTypeType, canonicalTypeValue, toEastTypeValue, type EastTypeValue } from "../../../type_of_type.js";
import { readTypeSection } from "./type-section.js";
import { BufferReader } from "../../binary-utils.js";
import { MAGIC_BYTES_V5, encodeBeast2V5For, decodeBeast2V5For } from "./codec.js";
import { isBeast2SyncRangeReader, readExact, type Beast2SyncRangeReader } from "./range.js";

/** The `kind` tag every segment manifest carries — what tells a reader that an
 *  object naming other objects describes a collection, and the handle a
 *  garbage collector recognizes it by. */
export const COLLECTION_MANIFEST_KIND = "$segments";

/** One entry of a {@link CollectionManifestType}: a segment blob at level 0, a
 *  child manifest above it. */
export const CollectionManifestEntryType = StructType({
  /** The segment (or child manifest) object's content hash. */
  hash: StringType,
  /** The entry's first key, in the canonical bare encoding
   *  `encodeBeast2FenceFor` produces; empty for an Array root, which has no
   *  key order to bisect. */
  fence: BlobType,
  /** Elements (pairs, for a Dict root) in the segment or subtree. */
  count: IntegerType,
  /** The object's size in bytes, so a reader budgets without a stat. */
  bytes: IntegerType,
});
export type CollectionManifestEntryType = typeof CollectionManifestEntryType;
export type CollectionManifestEntry = ValueTypeOf<typeof CollectionManifestEntryType>;

/**
 * A collection's manifest: the value an object holds in place of the blob when
 * the collection is stored as segment objects.
 *
 * @remarks
 * `level` and the nesting it allows are carried from the first version on
 * purpose. Struct encoding is positional, so a field appended later is another
 * dual-decode tier on every reader in three runtimes — and a second index
 * level is exactly what a manifest too large to hold whole would need. The
 * byte is paid now.
 */
export const CollectionManifestType = StructType({
  /** Always {@link COLLECTION_MANIFEST_KIND}. */
  kind: StringType,
  /** `0` when entries name segment blobs; `n` when they name level `n - 1`
   *  manifests. */
  level: IntegerType,
  /** The root collection type — the manifest is self-describing about what it
   *  holds, exactly as a blob's type section is. */
  type: EastTypeType,
  /** The boundary-rule id the segments were cut under (`segmentRuleFor`), so a
   *  reader knows whether they are cut the way this build cuts. */
  rule: StringType,
  /** Hash of the canonical header bytes every segment is written under — what
   *  makes the segments spliceable into one blob. */
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
 * Matched on the **exact** field set. Arbitrary user values flow through the
 * same dispatch — a record's state is any struct the author chose — and a
 * name-subset match would classify one as a manifest and read its fields as
 * object hashes. The `kind` field is checked separately, after a decode, by
 * {@link isCollectionManifest}.
 *
 * @param typeValue - the object's decoded root type
 * @returns whether the type is exactly the manifest struct
 */
export function isCollectionManifestType(typeValue: EastTypeValue): boolean {
  if (typeValue.type !== "Struct") return false;
  const fields = typeValue.value as { name: string }[];
  return fields.length === MANIFEST_FIELDS.length
    && fields.every((f, i) => f.name === MANIFEST_FIELDS[i]);
}

/**
 * Whether a decoded value is a segment manifest — its type is the manifest
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

/** The manifest's codec, built on first use.
 *
 *  Built lazily rather than at module scope because building an encoder writes
 *  a type section, and this module sits inside the beast2 import cycle — an
 *  eager build runs while a module it reaches through that cycle is still
 *  initializing, and dies on a binding that does not exist yet. Nothing else
 *  about it is lazy: the codec is built once and kept. */
let manifestCodec: {
  encode: (manifest: CollectionManifest) => Uint8Array;
  decode: (data: Uint8Array) => CollectionManifest;
} | null = null;

function codec(): NonNullable<typeof manifestCodec> {
  manifestCodec ??= {
    encode: encodeBeast2V5For(CollectionManifestType) as (manifest: CollectionManifest) => Uint8Array,
    decode: decodeBeast2V5For(CollectionManifestType) as (data: Uint8Array) => CollectionManifest,
  };
  return manifestCodec;
}

/**
 * Encodes a segment manifest.
 *
 * @param manifest - the manifest
 * @returns the beast2 bytes
 *
 * @remarks
 * The collection type is written with its recursive types renamed
 * canonically ({@link canonicalTypeValue}): the ids a runtime gives them are
 * its own, and a manifest's hash names the collection in a store, so one
 * collection must have one manifest whichever runtime writes it.
 */
export function encodeCollectionManifest(manifest: CollectionManifest): Uint8Array {
  return codec().encode({ ...manifest, type: canonicalTypeValue(manifest.type) });
}

/**
 * Decodes a segment manifest.
 *
 * @param data - the stored bytes
 * @returns the manifest
 * @throws {Error} When the bytes are not a manifest, or its `kind` is not
 *   {@link COLLECTION_MANIFEST_KIND} — a struct of the right shape carrying
 *   another tag is a different object that must not be read as segments.
 */
export function decodeCollectionManifest(data: Uint8Array): CollectionManifest {
  const manifest = codec().decode(data);
  if (manifest.kind !== COLLECTION_MANIFEST_KIND) {
    throw new Error(`beast2 v5: unknown manifest kind '${manifest.kind}' (expected '${COLLECTION_MANIFEST_KIND}')`);
  }
  return manifest;
}

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
 * The total byte size of the segment objects a manifest names.
 *
 * @param manifest - the manifest
 * @returns the sum of its entries' byte sizes
 */
export function manifestByteSize(manifest: CollectionManifest): number {
  let total = 0;
  for (const entry of manifest.entries) total += Number(entry.bytes);
  return total;
}

/** The head read {@link readBeast2Manifest} probes with — a manifest's own
 *  type section is a few hundred bytes, and so is every plausible blob's. */
const MANIFEST_PROBE_BYTES = 64 * 1024;

/**
 * The manifest a blob holds, or `null` when it holds something else.
 *
 * @remarks
 * Costs one head read through a ranged source: a blob declares its root type up
 * front, and a manifest is recognized by that type's exact field set, so
 * nothing more is read for a blob that turns out to be a value.
 *
 * @param source - the blob, or ranged access to it
 * @returns the decoded manifest, or `null`
 */
export function readBeast2Manifest(source: Uint8Array | Beast2SyncRangeReader): CollectionManifest | null {
  const reader = isBeast2SyncRangeReader(source) ? source : null;
  const size = reader === null ? (source as Uint8Array).length : reader.size;
  const head = reader === null
    ? (source as Uint8Array)
    : readExact(reader, 0, Math.min(size, MANIFEST_PROBE_BYTES));
  if (head.length < MAGIC_BYTES_V5.length) return null;
  for (let i = 0; i < MAGIC_BYTES_V5.length; i++) {
    if (head[i] !== MAGIC_BYTES_V5[i]) return null;
  }
  let typeValue: EastTypeValue;
  try {
    typeValue = readTypeSection(new BufferReader(head, MAGIC_BYTES_V5.length)).rootType;
  } catch {
    return null;
  }
  if (!isCollectionManifestType(typeValue)) return null;
  const data = reader === null ? head : readExact(reader, 0, size);
  const manifest = codec().decode(data);
  return manifest.kind === COLLECTION_MANIFEST_KIND ? manifest : null;
}

/**
 * A collection presented to a reader as its manifest plus access to each
 * segment — the form {@link Beast2Pages} opens when the segments are separate
 * blobs rather than runs of one.
 *
 * @remarks
 * The reader never asks for a segment it does not decode, and never asks for a
 * fence at all: a manifest carries every fence already, so a keyed read is one
 * bisect over decoded keys and one segment. That is what makes a keyed read of
 * a 1.5-million-entry input cost one segment on every runtime.
 *
 * @example
 * ```ts
 * const source: Beast2ManifestSource = {
 *   manifest,
 *   segment: (i) => readFileSync(`${path}.segments/${manifest.entries[i].hash}.beast2`),
 * };
 * const rows = openBeast2LazyFor(manifest.type, { frozen: true })(source);
 * ```
 */
export interface Beast2ManifestSource {
  /** The manifest describing the collection. */
  readonly manifest: CollectionManifest;
  /**
   * Segment `i`'s standalone blob — its bytes, or ranged access to them.
   *
   * @param i - zero-based segment index
   * @returns the segment blob
   */
  segment(i: number): Uint8Array | Beast2SyncRangeReader;
}

/** Whether `source` is a {@link Beast2ManifestSource} rather than a blob or a
 *  range reader — judged by shape, since a value from another realm fails
 *  `instanceof`. */
export function isBeast2ManifestSource(source: unknown): source is Beast2ManifestSource {
  const s = source as { manifest?: unknown; segment?: unknown } | null;
  return s !== null && typeof s === "object" && typeof s.segment === "function"
    && typeof (s.manifest as CollectionManifest | undefined)?.kind === "string";
}
