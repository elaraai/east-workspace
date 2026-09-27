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
  DatasetRefStore,
  GcBackendSweepOptions,
  GcBackendSweepResult,
  GcObjectEntry,
  GcObjectScanResult,
  GcRootScanResult,
  RefStore,
  RepositoryUpgrade,
} from '../interfaces.js';
import {
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
} from '../../errors.js';
import { executionRoots, packageRoots, workspaceRoots } from '../../gc-roots.js';
import { newRepositoryRecord } from '../../repository-record.js';

/**
 * The objects an in-memory repository store scans and deletes for gc: its
 * backend's object store, which keeps when it wrote each.
 */
export interface InMemoryObjectCatalogue {
  /**
   * Every object of a repository, with its size and when it was last written.
   *
   * @param repo - Repository identifier
   * @returns The objects
   */
  gcEntries(repo: string): GcObjectEntry[];
  /**
   * Deletes a repository's objects; one already gone is passed over.
   *
   * @param repo - Repository identifier
   * @param hashes - The objects' hashes
   */
  gcDelete(repo: string, hashes: readonly string[]): void;
}

/**
 * In-memory implementation of RepoStore for testing.
 *
 * Stores all data in memory maps. Useful for unit tests
 * where filesystem access is not needed. gc runs over it as over any backend:
 * its root scans read the backend's ref stores, and its object scan the
 * backend's objects.
 *
 * All methods are synchronous but return Promises to match the interface.
 */
/* eslint-disable @typescript-eslint/require-await */
export class InMemoryRepoStore implements RepoStore {
  private repos = new Map<string, RepoMetadata>();

  /**
   * @param refs - The ref store a created repository's record is written to,
   *   and gc's root scans read
   * @param datasets - The dataset ref store gc's root scans read
   * @param objects - The objects gc's object scan lists and deletes
   * @param upgrades - The backend's own upgrades, which a created repository's
   *   record names
   */
  constructor(
    private readonly refs: RefStore,
    private readonly datasets: DatasetRefStore,
    private readonly objects: InMemoryObjectCatalogue,
    private readonly upgrades: readonly RepositoryUpgrade[],
  ) {}

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
    await this.refs.repositoryWrite(repo, newRepositoryRecord(this.upgrades));
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

  async gcScanPackageRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    return { roots: await packageRoots(this.refs, repo) };
  }

  async gcScanWorkspaceRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    return { roots: await workspaceRoots(this.refs, this.datasets, repo) };
  }

  async gcScanExecutionRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    return { roots: await executionRoots(this.refs, repo) };
  }

  async gcScanObjects(repo: string, _cursor?: unknown): Promise<GcObjectScanResult> {
    return { objects: this.objects.gcEntries(repo) };
  }

  async gcDeleteObjects(repo: string, hashes: string[]): Promise<void> {
    this.objects.gcDelete(repo, hashes);
  }

  async gcSweepBackend(_repo: string, _reachable: ReadonlySet<string>, _options: GcBackendSweepOptions): Promise<GcBackendSweepResult> {
    // Nothing is kept beside the objects and records
    return { deletedPartials: 0, skippedYoung: 0 };
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
