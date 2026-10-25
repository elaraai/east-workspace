/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { parseKeypath, urlPathToTreePath, type TreePath } from '@elaraai/e3-types';
import type { StorageBackend, TransferBackend } from '@elaraai/e3-core/portable';
import {
  listDatasets,
  listDatasetsRecursive,
  listDatasetsRecursivePaths,
  listDatasetsWithStatus,
  findDatasetKey,
  getDataset,
  getDatasetPage,
  getDatasetStatus,
  setDataset,
  type PinnedCache,
} from '../handlers/datasets.js';
import { findDatasetKeys, getDatasetRows, getDatasetRuns, type DatasetRowsKeysOf } from '../handlers/dataset-batches.js';
import { nearDatasetRuns, placeDatasetRuns, withinDatasetRuns } from '../handlers/dataset-place.js';
import type { KeySearchQuery } from '../handlers/key-search.js';
import { pageError } from '../handlers/dataset-reads.js';
import { datasetPathOf } from './dataset-path.js';

/** Options for {@link createDatasetRoutes}. */
export interface DatasetRouteOptions {
  /** Byte budget clamping each page's share of the source blob. Defaults to
   *  4 MiB; deployments with tighter response limits (e.g. Lambda proxy's
   *  6 MB, base64-inflated) pass a smaller budget. */
  pageByteBudget?: number;
  /** Who may keep a hash-pinned page or key search, which never changes:
   *  `private`, the caller's own cache alone (the default), or `public`, any
   *  cache between it and the server as well, for a host whose data any
   *  caller may read. */
  cache?: PinnedCache;
}

/** Parses an integer query param; `undefined` when absent, `NaN` when
 *  malformed (the handler rejects NaN with a 400). */
function intParam(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  return Number(value);
}

/** How a read of nearby rows names itself in its refusals. */
const NEAR_READ = 'A read of nearby rows';

