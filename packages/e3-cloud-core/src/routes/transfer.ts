/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * Cloud transfer route handlers for presigned URL-based object transfer.
 *
 * These routes follow the same BEAST2 protocol as e3-api-server transfer routes
 * but delegate to TransferBackend interface methods instead of using filesystem
 * staging. In cloud deployments, data flows through S3 presigned URLs while
 * these routes handle metadata and orchestration.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { uuidv7 } from '@elaraai/e3-core';
import { variant, none, NullType } from '@elaraai/east';
import { urlPathToTreePath } from '@elaraai/e3-types';
import {
  PackageTransferInitRequestType,
  PackageTransferInitResponseType,
  PackageJobResponseType,
  PackageImportStatusType,
  PackageExportStatusType,
} from '@elaraai/e3-types';
import {
  workspaceSetDatasetByHash,
  packageResolve,
  PackageNotFoundError,
  type StorageBackend,
  type TransferBackend,
} from '@elaraai/e3-core';
import {
  TransferUploadRequestType,
  TransferUploadResponseType,
  TransferDoneResponseType,
} from '@elaraai/e3-types';
import { decodeBody, sendSuccess, sendError } from '@elaraai/e3-api-server/beast2';

// =============================================================================
// Dataset Transfer Routes
// =============================================================================

/**
 * Create cloud dataset transfer routes.
 *
 * Returns `{ api }` Hono app mounted at /api/repos/:repo/workspaces/:ws/datasets.
 * Same protocol as e3-api-server transfer routes but delegates commit to
 * `transferBackend.datasetUpload.commitObject()` instead of filesystem staging.
 */
export function createCloudTransferRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
) {
  const api = new Hono();

  /**
   * Extract dataset path from the request URL wildcard.
   * Same logic as e3-api-server/routes/transfer.ts.
   */
  function extractDatasetPath(c: { req: { path: string; param(name: string): string | undefined } }, suffix: string): string {
    const fullPath = c.req.path;
    const repo = c.req.param('repo')!;
    const ws = c.req.param('ws')!;
    const datasetsPrefix = `/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(ws)}/datasets/`;
    let pathStr = fullPath.startsWith(datasetsPrefix) ? fullPath.slice(datasetsPrefix.length) : '';
    if (pathStr.endsWith(suffix)) {
      pathStr = pathStr.slice(0, -suffix.length);
    }
    if (pathStr.endsWith('/')) {
      pathStr = pathStr.slice(0, -1);
    }
    return pathStr;
  }

  api.post('/*', async (c) => {
    const fullPath = c.req.path;

    const commitMatch = fullPath.match(/\/upload\/([0-9a-f-]{36})$/);
    if (commitMatch) {
      return handleCommit(c, commitMatch[1]);
    }

    if (fullPath.endsWith('/upload')) {
      return handleInit(c);
    }

    return new Response('Not found', { status: 404 });
  });

  async function handleInit(c: Context) {
    const repo = c.req.param('repo')!;
    const ws = c.req.param('ws')!;
    const repoPath = getRepoPath(repo);
    const pathStr = extractDatasetPath(c, '/upload');
    const { hash, size } = await decodeBody(c, TransferUploadRequestType);

    // Dedup check
    if (await storage.objects.exists(repoPath, hash)) {
      const treePath = urlPathToTreePath(pathStr);
      await workspaceSetDatasetByHash(storage, repoPath, ws, treePath, hash, new Map());
      return sendSuccess(TransferUploadResponseType, variant('completed', null));
    }

    // Create transfer record
    const transferId = uuidv7();
    await transferBackend.datasetUpload.create(transferId, { repo, workspace: ws, path: pathStr, hash, size });

    // Get presigned upload URL from backend
    const uploadUrl = await transferBackend.datasetUpload.getUploadUrl(transferId, repo, hash);
    return sendSuccess(TransferUploadResponseType, variant('upload', { id: transferId, uploadUrl }));
  }

  async function handleCommit(c: Context, id: string) {
    const transfer = await transferBackend.datasetUpload.get(id);
    if (!transfer) {
      return sendError(NullType, variant('internal', { message: 'transfer not found' }));
    }

    try {
      const repoPath = getRepoPath(transfer.repo);

      // Delegate to backend — verifies upload, writes catalogue entry
      await transferBackend.datasetUpload.commitObject(transfer.repo, transfer.hash, id);

      // Update dataset ref
      const treePath = urlPathToTreePath(transfer.path);
      await workspaceSetDatasetByHash(storage, repoPath, transfer.workspace, treePath, transfer.hash, new Map());

      return sendSuccess(TransferDoneResponseType, variant('completed', null));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return sendSuccess(TransferDoneResponseType, variant('error', { message }));
    }
  }

  return { api };
}

// =============================================================================
// Package Transfer Routes
// =============================================================================

const MAX_PACKAGE_SIZE = 5n * 1024n * 1024n * 1024n; // 5 GB

