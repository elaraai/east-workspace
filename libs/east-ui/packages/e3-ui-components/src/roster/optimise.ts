/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Optimise in the Roster (#1409, #1421, east-workspace#1622; `Optimise Spec.md`
 * §5.1, §9.5, R23): the run's request — the period the Roster shows and what
 * kind it is (the day in Shifts' Day, the week, the month), the run's number
 * and the rail's narrowing, and no row — and its answer, a patch of the duties'
 * record, landed on the duties the page holds as one edit: each key the patch
 * touches, recorded as one step (`ScheduleEditing.record`, origin `optimise`),
 * and what the landing draws kept until Apply — each duty's operation and its
 * provenance, on the People view's tiles and the Shifts view's chips alike,
 * and the people whose hours the latest run changed. While a run is out the
 * commands are locked (R2): every gesture refused in the one reason, the
 * drafts kept.
 *
 * An optimiser that takes the edges (#1553) is also told which duties its
 * answer must leave as they are (`fixed`): those the period's window holds —
 * the period, and the twelve hours either side — whose own period takes no
 * edit, or that the Roster places in no week it holds. Its answer may change a
 * duty at an edge, in the weeks either side.
 *
 * An answer that would change what a gesture could not is refused whole,
 * naming the duty, and records nothing (rule 11): a fixed duty changed or
 * removed, a duty of a period that takes no edit, one put in such a period or
 * beyond the weeks the Roster holds — and, for an optimiser that does not take
 * the edges, a duty outside the period it was asked of, as the page holds it
 * or as the answer leaves it. A duty the answer changes that the page does not
 * hold is read by its key first (rule 8).
 *
 * @packageDocumentation
 */

import { DictType, SortedSet, StringType, variant, type EastType, type option } from "@elaraai/east";
import { RosterOptimiseRequestTypeFor, RosterOptimiseResultTypeFor } from "@elaraai/e3-ui/internal";
import { optimiseMessages, type Formatters } from "@elaraai/east-ui-components";
import { landOptimisePatches, type OptimiseDiff, type OptimiseRowRef } from "../shared/func/optimise-diff.js";
import type { OptimiseSlice } from "../shared/func/optimise-slice.js";
import type { OptimiseCounts, OptimiseRefused } from "../shared/func/use-optimise.js";
import type { RosterCommands } from "./actions.js";
import type { RosterEditing } from "./editing.js";
import type { RosterOptimiseWords } from "./messages.js";
import {
    DAY, compareDate, compareString, dayOfSlot, groupName, hourText, ownTimes, shiftOf, type Assignment, type DraftedDuty, type Roles, type RosterDomain,
    type RosterValue, type StoredDuty,
} from "./model.js";
import { assignmentName } from "./views.js";

/** The period the Roster shows, as a run asks it: its bounds, half open, and which kind it is. */
export interface RosterOptimisePeriod {
    readonly from: Date;
    readonly to: Date;
    readonly period: "day" | "week" | "month";
}

/**
 * The run's request: the period in view and its kind, the run's number and the rail's narrowing — and for an optimiser
 * that takes the edges (#1553), the keys of the duties its answer must leave as they are.
 */
export interface RosterOptimiseRequest {
    readonly from: Date;
    readonly to: Date;
    readonly period: { readonly type: "day" | "week" | "month"; readonly value: null };
    readonly run: bigint;
    readonly slice: OptimiseSlice;
    /** The keys of the duties in the period's window whose own period takes no edit: the answer leaves them as they are. */
    readonly fixed?: SortedSet<string>;
}

/** The run's answer: the patch of the duties' record. */
export interface RosterOptimiseResult {
    readonly duties: unknown;
}

/**
 * Where the Roster would place a duty's row among the weeks it holds — the span's, and for an optimiser that takes the
 * edges (#1553) the weeks either side, each with its periods as the session holds them: placed, in the week it falls in, at its place there, and
 * whether its period takes edits; a row it cannot place, in the week its day falls in, which takes it while every period
 * of that week does — it lands as that week's issue; or beyond them, `at` its start.
 */
export type RosterReached =
    | { readonly type: "placed"; readonly start: Date; readonly assignment: Assignment; readonly open: boolean }
    | { readonly type: "unplaced"; readonly start: Date; readonly at: Date; readonly open: boolean }
    | { readonly type: "beyond"; readonly at: Date };

/** Where the Roster would place a duty's row, by its key (see {@link RosterReached}). */
export type RosterReach = (row: unknown, key: string) => RosterReached;

/** One operation a run left on a duty, until Apply (R17): what it did, the run that made it, and what its hover says. */
export interface RosterDutyOp {
    readonly op: "add" | "chg" | "del";
    /** The run's number, formatted. */
    readonly run: string;
    /** `Added by Elara · run #7`, `Was Mon Early · Inbound · Elara run #7`, or `Removed by Elara · run #7`. */
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

/** What the bound optimiser is called with, as the tag held it to, and the duties' record type. */
export interface RosterOptimiseTypes {
    readonly request: EastType;
    readonly result: EastType;
    /** The duties' record type, `Dict<String, R>`: what the answer's patch is read by. */
    readonly record: DictType<EastType, EastType>;
}

/**
 * The request and result types over the app's duty row type: what the bound
 * optimiser is called with, as the tag held it to — the request with `fixed`
 * where its function takes the edges (#1553).
 *
 * @param rowType - The duty kind's row type
 * @param edges - Whether the optimiser takes the duties at the edges
 * @returns The request and result East types, and the duties' record type
 */
export function rosterOptimiseTypes(rowType: EastType, edges: boolean): RosterOptimiseTypes {
    const record = DictType(StringType, rowType);
    return { request: edges ? RosterOptimiseRequestTypeFor({ edges: true }) : RosterOptimiseRequestTypeFor(), result: RosterOptimiseResultTypeFor(record), record };
}

/**
 * Whether a duty stands in a window as a window's read takes one: overlapping it, half open — its start before the
 * window's end and its end after the window's start — or an instant from its start.
 *
 * @param roles - The duty's roles
 * @param window - The window
 * @returns Whether the window holds it
 */
function inWindow(roles: Pick<Roles, "start" | "end">, window: { from: Date; to: Date }): boolean {
    return compareDate(roles.start, window.to) < 0 && (compareDate(roles.end, window.from) > 0 || compareDate(roles.start, window.from) >= 0);
}

/**
 * The duties a run's answer must leave as they are (#1553): every duty the period's window holds — the period, and the
 * twelve hours either side — as the session holds it, a stored one a draft holds in its draft's place and one a draft
 * removes absent, whose own period takes no edit, or that the Roster places in no week it holds.
 *
 * @param args - The window's stored duties, every draft of the session, the period in view, and where a row would stand
 * @returns Their keys
 */
export function rosterFixed(args: {
    stored: ReadonlyMap<string, StoredDuty>; drafts: ReadonlyMap<string, DraftedDuty | undefined>; period: Pick<RosterOptimisePeriod, "from" | "to">; reach: RosterReach;
}): SortedSet<string> {
    const { stored, drafts, period, reach } = args;
    const window = { from: new Date(period.from.getTime() - DAY / 2), to: new Date(period.to.getTime() + DAY / 2) };
    const fixed = new SortedSet<string>([], compareString);
    const consider = (key: string, roles: Roles, row: unknown) => {
        if (!inWindow(roles, window)) return;
        const reached = reach(row, key);
        if (reached.type === "beyond" || !reached.open) fixed.add(key);
    };
    for (const [key, duty] of stored) if (!drafts.has(key)) consider(key, duty.roles, duty.row);
    for (const [key, draft] of drafts) if (draft !== undefined) consider(key, draft.roles, draft.row);
    return fixed;
}

/**
 * The run's request (R1, R23, O3; east-workspace#1622, rule 1): the period the Roster shows and its kind, the run's
 * number and the rail's narrowing — and, for an optimiser that takes the edges, the keys of the duties its answer must
 * leave as they are (#1553). No row: the function reads the duties, the targets and the staff itself, the Roster's
 * unsaved edits laid over them.
 *
 * @param period - The period in view
 * @param slice - Each rail source's narrowing now
 * @param run - The run's number
 * @param fixed - The duties the answer must leave ({@link rosterFixed}), for an optimiser that takes the edges
 * @returns The request
 */
export function rosterOptimiseRequest(period: RosterOptimisePeriod, slice: OptimiseSlice, run: number, fixed?: SortedSet<string>): RosterOptimiseRequest {
    const asked = { from: period.from, to: period.to, period: variant(period.period, null), run: BigInt(run), slice };
    return fixed === undefined ? asked : { ...asked, fixed };
}

/**
 * Where a duty stands, as its provenance says it: its day and its shift, its
 * own times where they differ from the shift's, and its group — or No group,
 * for a duty in none (#1548), which a run placing it changes alone — `Mon
 * Early · Inbound`, `Mon Early 07–15 · No group`.
 *
 * @param value - The payload: the shifts, the groups and the words
 * @param format - The app's formatters
 * @param a - The duty
 * @param start - The week's first day
 * @returns The words
 */
export function rosterDutyWords(value: RosterValue, format: Pick<Formatters, "weekday">, a: Assignment, start: Date): string {
    const shift = shiftOf(value, a.place.shift)?.label ?? a.place.shift;
    return `${format.weekday(dayOfSlot(start, a.place))} ${shift}${ownTimes(value, a, start) ? ` ${hourText(a.start)}–${hourText(a.end)}` : ""} · ${groupName(value, a.place.group)}`;
}

/**
 * A duty as a refusal names it (#1553): whose it is, its day and date, its shift — its own times where they differ —
 * and its group; one the Roster cannot place, by its start — `N. Ochre · Sat Mar 4 Night · Inbound`, `a duty starting
 * Mon, Mar 20, 2028`.
 *
 * @param value - The payload: the people, the shifts, the groups and the words
 * @param format - The app's formatters
 * @param reached - Where the duty stands
 * @returns The words
 */
export function rosterDutyName(value: RosterValue, format: Pick<Formatters, "weekday" | "monthDay" | "weekdayDate">, reached: RosterReached): string {
    if (reached.type !== "placed") return `a duty starting ${format.weekdayDate(reached.at)}`;
    const a = reached.assignment, day = dayOfSlot(reached.start, a.place);
    const shift = shiftOf(value, a.place.shift)?.label ?? a.place.shift;
    return `${assignmentName(value, a)} · ${format.weekday(day)} ${format.monthDay(day)} ${shift}${ownTimes(value, a, reached.start) ? ` ${hourText(a.start)}–${hourText(a.end)}` : ""}`
        + ` · ${groupName(value, a.place.group)}`;
}

/** What a landing is made over. */
export interface RosterLanding {
    readonly value: RosterValue;
    readonly domain: RosterDomain;
    /** The duties' record type. */
    readonly types: RosterOptimiseTypes;
    /** The editing the step is recorded in. */
    readonly editing: RosterEditing;
    /** A row as the page holds it, read by its key where it holds none: what the answer lands on. */
    readonly held: (kind: string, id: string) => option<unknown> | undefined;
    readonly request: RosterOptimiseRequest;
    readonly result: RosterOptimiseResult;
    /** The step's label — `Elara run #7`. */
    readonly label: string;
    /** The run's number, formatted, for the provenance. */
    readonly runText: string;
    /** The period's words, which a refusal names. */
    readonly period: string;
    /** The app's formatters, for the provenance's and a refusal's words. */
    readonly format: Pick<Formatters, "weekday" | "monthDay" | "weekdayDate">;
    /** What earlier runs left on the duties, still the session's drafts. */
    readonly before: RosterOptimised | undefined;
    /** Where a row would stand among the weeks the Roster holds, as their periods stand as the result lands. */
    readonly reach: RosterReach;
    /** Whether the optimiser takes the edges (#1553): its answer may change a duty outside the period, in the weeks either side. */
    readonly edges: boolean;
    /** Whether the periods are days: what a refusal names a period. */
    readonly days: boolean;
    readonly m: RosterOptimiseWords;
}

/** What a landing counted, and what the runs have left on the duties. */
export interface RosterLanded {
    readonly counts: OptimiseCounts;
    readonly optimised: RosterOptimised | undefined;
}

/** What a landing answers that is no landing: duties to read first, by their keys (rule 8). */
export interface RosterOptimiseMissing {
    readonly missing: readonly OptimiseRowRef[];
}

/**
 * Why an answer is refused (rule 11, #1553), if it is: it changes or removes a duty it may not — one the request held
 * fixed, or one whose period takes no edit as it stands now — or puts a duty in such a period or beyond the weeks the
 * Roster holds, as a gesture would be refused there; and, for an optimiser that does not take the edges, it changes a
 * duty outside the period it was asked of, as the page holds it or as the answer leaves it. The first such operation
 * names its duty.
 *
 * @param args - What the landing is made over
 * @param diff - The answer, landed on the duties the page holds
 * @returns The refusal's words; `undefined` for an answer the Roster takes
 */
function refusal(args: RosterLanding, diff: OptimiseDiff): string | undefined {
    const { value, domain, format, request, reach, edges, days, m, period } = args;
    const kind = value.duty.kind.key;
    const unit = days ? "day" : "week";
    const outside = (row: unknown, id: string): boolean => !inWindow(value.duty.read(domain.encodeRow(row), id), request);
    for (const [key, op] of diff.ops) {
        const id = key.slice(kind.length + 1);
        const was = "previous" in op ? reach(op.previous, id) : undefined;
        const now = "row" in op ? reach(op.row, id) : undefined;
        // Outside the period it was asked of: where the duty stood, or where the answer puts it. It is named as it stands
        // on the page — where it stood, among the weeks the Roster holds — else as the answer leaves it.
        if (!edges && (("previous" in op && outside(op.previous, id)) || ("row" in op && outside(op.row, id)))) {
            const named = was?.type === "placed" ? was : now?.type === "placed" ? now : (was ?? now)!;
            return optimiseMessages.refusedOutside({ row: rosterDutyName(value, format, named), period });
        }
        // What it changes or removes: one the request held fixed, or one whose period has closed since.
        if (was !== undefined && (request.fixed?.has(id) === true || was.type === "beyond" || !was.open)) {
            return m.optimiseFixed({ duty: rosterDutyName(value, format, was), removes: op.op === "del", unit });
        }
        // Where it puts a duty: a period of the weeks the Roster holds that takes edits.
        if (now === undefined) continue;
        if (now.type === "beyond") return m.optimiseBeyond({ duty: rosterDutyName(value, format, now) });
        if (!now.open) return m.optimiseClosed({ duty: rosterDutyName(value, format, now), unit });
    }
    return undefined;
}

/**
 * The result landed (R7, R8, R10, §12; east-workspace#1622, rules 7, 8, 10,
 * 11): the answer's patch landed key by key on the duties the page holds, and
 * recorded as one step of the history, origin `optimise`. A duty the answer
 * adds is an add — Off → shift; one it changes is a change — shift → another,
 * or its own times; one it drops is a remove — shift → Off, its tombstone
 * struck for the highlight (§9.5). An answer that changes nothing records
 * nothing and leaves what earlier runs left as it is (R10); one that does
 * lays its operations over theirs. One that changes what a gesture could not,
 * or a duty outside the period it was asked of ({@link refusal}), is refused,
 * naming the duty, recording nothing; one that touches a duty the page does
 * not hold names it, to be read by its key.
 *
 * @param args - What the landing is made over
 * @returns What the run counted, and what the runs have left on the duties — unchanged by a run that changed nothing;
 *   the duties to read first; a refusal's words for an answer the Roster refuses; `undefined` for an answer that does
 *   not fit the duties the page holds, or one the session would not take
 */
export function landRosterOptimise(args: RosterLanding): RosterLanded | RosterOptimiseMissing | OptimiseRefused | undefined {
    const { value, types, editing, held, result, label, runText, format, before, reach } = args;
    const kind = value.duty.kind.key;
    const landed = landOptimisePatches<unknown>([{ kind, record: types.record, patch: result.duties }], held);
    if (landed === undefined) return undefined;
    if ("missing" in landed) return { missing: landed.missing };
    // No duty is half made: every draft is a whole row.
    if ("incomplete" in landed) return undefined;
    const diff = landed[0]!;
    const refused = refusal(args, diff);
    if (refused !== undefined) return { refused };
    if (diff.changes.length === 0) return { counts: diff.counts, optimised: undefined };
    if (!editing.schedule.record(diff.changes, "optimise", label)) return undefined;
    // This run's operations over the earlier runs': a duty it touched again is its.
    const ops = new Map<string, RosterDutyOp>(before?.ops ?? []);
    const people = new Set<string>();
    for (const [key, op] of diff.ops) {
        const id = key.slice(kind.length + 1);
        // What the duty was, where it stood in its own week, and what it is now: whose weeks the run changed.
        const stood = "previous" in op ? reach(op.previous, id) : undefined;
        const was = stood?.type === "placed" ? stood : undefined;
        if (was?.assignment.who.type === "person") people.add(was.assignment.who.value);
        if (op.op === "del") {
            ops.set(id, { op: "del", run: runText, provenance: optimiseMessages.ghostRemoved({ run: runText }) });
            continue;
        }
        const stands = reach(op.row, id);
        const now = stands.type === "placed" ? stands.assignment : undefined;
        if (now?.who.type === "person") people.add(now.who.value);
        if (op.op === "add" || was === undefined) {
            ops.set(id, { op: "add", run: runText, provenance: optimiseMessages.entryAdded({ run: runText }) });
            continue;
        }
        ops.set(id, { op: "chg", run: runText, provenance: optimiseMessages.entryChanged({ previous: rosterDutyWords(value, format, was.assignment, was.start), run: runText }) });
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
        ...commands, available: false, availableOn: () => false, publishable: false, availableIn: () => false, editable: false, locked: refusal,
        place: refused, update: refused, activity: refused, sets: refused, field: refused, row: refused, requirement: refused, targetRow: refused,
        accept: refused, fix: refused, pattern: refused, applyPattern: refused,
        remove: nothing, restore: nothing, reject: nothing, copy: nothing, publish: nothing,
    };
}
