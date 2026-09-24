/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paged sheet's driver (`Sheet Spec.md` §3.13) — the Plan's stack
 * (#577: the window ledger, the residency policy) over a POSITIONAL source.
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
import { equivalentFor } from "@elaraai/east";
import { Sheet } from "@elaraai/east-ui/internal";
import { pagedSnapshot, pagedSourceEqual } from "./paged-snapshot.js";
import { useTrackedEvaluation } from "../../reactive/index.js";
import {
    createLedger, observeWindow, documentHeight, elementAtOffset, offsetOfWindow, slotHeight,
    type WindowLedger,
} from "../plan/window-ledger.js";
import {
    NO_RESIDENCY, DEFAULT_RESIDENCY, advance, isEmpty, residentWindows, pin, unpinAll,
    type Residency, type ResidencyOptions,
} from "../plan/window-residency.js";
import { BAND_MIN_PX, type SheetBand, type SheetWindowFailure } from "./model.js";
import type { SheetPagedSourceValue, SheetRowValue } from "./values.js";

/** Source elements per window. */
export const SHEET_PAGE_SIZE = 200;

/** Where the viewport is, in the caller's terms. */
export type SheetViewport =
    | { kind: "row"; offset: number }
    | { kind: "band"; at: "head" | "tail"; px?: number | undefined };

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
    /** Whether a requested window is still in flight. */
    loading: boolean;
    /** Why the SOURCE could not be read — its `total()` or `revision()` threw — while its rows show (#853): chrome, never their replacement. */
    sourceError: string | undefined;
    /** Why the source could not be read before anything landed: there is nothing else to show, so this is the whole sheet (#853). */
    error: string | undefined;
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
    /** Ask again (#853): the failed window `w`, or — with none — the source and every failed window. The source's own rate limit applies. */
    retry: (w?: number) => void;
}

const IDLE: SheetPaging = {
    rows: [], positions: [], rowsOffset: 0, failures: [], head: undefined, tail: undefined, total: undefined,
    exhausted: true, loading: false, sourceError: undefined, error: undefined, sizeVersion: 0, jump: undefined,
    reportViewport: () => {}, jumpToElement: () => {}, clearJump: () => {}, retry: () => {},
};

