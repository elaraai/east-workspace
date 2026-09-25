/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Plan series (#822) — the row recipes of a `data` + `series` canvas.
 *
 * A canvas is its `data` (keyed entries) plus a list of series. Each series
 * says which entries it takes (`match`), what kind of row each becomes, and
 * how to read that row's content from the entry; several series over one
 * source give each entry several rows. The top-level list IS the layout: each
 * series contributes its rows in declared order, as BLOCKS kept apart
 * (`PlanBlockType`, #823) — a data series one block of its entries' rows (an
 * ordered stream, `Array<PlanRow>`), which a paged canvas pages on its own; a
 * section its header's fixed block, then its members' blocks; hand-built rows
 * a fixed block.
 *
 * Hierarchy comes only from the data's own nesting. Every data series takes
 * `children`: a bare accessor returns more of THIS series' entries (to any
 * depth — a `RecursiveType` entry), and `Plan.children(of, [series…])` steps
 * down to a child collection of another type, laid out like a top-level list.
 * `Plan.series.section` puts a titled block over series, `Plan.series.views`
 * gives each entry one adjacent row per member series, and `Plan.series.rows`
 * places hand-built rows.
 *
 * Every row has a typed id — `{ series, path }`, the path the entry keys that
 * lead to it — and every series is a REAL EAST VALUE (the `DataBindHandleType`
 * pattern): its `derive` is a reified East function from the source to its
 * rows, so a series list can be bound, picked (`Plan.pick`) and stored. Each
 * builder also records how to BUILD the series for any collection type, which
 * is what lets a step-down compile its child series for the child collection's
 * type, the root compile them for a source keyed by any type, and the root
 * refuse two series sharing a key.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExpandOnce,
    type ExprType,
    type RecursiveExpr,
    type RecursiveType,
    type SubtypeExprOrValue,
    East,
    Expr,
    ArrayType,
    BooleanType,
    DictType,
    FunctionType,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    isTypeEqual,
    variant,
    some,
    none,
} from "@elaraai/east";

import { StatusValueType, type StatusValueLiteral } from "../../feedback/status/types.js";
import { IconType } from "../../display/icon/types.js";
import { ApprovalStateType } from "../../contracts/approval.js";
import { TableAggregateType, type TableAggregateLiteral } from "../table/types.js";
import { TickFormatType } from "../../format/types.js";
import { reifyAccessor } from "../../shared/reify.js";
import {
    PlanAggregateType,
    type PlanAggregateLiteral,
    PlanExpandType,
    PlanGroupSummaryType,
    PlanHeatCellsType,
    PlanLaneType,
    PlanBucketEventType,
    PlanCellMarkerType,
    PlanChipType,
    PlanEventMarkType,
    PlanRunType,
    PlanDecisionMarkType,
    PlanPortType,
    PlanRollupType,
    type PlanRollupLiteral,
    PlanRowIdType,
    PlanRowKindType,
    PlanRowType,
    PlanRowsCollectionType,
    PlanBlockType,
    PlanBlocksType,
    PlanGestureType,
    PlanDropType,
    type PlanBlocksValue,
    type PlanTableSeriesType,
    type PlanTableSplitType,
    type PlanTableSplitLiteral,
    type PlanTableEmphasisType,
    type PlanTableEmphasisLiteral,
    type PlanRowsValue,
    type PlanAxisKindLiteral,
    type PlanKinded,
    type PlanElementsInput,
    type PlanHeatCellsInput,
    type PlanTableCellsInput,
} from "./types.js";
import { resolveTag, resolveIcon, type PlanIconInput, type PlanFoldInput, type PlanHeatScaleInput } from "./builders.js";
import { planRow, planGutter, normalizeRows, REBASE_ROWS, type PlanRowsInput, type PlanGutterFields } from "./assemble.js";
import {
    spanKind,
    bucketsKind,
    chartKind,
    heatKind,
    tableKind,
    cardsKind,
    eventsKind,
    groupKind,
    groupSummary,
    type PlanChartLayerInput,
    type PlanChartAxisInput,
    type PlanChartParts,
} from "./factories.js";

// ============================================================================
// The series type — a constructor, instantiated per row type
// ============================================================================

/** The arms a series value takes — its kind, which the series library shows. */
export type PlanSeriesArm =
    | "span" | "buckets" | "chart" | "heat" | "table" | "cards" | "events"
    | "group" | "section" | "views" | "rows";

/**
 * The Plan series type CONSTRUCTOR — given the entry type (and the entries'
 * key type, `String` by default) it returns the concrete variant type of one
 * series value (the `DataBindHandleType` precedent: the entry type lives
 * structurally in each arm's `derive` signature, so a series built for one
 * entry type is a compile error against data of another).
 *
 * @remarks
 * Every arm carries the series' identity and `derive: Fn(Dict<K, R>) →
 * Array<PlanBlock>` — the blocks the series contributes (#823: a data series'
 * one block of its entries' rows, each followed by its subtree; a section's
 * header block, then its members'), reified once by its builder. The arm is
 * the series' kind, which is all the series library reads beyond the identity.
 *
 * It carries its writer too (#880), `write: Fn(R, K, RowId, Gesture) →
 * Option<R>` — a gesture on one of its rows written into the entry the row
 * came from, through the fields the series declares (`review.verdict`,
 * `edit`), at whatever depth the row sits; `none` when no series in its tree
 * takes the gesture on that row. A series list is an East value (a pick, a
 * stored list), so the writer travels with the series rather than being
 * rebuilt by the canvas.
 *
 * @param r - The entry type value
 * @param k - The entries' key type (default `StringType`)
 * @returns The concrete `VariantType` of a series over entries of `r` keyed by `k`
 */
const seriesShape = (r: EastType, k: EastType = StringType) => {
    const arm = StructType({
        key:      StringType,
        title:    StringType,
        subtitle: OptionType(StringType),
        icon:     OptionType(IconType),
        derive:   FunctionType([DictType(k, r)], PlanBlocksType),
        write:    FunctionType([r, k, PlanRowIdType, PlanGestureType], OptionType(r)),
    });
    return VariantType({
        span: arm, buckets: arm, chart: arm, heat: arm, table: arm, cards: arm, events: arm,
        group: arm, section: arm, views: arm, rows: arm,
    });
};

/** The one TS-face series shape (the entry type erased). */
type PlanSeriesShape = ReturnType<typeof seriesShape>;

/**
 * The Plan series type constructor — `Plan.Types.Series(RowType)` for a list
 * of series over `Dict<String, RowType>` entries, `Plan.Types.Series(RowType,
 * IntegerType)` over `Dict<Integer, RowType>`.
 */
export const PlanSeriesType: (r: EastType, k?: EastType) => PlanSeriesShape = seriesShape;

/**
 * One series value — the `BoundValue` alias pattern applied to
 * {@link PlanSeriesType}. The TS face is deliberately ERASED of the entry
 * type (the `PlanRowsValue` convention): `SubtypeExprOrValue` maps function
 * inputs invariantly, so an entry-typed face could never assign through
 * `$.const` / props; type safety lives in the builder CONFIGS (accessors
 * checked against `R`) and in the East runtime.
 *
 * What the face DOES carry is the phantom axis kind ({@link PlanKinded}): a
 * builder brands its series with the kind its elements' instants ride, and
 * the root refuses a series whose kind is not its axis's at compile time.
 * `never` (the default) is the erased brand.
 *
 * @typeParam K - The axis kind(s) the series' instants ride
 */
export type PlanSeriesValue<K extends PlanAxisKindLiteral = never> = PlanKinded<ExprType<PlanSeriesShape>, K>;

/**
 * The `series` prop's input — a TS array of series values (the common case)
 * or an East expression of the series array (a `$.const`-bound list, a picked
 * list, a stored list). The array form checks each series' kind against `K`
 * (the root's axis kind) and its keys at build time; an East expression is
 * kind-erased, and a repeated key there renders as row diagnostics.
 *
 * @typeParam K - The axis kind(s) the list must lie within (default: every kind)
 */
export type PlanSeriesInput<K extends PlanAxisKindLiteral = PlanAxisKindLiteral> =
    | PlanSeriesValue<K>[]
    | ExprType<ArrayType<PlanSeriesShape>>;

// ============================================================================
// Accessors — over one entry's value and key
// ============================================================================

/**
 * An entry as an accessor receives it — the entry itself, or a recursive
 * entry's NODE: a `RecursiveType` entry arrives unwrapped, so an accessor reads
 * its fields directly (`(a) => a.name`, `(a) => a.children`) at every depth.
 *
 * @typeParam R - The entry type
 */
export type PlanEntryExpr<R extends EastType> =
    R extends RecursiveType<infer U> ? ExprType<ExpandOnce<U, R>> : ExprType<R>;

/**
 * An accessor over one data ENTRY — its value and its key.
 *
 * @remarks
 * The key is passed because the source is a keyed collection and a keyed
 * dataset does not repeat its key inside the value: `label: (_r, k) => k` is
 * the normal spelling. Its type is the collection's: the source's key type at
 * the top (`keyType`, `String` by default), a `Dict` child's key type, or an
 * `Array` child's `Integer` index. Single-parameter accessors keep working —
 * TS lets a callback ignore trailing arguments. A recursive entry arrives as
 * its node ({@link PlanEntryExpr}).
 *
 * @typeParam R - The entry type
 * @typeParam T - The accessor's East result type
 * @typeParam KT - The entries' key type
 */
export type PlanAccessor<R extends EastType, T extends EastType, KT extends EastType = StringType> =
    (row: PlanEntryExpr<R>, key: ExprType<KT>) => SubtypeExprOrValue<T>;

/**
 * An accessor returning a list of ELEMENTS (runs, tiles, chips, marks, …) —
 * a TS array of `Plan.run` / `event` / … results keeps their axis kind, which
 * the series collects into its own brand ({@link PlanElementsInput}); an
 * East-mapped list is kind-erased.
 *
 * @typeParam R - The entry type
 * @typeParam T - The element's East type
 * @typeParam K - The kind inferred from the returned elements
 * @typeParam KT - The entries' key type
 */
export type PlanElementsAccessor<R extends EastType, T extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType> =
    (row: PlanEntryExpr<R>, key: ExprType<KT>) => PlanElementsInput<T, K>;

/** An accessor returning one kinded VALUE (a `Plan.heatCells` / `Plan.tableCells` result). */
export type PlanKindedAccessor<R extends EastType, V, KT extends EastType = StringType> =
    (row: PlanEntryExpr<R>, key: ExprType<KT>) => V;

// ============================================================================
// Identity + children
// ============================================================================

/**
 * What identifies a SERIES — carried by every `Plan.series.*` config so a
 * series can be laid out, persisted and listed in the series library (#590).
 *
 * @remarks
 * `title`, not `label`: a series config already spends `label` on its per-ROW
 * gutter accessor. `key` is the SERIES' — unique across the whole series tree
 * of a canvas, since a row's id is its series key and its path.
 */
export interface PlanSeriesIdentity {
    /** Stable identity — unique across the canvas's whole series tree; what row ids, the library and persistence address. */
    key: string;
    /** The series' name, as a user reads it ("Machine jobs"). */
    title: string;
    /** The series' muted role line ("one row per machine"). */
    subtitle?: string;
    /** Card-icon override; omit ⇒ the icon this series' KIND declares. */
    icon?: PlanIconInput;
}

/** Marks a {@link PlanChildren} step-down. */
const PLAN_CHILDREN: unique symbol = Symbol("PlanChildren");

/**
 * A step down from an entry to a child collection of another entry type —
 * `Plan.children(of, [series…])` (#822). The child collection may be an
 * `Array` (kept in data order, keyed by index) or a `Dict` (key order), and the
 * series over it lay out exactly like a top-level list: blocks, `views`, or
 * sections, nesting to any depth.
 *
 * @typeParam R - The parent entry type
 * @typeParam KT - The parent entries' key type
 */
export interface PlanChildren<R extends EastType = EastType, KT extends EastType = EastType> {
    /** Discriminant. */
    readonly [PLAN_CHILDREN]: true;
    /** The child collection, from the parent entry's value and key. */
    readonly of: (row: PlanEntryExpr<R>, key: ExprType<KT>) => Expr;
    /** The series over the child collection's entries, in order. */
    readonly series: readonly PlanSeriesValue<PlanAxisKindLiteral>[];
}

/**
 * A series' `children`:
 * - a bare accessor — more of THIS series' entries (`(a) => a.children`), to
 *   any depth: a `RecursiveType` entry's own children;
 * - `Plan.children(of, [series…])` — a step down to a child collection of
 *   another entry type;
 * - an array of step-downs — several child collections, in order.
 *
 * @typeParam R - The entry type
 * @typeParam KT - The entries' key type
 */
export type PlanChildrenInput<R extends EastType, KT extends EastType> =
    | ((row: PlanEntryExpr<R>, key: ExprType<KT>) => Expr)
    | PlanChildren<R, KT>
    | PlanChildren<R, KT>[];

