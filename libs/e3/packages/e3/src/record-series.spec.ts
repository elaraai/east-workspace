/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `e3.recordIndex.series` and `e3.recordIndex.summary` (#1039): the tiles an
 * event touches and its share of each, against a direct oracle written with
 * the host's calendar rather than East's; the keys and contributions they
 * generate; their declared types; their refusals; and how a write keeps them —
 * a series index equals its rebuild, and a summary's changes, added to the
 * totals it held, equal the totals a rebuild sums. That every runtime files an
 * event alike is e3-core's series spec, which runs the programs on each.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DateTimeType, DictType, East, IntegerType, NullType, OptionType, PatchType, SetType, SortedMap, SortedSet,
  StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, encodeBeast2PagedFor, equalFor, none, parseFor,
  printFor, printType, some, variant,
  type EastType, type FunctionExpr, type ValueTypeOf,
} from '@elaraai/east';
import { RecordSummaryOpType, RecordSummaryTotalsType, type RecordSummaryOp, type RecordSummaryTotals } from '@elaraai/e3-types';
import { record } from './record.js';
import { recordIndex, type IndexKeyOf, type IndexOn } from './record-index.js';
import { MAX_EVENT_TILES, RECORD_TILES, checkTile, tileNext, tileShares, tileStart, type RecordTile } from './record-tiles.js';
import { buildMutationProgram, indexBuildProgram, summaryMergeProgram } from './record-programs.js';
import { mutation } from './mutation.js';
import { package_ } from './package.js';
import type { MutationDef, RecordDef, RecordIndexDef } from './types.js';

/** A print job: the press it runs on, the crews on it, its state, and when it runs, or not yet. */
const JobRow = StructType({
  press: StringType, crews: SetType(StringType), state: StringType,
  start: OptionType(DateTimeType), end: OptionType(DateTimeType), title: StringType,
});
const JobsType = DictType(StringType, JobRow);
type Job = ValueTypeOf<typeof JobRow>;
type Jobs = SortedMap<string, Job>;
const jobs = () => record('jobs', JobsType, new Map());
const keyOrder = compareFor(StringType);
const decodeJob = decodeBeast2For(JobRow);
const encodeJob = encodeBeast2For(JobRow);

/** A press's shift: always placed, its start and end plain DateTimes. */
const ShiftRow = StructType({ press: StringType, start: DateTimeType, end: DateTimeType });
const shifts = () => record('shifts', DictType(StringType, ShiftRow), new Map());

const DAY = 86_400_000n;
const HOUR = 3_600_000n;
const WEEK = 7n * DAY;
/** 1969-12-29, the Monday before the epoch, in milliseconds. */
const MONDAY = -3n * DAY;
/** How far either side of 1970 the drawn instants reach: about 410 years. */
const SPAN = 13_000_000_000_000;

const readInstant = parseFor(DateTimeType);
/** An instant written as East prints one, read by East's parser. */
function at(text: string): ValueTypeOf<typeof DateTimeType> {
  const read = readInstant(text);
  if (!read.success) throw new Error(`'${text}' is not an instant East reads`);
  return read.value;
}

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

/** Asserts an East value equals the one expected, by its type, printing both as East does when it does not. */
function assertEast<T extends EastType>(type: T, actual: unknown, expected: ValueTypeOf<T>, what: string): void {
  if (equalFor(type)(actual as ValueTypeOf<T>, expected)) return;
  const print = printFor(type);
  assert.fail(`${what}:\n  got      ${print(actual as ValueTypeOf<T>)}\n  expected ${print(expected)}`);
}

/** A seeded stream of numbers in [0, 1) (mulberry32), so a failure names a case that comes again. */
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

/** An instant's milliseconds from the epoch, read by East. */
const millisecondsOf = East.compile(East.function([DateTimeType], IntegerType, (_$, t) => t.toEpochMilliseconds()), []);

