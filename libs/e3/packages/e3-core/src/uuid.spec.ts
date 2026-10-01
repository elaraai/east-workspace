/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for UUIDv7 generation: ids one process mints sort in the order it
 * minted them, within a millisecond as across them, so "the latest attempt" —
 * the largest id — is the last one minted.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isUuidv7, uuidv7, uuidv7Generator, uuidv7Timestamp } from './uuid.js';

/** A clock that reads each of `readings` in turn, then the last for good. */
function clockReading(...readings: number[]): () => number {
  let next = 0;
  return () => readings[Math.min(next++, readings.length - 1)]!;
}

describe('uuidv7', () => {
  it('mints ids that sort in the order they were minted, 100,000 back to back', () => {
    let previous = uuidv7();
    let shared = 0;
    for (let i = 0; i < 100_000; i++) {
      const id = uuidv7();
      assert.ok(isUuidv7(id), `${id} is a UUIDv7`);
      assert.ok(id > previous, `${id} sorts after ${previous}, the id minted before it`);
      if (uuidv7Timestamp(id).getTime() === uuidv7Timestamp(previous).getTime()) shared++;
      previous = id;
    }
    // The order held where it is at risk: between ids of one millisecond.
    assert.ok(shared > 0, 'some ids shared a millisecond');
  });

  it('keeps the order within one millisecond, and moves the timestamp on a millisecond when the counter would overflow', () => {
    const mint = uuidv7Generator(() => 1_000_000);
    const ids = Array.from({ length: 5_000 }, () => mint());
    for (let i = 1; i < ids.length; i++) assert.ok(ids[i]! > ids[i - 1]!, `id ${i} sorts after id ${i - 1}`);
    const timestamps = ids.map((id) => uuidv7Timestamp(id).getTime());
    assert.equal(timestamps[0], 1_000_000);
    // The counter starts at 2,047 or less of its 4,095, so a millisecond holds
    // at least 2,048 ids before its timestamp moves on.
    assert.ok(timestamps.slice(0, 2_048).every((ms) => ms === 1_000_000), 'the first 2,048 keep the clock\'s millisecond');
    assert.ok(timestamps.at(-1)! > 1_000_000, 'past an overflow, the timestamp moved on');
    assert.ok(timestamps.at(-1)! <= 1_000_003, 'by a millisecond for each overflow, and no more');
  });

  it('keeps the order when the clock reads earlier than it did, with the timestamp it last read', () => {
    const mint = uuidv7Generator(clockReading(5_000, 5_000, 4_000, 4_000, 6_000));
    const ids = Array.from({ length: 5 }, () => mint());
    for (let i = 1; i < ids.length; i++) assert.ok(ids[i]! > ids[i - 1]!, `id ${i} sorts after id ${i - 1}`);
    assert.deepEqual(ids.map((id) => uuidv7Timestamp(id).getTime()), [5_000, 5_000, 5_000, 5_000, 6_000]);
  });

  it('mints ids in a new millisecond that differ in their random bits', () => {
    const mint = uuidv7Generator(clockReading(...Array.from({ length: 64 }, (_, i) => 7_000 + i)));
    const ids = Array.from({ length: 64 }, () => mint());
    assert.equal(new Set(ids.map((id) => id.slice(15))).size, 64, 'no two share their counter and random bits');
  });
});
