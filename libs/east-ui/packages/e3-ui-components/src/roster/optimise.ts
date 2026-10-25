/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Optimise in the Roster (#1409, #1421; `Optimise Spec.md` §5.1, §9.5, R23):
 * the week in view as the run's request — the week's duties by key, the
 * app's own rows as the session holds them, drafts in place; the week's
 * targets by slot; and the complete staff and configuration — and the result
 * landed on the week's duties as one edit: the diff by key, recorded as one
 * step (`ScheduleEditing.record`, origin `optimise`), and what the landing
 * draws kept until Apply — each duty's operation and its provenance, on the
 * People view's tiles and the Shifts view's chips alike, and the people whose
 * hours the latest run changed. While a run is out the commands are locked
 * (R2): every gesture refused in the one reason, the week's drafts kept.
 *
 * @packageDocumentation
 */

import { SortedMap, StringType, type EastType } from "@elaraai/east";
import { RosterOptimiseRequestTypeFor, RosterOptimiseResultTypeFor } from "@elaraai/e3-ui/internal";
import { optimiseMessages, type Formatters } from "@elaraai/east-ui-components";
import { diffOptimiseRows, optimiseIdOf } from "../shared/func/optimise-diff.js";
import type { OptimiseCounts } from "../shared/func/use-optimise.js";
import type { RosterCommands } from "./actions.js";
import type { RosterEditing } from "./editing.js";
import {
    compareString, dayOfSlot, hourText, ownTimes, shiftOf, weekSpan, type Assignment, type Context, type Requirement, type RosterDomain, type RosterValue, type Slot, type Week,
} from "./model.js";

/** The week's duties by key, as the request and the result carry them: the app's own rows. */
export type RosterOptimiseRows = SortedMap<string, unknown>;

/** The run's request: the week, the run's number, the week's duties by key, its targets by slot, and the complete configuration. */
export interface RosterOptimiseRequest {
    readonly from: Date;
    readonly to: Date;
    readonly run: bigint;
    readonly duties: RosterOptimiseRows;
    readonly requirements: ReadonlyMap<Slot, Requirement>;
    readonly context: Context;
}

/** The run's answer: the week's duties by key, complete. */
export interface RosterOptimiseResult {
    readonly duties: RosterOptimiseRows;
}

/** One operation a run left on a duty, until Apply (R17): what it did, the run that made it, and what its hover says. */
export interface RosterDutyOp {
    readonly op: "add" | "chg" | "del";
    /** The run's number, formatted. */
    readonly run: string;
    /** `Added by Elara · run #7`, `Was Mon Early · Elara run #7`, or `Removed by Elara · run #7`. */
    readonly provenance: string;
}

/**
 * What the runs left on the Roster's duties, until Apply (R17): each duty's
 * operation, a later run's over an earlier's on the same duty — a removed
 * duty's drawn on its tombstone, struck, for the highlight — and the people
 * whose week the latest run changed, whose hours and meter flash.
 */
export interface RosterOptimised {
    readonly ops: ReadonlyMap<string, RosterDutyOp>;
    readonly people: ReadonlySet<string>;
}

/**
 * The request and result types over the app's duty row type: what the bound
 * optimiser is called with, as the tag held it to.
 *
 * @param rowType - The duty kind's row type
 * @returns The request and result East types
 */
export function rosterOptimiseTypes(rowType: EastType): { request: EastType; result: EastType } {
    return { request: RosterOptimiseRequestTypeFor(rowType), result: RosterOptimiseResultTypeFor(rowType) };
}

/**
 * The run's request (R1, R23, O3, O5): the week in view, the run's number,
 * the week's duties by key as the session holds them — the base with every
 * unapplied draft in place, every row whatever the rail shows — its targets
 * by slot, and the complete staff and configuration.
 *
 * @param start - The week's first day
 * @param week - The week as drafted: each duty's row is the app's own
 * @param context - Every person and the configuration
 * @param run - The run's number
 * @returns The request
 */
export function rosterOptimiseRequest(start: Date, week: Week, context: Context, run: number): RosterOptimiseRequest {
    const duties: RosterOptimiseRows = new SortedMap([], compareString);
    for (const [id, a] of week.assignments) duties.set(id, a.row);
    return { from: start, to: weekSpan(start).to, run: BigInt(run), duties, requirements: week.requirements, context };
}

/**
 * Where a duty stands, as its provenance says it: its day and its shift, and
 * its own times where they differ from the shift's — `Mon Early`, `Mon Early
 * 07–15`.
 *
 * @param value - The payload: the shifts
 * @param format - The app's formatters
 * @param a - The duty
 * @param start - The week's first day
 * @returns The words
 */
export function rosterDutyWords(value: RosterValue, format: Pick<Formatters, "weekday">, a: Assignment, start: Date): string {
    const shift = shiftOf(value, a.slot.shift)?.label ?? a.slot.shift;
    return `${format.weekday(dayOfSlot(start, a.slot))} ${shift}${ownTimes(value, a, start) ? ` ${hourText(a.start)}–${hourText(a.end)}` : ""}`;
}

/** What a landing is made over. */
export interface RosterLanding {
    readonly value: RosterValue;
    readonly domain: RosterDomain;
    /** The editing the step is recorded in. */
    readonly editing: RosterEditing;
    readonly request: RosterOptimiseRequest;
    readonly result: RosterOptimiseResult;
    /** The step's label — `Elara run #7`. */
    readonly label: string;
    /** The run's number, formatted, for the provenance. */
    readonly runText: string;
    /** The week as drafted before the run: what the provenance says a duty was, and whose week it was. */
    readonly week: Week;
    /** The week's first day. */
    readonly start: Date;
    readonly context: Context;
    /** The app's formatters, for the provenance's words. */
    readonly format: Pick<Formatters, "weekday">;
    /** What earlier runs left on the duties, still the session's drafts. */
    readonly before: RosterOptimised | undefined;
}

/**
 * The result landed (R7, R8, R10, §12): diffed against the request by key
 * and recorded as one step of the history, origin `optimise`. A duty the
 * result adds is an add — Off → shift; one it changes is a change — shift →
 * another, or its own times; one it drops is a remove — shift → Off, its
 * tombstone struck for the highlight (§9.5). A result that changes nothing
 * records nothing and leaves what earlier runs left as it is (R10); one that
 * does lays its operations over theirs.
 *
 * @param args - What the landing is made over
 * @returns What the run counted, and what the runs have left on the duties — unchanged by a run that changed nothing; `undefined` for a result the session would not take
 */
export function landRosterOptimise(args: RosterLanding): { counts: OptimiseCounts; optimised: RosterOptimised | undefined } | undefined {
    const { value, domain, editing, request, result, label, runText, week, start, context, format, before } = args;
    const kind = value.duty.kind.key;
    const diff = diffOptimiseRows(kind, domain.rowType, optimiseIdOf<string>(StringType), request.duties, result.duties);
    if (diff.changes.length === 0) return { counts: diff.counts, optimised: undefined };
    if (!editing.schedule.record(diff.changes, "optimise", label)) return undefined;
    // This run's operations over the earlier runs': a duty it touched again is its.
    const ops = new Map<string, RosterDutyOp>(before?.ops ?? []);
    const people = new Set<string>();
    for (const [key, op] of diff.ops) {
        const id = key.slice(kind.length + 1);
        const was = week.assignments.get(id);
        if (was?.who.type === "person") people.add(was.who.value);
        if (op.op === "del") {
            ops.set(id, { op: "del", run: runText, provenance: optimiseMessages.ghostRemoved({ run: runText }) });
            continue;
        }
        // The duty as the Roster reads the row now: whose week it is in.
        const placed = domain.placement(value.duty.read(domain.encodeRow(op.row), id), op.row, id, start, context);
        if (placed.type === "placed" && placed.value.who.type === "person") people.add(placed.value.who.value);
        if (op.op === "add" || was === undefined) {
            ops.set(id, { op: "add", run: runText, provenance: optimiseMessages.entryAdded({ run: runText }) });
            continue;
        }
        ops.set(id, { op: "chg", run: runText, provenance: optimiseMessages.entryChanged({ previous: rosterDutyWords(value, format, was, start), run: runText }) });
    }
    return { counts: diff.counts, optimised: { ops, people } };
}

/**
 * The commands while a run is out (R2): every gesture refused with the one
 * reason — `Elara is optimising W11` — the week's drafts kept, so the views
 * keep drawing them while nothing is written; Publish off. The reason is
 * `locked`, so the week's controls stay in place, inert, rather than reading
 * as a week with no edit.
 *
 * @param commands - The commands
 * @param refusal - Why a gesture is refused
 * @returns The commands, locked
 */
export function lockRosterCommands(commands: RosterCommands, refusal: string): RosterCommands {
    const refused = () => refusal;
    const nothing = () => undefined;
    return {
        ...commands, available: false, availableIn: () => false, editable: false, locked: refusal,
        place: refused, update: refused, activity: refused, sets: refused, field: refused, row: refused, requirement: refused, targetRow: refused,
        accept: refused, fix: refused, pattern: refused, applyPattern: refused,
        remove: nothing, restore: nothing, reject: nothing, copy: nothing, publish: nothing,
    };
}
