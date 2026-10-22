/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A dataset's reads in batches (#1351): several key searches of one
 * collection in one request (`findKeys`), the rows of several keys of a Dict
 * (the rows form), and the entries of several runs of a collection's rows (the
 * runs form) — each answered at one content hash, each reading every segment
 * it touches once, several at a time, through the decoded segments the API
 * process keeps.
 *
 * A batch is a POST — its queries, keys or runs travel in the body — so no
 * cache between keeps its answer: a client's own caches serve a batch asked
 * again.
 *
 * @packageDocumentation
 */

import { encodeBeast2For, fromEastTypeValue, none, parseFor, some, type EastTypeValue, type option } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, datasetRowsType, type TreePath } from '@elaraai/e3-types';
import type { DatasetSegments, StorageBackend } from '@elaraai/e3-core/portable';
import { sendJsonError } from '../errors.js';
import {
  PAGE_BYTE_BUDGET_DEFAULT, PAGE_MAX_LIMIT, cachedSegments, collectionOf, corruptRefusal, elementsOf, indexOf, openForRead,
  openTarget, pageError, readDataset, rowsByKey, searchTarget, type RowSpan,
} from './dataset-reads.js';
import { compileKeySearch, locateAll, type KeySearch, type KeySearchQuery, type Located } from './key-search.js';
import { comparators, decodedSegments, firstWhere } from './segments.js';

/** The most queries, keys or runs one batch read takes: 10,000, a page's cap. */
export const DATASET_BATCH_MAX = PAGE_MAX_LIMIT;

/** Several key searches of one collection, for {@link findDatasetKeys}. */
export interface DatasetFindKeysRequest {
  /** The searches, each in exactly one form, answered in this order. */
  queries: readonly KeySearchQuery[];
  /** Search one of a record's indexes, every query alike; the record's own
   *  keys when absent. */
  index?: string;
  /** The content hash the searches are pinned to; a stale one is refused with
   *  409. The content the dataset holds now when absent. */
  hash?: string;
}

/** One search's answer: as {@link findDatasetKey} answers it. */
export interface DatasetFindKeysResult {
  found: boolean;
  row: number;
  count: number;
}

/**
 * Answer several key searches of one collection in one request: each as
 * `findDatasetKey` answers it, in the order asked, at one content hash.
 *
 * @remarks
 * Every query's bounds are placed by a bisect of the manifest's fences, which
 * reads nothing; every segment a bound lands in is then read once for all of
 * them, several at a time, through the decoded segments the API process
 * keeps, and each bound's row is a binary search of its segment's keys. So a
 * window's searches decode its few segments, never a segment a search.
 *
 * Responds with JSON `{ results: [{ found, row, count }, …] }`. A batch of more
 * than {@link DATASET_BATCH_MAX} queries is refused, and so is any query a
 * single search would refuse, naming it by its place in the batch.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param workspace - Workspace name
 * @param treePath - The dataset's path
 * @param request - The queries, the index they search and the pin
 * @returns The answers, or a JSON refusal
 */
export async function findDatasetKeys(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  request: DatasetFindKeysRequest,
): Promise<Response> {
  try {
    if (request.queries.length > DATASET_BATCH_MAX) {
      return pageError('bad_request', `A batch of key searches takes at most ${DATASET_BATCH_MAX} queries; this one has ${request.queries.length}`);
    }
    const dataset = await readDataset(storage, repoPath, workspace, treePath, request.hash, 'key search');
    if (dataset instanceof Response) return dataset;
    const target = await searchTarget(storage, repoPath, workspace, treePath, dataset, request.index);
    if (target instanceof Response) return target;

    const searches: KeySearch[] = [];
    for (const [i, query] of request.queries.entries()) {
      const search = compileKeySearch(query, target);
      if ('type' in search) return pageError(search.type, `query ${i}: ${search.message}`);
      searches.push(search);
    }

    const segments = await openTarget(storage, repoPath, target);
    if (segments instanceof Response) return segments;

    let located: Located[];
    try {
      located = await locateAll(storage, repoPath, segments, searches.flatMap((search) => search.bounds));
    } catch (err) {
      return corruptRefusal(err, 'dataset_not_canonical');
    }
    const results: DatasetFindKeysResult[] = [];
    let at = 0;
    for (const search of searches) {
      results.push(search.answer(located.slice(at, at + search.bounds.length), segments.elementCount));
      at += search.bounds.length;
    }
    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-SHA256': dataset.hash,
      },
    });
  } catch (err) {
    return sendJsonError(err);
  }
}

