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
  ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, RecursiveType, SetType, SortedMap,
  SortedSet, StringType, StructType, compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printFor, some, variant,
  type EastType, type ExprType, type ValueTypeOf,
} from '@elaraai/east';
import { RecordLevelType, RecordNestedTotalsType, RecordSummaryTotalsType, type RecordSummaryTotals } from '@elaraai/e3-types';
import { function_ } from './function.js';
import { index } from './index-input.js';
import { NestedUnderType } from './index-read.js';
import { input as input_ } from './input.js';
import { output } from './output.js';
import { record } from './record.js';
import { builtIndex, indexBuildProgram, summaryMergeProgram } from './record-programs.js';
import { TILE_FNS, type RecordTile } from './record-tiles.js';
import { partition, streamTask, task } from './task.js';
import { assertEast, at, seededStream } from './test-helpers.js';
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
    by_state: index.on(['state']),
    by_state_press: index.on(['state', 'press']),
    by_crew: index.on(['crews']),
    by_state_crew: index.on(['state', 'crews']),
    titles: index.key(East.function([StringType, JobRow], StringType, (_$, _key, job) => job.press),
      { value: East.function([StringType, JobRow], StringType, (_$, _key, job) => job.title) }),
    in_time: index.interval({ from: 'start', to: 'end' }),
    in_time_by_state: index.interval({ on: ['state'], from: 'start', to: 'end' }),
    press_weeks: index.flatSeries({ key: 'press', from: 'start', to: 'end', tile: 'week' }),
    press_days_by_state: index.flatSeries({ on: ['state'], key: 'press', from: 'start', to: 'end', tile: 'day' }),
    press_quarters: index.flatSeries({ key: 'press', from: 'start', to: 'end', tile: 'quarter' }),
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
    shifts_by_press: index.flatSeries({ key: 'press', from: 'start', to: 'end', tile: 'day' }),
  }),
});

const DAY = 86_400_000n;
const HOUR = 3_600_000n;

const printInstant = printFor(DateTimeType);
/** The instant `ms` milliseconds from the epoch, made by East. */
const instant = East.compile(East.function([IntegerType], DateTimeType, (_$, ms) => East.DateTime.fromEpochMilliseconds(ms)), []);
/** An instant's milliseconds from the epoch, read by East. */
const millisecondsOf = East.compile(East.function([DateTimeType], IntegerType, (_$, t) => t.toEpochMilliseconds()), []);

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
  const draw = seededStream(1618);
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
  const draw = seededStream(55);
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
  // A summary's entries, and a span's, are summed by their merge and name no row
  const summary = def.summary !== undefined || def.span !== undefined;
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

const window = (w: { from: Date; to: Date }): string => `[${printInstant(w.from)}, ${printInstant(w.to)})`;

/**
 * Whether a read gave its rows as a walk of the index meets them: each at an
 * entry after the one the row before it was given at. An index may file a row
 * under several entries, so the walk takes the first that fits.
 *
 * @param type - The type the read names a row by: its key, or a nested item's
 * @param entries - The index's entries, in its order
 * @param named - What an entry names its row by, as the read does
 * @param given - What the read gave, in the order it gave it
 * @returns Whether every row given was met, in order
 */
