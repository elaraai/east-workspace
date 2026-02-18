/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * e3-cloud-client: HTTP client library for e3 admin API
 *
 * This package provides a typed HTTP client for interacting with the e3 admin API,
 * building on e3-api-client's HTTP utilities.
 *
 * Features:
 * - Type-safe request/response handling using East types
 * - BEAST2 binary serialization format
 * - Exception-based error handling (throws ApiError on failures)
 *
 * @example
 * ```typescript
 * import { whoami, repoUsers, addUser, ApiError } from '@elaraai/e3-cloud-client';
 * import { variant } from '@elaraai/east';
 *
 * const options = { token: accessToken };
 *
 * // Get current user
 * const me = await whoami('https://e3.example.com', options);
 *
 * // Add a user with member role
 * try {
 *   const user = await addUser(
 *     'https://e3.example.com',
 *     'my-repo',
 *     { email: 'bob@example.com', role: variant('member', null) },
 *     options
 *   );
 * } catch (error) {
 *   if (error instanceof ApiError) {
 *     console.error(`Failed: ${error.code}`);
 *   }
 * }
 * ```
 */

// Re-export HTTP utilities from e3-api-client
export { ApiError, AuthError, type RequestOptions } from '@elaraai/e3-api-client';

// API functions
export { whoami, repoUsers, addUser, removeUser } from './users.js';
export { getSchedule, setSchedule, removeSchedule, listSchedules } from './schedules.js';
export {
  listCompute, getCompute, setCompute, setComputeBatch, removeCompute,
  listTimeout, getTimeout, setTimeout, setTimeoutBatch, removeTimeout,
  listTaskConfigs,
} from './task-configs.js';

// Re-export types from e3-cloud-types for convenience
export type {
  RepoRole,
  RepoUser,
  AddUserRequest,
  WhoamiResponse,
  AuthzErrorCode,
  Schedule,
  ScheduleRequest,
  ComputeSize,
  ComputeConfigMap,
  TaskTimeout,
  TimeoutConfigMap,
  TaskConfigs,
} from '@elaraai/e3-cloud-types';
