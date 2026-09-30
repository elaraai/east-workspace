/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Zips, read and written where they lie.
 *
 * A zip is read through its directory, from a file or from a source read by
 * ranges — an upload staged in an object store — and an entry is read when it
 * is asked for, so nothing holds a copy of the zip. A source is read a block
 * at a time, so the directory's entries and the small objects after it, read a
 * few dozen bytes each, cost a request per block rather than one each; a few
 * blocks are kept, and entries read side by side share the block they fall
 * in.
 *
 * A zip is written an entry at a time, to a file or a stream — a multipart
 * upload — holding one entry, with its directory last. Each entry is stored as
 * it stands, with no compression, since what e3 zips is compressed already,
 * and at one fixed time, so the same entries make the same bytes. The records
 * of the entries written, and the bytes they fill, are all a writer needs to
 * go on: a writer given them writes the zip one never stopped writes. Sizes
 * and offsets past 4 GiB, and more than 65,534 entries, are written as zip64.
 *
 * @packageDocumentation
 */

import { once } from 'node:events';
import { Readable, type Writable } from 'node:stream';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';

// =============================================================================
// Reading
// =============================================================================

/**
 * A zip read by ranges where it lies: its size, and its bytes a range at a
 * time — ranged reads of an object in a store elsewhere, say.
 */
