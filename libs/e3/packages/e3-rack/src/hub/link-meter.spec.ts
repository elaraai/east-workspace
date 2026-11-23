/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { it } from 'node:test';
import assert from 'node:assert/strict';
import { LINK_EWMA_WEIGHT, LINK_HELD_MAX, LINK_MIN_SAMPLE_BYTES, LINK_SAMPLE_BYTES, LINK_STALE_MS, RackLinkMeter } from './link-meter.js';

const MiB = 1024 * 1024;

/** A meter on a clock the test moves. */
function meter() {
  let now = 1000;
  return { meter: new RackLinkMeter(() => now), advance: (ms: number) => { now += ms; } };
}

it('measures a link by the bytes it carried while busy, however many transfers share it', () => {
  const { meter: m, advance } = meter();
  assert.equal(m.link('rack-a').bytesPerSecond, null, 'unmeasured');
  // Two transfers at once, each 4 MiB over 2 s: the link carried 8 MiB in 2 s
  const one = m.begin('rack-a'); const two = m.begin('rack-a');
  advance(1000); one.add(4 * MiB); two.add(2 * MiB);
  advance(1000); two.add(2 * MiB);
  one.end(); two.end();
  assert.equal(m.link('rack-a').bytesPerSecond, 4 * MiB, '8 MiB over the 2 s the link was busy');
  // Idle time between transfers is not the link's
  advance(60_000);
  const three = m.begin('rack-a'); advance(1000); three.add(4 * MiB); three.end();
  assert.equal(m.link('rack-a').bytesPerSecond, 4 * MiB);
  assert.equal(m.link('rack-b').bytesPerSecond, null, 'each rack has its own link');
});

it('smooths samples, takes one every sample of bytes while transfers run, and carries a small one over', () => {
  const { meter: m, advance } = meter();
  const first = m.begin('rack-a'); advance(1000); first.add(10 * MiB); first.end();
  assert.equal(m.link('rack-a').bytesPerSecond, 10 * MiB);
  // A long transfer is sampled as it runs, not only when it ends
  const long = m.begin('rack-a'); advance(16_000); long.add(LINK_SAMPLE_BYTES);
  assert.equal(m.link('rack-a').bytesPerSecond, 10 * MiB + LINK_EWMA_WEIGHT * (MiB - 10 * MiB), 'one slow sample moves the rate, and does not set it');
  long.end();
  // Too few bytes to sample are carried over to the next transfer
  const before = m.link('rack-a').bytesPerSecond;
  const small = m.begin('rack-a'); advance(1000); small.add(LINK_MIN_SAMPLE_BYTES / 2); small.end();
  assert.equal(m.link('rack-a').bytesPerSecond, before);
  const next = m.begin('rack-a'); advance(1000); next.add(LINK_MIN_SAMPLE_BYTES / 2); next.end();
  assert.notEqual(m.link('rack-a').bytesPerSecond, before, 'the two together make a sample');
});

it('forgets a rate no sample has refreshed, and starts afresh from the next', () => {
  const { meter: m, advance } = meter();
  const slow = m.begin('rack-a'); advance(100_000); slow.add(2 * MiB); slow.end();
  assert.ok(m.link('rack-a').bytesPerSecond! < 30_000);
  advance(LINK_STALE_MS + 1);
  assert.equal(m.link('rack-a').bytesPerSecond, null, 'a link that measured slow, and kept work off its rack, is measured again');
  const fast = m.begin('rack-a'); advance(1000); fast.add(50 * MiB); fast.end();
  assert.equal(m.link('rack-a').bytesPerSecond, 50 * MiB, 'the stale rate does not weigh on the new one');
});

it('knows a rack holds what it was served whole or inline, by repository, and not what a transfer cut short', () => {
  const { meter: m } = meter();
  const whole = m.begin('rack-a'); whole.add(10); whole.end({ repo: 'r-1', hash: 'a'.repeat(64) });
  const cut = m.begin('rack-a'); cut.add(10); cut.end();
  m.held('rack-a', 'r-1', 'c'.repeat(64));
  const link = m.link('rack-a');
  assert.equal(link.holds('r-1', 'a'.repeat(64)), true);
  assert.equal(link.holds('r-1', 'c'.repeat(64)), true, 'sent inline');
  assert.equal(link.holds('r-2', 'a'.repeat(64)), false, 'another repository\'s cache is another namespace');
  assert.equal(m.link('rack-b').holds('r-1', 'a'.repeat(64)), false, 'another rack');
  // A second end is ignored
  whole.end({ repo: 'r-1', hash: 'b'.repeat(64) });
  assert.equal(m.link('rack-a').holds('r-1', 'b'.repeat(64)), false);
  assert.deepEqual(m.racks(), ['rack-a']);
  m.forget('rack-a');
  assert.equal(m.link('rack-a').holds('r-1', 'a'.repeat(64)), false, 'a removed rack is forgotten');
});

it('remembers at most so many objects a rack holds, the least recently served going first', () => {
  const { meter: m } = meter();
  for (let i = 0; i <= LINK_HELD_MAX; i++) m.held('rack-a', 'r', String(i));
  const link = m.link('rack-a');
  assert.equal(link.holds('r', '0'), false);
  assert.equal(link.holds('r', '1'), true);
  assert.equal(link.holds('r', String(LINK_HELD_MAX)), true);
});
