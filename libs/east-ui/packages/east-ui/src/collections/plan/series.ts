/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plan series (`Plan Data Interface.md` §3.5/§3.5a) — the data-driven row
 * series of a `data` + `series` canvas. Series are REAL EAST VALUES:
 * {@link PlanSeriesType} is a type constructor (the `DataBindHandleType`
 * pattern) instantiated per row type, and every `Plan.series.*` builder
 * reifies its accessors ONCE into the arm's typed `derive` function
 * (`Fn(Dict<String, R>) → Dict<String, PlanRow>` — Table's per-column `valueFn` move)
 * and returns `variant(kind, { derive })`. Application is eager expression
 * composition, typed end to end: the inline arm applies each series' `derive`
 * to the data expression (Table's `rows_mapped`); the paged arm (P-c) wraps
 * the same `derive`s over a `Data.bindPaged` handle's `page` method.
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
import { IconType } from "../../display/icon/types.js";
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
    type PlanAxisKindLiteral,
    type PlanKinded,
} from "./types.js";
import { resolveTag, resolveIcon, emptyRows, type PlanIconInput } from "./builders.js";
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
    type PlanElementsAccessor,
    type PlanSpanOfConfig,
    type PlanHeatOfConfig,
    type PlanTableOfConfig,
    type PlanResolvedLevel,
    type PlanRowFn,
    rowKey,
    reifyLevelKey,
    groupRows,
    spanParentKind,
    spanRowOf,
    heatParentKind,
    heatRowOf,
    tableParentKind,
    tableRowOf,
} from "./data-forms.js";

// ============================================================================
// The series type — a constructor, instantiated per row type
// ============================================================================

/**
 * The Plan series type CONSTRUCTOR — given the domain row type it returns
 * the concrete variant type of one series value (the `DataBindHandleType`
 * precedent: the row type lives structurally in each arm's `derive`
 * signature, so a series bound to one row type is a compile error against
 * data of another).
 *
 * @remarks
 * Every kind arm carries `derive: Fn(Dict<String, R>) → Dict<String, PlanRow>` — the
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
const seriesShape = (r: EastType) => {
    // Every data-driven arm carries the same identity + the same reified
    // pipeline. `key` and `title` are what let a series be listed, ordered and
    // persisted (#590 phase 1); `derive` is the pipeline itself.
    const identity = {
        key:      StringType,
        title:    StringType,
        subtitle: OptionType(StringType),
        icon:     OptionType(IconType),
    };
    const identified = (rt: EastType) => ({
        ...identity,
        derive:   FunctionType([DictType(StringType, rt)], PlanRowsCollectionType),
    });
    return VariantType({
        span:    StructType(identified(r)),
        buckets: StructType(identified(r)),
        chart:   StructType(identified(r)),
        heat:    StructType(identified(r)),
        table:   StructType(identified(r)),
        cards:   StructType(identified(r)),
        events:  StructType(identified(r)),
        // `group` and `rows` carry identity too (#590 §6.1, resolved). A GROUP
        // is the unit a person actually picks — "add Machines" — and hiding one
        // takes its whole subtree with it, because the children are built by
        // the group's own `derive`. Without this the library could only offer
        // top-level series, which on a grouped canvas is almost nothing.
        group:   StructType(identified(r)),
        rows:    StructType({ ...identity, rows: PlanRowsCollectionType }),
    });
};

/** The one TS-face series shape (`R` erased to `StructType`). */
type PlanSeriesShape = ReturnType<typeof seriesShape>;

export const PlanSeriesType: (r: EastType) => PlanSeriesShape = seriesShape;

