/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { NullType, ArrayType, StringType, decodeBeast2, decodeBeast2For, encodeBeast2For, openBeast2PagesFor, some, none, variant, toEastTypeValue, isVariant, type Beast2Pages, type EastTypeValue } from '@elaraai/east';
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

/** Largest un-indexed blob the fallback will whole-decode. The decode runs
 *  synchronously in the server process — an unbounded one wedges the event
 *  loop (or the whole process) and takes every other request down with it,
 *  which is fatal for in-process hosts like the VS Code extension. Above
 *  this, paging an un-indexed blob is refused with a clear remedy. */
export const PAGE_UNINDEXED_MAX_BYTES_DEFAULT = 64 * 1024 * 1024;

/** Largest blob the page endpoint will buffer at all. Indexed blobs decode
 *  O(segment) but are still read whole today (a transient allocation);
 *  above this cap even that is refused until range reads land. */
export const PAGE_READ_MAX_BYTES_DEFAULT = 512 * 1024 * 1024;

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

/**
 * Per-hash LRU of decoded dataset values.
 *
 * Backs the paths that need the whole (merged) value: un-indexed blobs and
 * Set/Dict element windows. Objects are immutable and content-addressed, so
 * entries never invalidate — capacity is the only bound.
 */
export class DecodedValueCache {
  private readonly map = new Map<string, unknown>();

  constructor(private readonly capacity: number) {}

  get(hash: string): unknown | undefined {
    if (!this.map.has(hash)) return undefined;
    const value = this.map.get(hash);
    this.map.delete(hash);
    this.map.set(hash, value);
    return value;
  }

  set(hash: string, value: unknown): void {
    if (this.map.has(hash)) this.map.delete(hash);
    this.map.set(hash, value);
    if (this.map.size > this.capacity) {
      this.map.delete(this.map.keys().next().value!);
    }
  }
}

