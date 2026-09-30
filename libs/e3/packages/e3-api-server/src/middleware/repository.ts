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
import { RepositoryUpgradePendingError, repositoryOpen, type StorageBackend } from '@elaraai/e3-core';
import { sendJsonError } from '../errors.js';

/** How long, in seconds, a client is told to wait before it asks again of a
 *  repository an upgrade waits on. */
const UPGRADE_RETRY_AFTER_S = 5;

/** Whether a request creates or removes a repository. */
function createsOrRemoves(c: Context): boolean {
  return (c.req.method === 'PUT' || c.req.method === 'DELETE') && /\/repos\/[^/]+$/.test(c.req.path);
}

/**
 * Whether a request stops or polls a workspace's dataflow: what a repository
 * an upgrade waits on still answers, since the run is what the upgrade waits
 * for, and both reach only the run's state and its orchestrator.
 */
function stopsOrPollsDataflow(c: Context): boolean {
  const run = /\/repos\/[^/]+\/workspaces\/[^/]+\/dataflow\/(cancel|execution)$/.exec(c.req.path);
  return run !== null && (run[1] === 'cancel' ? c.req.method === 'POST' : c.req.method === 'GET');
}

/** How {@link createRepositoryGate} treats a repository that owes store
 *  upgrades. */
export interface RepositoryGateOptions {
  /**
   * Whether a request applies the upgrades a repository owes, at the first
   * that finds the repository still: true unless set, as a local server does.
   *
   * @remarks
   * A host whose requests have a time limit, which a step may outlast, passes
   * `false` and applies them in a job of its own, by an open of the repository
   * there (`repositoryOpen`) — the job {@link onUpgradePending} starts. Until
   * the job has, the gate answers every request to the repository but a
   * running dataflow's cancel and poll with 503 `repository_upgrade_pending`.
   */
  applyUpgrades?: boolean;
  /**
   * Called, with `applyUpgrades: false`, for each request to a repository that
   * owes upgrades: the host starts the job that applies them here, or finds it
   * started. It is called for every such request, so starting the job once is
   * the host's to see to. It is awaited, and its failure is the host's to
   * report: the request is answered all the same, and the next one calls it
   * again.
   *
   * @param repo - The repository's name, as the request names it
   * @param upgrades - The steps it owes, in the order they apply
   */
  onUpgradePending?: (repo: string, upgrades: readonly string[]) => void | Promise<void>;
}

/**
 * The gate of a host's repositories: the repository exists, is not being
 * removed, and is opened as every way into a repository opens it — upgraded in
 * place when an older release wrote it, and refused, naming the fix, when this
 * e3 cannot read it. A repository being removed answers its status alone, and
 * is not opened. It goes through the storage backend's `RepoStore`, so a host
 * mounts it over its own.
 *
 * No request waits on an upgrade. The open refuses at once when the repository
 * owes one and work running in it holds it, and the gate answers 503
 * `repository_upgrade_pending`, naming the steps and the work, with a
 * `Retry-After`; the steps apply at the first request that finds the
 * repository still, or, with `options.applyUpgrades: false`, in the host's
 * job, and the gate answers so until they have. A running dataflow's cancel
 * and poll pass the gate all the same, so the run an upgrade waits for can
 * always be stopped.
 *
 * @param storage - Storage backend, whose `RepoStore` keeps the repositories
 * @param getRepoPath - A repository's identifier from its name, as the stores
 *   other than the `RepoStore` take it
 * @param options - Whether a request applies the upgrades a repository owes,
 *   and what starts the host's job when not
 * @returns The middleware
 */
export function createRepositoryGate(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  options: RepositoryGateOptions = {},
): MiddlewareHandler {
  const apply = options.applyUpgrades ?? true;
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
        await repositoryOpen(storage, getRepoPath(repo), { apply, waitMs: 0 });
      } catch (err) {
        if (!(err instanceof RepositoryUpgradePendingError)) return sendJsonError(err);
        if (err.job && options.onUpgradePending !== undefined) {
          try {
            await options.onUpgradePending(repo, err.upgrades);
          } catch {
            // The host's to report; the next request calls it again.
          }
        }
        if (!stopsOrPollsDataflow(c)) {
          const refused = sendJsonError(err);
          refused.headers.set('Retry-After', String(UPGRADE_RETRY_AFTER_S));
          return refused;
        }
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
