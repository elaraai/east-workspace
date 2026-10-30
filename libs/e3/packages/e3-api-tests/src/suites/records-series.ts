/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A record read in two dimensions (#1039): a block of presses over a span of
 * weeks, read through a series index (`index.series`) as a range a
 * press a level in one request (`findKeys`) and the runs they select, from the
 * index alone — each entry carries its job's row whole — and, zoomed out, the
 * totals a summary index (`index.summary`) keeps under each press and
 * week: how many jobs touch it, and the milliseconds of it they cover.
 *
 * The series files each job once (#1433): at the level its length fits, from
 * the week up, under that level's tile holding its start — or, past a year,
 * under each year it touches. The suite works out each job's filings and
 * weeks itself, a week from its Monday, in UTC, half-open, so what a server
 * answers is held to a brute force: under each level's run of tiles, the
 * block's jobs filed there and no other, each once with its row, at one
 * content hash, every job overlapping the weeks among them; and each total,
 * the jobs that touch its week on its press and the time of it they cover.
 * Then a job moved to another week, read and totalled where it went; jobs a
 * hundred days and three years long, each read once; and a joined read, a
 * placement and a membership read of the summary refused.
 *
 * And records whose rows nest what a series files (#1434), read through their
 * one nested series index: a block of machines' jobs over three weeks as a
 * range a machine a level, each job filed once and carried whole; each
 * machine's month totals of its jobs and its load; a hall's mean of its
 * members' loads a week at a time, as one range; a part's subtree's jobs,
 * filed under it too, as one range a level; and a job moved, read back where
 * it went — each held to a brute force over the rows written. The machines'
 * other index carries each machine without its collections.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ArrayType, DateTimeType, FloatType, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType, VariantType, compareFor,
  decodeBeast2For, diffFor, encodeBeast2For, equalFor, isTypeEqual, isTypeValueEqual, none, parseFor, printFor, printType, some,
  toEastTypeValue, variant,
  type ValueTypeOf,
} from '@elaraai/east';
import {
  NestedEntryKeyType, NestedEntryType, RecordLevelType, RecordNestedItemType, RecordNestedPathType, RecordNestedRunType, RecordSummaryTotalsType,
  indexWindowType,
} from '@elaraai/e3-types';
import {
  ApiError,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  workspaceRecordDescribe,
  workspaceRecordMutate,
  datasetFindKeys,
  datasetGet,
  datasetGetPage,
  datasetGetRuns,
  datasetGetStatus,
  datasetPlace,
  datasetWithin,
  type DatasetKeySearch,
} from '@elaraai/e3-api-client';

import { assertMutationCommitted } from '../assertions.js';
import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import {
  AssembliesType, AssemblyType, HallType, HallsType, MachineType, MachinesType, MemberType, NestedJobType,
  createNestedSeriesPackageZip, createSeriesRecordPackageZip, JOBS_FROM, JobPressLevelTileKeyType, JobPressWeekKeyType, JobRowType, JobsType,
} from '../fixtures.js';

const PKG = 'series-record-pkg';
const VERSION = '1.0.0';
const WS = 'series-record-ws';
const jobsPath = [variant('field', 'records'), variant('field', 'jobs')];

/** How many jobs the record holds: more than a segment's 4,096 entries at
 *  most, so the series spans segments, and its searches and runs cross them. */
const JOBS = 6_000n;
/** The series index, and the summary beside it. */
const SERIES = 'jobs_by_press_week';
const TOTALS = 'jobs_by_press_week_totals';

type Job = ValueTypeOf<typeof JobRowType>;
type Jobs = ValueTypeOf<typeof JobsType>;
type PressWeek = ValueTypeOf<typeof JobPressWeekKeyType>;
type Totals = ValueTypeOf<typeof RecordSummaryTotalsType>;

/** A series window's entries: the job's key under a press, a level and a tile, its row carried whole. The first test holds it to `indexWindowType`. */
const SeriesWindowType = ArrayType(StructType({ ik: JobPressLevelTileKeyType, key: StringType, value: JobRowType, row: OptionType(JobRowType) }));
/** A summary window's entries: each press and week, standing for every job of it — its `key` Null — with its totals. */
const TotalsWindowType = ArrayType(StructType({ ik: JobPressWeekKeyType, key: NullType, value: RecordSummaryTotalsType, row: OptionType(JobRowType) }));
type SeriesEntry = ValueTypeOf<typeof SeriesWindowType>[number];
type TotalsEntry = ValueTypeOf<typeof TotalsWindowType>[number];

const encodeInt = encodeBeast2For(IntegerType);
const encodePatch = encodeBeast2For(PatchType(JobsType));
const decodeJobs = decodeBeast2For(JobsType);
const decodeSeriesWindow = decodeBeast2For(SeriesWindowType);
const decodeTotalsWindow = decodeBeast2For(TotalsWindowType);
const printDateTime = printFor(DateTimeType);
const printString = printFor(StringType);
/** A summary entry's key, `(ik=…, k=null)`, as a membership read names one. */
const printTotalsEntryKey = printFor(StructType({ ik: JobPressWeekKeyType, k: NullType }));
const printLevel = printFor(RecordLevelType);
/** A key's `on`, printed whole, as an exact search names it (#1432). */
const printOn = printFor(JobPressLevelTileKeyType.fields.on);
const jobEqual = equalFor(JobRowType);
const unjoined = equalFor(OptionType(JobRowType));
const integerEqual = equalFor(IntegerType);
const stringEqual = equalFor(StringType);
const stringOrder = compareFor(StringType);
const pressWeekOrder = compareFor(JobPressWeekKeyType);

/** A day, and a week, in milliseconds. */
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** The week holding an instant, by its start: whole weeks from {@link JOBS_FROM}, a Monday. */
function weekHolding(ms: number): number {
  return JOBS_FROM.getTime() + Math.floor((ms - JOBS_FROM.getTime()) / WEEK_MS) * WEEK_MS;
}

/** The levels the series files at, from its week tile up, and each one's shortest tile (#1433). */
const LEVELS = ['week', 'month', 'quarter', 'year'] as const;
type Level = (typeof LEVELS)[number];
const SHORTEST_MS: Readonly<Record<Level, number>> = { week: 7 * DAY_MS, month: 28 * DAY_MS, quarter: 90 * DAY_MS, year: 365 * DAY_MS };
const MONTHS: Readonly<Record<Exclude<Level, 'week'>, number>> = { month: 1, quarter: 3, year: 12 };

/** The start of the level's tile holding an instant: a week from its Monday, a month, a quarter or a year by the UTC calendar. */
function tileStart(level: Level, ms: number): number {
  if (level === 'week') return weekHolding(ms);
  const held = new Date(ms);
  const month = held.getUTCMonth();
  return Date.UTC(held.getUTCFullYear(), month - (month % MONTHS[level]), 1);
}

/** The start of the level's tile `by` tiles on from the one starting at `start` — back, for a negative `by`. */
function tileStep(level: Level, start: number, by: number): number {
  if (level === 'week') return start + by * WEEK_MS;
  const held = new Date(start);
  return Date.UTC(held.getUTCFullYear(), held.getUTCMonth() + by * MONTHS[level], 1);
}

/** Where the series files a job: once, at the first level whose shortest tile holds its length; past a year, under each year it touches. */
function filingsOf(job: { readonly start: Date; readonly end: Date }): Array<{ level: Level; tile: number }> {
  const start = job.start.getTime();
  const end = job.end.getTime();
  for (const level of LEVELS) {
    if (end - start <= SHORTEST_MS[level]) return [{ level, tile: tileStart(level, start) }];
  }
  const years: Array<{ level: Level; tile: number }> = [];
  for (let year = tileStart('year', start); year < end; year = tileStep('year', year, 1)) years.push({ level: 'year', tile: year });
  return years;
}

/** What a reader reads of the series over `[from, to)`: a run a level, from two tiles before the one holding `from` to the one after the tile holding its last instant. */
function levelRuns(from: number, to: number): Array<{ level: Level; from: number; to: number }> {
  return LEVELS.map((level) => ({ level, from: tileStep(level, tileStart(level, from), -2), to: tileStep(level, tileStart(level, to - 1), 2) }));
}

/** A run's search over one press: from its first tile to the start of the one after its last, under the press and the level. */
function runSearch(press: string, run: { level: Level; from: number; to: number }): DatasetKeySearch {
  const level = printLevel(variant(run.level, null));
  return { from: [printString(press), level, printDateTime(new Date(run.from))], to: [printString(press), level, printDateTime(new Date(run.to))] };
}

/** The weeks a job touches, half-open, by each one's start, with the milliseconds of each it covers. */
function weeksOf(job: Job): Array<{ week: Date; ms: bigint }> {
  const start = job.start.getTime();
  const end = job.end.getTime();
  if (end <= start) return [{ week: new Date(weekHolding(start)), ms: 0n }];
  const weeks: Array<{ week: Date; ms: bigint }> = [];
  for (let week = weekHolding(start); week < end; week += WEEK_MS) {
    weeks.push({ week: new Date(week), ms: BigInt(Math.min(week + WEEK_MS, end) - Math.max(week, start)) });
  }
  return weeks;
}

/** The totals a summary of `jobs` holds, worked out from them: under each press and week, the jobs touching it and the time of it they cover. */
function totalsOf(jobs: Jobs): SortedMap<PressWeek, Totals> {
  const totals = new SortedMap<PressWeek, Totals>(undefined, pressWeekOrder);
  for (const job of jobs.values()) {
    for (const { week, ms } of weeksOf(job)) {
      const key = { on: {}, key: job.press, tile: week };
      const held = totals.get(key) ?? { count: 0n, ms: 0n };
      totals.set(key, { count: held.count + 1n, ms: held.ms + ms });
    }
  }
  return totals;
}

/** Whether a press is in the block `[from, to)`. */
function inBlock(press: string, from: string, to: string): boolean {
  return stringOrder(press, from) >= 0 && stringOrder(press, to) < 0;
}

// ── Records nesting what they file (#1434) ───────────────────────────────────

const NESTED_PKG = 'nested-record-pkg';
const NESTED_WS = 'nested-record-ws';

/** A record's dataset path. */
function recordAt(name: string): typeof jobsPath {
  return [variant('field', 'records'), variant('field', name)];
}

type Machines = ValueTypeOf<typeof MachinesType>;
type Machine = ValueTypeOf<typeof MachineType>;
type NestedJob = ValueTypeOf<typeof NestedJobType>;
type Halls = ValueTypeOf<typeof HallsType>;
type Hall = ValueTypeOf<typeof HallType>;
type Member = ValueTypeOf<typeof MemberType>;
type Assemblies = ValueTypeOf<typeof AssembliesType>;

/** An hour, in milliseconds. */
const HOUR_MS = 3_600_000;
/** The machines' job lengths, in hours, a job each in turn: filed at the week, the week, the week, the month and the quarter. */
const JOB_HOURS = [4, 30, 80, 200, 1_000] as const;

/** A nested index's entry key, at the records' String keys. */
const NestedKeyType = NestedEntryKeyType(StringType);
/** What each nested index files, by place, nesting as its declaration nests. */
const MachinePlacesType = VariantType({ jobs: NestedJobType, load: FloatType });
const HallPlacesType = VariantType({ members: VariantType({ load: FloatType }) });
const AssemblyPlacesType = VariantType({ parts: VariantType({ jobs: NestedJobType }) });
/** Each nested index's window: an entry's key, its row's key, what it carries, and no row — a nested index is read alone. */
const MachinesWindowType = ArrayType(StructType({ ik: NestedKeyType, key: StringType, value: NestedEntryType(MachinePlacesType), row: OptionType(MachineType) }));
const HallsWindowType = ArrayType(StructType({ ik: NestedKeyType, key: StringType, value: NestedEntryType(HallPlacesType), row: OptionType(HallType) }));
const AssembliesWindowType = ArrayType(StructType({
  ik: NestedKeyType, key: StringType, value: NestedEntryType(AssemblyPlacesType), row: OptionType(AssemblyType),
}));
type AssembliesEntry = ValueTypeOf<typeof AssembliesWindowType>[number];

const decodeMachinesWindow = decodeBeast2For(MachinesWindowType);
const decodeHallsWindow = decodeBeast2For(HallsWindowType);
const decodeAssembliesWindow = decodeBeast2For(AssembliesWindowType);
const encodeMachinesPatch = encodeBeast2For(PatchType(MachinesType));
const encodeHallsPatch = encodeBeast2For(PatchType(HallsType));
const encodeAssembliesPatch = encodeBeast2For(PatchType(AssembliesType));
const printPath = printFor(RecordNestedPathType);
const printRun = printFor(RecordNestedRunType);
const printItem = printFor(RecordNestedItemType);
const machineEntryEqual = equalFor(NestedEntryType(MachinePlacesType));
const assemblyEntryEqual = equalFor(NestedEntryType(AssemblyPlacesType));
const hallEntryEqual = equalFor(NestedEntryType(HallPlacesType));
const machineEqual = equalFor(MachineType);
const dateOrder = compareFor(DateTimeType);

/** The run an entry is in: a node's own items, its totals, its subtree's items, or a parent's mean of its members'. */
const ITEMS = variant('items', null);
const TOTALS_RUN = variant('totals', null);
const SUBTREE = variant('subtree', null);
const MEAN = variant('subtotals', { fold: variant('mean', null), aggregate: variant('mean', null) });

/** A place, or a node's path, as a nested key holds it: its keys, folded from the last. */
function pathOf(keys: readonly string[]): unknown {
  return keys.reduceRight<unknown>((rest, key) => variant('step', { key, rest }), variant('end', null));
}

/** A nested key's leading fields, as a search names them: the collection's place, the row, the node's path, the run and the level. */
function nestedLead(collection: readonly string[], row: string, path: readonly string[], run: unknown, level: Level): string[] {
  return [printPath(pathOf(collection) as never), printString(row), printPath(pathOf(path) as never), printRun(run as never), printLevel(variant(level, null))];
}

/** A search over one run of a nested index at one level: its tiles from `from` to before `to`. */
function nestedRange(collection: readonly string[], row: string, path: readonly string[], run: unknown, level: Level, from: number, to: number): DatasetKeySearch {
  const lead = nestedLead(collection, row, path, run, level);
  return { from: [...lead, printDateTime(new Date(from))], to: [...lead, printDateTime(new Date(to))] };
}

/** An exact search of one tile of a nested index's run. */
function nestedTile(collection: readonly string[], row: string, path: readonly string[], run: unknown, filed: { level: Level; tile: number }): DatasetKeySearch {
  return { fields: [...nestedLead(collection, row, path, run, filed.level), printDateTime(new Date(filed.tile))] };
}

/** The months a span touches, half-open, by each one's start, with the milliseconds of each it covers; an instant covers none of its month. */
function monthsOf(start: number, end: number): Array<{ month: number; ms: bigint }> {
  if (end <= start) return [{ month: tileStart('month', start), ms: 0n }];
  const months: Array<{ month: number; ms: bigint }> = [];
  for (let month = tileStart('month', start); month < end; month = tileStep('month', month, 1)) {
    months.push({ month, ms: BigInt(Math.min(tileStep('month', month, 1), end) - Math.max(month, start)) });
  }
  return months;
}

/** Jobs' totals a month at a time, worked out from them: under each month's start, the jobs touching it and the time of it they cover. */
function monthTotals(jobs: Iterable<NestedJob>): Map<number, { count: bigint; ms: bigint }> {
  const totals = new Map<number, { count: bigint; ms: bigint }>();
  for (const job of jobs) {
    for (const { month, ms } of monthsOf(job.start.getTime(), job.end.getTime())) {
      const held = totals.get(month) ?? { count: 0n, ms: 0n };
      totals.set(month, { count: held.count + 1n, ms: held.ms + ms });
    }
  }
  return totals;
}

/** The machines: sixty, each with ten jobs over six weeks from {@link JOBS_FROM}, four hours long to forty-one days, and a load each of those days. */
function nestedMachines(): Machines {
  const machines = new SortedMap<string, Machine>(undefined, stringOrder);
  for (let m = 0; m < 60; m++) {
    const name = `M-${String(m).padStart(3, '0')}`;
    const jobs = new SortedMap<string, NestedJob>(undefined, stringOrder);
    for (let j = 0; j < 10; j++) {
      const start = JOBS_FROM.getTime() + ((m * 7 + j * 5) % 42) * DAY_MS + (j % 3) * 6 * HOUR_MS;
      jobs.set(`j-${m}-${j}`, { product: `P-${j % 4}`, start: new Date(start), end: new Date(start + JOB_HOURS[j % JOB_HOURS.length]! * HOUR_MS) });
    }
    const load = new SortedMap<Date, number>(undefined, dateOrder);
    for (let d = 0; d < 42; d++) load.set(new Date(JOBS_FROM.getTime() + d * DAY_MS), ((m * 13 + d * 7) % 100) / 100);
    machines.set(name, { name, site: `Site ${m % 3}`, status: 'up', jobs, load });
  }
  return machines;
}

/** The halls: four, each with five members, each member's load each of six weeks' days but one in four. */
function nestedHalls(): Halls {
  const halls = new SortedMap<string, Hall>(undefined, stringOrder);
  for (let h = 0; h < 4; h++) {
    const members = new SortedMap<string, Member>(undefined, stringOrder);
    for (let m = 0; m < 5; m++) {
      const load = new SortedMap<Date, number>(undefined, dateOrder);
      for (let d = 0; d < 42; d++) {
        if ((d + m) % 4 !== 0) load.set(new Date(JOBS_FROM.getTime() + d * DAY_MS), ((h * 17 + m * 11 + d * 3) % 100) / 100);
      }
      members.set(`m-${m}`, { name: `Member ${m}`, load });
    }
    halls.set(`H-${h}`, { name: `Hall ${h}`, site: `Site ${h % 2}`, members });
  }
  return halls;
}

/** Each assembly's jobs by letter: the day it starts on, after the assembly's own, and how many hours it runs. */
const PART_JOBS = { a: [0, 4], b: [7, 30], c: [9, 200], d: [14, 1_000], e: [3, 8] } as const;

/** Assembly `a`'s job of a letter: from six in the morning of its day, for its hours. */
function partJob(a: number, letter: keyof typeof PART_JOBS): NestedJob {
  const [days, hours] = PART_JOBS[letter];
  const start = JOBS_FROM.getTime() + (a + days) * DAY_MS + 6 * HOUR_MS;
  return { product: 'P-0', start: new Date(start), end: new Date(start + hours * HOUR_MS) };
}

const printJob = printFor(NestedJobType);

/**
 * The assemblies: three, each a part p1 holding p1.1 holding p1.1.1, and p2
 * beside it, a job or two each, written as East prints them and read by its
 * parser — a part is a recursive type.
 */
function nestedAssemblies(): Assemblies {
  const job = (a: number, letter: keyof typeof PART_JOBS) => `"j-${a}-${letter}":${printJob(partJob(a, letter))}`;
  const part = (name: string, jobs: string, parts = '{:}') => `(name="${name}", jobs={${jobs}}, parts=${parts})`;
  const assembly = (a: number) => {
    const deepest = part('p1.1.1', job(a, 'd'));
    const middle = part('p1.1', `${job(a, 'b')}, ${job(a, 'c')}`, `{"p1.1.1":${deepest}}`);
    return `(name="Assembly ${a}", parts={"p1":${part('p1', job(a, 'a'), `{"p1.1":${middle}}`)}, "p2":${part('p2', job(a, 'e'))}})`;
  };
  const read = parseFor(AssembliesType)(`{${[0, 1, 2].map((a) => `"A-${a}":${assembly(a)}`).join(', ')}}`);
  if (!read.success) throw new Error(`the assemblies are not a ${printType(AssembliesType)}: ${read.error}`);
  return read.value;
}

export function seriesRecordTests(setup: TestSetup<TestContext>): void {
  /** A deployed record of {@link JOBS} jobs, the content hash it holds, and its jobs as it holds them. */
  const withJobs = async (t: Parameters<TestSetup<TestContext>>[0]): Promise<{ ctx: TestContext; hash: string; jobs: Jobs }> => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createSeriesRecordPackageZip(ctx.tempDir, PKG, VERSION);
    await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, WS, opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, WS, `${PKG}@${VERSION}`, opts);
    const seeded = await workspaceRecordMutate(
      ctx.config.baseUrl, ctx.repoName, WS, 'jobs', 'seed',
      { args: [encodeInt(JOBS)], actor: none, limits: none }, opts,
    );
    assertMutationCommitted(seeded, 'seeding');
    return { ctx, hash: await hashOf(ctx), jobs: await jobsOf(ctx) };
  };

  /** The content hash the record holds now. */
  const hashOf = async (ctx: TestContext): Promise<string> => {
    const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, WS, jobsPath, await ctx.opts());
    assert.ok(status.hash.type === 'some', 'the record holds a state');
    return status.hash.value;
  };

  /** The record's jobs, read whole through the ordinary dataset door. */
  const jobsOf = async (ctx: TestContext): Promise<Jobs> => {
    const { data } = await datasetGet(ctx.config.baseUrl, ctx.repoName, WS, jobsPath, await ctx.opts());
    return decodeJobs(data as Uint8Array);
  };

  /**
   * The entries an index's searches select: the searches in one request, then
   * the runs they select, read on until every entry is in hand — each at the
   * hash given, and none joined.
   */
  const readRuns = async <E>(
    ctx: TestContext, ws: string, path: typeof jobsPath, index: string, searches: DatasetKeySearch[], hash: string,
    decode: (bytes: Uint8Array) => readonly E[],
  ): Promise<E[]> => {
    const opts = await ctx.opts();
    const base = [ctx.config.baseUrl, ctx.repoName, ws, path] as const;
    const found = await datasetFindKeys(...base, { queries: searches, index, hash }, opts);
    assert.equal(found.hash, hash, 'every search is answered at the content pinned');
    assert.equal(found.results.length, searches.length, 'an answer a search');
    let rest = found.results.filter((result) => result.count > 0)
      .map((result): [number, number] => [result.row, result.count]).sort((a, b) => a[0] - b[0]);
    const entries: E[] = [];
    while (rest.length > 0) {
      const read = await datasetGetRuns(...base, { runs: rest, hash, index }, opts);
      assert.equal(read.hash, hash, 'the runs are read at the content pinned');
      assert.ok(read.count > 0, 'a read of runs answers some of their entries');
      entries.push(...decode(read.data));
      // The runs named, less the entries in hand.
      let taken = read.count;
      const next: [number, number][] = [];
      for (const [row, count] of rest) {
        if (taken >= count) { taken -= count; continue; }
        next.push([row + taken, count - taken]);
        taken = 0;
      }
      rest = next;
    }
    return entries;
  };

  /** The series entries a block's searches select ({@link readRuns}). */
  const readSeries = (ctx: TestContext, searches: DatasetKeySearch[], hash: string): Promise<SeriesEntry[]> =>
    readRuns(ctx, WS, jobsPath, SERIES, searches, hash, decodeSeriesWindow);

  /** Every total the summary holds, paged through at the hash given. */
  const readTotals = async (ctx: TestContext, hash: string): Promise<TotalsEntry[]> => {
    const opts = await ctx.opts();
    const base = [ctx.config.baseUrl, ctx.repoName, WS, jobsPath] as const;
    const entries: TotalsEntry[] = [];
    for (let offset = 0; ;) {
      const page = await datasetGetPage(...base, { offset, limit: 1_000, index: TOTALS, hash }, opts);
      assert.equal(page.hash, hash, 'the totals are read at the content pinned');
      entries.push(...decodeTotalsWindow(page.data));
      offset += page.count;
      if (page.count === 0 || offset >= page.totalElements) return entries;
    }
  };

  /** Holds every total read to the ones the jobs give, each once, none joined. */
  const assertTotals = (read: readonly TotalsEntry[], jobs: Jobs): void => {
    const expected = totalsOf(jobs);
    assert.equal(read.length, expected.size, 'a total for each week and press a job touches, and no other');
    for (const entry of read) {
      const at = `${printDateTime(entry.ik.tile)} on ${entry.ik.key}`;
      const want = expected.get(entry.ik);
      assert.ok(want !== undefined, `the summary holds a total for ${at}, which a job touches`);
      assert.ok(integerEqual(entry.value.count, want.count), `the jobs touching ${at}: ${entry.value.count} read, ${want.count} there`);
      assert.ok(integerEqual(entry.value.ms, want.ms), `the time they cover of ${at}: ${entry.value.ms} ms read, ${want.ms} there`);
      assert.ok(unjoined(entry.row, none), `${at} names no row`);
    }
  };

  describe('records read in two dimensions', { concurrency: false }, () => {
    it('describes its series index carrying its rows and its summary holding its totals, both built, each keyed by a press first', async (t) => {
      const { ctx, hash } = await withJobs(t);
      const opts = await ctx.opts();
      const sig = await workspaceRecordDescribe(ctx.config.baseUrl, ctx.repoName, WS, 'jobs', opts);
      assert.deepEqual(sig.indexes.map(({ name, multi, summary, built }) => [name, multi, summary, built]),
        [[SERIES, true, false, true], [TOTALS, true, true, true]]);
      assert.ok(isTypeValueEqual(sig.indexes[0]!.keyType, toEastTypeValue(JobPressLevelTileKeyType)), 'the series is keyed by a press, a level, then a tile');
      assert.ok(isTypeValueEqual(sig.indexes[1]!.keyType, toEastTypeValue(JobPressWeekKeyType)), 'the summary by a press, then a week');
      assert.ok(isTypeValueEqual(sig.indexes[0]!.valueType, toEastTypeValue(JobRowType)), 'the series carries the row whole');
      assert.ok(isTypeValueEqual(sig.indexes[1]!.valueType, toEastTypeValue(RecordSummaryTotalsType)), 'the summary holds its totals');
      assert.ok(isTypeEqual(SeriesWindowType, indexWindowType(StringType, JobPressLevelTileKeyType, JobRowType, JobRowType)),
        'the series window is e3-types\' index window');
      assert.ok(isTypeEqual(TotalsWindowType, indexWindowType(NullType, JobPressWeekKeyType, RecordSummaryTotalsType, JobRowType)),
        'the summary\'s is too, its key Null');
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, WS, jobsPath, { offset: 0, limit: 1, index: SERIES, hash }, opts);
      assert.ok(page.segmentCount >= 2, `the series spans segments, got ${page.segmentCount}`);
    });

    it('reads a block of presses over three weeks from the series alone: a range a press a level, every job filed there once with its row, every job of the block overlapping the weeks among them', async (t) => {
      const { ctx, hash, jobs } = await withJobs(t);
      const from = JOBS_FROM.getTime();
      const to = from + 3 * WEEK_MS;
      const presses = Array.from({ length: 8 }, (_, i) => `P-${1005 + i}`);
      const runs = levelRuns(from, to);
      const searches = presses.flatMap((press) => runs.map((run) => runSearch(press, run)));
      assert.equal(searches.length, 8 * 4, 'a range a press a level, whatever the span');
      const entries = await readSeries(ctx, searches, hash);
      for (const entry of entries) {
        const job = jobs.get(entry.key);
        assert.ok(job !== undefined && jobEqual(entry.value, job), `${entry.key}'s entry carries its row whole`);
        assert.ok(unjoined(entry.row, none), `${entry.key} is read from the series alone, never joined`);
        assert.ok(stringEqual(entry.ik.key, job.press), `${entry.key} is filed under its press`);
      }
      // Held to the brute force: under each run, the block's jobs filed there, each once, and no other.
      const read = entries.map((entry) => `${entry.key} ${printLevel(entry.ik.level)} ${printDateTime(entry.ik.tile)}`).sort(stringOrder);
      const expected = [...jobs].filter(([, job]) => inBlock(job.press, 'P-1005', 'P-1013')).flatMap(([key, job]) => filingsOf(job)
        .filter((filed) => runs.some((run) => run.level === filed.level && filed.tile >= run.from && filed.tile < run.to))
        .map((filed) => `${key} ${printLevel(variant(filed.level, null))} ${printDateTime(new Date(filed.tile))}`)).sort(stringOrder);
      assert.deepEqual(read, expected, 'every job the runs hold, each once, and no other');
      // Every job of the block overlapping the weeks is among them: what a reader keeps by its key.
      const keys = new Set(entries.map((entry) => entry.key));
      const overlapping = [...jobs].filter(([, job]) => inBlock(job.press, 'P-1005', 'P-1013')
        && job.start.getTime() < to && Math.max(job.end.getTime(), job.start.getTime() + 1) > from).map(([key]) => key);
      assert.ok(overlapping.length > 0, 'the block has jobs those weeks');
      for (const key of overlapping) assert.ok(keys.has(key), `${key}, overlapping the weeks, is read`);
    });

    it('totals each week and press as the jobs touching it and the time of it they cover, and refuses a joined read, a placement and a membership read', async (t) => {
      const { ctx, hash, jobs } = await withJobs(t);
      const opts = await ctx.opts();
      const totals = await readTotals(ctx, hash);
      assertTotals(totals, jobs);
      // A summary's entry names no row: a joined read of it is refused.
      const base = [ctx.config.baseUrl, ctx.repoName, WS, jobsPath] as const;
      for (const read of [
        () => datasetGetPage(...base, { offset: 0, limit: 10, index: TOTALS, hash, join: true }, opts),
        () => datasetGetRuns(...base, { runs: [[0, 10]], hash, index: TOTALS, join: true }, opts),
      ]) {
        await assert.rejects(read, (err: unknown) => {
          assert.ok(err instanceof ApiError && err.code === 'bad_request', `a joined read of a summary is refused, got ${String(err)}`);
          assert.match(String(err.details), /index 'jobs_by_press_week_totals' of 'records\/jobs' is a summary: each entry stands for every row of its key and names none to join — read it without join/);
          return true;
        });
      }
      // Nor has it a row to place in a record segment, or to answer whether a narrowing holds.
      const entryKey = printTotalsEntryKey({ ik: totals[0]!.ik, k: null });
      for (const [read, unnamed] of [
        [() => datasetPlace(...base, { index: TOTALS, runs: [[0, 10]], hash }, opts), 'to place in a record segment'],
        [() => datasetWithin(...base, { index: TOTALS, runs: [[0, 10]], keys: [entryKey], hash }, opts), 'to answer whether a narrowing holds it'],
      ] as const) {
        await assert.rejects(read, (err: unknown) => {
          assert.ok(err instanceof ApiError && err.code === 'bad_request', `a summary is refused ${unnamed}, got ${String(err)}`);
          assert.equal(String(err.details),
            `index 'jobs_by_press_week_totals' of 'records/jobs' is a summary: each entry stands for every row of its key and names none ${unnamed}`);
          return true;
        });
      }
    });

    it('a job moved three weeks on leaves the week it left, in the series and the totals, and is read and totalled where it went', async (t) => {
      const { ctx, hash, jobs } = await withJobs(t);
      const opts = await ctx.opts();
      const moved = 'job-7';
      const job = jobs.get(moved)!;
      const next = new SortedMap(jobs, stringOrder);
      next.set(moved, { ...job, start: new Date(job.start.getTime() + 3 * WEEK_MS), end: new Date(job.end.getTime() + 3 * WEEK_MS) });
      // Another session moves it, through the record's patch door.
      const patched = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, WS, 'jobs', 'patch',
        { args: [encodePatch(diffFor(JobsType)(jobs, next))], actor: none, limits: none }, opts);
      assertMutationCommitted(patched, 'the move');
      const movedHash = await hashOf(ctx);
      assert.notEqual(movedHash, hash, 'the move gives the record another state');
      const now = await jobsOf(ctx);
      assert.ok(jobEqual(now.get(moved)!, next.get(moved)!), 'the record holds the job where it was moved to');

      // An exact search names the key's own fields: its `on`, empty here, printed whole, then the press, the level and the tile (#1432, #1433).
      const exact = (filed: { level: Level; tile: number }): DatasetKeySearch => ({
        fields: [printOn({}), printString(job.press), printLevel(variant(filed.level, null)), printDateTime(new Date(filed.tile))],
      });
      for (const filed of filingsOf(job)) {
        const read = await readSeries(ctx, [exact(filed)], movedHash);
        assert.ok(!read.some((entry) => stringEqual(entry.key, moved)), `the moved job has left the ${filed.level} of ${printDateTime(new Date(filed.tile))}`);
      }
      for (const filed of filingsOf(next.get(moved)!)) {
        const read = await readSeries(ctx, [exact(filed)], movedHash);
        const entry = read.find((e) => stringEqual(e.key, moved));
        assert.ok(entry !== undefined && jobEqual(entry.value, next.get(moved)!), `it is read in the ${filed.level} of ${printDateTime(new Date(filed.tile))}, its row as moved`);
      }
      assertTotals(await readTotals(ctx, movedHash), now);
    });

    it('reads a job a hundred days long, and one three years long, once each among a block\'s runs, each filed where its length fits', async (t) => {
      const { ctx, jobs } = await withJobs(t);
      const opts = await ctx.opts();
      const from = JOBS_FROM.getTime() + WEEK_MS;
      const long = new SortedMap(jobs, stringOrder);
      long.set('job-season', { press: 'P-1005', start: new Date(from), end: new Date(from + 100 * DAY_MS), title: 'A season' });
      long.set('job-years', { press: 'P-1005', start: new Date(from - DAY_MS), end: new Date(from + 3 * 365 * DAY_MS), title: 'Three years' });
      const patched = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, WS, 'jobs', 'patch',
        { args: [encodePatch(diffFor(JobsType)(jobs, long))], actor: none, limits: none }, opts);
      assertMutationCommitted(patched, 'the long jobs');
      const hash = await hashOf(ctx);
      // A hundred days is past a quarter's ninety: filed once, under its year; three years under each of the four it touches.
      assert.deepEqual(filingsOf(long.get('job-season')!).map((filed) => filed.level), ['year']);
      assert.equal(filingsOf(long.get('job-years')!).length, 4);
      const runs = levelRuns(from, from + WEEK_MS);
      const entries = await readSeries(ctx, runs.map((run) => runSearch('P-1005', run)), hash);
      const ofKey = (key: string) => entries.filter((entry) => stringEqual(entry.key, key));
      assert.equal(ofKey('job-season').length, 1, 'the season is read once');
      assert.ok(ofKey('job-years').length >= 1, 'the three years are read under each year the runs hold');
      assert.deepEqual([...new Set(entries.map((entry) => entry.key))].filter((key) => key === 'job-season' || key === 'job-years').sort(stringOrder),
        ['job-season', 'job-years'], 'a reader keeps each once, by its key');
      for (const entry of [...ofKey('job-season'), ...ofKey('job-years')]) {
        assert.ok(jobEqual(entry.value, long.get(entry.key)!), `${entry.key} carries its row whole`);
      }
      assertTotals(await readTotals(ctx, hash), await jobsOf(ctx));
    });
  });

  /** Writes a nested record through its patch door. */
  const writeNested = async (ctx: TestContext, record: string, patch: Uint8Array): Promise<void> => {
    const written = await workspaceRecordMutate(ctx.config.baseUrl, ctx.repoName, NESTED_WS, record, 'patch',
      { args: [patch], actor: none, limits: none }, await ctx.opts());
    assertMutationCommitted(written, `the ${record}`);
  };

  /** The content hash a nested record holds now. */
  const nestedHash = async (ctx: TestContext, record: string): Promise<string> => {
    const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, NESTED_WS, recordAt(record), await ctx.opts());
    assert.ok(status.hash.type === 'some', `${record} holds a state`);
    return status.hash.value;
  };

  /** The records nesting what they file, deployed and written through their patch doors, and the rows written. */
  const withNested = async (t: Parameters<TestSetup<TestContext>>[0]): Promise<{ ctx: TestContext; machines: Machines; halls: Halls; assemblies: Assemblies }> => {
    const ctx = await setup(t);
    const opts = await ctx.opts();
    const zipPath = await createNestedSeriesPackageZip(ctx.tempDir, NESTED_PKG, VERSION);
    await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);
    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, NESTED_WS, opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, NESTED_WS, `${NESTED_PKG}@${VERSION}`, opts);
    const machines = nestedMachines();
    const halls = nestedHalls();
    const assemblies = nestedAssemblies();
    await writeNested(ctx, 'machines', encodeMachinesPatch(diffFor(MachinesType)(new SortedMap(undefined, stringOrder), machines)));
    await writeNested(ctx, 'halls', encodeHallsPatch(diffFor(HallsType)(new SortedMap(undefined, stringOrder), halls)));
    await writeNested(ctx, 'assemblies', encodeAssembliesPatch(diffFor(AssembliesType)(new SortedMap(undefined, stringOrder), assemblies)));
    return { ctx, machines, halls, assemblies };
  };

  describe('records nesting what they file, read through their nested series index', { concurrency: false }, () => {
    it('describes the machines\' nested index, keyed by place, row, path, run, level, tile and item, and their other index carrying each machine without its collections', async (t) => {
      const { ctx, machines } = await withNested(t);
      const opts = await ctx.opts();
      const sig = await workspaceRecordDescribe(ctx.config.baseUrl, ctx.repoName, NESTED_WS, 'machines', opts);
      const nested = sig.indexes.find((index) => stringEqual(index.name, 'machines_in_time'));
      const bySite = sig.indexes.find((index) => stringEqual(index.name, 'machines_by_site'));
      assert.ok(nested !== undefined && nested.built && nested.multi, 'the nested index is built, a row filing many entries');
      assert.ok(isTypeValueEqual(nested.keyType, toEastTypeValue(NestedKeyType)), 'keyed by place, row, path, run, level, tile and item');
      assert.ok(isTypeValueEqual(nested.valueType, toEastTypeValue(NestedEntryType(MachinePlacesType))), 'carrying an item, its totals or a subtotal');
      assert.ok(isTypeEqual(MachinesWindowType, indexWindowType(StringType, NestedKeyType, NestedEntryType(MachinePlacesType), MachineType)),
        'its window is e3-types\' index window');
      assert.ok(bySite !== undefined && isTypeValueEqual(bySite.keyType, toEastTypeValue(StringType)), 'machines_by_site is keyed by the site');
      assert.ok(isTypeValueEqual(bySite.valueType, toEastTypeValue(MachineType)), 'machines_by_site carries a machine');
      // A page of it, read without a join: each machine without its jobs and its load.
      const SiteWindowType = ArrayType(StructType({ ik: StringType, key: StringType, value: MachineType, row: OptionType(MachineType) }));
      assert.ok(isTypeEqual(SiteWindowType, indexWindowType(StringType, StringType, MachineType, MachineType)), 'its window too');
      const hash = await nestedHash(ctx, 'machines');
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, NESTED_WS, recordAt('machines'),
        { offset: 0, limit: 100, index: 'machines_by_site', hash }, opts);
      const entries = decodeBeast2For(SiteWindowType)(page.data);
      assert.equal(entries.length, machines.size, 'every machine, once');
      const jobs = new SortedMap<string, NestedJob>(undefined, stringOrder);
      const load = new SortedMap<Date, number>(undefined, dateOrder);
      for (const entry of entries) {
        const machine = machines.get(entry.key);
        assert.ok(machine !== undefined && machineEqual(entry.value, { ...machine, jobs, load }), `${entry.key} is carried without its collections`);
        assert.ok(entry.row.type === 'none', `${entry.key} is read from the index alone`);
      }
    });

    it('reads a block of fifty machines\' jobs over three weeks as a range a machine a level, in one request: every job filed there once, carried whole', async (t) => {
      const { ctx, machines } = await withNested(t);
      const hash = await nestedHash(ctx, 'machines');
      const from = JOBS_FROM.getTime() + WEEK_MS;
      const to = from + 3 * WEEK_MS;
      const runs = levelRuns(from, to);
      const block = [...machines.keys()].slice(5, 55);
      const searches = block.flatMap((row) => runs.map((run) => nestedRange(['jobs'], row, [], ITEMS, run.level, run.from, run.to)));
      assert.equal(searches.length, 50 * 4, 'a range a machine a level, whatever the span');
      const entries = await readRuns(ctx, NESTED_WS, recordAt('machines'), 'machines_in_time', searches, hash, decodeMachinesWindow);
      const read: string[] = [];
      for (const entry of entries) {
        assert.ok(entry.ik.item.type === 'id', `${entry.key}: a job, by its id`);
        const id = entry.ik.item.value;
        const job = machines.get(entry.key)?.jobs.get(id);
        assert.ok(job !== undefined && machineEntryEqual(entry.value, variant('item', variant('jobs', job))), `${entry.key} ${id} is carried whole`);
        assert.ok(entry.row.type === 'none', `${entry.key} ${id} is read from the index alone`);
        read.push(`${entry.key} ${printItem(entry.ik.item)} ${printLevel(entry.ik.level)} ${printDateTime(entry.ik.tile)}`);
      }
      // Held to the brute force: under each run, the block's jobs filed there, each once, and no other.
      const expected = block.flatMap((row) => [...machines.get(row)!.jobs].flatMap(([id, job]) => filingsOf(job)
        .filter((filed) => runs.some((run) => run.level === filed.level && filed.tile >= run.from && filed.tile < run.to))
        .map((filed) => `${row} ${printItem(variant('id', id))} ${printLevel(variant(filed.level, null))} ${printDateTime(new Date(filed.tile))}`)));
      assert.ok(expected.length > 0, 'the block has jobs those weeks');
      assert.deepEqual(read.sort(stringOrder), expected.sort(stringOrder), 'every job the runs hold, each once, and no other');
    });

    it('keeps each machine\'s totals of its jobs and its load a month at a time: how many, the time they cover, and the load\'s sum, least, greatest and last', async (t) => {
      const { ctx, machines } = await withNested(t);
      const hash = await nestedHash(ctx, 'machines');
      const from = tileStep('month', tileStart('month', JOBS_FROM.getTime()), -2);
      const to = tileStep('month', from, 8);
      const searches = [...machines.keys()].flatMap((row) => [
        nestedRange(['jobs'], row, [], TOTALS_RUN, 'month', from, to), nestedRange(['load'], row, [], TOTALS_RUN, 'month', from, to),
      ]);
      const entries = await readRuns(ctx, NESTED_WS, recordAt('machines'), 'machines_in_time', searches, hash, decodeMachinesWindow);
      // Worked out from the rows: each machine's jobs a month, and its load's values in key order.
      const where = (row: string, collection: string, month: number) => `${row} ${collection} ${printDateTime(new Date(month))}`;
      const expected = new Map<string, unknown>();
      for (const [row, machine] of machines) {
        for (const [month, totals] of monthTotals(machine.jobs.values())) {
          expected.set(where(row, 'jobs', month), variant('totals', { count: totals.count, ms: totals.ms, values: none }));
        }
        const loads = new Map<number, { count: bigint; sum: number; min: number; max: number; last: number }>();
        for (const [at, value] of machine.load) {
          const month = tileStart('month', at.getTime());
          const held = loads.get(month);
          loads.set(month, held === undefined ? { count: 1n, sum: value, min: value, max: value, last: value }
            : { count: held.count + 1n, sum: held.sum + value, min: Math.min(held.min, value), max: Math.max(held.max, value), last: value });
        }
        for (const [month, { count, sum, min, max, last }] of loads) {
          expected.set(where(row, 'load', month), variant('totals', { count, ms: 0n, values: some({ sum, min, max, last }) }));
        }
      }
      assert.equal(entries.length, expected.size, 'a total for each month a machine\'s jobs or load touch, and no other');
      for (const entry of entries) {
        const collection = stringEqual(printPath(entry.ik.collection), printPath(pathOf(['jobs']) as never)) ? 'jobs' : 'load';
        const at = where(entry.key, collection, entry.ik.tile.getTime());
        const want = expected.get(at);
        assert.ok(want !== undefined && machineEntryEqual(entry.value, want as never), `${at}: ${printFor(NestedEntryType(MachinePlacesType))(entry.value)}`);
      }
    });

    it('keeps a hall\'s mean of its members\' loads a week at a time, read as one range: each member\'s mean of its days, and their mean', async (t) => {
      const { ctx, halls } = await withNested(t);
      const hash = await nestedHash(ctx, 'halls');
      const from = tileStep('week', weekHolding(JOBS_FROM.getTime()), -2);
      const to = tileStep('week', from, 12);
      const entries = await readRuns(ctx, NESTED_WS, recordAt('halls'), 'halls_in_time',
        [nestedRange(['members', 'load'], 'H-1', [], MEAN, 'week', from, to)], hash, decodeHallsWindow);
      // Worked out from the rows: each member's values a week, in key order, their mean; the hall's, its members' means' mean, in theirs.
      const means = new Map<number, number[]>();
      for (const member of halls.get('H-1')!.members.values()) {
        const weeks = new Map<number, { sum: number; n: number }>();
        for (const [at, value] of member.load) {
          const week = weekHolding(at.getTime());
          const held = weeks.get(week) ?? { sum: 0, n: 0 };
          weeks.set(week, { sum: held.sum + value, n: held.n + 1 });
        }
        for (const [week, { sum, n }] of weeks) means.set(week, [...(means.get(week) ?? []), sum / n]);
      }
      assert.equal(entries.length, means.size, 'a subtotal for each week a member\'s value touches, and no other');
      for (const entry of entries) {
        const week = printDateTime(entry.ik.tile);
        const own = means.get(entry.ik.tile.getTime());
        assert.ok(own !== undefined && stringEqual(entry.key, 'H-1'), `the week of ${week} is H-1's, which a member's value touches`);
        const mean = own.reduce((sum, value) => sum + value, 0) / own.length;
        assert.ok(hallEntryEqual(entry.value, variant('subtotal', mean)), `the week of ${week}: ${printFor(NestedEntryType(HallPlacesType))(entry.value)}, the members' ${mean}`);
      }
    });

    it('files each part\'s jobs under every part above it too, read under a part as one range a level: its subtree\'s jobs, each once, by their path beneath it', async (t) => {
      const { ctx } = await withNested(t);
      const hash = await nestedHash(ctx, 'assemblies');
      const runs = levelRuns(JOBS_FROM.getTime(), JOBS_FROM.getTime() + 8 * WEEK_MS);
      const searches = runs.map((run) => nestedRange(['parts', 'jobs'], 'A-0', ['p1'], SUBTREE, run.level, run.from, run.to));
      assert.equal(searches.length, 4, 'a range a level');
      const entries: AssembliesEntry[] = await readRuns(ctx, NESTED_WS, recordAt('assemblies'), 'assemblies_in_time', searches, hash, decodeAssembliesWindow);
      // Beneath p1: p1.1's two jobs and p1.1.1's one — p1's own is in its items, not its subtree.
      const beneath = [{ path: ['p1.1'], letter: 'b' }, { path: ['p1.1'], letter: 'c' }, { path: ['p1.1', 'p1.1.1'], letter: 'd' }] as const;
      const expected = beneath.flatMap(({ path, letter }) => filingsOf(partJob(0, letter)).map((filed) =>
        `${printItem(variant('under', { path: pathOf(path), id: `j-0-${letter}` }) as never)} ${printLevel(variant(filed.level, null))} ${printDateTime(new Date(filed.tile))}`));
      const read = entries.map((entry) => `${printItem(entry.ik.item)} ${printLevel(entry.ik.level)} ${printDateTime(entry.ik.tile)}`);
      assert.deepEqual(read.sort(stringOrder), expected.sort(stringOrder), 'every job beneath p1, each once, and no other');
      for (const entry of entries) {
        assert.ok(stringEqual(printPath(entry.ik.path), printPath(pathOf(['p1']) as never)), 'filed under p1');
        assert.ok(entry.ik.item.type === 'under', 'a job beneath it, by its path and id');
        const letter = entry.ik.item.value.id.slice(-1) as keyof typeof PART_JOBS;
        assert.ok(assemblyEntryEqual(entry.value, variant('item', variant('parts', variant('jobs', partJob(0, letter))))),
          `${entry.ik.item.value.id} is carried whole`);
      }
    });

    it('reads a job moved three weeks on where it went, and not where it was, and totals the months as the jobs then give them', async (t) => {
      const { ctx, machines } = await withNested(t);
      const row = 'M-007';
      const id = 'j-7-0';
      const machine = machines.get(row)!;
      const job = machine.jobs.get(id)!;
      const moved = { ...job, start: new Date(job.start.getTime() + 3 * WEEK_MS), end: new Date(job.end.getTime() + 3 * WEEK_MS) };
      const jobs = new SortedMap(machine.jobs, stringOrder);
      jobs.set(id, moved);
      const next = new SortedMap(machines, stringOrder);
      next.set(row, { ...machine, jobs });
      // Another session moves it, through the record's patch door.
      await writeNested(ctx, 'machines', encodeMachinesPatch(diffFor(MachinesType)(machines, next)));
      const hash = await nestedHash(ctx, 'machines');
      const itemEqual = equalFor(RecordNestedItemType);
      const tile = (filed: { level: Level; tile: number }) =>
        readRuns(ctx, NESTED_WS, recordAt('machines'), 'machines_in_time', [nestedTile(['jobs'], row, [], ITEMS, filed)], hash, decodeMachinesWindow);
      for (const filed of filingsOf(job)) {
        const read = await tile(filed);
        assert.ok(!read.some((entry) => itemEqual(entry.ik.item, variant('id', id))), `${id} has left the ${filed.level} of ${printDateTime(new Date(filed.tile))}`);
      }
      for (const filed of filingsOf(moved)) {
        const entry = (await tile(filed)).find((e) => itemEqual(e.ik.item, variant('id', id)));
        assert.ok(entry !== undefined && machineEntryEqual(entry.value, variant('item', variant('jobs', moved))),
          `${id} is read in the ${filed.level} of ${printDateTime(new Date(filed.tile))}, as moved`);
      }
      const from = tileStep('month', tileStart('month', JOBS_FROM.getTime()), -2);
      const totals = await readRuns(ctx, NESTED_WS, recordAt('machines'), 'machines_in_time',
        [nestedRange(['jobs'], row, [], TOTALS_RUN, 'month', from, tileStep('month', from, 8))], hash, decodeMachinesWindow);
      const expected = monthTotals(jobs.values());
      assert.equal(totals.length, expected.size, 'a total for each month its jobs touch');
      for (const entry of totals) {
        const want = expected.get(entry.ik.tile.getTime());
        assert.ok(want !== undefined && machineEntryEqual(entry.value, variant('totals', { count: want.count, ms: want.ms, values: none })),
          `${printDateTime(entry.ik.tile)}: ${printFor(NestedEntryType(MachinePlacesType))(entry.value)}`);
      }
    });
  });
}
