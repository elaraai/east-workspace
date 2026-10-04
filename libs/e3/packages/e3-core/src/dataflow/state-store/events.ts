/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A run's events as a store keeps them, apart from its state: in segments of
 * consecutive events, each keyed by its first event's sequence number and
 * holding the beast2 bytes of an array of events, in the form the release that
 * wrote it wrote.
 *
 * @remarks
 * A write of a run's state appends the events the run added since its last
 * write, filling the segment it last wrote, up to a thousand events, and
 * starting another after: so a write costs a segment at most, and a poll reads
 * the segments past its cursor. An append whose first event a held segment
 * already numbers — a run taken up after a crash between the write of its
 * events and the write of its state — replaces what the store holds from that
 * event on.
 *
 * @packageDocumentation
 */

import {
  ArrayType, IntegerType, decodeBeast2For, encodeBeast2For, equalFor, isTypeValueEqual, lessFor, readBeast2Type, toEastTypeValue,
} from '@elaraai/east';
import { ExecutionEventType, lastEventSeq } from '@elaraai/e3-types';
import type { DataflowExecutionState, ExecutionEvent } from '../types.js';

/** The most events a store writes to one segment. */
export const EVENT_SEGMENT_EVENTS = 1_000;

/**
 * A segment of a run's events, as a store keeps it.
 */
export interface EventSegment {
  /** The sequence number of its first event, which keys it */
  readonly first: bigint;
  /** The sequence number of its last event */
  readonly last: bigint;
  /** Its events, as stored: an array of events, in beast2 */
  readonly bytes: Uint8Array;
}

/**
 * The segments of a run's events a store writes and removes to append events,
 * in that order: removes first, then writes.
 */
export interface EventAppend {
  /** The keys of the segments it removes: each a first event's sequence
   *  number */
  readonly remove: readonly bigint[];
  /** The segments it writes, each over any it holds under its key */
  readonly put: readonly EventSegment[];
}

const EventsType = ArrayType(ExecutionEventType);
const EVENTS_TYPE = toEastTypeValue(EventsType);
const encodeEvents = encodeBeast2For(EventsType);
const decodeEvents = decodeBeast2For(EventsType);

/** Whether one sequence number comes before another. */
const seqBefore = lessFor(IntegerType);
/** Whether two sequence numbers are one. */
const sameSeq = equalFor(IntegerType);

/**
 * A run's state as a store keeps it: without its events, which it keeps
 * apart, numbering the last of them ({@link lastEventSeq}).
 *
 * @param state - The run's state, with the events a write hands the store
 * @returns The state the store keeps
 */
export function stateWithoutEvents(state: DataflowExecutionState): DataflowExecutionState {
  return { ...state, events: [], eventSeq: lastEventSeq(state) };
}

/**
 * A segment of events, in this release's form.
 *
 * @param events - The events, consecutive and in order: at least one
 * @returns The segment
 */
export function eventSegment(events: readonly ExecutionEvent[]): EventSegment {
  return { first: events[0]!.value.seq, last: events.at(-1)!.value.seq, bytes: encodeEvents([...events]) };
}

/** A segment's events in this release's form; null for bytes of another
 *  form, whose header names another type. */
function eventsOf(bytes: Uint8Array): ExecutionEvent[] | null {
  try {
    if (!isTypeValueEqual(readBeast2Type(bytes), EVENTS_TYPE)) return null;
  } catch {
    return null;
  }
  return decodeEvents(bytes);
}

/**
 * A segment's events, as a poll reads them.
 *
 * @param bytes - The segment, as stored
 * @returns Its events
 * @throws {Error} When the segment is of another form: a release that changes
 *   the events' form ships the upgrade step that carries them into it
 */
export function decodeEventSegment(bytes: Uint8Array): ExecutionEvent[] {
  const events = eventsOf(bytes);
  if (events === null) {
    throw new Error('the run\'s events are in a form this e3 does not read — open the repository with the e3 that wrote them, or a newer one');
  }
  return events;
}

/**
 * The key of the held segment an append of events fills, or cuts: the last
 * that starts before the first new event.
 *
 * @param held - The keys of the segments the store holds of the run, in order
 * @param events - The new events, consecutive and in order
 * @returns The segment's key; null when none starts before the first new
 *   event, or there are no new events
 */
