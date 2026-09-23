/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's renderer-side derivations (§4.2 — the Table idiom): the IR
 * DECLARES rollups, aggregates, subtotals and summaries, and the numbers are
 * computed here over the decoded rows (split out of `model.ts`, #815).
 *
 * @packageDocumentation
 */

import { ArrayType, equalFor, none, some, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { instantKey, instantOrder, type PlanAxisKind, type PlanInstantValue } from "./instant.js";
import { appendAll, maxOf, minOf, peakConcurrency } from "./reductions.js";
import { formatDerived } from "./format.js";
import type { PlanRowIndex, PlanRowValue } from "./model.js";
import type { RowKey } from "./plan-state.js";
import { axisKindMismatches } from "./row-instants.js";

// ── Renderer-side derivations (§4.2 — the Table idiom) ─────────────────────
//
// The IR carries DECLARATIONS (`rollup` + `unit`, `aggregate` + scale,
// `summaryAggregate`, `format`); the numbers — rollup bands, per-bucket
// aggregates, subtotal cells, strip summaries — are derived here over the
// decoded values, exactly as Table's renderer computes its group subtotals.
//
// Instants are ordered on their own arm (`instantOrder`): epoch ms, the
// value, or — for an ordinal axis — the declared index, which the caller
// passes in as `ordinal`. Without it ordinal cells keep their insertion
// order, which is what the ledger's height measure needs and all it needs.

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
    from: PlanInstantValue;
    /** The band's end — on an ordinal axis the LAST bucket covered (inclusive). */
    to: PlanInstantValue;
    /** Peak concurrency inside the band. */
    count: number;
    /** Summed quantity caption (`"1,234.5 t"`, through {@link formatDerived}) — absent unless a unit is declared and every member carries `qty`. */
    quantity: string | undefined;
    /** The least-certain member's lifecycle state. */
    state: RunValue["state"];
}

/** Certainty rank — lower is less certain; bands wear the minimum. */
const STATE_RANK: Record<string, number> = {
    estimated: 0, proposed: 1, confirmed: 2, "in-progress": 3, actual: 3, rejected: 4,
};

/** An interval END on its arm — an ordinal end names its last bucket, so it
 *  closes one bucket LATER than its own index (the scale's `endFracOf` rule). */
function endOrder(t: PlanInstantValue, ordinal: ReadonlyMap<string, number> | undefined): number {
    const n = instantOrder(t, ordinal);
    return t.type === "ordinal" ? n + 1 : n;
}

/** Union-merge one run set into bands (rejected runs excluded). */
function mergeBands(
    runs: readonly RunValue[],
    unit: string | undefined,
    ordinal: ReadonlyMap<string, number> | undefined,
): DerivedBand[] {
    const startOf = (r: RunValue) => instantOrder(r.start, ordinal);
    const endOf = (r: RunValue) => endOrder(r.end, ordinal);
    const active = runs
        .filter((r) => r.state.type !== "rejected" && Number.isFinite(startOf(r)) && Number.isFinite(endOf(r)))
        .slice()
        .sort((a, b) => startOf(a) - startOf(b));
    if (active.length === 0) return [];
    const groups: { members: RunValue[]; from: PlanInstantValue; to: PlanInstantValue; toN: number }[] = [];
    for (const r of active) {
        const last = groups[groups.length - 1];
        if (last !== undefined && startOf(r) < last.toN) {
            last.members.push(r);
            if (endOf(r) > last.toN) { last.to = r.end; last.toN = endOf(r); }
        } else {
            groups.push({ members: [r], from: r.start, to: r.end, toN: endOf(r) });
        }
    }
    return groups.map((g) => {
        // A sweep line, not a per-member filter over every member (O(k²) —
        // #810). Never below 1: a band holds at least its own member, even
        // one whose interval covers no instant.
        const count = Math.max(1, peakConcurrency(g.members.map((m) => ({ start: startOf(m), end: endOf(m) }))));
        const missing = g.members.some((m) => m.qty.type === "none");
        const total = g.members.reduce((acc, m) => acc + (m.qty.type === "some" ? m.qty.value : 0), 0);
        const quantity = unit !== undefined && !missing ? `${formatDerived(total)} ${unit}` : undefined;
        let state = g.members[0]!.state;
        for (const m of g.members) {
            if ((STATE_RANK[m.state.type] ?? 3) < (STATE_RANK[state.type] ?? 3)) state = m.state;
        }
        return { from: g.from, to: g.to, count, quantity, state };
    });
}

/**
 * Derive a rollup parent's bands from its subtree's runs.
 *
 * @param runs - The subtree's runs
 * @param rollup - The declared mode
 * @param unit - The declared quantity unit
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @returns The bands, in start order
 */
export function deriveBands(
    runs: readonly RunValue[],
    rollup: "union" | "byStatus" | "sum",
    unit: string | undefined,
    ordinal?: ReadonlyMap<string, number>,
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
        return order.flatMap((tag) => mergeBands(byTag.get(tag)!, unit, ordinal));
    }
    return mergeBands(runs, unit, ordinal);
}

