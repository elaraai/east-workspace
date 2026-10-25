/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paged sheet's driver (`Sheet Spec.md` §3.13) — the Plan's stack
 * (#577: the window ledger, the residency policy) over a POSITIONAL source.
 * The run, its bands, the stand-in, the demand and the jump's pin are the
 * windowed logic it shares with the Plan's driver (`shared/windowed.ts`,
 * #1398); what is the Sheet's own is its React state, the rows' positions,
 * what the view waits for and a family's stand-in.
 *
 * A sheet window is an `Array<SheetRow>` in stream order, so windows
 * concatenate at their offsets (the Table rule). The resident rows are the
 * RUN: the stretch of resident windows that are in — landed, or failed —
 * nearest the element the viewport is centred on (#876). A window still in
 * flight ends the stretch, because a positional row space cannot carry a
 * hole it cannot place; the windows past it are the bands' until it lands.
 * So a window loading above the rows on screen never takes them off it, nor
 * does one loading below — even when a window beyond it lands first.
 * Everything above the run is the head band, everything below it the tail
 * band, each sized by the ledger so eviction moves nothing and a window
 * landing beside the run takes exactly its band's slot. The ledger measures
 * a landed window by what the body draws of its rows — the caller's
 * `heightOf`, the body's own geometry (#855) — so an unloaded band is sized
 * at the rate rows are drawn: a group's blank line counts only when the
 * sheet draws one, a folded group is its band, open sub rows count.
 *
 * # A failure belongs to its window (#853)
 *
 * A window whose read throws is recorded against that window and the rest
 * of the run reads on: the run CROSSES it — its elements are known, so the
 * rows after it keep their positions ({@link SheetPaging.positions}) — and
 * the renderer draws its band where its rows would be, with the reason and
 * a Retry. The reader never asks a failed window again by itself (a failing
 * source would be hammered once per frame); {@link SheetPaging.retry} does.
 * A `total()` or `revision()` that throws is the SOURCE's failure: chrome
 * beside the rows, never in their place. Only a source that fails before
 * anything has landed replaces the sheet — there is nothing else to show.
 * The Plan's driver does the same (#811).
 *
 * Exhaustion comes from `total()`: the blank tail (the sheet's invitation to
 * type the next row) appears only once every source element is resident —
 * a blank row above unloaded rows would lie about where the end is.
 *
 * # A new revision keeps the rows (#851)
 *
 * The rows cached for a source belong to its `revision()` — the snapshot its
 * windows are served from. When the revision moves (the dataset was written,
 * a `refresh` was asked for), the resident windows are read again at the new
 * one, and until each lands the rows it had stand in: the sheet never empties
 * between two snapshots of its data, and a row whose id survives keeps its
 * element. The geometry stays too — the ledger's measured heights, and its
 * total until the new snapshot's total says otherwise — so the scroll
 * position, the bands and the blank tail hold. The Plan's driver does the
 * same (#821).
 *
 * # A jump owns the viewport (#854)
 *
 * A key search moves the run onto its target window and pins it, but the
 * sheet can only scroll to the target once its rows are on screen. Until then
 * every viewport report is taken from where the sheet still is — over the
 * head band the move left behind — and honouring one would move the run back
 * and undo the jump. So while a jump is pending, reports move nothing. It
 * SETTLES once the run around the target has stopped moving and the target's
 * window is in the run ({@link SheetPaging.jump}) — the windows above it may
 * still be loading (#876): a window landing beside the run takes its band's
 * slot, so nothing on screen moves. The sheet shows the target (the
 * ring on its row, or the failed band) and hands the viewport back with
 * {@link SheetPaging.clearJump}, and the reports resume from where it
 * scrolled to. The Plan's driver does the same (#812).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StringType, equalFor, equivalentFor } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { pagedSnapshot, pagedSourceEqual } from "./paged-snapshot.js";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import {
    createLedger, observeWindow, type WindowLedger, NO_RESIDENCY, DEFAULT_RESIDENCY,
    isEmpty, residentWindows, unpinAll, type Residency, type ResidencyOptions,
} from "@elaraai/east-ui-components/internal";
import {
    WindowStore, advanceAtRest, anchorAround, bandsAround, elementInBand, failedSpan, firstWindow, pinTarget, retryWindows, runAround,
    type WindowReader, type WindowTravel,
} from "../shared/windowed.js";
import { BAND_MIN_PX, type SheetBand, type SheetWindowFailure } from "./model.js";
import type { SheetPagedSourceValue, SheetRowValue } from "./values.js";

/** Source elements per window. */
export const SHEET_PAGE_SIZE = 200;

/**
 * Where the viewport is, in the caller's terms — and, where the caller can
 * say, the source elements it shows (`shows`): what the footer's loading line
 * and the grid's busy follow (#1398), never the windows read ahead of it.
 */
export type SheetViewport =
    | { kind: "row"; offset: number; shows?: ElementSpan | undefined }
    | { kind: "band"; at: "head" | "tail"; px?: number | undefined; shows?: ElementSpan | undefined };

/** A stretch of source elements, first and last (inclusive). */
export interface ElementSpan {
    readonly from: number;
    readonly to: number;
}

/** What the driver returns. */
export interface SheetPaging {
    /** The resident rows — the run nearest the viewport (#876), in stream order (a failed window's rows are not among them, #853). */
    rows: SheetRowValue[];
    /** Each resident row's source position — a row after a failed window keeps its own (#853). */
    positions: readonly number[];
    /** The source offset of `rows[0]`. */
    rowsOffset: number;
    /** The resident windows whose read failed, ascending (#853): each is a band where its rows would be. */
    failures: readonly SheetWindowFailure[];
    /** Every element above the run — not resident, still loading, or past a window still loading (#876). */
    head: SheetBand | undefined;
    /** Every element below the run — not resident, still loading, or past a window still loading (#876). */
    tail: SheetBand | undefined;
    /** The source's element count, once known. */
    total: number | undefined;
    /** Whether every source element is resident. */
    exhausted: boolean;
    /** Whether a requested window is still in flight — one the view shows, or one read ahead of it. */
    loading: boolean;
    /** The windows in flight, ascending: a run is busy while one of its own is (#1398). */
    pending: readonly number[];
    /**
     * Whether a window the view shows is in flight (#1398): what the footer's loading line and the grid's busy follow
     * — never a window read ahead of the view, which nothing on screen waits for.
     */
    viewLoading: boolean;
    /** The source elements the view waits for (#1398, CL3): the stretch of windows in flight among those it shows, first and last element; `undefined` while none is. */
    reading: { from: number; to: number } | undefined;
    /** The last query is still displayed while its replacement loads. */
    replacing: boolean;
    /** Why the SOURCE could not be read — its `total()` or `revision()` threw — while its rows show (#853): chrome, never their replacement. */
    sourceError: string | undefined;
    /** Why the source could not be read before anything landed: there is nothing else to show, so this is the whole sheet (#853). */
    error: string | undefined;
    /**
     * Whether a window of this source has landed (#1398, CL5): the cold load is over. A scroll far from the rows,
     * every window it shows still on its way, draws the runs where they meet the view — never the cover again.
     */
    landedOnce: boolean;
    /** Bump for `VirtualRows`' `sizeVersion` — heights change at constant count. */
    sizeVersion: number;
    /** A pending jump (#854): its target window, and whether it has SETTLED — the run around it has stopped moving and the target's window is in the run (#876), so the sheet can show it. While one is pending it owns the viewport. */
    jump: { window: number; settled: boolean } | undefined;
    /** Tell the driver where the viewport is. Ignored while a jump is pending (#854). */
    reportViewport: (at: SheetViewport, isScrolling: boolean) => void;
    /** Jump to a source element (a seek result): pin its window and rebase. */
    jumpToElement: (element: number) => void;
    /** Drop any pending jump — the search was cleared, or the sheet has shown the jump's target and hands the viewport back (#854). */
    clearJump: () => void;
    /** Ask again (#853): the failed window `w`, or — with none — the source and every failed window. At once (#1398): a source that can refresh rearms what failed first, and the windows are read again a microtask on, so the gap a read alone waits after a failure never holds a Retry back. */
    retry: (w?: number) => void;
}

/** No window in flight. */
const NONE_PENDING: readonly number[] = [];

const IDLE: SheetPaging = {
    rows: [], positions: [], rowsOffset: 0, failures: [], head: undefined, tail: undefined, total: undefined,
    exhausted: true, loading: false, pending: NONE_PENDING, viewLoading: false, reading: undefined, replacing: false,
    sourceError: undefined, error: undefined, landedOnce: false, sizeVersion: 0, jump: undefined,
    reportViewport: () => {}, jumpToElement: () => {}, clearJump: () => {}, retry: () => {},
};

/**
 * The windows in flight that the view shows (#1398): those its stretch of
 * elements meets — or, where the caller has not said what it shows, the
 * window the viewport is centred in.
 *
 * @param pending - The windows in flight, ascending
 * @param shows - The source elements the view shows, if known
 * @param at - The viewport's window
 * @returns The windows in flight among those it shows, ascending
 */
export function pendingInView(pending: readonly number[], shows: ElementSpan | undefined, at: number): readonly number[] {
    const lo = shows === undefined ? at : Math.floor(Math.max(0, shows.from) / SHEET_PAGE_SIZE);
    const hi = shows === undefined ? at : Math.floor(Math.max(0, shows.to) / SHEET_PAGE_SIZE);
    const out = pending.filter((w) => w >= lo && w <= hi);
    return out.length === pending.length ? pending : out;
}

/** One line naming why a source read failed. */
function readFailure(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Whether two stretches of elements meet the same windows: all a view's stretch decides — which of the windows in flight
 * it waits for (#1398, CL9).
 */
function sameWindows(a: ElementSpan, b: ElementSpan): boolean {
    return Math.floor(a.from / SHEET_PAGE_SIZE) === Math.floor(b.from / SHEET_PAGE_SIZE) && Math.floor(a.to / SHEET_PAGE_SIZE) === Math.floor(b.to / SHEET_PAGE_SIZE);
}

/**
 * The elements being read (#1398, CL3): of the windows in flight, the
 * stretch of adjacent ones nearest the viewport's window — what the footer's
 * loading line names.
 *
 * @param pending - The windows in flight, ascending
 * @param at - The viewport's window
 * @param total - The source's element count, once known: the last window ends there
 * @returns The stretch's first and last element; `undefined` with none in flight
 */
export function readingStretch(pending: readonly number[], at: number, total: number | undefined): { from: number; to: number } | undefined {
    let best: { first: number; last: number; distance: number } | undefined;
    for (let i = 0; i < pending.length;) {
        const first = pending[i]!;
        let last = first;
        while (pending[i + 1] === last + 1) { last += 1; i += 1; }
        i += 1;
        const distance = at < first ? first - at : at > last ? at - last : 0;
        if (best === undefined || distance < best.distance) best = { first, last, distance };
    }
    if (best === undefined) return undefined;
    const end = (best.last + 1) * SHEET_PAGE_SIZE;
    return { from: best.first * SHEET_PAGE_SIZE, to: (total === undefined ? end : Math.min(total, end)) - 1 };
}

/** What the driver has read from a source, and at which revision. */
interface SourceCache {
    /** The source that filled it — a source that is not EQUIVALENT drops it (#809). */
    source: SheetPagedSourceValue | undefined;
    /**
     * Its windows landed at its revision, the previous revision's standing in for each until its own lands (#851), and
     * why each failed window's read threw (#853) — not asked again while recorded.
     */
    store: WindowStore<readonly SheetRowValue[]>;
    /** The source's last known `total()`, and the revision it was read at. */
    total: number | undefined;
    totalRevision: string | undefined;
    /** Whether any window of this source has landed — until one has, a failure is the whole sheet (#853). */
    landedOnce: boolean;
}

/** A cache holding nothing. */
function emptyCache(source: SheetPagedSourceValue | undefined): SourceCache {
    return { source, store: new WindowStore(), total: undefined, totalRevision: undefined, landedOnce: false };
}

/**
 * How the driver reads a window of its source: the rows the source serves, as it serves them.
 *
 * @param source - The source
 * @returns Its window reader
 */
function sheetWindows(source: SheetPagedSourceValue): WindowReader<unknown, readonly SheetRowValue[]> {
    return { page: (offset, limit) => source.page(offset, limit), decode: (rows) => rows as readonly SheetRowValue[], label: "[Sheet]" };
}

/** Whether two paged sources serve the same rows: the same id AND equivalent
 *  functions — `page` is the bridge over the author's projection, so its
 *  captures are what the rows are projected WITH (#809). */
const stringEqual = equalFor(StringType);
const FIRST_WINDOW: Residency = { ...NO_RESIDENCY, lo: 0, hi: 0 };

const pagedSourceEquivalent = equivalentFor(Sheet.Types.Root.fields.rows.cases.paged);

/**
 * Drive a paged sheet source.
 *
 * @param source - The decoded `paged` arm (undefined ⇒ inline sheet; idles)
 * @param heightOf - What one source row draws, in px — the body's own geometry (#855); a new function re-measures the landed windows
 * @param policy - Residency policy (defaults to the Plan's)
 * @param family - Stable record identity; query changes within it retain the last usable view
 * @returns The resident rows, the bands, and the callbacks the renderer feeds
 */
export function useSheetPaging(
    source: SheetPagedSourceValue | undefined,
    heightOf: (row: SheetRowValue) => number,
    policy: ResidencyOptions = DEFAULT_RESIDENCY,
    family?: string,
): SheetPaging {
    const [storedLedger, setLedger] = useState<WindowLedger>(() => createLedger(0, SHEET_PAGE_SIZE));
    const [storedResidency, setResidency] = useState<Residency>(NO_RESIDENCY);
    // The element the viewport is centred on — its window is the demand's,
    // and the run is the stretch nearest it (#876).
    const [storedViewportAt, setViewportAt] = useState(0);
    // The element the viewport was last reported centred on, exactly: the state above holds it only as what it decides
    // moves (#1398, CL9).
    const centredOn = useRef(0);
    const [isScrolling, setIsScrolling] = useState(false);
    // The source elements the view shows, as the caller last said (#1398): what the line and busy follow.
    const [storedShows, setShows] = useState<ElementSpan | undefined>(undefined);
    // What was last asked of each of the three, rendered yet or not: a report asks again only for what moves (CL9).
    const asked = useRef<{ viewportAt: number; isScrolling: boolean; shows: ElementSpan | undefined }>({ viewportAt: 0, isScrolling: false, shows: undefined });
    // Which way the viewport travels through the windows (CL6): the demand reads ahead that way.
    const travel = useRef<WindowTravel>({ at: 0, way: 1 });
    const [sizeVersion, setSizeVersion] = useState(0);
    // A Retry reads again (#853): the read depends on it.
    const [retries, setRetries] = useState(0);
    // Read-once cache, owned by the source that filled it: a `page` whose
    // closures changed serves different rows under the same id and revision,
    // so a source that is not EQUIVALENT to the filler drops the cache and
    // the resident windows re-read (#809). Reset here rather than in an
    // effect so a swapped source cannot serve the previous one's rows for a
    // frame. Within one source the cache follows its revision (#851).
    const cacheRef = useRef<SourceCache>(emptyCache(undefined));
    // The source the geometry was built for.
    const geometryRef = useRef(pagedSnapshot(undefined, undefined).source);
    // Demand must reset BEFORE reading the replacement, not in a later effect:
    // an old deep scroll position has no meaning in the new narrowed source.
    const sourceChanged = !pagedSourceEqual(geometryRef.current, pagedSnapshot(source?.id, undefined).source);
    const ledger = sourceChanged ? createLedger(0, SHEET_PAGE_SIZE) : storedLedger;
    const residency = sourceChanged ? FIRST_WINDOW : storedResidency;
    const viewportAt = sourceChanged ? 0 : storedViewportAt;
    const viewportWindow = Math.floor(viewportAt / SHEET_PAGE_SIZE);
    const shows = sourceChanged ? undefined : storedShows;
    const displayed = useRef<{ family: string; source: string; result: SheetPaging } | undefined>(undefined);
    const replacingRef = useRef(false);

    const read = useCallback(() => {
        void retries;
        if (source === undefined) return undefined;
        if (cacheRef.current.source === undefined || !pagedSourceEquivalent(cacheRef.current.source, source)) {
            cacheRef.current = emptyCache(source);
        }
        const held = cacheRef.current;
        // The snapshot first: every window below is read at it. A new one
        // is read afresh, and the rows each window had stand in until its
        // own land (#851). A source that cannot say which snapshot it serves
        // has failed as a whole (#853) — its windows then say so each, where
        // their rows would be.
        let revision = held.store.revision;
        let sourceError: string | undefined;
        try {
            const r = source.revision?.();
            revision = r?.type === "some" ? r.value : undefined;
        } catch (err) {
            console.error("[Sheet] paged source revision failed:", err);
            sourceError = readFailure(err);
        }
        held.store.at(revision);
        let total: number | undefined;
        try {
            const t = source.total();
            if (t.type === "some") total = Number(t.value);
        } catch (err) {
            console.error("[Sheet] paged source total failed:", err);
            sourceError ??= readFailure(err);
            // The count this revision last gave still holds — same revision,
            // same rows — so the bands, the blank tail and the transport's
            // count stand while the source says why beside them (#853).
            if (held.totalRevision === revision) total = held.total;
        }
        // Same id and revision ⇒ same rows is the source's contract: a total
        // that moves under ONE revision has broken it, and the cached rows
        // cannot be trusted. One that moves with the revision is the content
        // changing.
        if (total !== undefined && held.total !== undefined && total !== held.total && held.totalRevision === revision) {
            console.warn(`[Sheet] paged source "${source.id}" changed total() without a revision change; dropping cached windows.`);
            held.store.windows.clear();
            held.store.stale = undefined;
        }
        if (total !== undefined) {
            held.total = total;
            held.totalRevision = revision;
        }
        // Each resident window from the store, or read — one still in flight standing in for the rows it had at the
        // previous revision; a failed one is not asked again by the reader, only by a Retry (#853).
        const reads = held.store.read(sheetWindows(source), residentWindows(residency), SHEET_PAGE_SIZE);
        if (reads.resident.some(({ w }) => held.store.windows.has(w))) held.landedOnce = true;
        return {
            total,
            landed: reads.resident.map(({ w, read: rows }) => ({ w, rows })),
            failed: reads.failed,
            // The windows in flight, ascending: what the footer's loading line names (#1398).
            pending: reads.inFlight,
            loading: reads.inFlight.length > 0,
            sourceError,
            standingIn: reads.stale,
            landedOnce: held.landedOnce,
        };
    }, [source, residency, retries]);

    const { result } = useTrackedEvaluation(read);
    const value = result.ok ? result.value : undefined;
    const readError = result.ok ? undefined : readFailure(result.error);

    // A Retry asks again now (#1398, `retryWindows`): the source rearms what failed, then the failure records go and
    // the windows are read again.
    const retry = useCallback((w?: number) => {
        retryWindows(source, () => {
            cacheRef.current.store.forget(w);
            setRetries((n) => n + 1);
        });
    }, [source]);

    // The source's own total — the ledger is built from it, never from the
    // stand-in below.
    const sourceTotal = value?.total;
    const landed = value?.landed;
    useEffect(() => {
        const id = pagedSnapshot(source?.id, undefined).source;
        const sourceChanged = !pagedSourceEqual(geometryRef.current, id);
        geometryRef.current = id;
        // The geometry belongs to the source: a new revision keeps the
        // measured heights, so nothing on screen moves (#851). A new source
        // rebuilds it, and so does a new total — the content changed size.
        let next = sourceChanged || (sourceTotal !== undefined && sourceTotal !== ledger.total)
            ? createLedger(sourceTotal ?? (sourceChanged ? 0 : ledger.total), SHEET_PAGE_SIZE) : ledger;
        // A window is as tall as the body draws its rows (#855).
        for (const { w, rows } of landed ?? []) {
            let px = 0;
            for (const r of rows) px += heightOf(r);
            next = observeWindow(next, w, { px, rows: rows.length });
        }
        if (sourceChanged) {
            setResidency(FIRST_WINDOW);
            centredOn.current = 0;
            asked.current = { viewportAt: 0, isScrolling: false, shows: undefined };
            setViewportAt(0);
            setShows(undefined);
            setIsScrolling(false);
            travel.current = { at: 0, way: 1 };
        }
        if (next === ledger) return;
        setLedger(next);
        setSizeVersion(v => v + 1);
    }, [source?.id, sourceTotal, landed, ledger, heightOf]);
    // Between two revisions the source may know no total until the new
    // one's first window lands. While the old rows stand in, the geometry
    // stands too, so the bands, the blank tail and the scroll extent do not
    // collapse under the reader (#851).
    const total = sourceTotal ?? (value?.standingIn === true && ledger.total > 0 ? ledger.total : undefined);

    // Demand follows the viewport once it shows intent (CL6): at rest, or while the frame reports the scroll slowed
    // — the frame's `isScrolling` says which — reading ahead the way it travels.
    useEffect(() => {
        if (source === undefined) return;
        if (ledger.windows === 0) {
            if (isEmpty(residency)) setResidency(firstWindow);
            return;
        }
        if (isScrolling) return;
        const step = advanceAtRest(residency, ledger, viewportWindow, policy, travel.current);
        travel.current = step.travel;
        const next = step.residency;
        if (next === residency) return;
        setResidency(next);
        // Whatever left the run leaves the cache with it, a stand-in too; a
        // failure record leaves as well, so a window demanded again later is
        // asked afresh (#853).
        cacheRef.current.store.prune(new Set(residentWindows(next)));
        setSizeVersion((v) => v + 1);
    }, [source, ledger, residency, viewportWindow, isScrolling, policy]);

    // The windows that are in — landed, or failed (#853) — as the read last gave them.
    const isIn = useMemo(() => {
        const ins = new Set(value === undefined ? [] : [...value.landed.map((l) => l.w), ...value.failed.map((f) => f.w)]);
        return (w: number) => ins.has(w);
    }, [value]);
    // The run (#876, `runAround`): the stretch of windows that are in around the one nearest the element the viewport was
    // last reported centred on — the state holds it only as the anchor it gives moves (#1398, CL9, `reportViewport`),
    // and a read landing takes the element as it is now.
    const runWindows = useMemo(() => (value === undefined ? undefined : runAround(residency, isIn, sourceChanged ? 0 : centredOn.current, SHEET_PAGE_SIZE)),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `viewportAt` moves whenever the anchor the element gives does; the element itself is read as it is
        [value, isIn, residency, viewportAt, sourceChanged]);

    // The run's rows: its landed windows, and a failed window's band where its
    // rows would be — its elements are known, so the run crosses it and the
    // rows after it keep their positions (#853).
    const run = useMemo(() => {
        const rows: SheetRowValue[] = [];
        const positions: number[] = [];
        const failures: SheetWindowFailure[] = [];
        if (value === undefined || runWindows === undefined) return { rows, positions, failures, from: residency.lo, to: residency.lo - 1 };
        const byWindow = new Map(value.landed.map((l) => [l.w, l.rows]));
        const failedBy = new Map(value.failed.map((f) => [f.w, f.error]));
        for (let w = runWindows.from; w <= runWindows.to; w++) {
            const landedRows = byWindow.get(w);
            if (landedRows !== undefined) {
                landedRows.forEach((row, k) => { rows.push(row); positions.push(w * SHEET_PAGE_SIZE + k); });
                continue;
            }
            const error = failedBy.get(w);
            // Its ledger slot, so the rows that replace it take the same space; floored so the reason and the Retry stay legible.
            if (error !== undefined) failures.push({ w, ...failedSpan(ledger, w, total, SHEET_PAGE_SIZE, BAND_MIN_PX), error });
        }
        return { rows, positions, failures, from: runWindows.from, to: runWindows.to };
    }, [value, runWindows, residency, ledger, total]);

    // The bands follow the run, not the residency: the windows past a
    // loading one are theirs until it lands (#876).
    const bands = useMemo(() => {
        const spans = bandsAround(ledger, residency, { from: run.from, to: run.to }, SHEET_PAGE_SIZE, total ?? ledger.total);
        const head: SheetBand | undefined = spans.head === undefined ? undefined : { at: "head", ...spans.head };
        const tail: SheetBand | undefined = spans.tail === undefined ? undefined : { at: "tail", ...spans.tail };
        return { head, tail };
    }, [residency, ledger, total, run.from, run.to]);

    // Read by the viewport report, so a jump's pin changes nothing it closes over.
    const jumpingRef = useRef(false);
    jumpingRef.current = residency.pins.size > 0;
    // What the anchor is decided by, as this render has it: the windows in, and the residency.
    const decided = useRef({ isIn, residency });
    decided.current = { isIn, residency };
    // A report draws the sheet again only for what it moves (#1398, CL9): the window the viewport is centred in, the run's
    // anchor, the windows the view shows, whether the scroll is at rest — never each row the view passes. What holds is
    // never asked again, so nothing is asked of React for it.
    const reportViewport = useCallback((at: SheetViewport, scrolling: boolean) => {
        const was = asked.current;
        if (was.isScrolling !== scrolling) {
            was.isScrolling = scrolling;
            setIsScrolling(scrolling);
        }
        // What the view shows is the view's, a jump pending or not: the line follows the windows it meets.
        const span = at.shows;
        if (span === undefined ? was.shows !== undefined : was.shows === undefined || !sameWindows(was.shows, span)) {
            const next = span === undefined ? undefined : { from: span.from, to: span.to };
            was.shows = next;
            setShows(next);
        }
        // A pending jump owns the viewport (#854): until the sheet has shown its
        // target, a report is taken from where the sheet still IS, and moving
        // the demand there would move the run back and undo the jump.
        if (jumpingRef.current || replacingRef.current) return;
        // A band's own geometry (`elementInBand`): the head starts at the top, the tail right after the run — not after
        // the residency, whose last windows may still be loading inside the tail (#876).
        const next = at.kind === "band"
            ? elementInBand(ledger, { from: run.from, to: run.to }, at.at, at.px, SHEET_PAGE_SIZE)
            : at.offset >= 0 ? at.offset : centredOn.current;
        centredOn.current = next;
        // The element held moves only with its window or the anchor it gives.
        const { isIn: ins, residency: resident } = decided.current;
        const moves = Math.floor(was.viewportAt / SHEET_PAGE_SIZE) !== Math.floor(next / SHEET_PAGE_SIZE)
            || (!isEmpty(resident) && anchorAround(resident, ins, was.viewportAt, SHEET_PAGE_SIZE) !== anchorAround(resident, ins, next, SHEET_PAGE_SIZE));
        if (!moves) return;
        was.viewportAt = next;
        setViewportAt(next);
    }, [run.from, run.to, ledger]);

    const jumpToElement = useCallback((element: number) => {
        const at = Math.max(0, element);
        centredOn.current = at;
        asked.current.viewportAt = at;
        asked.current.isScrolling = false;
        setViewportAt(at);
        setIsScrolling(false);
        setResidency((r) => pinTarget(r, Math.floor(at / SHEET_PAGE_SIZE)));
    }, []);

    const clearJump = useCallback(() => { setResidency((r) => unpinAll(r)); }, []);

    // A pending jump, and whether it has SETTLED (#854): the run around it has
    // stopped moving (the demand is met), and the target's window — landed,
    // or failed (#853) — is in the run, so the sheet can show it. The windows
    // above it may still be loading: landing, each takes its band's slot, and
    // nothing on screen moves (#876). The pin stays until the sheet has shown
    // the target and calls `clearJump`: dropped on landing, the reports of
    // the render that first shows the rows (still from the old place) would
    // undo it.
    const pinned = [...residency.pins];
    const target = pinned[0];
    let settled = false;
    if (target !== undefined && value !== undefined && !isEmpty(residency) && ledger.windows > 0) {
        const met = advanceAtRest(residency, ledger, viewportWindow, policy, travel.current).residency === residency;
        settled = met && run.from <= target && target <= run.to;
    }
    const jump = target === undefined ? undefined : { window: target, settled };

    // What the view waits for (#1398): the windows in flight among those it shows — and a jump's target, which it is
    // about to show — never one read ahead of it. One array while they hold.
    const allPending = value?.pending ?? NONE_PENDING;
    const viewPending = useMemo(() => {
        const shown = pendingInView(allPending, shows, viewportWindow);
        const extra = allPending.filter((w) => residency.pins.has(w) && !shown.includes(w));
        return extra.length === 0 ? shown : [...shown, ...extra].sort((a, b) => a - b);
    }, [allPending, shows, viewportWindow, residency.pins]);
    // What the footer's loading line names (#1398): one object while the stretch holds, so the line it feeds — and
    // the footer that measures itself as it renders — renders again only when the stretch moves.
    const stretch = readingStretch(viewPending, viewportWindow, total);
    const readingFrom = stretch?.from;
    const readingTo = stretch?.to;
    const reading = useMemo(
        () => (readingFrom === undefined || readingTo === undefined ? undefined : { from: readingFrom, to: readingTo }),
        [readingFrom, readingTo],
    );

    if (source === undefined) { displayed.current = undefined; replacingRef.current = false; return IDLE; }

    // Until anything has landed there is nothing to show beside a failure:
    // it is the whole sheet (#853).
    const nothingShown = value === undefined || !value.landedOnce;
    const failure = value?.failed[0]?.error ?? value?.sourceError;
    const exhausted = total !== undefined && run.from === 0 && run.rows.length >= total;
    const current: SheetPaging = {
        rows: run.rows,
        positions: run.positions,
        rowsOffset: run.from * SHEET_PAGE_SIZE,
        failures: run.failures,
        head: bands.head,
        tail: bands.tail,
        total,
        exhausted,
        loading: value?.loading ?? false,
        pending: allPending,
        viewLoading: viewPending.length > 0,
        reading,
        replacing: false,
        sourceError: nothingShown ? undefined : value?.sourceError,
        error: readError ?? (nothingShown ? failure : undefined),
        landedOnce: !nothingShown,
        sizeVersion,
        jump,
        reportViewport,
        jumpToElement,
        clearJump,
        retry,
    };
    const previous = displayed.current;
    const sameFamily = family !== undefined && previous !== undefined && stringEqual(previous.family, family);
    const replacement = sameFamily && !stringEqual(previous.source, source.id);
    const ready = value?.total !== undefined && value.landed.some(window => window.w === 0);
    replacingRef.current = replacement && !ready;
    if (replacingRef.current && previous !== undefined) {
        const reason = current.error ?? current.sourceError ?? current.failures[0]?.error;
        return { ...current, rows: previous.result.rows, positions: previous.result.positions,
            rowsOffset: previous.result.rowsOffset, failures: previous.result.failures,
            head: previous.result.head, tail: previous.result.tail, total: previous.result.total,
            exhausted: previous.result.exhausted, sizeVersion: previous.result.sizeVersion,
            jump: undefined, replacing: true, loading: reason === undefined, viewLoading: reason === undefined, reading: undefined,
            error: undefined, sourceError: reason };
    }
    if (family !== undefined && (current.rows.length > 0 || current.exhausted)) {
        displayed.current = { family, source: source.id, result: current };
    } else if (!sameFamily) displayed.current = undefined;
    return current;
}
