/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Zips written to a stream an entry at a time, and read where they lie: by
 * ranges of bytes held elsewhere, or a file on this machine. The zips e3
 * writes, and those other writers write — deflated, with data descriptors,
 * comments and zip64 records — read back; a damaged entry, a zip cut short
 * and a directory that does not read are refused.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';
import { openZip as openZipHere } from './package-files.js';
import { createTempDir, removeTempDir } from './test-helpers.js';
import { ZipSourceError, ZipWriter, iterateZipEntries, openZip, type ZipEntry, type ZipSource } from './zip.js';

/** Bytes joined. */
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** A string's UTF-8 bytes. */
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Bytes as a Buffer over their own range of their buffer. */
const bufferOf = (bytes: Uint8Array): Buffer => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * Holds bytes to the bytes expected. A failure names the sizes and the first
 * byte that differs: a whole-value comparison of megabytes that failed would
 * diff every byte of both, and run out of memory before it said anything.
 */
function sameBytes(actual: Uint8Array, expected: Uint8Array, what: string): void {
  const [a, b] = [bufferOf(actual), bufferOf(expected)];
  if (a.equals(b)) return;
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  assert.fail(`${what}: ${a.length} bytes, where ${b.length} were expected, the first that differs at ${at}`);
}

/** Holds a zip's entries to those expected: their names, in order, and each
 *  one's bytes. */
function sameEntries(actual: ReadonlyArray<readonly [string, Uint8Array]>, expected: ReadonlyArray<readonly [string, Uint8Array]>, what: string): void {
  assert.deepEqual(actual.map(([name]) => name), expected.map(([name]) => name), `${what}: the entries, in order`);
  actual.forEach(([name, bytes], i) => sameBytes(bytes, expected[i]![1], `${what}: ${name}`));
}

/** Where `pattern` is first in `bytes`, or -1. */
function find(bytes: Uint8Array, pattern: readonly number[], from = 0): number {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(Buffer.from(pattern), from);
}

/** The signatures of a zip's records, as bytes. */
const SIG = {
  local: [0x50, 0x4b, 0x03, 0x04],
  central: [0x50, 0x4b, 0x01, 0x02],
  end: [0x50, 0x4b, 0x05, 0x06],
  zip64End: [0x50, 0x4b, 0x06, 0x06],
  zip64Locator: [0x50, 0x4b, 0x06, 0x07],
} as const;

/** A stream that keeps what is written to it, and how many writes it took. */
class Collector {
  readonly chunks: Uint8Array[] = [];
  readonly stream = new WritableStream<Uint8Array>({
    write: (chunk) => {
      this.chunks.push(chunk.slice());
    },
  });

  /** Everything written so far. */
  get bytes(): Uint8Array {
    return concat(this.chunks);
  }
}

/** Bytes read by ranges, each range read recorded. */
function sourceOf(bytes: Uint8Array, reads: Array<readonly [number, number]> = []): ZipSource {
  return {
    size: bytes.byteLength,
    read: async (offset, length) => {
      reads.push([offset, offset + length]);
      return bytes.subarray(offset, offset + length);
    },
  };
}

/** Every entry of a zip, by name, in its directory's order. */
async function entriesOf(zip: string | ZipSource): Promise<Array<[string, Uint8Array]>> {
  const zipfile = await openZipHere(zip);
  try {
    const entries: Array<[string, Uint8Array]> = [];
    for await (const entry of iterateZipEntries(zipfile)) entries.push([entry.fileName, await entry.getData()]);
    return entries;
  } finally {
    zipfile.close();
  }
}

/** Entries of every size, from none to more than a read-ahead block. */
const ENTRIES: Array<[string, Uint8Array]> = [
  ['release.beast2', text('release')],
  ['objects/00/empty.beast2', new Uint8Array(0)],
  ['objects/ab/small.beast2', text('a small object')],
  ['objects/cd/large.beast2', new Uint8Array(3 * 1024 * 1024 + 17).fill(7)],
  ['packages/p/1.0.0-ünïcode.beast2', text('the package ref')],
];

