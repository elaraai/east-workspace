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
 * (`Fn(Dict<String, R>) → Dict<String, PlanRow>` — Table's per-column `valueFn` move)
 * and returns `variant(kind, { make })`. Application is eager expression
 * composition, typed end to end: the inline arm applies each series' `make`
 * to the data expression (Table's `rows_mapped`); the paged arm (P-c) wraps
 * the same `make`s over a `Data.bindPaged` handle's `page` method.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    Expr,
    ArrayType,
    BooleanType,
    DictType,
    FunctionType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { StatusValueType } from "../../feedback/status/types.js";
import { ApprovalStateType } from "../../contracts/approval.js";
import { foldEntriesToDict } from "../../shared/reify.js";
import { TableAggregateType } from "../table/types.js";
import {
    PlanAggregateType,
    type PlanAggregateLiteral,
    PlanExpandType,
    PlanRowKindType,
    PlanLaneType,
    PlanBucketEventType,
    PlanCellMarkerType,
    PlanChipType,
    PlanEventMarkType,
    PlanRowsCollectionType,
    type PlanRowsValue,
} from "./types.js";
import { resolveTag, emptyRows } from "./builders.js";
import { groupParentFn, applyRowOverrides, normalizeRows, LAST_WINS, type PlanRowsInput, type PlanRowBaseInput } from "./assemble.js";
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
    type PlanLeafFn,
    prefixedKey,
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
 * Every kind arm carries `make: Fn(Dict<String, R>) → Dict<String, PlanRow>` — the
 * series' whole pipeline (match filter → per-entry construction → groupBy
 * parents) reified once by its builder, taking the source's KEYED collection
 * and producing the canvas's. A leaf row's key is the source entry's key, so
 * the canvas is addressable by the keys the source is searched by (#568). The `rows` arm is literal one-off chrome and carries the
 * finished rows directly.
 *
 * @typeParam R - The East row type of the canvas's data source
 * @param r - The row type value
 * @returns The concrete `VariantType` of a series over `r`
 */
const seriesShape = (r: EastType) => VariantType({
    span:    StructType({ make: FunctionType([DictType(StringType, r)], PlanRowsCollectionType) }),
    buckets: StructType({ make: FunctionType([DictType(StringType, r)], PlanRowsCollectionType) }),
    chart:   StructType({ make: FunctionType([DictType(StringType, r)], PlanRowsCollectionType) }),
    heat:    StructType({ make: FunctionType([DictType(StringType, r)], PlanRowsCollectionType) }),
    table:   StructType({ make: FunctionType([DictType(StringType, r)], PlanRowsCollectionType) }),
    cards:   StructType({ make: FunctionType([DictType(StringType, r)], PlanRowsCollectionType) }),
    events:  StructType({ make: FunctionType([DictType(StringType, r)], PlanRowsCollectionType) }),
    group:   StructType({ make: FunctionType([DictType(StringType, r)], PlanRowsCollectionType) }),
    rows:    StructType({ rows: PlanRowsCollectionType }),
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

/** Row-family membership over one source ENTRY (value + key). */
export type PlanMatchFn = (row: ExprType<StructType>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;

/**
 * The row-envelope accessors every kind series shares (the `.of` channel:
 * optional accessors return the envelope fields' `Option` types, so
 * presence is a per-row data fact).
 *
 * @remarks
 * There is no `key` accessor: a leaf row's key IS the source entry's key
 * (#568). Accessors take `(value, key)` — a keyed dataset does not repeat its
 * key inside the value, so `label: (_r, k) => k` is the normal spelling.
 *
 * @typeParam R - The data row type
 */
export interface PlanSeriesEnvelopeConfig<R extends StructType> {
    /** Row-family membership — omitted ⇒ every data entry belongs. */
    match?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
    /** Key prefix for this family's rows; omit ⇒ the source's keys, unchanged. */
    prefix?: string;
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
    /**
     * Per-row review-verdict accessor — returns the field's `Option`.
     *
     * @remarks
     * SEEDS the review chrome's buttons; it does not decide how a decided row
     * LOOKS. Appearance is derived like every other pixel on this canvas — a
     * verdict your callback wrote is read back through your own accessors
     * (`runs`' state for bar colour, `status` for a dot, `decisions` for a
     * diamond). `deriveApproval(r.flagged)` is the canonical spelling.
     */
    approval?: PlanAccessor<R, OptionType<ApprovalStateType>>;
    /** Per-row expand-in-place accessor — returns the field's `Option`. */
    expand?: PlanAccessor<R, OptionType<PlanExpandType>>;
}

/** Config for {@link Plan.series.span} — the span `.of` surface plus `match`. */
export interface PlanSpanSeriesConfig<R extends StructType> extends PlanSpanOfConfig<R> {
    /** Row-family membership — omitted ⇒ every data entry belongs. */
    match?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
}

/** Config for {@link Plan.series.heat} — the heat `.of` surface plus `match`. */
export interface PlanHeatSeriesConfig<R extends StructType> extends PlanHeatOfConfig<R> {
    /** Row-family membership — omitted ⇒ every data entry belongs. */
    match?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
}

/** Config for {@link Plan.series.table} — the table `.of` surface plus `match`. */
export interface PlanTableSeriesOfConfig<R extends StructType> extends PlanTableOfConfig<R> {
    /** Row-family membership — omitted ⇒ every data entry belongs. */
    match?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
}

/**
 * Config for {@link Plan.series.buckets} — one bucket row per matched data
 * row, lanes / tiles / markers from accessors.
 */
export interface PlanBucketsSeriesConfig<R extends StructType> extends PlanSeriesEnvelopeConfig<R> {
    /** Per-row sub-slot lanes accessor; omitted ⇒ unbucketed rows. */
    lanes?: PlanAccessor<R, ArrayType<PlanLaneType>>;
    /** Per-row tiles accessor. */
    events: PlanAccessor<R, ArrayType<PlanBucketEventType>>;
    /** Per-row cell-marker accessor. */
    markers?: PlanAccessor<R, ArrayType<PlanCellMarkerType>>;
}

/** Config for {@link Plan.series.cards} — one cards row per matched data row. */
export interface PlanCardsSeriesConfig<R extends StructType> extends PlanSeriesEnvelopeConfig<R> {
    /** Per-row shift-chips accessor. */
    chips: PlanAccessor<R, ArrayType<PlanChipType>>;
}

/** Config for {@link Plan.series.events} — one event row per matched data row. */
export interface PlanEventsSeriesConfig<R extends StructType> extends PlanSeriesEnvelopeConfig<R> {
    /** Per-row instant-marks accessor. */
    marks: PlanAccessor<R, ArrayType<PlanEventMarkType>>;
}

/**
 * Config for {@link Plan.series.chart} — one chart row per matched data
 * row, layers built from the row's own data via the accessor.
 */
export interface PlanChartSeriesConfig<R extends StructType> extends PlanSeriesEnvelopeConfig<R> {
    /** Per-row pinned accessor (`true` ⇒ above the virtualised body). */
    pinned?: PlanAccessor<R, BooleanType>;
    /** Per-row Chart layers accessor (`Chart.*` builders, bare or `Plan.layer`-wrapped). */
    layers: (row: ExprType<R>, key: ExprType<StringType>) => PlanChartLayerInput | PlanChartLayerInput[];
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
 * per distinct `by` value (KEY order — the collection is a dictionary), the
 * child series applied to each group's member rows and re-parented beneath its
 * strip.
 *
 * @property match - Strip membership (omitted ⇒ every data row)
 * @property by - The group-key accessor
 * @property prefix - Key prefix for the synthesized strip keys (omit ⇒ the bare group value)
 * @property collapsed - Strips start collapsed
 * @property summaryAggregate - DECLARED strip aggregation over descendant heat rows
 */
export interface PlanGroupSeriesByConfig<R extends StructType> {
    /** Strip membership (omitted ⇒ every data entry). */
    match?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
    /** The group-key accessor — one strip per discovered value. */
    by: PlanAccessor<R, StringType>;
    /** Key prefix for the synthesized strip keys — a strip's key is
     *  `${prefix}${groupValue}`. Omit ⇒ the bare group value. Supply one to
     *  keep two families grouping the same column apart, or where a group
     *  value could collide with a source key. */
    prefix?: string;
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

/** Filter the source ENTRIES by the reified match predicate (all when omitted). */
function matchedRows(
    entries: ExprType<DictType<StringType, StructType>>,
    rowType: StructType,
    match: PlanMatchFn | undefined,
): ExprType<DictType<StringType, StructType>> {
    if (match === undefined) return entries;
    const pred = East.function([rowType, StringType], BooleanType, (_$, r, k) => match(r, k));
    return entries.filter((_$, r, k) => pred(r, k)) as ExprType<DictType<StringType, StructType>>;
}

/** The envelope's accessor-supplied Option fields for one data entry. */
function envelopeOverrides(cfg: PlanSeriesEnvelopeConfig<StructType>, r: ExprType<StructType>, k: ExprType<StringType>) {
    return {
        ...(cfg.sub !== undefined ? { sub: cfg.sub(r, k) } : {}),
        ...(cfg.value !== undefined ? { value: cfg.value(r, k) } : {}),
        ...(cfg.status !== undefined ? { status: cfg.status(r, k) } : {}),
        ...(cfg.approval !== undefined ? { approval: cfg.approval(r, k) } : {}),
        ...(cfg.expand !== undefined ? { expand: cfg.expand(r, k) } : {}),
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
    match: PlanMatchFn | undefined,
    groupBy: PlanAccessor<StructType, StringType>[] | undefined,
    parentFn: (() => PlanResolvedLevel["parentFn"]) | undefined,
    leaf: PlanLeafFn,
    prefix?: string,
): ExprType<FunctionType<[DictType<StringType, StructType>], PlanRowsCollectionType>> {
    const sourceType = DictType(StringType, rowType);
    return East.function([sourceType], PlanRowsCollectionType, ($, entries) => {
        const matched = $.let(matchedRows(entries, rowType, match), sourceType);
        if (groupBy === undefined || groupBy.length === 0 || parentFn === undefined) {
            return foldEntriesToDict(matched, PlanRowsCollectionType, LAST_WINS, leaf);
        }
        // Every level shares ONE parent constructor (the ofScaffold shape).
        const shared = parentFn();
        const levels: PlanResolvedLevel[] = groupBy.map((by) => ({
            by: reifyLevelKey(rowType, by),
            parentFn: shared,
        }));
        // The prefix keys the SYNTHESIZED parents; leaf keys are the source's
        // own, carried through by `leaf` — see `groupRows`.
        return groupRows(matched, levels,
            (subset, _prefix) => foldEntriesToDict(subset, PlanRowsCollectionType, LAST_WINS, leaf),
            prefix ?? "");
    }) as ExprType<FunctionType<[DictType<StringType, StructType>], PlanRowsCollectionType>>;
}

/** Apply one series value to a rows expression (the exhaustive-arm call). */
export function applySeriesValue(
    s: PlanSeriesValue,
    rows: ExprType<DictType<StringType, StructType>>,
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
 *
 * @remarks
 * Families are unioned, not concatenated: the canvas is one keyed collection,
 * and two families that emit the same key resolve last-wins instead of both
 * rows surviving to be walked twice.
 */
export function applySeries(
    series: PlanSeriesInput,
    data: ExprType<DictType<StringType, StructType>>,
): PlanRowsValue {
    if (Array.isArray(series)) {
        return series.reduce<PlanRowsValue>(
            (acc, s) => acc.union(applySeriesValue(s, data), LAST_WINS) as PlanRowsValue,
            emptyRows(),
        );
    }
    const list = series;
    return list.reduce(
        ($, acc, s) => {
            $((acc as PlanRowsValue).unionInPlace(applySeriesValue(s as PlanSeriesValue, data), LAST_WINS));
            return acc;
        },
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
    const make = seriesScaffold(rowType, cfg.match, cfg.groupBy,
        () => groupParentFn(spanParentKind(cfg)), spanLeafOf(cfg), cfg.prefix);
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
        () => groupParentFn(heatParentKind(cfg), some(resolveTag(mode, PlanAggregateType).getTag())),
        heatLeafOf(cfg), cfg.prefix);
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
        () => groupParentFn(tableParentKind(cfg), some(resolveTag(mode, TableAggregateType).getTag())),
        tableLeafOf(cfg), cfg.prefix);
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
    const make = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r, k) => applyRowOverrides(
        createBuckets({
            key:   prefixedKey(cfg.prefix, k),
            label: cfg.label(r, k),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            ...(cfg.lanes !== undefined ? { lanes: cfg.lanes(r, k) } : {}),
            events: cfg.events(r, k),
            ...(cfg.markers !== undefined ? { markers: cfg.markers(r, k) } : {}),
        }),
        envelopeOverrides(cfg, r, k),
    ), cfg.prefix);
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
    const make = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r, k) => applyRowOverrides(
        createCards({
            key:   prefixedKey(cfg.prefix, k),
            label: cfg.label(r, k),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            chips: cfg.chips(r, k),
        }),
        envelopeOverrides(cfg, r, k),
    ), cfg.prefix);
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
    const make = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r, k) => applyRowOverrides(
        createEvents({
            key:   prefixedKey(cfg.prefix, k),
            label: cfg.label(r, k),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            marks: cfg.marks(r, k),
        }),
        envelopeOverrides(cfg, r, k),
    ), cfg.prefix);
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
    const make = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r, k) => applyRowOverrides(
        createChart({
            key:   prefixedKey(cfg.prefix, k),
            label: cfg.label(r, k),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            layers: cfg.layers(r, k),
            ...(cfg.left !== undefined ? { left: cfg.left } : {}),
            ...(cfg.right !== undefined ? { right: cfg.right } : {}),
            ...(cfg.height !== undefined ? { height: cfg.height } : {}),
            ...(cfg.expandedHeight !== undefined ? { expandedHeight: cfg.expandedHeight } : {}),
            ...(cfg.expandable !== undefined ? { expandable: cfg.expandable } : {}),
            ...(cfg.swatches !== undefined ? { swatches: cfg.swatches } : {}),
        }),
        {
            ...envelopeOverrides(cfg, r, k),
            ...(cfg.pinned !== undefined ? { pinned: some(cfg.pinned(r, k)) } : {}),
        },
    ), cfg.prefix);
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
    const applyChildren = (subset: ExprType<DictType<StringType, StructType>>): PlanRowsValue =>
        children.reduce<PlanRowsValue>(
            (acc, c) => acc.union(applySeriesValue(c, subset), LAST_WINS) as PlanRowsValue,
            emptyRows(),
        );
    if ("by" in chromeOrBy && typeof chromeOrBy.by === "function") {
        // DISCOVERED strips — one group per distinct key, mirroring the
        // grouped data form: the strip DECLARES its summary aggregation;
        // children apply to each group's rows. The member count is NOT baked
        // in here — a strip re-synthesized per paged window would carry that
        // window's count — it is derived renderer-side like every other
        // aggregate (#568).
        const cfg = chromeOrBy as PlanGroupSeriesByConfig<StructType>;
        const kind = East.value(variant("group", {
            summary:          none,
            summaryAggregate: cfg.summaryAggregate !== undefined
                ? some(resolveTag(cfg.summaryAggregate, PlanAggregateType))
                : none,
            collapsed:        cfg.collapsed !== undefined ? some(cfg.collapsed) : none,
        }), PlanRowKindType);
        const parentFn = groupParentFn(kind);
        const prefix = cfg.prefix ?? "";
        const rt: StructType = rowType;
        const sourceType = DictType(StringType, rt);
        const make = East.function([sourceType], PlanRowsCollectionType, ($, rows) => {
            const matched = $.let(matchedRows(rows, rt, cfg.match), sourceType);
            const levels: PlanResolvedLevel[] = [{ by: reifyLevelKey(rt, cfg.by), parentFn }];
            return groupRows(matched, levels, (subset, _prefix) => applyChildren(subset), prefix);
        });
        return seriesValue(rowType, "group", { make });
    }
    // STATIC chrome — one literal strip around the children.
    const chrome = chromeOrBy as PlanGroupSeriesChrome;
    const make = East.function([DictType(StringType, rowType)], PlanRowsCollectionType, (_$, rows) => {
        return createGroup({ ...(chrome as PlanGroupInput), rows: applyChildren(rows as unknown as ExprType<DictType<StringType, StructType>>) });
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
 *
 * @remarks
 * The paged arm no longer lives here: a Plan's rows channel is the shared
 * {@link RowSourceType} contract, and `contracts/source.ts`'s `buildRowSource`
 * wraps each window with this module's `applySeries` — the one place the
 * domain row type is erased to the canvas row type (#567).
 */
export function seriesRowType(data: ExprType<DictType<StringType, StructType>>): StructType {
    return (Expr.type(data) as DictType<StringType, StructType>).value;
}
