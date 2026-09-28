/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { randomUUID } from 'node:crypto';
import { none, variant } from '@elaraai/east';
import { E3_RELEASE, TRANSFER_PROTOCOL_VERSION, transferPartCount, urlPathToTreePath } from '@elaraai/e3-types';
import {
  datasetAdoptObject,
  deliveryKnown,
  type DatasetCommitStatus,
  type DatasetUpload,
  type StorageBackend,
  type TransferBackend,
} from '@elaraai/e3-core';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import {
  TransferUploadRequestType,
  TransferUploadResponseType,
  TransferPartResponseType,
  TransferDoneResponseType,
} from '../types.js';

/** Options for {@link createTransferRoutes}. */
export interface TransferRouteOptions {
  /**
   * How long a commit waits for the staged bytes to be verified before it
   * answers `processing` for the client to poll (default 5000 ms; 0 answers
   * `processing` at once).
   */
  commitWaitMs?: number;
}

const DEFAULT_COMMIT_WAIT_MS = 5_000;

/**
 * Why a request does not speak this server's transfer protocol, or `null`
 * when it does. A client names its version with `?protocol=N`, and one that
 * names none was built before there was a version to name. It names its
 * release beside it (`&release=`), which decides nothing: a refusal names it
 * beside this server's.
 */
function protocolProblem(c: Context): string | null {
  const named = c.req.query('protocol');
  if (named === String(TRANSFER_PROTOCOL_VERSION)) return null;
  const release = c.req.query('release');
  const newer = named !== undefined && Number(named) > TRANSFER_PROTOCOL_VERSION;
  return `this server, e3 ${E3_RELEASE}, speaks transfer protocol ${TRANSFER_PROTOCOL_VERSION}, and the request, `
    + `${release === undefined ? 'which names no release' : `from e3 ${release}`}, ${named === undefined ? 'names no protocol' : `speaks ${named}`}: `
    + (newer ? 'a newer e3 sent it — upgrade the server' : 'an older e3 sent it — upgrade it');
}

/** A backend's URL as the client can use it: a relative one resolves against the request's origin. */
function resolveUrl(c: Context, url: string): string {
  return url.startsWith('/') ? `${new URL(c.req.url).origin}${url}` : url;
}

/** The promise's value if it settles within `ms`, else `null` — at once when `ms` is 0. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** A commit's status as the API answers it: a type the dataset does not
 *  declare is its `dataset_type_mismatch` error, as an inline write's is. */
function sendCommitStatus(transfer: DatasetUpload, status: DatasetCommitStatus): Response {
  switch (status.type) {
    case 'processing':
      return sendSuccess(TransferDoneResponseType, variant('processing', status.value));
    case 'completed':
      return sendSuccess(TransferDoneResponseType, variant('completed', null));
    case 'failed':
      return sendSuccess(TransferDoneResponseType, variant('error', { message: status.value.message }));
    case 'type_mismatch':
      return sendError(TransferDoneResponseType, variant('dataset_type_mismatch', {
        workspace: transfer.workspace,
        path: status.value.path,
        message: status.value.message,
      }));
  }
}

/**
 * Create dataset transfer routes.
 *
 * Returns an `api` Hono app with authenticated routes (init upload, part
 * targets, commit, commit poll) mounted at /api/repos/:repo/workspaces/:ws/datasets.
 *
 * Unauthenticated data routes (upload/download bytes) are handled by the
 * generic data endpoints in `data.ts`.
 *
 * @remarks
 * The init and the commit name the protocol version they speak
 * (`?protocol=N`) and the client's release (`&release=`), and one of another
 * version, or none, is refused, naming both releases and the fix. A client is
 * sent its bytes' plan as parts. The upload store commits the upload, where it
 * runs its commits: the request waits up to `commitWaitMs` for it and
 * otherwise answers `processing`, which the client polls from the store,
 * whichever instance answers — so verifying a delivery of many gigabytes never
 * holds one request open for as long as its SHA-256 takes.
 */
