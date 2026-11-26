/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * A Plan of grouped rows at scale (#1710): a print works' halls — the rows, a
 * record of their own — nesting rows beside groups at every level: the halls
 * as rows beside the halls as groups, each hall its folders and its bays beside
 * its lines, each line its guillotine beside its presses, each press its
 * tasks. And five records of events on them over three years, sparse and
 * spread evenly over them, each event a row of its own, never a collection
 * inside a hall: the halls' inspections, the folders' runs, the paper delivered
 * to the bays, the presses' print jobs and the guillotines' trims. Each is read
 * a cell at a time through its own series index — the inspections' in their
 * halls' order, the others' in time order led by the rows they stand under: a
 * week's events together under their hall, or their hall and line, in their
 * rows' order, so a block of rows in view is one range a tile. Each shades
 * zoomed out from the summary whose tile fits the zoom — a day's, a month's, a
 * quarter's or a year's. And the Plan over them:
 *
 * - `planSeriesAll`, the halls read a hall at a time, rows beside groups at
 *   every level, and every way an event kind draws: chips, bars, tiles and
 *   marks.
 *
 * @packageDocumentation
 */

import { ArrayType, DateTimeType, DictType, East, IntegerType, StringType, StructType, example, variant } from "@elaraai/east";
import { Box, EventStateType, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// The halls — the rows: each hall's folders and bays beside its lines, each line's guillotine beside its presses
// ============================================================================

/** How many halls the rows hold. */
const SERIES_HALLS = 8n;
/** How many lines each hall holds, in turn: halls of four sizes, so a hall fills part of a view or many views. */
const SERIES_HALL_LINES = [1n, 4n, 2n, 3n];
/** How many presses each line holds. */
const SERIES_LINE_PRESSES = 10n;
/** How many folders each hall holds, and how many bays. */
const SERIES_HALL_FOLDERS = 2n;
const SERIES_HALL_BAYS = 2n;
/** The tasks every press takes, in order. */
const SERIES_TASKS = ["Make-ready", "Print", "Finish"];
/** What the works prints, in turn. */
const SERIES_TITLES = ["Brochures", "Catalogues", "Leaflets", "Posters", "Manuals", "Labels", "Calendars"];
/** Monday 5 October 2026, where the events' first week starts. */
const SERIES_START = new Date("2026-10-05T00:00:00Z");
/** How many weeks the events run over: three years', to October 2029. */
const SERIES_WEEKS = 156n;

/** Hall `h`'s key: `H-` and its number plus 101. */
export const seriesHallKey = East.function([IntegerType], StringType, (_$, h) => East.str`H-${h.add(101n)}`);
/** Line `l` of hall `h`'s key: its hall's number and its own. */
export const seriesLineKey = East.function([IntegerType, IntegerType], StringType, (_$, h, l) => East.str`L-${h.add(101n)}-${l.add(1n)}`);
/** Press `p` of hall `h`'s key: its hall's number and its own — fixed width, so the presses' keys hold their order. */
export const seriesPressKey = East.function([IntegerType, IntegerType], StringType, (_$, h, p) => East.str`P-${h.add(101n)}-${p.add(1001n)}`);
/** The guillotine of line `l` of hall `h`'s key. */
export const seriesGuillotineKey = East.function([IntegerType, IntegerType], StringType, (_$, h, l) => East.str`G-${h.add(101n)}-${l.add(1n)}`);
/** Folder `f` of hall `h`'s key. */
export const seriesFolderKey = East.function([IntegerType, IntegerType], StringType, (_$, h, f) => East.str`F-${h.add(101n)}-${f.add(1n)}`);
/** Bay `b` of hall `h`'s key. */
export const seriesBayKey = East.function([IntegerType, IntegerType], StringType, (_$, h, b) => East.str`B-${h.add(101n)}-${b.add(1n)}`);

/** A task a press takes: a row beneath the press its jobs land on. */
export const SeriesTask = StructType({ name: StringType });
/** A press of a line: its name, and its tasks by key. */
export const SeriesPress = StructType({ name: StringType, tasks: DictType(StringType, SeriesTask) });
/** A line's guillotine, where its trims land. */
export const SeriesGuillotine = StructType({ name: StringType });
/** A line of a hall: its name, its guillotine and its presses, each by key. */
export const SeriesLine = StructType({ name: StringType, guillotines: DictType(StringType, SeriesGuillotine), presses: DictType(StringType, SeriesPress) });
/** A hall's folder, where its folding runs land. */
export const SeriesFolder = StructType({ name: StringType });
/** A hall's loading bay, where its paper is delivered. */
export const SeriesBay = StructType({ name: StringType });
/** A hall: its name, its folders, its bays and its lines, each by key. */
export const SeriesHall = StructType({
    name: StringType, folders: DictType(StringType, SeriesFolder), bays: DictType(StringType, SeriesBay), lines: DictType(StringType, SeriesLine),
});
/** The halls, by key. */
export const SeriesHalls = DictType(StringType, SeriesHall);

/**
 * `halls` halls, each with its two folders, its two bays and
 * {@link SERIES_HALL_LINES} lines in turn, each line a guillotine and
 * {@link SERIES_LINE_PRESSES} presses numbered on through its hall, each press
 * taking the three tasks, keyed `T1` to `T3`. A function of the count alone.
 */
export const generateSeriesHalls = East.function([IntegerType], SeriesHalls, ($, halls) => {
    const lines = $.const(SERIES_HALL_LINES, ArrayType(IntegerType));
    const tasks = $.const(SERIES_TASKS, ArrayType(StringType));
    const hallKey = $.const(seriesHallKey);
    const lineKey = $.const(seriesLineKey);
    const pressKey = $.const(seriesPressKey);
    const guillotineKey = $.const(seriesGuillotineKey);
    const folderKey = $.const(seriesFolderKey);
    const bayKey = $.const(seriesBayKey);
    return East.Array.range(0n, halls).toDict(
        (_$2, h) => hallKey(h),
        (_$2, h) => ({
            name: East.str`Hall ${h.add(1n)}`,
            folders: East.Array.range(0n, SERIES_HALL_FOLDERS).toDict((_$3, f) => folderKey(h, f), (_$3, f) => ({ name: East.str`Folder ${h.add(1n)}.${f.add(1n)}` })),
            bays: East.Array.range(0n, SERIES_HALL_BAYS).toDict((_$3, b) => bayKey(h, b), (_$3, b) => ({ name: East.str`Bay ${h.add(1n)}.${b.add(1n)}` })),
            lines: East.Array.range(0n, lines.get(h.remainder(4n))).toDict(
                (_$3, l) => lineKey(h, l),
                (_$3, l) => ({
                    name: East.str`Line ${h.add(1n)}.${l.add(1n)}`,
                    guillotines: East.Array.range(0n, 1n).toDict((_$4, _g) => guillotineKey(h, l), (_$4, _g) => ({ name: East.str`Guillotine ${h.add(1n)}.${l.add(1n)}` })),
                    presses: East.Array.range(l.multiply(SERIES_LINE_PRESSES), l.add(1n).multiply(SERIES_LINE_PRESSES)).toDict(
                        (_$4, p) => pressKey(h, p),
                        (_$4, p) => ({
                            name: East.str`Press ${h.add(1n)}.${p.add(1n)}`,
                            tasks: East.Array.range(0n, 3n).toDict((_$5, t) => East.str`T${t.add(1n)}`, (_$5, t) => ({ name: tasks.get(t) })),
                        }),
                    ),
                }),
            ),
        }),
    );
});

/**
 * Eight halls: 16 folders, 16 bays, 20 lines, 20 guillotines and 200 presses,
 * 600 task rows beneath them — read a hall at a time, never whole.
 */
export const planSeriesHalls = e3.record("plan_series_halls", SeriesHalls, {
    initial: () => East.compile(generateSeriesHalls, [])(SERIES_HALLS),
    indexes: (index) => ({
        // The halls by name: the rail's order, and what it narrows them by.
        plan_series_halls_by_name: index.on(["name"]),
    }),
});

/** Where a press's events are generated: its hall's key, its line's and its own, and their numbers. */
export const SeriesPlace = StructType({ hall: StringType, line: StringType, press: StringType, h: IntegerType, p: IntegerType });

/** Every press of `halls` halls {@link generateSeriesHalls} makes, in their order: where the print jobs are generated over. */
export const generateSeriesPlaces = East.function([IntegerType], ArrayType(SeriesPlace), ($, halls) => {
    const lines = $.const(SERIES_HALL_LINES, ArrayType(IntegerType));
    const hallKey = $.const(seriesHallKey);
    const lineKey = $.const(seriesLineKey);
    const pressKey = $.const(seriesPressKey);
    const places = $.let([], ArrayType(SeriesPlace));
    $.for(East.Array.range(0n, halls), ($2, h) => {
        $2.for(East.Array.range(0n, lines.get(h.remainder(4n))), ($3, l) => {
            $3.for(East.Array.range(l.multiply(SERIES_LINE_PRESSES), l.add(1n).multiply(SERIES_LINE_PRESSES)), ($4, p) => {
                $4(places.pushLast({ hall: hallKey(h), line: lineKey(h, l), press: pressKey(h, p), h, p }));
            });
        });
    });
    return places;
});

// ============================================================================
// The events — five records over three years, one row an event, each filed under the rows it stands under
// ============================================================================

/** A hall's inspection, a whole day: the hall, what it is, when, and its state. */
export const SeriesInspection = StructType({ hall: StringType, title: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType });
/** A folding run on a hall's folder: the hall it stands in — what its series index files it by first — the folder, what it folds, when, and its state. */
export const SeriesFolding = StructType({
    hall: StringType, folder: StringType, title: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** Paper delivered to a hall's bay, at an instant: the hall, the bay, what it is for, and when. */
export const SeriesDelivery = StructType({ hall: StringType, bay: StringType, title: StringType, at: DateTimeType });
/**
 * A print job on a press's task: the hall and the line its press stands in, by
 * their keys — what its series index files it by first — the press, the task
 * row beneath it, what it prints, when it runs, and its state.
 */
export const SeriesJob = StructType({
    hall: StringType, line: StringType, press: StringType, task: StringType, title: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** A trim on a line's guillotine, at an instant: its hall and line, the guillotine, what it trims, and when. */
export const SeriesTrim = StructType({ hall: StringType, line: StringType, guillotine: StringType, title: StringType, at: DateTimeType });

/**
 * Each hall's inspections over a number of weeks from Monday 5 October 2026: a
 * whole day every thirteen weeks, from the hall's own week of the first
 * thirteen, a fire inspection and a safety audit in turn; those of the first
 * two weeks have run.
 */
export const generateSeriesInspections = East.function([IntegerType, IntegerType], DictType(StringType, SeriesInspection), ($, halls, weeks) => {
    const start = $.const(SERIES_START);
    const hallKey = $.const(seriesHallKey);
    const actual = $.const(variant("actual", null), EventStateType);
    const confirmed = $.const(variant("confirmed", null), EventStateType);
    const inspections = $.let(new Map(), DictType(StringType, SeriesInspection));
    $.for(East.Array.range(0n, halls), ($2, h) => {
        const hall = $2.const(hallKey(h));
        const first = $2.const(h.remainder(13n));
        $2.for(East.Array.range(0n, weeks.subtract(first).add(12n).divide(13n)), ($3, i) => {
            const w = $3.const(first.add(i.multiply(13n)));
            const day = $3.const(start.addWeeks(w).addDays(h.remainder(5n)));
            const title = $3.const(i.remainder(2n).equal(0n).ifElse(() => "Fire inspection", () => "Safety audit"));
            const state = $3.const(w.less(2n).ifElse(() => actual, () => confirmed));
            $3(inspections.insert(East.str`${hall}-I${i.add(1n)}`, { hall, title, start: day, end: day.addDays(1n), state }));
        });
    });
    return inspections;
});

/**
 * Each folder's runs over a number of weeks: six hours every other week, the
 * hall's two folders in turn, each on its own weekday from 07:00; those of the
 * first two weeks have run.
 */
export const generateSeriesFolding = East.function([IntegerType, IntegerType], DictType(StringType, SeriesFolding), ($, halls, weeks) => {
    const start = $.const(SERIES_START);
    const titles = $.const(SERIES_TITLES, ArrayType(StringType));
    const hallKey = $.const(seriesHallKey);
    const folderKey = $.const(seriesFolderKey);
    const actual = $.const(variant("actual", null), EventStateType);
    const confirmed = $.const(variant("confirmed", null), EventStateType);
    const runs = $.let(new Map(), DictType(StringType, SeriesFolding));
    $.for(East.Array.range(0n, halls), ($2, h) => {
        const hall = $2.const(hallKey(h));
        $2.for(East.Array.range(0n, SERIES_HALL_FOLDERS), ($3, f) => {
            const folder = $3.const(folderKey(h, f));
            $3.for(East.Array.range(0n, weeks.divide(2n)), ($4, i) => {
                const w = $4.const(i.multiply(2n).add(f));
                const begins = $4.const(start.addWeeks(w).addDays(h.add(f).remainder(5n)).addHours(7n));
                const state = $4.const(w.less(2n).ifElse(() => actual, () => confirmed));
                $4(runs.insert(East.str`${folder}-R${i.add(1n)}`, {
                    hall, folder, title: East.str`Fold: ${titles.get(h.add(i).remainder(7n))}`, start: begins, end: begins.addHours(6n), state,
                }));
            });
        });
    });
    return runs;
});

/** The paper delivered to each bay over a number of weeks: every other week, the hall's two bays in turn, each on its own weekday at 09:00. */
export const generateSeriesDeliveries = East.function([IntegerType, IntegerType], DictType(StringType, SeriesDelivery), ($, halls, weeks) => {
    const start = $.const(SERIES_START);
    const titles = $.const(SERIES_TITLES, ArrayType(StringType));
    const hallKey = $.const(seriesHallKey);
    const bayKey = $.const(seriesBayKey);
    const deliveries = $.let(new Map(), DictType(StringType, SeriesDelivery));
    $.for(East.Array.range(0n, halls), ($2, h) => {
        const hall = $2.const(hallKey(h));
        $2.for(East.Array.range(0n, SERIES_HALL_BAYS), ($3, b) => {
            const bay = $3.const(bayKey(h, b));
            $3.for(East.Array.range(0n, weeks.divide(2n)), ($4, i) => {
                const w = $4.const(i.multiply(2n).add(b));
                const at = $4.const(start.addWeeks(w).addDays(h.add(b.multiply(2n)).remainder(5n)).addHours(9n));
                $4(deliveries.insert(East.str`${bay}-D${i.add(1n)}`, { hall, bay, title: East.str`Paper for ${titles.get(h.add(i).remainder(7n))}`, at }));
            });
        });
    });
    return deliveries;
});

/**
 * Each press's jobs over a number of weeks: one every ten weeks, from the
 * press's own week of the first ten — a make-ready of two hours, a run of a day
 * and a half and three hours' finishing, one on each of its tasks — each press
 * starting at its own hour into its week, so no two presses' jobs line up;
 * those of the first two weeks have run.
 */
export const generateSeriesJobs = East.function([IntegerType, IntegerType], DictType(StringType, SeriesJob), ($, halls, weeks) => {
    const places = $.const(generateSeriesPlaces);
    const start = $.const(SERIES_START);
    const titles = $.const(SERIES_TITLES, ArrayType(StringType));
    const actual = $.const(variant("actual", null), EventStateType);
    const confirmed = $.const(variant("confirmed", null), EventStateType);
    const jobs = $.let(new Map(), DictType(StringType, SeriesJob));
    $.for(places(halls), ($2, at) => {
        const hall = $2.const(at.hall);
        const line = $2.const(at.line);
        const press = $2.const(at.press);
        // Its own hour into its week: up to two days in.
        const offset = $2.const(at.h.multiply(5n).add(at.p).remainder(48n));
        const first = $2.const(at.p.remainder(10n));
        $2.for(East.Array.range(0n, weeks.divide(10n)), ($3, i) => {
            const w = $3.const(first.add(i.multiply(10n)));
            const ready = $3.const(start.addWeeks(w).addHours(offset.add(6n)));
            const run = $3.const(ready.addHours(2n));
            const finish = $3.const(run.addHours(36n));
            const title = $3.const(titles.get(at.p.add(i).remainder(7n)));
            const state = $3.const(w.less(2n).ifElse(() => actual, () => confirmed));
            const key = $3.const(East.str`${press}-J${i.add(1n)}`);
            $3(jobs.insert(East.str`${key}-T1`, { hall, line, press, task: "T1", title: East.str`${title}: make-ready`, start: ready, end: run, state }));
            $3(jobs.insert(East.str`${key}-T2`, { hall, line, press, task: "T2", title, start: run, end: finish, state }));
            $3(jobs.insert(East.str`${key}-T3`, { hall, line, press, task: "T3", title: East.str`${title}: finishing`, start: finish, end: finish.addHours(3n), state }));
        });
    });
    return jobs;
});

/** Each guillotine's trims over a number of weeks: every other week, odd lines' a week after even lines', each on its own weekday at 14:00. */
export const generateSeriesTrims = East.function([IntegerType, IntegerType], DictType(StringType, SeriesTrim), ($, halls, weeks) => {
    const lines = $.const(SERIES_HALL_LINES, ArrayType(IntegerType));
    const start = $.const(SERIES_START);
    const titles = $.const(SERIES_TITLES, ArrayType(StringType));
    const hallKey = $.const(seriesHallKey);
    const lineKey = $.const(seriesLineKey);
    const guillotineKey = $.const(seriesGuillotineKey);
    const trims = $.let(new Map(), DictType(StringType, SeriesTrim));
    $.for(East.Array.range(0n, halls), ($2, h) => {
        const hall = $2.const(hallKey(h));
        $2.for(East.Array.range(0n, lines.get(h.remainder(4n))), ($3, l) => {
            const line = $3.const(lineKey(h, l));
            const guillotine = $3.const(guillotineKey(h, l));
            $3.for(East.Array.range(0n, weeks.divide(2n)), ($4, i) => {
                const w = $4.const(i.multiply(2n).add(l.remainder(2n)));
                const at = $4.const(start.addWeeks(w).addDays(h.add(l).remainder(5n)).addHours(14n));
                $4(trims.insert(East.str`${guillotine}-C${i.add(1n)}`, { hall, line, guillotine, title: East.str`Trim: ${titles.get(h.add(l).add(i).remainder(7n))}`, at }));
            });
        });
    });
    return trims;
});

/** The halls' inspections, 96 of them by key: read through a series index in their halls' order, as rows of their own at the top. */
export const planSeriesInspections = e3.record("plan_series_inspections", DictType(StringType, SeriesInspection), {
    initial: () => East.compile(generateSeriesInspections, [])(SERIES_HALLS, SERIES_WEEKS),
    indexes: (index) => ({
        // The inspections over their interval index: the window the rail reads and its exact count.
        plan_series_inspections_by_time: index.interval({ from: "start", to: "end" }),
        // A hall's inspections together, a week at a time: the halls are rows under no other, so in their keys' order.
        plan_series_inspections_by_hall_week: index.flatSeries({ key: "hall", from: "start", to: "end", tile: "week" }),
        // How busy each hall is, a day, a month, a quarter and a year at a time: what the Plan shades from, zoomed out past
        // what it draws, at the tile that fits the zoom.
        plan_series_inspections_by_hall_day: index.summary({ key: "hall", from: "start", to: "end", tile: "day" }),
        plan_series_inspections_by_hall_month: index.summary({ key: "hall", from: "start", to: "end", tile: "month" }),
        plan_series_inspections_by_hall_quarter: index.summary({ key: "hall", from: "start", to: "end", tile: "quarter" }),
        plan_series_inspections_by_hall_year: index.summary({ key: "hall", from: "start", to: "end", tile: "year" }),
        // The record's totals a month, a quarter and a year (#1732): how many of its events touch each, under no key — what
        // the horizon's bars read at the tile that fits the strip, never counting events.
        plan_series_inspections_month_totals: index.totals({ from: "start", to: "end", tile: "month" }),
        plan_series_inspections_quarter_totals: index.totals({ from: "start", to: "end", tile: "quarter" }),
        plan_series_inspections_year_totals: index.totals({ from: "start", to: "end", tile: "year" }),
    }),
    mutations: (mutation) => ({
        // The inspections' patch door: every Save commits through it.
        patch: mutation.patch(),
    }),
});

/** The folders' runs, 1,248 of them by key: a week's together under their hall, in their folders' order. */
export const planSeriesFolding = e3.record("plan_series_folding", DictType(StringType, SeriesFolding), {
    initial: () => East.compile(generateSeriesFolding, [])(SERIES_HALLS, SERIES_WEEKS),
    indexes: (index) => ({
        plan_series_folding_by_time: index.interval({ from: "start", to: "end" }),
        // A week's runs together under their hall, in their folders' order (#1710): a hall's folders in view are one range a tile.
        plan_series_folding_by_hall_week: index.flatSeries({ on: ["hall"], key: "folder", from: "start", to: "end", tile: "week", order: "time" }),
        plan_series_folding_by_folder_day: index.summary({ key: "folder", from: "start", to: "end", tile: "day" }),
        plan_series_folding_by_folder_month: index.summary({ key: "folder", from: "start", to: "end", tile: "month" }),
        plan_series_folding_by_folder_quarter: index.summary({ key: "folder", from: "start", to: "end", tile: "quarter" }),
        plan_series_folding_by_folder_year: index.summary({ key: "folder", from: "start", to: "end", tile: "year" }),
        plan_series_folding_month_totals: index.totals({ from: "start", to: "end", tile: "month" }),
        plan_series_folding_quarter_totals: index.totals({ from: "start", to: "end", tile: "quarter" }),
        plan_series_folding_year_totals: index.totals({ from: "start", to: "end", tile: "year" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The paper delivered to the bays, 1,248 deliveries by key, each at an instant: filed from its instant to the same. */
export const planSeriesDeliveries = e3.record("plan_series_deliveries", DictType(StringType, SeriesDelivery), {
    initial: () => East.compile(generateSeriesDeliveries, [])(SERIES_HALLS, SERIES_WEEKS),
    indexes: (index) => ({
        plan_series_deliveries_by_time: index.interval({ from: "at", to: "at" }),
        plan_series_deliveries_by_hall_week: index.flatSeries({ on: ["hall"], key: "bay", from: "at", to: "at", tile: "week", order: "time" }),
        plan_series_deliveries_by_bay_day: index.summary({ key: "bay", from: "at", to: "at", tile: "day" }),
        plan_series_deliveries_by_bay_month: index.summary({ key: "bay", from: "at", to: "at", tile: "month" }),
        plan_series_deliveries_by_bay_quarter: index.summary({ key: "bay", from: "at", to: "at", tile: "quarter" }),
        plan_series_deliveries_by_bay_year: index.summary({ key: "bay", from: "at", to: "at", tile: "year" }),
        plan_series_deliveries_month_totals: index.totals({ from: "at", to: "at", tile: "month" }),
        plan_series_deliveries_quarter_totals: index.totals({ from: "at", to: "at", tile: "quarter" }),
        plan_series_deliveries_year_totals: index.totals({ from: "at", to: "at", tile: "year" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The print jobs, 9,000 of them by key: a week's together under their hall and line, in their presses' order. */
export const planSeriesJobs = e3.record("plan_series_jobs", DictType(StringType, SeriesJob), {
    initial: () => East.compile(generateSeriesJobs, [])(SERIES_HALLS, SERIES_WEEKS),
    indexes: (index) => ({
        plan_series_jobs_by_time: index.interval({ from: "start", to: "end" }),
        // A week's jobs together under their hall and line, in their presses' order (#1710): a block of a line's presses
        // in view is one range a tile, from its first press through its last, whatever the presses' histories.
        plan_series_jobs_by_line_week: index.flatSeries({ on: ["hall", "line"], key: "press", from: "start", to: "end", tile: "week", order: "time" }),
        // How busy each press's task is — the row beneath the press a job lands on — led by the task: zoomed out, each task
        // row counts its own jobs. A summary by the press alone counts every task beneath it alike, and shades none of them.
        plan_series_jobs_by_task_day: index.summary({ on: ["task"], key: "press", from: "start", to: "end", tile: "day" }),
        plan_series_jobs_by_task_month: index.summary({ on: ["task"], key: "press", from: "start", to: "end", tile: "month" }),
        plan_series_jobs_by_task_quarter: index.summary({ on: ["task"], key: "press", from: "start", to: "end", tile: "quarter" }),
        plan_series_jobs_by_task_year: index.summary({ on: ["task"], key: "press", from: "start", to: "end", tile: "year" }),
        plan_series_jobs_month_totals: index.totals({ from: "start", to: "end", tile: "month" }),
        plan_series_jobs_quarter_totals: index.totals({ from: "start", to: "end", tile: "quarter" }),
        plan_series_jobs_year_totals: index.totals({ from: "start", to: "end", tile: "year" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The guillotines' trims, 1,560 of them by key, each at an instant: a week's together under their hall and line. */
export const planSeriesTrims = e3.record("plan_series_trims", DictType(StringType, SeriesTrim), {
    initial: () => East.compile(generateSeriesTrims, [])(SERIES_HALLS, SERIES_WEEKS),
    indexes: (index) => ({
        plan_series_trims_by_time: index.interval({ from: "at", to: "at" }),
        plan_series_trims_by_line_week: index.flatSeries({ on: ["hall", "line"], key: "guillotine", from: "at", to: "at", tile: "week", order: "time" }),
        plan_series_trims_by_guillotine_day: index.summary({ key: "guillotine", from: "at", to: "at", tile: "day" }),
        plan_series_trims_by_guillotine_month: index.summary({ key: "guillotine", from: "at", to: "at", tile: "month" }),
        plan_series_trims_by_guillotine_quarter: index.summary({ key: "guillotine", from: "at", to: "at", tile: "quarter" }),
        plan_series_trims_by_guillotine_year: index.summary({ key: "guillotine", from: "at", to: "at", tile: "year" }),
        plan_series_trims_month_totals: index.totals({ from: "at", to: "at", tile: "month" }),
        plan_series_trims_quarter_totals: index.totals({ from: "at", to: "at", tile: "quarter" }),
        plan_series_trims_year_totals: index.totals({ from: "at", to: "at", tile: "year" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

// ============================================================================
// planSeriesAll — the halls a hall at a time, rows beside groups at every level, every way an event kind draws
// ============================================================================

/**
 * A Plan of grouped rows at scale (#1710), rows beside groups at every level:
 * at the top, the eight halls as rows — where their inspections land — beside
 * the halls as groups; in each hall, its folders and its bays beside its
 * lines; in each line, its guillotine beside its presses, each press its three
 * task rows — 200 presses in all, read a hall at a time
 * (`paging={{ entries: 1 }}`). Three years of events, sparse, each kind a
 * record of its own read a cell at a time through its own series index, and
 * every way an event kind draws, one at each level: the halls' inspections as
 * chips, the folders' runs as bars, the bays' paper deliveries as tiles in the
 * bucket cells their instants fall in, the presses' print jobs as bars on
 * their task rows, and the guillotines' trims as marks. No kind names the rows
 * its resource stands under: the Plan fills each series index's leading fields
 * with the keys of the hall, or the hall and the line, the rows in view stand
 * under, so a block of rows is one range a tile; a drop under other rows
 * writes them. Zoomed out past what it draws, a kind shades each row from the
 * summary whose tile fits the zoom: a day's, a month's, a quarter's or a
 * year's — the print jobs' task rows each from a summary led by the task and
 * keyed by the press (`index.summary({ on: ["task"], key: "press", … })`), each
 * its own jobs counted. The library's Series tab switches each series and each kind on and
 * off; one event is read by its key through its record's own entries, and
 * Save commits through each record's patch door. The horizon's bars are each
 * kind's totals a month, a quarter or a year (#1732): summaries with no key,
 * which each binding lists apart from its indexes, in `totals`.
 */
export const planSeriesAll = example({
    keywords: [
        "Plan", "Plan.series.group", "Plan.series.resources", "Plan.children", "step-downs", "several step-downs", "mixed nesting",
        "rows beside groups", "nested groups", "Schedule.events", "child", "resource", "draw", "span", "bars", "cards", "chips", "buckets",
        "tiles", "marks", "instant", "at", "groups", "halls", "lines", "presses", "tasks", "folders", "bays", "guillotines", "grouped rows",
        "paging", "entries", "Slice", "Slice.bindRecords", "rows source", "Data.bindPaged", "paged", "index.flatSeries", "series index", "order",
        "time order", "order: 'time'", "on", "leading fields", "key order", "index.interval", "index.summary", "summary tiles",
        "level of detail", "zoom", "cell", "range a tile", "large record", "scale", "sparse", "three years", "shading", "child rows counted",
        "summary led by the child's field", "Plan.library.series",
        "Series tab", "Record.bind", "entries", "Save", "horizon", "totals", "summary with no key", "#1710", "#1732",
    ],
    description: "A Plan of grouped rows at scale with rows beside groups at every level — at the top, eight halls as rows beside the halls as groups (Plan.series.group); in each hall its folders and bays beside its lines, and in each line its guillotine beside its presses, each press its three task rows (children: [Plan.children(…), …], several step-downs in order) — 200 presses read a hall at a time (paging={{ entries: 1 }}), and three years of sparse events, one kind of a record of its own at each level read a cell at a time through its own series index: the halls' inspections as chips (draw: \"cards\", an index in the halls' order), the folders' runs as bars and the bays' paper deliveries as tiles (draw: \"buckets\", at instants) through indexes in time order led by the hall, the presses' print jobs as bars on their task rows by `child` and the guillotines' trims as marks through indexes led by the hall and the line (index.flatSeries({ on: [\"hall\", \"line\"], …, order: \"time\" })); the Plan fills those fields from the rows in view, a drop under other rows writing them, and zoomed out each kind shades from the summary whose tile fits the zoom — a day's, a month's, a quarter's or a year's; the jobs' task rows each count their own from summaries led by the task and keyed by the press (index.summary({ on: [\"task\"], key: \"press\", … })) — each series and kind switched on and off from the Series tab, one event by its key through its record's own entries, and Save through each patch door; the horizon's bars are each kind's totals a month, a quarter or a year — summaries with no key, listed apart in each binding's totals — never events counted",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const inspections = $.let(Record.bind(planSeriesInspections));
            const folding = $.let(Record.bind(planSeriesFolding));
            const deliveries = $.let(Record.bind(planSeriesDeliveries));
            const jobs = $.let(Record.bind(planSeriesJobs));
            const trims = $.let(Record.bind(planSeriesTrims));
            // Each kind's entries: what reads one event by its key.
            const inspectionEntries = $.let(Data.bindPaged(planSeriesInspections));
            const foldingEntries = $.let(Data.bindPaged(planSeriesFolding));
            const deliveryEntries = $.let(Data.bindPaged(planSeriesDeliveries));
            const jobEntries = $.let(Data.bindPaged(planSeriesJobs));
            const trimEntries = $.let(Data.bindPaged(planSeriesTrims));
            // One rail: its `rows` source pages the halls by name; each kind's source lists its record's interval index,
            // its series index and its summaries — the Plan reads the kind's cells through them — and, apart, its totals a month,
            // a quarter and a year, which the horizon's bars read.
            const slice = $.let(Slice.bindRecords("ex.planSeriesAll", {
                rows: {
                    source: Data.bindPaged(planSeriesHalls, { indexes: ["plan_series_halls_by_name"] }),
                    label: "Halls", icon: { prefix: "fas", name: "warehouse" },
                    fields: { name: { label: "Hall", hints: ["Hall 1", "Hall 2", "Hall 3", "Hall 4", "Hall 5", "Hall 6", "Hall 7", "Hall 8"] } },
                },
                inspection: {
                    source: Data.bindPaged(planSeriesInspections, {
                        indexes: ["plan_series_inspections_by_time", "plan_series_inspections_by_hall_week", "plan_series_inspections_by_hall_day",
                            "plan_series_inspections_by_hall_month", "plan_series_inspections_by_hall_quarter", "plan_series_inspections_by_hall_year"],
                        totals: ["plan_series_inspections_month_totals", "plan_series_inspections_quarter_totals", "plan_series_inspections_year_totals"],
                    }),
                    label: "Inspections", icon: { prefix: "fas", name: "clipboard-check" }, fields: { start: { label: "Dates" } }, range: "start",
                },
                folding: {
                    source: Data.bindPaged(planSeriesFolding, {
                        indexes: ["plan_series_folding_by_time", "plan_series_folding_by_hall_week", "plan_series_folding_by_folder_day",
                            "plan_series_folding_by_folder_month", "plan_series_folding_by_folder_quarter", "plan_series_folding_by_folder_year"],
                        totals: ["plan_series_folding_month_totals", "plan_series_folding_quarter_totals", "plan_series_folding_year_totals"],
                    }),
                    label: "Folding runs", icon: { prefix: "fas", name: "book-open" }, fields: { start: { label: "Dates" } }, range: "start",
                },
                delivery: {
                    source: Data.bindPaged(planSeriesDeliveries, {
                        indexes: ["plan_series_deliveries_by_time", "plan_series_deliveries_by_hall_week", "plan_series_deliveries_by_bay_day",
                            "plan_series_deliveries_by_bay_month", "plan_series_deliveries_by_bay_quarter", "plan_series_deliveries_by_bay_year"],
                        totals: ["plan_series_deliveries_month_totals", "plan_series_deliveries_quarter_totals", "plan_series_deliveries_year_totals"],
                    }),
                    label: "Paper deliveries", icon: { prefix: "fas", name: "truck" }, fields: { at: { label: "Dates" } }, range: "at",
                },
                job: {
                    source: Data.bindPaged(planSeriesJobs, {
                        indexes: ["plan_series_jobs_by_time", "plan_series_jobs_by_line_week", "plan_series_jobs_by_task_day",
                            "plan_series_jobs_by_task_month", "plan_series_jobs_by_task_quarter", "plan_series_jobs_by_task_year"],
                        totals: ["plan_series_jobs_month_totals", "plan_series_jobs_quarter_totals", "plan_series_jobs_year_totals"],
                    }),
                    label: "Print jobs", icon: { prefix: "fas", name: "file-lines" }, fields: { start: { label: "Dates" } }, range: "start",
                },
                trim: {
                    source: Data.bindPaged(planSeriesTrims, {
                        indexes: ["plan_series_trims_by_time", "plan_series_trims_by_line_week", "plan_series_trims_by_guillotine_day",
                            "plan_series_trims_by_guillotine_month", "plan_series_trims_by_guillotine_quarter", "plan_series_trims_by_guillotine_year"],
                        totals: ["plan_series_trims_month_totals", "plan_series_trims_quarter_totals", "plan_series_trims_year_totals"],
                    }),
                    label: "Trims", icon: { prefix: "fas", name: "scissors" }, fields: { at: { label: "Dates" } }, range: "at",
                },
            }));
            return <Box width="100%" height="760px"><Plan id="planSeriesAll" slice={{ slice }}
                // A window of the rows is one hall: the canvas reads and makes the rows of the halls near the view alone.
                paging={{ entries: 1 }}
                axis={Plan.axis({
                    window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                    resolution: "day", resolutions: ["day", "week", "month", "quarter", "year"], now: new Date("2026-10-19T09:00:00Z"),
                })}
                // The rows, rows beside groups at every level: the halls as rows beside the halls as groups; each hall's
                // folders and bays beside its lines; each line's guillotine beside its presses, each press its tasks —
                // where a job's `child` lands.
                series={[
                    Plan.series.resources(SeriesHall, { key: "halls", title: "Halls", icon: "warehouse", label: (hall) => hall.name }),
                    Plan.series.group(SeriesHall, {
                        key: "floors", title: "Hall floors", label: (hall) => hall.name,
                        children: [
                            Plan.children("folders", [Plan.series.resources(SeriesFolder, { key: "folders", title: "Folders", icon: "book-open", label: (folder) => folder.name })]),
                            Plan.children("bays", [Plan.series.resources(SeriesBay, { key: "bays", title: "Bays", icon: "truck-ramp-box", label: (bay) => bay.name })]),
                            Plan.children("lines", [Plan.series.group(SeriesLine, {
                                key: "lines", title: "Lines", label: (line) => line.name,
                                children: [
                                    Plan.children("guillotines", [Plan.series.resources(SeriesGuillotine, {
                                        key: "guillotines", title: "Guillotines", icon: "scissors", label: (guillotine) => guillotine.name,
                                    })]),
                                    Plan.children("presses", [Plan.series.resources(SeriesPress, {
                                        key: "presses", title: "Presses", icon: "print", label: (press) => press.name,
                                        children: Plan.children("tasks", [Plan.series.resources(SeriesTask, { key: "tasks", title: "Tasks", label: (task) => task.name })]),
                                    })]),
                                ],
                            })]),
                        ],
                    }),
                ]}
                // Every way an event kind draws, one at each level, each on the rows its `resource` and `child` name. No kind
                // names the rows its resource stands under: each series index's leading fields are filled from the rows in view.
                events={{
                    // Chips over the whole day an inspection takes, on the hall's own row at the top.
                    inspection: Schedule.events(inspections, {
                        name: "Inspection", icon: "clipboard-check", draw: "cards", title: "title", start: "start", end: "end", state: "state",
                        resource: { field: "hall", of: "halls" }, entries: inspectionEntries,
                    }),
                    // Bars from a start to an end, on a hall's folders.
                    folding: Schedule.events(folding, {
                        name: "Folding run", icon: "book-open", title: "title", start: "start", end: "end", state: "state",
                        resource: { field: "folder", of: "folders" }, entries: foldingEntries,
                    }),
                    // Tiles in the bucket cells their instants fall in, on a hall's bays.
                    delivery: Schedule.events(deliveries, {
                        name: "Paper delivery", icon: "truck", draw: "buckets", title: "title", at: "at",
                        resource: { field: "bay", of: "bays" }, entries: deliveryEntries,
                    }),
                    // Bars on the task rows beneath a line's presses.
                    job: Schedule.events(jobs, {
                        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", state: "state",
                        resource: { field: "press", of: "presses" }, child: { field: "task", of: "tasks" }, entries: jobEntries,
                    }),
                    // Marks at their instants, on a line's guillotine.
                    trim: Schedule.events(trims, {
                        name: "Trim", icon: "scissors", title: "title", at: "at",
                        resource: { field: "guillotine", of: "guillotines" }, entries: trimEntries,
                    }),
                }}
                library={[Plan.library.series()]}
                inspector
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});
