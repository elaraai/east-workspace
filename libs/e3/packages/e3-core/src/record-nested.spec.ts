/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The nested series index (#1434) on the real runners.
 *
 * Its entries — items filed by level, totals, items rolled up under every
 * ancestor, parents' subtotals — and the lean rows the record's other indexes
 * carry are East the SDK generates, so every runtime must give every row the
 * same entries, byte for byte, and a maintained index must be the one a
 * reindex rebuilds. This deploys the same six records to a workspace per
 * runtime — machines (things people drag, and values), halls (members' loads,
 * rolled up by their mean), assemblies (parts five deep, their jobs rolled up
 * under every ancestor), ledgers (measure trees three levels deep, their
 * readings rolled up by sum, mean and count, their stock by its last,
 * summed), crews (each crew's hours by role, a variant, and a role's shifts by
 * their number: child rows and items keyed by other types than String, #1540;
 * and its kit, child rows that nest nothing and declare no collection)
 * and gauges (a value a day and nothing keyed by an id, so an index whose ids
 * have no case) — each with its patch door, its nested index and an index of
 * its rows. It writes the same rows through the doors, then the issue's writes one
 * after another, and a reduce over all last, and compares the states hash for
 * hash after each: across the runtimes, against a rebuild in each, and against
 * the same writes with every row they update replaced whole — which the index
 * compares whole rather than walking its patch.
 *
 * The rows are a few dozen of each, every shape the issue names — a year long,
 * before 1970, with no end, with no start, an instant — rather than its
 * thousand machines, so the suite stays quick on three runtimes.
 *
 * The parity compares every runtime installed and skips with fewer than two;
 * the rest runs on each runtime installed.
 *
 * And a window of the rail's rows, read without a join through an index
 * carrying them beside the nested index, reads none of the record's own
 * objects, under a store that keeps every read.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { join, dirname } from 'node:path';
import {
  DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, PatchType, RecursiveType, SortedMap, StringType, StructType,
  VariantType, compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, fromEastTypeValue, printFor, variant,
  type EastType, type ValueTypeOf,
} from '@elaraai/east';
import e3, { type PartRunner } from '@elaraai/e3';
import { RecordNestedPathType } from '@elaraai/e3-types';
import { recordMutate, recordReindex, readRecordState, resolveRecordIndex } from './records.js';
import { DatasetSegments, readManifest } from './dataset-open.js';
import { packageImport } from './package-files.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir, stockRunners, seededStream, parsedValue, dictText } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { StorageBackend, TaskRunner } from './index.js';

// ── The records ──────────────────────────────────────────────────────────────

const Job = StructType({
  product: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), state: StringType, sheets: FloatType,
});
const Stop = StructType({ reason: StringType, start: DateTimeType, end: DateTimeType });
const Alarm = StructType({ code: StringType, severity: StringType, at: DateTimeType });
const Machine = StructType({
  name: StringType, site: StringType, status: StringType,
  jobs: DictType(StringType, Job), stops: DictType(StringType, Stop), alarms: DictType(StringType, Alarm),
  load: DictType(DateTimeType, FloatType), output: DictType(DateTimeType, IntegerType),
});
const Machines = DictType(StringType, Machine);
const Member = StructType({ name: StringType, load: DictType(DateTimeType, FloatType) });
const Hall = StructType({ name: StringType, site: StringType, members: DictType(StringType, Member) });
const Halls = DictType(StringType, Hall);
const Part = RecursiveType((self) => StructType({ name: StringType, jobs: DictType(StringType, Job), parts: DictType(StringType, self) }));
const Assembly = StructType({ name: StringType, parts: DictType(StringType, Part) });
const Assemblies = DictType(StringType, Assembly);
const Measure = RecursiveType((self) => StructType({
  label: StringType, readings: DictType(DateTimeType, FloatType), stock: DictType(DateTimeType, FloatType), children: DictType(StringType, self),
}));
const Ledger = StructType({ name: StringType, site: StringType, measures: DictType(StringType, Measure) });
const Ledgers = DictType(StringType, Ledger);
/** A role in a crew (#1540): what a crew's hours are keyed by. */
const Role = VariantType({ assistant: NullType, operator: NullType });
const Shift = StructType({ at: DateTimeType, who: StringType });
const RoleHours = StructType({ hours: DictType(DateTimeType, FloatType), shifts: DictType(IntegerType, Shift) });
/** What a crew carries: rows of its own that nest nothing in time. */
const Kit = StructType({ label: StringType });
const Crew = StructType({ name: StringType, site: StringType, hours: DictType(Role, RoleHours), kit: DictType(StringType, Kit) });
const Crews = DictType(StringType, Crew);
/** A gauge: a level a day, and nothing keyed by an id. */
const Gauge = StructType({ name: StringType, site: StringType, level: DictType(DateTimeType, FloatType) });
const Gauges = DictType(StringType, Gauge);

