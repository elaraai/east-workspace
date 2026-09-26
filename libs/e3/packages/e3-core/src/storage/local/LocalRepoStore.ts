/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  RepoStore,
  RepoStatusName,
  RepoMetadata,
  BatchResult,
  GcObjectEntry,
  GcObjectScanResult,
  GcRootScanResult,
} from '../interfaces.js';
import type { RefStore, DatasetRefStore } from '../interfaces.js';
import {
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoStatusConflictError,
  checkName,
} from '../../errors.js';
import { decodeBeast2For, variant } from '@elaraai/east';
import { WorkspaceRecordType } from '@elaraai/e3-types';
import { refPathToKeypath } from '../../dataset-refs.js';
import { atomicWriteFile } from './localHelpers.js';
import { REPOSITORY_FILENAME, REPOSITORY_LAYOUT, encodeRepositoryRecord, readRepositoryRecord, writeNewRepoMetadata } from './repository.js';

/**
 * Local filesystem implementation of RepoStore.
 *
 * Manages repository lifecycle for local e3 repositories stored
 * as subdirectories within a parent directory.
 */
export class LocalRepoStore implements RepoStore {
  /**
   * Create a new LocalRepoStore.
   * @param reposDir - Parent directory containing repositories
   * @param refs - RefStore for reading package/workspace/execution refs
   * @param datasets - DatasetRefStore for reading per-dataset refs (for GC scanning)
   */
  constructor(
    private readonly reposDir: string,
    private readonly refs: RefStore,
    private readonly datasets?: DatasetRefStore
  ) {}

  /**
   * Get the path to a repository directory.
   */
  private getRepoPath(repo: string): string {
    checkName('repository', repo);
    return path.join(this.reposDir, repo);
  }

  /**
   * Get the path to a repository's record.
   */
  private getRecordPath(repo: string): string {
    return path.join(this.getRepoPath(repo), REPOSITORY_FILENAME);
  }

