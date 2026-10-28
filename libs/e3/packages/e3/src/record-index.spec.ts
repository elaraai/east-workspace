/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's plain indexes — `index.on`, `index.key` and `index.keys`: the
 * declaration, and the program built from it.
 *
 * Every guard here is a definition-time error: an index that is wrong is worse
 * than no index, because the view it serves is quietly wrong rather than
 * missing, so the refusals happen at the developer's desk.
 *
 * The build program is what actually runs, and its two load-bearing properties
 * are asserted by running it: each row's entries come out as the row is read,
 * keyed `{ik, k}` — index key first — for the runner's RunSorter to sort, and a
 * multi-valued index emits one entry per element of the returned set, so an
 * empty set is a row the index does not carry.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, PatchType, SetType, SortedMap, SortedSet, StringType, StructType,
  compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, some, printType, variant, type ValueTypeOf,
} from '@elaraai/east';
import { RecordLevelType, RecordSummaryTotalsType } from '@elaraai/e3-types';
import { record } from './record.js';
import type { IndexBuilder, IndexDraft } from './record-builders.js';
import { functionAt } from './record-guards.js';
import { buildMutationProgram, indexBuildProgram } from './record-programs.js';
import { package_ } from './package.js';
import type { RecordIndexDef } from './types.js';

