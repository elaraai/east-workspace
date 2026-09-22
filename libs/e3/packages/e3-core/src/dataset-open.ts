/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The opener door: how every reader reaches a stored collection dataset.
 *
 * A collection is stored as a {@link CollectionManifestType} naming standalone
 * segment objects. Readers that used to address one blob through its trailing
 * index — the paged window, the key search, the partition planner, the status
 * geometry, the whole download — now go through {@link DatasetSegments}, which
 * presents both shapes as one: the segment count, the per-segment element
 * counts and fences, and segment `i` (or a run of segments) as a standalone v5
 * blob any existing reader opens.
 *
 * A manifest answers all of that from one small object read: the fences are
 * stored decoded-ready, so a key bisect probes no frames at all, and a page
 * reads exactly the segment objects its window touches. A bare segmented blob —
 * what a writer predating the layout left behind, and what a runner still hands
 * to its output file — answers the same questions through ranged reads of its
 * index and frames, so nothing on the read path has two code paths to keep in
 * step.
 *
 * @packageDocumentation
 */

import {
  beast2HasIndex,
  carveBeast2Ranged,
  decodeBeast2FenceFor,
  openBeast2PagesFor,
  readBeast2Extents,
  readBeast2ExtentsRanged,
  readBeast2Type,
  segmentKeyTypeOf,
  spliceBeast2Tail,
  type Beast2RangedExtents,
  type EastTypeValue,
} from '@elaraai/east';
import {
  COLLECTION_MANIFEST_KIND,
  cutDatasetBlob,
  decodeCollectionManifest,
  isCollectionManifestType,
  isCollectionRoot,
  manifestByteSize,
  type CollectionManifest,
} from '@elaraai/e3-types';
import type { StorageBackend } from './storage/interfaces.js';

/** The head read the manifest probe starts with — a manifest's own type
 *  section is a few hundred bytes, and every other object's fits far inside
 *  this too. */
const HEAD_PROBE_BYTES = 64 * 1024;

/** Bytes per chunk when a whole dataset is streamed out of the store. */
const SPLICE_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * A stored collection, addressed by segment.
 *
 * @remarks
 * Holds the geometry, never the data: the segments a caller does not ask for
 * are never read. Both backings — a manifest naming segment objects, and a
 * bare segmented blob through ranged reads — answer the same questions, so a
 * reader written against this is written once.
 */
export class DatasetSegments {
  /** The dataset's root collection type. */
  readonly typeValue: EastTypeValue;
  /** Element (pair) count of each segment, in segment order. */
  readonly counts: readonly number[];
  /** Prefix sums of {@link counts} — the global row each segment ends before. */
  readonly cumulative: readonly number[];
  /** Total elements (pairs) across every segment. */
  readonly elementCount: number;
  /** Stored bytes of the value: every segment object plus the manifest that
   *  names them, or the blob when it is not stored as one. */
  readonly bytes: number;
  /** The manifest, when this dataset is stored as one. */
  readonly manifest: CollectionManifest | null;

  private readonly backing: ManifestBacking | BlobBacking;
  private readonly fences = new Map<number, unknown>();

  private constructor(
    typeValue: EastTypeValue,
    counts: readonly number[],
    bytes: number,
    manifest: CollectionManifest | null,
    backing: ManifestBacking | BlobBacking,
  ) {
    this.typeValue = typeValue;
    this.counts = counts;
    this.bytes = bytes;
    this.manifest = manifest;
    this.backing = backing;
    const cumulative: number[] = new Array(counts.length);
    let running = 0;
    for (let i = 0; i < counts.length; i++) {
      running += counts[i]!;
      cumulative[i] = running;
    }
    this.cumulative = cumulative;
    this.elementCount = running;
  }

