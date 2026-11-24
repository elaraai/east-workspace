/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The nested series index's declaration (#1434): one a record,
 * `index.nestedSeries({ collections, tile, summary, totals })` among its indexes, whose
 * `collections` declares every collection the record's rows nest, each
 * field with a builder saying what it holds — things people drag (`items`), a
 * value per instant (`values`), child rows (`rows`), or more rows of the row's
 * own type (`recursive`).
 *
 * This module holds the builders, what TypeScript checks of a declaration from
 * the record's type alone, and the declaration checked at run time into its
 * groups of nodes ({@link NestedDeclaration}), refusing in words what does not
 * fit. The East programs a checked declaration builds are
 * `record-nested-programs.ts`'s.
 *
 * @packageDocumentation
 */
import {
  DateTimeType, VariantType, isTypeEqual, printType, printTypeSummary, variant,
  type ArrayType, type DictType, type EastType, type OptionType, type RecursiveType, type RecursiveTypeMarker, type RefType,
  type SetType, type StructType,
} from '@elaraai/east';
import { NestedIdType, nestedIdCase, type NestedSpanKeyType, type RecordNestedDecl, type RecordRollup, type RecordSummaryTotalsType } from '@elaraai/e3-types';
import { optionField, type OptionField, type RowType } from './record-keys.js';
import type { RecordTile } from './record-tiles.js';
import type { RecordIndexDef } from './types.js';

// ── The builders ──────────────────────────────────────────────────────────────

/** Marks a {@link SeriesItems} declaration. */
const ITEMS: unique symbol = Symbol('SeriesItems');
/** Marks a {@link SeriesValues} declaration. */
const VALUES: unique symbol = Symbol('SeriesValues');
/** Marks a {@link SeriesRows} declaration. */
const ROWS: unique symbol = Symbol('SeriesRows');
/** Marks a {@link SeriesRecursive} declaration. */
const RECURSIVE: unique symbol = Symbol('SeriesRecursive');
/** Marks a {@link Misfit}, which no value carries. */
const MISFIT: unique symbol = Symbol('SeriesMisfit');

/** The options of {@link items}. */
export interface SeriesItemsOptions {
  /** Filed under every ancestor row too, for a parent's bands. */
  readonly rollup?: true;
}

/** The options of {@link values}. */
export interface SeriesValuesOptions {
  /** How a parent's subtotal of it is composed: one rollup, or several. */
  readonly rollup?: SeriesRollupInput | readonly SeriesRollupInput[];
}

/** How a leaf's values in a tile fold. */
export type SeriesFoldLiteral = 'sum' | 'mean' | 'min' | 'max' | 'last' | 'count';

/** How a parent aggregates its children's folded values. */
export type SeriesAggregateLiteral = 'sum' | 'mean' | 'min' | 'max';

/**
 * A rollup: one name for the same fold and aggregate (`"sum"`, `"mean"`,
 * `"min"`, `"max"`); `"count"`, the leaf rows beneath that hold a value; or the
 * fold and the aggregate named apart, as a balance's `{ fold: "last",
 * aggregate: "sum" }`.
 */
export type SeriesRollupInput =
  | 'sum' | 'mean' | 'min' | 'max' | 'count'
  | { readonly fold: SeriesFoldLiteral; readonly aggregate: SeriesAggregateLiteral };

/** A collection of things people drag, its items' times named (see {@link items}). */
export interface SeriesItems<T = unknown, O extends SeriesItemsOptions = SeriesItemsOptions> {
  readonly [ITEMS]: { readonly times: T; readonly options: O };
}

/** A collection of values, one per instant (see {@link values}). */
export interface SeriesValues<O extends SeriesValuesOptions = SeriesValuesOptions> {
  readonly [VALUES]: { readonly options: O };
}

/** A collection of child rows (see {@link rows}). */
export interface SeriesRows<C = unknown> {
  readonly [ROWS]: { readonly collections: C };
}

/** More rows of the listing row's own type (see {@link recursive}). */
export interface SeriesRecursive {
  readonly [RECURSIVE]: true;
}

