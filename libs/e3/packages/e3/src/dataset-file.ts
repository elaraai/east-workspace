/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reading what a delivered beast2 file declares, without reading the file.
 *
 * A path-initialised input (`e3.input('table', T, variant('file', path))`) is
 * checked twice: once at EXPORT, against the type the package declares, so a
 * schema drift is a build error at the developer's desk; and again at DEPLOY,
 * on the machine that actually has the file. Both checks are this function, so
 * both report a mismatch identically — and both cost two ranged reads rather
 * than the gigabytes the file may hold.
 *
 * It lives in `@elaraai/e3` (not `e3-core`) because the export path is here and
 * `e3-core` depends on this package, not the other way round. It is Node-only
 * (`node:fs`) and therefore NOT on the `@elaraai/e3/browser` entry.
 *
 * @packageDocumentation
 */

import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import {
  isVariant,
  readBeast2Extents,
  readBeast2HeaderType,
  toEastTypeValue,
  type Beast2SyncRangeReader,
  type EastType,
  type EastTypeValue,
} from '@elaraai/east';
import { checkDatasetType, isCollectionRoot, type DatasetTypeMismatch } from '@elaraai/e3-types';

/** What a delivered file's header says about it. */
export interface DatasetFileHeader {
  /** Size in bytes. */
  readonly size: number;
  /** The root type the header declares. */
  readonly typeValue: EastTypeValue;
  /** Segment count, for a collection root; `null` otherwise. */
  readonly segments: number | null;
  /** Element count (pairs for a Dict), for a collection root; `null` otherwise. */
  readonly rows: number | null;
}

/**
 * Thrown when a delivered file's header does not match the type its
 * destination declares.
 *
 * @remarks
 * `e3-core` re-raises this as a `DatasetTypeMismatchError` once it knows the
 * workspace and the dataset's address; at export time this is what the author
 * sees, naming the input and the file.
 */
export class DatasetFileTypeMismatchError extends Error {
  constructor(
    public readonly file: string,
    public readonly mismatch: DatasetTypeMismatch
  ) {
    super(mismatch.message);
    this.name = 'DatasetFileTypeMismatchError';
  }
}

/** Positioned reads over a file. Opened read-only; a delivery is never
 *  written to, and its mode and mtime are left alone. */
function fileRangeReader(fd: number, size: number): Beast2SyncRangeReader {
  return {
    size,
    read(offset: number, length: number): Uint8Array {
      const out = new Uint8Array(length);
      let done = 0;
      while (done < length) {
        const n = readSync(fd, out, done, length - done, offset + done);
        if (n === 0) break;
        done += n;
      }
      return done === length ? out : out.subarray(0, done);
    },
  };
}

/**
 * Read a beast2 file's declared type and geometry and check it against the
 * type its destination declares.
 *
 * @remarks
 * A collection destination is checked through the trailing index
 * (`readBeast2Extents`), which also proves the file is pageable and
 * partitionable — that is the at-rest contract for a collection dataset, and a
 * delivery without it could not be carved. Every other root is checked through
 * the header type alone.
 *
 * @param file - Path to the delivered file
 * @param subject - How to name the destination in an error, e.g. `input 'table'`
 * @param declared - The type the destination declares
 * @returns The file's size, wire type and — for a collection — its geometry
 * @throws {DatasetFileTypeMismatchError} When the header's type is not the
 *   declared type
 * @throws {Error} When the file is missing, is not a beast2 container, or is a
 *   collection with no index or with cross-segment aliasing
 */
export function readDatasetFileHeader(
  file: string,
  subject: string,
  declared: EastType | EastTypeValue
): DatasetFileHeader {
  let stats;
  try {
    stats = statSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${subject}: no file at ${file}`);
    }
    throw err;
  }
  if (!stats.isFile()) throw new Error(`${subject}: ${file} is not a file`);

  const fd = openSync(file, 'r');
  try {
    const reader = fileRangeReader(fd, stats.size);
    const declaredValue: EastTypeValue = isVariant(declared)
      ? (declared as EastTypeValue)
      : toEastTypeValue(declared as EastType);
    let typeValue: EastTypeValue;
    let segments: number | null = null;
    let rows: number | null = null;

    if (isCollectionRoot(declaredValue)) {
      let extents;
      try {
        extents = readBeast2Extents(reader);
      } catch (err) {
        throw new Error(`${subject}: ${file} is not a readable indexed beast2 collection — ${
          err instanceof Error ? err.message : String(err)}`);
      }
      if (!extents.selfContained) {
        throw new Error(
          `${subject}: ${file} has cross-segment aliasing — a dataset's segments must decode ` +
          `independently, so partitions and paged reads can address them`
        );
      }
      typeValue = extents.typeValue;
      segments = extents.offsets.length;
      rows = extents.elementCount;
    } else {
      try {
        typeValue = readBeast2HeaderType(reader);
      } catch (err) {
        throw new Error(`${subject}: ${file} is not a readable beast2 container — ${
          err instanceof Error ? err.message : String(err)}`);
      }
    }

    const mismatch = checkDatasetType(subject, file, declaredValue, typeValue);
    if (mismatch) throw new DatasetFileTypeMismatchError(file, mismatch);

    return { size: stats.size, typeValue, segments, rows };
  } finally {
    closeSync(fd);
  }
}

/**
 * Read the root type a beast2 file's header declares, without reading the file.
 *
 * @remarks
 * Any container version, indexed or not: this is the check for a file that is
 * about to be DECODED (the positional `e3 dataset set`), which accepts every
 * beast2 it can read and refuses a drifted one from its header before paying
 * for the whole read. A file adopted as it stands needs the stricter
 * {@link readDatasetFileHeader}.
 *
 * @param file - Path to the file
 * @returns The root type the file's header declares
 * @throws {Error} When the file cannot be opened or is not a beast2 container
 */
export function readDatasetFileType(file: string): EastTypeValue {
  const fd = openSync(file, 'r');
  try {
    return readBeast2HeaderType(fileRangeReader(fd, fstatSync(fd).size));
  } finally {
    closeSync(fd);
  }
}