/** The keys of a Dict whose rows a read asks for, for {@link getDatasetRows}. */
export interface DatasetRowsRequest {
  /** `.east` literals of the keys, answered in this order. */
  keys: readonly string[];
  /** The content hash the read is pinned to; a stale one is refused with 409. */
  hash?: string;
}

/** Server-side limits for the batch reads. */
export interface DatasetBatchLimits {
  /** The byte budget an answer's rows are clamped to (default
   *  {@link PAGE_BYTE_BUDGET_DEFAULT}). */
  byteBudget?: number;
}

/**
 * Read the rows a Dict holds under several keys in one request: each key's
 * row, or its absence, and its position in the Dict's canonical order, in the
 * order asked, as beast2 of `datasetRowsType(K, V)`.
 *
 * @remarks
 * Each key is placed in the segment that can hold it by a bisect of the
 * manifest's fences, which reads nothing, and every such segment is read once,
 * several at a time, through the decoded segments the API process keeps, and
 * searched by bisection. A position is the same row space a page's element
 * windows address: a key the Dict holds is at its row's, and one it does not
 * at the one it would take — what a search by the key answers.
 *
 * The answer is held to the page byte budget, by the Dict's average row size:
 * past it, the answer covers the keys it reached, in order, and says how many
 * (`X-Page-Count`); the client asks again for the rest. A batch of more than
 * {@link DATASET_BATCH_MAX} keys is refused, and so is a key that is not a
 * literal of the Dict's key type, naming it by its place.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param workspace - Workspace name
 * @param treePath - The dataset's path: a Dict, or a record
 * @param request - The keys and the pin
 * @param limits - The byte budget
 * @returns The rows, or a JSON refusal
 */
export async function getDatasetRows(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  request: DatasetRowsRequest,
  limits: DatasetBatchLimits = {},
): Promise<Response> {
  try {
    if (request.keys.length > DATASET_BATCH_MAX) {
      return pageError('bad_request', `A read of rows by key takes at most ${DATASET_BATCH_MAX} keys; this one has ${request.keys.length}`);
    }
    const dataset = await readDataset(storage, repoPath, workspace, treePath, request.hash, 'a read of rows by key');
    if (dataset instanceof Response) return dataset;
    if (dataset.typeValue.type !== 'Dict') {
      return pageError('dataset_not_searchable', `A read of rows by key addresses a Dict; this dataset holds ${dataset.typeValue.type}`);
    }
    const { key: keyType, value: rowType } = dataset.typeValue.value as { key: EastTypeValue; value: EastTypeValue };
    const parse = parseFor(keyType);
    const keys: unknown[] = [];
    for (const [i, literal] of request.keys.entries()) {
      const parsed = parse(literal);
      if (!parsed.success) return pageError('key_parse_error', `key ${i}: ${parsed.error}`);
      keys.push(parsed.value);
    }

    const segments = await openForRead(storage, repoPath, dataset.hash, dataset.size);
    if (segments instanceof Response) return segments;

    // The rows' share of the budget, by the Dict's average row size.
    const byteBudget = limits.byteBudget ?? PAGE_BYTE_BUDGET_DEFAULT;
    const avgBytes = segments.elementCount > 0 ? segments.bytes / segments.elementCount : 1;
    const limit = Math.min(keys.length, Math.max(1, Math.floor(byteBudget / Math.max(1, avgBytes))));
    const asked = keys.slice(0, limit);

    let answers: { key: unknown; row: option<unknown>; position: bigint }[];
    try {
      answers = await rowsAt(storage, repoPath, segments, asked, keyType);
    } catch (err) {
      return corruptRefusal(err, 'dataset_not_canonical');
    }

    const body = encodeBeast2For(datasetRowsType(fromEastTypeValue(keyType), fromEastTypeValue(rowType)))(answers);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': BEAST2_CONTENT_TYPE,
        'Cache-Control': 'no-store',
        'X-Content-SHA256': dataset.hash,
        'X-Total-Elements': String(segments.elementCount),
        'X-Page-Count': String(answers.length),
        'Content-Length': String(body.byteLength),
      },
    });
  } catch (err) {
    return sendJsonError(err);
  }
}

