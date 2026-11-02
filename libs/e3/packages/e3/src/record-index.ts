/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Secondary index definitions for e3 records.
 *
 * A record is paged and searched in its primary key order and nothing else.
 * The views over a planning record have more than one order — by status, by
 * the resources a plan consumes, by time across every plan — and only the ones
 * contiguous in primary order are addressable without scanning it. An index
 * closes that gap without a new storage structure: it is a second canonical
 * collection whose sort order IS the query order, stored as a segment manifest
 * exactly like the primary, maintained inside the same commit, and read with
 * the same paging machinery.
 *
 * The functions are pure for the reason a reducer is: they run again on every
 * commit and in every bulk build, and a maintained index must equal a rebuilt
 * one to the byte.
 */

import type { DateTimeType, DictType, EastType, Expr, FloatType, FunctionType, IntegerType, OptionType, SetType, StructType, VariantType } from '@elaraai/east';
import { NullType } from '@elaraai/east';
import type { NestedEntryKeyType, RecordLevelType, RecordNestedTotalsType } from '@elaraai/e3-types';
import type { RecordDef, RecordIndexDef } from './types.js';
import type { PlacesOf, SeriesCollections } from './record-nested.js';
import type { RecordTile } from './record-tiles.js';
import { indexFunctions, indexedEntry } from './record-guards.js';
import type { IndexConstructor, IndexFunction } from './record-guards.js';
import { checkLeading, fieldKeyOf } from './record-keys.js';
import type { FunctionRunner } from './runner.js';

export type { IndexFunction } from './record-guards.js';

/** The own fields of a Dict record's struct row. */
type RowFields<T> = T extends DictType<unknown, StructType<infer F>> ? F : Record<never, never>;
/** A Dict record's row type. */
type RowOf<T> = T extends DictType<unknown, infer V extends EastType> ? V : EastType;
/** A Dict record's key type. */
type KeyOf<T> = T extends DictType<infer K extends EastType, unknown> ? K : EastType;
/** A Set field indexes its elements; every other field indexes its value. */
type FieldKey<T> = T extends SetType<infer K extends EastType> ? K : T extends EastType ? T : never;
/**
 * The row fields an index declaration is led by: its `on` fields — a plain
 * index's, or a generated index's leading fields, its key's `on` (#1432) — and
 * none for a generated index that lists none; undefined for a computed key.
 * A generated index's own parts are the definition's `interval`, `area`,
 * `series` or `summary`, never names among these.
 *
 * @typeParam S - The index spec as written
 */
export type IndexOn<S> =
  S extends { on: infer On extends readonly string[] } ? On
  : S extends { cell: number } | { tile: string } | { from: string; to: string } ? readonly []
  : undefined;
/** A row field an interval index may start or end at: a DateTime, or an Option of one. */
type IntervalField<T> = { [F in keyof RowFields<T>]: RowFields<T>[F] extends DateTimeType | OptionType<DateTimeType> ? F : never }[keyof RowFields<T>] & string;
/** A row field an area index may place a box by: a Float, or an Option of one. */
type PlaceField<T> = { [F in keyof RowFields<T>]: RowFields<T>[F] extends FloatType | OptionType<FloatType> ? F : never }[keyof RowFields<T>] & string;
/** A row field an area index may size a box by: a Float. */
type FloatField<T> = { [F in keyof RowFields<T>]: RowFields<T>[F] extends FloatType ? F : never }[keyof RowFields<T>] & string;
/** A row field a series or summary index files events under: any but a Set. */
type KeyField<T> = { [F in keyof RowFields<T>]: RowFields<T>[F] extends SetType<unknown> ? never : F }[keyof RowFields<T>] & string;
/**
 * A generated index's leading fields, by name, at their key types: the fields
 * of its key's `on` (#1432). The fields, never the struct, so a definition's
 * declared type names `StructType` of them, which a package's declarations
 * can print.
 */
type LeadingFields<S, T> = S extends { on: infer On extends readonly (keyof RowFields<T> & string)[] }
  ? { [F in On[number]]: FieldKey<RowFields<T>[F]> } : Record<never, never>;

/**
 * What an interval index keys on (`index.interval`): the events
 * overlapping a half-open time window, carry-in events among them, without
 * day fan-out or duration lookbacks.
 *
 * @typeParam T - The owning record's state type
 */
