/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, IntegerType, NullType, StringType, decodeBeast2For, encodeBeast2For, equalFor, printFor, spliceBeast2Segments } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import { BEAST2_CONTENT_TYPE, E3_RELEASE, TRANSFER_PROTOCOL_VERSION, decodeCollectionManifest, transferPartCount, transferPartRange } from '@elaraai/e3-types';
import { computeHash } from './util.js';
import {
  ApiError, AuthError, DatasetHashMismatchError, fetchWithAuth, fetchWithRetry, parseErrorBody, get, requestFetch, type RequestOptions, type Response,
} from './http.js';
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
  type IntakeFile,
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
 * The value is read through {@link datasetGetStream} and joined here, so a
 * collection arrives as the segment objects its manifest names: no response
 * carries more than one segment, so a server that cannot stream a response
 * still serves a collection of any size.
 *
 * A dataset that moves while it is read, so that the old value's objects can
 * no longer be fetched, is read again from its new content, up to 3 times.
 * The hash returned is the content the bytes are.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset (e.g., ['inputs', 'config'])
 * @param options - Request options including auth token
 * @returns Raw BEAST2 bytes, the content hash they are, and their size
 * @throws {DatasetHashMismatchError} When the dataset is still moving after
 *   the restarts; its `currentHash` names the content it holds now
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetGet(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<{ data: Uint8Array; hash: string; size: number }> {
  const restarts = { left: MOVED_RESTARTS };
  for (;;) {
    const { hash, chunks } = await openDataset(url, repo, workspace, path, options, restarts);
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const chunk of chunks) {
        parts.push(chunk);
        size += chunk.length;
      }
    } catch (err) {
      // The chunks raise a move once they have given bytes out; this read
      // holds those alone, so it starts over from the new content.
      if (!(err instanceof DatasetHashMismatchError) || restarts.left === 0) throw err;
      restarts.left--;
      continue;
    }
    if (parts.length === 1) return { data: parts[0]!, hash, size };
    const data = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      data.set(part, at);
      at += part.length;
    }
    return { data, hash, size };
  }
}

/**
 * Get a dataset value as raw BEAST2 bytes, a chunk at a time.
 *
 * @remarks
 * For a caller that writes the value somewhere rather than holding it. A
 * collection arrives as the segment objects its manifest names, fetched a few
 * at a time ahead of the splice that takes them in order, each checked against
 * its hash: the caller holds the segments in flight, never the value. Any
 * other value arrives as the body the server sends. The dataset is asked for,
 * and a collection's manifest read, before this returns, so a refusal throws
 * here rather than from the chunks.
 *
 * The chunks are always the content of the hash returned. A read that fails
 * asks for the dataset again, and a dataset that has moved (a run wrote a new
 * value, and the old one's objects can no longer be fetched) is treated by
 * where the read had got to:
 * - before this returns, the read starts over from the new content, up to 3
 *   times;
 * - once it has returned, the chunks throw a {@link DatasetHashMismatchError}
 *   naming the content the dataset holds now, as a pinned page does, and the
 *   caller starts over.
 *
 * A dataset that has not moved raises the read's own error.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param workspace - Workspace name
 * @param path - Path to the dataset (e.g., ['inputs', 'config'])
 * @param options - Request options including auth token
 * @returns The value's content hash, as the server names it, and its bytes in order
 * @throws {DatasetHashMismatchError} When the dataset is still moving after
 *   the restarts, and from the chunks when it moves once this has returned;
 *   its `currentHash` names the content the dataset holds now
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function datasetGetStream(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions
): Promise<{ hash: string; chunks: AsyncIterable<Uint8Array> }> {
  return openDataset(url, repo, workspace, path, options, { left: MOVED_RESTARTS });
}

/** How many times a read of a dataset starts over when the dataset moves
 *  while it is read. */
const MOVED_RESTARTS = 3;

/**
 * Open a dataset's value for reading, as {@link datasetGetStream} does. A read
 * that meets a moved dataset before this returns starts over, taking one of
 * `restarts`, which a caller that starts over itself shares.
 */