  /**
   * Opens a stored collection for segment-addressed reads.
   *
   * @param storage - Storage backend
   * @param repo - Repository identifier
   * @param hash - The dataset object's content hash (a manifest, or a blob)
   * @param size - The object's byte size, when the caller already has it
   * @returns The opened dataset
   * @throws {Error} When the object is neither a manifest nor a segmented,
   *   indexed, self-contained v5 collection blob.
   */
  static async open(storage: StorageBackend, repo: string, hash: string, size?: number): Promise<DatasetSegments> {
    const manifest = await readManifest(storage, repo, hash, size);
    if (manifest !== null) {
      const counts = manifest.entries.map((e) => Number(e.count));
      // What the dataset costs in the store: every segment object plus the
      // manifest naming them. A page reports this as the value's total, and a
      // status call reports the same number — the manifest object alone would
      // say a 10 MiB dataset is 12 KiB.
      const manifestBytes = size ?? (await storage.objects.stat(repo, hash)).size;
      return new DatasetSegments(
        manifest.type, counts, manifestByteSize(manifest) + manifestBytes, manifest,
        { kind: 'manifest', storage, repo, manifest },
      );
    }

    const objectSize = size ?? (await storage.objects.stat(repo, hash)).size;
    // A backend with no ranged reads serves the object whole, once, behind
    // the same interface — the executor and the handlers stay single-path.
    const whole = storage.objects.readRange ? null : await storage.objects.read(repo, hash);
    const backing: BlobBacking = { kind: 'blob', storage, repo, hash, whole, extents: null };
    const extents = await readBeast2ExtentsRanged({ size: objectSize, read: blobReader(backing) });
    if (!extents.selfContained) {
      throw new Error('beast2 v5: blob has cross-segment aliasing — segments must decode independently');
    }
    backing.extents = extents;
    return new DatasetSegments(extents.typeValue, [...extents.counts], objectSize, null, backing);
  }

  /** Number of segments. */
  get segmentCount(): number {
    return this.counts.length;
  }

  /** The canonical header bytes every segment is written under. */
  async head(): Promise<Uint8Array> {
    return this.backing.kind === 'manifest'
      ? this.backing.storage.objects.read(this.backing.repo, this.backing.manifest.header)
      : Promise.resolve(this.backing.extents!.head);
  }

  /**
   * Segment `i`'s first key (Dict) or element (Set).
   *
   * @remarks
   * Free from a manifest, which stores every fence; a bounded frame probe from
   * a bare blob, memoized so a bisect reads each probed frame once.
   *
   * @param i - zero-based segment index
   * @returns the decoded fence, or `undefined` for an Array root
   */
  async fence(i: number): Promise<unknown> {
    if (this.fences.has(i)) return this.fences.get(i);
    const keyType = segmentKeyTypeOf(this.typeValue);
    if (keyType === null) return undefined;
    const value = this.backing.kind === 'manifest'
      ? decodeBeast2FenceFor(keyType)(this.backing.manifest.entries[i]!.fence)
      : openBeast2PagesFor(this.typeValue)(await this.segment(i)).fence(0);
    this.fences.set(i, value);
    return value;
  }

  /**
   * Segment `i` as a standalone v5 blob.
   *
   * @param i - zero-based segment index
   * @returns the segment's bytes
   * @throws {Error} When `i` is out of range.
   */
  async segment(i: number): Promise<Uint8Array> {
    if (i < 0 || i >= this.counts.length) {
      throw new Error(`beast2 v5: segment ${i} out of range (${this.counts.length} segments)`);
    }
    return this.span(i, i + 1);
  }

