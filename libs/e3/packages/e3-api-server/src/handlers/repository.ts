/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { ArrayType, NullType, StringType, none, variant } from '@elaraai/east';
import { RepositoryRecordType, type GcRequest } from '@elaraai/e3-types';
import { RepoAlreadyExistsError, RepoNotFoundError, packageList, repositoryOpen, workspaceList } from '@elaraai/e3-core/portable';
import type { RepoGcStore, StorageBackend } from '@elaraai/e3-core/portable';
import { sendSuccess, sendSuccessWithStatus, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import {
  RepositoryStatusType,
  GcStartResultType,
  GcStatusResultType,
} from '../types.js';

/**
 * The repositories a host keeps, by name.
 *
 * @param storage - Storage backend, whose `RepoStore` keeps the repositories
 * @returns The response: the names, or the error
 */
export async function listRepositories(storage: StorageBackend): Promise<Response> {
  try {
    return sendSuccess(ArrayType(StringType), await storage.repos.list());
  } catch (err) {
    return sendError(ArrayType(StringType), errorToVariant(err));
  }
}

/**
 * Creates a repository, with its record naming this release and every
 * upgrade this e3 knows, since a new repository is in their forms.
 *
 * @param storage - Storage backend, whose `RepoStore` keeps the repositories
 * @param repo - The new repository's name
 * @returns The response: 201 with its name; or the error, as for one that
 *   exists, or whose removal is still being cleaned up
 */
export async function createRepository(storage: StorageBackend, repo: string): Promise<Response> {
  try {
    const existing = await storage.repos.getMetadata(repo);
    if (existing) {
      if (existing.status.type === 'deleting') {
        return sendError(StringType, variant('internal', { message: `Repository '${repo}' cleanup in progress, try later` }));
      }
      return sendError(StringType, variant('internal', { message: `Repository '${repo}' already exists` }));
    }

    await storage.repos.create(repo);
    return sendSuccessWithStatus(StringType, repo, 201);
  } catch (err) {
    if (err instanceof RepoAlreadyExistsError) {
      return sendError(StringType, variant('internal', { message: `Repository '${repo}' already exists` }));
    }
    return sendError(StringType, errorToVariant(err));
  }
}

/**
 * Removes a repository, resumably: it is marked `deleting` first, so the
 * repository gate treats it as gone from then on, and a removal asked again
 * answers at once; then its refs and its objects are deleted a batch at a
 * time, and last the repository itself.
 *
 * @param storage - Storage backend, whose `RepoStore` keeps the repositories
 * @param repo - The repository's name
 * @returns The response: null once it is removed, or the error
 */
export async function removeRepository(storage: StorageBackend, repo: string): Promise<Response> {
  try {
    const existing = await storage.repos.getMetadata(repo);
    if (!existing) {
      return sendError(NullType, variant('repository_not_found', { repo }));
    }

    // Being removed already: the removal that marked it finishes it.
    if (existing.status.type === 'deleting') {
      return sendSuccess(NullType, null);
    }

    await storage.repos.setStatus(repo, 'deleting', 'active');

    let cursor: string | undefined;
    do {
      const result = await storage.repos.deleteRefsBatch(repo, cursor);
      cursor = result.status === 'continue' ? result.cursor : undefined;
    } while (cursor);

    cursor = undefined;
    do {
      const result = await storage.repos.deleteObjectsBatch(repo, cursor);
      cursor = result.status === 'continue' ? result.cursor : undefined;
    } while (cursor);

    await storage.repos.remove(repo);

    return sendSuccess(NullType, null);
  } catch (err) {
    if (err instanceof RepoNotFoundError) {
      return sendError(NullType, variant('repository_not_found', { repo }));
    }
    return sendError(NullType, errorToVariant(err));
  }
}

/**
 * Get repository status.
 */
export async function getStatus(
  storage: StorageBackend,
  repoPath: string
): Promise<Response> {
  try {
    // Count objects
    const objectCount = await storage.objects.count(repoPath);

    // Count packages and workspaces
    const packages = await packageList(storage, repoPath);
    const workspaces = await workspaceList(storage, repoPath);

    const status = {
      path: repoPath,
      objectCount: BigInt(objectCount),
      packageCount: BigInt(packages.length),
      workspaceCount: BigInt(workspaces.length),
    };
    return sendSuccess(RepositoryStatusType, status);
  } catch (err) {
    return sendError(RepositoryStatusType, errorToVariant(err));
  }
}

/**
 * The repository's record: the release of e3 that last wrote it, and the store
 * upgrades it has had.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @returns The response: the record, or the error
 */
export async function getRecord(
  storage: StorageBackend,
  repoPath: string
): Promise<Response> {
  try {
    return sendSuccess(RepositoryRecordType, await repositoryOpen(storage, repoPath));
  } catch (err) {
    return sendError(RepositoryRecordType, errorToVariant(err));
  }
}

/**
 * Start garbage collection, as a job the client polls.
 *
 * @remarks
 * gc takes as long as the repository is large, which outlasts a request. So it
 * runs as a job, in the compute the store dispatches it to: a local server's
 * own process, or a cloud's. A poll reads the job's status from the store,
 * whichever instance answers it.
 *
 * @param repo - The repository's name, which the job is filed under
 * @param request - What gc keeps, and whether it deletes
 * @param gcStore - Where the job is filed, and dispatched from
 * @returns The response: 202 with the job's id, or the error
 */
export async function startGc(
  repo: string,
  request: GcRequest,
  gcStore: RepoGcStore,
): Promise<Response> {
  try {
    const executionId = globalThis.crypto.randomUUID();
    await gcStore.create(executionId, {
      repo,
      request,
      status: { status: variant('running', null), stats: none, error: none },
      createdAt: new Date(),
    });
    await gcStore.execute(executionId, repo);
    return sendSuccessWithStatus(GcStartResultType, { executionId }, 202);
  } catch (err) {
    return sendError(GcStartResultType, errorToVariant(err));
  }
}

/**
 * A gc job's status: still running, what gc did, or why it failed.
 *
 * @param gcStore - Where the job is filed
 * @param repo - The repository's name
 * @param executionId - The job's id
 * @returns The response: the status, or the error when this repository started
 *   no such job
 */
export async function getGcStatus(
  gcStore: RepoGcStore,
  repo: string,
  executionId: string,
): Promise<Response> {
  try {
    const job = await gcStore.get(executionId);
    if (job === null || job.repo !== repo) {
      return sendError(GcStatusResultType, variant('internal', {
        message: `repository '${repo}' has no gc job '${executionId}'`,
      }));
    }
    return sendSuccess(GcStatusResultType, job.status);
  } catch (err) {
    return sendError(GcStatusResultType, errorToVariant(err));
  }
}

