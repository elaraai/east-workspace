/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Data-driven row forms — `Plan.rows` (per-element constructor + the grouped
 * form) and the accessor `.of` factories (`span.of` / `heat.of` / `table.of`):
 * the Table #317 vocabulary on the shared time axis. Structure (groupBy
 * levels) is host config; every per-row value flows through accessors as
 * expressions, optional ones returning the fields' `Option` types.
 *
 * @packageDocumentation
 */

import {
    type BlockBuilder,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    type TypeOf,
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
import { flatMapRowsBlock } from "../../shared/reify.js";
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
} from "./types.js";
import {
    PlanExpandType,
    PlanRunType,
    PlanDecisionMarkType,
    PlanRowKindType,
    PlanRowType,
    type PlanRowsValue,
} from "./ir.js";
import { createHeatCells, resolveTag, type PlanHeatCellsOptions } from "./builders.js";
import { PlanPortType } from "./types.js";
import { rootsOf, applyRowOverrides, groupParentFn, type PlanGroupParentFn } from "./assemble.js";
import { createSpan, createHeat, createTable } from "./factories.js";

// ============================================================================
// Data-driven forms — Plan.rows + the `.of` accessor factories
// ============================================================================

// Infer the row struct type R from the data argument, mirroring Table / Gantt.
/** Element struct type of a rows input (see the Table / Gantt factories). */
export type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

/** An accessor over a data row. */
export type PlanAccessor<R extends StructType, T extends EastType> = (row: ExprType<R>) => SubtypeExprOrValue<T>;

/** A `Plan.rows` groupBy level — an accessor or the Table #317 `{ by }` config. */
export type PlanGroupByLevel<R extends StructType> =
    | PlanAccessor<R, StringType>
    | { by: PlanAccessor<R, StringType>; collapsed?: boolean };

/** Normalize a groupBy level to its config form. */
function levelConfig<R extends StructType>(level: PlanGroupByLevel<R>): { by: PlanAccessor<R, StringType>; collapsed?: boolean } {
    return typeof level === "function" ? { by: level } : level;
}

/**
 * The grouped form of {@link Plan.rows} — heterogeneous canvas grouping into
 * `Plan.group` strips.
 *
 * @property groupBy - The group levels (string accessors or `{ by, collapsed }`)
 * @property summaryAggregate - DECLARED strip aggregation over descendant heat rows
 * @property row - The per-element row constructor (any kind factory)
 */
export interface PlanRowsGroupConfig<R extends StructType> {
    /** The group levels (string accessors or `{ by, collapsed }`). */
    groupBy: PlanGroupByLevel<R>[];
    /** DECLARED strip aggregation over descendant heat rows — `"mean"`/`"max"`/`"sum"` or a `PlanAggregateType` expression. */
    summaryAggregate?: SubtypeExprOrValue<PlanAggregateType> | PlanAggregateLiteral;
    /** The per-element row constructor (any kind factory / nested `Plan.rows`). */
    row: ($: BlockBuilder<ArrayType<PlanRowType>>, row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlanRowType>>;
}

/** One resolved groupBy level — the reified key accessor + the level's parent constructor. */
interface PlanResolvedLevel {
    /** The reified group-key accessor (an East function call per row). */
    by: (row: ExprType<StructType>) => ExprType<StringType>;
    /** The level's shared parent constructor (see {@link groupParentFn}). */
    parentFn: PlanGroupParentFn;
}

/** Reify a level's key accessor once (fixed `String` output — no inference). */
function reifyLevelKey(rowType: StructType, by: PlanAccessor<StructType, StringType>): PlanResolvedLevel["by"] {
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
function groupRows(
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

/**
 * Data-driven row construction — the per-element form: reify a subtree
 * constructor (any kind factory) over the data, flattened.
 *
 * @param data - The data rows (plain array or East expression)
 * @param fn - The per-element subtree constructor
 * @returns The flattened subtree
 */
export function createRows<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    fn: ($: BlockBuilder<ArrayType<PlanRowType>>, row: ExprType<RowElement<T>>) => SubtypeExprOrValue<ArrayType<PlanRowType>>,
): PlanRowsValue;
/**
 * Data-driven row construction — the grouped form: one `Plan.group` strip per
 * discovered group value (arbitrary depth), members re-parented beneath it,
 * strip summaries DECLARED for the renderer to derive over descendant heat
 * rows.
 *
 * @param data - The data rows (plain array or East expression)
 * @param config - The grouped config ({@link PlanRowsGroupConfig})
 * @returns The flattened subtree
 */
export function createRows<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    config: PlanRowsGroupConfig<RowElement<T>>,
): PlanRowsValue;
export function createRows<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    fnOrConfig:
        | (($: BlockBuilder<ArrayType<PlanRowType>>, row: ExprType<RowElement<T>>) => SubtypeExprOrValue<ArrayType<PlanRowType>>)
        | PlanRowsGroupConfig<RowElement<T>>,
): PlanRowsValue {
    // One boundary erasure of the row generic (the Table `East.value(data)` +
    // `Expr.type` idiom — table/index.ts).
    const arr = East.value(data) as ExprType<ArrayType<StructType>>;
    const rowType = (Expr.type(arr) as ArrayType<StructType>).value;
    if (typeof fnOrConfig === "function") {
        return flatMapRowsBlock(arr, PlanRowType, fnOrConfig as PlanRowsGroupConfig<StructType>["row"]);
    }
    const cfg = fnOrConfig as PlanRowsGroupConfig<StructType>;
    const levels = cfg.groupBy.map(l => {
        const c = levelConfig(l);
        // The strip DECLARES its summary aggregation; the renderer derives
        // the cells over descendant heat rows.
        const kind = East.value(variant("group", {
            summary:          none,
            summaryAggregate: cfg.summaryAggregate !== undefined
                ? some(resolveTag(cfg.summaryAggregate, PlanAggregateType))
                : none,
            collapsed:        c.collapsed !== undefined ? some(c.collapsed) : none,
        }), PlanRowKindType);
        return {
            by: reifyLevelKey(rowType, c.by),
            parentFn: groupParentFn(kind, ($, children) => {
                const roots = $.let(rootsOf(children as PlanRowsValue), ArrayType(PlanRowType));
                return some(East.str`${roots.length()} rs`);
            }),
        };
    });
    return groupRows(arr, levels, subset => flatMapRowsBlock(subset, PlanRowType, cfg.row), "");
}