/** A tile's functions over epoch milliseconds: what each runtime computes, its instants made and read by East. */
function compiled(tile: RecordTile) {
  const startOf = East.compile(tileStart(tile), []);
  const nextOf = East.compile(tileNext(tile), []);
  const sharesOf = East.compile(tileShares(tile), []);
  return {
    start: (ms: bigint) => millisecondsOf(startOf(instant(ms))),
    next: (ms: bigint) => millisecondsOf(nextOf(instant(ms))),
    shares: (from: bigint, to: bigint, what: string) => sharesOf(instant(from), instant(to), what)
      .map((share) => ({ tile: millisecondsOf(share.tile), ms: share.ms })),
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
  const draw = stream(1039);
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

/** The `[entry, value]` pairs an index's build program emits for `rows`. */
function emitted(def: RecordIndexDef, rows: Jobs): [unknown, unknown][] {
  const out: [unknown, unknown][] = [];
  const run = indexBuildProgram(JobsType, def).compile([]) as (
    piece: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
  run(rows, (entry, value) => {
    out.push([entry, value]);
    return null;
  });
  return out;
}

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

const diffJobs = East.compile(East.function([JobsType, JobsType], PatchType(JobsType), (_$, a, b) => East.diff(a, b)), []);

/** The delta a write's program emits: each entry's target, its key there and its op. */
function written(rec: RecordDef, patch: MutationDef, before: Jobs, after: Jobs): Array<{ target: string; key: unknown; op: variant<string, unknown> }> {
  const changes: Array<{ target: string; key: unknown; op: variant<string, unknown> }> = [];
  const run = buildMutationProgram(rec, patch).compile([]);
  run(before, diffJobs(before, after), (key: variant<string, unknown>, op: variant<string, variant<string, unknown>>) => {
    changes.push({ target: key.type, key: key.value, op: op.value });
    return null;
  });
  return changes;
}

// ── The tiles ────────────────────────────────────────────────────────────────

describe('the tiles an event touches', () => {
  it('takes the five tiles and refuses any other, naming them', () => {
    assert.deepEqual([...RECORD_TILES], ['day', 'week', 'month', 'quarter', 'year']);
    for (const tile of RECORD_TILES) assert.equal(checkTile('e3.recordIndex.series', 'by_tile', tile), tile);
    for (const bad of ['hour', 'Day', '', 7, undefined]) {
      assert.throws(() => checkTile('e3.recordIndex.series', 'by_tile', bad),
        /e3\.recordIndex\.series 'by_tile' takes a tile: "day", "week", "month", "quarter", "year" — got /);
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
      const start = East.compile(tileStart(tile), [])(at(held));
      assert.ok(sameInstant(start, at(first)), `the ${tile} holding ${held} starts ${first}, not ${print(start)}`);
      const next = East.compile(tileNext(tile), [])(start);
      assert.ok(sameInstant(next, at(after)), `the ${tile} after ${first} starts ${after}, not ${print(next)}`);
    }
  });

  it('starts each tile where the calendar does, before 1970 as after, and steps to the next — as the oracle does', () => {
    for (const tile of RECORD_TILES) {
      const { start, next } = compiled(tile);
      const draw = stream(RECORD_TILES.indexOf(tile) + 1039);
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
      const draw = stream(RECORD_TILES.indexOf(tile) + 2039);
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

  it(`refuses an event touching more than ${MAX_EVENT_TILES} tiles, naming it, its span and the tile`, () => {
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

// ── The series index ─────────────────────────────────────────────────────────

describe('e3.recordIndex.series — its keys', () => {
  const scheduled = (start: string | null, end: string | null): Job => decodeJob(encodeJob({
    press: 'P-1001', crews: new SortedSet(['north', 'south'], keyOrder), state: 'confirmed',
    start: start === null ? none : some(at(start)), end: end === null ? none : some(at(end)), title: 'Brochure run',
  }));

  it('files an event under each tile it touches, its leading fields first and a Set fanned out', () => {
    const byPressWeek = recordIndex.series('jobs_by_press_week', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'week' });
    const byStatePressWeek = recordIndex.series('jobs_by_state_press_week', jobs(), { on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'week' });
    const byCrewPressWeek = recordIndex.series('jobs_by_crew_press_week', jobs(), { on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'week' });
    const keysByPressWeek = East.compile(byPressWeek.keyFn as FunctionExpr<any, any>, []) as (key: string, row: Job) => unknown;
    const keysByStatePressWeek = East.compile(byStatePressWeek.keyFn as FunctionExpr<any, any>, []) as (key: string, row: Job) => unknown;
    const keysByCrewPressWeek = East.compile(byCrewPressWeek.keyFn as FunctionExpr<any, any>, []) as (key: string, row: Job) => unknown;
    // Wednesday 06:00 to the next Tuesday 06:00: the weeks of 5 and 12 October.
    const row = scheduled('2026-10-07T06:00:00.000', '2026-10-13T06:00:00.000');
    const oct5 = at('2026-10-05T00:00:00.000');
    const oct12 = at('2026-10-12T00:00:00.000');
    assertEast(SetType(byPressWeek.keyType), keysByPressWeek('W-0001', row), new SortedSet([
      { __tile: oct5, press: 'P-1001' }, { __tile: oct12, press: 'P-1001' },
    ], compareFor(byPressWeek.keyType)), 'a week, then the next');
    assertEast(SetType(byStatePressWeek.keyType), keysByStatePressWeek('W-0001', row), new SortedSet([
      { state: 'confirmed', __tile: oct5, press: 'P-1001' }, { state: 'confirmed', __tile: oct12, press: 'P-1001' },
    ], compareFor(byStatePressWeek.keyType)), 'led by its state');
    assertEast(SetType(byCrewPressWeek.keyType), keysByCrewPressWeek('W-0001', row), new SortedSet([
      { crews: 'north', __tile: oct5, press: 'P-1001' }, { crews: 'north', __tile: oct12, press: 'P-1001' },
      { crews: 'south', __tile: oct5, press: 'P-1001' }, { crews: 'south', __tile: oct12, press: 'P-1001' },
    ], compareFor(byCrewPressWeek.keyType)), 'once a crew');
  });

  it('files an instant, or an end at or before the start, under the one tile holding its start; an end at a tile\'s start is outside it; no start, under none', () => {
    const def = recordIndex.series('jobs_by_press_week', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'week' });
    const keysType = SetType(def.keyType);
    const order = compareFor(def.keyType);
    const oct5 = { __tile: at('2026-10-05T00:00:00.000'), press: 'P-1001' };
    const keys = East.compile(def.keyFn as FunctionExpr<any, any>, []) as (key: string, row: Job) => unknown;
    assertEast(keysType, keys('W-0001', scheduled('2026-10-07T06:00:00.000', null)), new SortedSet([oct5], order), 'no end');
    assertEast(keysType, keys('W-0001', scheduled('2026-10-07T06:00:00.000', '2026-10-01T00:00:00.000')), new SortedSet([oct5], order), 'an end before its start');
    assertEast(keysType, keys('W-0001', scheduled('2026-10-07T06:00:00.000', '2026-10-07T06:00:00.000')), new SortedSet([oct5], order), 'an end at its start');
    assertEast(keysType, keys('W-0001', scheduled('2026-10-07T06:00:00.000', '2026-10-12T00:00:00.000')), new SortedSet([oct5], order), 'an end at the next week\'s start');
    assertEast(keysType, keys('W-0001', scheduled(null, '2026-10-12T00:00:00.000')), new SortedSet([], order), 'no start');
  });

  it('reads a plain DateTime start and end as an Option\'s', () => {
    const def = recordIndex.series('shifts_by_press_day', shifts(), { key: 'press', from: 'start', to: 'end', tile: 'day' });
    const shift = decodeBeast2For(ShiftRow)(encodeBeast2For(ShiftRow)({ press: 'P-1002', start: at('2026-10-05T22:00:00.000'), end: at('2026-10-06T06:00:00.000') }));
    const keys = East.compile(def.keyFn as FunctionExpr<any, any>, []) as (key: string, row: unknown) => unknown;
    assertEast(SetType(def.keyType), keys('S-1', shift), new SortedSet([
      { __tile: at('2026-10-05T00:00:00.000'), press: 'P-1002' }, { __tile: at('2026-10-06T00:00:00.000'), press: 'P-1002' },
    ], compareFor(def.keyType)), 'a night shift is in two days');
  });
});

describe('e3.recordIndex.series — its declaration', () => {
  it('types its key, its fields and its projection from the spec, and carries its fields and tile', () => {
    const def = recordIndex.series('jobs_by_state_press_week', jobs(), { on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'week' });
    const keyType: StructType<{ state: typeof StringType; __tile: typeof DateTimeType; press: typeof StringType }> = def.keyType;
    const fields: readonly ['state', '__tile', 'press'] = def.on;
    const projection: typeof JobRow = def.valueType;
    assert.equal(printType(keyType), printType(StructType({ state: StringType, __tile: DateTimeType, press: StringType })),
      'its leading fields, the tile, then the key');
    assert.deepEqual(fields, ['state', '__tile', 'press']);
    assert.equal(printType(projection), printType(JobRow), 'it carries the whole row');
    assert.deepEqual(def.series, { key: 'press', from: 'start', to: 'end', tile: 'week' });
    assert.equal(def.multi, true, 'an entry a tile');
    assert.equal(def.summary, undefined);
    // The declared types, as the constructor's spec types them.
    type Spec = { on: ['crews']; key: 'press'; from: 'start'; to: 'end'; tile: 'day' };
    const on: IndexOn<Spec> = ['crews', '__tile', 'press'];
    const key: IndexKeyOf<Spec, typeof JobsType> = StructType({ crews: StringType, __tile: DateTimeType, press: StringType });
    assert.ok(on.length === 3 && key.type === 'Struct');
  });

  it('projects each entry as its whole row', () => {
    const def = recordIndex.series('jobs_by_press_week', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'week' });
    const rows = seededJobs();
    const out = emitted(def, rows);
    assert.ok(out.length > rows.size, 'the jobs across a week\'s edge are in more than one');
    const sameJob = equalFor(JobRow);
    for (const [entry, value] of out) {
      const k = (entry as { k: string }).k;
      assert.ok(sameJob(value as Job, rows.get(k)!), `${k}'s projection is its row`);
    }
  });

  describe('refuses, at definition time', () => {
    it('a field of the wrong type, or none, naming the option, the field and its type', () => {
      // @ts-expect-error — from takes a DateTime or an Option<DateTime> field
      assert.throws(() => recordIndex.series('bad_from', jobs(), { key: 'press', from: 'title', to: 'end', tile: 'week' }), /from names 'title', of type \.String: from is a DateTime or an Option<DateTime> field/);
      // @ts-expect-error — the row has no such field
      assert.throws(() => recordIndex.series('bad_to', jobs(), { key: 'press', from: 'start', to: 'missing', tile: 'week' }), /to names unknown row field 'missing'/);
      // @ts-expect-error — the key is the one field naming what an event is on, never a Set
      assert.throws(() => recordIndex.series('set_key', jobs(), { key: 'crews', from: 'start', to: 'end', tile: 'week' }), /key names 'crews', a Set/);
      // @ts-expect-error — the row has no such field
      assert.throws(() => recordIndex.series('bad_key', jobs(), { key: 'machine', from: 'start', to: 'end', tile: 'week' }), /key names unknown row field 'machine'/);
    });

    it('a tile that is not one of the five, and the key among the leading fields', () => {
      // @ts-expect-error — a tile is one of the five
      assert.throws(() => recordIndex.series('hourly', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'hour' }), /takes a tile: "day", "week", "month", "quarter", "year" — got "hour"/);
      assert.throws(() => recordIndex.series('led_by_key', jobs(), { on: ['press'], key: 'press', from: 'start', to: 'end', tile: 'week' }), /'press' follows the leading fields, and cannot be one/);
    });

    it('a value, a row field named __tile, and the guards every index applies to its name and its record', () => {
      // @ts-expect-error — a series index carries the whole row, and takes no value
      assert.throws(() => recordIndex.series('valued', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'week', value: East.function([StringType, JobRow], StringType, (_$, k) => k) }),
        /a series index carries the whole row as its projection, so it takes no value/);
      const Reserved = StructType({ press: StringType, start: DateTimeType, end: DateTimeType, __tile: IntegerType });
      const reserved = record('reserved', DictType(StringType, Reserved), new Map());
      assert.throws(() => recordIndex.series('reserved_tile', reserved, { key: 'press', from: 'start', to: 'end', tile: 'day' }), /field named '__tile'/);
      assert.throws(() => recordIndex.series('primary', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'day' }), /e3\.recordIndex\.series cannot be named 'primary'/);
      assert.throws(() => recordIndex.series('by tile', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'day' }), /must be an identifier/);
    });
  });
});

// ── The summary index ────────────────────────────────────────────────────────

describe('e3.recordIndex.summary — its contributions and declaration', () => {
  const scheduled = (start: string | null, end: string | null): Job => decodeJob(encodeJob({
    press: 'P-1001', crews: new SortedSet(['north', 'south'], keyOrder), state: 'confirmed',
    start: start === null ? none : some(at(start)), end: end === null ? none : some(at(end)), title: 'Brochure run',
  }));

  it('counts an event once under each tile it touches, with the milliseconds of it covered; an instant covers none; no start counts nowhere', () => {
    const def = recordIndex.summary('jobs_by_press_week_totals', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'week' });
    const byCrew = recordIndex.summary('jobs_by_crew_press_week_totals', jobs(), { on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'week' });
    const contribute = East.compile(def.keyFn as FunctionExpr<any, any>, []) as (key: string, row: Job) => unknown;
    const contributeByCrew = East.compile(byCrew.keyFn as FunctionExpr<any, any>, []) as (key: string, row: Job) => unknown;
    const contributions = DictType(def.keyType, RecordSummaryTotalsType);
    const order = compareFor(def.keyType);
    const oct5 = at('2026-10-05T00:00:00.000');
    const oct12 = at('2026-10-12T00:00:00.000');
    // Wednesday 06:00 to the next Tuesday 06:00: 114 hours of one week, 30 of the next.
    const row = scheduled('2026-10-07T06:00:00.000', '2026-10-13T06:00:00.000');
    assertEast(contributions, contribute('W-0001', row), new SortedMap([
      [{ __tile: oct5, press: 'P-1001' }, { count: 1n, ms: 114n * HOUR }],
      [{ __tile: oct12, press: 'P-1001' }, { count: 1n, ms: 30n * HOUR }],
    ], order), 'a week and the next');
    assertEast(DictType(byCrew.keyType, RecordSummaryTotalsType), contributeByCrew('W-0001', row), new SortedMap([
      [{ crews: 'north', __tile: oct5, press: 'P-1001' }, { count: 1n, ms: 114n * HOUR }],
      [{ crews: 'north', __tile: oct12, press: 'P-1001' }, { count: 1n, ms: 30n * HOUR }],
      [{ crews: 'south', __tile: oct5, press: 'P-1001' }, { count: 1n, ms: 114n * HOUR }],
      [{ crews: 'south', __tile: oct12, press: 'P-1001' }, { count: 1n, ms: 30n * HOUR }],
    ], compareFor(byCrew.keyType)), 'once a crew');
    assertEast(contributions, contribute('W-0001', scheduled('2026-10-07T06:00:00.000', null)), new SortedMap([
      [{ __tile: oct5, press: 'P-1001' }, { count: 1n, ms: 0n }],
    ], order), 'an instant');
    assertEast(contributions, contribute('W-0001', scheduled(null, null)), new SortedMap([], order), 'not yet scheduled');
  });

  it('types its key from the spec and holds its totals, with no projection to carry', () => {
    const def = recordIndex.summary('jobs_by_state_press_month_totals', jobs(), { on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'month' });
    const keyType: StructType<{ state: typeof StringType; __tile: typeof DateTimeType; press: typeof StringType }> = def.keyType;
    const fields: readonly ['state', '__tile', 'press'] = def.on;
    assert.equal(printType(keyType), printType(StructType({ state: StringType, __tile: DateTimeType, press: StringType })));
    assert.deepEqual(fields, ['state', '__tile', 'press']);
    assert.equal(printType(def.valueType), printType(RecordSummaryTotalsType), 'its value is its totals');
    assert.deepEqual(def.summary, { key: 'press', from: 'start', to: 'end', tile: 'month' });
    assert.equal(def.series, undefined);
    assert.equal(def.valueFn, undefined, 'no projection');
    assert.equal(def.multi, true, 'a row touches several keys');
  });

  it('refuses a value, and what a series index refuses', () => {
    // @ts-expect-error — a summary index holds its totals, and takes no value
    assert.throws(() => recordIndex.summary('valued', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'week', value: East.function([StringType, JobRow], StringType, (_$, k) => k) }),
      /a summary index holds its totals, so it takes no value/);
    // @ts-expect-error — the key is never a Set
    assert.throws(() => recordIndex.summary('set_key', jobs(), { key: 'crews', from: 'start', to: 'end', tile: 'week' }), /e3\.recordIndex\.summary 'set_key' key names 'crews', a Set/);
    // @ts-expect-error — a tile is one of the five
    assert.throws(() => recordIndex.summary('hourly', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'hour' }), /e3\.recordIndex\.summary 'hourly' takes a tile/);
    assert.throws(() => recordIndex.summary('primary', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'day' }), /e3\.recordIndex\.summary cannot be named 'primary'/);
  });
});

