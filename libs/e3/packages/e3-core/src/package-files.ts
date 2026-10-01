/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A package's zip on this machine: an import, or a view, of a zip given as a
 * file, and an export to a file or a Node stream.
 *
 * Every backend reads a package's zip from a source read by ranges, and writes
 * it to a WHATWG stream (`packages.ts`). Here a file becomes such a source,
 * read through one open handle, or such a stream, written by way of
 * `<path>.partial` and renamed once the zip is whole; and a Node stream is
 * adapted to one (`Writable.toWeb`).
 */

import * as fs from 'node:fs/promises';
import { Writable } from 'node:stream';
import { ExportStoppedError } from './errors.js';
import { computeHash } from './objects-node.js';
import {
  packageExport as packageExportTo,
  packageImportFrom,
  packageZipOpenFrom,
  type PackageExportOptions,
  type PackageExportResult,
  type PackageImportOptions,
  type PackageImportResult,
  type PackageZip,
} from './packages.js';
import type { StorageBackend } from './storage/interfaces.js';
import type { PackageZipCheckpoint } from './transfer/types.js';
import { openZip as openZipSource, type ZipReader, type ZipSource } from './zip.js';

// Where an export resumes from the bytes its destination holds, which every
// backend's export shares
export { packageZipCheckpointWithin } from './packages.js';

/**
 * A zip that is a file on this machine, read by ranges through one handle,
 * which closes once the reads under way when it was closed have finished.
 */
class FileZipSource implements ZipSource {
  /** The reads under way. */
  private readonly reads = new Set<Promise<Uint8Array>>();
  /** The handle's close, once asked for. */
  private closing: Promise<void> | null = null;

  private constructor(private readonly file: fs.FileHandle, readonly size: number) {}

  /**
   * Opens the zip at `path`.
   *
   * @param path - The zip's path
   * @returns The zip, as a source
   * @throws {Error} When the file does not open: it is not there, say.
   */
  static async open(path: string): Promise<FileZipSource> {
    const file = await fs.open(path, 'r');
    try {
      return new FileZipSource(file, (await file.stat()).size);
    } catch (err) {
      await file.close();
      throw err;
    }
  }

  read(offset: number, length: number): Promise<Uint8Array> {
    if (this.closing !== null) return Promise.reject(new Error('the zip\'s file is closed'));
    const reading = this.readAt(offset, length);
    this.reads.add(reading);
    const done = (): void => {
      this.reads.delete(reading);
    };
    void reading.then(done, done);
    return reading;
  }

  /** Closes the file, once the reads under way have finished. */
  close(): Promise<void> {
    this.closing ??= Promise.allSettled([...this.reads]).then(() => this.file.close());
    return this.closing;
  }

  /** The bytes of the range: fewer, from a file cut short since it was
   *  opened, which the zip's reader refuses. */
  private async readAt(offset: number, length: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await this.file.read(bytes, filled, length - filled, offset + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return filled === length ? bytes : bytes.subarray(0, filled);
  }
}

/**
 * A zip written to a file on this machine by way of `<path>.partial`: opened at
 * its first byte, and, for an export going on from a checkpoint, cut back to
 * the bytes the checkpoint counts and written from there.
 */
class PartialZipFile {
  /** The stream the zip's bytes go to; closing it closes the file. */
  readonly sink: WritableStream<Uint8Array>;
  /** Whether the file was opened: an export that failed before it wrote
   *  touched no file. */
  opened = false;
  private file: fs.FileHandle | null = null;
  private at: number;

  /**
   * @param path - The partial zip's path
   * @param from - The bytes of it an export that goes on keeps: 0 for a zip
   *   begun anew
   */
  constructor(private readonly path: string, private readonly from: number) {
    this.at = from;
    this.sink = new WritableStream<Uint8Array>({
      write: (chunk) => this.write(chunk),
      close: () => this.close(),
    });
  }

  /** Closes the file, if it was opened; closing it again does nothing. */
  async close(): Promise<void> {
    const file = this.file;
    this.file = null;
    await file?.close();
  }

