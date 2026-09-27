/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local filesystem repository initialization and discovery.
 *
 * This module handles creating and finding e3 repositories on the local
 * filesystem. It is used by the CLI and local development tools.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ArrayType, StringType, StructType, decodeBeast2For, encodeBeast2For, variant, type ValueTypeOf } from '@elaraai/east';
import { E3_RELEASE, RepoMetadataType } from '@elaraai/e3-types';
import { RepoLayoutError, isNotFoundError } from '../../errors.js';
import { atomicWriteFileSync } from './localHelpers.js';

/** The record a repository keeps at its root. */
export const REPOSITORY_FILENAME = 'repository.beast2';

/**
 * The repository record: the release that last wrote it, the store upgrades
 * the repository has had, and its metadata.
 */
export const RepositoryRecordType = StructType({
  /** The release of e3 that last wrote the record */
  release: StringType,
  /** The store upgrades the repository has had, in the order they were
   *  applied: each by its name, with the release of e3 that applied it */
  upgrades: ArrayType(StructType({ name: StringType, release: StringType })),
  /** The repository's name, status and times */
  metadata: RepoMetadataType,
});

export type RepositoryRecord = ValueTypeOf<typeof RepositoryRecordType>;

/** Encodes a repository record. */
export const encodeRepositoryRecord: (record: RepositoryRecord) => Uint8Array = encodeBeast2For(RepositoryRecordType);

const decodeRepositoryRecord = decodeBeast2For(RepositoryRecordType);

/**
 * A change to the forms a local repository keeps its records in, which the
 * release that makes it ships, and which an e3 opening a repository written
 * before it applies in place.
 *
 * @remarks
 * A step is synchronous and idempotent: it leaves a record already in the new
 * form as it is. A step a crash cut short runs again whole, and two processes
 * opening a repository at once may both apply it. It rewrites each record
 * atomically, so a reader sees one form or the other, never a torn file.
 */
export interface RepositoryUpgrade {
  /** The step's name, which the repository record keeps once it is applied:
   *  never another step's, nor reused */
  readonly name: string;
  /**
   * Rewrites the repository's records into the forms the release that ships
   * the step reads.
   *
   * @param repoPath - The repository's directory
   */
  apply(repoPath: string): void;
}

/**
 * The store upgrades this e3 knows, in the order they apply.
 *
 * @remarks
 * None yet: the layout this e3 writes is the first a repository record names.
 * A release that changes a stored form appends its step, and never edits,
 * reorders or removes a step a release has shipped. A test registers a step
 * of its own here, and removes it after.
 *
 * @internal
 */
export const REPOSITORY_UPGRADES: RepositoryUpgrade[] = [];

/**
 * Writes a new repository's record: its name, `active`, the time, this
 * release, and every store upgrade this e3 knows, since a new repository is in
 * the forms they write.
 *
 * @remarks
 * Every way a local repository is created writes it — `repoInit` for the CLI
 * and the tests, and `LocalRepoStore.create` for the API server.
 *
 * @param repoPath - The repository's directory
 * @param name - The repository's name
 */
export function writeNewRepoMetadata(repoPath: string, name: string): void {
  const now = new Date();
  fs.writeFileSync(path.join(repoPath, REPOSITORY_FILENAME), encodeRepositoryRecord({
    release: E3_RELEASE,
    upgrades: REPOSITORY_UPGRADES.map((upgrade) => ({ name: upgrade.name, release: E3_RELEASE })),
    metadata: { name, status: variant('active', null), createdAt: now, statusChangedAt: now },
  }));
}

/**
 * Opens a local repository: reads its record, refuses one this e3 cannot
 * read, and applies the store upgrades the repository has not had, in order,
 * before anything else reads it.
 *
 * @remarks
 * Each step is recorded, with this release, as soon as it is applied, so a
 * repository opened again after a crash between two steps is given only the
 * second. A repository that has had a step this e3 does not know was upgraded
 * by a newer e3, and is refused, naming the release that applied it. Releases
 * that change no stored form ship no step, so they open each other's
 * repositories either way.
 *
 * @param repoPath - The repository's directory
 * @returns The record, once every step this e3 knows is applied
 * @throws {RepoLayoutError} When the repository has no record this e3 reads,
 *   or has had an upgrade this e3 does not know
 */
