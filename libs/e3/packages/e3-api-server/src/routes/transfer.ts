/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { variant, NullType } from '@elaraai/east';
import { urlPathToTreePath } from '@elaraai/e3-types';
import {
  DatasetTypeMismatchError,
  datasetAdoptFile,
  datasetAdoptObject,
  transferStagingDir,
  transferStagingPath,
  type StorageBackend,
  type TransferBackend,
} from '@elaraai/e3-core';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import { TransferUploadRequestType, TransferUploadResponseType, TransferDoneResponseType } from '../types.js';

/**
 * Create dataset transfer routes.
 *
 * Returns an `api` Hono app with authenticated routes (init upload, commit)
 * mounted at /api/repos/:repo/workspaces/:ws/datasets.
 *
 * Unauthenticated data routes (upload/download bytes) are handled by the
 * generic data endpoints in `data.ts`.
 */
export function createTransferRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
) {
  const api = new Hono();

  /**
   * Extract dataset path from the request URL wildcard.
   * The route is mounted at /api/repos/:repo/workspaces/:ws/datasets
   * so a request to .../datasets/inputs/config/upload yields path "inputs/config".
   */
  function extractDatasetPath(c: { req: { path: string; param(name: string): string | undefined } }, suffix: string): string {
    const fullPath = c.req.path;
    const repo = c.req.param('repo')!;
    const ws = c.req.param('ws')!;
    const datasetsPrefix = `/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(ws)}/datasets/`;
    let pathStr = fullPath.startsWith(datasetsPrefix) ? fullPath.slice(datasetsPrefix.length) : '';
    // Strip trailing suffix (e.g. "/upload" or "/upload/<id>")
    if (pathStr.endsWith(suffix)) {
      pathStr = pathStr.slice(0, -suffix.length);
    }
    // Remove trailing slash
    if (pathStr.endsWith('/')) {
      pathStr = pathStr.slice(0, -1);
    }
    return pathStr;
  }

  // =========================================================================
  // Authenticated API routes (mounted at /api/repos/:repo/workspaces/:ws/datasets)
  // =========================================================================

  // POST routes use catch-all wildcard and dispatch based on URL suffix:
  // - .../datasets/<path>/upload          → init transfer
  // - .../datasets/<path>/upload/<id>     → commit transfer
  api.post('/*', async (c) => {
    const fullPath = c.req.path;

    // Check for commit: .../upload/<uuid>
    const commitMatch = fullPath.match(/\/upload\/([0-9a-f-]{36})$/);
    if (commitMatch) {
      return handleCommit(c, commitMatch[1]);
    }

    // Check for init: .../upload
    if (fullPath.endsWith('/upload')) {
      return handleInit(c);
    }

    // Not a transfer route — return 404
    return new Response('Not found', { status: 404 });
  });

  async function handleInit(c: Context) {
    const repo = c.req.param('repo')!;
    const ws = c.req.param('ws')!;
    const repoPath = getRepoPath(repo);
    const pathStr = extractDatasetPath(c, '/upload');
    const { hash, size } = await decodeBody(c, TransferUploadRequestType);

    // Dedup — the bytes are already an object, so no upload is needed. The
    // object is not necessarily THIS dataset's type though (it may have been
    // stored for another one), so the pairing is checked here: it is the only
    // door that skips the commit.
    if (await storage.objects.exists(repoPath, hash)) {
      const treePath = urlPathToTreePath(pathStr);
      await datasetAdoptObject(storage, repoPath, ws, treePath, hash);
      return sendSuccess(TransferUploadResponseType, variant('completed', null));
    }

    // Create transfer record in backend
    const transferId = randomUUID();
    await transferBackend.datasetUpload.create(transferId, { repo, workspace: ws, path: pathStr, hash, size });

    // Create the staging slot under the repo, so the commit's adopt is a
    // same-device link or rename rather than a whole-file copy.
    await mkdir(transferStagingDir(repoPath), { recursive: true });

    const uploadUrl = await transferBackend.datasetUpload.getUploadUrl(transferId, repo, hash);
    // Resolve relative URL against the request origin
    const origin = new URL(c.req.url).origin;
    const resolvedUrl = uploadUrl.startsWith('/') ? `${origin}${uploadUrl}` : uploadUrl;
    return sendSuccess(TransferUploadResponseType, variant('upload', { id: transferId, uploadUrl: resolvedUrl }));
  }

  async function handleCommit(c: Context, id: string) {
    const transfer = await transferBackend.datasetUpload.get(id);
    if (!transfer) {
      return sendError(NullType, variant('internal', { message: 'transfer not found' }));
    }

    const repoPath = getRepoPath(transfer.repo);
    const stagingPath = transferStagingPath(repoPath, id);

    try {
      // The staged file is never read whole: its size comes from `stat`, its
      // digest from a streamed hash, its declared type and paging index from
      // two ranged reads, and it becomes an object by link or rename. A
      // multi-gigabyte delivery therefore commits for the cost of its SHA-256.
      const stats = await stat(stagingPath);
      if (BigInt(stats.size) !== transfer.size) {
        await unlink(stagingPath).catch(() => {});
        return sendSuccess(TransferDoneResponseType,
          variant('error', { message: `size mismatch: expected ${transfer.size}, got ${stats.size}` }));
      }

      const treePath = urlPathToTreePath(transfer.path);
      try {
        await datasetAdoptFile(storage, repoPath, transfer.workspace, treePath, stagingPath, {
          expectHash: transfer.hash,
        });
      } catch (err) {
        await unlink(stagingPath).catch(() => {});
        if (err instanceof DatasetTypeMismatchError) {
          return sendError(TransferDoneResponseType, variant('dataset_type_mismatch', {
            workspace: transfer.workspace,
            path: err.path,
            message: err.message,
          }));
        }
        return sendSuccess(TransferDoneResponseType,
          variant('error', { message: err instanceof Error ? err.message : String(err) }));
      }
      await unlink(stagingPath).catch(() => {});

      return sendSuccess(TransferDoneResponseType, variant('completed', null));
    } finally {
      await transferBackend.datasetUpload.delete(id);
    }
  }

  return { api };
}
