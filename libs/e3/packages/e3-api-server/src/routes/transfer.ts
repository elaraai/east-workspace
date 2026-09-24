/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { variant } from '@elaraai/east';
import { transferPartCount, urlPathToTreePath } from '@elaraai/e3-types';
import {
  DatasetTypeMismatchError,
  datasetAdoptFile,
  datasetAdoptObject,
  deliveryKnown,
  transferStagingDir,
  transferStagingPath,
  type DatasetUpload,
  type StorageBackend,
  type TransferBackend,
} from '@elaraai/e3-core';
import { decodeBody, sendSuccess, sendError } from '../beast2.js';
import {
  TransferUploadRequestType,
  TransferUploadResponseType,
  TransferPartResponseType,
  TransferDoneResponseType,
  type Error as ApiErrorValue,
  type TransferDoneResponse,
} from '../types.js';

/** Options for {@link createTransferRoutes}. */
export interface TransferRouteOptions {
  /**
   * How long a protocol-2 commit waits for the staged bytes to be verified
   * before it answers `processing` for the client to poll (default 5000 ms; 0
   * answers `processing` at once). A protocol-1 commit always waits.
   */
  commitWaitMs?: number;
}

const DEFAULT_COMMIT_WAIT_MS = 5_000;

/** How long a finished commit's answer stays pollable. */
const COMMIT_RESULT_TTL_MS = 10 * 60 * 1000;

/** A finished commit, as every later commit or poll of the upload repeats it. */
type CommitOutcome =
  | { type: 'answer'; value: TransferDoneResponse }
  | { type: 'refused'; error: ApiErrorValue };

/** A commit started for one upload. */
interface Commit {
  /** The upload being committed — its record is gone once the commit finishes. */
  transfer: DatasetUpload;
  /** How it finished, once it has. */
  outcome: CommitOutcome | null;
  /** Settles when it finishes; never rejects. */
  settled: Promise<CommitOutcome>;
}

