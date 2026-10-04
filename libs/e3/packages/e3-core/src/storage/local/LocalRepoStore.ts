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
  checkHash,
  checkName,
  isNotFoundError,
} from '../../errors.js';
import { decodeBeast2For, encodeBeast2For, variant } from '@elaraai/east';
import { RepoMetadataType } from '@elaraai/e3-types';
import { OBJECT_CONCURRENCY, eachAtMost } from '../../concurrency.js';
import { executionRoots, packageRoots, workspaceRoots } from '../../gc-roots.js';
import { newRepositoryRecord } from '../../repository-record.js';
import {
  GC_ASIDE_SUFFIX,
  atomicWriteFile,
  clearUnreachableNote,
  gcDir,
  gcRunPath,
  isTransientFsError,
  noteUnreachable,
  objectPath,
  renameWithRetry,
  restoreAside,
  unlinkWithRetry,
  unreachableNoteTime,
} from './localHelpers.js';
import { sweepLocalRepository } from './sweep.js';
import { LOCAL_REPOSITORY_UPGRADES } from './upgrades.js';

/** A repository's metadata's file, at the repository's root. */
export const METADATA_FILE = 'metadata.beast2';

/** Encodes a repository's metadata as a local repository keeps it. */
export const encodeRepoMetadata: (metadata: RepoMetadata) => Uint8Array = encodeBeast2For(RepoMetadataType);
const decodeRepoMetadata = decodeBeast2For(RepoMetadataType);

/** A directory's entries, or none when it is not there. */
async function entriesOf(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw err;
  }
}

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
    const refDirs = ['packages', 'workspaces', 'executions', 'running', 'dataflows', 'adoptions', 'locks', 'gc', 'runs'];

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

  /**
   * A page of the object scan: one prefix directory, `objects/<xx>`, with the
   * unreachable notes of `gc/unreachable/<xx>`. The cursor is the prefix last
   * scanned. A prefix only notes are left under is a page too.
   *
   * @remarks
   * It changes nothing, so a dry run scans as any run does. A note whose
   * object is gone is passed over, and the backend's sweep drops it
   * ({@link sweepLocalRepository}).
   */
  async gcScanObjects(repo: string, cursor?: string): Promise<GcObjectScanResult> {
    const notesDir = path.join(gcDir(repo), 'unreachable');
    const prefixes = new Set<string>();
    for (const dir of [path.join(repo, 'objects'), notesDir]) {
      for (const entry of await entriesOf(dir)) if (/^[a-f0-9]{2}$/.test(entry)) prefixes.add(entry);
    }
    const pages = [...prefixes].sort().filter((prefix) => cursor === undefined || prefix > cursor);
    const prefix = pages[0];
    if (prefix === undefined) return { objects: [] };

    const objects: GcObjectEntry[] = [];
    const byHash = new Map<string, GcObjectEntry>();
    const prefixDir = path.join(repo, 'objects', prefix);
    for (const file of await entriesOf(prefixDir)) {
      if (file.endsWith('.partial')) continue;
      if (!file.endsWith('.beast2')) continue;
      const hash = prefix + file.slice(0, -7); // remove .beast2
      try {
        const fileStat = await fs.stat(path.join(prefixDir, file));
        const entry: GcObjectEntry = { hash, lastModified: fileStat.mtimeMs, size: fileStat.size, unreachableSince: null };
        objects.push(entry);
        byHash.set(hash, entry);
      } catch {
        // Skip files we can't stat
      }
    }
    for (const name of await entriesOf(path.join(notesDir, prefix))) {
      const entry = byHash.get(prefix + name);
      if (entry === undefined) continue; // its object is gone: the sweep drops it
      entry.unreachableSince = await unreachableNoteTime(repo, entry.hash);
    }
    return pages.length > 1 ? { objects, cursor: prefix } : { objects };
  }

  /** Deletes each object, and then its unreachable note: one a failure leaves
   *  is dropped by the backend's sweep. A batch naming a hash that is not of
   *  its form deletes nothing. */
  async gcDeleteObjects(repo: string, hashes: string[]): Promise<void> {
    for (const hash of hashes) checkHash('object hash', hash);
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
      await clearUnreachableNote(repo, hash).catch(() => { /* the sweep drops it */ });
      // Try to remove empty subdirectory
      try {
        await fs.rmdir(path.join(objectsDir, subdir));
      } catch {
        // Directory not empty or doesn't exist
      }
    }
  }

  async gcNoteUnreachable(repo: string, hashes: readonly string[], at: number): Promise<number[]> {
    for (const hash of hashes) checkHash('object hash', hash);
    const sinces: number[] = new Array<number>(hashes.length);
    await eachAtMost(hashes.map((_, i) => i), OBJECT_CONCURRENCY, async (i) => {
      sinces[i] = await noteUnreachable(repo, hashes[i]!, at);
    });
    return sinces;
  }

  async gcClearUnreachable(repo: string, hashes: readonly string[]): Promise<void> {
    for (const hash of hashes) checkHash('object hash', hash);
    await eachAtMost(hashes, OBJECT_CONCURRENCY, (hash) => clearUnreachableNote(repo, hash));
  }

  /**
   * Deletes an object while its note stands at `since`: it is moved aside,
   * the note looked at again, and only then unlinked.
   *
   * @remarks
   * A write or a touch clears the note and then looks for the object. So a
   * touch that found the object before it was moved aside has cleared the
   * note by the second look, which puts the object back; and one that looks
   * after finds nothing, and its writer writes the object again. The object's
   * directory is left, since a write may be about to stage in it.
   *
   * Windows will not move or unlink a file another handle holds open, as a
   * scanner's brief look at a file just written does: the move and the unlink
   * are tried again as every local rename is ({@link renameWithRetry}), and an
   * object still held after that is left for the next sweep.
   */
  async gcDeleteUnreachable(repo: string, hash: string, since: number): Promise<boolean> {
    if (await unreachableNoteTime(repo, hash) !== since) return false;
    const file = objectPath(repo, hash);
    const aside = `${file}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}${GC_ASIDE_SUFFIX}`;
    try {
      await renameWithRetry(file, aside);
    } catch (err) {
      if (isTransientFsError(err)) return false;
      if (!isNotFoundError(err)) throw err;
      await clearUnreachableNote(repo, hash);
      return false;
    }
    if (await unreachableNoteTime(repo, hash) !== since) {
      await restoreAside(aside, file);
      return false;
    }
    try {
      await unlinkWithRetry(aside);
    } catch (err) {
      // The backend's sweep put it back meanwhile
      if (isNotFoundError(err)) return false;
      if (!isTransientFsError(err)) throw err;
      await restoreAside(aside, file);
      return false;
    }
    await clearUnreachableNote(repo, hash);
    return true;
  }

  async gcRunWrite(repo: string, run: string, name: string, data: Uint8Array): Promise<void> {
    await atomicWriteFile(gcRunPath(repo, run, name), data);
  }

  async gcRunRead(repo: string, run: string, name: string): Promise<Uint8Array | null> {
    try {
      return await fs.readFile(gcRunPath(repo, run, name));
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  async gcRunDelete(repo: string, run: string): Promise<void> {
    await fs.rm(gcRunPath(repo, run), { recursive: true, force: true });
  }

  gcSweepBackend(repo: string, reachable: ReadonlySet<string>, options: GcBackendSweepOptions): Promise<GcBackendSweepResult> {
    return sweepLocalRepository(repo, reachable, options);
  }
}
