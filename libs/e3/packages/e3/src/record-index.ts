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

import type { DateTimeType, DictType, EastType, FloatType, FunctionExpr, IntegerType, OptionType } from '@elaraai/east';
import { East, Expr, NullType, SetType, StructType, printType } from '@elaraai/east';
import { RecordSummaryTotalsType } from '@elaraai/e3-types';
import type { RecordDef, RecordIndexDef } from './types.js';
import { intervalKey } from './record-interval.js';
import { AREA_FIELD, areaCellExponent, areaKey } from './record-area.js';
import { TILE_FIELD, seriesKeys, summaryContributions } from './record-series.js';
import { checkTile, type RecordTile } from './record-tiles.js';
import { checkPure, sameEastType } from './record-guards.js';
import { DEFAULT_RUNNER, runnerToVariant, type FunctionRunner } from './runner.js';

/** The index name reserved for the record's own collection wherever an index
 *  is selected — a page, a key search, an arm of the mutation delta. */
const RESERVED_INDEX_NAME = 'primary';

/**
 * What an index declaration needs of a function: a way to reach its IR, and
 * through that its signature.
 *
 * @remarks
 * Deliberately the weakest shape that works, because a stronger one silently
 * breaks the authored surface. An index reads
 * `key: East.function([K, V], IK, ($, k, v) => …)` written INLINE in the spec,
 * and `East.function` infers its callback's parameters from its own first
 * argument — but only if nothing is imposed on it from outside. Both a
 * callable contextual type (`FunctionExpr<any, any>`) and a generic return
 * type here (`toIR(): EastIR<any, any>`) make TypeScript infer against the
 * expected type instead, and the body's `k` and `v` come out as the union of
 * every expression class. `unknown` imposes nothing; the guards below read the
 * signature at run time regardless.
 */
export interface IndexFunction {
  /** The function's IR bundle, as `EastIR` or `AsyncEastIR`. */
  toIR(): unknown;
}

/** The own fields of a Dict record's struct row. */
type RowFields<T> = T extends DictType<any, StructType<infer F>> ? F : Record<never, never>;
/** A Dict record's row type. */
type RowOf<T> = T extends DictType<any, infer V extends EastType> ? V : EastType;
/** A Set field indexes its elements; every other field indexes its value. */
type FieldKey<T> = T extends SetType<infer K extends EastType> ? K : T extends EastType ? T : never;
/**
 * The field names an index declaration orders by: its `on` fields, an interval
 * index's leading fields then its start, an area index's leading fields then
 * `__area`, a series or summary index's leading fields then `__tile` and its
 * key; undefined for a computed key.
 *
 * @typeParam S - The index spec as written
 */
export type IndexOn<S> = S extends { cell: number }
  ? S extends { on: infer On extends readonly string[] } ? readonly [...On, '__area'] : readonly ['__area']
  : S extends { tile: string; key: infer K extends string }
    ? S extends { on: infer On extends readonly string[] } ? readonly [...On, '__tile', K] : readonly ['__tile', K]
  : S extends { from: infer F extends string; to: string }
    ? S extends { on: infer On extends readonly string[] } ? readonly [...On, F] : readonly [F]
  : S extends { on: infer On extends readonly string[] } ? On : undefined;
/** A row field an interval index may start or end at: a DateTime, or an Option of one. */
type IntervalField<T> = { [F in keyof RowFields<T>]: RowFields<T>[F] extends DateTimeType | OptionType<DateTimeType> ? F : never }[keyof RowFields<T>] & string;
/** A row field an area index may place a box by: a Float, or an Option of one. */
type PlaceField<T> = { [F in keyof RowFields<T>]: RowFields<T>[F] extends FloatType | OptionType<FloatType> ? F : never }[keyof RowFields<T>] & string;
/** A row field an area index may size a box by: a Float. */
type FloatField<T> = { [F in keyof RowFields<T>]: RowFields<T>[F] extends FloatType ? F : never }[keyof RowFields<T>] & string;
/** A row field a series or summary index files events under: any but a Set. */
type KeyField<T> = { [F in keyof RowFields<T>]: RowFields<T>[F] extends SetType<any> ? never : F }[keyof RowFields<T>] & string;
/** A generated index's exact leading fields, by name, as its key holds them. */
type LeadingKey<S, T> = S extends { on: infer On extends readonly (keyof RowFields<T> & string)[] }
  ? { [F in On[number]]: FieldKey<RowFields<T>[F]> } : Record<never, never>;

