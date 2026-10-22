/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { NullType, ArrayType, StringType, encodeBeast2For, some, none, variant, toEastTypeValue, isVariant, type EastTypeValue, type option } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, type TreePath } from '@elaraai/e3-types';
import {
  workspaceListTree,
  workspaceGetDatasetHash,
  workspaceGetDatasetStatus,
  workspaceSetDatasetBytes,
  workspaceGetTree,
  openDatasetObject,
  DatasetSegments,
  type TreeNode,
} from '@elaraai/e3-core/portable';
import type { StorageBackend, TransferBackend } from '@elaraai/e3-core/portable';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant, sendJsonError } from '../errors.js';
import { DatasetStatusDetailType, ListEntryType, type ListEntry, type DatasetStatusDetail } from '../types.js';
import {
  PAGE_BYTE_BUDGET_DEFAULT, PAGE_DEFAULT_LIMIT, PAGE_MAX_LIMIT, cachedSegments, collectionOf, corruptRefusal, elementsOf, indexOf,
  openForRead, openTarget, pageError, pinnedCacheControl, readDataset, rowsByKey, searchTarget, type PinnedCache,
} from './dataset-reads.js';
import { compileKeySearch, locateAll, type KeySearchQuery, type Located } from './key-search.js';
import { decodedSegment } from './segments.js';

export { PAGE_BYTE_BUDGET_DEFAULT, type PinnedCache } from './dataset-reads.js';

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

/** The size over which an object is answered with a URL to fetch it from
 *  rather than inline, when a transfer backend is configured. */
export const DOWNLOAD_REDIRECT_BYTES = 1 * 1024 * 1024;

/**
 * Get dataset value as raw BEAST2 bytes.
 *
 * A collection held as a segment manifest is streamed as its splice, or, for a
 * caller that asks for its segments, answered with JSON `{ manifest }`, the
 * manifest's hash — the primary's, for an indexed record — for a client that
 * downloads the manifest and its segment objects itself and splices them. A
 * host that cannot stream a response answers a large collection no other way.
 * Any other object over {@link DOWNLOAD_REDIRECT_BYTES}, when a transfer
 * backend is configured, is answered with a JSON response carrying a download
 * URL the client fetches directly. This avoids browser issues with opaque
 * redirect responses from `redirect: 'manual'`.
 */
export async function getDataset(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  repo?: string,
  requestUrl?: string,
  transferBackend?: TransferBackend,
  segments = false,
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
    // when the client takes the bytes before it: a host that streams the
    // response holds one segment at a time, and one that buffers it into a
    // single payload holds the value, as far as that payload's limit allows.
    // The download redirect stays for objects that are the value.
    const collection = await openDatasetObject(storage, repoPath, hash);
    if (collection.manifest !== null) {
      if (segments) {
        return new Response(JSON.stringify({ manifest: collection.hash }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Content-SHA256': hash,
          },
        });
      }
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
      if (size > DOWNLOAD_REDIRECT_BYTES) {
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


/** Window addressing for {@link getDatasetPage} and {@link getValuePage}: an
 *  element window (`offset`/`limit`) or one writer segment (`segment`),
 *  optionally pinned to a content hash. */
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
   *  them, and each segment is read and decoded once, through the decoded
   *  segments the API process keeps: a page reads at most one segment per row,
   *  and one whose entries cluster costs far fewer reads than its row count. A
   *  view that renders from the index's covering projection alone leaves this
   *  off and never touches the primary. */
  join?: boolean;
  /** Content hash the window is addressed against. When it matches the
   *  current value the response is immutable (`Cache-Control: immutable`) —
   *  the URL is then a pure function of the bytes, so a cache can hold it
   *  forever with zero staleness: the caller's own, or any between, as the
   *  server's {@link PinnedCache} says. A stale hash is refused with 409
   *  rather than answered with different bytes, keeping caches sound. */
  hash?: string;
}

/** Server-side limits for {@link getDatasetPage} and {@link getValuePage}, and
 *  who may keep a pinned window. */
export interface DatasetPageLimits {
  /** Page byte budget (default {@link PAGE_BYTE_BUDGET_DEFAULT}). */
  byteBudget?: number;
  /** Who may keep a hash-pinned window (default `private`). */
  cache?: PinnedCache;
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
 * Collection datasets are stored as segment manifests by every writer at
 * every size, so every window decodes only the touched segments — each once,
 * through the decoded segments the API process keeps (Set/Dict windows check
 * each segment against the manifest's fences, and refuse a non-canonical one
 * as corrupt). A collection stored as one blob is an older e3's and is refused
 * as `dataset_not_indexed`, naming the fix — there is no whole-decode
 * fallback.
 *
 * The window is the stored value's ({@link getValuePage}): the dataset's
 * status and pin are checked here first, and an index window is a record's.
 */
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
    const dataset = await readDataset(storage, repoPath, workspace, treePath, window.hash, 'paged get');
    if (dataset instanceof Response) return dataset;
    const kind = dataset.typeValue.type;
    if (kind !== 'Array' && kind !== 'Set' && kind !== 'Dict') {
      return pageError('dataset_not_pageable', `Paged reads address Array, Set or Dict datasets; this dataset holds ${kind}`);
    }

    if (window.index !== undefined) {
      return await indexPage(storage, repoPath, workspace, treePath, dataset.hash, window, byteBudget, limits?.cache);
    }

    return await valuePage(storage, repoPath, dataset.hash, dataset.typeValue, window, byteBudget, limits?.cache, dataset.size);
  } catch (err) {
    return sendJsonError(err);
  }
}