/** A runner selection, as a record's builders take one. */
type RunnerConfig = PartRunner;

/** The six records, each with its patch door, its nested index and an index of its rows, on a runner; and a reduce over the machines. */
function declared(runner?: RunnerConfig) {
  const machines = e3.record('machines', Machines, {
    initial: new Map(),
    indexes: (index) => ({
      machines_in_time: index.nestedSeries({
        collections: {
          jobs: index.nestedSeries.items({ from: 'start', to: 'end' }), stops: index.nestedSeries.items({ from: 'start', to: 'end' }),
          alarms: index.nestedSeries.items({ at: 'at' }), load: index.nestedSeries.values(), output: index.nestedSeries.values(),
        },
        tile: 'week',
        summary: 'month',
      }, runner),
      machines_by_site_status: index.on(['site', 'status'], runner),
    }),
    mutations: (mutation) => ({
      patch: mutation.patch(runner),
      // Every machine's load and output cleared, and its stops: a write the program compares row by row.
      clear: mutation.reduce(East.function([Machines], Machines, (_$, state) => state.map(($, m) => ({
        name: m.name, site: m.site, status: m.status, jobs: m.jobs,
        stops: $.let(new Map(), DictType(StringType, Stop)),
        alarms: m.alarms,
        load: $.let(new Map(), DictType(DateTimeType, FloatType)),
        output: $.let(new Map(), DictType(DateTimeType, IntegerType)),
      }))), runner),
    }),
  });
  const halls = e3.record('halls', Halls, {
    initial: new Map(),
    indexes: (index) => ({
      halls_in_time: index.nestedSeries({
        collections: { members: index.nestedSeries.rows({ load: index.nestedSeries.values({ rollup: 'mean' }) }) }, tile: 'day', summary: 'month',
      }, runner),
      halls_by_site: index.on(['site'], runner),
    }),
    mutations: (mutation) => ({ patch: mutation.patch(runner) }),
  });
  const assemblies = e3.record('assemblies', Assemblies, {
    initial: new Map(),
    indexes: (index) => ({
      assemblies_in_time: index.nestedSeries({
        collections: { parts: index.nestedSeries.rows({ jobs: index.nestedSeries.items({ from: 'start', to: 'end' }, { rollup: true }), parts: index.nestedSeries.recursive() }) },
        tile: 'week',
        summary: 'month',
      }, runner),
      assemblies_by_name: index.on(['name'], runner),
    }),
    mutations: (mutation) => ({ patch: mutation.patch(runner) }),
  });
  const ledgers = e3.record('ledgers', Ledgers, {
    initial: new Map(),
    indexes: (index) => ({
      ledgers_in_time: index.nestedSeries({
        collections: {
          measures: index.nestedSeries.rows({
            readings: index.nestedSeries.values({ rollup: ['sum', 'mean', 'count'] }),
            stock: index.nestedSeries.values({ rollup: { fold: 'last', aggregate: 'sum' } }),
            children: index.nestedSeries.recursive(),
          }),
        },
        tile: 'day',
      }, runner),
      ledgers_by_site: index.on(['site'], runner),
    }),
    mutations: (mutation) => ({ patch: mutation.patch(runner) }),
  });
  // Each crew's hours by role, the roles summed a crew, and each role's shifts by their number.
  const crews = e3.record('crews', Crews, {
    initial: new Map(),
    indexes: (index) => ({
      crews_in_time: index.nestedSeries({
        collections: {
          hours: index.nestedSeries.rows({ hours: index.nestedSeries.values({ rollup: 'sum' }), shifts: index.nestedSeries.items({ at: 'at' }) }),
          kit: index.nestedSeries.rows({}),
        },
        tile: 'week',
        summary: 'month',
      }, runner),
      crews_by_site: index.on(['site'], runner),
    }),
    mutations: (mutation) => ({ patch: mutation.patch(runner) }),
  });
  const gauges = e3.record('gauges', Gauges, {
    initial: new Map(),
    indexes: (index) => ({
      gauges_in_time: index.nestedSeries({ collections: { level: index.nestedSeries.values() }, tile: 'day', summary: 'month' }, runner),
      gauges_by_site: index.on(['site'], runner),
    }),
    mutations: (mutation) => ({ patch: mutation.patch(runner) }),
  });
  return [machines, halls, assemblies, ledgers, crews, gauges] as const;
}

