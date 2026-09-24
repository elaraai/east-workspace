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
 * are asserted by running it: entries come out in the index collection's own
 * canonical order (`{ik, k}` — index key first), and a multi-valued index
 * emits one entry per element of the returned set, so an empty set is a row
 * the index does not carry.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DictType, East, IntegerType, NullType, SetType, SortedMap, StringType, StructType,
  compareFor, printType,
} from '@elaraai/east';
import { record } from './record.js';
import { recordIndex } from './record-index.js';
import { indexBuildProgram } from './record-programs.js';
import { package_ } from './package.js';

const RowType = StructType({ status: StringType, due: IntegerType, title: StringType, tags: SetType(StringType) });
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

const rows = new SortedMap<string, { status: string; due: bigint; title: string; tags: Set<string> }>([
  ['p1', { status: 'late', due: 3n, title: 'One', tags: new Set(['a', 'b']) }],
  ['p2', { status: 'ok', due: 1n, title: 'Two', tags: new Set(['b']) }],
  ['p3', { status: 'late', due: 2n, title: 'Three', tags: new Set() }],
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
  it('emits in the index collection\'s own order, index key first', () => {
    const out = emitted(PlansType, recordIndex('by_status', plans(), { key: statusKey, value: titleOf }), rows);
    assert.deepEqual(out, [
      [{ ik: { status: 'late', due: 2n }, k: 'p3' }, 'Three'],
      [{ ik: { status: 'late', due: 3n }, k: 'p1' }, 'One'],
      [{ ik: { status: 'ok', due: 1n }, k: 'p2' }, 'Two'],
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
