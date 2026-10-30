/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An index's maintenance for one row (#1437): the function a write's program
 * runs on each row it touches, and a binding carries for a page to preview a
 * drafted row's Save with. One function, so the preview is the commit's: for
 * every index kind and a write that inserts, moves, changes in place and
 * deletes rows, the ops the function gives each row, gathered over the write,
 * are the ops the commit wrote for the index, byte for byte; applied to the
 * index as it stood, they are the index rebuilt; and a nested series index
 * maintained by a row's patch gives what it gives the row compared whole.
 *
 * The same programs run on every runtime: e3-core's records specs hold the
 * commit's state equal on each, hash for hash.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, StringType, StructType,
  compareFor, encodeBeast2For, equalFor, none, some, variant, type EastType, type ValueTypeOf, type variant as Variant,
} from '@elaraai/east';
import { RecordSummaryOpType, RecordSummaryTotalsType, indexCollectionType, patchOpsType } from '@elaraai/e3-types';
import { record } from './record.js';
import { functionAt } from './record-guards.js';
import { NestedPatchedType } from './record-nested-programs.js';
import { buildMutationProgram, builtIndex, indexBuildProgram, indexEntryKeyType, indexMaintenance, summed } from './record-programs.js';
import type { RecordDef, RecordIndexDef } from './types.js';

// ── The records: every index kind among them ─────────────────────────────────

