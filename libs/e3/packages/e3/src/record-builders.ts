/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builders a record declared whole hands its declaration.
 *
 * `e3.record(name, type, { indexes, mutations, migrations })` calls each of
 * these with a builder typed by the record's state — `index`, `mutation` and
 * `migration` — and builds what they return under its name, as the record is
 * declared: its indexes and mutations by their keys, its migrations in order.
 * Each part is checked there, every refusal naming the record and the part, and
 * TypeScript reads each part's name and types off the one call.
 */

import type { CallableFunctionExpr, DictType, EastType, FunctionExpr, NullType, PatchTypeOf, StructType } from '@elaraai/east';
import type { RecordSummaryTotalsType } from '@elaraai/e3-types';
import type { MigrationDef, MutationDef, RecordDef, RecordIndexDef } from './types.js';
import { plainDefinition } from './record-index.js';
import type {
  AreaIndexOf, AreaIndexSpec, IndexKeyOf, IndexOn, IntervalIndexSpec, NestedKeyOf, NestedSeriesIndexSpec, NestedValueOf,
  ProjectionOf, SeriesIndexSpec, SummaryIndexSpec, SummaryKeyOf, TimeTileOf,
} from './record-index.js';
import { intervalDefinition } from './record-interval.js';
import { areaDefinition } from './record-area.js';
import { seriesDefinition, summaryDefinition } from './record-series.js';
import { nestedDefinition } from './record-nested-programs.js';
import { items, recursive, rows, values, type NestedOf } from './record-nested.js';
import { editDefinition, patchDefinition, reduceDefinition } from './mutation.js';
import { stepDefinition } from './migration.js';
import type { IndexFunction } from './record-guards.js';
import type { FunctionRunner } from './runner.js';

/** A Dict record's row type. */
type RowOf<T> = T extends DictType<unknown, infer V extends EastType> ? V : EastType;
/** A Dict record's row fields, by name. */
type RowFields<T> = T extends DictType<unknown, StructType<infer F>> ? F : Record<never, never>;
/** The name of one of a Dict record's row fields. */
type Field<T> = keyof RowFields<T> & string;

/** The key of a part a builder makes: what `e3.record` builds the part by. */
export const RECORD_PART = Symbol('e3.recordPart');

/** A part's runner selection (known runtimes only, as `e3.function`'s). */
export interface PartRunner {
  /** The runner its functions run on. */
  readonly runner?: FunctionRunner;
}

/** A plain index's options: the projection its entries carry, and its runner. */
export interface PlainIndexOptions extends PartRunner {
  /** `(K, V) -> P`: what a view renders from the index alone, so it never reads the record's segments. */
  readonly value?: IndexFunction;
}

/**
 * An index the `index` builder makes, which `e3.record` builds under its key.
 *
 * @typeParam IK - The index key an entry sorts under
 * @typeParam P - What each entry carries
 * @typeParam On - The row fields leading it, as written
 * @typeParam Extra - Its kind's own part of the definition
 */
export interface IndexDraft<
  IK extends EastType = EastType,
  P extends EastType = EastType,
  On extends readonly string[] | undefined = readonly string[] | undefined,
  Extra = unknown,
> {
  /** How the record builds it under its name. */
  readonly [RECORD_PART]: { readonly part: 'index'; readonly build: (record: RecordDef, name: string) => RecordIndexDef };
  /** Its types, for TypeScript alone: never set. */
  readonly types?: { readonly key: IK; readonly value: P; readonly on: On; readonly extra: Extra };
}

/**
 * A mutation the `mutation` builder makes, which `e3.record` builds under its key.
 *
 * @typeParam Args - The arguments it takes after the state
 */
export interface MutationDraft<Args extends readonly EastType[] = readonly EastType[]> {
  /** How the record builds it under its name. */
  readonly [RECORD_PART]: { readonly part: 'mutation'; readonly build: (record: RecordDef, name: string) => MutationDef };
  /** Its types, for TypeScript alone: never set. */
  readonly types?: { readonly args: Args };
}

