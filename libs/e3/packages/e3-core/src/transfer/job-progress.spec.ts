/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A job's progress held back: no more than one write an interval, and the
 * newest count written once the interval has passed, though no later one
 * comes. The clock is the test's own.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { heldProgress } from './job-progress.js';

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