export function createDatasetRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend?: TransferBackend,
  options?: DatasetRouteOptions,
) {
  const app = new Hono();

  // GET /api/repos/:repo/workspaces/:ws/datasets - List root fields
  app.get('/', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;

    const list = c.req.query('list') === 'true';
    const recursive = c.req.query('recursive') === 'true';
    const status = c.req.query('status') === 'true';

    if (recursive && !list) {
      return c.json({ error: 'recursive requires list=true' }, 400);
    }

    if (list && recursive && status) return listDatasetsRecursive(storage, repoPath, ws, []);
    if (list && recursive)           return listDatasetsRecursivePaths(storage, repoPath, ws, []);
    if (list && status)              return listDatasetsWithStatus(storage, repoPath, ws, []);

    return listDatasets(storage, repoPath, ws, []);
  });

  // GET /api/repos/:repo/workspaces/:ws/datasets/* - Orthogonal query params
  app.get('/*', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    const treePath = urlPathToTreePath(datasetPathOf(c));

    const list = c.req.query('list') === 'true';
    const recursive = c.req.query('recursive') === 'true';
    const status = c.req.query('status') === 'true';
    const page = c.req.query('page') === 'true';
    const find = c.req.query('find') === 'true';

    if (recursive && !list) {
      return c.json({ error: 'recursive requires list=true' }, 400);
    }

    if (list && recursive && status) return listDatasetsRecursive(storage, repoPath, ws, treePath);
    if (list && recursive)           return listDatasetsRecursivePaths(storage, repoPath, ws, treePath);
    if (list && status)              return listDatasetsWithStatus(storage, repoPath, ws, treePath);
    if (list)                        return listDatasets(storage, repoPath, ws, treePath);
    if (status)                      return getDatasetStatus(storage, repoPath, ws, treePath);
    if (find) {
      const hash = c.req.query('hash');
      const key = c.req.query('key');
      const prefix = c.req.query('prefix');
      const fields = c.req.queries('field');
      // `from` / `to` repeat, as `field` does: each is one `.east` literal of
      // a leading prefix of the flattened key.
      const from = c.req.queries('from');
      const to = c.req.queries('to');
      const index = c.req.query('index');
      return findDatasetKey(storage, repoPath, ws, treePath, {
        ...(key !== undefined && { key }),
        ...(prefix !== undefined && { prefix }),
        ...(fields !== undefined && fields.length > 0 && { fields }),
        ...(from !== undefined && from.length > 0 && { from }),
        ...(to !== undefined && to.length > 0 && { to }),
        ...(index !== undefined && index !== '' && { index }),
        ...(hash !== undefined && hash !== '' && { hash }),
      }, { ...(options?.cache !== undefined && { cache: options.cache }) });
    }
    if (page) {
      const hash = c.req.query('hash');
      const window = {
        ...(intParam(c.req.query('offset')) !== undefined && { offset: intParam(c.req.query('offset'))! }),
        ...(intParam(c.req.query('limit')) !== undefined && { limit: intParam(c.req.query('limit'))! }),
        ...(intParam(c.req.query('segment')) !== undefined && { segment: intParam(c.req.query('segment'))! }),
        ...(c.req.query('index') !== undefined && c.req.query('index') !== '' && { index: c.req.query('index')! }),
        ...(c.req.query('join') === 'true' && { join: true }),
        ...(hash !== undefined && hash !== '' && { hash }),
      };
      return getDatasetPage(storage, repoPath, ws, treePath, window, {
        ...(options?.pageByteBudget !== undefined && { byteBudget: options.pageByteBudget }),
        ...(options?.cache !== undefined && { cache: options.cache }),
      });
    }

    // `segments=true`: a collection held as a segment manifest is answered
    // with its manifest's hash, for a client that downloads the segments.
    return getDataset(storage, repoPath, ws, treePath, repo, c.req.url, transferBackend, c.req.query('segments') === 'true');
  });

  // POST /api/repos/:repo/workspaces/:ws/datasets/* - A dataset's reads in
  // batches, their queries, keys or runs in a JSON body: several key searches
  // (`findKeys=true`), the rows of several keys — or of the keys some runs of a
  // record's index name (`rows=true`) — the entries of several runs
  // (`runs=true`), and where a narrowing's runs of an index sit in its record
  // (`place=true`), which entries they hold (`within=true`) and the record's
  // rows near theirs (`near=true`). Any other POST is no route of these.
  app.post('/*', async (c, next) => {
    const findKeys = c.req.query('findKeys') === 'true';
    const rows = c.req.query('rows') === 'true';
    const runs = c.req.query('runs') === 'true';
    const place = c.req.query('place') === 'true';
    const within = c.req.query('within') === 'true';
    const near = c.req.query('near') === 'true';
    const asked = [findKeys, rows, runs, place, within, near].filter(Boolean).length;
    if (asked !== 1) {
      if (asked === 0) return next();
      return pageError('bad_request', 'Ask for one batch: findKeys=true, rows=true, runs=true, place=true, within=true or near=true');
    }
    const repoPath = getRepoPath(c.req.param('repo')!);
    const ws = c.req.param('ws')!;
    const treePath = urlPathToTreePath(datasetPathOf(c));
    const hash = nonEmpty(c.req.query('hash'));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch (err) {
      return pageError('bad_request', `The body is not JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    const limits = { ...(options?.pageByteBudget !== undefined && { byteBudget: options.pageByteBudget }) };
    if (findKeys) {
      const queries = queriesOf(body);
      if ('refusal' in queries) return pageError('bad_request', queries.refusal);
      const index = nonEmpty(c.req.query('index'));
      return findDatasetKeys(storage, repoPath, ws, treePath, {
        queries,
        ...(index !== undefined && { index }),
        ...(hash !== undefined && { hash }),
      });
    }
    if (rows) {
      const asked = rowsOf(body);
      if ('refusal' in asked) return pageError('bad_request', asked.refusal);
      return getDatasetRows(storage, repoPath, ws, treePath, { ...asked, ...(hash !== undefined && { hash }) }, limits);
    }
    if (hash === undefined) {
      const what = place ? 'A placement' : within ? 'A membership read' : near ? NEAR_READ : 'A read of runs';
      return pageError('bad_request', `${what} names the content hash its runs are positions at: hash=<state>`);
    }
    if (place || within || near) {
      const what = place ? 'A placement' : within ? 'A membership read' : NEAR_READ;
      const index = (body as { index?: unknown } | null)?.index;
      if (typeof index !== 'string' || index === '') {
        return pageError('bad_request', `${what} names the index its runs are rows of: { "index": "<name>", … }`);
      }
      const indexRuns = runsOf(body);
      if ('refusal' in indexRuns) return pageError('bad_request', indexRuns.refusal);
      if (within) {
        const keys = stringsOf(body, 'keys');
        if ('refusal' in keys) return pageError('bad_request', 'A membership read is { "index": "<name>", "runs": [[row, count], …], "keys": [ "<.east literal>", … ] }');
        return withinDatasetRuns(storage, repoPath, ws, treePath, { index, runs: indexRuns, keys, hash });
      }
      const window = windowOf(body, place ? { whose: 'A placement\'s', does: 'places' } : { whose: `${NEAR_READ}'`, does: 'reads' });
      if ('refusal' in window) return pageError('bad_request', window.refusal);
      if (near) {
        const distance = (body as { distance?: unknown } | null)?.distance;
        if (typeof distance !== 'number') {
          return pageError('bad_request', `${NEAR_READ} names how near: { "index": "<name>", "runs": [[row, count], …], "distance": <rows>, … }`);
        }
        return nearDatasetRuns(storage, repoPath, ws, treePath, { index, runs: indexRuns, distance, ...window, hash }, limits);
      }
      return placeDatasetRuns(storage, repoPath, ws, treePath, { index, runs: indexRuns, ...window, hash }, limits);
    }
    const spans = runsOf(body);
    if ('refusal' in spans) return pageError('bad_request', spans.refusal);
    const index = nonEmpty(c.req.query('index'));
    return getDatasetRuns(storage, repoPath, ws, treePath, {
      runs: spans,
      hash,
      ...(index !== undefined && { index }),
      ...(c.req.query('join') === 'true' && { join: true }),
    }, limits);
  });

  // PUT /api/repos/:repo/workspaces/:ws/datasets/* - Set dataset value
  app.put('/*', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;
    const treePath = urlPathToTreePath(datasetPathOf(c));

    // Body is raw BEAST2, read as it arrives.
    return setDataset(storage, repoPath, ws, treePath, bodyChunks(c.req.raw.body));
  });

  return app;
}