/** Each record's name and state type. */
const RECORDS: ReadonlyArray<{ name: string; type: EastType }> = [
  { name: 'machines', type: Machines }, { name: 'halls', type: Halls }, { name: 'assemblies', type: Assemblies }, { name: 'ledgers', type: Ledgers },
  { name: 'crews', type: Crews }, { name: 'gauges', type: Gauges },
];

/** Each index's record and name. */
const INDEXES = declared().flatMap((rec) => Object.values(rec.indexes).map((index) => ({ record: rec.name, name: index.name })));

// ── The rows, written as East prints them ────────────────────────────────────

/** An instant as East prints one, `days` days and `hours` hours after Monday 5 October 2026. */
function day(days: number, hours = 0): string {
  const at = new Date(Date.UTC(2026, 9, 5) + days * 86_400_000 + hours * 3_600_000);
  return `${at.toISOString().slice(0, 23)}`;
}

/** A job as East prints one; no end an instant or open, no start not yet scheduled. */
function job(start: string | undefined, end: string | undefined, product = 'Labels'): string {
  const when = (t: string | undefined) => (t === undefined ? '.none' : `.some ${t}`);
  return `(product="${product}", start=${when(start)}, end=${when(end)}, state="planned", sheets=120.0)`;
}

/** A machine's jobs, every shape: hours, days, a month, a year, before 1970, an instant, open, unscheduled. */
function machineJobs(m: number, draw: () => number): string[] {
  const offset = Math.floor(draw() * 40) - 10;
  return [
    `"j-${m}-0":${job(day(offset, 6), day(offset, 14))}`,
    `"j-${m}-1":${job(day(offset + 2), day(offset + 5))}`,
    `"j-${m}-2":${job(day(offset + 3), day(offset + 33))}`,
    `"j-${m}-3":${job(day(offset - 100), day(offset + 300))}`,
    `"j-${m}-4":${job('1969-12-30T06:00:00.000', '1970-01-02T06:00:00.000')}`,
    `"j-${m}-5":${job(day(offset + 7, 9), undefined)}`,
    `"j-${m}-6":${job(day(offset + 8, 9), day(offset + 8, 3))}`,
    `"j-${m}-7":${job(undefined, undefined)}`,
  ];
}

/** A machine as East prints one. */
function machine(m: number, draw: () => number, status = 'up', jobs = machineJobs(m, draw)): string {
  const load = Array.from({ length: 30 }, (_, d) => `${day(d)}:${(Math.floor(draw() * 100) / 100).toFixed(2)}`);
  const output = Array.from({ length: 30 }, (_, d) => `${day(d)}:${Math.floor(draw() * 500)}`);
  return `(name="Press ${m}", site="Site ${m % 3}", status="${status}", jobs=${dictText(jobs)}, ` +
    `stops=${dictText([`"s-${m}":(reason="clean", start=${day(4)}, end=${day(4, 2)})`])}, ` +
    `alarms=${dictText([`"a-${m}-0":(code="E1", severity="high", at=${day(3, 5)})`, `"a-${m}-1":(code="E2", severity="low", at=${day(11, 1)})`])}, ` +
    `load=${dictText(load)}, output=${dictText(output)})`;
}

/** A hall's member as East prints one: a value each of `days` days. */
function member(name: string, days: number, draw: () => number): string {
  return `(name="${name}", load=${dictText(Array.from({ length: days }, (_, d) => `${day(d)}:${(Math.floor(draw() * 100) / 100).toFixed(2)}`))})`;
}

/** An assembly's parts five deep as East prints them, a job at each depth. */
function parts(a: number, draw: () => number): string {
  let inner = '{:}';
  for (let depth = 5; depth >= 1; depth--) {
    const offset = Math.floor(draw() * 30);
    inner = `{"p${depth}":(name="part ${a}.${depth}", jobs=${dictText([`"j-${a}-${depth}":${job(day(offset, 6), day(offset + depth, 6))}`])}, parts=${inner})}`;
  }
  return inner;
}

/** A measure as East prints one. */
function measure(label: string, readings: readonly string[], stock: readonly string[], children: readonly string[]): string {
  return `(label="${label}", readings=${dictText(readings)}, stock=${dictText(stock)}, children=${dictText(children)})`;
}

/** A ledger's measures three levels deep: leaves with readings and stock, one parent holding readings of its own. */
function measures(l: number, draw: () => number): string {
  const values = (n: number) => Array.from({ length: n }, (_, d) => `${day(d * 2)}:${(Math.floor(draw() * 1000) / 10).toFixed(1)}`);
  const leaf = (name: string) => `"${name}":${measure(name, values(10), values(4), [])}`;
  return dictText([
    `"m${l}.1":${measure('plant', [], [], [`"m${l}.1.1":${measure('line', [], [], [leaf(`m${l}.1.1.1`), leaf(`m${l}.1.1.2`)])}`, leaf(`m${l}.1.2`)])}`,
    `"m${l}.2":${measure('kiln', values(5), [], [leaf(`m${l}.2.1`)])}`,
  ]);
}

