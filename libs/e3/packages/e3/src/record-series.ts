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
  DateTimeType, DictType, East, Expr, NullType, OptionType, SetType, StructType, isTypeEqual, printType, some,
  type EastType, type FunctionExpr,
} from '@elaraai/east';
import { RecordLevelType, RecordSummaryTotalsType } from '@elaraai/e3-types';
import type { IndexFunction } from './record-index.js';
import { checkTile, eventFilings, tileShares, type RecordTile } from './record-tiles.js';

/** What a series or a summary index files a row by, as its declaration names the fields. */
export interface TimeTileFields {
  /** The field naming the key the events are filed under: a Plan's resource. */
  readonly key: string;
  /** The field an event starts at: a DateTime, or an Option of one. */
  readonly from: string;
  /** The field it ends at; a missing one, or one at or before the start, is an instant. */
  readonly to: string;
  /** The tile. */
  readonly tile: RecordTile;
}

/** The row's field types, the start's and the end's, and the parts of the index key, once a declaration's fields pass. */
interface Checked {
  readonly rowType: StructType<Record<string, EastType>>;
  readonly startType: EastType;
  readonly endType: EastType;
  /** The leading fields at their key types: the key's `on`. */
  readonly onType: StructType<Record<string, EastType>>;
  /** The key field's type. */
  readonly keyType: EastType;
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
 * @param on - The exact leading fields
 * @param spec - The fields and the tile
 * @returns The types the index key is built from
 * @throws {Error} Naming the option, the field and why
 */
export function checkTimeTile(constructor: string, name: string, valueType: EastType, on: readonly string[], spec: TimeTileFields): Checked {
  if (valueType.type !== 'Struct') throw new Error(`${constructor} '${name}' indexes a record with Struct rows`);
  const rowType = valueType as StructType<Record<string, EastType>>;
  checkTile(constructor, name, spec.tile);
  const keyField = rowType.fields[spec.key];
  if (keyField === undefined) throw new Error(`${constructor} '${name}' key names unknown row field '${spec.key}'`);
  if (keyField.type === 'Set') {
    throw new Error(`${constructor} '${name}' key names '${spec.key}', a Set: the key is the one field naming what an event is on`);
  }
  const timed = (option: 'from' | 'to', field: string): EastType => {
    const type = rowType.fields[field];
    if (type === undefined) throw new Error(`${constructor} '${name}' ${option} names unknown row field '${field}'`);
    if (!isTypeEqual(type, DateTimeType) && !isTypeEqual(type, OptionType(DateTimeType))) {
      throw new Error(`${constructor} '${name}' ${option} names '${field}', of type ${printType(type)}: ${option} is a DateTime or an Option<DateTime> field`);
    }
    return type;
  };
  const startType = timed('from', spec.from);
  const endType = timed('to', spec.to);
  if (on.includes(spec.key)) throw new Error(`${constructor} '${name}': '${spec.key}' follows the leading fields, and cannot be one`);
  for (const [field, what] of [[spec.from, 'start'], [spec.to, 'end']] as const) {
    if (on.includes(field)) {
      throw new Error(`${constructor} '${name}': '${field}' is the event's ${what}, which its tiles are cut by, and cannot be a leading field`);
    }
  }
  const fields = Object.fromEntries(on.map((field) => {
    const type = rowType.fields[field]!;
    return [field, type.type === 'Set' ? type.key : type];
  }));
  return { rowType, startType, endType, onType: StructType(fields), keyType: keyField };
}

/**
 * Builds a function of a row's places in time: `(K, V) → C`, the row's start
 * and end read, the places `spread` gives the event — a series index's
 * filings, or a summary index's shares — under each combination of its
 * leading values, folded into `C` by `put`.
 */
function overEvents(
  keyType: EastType, checked: Checked, on: readonly string[], spec: TimeTileFields,
  prefix: { fn: IndexFunction; multi: boolean } | undefined,
  output: EastType, empty: () => unknown,
  spread: ReturnType<typeof eventFilings> | ReturnType<typeof tileShares>,
  put: ($: any, into: any, leading: Record<string, unknown>, key: unknown, place: any) => void,
) {
  const prefixType = prefix === undefined ? undefined : Expr.type(prefix.fn as unknown as Expr) as { output: EastType };
  // Dynamic field names are erased only inside this generated East function,
  // as in the field, interval and area key generators; every type was checked.
  return East.function([keyType as never, checked.rowType], output as never, ($: any, key: any, row: any) => {
    const places = $.const(spread);
    const into = $.let(empty(), output);
    const start = $.let(checked.startType.type === 'DateTime' ? some(row[spec.from]) : row[spec.from], OptionType(DateTimeType));
    const end = $.let(checked.endType.type === 'DateTime' ? some(row[spec.to]) : row[spec.to], OptionType(DateTimeType));
    $.match(start, {
      some: ($: any, from: any) => {
        // No end is an instant at the start; the places say so of one at or before it.
        const to = $.let(end.match({ some: (_$: any, to: any) => to, none: () => from }), DateTimeType);
        const placed = $.let(places(from, to, East.print(key)));
        const file = ($: any, leading: Record<string, unknown>) => {
          $.for(placed, ($: any, place: any) => {
            put($, into, leading, row[spec.key], place);
          });
        };
        if (prefix === undefined) { file($, {}); return; }
        const make = $.const(prefix.fn as FunctionExpr<any, any>);
        const values = $.let(make(key, row), prefixType!.output);
        const leadingOf = (value: any) => Object.fromEntries(on.map((field) => [field, on.length === 1 ? value : value[field]]));
        if (prefix.multi) $.for(values, ($: any, value: any) => file($, leadingOf(value)));
        else file($, leadingOf(values));
      },
    });
    return into;
  });
}

/**
 * The series index's key function: `(K, V) → Set<IK>`, an entry per place a
 * row's event is filed (`eventFilings`: once, or once a year past a year),
 * `{ on: { …on }, key, level, tile }` — one per combination of its leading
 * values, a Set among them fanning out, as the interval index's do.
 *
 * @param name - The index, for the refusals
 * @param keyType - The record's key type
 * @param valueType - The record's row type
 * @param on - The exact leading fields
 * @param spec - The key, the start and the end, and the tile
 * @param prefix - The leading fields' generated key function
 * @returns The key function and the index key's type
 * @throws {Error} As {@link checkTimeTile} does
 */
export function seriesKeys(name: string, keyType: EastType, valueType: EastType, on: readonly string[], spec: TimeTileFields,
  prefix?: { fn: IndexFunction; multi: boolean }) {
  const checked = checkTimeTile('e3.recordIndex.series', name, valueType, on, spec);
  const indexType = StructType({ on: checked.onType, key: checked.keyType, level: RecordLevelType, tile: DateTimeType });
  const keys = SetType(indexType);
  const fn = overEvents(keyType, checked, on, spec, prefix, keys, () => new Set(), eventFilings(spec.tile),
    ($, into, leading, key, filing) => { $(into.tryInsert({ on: leading, key, level: filing.level, tile: filing.tile })); });
  return { fn, multi: true, indexType };
}

/**
 * The summary index's contributions: `(K, V) → Dict<IK, Totals>`, under each
 * tile a row's event touches, `{ on: { …on }, key, tile }` — once per
 * combination of its leading values — the count 1 and the milliseconds of the
 * tile it covers.
 *
 * @param name - The index, for the refusals
 * @param keyType - The record's key type
 * @param valueType - The record's row type
 * @param on - The exact leading fields
 * @param spec - The key, the start and the end, and the tile
 * @param prefix - The leading fields' generated key function
 * @returns The contributions function and the index key's type
 * @throws {Error} As {@link checkTimeTile} does
 */
export function summaryContributions(name: string, keyType: EastType, valueType: EastType, on: readonly string[], spec: TimeTileFields,
  prefix?: { fn: IndexFunction; multi: boolean }) {
  const checked = checkTimeTile('e3.recordIndex.summary', name, valueType, on, spec);
  const indexType = StructType({ on: checked.onType, key: checked.keyType, tile: DateTimeType });
  const totals = DictType(indexType, RecordSummaryTotalsType);
  const fn = overEvents(keyType, checked, on, spec, prefix, totals, () => new Map(), tileShares(spec.tile),
    ($, into, leading, key, share) => { $(into.insertOrUpdate({ on: leading, key, tile: share.tile }, { count: 1n, ms: share.ms })); });
  return { fn, indexType };
}

/** The largest Integer: a summary's total past it is no Integer. */
const INTEGER_MAX = (1n << 63n) - 1n;

/**
 * A summary's merge: the build's pieces hold the same keys, and a key's
 * totals across them are their sum. Integer addition is associative and
 * commutative, so the pieces fold to the same totals in any order.
 *
 * @remarks
 * East's Integer addition wraps, so a sum past the largest Integer is refused
 * rather than stored below none — as a write that would carry a total past it
 * is: a finer tile's totals are smaller.
 *
 * @param name - The summary, as the refusal names it
 * @param indexType - The summary's index key
 * @returns `({ik, k}, Totals, Totals) → Totals`
 * @throws East runtime error when a key's totals sum past the largest Integer,
 *   naming the summary, the key and a finer tile
 */
export function summaryMerge(name: string, indexType: EastType) {
  const entry = StructType({ ik: indexType, k: NullType });
  const past = 'sum past the largest Integer: declare a finer tile, whose totals are smaller';
  return East.function([entry as never, RecordSummaryTotalsType, RecordSummaryTotalsType], RecordSummaryTotalsType,
    ($: any, key: any, a: any, b: any) => {
      // Totals are never below none, so a sum passes the largest Integer exactly when one part passes what the other leaves of it.
      $.if(a.count.greater(East.value(INTEGER_MAX).subtract(b.count)).or(() => a.ms.greater(East.value(INTEGER_MAX).subtract(b.ms))), ($: any) => {
        $.error(East.str`${name}: the totals under ${East.print(key)} ${past}`);
      });
      return { count: a.count.add(b.count), ms: a.ms.add(b.ms) };
    });
}
