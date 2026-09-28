/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eachAtMost, readInOrder } from './concurrency.js';

/** A wait of `ms`, so calls overlap as a store's requests do. */
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('eachAtMost', () => {
  it('calls every item, never more than the width at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await eachAtMost(Array.from({ length: 40 }, (_, i) => i), 16, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await pause(2);
      seen.push(item);
      inFlight--;
    });
    assert.deepEqual(seen.sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i));
    assert.equal(peak, 16);
  });

  it('starts no item after a failure, and throws the first once the calls in flight have settled', async () => {
    const started: number[] = [];
    let settled = 0;
    await assert.rejects(
      eachAtMost(Array.from({ length: 40 }, (_, i) => i), 4, async (item) => {
        started.push(item);
        await pause(item === 1 ? 1 : 5);
        settled++;
        if (item === 1) throw new Error('item 1 failed');
      }),
      { message: 'item 1 failed' },
    );
    assert.equal(settled, started.length, 'every call started had settled when the failure was thrown');
    assert.ok(started.length < 40, `the pool stopped taking items: ${started.length} started`);
  });
});

describe('readInOrder', () => {
  it('yields in order, reading at most the width at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const values: number[] = [];
    for await (const value of readInOrder(40, 16, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Later reads answer sooner, as a store's may.
      await pause(40 - i);
      inFlight--;
      return i;
    })) values.push(value);
    assert.deepEqual(values, Array.from({ length: 40 }, (_, i) => i));
    assert.equal(peak, 16);
  });

  it('at a width of one, reads a value only when the consumer asks for it', async () => {
    const reads: number[] = [];
    const taken: number[] = [];
    for await (const value of readInOrder(3, 1, async (i) => {
      reads.push(i);
      return i;
    })) {
      assert.deepEqual(reads, [...taken, value], 'nothing is read ahead of the value in hand');
      taken.push(value);
    }
  });

  it('raises a failed read when the consumer reaches it, and none unhandled', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const values: number[] = [];
      await assert.rejects((async () => {
        for await (const value of readInOrder(8, 4, async (i) => {
          if (i === 2) throw new Error('read 2 failed');
          await pause(5);
          return i;
        })) values.push(value);
      })(), { message: 'read 2 failed' });
      assert.deepEqual(values, [0, 1]);
      // The reads abandoned in flight settle as the event loop turns.
      await pause(20);
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
