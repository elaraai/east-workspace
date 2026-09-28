/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The gate every request to one repository passes, mounted on
 * `/api/repos/:repo/*` ahead of the routes and after any auth, so an
 * unauthorized request is answered 401 rather than 404. A refusal is JSON with
 * its HTTP status, since a gate cannot know the BEAST2 type the route answers.
 *
 * Creating and removing a repository, at `/api/repos/:repo` itself, pass either
 * gate, whatever order a host mounts them in: they act on a repository that may
 * not exist yet, or is being removed, and their routes answer for it.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { repositoryOpen, type StorageBackend } from '@elaraai/e3-core';
import { sendJsonError } from '../errors.js';

/** Whether a request creates or removes a repository. */
function createsOrRemoves(c: Context): boolean {
  return (c.req.method === 'PUT' || c.req.method === 'DELETE') && /\/repos\/[^/]+$/.test(c.req.path);
}

/**
 * The gate of a host's repositories: the repository exists, is not being
 * removed, and is opened as every way into a repository opens it — upgraded in
 * place when an older release wrote it, and refused, naming the fix, when this
 * e3 cannot read it. A repository being removed answers its status alone, and
 * is not opened. It goes through the storage backend's `RepoStore`, so a host
 * mounts it over its own.
 *
 * @param storage - Storage backend, whose `RepoStore` keeps the repositories
 * @param getRepoPath - A repository's identifier from its name, as the stores
 *   other than the `RepoStore` take it
 * @returns The middleware
 */
export function createRepositoryGate(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
): MiddlewareHandler {
  return async (c, next) => {
    if (createsOrRemoves(c)) {
      await next();
      return;
    }

    const repo = c.req.param('repo')!;

    // A repository whose metadata this e3 cannot read is refused naming the
    // fix, not with a bare 500.
    let metadata;
    try {
      metadata = await storage.repos.getMetadata(repo);
    } catch (err) {
      return sendJsonError(err);
    }
    if (!metadata) {
      return c.json({ error: 'not_found', message: `Repository '${repo}' not found` }, 404);
    }

    if (metadata.status.type === 'deleting') {
      if (!/\/repos\/[^/]+\/status$/.test(c.req.path)) {
        return c.json({ error: 'not_found', message: `Repository '${repo}' not found` }, 404);
      }
    } else {
      try {
        await repositoryOpen(storage, getRepoPath(repo));
      } catch (err) {
        return sendJsonError(err);
      }
    }

    await next();
  };
}

/**
 * The gate of a server of one repository: the repository is `default`, and a
 * request to any other is not found. The server opens its repository as it
 * starts.
 *
 * @returns The middleware
 */
export function createSingleRepositoryGate(): MiddlewareHandler {
  return async (c, next) => {
    if (!createsOrRemoves(c)) {
      const repo = c.req.param('repo');
      if (repo !== 'default') {
        return c.json({ error: 'not_found', message: `Repository '${repo}' not found` }, 404);
      }
    }
    await next();
  };
}