/**
 * Step down from an entry to a child collection of another entry type (#822).
 *
 * @typeParam R - The parent entry type (inferred from where the step-down is used)
 * @typeParam KT - The parent entries' key type
 * @param of - The child collection — an `Array` (index order) or a `Dict` (key order) — from the parent entry
 * @param series - The series over the child entries, laid out like a top-level list
 * @returns The step-down, for a series' `children`
 */
export function createChildren<R extends EastType, KT extends EastType>(
    of: (row: PlanEntryExpr<R>, key: ExprType<KT>) => Expr,
    series: PlanSeriesValue<PlanAxisKindLiteral>[],
): PlanChildren<R, KT> {
    return { [PLAN_CHILDREN]: true, of, series };
}

function isStepDown(x: unknown): x is PlanChildren {
    return typeof x === "object" && x !== null && (x as { [PLAN_CHILDREN]?: unknown })[PLAN_CHILDREN] === true;
}

// ============================================================================
// Editing — the fields a gesture writes (#880)
// ============================================================================

/**
 * The fields of an entry as its accessors read them — a struct's own, or a
 * recursive entry's node's.
 *
 * @typeParam R - The entry type
 */
export type PlanEntryFields<R extends EastType> =
    R extends RecursiveType<infer U>
        ? (ExpandOnce<U, R> extends StructType<infer F> ? F : never)
        : R extends StructType<infer F> ? F : never;

/**
 * An entry field that holds a review verdict — an `ApprovalStateType` field,
 * what a series' `review.verdict` names.
 *
 * @typeParam R - The entry type
 */
export type PlanVerdictField<R extends EastType> = {
    [K in keyof PlanEntryFields<R> & string]: PlanEntryFields<R>[K] extends ApprovalStateType ? K : never;
}[keyof PlanEntryFields<R> & string];

/**
 * An entry field that holds a list of items — an `Array` field, what a
 * series' `edit.items` names.
 *
 * @typeParam R - The entry type
 */
export type PlanItemsField<R extends EastType> = {
    [K in keyof PlanEntryFields<R> & string]: PlanEntryFields<R>[K] extends ArrayType<EastType> ? K : never;
}[keyof PlanEntryFields<R> & string];

/**
 * The item type an entry's `Array` field holds.
 *
 * @typeParam R - The entry type
 * @typeParam F - The field
 */
export type PlanItemOf<R extends EastType, F extends string> =
    PlanEntryFields<R>[F] extends ArrayType<infer T extends EastType> ? T : never;

/**
 * What a review verdict writes on a series' rows (#880).
 *
 * @typeParam R - The entry type
 * @property verdict - The entry's `ApprovalStateType` field a verdict writes; the row shows it as its `approval`
 */
export interface PlanReviewInput<R extends EastType> {
    /** The entry's `ApprovalStateType` field a verdict writes — the row shows it as its `approval`. */
    verdict: PlanVerdictField<R>;
}

/**
 * Where a library card dropped on a series' row lands, and how it becomes an
 * item (#880) — one arm per `Array` field of the entry, so `create` is typed
 * by the field `items` names.
 *
 * @typeParam R - The entry type
 * @typeParam KT - The entries' key type
 * @property items - The entry's `Array` field the row's elements come from — the dropped card's item joins it
 * @property create - The new item, built from the drop (the card, the row and the bucket's instant), the entry and its key
 */
export type PlanEditInput<R extends EastType, KT extends EastType = StringType> = {
    [F in PlanItemsField<R>]: {
        /** The entry's `Array` field the row's elements come from — the dropped card's item joins it. */
        items: F;
        /** The new item — from the drop (the card, the row, the bucket's instant), the entry and its key. */
        create: (drop: ExprType<PlanDropType>, entry: PlanEntryExpr<R>, key: ExprType<KT>) => SubtypeExprOrValue<PlanItemOf<R, F>>;
    };
}[PlanItemsField<R>];

/** An edit declaration with its entry type erased — what the build machinery reads. */
interface AnyEditInput {
    items: string;
    create: (drop: ExprType<PlanDropType>, entry: ExprType<EastType>, key: ExprType<EastType>) => unknown;
}

// ============================================================================
// Series configs
// ============================================================================

/**
 * What every data series reads per entry — membership, the gutter, the row
 * facts, and its nesting. Optional accessors return the fields' `Option`
 * types, so presence is a per-row data fact.
 *
 * @typeParam R - The entry type
 * @typeParam KT - The entries' key type
 */
export interface PlanSeriesRowConfig<R extends EastType, KT extends EastType = StringType> extends PlanSeriesIdentity {
    /**
     * The East type of the entries' keys, as the accessors receive them —
     * `StringType` by default. Declare it when an accessor reads a key of
     * another type (`keyType: IntegerType` for an `Array` child's index, or a
     * source keyed by `Integer`); a series whose accessors ignore the key needs
     * none, whatever the collection.
     */
    keyType?: KT;
    /** Membership — omitted ⇒ every entry belongs. Applies at every level the series walks. */
    match?: PlanAccessor<R, BooleanType, KT>;
    /** Gutter label accessor. */
    label: PlanAccessor<R, StringType, KT>;
    /** Render labels as mono row ids. */
    id?: boolean;
    /** Two-line gutter layout (label over sub). */
    stacked?: boolean;
    /** Gutter sub-line accessor — returns the field's `Option`. */
    sub?: PlanAccessor<R, OptionType<StringType>, KT>;
    /** Gutter value-slot accessor — returns the field's `Option`. */
    value?: PlanAccessor<R, OptionType<StringType>, KT>;
    /** Per-row status-dot accessor — returns the field's `Option`. */
    status?: PlanAccessor<R, OptionType<StatusValueType>, KT>;
    /**
     * Per-row review-verdict accessor, READ-ONLY — returns the field's
     * `Option`.
     *
     * @remarks
     * Shows a verdict the canvas cannot change — one decided elsewhere, or
     * derived (`deriveApproval(r.flagged)`); the row's Approve / Reject stay
     * disabled. A verdict the canvas TAKES is declared with `review.verdict`,
     * which the row shows as its approval instead — give one or the other.
     */
    approval?: PlanAccessor<R, OptionType<ApprovalStateType>, KT>;
    /**
     * What a review verdict writes (#880) — the entry's `ApprovalStateType`
     * field. The row shows the field as its approval, and Approve / Reject on
     * it (or Approve all / Reject all over the canvas) draft the entry with the
     * field set, as one undoable gesture of the root's `editing` session.
     */
    review?: PlanReviewInput<R>;
    /** Per-row expand-in-place accessor — returns the field's `Option`. */
    expand?: PlanAccessor<R, OptionType<PlanExpandType>, KT>;
    /**
     * The entry's children — more of this series, or `Plan.children(of, [series…])` step-downs ({@link PlanChildrenInput}).
     *
     * @remarks
     * Not an inference site for the key type (`NoInfer`): a step-down that ignores
     * the key would otherwise widen it to every type, and the series' other
     * accessors would lose their typed key.
     */
    children?: PlanChildrenInput<R, NoInfer<KT>>;
    /** Initial collapse of a row that has children — a constant, or per entry. */
    collapsed?: boolean | PlanAccessor<R, BooleanType, KT>;
}

/** Config for {@link Plan.series.span} — state-run rows; a parent shows its own runs plus bands over its subtree's
 *  (each band sums its runs' quantities unit by unit — a quantity carries its unit, #824). */
export interface PlanSpanSeriesConfig<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType> extends PlanSeriesRowConfig<R, KT> {
    /** Per-row runs accessor — the runs' axis kind brands the series. */
    runs: PlanElementsAccessor<R, PlanRunType, K, KT>;
    /** Per-row decision-diamonds accessor. */
    decisions?: PlanElementsAccessor<R, PlanDecisionMarkType, K, KT>;
    /** Per-row ports accessor. */
    ports?: PlanElementsAccessor<R, typeof PlanPortType, K, KT>;
    /** How a row with children rolls its subtree's runs into its bands (default `"union"`). */
    rollup?: SubtypeExprOrValue<PlanRollupType> | PlanRollupLiteral;
    /** What a library card dropped on a row writes (#880) — the `Array` field its runs come from, and the new item. */
    edit?: PlanEditInput<R, KT>;
}

/** Config for {@link Plan.series.heat} — per-bucket cell rows; a parent shows its own cells, or its children's per-bucket `aggregate`. */
export interface PlanHeatSeriesConfig<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType> extends PlanSeriesRowConfig<R, KT> {
    /** Per-row cells accessor (`Plan.heatCells` / `Plan.weightCells` / `Plan.segmentCells`) — its kind brands the series. A parent may return no cells, and then shows its children's aggregate on `scale`. */
    cells: PlanKindedAccessor<R, PlanHeatCellsInput<K>, KT>;
    /** How a parent with no cells of its own derives them from its children (default `"mean"`). */
    aggregate?: SubtypeExprOrValue<PlanAggregateType> | PlanAggregateLiteral;
    /** The scale a parent's derived cells paint on (min / max / warn threshold, #824); omit ⇒ the extent
     *  they span. A row's own cells paint on their arm's scale. */
    scale?: PlanHeatScaleInput;
}

/** Config for {@link Plan.series.table} — bucketed numerals; a parent shows its own values, or per-position subtotals. */
export interface PlanTableSeriesOfConfig<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType> extends PlanSeriesRowConfig<R, KT> {
    /** Per-row cells accessor (`Plan.tableCells`) — sugar for one unstyled value series; its kind brands the series. A parent may return no cells, and then shows its children's subtotal. */
    cells?: PlanKindedAccessor<R, PlanTableCellsInput<K>, KT>;
    /** How a bucket folds the `cells` at a coarser resolution than theirs (default `"sum"`, #824) — a
     *  `series` entry declares its own (`Plan.tableSeries({ fold })`). */
    fold?: PlanFoldInput;
    /** Per-row MULTI-SERIES accessor (`Plan.tableSeries` results); exclusive with `cells`. */
    series?: PlanElementsAccessor<R, PlanTableSeriesType, K, KT>;
    /** Part layout when several value series render — `"horizontal"` (default) / `"vertical"`. */
    split?: SubtypeExprOrValue<PlanTableSplitType> | PlanTableSplitLiteral;
    /** Row emphasis — `"body"` (default) / `"header"` / `"footer"`. */
    emphasis?: SubtypeExprOrValue<PlanTableEmphasisType> | PlanTableEmphasisLiteral;
    /** How a parent with no values of its own subtotals its children (default `"sum"`). */
    aggregate?: SubtypeExprOrValue<TableAggregateType> | TableAggregateLiteral;
    /** Numeral format for the rows' values and derived subtotals — a `Format.*` spec. */
    format?: SubtypeExprOrValue<TickFormatType>;
}

/** Config for {@link Plan.series.buckets} — one bucket row per entry. */
export interface PlanBucketsSeriesConfig<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType> extends PlanSeriesRowConfig<R, KT> {
    /** Per-row sub-slot lanes accessor; omitted ⇒ unbucketed rows. */
    lanes?: PlanAccessor<R, ArrayType<PlanLaneType>, KT>;
    /** Per-row tiles accessor — the tiles' axis kind brands the series. */
    events: PlanElementsAccessor<R, PlanBucketEventType, K, KT>;
    /** Per-row cell-marker accessor. */
    markers?: PlanElementsAccessor<R, PlanCellMarkerType, K, KT>;
    /** What a library card dropped on a row writes (#880) — the `Array` field its tiles come from, and the new item. */
    edit?: PlanEditInput<R, KT>;
}

/** Config for {@link Plan.series.cards} — one cards row per entry. */
export interface PlanCardsSeriesConfig<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType> extends PlanSeriesRowConfig<R, KT> {
    /** Per-row shift-chips accessor — the chips' axis kind brands the series. */
    chips: PlanElementsAccessor<R, PlanChipType, K, KT>;
    /** What a library card dropped on a row writes (#880) — the `Array` field its chips come from, and the new item. */
    edit?: PlanEditInput<R, KT>;
}

/** Config for {@link Plan.series.events} — one event row per entry. */
export interface PlanEventsSeriesConfig<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType> extends PlanSeriesRowConfig<R, KT> {
    /** Per-row instant-marks accessor — the marks' axis kind brands the series. */
    marks: PlanElementsAccessor<R, PlanEventMarkType, K, KT>;
    /** What a library card dropped on a row writes (#880) — the `Array` field its marks come from, and the new item. */
    edit?: PlanEditInput<R, KT>;
}

