/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Zips, read and written where they lie, by every backend.
 *
 * A zip is read through its directory, by ranges of a source — a file, an
 * upload staged in an object store, a file a browser keeps — and an entry is
 * read when it is asked for, so nothing holds a copy of the zip. A source is
 * read a block at a time, so the directory's entries and the small objects
 * after it, read a few dozen bytes each, cost a request per block rather than
 * one each; a few blocks are kept, and entries read side by side share the
 * block they fall in. An entry is stored as it stands or deflated, as the SDK's
 * `e3.export` writes them, and a deflated one is inflated by east's
 * `inflateRawSync`: Node's zlib where there is one, east's own inflate
 * elsewhere. Every entry's bytes are checked against the CRC-32 the directory
 * names them by. Sizes and offsets past 4 GiB, and more than 65,534 entries,
 * are read from zip64's records.
 *
 * A zip is written an entry at a time, to a stream — a file, a multipart
 * upload, a file a browser keeps — holding one entry, with its directory last.
 * Each entry is stored as it stands, with no compression, since what e3 zips is
 * compressed already, and at one fixed time, so the same entries make the same
 * bytes. The records of the entries written, and the bytes they fill, are all
 * a writer needs to go on: a writer given them writes the zip one never stopped
 * writes. Sizes and offsets past 4 GiB, and more than 65,534 entries, are
 * written as zip64.
 *
 * Nothing here needs Node: a file on this machine becomes a source or a stream
 * in the root entry's `package-files.ts`.
 *
 * @packageDocumentation
 */

import { crc32, inflateRawSync } from '@elaraai/east/internal';

// =============================================================================
// The format
// =============================================================================

/** A local header's signature, before each entry's bytes. */
const LOCAL_HEADER = 0x04034b50;
/** A directory entry's signature. */
const CENTRAL_HEADER = 0x02014b50;
/** The end record's signature, last in a zip. */
const END_RECORD = 0x06054b50;
/** zip64's end record's signature. */
const ZIP64_END_RECORD = 0x06064b50;
/** zip64's locator's signature, just before the end record. */
const ZIP64_LOCATOR = 0x07064b50;
/** The fixed part of a local header. */
const LOCAL_HEADER_SIZE = 30;
/** The fixed part of a directory entry. */
const CENTRAL_HEADER_SIZE = 46;
/** The fixed part of the end record, before its comment. */
const END_RECORD_SIZE = 22;
/** zip64's end record, with no extensible data. */
const ZIP64_END_RECORD_SIZE = 56;
/** zip64's locator. */
const ZIP64_LOCATOR_SIZE = 20;
/** The longest comment an end record holds. */
const MAX_COMMENT = 0xffff;
/** The extra field that holds the sizes and offset too large for their own. */
const ZIP64_EXTRA = 0x0001;
/** Info-ZIP's extra field holding an entry's name in UTF-8. */
const UNICODE_PATH_EXTRA = 0x7075;
/** An entry's bytes as they stand. */
const STORED = 0;
/** An entry's bytes as raw DEFLATE. */
const DEFLATED = 8;
/** An entry encrypted the traditional way. */
const FLAG_ENCRYPTED = 0x0001;
/** An entry encrypted strongly. */
const FLAG_STRONG_ENCRYPTION = 0x0040;
/** Entry names are UTF-8. */
const FLAG_UTF8 = 0x0800;
/** The value a zip field of 32 bits takes when zip64 holds the true one. */
const ZIP32_FULL = 0xffffffff;
/** The value a zip field of 16 bits takes when zip64 holds the true one. */
const ZIP16_FULL = 0xffff;

/** A little-endian view of `bytes`, over their own range of their buffer. */
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The unsigned 64-bit integer at `at`, as a number: exact to 2^53, past any
 *  zip a source can hold. */
function u64(data: DataView, at: number): number {
  return Number(data.getBigUint64(at, true));
}

/** A CRC-32 as eight hex digits. */
function hex(crc: number): string {
  return crc.toString(16).padStart(8, '0');
}

