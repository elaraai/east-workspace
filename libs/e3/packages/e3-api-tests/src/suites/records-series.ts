/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A record read in two dimensions (#1039): a block of presses over a span of
 * weeks, read through a series index (`e3.recordIndex.series`) as a search a
 * week in one request (`findKeys`) and the runs they select, from the index
 * alone — each entry carries its job's row whole — and, zoomed out, the totals
 * a summary index (`e3.recordIndex.summary`) keeps under each week and press:
 * how many jobs touch it, and the milliseconds of it they cover.
 *
 * The suite works out each job's weeks itself, as its keys are filed — a week
 * from its Monday, in UTC, half-open — so what a server answers is held to a
 * brute force: under each week, the block's jobs that touch it and no other,
 * each once with its row, at one content hash; and each total, the jobs that
 * touch its week on its press and the time of it they cover. Then a job moved
 * to another week, read and totalled where it went, and a joined read of the
 * summary refused.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ArrayType, DateTimeType, IntegerType, NullType, OptionType, PatchType, SortedMap, StringType, StructType, compareFor,
  decodeBeast2For, diffFor, encodeBeast2For, equalFor, isTypeEqual, isTypeValueEqual, none, printFor, toEastTypeValue, variant,
  type ValueTypeOf,
} from '@elaraai/east';
import { RecordSummaryTotalsType, indexWindowType } from '@elaraai/e3-types';
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
  type DatasetKeySearch,
} from '@elaraai/e3-api-client';

import { assertMutationCommitted } from '../assertions.js';
import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createSeriesRecordPackageZip, JOBS_FROM, JobRowType, JobsType, JobWeekPressKeyType } from '../fixtures.js';

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
type WeekPress = ValueTypeOf<typeof JobWeekPressKeyType>;
type Totals = ValueTypeOf<typeof RecordSummaryTotalsType>;

/** A series window's entries: the job's key under a week and a press, its row carried whole. The first test holds it to `indexWindowType`. */
const SeriesWindowType = ArrayType(StructType({ ik: JobWeekPressKeyType, key: StringType, value: JobRowType, row: OptionType(JobRowType) }));
/** A summary window's entries: each week and press, standing for every job of it — its `key` Null — with its totals. */
const TotalsWindowType = ArrayType(StructType({ ik: JobWeekPressKeyType, key: NullType, value: RecordSummaryTotalsType, row: OptionType(JobRowType) }));
type SeriesEntry = ValueTypeOf<typeof SeriesWindowType>[number];
type TotalsEntry = ValueTypeOf<typeof TotalsWindowType>[number];

const encodeInt = encodeBeast2For(IntegerType);
const encodePatch = encodeBeast2For(PatchType(JobsType));
const decodeJobs = decodeBeast2For(JobsType);
const decodeSeriesWindow = decodeBeast2For(SeriesWindowType);
const decodeTotalsWindow = decodeBeast2For(TotalsWindowType);
const printDateTime = printFor(DateTimeType);
const printString = printFor(StringType);
const jobEqual = equalFor(JobRowType);
const unjoined = equalFor(OptionType(JobRowType));
const integerEqual = equalFor(IntegerType);
const dateTimeEqual = equalFor(DateTimeType);
const stringEqual = equalFor(StringType);
const stringOrder = compareFor(StringType);
const weekPressOrder = compareFor(JobWeekPressKeyType);

/** A week, in milliseconds. */
const WEEK_MS = 7 * 86_400_000;

