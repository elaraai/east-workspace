/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The instants a row carries (#631) — one walk over every arm's instant
 * fields, and what the axis reads off it: the fit-to-data extent and the rows
 * whose instants ride another arm (split out of `model.ts`, #815).
 *
 * @packageDocumentation
 */

import { instantOrder, type PlanAxisKind, type PlanInstantValue } from "./instant.js";
import type { PlanRowIndex, PlanRowValue } from "./model.js";
import type { RowKey } from "./plan-state.js";

// ── Instants (#631) ────────────────────────────────────────────────────────

/**
 * Visit every instant a row carries — each arm's instant fields, whatever
 * the kind — so the axis-kind checks and the fit-to-data extent walk one
 * list rather than each keeping a copy of the row vocabulary.
 *
 * @param row - The decoded row
 * @param visit - Called once per instant (interval ENDS flagged, so an
 *   ordinal end can be read inclusively)
 */
export function forEachInstant(row: PlanRowValue, visit: (t: PlanInstantValue, end: boolean) => void): void {
    const kind = row.kind;
    switch (kind.type) {
        case "span":
            for (const r of kind.value.runs) { visit(r.start, false); visit(r.end, true); }
            for (const d of kind.value.decisions) visit(d.at, false);
            for (const p of kind.value.ports) visit(p.at, false);
            break;
        case "buckets":
            for (const e of kind.value.events) visit(e.at, false);
            for (const m of kind.value.markers) visit(m.at, false);
            break;
        case "chart":
            for (const layer of kind.value.layers) {
                switch (layer.type) {
                    case "line": case "area": case "column": case "scatter": case "band":
                        for (const p of layer.value.points) visit(p.t, false);
                        break;
                    case "refBand": visit(layer.value.from, false); visit(layer.value.to, true); break;
                    case "refDot": visit(layer.value.t, false); break;
                    case "refLine": break;
                }
            }
            break;
        case "heat": {
            const cells = kind.value.cells;
            if (cells.type === "heat") for (const c of cells.value.cells) visit(c.at, false);
            else for (const c of cells.value) visit(c.at, false);
            break;
        }
        case "table":
            for (const s of kind.value.series) for (const c of s.cells) visit(c.at, false);
            break;
        case "cards":
            for (const c of kind.value.chips) { visit(c.from, false); visit(c.to, true); }
            break;
        case "events":
            for (const m of kind.value.marks) visit(m.at, false);
            break;
        case "group": {
            const summary = kind.value.summary;
            if (summary.type === "some") {
                const cells = summary.value;
                if (cells.type === "heat") for (const c of cells.value.cells) visit(c.at, false);
                else for (const c of cells.value) visit(c.at, false);
            }
            break;
        }
    }
}

/**
 * Every instant a row set touches ON the axis's arm, as numbers — the
 * fit-to-data window fallback. A row carrying ANY instant of another arm is
 * skipped whole: it renders as a diagnostic row (#811), never its marks, so
 * none of its instants may stretch the window. An ordinal axis has no extent
 * to fit (its list is its window).
 *
 * @param rows - The decoded rows
 * @param kind - The axis kind
 * @returns The `[min, max]` extent, or `undefined` when nothing positions
 */
export function dataExtent(rows: ReadonlyArray<PlanRowValue>, kind: PlanAxisKind): { min: number; max: number } | undefined {
    if (kind === "ordinal") return undefined;
    let min = Infinity;
    let max = -Infinity;
    for (const row of rows) {
        let lo = Infinity;
        let hi = -Infinity;
        let offArm = false;
        forEachInstant(row, (t) => {
            if (t.type !== kind) { offArm = true; return; }
            const n = instantOrder(t);
            if (n < lo) lo = n;
            if (n > hi) hi = n;
        });
        if (offArm) continue;
        if (lo < min) min = lo;
        if (hi > max) max = hi;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return undefined;
    return { min, max };
}

/** One row whose instants ride another arm than the axis — the diagnostic's subject. */
export interface PlanAxisMismatch {
    /** The offending row's key. */
    row: RowKey;
    /** The arm its instants ride (the first one found). */
    found: PlanAxisKind;
}

/**
 * The rows whose instants do NOT ride the axis's arm — the Planner's
 * single-axis-kind rule, enforced at render time (#631). A mixed arm is a
 * diagnostic naming the row and the arm it carries, never a silent
 * misplacement — and it belongs to THAT row (#811): the row renders in place
 * as a diagnostic row and derives nothing, while the rest of the canvas keeps
 * drawing. (It used to replace the whole canvas, so one bad row arriving in a
 * paged window mid-scroll made everything vanish.)
 *
 * @param index - The row-tree index
 * @param kind - The axis kind
 * @returns One entry per offending row, in collection order
 */
export function axisKindMismatches(index: PlanRowIndex, kind: PlanAxisKind): PlanAxisMismatch[] {
    const out: PlanAxisMismatch[] = [];
    for (const row of index.rows) {
        let found: PlanAxisKind | undefined;
        forEachInstant(row, (t) => { if (found === undefined && t.type !== kind) found = t.type; });
        if (found !== undefined) out.push({ row: row.key, found });
    }
    return out;
}
