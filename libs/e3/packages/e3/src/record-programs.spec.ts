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
  ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, PatchType, SetType, SortedMap, StringType, StructType, VariantType,
  compareFor, encodeBeast2For, equalFor, none, some, toEastTypeValue, variant,
  type EastType, type FunctionExpr, type PatchTypeOf, type ValueTypeOf, type variant as Variant,
} from '@elaraai/east';
import { RecordSummaryOpType, RecordSummaryTotalsType, indexCollectionType, mutationDeltaType, patchOpsType } from '@elaraai/e3-types';
import { record } from './record.js';
import { recordComposite } from './record-composite.js';
import { functionAt } from './record-guards.js';
import { NestedPatchedType } from './record-nested-programs.js';
import {
  buildLoadMergeProgram, buildLoadProgram, buildMutationProgram, builtIndex, deltaTargets, indexBuildProgram, indexEntryKeyType, indexMaintenance, summed,
} from './record-programs.js';
import { at as instant, conflictOf, deltaOf, partOf, shape } from './test-helpers.js';
import type { RecordDef, RecordIndexDef, RecordSourceDef } from './types.js';

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

// ── A composite record's loads ───────────────────────────────────────────────

const Sale = StructType({ customer: StringType, qty: IntegerType, start: DateTimeType, end: DateTimeType });
/** A source's entries by its own key: what the ERP delivers, and what its load patches. */
const Sales = DictType(StringType, Sale);
const SalesKey = VariantType({ erp: StringType, own: StringType });
type SaleRow = ValueTypeOf<typeof Sale>;

