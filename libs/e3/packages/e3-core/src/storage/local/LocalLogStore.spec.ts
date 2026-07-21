/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { appendFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalLogStore } from './LocalLogStore.js';

const TASK_HASH = 'a'.repeat(64);
const INPUTS_HASH = 'b'.repeat(64);
const EXECUTION_ID = '01890000-0000-7000-8000-000000000000';

describe('LocalLogStore', () => {
  let repo: string;
  let logs: LocalLogStore;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'e3-logstore-'));
    logs = new LocalLogStore();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const write = (data: string, stream: 'stdout' | 'stderr' = 'stdout') =>
    logs.append(repo, TASK_HASH, INPUTS_HASH, EXECUTION_ID, stream, data);

  const read = (options?: { offset?: number; limit?: number }) =>
    logs.read(repo, TASK_HASH, INPUTS_HASH, EXECUTION_ID, 'stdout', options);

  describe('read', () => {
    it('reports the total size of a log larger than the default chunk', async () => {
      const content = 'x'.repeat(200_000);
      await write(content);

      const chunk = await read();
      assert.strictEqual(chunk.totalSize, 200_000);
      assert.strictEqual(chunk.size, 65536);
      assert.strictEqual(chunk.complete, false);
    });

    it('paging from offset to end reassembles the whole log', async () => {
      const content = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
      await write(content);

      let offset = 0;
      let assembled = '';
      for (;;) {
        const chunk = await read({ offset, limit: 4096 });
        assembled += chunk.data;
        offset += chunk.size;
        if (chunk.complete) break;
      }

      assert.strictEqual(assembled, content);
      assert.strictEqual(offset, Buffer.byteLength(content));
    });

    it('stops a chunk at a character boundary so paged reads round-trip UTF-8', async () => {
      // A 3-byte character straddling the requested limit: an untrimmed chunk
      // would decode U+FFFD on both sides of the split.
      const content = `ab€cd`;
      await write(content);

      const first = await read({ offset: 0, limit: 3 });
      assert.strictEqual(first.data, 'ab');
      assert.strictEqual(first.size, 2);
      assert.strictEqual(first.complete, false);

      const second = await read({ offset: first.size, limit: 100 });
      assert.strictEqual(second.data, '€cd');
      assert.strictEqual(second.complete, true);
      assert.strictEqual(first.data + second.data, content);
    });

    it('keeps a truncated character at end of file rather than stalling', async () => {
      // Half of a 2-byte character, as a killed writer would leave it.
      await write('ok');
      appendFileSync(
        join(repo, 'executions', TASK_HASH, INPUTS_HASH, EXECUTION_ID, 'stdout.txt'),
        Buffer.from('é', 'utf-8').subarray(0, 1)
      );

      const chunk = await read();
      assert.strictEqual(chunk.totalSize, 3);
      assert.strictEqual(chunk.size, 3);
      assert.strictEqual(chunk.complete, true);
    });

    it('a zero-length read reports the size without returning data', async () => {
      await write('hello\nworld\n');

      const chunk = await read({ offset: 0, limit: 0 });
      assert.strictEqual(chunk.data, '');
      assert.strictEqual(chunk.size, 0);
      assert.strictEqual(chunk.totalSize, 12);
    });

    it('returns an empty chunk for a stream that was never written', async () => {
      const chunk = await logs.read(repo, TASK_HASH, INPUTS_HASH, EXECUTION_ID, 'stderr');
      assert.strictEqual(chunk.data, '');
      assert.strictEqual(chunk.totalSize, 0);
      assert.strictEqual(chunk.complete, true);
    });
  });
});