export interface IntervalIndexSpec<T extends EastType = EastType> {
  /** Exact leading fields before the interval. Set fields fan out. */
  on?: readonly (keyof RowFields<T> & string)[];
  /** The field an event starts at: a DateTime, or an Option of one, whose
   *  `none` is the backlog, selectable as Unset. */
  from: IntervalField<T>;
  /** The field it ends at; a missing or non-positive end is an instant. */
  to: IntervalField<T>;
  /** Refused: an interval index carries no projection. */
  value?: never;
}

/**
 * What an area index keys on (`index.area`): the rows whose box meets
 * a window, each filed once, by a box its fields name. It carries the whole row
 * as its projection, so a window reads the index alone.
 *
 * @typeParam T - The owning record's state type
 */
export interface AreaIndexSpec<T extends EastType = EastType> {
  /** Exact leading fields before the area. Set fields fan out. */
  on?: readonly (keyof RowFields<T> & string)[];
  /** The box's `x`: a Float field, or an Option<Float> one whose `none` is unplaced. */
  x: PlaceField<T>;
  /** The box's `y`: a Float field, or an Option<Float> one, as `x` is. */
  y: PlaceField<T>;
  /** The box's width, a Float field; with `height`, or neither for a point. */
  width?: FloatField<T>;
  /** The box's height, a Float field; with `width`, or neither for a point. */
  height?: FloatField<T>;
  /** Whether `x`, `y` is the box's minimum corner (the default, as a zone's) or its centre (as an item's). */
  at?: 'corner' | 'centre';
  /** The finest cell's side in world units, about the smallest thing drawn: 0.01
   *  for a floor in metres, 1 for one in millimetres. Rounded down to a power of
   *  two, so the keys' arithmetic is exact on every runtime. It has no default:
   *  a wrong one costs a silent tenfold read. */
  cell: number;
  /** Refused: an area index carries the whole row as its projection. */
  value?: never;
}

/**
 * What a series index files a record's events by (`index.series`,
 * #1039): the key an event is on — a Plan's resource — and its time, each
 * event filed once at the level its length fits (#1433), so a key's events
 * over any span are one range a level.
 *
 * @typeParam T - The owning record's state type
 */
export interface SeriesIndexSpec<T extends EastType = EastType> {
  /** Exact leading fields before the key. Set fields fan out. */
  on?: readonly (keyof RowFields<T> & string)[];
  /** The field naming what an event is on — a Plan's resource: any field but a Set. */
  key: KeyField<T>;
  /** The field an event starts at: a DateTime, or an Option of one; a row
   *  with none is in no tile, and not in the index. */
  from: IntervalField<T>;
  /** The field it ends at; a missing one, or one at or before the start, is an instant. */
  to: IntervalField<T>;
  /** The finest level an event is filed at: `day`, `week` (ISO, from Monday), `month`, `quarter` or `year`, in UTC.
   *  An event is filed at it, or at the coarser level its length fits. */
  tile: RecordTile;
  /** Refused: a series index carries the whole row as its projection. */
  value?: never;
}

/**
 * What the nested form of a series index files (#1434): every collection a
 * record's rows nest, each declared with a builder of `index.nested`,
 * typed against its field from the record's type alone.
 *
 * @typeParam T - The owning record's state type (a Dict of Struct rows)
 */
export interface NestedSeriesIndexSpec<T extends EastType = EastType> {
  /** The collections a row nests, each by its field ({@link SeriesCollections}). */
  collections: SeriesCollections<RowOf<T>>;
  /** The finest level an item is filed at, and the finest a parent's subtotals are kept at: `day`, `week` (ISO, from
   *  Monday), `month`, `quarter` or `year`, in UTC. */
  tile: RecordTile;
  /** The tile each node's totals are kept by; omitted, none are kept. */
  summary?: RecordTile;
  /** Refused: the key form's fields, beside `collections`. */
  key?: never;
  /** Refused: the key form's fields, beside `collections`. */
  from?: never;
  /** Refused: the key form's fields, beside `collections`. */
  to?: never;
  /** Refused: no field leads a nested index. */
  on?: never;
  /** Refused: each entry carries its own item, totals or subtotal. */
  value?: never;
}

/** A nested series index's entry key, at the record's key type (e3-types' `NestedEntryKeyType`). */
export type NestedKeyOf<T extends EastType> = ReturnType<typeof NestedEntryKeyType<KeyOf<T>>>;

