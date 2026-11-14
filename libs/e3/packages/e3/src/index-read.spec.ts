/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A reader for each kind of index (#1618): each reads the rows its words say
 * and no others, each once — held, for seeded records and windows, to a plain
 * loop over the whole record — by the window's edges, in the index's order,
 * and refuses what it is not given where it is called.
 *
 * The entries a reader reads are the ones each index's own build program
 * files for the rows, so a reader is held to the index as it is stored.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, SetType, SortedMap, SortedSet,
  StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, parseFor, printFor, some, variant,
  type EastType, type ValueTypeOf,
} from '@elaraai/east';
import { RecordSummaryTotalsType, type RecordSummaryTotals } from '@elaraai/e3-types';
import { function_ } from './function.js';
import { index } from './index-input.js';
import { input as input_ } from './input.js';
import { output } from './output.js';
import { record } from './record.js';
import { builtIndex, indexBuildProgram, summaryMergeProgram } from './record-programs.js';
import { TILE_FNS } from './record-tiles.js';
import { partition, streamTask, task } from './task.js';
import type { IndexInputDef, IRBundle, RecordDef, RecordIndexDef } from './types.js';

/** A print job: the press it runs on, the crews on it, its state, and when it runs, or not yet. */
const JobRow = StructType({
  press: StringType, crews: SetType(StringType), state: StringType,
  start: OptionType(DateTimeType), end: OptionType(DateTimeType), title: StringType, sheets: FloatType,
});
const JobsType = DictType(StringType, JobRow);
type Job = ValueTypeOf<typeof JobRow>;
type Jobs = SortedMap<string, Job>;
const keyOrder = compareFor(StringType);
const decodeJob = decodeBeast2For(JobRow);
const encodeJob = encodeBeast2For(JobRow);

