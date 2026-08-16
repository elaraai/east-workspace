/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's decoded-value view model (`Plan Spec.md` §6.2) — pure selectors
 * over the flat `parent`-keyed rows: the row-tree index, the visible-row
 * derivation (grain × collapsed subtrees × drill), and per-row height
 * estimation for the virtualizer. No React, no DOM.
 *
 * Rows arrive in the collection's canonical KEY order (the IR's row collection
 * is a `Dict`, decoded as a `SortedMap` — #568), and every traversal here
 * walks the TREE the `parent` keys encode rather than that flat order, so a
 * subtree need not be contiguous and no derivation depends on the container.
 *
 * @packageDocumentation
 */

import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import type { PlanGrain, PlanUiState, RowKey } from "./plan-state.js";

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
    /** Whether this row is the drilled row (96px in-place expansion). */
    drilled: boolean;
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
 * - `item` grain: identical walk in P2 (journeys arrive in P4).
 *
 * Pinned rows are excluded here — they render above the virtualised body,
 * under the ruler (`pinnedRows`).
 */
export function visibleRows(
    index: PlanRowIndex,
    ui: PlanUiState,
    /** Keys a links focus must reveal — a collapsed subtree CONTAINING one
     *  auto-expands for the focus and restores on return (R1). */
    reveal?: ReadonlySet<RowKey>,
): VisibleRow[] {
    const out: VisibleRow[] = [];
    const grain: PlanGrain = ui.grain;
    const isPinned = (row: PlanRowValue) => row.pinned.type === "some" && row.pinned.value;
    const mustReveal = (key: RowKey): boolean => {
        if (reveal === undefined) return false;
        const kids = index.children.get(key) ?? [];
        return kids.some((c) => reveal.has(c.key) || mustReveal(c.key));
    };
    const walk = (row: PlanRowValue, depth: number) => {
        if (isPinned(row)) return;
        const kids = index.children.get(row.key) ?? [];
        const isGroup = row.kind.type === "group";
        const collapsed = (ui.collapsed.has(row.key) || (grain === "group" && isGroup && depth === 0))
            && !mustReveal(row.key);
        out.push({ row, depth, drilled: ui.drilled === row.key, collapsed });
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

/** Default span/bucket/cards/table row height. */
export const ROW_H = 32;
/** Dense row height (`density: compact`). */
export const ROW_H_DENSE = 24;
/** Drilled in-place expansion height. */
export const ROW_H_DRILLED = 96;
/** Group band height. */
export const GROUP_H = 26;
/** Group summary heat-strip height (collapsed group with cells). */
export const GROUP_STRIP_H = 28;
/** Chart spark / expanded heights. */
export const CHART_SPARK_H = 32;
export const CHART_EXPANDED_H = 88;
/** Heat ROW height — 22px cells (§8) + the 3px top/bottom recipe insets. */
export const HEAT_ROW_H = 28;
/** Table row height. */
export const TABLE_H = 24;

/**
 * A visible row's pixel height — the virtualizer estimate AND the rendered
 * height (rows are fixed-height by kind; `measureElement` still corrects any
 * drift).
 */
/** Two-line-gutter row minimum (the §8 sheet: row min-height 42px). */
export const ROW_H_STACKED = 42;
/** Links-focus rail height — a LONE unrelated row collapses, never removed (R1). */
export const RAIL_H = 11;
/** Links-focus gap-band height — a RUN of unrelated rows elides to one
 *  double-height band wearing the ⋯ icon (R1 at scale). */
export const GAP_H = 22;

/** The row-focus height context (R1 rails / R2 strips) threaded to {@link rowHeight}. */
export interface PlanFocusCtx {
    kind: "links" | "expand";
    /** The focused row. */
    key: RowKey;
    /** Full-height family keys (links focus; the focused row is implied). */
    family?: ReadonlySet<RowKey> | undefined;
}

/** Parse a CSS px size (`"120px"` / `"120"`) to a number; `undefined` for
 *  anything a virtualized row can't be (`"fill"`, percentages). */
function pxOf(size: string): number | undefined {
    const n = parseFloat(size);
    return Number.isFinite(n) ? n : undefined;
}

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
    // A links focus rails unrelated DATA rows; family rows fall through to
    // their normal kind heights and group bands stay wayfinding. An expand
    // focus never reaches here — its body renders only the focused row, at
    // its normal height, outside the virtualizer.
    if (focus !== undefined && focus.kind === "links" && v.row.kind.type !== "group") {
        const inFamily = v.row.key === focus.key || (focus.family?.has(v.row.key) ?? false);
        if (!inFamily) return RAIL_H;
    }
    // The 96px in-place expansion only applies to rows CARRYING a drill
    // payload — a payload-less row keeps its kind height while drilled
    // (the tint + host `onDrill` still fire).
    if (v.drilled && v.row.drill.type === "some") return ROW_H_DRILLED;
    const explicit = v.row.height.type === "some" ? pxOf(v.row.height.value) : undefined;
    if (explicit !== undefined) return explicit;
    const kind = v.row.kind;
    // Any two-line gutter (a sub line, or the stacked flag) floors the row at
    // 42px on every data kind — a one-line height would clip the sub text.
    const twoLine = (v.row.gutter.stacked.type === "some" && v.row.gutter.stacked.value)
        || v.row.gutter.sub.type === "some";
    const floor = (h: number) => (twoLine ? Math.max(h, ROW_H_STACKED) : h);
    switch (kind.type) {
        case "group": {
            const hasStrip = v.collapsed
                && (kind.value.summary.type === "some" || kind.value.summaryAggregate.type === "some");
            return hasStrip ? GROUP_STRIP_H : GROUP_H;
        }
        case "chart": {
            const h = kind.value.height;
            if (h.type === "fixed") {
                const px = pxOf(h.value);
                if (px !== undefined) return px;
            }
            const expanded = h.type === "expanded" || chartsExpanded.has(v.row.key);
            if (!expanded) return CHART_SPARK_H;
            // A declared expandedHeight overrides the 88px expanded default —
            // an expandable spark can open to a full composition height.
            const eh = kind.value.expandedHeight.type === "some" ? pxOf(kind.value.expandedHeight.value) : undefined;
            return eh ?? CHART_EXPANDED_H;
        }
        case "heat": return floor(HEAT_ROW_H);
        case "table": {
            // A vertical multi-series stack grows the row (~11px per line).
            const n = derived?.tableSeries.get(v.row.key)?.length ?? kind.value.series.length;
            if (kind.value.split.type === "vertical" && n > 1) return floor(Math.max(TABLE_H, 6 + n * 11));
            return floor(TABLE_H);
        }
        case "buckets": {
            // Laned rows grow — the Planner cell grid: 22px min cells,
            // 2px gaps, 3px lane padding (§4·K2).
            const n = kind.value.lanes.length;
            if (n > 1) return floor(6 + n * 22 + (n - 1) * 2);
            return floor(dense ? ROW_H_DENSE : ROW_H);
        }
        default: return floor(dense ? ROW_H_DENSE : ROW_H);
    }
}

// ── Renderer-side derivations (§4.2 — the Table idiom) ─────────────────────
//
// The IR carries DECLARATIONS (`rollup` + `unit`, `aggregate` + scale,
// `summaryAggregate`, `format`); the numbers — rollup bands, per-bucket
// aggregates, subtotal cells, strip summaries — are derived here over the
// decoded values, exactly as Table's renderer computes its group subtotals.

type RunValue = ValueTypeOf<typeof Plan.Types.Run>;
type HeatCellValue = ValueTypeOf<typeof Plan.Types.HeatCell>;
type TableCellValue = ValueTypeOf<typeof Plan.Types.TableCell>;
type TableSeriesValue = ValueTypeOf<typeof Plan.Types.TableSeries>;

/**
 * A table row's AGGREGABLE positions — the ones a parent subtotals.
 *
 * `rollup: some(true)` NARROWS: flag a position and only the flagged ones roll
 * up, which is how a row says "the actual is the number, the Δ beside it is
 * commentary". Flag nothing and EVERY position rolls up, so a subtotal mirrors
 * the shape of the rows it totals — a parent over `act`/`Δ` children shows an
 * act subtotal beside a Δ subtotal rather than silently dropping one.
 *
 * (It used to return one position's cells unconditionally — the unflagged case
 * fell back to `series[0]`, so a multi-value row's second position vanished
 * into a parent that looked complete.)
 */
export function tableRollupSeries(series: readonly TableSeriesValue[]): readonly TableSeriesValue[] {
    const flagged = series.filter((x) => x.rollup.type === "some" && x.rollup.value);
    return flagged.length > 0 ? flagged : series;
}

/** One derived rollup band (`×k · qty`, pessimistic state). */
export interface DerivedBand {
    from: Date;
    to: Date;
    /** Peak concurrency inside the band. */
    count: number;
    /** Summed quantity caption (`"146 t"`) — absent unless a unit is declared and every member carries `qty`. */
    quantity: string | undefined;
    /** The least-certain member's lifecycle state. */
    state: RunValue["state"];
}

/** Certainty rank — lower is less certain; bands wear the minimum. */
const STATE_RANK: Record<string, number> = {
    estimated: 0, proposed: 1, confirmed: 2, "in-progress": 3, actual: 3, rejected: 4,
};

/** Union-merge one run set into bands (rejected runs excluded). */
function mergeBands(runs: readonly RunValue[], unit: string | undefined): DerivedBand[] {
    const active = runs
        .filter((r) => r.state.type !== "rejected")
        .slice()
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    if (active.length === 0) return [];
    const groups: { members: RunValue[]; from: Date; to: Date }[] = [];
    for (const r of active) {
        const last = groups[groups.length - 1];
        if (last !== undefined && r.start.getTime() < last.to.getTime()) {
            last.members.push(r);
            if (r.end.getTime() > last.to.getTime()) last.to = r.end;
        } else {
            groups.push({ members: [r], from: r.start, to: r.end });
        }
    }
    return groups.map((g) => {
        let count = 1;
        for (const m of g.members) {
            const c = g.members.filter((x) =>
                x.start.getTime() <= m.start.getTime() && x.end.getTime() > m.start.getTime()).length;
            if (c > count) count = c;
        }
        const missing = g.members.some((m) => m.qty.type === "none");
        const total = g.members.reduce((acc, m) => acc + (m.qty.type === "some" ? m.qty.value : 0), 0);
        const quantity = unit !== undefined && !missing ? `${total.toFixed(0)} ${unit}` : undefined;
        let state = g.members[0]!.state;
        for (const m of g.members) {
            if ((STATE_RANK[m.state.type] ?? 3) < (STATE_RANK[state.type] ?? 3)) state = m.state;
        }
        return { from: g.from, to: g.to, count, quantity, state };
    });
}

/** Derive a rollup parent's bands from its subtree's runs. */
export function deriveBands(
    runs: readonly RunValue[],
    rollup: "union" | "byStatus" | "sum",
    unit: string | undefined,
): DerivedBand[] {
    if (rollup === "byStatus") {
        const order: string[] = [];
        const byTag = new Map<string, RunValue[]>();
        for (const r of runs) {
            if (r.state.type === "rejected") continue;
            const tag = r.state.type;
            const list = byTag.get(tag);
            if (list !== undefined) list.push(r);
            else { byTag.set(tag, [r]); order.push(tag); }
        }
        return order.flatMap((tag) => mergeBands(byTag.get(tag)!, unit));
    }
    return mergeBands(runs, unit);
}

/** Derive per-bucket aggregated heat cells (mean / max / sum; no-data skipped). */
export function deriveHeatCells(
    cells: readonly HeatCellValue[],
    mode: "mean" | "max" | "sum",
): HeatCellValue[] {
    const order: number[] = [];
    const groups = new Map<number, number[]>();
    for (const c of cells) {
        const t = c.at.getTime();
        if (!groups.has(t)) { groups.set(t, []); order.push(t); }
        if (c.value.type === "some") groups.get(t)!.push(c.value.value);
    }
    return order.sort((a, b) => a - b).map((t) => {
        const vals = groups.get(t)!;
        let v: number | undefined;
        if (vals.length > 0) {
            const total = vals.reduce((a, b) => a + b, 0);
            v = mode === "sum" ? total : mode === "max" ? Math.max(...vals) : total / vals.length;
        }
        return {
            at: new Date(t),
            value: v !== undefined ? { type: "some", value: v } : { type: "none", value: null },
            label: v !== undefined ? { type: "some", value: v.toFixed(0) } : { type: "none", value: null },
        } as HeatCellValue;
    });
}

/** Derive per-bucket table subtotal cells (the Table #317 vocabulary) — raw
 *  values only; text and tone are renderer-derived through the row's shared
 *  `TickFormatType` format. */
export function deriveTableCells(
    cells: readonly TableCellValue[],
    mode: "sum" | "mean" | "min" | "max" | "count",
): TableCellValue[] {
    const order: number[] = [];
    const groups = new Map<number, number[]>();
    for (const c of cells) {
        const t = c.at.getTime();
        if (!groups.has(t)) { groups.set(t, []); order.push(t); }
        if (c.value.type === "some") groups.get(t)!.push(c.value.value);
    }
    return order.sort((a, b) => a - b).map((t) => {
        const vals = groups.get(t)!;
        let v: number | undefined;
        if (mode === "count") v = vals.length;
        else if (vals.length > 0) {
            const total = vals.reduce((a, b) => a + b, 0);
            v = mode === "sum" ? total
                : mode === "mean" ? total / vals.length
                : mode === "min" ? Math.min(...vals)
                : Math.max(...vals);
        }
        return {
            at: new Date(t),
            value: v !== undefined ? { type: "some", value: v } : { type: "none", value: null },
            text: { type: "none", value: null },
            tone: { type: "none", value: null },
        } as TableCellValue;
    });
}

/**
 * Derive a parent's subtotal SERIES — position by position.
 *
 * Position `i` of the parent aggregates position `i` of every child that has
 * one, and inherits that position's declarations (format / tone / strong /
 * rollup) from the first child carrying it, so the subtotal is styled like the
 * numbers it totals rather than as anonymous plain text.
 *
 * @param positions - Each child's aggregable positions (see {@link tableRollupSeries})
 * @param mode - The declared aggregate
 * @returns One derived series per position
 */
export function deriveTableSeries(
    positions: ReadonlyArray<readonly TableSeriesValue[]>,
    mode: "sum" | "mean" | "min" | "max" | "count",
): TableSeriesValue[] {
    const width = positions.reduce((m, p) => Math.max(m, p.length), 0);
    const out: TableSeriesValue[] = [];
    for (let i = 0; i < width; i++) {
        const at = positions.map((p) => p[i]).filter((s): s is TableSeriesValue => s !== undefined);
        if (at.length === 0) continue;
        const style = at[0]!;
        out.push({
            cells: deriveTableCells(at.flatMap((s) => s.cells), mode),
            format: style.format, tone: style.tone, strong: style.strong, rollup: style.rollup,
        } as TableSeriesValue);
    }
    return out;
}

/** The heat-arm cells of a row (empty for other kinds / arms). */
function heatCellsOf(row: PlanRowValue): readonly HeatCellValue[] {
    if (row.kind.type !== "heat") return [];
    const cells = row.kind.value.cells;
    return cells.type === "heat" ? cells.value.cells : [];
}

/** Every span run across a subtree (any depth). */
function subtreeRuns(index: PlanRowIndex, key: RowKey): RunValue[] {
    const out: RunValue[] = [];
    const walk = (k: RowKey) => {
        for (const child of index.children.get(k) ?? []) {
            if (child.kind.type === "span") out.push(...child.kind.value.runs);
            walk(child.key);
        }
    };
    walk(key);
    return out;
}

/** The per-value derived numbers, computed once per decoded root. */
export interface PlanDerived {
    /** Rollup bands by span-parent row key. */
    bands: ReadonlyMap<RowKey, DerivedBand[]>;
    /** Aggregated cells by heat-parent row key. */
    heatCells: ReadonlyMap<RowKey, HeatCellValue[]>;
    /** Subtotal SERIES by table-parent row key — one derived position per
     *  aggregable position of the children, so a parent renders the same
     *  shape its members do. */
    tableSeries: ReadonlyMap<RowKey, TableSeriesValue[]>;
    /** Strip summary cells by group row key. */
    groupSummary: ReadonlyMap<RowKey, HeatCellValue[]>;
    /** Direct-member count by group row key — the `"8 rs"` gutter meta.
     *  Derived here, not baked into the IR: a group parent synthesized per
     *  paged window would otherwise carry THAT window's count (#568). */
    groupMembers: ReadonlyMap<RowKey, number>;
}

/**
 * Derive every declared rollup / aggregate / summary over the decoded rows.
 *
 * @remarks
 * The walk is an explicit POST-ORDER traversal from the roots: a declared
 * parent whose children are themselves declared parents aggregates their
 * DERIVED cells, so nesting composes to arbitrary depth — and it is correct
 * for ANY container order. (It used to walk the flat array in reverse, which
 * was only right while that array happened to be depth-first; under a keyed
 * collection a parent can sort before its children, and feeding a bottom-up
 * aggregation the wrong order yields wrong numbers, not an error — #568.)
 *
 * Rows outside the tree — a `parent` naming a key that does not exist — are
 * unreachable from the roots and derive nothing, exactly as they render
 * nothing (`visibleRows` walks the same tree).
 *
 * @param index - The row-tree index
 * @returns Every derived number, keyed by row
 */
export function derivePlan(index: PlanRowIndex): PlanDerived {
    const bands = new Map<RowKey, DerivedBand[]>();
    const heatCells = new Map<RowKey, HeatCellValue[]>();
    const tableSeries = new Map<RowKey, TableSeriesValue[]>();
    const groupSummary = new Map<RowKey, HeatCellValue[]>();
    const groupMembers = new Map<RowKey, number>();
    // A row's effective cells — its own, or (for declared parents) its
    // already-derived cells from the bottom-up walk.
    const resolvedHeatCells = (row: PlanRowValue): readonly HeatCellValue[] => {
        const own = heatCellsOf(row);
        if (own.length > 0) return own;
        return heatCells.get(row.key) ?? [];
    };
    const resolvedTableSeries = (row: PlanRowValue): readonly TableSeriesValue[] => {
        if (row.kind.type !== "table") return [];
        const own = tableRollupSeries(row.kind.value.series);
        if (own.length > 0) return own;
        return tableSeries.get(row.key) ?? [];
    };
    const visit = (row: PlanRowValue): void => {
        const children = index.children.get(row.key) ?? [];
        // Descendants first — a declared parent reads its children's DERIVED
        // cells, which must already be in the maps.
        for (const child of children) visit(child);
        const kind = row.kind;
        if (kind.type === "span" && kind.value.rollup.type === "some") {
            const unit = kind.value.unit.type === "some" ? kind.value.unit.value : undefined;
            const runs = [...kind.value.runs, ...subtreeRuns(index, row.key)];
            bands.set(row.key, deriveBands(runs, kind.value.rollup.value.type, unit));
        }
        if (kind.type === "heat" && kind.value.aggregate.type === "some"
            && heatCellsOf(row).length === 0 && children.length > 0) {
            heatCells.set(row.key, deriveHeatCells(
                children.flatMap(resolvedHeatCells), kind.value.aggregate.value.type));
        }
        if (kind.type === "table" && kind.value.aggregate.type === "some"
            && tableRollupSeries(kind.value.series).length === 0 && children.length > 0) {
            const positions = children.map(resolvedTableSeries).filter((p) => p.length > 0);
            if (positions.length > 0) {
                tableSeries.set(row.key, deriveTableSeries(positions, kind.value.aggregate.value.type));
            }
        }
        if (kind.type === "group") {
            groupMembers.set(row.key, children.length);
            if (kind.value.summaryAggregate.type === "some") {
                groupSummary.set(row.key, deriveHeatCells(
                    children.flatMap(resolvedHeatCells), kind.value.summaryAggregate.value.type));
            }
        }
    };
    for (const root of index.roots) visit(root);
    return { bands, heatCells, tableSeries, groupSummary, groupMembers };
}

// ── The R1 link graph (renderer-derived over the decoded `links` edges) ─────

/** Every row key any link edge touches — the rows that grow the `links` control. */
export function linkedRowKeys(links: readonly PlanLinkValue[]): ReadonlySet<RowKey> {
    const out = new Set<RowKey>();
    for (const l of links) { out.add(l.fromRow); out.add(l.toRow); }
    return out;
}

/** One elided run in a links focus — replaces N consecutive unrelated rows. */
export interface FocusGap {
    /** Stable key (the first elided row's key). */
    key: string;
    /** Data rows hidden inside the run (collapsed subtrees counted through). */
    rows: number;
    /** Group bands hidden inside the run. */
    groups: number;
    /** Pessimistic status tone across the hidden rows (undefined ⇒ quiet). */
    tone: string | undefined;
}

/**
 * A run of source elements that is NOT resident (#577), rendered as one band.
 *
 * Its height comes from the window ledger, so the band and the rows that
 * replace it occupy exactly the same space — scrolling in loads content without
 * moving anything below it, and eviction puts the band back with nothing
 * shifting either.
 */
export interface PlanBand {
    at: "head" | "tail";
    /** First source element the band covers. */
    from: number;
    /** Last source element the band covers (inclusive). */
    to: number;
    /** The band's pixel height. */
    px: number;
}

/** One line of the canvas body: a row, an elided run (R1), or an unloaded
 *  run of the source (#577). */
export type PlanBodyItem =
    | { kind: "row"; row: VisibleRow }
    | { kind: "gap"; gap: FocusGap }
    | { kind: "band"; band: PlanBand };

/** Status severity rank — higher is worse; gaps wear the worst hidden tone. */
const TONE_RANK: Record<string, number> = { info: 1, neutral: 1, success: 0, warning: 2, danger: 3 };

/**
 * Elide a links-focus row list for scale (R1): family rows and the focus keep
 * full height; a group keeps its wayfinding band ONLY while its subtree holds
 * family; every other row is elidable. A lone elidable data row stays an 11px
 * rail (today's rhythm); any longer run — including family-less group bands
 * and their subtrees — coalesces into ONE double-height gap band, so a
 * thousand-tank canvas gathers to family + a handful of bands.
 */
export function elideForFocus(
    vis: ReadonlyArray<VisibleRow>,
    index: PlanRowIndex,
    focus: PlanFocusCtx,
): PlanBodyItem[] {
    const kept = (key: RowKey): boolean => key === focus.key || (focus.family?.has(key) ?? false);
    const subtreeHasFamily = (key: RowKey): boolean =>
        (index.children.get(key) ?? []).some((c) => kept(c.key) || subtreeHasFamily(c.key));
    const subtreeDataRows = (key: RowKey): number =>
        (index.children.get(key) ?? []).reduce(
            (n, c) => n + (c.kind.type === "group" ? 0 : 1) + subtreeDataRows(c.key), 0);
    const worse = (a: string | undefined, b: string | undefined): string | undefined =>
        b === undefined ? a : a === undefined || (TONE_RANK[b] ?? 0) > (TONE_RANK[a] ?? 0) ? b : a;

    const out: PlanBodyItem[] = [];
    let run: VisibleRow[] = [];
    const flush = () => {
        if (run.length === 0) return;
        if (run.length === 1 && run[0]!.row.kind.type !== "group") {
            out.push({ kind: "row", row: run[0]! });
        } else {
            const gap: FocusGap = { key: `gap-${run[0]!.row.key}`, rows: 0, groups: 0, tone: undefined };
            for (const v of run) {
                if (v.row.kind.type === "group") {
                    gap.groups += 1;
                    // A collapsed elided group hides its whole subtree —
                    // count those rows through, they're part of the gap.
                    if (v.collapsed) gap.rows += subtreeDataRows(v.row.key);
                } else {
                    gap.rows += 1;
                }
                gap.tone = worse(gap.tone, v.row.status.type === "some" ? v.row.status.value.type : undefined);
            }
            out.push({ kind: "gap", gap });
        }
        run = [];
    };
    for (const v of vis) {
        const isGroup = v.row.kind.type === "group";
        const keep = kept(v.row.key) || (isGroup && subtreeHasFamily(v.row.key));
        if (keep) {
            flush();
            out.push({ kind: "row", row: v });
        } else {
            run.push(v);
        }
    }
    flush();
    return out;
}

/** A focused row's transitive family over the link graph. */
export interface LinkFamily {
    /** Rows reaching the focus via edges (any depth). */
    upstream: ReadonlySet<RowKey>;
    /** Rows reachable from the focus via edges (any depth). */
    downstream: ReadonlySet<RowKey>;
    /** Union of both (the full-height set, focus excluded). */
    all: ReadonlySet<RowKey>;
}

/**
 * Derive the focused row's transitive upstream + downstream family — the
 * links-focus gather set (R1). Any depth, wherever the rows live; a row
 * reachable both ways lands in both sets (rendered as the `LINKED` tag).
 */
export function deriveLinkFamily(links: readonly PlanLinkValue[], key: RowKey): LinkFamily {
    const fwd = new Map<RowKey, RowKey[]>();
    const rev = new Map<RowKey, RowKey[]>();
    for (const l of links) {
        (fwd.get(l.fromRow) ?? fwd.set(l.fromRow, []).get(l.fromRow)!).push(l.toRow);
        (rev.get(l.toRow) ?? rev.set(l.toRow, []).get(l.toRow)!).push(l.fromRow);
    }
    const walk = (edges: ReadonlyMap<RowKey, RowKey[]>): Set<RowKey> => {
        const seen = new Set<RowKey>();
        const queue = [key];
        while (queue.length > 0) {
            const k = queue.pop()!;
            for (const next of edges.get(k) ?? []) {
                if (next === key || seen.has(next)) continue;
                seen.add(next);
                queue.push(next);
            }
        }
        return seen;
    };
    const downstream = walk(fwd);
    const upstream = walk(rev);
    return { upstream, downstream, all: new Set([...upstream, ...downstream]) };
}