/** What a failure says. */
function why(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
  /**
   * Reads the entry's bytes: inflated when the zip deflated them, and checked
   * against the CRC-32 the zip's directory names them by.
   *
   * @returns The bytes, a copy of their own
   * @throws {ZipSourceError} When the zip's source fails a read.
   * @throws {Error} When the entry does not read: it has no local header, its
   *   bytes run past the zip's end, it is encrypted or compressed by a method
   *   other than deflate, it does not inflate to its size, or its bytes are not
   *   those its CRC-32 names; and when the zip is closed.
   */
  getData(): Promise<Uint8Array>;
}

/**
 * A zip open for reading: its directory, whose entries are read one at a time
 * as they are asked for. Its caller closes it.
 */
export interface ZipReader {
  /**
   * The zip's entries, in its directory's order, each read when its bytes are
   * asked for. Each call reads the directory from its start.
   *
   * @returns The entries
   * @throws {ZipSourceError} When the zip's source fails a read.
   * @throws {Error} When the directory does not read: an entry that is not
   *   there, one that runs past the directory's end, one whose name, extra
   *   fields or sizes do not read, or one strongly encrypted.
   */
  entries(): AsyncGenerator<ZipEntry>;
  /** Closes the zip: what reads from it after is refused, and the blocks it
   *  kept go. */
  close(): void;
}

/** The least a read of a {@link ZipSource} fetches: a block its next reads
 *  are served from while they fall in it. */
const ZIP_READ_BLOCK = 1024 * 1024;

/** The most one read of a {@link ZipSource} fetches, for an entry larger. */
const ZIP_READ_MAX = 8 * 1024 * 1024;

/** How many blocks a {@link ZipSource}'s reader keeps: the most recently used. */
const ZIP_BLOCKS_KEPT = 32;

/** A {@link ZipSource} read a block at a time, a few blocks kept. */
class BlockReader {
  /** The blocks read, or being read, by the offset each starts at, a multiple
   *  of {@link ZIP_READ_BLOCK}; the most recently used last. */
  private readonly blocks = new Map<number, Promise<Uint8Array>>();

  constructor(private readonly source: ZipSource) {}

  /** The zip's size in bytes. */
  get size(): number {
    return this.source.size;
  }

  /**
   * The bytes `[start, end)`: a view of the block they fall in when they fall
   * in one, and a copy of their own otherwise.
   *
   * @throws {Error} When the range runs past the zip's end, which only a zip
   *   whose directory names bytes it does not hold asks for.
   * @throws {ZipSourceError} When the source fails a read.
   */
  async view(start: number, end: number): Promise<Uint8Array> {
    this.within(start, end);
    if (start === end) return new Uint8Array(0);
    const first = await this.bytesFrom(start, end);
    return first.byteLength === end - start ? first : this.assemble(start, end, first);
  }

  /**
   * The bytes `[start, end)`, a copy of their own, read a block's worth at a
   * time.
   *
   * @throws {Error} When the range runs past the zip's end.
   * @throws {ZipSourceError} When the source fails a read.
   */
  async copy(start: number, end: number): Promise<Uint8Array> {
    this.within(start, end);
    return this.assemble(start, end, new Uint8Array(0));
  }

  /** The bytes `[start, end)` into an array of their own, from the `first`
   *  of them, read already. */
  private async assemble(start: number, end: number, first: Uint8Array): Promise<Uint8Array> {
    const out = new Uint8Array(end - start);
    out.set(first, 0);
    for (let at = start + first.byteLength; at < end;) {
      const bytes = await this.bytesFrom(at, end);
      out.set(bytes, at - start);
      at += bytes.byteLength;
    }
    return out;
  }

  /** Drops the blocks kept. */
  clear(): void {
    this.blocks.clear();
  }

