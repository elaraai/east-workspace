/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plan series (`Plan Data Interface.md` §3.5/§3.5a) — the data-driven row
 * families of a `data` + `series` canvas. Series are REAL EAST VALUES:
 * {@link PlanSeriesType} is a type constructor (the `DataBindHandleType`
 * pattern) instantiated per row type, and every `Plan.series.*` builder
 * reifies its accessors ONCE into the arm's typed `make` function
 * (`Fn(Array<R>) → Array<PlanRowType>` — Table's per-column `valueFn` move)
 * and returns `variant(kind, { make })`. Application is eager expression
 * composition, typed end to end: the inline arm applies each series' `make`
 * to the data expression (Table's `rows_mapped`); the paged arm (P-c) wraps
 * the same `make`s over a `Data.bindPaged` handle's `page` method.
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
    BooleanType,
    FunctionType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { StatusValueType } from "../../feedback/status/types.js";
import { flatMapRowsBlock } from "../../shared/reify.js";
import { TableAggregateType } from "../table/types.js";
import {
    PlanAggregateType,
    type PlanAggregateLiteral,
    PlanDrillType,
    PlanExpandType,
    PlanRowType,
    PlanRowKindType,
    PlanPagedSourceType,
    PlanLaneType,
    PlanBucketEventType,
    PlanCellMarkerType,
    PlanChipType,
    PlanEventMarkType,
    type PlanRowsValue,
} from "./types.js";
import { resolveTag, emptyRows } from "./builders.js";
import { groupParentFn, rootsOf, applyRowOverrides, normalizeRows, type PlanRowsInput, type PlanRowBaseInput } from "./assemble.js";
import {
    createBuckets,
    createCards,
    createEvents,
    createChart,
    createGroup,
    type PlanChartInput,
    type PlanChartLayerInput,
    type PlanChartAxisInput,
    type PlanGroupInput,
} from "./factories.js";
import {
    type PlanAccessor,
    type PlanSpanOfConfig,
    type PlanHeatOfConfig,
    type PlanTableOfConfig,
    type PlanResolvedLevel,
    reifyLevelKey,
    groupRows,
    spanParentKind,
    spanLeafOf,
    heatParentKind,
    heatLeafOf,
    tableParentKind,
    tableLeafOf,
} from "./data-forms.js";

// ============================================================================
// The series type — a constructor, instantiated per row type
// ============================================================================

/**
 * The Plan series type CONSTRUCTOR — given the domain row type it returns
 * the concrete variant type of one series value (the `DataBindHandleType`
 * precedent: the row type lives structurally in each arm's `make`
 * signature, so a series bound to one row type is a compile error against
 * data of another).
 *
 * @remarks
 * Every kind arm carries `make: Fn(Array<R>) → Array<PlanRowType>` — the
 * series' whole pipeline (match filter → per-row construction → groupBy
 * parents) reified once by its builder. The `rows` arm is literal one-off
 * chrome and carries the finished rows directly.
 *
 * @typeParam R - The East row type of the canvas's data source
 * @param r - The row type value
 * @returns The concrete `VariantType` of a series over `r`
 */
const seriesShape = (r: EastType) => VariantType({
    span:    StructType({ make: FunctionType([ArrayType(r)], ArrayType(PlanRowType)) }),
    buckets: StructType({ make: FunctionType([ArrayType(r)], ArrayType(PlanRowType)) }),
    chart:   StructType({ make: FunctionType([ArrayType(r)], ArrayType(PlanRowType)) }),
    heat:    StructType({ make: FunctionType([ArrayType(r)], ArrayType(PlanRowType)) }),
    table:   StructType({ make: FunctionType([ArrayType(r)], ArrayType(PlanRowType)) }),
    cards:   StructType({ make: FunctionType([ArrayType(r)], ArrayType(PlanRowType)) }),
    events:  StructType({ make: FunctionType([ArrayType(r)], ArrayType(PlanRowType)) }),
    group:   StructType({ make: FunctionType([ArrayType(r)], ArrayType(PlanRowType)) }),
    rows:    StructType({ rows: ArrayType(PlanRowType) }),
});

/** The one TS-face series shape (`R` erased to `StructType`). */
type PlanSeriesShape = ReturnType<typeof seriesShape>;

export const PlanSeriesType: (r: EastType) => PlanSeriesShape = seriesShape;

/**
 * One series value — the `BoundValue` alias pattern applied to
 * {@link PlanSeriesType}. The TS face is deliberately ERASED (the
 * `PlanRowsValue` convention): `SubtypeExprOrValue` maps function inputs
 * invariantly, so a row-typed face could never assign through `$.const` /
 * props; type safety lives in the builder CONFIGS (accessors checked
 * against `R`) and in the East runtime (the instantiated type from
 * `PlanSeriesType(rowType)` subtype-checks every stored `make`).
 */
export type PlanSeriesValue = ExprType<PlanSeriesShape>;

/**
 * The `series` prop's input — a TS array of series values (the common
 * static case) or an East expression of the series array (a `$.const`-bound
 * list, a computed list, a dataset-stored list).
 */
export type PlanSeriesInput =
    | PlanSeriesValue[]
    | ExprType<ArrayType<PlanSeriesShape>>;

// ============================================================================
// Series configs — the accessor surfaces
// ============================================================================

/**
 * The row-envelope accessors every kind series shares (the `.of` channel:
 * optional accessors return the envelope fields' `Option` types, so
 * presence is a per-row data fact).
 *
 * @typeParam R - The data row type
 */
export interface PlanSeriesEnvelopeConfig<R extends StructType> {
    /** Row-family membership — omitted ⇒ every data row belongs. */
    match?: (row: ExprType<R>) => SubtypeExprOrValue<BooleanType>;
    /** Row-key accessor. */
    key: PlanAccessor<R, StringType>;
    /** Gutter label accessor. */
    label: PlanAccessor<R, StringType>;
    /** Render labels as mono row ids. */
    id?: boolean;
    /** Two-line gutter layout (label over sub). */
    stacked?: boolean;
    /** Gutter sub-line accessor — returns the field's `Option`. */
    sub?: PlanAccessor<R, OptionType<StringType>>;
    /** Gutter value-slot accessor — returns the field's `Option`. */
    value?: PlanAccessor<R, OptionType<StringType>>;
    /** Per-row status-dot accessor — returns the field's `Option`. */
    status?: PlanAccessor<R, OptionType<StatusValueType>>;
    /** Per-row drill-payload accessor — returns the field's `Option`. */
    drill?: PlanAccessor<R, OptionType<PlanDrillType>>;
    /** Per-row expand-in-place accessor — returns the field's `Option`. */
    expand?: PlanAccessor<R, OptionType<PlanExpandType>>;
}

/** Config for {@link Plan.series.span} — the span `.of` surface plus `match`. */
export interface PlanSpanSeriesConfig<R extends StructType> extends PlanSpanOfConfig<R> {
    /** Row-family membership — omitted ⇒ every data row belongs. */
    match?: (row: ExprType<R>) => SubtypeExprOrValue<BooleanType>;
}

/** Config for {@link Plan.series.heat} — the heat `.of` surface plus `match`. */
export interface PlanHeatSeriesConfig<R extends StructType> extends PlanHeatOfConfig<R> {
    /** Row-family membership — omitted ⇒ every data row belongs. */
    match?: (row: ExprType<R>) => SubtypeExprOrValue<BooleanType>;
}

/** Config for {@link Plan.series.table} — the table `.of` surface plus `match`. */
export interface PlanTableSeriesOfConfig<R extends StructType> extends PlanTableOfConfig<R> {
    /** Row-family membership — omitted ⇒ every data row belongs. */
    match?: (row: ExprType<R>) => SubtypeExprOrValue<BooleanType>;
}

/**
 * Config for {@link Plan.series.buckets} — one bucket row per matched data
 * row, lanes / tiles / markers from accessors.
 */
export interface PlanBucketsSeriesConfig<R extends StructType> extends PlanSeriesEnvelopeConfig<R> {
    /** Per-row sub-slot lanes accessor; omitted ⇒ unbucketed rows. */
    lanes?: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlanLaneType>>;
    /** Per-row tiles accessor. */
    events: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlanBucketEventType>>;
    /** Per-row cell-marker accessor. */
    markers?: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlanCellMarkerType>>;
}

/** Config for {@link Plan.series.cards} — one cards row per matched data row. */
export interface PlanCardsSeriesConfig<R extends StructType> extends PlanSeriesEnvelopeConfig<R> {
    /** Per-row shift-chips accessor. */
    chips: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlanChipType>>;
}

/** Config for {@link Plan.series.events} — one event row per matched data row. */
export interface PlanEventsSeriesConfig<R extends StructType> extends PlanSeriesEnvelopeConfig<R> {
    /** Per-row instant-marks accessor. */
    marks: (row: ExprType<R>) => SubtypeExprOrValue<ArrayType<PlanEventMarkType>>;
}

/**
 * Config for {@link Plan.series.chart} — one chart row per matched data
 * row, layers built from the row's own data via the accessor.
 */
export interface PlanChartSeriesConfig<R extends StructType> extends PlanSeriesEnvelopeConfig<R> {
    /** Per-row pinned accessor (`true` ⇒ above the virtualised body). */
    pinned?: PlanAccessor<R, BooleanType>;
    /** Per-row Chart layers accessor (`Chart.*` builders, bare or `Plan.layer`-wrapped). */
    layers: (row: ExprType<R>) => PlanChartLayerInput | PlanChartLayerInput[];
    /** The left y-axis declaration (shared by the family's rows). */
    left?: PlanChartAxisInput;
    /** The right y-axis declaration. */
    right?: PlanChartAxisInput;
    /** Height mode — `"spark"` (default) / `"expanded"` / `Plan.fixed(px)`. */
    height?: PlanChartInput["height"];
    /** Height the EXPANDED state opens to (CSS px). */
    expandedHeight?: SubtypeExprOrValue<StringType>;
    /** Spark ↔ expanded toggle (caret). */
    expandable?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Gutter legend chips (shared by the family's rows). */
    swatches?: PlanRowBaseInput["swatches"];
}

/** Chrome for {@link Plan.series.group}'s STATIC form — the group factory's input minus nested rows. */
export type PlanGroupSeriesChrome = Omit<PlanGroupInput, "rows">;

/**
 * Config for {@link Plan.series.group}'s DISCOVERED form — one group strip
 * per distinct `by` value (first-appearance data order), the child series
 * applied to each group's member rows and re-parented beneath its strip.
 *
 * @property match - Strip membership (omitted ⇒ every data row)
 * @property by - The group-key accessor
 * @property collapsed - Strips start collapsed
 * @property summaryAggregate - DECLARED strip aggregation over descendant heat rows
 */
export interface PlanGroupSeriesByConfig<R extends StructType> {
    /** Strip membership (omitted ⇒ every data row). */
    match?: (row: ExprType<R>) => SubtypeExprOrValue<BooleanType>;
    /** The group-key accessor — one strip per discovered value. */
    by: PlanAccessor<R, StringType>;
    /** Strips start collapsed. */
    collapsed?: boolean;
    /** DECLARED strip aggregation over descendant heat rows — `"mean"`/`"max"`/`"sum"` or a `PlanAggregateType` expression. */
    summaryAggregate?: SubtypeExprOrValue<PlanAggregateType> | PlanAggregateLiteral;
}

// ============================================================================
// Internal helpers
// ============================================================================

/** Pin one arm value against the instantiated series type. */
function seriesValue<R extends StructType>(
    rowType: R,
    tag: string,
    payload: object,
): PlanSeriesValue {
    return East.value(
        variant(tag, payload) as unknown as SubtypeExprOrValue<PlanSeriesShape>,
        PlanSeriesType(rowType),
    ) as PlanSeriesValue;
}

/** Filter the rows param by the reified match predicate (all rows when omitted). */
function matchedRows(
    rows: ExprType<ArrayType<StructType>>,
    rowType: StructType,
    match: ((row: ExprType<StructType>) => SubtypeExprOrValue<BooleanType>) | undefined,
): ExprType<ArrayType<StructType>> {
    if (match === undefined) return rows;
    const pred = East.function([rowType], BooleanType, (_$, r) => match(r));
    return rows.filter((_$, r) => pred(r)) as ExprType<ArrayType<StructType>>;
}

/** The envelope's accessor-supplied Option fields for one data row. */
function envelopeOverrides(cfg: PlanSeriesEnvelopeConfig<StructType>, r: ExprType<StructType>) {
    return {
        ...(cfg.sub !== undefined ? { sub: cfg.sub(r) } : {}),
        ...(cfg.value !== undefined ? { value: cfg.value(r) } : {}),
        ...(cfg.status !== undefined ? { status: cfg.status(r) } : {}),
        ...(cfg.drill !== undefined ? { drill: cfg.drill(r) } : {}),
        ...(cfg.expand !== undefined ? { expand: cfg.expand(r) } : {}),
    };
}

/**
 * The shared scaffolding for ONE series' `make` — the `series.ts` twin of
 * `data-forms.ts`'s `ofScaffold`: match filter → optional groupBy levels →
 * leaf rows, inside that single series' own reified function. NOT a
 * canvas-level compiler — the canvas never composes series into one
 * function; `applySeries` calls each series' `make` in declared order.
 */
function seriesScaffold(
    rowType: StructType,
    match: ((row: ExprType<StructType>) => SubtypeExprOrValue<BooleanType>) | undefined,
    groupBy: PlanAccessor<StructType, StringType>[] | undefined,
    parentFn: (() => PlanResolvedLevel["parentFn"]) | undefined,
    leaf: ($: BlockBuilder<ArrayType<PlanRowType>>, row: ExprType<StructType>) => SubtypeExprOrValue<ArrayType<PlanRowType>>,
): ExprType<FunctionType<[ArrayType<StructType>], ArrayType<PlanRowType>>> {
    return East.function([ArrayType(rowType)], ArrayType(PlanRowType), ($, rows) => {
        const matched = $.let(matchedRows(rows, rowType, match), ArrayType(rowType));
        if (groupBy === undefined || groupBy.length === 0 || parentFn === undefined) {
            return flatMapRowsBlock(matched, PlanRowType, leaf);
        }
        // Every level shares ONE parent constructor (the ofScaffold shape).
        const shared = parentFn();
        const levels: PlanResolvedLevel[] = groupBy.map((by) => ({
            by: reifyLevelKey(rowType, by),
            parentFn: shared,
        }));
        return groupRows(matched, levels, (subset) => flatMapRowsBlock(subset, PlanRowType, leaf), "");
    }) as ExprType<FunctionType<[ArrayType<StructType>], ArrayType<PlanRowType>>>;
}

/** Apply one series value to a rows expression (the exhaustive-arm call). */
export function applySeriesValue(
    s: PlanSeriesValue,
    rows: ExprType<ArrayType<StructType>>,
): PlanRowsValue {
    return s.match({
        span:    (_$, v) => v.make(rows),
        buckets: (_$, v) => v.make(rows),
        chart:   (_$, v) => v.make(rows),
        heat:    (_$, v) => v.make(rows),
        table:   (_$, v) => v.make(rows),
        cards:   (_$, v) => v.make(rows),
        events:  (_$, v) => v.make(rows),
        group:   (_$, v) => v.make(rows),
        rows:    (_$, v) => v.rows,
    }) as PlanRowsValue;
}

/**
 * Apply the `series` input to the data expression — the inline arm's
 * application (Table's `rows_mapped`, per family). A TS array applies each
 * value in declared order; an East expression folds at evaluation, so
 * `$.const`-bound and computed series lists work identically.
 */
export function applySeries(
    series: PlanSeriesInput,
    data: ExprType<ArrayType<StructType>>,
): PlanRowsValue {
    if (Array.isArray(series)) {
        return series.reduce<PlanRowsValue>(
            (acc, s) => acc.concat(applySeriesValue(s, data)) as PlanRowsValue,
            emptyRows(),
        );
    }
    const list = series;
    return list.reduce(
        (_$, acc, s) => acc.concat(applySeriesValue(s as PlanSeriesValue, data)),
        emptyRows(),
    ) as PlanRowsValue;
}

// ============================================================================
// Builders — Plan.series.*
// ============================================================================

/**
 * A data-driven span family — one span row per matched data row, grouped
 * to arbitrary depth with rollup parents (the span `.of` surface + `match`).
 *
 * @typeParam R - The data row type
 * @param rowType - The data row type (every builder takes it first — the `Slice.config` shape)
 * @param config - The accessors + grouping ({@link PlanSpanSeriesConfig})
 * @returns A series value (`variant("span", { make })`)
 */
export function createSeriesSpan<R extends StructType>(rowType: R, config: PlanSpanSeriesConfig<R>): PlanSeriesValue {
    const cfg = config as PlanSpanSeriesConfig<StructType>;
    const make = seriesScaffold(rowType, cfg.match, cfg.groupBy, () => groupParentFn(spanParentKind(cfg)), spanLeafOf(cfg));
    return seriesValue(rowType, "span", { make });
}

/**
 * A data-driven heat family — one heat row per matched data row, grouped
 * with per-bucket-aggregated parents (the heat `.of` surface + `match`).
 *
 * @typeParam R - The data row type
 * @param rowType - The data row type
 * @param config - The accessors + grouping ({@link PlanHeatSeriesConfig})
 * @returns A series value (`variant("heat", { make })`)
 */
export function createSeriesHeat<R extends StructType>(rowType: R, config: PlanHeatSeriesConfig<R>): PlanSeriesValue {
    const cfg = config as PlanHeatSeriesConfig<StructType>;
    const mode = cfg.aggregate ?? "mean";
    const make = seriesScaffold(rowType, cfg.match, cfg.groupBy,
        () => groupParentFn(heatParentKind(cfg), () => some(resolveTag(mode, PlanAggregateType).getTag())),
        heatLeafOf(cfg));
    return seriesValue(rowType, "heat", { make });
}

/**
 * A data-driven table family — one table row per matched data row, grouped
 * with subtotal parents (the table `.of` surface + `match`).
 *
 * @typeParam R - The data row type
 * @param rowType - The data row type
 * @param config - The accessors + grouping ({@link PlanTableSeriesOfConfig})
 * @returns A series value (`variant("table", { make })`)
 */
export function createSeriesTable<R extends StructType>(rowType: R, config: PlanTableSeriesOfConfig<R>): PlanSeriesValue {
    const cfg = config as PlanTableSeriesOfConfig<StructType>;
    const mode = cfg.aggregate ?? "sum";
    const make = seriesScaffold(rowType, cfg.match, cfg.groupBy,
        () => groupParentFn(tableParentKind(cfg), () => some(resolveTag(mode, TableAggregateType).getTag())),
        tableLeafOf(cfg));
    return seriesValue(rowType, "table", { make });
}

/**
 * A data-driven bucket family — one bucket row (the Planner surface) per
 * matched data row.
 *
 * @typeParam R - The data row type
 * @param rowType - The data row type
 * @param config - The accessors ({@link PlanBucketsSeriesConfig})
 * @returns A series value (`variant("buckets", { make })`)
 */
export function createSeriesBuckets<R extends StructType>(rowType: R, config: PlanBucketsSeriesConfig<R>): PlanSeriesValue {
    const cfg = config as PlanBucketsSeriesConfig<StructType>;
    const make = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r) => applyRowOverrides(
        createBuckets({
            key:   cfg.key(r),
            label: cfg.label(r),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            ...(cfg.lanes !== undefined ? { lanes: cfg.lanes(r) } : {}),
            events: cfg.events(r),
            ...(cfg.markers !== undefined ? { markers: cfg.markers(r) } : {}),
        }),
        envelopeOverrides(cfg, r),
    ));
    return seriesValue(rowType, "buckets", { make });
}

/**
 * A data-driven cards family — one cards row (Roster chips) per matched
 * data row.
 *
 * @typeParam R - The data row type
 * @param rowType - The data row type
 * @param config - The accessors ({@link PlanCardsSeriesConfig})
 * @returns A series value (`variant("cards", { make })`)
 */
export function createSeriesCards<R extends StructType>(rowType: R, config: PlanCardsSeriesConfig<R>): PlanSeriesValue {
    const cfg = config as PlanCardsSeriesConfig<StructType>;
    const make = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r) => applyRowOverrides(
        createCards({
            key:   cfg.key(r),
            label: cfg.label(r),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            chips: cfg.chips(r),
        }),
        envelopeOverrides(cfg, r),
    ));
    return seriesValue(rowType, "cards", { make });
}

