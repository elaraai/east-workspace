/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Authorization error type definitions.
 *
 * These types define the structure of error responses for authorization failures.
 */

import { StructType, VariantType, StringType, NullType, ValueTypeOf } from '@elaraai/east';

/**
 * Error codes for authorization failures.
 *
 * - `.unauthorized` - User is not authenticated
 * - `.forbidden` - User lacks required permissions
 * - `.last_owner` - Cannot remove the last owner from a repository
 * - `.user_not_found` - Target user not found in Cognito
 */
export const AuthzErrorCodeType = VariantType({
  unauthorized: NullType,
  forbidden: NullType,
  last_owner: NullType,
  user_not_found: NullType,
});

export type AuthzErrorCode = ValueTypeOf<typeof AuthzErrorCodeType>;

/**
 * Error response for authorization failures.
 */
export const AuthzErrorType = StructType({
  /** Error code indicating the type of failure */
  error: AuthzErrorCodeType,

  /** Human-readable error message */
  message: StringType,
});

export type AuthzError = ValueTypeOf<typeof AuthzErrorType>;
