/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What every paged read of a dataset shares: the datasets opened for it, the
 * refusals it answers with, and the rows it reads — a span of a collection's
 * rows, the rows of a Dict by key — through the kept decoded segments
 * (`segments.ts`), each segment read once.
 *
 * @packageDocumentation
 */

import { SortedMap, SortedSet, isVariant, none, segmentKeyTypeOf, some, toEastTypeValue, type EastTypeValue, type option } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import {
  DatasetSegments, recordIndexNames, resolveRecordIndex, workspaceGetDatasetStatus, type ResolvedRecordIndex, type StorageBackend,
} from '@elaraai/e3-core/portable';
import type { KeySearchTarget } from './key-search.js';
import { backendIdOf, comparators, decodedSegments, SegmentCorruptError } from './segments.js';

/** Elements returned per page when the request names no limit. */
export const PAGE_DEFAULT_LIMIT = 1_000;

/** Hard cap on elements per page — and on the queries, keys or runs one batch
 *  read takes, and the entries it answers. */
export const PAGE_MAX_LIMIT = 10_000;

/** Default cap on a page's share of the source blob, in bytes. The
 *  effective limit shrinks so `limit × avgElementBytes` stays under the
 *  budget, bounding page payloads even for very wide rows. Deployments with
 *  tighter response limits (e.g. Lambda proxy's 6 MB, base64-inflated) pass
 *  a smaller budget through the route options. */
export const PAGE_BYTE_BUDGET_DEFAULT = 4 * 1024 * 1024;

/** Opened datasets cached per repository and content hash. Page requests are
 *  hash-pinned immutable, so entries never invalidate — the LRU only bounds
 *  memory. An entry holds the segment geometry (counts, prefix sums, and the
 *  fences its manifest carries), which is O(segments), so the cache is bounded
 *  by RETAINED BYTES rather than entry count: 64 entries of a 500k-segment
 *  dataset would otherwise pin hundreds of MB. */
interface CachedSegments {
  segments: DatasetSegments;
  /** Approximate retained bytes (the geometry arrays, and a manifest's fences). */
  bytes: number;
}

const SEGMENTS_CACHE_MAX_ENTRIES = 64;
/** Cap on the cache's total retained bytes. The newest entry always stays
 *  (serving the request needs it regardless), so one giant index can still
 *  be held — but never alongside others. */
const SEGMENTS_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const segmentsCache = new Map<string, CachedSegments>();
let segmentsCacheBytes = 0;

/** Evicts oldest entries until the count and byte budgets hold, always
 *  keeping at least the newest entry. */
function evictSegments(): void {
  while (
    segmentsCache.size > 1 &&
    (segmentsCache.size > SEGMENTS_CACHE_MAX_ENTRIES || segmentsCacheBytes > SEGMENTS_CACHE_MAX_BYTES)
  ) {
    const oldest = segmentsCache.keys().next().value!;
    segmentsCacheBytes -= segmentsCache.get(oldest)!.bytes;
    segmentsCache.delete(oldest);
  }
}

/** Opens (or reuses) a stored collection, LRU-cached per backend, repository
 *  and content hash, and bounded by retained bytes.
 *
 *  All three key parts are load-bearing. An opened dataset holds the backend
 *  it reads segment objects through, and a manifest names objects that exist
 *  in the repository it was read from and nowhere else — so two backends, or
 *  two repositories, that happen to hold the same bytes under the same name
 *  must not share an entry. `size` is the object's, when the caller knows it;
 *  the opener reads it on a miss otherwise. */
export async function cachedSegments(
  storage: StorageBackend,
  repoPath: string,
  hash: string,
  size?: number,
): Promise<DatasetSegments> {
  const key = `${backendIdOf(storage)}\u0000${repoPath}\u0000${hash}`;
  const cached = segmentsCache.get(key);
  if (cached) {
    segmentsCache.delete(key);
    segmentsCache.set(key, cached); // refresh recency
    return cached.segments;
  }
  const segments = await DatasetSegments.open(storage, repoPath, hash, size);
  // counts + prefix sums at 8 bytes each, plus the manifest's stored fences.
  let bytes = 16 * segments.segmentCount;
  for (const entry of segments.manifest.entries) bytes += entry.fence.byteLength + 80;
  segmentsCache.set(key, { segments, bytes });
  segmentsCacheBytes += bytes;
  evictSegments();
  return segments;
}

