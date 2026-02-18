/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * In-memory implementations for testing.
 *
 * These classes provide simple, synchronous implementations of the
 * core interfaces for use in unit tests.
 */

import type { RepoUser, RepoRole } from '@elaraai/e3-cloud-types';
import type { AclStore, Identity, WhoamiBackend } from '../interfaces.js';

/**
 * In-memory ACL store for testing.
 */
export class InMemoryAclStore implements AclStore {
  // Map<repo, Map<userId, RepoUser>>
  private acls = new Map<string, Map<string, RepoUser>>();

  listUsers(repo: string): Promise<RepoUser[]> {
    const repoAcl = this.acls.get(repo);
    return Promise.resolve(repoAcl ? Array.from(repoAcl.values()) : []);
  }

  addUser(repo: string, user: RepoUser): Promise<RepoUser> {
    let repoAcl = this.acls.get(repo);
    if (!repoAcl) {
      repoAcl = new Map();
      this.acls.set(repo, repoAcl);
    }
    repoAcl.set(user.userId, user);
    return Promise.resolve(user);
  }

  removeUser(repo: string, userId: string): Promise<void> {
    this.acls.get(repo)?.delete(userId);
    return Promise.resolve();
  }

  getRole(repo: string, userId: string): Promise<RepoRole | null> {
    return Promise.resolve(this.acls.get(repo)?.get(userId)?.role ?? null);
  }

  listReposForUser(userId: string): Promise<string[]> {
    const repos: string[] = [];
    for (const [repo, acl] of this.acls) {
      if (acl.has(userId)) repos.push(repo);
    }
    return Promise.resolve(repos);
  }

  deleteAllForRepo(repo: string): Promise<void> {
    this.acls.delete(repo);
    return Promise.resolve();
  }

  /** Clear all data (for test reset) */
  clear(): void {
    this.acls.clear();
  }
}

/**
 * Mock whoami backend for testing.
 */
export class MockWhoamiBackend implements WhoamiBackend {
  constructor(private identity: Identity | null = null) {}

  setIdentity(identity: Identity | null): void {
    this.identity = identity;
  }

  getIdentity(): Identity | null {
    return this.identity;
  }
}
