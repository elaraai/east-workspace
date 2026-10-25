/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Where a narrowing's rows sit in a record (#1349), from the narrowing's runs
 * of one of the record's indexes, as a record Slice resolves them:
 *
 * - `place`: how many of the runs' entries each record segment holds — read
 *   from the index's own segments, each entry's row placed in its record
 *   segment by the record's fences, which its manifest carries, so no record
 *   segment is read;
 * - `within`: which of some index entries the runs hold — each run a stretch
 *   of the index's rows, so an entry is in it when it falls between the run's
 *   first and last entries in the index's order, and only those boundary
 *   entries are read, at most two index segments a run;
 * - `near`: the record's rows within a distance of the runs' rows, in the
 *   record's order — each entry's row found in its record segment, which is
 *   read — as spans a window of the runs at a time: what the Sheet's lens
 *   counts its context rows by.
 *
 * None evaluates anything over a row: the index holds what its maintained key
 * functions emitted, and every read uses only that and the record's own order.
 * Each reads every segment it touches once, through the decoded segments the
 * API process keeps.
 *
 * @packageDocumentation
 */

import { parseFor, segmentKeyTypeOf, type EastTypeValue } from '@elaraai/east';
import type { TreePath } from '@elaraai/e3-types';
import type { DatasetSegments, StorageBackend } from '@elaraai/e3-core/portable';
import { sendJsonError } from '../errors.js';
import { DATASET_BATCH_MAX, rowsAt, runsRefusal, type DatasetBatchLimits } from './dataset-batches.js';
import {
  PAGE_BYTE_BUDGET_DEFAULT, PAGE_MAX_LIMIT, cachedSegments, corruptRefusal, elementsOf, indexOf, pageError, readDataset, type RowSpan,
} from './dataset-reads.js';
import { SegmentCorruptError, comparators } from './segments.js';

/** What a placement places, for {@link placeDatasetRuns}. */
export interface DatasetPlaceRequest {
  /** The index the runs are rows of. */
  index: string;
  /** The narrowing's runs of the index's rows, `[row, count]`: ascending,
   *  disjoint, each inside the index — at most {@link DATASET_BATCH_MAX}. */
  runs: readonly (readonly [number, number])[];
  /** The runs' first entry the placement places, counting through them as one
   *  sequence (0 when absent). */
  offset?: number;
  /** How many of the runs' entries it places at most; a page's bounds clamp it. */
  limit?: number;
  /** The record's content hash the runs are positions at: a stale one is
   *  refused with 409. */
  hash: string;
}

/** A record segment a placement's entries fall in. */
export interface DatasetPlacedSegment {
  /** The segment's number in the record's manifest. */
  segment: number;
  /** Its first row in the record's order. */
  offset: number;
  /** How many rows it holds. */
  count: number;
  /** How many of the placement's entries it holds. */
  rows: number;
}

/**
 * Place a window of a narrowing's runs in a record: how many of the window's
 * entries each record segment holds.
 *
 * @remarks
 * The window's entries are read from the index's own segments, with no join,
 * as a covering index page reads them, and each entry's row — its primary key,
 * `k` — is placed in the record segment that holds it by a bisect of the
 * record's fences, which come with its manifest: no record segment is read.
 *
 * The window is a page's at most: {@link PAGE_MAX_LIMIT} entries, and the page
 * byte budget by the index's average entry. Responds with JSON
 * `{ segments: [{ segment, offset, count, rows }], placed }`, the segments in
 * the record's order and only those that hold some of the window's entries,
 * `placed` how many entries it places: the caller asks again from `offset +
 * placed`. A record Slice's runs name each row once, so a segment's rows over
 * every window add up to the narrowing's rows in it.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param workspace - Workspace name
 * @param treePath - The record's path
 * @param request - The index, its runs, the window and the pin
 * @param limits - The byte budget
 * @returns The placement, or a JSON refusal
 */
