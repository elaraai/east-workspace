/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's migrations — the three forms its `migration` builder makes, the
 * chain its declaration lists, and the program a `rows` or `rekey` step runs.
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
import type { MigrationBuilder, MigrationDraft } from './record-builders.js';
import { migrationProgram } from './record-programs.js';
import { package_ } from './package.js';
import type { MigrationDef } from './types.js';

const RowV1Type = StructType({ title: StringType });
const RowV2Type = StructType({ title: StringType, owner: StringType });
const PlansV1Type = DictType(StringType, RowV1Type);
const PlansV2Type = DictType(StringType, RowV2Type);

/** The one step a record of `type` declares, as `e3.record` built it. */
function stepOf(type: EastType, draft: (migration: MigrationBuilder) => MigrationDraft): MigrationDef {
  return record('plans', type, { migrations: (migration) => [draft(migration)] }).migrations[0]!;
}

/** A record declaring a chain of one step of each form, in order: a repair
 *  that keeps the type, a new field on every row, and the rows keyed by title. */
function chain() {
  const rec = record('plans', PlansV2Type, {
    initial: new Map(),
    migrations: (migration) => [
      migration.value('normalize', East.function([PlansV1Type], PlansV1Type, ($, old) => old)),
      migration.rows('add_owner',
        East.function([StringType, RowV1Type], RowV2Type, ($, _id, row) => ({ title: row.title, owner: 'unassigned' }))),
      migration.rekey('by_title',
        East.function([StringType, RowV2Type], StructType({ key: StringType, value: RowV2Type }),
          ($, _id, row) => ({ key: row.title, value: row }))),
    ],
  });
  const [normalize, addOwner, byTitle] = rec.migrations;
  return { rec, normalize: normalize!, addOwner: addOwner!, byTitle: byTitle! };
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

describe("a record's migrations — the declaration", () => {
  it('reads the record\'s types before and after the step off each form\'s function', () => {
    const whole = stepOf(PlansV2Type, (migration) => migration.value('whole', East.function([PlansV1Type], PlansV2Type,
      ($, old) => old.map(($, row) => ({ title: row.title, owner: 'unassigned' })))));
    sameType(whole.from, PlansV1Type);
    sameType(whole.to, PlansV2Type);
    assert.equal(whole.form, 'value');

    const dictRows = stepOf(PlansV2Type, (migration) => migration.rows('dict_rows', East.function([StringType, RowV1Type], RowV2Type,
      ($, _id, row) => ({ title: row.title, owner: 'unassigned' }))));
    sameType(dictRows.from, PlansV1Type);
    sameType(dictRows.to, PlansV2Type);

    const arrayRows = stepOf(ArrayType(StringType), (migration) =>
      migration.rows('array_rows', East.function([IntegerType], StringType, ($, n) => East.print(n))));
    sameType(arrayRows.from, ArrayType(IntegerType));
    sameType(arrayRows.to, ArrayType(StringType));

    const dictKeys = stepOf(PlansV2Type, (migration) => migration.rekey('dict_keys',
      East.function([IntegerType, RowV2Type], StructType({ key: StringType, value: RowV2Type }), ($, _id, row) => ({ key: row.title, value: row }))));
    sameType(dictKeys.from, DictType(IntegerType, RowV2Type));
    sameType(dictKeys.to, PlansV2Type);

    const setKeys = stepOf(SetType(IntegerType), (migration) =>
      migration.rekey('set_keys', East.function([StringType], IntegerType, ($, s) => s.length())));
    sameType(setKeys.from, SetType(StringType));
    sameType(setKeys.to, SetType(IntegerType));
  });

  it('declares the documented examples as they are written', () => {
    const RosterV1Type = DictType(StringType, StructType({ name: StringType }));
    const RosterV2Type = DictType(StringType, StructType({ name: StringType, shift: StringType }));
    const roster = e3.record('roster', RosterV2Type, {
      initial: new Map(),
      migrations: (migration) => [
        // Every row gains a shift, from the whole state.
        migration.value('add_shift', East.function([RosterV1Type], RosterV2Type, ($, old) =>
          old.map(($, row) => ({ name: row.name, shift: 'day' })))),
      ],
    });


    const pkg = e3.package('planning', '2.0.0', roster);
    assert.deepEqual(pkg.records.roster!.migrations.map((step) => step.name), ['add_shift']);

    const RowV1Type = StructType({ title: StringType });
    const RowV2Type = StructType({ title: StringType, owner: StringType });
    const owned = e3.record('plans', DictType(StringType, RowV2Type), {
      initial: new Map(),
      migrations: (migration) => [
        // Each row gains an owner; the keys are unchanged.
        migration.rows('add_owner', East.function([StringType, RowV1Type], RowV2Type,
          ($, id, row) => ({ title: row.title, owner: 'unassigned' }))),
      ],
    });

    assert.equal(e3.package('planning', '2.0.0', owned).records.plans!.migrations.length, 1);

    const PlanType = StructType({ site: StringType, title: StringType });
    const sited = e3.record('plans', DictType(StringType, PlanType), {
      initial: new Map(),
      migrations: (migration) => [
        // Plans were keyed by a number; they are keyed by site and title.
        migration.rekey('by_site', East.function([IntegerType, PlanType], StructType({ key: StringType, value: PlanType }),
          ($, id, plan) => ({ key: East.str`${plan.site}/${plan.title}`, value: plan }))),
      ],
    });

    assert.equal(e3.package('planning', '2.0.0', sited).records.plans!.migrations.length, 1);
  });

  describe('refuses, at definition time', () => {
    const identity = East.function([PlansV2Type], PlansV2Type, ($, old) => old);

    it('a name that is not an identifier', () => {
      assert.throws(() => stepOf(PlansV2Type, (migration) => migration.value('add shift', identity)),
        /^Error: e3\.record 'plans': migration\.value requires a name that is an identifier, got 'add shift'/);
      assert.throws(() => stepOf(PlansV2Type, (migration) => migration.value('', identity)), /requires a name that is an identifier/);
    });

    it('an async function, and one that reaches a platform function', () => {
      assert.throws(
        // Only a dynamic or cast caller reaches this; the typed surface refuses
        // an async function.
        () => stepOf(PlansV2Type, (migration) => migration.value('async', East.asyncFunction([PlansV2Type], PlansV2Type, ($, old) => old) as never)),
        /^Error: e3\.record 'plans': migration\.value 'async' function must be a synchronous East function/,
      );
      assert.throws(
        () => stepOf(DictType(StringType, IntegerType), (migration) => migration.rows('clock', East.function([StringType, RowV1Type], IntegerType,
          ($, _id, _row) => East.platform('time_now', [], IntegerType)()))),
        /^Error: e3\.record 'plans': migration\.rows 'clock' function must not call platform functions \(found 'time_now'\)/,
      );
    });

    it('a function that is not its form\'s', () => {
      assert.throws(
        () => stepOf(PlansV2Type, (migration) => migration.value('two', East.function([StringType, RowV1Type], RowV2Type,
          ($, _id, row) => ({ title: row.title, owner: '' })) as never)),
        /^Error: e3\.record 'plans': migration\.value 'two': a value step's function takes the record's state alone, but takes 2 parameters/,
      );
      assert.throws(
        () => stepOf(PlansV2Type, (migration) => migration.rows('three', East.function([StringType, RowV1Type, IntegerType], RowV2Type,
          ($, _id, row) => ({ title: row.title, owner: '' })) as never)),
        /^Error: e3\.record 'plans': migration\.rows 'three': a rows step's function takes a Dict's row, \(key, value\), or an Array's element, but takes 3 parameters/,
      );
      assert.throws(
        () => stepOf(PlansV2Type, (migration) => migration.rekey('flat', East.function([StringType, RowV2Type], StringType, ($, id) => id) as never)),
        new RegExp(`^Error: e3\\.record 'plans': migration\\.rekey 'flat': a rekey step's function returns a Dict's entry under its new key, \\{ key, value \\}, but returns ${literal(printType(StringType))}`),
      );
      // A key must be a type a key may be, and East says why.
      assert.throws(
        () => stepOf(SetType(StringType), (migration) => migration.rekey('listed', East.function([StringType], ArrayType(StringType), ($, s) => [s]))),
        /^Error: e3\.record 'plans': migration\.rekey 'listed': Set key type must be an immutable type/,
      );
    });

    it('a step after one that leaves the record as another type than it takes', () => {
      assert.throws(
        () => record('plans', PlansV2Type, {
          migrations: (migration) => [
            migration.value('normalize', East.function([PlansV1Type], PlansV1Type, ($, old) => old)),
            migration.value('mismatch', identity),
          ],
        }),
        new RegExp(`^Error: e3\\.record 'plans': migration\\.value 'mismatch' takes the record as ${literal(printType(PlansV2Type))}, but 'normalize', the step before it, leaves it as ${literal(printType(PlansV1Type))}`),
      );
    });
  });
});

describe("a record's migrations — the chain its declaration lists", () => {
  it('runs in the order listed, and a package carries it with the record', () => {
    const { rec } = chain();
    assert.deepEqual(package_('planning', '3.0.0', rec).records.plans!.migrations.map((step) => step.name), ['normalize', 'add_owner', 'by_title']);
  });

  it('keeps a record\'s chain when its package is imported into another', () => {
    const { rec } = chain();
    const outer = package_('outer', '1.0.0', package_('inner', '1.0.0', rec));
    assert.deepEqual(outer.records.plans!.migrations.map((step) => step.name), ['normalize', 'add_owner', 'by_title']);
  });

  it('refuses a chain that does not end at the declared type, and two steps of one name', () => {
    assert.throws(() => record('plans', PlansV2Type, {
      migrations: (migration) => [
        migration.value('short', East.function([PlansV2Type], PlansV1Type, ($, old) => old.map(($, row) => ({ title: row.title })))),
      ],
    }), new RegExp(`^Error: e3\\.record 'plans' is declared as ${literal(printType(PlansV2Type))}, but its last migration, 'short', leaves it as ${literal(printType(PlansV1Type))}$`));
    const toV2 = East.function([StringType, RowV1Type], RowV2Type, ($, _id, row) => ({ title: row.title, owner: '' }));
    const keep = East.function([PlansV2Type], PlansV2Type, ($, old) => old);
    assert.throws(() => record('plans', PlansV2Type, {
      migrations: (migration) => [migration.rows('add_owner', toV2), migration.value('add_owner', keep)],
    }), /^Error: e3\.record 'plans' has two migrations named 'add_owner' — a workspace records the steps it has applied by their names$/);
  });
});

describe("a record's migrations — the program a step runs", () => {
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
    const step = stepOf(ArrayType(StringType), (migration) => migration.rows('printed', East.function([IntegerType], StringType, ($, n) => East.print(n))));
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
    const step = stepOf(SetType(StringType), (migration) => migration.rekey('lower', East.function([StringType], StringType, ($, s) => s.lowerCase())));
    const piece = new SortedSet(['Ann', 'ann', 'Bo'], byKey);
    // The runner's set output unions what it is given, so the two that land on
    // `ann` are one element.
    assert.deepEqual(emitted(step, piece), [['ann'], ['bo'], ['ann']]);
  });

  it('is none for a value step, whose own function runs', () => {
    const { normalize } = chain();
    assert.throws(() => migrationProgram(normalize), /^Error: e3\.record 'plans': migration\.value 'normalize' runs its own function, and has no program$/);
  });
});

/** A type's printed form, escaped for a regular expression. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
