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
  decodeBeast2For, encodeBeast2For, none, printFor, some, variant,
  type EastType, type ValueTypeOf,
} from '@elaraai/east';
import e3 from '@elaraai/e3';
import { NestedIdType, NestedPathType, RecordNestedTotalsType, RecordSummaryTotalsType, type ExecuteResult } from '@elaraai/e3-types';
import { DatasetSegments } from './dataset-open.js';
import { functionCallUnkept } from './execution/functionCallUnkept.js';
import { LocalTaskRunner } from './execution/LocalTaskRunner.js';
import { packageImport } from './package-files.js';
import { readRecordState, recordMutate } from './records.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';
import { at, createTempDir, createTestRepo, decodedOf, onRuntime, removeTempDir, removeTestRepo, stockRuntimesOnPath } from './test-helpers.js';
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

/** Press lines, each with its units, and each unit with its own jobs and the sheets it counted, a value a day. */
const LINES = 40n;
const UNITS = 4n;
const UNIT_JOBS = 60n;
const UNIT_DAYS = 120n;
const SheetsType = DictType(DateTimeType, FloatType);
const UnitType = StructType({ jobs: JobsType, sheets: SheetsType });
const UnitsType = DictType(StringType, UnitType);
const LineType = StructType({ name: StringType, units: UnitsType });
const LinesType = DictType(StringType, LineType);
/** The lines' index's ids (#1540): a unit's key under `units`, a job's id under `units.jobs`, each in its own type. */
const LineIds = NestedIdType({ units: StringType, 'units.jobs': StringType });
/** The units' keys from a line down to a node, as the index's key holds them. */
const LinePath = NestedPathType(LineIds);
/** A job beneath a line, as its subtree's read names it: the units' keys down to the unit holding it, and its id. */
const Beneath = DictType(StructType({ path: LinePath, id: LineIds }), NullType);
const MonthTotals = DictType(DateTimeType, RecordNestedTotalsType);

const WS = 'main';
const LIMITS = { timeoutMs: 240_000, maxResultBytes: 4 * 1024 * 1024, maxLogBytes: 64 * 1024 };

/** The jobs are scheduled from here on, one starting every twenty minutes. */
const FIRST = at('2026-01-05T00:00:00.000');

const RUNTIMES = stockRuntimesOnPath();

