/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What a canvas persists under its `storageKey` (#813) — the user's own
 * toggles and place, never the selection — and how it is read back.
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
}

/** What the canvas persists under its `storageKey` (#813). */
export interface PlanPersisted {
    /** The collapse of each row the user toggled (`true` = collapsed). */
    collapse: Array<[string, boolean]>;
    /** The chart rows the user expanded. */
    charts: string[];
    /** Where the scroll rests, once the user has scrolled a bounded frame. */
    anchor: PlanAnchor | null;
}

/** Nothing persisted yet. */
export const NOT_PERSISTED: PlanPersisted = { collapse: [], charts: [], anchor: null };

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
    const { collapse, charts, anchor } = stored as Partial<Record<keyof PlanPersisted, unknown>>;
    const okCollapse = Array.isArray(collapse) && collapse.every((e) =>
        Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && typeof e[1] === "boolean");
    const okCharts = Array.isArray(charts) && charts.every((k) => typeof k === "string");
    const a = anchor as Partial<PlanAnchor> | null | undefined;
    const okAnchor = typeof a === "object" && a !== null && typeof a.key === "string"
        && Number.isFinite(a.offset) && Number.isInteger(a.index)
        && (a.window === null || Number.isInteger(a.window));
    return {
        collapse: okCollapse ? collapse as Array<[string, boolean]> : [],
        charts: okCharts ? charts as string[] : [],
        anchor: okAnchor ? a as PlanAnchor : null,
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
    && x.key === y.key && x.offset === y.offset && x.index === y.index && x.window === y.window;
