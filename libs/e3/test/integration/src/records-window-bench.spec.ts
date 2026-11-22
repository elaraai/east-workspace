/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A window of a large record's events, read through its series index in two
 * orders — what a board of grouped rows asks of e3 each time its view rests.
 *
 * The record holds print jobs, each on a press that stands in a hall. Two
 * series indexes file the same jobs:
 *
 * - **by press** (`index.series({ key: 'press' })`): a press's jobs over any
 *   span are one range a level, so a view of a hundred presses is a hundred
 *   ranges a level, each in the part of the index that press's whole history
 *   lies in;
 * - **by hall** (`index.series({ key: 'hall' })`): a hall's jobs over a span
 *   are one range a level, across every press in it, so the same view is one
 *   range a level for each hall in view, and the jobs of a window lie together.
 *
 * Each read is the two requests a board makes: the searches, counted in one
 * request (`findKeys`), then the entries they select (`getRuns`), each entry
 * carrying its job whole. The spec holds the two orders to each other — the
 * jobs of the presses in view are the same jobs either way — and counts what
 * each asks. A third series index, by press again, carries of each job what a
 * tile draws and no more (`index.series(spec, { value })`, #1710): the same
 * entries, each a part of its job. A fourth index files those tiles in another
 * order — by hall, then the four weeks a job starts in, then press
 * (`index.key`) — so the jobs that start in a window on a run of neighbouring
 * presses lie together, whatever the presses' histories hold: the same view is
 * a range a hall a block of four weeks. A fifth files them in a grid's cells —
 * by hall, then ten presses, then the block — and the same view is every cell
 * it touches, read whole. The blocks are filed at four lengths — a day, a week,
 * four weeks and thirteen — and a screen at a resolution, a fortnight of days
 * or twelve weeks, is read through each. The series index itself takes that
 * order — `index.series({ on: ['hall'], …, order: 'time' })`, a tile's jobs
 * together in their presses' order — and the first view is read through it, a
 * range a hall a level a tile: the entries the index by press gives. Three summary indexes are read beside them, as a zoomed-out view
 * reads them: by press, a range a press; by press and task — a press's child
 * rows — a range a press a task; and by hall, a range a hall.
 *
 * Small scale runs in CI and checks those counts and that equality, never a
 * time. `E3_WINDOW_BENCH=1` runs it at a page's size — 40 halls, 3,000 presses
 * and 1,000,000 jobs over three years unless the environment says otherwise —
 * and prints, for each read, its searches, entries and bytes, the segments the
 * server decoded for it — the first time, and a read at the mean of five more,
 * which its kept segments serve where they hold them — and its wall time the
 * first time and at the median of those five:
 *
 *     E3_WINDOW_BENCH=1 node --test dist/records-window-bench.spec.js
 *
 * `E3_WINDOW_BENCH_HALLS`, `E3_WINDOW_BENCH_PRESSES` (a hall) and
 * `E3_WINDOW_BENCH_JOBS` set the sizes; `E3_WINDOW_BENCH_VIEW` how many
 * presses a view holds, a hall and a third of the next without it — fewer
 * than a hall's is a view inside one large hall; and `E3_WINDOW_BENCH_NOTES`
 * how many characters of text each job carries that no tile draws, none
 * without it at full scale: an index carries its job whole, unless it is given
 * a value. The repository is made under the
 * system's temporary directory (`TMPDIR`): at full scale it holds some
 * hundreds of megabytes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import e3 from '@elaraai/e3';
import { tileNext, tileStart } from '@elaraai/e3/internal';
import { datasetFindKeys, datasetGetRuns, datasetGetStatus, type DatasetKeySearch } from '@elaraai/e3-api-client';
import { createServer, type Server } from '@elaraai/e3-api-server';
import { decodedSegmentStats } from '@elaraai/e3-api-server/handlers';
import { RecordLevelType, RecordSummaryTotalsType } from '@elaraai/e3-types';
import {
  ArrayType, BooleanType, DateTimeType, DictType, East, IntegerType, NullType, OptionType, SortedSet, StringType, StructType, compareFor, decodeBeast2For,
  encodeBeast2PagedFor,
  equalFor, printFor, variant,
  type ValueTypeOf,
} from '@elaraai/east';
import { createTestDir, removeTestDir, runE3Command } from './helpers.js';

const full = process.env.E3_WINDOW_BENCH === '1';

/** A size: the environment's, or the full run's, or the suite's. */
function sizeOf(name: string, small: number, large: number): number {
  const given = process.env[name];
  if (given === undefined) return full ? large : small;
  const size = Number(given);
  assert.ok(Number.isInteger(size) && size > 0, `${name} is a whole number of 1 or more, not ${given}`);
  return size;
}

const HALLS = sizeOf('E3_WINDOW_BENCH_HALLS', 4, 40);
const PRESSES_A_HALL = sizeOf('E3_WINDOW_BENCH_PRESSES', 12, 75);
const JOBS = sizeOf('E3_WINDOW_BENCH_JOBS', 6_000, 1_000_000);
const PRESSES = HALLS * PRESSES_A_HALL;
/** How many presses a view holds, from the first press of the middle hall: a hall and a third of the next, or the environment's. */
const VIEW = sizeOf('E3_WINDOW_BENCH_VIEW', PRESSES_A_HALL + Math.ceil(PRESSES_A_HALL / 3), PRESSES_A_HALL + Math.ceil(PRESSES_A_HALL / 3));
/** The view's first press, and the halls its presses stand in. */
const VIEW_FIRST = Math.floor(HALLS / 2) * PRESSES_A_HALL;
assert.ok(VIEW_FIRST + VIEW <= PRESSES, `a view of ${VIEW} presses from the middle hall's first fits the works' ${PRESSES}`);
/** How many characters of text a job carries that no tile draws: the environment's, or none at full scale, and some in the suite. */
const NOTES = process.env.E3_WINDOW_BENCH_NOTES === undefined ? (full ? 0 : 120) : sizeOf('E3_WINDOW_BENCH_NOTES', 1, 1);

/** A print job: the hall and the press it runs on, its task, when it runs, and its notes, which no tile draws. */
const JobType = StructType({
  hall: StringType, press: StringType, task: StringType, title: StringType, start: DateTimeType, end: DateTimeType, notes: StringType,
});
const JobsType = DictType(StringType, JobType);
type Job = ValueTypeOf<typeof JobType>;

/** What a tile draws of a job: everything but its notes. */
const JobTileType = StructType({ hall: StringType, press: StringType, task: StringType, title: StringType, start: DateTimeType, end: DateTimeType });

const BY_PRESS = 'jobs_by_press';
const TILES_BY_PRESS = 'job_tiles_by_press';
const BY_HALL = 'jobs_by_hall';
/** The lengths of block the tiles are filed by, in days. */
const BLOCK_DAYS = [1, 7, 28, 91] as const;
/** The index that files the tiles by hall, then a block of `days`, then press. */
const blockIndex = (days: number): string => `job_tiles_by_hall_${days}d`;
const TILES_BY_BLOCK = blockIndex(28);
const TILES_BY_CELL = 'job_tiles_by_hall_cell';
const TILES_IN_TIME = 'job_tiles_by_hall_week';
const PRESS_WEEKS = 'jobs_press_weeks';
const TASK_WEEKS = 'jobs_press_task_weeks';
const HALL_WEEKS = 'jobs_hall_weeks';
/** The tasks a press's jobs are of: a press's child rows. */
const TASKS = 13;

/** A series index's key under no leading field: what a job is on, the level it is filed at and that level's tile. */
const SeriesKeyType = StructType({ on: StructType({}), key: StringType, level: RecordLevelType, tile: DateTimeType });
/** A window of a series index: each entry's key, its job's key and the job. */
const SeriesWindowType = ArrayType(StructType({ ik: SeriesKeyType, key: StringType, value: JobType, row: OptionType(JobType) }));
/** A window of the summary: a press and a week, and the totals of the jobs touching it. */
const TotalsWindowType = ArrayType(StructType({
  ik: StructType({ on: StructType({}), key: StringType, tile: DateTimeType }), key: NullType, value: RecordSummaryTotalsType, row: OptionType(JobType),
}));

/** A window of the series index that carries tiles: each entry's key, its job's key and the job's tile. */
const TilesWindowType = ArrayType(StructType({ ik: SeriesKeyType, key: StringType, value: JobTileType, row: OptionType(JobType) }));

/** The key of the index filed by hall, then the block of four weeks a job starts in, then press, then its start. */
const BlockKeyType = StructType({ hall: StringType, block: IntegerType, press: StringType, start: DateTimeType });
/** A window of that index: each entry's key, its job's key and the job's tile. */
const BlockWindowType = ArrayType(StructType({ ik: BlockKeyType, key: StringType, value: JobTileType, row: OptionType(JobType) }));
const decodeBlocks = decodeBeast2For(BlockWindowType);
/** The key of the index filed in a grid's cells: by hall, then the ten presses a job's press is one of, then the block it starts in. */
const CellKeyType = StructType({ hall: StringType, presses: StringType, block: IntegerType, press: StringType, start: DateTimeType });
const decodeCells = decodeBeast2For(ArrayType(StructType({ ik: CellKeyType, key: StringType, value: JobTileType, row: OptionType(JobType) })));
const printInteger = printFor(IntegerType);
const printBoolean = printFor(BooleanType);

const decodeSeries = decodeBeast2For(SeriesWindowType);
const decodeTiles = decodeBeast2For(TilesWindowType);
/** A window of the series index in time order: each entry's key — its hall, its level and tile, then its press — its job's key and the job's tile. */
const decodeInTime = decodeBeast2For(ArrayType(StructType({
  ik: StructType({ on: StructType({ hall: StringType }), level: RecordLevelType, tile: DateTimeType, key: StringType, past: BooleanType }),
  key: StringType, value: JobTileType, row: OptionType(JobType),
})));
const sameTile = equalFor(JobTileType);
const decodeTotals = decodeBeast2For(TotalsWindowType);
/** The jobs as a file a record is seeded from: written in segments, as a file of any size is. */
const encodeJobs = encodeBeast2PagedFor(JobsType);
const printString = printFor(StringType);
const printDateTime = printFor(DateTimeType);
const printLevel = printFor(RecordLevelType);
const stringOrder = compareFor(StringType);
const sameKeys = equalFor(ArrayType(StringType));

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** Where the jobs start: a Monday, so a week's tile starts a whole number of weeks from it. */
const FROM = Date.UTC(2024, 0, 1);
/** The jobs' span: three years of hours. */
const SPAN_HOURS = 3 * 365 * 24;

/** A number as text of a width, zero-padded, so keys order as their numbers do. */
const padded = (n: number, width: number): string => String(n).padStart(width, '0');
const hallKey = (hall: number): string => `H-${padded(hall, 3)}`;
const pressKey = (press: number): string => `P-${padded(Math.floor(press / PRESSES_A_HALL), 3)}-${padded(press % PRESSES_A_HALL, 3)}`;

/** A job's notes: {@link NOTES} characters, each job's its own. */
function notesOf(i: number): string {
  let out = '';
  for (let part = 0; out.length < NOTES; part++) out += `${((Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(part + 7, 40_503)) >>> 0).toString(36)} `;
  return out.slice(0, NOTES);
}

/**
 * The record's jobs: job `i` on press `i mod PRESSES`, a press's jobs spread
 * evenly over the span; most a few hours to a few days long, filed at the
 * week, one in ten 200 hours, filed at the month, and one in a hundred 1,000
 * hours, filed at the quarter.
 */
function jobs(): Map<string, Job> {
  const stride = Math.max(1, Math.floor(SPAN_HOURS / Math.ceil(JOBS / PRESSES)));
  const out = new Map<string, Job>();
  for (let i = 0; i < JOBS; i++) {
    const press = i % PRESSES;
    const hours = Math.floor(i / PRESSES) * stride + ((i * 7919) % stride);
    // By the press's own job number, so every press holds jobs of every length.
    const nth = Math.floor(i / PRESSES) + press;
    const length = nth % 100 === 0 ? 1_000 : nth % 10 === 0 ? 200 : 4 + (nth % 60);
    const start = FROM + hours * HOUR_MS;
    out.set(`j${padded(i, 8)}`, {
      hall: hallKey(Math.floor(press / PRESSES_A_HALL)), press: pressKey(press), task: `T-${padded(i % TASKS, 2)}`, title: `Job ${i}`,
      start: new Date(start), end: new Date(start + length * HOUR_MS), notes: notesOf(i),
    });
  }
  return out;
}

/** The levels a series index of week tiles files at. */
const LEVELS = ['week', 'month', 'quarter', 'year'] as const;
type Level = (typeof LEVELS)[number];

/** e3's own tiles, as its indexes file by them: the start of the tile holding an instant, and of the tile after one. */
const tileStartOf = East.compile(tileStart, []);
const tileNextOf = East.compile(tileNext, []);

/** The start of the level's tile `by` tiles on from the one starting at `start` — back, for a negative `by`. */
function tileStep(level: Level, start: number, by: number): number {
  const tile = variant(level, null);
  let at = new Date(start);
  // A tile back is the tile holding the millisecond before this one's start.
  for (let step = 0; step < Math.abs(by); step++) at = by > 0 ? tileNextOf(tile, at) : tileStartOf(tile, new Date(at.getTime() - 1));
  return at.getTime();
}

/** What a reader reads of a series over `[from, to)`: a run a level, from two tiles before the one holding `from` to the one after the tile holding its last instant. */
function levelRuns(from: number, to: number): Array<{ level: Level; from: number; to: number }> {
  return LEVELS.map((level) => {
    const tile = variant(level, null);
    return {
      level,
      from: tileStep(level, tileStartOf(tile, new Date(from)).getTime(), -2),
      to: tileStep(level, tileStartOf(tile, new Date(to - 1)).getTime(), 2),
    };
  });
}

/** A window's searches of a series index: a range a key a level. */
function seriesSearches(keys: readonly string[], from: number, to: number): DatasetKeySearch[] {
  return keys.flatMap((key) => levelRuns(from, to).map((run) => {
    const lead = [printString(key), printLevel(variant(run.level, null))];
    return { from: [...lead, printDateTime(new Date(run.from))], to: [...lead, printDateTime(new Date(run.to))] };
  }));
}

/**
 * A window's searches of a series index in time order, led by the hall: for
 * each hall, each tile of each level the window reads is one range, from the
 * first press in view there to the last.
 */
function inTimeSearches(runs: readonly HallRun[], from: number, to: number): DatasetKeySearch[] {
  const searches: DatasetKeySearch[] = [];
  for (const run of runs) {
    for (const level of levelRuns(from, to)) {
      for (let tile = level.from; tile < level.to; tile = tileStep(level.level, tile, 1)) {
        const lead = [printString(run.hall), printLevel(variant(level.level, null)), printDateTime(new Date(tile))];
        // Through the last press: `past` is false in every entry, so an end that gives it true is after the last press's entries.
        searches.push({ from: [...lead, printString(run.first)], to: [...lead, printString(run.last), printBoolean(true)] });
      }
    }
  }
  return searches;
}

/** A block of the index the views of eight weeks are read through: four weeks, counted from the epoch. */
const BLOCK_MS = 4 * WEEK_MS;
const BLOCK_MILLISECONDS = BigInt(BLOCK_MS);
/** How much of a press's key names the ten presses it is one of: all but its last digit. */
const PRESSES_OF_TEN = 8n;

/** The presses of a view that stand in one hall: the first and the last of them. */
interface HallRun {
  readonly hall: string;
  readonly first: string;
  last: string;
}

/** A view's presses, neighbours in their keys' order, hall by hall. */
function hallRuns(inView: readonly number[]): HallRun[] {
  const runs: HallRun[] = [];
  for (const press of inView) {
    const hall = hallKey(Math.floor(press / PRESSES_A_HALL));
    const run = runs[runs.length - 1];
    if (run !== undefined && run.hall === hall) run.last = pressKey(press);
    else runs.push({ hall, first: pressKey(press), last: pressKey(press) });
  }
  return runs;
}

/**
 * A window's searches of an index filed by hall, block and press: for each
 * hall, each block the window touches is one range, from the first press in
 * view there to the last.
 */
function blockSearches(runs: readonly HallRun[], from: number, to: number, blockMs = BLOCK_MS): DatasetKeySearch[] {
  const searches: DatasetKeySearch[] = [];
  for (const run of runs) {
    for (let block = Math.floor(from / blockMs); block <= Math.floor((to - 1) / blockMs); block++) {
      const lead = [printString(run.hall), printInteger(BigInt(block))];
      // `~` sorts after every character of a press's key: the bound is past the last press's entries, and before the next press's.
      searches.push({ from: [...lead, printString(run.first)], to: [...lead, printString(`${run.last}~`)] });
    }
  }
  return searches;
}

/** The view's window: eight weeks from the middle of the span. */
const WINDOW_FROM = FROM + 78 * WEEK_MS;
const WINDOW_TO = WINDOW_FROM + 8 * WEEK_MS;
/** A zoomed-out view's: two years of weeks. */
const WIDE_FROM = FROM + 26 * WEEK_MS;
const WIDE_TO = WIDE_FROM + 104 * WEEK_MS;

/** What one read asked and got. */
interface Read {
  readonly searches: number;
  readonly requests: number;
  readonly entries: number;
  readonly bytes: number;
  readonly ms: number;
  readonly windows: Uint8Array[];
}

describe('a window of a record\'s events, by press and by hall', { concurrency: false }, () => {
  let testDir: string;
  let server: Server;
  let baseUrl: string;
  let hash: string;
  const opts = { token: null };
  const path = [variant('field', 'records'), variant('field', 'jobs')];

  /** The searches counted in one request, then the entries they select, read on until every one is in hand. */
  const read = async (index: string, searches: DatasetKeySearch[]): Promise<Read> => {
    const base = [baseUrl, 'bench', 'ws', path] as const;
    const started = performance.now();
    const found = await datasetFindKeys(...base, { queries: searches, index, hash }, opts);
    let rest = found.results.filter((result) => result.count > 0)
      .map((result): [number, number] => [result.row, result.count]).sort((a, b) => a[0] - b[0]);
    const windows: Uint8Array[] = [];
    let requests = 1;
    let entries = 0;
    while (rest.length > 0) {
      const runs = await datasetGetRuns(...base, { runs: rest, hash, index }, opts);
      assert.ok(runs.count > 0, 'a read of runs answers some of their entries');
      requests += 1;
      entries += runs.count;
      windows.push(runs.data);
      let taken = runs.count;
      const next: [number, number][] = [];
      for (const [row, count] of rest) {
        if (taken >= count) { taken -= count; continue; }
        next.push([row + taken, count - taken]);
        taken = 0;
      }
      rest = next;
    }
    const ms = performance.now() - started;
    return { searches: searches.length, requests, entries, bytes: windows.reduce((sum, window) => sum + window.byteLength, 0), ms, windows };
  };

  /** A read's line of the table: the first time, then five more — their median time, and the segments decoded a read. */
  const measured = async (label: string, index: string, searches: DatasetKeySearch[]): Promise<Read> => {
    const before = decodedSegmentStats().decodes;
    const first = await read(index, searches);
    if (!full) return first;
    const cold = decodedSegmentStats().decodes - before;
    const times: number[] = [];
    for (let i = 0; i < 5; i++) times.push((await read(index, searches)).ms);
    times.sort((a, b) => a - b);
    const again = (decodedSegmentStats().decodes - before - cold) / 5;
    console.log(
      `${label.padEnd(46)} ${String(first.searches).padStart(5)} searches ${String(first.requests).padStart(3)} requests `
      + `${String(first.entries).padStart(7)} entries ${(first.bytes / 1024).toFixed(0).padStart(6)} KB `
      + `${String(cold).padStart(5)} segments decoded, ${first.ms.toFixed(0).padStart(5)} ms first; `
      + `${again.toFixed(0).padStart(4)} decoded, ${times[2]!.toFixed(0).padStart(5)} ms a read after`,
    );
    return first;
  };

  /** The keys of the jobs a read's windows hold, those on one of `presses` only, in order. */
  const jobsOn = (windows: readonly Uint8Array[], presses: ReadonlySet<string>): string[] => {
    const keys = new SortedSet<string>(undefined, stringOrder);
    for (const window of windows) {
      for (const entry of decodeSeries(window)) if (presses.has(entry.value.press)) keys.add(entry.key);
    }
    return [...keys];
  };

  before(async () => {
    testDir = createTestDir();
    const reposDir = join(testDir, 'repos');
    mkdirSync(reposDir, { recursive: true });
    const repoDir = join(reposDir, 'bench');
    const run = async (what: string, args: string[]): Promise<void> => {
      const started = performance.now();
      const done = await runE3Command(args, testDir);
      assert.equal(done.exitCode, 0, `${what} failed: ${done.stderr}`);
      if (full) console.log(`${what}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
    };

    // The record, with no first state of its own: it is seeded from a file, as a large record is.
    const record = e3.record('jobs', JobsType, {
      indexes: (index) => ({
        [BY_PRESS]: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
        [TILES_BY_PRESS]: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }, {
          value: East.function([StringType, JobType], JobTileType, (_$, _key, job) => ({
            hall: job.hall, press: job.press, task: job.task, title: job.title, start: job.start, end: job.end,
          })),
        }),
        [BY_HALL]: index.series({ key: 'hall', from: 'start', to: 'end', tile: 'week' }),
        [TILES_IN_TIME]: index.series({ on: ['hall'], key: 'press', from: 'start', to: 'end', tile: 'week', order: 'time' }, {
          value: East.function([StringType, JobType], JobTileType, (_$, _key, job) => ({
            hall: job.hall, press: job.press, task: job.task, title: job.title, start: job.start, end: job.end,
          })),
        }),
        ...Object.fromEntries(BLOCK_DAYS.map((days) => {
          const length = BigInt(days * DAY_MS);
          return [blockIndex(days), index.key(East.function([StringType, JobType], BlockKeyType, (_$, _key, job) => ({
            hall: job.hall, block: job.start.toEpochMilliseconds().divide(length), press: job.press, start: job.start,
          })), {
            value: East.function([StringType, JobType], JobTileType, (_$, _key, job) => ({
              hall: job.hall, press: job.press, task: job.task, title: job.title, start: job.start, end: job.end,
            })),
          })];
        })),
        [TILES_BY_CELL]: index.key(East.function([StringType, JobType], CellKeyType, (_$, _key, job) => ({
          hall: job.hall, presses: job.press.substring(0n, PRESSES_OF_TEN), block: job.start.toEpochMilliseconds().divide(BLOCK_MILLISECONDS),
          press: job.press, start: job.start,
        })), {
          value: East.function([StringType, JobType], JobTileType, (_$, _key, job) => ({
            hall: job.hall, press: job.press, task: job.task, title: job.title, start: job.start, end: job.end,
          })),
        }),
        [PRESS_WEEKS]: index.summary({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
        [TASK_WEEKS]: index.summary({ on: ['press'], key: 'task', from: 'start', to: 'end', tile: 'week' }),
        [HALL_WEEKS]: index.summary({ key: 'hall', from: 'start', to: 'end', tile: 'week' }),
      }),
      mutations: (mutation) => ({ patch: mutation.patch() }),
    });
    const zipPath = join(testDir, 'window-bench.zip');
    await e3.export(e3.package('window-bench', '1.0.0', record), zipPath);
    const seedPath = join(testDir, 'jobs.beast2');
    writeFileSync(seedPath, encodeJobs(jobs()));

    await run('repo create', ['repo', 'create', repoDir]);
    await run('package import', ['package', 'import', repoDir, zipPath]);
    await run('workspace create', ['workspace', 'create', repoDir, 'ws']);
    await run('workspace deploy', ['workspace', 'deploy', repoDir, 'ws', 'window-bench@1.0.0']);
    await run(`seed of ${JOBS} jobs`, ['seed', repoDir, 'jobs', seedPath, '-w', 'ws']);

    server = await createServer({ reposDir, port: 0, host: 'localhost' });
    await server.start();
    baseUrl = `http://localhost:${server.port}`;
    const status = await datasetGetStatus(baseUrl, 'bench', 'ws', path, opts);
    assert.ok(status.hash.type === 'some', 'the record holds a state');
    hash = status.hash.value;
  });

  after(async () => {
    await server?.stop();
    if (testDir !== undefined) removeTestDir(testDir);
  });

  it('reads the presses in view as a range a press a level, or as a range a hall a level: the same jobs either way', async () => {
    // The view's presses, neighbours in the presses' key order, and the halls they stand in.
    const inView = Array.from({ length: VIEW }, (_x, i) => pressKey(VIEW_FIRST + i));
    const lastHall = Math.floor((VIEW_FIRST + VIEW - 1) / PRESSES_A_HALL);
    const halls = Array.from({ length: lastHall - Math.floor(HALLS / 2) + 1 }, (_x, i) => hallKey(Math.floor(HALLS / 2) + i));
    const presses = new Set(inView);

    const byPress = await measured(`${VIEW} presses in view, a range a press a level`, BY_PRESS, seriesSearches(inView, WINDOW_FROM, WINDOW_TO));
    const byHall = await measured(`the same view, a range a hall a level (${halls.length})`, BY_HALL, seriesSearches(halls, WINDOW_FROM, WINDOW_TO));

    assert.equal(byPress.searches, inView.length * LEVELS.length);
    assert.equal(byHall.searches, halls.length * LEVELS.length);
    const onPresses = jobsOn(byPress.windows, presses);
    assert.ok(onPresses.length > 0, 'the view holds jobs');
    assert.ok(sameKeys(jobsOn(byHall.windows, presses), onPresses), 'the jobs of the presses in view are the same jobs through either index');
    // By hall the read holds those halls' every press: no more than their share of the works over the view's.
    assert.ok(byHall.entries >= byPress.entries);
    assert.ok(byHall.entries <= Math.ceil(byPress.entries * (halls.length * PRESSES_A_HALL) / inView.length * 1.5));

    // The same searches of the index that carries tiles: the same entries, each the tile of the job the other carries whole.
    const tiles = await measured('the same view by press, each entry a tile', TILES_BY_PRESS, seriesSearches(inView, WINDOW_FROM, WINDOW_TO));
    assert.equal(tiles.entries, byPress.entries);
    if (NOTES > 0) assert.ok(tiles.bytes < byPress.bytes, 'a tile is smaller than a job carrying its notes');
    const whole = byPress.windows.flatMap((window) => decodeSeries(window));
    const carried = tiles.windows.flatMap((window) => decodeTiles(window));
    for (const [i, entry] of carried.entries()) {
      const job = whole[i]!;
      assert.equal(entry.key, job.key, 'filed where its job is, in the same order');
      const { hall, press, task, title, start, end } = job.value;
      assert.ok(sameTile(entry.value, { hall, press, task, title, start, end }), `${entry.key}'s entry carries its tile`);
    }
  });

  it('reads the presses in view through the series index in time order, a range a hall a level a tile: the entries the index by press gives', async () => {
    const inView = Array.from({ length: VIEW }, (_x, i) => VIEW_FIRST + i);
    const runs = hallRuns(inView);
    const inTime = await measured(`the same view, a range a hall a level a tile (${runs.length})`, TILES_IN_TIME, inTimeSearches(runs, WINDOW_FROM, WINDOW_TO));
    const byPress = await read(TILES_BY_PRESS, seriesSearches(inView.map(pressKey), WINDOW_FROM, WINDOW_TO));
    // The same tiles of the same levels, so the same entries: each job on a press in view, once, its tile with it.
    assert.equal(inTime.entries, byPress.entries);
    const tiled = (windows: readonly Uint8Array[], decode: (window: Uint8Array) => readonly { key: string; value: ValueTypeOf<typeof JobTileType> }[]) =>
      new Map(windows.flatMap((window) => decode(window)).map((entry) => [entry.key, entry.value]));
    const held = tiled(inTime.windows, decodeInTime);
    const expected = tiled(byPress.windows, decodeTiles);
    assert.ok(sameKeys([...held.keys()].sort(stringOrder), [...expected.keys()].sort(stringOrder)), 'the jobs of the presses in view are the same jobs through either index');
    for (const [key, tile] of held) assert.ok(sameTile(tile, expected.get(key)!), `${key}'s entry carries its tile`);
    // A run of presses is one range a tile, where by press it is a range a press a level.
    assert.ok(inTime.searches < byPress.searches || VIEW < 20, `${inTime.searches} ranges in time order, ${byPress.searches} by press`);
  });

  it('reads the jobs that start in the window on the presses in view as a range a hall a block of four weeks', async () => {
    const inView = Array.from({ length: VIEW }, (_x, i) => VIEW_FIRST + i);
    const runs = hallRuns(inView);
    const presses = new Set(inView.map(pressKey));
    const starts = (ms: number): boolean => ms >= WINDOW_FROM && ms < WINDOW_TO;

    const byBlock = await measured(`the same view, a range a hall a block (${runs.length})`, TILES_BY_BLOCK, blockSearches(runs, WINDOW_FROM, WINDOW_TO));
    const held = byBlock.windows.flatMap((window) => decodeBlocks(window));
    assert.ok(held.every((entry) => presses.has(entry.value.press)), 'every entry read is a job on a press in view');
    const started = new SortedSet<string>(held.filter((entry) => starts(entry.value.start.getTime())).map((entry) => entry.key), stringOrder);

    // The same jobs as the series index by press holds: those of its entries that start in the window.
    const byPress = await read(TILES_BY_PRESS, seriesSearches([...presses], WINDOW_FROM, WINDOW_TO));
    const expected = new SortedSet<string>(
      byPress.windows.flatMap((window) => decodeTiles(window)).filter((entry) => starts(entry.value.start.getTime())).map((entry) => entry.key), stringOrder);
    assert.ok(expected.size > 0, 'jobs start in the window');
    assert.ok(sameKeys([...started], [...expected]), 'the jobs that start in the window are the same jobs through either index');
    // A block is four weeks, so a window of eight touches three at most: the read holds no more than the blocks' jobs.
    assert.ok(byBlock.searches <= runs.length * 3);
  });

  it('reads a view that lines up with no cell of a grid of ten presses by four weeks: a range a hall a block, or every cell it touches', async () => {
    // Five presses on from a hall's first, so the view starts and ends inside a cell.
    const shift = Math.min(5, PRESSES - VIEW_FIRST - VIEW);
    const inView = Array.from({ length: VIEW }, (_x, i) => VIEW_FIRST + shift + i);
    const presses = new Set(inView.map(pressKey));
    const runs = hallRuns(inView);
    const cells = new SortedSet<string>(undefined, stringOrder);
    for (const press of inView) cells.add(`${hallKey(Math.floor(press / PRESSES_A_HALL))} ${pressKey(press).slice(0, Number(PRESSES_OF_TEN))}`);
    const blocks: number[] = [];
    for (let block = Math.floor(WINDOW_FROM / BLOCK_MS); block <= Math.floor((WINDOW_TO - 1) / BLOCK_MS); block++) blocks.push(block);
    const cellSearches = [...cells].flatMap((cell) => blocks.map((block): DatasetKeySearch => {
      const [hall, tens] = cell.split(' ') as [string, string];
      return { from: [printString(hall), printString(tens), printInteger(BigInt(block))], to: [printString(hall), printString(tens), printInteger(BigInt(block + 1))] };
    }));

    const byBlock = await measured('a view off the grid, a range a hall a block', TILES_BY_BLOCK, blockSearches(runs, WINDOW_FROM, WINDOW_TO));
    const byCell = await measured(`the same view, every cell it touches (${cells.size} x ${blocks.length})`, TILES_BY_CELL, cellSearches);
    const starts = (ms: number): boolean => ms >= WINDOW_FROM && ms < WINDOW_TO;
    const inBlocks = new SortedSet<string>(
      byBlock.windows.flatMap((window) => decodeBlocks(window)).filter((entry) => starts(entry.value.start.getTime())).map((entry) => entry.key), stringOrder);
    const inCells = new SortedSet<string>(
      byCell.windows.flatMap((window) => decodeCells(window)).filter((entry) => presses.has(entry.value.press) && starts(entry.value.start.getTime()))
        .map((entry) => entry.key), stringOrder);
    assert.ok(inBlocks.size > 0, 'jobs start in the window');
    assert.ok(sameKeys([...inCells], [...inBlocks]), 'the jobs of the presses in view are the same jobs through either index');
    // A cell is read whole, so the cells hold the presses beside the view's too.
    assert.ok(byCell.entries >= byBlock.entries);
    assert.ok(byCell.searches >= byBlock.searches);
  });

  it('reads a screen at a resolution — a fortnight of days, twelve weeks — through blocks of each length: the same jobs', async () => {
    const runs = hallRuns(Array.from({ length: VIEW }, (_x, i) => VIEW_FIRST + i));
    // Each screen is of weeks no other read of this suite has touched, so a first read of it is of segments not yet kept.
    const screens = [
      { name: 'a fortnight', from: WINDOW_FROM + 20 * WEEK_MS, days: 14 },
      { name: 'twelve weeks', from: WINDOW_FROM + 40 * WEEK_MS, days: 84 },
    ];
    for (const screen of screens) {
      const to = screen.from + screen.days * DAY_MS;
      let expected: string[] | undefined;
      let fewest = Infinity;
      for (const days of BLOCK_DAYS) {
        const byBlock = await measured(`${screen.name}, blocks of ${days} d`, blockIndex(days), blockSearches(runs, screen.from, to, days * DAY_MS));
        const started = new SortedSet<string>(
          byBlock.windows.flatMap((window) => decodeBlocks(window))
            .filter((entry) => entry.value.start.getTime() >= screen.from && entry.value.start.getTime() < to).map((entry) => entry.key), stringOrder);
        expected ??= [...started];
        assert.ok(expected.length > 0, 'jobs start on the screen');
        assert.ok(sameKeys([...started], expected), `${screen.name}: the jobs that start on the screen are the same through blocks of ${days} days`);
        // A block no longer than the screen reads no more than the screen and a block either side of it.
        assert.ok(byBlock.entries >= expected.length);
        fewest = Math.min(fewest, byBlock.entries);
      }
      assert.equal(fewest, expected!.length, 'blocks of a day, which a screen of whole days is made of, read the screen\'s jobs and no other');
    }
  });

  it('reads presses scattered over the works — a board in another order than its keys\' — a range a press a level', async () => {
    // Every press a fixed step from the last, across every hall: by hall such a view would read every hall.
    const count = Math.min(PRESSES, 100);
    const step = Math.floor(PRESSES / count);
    const scattered = Array.from({ length: count }, (_x, i) => pressKey(i * step));
    const byPress = await measured('presses scattered over the works, by press', BY_PRESS, seriesSearches(scattered, WINDOW_FROM, WINDOW_TO));
    const everyHall = Array.from({ length: HALLS }, (_x, hall) => hallKey(hall));
    const byHall = await measured('the same view, every hall read, by hall', BY_HALL, seriesSearches(everyHall, WINDOW_FROM, WINDOW_TO));
    const presses = new Set(scattered);
    assert.ok(sameKeys(jobsOn(byHall.windows, presses), jobsOn(byPress.windows, presses)));
    assert.equal(byHall.searches, HALLS * LEVELS.length);
  });

  it('reads a zoomed-out view\'s totals: each press\'s weeks of two years, each of its tasks\', and each hall\'s', async () => {
    const inView = Array.from({ length: VIEW }, (_x, i) => pressKey(VIEW_FIRST + i));
    const searches = inView.map((press): DatasetKeySearch => ({
      from: [printString(press), printDateTime(new Date(WIDE_FROM))], to: [printString(press), printDateTime(new Date(WIDE_TO))],
    }));
    const totals = await measured('two years of week totals, a range a press', PRESS_WEEKS, searches);
    assert.equal(totals.searches, inView.length);
    const held = totals.windows.flatMap((window) => decodeTotals(window));
    assert.equal(held.length, totals.entries);
    assert.ok(held.every((entry) => entry.value.count > 0n), 'a total held counts a job at least');
    assert.ok(totals.entries <= inView.length * 104);

    // The presses' child rows: a range a press a task, the totals led by the press.
    const tasks = Array.from({ length: TASKS }, (_x, task) => `T-${padded(task, 2)}`);
    const byTask = inView.flatMap((press) => tasks.map((task): DatasetKeySearch => ({
      from: [printString(press), printString(task), printDateTime(new Date(WIDE_FROM))],
      to: [printString(press), printString(task), printDateTime(new Date(WIDE_TO))],
    })));
    const children = await measured('the same, a range a press a task', TASK_WEEKS, byTask);
    assert.equal(children.searches, inView.length * TASKS);
    assert.ok(children.entries >= totals.entries, 'a week a press touches, one of its tasks touches');

    // The halls' own rows: a range a hall, every hall of the works.
    const halls = Array.from({ length: HALLS }, (_x, hall): DatasetKeySearch => ({
      from: [printString(hallKey(hall)), printDateTime(new Date(WIDE_FROM))], to: [printString(hallKey(hall)), printDateTime(new Date(WIDE_TO))],
    }));
    const groups = await measured('every hall\'s week totals, a range a hall', HALL_WEEKS, halls);
    assert.equal(groups.searches, HALLS);
    assert.ok(groups.entries <= HALLS * 104);
  });
});