/**
 * One series value — the `BoundValue` alias pattern applied to
 * {@link PlanSeriesType}. The TS face is deliberately ERASED of the row type
 * (the `PlanRowsValue` convention): `SubtypeExprOrValue` maps function
 * inputs invariantly, so a row-typed face could never assign through
 * `$.const` / props; type safety lives in the builder CONFIGS (accessors
 * checked against `R`) and in the East runtime (the instantiated type from
 * `PlanSeriesType(rowType)` subtype-checks every stored `derive`).
 *
 * What the face DOES carry is the phantom axis kind ({@link PlanKinded}):
 * a builder brands its series with the kind its elements' instants ride, and
 * the root refuses a series whose kind is not its axis's at compile time.
 * `never` (the default) is the erased brand.
 *
 * @typeParam K - The axis kind(s) the series' instants ride
 */
export type PlanSeriesValue<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanSeriesShape>, K>;

/**
 * The `series` prop's input — a TS array of series values (the common
 * static case) or an East expression of the series array (a `$.const`-bound
 * list, a computed list, a dataset-stored list). The array form checks each
 * series' kind against `K` (the root's axis kind); an East expression is
 * kind-erased.
 *
 * @typeParam K - The axis kind(s) the list must lie within (default: every kind)
 */
export type PlanSeriesInput<K extends PlanAxisKindLiteral = PlanAxisKindLiteral> =
    | PlanSeriesValue<K>[]
    | ExprType<ArrayType<PlanSeriesShape>>;

// ============================================================================
// Series configs — the accessor surfaces
// ============================================================================

/** Series membership over one source ENTRY (value + key). */
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
/**
 * What identifies a row SERIES — carried by every `Plan.series.*` config so a
 * series can be ordered, persisted and listed in the series library (#590).
 *
 * @remarks
 * `title`, not `label`: a series config already spends `label` on its per-ROW
 * gutter accessor, and one object literal cannot mean two things by one word.
 * `key` is likewise the SERIES', never a row's — a leaf row's key is always
 * the source entry's own (#568).
 */
export interface PlanSeriesIdentity {
    /** Stable identity — what ordering, persistence and the library address. */
    key: string;
    /** The series' name, as a user reads it ("Machine jobs"). */
    title: string;
    /** The series' muted role line ("one row per machine"). */
    subtitle?: string;
    /** Card-icon override; omit ⇒ the icon this row KIND declares. */
    icon?: PlanIconInput;
}