/**
 * Declares a collection of things people drag: a Dict keyed by an id — of any
 * type a Dict is keyed by but a DateTime (#1540) — its items' times the fields
 * named.
 *
 * @typeParam T - The times, as written, their field names kept as literal types
 * @typeParam O - The options, as written
 * @param times - `{ from, to }`: its items' start and end fields, each a DateTime or an Option of one — an item with
 *   no start is filed nowhere; one with no end, or an end at or before its start, is an instant. `{ at }`: its items'
 *   instant field.
 * @param options - `rollup: true`: each item is filed under every ancestor row too, so a parent reads its subtree's items
 *   in one range a level (its bands), and e3 keeps each subtree's totals a tile at a time, at each period the index
 *   keeps its nodes' totals at
 * @returns The declaration, for its field in `collections`
 */
export function items<
  const T extends { readonly from: string; readonly to: string } | { readonly at: string },
  const O extends SeriesItemsOptions = { readonly rollup?: undefined },
>(times: T, options?: O): SeriesItems<T, O> {
  return { [ITEMS]: { times, options: options ?? ({} as O) } };
}

/**
 * Declares a collection of values, one per instant: a Dict keyed by a
 * DateTime, its key the instant.
 *
 * @typeParam O - The options, as written
 * @param options - `rollup`: how a parent's subtotal of it is composed — e3 keeps every parent's, at every level from
 *   the index's tile up; one rollup, or several where several series aggregate it differently
 * @returns The declaration, for its field in `collections`
 */
export function values<const O extends SeriesValuesOptions = { readonly rollup?: undefined }>(options?: O): SeriesValues<O> {
  return { [VALUES]: { options: options ?? ({} as O) } };
}

/**
 * Declares a collection of child rows: a Dict keyed by an id — of any type a
 * Dict is keyed by but a DateTime (#1540) — holding rows whose own collections
 * are declared the same way. Child rows that nest nothing in time declare none
 * (`rows({})`): the index names them, their keys among its ids, and files
 * nothing of them.
 *
 * @typeParam C - The child rows' collections, as written
 * @param collections - Each collection field of the child row, declared with a builder of `index.nestedSeries`; `{}` for
 *   child rows that hold none
 * @returns The declaration, for its field in `collections`
 */
export function rows<const C>(collections: C): SeriesRows<C> {
  return { [ROWS]: { collections } };
}

/**
 * Declares a collection of more rows of the listing row's own type, to any
 * depth: they hold what it holds, declared once.
 *
 * @returns The declaration, for its field in `collections`
 */
export function recursive(): SeriesRecursive {
  return { [RECURSIVE]: true };
}

// ── What TypeScript checks, from the record's type alone ─────────────────────

/** A recursive node's type one level deeper: each self reference replaced by the node (as East expands it). */
type ExpandOnce<T, Node> =
  T extends RefType<infer U> ? RefType<ExpandOnce<U, Node>> :
  T extends ArrayType<infer U> ? ArrayType<ExpandOnce<U, Node>> :
  T extends SetType<infer U> ? SetType<ExpandOnce<U, Node>> :
  T extends DictType<infer K, infer V> ? DictType<ExpandOnce<K, Node>, ExpandOnce<V, Node>> :
  T extends StructType<infer Fields> ? StructType<{ [K in keyof Fields]: ExpandOnce<Fields[K], Node> }> :
  T extends VariantType<infer Cases> ? VariantType<{ [K in keyof Cases]: ExpandOnce<Cases[K], Node> }> :
  T extends RecursiveTypeMarker ? Node :
  T;

/** A row's fields, a recursive node's expanded once. */
type StructFields<V> =
  V extends RecursiveType<infer U> ? (ExpandOnce<U, V> extends StructType<infer F> ? F : never)
  : V extends StructType<infer F> ? F : never;

/** A Dict field of a row: a collection it may nest. */
export type DictField<V> = {
  [F in keyof StructFields<V> & string]: StructFields<V>[F] extends DictType<EastType, EastType> ? F : never
}[keyof StructFields<V> & string];

/** An item's fields holding a time: a DateTime, or an Option of one. */
export type ItemTimeField<I> = {
  [F in keyof StructFields<I> & string]: StructFields<I>[F] extends DateTimeType | OptionType<DateTimeType> ? F : never
}[keyof StructFields<I> & string];

/** The times an item of `I` may name. */
export type SeriesTimes<I> =
  | { readonly from: ItemTimeField<I>; readonly to: ItemTimeField<I> }
  | { readonly at: ItemTimeField<I> };

