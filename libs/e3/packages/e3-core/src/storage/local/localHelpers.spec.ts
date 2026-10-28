/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the local helpers: the atomic-write primitive, and the path an
 * object is kept at.
 *
 * `atomicWriteFile` is the shared stage-and-rename helper behind every mutable
 * ref/state file (execution status, dataflow runs, workspace state, dataset
 * refs). The contract it guarantees — and the property a bare `fs.writeFile`
 * violates — is that a concurrent reader of a path being overwritten in place
 * never observes a truncated/empty file.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { promises as fsPromises } from 'node:fs';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile, objectPath, readReplacedFile } from './localHelpers.js';
import { createTempDir, removeTempDir } from '../../test-helpers.js';

describe('objectPath', () => {
  it('refuses a hash that is not a SHA-256, so no name a client gives reaches outside the store', () => {
    // A transfer's init names its delivery by hash, and a store asked whether
    // it holds one of `../../<repo>/objects/...` read another repository's
    // object as its own.
    for (const hash of ['..', `../../other/objects/ab/${'c'.repeat(56)}`, 'A'.repeat(64), 'a'.repeat(63)]) {
      assert.throws(() => objectPath('/repo', hash), {
        name: 'InvalidNameError', kind: 'object hash', value: hash,
        message: `the object hash ${JSON.stringify(hash)} is not a SHA-256 in lowercase hex`,
      }, hash);
    }
    assert.strictEqual(objectPath('/repo', `ab${'c'.repeat(62)}`), join('/repo', 'objects', 'ab', `${'c'.repeat(62)}.beast2`));
  });
});

describe('atomicWriteFile', () => {
  let dir: string;
  beforeEach(() => { dir = createTempDir(); });
  afterEach(() => { removeTempDir(dir); });

  // This reproduces the O_TRUNC torn-read race a bare fs.writeFile exposes
  // (reader sees a 0-byte/partial file). The reader reads as the stores' readers
  // do, through readReplacedFile, in turns with the writer's rename: so on
  // Windows, which refuses a rename over a file a read holds open, it never
  // holds the file across the rename, however soon it reads again.
  it('a concurrent reader never observes a torn or empty file while the path is overwritten in place', async () => {
    const target = join(dir, 'status.beast2');
    // Distinctly-sized multi-chunk payloads so each write spans multiple write()
    // calls — this widens the truncation window a bare fs.writeFile would expose,
    // making a torn read overwhelmingly likely if atomicity regresses.
    const payloadA = Buffer.alloc(48 * 1024, 0xab);
    const payloadB = Buffer.alloc(32 * 1024, 0xcd);
    await atomicWriteFile(target, payloadA); // seed so the file always exists

    let stop = false;
    const reader = (async () => {
      const torn: number[] = [];
      while (!stop) {
        const data = await readReplacedFile(target);
        const isA = data.length === payloadA.length && data[0] === 0xab && data[data.length - 1] === 0xab;
        const isB = data.length === payloadB.length && data[0] === 0xcd && data[data.length - 1] === 0xcd;
        if (!isA && !isB) torn.push(data.length);
      }
      return torn;
    })();

    try {
      for (let i = 0; i < 200; i++) {
        await atomicWriteFile(target, i % 2 === 0 ? payloadB : payloadA);
      }
    } finally {
      stop = true; // always release the reader, even if a write throws, or it spins forever
    }
    const torn = await reader;
    assert.deepStrictEqual(torn, [], `reader observed ${torn.length} torn read(s); sizes: ${torn.slice(0, 5).join(',')}`);
  });

  it('takes turns between a read of the file and a rename over it, so a rename never meets a read of its own process, which Windows refuses', async () => {
    const target = join(dir, 'status.beast2');
    await atomicWriteFile(target, Buffer.from('old'));

    // Windows' rule, on every platform: a rename over a file a read holds open
    // is refused. The read holds the file until the test lets it go, and the
    // write says when its staging file is written.
    const { readFile, rename, writeFile } = fsPromises;
    let reading = 0;
    let refused = 0;
    let letGo!: () => void;
    const held = new Promise<void>((resolve) => { letGo = resolve; });
    let staged!: () => void;
    const staging = new Promise<void>((resolve) => { staged = resolve; });
    mock.method(fsPromises, 'readFile', async (file: string) => {
      reading++;
      try {
        await held;
        return await readFile(file);
      } finally {
        reading--;
      }
    });
    mock.method(fsPromises, 'writeFile', async (file: string, data: Uint8Array) => {
      await writeFile(file, data);
      if (file.startsWith(`${target}.`)) staged();
    });
    mock.method(fsPromises, 'rename', async (from: string, to: string) => {
      if (to === target && reading > 0) {
        refused++;
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`), { code: 'EPERM' });
      }
      await rename(from, to);
    });
    try {
      const read = readReplacedFile(target);
      let done = false;
      const write = atomicWriteFile(target, Buffer.from('new')).then(() => { done = true; });
      await staging;
      // A turn of the event loop, by which the write has asked for its rename
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepStrictEqual({ refused, done }, { refused: 0, done: false }, 'the rename waits for the read to close the file');
      letGo();
      assert.strictEqual((await read).toString(), 'old', 'the read reads the file the rename has not replaced yet');
      await write;
      assert.strictEqual(refused, 0, 'no attempt met the read');
      assert.strictEqual((await readReplacedFile(target)).toString(), 'new');
    } finally {
      letGo();
      mock.restoreAll();
    }
  });

  it('leaves no .partial staging files behind after sequential overwrites', async () => {
    const target = join(dir, 'sub', 'a.beast2');
    await atomicWriteFile(target, Buffer.from('hello'));
    await atomicWriteFile(target, Buffer.from('world'));
    const entries = await fs.readdir(join(dir, 'sub'));
    assert.deepStrictEqual(entries, ['a.beast2'], 'only the destination remains; staging files are renamed away');
    assert.strictEqual((await fs.readFile(target)).toString(), 'world');
  });

  it('creates parent directories as needed', async () => {
    const target = join(dir, 'deep', 'nested', 'path', 'x.beast2');
    await atomicWriteFile(target, Buffer.from('ok'));
    assert.strictEqual((await fs.readFile(target)).toString(), 'ok');
  });
});
