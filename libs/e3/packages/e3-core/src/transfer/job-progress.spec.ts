/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A job's progress held back: no more than one write an interval, and the
 * newest count written once the interval has passed, though no later one
 * comes. The clock is the test's own. And the order one key's jobs run in:
 * each after every job filed before it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JobOrder, heldProgress } from './job-progress.js';

describe('heldProgress', () => {
  it('writes the first count at once, holds the newest within the interval, and writes it once the interval has passed though no later one comes', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    const written: number[] = [];
    const pieces = heldProgress<number>((count) => { written.push(count); }, 500);

    pieces.hold(1);
    assert.deepEqual(written, [1], 'the first is written at once');
    t.mock.timers.tick(100);
    pieces.hold(2);
    pieces.hold(95);
    assert.deepEqual(written, [1], 'the next are held');

    // No later count comes: a piece runs on. The newest is written 500 ms after the last write
    t.mock.timers.tick(399);
    assert.deepEqual(written, [1]);
    t.mock.timers.tick(1);
    assert.deepEqual(written, [1, 95]);

    // The interval over, a count is written as it comes
    t.mock.timers.tick(500);
    pieces.hold(96);
    assert.deepEqual(written, [1, 95, 96]);
  });

  it('writes the count held before the step after, and none once the job has settled', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
    const written: number[] = [];
    const pieces = heldProgress<number>((count) => { written.push(count); }, 500);

    pieces.hold(1);
    pieces.hold(2);
    pieces.flush();
    assert.deepEqual(written, [1, 2], 'flushed before the step after');
    t.mock.timers.tick(1_000);
    assert.deepEqual(written, [1, 2], 'and not written again by its timer');

    pieces.hold(3);
    pieces.hold(4);
    pieces.stop();
    t.mock.timers.tick(1_000);
    assert.deepEqual(written, [1, 2, 3], 'a count held as the job settles is let go');
    pieces.flush();
    assert.deepEqual(written, [1, 2, 3]);
  });
});

describe('JobOrder (ruling 37)', () => {
  /** Lets every promise already settled run what waits on it. */
  const settled = (): Promise<void> => new Promise((resolve) => { setImmediate(resolve); });

  it('gives the jobs filed under one key their turns in the order they took their places, beside those of another key', async () => {
    const order = new JobOrder();
    const [first, second, other] = [order.take('orders.erp'), order.take('orders.erp'), order.take('orders.wms')];
    assert.deepEqual([first.waits, second.waits, other.waits], [false, true, false], 'the second waits for the first; another key\'s job for none');
    const ran: string[] = [];
    void second.before.then(() => { ran.push('second'); });
    void first.before.then(() => { ran.push('first'); });
    void other.before.then(() => { ran.push('other'); });
    await settled();
    assert.deepEqual(ran, ['first', 'other'], 'the second has not been given its turn');

    first.leave();
    await second.before;
    await settled();
    assert.deepEqual(ran, ['first', 'other', 'second']);
  });

  it('keeps a job behind every job filed before it, though the one just before it left without running; and forgets a key once its jobs have ended', async () => {
    const order = new JobOrder();
    const [first, second, third] = [order.take('orders.erp'), order.take('orders.erp'), order.take('orders.erp')];
    // The second is not run after all
    second.leave();
    let given = false;
    void third.before.then(() => { given = true; });
    await settled();
    assert.equal(given, false, 'the third still waits for the first');

    first.leave();
    await third.before;
    third.leave();
    await settled();
    assert.equal(order.take('orders.erp').waits, false, 'nothing of the key is left to wait for');
  });
});
