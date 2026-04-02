/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * e3-cloud-types: Shared East type definitions for e3-aws authorization
 *
 * This package defines the East types used for authorization in e3-aws:
 * - Repository roles (owner, member)
 * - Repository user ACL entries
 * - API request/response types
 * - Error types
 *
 * All types are defined as East types (using StructType, VariantType, etc.)
 * with corresponding TypeScript types derived via ValueTypeOf.
 */

// Repository roles
export {
  RepoRoleType,
  type RepoRole,
  parseRepoRole,
  serializeRepoRole,
} from './repo-role.js';

// Repository user ACL entries
export {
  RepoUserType,
  type RepoUser,
} from './repo-user.js';

// API request/response types
export {
  AddUserRequestType,
  type AddUserRequest,
  WhoamiResponseType,
  type WhoamiResponse,
} from './request-types.js';

// Error types
export {
  AuthzErrorCodeType,
  type AuthzErrorCode,
  AuthzErrorType,
  type AuthzError,
} from './error-types.js';

// Schedule types
export {
  TriggeredByType,
  type TriggeredBy,
  ScheduleType,
  type Schedule,
  ScheduleRequestType,
  type ScheduleRequest,
} from './schedule-types.js';

// Task config types
export {
  ComputeSizeType,
  type ComputeSize,
  TaskTimeoutType,
  type TaskTimeout,
  ComputeConfigMapType,
  type ComputeConfigMap,
  TimeoutConfigMapType,
  type TimeoutConfigMap,
  TaskConfigsType,
  type TaskConfigs,
  TIMEOUT_MIN_MINUTES,
  TIMEOUT_MAX_MINUTES,
  DEFAULT_TIMEOUT_SERVERLESS,
  DEFAULT_TIMEOUT_FARGATE,
} from './task-config-types.js';