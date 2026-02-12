/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * @elaraai/e3-admin-core
 *
 * Core authorization logic and interfaces for e3 admin.
 *
 * This package provides:
 * - Cloud-agnostic storage interfaces (AclStore, WhoamiBackend)
 * - Authorization business logic (hasAccess, canRemoveUser, isLastOwner)
 * - Error classes for admin operations
 *
 * For testing utilities, import from '@elaraai/e3-admin-core/testing'.
 */

// Interfaces
export type { AclStore, Identity, WhoamiBackend } from './interfaces.js';
export type { ScheduleStore } from './schedule-store.js';

// Authorization functions
export { hasAccess, isLastOwner, canRemoveUser, type AuthzResult } from './authz.js';

// Errors
export { AdminCoreError, UserNotFoundError, RepoNotFoundError, errorCodeToStatus } from './errors.js';

// Re-export types from e3-admin-types for convenience
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
} from '@elaraai/e3-admin-types';