/** Config for {@link Plan.series.chart} — one chart row per entry, layers built from the entry's own data. */
export interface PlanChartSeriesConfig<R extends EastType, KT extends EastType = StringType> extends PlanSeriesRowConfig<R, KT> {
    /** Per-row pinned accessor (`true` ⇒ above the virtualised body; `false` when omitted). */
    pinned?: PlanAccessor<R, BooleanType, KT>;
    /** Per-row Chart layers accessor (`Chart.*` builders, bare or `Plan.layer`-wrapped). */
    layers: (row: PlanEntryExpr<R>, key: ExprType<KT>) => PlanChartLayerInput | PlanChartLayerInput[];
    /** The left y-axis declaration (shared by this series' rows). */
    left?: PlanChartAxisInput;
    /** The right y-axis declaration. */
    right?: PlanChartAxisInput;
    /** Height mode — `"spark"` (default) / `"expanded"` / `Plan.fixed(px)`. */
    height?: PlanChartParts["height"];
    /** Height the EXPANDED state opens to (CSS px). */
    expandedHeight?: SubtypeExprOrValue<StringType>;
    /** Spark ↔ expanded toggle (caret). */
    expandable?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Gutter legend chips (shared by this series' rows). */
    swatches?: PlanGutterFields["swatches"];
}

/**
 * Config for {@link Plan.series.group} — one group strip PER ENTRY, its
 * members the entry's children.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the summary cells imply
 * @typeParam KT - The entries' key type
 */
export interface PlanGroupSeriesConfig<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType> extends PlanSeriesRowConfig<R, KT> {
    /** The strip's members — the entry's children (required: a group without members is a plain band). Not an inference site for the key type. */
    children: PlanChildrenInput<R, NoInfer<KT>>;
    /** Explicit collapsed-strip cells per entry; exclusive with `summaryAggregate`. */
    summary?: PlanKindedAccessor<R, PlanHeatCellsInput<K>, KT>;
    /** DECLARED strip aggregation over the members' heat cells — `"mean"` / `"max"` / `"sum"`; exclusive with `summary`. */
    summaryAggregate?: SubtypeExprOrValue<PlanAggregateType> | PlanAggregateLiteral;
}

/**
 * Config for {@link Plan.series.section} — a fixed titled block over series:
 * one header row, the member series' rows beneath it.
 *
 * @property collapsed - Whether the section starts collapsed
 * @property meta - A constant gutter meta line on the header
 * @property value - A constant value slot on the header
 * @property status - A status dot on the header
 * @property summary - Explicit collapsed-strip cells (exclusive with `summaryAggregate`)
 * @property summaryAggregate - Strip aggregation over the members' heat cells
 */
export interface PlanSectionSeriesConfig<K extends PlanAxisKindLiteral = never> extends PlanSeriesIdentity {
    /** Whether the section starts collapsed. */
    collapsed?: boolean;
    /** A constant gutter meta line on the header (the member count is derived and printed besides). */
    meta?: string;
    /** A constant right-aligned value slot on the header (`"98%"`). */
    value?: string;
    /** A status dot on the header. */
    status?: StatusValueLiteral;
    /** Explicit collapsed-strip cells (`Plan.heatCells`). */
    summary?: PlanHeatCellsInput<K>;
    /** DECLARED strip aggregation over the members' heat cells — `"mean"` / `"max"` / `"sum"`. */
    summaryAggregate?: SubtypeExprOrValue<PlanAggregateType> | PlanAggregateLiteral;
}

/**
 * Config for {@link Plan.series.views} — each entry gets one row per member
 * series, adjacent and in declared order; the entry's children follow its
 * view rows, under the first of them.
 *
 * @typeParam R - The entry type
 * @typeParam KT - The entries' key type
 */
export interface PlanViewsSeriesConfig<R extends EastType, KT extends EastType = StringType> extends PlanSeriesIdentity {
    /** The East type of the entries' keys, as the accessors receive them (default `StringType`). */
    keyType?: KT;
    /** Membership — omitted ⇒ every entry. A member series' own `match` then decides whether its row shows. */
    match?: PlanAccessor<R, BooleanType, KT>;
    /** The entry's children — under its first view row. Not an inference site for the key type. */
    children?: PlanChildrenInput<R, NoInfer<KT>>;
    /** Initial collapse of the first view row, when the entry has children. */
    collapsed?: boolean | PlanAccessor<R, BooleanType, KT>;
}

// ============================================================================
// Build specs — how each series is built for a collection type
// ============================================================================

const PathType = ArrayType(StringType);
const IdOptType = OptionType(PlanRowIdType);

/** A series' rows for entries of a collection, as one stream: `(collection, prefix path, parent id) → rows`. */
type EmitFn = ExprType<FunctionType<[EastType, ArrayType<StringType>, OptionType<PlanRowIdType>], PlanRowsCollectionType>>;
/** A series' BLOCKS for entries of a collection (#823): `(collection, prefix path, parent id) → blocks`. */
type BlocksFn = ExprType<FunctionType<[EastType, ArrayType<StringType>, OptionType<PlanRowIdType>], PlanBlocksType>>;
/** One entry's row: `(value, key, id, parent, hasChildren, collapsed) → row`. */
type EntryRowFn = ExprType<FunctionType<[EastType, EastType, PlanRowIdType, OptionType<PlanRowIdType>, BooleanType, BooleanType], PlanRowType>>;
/** An entry's membership: `(value, key) → Boolean`. */
type MatchFn = ExprType<FunctionType<[EastType, EastType], BooleanType>>;
/** An entry's collapse: `(value, key) → Boolean`. */
type CollapsedFn = ExprType<FunctionType<[EastType, EastType], BooleanType>>;
/** An entry's children rows: `(value, key, id, path) → rows`. */
type ChildrenFn = ExprType<FunctionType<[EastType, EastType, PlanRowIdType, ArrayType<StringType>], PlanRowsCollectionType>>;
/**
 * A series' writer for entries of a collection (#880): `(entry, key, path,
 * depth, series, gesture) → the entry written`. `path[0 … depth)` leads to the
 * entry, and the row is the entry's own when `depth = |path|`, else below it;
 * `none` when no series here takes the gesture on that row. The entry is a
 * DETACHED value — a nested entry is written in place in its collection, so
 * only the entry itself is ever rebuilt.
 */
type WriteFn = ExprType<FunctionType<[EastType, EastType, ArrayType<StringType>, IntegerType, StringType, PlanGestureType], OptionType<EastType>>>;
/** An entry's own edit: `(entry, key, gesture) → the entry written`, or `none` when its series declares no field for the gesture. */
type OwnEditFn = ExprType<FunctionType<[EastType, EastType, PlanGestureType], OptionType<EastType>>>;
/** A series' write at the top of a canvas — the series value's `write`: `(entry, key, row, gesture) → the entry written`. */
type TopWriteFn = ExprType<FunctionType<[EastType, EastType, PlanRowIdType, PlanGestureType], OptionType<EastType>>>;

/** One entry's row functions, built for one key type — what `views` calls per member. */
interface EntryParts {
    match: MatchFn | undefined;
    row: EntryRowFn;
}

/**
 * How a series is BUILT — recorded by its builder beside the East value, so a
 * parent can build it for its own collection type and the root can walk the
 * whole series tree.
 */
interface PlanSeriesSpec {
    /** The series key. */
    readonly key: string;
    /** The series title. */
    readonly title: string;
    /** The series' kind. */
    readonly arm: PlanSeriesArm;
    /** The series nested inside this one — section / views members and step-down series — for the key walk. */
    readonly nested: readonly PlanSeriesSpec[];
    /** Whether the series declares `children`. */
    readonly nests: boolean;
    /** This series' rows for entries of `collection`, as ONE stream — what an
     *  entry's subtree holds when a step-down lays the series out below it. */
    emitter(collection: EastType, where: string): EmitFn;
    /** This series' BLOCKS for entries of `collection` — how it lays out at
     *  the top of the canvas, or inside a section there (#823). */
    blocks(collection: EastType, where: string): BlocksFn;
    /** A `views` member's single-entry row functions (data kinds only). */
    entryParts?(entry: EastType, key: EastType, where: string): EntryParts;
    /** A data series' children rows for entries keyed by `key` (`views` reuses it for its own children). */
    childrenFor?(key: EastType): ChildrenFn | undefined;
    /** A data series' collapse for entries keyed by `key` (`views` reuses it for its first row). */
    collapsedFor?(key: EastType): CollapsedFn | undefined;
    /** This series' writer for entries of `collection` (#880) — `undefined` when nothing in its tree takes a gesture. */
    writer(collection: EastType, where: string): WriteFn | undefined;
    /** A data series' own edit for entries keyed by `key` (#880; `views` dispatches its members' by key) —
     *  `undefined` when it declares neither `review` nor `edit`. */
    ownFor?(key: EastType): OwnEditFn | undefined;
}

/** Every series value a builder made, with its build spec. */
const SPECS = new WeakMap<object, PlanSeriesSpec>();

/** The spec of a series value a `Plan.series.*` builder made, if it was one. */
function specOf(s: unknown): PlanSeriesSpec | undefined {
    return typeof s === "object" && s !== null ? SPECS.get(s) : undefined;
}

/** A series value inside a composite series — it must come from a builder, since the parent builds it for its own entries. */
function nestedSpec(s: unknown, where: string): PlanSeriesSpec {
    const spec = specOf(s);
    if (spec === undefined) {
        throw new Error(
            `${where}: a nested series must be a \`Plan.series.*\` value written in place — the parent builds it ` +
            "for its own entries, so a series bound to a variable elsewhere cannot be nested here");
    }
    return spec;
}

/** A readable name for a series, in messages. */
function nameOf(spec: Pick<PlanSeriesSpec, "arm" | "title">): string {
    return `${spec.arm} "${spec.title}"`;
}

/** A collection type's entry and key types — a `Dict`'s value and key, an `Array`'s element and `Integer` index. */
function shapeOf(collection: EastType, where: string): { entry: EastType; key: EastType } {
    const t = collection as { type: string; key?: EastType; value?: EastType };
    if (t.type === "Dict") return { entry: t.value!, key: t.key! };
    if (t.type === "Array") return { entry: t.value!, key: IntegerType };
    throw new Error(`${where}: entries come from a Dict (keyed) or an Array (by index) — got a ${t.type}`);
}

/** Refuse a collection whose entries are not the series' entry type. */
function assertEntry(entry: EastType, rowType: EastType, where: string): void {
    if (!isTypeEqual(entry, rowType)) {
        throw new Error(
            `${where}: the series is built over one entry type and applied to entries of another — ` +
            `pass the entries' own type as the series' first argument`);
    }
}

/** A path segment from a key — a String key as is, any other key as its `.east` text. */
function segmentOf(keyType: EastType): (key: ExprType<EastType>) => ExprType<StringType> {
    return (keyType as { type: string }).type === "String"
        ? (key) => key as unknown as ExprType<StringType>
        : (key) => East.print(key);
}

/**
 * A series' rows as ONE block (#823) — a data series' entries (`fixed: false`),
 * or rows no entry produces (`fixed: true`: hand-built rows), under the parent
 * the block nests in.
 *
 * @param collection - The collection type the rows are built for
 * @param rows - The series' rows emitter for that collection
 * @param fixed - Whether no entry produces the rows
 * @returns The block list's emitter
 */
function oneBlock(collection: EastType, rows: EmitFn, fixed: boolean): BlocksFn {
    return East.function([collection, PathType, IdOptType], PlanBlocksType, ($, coll, prefix, parent) => {
        const block = $.let(East.value({ fixed, parent, rows: rows(coll, prefix, parent) }, PlanBlockType), PlanBlockType);
        return East.value([block], PlanBlocksType);
    }) as unknown as BlocksFn;
}

/** A cache of built functions by East type. */
class ByType<T> {
    private readonly entries: { type: EastType; value: T }[] = [];
    get(type: EastType, build: () => T): T {
        const hit = this.entries.find((e) => isTypeEqual(e.type, type));
        if (hit !== undefined) return hit.value;
        const value = build();
        this.entries.push({ type, value });
        return value;
    }
}

/** Build `fn`, naming the series and the key type when its accessors do not build for it. */
function building<T>(where: string, keyType: EastType, fn: () => T): T {
    try {
        return fn();
    } catch (err) {
        const kt = (keyType as { type: string }).type;
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
            `${where}: its accessors do not build for entries keyed by ${kt} (${reason}) — the key an accessor ` +
            `receives is the collection's: the source's key, a Dict child's key, or an Array child's Integer ` +
            "index. Declare the key type the accessors expect with `keyType`, or leave the key unread.");
    }
}

// ── Writing a gesture back (#880) ─────────────────────────────────────────────

/**
 * How an accessor reaches the collection it returns, when a write can follow
 * it: a field of the entry (through a recursive entry's node), or the entry
 * itself.
 */
type ChildRef = { readonly kind: "field"; readonly field: string } | { readonly kind: "self" };

/**
 * How `accessor` reaches the child collection it returns, read off the
 * expression it builds (#880): a plain field of the entry (`r => r.children`,
 * `Plan.children(r => r.lines, …)`), or the entry itself (`g => g`). A write
 * follows either back into the entry. Anything else — a filtered or computed
 * collection — is a copy a write would be lost in, and is `undefined`.
 *
 * @param rowType - The entry type
 * @param keyType - The entries' key type
 * @param accessor - The accessor, over the entry (its node, when recursive) and key
 * @returns How it reaches its collection, or `undefined` when a write cannot follow it
 */