/** A migration step the `migration` builder makes, which `e3.record` builds in its place in the list. */
export interface MigrationDraft {
  /** How the record builds it, after the step before it in the list (none for the first). */
  readonly [RECORD_PART]: { readonly part: 'migration'; readonly build: (record: RecordDef, previous: MigrationDef | undefined) => MigrationDef };
}

/**
 * The nested series index's builder, `index.nested`, and the builders of the
 * collections it files.
 *
 * @typeParam T - The record's state type
 */
export interface NestedBuilder<T extends EastType> {
  /**
   * A nested series index (#1434): every collection the record's rows nest,
   * filed in time. Each item is filed once (or once a year past a year) by its
   * collection, its row, the node holding it and its time, carrying the item;
   * each node's totals are kept a `summary` tile at a time; every parent's
   * subtotals of a collection of values declared with a rollup are kept at every
   * level from `tile` up; and each item of a collection declared `{ rollup: true }`
   * is filed under every ancestor too. The record's other indexes then carry its
   * rows without the listed collections, so a page of rows reads no nested item,
   * and `Data.bindPaged` asks it beside any of them (#1435). A record has one; no
   * field leads it, and it takes no `value`.
   *
   * @param spec - `collections`, each declared with {@link items}, {@link values}, {@link rows} or {@link recursive};
   *   `tile`, the finest level an item is filed at; `summary`, the tile each node's totals are kept by
   * @param options - Its runner
   * @returns The index, its key e3-types' `NestedEntryKeyType` and its value `NestedEntryType`
   * @throws {Error} Where a collection's declaration does not fit its field, naming the collection and what to write;
   *   for a tile of none of the five; or for a second nested series index on the record, naming the first
   *
   * @example
   * ```ts
   * const machines = e3.record('machines', MachinesType, {
   *   initial: new Map(),
   *   indexes: (index) => ({
   *     // Every collection a machine nests, filed from a week up and totalled a month at a time:
   *     machines_in_time: index.nested({
   *       collections: {
   *         jobs: index.nested.items({ from: 'start', to: 'end' }),
   *         load: index.nested.values(),
   *       },
   *       tile: 'week',
   *       summary: 'month',
   *     }),
   *   }),
   * });
   * ```
   */
  <const S extends NestedSeriesIndexSpec<T>>(spec: S, options?: PartRunner):
    IndexDraft<NestedKeyOf<T>, NestedValueOf<T, S>, readonly [], { readonly nested: NestedOf<S> }>;
  /** A collection of items, each placed by its times: things people drag. */
  readonly items: typeof items;
  /** A collection of values, one per instant. */
  readonly values: typeof values;
  /** A collection of child rows, which nest collections of their own. */
  readonly rows: typeof rows;
  /** A field holding more rows like the one listing it. */
  readonly recursive: typeof recursive;
}

