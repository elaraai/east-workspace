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
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    EastTypeType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    RefType,
    StringType,
    StructType,
    VariantType,
    isTypeEqual,
    printFor,
    printTypeSummary,
    toEastTypeValue,
    variant,
    some,
    none,
} from "@elaraai/east";

import { IconType, StatusValueType, type StatusValueLiteral } from "@elaraai/east-ui";
import { TableAggregateType, TickFormatType, reifyAccessor, resolveTag, type TableAggregateLiteral } from "@elaraai/east-ui/internal";
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
    PlanInstantType,
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
    PlanFoldType,
    type PlanFoldLiteral,
} from "./types.js";
import {
    PLAN_LOOKS,
    resolveIcon,
    resolveInstant,
    type PlanLookKind,
    type PlanIconInput,
    type PlanHeatScaleInput,
    type PlanRunLook,
    type PlanDecisionLook,
    type PlanPortLook,
    type PlanBucketEventLook,
    type PlanCellMarkerLook,
    type PlanChipLook,
    type PlanEventMarkLook,
} from "./builders.js";
import {
    PlanReadsBrand,
    PlanUseBrand,
    planReadOf,
    planUseOf,
    type PlanReadSpec,
    type PlanItemsReadSpec,
    type PlanValuesEdit,
    type PlanValuesReadSpec,
    type PlanValuesUseSpec,
    type PlanItemsInput,
    type PlanValuesInput,
    type PlanValuesUse,
    type PlanSpanTimes,
    type PlanPointTimes,
    type PlanTreeField,
    type PlanChildField,
    type PlanCollectionItem,
} from "./reads.js";
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

/**
 * The item a move to another row carries between its two writes (#825) — its
 * bytes, from the source row's write, which takes it out of its list, to the
 * target row's, which puts it into its own; `none` while nothing is in
 * transit. The canvas threads ONE through every row a gesture writes, in
 * order, and an item still carried at the end is a move that landed nowhere.
 *
 * @internal
 */