/** What a plain index keys on: `on` (row fields), `key` (one computed entry
 *  per row), or `keys` (one per Set element), and an optional covering
 *  projection. An index that answers more than an order has a constructor of
 *  its own: {@link IntervalIndexSpec}, {@link AreaIndexSpec}.
 *  @typeParam T - The owning record's state type
 */
export type RecordIndexSpec<T extends EastType = EastType> = {
  /** Row fields in index order. One field uses its value as the key; several
   *  use a struct in this order. Set fields fan out over their elements. */
  on?: readonly (keyof RowFields<T> & string)[];
  /** `(K, V) -> IK` — one index entry per row. */
  key?: IndexFunction;
  /** `(K, V) -> Set<IK>` — one index entry per element, so a row that names
   *  five resources appears under five keys. An empty set is a row the index
   *  does not carry, which is how a partial index is written. */
  keys?: IndexFunction;
  /** `(K, V) -> P` — the fields a view renders from the index alone, so it
   *  never touches the primary's segments. */
  value?: IndexFunction;
  /** Refused: an interval index has a constructor of its own,
   *  `e3.recordIndex.interval(name, record, { on?, from, to })`. */
  interval?: never;
};

/**
 * What an interval index keys on (`e3.recordIndex.interval`): the events
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
 * What an area index keys on (`e3.recordIndex.area`): the rows whose box meets
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
 * What a series index files a record's events by (`e3.recordIndex.series`,
 * #1039): the key an event is on — a Plan's resource — and the time tiles it
 * touches, so the events of a block of keys over a span of tiles are a few
 * contiguous ranges, a range a tile.
 *
 * @typeParam T - The owning record's state type
 */
export interface SeriesIndexSpec<T extends EastType = EastType> {
  /** Exact leading fields before the tile. Set fields fan out. */
  on?: readonly (keyof RowFields<T> & string)[];
  /** The field naming what an event is on — a Plan's resource: any field but a Set. */
  key: KeyField<T>;
  /** The field an event starts at: a DateTime, or an Option of one; a row
   *  with none is in no tile, and not in the index. */
  from: IntervalField<T>;
  /** The field it ends at; a missing one, or one at or before the start, is an instant. */
  to: IntervalField<T>;
  /** The tile: `day`, `week` (ISO, from Monday), `month`, `quarter` or `year`, in UTC. */
  tile: RecordTile;
  /** Refused: a series index carries the whole row as its projection. */
  value?: never;
}

/**
 * What a summary index totals a record's events by (`e3.recordIndex.summary`,
 * #1039): the same key and tiles as a series index, and under each key how
 * many rows touch its tile and the milliseconds of it they cover.
 *
 * @typeParam T - The owning record's state type
 */
