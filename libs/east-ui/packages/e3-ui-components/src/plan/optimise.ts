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

import { StringType, fromEastTypeValue, printFor, variant, type EastType, type ValueTypeOf, type option } from "@elaraai/east";
import {
    ScheduleEventRefType, ScheduleOptimiseRequestType, ScheduleOptimiseResultTypeFor, scheduleOptimiseRecords,
    type PlanPayloadType, type ScheduleOptimiseRecords,
} from "@elaraai/e3-ui/internal";
import { optimiseMessages, type Formatters } from "@elaraai/east-ui-components";
import { landOptimisePatches, mergeOptimiseDiffs, optimisePlacementOps, type OptimiseDiff, type OptimiseRowRef } from "../shared/func/optimise-diff.js";
import type { OptimiseSlice } from "../shared/func/optimise-slice.js";
import type { OptimiseCounts, OptimiseRefused } from "../shared/func/use-optimise.js";
import { placedOutside } from "../shared/schedule/window.js";
import type { PlanEventEditing, PlanEventReadValue } from "./edit/events.js";
import type { PlanInstantValue } from "./instant.js";
import { rowKeyOf, type PlanWireBlock } from "./model.js";
import type { PlanElementOp, PlanGhost } from "./rows/element-optimise.js";
import type { PlanResolution } from "./scale.js";

/** One event kind, as the Plan's payload carries it. */
type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];
/** One resource kind, as the Plan's payload carries it. */
type PlanResourceKindValue = ValueTypeOf<typeof PlanPayloadType>["resources"][number];
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
 * @param blocks - The event kinds' rows as the canvas draws them
 * @returns Each element's place
 */
function placedOf(blocks: readonly PlanWireBlock[]): Map<string, PlacedElement> {
    const out = new Map<string, PlacedElement>();
    for (const block of blocks) {
        for (const row of block.rows) {
            const rowKey = rowKeyOf(row.id);
            const kind = row.kind;
            switch (kind.type) {
                case "span": for (const run of kind.value.runs) out.set(run.key, { rowKey, start: run.start, end: run.end, shape: "span", label: run.label }); break;
                case "cards": for (const chip of kind.value.chips) out.set(chip.key, { rowKey, start: chip.from, end: chip.to, shape: "span", label: chip.label }); break;
                case "buckets": for (const tile of kind.value.events) out.set(tile.key, { rowKey, start: tile.at, end: tile.at, shape: "instant", label: tile.label.type === "some" ? tile.label.value : "" }); break;
                case "events": for (const mark of kind.value.marks) out.set(mark.key, { rowKey, start: mark.at, end: mark.at, shape: "instant", label: mark.label.type === "some" ? mark.label.value : "" }); break;
                default: break;
            }
        }
    }
    return out;
}

/**
 * How an event stood before a run, as its provenance says it (R17): its day
 * and time and its resource, or the backlog.
 *
 * @param item - The event as its kind read it before the run
 * @param resources - The resource kinds: its resource by name
 * @param format - The app's formatters
 * @returns The words
 */
function previousWords(item: PlanEventItemValue, resources: readonly PlanResourceKindValue[], format: Formatters): string {
    if (item.start.type !== "some") return "backlog";
    const at = item.resource.type === "some" ? item.resource.value : undefined;
    const where = at === undefined ? "Unassigned" : resources.find((kind) => kind.key === at.kind)?.rows.find((row) => row.key === at.key)?.label ?? at.key;
    return `${format.weekdayDate(item.start.value)} ${format.time(item.start.value)}${item.end.type === "some" ? `–${format.time(item.end.value)}` : ""} · ${where}`;
}

/** What a landing is made over. */
export interface PlanLanding {
    readonly kinds: readonly PlanEventKindValue[];
    readonly resources: readonly PlanResourceKindValue[];
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
    /** The event kinds' rows as the canvas drew them before the run: where a ghost goes. */
    readonly blocks: readonly PlanWireBlock[];
    /** The app's formatters, for the provenance's words. */
    readonly format: Formatters;
    /** What earlier runs left on the events, still the session's drafts. */
    readonly before: PlanOptimised | undefined;
}