/** The week holding an instant, by its start: whole weeks from {@link JOBS_FROM}, a Monday. */
function weekHolding(ms: number): number {
  return JOBS_FROM.getTime() + Math.floor((ms - JOBS_FROM.getTime()) / WEEK_MS) * WEEK_MS;
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

/** The totals a summary of `jobs` holds, worked out from them: under each week and press, the jobs touching it and the time of it they cover. */
function totalsOf(jobs: Jobs): SortedMap<WeekPress, Totals> {
  const totals = new SortedMap<WeekPress, Totals>(undefined, weekPressOrder);
  for (const job of jobs.values()) {
    for (const { week, ms } of weeksOf(job)) {
      const key = { __tile: week, press: job.press };
      const held = totals.get(key) ?? { count: 0n, ms: 0n };
      totals.set(key, { count: held.count + 1n, ms: held.ms + ms });
    }
  }
  return totals;
}

/** A week's search over a block of presses: from the block's first press to the one after its last, under the week. */
function blockSearch(week: Date, from: string, to: string): DatasetKeySearch {
  return { from: [printDateTime(week), printString(from)], to: [printDateTime(week), printString(to)] };
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
      const at = `${printDateTime(entry.ik.__tile)} on ${entry.ik.press}`;
      const want = expected.get(entry.ik);
      assert.ok(want !== undefined, `the summary holds a total for ${at}, which a job touches`);
      assert.ok(integerEqual(entry.value.count, want.count), `the jobs touching ${at}: ${entry.value.count} read, ${want.count} there`);
      assert.ok(integerEqual(entry.value.ms, want.ms), `the time they cover of ${at}: ${entry.value.ms} ms read, ${want.ms} there`);
      assert.ok(unjoined(entry.row, none), `${at} names no row`);
    }
  };

  describe('records read in two dimensions', { concurrency: false }, () => {
    it('describes its series index carrying its rows and its summary holding its totals, both built, keyed by a week then a press', async (t) => {
      const { ctx, hash } = await withJobs(t);
      const opts = await ctx.opts();
      const sig = await workspaceRecordDescribe(ctx.config.baseUrl, ctx.repoName, WS, 'jobs', opts);
      assert.deepEqual(sig.indexes.map(({ name, multi, summary, built }) => [name, multi, summary, built]),
        [[SERIES, true, false, true], [TOTALS, true, true, true]]);
      for (const index of sig.indexes) {
        assert.ok(isTypeValueEqual(index.keyType, toEastTypeValue(JobWeekPressKeyType)), `${index.name} is keyed by a week, then a press`);
      }
      assert.ok(isTypeValueEqual(sig.indexes[0]!.valueType, toEastTypeValue(JobRowType)), 'the series carries the row whole');
      assert.ok(isTypeValueEqual(sig.indexes[1]!.valueType, toEastTypeValue(RecordSummaryTotalsType)), 'the summary holds its totals');
      assert.ok(isTypeEqual(SeriesWindowType, indexWindowType(StringType, JobWeekPressKeyType, JobRowType, JobRowType)),
        'the series window is e3-types\' index window');
      assert.ok(isTypeEqual(TotalsWindowType, indexWindowType(NullType, JobWeekPressKeyType, RecordSummaryTotalsType, JobRowType)),
        'the summary\'s is too, its key Null');
      const page = await datasetGetPage(ctx.config.baseUrl, ctx.repoName, WS, jobsPath, { offset: 0, limit: 1, index: SERIES, hash }, opts);
      assert.ok(page.segmentCount >= 2, `the series spans segments, got ${page.segmentCount}`);
    });

    it('reads a block of presses over three weeks from the series alone: a search a week, every job of the block touching it, each once with its row', async (t) => {
      const { ctx, hash, jobs } = await withJobs(t);
      const weeks = [0, 1, 2].map((w) => new Date(JOBS_FROM.getTime() + w * WEEK_MS));
      const entries = await readSeries(ctx, weeks.map((week) => blockSearch(week, 'P-1005', 'P-1013')), hash);
      assert.ok(entries.every((entry) => weeks.some((week) => dateTimeEqual(entry.ik.__tile, week))), 'only the weeks searched');
      for (const week of weeks) {
        const read = entries.filter((entry) => dateTimeEqual(entry.ik.__tile, week));
        const keys = read.map((entry) => entry.key).sort(stringOrder);
        assert.equal(new Set(keys).size, keys.length, 'each job once a week');
        for (const entry of read) {
          const job = jobs.get(entry.key);
          assert.ok(job !== undefined && jobEqual(entry.value, job), `${entry.key}'s entry carries its row whole`);
          assert.ok(unjoined(entry.row, none), `${entry.key} is read from the series alone, never joined`);
          assert.ok(stringEqual(entry.ik.press, job.press), `${entry.key} is filed under its press`);
        }
        const expected = [...jobs]
          .filter(([, job]) => inBlock(job.press, 'P-1005', 'P-1013') && weeksOf(job).some(({ week: touched }) => dateTimeEqual(touched, week)))
          .map(([key]) => key).sort(stringOrder);
        assert.ok(expected.length > 0, 'the block has jobs that week');
        assert.deepEqual(keys, expected, `the block's jobs touching the week of ${printDateTime(week)}, and no other`);
      }
    });

    it('totals each week and press as the jobs touching it and the time of it they cover, and refuses a joined read', async (t) => {
      const { ctx, hash, jobs } = await withJobs(t);
      const opts = await ctx.opts();
      assertTotals(await readTotals(ctx, hash), jobs);
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

      const exact = (week: Date): DatasetKeySearch => ({ fields: [printDateTime(week), printString(job.press)] });
      const left = weeksOf(job).map(({ week }) => week);
      const entered = weeksOf(next.get(moved)!).map(({ week }) => week);
      for (const week of left) {
        const read = await readSeries(ctx, [exact(week)], movedHash);
        assert.ok(!read.some((entry) => stringEqual(entry.key, moved)), `the moved job has left the week of ${printDateTime(week)}`);
      }
      for (const week of entered) {
        const read = await readSeries(ctx, [exact(week)], movedHash);
        const entry = read.find((e) => stringEqual(e.key, moved));
        assert.ok(entry !== undefined && jobEqual(entry.value, next.get(moved)!), `it is read in the week of ${printDateTime(week)}, its row as moved`);
      }
      assertTotals(await readTotals(ctx, movedHash), now);
    });
  });
}
