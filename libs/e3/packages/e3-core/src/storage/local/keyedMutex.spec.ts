/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the in-process keyed mutex used to serialize same-process access to
 * a dataset ref above the cross-process file lock. Pins: same-key tasks never
 * interleave, distinct keys run concurrently, a failing task does not wedge or
 * fail its key, and the tail map drains to empty (no leak on a long-lived
 * process).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withKeyedLock, pendingKeyCount } from './keyedMutex.js';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('withKeyedLock', () => {
  it('serializes same-key tasks (no interleaving)', async () => {
    const events: string[] = [];
    const task = (id: string) => async () => {
      events.push(`${id}:start`);
      await tick(5);
      events.push(`${id}:end`);
    };
    await Promise.all([
      withKeyedLock('k', task('A')),
      withKeyedLock('k', task('B')),
      withKeyedLock('k', task('C')),
    ]);
    // Each task's start is immediately followed by its own end — never another's.
    assert.deepEqual(events, ['A:start', 'A:end', 'B:start', 'B:end', 'C:start', 'C:end']);
  });

  it('runs distinct keys concurrently', async () => {
    const events: string[] = [];
    const task = (id: string) => async () => {
      events.push(`${id}:start`);
      await tick(10);
      events.push(`${id}:end`);
    };
    await Promise.all([withKeyedLock('x', task('X')), withKeyedLock('y', task('Y'))]);
    // Both start before either ends — they did not serialize.
    assert.deepEqual(events.slice(0, 2).sort(), ['X:start', 'Y:start']);
  });

  it('returns the task result and propagates only that task\'s rejection', async () => {
    await assert.rejects(withKeyedLock('k', async () => { throw new Error('boom'); }), /boom/);
    // A prior failure must not wedge the key: the next task still runs.
    const v = await withKeyedLock('k', async () => 42);
    assert.equal(v, 42);
  });

  it('serializes correctly even after a task throws', async () => {
    const events: string[] = [];
    const ok = (id: string) => async () => { events.push(id); };
    const results = await Promise.allSettled([
      withKeyedLock('k', async () => { events.push('A'); throw new Error('A failed'); }),
      withKeyedLock('k', ok('B')),
      withKeyedLock('k', ok('C')),
    ]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(results[2].status, 'fulfilled');
    assert.deepEqual(events, ['A', 'B', 'C']);
  });

  it('drains the tail map to empty after a burst of same- and distinct-key calls', async () => {
    await Promise.all([
      withKeyedLock('a', async () => { await tick(2); }),
      withKeyedLock('a', async () => { await tick(2); }),
      withKeyedLock('b', async () => { await tick(2); }),
      withKeyedLock('c', async () => { throw new Error('x'); }).catch(() => {}),
    ]);
    // Let the post-settlement cleanup microtasks run.
    await tick(5);
    assert.equal(pendingKeyCount(), 0, 'every key entry was reclaimed');
  });
});
