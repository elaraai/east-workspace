/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Optimise in the Plan (#1409, #1419; `Optimise Spec.md` §5.1, §9.5, R24):
 * the plan window in view and the kinds' backlog as the run's request — every
 * event kind's rows in the window and its backlog by slot and by key, as the
 * session holds them, drafts in place, and every resource kind's rows as
 * context — and the result landed on the canvas's events as one edit: the
 * diff by key, kind by kind, recorded as one step (`ScheduleEditing.record`,
 * origin `optimise`), its operations told by place — backlog → placed is an
 * add on the canvas, placed → backlog a remove, a moved or re-assigned bar a
 * change — and what the landing draws kept until Apply: each element's
 * operation and provenance, and the ghosts of what stood on each row before.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import { DictType, SortedMap, StringType, compareFor, decodeBeast2For, fromEastTypeValue, none, printFor, type EastType, type ValueTypeOf } from "@elaraai/east";
import { ScheduleEventRefType, ScheduleOptimiseRequestTypeFor, ScheduleOptimiseResultTypeFor, scheduleOptimiseRows, type PlanPayloadType } from "@elaraai/e3-ui/internal";
import { optimiseMessages, useTrackedEvaluation, type Formatters } from "@elaraai/east-ui-components";
import { diffOptimiseRows, mergeOptimiseDiffs, optimiseIdOf, optimiseKeyOf, optimisePlacementOps } from "../shared/func/optimise-diff.js";
import type { OptimiseCounts } from "../shared/func/use-optimise.js";
import { scheduleWithinCap, type ScheduleCellsRead } from "../shared/schedule/cells.js";
import { rowCodec } from "../shared/schedule/records.js";
import type { PlanEventEditing, PlanEventReadValue } from "./edit/events.js";
import type { PlanInstantValue } from "./instant.js";
import { rowKeyOf, type PlanWireBlock } from "./model.js";
import type { PlanEventRange } from "./root/events.js";
import type { PlanElementOp, PlanGhost } from "./rows/element-optimise.js";

/** One event kind, as the Plan's payload carries it. */
type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];
/** One resource kind, as the Plan's payload carries it. */
type PlanResourceKindValue = ValueTypeOf<typeof PlanPayloadType>["resources"][number];
/** One event as a kind's seams read it. */
type PlanEventItemValue = PlanEventReadValue["item"];
/** A kind's rows by key, as the request and the result carry them. */
type Rows = SortedMap<unknown, unknown>;

/** The run's request: the window, the run's number, each event kind's rows by slot, and each resource kind's. */
export interface PlanOptimiseRequest {
    readonly from: Date;
    readonly to: Date;
    readonly run: bigint;
    readonly events: Readonly<Record<string, Rows>>;
    readonly resources: Readonly<Record<string, Rows>>;
}

