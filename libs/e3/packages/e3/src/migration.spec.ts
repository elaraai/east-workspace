/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `e3.migration` — the three forms, the chain a package folds them into, and
 * the program a `rows` or `rekey` step runs.
 *
 * Every guard is a definition-time error: a chain that cannot migrate a
 * workspace is refused at the developer's desk, not by a deploy halfway
 * through one. The programs are asserted by running them: each emits one entry
 * per row as it reads the row, for the runner's output to sort, under the key
 * the step gives it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArrayType, DictType, East, IntegerType, SetType, SortedMap, SortedSet, StringType, StructType,
  compareFor, printType, type EastType,
} from '@elaraai/east';
import e3 from './index.js';
import { record } from './record.js';
import { migration } from './migration.js';
import { migrationProgram } from './record-programs.js';
import { package_ } from './package.js';
import type { MigrationDef } from './types.js';

const RowV1Type = StructType({ title: StringType });
const RowV2Type = StructType({ title: StringType, owner: StringType });
const PlansV1Type = DictType(StringType, RowV1Type);
const PlansV2Type = DictType(StringType, RowV2Type);

const plans = (): ReturnType<typeof record<'plans', typeof PlansV2Type>> => record('plans', PlansV2Type, new Map());

/** A chain of one step of each form, in order: a repair that keeps the type,
 *  a new field on every row, and the rows keyed by title. */
function chain(rec = plans()) {
  const normalize = migration.value('normalize', rec,
    East.function([PlansV1Type], PlansV1Type, ($, old) => old));
  const addOwner = migration.rows('add_owner', rec,
    East.function([StringType, RowV1Type], RowV2Type, ($, _id, row) => ({ title: row.title, owner: 'unassigned' })),
    { after: normalize });
  const byTitle = migration.rekey('by_title', rec,
    East.function([StringType, RowV2Type], StructType({ key: StringType, value: RowV2Type }),
      ($, _id, row) => ({ key: row.title, value: row })),
    { after: addOwner });
  return { rec, normalize, addOwner, byTitle };
}

/** What a step's program emits for `piece`, one argument list per call. */
function emitted(def: MigrationDef, piece: unknown): unknown[][] {
  const out: unknown[][] = [];
  const run = migrationProgram(def).compile([]) as (piece: unknown, emit: (...args: unknown[]) => null) => unknown;
  run(piece, (...args: unknown[]) => {
    out.push(args);
    return null;
  });
  return out;
}

const sameType = (a: EastType, b: EastType): void => assert.equal(printType(a), printType(b));