  /**
   * Segments `[from, to)` as one standalone v5 blob — the window a page or a
   * partition slice decodes.
   *
   * @param from - zero-based index of the first segment
   * @param to - zero-based index after the last segment
   * @returns a standalone v5 blob holding exactly those segments
   * @throws {Error} When the segment range is invalid.
   */
  async span(from: number, to: number): Promise<Uint8Array> {
    const n = this.counts.length;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > n) {
      throw new Error(`beast2 v5: segment range [${from}, ${to}) invalid (${n} segments)`);
    }
    if (this.backing.kind === 'blob') {
      const extents = this.backing.extents!;
      const start = to > from ? extents.offsets[from]! : 0;
      const end = to > from ? segmentEnd(extents, to - 1) : 0;
      const frames = to > from ? await blobReader(this.backing)(start, end - start) : new Uint8Array(0);
      return carveBeast2Ranged(extents, frames, from, to);
    }
    // Segment objects are standalone blobs sharing one header, so a run of
    // them splices by concatenating their frame bytes under that header —
    // no value is decoded, and one segment is returned as it is stored.
    const { storage, repo, manifest } = this.backing;
    if (to - from === 1) return storage.objects.read(repo, manifest.entries[from]!.hash);
    const head = await this.head();
    const parts: Uint8Array[] = [];
    const segments: { offset: number; count: number }[] = [];
    let pos = head.length;
    for (let i = from; i < to; i++) {
      const bytes = await storage.objects.read(repo, manifest.entries[i]!.hash);
      const extents = readBeast2Extents(bytes);
      for (let s = 0; s < extents.offsets.length; s++) {
        segments.push({ offset: extents.offsets[s]! - extents.prefixEnd + pos, count: extents.counts[s]! });
      }
      const frames = bytes.subarray(extents.prefixEnd, extents.segmentsEnd);
      parts.push(frames);
      pos += frames.length;
    }
    const tail = spliceBeast2Tail(segments, pos);
    const out = new Uint8Array(pos + tail.length);
    out.set(head, 0);
    let at = head.length;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    out.set(tail, at);
    return out;
  }

  /**
   * The whole value as one blob, streamed chunk by chunk.
   *
   * @remarks
   * What a download, an export, or a runner without a manifest-aware opener
   * gets. Peak memory is one segment, never the value.
   *
   * @returns the spliced blob's bytes, in order
   */
  async *splice(): AsyncIterable<Uint8Array> {
    const head = await this.head();
    yield head;
    const segments: { offset: number; count: number }[] = [];
    let pos = head.length;
    if (this.backing.kind === 'blob') {
      const extents = this.backing.extents!;
      const read = blobReader(this.backing);
      for (let i = 0; i < extents.offsets.length; i++) {
        segments.push({ offset: extents.offsets[i]! - extents.prefixEnd + pos, count: extents.counts[i]! });
      }
      const start = extents.prefixEnd;
      const end = extents.segmentsEnd;
      for (let at = start; at < end; at += SPLICE_CHUNK_BYTES) {
        yield await read(at, Math.min(SPLICE_CHUNK_BYTES, end - at));
      }
      pos += end - start;
    } else {
      const { storage, repo, manifest } = this.backing;
      for (const entry of manifest.entries) {
        const bytes = await storage.objects.read(repo, entry.hash);
        const extents = readBeast2Extents(bytes);
        for (let s = 0; s < extents.offsets.length; s++) {
          segments.push({ offset: extents.offsets[s]! - extents.prefixEnd + pos, count: extents.counts[s]! });
        }
        const frames = bytes.subarray(extents.prefixEnd, extents.segmentsEnd);
        yield frames;
        pos += frames.length;
      }
    }
    yield spliceBeast2Tail(segments, pos);
  }

  /** Every object this dataset is made of — the manifest, its header and its
   *  segments — or just the blob, for one that is not stored as a manifest.
   *
   * @param hash - the dataset object's own hash
   * @returns the hashes an export or a transfer must carry
   */
  objectHashes(hash: string): string[] {
    if (this.backing.kind === 'blob') return [hash];
    const { manifest } = this.backing;
    return [hash, manifest.header, ...manifest.entries.map((e) => e.hash)];
  }
}

/** A manifest-backed dataset: the segments are objects in the store. */
interface ManifestBacking {
  kind: 'manifest';
  storage: StorageBackend;
  repo: string;
  manifest: CollectionManifest;
}

/** A blob-backed dataset: one object, addressed through ranged reads. */
interface BlobBacking {
  kind: 'blob';
  storage: StorageBackend;
  repo: string;
  hash: string;
  /** The object, for a backend that cannot serve ranges. */
  whole: Uint8Array | null;
  /** `null` only while the open is still reading the geometry. */
  extents: Beast2RangedExtents | null;
}

/** Ranged access to a blob-backed dataset's object.
 *
 *  The object store is resolved on every read rather than captured at open:
 *  an opened dataset is cached by content hash and outlives the call that
 *  opened it, and a captured method would keep reading through whatever the
 *  backend was wearing then. */
function blobReader(backing: BlobBacking): (offset: number, length: number) => Promise<Uint8Array> {
  return (offset, length) => {
    if (backing.whole !== null) {
      return Promise.resolve(backing.whole.subarray(offset, offset + length));
    }
    return backing.storage.objects.readRange!(backing.repo, backing.hash, offset, length);
  };
}