function childRefOf(
    rowType: EastType,
    keyType: EastType,
    accessor: (v: ExprType<EastType>, k: ExprType<EastType>) => Expr,
): ChildRef | undefined {
    const recursive = (rowType as { type: string }).type === "Recursive";
    let found: ChildRef | undefined;
    East.function([rowType, keyType], undefined, (_$, v, k) => {
        const node = recursive ? (v as unknown as RecursiveExpr<EastType>).unwrap() as ExprType<EastType> : v;
        const out = accessor(node, k);
        const ast = Expr.ast(out) as unknown as { ast_type: string; field?: string; struct?: unknown };
        const param = Expr.ast(v as unknown as Expr) as unknown;
        const nodeAst = Expr.ast(node as unknown as Expr) as unknown;
        if (ast === param || ast === nodeAst) found = { kind: "self" };
        else if (ast.ast_type === "GetField" && ast.field !== undefined && (ast.struct === nodeAst || ast.struct === param)) {
            found = { kind: "field", field: ast.field };
        }
        return out;
    });
    return found;
}

/** Each key type's segment reader, built once. */
const segmentKeys = new ByType<ExprType<FunctionType<[StringType], EastType>>>();

/**
 * A path segment read back as its collection's key (#880) — the inverse of
 * {@link segmentOf}: a String key as it is, any other key its `.east` text
 * parsed (an `Array` child's segment is its Integer index).
 *
 * @param keyType - The collection's key type
 * @returns `(segment) → key`
 */
function segmentKeyOf(keyType: EastType): ExprType<FunctionType<[StringType], EastType>> {
    return segmentKeys.get(keyType, () => ((keyType as { type: string }).type === "String"
        ? East.function([StringType], StringType, (_$, s) => s)
        : East.function([StringType], keyType, (_$, s) => s.parse(keyType))) as unknown as ExprType<FunctionType<[StringType], EastType>>);
}

/**
 * A child collection's part of a write (#880) — whether it holds a key, its
 * entry at it, and that entry written back in place. A `Dict` by key; an
 * `Array` by index.
 */
function collectionOps(collection: EastType): {
    has: (coll: ExprType<EastType>, key: ExprType<EastType>) => ExprType<BooleanType>;
    get: (coll: ExprType<EastType>, key: ExprType<EastType>) => ExprType<EastType>;
    put: (coll: ExprType<EastType>, key: ExprType<EastType>, value: ExprType<EastType>) => ExprType<EastType>;
} {
    if ((collection as { type: string }).type === "Dict") {
        const dict = (c: ExprType<EastType>) => c as unknown as ExprType<DictType<EastType, EastType>>;
        return {
            has: (c, k) => dict(c).has(k),
            get: (c, k) => dict(c).get(k) as ExprType<EastType>,
            put: (c, k, v) => dict(c).update(k, v) as unknown as ExprType<EastType>,
        };
    }
    const array = (c: ExprType<EastType>) => c as unknown as ExprType<ArrayType<EastType>>;
    const index = (k: ExprType<EastType>) => k as unknown as ExprType<IntegerType>;
    return {
        has: (c, k) => index(k).greaterEqual(0n).and(() => index(k).less(array(c).size())),
        get: (c, k) => array(c).get(index(k)) as ExprType<EastType>,
        put: (c, k, v) => array(c).update(index(k), v) as unknown as ExprType<EastType>,
    };
}

/**
 * What a data series' kind contributes to its entry row — the kind, and any
 * row fact beyond the shared envelope.
 */
interface KindRecipe {
    arm: PlanSeriesArm;
    /** The row's kind, from the entry and whether it has child rows. */
    kind(value: ExprType<EastType>, key: ExprType<EastType>, hasChildren: ExprType<BooleanType>): ExprType<PlanRowKindType>;
    /** The row's `pinned`, when the kind reads one (chart). */
    pinned?(value: ExprType<EastType>, key: ExprType<EastType>): SubtypeExprOrValue<BooleanType>;
    /** Gutter legend chips (chart). */
    swatches?: PlanGutterFields["swatches"];
    /** Where a dropped card lands and how it becomes an item (#880) — the kinds holding discrete objects. */
    edit?: AnyEditInput | undefined;
}

/** Erase a config's entry type for the untyped build machinery. */
type AnyRowConfig = PlanSeriesRowConfig<EastType, EastType>;

/**
 * The build spec of a data series (span / buckets / chart / heat / table /
 * cards / events / group).
 *
 * @remarks
 * Per key type it builds ONE entry-row function (the entry's gutter, kind and
 * row facts through the one envelope) and the membership, collapse and
 * children functions, each reified once and CALLED in the block's loop. The
 * block walks the collection in order; each matched entry's row is followed by
 * its children's rows — a bare `children` accessor walks the entry's subtree
 * with an explicit pre-order stack (its depth is data), a step-down calls its
 * child series' blocks on the child collection.
 */