/** An argument of a call, encoded by its type. */
const arg = <T extends EastType>(type: T, value: ValueTypeOf<T>): Uint8Array => encodeBeast2For(type)(value);

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
        // With no key, the record's totals a week under each state (#1732).
        state_load: index.summary({ on: ['state'], from: 'start', to: 'end', tile: 'week' }),
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

    const lines = e3.record('lines', LinesType, {
      initial: new Map(),
      indexes: (index) => ({
        lines_in_time: index.nested({
          collections: {
            units: index.nested.rows({
              jobs: index.nested.items({ from: 'start', to: 'end' }, { rollup: true }),
              sheets: index.nested.values({ rollup: 'sum' }),
            }),
          },
          tile: 'week',
          summary: 'month',
        }),
      }),
      mutations: (mutation) => ({
        // The lines, made where the data is. Each unit runs a job every two days, most an hour to nine, one in thirty
        // forty days and one in three hundred four hundred; one in twenty has no start yet and one no end; and it
        // counts its sheets at six each morning, in quarters of a thousand, so a sum is exact however it is added.
        seed: mutation.reduce(East.function([LinesType, DateTimeType], LinesType, ($, _state, first) => {
          const rows = $.let(new Map(), LinesType);
          $.for(East.Array.range(0n, LINES), ($, line) => {
            const units = $.let(new Map(), UnitsType);
            $.for(East.Array.range(0n, UNITS), ($, unit) => {
              const jobs = $.let(new Map(), JobsType);
              $.for(East.Array.range(0n, UNIT_JOBS), ($, j) => {
                const n = $.const(line.multiply(UNITS).add(unit).multiply(UNIT_JOBS).add(j));
                const starts = $.const(East.DateTime.fromEpochMilliseconds(first.toEpochMilliseconds().add(j.multiply(2n * DAY)).add(n.remainder(24n).multiply(HOUR))));
                const hours = $.const(n.remainder(300n).equal(11n).ifElse(() => 9600n, () => n.remainder(30n).equal(7n).ifElse(() => 960n, () => n.remainder(9n).add(1n))));
                $(jobs.insert(East.str`j${j.add(100n)}`, {
                  press: East.str`P${line.add(100n)}`,
                  state: n.remainder(2n).equal(0n).ifElse(() => 'confirmed', () => 'proposed'),
                  start: n.remainder(20n).equal(19n).ifElse(() => none, () => some(starts)),
                  end: n.remainder(20n).equal(18n).ifElse(() => none, () => some(East.DateTime.fromEpochMilliseconds(starts.toEpochMilliseconds().add(hours.multiply(HOUR))))),
                  x: 0.0,
                  y: 0.0,
                  parts: new Map(),
                }));
              });
              const sheets = $.let(new Map(), SheetsType);
              $.for(East.Array.range(0n, UNIT_DAYS), ($, day) => {
                $(sheets.insert(
                  East.DateTime.fromEpochMilliseconds(first.toEpochMilliseconds().add(day.multiply(DAY)).add(6n * HOUR)),
                  day.add(unit).remainder(16n).toFloat().multiply(250.0),
                ));
              });
              $(units.insert(East.str`U${unit.add(1n)}`, { jobs, sheets }));
            });
            $(rows.insert(East.str`L${line.add(100n)}`, { name: East.str`Line ${line.add(1n)}`, units }));
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
      // A summary with no key's totals of the tiles that overlap a window under a state (#1732): a loop over every entry of it.
      e3.function('plain_state_totals', { inputs: [e3.index(jobs.indexes.state_load)], args: [StringType, DateTimeType, DateTimeType], output: Totals }, ($, load, state, from, to) => {
        const kept = $.let(new Map(), Totals);
        const week = $.const(7n * DAY);
        $.for(load, ($, totals, entry) => {
          const tile = $.const(entry.ik.tile.toEpochMilliseconds());
          $.if(East.equal(entry.ik.on.state, state).and(() => East.less(from, to)).and(() => tile.less(to.toEpochMilliseconds()))
            .and(() => tile.add(week).greater(from.toEpochMilliseconds())), ($) => { $(kept.insert(entry.ik.tile, totals)); });
        });
        return kept;
      }),
      // A nested series index's: a loop over what the line, or its unit, holds
      e3.function('plain_unit_jobs', { inputs: [lines], args: [StringType, StringType, DateTimeType, DateTimeType], output: Keys }, ($, rows, line, unit, from, to) => {
        const inWindow = $.const(overlaps);
        const kept = $.let(new Map(), Keys);
        $.for(rows.get(line).units.get(unit).jobs, ($, job, id) => {
          $.if(East.less(from, to).and(() => inWindow(job, from, to)), ($) => { $(kept.insert(id, null)); });
        });
        return kept;
      }),
      e3.function('plain_line_jobs', { inputs: [lines], args: [StringType, DateTimeType, DateTimeType], output: Beneath }, ($, rows, line, from, to) => {
        const inWindow = $.const(overlaps);
        const end = $.const(variant('end', null), LinePath);
        const kept = $.let(new Map(), Beneath);
        $.for(rows.get(line).units, ($, unit, key) => {
          $.for(unit.jobs, ($, job, id) => {
            $.if(East.less(from, to).and(() => inWindow(job, from, to)), ($) => { $(kept.insert({ path: variant('step', { key: variant('units', key), rest: end }), id: variant('units.jobs', id) }, null)); });
          });
        });
        return kept;
      }),
      e3.function('plain_unit_sheets', { inputs: [lines], args: [StringType, StringType, DateTimeType, DateTimeType], output: SheetsType }, (_$, rows, line, unit, from, to) =>
        rows.get(line).units.get(unit).sheets.filter((_$, _sheets, counted) => East.greaterEqual(counted, from).and(() => East.less(counted, to)))),
      // A unit's sheets' totals a month, of a window of whole months: how many, their sum, the least, the greatest and the latest
      e3.function('plain_unit_months', { inputs: [lines], args: [StringType, StringType, DateTimeType, DateTimeType], output: MonthTotals }, (_$, rows, line, unit, from, to) =>
        rows.get(line).units.get(unit).sheets
          .filter((_$, _sheets, counted) => East.greaterEqual(counted, from).and(() => East.less(counted, to)))
          .groupReduce(
            (_$, _sheets, counted) => East.DateTime.roundDownMonth(counted, 1n),
            ($) => $.const({ count: 0n, ms: 0n, values: none }, RecordNestedTotalsType),
            (_$, totals, sheets) => ({
              count: totals.count.add(1n),
              ms: totals.ms,
              values: some(totals.values.match({
                none: () => ({ sum: sheets, min: sheets, max: sheets, last: sheets }),
                some: (_$, was) => ({ sum: was.sum.add(sheets), min: East.min(was.min, sheets), max: East.max(was.max, sheets), last: sheets }),
              })),
            }),
          )),
      // A line's sum of its units' sheets a week, of a window of whole weeks: each unit's own in the week, then theirs
      e3.function('plain_line_weeks', { inputs: [lines], args: [StringType, DateTimeType, DateTimeType], output: SheetsType }, ($, rows, line, from, to) => {
        const kept = $.let(new Map(), SheetsType);
        const tile = $.let(from);
        $.while(East.less(tile, to), ($) => {
          const next = $.const(East.DateTime.fromEpochMilliseconds(tile.toEpochMilliseconds().add(7n * DAY)));
          const total = $.let(0.0);
          const drew = $.let(false);
          $.for(rows.get(line).units, ($, unit) => {
            const own = $.let(0.0);
            const any = $.let(false);
            $.for(unit.sheets, ($, sheets, counted) => {
              $.if(East.greaterEqual(counted, tile).and(() => East.less(counted, next)), ($) => {
                $.assign(own, own.add(sheets));
                $.assign(any, true);
              });
            });
            $.if(any, ($) => {
              $.assign(total, total.add(own));
              $.assign(drew, true);
            });
          });
          $.if(drew, ($) => { $(kept.insert(tile, total)); });
          $.assign(tile, next);
        });
        return kept;
      }),
    ];

    // ── The readers, the same on each runtime ────────────────────────────────────────────────────────────────────

    const byPress = e3.index(jobs.indexes.by_press);
    const inTime = e3.index(jobs.indexes.in_time);
    const pressWeeks = e3.index(jobs.indexes.press_weeks);
    const pressLoad = e3.index(jobs.indexes.press_load);
    const stateLoad = e3.index(jobs.indexes.state_load);
    const byArea = e3.index(jobs.indexes.by_area);
    const byPart = e3.index(jobs.indexes.by_part);
    const linesInTime = e3.index(lines.indexes.lines_in_time);
    const readers = RUNTIMES.flatMap((runtime) => {
      const on = { runner: { runtime, platforms: [] as [] } };
      return [
        e3.function(onRuntime('of', runtime), { inputs: [byPress], args: [StringType], output: Keys, ...on }, ($, entries, press) => {
          const kept = $.let(new Map(), Keys);
          entries.of(press).each($, ($, _carried, key) => { $(kept.insert(key, null)); });
          return kept;
        }),
        // Beside an entries index, an index that carries nothing carries the lean row, as its read is typed: the keys
        // alone are kept
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
        e3.function(onRuntime('state_totals', runtime), { inputs: [stateLoad], args: [StringType, DateTimeType, DateTimeType], output: Totals, ...on }, ($, entries, state, from, to) =>
          entries.totals({ on: { state }, from, to }).collect($)),
        e3.function(onRuntime('within', runtime), { inputs: [byArea], args: [FloatType, FloatType, FloatType, FloatType], output: Keys, ...on }, ($, entries, x, y, width, height) => {
          const kept = $.let(new Map(), Keys);
          entries.within({ x, y, width, height }).each($, ($, _job, key) => { $(kept.insert(key, null)); });
          return kept;
        }),
        e3.function(onRuntime('part', runtime), { inputs: [byPart], args: [StringType], output: Parts, ...on }, ($, entries, part) =>
          entries.of(part).collect($)),
        e3.function(onRuntime('unit_jobs', runtime), { inputs: [linesInTime], args: [StringType, StringType, DateTimeType, DateTimeType], output: Keys, ...on }, ($, entries, line, unit, from, to) => {
          const kept = $.let(new Map(), Keys);
          entries.items({ collection: ['units', 'jobs'], row: line, path: [variant('units', unit)], from, to }).each($, ($, _job, id) => { $(kept.insert(id, null)); });
          return kept;
        }),
        e3.function(onRuntime('line_jobs', runtime), { inputs: [linesInTime], args: [StringType, DateTimeType, DateTimeType], output: Beneath, ...on }, ($, entries, line, from, to) => {
          const kept = $.let(new Map(), Beneath);
          entries.subtree({ collection: ['units', 'jobs'], row: line, from, to }).each($, ($, _job, under) => { $(kept.insert(under as never, null)); });
          return kept;
        }),
        e3.function(onRuntime('unit_sheets', runtime), { inputs: [linesInTime], args: [StringType, StringType, DateTimeType, DateTimeType], output: SheetsType, ...on }, ($, entries, line, unit, from, to) =>
          entries.items({ collection: ['units', 'sheets'], row: line, path: [variant('units', unit)], from, to }).collect($)),
        e3.function(onRuntime('unit_months', runtime), { inputs: [linesInTime], args: [StringType, StringType, DateTimeType, DateTimeType], output: MonthTotals, ...on }, ($, entries, line, unit, from, to) =>
          entries.totals({ collection: ['units', 'sheets'], row: line, path: [variant('units', unit)], from, to }).collect($)),
        e3.function(onRuntime('line_weeks', runtime), { inputs: [linesInTime], args: [StringType, DateTimeType, DateTimeType], output: SheetsType, ...on }, ($, entries, line, from, to) =>
          entries.subtotals({ collection: ['units', 'sheets'], row: line, rollup: 'sum', from, to }).collect($)),
      ];
    });

    const zip = join(tempDir, 'pressroom.zip');
    await e3.export(e3.package('pressroom', '1.0.0', ...plain, ...readers), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, WS);
    await workspaceDeploy(storage, repo, WS, 'pressroom', '1.0.0', { runner });
    // Each seed is one run: the reduce that makes the rows, and every index of the record kept beside it. Its time is
    // the machine's, as a read's is, so it runs under the limit this spec's reads name, not a mutation's default.
    const limits = { timeoutMs: LIMITS.timeoutMs, maxLogBytes: LIMITS.maxLogBytes };
    for (const name of ['jobs', 'lines']) {
      const seeded = await recordMutate(storage, runner, repo, WS, name, 'seed', [arg(DateTimeType, FIRST)], { actor: 'ada@example.com', limits });
      assert.equal(seeded.kind, 'committed', JSON.stringify(seeded));
    }
  });

  /** What each read decoded, a line a read: printed when `E3_INDEX_READERS_COUNTS` is set, and asserted either way. */
  const counted: string[] = [];

  after(() => {
    if (process.env.E3_INDEX_READERS_COUNTS !== undefined) console.log(counted.join('\n'));
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  /** How many segments a record's state holds an index in. */
  async function segmentsOf(record: string, index: string): Promise<number> {
    const ref = await storage.datasets.read(repo, WS, `records/${record}`);
    if (ref?.type !== 'value') assert.fail(`${record} holds a state`);
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
   * 19 and its one point 2, the 4,800 entries of one part 5 of 33, the
   * segments its one run spans, and each run of one node of a nested series
   * index 1 of 31. The bounds leave a segment or two for a cut that lands
   * otherwise.
   */
  async function held<T extends EastType>(
    reader: string, plain: string, index: string, type: T, args: Uint8Array[], most: number, atLeast: number, record = 'jobs',
  ): Promise<ValueTypeOf<T>> {
    const expected = await call(plain, args);
    const stored = await segmentsOf(record, index);
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
  /** The nested series index is stored in at least this many segments, and a read of one node's run decodes at most this many. */
  const NESTED_AT_LEAST = 24;
  const NESTED_MOST = 3;

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

  it('a summary index with no key: totals, each tile of the record\'s that overlaps a window, under its leading fields (#1732)', async () => {
    const load = await held('state_totals', 'plain_state_totals', 'state_load', Totals,
      [arg(StringType, 'confirmed'), arg(DateTimeType, at('2026-06-10T00:00:00.000')), arg(DateTimeType, at('2026-07-08T00:00:00.000'))], 1, 1);
    assert.equal(load.size, 5, 'four weeks from a Wednesday touch five weeks');
    for (const [, totals] of load) assert.ok(totals.count > 200n, `a week's confirmed jobs on every press, a job every forty minutes: ${totals.count}`);
  });

  it('an area index: within, the rows whose point is in a window', async () => {
    const room = await held('within', 'plain_within', 'by_area', Keys, [arg(FloatType, 20), arg(FloatType, 10), arg(FloatType, 5), arg(FloatType, 4)], 6, 16);
    assert.equal(room.size, 11 * 9, 'a point every half metre, the edges included');
    // A window that is one point, its width and height written as the zero below zero: a width of none on every runner
    const point = await held('within', 'plain_within', 'by_area', Keys, [arg(FloatType, 20), arg(FloatType, 10), arg(FloatType, -0), arg(FloatType, -0)], 4, 16);
    assert.equal(point.size, 1, 'the one job that stands at the point');
  });

  it('an entries index: of, a key\'s entry on every row that holds one', async () => {
    const inserts = await held('part', 'plain_part', 'by_part', Parts, [arg(StringType, 'insert')], 6, 24);
    assert.equal(inserts.size, Number(JOBS / 5n));
  });

  it('a nested series index: a node\'s items and values, the items beneath a row, a node\'s totals and a row\'s subtotals', async () => {
    const line = arg(StringType, 'L117');
    const unit = arg(StringType, 'U3');
    const window = [arg(DateTimeType, at('2026-02-02T00:00:00.000')), arg(DateTimeType, at('2026-03-02T00:00:00.000'))];
    const jobs = await held('unit_jobs', 'plain_unit_jobs', 'lines_in_time', Keys, [line, unit, ...window], NESTED_MOST, NESTED_AT_LEAST, 'lines');
    assert.ok(jobs.size >= 12, `four weeks of a unit's jobs, one every two days: ${jobs.size}`);
    const beneath = await held('line_jobs', 'plain_line_jobs', 'lines_in_time', Beneath, [line, ...window], NESTED_MOST, NESTED_AT_LEAST, 'lines');
    assert.ok(beneath.size >= 4 * 12, `four units' jobs beneath their line: ${beneath.size}`);
    const sheets = await held('unit_sheets', 'plain_unit_sheets', 'lines_in_time', SheetsType, [line, unit, ...window], NESTED_MOST, NESTED_AT_LEAST, 'lines');
    assert.equal(sheets.size, 28, 'a value a day for four weeks');
    // Whole months, and whole weeks: the totals of two months, and the line's sum of its units' sheets in each of four weeks
    const months = await held('unit_months', 'plain_unit_months', 'lines_in_time', MonthTotals,
      [line, unit, arg(DateTimeType, at('2026-02-01T00:00:00.000')), arg(DateTimeType, at('2026-04-01T00:00:00.000'))], NESTED_MOST, NESTED_AT_LEAST, 'lines');
    assert.equal(months.size, 2);
    const weeks = await held('line_weeks', 'plain_line_weeks', 'lines_in_time', SheetsType, [line, ...window], NESTED_MOST, NESTED_AT_LEAST, 'lines');
    assert.equal(weeks.size, 4);
  });
});
