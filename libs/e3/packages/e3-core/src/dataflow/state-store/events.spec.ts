/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A run's events in segments, as every state store appends and reads them.
 * The state store's contract (`contract/execution-state-store.ts`) holds each
 * store to what a run's events read back as; this holds the segments a store
 * writes, and the ones a poll reads.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, IntegerType, encodeBeast2For, equalFor, printFor, variant } from '@elaraai/east';
import { ExecutionEventType } from '@elaraai/e3-types';
import type { ExecutionEvent } from '../types.js';
import {
  EVENT_SEGMENT_EVENTS, compareEventSeqs, decodeEventSegment, eventSegment, eventsSince, planEventAppend, segmentBefore,
} from './events.js';

/** A task started, numbered. */
function started(seq: bigint, task = 'etl'): ExecutionEvent {
  return variant('task_started', { seq, timestamp: new Date(1_000), task });
}

/** `count` events numbered from `from`. */
function numbered(from: number, count: number): ExecutionEvent[] {
  return Array.from({ length: count }, (_, i) => started(BigInt(from + i)));
}

const sameEvents = equalFor(ArrayType(ExecutionEventType));
const printEvents = printFor(ArrayType(ExecutionEventType));
const sameSeqs = equalFor(ArrayType(IntegerType));
const printSeqs = printFor(ArrayType(IntegerType));

/** Segments in memory, as the plans leave them, with the reads made of them. */
class Segments {
  readonly held = new Map<bigint, Uint8Array>();
  reads: bigint[] = [];

  keys(): bigint[] {
    return [...this.held.keys()].sort(compareEventSeqs);
  }

  read = (first: bigint): Promise<Uint8Array | null> => {
    this.reads.push(first);
    return Promise.resolve(this.held.get(first) ?? null);
  };

  append(events: readonly ExecutionEvent[]): void {
    const keys = this.keys();
    const before = segmentBefore(keys, events);
    const bytes = before === null ? undefined : this.held.get(before);
    const { remove, put } = planEventAppend(keys, before === null || bytes === undefined ? null : { first: before, bytes }, events);
    for (const first of remove) this.held.delete(first);
    for (const segment of put) this.held.set(segment.first, segment.bytes);
  }
}

function assertKeys(segments: Segments, expected: bigint[], what: string): void {
  const keys = segments.keys();
  assert.ok(sameSeqs(keys, expected), `${what}: ${printSeqs(keys)}`);
}

function assertEvents(read: readonly ExecutionEvent[], expected: readonly ExecutionEvent[], what: string): void {
  assert.ok(sameEvents([...read], [...expected]), `${what}: ${printEvents([...read])}`);
}

describe('a run\'s events in segments', () => {
  it('fill the segment last written, a thousand at most, and go on in another under its first event', () => {
    const segments = new Segments();
    segments.append(numbered(1, 600));
    segments.append(numbered(601, 600));
    assertKeys(segments, [1n, 1_001n], 'a full segment, and the rest');
    assert.equal(decodeEventSegment(segments.held.get(1n)!).length, EVENT_SEGMENT_EVENTS);
    assert.equal(decodeEventSegment(segments.held.get(1_001n)!).length, 200);

    segments.append(numbered(1_201, 5));
    assertKeys(segments, [1n, 1_001n], 'the last segment filled');
    assert.equal(decodeEventSegment(segments.held.get(1_001n)!).length, 205);
  });

  it('take an append\'s events for what they hold from its first event on: the segments after removed, the one holding it cut', async () => {
    const segments = new Segments();
    segments.append(numbered(1, 2_500));
    assertKeys(segments, [1n, 1_001n, 2_001n], 'three segments');

    segments.append([started(1_500n, 'again')]);
    assertKeys(segments, [1n, 1_001n], 'the segment after it removed');
    assertEvents(await eventsSince(segments.keys(), segments.read, 0n), [...numbered(1, 1_499), started(1_500n, 'again')], 'the held events before it, then it');

    // A full segment holding the first new event is cut there, and filled
    // again.
    const full = new Segments();
    full.append(numbered(1, 1_000));
    full.append([started(1_000n, 'again')]);
    assertKeys(full, [1n], 'the segment cut and filled');
    assertEvents(await eventsSince(full.keys(), full.read, 0n), [...numbered(1, 999), started(1_000n, 'again')], 'none held twice');

    // One of more than a thousand, as another writer may leave, cut with no
    // room left, is written alone, and the new events start one of their own.
    const large = new Segments();
    large.held.set(1n, eventSegment(numbered(1, 1_200)).bytes);
    large.append([started(1_100n, 'again')]);
    assertKeys(large, [1n, 1_100n], 'the segment cut, and one of the new event');
    assertEvents(await eventsSince(large.keys(), large.read, 0n), [...numbered(1, 1_099), started(1_100n, 'again')], 'none held twice');
  });

  it('leave a segment of another form as it is, and start the new events in one of their own', () => {
    const segments = new Segments();
    const other = encodeBeast2For(IntegerType)(1n);
    segments.held.set(1n, other);
    segments.append([started(2n)]);
    assertKeys(segments, [1n, 2n], 'a segment of its own');
    assert.equal(segments.held.get(1n), other, 'the other form\'s left as it is');
  });

  it('read past a cursor from the segment that holds its next event, and no earlier one, up to a limit', async () => {
    const segments = new Segments();
    segments.append(numbered(1, 2_500));

    segments.reads = [];
    assertEvents(await eventsSince(segments.keys(), segments.read, 1_500n, 10), numbered(1_501, 10), 'ten past the cursor');
    assert.ok(sameSeqs(segments.reads, [1_001n]), `the segment holding the next event alone: ${printSeqs(segments.reads)}`);

    segments.reads = [];
    assert.equal((await eventsSince(segments.keys(), segments.read, 1_000n)).length, 1_500);
    assert.ok(sameSeqs(segments.reads, [1_001n, 2_001n]), `from the segment starting at the next event: ${printSeqs(segments.reads)}`);

    segments.reads = [];
    assertEvents(await eventsSince(segments.keys(), segments.read, 2_500n), [], 'none past the last');
    assertEvents(await eventsSince([], segments.read, 0n), [], 'none of a run with none');
  });
});
