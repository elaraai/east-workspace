/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

import {
    DateTimeType,
    DictType,
    East,
    IntegerType,
    OptionType,
    SetType,
    StringType,
    example,
    none,
    some,
    variant,
} from "@elaraai/east";
import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import { PrintJob, PrintPress } from "./plan-events.examples.js";

// A Plan over records too large to read whole (#1199, `Plan Builder Spec.md`
// §9.11, PB54–PB55): a print works of 2,000 presses and the jobs on them, read a
// window at a time. The presses are generated where data is made — a task of
// the dataflow, from their count — and paged on the canvas, 200 to a window,
// as it scrolls (`Schedule.resources` over a paged read of them); the key
// search seeks a press by its key, and a press is named by its key where an
// event names it. The jobs are a record narrowed through the Plan's one rail
// (#1344): its `job` source reads them through their interval index, so the
// canvas reads only the jobs overlapping the window in view — each once,
// however many days it runs — and the jobs with no start, its backlog, through
// the same index; one job is read by its key through the record's own entries
// (`entries`), and every edit is a draft of a session over the record's
// revision. The day index and the backlog index a kind reads without a slice
// (`Schedule.events`' `window` and `backlogWindow`) are declared beside them:
// a Plan or a Calendar with no rail reads the record through them.

// ============================================================================
// The presses — generated where data is made
// ============================================================================

/** How many presses the works runs: a small authored constant, the presses themselves generated when the dataflow runs. */
export const planWindowPressCount = e3.input("plan_window_press_count", IntegerType, variant("value", 2_000n));

/** A press's key: `P-` and its number plus 1,000 — fixed width, so key order is number order. */
const pressKey = East.function([IntegerType], StringType, (_$, n) => East.str`P-${n.add(1_001n)}`);

/**
 * The presses, generated from their count, by key: each named by its number,
 * in one of eight halls, printing 6,000 to 15,000 sheets an hour.
 */
export const generateWindowPresses = East.function([IntegerType], DictType(StringType, PrintPress), (_$, count) =>
    East.Array.range(0n, count).toDict(
        (_$2, n) => pressKey(n),
        (_$2, n) => ({
            name: East.str`Press ${n.add(1_001n)}`,
            hall: East.str`Hall ${n.remainder(8n).add(1n)}`,
            sheets_per_hour: n.remainder(10n).multiply(1_000n).add(6_000n).toFloat(),
        }),
    ));

/** The task that generates the presses. */
export const planWindowPresses = e3.task("plan_window_presses", [planWindowPressCount], generateWindowPresses);

// ============================================================================
// The jobs — a record read through its indexes
// ============================================================================

/**
 * The print jobs on the presses, from Monday 5 October 2026: a night run into
 * the next day, a run over three days, jobs on presses in each window of 200,
 * jobs in the weeks after the first two, and four waiting in the backlog.
 */