/**
 * The `index` builder a record declared whole hands its `indexes`: one
 * method a kind, each typed by the record's rows, so a field it names is one of
 * the row's.
 *
 * An index is a second collection over a Dict record, `Dict<{ik, k}, P>` — the
 * index key first, the primary key second — maintained in the same commit as
 * the record, so every entry sharing an index key is one contiguous run, ordered
 * by primary key inside it, and a range of index keys is one contiguous run too.
 * Pages and key searches take it by its name; a view that renders from the index
 * alone declares what it renders as `value`, and never reads the record's
 * segments. Its functions are pure for the reason a reducer is: they run again
 * on every commit and in every build, and a maintained index must equal a
 * rebuilt one to the byte. Its name is an identifier, never `primary`.
 *
 * The indexes that answer more than an order — `interval`, `area`, `series`,
 * `summary` and `nested` — have keys the SDK generates: the row's leading
 * fields under `on` (#1432), e3's own parts beside them, so no row field's
 * name is reserved.
 *
 * @typeParam T - The record's state type, a Dict of Struct rows
 *
 * @example
 * ```ts
 * const plans = e3.record('plans', DictType(PlanKeyType, PlanRowType), {
 *   initial: new Map(),
 *   indexes: (index) => ({
 *     // A row field supplies its own key type.
 *     by_due: index.on(['due']),
 *     // One key per row, with a covering projection: a queue renders from the index alone.
 *     by_status: index.key(
 *       East.function([PlanKeyType, PlanRowType], StatusKeyType, ($, k, v) => ({ status: v.status, due: v.due })),
 *       { value: East.function([PlanKeyType, PlanRowType], QueueCardType, ($, k, v) => ({ title: v.title, owner: v.owner })) },
 *     ),
 *     // Many keys per row: a Set return.
 *     by_resource: index.keys(East.function([PlanKeyType, PlanRowType], SetType(ResourceRefType), ($, k, v) => v.resources)),
 *     // The plans overlapping a window of time, a status chosen beside it in one read:
 *     by_status_time: index.interval({ on: ['status'], from: 'start', to: 'end' }),
 *   }),
 * });
 * ```
 */