const RowType = StructType({ status: StringType, due: IntegerType, title: StringType, tags: SetType(StringType), start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
const StatusKeyType = StructType({ status: StringType, due: IntegerType });
const PlansType = DictType(StringType, RowType);

/** The `by_status` declaration: one key per row, with a covering projection. */
const statusKey = East.function([StringType, RowType], StatusKeyType,
  ($, _k, v) => ({ status: v.status, due: v.due }));
const titleOf = East.function([StringType, RowType], StringType, ($, _k, v) => v.title);
/** The `by_tag` declaration: many keys per row. */
const tagKeys = East.function([StringType, RowType], SetType(StringType), ($, _k, v) => v.tags);

/** The plans record declaring the indexes given, each built by `e3.record` under its key and typed as declared. */
const declared = <I extends Readonly<Record<string, IndexDraft>>>(indexes: (index: IndexBuilder<typeof PlansType>) => I) =>
  record('plans', PlansType, { initial: new Map(), indexes });

/** The `[entry, projection]` pairs a build program emits for `rows`. */
function emitted(recordType: typeof PlansType, def: RecordIndexDef, rows: Map<string, unknown>): [unknown, unknown][] {
  const out: [unknown, unknown][] = [];
  const run = indexBuildProgram(recordType, def).compile([]) as (
    slice: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
  run(rows, (entry, value) => {
    out.push([entry, value]);
    return null;
  });
  return out;
}

const rows = new SortedMap<string, ValueTypeOf<typeof RowType>>([
  ['p1', { status: 'late', due: 3n, title: 'One', tags: new Set(['a', 'b']), start: some(new Date(0)), end: some(new Date(86_400_000)) }],
  ['p2', { status: 'ok', due: 1n, title: 'Two', tags: new Set(['b']), start: some(new Date(100)), end: some(new Date(500)) }],
  ['p3', { status: 'late', due: 2n, title: 'Three', tags: new Set(), start: none, end: none }],
], compareFor(StringType));

describe('index.on, index.key and index.keys — the declaration', () => {
  // The typed bindings below are half of each test: they compile only when the
  // declaration carries the exact key and projection types, which are what
  // type a window read through the index — and so every component rendering
  // one. An erased EastType is assignable to none of them.

  it('reads the index key and the projection off the declared functions', () => {
    const index = declared((index) => ({ by_status: index.key(statusKey, { value: titleOf }) })).indexes.by_status;
    const keyType: typeof StatusKeyType = index.keyType;
    const valueType: typeof StringType = index.valueType;
    assert.equal(index.kind, 'recordIndex');
    assert.equal(index.name, 'by_status');
    assert.equal(index.multi, false);
    assert.equal(printType(keyType), printType(StatusKeyType));
    assert.equal(printType(valueType), printType(StringType));
  });

  it('unwraps the element type of a multi-valued index, and carries no value by default', () => {
    const index = declared((index) => ({ by_tag: index.keys(tagKeys) })).indexes.by_tag;
    const keyType: typeof StringType = index.keyType;
    const valueType: typeof NullType = index.valueType;
    assert.equal(index.multi, true);
    assert.equal(printType(keyType), printType(StringType), 'the SET is unwrapped to its element');
    assert.equal(printType(valueType), printType(NullType));
  });

  it('types field indexes and keeps their declared field order', () => {
    const rec = declared((index) => ({
      by_status: index.on(['status']),
      by_status_due: index.on(['status', 'due'], { value: titleOf }),
      by_due_status: index.on(['due', 'status']),
      computed: index.key(statusKey, { value: titleOf }),
    }));
    const one = rec.indexes.by_status;
    const oneType: typeof StringType = one.keyType;
    const fields: readonly ['status'] = one.on;
    assert.equal(printType(oneType), printType(StringType));
    assert.deepEqual(fields, ['status']);
    const pair = rec.indexes.by_status_due;
    const pairType: typeof StatusKeyType = pair.keyType;
    const projection: typeof StringType = pair.valueType;
    assert.equal(printType(pairType), printType(StatusKeyType));
    assert.equal(printType(projection), printType(StringType));
    assert.deepEqual(emitted(PlansType, pair, rows), emitted(PlansType, rec.indexes.computed, rows));
    assert.deepEqual(Object.keys(rec.indexes.by_due_status.keyType.fields), ['due', 'status']);
    assert.equal(rec.indexes.computed.on, undefined);
  });

  it('fans a Set field out, alone and inside a compound key, and omits empty sets', () => {
    const rec = declared((index) => ({
      by_tag: index.on(['tags']),
      computed: index.keys(tagKeys),
      by_status_tag: index.on(['status', 'tags']),
    }));
    const one = rec.indexes.by_tag;
    const keyType: typeof StringType = one.keyType;
    assert.equal(printType(keyType), printType(StringType));
    assert.equal(one.multi, true);
    assert.deepEqual(emitted(PlansType, one, rows), emitted(PlansType, rec.indexes.computed, rows));
    assert.deepEqual(emitted(PlansType, rec.indexes.by_status_tag, rows), [
      [{ ik: { status: 'late', tags: 'a' }, k: 'p1' }, null],
      [{ ik: { status: 'late', tags: 'b' }, k: 'p1' }, null],
      [{ ik: { status: 'ok', tags: 'b' }, k: 'p2' }, null],
    ]);
  });

  it('a package carries the record with its indexes', () => {
    const rec = declared((index) => ({ by_status: index.key(statusKey), by_tag: index.keys(tagKeys) }));
    assert.deepEqual(Object.keys(package_('planning', '1.0.0', rec).records.plans!.indexes).sort(), ['by_status', 'by_tag']);
  });

  describe('refuses, at definition time', () => {
    it('the reserved name, a non-identifier name, and an empty one', () => {
      assert.throws(() => declared((index) => ({ primary: index.key(statusKey) })), /cannot be named 'primary'/);
      assert.throws(() => declared((index) => ({ 'by status': index.key(statusKey) })), /must be an identifier/);
      assert.throws(() => declared((index) => ({ '': index.key(statusKey) })), /non-empty name/);
    });

    it('invalid field declarations', () => {
      assert.throws(() => declared((index) => ({ empty: index.on([]) })), /at least one field/);
      assert.throws(() => declared((index) => ({ repeat: index.on(['status', 'status']) })), /must not repeat/);
      assert.throws(() => declared((index) => ({
        // @ts-expect-error — on names the record row's own fields
        unknown: index.on(['missing']),
      })), /unknown row field 'missing'/);
      assert.throws(() => record('scalar', DictType(StringType, IntegerType), {
        // @ts-expect-error — scalar rows have no field to index
        indexes: (index) => ({ scalar: index.on(['status']) }),
      }), /Struct rows/);
    });

    it('a keys function that does not return a Set', () => {
      assert.throws(() => declared((index) => ({ flat: index.keys(statusKey) })), /must return a Set of index keys/);
    });

    it('a function whose parameters are not the record\'s entry', () => {
      assert.throws(
        () => declared((index) => ({ wrong: index.key(East.function([IntegerType], StringType, ($, _x) => 'only one parameter')) })),
        /must take the record's entry/,
      );
      assert.throws(
        () => declared((index) => ({ wrong_value: index.key(statusKey, { value: East.function([StringType], StringType, ($, k) => k) }) })),
        /'value' projection must take the record's entry/,
      );
    });

    it('a record that is not a Dict — there is no entry to index', () => {
      assert.throws(
        () => record('flags', SetType(StringType), { initial: new Set<string>(), indexes: (index) => ({ on_set: index.key(statusKey) }) }),
        /indexes a Dict record/,
      );
    });

    it('an async function, and one that reaches a platform function', () => {
      assert.throws(
        // Only a dynamic or cast caller reaches this — the typed surface
        // refuses an async function — but a wrong index is a quietly wrong
        // view, so the guard is a runtime one too.
        () => declared((index) => ({ async: index.key(East.asyncFunction([StringType, RowType], StringType, ($, k, _v) => k) as never) })),
        /must be a synchronous East function/,
      );
      // A synchronous platform call is an ordinary function IR, so only the
      // walk over the body finds it — in the key function and the projection
      // alike.
      assert.throws(
        () => declared((index) => ({
          clock: index.key(East.function([StringType, RowType], IntegerType, ($, _k, v) => v.due.add(East.platform('time_now', [], IntegerType)()))),
        })),
        /'key' function must not call platform functions \(found 'time_now'\)/,
      );
      assert.throws(
        () => declared((index) => ({
          clock_value: index.key(statusKey, {
            value: East.function([StringType, RowType], IntegerType, ($, _k, _v) => East.platform('time_now', [], IntegerType)()),
          }),
        })),
        /'value' projection must not call platform functions \(found 'time_now'\)/,
      );
    });
  });
});

describe('a plain index — the build program', () => {
  it('emits each row\'s entry as it reads the row, index key first', () => {
    const out = emitted(PlansType, declared((index) => ({ by_status: index.key(statusKey, { value: titleOf }) })).indexes.by_status, rows);
    assert.deepEqual(out, [
      [{ ik: { status: 'late', due: 3n }, k: 'p1' }, 'One'],
      [{ ik: { status: 'ok', due: 1n }, k: 'p2' }, 'Two'],
      [{ ik: { status: 'late', due: 2n }, k: 'p3' }, 'Three'],
    ]);
  });

  it('emits one entry per element of a multi-valued key, and none for an empty set', () => {
    const out = emitted(PlansType, declared((index) => ({ by_tag: index.keys(tagKeys) })).indexes.by_tag, rows);
    assert.deepEqual(out, [
      [{ ik: 'a', k: 'p1' }, null],
      [{ ik: 'b', k: 'p1' }, null],
      [{ ik: 'b', k: 'p2' }, null],
    ]);
  });

  it('carries Null where an index declares no projection', () => {
    const out = emitted(PlansType, declared((index) => ({ by_status: index.key(statusKey) })).indexes.by_status, rows);
    assert.deepEqual(out.map(([, value]) => value), [null, null, null]);
  });

  it('emits nothing for an empty record', () => {
    assert.deepEqual(emitted(PlansType, declared((index) => ({ by_status: index.key(statusKey) })).indexes.by_status, new Map()), []);
  });
});


describe("a record's indexes — fields through mutation and rebuild", () => {
  it('maintains the same collections that a rebuild emits after insert, update and delete', () => {
    const rec = record('plans', PlansType, {
      initial: new Map(),
      indexes: (index) => ({
        by_status_due: index.on(['status', 'due'], { value: titleOf }),
        by_tag: index.on(['tags']),
        by_time: index.interval({ from: 'start', to: 'end' }),
        by_status_time: index.interval({ on: ['status'], from: 'start', to: 'end' }),
        by_tag_time: index.interval({ on: ['tags'], from: 'start', to: 'end' }),
      }),
      mutations: (mutation) => ({ patch: mutation.patch() }),
    });
    const indexes: RecordIndexDef[] = Object.values(rec.indexes);
    const assembled = package_('field_indexes', '1.0.0', rec).records.plans!;
    assert.deepEqual(assembled.indexes.by_status_due!.on, ['status', 'due']);
    const after = new SortedMap<string, ValueTypeOf<typeof RowType>>([
      ['p1', { status: 'ok', due: 4n, title: 'Updated', tags: new Set(['b', 'c']), start: none, end: none }],
      ['p3', { ...rows.get('p3')!, start: some(new Date(500)), end: some(new Date(1500)) }],
      ['p4', { status: 'new', due: 2n, title: 'Four', tags: new Set(['d']), start: some(new Date(1000)), end: some(new Date(2000)) }],
    ], compareFor(StringType));
    const diff = East.compile(East.function([PlansType, PlansType], PatchType(PlansType), (_$, before, after) => East.diff(before, after)), []);
    const changes: Array<{ index: string; key: unknown; op: unknown }> = [];
    const run = buildMutationProgram(assembled, rec.mutations.patch).compile([]);
    run(rows, diff(rows, after), (key: { type: string; value: unknown }, op: { value: unknown }) => {
      changes.push({ index: key.type, key: key.value, op: op.value });
      return null;
    });
    for (const index of indexes) {
      const keyType = StructType({ ik: index.keyType, k: StringType });
      const collection = DictType(keyType, index.valueType);
      const before = new SortedMap(emitted(PlansType, index, rows) as never, compareFor(keyType));
      const rebuilt = new SortedMap(emitted(PlansType, index, after) as never, compareFor(keyType));
      const ops = new SortedMap(changes.filter((change) => change.index === index.name).map((change) => [change.key, change.op]) as never, compareFor(keyType));
      const apply = East.compile(East.function([collection, PatchType(collection)], collection, (_$, value, patch) => East.applyPatch(value, patch)), []);
      assert.equal(equalFor(collection)(apply(before as never, variant('patch', ops) as never), rebuilt as never), true, index.name);
    }
  });
});

describe('a generated index key reserves no field name (#1432)', () => {
  /** Fields named like e3's own parts, every one a row field the indexes are led by. */
  const NAMES = ['on', 'node', 'at', 'area', 'tile', 'key', 'level', '__interval', '__area', '__tile'] as const;
  const LeadingType = StructType(Object.fromEntries(NAMES.map((name) => [name, StringType])) as Record<(typeof NAMES)[number], typeof StringType>);
  const Named = StructType({ ...LeadingType.fields, press: StringType, start: DateTimeType, end: DateTimeType, x: FloatType, y: FloatType });
  const leading = Object.fromEntries(NAMES.map((name) => [name, `${name} value`])) as ValueTypeOf<typeof LeadingType>;
  // An instant, on Wednesday 7 October: in the week of the 5th.
  const start = new Date('2026-10-07T06:00:00Z');
  const week = new Date('2026-10-05T00:00:00Z');

  it('each kind is led by them, under its key\'s on, its own parts beside them holding what they held before', () => {
    const on = [...NAMES];
    const rec = record('named', DictType(StringType, Named), {
      initial: new Map(),
      indexes: (index) => ({
        // An interval index: the instant filed once, at the tree's root, by its start.
        named_by_time: index.interval({ on, from: 'start', to: 'end' }),
        // An area index: the cell's code an index led by nothing files the same row under.
        named_by_area: index.area({ on, x: 'x', y: 'y', cell: 1 }),
        by_area: index.area({ x: 'x', y: 'y', cell: 1 }),
        // A series index, and a summary's totals: the press, then the week the instant falls in — the series' at its level (#1433).
        named_by_week: index.series({ on, key: 'press', from: 'start', to: 'end', tile: 'week' }),
        named_by_week_totals: index.summary({ on, key: 'press', from: 'start', to: 'end', tile: 'week' }),
      }),
    });
    const { named_by_week_totals: summary, named_by_week: series, by_area: unled, named_by_area: area, named_by_time: interval } = rec.indexes;
    const row = decodeBeast2For(Named)(encodeBeast2For(Named)({ ...leading, press: 'P-1001', start, end: start, x: 1.5, y: 2.5 }));
    assert.equal(printType(interval.keyType), printType(StructType({ on: LeadingType, node: IntegerType, at: DateTimeType })));
    const intervalKeys = East.compile(functionAt(interval.keyFn, [StringType, Named], SetType(interval.keyType)), []);
    assert.ok(equalFor(SetType(interval.keyType))(intervalKeys('r', row),
      new SortedSet([{ on: leading, node: 0n, at: start }], compareFor(interval.keyType))), 'the interval');

    assert.equal(printType(area.keyType), printType(StructType({ on: LeadingType, area: IntegerType })));
    const code = East.compile(functionAt(unled.keyFn, [StringType, Named], unled.keyType), [])('r', row).area;
    const areaKey = East.compile(functionAt(area.keyFn, [StringType, Named], area.keyType), []);
    assert.ok(equalFor(area.keyType)(areaKey('r', row), { on: leading, area: code }), 'the area');

    assert.equal(printType(series.keyType), printType(StructType({ on: LeadingType, key: StringType, level: RecordLevelType, tile: DateTimeType })));
    const seriesKeys = East.compile(functionAt(series.keyFn, [StringType, Named], SetType(series.keyType)), []);
    assert.ok(equalFor(SetType(series.keyType))(seriesKeys('r', row),
      new SortedSet([{ on: leading, key: 'P-1001', level: variant('week', null), tile: week }], compareFor(series.keyType))), 'the series');
    assert.equal(printType(summary.keyType), printType(StructType({ on: LeadingType, key: StringType, tile: DateTimeType })));
    const totalsType = DictType(summary.keyType, RecordSummaryTotalsType);
    const contributions = East.compile(functionAt(summary.keyFn, [StringType, Named], totalsType), []);
    assert.ok(equalFor(totalsType)(contributions('r', row),
      new SortedMap([[{ on: leading, key: 'P-1001', tile: week }, { count: 1n, ms: 0n }]], compareFor(summary.keyType))), 'the summary');

    // Each definition is led by the row's fields alone.
    for (const def of [interval, area, series, summary]) assert.deepEqual(def.on, on);
  });
});
