/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The nested form of `e3.recordIndex.series` (#1434): what TypeScript checks
 * of a declaration from the record's type alone; the refusals, in their
 * words; a row's entries — its items filed by #1433's levels, its totals, its
 * items rolled up under every ancestor, and every parent's subtotals, checked
 * by hand; the lean rows the record's other indexes carry beside it; and how
 * a write keeps it — by its patch where the patch can say what it touched,
 * whole where it cannot, both one delta, and maintained equals rebuilt, byte
 * for byte. That every runtime files a row alike is e3-core's series spec.
 *
 * Rows and entries are written as East prints them, and read by East's parser.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DateTimeType, DictType, East, FloatType, IntegerType, OptionType, RecursiveType, SortedMap, StringType,
  StructType, VariantType, compareFor, encodeBeast2PagedFor, equalFor, isTypeEqual, parseFor, printFor, printType, variant,
  type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { NestedEntryKeyType, NestedEntryType, RecordNestedDeclType } from '@elaraai/e3-types';
import { record } from './record.js';
import { recordIndex } from './record-index.js';
import { buildMutationProgram, builtIndex, indexBuildProgram } from './record-programs.js';
import { functionAt } from './record-guards.js';
import { mutation } from './mutation.js';
import { package_ } from './package.js';
import { NestedPatchedType } from './record-nested-programs.js';
import { patchTypeOf } from './record-patches.js';
import type { MutationDef, RecordDef, RecordIndexDef } from './types.js';

const series = recordIndex.series;

// ── The rows ─────────────────────────────────────────────────────────────────

const Job = StructType({
  product: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), state: StringType, sheets: FloatType,
});
const Stop = StructType({ reason: StringType, start: DateTimeType, end: DateTimeType });
const Alarm = StructType({ code: StringType, severity: StringType, at: DateTimeType });
/** A machine: where it stands, when it was in service, and what it nests. */
const Machine = StructType({
  name: StringType, site: StringType, status: StringType, x: FloatType, y: FloatType,
  installed: OptionType(DateTimeType), retired: OptionType(DateTimeType),
  jobs: DictType(StringType, Job), stops: DictType(StringType, Stop), alarms: DictType(StringType, Alarm),
  load: DictType(DateTimeType, FloatType), output: DictType(DateTimeType, IntegerType),
});
const Machines = DictType(StringType, Machine);
const machines = () => record('machines', Machines, new Map());
const machinesInTime = (rec: ReturnType<typeof machines>) => series('machines_in_time', rec, {
  collections: {
    jobs: series.items({ from: 'start', to: 'end' }),
    stops: series.items({ from: 'start', to: 'end' }),
    alarms: series.items({ at: 'at' }),
    load: series.values(),
    output: series.values(),
  },
  tile: 'week',
  summary: 'month',
});

/** A hall's members, each with its own load; the hall's strip is their mean. */
const Member = StructType({ name: StringType, load: DictType(DateTimeType, FloatType) });
const Hall = StructType({ name: StringType, site: StringType, members: DictType(StringType, Member) });
const Halls = DictType(StringType, Hall);
const halls = () => record('halls', Halls, new Map());
const hallsInTime = (rec: ReturnType<typeof halls>) => series('halls_in_time', rec, {
  collections: { members: series.rows({ load: series.values({ rollup: 'mean' }) }) },
  tile: 'day',
  summary: 'month',
});

/** An assembly's parts, each holding its jobs and more parts, to any depth; a part's bands are its subtree's jobs. */
const Part = RecursiveType((self) => StructType({ name: StringType, jobs: DictType(StringType, Job), parts: DictType(StringType, self) }));
const Assembly = StructType({ name: StringType, parts: DictType(StringType, Part) });
const Assemblies = DictType(StringType, Assembly);
const assemblies = () => record('assemblies', Assemblies, new Map());
const assembliesInTime = (rec: ReturnType<typeof assemblies>) => series('assemblies_in_time', rec, {
  collections: {
    parts: series.rows({ jobs: series.items({ from: 'start', to: 'end' }, { rollup: true }), parts: series.recursive() }),
  },
  tile: 'week',
  summary: 'month',
});

/** A ledger's measures, each with more beneath, to any depth. */
const Measure = RecursiveType((self) => StructType({
  label: StringType, readings: DictType(DateTimeType, FloatType), stock: DictType(DateTimeType, FloatType), children: DictType(StringType, self),
}));
const Ledger = StructType({ name: StringType, site: StringType, measures: DictType(StringType, Measure) });
const Ledgers = DictType(StringType, Ledger);
const ledgers = () => record('ledgers', Ledgers, new Map());
const ledgersInTime = (rec: ReturnType<typeof ledgers>) => series('ledgers_in_time', rec, {
  collections: {
    measures: series.rows({
      readings: series.values({ rollup: ['sum', 'mean', 'count'] }),
      stock: series.values({ rollup: { fold: 'last', aggregate: 'sum' } }),
      children: series.recursive(),
    }),
  },
  tile: 'day',
});

// ── Reading and checking East values ─────────────────────────────────────────

/** A value written as East prints one, read by East's parser. */
function parsed<T extends EastType>(type: T, text: string): ValueTypeOf<T> {
  const read = parseFor(type)(text);
  if (!read.success) throw new Error(`not a ${printType(type)}: ${read.error}`);
  return read.value;
}

/** Asserts an East value equals the one expected, by its type, printing both as East does when it does not. */
function assertEast<T extends EastType>(type: T, actual: unknown, expected: ValueTypeOf<T>, what: string): void {
  if (equalFor(type)(actual as ValueTypeOf<T>, expected)) return;
  const print = printFor(type);
  assert.fail(`${what}:\n  got      ${print(actual as ValueTypeOf<T>)}\n  expected ${print(expected)}`);
}

/** A record's key and row types. */
function entryOf(rec: RecordDef): { keyType: EastType; rowType: EastType } {
  const type = rec.type;
  if (type.type !== 'Dict') throw new Error(`a nested index's record is a Dict, not ${printType(type)}`);
  return { keyType: type.key, rowType: type.value };
}

/** A row's entries, as the index's own function gives them. */
function entries(def: RecordIndexDef, key: string, row: unknown): SortedMap<unknown, unknown> {
  const { keyType, rowType } = entryOf(def.record);
  const run = East.compile(functionAt(def.keyFn, [keyType, rowType], DictType(def.keyType, def.valueType)), []);
  return run(key, row) as SortedMap<unknown, unknown>;
}

/** An entry's value, under the key written as East prints one; undefined where there is none. */
function entryAt(def: RecordIndexDef, all: SortedMap<unknown, unknown>, key: string): unknown {
  return all.get(parsed(def.keyType, key));
}

/** Asserts the entry under a key holds the value expected, both written as East prints them. */
function assertEntry(def: RecordIndexDef, all: SortedMap<unknown, unknown>, key: string, value: string): void {
  const held = entryAt(def, all, key);
  assert.ok(held !== undefined, `no entry under ${key}`);
  assertEast(def.valueType, held, parsed(def.valueType, value), `the entry under ${key}`);
}

// ── Rows written as East prints them ─────────────────────────────────────────

/** A job from `start` to `end`, each written as East prints an instant; no end an instant, no start not yet scheduled. */
function job(start: string | undefined, end?: string, product = 'Labels'): string {
  const when = (t: string | undefined) => (t === undefined ? '.none' : `.some ${t}`);
  return `(product="${product}", start=${when(start)}, end=${when(end)}, state="planned", sheets=1200.0)`;
}