  /** Writes a chunk where the zip has got to. */
  private async write(chunk: Uint8Array): Promise<void> {
    const file = this.file ?? await this.open();
    for (let done = 0; done < chunk.byteLength;) {
      const { bytesWritten } = await file.write(chunk, done, chunk.byteLength - done, this.at);
      done += bytesWritten;
      this.at += bytesWritten;
    }
  }

  /** Opens the file: anew, or cut back to the bytes an export goes on from. */
  private async open(): Promise<fs.FileHandle> {
    this.opened = true;
    if (this.from === 0) {
      this.file = await fs.open(this.path, 'w');
    } else {
      await fs.truncate(this.path, this.from);
      this.file = await fs.open(this.path, 'r+');
    }
    return this.file;
  }
}

/**
 * Runs an export whose zip goes to `destination`, as the root entry writes
 * one: a file, by way of `<path>.partial`, renamed once the zip is whole; or a
 * Node stream, which the export ends once it is.
 *
 * @remarks
 * `run` writes the zip to the stream it is given, which it closes once the zip
 * is whole. An export it stops at its signal throws an
 * {@link ExportStoppedError}: a file keeps the partial zip, and a Node stream
 * is left as it is, holding the bytes the checkpoint counts. Given that
 * checkpoint, a file's partial zip is cut back to its bytes when the export
 * writes again. A file an export that failed otherwise wrote is removed; one
 * it never wrote is left as it was.
 *
 * @param destination - The zip's path, or the Node stream its bytes go to
 * @param resume - The checkpoint the export goes on from, if it does
 * @param run - Writes the zip to a stream, and returns what the export reports
 * @returns What `run` returned
 * @internal
 */
export async function exportZipTo<T>(
  destination: string | Writable,
  resume: PackageZipCheckpoint | undefined,
  run: (sink: WritableStream<Uint8Array>) => Promise<T>,
): Promise<T> {
  if (typeof destination !== 'string') return run(Writable.toWeb(destination) as WritableStream<Uint8Array>);

  const partial = `${destination}.partial`;
  const file = new PartialZipFile(partial, resume === undefined ? 0 : Number(resume.bytes));
  let result: T;
  try {
    result = await run(file.sink);
  } catch (err) {
    await file.close();
    // A stopped export keeps what it wrote, for the export that resumes it.
    if (!(err instanceof ExportStoppedError) && file.opened) await fs.rm(partial, { force: true });
    throw err;
  }
  await file.close();
  // Atomic rename to final path
  await fs.rename(partial, destination);
  return result;
}

/**
 * Opens a zip for reading, from a file on this machine or a source read by
 * ranges. It stays open once its entries have been iterated, so they can be
 * read after; its caller closes it, which closes a file it opened.
 *
 * @remarks
 * A file is read by ranges through one open handle, as any source is, a block
 * at a time. A failed read of the source is raised as a `ZipSourceError`,
 * whose cause is the source's own failure — a file's, for a file — here and
 * in every read of the zip's entries; any other failure is the zip's own.
 *
 * @param zip - The zip's path, or its source
 * @returns The zip, open, its entries read one at a time as they are asked for
 * @throws {ZipSourceError} When the zip's source fails a read.
 * @throws {Error} When the file does not open, or the zip's end records do not
 *   read: it is not a zip, or it is cut short.
 */
export async function openZip(zip: string | ZipSource): Promise<ZipReader> {
  if (typeof zip !== 'string') return openZipSource(zip);
  const file = await FileZipSource.open(zip);
  try {
    return await openZipSource(file, {
      onClose: () => {
        void file.close().catch(() => { /* a read-only handle: nothing of the zip is lost */ });
      },
    });
  } catch (err) {
    await file.close();
    throw err;
  }
}

/**
 * Import a package from a .zip file into the repository.
 *
 * Writes the zip's objects to the store and its package ref,
 * `packages/<name>/<version>.beast2`, to the repository, with the executions a
 * workspace's export carries, so the cache serves the outputs they made. A
 * run's record in the zip is not filed: it belongs to the repository the run
 * ran in.
 *
 * @remarks
 * The zip is read where it lies: a file on this machine, through one open
 * handle, or a source read by ranges, such as an upload staged in an object
 * store. It is imported as the portable entry's `packageImport` imports a
 * zip from a source: its directory read first, so a zip a newer release of e3
 * exported is refused with nothing of it imported; its objects first, those
 * the store holds re-referenced rather than read, the rest read and written
 * side by side and each checked against its CRC-32 and the hash its entry
 * names it by; its package ref last, holding the repository's running work.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param zip - The .zip package file's path, or its source
 * @param options - Progress, and a signal that stops the import between
 *   entries
 * @returns Import result with package name, version, and stats
 * @throws {PackageInvalidError} When the zip does not read — it is cut short,
 *   its directory does not read or names bytes past its end, an entry's bytes
 *   are not those its CRC-32 names — or holds no package ref, an object that
 *   is not the bytes its entry names, or an older e3 exported it in a form no
 *   longer read, or a newer release exported it
 * @throws {Error} An `AbortError`, when `options.signal` stopped the import; a
 *   read of the zip's source that failed, as the source raised it, and a file
 *   that does not open; and when a garbage collection or an upgrade holds the
 *   repository.
 */
export async function packageImport(
  storage: StorageBackend,
  repo: string,
  zip: string | ZipSource,
  options?: PackageImportOptions,
): Promise<PackageImportResult> {
  return packageImportFrom(storage, repo, () => openZip(zip), options);
}

/**
 * Open a package zip where it is, to read the package without importing it.
 *
 * @remarks
 * Reads the zip's directory and its package ref, and no object: a view reads
 * an object when it is asked for one, so a caller holds no more of the zip
 * than it reads. A deploy's plan reads the package object, its record,
 * migration and index objects, and its initial values. A view places an
 * object of the zip in a file on this machine when asked to (`materialize`),
 * and checks each object it reads against the hash its entry names it by, with
 * Node's own SHA-256.
 *
 * @param zip - The .zip package file's path, or its source
 * @returns The zip, open; the caller closes it
 * @throws {PackageInvalidError} When the zip does not read, holds no package
 *   ref, or an older e3 exported it in a form no longer read, or a newer
 *   release exported it, as {@link packageImport} refuses it
 * @throws {Error} A read of the zip's source that failed, as the source
 *   raised it, and a file that does not open.
 */
export async function packageZipOpen(zip: string | ZipSource): Promise<PackageZip> {
  return packageZipOpenFrom(() => openZip(zip), (destPath, data) => fs.writeFile(destPath, data), computeHash);
}

/**
 * Export a package to a .zip file, or to a stream.
 *
 * Collects the package object and every object it consists of
 * (`walkPackageObjects`).
 *
 * @remarks
 * The zip is written an entry at a time, as the portable entry's
 * `packageExport` writes it to a WHATWG stream: to a file, by way of
 * `<path>.partial`, renamed once the zip is whole; or to a Node stream, such
 * as a multipart upload, ended once it is. Its segments are read ahead of the
 * entry it writes. An export stopped at `options.signal` throws an
 * {@link ExportStoppedError}, whose checkpoint an export given it as
 * `options.resume` goes on from: a file keeps the zip so far at
 * `<path>.partial`, cut back to the checkpoint's bytes when the export goes
 * on, and a stream is left holding them.
 *
 * It holds the repository's running work while it reads, as an import does:
 * gc holding the repository still never sweeps what it reads — a package
 * removed meanwhile — and an upgrade waits for it rather than rewrite the
 * store under it. An export resumed in another call holds it in that call, and
 * refuses a checkpoint another release wrote, so an export that straddles an
 * upgraded release starts again.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param name - Package name
 * @param version - Package version
 * @param destination - The path to write the .zip file to, or the stream to
 *   write its bytes to
 * @param options - Progress, and the signal that stops the export and the
 *   checkpoint it resumes from
 * @returns Export result with package hash, object count and the zip's size
 * @throws {ExportStoppedError} When `options.signal` stopped the export.
 * @throws {Error} When `options.resume` is a checkpoint of another package, or
 *   another release wrote it; and when a garbage collection or an upgrade
 *   holds the repository.
 */
export async function packageExport(
  storage: StorageBackend,
  repo: string,
  name: string,
  version: string,
  destination: string | Writable,
  options: PackageExportOptions = {},
): Promise<PackageExportResult> {
  return exportZipTo(destination, options.resume, (sink) => packageExportTo(storage, repo, name, version, sink, options));
}