export async function placeDatasetRuns(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  request: DatasetPlaceRequest,
  limits: DatasetBatchLimits = {},
): Promise<Response> {
  try {
    if (request.runs.length > DATASET_BATCH_MAX) {
      return pageError('bad_request', `A placement takes at most ${DATASET_BATCH_MAX} runs; this one has ${request.runs.length}`);
    }
    const offset = request.offset ?? 0;
    const limit = request.limit ?? PAGE_MAX_LIMIT;
    if (!Number.isSafeInteger(offset) || offset < 0) return pageError('bad_request', `offset ${offset} is not a row at least 0`);
    if (!Number.isSafeInteger(limit) || limit < 0) return pageError('bad_request', `limit ${limit} is not a count at least 0`);
    const opened = await openIndexed(storage, repoPath, workspace, treePath, request.index, request.hash, 'a placement of runs');
    if (opened instanceof Response) return opened;
    const { hash, index, primary } = opened;
    const refused = runsRefusal(request.runs, index.elementCount);
    if (refused !== undefined) return pageError('bad_request', refused);
    const entries = request.runs.reduce((sum, [, count]) => sum + count, 0);
    const placed = Math.max(0, Math.min(limit, windowBound(index, limits), entries - offset));

    let segments: DatasetPlacedSegment[];
    try {
      const pairs = await elementsOf(storage, repoPath, index, windowSpans(request.runs, offset, placed)) as [{ k: unknown }, unknown][];
      const owner = await segmentOfKey(primary);
      const held = new Map<number, number>();
      for (const [entry] of pairs) {
        const segment = owner(entry.k);
        held.set(segment, (held.get(segment) ?? 0) + 1);
      }
      segments = [...held].sort((a, b) => a[0] - b[0]).map(([segment, rows]) => ({
        segment,
        offset: segment === 0 ? 0 : primary.cumulative[segment - 1]!,
        count: primary.counts[segment]!,
        rows,
      }));
    } catch (err) {
      return corruptRefusal(err, 'dataset_not_canonical');
    }
    return new Response(JSON.stringify({ segments, placed }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-SHA256': hash,
        'X-Total-Elements': String(primary.elementCount),
        'X-Run-Entries': String(entries),
      },
    });
  } catch (err) {
    return sendJsonError(err);
  }
}

/** What a membership read asks, for {@link withinDatasetRuns}. */
export interface DatasetWithinRequest {
  /** The index the runs are rows of. */
  index: string;
  /** The narrowing's runs of the index's rows, `[row, count]`: ascending,
   *  disjoint, each inside the index — at most {@link DATASET_BATCH_MAX}. */
  runs: readonly (readonly [number, number])[];
  /** `.east` literals of index entries' keys, `(ik=…, k=…)` — each row's
   *  maintained index key beside its primary key — answered in this order: at
   *  most {@link DATASET_BATCH_MAX}. */
  keys: readonly string[];
  /** The record's content hash the runs are positions at: a stale one is
   *  refused with 409. */
  hash: string;
}

/**
 * Answer which of some index entries a narrowing's runs hold: for each entry
 * key, whether it lies in one of the runs.
 *
 * @remarks
 * Each run is a contiguous stretch of the index's rows, so an entry lies in it
 * when it falls between the run's first and last entries in the index's
 * order. Only those boundary entries are read — at most two index segments a
 * run — and every key is placed among them by the index entry key's
 * comparator: nothing else is decoded, and nothing is evaluated over a row. A
 * row is in the narrowing when any of its entries is.
 *
 * Responds with JSON `{ within: [boolean, …] }`, one a key, in order. More than
 * {@link DATASET_BATCH_MAX} keys or runs, runs that are not ascending, disjoint
 * and inside the index, and a key that is not a literal of the index's entry
 * key type are refused, naming what is wrong.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param workspace - Workspace name
 * @param treePath - The record's path
 * @param request - The index, its runs, the entry keys and the pin
 * @returns The answers, or a JSON refusal
 */
