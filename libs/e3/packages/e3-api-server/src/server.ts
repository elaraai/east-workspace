/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve, type ServerType } from '@hono/node-server';
import {
  Budget, DOOR_FRAME_WORKERS, LocalStorage, LocalTaskRunner, InMemoryTransferBackend, resolveBudget, checkName, repositoryOpen,
} from '@elaraai/e3-core';
import type { BudgetSettings, StorageBackend, TaskRunner, TransferBackend } from '@elaraai/e3-core';
import { createAuthMiddleware, type AuthConfig } from './middleware/auth.js';
import { createRepositoryGate, createSingleRepositoryGate } from './middleware/repository.js';
import { createOidcProvider, type OidcProvider, type OidcConfig } from './auth/index.js';
import { configureFramePool } from '@elaraai/east';
import { createRepositoriesRoutes, createSingleRepositoryRoutes } from './routes/repositories.js';
import { createPackageRoutes } from './routes/packages.js';
import { createWorkspaceRoutes } from './routes/workspaces.js';
import { createDatasetRoutes } from './routes/datasets.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createExecutionRoutes } from './routes/executions.js';
import { createRepositoryRoutes } from './routes/repository.js';
import { createObjectRoutes } from './routes/objects.js';
import { createTransferRoutes } from './routes/transfer.js';
import { createPackageTransferRoutes } from './routes/package-transfer.js';
import { createDataEndpoints } from './routes/data.js';
import { createPackageFunctionRoutes, createWorkspaceFunctionRoutes, createOneShotRoutes, oneShotAccessByRoles } from './routes/functions.js';
import { createWorkspaceRecordRoutes } from './routes/records.js';
import { localDataflow } from './local-dataflow.js';
import type { DataflowRunnerLease } from './dataflow-runner.js';

export type { DataflowRunnerLease } from './dataflow-runner.js';

/** Supplies the server's existing runtime collaborators to a per-run factory. */
export interface DataflowRunnerContext {
  /** The backend used by every route in this server. */
  storage: StorageBackend;
  /** The same budget used by dataflows, calls, mutations and intake. */
  budget: Budget;
}

/** Opens a runner for one dataflow; undefined or a thrown error uses the local runner. */
export type DataflowRunnerFactory = (repoPath: string, workspace: string, context: DataflowRunnerContext) => Promise<DataflowRunnerLease | undefined>;

export type { AuthConfig } from './middleware/auth.js';
export type { OidcConfig } from './auth/index.js';

/**
 * Server configuration options.
 *
 * Must specify exactly one of:
 * - reposDir: Multi-repo mode - serves multiple repositories from subdirectories
 * - singleRepoPath: Single-repo mode - serves a single repository at /repos/default
 */
export interface ServerConfig {
  /** Directory containing repositories (multi-repo mode) */
  reposDir?: string;
  /** Path to a single repository (single-repo mode, access via /repos/default) */
  singleRepoPath?: string;
  /** HTTP port (default: 3000) */
  port?: number;
  /** Bind address (default: "localhost") */
  host?: string;
  /** Enable CORS for cross-origin requests (default: false) */
  cors?: boolean;
  /** Optional JWT authentication config (for external JWKS validation) */
  auth?: AuthConfig;
  /** Optional OIDC provider config (enables built-in auth server) */
  oidc?: OidcConfig;
  /** Byte budget clamping each dataset page's share of the source blob
   *  (default: 4 MiB). Lower it for deployments with tight response limits. */
  pageByteBudget?: number;
  /** Size of the parts a dataset upload is sent in (default: 64 MiB). An
   *  upload no larger is one part; a smaller size suits a proxy that caps
   *  request bodies. */
  transferPartBytes?: number;
  /** How long a dataset commit waits for the upload to be verified before
   *  answering `processing` for the client to poll (default: 5000 ms; 0
   *  answers `processing` at once). Keep it under any proxy's request
   *  timeout. */
  transferCommitWaitMs?: number;
  /** The server's budget of cores and memory, which every runner process it
   *  spawns takes from: dataflow tasks and units, function calls, mutations
   *  and index builds, across every run. A {@link Budget}, or the settings
   *  to resolve one from, as `-j` and `--memory` give them (default:
   *  `E3_JOBS` and `E3_MEMORY`, else what the process may use); settings
   *  that do not resolve make `createServer` throw a `RangeError`. */
  budget?: Budget | BudgetSettings;
  /** Opens a per-run runner attachment, closed when the run ends. */
  dataflowRunner?: DataflowRunnerFactory;
}

