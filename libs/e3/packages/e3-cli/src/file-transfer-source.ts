/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type { DatasetTransferSource } from '@elaraai/e3-api-client';

/**
 * A file as the transfer protocol reads it: by range, each range a fresh stream
 * of the file, so a part retried or sent alongside others never shares a read
 * position and the file is never held in memory.
 *
 * @param file - Path to the file
 * @param size - Its size in bytes
 * @param hash - Its SHA256, as lowercase hex
 * @returns The transfer source
 */
export function fileTransferSource(file: string, size: number, hash: string): DatasetTransferSource {
  return {
    size,
    hash,
    slice: (start, end) => end <= start
      ? new Uint8Array(0)
      // `createReadStream`'s `end` is inclusive.
      : Readable.toWeb(createReadStream(file, { start, end: end - 1 })) as ReadableStream<Uint8Array>,
  };
}
