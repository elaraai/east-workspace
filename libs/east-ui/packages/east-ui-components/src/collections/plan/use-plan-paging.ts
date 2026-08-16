/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The paged canvas's driver (#577) — the loop between where the viewport is and
 * which windows are resident.
 *
 * Owns two pieces of state and nothing else:
 *
 * - the {@link WindowLedger}, the scroll geometry in source ELEMENTS, which
 *   remembers every window it has ever measured so eviction moves nothing;
 * - the {@link Residency}, one contiguous run of whole windows, which follows
 *   the viewport a window at a time and rebases on a far jump.
 *
 * Everything hard is in those two pure modules and in {@link readWindows}; this
 * is the React shell that sequences them:
 *
 * ```
 * viewport ──▶ residency.advance ──▶ readWindows ──▶ ledger.observeWindow
 *     ▲                                                      │
 *     └──────────── the renderer's range signal ◀────────────┘
 * ```
 *
 * # Why the caller reports a ROW, not an index
 *
 * `VirtualRows` reports a mounted range in BODY-ITEM indices, and the body is
 * the caller's business — it interleaves gap bands under a links focus, hides
 * collapsed subtrees, pins rows above the scroll. So the caller says which ROW
 * (or which band) the viewport is over, and the driver maps that back to a
 * window through the origin map. No layout knowledge crosses the boundary.
 *
 * # Demand is idle-gated
 *
 * Nothing is fetched or evicted while the user is mid-gesture. The extent is
 * therefore constant for the whole of a drag, so the thumb cannot move under
 * the cursor and "60% of the way down" means the same element when the gesture
 * ends as when it began.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTrackedEvaluation } from "../../reactive/index.js";
import type { PlanBand, PlanRootValue, PlanRowValue } from "./model.js";

/** The decoded `paged` arm — the derived source at the canvas-row type. */
export type PlanPagedSourceValue = Extract<PlanRootValue["rows"], { type: "paged" }>["value"];
import {
    createLedger, observeWindow, documentHeight, offsetOfWindow, elementsIn,
    type WindowLedger,
} from "./window-ledger.js";
import {
    NO_RESIDENCY, DEFAULT_RESIDENCY, advance, isEmpty, residentWindows, pin, unpinAll,
    type Residency, type ResidencyOptions,
} from "./window-residency.js";
import {
    readWindows, mergeWindows, originOf, pruneCache,
    type WindowCache,
} from "./window-reader.js";

/** Source elements per window. */
export const PLAN_PAGE_SIZE = 200;

export type { PlanBand } from "./model.js";

/** Where the viewport is, in the caller's own terms. */
export type PlanViewport =
    | { kind: "row"; key: string }
    | { kind: "band"; at: "head" | "tail" };

export interface PlanPagingOptions {
    /**
     * The exact pixel height of a window's rows.
     *
     * Exact rather than measured because the canvas is fixed-height by kind and
     * mounts with `measureRows={false}` — `rowHeight()` IS the layout, so the
     * ledger can be fed from the model with no DOM round-trip.
     */
    heightOf: (rows: readonly PlanRowValue[]) => number;
    /** Residency policy (defaults to {@link DEFAULT_RESIDENCY}). */
    policy?: ResidencyOptions | undefined;
}

export interface PlanPaging {
    /** The resident rows, merged by key, in canonical key order. */
    rows: PlanRowValue[];
    /** Which window each row came from. */
    origin: ReadonlyMap<string, number>;
    /** The unloaded run above the resident one, if any. */
    head: PlanBand | undefined;
    /** The unloaded run below the resident one, if any. */
    tail: PlanBand | undefined;
    /** The source's element count, once known. */
    total: number | undefined;
    /** What has actually LANDED: the element span it covers, and how many
     *  elements that is. The span and the count differ while a window inside
     *  the run is still in flight, and the chrome must not conflate them —
     *  reporting the demanded interval would claim elements are loaded that are
     *  still on the wire. */
    resident: { from: number; to: number; elements: number } | undefined;
    /** Whether a requested window is still in flight. */
    loading: boolean;
    /** Why the source could not be read, when it could not be. */
    error: string | undefined;
    /** Bump for `VirtualRows`' `sizeVersion` — heights change at constant count. */
    sizeVersion: number;
    /** Tell the driver where the viewport is. */
    reportViewport: (at: PlanViewport, isScrolling: boolean) => void;
    /** Jump to a source element (a seek result): pin its window and rebase. */
    jumpToElement: (element: number) => void;
}