/** An entry as another writer writes it. */
interface ForeignEntry {
  /** Its name, as the directory holds it: UTF-8, flagged so, by default. */
  readonly name: string | Uint8Array;
  readonly data: Uint8Array;
  /** Deflate its bytes. */
  readonly deflate?: boolean;
  /** Its CRC-32 and sizes in a data descriptor after its bytes, with none in
   *  its local header, as a writer streaming it writes them. */
  readonly descriptor?: boolean;
  /** Its general purpose flags, the UTF-8 flag's among them. */
  readonly flags?: number;
  /** Its compression method, when it is not stored or deflated as asked. */
  readonly method?: number;
  /** Its extra fields in the directory, beside a zip64 field. */
  readonly extra?: Uint8Array;
  /** Bytes it holds beside its own, as an encrypted entry's header is. */
  readonly prefix?: Uint8Array;
}

/**
 * A zip as other writers write one: yazl, which the SDK's `e3.export` runs,
 * deflates every entry, and a writer that streams an entry puts its CRC-32 and
 * sizes in a data descriptor; a zip may end with a comment, and zip64's
 * records may be there for a zip of any size. The CRC-32s are zlib's.
 */
function foreignZip(entries: readonly ForeignEntry[], options: { comment?: string; zip64?: boolean } = {}): Uint8Array {
  const out: Uint8Array[] = [];
  let at = 0;
  const put = (bytes: Uint8Array): void => {
    out.push(bytes);
    at += bytes.byteLength;
  };
  const records: Array<{ entry: ForeignEntry; name: Uint8Array; crc: number; compressed: number; size: number; offset: number; flags: number; method: number }> = [];
  for (const entry of entries) {
    const name = typeof entry.name === 'string' ? text(entry.name) : entry.name;
    const stored = entry.deflate === true ? deflateRawSync(entry.data) : entry.data;
    const held = concat([entry.prefix ?? new Uint8Array(0), stored]);
    const flags = (entry.flags ?? (typeof entry.name === 'string' ? 0x0800 : 0)) | (entry.descriptor === true ? 0x0008 : 0);
    const method = entry.method ?? (entry.deflate === true ? 8 : 0);
    const crc = zlibCrc32(entry.data);
    const local = new Uint8Array(30 + name.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0x6000, true);
    lv.setUint16(12, 0x5021, true);
    if (entry.descriptor !== true) {
      lv.setUint32(14, crc, true);
      lv.setUint32(18, held.byteLength, true);
      lv.setUint32(22, entry.data.byteLength, true);
    }
    lv.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    records.push({ entry, name, crc, compressed: held.byteLength, size: entry.data.byteLength, offset: at, flags, method });
    put(local);
    put(held);
    if (entry.descriptor === true) {
      const descriptor = new Uint8Array(16);
      const dv = new DataView(descriptor.buffer);
      dv.setUint32(0, 0x08074b50, true);
      dv.setUint32(4, crc, true);
      dv.setUint32(8, held.byteLength, true);
      dv.setUint32(12, entry.data.byteLength, true);
      put(descriptor);
    }
  }
  const directoryAt = at;
  for (const { entry, name, crc, compressed, size, offset, flags, method } of records) {
    // yazl's zip64 field holds all three, whatever their size.
    const zip64 = options.zip64 === true ? new Uint8Array(28) : new Uint8Array(0);
    if (options.zip64 === true) {
      const zv = new DataView(zip64.buffer);
      zv.setUint16(0, 0x0001, true);
      zv.setUint16(2, 24, true);
      zv.setBigUint64(4, BigInt(size), true);
      zv.setBigUint64(12, BigInt(compressed), true);
      zv.setBigUint64(20, BigInt(offset), true);
    }
    const extra = concat([zip64, entry.extra ?? new Uint8Array(0)]);
    const header = new Uint8Array(46 + name.byteLength + extra.byteLength);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x02014b50, true);
    hv.setUint16(4, (3 << 8) | 63, true);
    hv.setUint16(6, options.zip64 === true ? 45 : 20, true);
    hv.setUint16(8, flags, true);
    hv.setUint16(10, method, true);
    hv.setUint32(16, crc, true);
    hv.setUint32(20, options.zip64 === true ? 0xffffffff : compressed, true);
    hv.setUint32(24, options.zip64 === true ? 0xffffffff : size, true);
    hv.setUint16(28, name.byteLength, true);
    hv.setUint16(30, extra.byteLength, true);
    hv.setUint32(38, (0o100664 << 16) >>> 0, true);
    hv.setUint32(42, options.zip64 === true ? 0xffffffff : offset, true);
    header.set(name, 46);
    header.set(extra, 46 + name.byteLength);
    put(header);
  }
  const directorySize = at - directoryAt;
  if (options.zip64 === true) {
    const recordAt = at;
    const record = new Uint8Array(56 + 20);
    const rv = new DataView(record.buffer);
    rv.setUint32(0, 0x06064b50, true);
    rv.setBigUint64(4, 44n, true);
    rv.setUint16(12, (3 << 8) | 63, true);
    rv.setUint16(14, 45, true);
    rv.setBigUint64(24, BigInt(records.length), true);
    rv.setBigUint64(32, BigInt(records.length), true);
    rv.setBigUint64(40, BigInt(directorySize), true);
    rv.setBigUint64(48, BigInt(directoryAt), true);
    rv.setUint32(56, 0x07064b50, true);
    rv.setBigUint64(56 + 8, BigInt(recordAt), true);
    rv.setUint32(56 + 16, 1, true);
    put(record);
  }
  const comment = text(options.comment ?? '');
  const end = new Uint8Array(22 + comment.byteLength);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, options.zip64 === true ? 0xffff : records.length, true);
  ev.setUint16(10, options.zip64 === true ? 0xffff : records.length, true);
  ev.setUint32(12, options.zip64 === true ? 0xffffffff : directorySize, true);
  ev.setUint32(16, options.zip64 === true ? 0xffffffff : directoryAt, true);
  ev.setUint16(20, comment.byteLength, true);
  end.set(comment, 22);
  put(end);
  return concat(out);
}