/** Each key's row, or its absence, and its position, from the segments that
 *  can hold the keys, each read once. */
async function rowsAt(
  storage: StorageBackend, repoPath: string, segments: DatasetSegments, keys: readonly unknown[], keyType: EastTypeValue,
): Promise<{ key: unknown; row: option<unknown>; position: bigint }[]> {
  if (segments.segmentCount === 0) return keys.map((key) => ({ key, row: none, position: 0n }));
  const cmp = comparators(keyType);
  const owners = await Promise.all(keys.map((key) => segments.segmentFor(key)));
  const decoded = await decodedSegments(storage, repoPath, segments, owners);
  return keys.map((key, i) => {
    const owner = owners[i]!;
    const segment = decoded.get(owner)!;
    const base = owner === 0 ? 0 : segments.cumulative[owner - 1]!;
    const at = firstWhere(segment.keys, (held) => cmp(held, key) >= 0);
    // A key past the segment's last sits where the next segment begins.
    if (at < segment.keys.length && cmp(segment.keys[at], key) === 0) {
      return { key: segment.keys[at], row: some(segment.values[at]), position: BigInt(base + at) };
    }
    return { key, row: none, position: BigInt(base + at) };
  });
}

/**
 * Why a batch's runs are not runs of a collection's rows, or `undefined` when
 * they are: each `[row, count]` a row at least 0 and a count at least 1,
 * ascending and disjoint, and each inside the collection.
 *
 * @param runs - The runs, as a batch names them
 * @param total - The collection's row count
 * @returns The refusal's words, naming the run by its place, or `undefined`
 */
export function runsRefusal(runs: readonly (readonly [number, number])[], total: number): string | undefined {
  let end = 0;
  for (const [i, [row, count]] of runs.entries()) {
    if (!Number.isSafeInteger(row) || !Number.isSafeInteger(count) || row < 0 || count < 1) {
      return `run ${i} is [${row}, ${count}]: a run is a row at least 0 and a count at least 1`;
    }
    if (row < end) return `run ${i} starts at row ${row}, before the run before it ends (${end}): runs are ascending and disjoint`;
    if (row + count > total) return `run ${i} ends at row ${row + count}, past the collection's ${total} rows`;
    end = row + count;
  }
  return undefined;
}

/** Several runs of a collection's rows, for {@link getDatasetRuns}. */
export interface DatasetRunsRequest {
  /** The runs, `[row, count]`: ascending, disjoint, each inside the
   *  collection, as a narrowing's resolved runs are. */
  runs: readonly (readonly [number, number])[];
  /** The content hash the runs are positions at. Required: a run means
   *  nothing at another state, so a stale one is refused with 409. */
  hash: string;
  /** The runs are rows of one of a record's indexes, read as an index page
   *  reads them; the dataset's own rows when absent. */
  index?: string;
  /** With {@link index}: fill each entry's `row` from the primary. */
  join?: boolean;
}

/**
 * Read the entries of several runs of a collection's rows in one request, in
 * order, as one window: of an index, the window an index page answers
 * (`Array<{ik, key, value, row}>`); of the dataset itself, a value of its own
 * type holding exactly the runs' rows.
 *
 * @remarks
 * The runs' rows are placed in their segments by the manifest's counts, which
 * reads nothing, and every segment they touch is read once, several at a time,
 * through the decoded segments the API process keeps; a joined read places
 * each row's key in its primary segment by the primary's fences, and reads
 * each such segment once.
 *
 * The answer is held to a page's bounds — {@link PAGE_MAX_LIMIT} entries, and
 * the page byte budget by the average entry (and, joined, row) size: past
 * them, it holds the entries it completed, in order, and says how many
 * (`X-Page-Count`) of how many the runs hold (`X-Run-Entries`). The client asks
 * again for the rest, the runs it named less the entries it has. Runs that are
 * not ascending, disjoint and inside the collection are refused, as are more
 * than {@link DATASET_BATCH_MAX} of them.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param workspace - Workspace name
 * @param treePath - The dataset's path
 * @param request - The runs, the pin, and the index read through
 * @param limits - The byte budget
 * @returns The window, or a JSON refusal
 */
