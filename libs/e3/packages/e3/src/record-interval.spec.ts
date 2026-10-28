/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTimeType, DictType, East, IntegerType, OptionType, SetType, StringType, StructType,
  decodeBeast2For, encodeBeast2For, none, some, type FunctionExpr } from '@elaraai/east';
import { record } from './record.js';
import { recordIndex, type IndexKeyOf, type IndexOn } from './record-index.js';
import { IntervalEntryType, intervalEntries } from './record-interval.js';

const entriesOf = East.compile(intervalEntries, []);
const leaf = 3n * (1n << 53n);

// Compare real, decoded generated keys against the direct interval oracle.
// Include the full supported domain, carry-in, epoch crossing and instants.
test('interval index preserves half-open overlap with at most three entries', () => {
  const extremes = 8_640_000_000_000_000n;
  const spans = [[-extremes, extremes], [-86_400_000n, 86_400_000n], [-1n, 1n], [0n, 0n], [1n, 0n], [0n, 1n]];
  for (let i = 0n; i < 100n; i++) {
    const start = (i * 7919n) % 4_000_000n - 2_000_000n;
    spans.push([start, start + (i * 104729n) % 10_000_000n]);
  }
  for (const [start, end] of spans) {
    const entries = [...decodeBeast2For(SetType(IntervalEntryType))(encodeBeast2For(SetType(IntervalEntryType))(entriesOf(start!, end!)))];
    assert.equal(entries.filter(entry => entry.node === 0n).length, 1);
    assert.ok(entries.length <= 3);
    for (const from of [start! - 1n, start!, start! + 1n, end! - 1n, end!, end! + 1n, 0n]) {
      for (const width of [1n, 86_400_000n]) {
        const to = from + width;
        let hits = entries.filter(entry => entry.node === 0n && entry.at >= from && entry.at < to).length;
        for (let child = leaf + from; child > 1n; child /= 2n) {
          const parent = child / 2n;
          const right = child % 2n === 1n;
          hits += entries.filter(entry => entry.node === 2n * parent + (right ? 1n : 0n)
            && (right ? entry.at > from : entry.at < from)).length;
        }
        const expected = end! <= start! ? start! >= from && start! < to : start! < to && end! > from;
        assert.equal(hits, expected ? 1 : 0, `interval ${start}..${end} in ${from}..${to}`);
      }
    }
  }
});

test('interval indexes retain declared fields, optional backlog and Set-member prefixes through real East IR', () => {
  const Row = StructType({ resources: SetType(StringType), start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
  const records = record('interval_events', DictType(StringType, Row), new Map());
  const index = recordIndex.interval('by_resource_time', records, { on: ['resources'], from: 'start', to: 'end' });
  assert.deepEqual(index.on, ['resources', 'start']);
  assert.deepEqual(index.interval, { from: 'start', to: 'end' });
  assert.equal(index.multi, true);
  const fn = East.compile(index.keyFn as FunctionExpr<any, any>, []) as (key: string, row: unknown) => Set<{ resources: string; __interval: bigint; start: { type: "some"; value: Date } | { type: "none"; value: null } }>;
  const start = new Date('2026-10-01T22:00:00Z');
  const end = new Date('2026-10-03T06:00:00Z');
  const decode = decodeBeast2For(Row);
  const encode = encodeBeast2For(Row);
  const scheduled = fn('night', decode(encode({ resources: new Set(['A', 'B']), start: some(start), end: some(end) })));
  assert.equal([...scheduled].filter(key => key.__interval === 0n).length, 2);
  assert.equal(scheduled.size, 6);
  const from = BigInt(new Date('2026-10-02T00:00:00Z').getTime());
  for (const resource of ['A', 'B']) {
    let hits = 0;
    for (let child = leaf + from; child > 1n; child /= 2n) {
      const right = child % 2n === 1n;
      hits += [...scheduled].filter(key => key.resources === resource && key.__interval === 2n * (child / 2n) + (right ? 1n : 0n)
        && key.start.type === 'some' && (right ? BigInt(key.start.value.getTime()) > from : BigInt(key.start.value.getTime()) < from)).length;
    }
    assert.equal(hits, 1);
  }
  const backlog = fn('backlog', decode(encode({ resources: new Set(['A']), start: none, end: none })));
  assert.deepEqual([...backlog], [{ resources: 'A', __interval: 0n, start: none }]);
  const simple = recordIndex.interval('by_time', records, { from: 'start', to: 'end' });
  assert.deepEqual(simple.on, ['start']);
  const simpleFn = East.compile(simple.keyFn as FunctionExpr<any, any>, []);
  assert.equal(simpleFn('instant', { resources: new Set(), start: some(start), end: none }).size, 1);
  assert.throws(() => recordIndex.interval('bad_interval', records, {
    // @ts-expect-error Only DateTime fields are interval endpoints.
    from: 'resources', to: 'end',
  }), /from names 'resources', of type .+: from is a DateTime or an Option<DateTime> field/);
  assert.throws(() => recordIndex.interval('bad_end', records, {
    // @ts-expect-error Only DateTime fields are interval endpoints.
    from: 'start', to: 'missing',
  }), /to names unknown row field 'missing'/);
  assert.throws(() => recordIndex.interval('valued', records, {
    from: 'start', to: 'end',
    // @ts-expect-error An interval index carries no projection.
    value: East.function([StringType, Row], StringType, ($, k, _v) => k),
  }), /takes on, from, to, not value/);
  // The declared types, as the constructor's spec types them.
  type Spec = { on: ['resources']; from: 'start'; to: 'end' };
  const on: IndexOn<Spec> = ['resources', 'start'];
  const key: IndexKeyOf<Spec, typeof records.type> = StructType({ resources: StringType, __interval: IntegerType, start: OptionType(DateTimeType) });
  assert.ok(on.length === 2 && key.type === 'Struct');
  const declared: StructType<{ resources: typeof StringType; __interval: typeof IntegerType; start: OptionType<typeof DateTimeType> }> = index.keyType;
  assert.equal(declared.type, 'Struct');
});