/**
 * Config for {@link Plan.span}'s `.of` form — accessor-driven span rows with
 * arbitrary-depth grouping.
 *
 * @property key - Row-key accessor
 * @property label - Gutter label accessor
 * @property id - Render labels as mono row ids
 * @property sub - Gutter sub-line accessor
 * @property value - Gutter value-slot accessor
 * @property status - Per-row status-dot accessor (an `Option<StatusValueType>`)
 * @property drill - Per-row drill-payload accessor (an `Option<PlanDrillType>`)
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
    /** Gutter sub-line accessor — returns the field's `Option` (per-row presence). */
    sub?: PlanAccessor<R, OptionType<StringType>>;
    /** Gutter value-slot accessor — returns the field's `Option`. */
    value?: PlanAccessor<R, OptionType<StringType>>;
    /** Per-row status-dot accessor — returns the field's `Option`. */
    status?: PlanAccessor<R, OptionType<StatusValueType>>;
    /** Per-row drill-payload accessor — returns the field's `Option` (build values with `Plan.drill`). */
    drill?: PlanAccessor<R, OptionType<PlanDrillType>>;
    /** Per-row expand-in-place accessor — returns the field's `Option<PlanExpandType>` (R2). */
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

/** Shared scaffolding for the `.of` factories — every level shares one parent constructor. */
function ofScaffold<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    groupBy: PlanAccessor<RowElement<T>, StringType>[] | undefined,
    leaf: ($: BlockBuilder<ArrayType<PlanRowType>>, row: ExprType<StructType>) => SubtypeExprOrValue<ArrayType<PlanRowType>>,
    parentFn: PlanGroupParentFn,
): PlanRowsValue {
    // The same one boundary erasure as `createRows`.
    const arr = East.value(data) as ExprType<ArrayType<StructType>>;
    const rowType = (Expr.type(arr) as ArrayType<StructType>).value;
    const levels = (groupBy ?? []).map(by => ({
        by: reifyLevelKey(rowType, by as PlanAccessor<StructType, StringType>),
        parentFn,
    }));
    return groupRows(arr, levels, subset => flatMapRowsBlock(subset, PlanRowType, leaf), "");
}

/**
 * The `.of` form of {@link Plan.span} — accessor-driven span rows, grouped
 * to arbitrary depth with span-rollup parents (the parents DECLARE their
 * rollup + unit; the renderer derives the bands).
 *
 * @param data - The data rows
 * @param config - The accessors + grouping ({@link PlanSpanOfConfig})
 * @returns The flattened subtree
 */