/**
 * A data-driven event family — one instant-mark row per matched data row.
 *
 * @typeParam R - The data row type
 * @param rowType - The data row type
 * @param config - The accessors ({@link PlanEventsSeriesConfig})
 * @returns A series value (`variant("events", { make })`)
 */
export function createSeriesEvents<R extends StructType>(rowType: R, config: PlanEventsSeriesConfig<R>): PlanSeriesValue {
    const cfg = config as PlanEventsSeriesConfig<StructType>;
    const make = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r) => applyRowOverrides(
        createEvents({
            key:   cfg.key(r),
            label: cfg.label(r),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            marks: cfg.marks(r),
        }),
        envelopeOverrides(cfg, r),
    ));
    return seriesValue(rowType, "events", { make });
}

/**
 * A data-driven chart family — one chart row per matched data row, layers
 * built from the row's own data.
 *
 * @typeParam R - The data row type
 * @param rowType - The data row type
 * @param config - The accessors + shared axes ({@link PlanChartSeriesConfig})
 * @returns A series value (`variant("chart", { make })`)
 */
export function createSeriesChart<R extends StructType>(rowType: R, config: PlanChartSeriesConfig<R>): PlanSeriesValue {
    const cfg = config as PlanChartSeriesConfig<StructType>;
    const make = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r) => applyRowOverrides(
        createChart({
            key:   cfg.key(r),
            label: cfg.label(r),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            layers: cfg.layers(r),
            ...(cfg.left !== undefined ? { left: cfg.left } : {}),
            ...(cfg.right !== undefined ? { right: cfg.right } : {}),
            ...(cfg.height !== undefined ? { height: cfg.height } : {}),
            ...(cfg.expandedHeight !== undefined ? { expandedHeight: cfg.expandedHeight } : {}),
            ...(cfg.expandable !== undefined ? { expandable: cfg.expandable } : {}),
            ...(cfg.swatches !== undefined ? { swatches: cfg.swatches } : {}),
        }),
        {
            ...envelopeOverrides(cfg, r),
            ...(cfg.pinned !== undefined ? { pinned: some(cfg.pinned(r)) } : {}),
        },
    ));
    return seriesValue(rowType, "chart", { make });
}