/** The entry `name` of a zip read by ranges, read. */
async function readEntry(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const zipfile = await openZip(sourceOf(bytes));
  try {
    for await (const entry of zipfile.entries()) {
      if (entry.fileName === name) return await entry.getData();
    }
    return assert.fail(`the zip has no entry ${name}`);
  } finally {
    zipfile.close();
  }
}

describe('zips', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  /** A zip of `entries`, written through one writer. */
  async function written(entries: Array<[string, Uint8Array]>, limits?: { zip64At?: number; zip64Entries?: number }): Promise<Uint8Array> {
    const sink = new Collector();
    const zip = new ZipWriter(sink.stream, undefined, limits);
    for (const [name, data] of entries) await zip.add(name, data);
    const size = await zip.finish();
    assert.equal(size, sink.bytes.byteLength, 'the writer counts every byte it wrote');
    return sink.bytes;
  }

  it('writes a zip an entry at a time that reads back, from a file and from ranges of its bytes', async () => {
    const bytes = await written(ENTRIES);
    const file = join(dir, 'written.zip');
    writeFileSync(file, bytes);
    sameEntries(await entriesOf(file), ENTRIES, 'from a file');
    sameEntries(await entriesOf(sourceOf(bytes)), ENTRIES, 'by ranges');
    sameBytes(await written(ENTRIES), bytes, 'the same entries make the same bytes');
  });

  it('holds a size, an offset or a count too large for its field in zip64, which reads back', async () => {
    // Every size and offset from 16 bytes, and every count from 3 entries, as
    // one past 4 GiB or 65,534 entries would be.
    const bytes = await written(ENTRIES, { zip64At: 16, zip64Entries: 3 });
    assert.ok(!bufferOf(bytes).equals(bufferOf(await written(ENTRIES))), 'the zip is written with zip64 records');
    assert.ok(find(bytes, SIG.zip64End) !== -1, 'with a zip64 end record');
    assert.ok(find(bytes, SIG.zip64Locator) !== -1, 'and its locator');
    // The large entry's local header and directory entry hold their sizes in
    // zip64's field, and its directory entry its offset too.
    const large = find(bytes, [...text('objects/cd/large.beast2')]);
    assert.deepEqual([...bytes.subarray(large - 12, large - 4)], [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 'its sizes are zip64\'s');
    const end = new DataView(bytes.buffer, bytes.byteOffset + bytes.byteLength - 22);
    assert.deepEqual([end.getUint16(10, true), end.getUint32(12, true), end.getUint32(16, true)], [0xffff, 0xffffffff, 0xffffffff]);
    sameEntries(await entriesOf(sourceOf(bytes)), ENTRIES, 'by ranges');
  });

  it('goes on from where another writer had got to, writing the zip one never stopped writes', async () => {
    const whole = await written(ENTRIES);
    const first = new Collector();
    const begun = new ZipWriter(first.stream);
    for (const [name, data] of ENTRIES.slice(0, 3)) await begun.add(name, data);
    const sink = new Collector();
    sink.chunks.push(first.bytes);
    const resumed = new ZipWriter(sink.stream, begun.progress);
    assert.ok(resumed.has(ENTRIES[2]![0]) && !resumed.has(ENTRIES[3]![0]), 'it holds the entries the first wrote');
    for (const [name, data] of ENTRIES.slice(3)) await resumed.add(name, data);
    await resumed.finish();
    sameBytes(sink.bytes, whole, 'the zip one writer writes');
    await assert.rejects(resumed.add(ENTRIES[0]![0], ENTRIES[0]![1]), /holds an entry named release\.beast2 already/);
  });

  it('writes a chunk the stream has taken before it goes on, so where it has got to is what the stream holds; takes the stream only while it writes; and fails as the stream fails', async () => {
    // A stream that takes its time over each chunk
    const chunks: Uint8Array[] = [];
    let taken = 0;
    const slow = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        chunks.push(chunk.slice());
        taken += chunk.byteLength;
      },
    });
    const zip = new ZipWriter(slow);
    for (const [name, data] of ENTRIES) {
      await zip.add(name, data);
      // An export stopped here hands over a checkpoint counting these bytes,
      // so the stream must hold them all.
      assert.equal(taken, zip.progress.bytes, `the stream has taken the zip so far once ${name} is added`);
      assert.equal(slow.locked, false, 'the stream is its owner\'s between entries');
    }
    const size = await zip.finish();
    assert.equal(taken, size, 'and the whole zip once it is finished');
    sameBytes(concat(chunks), await written(ENTRIES), 'the zip one writer writes');
    await slow.close();

    // A stream that fails a write: the entry, and every one after, fails as
    // it did.
    const full = Object.assign(new Error('no space left on the device'), { code: 'ENOSPC' });
    let writes = 0;
    const failing = new WritableStream<Uint8Array>({
      write: () => {
        if (++writes === 3) throw full;
      },
    });
    const broken = new ZipWriter(failing);
    await broken.add('first', text('one'));
    await assert.rejects(broken.add('second', text('two')), (err: unknown) => err === full);
    await assert.rejects(broken.add('third', text('three')), (err: unknown) => err === full);
  });

  it('reads a zip by ranges a block at a time, not a request per entry', async () => {
    const many: Array<[string, Uint8Array]> = Array.from({ length: 500 }, (_, i) => [`objects/${String(i).padStart(4, '0')}.beast2`, text(`object ${i}`)]);
    const bytes = await written(many);
    const reads: Array<readonly [number, number]> = [];
    sameEntries(await entriesOf(sourceOf(bytes, reads)), many, 'by ranges');
    assert.ok(reads.length <= 2, `${many.length} entries in ${bytes.byteLength} bytes were read in ${reads.length} ranges`);
  });

  it('refuses a zip whose directory names bytes past its end, from a file as by ranges', async () => {
    const bytes = await written(ENTRIES);
    // The first entry's local header, as the directory names it, moved to ten
    // bytes before the zip's end.
    const directory = find(bytes, SIG.central);
    new DataView(bytes.buffer, bytes.byteOffset).setUint32(directory + 42, bytes.byteLength - 10, true);
    const file = join(dir, 'past-its-end.zip');
    writeFileSync(file, bytes);
    const pastItsEnd = new RegExp(`^Error: the zip names its bytes ${bytes.byteLength - 10} to ${bytes.byteLength + 20}, and it ends at ${bytes.byteLength}$`);
    await assert.rejects(entriesOf(file), pastItsEnd);
    await assert.rejects(entriesOf(sourceOf(bytes)), pastItsEnd);
  });

  it('raises a read its source fails as a ZipSourceError, whose cause is the source\'s own failure', async () => {
    const bytes = await written(ENTRIES);
    const throttled = Object.assign(new Error('Please reduce your request rate.'), { name: 'SlowDown' });
    const failing: ZipSource = { size: bytes.byteLength, read: () => Promise.reject(throttled) };
    await assert.rejects(entriesOf(failing), (err: unknown) => err instanceof ZipSourceError && err.cause === throttled);

    // A source that gives other than the bytes asked for fails the read too.
    const short: ZipSource = { size: bytes.byteLength, read: async (offset, length) => bytes.subarray(offset, offset + length - 1) };
    await assert.rejects(entriesOf(short), (err: unknown) => err instanceof ZipSourceError && /^it gave \d+ bytes for the \d+ at \d+/.test((err.cause as Error).message));
  });

  it('reads entries side by side from the blocks they fall in, each block once', async () => {
    const many: Array<[string, Uint8Array]> = Array.from({ length: 2_000 }, (_, i) => [`objects/${String(i).padStart(4, '0')}.beast2`, new Uint8Array(2_000).fill(i % 251)]);
    const bytes = await written(many);
    assert.ok(bytes.byteLength > 3 * 1024 * 1024, 'the zip spans blocks');
    const reads: Array<readonly [number, number]> = [];
    const zipfile = await openZip(sourceOf(bytes, reads));
    try {
      const entries: ZipEntry[] = [];
      for await (const entry of iterateZipEntries(zipfile)) entries.push(entry);
      const read = await Promise.all(entries.map(async (entry): Promise<[string, Uint8Array]> => [entry.fileName, await entry.getData()]));
      sameEntries(read, many, 'read side by side');
    } finally {
      zipfile.close();
    }
    const blocks = Math.ceil(bytes.byteLength / (1024 * 1024));
    assert.ok(reads.length <= blocks + 2, `${blocks} blocks were read in ${reads.length} ranges`);
  });

  it('reads the zips other writers write: deflated entries, data descriptors, a comment and zip64 records', async () => {
    const entries: Array<[string, Uint8Array]> = [
      ['release.beast2', text('release')],
      ['objects/00/empty.beast2', new Uint8Array(0)],
      ['objects/ab/words.beast2', text('the same few words, again and again; '.repeat(500))],
      ['objects/cd/noise.beast2', new Uint8Array(2 * 1024 * 1024 + 3).map((_, i) => (i * 2654435761) >>> 24)],
    ];
    const kinds: Array<[string, Uint8Array]> = [
      ['deflated, as yazl writes for e3.export', foreignZip(entries.map(([name, data]) => ({ name, data, deflate: true })))],
      ['deflated with data descriptors, as a writer streaming them writes', foreignZip(entries.map(([name, data]) => ({ name, data, deflate: true, descriptor: true })))],
      ['stored with data descriptors', foreignZip(entries.map(([name, data]) => ({ name, data, descriptor: true })))],
      ['deflated, with a comment', foreignZip(entries.map(([name, data]) => ({ name, data, deflate: true })), { comment: 'written elsewhere' })],
      ['deflated, its every field in zip64\'s records', foreignZip(entries.map(([name, data]) => ({ name, data, deflate: true })), { zip64: true })],
    ];
    for (const [kind, bytes] of kinds) {
      sameEntries(await entriesOf(sourceOf(bytes)), entries, kind);
      const file = join(dir, 'foreign.zip');
      writeFileSync(file, bytes);
      sameEntries(await entriesOf(file), entries, `${kind}, from a file`);
    }
  });

  it('names an entry as the format has it: UTF-8 when flagged, Info-ZIP\'s UTF-8 name when it stands for the name, code page 437 otherwise', async () => {
    // "naïve.txt" in code page 437, whose 0x8b is ï: no UTF-8 reads it so.
    const cp437 = new Uint8Array([0x6e, 0x61, 0x8b, 0x76, 0x65, 0x2e, 0x74, 0x78, 0x74]);
    const plain = text('name.txt');
    // Info-ZIP's field: version 1, the CRC-32 of the name it stands for, and
    // the name in UTF-8.
    const unicode = (name: string, crc: number): Uint8Array => {
      const utf8 = text(name);
      const field = new Uint8Array(4 + 5 + utf8.byteLength);
      const fv = new DataView(field.buffer);
      fv.setUint16(0, 0x7075, true);
      fv.setUint16(2, 5 + utf8.byteLength, true);
      field[4] = 1;
      fv.setUint32(5, crc, true);
      field.set(utf8, 9);
      return field;
    };
    const bytes = foreignZip([
      { name: 'naïve.txt', data: text('flagged UTF-8') },
      { name: cp437, data: text('code page 437') },
      { name: plain, data: text('Info-ZIP\'s name'), extra: unicode('ünïcode.txt', zlibCrc32(plain)) },
      { name: plain, data: text('a stale Info-ZIP name'), extra: unicode('stale.txt', zlibCrc32(plain) ^ 1) },
      { name: 'windows\\style\\path.txt', data: text('backslashes') },
    ]);
    const names = (await entriesOf(sourceOf(bytes))).map(([name]) => name);
    assert.deepEqual(names, ['naïve.txt', 'naïve.txt', 'ünïcode.txt', 'name.txt', 'windows/style/path.txt']);

    for (const [name, refusal] of [
      ['/etc/passwd', /^Error: the zip's entry \/etc\/passwd is a path from the root/],
      ['C:/Windows/win.ini', /^Error: the zip's entry C:\/Windows\/win\.ini is a path from the root/],
      ['objects/../../escape', /^Error: the zip's entry objects\/\.\.\/\.\.\/escape names a path out of the zip$/],
    ] as const) {
      await assert.rejects(entriesOf(sourceOf(foreignZip([{ name, data: text('x') }]))), refusal, name);
    }
  });

  it('refuses an entry whose bytes are not those its CRC-32 names, stored or deflated', async () => {
    const data = text('the bytes the directory names by their CRC-32, a dozen times over. '.repeat(12));
    const crc = zlibCrc32(data).toString(16).padStart(8, '0');

    // A stored entry's byte changed: its CRC-32 no longer names its bytes.
    const stored = await written([['object.beast2', data]]);
    const at = find(stored, [...text('object.beast2')]) + 'object.beast2'.length;
    stored[at + 100] = stored[at + 100]! ^ 0x01;
    await assert.rejects(readEntry(stored, 'object.beast2'),
      new RegExp(`^Error: the zip's entry object\\.beast2 is damaged: its bytes' CRC-32 is [0-9a-f]{8}, and the zip names ${crc}$`));

    // A deflated entry's directory names another CRC-32: it inflates, and its
    // bytes are not the ones named.
    const deflated = foreignZip([{ name: 'object.beast2', data, deflate: true }]);
    const directory = find(deflated, SIG.central);
    new DataView(deflated.buffer, deflated.byteOffset).setUint32(directory + 16, zlibCrc32(data) ^ 0x80, true);
    await assert.rejects(readEntry(deflated, 'object.beast2'),
      new RegExp(`^Error: the zip's entry object\\.beast2 is damaged: its bytes' CRC-32 is ${crc}, and the zip names [0-9a-f]{8}$`));

    // A deflated entry's stream damaged: it does not inflate to its size.
    const broken = foreignZip([{ name: 'object.beast2', data, deflate: true }]);
    const stream = find(broken, [...text('object.beast2')]) + 'object.beast2'.length;
    broken.fill(0xff, stream, stream + 8);
    await assert.rejects(readEntry(broken, 'object.beast2'), new RegExp(`^Error: the zip's entry object\\.beast2 does not inflate to its ${data.byteLength} bytes: `));
  });

  it('refuses a zip cut short, wherever it is cut', async () => {
    const bytes = await written(ENTRIES.slice(0, 3));
    for (const cut of [1, 21, 22, 23, 60, Math.floor(bytes.byteLength / 2), bytes.byteLength - 1]) {
      await assert.rejects(openZip(sourceOf(bytes.subarray(0, bytes.byteLength - cut))),
        /^Error: the zip has no end record: it is not a zip, or it is cut short$/, `cut by ${cut} bytes`);
    }
    await assert.rejects(openZip(sourceOf(new Uint8Array(0))), /no end record/);
    await assert.rejects(openZip(sourceOf(text('a text file, not a zip'))), /no end record/);
    // Bytes after the zip: its end record names no comment for them.
    await assert.rejects(openZip(sourceOf(concat([bytes, text('appended')]))),
      /^Error: the zip's end record names a comment of 0 bytes, and 8 follow it/);
  });

  it('refuses a directory that does not read', async () => {
    const bytes = await written(ENTRIES.slice(0, 3));
    const end = bytes.byteLength - 22;
    const directory = find(bytes, SIG.central);
    const damaged = (change: (at: DataView) => void): Uint8Array => {
      const copy = bytes.slice();
      change(new DataView(copy.buffer));
      return copy;
    };
    const entries = async (zip: Uint8Array): Promise<unknown> => entriesOf(sourceOf(zip));
    // Its place named at an entry's bytes rather than its first entry
    await assert.rejects(entries(damaged((at) => at.setUint32(end + 16, 0, true))),
      /^Error: the zip's directory has no entry at 0, where its entry 1 of 3 would be$/);
    // More entries than it holds
    await assert.rejects(entries(damaged((at) => {
      at.setUint16(end + 8, 9, true);
      at.setUint16(end + 10, 9, true);
    })), /^Error: the zip's directory names 9 entries in \d+ bytes, which hold at most \d+$/);
    // Running into the end record
    await assert.rejects(entries(damaged((at) => at.setUint32(end + 12, end - directory + 1, true))),
      new RegExp(`^Error: the zip's directory is ${end - directory + 1} bytes at ${directory}, and its end records start at ${end}$`));
    // An entry's name longer than the directory holds
    await assert.rejects(entries(damaged((at) => at.setUint16(directory + 28, 0xfff0, true))),
      new RegExp(`^Error: the zip's directory ends at ${end}, inside its entry 1 of 3$`));
    // An entry's extra fields that say more than they hold
    const extra = foreignZip([{ name: 'one', data: text('1'), extra: new Uint8Array([0x99, 0x99, 0x10, 0x00, 1, 2]) }]);
    await assert.rejects(entries(extra), /^Error: the zip's entry one has an extra field of 16 bytes at 0, and its extra fields hold 6$/);
    // zip64's field that does not hold what the entry says it does
    const zip64 = foreignZip([{ name: 'one', data: text('1'), extra: new Uint8Array([0x01, 0x00, 0x00, 0x00]) }]);
    new DataView(zip64.buffer).setUint32(find(zip64, SIG.central) + 24, 0xffffffff, true);
    await assert.rejects(entries(zip64), /^Error: the zip's entry one holds its size in zip64's extra field, which does not hold it$/);
    // A stored entry whose sizes disagree
    const sizes = foreignZip([{ name: 'one', data: text('1') }]);
    new DataView(sizes.buffer).setUint32(find(sizes, SIG.central) + 20, 2, true);
    await assert.rejects(entries(sizes), /^Error: the zip's entry one is stored, and the zip holds 2 bytes of its 1$/);
  });

  it('refuses the entries it does not read: encrypted, or compressed by another method than deflate', async () => {
    const bytes = foreignZip([
      { name: 'plain', data: text('plain') },
      { name: 'encrypted', data: text('secret'), flags: 0x0801, prefix: new Uint8Array(12) },
      { name: 'bzip2', data: text('compressed'), method: 12 },
    ]);
    assert.deepEqual(await readEntry(bytes, 'plain'), text('plain'));
    await assert.rejects(readEntry(bytes, 'encrypted'), /^Error: the zip's entry encrypted is encrypted, which e3 does not read$/);
    await assert.rejects(readEntry(bytes, 'bzip2'), /^Error: the zip's entry bzip2 is compressed by method 12, and e3 reads entries stored or deflated$/);
    const strong = foreignZip([{ name: 'strong', data: text('secret'), flags: 0x0841 }]);
    await assert.rejects(entriesOf(sourceOf(strong)), /^Error: the zip's entry strong is strongly encrypted, which e3 does not read$/);
  });

  it('refuses a read of a zip closed, and opens a zip from a source only', async () => {
    const bytes = await written(ENTRIES.slice(0, 3));
    const zipfile = await openZip(sourceOf(bytes));
    const entries: ZipEntry[] = [];
    for await (const entry of zipfile.entries()) entries.push(entry);
    zipfile.close();
    await assert.rejects(entries[0]!.getData(), /^Error: the zip is closed$/);

    const file = join(dir, 'a.zip');
    writeFileSync(file, bytes);
    await assert.rejects(openZip(file as unknown as ZipSource), (err: unknown) => err instanceof TypeError &&
      err.message === `open: the zip is the file ${file}, which is read on the machine it lies on: open it through the root entry of @elaraai/e3-core`);
    const closed = await openZipHere(file);
    const fromFile: ZipEntry[] = [];
    for await (const entry of closed.entries()) fromFile.push(entry);
    closed.close();
    await assert.rejects(fromFile[0]!.getData(), /^Error: the zip is closed$/);
  });
});
