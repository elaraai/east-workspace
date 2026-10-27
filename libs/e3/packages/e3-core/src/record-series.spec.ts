/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The series and summary indexes (#1039) on the real runners.
 *
 * Their keys and totals are East the SDK generates, so every runtime must file
 * every event in the same places — once, at the level its length fits, or once
 * a year past a year (#1433) — and split it over a summary's tiles with the
 * same shares, byte for byte; a maintained series index must be the one a
 * reindex rebuilds, and a maintained summary the totals a reindex sums — a
 * build split into pieces too, whose totals of one key its merge adds. This
 * deploys the same record to a workspace per runtime — its patch door, and its
 * series and summary indexes on that runtime — writes the same thousand jobs
 * through the door, from instants to ten years long, then moves, stretches
 * past a level, shrinks back, re-keys, unschedules, recrews and deletes some,
 * and compares the states hash for hash: across the runtimes, and against a
 * rebuild in each. Jobs before 1970 hold every runtime to the floor of a
 * negative instant's tile, and jobs on a level's tile edge to its half-open
 * tiles.
 *
 * The parity compares every runtime installed and skips with fewer than two,
 * as the area index's does; the rest runs on each runtime installed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { accessSync, constants } from 'node:fs';
import assert from 'node:assert';
import { delimiter, join, dirname } from 'node:path';
import {
  DateTimeType, DictType, East, IntegerType, NullType, OptionType, PatchType, SetType, SortedMap, SortedSet, StringType,
  StructType, compareFor, decodeBeast2For, diffFor, encodeBeast2For, equalFor, none, parseFor, some, type ValueTypeOf,
} from '@elaraai/east';
import { RecordSummaryTotalsType } from '@elaraai/e3-types';
import e3 from '@elaraai/e3';
import { readDatasetWhole } from './dataset-open.js';
import { recordHistory, recordMutate, recordReindex, readRecordState } from './records.js';
import { summarizeDelta } from './record-apply.js';
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

/** Runs `fn` with the given env vars set (undefined = unset), restoring after. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev = Object.keys(vars).map((k) => [k, process.env[k]] as const);
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A print job: the press it runs on, the crews on it, its state, and when it runs, or not yet. */
const JobRow = StructType({
  press: StringType, crews: SetType(StringType), state: StringType,
  start: OptionType(DateTimeType), end: OptionType(DateTimeType), title: StringType,
});
const JobsType = DictType(StringType, JobRow);
type Job = ValueTypeOf<typeof JobRow>;
type Jobs = ValueTypeOf<typeof JobsType>;
const keyOrder = compareFor(StringType);
const sameJob = equalFor(JobRow);
const sameInteger = equalFor(IntegerType);

const DAY = 86_400_000n;
const HOUR = 3_600_000n;

const readInstant = parseFor(DateTimeType);
/** An instant written as East prints one, read by East's parser. */
function at(text: string): ValueTypeOf<typeof DateTimeType> {
  const read = readInstant(text);
  if (!read.success) throw new Error(`'${text}' is not an instant East reads`);
  return read.value;
}
/** The instant `ms` milliseconds from the epoch, made by East. */
const instant = East.compile(East.function([IntegerType], DateTimeType, (_$, ms) => East.DateTime.fromEpochMilliseconds(ms)), []);
/** An instant's milliseconds from the epoch, read by East. */
const millisecondsOf = East.compile(East.function([DateTimeType], IntegerType, (_$, t) => t.toEpochMilliseconds()), []);
/** An optional instant moved by `ms` milliseconds, by East; none stays none. */
const later = East.compile(East.function([OptionType(DateTimeType), IntegerType], OptionType(DateTimeType), ($, when, ms) => {
  const moved = $.let(none, OptionType(DateTimeType));
  $.match(when, {
    some: ($, t) => { $.assign(moved, some(East.DateTime.fromEpochMilliseconds(t.toEpochMilliseconds().add(ms)))); },
  });
  return moved;
}), []);

/** Monday 5 October 2026, which most jobs are scheduled around. */
const OCT_5 = millisecondsOf(at('2026-10-05T00:00:00.000'));

/** A runner selection, as the SDK's constructors take one. */
type RunnerConfig = Parameters<typeof e3.mutation.reduce>[3];

/**
 * The record, its patch door, and its series and summary indexes, on a runner:
 * a series a week by press, one a day led by the state, and one a month led by
 * a Set that fans out; a summary a week by press, beside the week's series, one
 * a quarter led by the Set, and one a year.
 */
function declared(runner?: RunnerConfig) {
  const jobs = e3.record('jobs', JobsType, new Map());
  return {
    jobs,
    patch: e3.mutation.patch(jobs, 'patch', runner),
    indexes: [
      e3.recordIndex.series('jobs_by_press_week', jobs, { key: 'press', from: 'start', to: 'end', tile: 'week' }, runner),
      e3.recordIndex.series('jobs_by_state_press_day', jobs, { on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'day' }, runner),
      e3.recordIndex.series('jobs_by_crew_press_month', jobs, { on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'month' }, runner),
      e3.recordIndex.summary('jobs_by_press_week_totals', jobs, { key: 'press', from: 'start', to: 'end', tile: 'week' }, runner),
      e3.recordIndex.summary('jobs_by_crew_press_quarter_totals', jobs, { on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'quarter' }, runner),
      e3.recordIndex.summary('jobs_by_press_year_totals', jobs, { key: 'press', from: 'start', to: 'end', tile: 'year' }, runner),
    ] as const,
  };
}

/** The indexes, in declaration order. */
const INDEXES = declared().indexes;

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

/** A job: on one of seven presses, crewed by none, one or two, and scheduled from `start` to `end`, or not yet. */
function job(n: number, start: bigint | undefined, end: bigint | undefined): Job {
  return {
    press: `P-${1001 + (n % 7)}`,
    crews: new SortedSet(n % 5 === 0 ? [] : n % 5 === 1 ? ['north'] : ['north', 'south'], keyOrder),
    state: n % 3 === 0 ? 'confirmed' : 'proposed',
    start: start === undefined ? none : some(instant(start)),
    end: end === undefined ? none : some(instant(end)),
    title: `Job ${n}`,
  };
}

/** The lengths the jobs are drawn from: each level's edges, and past a year. */
const LENGTHS = [
  0n, 8n * HOUR, 7n * DAY, 28n * DAY, 29n * DAY, 90n * DAY, 91n * DAY, 365n * DAY, 366n * DAY, 3n * 365n * DAY, 10n * 365n * DAY,
];
/** Instants on a level's tile edge: a Monday, a month's first, a quarter's, a year's, and the Monday before the epoch. */
const EDGES = [
  '2026-10-05T00:00:00.000', '2026-11-01T00:00:00.000', '2026-10-01T00:00:00.000', '2027-01-01T00:00:00.000', '1969-12-29T00:00:00.000',
].map((text) => millisecondsOf(at(text)));

/**
 * The jobs the test writes first: a thousand, an instant to ten years long —
 * each level's edges among the lengths — over the autumn, before 1970 one in
 * eight, from a level's tile edge one in nine; some instants, some ending
 * before they start, and some not yet scheduled.
 */
function seeded(): Jobs {
  const next = stream(1433);
  const rows = new SortedMap<string, Job>(undefined, keyOrder);
  for (let n = 0; n < 1_000; n++) {
    const jitter = BigInt(Math.floor(next() * 96)) * HOUR / 4n;
    const start = n % 9 === 0 ? EDGES[(n / 9) % EDGES.length]!
      : n % 8 === 0 ? OCT_5 - BigInt(Math.floor(57 * 365 + next() * 40 * 365)) * DAY + jitter
        : OCT_5 + BigInt(Math.floor((next() - 0.5) * 400)) * DAY + jitter;
    const length = LENGTHS[n % LENGTHS.length]!;
    const key = `W-${String(n).padStart(4, '0')}`;
    if (n % 37 === 0) rows.set(key, job(n, undefined, undefined));
    else if (n % 13 === 0) rows.set(key, job(n, start, undefined));
    else if (n % 17 === 0) rows.set(key, job(n, start, start - HOUR));
    else rows.set(key, job(n, start, start + length));
  }
  // Across the epoch and before it: a negative instant's tile is its floor.
  const epoch = [
    ['1969-12-31T20:00:00.000', '1970-01-01T04:00:00.000'], ['1969-12-29T00:00:00.000', '1970-01-05T00:00:00.000'],
    ['1969-06-30T23:00:00.000', '1969-07-01T01:00:00.000'], ['1968-02-28T12:00:00.000', '1968-03-01T12:00:00.000'],
    ['1969-12-31T23:59:59.999', '1970-01-01T00:00:00.001'], ['1959-10-01T00:00:00.000', '1960-01-01T00:00:00.000'],
  ];
  epoch.forEach(([from, to], i) => rows.set(`E-${i}`, job(i, millisecondsOf(at(from!)), millisecondsOf(at(to!)))));
  rows.set('E-instant', job(9, millisecondsOf(at('1969-12-31T23:00:00.000')), undefined));
  // From a tile's start to the next's exactly.
  rows.set('T-week', job(3, millisecondsOf(at('2026-10-12T00:00:00.000')), millisecondsOf(at('2026-10-19T00:00:00.000'))));
  rows.set('T-year', job(4, millisecondsOf(at('2026-12-31T23:00:00.000')), millisecondsOf(at('2027-01-01T01:00:00.000'))));
  return rows;
}

/**
 * The same jobs after another session's edits: some deleted, unscheduled,
 * nudged an hour, moved far, stretched past a level, shrunk back to an hour,
 * made instants, moved to another press, recrewed, or retitled and confirmed;
 * and some new ones, scheduled and not.
 */
function edited(rows: Jobs): Jobs {
  const next = new SortedMap<string, Job>([...rows], keyOrder);
  let n = 0;
  for (const [key, row] of rows) {
    n++;
    const moved = (by: bigint) => ({ start: later(row.start, by), end: later(row.end, by) });
    switch (n % 11) {
      case 1: next.delete(key); break;
      case 2: next.set(key, { ...row, start: none }); break;
      case 3: next.set(key, { ...row, ...moved(HOUR) }); break;
      case 4: next.set(key, { ...row, ...moved(45n * DAY) }); break;
      case 5: next.set(key, { ...row, end: later(row.end, 30n * DAY) }); break;
      case 6: next.set(key, { ...row, end: none }); break;
      case 7: next.set(key, { ...row, press: 'P-1009' }); break;
      case 8: next.set(key, { ...row, crews: new SortedSet(['east'], keyOrder) }); break;
      case 9: next.set(key, { ...row, title: `${row.title}, reprinted`, state: 'confirmed' }); break;
      case 10: next.set(key, { ...row, end: later(row.start, HOUR) }); break;
      default: break;
    }
  }
  for (let i = 0; i < 20; i++) {
    next.set(`X-${String(i).padStart(4, '0')}`, job(500 + i, i % 4 === 0 ? undefined : OCT_5 + BigInt(i) * 2n * DAY, OCT_5 + BigInt(i) * 3n * DAY));
  }
  return next;
}

describe('the series and summary indexes on the real runners', () => {
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
      const { jobs, patch, indexes } = declared(runner);
      const pkg = e3.package(`series-${ws}`, '1.0.0', jobs, patch, ...indexes);
      const zip = join(tempDir, `series-${ws}.zip`);
      await e3.export(pkg, zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, ws);
      await workspaceDeploy(storage, repo, ws, `series-${ws}`, '1.0.0', { runner: realRunner });
    }
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** The record's state in a workspace: its primary, and each index's manifest. */
  async function state(ws: string): Promise<{ primary: string; indexes: Record<string, string> }> {
    const ref = await storage.datasets.read(repo, ws, 'records/jobs');
    assert.ok(ref && ref.type === 'value');
    const held = await readRecordState(storage, repo, ref.value.hash);
    return { primary: held.primary, indexes: Object.fromEntries(INDEXES.map((index) => [index.name, held.indexes.get(index.name)!.manifest])) };
  }

  /** Writes `next` through a workspace's patch door, from `before`. */
  async function write(ws: string, before: Jobs, next: Jobs): Promise<void> {
    const patch = diffFor(JobsType)(before, next);
    const outcome = await recordMutate(storage, realRunner, repo, ws, 'jobs', 'patch',
      [encodeBeast2For(PatchType(JobsType))(patch)], { actor: 'cli:test' });
    assert.strictEqual(outcome.kind, 'committed', `${ws}: ${JSON.stringify(outcome)}`);
  }

  /** Every entry of a series index in a workspace, decoded by its declared types. */
  async function seriesEntries<I extends (typeof INDEXES)[number]>(ws: string, index: I) {
    const held = await state(ws);
    const collection = DictType(StructType({ ik: index.keyType, k: StringType }), JobRow);
    return decodeBeast2For(collection)(await readDatasetWhole(storage, repo, held.indexes[index.name]!));
  }

  /** Every total of a summary index in a workspace, decoded by its declared types. */
  async function summaryTotals<I extends (typeof INDEXES)[number]>(ws: string, index: I) {
    const held = await state(ws);
    const collection = DictType(StructType({ ik: index.keyType, k: NullType }), RecordSummaryTotalsType);
    return decodeBeast2For(collection)(await readDatasetWhole(storage, repo, held.indexes[index.name]!));
  }

  /** How many executions the repository holds: a build fanned out runs several. */
  async function countExecutions(): Promise<number> {
    let total = 0;
    for (const { taskHash, inputsHash } of await storage.refs.executionList(repo)) {
      total += (await storage.refs.executionListIds(repo, taskHash, inputsHash)).length;
    }
    return total;
  }

  const [byPressWeek, , , weekTotals, , yearTotals] = INDEXES;

  it('files each job once, at the level its length fits — past a year, once a year it touches — carrying it whole, and totals cover every job\'s length, on each runtime', async () => {
    const rows = seeded();
    // Each job's length; one with no end, or one at or before its start, covers none.
    let covered = 0n;
    // How many places each scheduled job is filed: once, or once a year it touches past 365 days.
    const places = new SortedMap<string, number>(undefined, keyOrder);
    const yearOf = (ms: bigint) => new Date(Number(ms)).getUTCFullYear();
    for (const [key, row] of rows) {
      if (row.start.type === 'none') continue;
      const from = millisecondsOf(row.start.value);
      const to = row.end.type === 'none' ? from : millisecondsOf(row.end.value);
      if (to > from) covered += to - from;
      places.set(key, to - from > 365n * DAY ? yearOf(to - 1n) - yearOf(from) + 1 : 1);
    }
    for (const { ws } of runtimes) {
      await write(ws, new SortedMap<string, Job>(undefined, keyOrder), rows);
      const filed = new SortedMap<string, number>(undefined, keyOrder);
      for (const [entry, row] of await seriesEntries(ws, byPressWeek)) {
        const written = rows.get(entry.k);
        assert.ok(written !== undefined && sameJob(row, written), `${ws}: ${entry.k}'s entry carries its row`);
        filed.set(entry.k, (filed.get(entry.k) ?? 0) + 1);
      }
      assert.deepStrictEqual([...filed], [...places], `${ws}: each job with a start filed once, or once a year past a year`);
      let years = 0n;
      for (const total of (await summaryTotals(ws, yearTotals)).values()) years += total.ms;
      assert.ok(sameInteger(years, covered), `${ws}: the years' totals cover every job's length, ${years} ms of ${covered}`);
      let weeks = 0n;
      for (const total of (await summaryTotals(ws, weekTotals)).values()) weeks += total.ms;
      assert.ok(sameInteger(weeks, covered), `${ws}: and the weeks' totals the same`);
    }
  });

  it('says what a write changed in each index — a summary\'s arm as totals added to — as e3 history --delta prints it', async () => {
    const { ws } = runtimes[0]!;
    const rows = seeded();
    await write(ws, new SortedMap<string, Job>(undefined, keyOrder), rows);
    const [head] = await recordHistory(storage, repo, ws, 'jobs', { limit: 1 });
    assert.ok(head !== undefined && head.commit.delta.type === 'some', 'the write names its delta');
    const arms = new Map((await summarizeDelta(storage, repo, head.commit.delta.value)).map((arm) => [arm.target, arm]));
    assert.strictEqual(arms.get('primary')?.insert, rows.size, 'a row inserted a job');
    for (const index of INDEXES) {
      const arm = arms.get(index.name);
      assert.ok(arm !== undefined, `the delta has ${index.name}'s arm`);
      if (index.summary !== undefined) {
        // From no totals, each one the write leaves is one change added.
        assert.deepStrictEqual([arm.insert, arm.update, arm.delete, arm.add], [0, 0, 0, (await summaryTotals(ws, index)).size],
          `${index.name}'s arm adds to its totals, once a total`);
      } else {
        assert.deepStrictEqual([arm.insert, arm.update, arm.delete, arm.add], [(await seriesEntries(ws, index)).size, 0, 0, 0],
          `${index.name}'s arm inserts its entries`);
      }
    }
  });

  it('maintains each index as a reindex rebuilds it, hash for hash, on each runtime', async () => {
    const first = seeded();
    const second = edited(first);
    for (const { ws } of runtimes) {
      await write(ws, new SortedMap<string, Job>(undefined, keyOrder), first);
      await write(ws, first, second);
      const maintained = await state(ws);
      const rebuilt = await recordReindex(storage, realRunner, repo, ws, 'jobs', { actor: 'cli:test' });
      assert.strictEqual(rebuilt.kind, 'committed', `${ws}: ${JSON.stringify(rebuilt)}`);
      assert.deepStrictEqual(await state(ws), maintained, `${ws}: maintained ≡ rebuilt`);
    }
  });

  it('builds the indexes split into pieces as one unit builds them — a summary\'s pieces summed — hash for hash, on each runtime', async () => {
    // Enough jobs to span segments, cut into pieces small enough that a press's
    // week is in several: the merge adds their totals.
    const next = stream(6000);
    const rows = new SortedMap<string, Job>(undefined, keyOrder);
    for (let n = 0; n < 6_000; n++) {
      const start = OCT_5 + BigInt(Math.floor((next() - 0.5) * 120)) * DAY + BigInt(Math.floor(next() * 24)) * HOUR;
      rows.set(`B-${String(n).padStart(5, '0')}`, job(n, start, start + HOUR + BigInt(Math.floor(next() * 72)) * HOUR));
    }
    for (const { ws } of runtimes) {
      await write(ws, new SortedMap<string, Job>(undefined, keyOrder), rows);
      const maintained = await state(ws);
      const before = await countExecutions();
      const rebuilt = await withEnv({ E3_TEST_PIECE_BYTES: String(32 * 1024) }, () =>
        recordReindex(storage, realRunner, repo, ws, 'jobs', { actor: 'cli:test' }));
      assert.strictEqual(rebuilt.kind, 'committed', `${ws}: ${JSON.stringify(rebuilt)}`);
      assert.ok(await countExecutions() >= before + 2, `${ws}: the build really did fan out`);
      assert.deepStrictEqual(await state(ws), maintained, `${ws}: the pieces summed ≡ the totals the writes kept`);
    }
  });

  it('refuses a job touching more than 4,096 of a summary\'s weeks, naming it, its span and the tile, and writes nothing, on each runtime', async () => {
    // Eighty years: a series files it under each year, and the week summary's tiles run out.
    const noon = millisecondsOf(at('2026-01-01T12:00:00.000'));
    const long = new SortedMap<string, Job>([['X-long', job(1, noon, noon + 80n * 365n * DAY)]], keyOrder);
    for (const { ws } of runtimes) {
      const before = await state(ws);
      const outcome = await recordMutate(storage, realRunner, repo, ws, 'jobs', 'patch',
        [encodeBeast2For(PatchType(JobsType))(diffFor(JobsType)(new SortedMap<string, Job>(undefined, keyOrder), long))], { actor: 'cli:test' });
      assert.ok(outcome.kind === 'failed', `${ws}: ${JSON.stringify(outcome)}`);
      assert.match(outcome.stderr,
        /"X-long", from 2026-01-01T12:00:00\.000 to 2105-12-13T12:00:00\.000, touches more than 4096 week tiles: declare a coarser tile/,
        `${ws}: the refusal names the job, its span and the tile`);
      assert.deepStrictEqual(await state(ws), before, `${ws}: nothing is written`);
    }
  });

  it('files a job across 4,096 years under each, and refuses one across more, naming it and its span, on each runtime', async () => {
    // A record with a series index alone: no summary's tiles run out first.
    const noon = millisecondsOf(at('2026-01-01T12:00:00.000'));
    const ages = (years: number) => millisecondsOf(at(`${2026 + years}-07-01T00:00:00.000`));
    for (const { ws, runner } of runtimes) {
      const jobs = e3.record('ages', JobsType, new Map());
      const patch = e3.mutation.patch(jobs, 'patch', runner);
      const byPressDay = e3.recordIndex.series('ages_by_press_day', jobs, { key: 'press', from: 'start', to: 'end', tile: 'day' }, runner);
      const zip = join(tempDir, `ages-${ws}.zip`);
      await e3.export(e3.package(`ages-${ws}`, '1.0.0', jobs, patch, byPressDay), zip);
      await packageImport(storage, repo, zip);
      await workspaceCreate(storage, repo, `${ws}-ages`);
      await workspaceDeploy(storage, repo, `${ws}-ages`, `ages-${ws}`, '1.0.0', { runner: realRunner });
      const empty = new SortedMap<string, Job>(undefined, keyOrder);
      const written = (rows: Jobs) => recordMutate(storage, realRunner, repo, `${ws}-ages`, 'ages', 'patch',
        [encodeBeast2For(PatchType(JobsType))(diffFor(JobsType)(empty, rows))], { actor: 'cli:test' });
      // From 2026 into 6121: 4,096 years, each filed.
      const most = await written(new SortedMap<string, Job>([['X-most', job(1, noon, ages(4_095))]], keyOrder));
      assert.strictEqual(most.kind, 'committed', `${ws}: ${JSON.stringify(most)}`);
      const refused = await written(new SortedMap<string, Job>([['X-ages', job(1, noon, ages(4_096))]], keyOrder));
      assert.ok(refused.kind === 'failed', `${ws}: ${JSON.stringify(refused)}`);
      assert.match(refused.stderr,
        /"X-ages", from 2026-01-01T12:00:00\.000 to 6122-07-01T00:00:00\.000, touches more than 4096 year tiles: end it within 4096 years of its start/,
        `${ws}: the refusal names the job and its span`);
    }
  });

  it('files every job under the same tiles, with the same totals, on every runtime, hash for hash', { skip: missing }, async () => {
    const first = seeded();
    const second = edited(first);
    const written: Array<{ ws: string; seeded: Awaited<ReturnType<typeof state>>; edited: Awaited<ReturnType<typeof state>> }> = [];
    for (const { ws } of runtimes) {
      await write(ws, new SortedMap<string, Job>(undefined, keyOrder), first);
      const afterSeed = await state(ws);
      await write(ws, first, second);
      written.push({ ws, seeded: afterSeed, edited: await state(ws) });
    }
    for (const seen of written.slice(1)) {
      assert.deepStrictEqual(seen.seeded, written[0]!.seeded, `${seen.ws} disagrees with ${written[0]!.ws} once the jobs are written`);
      assert.deepStrictEqual(seen.edited, written[0]!.edited, `${seen.ws} disagrees with ${written[0]!.ws} once they are edited`);
    }
  });
});
