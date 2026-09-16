/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Where an upload is staged before it becomes an object.
 *
 * @remarks
 * Under the REPOSITORY, not `os.tmpdir()`. A staged dataset becomes an object
 * by link or rename (`ObjectStore.adoptFile`), and both are same-device
 * operations — from a temp directory on another filesystem every commit would
 * silently degrade to a whole-file copy, which for a multi-gigabyte delivery is
 * the cost the transfer exists to avoid. The `.partial` suffix is the one `gc`
 * already knows to clean.
 *
 * @packageDocumentation
 */

import { join } from 'node:path';

/**
 * The staging path for a dataset upload.
 *
 * @param repoPath - Path to the e3 repository
 * @param id - The transfer's id
 * @returns The absolute staging path
 */
export function datasetStagingPath(repoPath: string, id: string): string {
  return join(repoPath, 'tmp', 'transfers', `${id}.beast2.partial`);
}

/** The directory {@link datasetStagingPath} places files in. */
export function datasetStagingDir(repoPath: string): string {
  return join(repoPath, 'tmp', 'transfers');
}
