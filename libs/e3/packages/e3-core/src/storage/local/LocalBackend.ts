/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { StorageBackend, ObjectStore, RefStore, LockService, LogStore, RepoStore, DatasetRefStore, RepositoryUpgrade } from '../interfaces.js';
import { LocalObjectStore } from './LocalObjectStore.js';
import { LocalRefStore } from './LocalRefStore.js';
import { LocalLockService } from './LocalLockService.js';
import { LocalLogStore } from './LocalLogStore.js';
import { LocalRepoStore } from './LocalRepoStore.js';
import { LocalDatasetRefStore } from './LocalDatasetRefStore.js';
import { LOCAL_REPOSITORY_UPGRADES } from './upgrades.js';
import { RepoNotFoundError } from '../../errors.js';

/**
 * Thrown when a local repository directory is not found or is missing required structure.
 * This is an internal error for LocalStorage — external consumers see RepoNotFoundError.
 */
class RepoDirNotFoundError extends RepoNotFoundError {
  constructor(public readonly path: string) {
    super(path);
  }
}

/**
 * Local filesystem implementation of StorageBackend.
 *
 * This combines the local implementations of all storage interfaces,
 * providing a complete backend for local e3 repositories.
 *
 * The `repo` parameter passed to each method is the path to the e3 repository directory.
 * This allows a single LocalStorage instance to be used for multiple repositories.
 *
 * @example
 * ```typescript
 * import { LocalStorage } from '@elaraai/e3-core';
 *
 * const storage = new LocalStorage();
 * const repo = '/path/to/repo';
 *
 * // Use the backend with storage-agnostic functions
 * const hash = await storage.objects.write(repo, data);
 * const packages = await storage.refs.packageList(repo);
 * ```
 */
export class LocalStorage implements StorageBackend {
  /** The upgrades of a local repository's own layout */
  public readonly upgrades: readonly RepositoryUpgrade[] = LOCAL_REPOSITORY_UPGRADES;

  /** Content-addressed object storage */
  public readonly objects: ObjectStore;

  /** Mutable reference storage */
  public readonly refs: RefStore;

  /** Distributed locking service */
  public readonly locks: LockService;

  /** Execution log storage */
  public readonly logs: LogStore;

  /** Repository lifecycle management */
  public readonly repos: RepoStore;

  /** Per-dataset reference storage (reactive dataflow) */
  public readonly datasets: DatasetRefStore;

  /**
   * Create a new LocalStorage instance.
   *
   * @param reposDir - The directory the repositories are in, which a
   *   repository's lifecycle (`repos.list`, `repos.create`, `repos.remove`…)
   *   needs; without it those throw, and gc runs all the same
   */
  constructor(reposDir?: string) {
    this.objects = new LocalObjectStore();
    this.refs = new LocalRefStore();
    this.locks = new LocalLockService();
    this.logs = new LocalLogStore();
    this.datasets = new LocalDatasetRefStore();
    this.repos = new LocalRepoStore(reposDir ?? null, this.refs, this.datasets);
  }

  /**
   * Validate that a repository exists and is properly structured.
   * @param repo - Path to the e3 repository directory
   * @throws {RepoNotFoundError} If repository doesn't exist or is invalid
   */
  async validateRepository(repo: string): Promise<void> {
    const requiredDirs = ['objects', 'packages', 'workspaces', 'executions'];
    for (const dir of requiredDirs) {
      try {
        await fs.access(path.join(repo, dir));
      } catch {
        throw new RepoDirNotFoundError(repo);
      }
    }
  }
}
