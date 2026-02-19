/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * @elaraai/e3-cloud-core
 *
 * Core authorization logic and interfaces for e3 admin.
 *
 * This package provides:
 * - Cloud-agnostic storage interfaces (AclStore, WhoamiBackend)
 * - Authorization business logic (hasAccess, canRemoveUser, isLastOwner)
 * - Error classes for admin operations
 *
 * For testing utilities, import from '@elaraai/e3-cloud-core/testing'.
 */

// Interfaces
export type { AclStore, Identity, WhoamiBackend } from './interfaces.js';
export type { ScheduleStore } from './schedule-store.js';
export type { TaskConfigStore } from './task-config-store.js';
export type { ComputeResultStore } from './compute-result-store.js';
export type { RepoManager, RepoStatus, RepoMetadata } from './repo-manager.js';
export type { DataflowRunStore } from './dataflow-run-store.js';
export type {
  ExecutionTracker,
  DataflowExecution,
  TaskExecutionStatus,
  DataflowEvent,
} from './execution-tracker.js';

// Authorization functions
export { hasAccess, isLastOwner, canRemoveUser, type AuthzResult } from './authz.js';

// Errors
export { AdminCoreError, UserNotFoundError, RepoNotFoundError, errorCodeToStatus } from './errors.js';

// Re-export types from e3-cloud-types for convenience
export type {
  RepoRole,
  RepoUser,
  AddUserRequest,
  WhoamiResponse,
  AuthzErrorCode,
  AuthzError,
  Schedule,
  ScheduleRequest,
  TriggeredBy,
  ComputeSize,
  TaskTimeout,
  ComputeConfigMap,
  TimeoutConfigMap,
} from '@elaraai/e3-cloud-types';
