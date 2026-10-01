/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3's API in the e3 worker: {@link createWebApp}, the Hono app `serveE3`
 * answers `e3.fetch` with. It mounts every route factory of e3-api-server's
 * portable entry in multi-repository mode, in the order the local server
 * mounts them, over e3-web's seams, beside e3-web's own byte endpoints.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { checkName, type DataflowOrchestrator, type ExecutionStateStore, type TaskRunner } from '@elaraai/e3-core/portable';
import {
  createDatasetRoutes,
  createExecutionRoutes,
  createObjectRoutes,
  createOneShotRoutes,
  createPackageFunctionRoutes,
  createPackageRoutes,
  createPackageTransferRoutes,
  createRepositoriesRoutes,
  createRepositoryGate,
  createRepositoryRoutes,
  createTaskRoutes,
  createTransferRoutes,
  createWorkspaceFunctionRoutes,
  createWorkspaceRecordRoutes,
  createWorkspaceRoutes,
  type Identity,
  type OneShotAccess,
} from '@elaraai/e3-api-server/portable';
import type { WebStorage } from './storage/WebStorage.js';
import { createWebDataEndpoints } from './transfer/endpoints.js';
import type { WebTransferBackend } from './transfer/WebTransferBackend.js';

/**
 * Says who calls: the identity of a request's caller, or none.
 *
 * @remarks
 * The identity is what a server's auth sets on a request's context, and what
 * the routes that answer by who calls read: `oneShotAccessByRoles` grants by
 * its roles, and the record routes commit as it and gate compaction on its
 * roles. A request to a repository whose caller it gives none for is answered
 * 401, as e3-api-server's auth middleware answers a caller it cannot verify:
 * `Unauthorized: Missing Bearer token` with no bearer token, `Unauthorized:
 * Invalid token` with one, and `Unauthorized: <message>` when it throws.
 *
 * @param request - The request, as the page sent it: its `Authorization`
 *   header among its headers
 * @returns The caller's identity, or `null` or `undefined` for none
 */
export type Identify = (request: Request) => Identity | null | undefined | Promise<Identity | null | undefined>;

/**
 * What {@link createWebApp} mounts the routes over.
 */
export interface WebAppSeams {
  /** The storage the repositories are kept in */
  readonly storage: WebStorage;
  /** The transfers and jobs: its URLs are the byte endpoints this app serves */
  readonly transfer: WebTransferBackend;
  /** Each repository's runner */
  readonly getRunner: (repo: string) => TaskRunner;
  /** What runs every repository's dataflows, and cancels one */
  readonly orchestrator: DataflowOrchestrator;
  /** The store every repository's runs keep their state in: the one the
   *  orchestrator writes */
  readonly stateStore: ExecutionStateStore;
  /** The tasks and units a dataflow keeps in flight: the unit pool's width */
  readonly width: number;
  /** The grant each request's caller holds for what it supplies to run */
  readonly access: OneShotAccess;
  /** Who calls, when the host says: a request to a repository whose caller
   *  it does not identify is answered 401. Unset, no request has an
   *  identity, and every request is answered */
  readonly identify?: Identify;
  /** How long a dataset commit waits for its verification before it answers
   *  `processing` for the client to poll: the routes' default unless set */
  readonly commitWaitMs?: number;
}

/** The app: its routes read the caller's identity from its context. */
export type WebApp = Hono<{ Variables: { identity?: Identity } }>;

/**
 * The repository a request names, as WebStorage's stores take it: its name,
 * once it is one.
 *
 * @throws {Error} When the name is not a repository's name: a path, say
 */
function repositoryOf(repo: string): string {
  checkName('repository', repo);
  return repo;
}

/**
 * Creates e3's API over e3-web's seams.
 *
 * @remarks
 * The routes are e3-api-server's own, mounted as the local server mounts them
 * over many repositories, so an e3 in a page answers every request as the
 * local server does:
 * - e3-web's byte endpoints, at `/api/uploads` and `/api/downloads`, ahead of
 *   any identity: their URLs are capabilities;
 * - who calls ({@link WebAppSeams.identify}), set on each request to a
 *   repository, and a caller it does not know answered 401;
 * - the gate every request to a repository passes, which applies the
 *   upgrades it owes in the request, as an in-page request has no time
 *   limit; and the repositories' own routes;
 * - a repository's status, gc, packages and their transfer, workspaces,
 *   datasets and their transfer, tasks, functions and one-shot with its split
 *   calls under the host's `access`, records, the dataflow, and objects.
 *
 * @param seams - The storage, transfers, runners, orchestrator and state
 *   store the routes run over, and who may run what
 * @returns The app, whose `fetch` answers each request
 */
