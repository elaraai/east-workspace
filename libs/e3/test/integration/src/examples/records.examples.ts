/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { East, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, none, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { example } from './example.js';

// ---
// e3.record
// ---

export const recordMutations = example({
  keywords: ['e3', 'record', 'mutation', 'reduce', 'edit', 'patch', 'index', 'audited state'],
  description: 'Declare a record whole: an index, and mutations of each form — reduce the whole state, edit a few entries, patch with a change',
  fn: () => {
    const PlanType = StructType({ title: StringType, owner: StringType });
    const PlansType = DictType(StringType, PlanType);
    const plans = e3.record('plans', PlansType, {
      initial: new Map(),
      // An index: a second collection in another order, maintained in the same commit.
      indexes: (index) => ({
        by_owner: index.key(East.function([StringType, PlanType], StringType, ($, _id, plan) => plan.owner)),
      }),
      mutations: (mutation) => ({
        // reduce: the reducer returns the whole new state — any record.
        add_plan: mutation.reduce(East.function([PlansType, StringType, PlanType], PlansType, ($, state, id, plan) => {
          const next = $.let(state.copy());   // the state is a frozen input
          $(next.insert(id, plan));
          return next;
        })),
        // edit: reads the state lazily and writes through `edit`, so a write costs the segments it touches.
        reassign: mutation.edit(East.function([PlansType, StringType, StringType, e3.mutation.editType(PlansType)], NullType,
          ($, state, id, owner, edit) => { $(edit.set(id, { title: state.get(id).title, owner })); })),
        // patch: no body — the argument is the change, a PatchType of the state.
        patch: mutation.patch(),
      }),
    });
    return e3.package('planning', '1.0.0', plans);
  },
});

export const recordEditUpsert = example({
  keywords: ['e3', 'record', 'edit', 'mutation', 'upsert', 'add', 'quantity', 'stock', 'e3 mutate'],
  description: 'An edit mutation that adds to an entry or creates it, touching only that entry (`e3 mutate <repo> stock.receive \'"pear"\' 3 -w <ws>`), and a task reading the record',
  fn: () => {
    const StockType = DictType(StringType, IntegerType);
    const stock = e3.record('stock', StockType, {
      initial: new Map([['apple', 5n]]),
      mutations: (mutation) => ({
        receive: mutation.edit(East.function([StockType, StringType, IntegerType, e3.mutation.editType(StockType)], NullType,
          ($, state, sku, qty, edit) => {
            const now = $.let(qty);
            $.if(state.has(sku), ($) => { $.assign(now, state.get(sku).add(qty)); });
            $(edit.set(sku, now));
          })),
      }),
    });
    const total = e3.task('total', [stock], East.function([StockType], IntegerType, ($, s) => s.sum()));
    return e3.package('inventory', '1.0.0', total);
  },
});

export const recordMigration = example({
  keywords: ['e3', 'record', 'migration', 'rows', 'schema change', 'version', 'deploy'],
  description: "Change a record's type between package versions with a migration step: a deploy runs the steps a workspace has not applied, in order",
  fn: () => {
    const RowV1Type = StructType({ title: StringType });
    const RowV2Type = StructType({ title: StringType, owner: StringType });
    const plans = e3.record('plans', DictType(StringType, RowV2Type), {
      initial: new Map(),
      migrations: (migration) => [
        migration.rows('add_owner', East.function([StringType, RowV1Type], RowV2Type,
          ($, _id, row) => ({ title: row.title, owner: 'unassigned' }))),
      ],
    });
    return e3.package('planning', '2.0.0', plans);
  },
});

export const recordIndexInput = example({
  keywords: ['e3', 'record', 'index', 'e3.index', 'input', 'function', 'task', 'prefix', 'range', 'run of an index', 'read by index', 'inputs'],
  description: 'Read a record through one of its indexes inside a function and a task: `e3.index(record.indexes.<name>)` in the inputs hands the body the index\'s entries, read a run at a time with `prefix` and `range`',
  fn: () => {
    const JobType = StructType({ title: StringType, press: StringType });
    const JobsType = DictType(StringType, JobType);
    const jobs = e3.record('jobs', JobsType, {
      initial: new Map([['j1', { title: 'Annual report', press: 'P1' }], ['j2', { title: 'Posters', press: 'P2' }]]),
      indexes: (index) => ({ jobs_by_press: index.on(['press']) }),
      mutations: (mutation) => ({ patch: mutation.patch() }),
    });
    // The body is given the index's entries, Dict<{ ik, k }, P>: `ik` the index's key, `k` the row's key,
    // and P what the index carries (nothing here). A press's entries are one run, so its size costs the
    // run's two ends, never the index.
    const byPress = e3.index(jobs.indexes.jobs_by_press);
    const jobsOnPress = e3.function('jobs_on_press', { inputs: [byPress], args: [StringType], output: IntegerType },
      ($, jobsByPress, press) => jobsByPress.prefix({ ik: press }).size());
    // To read more of a row than the index carries, take the record beside it and read the row by the
    // entry's `k`: both are read at one state of the record.
    const titlesOnPress = e3.function('titles_on_press', { inputs: [byPress, jobs], args: [StringType], output: DictType(StringType, StringType) },
      ($, jobsByPress, jobs, press) => {
        const titles = $.let(new Map(), DictType(StringType, StringType));
        $.for(jobsByPress.prefix({ ik: press }), ($, _carried, key) => { $(titles.insert(key.k, jobs.get(key.k).title)); });
        return titles;
      });
    // A task takes it the same way; its body's parameter is the input's type. It is decided again when
    // the record changes, and runs again when the index it reads did.
    const watched = e3.input('watched', StringType, variant('value', 'P1'));
    const watchedJobs = e3.task('watched_jobs', [byPress, watched],
      East.function([byPress.type, StringType], IntegerType, ($, jobsByPress, press) => jobsByPress.prefix({ ik: press }).size()));
    return e3.package('pressroom', '1.0.0', jobsOnPress, titlesOnPress, watchedJobs);
  },
});

// ---
// e3.index — a reader for each kind of index
// ---

export const recordReadPlainIndex = example({
  keywords: ['e3', 'record', 'index', 'e3.index', 'reader', 'of', 'between', 'each', 'collect', 'index.on', 'rows under a key', 'function'],
  description: 'Read a plain index inside a function: `of(key)` gives the rows filed under an index key, or under a leading part of one, and `between({ from, to })` the rows from one key up to another — a read runs a body once a row with `each`, or gives its rows as a Dict by the row\'s key with `collect`',
  fn: () => {
    const JobType = StructType({ title: StringType, press: StringType, state: StringType, sheets: IntegerType });
    const jobs = e3.record('jobs', DictType(StringType, JobType), {
      initial: new Map([
        ['j1', { title: 'Annual report', press: 'P1', state: 'confirmed', sheets: 4000n }],
        ['j2', { title: 'Posters', press: 'P2', state: 'proposed', sheets: 900n }],
        ['j3', { title: 'Catalogue', press: 'P1', state: 'proposed', sheets: 12000n }],
      ]),
      indexes: (index) => ({
        by_state_press: index.on(['state', 'press']),
        // An index that carries a value of its own: a read gives it, and no row is read.
        sheets_by_press: index.on(['press'], { value: East.function([StringType, JobType], IntegerType, ($, _id, job) => job.sheets) }),
      }),
    });
    // each: the body is given what the index carries for the row, and the row's key.
    const sheetsOn = e3.function('sheets_on', { inputs: [e3.index(jobs.indexes.sheets_by_press)], args: [StringType], output: IntegerType },
      ($, sheetsByPress, press) => {
        const total = $.let(0n);
        sheetsByPress.of(press).each($, ($, sheets) => { $.assign(total, total.add(sheets)); });
        return total;
      });
    // A leading part of the key, `{ state }` of ['state', 'press']; collect: a Dict by the row's key.
    const jobsIn = e3.function('jobs_in', { inputs: [e3.index(jobs.indexes.by_state_press)], args: [StringType], output: DictType(StringType, NullType) },
      ($, byState, state) => byState.of({ state }).collect($));
    // From one index key up to another; an end left out is that end of the index.
    const sheetsBetween = e3.function('sheets_between', { inputs: [e3.index(jobs.indexes.sheets_by_press)], args: [StringType, StringType], output: DictType(StringType, IntegerType) },
      ($, sheetsByPress, from, to) => sheetsByPress.between({ from, to }).collect($));
    return e3.package('pressroom_by_key', '1.0.0', sheetsOn, jobsIn, sheetsBetween);
  },
});

export const recordReadIntervalIndex = example({
  keywords: ['e3', 'record', 'index', 'e3.index', 'reader', 'overlapping', 'unset', 'index.interval', 'window', 'time', 'backlog', 'function'],
  description: 'Read an interval index inside a function: `overlapping({ on?, from, to })` gives the rows that overlap a window of time `[from, to)`, those carried into it among them, each once, and `unset()` the rows with no start — the backlog',
  fn: () => {
    const JobType = StructType({ title: StringType, state: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
    const jobs = e3.record('jobs', DictType(StringType, JobType), {
      initial: new Map([
        ['j1', { title: 'Annual report', state: 'confirmed', start: some(new Date('2026-10-05T08:00:00Z')), end: some(new Date('2026-10-07T17:00:00Z')) }],
        ['j2', { title: 'Posters', state: 'proposed', start: some(new Date('2026-10-12T09:00:00Z')), end: some(new Date('2026-10-12T15:00:00Z')) }],
        ['j3', { title: 'Catalogue', state: 'proposed', start: none, end: none }],
      ]),
      indexes: (index) => ({
        in_time: index.interval({ from: 'start', to: 'end' }),
        in_time_by_state: index.interval({ on: ['state'], from: 'start', to: 'end' }),
      }),
    });
    // An interval index carries nothing: the read gives each row's key. An event that ends at `from` is outside;
    // an instant at `from` is inside, and one at `to` outside.
    const running = e3.function('running', { inputs: [e3.index(jobs.indexes.in_time)], args: [DateTimeType, DateTimeType], output: DictType(StringType, NullType) },
      ($, inTime, from, to) => inTime.overlapping({ from, to }).collect($));
    // An index led by fields takes each exactly, as `on`. More of a row than the index carries: the record beside it.
    const titlesRunning = e3.function('titles_running', {
      inputs: [e3.index(jobs.indexes.in_time_by_state), jobs], args: [StringType, DateTimeType, DateTimeType], output: DictType(StringType, StringType),
    }, ($, inTime, jobs, state, from, to) => {
      const titles = $.let(new Map(), DictType(StringType, StringType));
      inTime.overlapping({ on: { state }, from, to }).each($, ($, _carried, key) => { $(titles.insert(key, jobs.get(key).title)); });
      return titles;
    });
    const backlog = e3.function('backlog', { inputs: [e3.index(jobs.indexes.in_time)], args: [], output: DictType(StringType, NullType) },
      ($, inTime) => inTime.unset().collect($));
    return e3.package('pressroom_in_time', '1.0.0', running, titlesRunning, backlog);
  },
});

export const recordReadSeriesIndex = example({
  keywords: ['e3', 'record', 'index', 'e3.index', 'reader', 'events', 'index.series', 'window', 'resource', 'key', 'time', 'function', 'optimiser'],
  description: 'Read a series index inside a function: `events({ on?, key, from, to })` gives the events on a key — a Plan\'s resource — that overlap a window `[from, to)`, each with its row, whatever their lengths: an hour or a year',
  fn: () => {
    const JobType = StructType({ title: StringType, press: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), sheets: FloatType });
    const jobs = e3.record('jobs', DictType(StringType, JobType), {
      initial: new Map([
        ['j1', { title: 'Annual report', press: 'P1', start: some(new Date('2026-10-05T08:00:00Z')), end: some(new Date('2026-10-07T17:00:00Z')), sheets: 4000 }],
        ['j2', { title: 'Posters', press: 'P1', start: some(new Date('2026-10-12T09:00:00Z')), end: some(new Date('2026-10-12T15:00:00Z')), sheets: 900 }],
        ['j3', { title: 'Catalogue', press: 'P2', start: some(new Date('2026-09-01T00:00:00Z')), end: some(new Date('2026-12-01T00:00:00Z')), sheets: 120000 }],
      ]),
      indexes: (index) => ({ jobs_by_press_week: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }) }),
    });
    // The hours a press is booked for in a window, from its series index alone: the index carries each row.
    const hoursOnPress = e3.function('hours_on_press', {
      inputs: [e3.index(jobs.indexes.jobs_by_press_week)], args: [StringType, DateTimeType, DateTimeType], output: FloatType,
    }, ($, jobsByPress, press, from, to) => {
      const sheets = $.let(0.0);
      jobsByPress.events({ key: press, from, to }).each($, ($, job) => { $.assign(sheets, sheets.add(job.sheets)); });
      return sheets.divide(8000.0);
    });
    // The same rows as a Dict by the job's own key. They come in the index's order, a level at a time: sort what is
    // collected where time order matters.
    const jobsOnPress = e3.function('jobs_on_press_in', {
      inputs: [e3.index(jobs.indexes.jobs_by_press_week)], args: [StringType, DateTimeType, DateTimeType], output: DictType(StringType, JobType),
    }, ($, jobsByPress, press, from, to) => jobsByPress.events({ key: press, from, to }).collect($));
    return e3.package('pressroom_by_week', '1.0.0', hoursOnPress, jobsOnPress);
  },
});

