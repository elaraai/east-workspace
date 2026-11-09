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
 * An optimiser that takes the week's edges (#1553) is also asked the duties
 * the window holds that the Roster places in another week, as the session
 * holds them, and which of them are fixed — their period takes no edit — and
 * its answer's edges are diffed with the week's duties as one. An answer that
 * would change what a gesture could not — a fixed duty changed or removed, a
 * duty put in a period that takes no edit or beyond the weeks either side, a
 * key given twice — is refused, naming the duty, and records nothing.
 *
 * @packageDocumentation
 */

import { SortedMap, SortedSet, StringType, type EastType } from "@elaraai/east";
import { RosterOptimiseRequestTypeFor, RosterOptimiseResultTypeFor } from "@elaraai/e3-ui/internal";
import { optimiseMessages, type Formatters } from "@elaraai/east-ui-components";
import { diffOptimiseRows, optimiseIdOf, type OptimiseDiff } from "../shared/func/optimise-diff.js";
import type { OptimiseCounts, OptimiseRefused } from "../shared/func/use-optimise.js";
import type { RosterCommands } from "./actions.js";
import type { RosterEditing } from "./editing.js";
import type { RosterOptimiseWords } from "./messages.js";
import {
    compareDate, compareString, dayOfSlot, groupName, hourText, ownTimes, shiftOf, weekSpan, weekWindow, type Assignment, type Context, type DraftedDuty, type Requirement,
    type Roles, type RosterDomain, type RosterValue, type Slot, type StoredDuty, type Week,
} from "./model.js";
import { assignmentName } from "./views.js";

/** The week's duties by key, as the request and the result carry them: the app's own rows. */
export type RosterOptimiseRows = SortedMap<string, unknown>;

/**
 * The run's request: the week, the run's number, the week's duties by key, its targets by slot, and the complete
 * configuration — and for an optimiser that takes them (#1553), the duties at the week's edges and which are fixed.
 */
export interface RosterOptimiseRequest {
    readonly from: Date;
    readonly to: Date;
    readonly run: bigint;
    readonly duties: RosterOptimiseRows;
    /** The window's duties the Roster places in another week, by key, as the session holds them. */
    readonly edges?: RosterOptimiseRows;
    /** The keys of those whose period takes no edit: the answer leaves them as they are. */
    readonly fixed?: SortedSet<string>;
    readonly requirements: ReadonlyMap<Slot, Requirement>;
    readonly context: Context;
}

/** The run's answer: the week's duties by key, complete — and for an optimiser that takes them, the edges as it leaves them (#1553). */
export interface RosterOptimiseResult {
    readonly duties: RosterOptimiseRows;
    readonly edges?: RosterOptimiseRows;
}

/**
 * Where the Roster would place a duty's row among the weeks a run with the edges reaches (#1553) — the week and the weeks
 * either side, each with its periods as the session holds them: placed, in the week it falls in, at its place there, and
 * whether its period takes edits; a row it cannot place, in the week its day falls in, which takes it while every period
 * of that week does — it lands as that week's issue; or beyond them, `at` its start.
 */
export type RosterReached =
    | { readonly type: "placed"; readonly start: Date; readonly assignment: Assignment; readonly open: boolean }
    | { readonly type: "unplaced"; readonly start: Date; readonly at: Date; readonly open: boolean }
    | { readonly type: "beyond"; readonly at: Date };

/** Where the Roster would place a duty's row, by its key (see {@link RosterReached}). */
export type RosterReach = (row: unknown, key: string) => RosterReached;

/** A duty at the week's edges as a run with the edges asked it (#1553): its row as the session held it, where it stood, and whether it is fixed. */
export interface RosterEdgeDuty {
    readonly row: unknown;
    readonly reached: RosterReached;
    /** Whether its period takes no edit — or the Roster can place it in none it holds — so the answer leaves it as it is. */
    readonly fixed: boolean;
}

/** The duties at the week's edges, by key (#1553). */
export type RosterEdges = SortedMap<string, RosterEdgeDuty>;

const NO_ROWS: RosterOptimiseRows = new SortedMap([], compareString);

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

/**
 * The request and result types over the app's duty row type: what the bound
 * optimiser is called with, as the tag held it to — the form with the week's
 * edges where its function takes them (#1553).
 *
 * @param rowType - The duty kind's row type
 * @param edges - Whether the optimiser takes the duties at the week's edges
 * @returns The request and result East types
 */
export function rosterOptimiseTypes(rowType: EastType, edges: boolean): { request: EastType; result: EastType } {
    return edges ? { request: RosterOptimiseRequestTypeFor(rowType, { edges: true }), result: RosterOptimiseResultTypeFor(rowType, { edges: true }) }
        : { request: RosterOptimiseRequestTypeFor(rowType), result: RosterOptimiseResultTypeFor(rowType) };
}

