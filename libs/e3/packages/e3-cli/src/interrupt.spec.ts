/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { untilInterrupted } from './interrupt.js';

describe('untilInterrupted', () => {
  let said: string[];
  let error: typeof console.error;
  let exitCode: typeof process.exitCode;
  beforeEach(() => {
    said = [];
    error = console.error;
    exitCode = process.exitCode;
    console.error = (line: string) => { said.push(line); };
  });
  afterEach(() => {
    console.error = error;
    process.exitCode = exitCode;
  });

  /** Ctrl-C, as the terminal sends it to a process that listens for it. */
  const ctrlC = (): void => { process.emit('SIGINT'); };

  it('answers what the work answers, and stops listening for Ctrl-C', async () => {
    const listening = process.listenerCount('SIGINT');
    assert.equal(await untilInterrupted((signal) => Promise.resolve(signal.aborted ? 'aborted' : 'done'), 'unused'), 'done');
    assert.equal(process.listenerCount('SIGINT'), listening);
    assert.deepEqual(said, []);
    assert.equal(process.exitCode, exitCode);
  });

  it('throws what the work throws', async () => {
    await assert.rejects(() => untilInterrupted(() => Promise.reject(new Error('no such function')), 'unused'), /no such function/);
    assert.deepEqual(said, []);
  });

  for (const ends of ['answers', 'throws'] as const) {
    it(`aborts the work on Ctrl-C, says what that did and exits 130 whether the work then ${ends}`, async () => {
      const listening = process.listenerCount('SIGINT');
      const stopped = await untilInterrupted((signal) => new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => { if (ends === 'answers') resolve('a result'); else reject(new Error('given up')); });
        ctrlC();
      }), 'its rack is told to stop it');
      assert.equal(stopped, null);
      assert.deepEqual(said, ['Interrupted: its rack is told to stop it']);
      assert.equal(process.exitCode, 130);
      assert.equal(process.listenerCount('SIGINT'), listening);
    });
  }
});
