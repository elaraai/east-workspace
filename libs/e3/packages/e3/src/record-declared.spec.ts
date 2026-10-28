/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record declared whole: `e3.record(name, type, { initial, indexes,
 * mutations, migrations })` builds each part through the builder it hands the
 * declaration, under its key or in its place in the list, over the record
 * itself, and freezes them. What TypeScript reads off the one call — each
 * part's name and types, and a field a part names held to the row — is checked
 * here as it compiles; each refusal names the record and the part.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DateTimeType, DictType, East, FloatType, NullType, SetType, StringType, StructType, isTypeEqual, type EastType,
} from '@elaraai/east';
import { record, type RecordConfig } from './record.js';
import type { IndexDraft, MutationDraft } from './record-builders.js';
import { mutation } from './mutation.js';
import { package_ } from './package.js';
import { builtIndex } from './record-programs.js';

const Job = StructType({ product: StringType, start: DateTimeType, end: DateTimeType });
/** A machine: where it stands, when it is planned, and what it nests. */
const Machine = StructType({
  name: StringType, site: StringType, status: StringType, planned_start: DateTimeType, planned_end: DateTimeType,
  jobs: DictType(StringType, Job), load: DictType(DateTimeType, FloatType),
});
const Machines = DictType(StringType, Machine);
const MachinesV1 = DictType(StringType, StructType({ name: StringType }));

const startOf = East.function([StringType, Machine], DateTimeType, (_$, _key, row) => row.planned_start);
const statusesOf = East.function([StringType, Machine], SetType(StringType), ($, _key, row) => {
  const statuses = $.let(new Set<string>(), SetType(StringType));
  $(statuses.insert(row.status));
  return statuses;
});
const nameOf = East.function([StringType, Machine], StringType, (_$, _key, row) => row.name);
const setStatus = East.function([Machines, StringType, StringType], Machines, (_$, state, _id, _status) => state);
const retire = East.function([Machines, StringType, mutation.editType(Machines)], NullType, ($, _state, id, edit) => {
  $(edit.delete(id));
});
const named = East.function([MachinesV1], MachinesV1, (_$, old) => old);
const filled = East.function([StringType, StructType({ name: StringType })], Machine, (_$, _id, old) => ({
  name: old.name, site: '', status: 'idle', planned_start: new Date(0), planned_end: new Date(0), jobs: new Map(), load: new Map(),
}));

/** The machines, declared whole: every index kind, every write form, and a chain of two steps. */
function machines() {
  return record('machines', Machines, {
    initial: new Map(),
    indexes: (index) => ({
      by_site: index.on(['site']),
      by_site_status: index.on(['site', 'status'], { value: nameOf }),
      by_start: index.key(startOf),
      by_statuses: index.keys(statusesOf),
      in_window: index.interval({ from: 'planned_start', to: 'planned_end' }),
      planned: index.series({ key: 'site', from: 'planned_start', to: 'planned_end', tile: 'week' }),
      in_time: index.nested({
        collections: { jobs: index.nested.items({ from: 'start', to: 'end' }), load: index.nested.values() },
        tile: 'week',
        summary: 'month',
      }),
      busy: index.summary({ key: 'site', from: 'planned_start', to: 'planned_end', tile: 'day' }),
    }),
    mutations: (mutation) => ({
      set_status: mutation.reduce(setStatus),
      retire: mutation.edit(retire),
      patch: mutation.patch(),
    }),
    migrations: (migration) => [
      migration.value('name_machines', named),
      migration.rows('fill_machines', filled),
    ],
  });
}