/**
 * Get one window of a stored collection by its hash, as raw BEAST2 bytes: the
 * window a dataset page serves, of a value a host names itself — a record's
 * state at a past commit, say.
 *
 * @remarks
 * The body, the `X-*` headers and the refusals are a dataset page's
 * ({@link getDatasetPage}): `X-Content-SHA256` is `hash`, and a window pinned
 * to it (`window.hash`) is answered immutable, as content-addressed, while a
 * pin to any other hash is refused with 409. An index window is a record
 * dataset's, which a value has none of.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param hash - The stored collection's hash: the segment manifest it is kept as
 * @param type - The collection's type: an Array, a Set or a Dict
 * @param window - An element window (`offset`/`limit`) or one writer segment,
 *   and an optional pin
 * @param limits - The page byte budget, and who may keep a pinned window
 *   (`private` unless it says otherwise)
 * @returns The window, or a JSON error
 */
export async function getValuePage(
  storage: StorageBackend,
  repoPath: string,
  hash: string,
  type: EastTypeValue,
  window: DatasetPageWindow,
  limits?: DatasetPageLimits,
): Promise<Response> {
  try {
    const kind = type.type;
    if (kind !== 'Array' && kind !== 'Set' && kind !== 'Dict') {
      return pageError('dataset_not_pageable', `Paged reads address Array, Set or Dict values; this value holds ${kind}`);
    }
    if (window.index !== undefined) {
      return pageError('bad_request', 'An index window pages a record dataset; a value has no index to page');
    }
    if (window.hash !== undefined && window.hash !== hash) {
      return pageError('dataset_hash_mismatch', `The value is ${hash}, not ${window.hash}`, 409, { 'X-Content-SHA256': hash });
    }
    return await valuePage(storage, repoPath, hash, type, window, limits?.byteBudget ?? PAGE_BYTE_BUDGET_DEFAULT, limits?.cache);
  } catch (err) {
    return sendJsonError(err);
  }
}

/**
 * One window of a stored collection of a collection's type: the effective
 * limit under the byte budget, the `X-*` headers, the segments the window
 * touches, and its slice.
 *
 * @param cache - Who may keep the window, when it is pinned
 * @param size - The stored object's size, when the caller knows it
 */