export interface IndexBuilder<T extends EastType> {
  /**
   * An index led by row fields: the rows in the order of their values. One
   * field uses its value as the key, several a Struct of them in their order. A
   * Set field fans out, a row under each of its elements.
   *
   * @param fields - The row fields, in key order: one or more
   * @param options - `value`, what each entry carries; its runner
   * @returns The index
   * @throws {Error} When a field is not one of the row's, or none is named
   */
  on<const F extends readonly Field<T>[], const O extends PlainIndexOptions = Record<never, never>>(fields: F, options?: O):
    IndexDraft<IndexKeyOf<{ on: F }, T>, ProjectionOf<O>, F>;
  /**
   * An index by a key each row computes: `(K, V) -> IK`, one entry a row.
   *
   * @param fn - The key function
   * @param options - `value`, what each entry carries; its runner
   * @returns The index
   * @throws {Error} When the function is async, calls a platform function or does not take the record's key and row
   */
  key<const F extends IndexFunction, const O extends PlainIndexOptions = Record<never, never>>(fn: F, options?: O):
    IndexDraft<IndexKeyOf<{ key: F }, T>, ProjectionOf<O>, undefined>;
  /**
   * An index by many keys a row computes, `(K, V) -> Set<IK>`: a row under each
   * key, so one naming five resources appears under five, and none under an
   * empty set — how a partial index is written.
   *
   * @param fn - The keys function
   * @param options - `value`, what each entry carries; its runner
   * @returns The index
   * @throws {Error} As {@link key} does, and when it does not return a Set
   */
  keys<const F extends IndexFunction, const O extends PlainIndexOptions = Record<never, never>>(fn: F, options?: O):
    IndexDraft<IndexKeyOf<{ keys: F }, T>, ProjectionOf<O>, undefined>;
  /**
   * An interval index: the events overlapping a half-open time window
   * `[from, to)`, carry-in events and those spanning the whole window among
   * them, each once, without day fan-out or a guessed lookback. Each event is
   * filed under at most three entries a combination of its leading fields,
   * whatever its length — a centred interval tree laid along the index's key
   * order, its key `{ on: { …on }, node, at }` — so a record Slice reads a
   * window as one start range and at most 54 carry-in ranges a combination. A
   * missing start is the backlog, selectable as Unset; a missing or
   * non-positive end is an instant.
   *
   * @param spec - `from` and `to`, the row's DateTime (or Option<DateTime>) fields an event starts and ends at, and
   *   the optional exact leading `on` fields
   * @param options - Its runner
   * @returns The index
   * @throws {Error} When `from` or `to` is not a DateTime field, or the start is a leading field
   */
  interval<const S extends IntervalIndexSpec<T>>(spec: S, options?: PartRunner):
    IndexDraft<IndexKeyOf<S, T>, NullType, IndexOn<S>, { readonly interval: { readonly from: S['from']; readonly to: S['to'] } }>;
  /**
   * An area index: the rows whose box meets a window, each once — the 2D twin of
   * {@link interval}. A loose quadtree laid along a Z-order curve: the domain is
   * the square `[−cell·2²⁷, cell·2²⁷)` world units in 29 levels, and each row is
   * filed once, under the deepest level whose cell is at least twice its box's
   * larger side, in the cell holding its box's centre, its key
   * `{ on: { …on }, area }`. A row whose `x` or `y` is `none` is unplaced, `area`
   * −1; one outside the domain, not finite, or larger than half the domain is
   * filed under the root. A record Slice reads a window as at most 266 disjoint
   * searches a combination of its leading fields. Each entry carries its row, so
   * a window reads the index alone; it takes no `value`.
   *
   * @param spec - The box's fields — `x`, `y` (Float, or Option<Float> for a row that may be unplaced), `width` and
   *   `height` (Float, or neither for a point) — `at` (`"corner"`, the default, or `"centre"`), `cell` (the finest
   *   cell's side in world units, rounded down to a power of two) and the optional exact leading `on` fields
   * @param options - Its runner
   * @returns The index, its projection the row
   * @throws {Error} When a field is not of its option's type, naming the option, the field and its type; when `x`
   *   and `y` are not both Options or neither, or `width` and `height` are not given together; or when `cell` is not
   *   a positive number
   */
  area<const S extends AreaIndexSpec<T>>(spec: S, options?: PartRunner):
    IndexDraft<IndexKeyOf<S, T>, RowOf<T>, IndexOn<S>, { readonly area: AreaIndexOf<S> }>;
  /**
   * A series index (#1039): the record's events by the key they are on — a
   * Plan's resource — and by time, so a key's events over any span are one
   * contiguous range a level (#1433). An event `[from, to)` is filed once, its
   * key `{ on: { …on }, key, level, tile }`: at the finest level, from `tile` up
   * to `year`, whose shortest tile holds its length — a day, a week, 28 days, 90
   * days, 365 days — under that level's tile holding its start; past 365 days,
   * under each year it touches, as many as 4,096. An instant is filed at
   * `tile`; a row with no start is filed nowhere. Each entry carries its row, so
   * a cell reads the index alone; it takes no `value`.
   *
   * @param spec - `key`, the field naming what an event is on (any but a Set); `from` and `to`, its DateTime (or
   *   Option<DateTime>) start and end fields; `tile`, `day`, `week`, `month`, `quarter` or `year`; and the optional
   *   exact leading `on` fields
   * @param options - Its runner
   * @returns The index, its projection the row
   * @throws {Error} When a field is not of its option's type, naming the option, the field and its type; when the
   *   tile is not one of the five; when the key is a leading field; or for `collections`, which are
   *   {@link NestedBuilder | the nested index's}
   */
  series<const S extends SeriesIndexSpec<T>>(spec: S, options?: PartRunner):
    IndexDraft<IndexKeyOf<S, T>, RowOf<T>, IndexOn<S>, { readonly series: TimeTileOf<S> }>;
  /** The nested series index, and the builders of the collections it files. */
  readonly nested: NestedBuilder<T>;
  /**
   * A summary index (#1039): under each key and tile of a series index, how many
   * rows touch the tile and the milliseconds of it they cover — what a
   * zoomed-out view draws where its events are too many to read. Its entries are
   * `{ ik: { on: { …on }, key, tile }, k: Null }` → `{ count, ms }`. A write
   * changes them by what its rows took away and gave, summed, and a total whose
   * count reaches zero is dropped, so a maintained summary equals the one a
   * reindex sums, byte for byte. An event's share of a tile is the milliseconds
   * of it the event overlaps; an instant counts in the tile holding it and
   * covers none of it; a row with no start counts in no tile.
   *
   * @param spec - `key`, `from`, `to` and `tile`, as {@link series} takes them, and the optional exact leading `on`
   *   fields
   * @param options - Its runner
   * @returns The index, its value the totals
   * @throws {Error} As {@link series} does, and for an event touching more than 4,096 tiles where it is written
   */
  summary<const S extends SummaryIndexSpec<T>>(spec: S, options?: PartRunner):
    IndexDraft<SummaryKeyOf<S, T>, typeof RecordSummaryTotalsType, IndexOn<S>, { readonly summary: TimeTileOf<S> }>;
}

