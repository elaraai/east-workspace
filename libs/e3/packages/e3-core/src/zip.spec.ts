/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Zips written a stream an entry at a time, and read where they lie: by a
 * file, or by ranges of bytes held elsewhere.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { createTempDir, removeTempDir } from './test-helpers.js';
import { ZipSourceError, ZipWriter, iterateZipEntries, openZip, type ZipSource } from './zip.js';

/** A stream that keeps what is written to it. */
class Collector extends Writable {
  readonly chunks: Buffer[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (err?: Error | null) => void): void {
    this.chunks.push(chunk);
    done();
  }

  /** Everything written so far. */
  get bytes(): Buffer {
    return Buffer.concat(this.chunks);
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
async function entriesOf(zip: string | ZipSource): Promise<Array<[string, Buffer]>> {
  const zipfile = await openZip(zip);
  try {
    const entries: Array<[string, Buffer]> = [];
    for await (const entry of iterateZipEntries(zipfile)) entries.push([entry.fileName, await entry.getData()]);
    return entries;
  } finally {
    zipfile.close();
  }
}

/** Entries of every size, from none to more than a read-ahead block. */
const ENTRIES: Array<[string, Buffer]> = [
  ['release.beast2', Buffer.from('release')],
  ['objects/00/empty.beast2', Buffer.alloc(0)],
  ['objects/ab/small.beast2', Buffer.from('a small object')],
  ['objects/cd/large.beast2', Buffer.alloc(3 * 1024 * 1024 + 17, 7)],
  ['packages/p/1.0.0-ünïcode.beast2', Buffer.from('the package ref')],
];

describe('zips', () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(dir);
  });

  /** A zip of `entries`, written through one writer. */
  async function written(entries: Array<[string, Buffer]>, limits?: { zip64At?: number; zip64Entries?: number }): Promise<Buffer> {
    const sink = new Collector();
    const zip = new ZipWriter(sink, undefined, limits);
    for (const [name, data] of entries) await zip.add(name, data);
    const size = await zip.finish();
    assert.equal(size, sink.bytes.byteLength, 'the writer counts every byte it wrote');
    return sink.bytes;
  }

  it('writes a zip an entry at a time that reads back, from a file and from ranges of its bytes', async () => {
    const bytes = await written(ENTRIES);
    const file = join(dir, 'written.zip');
    writeFileSync(file, bytes);
    assert.deepEqual(await entriesOf(file), ENTRIES);
    assert.deepEqual(await entriesOf(sourceOf(bytes)), ENTRIES);
    assert.deepEqual(await written(ENTRIES), bytes, 'the same entries make the same bytes');
  });

  it('holds a size, an offset or a count too large for its field in zip64, which reads back', async () => {
    // Every size and offset from 16 bytes, and every count from 3 entries, as
    // one past 4 GiB or 65,534 entries would be.
    const bytes = await written(ENTRIES, { zip64At: 16, zip64Entries: 3 });
    assert.notDeepEqual(bytes, await written(ENTRIES), 'the zip is written with zip64 records');
    assert.ok(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])), 'with a zip64 end record');
    assert.deepEqual(await entriesOf(sourceOf(bytes)), ENTRIES);
  });

  it('goes on from where another writer had got to, writing the zip one never stopped writes', async () => {
    const whole = await written(ENTRIES);
    const first = new Collector();
    const begun = new ZipWriter(first);
    for (const [name, data] of ENTRIES.slice(0, 3)) await begun.add(name, data);
    const sink = new Collector();
    sink.write(first.bytes);
    const resumed = new ZipWriter(sink, begun.progress);
    assert.ok(resumed.has(ENTRIES[2]![0]) && !resumed.has(ENTRIES[3]![0]), 'it holds the entries the first wrote');
    for (const [name, data] of ENTRIES.slice(3)) await resumed.add(name, data);
    await resumed.finish();
    assert.deepEqual(sink.bytes, whole);
    await assert.rejects(resumed.add(ENTRIES[0]![0], ENTRIES[0]![1]), /holds an entry named release\.beast2 already/);
  });

  it('reads a zip by ranges a block at a time, not a request per entry', async () => {
    const many: Array<[string, Buffer]> = Array.from({ length: 500 }, (_, i) => [`objects/${String(i).padStart(4, '0')}.beast2`, Buffer.from(`object ${i}`)]);
    const bytes = await written(many);
    const reads: Array<readonly [number, number]> = [];
    assert.deepEqual(await entriesOf(sourceOf(bytes, reads)), many);
    assert.ok(reads.length <= 2, `${many.length} entries in ${bytes.byteLength} bytes were read in ${reads.length} ranges`);
  });

  it('refuses a zip whose directory names bytes past its end, read by ranges as from a file', async () => {
    const bytes = Buffer.from(await written(ENTRIES));
    // The first entry's local header, as the directory names it, moved to ten
    // bytes before the zip's end.
    const directory = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(bytes.byteLength - 10, directory + 42);
    const file = join(dir, 'past-its-end.zip');
    writeFileSync(file, bytes);
    await assert.rejects(entriesOf(file), /unexpected EOF/);
    await assert.rejects(entriesOf(sourceOf(bytes)), new RegExp(`the zip names its bytes \\d+ to \\d+, and it ends at ${bytes.byteLength}`));
  });

  it('raises a read its source fails as a ZipSourceError, whose cause is the source\'s own failure', async () => {
    const bytes = await written(ENTRIES);
    const throttled = Object.assign(new Error('Please reduce your request rate.'), { name: 'SlowDown' });
    const failing: ZipSource = { size: bytes.byteLength, read: () => Promise.reject(throttled) };
    await assert.rejects(entriesOf(failing), (err: unknown) => err instanceof ZipSourceError && err.cause === throttled);
  });

  it('reads entries side by side from the blocks they fall in, each block once', async () => {
    const many: Array<[string, Buffer]> = Array.from({ length: 2_000 }, (_, i) => [`objects/${String(i).padStart(4, '0')}.beast2`, Buffer.alloc(2_000, i % 251)]);
    const bytes = await written(many);
    assert.ok(bytes.byteLength > 3 * 1024 * 1024, 'the zip spans blocks');
    const reads: Array<readonly [number, number]> = [];
    const zipfile = await openZip(sourceOf(bytes, reads));
    try {
      const entries: Array<{ fileName: string; getData(): Promise<Buffer> }> = [];
      for await (const entry of iterateZipEntries(zipfile)) entries.push(entry);
      const read = await Promise.all(entries.map(async (entry): Promise<[string, Buffer]> => [entry.fileName, await entry.getData()]));
      assert.deepEqual(read, many);
    } finally {
      zipfile.close();
    }
    const blocks = Math.ceil(bytes.byteLength / (1024 * 1024));
    assert.ok(reads.length <= blocks + 2, `${blocks} blocks were read in ${reads.length} ranges`);
  });
});
