/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { urlPathToTreePath } from '@elaraai/e3-types';
import type { StorageBackend, TransferBackend } from '@elaraai/e3-core';
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
} from '../handlers/datasets.js';

/** Options for {@link createDatasetRoutes}. */
export interface DatasetRouteOptions {
  /** Byte budget clamping each page's share of the source blob. Defaults to
   *  4 MiB; deployments with tighter response limits (e.g. Lambda proxy's
   *  6 MB, base64-inflated) pass a smaller budget. */
  pageByteBudget?: number;
}

/** Parses an integer query param; `undefined` when absent, `NaN` when
 *  malformed (the handler rejects NaN with a 400). */
function intParam(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  return Number(value);
}

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

    // Extract the wildcard path (c.req.path is percent-encoded)
    const fullPath = c.req.path;
    const datasetsPrefix = `/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(ws)}/datasets/`;
    const pathStr = fullPath.startsWith(datasetsPrefix) ? fullPath.slice(datasetsPrefix.length) : '';
    const treePath = urlPathToTreePath(pathStr);

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
      });
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
      });
    }

    return getDataset(storage, repoPath, ws, treePath, repo, c.req.url, transferBackend);
  });

  // PUT /api/repos/:repo/workspaces/:ws/datasets/* - Set dataset value
  app.put('/*', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const ws = c.req.param('ws')!;

    // Extract the wildcard path (c.req.path is percent-encoded)
    const fullPath = c.req.path;
    const datasetsPrefix = `/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(ws)}/datasets/`;
    const pathStr = fullPath.startsWith(datasetsPrefix) ? fullPath.slice(datasetsPrefix.length) : '';
    const treePath = urlPathToTreePath(pathStr);

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