/**
 * A request body's chunks, as they arrive. A reader that stops early — a
 * refused upload — cancels the body, so the connection is not left holding it.
 */
async function* bodyChunks(body: ReadableStream<Uint8Array> | null): AsyncGenerator<Uint8Array> {
  if (body === null) return;
  const reader = body.getReader();
  let done = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        return;
      }
      yield next.value;
    }
  } finally {
    if (!done) await reader.cancel().catch(() => { /* the body may already be errored */ });
    reader.releaseLock();
  }
}

/** A query parameter, or `undefined` when it is absent or empty. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

/** Why a batch's body is not of its form. */
interface Refusal {
  refusal: string;
}

/** Whether a JSON value is an array of strings. */
function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * The key searches a `findKeys` body holds: `{ "queries": [ … ] }`, each query
 * an object naming `key`, `prefix`, `fields`, `from` or `to` — strings, and
 * arrays of strings for `fields`, `from` and `to` — as a single search's query
 * parameters do. Which form a query takes is the handler's to check.
 */
function queriesOf(body: unknown): KeySearchQuery[] | Refusal {
  const queries = (body as { queries?: unknown } | null)?.queries;
  if (!Array.isArray(queries)) return { refusal: 'A batch of key searches is { "queries": [ … ] }' };
  const out: KeySearchQuery[] = [];
  for (const [i, query] of queries.entries()) {
    if (query === null || typeof query !== 'object' || Array.isArray(query)) return { refusal: `query ${i} is not an object` };
    const { key, prefix, fields, from, to, ...rest } = query as Record<string, unknown>;
    const others = Object.keys(rest);
    if (others.length > 0) return { refusal: `query ${i} names ${others.join(', ')}: a query names key, prefix, fields, from or to` };
    if (key !== undefined && typeof key !== 'string') return { refusal: `query ${i}'s key is not a string` };
    if (prefix !== undefined && typeof prefix !== 'string') return { refusal: `query ${i}'s prefix is not a string` };
    for (const [name, value] of [['fields', fields], ['from', from], ['to', to]] as const) {
      if (value !== undefined && !isStrings(value)) return { refusal: `query ${i}'s ${name} is not an array of strings` };
    }
    out.push({
      ...(key !== undefined && { key: key as string }),
      ...(prefix !== undefined && { prefix: prefix as string }),
      ...(fields !== undefined && { fields: fields as string[] }),
      ...(from !== undefined && { from: from as string[] }),
      ...(to !== undefined && { to: to as string[] }),
    });
  }
  return out;
}

