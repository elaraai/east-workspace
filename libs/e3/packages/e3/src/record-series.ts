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
 *   index whose keys the SDK generates, each entry carrying the row: mutation,
 *   rebuild, storage and transport are the ones every index has.
 * - **A summary index** keeps, for each key and tile, how many rows touch the
 *   tile and the milliseconds of it they cover, `{ on: { …on }, key, tile }`.
 *   Its keys come from a row's contributions, `(K, V) → Dict<IK, Totals>`: the
 *   count 1 and the row's share of each tile it touches, under each
 *   (`tileShares`).
 *
 * A row with no start is in neither: it has no time to file it by.
 *
 * @packageDocumentation
 */
import {
  ArrayType, DateTimeType, DictType, East, NullType, SetType, StringType, StructType, variant, withLocationCapture,
  type EastType,
} from '@elaraai/east';
import { RecordLevelType, RecordSummaryTotalsType } from '@elaraai/e3-types';
import type { RecordDef, RecordIndexDef } from './types.js';
import {
  INDEX_PURITY, checkEntryParams, checkPure, indexRunner, indexedEntry, onlyOptions, signatureOf, type IndexConstructor,
} from './record-guards.js';
import { checkLeading, checkTimeField, fieldReader, leadingValues, type Leading, type OptionField, type RowType } from './record-keys.js';
import { TileFilingType, TileShareType, checkTile, placedFilings, placedShares, type RecordTile } from './record-tiles.js';

/** What a series or a summary index's declaration names (`e3.recordIndex.series`, `e3.recordIndex.summary`). */
export interface TimeTileSpec {
  /** The exact leading fields, before the key. */
  readonly on?: readonly string[];
  /** The field naming the key the events are filed under: a Plan's resource. */
  readonly key: string;
  /** The field an event starts at: a DateTime, or an Option of one. */
  readonly from: string;
  /** The field it ends at; a missing one, or one at or before the start, is an instant. */
  readonly to: string;
  /** The tile. */
  readonly tile: RecordTile;
}

/** A series or summary declaration's fields, once they pass. */
interface TimeTileFields {
  readonly rowType: RowType;
  readonly leading: Leading;
  /** The key's field and its type. */
  readonly key: { readonly field: string; readonly type: EastType };
  readonly start: OptionField<DateTimeType>;
  readonly end: OptionField<DateTimeType>;
  readonly tile: RecordTile;
}

/**
 * Checks a series or summary declaration's fields against the record's row:
 * the key is a field that is no Set, the start and the end are DateTime or
 * Option<DateTime> fields, the tile is one an index files by, and the leading
 * fields take neither the key — the index orders by it already — nor the start
 * nor the end: a leading field is matched exactly, before the key, and led by
 * the start or the end the tiles are cut by, a key's events over a span would
 * be a range for each instant, never one range a level.
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
  const keyType = rowType.fields[spec.key];
  if (keyType === undefined) throw new Error(`${constructor} '${name}' key names unknown row field '${spec.key}'`);
  if (keyType.type === 'Set') {
    throw new Error(`${constructor} '${name}' key names '${spec.key}', a Set: the key is the one field naming what an event is on`);
  }
  const start = checkTimeField(constructor, name, rowType, 'from', spec.from);
  const end = checkTimeField(constructor, name, rowType, 'to', spec.to);
  const on = spec.on ?? [];
  if (on.includes(spec.key)) throw new Error(`${constructor} '${name}': '${spec.key}' follows the leading fields, and cannot be one`);
  for (const [field, what] of [[spec.from, 'start'], [spec.to, 'end']] as const) {
    if (on.includes(field)) {
      throw new Error(`${constructor} '${name}': '${field}' is the event's ${what}, which its tiles are cut by, and cannot be a leading field`);
    }
  }
  return { rowType, leading: checkLeading(name, rowType, on), key: { field: spec.key, type: keyType }, start, end, tile };
}

/**
 * A series index's definition (`e3.recordIndex.series`): its key function,
 * `(K, V) → Set<IK>`, an entry per place a row's event is filed
 * (`eventFilings`: once, or once a year past a year), `{ on: { …on }, key,
 * level, tile }` — one per combination of its leading values, a Set among them
 * fanning out, as the interval index's do; and its projection, the whole row,
 * so a cell reads the index alone and no record segment. It stays an ordinary
 * maintained index: mutation, rebuild, storage and transport are shared.
 *
 * @param name - The index
 * @param rec - Its record
 * @param spec - The key, the start and the end, the tile, and the optional leading `on`
 * @param config - Its runner selection
 * @returns The definition
 * @throws {Error} When a field is not of its option's type, naming the option, the field and its type; when the tile is
 *   not one of the five; when the key, the start or the end is a leading field; or on any guard every index applies
 */