export interface SummaryIndexSpec<T extends EastType = EastType> {
  /** Exact leading fields before the tile. Set fields fan out. */
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
type OutputOf<F> = F extends FunctionExpr<any, infer O> ? (O extends EastType ? O : EastType) : EastType;

/**
 * The index key a spec declares: an area index's leading fields and `__area`,
 * an interval index's leading fields, `__interval` and its start, a plain
 * index's row fields, `key`'s return, or the element of the Set `keys`
 * returns.
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
    ? StructType<LeadingKey<S, T> & { __area: IntegerType }>
  : S extends { tile: string; key: infer KF extends keyof RowFields<T> & string }
    ? StructType<LeadingKey<S, T> & { __tile: DateTimeType } & { [K in KF]: RowFields<T>[K] }>
  : S extends { from: infer F extends keyof RowFields<T> & string; to: string }
    ? StructType<LeadingKey<S, T> & { __interval: IntegerType } & { [K in F]: RowFields<T>[K] }>
  : S extends { on: readonly [infer F extends keyof RowFields<T>] } ? FieldKey<RowFields<T>[F]>
  : S extends { on: infer On extends readonly (keyof RowFields<T> & string)[] }
    ? number extends On['length'] ? EastType : StructType<{ [K in On[number]]: FieldKey<RowFields<T>[K]> }>
  : S extends { key: infer F } ? OutputOf<F>
  : S extends { keys: infer F } ? (OutputOf<F> extends SetType<infer IK> ? IK : EastType)
  : EastType;

/** The covering projection a spec declares: `value`'s return, Null when the
 *  spec has no `value`, and any type when it only might. */
export type ProjectionOf<S> =
  S extends { value: infer F } ? OutputOf<F>
  : 'value' extends keyof S ? EastType
  : NullType;

/** Generate a pure key function from a field declaration. The normal index
 *  build and mutation programs call it exactly as they call an authored key. */
function fieldKey(name: string, keyType: EastType, valueType: EastType, on: readonly string[]): { fn: IndexFunction; multi: boolean } {
  const rowType = valueType as StructType<Record<string, EastType>>;
  if (rowType.type !== 'Struct') throw new Error(`e3.recordIndex '${name}' on requires a record with Struct rows`);
  if (on.length === 0) throw new Error(`e3.recordIndex '${name}' on requires at least one field`);
  if (new Set(on).size !== on.length) throw new Error(`e3.recordIndex '${name}' on must not repeat a field`);
  const fields = on.map((field) => {
    if (!Object.hasOwn(rowType.fields, field)) throw new Error(`e3.recordIndex '${name}' on names unknown row field '${field}'`);
    const type = rowType.fields[field]!;
    const set = (type as SetType).type === 'Set';
    return { field, type: set ? (type as SetType).key : type, set };
  });
  const indexType = fields.length === 1 ? fields[0]!.type : StructType(Object.fromEntries(fields.map((f) => [f.field, f.type])));
  const multi = fields.some((f) => f.set);
  const output = multi ? SetType(indexType) : indexType;
  // Types are checked above; the row's dynamic field names are erased only
  // inside this generated East body, as in record-programs.ts.
  const fn = East.function([keyType as never, rowType], output as never, ($: any, _key: any, row: any) => {
    if (fields.length === 1) return row[fields[0]!.field];
    if (!multi) return Object.fromEntries(fields.map((f) => [f.field, row[f.field]]));
    const keys = $.let(new Set(), SetType(indexType));
    const append = ($: any, at: number, values: Record<string, unknown>): void => {
      const field = fields[at];
      if (field === undefined) { $(keys.insert(values)); return; }
      if (field.set) {
        $.for(row[field.field], ($: any, element: any) => append($, at + 1, { ...values, [field.field]: element }));
      } else append($, at + 1, { ...values, [field.field]: row[field.field] });
    };
    append($, 0, {});
    return keys;
  });
  return { fn, multi };
}

/** The signature of a function an index declares, as the guards see it. */
function signatureOf(fn: IndexFunction): { inputs: EastType[]; output: EastType } {
  return Expr.type(fn as unknown as Expr<any>) as { inputs: EastType[]; output: EastType };
}

/** Why an index function may be neither async nor reach a platform function:
 *  either makes the index non-deterministic, and an index that does not equal
 *  its rebuild is worse than no index, since the view it serves is quietly
 *  wrong. */
const INDEX_PURITY = {
  async: 'an async function implies platform IO, and an index is rebuilt from the record whenever it is dropped or its declaration changes.',
  platform: 'the index is maintained on every commit and rebuilt on demand, so a platform call makes the two disagree.',
};

/** Refuses an index function whose parameters are not the record's entry. */
function checkEntryParams(name: string, role: string, keyType: EastType, valueType: EastType, inputs: EastType[]): void {
  if (inputs.length !== 2 || !sameEastType(keyType, inputs[0]!) || !sameEastType(valueType, inputs[1]!)) {
    const got = inputs.length === 0 ? 'no parameters' : inputs.map((t) => printType(t)).join(', ');
    throw new Error(
      `e3.recordIndex '${name}' ${role} must take the record's entry ` +
      `(${printType(keyType)}, ${printType(valueType)}), but got ${got}.`,
    );
  }
}

/** The constructor a refusal names. */
type Constructor = 'e3.recordIndex' | 'e3.recordIndex.interval' | 'e3.recordIndex.area' | 'e3.recordIndex.series' | 'e3.recordIndex.summary';

/**
 * A record's entry types, once an index's name and its record pass: a name that
 * is an identifier, never `primary`, declared once on the record, over a Dict
 * record.
 *
 * Every guard here is a definition-time error rather than a deploy failure.
 */
function indexedEntry(constructor: Constructor, name: string, rec: RecordDef): { keyType: EastType; valueType: EastType } {
  if (!name) {
    throw new Error(`${constructor} requires a non-empty name`);
  }
  if (name === RESERVED_INDEX_NAME) {
    throw new Error(
      `${constructor} cannot be named '${RESERVED_INDEX_NAME}' — that name is the ` +
      `record's own collection wherever an index is selected.`,
    );
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `${constructor} '${name}' must be an identifier — it names a query ` +
      `selector in URLs and on the command line.`,
    );
  }
  // An assembled record — a package's `records.plans` — carries its indexes
  // already; a bare one is checked when `e3.package` folds indexes onto it.
  if (rec.indexes[name] !== undefined) {
    throw new Error(`${constructor} '${name}' is already declared on record '${rec.name}'`);
  }
  const recordType = rec.type as unknown as { type: string; key: EastType; value: EastType };
  if (recordType.type !== 'Dict') {
    throw new Error(
      `${constructor} '${name}' indexes a Dict record — '${rec.name}' holds ` +
      `${printType(rec.type)}, which has no (key, value) entry to index. A Set or ` +
      `Array record is read in its own order only.`,
    );
  }
  return { keyType: recordType.key, valueType: recordType.value };
}