describe('e3.migration — the declaration', () => {
  // The typed bindings are half of each test: they compile only when the step
  // carries the exact record types its function gives.

  it('reads the record\'s types before and after the step off each form\'s function', () => {
    const rec = plans();
    const whole: MigrationDef<'whole', typeof PlansV2Type, typeof PlansV1Type, typeof PlansV2Type> =
      migration.value('whole', rec, East.function([PlansV1Type], PlansV2Type,
        ($, old) => old.map(($, row) => ({ title: row.title, owner: 'unassigned' }))));
    sameType(whole.from, PlansV1Type);
    sameType(whole.to, PlansV2Type);
    assert.equal(whole.form, 'value');

    const dictRows: MigrationDef<'dict_rows', typeof PlansV2Type, DictType<typeof StringType, typeof RowV1Type>, DictType<typeof StringType, typeof RowV2Type>> =
      migration.rows('dict_rows', rec, East.function([StringType, RowV1Type], RowV2Type,
        ($, _id, row) => ({ title: row.title, owner: 'unassigned' })));
    sameType(dictRows.from, PlansV1Type);
    sameType(dictRows.to, PlansV2Type);

    const arrayRows: MigrationDef<'array_rows', typeof PlansV2Type, ArrayType<typeof IntegerType>, ArrayType<typeof StringType>> =
      migration.rows('array_rows', rec, East.function([IntegerType], StringType, ($, n) => East.print(n)));
    sameType(arrayRows.from, ArrayType(IntegerType));
    sameType(arrayRows.to, ArrayType(StringType));

    const dictKeys: MigrationDef<'dict_keys', typeof PlansV2Type, DictType<typeof IntegerType, typeof RowV2Type>, DictType<typeof StringType, typeof RowV2Type>> =
      migration.rekey('dict_keys', rec, East.function([IntegerType, RowV2Type], StructType({ key: StringType, value: RowV2Type }),
        ($, _id, row) => ({ key: row.title, value: row })));
    sameType(dictKeys.from, DictType(IntegerType, RowV2Type));
    sameType(dictKeys.to, PlansV2Type);

    const setKeys: MigrationDef<'set_keys', typeof PlansV2Type, SetType<typeof StringType>, SetType<typeof IntegerType>> =
      migration.rekey('set_keys', rec, East.function([StringType], IntegerType, ($, s) => s.length()));
    sameType(setKeys.from, SetType(StringType));
    sameType(setKeys.to, SetType(IntegerType));
  });

  it('declares the documented examples as they are written', () => {
    const RosterV1Type = DictType(StringType, StructType({ name: StringType }));
    const RosterV2Type = DictType(StringType, StructType({ name: StringType, shift: StringType }));
    const roster = e3.record('roster', RosterV2Type, new Map());

    // Every row gains a shift, from the whole state.
    const addShift = e3.migration.value('add_shift', roster,
      East.function([RosterV1Type], RosterV2Type, ($, old) =>
        old.map(($, row) => ({ name: row.name, shift: 'day' }))));

    const pkg = e3.package('planning', '2.0.0', roster, addShift);
    assert.deepEqual(pkg.records.roster!.migrations.map((step) => step.name), ['add_shift']);

    const RowV1Type = StructType({ title: StringType });
    const RowV2Type = StructType({ title: StringType, owner: StringType });
    const owned = e3.record('plans', DictType(StringType, RowV2Type), new Map());

    // Each row gains an owner; the keys are unchanged.
    const addOwner = e3.migration.rows('add_owner', owned,
      East.function([StringType, RowV1Type], RowV2Type,
        ($, id, row) => ({ title: row.title, owner: 'unassigned' })));
    assert.equal(e3.package('planning', '2.0.0', owned, addOwner).records.plans!.migrations.length, 1);

    const PlanType = StructType({ site: StringType, title: StringType });
    const sited = e3.record('plans', DictType(StringType, PlanType), new Map());

    // Plans were keyed by a number; they are keyed by site and title.
    const bySite = e3.migration.rekey('by_site', sited,
      East.function([IntegerType, PlanType], StructType({ key: StringType, value: PlanType }),
        ($, id, plan) => ({ key: East.str`${plan.site}/${plan.title}`, value: plan })));
    assert.equal(e3.package('planning', '2.0.0', sited, bySite).records.plans!.migrations.length, 1);
  });

  describe('refuses, at definition time', () => {
    const identity = East.function([PlansV2Type], PlansV2Type, ($, old) => old);

    it('a name that is not an identifier', () => {
      assert.throws(() => migration.value('add shift', plans(), identity),
        /e3.migration.value requires a name that is an identifier, got 'add shift'/);
      assert.throws(() => migration.value('', plans(), identity), /requires a name that is an identifier/);
    });

    it('an async function, and one that reaches a platform function', () => {
      assert.throws(
        // Only a dynamic or cast caller reaches this; the typed surface refuses
        // an async function.
        () => migration.value('async', plans(), East.asyncFunction([PlansV2Type], PlansV2Type, ($, old) => old) as never),
        /e3.migration.value 'async' function must be a synchronous East function/,
      );
      assert.throws(
        () => migration.rows('clock', plans(), East.function([StringType, RowV1Type], IntegerType,
          ($, _id, _row) => East.platform('time_now', [], IntegerType)())),
        /e3.migration.rows 'clock' function must not call platform functions \(found 'time_now'\)/,
      );
    });

    it('a function that is not its form\'s', () => {
      assert.throws(
        () => migration.value('two', plans(), East.function([StringType, RowV1Type], RowV2Type,
          ($, _id, row) => ({ title: row.title, owner: '' })) as never),
        /e3.migration.value 'two': a value step's function takes the record's state alone, but takes 2 parameters/,
      );
      assert.throws(
        () => migration.rows('three', plans(), East.function([StringType, RowV1Type, IntegerType], RowV2Type,
          ($, _id, row) => ({ title: row.title, owner: '' })) as never),
        /e3.migration.rows 'three': a rows step's function takes a Dict's row, \(key, value\), or an Array's element, but takes 3 parameters/,
      );
      assert.throws(
        () => migration.rekey('flat', plans(), East.function([StringType, RowV2Type], StringType, ($, id) => id) as never),
        new RegExp(`e3.migration.rekey 'flat': a rekey step's function returns a Dict's entry under its new key, \\{ key, value \\}, but returns ${literal(printType(StringType))}`),
      );
      // A key must be a type a key may be, and East says why.
      assert.throws(
        () => migration.rekey('listed', plans(), East.function([StringType], ArrayType(StringType), ($, s) => [s])),
        /e3.migration.rekey 'listed': Set key type must be an immutable type/,
      );
    });

    it('a step after another record\'s, or after one that leaves the record as another type', () => {
      const other = record('other', PlansV2Type, new Map());
      const elsewhere = migration.value('elsewhere', other, identity);
      assert.throws(
        () => migration.value('here', plans(), identity, { after: elsewhere }),
        /e3.migration.value 'here' follows 'elsewhere', a migration of record 'other' — a step follows a migration of its own record, 'plans'/,
      );
      const { rec, normalize } = chain();
      assert.throws(
        () => migration.value('mismatch', rec, identity, { after: normalize }),
        new RegExp(`e3.migration.value 'mismatch' takes the record as ${literal(printType(PlansV2Type))}, but 'normalize', the step before it, leaves it as ${literal(printType(PlansV1Type))}`),
      );
    });
  });
});

