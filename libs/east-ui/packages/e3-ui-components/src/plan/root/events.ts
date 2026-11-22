/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The event kinds' events on the canvas's own rows (#1192, #1541): a Plan of
 * event kinds lands each kind's events on the rows of the resources series or
 * kinds case its `resource.of` names — the record's own rows, which the root
 * makes wherever it makes them, inline or a window at a time — through the
 * payload's seam: `placed` reads the events of a range, filed by the series
 * they land on, and `place` joins them into any rows.
 *
 * # Read where the canvas draws
 *
 * The events are read over the scale's window and the periods it lays out
 * beyond each edge (#619), so a pan reveals the events there, with every
 * kind's drafts in place (#1194), so a draft draws as Save would leave it. The
 * read is a tracked evaluation: the records it reads are listened to, and a
 * commit to one reads the events again, as a new draft does. A read whose
 * kinds are still in flight leaves the last events standing; one that throws
 * leaves them too, and says why — and which kinds' own events it could not
 * read, each kind read alone in the read that failed (#1398): what the
 * footer's line names the failure by, and what its Retry asks again. A kind
 * read a window at a time is read by the shared reader (#1599), which keeps
 * its window's rows standing while they are read again and names the kind
 * whose window it could not read: said the same way. The events move only when
 * they differ, so a write that changes none of them redraws nothing.
 *
 * The read runs in a component of its own, {@link PlanEventsReader}, which
 * hands the canvas what it read only when it moves: a kind narrowed through an
 * interval index lands some fifty-five key searches a window, and each would
 * otherwise render the whole canvas (#1343, #1344).
 *
 * # Joined into the rows
 *
 * Inline, the root's blocks are placed once, the Unassigned rows after them.
 * Paged, the root's source is ONE wrapper per source (a host function is
 * equivalent only to itself, so a new wrapper would drop the driver's windows)
 * that places each window the source serves — and a window standing in, as
 * the canvas's editing redraws it (#1599) — and names a new revision when the
 * events move, so the driver reads its windows again and keeps the rows it
 * has standing in until they land (#821). A window read again over new events
 * alone — the same blocks from the source under the wrapper, which the kept
 * layer gives while they hold (`kept.ts`) — is joined again only in the rows
 * whose events moved (#1712): a landing row's rows depend on the row, the list
 * filed under its key, the shading and what the viewer hides, so the rows filed
 * under a key whose list moved are joined in one `place`, each written over its
 * place, and every other row is the object it was. New blocks, new shading or
 * another set hidden join the window whole. Until the first read answers the
 * rows draw with no events. The wrapper names the snapshot of the source's own
 * data apart from that revision (`snapshot`, #1199): new events over the same
 * data read the windows again and are no new snapshot of it, so a key search
 * standing stays where it is. Over rows read a page at a time no Unassigned row
 * is drawn: an event on no row of the canvas's is in no window (#1541).
 *
 * # A link's event end
 *
 * A link may name an event (`Plan.eventRef(kind, key)`): a run ref at the
 * kind's slot with no path, whose run is the event's key. The canvas finds the
 * event's element where it draws — its key is the event's ref as East prints
 * it — and names that row and element instead, so the links focus gathers the
 * row and a ribbon meets the element. Over rows read a page at a time, an
 * event on a top-level resource is named by its resource's row id from the
 * events placed alone — `entry { series: <landing>, path: [key] }`, or
 * `<landing>.<draw>` for the further ways its kinds draw — never looked for in
 * a window (#1199): the row is the one the window holding that resource draws,
 * whether or not it has landed. An event the rows do not draw keeps its end,
 * which no row has, and its ribbon is not drawn.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
    SortedMap, StringType, compareFor, equalFor, equivalentFor, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import {
    Plan, PlanEventDraftsType, PlanEventPlacedType, PlanEventReadsType, PlanEventSeamType, PlanEventShadingType,
    planChildRowKey, planHideId,
} from "@elaraai/e3-ui/internal";
import { printEventRef } from "../../shared/schedule/event-ref.js";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { snapshotOf, windowedSourceOf, type WindowedSourceValue } from "@elaraai/east-ui-components/internal";
import { OVERSCAN_BUCKETS } from "../../shared/time/scale.js";
import { hides } from "../frame/hidden.js";
import type { PlanLinkValue, PlanRootValue, PlanRowId, PlanWireBlock, PlanWireRow } from "../model.js";
import type { PlanScale } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import { windowedArm, type PlanPagedSourceValue } from "../use-plan-paging.js";
import type { ScheduleCellsRead } from "../../shared/schedule/cells.js";
import { usePlanCells, type PlanCellSpanStore, type PlanCellsArgs } from "./cells.js";
import { landingRowId, type PlanLandingValue } from "./landings.js";

/** The payload's seam, decoded: the events of a range, filed, and how they join any rows (#1541). */
export type PlanEventSeamValue = ValueTypeOf<typeof PlanEventSeamType>;

/** The events of a range, filed by the series they land on, the way they draw and the resource's key (#1541). */
export type PlanEventPlacedValue = ValueTypeOf<typeof PlanEventPlacedType>;

/** A series the event kinds land on, as the payload carries it (#1541): `landings.ts`'s, which every reader of one names. */
export type { PlanLandingValue };

/** What a Plan of event kinds hands its canvas (#1192, #1541). */
export interface PlanEventRows {
    /** The payload's seam: the events of a range, filed, and how they join the rows. */
    seam: PlanEventSeamValue;
    /** The series the event kinds land on, in the series tree's order, a kinds block's cases in its variant's: the payload's own list. */
    landings: PlanLandingValue[];
    /** Whether the canvas's rows are read a page at a time: every kind is then read a cell at a time. */
    paged: boolean;
}

/** The event kinds' events as the canvas draws them now. */
export interface PlanEventLead {
    /** The events of the range, filed by the series they land on — `undefined` until the first read answers. */
    placed: PlanEventPlacedValue | undefined;
    /** The resources' shading (#1039): what a landing row draws in place of its events past the budget. */
    shading: PlanEventShadingValue;
    /** The kinds' cells and counts (#1039): what a kind read by them draws from, every kind's drafts as the seams take
     *  them, the rows each kind's cells hold, and the counted kinds read over the range; `undefined` before the reader
     *  hands them on — every kind is counted, so a Plan of event kinds has them once it has read. */
    cells: ScheduleCellsRead | undefined;
    /** Moves each time the events placed do, or the shading, or what the viewer hides — from 0 before the first read
     *  answers — the rows are placed again then, and a paged canvas reads its windows again. */
    version: number;
    /** The last read's failure, when it failed: why, and the kinds whose own events it could not read (#1398). */
    error: PlanEventFailure | undefined;
}

/**
 * A read of the event kinds' events that failed (#1398): why, and the kinds
 * whose own events over the range it could not read — what the footer's
 * loading line names the failure by, and what its Retry asks again; none where
 * the failure was no kind's own events'.
 */
export interface PlanEventFailure {
    /** Why it failed, in the read's own words. */
    readonly reason: string;
    /** The slots of the kinds whose own events could not be read, in the kinds' order. */
    readonly kinds: readonly string[];
}

/** The resources' shading (#1039), decoded. */
export type PlanEventShadingValue = ValueTypeOf<typeof PlanEventShadingType>;

const compareString = compareFor(StringType);
/** No drafts: a Plan whose event kinds hold none. */
const NO_DRAFTS: ValueTypeOf<typeof PlanEventDraftsType> = new SortedMap([], compareString);
/** No kind read by its cells (#1039): each is read over the window. */
const NO_READS: ValueTypeOf<typeof PlanEventReadsType> = new SortedMap([], compareString);
/** No shading (#1039): each landing row draws its events. */
const NO_SHADING: ValueTypeOf<typeof PlanEventShadingType> = new SortedMap([], compareString);
/** No event placed: the rows before the first read answers. */
const NOTHING_PLACED: PlanEventPlacedValue = { on: new SortedMap([], compareString), lost: new SortedMap([], compareString) };
/** Nothing hidden: every kind and series draws. */
const NONE_HIDDEN: readonly string[] = [];
const placedEqual = equalFor(PlanEventPlacedType);
const shadingEqual = equalFor(PlanEventShadingType);
/** Whether two lists of the events filed for a row, one way of drawing, are one: what a landing row's join reads. */
const listEqual = equalFor(PlanEventPlacedType.fields.on.value.value.value);
const rowIdEqual = equalFor(Plan.Types.RowId);
/** No series the event kinds land on. */
const NO_LANDINGS: readonly PlanLandingValue[] = [];
/** A windowed source as the canvas composes over it: one that may say how it draws a window standing in (#1599). */
const under = (source: WindowedSourceValue<PlanRootValue["rows"]> | undefined): PlanPagedSourceValue | undefined => source;

/** Whether two paged sources derive the same rows — the paging driver's test (#809). */
const pagedSourceEquivalent = equivalentFor(Plan.Types.Root.fields.rows.cases.paged);

/** A `time` instant's epoch ms; `undefined` for an instant of another arm. */
function timeMs(t: PlanInstantValue): number | undefined {
    return t.type === "time" ? t.value.getTime() : undefined;
}

/** The event kinds, as the payload carries them. */
type PlanEventKinds = PlanCellsArgs["kinds"];
/** One kind's drafts, by entry id, as its seams take them. */
type KindDrafts = Parameters<PlanEventKinds[number]["planItems"]>[2];
/** No drafts of a kind. */
const NO_KIND_DRAFTS: KindDrafts = new SortedMap([], compareString);
/** No kind's own events failed. */
const NO_KINDS_FAILED: readonly string[] = [];
/** No event kinds: a reader given none names no kind a failure is of. */
const NO_EVENT_KINDS: PlanEventKinds = [];
const stringEqual = equalFor(StringType);

/**
 * What a read of the event kinds' events throws when it fails (#1398): what it
 * threw, and the kinds whose own events over the range could not be read.
 */
class EventRowsFailure extends Error {
    /**
     * @param thrown - What the read threw
     * @param kinds - The slots of the kinds whose own events could not be read
     */
    constructor(readonly thrown: unknown, readonly kinds: readonly string[]) {
        super(thrown instanceof Error ? thrown.message : String(thrown));
        this.name = "EventRowsFailure";
    }
}

/**
 * The kinds whose own events over a range could not be read (#1398): each the
 * read reads — every kind the viewer shows — read alone, as that read reads it,
 * its drafts in place and its cells given. Called in the read that failed, it
 * reads what that read holds: a kind's events it read answer from what it
 * holds, a window that failed throws as it did, and a kind it did not reach,
 * past the one that threw, asks e3 what that read would have asked.
 *
 * @param kinds - The event kinds
 * @param from - The range's start
 * @param to - Its end, exclusive
 * @param drafts - Every kind's drafts, as the seams take them
 * @param hidden - The ids the viewer hides in the Series tab: a kind hidden there is not read
 * @param reads - Each kind read by its cells, what they hold
 * @returns The slots of the kinds whose own read throws, in the kinds' order
 */
function failedKinds(kinds: PlanEventKinds, from: Date, to: Date, drafts: ValueTypeOf<typeof PlanEventDraftsType>,
    hidden: readonly string[], reads: ValueTypeOf<typeof PlanEventReadsType>): string[] {
    const out: string[] = [];
    for (const kind of kinds) {
        if (hides(hidden, planHideId.events(kind.key))) continue;
        const held = reads.get(kind.key);
        try {
            kind.planItems(from, to, drafts.get(kind.key) ?? NO_KIND_DRAFTS, held === undefined ? none : some(held));
        } catch {
            out.push(kind.key);
        }
    }
    return out;
}

/** Whether two lists hold the same texts in the same order: the kinds two failures name, or the ids the viewer hides. */
function sameTexts(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((text, i) => stringEqual(text, b[i]!));
}

/** The range the canvas reads its event kinds' events over. */
export interface PlanEventRange {
    /** Its start: the scale's window less the periods laid out before it. */
    readonly from: Date;
    /** Its end, exclusive: the window and the periods laid out after it. */
    readonly to: Date;
}

/**
 * The range the canvas reads its event kinds' events over (#619): the scale's
 * window and the periods it lays out beyond each edge. A kind read a window
 * at a time (#1199) holds there every event the canvas draws, so a gesture on
 * one reads it from what the windows hold, with no read of its own.
 *
 * @param scale - The shared scale
 * @returns The range; `undefined` with no scale, or one whose instants are not times
 */
export function eventReadRange(scale: PlanScale | undefined): PlanEventRange | undefined {
    if (scale === undefined) return undefined;
    const from = timeMs(scale.offset(scale.window.min, -OVERSCAN_BUCKETS));
    const to = timeMs(scale.offset(scale.window.max, OVERSCAN_BUCKETS));
    return from === undefined || to === undefined ? undefined : { from: new Date(from), to: new Date(to) };
}

/**
 * The event kinds' events over the range the canvas draws: the scale's window
 * and the periods laid out beyond each edge, what the viewer hides left out,
 * every kind's drafts in place (#1194, PB17) — a kind read by its cells drawn
 * from what they hold, a kind counted past the cap drawn from none, and the
 * resources' shading in their place (#1039) — filed by the series they land
 * on (#1541).
 *
 * @param events - The Plan's event rows, when it has event kinds
 * @param scale - The shared scale — a time scale, beside event kinds
 * @param hidden - The ids the viewer hides in the library's Series tab (#1195)
 * @param drafts - Every kind's drafts, by kind then by entry id — the same object while they hold
 * @param cells - The kinds' cells and counts, when the reader decides a kind (#1039): each kind's cells it gives — none past the cap — every kind's drafts as the seams take them, the shading
 * @param kinds - The event kinds, as the payload carries them: a read that fails names those whose own events it could not read (#1398)
 * @returns The events as the canvas draws them now
 */
export function usePlanEventPlaced(
    events: PlanEventRows | undefined, scale: PlanScale | undefined, hidden: readonly string[] = NONE_HIDDEN,
    drafts: ValueTypeOf<typeof PlanEventDraftsType> = NO_DRAFTS, cells?: ScheduleCellsRead | undefined,
    kinds: PlanEventKinds = NO_EVENT_KINDS,
): PlanEventLead {
    const seam = events?.seam;
    const range = eventReadRange(scale);
    const from = range?.from.getTime();
    const to = range?.to.getTime();
    const reads = cells?.reads ?? NO_READS;
    const shading = cells?.shading ?? NO_SHADING;
    const seamDrafts = cells?.drafts ?? drafts;
    // One read: the events of the range, filed — `undefined` while a kind is in flight. One that fails names the kinds
    // whose own events it could not read, each read alone in it (#1398).
    const read = useCallback((): PlanEventPlacedValue | undefined => {
        if (seam === undefined || from === undefined || to === undefined) return undefined;
        try {
            const placed = seam.placed(new Date(from), new Date(to), seamDrafts, [...hidden], reads);
            return placed.type === "some" ? placed.value : undefined;
        } catch (thrown) {
            throw new EventRowsFailure(thrown, failedKinds(kinds, new Date(from), new Date(to), seamDrafts, hidden, reads));
        }
    }, [seam, from, to, hidden, seamDrafts, reads, kinds]);
    const { result } = useTrackedEvaluation(read);
    // The last events read, held while a read is in flight or failed: kept by identity while a new read holds the same.
    const held = useRef<{ placed: PlanEventPlacedValue | undefined; shading: PlanEventShadingValue; hidden: readonly string[]; version: number }>(
        { placed: undefined, shading: NO_SHADING, hidden: NONE_HIDDEN, version: 0 });
    // The last failure, kept by identity while a read fails the same way — its words and its kinds — so the reader hands
    // the canvas nothing new for it.
    const failed = useRef<PlanEventFailure | undefined>(undefined);
    // A kind's window the reader could not read (#1599): the reader reads each kind read a window at a time, and names
    // the kind whose window's read threw — said as the events' own failure is, on the footer's line, with its Retry.
    const cellsFailure = cells?.error?.window === true ? cells.error : undefined;
    const error = useMemo((): PlanEventFailure | undefined => {
        if (result.ok && cellsFailure === undefined) return undefined;
        let next: PlanEventFailure;
        if (result.ok) {
            next = { reason: cellsFailure!.reason, kinds: cellsFailure!.kinds };
        } else {
            const failure = result.error instanceof EventRowsFailure ? result.error : undefined;
            const thrown = failure?.thrown ?? result.error;
            console.error("[Plan] the event kinds' events could not be read:", thrown);
            next = {
                reason: thrown instanceof Error ? thrown.message : String(thrown),
                kinds: failure?.kinds ?? NO_KINDS_FAILED,
            };
        }
        const was = failed.current;
        if (was !== undefined && was.reason === next.reason && sameTexts(was.kinds, next.kinds)) return was;
        failed.current = next;
        return next;
    }, [result, cellsFailure]);
    const now = useMemo(() => {
        const previous = held.current;
        if (!result.ok || result.value === undefined) return previous;
        const next = result.value;
        // The shading and what the viewer hides are placed with the events: a new one places the rows again.
        const same = previous.placed !== undefined && placedEqual(previous.placed, next)
            && shadingEqual(previous.shading, shading) && previous.hidden === hidden;
        if (same) return previous;
        held.current = { placed: next, shading, hidden, version: previous.version + 1 };
        return held.current;
    }, [result, hidden, shading]);
    return useMemo(() => ({ placed: now.placed, shading: now.shading, cells, version: now.version, error }), [now, cells, error]);
}

/**
 * The event kinds' events before their first read: none placed.
 *
 * @returns The events to stand in
 */
export function initialEventLead(): PlanEventLead {
    return { placed: undefined, shading: NO_SHADING, cells: undefined, version: 0, error: undefined };
}

/** Props of {@link PlanEventsReader}. */
export interface PlanEventsReaderProps {
    /** The Plan's event rows, when it has event kinds. */
    events: PlanEventRows | undefined;
    /** The shared scale. */
    scale: PlanScale | undefined;
    /** The ids the viewer hides in the library's Series tab. */
    hidden: readonly string[] | undefined;
    /** Every kind's drafts. */
    drafts: ValueTypeOf<typeof PlanEventDraftsType>;
    /** The event kinds, as the payload carries them (#1039): a kind read by its cells is read through its part. */
    kinds: PlanCellsArgs["kinds"];
    /** The canvas's own rows: what a kind read by its cells reads the resources of, and a kind past the cap shades (#1541). */
    rows: PlanCellsArgs["rows"];
    /** How many of the rows' entries each window of the root's holds (#1714). */
    windowEntries: PlanCellsArgs["windowEntries"];
    /** The event kinds narrowed through their sources of the slice, and their parts. */
    parts: PlanCellsArgs["parts"];
    /** The canvas's links: an event end its kind's cells do not hold is read by its key. */
    links: PlanCellsArgs["links"];
    /** The canvas's paged rows in view, as it reports them. */
    spans: PlanCellSpanStore;
    /** What confirmed Saves landed of the kinds read by their cells, and how it is let go: drawn until the cells are read again. */
    editing: PlanCellsArgs["editing"];
    /** Where the events go: called only when they move. */
    onLead: (lead: PlanEventLead) => void;
}

/**
 * The event kinds' events, read in a component of its own (#1343, #1344):
 * each search that lands re-runs it alone, and it hands the canvas what it
 * read only when it moves — a kind narrowed through an interval index lands
 * some fifty-five searches before its window is read, and each would otherwise
 * render the whole canvas. A kind read by its cells (#1039) is read here too,
 * every cell it wants in one request a read, and every other kind counted
 * before one of its events is read; the rows the canvas reports in view are
 * read here alone. What a Save landed of a kind read by its cells draws as the
 * Save left it until they are read again: its confirmation reads its events by
 * their keys, never the cells.
 *
 * @param props - What the events are read over, and where they go
 * @returns Nothing: it reads
 */
export function PlanEventsReader({ events, scale, hidden, drafts, kinds, rows, windowEntries, parts, links, spans, editing, onLead }: PlanEventsReaderProps): null {
    const span = useSyncExternalStore(spans.subscribe, spans.get);
    const range = eventReadRange(scale);
    // The reader decides every kind (#1039): one it reads by its cells, and every other, counted before one of its events is read.
    const cells = usePlanCells({
        kinds, landings: events?.landings ?? [], rows, windowEntries, parts, scale, range, drafts, hidden: hidden ?? NONE_HIDDEN, span, links, editing,
    });
    const lead = usePlanEventPlaced(events, scale, hidden, drafts, cells, kinds);
    // What the canvas holds: no events until the first read lands.
    const reported = useRef<{ version: number; error: PlanEventFailure | undefined; cells: ScheduleCellsRead | undefined }>({ version: 0, error: undefined, cells: undefined });
    useLayoutEffect(() => {
        // The same events, in the same state — each move of them moves the version, and a failure is the same object while
        // it fails the same way — and the same cells: nothing the canvas draws has moved.
        const was = reported.current;
        if (was.version === lead.version && was.error === lead.error && was.cells === lead.cells) return;
        reported.current = { version: lead.version, error: lead.error, cells: lead.cells };
        onLead(lead);
    });
    return null;
}

/** What a window is joined with: the events placed, which a join again follows row by row, and what else moving joins it whole. */
interface PlacedWith {
    /** The seam that joined it. */
    readonly seam: PlanEventSeamValue;
    /** The events placed. */
    readonly placed: PlanEventPlacedValue;
    /** The resources' shading: its scale is every row's, so it moving joins the window whole. */
    readonly shading: PlanEventShadingValue;
    /** The ids the viewer hides: how many rows each landing row makes. */
    readonly hidden: readonly string[];
}

/**
 * A window as the wrapper last joined it (#1712), kept by the blocks the source under the wrapper gave: where each of
 * its rows went, and what it was joined with, so that new events alone join again only the rows whose events moved.
 */
interface PlacedWindow {
    /** Each landing row's place among the window's blocks, by its landing series' key, then the key its events are filed under. */
    readonly rowsOf: ReadonlyMap<string, ReadonlyMap<string, readonly (readonly [block: number, row: number])[]>>;
    /** Each row's place among its block's joined rows: its own first, the rows of its further ways of drawing after it. */
    readonly places: readonly (readonly number[])[];
    /** The window as last joined. */
    joined: PlanWireBlock[];
    /** What it was joined with. */
    with: PlacedWith;
}

/**
 * Where each row of a window went when it was joined whole (#1712), and the landing rows each key's events are on: the
 * index a join of the moved rows alone writes through. Each row's own comes first of the rows it makes — a landing row
 * keeps its id, and every other row is as it was — and the rows of its further ways of drawing follow it.
 *
 * @param blocks - The window's blocks, as the source gave them
 * @param joined - The same, the events joined in
 * @param landings - The series the event kinds land on
 * @returns The index; `undefined` where the joined blocks hold some row's own out of its order, which no join row by row keeps
 */
function placedIndex(blocks: readonly PlanWireBlock[], joined: readonly PlanWireBlock[], landings: readonly PlanLandingValue[]):
    Pick<PlacedWindow, "rowsOf" | "places"> | undefined {
    if (joined.length !== blocks.length) return undefined;
    const rowsOf = new Map<string, Map<string, [number, number][]>>();
    const places: number[][] = [];
    for (let b = 0; b < blocks.length; b++) {
        const rows = blocks[b]!.rows;
        const out = joined[b]!.rows;
        const at: number[] = [];
        let j = 0;
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r]!;
            while (j < out.length && !Object.is(out[j]!.id, row.id) && !rowIdEqual(out[j]!.id, row.id)) j += 1;
            if (j === out.length) return undefined;
            at.push(j);
            j += 1;
            if (row.id.type !== "entry") continue;
            const { series, path } = row.id.value;
            const landing = landings.find((one) => one.draws.length > 0 && stringEqual(one.key, series));
            if (landing === undefined) continue;
            // Filed by its resource's key, as `place` reads it — a row a step beneath a resource's by the pair.
            const key = landing.under.type === "some" ? planChildRowKey(path[path.length - 2]!, path[path.length - 1]!) : path[path.length - 1]!;
            let filed = rowsOf.get(series);
            if (filed === undefined) rowsOf.set(series, (filed = new Map()));
            const held = filed.get(key);
            if (held === undefined) filed.set(key, [[b, r]]);
            else held.push([b, r]);
        }
        places.push(at);
    }
    return { rowsOf, places };
}

/**
 * The keys whose events moved between two placings (#1712), by landing series: a list against a list by East's
 * equality, in every way of drawing — events arrived, changed or left.
 *
 * @param was - The events a window was joined with
 * @param now - The events it is joined with now
 * @returns The keys, by landing series
 */
function movedKeys(was: PlanEventPlacedValue, now: PlanEventPlacedValue): Map<string, Set<string>> {
    const moved = new Map<string, Set<string>>();
    const mark = (series: string, key: string): void => {
        const keys = moved.get(series);
        if (keys === undefined) moved.set(series, new Set([key]));
        else keys.add(key);
    };
    for (const [series, byDraw] of now.on) {
        for (const [draw, byKey] of byDraw) {
            const then = was.on.get(series)?.get(draw);
            for (const [key, list] of byKey) {
                const before = then?.get(key);
                if (before === undefined || !listEqual(before, list)) mark(series, key);
            }
        }
    }
    for (const [series, byDraw] of was.on) {
        for (const [draw, byKey] of byDraw) {
            const next = now.on.get(series)?.get(draw);
            for (const key of byKey.keys()) if (next?.has(key) !== true) mark(series, key);
        }
    }
    return moved;
}

/**
 * A window joined again over new events alone (#1712): the rows filed under a key whose events moved joined in one
 * `place`, each written over its place, every other row the object it was. Each row makes as many rows as it did: that
 * is a matter of what the viewer hides, which has not moved.
 *
 * @param blocks - The window's blocks, as the source under the wrapper gave them
 * @param was - The window as last joined: kept as joined now
 * @param now - What it is joined with now, which differs from what it was joined with only in the events placed
 * @returns The window's blocks joined, in new arrays; `undefined` where the join gives some row other rows than its
 *   places hold, which only a join of the whole window places
 */
function rejoined(blocks: readonly PlanWireBlock[], was: PlacedWindow, now: PlacedWith): PlanWireBlock[] | undefined {
    // The rows whose events moved, by their block, as each block's index holds them.
    const moving = new Map<number, number[]>();
    if (!Object.is(was.with.placed, now.placed)) {
        for (const [series, keys] of movedKeys(was.with.placed, now.placed)) {
            const filed = was.rowsOf.get(series);
            for (const key of keys) {
                for (const [b, r] of filed?.get(key) ?? []) {
                    const rows = moving.get(b);
                    if (rows === undefined) moving.set(b, [r]);
                    else rows.push(r);
                }
            }
        }
    }
    const joined = [...was.joined];
    if (moving.size > 0) {
        const at = [...moving.keys()];
        const made = now.seam.place(at.map((b) => ({ ...blocks[b]!, rows: moving.get(b)!.map((r) => blocks[b]!.rows[r]!) })),
            now.placed, now.shading, [...now.hidden], false);
        if (made.length !== at.length) return undefined;
        for (let i = 0; i < at.length; i++) {
            const b = at[i]!;
            const places = was.places[b]!;
            const into = [...joined[b]!.rows];
            const out = made[i]!.rows;
            let k = 0;
            for (const r of moving.get(b)!) {
                const end = r + 1 < places.length ? places[r + 1]! : into.length;
                for (let j = places[r]!; j < end; j++) into[j] = out[k++]!;
            }
            if (k !== out.length) return undefined;
            joined[b] = { ...joined[b]!, rows: into };
        }
    }
    was.joined = joined;
    was.with = now;
    return joined;
}

/**
 * The root with the event kinds' events joined into its rows, and its links'
 * event ends named where the events draw (see the module docs).
 *
 * @param value - The latest root
 * @param data - Its data-stable twin
 * @param lead - The event kinds' events; `undefined` for a Plan with none
 * @param events - The Plan's event rows: the seam that places the events, and the series they land on
 * @param hidden - The ids the viewer hides in the library's Series tab: a further row whose kinds are all hidden is left out
 * @returns The two roots the canvas draws
 */
export function usePlanEventRoot(
    value: PlanRootValue, data: PlanRootValue, lead: PlanEventLead | undefined,
    events?: PlanEventRows | undefined, hidden: readonly string[] = NONE_HIDDEN,
): { value: PlanRootValue; data: PlanRootValue } {
    const seam = lead !== undefined ? events?.seam : undefined;
    const placed = lead?.placed ?? NOTHING_PLACED;
    const shading = lead?.shading ?? NO_SHADING;
    // Inline: the root's blocks with the events joined in, the Unassigned rows after them — one array for both roots,
    // whose rows hold the same data.
    const inline = useMemo(
        () => (seam !== undefined && data.rows.type === "inline" ? seam.place(data.rows.value, placed, shading, [...hidden], true) : undefined),
        [seam, data.rows, placed, shading, hidden]);
    // Paged: one wrapper per source, placing each window it serves with the latest events.
    const paged = seam !== undefined ? windowedSourceOf(value.rows) : undefined;
    const landings = events?.landings;
    const latest = useRef({ src: paged, seam, placed, shading, hidden, landings, version: lead?.version ?? 0 });
    latest.current = { src: paged, seam, placed, shading, hidden, landings, version: lead?.version ?? 0 };
    const wrapperOf = useRef<{ src: PlanPagedSourceValue; wrapped: PlanPagedSourceValue } | undefined>(undefined);
    const wrapped = useMemo((): PlanPagedSourceValue | undefined => {
        if (paged === undefined) return undefined;
        const prior = wrapperOf.current;
        if (prior !== undefined && pagedSourceEquivalent(prior.src, paged)) return prior.wrapped;
        // A window's blocks with the latest events joined in: no Unassigned row, an event on no row of the canvas's being
        // in no window.
        const placedIn = (blocks: readonly PlanWireBlock[]): PlanWireBlock[] => {
            const l = latest.current;
            return l.seam === undefined ? [...blocks] : l.seam.place([...blocks], l.placed, l.shading, [...l.hidden], false);
        };
        // Each window as last joined, by the blocks the source under this one gave: the same while they hold, which the
        // kept layer gives (`kept.ts`), so new events alone join again only the rows whose events moved (#1712).
        const windows = new WeakMap<readonly PlanWireBlock[], PlacedWindow>();
        const joinedIn = (blocks: readonly PlanWireBlock[]): PlanWireBlock[] => {
            const l = latest.current;
            if (l.seam === undefined) return [...blocks];
            const now: PlacedWith = { seam: l.seam, placed: l.placed, shading: l.shading, hidden: l.hidden };
            const was = windows.get(blocks);
            const again = was !== undefined && Object.is(was.with.seam, now.seam) && shadingEqual(was.with.shading, now.shading)
                && sameTexts(was.with.hidden, now.hidden) ? rejoined(blocks, was, now) : undefined;
            if (again !== undefined) return again;
            const joined = l.seam.place([...blocks], l.placed, l.shading, [...l.hidden], false);
            const index = placedIndex(blocks, joined, l.landings ?? NO_LANDINGS);
            if (index === undefined) windows.delete(blocks);
            else windows.set(blocks, { ...index, joined, with: now });
            return joined;
        };
        const next: PlanPagedSourceValue = {
            id: paged.id,
            page: (offset, limit) => {
                const l = latest.current;
                if (l.src === undefined) return none;
                const read = l.src.page(offset, limit);
                // The window's own entries stay beside its blocks.
                return read.type === "some" ? some({ rows: joinedIn(read.value.rows), entries: read.value.entries }) : read;
            },
            total: () => latest.current.src?.total() ?? none,
            // New events are a new revision: the driver reads its windows again, the rows it has standing in until they land.
            revision: () => {
                const l = latest.current;
                const r = l.src?.revision?.() ?? none;
                return some(`${r.type === "some" ? r.value : ""}#events-${l.version}`);
            },
            // A window standing in is drawn as it is composed now: the events joined into the data's own rows (#1599) —
            // where the source under this one, the canvas's editing's, says how it draws one.
            ...(under(paged)?.redraft === undefined || under(paged)?.redrafted === undefined ? {} : {
                redraft: (entries: Parameters<NonNullable<PlanPagedSourceValue["redraft"]>>[0]) => {
                    const own = under(latest.current.src)?.redraft?.(entries);
                    return own === undefined ? undefined : placedIn(own);
                },
                redrafted: () => `${under(latest.current.src)?.redrafted?.() ?? ""}#events-${latest.current.version}`,
            }),
            refresh: (revision) => latest.current.src?.refresh?.(revision) ?? null,
            seek: paged.seek.type === "some"
                ? some((query) => {
                    const s = latest.current.src?.seek;
                    return s !== undefined && s.type === "some" ? s.value(query) : none;
                })
                : none,
            // The snapshot of `data` itself (#1199): its own revision — and a live source's narrowing with it, whose rows a
            // key search's answer names (#1354) — which new events over it leave.
            snapshot: () => {
                const src = latest.current.src;
                return src === undefined ? none : snapshotOf(src) ?? none;
            },
            // A live source's narrowing, as it stands: the driver reads its windows again when it moves (#1354).
            ...(paged.query !== undefined ? { query: () => latest.current.src?.query?.() ?? "" } : {}),
            // The windows the driver holds, said on to the source under this one where it keeps what it made for each
            // (#1712): this wrapper keeps a window by the blocks that source gave, so it keeps what that one does.
            ...(under(paged)?.retain === undefined ? {} : {
                retain: (offsets: readonly bigint[]) => { under(latest.current.src)?.retain?.(offsets); },
            }),
        };
        wrapperOf.current = { src: paged, wrapped: next };
        return next;
    }, [paged]);
    const links = useMemo(
        () => (seam === undefined ? data.links
            : inline !== undefined ? resolveEventLinks(data.links, inline)
                : resolveEventLinks(data.links, [], placed, landings)),
        [seam, inline, data.links, placed, landings]);
    const rowsOf = useCallback((root: PlanRootValue): PlanRootValue["rows"] => {
        if (inline !== undefined) return variant("inline", inline) as PlanRootValue["rows"];
        if (wrapped !== undefined) return variant(windowedArm(root.rows), wrapped) as PlanRootValue["rows"];
        return root.rows;
    }, [inline, wrapped]);
    const active = seam !== undefined;
    const shownData = useMemo(
        () => (active ? { ...data, rows: rowsOf(data), links } : data),
        [active, data, rowsOf, links]);
    const shownValue = useMemo(
        () => (active ? { ...value, rows: rowsOf(value), links } : value),
        [active, value, rowsOf, links]);
    return { value: shownValue, data: shownData };
}

/** The keys of a row's elements, whatever way it draws. */
function elementKeysOf(row: PlanWireRow): readonly string[] {
    const k = row.kind;
    switch (k.type) {
        case "span": return k.value.runs.map((r) => r.key);
        case "buckets": return k.value.events.map((e) => e.key);
        case "cards": return k.value.chips.map((c) => c.key);
        case "events": return k.value.marks.map((m) => m.key);
        default: return [];
    }
}

/** A link's end. */
type PlanLinkEnd = PlanLinkValue["from"];

/** Whether a link's end names an event: an `entry` at no path, which no row's id is. */
function isEventEnd(end: PlanLinkEnd): boolean {
    return end.row.type === "entry" && end.row.value.path.length === 0;
}

/**
 * A root's links with each event end named where its event draws: the row
 * holding the element whose key is the event's ref as East prints it, and
 * that key — over rows read a page at a time, for an event on a row no window
 * holds, the resource's row by its id, from the events placed, where the
 * resource is an entry of the rows (see the module docs).
 *
 * @param links - The root's links
 * @param blocks - The rows with the events joined in, when they are all at hand
 * @param placed - The events placed, over rows read a page at a time
 * @param landings - The series they land on, beside `placed`
 * @returns The links — the same array when none names an event
 */
export function resolveEventLinks(
    links: PlanRootValue["links"], blocks: readonly PlanWireBlock[], placed?: PlanEventPlacedValue, landings?: readonly PlanLandingValue[],
): PlanRootValue["links"] {
    if (!links.some((l) => isEventEnd(l.from) || isEventEnd(l.to))) return links;
    // Where each element is, by its key — an event draws once.
    const where = new Map<string, PlanRowId>();
    for (const block of blocks) {
        for (const row of block.rows) for (const key of elementKeysOf(row)) where.set(key, row.id);
    }
    // Over rows read a page at a time (#1199, #1541): an event on a row the page does not hold is named from the event
    // alone — its landing series' row for the first way its kinds draw, `<landing>.<draw>` for each further one — where
    // its resource is an entry of the rows, its row's path its key alone. A resource nested beneath another row stands
    // at a path the event does not say: its row names the event once a window holds it, as every row found above does,
    // which a name made here never replaces.
    if (placed !== undefined && landings !== undefined) {
        for (const landing of landings) {
            const byDraw = landing.top ? placed.on.get(landing.key) : undefined;
            if (byDraw === undefined) continue;
            landing.draws.forEach((draw, i) => {
                const series = i === 0 ? landing.key : `${landing.key}.${draw.type}`;
                for (const [resource, list] of byDraw.get(draw.type) ?? []) {
                    const row = landingRowId(series, [resource]);
                    for (const one of list) {
                        const key = printEventRef({ kind: one.item.kind, key: one.item.key });
                        if (!where.has(key)) where.set(key, row);
                    }
                }
            });
        }
    }
    const resolve = (end: PlanLinkEnd): PlanLinkEnd => {
        if (!isEventEnd(end) || end.row.type !== "entry") return end;
        const key = printEventRef({ kind: end.row.value.series, key: end.run });
        const row = where.get(key);
        return row !== undefined ? { row, run: key } : end;
    };
    return links.map((l) => ({ ...l, from: resolve(l.from), to: resolve(l.to) }));
}
