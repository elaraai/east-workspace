/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { ArrayType, StringType } from '@elaraai/east';
import type { StorageBackend } from '@elaraai/e3-core/portable';
import { createRepository, listRepositories, removeRepository } from '../handlers/repository.js';
import { sendSuccess } from '../beast2.js';

/**
 * The routes of the repositories a host keeps, mounted at `/api/repos`: list
 * them, create one and remove one. They go through the storage backend's
 * `RepoStore`, so a host mounts them over its own — the local server over a
 * directory of repositories, a cloud over its own stores — with the
 * repository gate (`createRepositoryGate`) on `/api/repos/:repo/*`.
 *
 * @param storage - Storage backend, whose `RepoStore` keeps the repositories
 * @returns The routes
 */
export function createRepositoriesRoutes(storage: StorageBackend) {
  const app = new Hono();

  // GET /api/repos - The repositories, by name
  app.get('/', () => listRepositories(storage));

  // PUT /api/repos/:repo - Create a repository
  app.put('/:repo', (c) => createRepository(storage, c.req.param('repo')));

  // DELETE /api/repos/:repo - Remove a repository
  app.delete('/:repo', (c) => removeRepository(storage, c.req.param('repo')));

  return app;
}

/**
 * The routes of a server of one repository, mounted at `/api/repos`: they
 * list it, as `default`, and create and remove none. A refusal is JSON with
 * its HTTP status, as the gate's are.
 *
 * @returns The routes
 */
export function createSingleRepositoryRoutes() {
  const app = new Hono();

  // GET /api/repos - The one repository
  app.get('/', () => sendSuccess(ArrayType(StringType), ['default']));

  // PUT /api/repos/:repo - Refused: the server serves one repository
  app.put('/:repo', (c) => c.json({
    error: 'method_not_allowed',
    message: 'Repository creation is disabled in single-repo mode',
  }, 405));

  // DELETE /api/repos/:repo - Refused for the one repository; any other is none
  app.delete('/:repo', (c) => {
    const repo = c.req.param('repo');
    if (repo === 'default') {
      return c.json({
        error: 'method_not_allowed',
        message: 'Repository deletion is disabled in single-repo mode',
      }, 405);
    }
    return c.json({ error: 'not_found', message: `Repository '${repo}' not found` }, 404);
  });

  return app;
}