// ── Through a write and a rebuild ────────────────────────────────────────────

describe('series and summary indexes — through a write and a rebuild', () => {
  it('maintains each series index as a rebuild emits it — inserts, moves, stretches, unscheduling, deletes — byte for byte', () => {
    const rec = jobs();
    const indexes = [
      recordIndex.series('jobs_by_press_day', rec, { key: 'press', from: 'start', to: 'end', tile: 'day' }),
      recordIndex.series('jobs_by_state_press_week', rec, { on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'week' }),
      recordIndex.series('jobs_by_crew_press_month', rec, { on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'month' }),
    ];
    const patch = mutation.patch(rec);
    const assembled = package_('series_indexes', '1.0.0', rec, patch, ...indexes).records.jobs!;
    const before = seededJobs();
    const after = editedJobs(before);
    const changes = written(assembled, patch, before, after);
    for (const index of indexes) {
      const keyType = StructType({ ik: index.keyType, k: StringType });
      const collection = DictType(keyType, index.valueType);
      const held = new SortedMap(emitted(index, before) as never, compareFor(keyType));
      const rebuilt = new SortedMap(emitted(index, after) as never, compareFor(keyType));
      const ops = new SortedMap(changes.filter((change) => change.target === index.name).map((change) => [change.key, change.op]) as never, compareFor(keyType));
      assert.ok(ops.size > 0, `${index.name}: the write changes it`);
      const apply = East.compile(East.function([collection, PatchType(collection)], collection, (_$, value, p) => East.applyPatch(value, p)), []);
      const maintained = apply(held as never, variant('patch', ops) as never);
      // Compared as e3 stores a collection, each entry's bytes its own: a
      // rebuild hands every tile of an event the one row, and a write's updates
      // hand each its own copy, which a whole-value encoding would tell apart.
      assert.deepEqual(encodeBeast2PagedFor(collection)(maintained as never), encodeBeast2PagedFor(collection)(rebuilt as never), `${index.name}: maintained is rebuilt, byte for byte`);
    }
  });

  it('changes each summary by what its rows took away and gave, a key once and never by nothing — to the totals a rebuild sums', () => {
    const rec = jobs();
    const summaries = [
      recordIndex.summary('jobs_by_press_day_totals', rec, { key: 'press', from: 'start', to: 'end', tile: 'day' }),
      recordIndex.summary('jobs_by_press_week_totals', rec, { key: 'press', from: 'start', to: 'end', tile: 'week' }),
      recordIndex.summary('jobs_by_crew_press_month_totals', rec, { on: ['crews'], key: 'press', from: 'start', to: 'end', tile: 'month' }),
    ];
    const patch = mutation.patch(rec);
    const assembled = package_('summary_indexes', '1.0.0', rec, patch, ...summaries).records.jobs!;
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
    const rec = jobs();
    const series = recordIndex.series('jobs_by_press_week', rec, { key: 'press', from: 'start', to: 'end', tile: 'week' });
    const summary = recordIndex.summary('jobs_by_press_week_totals', rec, { key: 'press', from: 'start', to: 'end', tile: 'week' });
    const patch = mutation.patch(rec);
    const assembled = package_('summary_writes', '1.0.0', rec, patch, series, summary).records.jobs!;
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
      { ik: { __tile: at('2026-10-05T00:00:00.000'), press: 'P-1001' }, k: null }, 'under their week and press');
    assertEast(RecordSummaryOpType, add[0]!.op, variant('add', { count: 2n, ms: 15n * HOUR }), 'counting both, and their hours');
  });

  it('sums a build split into pieces, in any order, to the totals one piece sums', () => {
    const def = recordIndex.summary('jobs_by_press_week_totals', jobs(), { key: 'press', from: 'start', to: 'end', tile: 'week' });
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
});
