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
 * A throwing count, revision or narrowing is the source's failure, as the
 * Plan's and the Sheet's drivers take one (#811, #853): caught inside the read,
 * never thrown out of it, it ends the cold load and is said on the footer's
 * loading line with Retry (`sourceError`); a source that cannot say which
 * snapshot it serves fails its windows too, each said where its places would
 * be.
 *
 * The views lay the kind's places out as stretches ({@link pagedSegments}):
 * each window held, its rows; each window whose read failed; and the places
 * between not read yet, one run each — never a line, a column or an object a
 * place, so a kind of a million resources costs a view what its windows held
 * do.
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
/** Whether two narrowings, or two revisions, as a source names them, are one — none being none. */
const sameNarrowing = (a: string | undefined, b: string | undefined): boolean => (a === undefined || b === undefined ? a === b : stringEqual(a, b));

/** Why a read threw, in its own words: an Error's message, never its `Error: ` prefix. */
function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

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
    /**
     * Why the kind's own reads — its count, its revision, its narrowing — threw: the source's failure, as the Plan's and
     * the Sheet's drivers take one; `undefined` while none did. It ends the cold load and is said on the footer's line,
     * with Retry; the windows a source that cannot say its snapshot fails are said where their places would be.
     */
    readonly sourceError: string | undefined;
    /** Whether a window the view shows is read: the footer's line says so, and main is busy. */
    readonly reading: boolean;
    /** Whether what it holds stands in for a read again — a new snapshot's, a new narrowing's — retained until it lands. */
    readonly stale: boolean;
    /** The narrowing its windows serve, as the source names it; `undefined` where no source narrows the kind. */
    readonly narrowing: string | undefined;
    /** Which result its places are of: a new narrowing is a new one, whose places start again. */
    readonly result: number;
    /** Whether a window has landed, or a read of the kind failed: before then, the frame's cold load covers it. */
    readonly ready: boolean;
    /**
     * What the footer's loading line says of it (#1398, CL3): a window the view shows that could not be read, the
     * places it holds; else the kind's own reads that failed, with no places; a new narrowing's windows read while the
     * last view stands in; a window the view shows in flight, the places it holds; `undefined` while none is.
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
 * before then, the places of the windows in from the first on — each held
 * window's rows, and a window whose read failed a whole window, as the Plan's
 * failed window spans one before the count is known (`failedSpan`), so its
 * failure is said where its places would be.
 *
 * @param pages - What the frame holds of the paged kind
 * @returns The places
 */
export function pagedPlaces(pages: CalendarPages): number {
    if (pages.total !== undefined) return pages.total;
    let n = 0;
    for (let w = 0; ; w++) {
        const held = pages.windows.get(w);
        if (held !== undefined) n += held.length;
        else if (pages.failed.has(w)) n += CALENDAR_PAGE_SIZE;
        else return n;
    }
}

/**
 * A stretch of the paged kind's places, as the views lay them out (#1424): a
 * window held, its rows from its first place on; a window whose read failed,
 * its places; or places not read yet, one run however many.
 */
export type CalendarPagedSegment =
    | { readonly kind: "held"; readonly from: number; readonly rows: readonly CalendarRow[] }
    | { readonly kind: "failed"; readonly from: number; readonly to: number }
    | { readonly kind: "unread"; readonly from: number; readonly to: number };

/**
 * The paged kind's places in their order as stretches (see
 * {@link CalendarPagedSegment}): each window the frame holds or whose read
 * failed, and one run for each stretch of places between them not read yet —
 * as many stretches as the windows held, however many places the kind has,
 * never one a place.
 *
 * @param pages - The windows the frame holds of the paged kind, and those whose read failed
 * @param places - How many places it lays out ({@link pagedPlaces})
 * @returns The stretches, in the kind's order, covering every place once
 */
export function pagedSegments(pages: Pick<CalendarPages, "windows" | "failed">, places: number): CalendarPagedSegment[] {
    const windows = [...new Set([...pages.windows.keys(), ...pages.failed.keys()])].sort((a, b) => a - b);
    const out: CalendarPagedSegment[] = [];
    let at = 0;
    for (const w of windows) {
        const from = w * CALENDAR_PAGE_SIZE;
        if (from >= places) break;
        if (from > at) out.push({ kind: "unread", from: at, to: from - 1 });
        const held = pages.windows.get(w);
        if (held !== undefined) {
            // A window as held: its rows, as many as the places reach — a window the count has since cut, its first.
            const rows = held.length > places - from ? held.slice(0, places - from) : held;
            if (rows.length > 0) out.push({ kind: "held", from, rows });
            at = from + rows.length;
            continue;
        }
        const to = Math.min(places, from + CALENDAR_PAGE_SIZE) - 1;
        out.push({ kind: "failed", from, to });
        at = to + 1;
    }
    if (at < places) out.push({ kind: "unread", from: at, to: places - 1 });
    return out;
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
 * What the footer's loading line says of the windows the view shows: the first that failed; else the kind's own reads
 * that failed — its count, its revision, its narrowing — with no places, as the Plan's line says its source's; else the
 * places of those in flight, first to last, within the kind's count.
 *
 * @param shown - The windows the view shows
 * @param failed - Each failed window, why
 * @param inFlight - The windows in flight
 * @param total - How many resources the kind has, once known
 * @param sourceError - Why the kind's own reads failed, while one did
 * @returns What the line says; `undefined` while no window the view shows is read or failed, and the kind's reads hold
 */
function lineOf(shown: readonly number[], failed: ReadonlyMap<number, string>, inFlight: readonly number[], total: number | undefined,
    sourceError: string | undefined): PagedLoading | undefined {
    const span = (w: number) => ({ from: w * CALENDAR_PAGE_SIZE, to: Math.min(total ?? Infinity, (w + 1) * CALENDAR_PAGE_SIZE) - 1 });
    const broke = shown.find((w) => failed.has(w));
    if (broke !== undefined) return { kind: "failed", ...span(broke), reason: failed.get(broke)! };
    if (sourceError !== undefined) return { kind: "failed", from: undefined, to: undefined, reason: sourceError };
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

/** One read of the windows: what the reader found, under which narrowing and result, and why the kind's own reads failed. */
interface PagesRead {
    readonly narrowing: string | undefined;
    readonly result: number;
    readonly total: number | undefined;
    readonly windows: ReadonlyMap<number, readonly CalendarRow[]>;
    readonly failed: ReadonlyMap<number, string>;
    readonly inFlight: readonly number[];
    readonly stale: boolean;
    readonly sourceError: string | undefined;
}

/** No window held, and none failed: before a read that threw has held any. */
const NO_WINDOWS: ReadonlyMap<number, readonly CalendarRow[]> = new Map();
const NO_FAILURES: ReadonlyMap<number, string> = new Map();
/** No window in flight. */
const NONE_IN_FLIGHT: readonly number[] = [];

/** What the reader keeps from read to read: the windows read under the narrowing it reads now, the result they are of, and the count last read. */
interface PagesKept {
    readonly store: WindowStore<readonly CalendarRow[]>;
    narrowing: string | undefined;
    result: number;
    /** The count the kind last gave, the result and the revision it was read at: it holds while a read of it fails at the same ones. */
    counted: { readonly result: number; readonly revision: string | undefined; readonly total: number } | undefined;
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
    // What the reader keeps: the windows read under the narrowing it reads now, the result they are of, the count last read.
    const [kept] = useState((): PagesKept => ({ store: new WindowStore<readonly CalendarRow[]>(), narrowing: undefined, result: 0, counted: undefined }));
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
        // The kind's own reads first — its narrowing, its revision, its count — each caught: one that throws is the
        // source's failure (#811, #853), said with Retry, as the Plan's and the Sheet's drivers say theirs, never thrown
        // out of the read, which would leave the frame's cold load up with nothing said.
        let sourceError: string | undefined;
        // A choice of its source is a new result: its windows read again from none, its places starting again.
        let narrowing = kept.narrowing;
        let narrowed = true;
        if (paged.query.type === "some") {
            try {
                narrowing = paged.query.value();
            } catch (err) {
                console.error("[Calendar] the paged resources' narrowing could not be read:", err);
                sourceError = reasonOf(err);
                narrowed = false;
            }
        }
        if (kept.result === 0 || (narrowed && !sameNarrowing(narrowing, kept.narrowing))) {
            kept.store.drop();
            kept.narrowing = narrowing;
            kept.result += 1;
        }
        // A new snapshot reads every window again, each held one standing in until its own lands. A source that cannot
        // say which snapshot it serves has failed as a whole: its windows then fail too, each said where its places are.
        let revision = kept.store.revision;
        try {
            const served: option<string> = paged.revision();
            revision = served.type === "some" ? served.value : undefined;
        } catch (err) {
            console.error("[Calendar] the paged resources' revision could not be read:", err);
            sourceError ??= reasonOf(err);
        }
        kept.store.at(revision);
        let total: number | undefined;
        try {
            const counted: option<bigint> = paged.total();
            if (counted.type === "some") total = Number(counted.value);
        } catch (err) {
            console.error("[Calendar] the paged resources could not be counted:", err);
            sourceError ??= reasonOf(err);
            // The count this result last gave at this revision still holds — the same resources — so the places stand
            // while the failure is said beside them.
            const last = kept.counted;
            if (last !== undefined && last.result === kept.result && sameNarrowing(last.revision, revision)) total = last.total;
        }
        if (total !== undefined) kept.counted = { result: kept.result, revision, total };
        const wanted = wantedWindows(view, kept.result, total);
        kept.store.prune(new Set(wanted));
        const reads = kept.store.read(reader, wanted, CALENDAR_PAGE_SIZE);
        return {
            narrowing: kept.narrowing, result: kept.result, total,
            windows: new Map(reads.resident.map(({ w, read: rows }) => [w, rows])),
            failed: new Map(reads.failed.map(({ w, error }) => [w, error])),
            inFlight: reads.inFlight, stale: reads.stale, sourceError,
        };
        // `asked` moves with a Retry: the failed windows' records went, and they are read again.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paged, view, reader, kept, asked]);
    const { result } = useTrackedEvaluation(read);
    // A Retry asks again now (#1398, `retryWindows`): the source rearms what failed — its windows, and the revision it
    // could not find — then the failed windows' records go and the windows are read again.
    const retry = useCallback(() => retryWindows(paged, () => { kept.store.forget(); setAsked((n) => n + 1); }), [paged, kept]);
    const held = useRef<CalendarPages | undefined>(undefined);
    const was = held.current;
    // The read catches the kind's own failures and every window's: a read that still threw is the source's failure too,
    // as the Plan's driver takes one — said with Retry, the cold load over, what the frame holds standing beside it —
    // never a frame covered for good.
    if (!result.ok) console.error("[Calendar] the paged resources could not be read:", result.error);
    const r: PagesRead = result.ok ? result.value : {
        narrowing: was?.narrowing ?? kept.narrowing, result: was?.result ?? kept.result, total: was?.total, windows: was?.windows ?? NO_WINDOWS,
        failed: was?.failed ?? NO_FAILURES, inFlight: NONE_IN_FLIGHT, stale: false, sourceError: reasonOf(result.error),
    };
    const shown = shownWindows(view, r.result);
    const landed = shown.every((w) => r.windows.has(w) || r.failed.has(w));
    if (was !== undefined && was.result !== r.result && !landed && r.sourceError === undefined) {
        // A new narrowing: the last view stands in, whole and retained, until the windows the view shows land under it —
        // or a read of it fails, which is said.
        if (!was.stale || !was.reading || was.line?.kind !== "filtering") held.current = { ...was, stale: true, reading: true, line: { kind: "filtering" } };
    } else {
        const reading = r.inFlight.some((w) => shown.includes(w));
        const ready = was?.ready === true || r.windows.size > 0 || r.failed.size > 0 || r.sourceError !== undefined;
        const line = lineOf(shown, r.failed, r.inFlight, r.total, r.sourceError);
        if (was === undefined || was.result !== r.result || was.total !== r.total || !sameWindows(was.windows, r.windows) || !sameWindows(was.failed, r.failed)
            || was.sourceError !== r.sourceError || was.reading !== reading || was.stale !== r.stale || !sameNarrowing(was.narrowing, r.narrowing)
            || was.ready !== ready || was.retry !== retry || !sameLine(was.line, line)) {
            held.current = {
                kind: paged.kind, group: name, total: r.total, windows: r.windows, failed: r.failed, sourceError: r.sourceError, reading, stale: r.stale,
                narrowing: r.narrowing, result: r.result, ready, line, retry,
            };
        }
    }
    const pages = held.current;
    useLayoutEffect(() => { if (pages !== undefined) onPages(pages); }, [pages, onPages]);
    return null;
}
