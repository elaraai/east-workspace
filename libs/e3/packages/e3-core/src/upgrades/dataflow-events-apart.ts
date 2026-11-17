/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository upgrade that moves stored dataflow runs' events out of their
 * states: a store keeps a run's events apart from its state, so a write of the
 * state costs what the run holds, not what it has done, and a poll reads the
 * events past its cursor, not the state.
 *
 * The state's type is unchanged: its `events` hold those the run added since
 * the state was last written, which a stored state holds none of. A run an
 * earlier release stored holds every event it recorded in its state, so the
 * step writes them apart, through the run's store, in segments of the form it
 * reads them in, and then the state without them.
 *
 * The state's form is the one the step before it wrote, frozen with that step:
 * the step reads and writes it, however the state changes after.
 *
 * @packageDocumentation
 */

import { IntegerType, encodeBeast2For, lessFor } from '@elaraai/east';
import type { RepositoryUpgrade } from '../storage/interfaces.js';
import { DataflowStateWithForceTasksType } from './dataflow-force-tasks.js';
import { storedFormReader } from './forms.js';
import { workStoredRunsInParts } from './parts.js';

const encodeState = encodeBeast2For(DataflowStateWithForceTasksType);
/** A segment of a run's events: an array of events of the state's form. */
const encodeSegment = encodeBeast2For(DataflowStateWithForceTasksType.fields.events);

/** The most events the step writes to a segment, as a store writes them. */
const SEGMENT_EVENTS = 1_000;

/** Whether one sequence number comes before another. */
const seqBefore = lessFor(IntegerType);

/** The name a repository's record keeps once the upgrade is applied. */
export const DATAFLOW_EVENTS_APART = 'dataflow-events-apart';

/** A stored run of the state's form, or null for bytes of any other form, or
 *  that do not decode. */
const stateOf = storedFormReader(DataflowStateWithForceTasksType);

/**
 * Moves every stored dataflow run's events out of its state: writes them
 * apart, through the run's store (`StoredRunState.writeEvents`), and the
 * state without them, numbering its last event.
 *
 * @remarks
 * Every run is read as it is stored, a workspace at a time
 * ({@link workStoredRunsInParts}). A run whose state holds no events is left
 * as it is, and so is one of another form, which a crash or a failing disk
 * left. The events go first, in segments of at most a thousand, each under its
 * first event, so a step a crash cut short between them and the state writes
 * them again over themselves.
 */
export const dataflowEventsApart: RepositoryUpgrade = {
  name: DATAFLOW_EVENTS_APART,
  apply: (storage, repo, at, until) => workStoredRunsInParts(storage, repo, at, until, async (stored) => {
    const state = stateOf(stored.bytes);
    if (state === null || state.events.length === 0) return;
    for (let from = 0; from < state.events.length; from += SEGMENT_EVENTS) {
      const events = state.events.slice(from, from + SEGMENT_EVENTS);
      await stored.writeEvents(state.id, { first: events[0]!.value.seq, last: events.at(-1)!.value.seq, bytes: encodeSegment(events) });
    }
    const last = state.events.at(-1)!.value.seq;
    await stored.replace(encodeState({ ...state, events: [], eventSeq: seqBefore(state.eventSeq, last) ? last : state.eventSeq }));
  }),
};
