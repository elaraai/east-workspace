/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The opener door: how every reader reaches a stored collection dataset.
 *
 * A collection is stored as a {@link CollectionManifestType} naming standalone
 * segment objects. The paged window, the key search, the partition planner and
 * the whole download reach it through {@link DatasetSegments}: the segment
 * count, the per-segment element counts and fences, and segment `i` (or a run
 * of segments) as a standalone v5 blob any existing reader opens.
 *
 * A manifest answers all of that from one small object read: the fences are
 * stored decoded-ready, so a key bisect probes no frames at all, and a page
 * reads exactly the segment objects its window touches. A collection stored as
 * one blob is what an older e3 wrote, and is refused. Writing a collection is
 * the store's door's (`store-collection.ts`).
 *
 * @packageDocumentation
 */

import {
  decodeBeast2For,
  decodeBeast2ElementsFor,
  compareFor,
  decodeBeast2FenceFor,
  readBeast2Extents,
  readBeast2Type,
  segmentKeyTypeOf,
  spliceBeast2Tail,
  type EastTypeValue,
} from '@elaraai/east';
import {
  COLLECTION_MANIFEST_KIND,
  RECORD_STATE_KIND,
  RecordStateType,
  decodeCollectionManifest,
  isCollectionManifestType,
  isRecordStateType,
  manifestByteSize,
  type CollectionManifest,
} from '@elaraai/e3-types';
import type { StorageBackend } from './storage/interfaces.js';

/** The head read the manifest probe starts with — a manifest's own type
 *  section is a few hundred bytes, and every other object's fits far inside
 *  this too. */
const HEAD_PROBE_BYTES = 64 * 1024;

/**
 * A stored collection, addressed by segment.
 *
 * @remarks
 * Holds the manifest, never the data: the segments a caller does not ask for
 * are never read.
 */
export class DatasetSegments {
  /** The collection object this opened — the dataset's own hash, unless that
   *  named a record state, in which case its primary. */
  readonly hash: string;
  /** The dataset's root collection type. */
  readonly typeValue: EastTypeValue;
  /** Element (pair) count of each segment, in segment order. */
  readonly counts: readonly number[];
  /** Prefix sums of {@link counts} — the global row each segment ends before. */
  readonly cumulative: readonly number[];
  /** Total elements (pairs) across every segment. */
  readonly elementCount: number;
  /** Stored bytes of the value: every segment object plus the manifest that
   *  names them. The header object the manifest names is not counted — every
   *  segment carries those bytes already, and counting it would cost a stat
   *  per open. */
  readonly bytes: number;
  /** The manifest the dataset is stored as. */
  readonly manifest: CollectionManifest;

  private readonly fences = new Map<number, unknown>();

