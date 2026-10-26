/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Calendar's paged resource kind, a window at a time (#1424), as the
 * Plan's paged rows are read (#1199, #1344): the timeline's rows and the
 * Resources view's columns of the kind are the windows of its resources around
 * the view, {@link CALENDAR_PAGE_SIZE} to a window, read through the payload's
 * `paged` — the kind's own paged read, in its resources' key order, or its
 * source of the slice's narrowed rows, in the source's index's order. Its
 * resources are never read whole.
 *
 * The views say which of the kind's places they show, as their scroll rests
 * ({@link CalendarPagedDemand}); a reader of its own ({@link CalendarPagesReader})
 * reads the windows those places fall in and one either side, each once
 * (`shared/windowed.ts`' `WindowStore`), and hands the frame what it holds only
 * as that moves: a window landing renders the frame once, and a scroll renders
 * nothing of it. Across a new snapshot each window read stands in until its own
 * lands. Across a new narrowing — a choice of its source — the last view stands
 * in whole, retained, until the windows the view shows have landed under the new
 * one: the places then start again, the view at the top. A window whose read
 * failed is said once, where its rows would be, with Retry.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { StringType, equalFor, some, type option } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { PagedLoading } from "../shared/loading.js";
import { WindowStore, retryWindows, type WindowReader } from "../shared/windowed.js";
import { resourceKey, type CalendarRow, type CalendarValue } from "./model.js";

/** The paged resource kind, as the payload carries it. */
export type CalendarPagedValue = Extract<CalendarValue["paged"], { type: "some" }>["value"];

/** A window of the paged kind's resources, as the payload hands it. */
type PageRows = Extract<ReturnType<CalendarPagedValue["rows"]>, { type: "some" }>["value"];

/** How many of the paged kind's resources a window holds, as the Plan's paged windows hold. */
export const CALENDAR_PAGE_SIZE = 200;

const stringEqual = equalFor(StringType);
/** Whether two narrowings, as a source names them, are one — none being none. */
const sameNarrowing = (a: string | undefined, b: string | undefined): boolean => (a === undefined || b === undefined ? a === b : stringEqual(a, b));

/**
 * The paged kind's places a view shows, as it reports them: the first and the
 * last, in the kind's order, and the result they belong to — a new narrowing
 * is a new result, whose places start again.
 */
export interface CalendarPagedView {
    /** The first place shown. */
    readonly first: number;
    /** The last place shown. */
    readonly last: number;
    /** The result the places are of ({@link CalendarPages.result}). */
    readonly result: number;
}

/** Where the views report the paged kind's places they show, and the reader hears them: a store of one view. */
export interface CalendarPagedDemand {
    /** The view last reported; `undefined` before one is. */
    readonly get: () => CalendarPagedView | undefined;
    /** Reports the places shown: a view the store holds already moves nothing. */
    readonly set: (view: CalendarPagedView) => void;
    /** Hears each move; returns the unsubscribe. */
    readonly subscribe: (listener: () => void) => () => void;
}

/**
 * A store of the paged kind's places in view.
 *
 * @returns The store, holding none
 */
export function createPagedDemand(): CalendarPagedDemand {
    let view: CalendarPagedView | undefined;
    const listeners = new Set<() => void>();
    return {
        get: () => view,
        set(next) {
            if (view !== undefined && view.first === next.first && view.last === next.last && view.result === next.result) return;
            view = next;
            for (const listener of [...listeners]) listener();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}

/** What the frame shows of the paged kind: the windows it holds, by window, and what is known of the rest. */
export interface CalendarPages {
    /** The kind's slot. */
    readonly kind: string;
    /** Its name: the group its rows draw under. */
    readonly group: string;
    /** How many resources it has — its narrowing holds, when its source narrows it — once known. */
    readonly total: number | undefined;
    /** Each window held, its resources' rows in the order they draw, by window. */
    readonly windows: ReadonlyMap<number, readonly CalendarRow[]>;
    /** Each window whose read failed, by window: why. */
    readonly failed: ReadonlyMap<number, string>;
    /** Whether a window the view shows is read: the footer's line says so, and main is busy. */
    readonly reading: boolean;
    /** Whether what it holds stands in for a read again — a new snapshot's, a new narrowing's — retained until it lands. */
    readonly stale: boolean;
    /** The narrowing its windows serve, as the source names it; `undefined` where no source narrows the kind. */
    readonly narrowing: string | undefined;
    /** Which result its places are of: a new narrowing is a new one, whose places start again. */
    readonly result: number;
    /** Whether a window has landed: before then, the frame's cold load covers it. */
    readonly ready: boolean;
    /**
     * What the footer's loading line says of it (#1398, CL3): a window the view shows that could not be read, the
     * places it holds; a new narrowing's windows read while the last view stands in; a window the view shows in
     * flight, the places it holds; `undefined` while none is.
     */
    readonly line: PagedLoading | undefined;
    /** Asks every failed window again. */
    readonly retry: () => void;
}

/**
 * The resource at a place, once its window is held.
 *
 * @param pages - What the frame holds of the paged kind
 * @param at - The place, in the kind's order
 * @returns Its row; `undefined` while its window is not held
 */
export function pagedRowAt(pages: CalendarPages, at: number): CalendarRow | undefined {
    return pages.windows.get(Math.floor(at / CALENDAR_PAGE_SIZE))?.[at % CALENDAR_PAGE_SIZE];
}

/**
 * Why a place's window could not be read, while its read has failed.
 *
 * @param pages - What the frame holds of the paged kind
 * @param at - The place
 * @returns Why; `undefined` for a window not failed
 */
export function pagedFailureAt(pages: CalendarPages, at: number): string | undefined {
    return pages.failed.get(Math.floor(at / CALENDAR_PAGE_SIZE));
}

/**
 * How many places the views lay the paged kind out in: its count, once known;
 * before then, the places of the windows held from the first on.
 *
 * @param pages - What the frame holds of the paged kind
 * @returns The places
 */
export function pagedPlaces(pages: CalendarPages): number {
    if (pages.total !== undefined) return pages.total;
    let n = 0;
    for (let w = 0; pages.windows.has(w); w++) n += pages.windows.get(w)!.length;
    return n;
}

/**
 * The windows a view shows: those its places fall in — of the result it reads
 * now; a view of another result's places, or none reported yet, shows the
 * first window.
 *
 * @param view - The view last reported
 * @param result - The result read now
 * @returns The windows, ascending
 */
export function shownWindows(view: CalendarPagedView | undefined, result: number): number[] {
    if (view === undefined || view.result !== result) return [0];
    const out: number[] = [];
    for (let w = Math.floor(view.first / CALENDAR_PAGE_SIZE); w <= Math.floor(view.last / CALENDAR_PAGE_SIZE); w++) out.push(w);
    return out;
}

/**
 * The windows the reader reads: those the view shows and one either side, so a
 * scroll on finds the next one read — within the kind's count, once known.
 *
 * @param view - The view last reported
 * @param result - The result read now
 * @param total - How many resources the kind has, once known
 * @returns The windows, ascending
 */
export function wantedWindows(view: CalendarPagedView | undefined, result: number, total: number | undefined): number[] {
    const shown = shownWindows(view, result);
    const last = total === undefined ? Infinity : Math.max(0, Math.ceil(total / CALENDAR_PAGE_SIZE) - 1);
    const out: number[] = [];
    for (let w = Math.max(0, shown[0]! - 1); w <= Math.min(last, shown[shown.length - 1]! + 1); w++) out.push(w);
    return out.length > 0 ? out : [0];
}

/** Whether two maps of windows hold the same windows, each the same object. */
function sameWindows<T>(a: ReadonlyMap<number, T>, b: ReadonlyMap<number, T>): boolean {
    if (a.size !== b.size) return false;
    for (const [w, held] of a) if (!Object.is(b.get(w), held)) return false;
    return true;
}

/**
 * What the footer's loading line says of the windows the view shows: the first that failed, else the places of
 * those in flight, first to last, within the kind's count.
 *
 * @param shown - The windows the view shows
 * @param failed - Each failed window, why
 * @param inFlight - The windows in flight
 * @param total - How many resources the kind has, once known
 * @returns What the line says; `undefined` while no window the view shows is read or failed
 */
function lineOf(shown: readonly number[], failed: ReadonlyMap<number, string>, inFlight: readonly number[], total: number | undefined): PagedLoading | undefined {
    const span = (w: number) => ({ from: w * CALENDAR_PAGE_SIZE, to: Math.min(total ?? Infinity, (w + 1) * CALENDAR_PAGE_SIZE) - 1 });
    const broke = shown.find((w) => failed.has(w));
    if (broke !== undefined) return { kind: "failed", ...span(broke), reason: failed.get(broke)! };
    const reading = shown.filter((w) => inFlight.includes(w));
    if (reading.length === 0) return undefined;
    return { kind: "loading", from: span(reading[0]!).from, to: span(reading[reading.length - 1]!).to };
}

/** Whether two lines say the same. */
function sameLine(a: PagedLoading | undefined, b: PagedLoading | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    switch (a.kind) {
        case "filtering": return b.kind === "filtering";
        case "loading": return b.kind === "loading" && a.from === b.from && a.to === b.to;
        case "failed": return b.kind === "failed" && a.from === b.from && a.to === b.to && a.reason === b.reason;
    }
}

/** One read of the windows: what the reader found, under which narrowing and result. */
interface PagesRead {
    readonly narrowing: string | undefined;
    readonly result: number;
    readonly total: number | undefined;
    readonly windows: Map<number, readonly CalendarRow[]>;
    readonly failed: Map<number, string>;
    readonly inFlight: readonly number[];
    readonly stale: boolean;
}

/**
 * The paged kind's windows around the view, read in a component of its own
 * (see the module docs), handed to the frame only as what it holds moves.
 *
 * @param props - The paged kind, as the payload carries it; its name and icon, as its rows draw them; where the views
 *   report the places they show; and where the windows go
 * @returns Nothing: it reads
 */
export function CalendarPagesReader({ paged, name, icon, demand, onPages }: {
    paged: CalendarPagedValue; name: string; icon: string; demand: CalendarPagedDemand;
    onPages: (pages: CalendarPages) => void;
}): null {
    const view = useSyncExternalStore(demand.subscribe, demand.get, demand.get);
    // What the reader keeps: the windows read under the narrowing it reads now, and the result they are of.
    const [kept] = useState(() => ({ store: new WindowStore<readonly CalendarRow[]>(), narrowing: undefined as string | undefined, result: 0 }));
    const [asked, setAsked] = useState(0);
    const reader = useMemo((): WindowReader<PageRows, readonly CalendarRow[]> => ({
        page: (offset, limit) => paged.rows(offset, limit),
        decode: (rows) => rows.map((row): CalendarRow => ({
            key: resourceKey({ kind: paged.kind, key: row.key }), label: row.label, meta: row.meta.type === "some" ? row.meta.value : "",
            group: name, icon, resource: some({ kind: paged.kind, key: row.key }),
        })),
        label: "[Calendar]",
    }), [paged, name, icon]);
    const read = useCallback((): PagesRead => {
        // A choice of its source is a new result: its windows read again from none, its places starting again.
        const narrowing = paged.query.type === "some" ? paged.query.value() : undefined;
        if (kept.result === 0 || !sameNarrowing(narrowing, kept.narrowing)) {
            kept.store.drop();
            kept.narrowing = narrowing;
            kept.result += 1;
        }
        // A new snapshot reads every window again, each held one standing in until its own lands.
        const revision = paged.revision();
        kept.store.at(revision.type === "some" ? revision.value : undefined);
        const counted: option<bigint> = paged.total();
        const total = counted.type === "some" ? Number(counted.value) : undefined;
        const wanted = wantedWindows(view, kept.result, total);
        kept.store.prune(new Set(wanted));
        const reads = kept.store.read(reader, wanted, CALENDAR_PAGE_SIZE);
        return {
            narrowing, result: kept.result, total,
            windows: new Map(reads.resident.map(({ w, read: rows }) => [w, rows])),
            failed: new Map(reads.failed.map(({ w, error }) => [w, error])),
            inFlight: reads.inFlight, stale: reads.stale,
        };
        // `asked` moves with a Retry: the failed windows' records went, and they are read again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paged, view, reader, kept, asked]);
    const { result } = useTrackedEvaluation(read);
    const retry = useCallback(() => retryWindows(paged, () => { kept.store.forget(); setAsked((n) => n + 1); }), [paged, kept]);
    const held = useRef<CalendarPages | undefined>(undefined);
    if (!result.ok) console.error("[Calendar] the paged resources could not be read:", result.error);
    else {
        const r = result.value;
        const shown = shownWindows(view, r.result);
        const landed = shown.every((w) => r.windows.has(w) || r.failed.has(w));
        const was = held.current;
        if (was !== undefined && was.result !== r.result && !landed) {
            // A new narrowing: the last view stands in, whole and retained, until the windows the view shows land under it.
            if (!was.stale || !was.reading || was.line?.kind !== "filtering") held.current = { ...was, stale: true, reading: true, line: { kind: "filtering" } };
        } else {
            const reading = r.inFlight.some((w) => shown.includes(w));
            const ready = was?.ready === true || r.windows.size > 0 || r.failed.size > 0;
            const line = lineOf(shown, r.failed, r.inFlight, r.total);
            if (was === undefined || was.result !== r.result || was.total !== r.total || !sameWindows(was.windows, r.windows) || !sameWindows(was.failed, r.failed)
                || was.reading !== reading || was.stale !== r.stale || !sameNarrowing(was.narrowing, r.narrowing) || was.ready !== ready || was.retry !== retry
                || !sameLine(was.line, line)) {
                held.current = {
                    kind: paged.kind, group: name, total: r.total, windows: r.windows, failed: r.failed, reading, stale: r.stale,
                    narrowing: r.narrowing, result: r.result, ready, line, retry,
                };
            }
        }
    }
    const pages = held.current;
    useLayoutEffect(() => { if (pages !== undefined) onPages(pages); }, [pages, onPages]);
    return null;
}