async function openDataset(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions,
  restarts: { left: number },
): Promise<{ hash: string; chunks: AsyncIterable<Uint8Array> }> {
  let answer = await requestDataset(url, repo, workspace, path, options);
  for (;;) {
    const hash = answer.headers.get('X-Content-SHA256') ?? '';
    const moved = (): Promise<globalThis.Response | null> => movedFrom(url, repo, workspace, path, hash, options);
    try {
      const opened = await answerChunks(url, repo, answer, hash, options);
      return { hash: opened.hash, chunks: raiseMoves(opened.chunks, hash, moved) };
    } catch (err) {
      const current = await moved();
      if (current === null) throw err;
      if (restarts.left === 0) {
        await discard(current);
        throw movedError(hash, current);
      }
      restarts.left--;
      answer = current;
    }
  }
}

/** Ask for a dataset's value as a read by segments does: answered with a
 *  collection's manifest, a large value's URL, or any other value's bytes. */
async function requestDataset(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  options: RequestOptions,
): Promise<globalThis.Response> {
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const response = await fetchWithAuth(
    `${url}/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/datasets/${pathStr}?segments=true`,
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
  return response;
}

/**
 * The bytes a dataset's answer names, and the content hash they are: a
 * collection's segments, read through the objects route and spliced; a large
 * value's download; or the answer's own body. A collection's manifest, and a
 * large value's download, are fetched before this returns.
 */
async function answerChunks(
  url: string,
  repo: string,
  answer: globalThis.Response,
  hash: string,
  options: RequestOptions,
): Promise<{ hash: string; chunks: AsyncIterable<Uint8Array> }> {
  // A JSON answer names a collection's manifest, or the URL a large value is
  // downloaded from.
  if ((answer.headers.get('Content-Type') ?? '').includes('application/json')) {
    const body = await answer.json() as { manifest: string } | { url: string };
    if ('manifest' in body) {
      return { hash, chunks: await collectionGetStream(url, repo, body.manifest, options) };
    }
    const redirectResponse = await requestFetch(options)(body.url, {
      method: 'GET',
      headers: { 'Accept': BEAST2_CONTENT_TYPE },
    });
    if (!redirectResponse.ok) {
      throw new Error(`Failed to get dataset (download): ${redirectResponse.status} ${redirectResponse.statusText}`);
    }
    return { hash: redirectResponse.headers.get('X-Content-SHA256') ?? hash, chunks: bodyChunks(redirectResponse) };
  }
  return { hash, chunks: bodyChunks(answer) };
}

/**
 * Ask for a dataset again after a read of it failed.
 *
 * @returns The new answer when the dataset names content other than `hash`.
 *   `null` when it does not, or when it cannot be asked for: the read's own
 *   error is the one to raise then.
 */
async function movedFrom(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  hash: string,
  options: RequestOptions,
): Promise<globalThis.Response | null> {
  let answer: globalThis.Response;
  try {
    answer = await requestDataset(url, repo, workspace, path, options);
  } catch {
    return null;
  }
  if ((answer.headers.get('X-Content-SHA256') ?? '') !== hash) return answer;
  await discard(answer);
  return null;
}

/** A read's chunks, a failure among them raised as a move when `moved` finds
 *  the dataset holds other content than `hash` now. */
async function* raiseMoves(
  chunks: AsyncIterable<Uint8Array>,
  hash: string,
  moved: () => Promise<globalThis.Response | null>,
): AsyncGenerator<Uint8Array> {
  try {
    yield* chunks;
  } catch (err) {
    const current = await moved();
    if (current === null) throw err;
    await discard(current);
    throw movedError(hash, current);
  }
}

/** The error a read raises when the dataset it reads has moved on from `hash`
 *  to the content its new answer names. */
function movedError(hash: string, current: globalThis.Response): DatasetHashMismatchError {
  const now = current.headers.get('X-Content-SHA256');
  return new DatasetHashMismatchError(`the dataset moved from ${hash} to ${now ?? 'content it names no hash of'} while it was read`, now);
}

/** Release an answer whose body is not read. */
async function discard(answer: globalThis.Response): Promise<void> {
  await answer.body?.cancel().catch(() => { /* an unread body */ });
}

/** A response's body as it arrives; the rest is cancelled when the reader stops early. */
async function* bodyChunks(response: globalThis.Response): AsyncGenerator<Uint8Array> {
  if (response.body === null) {
    yield new Uint8Array(await response.arrayBuffer());
    return;
  }
  const reader = response.body.getReader();
  let ended = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        ended = true;
        return;
      }
      yield next.value;
    }
  } finally {
    if (!ended) await reader.cancel();
  }
}

/** How many of a collection's objects are fetched at a time. */
const SEGMENT_CONCURRENCY = 8;

const integerEqual = equalFor(IntegerType);
const printInteger = printFor(IntegerType);