/** One line naming why a source read failed. */
function readFailure(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** The caller-owned read-once cache, keyed by window index. */
type WindowCache = Map<number, readonly SheetRowValue[]>;

/** What the driver has read from a source, and at which revision. */
interface SourceCache {
    /** The source that filled it — a source that is not EQUIVALENT drops it (#809). */
    source: SheetPagedSourceValue | undefined;
    /** The revision `windows` hold (#851). */
    revision: string | undefined;
    /** The windows landed at `revision`. */
    windows: WindowCache;
    /** The previous revision's windows, served for a window until its own
     *  lands at `revision` (#851). */
    stale: WindowCache | undefined;
    /** The source's last known `total()`, and the revision it was read at. */
    total: number | undefined;
    totalRevision: string | undefined;
    /** Why each failed window's read threw, at `revision` (#853) — not asked again while recorded. */
    failures: Map<number, string>;
    /** Whether any window of this source has landed — until one has, a failure is the whole sheet (#853). */
    landedOnce: boolean;
}

/** A cache holding nothing. */
function emptyCache(source: SheetPagedSourceValue | undefined): SourceCache {
    return { source, revision: undefined, windows: new Map(), stale: undefined, total: undefined, totalRevision: undefined, failures: new Map(), landedOnce: false };
}

/** Whether two paged sources serve the same rows: the same id AND equivalent
 *  functions — `page` is the bridge over the author's projection, so its
 *  captures are what the rows are projected WITH (#809). */
const pagedSourceEquivalent = equivalentFor(Sheet.Types.Root.fields.rows.cases.paged);

/**
 * Drive a paged sheet source.
 *
 * @param source - The decoded `paged` arm (undefined ⇒ inline sheet; idles)
 * @param heightOf - What one source row draws, in px — the body's own geometry (#855); a new function re-measures the landed windows
 * @param policy - Residency policy (defaults to the Plan's)
 * @returns The resident rows, the bands, and the callbacks the renderer feeds
 */
export function useSheetPaging(
    source: SheetPagedSourceValue | undefined,
    heightOf: (row: SheetRowValue) => number,
    policy: ResidencyOptions = DEFAULT_RESIDENCY,
): SheetPaging {
    const [ledger, setLedger] = useState<WindowLedger>(() => createLedger(0, SHEET_PAGE_SIZE));
    const [residency, setResidency] = useState<Residency>(NO_RESIDENCY);
    // The element the viewport is centred on — its window is the demand's,
    // and the run is the stretch nearest it (#876).
    const [viewportAt, setViewportAt] = useState(0);
    const viewportWindow = Math.floor(viewportAt / SHEET_PAGE_SIZE);
    const [isScrolling, setIsScrolling] = useState(false);
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
        let revision = held.revision;
        let sourceError: string | undefined;
        try {
            const r = source.revision?.();
            revision = r?.type === "some" ? r.value : undefined;
        } catch (err) {
            console.error("[Sheet] paged source revision failed:", err);
            sourceError = readFailure(err);
        }
        if (revision !== held.revision) {
            // A cache that holds nothing (a revision the source was still
            // discovering) leaves the last one that had rows standing in.
            if (held.windows.size > 0) held.stale = held.windows;
            held.windows = new Map();
            held.failures = new Map();
            held.revision = revision;
        }
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
            held.windows.clear();
            held.stale = undefined;
        }
        if (total !== undefined) {
            held.total = total;
            held.totalRevision = revision;
        }
        const landed: { w: number; rows: readonly SheetRowValue[] }[] = [];
        const failed: { w: number; error: string }[] = [];
        let loading = false;
        let standingIn = false;
        for (const w of residentWindows(residency)) {
            const known = held.windows.get(w);
            if (known !== undefined) { landed.push({ w, rows: known }); continue; }
            // A failed window is not asked again by the reader — only by a Retry (#853).
            const recorded = held.failures.get(w);
            if (recorded !== undefined) { failed.push({ w, error: recorded }); continue; }
            let win: ReturnType<SheetPagedSourceValue["page"]>;
            try {
                win = source.page(BigInt(w * SHEET_PAGE_SIZE), BigInt(SHEET_PAGE_SIZE));
            } catch (err) {
                console.error(`[Sheet] paged source page ${w} failed:`, err);
                const reason = readFailure(err);
                held.failures.set(w, reason);
                failed.push({ w, error: reason });
                continue;
            }
            if (win.type !== "some") {
                // In flight — its channel is tracked, so the landing re-reads.
                // Until then the rows it had at the previous revision stand in.
                loading = true;
                const previous = held.stale?.get(w);
                if (previous !== undefined) {
                    landed.push({ w, rows: previous });
                    standingIn = true;
                }
                continue;
            }
            const rows = win.value as readonly SheetRowValue[];
            held.windows.set(w, rows);
            held.landedOnce = true;
            landed.push({ w, rows });
        }
        // Every resident window reads at the new revision now: the old one
        // has nothing left to stand in for.
        if (!standingIn) held.stale = undefined;
        return { total, landed, failed, loading, sourceError, standingIn, landedOnce: held.landedOnce };
    }, [source, residency, retries]);

    const { result } = useTrackedEvaluation(read);
    const value = result.ok ? result.value : undefined;
    const readError = result.ok ? undefined : readFailure(result.error);

    const retry = useCallback((w?: number) => {
        const held = cacheRef.current;
        if (w === undefined) held.failures.clear();
        else held.failures.delete(w);
        setRetries((n) => n + 1);
    }, []);

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
            setResidency(NO_RESIDENCY);
            setViewportAt(0);
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

    // Demand follows the viewport, at idle only.
    useEffect(() => {
        if (source === undefined) return;
        if (ledger.windows === 0) {
            if (isEmpty(residency)) setResidency((r) => ({ ...r, lo: 0, hi: 0 }));
            return;
        }
        if (isScrolling) return;
        const next = advance(residency, ledger, viewportWindow, policy);
        if (next === residency) return;
        setResidency(next);
        // Whatever left the run leaves the cache with it, a stand-in too; a
        // failure record leaves as well, so a window demanded again later is
        // asked afresh (#853).
        const keep = new Set(residentWindows(next));
        const { windows, stale, failures } = cacheRef.current;
        for (const w of [...windows.keys()]) if (!keep.has(w)) windows.delete(w);
        if (stale !== undefined) for (const w of [...stale.keys()]) if (!keep.has(w)) stale.delete(w);
        for (const w of [...failures.keys()]) if (!keep.has(w)) failures.delete(w);
        setSizeVersion((v) => v + 1);
    }, [source, ledger, residency, viewportWindow, isScrolling, policy]);

    // The window the run is anchored on (#876): the resident window that is
    // in — landed, or failed (#853) — nearest the element the viewport is
    // centred on. While the viewport's own window is still loading, that is
    // the nearer of the first window in after it and the last one before
    // it, so a window loading next to the rows on screen never takes them
    // off it, whichever way the viewport came and whatever lands beyond it
    // first.
    const anchor = useMemo(() => {
        if (value === undefined || isEmpty(residency)) return undefined;
        const isIn = new Set([...value.landed.map((l) => l.w), ...value.failed.map((f) => f.w)]);
        const at = Math.min((residency.hi + 1) * SHEET_PAGE_SIZE - 1, Math.max(residency.lo * SHEET_PAGE_SIZE, viewportAt));
        const own = Math.floor(at / SHEET_PAGE_SIZE);
        if (isIn.has(own)) return own;
        let after: number | undefined;
        for (let w = own + 1; w <= residency.hi && after === undefined; w++) if (isIn.has(w)) after = w;
        let before: number | undefined;
        for (let w = own - 1; w >= residency.lo && before === undefined; w--) if (isIn.has(w)) before = w;
        if (after === undefined || before === undefined) return after ?? before;
        return after * SHEET_PAGE_SIZE - at <= at - ((before + 1) * SHEET_PAGE_SIZE - 1) ? after : before;
    }, [value, residency, viewportAt]);

    // The run: the stretch of windows that are in around the anchor — the
    // landed windows, and a failed window's band where its rows would be: its
    // elements are known, so the run crosses it and the rows after it keep
    // their positions (#853). A window still in flight ends it at either end.
    const run = useMemo(() => {
        const rows: SheetRowValue[] = [];
        const positions: number[] = [];
        const failures: SheetWindowFailure[] = [];
        if (value === undefined || anchor === undefined) return { rows, positions, failures, from: residency.lo, to: residency.lo - 1 };
        const byWindow = new Map(value.landed.map((l) => [l.w, l.rows]));
        const failedBy = new Map(value.failed.map((f) => [f.w, f.error]));
        let from = anchor;
        while (from > residency.lo && (byWindow.has(from - 1) || failedBy.has(from - 1))) from--;
        const known = total !== undefined && ledger.windows > 0;
        let w = from;
        for (; w <= residency.hi; w++) {
            const landedRows = byWindow.get(w);
            if (landedRows !== undefined) {
                landedRows.forEach((row, k) => { rows.push(row); positions.push(w * SHEET_PAGE_SIZE + k); });
                continue;
            }
            const error = failedBy.get(w);
            if (error === undefined) break;
            const start = w * SHEET_PAGE_SIZE;
            const to = (known ? Math.min(total, start + SHEET_PAGE_SIZE) : start + SHEET_PAGE_SIZE) - 1;
            // Its ledger slot, so the rows that replace it take the same space; floored so the reason and the Retry stay legible.
            failures.push({ w, from: start, to, px: Math.max(BAND_MIN_PX, known && w < ledger.windows ? slotHeight(ledger, w) : 0), error });
        }
        return { rows, positions, failures, from, to: w - 1 };
    }, [value, anchor, residency, ledger, total]);

    // The bands follow the run, not the residency: the windows past a
    // loading one are theirs until it lands (#876).
    const bands = useMemo(() => {
        if (isEmpty(residency) || ledger.windows === 0) return { head: undefined, tail: undefined };
        const head: SheetBand | undefined = run.from > 0
            ? { at: "head", from: 0, to: run.from * SHEET_PAGE_SIZE - 1, px: offsetOfWindow(ledger, run.from) }
            : undefined;
        const lastWindow = ledger.windows - 1;
        const tail: SheetBand | undefined = run.to < lastWindow
            ? {
                at: "tail",
                from: (run.to + 1) * SHEET_PAGE_SIZE,
                to: (total ?? ledger.total) - 1,
                px: documentHeight(ledger) - offsetOfWindow(ledger, run.to + 1),
            }
            : undefined;
        return { head, tail };
    }, [residency, ledger, total, run.from, run.to]);

    // Read by the viewport report, so a jump's pin changes nothing it closes over.
    const jumpingRef = useRef(false);
    jumpingRef.current = residency.pins.size > 0;
    const reportViewport = useCallback((at: SheetViewport, scrolling: boolean) => {
        setIsScrolling(scrolling);
        // A pending jump owns the viewport (#854): until the sheet has shown its
        // target, a report is taken from where the sheet still IS, and moving
        // the demand there would move the run back and undo the jump.
        if (jumpingRef.current) return;
        setViewportAt((current) => {
            if (at.kind === "band") {
                // A band's own geometry: the head starts at the top, the tail
                // right after the run — not after the residency, whose last
                // windows may still be loading inside the tail (#876).
                if (at.px !== undefined && ledger.windows > 0) {
                    const bandTop = at.at === "head" ? 0 : offsetOfWindow(ledger, run.to + 1);
                    return elementAtOffset(ledger, bandTop + Math.max(0, at.px));
                }
                return at.at === "head" ? Math.max(0, run.from * SHEET_PAGE_SIZE - 1) : (run.to + 1) * SHEET_PAGE_SIZE;
            }
            return at.offset >= 0 ? at.offset : current;
        });
    }, [run.from, run.to, ledger]);

    const jumpToElement = useCallback((element: number) => {
        const at = Math.max(0, element);
        setViewportAt(at);
        setIsScrolling(false);
        setResidency((r) => pin(unpinAll(r), Math.floor(at / SHEET_PAGE_SIZE)));
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
        const met = advance(residency, ledger, viewportWindow, policy) === residency;
        settled = met && run.from <= target && target <= run.to;
    }
    const jump = target === undefined ? undefined : { window: target, settled };

    if (source === undefined) return IDLE;

    // Until anything has landed there is nothing to show beside a failure:
    // it is the whole sheet (#853).
    const nothingShown = value === undefined || !value.landedOnce;
    const failure = value?.failed[0]?.error ?? value?.sourceError;
    const exhausted = total !== undefined && run.from === 0 && run.rows.length >= total;
    return {
        rows: run.rows,
        positions: run.positions,
        rowsOffset: run.from * SHEET_PAGE_SIZE,
        failures: run.failures,
        head: bands.head,
        tail: bands.tail,
        total,
        exhausted,
        loading: value?.loading ?? false,
        sourceError: nothingShown ? undefined : value?.sourceError,
        error: readError ?? (nothingShown ? failure : undefined),
        sizeVersion,
        jump,
        reportViewport,
        jumpToElement,
        clearJump,
        retry,
    };
}
