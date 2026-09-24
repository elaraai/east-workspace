/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { NullType, ArrayType, StringType, compareFor, encodeBeast2For, openBeast2PagesFor, parseFor, some, none, variant, toEastTypeValue, isVariant, type EastTypeValue } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import {
  workspaceListTree,
  workspaceGetDatasetHash,
  workspaceGetDatasetStatus,
  workspaceSetDatasetBytes,
  workspaceGetTree,
  readManifest,
  recordIndexNames,
  resolveRecordIndex,
  DatasetSegments,
  type TreeNode,
} from '@elaraai/e3-core';
import { BEAST2_CONTENT_TYPE, type StorageBackend, type TransferBackend } from '@elaraai/e3-core';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant, sendJsonError } from '../errors.js';
import { DatasetStatusDetailType, ListEntryType, type ListEntry, type DatasetStatusDetail } from '../types.js';

/**
 * List dataset fields at the given path.
 */
export async function listDatasets(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath
): Promise<Response> {
  try {
    const fields = await workspaceListTree(storage, repoPath, workspace, treePath);
    return sendSuccess(ArrayType(StringType), fields);
  } catch (err) {
    return sendError(ArrayType(StringType), errorToVariant(err));
  }
}

const SIZE_THRESHOLD = 1 * 1024 * 1024; // 1 MB

/**
 * Get dataset value as raw BEAST2 bytes.
 *
 * For objects > 1MB, returns a JSON response with a download URL
 * that the client can fetch directly. This avoids browser issues
 * with opaque redirect responses from `redirect: 'manual'`.
 */
