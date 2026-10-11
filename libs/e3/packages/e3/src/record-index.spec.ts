/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `e3.recordIndex` — the declaration and the program built from it.
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
  DateTimeType, DictType, East, IntegerType, NullType, OptionType, PatchType, SetType, SortedMap, StringType, StructType,
  compareFor, equalFor, none, some, printType, variant, type ValueTypeOf,
} from '@elaraai/east';
import { record } from './record.js';
import { recordIndex } from './record-index.js';
import { buildMutationProgram, indexBuildProgram } from './record-programs.js';
import { mutation } from './mutation.js';
import { package_ } from './package.js';

const RowType = StructType({ status: StringType, due: IntegerType, title: StringType, tags: SetType(StringType), start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
const StatusKeyType = StructType({ status: StringType, due: IntegerType });
const PlansType = DictType(StringType, RowType);

/** The `by_status` declaration: one key per row, with a covering projection. */
const statusKey = East.function([StringType, RowType], StatusKeyType,
  ($, _k, v) => ({ status: v.status, due: v.due }));
const titleOf = East.function([StringType, RowType], StringType, ($, _k, v) => v.title);
/** The `by_tag` declaration: many keys per row. */
const tagKeys = East.function([StringType, RowType], SetType(StringType), ($, _k, v) => v.tags);

const plans = (): ReturnType<typeof record<'plans', typeof PlansType>> =>
  record('plans', PlansType, new Map());

/** The `[entry, projection]` pairs a build program emits for `rows`. */
function emitted(recordType: typeof PlansType, def: ReturnType<typeof recordIndex>, rows: Map<string, unknown>): [unknown, unknown][] {
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

describe('recordIndex — the declaration', () => {
  // The typed bindings below are half of each test: they compile only when the
  // declaration carries the exact key and projection types, which are what
  // type a window read through the index — and so every component rendering
  // one. An erased EastType is assignable to none of them.

  it('reads the index key and the projection off the declared functions', () => {
    const index = recordIndex('by_status', plans(), { key: statusKey, value: titleOf });
    const keyType: typeof StatusKeyType = index.keyType;
    const valueType: typeof StringType = index.valueType;
    assert.equal(index.kind, 'recordIndex');
    assert.equal(index.name, 'by_status');
    assert.equal(index.multi, false);
    assert.equal(printType(keyType), printType(StatusKeyType));
    assert.equal(printType(valueType), printType(StringType));
  });

  it('unwraps the element type of a multi-valued index, and carries no value by default', () => {
    const index = recordIndex('by_tag', plans(), { keys: tagKeys });
    const keyType: typeof StringType = index.keyType;
    const valueType: typeof NullType = index.valueType;
    assert.equal(index.multi, true);
    assert.equal(printType(keyType), printType(StringType), 'the SET is unwrapped to its element');
    assert.equal(printType(valueType), printType(NullType));
  });

  it('types field indexes and keeps their declared field order', () => {
    const one = recordIndex('by_status', plans(), { on: ['status'] });
    const oneType: typeof StringType = one.keyType;
    const fields: readonly ['status'] = one.on;
    assert.equal(printType(oneType), printType(StringType));
    assert.deepEqual(fields, ['status']);
    const pair = recordIndex('by_status_due', plans(), { on: ['status', 'due'], value: titleOf });
    const pairType: typeof StatusKeyType = pair.keyType;
    const projection: typeof StringType = pair.valueType;
    assert.equal(printType(pairType), printType(StatusKeyType));
    assert.equal(printType(projection), printType(StringType));
    assert.deepEqual(emitted(PlansType, pair, rows), emitted(PlansType, recordIndex('computed', plans(), { key: statusKey, value: titleOf }), rows));
    const reversed = recordIndex('by_due_status', plans(), { on: ['due', 'status'] });
    assert.deepEqual(Object.keys(reversed.keyType.fields), ['due', 'status']);
    assert.equal(recordIndex('computed', plans(), { key: statusKey }).on, undefined);
  });

  it('fans a Set field out, alone and inside a compound key, and omits empty sets', () => {
    const one = recordIndex('by_tag', plans(), { on: ['tags'] });
    const keyType: typeof StringType = one.keyType;
    assert.equal(printType(keyType), printType(StringType));
    assert.equal(one.multi, true);
    assert.deepEqual(emitted(PlansType, one, rows), emitted(PlansType, recordIndex('computed', plans(), { keys: tagKeys }), rows));
    const pair = recordIndex('by_status_tag', plans(), { on: ['status', 'tags'] });
    assert.deepEqual(emitted(PlansType, pair, rows), [
      [{ ik: { status: 'late', tags: 'a' }, k: 'p1' }, null],
      [{ ik: { status: 'late', tags: 'b' }, k: 'p1' }, null],
      [{ ik: { status: 'ok', tags: 'b' }, k: 'p2' }, null],
    ]);
  });

  it('is collected onto its record by the package', () => {
    const rec = plans();
    const pkg = package_('planning', '1.0.0', rec,
      recordIndex('by_status', rec, { key: statusKey }),
      recordIndex('by_tag', rec, { keys: tagKeys }));
    assert.deepEqual(Object.keys(pkg.records.plans!.indexes).sort(), ['by_status', 'by_tag']);
  });

  describe('refuses, at definition time', () => {
    it('the reserved name, a non-identifier name, and an empty one', () => {
      assert.throws(() => recordIndex('primary', plans(), { key: statusKey }), /cannot be named 'primary'/);
      assert.throws(() => recordIndex('by status', plans(), { key: statusKey }), /must be an identifier/);
      assert.throws(() => recordIndex('', plans(), { key: statusKey }), /non-empty name/);
    });

    it('a name declared twice on the record', () => {
      const rec = plans();
      const first = recordIndex('by_status', rec, { key: statusKey });
      const second = recordIndex('by_status', rec, { key: statusKey, value: titleOf });
      // A record keeps one index per name. With two it would keep whichever
      // came last, and a page through `by_status` would read the other one.
      assert.throws(() => package_('planning', '1.0.0', rec, first, second),
        /record 'plans' declares two indexes named 'by_status'/);
      // One declaration passed twice is one index.
      assert.deepEqual(Object.keys(package_('planning', '1.0.0', rec, first, first).records.plans!.indexes), ['by_status']);
      // An assembled record carries its indexes, so the name is refused at once.
      const assembled = package_('planning', '1.0.0', rec, first).records.plans!;
      assert.throws(() => recordIndex('by_status', assembled, { key: statusKey }), /already declared/);
    });

    it('both or neither of key and keys', () => {
      assert.throws(() => recordIndex('both', plans(), { key: statusKey, keys: tagKeys }), /exactly one of 'key'/);
      assert.throws(() => recordIndex('neither', plans(), {}), /exactly one of 'key'/);
    });

    it('invalid field declarations and a field declaration beside a computed key', () => {
      assert.throws(() => recordIndex('empty', plans(), { on: [] }), /at least one field/);
      assert.throws(() => recordIndex('repeat', plans(), { on: ['status', 'status'] }), /must not repeat/);
      assert.throws(() => recordIndex('both', plans(), { on: ['status'], key: statusKey }), /exactly one/);
      // @ts-expect-error — on names the record row's own fields
      assert.throws(() => recordIndex('unknown', plans(), { on: ['missing'] }), /unknown row field 'missing'/);
      const scalar = record('scalar', DictType(StringType, IntegerType), new Map());
      // @ts-expect-error — scalar rows have no field to index
      assert.throws(() => recordIndex('scalar', scalar, { on: ['status'] }), /Struct rows/);
    });

    it('a keys function that does not return a Set', () => {
      assert.throws(
        () => recordIndex('flat', plans(), { keys: statusKey }),
        /must return a Set of index keys/,
      );
    });

    it('a function whose parameters are not the record\'s entry', () => {
      assert.throws(
        () => recordIndex('wrong', plans(), { key: East.function([IntegerType], StringType, ($, _x) => 'only one parameter') }),
        /must take the record's entry/,
      );
      assert.throws(
        () => recordIndex('wrong_value', plans(), {
          key: statusKey,
          value: East.function([StringType], StringType, ($, k) => k),
        }),
        /'value' projection must take the record's entry/,
      );
    });

    it('a record that is not a Dict — there is no entry to index', () => {
      const flags = record('flags', SetType(StringType), new Set<string>());
      assert.throws(
        () => recordIndex('on_set', flags as never, { key: statusKey }),
        /indexes a Dict record/,
      );
    });

    it('an async function, and one that reaches a platform function', () => {
      assert.throws(
        // Only a dynamic or cast caller reaches this — the typed surface
        // refuses an async function — but a wrong index is a quietly wrong
        // view, so the guard is a runtime one too.
        () => recordIndex('async', plans(), {
          key: East.asyncFunction([StringType, RowType], StringType, ($, k, _v) => k) as never,
        }),
        /must be a synchronous East function/,
      );
      // A synchronous platform call is an ordinary function IR, so only the
      // walk over the body finds it — in the key function and the projection
      // alike.
      assert.throws(
        () => recordIndex('clock', plans(), {
          key: East.function([StringType, RowType], IntegerType, ($, _k, v) => v.due.add(East.platform('time_now', [], IntegerType)())),
        }),
        /'key' function must not call platform functions \(found 'time_now'\)/,
      );
      assert.throws(
        () => recordIndex('clock_value', plans(), {
          key: statusKey,
          value: East.function([StringType, RowType], IntegerType, ($, _k, _v) => East.platform('time_now', [], IntegerType)()),
        }),
        /'value' projection must not call platform functions \(found 'time_now'\)/,
      );
    });
  });
});

describe('recordIndex — the build program', () => {
  it('emits each row\'s entry as it reads the row, index key first', () => {
    const out = emitted(PlansType, recordIndex('by_status', plans(), { key: statusKey, value: titleOf }), rows);
    assert.deepEqual(out, [
      [{ ik: { status: 'late', due: 3n }, k: 'p1' }, 'One'],
      [{ ik: { status: 'ok', due: 1n }, k: 'p2' }, 'Two'],
      [{ ik: { status: 'late', due: 2n }, k: 'p3' }, 'Three'],
    ]);
  });

  it('emits one entry per element of a multi-valued key, and none for an empty set', () => {
    const out = emitted(PlansType, recordIndex('by_tag', plans(), { keys: tagKeys }), rows);
    assert.deepEqual(out, [
      [{ ik: 'a', k: 'p1' }, null],
      [{ ik: 'b', k: 'p1' }, null],
      [{ ik: 'b', k: 'p2' }, null],
    ]);
  });

  it('carries Null where an index declares no projection', () => {
    const out = emitted(PlansType, recordIndex('by_status', plans(), { key: statusKey }), rows);
    assert.deepEqual(out.map(([, value]) => value), [null, null, null]);
  });

  it('emits nothing for an empty record', () => {
    assert.deepEqual(
      emitted(PlansType, recordIndex('by_status', plans(), { key: statusKey }), new Map()),
      [],
    );
  });
});


describe('recordIndex — fields through mutation and rebuild', () => {
  it('maintains the same collections that a rebuild emits after insert, update and delete', () => {
    const rec = plans();
    const indexes = [
      recordIndex('by_status_due', rec, { on: ['status', 'due'], value: titleOf }),
      recordIndex('by_tag', rec, { on: ['tags'] }),
      recordIndex('by_time', rec, { interval: { from: 'start', to: 'end' } }),
      recordIndex('by_status_time', rec, { on: ['status'], interval: { from: 'start', to: 'end' } }),
      recordIndex('by_tag_time', rec, { on: ['tags'], interval: { from: 'start', to: 'end' } }),
    ];
    const patch = mutation.patch(rec);
    const assembled = package_('field_indexes', '1.0.0', rec, patch, ...indexes).records.plans!;
    assert.deepEqual(assembled.indexes.by_status_due!.on, ['status', 'due']);
    const after = new SortedMap<string, ValueTypeOf<typeof RowType>>([
      ['p1', { status: 'ok', due: 4n, title: 'Updated', tags: new Set(['b', 'c']), start: none, end: none }],
      ['p3', { ...rows.get('p3')!, start: some(new Date(500)), end: some(new Date(1500)) }],
      ['p4', { status: 'new', due: 2n, title: 'Four', tags: new Set(['d']), start: some(new Date(1000)), end: some(new Date(2000)) }],
    ], compareFor(StringType));
    const diff = East.compile(East.function([PlansType, PlansType], PatchType(PlansType), (_$, before, after) => East.diff(before, after)), []);
    const changes: Array<{ index: string; key: unknown; op: unknown }> = [];
    const run = buildMutationProgram(assembled, patch).compile([]);
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