export async function withinDatasetRuns(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  request: DatasetWithinRequest,
): Promise<Response> {
  try {
    if (request.runs.length > DATASET_BATCH_MAX) {
      return pageError('bad_request', `A membership read takes at most ${DATASET_BATCH_MAX} runs; this one has ${request.runs.length}`);
    }
    if (request.keys.length > DATASET_BATCH_MAX) {
      return pageError('bad_request', `A membership read takes at most ${DATASET_BATCH_MAX} keys; this one has ${request.keys.length}`);
    }
    const opened = await openIndexed(storage, repoPath, workspace, treePath, request.index, request.hash, 'a membership read');
    if (opened instanceof Response) return opened;
    const { hash, index, entryKeyType } = opened;
    const refused = runsRefusal(request.runs, index.elementCount);
    if (refused !== undefined) return pageError('bad_request', refused);
    const parse = parseFor(entryKeyType);
    const keys: unknown[] = [];
    for (const [i, literal] of request.keys.entries()) {
      const parsed = parse(literal);
      if (!parsed.success) return pageError('key_parse_error', `key ${i}: ${parsed.error}`);
      keys.push(parsed.value);
    }

    let within: boolean[];
    try {
      // Each run's first and last entries, every segment they lie in read once.
      const spans: RowSpan[] = request.runs.flatMap(([row, count]) =>
        count === 1 ? [{ from: row, to: row + 1 }] : [{ from: row, to: row + 1 }, { from: row + count - 1, to: row + count }]);
      const bounds = (await elementsOf(storage, repoPath, index, spans) as [unknown, unknown][]).map(([key]) => key);
      const firsts: unknown[] = [];
      const lasts: unknown[] = [];
      let at = 0;
      for (const [, count] of request.runs) {
        firsts.push(bounds[at]);
        lasts.push(bounds[count === 1 ? at : at + 1]);
        at += count === 1 ? 1 : 2;
      }
      const cmp = comparators(entryKeyType);
      within = keys.map((key) => {
        // The last run starting at or before the key, then whether it reaches it.
        let lo = 0;
        let hi = firsts.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cmp(firsts[mid], key) <= 0) lo = mid + 1;
          else hi = mid;
        }
        return lo > 0 && cmp(key, lasts[lo - 1]) <= 0;
      });
    } catch (err) {
      return corruptRefusal(err, 'dataset_not_canonical');
    }
    return new Response(JSON.stringify({ within }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-SHA256': hash,
      },
    });
  } catch (err) {
    return sendJsonError(err);
  }
}

/** What a read of the rows near a narrowing's rows asks, for {@link nearDatasetRuns}. */
export interface DatasetNearRequest {
  /** The index the runs are rows of. */
  index: string;
  /** The narrowing's runs of the index's rows, `[row, count]`: ascending,
   *  disjoint, each inside the index — at most {@link DATASET_BATCH_MAX}. */
  runs: readonly (readonly [number, number])[];
  /** How many of the record's rows either side of a row, in its order, are
   *  near it: a whole number at least 1. */
  distance: number;
  /** The runs' first entry the read reads, counting through them as one
   *  sequence (0 when absent). */
  offset?: number;
  /** How many of the runs' entries it reads at most; its bounds clamp it. */
  limit?: number;
  /** The record's content hash the runs are positions at: a stale one is
   *  refused with 409. */
  hash: string;
}

/**
 * The record's rows near a window of a narrowing's rows: each of the window's
 * entries' rows, and the `distance` rows either side of it in the record's
 * order, as half-open spans of the record's rows.
 *
 * @remarks
 * The window's entries are read from the index's own segments, as a placement
 * reads them, and each entry's row — its primary key, `k` — is found in the
 * record: placed in the record segment that holds it by the record's fences,
 * and found among that segment's keys, each such segment read once through
 * the decoded segments the API process keeps. Each row reaches `distance`
 * rows either side, clipped to the record, and the reaches are merged, so the
 * answer's spans are ascending, disjoint and never touching. Nothing is
 * evaluated over a row.
 *
 * The window is a page's at most, as a placement's is, and it stops before an
 * entry whose record segment would take the record segments it reads past the
 * segment budget, by their stored bytes — the page byte budget unless the
 * limits name their own, and the first entry's segment always read — so a
 * narrowing whose rows are spread thin over a large record is read a bounded
 * number of segments a request. Responds with JSON `{ spans: [[from,
 * to], …], placed }`, `placed` how many of the runs' entries the window read:
 * the caller asks again from `offset + placed`. A record Slice's runs name
 * each row once, so the union of every window's spans holds the narrowing's
 * own rows and those near them: its size less the runs' entries is how many
 * rows lie near the narrowing's and are none of them — the Sheet's lens's
 * context rows.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param workspace - Workspace name
 * @param treePath - The record's path
 * @param request - The index, its runs, the distance, the window and the pin
 * @param limits - The byte budget, and the segment budget
 * @returns The spans, or a JSON refusal
 */