/** A machine holding the jobs and loads given, as East prints a Dict of them. */
function machine(jobs: Readonly<Record<string, string>>, load: Readonly<Record<string, number>> = {}, status = 'up'): string {
  const dict = (entries: [string, string][]) => (entries.length === 0 ? '{:}' : `{${entries.map(([k, v]) => `${k}:${v}`).join(', ')}}`);
  return `(name="Press", site="North", status="${status}", x=1.0, y=2.0, installed=.none, retired=.none, ` +
    `jobs=${dict(Object.entries(jobs).map(([id, text]) => [`"${id}"`, text]))}, stops={:}, alarms={:}, ` +
    `load=${dict(Object.entries(load).map(([at, value]) => [at, value.toFixed(2)]))}, output={:})`;
}

/** A record's state, each row written as East prints it. */
function state<T extends EastType>(type: T, rows: Readonly<Record<string, string>>): ValueTypeOf<T> {
  const written = Object.entries(rows).map(([key, row]) => `"${key}":${row}`);
  return parsed(type, written.length === 0 ? '{:}' : `{${written.join(', ')}}`);
}

// ── The declaration ──────────────────────────────────────────────────────────

describe('e3.recordIndex.series, nested — its declaration', () => {
  it('types its entries from the record and the declaration, and carries the declaration, its tile and its summary', () => {
    const def = machinesInTime(machines());
    assert.ok(isTypeEqual(def.keyType, NestedEntryKeyType(StringType)), `its key is ${printType(def.keyType)}`);
    const places = VariantType({ alarms: Alarm, jobs: Job, load: FloatType, output: IntegerType, stops: Stop });
    assert.ok(isTypeEqual(def.valueType, NestedEntryType(places)), `its value is ${printType(def.valueType)}`);
    assert.deepEqual(def.on, []);
    assert.equal(def.multi, true);
    assert.equal(def.nested.tile, 'week');
    assert.equal(def.nested.summary, 'month');
    assertEast(RecordNestedDeclType, def.nested.declaration, parsed(RecordNestedDeclType,
      '{"alarms":.items (times=.at "at", rollup=false), "jobs":.items (times=.span (from="start", to="end"), rollup=false), ' +
      '"load":.values (rollups=[]), "output":.values (rollups=[]), "stops":.items (times=.span (from="start", to="end"), rollup=false)}'),
    'the declaration it carries');
  });

  it('nests the items\' variant as the declaration nests: child rows a variant of their own, a recursive field none', () => {
    const def = assembliesInTime(assemblies());
    assert.ok(isTypeEqual(def.valueType, NestedEntryType(VariantType({ parts: VariantType({ jobs: Job }) }))), printType(def.valueType));
    assertEast(RecordNestedDeclType, def.nested.declaration, parsed(RecordNestedDeclType,
      '{"parts":.rows {"jobs":.items (times=.span (from="start", to="end"), rollup=true), "parts":.recursive}}'), 'the declaration it carries');
  });

  it('checks each builder against its field from the record\'s type alone, and refuses the same at run time in words', () => {
    const rec = machines();
    // @ts-expect-error — the jobs have no field 'begin'
    const misnamed = () => series('t', rec, { collections: { jobs: series.items({ from: 'begin', to: 'end' }) }, tile: 'week' });
    assert.throws(misnamed, /^Error: e3.recordIndex.series 't' collections.jobs times from 'begin', which is no field of the jobs$/);
    // @ts-expect-error — the alarms are keyed by an id: values() fits no such field
    const alarmsAsValues = () => series('t', rec, { collections: { alarms: series.values() }, tile: 'week' });
    assert.throws(alarmsAsValues, /^Error: e3.recordIndex.series 't' collections.alarms is values\(\), and 'alarms' is keyed by \.String — values are keyed by their instant: declare it with items\(\{ from, to \}\) or items\(\{ at \}\)$/);
    // @ts-expect-error — the load is keyed by its instant: items(…) fits no such field
    const loadAsItems = () => series('t', rec, { collections: { load: series.items({ at: 'at' }) }, tile: 'week' });
    assert.throws(loadAsItems, /^Error: e3.recordIndex.series 't' collections.load is items\(…\), and 'load' is keyed by \.DateTime — a collection keyed by its instant holds values: declare it with values\(\)$/);
    // @ts-expect-error — a machine holds no more machines
    const jobsAsRecursive = () => series('t', rec, { collections: { jobs: series.recursive() }, tile: 'week' });
    assert.throws(jobsAsRecursive, /^Error: e3.recordIndex.series 't' collections.jobs is recursive\(\), and holds .+, not .+ — a recursive field holds more rows like the one listing it$/);
    // @ts-expect-error — no rollup is called median
    const median = () => series('t', halls(), { collections: { members: series.rows({ load: series.values({ rollup: 'median' }) }) }, tile: 'day' });
    assert.throws(median, /rolls up by "median", which is no rollup/);
    // @ts-expect-error — a fold names its aggregate too
    const foldAlone = () => series('t', halls(), { collections: { members: series.rows({ load: series.values({ rollup: { fold: 'last' } }) }) }, tile: 'day' });
    assert.throws(foldAlone, /rolls up by \{ fold: "last" \}, which is no rollup/);
    // @ts-expect-error — the row has no field 'job'
    const unknown = () => series('t', rec, { collections: { job: series.items({ from: 'start', to: 'end' }) }, tile: 'week' });
    assert.throws(unknown, /^Error: e3.recordIndex.series 't' collections names unknown row field 'job'$/);
  });

  describe('refuses, at definition time, in its words', () => {
    const refused = (spec: object, words: string, rec: RecordDef = machines()) =>
      assert.throws(() => series('machines_in_time', rec as never, spec as never), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, `e3.recordIndex.series 'machines_in_time' ${words}`);
        return true;
      });
    const jobs = series.items({ from: 'start', to: 'end' });

    it('collections declaring none, or a field no builder made', () => {
      refused({ collections: {}, tile: 'week' }, 'collections declares no collection');
      refused({ collections: { jobs: { from: 'start' } }, tile: 'week' },
        'collections.jobs is no declaration — declare it with e3.recordIndex.series.items(times), values(), rows(collections) or recursive()');
    });

    it('a field that is not a Dict, or not one of the row\'s', () => {
      refused({ collections: { status: jobs }, tile: 'week' },
        'collections.status is \'status\', of type .String — a collection is a Dict: Dict<String, Item> keyed by an id, or Dict<DateTime, V> keyed by its instant');
      refused({ collections: { job: jobs }, tile: 'week' }, 'collections names unknown row field \'job\'');
    });

    it('child rows that are not structs', () => {
      const Bay = StructType({ name: StringType, loads: DictType(StringType, FloatType) });
      const bays = record('bays', DictType(StringType, Bay), new Map());
      assert.throws(() => series('halls_in_time', bays, { collections: { loads: series.rows({}) } as never, tile: 'day' }),
        /^Error: e3.recordIndex.series 'halls_in_time' collections.loads is rows\(…\), and 'loads' holds \.Float — items and child rows are a Dict<String, Struct>$/);
    });

    it('a time of another type', () => {
      refused({ collections: { jobs: series.items({ from: 'product', to: 'end' } as never) }, tile: 'week' },
        'collections.jobs times from \'product\', of type .String — a time is a DateTime or an Option<DateTime> field of the item');
    });

    it('a rollup with no parent above it, a count with a fold, and a rollup named twice', () => {
      refused({ collections: { load: series.values({ rollup: 'sum' }) }, tile: 'week' },
        'collections.load rolls up, and no row of the index is a parent of its rows — a rollup is a parent\'s subtotal of its children\'s: ' +
        'declare it on a collection under rows(…) or beside recursive()');
      const ledgerSpec = (rollup: unknown) => ({
        collections: { measures: series.rows({ readings: series.values({ rollup } as never), children: series.recursive() }) }, tile: 'day',
      });
      assert.throws(() => series('ledgers_in_time', ledgers(), ledgerSpec({ fold: 'sum', aggregate: 'count' }) as never),
        /^Error: e3.recordIndex.series 'ledgers_in_time' collections.measures.readings rolls up by \{ fold: 'sum', aggregate: 'count' \} — a count counts the leaf rows with a value, whatever they fold to: write rollup: "count"$/);
      assert.throws(() => series('ledgers_in_time', ledgers(), ledgerSpec(['sum', 'sum']) as never),
        /^Error: e3.recordIndex.series 'ledgers_in_time' collections.measures.readings rolls up by sum twice — name each rollup once$/);
    });

    it('the key form, on or a value beside collections, and a tile of none of the five', () => {
      const collections = { jobs };
      refused({ collections, key: 'site', from: 'installed', to: 'retired', tile: 'week' },
        'takes collections, or key, from and to — not both: collections files what a row nests, key the record\'s own events');
      refused({ collections, on: ['site'], tile: 'week' },
        'takes no on with collections — a nested collection is read by its row\'s key, which the rail\'s indexes page');
      refused({ collections, value: () => null, tile: 'week' }, 'takes no value — each entry carries its own item, totals or subtotal');
      assert.throws(() => series('machines_in_time', machines(), { collections, tile: 'fortnight' } as never), /tile/);
    });

    it('a second nested series index on a record', () => {
      const rec = machines();
      const first = machinesInTime(rec);
      const second = series('machines_by_day', rec, { collections: { jobs }, tile: 'day' });
      assert.throws(() => package_('machines', '1.0.0', rec, first, second),
        /^Error: e3.recordIndex.series 'machines_by_day': record 'machines' has a nested series index already, 'machines_in_time' — one declares every collection a record nests$/);
    });
  });
});

