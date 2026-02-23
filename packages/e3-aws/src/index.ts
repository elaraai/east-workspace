/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 *
 * AWS implementation for e3 cloud platform.
 *
 * Re-exports storage classes and services for use by CDK and other consumers.
 */

// Storage
export { S3DynamoStorage } from './storage/s3-dynamo-storage.js';
export { S3ObjectStore } from './storage/s3-object-store.js';
export {
  DynamoRefStore,
  DynamoDataflowRunStore,
  InvalidRepoStatusError,
} from './storage/dynamo-ref-store.js';
export type {
  RepoStatus,
  RepoMetadata,
  DataflowExecution,
  TaskExecutionStatus,
  DataflowEvent,
} from '@elaraai/e3-cloud-core';
export { DynamoLockService, setLambdaRequestId } from './storage/dynamo-lock-service.js';
export { DynamoLogStore } from './storage/dynamo-log-store.js';
export { DynamoS3RepoStore } from './storage/dynamo-s3-repo-store.js';
export { DynamoDBStateStore } from './storage/dynamo-state-store.js';
export { DynamoAclStore } from './storage/dynamo-acl-store.js';
export { DynamoScheduleStore } from './storage/dynamo-schedule-store.js';
export { DynamoTaskConfigStore } from './storage/dynamo-task-config-store.js';
export { DynamoComputeResultStore } from './storage/dynamo-compute-result-store.js';
export type { ExecutionStateStore } from '@elaraai/e3-core';

// Services
export { SfnDataflowOrchestrator } from './services/sfn-dataflow-orchestrator.js';
export { SfnGcOrchestrator } from './services/sfn-gc-orchestrator.js';
export { EventBridgeSchedulerService } from './services/eventbridge-scheduler.js';
export { CognitoIdentityBackend } from './services/cognito-identity.js';