export async function getDataset(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  repo?: string,
  requestUrl?: string,
  transferBackend?: TransferBackend,
): Promise<Response> {
  try {
    if (treePath.length === 0) {
      return new Response(JSON.stringify({ error: { type: 'bad_request', message: 'Path required for get' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { refType, hash } = await workspaceGetDatasetHash(storage, repoPath, workspace, treePath);

    if (refType === 'unassigned') {
      return new Response(JSON.stringify({ error: { type: 'dataset_unassigned', message: 'Dataset is unassigned (pending task output)' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (refType === 'null' || !hash) {
      return new Response(JSON.stringify({ error: { type: 'dataset_null', message: 'Dataset is null' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // A collection held as a segment manifest is many objects, so the
    // transfer backend — which serves ONE object by hash — cannot hand the
    // client a value. The splice is streamed instead, a segment read only
    // when the client takes the bytes before it, so the server never holds
    // the value; the download redirect stays for objects that are the value.
    if (await readManifest(storage, repoPath, hash) !== null) {
      const chunks = (await DatasetSegments.open(storage, repoPath, hash)).splice()[Symbol.asyncIterator]();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await chunks.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
        async cancel() {
          await chunks.return?.();
        },
      }, { highWaterMark: 0 });
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': BEAST2_CONTENT_TYPE,
          'X-Content-SHA256': hash,
        },
      });
    }

    // When serving via API with a transfer backend, check size to decide whether to redirect
    if (transferBackend && repo && requestUrl) {
      const { size } = await storage.objects.stat(repoPath, hash);
      if (size > SIZE_THRESHOLD) {
        let downloadUrl = await transferBackend.datasetDownload.getDownloadUrl(repo, hash);
        // Resolve relative URL against the request origin
        if (downloadUrl.startsWith('/')) {
          const origin = new URL(requestUrl).origin;
          downloadUrl = `${origin}${downloadUrl}`;
        }
        return new Response(JSON.stringify({ url: downloadUrl }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Content-Length': String(size),
            'X-Content-SHA256': hash,
          },
        });
      }
    }

    // Inline response
    const data = await storage.objects.read(repoPath, hash);
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': BEAST2_CONTENT_TYPE,
        'Content-Length': String(data.byteLength),
        'X-Content-SHA256': hash,
      },
    });
  } catch (err) {
    return sendJsonError(err);
  }
}

/** Elements returned per page when the request names no limit. */
const PAGE_DEFAULT_LIMIT = 1_000;

/** Hard cap on elements per page. */
const PAGE_MAX_LIMIT = 10_000;

/** Default cap on a page's share of the source blob, in bytes. The
 *  effective limit shrinks so `limit × avgElementBytes` stays under the
 *  budget, bounding page payloads even for very wide rows. Deployments with
 *  tighter response limits (e.g. Lambda proxy's 6 MB, base64-inflated) pass
 *  a smaller budget through the route options. */
export const PAGE_BYTE_BUDGET_DEFAULT = 4 * 1024 * 1024;

/** Opened datasets cached per repository and content hash. Page requests are
 *  hash-pinned immutable, so entries never invalidate — the LRU only bounds
 *  memory. An entry holds the segment geometry (counts, prefix sums, and the
 *  fences a manifest carries or a bisect has probed), which is O(segments), so
 *  the cache is bounded by RETAINED BYTES rather than entry count: 64 entries
 *  of a 500k-segment dataset would otherwise pin hundreds of MB. */
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

/** Identifies a storage backend for the cache key — lazily, and without
 *  keeping it alive. */
const storageIds = new WeakMap<object, number>();
let nextStorageId = 0;

/** Opens (or reuses) a stored collection, LRU-cached per backend, repository
 *  and content hash, and bounded by retained bytes.
 *
 *  All three key parts are load-bearing. An opened dataset holds the backend
 *  it reads segment objects through, and a manifest names objects that exist
 *  in the repository it was read from and nowhere else — so two backends, or
 *  two repositories, that happen to hold the same bytes under the same name
 *  must not share an entry. */
async function cachedSegments(
  storage: StorageBackend,
  repoPath: string,
  hash: string,
  size: number,
): Promise<DatasetSegments> {
  let backendId = storageIds.get(storage);
  if (backendId === undefined) {
    backendId = nextStorageId++;
    storageIds.set(storage, backendId);
  }
  const key = `${backendId}\u0000${repoPath}\u0000${hash}`;
  const cached = segmentsCache.get(key);
  if (cached) {
    segmentsCache.delete(key);
    segmentsCache.set(key, cached); // refresh recency
    return cached.segments;
  }
  const segments = await DatasetSegments.open(storage, repoPath, hash, size);
  // counts + prefix sums at 8 bytes each, plus a manifest's stored fences.
  let bytes = 16 * segments.segmentCount;
  for (const entry of segments.manifest?.entries ?? []) bytes += entry.fence.byteLength + 80;
  segmentsCache.set(key, { segments, bytes });
  segmentsCacheBytes += bytes;
  evictSegments();
  return segments;
}

/** Window addressing for {@link getDatasetPage}: an element window
 *  (`offset`/`limit`) or one writer segment (`segment`), optionally pinned
 *  to a content hash. */
export interface DatasetPageWindow {
  offset?: number;
  limit?: number;
  segment?: number;
  /** Read through one of a record's secondary indexes instead of the record
   *  itself. The window is then an ORDERED array in index order — a Dict would
   *  re-sort by its own key and throw that order away — carrying the index key,
   *  the primary key, the covering projection and, with {@link join}, the row. */
  index?: string;
  /** Fill each window entry's `row` from the primary.
   *
   *  The window's primary keys are grouped by the primary segment that holds
   *  them, and each segment is read and decoded once, then dropped before the
   *  next: a page reads at most one segment per row and holds one decoded
   *  segment at a time, and one whose entries cluster costs far fewer reads
   *  than its row count. A view that renders from the index's covering
   *  projection alone leaves this off and never touches the primary. */
  join?: boolean;
  /** Content hash the window is addressed against. When it matches the
   *  current value the response is immutable (`Cache-Control: immutable`) —
   *  the URL is then a pure function of the bytes, so any HTTP cache (edge
   *  CDN, browser) can hold it forever with zero staleness. A stale hash is
   *  refused with 409 rather than answered with different bytes, keeping
   *  caches sound. */
  hash?: string;
}

/** What a caller is told when a dataset object is neither a segment manifest
 *  nor a pageable blob: something wrote it outside the encoder door, and no
 *  read path can repair it — re-writing the dataset produces the layout. */
const NOT_INDEXED_MESSAGE =
  'Dataset carries no pageable segment index — re-write the dataset (re-run the producing task, or set the value again) to store it in the indexed form.';

function pageError(type: string, message: string, status: 400 | 404 | 409 = 400, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

/**
 * Get one window of a collection dataset as raw BEAST2 bytes.
 *
 * The body is a valid value of the dataset's own type holding only the
 * window; totals and window placement ride on `X-*` headers. Element windows
 * are exact for every collection kind: Array windows address stream order,
 * Set/Dict windows the canonical East (key) order — which IS the wire order,
 * since v5 Set/Dict segments hold the canonical value in disjoint ascending
 * ranges. Segment windows return one writer batch verbatim.
 *
 * Collection datasets are stored segmented + indexed by every writer at
 * every size, so every window decodes only the touched segments (Set/Dict
 * windows verify the segment fences first and reject non-canonical blobs as
 * corrupt). A blob without a pageable index predates that contract and is
 * refused — there is no whole-decode fallback.
 */
/** Server-side limits for {@link getDatasetPage}. */
export interface DatasetPageLimits {
  /** Page byte budget (default {@link PAGE_BYTE_BUDGET_DEFAULT}). */
  byteBudget?: number;
}

export async function getDatasetPage(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  window: DatasetPageWindow,
  limits?: DatasetPageLimits,
): Promise<Response> {
  const byteBudget = limits?.byteBudget ?? PAGE_BYTE_BUDGET_DEFAULT;
  try {
    if (treePath.length === 0) {
      return pageError('bad_request', 'Path required for paged get');
    }

    const status = await workspaceGetDatasetStatus(storage, repoPath, workspace, treePath);
    if (status.refType === 'unassigned') {
      return pageError('dataset_unassigned', 'Dataset is unassigned (pending task output)', 404);
    }
    if (status.refType === 'null' || !status.hash) {
      return pageError('dataset_null', 'Dataset is null', 404);
    }
    // A hash-pinned window must never answer with different bytes — refuse
    // stale pins (the client refetches status for the current hash) so a
    // hash-keyed URL is a pure function of the response and caches stay sound.
    if (window.hash !== undefined && window.hash !== status.hash) {
      return pageError('dataset_hash_mismatch',
        `Dataset content is ${status.hash}, not ${window.hash} — refetch status and retry`,
        409, { 'X-Content-SHA256': status.hash });
    }

    const typeValue: EastTypeValue = isVariant(status.datasetType)
      ? status.datasetType
      : toEastTypeValue(status.datasetType as never);
    const kind = typeValue.type;
    if (kind !== 'Array' && kind !== 'Set' && kind !== 'Dict') {
      return pageError('dataset_not_pageable', `Paged reads address Array, Set or Dict datasets; this dataset holds ${kind}`);
    }

    if (window.index !== undefined) {
      return await indexPage(storage, repoPath, workspace, treePath, status.hash, window, byteBudget);
    }

    const segmentMode = window.segment !== undefined;
    if (segmentMode && (window.offset !== undefined || window.limit !== undefined)) {
      return pageError('bad_request', 'Pass either segment or offset/limit, not both');
    }
    if (segmentMode && (!Number.isInteger(window.segment) || window.segment! < 0)) {
      return pageError('bad_request', `segment must be a non-negative integer, got ${window.segment}`);
    }
    const offset = window.offset ?? 0;
    const requestedLimit = window.limit ?? PAGE_DEFAULT_LIMIT;
    if (!segmentMode && (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(requestedLimit) || requestedLimit < 1)) {
      return pageError('bad_request', `offset must be a non-negative integer and limit a positive integer, got offset=${offset} limit=${requestedLimit}`);
    }

    const objectSize = status.size ?? (await storage.objects.stat(repoPath, status.hash)).size;

    let segments: DatasetSegments;
    try {
      segments = await cachedSegments(storage, repoPath, status.hash, objectSize);
    } catch (err) {
      // Only the reader's own shape refusals mean "not indexed" — a blob
      // predating the stored-segmented contract (or injected raw). Anything
      // else (storage I/O, missing object) is a real failure and must surface
      // as one, not masquerade as a re-write suggestion.
      const message = err instanceof Error ? err.message : String(err);
      if (!/^(beast2 v5:|collection manifest:|Data too short for Beast2|Invalid Beast2)/.test(message)) {
        throw err;
      }
      return pageError('dataset_not_indexed', NOT_INDEXED_MESSAGE);
    }

    const segmentCount = segments.segmentCount;
    const totalElements = segments.elementCount;
    const totalBytes = segments.bytes;
    const cumulative = segments.cumulative;

    // The byte budget turns the requested element limit into an effective one
    // using the dataset's average element size, so pages stay bounded even for
    // very wide rows.
    const effectiveLimit = (): number => {
      const avgBytes = totalElements > 0 ? totalBytes / totalElements : 1;
      const byBudget = Math.max(1, Math.floor(byteBudget / Math.max(1, avgBytes)));
      return Math.max(1, Math.min(requestedLimit, PAGE_MAX_LIMIT, byBudget));
    };

    const pageHeaders = (pageOffset: number, pageCount: number): Record<string, string> => ({
      'Content-Type': BEAST2_CONTENT_TYPE,
      // Hash-pinned windows are content-addressed: same URL ⇒ same bytes,
      // forever — cacheable at any layer with no invalidation. Unpinned
      // windows track the mutable current value and must not be cached.
      'Cache-Control': window.hash !== undefined ? 'public, max-age=31536000, immutable' : 'no-store',
      'X-Content-SHA256': status.hash!,
      // The value's full stored byte size — the page endpoint is then
      // self-describing (no separate status call needed for the header
      // line); Content-Length remains the page's own bytes.
      'X-Total-Bytes': String(totalBytes),
      'X-Total-Elements': String(totalElements),
      // Always exact: Array counts index stream order, and v5 Set/Dict
      // segments are disjoint ranges of the canonical value.
      'X-Total-Exactness': 'exact',
      'X-Segment-Count': String(segmentCount),
      'X-Page-Offset': String(pageOffset),
      'X-Page-Count': String(pageCount),
    });

    // The touched segment span [from, to) and the window placement.
    let from: number;
    let to: number;
    let limit = 0;
    if (segmentMode) {
      const seg = window.segment!;
      if (seg >= segmentCount) {
        return pageError('bad_request', `segment ${seg} out of range (${segmentCount} segments)`);
      }
      from = seg;
      to = seg + 1;
    } else {
      limit = effectiveLimit();
      if (offset >= totalElements) {
        from = 0;
        to = 0; // empty window past the end
      } else {
        from = 0;
        while (cumulative[from]! <= offset) from++;
        const lastRow = Math.min(offset + limit, totalElements) - 1;
        to = from;
        while (cumulative[to]! <= lastRow) to++;
        to++;
      }
    }

    const windowBlob = await segments.span(from, to);
    const pages = openBeast2PagesFor(typeValue)(windowBlob);

    let windowValue: unknown;
    let pageOffset: number;
    let pageCount: number;
    if (segmentMode) {
      try {
        windowValue = pages.segment(0);
      } catch (err) {
        return pageError('dataset_not_segmented', err instanceof Error ? err.message : String(err));
      }
      pageCount = segments.counts[from]!;
      pageOffset = from === 0 ? 0 : cumulative[from - 1]!;
    } else {
      const base = from > 0 ? cumulative[from - 1]! : 0;
      try {
        windowValue = pages.slice(to > from ? offset - base : 0, limit);
      } catch (err) {
        return pageError('dataset_not_canonical', err instanceof Error ? err.message : String(err));
      }
      pageCount = kind === 'Array'
        ? (windowValue as unknown[]).length
        : (windowValue as Set<unknown> | Map<unknown, unknown>).size;
      pageOffset = offset;
    }

    const body = encodeBeast2For(typeValue)(windowValue);
    return new Response(body, {
      status: 200,
      headers: {
        ...pageHeaders(pageOffset, pageCount),
        'Content-Length': String(body.byteLength),
      },
    });
  } catch (err) {
    return sendJsonError(err);
  }
}

/**
 * One window of a record read through one of its secondary indexes.
 *
 * @remarks
 * The window comes from the index's OWN segments — the same fence bisect and
 * window slice a primary page uses, over the index manifest — so with a
 * covering projection the window IS the answer and the primary is never
 * touched. `join` fills the rows: the window's primary keys are bucketed by
 * owning primary segment, each distinct segment read once, and the rows
 * projected out, so a page whose entries share an index key usually costs a
 * handful of reads rather than one per row.
 */
async function indexPage(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  stateHash: string,
  window: DatasetPageWindow,
  byteBudget: number,
): Promise<Response> {
  const refPath = treePath.map((s) => s.value).join('/');
  const resolved = await resolveRecordIndex(storage, repoPath, workspace, refPath, stateHash, window.index!);
  if (resolved === null) {
    const declared = await recordIndexNames(storage, repoPath, stateHash);
    return pageError('index_not_found',
      `Dataset '${refPath}' has no index '${window.index!}'`
      + (declared.length > 0 ? ` — it has ${declared.join(', ')}` : ' — it declares none'), 404);
  }

  const offset = window.offset ?? 0;
  const requestedLimit = window.limit ?? PAGE_DEFAULT_LIMIT;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return pageError('bad_request', `offset must be a non-negative integer and limit a positive integer, got offset=${offset} limit=${requestedLimit}`);
  }

  const index = await cachedSegments(storage, repoPath, resolved.manifest,
    (await storage.objects.stat(repoPath, resolved.manifest)).size);
  const totalElements = index.elementCount;
  // A joined page carries whole rows, so its budget is the PRIMARY's average
  // row size, not the index entry's — a covering page of the same limit is far
  // smaller and is clamped on its own terms.
  const primary = window.join === true
    ? await cachedSegments(storage, repoPath, resolved.primary,
      (await storage.objects.stat(repoPath, resolved.primary)).size)
    : null;
  const perRow = (primary !== null && primary.elementCount > 0 ? primary.bytes / primary.elementCount : 0)
    + (totalElements > 0 ? index.bytes / totalElements : 1);
  const limit = Math.max(1, Math.min(requestedLimit, PAGE_MAX_LIMIT,
    Math.max(1, Math.floor(byteBudget / Math.max(1, perRow)))));

  // The index window, as the index's own collection.
  let from = 0;
  let to = 0;
  if (offset < totalElements) {
    while (index.cumulative[from]! <= offset) from++;
    const lastRow = Math.min(offset + limit, totalElements) - 1;
    to = from;
    while (index.cumulative[to]! <= lastRow) to++;
    to++;
  }
  const base = from > 0 ? index.cumulative[from - 1]! : 0;
  const slice = openBeast2PagesFor(resolved.collectionType)(await index.span(from, to))
    .slice(to > from ? offset - base : 0, limit) as Map<{ ik: unknown; k: unknown }, unknown>;

  // The rows, if asked for. An index's order is not the record's, so a page's
  // primary keys scatter across the record: they are grouped by the segment
  // that holds them, and each segment is decoded once and dropped before the
  // next. A page holds one decoded segment at a time however widely its keys
  // scatter, and reads at most one segment per row it returns.
  const entries = [...slice];
  const rows: unknown[] = entries.map(() => none);
  if (primary !== null) {
    const bySegment = new Map<number, number[]>();
    for (let i = 0; i < entries.length; i++) {
      const segment = await primary.segmentFor(entries[i]![0].k);
      const held = bySegment.get(segment);
      if (held === undefined) bySegment.set(segment, [i]);
      else held.push(i);
    }
    const decodeSegment = openBeast2PagesFor(primary.typeValue);
    for (const [segment, indices] of bySegment) {
      const decoded = decodeSegment(await primary.segment(segment)).segment(0) as Map<unknown, unknown>;
      for (const i of indices) {
        const row = decoded.get(entries[i]![0].k);
        if (row !== undefined) rows[i] = some(row);
      }
    }
  }

  const windowValue = entries.map(([entry, value], i) => ({ ik: entry.ik, key: entry.k, value, row: rows[i] }));

  const body = encodeBeast2For(resolved.windowType)(windowValue);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Cache-Control': window.hash !== undefined ? 'public, max-age=31536000, immutable' : 'no-store',
      'X-Content-SHA256': stateHash,
      'X-Total-Bytes': String(index.bytes),
      'X-Total-Elements': String(totalElements),
      'X-Total-Exactness': 'exact',
      'X-Segment-Count': String(index.segmentCount),
      'X-Page-Offset': String(offset),
      'X-Page-Count': String(windowValue.length),
      // The window is the index's shape, not the dataset's: a client decodes
      // it as `Array<{ik, key, value, row}>`, never as the record's type.
      'X-Window-Index': window.index!,
      ...(window.join === true && { 'X-Window-Joined': 'true' }),
      'Content-Length': String(body.byteLength),
    },
  });
}

/** Query for {@link findDatasetKey}, optionally pinned to a content hash
 *  with the same semantics as {@link DatasetPageWindow.hash}. Exactly one
 *  form: `key` (a whole-key `.east` literal, any key type), `prefix`
 *  (String keys — or Struct keys, as a prefix on the FIRST field when it
 *  is a String), or `fields` (Struct keys: `.east` literals of exact
 *  leading fields in declaration order) optionally combined with `prefix`
 *  continuing into the next (String) field. Every form addresses one
 *  contiguous row range in the canonical key order. */
export interface DatasetFindQuery {
  key?: string;
  prefix?: string;
  fields?: string[];
  /** Search one of a record's secondary indexes instead of the record itself.
   *  The rows the answer names are then the index's, in index order. */
  index?: string;
  /** Lower bound: `.east` literals of a leading prefix of the key's FLATTENED
   *  field path, nested structs recursed in declaration order. For an index
   *  key that path begins inside `ik`, so `{ik: {status, due}, k: {plan, bin}}`
   *  flattens to `status, due, plan, bin` and `from=[late, 2026-10-01]` bounds
   *  `ik.status, ik.due`. Absent means "from the first row". */
  from?: string[];
  /** Upper bound, exclusive, on the same flattened prefix. Absent means "to
   *  the last row". */
  to?: string[];
  hash?: string;
}

/** One leaf of a key type, and the field path that reaches it. */
interface KeyField {
  path: string[];
  type: EastTypeValue;
}

/**
 * A key type's leaves, in declaration order, recursing into nested structs.
 *
 * @remarks
 * Struct keys compare field by field in declaration order, so this flattening
 * IS the key's sort order — which is what makes a bound on a leading prefix of
 * it one contiguous row range. A scalar key flattens to one leaf with an empty
 * path.
 */
function flattenKeyFields(keyType: EastTypeValue): KeyField[] {
  if (keyType.type !== 'Struct') return [{ path: [], type: keyType }];
  const out: KeyField[] = [];
  for (const field of keyType.value as { name: string; type: EastTypeValue }[]) {
    for (const leaf of flattenKeyFields(field.type)) {
      out.push({ path: [field.name, ...leaf.path], type: leaf.type });
    }
  }
  return out;
}

/** The value at a flattened field path. */
function fieldAt(key: unknown, path: string[]): unknown {
  let value = key;
  for (const segment of path) value = (value as Record<string, unknown>)[segment];
  return value;
}

/**
 * A monotone "is this key at or past the bound?" predicate over a leading
 * prefix of the flattened key.
 *
 * @remarks
 * Monotone over the canonical key order because it reads only the leading
 * fields, which are exactly the ones the order sorts by first — so one fence
 * bisect finds its boundary row, and a pair of them bound one contiguous
 * range.
 */
function boundPredicate(leaves: KeyField[], values: unknown[]): (key: unknown) => boolean {
  const comparators = leaves.slice(0, values.length).map((leaf) => compareFor(leaf.type as never) as (a: unknown, b: unknown) => number);
  return (key) => {
    for (let i = 0; i < values.length; i++) {
      const order = comparators[i]!(fieldAt(key, leaves[i]!.path), values[i]);
      if (order !== 0) return order > 0;
    }
    return true; // equal on the prefix: at the bound, so past it
  };
}

/**
 * Locate a key (or string-prefix range) in a Set/Dict dataset by global
 * element row, without decoding the collection.
 *
 * Rows address the canonical East key order — the same row space
 * {@link getDatasetPage} element windows serve — so the result plugs
 * straight into the paged preview's scroll position. The search
 * binary-searches the blob's segment fences (each segment's first key,
 * probed and cached per content hash) with the key type's East comparator,
 * then decodes at most the one owning segment (exact key) or the two edge
 * segments (prefix range).
 *
 * Responds with JSON `{ found, row, count }`: `row` is the match's global
 * element index (for a prefix, the range's first row; for a miss, the
 * key's insertion row), `count` the number of matched rows. Hash-pinned
 * queries are immutable-cacheable exactly like page windows.
 */
export async function findDatasetKey(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  query: DatasetFindQuery,
): Promise<Response> {
  try {
    if (treePath.length === 0) {
      return pageError('bad_request', 'Path required for key search');
    }

    const status = await workspaceGetDatasetStatus(storage, repoPath, workspace, treePath);
    if (status.refType === 'unassigned') {
      return pageError('dataset_unassigned', 'Dataset is unassigned (pending task output)', 404);
    }
    if (status.refType === 'null' || !status.hash) {
      return pageError('dataset_null', 'Dataset is null', 404);
    }
    if (query.hash !== undefined && query.hash !== status.hash) {
      return pageError('dataset_hash_mismatch',
        `Dataset content is ${status.hash}, not ${query.hash} — refetch status and retry`,
        409, { 'X-Content-SHA256': status.hash });
    }

    // An index selector searches the index's own collection, whose rows the
    // answer is in — the same row space an index page serves.
    let typeValue: EastTypeValue = isVariant(status.datasetType)
      ? status.datasetType
      : toEastTypeValue(status.datasetType as never);
    let searchHash = status.hash;
    if (query.index !== undefined) {
      const refPath = treePath.map((seg) => seg.value).join('/');
      const resolved = await resolveRecordIndex(storage, repoPath, workspace, refPath, status.hash, query.index);
      if (resolved === null) {
        const declared = await recordIndexNames(storage, repoPath, status.hash);
        return pageError('index_not_found',
          `Dataset '${refPath}' has no index '${query.index}'`
          + (declared.length > 0 ? ` — it has ${declared.join(', ')}` : ' — it declares none'), 404);
      }
      typeValue = resolved.collectionType;
      searchHash = resolved.manifest;
    }
    const kind = typeValue.type;
    if (kind !== 'Set' && kind !== 'Dict') {
      return pageError('dataset_not_searchable', `Key search addresses Set or Dict datasets; this dataset holds ${kind}`);
    }
    const keyTypeValue: EastTypeValue = kind === 'Dict'
      ? (typeValue.value as { key: EastTypeValue; value: EastTypeValue }).key
      : typeValue.value as EastTypeValue;

    const fields = query.fields !== undefined && query.fields.length > 0 ? query.fields : undefined;
    const ranged = (query.from !== undefined && query.from.length > 0) || (query.to !== undefined && query.to.length > 0);
    const forms = [query.key !== undefined, query.prefix !== undefined || fields !== undefined, ranged];
    if (forms.filter(Boolean).length !== 1) {
      return pageError('bad_request',
        'Pass a key literal, or a prefix and/or leading fields, or a from/to range — exactly one form');
    }

    // The range form's bounds are leading prefixes of the FLATTENED key, which
    // is the order the collection is sorted in, so each bounds one contiguous
    // row range.
    const leaves = flattenKeyFields(keyTypeValue);
    const parseBound = (label: string, literals: string[] | undefined): { values: unknown[] } | Response => {
      if (literals === undefined || literals.length === 0) return { values: [] };
      if (literals.length > leaves.length) {
        return pageError('bad_request',
          `${label} names ${literals.length} key fields, but the key flattens to ${leaves.length}: `
          + leaves.map((leaf) => leaf.path.join('.') || '(the key)').join(', '));
      }
      const values: unknown[] = [];
      for (let i = 0; i < literals.length; i++) {
        const parsed = parseFor(leaves[i]!.type)(literals[i]!);
        if (!parsed.success) {
          return pageError('key_parse_error', `${label} field '${leaves[i]!.path.join('.') || '(the key)'}': ${parsed.error}`);
        }
        values.push(parsed.value);
      }
      return { values };
    };
    const lowerBound = parseBound('from', query.from);
    if (lowerBound instanceof Response) return lowerBound;
    const upperBound = parseBound('to', query.to);
    if (upperBound instanceof Response) return upperBound;
    const structMeta = keyTypeValue.type === 'Struct'
      ? keyTypeValue.value as { name: string; type: EastTypeValue }[]
      : null;
    if (fields !== undefined) {
      if (structMeta === null) {
        return pageError('bad_request', `Leading-field search addresses Struct keys; this dataset's keys are ${keyTypeValue.type}`);
      }
      if (fields.length > structMeta.length) {
        return pageError('bad_request', `Key has ${structMeta.length} fields, got ${fields.length}`);
      }
    }
    const fieldValues: unknown[] = [];
    if (fields !== undefined && structMeta !== null) {
      for (let j = 0; j < fields.length; j++) {
        const parsed = parseFor(structMeta[j]!.type)(fields[j]!);
        if (!parsed.success) {
          return pageError('key_parse_error', `field '${structMeta[j]!.name}': ${parsed.error}`);
        }
        fieldValues.push(parsed.value);
      }
    }
    if (query.prefix !== undefined) {
      const prefixIdx = fieldValues.length;
      const prefixFieldType = structMeta !== null
        ? (prefixIdx < structMeta.length ? structMeta[prefixIdx]!.type : undefined)
        : keyTypeValue;
      if (prefixFieldType === undefined) {
        return pageError('bad_request', `All ${structMeta!.length} key fields are exact — nothing left for a prefix`);
      }
      if (prefixFieldType.type !== 'String') {
        return pageError('bad_request', structMeta !== null
          ? `prefix continues key field '${structMeta[prefixIdx]!.name}', which is ${prefixFieldType.type}, not String`
          : `prefix search needs String keys; this dataset's keys are ${keyTypeValue.type}`);
      }
    }
    let keyValue: unknown;
    if (query.key !== undefined) {
      const parsed = parseFor(keyTypeValue)(query.key);
      if (!parsed.success) {
        return pageError('key_parse_error', parsed.error);
      }
      keyValue = parsed.value;
    }
    const cmp = compareFor(keyTypeValue);

    const objectSize = searchHash === status.hash
      ? status.size ?? (await storage.objects.stat(repoPath, status.hash)).size
      : (await storage.objects.stat(repoPath, searchHash)).size;

    let segments: DatasetSegments;
    try {
      segments = await cachedSegments(storage, repoPath, searchHash, objectSize);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/^(beast2 v5:|collection manifest:|Data too short for Beast2|Invalid Beast2)/.test(message)) {
        throw err;
      }
      return pageError('dataset_not_indexed', NOT_INDEXED_MESSAGE);
    }

    // The fence-search surface: the segment geometry, a fence probe, and a
    // one-segment key iterator. A manifest answers every fence from its own
    // entries, so a bisect over one reads no frames at all.
    const segmentCount = segments.segmentCount;
    const elementCount = segments.elementCount;
    const cumulative = segments.cumulative;
    const fenceAt = (i: number): Promise<unknown> => segments.fence(i);
    const keysAt = async (i: number): Promise<Iterable<unknown>> => {
      const segment = openBeast2PagesFor(typeValue)(await segments.segment(i)).segment(0);
      return kind === 'Set' ? segment as Set<unknown> : (segment as Map<unknown, unknown>).keys();
    };

    // First row whose key satisfies a monotone predicate (false… then
    // true… over the canonical key order), plus that row's key. Fences
    // bound the candidate segment, so at most ONE segment decodes: when the
    // boundary is the first row of a later segment, its fence already IS
    // the boundary key.
    const locate = async (pred: (k: unknown) => boolean): Promise<{ row: number; key: unknown; hasKey: boolean }> => {
      if (segmentCount === 0) return { row: 0, key: undefined, hasKey: false };
      const first = await fenceAt(0);
      if (pred(first)) return { row: 0, key: first, hasKey: true };
      // Greatest segment whose fence is before the boundary.
      let lo = 0, hi = segmentCount - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (!pred(await fenceAt(mid))) lo = mid;
        else hi = mid - 1;
      }
      const base = lo === 0 ? 0 : cumulative[lo - 1]!;
      let idx = 0;
      for (const k of await keysAt(lo)) {
        if (pred(k)) return { row: base + idx, key: k, hasKey: true };
        idx++;
      }
      if (lo + 1 < segmentCount) {
        const next = await fenceAt(lo + 1);
        return { row: cumulative[lo]!, key: next, hasKey: true };
      }
      return { row: elementCount, key: undefined, hasKey: false };
    };

    let found: boolean;
    let row: number;
    let count: number;
    if (ranged) {
      // Two bisects, one contiguous range: `[from, to)` on the flattened
      // prefix. An absent bound is the collection's own end.
      const lower = query.from === undefined || query.from.length === 0
        ? { row: 0 }
        : await locate(boundPredicate(leaves, lowerBound.values));
      const upper = query.to === undefined || query.to.length === 0
        ? { row: elementCount }
        : await locate(boundPredicate(leaves, upperBound.values));
      row = lower.row;
      count = Math.max(0, upper.row - lower.row);
      found = count > 0;
    } else if (query.key !== undefined) {
      const at = await locate((k) => cmp(k, keyValue) >= 0);
      found = at.hasKey && cmp(at.key, keyValue) === 0;
      row = at.row;
      count = found ? 1 : 0;
    } else {
      // Range query — a String prefix, or a struct key's exact leading
      // fields with an optional prefix on the next field. Both predicates
      // depend only on the leading field tuple, and struct keys compare
      // field-by-field in declaration order, so they are monotone over the
      // canonical key order; prefix-extending strings form one contiguous
      // interval in East (code-point) order.
      let lowerPred: (k: unknown) => boolean;
      let upperPred: (k: unknown) => boolean;
      const prefix = query.prefix;
      if (structMeta !== null) {
        const fieldCmps = structMeta.map((f) => compareFor(f.type));
        const lead = (k: unknown): number => {
          for (let j = 0; j < fieldValues.length; j++) {
            const c = fieldCmps[j]!((k as Record<string, unknown>)[structMeta[j]!.name], fieldValues[j]);
            if (c !== 0) return c;
          }
          return 0;
        };
        if (prefix === undefined) {
          lowerPred = (k) => lead(k) >= 0;
          upperPred = (k) => lead(k) > 0;
        } else {
          const prefixIdx = fieldValues.length;
          const prefixName = structMeta[prefixIdx]!.name;
          const prefixCmp = fieldCmps[prefixIdx]!;
          lowerPred = (k) => {
            const c = lead(k);
            return c !== 0 ? c > 0 : prefixCmp((k as Record<string, unknown>)[prefixName], prefix) >= 0;
          };
          upperPred = (k) => {
            const c = lead(k);
            if (c !== 0) return c > 0;
            const field = (k as Record<string, unknown>)[prefixName] as string;
            return prefixCmp(field, prefix) > 0 && !field.startsWith(prefix);
          };
        }
      } else {
        // Scalar String keys — validation guarantees the prefix is set here.
        const scalarPrefix = prefix!;
        lowerPred = (k) => cmp(k, scalarPrefix) >= 0;
        upperPred = (k) => cmp(k, scalarPrefix) > 0 && !(k as string).startsWith(scalarPrefix);
      }
      const lower = await locate(lowerPred);
      const upper = await locate(upperPred);
      row = lower.row;
      count = upper.row - lower.row;
      found = count > 0;
    }
    return new Response(JSON.stringify({ found, row, count }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Hash-pinned queries are content-addressed: same URL ⇒ same
        // answer, forever — as for page windows.
        'Cache-Control': query.hash !== undefined ? 'public, max-age=31536000, immutable' : 'no-store',
        'X-Content-SHA256': status.hash,
      },
    });
  } catch (err) {
    return sendJsonError(err);
  }
}