/**
 * The `mutation` builder a record declared whole hands its `mutations`: its
 * write forms, each typed by the record's state.
 *
 * Every form commits the same thing, a delta of the primary's and every
 * index's changes addressed by key, which e3 applies segment by segment; they
 * differ in how the author says what changed, and so in what a write costs.
 * Each is pure, synchronous East — no async body and no platform call —
 * since the compare-and-swap loop re-runs a mutation against fresher state
 * when its write conflicts. A mutation's name is an identifier: it names the
 * record's commits beside e3's own, which begin with `$`, and `e3 mutate`
 * addresses it as `record.mutation`.
 *
 * @typeParam T - The record's state type
 *
 * @example
 * ```ts
 * const PlansType = DictType(StringType, PlanType);
 * const plans = e3.record('plans', PlansType, {
 *   initial: new Map(),
 *   mutations: (mutation) => ({
 *     add_plan: mutation.reduce(East.function([PlansType, StringType, PlanType], PlansType, ($, state, id, plan) => {
 *       const next = $.let(state.copy());   // the state is a frozen input: copy first
 *       $(next.insert(id, plan));
 *       return next;
 *     })),
 *     reschedule: mutation.edit(East.function([PlansType, StringType, DateTimeType, e3.mutation.editType(PlansType)], NullType,
 *       ($, state, id, due, edit) => {
 *         const plan = $.let(state.get(id));  // decodes one segment, not the record
 *         $(edit.set(id, { title: plan.title, owner: plan.owner, due }));
 *       })),
 *     patch: mutation.patch(),               // a view's save
 *   }),
 * });
 * ```
 */
export interface MutationBuilder<T extends EastType> {
  /**
   * A reducer of the whole state, `(state, ...args) => state`, for any record:
   * its first parameter and its return are the record's state, its other
   * parameters the mutation's arguments, read off its signature. The state is a
   * frozen input — derive the new state from a `.copy()`, or build it fresh. It
   * sees the whole state, so it costs the record's size in its runner however
   * little it changes; only its write, for a Dict or Set record, is what it
   * touched — any other record is written whole. {@link edit} reads and writes
   * only the entries it touches.
   *
   * @param fn - The reducer
   * @param options - Its runner
   * @returns The mutation
   * @throws {Error} When the body is async or calls a platform function, or its first parameter or its return is not
   *   the record's state
   */
  reduce<Args extends EastType[]>(fn: FunctionExpr<[T, ...Args], T> | CallableFunctionExpr<[T, ...Args], T>, options?: PartRunner): MutationDraft<Args>;
  /**
   * A body writing through an `edit` capability, `(state, ...args, edit) => null`
   * — the lazy write, for a Dict or Set record. It reads the state lazily, so a
   * body that looks at ten entries of a two-million-entry record decodes the
   * segments those ten live in, and writes through `edit.set(key, value)`,
   * `edit.delete(key)` and `edit.update(key, patch)`, so its commit rewrites only
   * the segments it touched. Repeated edits of one key fold; a `set` of the
   * value the record already holds is no change; a `delete` or `update` of a key
   * the record does not hold is a conflict naming the key. Its last parameter is
   * the capability, `e3.mutation.editType(type)` of the record's type.
   *
   * @param fn - The body
   * @param options - Its runner
   * @returns The mutation
   * @throws {Error} When the record is not a Dict or a Set, the body is async or calls a platform function, its first
   *   parameter is not the record's state or its last the capability, or it does not return Null
   */
  edit<Args extends EastType[], E extends EastType>(
    fn: FunctionExpr<[T, ...Args, E], NullType> | CallableFunctionExpr<[T, ...Args, E], NullType>, options?: PartRunner,
  ): MutationDraft<Args>;
  /**
   * The door for a patch a client computed, for a Dict or Set record: no body,
   * its argument the change, a `PatchType` of the state — what `Record.bind`
   * writes an interactive edit through, and what an integration sending diffs
   * calls. On a record with no index, a patch of per-key changes is the delta
   * itself and no program runs, so its cost is independent of the record's size;
   * any other patch runs a program that checks it against the state, and on a
   * record with indexes computes the entries the change moves.
   *
   * @param options - Its runner
   * @returns The mutation
   * @throws {Error} When the record is not a Dict or a Set
   */
  patch(options?: PartRunner): MutationDraft<[PatchTypeOf<T>]>;
}