function pageError(type: string, message: string, status: 400 | 404 | 409 = 400, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

/** Takes `limit` entries of an iterable starting at `offset` — the sorted
 *  Set/Dict element window over a merged (East-ordered) container. */
function* iterWindow<E>(iterable: Iterable<E>, offset: number, limit: number): Generator<E> {
  let index = 0;
  let taken = 0;
  for (const item of iterable) {
    if (taken >= limit) return;
    if (index++ < offset) continue;
    taken++;
    yield item;
  }
}

/**
 * Get one window of a collection dataset as raw BEAST2 bytes.
 *
 * The body is a valid value of the dataset's own type holding only the
 * window; totals and window placement ride on `X-*` headers. Element windows
 * are exact for every collection kind: Array windows are in stream order,
 * Set/Dict windows are in East sort order over the merged value. Segment
 * windows return one writer batch verbatim and need an indexed blob.
 *
 * Strategy: indexed Array blobs slice via the trailing index (decoding only
 * the touched segments); everything else decodes the whole value once into
 * the per-hash LRU and slices per request.
 */
/** Server-side limits for {@link getDatasetPage}. */
export interface DatasetPageLimits {
  /** Page byte budget (default {@link PAGE_BYTE_BUDGET_DEFAULT}). */
  byteBudget?: number;
  /** Whole-decode cap for un-indexed blobs and merged Set/Dict windows
   *  (default {@link PAGE_UNINDEXED_MAX_BYTES_DEFAULT}). */
  unindexedMaxBytes?: number;
  /** Absolute blob-buffering cap (default {@link PAGE_READ_MAX_BYTES_DEFAULT}). */
  readMaxBytes?: number;
}

export async function getDatasetPage(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  window: DatasetPageWindow,
  cache: DecodedValueCache,
  limits?: DatasetPageLimits,
): Promise<Response> {
  const byteBudget = limits?.byteBudget ?? PAGE_BYTE_BUDGET_DEFAULT;
  const unindexedMaxBytes = limits?.unindexedMaxBytes ?? PAGE_UNINDEXED_MAX_BYTES_DEFAULT;
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

    // The absolute buffering cap protects the server process itself — the
    // endpoint reads the whole blob today (range reads are the follow-up).
    const statSize = status.size ?? 0;
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

    // The byte budget turns the requested element limit into an effective one
    // using the blob's average element size, so pages stay bounded even for
    // very wide rows.
    const effectiveLimit = (totalElements: number): number => {
      const avgBytes = totalElements > 0 ? data.byteLength / totalElements : 1;
      const byBudget = Math.max(1, Math.floor(byteBudget / Math.max(1, avgBytes)));
      return Math.max(1, Math.min(requestedLimit, PAGE_MAX_LIMIT, byBudget));
    };

    let windowValue: unknown;
    let totalElements: number;
    let totalExact: boolean;
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
      totalExact = kind === 'Array';
      pageCount = pages.counts[seg]!;
      pageOffset = 0;
      for (let i = 0; i < seg; i++) pageOffset += pages.counts[i]!;
    } else if (kind === 'Array' && pages !== null && pages.selfContained) {
      totalElements = pages.elementCount;
      totalExact = true;
      const limit = effectiveLimit(totalElements);
      windowValue = pages.slice(offset, limit);
      pageCount = (windowValue as unknown[]).length;
      pageOffset = offset;
    } else {
      let merged = cache.get(status.hash);
      // The whole-decode guardrail: a huge synchronous decode wedges the
      // server for every caller. Already-cached values serve for free.
      if (merged === undefined && data.byteLength > unindexedMaxBytes) {
        const mb = Math.round(data.byteLength / 1024 / 1024);
        const capMb = Math.round(unindexedMaxBytes / 1024 / 1024);
        return pageError('dataset_too_large_unindexed', pages === null
          ? `Dataset is ${mb} MB and stored without a segment index — beyond the ${capMb} MB whole-decode cap. Re-run the producing task (current runners store large collections segmented) or download it.`
          : `Sorted element windows over this ${mb} MB ${kind} need a whole decode — beyond the ${capMb} MB cap. Address it by segment (?page=true&segment=K) or download it.`);
      }
      if (merged === undefined) {
        merged = decodeBeast2For(typeValue)(data);
        cache.set(status.hash, merged);
      }
      totalExact = true;
      if (kind === 'Array') {
        const arr = merged as unknown[];
        totalElements = arr.length;
        const limit = effectiveLimit(totalElements);
        windowValue = arr.slice(offset, offset + limit);
        pageCount = (windowValue as unknown[]).length;
      } else if (kind === 'Set') {
        const set = merged as Set<unknown>;
        totalElements = set.size;
        const limit = effectiveLimit(totalElements);
        windowValue = new Set(iterWindow(set, offset, limit));
        pageCount = (windowValue as Set<unknown>).size;
      } else {
        const map = merged as Map<unknown, unknown>;
        totalElements = map.size;
        const limit = effectiveLimit(totalElements);
        windowValue = new Map(iterWindow(map.entries(), offset, limit));
        pageCount = (windowValue as Map<unknown, unknown>).size;
      }
      pageOffset = offset;
    }

    const body = encodeBeast2For(typeValue)(windowValue);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': BEAST2_CONTENT_TYPE,
        'Content-Length': String(body.byteLength),
        // Hash-pinned windows are content-addressed: same URL ⇒ same bytes,
        // forever — cacheable at any layer with no invalidation. Unpinned
        // windows track the mutable current value and must not be cached.
        'Cache-Control': window.hash !== undefined ? 'public, max-age=31536000, immutable' : 'no-store',
        'X-Content-SHA256': status.hash,
        // The stored blob's full byte size — the page endpoint is then
        // self-describing (no separate status call needed for the header
        // line); Content-Length remains the page's own bytes.
        'X-Total-Bytes': String(data.byteLength),
        'X-Total-Elements': String(totalElements),
        'X-Total-Exactness': totalExact ? 'exact' : 'upper-bound',
        'X-Segment-Count': String(pages ? pages.segmentCount : 0),
        'X-Page-Offset': String(pageOffset),
        'X-Page-Count': String(pageCount),
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