/**
 * Set a dataset value from raw BEAST2 bytes, read as they arrive.
 *
 * @remarks
 * The body is never held whole: its type is read from its head and checked
 * against the dataset's, and a collection goes into the store through its
 * door a segment of the body at a time.
 */
export async function setDataset(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
): Promise<Response> {
  try {
    if (treePath.length === 0) {
      return sendError(NullType, errorToVariant(new Error('Path required for set')));
    }
    await workspaceSetDatasetBytes(storage, repoPath, workspace, treePath, body);
    return sendSuccess(NullType, null);
  } catch (err) {
    return sendError(NullType, errorToVariant(err));
  }
}

/**
 * Flatten a tree of nodes into a list of ListEntry variants (dataset + tree entries).
 */
function flattenTreeEntries(
  nodes: TreeNode[],
  pathPrefix: string,
  result: ListEntry[],
  recursive: boolean
): void {
  for (const node of nodes) {
    const path = pathPrefix ? `${pathPrefix}.${node.name}` : `.${node.name}`;

    if (node.kind === 'dataset') {
      const datasetType = node.datasetType;
      if (datasetType) {
        const typeValue: EastTypeValue = isVariant(datasetType)
          ? datasetType as EastTypeValue
          : toEastTypeValue(datasetType);

        result.push(variant('dataset', {
          path,
          type: typeValue,
          hash: node.hash ? some(node.hash) : none,
          size: node.size !== undefined ? some(BigInt(node.size)) : none,
        }));
      }
    } else if (node.kind === 'tree') {
      result.push(variant('tree', { path, kind: variant('struct', null) }));
      if (recursive) {
        flattenTreeEntries(node.children, path, result, recursive);
      }
    }
  }
}