/** A nested series index's entry value (e3-types' `NestedEntryType`), its items' variant nesting as `S` declares. */
export type NestedValueOf<T extends EastType, S extends NestedSeriesIndexSpec<T>> =
  VariantType<{ item: PlacesOf<RowOf<T>, S['collections']>; totals: typeof RecordNestedTotalsType; subtotal: FloatType }>;

/**
 * What a summary index totals a record's events by (`index.summary`,
 * #1039): the same key and tiles as a series index, and under each key how
 * many rows touch its tile and the milliseconds of it they cover.
 *
 * @typeParam T - The owning record's state type
 */
export interface SummaryIndexSpec<T extends EastType = EastType> {
  /** Exact leading fields before the key. Set fields fan out. */
  on?: readonly (keyof RowFields<T> & string)[];
  /** The field naming what an event is on — a Plan's resource: any field but a Set. */
  key: KeyField<T>;
  /** The field an event starts at: a DateTime, or an Option of one; a row
   *  with none is in no tile, and counts in none. */
  from: IntervalField<T>;
  /** The field it ends at; a missing one, or one at or before the start, is an instant. */
  to: IntervalField<T>;
  /** The tile: `day`, `week` (ISO, from Monday), `month`, `quarter` or `year`, in UTC. */
  tile: RecordTile;
  /** Refused: a summary index holds its totals. */
  value?: never;
}

/** The type an East function returns, read off the expression itself. */
type OutputOf<F> = F extends Expr<FunctionType<unknown[], infer O>> ? (O extends EastType ? O : EastType) : EastType;

/**
 * The index key a spec declares (#1432): a generated index's row fields under
 * `on` and e3's own parts beside them — an area index's `{ on, area }`, a
 * series index's `{ on, key, level, tile }` (#1433), an interval index's
 * `{ on, node, at }` — or a plain index's row fields, `key`'s return, or the
 * element of the Set `keys` returns. A summary index's spec is a series
 * index's; its key is {@link SummaryKeyOf}.
 *
 * @typeParam S - The index spec as written
 * @typeParam T - The owning record's state type, for field indexes
 *
 * @remarks
 * Read off the spec the caller actually wrote, so the factory's parameter
 * keeps the weak {@link IndexFunction} shape the inline callbacks need while
 * its result carries the precise key type — which is what types a window read
 * through the index, and so every component that renders one.
 */
export type IndexKeyOf<S, T extends EastType = EastType> =
  S extends { cell: number }
    ? StructType<{ on: StructType<LeadingFields<S, T>>; area: IntegerType }>
  : S extends { tile: string; key: infer KF extends keyof RowFields<T> & string }
    ? StructType<{ on: StructType<LeadingFields<S, T>>; key: RowFields<T>[KF]; level: RecordLevelType; tile: DateTimeType }>
  : S extends { from: infer F extends keyof RowFields<T> & string; to: string }
    ? StructType<{ on: StructType<LeadingFields<S, T>>; node: IntegerType; at: RowFields<T>[F] }>
  : S extends { on: readonly [infer F extends keyof RowFields<T>] } ? FieldKey<RowFields<T>[F]>
  : S extends { on: infer On extends readonly (keyof RowFields<T> & string)[] }
    ? number extends On['length'] ? EastType : StructType<{ [K in On[number]]: FieldKey<RowFields<T>[K]> }>
  : S extends { key: infer F } ? OutputOf<F>
  : S extends { keys: infer F } ? (OutputOf<F> extends SetType<infer IK extends EastType> ? IK : EastType)
  : EastType;

/**
 * A summary index's key (#1433): `{ on, key, tile }`, its leading fields under
 * `on`, then the key's value and the start of the tile it totals — the key
 * before the tile, so a key's totals over a span of tiles are one range.
 *
 * @typeParam S - The summary's spec as written
 * @typeParam T - The owning record's state type
 */
export type SummaryKeyOf<S, T extends EastType = EastType> =
  S extends { key: infer KF extends keyof RowFields<T> & string }
    ? StructType<{ on: StructType<LeadingFields<S, T>>; key: RowFields<T>[KF]; tile: DateTimeType }>
    : EastType;

/** The covering projection a spec declares: `value`'s return, Null when the
 *  spec has no `value`, and any type when it only might. */