export interface PlanSeriesEnvelopeConfig<R extends StructType> extends PlanSeriesIdentity {
    /** Series membership — omitted ⇒ every data entry belongs. */
    match?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
    /** Key prefix for this series' rows; omit ⇒ the source's keys, unchanged.
     *  Banks the series together and takes it off the source key space, so
     *  `seek` can no longer reach it — see `keySuffix` first. */
    keyPrefix?: string;
    /** Key suffix for this series' rows (`m03` → `m03/chart`).
     *
     *  How several series show the SAME entity: the data key stays FIRST, so
     *  the canvas keeps the source's order, one asset's rows sit adjacent, and
     *  `seek` still lands on it. Without an affix the second series over a
     *  source silently replaces the first, since both emit the same key. */
    keySuffix?: string;
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
export interface PlanSpanSeriesConfig<R extends StructType, K extends PlanAxisKindLiteral = never> extends PlanSpanOfConfig<R, K>, PlanSeriesIdentity {
    /** Series membership — omitted ⇒ every data entry belongs. */
    match?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
}

/** Config for {@link Plan.series.heat} — the heat `.of` surface plus `match`. */
export interface PlanHeatSeriesConfig<R extends StructType, K extends PlanAxisKindLiteral = never> extends PlanHeatOfConfig<R, K>, PlanSeriesIdentity {
    /** Series membership — omitted ⇒ every data entry belongs. */
    match?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
}

/** Config for {@link Plan.series.table} — the table `.of` surface plus `match`. */
export interface PlanTableSeriesOfConfig<R extends StructType, K extends PlanAxisKindLiteral = never> extends PlanTableOfConfig<R, K>, PlanSeriesIdentity {
    /** Series membership — omitted ⇒ every data entry belongs. */
    match?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
}

/**
 * Config for {@link Plan.series.buckets} — one bucket row per matched data
 * row, lanes / tiles / markers from accessors.
 */
export interface PlanBucketsSeriesConfig<R extends StructType, K extends PlanAxisKindLiteral = never> extends PlanSeriesEnvelopeConfig<R> {
    /** Per-row sub-slot lanes accessor; omitted ⇒ unbucketed rows. */
    lanes?: PlanAccessor<R, ArrayType<PlanLaneType>>;
    /** Per-row tiles accessor — the tiles' axis kind brands the series. */
    events: PlanElementsAccessor<R, PlanBucketEventType, K>;
    /** Per-row cell-marker accessor. */
    markers?: PlanElementsAccessor<R, PlanCellMarkerType, K>;
}

/** Config for {@link Plan.series.cards} — one cards row per matched data row. */
export interface PlanCardsSeriesConfig<R extends StructType, K extends PlanAxisKindLiteral = never> extends PlanSeriesEnvelopeConfig<R> {
    /** Per-row shift-chips accessor — the chips' axis kind brands the series. */
    chips: PlanElementsAccessor<R, PlanChipType, K>;
}

/** Config for {@link Plan.series.events} — one event row per matched data row. */
export interface PlanEventsSeriesConfig<R extends StructType, K extends PlanAxisKindLiteral = never> extends PlanSeriesEnvelopeConfig<R> {
    /** Per-row instant-marks accessor — the marks' axis kind brands the series. */
    marks: PlanElementsAccessor<R, PlanEventMarkType, K>;
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
    /** The left y-axis declaration (shared by this series' rows). */
    left?: PlanChartAxisInput;
    /** The right y-axis declaration. */
    right?: PlanChartAxisInput;
    /** Height mode — `"spark"` (default) / `"expanded"` / `Plan.fixed(px)`. */
    height?: PlanChartInput["height"];
    /** Height the EXPANDED state opens to (CSS px). */
    expandedHeight?: SubtypeExprOrValue<StringType>;
    /** Spark ↔ expanded toggle (caret). */
    expandable?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Gutter legend chips (shared by this series' rows). */
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
 * @property key - The SERIES' identity (one series, many strips — so it cannot borrow a strip's)
 * @property title - The series' name, as the library lists it
 * @property match - Strip membership (omitted ⇒ every data row)
 * @property by - The group-key accessor
 * @property prefix - Key prefix for the synthesized strip keys (omit ⇒ the bare group value)
 * @property collapsed - Strips start collapsed
 * @property summaryAggregate - DECLARED strip aggregation over descendant heat rows
 */
export interface PlanGroupSeriesByConfig<R extends StructType> extends PlanSeriesIdentity {
    /** Strip membership (omitted ⇒ every data entry). */
    match?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<BooleanType>;
    /** The group-key accessor — one strip per discovered value. */
    by: PlanAccessor<R, StringType>;
    /** Key prefix for the synthesized strip keys — a strip's key is
     *  `${keyPrefix}${groupValue}`. Omit ⇒ the bare group value. Supply one to
     *  keep two series grouping the same column apart, or where a group value
     *  could collide with a source key.
     *
     *  There is no strip SUFFIX: a strip's key is the group VALUE, not a data
     *  key, so nothing about the source's order is riding on it. */
    keyPrefix?: string;
    /** Strips start collapsed. */
    collapsed?: boolean;
    /** DECLARED strip aggregation over descendant heat rows — `"mean"`/`"max"`/`"sum"` or a `PlanAggregateType` expression. */
    summaryAggregate?: SubtypeExprOrValue<PlanAggregateType> | PlanAggregateLiteral;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * The identity as the ARM stores it — widened to expressions, because a static
 * group's identity IS its strip's `key` / `label`, and those are already
 * `SubtypeExprOrValue<StringType>`. The author-facing {@link PlanSeriesIdentity}
 * (plain strings) is assignable to this.
 */
interface PlanSeriesIdentityValue {
    key: SubtypeExprOrValue<StringType>;
    title: SubtypeExprOrValue<StringType>;
    subtitle?: SubtypeExprOrValue<StringType>;
    icon?: PlanIconInput;
}

/** Pin one arm value against the instantiated series type. */
function seriesValue<R extends StructType>(
    rowType: R,
    tag: string,
    payload: object,
    /** The series identity (#590) — every arm carries one. */
    identity: PlanSeriesIdentityValue,
): PlanSeriesValue {
    const id = {
        key:      identity.key,
        title:    identity.title,
        subtitle: identity.subtitle !== undefined ? some(identity.subtitle) : none,
        icon:     identity.icon !== undefined ? some(resolveIcon(identity.icon)) : none,
    };
    return East.value(
        variant(tag, { ...id, ...payload }) as unknown as SubtypeExprOrValue<PlanSeriesShape>,
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
 * The shared scaffolding for ONE series' `derive` — the `series.ts` twin of
 * `data-forms.ts`'s `ofScaffold`: match filter → optional groupBy levels →
 * leaf rows, inside that single series' own reified function. NOT a
 * canvas-level compiler — the canvas never composes series into one
 * function; `applySeries` calls each series' `derive` in declared order.
 */
function seriesScaffold(
    rowType: StructType,
    match: PlanMatchFn | undefined,
    groupBy: PlanAccessor<StructType, StringType>[] | undefined,
    parentFn: (() => PlanResolvedLevel["parentFn"]) | undefined,
    row: PlanRowFn,
    prefix?: string,
): ExprType<FunctionType<[DictType<StringType, StructType>], PlanRowsCollectionType>> {
    const sourceType = DictType(StringType, rowType);
    return East.function([sourceType], PlanRowsCollectionType, ($, entries) => {
        const matched = $.let(matchedRows(entries, rowType, match), sourceType);
        if (groupBy === undefined || groupBy.length === 0 || parentFn === undefined) {
            return foldEntriesToDict(matched, PlanRowsCollectionType, LAST_WINS, row);
        }
        // Every level shares ONE parent constructor (the ofScaffold shape).
        const shared = parentFn();
        const levels: PlanResolvedLevel[] = groupBy.map((by) => ({
            by: reifyLevelKey(rowType, by),
            parentFn: shared,
        }));
        // The prefix keys the SYNTHESIZED parents; leaf keys are the source's
        // own, carried through by `row` — see `groupRows`.
        return groupRows(matched, levels,
            (subset, _prefix) => foldEntriesToDict(subset, PlanRowsCollectionType, LAST_WINS, row),
            prefix ?? "");
    }) as ExprType<FunctionType<[DictType<StringType, StructType>], PlanRowsCollectionType>>;
}

/** Apply one series value to a rows expression (the exhaustive-arm call). */
export function applySeriesValue(
    s: PlanSeriesValue<PlanAxisKindLiteral>,
    rows: ExprType<DictType<StringType, StructType>>,
): PlanRowsValue {
    return s.match({
        span:    (_$, v) => v.derive(rows),
        buckets: (_$, v) => v.derive(rows),
        chart:   (_$, v) => v.derive(rows),
        heat:    (_$, v) => v.derive(rows),
        table:   (_$, v) => v.derive(rows),
        cards:   (_$, v) => v.derive(rows),
        events:  (_$, v) => v.derive(rows),
        group:   (_$, v) => v.derive(rows),
        rows:    (_$, v) => v.rows,
    }) as PlanRowsValue;
}

/**
 * Apply the `series` input to the data expression — the inline arm's
 * application (Table's `rows_mapped`, per series). A TS array applies each
 * value in declared order; an East expression folds at evaluation, so
 * `$.const`-bound and computed series lists work identically.
 *
 * @remarks
 * Series are unioned, not concatenated: the canvas is one keyed collection,
 * and two series that emit the same key resolve last-wins instead of both
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
 * A data-driven span series — one span row per matched data row, grouped
 * to arbitrary depth with rollup parents (the span `.of` surface + `match`).
 *
 * @typeParam R - The data row type
 * @typeParam K - The axis kind the runs imply (inferred from the `runs` accessor; `never` when erased)
 * @param rowType - The data row type (every builder takes it first — the `Slice.config` shape)
 * @param config - The accessors + grouping ({@link PlanSpanSeriesConfig})
 * @returns A series value (`variant("span", { derive })`), branded with its kind
 */
export function createSeriesSpan<R extends StructType, K extends PlanAxisKindLiteral = never>(
    rowType: R, config: PlanSpanSeriesConfig<R, K>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanSpanSeriesConfig<StructType>;
    const derive = seriesScaffold(rowType, cfg.match, cfg.groupBy,
        () => groupParentFn(spanParentKind(cfg)), spanRowOf(cfg), cfg.keyPrefix);
    return seriesValue(rowType, "span", { derive }, cfg) as PlanSeriesValue<K>;
}

/**
 * A data-driven heat series — one heat row per matched data row, grouped
 * with per-bucket-aggregated parents (the heat `.of` surface + `match`).
 *
 * @typeParam R - The data row type
 * @typeParam K - The axis kind the cells imply (inferred from the `cells` accessor; `never` when erased)
 * @param rowType - The data row type
 * @param config - The accessors + grouping ({@link PlanHeatSeriesConfig})
 * @returns A series value (`variant("heat", { derive })`), branded with its kind
 */
export function createSeriesHeat<R extends StructType, K extends PlanAxisKindLiteral = never>(
    rowType: R, config: PlanHeatSeriesConfig<R, K>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanHeatSeriesConfig<StructType>;
    const mode = cfg.aggregate ?? "mean";
    const derive = seriesScaffold(rowType, cfg.match, cfg.groupBy,
        () => groupParentFn(heatParentKind(cfg), some(resolveTag(mode, PlanAggregateType).getTag())),
        heatRowOf(cfg), cfg.keyPrefix);
    return seriesValue(rowType, "heat", { derive }, cfg) as PlanSeriesValue<K>;
}

/**
 * A data-driven table series — one table row per matched data row, grouped
 * with subtotal parents (the table `.of` surface + `match`).
 *
 * @typeParam R - The data row type
 * @typeParam K - The axis kind the cells imply (inferred from the `cells` / `series` accessors; `never` when erased)
 * @param rowType - The data row type
 * @param config - The accessors + grouping ({@link PlanTableSeriesOfConfig})
 * @returns A series value (`variant("table", { derive })`), branded with its kind
 */
export function createSeriesTable<R extends StructType, K extends PlanAxisKindLiteral = never>(
    rowType: R, config: PlanTableSeriesOfConfig<R, K>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanTableSeriesOfConfig<StructType>;
    const mode = cfg.aggregate ?? "sum";
    const derive = seriesScaffold(rowType, cfg.match, cfg.groupBy,
        () => groupParentFn(tableParentKind(cfg), some(resolveTag(mode, TableAggregateType).getTag())),
        tableRowOf(cfg), cfg.keyPrefix);
    return seriesValue(rowType, "table", { derive }, cfg) as PlanSeriesValue<K>;
}

/**
 * A data-driven bucket series — one bucket row (the Planner surface) per
 * matched data row.
 *
 * @typeParam R - The data row type
 * @typeParam K - The axis kind the tiles imply (inferred from the `events` / `markers` accessors; `never` when erased)
 * @param rowType - The data row type
 * @param config - The accessors ({@link PlanBucketsSeriesConfig})
 * @returns A series value (`variant("buckets", { derive })`), branded with its kind
 */
export function createSeriesBuckets<R extends StructType, K extends PlanAxisKindLiteral = never>(
    rowType: R, config: PlanBucketsSeriesConfig<R, K>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanBucketsSeriesConfig<StructType>;
    const derive = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r, k) => applyRowOverrides(
        createBuckets({
            key:   rowKey(cfg.keyPrefix, k, cfg.keySuffix),
            label: cfg.label(r, k),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            ...(cfg.lanes !== undefined ? { lanes: cfg.lanes(r, k) } : {}),
            events: cfg.events(r, k),
            ...(cfg.markers !== undefined ? { markers: cfg.markers(r, k) } : {}),
        }),
        envelopeOverrides(cfg, r, k),
    ), cfg.keyPrefix);
    return seriesValue(rowType, "buckets", { derive }, cfg) as PlanSeriesValue<K>;
}

/**
 * A data-driven cards series — one cards row (Roster chips) per matched
 * data row.
 *
 * @typeParam R - The data row type
 * @typeParam K - The axis kind the chips imply (inferred from the `chips` accessor; `never` when erased)
 * @param rowType - The data row type
 * @param config - The accessors ({@link PlanCardsSeriesConfig})
 * @returns A series value (`variant("cards", { derive })`), branded with its kind
 */
export function createSeriesCards<R extends StructType, K extends PlanAxisKindLiteral = never>(
    rowType: R, config: PlanCardsSeriesConfig<R, K>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanCardsSeriesConfig<StructType>;
    const derive = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r, k) => applyRowOverrides(
        createCards({
            key:   rowKey(cfg.keyPrefix, k, cfg.keySuffix),
            label: cfg.label(r, k),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            chips: cfg.chips(r, k),
        }),
        envelopeOverrides(cfg, r, k),
    ), cfg.keyPrefix);
    return seriesValue(rowType, "cards", { derive }, cfg) as PlanSeriesValue<K>;
}

/**
 * A data-driven event series — one instant-mark row per matched data row.
 *
 * @typeParam R - The data row type
 * @typeParam K - The axis kind the marks imply (inferred from the `marks` accessor; `never` when erased)
 * @param rowType - The data row type
 * @param config - The accessors ({@link PlanEventsSeriesConfig})
 * @returns A series value (`variant("events", { derive })`), branded with its kind
 */
export function createSeriesEvents<R extends StructType, K extends PlanAxisKindLiteral = never>(
    rowType: R, config: PlanEventsSeriesConfig<R, K>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanEventsSeriesConfig<StructType>;
    const derive = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r, k) => applyRowOverrides(
        createEvents({
            key:   rowKey(cfg.keyPrefix, k, cfg.keySuffix),
            label: cfg.label(r, k),
            ...(cfg.id !== undefined ? { id: cfg.id } : {}),
            ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
            marks: cfg.marks(r, k),
        }),
        envelopeOverrides(cfg, r, k),
    ), cfg.keyPrefix);
    return seriesValue(rowType, "events", { derive }, cfg) as PlanSeriesValue<K>;
}