/**
 * A crew as East prints one: each role's hours a week, the operator's shifts on the days given, each by its day's
 * number — so 2 files before 10, as numbers sort and their texts do not — and its kit.
 */
function crew(c: number, draw: () => number, shiftDays: readonly number[] = [2, 10, 11], kit: readonly string[] = ['radio']): string {
  const hours = (weeks: number) => dictText(Array.from({ length: weeks }, (_, w) => `${day(w * 7)}:${(Math.floor(draw() * 400) / 10).toFixed(1)}`));
  const shifts = dictText(shiftDays.map((n) => `${n}:(at=${day(n, 6)}, who="p-${c}-${n}")`));
  return `(name="Crew ${c}", site="Site ${c % 2}", hours=${dictText([`.assistant:(hours=${hours(3)}, shifts={:})`, `.operator:(hours=${hours(4)}, shifts=${shifts})`])}, ` +
    `kit=${dictText(kit.map((label, k) => `"k-${k}":(label="${label}")`))})`;
}

/** A gauge as East prints one: a level each of `days` days. */
function gauge(g: number, days: number, draw: () => number): string {
  return `(name="Gauge ${g}", site="Site ${g % 2}", level=${dictText(Array.from({ length: days }, (_, d) => `${day(d)}:${(Math.floor(draw() * 100) / 100).toFixed(2)}`))})`;
}

/** The rows the doors first write. */
function seeded() {
  const draw = seededStream(1434);
  return {
    machines: parsedValue(Machines, dictText(Array.from({ length: 12 }, (_, m) => `"M-${m}":${machine(m, draw)}`))),
    halls: parsedValue(Halls, dictText(Array.from({ length: 6 }, (_, h) =>
      `"H-${h}":(name="Hall ${h}", site="Site ${h % 2}", members=${dictText(Array.from({ length: 4 }, (_, m) => `"m-${m}":${member(`member ${m}`, 20, draw)}`))})`))),
    assemblies: parsedValue(Assemblies, dictText(Array.from({ length: 4 }, (_, a) => `"A-${a}":(name="Assembly ${a}", parts=${parts(a, draw)})`))),
    ledgers: parsedValue(Ledgers, dictText(Array.from({ length: 4 }, (_, l) => `"L-${l}":(name="Ledger ${l}", site="Site ${l % 2}", measures=${measures(l, draw)})`))),
    crews: parsedValue(Crews, dictText(Array.from({ length: 4 }, (_, c) => `"C-${c}":${crew(c, draw)}`))),
    gauges: parsedValue(Gauges, dictText(Array.from({ length: 4 }, (_, g) => `"G-${g}":${gauge(g, 20, draw)}`))),
  };
}

type Rows = ReturnType<typeof seeded>;

/** A record's rows, copied to change. */
function copied<V>(rows: ReadonlyMap<string, V>): SortedMap<string, V> {
  return new SortedMap<string, V>([...rows], compareFor(StringType));
}

/**
 * How a write is sent: `patch`, as a client's diff makes it, each row it
 * updates by the row's own patch; or `whole`, each row it updates replaced
 * whole, which the nested index can only compare whole.
 */
type Way = 'patch' | 'whole';

/** The patch from one record state to another, sent the way given. */
function patchOf(type: EastType, before: unknown, next: unknown, way: Way): unknown {
  const patch = diffFor(type)(before as never, next as never) as variant<string, unknown>;
  if (way === 'patch' || patch.type !== 'patch') return patch;
  const held = before as SortedMap<string, unknown>;
  const after = next as SortedMap<string, unknown>;
  const ops = [...(patch.value as SortedMap<string, variant<string, unknown>>)].map(([key, op]): [string, unknown] =>
    [key, op.type === 'update' ? variant('update', variant('replace', { before: held.get(key), after: after.get(key) })) : op]);
  return variant('patch', new SortedMap(ops, compareFor(StringType)));
}