export interface ZipSource {
  /** The zip's size in bytes. */
  readonly size: number;
  /**
   * Reads `length` bytes at `offset`, within the zip. A read that fails is
   * raised to the zip's reader as a {@link ZipSourceError}, its cause this
   * failure, so a caller tells a store's failure from the zip's own.
   *
   * @param offset - Where the range starts
   * @param length - How many bytes it holds
   * @returns Exactly the bytes of the range
   */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/**
 * A read of a zip's {@link ZipSource} that failed, as a zip read by ranges
 * raises it: its `cause` is the source's own failure — a store's throttle, an
 * expired credential — which a caller tells from a fault of the zip's own.
 */
export class ZipSourceError extends Error {
  /**
   * @param cause - The source's failure
   */
  constructor(cause: unknown) {
    super(`the zip's source failed a read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'ZipSourceError';
  }
}

/** An entry of a zip being read: read when its bytes are asked for. */
export interface ZipEntry {
  /** The entry's name. */
  fileName: string;
  /** The entry's size once inflated. */
  size: number;
  /** Reads the entry's bytes. */
  getData(): Promise<Buffer>;
}

/** The least a read of a {@link ZipSource} fetches: a block its next reads
 *  are served from while they fall in it. */
const ZIP_READ_BLOCK = 1024 * 1024;

/** The most one read of a {@link ZipSource} fetches, for an entry larger. */
const ZIP_READ_MAX = 8 * 1024 * 1024;

/** How many blocks a {@link ZipSource}'s reader keeps: the most recently used. */
const ZIP_BLOCKS_KEPT = 32;

/** yauzl's random access over a {@link ZipSource}, a block at a time. */
class RangedZipReader extends yauzl.RandomAccessReader {
  /** The blocks read, or being read, by the offset each starts at, a multiple
   *  of {@link ZIP_READ_BLOCK}; the most recently used last. */
  private readonly blocks = new Map<number, Promise<Uint8Array>>();

  constructor(private readonly source: ZipSource) {
    super();
  }

  override _readStreamForRange(start: number, end: number): Readable {
    return Readable.from(this.chunks(start, end), { objectMode: false });
  }

  /**
   * The bytes `[start, end)`, a block's worth at a time.
   *
   * @throws {Error} When the range runs past the zip's end, which only a zip
   *   whose directory names bytes it does not hold asks for: a read of a
   *   random access reader cut short reads to yauzl as a whole one, so the zip
   *   is refused here, as a file cut short is.
   */
  private async *chunks(start: number, end: number): AsyncGenerator<Buffer> {
    if (end > this.source.size) {
      throw new Error(`the zip names its bytes ${start} to ${end}, and it ends at ${this.source.size}`);
    }
    for (let at = start; at < end;) {
      const bytes = await this.bytesFrom(at, end);
      yield Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      at += bytes.byteLength;
    }
  }

  /**
   * The bytes from `at`, short of `end`: read on their own when more than a
   * block is left, and otherwise from the block `at` falls in, which is read
   * once however many reads want it.
   */
  private async bytesFrom(at: number, end: number): Promise<Uint8Array> {
    if (end - at > ZIP_READ_BLOCK) return this.readSource(at, Math.min(end - at, ZIP_READ_MAX));
    const start = at - (at % ZIP_READ_BLOCK);
    let block = this.blocks.get(start);
    if (block === undefined) {
      const reading = this.readSource(start, Math.min(ZIP_READ_BLOCK, this.source.size - start));
      // A block that failed to read is not kept; its readers hear why.
      reading.catch(() => {
        if (this.blocks.get(start) === reading) this.blocks.delete(start);
      });
      block = reading;
      if (this.blocks.size >= ZIP_BLOCKS_KEPT) this.blocks.delete(this.blocks.keys().next().value!);
    } else {
      this.blocks.delete(start);
    }
    this.blocks.set(start, block);
    const bytes = await block;
    return bytes.subarray(at - start, Math.min(end, start + bytes.byteLength) - start);
  }

  /**
   * Exactly `length` bytes of the source at `at`.
   *
   * @throws {ZipSourceError} When the source fails the read, or gives other
   *   than the bytes asked for.
   */
  private async readSource(at: number, length: number): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      bytes = await this.source.read(at, length);
    } catch (err) {
      throw new ZipSourceError(err);
    }
    if (bytes.byteLength !== length) {
      throw new ZipSourceError(new Error(`it gave ${bytes.byteLength} bytes for the ${length} at ${at}, within its ${this.source.size}`));
    }
    return bytes;
  }
}

/**
 * Opens a zip for reading, from a file or a source read by ranges. It stays
 * open once its entries have been iterated, so they can be read after; its
 * caller closes it.
 *
 * @remarks
 * A zip read by ranges raises a failed read of its source as a
 * {@link ZipSourceError}, whose cause is the source's own failure, here and in
 * every read of its entries; any other failure is the zip's own.
 *
 * @param zip - The zip's path, or its source
 * @returns The zip, open, its entries read one at a time as they are asked for
 * @throws {ZipSourceError} When the zip's source fails a read.
 * @throws {Error} When the zip's directory does not read.
 */
export function openZip(zip: string | ZipSource): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    const opened = (err: Error | null, zipfile?: yauzl.ZipFile): void => {
      if (err) return reject(err);
      if (!zipfile) return reject(new Error('No zipfile'));
      resolve(zipfile);
    };
    if (typeof zip === 'string') {
      yauzl.open(zip, { lazyEntries: true, autoClose: false }, opened);
    } else {
      yauzl.fromRandomAccessReader(new RangedZipReader(zip), zip.size, { lazyEntries: true, autoClose: false }, opened);
    }
  });
}

/**
 * The entries of an open zip, in its directory's order, each read when its
 * bytes are asked for.
 *
 * @param zipfile - The zip, as {@link openZip} opened it
 * @returns The entries
 */
export async function* iterateZipEntries(zipfile: yauzl.ZipFile): AsyncGenerator<ZipEntry> {
  // Create a queue for entries
  const entryQueue: Array<yauzl.Entry | null> = [];
  let resolveNext: (() => void) | null = null;
  let rejectNext: ((err: Error) => void) | null = null;

  zipfile.on('entry', (entry: yauzl.Entry) => {
    entryQueue.push(entry);
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  });

  zipfile.on('end', () => {
    entryQueue.push(null); // Signal end
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  });

  zipfile.on('error', (err: Error) => {
    if (rejectNext) {
      rejectNext(err);
      rejectNext = null;
    }
  });

  // Start reading
  zipfile.readEntry();

  while (true) {
    // Wait for an entry if queue is empty
    if (entryQueue.length === 0) {
      await new Promise<void>((resolve, reject) => {
        resolveNext = resolve;
        rejectNext = reject;
      });
    }

    const entry = entryQueue.shift();
    if (entry === null || entry === undefined) {
      return; // End of entries
    }

    // Create getData function for this entry
    const getData = (): Promise<Buffer> => {
      return new Promise((resolve, reject) => {
        zipfile.openReadStream(entry, (err, readStream) => {
          if (err) return reject(err);
          if (!readStream) return reject(new Error('No read stream'));

          const chunks: Buffer[] = [];
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
          readStream.on('end', () => resolve(Buffer.concat(chunks)));
          readStream.on('error', reject);
        });
      });
    };

    yield { fileName: entry.fileName, size: entry.uncompressedSize, getData };

    // Read next entry
    zipfile.readEntry();
  }
}

// =============================================================================
// Writing
// =============================================================================

/** An entry a zip holds, as its directory names it. */
export interface ZipRecord {
  /** The entry's name. */
  readonly name: string;
  /** Its bytes' CRC-32. */
  readonly crc32: number;
  /** Its size in bytes. */
  readonly size: number;
  /** Where its local header starts in the zip. */
  readonly offset: number;
}

/** Where a zip's writing has got to: every entry written, in order, and the
 *  bytes they fill, which a writer given them goes on from. */
export interface ZipWritten {
  /** The bytes of the zip written. */
  readonly bytes: number;
  /** The entries written, in order. */
  readonly entries: readonly ZipRecord[];
}

/** The value a zip field of 32 bits takes when zip64 holds the true one. */
const ZIP32_FULL = 0xffffffff;
/** The value a zip field of 16 bits takes when zip64 holds the true one. */
const ZIP16_FULL = 0xffff;
/** The first day a zip's date can name, 1980-01-01, at 00:00:00: every entry's
 *  time, so the same entries make the same bytes. */
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;
/** Entry names are UTF-8. */
const FLAG_UTF8 = 0x0800;
/** Made by zip 4.5, on UNIX: the version zip64 needs. */
const MADE_BY = (3 << 8) | 45;
/** A regular file, readable by all and writable by its owner. */
const REGULAR_FILE = (0o100644 << 16) >>> 0;

/**
 * Writes a zip to a stream an entry at a time, each stored as it stands, with
 * its directory last.
 *
 * @remarks
 * The writer holds nothing of an entry once it is written but its record, and
 * waits for the stream to drain, so a zip of any size is written in the memory
 * of its largest entry. Given where another writer's zip had got to, it goes
 * on from there: the stream holds that zip's bytes, and gets the rest.
 */
export class ZipWriter {
  private readonly records: ZipRecord[];
  private readonly names: Set<string>;
  private written: number;
  private failed: { err: unknown } | null = null;
  private readonly zip64At: number;
  private readonly zip64Entries: number;

  /**
   * @param sink - The stream the zip's bytes go to
   * @param from - Where the zip had got to, when another writer began it: the
   *   stream holds its bytes
   * @param limits - The size or offset, and the entry count, from which zip64
   *   holds a field: 4 GiB and 65,535 entries, which only a test lowers
   *   @internal
   */
  constructor(
    private readonly sink: Writable,
    from?: ZipWritten,
    limits: { zip64At?: number; zip64Entries?: number } = {},
  ) {
    this.records = [...(from?.entries ?? [])];
    this.names = new Set(this.records.map((record) => record.name));
    this.written = from?.bytes ?? 0;
    this.zip64At = limits.zip64At ?? ZIP32_FULL;
    this.zip64Entries = limits.zip64Entries ?? ZIP16_FULL;
    sink.on('error', (err: unknown) => { this.failed ??= { err }; });
  }

  /**
   * Whether the zip holds an entry of this name.
   *
   * @param name - The entry's name
   * @returns Whether it does
   */
  has(name: string): boolean {
    return this.names.has(name);
  }

  /** Where the zip has got to: every entry written, and the bytes they fill. */
  get progress(): ZipWritten {
    return { bytes: this.written, entries: this.records };
  }

  /**
   * Writes an entry: its local header, then its bytes.
   *
   * @param name - The entry's name
   * @param data - Its bytes
   * @throws {Error} When the zip holds an entry of the name already, or the
   *   stream failed.
   */
  async add(name: string, data: Uint8Array): Promise<void> {
    if (this.names.has(name)) throw new Error(`the zip holds an entry named ${name} already`);
    const nameBytes = Buffer.from(name, 'utf8');
    const size = data.byteLength;
    const zip64 = size >= this.zip64At;
    const header = Buffer.alloc(30 + nameBytes.length + (zip64 ? 20 : 0));
    const crc = crc32(data);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(zip64 ? 45 : 20, 4);
    header.writeUInt16LE(FLAG_UTF8, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(zip64 ? ZIP32_FULL : size, 18);
    header.writeUInt32LE(zip64 ? ZIP32_FULL : size, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(zip64 ? 20 : 0, 28);
    nameBytes.copy(header, 30);
    if (zip64) {
      const at = 30 + nameBytes.length;
      header.writeUInt16LE(0x0001, at);
      header.writeUInt16LE(16, at + 2);
      header.writeBigUInt64LE(BigInt(size), at + 4);
      header.writeBigUInt64LE(BigInt(size), at + 12);
    }
    const offset = this.written;
    await this.write(header);
    await this.write(data);
    this.records.push({ name, crc32: crc, size, offset });
    this.names.add(name);
  }

  /**
   * Writes the zip's directory, and zip64's end records when the zip needs
   * them; the stream is left for its owner to end.
   *
   * @returns The zip's size in bytes
   * @throws {Error} When the stream failed.
   */
  async finish(): Promise<number> {
    const start = this.written;
    for (const record of this.records) await this.write(this.centralHeader(record));
    const size = this.written - start;
    const count = this.records.length;
    const entries16 = count >= this.zip64Entries ? ZIP16_FULL : count;
    const size32 = size >= this.zip64At ? ZIP32_FULL : size;
    const start32 = start >= this.zip64At ? ZIP32_FULL : start;
    if (entries16 === ZIP16_FULL || size32 === ZIP32_FULL || start32 === ZIP32_FULL) {
      const record = Buffer.alloc(56);
      const recordAt = this.written;
      record.writeUInt32LE(0x06064b50, 0);
      record.writeBigUInt64LE(44n, 4);
      record.writeUInt16LE(MADE_BY, 12);
      record.writeUInt16LE(45, 14);
      record.writeUInt32LE(0, 16);
      record.writeUInt32LE(0, 20);
      record.writeBigUInt64LE(BigInt(count), 24);
      record.writeBigUInt64LE(BigInt(count), 32);
      record.writeBigUInt64LE(BigInt(size), 40);
      record.writeBigUInt64LE(BigInt(start), 48);
      await this.write(record);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(0x07064b50, 0);
      locator.writeUInt32LE(0, 4);
      locator.writeBigUInt64LE(BigInt(recordAt), 8);
      locator.writeUInt32LE(1, 16);
      await this.write(locator);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries16, 8);
    end.writeUInt16LE(entries16, 10);
    end.writeUInt32LE(size32, 12);
    end.writeUInt32LE(start32, 16);
    end.writeUInt16LE(0, 20);
    await this.write(end);
    return this.written;
  }

  /** An entry's header in the zip's directory, with zip64's field for a size
   *  or offset too large for its own. */
  private centralHeader(record: ZipRecord): Buffer {
    const nameBytes = Buffer.from(record.name, 'utf8');
    const largeSize = record.size >= this.zip64At;
    const largeOffset = record.offset >= this.zip64At;
    const extra = (largeSize ? 16 : 0) + (largeOffset ? 8 : 0);
    const header = Buffer.alloc(46 + nameBytes.length + (extra > 0 ? 4 + extra : 0));
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(MADE_BY, 4);
    header.writeUInt16LE(extra > 0 ? 45 : 20, 6);
    header.writeUInt16LE(FLAG_UTF8, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(record.crc32, 16);
    header.writeUInt32LE(largeSize ? ZIP32_FULL : record.size, 20);
    header.writeUInt32LE(largeSize ? ZIP32_FULL : record.size, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt16LE(extra > 0 ? 4 + extra : 0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(REGULAR_FILE, 38);
    header.writeUInt32LE(largeOffset ? ZIP32_FULL : record.offset, 42);
    nameBytes.copy(header, 46);
    if (extra > 0) {
      let at = 46 + nameBytes.length;
      header.writeUInt16LE(0x0001, at);
      header.writeUInt16LE(extra, at + 2);
      at += 4;
      if (largeSize) {
        header.writeBigUInt64LE(BigInt(record.size), at);
        header.writeBigUInt64LE(BigInt(record.size), at + 8);
        at += 16;
      }
      if (largeOffset) header.writeBigUInt64LE(BigInt(record.offset), at);
    }
    return header;
  }

  /** Writes a chunk, waiting while the stream is full. */
  private async write(chunk: Uint8Array): Promise<void> {
    if (this.failed !== null) throw this.failed.err;
    const room = this.sink.write(chunk);
    this.written += chunk.byteLength;
    if (!room) await once(this.sink, 'drain');
  }
}
