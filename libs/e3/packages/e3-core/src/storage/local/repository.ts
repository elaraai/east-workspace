/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Local filesystem repository initialization and discovery.
 *
 * This module handles creating and finding e3 repositories on the local
 * filesystem. It is used by the CLI and local development tools. A repository
 * found is opened with `repositoryOpen`, as every backend's is, before
 * anything reads it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { variant } from '@elaraai/east';
import { newRepositoryRecord } from '../../repository-record.js';
import { REPOSITORY_RECORD_FILE, encodeRepositoryRecord } from './LocalRefStore.js';
import { METADATA_FILE, encodeRepoMetadata } from './LocalRepoStore.js';
import { LOCAL_REPOSITORY_UPGRADES } from './upgrades.js';

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
 * and its records: the repository record, naming this release and every store
 * upgrade this e3 knows, and its metadata, named after the directory.
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

    // The records every creation writes, as the local stores keep them
    const now = new Date();
    fs.writeFileSync(path.join(targetPath, REPOSITORY_RECORD_FILE), encodeRepositoryRecord(newRepositoryRecord(LOCAL_REPOSITORY_UPGRADES)));
    fs.writeFileSync(path.join(targetPath, METADATA_FILE), encodeRepoMetadata({
      name: path.basename(targetPath), status: variant('active', null), createdAt: now, statusChangedAt: now,
    }));

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
 * A directory found is not opened: `repositoryOpen` opens it, refusing one
 * this e3 cannot read and upgrading one an older release wrote.
 *
 * @returns The repository's path, or null if no repository is found
 */
export function repoFind(startPath?: string): string | null {
  // 1. Check E3_REPO environment variable
  if (process.env.E3_REPO) {
    const repoPath = path.resolve(process.env.E3_REPO);
    if (fs.existsSync(repoPath) && isValidRepository(repoPath)) {
      return repoPath;
    }
  }

  // 2. Check the provided path
  if (startPath !== undefined) {
    const repoPath = path.resolve(startPath);
    if (fs.existsSync(repoPath) && isValidRepository(repoPath)) {
      return repoPath;
    }
  }

  return null;
}

/**
 * Get the e3 repository, throw error if not found
 *
 * @throws {Error} When no repository is found
 */
export function repoGet(repoPath?: string): string {
  const repo = repoFind(repoPath);

  if (!repo) {
    throw new Error('e3 repository not found. Run `e3 repo create` to create one.');
  }

  return repo;
}