// ── A row's entries ──────────────────────────────────────────────────────────

describe('e3.recordIndex.series, nested — a row\'s entries', () => {
  it('files a job once under the week its length fits, a value at its instant, and keeps their month totals', () => {
    const def = machinesInTime(machines());
    const row = parsed(Machine, machine({ 'j-0042': job('2026-10-02T06:00:00.000', '2026-10-06T06:00:00.000') }, { '2026-10-05T00:00:00.000': 0.82 }));
    const all = entries(def, 'M-7', row);
    assertEast(DictType(def.keyType, def.valueType), all, parsed(DictType(def.keyType, def.valueType), `{
      (collection=.step (key="jobs", rest=.end), row="M-7", path=.end, run=.items, level=.week, tile=2026-09-28T00:00:00.000, item=.id "j-0042"):
        .item .jobs ${job('2026-10-02T06:00:00.000', '2026-10-06T06:00:00.000')},
      (collection=.step (key="jobs", rest=.end), row="M-7", path=.end, run=.totals, level=.month, tile=2026-10-01T00:00:00.000, item=.none):
        .totals (count=1, ms=345600000, values=.none),
      (collection=.step (key="load", rest=.end), row="M-7", path=.end, run=.items, level=.week, tile=2026-10-05T00:00:00.000, item=.at 2026-10-05T00:00:00.000):
        .item .load 0.82,
      (collection=.step (key="load", rest=.end), row="M-7", path=.end, run=.totals, level=.month, tile=2026-10-01T00:00:00.000, item=.none):
        .totals (count=1, ms=0, values=.some (sum=0.82, min=0.82, max=0.82, last=0.82))
    }`), 'M-7\'s entries');
  });

  it('files an item with no start nowhere, and counts it in no total', () => {
    const def = machinesInTime(machines());
    const all = entries(def, 'M-7', parsed(Machine, machine({ 'j-1': job(undefined) })));
    assert.equal(all.size, 0, 'no entries');
  });

  it('files values, and items at an instant, at the declared tile alone, an instant covering none of a total', () => {
    const def = machinesInTime(machines());
    const row = parsed(Machine, machine({}, { '2026-10-05T00:00:00.000': 0.5, '2026-10-30T12:00:00.000': 0.75 }));
    row.alarms.set('a-1', parsed(Alarm, '(code="E1", severity="high", at=2026-10-07T09:30:00.000)'));
    const all = entries(def, 'M-7', row);
    for (const [key] of all) {
      const level = (key as { level: variant<string, null> }).level.type;
      assert.ok(level === 'week' || level === 'month', `filed at ${level}`);
    }
    assertEntry(def, all,
      '(collection=.step (key="alarms", rest=.end), row="M-7", path=.end, run=.items, level=.week, tile=2026-10-05T00:00:00.000, item=.id "a-1")',
      '.item .alarms (code="E1", severity="high", at=2026-10-07T09:30:00.000)');
    assertEntry(def, all,
      '(collection=.step (key="alarms", rest=.end), row="M-7", path=.end, run=.totals, level=.month, tile=2026-10-01T00:00:00.000, item=.none)',
      '.totals (count=1, ms=0, values=.none)');
    assertEntry(def, all,
      '(collection=.step (key="load", rest=.end), row="M-7", path=.end, run=.totals, level=.month, tile=2026-10-01T00:00:00.000, item=.none)',
      '.totals (count=2, ms=0, values=.some (sum=1.25, min=0.5, max=0.75, last=0.75))');
  });

  it(`refuses an item touching more than 4096 years, naming its row, its collection and its key`, () => {
    const def = machinesInTime(machines());
    const row = parsed(Machine, machine({ 'j-0042': job('2026-01-01T12:00:00.000', '9999-12-31T00:00:00.000') }));
    assert.throws(() => entries(def, 'M-7', row),
      /"M-7" jobs "j-0042", from 2026-01-01T12:00:00.000 to 9999-12-31T00:00:00.000, touches more than 4096 year tiles: end it within 4096 years of its start/);
  });

  it('files a member\'s value under its path, and keeps the hall\'s mean of its members\' means', () => {
    const def = hallsInTime(halls());
    const row = parsed(Hall, `(name="Hall 1", site="North", members={
      "m-3":(name="Ada", load={2026-10-05T00:00:00.000:0.82}),
      "m-4":(name="Bo", load={2026-10-05T06:00:00.000:0.5, 2026-10-05T18:00:00.000:0.7})
    })`);
    const all = entries(def, 'H1', row);
    assertEntry(def, all,
      '(collection=.step (key="members", rest=.step (key="load", rest=.end)), row="H1", path=.step (key="m-3", rest=.end), run=.items, level=.day, ' +
      'tile=2026-10-05T00:00:00.000, item=.at 2026-10-05T00:00:00.000)',
      '.item .members .load 0.82');
    // Ada's 0.82 and Bo's mean of 0.5 and 0.7, 0.6, averaged.
    assertEntry(def, all,
      '(collection=.step (key="members", rest=.step (key="load", rest=.end)), row="H1", path=.end, run=.subtotals (fold=.mean, aggregate=.mean), ' +
      'level=.week, tile=2026-10-05T00:00:00.000, item=.none)',
      '.subtotal 0.71');
  });

  it('files a part\'s job at its path five deep, and under each of its five ancestors with the path down to it', () => {
    const def = assembliesInTime(assemblies());
    const deepest = `(name="p5", jobs={"j-9":${job('2026-10-02T00:00:00.000', '2026-10-03T00:00:00.000')}}, parts={:})`;
    const chain = ['p4', 'p3', 'p2', 'p1'].reduce((inner, name, i) =>
      `(name="${name}", jobs={:}, parts={"${['p5', 'p4', 'p3', 'p2'][i]}":${inner}})`, deepest);
    const all = entries(def, 'A-1', parsed(Assembly, `(name="Assembly 1", parts={"p1":${chain}})`));
    const pathOf = (names: readonly string[]) => names.reduceRight((rest, key) => `.step (key="${key}", rest=${rest})`, '.end');
    const names = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const value = `.item .parts .jobs ${job('2026-10-02T00:00:00.000', '2026-10-03T00:00:00.000')}`;
    const where = '(collection=.step (key="parts", rest=.step (key="jobs", rest=.end)), row="A-1"';
    assertEntry(def, all, `${where}, path=${pathOf(names)}, run=.items, level=.week, tile=2026-09-28T00:00:00.000, item=.id "j-9")`, value);
    for (let depth = 0; depth < names.length; depth++) {
      assertEntry(def, all,
        `${where}, path=${pathOf(names.slice(0, depth))}, run=.subtree, level=.week, tile=2026-09-28T00:00:00.000, ` +
        `item=.under (path=${pathOf(names.slice(depth))}, id="j-9"))`, value);
    }
    const subtree = [...all.keys()].filter((key) => (key as { run: variant<string, unknown> }).run.type === 'subtree');
    assert.equal(subtree.length, 5, 'under each of its five ancestors, and no other');
  });
});

