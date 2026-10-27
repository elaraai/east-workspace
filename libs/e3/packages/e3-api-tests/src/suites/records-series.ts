/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A record read in two dimensions (#1039): a block of presses over a span of
 * weeks, read through a series index (`e3.recordIndex.series`) as a range a
 * press a level in one request (`findKeys`) and the runs they select, from the
 * index alone — each entry carries its job's row whole — and, zoomed out, the
 * totals a summary index (`e3.recordIndex.summary`) keeps under each press and
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
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ArrayType, DateTimeType, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType, compareFor,
  decodeBeast2For, diffFor, encodeBeast2For, equalFor, isTypeEqual, isTypeValueEqual, none, printFor, toEastTypeValue, variant,
  type ValueTypeOf,
} from '@elaraai/east';
import { RecordLevelType, RecordSummaryTotalsType, indexWindowType } from '@elaraai/e3-types';
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
import { createSeriesRecordPackageZip, JOBS_FROM, JobPressLevelTileKeyType, JobPressWeekKeyType, JobRowType, JobsType } from '../fixtures.js';

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
function filingsOf(job: Job): Array<{ level: Level; tile: number }> {
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
   * The series entries a block's searches select: the searches in one
   * request, then the runs they select, read on until every entry is in hand —
   * each at the hash given, and none joined.
   */
  const readSeries = async (ctx: TestContext, searches: DatasetKeySearch[], hash: string): Promise<SeriesEntry[]> => {
    const opts = await ctx.opts();
    const base = [ctx.config.baseUrl, ctx.repoName, WS, jobsPath] as const;
    const found = await datasetFindKeys(...base, { queries: searches, index: SERIES, hash }, opts);
    assert.equal(found.hash, hash, 'every search is answered at the content pinned');
    assert.equal(found.results.length, searches.length, 'an answer a search');
    let rest = found.results.filter((result) => result.count > 0)
      .map((result): [number, number] => [result.row, result.count]).sort((a, b) => a[0] - b[0]);
    const entries: SeriesEntry[] = [];
    while (rest.length > 0) {
      const read = await datasetGetRuns(...base, { runs: rest, hash, index: SERIES }, opts);
      assert.equal(read.hash, hash, 'the runs are read at the content pinned');
      assert.ok(read.count > 0, 'a read of runs answers some of their entries');
      entries.push(...decodeSeriesWindow(read.data));
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
}