/** Where a builder does not fit its field: a type whose one property says what to write. */
export interface Misfit<Words extends string> {
  readonly [MISFIT]: Words;
}

/**
 * What field `F` of a row may be declared as, its type `V`, in a row whose own
 * type is `Self`: the builders that fit it, and, where a plain error would be
 * cryptic, a {@link Misfit} saying what does.
 */
export type SeriesCollectionFor<F extends string, V, Self> =
  V extends DictType<DateTimeType, EastType>
    ? SeriesValues
      | Misfit<`'${F}' is keyed by its instant: declare it with values()`>
  : V extends DictType<EastType, infer I>
    ? ([I] extends [Self] ? SeriesRecursive : never)
      | ([StructFields<I>] extends [never]
          ? Misfit<`'${F}' holds no struct rows: things people drag and child rows are a Dict<K, Struct> keyed by an id`>
          : SeriesItems<SeriesTimes<I>> | SeriesRows<SeriesCollections<I, I>>
            | Misfit<`'${F}' is keyed by an id: declare it with items({ from, to }), items({ at }) or rows({ … })`>)
  : Misfit<`'${F}' is not a Dict: a collection is a Dict<K, Item> keyed by an id, or a Dict<DateTime, V> keyed by its instant`>;

/** The collections a row of type `V` nests, each by its field; `Self` is the type of the row listing them. */
export type SeriesCollections<V, Self = V> = {
  readonly [F in DictField<V>]?: SeriesCollectionFor<F, StructFields<V>[F], Self>;
};

/** A field's Dict's value type: an item, a value, or a child row. */
export type ChildOf<V, F> = F extends keyof StructFields<V> ? (StructFields<V>[F] extends DictType<EastType, infer I> ? I : never) : never;

/** A field's Dict's key type: what an entries index files each of its entries under (#1521). */
export type DictKeyOf<V, F> =
  F extends keyof StructFields<V> ? (StructFields<V>[F] extends DictType<infer K extends EastType, EastType> ? K : never) : never;

/** A field's Dict's value type: what each of an entries index's entries carries (#1521). */
export type DictValueOf<V, F> =
  F extends keyof StructFields<V> ? (StructFields<V>[F] extends DictType<EastType, infer P extends EastType> ? P : never) : never;

/**
 * The item types a declaration files, as a variant nesting as it nests: an
 * items or a values collection its item type, a child rows' collection a
 * variant of its own; a recursive field adds no case — its rows hold what the
 * row listing them holds.
 */
export type PlacesOf<V, C> = VariantType<{
  [F in keyof C & string as C[F] extends SeriesRecursive ? never : F]:
    C[F] extends SeriesRows<infer C2> ? PlacesOf<ChildOf<V, F>, C2> : ChildOf<V, F>;
}>;

/**
 * What a nested series index's definition carries for its binding (#1435): its
 * collections and its tile as written, the periods its nodes' totals and the
 * record's totals are kept at, its declaration as an East value, the field
 * names as data, and its span typed as the index it is.
 */
export interface NestedOf<S> {
  readonly collections: S extends { collections: infer C } ? C : never;
  readonly tile: S extends { tile: infer T extends RecordTile } ? T : RecordTile;
  /** The periods each node's totals are kept at, finest first: those `summary` names, and none where it names none. */
  readonly summary: S extends { summary: readonly (infer U extends RecordTile)[] } ? readonly U[] : readonly never[];
  /** The periods the record's totals are kept at, finest first: those `totals` names, or a month, a quarter and a year. */
  readonly totals: S extends { totals: readonly (infer U extends RecordTile)[] } ? readonly U[] : readonly ('month' | 'quarter' | 'year')[];
  readonly declaration: RecordNestedDecl;
  /** Its span (#1438): the record's totals, each collection's tiles at each period across the record's rows, keyed
   *  `{ collection, level, tile }` and summed as a summary's totals are. */
  readonly span: RecordIndexDef<string, EastType, typeof NestedSpanKeyType, typeof RecordSummaryTotalsType, readonly string[] | undefined>
    & { readonly span: { readonly of: string; readonly tiles: readonly RecordTile[]; readonly touched: { toIR(): unknown } } };
}

// ── The declaration, checked ──────────────────────────────────────────────────