export async function getDatasetRuns(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  request: DatasetRunsRequest,
  limits: DatasetBatchLimits = {},
): Promise<Response> {
  try {
    if (request.runs.length > DATASET_BATCH_MAX) {
      return pageError('bad_request', `A read of runs takes at most ${DATASET_BATCH_MAX} runs; this one has ${request.runs.length}`);
    }
    if (request.join === true && request.index === undefined) {
      return pageError('bad_request', 'join fills an index entry\'s row from the record: name the index the runs are rows of');
    }
    const dataset = await readDataset(storage, repoPath, workspace, treePath, request.hash, 'a read of runs');
    if (dataset instanceof Response) return dataset;
    const kind = dataset.typeValue.type;
    if (kind !== 'Array' && kind !== 'Set' && kind !== 'Dict') {
      return pageError('dataset_not_pageable', `Paged reads address Array, Set or Dict datasets; this dataset holds ${kind}`);
    }

    const resolved = request.index === undefined ? undefined
      : await indexOf(storage, repoPath, workspace, treePath, dataset.hash, request.index);
    if (resolved instanceof Response) return resolved;
    const collection = resolved === undefined
      ? await openForRead(storage, repoPath, dataset.hash, dataset.size)
      : await cachedSegments(storage, repoPath, resolved.manifest, (await storage.objects.stat(repoPath, resolved.manifest)).size);
    if (collection instanceof Response) return collection;
    const primary = resolved !== undefined && request.join === true
      ? await cachedSegments(storage, repoPath, resolved.primary, (await storage.objects.stat(repoPath, resolved.primary)).size)
      : null;

    const total = collection.elementCount;
    const refused = runsRefusal(request.runs, total);
    if (refused !== undefined) return pageError('bad_request', refused);
    const entries = request.runs.reduce((sum, [, count]) => sum + count, 0);

    // A page's bounds: the entries' share of the budget by their average
    // size, and a joined read's by the record's rows' too.
    const byteBudget = limits.byteBudget ?? PAGE_BYTE_BUDGET_DEFAULT;
    const perEntry = (primary !== null && primary.elementCount > 0 ? primary.bytes / primary.elementCount : 0)
      + (total > 0 ? collection.bytes / total : 1);
    const limit = Math.max(1, Math.min(PAGE_MAX_LIMIT, Math.floor(byteBudget / Math.max(1, perEntry))));
    const spans: RowSpan[] = [];
    let room = limit;
    for (const [row, count] of request.runs) {
      if (room === 0) break;
      const taken = Math.min(count, room);
      spans.push({ from: row, to: row + taken });
      room -= taken;
    }

    let windowValue: unknown;
    let answered: number;
    let windowType: EastTypeValue;
    try {
      const elements = await elementsOf(storage, repoPath, collection, spans);
      answered = elements.length;
      if (resolved === undefined) {
        windowValue = collectionOf(dataset.typeValue, elements);
        windowType = dataset.typeValue;
      } else {
        const pairs = elements as [{ ik: unknown; k: unknown }, unknown][];
        const rows = primary !== null
          ? await rowsByKey(storage, repoPath, primary, pairs.map(([entry]) => entry.k))
          : pairs.map((): option<unknown> => none);
        windowValue = pairs.map(([entry, value], i) => ({ ik: entry.ik, key: entry.k, value, row: rows[i]! }));
        windowType = resolved.windowType;
      }
    } catch (err) {
      return corruptRefusal(err, 'dataset_not_canonical');
    }

    const body = encodeBeast2For(windowType)(windowValue);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': BEAST2_CONTENT_TYPE,
        'Cache-Control': 'no-store',
        'X-Content-SHA256': dataset.hash,
        'X-Total-Elements': String(total),
        'X-Page-Count': String(answered),
        'X-Run-Entries': String(entries),
        ...(request.index !== undefined && { 'X-Window-Index': request.index }),
        ...(request.join === true && { 'X-Window-Joined': 'true' }),
        'Content-Length': String(body.byteLength),
      },
    });
  } catch (err) {
    return sendJsonError(err);
  }
}
