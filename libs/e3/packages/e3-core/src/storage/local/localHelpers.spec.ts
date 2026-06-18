/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the local atomic-write primitive.
 *
 * `atomicWriteFile` is the shared stage-and-rename helper behind every mutable
 * ref/state file (execution status, dataflow runs, workspace state, dataset
 * refs). The contract it guarantees — and the property a bare `fs.writeFile`
 * violates — is that a concurrent reader of a path being overwritten in place
 * never observes a truncated/empty file.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteFile } from './localHelpers.js';
import { createTempDir, removeTempDir } from '../../test-helpers.js';

describe('atomicWriteFile', () => {
  let dir: string;
  beforeEach(() => { dir = createTempDir(); });
  afterEach(() => { removeTempDir(dir); });

  it('a concurrent reader never observes a torn or empty file while the path is overwritten in place', async () => {
    const target = join(dir, 'status.beast2');
    // Large, distinctly-sized payloads so each write spans multiple write()
    // calls — this widens the truncation window a bare fs.writeFile would
    // expose, making a torn read overwhelmingly likely if atomicity regresses.
    const payloadA = Buffer.alloc(96 * 1024, 0xab);
    const payloadB = Buffer.alloc(64 * 1024, 0xcd);
    await atomicWriteFile(target, payloadA); // seed so the file always exists

    let stop = false;
    const reader = (async () => {
      const torn: number[] = [];
      while (!stop) {
        const data = await fs.readFile(target);
        const isA = data.length === payloadA.length && data[0] === 0xab && data[data.length - 1] === 0xab;
        const isB = data.length === payloadB.length && data[0] === 0xcd && data[data.length - 1] === 0xcd;
        if (!isA && !isB) torn.push(data.length);
      }
      return torn;
    })();

    for (let i = 0; i < 400; i++) {
      await atomicWriteFile(target, i % 2 === 0 ? payloadB : payloadA);
    }
    stop = true;
    const torn = await reader;
    assert.deepStrictEqual(torn, [], `reader observed ${torn.length} torn read(s); sizes: ${torn.slice(0, 5).join(',')}`);
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
