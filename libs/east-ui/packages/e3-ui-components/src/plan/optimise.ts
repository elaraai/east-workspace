/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Optimise in the Plan (#1409, #1419, east-workspace#1622; `Optimise Spec.md`
 * §5.1, §9.5, R24): the run's request — the plan window in view and the unit
 * its axis is zoomed to, the run's number and the rail's narrowing, and no row
 * — and its answer, a patch of each event kind's record by slot, landed on the
 * canvas's events as one edit: each key the patches touch, on the row the page
 * holds, kind by kind, recorded as one step (`ScheduleEditing.record`, origin
 * `optimise`), its operations told by place — backlog → placed is an add on
 * the canvas, placed → backlog a remove, a moved or re-assigned bar a change —
 * and what the landing draws kept until Apply: each element's operation and
 * provenance, and the ghosts of what stood on each row before.
 *
 * The request reads nothing the page read, so the eye waits on none of it
 * (rule 6): a kind read a cell at a time, and one past the cap of events over
 * the window, run as any other. An event the answer changes that the page does
 * not hold is read by its key before the answer lands (rule 8); one it changes
 * outside the window it was asked of refuses the answer whole (rule 11).
 *
 * @packageDocumentation
 */

import { StringType, equalFor, fromEastTypeValue, printFor, variant, type EastType, type ValueTypeOf, type option } from "@elaraai/east";
import {
    ScheduleEventRefType, ScheduleOptimiseRequestType, ScheduleOptimiseResultTypeFor, scheduleOptimiseRecords,
    type PlanPayloadType, type ScheduleOptimiseRecords,
} from "@elaraai/e3-ui/internal";
import { optimiseMessages, type Formatters } from "@elaraai/east-ui-components";
import { recordOptimiseRun, type OptimiseLanded } from "../shared/func/optimise-diff.js";
import type { OptimiseSlice } from "../shared/func/optimise-slice.js";
import type { OptimiseMissing, OptimiseRefused } from "../shared/func/use-optimise.js";
import { landOptimiseEvents } from "../shared/schedule/optimise-events.js";
import type { PlanEventEditing, PlanEventReadValue } from "./edit/events.js";
import type { PlanInstantValue } from "./instant.js";
import type { PlanRowValue } from "./model.js";
import type { PlanElementOp, PlanGhost } from "./rows/element-optimise.js";
import type { PlanResolution } from "./scale.js";

/** One event kind, as the Plan's payload carries it. */
type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];
/** One event as a kind's seams read it. */
type PlanEventItemValue = PlanEventReadValue["item"];

/** The run's request: the window, the unit the axis is zoomed to, the run's number and the rail's narrowing. */
export type PlanOptimiseRequest = ValueTypeOf<typeof ScheduleOptimiseRequestType>;

/** The run's answer: each event kind's patch of its record, by slot. */
export interface PlanOptimiseResult {
    readonly events: Readonly<Record<string, unknown>>;
}

/**
 * What the runs left on the Plan's events, until Apply (R17): each
 * element's operation, by the element's key, a later run's over an
 * earlier's; the ghosts of what stood on each row before a run, by the row's
 * key; and whether the latest run moved an event into or out of the backlog.
 */
export interface PlanOptimised {
    readonly ops: ReadonlyMap<string, PlanElementOp>;
    readonly ghosts: ReadonlyMap<string, readonly PlanGhost[]>;
    readonly backlogChanged: boolean;
}

/** An element's key: its event's ref, as East prints it — what the canvas names its elements by. */
const printEventRef = printFor(ScheduleEventRefType);
const stringEqual = equalFor(StringType);

/** A kind's key and row types, from the kind on the wire. */
function typesOf(kind: Pick<PlanEventKindValue, "editing">): { keyType: EastType; rowType: EastType } {
    return {
        keyType: kind.editing.keyType.type === "some" ? fromEastTypeValue(kind.editing.keyType.value) as EastType : StringType,
        rowType: fromEastTypeValue(kind.editing.entryType) as EastType,
    };
}

/** What the bound optimiser is called with, as the tag held it to, and each event kind's record type by slot. */
export interface PlanOptimiseTypes {
    readonly request: EastType;
    readonly result: EastType;
    /** Each event kind's record type, `Dict<K, R>`, by slot: what its patch is read by. */
    readonly records: ScheduleOptimiseRecords;
}

/**
 * The request and result types over the Plan's kinds: what the bound
 * optimiser is called with, as the tag held it to.
 *
 * @param kinds - The event kinds
 * @returns The request and result East types, and each kind's record type
 */