export function seriesDefinition(name: string, rec: RecordDef, spec: TimeTileSpec, config: { runner?: RecordIndexDef['runner'] } | undefined): RecordIndexDef {
  const constructor = 'e3.recordIndex.series';
  const { keyType, valueType } = indexedEntry(constructor, name, rec);
  onlyOptions(constructor, name, spec, ['on', 'key', 'from', 'to', 'tile'],
    'value' in spec ? 'a series index carries the whole row as its projection, so it takes no value' : undefined);
  const fields = checkTimeTile(constructor, name, valueType, spec);
  const { rowType, leading } = fields;
  const indexType = StructType({ on: leading.onType, key: fields.key.type, level: RecordLevelType, tile: DateTimeType });
  const level = variant(fields.tile, null);
  const readKey = fieldReader(keyType, rowType, fields.key);
  const readStart = fieldReader(keyType, rowType, { option: fields.start });
  const readEnd = fieldReader(keyType, rowType, { option: fields.end });
  const leads = leadingValues(keyType, rowType, leading);
  // An event's entries under one combination of its leading values: one a place it is filed.
  const filedUnder = East.function([leading.onType, fields.key.type, ArrayType(TileFilingType)], SetType(indexType), (_$, on, key, filings) =>
    filings.toSet((_$, filing) => ({ on, key, level: filing.level, tile: filing.tile })));
  const keyFn = East.function([keyType, rowType], SetType(indexType), ($, key, row) => {
    const keyOf = $.const(readKey);
    const startOf = $.const(readStart);
    const endOf = $.const(readEnd);
    const file = $.const(placedFilings);
    const combinations = $.const(leads);
    const under = $.const(filedUnder);
    const eventKey = $.let(keyOf(key, row));
    const filings = $.let(file(level, startOf(key, row), endOf(key, row), East.print(key)));
    return combinations(key, row).flattenToSet((_$, on) => under(on, eventKey, filings));
  });
  // It carries its rows: each entry's projection is the whole row, so a cell reads the index alone and no record segment.
  const valueFn = East.function([keyType, rowType], rowType, (_$, _key, row) => row);
  const runner = indexRunner(config);
  checkPure(`e3.recordIndex '${name}' 'keys' function`, keyFn, INDEX_PURITY);
  checkEntryParams(name, "'keys' function", keyType, valueType, signatureOf(keyFn).inputs);
  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: Object.freeze([...(spec.on ?? [])]),
    series: Object.freeze({ key: spec.key, from: spec.from, to: spec.to, tile: fields.tile }),
    keyFn,
    valueFn,
    multi: true,
    keyType: indexType,
    valueType: rowType,
    runner,
  };
}

/** The largest Integer: a summary's total past it is no Integer. */
const INTEGER_MAX = (1n << 63n) - 1n;

/** What a refusal says of totals summed past the largest Integer, after naming them. */
const PAST_INTEGER_MAX = 'sum past the largest Integer: declare a finer tile, whose totals are smaller';

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
const addTotals = East.function([StringType, RecordSummaryTotalsType, RecordSummaryTotalsType], RecordSummaryTotalsType, ($, what, a, b) => {
  const max = $.const(INTEGER_MAX);
  // Totals are never below none, so a sum passes the largest Integer exactly when one part passes what the other leaves of it.
  $.if(a.count.greater(max.subtract(b.count)).or(() => a.ms.greater(max.subtract(b.ms))), ($) => {
    $.error(East.str`${what} ${PAST_INTEGER_MAX}`);
  });
  return { count: a.count.add(b.count), ms: a.ms.add(b.ms) };
});

