/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's decoded-value view model (`Plan Spec.md` §6.2) — pure selectors
 * over the canvas rows: the row-tree index, the visible-row derivation (grain
 * × collapsed subtrees), and per-row height estimation for the virtualizer. No
 * React, no DOM.
 *
 * Rows arrive as BLOCKS (#823) — the series list's blocks in layout order, each
 * an ordered stream (#822) whose order IS the render order, each parent before
 * its descendants — and the canvas draws the blocks one after another. A row
 * carries a typed id and the block it came from; {@link toCanvasRows} keys
 * every row by its id's canonical text, which is what every map, DOM attribute
 * and piece of view state here keys by. The visible walk follows the STREAM and
 * hides by the explicit `parent` keys — never a tree walk, because a parent's
 * descendants need not follow it directly (an entry's children under `views`
 * come after all of its view rows). The derivations still walk the tree, since
 * a bottom-up aggregate is the same in any order.
 *
 * A row's height is a function of facts read off the row once
 * ({@link heightFactsOf}) and of the UI state ({@link factsHeight}); a paged
 * window keeps those facts, and nothing else, after its rows are evicted
 * ({@link windowSkeleton}), so the bands that stand for evicted windows follow
 * a collapse, a chart toggle or the grain exactly (#823).
 *
 * The derivations (`derive.ts`), the body items and link graph
 * (`body-items.ts`), the instant walks (`row-instants.ts`) and the tree walks
 * (`row-tree.ts`) live beside it and are re-exported here (#815).
 *
 * @packageDocumentation
 */

import { none, some, type OptionType, type StringType, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import type { PlanGrain, PlanUiState, RowKey } from "./plan-state.js";
import type { PlanAxisKind } from "./instant.js";
import { ancestorsOf } from "./row-tree.js";
import { rowKeyOf } from "./row-key.js";
import { derivePlan, type PlanDerived } from "./derive.js";
import { PLAN_GEOMETRY, planGeometry } from "./geometry.js";
import { appendAll } from "./reductions.js";

// The model's other halves, one import path for all of it (#815).
export { forEachInstant, axisKindMismatches, type PlanAxisMismatch } from "./row-instants.js";
export {
    tableRollupSeries, deriveBands, deriveHeatCells, deriveTableCells, deriveTableSeries, derivePlan, stableDerived,
    type DerivedBand, type HeatScale, type PlanRowDiagnostic, type PlanDerived,
} from "./derive.js";
export {
    linkedRowKeys, bodyItemKey, rowItemKey, placeFailures, firstDiagnosticItem, elideForFocus, deriveLinkFamily,
    type FocusGap, type PlanBand, type PlanWindowFailure, type PlanBodyItem, type LinkFamily,
} from "./body-items.js";

/** The decoded Plan root value. */
export type PlanRootValue = ValueTypeOf<typeof Plan.Types.Root>;
/** One decoded WIRE row — the IR's `PlanRowType` value, as the source serves it. */
export type PlanWireRow = ValueTypeOf<typeof Plan.Types.Row>;
/** One decoded WIRE block — the IR's `PlanBlockType` value (#823): a data
 *  series' rows, which a paged canvas pages on its own, or fixed rows no entry
 *  produces (a section's header, hand-built rows). */
export type PlanWireBlock = ValueTypeOf<typeof Plan.Types.Block>;
export { rowKeyOf, rowIdOfKey, rowKeyWords, type PlanRowId } from "./row-key.js";
/** One decoded link edge (the R1 graph / K8 ribbon shape). */
export type PlanLinkValue = ValueTypeOf<typeof Plan.Types.Link>;

/**
 * One CANVAS row — a wire row keyed for the canvas (#822).
 *
 * @remarks
 * `key` is the canonical `.east` text of the row's typed `id`
 * ({@link rowKeyOf}): the index every map, DOM attribute and piece of view
 * state keys by, and what a drag names the row with. `parent` is the parent's
 * key. The typed `id` rides along for every payload that names the row — a
 * callback never sees the text.
 */
export type PlanRowValue = Omit<PlanWireRow, "parent"> & {
    /** The row's key — the canonical text of its id; unique on the canvas. */
    readonly key: RowKey;
    /** The key of the row it nests under (`none` at the top of the stream). */
    readonly parent: ValueTypeOf<OptionType<StringType>>;
    /** When this row repeats the id an earlier row in its stream carries: that
     *  row's key. The row keeps a unique key and renders as a diagnostic
     *  (#811) — never a silent drop. */
    readonly duplicateOf: RowKey | undefined;
    /** The block the row came from — its place in the canvas's layout (#823). */
    readonly block: number;
};

/**
 * Key a stream of wire rows for the canvas — each row's `key` its id's
 * canonical text and its `parent` the parent's.
 *
 * @remarks
 * Ids are unique by construction (series keys are unique across the series
 * tree and a path is unique within a collection) except where hand-built rows
 * repeat a key. A repeat keeps a distinct key — its text with `#n` appended,
 * which no printed id can end with — and names the row it repeats in
 * `duplicateOf`, so it renders as a diagnostic in place.
 *
 * @param wire - The rows in stream order
 * @param block - The block they came from (#823)
 * @param seen - The ids keyed so far on the canvas, and how often — shared
 *   across a canvas's blocks so a repeat in a later block is caught too
 * @returns The canvas rows, in the same order
 */
export function toCanvasRows(
    wire: ReadonlyArray<PlanWireRow>,
    block: number = 0,
    seen: Map<RowKey, number> = new Map(),
): PlanRowValue[] {
    return wire.map((row): PlanRowValue => {
        const text = rowKeyOf(row.id);
        const repeats = seen.get(text) ?? 0;
        seen.set(text, repeats + 1);
        return {
            ...row,
            key: repeats === 0 ? text : `${text}#${repeats}`,
            parent: row.parent.type === "some" ? some(rowKeyOf(row.parent.value)) : none,
            duplicateOf: repeats === 0 ? undefined : text,
            block,
        };
    });
}

/** Each decoded inline canvas's rows — keyed once per decoded block list. */
const canvasRowsCache = new WeakMap<ReadonlyArray<PlanWireBlock>, readonly PlanRowValue[]>();

/**
 * The canvas rows of an inline canvas — every block's rows in layout order,
 * keyed across the whole canvas ({@link toCanvasRows}), once per decoded
 * block list.
 *
 * @remarks
 * The controller and the canvas both read a root's inline rows. A decoded
 * value is never mutated, so its array's identity names its rows, and the two
 * share one keying — and one set of row objects.
 *
 * @param blocks - A decoded inline canvas's blocks
 * @returns Its canvas rows
 */
export function canvasRowsOf(blocks: ReadonlyArray<PlanWireBlock>): readonly PlanRowValue[] {
    const cached = canvasRowsCache.get(blocks);
    if (cached !== undefined) return cached;
    const seen = new Map<RowKey, number>();
    const rows: PlanRowValue[] = [];
    blocks.forEach((b, i) => appendAll(rows, toCanvasRows(b.rows, i, seen)));
    canvasRowsCache.set(blocks, rows);
    return rows;
}

/**
 * Key a paged canvas's resident rows across its blocks — each block's windows
 * were keyed on their own when they were read, so a later block repeating an
 * id an earlier block carries (a bound series list naming one series twice)
 * is re-keyed here, exactly as {@link canvasRowsOf} keys the same rows inline.
 *
 * @param rows - The resident rows, block by block
 * @returns The same rows — the same array when nothing repeats
 */
export function keyAcrossBlocks(rows: readonly PlanRowValue[]): readonly PlanRowValue[] {
    const counts = new Map<RowKey, number>();
    let out: PlanRowValue[] | undefined;
    rows.forEach((row, i) => {
        const text = row.duplicateOf ?? row.key;
        const n = counts.get(text) ?? 0;
        counts.set(text, n + 1);
        const key = n === 0 ? text : `${text}#${n}`;
        if (key === row.key) {
            out?.push(row);
            return;
        }
        out ??= rows.slice(0, i);
        out.push({ ...row, key, duplicateOf: n === 0 ? undefined : text });
    });
    return out ?? rows;
}

/**
 * Whether a row's derived numbers — its member count and its strip — can
 * cover rows from more than one paged window (#822).
 *
 * @remarks
 * Only a TOP-LEVEL section header's can: its members are its series' entries,
 * which the source's windows share out. Every other parent derives from one
 * entry's subtree, which the entry carries whole and a window holds whole, or
 * from hand-built rows every window serves complete — so its numbers are
 * exact whether the canvas is inline or paged, loaded or not. A section adds
 * no path segment, so one at the top (or inside another at the top) sits at
 * the empty path; one inside an entry sits at that entry's path, and its
 * members are that entry's.
 *
 * @param row - A canvas row
 * @returns Whether its derived numbers depend on which windows have landed
 */
export function spansWindows(row: PlanRowValue): boolean {
    return row.id.type === "section" && row.id.value.path.length === 0;
}

/** The canvas rows indexed for traversal. */
export interface PlanRowIndex {
    /** Rows in STREAM order — the render order. */
    rows: ReadonlyArray<PlanRowValue>;
    /** Row lookup by key. */
    byKey: ReadonlyMap<RowKey, PlanRowValue>;
    /** Direct children (stream order) by parent key. */
    children: ReadonlyMap<RowKey, PlanRowValue[]>;
    /** Top rows (`parent: none`), stream order. */
    roots: ReadonlyArray<PlanRowValue>;
    /** Nesting depth by key (top rows = 0). */
    depth: ReadonlyMap<RowKey, number>;
    /** The keys of rows the IR declares initially collapsed — any row with
     *  children may be (#822). */
    initiallyCollapsed: ReadonlySet<RowKey>;
}

/**
 * Build the row index once per decoded value.
 *
 * @param rows - The canvas rows in stream order ({@link toCanvasRows})
 * @returns The index every other selector walks
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
        if (row.collapsed) initiallyCollapsed.add(row.key);
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
 * - `resource` grain (default): the stream, in order; a collapsed row keeps
 *   its own line and hides exactly its descendants.
 * - `group` grain: every top-level group strip collapses to its summary
 *   strip; other top rows stay.
 *
 * The walk follows the STREAM and hides a row whose parent is hidden or
 * collapsed — by the explicit `parent` keys, never a tree walk, since a
 * parent's descendants need not follow it directly (#822: an entry's children
 * under `views` follow all of its view rows while nesting under the first).
 * A parent precedes its descendants, so one pass suffices. A row whose parent
 * is nowhere in the stream is not drawn — it derives nothing either
 * (`derivePlan` walks the same tree).
 *
 * Pinned rows are excluded here — they render above the virtualised body,
 * under the ruler (`pinnedRows`) — and so are their descendants.
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
    const isPinned = (row: PlanRowValue) => row.pinned;
    // "Must this subtree stay open for the focus?" answered ONCE: the set of
    // strict ANCESTORS of every revealed key, built by walking `parent`
    // pointers upward — O(reveal × depth) (#616).
    const revealAncestors = ancestorsOf(index, reveal);
    // The rows whose descendants are out of view: collapsed, pinned, or
    // themselves hidden.
    const closed = new Set<RowKey>();
    for (const row of index.rows) {
        if (row.parent.type === "some" && closed.has(row.parent.value)) {
            closed.add(row.key);
            continue;
        }
        if (isPinned(row)) {
            closed.add(row.key);
            continue;
        }
        const depth = index.depth.get(row.key);
        if (depth === undefined) continue;
        const isGroup = row.kind.type === "group";
        const collapsed = (ui.collapsed.has(row.key) || (grain === "group" && isGroup && depth === 0))
            && !revealAncestors.has(row.key);
        out.push({ row, depth, collapsed });
        if (collapsed) closed.add(row.key);
    }
    return out;
}

/** The pinned rows (IR order) — rendered above the virtualised body. */
export function pinnedRows(index: PlanRowIndex): PlanRowValue[] {
    return index.rows.filter((row) => row.pinned);
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
 * What a row's kind contributes to its height — the part of the kind a height
 * reads, and nothing else (#823).
 *
 * - `group` — whether a collapsed band shows a summary strip.
 * - `chart` — its declared fixed px, whether it is declared expanded, and the
 *   px its expanded state opens to.
 * - `table` — how many lines a vertical multi-position stack prints (0 when it
 *   does not stack).
 * - `buckets` — how many lanes its cells hold.
 * - `heat`, `row` — every other kind: one height each.
 */
export type RowKindHeight =
    | { t: "group"; strip: boolean }
    | { t: "chart"; fixed: number | undefined; expanded: boolean; expandedPx: number | undefined }
    | { t: "heat" }
    | { t: "table"; lines: number }
    | { t: "buckets"; lanes: number }
    | { t: "row" };

/**
 * Everything a row's height depends on besides the UI state, read once from
 * the row and its derived numbers (#823). With the UI state it gives the
 * height ({@link factsHeight}), and it is what an evicted paged window keeps of
 * each of its rows ({@link WindowSkeleton}): no content, only these.
 */
export interface RowHeightFacts {
    /** The row's own declared px (`height`), when it is a px size. */
    explicit: number | undefined;
    /** It renders as a diagnostic row (#811) — its message, never its marks. */
    diagnostic: boolean;
    /** A two-line gutter (a sub line, or the stacked flag) — floors the row. */
    twoLine: boolean;
    /** What its kind contributes. */
    kind: RowKindHeight;
}

/**
 * A row's height facts.
 *
 * @param row - The canvas row
 * @param derived - The derived numbers, when available. A subtotal parent
 *   carries NO series of its own — its positions are derived — so without
 *   this a vertical multi-position subtotal would measure as a single line and
 *   render taller than the virtualizer was told.
 * @returns Its facts
 */
export function heightFactsOf(row: PlanRowValue, derived?: PlanDerived): RowHeightFacts {
    const explicit = row.height.type === "some" ? pxOf(row.height.value) : undefined;
    const twoLine = row.gutter.stacked || row.gutter.sub.type === "some";
    const diagnostic = derived?.diagnostics.has(row.key) === true;
    const k = row.kind;
    let kind: RowKindHeight;
    switch (k.type) {
        case "group":
            kind = { t: "group", strip: k.value.summary.type !== "none" };
            break;
        case "chart": {
            const h = k.value.height;
            kind = {
                t: "chart",
                fixed: h.type === "fixed" ? pxOf(h.value) : undefined,
                expanded: h.type === "expanded",
                expandedPx: k.value.expandedHeight.type === "some" ? pxOf(k.value.expandedHeight.value) : undefined,
            };
            break;
        }
        case "heat": kind = { t: "heat" }; break;
        case "table": {
            // A vertical multi-series stack grows the row, one line per series.
            const n = derived?.tableSeries.get(row.key)?.length ?? k.value.series.length;
            kind = { t: "table", lines: k.value.split.type === "vertical" && n > 1 ? n : 0 };
            break;
        }
        case "buckets": kind = { t: "buckets", lanes: k.value.lanes.length }; break;
        default: kind = { t: "row" };
    }
    return { explicit, diagnostic, twoLine, kind };
}

/**
 * A row's pixel height from its facts and the UI state — the ONE height
 * arithmetic: the rendered rows ({@link rowHeight}) and the paged ledger's
 * windows ({@link skeletonHeight}) both come through here, so a band that
 * stands for evicted rows is exactly as tall as those rows draw (#823).
 *
 * @param f - The row's facts
 * @param key - The row's key
 * @param collapsed - Whether its subtree is collapsed
 * @param dense - Whether the canvas is dense
 * @param chartsExpanded - The chart rows the user expanded
 * @param focus - The row focus, when one is active (R1 rails / R2 strips)
 * @returns The height, px
 */
export function factsHeight(
    f: RowHeightFacts,
    key: RowKey,
    collapsed: boolean,
    dense: boolean,
    chartsExpanded: ReadonlySet<RowKey>,
    focus?: PlanFocusCtx,
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
    if (focus !== undefined && f.kind.t !== "group") {
        if (focus.kind === "links") {
            const inFamily = key === focus.key || (focus.family?.has(key) ?? false);
            if (!inFamily) return g.rail;
        } else if (key !== focus.key) {
            return g.strip;
        } else if (focus.renderPx !== undefined && focus.renderPx > 0) {
            // The FOCUSED row grows by its render — the row's own marks keep
            // their band at the top, the render fills the rest, and the gutter
            // spans both. Recursing with the focus dropped gets the row's
            // natural kind height without duplicating the switch below.
            return factsHeight(f, key, collapsed, dense, chartsExpanded, undefined) + focus.renderPx;
        }
    }
    if (f.explicit !== undefined) return f.explicit;
    // Any two-line gutter floors the row at 42px on every data kind — a
    // one-line height would clip the sub text.
    const floor = (h: number) => (f.twoLine ? Math.max(h, g.rowStacked) : h);
    // A diagnostic row (#811) draws its message, never its marks — one line
    // at the shared default; a diagnosed group keeps its band and drops the
    // strip it cannot place.
    if (f.diagnostic) return f.kind.t === "group" ? g.group : floor(g.row);
    switch (f.kind.t) {
        case "group": return collapsed && f.kind.strip ? g.groupStrip : g.group;
        case "chart": {
            if (f.kind.fixed !== undefined) return f.kind.fixed;
            // The two-line floor applies to a chart's DEFAULT heights like
            // every other kind: a spark row is 32px, and a 42px sub-line does
            // not fit in it — it clipped, which is what the floor exists to
            // prevent. A DECLARED px (`fixed`, `expandedHeight`) is the
            // author's word and stays unfloored, the same rule the row-level
            // `height` override above follows.
            if (!f.kind.expanded && !chartsExpanded.has(key)) return floor(g.chartSpark);
            // A declared expandedHeight overrides the 88px expanded default —
            // an expandable spark can open to a full composition height.
            return f.kind.expandedPx ?? floor(g.chartExpanded);
        }
        case "heat": return floor(g.heatRow);
        case "table":
            return f.kind.lines > 1 ? floor(Math.max(g.row, g.tablePad + f.kind.lines * g.tableLine)) : floor(g.row);
        case "buckets": {
            // Laned rows grow — the Planner cell grid: a cell per lane, a gap
            // between, lane padding above and below (§4·K2).
            const n = f.kind.lanes;
            return n > 1 ? floor(2 * g.lanePad + n * g.laneCell + (n - 1) * g.laneGap) : floor(g.row);
        }
        case "row": return floor(g.row);
    }
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
 * @param derived - The derived numbers, when available ({@link heightFactsOf})
 * @returns The height, px
 */
export function rowHeight(
    v: VisibleRow,
    dense: boolean,
    chartsExpanded: ReadonlySet<RowKey>,
    focus?: PlanFocusCtx,
    derived?: PlanDerived,
): number {
    return factsHeight(heightFactsOf(v.row, derived), v.row.key, v.collapsed, dense, chartsExpanded, focus);
}

// ── Window skeletons — the heights of evicted rows (#823) ──────────────────

/**
 * What a paged window keeps of one block's rows once they are evicted (#823):
 * per row, in stream order, its key, where its parent sits, whether it is
 * pinned, its declared collapse and its height facts. No content — enough to
 * say exactly how tall the rows would draw under any UI state, so a band that
 * stands for them follows a collapse, a chart toggle or the grain without the
 * window being read again.
 */
export interface WindowSkeleton {
    /** Each row's key. */
    readonly keys: readonly RowKey[];
    /** Each row's parent's index here — −1 when it nests under a row outside
     *  the window (the section header its block sits under) or none. */
    readonly parents: readonly number[];
    /** Whether the row is at the top of the canvas (no parent at all) — the
     *  group grain folds a group row there. */
    readonly top: readonly boolean[];
    /** Whether the row is pinned — pinned rows draw above the body. */
    readonly pinned: readonly boolean[];
    /** Whether the row declares itself collapsed. */
    readonly declared: readonly boolean[];
    /** Each row's height facts. */
    readonly facts: readonly RowHeightFacts[];
}

/**
 * One window's skeleton — computed ONCE, when the window lands.
 *
 * @remarks
 * A window holds its entries whole (#823), so its own rows derive everything
 * a height reads — a subtotal parent's derived positions, which rows are
 * diagnostic rows. A block's top rows may nest under a row no window holds
 * (a section's header, a fixed block): for the derivation they are the
 * window's roots, and they stay open whatever that header does — when the
 * header folds, the canvas hides the whole block, bands and all.
 *
 * @param rows - One block's rows from one window, in stream order
 * @param axisKind - The axis kind — a row on another arm measures as the
 *   diagnostic row it renders as
 * @returns The skeleton
 */
export function windowSkeleton(rows: readonly PlanRowValue[], axisKind?: PlanAxisKind): WindowSkeleton {
    const at = new Map<RowKey, number>();
    rows.forEach((r, i) => at.set(r.key, i));
    // Rows whose parent is outside the window root the derivation.
    const rooted = rows.map((r) => (r.parent.type === "some" && !at.has(r.parent.value) ? { ...r, parent: none } : r));
    const derived = derivePlan(indexRows(rooted), undefined, axisKind);
    return {
        keys: rows.map((r) => r.key),
        parents: rows.map((r) => (r.parent.type === "some" ? at.get(r.parent.value) ?? -1 : -1)),
        top: rows.map((r) => r.parent.type === "none"),
        pinned: rows.map((r) => r.pinned),
        declared: rows.map((r) => r.collapsed),
        facts: rows.map((r) => heightFactsOf(r, derived)),
    };
}

/** The UI state a skeleton's height reads. */
export interface SkeletonUi {
    /** The active grain. */
    grain: PlanGrain;
    /** Whether a row's subtree is collapsed — given its key and whether it
     *  declares itself collapsed (a paged row may not have been seeded yet). */
    collapsed: (key: RowKey, declared: boolean) => boolean;
    /** The chart rows the user expanded. */
    chartsExpanded: ReadonlySet<RowKey>;
}

/** No chart expanded. */
const NO_CHARTS: ReadonlySet<RowKey> = new Set();

/**
 * The UI state a window rests at — its declared collapse, no chart expanded,
 * no focus — under a grain.
 *
 * @param grain - The DECLARED grain
 * @returns The state
 */
export function restUi(grain: PlanGrain): SkeletonUi {
    return { grain, collapsed: (_key, declared) => declared, chartsExpanded: NO_CHARTS };
}

/**
 * How tall a window's rows draw under a UI state — the visible-row walk
 * ({@link visibleRows}) and the height arithmetic ({@link factsHeight}) over
 * the skeleton, so the number is the one the body would draw the same rows at.
 *
 * @param sk - The window's skeleton
 * @param ui - The UI state
 * @param dense - Whether the canvas is dense
 * @param focus - An expand focus, when one is active — its context strips
 *   (a links focus elides runs of rows across windows, which no window's
 *   height can say; its windows measure as though unfocused)
 * @returns The height, px
 */
export function skeletonHeight(sk: WindowSkeleton, ui: SkeletonUi, dense: boolean, focus?: PlanFocusCtx): number {
    const closed = new Array<boolean>(sk.keys.length).fill(false);
    let sum = 0;
    for (let i = 0; i < sk.keys.length; i++) {
        const p = sk.parents[i]!;
        if ((p >= 0 && closed[p]) || sk.pinned[i]) {
            closed[i] = true;
            continue;
        }
        const key = sk.keys[i]!;
        const f = sk.facts[i]!;
        const collapsed = ui.collapsed(key, sk.declared[i]!) || (ui.grain === "group" && f.kind.t === "group" && sk.top[i]!);
        sum += factsHeight(f, key, collapsed, dense, ui.chartsExpanded, focus?.kind === "expand" ? focus : undefined);
        if (collapsed) closed[i] = true;
    }
    return sum;
}

/**
 * The pixel height a window's rows render AT REST (#613) — declared collapse
 * applied, chart expansion at its declared state, no focus context, pinned
 * rows excluded (they render in the header, not the body). What the window
 * ledger seeds its slot rate from: a rate taken from whatever the UI state
 * happened to be when the first window landed (mid-focus, say) would describe
 * every unvisited window wrongly for the life of the source.
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
    return skeletonHeight(windowSkeleton(windowRows, axisKind), restUi(grain), dense);
}