/**
 * Server instance handle.
 */
export interface Server {
  /** Start the server */
  start(): Promise<void>;
  /** Stop the server */
  stop(): Promise<void>;
  /** The underlying HTTP server */
  readonly httpServer: ServerType;
  /** The port the server is listening on */
  readonly port: number;
}

/**
 * Create an e3 API server.
 *
 * The server operates in multi-repo mode, serving multiple repositories
 * from subdirectories of the configured reposDir.
 *
 * URL structure:
 * - GET /api/repos - List available repositories
 * - /api/repos/:repo/... - Repository-specific endpoints
 *
 * @param config - Server configuration
 * @returns Server instance
 * @throws {RangeError} When the budget's settings do not resolve
 * @throws {RepoNotFoundError} When the single repository is none
 * @throws {RepoLayoutError} When this e3 cannot open the single repository
 */
export async function createServer(config: ServerConfig): Promise<Server> {
  const {
    reposDir, singleRepoPath, port = 3000, host = 'localhost', cors: enableCors = false, auth, oidc, pageByteBudget,
    transferPartBytes, transferCommitWaitMs,
  } = config;
  const budget = config.budget instanceof Budget ? config.budget : resolveBudget(config.budget);
  // The store door frames on e3's own pool, whose workers take cores too.
  configureFramePool({ workers: Math.min(DOOR_FRAME_WORKERS, budget.cores) });

  // Validate config: exactly one of reposDir or singleRepoPath must be specified
  if (reposDir && singleRepoPath) {
    throw new Error('Cannot specify both reposDir and singleRepoPath');
  }
  if (!reposDir && !singleRepoPath) {
    throw new Error('Must specify either reposDir or singleRepoPath');
  }

  const isSingleRepoMode = !!singleRepoPath;

  // Single storage instance shared across all requests
  // Pass reposDir for multi-repo mode to enable storage.repos.* operations
  const storage: StorageBackend = new LocalStorage(isSingleRepoMode ? undefined : reposDir);

  // The one repository is opened before anything is served, as the CLI opens
  // one: refused when this e3 cannot read it, and upgraded in place when an
  // older release wrote it. Several are each opened by every request to them
  // (the middleware below).
  if (isSingleRepoMode) await repositoryOpen(storage, singleRepoPath!);

  // Helper to compute repo path from repo name
  // In single-repo mode, middleware validates 'default' before routes are called
  const getRepoPath = (repoName: string): string => {
    if (isSingleRepoMode) {
      // Middleware ensures repoName === 'default' before we get here
      return singleRepoPath!;
    }
    // A name from the URL becomes a directory under reposDir, never a path out
    // of it.
    checkName('repository', repoName);
    return path.join(reposDir!, repoName);
  };

  const app = new Hono();

  // Enable CORS if configured. Response metadata rides on X-* headers
  // (content hash, paged-read totals) — expose them so browser clients can
  // read them cross-origin.
  if (enableCors) {
    app.use('*', cors({
      origin: '*',
      exposeHeaders: [
        'X-Content-SHA256', 'X-Content-Length',
        'X-Total-Bytes', 'X-Total-Elements', 'X-Total-Exactness', 'X-Segment-Count', 'X-Page-Offset', 'X-Page-Count',
      ],
    }));
    // Allow Private Network Access (required for extension webviews on WiFi)
    app.use('*', async (c, next) => {
      await next();
      if (c.req.header('Access-Control-Request-Private-Network') === 'true') {
        c.header('Access-Control-Allow-Private-Network', 'true');
      }
    });
  }

  // Create OIDC provider if configured (built-in auth server)
  let oidcProvider: OidcProvider | undefined;
  if (oidc) {
    oidcProvider = createOidcProvider(oidc);
    // Mount OIDC routes at root (/.well-known/*, /oauth2/*, /device)
    app.route('/', oidcProvider.routes);
  }

  // Per-repo task runner for every route that runs user East, and every
  // delivery a server takes in: dataflows, function and one-shot calls, record
  // mutations, a deploy job's migrations and index builds, and an upload's
  // intake units, all on the server's one budget (cached — the runner holds its
  // repo anchor, the budget, and which runner it found cannot run an intake)
  const runners = new Map<string, TaskRunner>();
  const getRunner = (repoPath: string): TaskRunner => {
    let runner = runners.get(repoPath);
    if (!runner) {
      runner = new LocalTaskRunner(repoPath, budget);
      runners.set(repoPath, runner);
    }
    return runner;
  };

  // Transfer backend for presigned URL object transfer, and the jobs that
  // outlast a request, which it runs in this process
  const transferBackend: TransferBackend = new InMemoryTransferBackend({
    baseUrl: '',
    storage,
    getRepoPath,
    getRunner,
    ...(transferPartBytes !== undefined && { partBytes: transferPartBytes }),
  });

  // Data routes (no auth — capability-URL pattern via UUID)
  // Must be mounted BEFORE auth middleware so they bypass JWT validation.
  // In cloud deployments these URLs are S3 presigned URLs that reject auth headers.
  const pkgTransfer = createPackageTransferRoutes(storage, getRepoPath, transferBackend);
  const dsTransfer = createTransferRoutes(storage, getRepoPath, transferBackend, {
    ...(transferCommitWaitMs !== undefined && { commitWaitMs: transferCommitWaitMs }),
  });
  const dataEndpoints = createDataEndpoints(transferBackend, storage, getRepoPath);
  app.route('/api/uploads', dataEndpoints.uploads);
  app.route('/api/downloads', dataEndpoints.downloads);

  // Apply auth middleware to all repo-specific routes if configured
  // If OIDC is enabled but auth is not separately configured, use OIDC keys for validation
  if (auth) {
    const authMiddleware = await createAuthMiddleware(auth);
    app.use('/api/repos/:repo/*', authMiddleware);
  } else if (oidcProvider) {
    // Use the OIDC provider's keys for JWT validation
    const authMiddleware = await createAuthMiddleware({
      jwksUrl: `${oidc!.baseUrl}/.well-known/jwks.json`,
      issuer: oidc!.baseUrl,
      audience: oidc!.baseUrl,
      // Provide keys directly to avoid HTTP fetch to self
      _internalKeys: oidcProvider.keys,
    });
    app.use('/api/repos/:repo/*', authMiddleware);
  }

  // The repositories the server serves, and the gate every request to one
  // passes, mounted after the auth middleware and ahead of the repository
  // routes
  if (isSingleRepoMode) {
    app.route('/api/repos', createSingleRepositoryRoutes());
    app.use('/api/repos/:repo/*', createSingleRepositoryGate());
  } else {
    app.use('/api/repos/:repo/*', createRepositoryGate(storage, getRepoPath));
    app.route('/api/repos', createRepositoriesRoutes(storage));
  }

  // Mount repository-specific routes
  // Each route file creates a sub-app that uses getRepoPath to resolve the repo

  // Repository status and GC: /api/repos/:repo/status, /api/repos/:repo/gc
  app.route('/api/repos/:repo', createRepositoryRoutes(storage, getRepoPath, transferBackend));

  // Package transfer routes: repo-level import/export + package-level export trigger
  app.route('/api/repos/:repo', pkgTransfer.repoApi);
  app.route('/api/repos/:repo/packages', pkgTransfer.pkgApi);

  // Package routes: /api/repos/:repo/packages/*
  app.route('/api/repos/:repo/packages', createPackageRoutes(storage, getRepoPath));

  // Who may run what a caller supplies: with auth, an elevated role runs any
  // one-shot, and gives a function's runner any platform package, and any
  // other caller a platform-free one-shot, and a function on its own runner;
  // without, the server is single-tenant — its author is its operator — and
  // runs any.
  const access = auth || oidcProvider ? oneShotAccessByRoles() : () => 'any' as const;

  // Package-scoped function routes: /api/repos/:repo/packages/:pkg/:version/functions/*
  app.route('/api/repos/:repo/packages/:pkg/:version/functions', createPackageFunctionRoutes(storage, getRepoPath, getRunner, { access }));

  // Workspace routes: /api/repos/:repo/workspaces/*
  app.route('/api/repos/:repo/workspaces', createWorkspaceRoutes(storage, getRepoPath, transferBackend, getRunner));

  // Dataset transfer auth routes (init + commit) mount alongside dataset routes
  app.route('/api/repos/:repo/workspaces/:ws/datasets', dsTransfer.api);

  // Dataset routes: /api/repos/:repo/workspaces/:ws/datasets/*
  app.route('/api/repos/:repo/workspaces/:ws/datasets', createDatasetRoutes(storage, getRepoPath, transferBackend, {
    ...(pageByteBudget !== undefined && { pageByteBudget }),
  }));

  // Task routes: /api/repos/:repo/workspaces/:ws/tasks/*
  app.route('/api/repos/:repo/workspaces/:ws/tasks', createTaskRoutes(storage, getRepoPath));

  // Workspace-scoped function routes: /api/repos/:repo/workspaces/:ws/functions/*
  app.route('/api/repos/:repo/workspaces/:ws/functions', createWorkspaceFunctionRoutes(storage, getRepoPath, getRunner, { access }));

  // One-shot routes: /api/repos/:repo/workspaces/:ws/one-shot/*, and the split
  // calls launched under the same grant, run as jobs on the transfer backend.
  app.route('/api/repos/:repo/workspaces/:ws/one-shot', createOneShotRoutes(storage, getRepoPath, transferBackend, getRunner, { access }));

  // Workspace-scoped record routes: /api/repos/:repo/workspaces/:ws/records/*
  app.route('/api/repos/:repo/workspaces/:ws/records', createWorkspaceRecordRoutes(storage, getRepoPath, getRunner));

  // Execution/Dataflow routes: /api/repos/:repo/workspaces/:ws/dataflow/*,
  // run, polled and cancelled through each repository's local orchestrator
  // and the state store it writes
  app.route('/api/repos/:repo/workspaces/:ws/dataflow', createExecutionRoutes(storage, getRepoPath, {
    getRunner, ...localDataflow(storage), width: budget.cores, budget,
    dataflowRunner: config.dataflowRunner === undefined ? undefined
      : (repoPath, workspace) => config.dataflowRunner!(repoPath, workspace, { storage, budget }),
  }));

  // Object routes: /api/repos/:repo/objects/:hash — a large object is answered
  // by download URL, as a dataset is
  app.route('/api/repos/:repo/objects', createObjectRoutes(storage, getRepoPath, transferBackend));

  let httpServer: ServerType | null = null;
  let actualPort = port;

  const server: Server = {
    async start() {
      return new Promise((resolve) => {
        httpServer = serve({
          fetch: app.fetch,
          port,
          hostname: host,
        }, (info) => {
          actualPort = info.port;
          resolve();
        });
      });
    },

    async stop() {
      return new Promise((resolve, reject) => {
        if (!httpServer) {
          resolve();
          return;
        }
        // Force close all connections immediately
        (httpServer as unknown as { closeAllConnections(): void }).closeAllConnections();
        httpServer.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },

    get httpServer() {
      if (!httpServer) {
        throw new Error('Server not started');
      }
      return httpServer;
    },

    get port() {
      return actualPort;
    },
  };

  return server;
}