/**
 * The `migration` builder a record declared whole hands its `migrations`: the
 * step forms, each named, the list's order its chain.
 *
 * A deploy runs the steps a workspace has not applied, in order, a
 * `$migrate:<name>` commit each, and records each by its name, so a step keeps
 * its identity when its code moves or its package is re-exported. Each step
 * takes the record as the step before it leaves it, and the last leaves it as
 * its declared type. Each function is pure, synchronous East, as a mutation's
 * is: a step runs again in every workspace that has not applied it, a piece at a
 * time, and must migrate every one the same way.
 *
 * @example
 * ```ts
 * const RowV1Type = StructType({ title: StringType });
 * const RowV2Type = StructType({ title: StringType, owner: StringType });
 * const plans = e3.record('plans', DictType(StringType, RowV2Type), {
 *   initial: new Map(),
 *   migrations: (migration) => [
 *     // Each row gains an owner; the keys are unchanged.
 *     migration.rows('add_owner', East.function([StringType, RowV1Type], RowV2Type,
 *       ($, id, row) => ({ title: row.title, owner: 'unassigned' }))),
 *   ],
 * });
 * ```
 */
export interface MigrationBuilder {
  /**
   * A step over the whole state, `(Old) => New`, for a record of any type. It
   * runs as one unit whose runner opens the state lazily, so a step that reads
   * little of a large record costs little, and one that rebuilds it costs the
   * record.
   *
   * @param name - The step: an identifier, unique on the record, by which a workspace records it has applied it
   * @param fn - The step's function
   * @param options - Its runner
   * @returns The step
   * @throws {Error} When the name is not an identifier, the function is async, calls a platform function or takes
   *   other than the one state, or the step before it leaves the record as another type than `Old`
   */
  value<From extends EastType, To extends EastType>(name: string, fn: FunctionExpr<[From], To> | CallableFunctionExpr<[From], To>, options?: PartRunner): MigrationDraft;
  /**
   * A step over an Array's elements, `(T1) => T2`, in order: a task split over
   * the stored state, so a record of any size migrates a piece at a time, in
   * parallel, each piece cached.
   *
   * @param name - The step
   * @param fn - The step's function
   * @param options - Its runner
   * @returns The step
   * @throws {Error} As {@link value} does
   */
  rows<E1 extends EastType, E2 extends EastType>(name: string, fn: FunctionExpr<[E1], E2> | CallableFunctionExpr<[E1], E2>, options?: PartRunner): MigrationDraft;
  /**
   * A step over a Dict's rows, `(K, V1) => V2`, its keys unchanged, a piece at a
   * time, as an Array's elements are.
   *
   * @param name - The step
   * @param fn - The step's function
   * @param options - Its runner
   * @returns The step
   * @throws {Error} As {@link value} does
   */
  rows<K extends EastType, V1 extends EastType, V2 extends EastType>(
    name: string, fn: FunctionExpr<[K, V1], V2> | CallableFunctionExpr<[K, V1], V2>, options?: PartRunner,
  ): MigrationDraft;
  /**
   * A step re-keying a Set's elements, `(T1) => T2`: two landing on one are one
   * element, as in any Set, and nothing is lost.
   *
   * @param name - The step
   * @param fn - The step's function
   * @param options - Its runner
   * @returns The step
   * @throws {Error} As {@link value} does
   */
  rekey<E1 extends EastType, E2 extends EastType>(name: string, fn: FunctionExpr<[E1], E2> | CallableFunctionExpr<[E1], E2>, options?: PartRunner): MigrationDraft;
  /**
   * A step re-keying a Dict's entries, `(K1, V1) => { key: K2, value: V2 }`: the
   * task {@link rows} runs, its pieces' outputs merged by key. Two rows landing
   * on one key fail the deploy, naming it, since their values may differ and
   * neither can be chosen.
   *
   * @param name - The step
   * @param fn - The step's function
   * @param options - Its runner
   * @returns The step
   * @throws {Error} As {@link value} does, and when the function returns other than `{ key, value }` or the new key is
   *   not a type a key may be
   */
  rekey<K1 extends EastType, V1 extends EastType, K2 extends EastType, V2 extends EastType>(
    name: string,
    fn: FunctionExpr<[K1, V1], StructType<{ key: K2; value: V2 }>> | CallableFunctionExpr<[K1, V1], StructType<{ key: K2; value: V2 }>>,
    options?: PartRunner,
  ): MigrationDraft;
}

