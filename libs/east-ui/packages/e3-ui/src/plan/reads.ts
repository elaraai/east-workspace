/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Named reads (#1436) — a series names the collection of its row it reads,
 * and how that collection sits in time, so nothing outside a function has to
 * find either: `Plan.items(field, { from, to } | { at }, draw)` reads the
 * things people drag, a `Dict` keyed by an id, their times the fields named;
 * `Plan.values(field, draw)` reads a value per instant, a `Dict` keyed by the
 * instant. `draw` builds only how an element looks: its key and its instants
 * come from the item's id and its times, or from the value's key.
 *
 * A read, and each consumer of a values read (`Plan.heatCells`,
 * `Plan.tableCells`, `Plan.tableSeries`, `Plan.line` …), is a DESCRIPTION:
 * the series builds each row's elements from it, once per row type, the same
 * East over an inline row and a paged one. Each carries what it reads as a
 * phantom brand ({@link PlanReadsBrand}) beside its axis kind, and the series
 * collects them into its own.
 *
 * @packageDocumentation
 */

import type {
    DateTimeType, DictType, EastType, ExprType, FloatType, IntegerType, OptionType, RecursiveType, StringType, StructType,
} from "@elaraai/east";

import { PlanAxisKindBrand, type PlanAxisKindLiteral, type PlanFoldLiteral } from "./types.js";
import type { PlanEntryExpr, PlanEntryFields, PlanItemFields, PlanItemInstantType } from "./series.js";

// ============================================================================
// The brands — what a series reads, and what a description makes
// ============================================================================

/**
 * The phantom brand of what a series reads (#1436): each collection its named
 * reads name, and how it is read — `{ jobs: { items: { from: "start"; to:
 * "end" } } }`, `{ load: { values: true } }`; a collection whose values a
 * parent subtotals, by the fold and the aggregate (`{ readings: { values: {
 * rollup: { fold: "sum"; aggregate: "sum" } } } }`); a span's runs that roll
 * up into its bands (`rollup: true` beside `items`); a step-down's under its
 * field (`{ members: { rows: … } }`); a tree's (`{ parts: { recursive: true }
 * }`).
 *
 * @remarks
 * Like {@link PlanAxisKindBrand}, it exists only in the TYPES: the property is
 * optional and never written. A series list held in a variable or built in
 * East is erased; the series' build spec records the same reads at runtime,
 * and a source's index holds both (#1435).
 */
export const PlanReadsBrand: unique symbol = Symbol("PlanReads");
/** The type of {@link PlanReadsBrand}. */
export type PlanReadsBrand = typeof PlanReadsBrand;

/**
 * The phantom facts of a values read's consumer (#1436) — what it makes (so
 * each series field takes its own), the entry type its read is over (so the
 * read infers it from where the consumer is used), the fold a bucket folds its
 * values by, and, for a table position, whether it feeds its parent's
 * subtotal. Types only, like {@link PlanReadsBrand}.
 */
export const PlanUseBrand: unique symbol = Symbol("PlanUse");
/** The type of {@link PlanUseBrand}. */
export type PlanUseBrand = typeof PlanUseBrand;

// ============================================================================
// The collections a row holds
// ============================================================================

/**
 * A `Dict` field of an entry: a nested collection a series reads by name.
 *
 * @typeParam R - The entry type
 */
export type PlanCollectionField<R extends EastType> = {
    [F in keyof PlanEntryFields<R> & string]: PlanEntryFields<R>[F] extends DictType<EastType, EastType> ? F : never
}[keyof PlanEntryFields<R> & string];

/**
 * A `Dict` field of an entry keyed by an id: the things people drag (jobs,
 * stops, shifts, drops, alarms, decisions), each a struct.
 *
 * @typeParam R - The entry type
 */
export type PlanItemsField<R extends EastType> = {
    [F in PlanCollectionField<R>]: PlanEntryFields<R>[F] extends DictType<StringType, StructType> ? F : never
}[PlanCollectionField<R>];

/**
 * A `Dict` field of an entry keyed by an instant: values, one per instant —
 * `Dict<DateTime, V>` on a time axis, `Dict<Float, V>` or `Dict<Integer, V>`
 * on a number axis, `Dict<String, V>` on an ordinal one.
 *
 * @typeParam R - The entry type
 */
export type PlanValuesField<R extends EastType> = {
    [F in PlanCollectionField<R>]: PlanEntryFields<R>[F] extends DictType<DateTimeType | FloatType | IntegerType | StringType, EastType> ? F : never
}[PlanCollectionField<R>];

/**
 * A `Dict` field of an entry holding child rows, keyed by an id: what
 * `Plan.children(field, [series…])` steps down to.
 *
 * @typeParam R - The entry type
 */
export type PlanChildField<R extends EastType> = {
    [F in PlanCollectionField<R>]: PlanEntryFields<R>[F] extends DictType<StringType, StructType | RecursiveType<any>> ? F : never
}[PlanCollectionField<R>];

/**
 * A `Dict` field of a recursive entry holding more entries of its own type,
 * keyed by an id: what a series' `children: field` names for a tree.
 *
 * @typeParam R - The entry type
 */
export type PlanTreeField<R extends EastType> = {
    [F in PlanCollectionField<R>]: PlanEntryFields<R>[F] extends DictType<StringType, R> ? F : never
}[PlanCollectionField<R>];

/**
 * What a collection holds.
 *
 * @typeParam R - The entry type
 * @typeParam F - The collection's field
 */
export type PlanCollectionItem<R extends EastType, F extends string> =
    F extends keyof PlanEntryFields<R>
        ? (PlanEntryFields<R>[F] extends DictType<EastType, infer V extends EastType> ? V : never)
        : never;

/**
 * What a collection is keyed by.
 *
 * @typeParam R - The entry type
 * @typeParam F - The collection's field
 */
export type PlanCollectionKey<R extends EastType, F extends string> =
    F extends keyof PlanEntryFields<R>
        ? (PlanEntryFields<R>[F] extends DictType<infer K extends EastType, EastType> ? K : never)
        : never;

/**
 * An item's field holding an instant: a {@link PlanItemInstantType}, or an
 * `Option` of a `DateTime` (an item with no start draws nowhere; one with no
 * end is an instant).
 *
 * @typeParam I - The item type
 */
export type PlanItemTimeField<I extends EastType> = {
    [K in keyof PlanItemFields<I> & string]: PlanItemFields<I>[K] extends PlanItemInstantType | OptionType<DateTimeType> ? K : never
}[keyof PlanItemFields<I> & string];

/**
 * The times an item may name: a start and an end (a run's, a chip's), or an
 * instant (a decision's, a tile's, a mark's).
 *
 * @typeParam I - The item type
 */
export type PlanItemTimes<I extends EastType> =
    | { readonly from: PlanItemTimeField<I>; readonly to: PlanItemTimeField<I> }
    | { readonly at: PlanItemTimeField<I> };

/** The times of a run or a chip, their names erased: what a span element field takes. */
export type PlanSpanTimes = { readonly from: string; readonly to: string };
/** The time of a decision, a tile or a mark, its name erased: what a point element field takes. */
export type PlanPointTimes = { readonly at: string };

/** The axis kind an East type of an instant rides — `never` when it says nothing (a `Plan.Types.Instant`). */
type PlanKindOfType<T> =
    T extends DateTimeType ? "time" :
    T extends FloatType | IntegerType ? "number" :
    T extends StringType ? "ordinal" :
    T extends OptionType<DateTimeType> ? "time" :
    never;

/**
 * The axis kind an item's named times ride: their fields' types' kinds — a
 * `DateTime` (or an `Option` of one) the time axis, a `Float` or an `Integer`
 * the number axis, a `String` the ordinal axis; `never` for a
 * `Plan.Types.Instant` field, which says nothing.
 *
 * @typeParam I - The item type
 * @typeParam T - The times named
 */
export type PlanKindOfTimes<I extends EastType, T> =
    T extends { readonly from: infer A extends string; readonly to: infer B extends string }
        ? PlanKindOfType<PlanItemFields<I>[A & keyof PlanItemFields<I>]> | PlanKindOfType<PlanItemFields<I>[B & keyof PlanItemFields<I>]>
        : T extends { readonly at: infer A extends string }
            ? PlanKindOfType<PlanItemFields<I>[A & keyof PlanItemFields<I>]>
            : never;

/**
 * The axis kind a values collection's key rides: a `DateTime` the time axis,
 * a `Float` or an `Integer` the number axis, a `String` the ordinal axis.
 *
 * @typeParam K - The collection's key type
 */
export type PlanKindOfKey<K> = PlanKindOfType<K>;

// ============================================================================
// The reads
// ============================================================================

/**
 * A row's collection of things people drag, read by name: its items drawn as
 * a kind's elements.
 *
 * @typeParam R - The entry type
 * @typeParam F - The collection's field
 * @typeParam T - Its times, as named
 * @typeParam L - What `draw` gives: the element's look
 * @typeParam K - The axis kind its times ride
 */
export interface PlanItems<R extends EastType, F extends string, T, L, K extends PlanAxisKindLiteral = never> {
    /** The collection's field. */
    readonly field: F;
    /** Its times. */
    readonly times: T;
    /** How an item looks, from the item, its id and its row. */
    readonly draw: (item: ExprType<PlanCollectionItem<R, F>>, id: ExprType<StringType>, row: PlanEntryExpr<R>) => L;
    /** The axis kind (phantom). */
    readonly [PlanAxisKindBrand]?: K;
    /** What it reads (phantom): `{ [F]: { items: T } }`. */
    readonly [PlanReadsBrand]?: { readonly [P in F]: { readonly items: T } };
}

/**
 * A row's collection of values, read by name: each value at its instant, its
 * key.
 *
 * @typeParam R - The entry type
 * @typeParam F - The collection's field
 * @typeParam L - What `draw` gives besides the instant
 * @typeParam K - The axis kind the collection's key rides
 */
export interface PlanValues<R extends EastType, F extends string, L, K extends PlanAxisKindLiteral = never> {
    /** The collection's field. */
    readonly field: F;
    /** What a value gives, from the value, its instant and its row. */
    readonly draw: (value: ExprType<PlanCollectionItem<R, F>>, at: ExprType<PlanCollectionKey<R, F>>, row: PlanEntryExpr<R>) => L;
    /** The axis kind (phantom). */
    readonly [PlanAxisKindBrand]?: K;
    /** What it reads (phantom): `{ [F]: { values: true } }`. */
    readonly [PlanReadsBrand]?: { readonly [P in F]: { readonly values: true } };
}

/**
 * A read of items as an element field takes it (#1436): a collection of the
 * entry, its times of the shape the element takes (`{ from, to }` for a run or
 * a chip, `{ at }` for the rest), its `draw` giving the element's look.
 *
 * @typeParam R - The entry type
 * @typeParam F - The collection's field
 * @typeParam S - The shape of the times the element takes
 * @typeParam L - The element's look
 * @typeParam K - The axis kind its times ride
 * @typeParam U - What it reads
 */
export interface PlanItemsInput<R extends EastType, F extends string, S, L, K extends PlanAxisKindLiteral, U> {
    /** The collection's field. */
    readonly field: F;
    /** Its times. */
    readonly times: S;
    /** How an item looks. */
    readonly draw: (item: never, id: ExprType<StringType>, row: PlanEntryExpr<NoInfer<R>>) => L;
    /** The axis kind (phantom). */
    readonly [PlanAxisKindBrand]?: K;
    /** What it reads (phantom). */
    readonly [PlanReadsBrand]?: U;
}

/**
 * A read of values as an element field or a consumer takes it (#1436): a
 * collection of the entry keyed by its instants, its `draw` giving what each
 * value gives.
 *
 * @typeParam R - The entry type
 * @typeParam L - What a value gives
 * @typeParam K - The axis kind its key rides
 * @typeParam U - What it reads
 */
export interface PlanValuesInput<R extends EastType, L, K extends PlanAxisKindLiteral, U> {
    /** The collection's field. */
    readonly field: string;
    /** Values name no times: their key is their instant. */
    readonly times?: never;
    /** What a value gives. */
    readonly draw: (value: never, at: never, row: PlanEntryExpr<NoInfer<R>>) => L;
    /** The axis kind (phantom). */
    readonly [PlanAxisKindBrand]?: K;
    /** What it reads (phantom). */
    readonly [PlanReadsBrand]?: U;
}

/**
 * A consumer of a values read (#1436) — `Plan.heatCells(values)`,
 * `Plan.tableCells(values)`, `Plan.tableSeries({ cells })`, `Plan.line(values)`
 * … — as a description the series builds per row.
 *
 * @typeParam M - What it makes: `"heat"` (a heat row's cells), `"tableCells"`, `"tableSeries"`, `"layer"`
 * @typeParam R - The entry type its read is over
 * @typeParam K - The axis kind its read's key rides
 * @typeParam U - What it reads
 * @typeParam FO - The fold a bucket folds its values by (`undefined` where its row declares it, as a table's `cells`)
 * @typeParam RO - Whether a table position feeds its parent's subtotal
 */
export interface PlanValuesUse<M extends string, R extends EastType, K extends PlanAxisKindLiteral, U, FO extends PlanFoldLiteral | undefined = undefined, RO extends boolean = false> {
    /** What it makes, its read's entry type, its fold, and a table position's subtotal flag (phantom). */
    readonly [PlanUseBrand]?: { readonly makes: M; readonly row: R; readonly fold: FO; readonly rollup: RO };
    /** The axis kind (phantom). */
    readonly [PlanAxisKindBrand]?: K;
    /** What it reads (phantom). */
    readonly [PlanReadsBrand]?: U;
}

// ============================================================================
// Runtime — the descriptions the series build from
// ============================================================================

/** An item's or a value's `draw`, its types erased. @internal */
export type PlanAnyDraw = (item: ExprType<EastType>, key: ExprType<EastType>, row: ExprType<EastType>) => unknown;

/** The times a read of items names. @internal */
export type PlanTimesSpec = { readonly from: string; readonly to: string } | { readonly at: string };

/**
 * A named read as the series build from it (#1436).
 *
 * @internal
 * @property kind - `"items"` or `"values"`
 * @property field - The collection's field
 * @property times - The items' times (items only)
 * @property draw - The look, from the item and its id, or the value and its instant, and the row
 */
export type PlanReadSpec =
    | { readonly kind: "items"; readonly field: string; readonly times: PlanTimesSpec; readonly draw: PlanAnyDraw }
    | { readonly kind: "values"; readonly field: string; readonly draw: PlanAnyDraw };

/** A read of values, as the series build from it. @internal */
export type PlanValuesReadSpec = Extract<PlanReadSpec, { kind: "values" }>;
/** A read of items, as the series build from it. @internal */
export type PlanItemsReadSpec = Extract<PlanReadSpec, { kind: "items" }>;

/** The cells a values read's draw completes to, by consumer. @internal */
export type PlanCellKind = "heat" | "weight" | "segment" | "table" | "point" | "band";

/**
 * A consumer of a values read, as the series build from it (#1436): the cells
 * its read's values complete to, and what it makes of one row's cells.
 *
 * @internal
 * @property makes - What it makes (`"heat"`, `"tableCells"`, `"tableSeries"`, `"layer"`)
 * @property read - The values read it consumes
 * @property cell - The cell each value completes to
 * @property fold - The fold a bucket folds its values by, where it declares one
 * @property rollup - Whether a table position feeds its parent's subtotal
 * @property edit - Whether a table position's values take typed numbers (`edit: true`)
 * @property wrap - One row's value, from its cells
 */
export interface PlanValuesUseSpec {
    readonly makes: "heat" | "tableCells" | "tableSeries" | "layer";
    readonly read: PlanValuesReadSpec;
    readonly cell: PlanCellKind;
    readonly fold: PlanFoldLiteral | undefined;
    readonly rollup: boolean;
    readonly edit?: boolean;
    readonly wrap: (cells: ExprType<EastType>) => unknown;
}

/**
 * Whether a table position's values take typed numbers (#1436): `true`, on
 * `Plan.series.table` for its `cells` or on a `Plan.tableSeries` position,
 * its cells a `Plan.values` read drawing each value as it is stored
 * (`value: some(v)`). A number typed into a cell sets the collection's value
 * at the bucket's start, adds one where it holds none, or, cleared, deletes it.
 */
export type PlanValuesEdit = true;

const READS = new WeakMap<object, PlanReadSpec>();
const USES = new WeakMap<object, PlanValuesUseSpec>();

/**
 * The read a `Plan.items` or `Plan.values` call made, if `x` is one.
 *
 * @internal
 * @param x - Anything a config field holds
 * @returns The read, or `undefined`
 */
export function planReadOf(x: unknown): PlanReadSpec | undefined {
    return typeof x === "object" && x !== null ? READS.get(x) : undefined;
}

/**
 * The consumer description `x` is, if a cell builder or a layer made it from a
 * values read.
 *
 * @internal
 * @param x - Anything a config field holds
 * @returns The consumer, or `undefined`
 */
export function planUseOf(x: unknown): PlanValuesUseSpec | undefined {
    return typeof x === "object" && x !== null ? USES.get(x) : undefined;
}

/**
 * Record a consumer description a builder made from a values read.
 *
 * @internal
 * @param spec - What it consumes and makes
 * @returns The description: a frozen object the series reads through {@link planUseOf}
 */
export function planUse<T>(spec: PlanValuesUseSpec): T {
    const description = Object.freeze({});
    USES.set(description, spec);
    return description as T;
}

/**
 * Refuse a read, or a consumer of one, where no row gives its collection — a
 * hand-built row, or any field that is not a series' (#1436).
 *
 * @internal
 * @param x - The input to check
 * @throws {Error} Naming where a read goes
 */
export function refuseReadOutsideSeries(x: unknown): void {
    const read = planReadOf(x) ?? planUseOf(x)?.read;
    if (read === undefined) return;
    if (read.kind === "items") {
        throw new Error("Plan.items reads a row's collection: give it to a series' runs, decisions, events, chips or marks");
    }
    throw new Error("Plan.values reads a row's collection: give it to a series' cells, series, layers, summary, ports or markers");
}

/** The words for a times argument that names no field. */
function timesShape(times: unknown): PlanTimesSpec {
    const t = times as { from?: unknown; to?: unknown; at?: unknown } | null;
    if (t !== null && typeof t === "object") {
        if (typeof t.from === "string" && typeof t.to === "string" && t.at === undefined) return Object.freeze({ from: t.from, to: t.to });
        if (typeof t.at === "string" && t.from === undefined && t.to === undefined) return Object.freeze({ at: t.at });
    }
    throw new Error("Plan.items: name the items' times — { from, to } for a run or a chip, { at } for a decision, a tile or a mark — each a field of the item");
}

/**
 * Read a row's collection of things people drag: each item an element — a
 * run, a decision, a tile, a chip or a mark — its key the item's id, its
 * instants the times named, its look `draw`'s.
 *
 * @typeParam R - The entry type, inferred from where it is used, as `Plan.children`'s is
 * @typeParam F - The collection's field
 * @typeParam T - The times, as named
 * @typeParam L - The look `draw` gives
 * @param field - The collection: a Dict field of the entry, keyed by an id
 * @param times - Its items' times: `{ from, to }` for a run or a chip; `{ at }` for the rest
 * @param draw - How an item looks: everything its element takes but its key and its instants
 * @returns The read, for the series' element field
 */
export function createItems<
    R extends EastType,
    F extends PlanItemsField<R>,
    const T extends PlanItemTimes<PlanCollectionItem<R, F>>,
    L,
>(
    field: F,
    times: T,
    draw: (item: ExprType<PlanCollectionItem<R, F>>, id: ExprType<StringType>, row: PlanEntryExpr<R>) => L,
): PlanItems<R, F, T, L, PlanKindOfTimes<PlanCollectionItem<R, F>, T>> {
    if (typeof field !== "string") throw new Error("Plan.items: name the collection — a Dict field of the row, keyed by an id");
    if (typeof draw !== "function") throw new Error(`Plan.items: "${field}" needs a draw — how an item looks, from the item, its id and its row`);
    const shape = timesShape(times);
    const read = Object.freeze({ field, times: shape, draw });
    READS.set(read, { kind: "items", field, times: shape, draw: draw as unknown as PlanAnyDraw });
    return read as unknown as PlanItems<R, F, T, L, PlanKindOfTimes<PlanCollectionItem<R, F>, T>>;
}

/**
 * Read a row's collection of values: each value at its instant — the
 * collection's key — with what `draw` gives: a heat, weight, segment or table
 * row's cells, a table series' cells, a chart layer's points, a span's ports,
 * a bucket row's markers.
 *
 * @typeParam R - The entry type, inferred from where it is used
 * @typeParam F - The collection's field
 * @typeParam L - What a value gives
 * @param field - The collection: a Dict field of the entry, keyed by an instant
 * @param draw - What a value gives besides its instant (`{ value }`, `{ fraction, planned }`, `{ y }`, `{ label }`, …)
 * @returns The read, for the cell builders, the chart layers, a group's `summary`, `ports` and `markers`
 */
export function createValues<R extends EastType, F extends PlanValuesField<R>, L>(
    field: F,
    draw: (value: ExprType<PlanCollectionItem<R, F>>, at: ExprType<PlanCollectionKey<R, F>>, row: PlanEntryExpr<R>) => L,
): PlanValues<R, F, L, PlanKindOfKey<PlanCollectionKey<R, F>>> {
    if (typeof field !== "string") throw new Error("Plan.values: name the collection — a Dict field of the row, keyed by its instants");
    if (typeof draw !== "function") throw new Error(`Plan.values: "${field}" needs a draw — what a value gives, from the value, its instant and its row`);
    const read = Object.freeze({ field, draw });
    READS.set(read, { kind: "values", field, draw: draw as unknown as PlanAnyDraw });
    return read as unknown as PlanValues<R, F, L, PlanKindOfKey<PlanCollectionKey<R, F>>>;
}
