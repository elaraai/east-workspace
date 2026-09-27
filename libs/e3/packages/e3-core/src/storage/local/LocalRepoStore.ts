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
  GcBackendSweepOptions,
  GcBackendSweepResult,
  GcObjectEntry,
  GcObjectScanResult,
  GcRootScanResult,
} from '../interfaces.js';
import type { RefStore, DatasetRefStore } from '../interfaces.js';
import {
  RepoNotFoundError,
  RepoAlreadyExistsError,
  RepoLayoutError,
  RepoStatusConflictError,
  checkName,
  isNotFoundError,
} from '../../errors.js';
import { decodeBeast2For, encodeBeast2For, variant } from '@elaraai/east';
import { RepoMetadataType } from '@elaraai/e3-types';
import { executionRoots, packageRoots, workspaceRoots } from '../../gc-roots.js';
import { newRepositoryRecord } from '../../repository-record.js';
import { atomicWriteFile } from './localHelpers.js';
import { sweepLocalRepository } from './sweep.js';
import { LOCAL_REPOSITORY_UPGRADES } from './upgrades.js';

/** A repository's metadata's file, at the repository's root. */
export const METADATA_FILE = 'metadata.beast2';

/** Encodes a repository's metadata as a local repository keeps it. */
export const encodeRepoMetadata: (metadata: RepoMetadata) => Uint8Array = encodeBeast2For(RepoMetadataType);
const decodeRepoMetadata = decodeBeast2For(RepoMetadataType);

/**
 * Local filesystem implementation of RepoStore.
 *
 * Manages repository lifecycle for local e3 repositories stored
 * as subdirectories within a parent directory. A repository's metadata is
 * `metadata.beast2` at its root, beside the repository record the ref store
 * keeps.
 *
 * Its lifecycle names a repository by its directory's name in that parent
 * directory; its gc primitives take a repository's path, as the other stores
 * do, so a store without the parent directory runs gc all the same.
 */
export class LocalRepoStore implements RepoStore {
  /**
   * Create a new LocalRepoStore.
   * @param reposDir - The directory the repositories are in, which the
   *   lifecycle needs; `null` for a store that runs gc alone
   * @param refs - The ref store a created repository's record is written to,
   *   and gc's root scans read
   * @param datasets - The dataset ref store gc's root scans read
   */
  constructor(
    private readonly reposDir: string | null,
    private readonly refs: RefStore,
    private readonly datasets: DatasetRefStore
  ) {}

  /**
   * The directory the repositories are in.
   *
   * @throws {Error} When the store was made without one
   */
  private requireReposDir(): string {
    if (this.reposDir === null) {
      throw new Error('a repository\'s lifecycle needs the directory the repositories are in: give LocalStorage its reposDir');
    }
    return this.reposDir;
  }

  /**
   * Get the path to a repository directory.
   */
  private getRepoPath(repo: string): string {
    const reposDir = this.requireReposDir();
    checkName('repository', repo);
    return path.join(reposDir, repo);
  }

  /**
   * Get the path to a repository's metadata.
   */
  private getMetadataPath(repo: string): string {
    return path.join(this.getRepoPath(repo), METADATA_FILE);
  }

  /**
   * Read a repository's metadata, refusing a repository whose metadata does
   * not read: an e3 older than this layout wrote it.
   */
  private async readMetadata(repo: string): Promise<RepoMetadata> {
    let data: Buffer;
    try {
      data = await fs.readFile(this.getMetadataPath(repo));
    } catch (err) {
      if (isNotFoundError(err)) throw new RepoLayoutError(this.getRepoPath(repo), null);
      throw err;
    }
    try {
      return decodeRepoMetadata(data);
    } catch {
      throw new RepoLayoutError(this.getRepoPath(repo), null);
    }
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
    const reposDir = this.requireReposDir();
    const repos: string[] = [];
    try {
      const entries = await fs.readdir(reposDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const repoPath = path.join(reposDir, entry.name);
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
   * @throws {RepoLayoutError} When the repository's metadata does not read:
   *   an older e3 wrote it
   */
  async getMetadata(repo: string): Promise<RepoMetadata | null> {
    const repoPath = this.getRepoPath(repo);

    // Check if repo exists
    if (!(await this.isValidRepository(repoPath))) {
      return null;
    }

    return this.readMetadata(repo);
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

    // Its record first, so a repository whose metadata is there has one.
    await this.refs.repositoryWrite(repoPath, newRepositoryRecord(LOCAL_REPOSITORY_UPGRADES));
    const now = new Date();
    await atomicWriteFile(this.getMetadataPath(repo), encodeRepoMetadata({
      name: repo, status: variant('active', null), createdAt: now, statusChangedAt: now,
    }));
  }

  async setStatus(
    repo: string,
    status: RepoStatusName,
    expected?: RepoStatusName | RepoStatusName[]
  ): Promise<void> {
    const repoPath = this.getRepoPath(repo);
    if (!(await this.isValidRepository(repoPath))) {
      throw new RepoNotFoundError(repo);
    }
    const metadata = await this.readMetadata(repo);

    // Check expected status (CAS)
    if (expected !== undefined) {
      const expectedArray = Array.isArray(expected) ? expected : [expected];
      if (!expectedArray.includes(metadata.status.type)) {
        throw new RepoStatusConflictError(repo, expected, metadata.status.type);
      }
    }

    await atomicWriteFile(this.getMetadataPath(repo), encodeRepoMetadata({
      ...metadata,
      status: variant(status, null),
      statusChangedAt: new Date(),
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
    return { roots: await packageRoots(this.refs, repo) };
  }

  async gcScanWorkspaceRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    return { roots: await workspaceRoots(this.refs, this.datasets, repo) };
  }

  async gcScanExecutionRoots(repo: string, _cursor?: unknown): Promise<GcRootScanResult> {
    return { roots: await executionRoots(this.refs, repo) };
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

  gcSweepBackend(repo: string, reachable: ReadonlySet<string>, options: GcBackendSweepOptions): Promise<GcBackendSweepResult> {
    return sweepLocalRepository(repo, reachable, options);
  }
}
