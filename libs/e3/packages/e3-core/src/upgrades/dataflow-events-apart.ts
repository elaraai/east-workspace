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

import { IntegerType, decodeBeast2For, encodeBeast2For, isTypeValueEqual, lessFor, readBeast2Type, toEastTypeValue } from '@elaraai/east';
import type { StoredRunState } from '../dataflow/state-store/interfaces.js';
import type { RepositoryUpgrade } from '../storage/interfaces.js';
import { DataflowStateWithForceTasksType } from './dataflow-force-tasks.js';
import { workInParts } from './parts.js';

/** A run's stored state, as the step reads and writes it. */
type StoredState = ReturnType<typeof decodeState>;

const STATE_TYPE = toEastTypeValue(DataflowStateWithForceTasksType);
const decodeState = decodeBeast2For(DataflowStateWithForceTasksType);
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
function stateOf(bytes: Uint8Array): StoredState | null {
  try {
    return isTypeValueEqual(readBeast2Type(bytes), STATE_TYPE) ? decodeState(bytes) : null;
  } catch {
    return null;
  }
}

/**
 * Moves every stored dataflow run's events out of its state: writes them
 * apart, through the run's store (`StoredRunState.writeEvents`), and the
 * state without them, numbering its last event.
 *
 * @remarks
 * Every run is read as it is stored, through the repository's run state store
 * (`StorageBackend.runStates`, `ExecutionStateStore.readStored`), so the
 * upgrade goes through every backend's store alike. A run whose state holds
 * no events is left as it is, and so is one of another form, which a crash or
 * a failing disk left. The events go first, in segments of at most a thousand,
 * each under its first event, so a step a crash cut short between them and the
 * state writes them again over themselves.
 *
 * A unit of the step is a workspace: every run of it the store holds. The
 * units go in the order of the workspaces' names, one at a time, and a part
 * stops between them once its time is up, with the name of the last workspace
 * it carried as its cursor.
 */
export const dataflowEventsApart: RepositoryUpgrade = {
  name: DATAFLOW_EVENTS_APART,
  async apply(storage, repo, at, until) {
    const byWorkspace = new Map<string, StoredRunState[]>();
    for (const stored of await storage.runStates(repo).readStored(repo)) {
      byWorkspace.set(stored.workspace, [...(byWorkspace.get(stored.workspace) ?? []), stored]);
    }
    const units = [...byWorkspace].map(([key, runs]) => ({ key, unit: runs }));
    return workInParts(units, at, until, 1, async (runs) => {
      for (const stored of runs) {
        const state = stateOf(stored.bytes);
        if (state === null || state.events.length === 0) continue;
        for (let from = 0; from < state.events.length; from += SEGMENT_EVENTS) {
          const events = state.events.slice(from, from + SEGMENT_EVENTS);
          await stored.writeEvents(state.id, { first: events[0]!.value.seq, last: events.at(-1)!.value.seq, bytes: encodeSegment(events) });
        }
        const last = state.events.at(-1)!.value.seq;
        await stored.replace(encodeState({ ...state, events: [], eventSeq: seqBefore(state.eventSeq, last) ? last : state.eventSeq }));
      }
    });
  },
};
