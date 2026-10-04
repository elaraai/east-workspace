/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * How an upgrade step works through its units in parts. The repository
 * record's contract (`contract/repository-record.ts`) holds each shipped step
 * to it over every backend; this holds the order a cursor is kept in, and what
 * a part does with its time.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareUnitKeys, workInParts } from './parts.js';

/** Units that are their keys. */
const unitsOf = (keys: readonly string[]) => keys.map((key) => ({ key, unit: key }));

describe('a step\'s parts', () => {
  it('order the units\' keys code unit by code unit, as on every machine', async () => {
    assert.ok(compareUnitKeys('B', 'a') < 0, 'an upper-case letter before every lower-case one');
    assert.ok(compareUnitKeys('é', 'z') > 0, 'a letter past ASCII after every ASCII one');
    assert.equal(compareUnitKeys('a/b', 'a/b'), 0);

    const done: string[] = [];
    assert.equal(await workInParts(unitsOf(['b', 'é', 'a', 'B']), null, Date.now() + 60_000, 1, async (key) => { done.push(key); }), null);
    assert.deepEqual(done, ['B', 'a', 'b', 'é']);
  });

  it('do a batch however late they start, stop between batches once their time has passed, and go on past where the last stopped', async () => {
    const units = unitsOf(['k3', 'k0', 'k4', 'k1', 'k2']);
    const done: string[] = [];
    const work = async (key: string) => { done.push(key); };

    // At most as many parts as there are units: each does at least one.
    const stops: (string | null)[] = [];
    let at: string | null = null;
    do {
      at = await workInParts(units, at, 0, 2, work);
      stops.push(at);
    } while (at !== null && stops.length < units.length);
    assert.deepEqual(stops, ['k1', 'k3', null], 'a batch of two a part, the last unit\'s part the step\'s last');
    assert.deepEqual(done, ['k0', 'k1', 'k2', 'k3', 'k4'], 'each unit once');
  });

  it('go on through every batch while their time lasts, and are done', async () => {
    const done: string[] = [];
    assert.equal(await workInParts(unitsOf(['k2', 'k0', 'k1']), null, Date.now() + 60_000, 2, async (key) => { done.push(key); }), null);
    assert.deepEqual(done, ['k0', 'k1', 'k2']);
  });

  it('are done at once with no unit left, doing none past where the last stopped', async () => {
    const done: string[] = [];
    const work = async (key: string) => { done.push(key); };
    assert.equal(await workInParts([], null, 0, 16, work), null);
    assert.equal(await workInParts(unitsOf(['k0', 'k1']), 'k1', 0, 16, work), null);
    assert.deepEqual(done, []);
  });

  it('fail with a unit\'s failure once the units in flight have settled, starting none after it', async () => {
    const done: string[] = [];
    const failed = new Error('k1 failed');
    const work = async (key: string): Promise<void> => {
      if (key === 'k1') throw failed;
      await new Promise((resolve) => setTimeout(resolve, 5));
      done.push(key);
    };
    await assert.rejects(workInParts(unitsOf(['k0', 'k1', 'k2', 'k3', 'k4', 'k5']), null, Date.now() + 60_000, 3, work), failed);
    assert.deepEqual([...done].sort(compareUnitKeys), ['k0', 'k2'], 'the batch\'s other units settled, and no later one started');
  });
});