export function createWebApp(seams: WebAppSeams): WebApp {
  const { storage, transfer, getRunner, orchestrator, stateStore, width, access, identify, commitWaitMs } = seams;
  const app: WebApp = new Hono();

  // The byte endpoints: the transfer's id in their URL is their capability,
  // so they are answered ahead of who calls, as the local server's are.
  const data = createWebDataEndpoints(transfer, storage);
  app.route('/api/uploads', data.uploads);
  app.route('/api/downloads', data.downloads);

  // Who calls, set where a server's auth sets it: a caller it does not know
  // is answered as e3-api-server's auth middleware answers one.
  if (identify !== undefined) {
    app.use('/api/repos/:repo/*', async (c, next) => {
      let identity: Identity | null | undefined;
      try {
        identity = await identify(c.req.raw);
      } catch (err) {
        return new Response(`Unauthorized: ${err instanceof Error ? err.message : 'Invalid token'}`, { status: 401 });
      }
      if (identity === null || identity === undefined) {
        const bearer = c.req.header('authorization')?.startsWith('Bearer ') === true;
        return new Response(bearer ? 'Unauthorized: Invalid token' : 'Unauthorized: Missing Bearer token', { status: 401 });
      }
      c.set('identity', identity);
      await next();
    });
  }

  // The repositories, and the gate every request to one passes.
  app.use('/api/repos/:repo/*', createRepositoryGate(storage, repositoryOf));
  app.route('/api/repos', createRepositoriesRoutes(storage));

  // A repository's status, record and gc.
  app.route('/api/repos/:repo', createRepositoryRoutes(storage, repositoryOf, transfer));

  // Packages, and their import and export as jobs.
  const packageTransfer = createPackageTransferRoutes(storage, repositoryOf, transfer);
  app.route('/api/repos/:repo', packageTransfer.repoApi);
  app.route('/api/repos/:repo/packages', packageTransfer.pkgApi);
  app.route('/api/repos/:repo/packages', createPackageRoutes(storage, repositoryOf));
  app.route('/api/repos/:repo/packages/:pkg/:version/functions', createPackageFunctionRoutes(storage, repositoryOf, getRunner, { access }));

  // Workspaces, and their deploys and exports as jobs.
  app.route('/api/repos/:repo/workspaces', createWorkspaceRoutes(storage, repositoryOf, transfer, getRunner));

  // Datasets, and their uploads.
  const datasetTransfer = createTransferRoutes(storage, repositoryOf, transfer, {
    ...(commitWaitMs !== undefined && { commitWaitMs }),
  });
  app.route('/api/repos/:repo/workspaces/:ws/datasets', datasetTransfer.api);
  app.route('/api/repos/:repo/workspaces/:ws/datasets', createDatasetRoutes(storage, repositoryOf, transfer));

  // Tasks, functions, one-shot and its split calls, and records.
  app.route('/api/repos/:repo/workspaces/:ws/tasks', createTaskRoutes(storage, repositoryOf));
  app.route('/api/repos/:repo/workspaces/:ws/functions', createWorkspaceFunctionRoutes(storage, repositoryOf, getRunner, { access }));
  app.route('/api/repos/:repo/workspaces/:ws/one-shot', createOneShotRoutes(storage, repositoryOf, transfer, getRunner, { access }));
  app.route('/api/repos/:repo/workspaces/:ws/records', createWorkspaceRecordRoutes(storage, repositoryOf, getRunner));

  // The dataflow: run, polled and cancelled through the orchestrator, whose
  // runs keep their state in the store.
  app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(storage, repositoryOf, {
    getRunner,
    getOrchestrator: () => orchestrator,
    getStateStore: () => stateStore,
    width,
  }));

  // Objects by hash: a large one is answered by download URL.
  app.route('/api/repos/:repo/objects', createObjectRoutes(storage, repositoryOf, transfer));

  return app;
}