/**
 * Get status detail for a single dataset.
 */
export async function getDatasetStatus(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath
): Promise<Response> {
  try {
    if (treePath.length === 0) {
      return sendError(DatasetStatusDetailType, errorToVariant(new Error('Path required for status')));
    }

    const result = await workspaceGetDatasetStatus(storage, repoPath, workspace, treePath, { geometry: true });

    // Build path string from treePath
    const pathStr = '.' + treePath.map(s => s.value).join('.');

    // Convert EastType to EastTypeValue if needed
    const typeValue: EastTypeValue = isVariant(result.datasetType)
      ? result.datasetType as EastTypeValue
      : toEastTypeValue(result.datasetType);

    const detail: DatasetStatusDetail = {
      path: pathStr,
      type: typeValue,
      refType: result.refType,
      hash: result.hash ? some(result.hash) : none,
      // What the dataset costs in the store. For a collection held as a
      // segment manifest that is the segments plus the manifest; the manifest
      // object alone is a few dozen bytes per segment whatever the value
      // weighs, and reporting that would say a 10 MiB dataset is 12 KiB.
      size: result.storedBytes != null ? some(BigInt(result.storedBytes))
        : result.size !== null ? some(BigInt(result.size)) : none,
      segments: result.segments != null ? some(BigInt(result.segments)) : none,
      rows: result.rows != null ? some(BigInt(result.rows)) : none,
    };

    return sendSuccess(DatasetStatusDetailType, detail);
  } catch (err) {
    return sendError(DatasetStatusDetailType, errorToVariant(err));
  }
}