export const planWindowJobs = e3.record("plan_window_jobs", DictType(StringType, PrintJob), new Map([
    ["W-0001", { title: "Brochure run", start: some(new Date("2026-10-05T06:00:00Z")), end: some(new Date("2026-10-05T14:00:00Z")), press: some("P-1001"), state: variant("actual", null), sheets: 40000.0, customer: "Alder & Finch", stock: variant("coated", null), due: some(new Date("2026-10-07T00:00:00Z")) }],
    ["W-0002", { title: "Night catalogue", start: some(new Date("2026-10-05T22:00:00Z")), end: some(new Date("2026-10-06T06:00:00Z")), press: some("P-1001"), state: variant("actual", null), sheets: 96000.0, customer: "Larkspur Home", stock: variant("coated", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
    ["W-0003", { title: "Museum guide", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T12:00:00Z")), press: some("P-1002"), state: variant("actual", null), sheets: 72000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
    ["W-0004", { title: "Course handbooks", start: some(new Date("2026-10-07T06:00:00Z")), end: some(new Date("2026-10-09T18:00:00Z")), press: some("P-1003"), state: variant("confirmed", null), sheets: 144000.0, customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-12T00:00:00Z")) }],
    ["W-0005", { title: "Event posters", start: some(new Date("2026-10-12T07:00:00Z")), end: some(new Date("2026-10-12T12:00:00Z")), press: some("P-1004"), state: variant("confirmed", null), sheets: 60000.0, customer: "Granite Hall", stock: variant("uncoated", null), due: some(new Date("2026-10-13T00:00:00Z")) }],
    ["W-0006", { title: "Menu cards", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T08:00:00Z")), press: some("P-1010"), state: variant("in-progress", null), sheets: 24000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-15T00:00:00Z")) }],
    ["W-0007", { title: "Seed catalogue", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-15T16:00:00Z")), press: some("P-1150"), state: variant("proposed", variant("added", null)), sheets: 100000.0, customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-17T00:00:00Z")) }],
    ["W-0008", { title: "Tour brochure", start: some(new Date("2026-10-16T06:00:00Z")), end: some(new Date("2026-10-16T14:00:00Z")), press: some("P-1200"), state: variant("proposed", variant("recommended", null)), sheets: 80000.0, customer: "Bluewater Tours", stock: variant("coated", null), due: some(new Date("2026-10-19T00:00:00Z")) }],
    ["W-0009", { title: "Timetables", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T10:00:00Z")), press: some("P-1201"), state: variant("actual", null), sheets: 48000.0, customer: "Bluewater Tours", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
    ["W-0010", { title: "Annual report", start: some(new Date("2026-10-13T06:00:00Z")), end: some(new Date("2026-10-13T12:00:00Z")), press: some("P-1250"), state: variant("confirmed", null), sheets: 60000.0, customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
    ["W-0011", { title: "Gift boxes", start: some(new Date("2026-10-09T06:00:00Z")), end: some(new Date("2026-10-09T12:00:00Z")), press: some("P-1333"), state: variant("confirmed", null), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-12T00:00:00Z")) }],
    ["W-0012", { title: "Store flyers", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T16:00:00Z")), press: some("P-1401"), state: variant("in-progress", null), sheets: 150000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
    ["W-0013", { title: "Magazine run", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-16T18:00:00Z")), press: some("P-1460"), state: variant("proposed", variant("added", null)), sheets: 180000.0, customer: "Meridian Monthly", stock: variant("coated", null), due: some(new Date("2026-10-19T00:00:00Z")) }],
    ["W-0014", { title: "Ticket books", start: some(new Date("2026-10-22T06:00:00Z")), end: some(new Date("2026-10-22T08:00:00Z")), press: some("P-1001"), state: variant("estimated", null), sheets: 24000.0, customer: "Heathfield Theatre", stock: variant("uncoated", null), due: some(new Date("2026-10-26T00:00:00Z")) }],
    ["W-0015", { title: "Wall calendars", start: some(new Date("2026-10-26T06:00:00Z")), end: some(new Date("2026-10-26T18:00:00Z")), press: some("P-1002"), state: variant("estimated", null), sheets: 50000.0, customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
    ["W-0016", { title: "Exhibition book", start: some(new Date("2026-10-28T06:00:00Z")), end: some(new Date("2026-10-28T12:00:00Z")), press: some("P-1470"), state: variant("estimated", null), sheets: 54000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
    ["W-0017", { title: "Order forms", start: none, end: none, press: none, state: variant("estimated", null), sheets: 40000.0, customer: "Larkspur Home", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
    ["W-0018", { title: "Winter brochure", start: none, end: none, press: none, state: variant("estimated", null), sheets: 64000.0, customer: "Bluewater Tours", stock: variant("coated", null), due: some(new Date("2026-10-21T00:00:00Z")) }],
    ["W-0019", { title: "Prospectus", start: none, end: none, press: none, state: variant("estimated", null), sheets: 100000.0, customer: "Elmway College", stock: variant("coated", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
    ["W-0020", { title: "Proof sheets", start: none, end: none, press: none, state: variant("estimated", null), sheets: 2000.0, customer: "Alder & Finch", stock: variant("uncoated", null), due: none }],
]));

/** The jobs' patch door: every Save commits through it. */
export const planWindowJobsPatch = e3.mutation.patch(planWindowJobs);

/**
 * The jobs over their interval index (#1344): a job is filed by the interval
 * it runs over, so a window reads each job overlapping it once, however many
 * days it runs, and a job in the backlog under its Unset start — what the
 * rail's `job` source narrows them through.
 */
export const planWindowJobsByTime = e3.recordIndex("plan_window_jobs_by_time", planWindowJobs, { interval: { from: "start", to: "end" } });

/**
 * The jobs by the days each touches (`Schedule.days`): a scheduled job is
 * filed under every day it runs into, and a job in the backlog under none —
 * the index a kind with no rail reads the days in view through (`window`).
 */
export const planWindowJobsByDay = e3.recordIndex("plan_window_jobs_by_day", planWindowJobs, {
    keys: East.function([StringType, PrintJob], SetType(DateTimeType), ($, _id, job) => {
        const days = $.const(Schedule.days);
        const filed = $.let(new Set<Date>(), SetType(DateTimeType));
        $.match(job.start, {
            some: ($2, start) => {
                $2.match(job.end, { some: ($3, end) => { $3.assign(filed, days(start, end)); } });
            },
        });
        return filed;
    }),
});

/**
 * The jobs with no start, by when they are due (`Schedule.unscheduled`): the
 * index a kind with no rail reads its backlog through (`backlogWindow`), and
 * nothing scheduled in it.
 */
export const planWindowJobsUnscheduled = e3.recordIndex("plan_window_jobs_unscheduled", planWindowJobs, {
    keys: East.function([StringType, PrintJob], SetType(OptionType(DateTimeType)), ($, _id, job) => {
        const unscheduled = $.const(Schedule.unscheduled);
        return unscheduled(job.start, job.due);
    }),
});

// ============================================================================
// planWindows — a Plan read a window at a time (§9.11)
// ============================================================================

/**
 * A Plan read a window at a time (`Plan Builder Spec.md` §9.11, PB54–PB55):
 * 2,000 presses, paged 200 to a window as the canvas scrolls, the key search
 * seeking a press by its key; and the jobs on them narrowed through the Plan's
 * one rail (#1344) — its `job` source reads them through their interval
 * index, only the jobs overlapping the window in view, each once, and the
 * backlog, which the library's Backlog tab lists, through its Unset start. The
 * source's range is the window: the toolbar's dates, a pan and the horizon
 * brush write it, and a pan reads the jobs it brings in. One job — the
 * inspector's, a draft's — is read by its key through the record's own
 * entries. Neither the presses nor the jobs are ever read whole, and Save
 * commits through the jobs' patch door, its drafts checked against the
 * revision they were drafted at.
 */
export const planWindows = example({
    keywords: [
        "Plan", "Schedule", "Schedule.resources", "Schedule.events", "Slice", "Slice.bindRecords", "source", "range", "window",
        "interval", "interval index", "e3.recordIndex", "paged", "page", "Data.bindPaged", "backlog", "large record",
        "key search", "seek", "scroll", "pan", "brush", "presses", "jobs", "e3.task", "Record.bind", "e3.record", "entries",
        "by key", "revision", "editing", "Save", "#1199", "#1344",
    ],
    description: "A Plan read a window at a time — 2,000 presses paged 200 to a window as the canvas scrolls (`Schedule.resources` over `Data.bindPaged`, the key search seeking a press), and the jobs narrowed through one Slice.bindRecords rail, its `job` source reading them through their interval index — only the jobs overlapping the window, each once, the backlog through its Unset start — its range the window the toolbar's dates, a pan and the brush write, and one job by its key through the record's own entries; its editing a session over the record's revision, never the record whole",
    fn: East.function([], UIComponentType, (_$) => {
        return (<Reactive>{$ => {
            const presses = $.let(Data.bindPaged(planWindowPresses));
            const jobs = $.let(Record.bind(planWindowJobs, [planWindowJobsPatch]));
            const jobEntries = $.let(Data.bindPaged(planWindowJobs));
            // One rail: its `job` source reads the jobs through their interval index, its range the window in view.
            const slice = $.let(Slice.bindRecords("ex.plan.windows", {
                job: { source: Data.bindPaged(planWindowJobs, { indexes: [planWindowJobsByTime] }), label: "Print jobs",
                    fields: { start: { label: "Dates" } }, range: "start" },
            }));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-19T00:00:00Z") },
                resolution: "day", now: new Date("2026-10-14T09:00:00Z"),
            }));
            return (
                <Plan
                    // Named: a page holding it beside another Plan keeps each one's panes, hidden series and library its own.
                    id="windows"
                    axis={axis}
                    slice={{ slice }}
                    resources={{
                        presses: Schedule.resources(presses, {
                            name: "Presses", icon: "print", label: p => p.name,
                            sub: (p, key) => some(East.str`${key} · ${p.hall}`),
                        }),
                    }}
                    events={{
                        job: Schedule.events(jobs, {
                            name: "Print job", icon: "file-lines",
                            title: "title", start: "start", end: "end",
                            resource: { field: "press", of: "presses" },
                            state: "state", quantity: { field: "sheets", unit: "sheets" },
                            backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                            entries: jobEntries,
                        }),
                    }}
                    library={[Plan.library.backlog()]}
                    style={{ height: "480px" }}
                />
            );
        }}</Reactive>);
    }),
    inputs: [],
});
