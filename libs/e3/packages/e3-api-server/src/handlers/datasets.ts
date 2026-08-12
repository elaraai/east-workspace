/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { NullType, ArrayType, StringType, compareFor, decodeBeast2, encodeBeast2For, openBeast2PagesFor, parseFor, readBeast2ExtentsRanged, carveBeast2Ranged, some, none, variant, toEastTypeValue, isVariant, type Beast2Pages, type Beast2RangedExtents, type EastTypeValue } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import {
  workspaceListTree,
  workspaceGetDatasetHash,
  workspaceGetDatasetStatus,
  workspaceSetDataset,
  workspaceGetTree,
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

/** Largest blob the page endpoint will buffer when the storage backend
 *  cannot serve ranged reads (`objects.readRange` absent) and every page
 *  request must read the blob whole. Backends with ranged reads never
 *  buffer the blob, so no cap applies — per-window memory is O(window) at
 *  any blob size. */
export const PAGE_READ_MAX_BYTES_DEFAULT = 512 * 1024 * 1024;

/** Ranged extents cached per content hash. Page requests are hash-pinned
 *  immutable, so entries never invalidate — the LRU only bounds memory.
 *  Each entry holds the parsed index (offsets/counts/cumulative) plus the
 *  header bytes windows are assembled under — O(segmentCount) memory, so
 *  the cache is bounded by RETAINED BYTES, not entry count: 64 entries of a
 *  500k-segment blob would otherwise pin hundreds of MB. */
interface CachedRangedExtents {
  extents: Beast2RangedExtents;
  /** Prefix sums of `extents.counts`, for offset→segment addressing. */
  cumulative: number[];
  /** Segment fences (first key of segment) probed so far by key search —
   *  filled lazily, O(log segments) per query, so repeated type-ahead
   *  queries stop re-reading segment frames. Keys are small scalars, so
   *  their bytes are left out of the entry's `bytes` estimate. */
  fences: Map<number, unknown>;
  /** Approximate retained bytes (index arrays + header bytes). */
  bytes: number;
}

const EXTENTS_CACHE_MAX_ENTRIES = 64;
/** Cap on the cache's total retained bytes. The newest entry always stays
 *  (serving the request needs it regardless), so one giant index can still
 *  be held — but never alongside others. */
const EXTENTS_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const extentsCache = new Map<string, CachedRangedExtents>();
let extentsCacheBytes = 0;

/** Evicts oldest entries until the count and byte budgets hold, always
 *  keeping at least the newest entry. */
function evictExtents(): void {
  while (
    extentsCache.size > 1 &&
    (extentsCache.size > EXTENTS_CACHE_MAX_ENTRIES || extentsCacheBytes > EXTENTS_CACHE_MAX_BYTES)
  ) {
    const oldest = extentsCache.keys().next().value!;
    extentsCacheBytes -= extentsCache.get(oldest)!.bytes;
    extentsCache.delete(oldest);
  }
}

/** Fetches (or reuses) a blob's ranged extents, LRU-cached per hash and
 *  bounded by retained bytes. */
async function cachedRangedExtents(
  hash: string,
  size: number,
  readRange: (offset: number, length: number) => Promise<Uint8Array>,
): Promise<CachedRangedExtents> {
  const cached = extentsCache.get(hash);
  if (cached) {
    extentsCache.delete(hash);
    extentsCache.set(hash, cached); // refresh recency
    return cached;
  }
  const extents = await readBeast2ExtentsRanged({ size, read: readRange });
  const cumulative: number[] = new Array(extents.counts.length);
  let running = 0;
  for (let i = 0; i < extents.counts.length; i++) {
    running += extents.counts[i]!;
    cumulative[i] = running;
  }
  // offsets + counts + cumulative at 8 bytes per element, plus the header.
  const bytes = extents.head.byteLength + 24 * extents.counts.length;
  const entry: CachedRangedExtents = { extents, cumulative, fences: new Map(), bytes };
  extentsCache.set(hash, entry);
  extentsCacheBytes += bytes;
  evictExtents();
  return entry;
}

/** Window addressing for {@link getDatasetPage}: an element window
 *  (`offset`/`limit`) or one writer segment (`segment`), optionally pinned
 *  to a content hash. */
export interface DatasetPageWindow {
  offset?: number;
  limit?: number;
  segment?: number;
  /** Content hash the window is addressed against. When it matches the
   *  current value the response is immutable (`Cache-Control: immutable`) —
   *  the URL is then a pure function of the bytes, so any HTTP cache (edge
   *  CDN, browser) can hold it forever with zero staleness. A stale hash is
   *  refused with 409 rather than answered with different bytes, keeping
   *  caches sound. */
  hash?: string;
}

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
  /** Blob-buffering cap for the whole-read fallback, applied only when the
   *  storage backend has no ranged reads (default
   *  {@link PAGE_READ_MAX_BYTES_DEFAULT}). Ranged backends never buffer the
   *  blob, so no cap applies there. */
  readMaxBytes?: number;
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
  const readMaxBytes = limits?.readMaxBytes ?? PAGE_READ_MAX_BYTES_DEFAULT;
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

    const statSize = status.size ?? (await storage.objects.stat(repoPath, status.hash)).size;

    // The byte budget turns the requested element limit into an effective one
    // using the blob's average element size, so pages stay bounded even for
    // very wide rows.
    const effectiveLimit = (totalElements: number): number => {
      const avgBytes = totalElements > 0 ? statSize / totalElements : 1;
      const byBudget = Math.max(1, Math.floor(byteBudget / Math.max(1, avgBytes)));
      return Math.max(1, Math.min(requestedLimit, PAGE_MAX_LIMIT, byBudget));
    };

    const pageHeaders = (totalElements: number, segmentCount: number, pageOffset: number, pageCount: number): Record<string, string> => ({
      'Content-Type': BEAST2_CONTENT_TYPE,
      // Hash-pinned windows are content-addressed: same URL ⇒ same bytes,
      // forever — cacheable at any layer with no invalidation. Unpinned
      // windows track the mutable current value and must not be cached.
      'Cache-Control': window.hash !== undefined ? 'public, max-age=31536000, immutable' : 'no-store',
      'X-Content-SHA256': status.hash!,
      // The stored blob's full byte size — the page endpoint is then
      // self-describing (no separate status call needed for the header
      // line); Content-Length remains the page's own bytes.
      'X-Total-Bytes': String(statSize),
      'X-Total-Elements': String(totalElements),
      // Always exact: Array counts index stream order, and v5 Set/Dict
      // segments are disjoint ranges of the canonical value.
      'X-Total-Exactness': 'exact',
      'X-Segment-Count': String(segmentCount),
      'X-Page-Offset': String(pageOffset),
      'X-Page-Count': String(pageCount),
    });

    // Ranged path: backends with `objects.readRange` never buffer the blob.
    // The tail (index) and head (header sections) are read once per content
    // hash and cached; each window then reads only the byte ranges of the
    // segments it touches — per-request memory is O(window) at any blob
    // size, so no cap applies (#513).
    const readRange = storage.objects.readRange?.bind(storage.objects);
    if (readRange) {
      let cached: CachedRangedExtents;
      try {
        cached = await cachedRangedExtents(status.hash, statSize,
          (offset, length) => readRange(repoPath, status.hash!, offset, length));
      } catch (err) {
        // Only the reader's own blob-shape refusals mean "not indexed" — a
        // blob predating the stored-segmented contract (or injected raw).
        // Anything else (storage I/O, missing object) is a real failure and
        // must surface as one, not masquerade as a re-write suggestion.
        const message = err instanceof Error ? err.message : String(err);
        if (!/^(beast2 v5:|Data too short for Beast2|Invalid Beast2)/.test(message)) {
          throw err;
        }
        return pageError('dataset_not_indexed',
          'Dataset blob carries no pageable segment index — re-write the dataset (re-run the producing task, or set the value again) to store it in the indexed form.');
      }
      const { extents, cumulative } = cached;
      if (!extents.selfContained) {
        return pageError('dataset_not_indexed',
          'Dataset blob carries no pageable segment index — re-write the dataset (re-run the producing task, or set the value again) to store it in the indexed form.');
      }
      const segmentCount = extents.offsets.length;
      const totalElements = extents.elementCount;

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
        limit = effectiveLimit(totalElements);
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

      const spanStart = to > from ? extents.offsets[from]! : 0;
      const spanEnd = to > from
        ? (to < segmentCount ? extents.offsets[to]! : extents.segmentsEnd)
        : 0;
      const frames = to > from
        ? await readRange(repoPath, status.hash, spanStart, spanEnd - spanStart)
        : new Uint8Array(0);
      const windowBlob = carveBeast2Ranged(extents, frames, from, to);
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
        pageCount = extents.counts[from]!;
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
          ...pageHeaders(totalElements, segmentCount, pageOffset, pageCount),
          'Content-Length': String(body.byteLength),
        },
      });
    }

    // Fallback path (no ranged reads): the whole blob is buffered per
    // request, so the absolute cap protects the server process itself.
    if (statSize > readMaxBytes) {
      return pageError('dataset_too_large',
        `Dataset is ${Math.round(statSize / 1024 / 1024)} MB — beyond the ${Math.round(readMaxBytes / 1024 / 1024)} MB paging cap. Download it instead.`);
    }

    const data = await storage.objects.read(repoPath, status.hash);
    let pages: Beast2Pages | null = null;
    try {
      pages = openBeast2PagesFor(typeValue)(data);
    } catch {
      pages = null; // No index/footer — every existing whole-value blob.
    }

    let windowValue: unknown;
    let totalElements: number;
    let pageOffset: number;
    let pageCount: number;

    if (segmentMode) {
      if (!pages) {
        return pageError('dataset_not_segmented', 'Blob carries no segment index — address it with offset/limit instead');
      }
      const seg = window.segment!;
      if (seg >= pages.segmentCount) {
        return pageError('bad_request', `segment ${seg} out of range (${pages.segmentCount} segments)`);
      }
      try {
        windowValue = pages.segment(seg);
      } catch (err) {
        return pageError('dataset_not_segmented', err instanceof Error ? err.message : String(err));
      }
      totalElements = pages.elementCount;
      pageCount = pages.counts[seg]!;
      pageOffset = 0;
      for (let i = 0; i < seg; i++) pageOffset += pages.counts[i]!;
    } else if (pages !== null && pages.selfContained) {
      // The indexed path, every collection kind: Array windows address
      // stream order, Set/Dict windows the canonical key order (fences are
      // verified on first access; a non-canonical blob is corrupt).
      totalElements = pages.elementCount;
      const limit = effectiveLimit(totalElements);
      try {
        windowValue = pages.slice(offset, limit);
      } catch (err) {
        return pageError('dataset_not_canonical', err instanceof Error ? err.message : String(err));
      }
      pageCount = kind === 'Array'
        ? (windowValue as unknown[]).length
        : (windowValue as Set<unknown> | Map<unknown, unknown>).size;
      pageOffset = offset;
    } else {
      // Collection datasets are stored segmented + indexed by every writer
      // at every size; a blob without a pageable index predates that
      // contract (or was injected raw) and is refused rather than
      // whole-decoded — re-writing the dataset produces the indexed form.
      return pageError('dataset_not_indexed',
        'Dataset blob carries no pageable segment index — re-write the dataset (re-run the producing task, or set the value again) to store it in the indexed form.');
    }

    const body = encodeBeast2For(typeValue)(windowValue);
    return new Response(body, {
      status: 200,
      headers: {
        ...pageHeaders(totalElements, pages ? pages.segmentCount : 0, pageOffset, pageCount),
        'Content-Length': String(body.byteLength),
      },
    });
  } catch (err) {
    return sendJsonError(err);
  }
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
  hash?: string;
}

