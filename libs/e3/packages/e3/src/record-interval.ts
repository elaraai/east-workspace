/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Centred interval-tree keys for ordinary maintained record indexes. */
import { DateTimeType, East, Expr, IntegerType, OptionType, SetType, StructType, isTypeEqual, none, some,
  type EastType, type FunctionExpr } from '@elaraai/east';
import type { IndexFunction } from './record-index.js';

/** The signed millisecond domain containing every valid JavaScript Date. */
const BIAS = 1n << 53n;
const LEAVES = 1n << 54n;

/** Internal millisecond key before the row's declared DateTime type is restored. */
export const IntervalEntryType = StructType({ node: IntegerType, at: IntegerType });

/**
 * Node zero stores the start. A positive-duration event is stored at the
 * lowest common ancestor of its first and last included milliseconds, once
 * ordered by start (even node code), once by end (odd node code).
 *
 * Every interval at a node crosses its centre. A carry-in query walks the
 * ancestors of its lower bound: to the left of a centre it needs start < from;
 * to the right it needs end > from. Each event lives at just one ancestor,
 * and these carry-in results are disjoint from starts inside the window.
 * At most 54 iterations and THREE entries, independent of event duration.
 * @internal
 */
export const intervalEntries = East.function([IntegerType, IntegerType], SetType(IntervalEntryType), ($, start, end) => {
  const entries = $.let(new Set<{ node: bigint; at: bigint }>(), SetType(IntervalEntryType));
  $(entries.insert({ node: 0n, at: start }));
  $.if(start.less(-BIAS).or(() => start.greaterEqual(BIAS)).or(() => end.less(-BIAS)).or(() => end.greaterEqual(BIAS)), ($) => {
    $.error('Interval endpoints must be valid DateTime milliseconds');
  });
  // Instants and one-millisecond intervals cannot carry into another
  // millisecond. A missing or non-positive end keeps instant semantics.
  $.if(end.greater(start.add(1n)), ($) => {
    const left = $.let(start.add(BIAS + LEAVES));
    const right = $.let(end.subtract(1n).add(BIAS + LEAVES));
    $.while(left.notEqual(right), ($) => {
      $.assign(left, left.divide(2n));
      $.assign(right, right.divide(2n));
    });
    $(entries.insert({ node: left.multiply(2n), at: start }));
    $(entries.insert({ node: left.multiply(2n).add(1n), at: end }));
  });
  return entries;
});

/**
 * Generate the pure key function, using the existing field-index function for
 * all leading fields (including Set membership). This stays an ordinary
 * multi-entry index: mutation, rebuild, storage and transport are shared.
 * @param name - Index name for authoring errors.
 * @param keyType - Primary key type.
 * @param valueType - Record row type.
 * @param on - Exact leading fields.
 * @param interval - Start and end row fields.
 * @param prefix - The standard generated field-index key function.
 * @returns The generated keys and its fan-out flag.
 */
export function intervalKey(name: string, keyType: EastType, valueType: EastType, on: readonly string[],
  interval: { from: string; to: string }, prefix?: { fn: IndexFunction; multi: boolean }) {
  if (valueType.type !== 'Struct') throw new Error(`e3.recordIndex '${name}' interval requires Struct rows`);
  const rowType = valueType as StructType<Record<string, EastType>>;
  const startType = rowType.fields[interval.from];
  const endType = rowType.fields[interval.to];
  for (const [field, type] of [[interval.from, startType], [interval.to, endType]] as const) {
    if (type === undefined || (!isTypeEqual(type, DateTimeType) && !isTypeEqual(type, OptionType(DateTimeType)))) {
      throw new Error(`e3.recordIndex '${name}' interval field '${field}' must be DateTime or Option<DateTime>`);
    }
  }
  if (on.includes(interval.from) || on.includes('__interval') || interval.from === '__interval') {
    throw new Error(`e3.recordIndex '${name}' interval start and reserved '__interval' cannot be leading fields`);
  }
  const fields = Object.fromEntries(on.map(field => {
    const type = rowType.fields[field]!;
    return [field, type.type === 'Set' ? type.key : type];
  }));
  const indexType = StructType({ ...fields, __interval: IntegerType, [interval.from]: startType! });
  const prefixType = prefix === undefined ? undefined : Expr.type(prefix.fn as unknown as Expr) as { output: EastType };
  // Dynamic field names are erased only inside this generated East function,
  // as in the standard field-key generator; all types were checked above.
  const fn = East.function([keyType as never, rowType], SetType(indexType), ($: any, key: any, row: any) => {
    const locate = $.const(intervalEntries);
    const start = $.let(startType!.type === 'DateTime' ? some(row[interval.from]) : row[interval.from], OptionType(DateTimeType));
    const end = $.let(endType!.type === 'DateTime' ? some(row[interval.to]) : row[interval.to], OptionType(DateTimeType));
    const entries = $.let(new Set([{ node: 0n, at: 0n }]), SetType(IntervalEntryType));
    $.match(start, { some: ($: any, from: any) => {
      const to = $.let(end.match({ some: (_$: any, to: any) => to, none: () => from }));
      $.assign(entries, locate(from.toEpochMilliseconds(), to.toEpochMilliseconds()));
    } });
    const keys = $.let(new Set(), SetType(indexType));
    const append = ($: any, values: any) => {
      const leading = Object.fromEntries(on.map(field => [field, on.length === 1 ? values : values[field]]));
      $.for(entries, ($: any, entry: any) => {
        const date = $.let(East.DateTime.fromEpochMilliseconds(entry.at));
        const at = startType!.type === 'DateTime' ? date
          : start.match({ some: () => some(date), none: () => none });
        $(keys.insert({ ...leading, __interval: entry.node, [interval.from]: at }));
      });
    };
    if (prefix === undefined) append($, undefined);
    else {
      const make = $.const(prefix.fn as FunctionExpr<any, any>);
      const values = $.let(make(key, row), prefixType!.output);
      if (prefix.multi) $.for(values, ($: any, value: any) => append($, value));
      else append($, values);
    }
    return keys;
  });
  return { fn, multi: true };
}