/**
 * Group cells by the INSTANT they name, in axis order — instants with a
 * comparable order sort; an ordinal set without its index map (the ledger's
 * height measure) keeps insertion order, which is all a height needs.
 */
function groupByInstant<C extends { at: PlanInstantValue }>(
    cells: readonly C[],
    ordinal: ReadonlyMap<string, number> | undefined,
): { at: PlanInstantValue; members: C[] }[] {
    const groups = new Map<string, { at: PlanInstantValue; members: C[] }>();
    for (const c of cells) {
        const k = instantKey(c.at);
        const g = groups.get(k);
        if (g !== undefined) g.members.push(c);
        else groups.set(k, { at: c.at, members: [c] });
    }
    const out = [...groups.values()];
    const orders = out.map((g) => instantOrder(g.at, ordinal));
    if (orders.every((n) => Number.isFinite(n))) {
        const rank = new Map(out.map((g, i) => [g, orders[i]!]));
        out.sort((a, b) => rank.get(a)! - rank.get(b)!);
    }
    return out;
}

/**
 * Derive per-bucket aggregated heat cells (mean / max / sum; no-data skipped),
 * each labelled through {@link formatDerived}.
 *
 * @param cells - The children's cells
 * @param mode - The declared aggregate
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @returns One cell per distinct instant, in axis order
 */
export function deriveHeatCells(
    cells: readonly HeatCellValue[],
    mode: "mean" | "max" | "sum",
    ordinal?: ReadonlyMap<string, number>,
): HeatCellValue[] {
    // Derived cells are REAL East option values (`some`/`none` — never a
    // hand-rolled `{ type, value }` literal, which lacks the encoder symbol
    // and breaks the day one is encoded or symbol-compared; #617).
    return groupByInstant(cells, ordinal).map((g): HeatCellValue => {
        const vals = g.members.flatMap((c) => (c.value.type === "some" ? [c.value.value] : []));
        let v: number | undefined;
        if (vals.length > 0) {
            const total = vals.reduce((a, b) => a + b, 0);
            v = mode === "sum" ? total : mode === "max" ? maxOf(vals) : total / vals.length;
        }
        return {
            at: g.at,
            value: v !== undefined ? some(v) : none,
            label: v !== undefined ? some(formatDerived(v)) : none,
        };
    });
}

/**
 * Derive per-bucket table subtotal cells (the Table #317 vocabulary) — raw
 * values only; text and tone are renderer-derived through the row's shared
 * `TickFormatType` format.
 *
 * @param cells - The children's cells
 * @param mode - The declared aggregate
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @returns One cell per distinct instant, in axis order
 */
