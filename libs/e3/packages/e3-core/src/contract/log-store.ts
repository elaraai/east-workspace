/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The log store's contract: what any backend's execution logs do. A log is
 * read by byte offset, as the API serves it, and a window never splits a
 * character but at the log's end. What is appended is read once the attempt's
 * log is flushed, since a store may hold appends until then.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { uuidv7 } from '../uuid.js';
import { MALFORMED_HASHES, MALFORMED_IDS, hashRefusal, idRefusal, type Refusal } from './malformed.js';
import type { BackendSetup } from './setup.js';

const TASK = 'a'.repeat(64);
const INPUTS = 'b'.repeat(64);

/** A log nothing reached: never written, or removed. */
const EMPTY = { data: '', offset: 0, size: 0, totalSize: 0, complete: true };

/**
 * Registers the log store's contract suite over a backend.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function logStoreTests(setup: BackendSetup): void {
  describe('the log store', () => {
    it('appends each stream of an attempt\'s log in order, apart from the other', async (t) => {
      const { storage, repo } = await setup(t);
      const id = uuidv7();
      await storage.logs.append(repo, TASK, INPUTS, id, 'stdout', 'one\n');
      await storage.logs.append(repo, TASK, INPUTS, id, 'stderr', 'oops\n');
      await storage.logs.append(repo, TASK, INPUTS, id, 'stdout', 'two\n');
      await storage.logs.flush(repo, TASK, INPUTS, id);

      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stdout'),
        { data: 'one\ntwo\n', offset: 0, size: 8, totalSize: 8, complete: true });
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stderr'),
        { data: 'oops\n', offset: 0, size: 5, totalSize: 5, complete: true });
    });

    it('reads a log a window of bytes at a time, never splitting a character', async (t) => {
      const { storage, repo } = await setup(t);
      const id = uuidv7();
      // 'a' is one byte in UTF-8, 'é' two, '€' three and 'b' one: seven bytes.
      await storage.logs.append(repo, TASK, INPUTS, id, 'stdout', 'aé€b');
      await storage.logs.flush(repo, TASK, INPUTS, id);

      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stdout', { offset: 0, limit: 2 }),
        { data: 'a', offset: 0, size: 1, totalSize: 7, complete: false }, 'a window ending inside \'é\' stops before it');
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stdout', { offset: 1, limit: 5 }),
        { data: 'é€', offset: 1, size: 5, totalSize: 7, complete: false });
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stdout', { offset: 6, limit: 10 }),
        { data: 'b', offset: 6, size: 1, totalSize: 7, complete: true });
    });

    it('reads a log never written as empty and complete', async (t) => {
      const { storage, repo } = await setup(t);
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, uuidv7(), 'stdout'), EMPTY);
    });

    it('reads everything appended to both streams of an attempt\'s log once it is flushed; a flush again, or of a log nothing was appended to, changes nothing', async (t) => {
      const { storage, repo } = await setup(t);
      const id = uuidv7();
      for (const line of ['one\n', 'two\n', 'three\n']) await storage.logs.append(repo, TASK, INPUTS, id, 'stdout', line);
      await storage.logs.append(repo, TASK, INPUTS, id, 'stderr', 'oops\n');
      await storage.logs.flush(repo, TASK, INPUTS, id);
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stdout'),
        { data: 'one\ntwo\nthree\n', offset: 0, size: 14, totalSize: 14, complete: true });
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stderr'),
        { data: 'oops\n', offset: 0, size: 5, totalSize: 5, complete: true });

      // Flushed again, then appended to and flushed: after what was flushed
      await storage.logs.flush(repo, TASK, INPUTS, id);
      await storage.logs.append(repo, TASK, INPUTS, id, 'stdout', 'four\n');
      await storage.logs.flush(repo, TASK, INPUTS, id);
      assert.equal((await storage.logs.read(repo, TASK, INPUTS, id, 'stdout')).data, 'one\ntwo\nthree\nfour\n');
      assert.equal((await storage.logs.read(repo, TASK, INPUTS, id, 'stderr')).data, 'oops\n');

      const never = uuidv7();
      await storage.logs.flush(repo, TASK, INPUTS, never);
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, never, 'stdout'), EMPTY);
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, never, 'stderr'), EMPTY);
    });

    it('removes both streams of an attempt\'s log, what was appended and not yet flushed too, and no other attempt\'s', async (t) => {
      const { storage, repo } = await setup(t);
      const id = uuidv7();
      const other = uuidv7();
      await storage.logs.append(repo, TASK, INPUTS, id, 'stdout', 'out');
      await storage.logs.append(repo, TASK, INPUTS, id, 'stderr', 'err');
      await storage.logs.append(repo, TASK, INPUTS, other, 'stdout', 'kept');
      await storage.logs.flush(repo, TASK, INPUTS, id);
      await storage.logs.flush(repo, TASK, INPUTS, other);
      await storage.logs.append(repo, TASK, INPUTS, id, 'stdout', 'held');

      await storage.logs.remove(repo, TASK, INPUTS, id);
      await storage.logs.flush(repo, TASK, INPUTS, id);
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stdout'), EMPTY);
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stderr'), EMPTY);
      assert.equal((await storage.logs.read(repo, TASK, INPUTS, other, 'stdout')).data, 'kept');
    });

    it('refuses an attempt named by a hash or an id that is not of its form, naming it, before it reads or writes anything', async (t) => {
      const { storage, repo } = await setup(t);
      const id = uuidv7();
      const attempts: Array<[string, string, string, Refusal]> = [
        ...MALFORMED_HASHES.flatMap((malformed): Array<[string, string, string, Refusal]> => [
          [malformed, INPUTS, id, hashRefusal('task hash', malformed)],
          [TASK, malformed, id, hashRefusal('inputs hash', malformed)],
        ]),
        ...MALFORMED_IDS.map((malformed): [string, string, string, Refusal] => [TASK, INPUTS, malformed, idRefusal('execution id', malformed)]),
      ];
      for (const [task, inputs, attempt, refused] of attempts) {
        await assert.rejects(storage.logs.append(repo, task, inputs, attempt, 'stdout', 'a line\n'), refused);
        await assert.rejects(storage.logs.read(repo, task, inputs, attempt, 'stdout'), refused);
        await assert.rejects(storage.logs.flush(repo, task, inputs, attempt), refused);
        await assert.rejects(storage.logs.remove(repo, task, inputs, attempt), refused);
      }
    });
  });
}