describe('e3.migration — the chain a package folds', () => {
  it('takes a step\'s predecessors from its after, in the order they run', () => {
    const { rec, normalize, addOwner, byTitle } = chain();
    // Passing the last step passes the chain, and the order is the chain's
    // whatever order the steps are passed in.
    for (const pkg of [package_('planning', '3.0.0', byTitle), package_('planning', '3.0.0', byTitle, rec, normalize, addOwner)]) {
      assert.deepEqual(pkg.records.plans!.migrations.map((step) => step.name), ['normalize', 'add_owner', 'by_title']);
    }
  });

  it('keeps a record\'s chain when its package is imported into another', () => {
    const { byTitle } = chain();
    const outer = package_('outer', '1.0.0', package_('inner', '1.0.0', byTitle));
    assert.deepEqual(outer.records.plans!.migrations.map((step) => step.name), ['normalize', 'add_owner', 'by_title']);
  });

  it('refuses two firsts, two steps after one, and a chain that does not end at the declared type', () => {
    const rec = plans();
    const toV2 = East.function([StringType, RowV1Type], RowV2Type, ($, _id, row) => ({ title: row.title, owner: '' }));
    const first = migration.rows('first', rec, toV2);
    const second = migration.rows('second', rec, toV2);
    assert.throws(() => package_('planning', '3.0.0', first, second),
      /e3.package 'planning': record 'plans' has 2 migrations with no 'after' \('first', 'second'\) — its migrations are one chain/);

    const keep = East.function([PlansV2Type], PlansV2Type, ($, old) => old);
    const left = migration.value('left', rec, keep, { after: first });
    const right = migration.value('right', rec, keep, { after: first });
    assert.throws(() => package_('planning', '3.0.0', left, right),
      /record 'plans' has two migrations after 'first', 'left' and 'right' — its migrations are one chain/);

    const short = migration.value('short', rec, East.function([PlansV2Type], PlansV1Type,
      ($, old) => old.map(($, row) => ({ title: row.title }))));
    assert.throws(() => package_('planning', '3.0.0', short),
      new RegExp(`record 'plans' is declared as ${literal(printType(PlansV2Type))}, but its last migration, 'short', leaves it as ${literal(printType(PlansV1Type))}`));
  });

  it('refuses two different migrations of one name, and takes one passed twice once', () => {
    const rec = plans();
    const toV2 = East.function([StringType, RowV1Type], RowV2Type, ($, _id, row) => ({ title: row.title, owner: '' }));
    const once = migration.rows('add_owner', rec, toV2);
    const again = migration.rows('add_owner', rec, toV2);
    assert.throws(() => package_('planning', '3.0.0', once, again), /record 'plans' declares two migrations named 'add_owner'/);
    assert.deepEqual(package_('planning', '3.0.0', once, once).records.plans!.migrations.map((step) => step.name), ['add_owner']);
  });
});

describe('e3.migration — the program a step runs', () => {
  const byKey = compareFor(StringType);

  it('emits each Dict row under its own key, as the function rewrites it', () => {
    const { addOwner } = chain();
    const piece = new SortedMap([['p1', { title: 'One' }], ['p2', { title: 'Two' }]], byKey);
    assert.deepEqual(emitted(addOwner, piece), [
      ['p1', { title: 'One', owner: 'unassigned' }],
      ['p2', { title: 'Two', owner: 'unassigned' }],
    ]);
  });

  it('emits an Array\'s elements in order', () => {
    const step = migration.rows('printed', plans(), East.function([IntegerType], StringType, ($, n) => East.print(n)));
    assert.deepEqual(emitted(step, [3n, 1n, 2n]), [['3'], ['1'], ['2']]);
  });

  it('emits each Dict row under the key the function gives it, in the order read', () => {
    const { byTitle } = chain();
    const piece = new SortedMap([
      ['p1', { title: 'Zed', owner: 'ana' }],
      ['p2', { title: 'Alpha', owner: 'bo' }],
    ], byKey);
    // Out of key order: the runner's dict output sorts what it is given, and
    // refuses a key given twice.
    assert.deepEqual(emitted(byTitle, piece), [
      ['Zed', { title: 'Zed', owner: 'ana' }],
      ['Alpha', { title: 'Alpha', owner: 'bo' }],
    ]);
  });

  it('emits each Set element as the function maps it, two landing on one among them', () => {
    const step = migration.rekey('lower', plans(), East.function([StringType], StringType, ($, s) => s.lowerCase()));
    const piece = new SortedSet(['Ann', 'ann', 'Bo'], byKey);
    // The runner's set output unions what it is given, so the two that land on
    // `ann` are one element.
    assert.deepEqual(emitted(step, piece), [['ann'], ['bo'], ['ann']]);
  });

  it('is none for a value step, whose own function runs', () => {
    const { normalize } = chain();
    assert.throws(() => migrationProgram(normalize), /e3.migration.value 'normalize' runs its own function, and has no program/);
  });
});

/** A type's printed form, escaped for a regular expression. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