/** Refuses an option a constructor does not take, naming those it does. */
function onlyOptions(constructor: Constructor, name: string, spec: object, options: readonly string[], instead?: string): void {
  const extra = Object.keys(spec).filter((option) => !options.includes(option));
  if (extra.length === 0) return;
  throw new Error(
    `${constructor} '${name}' takes ${options.join(', ')}, not ${extra.join(', ')}` + (instead === undefined ? '' : ` — ${instead}`),
  );
}

/**
 * An index's key and projection functions, checked as every constructor checks
 * them: pure, over the record's entry, a `keys` function returning a Set.
 *
 * @returns The runner, and the index key and projection types the functions declare
 */
function indexFunctions(
  name: string, keyType: EastType, valueType: EastType,
  keyFn: IndexFunction, multi: boolean, valueFn: IndexFunction | undefined, config: { runner?: FunctionRunner } | undefined,
): { runner: FunctionRunner; indexKeyType: EastType; projectionType: EastType } {
  const runner = config?.runner ?? DEFAULT_RUNNER;
  // Validate eagerly so a bad runner fails at definition time, not export time.
  runnerToVariant(runner);

  checkPure(`e3.recordIndex '${name}' ${multi ? "'keys' function" : "'key' function"}`, keyFn, INDEX_PURITY);
  const keySig = signatureOf(keyFn);
  checkEntryParams(name, multi ? "'keys' function" : "'key' function", keyType, valueType, keySig.inputs);

  let indexKeyType = keySig.output;
  if (multi) {
    const returned = keySig.output as unknown as { type: string; key: EastType };
    if (returned.type !== 'Set') {
      throw new Error(
        `e3.recordIndex '${name}' declared with 'keys' must return a Set of index ` +
        `keys — one entry per element — but returns ${printType(keySig.output)}. ` +
        `For one entry per row use 'key'.`,
      );
    }
    indexKeyType = returned.key;
  }

  let projectionType: EastType = NullType;
  if (valueFn !== undefined) {
    checkPure(`e3.recordIndex '${name}' 'value' projection`, valueFn, INDEX_PURITY);
    const valueSig = signatureOf(valueFn);
    checkEntryParams(name, "'value' projection", keyType, valueType, valueSig.inputs);
    projectionType = valueSig.output;
  }
  return { runner, indexKeyType, projectionType };
}

/**
 * Defines a secondary index over a record.
 *
 * The index is a collection `Dict<{ik, k}, P>` — the index key first, the
 * primary key second — so every entry sharing an index key is one contiguous
 * run ordered by primary key inside it, and a RANGE of index keys is one
 * contiguous run too. Pages and key searches take the index by name; a view
 * that renders from the index alone declares its fields as `value` and never
 * reads the primary at all.
 *
 * An index that answers more than an order has a constructor of its own:
 * {@link intervalIndex | e3.recordIndex.interval}, the events overlapping a time
 * window, and {@link areaIndex | e3.recordIndex.area}, the boxes meeting a
 * window. This one refuses `interval`, naming its constructor.
 *
 * Every guard here is a definition-time error rather than a deploy failure.
 *
 * @typeParam Name - Index name (literal type)
 * @typeParam T - The owning record's state type (a Dict)
 * @typeParam S - The spec as written, from which the index key and covering
 *   projection types are read
 * @param name - Index name: never `primary`, and one declaration per name on
 *   the record, which `e3.package` enforces when it folds indexes onto it
 * @param rec - The record to index
 * @param spec - `on`, `key` or `keys`; optional covering `value`
 * @param config - Optional runner selection (known runtimes only)
 * @returns A RecordIndexDef to pass to `e3.package`
 *
 * @example
 * ```ts
 * const plans = e3.record('plans', DictType(PlanKeyType, PlanRowType), new Map());
 *
 * // One key per row, with a covering projection: a queue renders from the
 * // index alone.
 * const byStatus = e3.recordIndex('by_status', plans, {
 *   key:   East.function([PlanKeyType, PlanRowType], StatusKeyType,
 *            ($, k, v) => ({ status: v.status, due: v.due })),
 *   value: East.function([PlanKeyType, PlanRowType], QueueCardType,
 *            ($, k, v) => ({ title: v.title, owner: v.owner })),
 * });
 *
 * // A row field supplies its own key type.
 * const byDue = e3.recordIndex('by_due', plans, { on: ['due'] });
 *
 * // Many keys per row: a Set return.
 * const byResource = e3.recordIndex('by_resource', plans, {
 *   keys: East.function([PlanKeyType, PlanRowType], SetType(ResourceRefType),
 *           ($, k, v) => v.resources),
 * });
 *
 * const pkg = e3.package('planning', '1.0.0', plans, byStatus, byDue, byResource);
 * ```
 */
