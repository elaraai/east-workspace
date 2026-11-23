/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * A Plan of grouped rows at scale (#1710): a print works' halls, each holding
 * its presses, each press its tasks — the rows, a record of their own — and
 * four records of events on them, each event a row of its own, never a
 * collection inside a hall: print jobs, services, paper deliveries and colour
 * checks. Each is read a cell at a time through its own series index in time
 * order led by the hall: a week's events together under their hall, in their
 * presses' order, so a block of a hall's presses in view is one range a tile.
 * And the Plan over them:
 *
 * - `planSeriesAll`, the halls read a hall at a time, and every way an event
 *   kind draws: bars, chips, tiles and marks.
 *
 * @packageDocumentation
 */

import { ArrayType, DateTimeType, DictType, East, IntegerType, StringType, StructType, example, variant, type ValueTypeOf } from "@elaraai/east";
import { Box, EventStateType, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// The halls — the rows, each holding its presses and their tasks
// ============================================================================

/** How many presses each hall holds, in turn: halls of four sizes, so a hall fills part of a view or many views. */
const SERIES_HALL_SIZES = [24n, 144n, 72n, 48n];
/** The tasks every press takes, in order. */
const SERIES_TASKS = ["Make-ready", "Print", "Finish"];
/** What the works prints, in turn. */
const SERIES_TITLES = ["Brochures", "Catalogues", "Leaflets", "Posters", "Manuals", "Labels", "Calendars"];
/** Monday 5 October 2026, where the events' first week starts. */
const SERIES_START = new Date("2026-10-05T00:00:00Z");

/** Hall `h`'s key: `H-` and its number plus 101. */
export const seriesHallKey = East.function([IntegerType], StringType, (_$, h) => East.str`H-${h.add(101n)}`);
/** Press `p` of hall `h`'s key: its hall's number and its own — fixed width, so the presses' keys hold their order. */
export const seriesPressKey = East.function([IntegerType, IntegerType], StringType, (_$, h, p) => East.str`P-${h.add(101n)}-${p.add(1001n)}`);

/** A task a press takes: a row beneath the press its jobs land on. */
export const SeriesTask = StructType({ name: StringType });
/** A press of a hall: its name, and its tasks by key. */
export const SeriesPress = StructType({ name: StringType, tasks: DictType(StringType, SeriesTask) });
/** A hall: its name, and its presses by key. */
export const SeriesHall = StructType({ name: StringType, presses: DictType(StringType, SeriesPress) });
/** The halls, by key. */
export const SeriesHalls = DictType(StringType, SeriesHall);

/** `halls` halls of {@link SERIES_HALL_SIZES} presses in turn, each press taking the three tasks, keyed `T1` to `T3`. A function of the count alone. */
export const generateSeriesHalls = East.function([IntegerType], SeriesHalls, ($, halls) => {
    const sizes = $.const(SERIES_HALL_SIZES, ArrayType(IntegerType));
    const tasks = $.const(SERIES_TASKS, ArrayType(StringType));
    const hallKey = $.const(seriesHallKey);
    const pressKey = $.const(seriesPressKey);
    return East.Array.range(0n, halls).toDict(
        (_$2, h) => hallKey(h),
        (_$2, h) => ({
            name: East.str`Hall ${h.add(1n)}`,
            presses: East.Array.range(0n, sizes.get(h.remainder(4n))).toDict(
                (_$3, p) => pressKey(h, p),
                (_$3, p) => ({
                    name: East.str`Press ${h.add(1n)}.${p.add(1n)}`,
                    tasks: East.Array.range(0n, 3n).toDict((_$4, t) => East.str`T${t.add(1n)}`, (_$4, t) => ({ name: tasks.get(t) })),
                }),
            ),
        }),
    );
});

/** Eight halls of 576 presses in all, 1,728 task rows beneath them: read a hall at a time, never whole. */
export const planSeriesHalls = e3.record("plan_series_halls", SeriesHalls, {
    initial: () => East.compile(generateSeriesHalls, [])(8n),
    indexes: (index) => ({
        // The halls by name: the rail's order, and what it narrows them by.
        plan_series_halls_by_name: index.on(["name"]),
    }),
});

/** Where an event is generated: a press, by its hall's key and its own, and their numbers. */
export const SeriesPlace = StructType({ hall: StringType, press: StringType, h: IntegerType, p: IntegerType });

/** Every press of `halls` halls {@link generateSeriesHalls} makes, in their order: where each record of events is generated over. */
export const generateSeriesPlaces = East.function([IntegerType], ArrayType(SeriesPlace), ($, halls) => {
    const sizes = $.const(SERIES_HALL_SIZES, ArrayType(IntegerType));
    const hallKey = $.const(seriesHallKey);
    const pressKey = $.const(seriesPressKey);
    const places = $.let([], ArrayType(SeriesPlace));
    $.for(East.Array.range(0n, halls), ($2, h) => {
        $2.for(East.Array.range(0n, sizes.get(h.remainder(4n))), ($3, p) => {
            $3(places.pushLast({ hall: hallKey(h), press: pressKey(h, p), h, p }));
        });
    });
    return places;
});

// ============================================================================
// The events — four records, one row an event, each filed in time order under its hall
// ============================================================================

/**
 * A print job on a press's task: the hall its press stands in, by the hall's
 * key — what its series index files it by first — the press, the task row
 * beneath it, what it prints, when it runs, and its state.
 */
export const SeriesJob = StructType({
    hall: StringType, press: StringType, task: StringType, title: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType,
});
/** A press's service, a whole day: its hall, the press, what it is, when, and its state. */
export const SeriesService = StructType({ hall: StringType, press: StringType, title: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType });
/** Paper delivered to a press, at an instant: its hall, the press, what it is for, and when. */
export const SeriesDelivery = StructType({ hall: StringType, press: StringType, title: StringType, at: DateTimeType });
/** A colour check of a press's run, at an instant: its hall, the press, what it checks, and when. */
export const SeriesCheck = StructType({ hall: StringType, press: StringType, title: StringType, at: DateTimeType });

/**
 * Each press's week over a number of weeks from Monday 5 October 2026, a
 * function of the counts alone: its paper delivered, then a make-ready of two
 * hours, a run of a day and a half — its colours checked halfway through — and
 * three hours' finishing, one on each of its tasks; and every third week a
 * day's service. Each press starts at its own hour into the week, so no two
 * presses' events line up; the first two weeks' have run, the rest are
 * confirmed.
 */
export const SeriesWeeks = StructType({
    jobs: DictType(StringType, SeriesJob), services: DictType(StringType, SeriesService),
    deliveries: DictType(StringType, SeriesDelivery), checks: DictType(StringType, SeriesCheck),
});

/** The events of `halls` halls' presses over `weeks` weeks ({@link SeriesWeeks}): each record's rows, by key. */
export const generateSeriesWeeks = East.function([IntegerType, IntegerType], SeriesWeeks, ($, halls, weeks) => {
    const places = $.const(generateSeriesPlaces);
    const start = $.const(SERIES_START);
    const titles = $.const(SERIES_TITLES, ArrayType(StringType));
    const actual = $.const(variant("actual", null), EventStateType);
    const confirmed = $.const(variant("confirmed", null), EventStateType);
    const jobs = $.let(new Map(), DictType(StringType, SeriesJob));
    const services = $.let(new Map(), DictType(StringType, SeriesService));
    const deliveries = $.let(new Map(), DictType(StringType, SeriesDelivery));
    const checks = $.let(new Map(), DictType(StringType, SeriesCheck));
    $.for(places(halls), ($2, at) => {
        const hall = $2.const(at.hall);
        const press = $2.const(at.press);
        // Its own hour into the week: up to two days in.
        const offset = $2.const(at.h.multiply(5n).add(at.p).remainder(48n));
        $2.for(East.Array.range(0n, weeks), ($3, w) => {
            const week = $3.const(start.addWeeks(w));
            const ready = $3.const(week.addHours(offset.add(6n)));
            const run = $3.const(ready.addHours(2n));
            const finish = $3.const(run.addHours(36n));
            const title = $3.const(titles.get(at.p.add(w).remainder(7n)));
            const state = $3.const(w.less(2n).ifElse(() => actual, () => confirmed));
            const key = $3.const(East.str`${press}-W${w.add(1n)}`);
            $3(deliveries.insert(key, { hall, press, title: East.str`Paper for ${title}`, at: ready.addHours(-4n) }));
            $3(jobs.insert(East.str`${key}-T1`, { hall, press, task: "T1", title: East.str`${title}: make-ready`, start: ready, end: run, state }));
            $3(jobs.insert(East.str`${key}-T2`, { hall, press, task: "T2", title, start: run, end: finish, state }));
            $3(jobs.insert(East.str`${key}-T3`, { hall, press, task: "T3", title: East.str`${title}: finishing`, start: finish, end: finish.addHours(3n), state }));
            $3(checks.insert(key, { hall, press, title: East.str`Colours: ${title}`, at: run.addHours(18n) }));
            // Every third week, a day's service from midnight, after the week's run.
            $3.if(w.remainder(3n).equal(2n), ($4) => {
                const day = $4.const(week.addDays(offset.divide(24n).add(4n)));
                $4(services.insert(key, { hall, press, title: "Service", start: day, end: day.addDays(1n), state }));
            });
        });
    });
    return { jobs, services, deliveries, checks };
});

/** The events of the eight halls' presses over six weeks, as the four records start: made once, as the first of them is. */
let seriesWeeks: ValueTypeOf<typeof SeriesWeeks> | undefined;
const SERIES_WEEKS = () => (seriesWeeks ??= East.compile(generateSeriesWeeks, [])(8n, 6n));

/** The print jobs, 10,368 of them, by key: read a cell at a time, never whole. */
export const planSeriesJobs = e3.record("plan_series_jobs", DictType(StringType, SeriesJob), {
    initial: () => SERIES_WEEKS().jobs,
    indexes: (index) => ({
        // The jobs over their interval index: the window the rail reads and its exact count.
        plan_series_jobs_by_time: index.interval({ from: "start", to: "end" }),
        // A week's jobs together under their hall, in their presses' order (#1710): a block of a hall's presses in view
        // is one range a tile, from its first press through its last, whatever the presses' histories.
        plan_series_jobs_by_hall_week: index.series({ on: ["hall"], key: "press", from: "start", to: "end", tile: "week", order: "time" }),
        // How busy each press is, a day at a time: what the Plan shades where the jobs in view are too many to draw.
        plan_series_jobs_by_press_day: index.summary({ key: "press", from: "start", to: "end", tile: "day" }),
    }),
    mutations: (mutation) => ({
        // The jobs' patch door: every Save commits through it.
        patch: mutation.patch(),
    }),
});

/** The presses' services, 1,152 of them, by key: filed as the jobs are. */
export const planSeriesServices = e3.record("plan_series_services", DictType(StringType, SeriesService), {
    initial: () => SERIES_WEEKS().services,
    indexes: (index) => ({
        plan_series_services_by_time: index.interval({ from: "start", to: "end" }),
        plan_series_services_by_hall_week: index.series({ on: ["hall"], key: "press", from: "start", to: "end", tile: "week", order: "time" }),
        plan_series_services_by_press_day: index.summary({ key: "press", from: "start", to: "end", tile: "day" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The paper delivered to the presses, 3,456 deliveries by key, each at an instant: filed from its instant to the same. */
export const planSeriesDeliveries = e3.record("plan_series_deliveries", DictType(StringType, SeriesDelivery), {
    initial: () => SERIES_WEEKS().deliveries,
    indexes: (index) => ({
        plan_series_deliveries_by_time: index.interval({ from: "at", to: "at" }),
        plan_series_deliveries_by_hall_week: index.series({ on: ["hall"], key: "press", from: "at", to: "at", tile: "week", order: "time" }),
        plan_series_deliveries_by_press_day: index.summary({ key: "press", from: "at", to: "at", tile: "day" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The presses' colour checks, 3,456 of them by key, each at an instant: filed as the deliveries are. */
export const planSeriesChecks = e3.record("plan_series_checks", DictType(StringType, SeriesCheck), {
    initial: () => SERIES_WEEKS().checks,
    indexes: (index) => ({
        plan_series_checks_by_time: index.interval({ from: "at", to: "at" }),
        plan_series_checks_by_hall_week: index.series({ on: ["hall"], key: "press", from: "at", to: "at", tile: "week", order: "time" }),
        plan_series_checks_by_press_day: index.summary({ key: "press", from: "at", to: "at", tile: "day" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

// ============================================================================
// planSeriesAll — the halls a hall at a time, every way an event kind draws
// ============================================================================

/**
 * A Plan of grouped rows at scale (#1710): eight halls, each a group with its
 * presses beneath it and each press its three task rows — 576 presses in all —
 * read a hall at a time (`paging={{ entries: 1 }}`), and every way an event
 * kind draws, each kind a record of its own events read a cell at a time
 * through its series index in time order led by the hall: print jobs as bars
 * on the task rows, services as chips over the days they take, paper
 * deliveries as tiles in the bucket cells their instants fall in, and colour
 * checks as marks, each on the press's own row. No kind names the hall: the
 * Plan fills each index's leading field with the key of the hall the rows in
 * view sit under, so a block of a hall's presses is one range a tile — from its
 * first press through its last — where an index in key order asks a range a
 * press a level. Zoomed out past what it draws, a kind shades each press's
 * days from its summary. The library's Series tab switches each kind on and
 * off; one event is read by its key through its record's own entries, and Save
 * commits through each record's patch door.
 */
export const planSeriesAll = example({
    keywords: [
        "Plan", "Plan.series.group", "Plan.series.resources", "Plan.children", "Schedule.events", "child", "resource", "draw", "span", "bars",
        "cards", "chips", "buckets", "tiles", "marks", "instant", "at", "groups", "halls", "presses", "tasks", "grouped rows", "paging", "entries",
        "Slice", "Slice.bindRecords", "rows source", "Data.bindPaged", "paged", "index.series", "series index", "order", "time order",
        "order: 'time'", "on", "leading field", "index.interval", "index.summary", "cell", "range a tile", "large record", "scale", "shading",
        "Plan.library.series", "Series tab", "Record.bind", "entries", "Save", "#1710",
    ],
    description: "A Plan of grouped rows at scale — eight halls, each a group with its presses beneath it and each press its three task rows, 576 presses read a hall at a time (paging={{ entries: 1 }}) — and every way an event kind draws, each kind a record of its own events read a cell at a time through a series index in time order led by the hall (index.series({ on: [\"hall\"], key: \"press\", …, order: \"time\" })): print jobs as bars on the task rows by `child`, services as chips (draw: \"cards\"), paper deliveries as tiles (draw: \"buckets\") and colour checks as marks, both at instants (`at`), on the press's own row; the Plan fills the hall from the rows in view, so a block of a hall's presses is one range a tile, shading from each summary zoomed out, each kind switched on and off from the Series tab, one event by its key through its record's own entries, and Save through each patch door",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const jobs = $.let(Record.bind(planSeriesJobs));
            const services = $.let(Record.bind(planSeriesServices));
            const deliveries = $.let(Record.bind(planSeriesDeliveries));
            const checks = $.let(Record.bind(planSeriesChecks));
            // Each kind's entries: what reads one event by its key.
            const jobEntries = $.let(Data.bindPaged(planSeriesJobs));
            const serviceEntries = $.let(Data.bindPaged(planSeriesServices));
            const deliveryEntries = $.let(Data.bindPaged(planSeriesDeliveries));
            const checkEntries = $.let(Data.bindPaged(planSeriesChecks));
            // One rail: its `rows` source pages the halls by name; each kind's source lists its record's interval index,
            // its series index in time order and its summary — the Plan reads the kind's cells through them.
            const slice = $.let(Slice.bindRecords("ex.planSeriesAll", {
                rows: {
                    source: Data.bindPaged(planSeriesHalls, { indexes: ["plan_series_halls_by_name"] }),
                    label: "Halls", icon: { prefix: "fas", name: "warehouse" },
                    fields: { name: { label: "Hall", hints: ["Hall 1", "Hall 2", "Hall 3", "Hall 4", "Hall 5", "Hall 6", "Hall 7", "Hall 8"] } },
                },
                job: {
                    source: Data.bindPaged(planSeriesJobs, { indexes: ["plan_series_jobs_by_time", "plan_series_jobs_by_hall_week", "plan_series_jobs_by_press_day"] }),
                    label: "Print jobs", icon: { prefix: "fas", name: "file-lines" }, fields: { start: { label: "Dates" } }, range: "start",
                },
                service: {
                    source: Data.bindPaged(planSeriesServices, {
                        indexes: ["plan_series_services_by_time", "plan_series_services_by_hall_week", "plan_series_services_by_press_day"],
                    }),
                    label: "Services", icon: { prefix: "fas", name: "screwdriver-wrench" }, fields: { start: { label: "Dates" } }, range: "start",
                },
                delivery: {
                    source: Data.bindPaged(planSeriesDeliveries, {
                        indexes: ["plan_series_deliveries_by_time", "plan_series_deliveries_by_hall_week", "plan_series_deliveries_by_press_day"],
                    }),
                    label: "Paper deliveries", icon: { prefix: "fas", name: "truck" }, fields: { at: { label: "Dates" } }, range: "at",
                },
                check: {
                    source: Data.bindPaged(planSeriesChecks, { indexes: ["plan_series_checks_by_time", "plan_series_checks_by_hall_week", "plan_series_checks_by_press_day"] }),
                    label: "Colour checks", icon: { prefix: "fas", name: "clipboard-check" }, fields: { at: { label: "Dates" } }, range: "at",
                },
            }));
            return <Box width="100%" height="760px"><Plan id="planSeriesAll" slice={{ slice }}
                // A window of the rows is one hall: the canvas reads and makes the rows of the halls near the view alone.
                paging={{ entries: 1 }}
                axis={Plan.axis({
                    window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                    resolution: "day", resolutions: ["day", "week", "month"], now: new Date("2026-10-19T09:00:00Z"),
                })}
                // The rows: each hall, its presses beneath it, each press its tasks — where a job's `child` lands.
                series={[Plan.series.group(SeriesHall, {
                    key: "halls", title: "Halls", label: (hall) => hall.name,
                    children: Plan.children("presses", [Plan.series.resources(SeriesPress, {
                        key: "press", title: "Presses", icon: "print", label: (press) => press.name,
                        children: Plan.children("tasks", [Plan.series.resources(SeriesTask, { key: "tasks", title: "Tasks", label: (task) => task.name })]),
                    })]),
                })]}
                // Every way an event kind draws, each on the rows its `resource` and `child` name. No kind names the hall: each
                // index's leading field is filled from the rows in view.
                events={{
                    // Bars from a start to an end, on the press's task rows.
                    job: Schedule.events(jobs, {
                        name: "Print job", icon: "file-lines", title: "title", start: "start", end: "end", state: "state",
                        resource: { field: "press", of: "press" }, child: { field: "task", of: "tasks" }, entries: jobEntries,
                    }),
                    // Chips over the whole days a service takes, on the press's own row.
                    service: Schedule.events(services, {
                        name: "Service", icon: "screwdriver-wrench", draw: "cards", title: "title", start: "start", end: "end", state: "state",
                        resource: { field: "press", of: "press" }, entries: serviceEntries,
                    }),
                    // Tiles in the bucket cells their instants fall in.
                    delivery: Schedule.events(deliveries, {
                        name: "Paper delivery", icon: "truck", draw: "buckets", title: "title", at: "at",
                        resource: { field: "press", of: "press" }, entries: deliveryEntries,
                    }),
                    // Marks at their instants.
                    check: Schedule.events(checks, {
                        name: "Colour check", icon: "clipboard-check", title: "title", at: "at",
                        resource: { field: "press", of: "press" }, entries: checkEntries,
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