/**
 * Whether a duty stands in the week's window as the window's read takes one (#1553): overlapping it, half open — its
 * start before the window's end and its end after the window's start — or an instant from its start.
 *
 * @param roles - The duty's roles
 * @param window - The window
 * @returns Whether the window holds it
 */
function inWindow(roles: Pick<Roles, "start" | "end">, window: { from: Date; to: Date }): boolean {
    return compareDate(roles.start, window.to) < 0 && (compareDate(roles.end, window.from) > 0 || compareDate(roles.start, window.from) >= 0);
}

/**
 * The duties at the week's edges (#1553): every duty the week's window holds — the week, and the twelve hours either
 * side — that the Roster places in another week, as the session holds it: a stored one a draft holds in its draft's
 * place, one a draft removes absent, and a drafted one where its draft puts it. Each is fixed where its period takes no
 * edit, or the Roster places it in no period it holds.
 *
 * @param args - The duty row type's domain, the window's stored duties, every draft of the session, the week's first day, the configuration, and where a row would stand
 * @returns The duties at the week's edges, by key
 */
export function rosterEdges(args: {
    domain: RosterDomain; stored: ReadonlyMap<string, StoredDuty>; drafts: ReadonlyMap<string, DraftedDuty | undefined>; start: Date; context: Context; reach: RosterReach;
}): RosterEdges {
    const { domain, stored, drafts, start, context, reach } = args;
    const window = weekWindow(start);
    const edges: RosterEdges = new SortedMap([], compareString);
    const consider = (key: string, roles: Roles, row: unknown) => {
        if (!inWindow(roles, window) || domain.placement(roles, row, key, start, context).type !== "elsewhere") return;
        const reached = reach(row, key);
        edges.set(key, { row, reached, fixed: reached.type === "beyond" || !reached.open });
    };
    for (const [key, duty] of stored) if (!drafts.has(key)) consider(key, duty.roles, duty.row);
    for (const [key, draft] of drafts) if (draft !== undefined) consider(key, draft.roles, draft.row);
    return edges;
}

/**
 * The run's request (R1, R23, O3, O5): the week in view, the run's number,
 * the week's duties by key as the session holds them — the base with every
 * unapplied draft in place, every row whatever the rail shows — its targets
 * by slot, and the complete staff and configuration; for an optimiser that
 * takes them, the duties at the week's edges by key and the keys of those
 * fixed (#1553).
 *
 * @param start - The week's first day
 * @param week - The week as drafted: each duty's row is the app's own
 * @param context - Every person and the configuration
 * @param run - The run's number
 * @param edges - The duties at the week's edges ({@link rosterEdges}), for an optimiser that takes them
 * @returns The request
 */
