/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tracked Schedule reads over the author-selected window, two of them, each a
 * read of its own (#1343, #1398):
 *
 * - **The window**: every event kind's events over it. Once the window has
 *   landed, what a step goes to is read ahead (`shared/schedule/read-ahead.ts`,
 *   CL7) in a read of its own, so a step to it shows it at once and a page of
 *   it landing hands the frame nothing: the periods either side, or on the
 *   timeline the next window of its grid the way its view last moved — as it
 *   scrolls, or as a step moved its dates (`timelineAhead`, ruled 25 Oct
 *   2026). A step further drops their reads.
 * - **The backlog apart**: each backlog kind's not narrowed through a source
 *   of the slice — read whole, or through its backlog index — which follows no
 *   window. Read once, no date change reads it again: it stands through every
 *   re-centre and every step. A kind narrowed through its source has its
 *   backlog read a page at a time by the Backlog tab itself (`backlog-pages.ts`,
 *   #1424), through the source with its start Unset, never with the window:
 *   its window's read reads the window's rows alone, and its drafts are the
 *   shared reader's — those of events its narrowing does not hold left out — so
 *   a backlog event a gesture scheduled draws where it is placed.
 *
 * The first read lands whole: the frame hears of neither until both have, so
 * it reveals what it read at once (CL5).
 *
 * Every kind is counted before one of its events is read (#1424), by the
 * shared schedule reader (`cells.ts`), which reads beside the window in the
 * same component: within `SCHEDULE_EVENT_CAP` over the window, the window's
 * read reads it — once its count there says so, never by what the reader last
 * decided, which a new narrowing outruns; past it, none of its events is read
 * or drawn (`capped`), its drafts alone drawn where they place their events,
 * and its backlog read alone, beside them. Where the view lays out the paged
 * resource kind's resources (`pages.ts`), a kind placed on it is read a cell
 * at a time instead, around the rows the views say they show, and the window's
 * read takes its events from the cells — never over the window.
 *
 * @packageDocumentation
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { DateTimeType, SortedMap, StringType, compareFor, none, some } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { scheduleWithinCap, type ScheduleCellResources, type ScheduleCellSpan, type ScheduleCellsRead } from "../shared/schedule/cells.js";
import { EMPTY_SCHEDULE_DRAFTS, type ScheduleEditing, type ScheduleEventDraftsValue } from "../shared/schedule/editing.js";
import { useReadAhead } from "../shared/schedule/use-read-ahead.js";
import { calendarCellSpan, calendarCellsPaged, useCalendarCells, type CalendarBucket } from "./cells.js";
import { calendarAhead, chronological, resourceKey, type CalendarItem, type CalendarRange, type CalendarRow, type CalendarValue, type CalendarView } from "./model.js";
import type { CalendarPagedDemand, CalendarPagedView, CalendarPages } from "./pages.js";
import { timelineAhead } from "./timeline.js";
import { useTravel, type TravelStore } from "./visible.js";
import { calendarEventParts } from "./window.js";

/** A window read: every kind's events over it. */
export interface CalendarData {
    items: CalendarItem[]; loading: boolean; saved: Date | undefined;
    /**
     * The kinds past the cap over the window (#1424): none of their events is read or drawn but their drafts, so no
     * figure the Calendar says counts them — it says they are not counted, never 0.
     */
    capped: ReadonlySet<string>;
    /**
     * What the shared reader read of the kinds as this read took it (#1424) — the resources' shading and the notices of
     * the kinds past the cap — held with the events, so the frame hears of them as it hears of the window, whole;
     * `undefined` before a read.
     */
    cells: ScheduleCellsRead | undefined;
}
/** No kind past the cap. */
const NONE_CAPPED: ReadonlySet<string> = new Set();
const EMPTY: CalendarData = { items: [], loading: true, saved: undefined, capped: NONE_CAPPED, cells: undefined };
const compareDate = compareFor(DateTimeType);
/** No drafts: a read-only Calendar's. */
const NO_DRAFTS: ScheduleEventDraftsValue = new SortedMap([], compareFor(StringType));

/**
 * The backlog of every kind whose backlog follows no window, read apart from
 * the window: its last complete read, which stands while another is in flight.
 */
export interface CalendarApartBacklog {
    /** Its rows, in the kinds' order: none before its first read lands. */
    readonly items: readonly CalendarItem[];
    /** Whether a read of it has completed. */
    readonly ready: boolean;
    /** Whether a read of it is in flight. */
    readonly loading: boolean;
    /** Why its latest read failed. */
    readonly error: string | undefined;
}

/** What the frame shows of the window read: the last complete read, its range, and whether a newer one is in flight or failed. */
export interface CalendarDataState extends CalendarData {
    /** The range the held read covers. */
    range: CalendarRange;
    /** Whether any read has completed. */
    ready: boolean;
    /** Why the latest read failed. */
    error: string | undefined;
    /** The backlog of each kind that reads its backlog apart from the window. */
    apart: CalendarApartBacklog;
}

/** The backlog apart, before its first read. */
const NO_APART: CalendarApartBacklog = { items: [], ready: false, loading: true, error: undefined };

/**
 * The frame's data before its reader first reports: nothing held, a read in flight.
 *
 * @param range - The range the frame reads
 * @returns The state
 */
export function initialCalendarData(range: CalendarRange): CalendarDataState {
    return { ...EMPTY, range, ready: false, error: undefined, apart: NO_APART };
}

/** The whole of time: what a kind whose backlog follows no window is asked its backlog over — it takes no notice of it. */
const EVER = { from: new Date(-8_640_000_000_000_000), to: new Date(8_640_000_000_000_000) };

/** Why a read failed, in its own words: an Error's message, never its `Error: ` prefix. */
function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The kinds whose backlog is paged through their sources (#1424): each backlog kind narrowed through its source of the
 * slice (#1343) — read a page at a time by the Backlog tab, through the source with its start Unset (`backlog-pages.ts`).
 * Every other reads its backlog whole or through its backlog index, apart from the window.
 *
 * @param value - The payload
 * @returns Their slots
 */
export function windowedBacklogKinds(value: CalendarValue): ReadonlySet<string> {
    return new Set(calendarEventParts(value).flatMap(({ kind }) => kind.backlog ? [kind.key] : []));
}

/**
 * The window's read and the backlog's apart from it (see the module docs), and once the window lands, what a step goes
 * to read ahead.
 *
 * @param value - The payload
 * @param range - The window shown
 * @param editing - The editing whose drafts the reads hold
 * @param view - The view: what a step from it goes to is read ahead
 * @param cells - What the shared reader read of the kinds (#1424): a kind it gives cells — past the cap, none — is read
 *   from them; every other is counted over the window and read only within the cap
 * @param travel - On the timeline, which way its view last moved, by its scroll or a step: the next window of its grid that way is read ahead
 * @returns What the frame shows
 */
export function useCalendarData(value: CalendarValue, range: CalendarRange, editing: ScheduleEditing | undefined, view: CalendarView,
    cells: ScheduleCellsRead, travel?: TravelStore): CalendarDataState {
    const drafts = editing?.drafts;
    const windowed = useMemo(() => windowedBacklogKinds(value), [value]);
    const read = useCallback((): CalendarData => {
        const items: CalendarItem[] = [];
        let loading = false;
        let saved: Date | undefined;
        const capped = new Set<string>();
        for (const kind of value.events) {
            // A kind the reader gives cells is read from them — past the cap, none: its drafts alone draw, where they place
            // their events (#1424). Every kind's drafts are the reader's: a kind read by its cells, or over the window's
            // rows alone, without those of events its narrowing does not hold.
            const held = cells.reads.get(kind.key);
            const changes = cells.drafts.get(kind.key) ?? EMPTY_SCHEDULE_DRAFTS;
            const given = held === undefined ? none : some(held);
            if (held === undefined) {
                // Every other kind is read over the window once its count there says it is within the cap — never by what
                // the reader last decided, which a new narrowing outruns: past it, or in flight, the window waits on the
                // reader, which gives it no cells.
                const within = scheduleWithinCap(kind.count, range.from, range.to);
                if (within.type !== "some" || !within.value) { loading = true; continue; }
            } else if (cells.capped.has(kind.key)) {
                capped.add(kind.key);
            }
            const scheduled = kind.items(range.from, range.to, changes, given);
            if (scheduled.type === "some") { for (const item of scheduled.value) items.push(item); } else loading = true;
            const history = kind.history();
            const latest = history.type === "some" ? history.value[0]?.at : undefined;
            if (latest !== undefined && (saved === undefined || compareDate(latest, saved) > 0)) saved = latest;
        }
        return { items: chronological(items), loading, saved, capped: capped.size === 0 ? NONE_CAPPED : capped, cells };
    }, [value.events, range.from, range.to, cells]);
    const { result } = useTrackedEvaluation(read);
    // The backlog apart from the window: asked over no window, so no date change asks it again.
    const readApart = useCallback(() => {
        const items: CalendarItem[] = [];
        let loading = false;
        for (const kind of value.events) {
            if (!kind.backlog || windowed.has(kind.key)) continue;
            const unscheduled = kind.unscheduled(EVER.from, EVER.to, drafts?.get(kind.key) ?? EMPTY_SCHEDULE_DRAFTS, none);
            if (unscheduled.type === "some") { for (const item of unscheduled.value) items.push(item); } else loading = true;
        }
        return { items, loading };
    }, [value.events, drafts, windowed]);
    const { result: apartResult } = useTrackedEvaluation(readApart);
    // Once the window has landed, what a step goes to is read ahead (CL7), each as it is read — in a read of its own, so a
    // page of it landing runs the window's read no more.
    const toward = useTravel(travel);
    const ahead = useMemo(() => travel !== undefined ? timelineAhead(range, toward, view.period) : calendarAhead(view, value.settings),
        [travel, range, toward, view, value.settings]);
    const readNext = useCallback((next: CalendarRange) => {
        for (const kind of value.events) {
            // A kind the reader gives cells is never read over a window (#1424). Every other is counted there first, and
            // read only within the cap.
            if (cells.reads.has(kind.key)) continue;
            kind.items(next.from, next.to, cells.drafts.get(kind.key) ?? EMPTY_SCHEDULE_DRAFTS, none);
        }
    }, [value.events, cells]);
    useReadAhead(result.ok && !result.value.loading, ahead, readNext);
    const held = useRef(EMPTY);
    const heldRange = useRef(range);
    // A pending or failed replacement is not a partial/empty result. Publish
    // scheduled rows, backlog and their time geometry together when ready.
    if (result.ok && !result.value.loading) { held.current = result.value; heldRange.current = range; }
    const complete = held.current;
    const completeRange = heldRange.current;
    const loading = result.ok && result.value.loading;
    const error = result.ok ? undefined : reasonOf(result.error);
    const heldApart = useRef<readonly CalendarItem[] | undefined>(undefined);
    if (apartResult.ok && !apartResult.value.loading) heldApart.current = apartResult.value.items;
    const apartItems = heldApart.current;
    const apartLoading = apartResult.ok && apartResult.value.loading;
    const apartError = apartResult.ok ? undefined : reasonOf(apartResult.error);
    const apart = useMemo((): CalendarApartBacklog => ({ items: apartItems ?? NO_APART.items, ready: apartItems !== undefined, loading: apartLoading, error: apartError }),
        [apartItems, apartLoading, apartError]);
    // The first read lands whole (CL5): until the window and the backlog apart have both landed — or one failed — the
    // frame hears nothing of either.
    const first = complete !== EMPTY && (apart.ready || apart.error !== undefined);
    // Intermediate page arrivals advance the tracked read, but do not change
    // the displayed window. Keep its identity until there is something to show.
    return useMemo(() => first || error !== undefined
        ? { ...complete, range: completeRange, ready: complete !== EMPTY, loading, error, apart }
        : { ...EMPTY, range: completeRange, ready: false, loading: true, error: undefined, apart: NO_APART },
    [first, complete, completeRange, loading, error, apart]);
}

/** Nothing to hear: no paged resource kind. */
const NOTHING = () => () => {};
/** No places in view: no paged resource kind. */
const NO_VIEW = (): CalendarPagedView | undefined => undefined;

/**
 * The window read, in a component of its own (#1343): each search that lands re-runs it alone, and it hands the frame
 * its data only when what the frame shows moves. A kind narrowed through an interval index lands some fifty-five
 * searches before its count is known, and each would otherwise re-render the whole frame. The kinds' counts, and past
 * the cap their shading and their notices, are read here too, by the shared reader (#1424) — and where the view lays out
 * the paged resource kind's resources, the cells of a kind placed on it, around the rows the views say they show, which
 * they report to a store this component alone hears: a scroll renders nothing of the frame.
 *
 * @param props - The payload, the range read, the editing whose drafts the read holds, the view and, on the timeline,
 *   which way its view travels (what is read ahead once the window lands); the resource kinds the view lays out, each its
 *   rows the rail shows, and the periods a resource's shading is cut into — none in a view with no resource axis; what
 *   the frame holds of the paged resource kind and where the views report its places they show; and where the data goes
 * @returns Nothing: it reads
 */
export function CalendarDataReader({ value, range, editing, view, travel, resources, bucket, pages, demand, onData }: {
    value: CalendarValue; range: CalendarRange; editing: ScheduleEditing | undefined; view: CalendarView; travel?: TravelStore | undefined;
    resources: readonly ScheduleCellResources[]; bucket: CalendarBucket | undefined;
    pages: CalendarPages | undefined; demand: CalendarPagedDemand | undefined;
    onData: (data: CalendarDataState) => void;
}): null {
    const parts = useMemo(() => calendarEventParts(value), [value]);
    // The paged kind, where the view lays its resources out: a kind placed on it is read a cell at a time, around the
    // rows the views say they show. A view that lays no resource out counts such a kind over the window, as any other.
    const paged = useMemo(() => (value.paged.type === "some" && bucket !== undefined ? calendarCellsPaged(value.paged.value) : undefined), [value.paged, bucket]);
    const places = useSyncExternalStore(demand?.subscribe ?? NOTHING, demand?.get ?? NO_VIEW, demand?.get ?? NO_VIEW);
    const standing = useRef<ScheduleCellSpan | undefined>(undefined);
    const span = calendarCellSpan(places, pages, standing.current);
    standing.current = span;
    const cells = useCalendarCells({ kinds: value.events, parts, resources, range, bucket, drafts: editing?.drafts ?? NO_DRAFTS, paged, span: paged === undefined ? undefined : span });
    const data = useCalendarData(value, range, editing, view, cells, travel);
    const reported = useRef<CalendarDataState | undefined>(undefined);
    useLayoutEffect(() => {
        const was = reported.current;
        // The same held read over the same range, in the same state, and the same cells: nothing the frame shows has moved.
        if (was !== undefined && Object.is(was.items, data.items) && Object.is(was.range, data.range)
            && was.ready === data.ready && was.loading === data.loading && was.error === data.error && Object.is(was.apart, data.apart)
            && Object.is(was.cells, data.cells)) return;
        reported.current = data;
        onData(data);
    });
    return null;
}

/** Named resource rows, preserving the author's declaration order. */
export function resourceRows(resources: CalendarValue["resources"]): CalendarRow[] {
    return resources.flatMap(kind => kind.rows.map(row => ({ key: resourceKey({ kind: kind.key, key: row.key }),
        label: row.label, meta: row.meta.type === "some" ? row.meta.value : "", group: kind.name, icon: kind.icon,
        resource: some({ kind: kind.key, key: row.key }),
    })));
}
