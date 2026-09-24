/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paged sheet's driver (`Sheet Spec.md` §3.13) — the Plan's stack
 * (#577: the window ledger, the residency policy) over a POSITIONAL source.
 *
 * A sheet window is an `Array<SheetRow>` in stream order, so windows
 * concatenate at their offsets (the Table rule) and the resident rows are
 * the CONTIGUOUS landed run from the residency's low window: a window still
 * in flight inside the run stops the concatenation there, because a
 * positional row space cannot carry a hole. Everything above the run is the
 * head band, everything below it the tail band, each sized by the ledger so
 * eviction moves nothing.
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
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { equivalentFor } from "@elaraai/east";
import { Sheet } from "@elaraai/east-ui/internal";
import { pagedSnapshot, pagedSourceEqual } from "./paged-snapshot.js";
import { useTrackedEvaluation } from "../../reactive/index.js";
import {
    createLedger, observeWindow, documentHeight, elementAtOffset, offsetOfWindow,
    type WindowLedger,
} from "../plan/window-ledger.js";
import {
    NO_RESIDENCY, DEFAULT_RESIDENCY, advance, isEmpty, residentWindows, pin, unpinAll,
    type Residency, type ResidencyOptions,
} from "../plan/window-residency.js";
import type { SheetBand } from "./model.js";
import type { SheetPagedSourceValue, SheetRowValue } from "./values.js";

/** Source elements per window. */
export const SHEET_PAGE_SIZE = 200;

/** Where the viewport is, in the caller's terms. */
export type SheetViewport =
    | { kind: "row"; offset: number }
    | { kind: "band"; at: "head" | "tail"; px?: number | undefined };

/** What the driver returns. */
export interface SheetPaging {
    /** The resident rows — the contiguous landed run, in stream order. */
    rows: SheetRowValue[];
    /** The source offset of `rows[0]`. */
    rowsOffset: number;
    /** The unloaded run above the resident one. */
    head: SheetBand | undefined;
    /** The unloaded run below the resident one. */
    tail: SheetBand | undefined;
    /** The source's element count, once known. */
    total: number | undefined;
    /** Whether every source element is resident. */
    exhausted: boolean;
    /** Whether a requested window is still in flight. */
    loading: boolean;
    /** Why the source could not be read, when it could not be. */
    error: string | undefined;
    /** Bump for `VirtualRows`' `sizeVersion` — heights change at constant count. */
    sizeVersion: number;
    /** Tell the driver where the viewport is. */
    reportViewport: (at: SheetViewport, isScrolling: boolean) => void;
    /** Jump to a source element (a seek result): pin its window and rebase. */
    jumpToElement: (element: number) => void;
    /** Drop any pending jump pin. */
    clearJump: () => void;
}

const IDLE: SheetPaging = {
    rows: [], rowsOffset: 0, head: undefined, tail: undefined, total: undefined,
    exhausted: true, loading: false, error: undefined, sizeVersion: 0,
    reportViewport: () => {}, jumpToElement: () => {}, clearJump: () => {},
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
}

/** A cache holding nothing. */
function emptyCache(source: SheetPagedSourceValue | undefined): SourceCache {
    return { source, revision: undefined, windows: new Map(), stale: undefined, total: undefined, totalRevision: undefined };
}

/** Whether two paged sources serve the same rows: the same id AND equivalent
 *  functions — `page` is the bridge over the author's projection, so its
 *  captures are what the rows are projected WITH (#809). */
const pagedSourceEquivalent = equivalentFor(Sheet.Types.Root.fields.rows.cases.paged);

/**
 * Drive a paged sheet source.
 *
 * @param source - The decoded `paged` arm (undefined ⇒ inline sheet; idles)
 * @param rowPx - The fixed pixel height of one row (the ledger's geometry)
 * @param bandPx - A group's band height (#740) — a group row measures its band, its lines and its blank line
 * @param policy - Residency policy (defaults to the Plan's)
 * @returns The resident rows, the bands, and the callbacks the renderer feeds
 */
export function useSheetPaging(
    source: SheetPagedSourceValue | undefined,
    rowPx: number,
    bandPx: number = rowPx,
    policy: ResidencyOptions = DEFAULT_RESIDENCY,
): SheetPaging {
    const [ledger, setLedger] = useState<WindowLedger>(() => createLedger(0, SHEET_PAGE_SIZE));
    const [residency, setResidency] = useState<Residency>(NO_RESIDENCY);
    const [viewportWindow, setViewportWindow] = useState(0);
    const [isScrolling, setIsScrolling] = useState(false);
    const [sizeVersion, setSizeVersion] = useState(0);
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
        if (source === undefined) return undefined;
        if (cacheRef.current.source === undefined || !pagedSourceEquivalent(cacheRef.current.source, source)) {
            cacheRef.current = emptyCache(source);
        }
        const held = cacheRef.current;
        // The snapshot first: every window below is read at it. A new one
        // is read afresh, and the rows each window had stand in until its
        // own land (#851).
        const currentRevision = source.revision?.();
        const revision = currentRevision?.type === "some" ? currentRevision.value : undefined;
        if (revision !== held.revision) {
            // A cache that holds nothing (a revision the source was still
            // discovering) leaves the last one that had rows standing in.
            if (held.windows.size > 0) held.stale = held.windows;
            held.windows = new Map();
            held.revision = revision;
        }
        let total: number | undefined;
        let error: string | undefined;
        try {
            const t = source.total();
            if (t.type === "some") total = Number(t.value);
        } catch (err) {
            console.error("[Sheet] paged source total failed:", err);
            error = readFailure(err);
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
        let loading = false;
        let standingIn = false;
        for (const w of residentWindows(residency)) {
            const known = held.windows.get(w);
            if (known !== undefined) { landed.push({ w, rows: known }); continue; }
            let win: ReturnType<SheetPagedSourceValue["page"]>;
            try {
                win = source.page(BigInt(w * SHEET_PAGE_SIZE), BigInt(SHEET_PAGE_SIZE));
            } catch (err) {
                console.error(`[Sheet] paged source page ${w} failed:`, err);
                error ??= readFailure(err);
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
            landed.push({ w, rows });
        }
        // Every resident window reads at the new revision now: the old one
        // has nothing left to stand in for.
        if (!standingIn) held.stale = undefined;
        return { total, landed, loading, error, standingIn };
    }, [source, residency]);

    const { result } = useTrackedEvaluation(read);
    const value = result.ok ? result.value : undefined;
    const readError = result.ok ? value?.error : readFailure(result.error);

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
        for (const { w, rows } of landed ?? []) {
            const px = rows.reduce((sum, r) => sum + (r.band.type === "some" ? (r.band.value.folded ? bandPx : bandPx + (r.lines.length + 1) * rowPx) : rowPx), 0);
            next = observeWindow(next, w, { px, rows: rows.length });
        }
        if (sourceChanged) {
            setResidency(NO_RESIDENCY);
            setViewportWindow(0);
        }
        if (next === ledger) return;
        setLedger(next);
        setSizeVersion(v => v + 1);
    }, [source?.id, sourceTotal, landed, ledger, rowPx, bandPx]);
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
        // Whatever left the run leaves the cache with it, a stand-in too.
        const keep = new Set(residentWindows(next));
        const { windows, stale } = cacheRef.current;
        for (const w of [...windows.keys()]) if (!keep.has(w)) windows.delete(w);
        if (stale !== undefined) for (const w of [...stale.keys()]) if (!keep.has(w)) stale.delete(w);
        setSizeVersion((v) => v + 1);
    }, [source, ledger, residency, viewportWindow, isScrolling, policy]);

    // The contiguous landed run from the residency's low window.
    const run = useMemo(() => {
        const out: SheetRowValue[] = [];
        if (value === undefined || isEmpty(residency)) return { rows: out, from: residency.lo, to: residency.lo - 1 };
        const byWindow = new Map(value.landed.map((l) => [l.w, l.rows]));
        let w = residency.lo;
        for (; w <= residency.hi; w++) {
            const rows = byWindow.get(w);
            if (rows === undefined) break;
            out.push(...rows);
        }
        return { rows: out, from: residency.lo, to: w - 1 };
    }, [value, residency]);

    const bands = useMemo(() => {
        if (isEmpty(residency) || ledger.windows === 0) return { head: undefined, tail: undefined };
        const head: SheetBand | undefined = residency.lo > 0
            ? { at: "head", from: 0, to: residency.lo * SHEET_PAGE_SIZE - 1, px: offsetOfWindow(ledger, residency.lo) }
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
    }, [residency, ledger, total, run.to]);

    const reportViewport = useCallback((at: SheetViewport, scrolling: boolean) => {
        setIsScrolling(scrolling);
        setViewportWindow((current) => {
            if (at.kind === "band") {
                if (at.px !== undefined && ledger.windows > 0) {
                    const bandTop = at.at === "head" ? 0 : offsetOfWindow(ledger, residency.hi + 1);
                    return Math.floor(elementAtOffset(ledger, bandTop + Math.max(0, at.px)) / SHEET_PAGE_SIZE);
                }
                return at.at === "head" ? Math.max(0, residency.lo - 1) : residency.hi + 1;
            }
            return at.offset >= 0 ? Math.floor(at.offset / SHEET_PAGE_SIZE) : current;
        });
    }, [residency.lo, residency.hi, ledger]);

    const jumpToElement = useCallback((element: number) => {
        const w = Math.floor(Math.max(0, element) / SHEET_PAGE_SIZE);
        setViewportWindow(w);
        setIsScrolling(false);
        setResidency((r) => pin(unpinAll(r), w));
    }, []);

    const clearJump = useCallback(() => { setResidency((r) => unpinAll(r)); }, []);

    // A pin protects the jump target only until it lands.
    useEffect(() => {
        if (residency.pins.size === 0 || landed === undefined) return;
        const landedSet = new Set(landed.map((l) => l.w));
        if ([...residency.pins].every((w) => landedSet.has(w))) setResidency((r) => unpinAll(r));
    }, [residency.pins, landed]);

    if (source === undefined) return IDLE;

    const exhausted = total !== undefined && run.from === 0 && run.rows.length >= total;
    return {
        rows: run.rows,
        rowsOffset: run.from * SHEET_PAGE_SIZE,
        head: bands.head,
        tail: bands.tail,
        total,
        exhausted,
        loading: value?.loading ?? false,
        error: readError,
        sizeVersion,
        reportViewport,
        jumpToElement,
        clearJump,
    };
}