export function planOptimiseTypes(kinds: readonly PlanEventKindValue[]): PlanOptimiseTypes {
    const records = scheduleOptimiseRecords(kinds.map((kind) => [kind.key, typesOf(kind)] as const));
    return { request: ScheduleOptimiseRequestType, result: ScheduleOptimiseResultTypeFor(records), records };
}

/** The plan window in view, as the request carries it. */
export interface PlanOptimiseWindow { readonly from: Date; readonly to: Date }

/**
 * The run's request (R1, R24, O3; east-workspace#1622, rule 1): the plan
 * window in view and the unit its axis is zoomed to, the run's number and the
 * rail's narrowing. No row: the function reads the events it needs, the page's
 * unsaved edits laid over them. An axis zoomed to hours names a day, the
 * finest period a request names.
 *
 * @param window - The plan window in view
 * @param resolution - The unit the axis is zoomed to
 * @param slice - Each rail source's narrowing now
 * @param run - The run's number
 * @returns The request
 */
export function planOptimiseRequest(window: PlanOptimiseWindow, resolution: PlanResolution, slice: OptimiseSlice, run: number): PlanOptimiseRequest {
    return { from: window.from, to: window.to, period: variant(resolution === "hour" ? "day" : resolution, null), run: BigInt(run), slice };
}

/** Where an element stood on the canvas before a run: its row, its extent, its shape and its words. */
interface PlacedElement {
    readonly rowKey: string;
    readonly start: PlanInstantValue;
    readonly end: PlanInstantValue;
    readonly shape: PlanGhost["shape"];
    readonly label: string;
}

/**
 * Where each element stands on the canvas, by its key: what a ghost is drawn
 * from — the row that holds the element, and its extent on it.
 *
 * @param rows - The canvas's rows as it draws them, the events joined into those they land on (#1541)
 * @returns Each element's place
 */
function placedOf(rows: readonly PlanRowValue[]): Map<string, PlacedElement> {
    const out = new Map<string, PlacedElement>();
    for (const row of rows) {
        const rowKey = row.key;
        const kind = row.kind;
        switch (kind.type) {
            case "span": for (const run of kind.value.runs) out.set(run.key, { rowKey, start: run.start, end: run.end, shape: "span", label: run.label }); break;
            case "cards": for (const chip of kind.value.chips) out.set(chip.key, { rowKey, start: chip.from, end: chip.to, shape: "span", label: chip.label }); break;
            case "buckets": for (const tile of kind.value.events) out.set(tile.key, { rowKey, start: tile.at, end: tile.at, shape: "instant", label: tile.label.type === "some" ? tile.label.value : "" }); break;
            case "events": for (const mark of kind.value.marks) out.set(mark.key, { rowKey, start: mark.at, end: mark.at, shape: "instant", label: mark.label.type === "some" ? mark.label.value : "" }); break;
            default: break;
        }
    }
    return out;
}

/**
 * The name of the resource an event is on: its landing row's label among the canvas's rows (#1541) — a row of the
 * series its kind lands on, its path ending in the resource's key — else the key itself, for a row the canvas does not
 * hold.
 *
 * @param rows - The canvas's rows
 * @param at - The event's resource: the series it lands on, and the resource's key
 * @returns The name
 */
function resourceName(rows: readonly PlanRowValue[], at: { readonly kind: string; readonly key: string }): string {
    const row = rows.find((r) => r.id.type === "entry" && stringEqual(r.id.value.series, at.kind)
        && r.id.value.path.length > 0 && stringEqual(r.id.value.path[r.id.value.path.length - 1]!, at.key));
    return row?.gutter.label ?? at.key;
}

/**
 * How an event stood before a run, as its provenance says it (R17): its day
 * and time and its resource, or the backlog.
 *
 * @param item - The event as its kind read it before the run
 * @param rows - The canvas's rows: its resource by name
 * @param format - The app's formatters
 * @returns The words
 */
function previousWords(item: PlanEventItemValue, rows: readonly PlanRowValue[], format: Formatters): string {
    if (item.start.type !== "some") return "backlog";
    const at = item.resource.type === "some" ? item.resource.value : undefined;
    const where = at === undefined ? "Unassigned" : resourceName(rows, at);
    return `${format.weekdayDate(item.start.value)} ${format.time(item.start.value)}${item.end.type === "some" ? `–${format.time(item.end.value)}` : ""} · ${where}`;
}

