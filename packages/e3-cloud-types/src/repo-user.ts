/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Repository user type definitions.
 *
 * A RepoUser represents an entry in a repository's access control list (ACL).
 * Each entry maps a user (by Cognito subject ID) to a role on the repository.
 */

import { StructType, StringType, OptionType, ValueTypeOf } from '@elaraai/east';
import { RepoRoleType } from './repo-role.js';

/**
 * A user entry in a repository's ACL.
 *
 * Stored in DynamoDB with PK=ACL#{repo}, SK=USER#{userId}
 */
export const RepoUserType = StructType({
  /** User's Cognito subject ID (immutable, primary key) */
  userId: StringType,

  /** User's email address (for display, fetched from Cognito) */
  email: StringType,

  /** User's display name (optional, from Cognito) */
  name: OptionType(StringType),

  /** User's role on this repository */
  role: RepoRoleType,

  /** userId of the user who added this entry */
  addedBy: StringType,

  /** ISO 8601 timestamp when user was added */
  addedAt: StringType,
});

export type RepoUser = ValueTypeOf<typeof RepoUserType>;