export type ProjectionOf<S> =
  S extends { value: infer F } ? OutputOf<F>
  : 'value' extends keyof S ? EastType
  : NullType;

/**
 * A plain index's key function, from exactly one of `on` — row fields, whose
 * key function is generated — `key` or `keys`.
 *
 * @param constructor - The declaration, for the refusals
 * @param name - The index, for the refusals
 * @param keyType - The record's key type
 * @param valueType - The record's row type
 * @param spec - The declaration
 * @returns The key function, and whether it returns a Set of keys
 * @throws {Error} When the declaration gives none of them or more than one, or `on` names no field of the row's
 */
function plainKey(
  constructor: IndexConstructor, name: string, keyType: EastType, valueType: EastType,
  spec: { readonly on?: readonly string[]; readonly key?: IndexFunction; readonly keys?: IndexFunction },
): { keyFn: IndexFunction; multi: boolean } {
  const { on, key, keys } = spec;
  if (on !== undefined && key === undefined && keys === undefined) {
    if (valueType.type !== 'Struct') throw new Error(`${constructor} '${name}' on requires a record with Struct rows`);
    if (on.length === 0) throw new Error(`${constructor} '${name}' on requires at least one field`);
    const leading = checkLeading(constructor, name, valueType, on);
    return { keyFn: fieldKeyOf(keyType, valueType, leading), multi: leading.multi };
  }
  if (key !== undefined && on === undefined && keys === undefined) return { keyFn: key, multi: false };
  if (keys !== undefined && on === undefined && key === undefined) return { keyFn: keys, multi: true };
  throw new Error(
    `${constructor} '${name}' takes exactly one of 'key' (one entry per row) ` +
    `or 'keys' (one per element of a returned Set), or 'on' (row fields)`,
  );
}

/**
 * Builds a plain index's definition: its key from `on`, `key` or `keys`, and
 * its projection from `value`, each checked as every index's functions are.
 *
 * @param constructor - The declaration, as a refusal names it
 * @param name - The index
 * @param rec - Its record
 * @param spec - Exactly one of `on`, `key` and `keys`, and an optional `value`
 * @param config - Its runner selection
 * @returns The definition
 * @throws {Error} When the spec gives none of `on`, `key` and `keys` or more than one, or on any guard every index applies
 */
export function plainDefinition(
  constructor: IndexConstructor, name: string, rec: RecordDef,
  spec: { readonly on?: readonly string[]; readonly key?: IndexFunction; readonly keys?: IndexFunction; readonly value?: IndexFunction },
  config: { runner?: FunctionRunner } | undefined,
): RecordIndexDef {
  const { keyType, valueType } = indexedEntry(constructor, name, rec);
  const { keyFn, multi } = plainKey(constructor, name, keyType, valueType, spec);
  const { runner, indexKeyType, projectionType } = indexFunctions(constructor, name, keyType, valueType, keyFn, multi, spec.value, config);
  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: spec.on === undefined ? undefined : Object.freeze([...spec.on]),
    keyFn,
    ...(spec.value !== undefined && { valueFn: spec.value }),
    multi,
    keyType: indexKeyType,
    valueType: projectionType ?? NullType,
    runner,
  };
}

/** The box an area index declares, as its definition carries it, `cell` rounded to its power of two. */
export interface AreaIndexOf<S> {
  /** The field holding the box's `x`. */
  readonly x: S extends { x: infer X extends string } ? X : string;
  /** The field holding the box's `y`. */
  readonly y: S extends { y: infer Y extends string } ? Y : string;
  /** The field holding its width; absent for a point. */
  readonly width?: string;
  /** The field holding its height; absent for a point. */
  readonly height?: string;
  /** Whether `x`, `y` is the box's minimum corner or its centre. */
  readonly at: 'corner' | 'centre';
  /** The finest cell's side in world units: the declared `cell`, rounded down to a power of two. */
  readonly cell: number;
}

/** The fields and tile a series or summary index files by, as its definition carries them. */
export interface TimeTileOf<S> {
  /** The field naming what an event is on. */
  readonly key: S extends { key: infer K extends string } ? K : string;
  /** The field an event starts at. */
  readonly from: S extends { from: infer F extends string } ? F : string;
  /** The field it ends at. */
  readonly to: S extends { to: infer F extends string } ? F : string;
  /** The tile. */
  readonly tile: RecordTile;
}