/** A collection of things people drag, checked against its field. */
export interface NestedItems {
  readonly kind: 'items';
  /** The field holding it on its group's nodes. */
  readonly field: string;
  /** Its place: the field names from the row down to it, a recursive step adding none. */
  readonly place: readonly string[];
  /** The group of nodes holding it. */
  readonly group: number;
  /** Its Dict's key type: its items' ids' (#1540). */
  readonly keyType: EastType;
  /** The case its items' ids are under among the index's ids (`nestedIdCase` of its place). */
  readonly idCase: string;
  /** Its items' struct. */
  readonly itemType: RowType;
  /** The field its items start at. */
  readonly start: OptionField<DateTimeType>;
  /** The field they end at: the start's again for `items({ at })`, whose items are instants. */
  readonly end: OptionField<DateTimeType>;
  /** Whether each item is filed under every ancestor too. */
  readonly rollup: boolean;
}

/** A collection of values, one per instant, checked against its field. */
export interface NestedValues {
  readonly kind: 'values';
  /** The field holding it on its group's nodes. */
  readonly field: string;
  /** Its place: the field names from the row down to it, a recursive step adding none. */
  readonly place: readonly string[];
  /** The group of nodes holding it. */
  readonly group: number;
  /** Its values' type. */
  readonly valueType: EastType;
  /** Its values' kind where they are numbers, whose totals and subtotals are kept: `undefined` for any other. */
  readonly numeric: 'Float' | 'Integer' | undefined;
  /** The rollups every parent's subtotals are kept by, in the order declared. */
  readonly rollups: readonly RecordRollup[];
}

/** A collection a row's tree files. */
export type NestedCollection = NestedItems | NestedValues;

/**
 * A group of a row's nodes: the row itself, or the child rows one `rows(…)`
 * declares — beside `recursive()`, with every row beneath them through it.
 * Every node of a group has the group's type and declaration.
 */
export interface NestedGroup {
  /** Its place among the groups: the row's is 0. */
  readonly index: number;
  /** Its nodes' type: the record's row, or a child row's — a Struct, or a RecursiveType of one. */
  readonly type: EastType;
  /** The group whose nodes hold its nodes, and the field they hold them in; none for the row's. */
  readonly parent: { readonly group: number; readonly field: string } | undefined;
  /**
   * What its nodes are keyed by beneath the node holding them (#1540): their Dict's key type, and the case their keys
   * are under among the index's ids (`nestedIdCase` of their field's place); none for the row's, which the record keys.
   */
  readonly keyed: { readonly type: EastType; readonly idCase: string } | undefined;
  /** The field through which a node holds more nodes of the group, beside `recursive()`; none without. */
  readonly through: string | undefined;
  /** Its nodes' own collections. */
  readonly collections: readonly NestedCollection[];
  /** The groups its nodes' child rows make, each with the field holding them. */
  readonly rows: readonly { readonly field: string; readonly group: number }[];
  /** The variant of the items it and the groups beneath it file, nesting as they nest. */
  readonly places: EastType;
}

/** A checked declaration: its groups, the row's first and each after its parent; its collections; and its East value. */
export interface NestedDeclaration {
  readonly groups: readonly NestedGroup[];
  /** Every group's collections, in group order. */
  readonly collections: readonly NestedCollection[];
  /** The declaration as an East value, the field names as data. */
  readonly declaration: RecordNestedDecl;
  /** The variant of the items the row's tree files: the row's group's. */
  readonly places: EastType;
  /**
   * The index's ids (#1540, e3-types' `NestedIdType`): a case for each collection of child rows and of items, by its
   * place, holding its Dict's key type — what an entry's key holds a child row's key and an item's id as.
   */
  readonly idType: VariantType<Record<string, EastType>>;
}

/** A node's struct: the type itself, or a recursive node's struct. */
function nodeStruct(type: EastType): RowType | undefined {
  const node = type.type === 'Recursive' ? type.node : type;
  return node.type === 'Struct' ? node : undefined;
}

/** Each fold a rollup may name, as an index keeps it. */
const FOLDS: Readonly<Record<SeriesFoldLiteral, RecordRollup['fold']>> = {
  sum: variant('sum', null), mean: variant('mean', null), min: variant('min', null),
  max: variant('max', null), last: variant('last', null), count: variant('count', null),
};

