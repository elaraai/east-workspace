/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * @elaraai/e3-cloud-core
 *
 * Core authorization logic and interfaces for e3 admin.
 *
 * This package provides:
 * - Cloud-agnostic storage interfaces (AclStore, IdentityBackend)
 * - Authorization business logic (hasAccess, canRemoveUser, isLastOwner)
 * - Error classes for admin operations
 *
 * For testing utilities, import from '@elaraai/e3-cloud-core/testing'.
 */

// Interfaces
export type { AclStore, Identity, IdentityBackend } from './interfaces.js';
export type { DataflowStorage, CloudLockService } from './dataflow-storage.js';
export type { ScheduleStore } from './schedule-store.js';
export type { TaskConfigStore } from './task-config-store.js';
export type { ComputeResultStore } from './compute-result-store.js';
export type { RepoManager, RepoStatus, RepoMetadata } from './repo-manager.js';
export type { DataflowRunStore } from './dataflow-run-store.js';
export type { DataflowOrchestrator } from './dataflow-orchestrator.js';
export type { GcOrchestrator, GcStatus, GcStats } from './gc-orchestrator.js';
export type { SchedulerService } from './scheduler-service.js';
export type {
  ExecutionTracker,
  DataflowExecution,
  TaskExecutionStatus,
  DataflowEvent,
} from './execution-tracker.js';
export type { ComputeDispatcher } from './compute-dispatcher.js';
export type { GcTempStore } from './gc-temp-store.js';
export type { GcCleanupStore } from './gc-cleanup-store.js';
export type { UserSettingsStore } from './user-settings-store.js';

// Authorization functions
export { hasAccess, isLastOwner, canRemoveUser, type AuthzResult } from './authz.js';

// Errors
export { AdminCoreError, UserNotFoundError, RepoNotFoundError, RepoAlreadyExistsError, InvalidRepoStatusError, WorkspaceNotFoundError, WorkspaceLockedError, errorCodeToStatus } from './errors.js';

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