const IDLE: PlanPaging = {
    rows: [], origin: new Map(), head: undefined, tail: undefined,
    total: undefined, resident: undefined, loading: false, error: undefined,
    sizeVersion: 0,
    reportViewport: () => {},
    jumpToElement: () => {},
};

/** One line naming why a source read failed. */
function readFailure(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Drive a paged source: demand windows around the viewport, evict far ones, and
 * describe the unloaded remainder as two bands.
 *
 * @param source - The decoded `paged` arm (undefined ⇒ inline canvas; idles)
 * @param options - See {@link PlanPagingOptions}
 * @returns The resident rows, the bands, and the callbacks the renderer feeds
 */
export function usePlanPaging(
    source: PlanPagedSourceValue | undefined,
    options: PlanPagingOptions,
): PlanPaging {
    const policy = options.policy ?? DEFAULT_RESIDENCY;
    const { heightOf } = options;

    const [ledger, setLedger] = useState<WindowLedger>(() => createLedger(0, PLAN_PAGE_SIZE));
    const [residency, setResidency] = useState<Residency>(NO_RESIDENCY);
    const [viewportWindow, setViewportWindow] = useState(0);
    const [isScrolling, setIsScrolling] = useState(false);
    const [sizeVersion, setSizeVersion] = useState(0);

    // Read-once cache, per source identity. Reset here rather than in an effect
    // so a swapped source cannot serve the previous one's rows for a frame.
    const cacheRef = useRef<{ id: string; cache: WindowCache }>({ id: "", cache: new Map() });
    const originRef = useRef<ReadonlyMap<string, number>>(new Map());

    const read = useCallback(() => {
        if (source === undefined) return undefined;
        if (cacheRef.current.id !== source.id) {
            cacheRef.current = { id: source.id, cache: new Map() };
        }
        let total: number | undefined;
        let error: string | undefined;
        try {
            const t = source.total();
            if (t.type === "some") total = Number(t.value);
        } catch (err) {
            console.error("[Plan] paged source total failed:", err);
            error = readFailure(err);
        }
        const wanted = residentWindows(residency);
        const result = readWindows(source, wanted, cacheRef.current.cache, PLAN_PAGE_SIZE);
        return {
            total,
            resident: result.resident,
            loading: result.loading,
            error: error ?? result.error,
        };
    }, [source, residency]);

    const { result } = useTrackedEvaluation(read);
    const value = result.ok ? result.value : undefined;
    const readError = result.ok ? value?.error : readFailure(result.error);

    // ── The source's size defines the geometry ────────────────────────────
    const total = value?.total;
    useEffect(() => {
        if (total === undefined || total === ledger.total) return;
        setLedger(createLedger(total, PLAN_PAGE_SIZE));
        setResidency(NO_RESIDENCY);
        setSizeVersion((v) => v + 1);
    }, [total, ledger.total]);

    // ── Landed windows teach the ledger ───────────────────────────────────
    const landed = value?.resident;
    useEffect(() => {
        if (landed === undefined || landed.length === 0) return;
        let next = ledger;
        for (const { w, rows } of landed) {
            next = observeWindow(next, w, { px: heightOf([...rows.values()]), rows: rows.size });
        }
        if (next === ledger) return;
        setLedger(next);
        // Heights changed while the body-item count barely moved — TanStack's
        // measurement memo does not watch `estimateSize`, so say so explicitly.
        setSizeVersion((v) => v + 1);
    }, [landed, ledger, heightOf]);

    // ── Demand follows the viewport, at idle only ─────────────────────────
    useEffect(() => {
        if (source === undefined) return;
        // Bootstrap. `total()` answers `none` until some window has landed
        // (it is taught BY a landing), and the geometry needs the total — so
        // waiting for one before demanding anything deadlocks on first paint.
        // Window 0 is therefore demanded regardless, and the total arrives with
        // it. A source that never reports a total still works: it simply has no
        // bands and no extent beyond what is resident.
        if (ledger.windows === 0) {
            if (isEmpty(residency)) setResidency((r) => ({ ...r, lo: 0, hi: 0 }));
            return;
        }
        if (isScrolling) return;
        const next = advance(residency, ledger, viewportWindow, policy);
        if (next === residency) return;
        setResidency(next);
        // Whatever left the run leaves the cache with it — this is the half of
        // eviction that actually frees memory.
        pruneCache(cacheRef.current.cache, new Set(residentWindows(next)));
        setSizeVersion((v) => v + 1);
    }, [source, ledger, residency, viewportWindow, isScrolling, policy]);

    // ── What the renderer sees ────────────────────────────────────────────
    const rows = useMemo(
        () => (value?.resident !== undefined ? mergeWindows(value.resident) : []),
        [value?.resident],
    );
    const origin = useMemo(
        () => (value?.resident !== undefined ? originOf(value.resident) : new Map<string, number>()),
        [value?.resident],
    );
    originRef.current = origin;

    const bands = useMemo(() => {
        if (isEmpty(residency) || ledger.windows === 0 || total === undefined) {
            return { head: undefined, tail: undefined };
        }
        const head: PlanBand | undefined = residency.lo > 0
            ? {
                at: "head",
                from: 0,
                to: residency.lo * PLAN_PAGE_SIZE - 1,
                px: offsetOfWindow(ledger, residency.lo),
            }
            : undefined;
        const lastWindow = ledger.windows - 1;
        const tail: PlanBand | undefined = residency.hi < lastWindow
            ? {
                at: "tail",
                from: (residency.hi + 1) * PLAN_PAGE_SIZE,
                to: total - 1,
                px: documentHeight(ledger) - offsetOfWindow(ledger, residency.hi + 1),
            }
            : undefined;
        return { head, tail };
    }, [residency, ledger, total]);

    const resident = useMemo(() => {
        const landedWindows = value?.resident.map((r) => r.w) ?? [];
        if (landedWindows.length === 0 || total === undefined) return undefined;
        // The SPAN of what landed — not of what was demanded.
        const lo = Math.min(...landedWindows);
        const hi = Math.max(...landedWindows);
        let elements = 0;
        for (const w of landedWindows) elements += elementsIn({ pageSize: PLAN_PAGE_SIZE, total }, w);
        return {
            from: lo * PLAN_PAGE_SIZE,
            to: Math.min(total, (hi + 1) * PLAN_PAGE_SIZE),
            elements,
        };
    }, [value?.resident, total]);

    // ── Callbacks the renderer feeds ──────────────────────────────────────
    const reportViewport = useCallback((at: PlanViewport, scrolling: boolean) => {
        setIsScrolling(scrolling);
        setViewportWindow((current) => {
            if (at.kind === "band") {
                // Over a band: the viewport wants the window just outside the
                // run on that side. One step per commit walks it in.
                return at.at === "head"
                    ? Math.max(0, residency.lo - 1)
                    : residency.hi + 1;
            }
            const w = originRef.current.get(at.key);
            return w ?? current;
        });
    }, [residency.lo, residency.hi]);

    const jumpToElement = useCallback((element: number) => {
        const w = Math.floor(Math.max(0, element) / PLAN_PAGE_SIZE);
        setViewportWindow(w);
        setIsScrolling(false);
        // Pin it so no trim can drop the destination before it lands, and clear
        // any previous pin — one jump at a time.
        setResidency((r) => pin(unpinAll(r), w));
    }, []);

    if (source === undefined) return IDLE;

    return {
        rows,
        origin,
        head: bands.head,
        tail: bands.tail,
        total,
        resident,
        loading: value?.loading ?? false,
        error: readError,
        sizeVersion,
        reportViewport,
        jumpToElement,
    };
}

/** Elements the band covers, for its caption. */
export function bandElements(band: PlanBand): number {
    return Math.max(0, band.to - band.from + 1);
}

/** The window a band's near edge sits at — what a caption reports as it scrolls. */
export function bandWindowAt(ledger: WindowLedger, element: number): number {
    if (ledger.pageSize <= 0) return 0;
    return Math.min(Math.max(0, Math.floor(element / ledger.pageSize)), Math.max(0, ledger.windows - 1));
}

/** Re-exported so the renderer can size a band's own slot. */
export { elementsIn };