  private constructor(
    private readonly storage: StorageBackend,
    private readonly repo: string,
    hash: string,
    manifest: CollectionManifest,
    bytes: number,
  ) {
    const counts = manifest.entries.map((e) => Number(e.count));
    this.hash = hash;
    this.typeValue = manifest.type;
    this.counts = counts;
    this.bytes = bytes;
    this.manifest = manifest;
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
   * @param hash - The dataset object's content hash: a manifest, or a record
   *   state naming one
   * @param size - The object's byte size, when the caller already has it
   * @returns The opened dataset
   * @throws {Error} When the object is not a manifest: a collection stored as
   *   one blob, which an older e3 wrote.
   */
  static async open(storage: StorageBackend, repo: string, hash: string, size?: number): Promise<DatasetSegments> {
    const opened = await openDatasetObject(storage, repo, hash, size);
    if (opened.manifest === null) {
      throw new Error(`the collection ${opened.hash} is stored as one blob: ` +
        'an older e3 wrote this repository — re-create it: deploy again and import its data again');
    }
    // What the dataset costs in the store: every segment object plus the
    // manifest naming them. A page reports this as the value's total, and a
    // status call reports the same number — the manifest object alone would
    // say a 10 MiB dataset is 12 KiB.
    const manifestBytes = (opened.hash === hash ? size : undefined) ?? (await storage.objects.stat(repo, opened.hash)).size;
    return new DatasetSegments(storage, repo, opened.hash, opened.manifest, manifestByteSize(opened.manifest) + manifestBytes);
  }

  /** Number of segments. */
  get segmentCount(): number {
    return this.counts.length;
  }

  /** The canonical header bytes every segment is written under. */
  async head(): Promise<Uint8Array> {
    return this.storage.objects.read(this.repo, this.manifest.header);
  }

  /**
   * Segment `i`'s first key (Dict) or element (Set).
   *
   * @remarks
   * Read from the manifest, which stores every fence, and memoized so a bisect
   * decodes each fence it probes once.
   *
   * @param i - zero-based segment index
   * @returns the decoded fence, or `undefined` for an Array root
   */
  fence(i: number): Promise<unknown> {
    if (!this.fences.has(i)) {
      const keyType = segmentKeyTypeOf(this.typeValue);
      this.fences.set(i, keyType === null ? undefined : decodeBeast2FenceFor(keyType)(this.manifest.entries[i]!.fence));
    }
    return Promise.resolve(this.fences.get(i));
  }

  /**
   * Segment `i`'s last key (Dict) or element (Set).
   *
   * @remarks
   * The one bound a manifest does not store: a segment's keys end before the
   * next segment's fence, and the last segment has no next. Costs a read and a
   * decode of the segment.
   *
   * @param i - zero-based segment index
   * @returns the decoded key
   * @throws {Error} When the root is an Array, which has no key order, or `i`
   *   is out of range.
   */
  async lastKey(i: number): Promise<unknown> {
    if (segmentKeyTypeOf(this.typeValue) === null) {
      throw new Error('beast2 v5: a last key addresses Set and Dict roots; this holds Array');
    }
    let last: unknown;
    for await (const element of decodeBeast2ElementsFor(this.typeValue)([await this.segment(i)])) last = element;
    return this.typeValue.type === 'Dict' ? (last as [unknown, unknown])[0] : last;
  }

  /**
   * Segment `i`'s stored size in bytes: its object's, as the manifest names it.
   *
   * @param i - zero-based segment index
   * @returns the size
   * @throws {Error} When `i` is out of range.
   */
  segmentBytes(i: number): number {
    if (i < 0 || i >= this.counts.length) {
      throw new Error(`beast2 v5: segment ${i} out of range (${this.counts.length} segments)`);
    }
    return Number(this.manifest.entries[i]!.bytes);
  }

  /**
   * The segment a canonical-order scan from `key` starts in: the greatest
   * segment whose fence is at most `key`, or 0 when `key` precedes them all.
   *
   * @remarks
   * Segments are disjoint ascending ranges, so this is the only segment that
   * can hold `key` and the first that can hold anything at or above it. Over a
   * manifest the bisect reads nothing at all — every fence came with it — which
   * is what makes a keyed read of a million-entry record one segment read.
   *
   * @param key - the Dict key or Set element to seek to
   * @returns the zero-based segment index
   * @throws {Error} When the root is an Array, which has no key order.
   */
  async segmentFor(key: unknown): Promise<number> {
    const keyType = segmentKeyTypeOf(this.typeValue);
    if (keyType === null) {
      throw new Error('beast2 v5: a keyed seek addresses Set and Dict roots; this holds Array');
    }
    const n = this.counts.length;
    if (n === 0) return 0;
    const cmp = compareFor(keyType as never) as (a: unknown, b: unknown) => number;
    if (cmp(key, await this.fence(0)) < 0) return 0;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cmp(await this.fence(mid), key) <= 0) lo = mid;
      else hi = mid - 1;
    }
    return lo;
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
    // Segment objects are standalone blobs sharing one header, so a run of
    // them splices by concatenating their frame bytes under that header —
    // no value is decoded, and one segment is returned as it is stored.
    const { storage, repo, manifest } = this;
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
    for (const entry of this.manifest.entries) {
      const bytes = await this.storage.objects.read(this.repo, entry.hash);
      const extents = readBeast2Extents(bytes);
      for (let s = 0; s < extents.offsets.length; s++) {
        segments.push({ offset: extents.offsets[s]! - extents.prefixEnd + pos, count: extents.counts[s]! });
      }
      const frames = bytes.subarray(extents.prefixEnd, extents.segmentsEnd);
      yield frames;
      pos += frames.length;
    }
    yield spliceBeast2Tail(segments, pos);
  }
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
  return (await openDatasetObject(storage, repo, hash, size)).manifest;
}

const decodeRecordState = decodeBeast2For(RecordStateType);

/**
 * The collection object a dataset hash names, and its manifest when it has one.
 *
 * @remarks
 * One head read answers both questions an opener has, and the second is the
 * one every reader would otherwise have to ask itself: a record that declares a
 * secondary index stores a `$record` state naming the primary's manifest and
 * each index's, and **reading the record means reading the primary**. Resolving
 * that here is what keeps `e3 get`, a page, a key search, a task input and a
 * download on one path — an indexed record reads exactly like an unindexed one,
 * which is the whole claim indexes are additive on.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - the dataset object's content hash
 * @param size - the object's byte size, when the caller already has it
 * @returns the collection object's hash and its manifest, or `null` for a
 *   dataset that is not stored as one
 */
export async function openDatasetObject(
  storage: StorageBackend,
  repo: string,
  hash: string,
  size?: number,
): Promise<{ hash: string; manifest: CollectionManifest | null }> {
  const length = size === undefined ? HEAD_PROBE_BYTES : Math.min(size, HEAD_PROBE_BYTES);
  const head = await storage.objects.readRange(repo, hash, 0, length);
  // The head is the whole object when the object ended inside the probe —
  // then nothing is read twice.
  const whole = head.length < HEAD_PROBE_BYTES || (size !== undefined && head.length >= size);
  let typeValue: EastTypeValue;
  try {
    typeValue = readBeast2Type(head);
  } catch {
    // A type section wider than the probe is not a manifest's or a state's:
    // both carry one small struct type, and every other object is a leaf here.
    return { hash, manifest: null };
  }
  if (isRecordStateType(typeValue)) {
    const state = decodeRecordState(whole ? head : await storage.objects.read(repo, hash));
    // A struct of this shape carrying another tag is a user value, not a state.
    if (state.kind === RECORD_STATE_KIND) return openDatasetObject(storage, repo, state.primary);
    return { hash, manifest: null };
  }
  if (!isCollectionManifestType(typeValue)) return { hash, manifest: null };
  const manifest = decodeCollectionManifest(whole ? head : await storage.objects.read(repo, hash));
  return { hash, manifest: manifest.kind === COLLECTION_MANIFEST_KIND ? manifest : null };
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
  const opened = await openDatasetObject(storage, repo, hash);
  if (opened.manifest === null) return storage.objects.read(repo, opened.hash);
  const segments = await DatasetSegments.open(storage, repo, opened.hash);
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