/**
 * A record's indexes as declared, by name: each the index its builder made,
 * named by its key.
 *
 * @typeParam I - What `indexes` returned
 * @typeParam T - The record's state type
 */
export type IndexesOf<I, T extends EastType> = {
  readonly [K in keyof I & string]: I[K] extends IndexDraft<infer IK, infer P, infer On, infer Extra> ? RecordIndexDef<K, T, IK, P, On> & Extra : never
};

/**
 * A record's mutations as declared, by name: each the mutation its builder
 * made, named by its key.
 *
 * @typeParam M - What `mutations` returned
 * @typeParam T - The record's state type
 */
export type MutationsOf<M, T extends EastType> = {
  readonly [K in keyof M & string]: M[K] extends MutationDraft<infer A extends EastType[]> ? MutationDef<K, T, A> : never
};

/** The `index` builder: each method a draft `e3.record` builds under its key. */
export const INDEX_BUILDER = {
  on: plainForm('on'),
  key: plainForm('key'),
  keys: plainForm('keys'),
  interval: (spec: unknown, options?: unknown) => indexDraft('index.interval', options, (where, record, name) =>
    intervalDefinition(where, name, record, spec as Parameters<typeof intervalDefinition>[3], runnerOf(options))),
  area: (spec: unknown, options?: unknown) => indexDraft('index.area', options, (where, record, name) =>
    areaDefinition(where, name, record, spec as Parameters<typeof areaDefinition>[3], runnerOf(options))),
  series: (spec: unknown, options?: unknown) => indexDraft('index.series', options, (where, record, name) => {
    if (typeof spec === 'object' && spec !== null && 'collections' in spec) {
      throw new Error(`${where} '${name}' takes key, from, to and tile — collections are a nested series index's: index.nested({ collections, tile, summary? })`);
    }
    return seriesDefinition(where, name, record, spec as Parameters<typeof seriesDefinition>[3], runnerOf(options));
  }),
  nested: Object.assign(
    (spec: unknown, options?: unknown) => indexDraft('index.nested', options, (where, record, name) =>
      nestedDefinition(where, name, record, spec as object, runnerOf(options))),
    { items, values, rows, recursive },
  ),
  summary: (spec: unknown, options?: unknown) => indexDraft('index.summary', options, (where, record, name) =>
    summaryDefinition(where, name, record, spec as Parameters<typeof summaryDefinition>[3], runnerOf(options))),
};