function plainIndex<Name extends string, T extends EastType, const S extends RecordIndexSpec<T>>(
  name: Name,
  rec: RecordDef<T>,
  spec: S,
  config?: { runner?: FunctionRunner },
): RecordIndexDef<Name, T, IndexKeyOf<S, T>, ProjectionOf<S>, IndexOn<S>> {
  const { keyType, valueType } = indexedEntry('e3.recordIndex', name, rec);
  onlyOptions('e3.recordIndex', name, spec, ['on', 'key', 'keys', 'value'], 'interval' in spec
    ? `an interval index has a constructor of its own: e3.recordIndex.interval('${name}', record, { on?, from, to })`
    : undefined);
  if ([spec.on, spec.key, spec.keys].filter((part) => part !== undefined).length !== 1) {
    throw new Error(
      `e3.recordIndex '${name}' takes exactly one of 'key' (one entry per row) ` +
      `or 'keys' (one per element of a returned Set), or 'on' (row fields)`,
    );
  }
  const generated = spec.on === undefined ? undefined : fieldKey(name, keyType, valueType, spec.on);
  const multi = generated?.multi ?? (spec.keys !== undefined);
  const keyFn = generated?.fn ?? (spec.key ?? spec.keys)!;
  const { runner, indexKeyType, projectionType } = indexFunctions(name, keyType, valueType, keyFn, multi, spec.value, config);

  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: (spec.on === undefined ? undefined : Object.freeze([...spec.on])) as IndexOn<S>,
    keyFn,
    ...(spec.value !== undefined && { valueFn: spec.value }),
    multi,
    // The signature read above IS the type the spec's functions declare; the
    // casts only restate it at the TypeScript level.
    keyType: indexKeyType as IndexKeyOf<S, T>,
    valueType: projectionType as ProjectionOf<S>,
    runner,
  };
}

/**
 * Defines an interval index over a record: the events overlapping a half-open
 * time window `[from, to)`, carry-in events and those spanning the whole window
 * among them, each once, without day fan-out or a guessed lookback.
 *
 * It is an ordinary maintained index whose keys the SDK generates: each event
 * is filed under at most three entries a combination of its leading fields,
 * independent of its duration — a centred interval tree laid along the index's
 * key order. A record Slice reads a window through it as one start range and
 * at most 54 carry-in ranges a combination. A missing start is the backlog,
 * selectable as Unset; a missing or non-positive end is an instant.
 *
 * @typeParam Name - Index name (literal type)
 * @typeParam T - The owning record's state type (a Dict of Struct rows)
 * @typeParam S - The spec as written, from which the index key type is read
 * @param name - Index name: an identifier, never `primary`, declared once on the record
 * @param rec - The record to index
 * @param spec - `from` and `to`, the row's DateTime (or Option<DateTime>)
 *   fields an event starts and ends at, and optional exact leading `on` fields
 * @param config - Optional runner selection (known runtimes only)
 * @returns A RecordIndexDef to pass to `e3.package`, its key `{ …on, __interval, [from] }`
 * @throws {Error} When `from` or `to` is not a DateTime field, when the start or
 *   the reserved `__interval` is a leading field, or on any guard
 *   `e3.recordIndex` applies to a name and a record
 *
 * @example
 * ```ts
 * const events = e3.record('events', DictType(StringType, EventRow), new Map());
 * // The events of a window, whatever their status:
 * const byTime = e3.recordIndex.interval('by_time', events, { from: 'start', to: 'end' });
 * // A choice of statuses and the window, in one read:
 * const byStatusTime = e3.recordIndex.interval('by_status_time', events, {
 *   on: ['status'], from: 'start', to: 'end',
 * });
 * ```
 */