function inIndexOrder<T extends EastType, E>(type: T, entries: Iterable<E>, named: (entry: E) => ValueTypeOf<T> | undefined, given: readonly ValueTypeOf<T>[]): boolean {
  const same = equalFor(type);
  let met = 0;
  for (const entry of entries) {
    const name = named(entry);
    if (met < given.length && name !== undefined && same(name, given[met]!)) met += 1;
  }
  return met === given.length;
}

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

  it('overlapping: gives its rows as a walk of the index meets them — the starts in the window, then each node above it from the root down', () => {
    const inOrder = East.compile(East.function([inTime.type, DateTimeType, DateTimeType], ArrayType(StringType), ($, entries, from, to) => {
      const keys = $.let([], ArrayType(StringType));
      inTime.read(entries).overlapping({ from, to }).each($, ($, _carried, key) => { $(keys.pushLast(key)); });
      return keys;
    }), []);
    const filed = [...(held.in_time as SortedMap<ValueTypeOf<typeof inTime.type.key>, null>).keys()];
    let carried = 0;
    for (const w of WINDOWS) {
      const given = inOrder(held.in_time, w.from, w.to);
      // The rows the window's later runs hold: those that began before it
      carried += given.filter((key) => { const start = ROWS.get(key)!.start; return start.type === 'some' && compareFor(DateTimeType)(start.value, w.from) < 0; }).length;
      assert.ok(inIndexOrder(StringType, filed, (entry) => entry.k, given), `the jobs in ${window(w)} come in the index's order`);
    }
    assert.ok(carried > 500, `the windows hold rows of more than one run: ${carried}`);
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
    const filed = [...(held.press_weeks as SortedMap<ValueTypeOf<typeof series.type.key>, Job>).keys()].filter((entry) => keyOrder(entry.k, 'E-past-a-year') === 0).length;
    assert.equal(filed, 3, 'the index files it under each of the three years it touches');
  });

  it('events: gives its rows as a walk of the index meets them — a run a level, in the index\'s order of its levels', () => {
    const series = input.press_days_by_state;
    const inOrder = East.compile(East.function([series.type, StringType, StringType, DateTimeType, DateTimeType], ArrayType(StringType), ($, entries, state, press, from, to) => {
      const keys = $.let([], ArrayType(StringType));
      series.read(entries).events({ on: { state }, key: press, from, to }).each($, ($, _job, key) => { $(keys.pushLast(key)); });
      return keys;
    }), []);
    const filed = [...(held.press_days_by_state as SortedMap<ValueTypeOf<typeof series.type.key>, Job>).keys()];
    // The index orders a level by East's order of its cases, which is no order of their lengths
    const levelOrder = compareFor(RecordLevelType);
    assert.ok(levelOrder(variant('month', null), variant('week', null)) < 0 && levelOrder(variant('week', null), variant('year', null)) < 0,
      'a month is before a week in the index');
    const levels = new SortedSet<ValueTypeOf<typeof RecordLevelType>>(undefined, levelOrder);
    for (const w of WINDOWS) {
      for (const state of STATES) {
        const given = inOrder(held.press_days_by_state, state, 'P-1001', w.from, w.to);
        for (const entry of filed) if (given.some((key) => keyOrder(key, entry.k) === 0) && keyOrder(entry.ik.key, 'P-1001') === 0) levels.add(entry.ik.level);
        assert.ok(inIndexOrder(StringType, filed, (entry) => entry.k, given), `the ${state} jobs on P-1001 in ${window(w)} come in the index's order`);
      }
    }
    assert.equal(levels.size, 5, 'the windows read events filed at every level, a day to a year');
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

  /** A summary index's entries' type, whatever fields lead it. */
  type SummaryEntries<On extends EastType> =
    DictType<StructType<{ ik: StructType<{ on: On; key: StringType; tile: DateTimeType }>; k: NullType }>, typeof RecordSummaryTotalsType>;

  /** The totals an index holds of a key's tiles that overlap a window: a loop over every entry of it, each typed by the index's own entries. */
  function totalsIn<On extends EastType>(
    load: { readonly type: SummaryEntries<On> }, entries: unknown, tile: 'week' | 'month', on: ValueTypeOf<On>, press: string, w: { from: Date; to: Date },
  ) {
    const expected = new SortedMap<Date, RecordSummaryTotals>(undefined, compareFor(DateTimeType));
    const sameOn = equalFor(load.type.key.fields.ik.fields.on);
    const before = compareFor(DateTimeType);
    for (const [entry, totals] of entries as SortedMap<ValueTypeOf<SummaryEntries<On>['key']>, RecordSummaryTotals>) {
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
        const expected = totalsIn(load, held.press_load, 'week', {}, press, w);
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
      assertEast(Totals, totals(held.press_load_by_state, 'confirmed', 'P-1003', w.from, w.to), totalsIn(load, held.press_load_by_state, 'month', { state: 'confirmed' }, 'P-1003', w),
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
  const draw = seededStream(1385);
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
  const draw = seededStream(266);
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

  it('within: gives its rows as a walk of the index meets them — a cell before the cells inside it, along the curve', () => {
    const byArea = index(racks.indexes.by_area);
    const inOrder = East.compile(East.function([byArea.type, FloatType, FloatType, FloatType, FloatType], ArrayType(StringType), ($, entries, x, y, width, height) => {
      const keys = $.let([], ArrayType(StringType));
      byArea.read(entries).within({ x, y, width, height }).each($, ($, _rack, key) => { $(keys.pushLast(key)); });
      return keys;
    }), []);
    const held = entriesOf(racks, racks.indexes.by_area, RACKS);
    const filed = [...(held as SortedMap<ValueTypeOf<typeof byArea.type.key>, Rack>).keys()];
    let rows = 0;
    for (const w of AREA_WINDOWS) {
      const given = inOrder(held, w.x, w.y, w.width, w.height);
      rows += given.length;
      assert.ok(inIndexOrder(StringType, filed, (entry) => entry.k, given), `the racks within ${window(w)} come in the index's order`);
    }
    assert.ok(rows > 2000, `the windows hold racks to read: ${rows}`);
  });

  it('within: a zero is one edge whatever its sign — a window\'s width, its corner, and a box\'s own', () => {
    const byArea = index(racks.indexes.by_area);
    const within = East.compile(East.function([byArea.type, FloatType, FloatType, FloatType, FloatType], RacksType, ($, entries, x, y, width, height) =>
      byArea.read(entries).within({ x, y, width, height }).collect($)), []);
    const held = entriesOf(racks, racks.indexes.by_area, RACKS);
    // A window of no width and no height, each written as the zero below zero
    const point = within(held, 50, 30, 0, 0);
    assert.ok(point.has('E-touches'), 'a rack holds the point');
    assertEast(RacksType, within(held, 50, 30, -0, -0), point, 'a window whose width and height are -0.0');

    // A box at the zero below zero, of that width, by its corner: it touches a window that starts at zero
    const byZone = index(racks.indexes.by_zone_area);
    const inZone = East.compile(East.function([byZone.type, FloatType, FloatType, FloatType, FloatType], RacksType, ($, entries, x, y, width, height) =>
      byZone.read(entries).within({ on: { zone: 'inbound' }, x, y, width, height }).collect($)), []);
    const edge = new SortedMap<string, Rack>(undefined, keyOrder);
    edge.set('E-at-zero', decodeBeast2For(RackRow)(encodeBeast2For(RackRow)({ zone: 'inbound', x: some(-0), y: some(-0), w: -0, h: -0, name: 'At the corner' })));
    edge.set('E-to-zero', decodeBeast2For(RackRow)(encodeBeast2For(RackRow)({ zone: 'inbound', x: some(-4), y: some(-4), w: 4, h: 4, name: 'Up to the corner' })));
    const filedEdge = entriesOf(racks, racks.indexes.by_zone_area, edge);
    for (const [x, y] of [[0, 0], [-0, -0], [0, -0]] as const) {
      assertEast(RacksType, inZone(filedEdge, x, y, 5, 5), edge, `both touch a window from ${Object.is(x, -0) ? '-0.0' : '0.0'}, ${Object.is(y, -0) ? '-0.0' : '0.0'}`);
      assertEast(RacksType, inZone(filedEdge, x, y, -0, -0), edge, 'and a window that is that point alone');
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

  it('reads a nested series index\'s span as a plain index, giving each tile\'s key in a row\'s key\'s place, a period at a time (#1739)', () => {
    const Machine = StructType({ name: StringType, load: DictType(DateTimeType, FloatType) });
    const machines = record('machines', DictType(StringType, Machine), {
      initial: new Map(),
      indexes: (index) => ({ machines_in_time: index.nestedSeries({ collections: { load: index.nestedSeries.values() }, tile: 'week', summary: ['month'] }) }),
    });
    const fleet = new SortedMap<string, ValueTypeOf<typeof Machine>>(undefined, keyOrder);
    for (let n = 0; n < 6; n++) {
      const load = new SortedMap<Date, number>(Array.from({ length: 5 }, (_, day): [Date, number] => [instant(OCT_5 + BigInt(n * 20 + day) * DAY), n + day / 10]), compareFor(DateTimeType));
      fleet.set(`M-${n}`, decodeBeast2For(Machine)(encodeBeast2For(Machine)({ name: `Machine ${n}`, load })));
    }
    const span = index(machines.indexes.machines_in_time.nested.span);
    const SpanKey = span.index.keyType;
    const SpanTotals = DictType(SpanKey, RecordSummaryTotalsType);
    const held = entriesOf(machines, machines.indexes.machines_in_time.nested.span, fleet);
    // The record's totals of a collection at one period: the collection's place, then the period, lead the span's key
    const months = East.compile(East.function([span.type], SpanTotals, ($, entries) =>
      span.read(entries).of({ collection: variant('step', { key: 'load', rest: variant('end', null) }), level: variant('month', null) }).collect($)), []);
    const read = months(held);
    // The fleet's values run from October into January: a month's entry counts the values in it, across the machines
    assert.equal(read.size, 4, 'the months the load touches');
    assert.equal([...read.values()].reduce((sum, totals) => sum + totals.count, 0n), 30n, 'every value counted once, in its month');
    const sameLevel = equalFor(RecordLevelType);
    assert.ok([...read.keys()].every((key) => key.collection.type === 'step' && sameLevel(key.level, variant('month', null))), 'each a month\'s, under the collection\'s place');

    // Of every period the index keeps them at — a month, a quarter and a year, where it names none — under the place alone
    const periods = East.compile(East.function([span.type], SpanTotals, ($, entries) =>
      span.read(entries).of({ collection: variant('step', { key: 'load', rest: variant('end', null) }) }).collect($)), []);
    const all = periods(held);
    assert.equal(all.size, 8, 'four months, two quarters and two years');
    for (const period of ['month', 'quarter', 'year'] as const) {
      const counted = [...all].filter(([key]) => sameLevel(key.level, variant(period, null))).reduce((sum, [, totals]) => sum + totals.count, 0n);
      assert.equal(counted, 30n, `every value counted once, in its ${period}`);
    }
  });

  it('refuses a key that is not the field\'s, where the reader is called', () => {
    const byService = index(stations.indexes.by_service);
    assert.throws(() => East.function([byService.type], NullType, (_$, entries) => { byService.read(entries).of(7n as never); return null; }));
  });
});

// ── A nested series index ────────────────────────────────────────────────────

/** A check on a team: its note, and the instant it was made. */
const CheckRow = StructType({ note: StringType, at: DateTimeType });
const ChecksType = DictType(StringType, CheckRow);
const HoursType = DictType(DateTimeType, FloatType);
const NotesType = DictType(DateTimeType, StringType);
/** A team of a yard: its jobs, its checks, the hours it logged, a value a day, and the teams within it, to any depth. */
const TeamRow = RecursiveType((self) => StructType({
  name: StringType, jobs: JobsType, checks: ChecksType, hours: HoursType, teams: DictType(StringType, self),
}));
/** A yard: its visits, its notes, each at an instant, and its teams. */
const YardRow = StructType({ name: StringType, visits: JobsType, notes: NotesType, teams: DictType(StringType, TeamRow) });
const YardsType = DictType(StringType, YardRow);
type Team = ValueTypeOf<typeof TeamRow>;
type Yard = ValueTypeOf<typeof YardRow>;

const yards = record('yards', YardsType, {
  initial: new Map(),
  indexes: (index) => ({
    yards_in_time: index.nestedSeries({
      collections: {
        visits: index.nestedSeries.items({ from: 'start', to: 'end' }),
        notes: index.nestedSeries.values(),
        teams: index.nestedSeries.rows({
          jobs: index.nestedSeries.items({ from: 'start', to: 'end' }, { rollup: true }),
          checks: index.nestedSeries.items({ at: 'at' }),
          hours: index.nestedSeries.values({ rollup: ['sum', { fold: 'last', aggregate: 'max' }] }),
          teams: index.nestedSeries.recursive(),
        }),
      },
      tile: 'week',
      summary: ['month'],
    }),
  }),
});

/** The yards again, their index keeping each node's totals a week and a month: a read names the one it reads. */
const yardsByPeriod = record('yards_by_period', YardsType, {
  initial: new Map(),
  indexes: (index) => ({
    yards_in_time: index.nestedSeries({
      collections: {
        visits: index.nestedSeries.items({ from: 'start', to: 'end' }),
        notes: index.nestedSeries.values(),
        teams: index.nestedSeries.rows({
          jobs: index.nestedSeries.items({ from: 'start', to: 'end' }, { rollup: true }),
          checks: index.nestedSeries.items({ at: 'at' }),
          hours: index.nestedSeries.values({ rollup: ['sum', { fold: 'last', aggregate: 'max' }] }),
          teams: index.nestedSeries.recursive(),
        }),
      },
      tile: 'week',
      summary: ['week', 'month'],
    }),
  }),
});

/** Whether a team logs hours of its own, and the teams within it. */
interface TeamSeed { readonly hours: boolean; readonly teams: Readonly<Record<string, TeamSeed>> }
/** A team with none within it, which logs hours. */
const CREW: TeamSeed = { hours: true, teams: {} };
/** A yard's teams: two, two within each, and one more within the first of those. */
const teamSeeds = (second: boolean): Readonly<Record<string, TeamSeed>> => ({
  'T-1': { hours: false, teams: { 'T-1a': { hours: false, teams: { 'T-1a-i': CREW } }, 'T-1b': CREW } },
  // In the second yard this team logs hours of its own: it draws them, and keeps no subtotal of the teams within it.
  'T-2': { hours: second, teams: { 'T-2a': CREW, 'T-2b': CREW } },
});
/** The seeded jobs the first yard's visits and its deepest team's jobs hold whatever else they are dealt: the edges, by name. */
const EDGES = [
  'E-ends-at-from', 'E-instant-at-from', 'E-instant-at-to', 'E-starts-at-to', 'E-no-end', 'E-no-start', 'E-ends-before-start',
  'E-past-a-year', 'E-a-millisecond-in',
];
const instantOrder = compareFor(DateTimeType);

/**
 * The yards the nested readers read: the seeded jobs dealt out among each
 * yard's visits and each of its teams' jobs; checks and notes at seeded
 * instants, and at the edges of the week from Monday 12 October; and a value a
 * day, most days from August to the year's end, for each team that logs hours.
 */
function seededYards(): ValueTypeOf<typeof YardsType> {
  const draw = seededStream(1434);
  const dealt: Jobs[] = [];
  const hand = (): Jobs => {
    const held: Jobs = new SortedMap(undefined, keyOrder);
    dealt.push(held);
    return held;
  };
  const instants = (count: number): Date[] => [
    ...Array.from({ length: count }, () => instant(OCT_5 + BigInt(Math.floor((draw() - 0.5) * 400)) * DAY + BigInt(Math.floor(draw() * 24)) * HOUR)),
    at('2026-10-12T00:00:00.000'), at('2026-10-19T00:00:00.000'),
  ];
  const team = (key: string, seed: TeamSeed): Team => ({
    name: `Team ${key}`,
    jobs: hand(),
    checks: new SortedMap(instants(15).map((made, n): [string, ValueTypeOf<typeof CheckRow>] => [`C-${String(n).padStart(2, '0')}`, { note: `Check ${n}`, at: made }]), keyOrder),
    // Quarters of an hour, so a sum is exact in whatever order it is added.
    hours: new SortedMap(seed.hours
      ? Array.from({ length: 150 }, (_, day): [Date, number] => [instant(OCT_5 + BigInt(day - 60) * DAY + 6n * HOUR), Math.floor(draw() * 64) / 4]).filter(() => draw() > 0.2)
      : [], instantOrder),
    teams: new SortedMap(Object.entries(seed.teams).map(([below, within]): [string, Team] => [below, team(below, within)]), keyOrder),
  });
  const rows = new SortedMap<string, Yard>(undefined, keyOrder);
  for (const [key, seeds] of [['Y-1', teamSeeds(false)], ['Y-2', teamSeeds(true)]] as const) {
    rows.set(key, {
      name: `Yard ${key}`,
      visits: hand(),
      notes: new SortedMap(instants(25).map((made, n): [Date, string] => [made, `Note ${n}`]), instantOrder),
      teams: new SortedMap(Object.entries(seeds).map(([below, within]): [string, Team] => [below, team(below, within)]), keyOrder),
    });
  }
  let n = 0;
  for (const [key, row] of ROWS) dealt[n++ % dealt.length]!.set(key, row);
  // The first yard's visits are dealt first, and its deepest team's jobs fourth: T-1, T-1a, then T-1a-i.
  for (const name of EDGES) {
    const row = ROWS.get(name);
    assert.ok(row !== undefined, `the seeded jobs hold ${name}`);
    dealt[0]!.set(name, row);
    dealt[3]!.set(name, row);
  }
  return decodeBeast2For(YardsType)(encodeBeast2For(YardsType)(rows));
}

const YARDS = seededYards();

/** Every team beneath some teams, each with the keys from them down to it. */
function teamsBeneath(teams: ReadonlyMap<string, Team>, path: readonly string[] = []): Array<{ path: string[]; team: Team }> {
  return [...teams].flatMap(([key, team]) => [{ path: [...path, key], team }, ...teamsBeneath(team.teams, [...path, key])]);
}

/** Every team of every yard, by its yard and the keys from the yard down. */
const TEAMS = [...YARDS].flatMap(([yard, row]) => teamsBeneath(row.teams).map((found) => ({ yard, ...found })));

const PathType = ArrayType(StringType);
/** The index's ids (#1540): a team's key under `teams`, a job's id under `teams.jobs`, each in its own type. */
const YardIdType = yards.indexes.yards_in_time.keyType.fields.path.node.cases.step.fields.key;
/** A node's keys as a reader is given them: each team's key an id of the index's, under the teams' case. */
const teamIds = (path: ExprType<typeof PathType>) => path.map((_$, key) => East.value(variant('teams', key) as never, YardIdType));
const TileTotals = DictType(DateTimeType, RecordNestedTotalsType);
const TileFloats = DictType(DateTimeType, FloatType);
/** A month, as a level: the period the yards' index keeps its totals at. */
const MONTH: ValueTypeOf<typeof RecordLevelType> = variant('month', null);
/** An item of a subtree, as the yards' index names it: the teams' keys down to the team holding it, and its id. */
const UnderType = NestedUnderType(yards.indexes.yards_in_time);
const BeneathType = DictType(UnderType, JobRow);

// The plain tests, each a loop over what a node holds

/** A node's checks made in `[from, to)`. */
const checksIn = East.compile(East.function([ChecksType, DateTimeType, DateTimeType], ChecksType, (_$, checks, from, to) =>
  checks.filter((_$, check) => East.greaterEqual(check.at, from).and(() => East.less(check.at, to)))), []);
/** A node's hours logged in `[from, to)`. */
const hoursIn = East.compile(East.function([HoursType, DateTimeType, DateTimeType], HoursType, (_$, hours, from, to) =>
  hours.filter((_$, _value, logged) => East.greaterEqual(logged, from).and(() => East.less(logged, to)))), []);
/** A yard's notes made in `[from, to)`. */
const notesIn = East.compile(East.function([NotesType, DateTimeType, DateTimeType], NotesType, (_$, notes, from, to) =>
  notes.filter((_$, _note, made) => East.greaterEqual(made, from).and(() => East.less(made, to)))), []);

/**
 * Some jobs' totals a tile of a period: for each tile of it that overlaps a
 * window, how many of them touch it and the milliseconds of it they cover — a
 * loop over them all, a tile at a time, so a job is counted once in every
 * tile of the period that it touches.
 */
const jobTiles = East.compile(East.function([ArrayType(JobRow), RecordLevelType, DateTimeType, DateTimeType], TileTotals, ($, jobs, period, from, to) => {
  const tiles = $.let(new Map(), TileTotals);
  $.if(East.less(from, to), ($) => {
    const startOf = $.const(TILE_FNS.tileStart);
    const nextOf = $.const(TILE_FNS.tileNext);
    const tile = $.let(startOf(period, from));
    $.while(East.less(tile, to), ($) => {
      const next = $.const(nextOf(period, tile));
      const count = $.let(0n);
      const ms = $.let(0n);
      $.for(jobs, ($, job) => {
        $.match(job.start, {
          some: ($, start) => {
            const end = $.const(job.end.unwrap('some', () => start));
            // An instant touches the tile it is in, and covers none of it.
            $.if(East.lessEqual(end, start).and(() => East.greaterEqual(start, tile)).and(() => East.less(start, next)), ($) => {
              $.assign(count, count.add(1n));
            });
            $.if(East.greater(end, start).and(() => East.less(start, next)).and(() => East.greater(end, tile)), ($) => {
              $.assign(count, count.add(1n));
              $.assign(ms, ms.add(East.min(end, next).toEpochMilliseconds().subtract(East.max(start, tile).toEpochMilliseconds())));
            });
          },
        });
      });
      $.if(East.greater(count, 0n), ($) => { $(tiles.insert(tile, { count, ms, values: none })); });
      $.assign(tile, next);
    });
  });
  return tiles;
}), []);

/** Some instants' totals a tile of a period: for each tile of it that overlaps a window, how many are in it. */
const instantTiles = East.compile(East.function([ArrayType(DateTimeType), RecordLevelType, DateTimeType, DateTimeType], TileTotals, ($, instants, period, from, to) => {
  const tiles = $.let(new Map(), TileTotals);
  $.if(East.less(from, to), ($) => {
    const startOf = $.const(TILE_FNS.tileStart);
    const nextOf = $.const(TILE_FNS.tileNext);
    const tile = $.let(startOf(period, from));
    $.while(East.less(tile, to), ($) => {
      const next = $.const(nextOf(period, tile));
      const count = $.let(0n);
      $.for(instants, ($, made) => {
        $.if(East.greaterEqual(made, tile).and(() => East.less(made, next)), ($) => { $.assign(count, count.add(1n)); });
      });
      $.if(East.greater(count, 0n), ($) => { $(tiles.insert(tile, { count, ms: 0n, values: none })); });
      $.assign(tile, next);
    });
  });
  return tiles;
}), []);

/** A node's hours' totals a tile of a period: how many, their sum, the least, the greatest and the latest, taken in the order logged. */
const hourTiles = East.compile(East.function([HoursType, RecordLevelType, DateTimeType, DateTimeType], TileTotals, ($, hours, period, from, to) => {
  const tiles = $.let(new Map(), TileTotals);
  $.if(East.less(from, to), ($) => {
    const startOf = $.const(TILE_FNS.tileStart);
    const nextOf = $.const(TILE_FNS.tileNext);
    const tile = $.let(startOf(period, from));
    $.while(East.less(tile, to), ($) => {
      const next = $.const(nextOf(period, tile));
      const count = $.let(0n);
      const sum = $.let(0.0);
      const least = $.let(0.0);
      const greatest = $.let(0.0);
      const last = $.let(0.0);
      $.for(hours, ($, value, logged) => {
        $.if(East.greaterEqual(logged, tile).and(() => East.less(logged, next)), ($) => {
          $.assign(least, East.equal(count, 0n).ifElse(() => value, () => East.min(least, value)));
          $.assign(greatest, East.equal(count, 0n).ifElse(() => value, () => East.max(greatest, value)));
          $.assign(sum, sum.add(value));
          $.assign(last, value);
          $.assign(count, count.add(1n));
        });
      });
      $.if(East.greater(count, 0n), ($) => { $(tiles.insert(tile, { count, ms: 0n, values: some({ sum, min: least, max: greatest, last }) })); });
      $.assign(tile, next);
    });
  });
  return tiles;
}), []);

/** Some Floats' sum, added in order. */
const totalOf = East.compile(East.function([ArrayType(FloatType)], FloatType, (_$, values) => values.reduce((_$, sum, value) => sum.add(value), 0.0)), []);
/** The greatest of some Floats, of which there is one at least. */
const greatestOf = East.compile(East.function([ArrayType(FloatType)], FloatType, (_$, values) =>
  values.reduce((_$, most, value) => East.max(most, value), values.get(0n))), []);
/** A node's teams' keys as the index's key holds them: a path, each key under the teams' case. */
const pathOf = (path: readonly string[]) =>
  path.reduceRight<unknown>((rest, key) => variant('step', { key: variant('teams', key), rest }), variant('end', null)) as never;
const tileStartOf = East.compile(TILE_FNS.tileStart, []);
const tileNextOf = East.compile(TILE_FNS.tileNext, []);

/** The tiles of a level that overlap a window, each with the start of the one after it. */
function tilesIn(level: RecordTile, from: Date, to: Date): Array<{ tile: Date; next: Date }> {
  const tiles: Array<{ tile: Date; next: Date }> = [];
  if (instantOrder(from, to) >= 0) return tiles;
  for (let tile = tileStartOf(variant(level, null), from); instantOrder(tile, to) < 0; tile = tileNextOf(variant(level, null), tile)) {
    tiles.push({ tile, next: tileNextOf(variant(level, null), tile) });
  }
  return tiles;
}

/** A rollup of the hours, as the yards declare it: how a team's own hours in a tile fold, and how the teams within one are aggregated. */
type HoursRollup = { readonly fold: 'sum'; readonly aggregate: 'sum' } | { readonly fold: 'last'; readonly aggregate: 'max' };

/** What some teams draw in a tile, aggregated; none where none of them draws. */
function gathered(draws: readonly (number | undefined)[], rollup: HoursRollup): number | undefined {
  const held = draws.flatMap((draw) => (draw === undefined ? [] : [draw]));
  if (held.length === 0) return undefined;
  return rollup.aggregate === 'sum' ? totalOf(held) : greatestOf(held);
}

/**
 * What a team draws of its hours in a tile by a rollup: its own in the tile,
 * folded, where it logs any at all; else what the teams within it draw,
 * aggregated.
 */
function drawn(team: Team, tile: Date, next: Date, rollup: HoursRollup): number | undefined {
  if (team.hours.size === 0) return gathered([...team.teams.values()].map((within) => drawn(within, tile, next, rollup)), rollup);
  const logged = [...hoursIn(team.hours, tile, next).values()];
  if (logged.length === 0) return undefined;
  return rollup.fold === 'sum' ? totalOf(logged) : logged[logged.length - 1];
}

describe('a nested series index\'s readers', () => {
  const inTime = index(yards.indexes.yards_in_time);
  const held = entriesOf(yards, yards.indexes.yards_in_time, YARDS);
  const WINDOW = [inTime.type, StringType, PathType, DateTimeType, DateTimeType] as const;
  /** A node, as a failure names it. */
  const node = (yard: string, path: readonly string[]): string => [yard, ...path].join(' › ');

  it('items: a node\'s own items that overlap a window, each once with its id, at every level it files at, for seeded windows', () => {
    const jobsOf = East.compile(East.function([...WINDOW], JobsType, ($, entries, yard, path, from, to) =>
      inTime.read(entries).items({ collection: ['teams', 'jobs'], row: yard, path: teamIds(path), from, to }).collect($)), []);
    let given = 0;
    for (const { yard, path, team } of TEAMS) {
      for (const w of WINDOWS) {
        const expected = jobsIn(team.jobs, none, none, w.from, w.to);
        given += expected.size;
        assertEast(JobsType, jobsOf(held, yard, path, w.from, w.to), expected, `the jobs of ${node(yard, path)} in ${window(w)}`);
      }
    }
    assert.ok(given > 2000, `the windows hold jobs to read: ${given}`);

    // The row's own, its path left out
    const visitsOf = East.compile(East.function([inTime.type, StringType, DateTimeType, DateTimeType], JobsType, ($, entries, yard, from, to) =>
      inTime.read(entries).items({ collection: ['visits'], row: yard, from, to }).collect($)), []);
    for (const [yard, row] of YARDS) {
      for (const w of WINDOWS) assertEast(JobsType, visitsOf(held, yard, w.from, w.to), jobsIn(row.visits, none, none, w.from, w.to), `the visits to ${yard} in ${window(w)}`);
    }
  });

  it('items: the window\'s edges, an item past a year once, and no row or node that is not there', () => {
    const idsOf = East.compile(East.function([...WINDOW], ArrayType(StringType), ($, entries, yard, path, from, to) => {
      const ids = $.let([], ArrayType(StringType));
      inTime.read(entries).items({ collection: ['teams', 'jobs'], row: yard, path: teamIds(path), from, to }).each($, ($, _job, id) => { $(ids.pushLast(id)); });
      return ids;
    }), []);
    const deepest = ['T-1', 'T-1a', 'T-1a-i'];
    const week = idsOf(held, 'Y-1', deepest, at('2026-10-12T00:00:00.000'), at('2026-10-19T00:00:00.000'));
    const edges = new SortedSet(week.filter((id) => EDGES.some((name) => keyOrder(name, id) === 0)), keyOrder);
    assertEast(SetType(StringType), edges, new SortedSet(['E-instant-at-from', 'E-no-end', 'E-ends-before-start', 'E-past-a-year', 'E-a-millisecond-in'], keyOrder),
      'the edges inside the week');
    // Two years hold the job past a year under each of three: a body is given it once
    const years = idsOf(held, 'Y-1', deepest, at('2025-06-01T00:00:00.000'), at('2027-06-01T00:00:00.000'));
    assert.equal(years.filter((id) => keyOrder(id, 'E-past-a-year') === 0).length, 1, 'a job past a year, once');
    assert.equal(new SortedSet(years, keyOrder).size, years.length, 'each job once');
    assert.deepEqual(idsOf(held, 'Y-9', deepest, at('2025-06-01T00:00:00.000'), at('2027-06-01T00:00:00.000')), [], 'no such yard');
    assert.deepEqual(idsOf(held, 'Y-1', ['T-1', 'T-9'], at('2025-06-01T00:00:00.000'), at('2027-06-01T00:00:00.000')), [], 'no such team');
  });

  it('items, subtree: give their rows as a walk of the index meets them — a run a level, in the index\'s order of its levels', () => {
    type Filed = ValueTypeOf<typeof inTime.type.key>;
    const filed = [...(held as SortedMap<Filed, unknown>).keys()];
    const idsOf = East.compile(East.function([...WINDOW], ArrayType(StringType), ($, entries, yard, path, from, to) => {
      const ids = $.let([], ArrayType(StringType));
      inTime.read(entries).items({ collection: ['teams', 'jobs'], row: yard, path: teamIds(path), from, to }).each($, ($, _job, id) => { $(ids.pushLast(id)); });
      return ids;
    }), []);
    const beneathOf = East.compile(East.function([...WINDOW], ArrayType(UnderType), ($, entries, yard, path, from, to) => {
      const under = $.let([], ArrayType(UnderType));
      inTime.read(entries).subtree({ collection: ['teams', 'jobs'], row: yard, path: teamIds(path), from, to }).each($, ($, _job, at) => { $(under.pushLast(at)); });
      return under;
    }), []);
    const samePath = equalFor(inTime.index.keyType.fields.path);
    const levels = new SortedSet<ValueTypeOf<typeof RecordLevelType>>(undefined, compareFor(RecordLevelType));
    let given = 0;
    for (const w of WINDOWS.slice(0, 12)) {
      for (const { yard, path } of TEAMS) {
        // The node's own entries of each run: its row, and the path down to it
        const ofNode = filed.filter((entry) => keyOrder(entry.ik.row, yard) === 0 && samePath(entry.ik.path, pathOf(path)));
        const own = idsOf(held, yard, path, w.from, w.to);
        const beneath = beneathOf(held, yard, path, w.from, w.to);
        given += own.length + beneath.length;
        // A job's id is held under its collection's case of the index's ids.
        const idOf = (entry: (typeof ofNode)[number]): string | undefined => entry.ik.item.type === 'id' ? (entry.ik.item.value as { value: string }).value : undefined;
        for (const entry of ofNode) if (own.some((id) => idOf(entry) !== undefined && keyOrder(id, idOf(entry)!) === 0)) levels.add(entry.ik.level);
        assert.ok(inIndexOrder(StringType, ofNode, (entry) => entry.ik.run.type === 'items' ? idOf(entry) : undefined, own),
          `the jobs of ${node(yard, path)} in ${window(w)} come in the index's order`);
        assert.ok(inIndexOrder(UnderType, ofNode, (entry) => entry.ik.run.type === 'subtree' && entry.ik.item.type === 'under' ? entry.ik.item.value : undefined, beneath),
          `the jobs beneath ${node(yard, path)} in ${window(w)} come in the index's order`);
      }
    }
    assert.ok(given > 500, `the windows hold jobs to read: ${given}`);
    assert.ok(levels.size >= 4, `the windows read jobs filed at a week, a month, a quarter and a year: ${levels.size}`);
  });

  it('items: instants, by the instant each is at; and values, each with its instant', () => {
    const checksOf = East.compile(East.function([...WINDOW], ChecksType, ($, entries, yard, path, from, to) =>
      inTime.read(entries).items({ collection: ['teams', 'checks'], row: yard, path: teamIds(path), from, to }).collect($)), []);
    const hoursOf = East.compile(East.function([...WINDOW], HoursType, ($, entries, yard, path, from, to) =>
      inTime.read(entries).items({ collection: ['teams', 'hours'], row: yard, path: teamIds(path), from, to }).collect($)), []);
    let checks = 0;
    let hours = 0;
    for (const { yard, path, team } of TEAMS) {
      for (const w of WINDOWS) {
        const made = checksIn(team.checks, w.from, w.to);
        const logged = hoursIn(team.hours, w.from, w.to);
        checks += made.size;
        hours += logged.size;
        assertEast(ChecksType, checksOf(held, yard, path, w.from, w.to), made, `the checks of ${node(yard, path)} in ${window(w)}`);
        assertEast(HoursType, hoursOf(held, yard, path, w.from, w.to), logged, `the hours of ${node(yard, path)} in ${window(w)}`);
      }
    }
    assert.ok(checks > 500 && hours > 2000, `the windows hold checks and hours to read: ${checks}, ${hours}`);
    // A check at the window's first instant is inside it, and one at its end outside
    const week = checksOf(held, 'Y-1', ['T-2'], at('2026-10-12T00:00:00.000'), at('2026-10-19T00:00:00.000'));
    assert.ok(week.has('C-15') && !week.has('C-16'), 'the checks at the week\'s edges');

    // Values that are no numbers, on the row itself
    const notesOf = East.compile(East.function([inTime.type, StringType, DateTimeType, DateTimeType], NotesType, ($, entries, yard, from, to) =>
      inTime.read(entries).items({ collection: ['notes'], row: yard, from, to }).collect($)), []);
    for (const [yard, row] of YARDS) {
      for (const w of WINDOWS) assertEast(NotesType, notesOf(held, yard, w.from, w.to), notesIn(row.notes, w.from, w.to), `the notes of ${yard} in ${window(w)}`);
    }
  });

  it('subtree: the items of every node beneath a node that overlap a window, each once, with the keys down to the node holding it', () => {
    const beneathOf = East.compile(East.function([...WINDOW], BeneathType, ($, entries, yard, path, from, to) =>
      inTime.read(entries).subtree({ collection: ['teams', 'jobs'], row: yard, path: teamIds(path), from, to }).collect($)), []);
    // The yards themselves, each team, and one with none within it
    const parents = [
      ...[...YARDS].map(([yard, row]) => ({ yard, path: [] as string[], teams: row.teams })),
      ...TEAMS.map(({ yard, path, team }) => ({ yard, path, teams: team.teams })),
    ];
    let given = 0;
    for (const { yard, path, teams } of parents) {
      for (const w of WINDOWS.slice(0, 30)) {
        const expected = new SortedMap<ValueTypeOf<typeof UnderType>, Job>(undefined, compareFor(UnderType));
        for (const within of teamsBeneath(teams)) {
          for (const [id, row] of jobsIn(within.team.jobs, none, none, w.from, w.to)) expected.set({ path: pathOf(within.path), id: variant('teams.jobs', id) }, row);
        }
        given += expected.size;
        assertEast(BeneathType, beneathOf(held, yard, path, w.from, w.to), expected, `the jobs beneath ${node(yard, path)} in ${window(w)}`);
      }
    }
    assert.ok(given > 2000, `the windows hold jobs beneath to read: ${given}`);
  });

  it('totals, subtreeTotals: a node\'s totals a month, and those of the items beneath it, for each month that overlaps a window', () => {
    const totalsOf = (place: readonly ['teams', 'jobs'] | readonly ['teams', 'checks'] | readonly ['teams', 'hours']) =>
      East.compile(East.function([...WINDOW], TileTotals, ($, entries, yard, path, from, to) =>
        inTime.read(entries).totals({ collection: place, row: yard, path: teamIds(path), from, to }).collect($)), []);
    const jobTotals = totalsOf(['teams', 'jobs']);
    const checkTotals = totalsOf(['teams', 'checks']);
    const hourTotals = totalsOf(['teams', 'hours']);
    const beneathTotals = East.compile(East.function([...WINDOW], TileTotals, ($, entries, yard, path, from, to) =>
      inTime.read(entries).subtreeTotals({ collection: ['teams', 'jobs'], row: yard, path: teamIds(path), from, to }).collect($)), []);
    let months = 0;
    for (const { yard, path, team } of TEAMS) {
      for (const w of WINDOWS.slice(0, 30)) {
        const where = `${node(yard, path)} in ${window(w)}`;
        const expected = jobTiles([...team.jobs.values()], MONTH, w.from, w.to);
        months += expected.size;
        assertEast(TileTotals, jobTotals(held, yard, path, w.from, w.to), expected, `the jobs' months of ${where}`);
        assertEast(TileTotals, checkTotals(held, yard, path, w.from, w.to), instantTiles([...team.checks.values()].map((check) => check.at), MONTH, w.from, w.to),
          `the checks' months of ${where}`);
        assertEast(TileTotals, hourTotals(held, yard, path, w.from, w.to), hourTiles(team.hours, MONTH, w.from, w.to), `the hours' months of ${where}`);
        assertEast(TileTotals, beneathTotals(held, yard, path, w.from, w.to),
          jobTiles(teamsBeneath(team.teams).flatMap((within) => [...within.team.jobs.values()]), MONTH, w.from, w.to), `the months of the jobs beneath ${where}`);
      }
    }
    assert.ok(months > 1000, `the windows hold months to read: ${months}`);

    // The row's own collections, and what is beneath the row: the one period the index keeps, named as it may be
    const rowTotals = (place: readonly ['visits'] | readonly ['notes']) =>
      East.compile(East.function([inTime.type, StringType, DateTimeType, DateTimeType], TileTotals, ($, entries, yard, from, to) =>
        inTime.read(entries).totals({ collection: place, row: yard, tile: 'month', from, to }).collect($)), []);
    const visitTotals = rowTotals(['visits']);
    const noteTotals = rowTotals(['notes']);
    for (const [yard, row] of YARDS) {
      for (const w of WINDOWS.slice(0, 30)) {
        assertEast(TileTotals, visitTotals(held, yard, w.from, w.to), jobTiles([...row.visits.values()], MONTH, w.from, w.to), `the visits' months of ${yard} in ${window(w)}`);
        assertEast(TileTotals, noteTotals(held, yard, w.from, w.to), instantTiles([...row.notes.keys()], MONTH, w.from, w.to), `the notes' months of ${yard} in ${window(w)}`);
        assertEast(TileTotals, beneathTotals(held, yard, [], w.from, w.to),
          jobTiles(teamsBeneath(row.teams).flatMap((within) => [...within.team.jobs.values()]), MONTH, w.from, w.to), `the months of the jobs beneath ${yard} in ${window(w)}`);
      }
    }
  });

  it('totals, subtreeTotals: at each period the index keeps them at, the one `tile` names — an item counted once in every tile of it that it touches (#1739)', () => {
    const byPeriod = index(yardsByPeriod.indexes.yards_in_time);
    const kept = entriesOf(yardsByPeriod, yardsByPeriod.indexes.yards_in_time, YARDS);
    const NODE = [byPeriod.type, StringType, PathType, DateTimeType, DateTimeType] as const;
    const read = { week: 0, month: 0 };
    for (const tile of ['week', 'month'] as const) {
      const period: ValueTypeOf<typeof RecordLevelType> = variant(tile, null);
      const jobTotals = East.compile(East.function([...NODE], TileTotals, ($, entries, yard, path, from, to) =>
        byPeriod.read(entries).totals({ collection: ['teams', 'jobs'], row: yard, path: teamIds(path), tile, from, to }).collect($)), []);
      const checkTotals = East.compile(East.function([...NODE], TileTotals, ($, entries, yard, path, from, to) =>
        byPeriod.read(entries).totals({ collection: ['teams', 'checks'], row: yard, path: teamIds(path), tile, from, to }).collect($)), []);
      const hourTotals = East.compile(East.function([...NODE], TileTotals, ($, entries, yard, path, from, to) =>
        byPeriod.read(entries).totals({ collection: ['teams', 'hours'], row: yard, path: teamIds(path), tile, from, to }).collect($)), []);
      const beneathTotals = East.compile(East.function([...NODE], TileTotals, ($, entries, yard, path, from, to) =>
        byPeriod.read(entries).subtreeTotals({ collection: ['teams', 'jobs'], row: yard, path: teamIds(path), tile, from, to }).collect($)), []);
      for (const { yard, path, team } of TEAMS) {
        for (const w of WINDOWS.slice(0, 12)) {
          const where = `${node(yard, path)} in ${window(w)}`;
          const expected = jobTiles([...team.jobs.values()], period, w.from, w.to);
          read[tile] += expected.size;
          assertEast(TileTotals, jobTotals(kept, yard, path, w.from, w.to), expected, `the jobs' totals a ${tile} of ${where}`);
          assertEast(TileTotals, checkTotals(kept, yard, path, w.from, w.to), instantTiles([...team.checks.values()].map((check) => check.at), period, w.from, w.to),
            `the checks' totals a ${tile} of ${where}`);
          assertEast(TileTotals, hourTotals(kept, yard, path, w.from, w.to), hourTiles(team.hours, period, w.from, w.to), `the hours' totals a ${tile} of ${where}`);
          assertEast(TileTotals, beneathTotals(kept, yard, path, w.from, w.to),
            jobTiles(teamsBeneath(team.teams).flatMap((within) => [...within.team.jobs.values()]), period, w.from, w.to), `a ${tile}'s totals of the jobs beneath ${where}`);
        }
      }
    }
    assert.ok(read.month > 100 && read.week > read.month, `the windows hold weeks and months to read: ${read.week}, ${read.month}`);
  });

  it('subtotals: a parent\'s subtotals by a rollup at a level, for each tile that overlaps a window; none for a node that draws its own', () => {
    const rollups: HoursRollup[] = [{ fold: 'sum', aggregate: 'sum' }, { fold: 'last', aggregate: 'max' }];
    const levels: RecordTile[] = ['week', 'month', 'quarter', 'year'];
    const parents = [
      ...[...YARDS].map(([yard, row]) => ({ yard, path: [] as string[], hours: 0, teams: row.teams })),
      ...TEAMS.map(({ yard, path, team }) => ({ yard, path, hours: team.hours.size, teams: team.teams })),
    ];
    let subtotals = 0;
    for (const rollup of rollups) {
      for (const level of levels) {
        const subtotalsOf = East.compile(East.function([...WINDOW], TileFloats, ($, entries, yard, path, from, to) =>
          inTime.read(entries).subtotals({
            collection: ['teams', 'hours'], row: yard, path: teamIds(path), from, to, level,
            rollup: rollup.fold === 'sum' ? 'sum' : { fold: 'last', aggregate: 'max' },
          }).collect($)), []);
        for (const { yard, path, hours, teams } of parents) {
          for (const w of WINDOWS.slice(0, 12)) {
            const expected = new SortedMap<Date, number>(undefined, instantOrder);
            // A node that logs hours of its own draws them, and keeps no subtotal
            if (hours === 0) {
              for (const { tile, next } of tilesIn(level, w.from, w.to)) {
                const drew = gathered([...teams.values()].map((within) => drawn(within, tile, next, rollup)), rollup);
                if (drew !== undefined) expected.set(tile, drew);
              }
            }
            subtotals += expected.size;
            assertEast(TileFloats, subtotalsOf(held, yard, path, w.from, w.to), expected,
              `the ${rollup.fold} of hours a ${level} beneath ${node(yard, path)} in ${window(w)}`);
          }
        }
      }
    }
    assert.ok(subtotals > 500, `the windows hold subtotals to read: ${subtotals}`);

    // The level left out is the index's tile
    const weeks = East.compile(East.function([inTime.type, StringType, DateTimeType, DateTimeType], TileFloats, ($, entries, yard, from, to) =>
      inTime.read(entries).subtotals({ collection: ['teams', 'hours'], row: yard, rollup: 'sum', from, to }).collect($)), []);
    const read = weeks(held, 'Y-1', at('2026-10-05T00:00:00.000'), at('2026-11-02T00:00:00.000'));
    assert.equal(read.size, 4, 'four weeks of October');
  });

  it('types what a read gives by the collection\'s place, and refuses a place the index does not file', () => {
    East.function([inTime.type, StringType, DateTimeType, DateTimeType], FloatType, ($, entries, yard, from, to) => {
      const readers = inTime.read(entries);
      const total = $.let(0.0);
      const latest = $.let(from);
      // A value is its collection's Float, at its instant; an item its struct, by its id
      readers.items({ collection: ['teams', 'hours'], row: yard, path: [variant('teams', 'T-1'), variant('teams', 'T-1b')], from, to }).each($, ($, hours, logged) => {
        $.assign(total, total.add(hours));
        $.assign(latest, logged);
      });
      readers.items({ collection: ['teams', 'jobs'], row: yard, path: [variant('teams', 'T-1')], from, to }).each($, ($, job, id) => {
        $.if(East.equal(id, 'W-0001'), ($) => { $.assign(total, total.add(job.sheets)); });
      });
      readers.subtree({ collection: ['teams', 'jobs'], row: yard, from, to }).each($, ($, job, under) => {
        $.if(East.equal(under.id as never, East.value(variant('teams.jobs', 'W-0001') as never, YardIdType)), ($) => { $.assign(total, total.add(job.sheets)); });
      });
      // @ts-expect-error — the index files no collection at ['teams']: its rows hold the collections
      assert.throws(() => readers.items({ collection: ['teams'], row: yard, from, to }), /items: the index files no collection at \["teams"\]/);
      // @ts-expect-error — nor at a field it does not name
      assert.throws(() => readers.totals({ collection: ['crews'], row: yard, from, to }), /totals: the index files no collection at \["crews"\]/);
      return total;
    });
  });

  it('refuses what the index does not keep, where the reader is called, naming what it does', () => {
    const over = (body: (readers: ReturnType<typeof inTime.read>) => unknown) => () =>
      East.function([inTime.type], NullType, (_$, entries) => { body(inTime.read(entries)); return null; });
    const from = at('2026-10-12T00:00:00.000');
    const to = at('2026-10-19T00:00:00.000');
    assert.throws(over((readers) => readers.items({ collection: ['teams', 'tasks'] as never, row: 'Y-1', from, to })),
      /^Error: e3\.index 'yards\.yards_in_time' items: the index files no collection at \["teams","tasks"\] — it files \['notes'\], \['visits'\], \['teams', 'checks'\], \['teams', 'hours'\], \['teams', 'jobs'\], each by its field names from the row down$/);
    assert.throws(over((readers) => readers.items({ collection: ['visits'], from, to } as never)), /items: `row` is left out — the key of the record's row the node is in/);
    assert.throws(over((readers) => readers.items({ collection: ['visits'], row: 'Y-1', from } as never)), /items: `to` is left out — a window is \[from, to\), each a DateTime/);
    assert.throws(over((readers) => readers.subtree({ collection: ['visits'], row: 'Y-1', from, to })),
      /^Error: e3\.index 'yards\.yards_in_time' subtree: the collection at \['visits'\] is not rolled up, so no node holds the items beneath it — declare it index\.nestedSeries\.items\(times, \{ rollup: true \}\)$/);
    assert.throws(over((readers) => readers.subtreeTotals({ collection: ['teams', 'hours'], row: 'Y-1', from, to })), /subtreeTotals: the collection at \['teams', 'hours'\] is not rolled up/);
    assert.throws(over((readers) => readers.subtotals({ collection: ['teams', 'hours'], row: 'Y-1', rollup: 'mean', from, to })),
      /^Error: e3\.index 'yards\.yards_in_time' subtotals: the collection at \['teams', 'hours'\] keeps no subtotal by mean — it keeps sum, \{ fold: 'last', aggregate: 'max' \}$/);
    assert.throws(over((readers) => readers.subtotals({ collection: ['teams', 'jobs'], row: 'Y-1', rollup: 'sum', from, to })),
      /subtotals: the collection at \['teams', 'jobs'\] keeps no subtotal by sum — it keeps none: declare index\.nestedSeries\.values\(\{ rollup \}\)/);
    assert.throws(over((readers) => readers.subtotals({ collection: ['teams', 'hours'], row: 'Y-1', rollup: 'median' as never, from, to })),
      /subtotals: the collection at \['teams', 'hours'\] rolls up by "median", which is no rollup/);
    assert.throws(over((readers) => readers.subtotals({ collection: ['teams', 'hours'], row: 'Y-1', rollup: 'sum', level: 'day', from, to })),
      /subtotals: the index keeps subtotals at week, month, quarter, year, and none at "day"/);
    // A node's path given as its keys alone, where each is an id of the index's (#1540): refused in words that write it.
    assert.throws(over((readers) => readers.items({ collection: ['teams', 'jobs'], row: 'Y-1', path: ['T-1'] as never, from, to })),
      /^Error: e3\.index 'yards\.yards_in_time' items: `path` names a node by its child rows' keys from the row down, each an id of the index's under its rows' place — path: \[variant\('teams', key\)\]$/);
    assert.throws(over((readers) => readers.items({ collection: ['visits'], row: 'Y-1', path: ['T-1'] as never, from, to })),
      /items: `path` names a node by its child rows' keys from the row down, each an id of the index's under its rows' place — a collection of the row itself has no path: leave `path` out$/);

    // An index that declares no summary keeps no totals
    const Shed = StructType({ name: StringType, visits: JobsType });
    const sheds = record('sheds', DictType(StringType, Shed), {
      initial: new Map(),
      indexes: (index) => ({ sheds_in_time: index.nestedSeries({ collections: { visits: index.nestedSeries.items({ from: 'start', to: 'end' }) }, tile: 'day' }) }),
    });
    const shedsInTime = index(sheds.indexes.sheds_in_time);
    assert.throws(() => East.function([shedsInTime.type], NullType, (_$, entries) => {
      shedsInTime.read(entries).totals({ collection: ['visits'], row: 'S-1', from, to });
      return null;
    }), /^Error: e3\.index 'sheds\.sheds_in_time' totals: the index keeps no totals — declare the periods they are kept at, as index\.nestedSeries\(\{ …, summary: \['month'\] \}\)$/);
  });

  it('refuses a period the index keeps no totals at, and a read that names none of several, where the reader is called (#1739)', () => {
    const from = at('2026-10-12T00:00:00.000');
    const to = at('2026-10-19T00:00:00.000');
    // An index that keeps its totals at one period reads it, named or not, and no other
    assert.throws(() => East.function([inTime.type], NullType, (_$, entries) => {
      // @ts-expect-error — the yards keep their totals a month alone
      inTime.read(entries).totals({ collection: ['visits'], row: 'Y-1', tile: 'week', from, to });
      return null;
    }), /^Error: e3\.index 'yards\.yards_in_time' totals: the index keeps its totals at month, and none at "week"$/);

    // One that keeps them at several reads the one a read names
    const byPeriod = index(yardsByPeriod.indexes.yards_in_time);
    const over = (body: (readers: ReturnType<typeof byPeriod.read>) => unknown) => () =>
      East.function([byPeriod.type], NullType, (_$, entries) => { body(byPeriod.read(entries)); return null; });
    assert.throws(over((readers) => readers.totals({ collection: ['visits'], row: 'Y-1', from, to })),
      /^Error: e3\.index 'yards_by_period\.yards_in_time' totals: the index keeps its totals at week, month — name the one to read, as tile: 'week'$/);
    assert.throws(over((readers) => readers.subtreeTotals({ collection: ['teams', 'jobs'], row: 'Y-1', from, to })),
      /^Error: e3\.index 'yards_by_period\.yards_in_time' subtreeTotals: the index keeps its totals at week, month — name the one to read, as tile: 'week'$/);
    // @ts-expect-error — it keeps no totals a quarter: `tile` is one of the periods its `summary` names
    assert.throws(over((readers) => readers.totals({ collection: ['visits'], row: 'Y-1', tile: 'quarter', from, to })),
      /^Error: e3\.index 'yards_by_period\.yards_in_time' totals: the index keeps its totals at week, month, and none at "quarter"$/);
    // @ts-expect-error — nor a day
    assert.throws(over((readers) => readers.subtreeTotals({ collection: ['teams', 'jobs'], row: 'Y-1', tile: 'day', from, to })),
      /^Error: e3\.index 'yards_by_period\.yards_in_time' subtreeTotals: the index keeps its totals at week, month, and none at "day"$/);
    // A collection that is not rolled up is refused before the period is read
    assert.throws(over((readers) => readers.subtreeTotals({ collection: ['teams', 'hours'], row: 'Y-1', tile: 'week', from, to })),
      /subtreeTotals: the collection at \['teams', 'hours'\] is not rolled up/);
  });

  it('arrives on the body\'s parameter in a function with a spec', () => {
    const fn = function_('hours_of_team', {
      inputs: [inTime],
      args: [StringType, PathType, DateTimeType, DateTimeType],
      output: FloatType,
    }, ($, yardsInTime, yard, path, from, to) => {
      const hours = $.let(0.0);
      yardsInTime.items({ collection: ['teams', 'hours'], row: yard, path: teamIds(path), from, to }).each($, ($, logged) => { $.assign(hours, hours.add(logged)); });
      return hours;
    });
    const run = (fn.body as IRBundle).compile([]) as (...args: unknown[]) => number;
    const from = at('2026-10-05T00:00:00.000');
    const to = at('2026-11-02T00:00:00.000');
    const crew = TEAMS.find((found) => found.team.hours.size > 0);
    assert.ok(crew !== undefined);
    const logged = [...hoursIn(crew.team.hours, from, to).values()];
    assert.ok(logged.length > 10);
    assert.equal(run(held, crew.yard, crew.path, from, to), totalOf(logged));
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
    // @ts-expect-error — an index led by a field takes it: `unset` with no `on` does not type
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
    const byZone = index(racks.indexes.by_zone_area);
    // @ts-expect-error — an index led by a field takes it: `unplaced` with no `on` does not type
    assert.throws(over(byZone, (entries) => byZone.read(entries).unplaced()), /unplaced: 'zone' is left out/);
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

  it('gives back what already carries its readers as it is, and refuses what carries another index\'s of the same type, naming it', () => {
    const byPress = input.by_press;
    const byState = index(jobs.indexes.by_state);
    const refused = /^Error: e3\.index 'jobs\.by_state' reads its own entries, and was given those of e3\.index 'jobs\.by_press', which are of the same type — pass the body's parameter for this index$/;

    // A body's parameter for an index carries that index's readers: another index of its type does not read it
    function_('jobs_by_two', { inputs: [byPress, byState], args: [], output: NullType }, (_$, pressEntries, stateEntries) => {
      const of = pressEntries.of;
      assert.equal(byPress.read(pressEntries), pressEntries, 'its own parameter, as it is');
      assert.equal(pressEntries.of, of, 'its readers not made again');
      assert.throws(() => byState.read(pressEntries as never), refused);
      assert.equal(byState.read(stateEntries), stateEntries);
      return null;
    });

    // In a task's own function a parameter is known by its type alone, until an index's read is given it
    East.function([byPress.type, byState.type], NullType, (_$, pressEntries) => {
      const read = byPress.read(pressEntries);
      const of = read.of;
      assert.equal(byPress.read(read).of, of, 'read again, the same readers');
      assert.throws(() => byState.read(pressEntries as never), refused);
      return null;
    });
  });
});

describe('what a read gives, beside an index that files the rows\' fields apart', () => {
  /** A shift on a press: when it runs, and the hands on it by grade — a field an entries index files apart. */
  const CrewedShift = StructType({ press: StringType, start: DateTimeType, end: DateTimeType, byGrade: DictType(StringType, IntegerType) });
  const CrewedType = DictType(StringType, CrewedShift);
  const crewed = record('crewed_shifts', CrewedType, {
    initial: new Map(),
    indexes: (index) => ({
      hands_by_grade: index.entries('byGrade'),
      by_press: index.on(['press']),
      in_time: index.interval({ from: 'start', to: 'end' }),
      presses: index.key(East.function([StringType, CrewedShift], StringType, (_$, _key, shift) => shift.press),
        { value: East.function([StringType, CrewedShift], StringType, (_$, _key, shift) => shift.press) }),
    }),
  });
  const rows = new SortedMap<string, ValueTypeOf<typeof CrewedShift>>(undefined, keyOrder);
  for (let n = 0; n < 30; n++) {
    const start = OCT_5 + BigInt(n) * 8n * HOUR;
    rows.set(`C-${String(n).padStart(2, '0')}`, decodeBeast2For(CrewedShift)(encodeBeast2For(CrewedShift)({
      press: PRESSES[n % 3]!, start: instant(start), end: instant(start + 8n * HOUR),
      byGrade: new SortedMap<string, bigint>([['lead', 1n], ['hand', BigInt(2 + (n % 3))]], keyOrder),
    })));
  }
  /** The rows as the record's other indexes carry them: lean, the field the entries index files emptied. */
  const lean = (kept: (key: string, shift: ValueTypeOf<typeof CrewedShift>) => boolean) =>
    new SortedMap([...rows].filter(([key, shift]) => kept(key, shift))
      .map(([key, shift]): [string, ValueTypeOf<typeof CrewedShift>] => [key, { ...shift, byGrade: new SortedMap<string, bigint>(undefined, keyOrder) }]), keyOrder);

  it('types a read by what the index carries as its record builds it: the lean row, where its declaration alone says nothing', () => {
    const inTime = index(crewed.indexes.in_time);
    const byPress = index(crewed.indexes.by_press);
    const presses = index(crewed.indexes.presses);
    const from = at('2026-10-06T00:00:00.000');
    const to = at('2026-10-07T00:00:00.000');

    // An interval index, and a plain index with no `value`, carry the lean row beside an entries index
    const running = East.compile(East.function([inTime.type, DateTimeType, DateTimeType], CrewedType, ($, entries, from, to) =>
      inTime.read(entries).overlapping({ from, to }).collect($)), []);
    const expected = lean((_key, shift) => compareFor(DateTimeType)(shift.start, to) < 0 && compareFor(DateTimeType)(shift.end, from) > 0);
    assert.ok(expected.size > 0);
    assertEast(CrewedType, running(entriesOf(crewed, crewed.indexes.in_time, rows), from, to), expected, 'the shifts running in the day, lean');
    const onPress = East.compile(East.function([byPress.type, StringType], DictType(StringType, DateTimeType), ($, entries, press) => {
      const starts = $.let(new Map(), DictType(StringType, DateTimeType));
      byPress.read(entries).of(press).each($, ($, shift, key) => { $(starts.insert(key, shift.start)); });
      return starts;
    }), []);
    assertEast(DictType(StringType, DateTimeType), onPress(entriesOf(crewed, crewed.indexes.by_press, rows), 'P-1002'),
      new SortedMap([...rows].filter(([, shift]) => shift.press === 'P-1002').map(([key, shift]): [string, Date] => [key, shift.start]), keyOrder), 'each shift\'s start, read off the lean row');

    // One with a `value` of its own carries its own
    const named = East.compile(East.function([presses.type, StringType], DictType(StringType, StringType), ($, entries, press) =>
      presses.read(entries).of(press).collect($)), []);
    assert.equal(named(entriesOf(crewed, crewed.indexes.presses, rows), 'P-1003').size, 10);

    // In a function with a spec, the parameter is typed the same way
    const fn = function_('shifts_running', { inputs: [inTime], args: [DateTimeType, DateTimeType], output: CrewedType },
      ($, shiftsInTime, from, to) => shiftsInTime.overlapping({ from, to }).collect($));
    assert.equal(fn.inputs.length, 1);

    // What the declaration alone invited — an index with no `value` carries nothing — no longer types, and never built
    // @ts-expect-error — the read gives the lean row, not Null
    assert.throws(() => East.function([inTime.type, DateTimeType, DateTimeType], DictType(StringType, NullType),
      ($, entries, from, to) => inTime.read(entries).overlapping({ from, to }).collect($)));
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
