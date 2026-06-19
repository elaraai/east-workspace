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

  // POSIX-only. This reproduces the O_TRUNC torn-read race a bare fs.writeFile
  // exposes (reader sees a 0-byte/partial file). On Windows rename-over-an-open
  // file is a sharing violation (handled by renameWithRetry), not a torn read,
  // and a tight raw-byte reader there starves the rename via libuv-threadpool
  // ordering rather than exposing any real bug. Windows concurrent-read atomicity
  // is covered end-to-end by the LocalRefStore execution/dataflow tests, which
  // read+decode (a natural file-closed gap). Matches the repo's existing
  // Windows-skip pattern for concurrency specs (e.g. runDetached.spec.ts).
  it('a concurrent reader never observes a torn or empty file while the path is overwritten in place', { skip: process.platform === 'win32' }, async () => {
    const target = join(dir, 'status.beast2');
    // Distinctly-sized multi-chunk payloads so each write spans multiple write()
    // calls — this widens the truncation window a bare fs.writeFile would expose,
    // making a torn read overwhelmingly likely if atomicity regresses. Kept
    // moderate so a concurrent reader on Windows doesn't hold the file long
    // enough to starve the writer's rename.
    const payloadA = Buffer.alloc(48 * 1024, 0xab);
    const payloadB = Buffer.alloc(32 * 1024, 0xcd);
    await atomicWriteFile(target, payloadA); // seed so the file always exists

    let stop = false;
    const reader = (async () => {
      const torn: number[] = [];
      while (!stop) {
        const data = await fs.readFile(target);
        const isA = data.length === payloadA.length && data[0] === 0xab && data[data.length - 1] === 0xab;
        const isB = data.length === payloadB.length && data[0] === 0xcd && data[data.length - 1] === 0xcd;
        if (!isA && !isB) torn.push(data.length);
        // Yield between reads. A tight read loop holds the file open ~continuously,
        // which on Windows starves the writer's rename (EPERM); a real poller reads
        // periodically. This still overlaps writes often enough to catch a torn read.
        await new Promise((r) => setTimeout(r, 1));
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