/** What a landing answers that is no landing: rows to read first, by their keys (rule 8). */
export interface PlanOptimiseMissing {
    readonly missing: readonly OptimiseRowRef[];
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
 * names it, to be read by its key; one that changes nothing records nothing
 * and leaves what earlier runs left as it is (R10); one that does lays its
 * operations and ghosts over theirs.
 *
 * @param args - What the landing is made over
 * @returns What the run counted, and what the runs have left on the events — unchanged by a run that changed nothing;
 *   the events to read first; a refusal, naming the event; `undefined` for an invalid result, or one the session would not take
 */
export function landPlanOptimise(args: PlanLanding): { counts: OptimiseCounts; optimised: PlanOptimised | undefined } | PlanOptimiseMissing | OptimiseRefused | undefined {
    const { kinds, resources, types, editing, held, request, result, label, period, runText, blocks, format, before } = args;
    const answers = [];
    for (const kind of kinds) {
        const record = types.records[kind.key];
        const patch = result.events[kind.key];
        if (record === undefined || patch === undefined) return undefined;
        answers.push({ kind: kind.key, record, patch });
    }
    const landed = landOptimisePatches<unknown>(answers, held);
    if (landed === undefined) return undefined;
    if ("missing" in landed) return { missing: landed.missing };
    // No event of a plan is half made: every draft is a whole row.
    if ("incomplete" in landed) return undefined;
    const diffs: OptimiseDiff<unknown>[] = [];
    const ops = new Map<string, PlanElementOp>(before?.ops ?? []);
    const ghosts = new Map<string, PlanGhost[]>([...(before?.ghosts ?? [])].map(([row, list]) => [row, [...list]]));
    const placed = placedOf(blocks);
    let backlogChanged = false;
    for (const diff of landed) {
        // Each operation's event as it stood and as the answer leaves it, read as its kind reads a row.
        const told = new Map<string, { was: PlanEventItemValue | undefined; now: PlanEventItemValue | undefined }>();
        for (const [key, op] of diff.ops) {
            const id = key.slice(op.kind.length + 1);
            const was = "previous" in op ? editing.eventOf(op.kind, id, op.previous)?.item : undefined;
            const now = "row" in op ? editing.eventOf(op.kind, id, op.row)?.item : undefined;
            // Outside the window it was asked of, where it stood or where the answer puts it (rule 11).
            if (placedOutside(was, request) || placedOutside(now, request)) {
                return { refused: optimiseMessages.refusedOutside({ row: (now ?? was)?.title ?? id, period }) };
            }
            told.set(key, { was, now });
        }
        // A row's place is its kind's to read: placed, or in the backlog.
        const byPlace = optimisePlacementOps(diff, (_row, key, side) => told.get(key)?.[side]?.start.type === "some");
        diffs.push(byPlace);
        for (const [key, op] of byPlace.ops) {
            const id = key.slice(op.kind.length + 1);
            const element = printEventRef({ kind: op.kind, key: id });
            const at = told.get(key);
            if (at?.was?.start.type === "none" || at?.now?.start.type === "none") backlogChanged = true;
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
                : optimiseMessages.entryChanged({ previous: at?.was === undefined ? "backlog" : previousWords(at.was, resources, format), run: runText });
            ops.set(element, { op: op.op, run: runText, provenance });
            if (op.op === "chg" && stood !== undefined) {
                (ghosts.get(stood.rowKey) ?? ghosts.set(stood.rowKey, []).get(stood.rowKey)!).push({ key: element, op: "from", run: runText, start: stood.start, end: stood.end, label: stood.label, shape: stood.shape });
            }
        }
    }
    const merged = mergeOptimiseDiffs(diffs);
    if (merged.changes.length === 0) return { counts: merged.counts, optimised: undefined };
    if (!editing.record(merged.changes, "optimise", label)) return undefined;
    return { counts: merged.counts, optimised: { ops, ghosts, backlogChanged } };
}