/**
 * A group strip AROUND child series — the chrome is literal, the members
 * are the children applied to the same data and re-parented beneath it.
 *
 * @typeParam R - The data row type
 * @param rowType - The data row type
 * @param chrome - The group's literal chrome ({@link PlanGroupSeriesChrome})
 * @param children - The member series, in canvas order
 * @returns A series value (`variant("group", { make })`)
 */
export function createSeriesGroup<R extends StructType>(
    rowType: R,
    chromeOrBy: PlanGroupSeriesChrome | PlanGroupSeriesByConfig<R>,
    children: PlanSeriesValue[],
): PlanSeriesValue {
    const applyChildren = (subset: ExprType<ArrayType<StructType>>): PlanRowsValue =>
        children.reduce<PlanRowsValue>(
            (acc, c) => acc.concat(applySeriesValue(c, subset)) as PlanRowsValue,
            emptyRows(),
        );
    if ("by" in chromeOrBy && typeof chromeOrBy.by === "function") {
        // DISCOVERED strips — one group per distinct key, mirroring the
        // grouped data form: the strip DECLARES its summary aggregation and
        // wears the member-count meta; children apply to each group's rows.
        const cfg = chromeOrBy as PlanGroupSeriesByConfig<StructType>;
        const kind = East.value(variant("group", {
            summary:          none,
            summaryAggregate: cfg.summaryAggregate !== undefined
                ? some(resolveTag(cfg.summaryAggregate, PlanAggregateType))
                : none,
            collapsed:        cfg.collapsed !== undefined ? some(cfg.collapsed) : none,
        }), PlanRowKindType);
        const parentFn = groupParentFn(kind, ($, kids) => {
            const roots = $.let(rootsOf(kids as PlanRowsValue), ArrayType(PlanRowType));
            return some(East.str`${roots.length()} rs`);
        });
        const rt: StructType = rowType;
        const make = East.function([ArrayType(rt)], ArrayType(PlanRowType), ($, rows) => {
            const matched = $.let(matchedRows(rows, rt, cfg.match), ArrayType(rt));
            const levels: PlanResolvedLevel[] = [{ by: reifyLevelKey(rt, cfg.by), parentFn }];
            return groupRows(matched, levels, applyChildren, "");
        });
        return seriesValue(rowType, "group", { make });
    }
    // STATIC chrome — one literal strip around the children.
    const chrome = chromeOrBy as PlanGroupSeriesChrome;
    const make = East.function([ArrayType(rowType)], ArrayType(PlanRowType), (_$, rows) => {
        return createGroup({ ...(chrome as PlanGroupInput), rows: applyChildren(rows as unknown as ExprType<ArrayType<StructType>>) });
    });
    return seriesValue(rowType, "group", { make });
}

