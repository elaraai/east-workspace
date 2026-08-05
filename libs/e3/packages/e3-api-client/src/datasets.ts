/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, NullType, StringType, decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { computeHash } from './util.js';
import { ApiError, AuthError, fetchWithAuth, parseErrorBody, get, type RequestOptions, type Response } from './http.js';
import {
  ResponseType,
  DatasetStatusDetailType,
  ListEntryType,
  TransferUploadRequestType,
  TransferUploadResponseType,
  TransferDoneResponseType,
  type ListEntry,
  type DatasetStatusDetail,
  type TransferUploadResponse,
  type TransferDoneResponse,
} from './types.js';

function datasetEndpoint(repo: string, workspace: string, path: TreePath): string {
  let endpoint = `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets`;
  if (path.length > 0) {
    const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
    endpoint = `${endpoint}/${pathStr}`;
  }
  return endpoint;
}

/**
 * List field names at root of workspace dataset tree.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param options - Request options including auth token
 * @returns Array of field names at root
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetList(url: string, repo: string, workspace: string, options: RequestOptions): Promise<string[]> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets`,
    ArrayType(StringType),
    options
  );
}

/**
 * List field names at a path in workspace dataset tree.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset (e.g., ['inputs', 'config'])
 * @param options - Request options including auth token
 * @returns Array of field names at path
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetListAt(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<string[]> {
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}?list=true`,
    ArrayType(StringType),
    options
  );
}

/**
 * Get a dataset value as raw BEAST2 bytes.
 *
 * The returned bytes are raw BEAST2 encoded data from the object store.
 * Use decodeBeast2 or decodeBeast2For to decode with the appropriate type.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset (e.g., ['inputs', 'config'])
 * @param options - Request options including auth token
 * @returns Raw BEAST2 bytes
 */
export async function datasetGet(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<{ data: Uint8Array; hash: string; size: number }> {
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const response = await fetchWithAuth(
    `${url}/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}`,
    {
      method: 'GET',
      headers: { 'Accept': BEAST2_CONTENT_TYPE },
    },
    options
  );

  if (!response.ok) {
    const text = await response.text();
    const error = parseErrorBody(text, `http_${response.status}`);
    if (response.status === 401) {
      throw new AuthError(error.details as string ?? 'Authentication required');
    }
    throw error;
  }

  // Handle redirect response — server returns JSON with download URL for large datasets
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await response.json() as { url: string };
    const redirectResponse = await fetch(body.url, {
      method: 'GET',
      headers: { 'Accept': BEAST2_CONTENT_TYPE },
    });
    if (!redirectResponse.ok) {
      throw new Error(`Failed to get dataset (download): ${redirectResponse.status} ${redirectResponse.statusText}`);
    }
    const buffer = await redirectResponse.arrayBuffer();
    const data = new Uint8Array(buffer);
    const hash = redirectResponse.headers.get('X-Content-SHA256') ?? response.headers.get('X-Content-SHA256') ?? '';
    const size = parseInt(redirectResponse.headers.get('Content-Length') ?? response.headers.get('X-Content-Length') ?? '0', 10);
    return { data, hash, size };
  }

  const buffer = await response.arrayBuffer();
  const data = new Uint8Array(buffer);
  const hash = response.headers.get('X-Content-SHA256') ?? '';
  const size = parseInt(response.headers.get('Content-Length') ?? '0', 10);
  return { data, hash, size };
}

/** Window addressing for {@link datasetGetPage}: an element window or one
 *  writer segment, optionally pinned to a content hash. Pinned windows are
 *  immutable-cacheable (same URL ⇒ same bytes); a stale pin is refused with
 *  an error rather than answered with different bytes — refetch the status
 *  for the current hash and retry. */
export type DatasetPageWindow = ({ offset: number; limit: number } | { segment: number }) & { hash?: string };