/**
 * Who may keep a hash-pinned answer, which never changes: `private`, the
 * caller's own cache alone (a browser's), or `public`, any cache between it
 * and the server as well (a CDN's). `private` unless a host says otherwise,
 * since an answer holds the rows of a workspace its caller was let read; a
 * host whose data any caller may read opts in to `public`.
 */
export type PinnedCache = 'private' | 'public';

/** The `Cache-Control` of a hash-pinned answer: kept for a year, never
 *  revalidated, by the caches {@link PinnedCache} lets keep it. */
export function pinnedCacheControl(cache: PinnedCache | undefined): string {
  return `${cache ?? 'private'}, max-age=31536000, immutable`;
}

/** The opener's refusal of a collection stored as one blob, which an older
 *  e3 wrote: answered as `dataset_not_indexed`, in the refusal's own words. */
export const BLOB_REFUSAL = /^the collection [0-9a-f]{64} is stored as one blob:/;

/** A refusal, answered as JSON: its type, its message and its status. */
export function pageError(type: string, message: string, status: 400 | 404 | 409 = 400, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

/**
 * A stored collection opened for a read, or the refusal of one stored as one
 * blob, which an older e3 wrote: `dataset_not_indexed`, in the opener's own
 * words. Any other failure is a real one, and raised as it is.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param hash - The collection's hash, or a record state naming its primary
 * @param size - The object's size, when the caller knows it
 * @returns The opened collection, or the refusal
 */
export async function openForRead(storage: StorageBackend, repoPath: string, hash: string, size?: number): Promise<DatasetSegments | Response> {
  try {
    return await cachedSegments(storage, repoPath, hash, size);
  } catch (err) {
    // Only the opener's refusal of a blob-stored collection means "not
    // indexed". Anything else (storage I/O, a missing or corrupt object) is
    // a real failure and must surface as one.
    const message = err instanceof Error ? err.message : String(err);
    if (!BLOB_REFUSAL.test(message)) throw err;
    return pageError('dataset_not_indexed', message);
  }
}

/** A dataset a paged read reads: its status, and the collection type it holds. */
export interface ReadDataset {
  /** The content hash it holds now. */
  hash: string;
  /** Its stored size, when the status knows it. */
  size: number | undefined;
  /** Its type. */
  typeValue: EastTypeValue;
}

/**
 * The dataset a paged read names, or the refusal its status calls for: no
 * path, a dataset with no value yet, or a pin to content it no longer holds,
 * refused with 409 naming the content it holds now.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param workspace - Workspace name
 * @param treePath - The dataset's path
 * @param hash - The content hash the read is pinned to, if any
 * @param what - How the refusal of an empty path names the read
 * @returns The dataset, or the refusal
 */
export async function readDataset(
  storage: StorageBackend, repoPath: string, workspace: string, treePath: TreePath, hash: string | undefined, what: string,
): Promise<ReadDataset | Response> {
  if (treePath.length === 0) {
    return pageError('bad_request', `Path required for ${what}`);
  }
  const status = await workspaceGetDatasetStatus(storage, repoPath, workspace, treePath);
  if (status.refType === 'unassigned') {
    return pageError('dataset_unassigned', 'Dataset is unassigned (pending task output)', 404);
  }
  if (status.refType === 'null' || !status.hash) {
    return pageError('dataset_null', 'Dataset is null', 404);
  }
  // A hash-pinned read must never answer with different bytes — refuse stale
  // pins (the client refetches status for the current hash) so a hash-keyed
  // URL is a pure function of the response and caches stay sound.
  if (hash !== undefined && hash !== status.hash) {
    return pageError('dataset_hash_mismatch',
      `Dataset content is ${status.hash}, not ${hash} — refetch status and retry`,
      409, { 'X-Content-SHA256': status.hash });
  }
  const typeValue: EastTypeValue = isVariant(status.datasetType)
    ? status.datasetType
    : toEastTypeValue(status.datasetType as never);
  return { hash: status.hash, size: status.size ?? undefined, typeValue };
}

/**
 * The segment holding row `row` of a collection: the first whose prefix sum
 * passes it.
 *
 * @param cumulative - The collection's prefix sums of its segments' counts
 * @param row - A row inside the collection
 * @returns The segment's index
 */
export function segmentOfRow(cumulative: readonly number[], row: number): number {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= row) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A span of a collection's rows, `[from, to)`. */
export interface RowSpan {
  from: number;
  to: number;
}

/**
 * The elements of a collection's rows in some spans, in order — an Array's
 * items, a Set's elements, a Dict's `[key, value]` pairs — every segment the
 * spans touch read once, several at a time, through the kept decoded
 * segments.
 *
 * @param storage - The backend the collection is read through
 * @param repo - The repository it is in
 * @param segments - The opened collection
 * @param spans - The rows, each span inside the collection
 * @returns The elements, span after span
 * @throws {SegmentCorruptError} When a segment does not hold what its manifest
 *   says of it
 */
export async function elementsOf(
  storage: StorageBackend, repo: string, segments: DatasetSegments, spans: readonly RowSpan[],
): Promise<unknown[]> {
  const { cumulative } = segments;
  const touched: number[] = [];
  for (const { from, to } of spans) {
    if (to <= from) continue;
    for (let s = segmentOfRow(cumulative, from), last = segmentOfRow(cumulative, to - 1); s <= last; s++) touched.push(s);
  }
  const decoded = await decodedSegments(storage, repo, segments, touched);
  const kind = segments.typeValue.type;
  const out: unknown[] = [];
  for (const { from, to } of spans) {
    let row = from;
    while (row < to) {
      const s = segmentOfRow(cumulative, row);
      const base = s === 0 ? 0 : cumulative[s - 1]!;
      const end = Math.min(to, cumulative[s]!);
      const segment = decoded.get(s)!;
      for (let i = row - base; i < end - base; i++) {
        if (kind === 'Dict') out.push([segment.keys[i], segment.values[i]]);
        else if (kind === 'Set') out.push(segment.keys[i]);
        else out.push((segment.value as readonly unknown[])[i]);
      }
      row = end;
    }
  }
  return out;
}

/**
 * A collection's elements as a value of the collection's own type: the items
 * as an array, the elements as a `SortedSet` or the pairs as a `SortedMap`,
 * under the key type's comparator.
 *
 * @param typeValue - The collection's type: an Array, a Set or a Dict
 * @param elements - Its elements, in canonical order
 * @returns The value
 */
export function collectionOf(typeValue: EastTypeValue, elements: readonly unknown[]): unknown {
  const keyType = segmentKeyTypeOf(typeValue);
  if (keyType === null) return [...elements];
  const cmp = comparators(keyType);
  if (typeValue.type === 'Set') return new SortedSet<unknown>(elements, cmp);
  return new SortedMap<unknown, unknown>(elements as [unknown, unknown][], cmp);
}

/**
 * The rows a Dict holds under some keys — each read from the segment its fence
 * places the key in, every such segment read once, several at a time, through
 * the kept decoded segments.
 *
 * @param storage - The backend the Dict is read through
 * @param repo - The repository it is in
 * @param segments - The opened Dict
 * @param keys - The keys, in any order
 * @returns Each key's row, or none, in the keys' order
 * @throws {SegmentCorruptError} When a segment does not hold what its manifest
 *   says of it
 */
export async function rowsByKey(
  storage: StorageBackend, repo: string, segments: DatasetSegments, keys: readonly unknown[],
): Promise<option<unknown>[]> {
  const owners = await Promise.all(keys.map((key) => segments.segmentFor(key)));
  const decoded = await decodedSegments(storage, repo, segments, owners);
  return keys.map((key, i) => {
    const row = (decoded.get(owners[i]!)!.value as ReadonlyMap<unknown, unknown>).get(key);
    return row === undefined ? none : some(row);
  });
}

/**
 * A corrupt segment, answered as the refusal of the read that met it: a window
 * or a search over a collection that is not canonical (`dataset_not_canonical`),
 * or one writer segment that does not decode alone (`dataset_not_segmented`).
 * Any other failure — a store's — is raised as it is.
 *
 * @param err - What a read threw
 * @param type - The refusal's type
 * @returns The refusal
 * @throws The failure, when it is not a segment's
 */
export function corruptRefusal(err: unknown, type: 'dataset_not_canonical' | 'dataset_not_segmented'): Response {
  if (err instanceof SegmentCorruptError) return pageError(type, err.message);
  throw err;
}

/**
 * One of a record's indexes, resolved at its state for a read, or the refusal
 * of a name the state does not hold, naming the indexes it does — or of a
 * joined read of a summary (#1039), whose entries stand for many rows and name
 * none.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param workspace - Workspace name
 * @param treePath - The record's path
 * @param stateHash - The record's state
 * @param name - The index
 * @param join - Whether the read fills each entry's row from the record
 * @returns The resolved index, or the 404 refusal, or the 400 refusal of a joined summary
 */
export async function indexOf(
  storage: StorageBackend, repoPath: string, workspace: string, treePath: TreePath, stateHash: string, name: string,
  join = false,
): Promise<ResolvedRecordIndex | Response> {
  const refPath = treePath.map((s) => s.value).join('/');
  const resolved = await resolveRecordIndex(storage, repoPath, workspace, refPath, stateHash, name);
  if (resolved !== null && join && resolved.summary) {
    return pageError('bad_request',
      `index '${name}' of '${refPath}' is a summary: each entry stands for every row of its key and names none to join — read it without join`);
  }
  if (resolved !== null) return resolved;
  const declared = await recordIndexNames(storage, repoPath, stateHash);
  return pageError('index_not_found',
    `Dataset '${refPath}' has no index '${name}'`
    + (declared.length > 0 ? ` — it has ${declared.join(', ')}` : ' — it declares none'), 404);
}

/** The collection a key search searches: the dataset's own, or an index's. */
export interface SearchTarget extends KeySearchTarget {
  /** The collection's object: the dataset's content, or the index's manifest. */
  hash: string;
  /** Its stored size, when the dataset's status knows it. */
  size: number | undefined;
}

/**
 * The collection a key search of a dataset searches, or the refusal of one it
 * cannot: an index the state does not hold, or a collection with no key order.
 *
 * @remarks
 * An index selector searches the index's own collection, whose rows the answer
 * is in — the same row space an index page serves — and its forms address the
 * index key, which the collection sorts by first.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param workspace - Workspace name
 * @param treePath - The dataset's path
 * @param dataset - The dataset, as its status reads
 * @param index - The index searched, if any
 * @returns The collection, or the refusal
 */
export async function searchTarget(
  storage: StorageBackend, repoPath: string, workspace: string, treePath: TreePath, dataset: ReadDataset, index: string | undefined,
): Promise<SearchTarget | Response> {
  let typeValue = dataset.typeValue;
  let hash = dataset.hash;
  let size = dataset.size;
  if (index !== undefined) {
    const resolved = await indexOf(storage, repoPath, workspace, treePath, dataset.hash, index);
    if (resolved instanceof Response) return resolved;
    typeValue = resolved.collectionType;
    hash = resolved.manifest;
    size = undefined;
  }
  const kind = typeValue.type;
  if (kind !== 'Set' && kind !== 'Dict') {
    return pageError('dataset_not_searchable', `Key search addresses Set or Dict datasets; this dataset holds ${kind}`);
  }
  const keyType: EastTypeValue = kind === 'Dict'
    ? (typeValue.value as { key: EastTypeValue; value: EastTypeValue }).key
    : typeValue.value as EastTypeValue;
  return {
    keyType,
    indexed: index !== undefined,
    keysNoun: index !== undefined ? `the keys of index '${index}'` : "this dataset's keys",
    hash,
    size,
  };
}

/**
 * Opens the collection a key search searches, or refuses one stored as one
 * blob, which an older e3 wrote.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param target - The collection
 * @returns The opened collection, or the refusal
 */
export async function openTarget(storage: StorageBackend, repoPath: string, target: SearchTarget): Promise<DatasetSegments | Response> {
  return openForRead(storage, repoPath, target.hash, target.size ?? (await storage.objects.stat(repoPath, target.hash)).size);
}
