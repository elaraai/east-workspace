/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The contract suites every storage backend runs: each registers its cases
 * over a backend its caller sets up. e3-core runs them over its local and
 * in-memory backends; another backend runs them over its own. The transfer
 * stores' suites — a record load's jobs, and uploads that write no ref — run
 * over a backend's transfer stores the same way.
 */

export type { BackendContext, BackendDamage, BackendSetup } from './setup.js';
export { objectStoreTests } from './object-store.js';
export { refStoreTests } from './ref-store.js';
export { datasetRefStoreTests } from './dataset-ref-store.js';
export { lockServiceTests } from './lock-service.js';
export { logStoreTests } from './log-store.js';
export { functionCallStoreTests } from './function-call-store.js';
export { recordLoadStoreTests, type RecordLoadStoreContext, type RecordLoadStoreSetup } from './record-load-store.js';
export { objectUploadStoreTests, type ObjectUploadStoreContext, type ObjectUploadStoreSetup } from './object-upload-store.js';
export { repoStoreTests, type RepositoriesContext, type RepositoriesSetup } from './repo-store.js';
export {
  executionStateStoreTests, type ExecutionStateStoreContext, type ExecutionStateStoreSetup,
} from './execution-state-store.js';
export { dataflowTests } from './dataflow.js';
export { executionCacheTests } from './execution-cache.js';
export { gcTests } from './gc.js';
export { repositoryRecordTests } from './repository-record.js';
export { workspaceStatusTests } from './workspace-status.js';
export { workspaceDeployTests } from './workspace-deploy.js';
export { workspaceCopyTests } from './workspace-copy.js';
export { workspaceBundleTests } from './workspace-bundle.js';