/** Server-side limits for {@link findDatasetKey}. */
export interface DatasetFindLimits {
  /** Blob-buffering cap applied only on the whole-read fallback, as for
   *  {@link DatasetPageLimits.readMaxBytes}. */
  readMaxBytes?: number;
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
  limits?: DatasetFindLimits,
): Promise<Response> {
  const readMaxBytes = limits?.readMaxBytes ?? PAGE_READ_MAX_BYTES_DEFAULT;
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

    const typeValue: EastTypeValue = isVariant(status.datasetType)
      ? status.datasetType
      : toEastTypeValue(status.datasetType as never);
    const kind = typeValue.type;
    if (kind !== 'Set' && kind !== 'Dict') {
      return pageError('dataset_not_searchable', `Key search addresses Set or Dict datasets; this dataset holds ${kind}`);
    }
    const keyTypeValue: EastTypeValue = kind === 'Dict'
      ? (typeValue.value as { key: EastTypeValue; value: EastTypeValue }).key
      : typeValue.value as EastTypeValue;

    const fields = query.fields !== undefined && query.fields.length > 0 ? query.fields : undefined;
    if ((query.key === undefined) === (query.prefix === undefined && fields === undefined)) {
      return pageError('bad_request', 'Pass a key literal, or a prefix and/or leading fields');
    }
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

    const statSize = status.size ?? (await storage.objects.stat(repoPath, status.hash)).size;
    const notIndexed = (): Response => pageError('dataset_not_indexed',
      'Dataset blob carries no pageable segment index — re-write the dataset (re-run the producing task, or set the value again) to store it in the indexed form.');

    // Both data paths resolve to the same fence-search surface: the segment
    // geometry plus a fence probe and a one-segment key iterator.
    let segmentCount: number;
    let elementCount: number;
    let cumulative: readonly number[];
    let fenceAt: (i: number) => Promise<unknown>;
    let keysAt: (i: number) => Promise<Iterable<unknown>>;

    const readRange = storage.objects.readRange?.bind(storage.objects);
    if (readRange) {
      // Ranged path: extents (and previously probed fences) are cached per
      // content hash; each probe reads exactly one segment's frame bytes.
      let cached: CachedRangedExtents;
      try {
        cached = await cachedRangedExtents(status.hash, statSize,
          (offset, length) => readRange(repoPath, status.hash!, offset, length));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/^(beast2 v5:|Data too short for Beast2|Invalid Beast2)/.test(message)) {
          throw err;
        }
        return notIndexed();
      }
      const { extents } = cached;
      if (!extents.selfContained) {
        return notIndexed();
      }
      segmentCount = extents.offsets.length;
      elementCount = extents.elementCount;
      cumulative = cached.cumulative;
      const segmentBlob = async (i: number): Promise<Uint8Array> => {
        const start = extents.offsets[i]!;
        const end = i + 1 < segmentCount ? extents.offsets[i + 1]! : extents.segmentsEnd;
        const frames = await readRange(repoPath, status.hash!, start, end - start);
        return carveBeast2Ranged(extents, frames, i, i + 1);
      };
      fenceAt = async (i) => {
        if (cached.fences.has(i)) return cached.fences.get(i);
        const fence = openBeast2PagesFor(typeValue)(await segmentBlob(i)).fence(0);
        cached.fences.set(i, fence);
        return fence;
      };
      keysAt = async (i) => {
        const segment = openBeast2PagesFor(typeValue)(await segmentBlob(i)).segment(0);
        return kind === 'Set' ? segment as Set<unknown> : (segment as Map<unknown, unknown>).keys();
      };
    } else {
      // Fallback path (no ranged reads): buffer the blob whole under the
      // same cap as paging; fences are then bounded in-memory probes.
      if (statSize > readMaxBytes) {
        return pageError('dataset_too_large',
          `Dataset is ${Math.round(statSize / 1024 / 1024)} MB — beyond the ${Math.round(readMaxBytes / 1024 / 1024)} MB paging cap. Download it instead.`);
      }
      const data = await storage.objects.read(repoPath, status.hash);
      let pages: Beast2Pages;
      try {
        pages = openBeast2PagesFor(typeValue)(data);
      } catch {
        return notIndexed();
      }
      if (!pages.selfContained) {
        return notIndexed();
      }
      segmentCount = pages.segmentCount;
      elementCount = pages.elementCount;
      const sums: number[] = new Array(pages.counts.length);
      let running = 0;
      for (let i = 0; i < pages.counts.length; i++) {
        running += pages.counts[i]!;
        sums[i] = running;
      }
      cumulative = sums;
      fenceAt = (i) => Promise.resolve(pages.fence(i));
      keysAt = (i) => {
        const segment = pages.segment(i);
        return Promise.resolve(kind === 'Set' ? segment as Set<unknown> : (segment as Map<unknown, unknown>).keys());
      };
    }

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
    if (query.key !== undefined) {
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
      // interval in East (code-unit) order.
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
 * Set dataset value from raw BEAST2 bytes.
 */
export async function setDataset(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  body: Uint8Array
): Promise<Response> {
  try {
    if (treePath.length === 0) {
      return sendError(NullType, errorToVariant(new Error('Path required for set')));
    }

    // Body is raw BEAST2 - decode to get type and value
    const { type, value } = decodeBeast2(body);

    await workspaceSetDataset(storage, repoPath, workspace, treePath, value, type);
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

    const result = await workspaceGetDatasetStatus(storage, repoPath, workspace, treePath);

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
      size: result.size !== null ? some(BigInt(result.size)) : none,
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