function dataSpec(rowType: EastType, cfg: AnyRowConfig, recipe: KindRecipe): PlanSeriesSpec {
    const where = `Plan.series.${recipe.arm} "${cfg.key}"`;
    const children = cfg.children;
    const steps: PlanChildren[] = children === undefined || typeof children === "function"
        ? [] : (Array.isArray(children) ? children : [children as PlanChildren]);
    for (const step of steps) {
        if (!isStepDown(step)) {
            throw new Error(`${where}: \`children\` is an accessor for more of this series, or \`Plan.children(of, [series…])\` step-downs`);
        }
    }
    const nested = steps.flatMap((s) => s.series.map((x) => nestedSpec(x, `${where} › children`)));
    // A recursive entry reaches the accessors as its NODE (`PlanEntryExpr`),
    // so they read its fields directly at every depth.
    const recursive = (rowType as { type: string }).type === "Recursive";
    const nodeOf = (value: ExprType<EastType>): ExprType<EastType> => recursive
        ? (value as unknown as RecursiveExpr<EastType>).unwrap() as ExprType<EastType>
        : value;
    /** An accessor over entries, applied to an entry value (its node, when recursive). */
    const onEntry = (accessor: (v: ExprType<EastType>, k: ExprType<EastType>) => Expr) =>
        (v: ExprType<EastType>, k: ExprType<EastType>): Expr => accessor(nodeOf(v), k);

    // What a gesture writes (#880) — a verdict into `review.verdict`, a
    // dropped card into `edit.items` — each a FIELD of the entry (its node,
    // when recursive), checked here so a misnamed field fails the build.
    const review = cfg.review as { verdict: string } | undefined;
    const edit = recipe.edit;
    const nodeType = (recursive ? (rowType as RecursiveType<EastType>).node : rowType) as { type: string; fields?: Record<string, EastType> };
    if ((review !== undefined || edit !== undefined) && nodeType.type !== "Struct") {
        throw new Error(`${where}: \`review\` and \`edit\` write a field of the entry — its entries must be structs (a recursive entry's node included)`);
    }
    const entryFields = nodeType.fields ?? {};
    if (review !== undefined) {
        if (cfg.approval !== undefined) {
            throw new Error(`${where}: give \`review.verdict\` (the field a verdict writes, which the row shows) or \`approval\` (a verdict the canvas only shows) — not both`);
        }
        const t = entryFields[review.verdict];
        if (t === undefined || !isTypeEqual(t, ApprovalStateType)) {
            throw new Error(`${where}: \`review.verdict\` names "${review.verdict}", which is not an ApprovalStateType field of the entry`);
        }
    }
    let itemType: EastType | undefined;
    if (edit !== undefined) {
        const t = entryFields[edit.items] as { type: string; value?: EastType } | undefined;
        if (t === undefined || t.type !== "Array") {
            throw new Error(`${where}: \`edit.items\` names "${edit.items}", which is not an Array field of the entry — a dropped card joins a list of items`);
        }
        itemType = t.value;
    }
    const edits = review !== undefined || edit !== undefined ? { verdict: review !== undefined, drop: edit !== undefined } : undefined;

    const rows = new ByType<EntryRowFn>();
    const matches = new ByType<MatchFn | undefined>();
    const collapses = new ByType<CollapsedFn | undefined>();
    const kids = new ByType<ChildrenFn | undefined>();
    const walks = new ByType<ExprType<FunctionType<[EastType, ArrayType<StringType>, PlanRowIdType], PlanRowsCollectionType>>>();
    const emitters = new ByType<EmitFn>();
    const blockLists = new ByType<BlocksFn>();

    const rowFor =(kt: EastType): EntryRowFn => rows.get(kt, () => building(where, kt, () => East.function(
        [rowType, kt, PlanRowIdType, IdOptType, BooleanType, BooleanType], PlanRowType,
        ($, value, key, id, parent, hasChildren, collapsed) => {
            // The node every accessor reads, unwrapped once.
            const entry = recursive ? $.let(nodeOf(value)) : value;
            return planRow({
                id, parent,
                gutter: planGutter({
                    label: cfg.label(entry, key),
                    ...(cfg.id !== undefined ? { id: cfg.id } : {}),
                    ...(cfg.stacked !== undefined ? { stacked: cfg.stacked } : {}),
                    ...(cfg.sub !== undefined ? { sub: cfg.sub(entry, key) } : {}),
                    ...(cfg.value !== undefined ? { value: cfg.value(entry, key) } : {}),
                    ...(recipe.swatches !== undefined ? { swatches: recipe.swatches } : {}),
                }),
                kind:      recipe.kind(entry, key, hasChildren),
                collapsed,
                ...(recipe.pinned !== undefined ? { pinned: recipe.pinned(entry, key) } : {}),
                ...(cfg.status !== undefined ? { status: cfg.status(entry, key) } : {}),
                // A verdict the canvas takes shows from its field (#880) — so
                // a drafted verdict draws where it was made.
                ...(review !== undefined
                    ? { approval: some((entry as unknown as Record<string, ExprType<ApprovalStateType>>)[review.verdict]!) }
                    : cfg.approval !== undefined ? { approval: cfg.approval(entry, key) } : {}),
                ...(cfg.expand !== undefined ? { expand: cfg.expand(entry, key) } : {}),
                ...(edits !== undefined ? { edits } : {}),
            });
        },
    ) as unknown as EntryRowFn));

    const matchFor = (kt: EastType): MatchFn | undefined => matches.get(kt, () => {
        const match = cfg.match;
        if (match === undefined) return undefined;
        return building(where, kt, () => East.function([rowType, kt], BooleanType,
            (_$, value, key) => match(nodeOf(value), key)) as unknown as MatchFn);
    });

    const collapsedFor = (kt: EastType): CollapsedFn | undefined => collapses.get(kt, () => {
        const collapsed = cfg.collapsed;
        if (collapsed === undefined) return undefined;
        return building(where, kt, () => East.function([rowType, kt], BooleanType, (_$, value, key) =>
            typeof collapsed === "boolean"
                ? East.value(collapsed, BooleanType)
                : East.value(collapsed(nodeOf(value), key), BooleanType)) as unknown as CollapsedFn);
    });

    /** A bare `children` accessor, built for entries keyed by `kt` — the child collection's type is its output. */
    const childOf = (kt: EastType) => building(where, kt, () =>
        reifyAccessor([rowType, kt], onEntry(children as (v: ExprType<EastType>, k: ExprType<EastType>) => Expr))) as unknown as
        ExprType<FunctionType<[EastType, EastType], EastType>>;

    /** The subtree walk below one entry — every level's entries in pre-order, over the child collection type. */
    const walkFor = (cc: EastType): ExprType<FunctionType<[EastType, ArrayType<StringType>, PlanRowIdType], PlanRowsCollectionType>> =>
        walks.get(cc, () => {
            const at = `${where} › children`;
            const { entry, key: kc } = shapeOf(cc, at);
            assertEntry(entry, rowType, `${at} (a bare accessor returns more of this series' entries — step down to another type with Plan.children)`);
            const next = childOf(kc);
            const nextType = (Expr.type(next) as unknown as { output: EastType }).output;
            if (!isTypeEqual(nextType, cc)) {
                throw new Error(`${at}: a recursive series' children must be the same collection type at every level`);
            }
            const row = rowFor(kc);
            const match = matchFor(kc);
            const collapsed = collapsedFor(kc);
            const seg = segmentOf(kc);
            const Frame = StructType({ value: rowType, key: kc, path: PathType, parent: PlanRowIdType });
            const Frames = ArrayType(Frame);
            // A level's matched entries as frames, REVERSED — so the stack
            // pops the first of them first.
            const framesOf = East.function([cc, PathType, PlanRowIdType], Frames, ($, coll, path, parentId) => {
                const frames = $.let([], Frames);
                const member = match === undefined ? undefined : $.const(match);
                $.for(coll as ExprType<ArrayType<EastType>>, ($2, value, key) => {
                    const add = ($3: typeof $2) => {
                        const segs = $3.let(East.value([seg(key as ExprType<EastType>)], PathType), PathType);
                        $3(frames.pushLast(East.value({ value, key, path: path.concat(segs), parent: parentId }, Frame)));
                    };
                    if (member === undefined) add($2);
                    else $2.if(member(value, key), add);
                });
                $(frames.reverseInPlace());
                return frames;
            });
            return East.function([cc, PathType, PlanRowIdType], PlanRowsCollectionType, ($, coll, path0, parent0) => {
                // Every function the loop calls, bound ONCE — a captured function
                // referenced in the loop would be re-inlined per use.
                const frames = $.const(framesOf);
                const childrenOf = $.const(next);
                const entryRow = $.const(row);
                const collapse = collapsed === undefined ? undefined : $.const(collapsed);
                const out = $.let([], PlanRowsCollectionType);
                const stack = $.let(frames(coll, path0, parent0), Frames);
                $.while(stack.size().greater(0n), ($2) => {
                    const f = $2.let(stack.popLast(), Frame);
                    const id = $2.let(East.value(variant("entry", { series: cfg.key, path: f.path }), PlanRowIdType), PlanRowIdType);
                    const below = $2.let(frames(childrenOf(f.value, f.key), f.path, id), Frames);
                    const parent = $2.let(East.value(some(f.parent), IdOptType), IdOptType);
                    const fold = $2.let(collapse === undefined
                        ? East.value(false, BooleanType)
                        : collapse(f.value, f.key), BooleanType);
                    $2(out.pushLast(entryRow(f.value, f.key, id, parent, below.size().greater(0n), fold)));
                    $2(stack.append(below));
                });
                return out;
            });
        });

    const childrenFor = (kt: EastType): ChildrenFn | undefined => kids.get(kt, () => {
        if (children === undefined) return undefined;
        if (typeof children === "function") {
            const of = childOf(kt);
            const cc = (Expr.type(of) as unknown as { output: EastType }).output;
            const walk = walkFor(cc);
            return East.function([rowType, kt, PlanRowIdType, PathType], PlanRowsCollectionType,
                (_$, value, key, id, path) => walk(of(value, key), path, id)) as unknown as ChildrenFn;
        }
        const parts = steps.map((step, i) => {
            const at = `${where} › children[${i}]`;
            const of = building(at, kt, () => reifyAccessor([rowType, kt], onEntry(step.of as (v: ExprType<EastType>, k: ExprType<EastType>) => Expr))) as unknown as
                ExprType<FunctionType<[EastType, EastType], EastType>>;
            const cc = (Expr.type(of) as unknown as { output: EastType }).output;
            const blocks = step.series.map((s) => nestedSpec(s, at).emitter(cc, at));
            return { of, cc, blocks };
        });
        return East.function([rowType, kt, PlanRowIdType, PathType], PlanRowsCollectionType, ($, value, key, id, path) => {
            const out = $.let([], PlanRowsCollectionType);
            const under = $.let(East.value(some(id), IdOptType), IdOptType);
            for (const part of parts) {
                const coll = $.let(part.of(value, key), part.cc);
                for (const block of part.blocks) $(out.append(block(coll, path, under)));
            }
            return out;
        }) as unknown as ChildrenFn;
    });

    // ── Writing a gesture back (#880) ─────────────────────────────────────
    // The entry a writer is handed is DETACHED (the series value's `write`
    // copies it), so a nested entry is written in place in its collection and
    // a dropped card's item joins its list in place: only an entry whose OWN
    // field changes — a verdict — is rebuilt.
    const owns = new ByType<OwnEditFn | undefined>();
    const writers = new ByType<WriteFn | undefined>();
    const entryAccess = (value: ExprType<EastType>) => nodeOf(value) as unknown as Record<string, ExprType<EastType>>;

    /** The entry with its verdict field set — rebuilt, every other field as it was. */
    const withVerdict = review === undefined ? undefined : East.function([rowType, ApprovalStateType], rowType, ($, value, verdict) => {
        const node = recursive ? $.let(nodeOf(value)) : value;
        const read = node as unknown as Record<string, ExprType<EastType>>;
        const rebuilt = East.value(
            Object.fromEntries(Object.keys(entryFields).map((f) => [f, f === review.verdict ? verdict : read[f]!])) as unknown as SubtypeExprOrValue<EastType>,
            nodeType as EastType,
        ) as ExprType<EastType>;
        return recursive ? East.wrapRecursive(rebuilt, rowType as RecursiveType<EastType>) as ExprType<EastType> : rebuilt;
    });

    /** The item a dropped card becomes, for entries keyed by `kt`. */
    const createFor = (kt: EastType) => building(where, kt, () => East.function(
        [PlanDropType, rowType, kt], itemType!,
        (_$, drop, value, key) => edit!.create(drop, nodeOf(value), key) as SubtypeExprOrValue<EastType>,
    ));

    /** This series' own edit on one of its entries: a verdict into its field, a dropped card's item into its list. */
    const ownFor = (kt: EastType): OwnEditFn | undefined => owns.get(kt, () => {
        if (review === undefined && edit === undefined) return undefined;
        const create = edit !== undefined ? createFor(kt) : undefined;
        return East.function([rowType, kt, PlanGestureType], OptionType(rowType), ($, value, key, gesture) => {
            const setVerdict = withVerdict === undefined ? undefined : $.const(withVerdict);
            const make = create === undefined ? undefined : $.const(create);
            const result = $.let(none, OptionType(rowType));
            $.match(gesture, {
                verdict: ($2, verdict) => {
                    if (setVerdict !== undefined) $2.assign(result, some(setVerdict(value, verdict)));
                },
                drop: ($2, drop) => {
                    if (make === undefined || edit === undefined) return;
                    const list = $2.let(entryAccess(value)[edit.items]! as unknown as ExprType<ArrayType<EastType>>);
                    $2(list.pushLast(make(drop, value, key)));
                    $2.assign(result, some(value));
                },
            });
            return result;
        }) as unknown as OwnEditFn;
    });

    /** The walk's writer — a bare `children` accessor: the rows below an entry are this series' own. */
    const walkWriterFor = (kt: EastType): WriteFn | undefined => {
        const at = `${where} › children`;
        const of = childOf(kt);
        const cc = (Expr.type(of) as unknown as { output: EastType }).output;
        const { key: kc } = shapeOf(cc, at);
        const own = ownFor(kc);
        if (own === undefined) return undefined;
        const ref = childRefOf(rowType, kt, children as (v: ExprType<EastType>, k: ExprType<EastType>) => Expr);
        if (ref === undefined) {
            throw new Error(
                `${at}: this series takes gestures, and one on a child row is written back into its entry through ` +
                "`children` — which must read a field of the entry (`r => r.children`), not compute a collection");
        }
        const ops = collectionOps(cc);
        const collOf = (entry: ExprType<EastType>) => (ref.kind === "field" ? entryAccess(entry)[ref.field]! : nodeOf(entry));
        return East.function([rowType, kt, PathType, IntegerType, StringType, PlanGestureType], OptionType(rowType),
            ($, value, _key, path, depth, series, gesture) => {
                const result = $.let(none, OptionType(rowType));
                // The walk's rows are this series' own, at every depth.
                $.if(series.equal(cfg.key), ($2) => {
                    const write = $2.const(own);
                    const keyOf = $2.const(segmentKeyOf(kc));
                    const cur = $2.let(value, rowType);
                    const d = $2.let(depth, IntegerType);
                    const last = $2.let(path.size().subtract(1n), IntegerType);
                    // Down to the target's parent, then the target itself.
                    $2.while(d.less(last), ($3) => {
                        const coll = $3.let(collOf(cur), cc);
                        $3.assign(cur, ops.get(coll, keyOf(path.get(d))));
                        $3.assign(d, d.add(1n));
                    });
                    const coll = $2.let(collOf(cur), cc);
                    const k = $2.let(keyOf(path.get(last)), kc);
                    const written = $2.let(write(ops.get(coll, k), k, gesture), OptionType(rowType));
                    $2.match(written, {
                        some: ($3, entry) => {
                            $3(ops.put(coll, k, entry));
                            $3.assign(result, some(value));
                        },
                    });
                });
                return result;
            }) as unknown as WriteFn;
    };

    /** The step-downs' writer: a row below an entry is one of a step-down's series', in that step's collection. */
    const stepsWriterFor = (kt: EastType): WriteFn | undefined => {
        const parts = steps.flatMap((step, i) => {
            const at = `${where} › children[${i}]`;
            const accessor = step.of as (v: ExprType<EastType>, k: ExprType<EastType>) => Expr;
            const of = building(at, kt, () => reifyAccessor([rowType, kt], onEntry(accessor))) as unknown as
                ExprType<FunctionType<[EastType, EastType], EastType>>;
            const cc = (Expr.type(of) as unknown as { output: EastType }).output;
            const writes = step.series
                .map((s) => nestedSpec(s, at).writer(cc, at))
                .filter((w): w is WriteFn => w !== undefined);
            if (writes.length === 0) return [];
            const ref = childRefOf(rowType, kt, accessor);
            if (ref === undefined) {
                throw new Error(
                    `${at}: a series under this step-down takes gestures, and one on its rows is written back into ` +
                    "the entry through `Plan.children(of, …)` — `of` must read a field of the entry (`r => r.lines`) " +
                    "or be the entry itself (`g => g`), not compute a collection");
            }
            const { entry: childType, key: kc } = shapeOf(cc, at);
            return [{ ref, cc, kc, childType, writes }];
        });
        if (parts.length === 0) return undefined;
        return East.function([rowType, kt, PathType, IntegerType, StringType, PlanGestureType], OptionType(rowType),
            ($, value, _key, path, depth, series, gesture) => {
                const result = $.let(none, OptionType(rowType));
                for (const part of parts) {
                    const ops = collectionOps(part.cc);
                    const keyOf = $.const(segmentKeyOf(part.kc));
                    const writes = part.writes.map((w) => $.const(w));
                    $.if(result.hasTag("none"), ($2) => {
                        const coll = $2.let(part.ref.kind === "field" ? entryAccess(value)[part.ref.field]! : nodeOf(value), part.cc);
                        const k = $2.let(keyOf(path.get(depth)), part.kc);
                        $2.if(ops.has(coll, k), ($3) => {
                            const child = $3.let(ops.get(coll, k), part.childType);
                            for (const write of writes) {
                                $3.if(result.hasTag("none"), ($4) => {
                                    const written = $4.let(write(child, k, path, depth.add(1n), series, gesture), OptionType(part.childType));
                                    $4.match(written, {
                                        some: ($5, entry) => {
                                            $5(ops.put(coll, k, entry));
                                            $5.assign(result, some(value));
                                        },
                                    });
                                });
                            }
                        });
                    });
                }
                return result;
            }) as unknown as WriteFn;
    };

    /** This series' writer for entries keyed by `kt`: its own rows' edits, and the rows below them. */
    const writerFor = (kt: EastType): WriteFn | undefined => writers.get(kt, () => {
        const own = ownFor(kt);
        const below = children === undefined ? undefined
            : typeof children === "function" ? walkWriterFor(kt) : stepsWriterFor(kt);
        if (own === undefined && below === undefined) return undefined;
        return East.function([rowType, kt, PathType, IntegerType, StringType, PlanGestureType], OptionType(rowType),
            ($, value, key, path, depth, series, gesture) => {
                const result = $.let(none, OptionType(rowType));
                $.if(depth.equal(path.size()), ($2) => {
                    if (own === undefined) return;
                    const write = $2.const(own);
                    $2.if(series.equal(cfg.key), ($3) => { $3.assign(result, write(value, key, gesture)); });
                }).else(($2) => {
                    if (below === undefined) return;
                    const write = $2.const(below);
                    $2.assign(result, write(value, key, path, depth, series, gesture));
                });
                return result;
            }) as unknown as WriteFn;
    });

    const spec: PlanSeriesSpec = {
        key: cfg.key,
        title: cfg.title,
        arm: recipe.arm,
        nested,
        nests: children !== undefined,
        emitter(collection, at) {
            return emitters.get(collection, () => {
                const { entry, key: kt } = shapeOf(collection, at);
                assertEntry(entry, rowType, where);
                const row = rowFor(kt);
                const match = matchFor(kt);
                const collapsed = collapsedFor(kt);
                const below = childrenFor(kt);
                const seg = segmentOf(kt);
                return East.function([collection, PathType, IdOptType], PlanRowsCollectionType, ($, coll, prefix, parent) => {
                    // Every function the loop calls, bound ONCE (see the walk).
                    const entryRow = $.const(row);
                    const member = match === undefined ? undefined : $.const(match);
                    const collapse = collapsed === undefined ? undefined : $.const(collapsed);
                    const childRows = below === undefined ? undefined : $.const(below);
                    const out = $.let([], PlanRowsCollectionType);
                    $.for(coll as ExprType<ArrayType<EastType>>, ($2, value, key) => {
                        const emit = ($3: typeof $2) => {
                            const segs = $3.let(East.value([seg(key as ExprType<EastType>)], PathType), PathType);
                            const path = $3.let(prefix.concat(segs), PathType);
                            const id = $3.let(East.value(variant("entry", { series: cfg.key, path }), PlanRowIdType), PlanRowIdType);
                            const fold = $3.let(collapse === undefined
                                ? East.value(false, BooleanType)
                                : collapse(value, key), BooleanType);
                            if (childRows === undefined) {
                                $3(out.pushLast(entryRow(value, key, id, parent, false, fold)));
                                return;
                            }
                            // The children are built first: a row rolls up
                            // (span bands) only when it has child rows.
                            const sub = $3.let(childRows(value, key, id, path), PlanRowsCollectionType);
                            $3(out.pushLast(entryRow(value, key, id, parent, sub.size().greater(0n), fold)));
                            $3(out.append(sub));
                        };
                        if (member === undefined) emit($2);
                        else $2.if(member(value, key), emit);
                    });
                    return out;
                }) as unknown as EmitFn;
            });
        },
        // One block of the entries' rows — what a paged canvas pages (#823).
        blocks(collection, at) {
            return blockLists.get(collection, () => oneBlock(collection, spec.emitter(collection, at), false));
        },
        entryParts(entry, kt, at) {
            assertEntry(entry, rowType, at);
            return { match: matchFor(kt), row: rowFor(kt) };
        },
        childrenFor,
        collapsedFor,
        writer(collection, at) {
            const { entry, key: kt } = shapeOf(collection, at);
            assertEntry(entry, rowType, where);
            return writerFor(kt);
        },
        ownFor,
    };
    return spec;
}