async function valuePage(
  storage: StorageBackend,
  repoPath: string,
  hash: string,
  typeValue: EastTypeValue,
  window: DatasetPageWindow,
  byteBudget: number,
  cache: PinnedCache | undefined,
  size?: number,
): Promise<Response> {
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

  const segments = await openForRead(storage, repoPath, hash, size);
  if (segments instanceof Response) return segments;

  const segmentCount = segments.segmentCount;
  const totalElements = segments.elementCount;
  const totalBytes = segments.bytes;
  const cumulative = segments.cumulative;

  // The byte budget turns the requested element limit into an effective one
  // using the value's average element size, so pages stay bounded even for
  // very wide rows.
  const effectiveLimit = (): number => {
    const avgBytes = totalElements > 0 ? totalBytes / totalElements : 1;
    const byBudget = Math.max(1, Math.floor(byteBudget / Math.max(1, avgBytes)));
    return Math.max(1, Math.min(requestedLimit, PAGE_MAX_LIMIT, byBudget));
  };

  const pageHeaders = (pageOffset: number, pageCount: number): Record<string, string> => ({
    'Content-Type': BEAST2_CONTENT_TYPE,
    // Hash-pinned windows are content-addressed: same URL ⇒ same bytes,
    // forever — cacheable with no invalidation, by the caches the server
    // lets keep them. Unpinned windows track the mutable current value and
    // must not be cached.
    'Cache-Control': window.hash !== undefined ? pinnedCacheControl(cache) : 'no-store',
    'X-Content-SHA256': hash,
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

  let windowValue: unknown;
  let pageOffset: number;
  let pageCount: number;
  if (segmentMode) {
    const seg = window.segment!;
    if (seg >= segmentCount) {
      return pageError('bad_request', `segment ${seg} out of range (${segmentCount} segments)`);
    }
    try {
      windowValue = (await decodedSegment(storage, repoPath, segments, seg)).value;
    } catch (err) {
      return corruptRefusal(err, 'dataset_not_segmented');
    }
    pageCount = segments.counts[seg]!;
    pageOffset = seg === 0 ? 0 : cumulative[seg - 1]!;
  } else {
    const limit = effectiveLimit();
    // An empty window past the end touches no segment.
    const end = Math.min(offset + limit, totalElements);
    let elements: unknown[];
    try {
      elements = offset < totalElements ? await elementsOf(storage, repoPath, segments, [{ from: offset, to: end }]) : [];
    } catch (err) {
      return corruptRefusal(err, 'dataset_not_canonical');
    }
    windowValue = collectionOf(typeValue, elements);
    pageCount = elements.length;
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
}

/**
 * One window of a record read through one of its secondary indexes.
 *
 * @remarks
 * The window comes from the index's OWN segments — the same row span a primary
 * page reads, over the index manifest — so with a covering projection the
 * window IS the answer and the primary is never touched. `join` fills the
 * rows: each primary key is placed in the primary segment that holds it by the
 * primary's fences, and each such segment read once, so a page whose entries
 * share an index key usually costs a handful of reads rather than one per
 * row.
 */
async function indexPage(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  stateHash: string,
  window: DatasetPageWindow,
  byteBudget: number,
  cache: PinnedCache | undefined,
): Promise<Response> {
  const resolved = await indexOf(storage, repoPath, workspace, treePath, stateHash, window.index!, window.join === true);
  if (resolved instanceof Response) return resolved;

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

  // The index window, as the index's own entries, and the rows, if asked
  // for. An index's order is not the record's, so a page's primary keys
  // scatter across the record: each is placed by the primary's fences, and
  // each segment holding one is read once.
  let windowValue: { ik: unknown; key: unknown; value: unknown; row: option<unknown> }[];
  try {
    const entries = (offset < totalElements
      ? await elementsOf(storage, repoPath, index, [{ from: offset, to: Math.min(offset + limit, totalElements) }])
      : []) as [{ ik: unknown; k: unknown }, unknown][];
    const rows = primary !== null
      ? await rowsByKey(storage, repoPath, primary, entries.map(([entry]) => entry.k))
      : entries.map((): option<unknown> => none);
    windowValue = entries.map(([entry, value], i) => ({ ik: entry.ik, key: entry.k, value, row: rows[i]! }));
  } catch (err) {
    return corruptRefusal(err, 'dataset_not_canonical');
  }

  const body = encodeBeast2For(resolved.windowType)(windowValue);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Cache-Control': window.hash !== undefined ? pinnedCacheControl(cache) : 'no-store',
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
export interface DatasetFindQuery extends KeySearchQuery {
  /** Search one of a record's secondary indexes instead of the record itself.
   *  The rows the answer names are then the index's, in index order, and the
   *  key, prefix and fields forms address the index key (`ik`), the key the
   *  record's signature names: an exact one matches every entry under it. */
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

/**
 * Locate a key (or string-prefix range) in a Set/Dict dataset by global
 * element row, without decoding the collection.
 *
 * Rows address the canonical East key order — the same row space
 * {@link getDatasetPage} element windows serve — so the result plugs
 * straight into the paged preview's scroll position. The search
 * binary-searches the manifest's segment fences (each segment's first key)
 * with the key type's East comparator, then binary-searches the keys of at
 * most the one owning segment (exact key) or the two edge segments (a range —
 * which is what an exact key is through an index: every entry under it), each
 * read and decoded once, through the decoded segments the API process keeps.
 *
 * Responds with JSON `{ found, row, count }`: `row` is the match's global
 * element index (for a prefix, the range's first row; for a miss, the
 * key's insertion row), `count` the number of matched rows. Hash-pinned
 * queries are immutable-cacheable exactly like page windows, by the caches
 * `options.cache` lets keep them (`private` unless it says otherwise).
 */
export async function findDatasetKey(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  query: DatasetFindQuery,
  options: { readonly cache?: PinnedCache } = {},
): Promise<Response> {
  try {
    const dataset = await readDataset(storage, repoPath, workspace, treePath, query.hash, 'key search');
    if (dataset instanceof Response) return dataset;
    const target = await searchTarget(storage, repoPath, workspace, treePath, dataset, query.index);
    if (target instanceof Response) return target;

    const search = compileKeySearch(query, target);
    if ('type' in search) return pageError(search.type, search.message);

    const segments = await openTarget(storage, repoPath, target);
    if (segments instanceof Response) return segments;

    let located: Located[];
    try {
      located = await locateAll(storage, repoPath, segments, search.bounds);
    } catch (err) {
      return corruptRefusal(err, 'dataset_not_canonical');
    }
    const { found, row, count } = search.answer(located, segments.elementCount);
    return new Response(JSON.stringify({ found, row, count }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Hash-pinned queries are content-addressed: same URL ⇒ same
        // answer, forever — as for page windows.
        'Cache-Control': query.hash !== undefined ? pinnedCacheControl(options.cache) : 'no-store',
        'X-Content-SHA256': dataset.hash,
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
 * The body's type is read from its head and checked against the dataset's. A
 * collection then goes into the store through its door a segment of the body
 * at a time; any other value is collected and decoded whole, so the handler
 * holds it.
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