/** The orders: an ERP's, loaded by `fn` from a delivery, beside the solution's own, by customer and with each customer's month totals. */
function ordersLoadedBy<D extends EastType>(delivery: D, fn: FunctionExpr<[D, typeof Sales], PatchTypeOf<typeof Sales>>) {
  return recordComposite('orders', Sale, {
    sources: (source) => ({ erp: source.load(StringType, delivery, fn), own: source.mutations(StringType) }),
    indexes: (index) => ({
      by_customer: index.on(['customer']),
      by_customer_month: index.summary({ key: 'customer', from: 'start', to: 'end', tile: 'month' }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
  });
}

// A whole snapshot: the delivery is the source, so an order it leaves out is gone.
const snapshot = East.function([Sales, Sales], PatchType(Sales), (_$, delivery, current) => East.diff(current, delivery));
// An export of changes: each delivered order is set, and none is deleted. Loaded twice, it gives the same entries.
const changes = East.function([Sales, Sales], PatchType(Sales), ($, delivery, current) => {
  const next = $.let(current.copy());
  $.for(delivery, ($, order, id) => {
    $(next.insertOrUpdate(id, order));
  });
  return East.diff(current, next);
});

const sale = (customer: string, qty: bigint, start: string, end: string): SaleRow => ({ customer, qty, start: instant(start), end: instant(end) });
const so1 = sale('Acme', 5n, '2026-10-05T06:00:00.000', '2026-10-05T14:00:00.000');
const so2 = sale('Acme', 2n, '2026-10-06T06:00:00.000', '2026-10-06T08:00:00.000');
const so3 = sale('Birch', 1n, '2026-10-07T06:00:00.000', '2026-10-07T07:00:00.000');
const so4 = sale('Acme', 3n, '2026-10-12T06:00:00.000', '2026-10-12T10:00:00.000');
const so5 = sale('Acme', 9n, '2026-10-20T06:00:00.000', '2026-10-20T09:00:00.000');
const so6 = sale('Cole', 4n, '2026-10-21T06:00:00.000', '2026-10-21T07:00:00.000');
/** The ERP's orders the record holds, and its order book now: SO-1 requantified, SO-2 and SO-5 gone, SO-4 and SO-6 new. */
const heldSales: Array<[string, SaleRow]> = [['SO-1', so1], ['SO-2', so2], ['SO-3', so3], ['SO-5', so5]];
const bookNow: Array<[string, SaleRow]> = [['SO-1', { ...so1, qty: 6n }], ['SO-3', so3], ['SO-4', so4], ['SO-6', so6]];

/** A delivery, or a source's entries by its own key. */
const salesOf = (entries: Array<[string, SaleRow]>) => new SortedMap<string, SaleRow>(entries, order);
/** The record's entries of one source: each under the source's case, as a load is handed its source's run. */
const runOf = (source: 'erp' | 'own', entries: Array<[string, SaleRow]>) =>
  new SortedMap<ValueTypeOf<typeof SalesKey>, SaleRow>(entries.map(([id, row]) => [variant(source, id), row]), compareFor(SalesKey));
/** The entries at or after a key, or before it: one piece of a cut at the key. */
const from = (entries: Array<[string, SaleRow]>, key: string) => entries.filter(([id]) => order(id, key) >= 0);
const before = (entries: Array<[string, SaleRow]>, key: string) => entries.filter(([id]) => order(id, key) < 0);

/** The type of a record's mutation delta. */
const deltaTypeOf = (rec: RecordDef) => mutationDeltaType(deltaTargets(rec.type, Object.values(rec.indexes)));
/** A record's delta as the Dict it is, in the delta's key order, from the pairs a program emitted. */
const deltaMap = (rec: RecordDef, pairs: Iterable<[unknown, unknown]> = []) =>
  new SortedMap<unknown, unknown>(pairs, compareFor(toEastTypeValue(deltaTypeOf(rec).key)));

/** What a keyed load's program emits for one piece: a piece of the delivery, and the source's run at the same keys. */
function loadedPiece(rec: RecordDef, source: RecordSourceDef, delivery: unknown, run: unknown): Array<[unknown, unknown]> {
  const out: Array<[unknown, unknown]> = [];
  const program = buildLoadProgram(rec, source).compile([]) as (delivery: unknown, run: unknown, emit: (key: unknown, op: unknown) => null) => unknown;
  program(delivery, run, (key, op) => {
    out.push([key, op]);
    return null;
  });
  return out;
}

/** Pieces' deltas as the one delta the engine folds them into: a key two pieces wrote merged by the load's merge program. */
function foldedPieces(rec: RecordDef, source: RecordSourceDef, pieces: Array<Array<[unknown, unknown]>>): SortedMap<unknown, unknown> {
  const merge = buildLoadMergeProgram(rec, source).compile([]) as (key: unknown, a: unknown, b: unknown) => unknown;
  const out = deltaMap(rec);
  for (const [key, op] of pieces.flat()) out.set(key, out.has(key) ? merge(key, out.get(key), op) : op);
  return out;
}

describe("a composite record's load, as its program runs each piece of a delivery", () => {
  it('a full export loaded as one piece writes the delta of the patch mutation that makes the same change, every index maintained', () => {
    const orders = ordersLoadedBy(Sales, snapshot);
    const out = loadedPiece(orders, orders.sources.erp, salesOf(bookNow), runOf('erp', heldSales));
    assert.deepEqual(shape(deltaOf(orders, out)).filter((line) => !line.startsWith('by_customer_month:')), [
      'by_customer:(ik="Acme", k=.erp "SO-2")=delete',
      'by_customer:(ik="Acme", k=.erp "SO-4")=insert',
      'by_customer:(ik="Acme", k=.erp "SO-5")=delete',
      'by_customer:(ik="Cole", k=.erp "SO-6")=insert',
      'primary:.erp "SO-1"=update',
      'primary:.erp "SO-2"=delete',
      'primary:.erp "SO-4"=insert',
      'primary:.erp "SO-5"=delete',
      'primary:.erp "SO-6"=insert',
    ]);

    // The same change as a patch of the record, which holds the solution's own orders too: one delta, entry for entry
    const own: Array<[string, SaleRow]> = [['P-1', so2]];
    const stateBefore = new SortedMap([...runOf('erp', heldSales), ...runOf('own', own)], compareFor(SalesKey));
    const stateAfter = new SortedMap([...runOf('erp', bookNow), ...runOf('own', own)], compareFor(SalesKey));
    const patched: Array<[unknown, unknown]> = [];
    const patch = buildMutationProgram(orders, orders.mutations.patch).compile([]) as (state: unknown, patch: unknown, emit: (key: unknown, op: unknown) => null) => unknown;
    patch(stateBefore, diffOf(orders, stateBefore, stateAfter), (key, op) => {
      patched.push([key, op]);
      return null;
    });
    sameValue(deltaTypeOf(orders), deltaMap(orders, out), deltaMap(orders, patched), 'the load\'s delta and the patch\'s');
  });

  it('pieces of a delivery write, folded, the delta one piece writes: a summary\'s totals summed across them', () => {
    const orders = ordersLoadedBy(Sales, snapshot);
    const { erp } = orders.sources;
    const whole = loadedPiece(orders, erp, salesOf(bookNow), runOf('erp', heldSales));
    // Cut at SO-4, the delivery and the source's run at the same key
    const first = loadedPiece(orders, erp, salesOf(before(bookNow, 'SO-4')), runOf('erp', before(heldSales, 'SO-4')));
    const second = loadedPiece(orders, erp, salesOf(from(bookNow, 'SO-4')), runOf('erp', from(heldSales, 'SO-4')));
    sameValue(deltaTypeOf(orders), foldedPieces(orders, erp, [first, second]), deltaMap(orders, whole), 'the pieces folded, and one piece');

    // Acme's October: the first piece takes SO-2's two hours away; the second takes SO-5's three and gives SO-4's four
    const acme = (out: Array<[unknown, unknown]>) => deltaOf(orders, out).filter((entry) => entry.target === 'by_customer_month' && entry.key.includes('"Acme"'));
    const HOUR = 3_600_000n;
    const adds = [first, second, [...foldedPieces(orders, erp, [first, second])]].map((out) => acme(out).map((entry) => partOf(entry.op).value));
    assert.equal(adds.every((each) => each.length === 1), true, 'each names Acme\'s October once');
    sameValue(RecordSummaryTotalsType, adds[0]![0], { count: -1n, ms: -2n * HOUR }, 'the first piece');
    sameValue(RecordSummaryTotalsType, adds[1]![0], { count: 0n, ms: HOUR }, 'the second piece');
    sameValue(RecordSummaryTotalsType, adds[2]![0], { count: -1n, ms: -HOUR }, 'summed');
  });

  it('a change export sets what it delivers and deletes nothing, and loaded again changes nothing', () => {
    const orders = ordersLoadedBy(Sales, changes);
    const { erp } = orders.sources;
    const delivered: Array<[string, SaleRow]> = [['SO-1', { ...so1, qty: 6n }], ['SO-4', so4]];
    assert.deepEqual(shape(deltaOf(orders, loadedPiece(orders, erp, salesOf(delivered), runOf('erp', heldSales)))).filter((line) => line.startsWith('primary:')), [
      'primary:.erp "SO-1"=update',
      'primary:.erp "SO-4"=insert',
    ]);
    const after: Array<[string, SaleRow]> = [['SO-1', { ...so1, qty: 6n }], ['SO-2', so2], ['SO-3', so3], ['SO-4', so4], ['SO-5', so5]];
    assert.deepEqual(loadedPiece(orders, erp, salesOf(delivered), runOf('erp', after)), [], 'nothing is emitted for a delivery the source already holds');
  });

  it('R8 — a load\'s function that replaces replaces its piece\'s entries of its source, never the record\'s', () => {
    // Every order of the piece differs, so the diff is a replace of the entries the function was handed
    const replaced = East.function([Sales, Sales], PatchType(Sales), (_$, delivery, current) => variant('replace', { before: current, after: delivery }));
    const orders = ordersLoadedBy(Sales, replaced);
    const delivered: Array<[string, SaleRow]> = [['SO-1', { ...so1, qty: 6n }], ['SO-2b', so4]];
    // The piece before SO-3: the record's SO-3 and SO-5, and every other source's entries, are no part of it
    const out = deltaOf(orders, loadedPiece(orders, orders.sources.erp, salesOf(delivered), runOf('erp', before(heldSales, 'SO-3'))));
    assert.deepEqual(shape(out).filter((line) => line.startsWith('primary:')), [
      'primary:.erp "SO-1"=update',
      'primary:.erp "SO-2"=delete',
      'primary:.erp "SO-2b"=insert',
    ]);
    // A replace of entries the source no longer holds is a stale write, as a patch mutation's is
    const stale = East.function([Sales, Sales], PatchType(Sales), (_$, delivery, _current) => variant('replace', { before: delivery, after: delivery }));
    const staleOrders = ordersLoadedBy(Sales, stale);
    assert.equal(conflictOf(deltaOf(staleOrders, loadedPiece(staleOrders, staleOrders.sources.erp, salesOf(delivered), runOf('erp', heldSales)))),
      'the patch replaces a state the record no longer holds');
  });

  it('R7 — a load\'s patch that names a key outside its piece is a conflict naming the key, and the piece writes nothing for it', () => {
    // It sets an order its piece of the delivery does not hold, and its entries do not either
    const strays = East.function([Sales, Sales], PatchType(Sales), ($, delivery, current) => {
      const next = $.let(delivery.copy());
      $(next.insertOrUpdate('SO-9', so4));
      return East.diff(current, next);
    });
    const orders = ordersLoadedBy(Sales, strays);
    const out = deltaOf(orders, loadedPiece(orders, orders.sources.erp, salesOf(before(bookNow, 'SO-4')), runOf('erp', before(heldSales, 'SO-4'))));
    assert.equal(conflictOf(out), 'load \'erp\' names "SO-9", which is in neither its piece of the delivery nor its entries');
    // A key its entries hold, which the delivery leaves out, is its own to delete: no conflict for SO-2
    assert.deepEqual(out.filter((entry) => entry.conflict !== undefined).length, 1);
  });

  it('a delivery that is not keyed as its source runs as one piece, and returns the delta: any key of the source is its own', () => {
    const Lines = ArrayType(StructType({ id: StringType, order: Sale }));
    const listed = East.function([Lines, Sales], PatchType(Sales), ($, lines, current) => {
      const next = $.let(new Map(), Sales);
      $.for(lines, ($, line) => {
        $(next.insertOrUpdate(line.id, line.order));
      });
      return East.diff(current, next);
    });
    const orders = ordersLoadedBy(Lines, listed);
    assert.equal(orders.sources.erp.load.keyed, false);
    const program = buildLoadProgram(orders, orders.sources.erp).compile([]) as (delivery: unknown, run: unknown) => SortedMap<unknown, unknown>;
    const delta = program(bookNow.map(([id, each]) => ({ id, order: each })), runOf('erp', heldSales));
    // The delta the keyed load of the same book writes, as a value
    const keyed = ordersLoadedBy(Sales, snapshot);
    sameValue(deltaTypeOf(orders), delta, deltaMap(keyed, loadedPiece(keyed, keyed.sources.erp, salesOf(bookNow), runOf('erp', heldSales))), 'one piece\'s delta');
  });

  it('refuses a run that holds another source\'s entry, and a source that has no load', () => {
    const orders = ordersLoadedBy(Sales, snapshot);
    assert.throws(() => loadedPiece(orders, orders.sources.erp, salesOf(bookNow), runOf('own', [['P-1', so2]])),
      /load 'erp' was handed \.own "P-1", an entry of another source/);
    assert.throws(() => buildLoadProgram(orders, orders.sources.own),
      /^Error: e3\.recordComposite 'orders': source 'own' is written by the record's mutations, and has no load to build a program from$/);
  });
});

describe("a keyed load's merge of two pieces' deltas", () => {
  const orders = ordersLoadedBy(Sales, snapshot);
  const merge = buildLoadMergeProgram(orders, orders.sources.erp).compile([]) as (key: unknown, a: unknown, b: unknown) => Variant;

  it('sums a summary\'s totals, and keeps either of two pieces\' reports of one conflict', () => {
    const entry = { ik: { on: {}, key: 'Acme', tile: instant('2026-10-01T00:00:00.000') }, k: null };
    const add = (count: bigint, ms: bigint) => variant('by_customer_month', variant('add', { count, ms }));
    const summed = merge(variant('by_customer_month', entry), add(-1n, -7_200_000n), add(0n, 3_600_000n));
    assert.equal(summed.type, 'by_customer_month');
    sameValue(RecordSummaryOpType, summed.value, variant('add', { count: -1n, ms: -3_600_000n }), 'the two adds, summed');
    const said = variant('$conflict', 'load \'erp\' names "SO-9", which is in neither its piece of the delivery nor its entries');
    assert.equal(merge(said, variant('$conflict', null), variant('$conflict', null)).type, '$conflict');
  });

  it('fails for any other key two pieces wrote, naming the load and the entry: the planner cuts no two pieces over one key', () => {
    const insert = variant('primary', variant('insert', so1));
    assert.throws(() => merge(variant('primary', variant('erp', 'SO-1')), insert, insert),
      /two pieces of load 'erp' wrote one entry \.primary \.erp "SO-1"/);
    const filed = variant('by_customer', variant('insert', null));
    assert.throws(() => merge(variant('by_customer', { ik: 'Acme', k: variant('erp', 'SO-1') }), filed, filed),
      /two pieces of load 'erp' wrote one entry \.by_customer \(ik="Acme", k=\.erp "SO-1"\)/);
  });
});
