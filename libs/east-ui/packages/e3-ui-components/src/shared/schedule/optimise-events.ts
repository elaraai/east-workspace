/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A run's answer landed on a builder's event kinds (#1409, east-workspace#1622, rules 7, 8 and 11; `Optimise Spec.md`
 * §9.5) — the Calendar's and the Plan's canvas, whose events have a place in time against a backlog. Each kind's patch
 * of its record, by its slot, lands key by key on the events the page holds ({@link landOptimisePatches}); each
 * operation's event is read as its kind reads a row, as it stood and as the answer leaves it; an answer that changes an
 * event outside the window it was asked of — where the event stood, or where the answer puts it — is refused whole,
 * naming the event, and so is one that changes or removes an event its kind's own rule holds where it is (#1541, U9);
 * and each kind's operations are told by place: a backlog row the answer places is an add on the
 * canvas, a placed event it takes back a remove, a moved one a change. What a builder draws of the landing — its
 * ghosts, its provenance — is its own.
 *
 * @packageDocumentation
 */

import type { option } from "@elaraai/east";
import type { ScheduleOptimiseRecords } from "@elaraai/e3-ui/internal";
import { optimiseMessages } from "@elaraai/east-ui-components";
import { landOptimisePatches, mergeOptimiseDiffs, optimisePlacementOps, type OptimiseDiff, type OptimiseRecordPatch } from "../func/optimise-diff.js";
import type { OptimiseMissing, OptimiseRefused } from "../func/use-optimise.js";
import { placedOutside } from "./window.js";

/** An event as its kind reads a row: what a refusal names it by, and its place in time — none for a backlog row. */
export interface OptimiseEvent {
    readonly title: string;
    readonly start: option<Date>;
    readonly end: option<Date>;
    /** Whether its kind's own rule holds it where it is (#1541, U9): an answer that changes or removes it is refused. */
    readonly locked?: boolean | undefined;
}

/**
 * An operation's event, as it stood before the run and as the answer leaves it, each read as its kind reads a row:
 * `undefined` where the operation has none — an add's before, a remove's after — or its kind reads none.
 *
 * @typeParam I - The event as the builder's kinds read one
 */
export interface OptimiseEventTold<I extends OptimiseEvent> {
    readonly was: I | undefined;
    readonly now: I | undefined;
}

/**
 * The answer landed on the event kinds: every kind's landing as one diff, each operation's event, and whether the
 * backlog moved.
 *
 * @typeParam I - The event as the builder's kinds read one
 */
export interface OptimiseEventsLanded<I extends OptimiseEvent> {
    /** Every kind's landing, told by place, as one diff: one `record` across the kinds' records (R8). */
    readonly diff: OptimiseDiff<unknown>;
    /** Each operation's event as it stood and as the answer leaves it, under the operation's key (`opKey(kind, id)`). */
    readonly told: ReadonlyMap<string, OptimiseEventTold<I>>;
    /** Whether the answer moved an event into or out of the backlog: the Backlog tab's count flashes. */
    readonly backlogChanged: boolean;
}

/**
 * What an event kinds' landing is made over.
 *
 * @typeParam I - The event as the builder's kinds read one
 */
export interface OptimiseEventsLanding<I extends OptimiseEvent> {
    /** The event kinds' slots, in the builder's order. */
    readonly kinds: readonly string[];
    /** Each kind's record type, `Dict<K, R>`, by slot: what its patch is read by. */
    readonly records: ScheduleOptimiseRecords;
    /** The answer's patch of each kind's record, by slot. */
    readonly events: Readonly<Record<string, unknown>>;
    /** A row as the page holds it, read by its key where it holds none: what the answer lands on. */
    readonly held: (kind: string, id: string) => option<unknown> | undefined;
    /** A row of a kind's, as the kind reads it; `undefined` for one it reads as no event. */
    readonly eventOf: (kind: string, id: string, row: unknown) => I | undefined;
    /** The window the answer was asked of: `from`, and `to`, which it does not hold. */
    readonly window: { readonly from: Date; readonly to: Date };
    /** The window's words, which a refusal names. */
    readonly period: string;
}

/**
 * The answer's patches landed on the event kinds (see the module docs).
 *
 * @typeParam I - The event as the builder's kinds read one
 * @param args - What the landing is made over
 * @returns The landing; the events to read first, by their keys (rule 8); a refusal naming the event an answer changes
 *   outside the window (rule 11), or a locked one it changes (#1541, U9); `undefined` for an answer with no patch for a kind, or one that does not fit the
 *   events the page holds
 */
export function landOptimiseEvents<I extends OptimiseEvent>(args: OptimiseEventsLanding<I>): OptimiseEventsLanded<I> | OptimiseMissing | OptimiseRefused | undefined {
    const { kinds, records, events, held, eventOf, window, period } = args;
    const answers: OptimiseRecordPatch[] = [];
    for (const kind of kinds) {
        const record = records[kind];
        const patch = events[kind];
        if (record === undefined || patch === undefined) return undefined;
        answers.push({ kind, record, patch });
    }
    const landed = landOptimisePatches<unknown>(answers, held);
    if (landed === undefined || "missing" in landed) return landed;
    const told = new Map<string, OptimiseEventTold<I>>();
    const diffs: OptimiseDiff<unknown>[] = [];
    let backlogChanged = false;
    for (const diff of landed) {
        for (const [key, op] of diff.ops) {
            const { id } = op;
            const was = "previous" in op ? eventOf(op.kind, id, op.previous) : undefined;
            const now = "row" in op ? eventOf(op.kind, id, op.row) : undefined;
            // Outside the window it was asked of, where it stood or where the answer puts it (rule 11).
            if (placedOutside(was, window) || placedOutside(now, window)) {
                return { refused: optimiseMessages.refusedOutside({ row: (now ?? was)?.title ?? id, period }) };
            }
            // Held where it is by its kind's own rule, as it stood (#1541, U9): the answer changes it, or takes it away.
            if (was?.locked === true) return { refused: optimiseMessages.refusedLocked({ row: was.title }) };
            if (was?.start.type === "none" || now?.start.type === "none") backlogChanged = true;
            told.set(key, { was, now });
        }
        // A row's place is its kind's to read: placed, or in the backlog.
        diffs.push(optimisePlacementOps(diff, (_row, key, side) => told.get(key)?.[side]?.start.type === "some"));
    }
    return { diff: mergeOptimiseDiffs(diffs), told, backlogChanged };
}
