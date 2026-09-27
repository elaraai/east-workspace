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
import { IntegerType, StructType, decodeBeast2For, encodeBeast2For, variant, type ValueTypeOf } from '@elaraai/east';
import { RepoMetadataType } from '@elaraai/e3-types';
import { RepoLayoutError, isNotFoundError } from '../../errors.js';

/** The record a repository keeps at its root. */
export const REPOSITORY_FILENAME = 'repository.beast2';

/**
 * The version of the local repository layout this e3 reads and writes: the
 * paths its records are kept at, and their types. A repository of another
 * version is refused, naming the fix.
 */
export const REPOSITORY_LAYOUT = 1n;

/** The repository record: the layout it was written in, and its metadata. */
export const RepositoryRecordType = StructType({
  /** The layout version */
  layout: IntegerType,
  /** The repository's name, status and times */
  metadata: RepoMetadataType,
});

export type RepositoryRecord = ValueTypeOf<typeof RepositoryRecordType>;

/** Encodes a repository record. */
export const encodeRepositoryRecord: (record: RepositoryRecord) => Uint8Array = encodeBeast2For(RepositoryRecordType);

const decodeRepositoryRecord = decodeBeast2For(RepositoryRecordType);

/**
 * Writes a new repository's record: its name, `active`, the time, and this
 * e3's layout.
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
    layout: REPOSITORY_LAYOUT,
    metadata: { name, status: variant('active', null), createdAt: now, statusChangedAt: now },
  }));
}

/**
 * Reads a repository's record, and refuses one of another layout.
 *
 * @param repoPath - The repository's directory
 * @returns The record, whose layout is this e3's
 * @throws {RepoLayoutError} When the repository has no record, or one that
 *   does not decode or is of another layout
 */
export function readRepositoryRecord(repoPath: string): RepositoryRecord {
  let data: Buffer;
  try {
    data = fs.readFileSync(path.join(repoPath, REPOSITORY_FILENAME));
  } catch (err) {
    if (isNotFoundError(err)) throw new RepoLayoutError(repoPath, null, REPOSITORY_LAYOUT);
    throw err;
  }
  let record: RepositoryRecord;
  try {
    record = decodeRepositoryRecord(data);
  } catch {
    throw new RepoLayoutError(repoPath, null, REPOSITORY_LAYOUT);
  }
  if (record.layout !== REPOSITORY_LAYOUT) throw new RepoLayoutError(repoPath, record.layout, REPOSITORY_LAYOUT);
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
 * A directory found is checked for this e3's layout.
 *
 * @returns The repository's path, or null if no repository is found
 * @throws {RepoLayoutError} When the repository found is of another layout
 */
export function repoFind(startPath?: string): string | null {
  // 1. Check E3_REPO environment variable
  if (process.env.E3_REPO) {
    const repoPath = path.resolve(process.env.E3_REPO);
    if (fs.existsSync(repoPath) && isValidRepository(repoPath)) {
      readRepositoryRecord(repoPath);
      return repoPath;
    }
  }

  // 2. Check the provided path
  if (startPath !== undefined) {
    const repoPath = path.resolve(startPath);
    if (fs.existsSync(repoPath) && isValidRepository(repoPath)) {
      readRepositoryRecord(repoPath);
      return repoPath;
    }
  }

  return null;
}

/**
 * Get the e3 repository, throw error if not found
 *
 * @throws {RepoLayoutError} When the repository is of another layout
 */
export function repoGet(repoPath?: string): string {
  const repo = repoFind(repoPath);

  if (!repo) {
    throw new Error('e3 repository not found. Run `e3 repo create` to create one.');
  }

  return repo;
}
