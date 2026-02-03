/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * Core interfaces for e3 admin authorization.
 *
 * These interfaces define cloud-agnostic contracts for ACL storage
 * and identity extraction. Implementations live in platform-specific
 * packages (e.g., DynamoDbAclStore in e3-aws).
 */

import type { RepoUser, RepoRole } from '@elaraai/e3-admin-types';

/**
 * Storage interface for repository access control lists.
 *
 * Implementations:
 * - DynamoDbAclStore (e3-aws) - DynamoDB with GSI for user lookups
 * - InMemoryAclStore (testing) - In-memory Map for unit tests
 */
export interface AclStore {
  /** List all users with access to a repository */
  listUsers(repo: string): Promise<RepoUser[]>;

  /** Add a user to a repository's ACL */
  addUser(repo: string, user: RepoUser): Promise<RepoUser>;

  /** Remove a user from a repository's ACL */
  removeUser(repo: string, userId: string): Promise<void>;

  /** Get a user's role on a repository (null if no access) */
  getRole(repo: string, userId: string): Promise<RepoRole | null>;

  /** List all repositories a user has access to */
  listReposForUser(userId: string): Promise<string[]>;

  /** Delete all ACL entries for a repository (used during repo deletion) */
  deleteAllForRepo(repo: string): Promise<void>;
}

/**
 * Identity information extracted from authentication.
 */
export interface Identity {
  /** User's unique identifier (Cognito sub, etc.) */
  sub: string;
  /** User's email address (optional) */
  email?: string;
  /** User's display name (optional) */
  name?: string;
  /** Whether user is a server admin */
  isAdmin: boolean;
}

/**
 * Backend for retrieving identity information.
 *
 * Implementations:
 * - CognitoWhoamiBackend (e3-aws) - Extracts from API Gateway authorizer
 * - MockWhoamiBackend (testing) - Returns configured identity
 */
export interface WhoamiBackend {
  /** Get identity from request context */
  getIdentity(requestContext: unknown): Identity | null;
}
