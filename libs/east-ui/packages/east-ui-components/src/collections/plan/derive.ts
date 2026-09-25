/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's renderer-side derivations (§4.2 — the Table idiom): the IR
 * DECLARES rollups, aggregates, subtotals, summaries and folds, and the numbers
 * are computed here over the decoded rows (split out of `model.ts`, #815).
 *
 * @packageDocumentation
 */

import { ArrayType, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils.js";
import type { TickFormatOpt } from "../../format/index.js";
import { instantOrder, type PlanAxisKind, type PlanInstantValue } from "./instant.js";
import { appendAll, maxOf, minOf, peakConcurrency } from "./reductions.js";
import { PLAN_WORDS, type PlanWords } from "./words.js";
import { bucketGroups, foldChartLayers, foldHeatArm, foldTableSeries, type PlanPeriod } from "./fold.js";
import { totalsByUnit, totalsText, type PlanQuantityValue } from "./quantity.js";
import type { PlanRowIndex, PlanRowValue } from "./model.js";
import type { RowKey } from "./plan-state.js";
import type { ChartKindValue } from "./rows/chart-geometry.js";
import { axisKindMismatches } from "./row-instants.js";

// ── Renderer-side derivations (§4.2 — the Table idiom) ─────────────────────
//
// The IR carries DECLARATIONS (`rollup`, `aggregate` + scale, the group's
// `summary`, `format`, `fold`); the numbers — rollup bands, per-bucket
// aggregates, subtotal cells, strip summaries, folded cells — are derived here
// over the decoded values, exactly as Table's renderer computes its group
// subtotals.
//
// FOLD FIRST (#824): every row's values are folded to the canvas's period
// before anything aggregates them, so a parent summarises what its children
// SHOW — a month's mean of four weekly heat cells, not four overlapping cells.
// Without a period (the ledger's height measure) nothing folds.
//
// Instants are ordered on their own arm (`instantOrder`): epoch ms, the
// value, or — for an ordinal axis — the declared index, which the caller
// passes in as `ordinal`. Without it ordinal cells keep their insertion
// order, which is what the ledger's height measure needs and all it needs.

type RunValue = ValueTypeOf<typeof Plan.Types.Run>;
type HeatCellsValue = ValueTypeOf<typeof Plan.Types.HeatCells>;
type HeatCellValue = ValueTypeOf<typeof Plan.Types.HeatCell>;
type HeatScaleValue = ValueTypeOf<typeof Plan.Types.HeatScale>;
type TableCellValue = ValueTypeOf<typeof Plan.Types.TableCell>;
type TableSeriesValue = ValueTypeOf<typeof Plan.Types.TableSeries>;

/**
 * A table row's AGGREGABLE positions — the ones a parent subtotals.
 *
 * `rollup: true` NARROWS: flag a position and only the flagged ones roll up,
 * which is how a row says "the actual is the number, the Δ beside it is
 * commentary". Flag nothing and EVERY position rolls up, so a subtotal mirrors
 * the shape of the rows it totals — a parent over `act`/`Δ` children shows an
 * act subtotal beside a Δ subtotal rather than silently dropping one.
 *
 * (It used to return one position's cells unconditionally — the unflagged case
 * fell back to `series[0]`, so a multi-value row's second position vanished
 * into a parent that looked complete.)
 */
export function tableRollupSeries(series: readonly TableSeriesValue[]): readonly TableSeriesValue[] {
    const flagged = series.filter((x) => x.rollup);
    return flagged.length > 0 ? flagged : series;
}

/** One derived rollup band (`×k · qty`, pessimistic state). */
export interface DerivedBand {
    from: PlanInstantValue;
    /** The band's end — on an ordinal axis the LAST bucket covered (inclusive). */
    to: PlanInstantValue;
    /** Peak concurrency inside the band. */
    count: number;
    /** The members' quantities summed unit by unit, as a caption (`"208 t · 12 h"`, in the
     *  canvas's locale — #820, #824) — absent unless every member carries a quantity. */
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
    ordinal: ReadonlyMap<string, number> | undefined,
    w: PlanWords,
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
        // Each member's quantity carries its own unit (#824): tonnes sum with
        // tonnes and hours with hours, and a band says each total. A member
        // without one would make any total a silent undercount — so none.
        const quantities = g.members.flatMap((m): PlanQuantityValue[] => (m.quantity.type === "some" ? [m.quantity.value] : []));
        const quantity = quantities.length === g.members.length ? totalsText(totalsByUnit(quantities), w) : undefined;
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
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @param w - The canvas's words — how a total prints (#820); English in `en-US` by default
 * @returns The bands, in start order
 */
export function deriveBands(
    runs: readonly RunValue[],
    rollup: "union" | "byStatus" | "sum",
    ordinal?: ReadonlyMap<string, number>,
    w: PlanWords = PLAN_WORDS,
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
        return order.flatMap((tag) => mergeBands(byTag.get(tag)!, ordinal, w));
    }
    return mergeBands(runs, ordinal, w);
}

/**
 * Derive per-bucket aggregated heat cells (mean / max / sum; no-data skipped),
 * each labelled with its value — through `format` when one is given, else the
 * canvas's plain number.
 *
 * @param cells - The children's cells — already folded to the period, so each
 *   child contributes at most one value per bucket
 * @param mode - The declared aggregate
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @param w - The canvas's words (#820); English in `en-US` by default
 * @param period - The canvas's period — cells group by the bucket that holds
 *   them; without one, by instant
 * @param format - How a derived value prints
 * @returns One cell per bucket, in axis order
 */
export function deriveHeatCells(
    cells: readonly HeatCellValue[],
    mode: "mean" | "max" | "sum",
    ordinal?: ReadonlyMap<string, number>,
    w: PlanWords = PLAN_WORDS,
    period?: PlanPeriod,
    format?: TickFormatOpt,
): HeatCellValue[] {
    // Derived cells are REAL East option values (`some`/`none` — never a
    // hand-rolled `{ type, value }` literal, which lacks the encoder symbol
    // and breaks the day one is encoded or symbol-compared; #617).
    return bucketGroups(cells, (c) => c.at, period, ordinal).map((g): HeatCellValue => {
        const vals = g.members.flatMap((c) => (c.value.type === "some" ? [c.value.value] : []));
        let v: number | undefined;
        if (vals.length > 0) {
            const total = vals.reduce((a, b) => a + b, 0);
            v = mode === "sum" ? total : mode === "max" ? maxOf(vals) : total / vals.length;
        }
        return {
            at: g.at,
            value: v !== undefined ? some(v) : none,
            label: v !== undefined ? some(w.value(v, format)) : none,
        };
    });
}

/**
 * Derive per-bucket table subtotal cells (the Table #317 vocabulary) — raw
 * values only; text and tone are renderer-derived through the row's shared
 * `TickFormatType` format.
 *
 * @param cells - The children's cells, already folded to the period
 * @param mode - The declared aggregate
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @param period - The canvas's period — cells group by the bucket that holds them
 * @returns One cell per bucket, in axis order
 */
export function deriveTableCells(
    cells: readonly TableCellValue[],
    mode: "sum" | "mean" | "min" | "max" | "count",
    ordinal?: ReadonlyMap<string, number>,
    period?: PlanPeriod,
): TableCellValue[] {
    return bucketGroups(cells, (c) => c.at, period, ordinal).map((g): TableCellValue => {
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
 * rollup / fold) from the first child carrying it, so the subtotal is styled
 * like the numbers it totals rather than as anonymous plain text.
 *
 * @param positions - Each child's aggregable positions (see {@link tableRollupSeries}), folded
 * @param mode - The declared aggregate
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @param period - The canvas's period
 * @returns One derived series per position
 */
export function deriveTableSeries(
    positions: ReadonlyArray<readonly TableSeriesValue[]>,
    mode: "sum" | "mean" | "min" | "max" | "count",
    ordinal?: ReadonlyMap<string, number>,
    period?: PlanPeriod,
): TableSeriesValue[] {
    const width = positions.reduce((m, p) => Math.max(m, p.length), 0);
    const out: TableSeriesValue[] = [];
    for (let i = 0; i < width; i++) {
        const at = positions.map((p) => p[i]).filter((s): s is TableSeriesValue => s !== undefined);
        if (at.length === 0) continue;
        const style = at[0]!;
        out.push({
            cells: deriveTableCells(at.flatMap((s) => s.cells), mode, ordinal, period),
            format: style.format, tone: style.tone, strong: style.strong, rollup: style.rollup, fold: style.fold,
        });
    }
    return out;
}

/** A heat scale as plain numbers — `undefined` where nothing is declared. */
export interface HeatScale {
    min: number | undefined;
    max: number | undefined;
    warnAt: number | undefined;
}

/** A heat scale value as plain numbers. */
function scaleNumbers(s: HeatScaleValue): HeatScale {
    return { min: getSomeorUndefined(s.min), max: getSomeorUndefined(s.max), warnAt: getSomeorUndefined(s.warnAt) };
}

/** Plain numbers as a heat scale value — built with `some`/`none`, a real East value (#617). */
function scaleValue(s: HeatScale | undefined): HeatScaleValue {
    return {
        min: s?.min !== undefined ? some(s.min) : none,
        max: s?.max !== undefined ? some(s.max) : none,
        warnAt: s?.warnAt !== undefined ? some(s.warnAt) : none,
    };
}

/**
 * The scale derived cells INHERIT from the heat rows they summarise.
 *
 * A strip painted on its own extent puts the coolest bucket at zero depth —
 * a blank tile with a number floating in it — which reads as no data, not as
 * the minimum. A `mean` or `max` of rows declared on 0–100 is itself on
 * 0–100, so the derived cells take the members' scale: the widest declared
 * span (every member must declare the bound for it to hold), and the tightest
 * warn threshold. A `sum` outgrows its members' scale and keeps the extent.
 */
function inheritedScale(arms: readonly HeatCellsValue[], mode: string): HeatScale | undefined {
    if (mode === "sum") return undefined;
    const scales = arms.flatMap((a) => (a.type === "heat" ? [scaleNumbers(a.value.scale)] : []));
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

/** The first format a heat arm among `arms` declares — what cells derived from them print through. */
function inheritedFormat(arms: readonly HeatCellsValue[]): HeatCellsValue["value"]["format"] {
    for (const a of arms) if (a.value.format.type === "some") return a.value.format;
    return none;
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
 * - `axis` — the row's instants ride another arm than the axis speaks:
 *   `found` is the arm they ride (the first one found), `expected` the axis's.
 * - `duplicate` — the row repeats an id an earlier row carries (#822): `of` is
 *   that row's key. Ids are unique by construction except where hand-built rows
 *   repeat a key, and a repeat is shown, never dropped.
 */
export type PlanRowDiagnostic =
    | { kind: "axis"; found: PlanAxisKind; expected: PlanAxisKind }
    | { kind: "duplicate"; of: RowKey };

/** Whether a table row carries values of its own — a parent with none shows
 *  its children's subtotals in the positions it declares. */
function hasOwnValues(series: readonly TableSeriesValue[]): boolean {
    return series.some((s) => s.cells.length > 0);
}

/**
 * The per-value derived numbers, computed once per decoded root and period.
 *
 * Each `…` map says what a row DRAWS where that is not its own declaration —
 * a parent's derived values, or its own folded to the period (#824). A row
 * absent from a map draws what it declares, as it is.
 */
export interface PlanDerived {
    /** Rollup bands by span-parent row key. */
    bands: ReadonlyMap<RowKey, DerivedBand[]>;
    /** The heat arm each heat row draws: a declared-aggregate parent's derived
     *  cells — on its declared scale, else the one its members share — or a
     *  row's own cells folded to the period. */
    heatArms: ReadonlyMap<RowKey, HeatCellsValue>;
    /** The value series each table row draws: a parent's subtotal positions —
     *  the same shape its members have — or a row's own series folded. */
    tableSeries: ReadonlyMap<RowKey, TableSeriesValue[]>;
    /** The chart each chart row draws — its line, area and column layers folded. */
    charts: ReadonlyMap<RowKey, ChartKindValue>;
    /** The strip each group band draws collapsed: its declared aggregate over
     *  its members' drawn heat cells (on the scale they share), or its declared
     *  cells folded. Absent for a plain band, or declared cells as they are. */
    groupStrips: ReadonlyMap<RowKey, HeatCellsValue>;
    /** Direct-member count by group row key — the `"8 rs"` gutter meta.
     *  Derived here like every other aggregate: the IR declares no count, so
     *  the meta is always the members the group has (#568). */
    groupMembers: ReadonlyMap<RowKey, number>;
    /** The rows that render as diagnostic rows, by key (#811) — excluded
     *  from every band, aggregate, subtotal and strip above. */
    diagnostics: ReadonlyMap<RowKey, PlanRowDiagnostic>;
}

/**
 * Derive every declared rollup / aggregate / summary / fold over the decoded
 * rows.
 *
 * @remarks
 * The walk is an explicit POST-ORDER traversal from the roots: a declared
 * parent whose children are themselves declared parents aggregates their
 * DERIVED cells, so nesting composes to arbitrary depth — and it is correct
 * for ANY container order. The stream puts a parent before its subtree, but
 * not always right before it (#822: an entry's children follow all of its
 * `views` rows), so nothing here reads position. (It once walked the flat
 * array in reverse, which was only right while that array happened to be
 * depth-first; feeding a bottom-up aggregation the wrong order yields wrong
 * numbers, not an error — #568.)
 *
 * Each row's values fold to the period FIRST (#824), so a parent aggregates
 * what its children draw.
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
 * @param w - The canvas's words — how a derived number prints (#820); English in
 *   `en-US` by default (a height measure prints nothing it reads)
 * @param period - The canvas's period (`PlanScale.period`); omit to fold nothing
 * @returns Every derived number, keyed by row
 */
export function derivePlan(
    index: PlanRowIndex,
    ordinal?: ReadonlyMap<string, number>,
    axisKind?: PlanAxisKind,
    w: PlanWords = PLAN_WORDS,
    period?: PlanPeriod,
): PlanDerived {
    const bands = new Map<RowKey, DerivedBand[]>();
    const heatArms = new Map<RowKey, HeatCellsValue>();
    const tableSeries = new Map<RowKey, TableSeriesValue[]>();
    const charts = new Map<RowKey, ChartKindValue>();
    const groupStrips = new Map<RowKey, HeatCellsValue>();
    const groupMembers = new Map<RowKey, number>();
    const diagnostics = new Map<RowKey, PlanRowDiagnostic>();
    if (axisKind !== undefined) {
        for (const m of axisKindMismatches(index, axisKind)) {
            diagnostics.set(m.row, { kind: "axis", found: m.found, expected: axisKind });
        }
    }
    // A repeated id (#822) — the row keeps a key of its own and says so.
    for (const row of index.rows) {
        if (row.duplicateOf !== undefined) diagnostics.set(row.key, { kind: "duplicate", of: row.duplicateOf });
    }
    const placeable = (row: PlanRowValue): boolean => !diagnostics.has(row.key);
    // What a heat row draws — its derived or folded arm, else its own. The
    // walk is bottom-up, so a child's entry is in the map before its parent
    // reads it. A diagnostic row draws none.
    const drawnHeatArm = (row: PlanRowValue): HeatCellsValue | undefined => {
        if (row.kind.type !== "heat" || !placeable(row)) return undefined;
        return heatArms.get(row.key) ?? row.kind.value.cells;
    };
    const drawnHeatCells = (row: PlanRowValue): readonly HeatCellValue[] => {
        const arm = drawnHeatArm(row);
        return arm !== undefined && arm.type === "heat" ? arm.value.cells : [];
    };
    const drawnHeatArms = (rows: readonly PlanRowValue[]): HeatCellsValue[] =>
        rows.flatMap((r) => {
            const arm = drawnHeatArm(r);
            return arm !== undefined ? [arm] : [];
        });
    // A table row's aggregable positions as it draws them.
    const resolvedTableSeries = (row: PlanRowValue): readonly TableSeriesValue[] => {
        if (row.kind.type !== "table" || !placeable(row)) return [];
        if (hasOwnValues(row.kind.value.series)) return tableRollupSeries(tableSeries.get(row.key) ?? row.kind.value.series);
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
        switch (kind.type) {
            case "span":
                if (kind.value.rollup.type === "some") {
                    const runs = [...kind.value.runs, ...subtreeRuns(index, row.key, diagnostics)];
                    bands.set(row.key, deriveBands(runs, kind.value.rollup.value.type, ordinal, w));
                }
                return;
            case "heat": {
                const own = kind.value.cells;
                const ownCells = own.type === "heat" ? own.value.cells : [];
                if (kind.value.aggregate.type === "some" && ownCells.length === 0 && children.length > 0) {
                    const mode = kind.value.aggregate.value.type;
                    const arms = drawnHeatArms(children);
                    const format = own.type === "heat" && own.value.format.type === "some" ? own.value.format : inheritedFormat(arms);
                    const cells = deriveHeatCells(children.flatMap(drawnHeatCells), mode, ordinal, w, period, getSomeorUndefined(format));
                    // The parent's declared scale, else the one its members share (#824).
                    const scale = kind.value.scale.type === "some" ? kind.value.scale.value : scaleValue(inheritedScale(arms, mode));
                    heatArms.set(row.key, variant("heat", {
                        cells, scale, fold: own.type === "heat" ? own.value.fold : variant("mean", null), format,
                    }));
                    return;
                }
                const folded = foldHeatArm(own, period, ordinal, w);
                if (folded !== own) heatArms.set(row.key, folded);
                return;
            }
            case "table": {
                // A table parent with no values of its own — a series parent
                // declares its positions with empty cells — shows its
                // children's subtotals.
                if (kind.value.aggregate.type === "some" && !hasOwnValues(kind.value.series) && children.length > 0) {
                    const positions = children.map(resolvedTableSeries).filter((p) => p.length > 0);
                    if (positions.length > 0) {
                        tableSeries.set(row.key, deriveTableSeries(positions, kind.value.aggregate.value.type, ordinal, period));
                    }
                    return;
                }
                const folded = foldTableSeries(kind.value.series, period, ordinal);
                if (folded !== kind.value.series) tableSeries.set(row.key, folded);
                return;
            }
            case "chart": {
                const layers = foldChartLayers(kind.value.layers, period, ordinal);
                if (layers !== kind.value.layers) charts.set(row.key, { ...kind.value, layers });
                return;
            }
            case "group": {
                const summary = kind.value.summary;
                if (summary.type === "aggregate") {
                    const mode = summary.value.type;
                    const members = children.filter(placeable);
                    const arms = drawnHeatArms(members);
                    const format = inheritedFormat(arms);
                    groupStrips.set(row.key, variant("heat", {
                        cells: deriveHeatCells(children.flatMap(drawnHeatCells), mode, ordinal, w, period, getSomeorUndefined(format)),
                        scale: scaleValue(inheritedScale(arms, mode)),
                        fold: variant("mean", null),
                        format,
                    }));
                } else if (summary.type === "cells") {
                    const folded = foldHeatArm(summary.value, period, ordinal, w);
                    if (folded !== summary.value) groupStrips.set(row.key, folded);
                }
                return;
            }
            case "buckets": case "cards": case "events":
                return;
        }
    };
    for (const root of index.roots) visit(root);
    return { bands, heatArms, tableSeries, charts, groupStrips, groupMembers, diagnostics };
}

// ── Keeping identities across re-derivations (#815) ────────────────────────

const instantEqual = equalFor(Plan.Types.Instant);
const runStateEqual = equalFor(Plan.Types.Run.fields.state);
const heatArmEqual = equalFor(Plan.Types.HeatCells);
const tableSeriesEqual = equalFor(ArrayType(Plan.Types.TableSeries));
const chartKindEqual = equalFor(Plan.Types.RowKind.cases.chart);

function sameBands(a: readonly DerivedBand[], b: readonly DerivedBand[]): boolean {
    return a.length === b.length && a.every((x, i) => {
        const y = b[i]!;
        return x.count === y.count && x.quantity === y.quantity && instantEqual(x.from, y.from)
            && instantEqual(x.to, y.to) && runStateEqual(x.state, y.state);
    });
}

function sameDiagnostic(a: PlanRowDiagnostic, b: PlanRowDiagnostic): boolean {
    if (a.kind === "axis" && b.kind === "axis") return a.found === b.found && a.expected === b.expected;
    if (a.kind === "duplicate" && b.kind === "duplicate") return a.of === b.of;
    return false;
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
 * {@link derivePlan} rebuilds every map from scratch — on a data change, on
 * every paged window landing, since a landing re-indexes the resident rows,
 * and on a resolution change, which re-folds. A row reads only its own
 * entries, so a row memo can skip exactly when those entries are the objects
 * it rendered with. This hands back the old object wherever the new one says
 * the same thing, which is what lets a landing render the rows whose numbers
 * it moved and none of the others.
 *
 * @param prev - The previous derivation, if any
 * @param next - The new derivation
 * @returns `next`, its unchanged entries replaced by `prev`'s
 */
export function stableDerived(prev: PlanDerived | undefined, next: PlanDerived): PlanDerived {
    if (prev === undefined || prev === next) return next;
    return {
        bands: keptEntries(prev.bands, next.bands, sameBands),
        heatArms: keptEntries(prev.heatArms, next.heatArms, heatArmEqual),
        tableSeries: keptEntries(prev.tableSeries, next.tableSeries, tableSeriesEqual),
        charts: keptEntries(prev.charts, next.charts, chartKindEqual),
        groupStrips: keptEntries(prev.groupStrips, next.groupStrips, heatArmEqual),
        groupMembers: next.groupMembers,
        diagnostics: keptEntries(prev.diagnostics, next.diagnostics, sameDiagnostic),
    };
}