/**
 * Literal one-off chrome rows riding in canvas order between data-driven
 * families (a pinned KPI chart, a hand-built section) — the finished rows
 * carried directly, no data dependence.
 *
 * @typeParam R - The data row type (pins the series against its siblings)
 * @param rowType - The data row type
 * @param rows - The literal rows (kind-factory results)
 * @returns A series value (`variant("rows", { rows })`)
 */
export function createSeriesRows<R extends StructType>(rowType: R, rows: PlanRowsInput): PlanSeriesValue {
    return seriesValue(rowType, "rows", { rows: normalizeRows(rows) });
}

/**
 * Recover the row type of a data expression (the Table `Expr.type` idiom).
 */
export function seriesRowType(data: ExprType<ArrayType<StructType>>): StructType {
    return (Expr.type(data) as ArrayType<StructType>).value;
}

/**
 * The loose TS face a bound paged handle presents to the `data` prop —
 * structural only (`page` / `total` properties, which concrete handle
 * `StructExpr`s expose and array expressions don't); the factory's
 * `Expr.type` dispatch is the real check.
 */
export interface PlanPagedHandleLike {
    /** The handle's page method (typed precisely on the concrete handle). */
    readonly page: unknown;
    /** The handle's total method. */
    readonly total: unknown;
}

