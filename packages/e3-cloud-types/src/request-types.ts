/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * API request and response type definitions.
 *
 * These types define the structure of API payloads for authorization endpoints.
 */

import { StructType, StringType, BooleanType, OptionType, ValueTypeOf } from '@elaraai/east';
import { RepoRoleType } from './repo-role.js';

/**
 * Request body for adding a user to a repository.
 *
 * POST /repos/:repo/users
 */
export const AddUserRequestType = StructType({
  /** Email of user to add (must have logged in at least once) */
  email: StringType,

  /** Role to assign */
  role: RepoRoleType,
});

export type AddUserRequest = ValueTypeOf<typeof AddUserRequestType>;

/**
 * Response from /api/whoami endpoint.
 *
 * Returns the current user's identity and admin status.
 */
export const WhoamiResponseType = StructType({
  /** Cognito subject ID */
  sub: StringType,

  /** Email address (if available) */
  email: OptionType(StringType),

  /** Display name (if available) */
  name: OptionType(StringType),

  /** Whether user is a server admin */
  isAdmin: BooleanType,
});

export type WhoamiResponse = ValueTypeOf<typeof WhoamiResponseType>;
