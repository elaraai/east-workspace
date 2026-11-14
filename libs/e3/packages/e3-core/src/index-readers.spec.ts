/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A reader for each kind of index, inside a function (east-workspace#1618) —
 * on every runner, over a record large enough for each index to be stored in
 * many segments: each reader gives the rows a loop over the whole record
 * keeps by the plain test, and decodes only the segments its runs touch.
 *
 * What a read cost is the segments the runner's pager decoded of the input,
 * which its verbose account says — a count, never a clock.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import {
  BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
  decodeBeast2For, encodeBeast2For, none, parseFor, printFor, some, variant,
  type EastType, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import { RecordSummaryTotalsType, type ExecuteResult } from '@elaraai/e3-types';
import { DatasetSegments } from './dataset-open.js';
import { functionCallUnkept } from './execution/functionCallUnkept.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { packageImport } from './package-files.js';
import { readRecordState, recordMutate } from './records.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { createTempDir, createTestRepo, removeTempDir, removeTestRepo, stockRuntimesOnPath } from './test-helpers.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';

/** Print jobs: enough of them that each index over them is stored in many segments. */
const JOBS = 24_000n;
const PRESSES = 60n;
const HOUR = 3_600_000n;
const DAY = 24n * HOUR;

/** A job: its press and state, when it runs — or not yet — where it stands on the floor, and its parts' sheets. */
const JobType = StructType({
  press: StringType, state: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType),
  x: FloatType, y: FloatType, parts: DictType(StringType, IntegerType),
});
const JobsType = DictType(StringType, JobType);
const Keys = DictType(StringType, NullType);
const Parts = DictType(StringType, IntegerType);
const Totals = DictType(DateTimeType, RecordSummaryTotalsType);

const WS = 'main';
const LIMITS = { timeoutMs: 240_000, maxResultBytes: 4 * 1024 * 1024, maxLogBytes: 64 * 1024 };

const readInstant = parseFor(DateTimeType);
/** An instant written as East prints one, read by East's parser. */
function at(text: string): ValueTypeOf<typeof DateTimeType> {
  const read = readInstant(text);
  if (!read.success) throw new Error(`'${text}' is not an instant East reads`);
  return read.value;
}
/** The jobs are scheduled from here on, one starting every twenty minutes. */
const FIRST = at('2026-01-05T00:00:00.000');

const RUNTIMES = stockRuntimesOnPath();
const onRuntime = (name: string, runtime: string): string => `${name}_${runtime.replace('-', '_')}`;

/** An argument of a call, encoded by its type. */
const arg = <T extends EastType>(type: T, value: ValueTypeOf<T>): Uint8Array => encodeBeast2For(type)(value);

/** What a runner's verbose account says its pager decoded of an input:
 *  `input <i>: <decoded> of <segments> segments decoded`. */
function decodedOf(stderr: string, input: number): { decoded: number; segments: number } {
  const said = new RegExp(`input ${input}: (\\d+) of (\\d+) segments decoded`).exec(stderr);
  if (said === null) assert.fail(`the runner's account names no lazy read of input ${input}:\n${stderr}`);
  return { decoded: Number(said[1]), segments: Number(said[2]) };
}

describe('a reader for each kind of index, on every runner', { timeout: 900_000, concurrency: false }, () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;
  let runner: LocalTaskRunner;

  before(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    runner = new LocalTaskRunner(repo);

    const jobs = e3.record('jobs', JobsType, {
      initial: new Map(),
      indexes: (index) => ({
        by_press: index.on(['press']),
        in_time: index.interval({ from: 'start', to: 'end' }),
        press_weeks: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
        press_load: index.summary({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
        by_area: index.area({ x: 'x', y: 'y', cell: 0.25 }),
        by_part: index.entries('parts'),
      }),
      mutations: (mutation) => ({
        // The jobs, made where the data is. Job i is on press i mod 60 and starts twenty minutes after the one
        // before it; one in fifty has no start yet and one has no end; most run an hour to nine, one in four hundred
        // forty days and one in four thousand four hundred; and each stands at its own point of a floor.
        seed: mutation.reduce(East.function([JobsType, DateTimeType], JobsType, ($, _state, first) => {
          const rows = $.let(new Map(), JobsType);
          $.for(East.Array.range(0n, JOBS), ($, i) => {
            const starts = $.const(East.DateTime.fromEpochMilliseconds(first.toEpochMilliseconds().add(i.multiply(HOUR / 3n))));
            const hours = $.const(i.remainder(4000n).equal(11n).ifElse(() => 9600n, () => i.remainder(400n).equal(7n).ifElse(() => 960n, () => i.remainder(9n).add(1n))));
            const parts = $.let(new Map([['cover', 500n]]), Parts);
            $.if(i.remainder(3n).equal(0n), ($) => { $(parts.insert('body', i.remainder(7n).add(1n).multiply(1000n))); });
            $.if(i.remainder(5n).equal(0n), ($) => { $(parts.insert('insert', i.remainder(11n).add(1n).multiply(100n))); });
            $(rows.insert(East.str`j${i.add(100_000n)}`, {
              press: East.str`P${i.remainder(PRESSES).add(100n)}`,
              state: i.remainder(2n).equal(0n).ifElse(() => 'confirmed', () => 'proposed'),
              start: i.remainder(50n).equal(49n).ifElse(() => none, () => some(starts)),
              end: i.remainder(50n).equal(48n).ifElse(() => none, () => some(East.DateTime.fromEpochMilliseconds(starts.toEpochMilliseconds().add(hours.multiply(HOUR))))),
              x: i.remainder(200n).toFloat().multiply(0.5),
              y: i.divide(200n).toFloat().multiply(0.5),
              parts,
            }));
          });
          return rows;
        })),
      }),
    });

    // ── The plain test: a loop over the whole record, or over the whole of a summary ──────────────────────────────

    const overlaps = East.function([JobType, DateTimeType, DateTimeType], BooleanType, ($, job, from, to) => {
      $.match(job.start, {
        some: ($, start) => {
          const end = $.let(job.end.unwrap('some', () => start));
          $.if(East.lessEqual(end, start), ($) => { $.return(East.greaterEqual(start, from).and(() => East.less(start, to))); });
          $.return(East.less(start, to).and(() => East.greater(end, from)));
        },
      });
      return false;
    });
    const plain = [
      e3.function('plain_of', { inputs: [jobs], args: [StringType], output: Keys }, ($, rows, press) => {
        const kept = $.let(new Map(), Keys);
        $.for(rows, ($, job, key) => { $.if(East.equal(job.press, press), ($) => { $(kept.insert(key, null)); }); });
        return kept;
      }),
      e3.function('plain_between', { inputs: [jobs], args: [StringType, StringType], output: Keys }, ($, rows, from, to) => {
        const kept = $.let(new Map(), Keys);
        $.for(rows, ($, job, key) => {
          $.if(East.greaterEqual(job.press, from).and(() => East.less(job.press, to)), ($) => { $(kept.insert(key, null)); });
        });
        return kept;
      }),
      e3.function('plain_overlapping', { inputs: [jobs], args: [DateTimeType, DateTimeType], output: Keys }, ($, rows, from, to) => {
        const inWindow = $.const(overlaps);
        const kept = $.let(new Map(), Keys);
        $.for(rows, ($, job, key) => { $.if(East.less(from, to).and(() => inWindow(job, from, to)), ($) => { $(kept.insert(key, null)); }); });
        return kept;
      }),
      e3.function('plain_unset', { inputs: [jobs], args: [], output: Keys }, ($, rows) => {
        const kept = $.let(new Map(), Keys);
        $.for(rows, ($, job, key) => { $.if(job.start.hasTag('none'), ($) => { $(kept.insert(key, null)); }); });
        return kept;
      }),
      e3.function('plain_events', { inputs: [jobs], args: [StringType, DateTimeType, DateTimeType], output: Keys }, ($, rows, press, from, to) => {
        const inWindow = $.const(overlaps);
        const kept = $.let(new Map(), Keys);
        $.for(rows, ($, job, key) => {
          $.if(East.equal(job.press, press).and(() => East.less(from, to)).and(() => inWindow(job, from, to)), ($) => { $(kept.insert(key, null)); });
        });
        return kept;
      }),
      e3.function('plain_within', { inputs: [jobs], args: [FloatType, FloatType, FloatType, FloatType], output: Keys }, ($, rows, x, y, width, height) => {
        const kept = $.let(new Map(), Keys);
        $.for(rows, ($, job, key) => {
          $.if(East.greaterEqual(job.x, x).and(() => East.lessEqual(job.x, x.add(width))).and(() => East.greaterEqual(job.y, y)).and(() => East.lessEqual(job.y, y.add(height))), ($) => {
            $(kept.insert(key, null));
          });
        });
        return kept;
      }),
      e3.function('plain_part', { inputs: [jobs], args: [StringType], output: Parts }, ($, rows, part) => {
        const kept = $.let(new Map(), Parts);
        $.for(rows, ($, job, key) => { $.if(job.parts.has(part), ($) => { $(kept.insert(key, job.parts.get(part))); }); });
        return kept;
      }),
      // A summary's totals of a key's tiles that overlap a window: a loop over every entry of the index.
      e3.function('plain_totals', { inputs: [e3.index(jobs.indexes.press_load)], args: [StringType, DateTimeType, DateTimeType], output: Totals }, ($, load, press, from, to) => {
        const kept = $.let(new Map(), Totals);
        const week = $.const(7n * DAY);
        $.for(load, ($, totals, entry) => {
          const tile = $.const(entry.ik.tile.toEpochMilliseconds());
          $.if(East.equal(entry.ik.key, press).and(() => East.less(from, to)).and(() => tile.less(to.toEpochMilliseconds()))
            .and(() => tile.add(week).greater(from.toEpochMilliseconds())), ($) => { $(kept.insert(entry.ik.tile, totals)); });
        });
        return kept;
      }),
    ];

    // ── The readers, the same on each runtime ────────────────────────────────────────────────────────────────────

    const byPress = e3.index(jobs.indexes.by_press);
    const inTime = e3.index(jobs.indexes.in_time);
    const pressWeeks = e3.index(jobs.indexes.press_weeks);
    const pressLoad = e3.index(jobs.indexes.press_load);
    const byArea = e3.index(jobs.indexes.by_area);
    const byPart = e3.index(jobs.indexes.by_part);
    const readers = RUNTIMES.flatMap((runtime) => {
      const on = { runner: { runtime, platforms: [] as [] } };
      return [
        e3.function(onRuntime('of', runtime), { inputs: [byPress], args: [StringType], output: Keys, ...on }, ($, entries, press) => {
          const kept = $.let(new Map(), Keys);
          entries.of(press).each($, ($, _carried, key) => { $(kept.insert(key, null)); });
          return kept;
        }),
        // Beside an entries index, an index that carries nothing carries the lean row: the keys alone are kept
        e3.function(onRuntime('between', runtime), { inputs: [byPress], args: [StringType, StringType], output: Keys, ...on }, ($, entries, from, to) => {
          const kept = $.let(new Map(), Keys);
          entries.between({ from, to }).each($, ($, _carried, key) => { $(kept.insert(key, null)); });
          return kept;
        }),
        e3.function(onRuntime('overlapping', runtime), { inputs: [inTime], args: [DateTimeType, DateTimeType], output: Keys, ...on }, ($, entries, from, to) => {
          const kept = $.let(new Map(), Keys);
          entries.overlapping({ from, to }).each($, ($, _carried, key) => { $(kept.insert(key, null)); });
          return kept;
        }),
        e3.function(onRuntime('unset', runtime), { inputs: [inTime], args: [], output: Keys, ...on }, ($, entries) => {
          const kept = $.let(new Map(), Keys);
          entries.unset().each($, ($, _carried, key) => { $(kept.insert(key, null)); });
          return kept;
        }),
        e3.function(onRuntime('events', runtime), { inputs: [pressWeeks], args: [StringType, DateTimeType, DateTimeType], output: Keys, ...on }, ($, entries, press, from, to) => {
          const kept = $.let(new Map(), Keys);
          entries.events({ key: press, from, to }).each($, ($, _job, key) => { $(kept.insert(key, null)); });
          return kept;
        }),
        e3.function(onRuntime('totals', runtime), { inputs: [pressLoad], args: [StringType, DateTimeType, DateTimeType], output: Totals, ...on }, ($, entries, press, from, to) =>
          entries.totals({ key: press, from, to }).collect($)),
        e3.function(onRuntime('within', runtime), { inputs: [byArea], args: [FloatType, FloatType, FloatType, FloatType], output: Keys, ...on }, ($, entries, x, y, width, height) => {
          const kept = $.let(new Map(), Keys);
          entries.within({ x, y, width, height }).each($, ($, _job, key) => { $(kept.insert(key, null)); });
          return kept;
        }),
        e3.function(onRuntime('part', runtime), { inputs: [byPart], args: [StringType], output: Parts, ...on }, ($, entries, part) =>
          entries.of(part).collect($)),
      ];
    });

    const zip = join(tempDir, 'pressroom.zip');
    await e3.export(e3.package('pressroom', '1.0.0', ...plain, ...readers), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, WS);
    await workspaceDeploy(storage, repo, WS, 'pressroom', '1.0.0', { runner });
    const seeded = await recordMutate(storage, runner, repo, WS, 'jobs', 'seed', [arg(DateTimeType, FIRST)], { actor: 'ada@example.com' });
    assert.equal(seeded.kind, 'committed', JSON.stringify(seeded));
  });

  /** What each read decoded, a line a read: printed when `E3_INDEX_READERS_COUNTS` is set, and asserted either way. */
  const counted: string[] = [];

  after(() => {
    if (process.env.E3_INDEX_READERS_COUNTS !== undefined) console.log(counted.join('\n'));
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** How many segments the state of `jobs` holds an index in. */
  async function segmentsOf(index: string): Promise<number> {
    const ref = await storage.datasets.read(repo, WS, 'records/jobs');
    if (ref?.type !== 'value') assert.fail('jobs holds a state');
    const held = (await readRecordState(storage, repo, ref.value.hash)).indexes.get(index);
    assert.ok(held !== undefined, `the state names ${index}`);
    return (await DatasetSegments.open(storage, repo, held.manifest)).segmentCount;
  }

  /** A call no store keeps, of a function of the package, through the workspace: its value's bytes, and its log. */
  async function call(fn: string, args: Uint8Array[], verbose = false): Promise<{ value: Uint8Array; stderr: string }> {
    const result: ExecuteResult = await functionCallUnkept(storage, runner, repo, WS, fn,
      { args: args.map((value) => variant('value', value)), drafts: [] }, { limits: LIMITS, verbose });
    if (result.outcome.type !== 'success') assert.fail(`${fn} ended ${result.outcome.type}:\n${result.stderr}`);
    return { value: result.outcome.value.value, stderr: result.stderr };
  }

  /**
   * Holds a reader, on every runtime, to the plain loop over the whole: the
   * same value, to the byte, and no more of the index decoded than `most`
   * segments, where the index is stored in at least `atLeast`.
   *
   * @remarks
   * As measured on the three runtimes, which decode alike: a key's rows 1 of
   * 20, an interval's week 12 of 61 and its hour 11, its backlog 1, a
   * series' week 2 of 20, a summary's four weeks 1 of 3, an area's room 4 of
   * 19, and the 4,800 entries of one part 5 of 33, the segments its one run
   * spans. The bounds leave a segment or two for a cut that lands otherwise.
   */
  async function held<T extends EastType>(reader: string, plain: string, index: string, type: T, args: Uint8Array[], most: number, atLeast: number): Promise<ValueTypeOf<T>> {
    const expected = await call(plain, args);
    const stored = await segmentsOf(index);
    assert.ok(stored >= atLeast, `${index} is stored in at least ${atLeast} segments, not ${stored}`);
    const print = printFor(type);
    const decode = decodeBeast2For(type);
    for (const runtime of RUNTIMES) {
      const read = await call(onRuntime(reader, runtime), args, true);
      assert.deepEqual(read.value, expected.value, `${runtime} ${reader} gives what the loop over the whole keeps: ${print(decode(read.value))}, not ${print(decode(expected.value))}`);
      const { decoded, segments } = decodedOf(read.stderr, 0);
      counted.push(`${runtime} ${reader}: ${decoded} of ${segments} segments of ${index}`);
      assert.equal(segments, stored, `${runtime} was handed ${index}'s own segments`);
      assert.ok(decoded <= most, `${runtime} ${reader} decodes the segments its runs touch, at most ${most} of ${segments}: it decoded ${decoded}`);
    }
    return decode(expected.value);
  }

  const week = { from: at('2026-06-08T00:00:00.000'), to: at('2026-06-15T00:00:00.000') };

  it('a plain index: of, the rows under a key, and between, the rows from one key up to another', async () => {
    const on = await held('of', 'plain_of', 'by_press', Keys, [arg(StringType, 'P117')], 2, 16);
    assert.equal(on.size, Number(JOBS / PRESSES));
    const range = await held('between', 'plain_between', 'by_press', Keys, [arg(StringType, 'P117'), arg(StringType, 'P119')], 3, 16);
    assert.equal(range.size, 2 * Number(JOBS / PRESSES));
  });

  it('an interval index: overlapping, the rows that overlap a window, and unset, those with no start', async () => {
    const inWeek = await held('overlapping', 'plain_overlapping', 'in_time', Keys, [arg(DateTimeType, week.from), arg(DateTimeType, week.to)], 14, 48);
    assert.ok(inWeek.size > 500, `a week of jobs every twenty minutes, and those that reach into it: ${inWeek.size}`);
    // An hour in the night: the few jobs that run through it
    const hour = await held('overlapping', 'plain_overlapping', 'in_time', Keys,
      [arg(DateTimeType, at('2026-06-10T03:00:00.000')), arg(DateTimeType, at('2026-06-10T04:00:00.000'))], 14, 48);
    assert.ok(hour.size > 5 && hour.size < 60, `the jobs running in one hour: ${hour.size}`);
    const backlog = await held('unset', 'plain_unset', 'in_time', Keys, [], 2, 48);
    assert.equal(backlog.size, Number(JOBS / 50n));
  });

  it('a series index: events, a key\'s events that overlap a window, a run a level', async () => {
    const onPress = await held('events', 'plain_events', 'press_weeks', Keys, [arg(StringType, 'P117'), arg(DateTimeType, week.from), arg(DateTimeType, week.to)], 4, 16);
    assert.ok(onPress.size >= 8, `a week of one press's jobs: ${onPress.size}`);
    // Past a year: the press's job that runs four hundred days is filed under both years, and given once
    const years = await held('events', 'plain_events', 'press_weeks', Keys,
      [arg(StringType, 'P111'), arg(DateTimeType, at('2026-12-28T00:00:00.000')), arg(DateTimeType, at('2027-01-04T00:00:00.000'))], 4, 16);
    assert.ok(years.has('j100011'), 'the job of four hundred days reaches across the year\'s turn');
  });

  it('a summary index: totals, each tile of a key that overlaps a window', async () => {
    const load = await held('totals', 'plain_totals', 'press_load', Totals,
      [arg(StringType, 'P117'), arg(DateTimeType, at('2026-06-10T00:00:00.000')), arg(DateTimeType, at('2026-07-08T00:00:00.000'))], 2, 2);
    assert.equal(load.size, 5, 'four weeks from a Wednesday touch five weeks');
  });

  it('an area index: within, the rows whose point is in a window', async () => {
    const room = await held('within', 'plain_within', 'by_area', Keys, [arg(FloatType, 20), arg(FloatType, 10), arg(FloatType, 5), arg(FloatType, 4)], 6, 16);
    assert.equal(room.size, 11 * 9, 'a point every half metre, the edges included');
  });

  it('an entries index: of, a key\'s entry on every row that holds one', async () => {
    const inserts = await held('part', 'plain_part', 'by_part', Parts, [arg(StringType, 'insert')], 6, 24);
    assert.equal(inserts.size, Number(JOBS / 5n));
  });
});