/** The end offset of segment `i`'s frame. */
function segmentEnd(extents: Beast2RangedExtents, i: number): number {
  return i + 1 < extents.offsets.length ? extents.offsets[i + 1]! : extents.segmentsEnd;
}

/**
 * The manifest an object holds, or `null` when it is not one.
 *
 * @remarks
 * Costs one head read: an object's root type is in its type section, and a
 * manifest is recognized by that type's exact field set. Nothing else is read
 * for an object that turns out to be a plain value.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - the object's content hash
 * @param size - the object's byte size, when the caller already has it
 * @returns the decoded manifest, or `null`
 */
export async function readManifest(
  storage: StorageBackend,
  repo: string,
  hash: string,
  size?: number,
): Promise<CollectionManifest | null> {
  const readRange = storage.objects.readRange?.bind(storage.objects);
  let head: Uint8Array;
  if (readRange) {
    const length = size === undefined ? HEAD_PROBE_BYTES : Math.min(size, HEAD_PROBE_BYTES);
    head = await readRange(repo, hash, 0, length);
  } else {
    head = await storage.objects.read(repo, hash);
  }
  let typeValue: EastTypeValue;
  try {
    typeValue = readBeast2Type(head);
  } catch {
    // A type section wider than the probe is not a manifest's: manifests carry
    // one small struct type, and every other object is a leaf here.
    return null;
  }
  if (!isCollectionManifestType(typeValue)) return null;
  const data = head.length >= (size ?? Infinity) ? head : await storage.objects.read(repo, hash);
  const manifest = decodeCollectionManifest(data);
  return manifest.kind === COLLECTION_MANIFEST_KIND ? manifest : null;
}

/**
 * Take a segmented collection blob into the store as segment objects plus a
 * manifest, and return the manifest's hash — the dataset's content address.
 *
 * @remarks
 * The storage-bound half of `cutDatasetBlob`: the pure carve lives in
 * `e3-types` beside the encoder door, because `e3-types` is the floor both
 * writers stand on and cannot see a `StorageBackend`.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param blob - a segmented, indexed v5 collection blob
 * @returns the manifest object's hash
 * @throws {Error} When the blob is not a segmented, indexed, self-contained v5
 *   collection.
 */
export async function cutDatasetIntoStore(storage: StorageBackend, repo: string, blob: Uint8Array): Promise<string> {
  const manifest = await cutDatasetBlob(blob, (bytes) => storage.objects.write(repo, bytes));
  return storage.objects.write(repo, manifest);
}

/**
 * Take a beast2 blob a program produced into the store, in the layout its root
 * type calls for.
 *
 * @remarks
 * The door for bytes that were encoded somewhere else — a mutation reducer's
 * output, a migrated state. A segmented collection is cut into segment objects
 * and a manifest, so the next write of a value that differs by one row shares
 * every other segment; anything else is stored as it is. A collection blob
 * with no index is stored whole rather than refused here, because the reader
 * that needs the index is the one that should say so, naming the dataset.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param bytes - the blob to store
 * @returns the dataset object's hash — the manifest, for a cut collection
 */
export async function adoptDatasetBlob(storage: StorageBackend, repo: string, bytes: Uint8Array): Promise<string> {
  let typeValue: EastTypeValue;
  try {
    typeValue = readBeast2Type(bytes);
  } catch {
    return storage.objects.write(repo, bytes);
  }
  if (!isCollectionRoot(typeValue) || !beast2HasIndex(bytes)) {
    return storage.objects.write(repo, bytes);
  }
  return cutDatasetIntoStore(storage, repo, bytes);
}

/**
 * The whole value of a stored dataset as one blob.
 *
 * @remarks
 * The materialisation a download or a runner without a manifest-aware opener
 * needs. A dataset that is not a manifest is returned as it is stored, with no
 * copy.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - the dataset object's content hash
 * @returns the value's beast2 bytes
 */
export async function readDatasetWhole(storage: StorageBackend, repo: string, hash: string): Promise<Uint8Array> {
  const manifest = await readManifest(storage, repo, hash);
  if (manifest === null) return storage.objects.read(repo, hash);
  const segments = await DatasetSegments.open(storage, repo, hash);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of segments.splice()) {
    chunks.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