/**
 * Get a stored collection by its manifest's hash, as raw BEAST2 bytes, a chunk
 * at a time: what {@link datasetGetStream} streams a collection dataset as, of
 * a value a caller names by hash — a record's state at a past commit, say.
 *
 * @remarks
 * The objects the manifest names are fetched through the objects route a few
 * at a time, each checked against its hash ({@link objectGet}), ahead of a
 * splice that takes them in order into the blob the dataset route would
 * stream. The manifest is read before this returns, so a refusal throws here;
 * the segments are read as the chunks are taken. A value that is not a
 * collection is one object: read it with {@link objectGet}. The caller tells
 * the two apart by the value's type.
 *
 * A manifest above level 0, whose entries name other manifests rather than
 * segments, is refused before a segment is read. Only a newer e3 writes one,
 * and splicing its child manifests as segments would hand out bytes that are
 * no value.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param manifestHash - The hash of the collection's segment manifest
 * @param options - Request options including auth token
 * @returns The collection's bytes in order
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 * @throws {Error} When the manifest is above level 0
 */
export async function collectionGetStream(url: string, repo: string, manifestHash: string, options: RequestOptions): Promise<AsyncIterable<Uint8Array>> {
  const manifest = decodeCollectionManifest(await objectGet(url, repo, manifestHash, options));
  if (!integerEqual(manifest.level, 0n)) {
    throw new Error(`the collection ${manifestHash} is a level ${printInteger(manifest.level)} manifest, whose entries name manifests, not segments: ` +
      'a newer e3 wrote it, which this client does not read — update @elaraai/e3-api-client');
  }
  return (async function* () {
    const pending: Promise<Uint8Array>[] = [];
    let next = 0;
    const fill = (): void => {
      for (; next < manifest.entries.length && pending.length < SEGMENT_CONCURRENCY; next++) {
        const fetched = objectGet(url, repo, manifest.entries[next]!.hash, options);
        // A failure is raised when the splice reaches it, and must not be
        // reported unhandled before then.
        fetched.catch(() => { /* raised in order */ });
        pending.push(fetched);
      }
    };
    fill();
    const head = await objectGet(url, repo, manifest.header, options);
    yield* spliceBeast2Segments(head, (async function* () {
      while (pending.length > 0) {
        const segment = pending.shift()!;
        fill();
        yield await segment;
      }
    })());
  })();
}

/**
 * Get an object by its hash: its bytes, read through the objects route and
 * checked against the hash they were asked by.
 *
 * @remarks
 * A large object is answered with a URL, which is fetched without the API's
 * auth, since it may be presigned. A stored collection is many objects: read
 * it with {@link collectionGetStream}.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param hash - The object's hash
 * @param options - Request options including auth token
 * @returns The object's bytes
 * @throws {ApiError} On application-level errors, such as an object the
 *   repository does not hold
 * @throws {AuthError} On 401 Unauthorized
 * @throws {Error} When the bytes that arrive do not hash to `hash`
 */
export async function objectGet(url: string, repo: string, hash: string, options: RequestOptions): Promise<Uint8Array> {
  const response = await fetchWithAuth(`${url}/api/repos/${encodeURIComponent(repo)}/objects/${hash}`, {
    method: 'GET',
    headers: { 'Accept': BEAST2_CONTENT_TYPE },
  }, options);
  if (!response.ok) {
    throw parseErrorBody(await response.text(), `http_${response.status}`);
  }
  let bytes: Uint8Array;
  if ((response.headers.get('Content-Type') ?? '').includes('application/json')) {
    const { url: download } = await response.json() as { url: string };
    const downloaded = await fetchWithRetry(download, {
      method: 'GET',
      headers: { 'Accept': BEAST2_CONTENT_TYPE },
    }, { idempotent: true, retry: options.retry, fetch: options.fetch });
    if (!downloaded.ok) {
      throw new Error(`Failed to get object ${hash} (download): ${downloaded.status} ${downloaded.statusText}`);
    }
    bytes = new Uint8Array(await downloaded.arrayBuffer());
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const received = await computeHash(bytes);
  if (received !== hash) {
    throw new Error(`object ${hash} arrived as ${received}: the download was cut short or corrupted`);
  }
  return bytes;
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
 * @throws {DatasetHashMismatchError} When the window is pinned to a hash the
 *   dataset no longer holds; its `currentHash` names the one it does
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
    if (error.code === 'dataset_hash_mismatch') {
      throw new DatasetHashMismatchError(error.details, response.headers.get('X-Content-SHA256'));
    }
    throw error;
  }

  return parsePage(response);
}

