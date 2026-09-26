/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Temporal fold (#824) — what a row shows in a bucket that holds more than
 * one of its cells or points: ONE, their declared `fold`.
 *
 * Cells and chart points sit at their own instants; the scale's resolution
 * decides the buckets. Where a bucket is coarser than the data — weekly cells
 * on a MONTH axis — it shows one element whose value is its members' fold
 * (`sum` / `mean` / `min` / `max` / `last` / `count`), never the members piled
 * into one column. Every kind that places values by bucket folds alike: heat,
 * weight and segment cells, table numerals, and a chart's line, area and
 * column layers (scatter and band layers draw every point).
 *
 * A fold keeps what it does not change. A bucket with ONE member keeps that
 * member as it is — its own instant, label and text — unless the fold is
 * `count`, which always counts; so at the data's own resolution nothing moves,
 * and a list whose buckets each hold one member comes back as the very same
 * array (a row memo keyed on it skips). A bucket with several members sits at
 * the period's start, or at their shared instant when they share one.
 *
 * @packageDocumentation
 */

import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils.js";
import { instantKey, instantOrder, type PlanInstantValue } from "./instant.js";
import { maxOf, minOf } from "./reductions.js";
import type { PlanWords } from "./words.js";

/** A fold, as its tag — `PlanFoldType` (derived from the East type, never mirrored). */
export type PlanFold = ValueTypeOf<typeof Plan.Types.Fold>["type"];

type HeatCellsValue = ValueTypeOf<typeof Plan.Types.HeatCells>;
type HeatCellValue = ValueTypeOf<typeof Plan.Types.HeatCell>;
type WeightCellValue = ValueTypeOf<typeof Plan.Types.WeightCell>;
type SegmentCellValue = ValueTypeOf<typeof Plan.Types.SegmentCell>;
type SegmentValue = ValueTypeOf<typeof Plan.Types.Segment>;
type TableCellValue = ValueTypeOf<typeof Plan.Types.TableCell>;
type TableSeriesValue = ValueTypeOf<typeof Plan.Types.TableSeries>;
type ChartLayerValue = ValueTypeOf<typeof Plan.Types.ChartLayer>;
type ChartPointValue = ValueTypeOf<typeof Plan.Types.ChartPoint>;

/**
 * The period a canvas buckets by — what a fold groups instants by. The scale
 * owns it (`PlanScale.period`): one object per key, so a memo can depend on
 * it and re-fold only when the resolution changes, not on every pan.
 */
export interface PlanPeriod {
    /** Names the period: two periods with one key floor every instant alike. */
    readonly key: string;
    /** The start of the period holding an instant — the instant itself when
     *  it rides another arm than the axis's. */
    floor(t: PlanInstantValue): PlanInstantValue;
}

/**
 * Fold a bucket's numbers.
 *
 * @param values - The members' values, in axis order (`last` reads the final one)
 * @param fold - The fold
 * @returns The folded value — `count` counts (0 for none); every other fold is
 *   `undefined` for no values
 */
export function foldNumbers(values: readonly number[], fold: PlanFold): number | undefined {
    if (fold === "count") return values.length;
    if (values.length === 0) return undefined;
    switch (fold) {
        case "sum":
        case "mean": {
            let total = 0;
            for (const v of values) total += v;
            return fold === "sum" ? total : total / values.length;
        }
        case "min": return minOf(values);
        case "max": return maxOf(values);
        case "last": return values[values.length - 1];
    }
}

/** One bucket's members. */
export interface BucketGroup<C> {
    /** Where the bucket's folded element sits — the members' own instant when
     *  they share one, else the period's start. */
    at: PlanInstantValue;
    /** The members, in axis order (members at one instant keep their order). */
    members: C[];
}

/**
 * Group elements by the period that holds each — by the instant itself
 * without a period — buckets and members in axis order.
 *
 * @remarks
 * Instants with a comparable order sort; an ordinal set without its index map
 * (the ledger's height measure) keeps insertion order, which is all a height
 * needs.
 *
 * @param items - The elements
 * @param atOf - An element's instant
 * @param period - The canvas's period, when a scale is known
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @returns One group per bucket
 */
export function bucketGroups<C>(
    items: readonly C[],
    atOf: (c: C) => PlanInstantValue,
    period: PlanPeriod | undefined,
    ordinal?: ReadonlyMap<string, number>,
): BucketGroup<C>[] {
    const groups = new Map<string, { start: PlanInstantValue; members: C[]; shared: boolean }>();
    for (const c of items) {
        const at = atOf(c);
        const start = period !== undefined ? period.floor(at) : at;
        const key = instantKey(start);
        const g = groups.get(key);
        if (g === undefined) {
            groups.set(key, { start, members: [c], shared: true });
        } else {
            if (g.shared && instantKey(atOf(g.members[0]!)) !== instantKey(at)) g.shared = false;
            g.members.push(c);
        }
    }
    const out = [...groups.values()];
    const orders = out.map((g) => instantOrder(g.start, ordinal));
    if (orders.every((n) => Number.isFinite(n))) {
        const rank = new Map(out.map((g, i) => [g, orders[i]!]));
        out.sort((a, b) => rank.get(a)! - rank.get(b)!);
    }
    return out.map((g) => ({
        at: g.shared ? atOf(g.members[0]!) : g.start,
        members: inAxisOrder(g.members, atOf, ordinal),
    }));
}

/** Members in axis order — stable, and left as given when their instants do not order. */
function inAxisOrder<C>(members: C[], atOf: (c: C) => PlanInstantValue, ordinal: ReadonlyMap<string, number> | undefined): C[] {
    if (members.length < 2) return members;
    const orders = members.map((m) => instantOrder(atOf(m), ordinal));
    if (!orders.every((n) => Number.isFinite(n))) return members;
    const idx = members.map((_, i) => i).sort((a, b) => orders[a]! - orders[b]! || a - b);
    return idx.map((i) => members[i]!);
}

/** Whether a fold leaves the elements as they are — every bucket holds one, and the fold keeps it. */
function keepsAll<C>(groups: readonly BucketGroup<C>[], fold: PlanFold): boolean {
    return fold !== "count" && groups.every((g) => g.members.length === 1);
}

/**
 * Fold a heat arm's cells.
 *
 * @remarks
 * A folded cell prints a label only where its members did — a row painted by
 * depth alone stays that way — and then its value through the arm's `format`
 * (a `count`, as a plain number). A cell with no value in any member is no
 * data, except under `count`, which counts 0.
 *
 * @param cells - The cells
 * @param fold - The arm's fold
 * @param period - The canvas's period
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @param print - How a folded value prints
 * @returns The folded cells — `cells` itself when nothing folds
 */
export function foldHeatCells(
    cells: HeatCellValue[],
    fold: PlanFold,
    period: PlanPeriod | undefined,
    ordinal: ReadonlyMap<string, number> | undefined,
    print: (v: number) => string,
): HeatCellValue[] {
    const groups = bucketGroups(cells, (c) => c.at, period, ordinal);
    if (keepsAll(groups, fold)) return cells;
    return groups.map((g): HeatCellValue => {
        if (g.members.length === 1 && fold !== "count") return g.members[0]!;
        const values = g.members.flatMap((c) => (c.value.type === "some" ? [c.value.value] : []));
        const v = foldNumbers(values, fold);
        const labelled = g.members.some((c) => c.label.type === "some");
        return {
            at: g.at,
            value: v !== undefined ? some(v) : none,
            label: v !== undefined && labelled ? some(print(v)) : none,
        };
    });
}

/**
 * Fold a weight arm's cells — each bucket's booked fraction folded, and pale
 * (planned) only when every member is.
 *
 * @param cells - The cells
 * @param fold - The arm's fold
 * @param period - The canvas's period
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @returns The folded cells — `cells` itself when nothing folds
 */
export function foldWeightCells(
    cells: WeightCellValue[],
    fold: PlanFold,
    period: PlanPeriod | undefined,
    ordinal: ReadonlyMap<string, number> | undefined,
): WeightCellValue[] {
    const groups = bucketGroups(cells, (c) => c.at, period, ordinal);
    if (keepsAll(groups, fold)) return cells;
    return groups.map((g): WeightCellValue => {
        if (g.members.length === 1 && fold !== "count") return g.members[0]!;
        return {
            at: g.at,
            fraction: foldNumbers(g.members.map((c) => c.fraction), fold) ?? 0,
            planned: g.members.every((c) => c.planned),
        };
    });
}

/**
 * Fold a segment arm's cells — each fill's weights folded across the members
 * (a member without the fill weighs 0 there; `count` counts the members that
 * carry it), the fills in the order they first appear. A folded segment
 * carries no in-bar label: a label described one cell.
 *
 * @param cells - The cells
 * @param fold - The arm's fold
 * @param period - The canvas's period
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @returns The folded cells — `cells` itself when nothing folds
 */
export function foldSegmentCells(
    cells: SegmentCellValue[],
    fold: PlanFold,
    period: PlanPeriod | undefined,
    ordinal: ReadonlyMap<string, number> | undefined,
): SegmentCellValue[] {
    const groups = bucketGroups(cells, (c) => c.at, period, ordinal);
    if (keepsAll(groups, fold)) return cells;
    return groups.map((g): SegmentCellValue => {
        if (g.members.length === 1 && fold !== "count") return g.members[0]!;
        const fills: SegmentValue["fill"][] = [];
        const byFill = new Map<string, (number | undefined)[]>();
        g.members.forEach((c, i) => {
            for (const s of c.segments) {
                let weights = byFill.get(s.fill.type);
                if (weights === undefined) {
                    weights = new Array<number | undefined>(g.members.length).fill(undefined);
                    byFill.set(s.fill.type, weights);
                    fills.push(s.fill);
                }
                weights[i] = (weights[i] ?? 0) + s.weight;
            }
        });
        return {
            at: g.at,
            segments: fills.map((fill): SegmentValue => {
                const weights = byFill.get(fill.type)!;
                const weight = fold === "count"
                    ? weights.filter((w) => w !== undefined).length
                    : foldNumbers(weights.map((w) => w ?? 0), fold) ?? 0;
                return { fill, weight, label: none };
            }),
        };
    });
}

/**
 * Fold any heat-kind arm — heat, weight or segments — by its own fold.
 *
 * @param arm - The arm
 * @param period - The canvas's period
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @param w - The canvas's words — a folded heat label prints through the arm's `format`
 * @returns The folded arm — `arm` itself when nothing folds
 */
export function foldHeatArm(
    arm: HeatCellsValue,
    period: PlanPeriod | undefined,
    ordinal: ReadonlyMap<string, number> | undefined,
    w: PlanWords,
): HeatCellsValue {
    switch (arm.type) {
        case "heat": {
            const fold = arm.value.fold.type;
            const format = getSomeorUndefined(arm.value.format);
            const cells = foldHeatCells(arm.value.cells, fold, period, ordinal,
                (v) => (fold === "count" ? w.number(v) : w.value(v, format)));
            return cells === arm.value.cells ? arm : variant("heat", { ...arm.value, cells });
        }
        case "weight": {
            const cells = foldWeightCells(arm.value.cells, arm.value.fold.type, period, ordinal);
            return cells === arm.value.cells ? arm : variant("weight", { ...arm.value, cells });
        }
        case "segments": {
            const cells = foldSegmentCells(arm.value.cells, arm.value.fold.type, period, ordinal);
            return cells === arm.value.cells ? arm : variant("segments", { ...arm.value, cells });
        }
    }
}

/**
 * Fold table cells — a bucket's values folded; a folded cell carries no text
 * or tone override (the renderer prints and tones its value, as it does any
 * cell's).
 *
 * @param cells - The cells
 * @param fold - The series' fold
 * @param period - The canvas's period
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @returns The folded cells — `cells` itself when nothing folds
 */
export function foldTableCells(
    cells: TableCellValue[],
    fold: PlanFold,
    period: PlanPeriod | undefined,
    ordinal: ReadonlyMap<string, number> | undefined,
): TableCellValue[] {
    const groups = bucketGroups(cells, (c) => c.at, period, ordinal);
    if (keepsAll(groups, fold)) return cells;
    return groups.map((g): TableCellValue => {
        if (g.members.length === 1 && fold !== "count") return g.members[0]!;
        const values = g.members.flatMap((c) => (c.value.type === "some" ? [c.value.value] : []));
        const v = foldNumbers(values, fold);
        return { at: g.at, value: v !== undefined ? some(v) : none, text: none, tone: none };
    });
}

/**
 * Fold a table row's value series, each by its own fold.
 *
 * @param series - The series
 * @param period - The canvas's period
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @returns The folded series — `series` itself when nothing folds
 */
export function foldTableSeries(
    series: TableSeriesValue[],
    period: PlanPeriod | undefined,
    ordinal: ReadonlyMap<string, number> | undefined,
): TableSeriesValue[] {
    let changed = false;
    const out = series.map((s): TableSeriesValue => {
        const cells = foldTableCells(s.cells, s.fold.type, period, ordinal);
        if (cells === s.cells) return s;
        changed = true;
        return { ...s, cells };
    });
    return changed ? out : series;
}

/**
 * Fold a chart layer's points — a bucket's finite values folded (a gap, a
 * non-finite `y`, is no value; a bucket of gaps stays one).
 *
 * @param points - The points
 * @param fold - The layer's fold
 * @param period - The canvas's period
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @returns The folded points — `points` itself when nothing folds
 */
export function foldChartPoints(
    points: ChartPointValue[],
    fold: PlanFold,
    period: PlanPeriod | undefined,
    ordinal: ReadonlyMap<string, number> | undefined,
): ChartPointValue[] {
    const groups = bucketGroups(points, (p) => p.t, period, ordinal);
    if (keepsAll(groups, fold)) return points;
    return groups.map((g): ChartPointValue => {
        if (g.members.length === 1 && fold !== "count") return g.members[0]!;
        const values = g.members.flatMap((p) => (Number.isFinite(p.y) ? [p.y] : []));
        return { t: g.at, y: foldNumbers(values, fold) ?? NaN };
    });
}

/**
 * Fold a chart row's layers — its line, area and column layers each by its
 * own fold; scatter, band and reference layers as they are.
 *
 * @param layers - The layers
 * @param period - The canvas's period
 * @param ordinal - The ordinal axis's value → index map, when the axis is ordinal
 * @returns The folded layers — `layers` itself when nothing folds
 */
export function foldChartLayers(
    layers: ChartLayerValue[],
    period: PlanPeriod | undefined,
    ordinal: ReadonlyMap<string, number> | undefined,
): ChartLayerValue[] {
    let changed = false;
    const out = layers.map((layer): ChartLayerValue => {
        switch (layer.type) {
            case "line": {
                const points = foldChartPoints(layer.value.points, layer.value.fold.type, period, ordinal);
                if (points === layer.value.points) return layer;
                changed = true;
                return variant("line", { ...layer.value, points });
            }
            case "area": {
                const points = foldChartPoints(layer.value.points, layer.value.fold.type, period, ordinal);
                if (points === layer.value.points) return layer;
                changed = true;
                return variant("area", { ...layer.value, points });
            }
            case "column": {
                const points = foldChartPoints(layer.value.points, layer.value.fold.type, period, ordinal);
                if (points === layer.value.points) return layer;
                changed = true;
                return variant("column", { ...layer.value, points });
            }
            case "scatter": case "band": case "refLine": case "refBand": case "refDot":
                return layer;
        }
    });
    return changed ? out : layers;
}