/**
 * A data-driven chart series — one chart row per matched data row, layers
 * built from the row's own data. Kind-ERASED: a Chart layer's TS face does
 * not expose its x type, so a chart series constrains no axis at compile
 * time — the render-time diagnostic holds it to the axis like any row.
 *
 * @typeParam R - The data row type
 * @param rowType - The data row type
 * @param config - The accessors + shared axes ({@link PlanChartSeriesConfig})
 * @returns A series value (`variant("chart", { derive })`)
 */
export function createSeriesChart<R extends StructType>(rowType: R, config: PlanChartSeriesConfig<R>): PlanSeriesValue {
    const cfg = config as PlanChartSeriesConfig<StructType>;
    const derive = seriesScaffold(rowType, cfg.match, undefined, undefined, (_$, r, k) => applyRowOverrides(
        createChart({
            key:   rowKey(cfg.keyPrefix, k, cfg.keySuffix),
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
    ), cfg.keyPrefix);
    return seriesValue(rowType, "chart", { derive }, cfg);
}

/**
 * A group strip AROUND child series — the chrome is literal, the members
 * are the children applied to the same data and re-parented beneath it.
 *
 * @typeParam R - The data row type
 * @param rowType - The data row type
 * @remarks
 * A group is the unit a person picks — "add Machines" — so the STATIC form's
 * series identity IS the strip's: `key` and `label` become the series' `key`
 * and `title`, and `meta` its subtitle. Nothing extra to write, and the two can
 * never disagree about what the section is called.
 *
 * The DISCOVERED (`by`) form cannot borrow that, because one series makes MANY
 * strips — it declares its own `key` / `title` ({@link PlanGroupSeriesByConfig}).
 *
 * @typeParam K - The union of the children's axis kinds (inferred; `never` when all are erased)
 * @param chrome - The group's literal chrome ({@link PlanGroupSeriesChrome})
 * @param children - The member series (applied in declared order; their rows sit in KEY order)
 * @returns A series value (`variant("group", { derive })`), branded with its children's kinds
 */
export function createSeriesGroup<R extends StructType, K extends PlanAxisKindLiteral = never>(
    rowType: R,
    chromeOrBy: PlanGroupSeriesChrome | PlanGroupSeriesByConfig<R>,
    children: PlanSeriesValue<K>[],
): PlanSeriesValue<K> {
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
        const prefix = cfg.keyPrefix ?? "";
        const rt: StructType = rowType;
        const sourceType = DictType(StringType, rt);
        const make = East.function([sourceType], PlanRowsCollectionType, ($, rows) => {
            const matched = $.let(matchedRows(rows, rt, cfg.match), sourceType);
            const levels: PlanResolvedLevel[] = [{ by: reifyLevelKey(rt, cfg.by), parentFn }];
            return groupRows(matched, levels, (subset, _prefix) => applyChildren(subset), prefix);
        });
        return seriesValue(rowType, "group", { derive: make }, cfg as PlanSeriesIdentity) as PlanSeriesValue<K>;
    }
    // STATIC chrome — one literal strip around the children.
    const chrome = chromeOrBy as PlanGroupSeriesChrome;
    const make = East.function([DictType(StringType, rowType)], PlanRowsCollectionType, (_$, rows) => {
        return createGroup({ ...(chrome as PlanGroupInput), rows: applyChildren(rows as unknown as ExprType<DictType<StringType, StructType>>) });
    });
    // The strip's own identity, reused verbatim — see the remarks above.
    return seriesValue(rowType, "group", { derive: make }, {
        key:   chrome.key,
        title: chrome.label,
        ...(chrome.meta !== undefined ? { subtitle: chrome.meta } : {}),
    }) as PlanSeriesValue<K>;
}

/**
 * Literal one-off chrome rows riding beside the data-driven series (a pinned
 * KPI chart, a hand-built section) — the finished rows carried directly, no
 * data dependence. They are placed by their own KEYS like every other row,
 * not by where this series sits in the list.
 *
 * @remarks
 * Unlike a group, a `rows` series has no single row to borrow identity from —
 * it may carry several — so it declares one. That is what lets a hand-built
 * section be switched off like anything else, instead of being the one thing on
 * the canvas a user cannot turn off.
 *
 * @typeParam R - The data row type (pins the series against its siblings)
 * @typeParam K - The union of the rows' axis kinds (inferred from the kind-factory results; `never` when erased)
 * @param rowType - The data row type
 * @param identity - How the library lists this section ({@link PlanSeriesIdentity})
 * @param rows - The literal rows (kind-factory results)
 * @returns A series value (`variant("rows", { rows })`), branded with the rows' kinds
 */
export function createSeriesRows<R extends StructType, K extends PlanAxisKindLiteral = never>(
    rowType: R,
    identity: PlanSeriesIdentity,
    rows: PlanRowsInput<K>,
): PlanSeriesValue<K> {
    return seriesValue(rowType, "rows", { rows: normalizeRows(rows) }, identity) as PlanSeriesValue<K>;
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