/** The build spec of a `views` series. */
function viewsSpec(rowType: EastType, cfg: PlanViewsSeriesConfig<EastType, EastType>, members: PlanSeriesValue<PlanAxisKindLiteral>[]): PlanSeriesSpec {
    const where = `Plan.series.views "${cfg.key}"`;
    if (members.length === 0) throw new Error(`${where}: a views series lists at least one member series`);
    const memberSpecs = members.map((m, i) => {
        const spec = nestedSpec(m, `${where}[${i}]`);
        if (spec.entryParts === undefined || spec.arm === "group") {
            throw new Error(`${where}: member ${nameOf(spec)} is not a row series — a view is one row per entry (span, buckets, chart, heat, table, cards or events)`);
        }
        if (spec.nests) {
            throw new Error(`${where}: member ${nameOf(spec)} declares \`children\` — an entry's children belong to the views (they nest under its first view row); move \`children\` there`);
        }
        return spec;
    });
    // The views' own membership, collapse and children are a data series'
    // envelope without a row of its own — built by the same machinery, so a
    // views' children nest and recurse exactly as a data series' do.
    const host = dataSpec(rowType, {
        key: cfg.key, title: cfg.title, label: () => "",
        ...(cfg.keyType !== undefined ? { keyType: cfg.keyType } : {}),
        ...(cfg.match !== undefined ? { match: cfg.match } : {}),
        ...(cfg.children !== undefined ? { children: cfg.children } : {}),
        ...(cfg.collapsed !== undefined ? { collapsed: cfg.collapsed } : {}),
    }, { arm: "views", kind: () => groupKind(East.value(variant("none", null), PlanGroupSummaryType)) });
    const emitters = new ByType<EmitFn>();
    const blockLists = new ByType<BlocksFn>();
    const writerLists = new ByType<WriteFn | undefined>();
    const spec: PlanSeriesSpec = {
        key: cfg.key,
        title: cfg.title,
        arm: "views",
        nested: [...memberSpecs, ...host.nested],
        nests: cfg.children !== undefined,
        emitter(collection, at) {
            return emitters.get(collection, () => {
                const { entry, key: kt } = shapeOf(collection, at);
                assertEntry(entry, rowType, where);
                const parts = memberSpecs.map((m) => m.entryParts!(entry, kt, `${where} › ${nameOf(m)}`));
                const hostParts = host.entryParts!(entry, kt, where);
                const hostKids = host.childrenFor!(kt);
                const hostCollapse = host.collapsedFor!(kt);
                const seg = segmentOf(kt);
                return East.function([collection, PathType, IdOptType], PlanRowsCollectionType, ($, coll, prefix, parent) => {
                    // Every function the loop calls, bound ONCE (see the data walk).
                    const rowsOf = parts.map((p) => $.const(p.row));
                    const showsOf = parts.map((p) => (p.match === undefined ? undefined : $.const(p.match)));
                    const member = hostParts.match === undefined ? undefined : $.const(hostParts.match);
                    const childRows = hostKids === undefined ? undefined : $.const(hostKids);
                    const collapse = hostCollapse === undefined ? undefined : $.const(hostCollapse);
                    const out = $.let([], PlanRowsCollectionType);
                    $.for(coll as ExprType<ArrayType<EastType>>, ($2, value, key) => {
                        const emit = ($3: typeof $2) => {
                            const segs = $3.let(East.value([seg(key as ExprType<EastType>)], PathType), PathType);
                            const path = $3.let(prefix.concat(segs), PathType);
                            const ids = memberSpecs.map((m) =>
                                $3.let(East.value(variant("entry", { series: m.key, path }), PlanRowIdType), PlanRowIdType));
                            const present = showsOf.map((shows) => (shows === undefined
                                ? undefined
                                : $3.let(shows(value, key), BooleanType)));
                            // The first member whose row shows — the entry's
                            // children nest under it.
                            const first = $3.let(-1n, IntegerType);
                            for (let i = parts.length - 1; i >= 0; i--) {
                                const shows = present[i];
                                if (shows === undefined) $3.assign(first, BigInt(i));
                                else $3.if(shows, ($4) => { $4.assign(first, BigInt(i)); });
                            }
                            let sub: ExprType<PlanRowsCollectionType> | undefined;
                            if (childRows !== undefined) {
                                const firstId = $3.let(ids[0]!, PlanRowIdType);
                                for (let i = 1; i < ids.length; i++) {
                                    $3.if(first.equal(BigInt(i)), ($4) => { $4.assign(firstId, ids[i]!); });
                                }
                                sub = $3.let(first.greaterEqual(0n).ifElse(
                                    () => childRows(value, key, firstId, path),
                                    () => East.value([], PlanRowsCollectionType)), PlanRowsCollectionType);
                            }
                            const fold = $3.let(collapse === undefined
                                ? East.value(false, BooleanType)
                                : collapse(value, key), BooleanType);
                            const noFold = $3.let(East.value(false, BooleanType), BooleanType);
                            parts.forEach((_p, i) => {
                                const isFirst = $3.let(first.equal(BigInt(i)), BooleanType);
                                const kids = sub;
                                const hasChildren = $3.let(kids === undefined
                                    ? East.value(false, BooleanType)
                                    : isFirst.and(() => kids.size().greater(0n)), BooleanType);
                                const viewRow = rowsOf[i]!;
                                const push = ($4: typeof $3) => {
                                    $4(out.pushLast(viewRow(value, key, ids[i]!, parent, hasChildren,
                                        isFirst.ifElse(() => fold, () => noFold))));
                                };
                                const shows = present[i];
                                if (shows === undefined) push($3);
                                else $3.if(shows, push);
                            });
                            if (sub !== undefined) $3(out.append(sub));
                        };
                        if (member === undefined) emit($2);
                        else $2.if(member(value, key), emit);
                    });
                    return out;
                }) as unknown as EmitFn;
            });
        },
        // One block of the entries' view rows — what a paged canvas pages (#823).
        blocks(collection, at) {
            return blockLists.get(collection, () => oneBlock(collection, spec.emitter(collection, at), false));
        },
        // An entry's view rows are its members' own (each at the entry's path,
        // under its member's key), and the rows below them the views' (#880).
        writer(collection, at) {
            return writerLists.get(collection, () => {
                const { entry, key: kt } = shapeOf(collection, at);
                assertEntry(entry, rowType, where);
                const owns = memberSpecs.flatMap((m) => {
                    const own = m.ownFor?.(kt);
                    return own === undefined ? [] : [{ key: m.key, own }];
                });
                const below = host.writer(collection, at);
                if (owns.length === 0 && below === undefined) return undefined;
                return East.function([rowType, kt, PathType, IntegerType, StringType, PlanGestureType], OptionType(rowType),
                    ($, value, key, path, depth, series, gesture) => {
                        const result = $.let(none, OptionType(rowType));
                        $.if(depth.equal(path.size()), ($2) => {
                            for (const o of owns) {
                                const write = $2.const(o.own);
                                $2.if(series.equal(o.key), ($3) => { $3.assign(result, write(value, key, gesture)); });
                            }
                        }).else(($2) => {
                            if (below === undefined) return;
                            const write = $2.const(below);
                            $2.assign(result, write(value, key, path, depth, series, gesture));
                        });
                        return result;
                    }) as unknown as WriteFn;
            });
        },
    };
    return spec;
}

/** The build spec of a `section`. */
function sectionSpec(cfg: PlanSectionSeriesConfig<PlanAxisKindLiteral>, members: PlanSeriesValue<PlanAxisKindLiteral>[]): PlanSeriesSpec {
    const where = `Plan.series.section "${cfg.key}"`;
    const memberSpecs = members.map((m, i) => nestedSpec(m, `${where}[${i}]`));
    const summary = groupSummary(
        cfg.summary as SubtypeExprOrValue<PlanHeatCellsType> | undefined, cfg.summaryAggregate, where);
    /** The header row — at `id`, nested under `parent`. */
    const header = (id: ExprType<PlanRowIdType>, parent: ExprType<OptionType<PlanRowIdType>>) => planRow({
        id, parent,
        gutter: planGutter({
            label: cfg.title,
            ...(cfg.meta !== undefined ? { meta: some(cfg.meta) } : {}),
            ...(cfg.value !== undefined ? { value: some(cfg.value) } : {}),
        }),
        kind:   groupKind(summary),
        collapsed: cfg.collapsed ?? false,
        ...(cfg.status !== undefined ? { status: some(resolveTag(cfg.status, StatusValueType)) } : {}),
    });
    const emitters = new ByType<EmitFn>();
    const blockLists = new ByType<BlocksFn>();
    const writerLists = new ByType<WriteFn | undefined>();
    return {
        key: cfg.key,
        title: cfg.title,
        arm: "section",
        nested: memberSpecs,
        nests: false,
        emitter(collection, at) {
            return emitters.get(collection, () => {
                const blocks = memberSpecs.map((m) => m.emitter(collection, `${at} › ${where}`));
                return East.function([collection, PathType, IdOptType], PlanRowsCollectionType, ($, coll, prefix, parent) => {
                    const id = $.let(East.value(variant("section", { series: cfg.key, path: prefix }), PlanRowIdType), PlanRowIdType);
                    const under = $.let(East.value(some(id), IdOptType), IdOptType);
                    const out = $.let(East.value([header(id, parent)], PlanRowsCollectionType), PlanRowsCollectionType);
                    for (const block of blocks) $(out.append(block(coll, prefix, under)));
                    return out;
                }) as unknown as EmitFn;
            });
        },
        // The header is a FIXED block — no entry produces it, so every window
        // serves it alike and the canvas draws it once — and each member lays
        // out as its own blocks under it, so the series in a section page on
        // their own (#823).
        blocks(collection, at) {
            return blockLists.get(collection, () => {
                const members = memberSpecs.map((m) => m.blocks(collection, `${at} › ${where}`));
                return East.function([collection, PathType, IdOptType], PlanBlocksType, ($, coll, prefix, parent) => {
                    const id = $.let(East.value(variant("section", { series: cfg.key, path: prefix }), PlanRowIdType), PlanRowIdType);
                    const under = $.let(East.value(some(id), IdOptType), IdOptType);
                    const head = $.let(East.value({ fixed: true, parent, rows: [header(id, parent)] }, PlanBlockType), PlanBlockType);
                    const out = $.let(East.value([head], PlanBlocksType), PlanBlocksType);
                    for (const member of members) $(out.append(member(coll, prefix, under)));
                    return out;
                }) as unknown as BlocksFn;
            });
        },
        // A section adds no path segment, so an entry's rows under it are its
        // members' own: the first member that takes the gesture writes it
        // (#880). The header is written by none.
        writer(collection, at) {
            return writerLists.get(collection, () => {
                const writes = memberSpecs
                    .map((m) => m.writer(collection, `${at} › ${where}`))
                    .filter((w): w is WriteFn => w !== undefined);
                if (writes.length === 0) return undefined;
                const { entry, key: kt } = shapeOf(collection, at);
                return East.function([entry, kt, PathType, IntegerType, StringType, PlanGestureType], OptionType(entry),
                    ($, value, key, path, depth, series, gesture) => {
                        const result = $.let(none, OptionType(entry));
                        for (const w of writes) {
                            const write = $.const(w);
                            $.if(result.hasTag("none"), ($2) => {
                                $2.assign(result, write(value, key, path, depth, series, gesture));
                            });
                        }
                        return result;
                    }) as unknown as WriteFn;
            });
        },
    };
}