/** Each aggregate a rollup may name, as an index keeps it; `count` is written as the rollup `"count"` alone. */
const AGGREGATES: Readonly<Record<SeriesAggregateLiteral, RecordRollup['aggregate']>> = {
  sum: variant('sum', null), mean: variant('mean', null), min: variant('min', null), max: variant('max', null),
};

/** Whether a name is a key of a table. */
function isKeyOf<T extends object>(table: T, name: unknown): name is keyof T & string {
  return typeof name === 'string' && Object.hasOwn(table, name);
}

/**
 * A rollup's words, as a refusal names it: one name where the fold is the
 * aggregate, else both.
 *
 * @param rollup - The rollup, as an index keeps it
 * @returns Its words, as a declaration writes it
 */
export function rollupWords(rollup: RecordRollup): string {
  const fold = rollup.fold.type;
  const aggregate = rollup.aggregate.type;
  return fold === aggregate ? fold : `{ fold: '${fold}', aggregate: '${aggregate}' }`;
}

/** A value as written, as a refusal names it. */
function writtenWords(input: unknown): string {
  if (typeof input === 'string') return `"${input}"`;
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return `{ ${Object.entries(input).map(([key, value]) => `${key}: ${writtenWords(value)}`).join(', ')} }`;
  }
  return String(input);
}

/**
 * A rollup as an index keeps it, from one as written, refused in words where
 * it is none.
 *
 * @param where - What names the rollup, for the refusal
 * @param input - The rollup as written: a name, or `{ fold, aggregate }`
 * @returns The rollup
 * @throws {Error} When `input` is no rollup, naming what one is
 */
export function rollupOf(where: string, input: unknown): RecordRollup {
  if (input === 'count') return { fold: FOLDS.count, aggregate: variant('count', null) };
  if (isKeyOf(AGGREGATES, input)) return { fold: FOLDS[input], aggregate: AGGREGATES[input] };
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const { fold, aggregate } = input as { readonly fold?: unknown; readonly aggregate?: unknown };
    if (aggregate === 'count' && isKeyOf(FOLDS, fold)) {
      throw new Error(`${where} rolls up by { fold: '${fold}', aggregate: 'count' } — a count counts the leaf rows with a value, ` +
        'whatever they fold to: write rollup: "count"');
    }
    if (isKeyOf(FOLDS, fold) && isKeyOf(AGGREGATES, aggregate)) return { fold: FOLDS[fold], aggregate: AGGREGATES[aggregate] };
  }
  throw new Error(`${where} rolls up by ${writtenWords(input)}, which is no rollup — a rollup is "sum", "mean", "min", "max", ` +
    '"count", or { fold, aggregate }');
}

/** What a refusal says of a rollup declared where no row is a parent of the collection's rows. */
const NO_PARENT = 'no row of the index is a parent of its rows — a rollup is a parent\'s subtotal of its children\'s: ' +
  'declare it on a collection under rows(…) or beside recursive()';

/** A declaration's builder, by its brand; undefined for a value no builder made. */
function builderOf(given: unknown): 'items' | 'values' | 'rows' | 'recursive' | undefined {
  if (typeof given !== 'object' || given === null) return undefined;
  if (ITEMS in given) return 'items';
  if (VALUES in given) return 'values';
  if (ROWS in given) return 'rows';
  if (RECURSIVE in given) return 'recursive';
  return undefined;
}

/**
 * Checks a declaration against the record's row and builds its groups,
 * refusing in words what TypeScript refuses as it is written — for a
 * declaration TypeScript could not see, such as plain JavaScript or a spec
 * built at run time.
 *
 * @param constructor - The declaration, for the refusals
 * @param name - The index, for the refusals
 * @param rowType - The record's row type
 * @param collections - The `collections` as written
 * @returns The groups, their collections, the declaration as an East value, and the places
 * @throws {Error} Naming the collection and what to write
 */
