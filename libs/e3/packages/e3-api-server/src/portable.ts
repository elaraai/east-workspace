/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3-api-server, portable: the routes that run wherever JavaScript does.
 *
 * This entry (`@elaraai/e3-api-server/portable`) is the route factories, the
 * handlers and the repository gate, with nothing of the machine they run on:
 * every module it reaches imports only another of them, East, e3's types,
 * e3-core's portable entry and Hono, and names none of Node's globals, which
 * `portable.spec.ts` checks through every module it reaches. A host mounts the
 * factories over the seams it gives them — its storage, its runner, its
 * transfer backend, its orchestrator and state store, and its `OneShotAccess`
 * — as the local server does over its own, and as an e3 in a browser page
 * does over the page's.
 *
 * The root entry (`@elaraai/e3-api-server`) exports every one of these, the
 * same functions and objects, and adds what needs Node:
 *
 * - the local server (`createServer`), its budget, and its byte endpoints
 *   (`createDataEndpoints`), which stage uploads and downloads as files in the
 *   repository — a host serves those URLs itself, as S3 does for e3-cloud;
 * - auth: the token middleware, the OIDC provider and the keys it signs with.
 *
 * @packageDocumentation
 */

// =============================================================================
// Route factories
// =============================================================================

// The repositories a host keeps, and a server of one
export { createRepositoriesRoutes, createSingleRepositoryRoutes } from './routes/repositories.js';

// A repository's status, record and gc
export { createRepositoryRoutes } from './routes/repository.js';

// Packages, and their import and export as jobs
export { createPackageRoutes } from './routes/packages.js';
export { createPackageTransferRoutes } from './routes/package-transfer.js';

// Workspaces, and their deploys and exports as jobs
export { createWorkspaceRoutes } from './routes/workspaces.js';

// Datasets — whole, paged and searched by key — and their uploads
export { createDatasetRoutes } from './routes/datasets.js';
export { createTransferRoutes, type TransferRouteOptions } from './routes/transfer.js';

// Tasks and their executions
export { createTaskRoutes } from './routes/tasks.js';

// A workspace's dataflow, over the orchestrator and state store a host gives
export { createExecutionRoutes, type DataflowSeams, type RunnerBudget } from './routes/executions.js';

// Objects by hash
export { createObjectRoutes } from './routes/objects.js';

// Functions and one-shot, under the grant the host's access gives each caller
export {
  createPackageFunctionRoutes,
  createWorkspaceFunctionRoutes,
  createOneShotRoutes,
  oneShotAccessByRoles,
  type GetRunner,
  type OneShotAccess,
  type OneShotRoutesOptions,
  type FunctionRoutesOptions,
} from './routes/functions.js';

// Record mutations and history, under the host's deadline and history page
export { createWorkspaceRecordRoutes, type RecordRoutesOptions } from './routes/records.js';

// =============================================================================
// Handlers
// =============================================================================

export * from './handlers/index.js';

// =============================================================================
// The gate, and who calls
// =============================================================================

// The gate every request to one repository passes
export { createRepositoryGate, createSingleRepositoryGate, type RepositoryGateOptions } from './middleware/repository.js';

// What a host's auth sets on a request's context, which the one-shot access by
// roles and the record routes read
export type { Identity } from './identity.js';

// =============================================================================
// Wire types and BEAST2 helpers
// =============================================================================

export { ApiTypes } from './types.js';
export { sendSuccess, sendError, sendSuccessWithStatus, decodeBeast2, decodeBody } from './beast2.js';