/**
 * List datasets recursively (flat list with paths, types, and status).
 */
export async function listDatasetsRecursive(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath
): Promise<Response> {
  try {
    // Get tree with types and status included
    const nodes = await workspaceGetTree(storage, repoPath, workspace, treePath, {
      includeTypes: true,
      includeStatus: true,
    });

    // Build path prefix from treePath
    const pathPrefix = treePath.map(seg => seg.value).join('.');

    // Flatten to list (includes tree entries)
    const result: ListEntry[] = [];
    flattenTreeEntries(nodes, pathPrefix ? `.${pathPrefix}` : '', result, true);

    return sendSuccess(ArrayType(ListEntryType), result);
  } catch (err) {
    return sendError(ArrayType(ListEntryType), errorToVariant(err));
  }
}

/**
 * Flatten tree nodes into a list of dataset paths (no types/status).
 */
function flattenTreePaths(
  nodes: TreeNode[],
  pathPrefix: string,
  result: string[]
): void {
  for (const node of nodes) {
    const path = pathPrefix ? `${pathPrefix}.${node.name}` : `.${node.name}`;
    if (node.kind === 'dataset') {
      result.push(path);
    } else if (node.kind === 'tree') {
      flattenTreePaths(node.children, path, result);
    }
  }
}

/**
 * List all descendant dataset paths (string[]).
 */
