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
    PlanRowsCollectionType,
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
    type PlanRowsValue,
} from "./types.js";
import { createHeatCells, resolveTag, type PlanHeatCellsOptions } from "./builders.js";
import { PlanPortType } from "./types.js";
import { applyRowOverrides, LAST_WINS, type PlanGroupParentFn } from "./assemble.js";
import { createSpan, createHeat, createTable } from "./factories.js";

// ============================================================================
// Accessors + the reified grouping engine
// ============================================================================

/**
 * An accessor over one data ENTRY — its value and its key.
 *
 * @remarks
 * The key is passed because the source is a keyed collection and a keyed
 * dataset does not repeat its key inside the value: `label: (_r, k) => k` is
 * the normal spelling, not an oddity (#568). Single-parameter accessors keep
 * working — TS lets a callback ignore trailing arguments.
 */
export type PlanAccessor<R extends StructType, T extends EastType> =
    (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<T>;

/** One resolved groupBy level — the reified key accessor + the level's parent constructor. */
export interface PlanResolvedLevel {
    /** The reified group-key accessor (an East function call per entry). */
    by: (row: ExprType<StructType>, key: ExprType<StringType>) => ExprType<StringType>;
    /** The level's shared parent constructor (see `groupParentFn`). */
    parentFn: PlanGroupParentFn;
}

/** Reify a level's key accessor once (fixed `String` output — no inference). */
export function reifyLevelKey(rowType: StructType, by: PlanAccessor<StructType, StringType>): PlanResolvedLevel["by"] {
    const keyFn = East.function([rowType, StringType], StringType, (_$, r, k) => by(r, k));
    return (row, key) => keyFn(row, key);
}

/**
 * A leaf row's key — the DATA key, optionally behind the series' `prefix`.
 *
 * @remarks
 * Empty prefix (the default) means the canvas key IS the source key, which is
 * what keeps a paged canvas addressable: `seek` returns a row in the source's
 * key order and the canvas has a row under that very key. A non-empty prefix
 * is the author knowingly leaving that key space to keep two families over one
 * source apart.
 */
export function prefixedKey(
    prefix: string | undefined,
    key: ExprType<StringType>,
): SubtypeExprOrValue<StringType> {
    return prefix === undefined || prefix === "" ? key : East.str`${prefix}${key}`;
}

/**
 * Recursive grouping engine — TS-recursive over the (static) levels,
 * East-dynamic over the group values discovered in the data. Each level is
 * ONE reified East function over `(pathPrefix, entries)`: the grouping is bound
 * once (`groupToDicts` — never re-evaluated), the grouped dict is walked with
 * group key and members in hand, and each group is built by the level's shared
 * parent constructor over its recursively-grouped children.
 *
 * @remarks
 * Grouping preserves the ENTRIES' keys (`groupToDicts`, not `groupToArrays`):
 * the members of a group are still a keyed collection, so leaf rows keep
 * inheriting the source's keys however deeply they are nested.
 *
 * `pathKey = ${prefix}${groupValue}` is the SYNTHESIZED parent's key, and the
 * composite is what sorts a nested hierarchy into tree order (`L1` <
 * `L1/M03` < `L1/M04` < `L2`). Leaf keys are the data's and are never
 * rewritten here — doing so would dangle author-written `links`, break
 * grandchild `parent` refs, change what `onSelect` reports, and take the
 * canvas off the source key space.
 *
 * @param entries - The data entries to group
 * @param levels - The resolved groupBy levels, outermost first
 * @param makeLeaves - Builds the leaf rows of one fully-grouped subset, given the subset and its path prefix
 * @param pathPrefix - Key prefix for this level's synthesized parents
 * @returns The subtree of every discovered group at this level
 */
export function groupRows(
    entries: ExprType<DictType<StringType, StructType>>,
    levels: PlanResolvedLevel[],
    makeLeaves: (subset: ExprType<DictType<StringType, StructType>>, pathPrefix: SubtypeExprOrValue<StringType>) => PlanRowsValue,
    pathPrefix: SubtypeExprOrValue<StringType>,
): PlanRowsValue {
    if (levels.length === 0) return makeLeaves(entries, pathPrefix);
    const [level, ...rest] = levels;
    const elemType = (Expr.type(entries) as DictType<StringType, StructType>).value;
    const entriesType = DictType(StringType, elemType);
    const levelFn = East.function(
        [StringType, entriesType],
        PlanRowsCollectionType,
        ($, prefix, rows) => {
            const grouped = $.let(
                rows.groupToDicts(
                    (_$, v, k) => level!.by(v, k),
                    (_$, _v, k) => k,
                    (_$, v) => v),
                DictType(StringType, entriesType));
            const subtrees = $.let(
                grouped.map(($2, members, gkey) => {
                    const pathKey = $2.let(East.str`${prefix}${gkey}`, StringType);
                    const children = $2.let(
                        groupRows(members as ExprType<DictType<StringType, StructType>>, rest, makeLeaves, East.str`${pathKey}/`),
                        PlanRowsCollectionType);
                    return level!.parentFn(pathKey, gkey, children);
                }),
                DictType(StringType, PlanRowsCollectionType));
            // The groups merged into ONE collection, in place — the pure
            // `union` would copy the whole B-tree once per group. A level's own
            // groups have distinct path keys by construction, so the policy
            // only ever settles an authored key colliding with a synthesized
            // one: last wins, like every other step.
            return subtrees.reduce(($2, acc, subtree) => {
                $2(acc.unionInPlace(subtree, LAST_WINS));
                return acc;
            }, East.value(new Map(), PlanRowsCollectionType)) as PlanRowsValue;
        },
    );
    return levelFn(pathPrefix, entries) as PlanRowsValue;
}

// ============================================================================
// The per-kind accessor configs (the series builders' surfaces)
// ============================================================================

/**
 * Config for `Plan.series.span` (minus `match`) — accessor-driven span rows
 * with arbitrary-depth rollup grouping.
 *
 * @property label - Gutter label accessor (over the entry's value and key)
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
 * @property prefix - Key prefix for this family's rows (omit ⇒ the source's keys, unchanged)
 * @property rollup - Parent rollup mode (default `"union"`)
 * @property unit - Quantity unit for band sums
 */
export interface PlanSpanOfConfig<R extends StructType> {
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
    runs: PlanAccessor<R, ArrayType<PlanRunType>>;
    /** Per-row decision-diamonds accessor. */
    decisions?: PlanAccessor<R, ArrayType<PlanDecisionMarkType>>;
    /** Per-row ports accessor. */
    ports?: PlanAccessor<R, ArrayType<typeof PlanPortType>>;
    /** Group-key accessors — one span rollup parent per discovered value per level. */
    groupBy?: PlanAccessor<R, StringType>[];
    /** Key prefix for this family's rows — leaf keys and synthesized group
     *  keys alike. Omit (the default) and a leaf's key IS the source's key, so
     *  the canvas stays addressable by the same keys `seek` searches. Supply
     *  one only to keep two families over the SAME source apart; it takes the
     *  family off the source key space, which is the author's call to make. */
    prefix?: string;
    /** Parent rollup mode (default `"union"`; a literal or a `PlanRollupType` expression). */
    rollup?: SubtypeExprOrValue<PlanRollupType> | PlanRollupLiteral;
    /** Quantity unit for band sums (`"t"`). */
    unit?: SubtypeExprOrValue<StringType>;
}

/**
 * One series' per-ENTRY leaf constructor — the entry's value and key in, its
 * 1-row keyed subtree out.
 */
export type PlanLeafFn = (
    $: BlockBuilder<PlanRowsCollectionType>,
    row: ExprType<StructType>,
    key: ExprType<StringType>,
) => SubtypeExprOrValue<PlanRowsCollectionType>;

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

/** The span LEAF constructor — one data ENTRY to its 1-row subtree, keyed by
 *  the entry's own key, the envelope's Option fields injected from the
 *  accessors. */
export function spanLeafOf(cfg: PlanSpanOfConfig<StructType>): PlanLeafFn {
    return (_$, r, k) => applyRowOverrides(
        createSpan({
            key:   prefixedKey(cfg.prefix, k),
            label: cfg.label(r, k),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            runs: cfg.runs(r, k),
            ...(cfg.decisions !== undefined ? { decisions: cfg.decisions(r, k) } : {}),
            ...(cfg.ports !== undefined ? { ports: cfg.ports(r, k) } : {}),
        }),
        {
            ...(cfg.sub !== undefined ? { sub: cfg.sub(r, k) } : {}),
            ...(cfg.value !== undefined ? { value: cfg.value(r, k) } : {}),
            ...(cfg.status !== undefined ? { status: cfg.status(r, k) } : {}),
            ...(cfg.drill !== undefined ? { drill: cfg.drill(r, k) } : {}),
            ...(cfg.expand !== undefined ? { expand: cfg.expand(r, k) } : {}),
        },
    );
}

/**
 * Config for `Plan.series.heat` (minus `match`).
 *
 * @property label - Gutter label accessor (over the entry's value and key)
 * @property id - Render labels as mono row ids
 * @property stacked - Two-line gutter layout (label over sub)
 * @property sub - Gutter sub-line accessor
 * @property value - Gutter value-slot accessor
 * @property status - Per-row status-dot accessor
 * @property cells - Per-row cells accessor (a `PlanHeatCellsType`)
 * @property groupBy - Group-key accessors (aggregated heat parents per level)
 * @property prefix - Key prefix for this family's rows (omit ⇒ the source's keys, unchanged)
 * @property aggregate - Parent aggregation mode (default `"mean"`)
 * @property scale - Heat scale applied to derived parent cells
 */
export interface PlanHeatOfConfig<R extends StructType> {
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
    cells: PlanAccessor<R, PlanHeatCellsType>;
    /** Group-key accessors — one aggregated heat parent per discovered value per level. */
    groupBy?: PlanAccessor<R, StringType>[];
    /** Key prefix for this family's rows — leaf keys and synthesized group
     *  keys alike. Omit (the default) and a leaf's key IS the source's key, so
     *  the canvas stays addressable by the same keys `seek` searches. Supply
     *  one only to keep two families over the SAME source apart; it takes the
     *  family off the source key space, which is the author's call to make. */
    prefix?: string;
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
export function heatLeafOf(cfg: PlanHeatOfConfig<StructType>): PlanLeafFn {
    return (_$, r, k) => applyRowOverrides(
        createHeat({
            key:   prefixedKey(cfg.prefix, k),
            label: cfg.label(r, k),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            cells: cfg.cells(r, k),
        }),
        {
            ...(cfg.sub !== undefined ? { sub: cfg.sub(r, k) } : {}),
            ...(cfg.value !== undefined ? { value: cfg.value(r, k) } : {}),
            ...(cfg.status !== undefined ? { status: cfg.status(r, k) } : {}),
        },
    );
}

/**
 * Config for `Plan.series.table` (minus `match`).
 *
 * @property label - Gutter label accessor (over the entry's value and key)
 * @property id - Render labels as mono row ids
 * @property stacked - Two-line gutter layout (label over sub)
 * @property sub - Gutter sub-line accessor
 * @property cells - Per-row cells accessor (sugar for one unstyled value series)
 * @property series - Per-row multi-series accessor (exclusive with `cells`)
 * @property split - Part layout when several value series render
 * @property emphasis - Row emphasis (`"body"` / `"header"` / `"footer"`)
 * @property groupBy - Group-key accessors (subtotal parents per level)
 * @property prefix - Key prefix for this family's rows (omit ⇒ the source's keys, unchanged)
 * @property aggregate - Subtotal mode (default `"sum"`)
 * @property format - Numeral format for derived subtotals
 */
export interface PlanTableOfConfig<R extends StructType> {
    /** Gutter label accessor. */
    label: PlanAccessor<R, StringType>;
    /** Render labels as mono row ids. */
    id?: boolean;
    /** Two-line gutter layout (label over sub). */
    stacked?: boolean;
    /** Gutter sub-line accessor — returns the field's `Option` (per-row presence). */
    sub?: PlanAccessor<R, OptionType<StringType>>;
    /** Per-row cells accessor (build with `Plan.tableCells`) — sugar for one unstyled value series. */
    cells?: PlanAccessor<R, ArrayType<PlanTableCellType>>;
    /** Per-row MULTI-SERIES accessor (`Array<PlanTableSeriesType>` in the data); exclusive with `cells`. */
    series?: PlanAccessor<R, ArrayType<PlanTableSeriesType>>;
    /** Part layout when several value series render — `"horizontal"` (default) / `"vertical"`. */
    split?: SubtypeExprOrValue<PlanTableSplitType> | PlanTableSplitLiteral;
    /** Row emphasis — `"body"` (default) / `"header"` / `"footer"`. */
    emphasis?: SubtypeExprOrValue<PlanTableEmphasisType> | PlanTableEmphasisLiteral;
    /** Group-key accessors — one subtotal parent per discovered value per level. */
    groupBy?: PlanAccessor<R, StringType>[];
    /** Key prefix for this family's rows — leaf keys and synthesized group
     *  keys alike. Omit (the default) and a leaf's key IS the source's key, so
     *  the canvas stays addressable by the same keys `seek` searches. Supply
     *  one only to keep two families over the SAME source apart; it takes the
     *  family off the source key space, which is the author's call to make. */
    prefix?: string;
    /** Subtotal mode (default `"sum"`; a literal or a `TableAggregateType` expression). */
    aggregate?: SubtypeExprOrValue<TableAggregateType> | TableAggregateLiteral;
    /** Numeral format for the rows' values + derived subtotals — a `Format.*` spec. */
    format?: SubtypeExprOrValue<TickFormatType>;
}

/**
 * The table PARENT kind — a subtotal declaration (header emphasis).
 *
 * @remarks
 * `split` is the family's, not a fixed `horizontal`: a subtotal lays its
 * positions out the way its members do, or a vertical family renders stacked
 * rows under a parent that puts the same two numbers side by side — and, since
 * the row height follows the split, a parent that is one line tall while its
 * members are two.
 */
export function tableParentKind(cfg: PlanTableOfConfig<StructType>): ExprType<PlanRowKindType> {
    return East.value(variant("table", {
        series:    [],
        split:     resolveTag(cfg.split ?? "horizontal", PlanTableSplitType),
        aggregate: some(resolveTag(cfg.aggregate ?? "sum", TableAggregateType)),
        format:    cfg.format !== undefined ? some(East.value(cfg.format, TickFormatType)) : none,
        emphasis:  variant("header", null),
    }), PlanRowKindType);
}

/** The table LEAF constructor. */
export function tableLeafOf(cfg: PlanTableOfConfig<StructType>): PlanLeafFn {
    return (_$, r, k) => applyRowOverrides(
        createTable({
            key:   prefixedKey(cfg.prefix, k),
            label: cfg.label(r, k),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            ...(cfg.cells !== undefined ? { cells: cfg.cells(r, k) } : {}),
            ...(cfg.series !== undefined ? { series: cfg.series(r, k) } : {}),
            ...(cfg.split !== undefined ? { split: cfg.split } : {}),
            ...(cfg.emphasis !== undefined ? { emphasis: cfg.emphasis } : {}),
            ...(cfg.format !== undefined ? { format: cfg.format } : {}),
        }),
        {
            ...(cfg.sub !== undefined ? { sub: cfg.sub(r, k) } : {}),
        },
    );
}
