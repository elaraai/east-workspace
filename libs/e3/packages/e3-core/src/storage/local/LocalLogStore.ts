/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { LogChunk, LogStore } from '../interfaces.js';
import { isNotFoundError } from '../../errors.js';

/**
 * Length of the longest prefix of `buffer` that ends on a UTF-8 character
 * boundary.
 *
 * Each chunk is decoded independently, so a chunk that stopped mid-character
 * would decode to U+FFFD on *both* sides of the boundary and corrupt a paged
 * read. Malformed input is left alone (nothing to preserve).
 */
function completeUtf8Length(buffer: Buffer): number {
  // Walk back over the trailing continuation bytes to the lead byte of the
  // final sequence; keep that sequence only if all of its bytes are present.
  for (let i = buffer.length - 1, trailing = 0; i >= 0 && trailing < 4; i--, trailing++) {
    const byte = buffer[i]!;
    if ((byte & 0xc0) === 0x80) continue;
    const width = byte < 0x80 ? 1 : (byte & 0xe0) === 0xc0 ? 2 : (byte & 0xf0) === 0xe0 ? 3 : 4;
    return trailing + 1 >= width ? buffer.length : i;
  }
  return buffer.length;
}

/**
 * Local filesystem implementation of LogStore.
 *
 * Logs are stored as text files in the execution directory:
 *   executions/<taskHash>/<inputsHash>/<executionId>/stdout.txt
 *   executions/<taskHash>/<inputsHash>/<executionId>/stderr.txt
 *
 * The `repo` parameter is the path to the e3 repository directory.
 */
export class LocalLogStore implements LogStore {
  private logPath(repo: string, taskHash: string, inputsHash: string, executionId: string, stream: 'stdout' | 'stderr'): string {
    return path.join(
      repo,
      'executions',
      taskHash,
      inputsHash,
      executionId,
      `${stream}.txt`
    );
  }

  async append(
    repo: string,
    taskHash: string,
    inputsHash: string,
    executionId: string,
    stream: 'stdout' | 'stderr',
    data: string
  ): Promise<void> {
    const logFile = this.logPath(repo, taskHash, inputsHash, executionId, stream);
    const dir = path.dirname(logFile);

    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(logFile, data);
  }

  async read(
    repo: string,
    taskHash: string,
    inputsHash: string,
    executionId: string,
    stream: 'stdout' | 'stderr',
    options?: { offset?: number; limit?: number }
  ): Promise<LogChunk> {
    const logFile = this.logPath(repo, taskHash, inputsHash, executionId, stream);

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 65536; // 64KB default

    try {
      const stat = await fs.stat(logFile);
      const totalSize = stat.size;

      // Open file and read chunk
      const fd = await fs.open(logFile, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(limit, Math.max(0, totalSize - offset)));
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, offset);

        // Stop short of a split character so the caller can resume at `offset +
        // size` and get the whole character. At EOF there is no continuation to
        // wait for, and trimming to nothing would stall a pager, so both keep
        // the raw read.
        const atEof = offset + bytesRead >= totalSize;
        const size = atEof ? bytesRead : completeUtf8Length(buffer.subarray(0, bytesRead)) || bytesRead;

        return {
          data: buffer.subarray(0, size).toString('utf-8'),
          offset,
          size,
          totalSize,
          complete: offset + size >= totalSize,
        };
      } finally {
        await fd.close();
      }
    } catch (err) {
      if (isNotFoundError(err)) {
        // Log file doesn't exist yet
        return {
          data: '',
          offset: 0,
          size: 0,
          totalSize: 0,
          complete: true,
        };
      }
      throw err;
    }
  }
}
