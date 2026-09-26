/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { variant } from '@elaraai/east';
import type {
  RepoStore,
  RepoStatusName,
  RepoMetadata,
  BatchResult,
  GcObjectScanResult,
  GcRootScanResult,
} from '../interfaces.js';
import {
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
} from '../../errors.js';

/**
 * In-memory implementation of RepoStore for testing.
 *
 * Stores all data in memory maps. Useful for unit tests
 * where filesystem access is not needed.
 *
 * All methods are synchronous but return Promises to match the interface.
 */
/* eslint-disable @typescript-eslint/require-await */
export class InMemoryRepoStore implements RepoStore {
  private repos = new Map<string, RepoMetadata>();

  // ===========================================================================
  // Queries
  // ===========================================================================

  async list(): Promise<string[]> {
    return [...this.repos.keys()];
  }

  async exists(repo: string): Promise<boolean> {
    return this.repos.has(repo);
  }

  async getMetadata(repo: string): Promise<RepoMetadata | null> {
    return this.repos.get(repo) ?? null;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async create(repo: string): Promise<void> {
    if (this.repos.has(repo)) {
      throw new RepoAlreadyExistsError(repo);
    }

    const now = new Date();
    this.repos.set(repo, {
      name: repo,
      status: variant('active', null),
      createdAt: now,
      statusChangedAt: now,
    });
  }

  async setStatus(
    repo: string,
    status: RepoStatusName,
    expected?: RepoStatusName | RepoStatusName[]
  ): Promise<void> {
    const current = this.repos.get(repo);
    if (!current) {
      throw new RepoNotFoundError(repo);
    }

    // Check expected status (CAS)
    if (expected !== undefined) {
      const expectedArray = Array.isArray(expected) ? expected : [expected];
      if (!expectedArray.includes(current.status.type)) {
        throw new RepoStatusConflictError(repo, expected, current.status.type);
      }
    }

    this.repos.set(repo, {
      ...current,
      status: variant(status, null),
      statusChangedAt: new Date(),
    });
  }

  async remove(repo: string): Promise<void> {
    this.repos.delete(repo);
  }

  // ===========================================================================
  // Batched Deletion
  // ===========================================================================

  async deleteRefsBatch(_repo: string, _cursor?: string): Promise<BatchResult> {
    // In-memory doesn't have refs to delete
    return { status: 'done', deleted: 0 };
  }

  async deleteObjectsBatch(_repo: string, _cursor?: string): Promise<BatchResult> {
    // In-memory doesn't have objects to delete
    return { status: 'done', deleted: 0 };
  }

  // ===========================================================================
  // GC Primitives
  // ===========================================================================

  async gcScanPackageRoots(_repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    return { roots: [] };
  }

  async gcScanWorkspaceRoots(_repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    return { roots: [] };
  }

  async gcScanExecutionRoots(_repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    return { roots: [] };
  }

  async gcScanObjects(_repo: string, _cursor?: unknown): Promise<GcObjectScanResult> {
    return { objects: [] };
  }

  async gcDeleteObjects(_repo: string, _hashes: string[]): Promise<void> {
    // Nothing to delete
  }

  // ===========================================================================
  // Test Utilities
  // ===========================================================================

  /**
   * Clear all repositories.
   * Useful for test cleanup.
   */
  clear(): void {
    this.repos.clear();
  }
}