// ── Parents' subtotals ───────────────────────────────────────────────────────

describe('e3.recordIndex.series, nested — every parent\'s subtotals, by hand', () => {
  // m1 holds m11 and m12; m2 holds readings alone; m3 holds readings of its
  // own, and m31, whose stock it derives.
  const ledger = `(name="Ledger 1", site="North", measures={
    "m1":(label="Plant", readings={:}, stock={:}, children={
      "m11":(label="Press", readings={2026-10-05T00:00:00.000:2.0, 2026-10-06T00:00:00.000:4.0},
             stock={2026-10-05T00:00:00.000:10.0, 2026-10-07T00:00:00.000:12.0}, children={:}),
      "m12":(label="Folder", readings={2026-10-05T00:00:00.000:6.0}, stock={2026-10-06T00:00:00.000:5.0}, children={:})
    }),
    "m2":(label="Dock", readings={2026-10-12T00:00:00.000:1.0}, stock={:}, children={:}),
    "m3":(label="Kiln", readings={2026-10-05T00:00:00.000:100.0}, stock={:}, children={
      "m31":(label="Burner", readings={2026-10-05T00:00:00.000:7.0}, stock={2026-10-05T00:00:00.000:3.0}, children={:})
    })
  })`;
  const def = ledgersInTime(ledgers());
  const all = entries(def, 'L1', parsed(Ledger, ledger));
  const pathOf = (names: readonly string[]) => names.reduceRight((rest, key) => `.step (key="${key}", rest=${rest})`, '.end');
  const ROLLUPS = {
    sum: '(fold=.sum, aggregate=.sum)', mean: '(fold=.mean, aggregate=.mean)', count: '(fold=.count, aggregate=.count)',
    last: '(fold=.last, aggregate=.sum)',
  } as const;
  /** The subtotal of a collection, by a rollup, at a node, a level and a tile; undefined where there is none. */
  const subtotal = (collection: 'readings' | 'stock', rollup: keyof typeof ROLLUPS, path: readonly string[], level: string, tile: string) =>
    entryAt(def, all, `(collection=.step (key="measures", rest=.step (key="${collection}", rest=.end)), row="L1", path=${pathOf(path)}, ` +
      `run=.subtotals ${ROLLUPS[rollup]}, level=.${level}, tile=${tile}T00:00:00.000, item=.none)`);
  const assertSubtotal = (got: unknown, expected: number, what: string) =>
    assertEast(def.valueType, got, parsed(def.valueType, `.subtotal ${expected.toFixed(4)}`), what);

  it('sums: a parent its children\'s sums, the ledger every top measure\'s draw', () => {
    assertSubtotal(subtotal('readings', 'sum', ['m1'], 'day', '2026-10-05'), 8, 'm1 on 5 Oct: 2 + 6');
    assertSubtotal(subtotal('readings', 'sum', [], 'day', '2026-10-05'), 108, 'the ledger on 5 Oct: m1\'s 8 and m3\'s own 100');
    assertSubtotal(subtotal('readings', 'sum', [], 'week', '2026-10-05'), 112, 'the ledger the week of 5 Oct: m1\'s 12 and m3\'s 100');
  });

  it('means as a mean of means', () => {
    assertSubtotal(subtotal('readings', 'mean', ['m1'], 'week', '2026-10-05'), 4.5, 'm1 the week of 5 Oct: m11\'s 3 and m12\'s 6');
    assertSubtotal(subtotal('readings', 'mean', [], 'week', '2026-10-05'), 52.25, 'the ledger: m1\'s 4.5 and m3\'s 100');
  });

  it('counts the leaf rows beneath that draw a value, a parent child adding its own count', () => {
    assertSubtotal(subtotal('readings', 'count', ['m1'], 'day', '2026-10-05'), 2, 'm1: m11 and m12');
    assertSubtotal(subtotal('readings', 'count', [], 'day', '2026-10-05'), 3, 'the ledger: m1\'s two and m3, which holds its own');
  });

  it('sums a last fold: each child\'s latest in the tile', () => {
    assertSubtotal(subtotal('stock', 'last', ['m1'], 'week', '2026-10-05'), 17, 'm1 the week of 5 Oct: m11\'s 12 on the 7th and m12\'s 5');
    assertSubtotal(subtotal('stock', 'last', [], 'day', '2026-10-05'), 13, 'the ledger on 5 Oct: m1\'s 10 and m3\'s 3');
  });

  it('draws a node\'s own values where it holds them, while another collection of the node still derives', () => {
    assert.equal(subtotal('readings', 'sum', ['m3'], 'day', '2026-10-05'), undefined, 'm3 holds its own readings, and keeps no subtotal of them');
    assertSubtotal(subtotal('stock', 'last', ['m3'], 'day', '2026-10-05'), 3, 'm3 holds no stock, and derives m31\'s');
  });

  it('keeps none in a tile no descendant\'s value touches', () => {
    assert.equal(subtotal('readings', 'sum', ['m1'], 'day', '2026-10-08'), undefined, 'm1 on 8 Oct');
    assert.equal(subtotal('readings', 'sum', ['m1'], 'week', '2026-10-12'), undefined, 'm1 the week of 12 Oct');
  });

  it('keeps each level\'s tiles from the index\'s tile to the year', () => {
    for (const [level, tile] of [['day', '2026-10-12'], ['week', '2026-10-12'], ['month', '2026-10-01'], ['quarter', '2026-10-01'], ['year', '2026-01-01']] as const) {
      assert.ok(subtotal('readings', 'sum', [], level, tile) !== undefined, `the ledger's sum at ${level} ${tile}`);
    }
    assertSubtotal(subtotal('readings', 'sum', [], 'year', '2026-01-01'), 113, 'the ledger\'s year: m1\'s 12, m2\'s 1 and m3\'s own 100, not m31\'s');
  });
});