/** One page of a collection dataset. */
export interface DatasetPage {
  /** Raw BEAST2 bytes of the window — a valid value of the dataset's own
   *  type, decodable with `decodeBeast2For(datasetType)`. */
  data: Uint8Array;
  /** Total elements in the dataset (pairs for Dict datasets). */
  totalElements: number;
  /** Byte size of the whole stored blob (the page body's own size is
   *  `data.length`). */
  totalBytes: number;
  /** Whether `totalElements` is exact. Segment windows of Set/Dict datasets
   *  report an upper bound (cross-segment duplicates collapse on merge). */
  totalExact: boolean;
  /** Segments in the stored blob; 0 when the blob carries no index. */
  segmentCount: number;
  /** Global element offset of the window's first element. */
  offset: number;
  /** Elements actually in this page (the server may clamp the requested
   *  limit by count and by byte budget). */
  count: number;
  /** Content hash of the source object — cache key for the page. */
  hash: string;
}

/**
 * Get one window of a collection (Array/Set/Dict) dataset.
 *
 * Element windows (`{ offset, limit }`) are exact for every collection kind:
 * Array windows in stream order, Set/Dict windows in East sort order over the
 * merged value. Segment windows (`{ segment }`) return one writer batch and
 * need a blob stored with a segment index.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset (e.g., ['inputs', 'rows'])
 * @param window - The window to read
 * @param options - Request options including auth token
 * @returns The page bytes plus totals and window placement
 * @throws {ApiError} On application-level errors (non-collection dataset, bad window)
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetGetPage(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  window: DatasetPageWindow,
  options: RequestOptions
): Promise<DatasetPage> {
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const params = new URLSearchParams({ page: 'true' });
  if ('segment' in window) {
    params.set('segment', String(window.segment));
  } else {
    params.set('offset', String(window.offset));
    params.set('limit', String(window.limit));
  }
  if (window.hash !== undefined) {
    params.set('hash', window.hash);
  }
  const response = await fetchWithAuth(
    `${url}/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}?${params.toString()}`,
    {
      method: 'GET',
      headers: { 'Accept': BEAST2_CONTENT_TYPE },
    },
    options
  );

  if (!response.ok) {
    const text = await response.text();
    const error = parseErrorBody(text, `http_${response.status}`);
    if (response.status === 401) {
      throw new AuthError(error.details as string ?? 'Authentication required');
    }
    throw error;
  }

  const buffer = await response.arrayBuffer();
  const intHeader = (name: string): number => {
    const value = response.headers.get(name);
    return value === null ? 0 : Number(value);
  };
  return {
    data: new Uint8Array(buffer),
    totalElements: intHeader('X-Total-Elements'),
    totalBytes: intHeader('X-Total-Bytes'),
    totalExact: response.headers.get('X-Total-Exactness') !== 'upper-bound',
    segmentCount: intHeader('X-Segment-Count'),
    offset: intHeader('X-Page-Offset'),
    count: intHeader('X-Page-Count'),
    hash: response.headers.get('X-Content-SHA256') ?? '',
  };
}

const SIZE_THRESHOLD = 1 * 1024 * 1024; // 1 MB

/**
 * Set a dataset value from raw BEAST2 bytes.
 *
 * For payloads > 1MB, uses a transfer flow (init → upload → complete) to
 * avoid inline body size limits. For smaller payloads, uses inline PUT.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset (e.g., ['inputs', 'config'])
 * @param data - Raw BEAST2 encoded value
 * @param options - Request options including auth token
 */
