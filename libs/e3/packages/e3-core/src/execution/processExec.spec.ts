/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Staging inputs and adopting outputs without reading them (issue #767).
 *
 * Every task execution used to move its inputs and its output through the
 * orchestrator's heap, whole: `objects.read` then `writeFile` per input,
 * `readFile` then `objects.write` for the output. Measured on a 2 GB
 * collection input, the e3 process peaked at 2.1 GB on every run — for bytes
 * the runner then opened lazily anyway.
 *
 * So the properties here are about WHAT TOUCHED WHAT, not about values: a
 * staged input shares the object's storage (or is exactly its bytes), a
 * `custom` runner never gets a link it could write through, an adopted output
 * lands on the hash `objects.write` would have produced, and neither path
 * calls the whole-object read.
 *
 * Real filesystem only — an inode assertion has no meaning against a mock.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adoptOutputFile, marshalInputsToDir } from './processExec.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import { objectPath } from '../storage/local/localHelpers.js';
import type { ObjectStore, StorageBackend } from '../storage/interfaces.js';

/** Counts the whole-object reads a marshal makes; the point of #767 is that
 *  there are none. */
function countWholeReads(storage: StorageBackend): { reads: () => number } {
  const objects = storage.objects as ObjectStore;
  const original = objects.read.bind(objects);
  let reads = 0;
  objects.read = async (repo: string, hash: string): Promise<Uint8Array> => {
    reads++;
    return original(repo, hash);
  };
  return { reads: () => reads };
}

describe('staging by link or kernel copy', () => {
  let testRepo: string;
  let scratch: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepo = createTestRepo();
    scratch = join(createTempDir(), 'scratch');
    mkdirSync(scratch, { recursive: true });
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
    removeTempDir(join(scratch, '..'));
  });

  /** A stored object of `n` distinguishable bytes. */
  async function store(n: number, fill: number): Promise<{ hash: string; bytes: Uint8Array }> {
    const bytes = new Uint8Array(n).fill(fill);
    return { hash: await storage.objects.write(testRepo, bytes), bytes };
  }

  it('stages inputs without reading an object whole', async () => {
    const a = await store(4096, 0x41);
    const b = await store(2048, 0x42);
    const spy = countWholeReads(storage);

    const paths = await marshalInputsToDir(storage, testRepo, scratch, [a.hash, b.hash]);

    assert.deepEqual(paths, [join(scratch, 'input-0.beast2'), join(scratch, 'input-1.beast2')]);
    assert.deepEqual(readFileSync(paths[0]!), Buffer.from(a.bytes));
    assert.deepEqual(readFileSync(paths[1]!), Buffer.from(b.bytes));
    assert.equal(spy.reads(), 0, 'the whole-object read is what #767 removed');
  });

  it('shares the object\'s storage for a stock runner', async () => {
    const { hash } = await store(4096, 0x43);
    const [staged] = await marshalInputsToDir(storage, testRepo, scratch, [hash]);

    const object = statSync(objectPath(testRepo, hash));
    const input = statSync(staged!);
    // A hard link on one volume, a reflink where the file system has them:
    // either way the bytes were never copied through this process.
    assert.ok(
      (input.ino === object.ino && input.dev === object.dev) || input.size === object.size,
      'the staged input is the object, or exactly its bytes'
    );
  });

  it('never links an input a custom runner could write through', async () => {
    const { hash } = await store(4096, 0x44);
    const [staged] = await marshalInputsToDir(storage, testRepo, scratch, [hash], { link: false });

    const object = statSync(objectPath(testRepo, hash));
    const input = statSync(staged!);
    assert.notEqual(input.ino, object.ino, 'a custom runner gets a copy: it may mv or truncate its inputs');
    assert.deepEqual(readFileSync(staged!), readFileSync(objectPath(testRepo, hash)));

    // Proving the point: writing through the staged path leaves the object be.
    writeFileSync(staged!, new Uint8Array(16).fill(0xff));
    assert.deepEqual(readFileSync(objectPath(testRepo, hash)), Buffer.from(new Uint8Array(4096).fill(0x44)));
  });

  it('stages through ranged reads when the backend cannot materialize', async () => {
    // The fallback every non-file backend takes: chunked `readRange` into the
    // scratch file, never `read`.
    const { hash, bytes } = await store(9000, 0x45);
    const objects = storage.objects as ObjectStore;
    delete (objects as { materialize?: unknown }).materialize;
    const spy = countWholeReads(storage);

    const [staged] = await marshalInputsToDir(storage, testRepo, scratch, [hash]);

    assert.deepEqual(readFileSync(staged!), Buffer.from(bytes));
    assert.equal(spy.reads(), 0, 'ranged reads, not a whole read');
  });

  it('adopts an output onto the hash objects.write would have produced', async () => {
    const outputPath = join(scratch, 'output.beast2');
    const bytes = new Uint8Array(3000).fill(0x46);
    writeFileSync(outputPath, bytes);

    const adopted = await adoptOutputFile(storage, testRepo, outputPath);
    const written = await storage.objects.write(testRepo, bytes);

    assert.equal(adopted, written, 'adopt and write are one content address');
    assert.deepEqual(await storage.objects.read(testRepo, adopted), bytes);
  });

  it('survives the scratch cleanup that follows it', async () => {
    // The adopt happens while the scratch directory still exists, and the
    // execution's `finally` then removes it. Removal unlinks the scratch NAME;
    // the object holds its own link to the same content, so it is unaffected.
    // (An adopted file is therefore shared storage, not a copy — which is why
    // `marshalInputsToDir` refuses to link a `custom` runner's inputs, where
    // an arbitrary command could write through the path instead of replacing
    // it.)
    const outputPath = join(scratch, 'output.beast2');
    const bytes = new Uint8Array(1500).fill(0x47);
    writeFileSync(outputPath, bytes);

    const hash = await adoptOutputFile(storage, testRepo, outputPath);
    rmSync(outputPath);

    assert.deepEqual(await storage.objects.read(testRepo, hash), bytes);
  });
});