export function segmentBefore(held: readonly bigint[], events: readonly ExecutionEvent[]): bigint | null {
  if (events.length === 0) return null;
  const from = events[0]!.value.seq;
  return held.filter((first) => seqBefore(first, from)).at(-1) ?? null;
}

/**
 * The writes and removals that append events to a run's, as a store holds
 * them.
 *
 * @remarks
 * What the store holds from the first new event on is removed, and the segment
 * before it, in this release's form, is cut to the events before the first
 * new one and filled with the new events up to {@link EVENT_SEGMENT_EVENTS},
 * kept under its key; the rest go in new segments, each keyed by its first
 * event. A segment of another form is left as it is, and the new events start
 * a segment of their own.
 *
 * @param held - The keys of the segments the store holds of the run, in order
 * @param before - The held segment {@link segmentBefore} names, and its bytes;
 *   null when it names none, or the segment is gone
 * @param events - The new events, consecutive and in order
 * @returns The segments to remove, then those to write
 */
export function planEventAppend(
  held: readonly bigint[],
  before: { readonly first: bigint; readonly bytes: Uint8Array } | null,
  events: readonly ExecutionEvent[],
): EventAppend {
  if (events.length === 0) return { remove: [], put: [] };
  const from = events[0]!.value.seq;
  const remove = held.filter((first) => !seqBefore(first, from));

  // The segment before the new events, cut to them, and filled while it has
  // room; one with no room is written alone when it was cut.
  const put: EventSegment[] = [];
  let all = [...events];
  let key: bigint | null = null;
  const heldBefore = before === null ? null : eventsOf(before.bytes);
  if (before !== null && heldBefore !== null) {
    const kept = heldBefore.filter((event) => seqBefore(event.value.seq, from));
    if (kept.length < EVENT_SEGMENT_EVENTS) {
      all = [...kept, ...events];
      key = before.first;
    } else if (kept.length < heldBefore.length) {
      put.push({ ...eventSegment(kept), first: before.first });
    }
  }

  for (let at = 0; at < all.length; at += EVENT_SEGMENT_EVENTS) {
    const segment = eventSegment(all.slice(at, at + EVENT_SEGMENT_EVENTS));
    put.push(at === 0 && key !== null ? { ...segment, first: key } : segment);
  }
  // A key written again is written over, not removed.
  return { remove: remove.filter((first) => !put.some((segment) => sameSeq(segment.first, first))), put };
}

/**
 * The events a run's segments hold past a cursor, in order.
 *
 * @param held - The keys of the segments the store holds of the run, in order
 * @param read - Reads a held segment's bytes; null when it is gone
 * @param since - The cursor: only events numbered after it
 * @param limit - The most events: every one unless given
 * @returns The events
 * @throws {Error} When a segment it reads is of a form this e3 does not read
 */
export async function eventsSince(
  held: readonly bigint[],
  read: (first: bigint) => Promise<Uint8Array | null>,
  since: bigint,
  limit?: number,
): Promise<ExecutionEvent[]> {
  // The segment that holds the first event past the cursor — the last that
  // starts at or before it — and those after it.
  const next = since + 1n;
  let start = 0;
  held.forEach((first, i) => {
    if (!seqBefore(next, first)) start = i;
  });
  const found: ExecutionEvent[] = [];
  for (const first of held.slice(start)) {
    if (limit !== undefined && found.length >= limit) break;
    const bytes = await read(first);
    if (bytes === null) continue;
    for (const event of decodeEventSegment(bytes)) {
      if (!seqBefore(since, event.value.seq)) continue;
      if (limit !== undefined && found.length >= limit) break;
      found.push(event);
    }
  }
  return found;
}

/**
 * Orders sequence numbers, as a store lists the keys of a run's segments.
 *
 * @param a - A sequence number
 * @param b - Another
 * @returns Negative when `a` comes first, positive when `b` does, 0 when they
 *   are one
 */
export function compareEventSeqs(a: bigint, b: bigint): number {
  return seqBefore(a, b) ? -1 : seqBefore(b, a) ? 1 : 0;
}