describe('e3.record declared whole', () => {
  it('builds each index under its key, over the record, in the order declared', () => {
    const rec = machines();
    assert.deepEqual(Object.keys(rec.indexes), ['by_site', 'by_site_status', 'by_start', 'by_statuses', 'in_window', 'planned', 'in_time', 'busy']);
    for (const [key, index] of Object.entries(rec.indexes)) {
      assert.equal(index.name, key, `${key} is named by its key`);
      assert.equal(index.record, rec, `${key} is the record's`);
    }
    assert.ok(isTypeEqual(rec.indexes.by_site.keyType, StringType), "by_site's key is the site");
    assert.ok(isTypeEqual(rec.indexes.by_site_status.valueType, StringType), 'by_site_status carries the name it projects');
    assert.ok(isTypeEqual(rec.indexes.by_start.keyType, DateTimeType), "by_start's key is what its function returns");
    assert.ok(isTypeEqual(rec.indexes.by_statuses.keyType, StringType), "by_statuses' key is an element of the Set its function returns");
    assert.equal(rec.indexes.by_statuses.multi, true);
    assert.equal(rec.indexes.in_window.interval.from, 'planned_start');
    assert.equal(rec.indexes.planned.series.tile, 'week');
    assert.equal(rec.indexes.in_time.nested.summary, 'month');
    assert.equal(rec.indexes.busy.summary.tile, 'day');
  });

  it('builds each mutation under its key, its arguments read off its function', () => {
    const rec = machines();
    assert.deepEqual(Object.keys(rec.mutations), ['set_status', 'retire', 'patch']);
    assert.deepEqual(Object.values(rec.mutations).map((m) => [m.name, m.form, m.record === rec]), [
      ['set_status', 'reduce', true], ['retire', 'edit', true], ['patch', 'patch', true],
    ]);
    assert.equal(rec.mutations.set_status.argTypes.length, 2);
    assert.ok(rec.mutations.set_status.argTypes.every((t: EastType) => isTypeEqual(t, StringType)), 'set_status takes the id and the status');
    assert.ok(isTypeEqual(rec.mutations.retire.argTypes[0]!, StringType), 'retire takes the id, the edit capability apart');
  });

  it('builds its migrations in the order listed, each after the one before, the last leaving the record as its type', () => {
    const rec = machines();
    assert.deepEqual(rec.migrations.map((step) => [step.name, step.after?.name]), [['name_machines', undefined], ['fill_machines', 'name_machines']]);
    assert.ok(isTypeEqual(rec.migrations.at(-1)!.to, Machines));
  });

  it('holds its initial state, and none when it is committed from outside', () => {
    assert.equal(machines().default instanceof Map, true);
    assert.equal(record('later', Machines, { indexes: (index) => ({ by_site: index.on(['site']) }) }).default, undefined);
  });

  it('carries its rows without their collections in its other indexes, whichever is declared first', () => {
    const rec = machines();
    // by_site is declared before the nested index, and carries the lean machine all the same: the record knows both.
    assert.ok(isTypeEqual(builtIndex(rec, rec.indexes.by_site).valueType, Machine));
    assert.notEqual(builtIndex(rec, rec.indexes.by_site), rec.indexes.by_site);
    assert.equal(builtIndex(rec, rec.indexes.in_time), rec.indexes.in_time, 'the nested index is built as declared');
    assert.equal(builtIndex(rec, rec.indexes.by_site_status), rec.indexes.by_site_status, 'an index with a value of its own carries its own');
  });

  it('is never added to once declared', () => {
    const rec = machines();
    assert.ok(Object.isFrozen(rec.indexes) && Object.isFrozen(rec.mutations) && Object.isFrozen(rec.migrations));
    assert.throws(() => { (rec.indexes as Record<string, unknown>).extra = rec.indexes.by_site; }, TypeError);
  });

  it('is a package whole: the package builds what the record declares', () => {
    const rec = machines();
    const packaged = package_('plant', '1.0.0', rec).records.machines!;
    assert.deepEqual(Object.keys(packaged.indexes), Object.keys(rec.indexes));
    assert.deepEqual(Object.keys(packaged.mutations), Object.keys(rec.mutations));
    assert.deepEqual(packaged.migrations.map((step) => step.name), ['name_machines', 'fill_machines']);
  });

  it('types each part by its key, and holds each field a part names to the row', () => {
    const rec = machines();
    // Each part's name is its key, as a literal; each index's types as its builder read them.
    const siteName: 'by_site' = rec.indexes.by_site.name;
    const tile: 'week' = rec.indexes.in_time.nested.tile;
    const patchName: 'patch' = rec.mutations.patch.name;
    assert.deepEqual([siteName, tile, patchName], ['by_site', 'week', 'patch']);
    // A field no machine has is refused as it is written, and where it is declared.
    assert.throws(() => record('typo', Machines, {
      indexes: (index) => ({
        // @ts-expect-error 'sitee' is not a field of a machine
        by_site: index.on(['sitee']),
      }),
    }), /^Error: e3\.record 'typo': index\.on 'by_site' on names unknown row field 'sitee'$/);
    assert.throws(() => record('typo', Machines, {
      indexes: (index) => ({
        // @ts-expect-error a series index's key is a field of the row
        planned: index.series({ key: 'sitee', from: 'planned_start', to: 'planned_end', tile: 'week' }),
      }),
    }), /^Error: e3\.record 'typo': index\.series 'planned' key names unknown row field 'sitee'$/);
    assert.throws(() => record('typo', Machines, {
      indexes: (index) => ({
        // @ts-expect-error 'jobz' is no collection of a machine
        in_time: index.nested({ collections: { jobz: index.nested.values() }, tile: 'week' }),
      }),
    }), /^Error: e3\.record 'typo': index\.nested 'in_time' collections names unknown row field 'jobz'$/);
    assert.throws(() => record('typo', Machines, {
      mutations: (mutation) => ({
        // @ts-expect-error a reducer returns the record's type
        set_status: mutation.reduce(East.function([Machines], StringType, () => 'idle')),
      }),
    }), /e3\.record 'typo': mutation\.reduce 'set_status' reducer must return the record's state type/);
  });
});

describe('e3.record refuses, naming the record and the part', () => {
  const declare = <I extends Readonly<Record<string, IndexDraft>>, M extends Readonly<Record<string, MutationDraft>>>(
    config: RecordConfig<typeof Machines, I, M>,
  ) => () => record('m', Machines, config);

  it("an index's name that is not an identifier, or is primary", () => {
    assert.throws(declare({ indexes: (index) => ({ 'by site': index.on(['site']) }) }),
      /^Error: e3\.record 'm': index\.on 'by site' must be an identifier — it names a query selector in URLs and on the command line\.$/);
    assert.throws(declare({ indexes: (index) => ({ primary: index.on(['site']) }) }),
      /^Error: e3\.record 'm': index\.on cannot be named 'primary'/);
  });

  it('a second nested series index, naming the first', () => {
    assert.throws(declare({
      indexes: (index) => ({
        in_time: index.nested({ collections: { load: index.nested.values() }, tile: 'week' }),
        again: index.nested({ collections: { jobs: index.nested.items({ from: 'start', to: 'end' }) }, tile: 'day' }),
      }),
    }), /^Error: e3\.record 'm': index\.nested 'again': record 'm' has a nested series index already, 'in_time' — one declares every collection a record nests$/);
  });

  it("a series index given collections, and a nested one given a series index's fields, each naming the other", () => {
    assert.throws(declare({
      // @ts-expect-error collections are the nested index's
      indexes: (index) => ({ in_time: index.series({ collections: { load: index.nested.values() }, tile: 'week' }) }),
    }), /^Error: e3\.record 'm': index\.series 'in_time' takes key, from, to and tile — collections are a nested series index's: index\.nested\(\{ collections, tile, summary\? \}\)$/);
    assert.throws(declare({
      // @ts-expect-error key, from and to are a series index's
      indexes: (index) => ({ in_time: index.nested({ collections: { load: index.nested.values() }, key: 'site', from: 'planned_start', to: 'planned_end', tile: 'week' }) }),
    }), /^Error: e3\.record 'm': index\.nested 'in_time' takes collections, tile and summary — key, from and to file the record's own events: index\.series\(\{ key, from, to, tile \}\)$/);
  });

  it('an option a builder does not take', () => {
    assert.throws(declare({
      // @ts-expect-error an interval index carries nothing of its own
      indexes: (index) => ({ in_window: index.interval({ from: 'planned_start', to: 'planned_end' }, { value: nameOf }) }),
    }), /^Error: e3\.record 'm': index\.interval 'in_window' takes runner, not value$/);
  });

  it('a part its builder did not make', () => {
    assert.throws(declare({
      // @ts-expect-error an index is made by the index builder
      indexes: () => ({ by_site: { on: ['site'] } }),
    }), /^Error: e3\.record 'm': index 'by_site' is not one the index builder made/);
    assert.throws(declare({
      // @ts-expect-error the parts come back by name
      indexes: (index) => [index.on(['site'])],
    }), /^Error: e3\.record 'm': indexes returns its parts by name, as an object/);
  });

  it("a mutation's name that is not an identifier", () => {
    assert.throws(declare({ mutations: (mutation) => ({ 'my patch': mutation.patch() }) }),
      /^Error: e3\.record 'm': mutation\.patch requires a name that is an identifier, got 'my patch'/);
  });

  it('migrations: two of one name, a step that does not follow the one before, a last step leaving another type, and no list', () => {
    assert.throws(declare({ migrations: (migration) => [migration.value('again', named), migration.value('again', named)] }),
      /^Error: e3\.record 'm' has two migrations named 'again' — a workspace records the steps it has applied by their names$/);
    assert.throws(declare({ migrations: (migration) => [migration.rows('fill_machines', filled), migration.value('name_machines', named)] }),
      /^Error: e3\.record 'm': migration\.value 'name_machines' takes the record as .+, but 'fill_machines', the step before it, leaves it as /);
    assert.throws(declare({ migrations: (migration) => [migration.value('name_machines', named)] }),
      /^Error: e3\.record 'm' is declared as .+, but its last migration, 'name_machines', leaves it as /);
    assert.throws(declare({
      // @ts-expect-error the steps are a list, in order
      migrations: (migration) => ({ first: migration.value('name_machines', named) }),
    }), /^Error: e3\.record 'm': migrations returns the steps in order, as a list/);
  });
});