/**
 * Create cloud package transfer routes.
 *
 * Returns two Hono apps:
 * - `repoApi`: mounted at /api/repos/:repo (POST /import, POST /import/:id, GET /import/:id, GET /export/:id)
 * - `pkgApi`: mounted at /api/repos/:repo/packages (POST /:name/:version/export)
 *
 * Same protocol as e3-api-server package-transfer routes but delegates
 * execution to `transferBackend.packageImport.execute()` / `packageExport.execute()`.
 */
export function createCloudPackageTransferRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
) {
  const repoApi = new Hono();
  const pkgApi = new Hono();

  // POST /api/repos/:repo/import — Init import
  repoApi.post('/import', async (c) => {
    const repo = c.req.param('repo')!;
    const { size } = await decodeBody(c, PackageTransferInitRequestType);

    if (size <= 0n || size > MAX_PACKAGE_SIZE) {
      return sendError(PackageTransferInitResponseType, variant('internal', {
        message: `Invalid size: must be between 1 and ${MAX_PACKAGE_SIZE} bytes`,
      }));
    }

    const transferId = uuidv7();
    await transferBackend.packageImport.create(transferId, {
      repo,
      size,
      status: variant('created', null),
      createdAt: new Date(),
    });

    // Get presigned upload URL from backend
    const uploadUrl = await transferBackend.packageImport.getUploadUrl(transferId, repo);
    return sendSuccess(PackageTransferInitResponseType, { id: transferId, uploadUrl });
  });

  // POST /api/repos/:repo/import/:id — Trigger import
  repoApi.post('/import/:id', async (c) => {
    const id = c.req.param('id')!;
    const record = await transferBackend.packageImport.get(id);
    if (!record) {
      return sendError(PackageJobResponseType, variant('internal', { message: 'transfer not found' }));
    }

    try {
      await transferBackend.packageImport.execute(id, record.repo);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Package import execute failed:', { id, repo: record.repo, error: message });
      try {
        await transferBackend.packageImport.updateStatus(id, variant('failed', { message }));
      } catch (updateErr) {
        console.error('Failed to mark import as failed:', { id, error: updateErr instanceof Error ? updateErr.message : String(updateErr) });
      }
    }

    return sendSuccess(PackageJobResponseType, { id });
  });

  // GET /api/repos/:repo/import/:id — Poll import status
  repoApi.get('/import/:id', async (c) => {
    const id = c.req.param('id')!;
    const record = await transferBackend.packageImport.get(id);
    if (!record) {
      return sendError(PackageImportStatusType, variant('internal', { message: 'import job not found' }));
    }

    const status = record.status;
    if (status.type === 'processing') {
      return sendSuccess(PackageImportStatusType, variant('processing', status.value));
    }
    if (status.type === 'created' || status.type === 'uploaded') {
      return sendSuccess(PackageImportStatusType, variant('processing', variant('pending', null)));
    }
    if (status.type === 'failed') {
      return sendSuccess(PackageImportStatusType, variant('failed', { message: status.value.message }));
    }
    if (status.type === 'completed') {
      return sendSuccess(PackageImportStatusType, variant('completed', status.value));
    }

    return sendError(PackageImportStatusType, variant('internal', { message: 'unknown status' }));
  });

  // GET /api/repos/:repo/export/:id — Poll export status
  repoApi.get('/export/:id', async (c) => {
    const id = c.req.param('id')!;
    const record = await transferBackend.packageExport.get(id);
    if (!record) {
      return sendError(PackageExportStatusType, variant('internal', { message: 'export job not found' }));
    }

    const status = record.status;
    if (status.type === 'processing') {
      return sendSuccess(PackageExportStatusType, variant('processing', status.value));
    }
    if (status.type === 'failed') {
      return sendSuccess(PackageExportStatusType, variant('failed', { message: status.value.message }));
    }
    if (status.type === 'completed') {
      const downloadUrl = await transferBackend.packageExport.getDownloadUrl(id, record.repo);
      return sendSuccess(PackageExportStatusType, variant('completed', {
        downloadUrl,
        size: status.value.size,
      }));
    }

    return sendError(PackageExportStatusType, variant('internal', { message: 'unknown status' }));
  });

  // POST /api/repos/:repo/packages/:name/:version/export — Trigger export
  pkgApi.post('/:name/:version/export', async (c) => {
    const repo = c.req.param('repo')!;
    const name = c.req.param('name')!;
    const version = c.req.param('version')!;

    // Pre-flight: verify package exists before creating async job
    try {
      await packageResolve(storage, getRepoPath(repo), name, version);
    } catch (err) {
      if (err instanceof PackageNotFoundError) {
        return sendError(PackageJobResponseType, variant('package_not_found', {
          packageName: name,
          version: none,
        }));
      }
      throw err;
    }

    const id = uuidv7();
    await transferBackend.packageExport.create(id, {
      repo,
      name,
      version,
      workspace: none,
      status: variant('processing', variant('pending', null)),
      createdAt: new Date(),
    });

    try {
      await transferBackend.packageExport.execute(id, repo);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await transferBackend.packageExport.updateStatus(id, variant('failed', { message }));
    }

    return sendSuccess(PackageJobResponseType, { id });
  });

  return { repoApi, pkgApi };
}