  /**
   * Check if a directory is a valid e3 repository.
   */
  private async isValidRepository(repoPath: string): Promise<boolean> {
    const requiredDirs = ['objects', 'packages', 'executions', 'workspaces'];
    for (const dir of requiredDirs) {
      try {
        const stat = await fs.stat(path.join(repoPath, dir));
        if (!stat.isDirectory()) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  // ===========================================================================
  // Queries
  // ===========================================================================

  async list(): Promise<string[]> {
    const repos: string[] = [];
    try {
      const entries = await fs.readdir(this.reposDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const repoPath = path.join(this.reposDir, entry.name);
          if (await this.isValidRepository(repoPath)) {
            repos.push(entry.name);
          }
        }
      }
    } catch {
      // reposDir doesn't exist or can't be read
    }
    return repos;
  }

  async exists(repo: string): Promise<boolean> {
    const repoPath = this.getRepoPath(repo);
    return this.isValidRepository(repoPath);
  }

  /**
   * The repository's metadata, or `null` when there is no repository.
   *
   * @throws {RepoLayoutError} When the repository has no record, or one of
   *   another layout: it is re-created.
   */
  async getMetadata(repo: string): Promise<RepoMetadata | null> {
    const repoPath = this.getRepoPath(repo);

    // Check if repo exists
    if (!(await this.isValidRepository(repoPath))) {
      return null;
    }

    return readRepositoryRecord(repoPath).metadata;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async create(repo: string): Promise<void> {
    const repoPath = this.getRepoPath(repo);

    // Check if already exists
    if (await this.isValidRepository(repoPath)) {
      throw new RepoAlreadyExistsError(repo);
    }

    // Create directory structure
    await fs.mkdir(repoPath, { recursive: true });
    await fs.mkdir(path.join(repoPath, 'objects'), { recursive: true });
    await fs.mkdir(path.join(repoPath, 'packages'), { recursive: true });
    await fs.mkdir(path.join(repoPath, 'executions'), { recursive: true });
    await fs.mkdir(path.join(repoPath, 'workspaces'), { recursive: true });

    writeNewRepoMetadata(repoPath, repo);
  }

  async setStatus(
    repo: string,
    status: RepoStatusName,
    expected?: RepoStatusName | RepoStatusName[]
  ): Promise<void> {
    const current = await this.getMetadata(repo);
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

    await atomicWriteFile(this.getRecordPath(repo), encodeRepositoryRecord({
      layout: REPOSITORY_LAYOUT,
      metadata: { ...current, status: variant(status, null), statusChangedAt: new Date() },
    }));
  }

  async remove(repo: string): Promise<void> {
    const repoPath = this.getRepoPath(repo);
    try {
      // Remove the entire repository directory
      await fs.rm(repoPath, { recursive: true, force: true });
    } catch {
      // Ignore errors if directory doesn't exist
    }
  }

  // ===========================================================================
  // Batched Deletion
  // ===========================================================================

  async deleteRefsBatch(repo: string, _cursor?: string): Promise<BatchResult> {
    const repoPath = this.getRepoPath(repo);
    let deleted = 0;

    // For local storage, we delete every record in one pass
    const refDirs = ['packages', 'workspaces', 'executions', 'dataflows', 'adoptions', 'locks'];

    for (const dir of refDirs) {
      const dirPath = path.join(repoPath, dir);
      try {
        deleted += await this.deleteDirectoryContents(dirPath);
      } catch {
        // Directory doesn't exist
      }
    }

    return { status: 'done', deleted };
  }

  async deleteObjectsBatch(repo: string, _cursor?: string): Promise<BatchResult> {
    const repoPath = this.getRepoPath(repo);
    const objectsDir = path.join(repoPath, 'objects');
    let deleted = 0;

    try {
      deleted = await this.deleteDirectoryContents(objectsDir);
    } catch {
      // objects dir doesn't exist
    }

    return { status: 'done', deleted };
  }

  /**
   * Recursively delete all contents of a directory.
   * Returns count of files deleted.
   */
  private async deleteDirectoryContents(dir: string): Promise<number> {
    let count = 0;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          count += await this.deleteDirectoryContents(entryPath);
          await fs.rmdir(entryPath);
        } else {
          await fs.unlink(entryPath);
          count++;
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
    return count;
  }

  // ===========================================================================
  // GC Primitives
  // ===========================================================================

  // Note: GC primitives receive `repo` as a full path (same as ObjectStore/RefStore),
  // NOT as a repo name relative to reposDir. This is consistent with how all
  // storage interfaces work in the local implementation.

  async gcScanPackageRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    const roots: string[] = [];
    const packages = await this.refs.packageList(repo);
    for (const { name, version } of packages) {
      const hash = await this.refs.packageResolve(repo, name, version);
      if (hash) {
        roots.push(hash);
      }
    }
    return { roots };
  }

  async gcScanWorkspaceRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    const roots: string[] = [];
    const decoder = decodeBeast2For(WorkspaceRecordType);
    const names = await this.refs.workspaceList(repo);
    for (const name of names) {
      const data = await this.refs.workspaceRead(repo, name);
      if (data === null) continue;
      try {
        const record = decoder(data);
        if (record.type === 'none') continue; // not deployed
        roots.push(record.value.packageHash);
        // Scan per-dataset ref files for value hashes
        if (this.datasets) {
          const refPaths = await this.datasets.list(repo, name);
          for (const refPath of refPaths) {
            const ref = await this.datasets.read(repo, name, refPath);
            if (ref && ref.type === 'value') {
              roots.push(ref.value.hash);
              // Root the version-vector SELF-entry only — a record's head-commit
              // hash (its history root). For plain values the self-entry equals
              // the state hash already rooted above (harmless dupe); a derived
              // dataset has no self-entry, so its inputs' hashes are not rooted
              // here (they stay alive via those inputs' own refs).
              const selfEntry = ref.value.versions.get(refPathToKeypath(refPath));
              if (selfEntry !== undefined) roots.push(selfEntry);
            }
          }
        }
      } catch {
        // Corrupt workspace state - skip
      }
    }
    return { roots };
  }

  async gcScanExecutionRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    const roots: string[] = [];
    const entries = await this.refs.executionList(repo);
    for (const { taskHash, inputsHash } of entries) {
      // The plan of a split task's execution that can resume: the `$plan` of
      // the stage it is in. It is the only reference to the pieces it cut and
      // the key ranges it planned, and it lives in a record no other scan
      // reads — unrooted, the sweep takes the plan and everything it records,
      // and a resumed run plans again from scratch. gc walks the plan itself,
      // by its kind tag.
      const planHash = await this.refs.executionPlanRead(repo, taskHash, inputsHash);
      if (planHash !== null) roots.push(planHash);
      const ids = await this.refs.executionListIds(repo, taskHash, inputsHash);
      for (const executionId of ids) {
        const status = await this.refs.executionGet(repo, taskHash, inputsHash, executionId);
        if (status?.type === 'success' && /^[a-f0-9]{64}$/.test(status.value.outputHash)) {
          roots.push(status.value.outputHash);
        }
      }
    }
    return { roots };
  }

  async gcScanObjects(repo: string, _cursor?: unknown): Promise<GcObjectScanResult> {
    const objectsDir = path.join(repo, 'objects');
    const objects: GcObjectEntry[] = [];

    try {
      const subdirs = await fs.readdir(objectsDir);
      for (const subdir of subdirs) {
        if (!/^[a-f0-9]{2}$/.test(subdir)) continue;
        const subdirPath = path.join(objectsDir, subdir);
        try {
          const stat = await fs.stat(subdirPath);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }
        const files = await fs.readdir(subdirPath);
        for (const file of files) {
          if (file.endsWith('.partial')) continue;
          if (!file.endsWith('.beast2')) continue;
          const hash = subdir + file.slice(0, -7); // remove .beast2
          try {
            const fileStat = await fs.stat(path.join(subdirPath, file));
            objects.push({ hash, lastModified: fileStat.mtimeMs, size: fileStat.size });
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Objects directory doesn't exist
    }

    // Local returns all in one batch (no cursor)
    return { objects };
  }

  async gcDeleteObjects(repo: string, hashes: string[]): Promise<void> {
    const objectsDir = path.join(repo, 'objects');

    for (const hash of hashes) {
      const subdir = hash.slice(0, 2);
      const rest = hash.slice(2);
      const filePath = path.join(objectsDir, subdir, `${rest}.beast2`);
      try {
        await fs.unlink(filePath);
      } catch {
        // File doesn't exist
      }
      // Try to remove empty subdirectory
      try {
        await fs.rmdir(path.join(objectsDir, subdir));
      } catch {
        // Directory not empty or doesn't exist
      }
    }
  }
}
