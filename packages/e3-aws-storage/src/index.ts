/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

// Main storage backend
export { S3DynamoStorage } from './s3-dynamo-storage.js';

// Individual stores (for advanced usage)
export { S3ObjectStore, ObjectNotFoundError } from './s3-object-store.js';
export {
  DynamoRefStore,
  DynamoDataflowRunStore,
  InvalidRepoStatusError,
} from './dynamo-ref-store.js';
// Re-export types from e3-cloud-core (previously defined in dynamo-ref-store.ts)
export type {
  RepoStatus,
  RepoMetadata,
  DataflowExecution,
  TaskExecutionStatus,
  DataflowEvent,
} from '@elaraai/e3-cloud-core';
export { DynamoLockService, setLambdaRequestId } from './dynamo-lock-service.js';
export { DynamoLogStore } from './dynamo-log-store.js';
export { DynamoS3RepoStore } from './dynamo-s3-repo-store.js';
export { DynamoDBStateStore } from './dynamo-state-store.js';
export { DynamoAclStore } from './dynamo-acl-store.js';
export { DynamoScheduleStore } from './dynamo-schedule-store.js';
export { DynamoTaskConfigStore } from './dynamo-task-config-store.js';
export { DynamoComputeResultStore } from './dynamo-compute-result-store.js';
export { SfnDataflowOrchestrator } from './sfn-dataflow-orchestrator.js';

// Re-export types from e3-core for convenience
export type { ExecutionStateStore } from '@elaraai/e3-core';
