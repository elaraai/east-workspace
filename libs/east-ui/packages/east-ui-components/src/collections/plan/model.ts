/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's decoded-value view model (`Plan Spec.md` §6.2) — pure selectors
 * over the flat `parent`-keyed rows: the row-tree index, the visible-row
 * derivation (grain × collapsed subtrees), and per-row height
 * estimation for the virtualizer. No React, no DOM.
 *
 * Rows arrive in the collection's canonical KEY order (the IR's row collection
 * is a `Dict`, decoded as a `SortedMap` — #568), and every traversal here
 * walks the TREE the `parent` keys encode rather than that flat order, so a
 * subtree need not be contiguous and no derivation depends on the container.
 *
 * The derivations (`derive.ts`), the body items and link graph
 * (`body-items.ts`), the instant walks (`row-instants.ts`) and the tree walks
 * (`row-tree.ts`) live beside it and are re-exported here (#815).
 *
 * @packageDocumentation
 */

import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { initialPlanState, type PlanGrain, type PlanUiState, type RowKey } from "./plan-state.js";
import type { PlanAxisKind } from "./instant.js";
import { ancestorsOf } from "./row-tree.js";
import { derivePlan, type PlanDerived } from "./derive.js";
import { PLAN_GEOMETRY, planGeometry } from "./geometry.js";

// The model's other halves, one import path for all of it (#815).
export { forEachInstant, dataExtent, axisKindMismatches, type PlanAxisMismatch } from "./row-instants.js";
export {
    tableRollupSeries, deriveBands, deriveHeatCells, deriveTableCells, deriveTableSeries, derivePlan, stableDerived,
    type DerivedBand, type HeatScale, type PlanRowDiagnostic, type PlanDerived,
} from "./derive.js";
export {
    linkedRowKeys, bodyItemKey, placeFailures, firstDiagnosticItem, elideForFocus, deriveLinkFamily,
    type FocusGap, type PlanBand, type PlanWindowFailure, type PlanBodyItem, type LinkFamily,
} from "./body-items.js";

/** The decoded Plan root value. */
export type PlanRootValue = ValueTypeOf<typeof Plan.Types.Root>;
/** One decoded flat row. */
export type PlanRowValue = ValueTypeOf<typeof Plan.Types.Row>;
/** One decoded link edge (the R1 graph / K8 ribbon shape). */
export type PlanLinkValue = ValueTypeOf<typeof Plan.Types.Link>;

/** The flat rows indexed for traversal. */
export interface PlanRowIndex {
    /** Rows in the collection's canonical key order. */
    rows: ReadonlyArray<PlanRowValue>;
    /** Row lookup by key. */
    byKey: ReadonlyMap<RowKey, PlanRowValue>;
    /** Direct children (key order) by parent key. */
    children: ReadonlyMap<RowKey, PlanRowValue[]>;
    /** Root rows (`parent: none`), key order. */
    roots: ReadonlyArray<PlanRowValue>;
    /** Nesting depth by key (roots = 0). */
    depth: ReadonlyMap<RowKey, number>;
    /** Group-strip keys that the IR declares initially collapsed. */
    initiallyCollapsed: ReadonlySet<RowKey>;
}

/**
 * Build the row index once per decoded value.
 *
 * @param rows - The decoded rows in collection order (a keyed collection's
 *   values, already in key order — the caller flattens the `SortedMap`)
 * @returns The tree index every other selector walks
 */
export function indexRows(rows: ReadonlyArray<PlanRowValue>): PlanRowIndex {
    const byKey = new Map<RowKey, PlanRowValue>();
    const children = new Map<RowKey, PlanRowValue[]>();
    const roots: PlanRowValue[] = [];
    for (const row of rows) {
        byKey.set(row.key, row);
        if (row.parent.type === "some") {
            const list = children.get(row.parent.value);
            if (list !== undefined) list.push(row);
            else children.set(row.parent.value, [row]);
        } else {
            roots.push(row);
        }
    }
    const depth = new Map<RowKey, number>();
    const walk = (row: PlanRowValue, d: number) => {
        depth.set(row.key, d);
        for (const child of children.get(row.key) ?? []) walk(child, d + 1);
    };
    for (const root of roots) walk(root, 0);
    const initiallyCollapsed = new Set<RowKey>();
    for (const row of rows) {
        if (row.kind.type === "group" && row.kind.value.collapsed.type === "some" && row.kind.value.collapsed.value) {
            initiallyCollapsed.add(row.key);
        }
    }
    return { rows, byKey, children, roots, depth, initiallyCollapsed };
}

/** One visible line of the canvas body. */
export interface VisibleRow {
    row: PlanRowValue;
    /** Nesting depth (drives the 30px/level gutter indent). */
    depth: number;
    /** For group strips / nesting parents: whether the subtree is collapsed. */
    collapsed: boolean;
}

/**
 * The visible rows for the current UI state — the §5/§6 derivation:
 *
 * - `resource` grain (default): depth-first walk; a collapsed group strip (or
 *   collapsed nesting parent) keeps its own line and hides its subtree.
 * - `group` grain: every root group collapses to its summary strip; non-group
 *   roots stay.
 *
 * Pinned rows are excluded here — they render above the virtualised body,
 * under the ruler (`pinnedRows`).
 */
export function visibleRows(
    index: PlanRowIndex,
    /** The UI facts the rows follow — the grain and the collapsed set. */
    ui: Pick<PlanUiState, "grain" | "collapsed">,
    /** Keys a links focus must reveal — a collapsed subtree CONTAINING one
     *  auto-expands for the focus and restores on return (R1). */
    reveal?: ReadonlySet<RowKey>,
): VisibleRow[] {
    const out: VisibleRow[] = [];
    const grain: PlanGrain = ui.grain;
    const isPinned = (row: PlanRowValue) => row.pinned.type === "some" && row.pinned.value;
    // "Must this subtree stay open for the focus?" answered ONCE: the set of
    // strict ANCESTORS of every revealed key, built by walking `parent`
    // pointers upward — O(reveal × depth). (It used to recurse down the
    // children per visited row, O(n²) under a links focus on wide trees —
    // #616.)
    const revealAncestors = ancestorsOf(index, reveal);
    const walk = (row: PlanRowValue, depth: number) => {
        if (isPinned(row)) return;
        const kids = index.children.get(row.key) ?? [];
        const isGroup = row.kind.type === "group";
        const collapsed = (ui.collapsed.has(row.key) || (grain === "group" && isGroup && depth === 0))
            && !revealAncestors.has(row.key);
        out.push({ row, depth, collapsed });
        if (!collapsed) for (const child of kids) walk(child, depth + 1);
    };
    for (const root of index.roots) walk(root, 0);
    return out;
}

/** The pinned rows (IR order) — rendered above the virtualised body. */
export function pinnedRows(index: PlanRowIndex): PlanRowValue[] {
    return index.rows.filter((row) => row.pinned.type === "some" && row.pinned.value);
}

// ── Row heights (the §8 sheet; px) ─────────────────────────────────────────
// Every height below is an entry of the ONE geometry table (`geometry.ts`,
// #817) — the table the recipe reads too, as CSS variables. These names are
// its default-density entries, kept for the code and tests that name them.

/** Default span/bucket/cards/table row height. Tables share it: numerals need
 *  no less room than a bar does, and a table row at the dense height beside
 *  default rows read as a mistake. */
export const ROW_H = PLAN_GEOMETRY.default.row;
/** Dense row height (`density: compact`). */
export const ROW_H_DENSE = PLAN_GEOMETRY.dense.row;
/** Group band height. */
export const GROUP_H = PLAN_GEOMETRY.default.group;
/** Group summary heat-strip height (collapsed group with cells). */
export const GROUP_STRIP_H = PLAN_GEOMETRY.default.groupStrip;
/** Chart spark / expanded heights. */
export const CHART_SPARK_H = PLAN_GEOMETRY.default.chartSpark;
export const CHART_EXPANDED_H = PLAN_GEOMETRY.default.chartExpanded;
/** Heat ROW height — 22px cells (§8) + the 3px insets above and below. */
export const HEAT_ROW_H = PLAN_GEOMETRY.default.heatRow;
/** Two-line-gutter row minimum (the §8 sheet: row min-height 42px). */
export const ROW_H_STACKED = PLAN_GEOMETRY.default.rowStacked;
/** Links-focus rail height — a LONE unrelated row collapses, never removed (R1). */
export const RAIL_H = PLAN_GEOMETRY.default.rail;
/** Expand-focus CONTEXT STRIP height (R2) — an unfocused row compresses to
 *  this, keeping its marks on the shared axis at {@link STRIP_MARK_H}. Taller
 *  than the links rail on purpose: a rail only has to carry a status dot,
 *  a strip has to carry the row's actual marks. */
export const STRIP_H = PLAN_GEOMETRY.default.strip;
/** The mark height inside a context strip — v2's "bars reduced to 7px marks". */
export const STRIP_MARK_H = PLAN_GEOMETRY.default.stripMark;
/** Links-focus gap-band height — a RUN of unrelated rows elides to one
 *  double-height band wearing the ⋯ icon (R1 at scale). */
export const GAP_H = PLAN_GEOMETRY.default.gap;

/** The row-focus height context (R1 rails / R2 strips) threaded to {@link rowHeight}. */
export interface PlanFocusCtx {
    kind: "links" | "expand";
    /** The focused row. */
    key: RowKey;
    /** Full-height family keys (links focus; the focused row is implied). */
    family?: ReadonlySet<RowKey> | undefined;
    /** R2 — the clamped developer-render height, in px.
     *
     *  The render lives INSIDE the focused row rather than beside it, because
     *  the gutter has to grow with it: v2 gives the expanded row ONE tall
     *  gutter cell, top-aligned, whose new space is the author's
     *  (`expandGutter`). A render mounted as a sibling row would leave that
     *  cell 32px tall with a blank column beside the render — which is
     *  precisely the tell that the row did not really expand. */
    renderPx?: number | undefined;
}

/** Parse a CSS px size (`"120px"` / `"120"`) to a number; `undefined` for
 *  anything a virtualized row can't be (`"fill"`, percentages).
 *
 *  The unit test is the doc: `parseFloat("50%")` is `50`, so bare
 *  `parseFloat` silently turned a percentage height into 50px (#615) —
 *  only a `px` suffix or a bare number qualifies. */
export function pxOf(size: string): number | undefined {
    if (!/^\s*-?(\d+\.?\d*|\.\d+)(px)?\s*$/.test(size)) return undefined;
    const n = parseFloat(size);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * A visible row's pixel height — the virtualizer's size for it AND the height
 * it renders at (rows are fixed-height by kind), from the density's geometry
 * table ({@link planGeometry}).
 *
 * @param v - The visible row
 * @param dense - Whether the canvas is dense
 * @param chartsExpanded - The chart rows the user expanded
 * @param focus - The row focus, when one is active (R1 rails / R2 strips)
 * @param derived - The derived numbers, when available (see the parameter note)
 * @returns The height, px
 */
export function rowHeight(
    v: VisibleRow,
    dense: boolean,
    chartsExpanded: ReadonlySet<RowKey>,
    focus?: PlanFocusCtx,
    /** The derived numbers, when available. A subtotal parent carries NO
     *  series of its own — its positions are derived — so without this a
     *  vertical multi-position subtotal would estimate as a single line and
     *  render taller than the virtualizer was told. */
    derived?: PlanDerived,
): number {
    // Row focus compresses the DATA rows it is not about; group bands always
    // fall through to their wayfinding height, because a wall of strips is
    // unreadable without the structure that says which rows they are
    // ("collapse, never remove" — the rows stay mounted, in order, either way).
    //
    // A links focus rails unrelated rows to 11px (a status dot); an expand
    // focus strips every other row to 16px, where its marks survive at 7px on
    // the same axis. The FOCUSED row falls through to its normal kind height
    // in both cases — R2 grows the canvas under the row, not the row itself.
    const g = planGeometry(dense);
    if (focus !== undefined && v.row.kind.type !== "group") {
        if (focus.kind === "links") {
            const inFamily = v.row.key === focus.key || (focus.family?.has(v.row.key) ?? false);
            if (!inFamily) return g.rail;
        } else if (v.row.key !== focus.key) {
            return g.strip;
        } else if (focus.renderPx !== undefined && focus.renderPx > 0) {
            // The FOCUSED row grows by its render — the row's own marks keep
            // their band at the top, the render fills the rest, and the gutter
            // spans both. Recursing with the focus dropped gets the row's
            // natural kind height without duplicating the switch below.
            return rowHeight(v, dense, chartsExpanded, undefined, derived) + focus.renderPx;
        }
    }
    const explicit = v.row.height.type === "some" ? pxOf(v.row.height.value) : undefined;
    if (explicit !== undefined) return explicit;
    const kind = v.row.kind;
    // Any two-line gutter (a sub line, or the stacked flag) floors the row at
    // 42px on every data kind — a one-line height would clip the sub text.
    const twoLine = (v.row.gutter.stacked.type === "some" && v.row.gutter.stacked.value)
        || v.row.gutter.sub.type === "some";
    const floor = (h: number) => (twoLine ? Math.max(h, g.rowStacked) : h);
    // A diagnostic row (#811) draws its message, never its marks — one line
    // at the shared default; a diagnosed group keeps its band and drops the
    // strip it cannot place.
    if (derived?.diagnostics.has(v.row.key) === true) {
        return kind.type === "group" ? g.group : floor(g.row);
    }
    switch (kind.type) {
        case "group": {
            const hasStrip = v.collapsed
                && (kind.value.summary.type === "some" || kind.value.summaryAggregate.type === "some");
            return hasStrip ? g.groupStrip : g.group;
        }
        case "chart": {
            const h = kind.value.height;
            if (h.type === "fixed") {
                const px = pxOf(h.value);
                if (px !== undefined) return px;
            }
            const expanded = h.type === "expanded" || chartsExpanded.has(v.row.key);
            // The two-line floor applies to a chart's DEFAULT heights like
            // every other kind: a spark row is 32px, and a 42px sub-line does
            // not fit in it — it clipped, which is what the floor exists to
            // prevent. A DECLARED px (`fixed`, `expandedHeight`) is the
            // author's word and stays unfloored, the same rule the row-level
            // `height` override above follows.
            if (!expanded) return floor(g.chartSpark);
            // A declared expandedHeight overrides the 88px expanded default —
            // an expandable spark can open to a full composition height.
            const eh = kind.value.expandedHeight.type === "some" ? pxOf(kind.value.expandedHeight.value) : undefined;
            return eh ?? floor(g.chartExpanded);
        }
        case "heat": return floor(g.heatRow);
        case "table": {
            // A vertical multi-series stack grows the row, one line per series.
            const n = derived?.tableSeries.get(v.row.key)?.length ?? kind.value.series.length;
            if (kind.value.split.type === "vertical" && n > 1) return floor(Math.max(g.row, g.tablePad + n * g.tableLine));
            return floor(g.row);
        }
        case "buckets": {
            // Laned rows grow — the Planner cell grid: a cell per lane, a gap
            // between, lane padding above and below (§4·K2).
            const n = kind.value.lanes.length;
            if (n > 1) return floor(2 * g.lanePad + n * g.laneCell + (n - 1) * g.laneGap);
            return floor(g.row);
        }
        default: return floor(g.row);
    }
}

/**
 * The pixel height a window's rows render AT REST (#613) — declared collapse
 * applied, chart expansion at its declared state, no focus context, pinned
 * rows excluded (they render in the header, not the body).
 *
 * The window ledger freezes a window's FIRST measurement, and seeds its
 * frozen slot rate from the first window ever measured — so the recorded
 * number must not depend on transient UI state. Measuring through the live
 * state recorded strip-compressed rows when a window landed during an expand
 * focus, full heights for rows an IR-collapsed group renders hidden, and
 * whatever a chart toggle happened to be at the moment — breaking the
 * band px == rendered px equality the eviction-moves-nothing invariant
 * rests on, and (worst) poisoning the slot rate for the life of the source
 * when the FIRST window landed mid-focus.
 *
 * A window is a complete forest (#577: any union of whole windows is
 * orphan-free), so its own index derives everything {@link rowHeight}
 * consults — including a subtotal parent's derived positions and which rows
 * are diagnostic rows (#811), which render at their own height.
 *
 * @param windowRows - One window's rows, as the source served them
 * @param grain - The DECLARED grain (`value.grain`; user grain is transient)
 * @param dense - The declared density
 * @param axisKind - The axis kind — a row on another arm measures as the
 *   diagnostic row it renders as
 * @returns The at-rest pixel height of the window's body rows
 */
export function windowRestHeight(
    windowRows: ReadonlyArray<PlanRowValue>,
    grain: PlanGrain,
    dense: boolean,
    axisKind?: PlanAxisKind,
): number {
    const index = indexRows(windowRows);
    const rest = initialPlanState(grain, index.initiallyCollapsed);
    const derived = derivePlan(index, undefined, axisKind);
    return visibleRows(index, rest).reduce(
        (sum, v) => sum + rowHeight(v, dense, rest.chartsExpanded, undefined, derived), 0);
}
