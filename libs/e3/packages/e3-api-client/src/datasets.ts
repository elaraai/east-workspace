/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, NullType, StringType, decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import { BEAST2_CONTENT_TYPE, TRANSFER_PROTOCOL_VERSION, transferPartCount, transferPartRange } from '@elaraai/e3-types';
import { computeHash } from './util.js';
import { ApiError, AuthError, fetchWithAuth, fetchWithRetry, parseErrorBody, get, type RequestOptions, type Response } from './http.js';
import {
  ResponseType,
  DatasetStatusDetailType,
  ListEntryType,
  TransferUploadRequestType,
  TransferUploadResponseType,
  TransferPartResponseType,
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
export type DatasetPageWindow = ({ offset: number; limit: number } | { segment: number }) & {
  hash?: string;
  /** Read through one of a record's secondary indexes. The page's `data` is
   *  then an ORDERED `Array<{ik, key, value, row}>` in index order — decode it
   *  with the index's window type, never the record's. */
  index?: string;
  /** Fill each window entry's `row` from the primary. A view rendering from
   *  the index's covering projection alone leaves this off and never reads a
   *  primary segment. */
  join?: boolean;
};

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
  /** Whether `totalElements` is exact. Always `true` against current
   *  servers — v5 Set/Dict segments are disjoint ranges of the canonical
   *  value, so counts never overlap. */
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
 * Array windows address stream order, Set/Dict windows the canonical East
 * (key) order — the wire order of v5 blobs. Segment windows (`{ segment }`)
 * return one writer batch and need a blob stored with a segment index.
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
  if (window.index !== undefined) {
    params.set('index', window.index);
    if (window.join === true) params.set('join', 'true');
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

/** Query for {@link datasetFindKey}, optionally pinned to a content hash:
 *  `key` (a whole-key `.east` literal, any key type), `prefix` (String
 *  keys — or, for Struct keys, a prefix on the FIRST field when it is a
 *  String), `fields` (Struct keys: `.east` literals of exact leading
 *  fields in declaration order, optionally with `prefix` continuing into
 *  the next String field), or a `from` / `to` RANGE over a leading prefix
 *  of the key's flattened field path. Every form addresses one contiguous
 *  row range in the canonical key order. Pinned queries are
 *  immutable-cacheable (same URL ⇒ same answer); a stale pin is refused with
 *  an error rather than answered against different content.
 *
 *  `index` searches one of a record's secondary indexes instead of the
 *  record itself, so the rows the answer names are the index's — the same
 *  row space an index page serves. */
export type DatasetFindQuery = (
  | { key: string }
  | { prefix: string }
  | { fields: string[]; prefix?: string }
  | { from?: string[]; to?: string[] }
) & { hash?: string; index?: string };

/** A key-search result over a Set/Dict dataset. */
export interface DatasetFindResult {
  /** Whether any row matched. */
  found: boolean;
  /** Global element index of the match — a prefix range's first row; for a
   *  miss, the key's insertion row. Rows address the canonical East key
   *  order, the same row space {@link datasetGetPage} element windows
   *  serve. */
  row: number;
  /** Number of matched rows (1/0 for an exact key). */
  count: number;
  /** Content hash of the source object — cache key for the result. */
  hash: string;
}

/**
 * Locate a key (or string-prefix range) in a Set/Dict dataset by global
 * element row.
 *
 * The server binary-searches the stored blob's segment fences with the key
 * type's East comparator and decodes at most two segments — never the
 * whole collection — so a lookup in a very large keyed dataset stays
 * O(log segments). The resulting `row` plugs straight into a
 * {@link datasetGetPage} element window (e.g. a paged viewer's scroll
 * position).
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset (e.g., ['inputs', 'rows'])
 * @param query - The key literal or string prefix to locate
 * @param options - Request options including auth token
 * @returns The match's row placement and count
 * @throws {ApiError} On application-level errors (non-keyed dataset,
 *   unparsable key literal, stale hash pin, index-less blob)
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetFindKey(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  query: DatasetFindQuery,
  options: RequestOptions
): Promise<DatasetFindResult> {
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const params = new URLSearchParams({ find: 'true' });
  if ('fields' in query) {
    for (const field of query.fields) {
      params.append('field', field);
    }
    if (query.prefix !== undefined) {
      params.set('prefix', query.prefix);
    }
  } else if ('key' in query) {
    params.set('key', query.key);
  } else if ('prefix' in query) {
    params.set('prefix', query.prefix);
  } else {
    for (const literal of query.from ?? []) params.append('from', literal);
    for (const literal of query.to ?? []) params.append('to', literal);
  }
  if (query.hash !== undefined) {
    params.set('hash', query.hash);
  }
  if (query.index !== undefined) {
    params.set('index', query.index);
  }
  const response = await fetchWithAuth(
    `${url}/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}?${params.toString()}`,
    {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
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

  const body = await response.json() as { found: boolean; row: number; count: number };
  return { ...body, hash: response.headers.get('X-Content-SHA256') ?? '' };
}

const SIZE_THRESHOLD = 1 * 1024 * 1024; // 1 MB

/** How many parts of one upload are sent at a time. */
const PART_CONCURRENCY = 4;

/** The first and the longest wait between polls of a commit still `processing`. */
const COMMIT_POLL_MIN_MS = 100;
const COMMIT_POLL_MAX_MS = 1000;

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
    return datasetSetTransfer(url, repo, workspace, path, {
      size: data.byteLength,
      hash: await computeHash(data),
      slice: (start, end) => data.subarray(start, end),
    }, options);
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
 * A payload for {@link datasetSetTransfer}: its size and digest up front, and
 * its bytes produced only if the server actually wants them.
 *
 * @remarks
 * The bytes come by range because the transfer dedups on the hash (when the
 * object is already in the store nothing is ever read) and because a server may
 * ask for them in parts: `slice` is called for each part — concurrently for
 * distinct parts, and again for a part whose send is retried. It returns a
 * stream for a file, which is how a multi-gigabyte delivery reaches a remote
 * repo without the client holding it, or the bytes for an in-memory value.
 */
export interface DatasetTransferSource {
  /** Total byte length. */
  readonly size: number;
  /** SHA256 of those bytes, as lowercase hex. */
  readonly hash: string;
  /** The bytes in `[start, end)`, produced on demand. */
  slice(start: number, end: number): Uint8Array | ReadableStream<Uint8Array>;
}

/**
 * Set a large dataset using the transfer flow (init → upload → commit).
 *
 * @remarks
 * Speaks transfer protocol 2 and still understands a server that predates it:
 * the init answers `completed` (the object is stored already), `upload` (one
 * PUT of every byte — a protocol-1 server) or `upload_parts` (the parts the
 * server planned, each sent to the URL and with the headers it names for that
 * part, a few at a time). The commit may answer `processing` while the server
 * verifies the bytes, and is polled until it finishes.
 */
async function datasetSetTransfer(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  source: DatasetTransferSource,
  options: RequestOptions
): Promise<void> {
  const { hash } = source;
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const repoEncoded = encodeURIComponent(repo);
  const wsEncoded = encodeURIComponent(workspace);
  const uploadPath = `/repos/${repoEncoded}/workspaces/${wsEncoded}/datasets/${pathStr}/upload`;
  const protocol = `protocol=${TRANSFER_PROTOCOL_VERSION}`;

  // 1. Init transfer (BEAST2 request/response)
  const encodeInit = encodeBeast2For(TransferUploadRequestType);
  const initRes = await fetchWithAuth(`${url}/api${uploadPath}?${protocol}`, {
    method: 'POST',
    headers: {
      'Content-Type': BEAST2_CONTENT_TYPE,
      'Accept': BEAST2_CONTENT_TYPE,
    },
    body: encodeInit({ hash, size: BigInt(source.size) }),
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

  // 2. Upload to staging (no auth — the URLs may be presigned S3 URLs)
  if (init.type === 'upload') {
    await putRange(init.value.uploadUrl, {}, source, 0, source.size, options, 'Transfer upload failed');
  } else {
    await putParts(url, `${uploadPath}/${init.value.id}`, Number(init.value.partBytes), source, options);
  }

  // 3. Commit — server verifies hash + updates ref (BEAST2 response), and
  //    answers `processing` while that is still running
  let done = await commitRequest(`${url}/api${uploadPath}/${init.value.id}?${protocol}`, 'POST', options);
  for (let wait = COMMIT_POLL_MIN_MS; done.type === 'processing'; wait = Math.min(wait * 2, COMMIT_POLL_MAX_MS)) {
    await new Promise(resolve => setTimeout(resolve, wait));
    done = await commitRequest(`${url}/api${uploadPath}/${init.value.id}`, 'GET', options);
  }

  if (done.type === 'error') {
    throw new Error(`Transfer failed: ${done.value.message}`);
  }
}

/**
 * Send every part of an upload the server planned as parts, a few at a time,
 * each to the URL and with the headers the server names for it.
 */
async function putParts(
  url: string,
  transferPath: string,
  partBytes: number,
  source: DatasetTransferSource,
  options: RequestOptions
): Promise<void> {
  const count = transferPartCount(source.size, partBytes);
  let next = 1;
  let failed = false;
  const sender = async (): Promise<void> => {
    // Parts are claimed one at a time; once one fails the rest are left unsent.
    for (let part = next++; part <= count && !failed; part = next++) {
      const { start, end } = transferPartRange(source.size, partBytes, part)!;
      try {
        const target = await get(url, `${transferPath}/parts/${part}`, TransferPartResponseType, options);
        await putRange(
          target.url, Object.fromEntries(target.headers), source, start, end, options,
          `Transfer upload failed: part ${part} of ${count}`,
        );
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, count) }, sender));
}

/**
 * PUT the source's bytes in `[start, end)` to an upload URL, retrying a
 * transient failure with the range read afresh.
 */
async function putRange(
  uploadUrl: string,
  headers: Record<string, string>,
  source: DatasetTransferSource,
  start: number,
  end: number,
  options: RequestOptions,
  failure: string
): Promise<void> {
  // A stream body needs `duplex: 'half'` and a declared length; undici refuses
  // a streaming request without the former and cannot chunk without the
  // latter. `fetch`'s lib.dom BodyInit does not name ReadableStream in this
  // configuration, and `duplex` is not in the type at all — both are undici
  // runtime contracts, so the init is typed through RequestInit.
  const res = await fetchWithRetry(uploadUrl, () => {
    const body = source.slice(start, end);
    const streaming = typeof (body as ReadableStream<Uint8Array>).getReader === 'function';
    return {
      method: 'PUT',
      headers: {
        'Content-Type': BEAST2_CONTENT_TYPE,
        'Accept': BEAST2_CONTENT_TYPE,
        ...headers,
        'Content-Length': String(end - start),
      },
      ...({ body, ...(streaming ? { duplex: 'half' } : {}) } as Record<string, unknown>),
    } as RequestInit;
  }, { idempotent: true, retry: options.retry });

  if (!res.ok) {
    throw new Error(`${failure}: ${res.status} ${res.statusText}`);
  }
}

/** Commit an upload (POST) or poll its commit (GET), decoding the answer. */
async function commitRequest(
  commitUrl: string,
  method: 'POST' | 'GET',
  options: RequestOptions
): Promise<TransferDoneResponse> {
  const res = await fetchWithAuth(commitUrl, {
    method,
    headers: { 'Accept': BEAST2_CONTENT_TYPE },
  }, options);

  if (!res.ok) {
    throw new Error(`Transfer commit failed: ${res.status} ${res.statusText}`);
  }

  const buffer = new Uint8Array(await res.arrayBuffer());
  const decodeDone = decodeBeast2For(ResponseType(TransferDoneResponseType));
  const result = decodeDone(buffer) as Response<TransferDoneResponse>;
  if (result.type === 'error') {
    throw new ApiError(result.value.type, result.value.value);
  }
  return result.value;
}

/**
 * Set a dataset from a file, streaming it to a remote repository.
 *
 * @remarks
 * The remote twin of `e3 dataset set --from-file`: the digest is streamed from
 * the file, the transfer dedups on it (a delivery already in the store costs
 * one round trip and no bytes), and every part the server asks for is a stream
 * of the file's range, so the client's memory is a buffer per part in flight
 * rather than the file. The server's commit runs the same `datasetAdoptFile`
 * validation a local set does, so a type mismatch is refused with the same
 * message.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset (e.g., ['inputs', 'table'])
 * @param source - The file's size, digest and byte ranges
 * @param options - Request options including auth token
 * @throws {ApiError} On application-level errors, including a type mismatch
 */
export async function datasetSetStream(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  source: DatasetTransferSource,
  options: RequestOptions
): Promise<void> {
  return datasetSetTransfer(url, repo, workspace, path, source, options);
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