/** The issue's writes, one after another, each from the rows the last left. */
function writes(): Array<{ what: string; record: keyof Rows; next: (rows: Rows) => Rows[keyof Rows] }> {
  const draw = seededStream(1435);
  return [
    {
      what: 'a job moved within its tile, across tiles and across levels; one inserted and one deleted', record: 'machines',
      next: (rows) => {
        const next = copied(rows.machines);
        const jobs = machineJobs(0, seededStream(1)).slice(1, 6);
        jobs[0] = `"j-0-1":${job(day(2, 1), day(5, 1))}`;
        jobs[1] = `"j-0-2":${job(day(10), day(12))}`;
        jobs.push(`"j-0-9":${job(day(20), day(21))}`);
        next.set('M-0', parsedValue(Machine, machine(0, seededStream(7), 'up', jobs)));
        return next;
      },
    },
    {
      what: 'a job moved to another machine, a day\'s load changed, a status changed', record: 'machines',
      next: (rows) => {
        const next = copied(rows.machines);
        next.set('M-1', parsedValue(Machine, machine(1, seededStream(2), 'down', machineJobs(1, seededStream(3)).slice(1))));
        next.set('M-2', parsedValue(Machine, machine(2, seededStream(4), 'up', [...machineJobs(2, seededStream(5)), `"j-1-0":${job(day(1, 6), day(1, 14))}`])));
        return next;
      },
    },
    {
      what: 'a machine replaced and one deleted', record: 'machines',
      next: (rows) => {
        const next = copied(rows.machines);
        next.set('M-3', parsedValue(Machine, machine(3, draw, 'up', [`"j-3-x":${job(day(60), day(61))}`])));
        next.delete('M-4');
        return next;
      },
    },
    {
      what: 'a member\'s load changed, a member added and one removed', record: 'halls',
      next: (rows) => {
        const next = copied(rows.halls);
        next.set('H-0', parsedValue(Hall, `(name="Hall 0", site="Site 0", members=${dictText([
          `"m-0":${member('member 0', 25, draw)}`, `"m-1":${member('member 1', 20, draw)}`, `"m-9":${member('member 9', 10, draw)}`,
        ])})`));
        return next;
      },
    },
    {
      what: 'a part\'s jobs moved, a part added and one removed', record: 'assemblies',
      next: (rows) => {
        const next = copied(rows.assemblies);
        next.set('A-0', parsedValue(Assembly, `(name="Assembly 0", parts=${parts(0, draw)})`));
        next.set('A-1', parsedValue(Assembly, `(name="Assembly 1", parts={"q1":(name="q1", jobs=${dictText([`"j-q":${job(day(9), day(10))}`])}, parts={:})})`));
        return next;
      },
    },
    {
      what: 'a leaf measure\'s reading changed, added and removed', record: 'ledgers',
      next: (rows) => {
        const next = copied(rows.ledgers);
        next.set('L-0', parsedValue(Ledger, `(name="Ledger 0", site="Site 0", measures=${measures(0, draw)})`));
        return next;
      },
    },
    {
      what: 'a role\'s hours changed, a shift moved, one added and one removed, a kit changed, and a crew left with one role and no kit', record: 'crews',
      next: (rows) => {
        const next = copied(rows.crews);
        next.set('C-0', parsedValue(Crew, crew(0, draw, [3, 10, 12], ['radio', 'torch'])));
        next.set('C-1', parsedValue(Crew, `(name="Crew 1", site="Site 1", hours={.operator:(hours={${day(7)}:12.5}, shifts={:})}, kit={:})`));
        return next;
      },
    },
    {
      what: 'a gauge\'s levels changed, a gauge added and one removed', record: 'gauges',
      next: (rows) => {
        const next = copied(rows.gauges);
        next.set('G-0', parsedValue(Gauge, gauge(0, 25, draw)));
        next.set('G-9', parsedValue(Gauge, gauge(9, 5, draw)));
        next.delete('G-1');
        return next;
      },
    },
  ];
}