export function checkNested(constructor: string, name: string, rowType: EastType, collections: unknown): NestedDeclaration {
  const prefix = `${constructor} '${name}'`;
  const groups: NestedGroup[] = [];
  // How many groups have taken their place: a group takes its own before its child groups take theirs.
  let placed = 0;
  // The index's ids: each collection of child rows and of items, by its place's case, and its Dict's key type.
  const ids: Record<string, EastType> = {};
  // A collection keyed by an id takes its case of the index's ids: its place's field names joined, none holding a '.'.
  const idCaseOf = (at: string, field: string, place: readonly string[], keyType: EastType): string => {
    if (field.includes('.')) {
      throw new Error(`${prefix} ${at} is '${field}' — an index names its child rows and items by their place, its field names joined by '.': ` +
        'name the field without one');
    }
    const idCase = nestedIdCase(place);
    ids[idCase] = keyType;
    return idCase;
  };

  // A group: its nodes' type, the group above it, what its nodes are keyed by, and its declaration as written; its
  // child groups follow it.
  const groupOf = (
    where: string, place: readonly string[], type: EastType, parent: NestedGroup['parent'], keyed: NestedGroup['keyed'], declared: unknown,
  ): { group: NestedGroup; declaration: RecordNestedDecl } => {
    const struct = nodeStruct(type);
    if (struct === undefined) throw new Error(`${prefix} indexes a record with Struct rows`);
    const written = typeof declared === 'object' && declared !== null && !Array.isArray(declared);
    // Child rows may declare none (`rows({})`): rows that nest nothing in time. The index itself declares one at least.
    const bare = written && Object.keys(declared).length === 0 && parent !== undefined;
    if (!written || (Object.keys(declared).length === 0 && !bare)) {
      throw new Error(`${prefix} ${where} declares no collection`);
    }
    const index = placed++;
    const root = parent === undefined;
    const own: NestedCollection[] = [];
    const childRows: { field: string; group: number }[] = [];
    const recursiveFields: string[] = [];
    const declaration = new Map<string, RecordNestedDecl extends Map<string, infer D> ? D : never>();
    const caseTypes: Record<string, EastType> = {};
    for (const field of Object.keys(declared).sort()) {
      const at = `${where}.${field}`;
      const given: unknown = (declared as Record<string, unknown>)[field];
      const fieldType = struct.fields[field];
      if (fieldType === undefined) throw new Error(`${prefix} ${where} names unknown row field '${field}'`);
      const builder = builderOf(given);
      if (builder === undefined) {
        throw new Error(`${prefix} ${at} is no declaration — declare it with index.nestedSeries.items(times), values(), rows(collections) or recursive()`);
      }
      if (fieldType.type !== 'Dict') {
        throw new Error(`${prefix} ${at} is '${field}', of type ${printType(fieldType)} — a collection is a Dict: Dict<K, Item> keyed by an id, ` +
          'or Dict<DateTime, V> keyed by its instant');
      }
      const keyType = fieldType.key;
      const held = fieldType.value;
      if (builder === 'recursive') {
        if (type.type !== 'Recursive' || !isTypeEqual(held, type)) {
          throw new Error(`${prefix} ${at} is recursive(), and holds ${printTypeSummary(held)}, not ${printTypeSummary(type)} — ` +
            'a recursive field holds more rows like the one listing it');
        }
        // The rows beneath are keyed as the rows listing them are: one path of keys of one type (#1540).
        if (keyed !== undefined && !isTypeEqual(keyType, keyed.type)) {
          throw new Error(`${prefix} ${at} is recursive(), and '${field}' is keyed by ${printType(keyType)}, where the rows listing it are keyed by ` +
            `${printType(keyed.type)} — rows that recurse are keyed by one type all the way down`);
        }
        recursiveFields.push(field);
        declaration.set(field, variant('recursive', null));
        continue;
      }
      if (builder === 'values') {
        if (keyType.type !== 'DateTime') {
          throw new Error(`${prefix} ${at} is values(), and '${field}' is keyed by ${printType(keyType)} — values are keyed by their instant: ` +
            'declare it with items({ from, to }) or items({ at })');
        }
        const written = (given as SeriesValues)[VALUES].options.rollup;
        const rollups: RecordRollup[] = [];
        for (const input of written === undefined ? [] : Array.isArray(written) ? written : [written]) {
          const rollup = rollupOf(`${prefix} ${at}`, input);
          if (rollups.some((r) => rollupWords(r) === rollupWords(rollup))) {
            throw new Error(`${prefix} ${at} rolls up by ${rollupWords(rollup)} twice — name each rollup once`);
          }
          rollups.push(rollup);
        }
        const numeric = held.type === 'Float' || held.type === 'Integer' ? held.type : undefined;
        if (rollups.length > 0 && root) throw new Error(`${prefix} ${at} rolls up, and ${NO_PARENT}`);
        if (rollups.length > 0 && numeric === undefined) {
          throw new Error(`${prefix} ${at} rolls up, and '${field}' holds ${printType(held)} — a rollup folds Float or Integer values`);
        }
        own.push({ kind: 'values', field, place: [...place, field], group: index, valueType: held, numeric, rollups });
        declaration.set(field, variant('values', { rollups }));
        caseTypes[field] = held;
        continue;
      }
      const words = builder === 'items' ? 'items(…)' : 'rows(…)';
      if (keyType.type === 'DateTime') {
        throw new Error(`${prefix} ${at} is ${words}, and '${field}' is keyed by ${printType(keyType)} — a collection keyed by its instant ` +
          'holds values: declare it with values()');
      }
      // An id of any type a Dict is keyed by (#1540): the key holds it as it is.
      if (nodeStruct(held) === undefined) {
        throw new Error(`${prefix} ${at} is ${words}, and '${field}' holds ${printType(held)} — items and child rows are a Dict<K, Struct> keyed by an id`);
      }
      const idCase = idCaseOf(at, field, [...place, field], keyType);
      if (builder === 'rows') {
        const child = groupOf(at, [...place, field], held, { group: index, field }, { type: keyType, idCase }, (given as SeriesRows)[ROWS].collections);
        childRows.push({ field, group: child.group.index });
        declaration.set(field, variant('rows', child.declaration));
        caseTypes[field] = child.group.places;
        continue;
      }
      // Things people drag: an item's struct, read for its times.
      if (held.type !== 'Struct') {
        throw new Error(`${prefix} ${at} is items(…), and '${field}' holds ${printType(held)} — items and child rows are a Dict<K, Struct> keyed by an id`);
      }
      const { times, options } = (given as SeriesItems)[ITEMS] as { times: Readonly<Record<string, unknown>>; options: SeriesItemsOptions };
      const timeOf = (role: 'from' | 'to' | 'at'): OptionField<DateTimeType> => {
        const named = times[role];
        if (typeof named !== 'string') throw new Error(`${prefix} ${at} times names no ${role}`);
        const fieldOfItem = held.fields[named];
        if (fieldOfItem === undefined) throw new Error(`${prefix} ${at} times ${role} '${named}', which is no field of the ${field}`);
        const time = optionField(held, named, DateTimeType);
        if (time === undefined) {
          throw new Error(`${prefix} ${at} times ${role} '${named}', of type ${printType(fieldOfItem)} — a time is a DateTime or an Option<DateTime> field of the item`);
        }
        return time;
      };
      const span = 'from' in times || 'to' in times;
      const start = timeOf(span ? 'from' : 'at');
      const end = span ? timeOf('to') : start;
      if (options.rollup !== undefined && options.rollup !== true) {
        throw new Error(`${prefix} ${at} rolls up by ${writtenWords(options.rollup)} — items roll up with rollup: true`);
      }
      const rollup = options.rollup === true;
      if (rollup && root) throw new Error(`${prefix} ${at} rolls up, and ${NO_PARENT}`);
      own.push({ kind: 'items', field, place: [...place, field], group: index, keyType, idCase, itemType: held, start, end, rollup });
      declaration.set(field, variant('items', {
        times: span ? variant('span', { from: start.field, to: end.field }) : variant('at', start.field),
        rollup,
      }));
      caseTypes[field] = held;
    }
    if (recursiveFields.length > 1) {
      throw new Error(`${prefix} ${where} declares recursive() on '${recursiveFields[0]}' and '${recursiveFields[1]}' — ` +
        'a row\'s rows recurse through one field, so each holds one path');
    }
    if (Object.keys(caseTypes).length === 0 && !bare) throw new Error(`${prefix} ${where} declares no collection`);
    const group: NestedGroup = {
      index, type, parent, keyed, through: recursiveFields[0], collections: own, rows: childRows, places: VariantType(caseTypes),
    };
    groups[index] = group;
    return { group, declaration };
  };

  const root = groupOf('collections', [], rowType, undefined, undefined, collections);
  return {
    groups,
    collections: groups.flatMap((group) => group.collections),
    declaration: root.declaration,
    places: root.group.places,
    idType: NestedIdType(ids),
  };
}