export function deriveTableCells(
    cells: readonly TableCellValue[],
    mode: "sum" | "mean" | "min" | "max" | "count",
    ordinal?: ReadonlyMap<string, number>,
): TableCellValue[] {
    return groupByInstant(cells, ordinal).map((g): TableCellValue => {
        const vals = g.members.flatMap((c) => (c.value.type === "some" ? [c.value.value] : []));
        let v: number | undefined;
        if (mode === "count") v = vals.length;
        else if (vals.length > 0) {
            const total = vals.reduce((a, b) => a + b, 0);
            v = mode === "sum" ? total
                : mode === "mean" ? total / vals.length
                : mode === "min" ? minOf(vals)
                : maxOf(vals);
        }
        return {
            at: g.at,
            value: v !== undefined ? some(v) : none,
            text: none,
            tone: none,
        };
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
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @returns One derived series per position
 */
export function deriveTableSeries(
    positions: ReadonlyArray<readonly TableSeriesValue[]>,
    mode: "sum" | "mean" | "min" | "max" | "count",
    ordinal?: ReadonlyMap<string, number>,
): TableSeriesValue[] {
    const width = positions.reduce((m, p) => Math.max(m, p.length), 0);
    const out: TableSeriesValue[] = [];
    for (let i = 0; i < width; i++) {
        const at = positions.map((p) => p[i]).filter((s): s is TableSeriesValue => s !== undefined);
        if (at.length === 0) continue;
        const style = at[0]!;
        out.push({
            cells: deriveTableCells(at.flatMap((s) => s.cells), mode, ordinal),
            format: style.format, tone: style.tone, strong: style.strong, rollup: style.rollup,
        });
    }
    return out;
}

/** The heat-arm cells of a row (empty for other kinds / arms). */
function heatCellsOf(row: PlanRowValue): readonly HeatCellValue[] {
    if (row.kind.type !== "heat") return [];
    const cells = row.kind.value.cells;
    return cells.type === "heat" ? cells.value.cells : [];
}

/** A heat row's DECLARED scale (`min` / `max` / `warnAt`), when its cells
 *  ride the heat arm. */
function heatScaleOf(row: PlanRowValue): HeatScale | undefined {
    if (row.kind.type !== "heat" || row.kind.value.cells.type !== "heat") return undefined;
    const { min, max, warnAt } = row.kind.value.cells.value;
    return {
        min: min.type === "some" ? min.value : undefined,
        max: max.type === "some" ? max.value : undefined,
        warnAt: warnAt.type === "some" ? warnAt.value : undefined,
    };
}

/** A heat scale as plain numbers — `undefined` where nothing is declared. */
export interface HeatScale {
    min: number | undefined;
    max: number | undefined;
    warnAt: number | undefined;
}

/**
 * The scale a derived group strip INHERITS from the heat rows it summarises.
 *
 * A strip painted on its own extent puts the coolest bucket at zero depth —
 * a blank tile with a number floating in it — which reads as no data, not as
 * the minimum. A `mean` or `max` of rows declared on 0–100 is itself on
 * 0–100, so the strip takes the children's scale: the widest declared span
 * (every child must declare the bound for it to hold), and the tightest
 * warn threshold. A `sum` outgrows its members' scale and keeps the extent.
 */
function inheritedScale(children: readonly PlanRowValue[], mode: string): HeatScale | undefined {
    if (mode === "sum") return undefined;
    const scales = children.map(heatScaleOf).filter((s): s is HeatScale => s !== undefined);
    if (scales.length === 0) return undefined;
    const mins = scales.map((s) => s.min);
    const maxs = scales.map((s) => s.max);
    const warns = scales.map((s) => s.warnAt).filter((w): w is number => w !== undefined);
    const min = mins.every((m): m is number => m !== undefined) ? minOf(mins) : undefined;
    const max = maxs.every((m): m is number => m !== undefined) ? maxOf(maxs) : undefined;
    const warnAt = warns.length > 0 ? minOf(warns) : undefined;
    if (min === undefined && max === undefined && warnAt === undefined) return undefined;
    return { min, max, warnAt };
}

/** Every span run across a subtree (any depth), skipping the runs of
 *  diagnostic rows — a row that cannot be placed rolls up nothing (#811). */
function subtreeRuns(index: PlanRowIndex, key: RowKey, diagnosed: ReadonlyMap<RowKey, PlanRowDiagnostic>): RunValue[] {
    const out: RunValue[] = [];
    const walk = (k: RowKey) => {
        for (const child of index.children.get(k) ?? []) {
            if (child.kind.type === "span" && !diagnosed.has(child.key)) appendAll(out, child.kind.value.runs);
            walk(child.key);
        }
    };
    walk(key);
    return out;
}

/**
 * Why a row cannot be drawn where it is (#811) — it renders in place as a
 * diagnostic row carrying this, and derives nothing.
 *
 * @property found - The arm the row's instants ride (the first one found)
 * @property expected - The arm the axis speaks
 */
export interface PlanRowDiagnostic {
    kind: "axis";
    found: PlanAxisKind;
    expected: PlanAxisKind;
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
    /** The scale a derived strip inherits from its heat members (see
     *  `inheritedScale`) — absent when it paints on its own extent. */
    groupSummaryScale: ReadonlyMap<RowKey, HeatScale>;
    /** Direct-member count by group row key — the `"8 rs"` gutter meta.
     *  Derived here, not baked into the IR: a group parent synthesized per
     *  paged window would otherwise carry THAT window's count (#568). */
    groupMembers: ReadonlyMap<RowKey, number>;
    /** The rows that render as diagnostic rows, by key (#811) — excluded
     *  from every band, aggregate, subtotal and strip above. */
    diagnostics: ReadonlyMap<RowKey, PlanRowDiagnostic>;
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
 * With the axis kind given, a row whose instants ride another arm is a
 * DIAGNOSTIC row (#811): it is recorded in `diagnostics`, derives nothing of
 * its own, and contributes nothing to any parent's band, aggregate, subtotal
 * or strip — it still counts as a member, since it still renders.
 *
 * @param index - The row-tree index
 * @param ordinal - The ordinal axis's value → index map (orders ordinal cells; omit on other axes)
 * @param axisKind - The axis kind; omit to diagnose nothing
 * @returns Every derived number, keyed by row
 */
export function derivePlan(
    index: PlanRowIndex,
    ordinal?: ReadonlyMap<string, number>,
    axisKind?: PlanAxisKind,
): PlanDerived {
    const bands = new Map<RowKey, DerivedBand[]>();
    const heatCells = new Map<RowKey, HeatCellValue[]>();
    const tableSeries = new Map<RowKey, TableSeriesValue[]>();
    const groupSummary = new Map<RowKey, HeatCellValue[]>();
    const groupSummaryScale = new Map<RowKey, HeatScale>();
    const groupMembers = new Map<RowKey, number>();
    const diagnostics = new Map<RowKey, PlanRowDiagnostic>();
    if (axisKind !== undefined) {
        for (const m of axisKindMismatches(index, axisKind)) {
            diagnostics.set(m.row, { kind: "axis", found: m.found, expected: axisKind });
        }
    }
    const placeable = (row: PlanRowValue): boolean => !diagnostics.has(row.key);
    // A row's effective cells — its own, or (for declared parents) its
    // already-derived cells from the bottom-up walk. A diagnostic row has none.
    const resolvedHeatCells = (row: PlanRowValue): readonly HeatCellValue[] => {
        if (!placeable(row)) return [];
        const own = heatCellsOf(row);
        if (own.length > 0) return own;
        return heatCells.get(row.key) ?? [];
    };
    const resolvedTableSeries = (row: PlanRowValue): readonly TableSeriesValue[] => {
        if (row.kind.type !== "table" || !placeable(row)) return [];
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
        if (kind.type === "group") groupMembers.set(row.key, children.length);
        // A diagnostic row draws its message, not its marks — nothing of its
        // own to derive.
        if (!placeable(row)) return;
        if (kind.type === "span" && kind.value.rollup.type === "some") {
            const unit = kind.value.unit.type === "some" ? kind.value.unit.value : undefined;
            const runs = [...kind.value.runs, ...subtreeRuns(index, row.key, diagnostics)];
            bands.set(row.key, deriveBands(runs, kind.value.rollup.value.type, unit, ordinal));
        }
        if (kind.type === "heat" && kind.value.aggregate.type === "some"
            && heatCellsOf(row).length === 0 && children.length > 0) {
            heatCells.set(row.key, deriveHeatCells(
                children.flatMap(resolvedHeatCells), kind.value.aggregate.value.type, ordinal));
        }
        if (kind.type === "table" && kind.value.aggregate.type === "some"
            && tableRollupSeries(kind.value.series).length === 0 && children.length > 0) {
            const positions = children.map(resolvedTableSeries).filter((p) => p.length > 0);
            if (positions.length > 0) {
                tableSeries.set(row.key, deriveTableSeries(positions, kind.value.aggregate.value.type, ordinal));
            }
        }
        if (kind.type === "group" && kind.value.summaryAggregate.type === "some") {
            const mode = kind.value.summaryAggregate.value.type;
            groupSummary.set(row.key, deriveHeatCells(children.flatMap(resolvedHeatCells), mode, ordinal));
            const scale = inheritedScale(children.filter(placeable), mode);
            if (scale !== undefined) groupSummaryScale.set(row.key, scale);
        }
    };
    for (const root of index.roots) visit(root);
    return { bands, heatCells, tableSeries, groupSummary, groupSummaryScale, groupMembers, diagnostics };
}

// ── Keeping identities across re-derivations (#815) ────────────────────────

const instantEqual = equalFor(Plan.Types.Instant);
const runStateEqual = equalFor(Plan.Types.Run.fields.state);
const heatCellsEqual = equalFor(ArrayType(Plan.Types.HeatCell));
const tableSeriesEqual = equalFor(ArrayType(Plan.Types.TableSeries));

function sameBands(a: readonly DerivedBand[], b: readonly DerivedBand[]): boolean {
    return a.length === b.length && a.every((x, i) => {
        const y = b[i]!;
        return x.count === y.count && x.quantity === y.quantity && instantEqual(x.from, y.from)
            && instantEqual(x.to, y.to) && runStateEqual(x.state, y.state);
    });
}

function sameScale(a: HeatScale, b: HeatScale): boolean {
    return a.min === b.min && a.max === b.max && a.warnAt === b.warnAt;
}

function sameDiagnostic(a: PlanRowDiagnostic, b: PlanRowDiagnostic): boolean {
    return a.kind === b.kind && a.found === b.found && a.expected === b.expected;
}

/** `next`, with each entry `prev` already held for the same key reused when equal. */
function keptEntries<V>(
    prev: ReadonlyMap<RowKey, V>,
    next: ReadonlyMap<RowKey, V>,
    same: (a: V, b: V) => boolean,
): ReadonlyMap<RowKey, V> {
    if (prev === next) return next;
    let kept = 0;
    const out = new Map<RowKey, V>();
    for (const [key, value] of next) {
        const old = prev.get(key);
        if (old !== undefined && (old === value || same(old, value))) {
            out.set(key, old);
            kept += 1;
        } else {
            out.set(key, value);
        }
    }
    // Every entry carried over and nothing added or dropped: the old map
    // itself says the same thing.
    return kept === next.size && prev.size === next.size ? prev : out;
}

/**
 * A re-derivation with each row's entries kept by IDENTITY where their
 * content did not move.
 *
 * @remarks
 * {@link derivePlan} rebuilds every map from scratch — on a data change, and
 * on every paged window landing, since a landing re-indexes the resident
 * rows. A row reads only its own entries, so a row memo can skip exactly when
 * those entries are the objects it rendered with. This hands back the old
 * object wherever the new one says the same thing, which is what lets a
 * landing render the rows whose numbers it moved and none of the others.
 *
 * @param prev - The previous derivation, if any
 * @param next - The new derivation
 * @returns `next`, its unchanged entries replaced by `prev`'s
 */
export function stableDerived(prev: PlanDerived | undefined, next: PlanDerived): PlanDerived {
    if (prev === undefined || prev === next) return next;
    return {
        bands: keptEntries(prev.bands, next.bands, sameBands),
        heatCells: keptEntries(prev.heatCells, next.heatCells, heatCellsEqual),
        tableSeries: keptEntries(prev.tableSeries, next.tableSeries, tableSeriesEqual),
        groupSummary: keptEntries(prev.groupSummary, next.groupSummary, heatCellsEqual),
        groupSummaryScale: keptEntries(prev.groupSummaryScale, next.groupSummaryScale, sameScale),
        groupMembers: next.groupMembers,
        diagnostics: keptEntries(prev.diagnostics, next.diagnostics, sameDiagnostic),
    };
}