export async function datasetSet(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  data: Uint8Array,
  options: RequestOptions
): Promise<void> {
  if (data.byteLength > SIZE_THRESHOLD) {
    return datasetSetTransfer(url, repo, workspace, path, data, options);
  }

  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const response = await fetchWithAuth(
    `${url}/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': BEAST2_CONTENT_TYPE,
        'Accept': BEAST2_CONTENT_TYPE,
      },
      body: data,
    },
    options
  );

  if (!response.ok) {
    throw new Error(`Failed to set dataset: ${response.status} ${response.statusText}`);
  }

  // Decode BEAST2 response to check for application-level errors
  const buffer = await response.arrayBuffer();
  const decode = decodeBeast2For(ResponseType(NullType));
  const result = decode(new Uint8Array(buffer)) as Response<null>;

  if (result.type === 'error') {
    throw new ApiError(result.value.type, result.value.value);
  }
}

/**
 * Set a large dataset using the transfer flow (init → upload → complete).
 */
async function datasetSetTransfer(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  data: Uint8Array,
  options: RequestOptions
): Promise<void> {
  const hash = await computeHash(data);
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const repoEncoded = encodeURIComponent(repo);
  const wsEncoded = encodeURIComponent(workspace);

  // 1. Init transfer (BEAST2 request/response)
  const encodeInit = encodeBeast2For(TransferUploadRequestType);
  const initRes = await fetchWithAuth(
    `${url}/api/repos/${repoEncoded}/workspaces/${wsEncoded}/datasets/${pathStr}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
    },
    body: encodeInit({ hash, size: BigInt(data.byteLength) }),
  }, options);

  if (!initRes.ok) {
    throw new Error(`Transfer init failed: ${initRes.status} ${initRes.statusText}`);
  }

  const initBuffer = new Uint8Array(await initRes.arrayBuffer());
  const decodeInit = decodeBeast2For(ResponseType(TransferUploadResponseType));
  const initResult = decodeInit(initBuffer) as Response<TransferUploadResponse>;
  if (initResult.type === 'error') {
    throw new ApiError(initResult.value.type, initResult.value.value);
  }

  const init = initResult.value;

  // Dedup — object already exists, ref updated
  if (init.type === 'completed') return;

  // 2. Upload to staging (no auth — URL may be a presigned S3 URL)
  const uploadRes = await fetch(init.value.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
    },
    body: data,
  });

  if (!uploadRes.ok) {
    throw new Error(`Transfer upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
  }

  // 3. Commit — server verifies hash + updates ref (BEAST2 response)
  const commitRes = await fetchWithAuth(
    `${url}/api/repos/${repoEncoded}/workspaces/${wsEncoded}/datasets/${pathStr}/upload/${init.value.id}`, {
    method: 'POST',
    headers: { 'Accept': BEAST2_CONTENT_TYPE },
  }, options);

  if (!commitRes.ok) {
    throw new Error(`Transfer commit failed: ${commitRes.status} ${commitRes.statusText}`);
  }

  const commitBuffer = new Uint8Array(await commitRes.arrayBuffer());
  const decodeDone = decodeBeast2For(ResponseType(TransferDoneResponseType));
  const commitResult = decodeDone(commitBuffer) as Response<TransferDoneResponse>;
  if (commitResult.type === 'error') {
    throw new ApiError(commitResult.value.type, commitResult.value.value);
  }

  if (commitResult.value.type === 'error') {
    throw new Error(`Transfer failed: ${commitResult.value.value.message}`);
  }
}

/**
 * List all entries recursively under a path (flat list of datasets and trees).
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Starting path (empty for root)
 * @param options - Request options including auth token
 * @returns Array of list entries (dataset or tree variants) with path, type, hash, and size
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetListRecursive(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<ListEntry[]> {
  const endpoint = `${datasetEndpoint(repo, workspace, path)}?list=true&recursive=true&status=true`;
  return get(url, endpoint, ArrayType(ListEntryType), options);
}

/**
 * List all descendant dataset paths recursively (paths only, no types/status).
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Starting path (empty for root)
 * @param options - Request options including auth token
 * @returns Array of dataset path strings
 */
export async function datasetListRecursivePaths(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<string[]> {
  const endpoint = `${datasetEndpoint(repo, workspace, path)}?list=true&recursive=true`;
  return get(url, endpoint, ArrayType(StringType), options);
}

/**
 * List immediate children with type, hash, and size details.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to list (empty for root)
 * @param options - Request options including auth token
 * @returns Array of list entries (dataset or tree variants) with path, type, hash, and size
 */
export async function datasetListWithStatus(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<ListEntry[]> {
  const endpoint = `${datasetEndpoint(repo, workspace, path)}?list=true&status=true`;
  return get(url, endpoint, ArrayType(ListEntryType), options);
}

/**
 * Get status detail for a single dataset.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset
 * @param options - Request options including auth token
 * @returns Dataset status detail including path, type, refType, hash, and size
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetGetStatus(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<DatasetStatusDetail> {
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}?status=true`,
    DatasetStatusDetailType,
    options
  );
}
