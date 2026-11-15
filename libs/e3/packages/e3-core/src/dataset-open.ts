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
 * A record's state names its rows and each of its indexes, and reading the
 * record reads its rows. An input that is an index of a record reads the
 * index's collection instead, which {@link inputObject} finds in the state:
 * the one place a task's or a call's index input becomes the object a runner
 * is handed.
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
  spliceBeast2Segments,
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
  type RecordState,
} from '@elaraai/e3-types';
import { readInOrder } from './concurrency.js';
import { hashMemo, memoKey } from './memo.js';
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
    // say a 10 MiB dataset is 12 KiB. A manifest the head read held whole is
    // its size already, so no store call asks it (#1573).
    const manifestBytes = (opened.hash === hash ? size : undefined) ?? opened.size ?? (await storage.objects.stat(repo, opened.hash)).size;
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
   * The whole value as one blob, streamed chunk by chunk
   * ({@link spliceBeast2Segments}, as a client downloading the segments
   * splices them).
   *
   * @remarks
   * What a download, an export, or a runner without a manifest-aware opener
   * gets. Peak memory is the segments read, never the value: by default one,
   * read only when the consumer asks for it, so a response streamed to a
   * client holds one segment at a time.
   *
   * @param options - `readAhead`, how many segments may be read at once ahead
   *   of the consumer: a remote store answers each read after a round trip,
   *   which a splice written to a file need not wait on one at a time
   * @returns the spliced blob's bytes, in order
   */
  async *splice(options: { readAhead?: number } = {}): AsyncIterable<Uint8Array> {
    const { storage, repo, manifest } = this;
    yield* spliceBeast2Segments(await this.head(), readInOrder(manifest.entries.length, options.readAhead ?? 1,
      (i) => storage.objects.read(repo, manifest.entries[i]!.hash)));
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

/** What one head read of an object found. */
interface ObjectHead {
  /** The bytes read: the object's first {@link HEAD_PROBE_BYTES}, or all of it. */
  readonly head: Uint8Array;
  /** Whether the head is the whole object, so nothing is read twice. */
  readonly whole: boolean;
  /** The object's root type, from its type section; `null` when that section
   *  is wider than the probe, which no manifest's or state's is: both carry one
   *  small struct type. */
  readonly type: EastTypeValue | null;
  /** The object's byte size, when it is known without asking the store: given,
   *  or read whole by the probe. */
  readonly size?: number;
}

/** Reads an object's head: its type section, and the whole of a small object. */
async function readHead(storage: StorageBackend, repo: string, hash: string, size?: number): Promise<ObjectHead> {
  const length = size === undefined ? HEAD_PROBE_BYTES : Math.min(size, HEAD_PROBE_BYTES);
  const head = await storage.objects.readRange(repo, hash, 0, length);
  // The head is the whole object when the object ended inside the probe
  const whole = head.length < HEAD_PROBE_BYTES || (size !== undefined && head.length >= size);
  const known = size ?? (whole ? head.length : undefined);
  let type: EastTypeValue | null;
  try {
    type = readBeast2Type(head);
  } catch {
    type = null;
  }
  return { head, whole, type, ...(known !== undefined && { size: known }) };
}

/** The record state an object is, from its head, or `null` when it is none. */
async function stateOf(storage: StorageBackend, repo: string, hash: string, probed: ObjectHead): Promise<RecordState | null> {
  if (probed.type === null || !isRecordStateType(probed.type)) return null;
  const state = decodeRecordState(probed.whole ? probed.head : await storage.objects.read(repo, hash));
  // A struct of this shape carrying another tag is a user value, not a state.
  return state.kind === RECORD_STATE_KIND ? state : null;
}

/**
 * The record state an object is, or `null` when it is none.
 *
 * @remarks
 * A record that declares an index stores a `$record` state naming its rows'
 * manifest and each index's; one that declares none stores its rows' manifest
 * as its state, which is no record state here. One head read tells them
 * apart, and reads a state — a small object — whole. The one place a state is
 * recognised: the opener ({@link openDatasetObject}), the index tables
 * ({@link recordIndexManifests}) and a record's reader (`readRecordState`)
 * all ask it here.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - A dataset object's hash: a record ref's `value.hash`
 * @returns The state, or `null` for an object that is no record state
 *
 * @example
 * ```ts
 * const state = await readRecordStateObject(storage, repo, ref.value.hash);
 * const rows = state === null ? ref.value.hash : state.primary;
 * ```
 */
export async function readRecordStateObject(storage: StorageBackend, repo: string, hash: string): Promise<RecordState | null> {
  return stateOf(storage, repo, hash, await readHead(storage, repo, hash));
}

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
 *   dataset that is not stored as one; and its byte size, when it is known
 *   without asking the store — given, or read whole by the probe
 */
export async function openDatasetObject(
  storage: StorageBackend,
  repo: string,
  hash: string,
  size?: number,
): Promise<{ hash: string; manifest: CollectionManifest | null; size?: number }> {
  const probed = await readHead(storage, repo, hash, size);
  const known = probed.size === undefined ? {} : { size: probed.size };
  // A record that declares an index is read as its rows
  const state = await stateOf(storage, repo, hash, probed);
  if (state !== null) return openDatasetObject(storage, repo, state.primary);
  // Every object but a manifest is a leaf here
  if (probed.type === null || !isCollectionManifestType(probed.type)) return { hash, manifest: null, ...known };
  const manifest = decodeCollectionManifest(probed.whole ? probed.head : await storage.objects.read(repo, hash));
  return { hash, manifest: manifest.kind === COLLECTION_MANIFEST_KIND ? manifest : null, ...known };
}

/** How many record states' index tables {@link recordIndexManifests} keeps. */
const INDEX_TABLES_KEPT = 1024;

/** The manifest of each index a record's state names, by repository and the
 *  state's hash; `null` for an object that is no record state. A status is
 *  computed over a workspace's records every second or so. */
const indexTables = hashMemo<ReadonlyMap<string, string> | null>(INDEX_TABLES_KEPT);

/**
 * The manifest of each index a record's state names, by the index's name.
 *
 * @remarks
 * A state is read once per repository and then from memory ({@link hashMemo}):
 * its hash fixes what it names. Costs one head read
 * ({@link readRecordStateObject}), as {@link openDatasetObject} does, and a
 * state is a small object that head holds whole.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - A dataset object's hash: a record ref's `value.hash`
 * @returns Each index's manifest hash by its name; `null` for an object that
 *   is no record state — a record that declares no index, whose state is its
 *   rows' manifest, or any other dataset
 */
export async function recordIndexManifests(storage: StorageBackend, repo: string, hash: string): Promise<ReadonlyMap<string, string> | null> {
  const key = memoKey(repo, hash);
  const known = indexTables.get(key);
  if (known !== undefined) return known;
  const state = await readRecordStateObject(storage, repo, hash);
  const manifests = state === null ? null : new Map([...state.indexes].map(([name, { manifest }]) => [name, manifest]));
  indexTables.set(key, manifests);
  return manifests;
}

/**
 * The object an input reads, given the hash its dataset holds: that hash, or,
 * for an index of a record, the manifest the record's state names for it.
 *
 * @remarks
 * A runner is handed an index as it is handed a record's rows: a collection's
 * manifest. This is where the index's is found, behind the storage interface
 * every backend implements, so no runner tells an index from any other
 * collection: a task's execution is keyed by the objects it reads, an index's
 * manifest among them, and a call's inputs are staged by them.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - The hash the input's dataset holds: for a record, its state's
 * @param index - The index of the record the input reads, by name; `null` for
 *   the dataset itself
 * @returns The object's hash; `null` when the dataset's state names no such
 *   index — it is no record's state with indexes, or was written before the
 *   index was built
 */
export async function inputObject(storage: StorageBackend, repo: string, hash: string, index: string | null): Promise<string | null> {
  if (index === null) return hash;
  return (await recordIndexManifests(storage, repo, hash))?.get(index) ?? null;
}

/**
 * Why a record's state holds no index an input reads, as a refusal says it.
 *
 * @param path - The record's keypath, as a status names it: `.records.jobs`
 * @param index - The index's name
 * @returns The words
 */
export function indexNotHeld(path: string, index: string): string {
  return `the record ${path} holds no index '${index}' at the state it stands at: ` +
    `deploy the package that declares the index again, which builds it`;
}

/**
 * What a task reads of one of its inputs, given the hash its dataset holds:
 * the object it is handed ({@link inputObject}), or why it waits — its
 * record's state holds no such index — in the words its status gives.
 *
 * @remarks
 * Each reader of a task's current inputs that names a waiting task decides
 * here, so the run leaves the task waiting where its status says it waits,
 * and the run goes on without it; the history and the bundle, which need no
 * reason, keep no execution over such inputs, and the current execution falls
 * back to the task's last run. Every door that writes a state — a deploy,
 * `$init`, a restore, a rollback — writes one holding every index its record
 * declares, so a state that holds none was written outside them.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param path - The input's keypath, as a status names it: `.records.jobs`
 * @param hash - The hash the input's dataset holds: for a record, its state's
 * @param index - The index of the record the input reads, by name; `null` for
 *   the dataset itself
 * @returns The object the task is handed, or why it waits for the input
 *
 * @example
 * ```ts
 * const read = await taskInputRead(storage, repo, '.records.jobs', state, 'jobs_by_press');
 * if ('waiting' in read) console.log(read.waiting); // Input '.records.jobs': the record .records.jobs holds no index …
 * ```
 */
export async function taskInputRead(
  storage: StorageBackend,
  repo: string,
  path: string,
  hash: string,
  index: string | null,
): Promise<{ readonly object: string } | { readonly waiting: string }> {
  const object = await inputObject(storage, repo, hash, index);
  return object === null ? { waiting: `Input '${path}': ${indexNotHeld(path, index!)}` } : { object };
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
