/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Authorization business logic for e3 admin.
 *
 * These functions implement the core authorization rules for repository
 * access control. They accept interfaces (AclStore) for dependency injection,
 * enabling easy testing with in-memory implementations.
 */

import type { AuthzErrorCode } from '@elaraai/e3-admin-types';
import { variant } from '@elaraai/east';
import type { AclStore } from './interfaces.js';

/** Result of an authorization check */
export type AuthzResult =
  | { ok: true }
  | { ok: false; code: AuthzErrorCode; message: string };

/**
 * Check if a user has the required access level to a repository.
 *
 * @param store - ACL storage backend
 * @param repo - Repository name
 * @param userId - User's unique identifier
 * @param requiredRole - Minimum role required ('owner' or 'member')
 * @param isAdmin - Whether the user is a server admin (bypasses checks)
 * @returns true if user has sufficient access
 */
export async function hasAccess(
  store: AclStore,
  repo: string,
  userId: string,
  requiredRole: 'owner' | 'member',
  isAdmin: boolean
): Promise<boolean> {
  // Admins bypass all ACL checks
  if (isAdmin) return true;

  const role = await store.getRole(repo, userId);
  if (role === null) return false;

  // Owners have full access
  if (role.type === 'owner') return true;

  // Members only have access if member-level is sufficient
  return requiredRole === 'member';
}

/**
 * Check if a user is the last owner of a repository.
 */
export async function isLastOwner(
  store: AclStore,
  repo: string,
  userId: string
): Promise<boolean> {
  const users = await store.listUsers(repo);
  const owners = users.filter(u => u.role.type === 'owner');
  return owners.length === 1 && owners[0].userId === userId;
}

/**
 * Check if an actor can remove a user from a repository.
 *
 * @returns AuthzResult with ok:true or specific error code
 */
export async function canRemoveUser(
  store: AclStore,
  repo: string,
  actorId: string,
  targetId: string,
  isAdmin: boolean
): Promise<AuthzResult> {
  // Check actor has owner permission
  if (!await hasAccess(store, repo, actorId, 'owner', isAdmin)) {
    return {
      ok: false,
      code: variant('forbidden', null),
      message: 'Only repository owners can remove users',
    };
  }

  // Prevent removing the last owner
  if (await isLastOwner(store, repo, targetId)) {
    return {
      ok: false,
      code: variant('last_owner', null),
      message: 'Cannot remove the last owner of a repository',
    };
  }

  return { ok: true };
}