function intervalIndex<Name extends string, T extends EastType, const S extends IntervalIndexSpec<T>>(
  name: Name,
  rec: RecordDef<T>,
  spec: S,
  config?: { runner?: FunctionRunner },
): RecordIndexDef<Name, T, IndexKeyOf<S, T>, NullType, IndexOn<S>> & { interval: { readonly from: S['from']; readonly to: S['to'] } } {
  const { keyType, valueType } = indexedEntry('e3.recordIndex.interval', name, rec);
  onlyOptions('e3.recordIndex.interval', name, spec, ['on', 'from', 'to']);
  const prefix = spec.on === undefined ? undefined : fieldKey(name, keyType, valueType, spec.on);
  const generated = intervalKey(name, keyType, valueType, spec.on ?? [], { from: spec.from, to: spec.to }, prefix);
  const { runner, indexKeyType } = indexFunctions(name, keyType, valueType, generated.fn, generated.multi, undefined, config);

  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: Object.freeze([...(spec.on ?? []), spec.from]) as unknown as IndexOn<S>,
    interval: Object.freeze({ from: spec.from, to: spec.to }),
    keyFn: generated.fn,
    multi: generated.multi,
    keyType: indexKeyType as IndexKeyOf<S, T>,
    valueType: NullType,
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

/**
 * Defines an area index over a record: the rows whose box meets a window, each
 * once, the 2D twin of {@link intervalIndex | the interval index}.
 *
 * It is an ordinary maintained index whose keys the SDK generates: a loose
 * quadtree laid along a Z-order curve. The domain is the square
 * `[−cell·2²⁷, cell·2²⁷)` world units in 29 levels; each row is filed once,
 * under the deepest level whose cell is at least twice its box's larger side,
 * in the cell holding its box's centre, its key `{ …on, __area }`. A row whose
 * `x` or `y` is `none` is unplaced, `__area` −1; one outside the domain, not
 * finite, or larger than half the domain is filed under the root. A record Slice
 * reads a window through it as at most 266 disjoint searches a combination of
 * its leading fields, every row whose box meets the window among their rows.
 *
 * It carries its rows: each entry's projection is the whole row, so a window
 * reads the index alone and no record segment. It takes no `value`.
 *
 * @typeParam Name - Index name (literal type)
 * @typeParam T - The owning record's state type (a Dict of Struct rows)
 * @typeParam S - The spec as written, from which the index key type is read
 * @param name - Index name: an identifier, never `primary`, declared once on the record
 * @param rec - The record to index
 * @param spec - The box's fields — `x`, `y` (Float, or Option<Float> for a row
 *   that may be unplaced), `width` and `height` (Float, or neither for a point)
 *   — `at` (`"corner"`, the default, or `"centre"`), `cell` (the finest cell's
 *   side in world units, rounded down to a power of two) and optional exact
 *   leading `on` fields
 * @param config - Optional runner selection (known runtimes only)
 * @returns A RecordIndexDef to pass to `e3.package`, its key `{ …on, __area }`,
 *   its projection the row
 * @throws {Error} When a field is not of its option's type, naming the option,
 *   the field and its type; when `x` and `y` are not both Options or neither,
 *   or `width` and `height` are not given together; when `cell` is not a
 *   positive number; when the row has a field named `__area`; or on any guard
 *   `e3.recordIndex` applies to a name and a record
 *
 * @example
 * ```ts
 * const racks = e3.record('racks', DictType(StringType, RackRow), new Map());
 * // The window, whatever the rail chooses:
 * const racksByArea = e3.recordIndex.area('racks_by_area', racks, {
 *   x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01,
 * });
 * // Beside it, a choice of halls and the window in one read:
 * const racksByHallArea = e3.recordIndex.area('racks_by_hall_area', racks, {
 *   on: ['hall'], x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01,
 * });
 * ```
 */
function areaIndex<Name extends string, T extends EastType, const S extends AreaIndexSpec<T>>(
  name: Name,
  rec: RecordDef<T>,
  spec: S,
  config?: { runner?: FunctionRunner },
): RecordIndexDef<Name, T, IndexKeyOf<S, T>, RowOf<T>, IndexOn<S>> & { area: AreaIndexOf<S> } {
  const { keyType, valueType } = indexedEntry('e3.recordIndex.area', name, rec);
  onlyOptions('e3.recordIndex.area', name, spec, ['on', 'x', 'y', 'width', 'height', 'at', 'cell'],
    'value' in spec ? 'an area index carries the whole row as its projection, so it takes no value' : undefined);
  const exponent = areaCellExponent(name, spec.cell);
  const box = {
    x: spec.x, y: spec.y,
    ...(spec.width !== undefined && { width: spec.width as string }),
    ...(spec.height !== undefined && { height: spec.height as string }),
    at: spec.at ?? 'corner',
  } as const;
  const prefix = spec.on === undefined ? undefined : fieldKey(name, keyType, valueType, spec.on);
  const generated = areaKey(name, keyType, valueType, spec.on ?? [], box, exponent, prefix);
  // It carries its rows (D29): each entry's projection is the whole row, so a
  // window reads the index alone and no record segment.
  const valueFn = East.function([keyType as never, valueType as never], valueType as never, (_$: any, _key: any, row: any) => row);
  const { runner, indexKeyType, projectionType } = indexFunctions(name, keyType, valueType, generated.fn, generated.multi, valueFn, config);

  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: Object.freeze([...(spec.on ?? []), AREA_FIELD]) as unknown as IndexOn<S>,
    area: Object.freeze({ ...box, cell: 2 ** exponent }) as AreaIndexOf<S>,
    keyFn: generated.fn,
    valueFn,
    multi: generated.multi,
    keyType: indexKeyType as IndexKeyOf<S, T>,
    valueType: projectionType as RowOf<T>,
    runner,
  };
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

/**
 * Defines a series index over a record (#1039): its events filed by the key
 * they are on — a Plan's resource — and by each time tile they touch, so the
 * events of a block of keys over a tile are one contiguous range, a cell.
 *
 * It is an ordinary maintained index whose keys the SDK generates: an entry per
 * tile an event `[from, to)` overlaps, `{ …on, __tile, <key> }`, the tile its
 * start in UTC. An instant — no end, or one at or before its start — is under
 * the one tile holding it; a row with no start is under none. An event touching
 * more than 4,096 tiles is refused where it is written, naming it and the tile.
 *
 * It carries its rows: each entry's projection is the whole row, so a cell
 * reads the index alone and no record segment. It takes no `value`.
 *
 * @typeParam Name - Index name (literal type)
 * @typeParam T - The owning record's state type (a Dict of Struct rows)
 * @typeParam S - The spec as written, from which the index key type is read
 * @param name - Index name: an identifier, never `primary`, declared once on the record
 * @param rec - The record to index
 * @param spec - `key`, the field naming what an event is on (any but a Set);
 *   `from` and `to`, its DateTime (or Option<DateTime>) start and end fields;
 *   `tile`, `day`, `week`, `month`, `quarter` or `year`; and optional exact
 *   leading `on` fields
 * @param config - Optional runner selection (known runtimes only)
 * @returns A RecordIndexDef to pass to `e3.package`, its key `{ …on, __tile, <key> }`, its projection the row
 * @throws {Error} When a field is not of its option's type, naming the option,
 *   the field and its type; when the tile is not one of the five; when the row
 *   has a field named `__tile`; or on any guard `e3.recordIndex` applies to a
 *   name and a record
 *
 * @example
 * ```ts
 * const jobs = e3.record('jobs', DictType(StringType, JobRow), new Map());
 * // The jobs on each press, a week at a time:
 * const jobsByPressWeek = e3.recordIndex.series('jobs_by_press_week', jobs, {
 *   key: 'press', from: 'start', to: 'end', tile: 'week',
 * });
 * ```
 */
function seriesIndex<Name extends string, T extends EastType, const S extends SeriesIndexSpec<T>>(
  name: Name,
  rec: RecordDef<T>,
  spec: S,
  config?: { runner?: FunctionRunner },
): RecordIndexDef<Name, T, IndexKeyOf<S, T>, RowOf<T>, IndexOn<S>> & { series: TimeTileOf<S> } {
  const { keyType, valueType } = indexedEntry('e3.recordIndex.series', name, rec);
  onlyOptions('e3.recordIndex.series', name, spec, ['on', 'key', 'from', 'to', 'tile'],
    'value' in spec ? 'a series index carries the whole row as its projection, so it takes no value' : undefined);
  const fields = { key: spec.key, from: spec.from, to: spec.to, tile: checkTile('e3.recordIndex.series', name, spec.tile) };
  const prefix = spec.on === undefined ? undefined : fieldKey(name, keyType, valueType, spec.on);
  const generated = seriesKeys(name, keyType, valueType, spec.on ?? [], fields, prefix);
  // It carries its rows: each entry's projection is the whole row, so a cell
  // reads the index alone and no record segment.
  const valueFn = East.function([keyType as never, valueType as never], valueType as never, (_$: any, _key: any, row: any) => row);
  const { runner, indexKeyType, projectionType } = indexFunctions(name, keyType, valueType, generated.fn, generated.multi, valueFn, config);

  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: Object.freeze([...(spec.on ?? []), TILE_FIELD, spec.key]) as unknown as IndexOn<S>,
    series: Object.freeze(fields) as TimeTileOf<S>,
    keyFn: generated.fn,
    valueFn,
    multi: generated.multi,
    keyType: indexKeyType as IndexKeyOf<S, T>,
    valueType: projectionType as RowOf<T>,
    runner,
  };
}

