/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Centred interval-tree keys for ordinary maintained record indexes. */
import { DateTimeType, East, IntegerType, NullType, OptionType, SetType, StructType, none, some } from '@elaraai/east';
import type { RecordDef, RecordIndexDef } from './types.js';
import { INDEX_PURITY, checkEntryParams, checkPure, indexRunner, indexedEntry, onlyOptions, signatureOf, type IndexConstructor } from './record-guards.js';
import { checkLeading, checkTimeField, fieldReader, leadingValues, type RowType } from './record-keys.js';

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
  $.if(start.less(-BIAS).or(() => start.greaterEqual(BIAS)).or(() => end.less(-BIAS)).or(() => end.greaterEqual(BIAS)), ($) => {
    $.error('Interval endpoints must be valid DateTime milliseconds');
  });
  // Instants and one-millisecond intervals cannot carry into another
  // millisecond. A missing or non-positive end keeps instant semantics.
  $.if(end.lessEqual(start.add(1n)), ($) => {
    $.return(new Set([{ node: 0n, at: start }]));
  });
  const left = $.let(start.add(BIAS + LEAVES));
  const right = $.let(end.subtract(1n).add(BIAS + LEAVES));
  $.while(left.notEqual(right), ($) => {
    $.assign(left, left.divide(2n));
    $.assign(right, right.divide(2n));
  });
  return new Set([{ node: 0n, at: start }, { node: left.multiply(2n), at: start }, { node: left.multiply(2n).add(1n), at: end }]);
});

/**
 * The entries an event is filed under (`intervalEntries`): with no start, the
 * backlog's one, at node 0; with no end, an instant's.
 *
 * `(start, end) → Set<{ node, at }>`
 * @internal
 */
export const eventEntries = East.function([OptionType(DateTimeType), OptionType(DateTimeType)], SetType(IntervalEntryType), ($, start, end) => {
  const locate = $.const(intervalEntries);
  $.match(start, {
    some: ($, from) => { $.return(locate(from.toEpochMilliseconds(), end.unwrap('some', () => from).toEpochMilliseconds())); },
    none: () => {},
  });
  // No start: the backlog's one entry, at node 0.
  return new Set([{ node: 0n, at: 0n }]);
});

/** `(start, at) → an entry's instant`, at a DateTime start's type. */
const instantAt = East.function([OptionType(DateTimeType), IntegerType], DateTimeType, (_$, _start, at) => East.DateTime.fromEpochMilliseconds(at));

/** `(start, at) → an entry's instant`, at an Option<DateTime> start's type: `none` for the backlog's, an event with no start. */
const optionInstantAt = East.function([OptionType(DateTimeType), IntegerType], OptionType(DateTimeType), ($, start, at) => {
  $.match(start, {
    some: ($) => { $.return(some(East.DateTime.fromEpochMilliseconds(at))); },
    none: () => {},
  });
  return none;
});

/**
 * An interval index's definition (`index.interval`): its key
 * function, `{ on: { …on }, node, at }` an entry, filing each event under at
 * most three entries a combination of its leading values — a Set among them
 * fanning out — and the backlog's, with no start, under node 0. It stays an
 * ordinary multi-entry index: mutation, rebuild, storage and transport are
 * shared.
 *
 * @param constructor - The declaration, as a refusal names it
 * @param name - The index
 * @param rec - Its record
 * @param spec - `from` and `to`, and the optional leading `on`
 * @param config - Its runner selection
 * @returns The definition
 * @throws {Error} When a field is not of its option's type, when the start leads the index, or on any guard every index applies
 */
export function intervalDefinition(
  constructor: IndexConstructor, name: string, rec: RecordDef, spec: { readonly on?: readonly string[]; readonly from: string; readonly to: string },
  config: { runner?: RecordIndexDef['runner'] } | undefined,
): RecordIndexDef {
  const { keyType, valueType } = indexedEntry(constructor, name, rec);
  onlyOptions(constructor, name, spec, ['on', 'from', 'to']);
  if (valueType.type !== 'Struct') throw new Error(`${constructor} '${name}' indexes a record with Struct rows`);
  const rowType: RowType = valueType;
  const start = checkTimeField(constructor, name, rowType, 'from', spec.from);
  const end = checkTimeField(constructor, name, rowType, 'to', spec.to);
  const on = spec.on ?? [];
  // Led by its start and ordered by it again, the index would answer nothing the interval does not.
  if (on.includes(spec.from)) {
    throw new Error(`${constructor} '${name}': its start '${spec.from}' cannot be a leading field — the index orders by it already`);
  }
  const leading = checkLeading(constructor, name, rowType, on);
  // The row's leading fields under `on`, and e3's own parts beside them (#1432): the tree node an entry is filed at,
  // and the instant it is ordered by, at the start field's type.
  const indexType = StructType({ on: leading.onType, node: IntegerType, at: rowType.fields[spec.from]! });
  const readStart = fieldReader(keyType, rowType, { option: start });
  const readEnd = fieldReader(keyType, rowType, { option: end });
  const leads = leadingValues(keyType, rowType, leading);
  // An entry's instant at the start field's type.
  const instant = start.optional ? optionInstantAt : instantAt;
  // An event's entries under one combination of its leading values.
  const entriesUnder = East.function([leading.onType, OptionType(DateTimeType), SetType(IntervalEntryType)], SetType(indexType), ($, on, from, entries) => {
    const at = $.const(instant);
    return entries.toSet((_$, entry) => ({ on, node: entry.node, at: at(from, entry.at) }));
  });
  const keyFn = East.function([keyType, rowType], SetType(indexType), ($, key, row) => {
    const startOf = $.const(readStart);
    const endOf = $.const(readEnd);
    const locate = $.const(eventEntries);
    const combinations = $.const(leads);
    const under = $.const(entriesUnder);
    const from = $.let(startOf(key, row));
    const entries = $.let(locate(from, endOf(key, row)));
    return combinations(key, row).flattenToSet((_$, on) => under(on, from, entries));
  });
  const runner = indexRunner(config);
  checkPure(`${constructor} '${name}' 'keys' function`, keyFn, INDEX_PURITY);
  checkEntryParams(constructor, name, "'keys' function", keyType, valueType, signatureOf(keyFn).inputs);
  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: Object.freeze([...on]),
    interval: Object.freeze({ from: spec.from, to: spec.to }),
    keyFn,
    multi: true,
    keyType: indexType,
    valueType: NullType,
    runner,
  };
}