export async function listDatasetsRecursivePaths(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath
): Promise<Response> {
  try {
    const nodes = await workspaceGetTree(storage, repoPath, workspace, treePath, {
      includeTypes: false,
      includeStatus: false,
    });

    const pathPrefix = treePath.map(seg => seg.value).join('.');
    const result: string[] = [];
    flattenTreePaths(nodes, pathPrefix ? `.${pathPrefix}` : '', result);

    return sendSuccess(ArrayType(StringType), result);
  } catch (err) {
    return sendError(ArrayType(StringType), errorToVariant(err));
  }
}

/**
 * List immediate children with types and status (ListEntry[]).
 */
export async function listDatasetsWithStatus(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath
): Promise<Response> {
  try {
    const nodes = await workspaceGetTree(storage, repoPath, workspace, treePath, {
      maxDepth: 0,
      includeTypes: true,
      includeStatus: true,
    });

    const pathPrefix = treePath.map(seg => seg.value).join('.');
    const result: ListEntry[] = [];
    flattenTreeEntries(nodes, pathPrefix ? `.${pathPrefix}` : '', result, false);

    return sendSuccess(ArrayType(ListEntryType), result);
  } catch (err) {
    return sendError(ArrayType(ListEntryType), errorToVariant(err));
  }
}