const Plan = StructType({
  status: StringType, due: IntegerType, title: StringType, tags: SetType(StringType),
  start: OptionType(DateTimeType), end: OptionType(DateTimeType),
});
const Plans = DictType(StringType, Plan);
const plans = record('plans', Plans, {
  initial: new Map(),
  indexes: (index) => ({
    by_status: index.key(
      East.function([StringType, Plan], StructType({ status: StringType, due: IntegerType }), ($, _k, v) => ({ status: v.status, due: v.due })),
      { value: East.function([StringType, Plan], StringType, ($, _k, v) => v.title) },
    ),
    by_tag: index.on(['tags']),
    by_label: index.keys(
      East.function([StringType, Plan], SetType(StringType), ($, _k, v) => v.tags),
      { value: East.function([StringType, Plan], StringType, ($, _k, v) => v.title) },
    ),
    by_time: index.interval({ on: ['status'], from: 'start', to: 'end' }),
    by_status_week: index.series({ key: 'status', from: 'start', to: 'end', tile: 'week' }),
    by_status_month: index.summary({ key: 'status', from: 'start', to: 'end', tile: 'month' }),
  }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});

const Rack = StructType({ hall: StringType, x: OptionType(FloatType), y: OptionType(FloatType), w: FloatType, h: FloatType });
const Racks = DictType(StringType, Rack);
const racks = record('racks', Racks, {
  initial: new Map(),
  indexes: (index) => ({
    by_hall_area: index.area({ on: ['hall'], x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 1 }),
  }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});

const Job = StructType({ start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
const Machine = StructType({ site: StringType, jobs: DictType(StringType, Job), load: DictType(DateTimeType, FloatType) });
const Machines = DictType(StringType, Machine);
const machines = record('machines', Machines, {
  initial: new Map(),
  indexes: (index) => ({
    by_site: index.on(['site']),
    in_time: index.nested({
      collections: { jobs: index.nested.items({ from: 'start', to: 'end' }), load: index.nested.values() },
      tile: 'week',
      summary: 'month',
    }),
  }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});

// ── The writes ───────────────────────────────────────────────────────────────

const at = (text: string): Date => new Date(text);
const order = compareFor(StringType);

const plansBefore = new SortedMap<string, ValueTypeOf<typeof Plan>>([
  ['p1', { status: 'late', due: 3n, title: 'One', tags: new Set(['a', 'b']), start: some(at('2026-10-05T06:00:00Z')), end: some(at('2026-10-06T06:00:00Z')) }],
  ['p2', { status: 'ok', due: 1n, title: 'Two', tags: new Set(['b']), start: some(at('2026-10-07T06:00:00Z')), end: some(at('2026-10-07T08:00:00Z')) }],
  ['p3', { status: 'late', due: 2n, title: 'Three', tags: new Set(), start: none, end: none }],
  ['p5', { status: 'ok', due: 9n, title: 'Five', tags: new Set(['e']), start: some(at('2026-10-20T06:00:00Z')), end: none }],
], order);
// p1 changes status (its entries move) and tags; p2 its title alone (its by_status and by_label entries update in
// place); p3 goes; p4 comes; p5 is untouched.
const plansAfter = new SortedMap<string, ValueTypeOf<typeof Plan>>([
  ['p1', { status: 'ok', due: 3n, title: 'One', tags: new Set(['b', 'c']), start: some(at('2026-10-05T06:00:00Z')), end: some(at('2026-10-06T06:00:00Z')) }],
  ['p2', { status: 'ok', due: 1n, title: 'Second', tags: new Set(['b']), start: some(at('2026-10-07T06:00:00Z')), end: some(at('2026-10-07T08:00:00Z')) }],
  ['p4', { status: 'new', due: 2n, title: 'Four', tags: new Set(['d']), start: some(at('2026-10-12T06:00:00Z')), end: some(at('2026-11-02T06:00:00Z')) }],
  ['p5', { status: 'ok', due: 9n, title: 'Five', tags: new Set(['e']), start: some(at('2026-10-20T06:00:00Z')), end: none }],
], order);

const racksBefore = new SortedMap<string, ValueTypeOf<typeof Rack>>([
  ['r1', { hall: 'H1', x: some(1.5), y: some(2.5), w: 0.6, h: 1.2 }],
  ['r2', { hall: 'H1', x: some(40), y: some(-3), w: 2, h: 2 }],
], order);
// r1 moves far; r2 is unplaced; r3 comes.
const racksAfter = new SortedMap<string, ValueTypeOf<typeof Rack>>([
  ['r1', { hall: 'H1', x: some(-300), y: some(77), w: 0.6, h: 1.2 }],
  ['r2', { hall: 'H1', x: none, y: none, w: 2, h: 2 }],
  ['r3', { hall: 'H2', x: some(0), y: some(0), w: 1, h: 1 }],
], order);

const job = (start: string, end: string): ValueTypeOf<typeof Job> => ({ start: some(at(start)), end: some(at(end)) });
const machinesBefore = new SortedMap<string, ValueTypeOf<typeof Machine>>([
  ['m1', {
    site: 'S1',
    jobs: new SortedMap([['j1', job('2026-10-05T06:00:00Z', '2026-10-05T14:00:00Z')], ['j2', job('2026-10-06T06:00:00Z', '2026-10-06T08:00:00Z')]], order),
    load: new SortedMap([[at('2026-10-05T00:00:00Z'), 0.5]], compareFor(DateTimeType)),
  }],
  ['m2', { site: 'S1', jobs: new SortedMap([], order), load: new SortedMap([[at('2026-10-07T00:00:00Z'), 1.0]], compareFor(DateTimeType)) }],
], order);
// m1's j1 moves to the next week and its load changes, j2 is untouched: an update by the row's patch. m2 goes; m3 comes.
const machinesAfter = new SortedMap<string, ValueTypeOf<typeof Machine>>([
  ['m1', {
    site: 'S1',
    jobs: new SortedMap([['j1', job('2026-10-12T06:00:00Z', '2026-10-12T14:00:00Z')], ['j2', job('2026-10-06T06:00:00Z', '2026-10-06T08:00:00Z')]], order),
    load: new SortedMap([[at('2026-10-05T00:00:00Z'), 0.75]], compareFor(DateTimeType)),
  }],
  ['m3', { site: 'S2', jobs: new SortedMap([['j9', job('2026-10-20T06:00:00Z', '2026-10-21T06:00:00Z')]], order), load: new SortedMap([], compareFor(DateTimeType)) }],
], order);

// ── Reading what each wrote ──────────────────────────────────────────────────

/** An index's entry key and the op a delta's arm for it carries, as the delta types them. */
function opTypes(rec: RecordDef, index: RecordIndexDef): { entryKey: EastType; op: EastType } {
  const recordType = rec.type as DictType<EastType, EastType>;
  const k = summed(index) ? NullType : recordType.key;
  return {
    entryKey: indexEntryKeyType(k, index.keyType),
    op: summed(index) ? RecordSummaryOpType : patchOpsType(indexCollectionType(k, index.keyType, index.valueType)),
  };
}

/** The record's patch from one state to the next, as a client's diff makes it. */
function diffOf(rec: RecordDef, before: unknown, after: unknown): Variant {
  return East.compile(East.patchesFor(rec.type).diff, [])(before as never, after as never) as Variant;
}

/** The ops the commit of the write wrote for each of the record's indexes, by the index's name. */
function committed(rec: RecordDef, before: unknown, after: unknown): Map<string, SortedMap<unknown, unknown>> {
  const run = buildMutationProgram(rec, rec.mutations.patch!).compile([]) as (state: unknown, patch: unknown, emit: (key: Variant, op: Variant) => null) => unknown;
  const pairs = new Map<string, [unknown, unknown][]>();
  run(before, diffOf(rec, before, after), (key, op) => {
    pairs.set(key.type, [...(pairs.get(key.type) ?? []), [key.value, op.value]]);
    return null;
  });
  return new Map(Object.values(rec.indexes).map((index) => {
    const { entryKey } = opTypes(rec, builtIndex(rec, index));
    return [index.name, new SortedMap(pairs.get(index.name) ?? [], compareFor(entryKey))];
  }));
}

/** Two summaries' adds, under each key summed, and none where they cancel: East's own arithmetic, as the commit's. */
const sumAdds = (entryKey: EastType) => East.compile(East.function(
  [DictType(entryKey, RecordSummaryOpType), DictType(entryKey, RecordSummaryOpType)], DictType(entryKey, RecordSummaryOpType),
  ($, a, b) => {
    const sums = $.let(a.map(($, op) => op.unwrap('add')));
    $(sums.unionInPlace(b.map(($, op) => op.unwrap('add')), ($, x, y) => ({ count: x.count.add(y.count), ms: x.ms.add(y.ms) })));
    return sums.filter(($, total) => total.count.notEqual(0n).or(() => total.ms.notEqual(0n))).map(($, total) => variant('add', total));
  }), []);

/**
 * The ops a page previews for the write: the index's maintenance run on each row it touches — the row as it was, the
 * row as it is, and the row's patch where its op is an update and `byPatch` — gathered over the rows.
 */
function maintained(rec: RecordDef, index: RecordIndexDef, before: SortedMap<string, unknown>, after: SortedMap<string, unknown>, byPatch: boolean): SortedMap<unknown, unknown> {
  const built = builtIndex(rec, index);
  const { entryKey } = opTypes(rec, built);
  const maintain = East.compile(indexMaintenance(rec, built), []) as (k: string, held: unknown, next: unknown, patch: unknown) => SortedMap<unknown, unknown>;
  const patch = diffOf(rec, before, after);
  assert.equal(patch.type, 'patch', 'the write is a patch of some rows');
  const sum = sumAdds(entryKey);
  let all = new SortedMap<unknown, unknown>([], compareFor(entryKey));
  for (const [key, op] of patch.value as SortedMap<string, Variant>) {
    const held = before.has(key) ? some(before.get(key)) : none;
    const next = after.has(key) ? some(after.get(key)) : none;
    const rowPatch = op.type === 'update' && byPatch ? some(op.value) : none;
    const ops = maintain(key, held, next, rowPatch);
    if (summed(built)) all = sum(all as never, ops as never) as SortedMap<unknown, unknown>;
    else for (const [entry, change] of ops) all.set(entry, change);
  }
  return all;
}

/** An index as its build program emits it for a state. */
function built(rec: RecordDef, index: RecordIndexDef, rows: unknown): SortedMap<unknown, unknown> {
  const def = builtIndex(rec, index);
  const { entryKey } = opTypes(rec, def);
  const out = new SortedMap<unknown, unknown>([], compareFor(entryKey));
  const run = indexBuildProgram(rec.type, def).compile([]) as (piece: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
  run(rows, (entry, value) => {
    out.set(entry, value);
    return null;
  });
  return out;
}

/** Asserts two East values of a type are equal, and encode to the same bytes. */
function sameValue(type: EastType, actual: unknown, expected: unknown, what: string): void {
  assert.ok(equalFor(type)(actual as never, expected as never), what);
  assert.deepEqual(Buffer.from(encodeBeast2For(type)(actual as never)), Buffer.from(encodeBeast2For(type)(expected as never)), `${what}: byte for byte`);
}

// ── The function and the commit ──────────────────────────────────────────────

const writes: Array<{ rec: RecordDef; before: SortedMap<string, unknown>; after: SortedMap<string, unknown> }> = [
  { rec: plans, before: plansBefore, after: plansAfter },
  { rec: racks, before: racksBefore, after: racksAfter },
  { rec: machines, before: machinesBefore, after: machinesAfter },
];

describe("an index's maintenance for one row is the function the commit runs (#1437)", () => {
  for (const { rec, before, after } of writes) {
    for (const index of Object.values(rec.indexes)) {
      it(`${rec.name}.${index.name}: the rows' ops are the ops the commit wrote, byte for byte`, () => {
        const def = builtIndex(rec, index);
        const { entryKey, op } = opTypes(rec, def);
        const wrote = committed(rec, before, after).get(index.name)!;
        assert.ok(wrote.size > 0, 'the write changes the index');
        sameValue(DictType(entryKey, op), maintained(rec, index, before, after, true), wrote, index.name);
      });
    }
  }

  for (const { rec, before, after } of writes) {
    for (const index of Object.values(rec.indexes).filter((each) => !summed(each))) {
      it(`${rec.name}.${index.name}: the ops, applied to the index as it stood, are the index rebuilt`, () => {
        const def = builtIndex(rec, index);
        const { entryKey } = opTypes(rec, def);
        const collection = DictType(entryKey, def.valueType);
        const apply = East.compile(East.patchesFor(collection).apply, []);
        const ops = maintained(rec, index, before, after, true);
        sameValue(collection, apply(built(rec, index, before) as never, variant('patch', ops) as never), built(rec, index, after), index.name);
      });
    }
  }

  it("machines.in_time: a row's patch gives the ops the row compared whole gives", () => {
    const index = machines.indexes.in_time;
    const { entryKey, op } = opTypes(machines, index);
    // m1's patch is one the index reads by: it can say what the patch touched.
    const nested = builtIndex(machines, index).nested!;
    const entries = DictType(index.keyType, index.valueType);
    const byPatch = East.compile(functionAt(nested.byPatch, [StringType, Machine, Machine, East.patchesFor(Machine).patchType], NestedPatchedType(entries)), []);
    const m1 = [machinesBefore.get('m1')!, machinesAfter.get('m1')!] as const;
    assert.equal((byPatch('m1', m1[0], m1[1], East.compile(East.patchesFor(Machine).diff, [])(m1[0], m1[1])) as Variant).type, 'changed');
    sameValue(DictType(entryKey, op), maintained(machines, index, machinesBefore, machinesAfter, true),
      maintained(machines, index, machinesBefore, machinesAfter, false), 'by the patch and whole');
  });

  it('gives a summary only the totals a row moves, none where its two contributions cancel', () => {
    const index = plans.indexes.by_status_month;
    const maintain = East.compile(indexMaintenance(plans, index), []) as (k: string, held: unknown, next: unknown, patch: unknown) => SortedMap<unknown, unknown>;
    const row = plansBefore.get('p2')!;
    // The title alone changes: the row's time and key stand, so it moves no total.
    assert.equal(maintain('p2', some(row), some({ ...row, title: 'Renamed' }), none).size, 0);
    // The row goes: each month it touched loses it, a count of one and its milliseconds.
    const gone = maintain('p2', some(row), none, none);
    assert.equal(gone.size, 1);
    const totals = [...gone.values()].map((change) => (change as Variant).value as ValueTypeOf<typeof RecordSummaryTotalsType>);
    sameValue(RecordSummaryTotalsType, totals[0], { count: -1n, ms: -7_200_000n }, 'the month of 7 October loses two hours');
  });
});