/**
 * Read a page answer: its bytes, and its window as its `X-*` headers place it.
 *
 * @remarks
 * What {@link datasetGetPage} reads its answer with, and what a client of a
 * host's own route reads a page of a value it serves with, as e3-api-server's
 * `getValuePage` answers it.
 *
 * @param response - A successful page answer
 * @returns The page
 */
export async function parsePage(response: globalThis.Response): Promise<DatasetPage> {
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
 *  of the key's flattened field path, naming at least one end. Every form
 *  addresses one contiguous row range in the canonical key order. Pinned
 *  queries are immutable-cacheable (same URL ⇒ same answer); a stale pin is
 *  refused with an error rather than answered against different content.
 *
 *  `index` searches one of a record's secondary indexes instead of the
 *  record itself, so the rows the answer names are the index's — the same
 *  row space an index page serves. The key, prefix and fields forms then
 *  address the index key, the `keyType` the record's signature names, and an
 *  exact key matches every entry under it; a range bounds the index
 *  collection's flattened key, `ik`'s fields first. */
export type DatasetFindQuery = (
  | { key: string }
  | { prefix: string }
  | { fields: string[]; prefix?: string }
  | { from: string[]; to?: string[] }
  | { from?: string[]; to: string[] }
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
  /** Number of matched rows (1/0 for an exact key; through an index, every
   *  entry under it). */
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
 * @throws {DatasetHashMismatchError} When the query is pinned to a hash the
 *   dataset no longer holds; its `currentHash` names the one it does
 * @throws {ApiError} On application-level errors (non-keyed dataset,
 *   unparsable key literal, index-less blob)
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
    if (error.code === 'dataset_hash_mismatch') {
      throw new DatasetHashMismatchError(error.details, response.headers.get('X-Content-SHA256'));
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

/** What a transfer tells its caller as it goes. */
export interface DatasetTransferOptions {
  /** Called with how far the server's commit has taken the bytes in, each
   *  time a poll finds it still processing and saying so. */
  onCommitProgress?: (progress: IntakeFile) => void;
}

/**
 * Set a large dataset using the transfer flow (init → upload → commit).
 *
 * @remarks
 * The init answers `completed` (the object is stored already) or
 * `upload_parts` (the parts the server planned, each sent to the URL and with
 * the headers it names for that part, a few at a time). The commit may answer
 * `processing` while the server verifies the bytes and takes them in, and is
 * polled until it finishes.
 */
async function datasetSetTransfer(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  source: DatasetTransferSource,
  options: RequestOptions,
  transfer: DatasetTransferOptions = {},
): Promise<void> {
  const { hash } = source;
  const pathStr = path.map(p => encodeURIComponent(p.value)).join('/');
  const repoEncoded = encodeURIComponent(repo);
  const wsEncoded = encodeURIComponent(workspace);
  const uploadPath = `/repos/${repoEncoded}/workspaces/${wsEncoded}/datasets/${pathStr}/upload`;
  const protocol = `protocol=${TRANSFER_PROTOCOL_VERSION}&release=${encodeURIComponent(E3_RELEASE)}`;

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
  await putParts(url, `${uploadPath}/${init.value.id}`, Number(init.value.partBytes), source, options);

  // 3. Commit — server verifies hash + updates ref (BEAST2 response), and
  //    answers `processing`, with how far it has got, while that is still
  //    running
  let done = await commitRequest(`${url}/api${uploadPath}/${init.value.id}?${protocol}`, 'POST', options);
  for (let wait = COMMIT_POLL_MIN_MS; done.type === 'processing'; wait = Math.min(wait * 2, COMMIT_POLL_MAX_MS)) {
    if (done.value.type === 'some') transfer.onCommitProgress?.(done.value.value);
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
  }, { idempotent: true, retry: options.retry, fetch: options.fetch });

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
 * @param transfer - What to tell as it goes: how far the server's commit has
 *   taken the file in
 * @throws {ApiError} On application-level errors, including a type mismatch
 */
export async function datasetSetStream(
  url: string,
  repo: string,
  workspace: string,
  path: TreePath,
  source: DatasetTransferSource,
  options: RequestOptions,
  transfer: DatasetTransferOptions = {},
): Promise<void> {
  return datasetSetTransfer(url, repo, workspace, path, source, options, transfer);
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