export function repoOpen(repoPath: string): RepositoryRecord {
  const recordPath = path.join(repoPath, REPOSITORY_FILENAME);
  let data: Buffer;
  try {
    data = fs.readFileSync(recordPath);
  } catch (err) {
    if (isNotFoundError(err)) throw new RepoLayoutError(repoPath, null);
    throw err;
  }
  let record: RepositoryRecord;
  try {
    record = decodeRepositoryRecord(data);
  } catch {
    throw new RepoLayoutError(repoPath, null);
  }
  const known = new Set(REPOSITORY_UPGRADES.map((upgrade) => upgrade.name));
  const unknown = record.upgrades.find((upgrade) => !known.has(upgrade.name));
  if (unknown !== undefined) throw new RepoLayoutError(repoPath, unknown);
  const had = new Set(record.upgrades.map((upgrade) => upgrade.name));
  for (const upgrade of REPOSITORY_UPGRADES) {
    if (had.has(upgrade.name)) continue;
    upgrade.apply(repoPath);
    record = { ...record, release: E3_RELEASE, upgrades: [...record.upgrades, { name: upgrade.name, release: E3_RELEASE }] };
    atomicWriteFileSync(recordPath, encodeRepositoryRecord(record));
  }
  return record;
}

/**
 * Result of initializing an e3 repository
 */
export interface InitRepositoryResult {
  success: boolean;
  repoPath: string;
  error?: Error;
  alreadyExists?: boolean;
}

/**
 * Initialize a new e3 repository
 *
 * Creates the repository directory structure:
 * - objects/
 * - packages/
 * - executions/
 * - workspaces/
 *
 * and its record, named after the directory.
 *
 * The repository IS the specified directory - subdirectories are created directly within it.
 *
 * Pure business logic - no UI dependencies
 */
export function repoInit(repoPath: string): InitRepositoryResult {
  const targetPath = path.resolve(repoPath);

  // Check if directory already is a valid repository
  if (isValidRepository(targetPath)) {
    return {
      success: false,
      repoPath: targetPath,
      alreadyExists: true,
      error: new Error(`e3 repository already exists at ${targetPath}`),
    };
  }

  try {
    // Create the repository directory if it doesn't exist
    fs.mkdirSync(targetPath, { recursive: true });

    // Create objects directory (content-addressed storage)
    fs.mkdirSync(path.join(targetPath, 'objects'), { recursive: true });

    // Create packages directory (package refs: packages/<name>/<version>.beast2)
    fs.mkdirSync(path.join(targetPath, 'packages'), { recursive: true });

    // Create executions directory (execution records: executions/<task>/<inputs>/<id>/)
    fs.mkdirSync(path.join(targetPath, 'executions'), { recursive: true });

    // Create workspaces directory (workspace state)
    fs.mkdirSync(path.join(targetPath, 'workspaces'), { recursive: true });

    writeNewRepoMetadata(targetPath, path.basename(targetPath));

    return {
      success: true,
      repoPath: targetPath,
    };
  } catch (error) {
    return {
      success: false,
      repoPath: targetPath,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Validate that a directory is a valid e3 repository
 * @internal
 */
function isValidRepository(repoPath: string): boolean {
  const requiredDirs = ['objects', 'packages', 'executions', 'workspaces'];

  return requiredDirs.every((dir) => fs.existsSync(path.join(repoPath, dir)));
}

/**
 * Find the e3 repository directory
 *
 * Checks:
 * 1. E3_REPO environment variable
 * 2. The provided startPath (if given)
 *
 * A directory found is opened ({@link repoOpen}): refused when this e3 cannot
 * read it, and upgraded in place when an older release wrote it.
 *
 * @returns The repository's path, or null if no repository is found
 * @throws {RepoLayoutError} When this e3 cannot open the repository found
 */
export function repoFind(startPath?: string): string | null {
  // 1. Check E3_REPO environment variable
  if (process.env.E3_REPO) {
    const repoPath = path.resolve(process.env.E3_REPO);
    if (fs.existsSync(repoPath) && isValidRepository(repoPath)) {
      repoOpen(repoPath);
      return repoPath;
    }
  }

  // 2. Check the provided path
  if (startPath !== undefined) {
    const repoPath = path.resolve(startPath);
    if (fs.existsSync(repoPath) && isValidRepository(repoPath)) {
      repoOpen(repoPath);
      return repoPath;
    }
  }

  return null;
}

/**
 * Get the e3 repository, throw error if not found
 *
 * @throws {RepoLayoutError} When this e3 cannot open the repository
 */
export function repoGet(repoPath?: string): string {
  const repo = repoFind(repoPath);

  if (!repo) {
    throw new Error('e3 repository not found. Run `e3 repo create` to create one.');
  }

  return repo;
}