/** The `mutation` builder: each method a draft `e3.record` builds under its key. */
export const MUTATION_BUILDER = {
  reduce: (fn: IndexFunction, options?: unknown) => mutationDraft('mutation.reduce', options, (where, record, name) =>
    reduceDefinition(where, name, record, fn, runnerOf(options))),
  edit: (fn: IndexFunction, options?: unknown) => mutationDraft('mutation.edit', options, (where, record, name) =>
    editDefinition(where, name, record, fn, runnerOf(options))),
  patch: (options?: unknown) => mutationDraft('mutation.patch', options, (where, record, name) =>
    patchDefinition(where, name, record, runnerOf(options))),
};

/** The `migration` builder: each method a step `e3.record` builds in its place. */
export const MIGRATION_BUILDER = {
  value: stepForm('value'),
  rows: stepForm('rows'),
  rekey: stepForm('rekey'),
};

/** A refusal's subject: the builder, on its record. */
function wordsOf(record: RecordDef, builder: string): string {
  return `e3.record '${record.name}': ${builder}`;
}

/** Refuses options a builder does not take, naming those it does. */
function checkOptions(where: string, name: string, options: unknown, allowed: readonly string[]): void {
  if (options === undefined) return;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new Error(`${where} '${name}' takes its options as an object, { ${allowed.join(', ')} }`);
  }
  const extra = Object.keys(options).filter((option) => !allowed.includes(option));
  if (extra.length > 0) throw new Error(`${where} '${name}' takes ${allowed.join(' and ')}, not ${extra.join(', ')}`);
}

/** A part's runner selection, from the options its builder was given. */
function runnerOf(options: unknown): { runner?: FunctionRunner } | undefined {
  const runner = (options as PartRunner | undefined)?.runner;
  return runner === undefined ? undefined : { runner };
}

/** An index draft, its options checked as it is built. */
function indexDraft(
  builder: string, options: unknown, build: (where: string, record: RecordDef, name: string) => RecordIndexDef,
): IndexDraft {
  return {
    [RECORD_PART]: {
      part: 'index',
      build: (record, name) => {
        const where = wordsOf(record, builder);
        checkOptions(where, name, options, builder === 'index.on' || builder === 'index.key' || builder === 'index.keys' ? ['value', 'runner'] : ['runner']);
        return build(where, record, name);
      },
    },
  };
}

/** A plain index's builder: by row fields, a key function, or a keys function. */
function plainForm(form: 'on' | 'key' | 'keys') {
  return (by: unknown, options?: unknown): IndexDraft => indexDraft(`index.${form}`, options, (where, record, name) => {
    if (form === 'on' && !Array.isArray(by)) {
      throw new Error(`${where} '${name}' takes the row fields leading it as a list, as index.on(['site'])`);
    }
    const value = (options as PlainIndexOptions | undefined)?.value;
    return plainDefinition(where, name, record, { [form]: by, ...(value !== undefined && { value }) }, runnerOf(options));
  });
}

/** A mutation draft, its options checked as it is built. */
function mutationDraft(
  builder: string, options: unknown, build: (where: string, record: RecordDef, name: string) => MutationDef,
): MutationDraft {
  return {
    [RECORD_PART]: {
      part: 'mutation',
      build: (record, name) => {
        const where = wordsOf(record, builder);
        checkOptions(where, name, options, ['runner']);
        return build(where, record, name);
      },
    },
  };
}

/** A migration step's builder in a form: the step named, its place in the list its chain. */
function stepForm(form: 'value' | 'rows' | 'rekey') {
  return (name: string, fn: IndexFunction, options?: unknown): MigrationDraft => ({
    [RECORD_PART]: {
      part: 'migration',
      build: (record, previous) => {
        const where = wordsOf(record, `migration.${form}`);
        checkOptions(where, name, options, ['runner']);
        return stepDefinition(where, form, name, record, fn, runnerOf(options), previous);
      },
    },
  });
}