export const recordReadSummaryIndex = example({
  keywords: ['e3', 'record', 'index', 'e3.index', 'reader', 'totals', 'index.summary', 'count', 'load', 'tile', 'week', 'function'],
  description: 'Read a summary index inside a function: `totals({ on?, key, from, to })` gives, for each tile of a key that overlaps a window, how many rows touch it and the milliseconds of it they cover, with the tile\'s start — a press\'s load a week, and no row read',
  fn: () => {
    const JobType = StructType({ press: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
    const jobs = e3.record('jobs', DictType(StringType, JobType), {
      initial: new Map([
        ['j1', { press: 'P1', start: some(new Date('2026-10-05T08:00:00Z')), end: some(new Date('2026-10-07T17:00:00Z')) }],
        ['j2', { press: 'P1', start: some(new Date('2026-10-12T09:00:00Z')), end: some(new Date('2026-10-12T15:00:00Z')) }],
      ]),
      indexes: (index) => ({ press_load: index.summary({ key: 'press', from: 'start', to: 'end', tile: 'week' }) }),
    });
    // The share of each week a press is booked for: the read gives a tile's totals, and the tile's start in place of a row's key.
    const WEEK_MS = 604_800_000.0;
    const bookedShare = e3.function('booked_share', {
      inputs: [e3.index(jobs.indexes.press_load)], args: [StringType, DateTimeType, DateTimeType], output: DictType(DateTimeType, FloatType),
    }, ($, pressLoad, press, from, to) => {
      const share = $.let(new Map(), DictType(DateTimeType, FloatType));
      pressLoad.totals({ key: press, from, to }).each($, ($, totals, week) => { $(share.insert(week, totals.ms.toFloat().divide(WEEK_MS))); });
      return share;
    });
    return e3.package('pressroom_load', '1.0.0', bookedShare);
  },
});

export const recordReadAreaIndex = example({
  keywords: ['e3', 'record', 'index', 'e3.index', 'reader', 'within', 'unplaced', 'index.area', 'window', 'box', 'floor', 'viewport', 'function'],
  description: 'Read an area index inside a function: `within({ on?, x, y, width, height })` gives the rows whose box meets a window of the plane, its edges included, each with its row, and `unplaced()` the rows with no place yet',
  fn: () => {
    const RackType = StructType({ name: StringType, x: OptionType(FloatType), y: OptionType(FloatType), w: FloatType, h: FloatType });
    const racks = e3.record('racks', DictType(StringType, RackType), {
      initial: new Map([
        ['r1', { name: 'A-01', x: some(2.0), y: some(1.5), w: 1.2, h: 0.8 }],
        ['r2', { name: 'A-02', x: some(9.0), y: some(1.5), w: 1.2, h: 0.8 }],
        ['r3', { name: 'B-01', x: none, y: none, w: 1.2, h: 0.8 }],
      ]),
      // A rack's box by its centre, in metres; the finest cell about the smallest thing drawn.
      indexes: (index) => ({ racks_by_area: index.area({ x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 }) }),
    });
    const namesWithin = e3.function('names_within', {
      inputs: [e3.index(racks.indexes.racks_by_area)], args: [FloatType, FloatType, FloatType, FloatType], output: DictType(StringType, StringType),
    }, ($, byArea, x, y, width, height) => {
      const names = $.let(new Map(), DictType(StringType, StringType));
      byArea.within({ x, y, width, height }).each($, ($, rack, key) => { $(names.insert(key, rack.name)); });
      return names;
    });
    const toPlace = e3.function('racks_to_place', { inputs: [e3.index(racks.indexes.racks_by_area)], args: [], output: IntegerType },
      ($, byArea) => byArea.unplaced().collect($).size());
    return e3.package('warehouse_floor', '1.0.0', namesWithin, toPlace);
  },
});

export const recordReadEntriesIndex = example({
  keywords: ['e3', 'record', 'index', 'e3.index', 'reader', 'of', 'index.entries', 'Dict field', 'entry', 'by category', 'function'],
  description: 'Read an entries index inside a function: `of(key)` gives a key\'s entry on every row that holds one — the value the row\'s Dict field holds under the key, and the row\'s key — without the rows, or any other key\'s entries',
  fn: () => {
    const StationType = StructType({ name: StringType, byService: DictType(StringType, IntegerType) });
    const stations = e3.record('stations', DictType(StringType, StationType), {
      initial: new Map([
        ['s1', { name: 'Harbour', byService: new Map([['express', 120n], ['freight', 40n]]) }],
        ['s2', { name: 'Airport', byService: new Map([['express', 300n]]) }],
      ]),
      indexes: (index) => ({ stations_by_service: index.entries('byService') }),
    });
    // A service's parcels at every station that handles it.
    const parcelsOf = e3.function('parcels_of', { inputs: [e3.index(stations.indexes.stations_by_service)], args: [StringType], output: IntegerType },
      ($, byService, service) => {
        const parcels = $.let(0n);
        byService.of(service).each($, ($, handled) => { $.assign(parcels, parcels.add(handled)); });
        return parcels;
      });
    return e3.package('network', '1.0.0', parcelsOf);
  },
});

export const recordReadNestedIndex = example({
  keywords: ['e3', 'record', 'index', 'e3.index', 'reader', 'items', 'totals', 'subtotals', 'subtree', 'subtreeTotals', 'index.nested', 'nested', 'tree', 'rollup', 'window', 'function'],
  description: 'Read a nested series index inside a function, one node of a row\'s tree at a time: `items` gives a node\'s own items or values that overlap a window, `subtree` the items of every node beneath it, `totals` and `subtreeTotals` their totals a summary tile, and `subtotals` a parent\'s subtotal of its children\'s values by a rollup',
  fn: () => {
    const JobType = StructType({ title: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType), sheets: FloatType });
    const UnitType = StructType({ name: StringType, jobs: DictType(StringType, JobType), load: DictType(DateTimeType, FloatType) });
    const LineType = StructType({ name: StringType, units: DictType(StringType, UnitType) });
    const lines = e3.record('lines', DictType(StringType, LineType), {
      initial: new Map([['l1', {
        name: 'Line 1',
        units: new Map([
          ['u1', {
            name: 'Feeder',
            jobs: new Map([['j1', { title: 'Annual report', start: some(new Date('2026-10-05T08:00:00Z')), end: some(new Date('2026-10-07T17:00:00Z')), sheets: 4000 }]]),
            load: new Map([[new Date('2026-10-05T00:00:00Z'), 0.6], [new Date('2026-10-06T00:00:00Z'), 0.8]]),
          }],
          ['u2', {
            name: 'Folder',
            jobs: new Map([['j2', { title: 'Posters', start: some(new Date('2026-10-06T09:00:00Z')), end: some(new Date('2026-10-06T15:00:00Z')), sheets: 900 }]]),
            load: new Map([[new Date('2026-10-05T00:00:00Z'), 0.3]]),
          }],
        ]),
      }]]),
      indexes: (index) => ({
        lines_in_time: index.nested({
          collections: {
            units: index.nested.rows({
              jobs: index.nested.items({ from: 'start', to: 'end' }, { rollup: true }),   // filed under the line too
              load: index.nested.values({ rollup: 'mean' }),                               // the line keeps its units' mean
            }),
          },
          tile: 'day',
          summary: 'month',
        }),
      }),
    });
    const inTime = e3.index(lines.indexes.lines_in_time);
    const Window = [StringType, StringType, DateTimeType, DateTimeType] as const;
    // A read names a node: its collection's place — the field names from the row down — the row's key, and the Dict
    // keys from the row down to the node. `items` gives a node's own items that overlap `[from, to)`, each with its id.
    const sheetsOnUnit = e3.function('sheets_on_unit', { inputs: [inTime], args: [...Window], output: FloatType },
      ($, linesInTime, line, unit, from, to) => {
        const sheets = $.let(0.0);
        linesInTime.items({ collection: ['units', 'jobs'], row: line, path: [unit], from, to }).each($, ($, job) => { $.assign(sheets, sheets.add(job.sheets)); });
        return sheets;
      });
    // A collection of values is read the same way: each value in the window, with its instant.
    const loadOfUnit = e3.function('load_of_unit', { inputs: [inTime], args: [...Window], output: DictType(DateTimeType, FloatType) },
      ($, linesInTime, line, unit, from, to) => linesInTime.items({ collection: ['units', 'load'], row: line, path: [unit], from, to }).collect($));
    // `subtree`: the items of every node beneath a node — here the line itself, its path left out — each with the keys
    // from the node down to the one holding it, and its id. The collection declares `rollup: true`.
    const jobsOnLine = e3.function('jobs_on_line', { inputs: [inTime], args: [StringType, DateTimeType, DateTimeType], output: IntegerType },
      ($, linesInTime, line, from, to) => linesInTime.subtree({ collection: ['units', 'jobs'], row: line, from, to }).collect($).size());
    // `totals`: a node's totals a summary tile — how many, and for numbers their sum, least, greatest and latest — and
    // the tile's start. The index declares `summary`.
    const peakLoad = e3.function('peak_load_a_month', { inputs: [inTime], args: [...Window], output: DictType(DateTimeType, FloatType) },
      ($, linesInTime, line, unit, from, to) => {
        const peaks = $.let(new Map(), DictType(DateTimeType, FloatType));
        linesInTime.totals({ collection: ['units', 'load'], row: line, path: [unit], from, to }).each($, ($, totals, month) => {
          $.match(totals.values, { some: ($, values) => { $(peaks.insert(month, values.max)); } });
        });
        return peaks;
      });
    // `subtotals`: a parent's subtotal of its children's values a tile, by a rollup the collection declares, at the
    // index's tile or a coarser `level`.
    const lineLoad = e3.function('line_load', { inputs: [inTime], args: [StringType, DateTimeType, DateTimeType], output: DictType(DateTimeType, FloatType) },
      ($, linesInTime, line, from, to) => linesInTime.subtotals({ collection: ['units', 'load'], row: line, rollup: 'mean', from, to }).collect($));
    return e3.package('pressroom_lines', '1.0.0', sheetsOnUnit, loadOfUnit, jobsOnLine, peakLoad, lineLoad);
  },
});

export const recordReadIndexInTask = example({
  keywords: ['e3', 'record', 'index', 'e3.index', 'reader', 'read', 'task', 'East.function', 'entries'],
  description: 'Read an index with its kind\'s readers inside a task: a task\'s body is its own East function, so `e3.index(def).read(entries)` gives its parameter the readers a function\'s and a stream task\'s parameter arrives with',
  fn: () => {
    const JobType = StructType({ press: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
    const jobs = e3.record('jobs', DictType(StringType, JobType), {
      initial: new Map([['j1', { press: 'P1', start: some(new Date('2026-10-05T08:00:00Z')), end: some(new Date('2026-10-07T17:00:00Z')) }]]),
      indexes: (index) => ({ jobs_by_press_week: index.series({ key: 'press', from: 'start', to: 'end', tile: 'week' }) }),
    });
    const WindowType = StructType({ press: StringType, from: DateTimeType, to: DateTimeType });
    const watched = e3.input('watched', WindowType, variant('value', { press: 'P1', from: new Date('2026-10-05T00:00:00Z'), to: new Date('2026-10-12T00:00:00Z') }));
    const byPress = e3.index(jobs.indexes.jobs_by_press_week);
    const jobsInWindow = e3.task('jobs_in_window', [byPress, watched],
      East.function([byPress.type, WindowType], IntegerType, ($, entries, window) => {
        const count = $.let(0n);
        byPress.read(entries).events({ key: window.press, from: window.from, to: window.to }).each($, ($) => { $.assign(count, count.add(1n)); });
        return count;
      }));
    return e3.package('pressroom_watch', '1.0.0', jobsInWindow);
  },
});