/**
 * Defines a summary index over a record (#1039): under each key and time tile
 * of a series index, how many rows touch the tile and the milliseconds of it
 * they cover — what a zoomed-out view draws where its events are too many to
 * read.
 *
 * Its entries are `{ ik: { …on, __tile, <key> }, k: Null }` → `{ count, ms }`,
 * one per key a row touches, standing for every row that does. A write changes
 * them by adding what its rows took away and gave, summed — its program reads
 * the record, never the summary — and the apply drops a total whose count
 * reaches zero, so a maintained summary equals the one a reindex sums, byte for
 * byte. The totals are Integers, so the sum is exact in any order.
 *
 * An event's share of a tile is the milliseconds of it the event overlaps, and
 * its shares add up to its length; an instant counts in the tile holding it and
 * covers none of it. A row with no start counts in no tile. An event touching
 * more than 4,096 tiles is refused where it is written, naming it and the tile.
 *
 * @typeParam Name - Index name (literal type)
 * @typeParam T - The owning record's state type (a Dict of Struct rows)
 * @typeParam S - The spec as written, from which the index key type is read
 * @param name - Index name: an identifier, never `primary`, declared once on the record
 * @param rec - The record to total
 * @param spec - `key`, `from`, `to` and `tile`, as a series index takes them,
 *   and optional exact leading `on` fields
 * @param config - Optional runner selection (known runtimes only)
 * @returns A RecordIndexDef to pass to `e3.package`, its key `{ …on, __tile, <key> }`, its value the totals
 * @throws {Error} As {@link seriesIndex} does
 *
 * @example
 * ```ts
 * const jobs = e3.record('jobs', DictType(StringType, JobRow), new Map());
 * // How busy each press is, a month at a time:
 * const jobsByPressMonth = e3.recordIndex.summary('jobs_by_press_month', jobs, {
 *   key: 'press', from: 'start', to: 'end', tile: 'month',
 * });
 * ```
 */
