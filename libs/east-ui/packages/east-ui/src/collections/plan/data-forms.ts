/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shared data-driven pipeline (`Plan Data Interface.md` §3.5a) — the
 * accessor config surfaces, the reified groupBy engine, and the per-kind
 * leaf/parent constructors that the `Plan.series.*` builders compose into
 * their `make` functions. Structure (groupBy levels) is host config; every
 * per-row value flows through accessors as expressions, optional ones
 * returning the fields' `Option` types.
 *
 * There is NO standalone authoring surface here — a canvas is defined as
 * `data` + `series` (+ the root resolvers); this module is the series
 * builders' internals.
 *
 * @packageDocumentation
 */

import {
    type BlockBuilder,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    Expr,
    ArrayType,
    DictType,
    OptionType,
    StringType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { StatusValueType } from "../../feedback/status/types.js";
import { TableAggregateType, type TableAggregateLiteral } from "../table/types.js";
import { TickFormatType } from "../../format/types.js";
import {
    PlanDrillType,
    PlanRollupType,
    type PlanRollupLiteral,
    PlanAggregateType,
    type PlanAggregateLiteral,
    type PlanHeatCellsType,
    type PlanTableCellType,
    type PlanTableSeriesType,
    PlanTableSplitType,
    type PlanTableSplitLiteral,
    PlanTableEmphasisType,
    type PlanTableEmphasisLiteral,
    PlanExpandType,
    PlanRunType,
    PlanDecisionMarkType,
    PlanRowKindType,
    PlanRowType,
    type PlanRowsValue,
} from "./types.js";
import { createHeatCells, resolveTag, type PlanHeatCellsOptions } from "./builders.js";
import { PlanPortType } from "./types.js";
import { applyRowOverrides, type PlanGroupParentFn } from "./assemble.js";
import { createSpan, createHeat, createTable } from "./factories.js";

// ============================================================================
// Accessors + the reified grouping engine
// ============================================================================

/** An accessor over a data row. */
export type PlanAccessor<R extends StructType, T extends EastType> = (row: ExprType<R>) => SubtypeExprOrValue<T>;

/** One resolved groupBy level — the reified key accessor + the level's parent constructor. */
export interface PlanResolvedLevel {
    /** The reified group-key accessor (an East function call per row). */
    by: (row: ExprType<StructType>) => ExprType<StringType>;
    /** The level's shared parent constructor (see `groupParentFn`). */
    parentFn: PlanGroupParentFn;
}

/** Reify a level's key accessor once (fixed `String` output — no inference). */
export function reifyLevelKey(rowType: StructType, by: PlanAccessor<StructType, StringType>): PlanResolvedLevel["by"] {
    const keyFn = East.function([rowType], StringType, (_$, r) => by(r));
    return (row) => keyFn(row);
}

/**
 * Recursive grouping engine — TS-recursive over the (static) levels,
 * East-dynamic over the group values discovered in the data. Each level is
 * ONE reified East function over `(pathPrefix, rows)`: the grouping is bound
 * once (`groupToArrays` — never re-evaluated), the grouped dict is walked
 * with key and members in hand, and each group is built by the level's
 * shared parent constructor over its recursively-grouped children.
 */
export function groupRows(
    elems: ExprType<ArrayType<StructType>>,
    levels: PlanResolvedLevel[],
    makeLeaves: (subset: ExprType<ArrayType<StructType>>) => PlanRowsValue,
    pathPrefix: SubtypeExprOrValue<StringType>,
): PlanRowsValue {
    if (levels.length === 0) return makeLeaves(elems);
    const [level, ...rest] = levels;
    const elemType = (Expr.type(elems) as ArrayType<StructType>).value;
    const levelFn = East.function(
        [StringType, ArrayType(elemType)],
        ArrayType(PlanRowType),
        ($, prefix, rows) => {
            const grouped = $.let(
                rows.groupToArrays((_$, r) => level!.by(r)),
                DictType(StringType, ArrayType(elemType)));
            const subtrees = $.let(
                grouped.map(($2, members, gkey) => {
                    const pathKey = $2.let(East.str`${prefix}${gkey}`, StringType);
                    const children = $2.let(
                        groupRows(members, rest, makeLeaves, East.str`${pathKey}/`),
                        ArrayType(PlanRowType));
                    return level!.parentFn(pathKey, gkey, children);
                }).toArray(),
                ArrayType(ArrayType(PlanRowType)));
            const empty = $.const([], ArrayType(PlanRowType));
            return subtrees.reduce((_$, acc, x) => acc.concat(x), empty);
        },
    );
    return levelFn(pathPrefix, elems);
}

// ============================================================================
// The per-kind accessor configs (the series builders' surfaces)
// ============================================================================

/**
 * Config for `Plan.series.span` (minus `match`) — accessor-driven span rows
 * with arbitrary-depth rollup grouping.
 *
 * @property key - Row-key accessor
 * @property label - Gutter label accessor
 * @property id - Render labels as mono row ids
 * @property stacked - Two-line gutter layout (label over sub)
 * @property sub - Gutter sub-line accessor
 * @property value - Gutter value-slot accessor
 * @property status - Per-row status-dot accessor (an `Option<StatusValueType>`)
 * @property drill - Per-row drill-payload accessor (an `Option<PlanDrillType>`)
 * @property expand - Per-row expand-declaration accessor (an `Option<PlanExpandType>`)
 * @property runs - Per-row runs accessor
 * @property decisions - Per-row decision-diamonds accessor
 * @property ports - Per-row ports accessor
 * @property groupBy - Group-key accessors (span rollup parents per level)
 * @property rollup - Parent rollup mode (default `"union"`)
 * @property unit - Quantity unit for band sums
 */
export interface PlanSpanOfConfig<R extends StructType> {
    /** Row-key accessor. */
    key: PlanAccessor<R, StringType>;
    /** Gutter label accessor. */
    label: PlanAccessor<R, StringType>;
    /** Render labels as mono row ids. */
    id?: boolean;
    /** Two-line gutter layout (label over sub). */
    stacked?: boolean;
    /** Gutter sub-line accessor — returns the field's `Option` (per-row presence). */
    sub?: PlanAccessor<R, OptionType<StringType>>;
    /** Gutter value-slot accessor — returns the field's `Option`. */
    value?: PlanAccessor<R, OptionType<StringType>>;
    /** Per-row status-dot accessor — returns the field's `Option`. */
    status?: PlanAccessor<R, OptionType<StatusValueType>>;
    /** Per-row drill-payload accessor — returns the field's `Option` (build values with `Plan.drill`). */
    drill?: PlanAccessor<R, OptionType<PlanDrillType>>;
    /** Per-row expand-declaration accessor — returns the field's `Option<PlanExpandType>` (R2). */
    expand?: PlanAccessor<R, OptionType<PlanExpandType>>;
    /** Per-row runs accessor. */
    runs: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlanRunType>>;
    /** Per-row decision-diamonds accessor. */
    decisions?: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlanDecisionMarkType>>;
    /** Per-row ports accessor. */
    ports?: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<typeof PlanPortType>>;
    /** Group-key accessors — one span rollup parent per discovered value per level. */
    groupBy?: PlanAccessor<R, StringType>[];
    /** Parent rollup mode (default `"union"`; a literal or a `PlanRollupType` expression). */
    rollup?: SubtypeExprOrValue<PlanRollupType> | PlanRollupLiteral;
    /** Quantity unit for band sums (`"t"`). */
    unit?: SubtypeExprOrValue<StringType>;
}

/** The span PARENT kind — a rollup declaration (renderer derives bands). */
export function spanParentKind(cfg: PlanSpanOfConfig<StructType>): ExprType<PlanRowKindType> {
    return East.value(variant("span", {
        runs:      [],
        decisions: [],
        ports:     [],
        rollup:    some(resolveTag(cfg.rollup ?? "union", PlanRollupType)),
        unit:      cfg.unit !== undefined ? some(cfg.unit) : none,
    }), PlanRowKindType);
}

/** The span LEAF constructor — one data row to its 1-row subtree, the
 *  envelope's Option fields injected from the accessors. */
export function spanLeafOf(cfg: PlanSpanOfConfig<StructType>): ($: BlockBuilder<ArrayType<PlanRowType>>, row: ExprType<StructType>) => SubtypeExprOrValue<ArrayType<PlanRowType>> {
    return (_$, r) => applyRowOverrides(
        createSpan({
            key:   cfg.key(r),
            label: cfg.label(r),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            runs: cfg.runs(r),
            ...(cfg.decisions !== undefined ? { decisions: cfg.decisions(r) } : {}),
            ...(cfg.ports !== undefined ? { ports: cfg.ports(r) } : {}),
        }),
        {
            ...(cfg.sub !== undefined ? { sub: cfg.sub(r) } : {}),
            ...(cfg.value !== undefined ? { value: cfg.value(r) } : {}),
            ...(cfg.status !== undefined ? { status: cfg.status(r) } : {}),
            ...(cfg.drill !== undefined ? { drill: cfg.drill(r) } : {}),
            ...(cfg.expand !== undefined ? { expand: cfg.expand(r) } : {}),
        },
    );
}

/**
 * Config for `Plan.series.heat` (minus `match`).
 *
 * @property key - Row-key accessor
 * @property label - Gutter label accessor
 * @property id - Render labels as mono row ids
 * @property stacked - Two-line gutter layout (label over sub)
 * @property sub - Gutter sub-line accessor
 * @property value - Gutter value-slot accessor
 * @property status - Per-row status-dot accessor
 * @property cells - Per-row cells accessor (a `PlanHeatCellsType`)
 * @property groupBy - Group-key accessors (aggregated heat parents per level)
 * @property aggregate - Parent aggregation mode (default `"mean"`)
 * @property scale - Heat scale applied to derived parent cells
 */
export interface PlanHeatOfConfig<R extends StructType> {
    /** Row-key accessor. */
    key: PlanAccessor<R, StringType>;
    /** Gutter label accessor. */
    label: PlanAccessor<R, StringType>;
    /** Render labels as mono row ids. */
    id?: boolean;
    /** Two-line gutter layout (label over sub). */
    stacked?: boolean;
    /** Gutter sub-line accessor — returns the field's `Option` (per-row presence). */
    sub?: PlanAccessor<R, OptionType<StringType>>;
    /** Gutter value-slot accessor — returns the field's `Option`. */
    value?: PlanAccessor<R, OptionType<StringType>>;
    /** Per-row status-dot accessor — returns the field's `Option`. */
    status?: PlanAccessor<R, OptionType<StatusValueType>>;
    /** Per-row cells accessor (build with `Plan.heatCells` / `Plan.weightCells` / `Plan.segmentCells`). */
    cells: (row: ExprType<R>) => SubtypeExprOrValue<PlanHeatCellsType>;
    /** Group-key accessors — one aggregated heat parent per discovered value per level. */
    groupBy?: PlanAccessor<R, StringType>[];
    /** Parent aggregation mode (default `"mean"`; a literal or a `PlanAggregateType` expression). */
    aggregate?: SubtypeExprOrValue<PlanAggregateType> | PlanAggregateLiteral;
    /** Heat scale + warn threshold applied to derived parent cells. */
    scale?: PlanHeatCellsOptions;
}

/** The heat PARENT kind — an aggregate declaration on empty scale-bearing cells. */
export function heatParentKind(cfg: PlanHeatOfConfig<StructType>): ExprType<PlanRowKindType> {
    return East.value(variant("heat", {
        cells:     createHeatCells([], cfg.scale),
        aggregate: some(resolveTag(cfg.aggregate ?? "mean", PlanAggregateType)),
    }), PlanRowKindType);
}

/** The heat LEAF constructor. */
export function heatLeafOf(cfg: PlanHeatOfConfig<StructType>): ($: BlockBuilder<ArrayType<PlanRowType>>, row: ExprType<StructType>) => SubtypeExprOrValue<ArrayType<PlanRowType>> {
    return (_$, r) => applyRowOverrides(
        createHeat({
            key:   cfg.key(r),
            label: cfg.label(r),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            cells: cfg.cells(r),
        }),
        {
            ...(cfg.sub !== undefined ? { sub: cfg.sub(r) } : {}),
            ...(cfg.value !== undefined ? { value: cfg.value(r) } : {}),
            ...(cfg.status !== undefined ? { status: cfg.status(r) } : {}),
        },
    );
}

/**
 * Config for `Plan.series.table` (minus `match`).
 *
 * @property key - Row-key accessor
 * @property label - Gutter label accessor
 * @property id - Render labels as mono row ids
 * @property stacked - Two-line gutter layout (label over sub)
 * @property sub - Gutter sub-line accessor
 * @property cells - Per-row cells accessor (sugar for one unstyled value series)
 * @property series - Per-row multi-series accessor (exclusive with `cells`)
 * @property split - Part layout when several value series render
 * @property emphasis - Row emphasis (`"body"` / `"header"` / `"footer"`)
 * @property groupBy - Group-key accessors (subtotal parents per level)
 * @property aggregate - Subtotal mode (default `"sum"`)
 * @property format - Numeral format for derived subtotals
 */
export interface PlanTableOfConfig<R extends StructType> {
    /** Row-key accessor. */
    key: PlanAccessor<R, StringType>;
    /** Gutter label accessor. */
    label: PlanAccessor<R, StringType>;
    /** Render labels as mono row ids. */
    id?: boolean;
    /** Two-line gutter layout (label over sub). */
    stacked?: boolean;
    /** Gutter sub-line accessor — returns the field's `Option` (per-row presence). */
    sub?: PlanAccessor<R, OptionType<StringType>>;
    /** Per-row cells accessor (build with `Plan.tableCells`) — sugar for one unstyled value series. */
    cells?: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlanTableCellType>>;
    /** Per-row MULTI-SERIES accessor (`Array<PlanTableSeriesType>` in the data); exclusive with `cells`. */
    series?: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlanTableSeriesType>>;
    /** Part layout when several value series render — `"horizontal"` (default) / `"vertical"`. */
    split?: SubtypeExprOrValue<PlanTableSplitType> | PlanTableSplitLiteral;
    /** Row emphasis — `"body"` (default) / `"header"` / `"footer"`. */
    emphasis?: SubtypeExprOrValue<PlanTableEmphasisType> | PlanTableEmphasisLiteral;
    /** Group-key accessors — one subtotal parent per discovered value per level. */
    groupBy?: PlanAccessor<R, StringType>[];
    /** Subtotal mode (default `"sum"`; a literal or a `TableAggregateType` expression). */
    aggregate?: SubtypeExprOrValue<TableAggregateType> | TableAggregateLiteral;
    /** Numeral format for the rows' values + derived subtotals — a `Format.*` spec. */
    format?: SubtypeExprOrValue<TickFormatType>;
}

/** The table PARENT kind — a subtotal declaration (header emphasis). */
export function tableParentKind(cfg: PlanTableOfConfig<StructType>): ExprType<PlanRowKindType> {
    return East.value(variant("table", {
        series:    [],
        split:     variant("horizontal", null),
        aggregate: some(resolveTag(cfg.aggregate ?? "sum", TableAggregateType)),
        format:    cfg.format !== undefined ? some(East.value(cfg.format, TickFormatType)) : none,
        emphasis:  variant("header", null),
    }), PlanRowKindType);
}

/** The table LEAF constructor. */
export function tableLeafOf(cfg: PlanTableOfConfig<StructType>): ($: BlockBuilder<ArrayType<PlanRowType>>, row: ExprType<StructType>) => SubtypeExprOrValue<ArrayType<PlanRowType>> {
    return (_$, r) => applyRowOverrides(
        createTable({
            key:   cfg.key(r),
            label: cfg.label(r),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            ...(cfg.cells !== undefined ? { cells: cfg.cells(r) } : {}),
            ...(cfg.series !== undefined ? { series: cfg.series(r) } : {}),
            ...(cfg.split !== undefined ? { split: cfg.split } : {}),
            ...(cfg.emphasis !== undefined ? { emphasis: cfg.emphasis } : {}),
            ...(cfg.format !== undefined ? { format: cfg.format } : {}),
        }),
        {
            ...(cfg.sub !== undefined ? { sub: cfg.sub(r) } : {}),
        },
    );
}