/** The build spec of a `rows` series — hand-built rows, named and placed. */
function rowsSpec(identity: PlanSeriesIdentity, rows: PlanRowsValue): PlanSeriesSpec {
    const emitters = new ByType<EmitFn>();
    const blockLists = new ByType<BlocksFn>();
    const emitter = (collection: EastType): EmitFn => emitters.get(collection, () =>
        East.function([collection, PathType, IdOptType], PlanRowsCollectionType,
            (_$, _coll, prefix, parent) => REBASE_ROWS(rows, identity.key, prefix, parent)) as unknown as EmitFn);
    return {
        key: identity.key,
        title: identity.title,
        arm: "rows",
        nested: [],
        nests: false,
        emitter,
        // A FIXED block: no entry produces hand-built rows, so every window
        // serves them alike and the canvas draws them once (#823).
        blocks(collection) {
            return blockLists.get(collection, () => oneBlock(collection, emitter(collection), true));
        },
        // No entry produces them, so no gesture is written into one (#880).
        writer() {
            return undefined;
        },
    };
}

// ============================================================================
// Keys — unique across the whole series tree
// ============================================================================

/**
 * Refuse two series sharing a key anywhere in a series tree — a row's id is
 * its series key and its path, so a repeated key would give two rows one id.
 *
 * @param specs - The series, in order
 * @param where - Who is asking, for the message
 * @throws {Error} Naming both series and where each sits
 */
function assertUniqueKeys(specs: readonly PlanSeriesSpec[], where: string): void {
    const seen = new Map<string, string>();
    const walk = (list: readonly PlanSeriesSpec[], trail: string) => {
        list.forEach((spec, i) => {
            const site = `${trail}[${i}] ${nameOf(spec)}`;
            const prior = seen.get(spec.key);
            if (prior !== undefined) {
                throw new Error(
                    `${where}: two series share the key "${spec.key}" — ${prior} and ${site}. A row's id is its ` +
                    "series key and its path, so every series key must be unique across the whole series tree.");
            }
            seen.set(spec.key, site);
            walk(spec.nested, `${site} ›`);
        });
    };
    walk(specs, "series");
}

// ============================================================================
// Series values — the East value, its spec beside it
// ============================================================================

/** Each spec's top-level writes, by collection type. */
const topWrites = new WeakMap<PlanSeriesSpec, ByType<TopWriteFn>>();

/**
 * A series' write at the top of a canvas over `collection` (#880) — what the
 * series value carries as `write`: a gesture on a row of one entry, written
 * into a DETACHED copy of the entry (a nested entry in place in its
 * collection); `none` when the row is not the entry's, or no series in the
 * tree takes the gesture on it.
 *
 * @param spec - The series' build spec
 * @param collection - The source's collection type
 * @param where - Who is asking, for messages
 * @returns `(entry, key, row, gesture) → the entry written`
 */
function topWrite(spec: PlanSeriesSpec, collection: EastType, where: string): TopWriteFn {
    let cache = topWrites.get(spec);
    if (cache === undefined) {
        cache = new ByType<TopWriteFn>();
        topWrites.set(spec, cache);
    }
    return cache.get(collection, () => {
        const { entry: rowType, key: kt } = shapeOf(collection, where);
        const writer = spec.writer(collection, where);
        const seg = segmentOf(kt);
        return East.function([rowType, kt, PlanRowIdType, PlanGestureType], OptionType(rowType), ($, entry, key, row, gesture) => {
            const result = $.let(none, OptionType(rowType));
            if (writer === undefined) return result;
            const write = $.const(writer);
            $.match(row, {
                entry: ($2, id) => {
                    // A row's path starts with its entry's key.
                    const mine = $2.let(id.path.size().greater(0n).and(() => id.path.get(0n).equal(seg(key))), BooleanType);
                    $2.if(mine, ($3) => {
                        const detached = $3.let(East.Blob.encodeBeast(entry, "v2").decodeBeast(rowType, "v2"), rowType);
                        $3.assign(result, write(detached, key, id.path, 1n, id.series, gesture));
                    });
                },
            });
            return result;
        }) as unknown as TopWriteFn;
    });
}

/** Pin a series value against the instantiated series type, recording its spec. */
function seriesValue(
    rowType: EastType,
    keyType: EastType | undefined,
    spec: PlanSeriesSpec,
    identity: PlanSeriesIdentity,
): PlanSeriesValue {
    assertUniqueKeys([spec], `Plan.series.${spec.arm} "${spec.key}"`);
    const kt = keyType ?? StringType;
    const source = DictType(kt, rowType);
    const where = `Plan.series.${spec.arm} "${spec.key}"`;
    const blocks = spec.blocks(source, where);
    const derive = East.function([source], PlanBlocksType, ($, data) => {
        const top = $.let(East.value([], PathType), PathType);
        return blocks(data, top, East.value(none, IdOptType));
    });
    const value = East.value(
        variant(spec.arm, {
            key:      identity.key,
            title:    identity.title,
            subtitle: identity.subtitle !== undefined ? some(identity.subtitle) : none,
            icon:     identity.icon !== undefined ? some(resolveIcon(identity.icon)) : none,
            derive,
            write:    topWrite(spec, source, where),
        }) as unknown as SubtypeExprOrValue<PlanSeriesShape>,
        PlanSeriesType(rowType, kt),
    ) as PlanSeriesValue;
    SPECS.set(value, spec);
    return value;
}

/** Apply one series value to a source (the exhaustive-arm call) — its blocks. */
export function applySeriesValue(
    s: PlanSeriesValue<PlanAxisKindLiteral>,
    data: ExprType<EastType>,
): PlanBlocksValue {
    const d = data as ExprType<DictType<EastType, EastType>>;
    return s.match({
        span:    (_$, v) => v.derive(d),
        buckets: (_$, v) => v.derive(d),
        chart:   (_$, v) => v.derive(d),
        heat:    (_$, v) => v.derive(d),
        table:   (_$, v) => v.derive(d),
        cards:   (_$, v) => v.derive(d),
        events:  (_$, v) => v.derive(d),
        group:   (_$, v) => v.derive(d),
        section: (_$, v) => v.derive(d),
        views:   (_$, v) => v.derive(d),
        rows:    (_$, v) => v.derive(d),
    }) as PlanBlocksValue;
}

/**
 * Check a TS series list before it is applied — its keys unique across the
 * whole tree. An East expression list is checked at render (a repeated id is
 * a row diagnostic), since its series are not known until it runs.
 *
 * @param series - The `series` input
 * @param where - Who is asking, for the message
 */
export function checkSeries(series: PlanSeriesInput, where: string): void {
    if (!Array.isArray(series)) return;
    const specs = series.map((s) => specOf(s)).filter((s): s is PlanSeriesSpec => s !== undefined);
    assertUniqueKeys(specs, where);
}

/**
 * Apply the `series` input to the source — the canvas's BLOCKS (#823): every
 * series' blocks, in declared order.
 *
 * @remarks
 * A TS array is built for the source's own collection type (so a source keyed
 * by any type works with series whose accessors ignore the key); an East
 * expression maps at evaluation, so a `$.const`-bound, picked or stored list
 * works identically, its series built for their declared key type.
 *
 * The blocks stay apart so a paged canvas can page each data series on its
 * own: applied to one window of a source, this is every block's share of that
 * window, from one read of it.
 *
 * @param series - The `series` input
 * @param data - The source collection (a whole `Dict`, or one paged window of it)
 * @returns The blocks
 */
export function applySeries(series: PlanSeriesInput, data: ExprType<EastType>): PlanBlocksValue {
    const collection = Expr.type(data as unknown as Expr) as EastType;
    if (Array.isArray(series)) {
        const lists = series.map((s) => {
            const spec = specOf(s);
            return spec !== undefined
                ? spec.blocks(collection, `Plan.series.${spec.arm} "${spec.key}"`)(
                    data, East.value([], PathType), East.value(none, IdOptType)) as PlanBlocksValue
                : applySeriesValue(s, data);
        });
        return lists.reduce<PlanBlocksValue>(
            (acc, list) => acc.concat(list) as PlanBlocksValue,
            East.value([], PlanBlocksType),
        );
    }
    return series.map((_$, s) => applySeriesValue(s as PlanSeriesValue, data)).flatMap((_$, list) => list) as PlanBlocksValue;
}

/** One series value's `write` (the exhaustive-arm read). */
function seriesValueWrite(s: PlanSeriesValue<PlanAxisKindLiteral>): TopWriteFn {
    return s.match({
        span:    (_$, v) => v.write,
        buckets: (_$, v) => v.write,
        chart:   (_$, v) => v.write,
        heat:    (_$, v) => v.write,
        table:   (_$, v) => v.write,
        cards:   (_$, v) => v.write,
        events:  (_$, v) => v.write,
        group:   (_$, v) => v.write,
        section: (_$, v) => v.write,
        views:   (_$, v) => v.write,
        rows:    (_$, v) => v.write,
    }) as unknown as TopWriteFn;
}

/**
 * The canvas's write (#880) — a gesture on a row of one entry, written into
 * the entry by whichever series in the list made the row: `(entry, key, row,
 * gesture) → the entry written`, `none` when none takes it.
 *
 * @remarks
 * The `applySeries` rule: a TS array is built for the source's own collection
 * type, and an East list (a `$.const` list, a pick's) writes through each
 * series value's own `write`, built for its declared key type.
 *
 * @param series - The `series` input
 * @param collection - The source's collection type (`Dict<K, R>`)
 * @returns The write
 */
export function seriesWriteFn(series: PlanSeriesInput, collection: EastType): TopWriteFn {
    const { entry: rowType, key: kt } = shapeOf(collection, "Plan");
    const inputs = [rowType, kt, PlanRowIdType, PlanGestureType] as const;
    if (Array.isArray(series)) {
        const built = series.map((s) => {
            const spec = specOf(s);
            return spec !== undefined ? topWrite(spec, collection, `Plan.series.${spec.arm} "${spec.key}"`) : undefined;
        });
        return East.function([...inputs], OptionType(rowType), ($, entry, key, row, gesture) => {
            const result = $.let(none, OptionType(rowType));
            series.forEach((s, i) => {
                const own = built[i];
                const write = $.const(own !== undefined ? own : seriesValueWrite(s));
                $.if(result.hasTag("none"), ($2) => { $2.assign(result, write(entry, key, row, gesture)); });
            });
            return result;
        }) as unknown as TopWriteFn;
    }
    return East.function([...inputs], OptionType(rowType), ($, entry, key, row, gesture) => {
        const result = $.let(none, OptionType(rowType));
        $.for(series, ($2, s) => {
            $2.if(result.hasTag("none"), ($3) => {
                const write = $3.let(seriesValueWrite(s as PlanSeriesValue));
                $3.assign(result, write(entry, key, row, gesture));
            });
        });
        return result;
    }) as unknown as TopWriteFn;
}

// ============================================================================
// Builders — Plan.series.*
// ============================================================================

/**
 * A span series — one state-run row per entry; a row with children shows its
 * own runs plus bands over its subtree's runs (`rollup`) — each band sums its
 * runs' quantities unit by unit (#824).
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the runs imply (inferred from `runs`; `never` when erased)
 * @typeParam KT - The entries' key type (`keyType`; `String` by default)
 * @param rowType - The entry type (every builder takes it first — the `Slice.config` shape)
 * @param config - The accessors and nesting ({@link PlanSpanSeriesConfig})
 * @returns A series value, branded with its kind
 */
