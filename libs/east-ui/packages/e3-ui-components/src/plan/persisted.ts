/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What a canvas persists under its `storageKey` (#813) — the user's own
 * toggles and place, never the selection — and how it is read back. Its place
 * is where its scroll rests, and, while no source of its slice holds the
 * window, the canvas's own window (#1344): a reload opens on the dates the
 * viewer left, as it does on a window a source holds, which that source's
 * state keeps.
 *
 * @packageDocumentation
 */

/** Where a bounded canvas's scroll rests (#813) — a row, never pixels. */
export interface PlanAnchor {
    /** The first body item showing under the header (its `bodyItemKey`). */
    key: string;
    /** How many px of it are scrolled past. */
    offset: number;
    /** Its body index — the clamped fallback when the key is gone. */
    index: number;
    /** The source window its row came from, on a paged canvas — where a
     *  remount that has not loaded the row yet looks for it. */
    window: number | null;
    /** The block its row came from (#823) — which block the remount opens at
     *  that window; `null` for a row of no paged block, or an anchor saved
     *  before blocks paged apart (every block then opens there). */
    block: number | null;
}

/**
 * The canvas's own window (#1344) — what a canvas whose slice has no source
 * holding the window shows, as a gesture last moved it: `[min, max)` on the
 * axis's domain, on the arm it was written on.
 */
export interface PlanOwnWindow {
    /** The axis's arm it was written on: a time axis's, its bounds epoch ms, or a number axis's. */
    kind: "time" | "number";
    /** Its start, on the axis's domain. */
    min: number;
    /** Its end, exclusive. */
    max: number;
}

/** What the canvas persists under its `storageKey` (#813). */
export interface PlanPersisted {
    /** The collapse of each row the user toggled (`true` = collapsed). */
    collapse: Array<[string, boolean]>;
    /** The chart rows the user expanded. */
    charts: string[];
    /** Where the scroll rests, once the user has scrolled a bounded frame. */
    anchor: PlanAnchor | null;
    /**
     * The canvas's own window, once a gesture has moved it (#1344): never a
     * window a source of the slice holds, which that source's state keeps.
     * Absent until there is one.
     */
    window?: PlanOwnWindow;
}

/** Nothing persisted yet. */
export const NOT_PERSISTED: PlanPersisted = { collapse: [], charts: [], anchor: null };

/**
 * The canvas's own window as storage holds it, taken only in the shape this
 * version writes: an arm it names, and finite bounds, the end past the start.
 *
 * @param stored - What storage holds under the persisted state's `window`
 * @returns The window; `undefined` for anything else
 */
function ownWindowOf(stored: unknown): PlanOwnWindow | undefined {
    if (typeof stored !== "object" || stored === null) return undefined;
    const { kind, min, max } = stored as Partial<Record<keyof PlanOwnWindow, unknown>>;
    if ((kind !== "time" && kind !== "number") || typeof min !== "number" || typeof max !== "number") return undefined;
    return Number.isFinite(min) && Number.isFinite(max) && max > min ? { kind, min, max } : undefined;
}

/**
 * The persisted state, read defensively: storage outlives versions and anyone
 * can write it, so each part is taken only in the shape this version writes
 * and dropped otherwise — never trusted into the store.
 *
 * @param stored - Whatever the storage holds under the canvas's key
 * @returns The parts this version can use
 */
export function persistedOf(stored: unknown): PlanPersisted {
    if (typeof stored !== "object" || stored === null) return NOT_PERSISTED;
    const { collapse, charts, anchor, window } = stored as Partial<Record<keyof PlanPersisted, unknown>>;
    const okCollapse = Array.isArray(collapse) && collapse.every((e) =>
        Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && typeof e[1] === "boolean");
    const okCharts = Array.isArray(charts) && charts.every((k) => typeof k === "string");
    const a = anchor as Partial<PlanAnchor> | null | undefined;
    const okAnchor = typeof a === "object" && a !== null && typeof a.key === "string"
        && Number.isFinite(a.offset) && Number.isInteger(a.index)
        && (a.window === null || Number.isInteger(a.window))
        // Written before blocks paged apart, an anchor names none.
        && (a.block === undefined || a.block === null || Number.isInteger(a.block));
    const own = ownWindowOf(window);
    return {
        collapse: okCollapse ? collapse as Array<[string, boolean]> : [],
        charts: okCharts ? charts as string[] : [],
        anchor: okAnchor ? { ...(a as PlanAnchor), block: a.block ?? null } : null,
        ...(own === undefined ? {} : { window: own }),
    };
}

/** Whether two lists hold the same entries in the same order. */
export function sameList<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean): boolean {
    return a.length === b.length && a.every((x, i) => same(x, b[i]!));
}

/** Two persisted collapse toggles are the same. */
export const sameToggle = (x: readonly [string, boolean], y: readonly [string, boolean]): boolean =>
    x[0] === y[0] && x[1] === y[1];

/** Two row keys are the same. */
export const sameKey = (x: string, y: string): boolean => x === y;

/** Two anchors are the same — `x` may be absent. */
export const sameAnchor = (x: PlanAnchor | null, y: PlanAnchor): boolean => x !== null
    && x.key === y.key && x.offset === y.offset && x.index === y.index && x.window === y.window && x.block === y.block;

/** Two of the canvas's own windows are the same — `x` may be absent. */
export const sameOwnWindow = (x: PlanOwnWindow | undefined, y: PlanOwnWindow): boolean => x !== undefined
    && x.kind === y.kind && x.min === y.min && x.max === y.max;