describe('the nested series index on the real runners', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let realRunner: TaskRunner;

  /** The runtimes to compare — east-node, and east-c and east-py where installed — and why their parity skips with fewer than two. */
  const { runtimes, missing } = stockRunners();

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    realRunner = new LocalTaskRunner(repo);
    for (const { ws, runner } of runtimes) {
      const pkg = e3.package(`nested-${ws}`, '1.0.0', ...declared(runner));
      const zip = join(tempDir, `nested-${ws}.zip`);
      await e3.export(pkg, zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, ws);
      await workspaceDeploy(storage, repo, ws, `nested-${ws}`, '1.0.0', { runner: realRunner });
    }
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** Every record's state in a workspace: its primary, and each index's manifest. */
  async function state(ws: string): Promise<Record<string, string>> {
    const held: Record<string, string> = {};
    for (const { name } of RECORDS) {
      const ref = await storage.datasets.read(repo, ws, `records/${name}`);
      assert.ok(ref && ref.type === 'value', `${ws}: records/${name} holds a value`);
      const record = await readRecordState(storage, repo, ref.value.hash);
      held[`${name} primary`] = record.primary;
      for (const index of INDEXES.filter((i) => i.record === name)) held[index.name] = record.indexes.get(index.name)!.manifest;
    }
    return held;
  }

  /** Writes a record's rows through a workspace's patch door, from `before` to `next`, the patch sent the way given. */
  async function write(ws: string, record: keyof Rows, before: unknown, next: unknown, way: Way): Promise<void> {
    const type = RECORDS.find((r) => r.name === record)!.type;
    const patch = patchOf(type, before, next, way);
    const outcome = await recordMutate(storage, realRunner, repo, ws, record, 'patch', [encodeBeast2For(PatchType(type))(patch as never)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', `${ws}: ${record}: ${outcome.kind === 'failed' ? outcome.stderr : outcome.kind}`);
  }

  /**
   * Writes the seeded rows, then each of the issue's writes, then the reduce,
   * into each runtime's workspace — or, sent whole, into its own beside it —
   * calling `after` with the states after each.
   */
  async function run(after: (what: string, ws: string, held: Record<string, string>) => Promise<void>, way: Way = 'patch'): Promise<void> {
    for (const runtime of runtimes) {
      const ws = way === 'patch' ? runtime.ws : `${runtime.ws}-whole`;
      let rows = seeded();
      for (const { name } of RECORDS) await write(ws, name as keyof Rows, new SortedMap([], compareFor(StringType)), rows[name as keyof Rows], way);
      await after('the seeded rows', runtime.ws, await state(ws));
      for (const step of writes()) {
        const next = step.next(rows);
        await write(ws, step.record, rows[step.record], next, way);
        rows = { ...rows, [step.record]: next };
        await after(step.what, runtime.ws, await state(ws));
      }
      const cleared = await recordMutate(storage, realRunner, repo, ws, 'machines', 'clear', [], { actor: 'cli:test' });
      assert.strictEqual(cleared.kind, 'committed', `${ws}: the reduce: ${cleared.kind === 'failed' ? cleared.stderr : cleared.kind}`);
      await after('a reduce over every machine', runtime.ws, await state(ws));
    }
  }

  it('maintains every nested index, and every index carrying its lean rows, as a reindex rebuilds it, after each write, hash for hash, on each runtime', async () => {
    await run(async (what, ws, maintained) => {
      for (const { name } of RECORDS) {
        const rebuilt = await recordReindex(storage, realRunner, repo, ws, name, { actor: 'cli:test' });
        assert.strictEqual(rebuilt.kind, 'committed', `${ws}: ${name}: ${rebuilt.kind === 'failed' ? rebuilt.stderr : rebuilt.kind}`);
      }
      assert.deepStrictEqual(await state(ws), maintained, `${ws}, after ${what}: maintained ≡ rebuilt`);
    });
  });

  it('maintains every index by each write\'s patch as comparing each row it updates whole does, after each write, hash for hash, on each runtime', async () => {
    for (const { ws } of runtimes) {
      await workspaceCreate(storage, repo, `${ws}-whole`);
      await workspaceDeploy(storage, repo, `${ws}-whole`, `nested-${ws}`, '1.0.0', { runner: realRunner });
    }
    const byPatch = new Map<string, Record<string, string>>();
    await run(async (what, ws, held) => {
      byPatch.set(`${ws} after ${what}`, held);
    });
    await run(async (what, ws, whole) => {
      assert.deepStrictEqual(byPatch.get(`${ws} after ${what}`), whole, `${ws}, after ${what}: by the patch ≡ whole`);
    }, 'whole');
  });

  it('gives every row the same entries on every runtime, after each write, hash for hash', { skip: missing }, async () => {
    const seen = new Map<string, Map<string, Record<string, string>>>();
    await run(async (what, ws, held) => {
      const each = seen.get(what) ?? new Map<string, Record<string, string>>();
      each.set(ws, held);
      seen.set(what, each);
    });
    for (const [what, each] of seen) {
      const [first, ...rest] = [...each];
      for (const [ws, held] of rest) assert.deepStrictEqual(held, first![1], `${ws} disagrees with ${first![0]} after ${what}`);
    }
  });
});

// ── A window of the rail's rows ──────────────────────────────────────────────

/** A store keeping every object a read reads — its hash, and the bytes read of it. */
function readsKept(inner: StorageBackend): StorageBackend & { kept: Map<string, number> } {
  const kept = new Map<string, number>();
  const note = (hash: string, bytes: number) => kept.set(hash, (kept.get(hash) ?? 0) + bytes);
  // A Proxy, not a spread: the store is a class instance and its methods live
  // on the prototype, where a spread does not reach them.
  const objects = new Proxy(inner.objects, {
    get(target, property, receiver) {
      if (property === 'read') {
        return async (repo: string, hash: string) => {
          const bytes = await target.read(repo, hash);
          note(hash, bytes.byteLength);
          return bytes;
        };
      }
      if (property === 'readRange') {
        return async (repo: string, hash: string, offset: number, length: number) => {
          const bytes = await target.readRange(repo, hash, offset, length);
          note(hash, bytes.byteLength);
          return bytes;
        };
      }
      if (property === 'materialize') {
        return async (repo: string, hash: string, dest: string, options?: { link?: boolean }) => {
          note(hash, (await target.stat(repo, hash)).size);
          return target.materialize(repo, hash, dest, options);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return new Proxy(inner, {
    get(target, property, receiver) {
      if (property === 'objects') return objects;
      if (property === 'kept') return kept;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as StorageBackend & { kept: typeof kept };
}

describe('a window of the rail\'s rows beside the nested series index', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let runner: TaskRunner;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    runner = new LocalTaskRunner(repo);
    const pkg = e3.package('nested-rail', '1.0.0', ...declared());
    const zip = join(tempDir, 'nested-rail.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'rail');
    await workspaceDeploy(storage, repo, 'rail', 'nested-rail', '1.0.0', { runner });
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it('reads 200 machines through machines_by_site_status without a join, each without its collections, and no object of the record\'s own', async () => {
    const draw = seededStream(200);
    const names = Array.from({ length: 300 }, (_, m) => `M-${String(m).padStart(3, '0')}`);
    const machines = parsedValue(Machines, dictText(names.map((name, m) => `"${name}":${machine(m, draw)}`)));
    const patch = diffFor(Machines)(new SortedMap([], compareFor(StringType)) as never, machines as never);
    const outcome = await recordMutate(storage, runner, repo, 'rail', 'machines', 'patch', [encodeBeast2For(PatchType(Machines))(patch)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', `machines: ${outcome.kind === 'failed' ? outcome.stderr : outcome.kind}`);

    // The record's own objects: its state, its primary's manifest, header and segments.
    const ref = await storage.datasets.read(repo, 'rail', 'records/machines');
    assert.ok(ref && ref.type === 'value', 'records/machines holds a value');
    const record = await readRecordState(storage, repo, ref.value.hash);
    const primary = await readManifest(storage, repo, record.primary);
    assert.ok(primary !== null, 'the primary is a manifest');
    const own = new Set([ref.value.hash, record.primary, primary.header, ...primary.entries.map((entry) => entry.hash)]);
    let ownBytes = 0;
    for (const entry of primary.entries) ownBytes += (await storage.objects.stat(repo, entry.hash)).size;
    const index = await resolveRecordIndex(storage, repo, 'rail', 'records/machines', ref.value.hash, 'machines_by_site_status');
    assert.ok(index !== null, 'the record names machines_by_site_status');

    // A window of 200, read as a page reads one without a join: the index's segments holding its first 200 entries.
    const counted = readsKept(storage);
    const window = await DatasetSegments.open(counted, repo, index.manifest);
    const segments = window.cumulative.findIndex((ends) => ends >= 200) + 1;
    assert.ok(segments > 0, `the index holds 200 entries: ${window.elementCount}`);
    const entries = decodeBeast2For(fromEastTypeValue(index.collectionType))(await window.span(0, segments)) as SortedMap<unknown, unknown>;
    const page = [...entries].slice(0, 200);
    assert.strictEqual(page.length, 200, 'a window of 200');

    // Each machine as the record holds it, its collections empty.
    const lean = new SortedMap<string, unknown>(names.map((name, m) => [name, parsedValue(Machine,
      `(name="Press ${m}", site="Site ${m % 3}", status="up", jobs={:}, stops={:}, alarms={:}, load={:}, output={:})`)]), compareFor(StringType));
    for (const [key, value] of page) {
      const row = (key as { k: string }).k;
      assert.ok(equalFor(Machine)(value as never, lean.get(row) as never), `${printFor(StringType)(row)} is carried without its collections`);
    }
    assert.deepStrictEqual([...counted.kept.keys()].filter((hash) => own.has(hash)), [], 'no object of the record\'s own is read');
    let read = 0;
    for (const bytes of counted.kept.values()) read += bytes;
    assert.ok(read * 10 < ownBytes, `the window reads ${read} bytes; the record's own segments hold ${ownBytes}`);
  });
});

describe('the nested series index\'s span beside it (#1438)', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let runner: TaskRunner;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    runner = new LocalTaskRunner(repo);
    const pkg = e3.package('nested-span', '1.0.0', ...declared());
    const zip = join(tempDir, 'nested-span.zip');
    await e3.export(pkg, zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'span');
    await workspaceDeploy(storage, repo, 'span', 'nested-span', '1.0.0', { runner });
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** A machine holding the jobs given — each `id: [start, end]`, as East prints an instant — and its load at the instants given. */
  const machineWith = (jobs: Readonly<Record<string, readonly [string, string]>>, load: readonly string[] = []) => parsedValue(Machine,
    `(name="Press", site="North", status="up", jobs=${dictText(Object.entries(jobs).map(([id, [start, end]]) =>
      `"${id}":(product="cap", start=.some ${start}, end=.some ${end}, state="planned", sheets=1.0)`))}, stops={:}, alarms={:}, ` +
    `load=${dictText(load.map((at) => `${at}:0.5`))}, output={:})`);

  /** Writes the machines through the patch door, from `before` to `next`. */
  async function write(before: ValueTypeOf<typeof Machines>, next: ValueTypeOf<typeof Machines>): Promise<void> {
    const patch = diffFor(Machines)(before as never, next as never);
    const outcome = await recordMutate(storage, runner, repo, 'span', 'machines', 'patch', [encodeBeast2For(PatchType(Machines))(patch)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', `machines: ${outcome.kind === 'failed' ? outcome.stderr : outcome.kind}`);
  }

  /** The machines' span as the record holds it: each collection's first and last month, by its place as East prints it. */
  async function spanOf(): Promise<Record<string, [string, string]>> {
    const ref = await storage.datasets.read(repo, 'span', 'records/machines');
    assert.ok(ref && ref.type === 'value', 'records/machines holds a value');
    const index = await resolveRecordIndex(storage, repo, 'span', 'records/machines', ref.value.hash, 'machines_in_time_span');
    assert.ok(index !== null, 'the record names its nested series index\'s span');
    const segments = await DatasetSegments.open(storage, repo, index.manifest);
    const out: Record<string, [string, string]> = {};
    if (segments.elementCount === 0) return out;
    const entries = decodeBeast2For(fromEastTypeValue(index.collectionType))(await segments.span(0, segments.cumulative.length)) as SortedMap<unknown, unknown>;
    const SpanKey = StructType({ collection: RecordNestedPathType, tile: DateTimeType });
    const place = printFor(SpanKey.fields.collection);
    const month = printFor(DateTimeType);
    for (const key of entries.keys()) {
      const { collection, tile } = (key as { ik: ValueTypeOf<typeof SpanKey> }).ik;
      const at = place(collection);
      out[at] = [out[at]?.[0] ?? month(tile), month(tile)];
    }
    return out;
  }

  it('holds each collection\'s first and last month across the rows, and keeps them as writes move, add and take items', async () => {
    const empty = new SortedMap([], compareFor(StringType)) as ValueTypeOf<typeof Machines>;
    const jobs = '.step (key="jobs", rest=.end)';
    const load = '.step (key="load", rest=.end)';
    const seeded = parsedValue(Machines, `{"M-1":${printFor(Machine)(machineWith({ 'j-1': ['2026-01-10T00:00:00.000', '2026-01-12T00:00:00.000'] }, ['2026-03-02T00:00:00.000']))}, ` +
      `"M-2":${printFor(Machine)(machineWith({ 'j-2': ['2026-06-05T00:00:00.000', '2026-06-07T00:00:00.000'] }))}}`);
    await write(empty, seeded);
    assert.deepStrictEqual(await spanOf(), {
      [jobs]: ['2026-01-01T00:00:00.000', '2026-06-01T00:00:00.000'],
      [load]: ['2026-03-01T00:00:00.000', '2026-03-01T00:00:00.000'],
    }, 'the seeded rows\' months');
    // M-2's job moved to December: the jobs reach December, and June goes.
    const moved = parsedValue(Machines, `{"M-1":${printFor(Machine)(machineWith({ 'j-1': ['2026-01-10T00:00:00.000', '2026-01-12T00:00:00.000'] }, ['2026-03-02T00:00:00.000']))}, ` +
      `"M-2":${printFor(Machine)(machineWith({ 'j-2': ['2026-12-07T00:00:00.000', '2026-12-09T00:00:00.000'] }))}}`);
    await write(seeded, moved);
    assert.deepStrictEqual((await spanOf())[jobs], ['2026-01-01T00:00:00.000', '2026-12-01T00:00:00.000'], 'a job moved to December');
    // M-1's job and load taken: the jobs start in December, and the load holds no month.
    const taken = parsedValue(Machines, `{"M-1":${printFor(Machine)(machineWith({}))}, "M-2":${printFor(Machine)(machineWith({ 'j-2': ['2026-12-07T00:00:00.000', '2026-12-09T00:00:00.000'] }))}}`);
    await write(moved, taken);
    assert.deepStrictEqual(await spanOf(), { [jobs]: ['2026-12-01T00:00:00.000', '2026-12-01T00:00:00.000'] }, 'January\'s job and March\'s load taken');
  });
});
