/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A record's `index.series` and `index.summary` (#1039): the tiles an
 * event touches and its share of each, and the places a series index files it
 * — once, at the level its length fits, or once a year past a year (#1433) —
 * each against a direct oracle written with the host's calendar rather than
 * East's; the keys and contributions they generate; their declared types;
 * their refusals; what a series index carries where it is given a `value`
 * (#1710); and how a write keeps them — a series index equals its rebuild,
 * and a summary's changes, added to the totals it held, equal the totals a
 * rebuild sums. That every runtime files an event alike is e3-core's
 * series spec, which runs the programs on each.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BooleanType, DateTimeType, DictType, East, IntegerType, NullType, OptionType, SetType, SortedMap, SortedSet,
  StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, encodeBeast2PagedFor, equalFor, none,
  printFor, printType, some, variant,
  type ValueTypeOf,
} from '@elaraai/east';
import {
  RecordLevelType, RecordSummaryOpType, RecordSummaryTotalsType, type RecordSummaryOp, type RecordSummaryTotals,
} from '@elaraai/e3-types';
import { index as indexInput } from './index-input.js';
import { record } from './record.js';
import type { IndexKeyOf, IndexOn, SeriesIndexSpec, SummaryIndexSpec, SummaryKeyOf } from './record-index.js';
import {
  MAX_EVENT_TILES, RECORD_TILES, SHORTEST_MS, TILE_FNS, checkTile, type RecordTile,
} from './record-tiles.js';
import { builtIndex, summaryMergeProgram } from './record-programs.js';
import { functionAt, type IndexFunction } from './record-guards.js';
import { package_ } from './package.js';
import { assertEast, assertMaintainedIsRebuilt, at, indexEntries, seededStream, writtenDelta as written } from './test-helpers.js';
import type { RecordIndexDef } from './types.js';

/** A print job: the press it runs on, the crews on it, its state, and when it runs, or not yet. */
const JobRow = StructType({
  press: StringType, crews: SetType(StringType), state: StringType,
  start: OptionType(DateTimeType), end: OptionType(DateTimeType), title: StringType,
});
const JobsType = DictType(StringType, JobRow);
type Job = ValueTypeOf<typeof JobRow>;
type Jobs = SortedMap<string, Job>;
const keyOrder = compareFor(StringType);
const decodeJob = decodeBeast2For(JobRow);
const encodeJob = encodeBeast2For(JobRow);

/** What a tile draws of a job: its press, its title, and when it runs. */
const JobTile = StructType({ press: StringType, title: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
/** A job's tile, `(K, V) → JobTile`: a series index's `value`. */
const tileOf = East.function([StringType, JobRow], JobTile, (_$, _key, row) => ({ press: row.press, title: row.title, start: row.start, end: row.end }));

/** A press's shift: always placed, its start and end plain DateTimes. */
const ShiftRow = StructType({ press: StringType, start: DateTimeType, end: DateTimeType });
const ShiftsType = DictType(StringType, ShiftRow);

/** The series index the jobs record declares under `name`, as `e3.record` builds it. */
const jobSeries = <const S extends SeriesIndexSpec<typeof JobsType>>(name: string, spec: S) =>
  record('jobs', JobsType, { indexes: (index) => ({ [name]: index.series(spec) }) }).indexes[name]!;
/** The series index the jobs record declares under `name`, carrying what `value` gives of each job, as `e3.record` builds it. */
const jobTiles = <const S extends SeriesIndexSpec<typeof JobsType>>(name: string, spec: S, value: IndexFunction = tileOf) =>
  record('jobs', JobsType, { indexes: (index) => ({ [name]: index.series(spec, { value }) }) }).indexes[name]!;
/** The summary index the jobs record declares under `name`, as `e3.record` builds it. */
const jobSummary = <const S extends SummaryIndexSpec<typeof JobsType>>(name: string, spec: S) =>
  record('jobs', JobsType, { indexes: (index) => ({ [name]: index.summary(spec) }) }).indexes[name]!;
/** The series index the shifts record declares under `name`, as `e3.record` builds it. */
const shiftSeries = <const S extends SeriesIndexSpec<typeof ShiftsType>>(name: string, spec: S) =>
  record('shifts', ShiftsType, { indexes: (index) => ({ [name]: index.series(spec) }) }).indexes[name]!;

const DAY = 86_400_000n;
const HOUR = 3_600_000n;
const WEEK = 7n * DAY;
/** 1969-12-29, the Monday before the epoch, in milliseconds. */
const MONDAY = -3n * DAY;
/** How far either side of 1970 the drawn instants reach: about 410 years. */
const SPAN = 13_000_000_000_000;

/** The instant `ms` milliseconds from the epoch, made by East. */
const instant = East.compile(East.function([IntegerType], DateTimeType, (_$, ms) => East.DateTime.fromEpochMilliseconds(ms)), []);

/** An optional instant moved by `ms` milliseconds, by East; none stays none. */
const later = East.compile(East.function([OptionType(DateTimeType), IntegerType], OptionType(DateTimeType), ($, when, ms) => {
  const moved = $.let(none, OptionType(DateTimeType));
  $.match(when, {
    some: ($, t) => { $.assign(moved, some(East.DateTime.fromEpochMilliseconds(t.toEpochMilliseconds().add(ms)))); },
  });
  return moved;
}), []);

// ── The oracle: the tiles with the host's calendar ───────────────────────────

/** `a` modulo `n`, in [0, n) whatever `a`'s sign. */
const floorMod = (a: bigint, n: bigint) => ((a % n) + n) % n;

/** How many months a calendar tile spans. */
const MONTHS = { month: 1, quarter: 3, year: 12 } as const;

/** Midnight UTC on the first of a month, `month` counted from January of `year` (12 is the next January). */
function monthStart(year: number, month: number): bigint {
  const first = new Date(0);
  // Not Date.UTC, which reads a year before 100 as 19xx.
  first.setUTCFullYear(year, month, 1);
  return BigInt(first.getTime());
}

/** The start of the tile holding `ms`: whole days and weeks floored, the calendar's month, quarter and year. */
function oracleStart(tile: RecordTile, ms: bigint): bigint {
  if (tile === 'day') return ms - floorMod(ms, DAY);
  if (tile === 'week') return ms - floorMod(ms - MONDAY, WEEK);
  const held = new Date(Number(ms));
  const month = held.getUTCMonth();
  return monthStart(held.getUTCFullYear(), month - (month % MONTHS[tile]));
}

/** The start of the tile after the one starting at `start`. */
function oracleNext(tile: RecordTile, start: bigint): bigint {
  if (tile === 'day') return start + DAY;
  if (tile === 'week') return start + WEEK;
  const held = new Date(Number(start));
  return monthStart(held.getUTCFullYear(), held.getUTCMonth() + MONTHS[tile]);
}

/** Each tile `[from, to)` overlaps and by how much; an instant's one tile, by none. */
function oracleShares(tile: RecordTile, from: bigint, to: bigint): Array<{ tile: bigint; ms: bigint }> {
  if (to <= from) return [{ tile: oracleStart(tile, from), ms: 0n }];
  const shares: Array<{ tile: bigint; ms: bigint }> = [];
  for (let start = oracleStart(tile, from); start < to; start = oracleNext(tile, start)) {
    const next = oracleNext(tile, start);
    shares.push({ tile: start, ms: (next < to ? next : to) - (start > from ? start : from) });
  }
  return shares;
}

/** Where a series index declared at `tile` files `[from, to)`: once, at the finest level from `tile` whose shortest tile holds its length; past a year, under each year it touches. */
function oracleFilings(tile: RecordTile, from: bigint, to: bigint): Array<{ level: RecordTile; tile: bigint }> {
  const length = to - from;
  for (const level of RECORD_TILES.slice(RECORD_TILES.indexOf(tile))) {
    if (length <= SHORTEST_MS[level]) return [{ level, tile: oracleStart(level, from) }];
  }
  const years: Array<{ level: RecordTile; tile: bigint }> = [];
  for (let start = oracleStart('year', from); start < to; start = oracleNext('year', start)) years.push({ level: 'year', tile: start });
  return years;
}

/** An instant's milliseconds from the epoch, read by East. */
const millisecondsOf = East.compile(East.function([DateTimeType], IntegerType, (_$, t) => t.toEpochMilliseconds()), []);

/** The tile functions, as each runtime computes them. */
const startOf = East.compile(TILE_FNS.tileStart, []);
const nextOf = East.compile(TILE_FNS.tileNext, []);
const sharesOf = East.compile(TILE_FNS.tileShares, []);
const filingsOf = East.compile(TILE_FNS.eventFilings, []);

/** A tile's functions over epoch milliseconds, its instants made and read by East. */
function compiled(tile: RecordTile) {
  const level = variant(tile, null);
  return {
    start: (ms: bigint) => millisecondsOf(startOf(level, instant(ms))),
    next: (ms: bigint) => millisecondsOf(nextOf(level, instant(ms))),
    shares: (from: bigint, to: bigint, what: string) => sharesOf(level, instant(from), instant(to), what)
      .map((share) => ({ tile: millisecondsOf(share.tile), ms: share.ms })),
    filings: (from: bigint, to: bigint, what: string) => filingsOf(level, instant(from), instant(to), what)
      .map((filing) => ({ level: filing.level.type, tile: millisecondsOf(filing.tile) })),
  };
}

// ── The rows the writes carry ────────────────────────────────────────────────

const PRESSES = ['P-1001', 'P-1002', 'P-1003'];
/** Monday 5 October 2026, which the seeded jobs are scheduled around. */
const OCT_5 = monthStart(2026, 9) + 4n * DAY;

/** A job, as a write carries it: on a press, crewed, and scheduled from `start` to `end`, or not yet. */
function job(n: number, start: bigint | undefined, end: bigint | undefined): Job {
  return decodeJob(encodeJob({
    press: PRESSES[n % PRESSES.length]!,
    crews: new SortedSet(n % 4 === 0 ? [] : n % 4 === 1 ? ['north'] : ['north', 'south'], keyOrder),
    state: n % 2 === 0 ? 'confirmed' : 'proposed',
    start: start === undefined ? none : some(instant(start)),
    end: end === undefined ? none : some(instant(end)),
    title: `Job ${n}`,
  }));
}

/**
 * The jobs a write first holds: an hour to weeks long, from late August to the
 * new year; some from a day's midnight, some instants with no end, some ending
 * before they start, some not yet scheduled.
 */
function seededJobs(): Jobs {
  const draw = seededStream(1039);
  const rows = new SortedMap<string, Job>(undefined, keyOrder);
  for (let n = 0; n < 80; n++) {
    const start = OCT_5 + BigInt(Math.floor((draw() - 0.4) * 90)) * DAY + BigInt(Math.floor(draw() * 24)) * HOUR;
    const length = HOUR + BigInt(Math.floor(draw() ** 2 * 40 * 24)) * HOUR;
    const key = `W-${String(n).padStart(4, '0')}`;
    switch (n % 10) {
      case 0: rows.set(key, job(n, undefined, undefined)); break;
      case 1: rows.set(key, job(n, start, undefined)); break;
      case 2: rows.set(key, job(n, start, start - HOUR)); break;
      case 3: rows.set(key, job(n, start - floorMod(start, DAY), start - floorMod(start, DAY) + length)); break;
      default: rows.set(key, job(n, start, start + length)); break;
    }
  }
  return rows;
}

/**
 * The same jobs after another session's edits: some deleted, unscheduled,
 * nudged an hour, moved far, stretched, made instants, moved to another press,
 * recrewed, or retitled and confirmed; and some new ones, scheduled and not.
 */
function editedJobs(rows: Jobs): Jobs {
  const next = new SortedMap<string, Job>([...rows], keyOrder);
  let n = 0;
  for (const [key, row] of rows) {
    n++;
    const moved = (by: bigint) => ({ start: later(row.start, by), end: later(row.end, by) });
    switch (n % 10) {
      case 1: next.delete(key); break;
      case 2: next.set(key, { ...row, start: none }); break;
      case 3: next.set(key, { ...row, ...moved(HOUR) }); break;
      case 4: next.set(key, { ...row, ...moved(45n * DAY) }); break;
      case 5: next.set(key, { ...row, end: later(row.end, 30n * DAY) }); break;
      case 6: next.set(key, { ...row, end: none }); break;
      case 7: next.set(key, { ...row, press: 'P-1009' }); break;
      case 8: next.set(key, { ...row, crews: new SortedSet(['east'], keyOrder) }); break;
      case 9: next.set(key, { ...row, title: `${row.title}, reprinted`, state: 'confirmed' }); break;
      default: break;
    }
  }
  for (let i = 0; i < 12; i++) {
    next.set(`X-${String(i).padStart(4, '0')}`, job(100 + i, i % 3 === 0 ? undefined : OCT_5 + BigInt(i) * 2n * DAY, OCT_5 + BigInt(i) * 3n * DAY));
  }
  return next;
}

/** The `[entry, value]` pairs an index's build program emits for `rows` of the jobs. */
const emitted = (def: RecordIndexDef, rows: Jobs): [unknown, unknown][] => indexEntries(JobsType, def, rows);

/** A summary's totals as its build sums them: each piece's contributions, equal keys folded by the summary's own merge. */
function summed(def: RecordIndexDef, pieces: readonly Jobs[]): SortedMap<unknown, RecordSummaryTotals> {
  const merge = summaryMergeProgram(def).compile([]) as (entry: unknown, a: RecordSummaryTotals, b: RecordSummaryTotals) => RecordSummaryTotals;
  const totals = new SortedMap<unknown, RecordSummaryTotals>(undefined, compareFor(StructType({ ik: def.keyType, k: NullType })) as never);
  for (const piece of pieces) {
    for (const [entry, add] of emitted(def, piece)) {
      const held = totals.get(entry);
      totals.set(entry, held === undefined ? add as RecordSummaryTotals : merge(entry, held, add as RecordSummaryTotals));
    }
  }
  return totals;
}

// ── The tiles ────────────────────────────────────────────────────────────────

describe('the tiles an event touches', () => {
  it('takes the five tiles and refuses any other, naming them', () => {
    assert.deepEqual([...RECORD_TILES], ['day', 'week', 'month', 'quarter', 'year']);
    for (const tile of RECORD_TILES) assert.equal(checkTile('index.series', 'by_tile', tile), tile);
    for (const bad of ['hour', 'Day', '', 7, undefined]) {
      assert.throws(() => checkTile('index.series', 'by_tile', bad),
        /index\.series 'by_tile' takes a tile: "day", "week", "month", "quarter", "year" — got /);
    }
  });

  it('names the tiles a reader would: an ISO week from its Monday, a quarter from January, April, July or October', () => {
    const sameInstant = equalFor(DateTimeType);
    const print = printFor(DateTimeType);
    // The tile, an instant, the start of the tile holding it, and the next tile's start.
    const cases: Array<[RecordTile, string, string, string]> = [
      ['day', '1969-12-31T23:59:59.999', '1969-12-31T00:00:00.000', '1970-01-01T00:00:00.000'],
      ['week', '1970-01-01T12:00:00.000', '1969-12-29T00:00:00.000', '1970-01-05T00:00:00.000'],
      ['week', '2026-10-11T23:59:59.999', '2026-10-05T00:00:00.000', '2026-10-12T00:00:00.000'],
      ['week', '2026-10-12T00:00:00.000', '2026-10-12T00:00:00.000', '2026-10-19T00:00:00.000'],
      ['month', '2024-02-29T12:00:00.000', '2024-02-01T00:00:00.000', '2024-03-01T00:00:00.000'],
      ['month', '2026-12-31T23:59:59.999', '2026-12-01T00:00:00.000', '2027-01-01T00:00:00.000'],
      ['quarter', '2026-11-15T08:00:00.000', '2026-10-01T00:00:00.000', '2027-01-01T00:00:00.000'],
      ['quarter', '1969-03-31T23:59:59.999', '1969-01-01T00:00:00.000', '1969-04-01T00:00:00.000'],
      ['year', '1969-07-20T20:17:00.000', '1969-01-01T00:00:00.000', '1970-01-01T00:00:00.000'],
    ];
    for (const [tile, held, first, after] of cases) {
      const start = startOf(variant(tile, null), at(held));
      assert.ok(sameInstant(start, at(first)), `the ${tile} holding ${held} starts ${first}, not ${print(start)}`);
      const next = nextOf(variant(tile, null), start);
      assert.ok(sameInstant(next, at(after)), `the ${tile} after ${first} starts ${after}, not ${print(next)}`);
    }
  });

  it('starts each tile where the calendar does, before 1970 as after, and steps to the next — as the oracle does', () => {
    for (const tile of RECORD_TILES) {
      const { start, next } = compiled(tile);
      const draw = seededStream(RECORD_TILES.indexOf(tile) + 1039);
      const instants = [
        0n, -1n, 1n, MONDAY, MONDAY - 1n, DAY - 1n, -DAY, -DAY - 1n,
        monthStart(1969, 11), monthStart(1969, 11) - 1n, monthStart(2024, 1) + 28n * DAY,
        monthStart(2000, 2) - 1n, monthStart(1900, 2) - 1n, monthStart(50, 5), monthStart(50, 0) - 1n,
      ];
      for (let i = 0; i < 600; i++) {
        const ms = BigInt(Math.floor((draw() * 2 - 1) * SPAN));
        const first = oracleStart(tile, ms);
        instants.push(ms, first, first - 1n, first + 1n);
      }
      for (const ms of instants) {
        const first = start(ms);
        assert.equal(first, oracleStart(tile, ms), `the ${tile} holding ${ms}`);
        assert.equal(next(first), oracleNext(tile, first), `the ${tile} after ${first}`);
      }
    }
  });

  it('shares an event out over each tile it overlaps, adding up to its length; an instant is one tile, covered for none', () => {
    // The longest event drawn for each tile, well inside the tiles one may touch.
    const longest = { day: 400n * DAY, week: 3_000n * DAY, month: 20_000n * DAY, quarter: 60_000n * DAY, year: 200_000n * DAY };
    for (const tile of RECORD_TILES) {
      const { shares } = compiled(tile);
      const draw = seededStream(RECORD_TILES.indexOf(tile) + 2039);
      const events: Array<[bigint, bigint]> = [
        [0n, 0n], [5n, 4n], [-1n, 1n], [-DAY, DAY], [MONDAY, MONDAY + WEEK], [monthStart(2026, 9), monthStart(2027, 0)],
        [monthStart(1969, 11) + 3n, monthStart(1970, 1) - 3n],
      ];
      for (let i = 0; i < 300; i++) {
        const from = BigInt(Math.floor((draw() * 2 - 1) * SPAN));
        const length = i % 10 === 0 ? 0n : BigInt(Math.floor(draw() * Number(longest[tile])));
        events.push([from, from + length], [from, from - length]);
      }
      for (const [from, to] of events) {
        const got = shares(from, to, 'event');
        assert.deepEqual(got, oracleShares(tile, from, to), `${tile}: ${from} to ${to}`);
        const total = got.reduce((sum, share) => sum + share.ms, 0n);
        assert.equal(total, to > from ? to - from : 0n, `${tile}: the shares of ${from} to ${to} add up to its length`);
      }
    }
  });

  it(`refuses a summary's event touching more than ${MAX_EVENT_TILES} of its tiles, naming it, its span and the tile`, () => {
    const day = compiled('day');
    const noon = monthStart(2026, 0) + DAY / 2n;
    // Noon to noon 4,095 days on touches 4,096 days: the most an event may.
    assert.equal(day.shares(noon, noon + 4_095n * DAY, 'job W-0001').length, 4096);
    assert.throws(() => day.shares(noon, noon + 4_096n * DAY, 'job W-0001'),
      /job W-0001, from 2026-01-01T12:00:00\.000 to 2037-03-20T12:00:00\.000, touches more than 4096 day tiles: declare a coarser tile/);
    // A week tile files the same event.
    assert.deepEqual(compiled('week').shares(noon, noon + 4_096n * DAY, 'job W-0001'), oracleShares('week', noon, noon + 4_096n * DAY));
  });
});

// ── Where a series index files an event (#1433) ──────────────────────────────

describe('the places a series index files an event', () => {
  const noonOct5 = OCT_5 + DAY / 2n;
  const YEAR = 365n * DAY;

  it('files an event once, at the finest level from its tile whose shortest tile holds its length — or, past a year, under each year it touches', () => {
    // The lengths the measures name, each from noon on Monday 5 October 2026, at each declared tile.
    const lengths: Array<[string, bigint]> = [
      ['an instant', 0n], ['8 hours', 8n * HOUR], ['1 week', WEEK], ['28 days', 28n * DAY], ['29 days', 29n * DAY],
      ['90 days', 90n * DAY], ['91 days', 91n * DAY], ['365 days', YEAR], ['366 days', YEAR + DAY], ['3 years', 3n * YEAR], ['10 years', 10n * YEAR],
    ];
    const expected: Record<RecordTile, string[]> = {
      day: ['day', 'day', 'week', 'month', 'quarter', 'quarter', 'year', 'year', 'year×2', 'year×4', 'year×11'],
      week: ['week', 'week', 'week', 'month', 'quarter', 'quarter', 'year', 'year', 'year×2', 'year×4', 'year×11'],
      month: ['month', 'month', 'month', 'month', 'quarter', 'quarter', 'year', 'year', 'year×2', 'year×4', 'year×11'],
      quarter: ['quarter', 'quarter', 'quarter', 'quarter', 'quarter', 'quarter', 'year', 'year', 'year×2', 'year×4', 'year×11'],
      year: ['year', 'year', 'year', 'year', 'year', 'year', 'year', 'year', 'year×2', 'year×4', 'year×11'],
    };
    for (const tile of RECORD_TILES) {
      const { filings } = compiled(tile);
      const got = lengths.map(([what, length]) => {
        const placed = filings(noonOct5, noonOct5 + length, what);
        assert.deepEqual(placed, oracleFilings(tile, noonOct5, noonOct5 + length), `${tile}: ${what}`);
        return placed.length === 1 ? placed[0]!.level : `${placed[0]!.level}×${placed.length}`;
      });
      assert.deepEqual(got, expected[tile], `at ${tile} tiles`);
    }
  });

  it('files an instant, or an end at or before the start, at its tile; 23:59:59.999 on a Sunday under that Sunday\'s week; 366 days under both years it touches', () => {
    const week = compiled('week');
    const oct5 = OCT_5;
    assert.deepEqual(week.filings(noonOct5, noonOct5, 'job'), [{ level: 'week', tile: oct5 }], 'an instant');
    assert.deepEqual(week.filings(noonOct5, noonOct5 - HOUR, 'job'), [{ level: 'week', tile: oct5 }], 'an end before its start');
    const sunday = oct5 + 7n * DAY - 1n;
    assert.deepEqual(week.filings(sunday, sunday + 8n * HOUR, 'job'), [{ level: 'week', tile: oct5 }], 'the week holding its start, though it ends in the next');
    const march = monthStart(2026, 2);
    assert.deepEqual(week.filings(march, march + YEAR + DAY, 'job'),
      [{ level: 'year', tile: monthStart(2026, 0) }, { level: 'year', tile: monthStart(2027, 0) }], 'past a year: each year it touches');
  });

  it('files as the oracle does, before 1970 as after, every length from an instant to twelve years', () => {
    for (const tile of RECORD_TILES) {
      const { filings } = compiled(tile);
      const draw = seededStream(RECORD_TILES.indexOf(tile) + 3039);
      const events: Array<[bigint, bigint]> = [[MONDAY, MONDAY], [-1n, 1n], [monthStart(1969, 11), monthStart(1970, 1)]];
      for (const level of RECORD_TILES) {
        // Each level's edge: its shortest tile exactly, and a millisecond past it.
        events.push([OCT_5, OCT_5 + SHORTEST_MS[level]], [OCT_5, OCT_5 + SHORTEST_MS[level] + 1n]);
      }
      for (let i = 0; i < 400; i++) {
        const from = BigInt(Math.floor((draw() * 2 - 1) * SPAN));
        const length = i % 10 === 0 ? 0n : BigInt(Math.floor(draw() ** 3 * 12 * 366)) * DAY + BigInt(Math.floor(draw() * 24)) * HOUR;
        events.push([from, from + length], [from, from - length]);
      }
      for (const [from, to] of events) {
        const got = filings(from, to, 'event');
        assert.deepEqual(got, oracleFilings(tile, from, to), `${tile}: ${from} to ${to}`);
        // An event filed at a level ends before the end of the tile after the one holding its start.
        if (got.length === 1 && to > from) {
          const level = got[0]!.level;
          assert.ok(to <= oracleNext(level, oracleNext(level, got[0]!.tile)), `${tile}: ${from} to ${to} ends within the ${level} after its own`);
        }
      }
    }
  });

  it(`files an event under each of as many as ${MAX_EVENT_TILES} years it touches, and refuses one touching more, naming it and its span`, () => {
    const day = compiled('day');
    const first = monthStart(2026, 0) + DAY / 2n;
    const last = monthStart(2026 + 4_095, 6);
    const placed = day.filings(first, last, 'job W-0001');
    assert.equal(placed.length, 4096, 'from 2026 to 6121: 4,096 years');
    assert.deepEqual([placed[0], placed[4095]], [{ level: 'year', tile: monthStart(2026, 0) }, { level: 'year', tile: monthStart(6121, 0) }]);
    assert.throws(() => day.filings(first, monthStart(2026 + 4_096, 6), 'job W-0001'),
      /job W-0001, from 2026-01-01T12:00:00\.000 to 6122-07-01T00:00:00\.000, touches more than 4096 year tiles: end it within 4096 years of its start/);
  });
});

// ── The series index ─────────────────────────────────────────────────────────

describe('index.series — its keys', () => {
  const scheduled = (start: string | null, end: string | null): Job => decodeJob(encodeJob({
    press: 'P-1001', crews: new SortedSet(['north', 'south'], keyOrder), state: 'confirmed',
    start: start === null ? none : some(at(start)), end: end === null ? none : some(at(end)), title: 'Brochure run',
  }));

  it('files an event once, under the level its length fits and the tile holding its start, its leading fields first and a Set fanned out', () => {
    const byPressWeek = jobSeries('jobs_by_press_week', { key: 'press', from: 'start', to: 'end', tile: 'week' });
    const byStatePressWeek = jobSeries('jobs_by_state_press_week', { on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'week' });
    const byCrewPressWeek = jobSeries('jobs_by_crew_press_week', { on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'week' });
    const keysByPressWeek = East.compile(functionAt(byPressWeek.keyFn, [StringType, JobRow], SetType(byPressWeek.keyType)), []);
    const keysByStatePressWeek = East.compile(functionAt(byStatePressWeek.keyFn, [StringType, JobRow], SetType(byStatePressWeek.keyType)), []);
    const keysByCrewPressWeek = East.compile(functionAt(byCrewPressWeek.keyFn, [StringType, JobRow], SetType(byCrewPressWeek.keyType)), []);
    // Wednesday 06:00 to the next Tuesday 06:00: six days, a week's length, under the week of 5 October that holds its start.
    const row = scheduled('2026-10-07T06:00:00.000', '2026-10-13T06:00:00.000');
    const oct5 = at('2026-10-05T00:00:00.000');
    const week = variant('week', null);
    assertEast(SetType(byPressWeek.keyType), keysByPressWeek('W-0001', row), new SortedSet([
      { on: {}, key: 'P-1001', level: week, tile: oct5 },
    ], compareFor(byPressWeek.keyType)), 'once, under the week holding its start');
    assertEast(SetType(byStatePressWeek.keyType), keysByStatePressWeek('W-0001', row), new SortedSet([
      { on: { state: 'confirmed' }, key: 'P-1001', level: week, tile: oct5 },
    ], compareFor(byStatePressWeek.keyType)), 'led by its state');
    assertEast(SetType(byCrewPressWeek.keyType), keysByCrewPressWeek('W-0001', row), new SortedSet([
      { on: { crews: 'north' }, key: 'P-1001', level: week, tile: oct5 }, { on: { crews: 'south' }, key: 'P-1001', level: week, tile: oct5 },
    ], compareFor(byCrewPressWeek.keyType)), 'once a crew');
    // Five weeks long: past a month's 28 days, so under the quarter holding its start.
    assertEast(SetType(byPressWeek.keyType), keysByPressWeek('W-0001', scheduled('2026-10-07T06:00:00.000', '2026-11-11T06:00:00.000')), new SortedSet([
      { on: {}, key: 'P-1001', level: variant('quarter', null), tile: at('2026-10-01T00:00:00.000') },
    ], compareFor(byPressWeek.keyType)), 'a longer event at a coarser level');
  });

  it('files an instant, or an end at or before the start, at its tile under the tile holding its start; no start, under none', () => {
    const def = jobSeries('jobs_by_press_week', { key: 'press', from: 'start', to: 'end', tile: 'week' });
    const keysType = SetType(def.keyType);
    const order = compareFor(def.keyType);
    const oct5 = { on: {}, key: 'P-1001', level: variant('week', null), tile: at('2026-10-05T00:00:00.000') };
    const keys = East.compile(functionAt(def.keyFn, [StringType, JobRow], keysType), []);
    assertEast(keysType, keys('W-0001', scheduled('2026-10-07T06:00:00.000', null)), new SortedSet([oct5], order), 'no end');
    assertEast(keysType, keys('W-0001', scheduled('2026-10-07T06:00:00.000', '2026-10-01T00:00:00.000')), new SortedSet([oct5], order), 'an end before its start');
    assertEast(keysType, keys('W-0001', scheduled('2026-10-07T06:00:00.000', '2026-10-07T06:00:00.000')), new SortedSet([oct5], order), 'an end at its start');
    assertEast(keysType, keys('W-0001', scheduled('2026-10-07T06:00:00.000', '2026-10-12T00:00:00.000')), new SortedSet([oct5], order), 'an end at the next week\'s start');
    assertEast(keysType, keys('W-0001', scheduled(null, '2026-10-12T00:00:00.000')), new SortedSet([], order), 'no start');
  });

  it('reads a plain DateTime start and end as an Option\'s', () => {
    const def = shiftSeries('shifts_by_press_day', { key: 'press', from: 'start', to: 'end', tile: 'day' });
    const shift = decodeBeast2For(ShiftRow)(encodeBeast2For(ShiftRow)({ press: 'P-1002', start: at('2026-10-05T22:00:00.000'), end: at('2026-10-06T06:00:00.000') }));
    const keys = East.compile(functionAt(def.keyFn, [StringType, ShiftRow], SetType(def.keyType)), []);
    assertEast(SetType(def.keyType), keys('S-1', shift), new SortedSet([
      { on: {}, key: 'P-1002', level: variant('day', null), tile: at('2026-10-05T00:00:00.000') },
    ], compareFor(def.keyType)), 'a night shift, eight hours, is filed once, under the day it starts');
  });
});

describe('index.series — its declaration', () => {
  it('types its key, its fields and its projection from the spec, and carries its fields and tile', () => {
    const def = jobSeries('jobs_by_state_press_week', { on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'week' });
    const keyType: StructType<{ on: StructType<{ state: typeof StringType }>; key: typeof StringType; level: typeof RecordLevelType; tile: typeof DateTimeType }> = def.keyType;
    const fields: readonly ['state'] = def.on;
    const projection: typeof JobRow = def.valueType;
    assert.equal(printType(keyType), printType(StructType({ on: StructType({ state: StringType }), key: StringType, level: RecordLevelType, tile: DateTimeType })),
      'its leading fields under on, the key, the level, then the tile');
    assert.deepEqual(fields, ['state']);
    assert.equal(printType(projection), printType(JobRow), 'it carries the whole row');
    assert.deepEqual(def.series, { key: 'press', from: 'start', to: 'end', tile: 'week', carries: 'row', order: 'key' });
    assert.equal(def.multi, true, 'an entry a place it is filed');
    assert.equal(def.summary, undefined);
    // The declared types, as the constructor's spec types them.
    type Spec = { on: ['crews']; key: 'press'; from: 'start'; to: 'end'; tile: 'day' };
    const on: IndexOn<Spec> = ['crews'];
    const key: IndexKeyOf<Spec, typeof JobsType> = StructType({ on: StructType({ crews: StringType }), key: StringType, level: RecordLevelType, tile: DateTimeType });
    const totals: SummaryKeyOf<Spec, typeof JobsType> = StructType({ on: StructType({ crews: StringType }), key: StringType, tile: DateTimeType });
    assert.ok(on.length === 1 && key.type === 'Struct' && totals.type === 'Struct');
  });

  it('files each scheduled job once, projecting each entry as its whole row', () => {
    const def = jobSeries('jobs_by_press_week', { key: 'press', from: 'start', to: 'end', tile: 'week' });
    const rows = seededJobs();
    const out = emitted(def, rows);
    const scheduled = [...rows.values()].filter((row) => row.start.type === 'some').length;
    assert.equal(out.length, scheduled, 'none longer than a year: each once, the jobs across a week\'s edge among them');
    const sameJob = equalFor(JobRow);
    for (const [entry, value] of out) {
      const k = (entry as { k: string }).k;
      assert.ok(sameJob(value as Job, rows.get(k)!), `${k}'s projection is its row`);
    }
  });

  it('given a value, carries what it gives of each job in the row\'s place, filed where the row is (#1710)', () => {
    const spec = { key: 'press', from: 'start', to: 'end', tile: 'week' } as const;
    const def = jobTiles('job_tiles_by_press_week', spec);
    const whole = jobSeries('jobs_by_press_week', spec);
    assert.equal(printType(def.valueType), printType(JobTile), 'it carries what its value gives');
    assert.equal(printType(def.keyType), printType(whole.keyType), 'under the key a series index files by');
    assert.deepEqual(def.series, { ...spec, carries: 'value', order: 'key' });
    // What its entries carry, as its type says it: a binding tells its copies from the rows by it (#1725).
    const carried: readonly ['value', 'row'] = [def.series.carries, whole.series.carries];
    assert.deepEqual(carried, ['value', 'row']);
    assert.equal(def.valueFn, tileOf);
    const rows = seededJobs();
    const out = emitted(def, rows);
    const entries = StructType({ ik: def.keyType, k: StringType });
    const sameEntries = equalFor(SetType(entries));
    const entriesOf = (pairs: [unknown, unknown][]) => new SortedSet(pairs.map(([entry]) => entry) as never, compareFor(entries));
    assert.ok(sameEntries(entriesOf(out) as never, entriesOf(emitted(whole, rows)) as never), 'an entry wherever the row is filed');
    const sameTile = equalFor(JobTile);
    for (const [entry, value] of out) {
      const k = (entry as { k: string }).k;
      const row = rows.get(k)!;
      assert.ok(sameTile(value as ValueTypeOf<typeof JobTile>, { press: row.press, title: row.title, start: row.start, end: row.end }), `${k}'s entry carries its tile`);
    }
  });

  it('declared in time order, files the entries a series index in key order files, the tile before the key (#1710)', () => {
    const spec = { on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'week' } as const;
    const inTime = jobSeries('jobs_by_state_week', { ...spec, order: 'time' });
    const byKey = jobSeries('jobs_by_state_press_week', spec);
    const keyType: StructType<{
      on: StructType<{ state: typeof StringType }>; level: typeof RecordLevelType; tile: typeof DateTimeType; key: typeof StringType; past: typeof BooleanType;
    }> = inTime.keyType;
    assert.equal(printType(keyType),
      printType(StructType({ on: StructType({ state: StringType }), level: RecordLevelType, tile: DateTimeType, key: StringType, past: BooleanType })),
      'its leading fields under on, the level, the tile, the key, then past');
    const orders: readonly ['time', 'key'] = [inTime.series.order, byKey.series.order];
    assert.deepEqual(orders, ['time', 'key']);
    assert.deepEqual(inTime.series, { key: 'press', from: 'start', to: 'end', tile: 'week', carries: 'row', order: 'time' });
    const tiles = jobTiles('job_tiles_by_week', { key: 'press', from: 'start', to: 'end', tile: 'day', order: 'time' });
    assert.deepEqual([tiles.series.order, tiles.series.carries, printType(tiles.valueType)], ['time', 'value', printType(JobTile)], 'and carries a value as one in key order does');

    // Each entry is one the index in key order files, its key's parts in the other order, carrying the same row.
    const rows = editedJobs(seededJobs());
    const keyed = StructType({ ik: byKey.keyType, k: StringType });
    const asKeyed = (pairs: [unknown, unknown][]) => new SortedMap(pairs.map(([entry, value]): [unknown, unknown] => {
      const { ik, k } = entry as { ik: ValueTypeOf<typeof byKey.keyType>; k: string };
      return [{ ik: { on: ik.on, key: ik.key, level: ik.level, tile: ik.tile }, k }, value];
    }), compareFor(keyed) as never);
    assertEast(DictType(keyed, JobRow), asKeyed(emitted(inTime, rows)) as never, asKeyed(emitted(byKey, rows)) as never, 'the same entries, each with its row');

    // In its own order, a tile's jobs lie together in their presses' order: under a state, a level and a tile, the presses ascend.
    const filed = [...new SortedMap(emitted(inTime, rows), compareFor(StructType({ ik: inTime.keyType, k: StringType })) as never).keys()]
      .map((entry) => (entry as { ik: ValueTypeOf<typeof inTime.keyType> }).ik);
    const sameTile = equalFor(StructType({ on: StructType({ state: StringType }), level: RecordLevelType, tile: DateTimeType }));
    let tilesMet = 1;
    let shared = 0;
    for (let i = 1; i < filed.length; i++) {
      const [a, b] = [filed[i - 1]!, filed[i]!];
      if (!sameTile({ on: a.on, level: a.level, tile: a.tile }, { on: b.on, level: b.level, tile: b.tile })) { tilesMet += 1; continue; }
      shared += 1;
      assert.ok(keyOrder(a.key, b.key) <= 0, `within a tile, ${a.key} is filed before ${b.key}`);
    }
    assert.ok(tilesMet > 20 && shared > 20, `the jobs fill many tiles, several presses to a tile: ${tilesMet} tiles, ${shared} entries beside another of their tile`);
    assert.ok(filed.every((ik) => !ik.past), 'past is false in every entry');

    // A range through a last press: its end gives `past` true, after every entry of that press and before the next press's.
    const every = jobSeries('jobs_by_week', { key: 'press', from: 'start', to: 'end', tile: 'week', order: 'time' });
    const entryType = StructType({ ik: every.keyType, k: StringType });
    const through = East.compile(East.function([DictType(entryType, JobRow), RecordLevelType, DateTimeType, StringType, StringType], SetType(StringType),
      ($, entries, level, tile, first, last) => {
        // Led by no field: its `on` the empty struct, given as a value.
        const on = $.const({}, StructType({}));
        return entries.range({
          from: { ik: { on, level, tile, key: first } },
          to: { ik: { on, level, tile, key: last, past: true } },
        }).keys().toSet((_$2, entry) => entry.ik.key);
      }), []);
    const held = new SortedMap(emitted(every, rows), compareFor(entryType) as never);
    // The tile, of any level, holding jobs on the most presses, and the presses filed under it, in order.
    const sameTileOf = equalFor(StructType({ level: RecordLevelType, tile: DateTimeType }));
    const pressesUnder = (at: { level: ValueTypeOf<typeof RecordLevelType>; tile: Date }): string[] => [...new SortedSet(
      [...held.keys()].map((entry) => (entry as ValueTypeOf<typeof entryType>).ik).filter((ik) => sameTileOf({ level: ik.level, tile: ik.tile }, at)).map((ik) => ik.key),
      keyOrder)];
    let fullest: { level: ValueTypeOf<typeof RecordLevelType>; tile: Date } | undefined;
    for (const entry of held.keys()) {
      const { level, tile } = (entry as ValueTypeOf<typeof entryType>).ik;
      if (fullest === undefined || pressesUnder({ level, tile }).length > pressesUnder(fullest).length) fullest = { level, tile };
    }
    const presses = pressesUnder(fullest!);
    assert.ok(presses.length >= 3, `one tile holds jobs on several presses: ${presses.join(', ')}`);
    const read = (first: string, last: string) => through(held as never, fullest!.level, fullest!.tile, first, last);
    assertEast(SetType(StringType), read(presses[0]!, presses[1]!), new SortedSet(presses.slice(0, 2), keyOrder), 'from the first press through the second: both, and no third');
    assertEast(SetType(StringType), read(presses[1]!, presses[presses.length - 1]!), new SortedSet(presses.slice(1), keyOrder), 'through the last press: its entries too');
    assertEast(SetType(StringType), read(presses[1]!, presses[1]!), new SortedSet([presses[1]!], keyOrder), 'one press, from it through it');
  });

  it('in time order, its reader gives a window\'s events on every press under its leading fields, each once (#1710)', () => {
    const rec = record('jobs', JobsType, {
      initial: new Map(),
      indexes: (index) => ({ jobs_by_state_week: index.series({ on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'week', order: 'time' }) }),
    });
    const series = indexInput(rec.indexes.jobs_by_state_week);
    const events = East.compile(East.function([series.type, StringType, DateTimeType, DateTimeType], JobsType, ($, entries, state, from, to) =>
      series.read(entries).events({ on: { state }, from, to }).collect($)), []);
    const counted = East.compile(East.function([series.type, StringType, DateTimeType, DateTimeType], IntegerType, ($, entries, state, from, to) => {
      const given = $.let(0n);
      series.read(entries).events({ on: { state }, from, to }).each($, ($) => { $.assign(given, given.add(1n)); });
      return given;
    }), []);
    const rows = editedJobs(seededJobs());
    // A job a year and a half long, filed under each year it touches: a window across the turn meets it twice, and is given it once.
    rows.set('X-long', job(2, OCT_5 - 200n * DAY, OCT_5 + 340n * DAY));
    const held = new SortedMap(emitted(rec.indexes.jobs_by_state_week, rows), compareFor(series.type.key) as never);
    // The edges a series index in key order reads by: an instant inside from `from` and outside at `to`, a span where it starts before `to` and ends after `from`.
    const time = compareFor(DateTimeType);
    const overlaps = (row: Job, from: Date, to: Date): boolean => {
      if (row.start.type !== 'some') return false;
      const start = row.start.value;
      const end = row.end.type === 'some' ? row.end.value : start;
      return time(end, start) <= 0 ? time(start, from) >= 0 && time(start, to) < 0 : time(start, to) < 0 && time(end, from) > 0;
    };
    const windows: Array<[string, string]> = [
      ['2026-10-05T00:00:00.000', '2026-10-12T00:00:00.000'], ['2026-10-07T09:00:00.000', '2026-10-07T10:00:00.000'],
      ['2026-08-01T00:00:00.000', '2027-02-01T00:00:00.000'], ['2026-12-28T00:00:00.000', '2027-01-04T00:00:00.000'],
      ['2026-10-12T00:00:00.000', '2026-10-12T00:00:00.000'], ['2026-10-19T00:00:00.000', '2026-10-12T00:00:00.000'],
    ];
    let given = 0;
    for (const [from, to] of windows) {
      for (const state of ['confirmed', 'proposed']) {
        const expected = new SortedMap<string, Job>(
          [...rows].filter(([, row]) => row.state === state && time(at(from), at(to)) < 0 && overlaps(row, at(from), at(to))), keyOrder);
        assertEast(JobsType, events(held as never, state, at(from), at(to)), expected, `the ${state} jobs in [${from}, ${to})`);
        assert.equal(counted(held as never, state, at(from), at(to)), BigInt(expected.size), `each once in [${from}, ${to})`);
        given += expected.size;
      }
    }
    assert.ok(given > 50, `the windows hold jobs: ${given}`);
    assert.ok(events(held as never, 'confirmed', at('2026-12-28T00:00:00.000'), at('2027-01-04T00:00:00.000')).has('X-long'), 'the job across the year\'s turn');
    // One key's events are an index in key order's to read.
    assert.throws(() => East.function([series.type], JobsType, ($, entries) =>
      // @ts-expect-error — in time order the reader takes the leading fields and the window, and no key
      series.read(entries).events({ on: { state: 'confirmed' }, key: 'P-1001', from: at('2026-10-05T00:00:00.000'), to: at('2026-10-12T00:00:00.000') }).collect($)),
    /e3\.index 'jobs\.jobs_by_state_week' events: the index is filed in time order, a tile's events together, .* it takes no `key`/);
  });

  it('beside a nested series index, keeps the value it was given where a series index carrying its row carries the lean row', () => {
    const Machine = StructType({
      site: StringType, start: DateTimeType, end: DateTimeType, jobs: DictType(StringType, StructType({ start: DateTimeType, end: DateTimeType })),
    });
    const MachinesType = DictType(StringType, Machine);
    const Stood = StructType({ site: StringType, start: DateTimeType, end: DateTimeType });
    const machines = record('machines', MachinesType, {
      initial: new Map(),
      indexes: (index) => ({
        machines_in_time: index.nested({ collections: { jobs: index.nested.items({ from: 'start', to: 'end' }) }, tile: 'week' }),
        machines_by_site: index.series({ key: 'site', from: 'start', to: 'end', tile: 'week' }),
        stood_by_site: index.series({ key: 'site', from: 'start', to: 'end', tile: 'week' }, {
          value: East.function([StringType, Machine], Stood, (_$, _key, machine) => ({ site: machine.site, start: machine.start, end: machine.end })),
        }),
      }),
    });
    const rows: RecordIndexDef = machines.indexes.machines_by_site;
    const stood: RecordIndexDef = machines.indexes.stood_by_site;
    assert.equal(builtIndex(machines, stood), stood, 'its own value, as declared');
    const lean = builtIndex(machines, rows);
    assert.equal(lean.valueFn, machines.indexes.machines_in_time.nested.lean, 'the row without the collections the nested index files');
    assert.equal(printType(lean.valueType), printType(Machine));
  });

  describe('refuses, at definition time', () => {
    it('a field of the wrong type, or none, naming the option, the field and its type', () => {
      // @ts-expect-error — from takes a DateTime or an Option<DateTime> field
      assert.throws(() => jobSeries('bad_from', { key: 'press', from: 'title', to: 'end', tile: 'week' }), /from names 'title', of type \.String: from is a DateTime or an Option<DateTime> field/);
      // @ts-expect-error — the row has no such field
      assert.throws(() => jobSeries('bad_to', { key: 'press', from: 'start', to: 'missing', tile: 'week' }), /to names unknown row field 'missing'/);
      // @ts-expect-error — the key is the one field naming what an event is on, never a Set
      assert.throws(() => jobSeries('set_key', { key: 'crews', from: 'start', to: 'end', tile: 'week' }), /key names 'crews', a Set/);
      // @ts-expect-error — the row has no such field
      assert.throws(() => jobSeries('bad_key', { key: 'machine', from: 'start', to: 'end', tile: 'week' }), /key names unknown row field 'machine'/);
    });

    it('a tile that is not one of the five, and the key among the leading fields', () => {
      // @ts-expect-error — a tile is one of the five
      assert.throws(() => jobSeries('hourly', { key: 'press', from: 'start', to: 'end', tile: 'hour' }), /takes a tile: "day", "week", "month", "quarter", "year" — got "hour"/);
      assert.throws(() => jobSeries('led_by_key', { on: ['press'], key: 'press', from: 'start', to: 'end', tile: 'week' }), /'press' follows the leading fields, and cannot be one/);
    });

    it('an order that is neither by key nor by time, naming the two; and an order on a summary, which is filed by key', () => {
      // @ts-expect-error — an order is 'key' or 'time'
      assert.throws(() => jobSeries('by_row', { key: 'press', from: 'start', to: 'end', tile: 'week', order: 'row' }),
        /e3\.record 'jobs': index\.series 'by_row' order is 'key' — a key's events together, .* — or 'time' — a tile's events together in their keys' order, .* — not "row"/);
      // @ts-expect-error — a summary index is filed by key
      assert.throws(() => jobSummary('totals_in_time', { key: 'press', from: 'start', to: 'end', tile: 'week', order: 'time' }),
        /e3\.record 'jobs': index\.summary 'totals_in_time' takes on, key, from, to, tile, not order — a summary index is filed by key, a key's tiles together: an order is a series index's/);
    });

    it('the start or the end among the leading fields: a leading field is matched exactly, before the tile they are cut by', () => {
      // Led by its own start, a series' entries of one tile on a block of keys
      // are a range for each instant an event starts at, never one range.
      assert.throws(() => jobSeries('led_by_start', { on: ['start'], key: 'press', from: 'start', to: 'end', tile: 'week' }),
        /e3\.record 'jobs': index\.series 'led_by_start': 'start' is the event's start, which its tiles are cut by, and cannot be a leading field/);
      assert.throws(() => jobSeries('led_by_end', { on: ['state', 'end'], key: 'press', from: 'start', to: 'end', tile: 'week' }),
        /e3\.record 'jobs': index\.series 'led_by_end': 'end' is the event's end, which its tiles are cut by, and cannot be a leading field/);
      assert.throws(() => jobSummary('totals_led_by_start', { on: ['start'], key: 'press', from: 'start', to: 'end', tile: 'week' }),
        /e3\.record 'jobs': index\.summary 'totals_led_by_start': 'start' is the event's start, which its tiles are cut by, and cannot be a leading field/);
    });

    it('a value that is no struct holding the event\'s start and end, one among the spec\'s fields, and an option that is neither a value nor a runner', () => {
      const spec = { key: 'press', from: 'start', to: 'end', tile: 'week' } as const;
      const holds = /a series index's value is a struct holding the event's 'start' and 'end', as the row does, which a reader tests a window by/;
      assert.throws(() => jobTiles('valued', spec, East.function([StringType, JobRow], StringType, (_$, k) => k)),
        /e3\.record 'jobs': index\.series 'valued' value gives \.String: a series index's value is a struct holding the event's 'start' and 'end'/);
      const Ended = StructType({ title: StringType, start: OptionType(DateTimeType) });
      assert.throws(() => jobTiles('valued', spec, East.function([StringType, JobRow], Ended, (_$, _k, row) => ({ title: row.title, start: row.start }))),
        /e3\.record 'jobs': index\.series 'valued' value gives .*, which holds no DateTime 'end': /);
      const Worded = StructType({ start: StringType, end: OptionType(DateTimeType) });
      const worded = () => jobTiles('valued', spec, East.function([StringType, JobRow], Worded, (_$, _k, row) => ({ start: row.title, end: row.end })));
      assert.throws(worded, /which holds no DateTime 'start': /);
      assert.throws(worded, holds);
      assert.throws(() => jobTiles('valued', spec, East.function([StringType], JobTile, (_$, k) => ({ press: k, title: k, start: none, end: none }))),
        /e3\.record 'jobs': index\.series 'valued' 'value' projection must take the record's entry/);
      // @ts-expect-error — a series index's value is an option beside its spec
      assert.throws(() => jobSeries('valued', { ...spec, value: tileOf }), /a series index's value is an option beside these: index\.series\(\{ … \}, \{ value \}\)/);
      assert.throws(() => record('jobs', JobsType, {
        // @ts-expect-error — a series index takes a value and a runner
        indexes: (index) => ({ valued: index.series(spec, { values: tileOf }) }),
      }), /e3\.record 'jobs': index\.series 'valued' takes value and runner, not values/);
    });

    it('the guards every index applies to its name and its record — a row field may be named anything (#1432)', () => {
      // A row field named `__tile`, `tile` or `key` reserves nothing: the index builds, led by them.
      const Named = StructType({ press: StringType, start: DateTimeType, end: DateTimeType, __tile: IntegerType, tile: StringType, key: StringType });
      const named = record('named', DictType(StringType, Named), {
        initial: new Map(),
        indexes: (index) => ({
          named_tile: index.series({ on: ['__tile', 'tile', 'key'], key: 'press', from: 'start', to: 'end', tile: 'day' }),
        }),
      });
      const byNamed = named.indexes.named_tile;
      assert.equal(printType(byNamed.keyType),
        printType(StructType({ on: StructType({ __tile: IntegerType, tile: StringType, key: StringType }), key: StringType, level: RecordLevelType, tile: DateTimeType })));
      assert.throws(() => jobSeries('primary', { key: 'press', from: 'start', to: 'end', tile: 'day' }), /e3\.record 'jobs': index\.series cannot be named 'primary'/);
      assert.throws(() => jobSeries('by tile', { key: 'press', from: 'start', to: 'end', tile: 'day' }), /must be an identifier/);
    });
  });
});

// ── The summary index ────────────────────────────────────────────────────────

describe('index.summary — its contributions and declaration', () => {
  const scheduled = (start: string | null, end: string | null): Job => decodeJob(encodeJob({
    press: 'P-1001', crews: new SortedSet(['north', 'south'], keyOrder), state: 'confirmed',
    start: start === null ? none : some(at(start)), end: end === null ? none : some(at(end)), title: 'Brochure run',
  }));

  it('counts an event once under each tile it touches, with the milliseconds of it covered; an instant covers none; no start counts nowhere', () => {
    const def = jobSummary('jobs_by_press_week_totals', { key: 'press', from: 'start', to: 'end', tile: 'week' });
    const byCrew = jobSummary('jobs_by_crew_press_week_totals', { on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'week' });
    const contribute = East.compile(functionAt(def.keyFn, [StringType, JobRow], DictType(def.keyType, RecordSummaryTotalsType)), []);
    const contributeByCrew = East.compile(functionAt(byCrew.keyFn, [StringType, JobRow], DictType(byCrew.keyType, RecordSummaryTotalsType)), []);
    const contributions = DictType(def.keyType, RecordSummaryTotalsType);
    const order = compareFor(def.keyType);
    const oct5 = at('2026-10-05T00:00:00.000');
    const oct12 = at('2026-10-12T00:00:00.000');
    // Wednesday 06:00 to the next Tuesday 06:00: 114 hours of one week, 30 of the next.
    const row = scheduled('2026-10-07T06:00:00.000', '2026-10-13T06:00:00.000');
    assertEast(contributions, contribute('W-0001', row), new SortedMap([
      [{ on: {}, key: 'P-1001', tile: oct5 }, { count: 1n, ms: 114n * HOUR }],
      [{ on: {}, key: 'P-1001', tile: oct12 }, { count: 1n, ms: 30n * HOUR }],
    ], order), 'a week and the next');
    assertEast(DictType(byCrew.keyType, RecordSummaryTotalsType), contributeByCrew('W-0001', row), new SortedMap([
      [{ on: { crews: 'north' }, key: 'P-1001', tile: oct5 }, { count: 1n, ms: 114n * HOUR }],
      [{ on: { crews: 'north' }, key: 'P-1001', tile: oct12 }, { count: 1n, ms: 30n * HOUR }],
      [{ on: { crews: 'south' }, key: 'P-1001', tile: oct5 }, { count: 1n, ms: 114n * HOUR }],
      [{ on: { crews: 'south' }, key: 'P-1001', tile: oct12 }, { count: 1n, ms: 30n * HOUR }],
    ], compareFor(byCrew.keyType)), 'once a crew');
    assertEast(contributions, contribute('W-0001', scheduled('2026-10-07T06:00:00.000', null)), new SortedMap([
      [{ on: {}, key: 'P-1001', tile: oct5 }, { count: 1n, ms: 0n }],
    ], order), 'an instant');
    assertEast(contributions, contribute('W-0001', scheduled(null, null)), new SortedMap([], order), 'not yet scheduled');
  });

  it('types its key from the spec and holds its totals, with no projection to carry', () => {
    const def = jobSummary('jobs_by_state_press_month_totals', { on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'month' });
    const keyType: StructType<{ on: StructType<{ state: typeof StringType }>; key: typeof StringType; tile: typeof DateTimeType }> = def.keyType;
    const fields: readonly ['state'] = def.on;
    assert.equal(printType(keyType), printType(StructType({ on: StructType({ state: StringType }), key: StringType, tile: DateTimeType })),
      'its leading fields under on, the key, then the tile');
    assert.deepEqual(fields, ['state']);
    assert.equal(printType(def.valueType), printType(RecordSummaryTotalsType), 'its value is its totals');
    assert.deepEqual(def.summary, { key: 'press', from: 'start', to: 'end', tile: 'month' });
    assert.equal(def.series, undefined);
    assert.equal(def.valueFn, undefined, 'no projection');
    assert.equal(def.multi, true, 'a row touches several keys');
  });

  it('refuses a value, and what a series index refuses', () => {
    // @ts-expect-error — a summary index holds its totals, and takes no value
    assert.throws(() => jobSummary('valued', { key: 'press', from: 'start', to: 'end', tile: 'week', value: East.function([StringType, JobRow], StringType, (_$, k) => k) }),
      /a summary index holds its totals, so it takes no value/);
    // @ts-expect-error — the key is never a Set
    assert.throws(() => jobSummary('set_key', { key: 'crews', from: 'start', to: 'end', tile: 'week' }), /e3\.record 'jobs': index\.summary 'set_key' key names 'crews', a Set/);
    // @ts-expect-error — a tile is one of the five
    assert.throws(() => jobSummary('hourly', { key: 'press', from: 'start', to: 'end', tile: 'hour' }), /e3\.record 'jobs': index\.summary 'hourly' takes a tile/);
    assert.throws(() => jobSummary('primary', { key: 'press', from: 'start', to: 'end', tile: 'day' }), /e3\.record 'jobs': index\.summary cannot be named 'primary'/);
  });
});

// ── Through a write and a rebuild ────────────────────────────────────────────

describe('series and summary indexes — through a write and a rebuild', () => {
  it('maintains each series index as a rebuild emits it — inserts, moves, stretches, unscheduling, deletes — byte for byte', () => {
    const rec = record('jobs', JobsType, {
      initial: new Map(),
      indexes: (index) => ({
        jobs_by_press_day: index.series({ key: 'press', from: 'start', to: 'end', tile: 'day' }),
        jobs_by_state_press_week: index.series({ on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'week' }),
        jobs_by_crew_press_month: index.series({ on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'month' }),
        // In time order, the tile before the key (#1710): the same filings, so the same writes, at other places.
        jobs_by_state_week_in_time: index.series({ on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'week', order: 'time' }),
        job_tiles_by_crew_day_in_time: index.series({ on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'day', order: 'time' }, { value: tileOf }),
      }),
      mutations: (mutation) => ({ patch: mutation.patch() }),
    });
    const before = seededJobs();
    assertMaintainedIsRebuilt(package_('series_indexes', '1.0.0', rec).records.jobs!, rec.mutations.patch, Object.values(rec.indexes), before, editedJobs(before));
  });

  it('maintains a series index carrying a value as a rebuild emits it, and writes it nothing for a change its value does not give (#1710)', () => {
    const rec = record('jobs', JobsType, {
      initial: new Map(),
      indexes: (index) => ({
        job_tiles_by_press_week: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }, { value: tileOf }),
        job_tiles_by_crew_press_day: index.series({ on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'day' }, { value: tileOf }),
        job_rows_by_press_week: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
      }),
      mutations: (mutation) => ({ patch: mutation.patch() }),
    });
    const patch = rec.mutations.patch;
    const assembled = package_('series_values', '1.0.0', rec).records.jobs!;
    const before = seededJobs();
    assertMaintainedIsRebuilt(assembled, patch, Object.values(rec.indexes), before, editedJobs(before));

    // Every scheduled job confirmed or proposed anew: a change no tile gives, and the whole row does.
    const restated = new SortedMap<string, Job>([...before].map(([key, row]) => [key, { ...row, state: row.state === 'confirmed' ? 'proposed' : 'confirmed' }]), keyOrder);
    const changes = written(assembled, patch, before, restated);
    const targets = (name: string) => changes.filter((change) => change.target === name).length;
    assert.equal(targets('job_tiles_by_press_week'), 0, 'no entry of a tile moves');
    assert.equal(targets('job_tiles_by_crew_press_day'), 0, 'under any leading field');
    assert.equal(targets('job_rows_by_press_week'), [...before.values()].filter((row) => row.start.type === 'some').length, 'each scheduled job\'s whole row is carried again');
  });

  it('changes each summary by what its rows took away and gave, a key once and never by nothing — to the totals a rebuild sums', () => {
    const rec = record('jobs', JobsType, {
      initial: new Map(),
      indexes: (index) => ({
        jobs_by_press_day_totals: index.summary({ key: 'press', from: 'start', to: 'end', tile: 'day' }),
        jobs_by_press_week_totals: index.summary({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
        jobs_by_crew_press_month_totals: index.summary({ on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'month' }),
      }),
      mutations: (mutation) => ({ patch: mutation.patch() }),
    });
    const summaries: RecordIndexDef[] = Object.values(rec.indexes);
    const patch = rec.mutations.patch;
    const assembled = package_('summary_indexes', '1.0.0', rec).records.jobs!;
    const before = seededJobs();
    const after = editedJobs(before);
    const changes = written(assembled, patch, before, after);
    const sameInteger = equalFor(IntegerType);
    const integerOrder = compareFor(IntegerType);
    for (const index of summaries) {
      const entryType = StructType({ ik: index.keyType, k: NullType });
      const collection = DictType(entryType, RecordSummaryTotalsType);
      const adds = changes.filter((change) => change.target === index.name);
      assert.ok(adds.length > 0, `${index.name}: the write changes some totals`);
      assert.equal(new SortedSet(adds.map((change) => change.key) as never, compareFor(entryType)).size, adds.length,
        `${index.name}: the change a key's rows make is summed, and in the delta once`);
      const maintained = summed(index, [before]);
      for (const { key, op } of adds) {
        const change = op as RecordSummaryOp;
        assert.equal(change.type, 'add', `${index.name}: every op adds to a total`);
        assert.ok(!(sameInteger(change.value.count, 0n) && sameInteger(change.value.ms, 0n)), `${index.name}: no change by nothing`);
        const held = maintained.get(key);
        const count = (held?.count ?? 0n) + change.value.count;
        const ms = (held?.ms ?? 0n) + change.value.ms;
        assert.ok(integerOrder(count, 0n) >= 0 && integerOrder(ms, 0n) >= 0, `${index.name}: a total never falls below none`);
        if (sameInteger(count, 0n)) {
          assert.ok(sameInteger(ms, 0n), `${index.name}: a key no row touches covers no time`);
          maintained.delete(key);
        } else {
          maintained.set(key, { count, ms });
        }
      }
      assert.deepEqual(encodeBeast2PagedFor(collection)(maintained as never), encodeBeast2PagedFor(collection)(summed(index, [after]) as never),
        `${index.name}: the totals held plus the write's changes are the rebuild's, byte for byte`);
    }
  });

  it('writes nothing to a summary when no event moves, and one change for a key two new rows share', () => {
    const rec = record('jobs', JobsType, {
      initial: new Map(),
      indexes: (index) => ({
        jobs_by_press_week: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
        jobs_by_press_week_totals: index.summary({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
      }),
      mutations: (mutation) => ({ patch: mutation.patch() }),
    });
    const { jobs_by_press_week: series, jobs_by_press_week_totals: summary } = rec.indexes;
    const patch = rec.mutations.patch;
    const assembled = package_('summary_writes', '1.0.0', rec).records.jobs!;
    const scheduled = (title: string, start: string, end: string): Job => decodeJob(encodeJob({
      press: 'P-1001', crews: new SortedSet([], keyOrder), state: 'confirmed', start: some(at(start)), end: some(at(end)), title,
    }));
    // Seven hours each, in the weeks of 5 and 12 October.
    const before = new SortedMap<string, Job>([
      ['W-0001', scheduled('Brochure run', '2026-10-05T06:00:00.000', '2026-10-05T13:00:00.000')],
      ['W-0002', scheduled('Menu cards', '2026-10-13T06:00:00.000', '2026-10-13T13:00:00.000')],
    ], keyOrder);
    const of = (target: string, changes: ReturnType<typeof written>) => changes.filter((change) => change.target === target);

    const retitled = new SortedMap<string, Job>([...before], keyOrder);
    retitled.set('W-0001', { ...before.get('W-0001')!, title: 'Brochure reprint' });
    const retitle = written(assembled, patch, before, retitled);
    assert.deepEqual(of(summary.name, retitle), [], 'a retitle changes no total');
    assert.deepEqual(of(series.name, retitle).map((change) => change.op.type), ['update'], 'the series index updates the entry carrying the row');

    const swapped = new SortedMap<string, Job>([...before], keyOrder);
    swapped.set('W-0001', { ...before.get('W-0001')!, start: before.get('W-0002')!.start, end: before.get('W-0002')!.end });
    swapped.set('W-0002', { ...before.get('W-0002')!, start: before.get('W-0001')!.start, end: before.get('W-0001')!.end });
    const swap = written(assembled, patch, before, swapped);
    assert.deepEqual(of(summary.name, swap), [], 'two jobs of one length swapping weeks change each week by nothing');
    assert.equal(of(series.name, swap).length, 4, 'each leaves its week and enters the other');

    const added = new SortedMap<string, Job>([...before], keyOrder);
    added.set('W-0003', scheduled('Event posters', '2026-10-07T07:00:00.000', '2026-10-07T12:00:00.000'));
    added.set('W-0004', scheduled('Store flyers', '2026-10-08T06:00:00.000', '2026-10-08T16:00:00.000'));
    const add = of(summary.name, written(assembled, patch, before, added));
    assert.equal(add.length, 1, 'two new jobs in one week on one press are one change');
    assertEast(StructType({ ik: summary.keyType, k: NullType }), add[0]!.key,
      { ik: { on: {}, key: 'P-1001', tile: at('2026-10-05T00:00:00.000') }, k: null }, 'under their press and week');
    assertEast(RecordSummaryOpType, add[0]!.op, variant('add', { count: 2n, ms: 15n * HOUR }), 'counting both, and their hours');
  });

  it('sums a build split into pieces, in any order, to the totals one piece sums', () => {
    const def = jobSummary('jobs_by_press_week_totals', { key: 'press', from: 'start', to: 'end', tile: 'week' });
    const rows = seededJobs();
    const entries = [...rows];
    const piece = (from: number, to: number) => new SortedMap<string, Job>(entries.slice(from, to), keyOrder);
    const [a, b, c] = [piece(0, 25), piece(25, 50), piece(50, entries.length)];
    const collection = DictType(StructType({ ik: def.keyType, k: NullType }), RecordSummaryTotalsType);
    const encode = (totals: SortedMap<unknown, RecordSummaryTotals>) => encodeBeast2PagedFor(collection)(totals as never);
    const whole = encode(summed(def, [rows]));
    assert.deepEqual(encode(summed(def, [a, b, c])), whole, 'three pieces');
    assert.deepEqual(encode(summed(def, [c, a, b])), whole, 'in another order');
  });

  it('refuses a key\'s totals summed past the largest Integer, naming the summary, the key and a finer tile, rather than wrap', () => {
    // East's Integer addition wraps, so a build summing past the largest
    // Integer stored a total below none, which no write could then add to.
    const def = jobSummary('jobs_by_press_year_totals', { key: 'press', from: 'start', to: 'end', tile: 'year' });
    const merge = summaryMergeProgram(def).compile([]) as (entry: unknown, a: RecordSummaryTotals, b: RecordSummaryTotals) => RecordSummaryTotals;
    const entry = { ik: { on: {}, key: 'P-1001', tile: at('2026-01-01T00:00:00.000') }, k: null };
    const most = (1n << 63n) - 1n;
    assertEast(RecordSummaryTotalsType, merge(entry, { count: 2n, ms: most - 10n }, { count: 1n, ms: 10n }), { count: 3n, ms: most },
      'a sum at the largest Integer is a total');
    const past = /^jobs_by_press_year_totals: the totals under \(ik=\(on=\(\), key="P-1001", tile=2026-01-01T00:00:00\.000\), k=null\) sum past the largest Integer: declare a finer tile, whose totals are smaller/;
    assert.throws(() => merge(entry, { count: 2n, ms: most - 10n }, { count: 1n, ms: 11n }), past, 'the time they cover');
    assert.throws(() => merge(entry, { count: most, ms: 0n }, { count: 1n, ms: 0n }), past, 'the rows touching it');
  });
});