/** What a landing is made over. */
export interface PlanLanding {
    readonly kinds: readonly PlanEventKindValue[];
    /** Each kind's record type by slot. */
    readonly types: PlanOptimiseTypes;
    /** The kinds' editing: how a kind reads a row, and where the step is recorded. */
    readonly editing: PlanEventEditing;
    /** A row as the page holds it, read by its key where it holds none: what the answer lands on. */
    readonly held: (kind: string, id: string) => option<unknown> | undefined;
    readonly request: PlanOptimiseRequest;
    readonly result: PlanOptimiseResult;
    /** The step's label — `Elara run #7`. */
    readonly label: string;
    /** The window's words, which a refusal names. */
    readonly period: string;
    /** The run's number, formatted, for the provenance. */
    readonly runText: string;
    /** The canvas's rows as it drew them before the run, the events joined into those they land on: where a ghost goes. */
    readonly rows: readonly PlanRowValue[];
    /** The app's formatters, for the provenance's words. */
    readonly format: Formatters;
    /** What earlier runs left on the events, still the session's drafts. */
    readonly before: PlanOptimised | undefined;
}

/**
 * The result landed (R7, R8, R10, R24, §12; east-workspace#1622, rules 7, 8,
 * 10, 11): each kind's patch landed key by key on the events the page holds,
 * its operations told by place, and recorded as one step of the history,
 * origin `optimise`. What each changed event was before the run — its
 * provenance's `Was …`, and whether the backlog moved — is read from the row
 * the answer landed on, as its kind reads a row. An answer with no patch for a
 * kind, or one that does not fit the events the page holds, is invalid, and
 * nothing is recorded; one that changes an event outside the window it was
 * asked of — where the event stood, or where the answer puts it — is refused
 * whole, naming the event; one that touches an event the page does not hold
 * names it, to be read by its key (`landOptimiseEvents`, shared with the
 * Calendar); one that changes nothing records nothing and leaves what earlier
 * runs left as it is (R10); one that does lays its operations and ghosts over
 * theirs.
 *
 * @param args - What the landing is made over
 * @returns What the run counted, and what the runs have left on the events — unchanged by a run that changed nothing;
 *   the events to read first; a refusal, naming the event; `undefined` for an invalid result, or one the session would not take
 */
export function landPlanOptimise(args: PlanLanding): OptimiseLanded<PlanOptimised> | OptimiseMissing | OptimiseRefused | undefined {
    const { kinds, types, editing, held, request, result, label, period, runText, rows, format, before } = args;
    const landed = landOptimiseEvents<PlanEventItemValue>({
        kinds: kinds.map((kind) => kind.key), records: types.records, events: result.events, held,
        eventOf: (kind, id, row) => editing.eventOf(kind, id, row)?.item, window: request, period,
    });
    if (landed === undefined || "missing" in landed || "refused" in landed) return landed;
    const { diff, told, backlogChanged } = landed;
    return recordOptimiseRun(diff, editing, label, () => {
        const ops = new Map<string, PlanElementOp>(before?.ops ?? []);
        const ghosts = new Map<string, PlanGhost[]>([...(before?.ghosts ?? [])].map(([row, list]) => [row, [...list]]));
        const placed = placedOf(rows);
        for (const [key, op] of diff.ops) {
            const { id } = op;
            const element = printEventRef({ kind: op.kind, key: id });
            const at = told.get(key);
            // Where the element stood: an earlier run's ghost of it gives way to this run's.
            for (const list of ghosts.values()) {
                const index = list.findIndex((ghost) => ghost.key === element);
                if (index >= 0) list.splice(index, 1);
            }
            const stood = placed.get(element);
            if (op.op === "del") {
                ops.delete(element);
                if (stood !== undefined) (ghosts.get(stood.rowKey) ?? ghosts.set(stood.rowKey, []).get(stood.rowKey)!).push({ key: element, op: "del", run: runText, start: stood.start, end: stood.end, label: stood.label, shape: stood.shape });
                continue;
            }
            const provenance = op.op === "add" ? optimiseMessages.entryAdded({ run: runText })
                : optimiseMessages.entryChanged({ previous: at?.was === undefined ? "backlog" : previousWords(at.was, rows, format), run: runText });
            ops.set(element, { op: op.op, run: runText, provenance });
            if (op.op === "chg" && stood !== undefined) {
                (ghosts.get(stood.rowKey) ?? ghosts.set(stood.rowKey, []).get(stood.rowKey)!).push({ key: element, op: "from", run: runText, start: stood.start, end: stood.end, label: stood.label, shape: stood.shape });
            }
        }
        return { ops, ghosts, backlogChanged };
    });
}