export const PlanCarriedType = RefType(OptionType(BlobType));
export type PlanCarriedType = typeof PlanCarriedType;

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
 * It carries its writer too (#880), `write: Fn(R, K, RowId, Gesture,
 * Ref<Option<Blob>>) → Option<R>` — a gesture on one of its rows written into
 * the entry the row came from, through the fields the series declares
 * (`edit`), at whatever depth the row sits; `none` when no
 * series in its tree takes the gesture on that row. The `Ref` is the item a
 * move to another row carries (#825): the source row's write takes the item
 * out of its list into it, as bytes, and the target row's write puts it into
 * its own list — the two rows may be different series' and different
 * entries'. A series list is an East value (a pick, a stored list), so the
 * writer travels with the series rather than being rebuilt by the canvas.
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
        write:    FunctionType([r, k, PlanRowIdType, PlanGestureType, PlanCarriedType], OptionType(r)),
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
 * It carries what the series reads too (#1436, {@link PlanReadsBrand}): each
 * collection its named reads name, and how each is read — what a paged
 * source's index holds it to (#1435). `unknown` (the default) reads nothing
 * by name.
 *
 * @typeParam K - The axis kind(s) the series' instants ride
 * @typeParam U - What the series reads
 */
export type PlanSeriesValue<K extends PlanAxisKindLiteral = never, U = unknown> = PlanKinded<ExprType<PlanSeriesShape>, K> & { readonly [PlanReadsBrand]?: U };

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
    /** The series' name, as a user reads it ("Press jobs"). */
    title: string;
    /** The series' muted role line ("one row per press"). */
    subtitle?: string;
    /** Card-icon override; omit ⇒ the icon this series' KIND declares. */
    icon?: PlanIconInput;
}

/** Marks a {@link PlanChildren} step-down. */
const PLAN_CHILDREN: unique symbol = Symbol("PlanChildren");

/**
 * A step down from an entry to its child rows (#822, #1436) —
 * `Plan.children(field, [series…])`: a `Dict` field of the entry holding rows
 * of another type, keyed by an id, laid out by `series` exactly like a
 * top-level list — blocks, `views`, or sections, nesting to any depth. A child
 * row's path segment is its key.
 *
 * @typeParam R - The parent entry type
 * @typeParam F - The field holding the child rows
 * @typeParam U - What the series over them read
 * @typeParam FO - The folds of the values their cells read, by collection — what a parent subtotals them by
 */
export interface PlanChildren<R extends EastType = EastType, F extends string = string, U = unknown, FO = unknown> {
    /** Discriminant. */
    readonly [PLAN_CHILDREN]: true;
    /** The field holding the child rows. */
    readonly field: F;
    /** The series over the child rows, in order. */
    readonly series: readonly PlanSeriesValue<PlanAxisKindLiteral>[];
    /** The parent entry type, the field, what its series read and the folds of their cells (phantom). */
    readonly [PlanUseBrand]?: { readonly makes: "children"; readonly row: R; readonly field: F; readonly rows: U; readonly folds: FO };
    /** What it reads (phantom): `{ [F]: { rows: U } }`. */
    readonly [PlanReadsBrand]?: { readonly [P in F]: { readonly rows: U } };
}

/**
 * A series' `children` (#1436):
 * - `field` — a `Dict` field of the entry holding more of THIS series'
 *   entries, keyed by an id: a tree, to any depth (a `RecursiveType` entry's
 *   own field);
 * - `Plan.children(field, [series…])` — a step down to child rows of another
 *   type;
 * - an array of step-downs — several child collections, in order.
 *
 * @typeParam R - The entry type
 */
export type PlanChildrenInput<R extends EastType> =
    | PlanTreeField<R>
    | PlanChildren<R, string, unknown, unknown>
    | readonly PlanChildren<R, string, unknown, unknown>[];

/** A step-down as the build machinery reads it: a field of the entry, or (the event kinds', #1194) an accessor computing the collection. */
interface AnyStepDown {
    readonly [PLAN_CHILDREN]: true;
    readonly field?: string;
    readonly of?: (row: ExprType<EastType>, key: ExprType<EastType>) => Expr;
    readonly series: readonly PlanSeriesValue<PlanAxisKindLiteral>[];
}

/**
 * Step down from an entry to its child rows (#822, #1436): a `Dict` field of
 * the entry, keyed by an id, its rows laid out by `series` like a top-level
 * list.
 *
 * @typeParam R - The parent entry type (inferred from where the step-down is used)
 * @typeParam F - The field holding the child rows
 * @typeParam S - The series over them, as written
 * @param field - A Dict field of the entry holding the child rows, keyed by an id
 * @param series - The series over the child rows
 * @returns The step-down, for a series' `children`
 */
export function createChildren<R extends EastType, F extends PlanChildField<R>, const S extends readonly PlanSeriesValue<PlanAxisKindLiteral, unknown>[]>(
    field: F,
    series: S,
): PlanChildren<R, F, PlanSeriesListReads<S>, PlanSeriesListFolds<S>> {
    if (typeof field !== "string") {
        throw new Error("Plan.children: name the field holding the child rows — a Dict of the row, keyed by an id: Plan.children(\"members\", [series…])");
    }
    return { [PLAN_CHILDREN]: true, field, series } as unknown as PlanChildren<R, F, PlanSeriesListReads<S>, PlanSeriesListFolds<S>>;
}

/**
 * Step down from an entry to a collection an accessor computes (#1194) — the
 * event kinds' own: a resource's events come from another record, so its
 * child rows are no field of it. An author's step-down names its field
 * ({@link createChildren}).
 *
 * @internal
 * @param of - The child collection, from the parent entry's value and key
 * @param series - The series over the child entries
 * @returns The step-down
 */
export function createChildrenOf(
    of: (row: ExprType<EastType>, key: ExprType<EastType>) => Expr,
    series: PlanSeriesValue<PlanAxisKindLiteral>[],
): PlanChildren {
    return { [PLAN_CHILDREN]: true, of, series } as unknown as PlanChildren;
}

function isStepDown(x: unknown): x is AnyStepDown {
    return typeof x === "object" && x !== null && (x as { [PLAN_CHILDREN]?: unknown })[PLAN_CHILDREN] === true;
}

// ============================================================================
// The reads brand — what a series reads (#1436)
// ============================================================================

/** No reads. */
type PlanNone = Record<never, never>;
/** A union's members, intersected — none for no members. */
type PlanIntersect<U> = [U] extends [never] ? PlanNone : (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
/** A type flattened one level. */
type PlanFlat<T> = { readonly [P in keyof T]: T[P] };

/**
 * A reads brand flattened one level, and `unknown` when it names nothing — the
 * brand of a series that reads no collection by name.
 *
 * @typeParam U - The brand
 */
export type PlanReadsNormal<U> = [keyof U] extends [never] ? unknown : PlanFlat<U>;

/** What a series value reads — none when it names nothing. */
type PlanReadsOfSeries<S> = S extends { readonly [PlanReadsBrand]?: infer U } ? (unknown extends U ? PlanNone : Exclude<U, undefined>) : PlanNone;
/** The folds of what a series value's cells read — none when it subtotals nothing. */
type PlanFoldsOfSeries<S> = S extends { readonly [PlanUseBrand]?: { readonly folds: infer F } } ? (unknown extends F ? PlanNone : F) : PlanNone;

/**
 * What a list of series reads, their brands intersected.
 *
 * @typeParam S - The series, as written
 */
export type PlanSeriesListReads<S extends readonly unknown[]> = PlanReadsNormal<PlanIntersect<PlanReadsOfSeries<S[number]>>>;

/**
 * The folds of the values a list of series' cells read, by collection — what a
 * parent of their rows subtotals each by.
 *
 * @typeParam S - The series, as written
 */
export type PlanSeriesListFolds<S extends readonly unknown[]> = PlanReadsNormal<PlanIntersect<PlanFoldsOfSeries<S[number]>>>;

/**
 * The folds a series' cells read their values by, carried beside its reads so
 * a parent of its rows knows what it subtotals them by (phantom, #1436).
 *
 * @typeParam F - `{ [collection]: fold }`
 */
export type PlanFoldsBrand<F> = { readonly [PlanUseBrand]?: { readonly folds: F } };

/** How a collection's values are subtotalled: by a fold and an aggregate. */
type PlanRollupOf<FO, A> = { readonly values: { readonly rollup: { readonly fold: FO; readonly aggregate: A } } };

/** Each values collection of `U`, subtotalled by `FO` and `A` — a tree's own collections (#1436). */
type PlanSubtotalled<U, FO, A> = unknown extends U ? unknown
    : { readonly [P in keyof U]: U[P] extends { readonly values: unknown } ? PlanRollupOf<FO, A> : U[P] };

/** Each values collection of `U` with a fold in `FOLDS`, subtotalled by it and `A` — a step-down's rows (#1436). */
type PlanSubtotalledBy<U, FOLDS, A> = unknown extends U ? unknown
    : { readonly [P in keyof U]: P extends keyof FOLDS ? PlanRollupOf<FOLDS[P], A> : U[P] };

/** Each items collection of `U`, rolled up into a span parent's bands (#1436). */
type PlanRolledUp<U> = unknown extends U ? unknown : { readonly [P in keyof U]: PlanFlat<U[P] & { readonly rollup: true }> };

/** The folds of a series' own values collections. */
type PlanFoldsOf<U, FO> = unknown extends U ? unknown : [FO] extends [undefined] ? unknown : { readonly [P in keyof U]: FO };

/**
 * A series' `children` as its config takes them (#1436) — a tree's field, one
 * step-down, or several — with what each reads captured for the series' brand:
 * the tree's field, one step-down's reads and the folds of its cells, several
 * step-downs' reads.
 *
 * @typeParam R - The entry type
 * @typeParam TF - A tree's field
 * @typeParam UC - One step-down's reads
 * @typeParam FC - The folds of its cells, by collection
 * @typeParam TC - Several step-downs' reads, in order
 */
export type PlanChildrenOf<R extends EastType, TF, UC, FC, TC extends readonly unknown[]> =
    | TF
    | (PlanChildren<R, string, unknown, unknown> & { readonly [PlanReadsBrand]?: UC } & PlanFoldsBrand<FC>)
    | { readonly [I in keyof TC]: PlanChildren<R, string, unknown, unknown> & { readonly [PlanReadsBrand]?: TC[I] } };

/** One step-down's rows, their values subtotalled by its folds and `A`. */
type PlanStepSubtotalled<UC, FC, A> = {
    readonly [P in keyof UC]: UC[P] extends { readonly rows: infer U } ? { readonly rows: PlanSubtotalledBy<U, FC, A> } : UC[P]
};

/**
 * What a series' `children` read (#1436): a tree's field, recursive; a
 * step-down's rows under its field — their values collections subtotalled by
 * `A`, with their own folds, when the parent subtotals its children; several
 * step-downs' rows, each under its field.
 *
 * @remarks
 * Several step-downs carry their reads but not their cells' folds, so a parent
 * subtotalling them brands their rows as read; its build records the subtotals
 * at runtime (#1435 holds both).
 *
 * @typeParam TF - A tree's field
 * @typeParam UC - One step-down's reads
 * @typeParam FC - The folds of its cells
 * @typeParam TC - Several step-downs' reads
 * @typeParam A - The parent's aggregate, or `never` when it subtotals nothing
 */
export type PlanChildrenReads<TF, UC, FC, TC extends readonly unknown[], A = never> =
    ([TF] extends [never] ? unknown : { readonly [P in TF & string]: { readonly recursive: true } })
    & (unknown extends UC ? unknown : [A] extends [never] ? UC : PlanStepSubtotalled<UC, FC, A>)
    & ([TC] extends [never] ? unknown : PlanIntersect<TC[number]>);

/** Whether a series declares `children`. */
type PlanHasChildren<TF, UC, TC> = [TF] extends [never] ? (unknown extends UC ? ([TC] extends [never] ? false : true) : true) : true;

/** The facts of a values consumer: its reads, fold and subtotal flag. */
type PlanUseFacts<E> = E extends { readonly [PlanUseBrand]?: infer F } ? Exclude<F, undefined> : never;
/** What a values consumer reads — none when it names nothing. */
type PlanUseReads<E> = E extends { readonly [PlanReadsBrand]?: infer U } ? (unknown extends U ? PlanNone : Exclude<U, undefined>) : PlanNone;
/** A table position's subtotal flag. */
type PlanFlagOf<E> = E extends unknown ? (PlanUseFacts<E> extends { readonly rollup: infer RO } ? RO : false) : never;
/** A table position's fold. */
type PlanFoldOfUse<E> = PlanUseFacts<E> extends { readonly fold: infer FO } ? FO : never;
/** Whether any of a table's positions is flagged to feed its parent's subtotal. */
type PlanAnyFlagged<S extends readonly unknown[]> = true extends PlanFlagOf<S[number]> ? true : false;
/** Whether a table position feeds its parent's subtotal: flagged, or every position when none is. */
type PlanAggregable<E, Flagged extends boolean> = Flagged extends true ? (PlanFlagOf<E> extends true ? true : false) : true;

/** What a table's positions read: each it subtotals, by its fold and the table's aggregate, when it subtotals its own entries (a tree). */
type PlanPositionsReads<S, Tree extends boolean, A> =
    [S] extends [never] ? unknown
    : S extends readonly unknown[]
        ? PlanReadsNormal<PlanIntersect<S[number] extends infer E
            ? E extends unknown
                ? (Tree extends true ? (PlanAggregable<E, PlanAnyFlagged<S>> extends true ? PlanSubtotalled<PlanUseReads<E>, PlanFoldOfUse<E>, A> : PlanUseReads<E>) : PlanUseReads<E>)
                : never
            : never>>
        : unknown;

/** The folds of a table's aggregable positions, by collection. */
type PlanPositionsFolds<S> =
    [S] extends [never] ? unknown
    : S extends readonly unknown[]
        ? PlanReadsNormal<PlanIntersect<S[number] extends infer E
            ? E extends unknown ? (PlanAggregable<E, PlanAnyFlagged<S>> extends true ? PlanFoldsOf<PlanUseReads<E>, PlanFoldOfUse<E>> : PlanNone) : never
            : never>>
        : unknown;

// ============================================================================
// Editing — what a gesture writes (#880, #825, #1436)
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
 * The fields of an item — a struct item's own.
 *
 * @typeParam T - The item type
 */
export type PlanItemFields<T extends EastType> = T extends StructType<infer F> ? F : never;

/**
 * The East types an item's instant field may be (#825) — a move writes the
 * axis's instant into it on its own arm: a `DateTime` on a time axis, a
 * `Float` or an `Integer` (rounded) on a number axis, a `String` on an ordinal
 * one, or the {@link PlanInstantType} itself on any. An `Option` of a
 * `DateTime` is an instant field too (#1436): {@link PlanItemTimeField}.
 */
export type PlanItemInstantType = DateTimeType | FloatType | IntegerType | StringType | PlanInstantType;

/**
 * What the gestures on a series' rows write (#1436): the collection its
 * elements' read names (`runs`, `events`, `chips` or `marks`), over the times
 * named. `true`: moves and resizes write the item's named times, and a move to
 * another row takes the item there under its id. `{ create }`: those, and a
 * dropped card becomes the item `create` gives, under an id the Plan mints.
 *
 * @remarks
 * An item is found by its id, its key in the collection — an element's key is
 * its item's id — so a move keeps it. A move onto a row whose collection
 * already holds the id is refused, and so is a dropped card whose minted id the
 * collection holds.
 *
 * @typeParam R - The entry type
 * @typeParam KT - The entries' key type
 * @typeParam I - The collection's item type
 */
export type PlanItemsEdit<R extends EastType, KT extends EastType, I extends EastType> = true | {
    /** The item a dropped card becomes, from the drop (the card, the row, the bucket's instant, the minted id), the row and its key. */
    create: (drop: ExprType<PlanDropType>, row: PlanEntryExpr<R>, key: ExprType<KT>) => SubtypeExprOrValue<I>;
};

/**
 * A series' `edit`, typed by the collection its elements read (#1436) — none
 * when they are given as a function, which names no collection to write.
 *
 * @typeParam R - The entry type
 * @typeParam KT - The entries' key type
 * @typeParam F - The collection its elements' read names
 */
export type PlanEditOf<R extends EastType, KT extends EastType, F extends string> =
    string extends F ? never : PlanItemsEdit<R, KT, PlanCollectionItem<R, F>>;

/** An edit declaration with its entry type erased — what the build machinery reads. */
type AnyEdit = true | { readonly create: (drop: ExprType<PlanDropType>, entry: ExprType<EastType>, key: ExprType<EastType>) => unknown };

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
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 */
export interface PlanSeriesRowConfig<
    R extends EastType, KT extends EastType = StringType,
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
> extends PlanSeriesIdentity {
    /**
     * The East type of the entries' keys, as the accessors receive them —
     * `StringType` by default. Declare it when an accessor reads a key of
     * another type (a source keyed by `Integer`); a series whose accessors
     * ignore the key needs none, whatever the collection.
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
    /** Per-row expand-in-place accessor — returns the field's `Option`. */
    expand?: PlanAccessor<R, OptionType<PlanExpandType>, KT>;
    /**
     * The entry's children (#1436) — `field`, a `Dict` field holding more of
     * this series' own entries (a tree, to any depth), or
     * `Plan.children(field, [series…])` step-downs to child rows of another
     * type ({@link PlanChildrenInput}).
     */
    children?: PlanChildrenOf<R, CT, CU, CF, CS>;
    /** Initial collapse of a row that has children — a constant, or per entry. */
    collapsed?: boolean | PlanAccessor<R, BooleanType, KT>;
}

/**
 * Config for {@link Plan.series.span} — state-run rows; a parent shows its
 * own runs plus bands over its subtree's (each band sums its runs' quantities
 * unit by unit — a quantity carries its unit, #824).
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind its runs ride
 * @typeParam KT - The entries' key type
 * @typeParam FR - The collection its runs read
 * @typeParam UR - What its runs read
 * @typeParam UD - What its decisions read
 * @typeParam UP - What its ports read
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 * @typeParam RL - Its `rollup`, as written
 */
export interface PlanSpanSeriesConfig<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    FR extends string = string, UR = unknown, UD = unknown, UP = unknown,
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never, RL extends PlanRollupLiteral = never,
> extends PlanSeriesRowConfig<R, KT, CT, CU, CF, CS> {
    /** The row's runs — `Plan.items(field, { from, to }, draw)` over the things people drag, or a function of the row; the runs' axis kind brands the series. */
    runs: PlanElementsAccessor<R, PlanRunType, K, KT> | PlanItemsInput<R, FR, PlanSpanTimes, PlanRunLook, K, UR>;
    /** The row's decision diamonds — `Plan.items(field, { at }, draw)`, or a function of the row. */
    decisions?: PlanElementsAccessor<R, PlanDecisionMarkType, K, KT> | PlanItemsInput<R, string, PlanPointTimes, PlanDecisionLook, K, UD>;
    /** The row's ports — `Plan.values(field, draw)`, each at its key, or a function of the row. */
    ports?: PlanElementsAccessor<R, typeof PlanPortType, K, KT> | PlanValuesInput<R, PlanPortLook, K, UP>;
    /** How a row with children rolls its subtree's runs into its bands (default `"union"`). A `views` member, which
     *  declares no `children`, declares it to roll up the children the views nest under its row (#1219). */
    rollup?: SubtypeExprOrValue<PlanRollupType> | RL;
    /** What a gesture on a row writes (#1436): `true` — runs moved and resized, by the collection and times its
     *  `runs` read names; `{ create }` — and a dropped card's item too. */
    edit?: PlanEditOf<R, KT, NoInfer<FR>>;
}

/**
 * Config for {@link Plan.series.heat} — per-bucket cell rows; a parent shows
 * its own cells, or its children's per-bucket `aggregate`.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind its cells ride
 * @typeParam KT - The entries' key type
 * @typeParam UC - What its cells read
 * @typeParam FO - How a bucket folds them
 * @typeParam A - Its `aggregate`, as written
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 */
export interface PlanHeatSeriesConfig<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    UC = unknown, FO extends PlanFoldLiteral | undefined = undefined, A extends PlanAggregateLiteral = "mean",
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
> extends PlanSeriesRowConfig<R, KT, CT, CU, CF, CS> {
    /** The row's cells — `Plan.heatCells` / `weightCells` / `segmentCells` over `Plan.values(field, draw)`, or a function of
     *  the row; its kind brands the series. A parent may hold no cells, and then shows its children's aggregate on `scale`. */
    cells: PlanKindedAccessor<R, PlanHeatCellsInput<K>, KT> | PlanValuesUse<"heat", R, K, UC, FO>;
    /** How a parent with no cells of its own derives them from its children (default `"mean"`). */
    aggregate?: SubtypeExprOrValue<PlanAggregateType> | A;
    /** The scale a parent's derived cells paint on (min / max / warn threshold, #824); omit ⇒ the extent
     *  they span. A row's own cells paint on their arm's scale. */
    scale?: PlanHeatScaleInput;
}

/**
 * Config for {@link Plan.series.table} — bucketed numerals; a parent shows its
 * own values, or per-position subtotals.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind its cells ride
 * @typeParam KT - The entries' key type
 * @typeParam UC - What its `cells` read
 * @typeParam S - Its `series` positions, as written
 * @typeParam FO - Its `cells`' fold, as written
 * @typeParam A - Its `aggregate`, as written
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 */
export interface PlanTableSeriesOfConfig<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    UC = unknown, S extends readonly unknown[] = never, FO extends PlanFoldLiteral = "sum", A extends TableAggregateLiteral = "sum",
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
> extends PlanSeriesRowConfig<R, KT, CT, CU, CF, CS> {
    /** The row's cells — `Plan.tableCells(Plan.values(field, draw))`, or a function of the row: sugar for one unstyled value
     *  series; its kind brands the series. A parent may hold none, and then shows its children's subtotal. */
    cells?: PlanKindedAccessor<R, PlanTableCellsInput<K>, KT> | PlanValuesUse<"tableCells", R, K, UC>;
    /** How a bucket folds the `cells` at a coarser resolution than theirs (default `"sum"`, #824) — a
     *  `series` position declares its own (`Plan.tableSeries({ fold })`). */
    fold?: FO | SubtypeExprOrValue<PlanFoldType>;
    /** The row's positions — `Plan.tableSeries({ cells: Plan.tableCells(Plan.values(…)) })` each, or a function of the
     *  row returning `Plan.tableSeries` results; exclusive with `cells`. */
    series?: PlanElementsAccessor<R, PlanTableSeriesType, K, KT> | (S & readonly PlanValuesUse<"tableSeries", R, K, unknown, PlanFoldLiteral | undefined, boolean>[]);
    /** Part layout when several value series render — `"horizontal"` (default) / `"vertical"`. */
    split?: SubtypeExprOrValue<PlanTableSplitType> | PlanTableSplitLiteral;
    /** Row emphasis — `"body"` (default) / `"header"` / `"footer"`. */
    emphasis?: SubtypeExprOrValue<PlanTableEmphasisType> | PlanTableEmphasisLiteral;
    /** How a parent with no values of its own subtotals its children (default `"sum"`). */
    aggregate?: SubtypeExprOrValue<TableAggregateType> | A;
    /** Numeral format for the rows' values and derived subtotals — a `Format.*` spec. */
    format?: SubtypeExprOrValue<TickFormatType>;
    /** `true` ⇒ a number typed into one of its `cells` is written as the value at the bucket's start, added where none
     *  is, deleted when cleared (#1436) — its cells a `Plan.values` read drawing each value as stored, `value: some(v)`.
     *  A `series` position declares its own (`Plan.tableSeries({ cells, edit: true })`). */
    edit?: PlanValuesEdit;
}

/**
 * Config for {@link Plan.series.buckets} — one bucket row per entry.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind its tiles ride
 * @typeParam KT - The entries' key type
 * @typeParam FE - The collection its tiles read
 * @typeParam UE - What its tiles read
 * @typeParam UM - What its markers read
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 */
export interface PlanBucketsSeriesConfig<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    FE extends string = string, UE = unknown, UM = unknown,
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
> extends PlanSeriesRowConfig<R, KT, CT, CU, CF, CS> {
    /** Per-row sub-slot lanes accessor; omitted ⇒ unbucketed rows. */
    lanes?: PlanAccessor<R, ArrayType<PlanLaneType>, KT>;
    /** The row's tiles — `Plan.items(field, { at }, draw)`, or a function of the row; the tiles' axis kind brands the series. */
    events: PlanElementsAccessor<R, PlanBucketEventType, K, KT> | PlanItemsInput<R, FE, PlanPointTimes, PlanBucketEventLook, K, UE>;
    /** The row's cell markers — `Plan.values(field, draw)`, each at its key, or a function of the row. */
    markers?: PlanElementsAccessor<R, PlanCellMarkerType, K, KT> | PlanValuesInput<R, PlanCellMarkerLook, K, UM>;
    /** What a gesture on a row writes (#1436): `true` — tiles moved, by the collection and the instant its `events` read
     *  names; `{ create }` — and a dropped card's item too. */
    edit?: PlanEditOf<R, KT, NoInfer<FE>>;
}

/**
 * Config for {@link Plan.series.cards} — one cards row per entry.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind its chips ride
 * @typeParam KT - The entries' key type
 * @typeParam FC - The collection its chips read
 * @typeParam UC - What its chips read
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 */
export interface PlanCardsSeriesConfig<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    FC extends string = string, UC = unknown,
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
> extends PlanSeriesRowConfig<R, KT, CT, CU, CF, CS> {
    /** The row's chips — `Plan.items(field, { from, to }, draw)`, or a function of the row; the chips' axis kind brands the series. */
    chips: PlanElementsAccessor<R, PlanChipType, K, KT> | PlanItemsInput<R, FC, PlanSpanTimes, PlanChipLook, K, UC>;
    /** What a gesture on a row writes (#1436): `true` — chips moved and resized, by the collection and times its `chips`
     *  read names; `{ create }` — and a dropped card's item too. */
    edit?: PlanEditOf<R, KT, NoInfer<FC>>;
}

/**
 * Config for {@link Plan.series.events} — one event row per entry.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind its marks ride
 * @typeParam KT - The entries' key type
 * @typeParam FM - The collection its marks read
 * @typeParam UM - What its marks read
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 */
export interface PlanEventsSeriesConfig<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    FM extends string = string, UM = unknown,
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
> extends PlanSeriesRowConfig<R, KT, CT, CU, CF, CS> {
    /** The row's marks — `Plan.items(field, { at }, draw)`, or a function of the row; the marks' axis kind brands the series. */
    marks: PlanElementsAccessor<R, PlanEventMarkType, K, KT> | PlanItemsInput<R, FM, PlanPointTimes, PlanEventMarkLook, K, UM>;
    /** What a gesture on a row writes (#1436): `true` — marks moved, by the collection and the instant its `marks` read
     *  names; `{ create }` — and a dropped card's item too. */
    edit?: PlanEditOf<R, KT, NoInfer<FM>>;
}

/**
 * Config for {@link Plan.series.chart} — one chart row per entry, layers built
 * from the entry's own data.
 *
 * @typeParam R - The entry type
 * @typeParam KT - The entries' key type
 * @typeParam K - The axis kind its layers' values ride (none for Chart layers, whose x type their face hides)
 * @typeParam L - Its `layers`, as written
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 */
export interface PlanChartSeriesConfig<
    R extends EastType, KT extends EastType = StringType, K extends PlanAxisKindLiteral = never,
    L extends readonly unknown[] = never,
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
> extends PlanSeriesRowConfig<R, KT, CT, CU, CF, CS> {
    /** Per-row pinned accessor (`true` ⇒ above the virtualised body; `false` when omitted). */
    pinned?: PlanAccessor<R, BooleanType, KT>;
    /** The row's layers — `Plan.line` / `area` / `column` / `scatter` / `band` over `Plan.values(field, draw)` and
     *  `Chart.ref*` annotations, or a function of the row returning Chart layers (bare or `Plan.layer`-wrapped). */
    layers:
        | ((row: PlanEntryExpr<R>, key: ExprType<KT>) => PlanChartLayerInput | PlanChartLayerInput[])
        | (L & readonly (PlanChartLayerInput | PlanValuesUse<"layer", R, K, unknown, PlanFoldLiteral | undefined>)[]);
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
 * @typeParam K - The axis kind the summary cells ride
 * @typeParam KT - The entries' key type
 * @typeParam US - What its `summary` reads
 * @typeParam FO - How a bucket folds its summary cells
 * @typeParam A - Its `summaryAggregate`, as written
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 */
export interface PlanGroupSeriesConfig<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    US = unknown, FO extends PlanFoldLiteral | undefined = undefined, A extends PlanAggregateLiteral = never,
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
> extends PlanSeriesRowConfig<R, KT, CT, CU, CF, CS> {
    /** The strip's members — the entry's children (required: a group without members is a plain band). */
    children: PlanChildrenOf<R, CT, CU, CF, CS>;
    /** Explicit collapsed-strip cells per entry — `Plan.heatCells(Plan.values(field, draw))`, or a function of the row;
     *  exclusive with `summaryAggregate`. */
    summary?: PlanKindedAccessor<R, PlanHeatCellsInput<K>, KT> | PlanValuesUse<"heat", R, K, US, FO>;
    /** DECLARED strip aggregation over the members' heat cells — `"mean"` / `"max"` / `"sum"`; exclusive with `summary`. */
    summaryAggregate?: SubtypeExprOrValue<PlanAggregateType> | A;
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
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 */
export interface PlanViewsSeriesConfig<
    R extends EastType, KT extends EastType = StringType,
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
> extends PlanSeriesIdentity {
    /** The East type of the entries' keys, as the accessors receive them (default `StringType`). */
    keyType?: KT;
    /** Membership — omitted ⇒ every entry. A member series' own `match` then decides whether its row shows. */
    match?: PlanAccessor<R, BooleanType, KT>;
    /** The entry's children — under its first view row: a tree's field, or step-downs ({@link PlanChildrenInput}). */
    children?: PlanChildrenOf<R, CT, CU, CF, CS>;
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
 * depth, series, gesture, carried) → the entry written`. `path[0 … depth)`
 * leads to the entry, and the row is the entry's own when `depth = |path|`,
 * else below it; `none` when no series here takes the gesture on that row.
 * The entry is a DETACHED value — a nested entry is written in place in its
 * collection, so only the entry itself is ever rebuilt. `carried` is the item
 * a move to another row carries between its writes (#825).
 */
type WriteFn = ExprType<FunctionType<[EastType, EastType, ArrayType<StringType>, IntegerType, StringType, PlanGestureType, PlanCarriedType], OptionType<EastType>>>;
/** An entry's own edit: `(entry, key, path, gesture, carried) → the entry written` — the row at `path` is this
 *  series' own — or `none` when its series declares no field for the gesture. */
type OwnEditFn = ExprType<FunctionType<[EastType, EastType, ArrayType<StringType>, PlanGestureType, PlanCarriedType], OptionType<EastType>>>;
/** A series' write at the top of a canvas — the series value's `write`: `(entry, key, row, gesture, carried) → the entry written`. */
type TopWriteFn = ExprType<FunctionType<[EastType, EastType, PlanRowIdType, PlanGestureType, PlanCarriedType], OptionType<EastType>>>;

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
    /**
     * How many chart rows each of its entries makes, when every entry makes as many — a fact of its definition
     * (#1398): a chart series' entry one, a `views` entry one a chart member, a section's its members' together, `0`
     * where nothing in its tree is a chart. `undefined` where it varies by entry: a `match` — its own, or a chart
     * member's — on a series that makes one, children whose rows hold one (as many as the data's), or hand-built rows,
     * whose kinds the build does not see. What a block of its entries says (`PlanBlockType.charts`).
     */
    readonly charts: number | undefined;
    /** The named reads its own fields make (#1436) — its nested series' are theirs. */
    readonly reads: readonly PlanSeriesRead[];
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
     *  `undefined` when it declares no `edit`. */
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
    if (collection.type === "Dict") return { entry: collection.value, key: collection.key };
    if (collection.type === "Array") return { entry: collection.value, key: IntegerType };
    throw new Error(`${where}: entries come from a Dict (keyed) or an Array (by index) — got a ${collection.type}`);
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
 * @param charts - How many chart rows each entry makes, when every entry makes as many (#1398) — a fixed block's none
 * @returns The block list's emitter
 */
function oneBlock(collection: EastType, rows: EmitFn, fixed: boolean, charts: number | undefined): BlocksFn {
    const each = fixed || charts === undefined ? none : some(BigInt(charts));
    return East.function([collection, PathType, IdOptType], PlanBlocksType, ($, coll, prefix, parent) => {
        const block = $.let(East.value({ fixed, parent, charts: each, rows: rows(coll, prefix, parent) }, PlanBlockType), PlanBlockType);
        return East.value([block], PlanBlocksType);
    }) as unknown as BlocksFn;
}

/**
 * The chart rows an entry makes across a list of series, when each makes a fixed number (#1398).
 *
 * @param specs - The series
 * @returns Their sum; `undefined` where one of them varies by entry
 */
function chartsOf(specs: readonly Pick<PlanSeriesSpec, "charts">[]): number | undefined {
    let sum = 0;
    for (const spec of specs) {
        if (spec.charts === undefined) return undefined;
        sum += spec.charts;
    }
    return sum;
}

/**
 * How many chart rows each entry of a series makes (#1398): its own rows' and those below them — where the rows
 * below hold any, as many as the data's children, which no definition fixes — and a `match` deciding by entry
 * whether it makes them.
 *
 * @param own - The chart rows its entry's own rows make: `undefined` where they vary by entry
 * @param below - The chart rows its children's rows hold for each child: `0` where they hold none, else how many
 *   (`undefined` where that varies)
 * @param matched - Whether a `match` decides which entries it takes
 * @returns The entry's chart rows; `undefined` where they vary by entry
 */
function entryCharts(own: number | undefined, below: number | undefined, matched: boolean): number | undefined {
    // Rows below an entry come one set a child, and the data decides how many children an entry has.
    if (own === undefined || below !== 0) return undefined;
    // A match makes an entry's rows or none — as many either way only when they hold no chart.
    return matched && own > 0 ? undefined : own;
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
 * `Plan.children(r => r.presses, …)`), or the entry itself (`g => g`). A write
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
    /** The row's kind, from the entry (a recursive entry's node), its key, whether it has child rows, and the entry as stored. */
    kind(node: ExprType<EastType>, key: ExprType<EastType>, hasChildren: ExprType<BooleanType>, value: ExprType<EastType>): ExprType<PlanRowKindType>;
    /** The row's `pinned`, when the kind reads one (chart). */
    pinned?(value: ExprType<EastType>, key: ExprType<EastType>): SubtypeExprOrValue<BooleanType>;
    /** Gutter legend chips (chart). */
    swatches?: PlanGutterFields["swatches"];
    /** What a gesture writes (#880, #825, #1436) — the kinds holding things people drag: the declaration, and the
     *  element field whose read names the collection and its times. */
    edit?: EditRecipe | undefined;
    /** The named reads its fields make (#1436). */
    reads?: readonly PlanSeriesRead[];
    /** The table positions whose values take typed numbers (#1436). */
    values?: readonly ValuesEditRecipe[];
}

/** A table position whose values take typed numbers (#1436): where it sits, and the read naming its collection. */
interface ValuesEditRecipe {
    /** Its index among the row's table series — `0` for a row's `cells`. */
    readonly position: number;
    /** The values read its cells make. */
    readonly read: PlanValuesReadSpec;
}

/** A series' `edit`, beside the element field it writes through (#1436). */
interface EditRecipe {
    /** The declaration. */
    readonly edit: AnyEdit;
    /** The element field: `runs`, `events`, `chips` or `marks`. */
    readonly elements: "runs" | "events" | "chips" | "marks";
    /** The times its elements take, for the message. */
    readonly times: "{ from, to }" | "{ at }";
    /** The element field as given. */
    readonly input: unknown;
}

/** The item field types a move can write an instant into (#825, #1436). */
const INSTANT_FIELD_TYPES: readonly EastType[] = [DateTimeType, FloatType, IntegerType, StringType, PlanInstantType, OptionType(DateTimeType)];

/** Print an item type as the text rows of one item type share (#825) — East's own printer over its type value. */
const printType = printFor(EastTypeType);

/**
 * What a move writes on a series' rows (#825, #1436): the item's instant
 * fields, named by its elements' read.
 */
interface MoveFields {
    /** The item type. */
    item: StructType;
    /** The start field (a point element's one instant) and its type. */
    start: { name: string; type: EastType };
    /** The end field and its type — two-ended elements only. */
    end: { name: string; type: EastType } | undefined;
    /** The row facts: the item type's text, and whether its elements have two ends. */
    edits: { items: string; resize: boolean };
}

/**
 * What a move writes, from the read that names the collection (#1436) — its
 * times, checked against the item type by the read's build.
 *
 * @param read - The elements' read
 * @param item - The collection's item type
 * @returns The move's fields
 */
function moveFieldsOf(read: PlanItemsReadSpec, item: StructType): MoveFields {
    const field = (name: string) => ({ name, type: item.fields[name] as EastType });
    const times = read.times;
    const edits = { items: printType(toEastTypeValue(item)), resize: !("at" in times) };
    return "at" in times
        ? { item, start: field(times.at), end: undefined, edits }
        : { item, start: field(times.from), end: field(times.to), edits };
}

/** Each instant field type's converter, built once (#825). */
const instantConverters = new ByType<ExprType<FunctionType<[PlanInstantType], OptionType<EastType>>>>();

/**
 * The converter from an axis instant into an item field's type (#825): the
 * instant on the arm the field holds — a time instant's DateTime (an `Option`
 * of one takes it as `some`, #1436), a number instant's Float (an Integer field
 * takes it rounded, half away from zero), an ordinal instant's String, or the
 * instant itself — else `none`.
 *
 * @param fieldType - The field's type (one of {@link INSTANT_FIELD_TYPES})
 * @returns `(instant) → Option<field>`
 */
function instantInto(fieldType: EastType): ExprType<FunctionType<[PlanInstantType], OptionType<EastType>>> {
    return instantConverters.get(fieldType, () => {
        const out = OptionType(fieldType);
        const kind = (fieldType as { type: string }).type;
        const whole = isTypeEqual(fieldType, PlanInstantType);
        const optional = isTypeEqual(fieldType, OptionType(DateTimeType));
        return East.function([PlanInstantType], out, ($, t) => {
            const result = $.let(none, out);
            if (whole) {
                $.assign(result, some(t));
                return result;
            }
            $.match(t, {
                time: ($2, d) => {
                    if (kind === "DateTime") $2.assign(result, some(d));
                    // An Option of a DateTime holds the instant as `some` (#1436).
                    if (optional) $2.assign(result, some(some(d)));
                },
                number: ($2, n) => {
                    if (kind === "Float") {
                        $2.assign(result, some(n));
                    } else if (kind === "Integer") {
                        const rounded = $2.let(n.greaterEqual(0).ifElse(
                            () => n.add(0.5).subtract(n.add(0.5).remainder(1)),
                            () => n.subtract(0.5).subtract(n.subtract(0.5).remainder(1))), FloatType);
                        $2.assign(result, some(rounded.toInteger()));
                    }
                },
                ordinal: ($2, s) => {
                    if (kind === "String") $2.assign(result, some(s));
                },
            });
            return result;
        }) as unknown as ExprType<FunctionType<[PlanInstantType], OptionType<EastType>>>;
    });
}

// ── Named reads, built per row type (#1436) ─────────────────────────────────

/**
 * A named read a series makes, as its build spec records it (#1436): the
 * collection, how it is read, its key type, and the config field that reads
 * it — what the root, and a source's index (#1435), hold the series to.
 *
 * @internal
 * @property field - The collection's field
 * @property read - The read
 * @property key - The collection's key type
 * @property via - The config field that reads it (`runs`, `cells`, `series[1]`, `layers[0]`, `summary`, …)
 */
export interface PlanSeriesRead {
    readonly field: string;
    readonly read: PlanReadSpec;
    readonly key: EastType;
    readonly via: string;
}

/** An East type's name as a message reads it: `an Array`, `a Dict`. */
function anOf(type: EastType): string {
    const name = (type as { type: string }).type;
    return /^[AEIOU]/.test(name) ? `an ${name}` : `a ${name}`;
}

/** A row type's shape as a message reads it: its fields, `{ name, load }`, or East's summary of another type. */
function shapeName(type: EastType): string {
    const t = type as { type: string; fields?: Record<string, EastType>; node?: EastType };
    if (t.type === "Recursive" && t.node !== undefined) return shapeName(t.node);
    if (t.type === "Struct" && t.fields !== undefined) return `{ ${Object.keys(t.fields).join(", ")} }`;
    return printTypeSummary(type);
}

/** The fields of an entry type — a struct's own, or a recursive entry's node's. */
function entryFieldsOf(rowType: EastType): Record<string, EastType> | undefined {
    const t = rowType as { type: string; fields?: Record<string, EastType>; node?: { type: string; fields?: Record<string, EastType> } };
    if (t.type === "Struct") return t.fields;
    if (t.type === "Recursive" && t.node?.type === "Struct") return t.node.fields;
    return undefined;
}

/** A collection a read names, as it is built over: its Dict type, its key and what it holds. */
interface CollectionShape {
    readonly dict: EastType;
    readonly key: EastType;
    readonly item: EastType;
}

/** The key types a values collection may be keyed by: its instants. */
const VALUE_KEY_TYPES: readonly EastType[] = [DateTimeType, FloatType, IntegerType, StringType];

/**
 * The collection a read names, checked against the entry type (#1436).
 *
 * @param rowType - The entry type
 * @param read - The read
 * @param where - The series, for the messages
 * @returns The collection's shape
 * @throws {Error} In the refusals' words: no Dict field of the row, an items collection keyed by an instant or holding no
 *   struct, a time that is no instant field of its items, a values collection keyed by no instant
 */
function collectionOfRead(rowType: EastType, read: PlanReadSpec, where: string): CollectionShape {
    const what = read.kind === "items" ? "Plan.items" : "Plan.values";
    const fields = entryFieldsOf(rowType);
    const t = fields?.[read.field] as { type: string; key?: EastType; value?: EastType } | undefined;
    if (t === undefined) {
        throw new Error(`${where}: ${what} reads "${read.field}", which is no field of its rows — name a Dict field of the row`);
    }
    if (t.type !== "Dict") {
        throw new Error(
            `${what}: "${read.field}" is ${anOf(t as EastType)} — a collection a series reads by name is a Dict, keyed by an id, ` +
            "or by its instant for values");
    }
    const key = t.key!;
    const item = t.value!;
    const keyName = (key as { type: string }).type;
    if (read.kind === "values") {
        if (!VALUE_KEY_TYPES.some((k) => isTypeEqual(k, key))) {
            throw new Error(
                `Plan.values: "${read.field}" is keyed by ${keyName} — values are keyed by their instant: a DateTime, a Float, ` +
                "an Integer or a String");
        }
        return { dict: t as EastType, key, item };
    }
    if (!isTypeEqual(key, StringType)) {
        throw new Error(
            `Plan.items: "${read.field}" is keyed by ${keyName} — things people drag are keyed by an id, a String: read values ` +
            `with Plan.values("${read.field}", draw)`);
    }
    const struct = item as { type: string; fields?: Record<string, EastType> };
    if (struct.type !== "Struct" || struct.fields === undefined) {
        throw new Error(
            `Plan.items: "${read.field}" holds ${anOf(item)}, not an item — things people drag are structs, their times fields ` +
            `of them: read values with Plan.values("${read.field}", draw)`);
    }
    const names = "at" in read.times ? [read.times.at] : [read.times.from, read.times.to];
    if (names.length === 2 && names[0] === names[1]) {
        throw new Error(`Plan.items: "${read.field}" names "${names[0]}" as both its from and its to — a run's start and end are two fields of its items`);
    }
    for (const name of names) {
        const ft = struct.fields[name];
        if (ft === undefined) {
            throw new Error(`Plan.items: "${read.field}" names its times by "${name}", which is no field of its items — name a time field of the item`);
        }
        if (!INSTANT_FIELD_TYPES.some((k) => isTypeEqual(k, ft))) {
            throw new Error(
                `Plan.items: "${read.field}" names "${name}", ${anOf(ft)} field of its items, as a time — a time is a DateTime or an ` +
                "Option of one, a Float, an Integer, a String, or a Plan.Types.Instant");
        }
    }
    return { dict: t as EastType, key, item };
}

/** Each element's look type: its type without its key and its instants. */
const lookTypes = new Map<PlanLookKind, StructType>();

/** What `draw` gives for an element of `kind`, as an East struct: the element without its key and its instants. */
function lookTypeOf(kind: PlanLookKind): StructType {
    let type = lookTypes.get(kind);
    if (type === undefined) {
        const spec = PLAN_LOOKS[kind];
        const omit: readonly string[] = [...(spec.key !== undefined ? [spec.key] : []), ...spec.instants];
        type = StructType(Object.fromEntries(Object.entries((spec.type as StructType).fields).filter(([f]) => !omit.includes(f))));
        lookTypes.set(kind, type);
    }
    return type;
}

/** What each element kind is called where a refusal names it. */
const ELEMENT_NAMES: Record<PlanLookKind, string> = {
    run: "runs", decision: "decisions", port: "ports", event: "events", marker: "markers", chip: "chips", mark: "marks",
    heat: "heat cells", weight: "weight cells", segment: "segment cells", table: "table cells", point: "points", band: "band points",
};

/** Each read's builds, by what it completes and the entry type. */
const readBuilds = new WeakMap<PlanReadSpec, Map<PlanLookKind, ByType<ExprType<FunctionType<[EastType, EastType], EastType>>>>>();

/**
 * A read built for one entry type (#1436): `(collection, entry) → elements` —
 * each item an element at its times, keyed by its id, or each value one at its
 * instant, its look `draw`'s. The collection is an argument, so the same build
 * draws an inline row's own collection and one read a cell at a time.
 *
 * @param rowType - The entry type
 * @param read - The read
 * @param kind - What each item or value completes to
 * @param where - The series, for messages
 * @returns The built function
 * @throws {Error} When the read does not build for the entry type, in the refusals' words
 */
function buildRead(rowType: EastType, read: PlanReadSpec, kind: PlanLookKind, where: string): ExprType<FunctionType<[EastType, EastType], EastType>> {
    let byKind = readBuilds.get(read);
    if (byKind === undefined) {
        byKind = new Map();
        readBuilds.set(read, byKind);
    }
    let byType = byKind.get(kind);
    if (byType === undefined) {
        byType = new ByType();
        byKind.set(kind, byType);
    }
    return byType.get(rowType, () => {
        const shape = collectionOfRead(rowType, read, where);
        const spec = PLAN_LOOKS[kind];
        const elemType = spec.type as StructType;
        const lookType = lookTypeOf(kind);
        const recursive = (rowType as { type: string }).type === "Recursive";
        const what = read.kind === "items" ? `Plan.items("${read.field}", …)` : `Plan.values("${read.field}", …)`;
        // The look, reified once: `(item or value, id or instant, entry) → look`.
        const look = (() => {
            try {
                return East.function([shape.item, shape.key, rowType], lookType, ($, item, key, row) => {
                    const node = recursive ? $.let((row as unknown as RecursiveExpr<EastType>).unwrap() as ExprType<EastType>) : row;
                    const given = read.draw(item, key, node);
                    if (given === null || typeof given !== "object" || given instanceof Expr) {
                        throw new Error(`its draw gives the look of each of its ${ELEMENT_NAMES[kind]}, an object of their fields`);
                    }
                    return East.value(spec.look(given as never) as SubtypeExprOrValue<StructType>, lookType);
                });
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                throw new Error(`${where}: ${what} does not build for its rows (${reason})`);
            }
        })();
        const fieldsOf = (l: ExprType<EastType>) => Object.fromEntries(
            Object.keys(lookType.fields).map((f) => [f, (l as unknown as Record<string, ExprType<EastType>>)[f]!]));
        const out = ArrayType(elemType);
        if (read.kind === "values") {
            const at = spec.instants[0]!;
            return East.function([shape.dict, rowType], out, ($, coll, row) => {
                const draw = $.const(look);
                return (coll as unknown as ExprType<DictType<EastType, EastType>>).toArray(($2, value, key) => {
                    const l = $2.let(draw(value as ExprType<EastType>, key as ExprType<EastType>, row));
                    return East.value({ [at]: resolveInstant(key as ExprType<EastType> as never, `${what} key`), ...fieldsOf(l) } as SubtypeExprOrValue<StructType>, elemType);
                });
            }) as unknown as ExprType<FunctionType<[EastType, EastType], EastType>>;
        }
        // Things people drag: each at its named times, keyed by its id. An item whose
        // start is an Option holding none is drawn nowhere; one whose end holds none is
        // an instant (#1434's filing).
        const item = shape.item as StructType;
        const times = read.times;
        const names = "at" in times ? [times.at] : [times.from, times.to];
        if (names.length !== spec.instants.length) {
            throw new Error(spec.instants.length === 2
                ? `${where}: its ${ELEMENT_NAMES[kind]} run from a start to an end — read them with Plan.items("${read.field}", { from, to }, draw)`
                : `${where}: its ${ELEMENT_NAMES[kind]} sit at an instant — read them with Plan.items("${read.field}", { at }, draw)`);
        }
        const optional = (name: string) => isTypeEqual(item.fields[name] as EastType, OptionType(DateTimeType));
        const instantOf = (v: ExprType<EastType>) => resolveInstant(v as never, `${what} times`);
        const keyField = spec.key!;
        return East.function([shape.dict, rowType], out, ($, coll, row) => {
            const draw = $.const(look);
            const result = $.let([], out);
            $.for(coll as unknown as ExprType<ArrayType<EastType>>, ($2, value, key) => {
                const fields = value as unknown as Record<string, ExprType<EastType>>;
                const id = key as unknown as ExprType<StringType>;
                const emit = ($3: typeof $2, instants: ExprType<PlanInstantType>[]) => {
                    const l = $3.let(draw(value, id, row));
                    $3(result.pushLast(East.value({
                        [keyField]: id,
                        ...Object.fromEntries(spec.instants.map((name, i) => [name, instants[i]!])),
                        ...fieldsOf(l),
                    } as SubtypeExprOrValue<StructType>, elemType)));
                };
                const withStart = ($3: typeof $2, start: ExprType<PlanInstantType>) => {
                    if (names.length === 1) {
                        emit($3, [start]);
                        return;
                    }
                    const to = names[1]!;
                    if (!optional(to)) {
                        emit($3, [start, instantOf(fields[to]!)]);
                        return;
                    }
                    const end = $3.let((fields[to] as unknown as ExprType<OptionType<DateTimeType>>).match({
                        some: (_$4, d) => East.value(variant("time", d), PlanInstantType),
                        none: () => start,
                    }), PlanInstantType);
                    emit($3, [start, end]);
                };
                const from = names[0]!;
                if (!optional(from)) {
                    withStart($2, $2.let(instantOf(fields[from]!), PlanInstantType));
                    return;
                }
                $2.match(fields[from] as unknown as ExprType<OptionType<DateTimeType>>, {
                    some: ($3, d) => withStart($3, $3.let(East.value(variant("time", d), PlanInstantType), PlanInstantType)),
                });
            });
            return result;
        }) as unknown as ExprType<FunctionType<[EastType, EastType], EastType>>;
    });
}

/** A config field resolved for its entry type (#1436): its value for one row, and the reads it makes. */
interface RowField {
    /** The field's value for one row — from the entry (its node), its key and the entry as stored. */
    readonly at: (node: ExprType<EastType>, key: ExprType<EastType>, value: ExprType<EastType>) => unknown;
    /** The named reads it makes. */
    readonly reads: readonly PlanSeriesRead[];
}

/** A collection field of the entry, for one row: the field read off its node. */
function collectionOn(node: ExprType<EastType>, field: string): ExprType<EastType> {
    return (node as unknown as Record<string, ExprType<EastType>>)[field]!;
}

/** The record of a read a series makes. */
function readRecord(rowType: EastType, read: PlanReadSpec, via: string, where: string): PlanSeriesRead {
    return { field: read.field, read, key: collectionOfRead(rowType, read, where).key, via };
}

/**
 * An element field of a series config, resolved for its entry type (#1436): a
 * function of the row as before, or a read — of items for the things people
 * drag (runs, decisions, tiles, chips, marks), of values for ports and
 * markers.
 *
 * @param rowType - The entry type
 * @param input - The field as given
 * @param kind - What each element is
 * @param where - The series, for messages
 * @param via - The field's name
 * @returns The field, or `undefined` when it is not given
 * @throws {Error} When a read of the other sort, or a consumer, is given
 */
function elementField(rowType: EastType, input: unknown, kind: PlanLookKind, where: string, via: string): RowField | undefined {
    if (input === undefined) return undefined;
    if (typeof input === "function") {
        const accessor = input as (node: ExprType<EastType>, key: ExprType<EastType>) => unknown;
        return { at: (node, key) => accessor(node, key), reads: [] };
    }
    const read = planReadOf(input);
    if (read === undefined) {
        throw new Error(`${where}: ${via} is a function of the row, or a read of its collection — ${
            PLAN_LOOKS[kind].key !== undefined ? "Plan.items(field, times, draw)" : "Plan.values(field, draw)"}`);
    }
    const keyed = PLAN_LOOKS[kind].key !== undefined;
    if (keyed && read.kind !== "items") {
        throw new Error(
            `${where}: its ${via} are things people drag, keyed by an id — read them with Plan.items(field, ${
                PLAN_LOOKS[kind].instants.length === 2 ? "{ from, to }" : "{ at }"}, draw)`);
    }
    if (!keyed && read.kind !== "values") {
        throw new Error(`${where}: its ${via} have no id of their own, so each is keyed by its instant — read them with Plan.values(field, draw)`);
    }
    const built = buildRead(rowType, read, kind, where);
    return { at: (node, _key, value) => built(collectionOn(node, read.field), value), reads: [readRecord(rowType, read, via, where)] };
}

/** What each consumer is, where a refusal names what a field takes. */
const CONSUMER_HINTS: Record<PlanValuesUseSpec["makes"], string> = {
    heat: "Plan.heatCells, Plan.weightCells or Plan.segmentCells over Plan.values(field, draw)",
    tableCells: "Plan.tableCells(Plan.values(field, draw))",
    tableSeries: "Plan.tableSeries({ cells: Plan.tableCells(Plan.values(field, draw)) })",
    layer: "Plan.line, Plan.area, Plan.column, Plan.scatter or Plan.band over Plan.values(field, draw)",
};

/**
 * A consumer of a values read, resolved for the entry type (#1436): the row's
 * values completed into its cells, and what the consumer makes of them.
 *
 * @param rowType - The entry type
 * @param use - The consumer
 * @param makes - What the field takes
 * @param where - The series, for messages
 * @param via - The field's name
 * @returns The field
 */
function useField(rowType: EastType, use: PlanValuesUseSpec, makes: PlanValuesUseSpec["makes"], where: string, via: string): RowField {
    if (use.makes !== makes) throw new Error(`${where}: ${via} takes ${CONSUMER_HINTS[makes]}`);
    const built = buildRead(rowType, use.read, use.cell, where);
    return {
        at: (node, _key, value) => use.wrap(built(collectionOn(node, use.read.field), value) as ExprType<EastType>),
        reads: [readRecord(rowType, use.read, via, where)],
    };
}

/**
 * A field whose value is one consumer's (cells, a group's summary) resolved
 * for the entry type (#1436): a function of the row as before, or a consumer
 * of a values read.
 *
 * @param rowType - The entry type
 * @param input - The field as given
 * @param makes - What it takes
 * @param where - The series, for messages
 * @param via - The field's name
 * @returns The field, or `undefined` when it is not given
 */
function consumerField(rowType: EastType, input: unknown, makes: PlanValuesUseSpec["makes"], where: string, via: string): RowField | undefined {
    if (input === undefined) return undefined;
    if (typeof input === "function") {
        const accessor = input as (node: ExprType<EastType>, key: ExprType<EastType>) => unknown;
        return { at: (node, key) => accessor(node, key), reads: [] };
    }
    const use = planUseOf(input);
    if (use !== undefined) return useField(rowType, use, makes, where, via);
    const read = planReadOf(input);
    throw new Error(read !== undefined
        ? `${where}: ${via} takes ${CONSUMER_HINTS[makes]} — give "${read.field}" to it, as ${via}: ${CONSUMER_HINTS[makes].split(" over ")[0]!.split(",")[0]}(Plan.values("${read.field}", draw))`
        : `${where}: ${via} is a function of the row, or ${CONSUMER_HINTS[makes]}`);
}

/**
 * A field whose value is a list (a table's positions, a chart's layers)
 * resolved for the entry type (#1436): a function of the row as before, or a
 * TS array whose consumers are built per row and whose other members pass as
 * they are.
 *
 * @param rowType - The entry type
 * @param input - The field as given
 * @param makes - What its consumers make
 * @param where - The series, for messages
 * @param via - The field's name
 * @returns The field, its value a TS array per row (each consumer's value in its place), or `undefined` when not given
 */
function listField(rowType: EastType, input: unknown, makes: PlanValuesUseSpec["makes"], where: string, via: string): RowField | undefined {
    if (input === undefined) return undefined;
    if (typeof input === "function") {
        const accessor = input as (node: ExprType<EastType>, key: ExprType<EastType>) => unknown;
        return { at: (node, key) => accessor(node, key), reads: [] };
    }
    if (!Array.isArray(input)) throw new Error(`${where}: ${via} is a function of the row, or a list of ${CONSUMER_HINTS[makes]}`);
    const members = input.map((member: unknown, i) => {
        const use = planUseOf(member);
        if (use !== undefined) return useField(rowType, use, makes, where, `${via}[${i}]`);
        const read = planReadOf(member);
        if (read !== undefined) throw new Error(`${where}: ${via}[${i}] takes ${CONSUMER_HINTS[makes]}, not the read "${read.field}" alone`);
        return { at: () => member, reads: [] } satisfies RowField;
    });
    return {
        at: (node, key, value) => members.map((m) => m.at(node, key, value)),
        reads: members.flatMap((m) => m.reads),
    };
}

/**
 * A table's positions whose values take typed numbers (#1436): its `cells`
 * when the series declares `edit: true`, and each `Plan.tableSeries` position
 * declaring its own — each drawing every value as it is stored.
 *
 * @param rowType - The entry type
 * @param cfg - The table's `cells`, `series` and `edit`, as given
 * @param where - The series, for messages
 * @returns The typed positions, in order
 * @throws {Error} In the refusals' words: `edit` beside cells given as a function, or over a draw giving another number than each value
 */
function tableEditsOf(rowType: EastType, cfg: { readonly cells?: unknown; readonly series?: unknown; readonly edit?: unknown }, where: string): ValuesEditRecipe[] {
    const out: ValuesEditRecipe[] = [];
    if (cfg.edit !== undefined) {
        if (cfg.edit !== true) throw new Error(`${where}: edit is true — its cells' values take typed numbers — or left out`);
        if (cfg.series !== undefined) {
            throw new Error(`${where}: edit is its cells' — with positions, each declares its own: Plan.tableSeries({ cells, edit: true })`);
        }
        const use = planUseOf(cfg.cells);
        if (use === undefined) {
            throw new Error(`${where}: edit writes the values its cells read — give cells as Plan.tableCells(Plan.values(field, draw))`);
        }
        out.push({ position: 0, read: use.read });
    }
    if (Array.isArray(cfg.series)) {
        cfg.series.forEach((member: unknown, position) => {
            const use = planUseOf(member);
            if (use?.edit === true) out.push({ position, read: use.read });
        });
    }
    for (const typed of out) refuseDrawnOtherwise(rowType, typed.read, where);
    return out;
}

/** The value types a typed number is stored as (#1436), and what drawing each as stored looks like. */
type TypedValueKind = "float" | "option" | "integer";

/**
 * Refuse a typed position whose cells draw another number than each value
 * (#1436): a typed number is stored as the value, so each value must draw as
 * it is — a `Float`'s `some(v)` (or `v`), an `Option` of a `Float`'s `v`, an
 * `Integer`'s `some(v.toFloat())` (or `v.toFloat()`). Read off the draw's
 * expression, as an accessor's field is (`childRefOf`).
 *
 * @param rowType - The entry type
 * @param read - The position's values read
 * @param where - The series, for the message
 * @throws {Error} In the refusal's words
 */
function refuseDrawnOtherwise(rowType: EastType, read: PlanValuesReadSpec, where: string): void {
    const shape = collectionOfRead(rowType, read, where);
    const kind: TypedValueKind | undefined = isTypeEqual(shape.item, FloatType) ? "float"
        : isTypeEqual(shape.item, OptionType(FloatType)) ? "option"
        : isTypeEqual(shape.item, IntegerType) ? "integer" : undefined;
    let asStored = false;
    if (kind !== undefined) {
        const recursive = (rowType as { type: string }).type === "Recursive";
        East.function([shape.item, shape.key, rowType], NullType, ($, value, at, row) => {
            const node = recursive ? $.let((row as unknown as RecursiveExpr<EastType>).unwrap() as ExprType<EastType>) : row;
            const given = read.draw(value, at, node) as { value?: unknown } | null;
            const param = Expr.ast(value as unknown as Expr);
            const astOf = (x: unknown) => (x instanceof Expr ? Expr.ast(x) as unknown as { ast_type: string; builtin?: string; arguments?: unknown[] } : undefined);
            const isValue = (x: unknown) => astOf(x) === param;
            const isWidened = (x: unknown) => {
                const ast = astOf(x);
                return ast !== undefined && ast.ast_type === "Builtin" && ast.builtin === "IntegerToFloat" && ast.arguments?.[0] === param;
            };
            const drawn = given === null || typeof given !== "object" ? undefined : given.value;
            const wrapped = typeof drawn === "object" && drawn !== null && !(drawn instanceof Expr) && (drawn as { type?: unknown }).type === "some"
                ? (drawn as { value: unknown }).value : undefined;
            asStored = kind === "option" ? isValue(drawn)
                : kind === "float" ? isValue(drawn) || isValue(wrapped)
                : isWidened(drawn) || isWidened(wrapped);
            return null;
        });
    }
    if (!asStored) {
        throw new Error(
            `${where}: edit writes a typed number as its readings, and its cells draw another number than each reading — ` +
            "draw value: some(v), and show it another way through format");
    }
}

/** Erase a config's entry type for the untyped build machinery. */
type AnyRowConfig = Omit<PlanSeriesRowConfig<EastType, EastType>, "children"> & { children?: unknown };

/**
 * Refuse a tree's `children` field that is not a Dict of the row's own type,
 * keyed by an id (#1436).
 *
 * @param rowType - The entry type
 * @param field - The field `children` names
 * @param where - The series, for the message
 */
function checkTree(rowType: EastType, field: string, where: string): void {
    const t = entryFieldsOf(rowType)?.[field] as { type: string; key?: EastType; value?: EastType } | undefined;
    if (t === undefined) {
        throw new Error(
            `${where}: children names "${field}", which is no field of its rows — name the Dict field holding more of its ` +
            "rows, or step down to rows of another type with Plan.children(field, [series…])");
    }
    if (t.type !== "Dict") {
        throw new Error(`${where}: children names "${field}", ${anOf(t as EastType)} — a tree's children are a Dict of the row's own type, keyed by an id`);
    }
    if (!isTypeEqual(t.value!, rowType)) {
        throw new Error(`${where}: children "${field}" holds ${shapeName(t.value!)}, not ${shapeName(rowType)} — step down to it with Plan.children("${field}", [series…])`);
    }
    if (!isTypeEqual(t.key!, StringType)) {
        throw new Error(`${where}: children "${field}" is keyed by ${(t.key as { type: string }).type} — child rows are keyed by an id, a String`);
    }
}

/**
 * Refuse a step-down's field that is not a Dict of child rows keyed by an id
 * (#1436).
 *
 * @param rowType - The parent entry type
 * @param field - The field `Plan.children` names
 * @param where - The series, for the message
 */
function checkStepField(rowType: EastType, field: string, where: string): void {
    const t = entryFieldsOf(rowType)?.[field] as { type: string; key?: EastType; value?: EastType } | undefined;
    if (t === undefined) {
        throw new Error(`${where}: Plan.children("${field}", …) steps down to "${field}", which is no field of its rows — name the Dict field holding the child rows`);
    }
    if (t.type !== "Dict") {
        throw new Error(`Plan.children: "${field}" is ${anOf(t as EastType)} — child rows are a Dict, keyed by an id`);
    }
    if (!isTypeEqual(t.key!, StringType)) {
        throw new Error(`Plan.children: "${field}" is keyed by ${(t.key as { type: string }).type} — child rows are keyed by an id, a String`);
    }
    const child = (t.value as { type: string }).type;
    if (child !== "Struct" && child !== "Recursive") {
        throw new Error(`Plan.children: "${field}" holds ${anOf(t.value!)}, not rows — child rows are structs`);
    }
}

/**
 * A series' `edit`, checked against the element field it writes through
 * (#1436): `true` or `{ create }`, beside a read of items.
 *
 * @param edit - The declaration as given
 * @param elements - The element field: `runs`, `events`, `chips` or `marks`
 * @param times - The times those elements take
 * @param input - The element field as given
 * @param where - The series, for the messages
 * @returns The recipe, or `undefined` when no `edit` is declared
 * @throws {Error} In the refusals' words
 */
function editRecipeOf(edit: unknown, elements: EditRecipe["elements"], times: EditRecipe["times"], input: unknown, where: string): EditRecipe | undefined {
    if (edit === undefined) return undefined;
    const create = typeof edit === "object" && edit !== null ? (edit as { create?: unknown }).create : undefined;
    if (edit !== true && (typeof create !== "function" || Object.keys(edit as object).some((k) => k !== "create"))) {
        throw new Error(
            `${where}: edit names nothing — its ${elements}' read names the collection and its times: give edit: true, or ` +
            "edit: { create } to take dropped cards too");
    }
    const read = planReadOf(input);
    if (read === undefined) {
        throw new Error(`${where}: edit moves the items its ${elements} name — give ${elements} as Plan.items(field, ${times}, draw)`);
    }
    if (read.kind !== "items") {
        throw new Error(
            `${where}: edit moves the items its ${elements} name, and they read values — what people move is keyed by an id: ` +
            `give ${elements} as Plan.items(field, ${times}, draw)`);
    }
    return { edit: edit as AnyEdit, elements, times, input };
}

/**
 * The build spec of a data series (span / buckets / chart / heat / table /
 * cards / events / group).
 *
 * @remarks
 * Per key type it builds ONE entry-row function (the entry's gutter, kind and
 * row facts through the one envelope) and the membership, collapse and
 * children functions, each reified once and CALLED in the block's loop. The
 * block walks the collection in order; each matched entry's row is followed by
 * its children's rows — a tree (`children: field`) walks the entry's subtree
 * with an explicit pre-order stack (its depth is data), a step-down calls its
 * child series' blocks on the child collection.
 */
function dataSpec(rowType: EastType, cfg: AnyRowConfig, recipe: KindRecipe): PlanSeriesSpec {
    const where = `Plan.series.${recipe.arm} "${cfg.key}"`;
    // A recursive entry reaches the accessors as its NODE (`PlanEntryExpr`),
    // so they read its fields directly at every depth.
    const recursive = (rowType as { type: string }).type === "Recursive";
    const nodeOf = (value: ExprType<EastType>): ExprType<EastType> => recursive
        ? (value as unknown as RecursiveExpr<EastType>).unwrap() as ExprType<EastType>
        : value;
    /** An accessor over entries, applied to an entry value (its node, when recursive). */
    const onEntry = (accessor: (v: ExprType<EastType>, k: ExprType<EastType>) => Expr) =>
        (v: ExprType<EastType>, k: ExprType<EastType>): Expr => accessor(nodeOf(v), k);
    const children = cfg.children;
    // A tree (#1436): a field of the entry holding more of its entries — or, the
    // event kinds' own (#1194), an accessor computing them.
    const treeField = typeof children === "string" ? children : undefined;
    const tree: ((v: ExprType<EastType>, k: ExprType<EastType>) => Expr) | undefined = treeField !== undefined
        ? (v) => collectionOn(v, treeField) as unknown as Expr
        : typeof children === "function" ? children as (v: ExprType<EastType>, k: ExprType<EastType>) => Expr : undefined;
    if (treeField !== undefined) checkTree(rowType, treeField, where);
    const steps: AnyStepDown[] = children === undefined || tree !== undefined
        ? [] : (Array.isArray(children) ? children as AnyStepDown[] : [children as AnyStepDown]);
    for (const step of steps) {
        if (!isStepDown(step)) {
            throw new Error(`${where}: \`children\` is a field of the row holding more of its rows, or Plan.children(field, [series…]) step-downs`);
        }
        if (step.field !== undefined) checkStepField(rowType, step.field, where);
    }
    /** A step-down's child collection, from the entry (its node). */
    const stepOf = (step: AnyStepDown) => (step.field !== undefined
        ? (v: ExprType<EastType>) => collectionOn(v, step.field!) as unknown as Expr
        : step.of!);
    const nested = steps.flatMap((s) => s.series.map((x) => nestedSpec(x, `${where} › children`)));
    // How many chart rows each entry makes (#1398): a chart series' own row, and below it a tree's walk of more of
    // this series' rows, or a step-down's series' over the child collection.
    const ownCharts = recipe.arm === "chart" ? 1 : 0;
    const charts = entryCharts(ownCharts,
        children === undefined ? 0 : tree !== undefined ? ownCharts : chartsOf(nested), cfg.match !== undefined);

    // The removed verdict, named (#1260) — a plain JS caller would otherwise
    // lose it silently.
    for (const removed of ["review", "approval"] as const) {
        if (removed in (cfg as object)) {
            throw new Error(`${where}: \`${removed}\` is removed (#1260) — a Plan approves and rejects nothing: its changes are drafts of the root's \`editing\` session`);
        }
    }
    // What a gesture writes (#880, #825, #1436) — through the collection its
    // elements' read names: a dropped card's item under its minted id, a moved
    // element's item re-timed under its id, or taken to another row.
    const edit = recipe.edit;
    const editRead = edit !== undefined ? planReadOf(edit.input) as PlanItemsReadSpec : undefined;
    const editShape = editRead !== undefined ? collectionOfRead(rowType, editRead, where) : undefined;
    const itemType = editShape?.item;
    const move: MoveFields | undefined = editRead !== undefined ? moveFieldsOf(editRead, editShape!.item as StructType) : undefined;
    const create = edit !== undefined && edit.edit !== true ? edit.edit.create : undefined;
    // What a typed number writes (#1436): each typed position's collection, keyed by the bucket's start.
    const typedWrites = (recipe.values ?? []).map((typed) => {
        const shape = collectionOfRead(rowType, typed.read, where);
        return { position: typed.position, field: typed.read.field, key: shape.key, value: shape.item, keyAs: instantInto(shape.key) };
    });
    const edits = move !== undefined || typedWrites.length > 0
        ? {
            drop: create !== undefined,
            move: move !== undefined ? some(move.edits) : none,
            values: typedWrites.map((typed) => BigInt(typed.position)),
        }
        : undefined;

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
                kind:      recipe.kind(entry, key, hasChildren, value),
                collapsed,
                ...(recipe.pinned !== undefined ? { pinned: recipe.pinned(entry, key) } : {}),
                ...(cfg.status !== undefined ? { status: cfg.status(entry, key) } : {}),
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

    /** The tree's children, built for entries keyed by `kt` — the child collection's type is its output. */
    const childOf = (kt: EastType) => building(where, kt, () =>
        reifyAccessor([rowType, kt], onEntry(tree!))) as unknown as
        ExprType<FunctionType<[EastType, EastType], EastType>>;

    /** The subtree walk below one entry — every level's entries in pre-order, over the child collection type. */
    const walkFor = (cc: EastType): ExprType<FunctionType<[EastType, ArrayType<StringType>, PlanRowIdType], PlanRowsCollectionType>> =>
        walks.get(cc, () => {
            const at = `${where} › children`;
            const { entry, key: kc } = shapeOf(cc, at);
            assertEntry(entry, rowType, `${at} (a tree's children are more of this series' rows — step down to another type with Plan.children)`);
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
        if (tree !== undefined) {
            const of = childOf(kt);
            const cc = (Expr.type(of) as unknown as { output: EastType }).output;
            const walk = walkFor(cc);
            return East.function([rowType, kt, PlanRowIdType, PathType], PlanRowsCollectionType,
                (_$, value, key, id, path) => walk(of(value, key), path, id)) as unknown as ChildrenFn;
        }
        const parts = steps.map((step, i) => {
            const at = `${where} › children[${i}]`;
            const of = building(at, kt, () => reifyAccessor([rowType, kt], onEntry(stepOf(step)))) as unknown as
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

    // ── Writing a gesture back (#880, #1436) ──────────────────────────────
    // The entry a writer is handed is DETACHED (the series value's `write`
    // copies it), so a nested entry is written in place in its collection and
    // an item joins its collection in place, under its id.
    const owns = new ByType<OwnEditFn | undefined>();
    const writers = new ByType<WriteFn | undefined>();
    const entryAccess = (value: ExprType<EastType>) => nodeOf(value) as unknown as Record<string, ExprType<EastType>>;

    /** The item a dropped card becomes, for entries keyed by `kt`. */
    const createFor = (kt: EastType, make: NonNullable<typeof create>) => building(where, kt, () => East.function(
        [PlanDropType, rowType, kt], itemType!,
        (_$, drop, value, key) => make(drop, nodeOf(value), key) as SubtypeExprOrValue<EastType>,
    ));

    /**
     * An item at a move's instants (#825, #1436) — the instant fields its read
     * names set from the axis's instants, each on its own arm, every other
     * field as it was; `none` when an instant rides an arm the field cannot
     * hold (a time instant into a Float field).
     */
    const placed = move === undefined ? undefined : (() => {
        const m = move;
        const startAs = instantInto(m.start.type);
        const endAs = m.end !== undefined ? instantInto(m.end.type) : undefined;
        return East.function([m.item, PlanInstantType, PlanInstantType], OptionType(m.item), ($, item, start, end) => {
            const result = $.let(none, OptionType(m.item));
            const asStart = $.const(startAs);
            const s = $.let(asStart(start), OptionType(m.start.type));
            const read = item as unknown as Record<string, ExprType<EastType>>;
            const rebuild = (fields: Record<string, ExprType<EastType>>) => East.value(
                Object.fromEntries(Object.keys(m.item.fields).map((f) => [f, fields[f] ?? read[f]!])) as unknown as SubtypeExprOrValue<EastType>,
                m.item,
            ) as ExprType<EastType>;
            $.match(s, {
                some: ($2, sv) => {
                    if (endAs === undefined || m.end === undefined) {
                        $2.assign(result, some(rebuild({ [m.start.name]: sv as ExprType<EastType> })));
                        return;
                    }
                    const endName = m.end.name;
                    const asEnd = $2.const(endAs);
                    const e = $2.let(asEnd(end), OptionType(m.end.type));
                    $2.match(e, {
                        some: ($3, ev) => {
                            $3.assign(result, some(rebuild({ [m.start.name]: sv as ExprType<EastType>, [endName]: ev as ExprType<EastType> })));
                        },
                    });
                },
            });
            return result;
        });
    })();

    /**
     * This series' own edit on one of its entries (#1436) — the row at `path`
     * is its own: a dropped card's item into the collection its elements'
     * read names, under the id the Plan minted; a moved element's item, found
     * by its id (the element's key), re-timed where it is, taken out of the
     * collection, or put into it under the same id. A collection already
     * holding the id refuses the item. A number typed into one of its table
     * positions sets that position's value at the bucket's start.
     */
    const ownFor = (kt: EastType): OwnEditFn | undefined => owns.get(kt, () => {
        const moves = editRead !== undefined && placed !== undefined && move !== undefined;
        if (!moves && typedWrites.length === 0) return undefined;
        const made = moves && create !== undefined ? createFor(kt, create) : undefined;
        const field = editRead?.field ?? "";
        const item = move?.item;
        type Items = ExprType<DictType<StringType, EastType>>;
        return East.function([rowType, kt, PathType, PlanGestureType, PlanCarriedType], OptionType(rowType),
            ($, value, key, path, gesture, carried) => {
                const make = made === undefined ? undefined : $.const(made);
                const place = moves ? $.const(placed!) : undefined;
                const result = $.let(none, OptionType(rowType));
                $.match(gesture, {
                    drop: ($2, drop) => {
                        if (make === undefined) return;
                        const coll = $2.let(entryAccess(value)[field]! as unknown as Items);
                        // The minted id, unless the collection already holds it.
                        $2.if(coll.has(drop.id).not(), ($3) => {
                            $3(coll.insert(drop.id, make(drop, value, key)));
                            $3.assign(result, some(value));
                        });
                    },
                    move: ($2, mv) => {
                        if (place === undefined || item === undefined) return;
                        const here = $2.let(East.value(variant("entry", { series: cfg.key, path }), PlanRowIdType), PlanRowIdType);
                        const coll = $2.let(entryAccess(value)[field]! as unknown as Items);
                        $2.if(East.equal(here, mv.from).and(() => East.equal(here, mv.to)), ($3) => {
                            // Along its row, or resized: its times set where it is.
                            $3.if(coll.has(mv.key), ($4) => {
                                const moved = $4.let(place(coll.get(mv.key), mv.start, mv.end), OptionType(item));
                                $4.match(moved, {
                                    some: ($5, next) => {
                                        $5(coll.update(mv.key, next));
                                        $5.assign(result, some(value));
                                    },
                                });
                            });
                        }).else(($3) => {
                            // Its source: taken out of the collection, and carried.
                            $3.if(East.equal(here, mv.from), ($4) => {
                                $4.if(coll.has(mv.key), ($5) => {
                                    $5(carried.update(East.value(some(East.Blob.encodeBeast(coll.get(mv.key), "v2")), OptionType(BlobType))));
                                    $5(coll.delete(mv.key));
                                    $5.assign(result, some(value));
                                });
                            });
                            // Its target: the carried item put in under its id, at its new
                            // times — unless the collection already holds the id, when it
                            // is put nowhere and the move lands nowhere.
                            $3.if(East.equal(here, mv.to), ($4) => {
                                const held = $4.let(carried.get(), OptionType(BlobType));
                                $4.match(held, {
                                    some: ($5, bytes) => {
                                        $5.if(coll.has(mv.key).not(), ($6) => {
                                            const taken = $6.let(bytes.decodeBeast(item, "v2"), item);
                                            const moved = $6.let(place(taken, mv.start, mv.end), OptionType(item));
                                            $6.match(moved, {
                                                some: ($7, next) => {
                                                    $7(coll.insert(mv.key, next));
                                                    $7(carried.update(East.value(none, OptionType(BlobType))));
                                                    $7.assign(result, some(value));
                                                },
                                            });
                                        });
                                    },
                                });
                            });
                        });
                    },
                    // A number typed into a cell (#1436): its position's value at the bucket's start set, or added
                    // where the collection holds none; cleared, deleted. An Integer collection takes a whole number,
                    // and an instant on an arm its keys cannot hold writes nothing.
                    value: ($2, typed) => {
                        if (typedWrites.length === 0) return;
                        const here = $2.let(East.value(variant("entry", { series: cfg.key, path }), PlanRowIdType), PlanRowIdType);
                        $2.if(East.equal(here, typed.row), ($3) => {
                            for (const write of typedWrites) {
                                $3.if(typed.position.equal(BigInt(write.position)), ($4) => {
                                    const keyAs = $4.const(write.keyAs);
                                    const at = $4.let(keyAs(typed.at), OptionType(write.key));
                                    $4.match(at, {
                                        some: ($5, k) => {
                                            type Values = ExprType<DictType<EastType, EastType>>;
                                            const coll = $5.let(entryAccess(value)[write.field]! as unknown as Values);
                                            $5.match(typed.value, {
                                                some: ($6, n) => {
                                                    const put = ($7: typeof $6, stored: SubtypeExprOrValue<EastType>) => {
                                                        $7(coll.insertOrUpdate(k as ExprType<EastType>, stored));
                                                        $7.assign(result, some(value));
                                                    };
                                                    if (isTypeEqual(write.value, IntegerType)) {
                                                        $6.if(n.remainder(1).equal(0), ($7) => { put($7, n.toInteger()); });
                                                    } else if (isTypeEqual(write.value, OptionType(FloatType))) {
                                                        put($6, some(n));
                                                    } else {
                                                        put($6, n);
                                                    }
                                                },
                                                none: ($6) => {
                                                    $6.if(coll.has(k as ExprType<EastType>), ($7) => {
                                                        $7(coll.delete(k as ExprType<EastType>));
                                                        $7.assign(result, some(value));
                                                    });
                                                },
                                            });
                                        },
                                    });
                                });
                            }
                        });
                    },
                });
                return result;
            }) as unknown as OwnEditFn;
    });

    /** The tree's writer: the rows below an entry are this series' own. */
    const walkWriterFor = (kt: EastType): WriteFn | undefined => {
        const at = `${where} › children`;
        const of = childOf(kt);
        const cc = (Expr.type(of) as unknown as { output: EastType }).output;
        const { key: kc } = shapeOf(cc, at);
        const own = ownFor(kc);
        if (own === undefined) return undefined;
        const ref: ChildRef | undefined = treeField !== undefined ? { kind: "field", field: treeField } : childRefOf(rowType, kt, tree!);
        if (ref === undefined) {
            throw new Error(
                `${at}: this series takes gestures, and one on a child row is written back into its entry through ` +
                "`children` — which must read a field of the entry, not compute a collection");
        }
        const ops = collectionOps(cc);
        const collOf = (entry: ExprType<EastType>) => (ref.kind === "field" ? entryAccess(entry)[ref.field]! : nodeOf(entry));
        return East.function([rowType, kt, PathType, IntegerType, StringType, PlanGestureType, PlanCarriedType], OptionType(rowType),
            ($, value, _key, path, depth, series, gesture, carried) => {
                const result = $.let(none, OptionType(rowType));
                // The walk's rows are this series' own, at every depth.
                $.if(series.equal(cfg.key), ($2) => {
                    const write = $2.const(own);
                    const keyOf = $2.const(segmentKeyOf(kc));
                    const cur = $2.let(value, rowType);
                    const d = $2.let(depth, IntegerType);
                    const last = $2.let(path.size().subtract(1n), IntegerType);
                    // Down to the target's parent, then the target itself — a
                    // path through an entry the tree lacks writes nothing (#1219).
                    const found = $2.let(true, BooleanType);
                    $2.while(d.less(last).and(() => found), ($3) => {
                        const coll = $3.let(collOf(cur), cc);
                        const step = $3.let(keyOf(path.get(d)), kc);
                        $3.if(ops.has(coll, step), ($4) => {
                            $4.assign(cur, ops.get(coll, step));
                            $4.assign(d, d.add(1n));
                        }).else(($4) => { $4.assign(found, false); });
                    });
                    $2.if(found, ($3) => {
                        const coll = $3.let(collOf(cur), cc);
                        const k = $3.let(keyOf(path.get(last)), kc);
                        $3.if(ops.has(coll, k), ($4) => {
                            const written = $4.let(write(ops.get(coll, k), k, path, gesture, carried), OptionType(rowType));
                            $4.match(written, {
                                some: ($5, entry) => {
                                    $5(ops.put(coll, k, entry));
                                    $5.assign(result, some(value));
                                },
                            });
                        });
                    });
                });
                return result;
            }) as unknown as WriteFn;
    };

    /** The step-downs' writer: a row below an entry is one of a step-down's series', in that step's collection. */
    const stepsWriterFor = (kt: EastType): WriteFn | undefined => {
        const parts = steps.flatMap((step, i) => {
            const at = `${where} › children[${i}]`;
            const accessor = stepOf(step);
            const of = building(at, kt, () => reifyAccessor([rowType, kt], onEntry(accessor))) as unknown as
                ExprType<FunctionType<[EastType, EastType], EastType>>;
            const cc = (Expr.type(of) as unknown as { output: EastType }).output;
            const writes = step.series
                .map((s) => nestedSpec(s, at).writer(cc, at))
                .filter((w): w is WriteFn => w !== undefined);
            if (writes.length === 0) return [];
            const ref: ChildRef | undefined = step.field !== undefined ? { kind: "field", field: step.field } : childRefOf(rowType, kt, accessor);
            if (ref === undefined) {
                throw new Error(
                    `${at}: a series under this step-down takes gestures, and one on its rows is written back into ` +
                    "the entry through the step-down — which must read a field of the entry, or be the entry itself, not " +
                    "compute a collection");
            }
            const { entry: childType, key: kc } = shapeOf(cc, at);
            return [{ ref, cc, kc, childType, writes }];
        });
        if (parts.length === 0) return undefined;
        return East.function([rowType, kt, PathType, IntegerType, StringType, PlanGestureType, PlanCarriedType], OptionType(rowType),
            ($, value, _key, path, depth, series, gesture, carried) => {
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
                                    const written = $4.let(write(child, k, path, depth.add(1n), series, gesture, carried), OptionType(part.childType));
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
            : tree !== undefined ? walkWriterFor(kt) : stepsWriterFor(kt);
        if (own === undefined && below === undefined) return undefined;
        return East.function([rowType, kt, PathType, IntegerType, StringType, PlanGestureType, PlanCarriedType], OptionType(rowType),
            ($, value, key, path, depth, series, gesture, carried) => {
                const result = $.let(none, OptionType(rowType));
                $.if(depth.equal(path.size()), ($2) => {
                    if (own === undefined) return;
                    const write = $2.const(own);
                    $2.if(series.equal(cfg.key), ($3) => { $3.assign(result, write(value, key, path, gesture, carried)); });
                }).else(($2) => {
                    if (below === undefined) return;
                    const write = $2.const(below);
                    $2.assign(result, write(value, key, path, depth, series, gesture, carried));
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
        charts,
        reads: recipe.reads ?? [],
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
            return blockLists.get(collection, () => oneBlock(collection, spec.emitter(collection, at), false, charts));
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
    // envelope without a row of its own — built by the same machinery. A
    // step-down's children are its own series' rows; a bare accessor's are more
    // of the views' entries, which the views walk themselves below (#1219), so
    // each child entry draws as its members' rows, never as the host's.
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

    // ── A tree: more of the views' own entries (#1219, #1436) — a field of the
    // entry, or the event kinds' accessor computing them (#1194) ──
    const children = cfg.children as unknown;
    const treeField = typeof children === "string" ? children : undefined;
    const bare: ((v: ExprType<EastType>, k: ExprType<EastType>) => Expr) | undefined = treeField !== undefined
        ? (v) => collectionOn(v, treeField) as unknown as Expr
        : typeof children === "function" ? children as (v: ExprType<EastType>, k: ExprType<EastType>) => Expr : undefined;
    const recursive = (rowType as { type: string }).type === "Recursive";
    const nodeOf = (value: ExprType<EastType>): ExprType<EastType> => recursive
        ? (value as unknown as RecursiveExpr<EastType>).unwrap() as ExprType<EastType>
        : value;
    const entryAccess = (value: ExprType<EastType>) => nodeOf(value) as unknown as Record<string, ExprType<EastType>>;
    const childOfs = new ByType<ExprType<FunctionType<[EastType, EastType], EastType>>>();
    /** The bare accessor, built for entries keyed by `kt` — the child collection's type is its output. */
    const childOf = (kt: EastType) => childOfs.get(kt, () => building(where, kt, () =>
        reifyAccessor([rowType, kt], (v: ExprType<EastType>, k: ExprType<EastType>) => bare!(nodeOf(v), k))) as unknown as
        ExprType<FunctionType<[EastType, EastType], EastType>>);
    const walks = new ByType<ExprType<FunctionType<[EastType, ArrayType<StringType>, PlanRowIdType], PlanRowsCollectionType>>>();

    /**
     * The subtree below one entry, over the child collection type `cc`: every
     * level's matched entries in pre-order, each drawn as its members' rows —
     * adjacent, in declared order, those whose own `match` takes it — with its
     * children after all of them, nested under the first that shows.
     */
    const walkFor = (cc: EastType): ExprType<FunctionType<[EastType, ArrayType<StringType>, PlanRowIdType], PlanRowsCollectionType>> =>
        walks.get(cc, () => {
            const at = `${where} › children`;
            const { entry, key: kc } = shapeOf(cc, at);
            assertEntry(entry, rowType, `${at} (a tree's children are more of this series' rows — step down to another type with Plan.children)`);
            const next = childOf(kc);
            const nextType = (Expr.type(next) as unknown as { output: EastType }).output;
            if (!isTypeEqual(nextType, cc)) {
                throw new Error(`${at}: a recursive series' children must be the same collection type at every level`);
            }
            const parts = memberSpecs.map((m) => m.entryParts!(entry, kc, `${where} › ${nameOf(m)}`));
            const match = host.entryParts!(entry, kc, where).match;
            const collapsed = host.collapsedFor!(kc);
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
                // Every function the loop calls, bound ONCE (see the data walk).
                const frames = $.const(framesOf);
                const childrenOf = $.const(next);
                const rowsOf = parts.map((p) => $.const(p.row));
                const showsOf = parts.map((p) => (p.match === undefined ? undefined : $.const(p.match)));
                const collapse = collapsed === undefined ? undefined : $.const(collapsed);
                const out = $.let([], PlanRowsCollectionType);
                const stack = $.let(frames(coll, path0, parent0), Frames);
                $.while(stack.size().greater(0n), ($2) => {
                    const f = $2.let(stack.popLast(), Frame);
                    const ids = memberSpecs.map((m) =>
                        $2.let(East.value(variant("entry", { series: m.key, path: f.path }), PlanRowIdType), PlanRowIdType));
                    const present = showsOf.map((shows) => (shows === undefined
                        ? undefined
                        : $2.let(shows(f.value, f.key), BooleanType)));
                    // The first member whose row shows — the entry's children nest under it.
                    const first = $2.let(-1n, IntegerType);
                    for (let i = parts.length - 1; i >= 0; i--) {
                        const shows = present[i];
                        if (shows === undefined) $2.assign(first, BigInt(i));
                        else $2.if(shows, ($3) => { $3.assign(first, BigInt(i)); });
                    }
                    const firstId = $2.let(ids[0]!, PlanRowIdType);
                    for (let i = 1; i < ids.length; i++) {
                        $2.if(first.equal(BigInt(i)), ($3) => { $3.assign(firstId, ids[i]!); });
                    }
                    const below = $2.let(first.greaterEqual(0n).ifElse(
                        () => frames(childrenOf(f.value, f.key), f.path, firstId),
                        () => East.value([], Frames)), Frames);
                    const parent = $2.let(East.value(some(f.parent), IdOptType), IdOptType);
                    const fold = $2.let(collapse === undefined
                        ? East.value(false, BooleanType)
                        : collapse(f.value, f.key), BooleanType);
                    const noFold = $2.let(East.value(false, BooleanType), BooleanType);
                    parts.forEach((_p, i) => {
                        const isFirst = $2.let(first.equal(BigInt(i)), BooleanType);
                        const hasChildren = $2.let(isFirst.and(() => below.size().greater(0n)), BooleanType);
                        const viewRow = rowsOf[i]!;
                        const push = ($3: typeof $2) => {
                            $3(out.pushLast(viewRow(f.value, f.key, ids[i]!, parent, hasChildren,
                                isFirst.ifElse(() => fold, () => noFold))));
                        };
                        const shows = present[i];
                        if (shows === undefined) push($2);
                        else $2.if(shows, push);
                    });
                    $2(stack.append(below));
                });
                return out;
            });
        });

    /** The entry's children rows for entries keyed by `kt`: a step-down's through the host, a bare accessor's walked here. */
    const childrenFor = (kt: EastType): ChildrenFn | undefined => {
        if (bare === undefined) return host.childrenFor!(kt);
        const of = childOf(kt);
        const walk = walkFor((Expr.type(of) as unknown as { output: EastType }).output);
        return East.function([rowType, kt, PlanRowIdType, PathType], PlanRowsCollectionType,
            (_$, value, key, id, path) => walk(of(value, key), path, id)) as unknown as ChildrenFn;
    };

    const walkWriters = new ByType<WriteFn | undefined>();
    /**
     * The writer below an entry, through a bare accessor: down the path to the
     * entry the row is one of, through the field `children` reads, and the
     * gesture written by the member whose row it was made on.
     */
    const walkWriterFor = (kt: EastType): WriteFn | undefined => walkWriters.get(kt, () => {
        const at = `${where} › children`;
        const of = childOf(kt);
        const cc = (Expr.type(of) as unknown as { output: EastType }).output;
        const { entry, key: kc } = shapeOf(cc, at);
        assertEntry(entry, rowType, at);
        const owns = memberSpecs.flatMap((m) => {
            const own = m.ownFor?.(kc);
            return own === undefined ? [] : [{ key: m.key, own }];
        });
        if (owns.length === 0) return undefined;
        const ref: ChildRef | undefined = treeField !== undefined ? { kind: "field", field: treeField } : childRefOf(rowType, kt, bare!);
        if (ref === undefined) {
            throw new Error(
                `${at}: a member takes gestures, and one on a child row is written back into its entry through ` +
                "`children` — which must read a field of the entry, not compute a collection");
        }
        const ops = collectionOps(cc);
        const collOf = (value: ExprType<EastType>) => (ref.kind === "field" ? entryAccess(value)[ref.field]! : nodeOf(value));
        return East.function([rowType, kt, PathType, IntegerType, StringType, PlanGestureType, PlanCarriedType], OptionType(rowType),
            ($, value, _key, path, depth, series, gesture, carried) => {
                const result = $.let(none, OptionType(rowType));
                const writes = owns.map((o) => ({ key: o.key, own: $.const(o.own) }));
                const keyOf = $.const(segmentKeyOf(kc));
                const cur = $.let(value, rowType);
                const d = $.let(depth, IntegerType);
                const last = $.let(path.size().subtract(1n), IntegerType);
                // Down to the target's parent, then the target itself — a path
                // through an entry the tree lacks writes nothing.
                const found = $.let(true, BooleanType);
                $.while(d.less(last).and(() => found), ($2) => {
                    const coll = $2.let(collOf(cur), cc);
                    const step = $2.let(keyOf(path.get(d)), kc);
                    $2.if(ops.has(coll, step), ($3) => {
                        $3.assign(cur, ops.get(coll, step));
                        $3.assign(d, d.add(1n));
                    }).else(($3) => { $3.assign(found, false); });
                });
                $.if(found, ($2) => {
                    const coll = $2.let(collOf(cur), cc);
                    const k = $2.let(keyOf(path.get(last)), kc);
                    $2.if(ops.has(coll, k), ($3) => {
                        const target = $3.let(ops.get(coll, k), rowType);
                        for (const w of writes) {
                            $3.if(result.hasTag("none").and(() => series.equal(w.key)), ($4) => {
                                const written = $4.let(w.own(target, k, path, gesture, carried), OptionType(rowType));
                                $4.match(written, {
                                    some: ($5, next) => {
                                        $5(ops.put(coll, k, next));
                                        $5.assign(result, some(value));
                                    },
                                });
                            });
                        }
                    });
                });
                return result;
            }) as unknown as WriteFn;
    });
    // How many chart rows each entry makes (#1398): a row a member — a chart member's own `match` deciding by entry
    // whether its row shows — and below them a tree's walk of more of the views' entries, each its members'
    // rows, or a step-down's series' over the child collection.
    const memberCharts = chartsOf(memberSpecs);
    const charts = entryCharts(memberCharts,
        cfg.children === undefined ? 0 : bare !== undefined ? memberCharts : chartsOf(host.nested), cfg.match !== undefined);
    const spec: PlanSeriesSpec = {
        key: cfg.key,
        title: cfg.title,
        arm: "views",
        nested: [...memberSpecs, ...host.nested],
        nests: cfg.children !== undefined,
        charts,
        reads: [],
        emitter(collection, at) {
            return emitters.get(collection, () => {
                const { entry, key: kt } = shapeOf(collection, at);
                assertEntry(entry, rowType, where);
                const parts = memberSpecs.map((m) => m.entryParts!(entry, kt, `${where} › ${nameOf(m)}`));
                const hostParts = host.entryParts!(entry, kt, where);
                const hostKids = childrenFor(kt);
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
            return blockLists.get(collection, () => oneBlock(collection, spec.emitter(collection, at), false, charts));
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
                // Below an entry: a step-down's rows are written by its series
                // through the host; a bare accessor's are the members' own (#1219).
                const below = bare === undefined ? host.writer(collection, at) : walkWriterFor(kt);
                if (owns.length === 0 && below === undefined) return undefined;
                return East.function([rowType, kt, PathType, IntegerType, StringType, PlanGestureType, PlanCarriedType], OptionType(rowType),
                    ($, value, key, path, depth, series, gesture, carried) => {
                        const result = $.let(none, OptionType(rowType));
                        $.if(depth.equal(path.size()), ($2) => {
                            for (const o of owns) {
                                const write = $2.const(o.own);
                                $2.if(series.equal(o.key), ($3) => { $3.assign(result, write(value, key, path, gesture, carried)); });
                            }
                        }).else(($2) => {
                            if (below === undefined) return;
                            const write = $2.const(below);
                            $2.assign(result, write(value, key, path, depth, series, gesture, carried));
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
        // Each entry makes its members' rows; the header is no entry's (#1398).
        charts: chartsOf(memberSpecs),
        reads: [],
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
                    const head = $.let(East.value({ fixed: true, parent, charts: none, rows: [header(id, parent)] }, PlanBlockType), PlanBlockType);
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
                return East.function([entry, kt, PathType, IntegerType, StringType, PlanGestureType, PlanCarriedType], OptionType(entry),
                    ($, value, key, path, depth, series, gesture, carried) => {
                        const result = $.let(none, OptionType(entry));
                        for (const w of writes) {
                            const write = $.const(w);
                            $.if(result.hasTag("none"), ($2) => {
                                $2.assign(result, write(value, key, path, depth, series, gesture, carried));
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
        // Its rows' kinds are an East value the build does not read (#1398): laid out below an entry, their chart rows are
        // not known.
        charts: undefined,
        reads: [],
        emitter,
        // A FIXED block: no entry produces hand-built rows, so every window
        // serves them alike and the canvas draws them once (#823).
        blocks(collection) {
            return blockLists.get(collection, () => oneBlock(collection, emitter(collection), true, undefined));
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
 * tree takes the gesture on it. A move to another row carries its item
 * between its two writes in `carried` (#825).
 *
 * @param spec - The series' build spec
 * @param collection - The source's collection type
 * @param where - Who is asking, for messages
 * @returns `(entry, key, row, gesture, carried) → the entry written`
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
        return East.function([rowType, kt, PlanRowIdType, PlanGestureType, PlanCarriedType], OptionType(rowType), ($, entry, key, row, gesture, carried) => {
            const result = $.let(none, OptionType(rowType));
            if (writer === undefined) return result;
            const write = $.const(writer);
            $.match(row, {
                entry: ($2, id) => {
                    // A row's path starts with its entry's key.
                    const mine = $2.let(id.path.size().greater(0n).and(() => id.path.get(0n).equal(seg(key))), BooleanType);
                    $2.if(mine, ($3) => {
                        const detached = $3.let(East.Blob.encodeBeast(entry, "v2").decodeBeast(rowType, "v2"), rowType);
                        $3.assign(result, write(detached, key, id.path, 1n, id.series, gesture, carried));
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
 * whole tree, and its values collections keyed by the axis's instants (#1436).
 * An East expression list is checked at render (a repeated id is a row
 * diagnostic), since its series are not known until it runs.
 *
 * @param series - The `series` input
 * @param where - Who is asking, for the message
 * @param axisKind - The axis's kind, when its declaration says it
 */
export function checkSeries(series: PlanSeriesInput, where: string, axisKind?: PlanAxisKindLiteral): void {
    if (!Array.isArray(series)) return;
    const specs = series.map((s) => specOf(s)).filter((s): s is PlanSeriesSpec => s !== undefined);
    assertUniqueKeys(specs, where);
    // A values collection is keyed by its instant (#1436): one keyed by String
    // rides only an ordinal axis.
    if (axisKind === undefined || axisKind === "ordinal") return;
    const walk = (spec: PlanSeriesSpec): void => {
        for (const use of spec.reads) {
            if (use.read.kind !== "values" || !isTypeEqual(use.key, StringType)) continue;
            throw new Error(
                `Plan.values: "${use.field}" is keyed by String, and the axis is ${axisKind} — values are keyed by their ` +
                `instant, ${axisKind === "time" ? "a DateTime" : "a Float or an Integer"} here: read things people drag ` +
                `with Plan.items("${use.field}", times, draw)`);
        }
        spec.nested.forEach(walk);
    };
    specs.forEach(walk);
}

/**
 * What a builder reads of a series it lays out READ ONLY (#1190) — a resource
 * kind's `measures`, a Plan's `rows`: what the series is, and whether it nests
 * or takes a gesture, both of which a read-only series may not.
 *
 * @internal
 * @property arm - The series' kind
 * @property key - Its key
 * @property title - Its title
 * @property nests - Whether it declares `children`
 * @property writes - Whether anything in its tree takes a gesture over the collection: an `edit`
 * @property charts - How many chart rows each of its entries makes, when every entry makes as many (#1398); `undefined` where that varies by entry
 */
export interface PlanSeriesFacts {
    readonly arm: PlanSeriesArm;
    readonly key: string;
    readonly title: string;
    readonly nests: boolean;
    readonly writes: boolean;
    readonly charts: number | undefined;
}

/**
 * Reads a series value's facts off the spec its builder recorded (#1190).
 *
 * @param series - The series value
 * @param collection - The collection type it is laid out over (`Dict<K, R>`)
 * @param where - Who is asking, for messages
 * @returns Its facts; `undefined` for a series value no `Plan.series.*` builder made in place (a bound, picked or stored one)
 * @throws {Error} When the series is built over entries of another type than the collection's
 * @internal
 */
export function planSeriesFacts(series: unknown, collection: EastType, where: string): PlanSeriesFacts | undefined {
    const spec = specOf(series);
    if (spec === undefined) return undefined;
    return {
        arm: spec.arm, key: spec.key, title: spec.title, nests: spec.nests, writes: spec.writer(collection, where) !== undefined,
        charts: spec.charts,
    };
}

/**
 * The keys of a series list's whole tree, each series' and every series
 * nested in it, in order (#1192): what a Plan holds the keys it gives its own
 * rows apart from, since a row's id is its series' key and its path.
 *
 * @param series - The `series` input, or a list of series values
 * @returns The keys; `undefined` for an East expression list, or one holding a series no `Plan.series.*` builder
 *   made in place, whose keys are not known until it runs
 * @internal
 */
export function planSeriesKeys(series: unknown): readonly string[] | undefined {
    if (!Array.isArray(series)) return undefined;
    const keys: string[] = [];
    const walk = (spec: PlanSeriesSpec): void => {
        keys.push(spec.key);
        spec.nested.forEach(walk);
    };
    for (const one of series) {
        const spec = specOf(one);
        if (spec === undefined) return undefined;
        walk(spec);
    }
    return keys;
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
 * gesture, carried) → the entry written`, `none` when none takes it. A move
 * to another row carries its item between its two writes in `carried`
 * (#825).
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
    const inputs = [rowType, kt, PlanRowIdType, PlanGestureType, PlanCarriedType] as const;
    if (Array.isArray(series)) {
        const built = series.map((s) => {
            const spec = specOf(s);
            return spec !== undefined ? topWrite(spec, collection, `Plan.series.${spec.arm} "${spec.key}"`) : undefined;
        });
        return East.function([...inputs], OptionType(rowType), ($, entry, key, row, gesture, carried) => {
            const result = $.let(none, OptionType(rowType));
            series.forEach((s, i) => {
                const own = built[i];
                const write = $.const(own !== undefined ? own : seriesValueWrite(s));
                $.if(result.hasTag("none"), ($2) => { $2.assign(result, write(entry, key, row, gesture, carried)); });
            });
            return result;
        }) as unknown as TopWriteFn;
    }
    return East.function([...inputs], OptionType(rowType), ($, entry, key, row, gesture, carried) => {
        const result = $.let(none, OptionType(rowType));
        $.for(series, ($2, s) => {
            $2.if(result.hasTag("none"), ($3) => {
                const write = $3.let(seriesValueWrite(s as PlanSeriesValue));
                $3.assign(result, write(entry, key, row, gesture, carried));
            });
        });
        return result;
    }) as unknown as TopWriteFn;
}

// ============================================================================
// Builders — Plan.series.*
// ============================================================================

/**
 * What a span series reads (#1436): its runs — rolled up into a parent's bands
 * when it rolls its children up — its decisions and ports, and its children's.
 *
 * @typeParam UR - What its runs read
 * @typeParam UD - What its decisions read
 * @typeParam UP - What its ports read
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 * @typeParam RL - Its `rollup`, as written
 */
export type PlanSpanReads<UR, UD, UP, CT, CU, CF, CS extends readonly unknown[], RL> = PlanReadsNormal<
    (PlanHasChildren<CT, CU, CS> extends true ? PlanRolledUp<UR> : [RL] extends [never] ? UR : PlanRolledUp<UR>)
    & UD & UP & PlanChildrenReads<CT, CU, CF, CS>>;

/**
 * What a heat series reads (#1436): its cells' collection — subtotalled by its
 * fold and the series' aggregate where a tree's parents derive theirs — and
 * its children's, a step-down's subtotalled by the aggregate with its own
 * folds.
 *
 * @typeParam UC - What its cells read
 * @typeParam FO - Their fold
 * @typeParam A - Its aggregate
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 */
export type PlanHeatReads<UC, FO, A, CT, CU, CF, CS extends readonly unknown[]> = PlanReadsNormal<
    ([CT] extends [never] ? UC : PlanSubtotalled<UC, FO, A>)
    & PlanChildrenReads<CT, CU, CF, CS, [CT] extends [never] ? A : never>>;

/**
 * What a table series reads (#1436): its cells' or its positions'
 * collections — each a tree's parents subtotal by its fold and the series'
 * aggregate — and its children's, a step-down's subtotalled by the aggregate
 * with its own folds.
 *
 * @typeParam UC - What its `cells` read
 * @typeParam S - Its positions, as written
 * @typeParam FO - Its `cells`' fold
 * @typeParam A - Its aggregate
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 */
export type PlanTableReads<UC, S, FO, A, CT, CU, CF, CS extends readonly unknown[]> = PlanReadsNormal<
    ([CT] extends [never] ? UC : PlanSubtotalled<UC, FO, A>)
    & PlanPositionsReads<S, [CT] extends [never] ? false : true, A>
    & PlanChildrenReads<CT, CU, CF, CS, [CT] extends [never] ? A : never>>;

/**
 * A span series — one state-run row per entry; a row with children shows its
 * own runs plus bands over its subtree's runs (`rollup`) — each band sums its
 * runs' quantities unit by unit (#824).
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the runs imply (inferred from `runs`; `never` when erased)
 * @typeParam KT - The entries' key type (`keyType`; `String` by default)
 * @typeParam FR - The collection its runs read
 * @typeParam UR - What its runs read
 * @typeParam UD - What its decisions read
 * @typeParam UP - What its ports read
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 * @typeParam RL - Its `rollup`, as written
 * @param rowType - The entry type (every builder takes it first — the `Slice.config` shape)
 * @param config - The reads, accessors and nesting ({@link PlanSpanSeriesConfig})
 * @returns A series value, branded with its kind and what it reads
 */
export function createSeriesSpan<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    FR extends string = string, UR = unknown, UD = unknown, UP = unknown,
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never, RL extends PlanRollupLiteral = never,
>(rowType: R, config: PlanSpanSeriesConfig<R, K, KT, FR, UR, UD, UP, CT, CU, CF, CS, RL>): PlanSeriesValue<K, PlanSpanReads<UR, UD, UP, CT, CU, CF, CS, RL>> {
    const cfg = config as unknown as PlanSpanSeriesConfig<EastType, PlanAxisKindLiteral, EastType>;
    const where = `Plan.series.span "${cfg.key}"`;
    const edit = editRecipeOf(cfg.edit, "runs", "{ from, to }", cfg.runs, where);
    // A row rolls up its children: its own (`children`), or — declared on a
    // views member — the ones the views nest under it (#1219).
    const rollup = cfg.children !== undefined || cfg.rollup !== undefined ? resolveTag(cfg.rollup ?? "union", PlanRollupType) : undefined;
    const runs = elementField(rowType, cfg.runs, "run", where, "runs");
    if (runs === undefined) throw new Error(`${where}: give its runs — Plan.items(field, { from, to }, draw), or a function of the row`);
    const decisions = elementField(rowType, cfg.decisions, "decision", where, "decisions");
    const ports = elementField(rowType, cfg.ports, "port", where, "ports");
    const spec = dataSpec(rowType, cfg as AnyRowConfig, {
        arm: "span",
        kind: (node, key, hasChildren, value) => spanKind({
            runs: runs.at(node, key, value) as PlanElementsInput<PlanRunType, PlanAxisKindLiteral>,
            ...(decisions !== undefined ? { decisions: decisions.at(node, key, value) as PlanElementsInput<PlanDecisionMarkType, PlanAxisKindLiteral> } : {}),
            ...(ports !== undefined ? { ports: ports.at(node, key, value) as PlanElementsInput<typeof PlanPortType, PlanAxisKindLiteral> } : {}),
        }, rollup === undefined
            ? East.value(none, OptionType(PlanRollupType))
            // A row rolls up only when it HAS child rows — a leaf's bands
            // would repeat its own runs.
            : hasChildren.ifElse(
                () => East.value(some(rollup), OptionType(PlanRollupType)),
                () => East.value(none, OptionType(PlanRollupType)))),
        edit,
        reads: [...runs.reads, ...(decisions?.reads ?? []), ...(ports?.reads ?? [])],
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K, PlanSpanReads<UR, UD, UP, CT, CU, CF, CS, RL>>;
}

/**
 * A heat series — one per-bucket cell row per entry; a row with children and
 * no cells of its own shows its children's per-bucket `aggregate`.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the cells imply (inferred from `cells`; `never` when erased)
 * @typeParam KT - The entries' key type
 * @typeParam UC - What its cells read
 * @typeParam FO - How a bucket folds them
 * @typeParam A - Its `aggregate`, as written
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 * @param rowType - The entry type
 * @param config - The reads, accessors and nesting ({@link PlanHeatSeriesConfig})
 * @returns A series value, branded with its kind, what it reads and the fold of its cells
 */
export function createSeriesHeat<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    UC = unknown, FO extends PlanFoldLiteral | undefined = undefined, A extends PlanAggregateLiteral = "mean",
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
>(rowType: R, config: PlanHeatSeriesConfig<R, K, KT, UC, FO, A, CT, CU, CF, CS>): PlanSeriesValue<K, PlanHeatReads<UC, FO, A, CT, CU, CF, CS>> & PlanFoldsBrand<PlanFoldsOf<UC, FO>> {
    const cfg = config as unknown as PlanHeatSeriesConfig<EastType, PlanAxisKindLiteral, EastType>;
    const where = `Plan.series.heat "${cfg.key}"`;
    const aggregate = cfg.children !== undefined
        ? East.value(some(resolveTag(cfg.aggregate ?? "mean", PlanAggregateType)), OptionType(PlanAggregateType))
        : East.value(none, OptionType(PlanAggregateType));
    const cells = consumerField(rowType, cfg.cells, "heat", where, "cells");
    const spec = dataSpec(rowType, cfg as AnyRowConfig, {
        arm: "heat",
        kind: (node, key, _hasChildren, value) => heatKind({
            ...(cells !== undefined ? { cells: cells.at(node, key, value) as PlanHeatCellsInput<PlanAxisKindLiteral> } : {}),
            ...(cfg.scale !== undefined ? { scale: cfg.scale } : {}),
        }, aggregate),
        reads: cells?.reads ?? [],
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K, PlanHeatReads<UC, FO, A, CT, CU, CF, CS>> & PlanFoldsBrand<PlanFoldsOf<UC, FO>>;
}

/**
 * A table series — one bucketed-numeral row per entry; a row with children and
 * no values of its own shows per-position subtotals (`aggregate`, `format`).
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the cells imply (inferred from `cells` / `series`; `never` when erased)
 * @typeParam KT - The entries' key type
 * @typeParam UC - What its `cells` read
 * @typeParam S - Its `series` positions, as written
 * @typeParam FO - Its `cells`' fold, as written
 * @typeParam A - Its `aggregate`, as written
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 * @param rowType - The entry type
 * @param config - The reads, accessors and nesting ({@link PlanTableSeriesOfConfig})
 * @returns A series value, branded with its kind, what it reads and the folds of its positions
 */
export function createSeriesTable<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    UC = unknown, S extends readonly unknown[] = never, FO extends PlanFoldLiteral = "sum", A extends TableAggregateLiteral = "sum",
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
>(
    rowType: R, config: PlanTableSeriesOfConfig<R, K, KT, UC, S, FO, A, CT, CU, CF, CS>,
): PlanSeriesValue<K, PlanTableReads<UC, S, FO, A, CT, CU, CF, CS>> & PlanFoldsBrand<PlanReadsNormal<PlanFoldsOf<UC, FO> & PlanPositionsFolds<S>>> {
    const cfg = config as unknown as PlanTableSeriesOfConfig<EastType, PlanAxisKindLiteral, EastType>;
    const where = `Plan.series.table "${cfg.key}"`;
    if (cfg.cells !== undefined && cfg.series !== undefined) {
        throw new Error(`${where}: pass \`cells\` (one plain value series) OR \`series\` — not both`);
    }
    const aggregate = cfg.children !== undefined
        ? East.value(some(resolveTag(cfg.aggregate ?? "sum", TableAggregateType)), OptionType(TableAggregateType))
        : East.value(none, OptionType(TableAggregateType));
    const cells = consumerField(rowType, cfg.cells, "tableCells", where, "cells");
    const positions = listField(rowType, cfg.series, "tableSeries", where, "series");
    // The positions a typed number writes (#1436), each read checked as it built above.
    const values = tableEditsOf(rowType, cfg, where);
    const spec = dataSpec(rowType, cfg as AnyRowConfig, {
        arm: "table",
        kind: (node, key, _hasChildren, value) => tableKind({
            ...(cells !== undefined ? { cells: cells.at(node, key, value) as PlanTableCellsInput<PlanAxisKindLiteral> } : {}),
            ...(cfg.fold !== undefined ? { fold: cfg.fold } : {}),
            ...(positions !== undefined ? { series: positions.at(node, key, value) as PlanElementsInput<PlanTableSeriesType, PlanAxisKindLiteral> } : {}),
            ...(cfg.split !== undefined ? { split: cfg.split } : {}),
            ...(cfg.format !== undefined ? { format: cfg.format } : {}),
            ...(cfg.emphasis !== undefined ? { emphasis: cfg.emphasis } : {}),
        }, aggregate),
        reads: [...(cells?.reads ?? []), ...(positions?.reads ?? [])],
        values,
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K, PlanTableReads<UC, S, FO, A, CT, CU, CF, CS>>
        & PlanFoldsBrand<PlanReadsNormal<PlanFoldsOf<UC, FO> & PlanPositionsFolds<S>>>;
}

/**
 * A bucket series — one bucket row (the Planner surface) per entry.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the tiles imply (inferred from `events` / `markers`; `never` when erased)
 * @typeParam KT - The entries' key type
 * @typeParam FE - The collection its tiles read
 * @typeParam UE - What its tiles read
 * @typeParam UM - What its markers read
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 * @param rowType - The entry type
 * @param config - The reads and accessors ({@link PlanBucketsSeriesConfig})
 * @returns A series value, branded with its kind and what it reads
 */
export function createSeriesBuckets<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    FE extends string = string, UE = unknown, UM = unknown, CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
>(rowType: R, config: PlanBucketsSeriesConfig<R, K, KT, FE, UE, UM, CT, CU, CF, CS>): PlanSeriesValue<K, PlanReadsNormal<UE & UM & PlanChildrenReads<CT, CU, CF, CS>>> {
    const cfg = config as unknown as PlanBucketsSeriesConfig<EastType, PlanAxisKindLiteral, EastType>;
    const where = `Plan.series.buckets "${cfg.key}"`;
    const edit = editRecipeOf(cfg.edit, "events", "{ at }", cfg.events, where);
    const events = elementField(rowType, cfg.events, "event", where, "events");
    if (events === undefined) throw new Error(`${where}: give its events — Plan.items(field, { at }, draw), or a function of the row`);
    const markers = elementField(rowType, cfg.markers, "marker", where, "markers");
    const spec = dataSpec(rowType, cfg as AnyRowConfig, {
        arm: "buckets",
        kind: (node, key, _hasChildren, value) => bucketsKind({
            ...(cfg.lanes !== undefined ? { lanes: cfg.lanes(node, key) } : {}),
            events: events.at(node, key, value) as PlanElementsInput<PlanBucketEventType, PlanAxisKindLiteral>,
            ...(markers !== undefined ? { markers: markers.at(node, key, value) as PlanElementsInput<typeof PlanCellMarkerType, PlanAxisKindLiteral> } : {}),
        }),
        edit,
        reads: [...events.reads, ...(markers?.reads ?? [])],
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K, PlanReadsNormal<UE & UM & PlanChildrenReads<CT, CU, CF, CS>>>;
}

/**
 * A cards series — one cards row (Roster chips) per entry.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the chips imply (inferred from `chips`; `never` when erased)
 * @typeParam KT - The entries' key type
 * @typeParam FC - The collection its chips read
 * @typeParam UC - What its chips read
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 * @param rowType - The entry type
 * @param config - The reads and accessors ({@link PlanCardsSeriesConfig})
 * @returns A series value, branded with its kind and what it reads
 */
export function createSeriesCards<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    FC extends string = string, UC = unknown, CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
>(rowType: R, config: PlanCardsSeriesConfig<R, K, KT, FC, UC, CT, CU, CF, CS>): PlanSeriesValue<K, PlanReadsNormal<UC & PlanChildrenReads<CT, CU, CF, CS>>> {
    const cfg = config as unknown as PlanCardsSeriesConfig<EastType, PlanAxisKindLiteral, EastType>;
    const where = `Plan.series.cards "${cfg.key}"`;
    const edit = editRecipeOf(cfg.edit, "chips", "{ from, to }", cfg.chips, where);
    const chips = elementField(rowType, cfg.chips, "chip", where, "chips");
    if (chips === undefined) throw new Error(`${where}: give its chips — Plan.items(field, { from, to }, draw), or a function of the row`);
    const spec = dataSpec(rowType, cfg as AnyRowConfig, {
        arm: "cards",
        kind: (node, key, _hasChildren, value) => cardsKind(chips.at(node, key, value) as PlanElementsInput<PlanChipType, PlanAxisKindLiteral>),
        edit,
        reads: chips.reads,
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K, PlanReadsNormal<UC & PlanChildrenReads<CT, CU, CF, CS>>>;
}

/**
 * An events series — one instant-mark row per entry.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the marks imply (inferred from `marks`; `never` when erased)
 * @typeParam KT - The entries' key type
 * @typeParam FM - The collection its marks read
 * @typeParam UM - What its marks read
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 * @param rowType - The entry type
 * @param config - The reads and accessors ({@link PlanEventsSeriesConfig})
 * @returns A series value, branded with its kind and what it reads
 */
export function createSeriesEvents<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    FM extends string = string, UM = unknown, CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
>(rowType: R, config: PlanEventsSeriesConfig<R, K, KT, FM, UM, CT, CU, CF, CS>): PlanSeriesValue<K, PlanReadsNormal<UM & PlanChildrenReads<CT, CU, CF, CS>>> {
    const cfg = config as unknown as PlanEventsSeriesConfig<EastType, PlanAxisKindLiteral, EastType>;
    const where = `Plan.series.events "${cfg.key}"`;
    const edit = editRecipeOf(cfg.edit, "marks", "{ at }", cfg.marks, where);
    const marks = elementField(rowType, cfg.marks, "mark", where, "marks");
    if (marks === undefined) throw new Error(`${where}: give its marks — Plan.items(field, { at }, draw), or a function of the row`);
    const spec = dataSpec(rowType, cfg as AnyRowConfig, {
        arm: "events",
        kind: (node, key, _hasChildren, value) => eventsKind(marks.at(node, key, value) as PlanElementsInput<PlanEventMarkType, PlanAxisKindLiteral>),
        edit,
        reads: marks.reads,
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K, PlanReadsNormal<UM & PlanChildrenReads<CT, CU, CF, CS>>>;
}

/**
 * A chart series — one chart row per entry, its layers over the entry's own
 * values (`Plan.line` … `Plan.band` over `Plan.values`), or built from the
 * entry by a function. Its layers over values brand it with the axis kind
 * their keys ride; a Chart layer's face hides its x type, so a series whose
 * layers are all Chart layers constrains no axis at compile time — the
 * render-time diagnostic holds it to the axis like any row.
 *
 * @typeParam R - The entry type
 * @typeParam KT - The entries' key type
 * @typeParam K - The axis kind its layers' values ride
 * @typeParam L - Its `layers`, as written
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 * @param rowType - The entry type
 * @param config - The layers, accessors and shared axes ({@link PlanChartSeriesConfig})
 * @returns A series value, branded with its kind and what it reads
 */
export function createSeriesChart<
    R extends EastType, KT extends EastType = StringType, K extends PlanAxisKindLiteral = never,
    L extends readonly unknown[] = never, CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
>(rowType: R, config: PlanChartSeriesConfig<R, KT, K, L, CT, CU, CF, CS>): PlanSeriesValue<K, PlanReadsNormal<([L] extends [never] ? unknown : PlanIntersect<PlanUseReads<L[number]>>) & PlanChildrenReads<CT, CU, CF, CS>>> {
    const cfg = config as unknown as PlanChartSeriesConfig<EastType, EastType>;
    const where = `Plan.series.chart "${cfg.key}"`;
    const layers = listField(rowType, cfg.layers, "layer", where, "layers");
    if (layers === undefined) throw new Error(`${where}: give its layers — Plan.line(Plan.values(field, draw)) and the like, or a function of the row`);
    const spec = dataSpec(rowType, cfg as AnyRowConfig, {
        arm: "chart",
        kind: (node, key, _hasChildren, value) => chartKind({
            layers: layers.at(node, key, value) as PlanChartLayerInput | PlanChartLayerInput[],
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
        reads: layers.reads,
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K, PlanReadsNormal<([L] extends [never] ? unknown : PlanIntersect<PlanUseReads<L[number]>>) & PlanChildrenReads<CT, CU, CF, CS>>>;
}

/**
 * A group series — one group strip PER ENTRY, its members the entry's
 * children (#822). Collapsed, a strip rests as its summary heat strip —
 * explicit `summary` cells, or the renderer-derived `summaryAggregate` — and
 * its member count is derived.
 *
 * @remarks
 * Hierarchy comes from the data's nesting: a group's members are a `Dict` of
 * the entry (`Plan.children(field, [series…])`), so a flat source is grouped
 * in the dataflow, or reshaped inline into entries that hold their members.
 * The `by` form and the static `group(R, chrome, children)` form are gone —
 * see `Plan.series.section` for a fixed titled block.
 *
 * @typeParam R - The entry type
 * @typeParam K - The axis kind the summary cells imply
 * @typeParam KT - The entries' key type
 * @typeParam US - What its `summary` reads
 * @typeParam FO - How a bucket folds its summary cells
 * @typeParam A - Its `summaryAggregate`, as written
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 * @param rowType - The entry type
 * @param config - The strip's accessors and its members ({@link PlanGroupSeriesConfig})
 * @returns A series value, branded with its kind and what it reads
 * @throws {Error} When called with the removed `by` or static forms
 */
export function createSeriesGroup<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    US = unknown, FO extends PlanFoldLiteral | undefined = undefined, A extends PlanAggregateLiteral = never,
    CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
>(rowType: R, config: PlanGroupSeriesConfig<R, K, KT, US, FO, A, CT, CU, CF, CS>): PlanSeriesValue<K, PlanReadsNormal<US & PlanChildrenReads<CT, CU, CF, CS, A>>> {
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
    if (cfg.summary !== undefined && cfg.summaryAggregate !== undefined) {
        throw new Error(
            `${where}: give \`summary\` (explicit strip cells) OR \`summaryAggregate\` (cells derived from the ` +
            "members) — a collapsed strip shows one or the other");
    }
    const summary = consumerField(rowType, cfg.summary, "heat", where, "summary");
    // The strip's ONE summary (#824): the per-entry cells, the declared
    // aggregate, or a plain band.
    const declared = summary === undefined ? groupSummary(undefined, cfg.summaryAggregate, where) : undefined;
    const spec = dataSpec(rowType, cfg as AnyRowConfig, {
        arm: "group",
        kind: (node, key, _hasChildren, value) => groupKind(declared ?? East.value(
            variant("cells", East.value(summary!.at(node, key, value) as SubtypeExprOrValue<PlanHeatCellsType>, PlanHeatCellsType)),
            PlanGroupSummaryType)),
        reads: summary?.reads ?? [],
    });
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K, PlanReadsNormal<US & PlanChildrenReads<CT, CU, CF, CS, A>>>;
}

/**
 * A section — a fixed titled block over series: one header row, the member
 * series' rows beneath it (#822). A section adds no path segment: its header's
 * id is `section { series, path }` at its parent's path, and its members' rows
 * keep their own.
 *
 * @typeParam R - The entry type (the members' — they share the section's entries)
 * @typeParam K - The union of the members' axis kinds (inferred; `never` when all are erased)
 * @typeParam S - The members, as written
 * @param rowType - The entry type
 * @param config - The header ({@link PlanSectionSeriesConfig})
 * @param members - The member series, in order
 * @returns A series value, branded with its members' kinds and what they read
 */
export function createSeriesSection<R extends EastType, K extends PlanAxisKindLiteral = never, S extends readonly unknown[] = PlanSeriesValue<K>[]>(
    rowType: R,
    config: PlanSectionSeriesConfig<K>,
    members: S & PlanSeriesValue<K>[],
): PlanSeriesValue<K, PlanSeriesListReads<S>> {
    const cfg = config as PlanSectionSeriesConfig<PlanAxisKindLiteral>;
    const spec = sectionSpec(cfg, members);
    return seriesValue(rowType, undefined, spec, cfg) as PlanSeriesValue<K, PlanSeriesListReads<S>>;
}

/**
 * A views series — each entry gets one row per member series, adjacent and in
 * declared order; the entry's children follow its view rows, nested under the
 * first of them (#822). How one entity is shown several ways: a press's jobs,
 * utilisation and sheets as three rows side by side.
 *
 * @remarks
 * A member series' own `match` decides whether its row shows for an entry; a
 * member may not declare `children` (the views own the entry's children). A
 * view row's id is its member series' key and the entry's path, and a seek on
 * the entry lands on its first view row.
 *
 * The views' `children` are a step-down's series, or — a tree's field — more
 * of the views' own entries, each drawn as its members' rows, to any depth,
 * the views' `match` and `collapsed` at every level (#1219). A span member that
 * declares `rollup` rolls up the children nested under its row.
 *
 * @typeParam R - The entry type
 * @typeParam K - The union of the members' axis kinds (inferred; `never` when all are erased)
 * @typeParam KT - The entries' key type
 * @typeParam S - The members, as written
 * @typeParam CT - A tree's field, as `children` names it
 * @typeParam CU - One step-down's reads
 * @typeParam CF - The folds of its cells
 * @typeParam CS - Several step-downs' reads
 * @param rowType - The entry type
 * @param config - Membership, collapse and children ({@link PlanViewsSeriesConfig})
 * @param members - The member series — one row each per entry, in order
 * @returns A series value, branded with its members' kinds and what it reads
 */
export function createSeriesViews<
    R extends EastType, K extends PlanAxisKindLiteral = never, KT extends EastType = StringType,
    S extends readonly unknown[] = PlanSeriesValue<K>[], CT extends PlanTreeField<R> = never, CU = unknown, CF = unknown, CS extends readonly unknown[] = never,
>(
    rowType: R,
    config: PlanViewsSeriesConfig<R, KT, CT, CU, CF, CS>,
    members: S & PlanSeriesValue<K>[],
): PlanSeriesValue<K, PlanReadsNormal<PlanIntersect<PlanReadsOfSeries<S[number]>> & PlanChildrenReads<CT, CU, CF, CS>>> {
    const cfg = config as unknown as PlanViewsSeriesConfig<EastType, EastType>;
    const spec = viewsSpec(rowType, cfg, members);
    return seriesValue(rowType, cfg.keyType, spec, cfg) as PlanSeriesValue<K, PlanReadsNormal<PlanIntersect<PlanReadsOfSeries<S[number]>> & PlanChildrenReads<CT, CU, CF, CS>>>;
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