export function createTransferRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
  options: TransferRouteOptions = {},
) {
  const api = new Hono();
  const commitWaitMs = options.commitWaitMs ?? DEFAULT_COMMIT_WAIT_MS;
  const uploads = transferBackend.datasetUpload;

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

  /** Whether an upload was created for the repository, workspace and dataset this request addresses. */
  function addresses(c: Context, transfer: DatasetUpload, suffix: string): boolean {
    return transfer.repo === c.req.param('repo')
      && transfer.workspace === c.req.param('ws')
      && transfer.path === extractDatasetPath(c, suffix);
  }

  /** The upload `id`, if this request addresses it. */
  async function uploadAt(c: Context, id: string, suffix: string): Promise<DatasetUpload | null> {
    const transfer = await uploads.get(id);
    return transfer && addresses(c, transfer, suffix) ? transfer : null;
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
      return handleCommit(c, commitMatch[1]!, commitMatch[0]);
    }

    // Check for init: .../upload
    if (fullPath.endsWith('/upload')) {
      return handleInit(c);
    }

    // Not a transfer route — return 404
    return new Response('Not found', { status: 404 });
  });

  // GET routes dispatch the same way, and leave every other read to the
  // dataset routes mounted after these:
  // - .../datasets/<path>/upload/<id>/parts/<n>  → where to send part n
  // - .../datasets/<path>/upload/<id>            → poll a commit
  api.get('/*', async (c, next) => {
    const fullPath = c.req.path;

    const partMatch = fullPath.match(/\/upload\/([0-9a-f-]{36})\/parts\/([0-9]+)$/);
    if (partMatch) {
      return handlePart(c, partMatch[1]!, Number(partMatch[2]), partMatch[0]);
    }

    const pollMatch = fullPath.match(/\/upload\/([0-9a-f-]{36})$/);
    if (pollMatch) {
      return handlePoll(c, pollMatch[1]!, pollMatch[0]);
    }

    await next();
  });

  async function handleInit(c: Context) {
    const problem = protocolProblem(c);
    if (problem !== null) {
      return sendError(TransferUploadResponseType, variant('internal', { message: problem }));
    }
    const repo = c.req.param('repo')!;
    const ws = c.req.param('ws')!;
    const repoPath = getRepoPath(repo);
    const pathStr = extractDatasetPath(c, '/upload');
    const { hash, size } = await decodeBody(c, TransferUploadRequestType);

    // Dedup — the store knows these bytes, as the manifest they were split
    // into or as an object, so no upload is needed. It may have stored them
    // for another dataset, of another type, so the pairing is checked here: it
    // is the only door that skips the commit.
    if (await deliveryKnown(storage, repoPath, hash)) {
      const treePath = urlPathToTreePath(pathStr);
      await datasetAdoptObject(storage, repoPath, ws, treePath, hash);
      return sendSuccess(TransferUploadResponseType, variant('completed', null));
    }

    // The upload's record, and its plan as parts, which the store makes ready
    // to stage
    const transferId = randomUUID();
    const transfer: DatasetUpload = { repo, workspace: ws, path: pathStr, hash, size };
    await uploads.create(transferId, transfer);
    const partBytes = await uploads.createParts(transferId, transfer);
    return sendSuccess(TransferUploadResponseType, variant('upload_parts', { id: transferId, partBytes }));
  }

  async function handlePart(c: Context, id: string, part: number, suffix: string) {
    const transfer = await uploadAt(c, id, suffix);
    if (!transfer) {
      return sendError(TransferPartResponseType, variant('internal', { message: 'transfer not found' }));
    }
    // A part sent once the commit is under way could rewrite the bytes it
    // verifies.
    if ((await uploads.getCommitStatus(id)) !== null) {
      return sendError(TransferPartResponseType, variant('internal', { message: 'the upload is committed: it takes no more parts' }));
    }
    const partBytes = await uploads.getPartBytes(id);
    if (partBytes === null) {
      return sendError(TransferPartResponseType, variant('internal', { message: 'transfer was not planned as parts' }));
    }
    const count = transferPartCount(transfer.size, partBytes);
    if (part < 1 || part > count) {
      return sendError(TransferPartResponseType, variant('internal', {
        message: `no part ${part}: the upload has ${count} part${count === 1 ? '' : 's'}`,
      }));
    }
    const target = await uploads.getPartUpload(id, transfer, part);
    return sendSuccess(TransferPartResponseType, {
      url: resolveUrl(c, target.url),
      headers: new Map(Object.entries(target.headers)),
    });
  }

  async function handleCommit(c: Context, id: string, suffix: string) {
    const problem = protocolProblem(c);
    if (problem !== null) {
      return sendError(TransferDoneResponseType, variant('internal', { message: problem }));
    }
    const transfer = await uploadAt(c, id, suffix);
    if (!transfer) {
      return sendError(TransferDoneResponseType, variant('internal', { message: 'transfer not found' }));
    }
    // A commit asked for again, as a client whose answer was lost asks, is
    // answered as the first was: at once, when it has finished.
    let status: DatasetCommitStatus | null;
    try {
      status = await uploads.getCommitStatus(id);
      if (status === null || status.type === 'processing') {
        status = await within(uploads.commit(id, transfer), commitWaitMs);
      }
      // Still running once the wait is up: how far it has got, as the store says.
      status ??= await uploads.getCommitStatus(id);
    } catch (err) {
      return sendError(TransferDoneResponseType, errorToVariant(err));
    }
    return sendCommitStatus(transfer, status ?? variant('processing', none));
  }

  async function handlePoll(c: Context, id: string, suffix: string) {
    const transfer = await uploadAt(c, id, suffix);
    if (!transfer) {
      return sendError(TransferDoneResponseType, variant('internal', { message: 'transfer not found' }));
    }
    const status = await uploads.getCommitStatus(id);
    if (status === null) {
      return sendError(TransferDoneResponseType, variant('internal', { message: 'transfer not committed' }));
    }
    return sendCommitStatus(transfer, status);
  }

  return { api };
}
