/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The log store's contract: what any backend's execution logs do. A log is
 * read by byte offset, as the API serves it, and a window never splits a
 * character but at the log's end.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { uuidv7 } from '../uuid.js';
import type { BackendSetup } from './setup.js';

const TASK = 'a'.repeat(64);
const INPUTS = 'b'.repeat(64);

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

      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stdout', { offset: 0, limit: 2 }),
        { data: 'a', offset: 0, size: 1, totalSize: 7, complete: false }, 'a window ending inside \'é\' stops before it');
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stdout', { offset: 1, limit: 5 }),
        { data: 'é€', offset: 1, size: 5, totalSize: 7, complete: false });
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, id, 'stdout', { offset: 6, limit: 10 }),
        { data: 'b', offset: 6, size: 1, totalSize: 7, complete: true });
    });

    it('reads a log never written as empty and complete', async (t) => {
      const { storage, repo } = await setup(t);
      assert.deepEqual(await storage.logs.read(repo, TASK, INPUTS, uuidv7(), 'stdout'),
        { data: '', offset: 0, size: 0, totalSize: 0, complete: true });
    });

    it('removes both streams of an attempt\'s log, and no other attempt\'s', async (t) => {
      const { storage, repo } = await setup(t);
      const id = uuidv7();
      const other = uuidv7();
      await storage.logs.append(repo, TASK, INPUTS, id, 'stdout', 'out');
      await storage.logs.append(repo, TASK, INPUTS, id, 'stderr', 'err');
      await storage.logs.append(repo, TASK, INPUTS, other, 'stdout', 'kept');

      await storage.logs.remove(repo, TASK, INPUTS, id);
      assert.equal((await storage.logs.read(repo, TASK, INPUTS, id, 'stdout')).totalSize, 0);
      assert.equal((await storage.logs.read(repo, TASK, INPUTS, id, 'stderr')).totalSize, 0);
      assert.equal((await storage.logs.read(repo, TASK, INPUTS, other, 'stdout')).data, 'kept');
    });
  });
}