export function createSeriesSpan<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType>(
    rowType: R, config: PlanSpanSeriesConfig<R, K, KT>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanSpanSeriesConfig<EastType, PlanAxisKindLiteral, EastType>;
    const rollup = cfg.children !== undefined ? resolveTag(cfg.rollup ?? "union", PlanRollupType) : undefined;
    const spec = dataSpec(rowType, cfg, {
        arm: "span",
        kind: (value, key, hasChildren) => spanKind({
            runs: cfg.runs(value, key),
            ...(cfg.decisions !== undefined ? { decisions: cfg.decisions(value, key) } : {}),
            ...(cfg.ports !== undefined ? { ports: cfg.ports(value, key) } : {}),
        }, rollup === undefined
            ? East.value(none, OptionType(PlanRollupType))
            // A row rolls up only when it HAS child rows — a leaf's bands
            // would repeat its own runs.
            : hasChildren.ifElse(
                () => East.value(some(rollup), OptionType(PlanRollupType)),
                () => East.value(none, OptionType(PlanRollupType)))),
        edit: cfg.edit as unknown as AnyEditInput | undefined,
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K>;
}

/**
 * A heat series — one per-bucket cell row per entry; a row with children and
 * no cells of its own shows its children's per-bucket `aggregate`.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the cells imply (inferred from `cells`; `never` when erased)
 * @typeParam KT - The entries' key type
 * @param rowType - The entry type
 * @param config - The accessors and nesting ({@link PlanHeatSeriesConfig})
 * @returns A series value, branded with its kind
 */
export function createSeriesHeat<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType>(
    rowType: R, config: PlanHeatSeriesConfig<R, K, KT>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanHeatSeriesConfig<EastType, PlanAxisKindLiteral, EastType>;
    const aggregate = cfg.children !== undefined
        ? East.value(some(resolveTag(cfg.aggregate ?? "mean", PlanAggregateType)), OptionType(PlanAggregateType))
        : East.value(none, OptionType(PlanAggregateType));
    const spec = dataSpec(rowType, cfg, {
        arm: "heat",
        kind: (value, key) => heatKind({
            cells: cfg.cells(value, key),
            ...(cfg.scale !== undefined ? { scale: cfg.scale } : {}),
        }, aggregate),
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K>;
}

/**
 * A table series — one bucketed-numeral row per entry; a row with children and
 * no values of its own shows per-position subtotals (`aggregate`, `format`).
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the cells imply (inferred from `cells` / `series`; `never` when erased)
 * @typeParam KT - The entries' key type
 * @param rowType - The entry type
 * @param config - The accessors and nesting ({@link PlanTableSeriesOfConfig})
 * @returns A series value, branded with its kind
 */
export function createSeriesTable<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType>(
    rowType: R, config: PlanTableSeriesOfConfig<R, K, KT>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanTableSeriesOfConfig<EastType, PlanAxisKindLiteral, EastType>;
    if (cfg.cells !== undefined && cfg.series !== undefined) {
        throw new Error(`Plan.series.table "${cfg.key}": pass \`cells\` (one plain value series) OR \`series\` — not both`);
    }
    const aggregate = cfg.children !== undefined
        ? East.value(some(resolveTag(cfg.aggregate ?? "sum", TableAggregateType)), OptionType(TableAggregateType))
        : East.value(none, OptionType(TableAggregateType));
    const spec = dataSpec(rowType, cfg, {
        arm: "table",
        kind: (value, key) => tableKind({
            ...(cfg.cells !== undefined ? { cells: cfg.cells(value, key) } : {}),
            ...(cfg.fold !== undefined ? { fold: cfg.fold } : {}),
            ...(cfg.series !== undefined ? { series: cfg.series(value, key) } : {}),
            ...(cfg.split !== undefined ? { split: cfg.split } : {}),
            ...(cfg.format !== undefined ? { format: cfg.format } : {}),
            ...(cfg.emphasis !== undefined ? { emphasis: cfg.emphasis } : {}),
        }, aggregate),
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K>;
}

/**
 * A bucket series — one bucket row (the Planner surface) per entry.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the tiles imply (inferred from `events` / `markers`; `never` when erased)
 * @typeParam KT - The entries' key type
 * @param rowType - The entry type
 * @param config - The accessors ({@link PlanBucketsSeriesConfig})
 * @returns A series value, branded with its kind
 */
export function createSeriesBuckets<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType>(
    rowType: R, config: PlanBucketsSeriesConfig<R, K, KT>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanBucketsSeriesConfig<EastType, PlanAxisKindLiteral, EastType>;
    const spec = dataSpec(rowType, cfg, {
        arm: "buckets",
        kind: (value, key) => bucketsKind({
            ...(cfg.lanes !== undefined ? { lanes: cfg.lanes(value, key) } : {}),
            events: cfg.events(value, key),
            ...(cfg.markers !== undefined ? { markers: cfg.markers(value, key) } : {}),
        }),
        edit: cfg.edit as unknown as AnyEditInput | undefined,
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K>;
}

/**
 * A cards series — one cards row (Roster chips) per entry.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the chips imply (inferred from `chips`; `never` when erased)
 * @typeParam KT - The entries' key type
 * @param rowType - The entry type
 * @param config - The accessors ({@link PlanCardsSeriesConfig})
 * @returns A series value, branded with its kind
 */
export function createSeriesCards<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType>(
    rowType: R, config: PlanCardsSeriesConfig<R, K, KT>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanCardsSeriesConfig<EastType, PlanAxisKindLiteral, EastType>;
    const spec = dataSpec(rowType, cfg, {
        arm: "cards",
        kind: (value, key) => cardsKind(cfg.chips(value, key)),
        edit: cfg.edit as unknown as AnyEditInput | undefined,
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K>;
}

/**
 * An events series — one instant-mark row per entry.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the marks imply (inferred from `marks`; `never` when erased)
 * @typeParam KT - The entries' key type
 * @param rowType - The entry type
 * @param config - The accessors ({@link PlanEventsSeriesConfig})
 * @returns A series value, branded with its kind
 */
export function createSeriesEvents<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType>(
    rowType: R, config: PlanEventsSeriesConfig<R, K, KT>,
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanEventsSeriesConfig<EastType, PlanAxisKindLiteral, EastType>;
    const spec = dataSpec(rowType, cfg, {
        arm: "events",
        kind: (value, key) => eventsKind(cfg.marks(value, key)),
        edit: cfg.edit as unknown as AnyEditInput | undefined,
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K>;
}

/**
 * A chart series — one chart row per entry, layers built from the entry's own
 * data. Kind-ERASED: a Chart layer's TS face does not expose its x type, so a
 * chart series constrains no axis at compile time — the render-time
 * diagnostic holds it to the axis like any row.
 *
 * @typeParam R - The entry type
 * @typeParam KT - The entries' key type
 * @param rowType - The entry type
 * @param config - The accessors and shared axes ({@link PlanChartSeriesConfig})
 * @returns A series value
 */
export function createSeriesChart<R extends EastType, KT extends EastType = StringType>(
    rowType: R, config: PlanChartSeriesConfig<R, KT>,
): PlanSeriesValue {
    const cfg = config as unknown as PlanChartSeriesConfig<EastType, EastType>;
    const spec = dataSpec(rowType, cfg, {
        arm: "chart",
        kind: (value, key) => chartKind({
            layers: cfg.layers(value, key),
            ...(cfg.left !== undefined ? { left: cfg.left } : {}),
            ...(cfg.right !== undefined ? { right: cfg.right } : {}),
            ...(cfg.height !== undefined ? { height: cfg.height } : {}),
            ...(cfg.expandedHeight !== undefined ? { expandedHeight: cfg.expandedHeight } : {}),
            ...(cfg.expandable !== undefined ? { expandable: cfg.expandable } : {}),
        }),
        ...(cfg.pinned !== undefined
            ? { pinned: (value: ExprType<EastType>, key: ExprType<EastType>) => East.value(cfg.pinned!(value, key), BooleanType) }
            : {}),
        ...(cfg.swatches !== undefined ? { swatches: cfg.swatches } : {}),
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg);
}

/**
 * A group series — one group strip PER ENTRY, its members the entry's
 * children (#822). Collapsed, a strip rests as its summary heat strip —
 * explicit `summary` cells, or the renderer-derived `summaryAggregate` — and
 * its member count is derived.
 *
 * @remarks
 * Hierarchy comes from the data's nesting: to group a flat source, reshape it
 * first — inline, one East `groupToDicts` in the canvas function (the entries
 * are then `Dict<String, Row>` and a group's label is its key); a paged source
 * is grouped in the dataflow. The `by` form and the static
 * `group(R, chrome, children)` form are gone — see `Plan.series.section` for a
 * fixed titled block.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the summary cells imply
 * @typeParam KT - The entries' key type
 * @param rowType - The entry type
 * @param config - The strip's accessors and its members ({@link PlanGroupSeriesConfig})
 * @returns A series value, branded with its kind
 * @throws {Error} When called with the removed `by` or static forms
 */
export function createSeriesGroup<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType>(
    rowType: R, config: PlanGroupSeriesConfig<R, K, KT>,
): PlanSeriesValue<K> {
    // The removed forms, named — a plain JS caller would otherwise meet an
    // unhelpful "label is not a function".
    if (arguments.length > 2 || "by" in (config as object)) {
        throw new Error(
            "Plan.series.group: the `by` and static `group(R, chrome, children)` forms are removed (#822) — a group " +
            "strip is now one per ENTRY with its members nested in the entry (`children`); reshape a flat source " +
            "with `groupToDicts` first, and use `Plan.series.section(R, { key, title }, [series…])` for a fixed block");
    }
    const cfg = config as unknown as PlanGroupSeriesConfig<EastType, PlanAxisKindLiteral, EastType>;
    const where = `Plan.series.group "${cfg.key}"`;
    if (cfg.children === undefined) {
        throw new Error(`${where}: a group strip needs its members — declare \`children\``);
    }
    const summary = cfg.summary;
    // The strip's ONE summary (#824): the per-entry cells, the declared
    // aggregate, or a plain band — both at once is refused here.
    const declared = summary === undefined ? groupSummary(undefined, cfg.summaryAggregate, where) : undefined;
    if (summary !== undefined && cfg.summaryAggregate !== undefined) {
        throw new Error(
            `${where}: give \`summary\` (explicit strip cells) OR \`summaryAggregate\` (cells derived from the ` +
            "members) — a collapsed strip shows one or the other");
    }
    const spec = dataSpec(rowType, cfg, {
        arm: "group",
        kind: (value, key) => groupKind(declared ?? East.value(
            variant("cells", East.value(summary!(value, key) as SubtypeExprOrValue<PlanHeatCellsType>, PlanHeatCellsType)),
            PlanGroupSummaryType)),
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K>;
}

/**
 * A section — a fixed titled block over series: one header row, the member
 * series' rows beneath it (#822). A section adds no path segment: its header's
 * id is `section { series, path }` at its parent's path, and its members' rows
 * keep their own.
 *
 * @typeParam R - The entry type (the members' — they share the section's entries)
 * @typeParam K - The union of the members' axis kinds (inferred; `never` when all are erased)
 * @param rowType - The entry type
 * @param config - The header ({@link PlanSectionSeriesConfig})
 * @param members - The member series, in order
 * @returns A series value, branded with its members' kinds
 */
export function createSeriesSection<R extends EastType, K extends PlanAxisKindLiteral = never>(
    rowType: R,
    config: PlanSectionSeriesConfig<K>,
    members: PlanSeriesValue<K>[],
): PlanSeriesValue<K> {
    const cfg = config as PlanSectionSeriesConfig<PlanAxisKindLiteral>;
    const spec = sectionSpec(cfg, members);
    return seriesValue(rowType, undefined, spec, cfg) as PlanSeriesValue<K>;
}

/**
 * A views series — each entry gets one row per member series, adjacent and in
 * declared order; the entry's children follow its view rows, nested under the
 * first of them (#822). How one entity is shown several ways: a machine's jobs,
 * utilisation and tonnes as three rows side by side.
 *
 * @remarks
 * A member series' own `match` decides whether its row shows for an entry; a
 * member may not declare `children` (the views own the entry's children). A
 * view row's id is its member series' key and the entry's path, and a seek on
 * the entry lands on its first view row.
 *
 * @typeParam R - The entry type
 * @typeParam K - The union of the members' axis kinds (inferred; `never` when all are erased)
 * @typeParam KT - The entries' key type
 * @param rowType - The entry type
 * @param config - Membership, collapse and children ({@link PlanViewsSeriesConfig})
 * @param members - The member series — one row each per entry, in order
 * @returns A series value, branded with its members' kinds
 */
export function createSeriesViews<R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType>(
    rowType: R,
    config: PlanViewsSeriesConfig<R, KT>,
    members: PlanSeriesValue<K>[],
): PlanSeriesValue<K> {
    const cfg = config as unknown as PlanViewsSeriesConfig<EastType, EastType>;
    const spec = viewsSpec(rowType, cfg, members);
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K>;
}

/**
 * Hand-built rows riding beside the data-driven series (a pinned KPI chart, a
 * shutdown written out once) — the kind factories' streams, named by this
 * series and placed as its block.
 *
 * @remarks
 * A hand-built row's id is this series' key and the factory `key`s that lead to
 * it (`Plan.ref("works", "shutdown", "elec")`); keys must be unique among a
 * row's siblings, or two rows share an id and the renderer draws the second as
 * a diagnostic.
 *
 * @typeParam R - The entry type (pins the series against its siblings)
 * @typeParam K - The union of the rows' axis kinds (inferred from the kind-factory results; `never` when erased)
 * @param rowType - The entry type
 * @param identity - How the library lists this block ({@link PlanSeriesIdentity})
 * @param rows - The hand-built rows (kind-factory results)
 * @returns A series value, branded with the rows' kinds
 */
export function createSeriesRows<R extends EastType, K extends PlanAxisKindLiteral = never>(
    rowType: R,
    identity: PlanSeriesIdentity,
    rows: PlanRowsInput<K>,
): PlanSeriesValue<K> {
    const spec = rowsSpec(identity, normalizeRows(rows));
    return seriesValue(rowType, undefined, spec, identity) as PlanSeriesValue<K>;
}