/** The strings a body holds under `name`: `{ "<name>": [ "…", … ] }`. */
function stringsOf(body: unknown, name: string): string[] | Refusal {
  const value = (body as Record<string, unknown> | null)?.[name];
  return isStrings(value) ? value : { refusal: `A read of rows by key is { "${name}": [ "<.east literal>", … ] }` };
}

/**
 * What a `rows` body asks the rows of: its keys, `{ "keys": [ "<.east literal>",
 * … ] }`, or the keys some runs of a record's index name, `{ "keysOf": { "path":
 * ".<record>", "index": "<name>", "hash": "<state>", "runs": [[row, count], …] }
 * }` — the path a keypath, as a status names a dataset (#1393). One form, never
 * both.
 */
function rowsOf(body: unknown): { keys: string[] } | { keysOf: DatasetRowsKeysOf } | Refusal {
  const form = (body ?? {}) as { keys?: unknown; keysOf?: unknown };
  if (form.keysOf === undefined) {
    const keys = stringsOf(body, 'keys');
    return 'refusal' in keys ? keys : { keys };
  }
  if (form.keys !== undefined) return { refusal: 'A read of rows names its keys or the runs that name them, not both: { "keys": … } or { "keysOf": … }' };
  const shape = 'A read of rows by runs is { "keysOf": { "path": ".<record>", "index": "<name>", "hash": "<state>", "runs": [[row, count], …] } }';
  const of = form.keysOf as { path?: unknown; index?: unknown; hash?: unknown } | null;
  if (of === null || typeof of !== 'object' || Array.isArray(of)) return { refusal: shape };
  if (typeof of.path !== 'string' || typeof of.index !== 'string' || of.index === '' || typeof of.hash !== 'string' || of.hash === '') {
    return { refusal: shape };
  }
  let path: TreePath;
  try {
    path = parseKeypath(of.path);
  } catch (err) {
    return { refusal: `keysOf's path must be a dataset's path, as a status names it (.records.x), got ${JSON.stringify(of.path)}: ${err instanceof Error ? err.message : String(err)}` };
  }
  const runs = runsOf(of);
  if ('refusal' in runs) return runs;
  return { keysOf: { path, index: of.index, hash: of.hash, runs } };
}

/**
 * The window a `place` or `near` body names beside its runs: `offset` and
 * `limit`, each a number when given — refused in the read's own words: whose
 * window it is, and what it does with the runs' entries.
 */
function windowOf(body: unknown, read: { whose: string; does: string }): { offset?: number; limit?: number } | Refusal {
  const { offset, limit } = (body as { offset?: unknown; limit?: unknown } | null) ?? {};
  if (offset !== undefined && typeof offset !== 'number') return { refusal: `${read.whose} offset is a number: the runs' first entry it ${read.does}` };
  if (limit !== undefined && typeof limit !== 'number') return { refusal: `${read.whose} limit is a number: how many of the runs' entries it ${read.does}` };
  return { ...(offset !== undefined && { offset }), ...(limit !== undefined && { limit }) };
}

/** The runs a `runs`, `place` or `within` body holds: `{ "runs": [[row, count], …] }`. */
function runsOf(body: unknown): [number, number][] | Refusal {
  const runs = (body as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(runs)) return { refusal: 'A read of runs is { "runs": [[row, count], …] }' };
  const out: [number, number][] = [];
  for (const [i, run] of runs.entries()) {
    if (!Array.isArray(run) || run.length !== 2 || typeof run[0] !== 'number' || typeof run[1] !== 'number') {
      return { refusal: `run ${i} is not [row, count]` };
    }
    out.push([run[0], run[1]]);
  }
  return out;
}