/** The transfer protocol version a request speaks: `?protocol=N`, else 1. */
function requestProtocol(c: Context): number {
  const version = Number(c.req.query('protocol'));
  return Number.isInteger(version) && version >= 1 ? version : 1;
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

function sendOutcome(outcome: CommitOutcome): Response {
  return outcome.type === 'answer'
    ? sendSuccess(TransferDoneResponseType, outcome.value)
    : sendError(TransferDoneResponseType, outcome.error);
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
 * A protocol-2 client (`?protocol=2` on the init and the commit) is sent its
 * bytes' plan as parts, and its commit runs in the background: the request
 * waits up to `commitWaitMs` for it and otherwise answers `processing`, which
 * the client polls — so verifying a delivery of many gigabytes never holds one
 * request open for as long as its SHA-256 takes. A protocol-1 client gets the
 * single upload URL and a commit that answers only when it is done.
 */
export function createTransferRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
  options: TransferRouteOptions = {},
) {
  const api = new Hono();
  const commitWaitMs = options.commitWaitMs ?? DEFAULT_COMMIT_WAIT_MS;
  const commits = new Map<string, Commit>();

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
    const transfer = await transferBackend.datasetUpload.get(id);
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

    // Create transfer record in backend
    const transferId = randomUUID();
    const transfer: DatasetUpload = { repo, workspace: ws, path: pathStr, hash, size };
    await transferBackend.datasetUpload.create(transferId, transfer);

    // Create the staging slot under the repo, so the commit's adopt is a
    // same-device link or rename rather than a whole-file copy.
    await mkdir(transferStagingDir(repoPath), { recursive: true });

    if (requestProtocol(c) >= 2) {
      const partBytes = await transferBackend.datasetUpload.createParts(transferId, transfer);
      return sendSuccess(TransferUploadResponseType, variant('upload_parts', { id: transferId, partBytes }));
    }
    const uploadUrl = await transferBackend.datasetUpload.getUploadUrl(transferId, repo, hash);
    return sendSuccess(TransferUploadResponseType, variant('upload', { id: transferId, uploadUrl: resolveUrl(c, uploadUrl) }));
  }

  async function handlePart(c: Context, id: string, part: number, suffix: string) {
    const transfer = await uploadAt(c, id, suffix);
    if (!transfer) {
      return sendError(TransferPartResponseType, variant('internal', { message: 'transfer not found' }));
    }
    const partBytes = await transferBackend.datasetUpload.getPartBytes(id);
    if (partBytes === null) {
      return sendError(TransferPartResponseType, variant('internal', { message: 'transfer was not planned as parts' }));
    }
    const count = transferPartCount(transfer.size, partBytes);
    if (part < 1 || part > count) {
      return sendError(TransferPartResponseType, variant('internal', {
        message: `no part ${part}: the upload has ${count} part${count === 1 ? '' : 's'}`,
      }));
    }
    const target = await transferBackend.datasetUpload.getPartUpload(id, transfer, part);
    return sendSuccess(TransferPartResponseType, {
      url: resolveUrl(c, target.url),
      headers: new Map(Object.entries(target.headers)),
    });
  }

  async function handleCommit(c: Context, id: string, suffix: string) {
    let commit = commits.get(id);
    if (!commit) {
      const transfer = await uploadAt(c, id, suffix);
      if (!transfer) {
        return sendError(TransferDoneResponseType, variant('internal', { message: 'transfer not found' }));
      }
      // A retried commit may have started it while this one looked it up.
      commit = commits.get(id) ?? startCommit(id, transfer);
    }
    if (!addresses(c, commit.transfer, suffix)) {
      return sendError(TransferDoneResponseType, variant('internal', { message: 'transfer not found' }));
    }

    const outcome = requestProtocol(c) >= 2
      ? commit.outcome ?? await within(commit.settled, commitWaitMs)
      : await commit.settled;
    return outcome ? sendOutcome(outcome) : sendSuccess(TransferDoneResponseType, variant('processing', null));
  }

  async function handlePoll(c: Context, id: string, suffix: string) {
    const commit = commits.get(id);
    if (commit && addresses(c, commit.transfer, suffix)) {
      return commit.outcome
        ? sendOutcome(commit.outcome)
        : sendSuccess(TransferDoneResponseType, variant('processing', null));
    }
    const transfer = await uploadAt(c, id, suffix);
    return sendError(TransferDoneResponseType, variant('internal', {
      message: transfer ? 'transfer not committed' : 'transfer not found',
    }));
  }

  function startCommit(id: string, transfer: DatasetUpload): Commit {
    const settled = verifyAndAdopt(id, transfer).then((outcome) => {
      commit.outcome = outcome;
      // The answer stays pollable for a while — a client whose response was
      // lost asks again — and then goes, as the upload record already has.
      setTimeout(() => commits.delete(id), COMMIT_RESULT_TTL_MS).unref();
      return outcome;
    });
    const commit: Commit = { transfer, outcome: null, settled };
    commits.set(id, commit);
    return commit;
  }

  /**
   * Verify a staged upload and point its dataset at it; never rejects.
   */
  async function verifyAndAdopt(id: string, transfer: DatasetUpload): Promise<CommitOutcome> {
    // Nothing may escape: a commit answering `processing` is awaited by no one.
    let stagingPath: string | null = null;
    try {
      const repoPath = getRepoPath(transfer.repo);
      stagingPath = transferStagingPath(repoPath, id);

      // The staged file is never held whole: its size comes from `stat`, its
      // digest from a streamed hash and its declared type from a read of its
      // head. A collection is then split into segment objects a segment at a
      // time, and any other value becomes an object by link or rename.
      const stats = await stat(stagingPath);
      if (BigInt(stats.size) !== transfer.size) {
        return {
          type: 'answer',
          value: variant('error', { message: `size mismatch: expected ${transfer.size}, got ${stats.size}` }),
        };
      }

      const treePath = urlPathToTreePath(transfer.path);
      await datasetAdoptFile(storage, repoPath, transfer.workspace, treePath, stagingPath, {
        expectHash: transfer.hash,
      });
      return { type: 'answer', value: variant('completed', null) };
    } catch (err) {
      if (err instanceof DatasetTypeMismatchError) {
        return {
          type: 'refused',
          error: variant('dataset_type_mismatch', {
            workspace: transfer.workspace,
            path: err.path,
            message: err.message,
          }),
        };
      }
      return { type: 'answer', value: variant('error', { message: err instanceof Error ? err.message : String(err) }) };
    } finally {
      if (stagingPath !== null) await unlink(stagingPath).catch(() => {});
      await transferBackend.datasetUpload.delete(id).catch(() => {});
    }
  }

  return { api };
}