function summaryIndex<Name extends string, T extends EastType, const S extends SummaryIndexSpec<T>>(
  name: Name,
  rec: RecordDef<T>,
  spec: S,
  config?: { runner?: FunctionRunner },
): RecordIndexDef<Name, T, IndexKeyOf<S, T>, typeof RecordSummaryTotalsType, IndexOn<S>> & { summary: TimeTileOf<S> } {
  const { keyType, valueType } = indexedEntry('e3.recordIndex.summary', name, rec);
  onlyOptions('e3.recordIndex.summary', name, spec, ['on', 'key', 'from', 'to', 'tile'],
    'value' in spec ? 'a summary index holds its totals, so it takes no value' : undefined);
  const fields = { key: spec.key, from: spec.from, to: spec.to, tile: checkTile('e3.recordIndex.summary', name, spec.tile) };
  const prefix = spec.on === undefined ? undefined : fieldKey(name, keyType, valueType, spec.on);
  const generated = summaryContributions(name, keyType, valueType, spec.on ?? [], fields, prefix);
  const runner = config?.runner ?? DEFAULT_RUNNER;
  // Validate eagerly so a bad runner fails at definition time, not export time.
  runnerToVariant(runner);
  checkPure(`e3.recordIndex.summary '${name}' contributions`, generated.fn, INDEX_PURITY);
  checkEntryParams(name, 'contributions', keyType, valueType, signatureOf(generated.fn).inputs);

  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: Object.freeze([...(spec.on ?? []), TILE_FIELD, spec.key]) as unknown as IndexOn<S>,
    summary: Object.freeze(fields) as TimeTileOf<S>,
    keyFn: generated.fn,
    // A row touches several keys, and a key stands for several rows.
    multi: true,
    keyType: generated.indexType as unknown as IndexKeyOf<S, T>,
    valueType: RecordSummaryTotalsType,
    runner,
  };
}

/**
 * Defines a secondary index over a record — `e3.recordIndex(name, record, {
 * on | key | keys, value? })`, an order to page in — and, as its own
 * constructors, the indexes that answer more than an order:
 * `e3.recordIndex.interval` (the events overlapping a time window),
 * `e3.recordIndex.area` (the boxes meeting a window), `e3.recordIndex.series`
 * (the events of a block of keys over a span of time tiles) and
 * `e3.recordIndex.summary` (their totals per key and tile).
 */
export const recordIndex = Object.assign(plainIndex, { interval: intervalIndex, area: areaIndex, series: seriesIndex, summary: summaryIndex });
