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
  checkId,
} from '../../errors.js';
import { executionRoots, packageRoots, workspaceRoots } from '../../gc-roots.js';
import { newRepositoryRecord } from '../../repository-record.js';

/**
 * The objects an in-memory repository store scans and deletes for gc: its
 * backend's object store, which keeps when it wrote each, and the note of an
 * object a sweep beside running work found unreachable.
 */
export interface InMemoryObjectCatalogue {
  /**
   * Every object of a repository, with its size, when it was last written and
   * its unreachable note.
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
  /**
   * Notes objects unreachable at `at`, keeping a note that stands.
   *
   * @param repo - Repository identifier
   * @param hashes - The objects' hashes
   * @param at - When a sweep saw them unreachable (epoch ms)
   * @returns Each note's time, in the order given
   */
  gcNote(repo: string, hashes: readonly string[], at: number): number[];
  /**
   * Clears the unreachable notes of objects.
   *
   * @param repo - Repository identifier
   * @param hashes - The objects' hashes
   */
  gcClear(repo: string, hashes: readonly string[]): void;
  /**
   * Deletes an object while its note stands at `since`.
   *
   * @param repo - Repository identifier
   * @param hash - The object's hash
   * @param since - The time its note must stand at
   * @returns Whether it deleted the object
   */
  gcDeleteIf(repo: string, hash: string, since: number): boolean;
}

/**
 * A store of the in-memory backend's, which drops what it keeps of a
 * repository when the repository is removed.
 */
export interface InMemoryRepositoryRecords {
  /**
   * Drops everything the store keeps of a repository.
   *
   * @param repo - Repository identifier
   * @returns How many records it dropped
   */
  drop(repo: string): number;
}

/**
 * In-memory implementation of RepoStore for testing.
 *
 * Stores all data in memory maps. Useful for unit tests
 * where filesystem access is not needed. gc runs over it as over any backend:
 * its root scans read the backend's ref stores, and its object scan the
 * backend's objects. A repository removed goes whole — its records, logs,
 * locks and objects — as a local repository's directory does.
 *
 * All methods are synchronous but return Promises to match the interface.
 */
/* eslint-disable @typescript-eslint/require-await */
export class InMemoryRepoStore implements RepoStore {
  private repos = new Map<string, RepoMetadata>();
  /** The parts of gc runs in steps, by repository, run and part */
  private gcRuns = new Map<string, Uint8Array>();

  /**
   * @param refs - The ref store a created repository's record is written to,
   *   and gc's root scans read
   * @param datasets - The dataset ref store gc's root scans read
   * @param objects - The objects gc's object scan lists and deletes
   * @param upgrades - The backend's own upgrades, which a created repository's
   *   record names
   * @param records - The stores that drop what they keep of a repository
   *   removed: its refs, dataset refs, logs and locks
   */
  constructor(
    private readonly refs: RefStore,
    private readonly datasets: DatasetRefStore,
    private readonly objects: InMemoryObjectCatalogue,
    private readonly upgrades: readonly RepositoryUpgrade[],
    private readonly records: readonly InMemoryRepositoryRecords[],
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
    // Whatever the batches left goes with it.
    await this.deleteRefsBatch(repo);
    await this.deleteObjectsBatch(repo);
    this.repos.delete(repo);
  }

  // ===========================================================================
  // Batched Deletion
  // ===========================================================================

  async deleteRefsBatch(repo: string, _cursor?: string): Promise<BatchResult> {
    let deleted = this.records.reduce((sum, store) => sum + store.drop(repo), 0);
    for (const key of [...this.gcRuns.keys()]) {
      if (!key.startsWith(`${repo}\0`)) continue;
      this.gcRuns.delete(key);
      deleted++;
    }
    return { status: 'done', deleted };
  }

  async deleteObjectsBatch(repo: string, _cursor?: string): Promise<BatchResult> {
    const hashes = this.objects.gcEntries(repo).map(({ hash }) => hash);
    this.objects.gcDelete(repo, hashes);
    return { status: 'done', deleted: hashes.length };
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

  async gcScanObjects(repo: string, _cursor?: string): Promise<GcObjectScanResult> {
    return { objects: this.objects.gcEntries(repo) };
  }

  async gcDeleteObjects(repo: string, hashes: string[]): Promise<void> {
    this.objects.gcDelete(repo, hashes);
  }

  async gcNoteUnreachable(repo: string, hashes: readonly string[], at: number): Promise<number[]> {
    return this.objects.gcNote(repo, hashes, at);
  }

  async gcClearUnreachable(repo: string, hashes: readonly string[]): Promise<void> {
    this.objects.gcClear(repo, hashes);
  }

  async gcDeleteUnreachable(repo: string, hash: string, since: number): Promise<boolean> {
    return this.objects.gcDeleteIf(repo, hash, since);
  }

  async gcRunWrite(repo: string, run: string, name: string, data: Uint8Array): Promise<void> {
    checkId('gc run id', run);
    this.gcRuns.set(`${repo}\0${run}\0${name}`, data);
  }

  async gcRunRead(repo: string, run: string, name: string): Promise<Uint8Array | null> {
    checkId('gc run id', run);
    return this.gcRuns.get(`${repo}\0${run}\0${name}`) ?? null;
  }

  async gcRunDelete(repo: string, run: string): Promise<void> {
    checkId('gc run id', run);
    for (const key of [...this.gcRuns.keys()]) {
      if (key.startsWith(`${repo}\0${run}\0`)) this.gcRuns.delete(key);
    }
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
    this.gcRuns.clear();
  }
}
