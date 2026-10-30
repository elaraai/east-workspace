/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * The works, whose rows nest every collection a Plan reads a cell at a time
 * (#1438), with their nested series index (#1434): each works' jobs and
 * alarms, its load, its crews' hours and a tree of parts, over ten years,
 * sparse and spread evenly over them; and the task that generates them from
 * their sizes. And the Plan over them (#1439):
 *
 * - `planNestedAll`, every series kind over the works — span, heat, table,
 *   group, and, switched off to start, chart, events, cards and buckets —
 *   paged by rows and by time, each series switched on and off from the
 *   library's Series tab, a crew's hours typed into.
 *
 * The records the Plan's tests read besides are `plan-nested.fixtures.ts`'s,
 * on no page of the showcase.
 *
 * @packageDocumentation
 */

import {
    ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, RecursiveType, StringType, StructType, example, some, variant,
} from "@elaraai/east";
import { Box, EventStateType, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record } from "@elaraai/e3-ui";
import * as e3 from "@elaraai/e3";

// ============================================================================
// Works: every series kind, over ten years
// ============================================================================

/** Monday 3 January 2022, where the works' first week starts: their ten years run to the end of 2031. */
const WORKS_START = new Date(Date.UTC(2022, 0, 3));

/** A works' job: what it makes, when it runs, and its state. */
export const WorksJob = StructType({ product: StringType, start: DateTimeType, end: DateTimeType, state: EventStateType });
/** A works' alarm, raised at an instant. */
export const WorksAlarm = StructType({ code: StringType, at: DateTimeType });
/** A crew of a works: its name, and its hours each quarter, by the instant they were booked. */
export const WorksCrew = StructType({ name: StringType, hours: DictType(DateTimeType, FloatType) });
/** A part of a works: its jobs, and the parts beneath it. */
export const WorksPart = RecursiveType((self) => StructType({ name: StringType, jobs: DictType(StringType, WorksJob), parts: DictType(StringType, self) }));
/**
 * A works: where it stands and how it is; its jobs and its alarms, things
 * people drag; its load every four weeks; its crews, each one's hours each
 * quarter; and its parts, a tree, each part's jobs filed under every part
 * above it too.
 */
export const Works = StructType({
    name: StringType, site: StringType, status: StringType,
    jobs: DictType(StringType, WorksJob), alarms: DictType(StringType, WorksAlarm), load: DictType(DateTimeType, FloatType),
    crews: DictType(StringType, WorksCrew), parts: DictType(StringType, WorksPart),
});
/** The works, by key. */
export const WorksByKey = DictType(StringType, Works);

/**
 * A part's jobs over the weeks: one every seventeen weeks from its first, a
 * day or two long, each keyed by the part and its number.
 */
export const generateWorksPartJobs = East.function([StringType, IntegerType, IntegerType], DictType(StringType, WorksJob), ($, at, first, weeks) => {
    const start = $.const(WORKS_START);
    const confirmed = $.const(variant("confirmed", null), EventStateType);
    return East.Array.range(0n, weeks.subtract(first).add(16n).divide(17n)).toDict(
        (_$2, j) => East.str`${at}-J${j.add(1n)}`,
        ($2, j) => {
            const begins = $2.const(start.addWeeks(first.add(j.multiply(17n))).addHours(30n));
            return { product: "part", start: begins, end: begins.addDays(j.remainder(2n).add(1n)), state: confirmed };
        },
    );
});

/** A part at the foot of a works' tree: its jobs over the weeks, from its first, and no parts beneath it. */
export const generateWorksLeafPart = East.function([StringType, IntegerType, IntegerType], WorksPart, ($, at, first, weeks) => {
    const jobs = $.const(generateWorksPartJobs);
    return $.const({ name: at, jobs: jobs(at, first, weeks), parts: new Map() }, WorksPart);
});

/** A works' top part: its jobs over the weeks, from its first, and two parts beneath it, each six weeks on from the one before. */
export const generateWorksTopPart = East.function([StringType, IntegerType, IntegerType], WorksPart, ($, at, first, weeks) => {
    const jobs = $.const(generateWorksPartJobs);
    const leaf = $.const(generateWorksLeafPart);
    return $.const({
        name: at,
        jobs: jobs(at, first, weeks),
        parts: East.Array.range(0n, 2n).toDict(
            (_$2, k) => East.str`${at}.${k.add(1n)}`,
            (_$2, k) => leaf(East.str`${at}.${k.add(1n)}`, first.add(k.add(1n).multiply(6n)).remainder(17n), weeks),
        ),
    }, WorksPart);
});

/**
 * Works `n` over a number of weeks from Monday 3 January 2022: sparse, and
 * spread evenly over them, each works at its own offset into every cycle so
 * that no two works' items line up and any few weeks hold some — a job every
 * five weeks, one to four days long and every ninth three weeks; an alarm
 * every thirteen weeks; its load every four weeks; two crews' hours each
 * quarter; and three parts, a top part over two, each a job every seventeen
 * weeks. A function of `n` and the weeks alone.
 */
export const generateWorks = East.function([IntegerType, IntegerType], Works, ($, n, weeks) => {
    const start = $.const(WORKS_START);
    const sites = $.const(["north", "south", "east", "west"], ArrayType(StringType));
    const statuses = $.const(["running", "idle", "down"], ArrayType(StringType));
    const products = $.const(["cap", "lid", "tub", "jar"], ArrayType(StringType));
    const confirmed = $.const(variant("confirmed", null), EventStateType);
    const topPart = $.const(generateWorksTopPart);
    const number = $.const(n.add(10_001n));
    // Its offset into the five weeks between its jobs, in days: thirty-five works in turn take every one of them.
    const shift = $.const(n.multiply(8n).remainder(35n));
    return {
        name: East.str`Works ${number}`,
        site: sites.get(n.remainder(4n)),
        status: statuses.get(n.remainder(3n)),
        jobs: East.Array.range(0n, weeks.divide(5n)).toDict(
            (_$2, j) => East.str`J-${number}-${j.add(1n)}`,
            ($2, j) => {
                const begins = $2.const(start.addDays(j.multiply(35n).add(shift)).addHours(n.remainder(24n)));
                const days = $2.const(j.remainder(9n).equal(8n).ifElse(() => 21n, () => j.remainder(4n).add(1n)));
                return { product: products.get(j.remainder(4n)), start: begins, end: begins.addDays(days), state: confirmed };
            },
        ),
        alarms: East.Array.range(0n, weeks.divide(13n)).toDict(
            (_$2, a) => East.str`A-${number}-${a.add(1n)}`,
            (_$2, a) => ({ code: East.str`E${a.remainder(9n).add(1n)}`, at: start.addDays(a.multiply(91n).add(n.multiply(11n).remainder(91n))).addHours(6n) }),
        ),
        load: East.Array.range(0n, weeks.divide(4n)).toDict(
            (_$2, m) => start.addWeeks(m.multiply(4n).add(n.remainder(4n))),
            (_$2, m) => n.multiply(7n).add(m).remainder(100n).toFloat().divide(100.0),
        ),
        crews: East.Array.range(0n, 2n).toDict(
            (_$2, c) => East.str`C-${number}-${c.add(1n)}`,
            (_$2, c) => ({
                name: East.str`Crew ${c.add(1n)}`,
                hours: East.Array.range(0n, weeks.divide(13n)).toDict(
                    (_$3, q) => start.addWeeks(q.multiply(13n).add(n.add(c.multiply(6n)).remainder(13n))),
                    (_$3, q) => n.add(q).add(c.multiply(5n)).remainder(60n).add(420n).toFloat(),
                ),
            }),
        ),
        parts: East.Array.range(0n, 1n).toDict(
            (_$2, k) => East.str`P${number}.${k.add(1n)}`,
            (_$2, k) => topPart(East.str`P${number}.${k.add(1n)}`, n.remainder(17n), weeks),
        ),
    };
});

/** The first `rows` works over a number of weeks, by key: `W-` and each one's number plus 10,001. */
export const generateWorksAll = East.function([IntegerType, IntegerType], WorksByKey, ($, rows, weeks) => {
    const works = $.const(generateWorks);
    return East.Array.range(0n, rows).toDict((_$2, n) => East.str`W-${n.add(10_001n)}`, (_$2, n) => works(n, weeks));
});

/**
 * How many works the task generates: the two hundred the record starts with.
 * A page runs every task of its area as the area starts, so the showcase
 * generates no more than it shows; a stress run writes two thousand.
 */
export const planWorksRows = e3.input("plan_works_rows", IntegerType, variant("value", 200n));
/** How many weeks of each works' collections the task generates: ten years'. */
export const planWorksWeeks = e3.input("plan_works_weeks", IntegerType, variant("value", 522n));
/** The task that generates the works from their sizes. */
export const planWorksGenerated = e3.task("plan_works_generated", [planWorksRows, planWorksWeeks], generateWorksAll);

/**
 * The works, two hundred of them over ten years, some 90,000 items: read lean
 * a page at a time and their collections a cell at a time through their nested
 * series index, never whole. Made as the package is exported, never as a page
 * loads the example. A stress run writes two thousand through the patch door.
 */
export const planWorks = e3.record("plan_works", WorksByKey, {
    initial: () => East.compile(generateWorksAll, [])(200n, 522n),
    indexes: (index) => ({
        // The works by name: the rail's default order.
        plan_works_by_name: index.on(["name"]),
        // The works by site and state: what the rail narrows by.
        plan_works_by_site_status: index.on(["site", "status"]),
        // Every collection of a works in time: its jobs a span each, its alarms an instant each, its load and its crews'
        // hours at their instants, the works keeping their crews' sums, and its parts' jobs filed under every part above them.
        plan_works_in_time: index.nested({
            collections: {
                jobs: index.nested.items({ from: "start", to: "end" }),
                alarms: index.nested.items({ at: "at" }),
                load: index.nested.values(),
                crews: index.nested.rows({ hours: index.nested.values({ rollup: "sum" }) }),
                parts: index.nested.rows({ jobs: index.nested.items({ from: "start", to: "end" }, { rollup: true }), parts: index.nested.recursive() }),
            },
            tile: "week",
            summary: "month",
        }),
    }),
    mutations: (mutation) => ({
        // The works' patch door: a canvas's Save commits through it, by the works' key and each item's.
        patch: mutation.patch(),
    }),
});

/**
 * Every series kind a Plan reads a cell at a time, over the works and their
 * ten years (#1438): each works' jobs as runs and its alarms as decisions,
 * its load as a heat strip, its crews' hours as a table whose works row draws
 * their sums as e3 keeps them, and its parts as a tree whose folded parents
 * draw their bands from the jobs e3 files under them; and, switched off to
 * start, its load as a line, its alarms as exception marks and as tiles, and
 * its jobs as chips. The rail pages the works and narrows them by site and
 * state; the canvas pages them by rows and by time, reading the cells around
 * the rows in view, and shades a collection from its totals past 10,000
 * items. The series are picked: the library's Series tab switches each on and
 * off. A moved job is a draft of its works read whole, saved by key through
 * the patch door.
 */
export const planNestedAll = example({
    keywords: [
        "Plan", "Slice", "Slice.bindRecords", "rows", "rail", "paged", "Data.bindPaged", "index.nested", "nested series index",
        "cell", "subtotals", "bands", "rollup", "tree", "children", "shading", "cap", "large record", "stress", "pick", "Plan.pick",
        "library", "Plan.library.series", "Series tab", "Record.onApply", "keyed", "editing", "Save", "chart", "events", "marks",
        "cards", "chips", "buckets", "tiles", "#1438",
    ],
    description: "Every series a Plan reads a cell at a time, over two hundred works and ten years: each works' jobs as runs and its alarms as decisions, its load as a heat strip, its crews' hours as a table whose works row draws their sums as e3 keeps them, and its parts as a tree whose folded parents draw their bands from the jobs e3 files under them; and, switched off to start, its load as a line, its alarms as marks and as tiles, and its jobs as chips — paged by rows and by time, each series switched on and off from the library's Series tab; a moved job drafts its works read whole and saves by key",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const works = $.let(Record.bind(planWorks, ["patch"]));
            // One rail: its `rows` source pages the works lean by name, narrowed by site and state, beside their nested index.
            const slice = $.let(Slice.bindRecords("ex.planNestedAll", {
                rows: {
                    source: Data.bindPaged(planWorks, { indexes: ["plan_works_by_name", "plan_works_by_site_status", "plan_works_in_time"] }),
                    label: "Works", icon: { prefix: "fas", name: "industry" },
                    fields: {
                        name: { label: "Name" },
                        site: { label: "Site", hints: ["north", "south", "east", "west"] },
                        status: { label: "Status", hints: ["running", "idle", "down"] },
                    },
                    search: ["name"],
                },
            }));
            return <Box width="100%" height="760px"><Plan id="planNestedAll" slice={{ slice }}
                axis={Plan.axis({ window: { min: new Date("2026-09-28T00:00:00Z"), max: new Date("2026-12-28T00:00:00Z") }, resolution: "week", resolutions: ["week", "month", "quarter", "year"] })}
                // The series picked, as Plan.pick returns them: the Series tab lists each, with its eye.
                pick={Plan.pick("ex.planNestedAll.series", [
                    Plan.series.span(Works, {
                        key: "works", title: "Jobs", label: (w) => w.name, edit: true,
                        runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
                        decisions: Plan.items("alarms", { at: "at" }, () => ({ applied: false })),
                    }),
                    Plan.series.heat(Works, {
                        key: "load", title: "Load", label: (w) => w.name,
                        cells: Plan.heatCells(Plan.values("load", (v) => ({ value: some(v) })), { min: 0, max: 1 }),
                    }),
                    Plan.series.table(Works, {
                        key: "crews", title: "Crew hours", label: (w) => w.name, aggregate: "sum", collapsed: true,
                        // A crew's hours are typed into, a week at a time: the works' sum above moves at once.
                        children: Plan.children("crews", [Plan.series.table(WorksCrew, {
                            key: "crew", title: "Crew", label: (c) => c.name,
                            cells: Plan.tableCells(Plan.values("hours", (h) => ({ value: some(h) }))), edit: true,
                        })]),
                    }),
                    Plan.series.group(Works, {
                        key: "assembly", title: "Parts", label: (w) => w.name, collapsed: true,
                        children: Plan.children("parts", [Plan.series.span(WorksPart, {
                            key: "parts", title: "Part", label: (p) => p.name, children: "parts", rollup: "union", collapsed: true,
                            runs: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
                        })]),
                    }),
                    // The other kinds over the same collections, switched off to start: the load as a line, the alarms as
                    // exception marks and as tiles, the jobs as chips.
                    Plan.series.chart(Works, {
                        key: "load-line", title: "Load line", label: (w) => w.name,
                        layers: [Plan.line(Plan.values("load", (v) => ({ y: v })))],
                    }),
                    Plan.series.events(Works, {
                        key: "alarm-marks", title: "Alarms", label: (w) => w.name,
                        marks: Plan.items("alarms", { at: "at" }, (alarm) => ({ kind: variant("exception", null), label: some(alarm.code) })),
                    }),
                    Plan.series.cards(Works, {
                        key: "job-chips", title: "Job chips", label: (w) => w.name,
                        chips: Plan.items("jobs", { from: "start", to: "end" }, (job) => ({ label: job.product, state: job.state })),
                    }),
                    Plan.series.buckets(Works, {
                        key: "alarm-tiles", title: "Alarm tiles", label: (w) => w.name,
                        events: Plan.items("alarms", { at: "at" }, (alarm) => ({ state: variant("confirmed", null), label: some(alarm.code) })),
                    }),
                ], { hidden: ["load-line", "alarm-marks", "job-chips", "alarm-tiles"] })}
                library={[Plan.library.series()]}
                editing={{ onApply: Record.onApply(works, { keyed: true }) }}
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});