const jobs = record('jobs', JobsType, {
  initial: new Map(),
  indexes: (index) => ({
    by_press: index.on(['press']),
    by_state_press: index.on(['state', 'press']),
    by_crew: index.on(['crews']),
    by_state_crew: index.on(['state', 'crews']),
    titles: index.key(East.function([StringType, JobRow], StringType, (_$, _key, job) => job.press),
      { value: East.function([StringType, JobRow], StringType, (_$, _key, job) => job.title) }),
    in_time: index.interval({ from: 'start', to: 'end' }),
    in_time_by_state: index.interval({ on: ['state'], from: 'start', to: 'end' }),
    press_weeks: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
    press_days_by_state: index.series({ on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'day' }),
    press_quarters: index.series({ key: 'press', from: 'start', to: 'end', tile: 'quarter' }),
    press_load: index.summary({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
    press_load_by_state: index.summary({ on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'month' }),
  }),
  mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** A press's shift: always placed, its start and end plain DateTimes. */
const ShiftRow = StructType({ press: StringType, start: DateTimeType, end: DateTimeType });
const ShiftsType = DictType(StringType, ShiftRow);
const shifts = record('shifts', ShiftsType, {
  initial: new Map(),
  indexes: (index) => ({
    shifts_in_time: index.interval({ from: 'start', to: 'end' }),
    shifts_by_press: index.series({ key: 'press', from: 'start', to: 'end', tile: 'day' }),
  }),
});

const DAY = 86_400_000n;
const HOUR = 3_600_000n;

const readInstant = parseFor(DateTimeType);
const printInstant = printFor(DateTimeType);
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

const PRESSES = ['P-1001', 'P-1002', 'P-1003'];
const STATES = ['confirmed', 'proposed'];
const CREWS = [[], ['north'], ['north', 'south'], ['east', 'north', 'south']];
/** Monday 5 October 2026, which the seeded jobs are scheduled around. */
const OCT_5 = millisecondsOf(at('2026-10-05T00:00:00.000'));

/** A job, as a write carries it: on a press, crewed, and scheduled from `start` to `end`, or not yet. */
function job(n: number, start: bigint | undefined, end: bigint | undefined): Job {
  return decodeJob(encodeJob({
    press: PRESSES[n % PRESSES.length]!,
    crews: new SortedSet(CREWS[n % CREWS.length]!, keyOrder),
    state: STATES[n % STATES.length]!,
    start: start === undefined ? none : some(instant(start)),
    end: end === undefined ? none : some(instant(end)),
    title: `Job ${n}`,
    sheets: 1000 + n,
  }));
}

/**
 * The jobs the readers read: lengths from an hour to three years, around
 * October 2026 and across the turns of the years either side; some from a
 * day's midnight, some instants with no end, some ending before they start,
 * some not yet scheduled; and the edges, by name.
 */
function seededJobs(): Jobs {
  const draw = stream(1618);
  const rows = new SortedMap<string, Job>(undefined, keyOrder);
  for (let n = 0; n < 400; n++) {
    const start = OCT_5 + BigInt(Math.floor((draw() - 0.5) * 900)) * DAY + BigInt(Math.floor(draw() * 24)) * HOUR;
    // Most are short; one in eight is months long, and one in twenty years long.
    const scale = n % 20 === 7 ? 1100 : n % 8 === 3 ? 200 : 12;
    const length = HOUR + BigInt(Math.floor(draw() ** 2 * scale * 24)) * HOUR;
    const key = `W-${String(n).padStart(4, '0')}`;
    switch (n % 10) {
      case 0: rows.set(key, job(n, undefined, undefined)); break;
      case 1: rows.set(key, job(n, start, undefined)); break;
      case 2: rows.set(key, job(n, start, start - HOUR)); break;
      case 3: rows.set(key, job(n, start - ((start % DAY) + DAY) % DAY, start - ((start % DAY) + DAY) % DAY + length)); break;
      default: rows.set(key, job(n, start, start + length)); break;
    }
  }
  const ms = (text: string) => millisecondsOf(at(text));
  // The edges of the week from Monday 12 October, on the first press, confirmed.
  rows.set('E-ends-at-from', job(0, ms('2026-10-05T00:00:00.000'), ms('2026-10-12T00:00:00.000')));
  rows.set('E-instant-at-from', job(0, ms('2026-10-12T00:00:00.000'), undefined));
  rows.set('E-instant-at-to', job(0, ms('2026-10-19T00:00:00.000'), undefined));
  rows.set('E-starts-at-to', job(0, ms('2026-10-19T00:00:00.000'), ms('2026-10-20T00:00:00.000')));
  rows.set('E-no-end', job(0, ms('2026-10-13T09:00:00.000'), undefined));
  rows.set('E-no-start', job(0, undefined, ms('2026-10-13T09:00:00.000')));
  rows.set('E-ends-before-start', job(0, ms('2026-10-14T09:00:00.000'), ms('2026-10-13T09:00:00.000')));
  rows.set('E-past-a-year', job(0, ms('2025-11-20T06:00:00.000'), ms('2027-02-10T18:00:00.000')));
  rows.set('E-a-millisecond-in', job(0, ms('2026-10-11T00:00:00.000'), ms('2026-10-12T00:00:00.001')));
  return rows;
}

const ROWS = seededJobs();

/** The windows the readers read: the week of the edges, one narrower than a tile, one wider than a year, and seeded ones. */
function windows(): Array<{ from: Date; to: Date }> {
  const draw = stream(55);
  const out = [
    { from: at('2026-10-12T00:00:00.000'), to: at('2026-10-19T00:00:00.000') },
    { from: at('2026-10-12T09:00:00.000'), to: at('2026-10-12T10:00:00.000') },
    { from: at('2025-06-01T00:00:00.000'), to: at('2027-06-01T00:00:00.000') },
    { from: at('2026-12-31T23:59:59.999'), to: at('2027-01-01T00:00:00.001') },
    { from: at('2026-10-12T00:00:00.000'), to: at('2026-10-12T00:00:00.000') },
    { from: at('2026-10-19T00:00:00.000'), to: at('2026-10-12T00:00:00.000') },
  ];
  for (let n = 0; n < 60; n++) {
    const from = OCT_5 + BigInt(Math.floor((draw() - 0.5) * 1000)) * DAY + BigInt(Math.floor(draw() * 24)) * HOUR;
    const length = n % 3 === 0 ? HOUR * BigInt(1 + Math.floor(draw() * 30)) : DAY * BigInt(1 + Math.floor(draw() ** 2 * 500));
    out.push({ from: instant(from), to: instant(from + length) });
  }
  return out;
}

const WINDOWS = windows();

/** An index's entries as its record's state holds them: what its own build program files for the rows. Typed as
 *  whatever a compiled function takes them as, which is the index's own entries' type. */
function entriesOf(rec: RecordDef, declared: RecordIndexDef, rows: unknown): never {
  const def = builtIndex(rec, declared);
  const summary = def.summary !== undefined;
  const entryType = StructType({ ik: def.keyType, k: summary ? NullType : (rec.type as EastType & { key: EastType }).key });
  const entries = new SortedMap<unknown, unknown>(undefined, compareFor(entryType) as never);
  const merge = summary ? summaryMergeProgram(def).compile([]) as (entry: unknown, a: RecordSummaryTotals, b: RecordSummaryTotals) => RecordSummaryTotals : undefined;
  const build = indexBuildProgram(rec.type, def).compile([]) as (piece: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
  build(rows, (entry, value) => {
    const held = entries.get(entry);
    entries.set(entry, held === undefined || merge === undefined ? value : merge(entry, held as RecordSummaryTotals, value as RecordSummaryTotals));
    return null;
  });
  return entries as never;
}

/** Asserts an East value equals the one expected, by its type, printing both as East does when it does not. */
function assertEast<T extends EastType>(type: T, actual: unknown, expected: unknown, what: string): void {
  if (equalFor(type)(actual as ValueTypeOf<T>, expected as ValueTypeOf<T>)) return;
  const print = printFor(type);
  assert.fail(`${what}:\n  got      ${print(actual as ValueTypeOf<T>)}\n  expected ${print(expected as ValueTypeOf<T>)}`);
}

const window = (w: { from: Date; to: Date }): string => `[${printInstant(w.from)}, ${printInstant(w.to)})`;

// ── The plain test, as a loop over the whole record ──────────────────────────

/** Whether a job overlaps `[from, to)`, by the interval index's edges. */
const overlaps = East.function([JobRow, DateTimeType, DateTimeType], BooleanType, ($, job, from, to) => {
  $.match(job.start, {
    some: ($, start) => {
      const end = $.let(job.end.unwrap('some', () => start));
      // No end, or one at or before the start: an instant, inside from `from` and outside at `to`.
      $.if(East.lessEqual(end, start), ($) => { $.return(East.greaterEqual(start, from).and(() => East.less(start, to))); });
      $.return(East.less(start, to).and(() => East.greater(end, from)));
    },
  });
  return false;
});

/** The jobs of a state, or of every state, on a press, or on every press, that overlap a window: a loop over them all. */
const jobsIn = East.compile(East.function(
  [JobsType, OptionType(StringType), OptionType(StringType), DateTimeType, DateTimeType], JobsType,
  ($, rows, state, press, from, to) => {
    const inWindow = $.const(overlaps);
    return rows.filter(($, job) =>
      East.less(from, to)
        .and(() => state.match({ none: () => true, some: (_$, s) => East.equal(job.state, s) }))
        .and(() => press.match({ none: () => true, some: (_$, p) => East.equal(job.press, p) }))
        .and(() => inWindow(job, from, to)));
  },
), []);

/** The keys of some rows, each carrying nothing: what a read of an index that carries nothing collects. */
const keysOf = East.compile(East.function([JobsType], DictType(StringType, NullType), (_$, rows) => rows.map(() => null)), []);

// ── The indexes' entries, and the reads ──────────────────────────────────────

const input = {
  by_press: index(jobs.indexes.by_press),
  by_state_press: index(jobs.indexes.by_state_press),
  by_crew: index(jobs.indexes.by_crew),
  by_state_crew: index(jobs.indexes.by_state_crew),
  titles: index(jobs.indexes.titles),
  in_time: index(jobs.indexes.in_time),
  in_time_by_state: index(jobs.indexes.in_time_by_state),
  press_weeks: index(jobs.indexes.press_weeks),
  press_days_by_state: index(jobs.indexes.press_days_by_state),
  press_quarters: index(jobs.indexes.press_quarters),
  press_load: index(jobs.indexes.press_load),
  press_load_by_state: index(jobs.indexes.press_load_by_state),
};
const held = Object.fromEntries(Object.entries(input).map(([name, at]) => [name, entriesOf(jobs, at.index, ROWS)])) as Record<keyof typeof input, never>;

const Keys = DictType(StringType, NullType);

describe('a read of an index', () => {
  it('gives each row to a body, which may skip one, add to what it holds, and leave the function', () => {
    const byPress = input.by_press;
    const sheets = East.compile(East.function([byPress.type, JobsType, StringType], FloatType, ($, entries, rows, press) => {
      const total = $.let(0.0);
      byPress.read(entries).of(press).each($, ($, _carried, key) => {
        const job = $.let(rows.get(key));
        $.if(East.equal(job.state, 'confirmed'), ($) => { $.assign(total, total.add(job.sheets)); });
      });
      return total;
    }), []);
    const expected = [...ROWS.values()].filter((row) => row.press === 'P-1002' && row.state === 'confirmed').reduce((sum, row) => sum + row.sheets, 0);
    assert.equal(sheets(held.by_press, ROWS, 'P-1002'), expected);

    // The first row of a read, by leaving the function from the body
    const first = East.compile(East.function([byPress.type, StringType], OptionType(StringType), ($, entries, press) => {
      byPress.read(entries).of(press).each($, ($, _carried, key) => { $.return(some(key)); });
      return none;
    }), []);
    assertEast(OptionType(StringType), first(held.by_press, 'P-1003'), some([...ROWS].find(([, row]) => row.press === 'P-1003')![0]), 'the first job on the press');
    assertEast(OptionType(StringType), first(held.by_press, 'P-9999'), none, 'a press with no job');
  });

  it('gives its rows in the index\'s own order, and collects them by the row\'s key', () => {
    const byState = input.by_state_press;
    const inOrder = East.compile(East.function([byState.type, StringType], ArrayType(StringType), ($, entries, state) => {
      const keys = $.let([], ArrayType(StringType));
      byState.read(entries).of({ state }).each($, ($, _carried, key) => { $(keys.pushLast(key)); });
      return keys;
    }), []);
    // By press, then by the row's key: the index's order under a state
    const expected = [...ROWS].filter(([, row]) => row.state === 'proposed')
      .sort(([a, x], [b, y]) => keyOrder(x.press, y.press) || keyOrder(a, b)).map(([key]) => key);
    assertEast(ArrayType(StringType), inOrder(held.by_state_press, 'proposed'), expected, 'the proposed jobs, by press');
  });
});

describe('a plain index\'s readers', () => {
  it('of: the rows under an index key, and under a leading part of one', () => {
    const byPress = input.by_press;
    const on = East.compile(East.function([byPress.type, StringType], Keys, ($, entries, press) => byPress.read(entries).of(press).collect($)), []);
    for (const press of [...PRESSES, 'P-9999']) {
      assertEast(Keys, on(held.by_press, press), keysOf(new SortedMap([...ROWS].filter(([, row]) => row.press === press), keyOrder)), `the jobs on ${press}`);
    }

    const byState = input.by_state_press;
    const whole = East.compile(East.function([byState.type, StringType, StringType], Keys, ($, entries, state, press) =>
      byState.read(entries).of({ state, press }).collect($)), []);
    const leading = East.compile(East.function([byState.type, StringType], Keys, ($, entries, state) => byState.read(entries).of({ state }).collect($)), []);
    for (const state of STATES) {
      assertEast(Keys, leading(held.by_state_press, state), keysOf(new SortedMap([...ROWS].filter(([, row]) => row.state === state), keyOrder)), `the ${state} jobs`);
      assertEast(Keys, whole(held.by_state_press, state, 'P-1001'),
        keysOf(new SortedMap([...ROWS].filter(([, row]) => row.state === state && row.press === 'P-1001'), keyOrder)), `the ${state} jobs on P-1001`);
    }
  });

  it('of: what the index carries, where it carries a value of its own', () => {
    const titles = input.titles;
    const on = East.compile(East.function([titles.type, StringType], DictType(StringType, StringType), ($, entries, press) =>
      titles.read(entries).of(press).collect($)), []);
    const expected = new SortedMap([...ROWS].filter(([, row]) => row.press === 'P-1003').map(([key, row]): [string, string] => [key, row.title]), keyOrder);
    assertEast(DictType(StringType, StringType), on(held.titles, 'P-1003'), expected, 'the titles on P-1003');
  });

  it('between: the rows from one index key up to another, either end left out', () => {
    const byPress = input.by_press;
    const between = East.compile(East.function([byPress.type, StringType, StringType], Keys, ($, entries, from, to) =>
      byPress.read(entries).between({ from, to }).collect($)), []);
    const from = East.compile(East.function([byPress.type, StringType], Keys, ($, entries, from) => byPress.read(entries).between({ from }).collect($)), []);
    const upTo = East.compile(East.function([byPress.type, StringType], Keys, ($, entries, to) => byPress.read(entries).between({ to }).collect($)), []);
    const every = East.compile(East.function([byPress.type], Keys, ($, entries) => byPress.read(entries).between({}).collect($)), []);
    const where = (test: (press: string) => boolean) => keysOf(new SortedMap([...ROWS].filter(([, row]) => test(row.press)), keyOrder));
    assertEast(Keys, between(held.by_press, 'P-1001', 'P-1003'), where((press) => press === 'P-1001' || press === 'P-1002'), 'from P-1001 up to P-1003');
    assertEast(Keys, between(held.by_press, 'P-1003', 'P-1001'), where(() => false), 'an inverted range');
    assertEast(Keys, from(held.by_press, 'P-1002'), where((press) => press !== 'P-1001'), 'from P-1002');
    assertEast(Keys, upTo(held.by_press, 'P-1002'), where((press) => press === 'P-1001'), 'up to P-1002');
    assertEast(Keys, every(held.by_press), where(() => true), 'both ends left out');
  });

  it('gives a row once where the index files it under several keys: a Set field fanned out', () => {
    const byCrew = input.by_crew;
    // One crew's rows are filed under it once each; a range of crews holds a row once for each crew it is on
    const counted = East.compile(East.function([byCrew.type, StringType, StringType], StructType({ given: IntegerType, rows: Keys }), ($, entries, from, to) => {
      const given = $.let(0n);
      const read = byCrew.read(entries).between({ from, to });
      read.each($, ($) => { $.assign(given, given.add(1n)); });
      return { given, rows: read.collect($) };
    }), []);
    const onAny = (crews: readonly string[]) => keysOf(new SortedMap([...ROWS].filter(([, row]) => crews.some((crew) => row.crews.has(crew))), keyOrder));
    const northToSouth = counted(held.by_crew, 'north', 'south\u0000');
    assertEast(Keys, northToSouth.rows, onAny(['north', 'south']), 'the rows on north or south');
    assert.equal(northToSouth.given, BigInt(northToSouth.rows.size), 'each given once, though most are on both');
    assert.ok([...ROWS.values()].filter((row) => row.crews.has('north') && row.crews.has('south')).length > 50, 'most rows on north are on south too');

    const of = East.compile(East.function([byCrew.type, StringType], Keys, ($, entries, crew) => byCrew.read(entries).of(crew).collect($)), []);
    assertEast(Keys, of(held.by_crew, 'south'), onAny(['south']), 'the rows on south');

    // Under a leading part of a key whose Set fans out
    const byStateCrew = input.by_state_crew;
    const inState = East.compile(East.function([byStateCrew.type, StringType], Keys, ($, entries, state) => byStateCrew.read(entries).of({ state }).collect($)), []);
    const crewed = keysOf(new SortedMap([...ROWS].filter(([, row]) => row.state === 'confirmed' && row.crews.size > 0), keyOrder));
    assertEast(Keys, inState(held.by_state_crew, 'confirmed'), crewed, 'the confirmed rows with a crew');
  });
});

describe('an interval index\'s readers', () => {
  const inTime = input.in_time;
  const overlapping = East.compile(East.function([inTime.type, DateTimeType, DateTimeType], Keys, ($, entries, from, to) =>
    inTime.read(entries).overlapping({ from, to }).collect($)), []);
  const counted = East.compile(East.function([inTime.type, DateTimeType, DateTimeType], IntegerType, ($, entries, from, to) => {
    const given = $.let(0n);
    inTime.read(entries).overlapping({ from, to }).each($, ($) => { $.assign(given, given.add(1n)); });
    return given;
  }), []);

  it('overlapping: the rows that overlap a window, each once, for seeded windows', () => {
    for (const w of WINDOWS) {
      const expected = keysOf(jobsIn(ROWS, none, none, w.from, w.to));
      assertEast(Keys, overlapping(held.in_time, w.from, w.to), expected, `the jobs in ${window(w)}`);
      assert.equal(counted(held.in_time, w.from, w.to), BigInt(expected.size), `each once in ${window(w)}`);
    }
  });

  it('overlapping: the window\'s edges', () => {
    const week = overlapping(held.in_time, at('2026-10-12T00:00:00.000'), at('2026-10-19T00:00:00.000'));
    const inside = (key: string) => week.has(key);
    assert.equal(inside('E-ends-at-from'), false, 'an event that ends at `from` is outside');
    assert.equal(inside('E-a-millisecond-in'), true, 'one that ends a millisecond after it is inside');
    assert.equal(inside('E-instant-at-from'), true, 'an instant at `from` is inside');
    assert.equal(inside('E-instant-at-to'), false, 'an instant at `to` is outside');
    assert.equal(inside('E-starts-at-to'), false, 'an event that starts at `to` is outside');
    assert.equal(inside('E-no-end'), true, 'an event with no end is an instant');
    assert.equal(inside('E-ends-before-start'), true, 'one that ends before its start is an instant at its start');
    assert.equal(inside('E-no-start'), false, 'a row with no start is in no window');
    assert.equal(inside('E-past-a-year'), true, 'an event that began a year before reaches in');
  });

  it('overlapping: under each leading field, exactly', () => {
    const byState = input.in_time_by_state;
    const inState = East.compile(East.function([byState.type, StringType, DateTimeType, DateTimeType], Keys, ($, entries, state, from, to) =>
      byState.read(entries).overlapping({ on: { state }, from, to }).collect($)), []);
    for (const w of WINDOWS.slice(0, 20)) {
      for (const state of STATES) {
        assertEast(Keys, inState(held.in_time_by_state, state, w.from, w.to), keysOf(jobsIn(ROWS, some(state), none, w.from, w.to)), `the ${state} jobs in ${window(w)}`);
      }
    }
  });

  it('unset: the rows with no start', () => {
    const unset = East.compile(East.function([inTime.type], Keys, ($, entries) => inTime.read(entries).unset().collect($)), []);
    assertEast(Keys, unset(held.in_time), keysOf(new SortedMap([...ROWS].filter(([, row]) => row.start.type === 'none'), keyOrder)), 'the jobs not yet scheduled');
    const byState = input.in_time_by_state;
    const unsetIn = East.compile(East.function([byState.type, StringType], Keys, ($, entries, state) => byState.read(entries).unset({ on: { state } }).collect($)), []);
    assertEast(Keys, unsetIn(held.in_time_by_state, 'proposed'),
      keysOf(new SortedMap([...ROWS].filter(([, row]) => row.start.type === 'none' && row.state === 'proposed'), keyOrder)), 'the proposed jobs not yet scheduled');
  });
});

describe('a series index\'s readers', () => {
  for (const name of ['press_weeks', 'press_quarters'] as const) {
    const series = input[name];
    const events = East.compile(East.function([series.type, StringType, DateTimeType, DateTimeType], JobsType, ($, entries, press, from, to) =>
      series.read(entries).events({ key: press, from, to }).collect($)), []);
    const counted = East.compile(East.function([series.type, StringType, DateTimeType, DateTimeType], IntegerType, ($, entries, press, from, to) => {
      const given = $.let(0n);
      series.read(entries).events({ key: press, from, to }).each($, ($) => { $.assign(given, given.add(1n)); });
      return given;
    }), []);

    it(`events: a key's events that overlap a window, each once with its row, for seeded windows (${name})`, () => {
      for (const w of WINDOWS) {
        for (const press of PRESSES) {
          const expected = jobsIn(ROWS, none, some(press), w.from, w.to);
          assertEast(JobsType, events(held[name], press, w.from, w.to), expected, `the jobs on ${press} in ${window(w)}`);
          assert.equal(counted(held[name], press, w.from, w.to), BigInt(expected.size), `each once on ${press} in ${window(w)}`);
        }
      }
    });
  }

  it('events: the window\'s edges, and an event past a year across a year\'s turn', () => {
    const series = input.press_weeks;
    const events = East.compile(East.function([series.type, StringType, DateTimeType, DateTimeType], JobsType, ($, entries, press, from, to) =>
      series.read(entries).events({ key: press, from, to }).collect($)), []);
    const week = events(held.press_weeks, 'P-1001', at('2026-10-12T00:00:00.000'), at('2026-10-19T00:00:00.000'));
    assert.deepEqual(['E-ends-at-from', 'E-a-millisecond-in', 'E-instant-at-from', 'E-instant-at-to', 'E-starts-at-to', 'E-no-end', 'E-ends-before-start', 'E-no-start', 'E-past-a-year']
      .map((key) => week.has(key)), [false, true, true, false, false, true, true, false, true]);
    // Filed under 2025, 2026 and 2027: a window across both turns meets it under each, and gives it once
    const across = events(held.press_weeks, 'P-1001', at('2025-12-01T00:00:00.000'), at('2027-01-15T00:00:00.000'));
    assert.equal(across.has('E-past-a-year'), true);
    const filed = [...(held.press_weeks as SortedMap<{ k: string }, unknown>).keys()].filter((entry) => entry.k === 'E-past-a-year').length;
    assert.equal(filed, 3, 'the index files it under each of the three years it touches');
  });

  it('events: under each leading field, exactly', () => {
    const series = input.press_days_by_state;
    const events = East.compile(East.function([series.type, StringType, StringType, DateTimeType, DateTimeType], JobsType, ($, entries, state, press, from, to) =>
      series.read(entries).events({ on: { state }, key: press, from, to }).collect($)), []);
    for (const w of WINDOWS.slice(0, 20)) {
      for (const state of STATES) {
        assertEast(JobsType, events(held.press_days_by_state, state, 'P-1002', w.from, w.to), jobsIn(ROWS, some(state), some('P-1002'), w.from, w.to),
          `the ${state} jobs on P-1002 in ${window(w)}`);
      }
    }
  });

  it('events: rows whose start and end are plain DateTimes', () => {
    const shiftRows = new SortedMap<string, ValueTypeOf<typeof ShiftRow>>(undefined, keyOrder);
    for (let n = 0; n < 60; n++) {
      const start = OCT_5 + BigInt(n) * 8n * HOUR;
      shiftRows.set(`S-${String(n).padStart(3, '0')}`, decodeBeast2For(ShiftRow)(encodeBeast2For(ShiftRow)({ press: PRESSES[n % 3]!, start: instant(start), end: instant(start + 8n * HOUR) })));
    }
    const byPress = index(shifts.indexes.shifts_by_press);
    const events = East.compile(East.function([byPress.type, StringType, DateTimeType, DateTimeType], DictType(StringType, NullType), ($, entries, press, from, to) => {
      const keys = $.let(new Map(), DictType(StringType, NullType));
      byPress.read(entries).events({ key: press, from, to }).each($, ($, _shift, key) => { $(keys.insert(key, null)); });
      return keys;
    }), []);
    const from = at('2026-10-06T08:00:00.000');
    const to = at('2026-10-08T00:00:00.000');
    const expected = new SortedMap([...shiftRows].filter(([, shift]) => shift.press === 'P-1001' && shift.start < to && shift.end > from).map(([key]): [string, null] => [key, null]), keyOrder);
    assert.ok(expected.size > 0);
    assertEast(DictType(StringType, NullType), events(entriesOf(shifts, shifts.indexes.shifts_by_press, shiftRows), 'P-1001', from, to), expected, 'the shifts on P-1001');
  });
});

describe('a summary index\'s readers', () => {
  const Totals = DictType(DateTimeType, RecordSummaryTotalsType);
  const nextOf = East.compile(TILE_FNS.tileNext, []);

  /** The totals an index holds of a key's tiles that overlap a window: a loop over every entry of it. */
  function totalsIn(entries: unknown, tile: 'week' | 'month', on: Record<string, string>, press: string, w: { from: Date; to: Date }) {
    const expected = new SortedMap<Date, RecordSummaryTotals>(undefined, compareFor(DateTimeType));
    const sameOn = equalFor(StructType(Object.keys(on).map((name): readonly [string, EastType] => [name, StringType])));
    const before = compareFor(DateTimeType);
    for (const [entry, totals] of entries as SortedMap<{ ik: { on: Record<string, string>; key: string; tile: Date } }, RecordSummaryTotals>) {
      if (!sameOn(entry.ik.on, on) || !equalFor(StringType)(entry.ik.key, press)) continue;
      const after = nextOf(variant(tile, null), entry.ik.tile);
      if (before(w.from, w.to) < 0 && before(entry.ik.tile, w.to) < 0 && before(after, w.from) > 0) expected.set(entry.ik.tile, totals);
    }
    return expected;
  }

  it('totals: each tile of a key that overlaps a window, with its totals and its start', () => {
    const load = input.press_load;
    const totals = East.compile(East.function([load.type, StringType, DateTimeType, DateTimeType], Totals, ($, entries, press, from, to) =>
      load.read(entries).totals({ key: press, from, to }).collect($)), []);
    let tiles = 0;
    for (const w of WINDOWS) {
      for (const press of PRESSES) {
        const expected = totalsIn(held.press_load, 'week', {}, press, w);
        tiles += expected.size;
        assertEast(Totals, totals(held.press_load, press, w.from, w.to), expected, `the load on ${press} in ${window(w)}`);
      }
    }
    assert.ok(tiles > 500, `the windows hold tiles to read: ${tiles}`);
  });

  it('totals: under each leading field, exactly', () => {
    const load = input.press_load_by_state;
    const totals = East.compile(East.function([load.type, StringType, StringType, DateTimeType, DateTimeType], Totals, ($, entries, state, press, from, to) =>
      load.read(entries).totals({ on: { state }, key: press, from, to }).collect($)), []);
    for (const w of WINDOWS.slice(0, 20)) {
      assertEast(Totals, totals(held.press_load_by_state, 'confirmed', 'P-1003', w.from, w.to), totalsIn(held.press_load_by_state, 'month', { state: 'confirmed' }, 'P-1003', w),
        `the confirmed load on P-1003 in ${window(w)}`);
    }
  });
});

// ── Area and entries indexes ─────────────────────────────────────────────────

/** A rack on a floor: its zone, its place — its box's centre — or none yet, and its size, in metres. */
const RackRow = StructType({ zone: StringType, x: OptionType(FloatType), y: OptionType(FloatType), w: FloatType, h: FloatType, name: StringType });
const RacksType = DictType(StringType, RackRow);
type Rack = ValueTypeOf<typeof RackRow>;
const racks = record('racks', RacksType, {
  initial: new Map(),
  indexes: (index) => ({
    by_area: index.area({ x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 }),
    by_zone_area: index.area({ on: ['zone'], x: 'x', y: 'y', width: 'w', height: 'h', cell: 0.5 }),
    points: index.area({ x: 'x', y: 'y', cell: 0.01 }),
  }),
});

/** A marker on a floor, always placed: a point. */
const MarkRow = StructType({ x: FloatType, y: FloatType });
const marks = record('marks', DictType(StringType, MarkRow), { initial: new Map(), indexes: (index) => ({ marks_by_area: index.area({ x: 'x', y: 'y', cell: 1 }) }) });

const ZONES = ['inbound', 'storage', 'dispatch'];

/** The racks the readers read: across a floor of a hundred metres by sixty, a fifth of a metre to thirty wide; some not
 *  yet placed, and the ones an index files under its root: outside its domain, wider than half of it, and not finite. */
function seededRacks(): SortedMap<string, Rack> {
  const draw = stream(1385);
  const rows = new SortedMap<string, Rack>(undefined, keyOrder);
  const rack = (n: number, x: number | undefined, y: number | undefined, w: number, h: number): Rack =>
    decodeBeast2For(RackRow)(encodeBeast2For(RackRow)({ zone: ZONES[n % 3]!, x: x === undefined ? none : some(x), y: y === undefined ? none : some(y), w, h, name: `Rack ${n}` }));
  for (let n = 0; n < 600; n++) {
    const size = n % 25 === 0 ? 5 + draw() * 25 : 0.2 + draw() * 2;
    const key = `R-${String(n).padStart(4, '0')}`;
    if (n % 40 === 13) rows.set(key, rack(n, undefined, undefined, size, size));
    else rows.set(key, rack(n, draw() * 100, draw() * 60, size, n % 3 === 0 ? size : size / 2));
  }
  rows.set('E-touches', rack(0, 51, 30, 2, 2));
  rows.set('E-outside-the-domain', rack(0, 5_000_000, 10, 1, 1));
  rows.set('E-half-placed', rack(0, 10, undefined, 1, 1));
  rows.set('E-wider-than-the-domain', rack(0, 50, 30, 3_000_000, 1));
  rows.set('E-not-finite', rack(0, Infinity, 30, 1, 1));
  return rows;
}

const RACKS = seededRacks();

/** The windows the area readers read: a rack's own, a room, the floor, one past it, a point, and seeded ones. */
function areaWindows(): Array<{ x: number; y: number; width: number; height: number }> {
  const draw = stream(266);
  const out = [
    { x: 40, y: 20, width: 10, height: 10 },
    { x: 0, y: 0, width: 100, height: 60 },
    { x: -1_000, y: -1_000, width: 10_000_000, height: 10_000_000 },
    { x: 52, y: 20, width: 5, height: 20 },
    { x: 50, y: 30, width: 0, height: 0 },
    { x: 10, y: 10, width: -1, height: 5 },
    { x: 4_999_990, y: 0, width: 20, height: 20 },
  ];
  for (let n = 0; n < 40; n++) {
    const side = n % 4 === 0 ? 0.5 + draw() * 2 : 2 + draw() ** 2 * 80;
    out.push({ x: draw() * 110 - 5, y: draw() * 70 - 5, width: side, height: side * (0.3 + draw()) });
  }
  return out;
}

const AREA_WINDOWS = areaWindows();

/** The racks of a zone, or of every zone, whose box meets a window, edges included: a loop over them all, the box by
 *  its centre or by its corner. */
const racksIn = (centred: boolean, sized: boolean) => East.compile(East.function(
  [RacksType, OptionType(StringType), FloatType, FloatType, FloatType, FloatType], RacksType,
  ($, rows, zone, x, y, width, height) => rows.filter(($, rack) => {
    $.if(East.less(width, 0.0).or(() => East.less(height, 0.0)), ($) => { $.return(false); });
    $.if(zone.match({ none: () => false, some: (_$, z) => East.notEqual(rack.zone, z) }), ($) => { $.return(false); });
    $.match(rack.x, {
      some: ($, rx) => {
        $.match(rack.y, {
          some: ($, ry) => {
            const w = $.const(sized ? rack.w : East.value(0.0));
            const h = $.const(sized ? rack.h : East.value(0.0));
            const minX = $.const(centred ? rx.subtract(w.divide(2.0)) : rx);
            const minY = $.const(centred ? ry.subtract(h.divide(2.0)) : ry);
            $.return(East.lessEqual(minX, x.add(width)).and(() => East.greaterEqual(minX.add(w), x))
              .and(() => East.lessEqual(minY, y.add(height))).and(() => East.greaterEqual(minY.add(h), y)));
          },
        });
      },
    });
    return false;
  }),
), []);

describe('an area index\'s readers', () => {
  const window = (w: { x: number; y: number; width: number; height: number }): string => `${w.width} by ${w.height} at ${w.x}, ${w.y}`;

  it('within: the rows whose box meets a window, each once with its row, for seeded windows — boxes by their centre', () => {
    const byArea = index(racks.indexes.by_area);
    const within = East.compile(East.function([byArea.type, FloatType, FloatType, FloatType, FloatType], RacksType, ($, entries, x, y, width, height) =>
      byArea.read(entries).within({ x, y, width, height }).collect($)), []);
    const counted = East.compile(East.function([byArea.type, FloatType, FloatType, FloatType, FloatType], IntegerType, ($, entries, x, y, width, height) => {
      const given = $.let(0n);
      byArea.read(entries).within({ x, y, width, height }).each($, ($) => { $.assign(given, given.add(1n)); });
      return given;
    }), []);
    const held = entriesOf(racks, racks.indexes.by_area, RACKS);
    const oracle = racksIn(true, true);
    let rows = 0;
    for (const w of AREA_WINDOWS) {
      const expected = oracle(RACKS, none, w.x, w.y, w.width, w.height);
      rows += expected.size;
      assertEast(RacksType, within(held, w.x, w.y, w.width, w.height), expected, `the racks within ${window(w)}`);
      assert.equal(counted(held, w.x, w.y, w.width, w.height), BigInt(expected.size), `each once within ${window(w)}`);
    }
    assert.ok(rows > 2000, `the windows hold racks to read: ${rows}`);

    // The edges: a box that touches the window is in it; a row outside the domain, and one wider than it, are read from the root
    const touching = within(held, 52, 20, 5, 20);
    assert.equal(touching.has('E-touches'), true, 'a rack whose side is the window\'s edge');
    assert.equal(within(held, 52.001, 20, 5, 20).has('E-touches'), false, 'and is out of one a millimetre on');
    assert.equal(within(held, 4_999_990, 0, 20, 20).has('E-outside-the-domain'), true, 'a rack outside the index\'s domain');
    assert.equal(touching.has('E-wider-than-the-domain'), true, 'a rack wider than half the domain');
    assert.equal(touching.has('E-half-placed'), false, 'a rack with no y is not placed');
  });

  it('within: under each leading field, exactly — boxes by their corner', () => {
    const byZone = index(racks.indexes.by_zone_area);
    const within = East.compile(East.function([byZone.type, StringType, FloatType, FloatType, FloatType, FloatType], RacksType, ($, entries, zone, x, y, width, height) =>
      byZone.read(entries).within({ on: { zone }, x, y, width, height }).collect($)), []);
    const held = entriesOf(racks, racks.indexes.by_zone_area, RACKS);
    const oracle = racksIn(false, true);
    for (const w of AREA_WINDOWS) {
      for (const zone of ZONES) {
        assertEast(RacksType, within(held, zone, w.x, w.y, w.width, w.height), oracle(RACKS, some(zone), w.x, w.y, w.width, w.height), `the ${zone} racks within ${window(w)}`);
      }
    }
  });

  it('within: points, which have no size', () => {
    const points = index(racks.indexes.points);
    const within = East.compile(East.function([points.type, FloatType, FloatType, FloatType, FloatType], RacksType, ($, entries, x, y, width, height) =>
      points.read(entries).within({ x, y, width, height }).collect($)), []);
    const held = entriesOf(racks, racks.indexes.points, RACKS);
    const oracle = racksIn(false, false);
    for (const w of AREA_WINDOWS) {
      assertEast(RacksType, within(held, w.x, w.y, w.width, w.height), oracle(RACKS, none, w.x, w.y, w.width, w.height), `the points within ${window(w)}`);
    }
  });

  it('within: refuses a window that is not finite, as it runs', () => {
    const byArea = index(racks.indexes.by_area);
    const within = East.compile(East.function([byArea.type, FloatType], IntegerType, ($, entries, width) =>
      byArea.read(entries).within({ x: 0, y: 0, width, height: 1 }).collect($).size()), []);
    const held = entriesOf(racks, racks.indexes.by_area, RACKS);
    assert.throws(() => within(held, Infinity), /e3\.index 'racks\.by_area' within: a window's x, y, width and height are finite numbers/);
    assert.throws(() => within(held, NaN), /are finite numbers/);
  });

  it('unplaced: the rows with no place', () => {
    const byArea = index(racks.indexes.by_area);
    const unplaced = East.compile(East.function([byArea.type], DictType(StringType, StringType), ($, entries) => {
      const names = $.let(new Map(), DictType(StringType, StringType));
      byArea.read(entries).unplaced().each($, ($, rack, key) => { $(names.insert(key, rack.name)); });
      return names;
    }), []);
    const expected = new SortedMap([...RACKS].filter(([, rack]) => rack.x.type === 'none' || rack.y.type === 'none').map(([key, rack]): [string, string] => [key, rack.name]), keyOrder);
    assert.ok(expected.size > 10);
    assertEast(DictType(StringType, StringType), unplaced(entriesOf(racks, racks.indexes.by_area, RACKS)), expected, 'the racks not yet placed');
    const byZone = index(racks.indexes.by_zone_area);
    const inZone = East.compile(East.function([byZone.type, StringType], IntegerType, ($, entries, zone) => byZone.read(entries).unplaced({ on: { zone } }).collect($).size()), []);
    assert.equal(inZone(entriesOf(racks, racks.indexes.by_zone_area, RACKS), 'storage'),
      BigInt([...RACKS.values()].filter((rack) => rack.zone === 'storage' && (rack.x.type === 'none' || rack.y.type === 'none')).length));
  });
});

describe('an entries index\'s readers', () => {
  /** A station: its name, and the parcels it handled, by service. */
  const StationRow = StructType({ name: StringType, byService: DictType(StringType, IntegerType) });
  const StationsType = DictType(StringType, StationRow);
  const stations = record('stations', StationsType, { initial: new Map(), indexes: (index) => ({ by_service: index.entries('byService') }) });
  const SERVICES = ['economy', 'express', 'freight', 'returns'];
  const rows = new SortedMap<string, ValueTypeOf<typeof StationRow>>(undefined, keyOrder);
  for (let n = 0; n < 120; n++) {
    const handled = new SortedMap<string, bigint>(SERVICES.filter((_service, at) => (n + at) % 3 !== 0).map((service, at): [string, bigint] => [service, BigInt(n * 10 + at)]), keyOrder);
    rows.set(`S-${String(n).padStart(3, '0')}`, decodeBeast2For(StationRow)(encodeBeast2For(StationRow)({ name: `Station ${n}`, byService: handled })));
  }

  it('of: a key\'s entry on every row that holds one, with its value', () => {
    const byService = index(stations.indexes.by_service);
    const of = East.compile(East.function([byService.type, StringType], DictType(StringType, IntegerType), ($, entries, service) =>
      byService.read(entries).of(service).collect($)), []);
    const held = entriesOf(stations, stations.indexes.by_service, rows);
    for (const service of [...SERVICES, 'overnight']) {
      const expected = new SortedMap([...rows].flatMap(([key, station]): [string, bigint][] => {
        const parcels = station.byService.get(service);
        return parcels === undefined ? [] : [[key, parcels]];
      }), keyOrder);
      assertEast(DictType(StringType, IntegerType), of(held, service), expected, `the stations' ${service} parcels`);
    }
  });

  it('reads its lean rows as a plain index: each row by its key, its field emptied', () => {
    const lean = index(stations.indexes.by_service.entries.rows);
    const named = East.compile(East.function([lean.type, StringType, StringType], DictType(StringType, StringType), ($, entries, from, to) => {
      const names = $.let(new Map(), DictType(StringType, StringType));
      lean.read(entries).between({ from, to }).each($, ($, station, key) => {
        $.if(East.equal(station.byService.size(), 0n), ($) => { $(names.insert(key, station.name)); });
      });
      return names;
    }), []);
    const expected = new SortedMap([...rows].filter(([key]) => key >= 'S-010' && key < 'S-020').map(([key, station]): [string, string] => [key, station.name]), keyOrder);
    assertEast(DictType(StringType, StringType), named(entriesOf(stations, stations.indexes.by_service.entries.rows, rows), 'S-010', 'S-020'), expected, 'ten stations, lean');
  });

  it('refuses a key that is not the field\'s, where the reader is called', () => {
    const byService = index(stations.indexes.by_service);
    assert.throws(() => East.function([byService.type], NullType, (_$, entries) => { byService.read(entries).of(7n as never); return null; }));
  });
});

describe('where a reader is refused', () => {
  /** Builds a function over an index's entries, for the refusal its body raises. */
  const over = <I extends IndexInputDef>(at: I, body: (entries: Parameters<I['read']>[0]) => unknown) => () =>
    East.function([at.type], NullType, (_$, entries) => { body(entries as never); return null; });

  it('refuses a leading field left out, one that leads nothing, and one of another type, naming the fields', () => {
    const byState = input.in_time_by_state;
    const from = at('2026-10-12T00:00:00.000');
    const to = at('2026-10-19T00:00:00.000');
    assert.throws(over(byState, (entries) => byState.read(entries).overlapping({ from, to } as never)),
      /^Error: e3\.index 'jobs\.in_time_by_state' overlapping: 'state' is left out — the index is led by 'state', and takes each exactly, as on: \{ state: … \}$/);
    assert.throws(over(byState, (entries) => byState.read(entries).overlapping({ on: { state: 'open', press: 'P-1001' }, from, to } as never)),
      /overlapping: 'press' leads nothing — the index is led by 'state'/);
    assert.throws(over(byState, (entries) => byState.read(entries).overlapping({ on: { state: 7n }, from, to } as never)),
      /^Error: e3\.index 'jobs\.in_time_by_state' overlapping: a leading field is given a value of another type — `on` is \{ state: \.String \}: /);
    assert.throws(over(byState, (entries) => byState.read(entries).unset()), /unset: 'state' is left out/);

    const inTime = input.in_time;
    assert.throws(over(inTime, (entries) => inTime.read(entries).overlapping({ on: { state: 'open' }, from, to } as never)),
      /^Error: e3\.index 'jobs\.in_time' overlapping: 'state' leads nothing — the index is led by no field, and takes no `on`$/);

    const series = input.press_days_by_state;
    assert.throws(over(series, (entries) => series.read(entries).events({ key: 'P-1001', from, to } as never)), /events: 'state' is left out/);
    const load = input.press_load_by_state;
    assert.throws(over(load, (entries) => load.read(entries).totals({ on: {}, key: 'P-1001', from, to } as never)), /totals: 'state' is left out/);
  });

  it('refuses a window or a key left out, naming it', () => {
    const series = input.press_weeks;
    const from = at('2026-10-12T00:00:00.000');
    assert.throws(over(series, (entries) => series.read(entries).events({ key: 'P-1001', from } as never)), /events: `to` is left out — a window is \[from, to\), each a DateTime/);
    assert.throws(over(series, (entries) => series.read(entries).events({ from, to: from } as never)), /events: `key` is left out — the key the events are on/);
  });

  it('refuses the rows with no start of an index whose start is no Option, naming the field', () => {
    const inTime = index(shifts.indexes.shifts_in_time);
    assert.throws(over(inTime, (entries) => inTime.read(entries).unset()),
      /^Error: e3\.index 'shifts\.shifts_in_time' unset: the index's start, 'start', is a DateTime field, so every row has one/);
  });

  it('refuses the rows not yet placed of an index whose place is no Option, and a window\'s part left out, naming it', () => {
    const byArea = index(marks.indexes.marks_by_area);
    assert.throws(over(byArea, (entries) => byArea.read(entries).unplaced()),
      /^Error: e3\.index 'marks\.marks_by_area' unplaced: the index's place, 'x' and 'y', is Float fields, so every row is placed/);
    assert.throws(over(byArea, (entries) => byArea.read(entries).within({ x: 0, y: 0, width: 1 } as never)),
      /within: `height` is left out — a window is \{ x, y, width, height \}, each a Float/);
  });

  it('refuses a key that is no leading part of a plain index\'s, in the range read\'s words', () => {
    const byState = input.by_state_press;
    assert.throws(over(byState, (entries) => byState.read(entries).of({ press: 'P-1001' } as never)), /state/);
  });

  it('gives an index the readers of its kind, and refuses another index\'s entries, naming both', () => {
    const byPress = input.by_press;
    const series = input.press_weeks;
    assert.throws(() => East.function([series.type], NullType, (_$, entries) => { byPress.read(entries as never); return null; }),
      /^Error: e3\.index 'jobs\.by_press' reads its own entries, .* and was given an expression of .* — pass the body's parameter for this index$/);
    East.function([series.type, byPress.type], NullType, (_$, events, rows) => {
      const readers = series.read(events);
      // @ts-expect-error — a series index has no `of`: its reader is `events`
      assert.equal(readers.of, undefined);
      // @ts-expect-error — a plain index has no `events`: its readers are `of` and `between`
      assert.equal(byPress.read(rows).events, undefined);
      return null;
    });
  });
});

describe('e3.index(def).read', () => {
  it('gives the expression it was handed, still the entries, with the index\'s readers on it', () => {
    const byPress = input.by_press;
    const both = East.compile(East.function([byPress.type, StringType], StructType({ sized: IntegerType, read: IntegerType }), ($, entries, press) => {
      const read = byPress.read(entries);
      assert.equal(read, entries, 'the same expression');
      const given = $.let(0n);
      read.of(press).each($, ($) => { $.assign(given, given.add(1n)); });
      return { sized: read.prefix({ ik: press }).size(), read: given };
    }), []);
    const onPress = BigInt([...ROWS.values()].filter((row) => row.press === 'P-1001').length);
    assert.deepEqual(both(held.by_press, 'P-1001'), { sized: onPress, read: onPress });
  });
});

describe('the body\'s parameter for an index', () => {
  it('arrives with its kind\'s readers on it in a function with a spec, and is still the entries', () => {
    const fn = function_('sheets_on_press', {
      inputs: [index(jobs.indexes.press_weeks), index(jobs.indexes.by_press)],
      args: [StringType, DateTimeType, DateTimeType],
      output: StructType({ sheets: FloatType, jobs: IntegerType }),
    }, ($, pressWeeks, byPress, press, from, to) => {
      const sheets = $.let(0.0);
      pressWeeks.events({ key: press, from, to }).each($, ($, job) => { $.assign(sheets, sheets.add(job.sheets)); });
      return { sheets, jobs: byPress.prefix({ ik: press }).size() };
    });
    assert.deepEqual(fn.inputs.map((read) => read.kind), ['index', 'index']);
    const run = (fn.body as IRBundle).compile([]) as (...args: unknown[]) => { sheets: number; jobs: bigint };
    const from = at('2026-10-12T00:00:00.000');
    const to = at('2026-10-19T00:00:00.000');
    const inWeek = [...jobsIn(ROWS, none, some('P-1002'), from, to).values()];
    assert.ok(inWeek.length > 0);
    assert.deepEqual(run(held.press_weeks, held.by_press, 'P-1002', from, to), {
      sheets: inWeek.reduce((sum, row) => sum + row.sheets, 0),
      jobs: BigInt([...ROWS.values()].filter((row) => row.press === 'P-1002').length),
    });
  });

  it('arrives with them in a stream task, beside the input its work is split over', () => {
    const SaleType = StructType({ press: StringType, amount: FloatType });
    const sales = input_('sales', DictType(StringType, SaleType));
    const busy = streamTask('sales_on_busy_presses', {
      inputs: [partition(sales), index(jobs.indexes.by_press)],
      output: output.dict(StringType, FloatType, { merge: (_$, _press, a, b) => a.add(b) }),
    }, ($, sales, byPress, emit) => {
      $.for(sales, ($, sale) => {
        const count = $.let(0n);
        byPress.of(sale.press).each($, ($) => { $.assign(count, count.add(1n)); });
        $.if(East.greater(count, 0n), ($) => { $(emit(sale.press, sale.amount)); });
      });
    });
    assert.equal(busy.inputs.length, 2);
  });

  it('is read through e3.index(def).read in a task\'s own function', () => {
    const byPress = index(jobs.indexes.by_press);
    const count = task('jobs_on_first_press', [byPress],
      East.function([byPress.type], IntegerType, ($, entries) => {
        const count = $.let(0n);
        byPress.read(entries).of('P-1001').each($, ($) => { $.assign(count, count.add(1n)); });
        return count;
      }));
    assert.equal(count.inputs.length, 1);
  });
});