export function rosterOptimiseRequest(start: Date, week: Week, context: Context, run: number, edges?: RosterEdges): RosterOptimiseRequest {
    const duties: RosterOptimiseRows = new SortedMap([], compareString);
    for (const [id, a] of week.assignments) duties.set(id, a.row);
    const asked = { from: start, to: weekSpan(start).to, run: BigInt(run), duties, requirements: week.requirements, context };
    if (edges === undefined) return asked;
    const rows: RosterOptimiseRows = new SortedMap([], compareString);
    const fixed = new SortedSet<string>([], compareString);
    for (const [key, edge] of edges) {
        rows.set(key, edge.row);
        if (edge.fixed) fixed.add(key);
    }
    return { ...asked, edges: rows, fixed };
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

/** A run with the edges' landing (#1553): what it asked of the edges, where a row would stand now, whether the periods are days, and a refusal's words. */
export interface RosterEdgesLanding {
    /** The duties at the week's edges as the request asked them. */
    readonly asked: RosterEdges;
    /** Where a row would stand, as the periods stand as the result lands. */
    readonly reach: RosterReach;
    /** Whether the periods are days: what a refusal names a period. */
    readonly days: boolean;
    readonly m: RosterOptimiseWords;
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
    /** The app's formatters, for the provenance's and a refusal's words. */
    readonly format: Pick<Formatters, "weekday" | "monthDay" | "weekdayDate">;
    /** What earlier runs left on the duties, still the session's drafts. */
    readonly before: RosterOptimised | undefined;
    /** A run with the week's edges (#1553); `undefined` for a run without, which lands as it always has. */
    readonly edges: RosterEdgesLanding | undefined;
}

/** What a landing counted, and what the runs have left on the duties. */
export interface RosterLanded {
    readonly counts: OptimiseCounts;
    readonly optimised: RosterOptimised | undefined;
}

/**
 * Why a run with the edges' answer is refused (#1553), if it is: it changes or removes a duty it may not — a fixed one,
 * or one where it stands now in a period that takes no edit — or puts a duty in such a period or beyond the weeks either
 * side, as a gesture would be refused there. The first such operation names its duty.
 *
 * @param args - What the landing is made over
 * @param edges - The run's edges
 * @param diff - The answer's diff against the request
 * @returns The refusal's words; `undefined` for an answer the Roster takes
 */
function edgesRefusal(args: RosterLanding, edges: RosterEdgesLanding, diff: OptimiseDiff): string | undefined {
    const { value, format } = args;
    const kind = value.duty.kind.key;
    const unit = edges.days ? "day" : "week";
    for (const [key, op] of diff.ops) {
        const id = key.slice(kind.length + 1);
        if (op.op !== "add") {
            // What it changes or removes: one the request held fixed, or one whose period has closed since.
            const asked = edges.asked.get(id);
            const was = edges.reach(op.previous, id);
            if (asked?.fixed === true || was.type === "beyond" || !was.open) {
                return edges.m.optimiseFixed({ duty: rosterDutyName(value, format, asked?.reached ?? was), removes: op.op === "del", unit });
            }
        }
        if (op.op === "del") continue;
        // Where it puts a duty: the week, or a period of the weeks either side that takes edits.
        const now = edges.reach(op.row, id);
        if (now.type === "beyond") return edges.m.optimiseBeyond({ duty: rosterDutyName(value, format, now) });
        if (!now.open) return edges.m.optimiseClosed({ duty: rosterDutyName(value, format, now), unit });
    }
    return undefined;
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
 * A run with the week's edges (#1553) diffs the week's duties and its edges
 * as one, each edge duty's provenance said where it stood in its own week —
 * and an answer giving a key twice, or changing what a gesture could not
 * ({@link edgesRefusal}), is refused, naming the duty, recording nothing.
 *
 * @param args - What the landing is made over
 * @returns What the run counted, and what the runs have left on the duties — unchanged by a run that changed nothing; a refusal's words for an answer the Roster refuses; `undefined` for a result the session would not take
 */
export function landRosterOptimise(args: RosterLanding): RosterLanded | OptimiseRefused | undefined {
    const { value, domain, editing, request, result, label, runText, week, start, context, format, before, edges } = args;
    const kind = value.duty.kind.key;
    let asked = request.duties, answered = result.duties;
    if (edges !== undefined) {
        // The week's duties and its edges, as one: the request's are apart by construction, and the answer's must be.
        asked = new SortedMap(request.duties, compareString);
        for (const [key, row] of request.edges ?? NO_ROWS) asked.set(key, row);
        answered = new SortedMap(result.duties, compareString);
        for (const [key, row] of result.edges ?? NO_ROWS) {
            if (answered.has(key)) return { refused: edges.m.optimiseTwice({ duty: rosterDutyName(value, format, edges.reach(row, key)) }) };
            answered.set(key, row);
        }
    }
    const diff = diffOptimiseRows(kind, domain.rowType, optimiseIdOf<string>(StringType), asked, answered);
    const refused = edges === undefined ? undefined : edgesRefusal(args, edges, diff);
    if (refused !== undefined) return { refused };
    if (diff.changes.length === 0) return { counts: diff.counts, optimised: undefined };
    if (!editing.schedule.record(diff.changes, "optimise", label)) return undefined;
    // This run's operations over the earlier runs': a duty it touched again is its.
    const ops = new Map<string, RosterDutyOp>(before?.ops ?? []);
    const people = new Set<string>();
    for (const [key, op] of diff.ops) {
        const id = key.slice(kind.length + 1);
        // What the duty was: the week's, or one at its edges where it stood in its own week (#1553).
        const edge = edges?.asked.get(id)?.reached;
        const was = week.assignments.get(id) ?? (edge?.type === "placed" ? edge.assignment : undefined);
        const wasStart = edge?.type === "placed" && !week.assignments.has(id) ? edge.start : start;
        if (was?.who.type === "person") people.add(was.who.value);
        if (op.op === "del") {
            ops.set(id, { op: "del", run: runText, provenance: optimiseMessages.ghostRemoved({ run: runText }) });
            continue;
        }
        // The duty as the Roster reads the row now: whose week it is in — the week's, or with the edges any it reaches.
        let now: Assignment | undefined;
        if (edges === undefined) {
            const placed = domain.placement(value.duty.read(domain.encodeRow(op.row), id), op.row, id, start, context);
            now = placed.type === "placed" ? placed.value : undefined;
        } else {
            const reached = edges.reach(op.row, id);
            now = reached.type === "placed" ? reached.assignment : undefined;
        }
        if (now?.who.type === "person") people.add(now.who.value);
        if (op.op === "add" || was === undefined) {
            ops.set(id, { op: "add", run: runText, provenance: optimiseMessages.entryAdded({ run: runText }) });
            continue;
        }
        ops.set(id, { op: "chg", run: runText, provenance: optimiseMessages.entryChanged({ previous: rosterDutyWords(value, format, was, wasStart), run: runText }) });
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
