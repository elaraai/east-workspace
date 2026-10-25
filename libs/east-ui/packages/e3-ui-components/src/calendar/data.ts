/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tracked Schedule reads over the author-selected window, two of them, each a
 * read of its own (#1343, #1398):
 *
 * - **The window**: every event kind's events over it, and the backlog of
 *   each kind narrowed through its source of the slice, which reads its
 *   backlog and its window as one — a draft moves an event between them by its
 *   times alone — so that backlog follows the window. Once the window has
 *   landed, what a step goes to is read ahead (`shared/schedule/read-ahead.ts`,
 *   CL7) in a read of its own, so a step to it shows it at once and a page of
 *   it landing hands the frame nothing: the periods either side, or on the
 *   timeline the window a re-centre goes to the way its view travels
 *   (`timelineAhead`). A step further drops their reads.
 * - **The backlog apart**: each other backlog kind's — read whole, or through
 *   its backlog index — which follows no window. Read once, no date change
 *   reads it again: it stands through every re-centre and every step.
 *
 * The first read lands whole: the frame hears of neither until both have, so
 * it reveals what it read at once (CL5).
 *
 * @packageDocumentation
 */
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { DateTimeType, compareFor, some } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { EMPTY_SCHEDULE_DRAFTS, type ScheduleEditing } from "../shared/schedule/editing.js";
import { useReadAhead } from "../shared/schedule/use-read-ahead.js";
import { calendarAhead, chronological, resourceKey, type CalendarItem, type CalendarRange, type CalendarRow, type CalendarValue, type CalendarView } from "./model.js";
import { timelineAhead } from "./timeline.js";
import { useTravel, type TravelStore } from "./visible.js";
import { calendarEventParts } from "./window.js";

/** A window read, including the backlog of each kind that reads its backlog with its window. */
export interface CalendarData { items: CalendarItem[]; backlog: CalendarItem[]; loading: boolean; saved: Date | undefined }
const EMPTY: CalendarData = { items: [], backlog: [], loading: true, saved: undefined };
const compareDate = compareFor(DateTimeType);

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
 * The kinds that read their backlog with their window: each backlog kind narrowed through its source of the slice
 * (#1343) — as the kind's own reads do, its backlog through the same source as its window. Every other reads its
 * backlog whole or through its backlog index, whatever the window.
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
 * @param travel - On the timeline, which way its view travels: the window a re-centre that way goes to is read ahead
 * @returns What the frame shows
 */
export function useCalendarData(value: CalendarValue, range: CalendarRange, editing: ScheduleEditing | undefined, view: CalendarView,
    travel?: TravelStore): CalendarDataState {
    const drafts = editing?.drafts;
    const windowed = useMemo(() => windowedBacklogKinds(value), [value]);
    const read = useCallback((): CalendarData => {
        const items: CalendarItem[] = []; const backlog: CalendarItem[] = [];
        let loading = false;
        let saved: Date | undefined;
        for (const kind of value.events) {
            const changes = drafts?.get(kind.key) ?? EMPTY_SCHEDULE_DRAFTS;
            const scheduled = kind.items(range.from, range.to, changes);
            if (scheduled.type === "some") { for (const item of scheduled.value) items.push(item); } else loading = true;
            const history = kind.history();
            const latest = history.type === "some" ? history.value[0]?.at : undefined;
            if (latest !== undefined && (saved === undefined || compareDate(latest, saved) > 0)) saved = latest;
            if (kind.backlog && windowed.has(kind.key)) {
                const unscheduled = kind.unscheduled(range.from, range.to, changes);
                if (unscheduled.type === "some") { for (const item of unscheduled.value) backlog.push(item); } else loading = true;
            }
        }
        return { items: chronological(items), backlog, loading, saved };
    }, [value.events, range.from, range.to, drafts, windowed]);
    const { result } = useTrackedEvaluation(read);
    // The backlog apart from the window: asked over no window, so no date change asks it again.
    const readApart = useCallback(() => {
        const items: CalendarItem[] = [];
        let loading = false;
        for (const kind of value.events) {
            if (!kind.backlog || windowed.has(kind.key)) continue;
            const unscheduled = kind.unscheduled(EVER.from, EVER.to, drafts?.get(kind.key) ?? EMPTY_SCHEDULE_DRAFTS);
            if (unscheduled.type === "some") { for (const item of unscheduled.value) items.push(item); } else loading = true;
        }
        return { items, loading };
    }, [value.events, drafts, windowed]);
    const { result: apartResult } = useTrackedEvaluation(readApart);
    // Once the window has landed, what a step goes to is read ahead (CL7), each as it is read, its backlog with it where
    // its backlog follows the window — in a read of its own, so a page of it landing runs the window's read no more.
    const toward = useTravel(travel);
    const ahead = useMemo(() => travel !== undefined ? timelineAhead(range, toward, view.period) : calendarAhead(view, value.settings),
        [travel, range, toward, view, value.settings]);
    const readNext = useCallback((next: CalendarRange) => {
        for (const kind of value.events) {
            const changes = drafts?.get(kind.key) ?? EMPTY_SCHEDULE_DRAFTS;
            kind.items(next.from, next.to, changes);
            if (kind.backlog && windowed.has(kind.key)) kind.unscheduled(next.from, next.to, changes);
        }
    }, [value.events, drafts, windowed]);
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

/**
 * The window read, in a component of its own (#1343): each search that lands re-runs it alone, and it hands the frame
 * its data only when what the frame shows moves. A kind narrowed through an interval index lands some fifty-five
 * searches before its count is known, and each would otherwise re-render the whole frame.
 *
 * @param props - The payload, the range read, the editing whose drafts the read holds, the view and, on the timeline,
 *   which way its view travels (what is read ahead once the window lands), and where the data goes
 * @returns Nothing: it reads
 */
export function CalendarDataReader({ value, range, editing, view, travel, onData }: {
    value: CalendarValue; range: CalendarRange; editing: ScheduleEditing | undefined; view: CalendarView; travel?: TravelStore | undefined;
    onData: (data: CalendarDataState) => void;
}): null {
    const data = useCalendarData(value, range, editing, view, travel);
    const reported = useRef<CalendarDataState | undefined>(undefined);
    useLayoutEffect(() => {
        const was = reported.current;
        // The same held read over the same range, in the same state: nothing the frame shows has moved.
        if (was !== undefined && Object.is(was.items, data.items) && Object.is(was.backlog, data.backlog) && Object.is(was.range, data.range)
            && was.ready === data.ready && was.loading === data.loading && was.error === data.error && Object.is(was.apart, data.apart)) return;
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
