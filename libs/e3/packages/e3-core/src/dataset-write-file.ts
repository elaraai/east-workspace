/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A stored dataset's value written out to a file on this machine: the
 * reverse of a file's adoption (`objectAdoptFile`).
 *
 * @packageDocumentation
 */

import { DatasetSegments, openDatasetObject } from './dataset-open.js';
import { writeOutputFile } from './output-file.js';
import type { StorageBackend } from './storage/interfaces.js';

/** How much of an object that is the value itself is read at once. */
const COPY_BYTES = 8 * 1024 * 1024;

/** How many of a collection's segments are read ahead of the file's writes. */
const READ_AHEAD = 4;

/**
 * Writes a stored dataset's value to a file, as one beast2 blob of its type: a
 * collection a segment at a time, in the order its manifest names them, and
 * any other value as the object it is, a range at a time, so no value is held
 * whole however large it is.
 *
 * @remarks
 * What a task's output becomes for a caller who asked for it as a file (`e3
 * run -o`): the value itself, which every runner and decoder reads, where a
 * collection's manifest names segments the file would not have beside it. The
 * file is replaced if it exists, never written into ({@link writeOutputFile}):
 * a write that fails leaves it as it was.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - The dataset object's hash: the manifest, for a collection
 * @param file - Where the value is written
 * @returns How many bytes were written
 * @throws {Error} When an object the value is made of is missing, or the file
 *   cannot be written
 * @example
 * const bytes = await datasetWriteFile(storage, repo, result.outputHash, 'model.beast2');
 */
export async function datasetWriteFile(storage: StorageBackend, repo: string, hash: string, file: string): Promise<number> {
  const opened = await openDatasetObject(storage, repo, hash);
  const { manifest } = opened;
  let written = 0;
  async function* chunks(): AsyncIterable<Uint8Array> {
    if (manifest !== null) {
      for await (const chunk of (await DatasetSegments.of(storage, repo, { ...opened, manifest })).splice({ readAhead: READ_AHEAD })) {
        written += chunk.length;
        yield chunk;
      }
      return;
    }
    const size = opened.size ?? (await storage.objects.stat(repo, opened.hash)).size;
    for (let at = 0; at < size; at += COPY_BYTES) {
      const chunk = await storage.objects.readRange(repo, opened.hash, at, Math.min(COPY_BYTES, size - at));
      written += chunk.length;
      yield chunk;
    }
  }
  await writeOutputFile(file, chunks());
  return written;
}