/**
 * A summary index's definition (`e3.recordIndex.summary`): its key function, a
 * row's contributions, `(K, V) → Dict<IK, Totals>` — under each tile its event
 * touches, `{ on: { …on }, key, tile }`, once per combination of its leading
 * values, the count 1 and the milliseconds of the tile it covers — and its
 * merge, `({ik, k}, Totals, Totals) → Totals`: a build's pieces hold the same
 * keys, and a key's totals across them are their sum.
 *
 * @param name - The index
 * @param rec - Its record
 * @param spec - The key, the start and the end, the tile, and the optional leading `on`
 * @param config - Its runner selection
 * @returns The definition
 * @throws {Error} As {@link seriesDefinition} does
 */
export function summaryDefinition(name: string, rec: RecordDef, spec: TimeTileSpec, config: { runner?: RecordIndexDef['runner'] } | undefined): RecordIndexDef {
  const constructor = 'e3.recordIndex.summary';
  const { keyType, valueType } = indexedEntry(constructor, name, rec);
  onlyOptions(constructor, name, spec, ['on', 'key', 'from', 'to', 'tile'],
    'value' in spec ? 'a summary index holds its totals, so it takes no value' : undefined);
  const fields = checkTimeTile(constructor, name, valueType, spec);
  const { rowType, leading } = fields;
  const indexType = StructType({ on: leading.onType, key: fields.key.type, tile: DateTimeType });
  const totalsType = DictType(indexType, RecordSummaryTotalsType);
  const level = variant(fields.tile, null);
  const readKey = fieldReader(keyType, rowType, fields.key);
  const readStart = fieldReader(keyType, rowType, { option: fields.start });
  const readEnd = fieldReader(keyType, rowType, { option: fields.end });
  const leads = leadingValues(keyType, rowType, leading);
  // An event's contributions under one combination of its leading values: the count 1 and its share, under each tile.
  const sharesUnder = East.function([leading.onType, fields.key.type, ArrayType(TileShareType)], totalsType, (_$, on, key, shares) =>
    shares.toDict((_$, share) => ({ on, key, tile: share.tile }), (_$, share) => ({ count: 1n, ms: share.ms })));
  const keyFn = East.function([keyType, rowType], totalsType, ($, key, row) => {
    const keyOf = $.const(readKey);
    const startOf = $.const(readStart);
    const endOf = $.const(readEnd);
    const share = $.const(placedShares);
    const combinations = $.const(leads);
    const under = $.const(sharesUnder);
    const eventKey = $.let(keyOf(key, row));
    const shares = $.let(share(level, startOf(key, row), endOf(key, row), East.print(key)));
    return combinations(key, row).flattenToDict((_$, on) => under(on, eventKey, shares));
  });
  // Built with no source locations, so its program is the same wherever the package is built.
  const mergeFn = withLocationCapture(false, () => East.function(
    [StructType({ ik: indexType, k: NullType }), RecordSummaryTotalsType, RecordSummaryTotalsType], RecordSummaryTotalsType,
    ($, entry, a, b) => {
      const add = $.const(addTotals);
      return add(East.str`${name}: the totals under ${East.print(entry)}`, a, b);
    },
  ));
  const runner = indexRunner(config);
  checkPure(`e3.recordIndex.summary '${name}' contributions`, keyFn, INDEX_PURITY);
  checkEntryParams(name, 'contributions', keyType, valueType, signatureOf(keyFn).inputs);
  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: Object.freeze([...(spec.on ?? [])]),
    summary: Object.freeze({ key: spec.key, from: spec.from, to: spec.to, tile: fields.tile }),
    keyFn,
    mergeFn,
    // A row touches several keys, and a key stands for several rows.
    multi: true,
    keyType: indexType,
    valueType: RecordSummaryTotalsType,
    runner,
  };
}