/** The loose TS face of an author's paged handle (`page` / `total` fields). */
type PagedHandleExpr = ExprType<StructType<{
    page: FunctionType<[IntegerType, IntegerType], OptionType<ArrayType<StructType>>>;
    total: FunctionType<[], OptionType<IntegerType>>;
}>>;

/**
 * Derive the CANVAS-ROW paged source from an author's paged handle
 * (`Data.bindPaged(ops)` — or any structurally matching handle): `page` is
 * the handle's page wrapped with the series' `make`s (each window's typed
 * domain rows become canvas rows client-side), `total` passes through.
 * The single place the domain row type is erased.
 *
 * @param handle - The author's paged handle expression
 * @param series - The canvas's series
 * @returns A `PlanPagedSourceType` value for the root's `source` arm
 */
export function derivePagedSource(
    handle: ExprType<StructType>,
    series: PlanSeriesInput,
): ExprType<PlanPagedSourceType> {
    const h = handle as unknown as PagedHandleExpr;
    const page = East.function([IntegerType, IntegerType], OptionType(ArrayType(PlanRowType)), ($, offset, limit) => {
        const noWin = $.const(none, OptionType(ArrayType(PlanRowType)));
        const win = $.let(h.page(offset, limit));
        return win.match({
            some: ($2, rows) => {
                const built = $2.let(applySeries(series, rows as ExprType<ArrayType<StructType>>), ArrayType(PlanRowType));
                return East.value(some(built), OptionType(ArrayType(PlanRowType)));
            },
            none: (_$2) => noWin,
        });
    });
    return East.value({ page, total: h.total }, PlanPagedSourceType);
}