// ── The lean rows ────────────────────────────────────────────────────────────

describe('e3.recordIndex.series, nested — the record\'s other indexes carry its lean rows', () => {
  const rec = machines();
  const nested = machinesInTime(rec);
  const plain = recordIndex('machines_by_site_status', rec, { on: ['site', 'status'] });
  const interval = recordIndex.interval('machines_in_service', rec, { from: 'installed', to: 'retired' });
  const area = recordIndex.area('machines_on_floor', rec, { x: 'x', y: 'y', cell: 1 });
  const keyed = recordIndex.series('machines_by_site_week', rec, { key: 'site', from: 'installed', to: 'retired', tile: 'week' });
  const named = recordIndex('machines_by_name', rec, { on: ['name'], value: East.function([StringType, Machine], StringType, (_$, _key, row) => row.name) });
  const assembled = package_('machines', '1.0.0', rec, nested, plain, interval, area, keyed, named).records.machines!;
  const row = parsed(Machine, machine({ 'j-1': job('2026-10-02T06:00:00.000') }, { '2026-10-05T00:00:00.000': 0.5 })
    .replace('installed=.none', 'installed=.some 2026-01-05T00:00:00.000'));
  const lean = parsed(Machine, machine({}).replace('installed=.none', 'installed=.some 2026-01-05T00:00:00.000'));

  it('carries the lean machine where an index carries nothing or the row: every listed collection empty', () => {
    for (const declared of [plain, interval, area, keyed]) {
      const built = builtIndex(assembled, assembled.indexes[declared.name]!);
      assert.ok(isTypeEqual(built.valueType, Machine), `${declared.name} carries ${printType(built.valueType)}`);
      const carried = new Set<unknown>();
      const run = indexBuildProgram(Machines, built).compile([]) as (piece: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
      run(parsed(Machines, `{"M-7":${printFor(Machine)(row)}}`), (_entry, value) => { carried.add(value); return null; });
      assert.ok(carried.size > 0, `${declared.name} files the machine`);
      for (const value of carried) assertEast(Machine, value, lean, `what ${declared.name} carries`);
    }
  });

  it('leaves an index with a value of its own, and the nested index itself, as declared', () => {
    assert.equal(builtIndex(assembled, assembled.indexes[named.name]!), assembled.indexes[named.name]);
    assert.equal(builtIndex(assembled, assembled.indexes[nested.name]!), assembled.indexes[nested.name]);
  });
});

// ── Through a write and a rebuild ────────────────────────────────────────────

/** The `[entry, value]` pairs an index's build program emits for a state. */
function emitted(def: RecordIndexDef, recordType: EastType, rows: unknown): [unknown, unknown][] {
  const out: [unknown, unknown][] = [];
  const run = indexBuildProgram(recordType, def).compile([]) as (piece: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
  run(rows, (entry, value) => {
    out.push([entry, value]);
    return null;
  });
  return out;
}

/** The delta a patch's program emits for a write of a patch to a state: each entry's target, its key there and its op. */
function written(rec: RecordDef, mut: MutationDef, before: unknown, patch: unknown): Array<{ target: string; key: unknown; op: variant<string, unknown> }> {
  const changes: Array<{ target: string; key: unknown; op: variant<string, unknown> }> = [];
  const run = buildMutationProgram(rec, mut).compile([]);
  run(before, patch, (key: variant<string, unknown>, op: variant<string, variant<string, unknown>>) => {
    changes.push({ target: key.type, key: key.value, op: op.value });
    return null;
  });
  return changes;
}

/** The patch from one state to another, as a client's diff makes it: each row it updates by the row's own patch. */
function diffOf(rec: RecordDef, before: unknown, after: unknown): unknown {
  return East.compile(East.patchesFor(rec.type).diff, [])(before as never, after as never);
}

/**
 * The same write with each row it updates replaced whole: the patch's `update`
 * of a row a `replace` of it, before and after, which the index can only
 * compare whole.
 */
function replacingRows(rec: RecordDef, before: unknown, after: unknown): unknown {
  const patch = diffOf(rec, before, after) as variant<string, unknown>;
  if (patch.type !== 'patch') return patch;
  const { keyType } = entryOf(rec);
  const held = before as SortedMap<unknown, unknown>;
  const next = after as SortedMap<unknown, unknown>;
  const ops = [...(patch.value as SortedMap<unknown, variant<string, unknown>>)].map(([key, op]): [unknown, unknown] =>
    [key, op.type === 'update' ? variant('update', variant('replace', { before: held.get(key), after: next.get(key) })) : op]);
  return variant('patch', new SortedMap(ops, compareFor(keyType)));
}

/**
 * Asserts a write keeps an index as a rebuild builds it: the write's ops for
 * the index, applied to its entries before, are its entries after, byte for
 * byte as e3 stores them; and the same write with each row it updates
 * replaced whole, which the index compares whole, gives the same ops — and
 * returns the ops.
 */
function maintainedIsRebuilt(rec: RecordDef, index: RecordIndexDef, before: unknown, after: unknown, what: string): SortedMap<unknown, variant<string, unknown>> {
  const patch = mutation.patch(rec as never);
  const assembled = package_('nested', '1.0.0', rec, patch, index).records[rec.name]!;
  const { keyType } = entryOf(rec);
  const entryKey = StructType({ ik: index.keyType, k: keyType });
  const collection = DictType(entryKey, index.valueType);
  const opsType = patchTypeOf(collection);
  if (opsType.type !== 'Variant') throw new Error(`a Dict's patch is a variant, not ${printType(opsType)}`);
  const deltaType = opsType.cases.patch!;
  const opsOf = (sent: unknown) => new SortedMap(written(assembled, patch, before, sent)
    .filter((change) => change.target === index.name).map((change) => [change.key, change.op]) as never, compareFor(entryKey));
  const held = new SortedMap(emitted(index, rec.type, before) as never, compareFor(entryKey));
  const rebuilt = new SortedMap(emitted(index, rec.type, after) as never, compareFor(entryKey));
  const ops = opsOf(diffOf(rec, before, after));
  const apply = East.compile(East.patchesFor(collection).apply, []);
  const maintained = apply(held, variant('patch', ops));
  assert.deepEqual(encodeBeast2PagedFor(collection)(maintained as never), encodeBeast2PagedFor(collection)(rebuilt as never), `${what}: maintained is rebuilt`);
  const print = printFor(deltaType);
  assert.equal(print(opsOf(replacingRows(rec, before, after)) as never), print(ops as never), `${what}: by the patch, the delta compared whole`);
  return ops as SortedMap<unknown, variant<string, unknown>>;
}

/** The ops of a write by their kind, each entry's run and level as East prints them, to compare as a table. */
function opsTable(ops: SortedMap<unknown, variant<string, unknown>>): string[] {
  const words: string[] = [];
  for (const [key, op] of ops) {
    const ik = (key as { ik: { run: variant<string, unknown>; level: variant<string, unknown>; path: unknown } }).ik;
    words.push(`${op.type} ${ik.run.type} ${ik.level.type}`);
  }
  return words.sort();
}

/** The ops of a write as {@link opsTable} gives them, each led by its row's key as East prints it. */
function rowOpsTable(ops: SortedMap<unknown, variant<string, unknown>>): string[] {
  const words: string[] = [];
  for (const [key, op] of ops) {
    const entry = key as { ik: { run: variant<string, unknown>; level: variant<string, unknown> }; k: string };
    words.push(`${printFor(StringType)(entry.k)} ${op.type} ${entry.ik.run.type} ${entry.ik.level.type}`);
  }
  return words.sort();
}

describe('e3.recordIndex.series, nested — through a write and a rebuild', () => {
  const OCT_2 = '2026-10-02T06:00:00.000';
  const OCT_2_NIGHT = '2026-10-02T14:00:00.000';

  it('a job moved within its tile: an update of its entry, and its month total unchanged', () => {
    const rec = machines();
    const index = machinesInTime(rec);
    const before = state(Machines, { 'M-7': machine({ 'j-1': job(OCT_2, OCT_2_NIGHT) }) });
    const after = state(Machines, { 'M-7': machine({ 'j-1': job('2026-10-03T06:00:00.000', '2026-10-03T14:00:00.000') }) });
    assert.deepEqual(opsTable(maintainedIsRebuilt(rec, index, before, after, 'moved within its week')), ['update items week']);
  });

  it('a job moved to the next week: a delete and an insert, and October\'s total unchanged', () => {
    const rec = machines();
    const index = machinesInTime(rec);
    const before = state(Machines, { 'M-7': machine({ 'j-1': job(OCT_2, OCT_2_NIGHT) }) });
    const after = state(Machines, { 'M-7': machine({ 'j-1': job('2026-10-09T06:00:00.000', '2026-10-09T14:00:00.000') }) });
    assert.deepEqual(opsTable(maintainedIsRebuilt(rec, index, before, after, 'moved a week on')), ['delete items week', 'insert items week']);
  });

  it('a job moved into November: its entries moved, and October\'s total and November\'s changed', () => {
    const rec = machines();
    const index = machinesInTime(rec);
    const before = state(Machines, { 'M-7': machine({ 'j-1': job(OCT_2, OCT_2_NIGHT) }) });
    const after = state(Machines, { 'M-7': machine({ 'j-1': job('2026-11-03T06:00:00.000', '2026-11-03T14:00:00.000') }) });
    assert.deepEqual(opsTable(maintainedIsRebuilt(rec, index, before, after, 'moved into November')),
      ['delete items week', 'delete totals month', 'insert items week', 'insert totals month']);
  });

  it('a job stretched from 8 hours to 40 days: its week entry deleted, a quarter entry inserted, each month it touches totalled', () => {
    const rec = machines();
    const index = machinesInTime(rec);
    const before = state(Machines, { 'M-7': machine({ 'j-1': job(OCT_2, OCT_2_NIGHT) }) });
    const after = state(Machines, { 'M-7': machine({ 'j-1': job(OCT_2, '2026-11-11T06:00:00.000') }) });
    assert.deepEqual(opsTable(maintainedIsRebuilt(rec, index, before, after, 'stretched to 40 days')),
      ['delete items week', 'insert items quarter', 'insert totals month', 'update totals month']);
  });

  it('a job moved from M-7 to M-9: M-7\'s entries deleted and its total updated, M-9\'s inserted', () => {
    const rec = machines();
    const index = machinesInTime(rec);
    const other = { 'j-2': job('2026-10-12T06:00:00.000', '2026-10-14T06:00:00.000') };
    const before = state(Machines, { 'M-7': machine({ 'j-1': job(OCT_2, OCT_2_NIGHT), ...other }), 'M-9': machine({}) });
    const after = state(Machines, { 'M-7': machine(other), 'M-9': machine({ 'j-1': job(OCT_2, OCT_2_NIGHT) }) });
    assert.deepEqual(rowOpsTable(maintainedIsRebuilt(rec, index, before, after, 'moved to another machine')),
      ['"M-7" delete items week', '"M-7" update totals month', '"M-9" insert items week', '"M-9" insert totals month']);
  });

  it('a day\'s load changed: its entry and its month\'s total updated', () => {
    const rec = machines();
    const index = machinesInTime(rec);
    const jobs = { 'j-1': job(OCT_2, OCT_2_NIGHT) };
    const before = state(Machines, { 'M-7': machine(jobs, { '2026-10-05T00:00:00.000': 0.82, '2026-10-06T00:00:00.000': 0.5 }) });
    const after = state(Machines, { 'M-7': machine(jobs, { '2026-10-05T00:00:00.000': 0.9, '2026-10-06T00:00:00.000': 0.5 }) });
    assert.deepEqual(opsTable(maintainedIsRebuilt(rec, index, before, after, 'a load changed')), ['update items week', 'update totals month']);
  });

  it('a machine deleted: every entry of its deleted', () => {
    const rec = machines();
    const index = machinesInTime(rec);
    const kept = machine({ 'j-5': job('2026-09-01T00:00:00.000', '2026-09-30T00:00:00.000') });
    const before = state(Machines, { 'M-7': machine({ 'j-1': job(OCT_2, OCT_2_NIGHT) }, { '2026-10-05T00:00:00.000': 0.82 }), 'M-8': kept });
    const ops = maintainedIsRebuilt(rec, index, before, state(Machines, { 'M-8': kept }), 'a machine deleted');
    assert.deepEqual(rowOpsTable(ops), ['"M-7" delete items week', '"M-7" delete items week', '"M-7" delete totals month', '"M-7" delete totals month']);
  });

  it('a job moved to another machine, one inserted and one deleted, a day\'s load changed, a machine replaced and one deleted', () => {
    const rec = machines();
    const index = machinesInTime(rec);
    const before = state(Machines, {
      'M-7': machine({ 'j-1': job(OCT_2, OCT_2_NIGHT), 'j-2': job('2026-10-12T06:00:00.000', '2026-10-14T06:00:00.000') }, { '2026-10-05T00:00:00.000': 0.82 }),
      'M-8': machine({ 'j-5': job('2026-09-01T00:00:00.000', '2026-09-30T00:00:00.000') }),
      'M-9': machine({}),
    });
    const after = state(Machines, {
      'M-7': machine({ 'j-3': job('2026-10-20T06:00:00.000') }, { '2026-10-05T00:00:00.000': 0.9 }),
      'M-9': machine({ 'j-1': job(OCT_2, OCT_2_NIGHT) }, { '2026-12-01T00:00:00.000': 0.4 }, 'down'),
    });
    maintainedIsRebuilt(rec, index, before, after, 'moved, inserted, deleted, changed, replaced');
  });

  it('a machine\'s status changed: nothing here', () => {
    const rec = machines();
    const index = machinesInTime(rec);
    const jobs = { 'j-1': job(OCT_2, OCT_2_NIGHT) };
    const ops = maintainedIsRebuilt(rec, index, state(Machines, { 'M-7': machine(jobs) }), state(Machines, { 'M-7': machine(jobs, {}, 'down') }), 'status');
    assert.equal(ops.size, 0, 'no entry changes');
  });

  it('a member\'s load changed, a member added and one removed: the entries, the totals and the hall\'s means', () => {
    const rec = halls();
    const index = hallsInTime(rec);
    const hall = (members: string) => `(name="Hall 1", site="North", members={${members}})`;
    const before = state(Halls, { H1: hall('"m-3":(name="Ada", load={2026-10-05T00:00:00.000:0.82}), "m-4":(name="Bo", load={2026-10-05T00:00:00.000:0.6})') });
    const changed = state(Halls, { H1: hall('"m-3":(name="Ada", load={2026-10-05T00:00:00.000:0.7}), "m-4":(name="Bo", load={2026-10-05T00:00:00.000:0.6})') });
    const moved = state(Halls, { H1: hall('"m-3":(name="Ada", load={2026-10-05T00:00:00.000:0.7}), "m-9":(name="Cy", load={2026-11-05T00:00:00.000:0.2})') });
    const ops = maintainedIsRebuilt(rec, index, before, changed, 'a load changed');
    assert.deepEqual(opsTable(ops), ['update items day', 'update subtotals day', 'update subtotals month', 'update subtotals quarter',
      'update subtotals week', 'update subtotals year', 'update totals month']);
    maintainedIsRebuilt(rec, index, changed, moved, 'a member added and one removed');
  });

  it('a member added to a hall: its load\'s entries inserted under it, and the hall\'s subtotals where its load touches', () => {
    const rec = halls();
    const index = hallsInTime(rec);
    const members = '"m-3":(name="Ada", load={2026-10-05T00:00:00.000:0.7}), "m-4":(name="Bo", load={2026-10-05T00:00:00.000:0.6})';
    const before = state(Halls, { H1: `(name="Hall 1", site="North", members={${members}})` });
    const after = state(Halls, { H1: `(name="Hall 1", site="North", members={${members}, "m-9":(name="Cy", load={2026-11-05T00:00:00.000:0.2})})` });
    assert.deepEqual(opsTable(maintainedIsRebuilt(rec, index, before, after, 'a member added')), ['insert items day', 'insert subtotals day',
      'insert subtotals month', 'insert subtotals week', 'insert totals month', 'update subtotals quarter', 'update subtotals year']);
  });

  it('a part\'s job moved, rolled up: its entries under it, and under its ancestors in the subtree run, moved; the months it left and joined totalled', () => {
    const rec = assemblies();
    const index = assembliesInTime(rec);
    const assembly = (start: string, end: string) =>
      `(name="Assembly 1", parts={"p1":(name="p1", jobs={:}, parts={"p1.2":(name="p1.2", jobs={"j-9":${job(start, end)}}, parts={:})})})`;
    const before = state(Assemblies, { 'A-1': assembly(OCT_2, OCT_2_NIGHT) });
    const after = state(Assemblies, { 'A-1': assembly('2026-11-03T06:00:00.000', '2026-11-03T14:00:00.000') });
    assert.deepEqual(opsTable(maintainedIsRebuilt(rec, index, before, after, 'a part\'s job moved')), [
      'delete items week', 'delete subtree week', 'delete subtree week', 'delete subtreeTotals month', 'delete subtreeTotals month', 'delete totals month',
      'insert items week', 'insert subtree week', 'insert subtree week', 'insert subtreeTotals month', 'insert subtreeTotals month', 'insert totals month',
    ]);
  });

  it('a part\'s job moved, rolled up, and a part added and one removed: under every ancestor too', () => {
    const rec = assemblies();
    const index = assembliesInTime(rec);
    const assembly = (jobs: string, extra = '') =>
      `(name="Assembly 1", parts={"p1":(name="p1", jobs={:}, parts={"p1.2":(name="p1.2", jobs={${jobs}}, parts={:})${extra}})})`;
    const before = state(Assemblies, { 'A-1': assembly(`"j-9":${job(OCT_2, OCT_2_NIGHT)}`) });
    const moved = state(Assemblies, { 'A-1': assembly(`"j-9":${job('2026-11-03T06:00:00.000', '2026-11-03T14:00:00.000')}`) });
    const grown = state(Assemblies, {
      'A-1': `(name="Assembly 1", parts={"p2":(name="p2", jobs={"j-1":${job(OCT_2)}}, parts={:})})`,
    });
    maintainedIsRebuilt(rec, index, before, moved, 'a part\'s job moved');
    maintainedIsRebuilt(rec, index, moved, grown, 'a part added and one removed');
  });

  it('a leaf measure\'s reading changed, added and removed, and a measure added beneath another', () => {
    const rec = ledgers();
    const index = ledgersInTime(rec);
    const measure = (label: string, readings: string, children = '') =>
      `(label="${label}", readings={${readings === '' ? ':' : readings}}, stock={:}, children={${children === '' ? ':' : children}})`;
    const ledger = (m11: string, more = '') => `(name="Ledger 1", site="North", measures={"m1":${measure('Plant', '', `"m11":${m11}${more}`)}})`;
    const before = state(Ledgers, { L1: ledger(measure('Press', '2026-10-05T00:00:00.000:2.0')) });
    const changed = state(Ledgers, { L1: ledger(measure('Press', '2026-10-05T00:00:00.000:3.0, 2026-10-06T00:00:00.000:1.0')) });
    const removed = state(Ledgers, { L1: ledger(measure('Press', '2026-10-06T00:00:00.000:1.0')) });
    const deeper = state(Ledgers, { L1: ledger(measure('Press', '2026-10-06T00:00:00.000:1.0'), `, "m12":${measure('Folder', '', `"m121":${measure('Belt', '2026-10-07T00:00:00.000:5.0')}`)}`) });
    maintainedIsRebuilt(rec, index, before, changed, 'a reading changed and one added');
    maintainedIsRebuilt(rec, index, changed, removed, 'a reading removed');
    maintainedIsRebuilt(rec, index, removed, deeper, 'a measure added beneath another');
  });

  it('a collection replaced whole, and every row inserted from none and deleted to none', () => {
    const rec = machines();
    const index = machinesInTime(rec);
    const one = state(Machines, { 'M-7': machine({ 'j-1': job(OCT_2, OCT_2_NIGHT), 'j-2': job('2026-10-12T06:00:00.000') }) });
    const other = state(Machines, { 'M-7': machine({ 'j-8': job('2026-12-12T06:00:00.000'), 'j-9': job('2027-01-12T06:00:00.000') }) });
    maintainedIsRebuilt(rec, index, one, other, 'the jobs replaced');
    maintainedIsRebuilt(rec, index, state(Machines, {}), one, 'inserted from none');
    maintainedIsRebuilt(rec, index, one, state(Machines, {}), 'deleted to none');
  });
});

// ── A write by its patch ─────────────────────────────────────────────────────

/**
 * What an index's write by its patch makes of a row: `whole` where it cannot
 * say what the patch touched, or the entries it compares, before and after.
 */
function byPatch(index: RecordIndexDef, key: string, held: unknown, next: unknown, patch?: unknown): variant<string, unknown> {
  const { keyType, rowType } = entryOf(index.record);
  const nested = index.nested;
  if (nested === undefined) throw new Error(`'${index.name}' is no nested series index`);
  const entriesType = DictType(index.keyType, index.valueType);
  const run = East.compile(functionAt(nested.byPatch, [keyType, rowType, rowType, patchTypeOf(rowType)], NestedPatchedType(entriesType)), []);
  const sent = patch ?? East.compile(East.patchesFor(rowType).diff, [])(held as never, next as never);
  return run(key, held, next, sent) as variant<string, unknown>;
}

/** Asserts a write by its patch compared the entries expected, before and after, each Dict written as East prints one. */
function assertCompared(index: RecordIndexDef, compared: variant<string, unknown>, before: string, after: string): void {
  assert.equal(compared.type, 'changed', 'by the patch');
  const both = compared.value as { before: unknown; after: unknown };
  const entriesType = DictType(index.keyType, index.valueType);
  assertEast(entriesType, both.before, parsed(entriesType, before), 'the entries before');
  assertEast(entriesType, both.after, parsed(entriesType, after), 'the entries after');
}

describe('e3.recordIndex.series, nested — a write by its patch', () => {
  const OCT_2 = '2026-10-02T06:00:00.000';
  const OCT_2_NIGHT = '2026-10-02T14:00:00.000';
  const NOV_3 = '2026-11-03T06:00:00.000';
  const NOV_3_NIGHT = '2026-11-03T14:00:00.000';

  it('compares only the items the patch names, and the totals of the tiles they touch', () => {
    const index = machinesInTime(machines());
    const others = { 'j-2': job('2026-10-12T06:00:00.000'), 'j-3': job('2026-12-01T06:00:00.000') };
    const load = { '2026-10-05T00:00:00.000': 0.82 };
    const held = parsed(Machine, machine({ 'j-1': job(OCT_2, OCT_2_NIGHT), ...others }, load));
    const next = parsed(Machine, machine({ 'j-1': job(NOV_3, NOV_3_NIGHT), ...others }, load));
    assertCompared(index, byPatch(index, 'M-7', held, next), `{
      (collection=.step (key="jobs", rest=.end), row="M-7", path=.end, run=.items, level=.week, tile=2026-09-28T00:00:00.000, item=.id "j-1"):
        .item .jobs ${job(OCT_2, OCT_2_NIGHT)},
      (collection=.step (key="jobs", rest=.end), row="M-7", path=.end, run=.totals, level=.month, tile=2026-10-01T00:00:00.000, item=.none):
        .totals (count=2, ms=28800000, values=.none)
    }`, `{
      (collection=.step (key="jobs", rest=.end), row="M-7", path=.end, run=.items, level=.week, tile=2026-11-02T00:00:00.000, item=.id "j-1"):
        .item .jobs ${job(NOV_3, NOV_3_NIGHT)},
      (collection=.step (key="jobs", rest=.end), row="M-7", path=.end, run=.totals, level=.month, tile=2026-10-01T00:00:00.000, item=.none):
        .totals (count=1, ms=0, values=.none),
      (collection=.step (key="jobs", rest=.end), row="M-7", path=.end, run=.totals, level=.month, tile=2026-11-01T00:00:00.000, item=.none):
        .totals (count=1, ms=28800000, values=.none)
    }`);
  });

  it('compares a member\'s value, its members\' totals of its month and its hall\'s subtotals, and no other member\'s value', () => {
    const index = hallsInTime(halls());
    const hall = (load: string) => parsed(Hall,
      `(name="Hall 1", site="North", members={"m-3":(name="Ada", load={2026-10-05T00:00:00.000:${load}}), "m-4":(name="Bo", load={2026-10-05T00:00:00.000:0.6})})`);
    const member = '(collection=.step (key="members", rest=.step (key="load", rest=.end)), row="H1", path=.step (key="m-3", rest=.end)';
    const other = '(collection=.step (key="members", rest=.step (key="load", rest=.end)), row="H1", path=.step (key="m-4", rest=.end)';
    const parent = '(collection=.step (key="members", rest=.step (key="load", rest=.end)), row="H1", path=.end, run=.subtotals (fold=.mean, aggregate=.mean)';
    const entries = (load: number) => `{
      ${member}, run=.items, level=.day, tile=2026-10-05T00:00:00.000, item=.at 2026-10-05T00:00:00.000): .item .members .load ${load},
      ${member}, run=.totals, level=.month, tile=2026-10-01T00:00:00.000, item=.none):
        .totals (count=1, ms=0, values=.some (sum=${load}, min=${load}, max=${load}, last=${load})),
      ${other}, run=.totals, level=.month, tile=2026-10-01T00:00:00.000, item=.none):
        .totals (count=1, ms=0, values=.some (sum=0.6, min=0.6, max=0.6, last=0.6)),
      ${parent}, level=.day, tile=2026-10-05T00:00:00.000, item=.none): .subtotal ${(load + 0.6) / 2},
      ${parent}, level=.week, tile=2026-10-05T00:00:00.000, item=.none): .subtotal ${(load + 0.6) / 2},
      ${parent}, level=.month, tile=2026-10-01T00:00:00.000, item=.none): .subtotal ${(load + 0.6) / 2},
      ${parent}, level=.quarter, tile=2026-10-01T00:00:00.000, item=.none): .subtotal ${(load + 0.6) / 2},
      ${parent}, level=.year, tile=2026-01-01T00:00:00.000, item=.none): .subtotal ${(load + 0.6) / 2}
    }`;
    assertCompared(index, byPatch(index, 'H1', hall('0.82'), hall('0.7')), entries(0.82), entries(0.7));
  });

  it('compares a child row inserted whole, beside what else its patch names', () => {
    const index = assembliesInTime(assemblies());
    const held = parsed(Assembly, `(name="Assembly 1", parts={"p1":(name="p1", jobs={"j-1":${job(OCT_2, OCT_2_NIGHT)}}, parts={:})})`);
    const next = parsed(Assembly, `(name="Assembly 1", parts={"p1":(name="p1", jobs={"j-1":${job(OCT_2, OCT_2_NIGHT)}}, parts={:}), ` +
      `"p2":(name="p2", jobs={:}, parts={"p2.1":(name="p2.1", jobs={"j-7":${job(NOV_3, NOV_3_NIGHT)}}, parts={:})})})`);
    const compared = byPatch(index, 'A-1', held, next);
    assert.equal(compared.type, 'changed', 'by the patch');
    const both = compared.value as { before: SortedMap<unknown, unknown>; after: SortedMap<unknown, unknown> };
    const jobsOf = (all: SortedMap<unknown, unknown>) => [...all.keys()].flatMap((key) => {
      const item = (key as { item: variant<string, unknown> }).item;
      return item.type === 'none' ? [] : [printFor(index.keyType)(key as never)];
    });
    assert.deepEqual(jobsOf(both.before), [], 'no item compared before: p1\'s j-1 is not touched');
    const after = jobsOf(both.after);
    assert.equal(after.length, 3, `j-7 under p2.1, and under p2 and the row in the subtree: ${after.join('; ')}`);
    assert.ok(after.every((key) => key.includes('"j-7"')), 'only j-7');
  });

  it('leaves the row to be compared whole where a replace is on the way, as a recursive child row\'s change always is', () => {
    const machinesIndex = machinesInTime(machines());
    const one = parsed(Machine, machine({ 'j-1': job(OCT_2, OCT_2_NIGHT) }));
    const other = parsed(Machine, machine({ 'j-2': job(NOV_3, NOV_3_NIGHT) }));
    assert.equal(byPatch(machinesIndex, 'M-7', one, other, variant('replace', { before: one, after: other })).type, 'whole', 'the row replaced');
    assert.equal(byPatch(machinesIndex, 'M-7', one, other).type, 'whole', 'its jobs replaced, none of their keys kept');
    const assembliesIndex = assembliesInTime(assemblies());
    const assembly = (start: string, end: string) =>
      parsed(Assembly, `(name="Assembly 1", parts={"p1":(name="p1", jobs={:}, parts={"p1.2":(name="p1.2", jobs={"j-9":${job(start, end)}}, parts={:})})})`);
    assert.equal(byPatch(assembliesIndex, 'A-1', assembly(OCT_2, OCT_2_NIGHT), assembly(NOV_3, NOV_3_NIGHT)).type, 'whole',
      'a part\'s job moved: East patches a part only whole');
  });

  it('compares nothing where the patch names none of what the index files', () => {
    const index = machinesInTime(machines());
    const jobs = { 'j-1': job(OCT_2, OCT_2_NIGHT) };
    assertCompared(index, byPatch(index, 'M-7', parsed(Machine, machine(jobs)), parsed(Machine, machine(jobs, {}, 'down'))), '{:}', '{:}');
  });
});
