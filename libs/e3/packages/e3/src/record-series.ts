/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The keys of a series index and the contributions of a summary index (#1039):
 * a record's events filed by a key — the resource an event is on — and by time
 * (`record-tiles.ts`).
 *
 * Both lead with the exact leading fields under `on` (#1432), then the key's
 * value, so a key's entries over any span of time are one contiguous range of
 * either index (#1433):
 *
 * - **A series index** files each event once, `{ on: { …on }, key, level,
 *   tile }`: at the finest level, from its tile up, whose shortest tile holds
 *   the event's length, under the tile of that level holding its start — or,
 *   past a year, under each year it touches (`eventFilings`). A reader reads a
 *   key one range a level, whatever the span. It is an ordinary maintained
 *   index whose keys the SDK generates, each entry carrying the row — or,
 *   given a `value`, what that gives of the row (#1710): mutation, rebuild,
 *   storage and transport are the ones every index has.
 * - **A summary index** keeps, for each key and tile, how many rows touch the
 *   tile and the milliseconds of it they cover, `{ on: { …on }, key, tile }`.
 *   Its keys come from a row's contributions, `(K, V) → Dict<IK, Totals>`: the
 *   count 1 and the row's share of each tile it touches, under each
 *   (`tileShares`).
 * - **The record's totals** (`index.totals`, #1732) are a summary under no
 *   key, `{ on: { …on }, tile }`: a horizon's bars, one entry a tile however
 *   many resources the events are on.
 *
 * A series index declared `order: 'time'` (#1710) files the same entries the
 * other way about, `{ on: { …on }, level, tile, key, past }`: a tile's events
 * together, in their keys' order, so the events a run of neighbouring keys
 * hold over a span of time lie together whatever each key's history holds — a
 * board reads a screen of its rows as one range a level a tile, where filed by
 * key it reads the part of the index each row's whole history lies in. Its
 * last part, `past`, is false in every entry: a bound that gives it true lies
 * after every entry of its key, so a range reads through a last key, `to:
 * { …, key: last, past: true }`, whatever the key's type.
 *
 * A row with no start is in neither: it has no time to file it by.
 *
 * @packageDocumentation
 */
import {
  ArrayType, BooleanType, DateTimeType, DictType, East, NullType, SetType, StringType, StructType, printType, variant, withLocationCapture,
  type EastType,
} from '@elaraai/east';
import { RecordLevelType, RecordSummaryTotalsType } from '@elaraai/e3-types';
import type { RecordDef, RecordIndexDef } from './types.js';
import {
  INDEX_PURITY, checkEntryParams, checkPure, indexRunner, indexedEntry, onlyOptions, signatureOf, type IndexConstructor, type IndexFunction,
} from './record-guards.js';
import {
  checkLeading, checkTimeField, fieldReader, leadingValues, optionField, type Leading, type OptionField, type RowType,
} from './record-keys.js';
import { TILE_FNS, TileFilingType, TileShareType, checkTile, type RecordTile } from './record-tiles.js';
import { lazyBuilds } from './lazy-build.js';

/** What a series index's, a summary index's or the record's totals' declaration names (`index.flatSeries`, `index.summary`, `index.totals`). */
export interface TimeTileSpec {
  /** The exact leading fields, before the key. */
  readonly on?: readonly string[];
  /** The field naming the key the events are filed under: a Plan's resource. A series index and a summary index take
   *  one; the record's totals a tile name none (#1732). */
  readonly key?: string;
  /** The field an event starts at: a DateTime, or an Option of one. */
  readonly from: string;
  /** The field it ends at; a missing one, or one at or before the start, is an instant. */
  readonly to: string;
  /** The tile. */
  readonly tile: RecordTile;
}

/** The order a series index files its entries in: by key, then time; or by time, then key. */
export type SeriesOrder = 'key' | 'time';

const SERIES_ORDERS: readonly SeriesOrder[] = ['key', 'time'];

/** What a series index's declaration names (`index.flatSeries`): a summary's fields, and its order. */
export interface SeriesSpec extends TimeTileSpec {
  /** `'key'`, a key's events together (the default); `'time'`, a tile's events together, in their keys' order. */
  readonly order?: SeriesOrder;
}

/**
 * The order a series index is declared in, once it passes.
 *
 * @param constructor - The constructor, as a refusal names it
 * @param name - The index
 * @param order - What the declaration gives
 * @returns The order: `'key'` where none is given
 * @throws {Error} For any other, naming the two
 */
function checkOrder(constructor: IndexConstructor, name: string, order: unknown): SeriesOrder {
  if (order === undefined) return 'key';
  if (typeof order === 'string' && (SERIES_ORDERS as readonly string[]).includes(order)) return order as SeriesOrder;
  throw new Error(
    `${constructor} '${name}' order is 'key' — a key's events together, a range a level for one key — or 'time' — a tile's events ` +
    `together in their keys' order, a range a level a tile for a run of keys — not ${JSON.stringify(order)}`,
  );
}

/** A series or summary declaration's fields, or the record's totals', once they pass. */
interface TimeTileFields {
  readonly rowType: RowType;
  readonly leading: Leading;
  /** The key's field and its type; `undefined` for the record's totals a tile, which name none (#1732). */
  readonly key: { readonly field: string; readonly type: EastType } | undefined;
  readonly start: OptionField<DateTimeType>;
  readonly end: OptionField<DateTimeType>;
  readonly tile: RecordTile;
}

/**
 * Checks a series or summary declaration's fields against the record's row:
 * the key, where it is given, is a field that is no Set, the start and the end
 * are DateTime or Option<DateTime> fields, the tile is one an index files by,
 * and the leading fields take neither the key — the index orders by it
 * already — nor the start nor the end: a leading field is matched exactly,
 * before the key, and led by the start or the end the tiles are cut by, a
 * key's events over a span would be a range for each instant, never one range
 * a level.
 *
 * @param constructor - The constructor, as a refusal names it
 * @param name - The index
 * @param valueType - The record's row type
 * @param spec - The declaration
 * @returns The fields
 * @throws {Error} Naming the option, the field and why
 */
function checkTimeTile(constructor: IndexConstructor, name: string, valueType: EastType, spec: TimeTileSpec): TimeTileFields {
  if (valueType.type !== 'Struct') throw new Error(`${constructor} '${name}' indexes a record with Struct rows`);
  const rowType: RowType = valueType;
  const tile = checkTile(constructor, name, spec.tile);
  const on = spec.on ?? [];
  let key: TimeTileFields['key'];
  if (spec.key !== undefined) {
    const keyType = rowType.fields[spec.key];
    if (keyType === undefined) throw new Error(`${constructor} '${name}' key names unknown row field '${spec.key}'`);
    if (keyType.type === 'Set') {
      throw new Error(`${constructor} '${name}' key names '${spec.key}', a Set: the key is the one field naming what an event is on`);
    }
    if (on.includes(spec.key)) throw new Error(`${constructor} '${name}': '${spec.key}' follows the leading fields, and cannot be one`);
    key = { field: spec.key, type: keyType };
  }
  const start = checkTimeField(constructor, name, rowType, 'from', spec.from);
  const end = checkTimeField(constructor, name, rowType, 'to', spec.to);
  for (const [field, what] of [[spec.from, 'start'], [spec.to, 'end']] as const) {
    if (on.includes(field)) {
      throw new Error(`${constructor} '${name}': '${field}' is the event's ${what}, which its tiles are cut by, and cannot be a leading field`);
    }
  }
  return { rowType, leading: checkLeading(constructor, name, rowType, on), key, start, end, tile };
}

/**
 * What a series index's `value` gives of a row, once it passes (#1710): a pure
 * function of the record's entry, giving a struct that holds the event's start
 * and end under the names the index reads them by, each a DateTime or an
 * Option of one. A reader tests a window by them, as it does the row's.
 *
 * @param constructor - The declaration, as a refusal names it
 * @param name - The index
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param spec - The declaration, for its start and end fields
 * @param value - The function
 * @returns What each entry carries
 * @throws {Error} When the function is async, calls a platform function or does not take the record's entry; or when
 *   it gives no struct, or one that holds no DateTime start or end under the index's names, naming what it gives
 */
function seriesValue(
  constructor: IndexConstructor, name: string, keyType: EastType, rowType: RowType, spec: TimeTileSpec, value: IndexFunction,
): RowType {
  checkPure(`${constructor} '${name}' 'value' projection`, value, INDEX_PURITY);
  const signature = signatureOf(value);
  checkEntryParams(constructor, name, "'value' projection", keyType, rowType, signature.inputs);
  const carried = signature.output;
  const gives = `${constructor} '${name}' value gives ${printType(carried)}`;
  const holds = `a series index's value is a struct holding the event's '${spec.from}' and '${spec.to}', as the row does, which a reader tests a window by`;
  if (carried.type !== 'Struct') throw new Error(`${gives}: ${holds}`);
  for (const field of [spec.from, spec.to]) {
    if (optionField(carried, field, DateTimeType) === undefined) throw new Error(`${gives}, which holds no DateTime '${field}': ${holds}`);
  }
  return carried;
}

/**
 * A series index's definition (`index.flatSeries`): its key function,
 * `(K, V) → Set<IK>`, an entry per place a row's event is filed
 * (`eventFilings`: once, or once a year past a year), `{ on: { …on }, key,
 * level, tile }` — or, declared `order: 'time'`, `{ on: { …on }, level, tile,
 * key, past }`, the same parts with the tile before the key, and `past`, false
 * in every entry, which a range through a last key is bounded by (#1710) — one per
 * combination of its leading values, a Set among them
 * fanning out, as the interval index's do; and its projection: the whole row,
 * or what its `value` gives of the row (#1710), so a cell reads the index
 * alone and no record segment. It stays an ordinary maintained index:
 * mutation, rebuild, storage and transport are shared, and a write that
 * changes nothing its value gives leaves its entries as they are.
 *
 * @param constructor - The declaration, as a refusal names it
 * @param name - The index
 * @param rec - Its record
 * @param spec - The key, the start and the end, the tile, the optional leading `on`, and the optional `order`
 * @param config - Its runner selection, and its `value`: what each entry carries of its row, `(K, V) -> P`
 * @returns The definition
 * @throws {Error} When a field is not of its option's type, naming the option, the field and its type; when the tile is
 *   not one of the five; when the key, the start or the end is a leading field; for an `order` that is neither `'key'`
 *   nor `'time'`; for a `value` that is not a pure function of the record's entry giving a struct with the event's start
 *   and end; or on any guard every index applies
 */
export function seriesDefinition(
  constructor: IndexConstructor, name: string, rec: RecordDef, spec: SeriesSpec,
  config: { runner?: RecordIndexDef['runner']; value?: IndexFunction } | undefined,
): RecordIndexDef {
  const { keyType, valueType } = indexedEntry(constructor, name, rec);
  onlyOptions(constructor, name, spec, ['on', 'key', 'from', 'to', 'tile', 'order'],
    'value' in spec ? `a series index's value is an option beside these: ${constructor.slice(constructor.lastIndexOf('index.'))}({ … }, { value })` : undefined);
  const fields = checkTimeTile(constructor, name, valueType, spec);
  const order = checkOrder(constructor, name, spec.order);
  const { rowType, leading } = fields;
  // A series index files each event by the key it is on: only the record's totals are kept under none (#1732).
  const filedBy = fields.key;
  if (filedBy === undefined) {
    throw new Error(`${constructor} '${name}' takes a key — the field naming what an event is on, which a series index files each event by: ` +
      `key: '…'; the record's totals a tile, under no key, are index.totals({ from, to, tile })`);
  }
  // East orders a struct by its fields as they are declared: the order of the key's parts is the order of the index.
  const indexType = order === 'time'
    ? StructType({ on: leading.onType, level: RecordLevelType, tile: DateTimeType, key: filedBy.type, past: BooleanType })
    : StructType({ on: leading.onType, key: filedBy.type, level: RecordLevelType, tile: DateTimeType });
  const level = variant(fields.tile, null);
  const readKey = fieldReader(keyType, rowType, filedBy);
  const readStart = fieldReader(keyType, rowType, { option: fields.start });
  const readEnd = fieldReader(keyType, rowType, { option: fields.end });
  const leads = leadingValues(keyType, rowType, leading);
  // An event's entries under one combination of its leading values: one a place it is filed, its key's parts in the index's order.
  const filedUnder = East.function([leading.onType, filedBy.type, ArrayType(TileFilingType)], SetType(indexType), (_$, on, key, filings) =>
    filings.toSet((_$, filing) => (order === 'time'
      ? { on, level: filing.level, tile: filing.tile, key, past: false }
      : { on, key, level: filing.level, tile: filing.tile })));
  const keyFn = East.function([keyType, rowType], SetType(indexType), ($, key, row) => {
    const keyOf = $.const(readKey);
    const startOf = $.const(readStart);
    const endOf = $.const(readEnd);
    const file = $.const(TILE_FNS.placedFilings);
    const combinations = $.const(leads);
    const under = $.const(filedUnder);
    const eventKey = $.let(keyOf(key, row));
    const filings = $.let(file(level, startOf(key, row), endOf(key, row), East.print(key)));
    return combinations(key, row).flattenToSet((_$, on) => under(on, eventKey, filings));
  });
  // It carries its rows — each entry's projection the whole row — or what its `value` gives of each (#1710): either
  // way a cell reads the index alone and no record segment.
  const carried = config?.value === undefined ? undefined : seriesValue(constructor, name, keyType, rowType, spec, config.value);
  const valueFn = config?.value ?? East.function([keyType, rowType], rowType, (_$, _key, row) => row);
  const runner = indexRunner(config);
  checkPure(`${constructor} '${name}' 'keys' function`, keyFn, INDEX_PURITY);
  checkEntryParams(constructor, name, "'keys' function", keyType, valueType, signatureOf(keyFn).inputs);
  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: Object.freeze([...(spec.on ?? [])]),
    series: Object.freeze({
      key: filedBy.field, from: spec.from, to: spec.to, tile: fields.tile, carries: carried === undefined ? 'row' as const : 'value' as const, order,
    }),
    keyFn,
    valueFn,
    multi: true,
    keyType: indexType,
    valueType: carried ?? rowType,
    runner,
  };
}

/** The largest Integer: a summary's total past it is no Integer. */
const INTEGER_MAX = (1n << 63n) - 1n;

/** What a refusal says of totals summed past the largest Integer, after naming them. */
const PAST_INTEGER_MAX = 'sum past the largest Integer: declare a finer tile, whose totals are smaller';

/**
 * A summary's merge, `({ik, k}, Totals, Totals) → Totals`: a build's pieces
 * hold the same keys, and a key's totals across them are their sum, refused
 * past the largest Integer naming the index and the key. Built with no source
 * locations, so its program is the same wherever the package is built.
 *
 * @param name - The index
 * @param indexType - Its key type
 * @returns The merge
 */
export function summaryMerge(name: string, indexType: EastType) {
  return withLocationCapture(false, () => East.function(
    [StructType({ ik: indexType, k: NullType }), RecordSummaryTotalsType, RecordSummaryTotalsType], RecordSummaryTotalsType,
    ($, entry, a, b) => {
      const add = $.const(SERIES_FNS.addTotals);
      return add(East.str`${name}: the totals under ${East.print(entry)}`, a, b);
    },
  ));
}

/**
 * A summary index's definition (`index.summary`): its key function, a
 * row's contributions, `(K, V) → Dict<IK, Totals>` — under each tile its event
 * touches, `{ on: { …on }, key, tile }`, once per combination of its leading
 * values, the count 1 and the milliseconds of the tile it covers — and its
 * merge, `({ik, k}, Totals, Totals) → Totals`: a build's pieces hold the same
 * keys, and a key's totals across them are their sum.
 *
 * @param constructor - The declaration, as a refusal names it
 * @param name - The index
 * @param rec - Its record
 * @param spec - The key, the start and the end, the tile, and the optional leading `on`
 * @param config - Its runner selection
 * @returns The definition
 * @throws {Error} As {@link seriesDefinition} does; and for a key left out, naming the record's totals' builder
 */
export function summaryDefinition(
  constructor: IndexConstructor, name: string, rec: RecordDef, spec: TimeTileSpec, config: { runner?: RecordIndexDef['runner'] } | undefined,
): RecordIndexDef {
  const entry = indexedEntry(constructor, name, rec);
  onlyOptions(constructor, name, spec, ['on', 'key', 'from', 'to', 'tile'],
    'value' in spec ? 'a summary index holds its totals, so it takes no value'
      : 'order' in spec ? 'a summary index is filed by key, a key\'s tiles together: an order is a series index\'s' : undefined);
  if (spec.key === undefined) {
    throw new Error(`${constructor} '${name}' takes a key — the field naming what an event is on, which a summary index keeps a total a tile under: ` +
      `key: '…'; the record's totals a tile, under no key, are index.totals({ from, to, tile })`);
  }
  return tiledTotals(constructor, name, rec, entry, spec, config);
}

/**
 * The record's totals' definition (`index.totals`, #1732): a summary under
 * no key — a row's contributions under `{ on: { …on }, tile }`, each tile its
 * event touches, once per combination of its leading values, whatever the
 * event is on: one entry a tile, however many resources.
 *
 * @param constructor - The declaration, as a refusal names it
 * @param name - The index
 * @param rec - Its record
 * @param spec - The start and the end, the tile, and the optional leading `on`
 * @param config - Its runner selection
 * @returns The definition
 * @throws {Error} As {@link summaryDefinition} does; and for a key, naming a summary index's builder
 */
export function totalsDefinition(
  constructor: IndexConstructor, name: string, rec: RecordDef, spec: TimeTileSpec, config: { runner?: RecordIndexDef['runner'] } | undefined,
): RecordIndexDef {
  const entry = indexedEntry(constructor, name, rec);
  onlyOptions(constructor, name, spec, ['on', 'from', 'to', 'tile'],
    'key' in spec ? 'the record\'s totals are kept a tile, whatever each event is on: a key\'s totals a tile are index.summary({ key, from, to, tile })'
      : 'value' in spec ? 'the index holds the record\'s totals, so it takes no value'
        : 'order' in spec ? 'the record\'s totals are a total a tile: an order is a series index\'s' : undefined);
  return tiledTotals(constructor, name, rec, entry, spec, config);
}

/**
 * The definition of totals kept a tile: a summary index's, under each key
 * ({@link summaryDefinition}), or the record's, under none
 * ({@link totalsDefinition}) — the declaration's name, record and options
 * checked by each.
 *
 * @param constructor - The declaration, as a refusal names it
 * @param name - The index
 * @param rec - Its record
 * @param entry - The record's entry, its key and row types
 * @param spec - The optional key, the start and the end, the tile, and the optional leading `on`
 * @param config - Its runner selection
 * @returns The definition
 * @throws {Error} As {@link seriesDefinition} does, but for a key left out
 */
function tiledTotals(
  constructor: IndexConstructor, name: string, rec: RecordDef, entry: { keyType: EastType; valueType: EastType }, spec: TimeTileSpec,
  config: { runner?: RecordIndexDef['runner'] } | undefined,
): RecordIndexDef {
  const { keyType, valueType } = entry;
  const fields = checkTimeTile(constructor, name, valueType, spec);
  const { rowType, leading } = fields;
  const level = variant(fields.tile, null);
  const readStart = fieldReader(keyType, rowType, { option: fields.start });
  const readEnd = fieldReader(keyType, rowType, { option: fields.end });
  const leads = leadingValues(keyType, rowType, leading);
  const filedBy = fields.key;
  let indexType: EastType;
  let keyFn: IndexFunction;
  if (filedBy === undefined) {
    // The record's totals a tile (#1732): under each tile its event touches, once per combination of its leading values.
    indexType = StructType({ on: leading.onType, tile: DateTimeType });
    const totalsType = DictType(indexType, RecordSummaryTotalsType);
    const sharesUnder = East.function([leading.onType, ArrayType(TileShareType)], totalsType, (_$, on, shares) =>
      shares.toDict((_$, share) => ({ on, tile: share.tile }), (_$, share) => ({ count: 1n, ms: share.ms })));
    keyFn = East.function([keyType, rowType], totalsType, ($, key, row) => {
      const startOf = $.const(readStart);
      const endOf = $.const(readEnd);
      const share = $.const(TILE_FNS.placedShares);
      const combinations = $.const(leads);
      const under = $.const(sharesUnder);
      const shares = $.let(share(level, startOf(key, row), endOf(key, row), East.print(key)));
      return combinations(key, row).flattenToDict((_$, on) => under(on, shares));
    });
  } else {
    indexType = StructType({ on: leading.onType, key: filedBy.type, tile: DateTimeType });
    const totalsType = DictType(indexType, RecordSummaryTotalsType);
    const readKey = fieldReader(keyType, rowType, filedBy);
    // An event's contributions under one combination of its leading values: the count 1 and its share, under each tile.
    const sharesUnder = East.function([leading.onType, filedBy.type, ArrayType(TileShareType)], totalsType, (_$, on, key, shares) =>
      shares.toDict((_$, share) => ({ on, key, tile: share.tile }), (_$, share) => ({ count: 1n, ms: share.ms })));
    keyFn = East.function([keyType, rowType], totalsType, ($, key, row) => {
      const keyOf = $.const(readKey);
      const startOf = $.const(readStart);
      const endOf = $.const(readEnd);
      const share = $.const(TILE_FNS.placedShares);
      const combinations = $.const(leads);
      const under = $.const(sharesUnder);
      const eventKey = $.let(keyOf(key, row));
      const shares = $.let(share(level, startOf(key, row), endOf(key, row), East.print(key)));
      return combinations(key, row).flattenToDict((_$, on) => under(on, eventKey, shares));
    });
  }
  const mergeFn = summaryMerge(name, indexType);
  const runner = indexRunner(config);
  checkPure(`${constructor} '${name}' contributions`, keyFn, INDEX_PURITY);
  checkEntryParams(constructor, name, 'contributions', keyType, valueType, signatureOf(keyFn).inputs);
  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: Object.freeze([...(spec.on ?? [])]),
    summary: Object.freeze({ ...(filedBy !== undefined && { key: filedBy.field }), from: spec.from, to: spec.to, tile: fields.tile }),
    keyFn,
    mergeFn,
    // A row touches several keys, and a key stands for several rows.
    multi: true,
    keyType: indexType,
    valueType: RecordSummaryTotalsType,
    runner,
  };
}

// ── The functions, each built the first time it is read ──────────────────────

/**
 * A summary index's East functions, each built the first time it is read,
 * with no location captured ({@link lazyBuilds}, #1466): importing the SDK
 * builds none of them.
 */
export const SERIES_FNS = lazyBuilds({
  /**
   * Two of a summary's totals summed. Integer addition is associative and
   * commutative, so a build's pieces fold to the same totals in any order.
   *
   * `(what, a, b) → a + b`, `what` naming the totals in the refusal.
   *
   * @remarks
   * East's Integer addition wraps, so a sum past the largest Integer is refused
   * rather than stored below none — as a write that would carry a total past it
   * is: a finer tile's totals are smaller.
   *
   * Throws an East runtime error when the totals sum past the largest Integer,
   * naming `what` and a finer tile.
   */
  get addTotals() {
    return East.function([StringType, RecordSummaryTotalsType, RecordSummaryTotalsType], RecordSummaryTotalsType, ($, what, a, b) => {
      const max = $.const(INTEGER_MAX);
      // Totals are never below none, so a sum passes the largest Integer exactly when one part passes what the other leaves of it.
      $.if(a.count.greater(max.subtract(b.count)).or(() => a.ms.greater(max.subtract(b.ms))), ($) => {
        $.error(East.str`${what} ${PAST_INTEGER_MAX}`);
      });
      return { count: a.count.add(b.count), ms: a.ms.add(b.ms) };
    });
  },
});