export async function nearDatasetRuns(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  treePath: TreePath,
  request: DatasetNearRequest,
  limits: DatasetBatchLimits = {},
): Promise<Response> {
  try {
    if (request.runs.length > DATASET_BATCH_MAX) {
      return pageError('bad_request', `A read of nearby rows takes at most ${DATASET_BATCH_MAX} runs; this one has ${request.runs.length}`);
    }
    if (!Number.isSafeInteger(request.distance) || request.distance < 1) {
      return pageError('bad_request', `distance ${request.distance} is not a whole number of rows at least 1`);
    }
    const offset = request.offset ?? 0;
    const limit = request.limit ?? PAGE_MAX_LIMIT;
    if (!Number.isSafeInteger(offset) || offset < 0) return pageError('bad_request', `offset ${offset} is not a row at least 0`);
    if (!Number.isSafeInteger(limit) || limit < 0) return pageError('bad_request', `limit ${limit} is not a count at least 0`);
    const opened = await openIndexed(storage, repoPath, workspace, treePath, request.index, request.hash, 'a read of nearby rows');
    if (opened instanceof Response) return opened;
    const { hash, index, primary } = opened;
    const refused = runsRefusal(request.runs, index.elementCount);
    if (refused !== undefined) return pageError('bad_request', refused);
    const entries = request.runs.reduce((sum, [, count]) => sum + count, 0);
    const read = Math.max(0, Math.min(limit, windowBound(index, limits), entries - offset));

    let spans: [number, number][];
    let placed: number;
    try {
      const window = windowSpans(request.runs, offset, read);
      const pairs = await elementsOf(storage, repoPath, index, window) as [{ k: unknown }, unknown][];
      const segmentBudget = limits.segmentBudget ?? limits.byteBudget ?? PAGE_BYTE_BUDGET_DEFAULT;
      const rows = await rowsOfEntries(storage, repoPath, primary, pairs.map(([entry]) => entry.k), segmentBudget,
        (i) => `row ${entryRow(window, i)} of index '${request.index}'`);
      spans = reach(rows, request.distance, primary.elementCount);
      placed = rows.length;
    } catch (err) {
      return corruptRefusal(err, 'dataset_not_canonical');
    }
    return new Response(JSON.stringify({ spans, placed }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-SHA256': hash,
        'X-Total-Elements': String(primary.elementCount),
        'X-Run-Entries': String(entries),
      },
    });
  } catch (err) {
    return sendJsonError(err);
  }
}

/** A record's index opened for a read of where its rows sit. */
interface Indexed {
  /** The record's content hash. */
  hash: string;
  /** The index's collection, `Dict<{ik, k}, P>`. */
  index: DatasetSegments;
  /** The record's own collection, its primary. */
  primary: DatasetSegments;
  /** The index's entry key type, `{ik, k}`. */
  entryKeyType: EastTypeValue;
}

/** The record, the index and its primary a read names, opened; or the refusal of a pin, a path or an index. */
async function openIndexed(
  storage: StorageBackend, repoPath: string, workspace: string, treePath: TreePath, name: string, hash: string, what: string,
): Promise<Indexed | Response> {
  const dataset = await readDataset(storage, repoPath, workspace, treePath, hash, what);
  if (dataset instanceof Response) return dataset;
  const resolved = await indexOf(storage, repoPath, workspace, treePath, dataset.hash, name);
  if (resolved instanceof Response) return resolved;
  const index = await cachedSegments(storage, repoPath, resolved.manifest, (await storage.objects.stat(repoPath, resolved.manifest)).size);
  const primary = await cachedSegments(storage, repoPath, resolved.primary, (await storage.objects.stat(repoPath, resolved.primary)).size);
  const entryKeyType = segmentKeyTypeOf(resolved.collectionType)!;
  return { hash: dataset.hash, index, primary, entryKeyType };
}

/**
 * The most entries a window of a narrowing's runs holds: a covering index
 * page's bounds — the hard cap, and the byte budget by the index's average
 * entry.
 */
