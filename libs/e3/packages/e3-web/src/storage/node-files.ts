/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The files adapter over the machine's files: Node only.
 *
 * e3's Node test pass gives it to the stores, so `adoptFile` and
 * `materialize` take and place files on the machine, as the contract suites
 * name them. No browser bundle imports this module: it is the package's
 * `@elaraai/e3-web/node` entry alone.
 *
 * @packageDocumentation
 */

import { mkdir, open, rename, stat, unlink, type FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { FileNotFoundError, chunksOf, type ByteSource, type FileStat, type FilesAdapter } from './adapters.js';

/** How many bytes a read yields at a time. */
const READ_CHUNK = 64 * 1024;

/** Whether a failed file operation found nothing where it looked. */
function isAbsent(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * The machine's files, named by the machine's paths.
 *
 * @remarks
 * A write stages its file beside the destination, `<path>.<uuid>.partial`, and
 * renames it into place once it is whole, so a reader sees the file before the
 * write or after it, and a write that fails leaves the file as it was.
 *
 * @example
 * ```ts
 * const files = new NodeFiles();
 * await files.write('/tmp/delivery.beast2', bytes);
 * for await (const chunk of files.read('/tmp/delivery.beast2')) hash.update(chunk);
 * ```
 */
export class NodeFiles implements FilesAdapter {
  async stat(file: string): Promise<FileStat | null> {
    try {
      const info = await stat(file);
      return info.isFile() ? { size: info.size, lastModified: info.mtimeMs } : null;
    } catch (err) {
      if (isAbsent(err)) return null;
      throw err;
    }
  }

  async *read(file: string): AsyncIterable<Uint8Array> {
    if ((await this.stat(file)) === null) throw new FileNotFoundError(file);
    let handle: FileHandle;
    try {
      handle = await open(file, 'r');
    } catch (err) {
      if (isAbsent(err)) throw new FileNotFoundError(file);
      throw err;
    }
    try {
      const buffer = new Uint8Array(READ_CHUNK);
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, READ_CHUNK, null);
        if (bytesRead === 0) return;
        // A copy: the next read reuses the buffer.
        yield buffer.slice(0, bytesRead);
      }
    } finally {
      await handle.close();
    }
  }

  async write(file: string, data: ByteSource): Promise<number> {
    const staged = `${file}.${randomUUID()}.partial`;
    let handle: FileHandle;
    try {
      handle = await open(staged, 'wx');
    } catch (err) {
      if (isAbsent(err)) throw new FileNotFoundError(path.dirname(file));
      throw err;
    }
    let size = 0;
    try {
      try {
        for await (const chunk of chunksOf(data)) {
          for (let written = 0; written < chunk.length;) {
            written += (await handle.write(chunk, written, chunk.length - written, null)).bytesWritten;
          }
          size += chunk.length;
        }
      } finally {
        await handle.close();
      }
      await rename(staged, file);
      return size;
    } catch (err) {
      await unlink(staged).catch(() => undefined);
      throw err;
    }
  }

  async remove(file: string): Promise<boolean> {
    if ((await this.stat(file)) === null) return false;
    try {
      await unlink(file);
      return true;
    } catch (err) {
      if (isAbsent(err)) return false;
      throw err;
    }
  }

  async mkdir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }
}
