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
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    const cacheRef = useRef<{ id: string; cache: WindowCache }>({ id: "", cache: new Map() });

    const read = useCallback(() => {
        if (source === undefined) return undefined;
        if (cacheRef.current.id !== source.id) cacheRef.current = { id: source.id, cache: new Map() };
        let total: number | undefined;
        let error: string | undefined;
        try {
            const t = source.total();
            if (t.type === "some") total = Number(t.value);
        } catch (err) {
            console.error("[Sheet] paged source total failed:", err);
            error = readFailure(err);
        }
        const landed: { w: number; rows: readonly SheetRowValue[] }[] = [];
        let loading = false;
        for (const w of residentWindows(residency)) {
            const known = cacheRef.current.cache.get(w);
            if (known !== undefined) { landed.push({ w, rows: known }); continue; }
            let win: ReturnType<SheetPagedSourceValue["page"]>;
            try {
                win = source.page(BigInt(w * SHEET_PAGE_SIZE), BigInt(SHEET_PAGE_SIZE));
            } catch (err) {
                console.error(`[Sheet] paged source page ${w} failed:`, err);
                error ??= readFailure(err);
                continue;
            }
            if (win.type !== "some") { loading = true; continue; }
            const rows = win.value as readonly SheetRowValue[];
            cacheRef.current.cache.set(w, rows);
            landed.push({ w, rows });
        }
        return { total, landed, loading, error };
    }, [source, residency]);

    const { result } = useTrackedEvaluation(read);
    const value = result.ok ? result.value : undefined;
    const readError = result.ok ? value?.error : readFailure(result.error);

    // The source's size defines the geometry.
    const total = value?.total;
    useEffect(() => {
        if (total === undefined || total === ledger.total) return;
        if (ledger.total > 0) {
            console.warn(`[Sheet] paged source ${source !== undefined ? `"${source.id}" ` : ""}changed total() ${ledger.total} → ${total} under one id — same id must serve same rows; dropping cached windows.`);
            cacheRef.current = { id: cacheRef.current.id, cache: new Map() };
        }
        setLedger(createLedger(total, SHEET_PAGE_SIZE));
        setResidency(NO_RESIDENCY);
        setSizeVersion((v) => v + 1);
    }, [total, ledger.total, source]);

    // Landed windows teach the ledger — rows are fixed-height, so the geometry
    // is exact; a group row (#740) is its band, its lines and its blank line.
    const landed = value?.landed;
    useEffect(() => {
        if (landed === undefined || landed.length === 0) return;
        let next = ledger;
        for (const { w, rows } of landed) {
            const px = rows.reduce((sum, r) => sum + (r.band.type === "some" ? (r.band.value.folded ? bandPx : bandPx + (r.lines.length + 1) * rowPx) : rowPx), 0);
            next = observeWindow(next, w, { px, rows: rows.length });
        }
        if (next === ledger) return;
        setLedger(next);
        setSizeVersion((v) => v + 1);
    }, [landed, ledger, rowPx, bandPx]);

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
        const keep = new Set(residentWindows(next));
        for (const w of [...cacheRef.current.cache.keys()]) if (!keep.has(w)) cacheRef.current.cache.delete(w);
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
        if (isEmpty(residency) || ledger.windows === 0 || total === undefined) return { head: undefined, tail: undefined };
        const head: SheetBand | undefined = residency.lo > 0
            ? { at: "head", from: 0, to: residency.lo * SHEET_PAGE_SIZE - 1, px: offsetOfWindow(ledger, residency.lo) }
            : undefined;
        const lastWindow = ledger.windows - 1;
        const tail: SheetBand | undefined = run.to < lastWindow
            ? {
                at: "tail",
                from: (run.to + 1) * SHEET_PAGE_SIZE,
                to: total - 1,
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