function windowBound(index: DatasetSegments, limits: DatasetBatchLimits): number {
  const byteBudget = limits.byteBudget ?? PAGE_BYTE_BUDGET_DEFAULT;
  const perEntry = index.elementCount > 0 ? index.bytes / index.elementCount : 1;
  return Math.max(1, Math.min(PAGE_MAX_LIMIT, Math.floor(byteBudget / Math.max(1, perEntry))));
}

/**
 * Each index entry's row in its record — its place in the record's order — for
 * the entries' keys in order, as far as the record segments they fall in stay
 * within a byte budget by their stored bytes: the keys are taken until the
 * next would bring in a segment past it, the first key's segment always.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param primary - The record's own collection
 * @param keys - The entries' primary keys, in the index's order
 * @param byteBudget - The stored bytes of the record segments read, at most
 * @param entryAt - Names the `i`th entry, as a refusal names it
 * @returns The rows of the keys taken: as many as the budget reaches, in order
 * @throws {SegmentCorruptError} When a key is none of the record's: the index names a row its record does not hold
 */
async function rowsOfEntries(
  storage: StorageBackend, repo: string, primary: DatasetSegments, keys: readonly unknown[], byteBudget: number, entryAt: (i: number) => string,
): Promise<number[]> {
  const segments = new Set<number>();
  let bytes = 0;
  let taken = 0;
  for (const key of keys) {
    const owner = await primary.segmentFor(key);
    if (!segments.has(owner)) {
      const more = primary.segmentBytes(owner);
      if (segments.size > 0 && bytes + more > byteBudget) break;
      segments.add(owner);
      bytes += more;
    }
    taken++;
  }
  const found = await rowsAt(storage, repo, primary, keys.slice(0, taken), segmentKeyTypeOf(primary.typeValue)!);
  return found.map((answer, i) => {
    if (answer.row.type !== 'some') {
      throw new SegmentCorruptError(`${entryAt(i)} names a row its record does not hold — the index and its record disagree`);
    }
    return Number(answer.position);
  });
}

/**
 * What some rows reach: each row and the `distance` rows either side of it,
 * clipped to the record's `[0, records)`, merged — half-open spans, ascending,
 * disjoint and never touching.
 *
 * @param rows - The rows, in any order
 * @param distance - How far each reaches either side
 * @param records - The record's row count
 * @returns The spans, `[from, to)`
 */
function reach(rows: readonly number[], distance: number, records: number): [number, number][] {
  const spans: [number, number][] = [];
  for (const row of Float64Array.from(rows).sort()) {
    const from = Math.max(0, row - distance);
    const to = Math.min(records, row + distance + 1);
    const last = spans[spans.length - 1];
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to);
    else spans.push([from, to]);
  }
  return spans;
}

/**
 * A window of runs as spans of their rows: the runs' entries `[offset,
 * offset + count)`, counting through them as one sequence.
 */
function windowSpans(runs: readonly (readonly [number, number])[], offset: number, count: number): RowSpan[] {
  const spans: RowSpan[] = [];
  let skip = offset;
  let remaining = count;
  for (const [row, length] of runs) {
    if (remaining === 0) break;
    if (skip >= length) { skip -= length; continue; }
    const taken = Math.min(length - skip, remaining);
    spans.push({ from: row + skip, to: row + skip + taken });
    remaining -= taken;
    skip = 0;
  }
  return spans;
}

/** The index's row of a window's `i`th entry, the window's spans as {@link windowSpans} gives them. */
function entryRow(window: readonly RowSpan[], i: number): number {
  let skip = i;
  for (const { from, to } of window) {
    if (skip < to - from) return from + skip;
    skip -= to - from;
  }
  throw new Error(`entry ${i} lies past a window of ${i - skip} entries`);
}

/**
 * The segment of a record that holds each key: a bisect of the record's fences,
 * which its manifest carries, so nothing is read. The greatest segment whose
 * fence is at most the key; segments are disjoint ascending ranges.
 */
async function segmentOfKey(primary: DatasetSegments): Promise<(key: unknown) => number> {
  const cmp = comparators(segmentKeyTypeOf(primary.typeValue)!);
  const fences = await Promise.all(Array.from({ length: primary.segmentCount }, (_, i) => primary.fence(i)));
  return (key) => {
    let lo = 0;
    let hi = fences.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cmp(fences[mid], key) <= 0) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}