/** The run's answer: each event kind's rows by slot, complete. */
export interface PlanOptimiseResult {
    readonly events: Readonly<Record<string, Rows>>;
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

/**
 * What a spec watches a run's request by (test use only), as the canvas's
 * render probe watches the canvas: each read of an event kind's rows the
 * request makes as a click builds it.
 */
export interface PlanOptimiseProbe {
    /** Called for each read of a kind's rows, with the kind's slot. */
    readonly readRows?: (kind: string) => void;
}

/** The probe a spec installed; `undefined` outside tests. */
let planOptimiseProbe: PlanOptimiseProbe | undefined;

/**
 * Install (or clear) the probe a run's request is watched by. Test use only.
 *
 * @param probe - What watches it; `undefined` clears it
 */
export function setPlanOptimiseProbe(probe: PlanOptimiseProbe | undefined): void {
    planOptimiseProbe = probe;
}

/** A kind's key and row types, from the kind on the wire. */
function typesOf(kind: Pick<PlanEventKindValue, "editing">): { keyType: EastType; rowType: EastType } {
    return {
        keyType: kind.editing.keyType.type === "some" ? fromEastTypeValue(kind.editing.keyType.value) as EastType : StringType,
        rowType: fromEastTypeValue(kind.editing.entryType) as EastType,
    };
}

/**
 * The request and result types over the Plan's kinds: what the bound
 * optimiser is called with, as the tag held it to.
 *
 * @param kinds - The event kinds
 * @param resources - The resource kinds
 * @returns The request and result East types
 */
export function planOptimiseTypes(kinds: readonly PlanEventKindValue[], resources: readonly PlanResourceKindValue[]): { request: EastType; result: EastType } {
    const events = scheduleOptimiseRows(kinds.map((kind) => [kind.key, typesOf(kind)] as const));
    const context = scheduleOptimiseRows(resources.map((kind) => [kind.key, { keyType: fromEastTypeValue(kind.keyType) as EastType, rowType: fromEastTypeValue(kind.rowType) as EastType }] as const));
    return { request: ScheduleOptimiseRequestTypeFor(events, context), result: ScheduleOptimiseResultTypeFor(events) };
}

/** The plan window in view, as the request carries it. */
export interface PlanOptimiseWindow { readonly from: Date; readonly to: Date }

/** Whether a run's request can carry the window whole now: `ready`, `reading` or `unread` ({@link planOptimiseReady}). */
export type PlanOptimiseReadiness = "ready" | "reading" | "unread";

/**
 * Whether a run's request can carry the window whole now (#1409, R24): every
 * kind's events in the window and its backlog, and each event's row held where
 * {@link planOptimiseRequest} reads it — called in a tracked read of a
 * component of its own ({@link PlanOptimiseReader}), which hears each land, so
 * the eye waits for them and the request a click makes finds them held.
 *
 * The request reads each event's row through the kind's editing
 * (`editing.read`), which finds it among the rows the canvas reads over its
 * range — the plan window and the periods laid out beyond it — drafts in
 * place, and else in the backlog beside them; only while those are on their
 * way does it read the row by its key: a key search, then a one-row page,
 * which the paging runtime keeps as a window of its own. So those rows are
 * waited for, read as the canvas reads them, and no row is read by its key:
 * whatever the number of events in the window, the eye asks e3 for the windows
 * alone. Read before them, each row would be read by its key, one at a time —
 * a key search and a one-row page an event, for rows the canvas's windows
 * hold already. Every kind is read in one pass, so the kinds' windows are
 * asked together.
 *
 * `reading` while one is on its way; `unread` for a window no request carries
 * whole: a kind past the cap of events over it (#1039), none of whose events
 * is read, or one read by its cells, never read over the window — a run would
 * place the backlog over events it was never shown.
 *
 * @param kinds - The event kinds
 * @param editing - The kinds' editing: each kind's drafts, which every read puts in place
 * @param window - The plan window in view
 * @param range - The range the canvas reads its event kinds' rows over (`eventReadRange`): the window, and the periods laid out beyond each edge
 * @param cells - The kinds' cells and counts, when the reader gives a kind cells
 * @returns Whether the request can be made: `ready`, `reading` or `unread`
 */
export function planOptimiseReady(kinds: readonly PlanEventKindValue[], editing: PlanEventEditing, window: PlanOptimiseWindow,
    range: PlanEventRange, cells: ScheduleCellsRead | undefined): PlanOptimiseReadiness {
    let reading = false;
    for (const kind of kinds) {
        if (cells?.reads.has(kind.key) === true) return "unread";
        const within = scheduleWithinCap(kind.count, window.from, window.to);
        if (within.type === "some" && !within.value) return "unread";
        const drafts = editing.draftsOf(kind.key);
        // Where each event's row is held: the kind's rows over the range the canvas reads, which covers the window, and
        // its backlog — the reads the canvas makes, so no request of their own.
        const held = kind.planItems(range.from, range.to, drafts, none);
        const heldWaiting = kind.backlog ? kind.planUnscheduled(range.from, range.to, drafts, none) : undefined;
        // What the request carries: the window's events, and the backlog.
        const placed = kind.planItems(window.from, window.to, drafts, none);
        const waiting = kind.backlog ? kind.planUnscheduled(window.from, window.to, drafts, none) : undefined;
        if (within.type !== "some" || held.type !== "some" || heldWaiting?.type === "none" || placed.type !== "some" || waiting?.type === "none") {
            reading = true;
        }
    }
    return reading ? "reading" : "ready";
}

/** Props of {@link PlanOptimiseReader}. */
export interface PlanOptimiseReaderProps {
    /** The event kinds. */
    kinds: readonly PlanEventKindValue[];
    /** The kinds' editing: each kind's drafts, which every read puts in place. */
    editing: PlanEventEditing;
    /** The plan window in view. */
    window: PlanOptimiseWindow;
    /** The range the canvas reads its event kinds' rows over: where each event's row is held. */
    range: PlanEventRange;
    /** The kinds' cells and counts, when the reader gives a kind cells. */
    cells: ScheduleCellsRead | undefined;
    /** Where whether the request can be made goes: called only when that moves. */
    onReady: (ready: PlanOptimiseReadiness) => void;
}

/**
 * Whether a run's request can carry the window whole (#1409, R24), read in a
 * component of its own (#1343): what {@link planOptimiseReady} reads lands in
 * as many settles as the searches it touches — every kind's events over the
 * range the canvas reads and in the window, and its backlog — and each re-runs
 * this alone. It hands the canvas whether the request can be made only when
 * that moves, so the canvas renders as the eye's state changes, never at every
 * settle of what it reads. A read that fails is `unread`: no request carries a
 * window it could not read.
 *
 * @param props - What is read, over what, and where it goes
 * @returns Nothing: it reads
 */
export function PlanOptimiseReader({ kinds, editing, window, range, cells, onReady }: PlanOptimiseReaderProps): null {
    const read = useCallback(() => planOptimiseReady(kinds, editing, window, range, cells), [kinds, editing, window, range, cells]);
    const { result } = useTrackedEvaluation(read);
    const ready: PlanOptimiseReadiness = result.ok ? result.value : "unread";
    // What the canvas holds: its own until the first read is reported.
    const reported = useRef<PlanOptimiseReadiness | undefined>(undefined);
    useLayoutEffect(() => {
        if (reported.current === ready) return;
        reported.current = ready;
        onReady(ready);
    });
    return null;
}

/**
 * The run's request (R1, R24, O3, O5): the window, the run's number, every
 * event kind's rows in the window and its backlog by key, as the session
 * holds them — base plus every unapplied draft, every row whatever the rail
 * shows — and every resource kind's rows, read whole. Each event's row is
 * read through its kind's editing, among the rows the canvas reads over its
 * range, which the eye waits for: none is read by its key. A kind whose window
 * is still being read carries no rows: the eye is disabled until every kind
 * has read, and for a window no request carries whole ({@link planOptimiseReady}).
 *
 * @param kinds - The event kinds
 * @param resources - The resource kinds
 * @param editing - The kinds' editing: where each event's row is read, drafts in place
 * @param window - The plan window in view
 * @param run - The run's number
 * @returns The request
 */
export function planOptimiseRequest(kinds: readonly PlanEventKindValue[], resources: readonly PlanResourceKindValue[], editing: PlanEventEditing,
    window: PlanOptimiseWindow, run: number): PlanOptimiseRequest {
    const events: Record<string, Rows> = {};
    for (const kind of kinds) {
        const { keyType } = typesOf(kind);
        const keyOf = optimiseKeyOf(keyType);
        const decode = rowCodec(kind.editing.entryType);
        const rows: Rows = new SortedMap([], compareFor(keyType) as (a: unknown, b: unknown) => number);
        const drafts = editing.draftsOf(kind.key);
        const placed = kind.planItems(window.from, window.to, drafts, none);
        const waiting = kind.backlog ? kind.planUnscheduled(window.from, window.to, drafts, none) : none;
        const items = [...(placed.type === "some" ? placed.value : []), ...(waiting.type === "some" ? waiting.value : [])];
        for (const item of items) {
            // Each event's row read through its kind's editing, which reads the kind's rows over the range to find it.
            planOptimiseProbe?.readRows?.(kind.key);
            const read = editing.read(kind.key, item.key);
            const key = keyOf(item.key);
            if (read === undefined || key === undefined) continue;
            rows.set(key, decode.decode(read.row));
        }
        events[kind.key] = rows;
    }
    const context: Record<string, Rows> = {};
    for (const kind of resources) {
        const keyType = fromEastTypeValue(kind.keyType) as EastType;
        const rowType = fromEastTypeValue(kind.rowType) as EastType;
        const compare = compareFor(keyType) as (a: unknown, b: unknown) => number;
        if (kind.records.type === "none") { context[kind.key] = new SortedMap([], compare); continue; }
        // The kind's records read whole, as the run starts: its rows by key, as the request carries them.
        const decoded = decodeBeast2For(DictType(keyType, rowType))(kind.records.value()) as ReadonlyMap<unknown, unknown>;
        context[kind.key] = decoded instanceof SortedMap ? decoded : new SortedMap([...decoded], compare);
    }
    return { from: window.from, to: window.to, run: BigInt(run), events, resources: context };
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
    /** The kinds' editing: where each event is read before the run, and where the step is recorded. */
    readonly editing: PlanEventEditing;
    readonly request: PlanOptimiseRequest;
    readonly result: PlanOptimiseResult;
    /** The step's label — `Elara run #7`. */
    readonly label: string;
    /** The run's number, formatted, for the provenance. */
    readonly runText: string;
    /** The event kinds' rows as the canvas drew them before the run: where a ghost goes. */
    readonly blocks: readonly PlanWireBlock[];
    /** The app's formatters, for the provenance's words. */
    readonly format: Formatters;
    /** What earlier runs left on the events, still the session's drafts. */
    readonly before: PlanOptimised | undefined;
}

/**
 * The result landed (R7, R8, R10, R24, §12): diffed against the request by
 * key, kind by kind, its operations told by place, and recorded as one step
 * of the history, origin `optimise`. A result that answers no rows for a
 * kind the request asked is invalid, and nothing is recorded; one that
 * changes nothing records nothing and leaves what earlier runs left as it is
 * (R10); one that does lays its operations and ghosts over theirs.
 *
 * @param args - What the landing is made over
 * @returns What the run counted, and what the runs have left on the events — unchanged by a run that changed nothing; `undefined` for an invalid result, or one the session would not take
 */
export function landPlanOptimise(args: PlanLanding): { counts: OptimiseCounts; optimised: PlanOptimised | undefined } | undefined {
    const { kinds, resources, editing, request, result, label, runText, blocks, format, before } = args;
    const diffs = [];
    const ops = new Map<string, PlanElementOp>(before?.ops ?? []);
    const ghosts = new Map<string, PlanGhost[]>([...(before?.ghosts ?? [])].map(([row, list]) => [row, [...list]]));
    const placed = placedOf(blocks);
    let backlogChanged = false;
    for (const kind of kinds) {
        const asked = request.events[kind.key];
        const answered = result.events[kind.key];
        if (asked === undefined || answered === undefined) return undefined;
        const { keyType, rowType } = typesOf(kind);
        const startField = kind.schedule.start;
        const unscheduled = (row: unknown): boolean => {
            const start = (row as Record<string, { type: string }>)[startField];
            return start !== undefined && start.type === "none";
        };
        const diff = optimisePlacementOps(diffOptimiseRows(kind.key, rowType, optimiseIdOf(keyType), asked as ReadonlyMap<unknown, unknown>, answered as ReadonlyMap<unknown, unknown>),
            (row) => !unscheduled(row));
        diffs.push(diff);
        for (const [key, op] of diff.ops) {
            const id = key.slice(kind.key.length + 1);
            const element = printEventRef({ kind: kind.key, key: id });
            // The event as its kind read it before the run: the provenance's `Was …`, and whether the backlog moves.
            let was: PlanEventItemValue | undefined;
            try { was = editing.read(kind.key, id)?.item; } catch { was = undefined; }
            if ((was !== undefined && was.start.type !== "some") || ("row" in op && unscheduled(op.row))) backlogChanged = true;
            // Where the element stood: an earlier run's ghost of it gives way to this run's.
            for (const list of ghosts.values()) {
                const at = list.findIndex((ghost) => ghost.key === element);
                if (at >= 0) list.splice(at, 1);
            }
            const stood = placed.get(element);
            if (op.op === "del") {
                ops.delete(element);
                if (stood !== undefined) (ghosts.get(stood.rowKey) ?? ghosts.set(stood.rowKey, []).get(stood.rowKey)!).push({ key: element, op: "del", run: runText, start: stood.start, end: stood.end, label: stood.label, shape: stood.shape });
                continue;
            }
            const provenance = op.op === "add" ? optimiseMessages.entryAdded({ run: runText })
                : optimiseMessages.entryChanged({ previous: was === undefined ? "backlog" : previousWords(was, resources, format), run: runText });
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