export function createSpanOf<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    config: PlanSpanOfConfig<RowElement<T>>,
): PlanRowsValue {
    const cfg = config as PlanSpanOfConfig<StructType>;
    const parentKind = East.value(variant("span", {
        runs:      [],
        decisions: [],
        ports:     [],
        rollup:    some(resolveTag(cfg.rollup ?? "union", PlanRollupType)),
        unit:      cfg.unit !== undefined ? some(cfg.unit) : none,
    }), PlanRowKindType);
    return ofScaffold(
        data,
        config.groupBy,
        // The envelope's Option fields come from the ACCESSORS (the expression
        // channel — per-row presence), injected over the assembled row.
        (_$, r) => applyRowOverrides(
            createSpan({
                key:   cfg.key(r),
                label: cfg.label(r),
                ...(cfg.id !== undefined ? { id: cfg.id } : {}),
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
        ),
        groupParentFn(parentKind),
    );
}

/**
 * Config for {@link Plan.heat}'s `.of` form.
 *
 * @property key - Row-key accessor
 * @property label - Gutter label accessor
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

/**
 * The `.of` form of {@link Plan.heat} — accessor-driven heat rows, grouped
 * with per-bucket-aggregated parents (the parents DECLARE their aggregation;
 * the renderer derives the cells).
 *
 * @param data - The data rows
 * @param config - The accessors + grouping ({@link PlanHeatOfConfig})
 * @returns The flattened subtree
 */
export function createHeatOf<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    config: PlanHeatOfConfig<RowElement<T>>,
): PlanRowsValue {
    const cfg = config as PlanHeatOfConfig<StructType>;
    const mode = cfg.aggregate ?? "mean";
    // The parent DECLARES its aggregation; empty cells carry the scale and
    // the renderer derives the per-bucket values.
    const parentKind = East.value(variant("heat", {
        cells:     createHeatCells([], cfg.scale),
        aggregate: some(resolveTag(mode, PlanAggregateType)),
    }), PlanRowKindType);
    return ofScaffold(
        data,
        config.groupBy,
        // Envelope Option fields come from the accessors (per-row presence).
        (_$, r) => applyRowOverrides(
            createHeat({
                key:   cfg.key(r),
                label: cfg.label(r),
                cells: cfg.cells(r),
            }),
            {
                ...(cfg.sub !== undefined ? { sub: cfg.sub(r) } : {}),
                ...(cfg.value !== undefined ? { value: cfg.value(r) } : {}),
                ...(cfg.status !== undefined ? { status: cfg.status(r) } : {}),
            },
        ),
        // The gutter meta prints the mode's tag (works for expressions too).
        groupParentFn(parentKind, () => some(resolveTag(mode, PlanAggregateType).getTag())),
    );
}

/**
 * Config for {@link Plan.table}'s `.of` form.
 *
 * @property key - Row-key accessor
 * @property label - Gutter label accessor
 * @property cells - Per-row cells accessor (a `Plan.tableCells` result)
 * @property groupBy - Group-key accessors (subtotal parents per level)
 * @property aggregate - Subtotal mode (default `"sum"`)
 * @property format - Numeral format for derived subtotals
 */
export interface PlanTableOfConfig<R extends StructType> {
    /** Row-key accessor. */
    key: PlanAccessor<R, StringType>;
    /** Gutter label accessor. */
    label: PlanAccessor<R, StringType>;
    /** Per-row cells accessor (build with `Plan.tableCells`). */
    cells: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlanTableCellType>>;
    /** Group-key accessors — one subtotal parent per discovered value per level. */
    groupBy?: PlanAccessor<R, StringType>[];
    /** Subtotal mode (default `"sum"`; a literal or a `TableAggregateType` expression). */
    aggregate?: SubtypeExprOrValue<TableAggregateType> | TableAggregateLiteral;
    /** Numeral format for the rows' values + derived subtotals — a `Format.*` spec. */
    format?: SubtypeExprOrValue<TickFormatType>;
}

/**
 * The `.of` form of {@link Plan.table} — accessor-driven table rows with
 * arbitrary-depth `groupBy` subtotal parents (the parents DECLARE their
 * subtotal mode + format; the renderer derives the cells — the Table #317
 * vocabulary).
 *
 * @param data - The data rows
 * @param config - The accessors + grouping ({@link PlanTableOfConfig})
 * @returns The flattened subtree
 */
export function createTableOf<T extends SubtypeExprOrValue<ArrayType<StructType>>>(
    data: T,
    config: PlanTableOfConfig<RowElement<T>>,
): PlanRowsValue {
    const cfg = config as PlanTableOfConfig<StructType>;
    const mode = cfg.aggregate ?? "sum";
    const parentKind = East.value(variant("table", {
        cells:     [],
        aggregate: some(resolveTag(mode, TableAggregateType)),
        format:    cfg.format !== undefined ? some(East.value(cfg.format, TickFormatType)) : none,
        emphasis:  variant("header", null),
    }), PlanRowKindType);
    return ofScaffold(
        data,
        config.groupBy,
        (_$, r) => createTable({
            key:   cfg.key(r),
            label: cfg.label(r),
            cells: cfg.cells(r),
            ...(cfg.format !== undefined ? { format: cfg.format } : {}),
        }),
        // The gutter meta prints the mode's tag (works for expressions too).
        groupParentFn(parentKind, () => some(resolveTag(mode, TableAggregateType).getTag())),
    );
}