  /** Refuses a range past the zip's end: a read of it cut short would read as
   *  a whole one. */
  private within(start: number, end: number): void {
    if (end > this.source.size) {
      throw new Error(`the zip names its bytes ${start} to ${end}, and it ends at ${this.source.size}`);
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

/** Where a zip's directory lies, as its end records say. */
interface Directory {
  /** Where its first entry starts. */
  readonly offset: number;
  /** Its bytes. */
  readonly size: number;
  /** How many entries it holds. */
  readonly count: number;
}

/**
 * Reads a zip's end record, and zip64's when its locator is there, for where
 * the zip's directory lies.
 *
 * @remarks
 * The end record is last, after a comment of up to 65,535 bytes, so it is
 * looked for back from the zip's end; the first found is the zip's, and the
 * comment it names must run to the end. zip64's locator, when there is one,
 * sits just before it and names zip64's end record, which holds the directory's
 * place in full.
 *
 * @throws {Error} When the zip has no end record — it is not a zip, or it is
 *   cut short — or bytes follow it, zip64's records do not read, the zip spans
 *   disks, or its directory does not lie before its end records.
 * @throws {ZipSourceError} When the source fails a read.
 */
async function readDirectory(reader: BlockReader): Promise<Directory> {
  const tailStart = Math.max(0, reader.size - (ZIP64_LOCATOR_SIZE + END_RECORD_SIZE + MAX_COMMENT));
  const tail = await reader.view(tailStart, reader.size);
  const at = view(tail);
  for (let end = tail.byteLength - END_RECORD_SIZE; end >= 0; end--) {
    if (at.getUint32(end, true) !== END_RECORD) continue;
    const comment = at.getUint16(end + 20, true);
    const follows = tail.byteLength - end - END_RECORD_SIZE;
    if (comment !== follows) {
      throw new Error(`the zip's end record names a comment of ${comment} bytes, and ${follows} follow it: ` +
        'bytes were added after the zip, or its comment holds the end record\'s signature');
    }
    const locator = end - ZIP64_LOCATOR_SIZE;
    if (locator >= 0 && at.getUint32(locator, true) === ZIP64_LOCATOR) {
      const recordAt = u64(at, locator + 8);
      const record = view(await reader.view(recordAt, recordAt + ZIP64_END_RECORD_SIZE));
      if (record.getUint32(0, true) !== ZIP64_END_RECORD) {
        throw new Error(`the zip's zip64 locator names an end record at ${recordAt}, and there is none there`);
      }
      const disk = record.getUint32(16, true);
      if (disk !== 0) throw new Error(`the zip is disk ${disk} of several, and e3 reads a zip of one`);
      return placed({ offset: u64(record, 48), size: u64(record, 40), count: u64(record, 32) }, recordAt);
    }
    const disk = at.getUint16(end + 4, true);
    if (disk !== 0) throw new Error(`the zip is disk ${disk} of several, and e3 reads a zip of one`);
    return placed({ offset: at.getUint32(end + 16, true), size: at.getUint32(end + 12, true), count: at.getUint16(end + 10, true) }, tailStart + end);
  }
  throw new Error('the zip has no end record: it is not a zip, or it is cut short');
}

/**
 * Checks a directory lies before the end records, which start at `before`, and
 * has the room its entries take.
 *
 * @throws {Error} When it does not.
 */
function placed(directory: Directory, before: number): Directory {
  const { offset, size, count } = directory;
  if (offset + size > before) {
    throw new Error(`the zip's directory is ${size} bytes at ${offset}, and its end records start at ${before}`);
  }
  if (count * CENTRAL_HEADER_SIZE > size) {
    throw new Error(`the zip's directory names ${count} entries in ${size} bytes, which hold at most ${Math.floor(size / CENTRAL_HEADER_SIZE)}`);
  }
  return directory;
}

/**
 * An entry's extra fields, by the id of each.
 *
 * @throws {Error} When a field runs past the extra fields' end.
 */
function extraFields(extra: Uint8Array, name: string): Map<number, Uint8Array> {
  const fields = new Map<number, Uint8Array>();
  const at = view(extra);
  for (let i = 0; i + 4 <= extra.byteLength;) {
    const id = at.getUint16(i, true);
    const size = at.getUint16(i + 2, true);
    if (i + 4 + size > extra.byteLength) {
      throw new Error(`the zip's entry ${name} has an extra field of ${size} bytes at ${i}, and its extra fields hold ${extra.byteLength}`);
    }
    if (!fields.has(id)) fields.set(id, extra.subarray(i + 4, i + 4 + size));
    i += 4 + size;
  }
  return fields;
}

/** The characters of IBM code page 437, by byte: what a zip's name is in when
 *  it is not flagged UTF-8. */
const CP437 =
  '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼ !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂' +
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/** Decodes UTF-8, a malformed sequence as U+FFFD. */
const UTF8 = new TextDecoder();

/**
 * An entry's name: UTF-8 when the entry is flagged so, or when Info-ZIP's
 * extra field holds it for the name it stands for, and code page 437
 * otherwise, as the format has it; a backslash read as a slash.
 *
 * @throws {Error} When the name is a path from the root, or leaves the zip's
 *   root.
 */
function entryName(flags: number, raw: Uint8Array, extras: ReadonlyMap<number, Uint8Array>): string {
  let name: string | null = null;
  const unicode = extras.get(UNICODE_PATH_EXTRA);
  // Version 1, then the CRC-32 of the name it stands for, then the name.
  if (unicode !== undefined && unicode.byteLength > 5 && unicode[0] === 1 && view(unicode).getUint32(1, true) === crc32(raw)) {
    name = UTF8.decode(unicode.subarray(5));
  }
  if (name === null) {
    name = flags & FLAG_UTF8 ? UTF8.decode(raw) : Array.from(raw, (byte) => CP437[byte]!).join('');
  }
  name = name.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(name) || name.startsWith('/')) {
    throw new Error(`the zip's entry ${name} is a path from the root, and an entry's path is within the zip`);
  }
  if (name.split('/').includes('..')) {
    throw new Error(`the zip's entry ${name} names a path out of the zip`);
  }
  return name;
}

/** An entry as the zip's directory names it. */
interface EntryRecord {
  /** Its name. */
  readonly name: string;
  /** Its general purpose flags. */
  readonly flags: number;
  /** How its bytes are compressed. */
  readonly method: number;
  /** Its bytes' CRC-32. */
  readonly crc32: number;
  /** Its bytes as the zip holds them. */
  readonly compressedSize: number;
  /** Its bytes once inflated. */
  readonly size: number;
  /** Where its local header starts. */
  readonly offset: number;
}

/**
 * Reads the directory entry at `at`, within the directory, which ends at
 * `end`.
 *
 * @returns The entry, and where the next one starts
 * @throws {Error} When no entry is there, it runs past the directory, or its
 *   name, extra fields or sizes do not read, or it is strongly encrypted.
 * @throws {ZipSourceError} When the source fails a read.
 */
async function readEntryRecord(reader: BlockReader, at: number, end: number, which: string): Promise<{ record: EntryRecord; next: number }> {
  if (at + CENTRAL_HEADER_SIZE > end) {
    throw new Error(`the zip's directory ends at ${end}, before its ${which}`);
  }
  const header = view(await reader.view(at, at + CENTRAL_HEADER_SIZE));
  if (header.getUint32(0, true) !== CENTRAL_HEADER) {
    throw new Error(`the zip's directory has no entry at ${at}, where its ${which} would be`);
  }
  const flags = header.getUint16(8, true);
  const method = header.getUint16(10, true);
  const crc = header.getUint32(16, true);
  let compressedSize = header.getUint32(20, true);
  let size = header.getUint32(24, true);
  const nameLength = header.getUint16(28, true);
  const extraLength = header.getUint16(30, true);
  const commentLength = header.getUint16(32, true);
  let offset = header.getUint32(42, true);
  const next = at + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  if (next > end) {
    throw new Error(`the zip's directory ends at ${end}, inside its ${which}`);
  }
  const rest = await reader.view(at + CENTRAL_HEADER_SIZE, at + CENTRAL_HEADER_SIZE + nameLength + extraLength);
  const raw = rest.subarray(0, nameLength);
  // The name for the extra fields' refusals, until the name itself is read.
  const extras = extraFields(rest.subarray(nameLength), UTF8.decode(raw));
  const name = entryName(flags, raw, extras);
  if (flags & FLAG_STRONG_ENCRYPTION) {
    throw new Error(`the zip's entry ${name} is strongly encrypted, which e3 does not read`);
  }

  // zip64's field holds, in order, each of the three too large for its own.
  const zip64 = extras.get(ZIP64_EXTRA);
  if (zip64 !== undefined) {
    const fields = view(zip64);
    let field = 0;
    const take = (what: string): number => {
      if (field + 8 > zip64.byteLength) throw new Error(`the zip's entry ${name} holds its ${what} in zip64's extra field, which does not hold it`);
      const value = u64(fields, field);
      field += 8;
      return value;
    };
    if (size === ZIP32_FULL) size = take('size');
    if (compressedSize === ZIP32_FULL) compressedSize = take('compressed size');
    if (offset === ZIP32_FULL) offset = take('offset');
  }
  if (method === STORED && compressedSize !== size + (flags & FLAG_ENCRYPTED ? 12 : 0)) {
    throw new Error(`the zip's entry ${name} is stored, and the zip holds ${compressedSize} bytes of its ${size}`);
  }
  return { record: { name, flags, method, crc32: crc, compressedSize, size, offset }, next };
}

/** A zip open for reading, over a source read a block at a time. */
class OpenZip implements ZipReader {
  private closed = false;

  constructor(
    private readonly reader: BlockReader,
    private readonly directory: Directory,
    private readonly onClose: (() => void) | undefined,
  ) {}

  async *entries(): AsyncGenerator<ZipEntry> {
    const { offset, size, count } = this.directory;
    let at = offset;
    for (let i = 0; i < count; i++) {
      this.open();
      const { record, next } = await readEntryRecord(this.reader, at, offset + size, `entry ${i + 1} of ${count}`);
      at = next;
      yield { fileName: record.name, size: record.size, getData: () => this.read(record) };
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.reader.clear();
    this.onClose?.();
  }

  /** Refuses a read of a zip closed. */
  private open(): void {
    if (this.closed) throw new Error('the zip is closed');
  }

  /**
   * An entry's bytes: from after its local header, inflated when deflated,
   * and checked against its CRC-32.
   */
  private async read(entry: EntryRecord): Promise<Uint8Array> {
    this.open();
    const { name, flags, method, offset, compressedSize, size } = entry;
    if (flags & FLAG_ENCRYPTED) throw new Error(`the zip's entry ${name} is encrypted, which e3 does not read`);
    if (method !== STORED && method !== DEFLATED) {
      throw new Error(`the zip's entry ${name} is compressed by method ${method}, and e3 reads entries stored or deflated`);
    }
    const local = view(await this.reader.view(offset, offset + LOCAL_HEADER_SIZE));
    if (local.getUint32(0, true) !== LOCAL_HEADER) {
      throw new Error(`the zip's entry ${name} has no local header at ${offset}`);
    }
    // The local header's name and extra fields need not be the directory's.
    const start = offset + LOCAL_HEADER_SIZE + local.getUint16(26, true) + local.getUint16(28, true);
    let data: Uint8Array;
    if (method === STORED) {
      data = await this.reader.copy(start, start + compressedSize);
    } else {
      const deflated = await this.reader.view(start, start + compressedSize);
      try {
        // zlib gives a Buffer: the entry's bytes are plain bytes, whichever inflates them.
        const inflated = inflateRawSync(deflated, size);
        data = new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
      } catch (err) {
        throw new Error(`the zip's entry ${name} does not inflate to its ${size} bytes: ${why(err)}`);
      }
    }
    const crc = crc32(data);
    if (crc !== entry.crc32) {
      throw new Error(`the zip's entry ${name} is damaged: its bytes' CRC-32 is ${hex(crc)}, and the zip names ${hex(entry.crc32)}`);
    }
    return data;
  }
}

/**
 * Refuses a path where a zip is read from a source: what only the root entry
 * reads, on the machine the file lies on.
 *
 * @param zip - The zip, as a caller gave it
 * @param doing - What reads it, which the refusal begins with
 * @returns The source
 * @throws {TypeError} When the zip is a path.
 * @internal
 */
export function zipSourceOf(zip: ZipSource | string, doing: string): ZipSource {
  if (typeof zip === 'string') {
    throw new TypeError(`${doing}: the zip is the file ${zip}, which is read on the machine it lies on: ` +
      `${doing} it through the root entry of @elaraai/e3-core`);
  }
  return zip;
}

/**
 * Opens a zip for reading, from a source read by ranges. It stays open once
 * its entries have been iterated, so they can be read after; its caller closes
 * it.
 *
 * @remarks
 * Reads the zip's end records, and only its directory's place: the directory
 * is read as its entries are iterated, and an entry's bytes when they are
 * asked for. A failed read of the source is raised as a {@link ZipSourceError},
 * whose cause is the source's own failure, here and in every read of the
 * directory and the entries; any other failure is the zip's own.
 *
 * A zip on this machine is opened from its path by the root entry's
 * `openZip`.
 *
 * @param zip - The zip's source
 * @param options - Told once the zip is closed, as an owner that opened the
 *   source for it, to release it, wants to be
 * @returns The zip, open
 * @throws {ZipSourceError} When the zip's source fails a read.
 * @throws {TypeError} When the zip is a path, which only the root entry reads.
 * @throws {Error} When the zip's end records do not read: it is not a zip, or
 *   it is cut short, or its directory does not lie where they say.
 */
export async function openZip(zip: ZipSource, options: { onClose?: () => void } = {}): Promise<ZipReader> {
  const reader = new BlockReader(zipSourceOf(zip, 'open'));
  return new OpenZip(reader, await readDirectory(reader), options.onClose);
}

/**
 * The entries of an open zip, in its directory's order, each read when its
 * bytes are asked for.
 *
 * @param zipfile - The zip, as {@link openZip} opened it
 * @returns The entries
 * @throws {ZipSourceError} When the zip's source fails a read.
 * @throws {Error} When the zip's directory does not read.
 */
export function iterateZipEntries(zipfile: ZipReader): AsyncGenerator<ZipEntry> {
  return zipfile.entries();
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

/** The first day a zip's date can name, 1980-01-01, at 00:00:00: every entry's
 *  time, so the same entries make the same bytes. */
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;
/** Made by zip 4.5, on UNIX: the version zip64 needs. */
const MADE_BY = (3 << 8) | 45;
/** A regular file, readable by all and writable by its owner. */
const REGULAR_FILE = (0o100644 << 16) >>> 0;
/** How many bytes of the directory are written at a time, rather than an
 *  entry's at a time. */
const DIRECTORY_CHUNK = 64 * 1024;

/** Encodes an entry's name. */
const UTF8_NAME = new TextEncoder();

/**
 * Refuses what is not a stream where a zip is written to one: a path, or a
 * Node stream, which only the root entry writes to.
 *
 * @param destination - Where the zip is to go, as a caller gave it
 * @param doing - What writes it, which the refusal begins with
 * @returns The stream
 * @throws {TypeError} When the destination is no `WritableStream`.
 * @internal
 */
export function zipSinkOf(destination: unknown, doing: string): WritableStream<Uint8Array> {
  if (typeof (destination as { getWriter?: unknown } | null | undefined)?.getWriter === 'function') {
    return destination as WritableStream<Uint8Array>;
  }
  const given = typeof destination === 'string' ? `the file ${destination}` : 'what it was given';
  throw new TypeError(`${doing}: a zip is written to a WritableStream here, and ${given} is none: ` +
    'a file or a Node stream is written to through the root entry of @elaraai/e3-core');
}

/**
 * Writes a zip to a stream an entry at a time, each stored as it stands, with
 * its directory last.
 *
 * @remarks
 * The writer holds nothing of an entry once it is written but its record, and
 * waits for each chunk to be written, so a zip of any size is written in the
 * memory of its largest entry. It takes the stream's lock only while it writes
 * a chunk, so between entries the stream is its owner's: the owner closes it
 * once the zip is finished, or leaves it, open, for a writer that goes on.
 * Given where another writer's zip had got to, it goes on from there: the
 * stream holds that zip's bytes, and gets the rest.
 */
export class ZipWriter {
  private readonly records: ZipRecord[];
  private readonly names: Set<string>;
  private written: number;
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
    private readonly sink: WritableStream<Uint8Array>,
    from?: ZipWritten,
    limits: { zip64At?: number; zip64Entries?: number } = {},
  ) {
    this.records = [...(from?.entries ?? [])];
    this.names = new Set(this.records.map((record) => record.name));
    this.written = from?.bytes ?? 0;
    this.zip64At = limits.zip64At ?? ZIP32_FULL;
    this.zip64Entries = limits.zip64Entries ?? ZIP16_FULL;
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
    const nameBytes = UTF8_NAME.encode(name);
    const size = data.byteLength;
    const zip64 = size >= this.zip64At;
    const header = new Uint8Array(LOCAL_HEADER_SIZE + nameBytes.length + (zip64 ? 20 : 0));
    const at = view(header);
    const crc = crc32(data);
    at.setUint32(0, LOCAL_HEADER, true);
    at.setUint16(4, zip64 ? 45 : 20, true);
    at.setUint16(6, FLAG_UTF8, true);
    at.setUint16(8, STORED, true);
    at.setUint16(10, DOS_TIME, true);
    at.setUint16(12, DOS_DATE, true);
    at.setUint32(14, crc, true);
    at.setUint32(18, zip64 ? ZIP32_FULL : size, true);
    at.setUint32(22, zip64 ? ZIP32_FULL : size, true);
    at.setUint16(26, nameBytes.length, true);
    at.setUint16(28, zip64 ? 20 : 0, true);
    header.set(nameBytes, LOCAL_HEADER_SIZE);
    if (zip64) {
      const extra = LOCAL_HEADER_SIZE + nameBytes.length;
      at.setUint16(extra, ZIP64_EXTRA, true);
      at.setUint16(extra + 2, 16, true);
      at.setBigUint64(extra + 4, BigInt(size), true);
      at.setBigUint64(extra + 12, BigInt(size), true);
    }
    const offset = this.written;
    await this.write(header);
    await this.write(data);
    this.records.push({ name, crc32: crc, size, offset });
    this.names.add(name);
  }

  /**
   * Writes the zip's directory, and zip64's end records when the zip needs
   * them; the stream is left for its owner to close.
   *
   * @returns The zip's size in bytes
   * @throws {Error} When the stream failed.
   */
  async finish(): Promise<number> {
    const start = this.written;
    let chunk: Uint8Array[] = [];
    let chunkBytes = 0;
    for (const record of this.records) {
      const header = this.centralHeader(record);
      chunk.push(header);
      chunkBytes += header.byteLength;
      if (chunkBytes >= DIRECTORY_CHUNK) {
        await this.write(joined(chunk, chunkBytes));
        chunk = [];
        chunkBytes = 0;
      }
    }
    if (chunkBytes > 0) await this.write(joined(chunk, chunkBytes));
    const size = this.written - start;
    const count = this.records.length;
    const entries16 = count >= this.zip64Entries ? ZIP16_FULL : count;
    const size32 = size >= this.zip64At ? ZIP32_FULL : size;
    const start32 = start >= this.zip64At ? ZIP32_FULL : start;
    if (entries16 === ZIP16_FULL || size32 === ZIP32_FULL || start32 === ZIP32_FULL) {
      const records = new Uint8Array(ZIP64_END_RECORD_SIZE + ZIP64_LOCATOR_SIZE);
      const record = view(records);
      const recordAt = this.written;
      record.setUint32(0, ZIP64_END_RECORD, true);
      record.setBigUint64(4, 44n, true);
      record.setUint16(12, MADE_BY, true);
      record.setUint16(14, 45, true);
      record.setUint32(16, 0, true);
      record.setUint32(20, 0, true);
      record.setBigUint64(24, BigInt(count), true);
      record.setBigUint64(32, BigInt(count), true);
      record.setBigUint64(40, BigInt(size), true);
      record.setBigUint64(48, BigInt(start), true);
      const locator = ZIP64_END_RECORD_SIZE;
      record.setUint32(locator, ZIP64_LOCATOR, true);
      record.setUint32(locator + 4, 0, true);
      record.setBigUint64(locator + 8, BigInt(recordAt), true);
      record.setUint32(locator + 16, 1, true);
      await this.write(records);
    }
    const end = new Uint8Array(END_RECORD_SIZE);
    const at = view(end);
    at.setUint32(0, END_RECORD, true);
    at.setUint16(4, 0, true);
    at.setUint16(6, 0, true);
    at.setUint16(8, entries16, true);
    at.setUint16(10, entries16, true);
    at.setUint32(12, size32, true);
    at.setUint32(16, start32, true);
    at.setUint16(20, 0, true);
    await this.write(end);
    return this.written;
  }

  /** An entry's header in the zip's directory, with zip64's field for a size
   *  or offset too large for its own. */
  private centralHeader(record: ZipRecord): Uint8Array {
    const nameBytes = UTF8_NAME.encode(record.name);
    const largeSize = record.size >= this.zip64At;
    const largeOffset = record.offset >= this.zip64At;
    const extra = (largeSize ? 16 : 0) + (largeOffset ? 8 : 0);
    const header = new Uint8Array(CENTRAL_HEADER_SIZE + nameBytes.length + (extra > 0 ? 4 + extra : 0));
    const at = view(header);
    at.setUint32(0, CENTRAL_HEADER, true);
    at.setUint16(4, MADE_BY, true);
    at.setUint16(6, extra > 0 ? 45 : 20, true);
    at.setUint16(8, FLAG_UTF8, true);
    at.setUint16(10, STORED, true);
    at.setUint16(12, DOS_TIME, true);
    at.setUint16(14, DOS_DATE, true);
    at.setUint32(16, record.crc32, true);
    at.setUint32(20, largeSize ? ZIP32_FULL : record.size, true);
    at.setUint32(24, largeSize ? ZIP32_FULL : record.size, true);
    at.setUint16(28, nameBytes.length, true);
    at.setUint16(30, extra > 0 ? 4 + extra : 0, true);
    at.setUint16(32, 0, true);
    at.setUint16(34, 0, true);
    at.setUint16(36, 0, true);
    at.setUint32(38, REGULAR_FILE, true);
    at.setUint32(42, largeOffset ? ZIP32_FULL : record.offset, true);
    header.set(nameBytes, CENTRAL_HEADER_SIZE);
    if (extra > 0) {
      let field = CENTRAL_HEADER_SIZE + nameBytes.length;
      at.setUint16(field, ZIP64_EXTRA, true);
      at.setUint16(field + 2, extra, true);
      field += 4;
      if (largeSize) {
        at.setBigUint64(field, BigInt(record.size), true);
        at.setBigUint64(field + 8, BigInt(record.size), true);
        field += 16;
      }
      if (largeOffset) at.setBigUint64(field, BigInt(record.offset), true);
    }
    return header;
  }

  /** Writes a chunk, holding the stream's lock until it is written. */
  private async write(chunk: Uint8Array): Promise<void> {
    const writer = this.sink.getWriter();
    try {
      await writer.write(chunk);
    } finally {
      writer.releaseLock();
    }
    this.written += chunk.byteLength;
  }
}

/** Chunks joined, into `bytes` bytes. */
function joined(chunks: readonly Uint8Array[], bytes: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(bytes);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}
