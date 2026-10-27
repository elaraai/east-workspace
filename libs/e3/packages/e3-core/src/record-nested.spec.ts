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
 * reindex rebuilds. This deploys the same four records to a workspace per
 * runtime — machines (things people drag, and values), halls (members' loads,
 * rolled up by their mean), assemblies (parts five deep, their jobs rolled up
 * under every ancestor) and ledgers (measure trees three levels deep, their
 * readings rolled up by sum, mean and count, their stock by its last,
 * summed) — each with its patch door, its nested index and an index of its
 * rows. It writes the same rows through the doors, then the issue's writes one
 * after another, and a reduce over all last, and compares the states hash for
 * hash after each: across the runtimes, and against a rebuild in each.
 *
 * The rows are a few dozen of each, every shape the issue names — a year long,
 * before 1970, with no end, with no start, an instant — rather than its
 * thousand machines, so the suite stays quick on three runtimes.
 *
 * The parity compares every runtime installed and skips with fewer than two;
 * the rest runs on each runtime installed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { accessSync, constants } from 'node:fs';
import assert from 'node:assert';
import { delimiter, join, dirname } from 'node:path';
import {
  DateTimeType, DictType, East, FloatType, IntegerType, OptionType, PatchType, RecursiveType, SortedMap, StringType, StructType,
  compareFor, diffFor, encodeBeast2For, parseFor, printType, type EastType, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import { recordMutate, recordReindex, readRecordState } from './records.js';
import { packageImport } from './package-files.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { LocalStorage } from './storage/local/index.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import type { StorageBackend, TaskRunner } from './index.js';

/** Whether a runtime's CLI is on PATH: an executable of its name in one of PATH's directories. */
function onPath(command: string): boolean {
  const names = process.platform === 'win32' ? [`${command}.cmd`, `${command}.exe`] : [command];
  return (process.env.PATH ?? '').split(delimiter).filter((dir) => dir !== '').some((dir) => names.some((name) => {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }));
}

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

/** A runner selection, as the SDK's constructors take one. */
type RunnerConfig = Parameters<typeof e3.mutation.reduce>[3];

/** The four records, each with its patch door, its nested index and an index of its rows, on a runner; and a reduce over the machines. */
function declared(runner?: RunnerConfig) {
  const series = e3.recordIndex.series;
  const machines = e3.record('machines', Machines, new Map());
  const halls = e3.record('halls', Halls, new Map());
  const assemblies = e3.record('assemblies', Assemblies, new Map());
  const ledgers = e3.record('ledgers', Ledgers, new Map());
  const jobs = series.items({ from: 'start', to: 'end' });
  return {
    records: [machines, halls, assemblies, ledgers] as const,
    doors: [
      e3.mutation.patch(machines, 'patch', runner),
      e3.mutation.patch(halls, 'patch', runner),
      e3.mutation.patch(assemblies, 'patch', runner),
      e3.mutation.patch(ledgers, 'patch', runner),
    ] as const,
    // Every machine's load and output cleared, and its stops: a write the program compares row by row.
    clear: e3.mutation.reduce('clear', machines, East.function([Machines], Machines, (_$, state) => state.map(($, m) => ({
      name: m.name, site: m.site, status: m.status, jobs: m.jobs,
      stops: $.let(new Map(), DictType(StringType, Stop)),
      alarms: m.alarms,
      load: $.let(new Map(), DictType(DateTimeType, FloatType)),
      output: $.let(new Map(), DictType(DateTimeType, IntegerType)),
    }))), runner),
    indexes: [
      series('machines_in_time', machines, {
        collections: {
          jobs, stops: series.items({ from: 'start', to: 'end' }), alarms: series.items({ at: 'at' }), load: series.values(), output: series.values(),
        },
        tile: 'week',
        summary: 'month',
      }, runner),
      e3.recordIndex('machines_by_site_status', machines, { on: ['site', 'status'] }, runner),
      series('halls_in_time', halls, {
        collections: { members: series.rows({ load: series.values({ rollup: 'mean' }) }) }, tile: 'day', summary: 'month',
      }, runner),
      e3.recordIndex('halls_by_site', halls, { on: ['site'] }, runner),
      series('assemblies_in_time', assemblies, {
        collections: { parts: series.rows({ jobs: series.items({ from: 'start', to: 'end' }, { rollup: true }), parts: series.recursive() }) },
        tile: 'week',
        summary: 'month',
      }, runner),
      e3.recordIndex('assemblies_by_name', assemblies, { on: ['name'] }, runner),
      series('ledgers_in_time', ledgers, {
        collections: {
          measures: series.rows({
            readings: series.values({ rollup: ['sum', 'mean', 'count'] }),
            stock: series.values({ rollup: { fold: 'last', aggregate: 'sum' } }),
            children: series.recursive(),
          }),
        },
        tile: 'day',
      }, runner),
      e3.recordIndex('ledgers_by_site', ledgers, { on: ['site'] }, runner),
    ] as const,
  };
}

/** Each record's name and state type. */
const RECORDS: ReadonlyArray<{ name: string; type: EastType }> = [
  { name: 'machines', type: Machines }, { name: 'halls', type: Halls }, { name: 'assemblies', type: Assemblies }, { name: 'ledgers', type: Ledgers },
];

/** Each index's record and name. */
const INDEXES = declared().indexes.map((index) => ({ record: index.record.name, name: index.name }));

// ── The rows, written as East prints them ────────────────────────────────────

/** A value written as East prints one, read by East's parser. */
function parsed<T extends EastType>(type: T, text: string): ValueTypeOf<T> {
  const read = parseFor(type)(text);
  if (!read.success) throw new Error(`not a ${printType(type)}: ${read.error}`);
  return read.value;
}

/** A Dict as East prints one, from its entries. */
function dict(entries: readonly string[]): string {
  return entries.length === 0 ? '{:}' : `{${entries.join(', ')}}`;
}

/** A seeded stream of numbers in [0, 1) (mulberry32): the same rows on every run. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  return `(name="Press ${m}", site="Site ${m % 3}", status="${status}", jobs=${dict(jobs)}, ` +
    `stops=${dict([`"s-${m}":(reason="clean", start=${day(4)}, end=${day(4, 2)})`])}, ` +
    `alarms=${dict([`"a-${m}-0":(code="E1", severity="high", at=${day(3, 5)})`, `"a-${m}-1":(code="E2", severity="low", at=${day(11, 1)})`])}, ` +
    `load=${dict(load)}, output=${dict(output)})`;
}

/** A hall's member as East prints one: a value each of `days` days. */
function member(name: string, days: number, draw: () => number): string {
  return `(name="${name}", load=${dict(Array.from({ length: days }, (_, d) => `${day(d)}:${(Math.floor(draw() * 100) / 100).toFixed(2)}`))})`;
}

/** An assembly's parts five deep as East prints them, a job at each depth. */
function parts(a: number, draw: () => number): string {
  let inner = '{:}';
  for (let depth = 5; depth >= 1; depth--) {
    const offset = Math.floor(draw() * 30);
    inner = `{"p${depth}":(name="part ${a}.${depth}", jobs=${dict([`"j-${a}-${depth}":${job(day(offset, 6), day(offset + depth, 6))}`])}, parts=${inner})}`;
  }
  return inner;
}

/** A measure as East prints one. */
function measure(label: string, readings: readonly string[], stock: readonly string[], children: readonly string[]): string {
  return `(label="${label}", readings=${dict(readings)}, stock=${dict(stock)}, children=${dict(children)})`;
}

/** A ledger's measures three levels deep: leaves with readings and stock, one parent holding readings of its own. */
function measures(l: number, draw: () => number): string {
  const values = (n: number) => Array.from({ length: n }, (_, d) => `${day(d * 2)}:${(Math.floor(draw() * 1000) / 10).toFixed(1)}`);
  const leaf = (name: string) => `"${name}":${measure(name, values(10), values(4), [])}`;
  return dict([
    `"m${l}.1":${measure('plant', [], [], [`"m${l}.1.1":${measure('line', [], [], [leaf(`m${l}.1.1.1`), leaf(`m${l}.1.1.2`)])}`, leaf(`m${l}.1.2`)])}`,
    `"m${l}.2":${measure('kiln', values(5), [], [leaf(`m${l}.2.1`)])}`,
  ]);
}

/** The rows the doors first write. */
function seeded() {
  const draw = stream(1434);
  return {
    machines: parsed(Machines, dict(Array.from({ length: 12 }, (_, m) => `"M-${m}":${machine(m, draw)}`))),
    halls: parsed(Halls, dict(Array.from({ length: 6 }, (_, h) =>
      `"H-${h}":(name="Hall ${h}", site="Site ${h % 2}", members=${dict(Array.from({ length: 4 }, (_, m) => `"m-${m}":${member(`member ${m}`, 20, draw)}`))})`))),
    assemblies: parsed(Assemblies, dict(Array.from({ length: 4 }, (_, a) => `"A-${a}":(name="Assembly ${a}", parts=${parts(a, draw)})`))),
    ledgers: parsed(Ledgers, dict(Array.from({ length: 4 }, (_, l) => `"L-${l}":(name="Ledger ${l}", site="Site ${l % 2}", measures=${measures(l, draw)})`))),
  };
}

type Rows = ReturnType<typeof seeded>;

/** A record's rows, copied to change. */
function copied<V>(rows: ReadonlyMap<string, V>): SortedMap<string, V> {
  return new SortedMap<string, V>([...rows], compareFor(StringType));
}

/** The issue's writes, one after another, each from the rows the last left. */
function writes(): Array<{ what: string; record: keyof Rows; next: (rows: Rows) => Rows[keyof Rows] }> {
  const draw = stream(1435);
  return [
    {
      what: 'a job moved within its tile, across tiles and across levels; one inserted and one deleted', record: 'machines',
      next: (rows) => {
        const next = copied(rows.machines);
        const jobs = machineJobs(0, stream(1)).slice(1, 6);
        jobs[0] = `"j-0-1":${job(day(2, 1), day(5, 1))}`;
        jobs[1] = `"j-0-2":${job(day(10), day(12))}`;
        jobs.push(`"j-0-9":${job(day(20), day(21))}`);
        next.set('M-0', parsed(Machine, machine(0, stream(7), 'up', jobs)));
        return next;
      },
    },
    {
      what: 'a job moved to another machine, a day\'s load changed, a status changed', record: 'machines',
      next: (rows) => {
        const next = copied(rows.machines);
        next.set('M-1', parsed(Machine, machine(1, stream(2), 'down', machineJobs(1, stream(3)).slice(1))));
        next.set('M-2', parsed(Machine, machine(2, stream(4), 'up', [...machineJobs(2, stream(5)), `"j-1-0":${job(day(1, 6), day(1, 14))}`])));
        return next;
      },
    },
    {
      what: 'a machine replaced and one deleted', record: 'machines',
      next: (rows) => {
        const next = copied(rows.machines);
        next.set('M-3', parsed(Machine, machine(3, draw, 'up', [`"j-3-x":${job(day(60), day(61))}`])));
        next.delete('M-4');
        return next;
      },
    },
    {
      what: 'a member\'s load changed, a member added and one removed', record: 'halls',
      next: (rows) => {
        const next = copied(rows.halls);
        next.set('H-0', parsed(Hall, `(name="Hall 0", site="Site 0", members=${dict([
          `"m-0":${member('member 0', 25, draw)}`, `"m-1":${member('member 1', 20, draw)}`, `"m-9":${member('member 9', 10, draw)}`,
        ])})`));
        return next;
      },
    },
    {
      what: 'a part\'s jobs moved, a part added and one removed', record: 'assemblies',
      next: (rows) => {
        const next = copied(rows.assemblies);
        next.set('A-0', parsed(Assembly, `(name="Assembly 0", parts=${parts(0, draw)})`));
        next.set('A-1', parsed(Assembly, `(name="Assembly 1", parts={"q1":(name="q1", jobs=${dict([`"j-q":${job(day(9), day(10))}`])}, parts={:})})`));
        return next;
      },
    },
    {
      what: 'a leaf measure\'s reading changed, added and removed', record: 'ledgers',
      next: (rows) => {
        const next = copied(rows.ledgers);
        next.set('L-0', parsed(Ledger, `(name="Ledger 0", site="Site 0", measures=${measures(0, draw)})`));
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

  /** The runtimes to compare, minus any that is not installed. */
  const runtimes: Array<{ ws: string; runner: RunnerConfig }> = [
    { ws: 'node', runner: { runner: { runtime: 'east-node', platforms: ['@elaraai/east-node-std'] } } },
    ...(onPath('east-c') ? [{ ws: 'c', runner: { runner: { runtime: 'east-c' as const, platforms: [] } } }] : []),
    ...(onPath('east-py') ? [{ ws: 'py', runner: { runner: { runtime: 'east-py' as const, platforms: [] } } }] : []),
  ];
  const missing = runtimes.length < 2
    ? `needs east-c or east-py on PATH beside east-node; have ${runtimes.map((r) => r.ws).join(', ')}`
    : false;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    realRunner = new LocalTaskRunner(repo);
    for (const { ws, runner } of runtimes) {
      const { records, doors, clear, indexes } = declared(runner);
      const pkg = e3.package(`nested-${ws}`, '1.0.0', ...records, ...doors, clear, ...indexes);
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

  /** Writes a record's rows through a workspace's patch door, from `before` to `next`. */
  async function write(ws: string, record: keyof Rows, before: unknown, next: unknown): Promise<void> {
    const type = RECORDS.find((r) => r.name === record)!.type;
    const patch = diffFor(type)(before as never, next as never);
    const outcome = await recordMutate(storage, realRunner, repo, ws, record, 'patch', [encodeBeast2For(PatchType(type))(patch)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', `${ws}: ${record}: ${outcome.kind === 'failed' ? outcome.stderr : outcome.kind}`);
  }

  /** Writes the seeded rows, then each of the issue's writes, then the reduce, calling `after` with the states after each. */
  async function run(after: (what: string, ws: string, held: Record<string, string>) => Promise<void>): Promise<void> {
    for (const { ws } of runtimes) {
      let rows = seeded();
      for (const { name } of RECORDS) await write(ws, name as keyof Rows, new SortedMap([], compareFor(StringType)), rows[name as keyof Rows]);
      await after('the seeded rows', ws, await state(ws));
      for (const step of writes()) {
        const next = step.next(rows);
        await write(ws, step.record, rows[step.record], next);
        rows = { ...rows, [step.record]: next };
        await after(step.what, ws, await state(ws));
      }
      const cleared = await recordMutate(storage, realRunner, repo, ws, 'machines', 'clear', [], { actor: 'cli:test' });
      assert.strictEqual(cleared.kind, 'committed', `${ws}: the reduce: ${cleared.kind === 'failed' ? cleared.stderr : cleared.kind}`);
      await after('a reduce over every machine', ws, await state(ws));
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
