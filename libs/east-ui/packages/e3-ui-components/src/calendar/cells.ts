/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Calendar's event kinds as the shared schedule reader reads them
 * (#1424): the Calendar's adapter to `shared/schedule/cells.ts`, as the Plan's
 * `plan/root/cells.ts` is. Every kind is counted before one of its events is
 * read — through its source's interval index, the count its window's read
 * asks first; through its day index, by the days its events run on, an upper
 * bound (`countExact` false); or in memory, its record read whole — and past
 * `SCHEDULE_EVENT_CAP` over the window the view reads none is read or drawn.
 * Where the view lays its resources out — the timeline's rows, the Resources
 * view's columns — each resource of a kind such a kind is placed on shades
 * from its source's summary, the share of each period booked, or is hatched
 * where it has none to shade at the view's period; and the frame's banner
 * says how many events there are and to zoom in or narrow. A view with no
 * resource axis — a time grid, the month, the agenda — has no row to shade:
 * the banner alone says so.
 *
 * The adapter gives the reader what is the Calendar's, in the reader's terms:
 * each event kind — its slot, its name, its resource kinds, its cells' type,
 * its series key and its count — whose rows book their buckets, an event
 * drawn over its time; its source of the slice; the resource kinds the view
 * lays out, each its rows the rail shows, shaded by the kind's slot; and the
 * window the view reads, cut into its periods — the timeline's days, weeks or
 * months by its period, the Resources view's day — each whole, as e3 tiles
 * them, so a summary's tiles fold into a period whole.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import { StringType, equalFor } from "@elaraai/east";
import { tileNext, tileStart } from "@elaraai/east-ui/internal";
import {
    useScheduleCells, type ScheduleCellBucket, type ScheduleCellKind, type ScheduleCellResources, type ScheduleCellsRead,
} from "../shared/schedule/cells.js";
import type { ScheduleEventDraftsValue } from "../shared/schedule/editing.js";
import type { CalendarKind, CalendarRange } from "./model.js";
import type { CalendarEventPart } from "./window.js";

/** The periods a resource's shading is cut into: the timeline's day, week or month, the Resources view's day. */
export type CalendarBucket = "day" | "week" | "month";

const stringEqual = equalFor(StringType);
/** No event a kind's host wants by its key beyond what the reader reads: the Calendar reads one event by key itself. */
const NO_WANTED: readonly string[] = [];

/**
 * The periods a window is cut into, each whole as e3 tiles it — a day, an ISO
 * week from Monday, a calendar month, in UTC — from the one holding the
 * window's start to the one holding its last instant: what a summary's tiles
 * fold into whole.
 *
 * @param range - The window
 * @param bucket - The period
 * @returns The periods, in order; the first may start before the window, and the last end after it
 */
export function calendarBuckets(range: { readonly from: Date; readonly to: Date }, bucket: CalendarBucket): ScheduleCellBucket[] {
    const out: ScheduleCellBucket[] = [];
    for (let at = tileStart(bucket, range.from); at.getTime() < range.to.getTime();) {
        const next = tileNext(bucket, at);
        out.push({ start: at.getTime(), end: next.getTime() });
        at = next;
    }
    return out;
}

/** What {@link useCalendarCells} reads over. */
export interface CalendarCellsArgs {
    /** The event kinds, as the payload carries them. */
    readonly kinds: readonly CalendarKind[];
    /** Each event kind narrowed through its source of the slice: what it is counted and read through. */
    readonly parts: readonly CalendarEventPart[];
    /**
     * The resource kinds the view lays out, each its resources the rail shows: what a kind past the cap shades, or
     * hatches; none in a view with no resource axis.
     */
    readonly resources: readonly ScheduleCellResources[];
    /** The window the view reads. */
    readonly range: CalendarRange;
    /** The periods a resource's shading is cut into; `undefined` in a view with no resource axis, which shades none. */
    readonly bucket: CalendarBucket | undefined;
    /** Every kind's drafts — the same object while they hold. */
    readonly drafts: ScheduleEventDraftsValue;
}

/**
 * The kinds' counts and, past the cap, their shading and their notices (see
 * the module docs), read in the component that reads the window: what the
 * window's read takes each kind's decision from, and what the frame shades a
 * resource's row or column by and says in its banner.
 *
 * @param args - What it reads over
 * @returns What the shared reader read
 */
export function useCalendarCells(args: CalendarCellsArgs): ScheduleCellsRead {
    const { kinds, parts, resources, range, bucket, drafts } = args;
    const cellKinds = useMemo((): ScheduleCellKind[] => kinds.map((kind) => ({
        key: kind.key,
        name: kind.name,
        takes: kind.takes,
        // An event is a block over its time: a resource's shading is the share of each period its events book.
        booked: true,
        // A resource's row, or its column, is its own: the shading stands in for it by its kind's slot.
        shadeKey: (slot: string) => slot,
        cellsType: kind.cellsType,
        seriesKey: kind.seriesKey,
        count: kind.count,
        exact: kind.countExact,
        part: parts.find((p) => stringEqual(p.kind.key, kind.key))?.part,
        hidden: false,
        wanted: NO_WANTED,
    })), [kinds, parts]);
    const from = range.from.getTime();
    const to = range.to.getTime();
    const over = useMemo(() => ({ from: new Date(from), to: new Date(to) }), [from, to]);
    const buckets = useMemo(() => (bucket === undefined ? [] : calendarBuckets(over, bucket)), [over, bucket]);
    return useScheduleCells({
        host: "Calendar", kinds: cellKinds, resources, paged: undefined, range: over, buckets, resolution: bucket, drafts, span: undefined,
    });
}
