/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage, executionReadLog } from '@elaraai/e3-core';
import { DEFAULT_TAIL_LINES, lastLines, parseLines, pipeToEnd, readTail } from './logs.js';

describe('parseLines', () => {
  it('defaults when the flag is absent', () => {
    assert.equal(parseLines(undefined), DEFAULT_TAIL_LINES);
  });

  it('accepts a positive integer as a string or a number', () => {
    assert.equal(parseLines('50'), 50);
    assert.equal(parseLines(50), 50);
  });

  it('rejects values that are not a positive integer', () => {
    for (const bad of ['0', '-5', '1.5', 'abc', '']) {
      assert.throws(() => parseLines(bad), /Invalid --lines value/);
    }
  });
});

describe('lastLines', () => {
  it('keeps the last n lines', () => {
    const result = lastLines('a\nb\nc\nd\n', 2);
    assert.equal(result.text, 'c\nd');
    assert.equal(result.lines, 2);
    assert.equal(result.truncated, true);
  });

  it('keeps everything when there are fewer lines than the limit', () => {
    const result = lastLines('a\nb\n', 10);
    assert.equal(result.text, 'a\nb');
    assert.equal(result.lines, 2);
    assert.equal(result.truncated, false);
  });

  it('does not count the empty string after a trailing newline as a line', () => {
    assert.equal(lastLines('only\n', 10).lines, 1);
  });

  it('keeps a final line that has no trailing newline', () => {
    const result = lastLines('a\nb', 10);
    assert.equal(result.text, 'a\nb');
    assert.equal(result.lines, 2);
  });

  it('handles an empty log', () => {
    const result = lastLines('', 10);
    assert.equal(result.text, '');
    assert.equal(result.lines, 0);
    assert.equal(result.truncated, false);
  });
});

// Log reads go through a real repository on disk — the tail windowing depends
// on byte offsets that only the real store produces.
describe('reading a task log', () => {
  const taskHash = 'a'.repeat(64);
  const inputsHash = 'b'.repeat(64);
  const executionId = '01890000-0000-7000-8000-000000000000';

  let repo: string;
  let storage: LocalStorage;

  const read = (stream: 'stdout' | 'stderr', offset: number, limit: number) =>
    executionReadLog(storage, repo, taskHash, inputsHash, executionId, stream, { offset, limit });

  /** Write `count` numbered lines, padded so each line is well over 64 bytes. */
  const writeLines = async (count: number, stream: 'stdout' | 'stderr' = 'stdout') => {
    const lines = Array.from(
      { length: count },
      (_, i) => `line ${String(i).padStart(6, '0')} ${'x'.repeat(50)}`
    );
    const content = `${lines.join('\n')}\n`;
    await storage.logs.append(repo, taskHash, inputsHash, executionId, stream, content);
    return { lines, content };
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'e3-logs-'));
    storage = new LocalStorage();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  describe('readTail', () => {
    it('shows the END of a log larger than one chunk, not the beginning (issue #380)', async () => {
      const { lines, content } = await writeLines(20_000);
      assert.ok(Buffer.byteLength(content) > 1_000_000, 'fixture should exceed one chunk');

      const tail = await readTail(read, 'stdout', 200);

      assert.equal(tail.lines, 200);
      assert.equal(tail.truncated, true);
      assert.equal(tail.totalSize, Buffer.byteLength(content));
      assert.deepEqual(tail.text.split('\n'), lines.slice(-200));
    });

    it('returns whole lines only', async () => {
      await writeLines(20_000);
      const tail = await readTail(read, 'stdout', 200);
      for (const line of tail.text.split('\n')) {
        assert.match(line, /^line \d{6} x{50}$/);
      }
    });

    it('widens its window until it has enough lines', async () => {
      // 5000 lines of ~57 bytes is ~285KB: more lines than fit in the 64KB
      // window the tail starts from.
      const { lines } = await writeLines(5_000);
      const tail = await readTail(read, 'stdout', 4_000);
      assert.equal(tail.lines, 4_000);
      assert.deepEqual(tail.text.split('\n'), lines.slice(-4_000));
    });

    it('returns the whole log, untruncated, when it is shorter than the limit', async () => {
      const { lines } = await writeLines(10);
      const tail = await readTail(read, 'stdout', 200);
      assert.equal(tail.truncated, false);
      assert.deepEqual(tail.text.split('\n'), lines);
    });

    it('reports an empty stream as empty', async () => {
      const tail = await readTail(read, 'stderr', 200);
      assert.equal(tail.text, '');
      assert.equal(tail.lines, 0);
      assert.equal(tail.truncated, false);
      assert.equal(tail.totalSize, 0);
    });
  });

  describe('pipeToEnd', () => {
    it('retrieves a multi-megabyte log in full (issue #380)', async () => {
      const { content } = await writeLines(20_000);

      const chunks: string[] = [];
      const { end, endsWithNewline } = await pipeToEnd(read, 'stdout', 0, {
        write: (chunk) => chunks.push(chunk),
      });

      assert.equal(chunks.join(''), content);
      assert.equal(end, Buffer.byteLength(content));
      assert.equal(endsWithNewline, true);
      assert.ok(chunks.length > 1, 'a multi-megabyte log should arrive in several chunks');
    });

    it('round-trips multi-byte characters split across chunk boundaries', async () => {
      // Enough 3-byte characters that chunk boundaries land inside one.
      const content = '→'.repeat(100_000);
      await storage.logs.append(repo, taskHash, inputsHash, executionId, 'stdout', content);

      const chunks: string[] = [];
      await pipeToEnd(read, 'stdout', 0, { write: (chunk) => chunks.push(chunk) });

      const joined = chunks.join('');
      assert.equal(joined, content);
      assert.ok(!joined.includes('�'), 'no replacement characters at chunk boundaries');
    });

    it('resumes from an offset', async () => {
      const { content } = await writeLines(2_000);
      const offset = 1_000;

      const chunks: string[] = [];
      await pipeToEnd(read, 'stdout', offset, { write: (chunk) => chunks.push(chunk) });

      assert.equal(chunks.join(''), content.slice(offset));
    });

    it('writes nothing for an empty stream', async () => {
      const chunks: string[] = [];
      const { end } = await pipeToEnd(read, 'stderr', 0, { write: (chunk) => chunks.push(chunk) });
      assert.deepEqual(chunks, []);
      assert.equal(end, 0);
    });
  });
});
