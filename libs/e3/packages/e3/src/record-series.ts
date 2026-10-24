/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The keys of a series index and the contributions of a summary index (#1039):
 * a record's events filed by a key — the resource an event is on — and by the
 * time tiles it touches (`record-tiles.ts`).
 *
 * Both key an entry `{ …on, __tile, <key> }`: the exact leading fields, the
 * tile's start, then the key's value. The tile leads the key, so the events of
 * one tile on a contiguous run of keys — a block of a Plan's rows — are one
 * contiguous range of either index: a cell.
 *
 * - **A series index** is an ordinary maintained index whose keys the SDK
 *   generates: an entry per tile an event touches, carrying the row. Mutation,
 *   rebuild, storage and transport are the ones every index has.
 * - **A summary index** keeps, for each key, how many rows touch its tile and
 *   the milliseconds of it they cover. Its keys come from a row's
 *   contributions, `(K, V) → Dict<IK, Totals>`: the count 1 and the row's share
 *   of each tile it touches, under each.
 *
 * A row with no start is in neither: it has no time to file it by.
 *
 * @packageDocumentation
 */
import {
  DateTimeType, DictType, East, Expr, NullType, OptionType, SetType, StructType, isTypeEqual, printType, some,
  type EastType, type FunctionExpr,
} from '@elaraai/east';
import { RecordSummaryTotalsType } from '@elaraai/e3-types';
import type { IndexFunction } from './record-index.js';
import { checkTile, tileShares, type RecordTile } from './record-tiles.js';

/** The reserved name of a series or summary index's tile field. */
export const TILE_FIELD = '__tile';

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

/** A field's type, the row's field types, and the index key's type, once a declaration's fields pass. */
interface Checked {
  readonly rowType: StructType<Record<string, EastType>>;
  readonly startType: EastType;
  readonly endType: EastType;
  readonly indexType: StructType<Record<string, EastType>>;
}

/**
 * Checks a series or summary declaration's fields against the record's row:
 * the key is a field that is no Set, the start and the end are DateTime or
 * Option<DateTime> fields, the tile is one an index files by, and neither the
 * row nor the leading fields take `__tile`, the key or the start.
 *
 * @param constructor - The constructor, as a refusal names it
 * @param name - The index
 * @param valueType - The record's row type
 * @param on - The exact leading fields
 * @param spec - The fields and the tile
 * @returns The types the key is built from
 * @throws {Error} Naming the option, the field and why
 */
export function checkTimeTile(constructor: string, name: string, valueType: EastType, on: readonly string[], spec: TimeTileFields): Checked {
  if (valueType.type !== 'Struct') throw new Error(`${constructor} '${name}' indexes a record with Struct rows`);
  const rowType = valueType as StructType<Record<string, EastType>>;
  checkTile(constructor, name, spec.tile);
  if (Object.hasOwn(rowType.fields, TILE_FIELD)) {
    throw new Error(`${constructor} '${name}': the row has a field named '${TILE_FIELD}', which the index reserves for its tile`);
  }
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
  for (const field of [spec.key, TILE_FIELD]) {
    if (on.includes(field)) throw new Error(`${constructor} '${name}': '${field}' follows the leading fields, and cannot be one`);
  }
  const fields = Object.fromEntries(on.map((field) => {
    const type = rowType.fields[field]!;
    return [field, type.type === 'Set' ? type.key : type];
  }));
  const indexType = StructType({ ...fields, [TILE_FIELD]: DateTimeType, [spec.key]: keyField });
  return { rowType, startType, endType, indexType };
}

/**
 * Builds a function of a row's tiles: `(K, V) → C`, the row's start and end
 * read, each tile it touches and its share, under each combination of its
 * leading values, folded into `C` by `put`.
 */
function overTiles(
  keyType: EastType, checked: Checked, on: readonly string[], spec: TimeTileFields,
  prefix: { fn: IndexFunction; multi: boolean } | undefined,
  output: EastType, empty: () => unknown,
  put: ($: any, into: any, ik: any, share: any) => void,
) {
  const shares = tileShares(spec.tile);
  const prefixType = prefix === undefined ? undefined : Expr.type(prefix.fn as unknown as Expr) as { output: EastType };
  // Dynamic field names are erased only inside this generated East function,
  // as in the field, interval and area key generators; every type was checked.
  return East.function([keyType as never, checked.rowType], output as never, ($: any, key: any, row: any) => {
    const tiles = $.const(shares);
    const into = $.let(empty(), output);
    const start = $.let(checked.startType.type === 'DateTime' ? some(row[spec.from]) : row[spec.from], OptionType(DateTimeType));
    const end = $.let(checked.endType.type === 'DateTime' ? some(row[spec.to]) : row[spec.to], OptionType(DateTimeType));
    $.match(start, {
      some: ($: any, from: any) => {
        // No end is an instant at the start; the tiles say so of one at or before it.
        const to = $.let(end.match({ some: (_$: any, to: any) => to, none: () => from }), DateTimeType);
        const touched = $.let(tiles(from, to, East.print(key)));
        const file = ($: any, leading: Record<string, unknown>) => {
          $.for(touched, ($: any, share: any) => {
            put($, into, { ...leading, [TILE_FIELD]: share.tile, [spec.key]: row[spec.key] }, share);
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
 * The series index's key function: `(K, V) → Set<IK>`, an entry per tile a
 * row's event touches, `{ …on, __tile, <key> }` — one per combination of its
 * leading values, a Set among them fanning out, as the interval index's do.
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
  const keys = SetType(checked.indexType);
  const fn = overTiles(keyType, checked, on, spec, prefix, keys, () => new Set(),
    ($, into, ik) => { $(into.tryInsert(ik)); });
  return { fn, multi: true, indexType: checked.indexType };
}

/**
 * The summary index's contributions: `(K, V) → Dict<IK, Totals>`, under each
 * tile a row's event touches — once per combination of its leading values —
 * the count 1 and the milliseconds of the tile it covers.
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
  const totals = DictType(checked.indexType, RecordSummaryTotalsType);
  const fn = overTiles(keyType, checked, on, spec, prefix, totals, () => new Map(),
    ($, into, ik, share) => { $(into.insertOrUpdate(ik, { count: 1n, ms: share.ms })); });
  return { fn, indexType: checked.indexType };
}

/**
 * A summary's merge: the build's pieces hold the same keys, and a key's
 * totals across them are their sum. Integer addition is associative and
 * commutative, so the pieces fold to the same totals in any order.
 *
 * @param indexType - The summary's index key
 * @returns `({ik, k}, Totals, Totals) → Totals`
 */
export function summaryMerge(indexType: EastType) {
  const entry = StructType({ ik: indexType, k: NullType });
  return East.function([entry as never, RecordSummaryTotalsType, RecordSummaryTotalsType], RecordSummaryTotalsType,
    (_$: any, _key: any, a: any, b: any) => ({ count: a.count.add(b.count), ms: a.ms.add(b.ms) }));
}
