/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * e3-admin-client: HTTP client library for e3 admin API
 *
 * This package provides a typed HTTP client for interacting with the e3 admin API,
 * following patterns from e3-api-client for consistency.
 *
 * Features:
 * - Type-safe request/response handling using East types
 * - BEAST2 binary serialization format
 * - Response<T> wrapper for explicit error handling
 *
 * @example
 * ```typescript
 * import { whoami, repoUsers, addUser, unwrap } from '@elaraai/e3-admin-client';
 * import { variant } from '@elaraai/east';
 *
 * const options = { token: accessToken };
 *
 * // Get current user
 * const me = unwrap(await whoami('https://e3.example.com', options));
 *
 * // Add a user with member role
 * const user = unwrap(await addUser(
 *   'https://e3.example.com',
 *   'my-repo',
 *   { email: 'bob@example.com', role: variant('member', null) },
 *   options
 * ));
 * ```
 */

// Errors and utilities
export {
  AdminError,
  AuthError,
  unwrap,
  type RequestOptions,
  type Response,
} from './http.js';

// API functions
export { whoami, repoUsers, addUser, removeUser } from './users.js';

// Re-export types from e3-admin-types for convenience
export type {
  RepoRole,
  RepoUser,
  AddUserRequest,
  WhoamiResponse,
  AuthzErrorCode,
} from '@elaraai/e3-admin-types';
