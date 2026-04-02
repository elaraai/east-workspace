/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Repository role type definitions.
 *
 * A role determines what actions a user can perform on a repository:
 * - owner: Full access + manage ACL + delete repo
 * - member: Read/write data, deploy, execute dataflow
 */

import { VariantType, NullType, ValueTypeOf, variant } from '@elaraai/east';

/**
 * Role a user can have on a repository.
 *
 * Defined as a VariantType for East compatibility:
 * - `.owner` - Full access + manage ACL + delete repo
 * - `.member` - Read/write data, deploy, execute dataflow
 */
export const RepoRoleType = VariantType({
  owner: NullType,
  member: NullType,
});

export type RepoRole = ValueTypeOf<typeof RepoRoleType>;

/**
 * Parse a string into a RepoRole variant.
 *
 * @param value - The role string ('owner' or 'member')
 * @returns The RepoRole variant
 * @throws Error if the value is not a valid role
 */
export function parseRepoRole(value: string): RepoRole {
  if (value === 'owner') return variant('owner', null);
  if (value === 'member') return variant('member', null);
  throw new Error(`Invalid role: ${value}`);
}

/**
 * Serialize a RepoRole variant to wire format string.
 *
 * @param role - The RepoRole variant
 * @returns The role as a string ('owner' or 'member')
 */
export function serializeRepoRole(role: RepoRole): 'owner' | 'member' {
  return role.type;
}
