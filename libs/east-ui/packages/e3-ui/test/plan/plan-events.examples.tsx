/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

import {
    ArrayType,
    DateTimeType,
    DictType,
    East,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    PatchType,
    SetType,
    SortedMap,
    StringType,
    StructType,
    VariantType,
    compareFor,
    example,
    none,
    some,
    variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Box, Button, Chart, EventStateType, Format, HStack, Reactive, SegmentGroup, Select, Slice, State, Text, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Func, Plan, Record, Schedule } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// A Plan of event kinds (#1191, `Plan Builder Spec.md` §3, #1541): the resources
// are the canvas's rows, read from a record and laid out by a
// `Plan.series.resources` series or a `Plan.series.kinds` case, and each event
// kind is a record of its own, bound with its patch mutation
// (`Schedule.events`) — the very values a Calendar takes. The print works'
// records are seeded so that every part of the Plan has something in it: six
// presses in two halls and four crews; thirty print jobs over four weeks from
// Monday 5 October 2026, eight of them waiting in the backlog; plate changes
// and services; early and late shifts; each press's utilisation and the sheets
// printed each day; templates for every kind, each a record of its own
// (#1344); and the customers its library lists (#1195). Its one rail narrows
// the jobs, the shifts, the customers and each templates record, a source
// apiece. The smallest builder reads the presses and the customers
// beside a jobs record of its own. A measure is stored as its readings from
// the window's first day, which the series turn into cells and points, as the
// Plan's other examples store theirs.

// ============================================================================
// The print works' records (§3.1)
// ============================================================================

/** A press: its name, its hall and the sheets it prints an hour. */
export const PrintPress = StructType({ name: StringType, hall: StringType, sheets_per_hour: FloatType });

/**
 * A print job: when it runs and on which press — none of the three while it
 * waits in the backlog — the lifecycle it wears, its sheets, and the
 * customer's details.
 */
export const PrintJob = StructType({
    title: StringType,
    start: OptionType(DateTimeType),
    end: OptionType(DateTimeType),
    press: OptionType(StringType),
    state: EventStateType,
    sheets: FloatType,
    customer: StringType,
    stock: VariantType({ coated: NullType, uncoated: NullType, board: NullType }),
    due: OptionType(DateTimeType),
});

/** A stop on a press, at one instant: a plate change or a service. */
export const PrintStop = StructType({
    title: StringType,
    at: DateTimeType,
    press: StringType,
    kind: VariantType({ plate_change: NullType, service: NullType }),
});

/** A crew's shift. */
export const PrintShift = StructType({ title: StringType, start: DateTimeType, end: DateTimeType, crew: StringType, state: EventStateType });

/** A customer: its name, the district it is in and its trade. */
export const PrintCustomer = StructType({ name: StringType, district: StringType, trade: StringType });

/** An order to plan: what is to be printed, who for, and the sheets it takes. */
export const PrintOrder = StructType({ title: StringType, customer: StringType, sheets: FloatType });

/** The presses: three in each hall. A Plan given no `record` writes none of its rows. */
export const planPrintPresses = e3.record("plan_print_presses", DictType(StringType, PrintPress), {
    initial: new Map([
        ["a1", { name: "Press A1", hall: "Hall A", sheets_per_hour: 12000.0 }],
        ["a2", { name: "Press A2", hall: "Hall A", sheets_per_hour: 10000.0 }],
        ["a3", { name: "Press A3", hall: "Hall A", sheets_per_hour: 8000.0 }],
        ["b1", { name: "Press B1", hall: "Hall B", sheets_per_hour: 15000.0 }],
        ["b2", { name: "Press B2", hall: "Hall B", sheets_per_hour: 12000.0 }],
        ["b3", { name: "Press B3", hall: "Hall B", sheets_per_hour: 6000.0 }],
    ]),
    indexes: (index) => ({
        plan_print_presses_by_hall: index.on(["hall"]),
    }),
    mutations: (mutation) => ({
        // The presses' patch door: the works edits its presses elsewhere, and a Plan reads them live.
        patch: mutation.patch(),
    }),
});


/**
 * The print jobs: actual before 14 October, in progress on it, confirmed,
 * proposed and estimated after it; two overlapping on Press B2 on the 20th;
 * and eight with no start waiting in the backlog, two due this week, two next
 * week, two later and two with no due date.
 */
export const planPrintJobs = e3.record("plan_print_jobs", DictType(StringType, PrintJob), {
    initial: new Map([
        ["J-1001", { title: "Spring catalogue", start: some(new Date("2026-10-05T06:00:00Z")), end: some(new Date("2026-10-05T14:00:00Z")), press: some("a1"), state: variant("actual", null), sheets: 96000.0, customer: "Alder & Finch", stock: variant("coated", null), due: some(new Date("2026-10-07T00:00:00Z")) }],
        ["J-1002", { title: "Museum guide", start: some(new Date("2026-10-07T06:00:00Z")), end: some(new Date("2026-10-07T12:00:00Z")), press: some("a1"), state: variant("actual", null), sheets: 72000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
        ["J-1003", { title: "Event posters", start: some(new Date("2026-10-14T07:00:00Z")), end: some(new Date("2026-10-14T12:00:00Z")), press: some("a1"), state: variant("in-progress", null), sheets: 60000.0, customer: "Granite Hall", stock: variant("uncoated", null), due: some(new Date("2026-10-15T00:00:00Z")) }],
        ["J-1004", { title: "Course handbook", start: some(new Date("2026-10-19T06:00:00Z")), end: some(new Date("2026-10-19T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
        ["J-1005", { title: "Menu cards", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T08:00:00Z")), press: some("a1"), state: variant("proposed", variant("recommended", null)), sheets: 24000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
        ["J-1006", { title: "Tour brochure", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T14:00:00Z")), press: some("a2"), state: variant("actual", null), sheets: 80000.0, customer: "Bluewater Tours", stock: variant("coated", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
        ["J-1007", { title: "Annual report", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T12:00:00Z")), press: some("a2"), state: variant("in-progress", null), sheets: 60000.0, customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
        ["J-1008", { title: "Seed catalogue", start: some(new Date("2026-10-21T06:00:00Z")), end: some(new Date("2026-10-21T16:00:00Z")), press: some("a2"), state: variant("proposed", variant("added", null)), sheets: 100000.0, customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-24T00:00:00Z")) }],
        ["J-1009", { title: "Season flyers", start: some(new Date("2026-10-28T06:00:00Z")), end: some(new Date("2026-10-28T09:00:00Z")), press: some("a2"), state: variant("estimated", null), sheets: 30000.0, customer: "Heathfield Theatre", stock: variant("uncoated", null), due: some(new Date("2026-10-31T00:00:00Z")) }],
        ["J-1010", { title: "Club newsletter", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T08:00:00Z")), press: some("a3"), state: variant("actual", null), sheets: 16000.0, customer: "Kestrel Cycling Club", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
        ["J-1011", { title: "Stationery set", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-15T09:00:00Z")), press: some("a3"), state: variant("confirmed", null), sheets: 24000.0, customer: "Ivy Lane Studio", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
        ["J-1012", { title: "Gift boxes", start: some(new Date("2026-10-22T06:00:00Z")), end: some(new Date("2026-10-22T12:00:00Z")), press: some("a3"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-26T00:00:00Z")) }],
        ["J-1013", { title: "Holiday catalogue", start: some(new Date("2026-10-05T06:00:00Z")), end: some(new Date("2026-10-05T22:00:00Z")), press: some("b1"), state: variant("actual", null), sheets: 240000.0, customer: "Larkspur Home", stock: variant("coated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
        ["J-1014", { title: "Magazine run", start: some(new Date("2026-10-12T06:00:00Z")), end: some(new Date("2026-10-12T18:00:00Z")), press: some("b1"), state: variant("actual", null), sheets: 180000.0, customer: "Meridian Monthly", stock: variant("coated", null), due: some(new Date("2026-10-13T00:00:00Z")) }],
        ["J-1015", { title: "Store flyers", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T16:00:00Z")), press: some("b1"), state: variant("in-progress", null), sheets: 150000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
        ["J-1016", { title: "Exhibition book", start: some(new Date("2026-10-26T06:00:00Z")), end: some(new Date("2026-10-26T12:00:00Z")), press: some("b1"), state: variant("estimated", null), sheets: 90000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
        ["J-1017", { title: "Timetables", start: some(new Date("2026-10-09T06:00:00Z")), end: some(new Date("2026-10-09T10:00:00Z")), press: some("b2"), state: variant("actual", null), sheets: 48000.0, customer: "Bluewater Tours", stock: variant("uncoated", null), due: some(new Date("2026-10-12T00:00:00Z")) }],
        ["J-1018", { title: "Market posters", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T12:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 72000.0, customer: "Orchard Street Market", stock: variant("coated", null), due: some(new Date("2026-10-22T00:00:00Z")) }],
        ["J-1019", { title: "Loyalty cards", start: some(new Date("2026-10-20T10:00:00Z")), end: some(new Date("2026-10-20T13:00:00Z")), press: some("b2"), state: variant("proposed", variant("added", null)), sheets: 36000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
        ["J-1020", { title: "Ticket books", start: some(new Date("2026-10-29T06:00:00Z")), end: some(new Date("2026-10-29T08:00:00Z")), press: some("b2"), state: variant("estimated", null), sheets: 24000.0, customer: "Heathfield Theatre", stock: variant("uncoated", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
        ["J-1021", { title: "Handbook covers", start: some(new Date("2026-10-16T06:00:00Z")), end: some(new Date("2026-10-16T08:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 12000.0, customer: "Elmway College", stock: variant("board", null), due: some(new Date("2026-10-19T00:00:00Z")) }],
        ["J-1022", { title: "Box sleeves", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T09:00:00Z")), press: some("b3"), state: variant("proposed", variant("recommended", null)), sheets: 18000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-22T00:00:00Z")) }],
        ["J-1023", { title: "Guide reprint", start: none, end: none, press: none, state: variant("estimated", null), sheets: 24000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
        ["J-1024", { title: "Order forms", start: none, end: none, press: none, state: variant("proposed", variant("added", null)), sheets: 40000.0, customer: "Larkspur Home", stock: variant("uncoated", null), due: some(new Date("2026-10-17T00:00:00Z")) }],
        ["J-1025", { title: "Winter brochure", start: none, end: none, press: none, state: variant("estimated", null), sheets: 64000.0, customer: "Bluewater Tours", stock: variant("coated", null), due: some(new Date("2026-10-21T00:00:00Z")) }],
        ["J-1026", { title: "Wall calendars", start: none, end: none, press: none, state: variant("estimated", null), sheets: 50000.0, customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
        ["J-1027", { title: "Prospectus", start: none, end: none, press: none, state: variant("estimated", null), sheets: 100000.0, customer: "Elmway College", stock: variant("coated", null), due: some(new Date("2026-11-06T00:00:00Z")) }],
        ["J-1028", { title: "Price lists", start: none, end: none, press: none, state: variant("estimated", null), sheets: 16000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-11-13T00:00:00Z")) }],
        ["J-1029", { title: "Spare covers", start: none, end: none, press: none, state: variant("estimated", null), sheets: 8000.0, customer: "Meridian Monthly", stock: variant("board", null), due: none }],
        ["J-1030", { title: "Proof sheets", start: none, end: none, press: none, state: variant("estimated", null), sheets: 2000.0, customer: "Alder & Finch", stock: variant("uncoated", null), due: none }],
    ]),
    indexes: (index) => ({
        // The rail narrows each record through its own indexes (#1344): the jobs and the shifts over their interval
        // indexes — on their own, and after a job's stock — so a narrowing keeps every event overlapping the window once;
        // the customers by district, and each templates record by its group.
        plan_print_jobs_by_time: index.interval({ from: "start", to: "end" }),
        plan_print_jobs_by_stock_time: index.interval({ on: ["stock"], from: "start", to: "end" }),
        // The jobs' totals a day, a week, a month, a quarter and a year (#1732), on their own and by their stock: what the horizon's bars
        // read at the period that fits the strip — by the stock the rail chooses, where it chooses one — never counting jobs.
        plan_print_jobs_day_totals: index.totals({ from: "start", to: "end", tile: "day" }),
        plan_print_jobs_week_totals: index.totals({ from: "start", to: "end", tile: "week" }),
        plan_print_jobs_month_totals: index.totals({ from: "start", to: "end", tile: "month" }),
        plan_print_jobs_quarter_totals: index.totals({ from: "start", to: "end", tile: "quarter" }),
        plan_print_jobs_year_totals: index.totals({ from: "start", to: "end", tile: "year" }),
        plan_print_jobs_by_stock_day_totals: index.totals({ on: ["stock"], from: "start", to: "end", tile: "day" }),
        plan_print_jobs_by_stock_week_totals: index.totals({ on: ["stock"], from: "start", to: "end", tile: "week" }),
        plan_print_jobs_by_stock_month_totals: index.totals({ on: ["stock"], from: "start", to: "end", tile: "month" }),
        plan_print_jobs_by_stock_quarter_totals: index.totals({ on: ["stock"], from: "start", to: "end", tile: "quarter" }),
        plan_print_jobs_by_stock_year_totals: index.totals({ on: ["stock"], from: "start", to: "end", tile: "year" }),
    }),
    mutations: (mutation) => ({
        // The jobs' patch door: every Save commits through it.
        patch: mutation.patch(),
    }),
});


/** The stops: plate changes and services across the presses. */
export const planPrintStops = e3.record("plan_print_stops", DictType(StringType, PrintStop), {
    initial: new Map([
        ["S-01", { title: "Plate change", at: new Date("2026-10-07T12:00:00Z"), press: "a1", kind: variant("plate_change", null) }],
        ["S-02", { title: "Service", at: new Date("2026-10-12T04:00:00Z"), press: "b1", kind: variant("service", null) }],
        ["S-03", { title: "Plate change", at: new Date("2026-10-14T12:00:00Z"), press: "a2", kind: variant("plate_change", null) }],
        ["S-04", { title: "Plate change", at: new Date("2026-10-19T18:00:00Z"), press: "a1", kind: variant("plate_change", null) }],
        ["S-05", { title: "Service", at: new Date("2026-10-26T14:00:00Z"), press: "a3", kind: variant("service", null) }],
        ["S-06", { title: "Plate change", at: new Date("2026-10-28T10:00:00Z"), press: "b2", kind: variant("plate_change", null) }],
    ]),
    mutations: (mutation) => ({
        // The stops' patch door.
        patch: mutation.patch(),
    }),
});


/** The shifts: each crew's early and late shifts, confirmed for the first two weeks and proposed for the last two. */
export const planPrintShifts = e3.record("plan_print_shifts", DictType(StringType, PrintShift), {
    initial: new Map([
        ["SH-01", { title: "Early", start: new Date("2026-10-05T06:00:00Z"), end: new Date("2026-10-05T14:00:00Z"), crew: "c1", state: variant("confirmed", null) }],
        ["SH-02", { title: "Early", start: new Date("2026-10-07T06:00:00Z"), end: new Date("2026-10-07T14:00:00Z"), crew: "c1", state: variant("confirmed", null) }],
        ["SH-03", { title: "Late", start: new Date("2026-10-13T14:00:00Z"), end: new Date("2026-10-13T22:00:00Z"), crew: "c1", state: variant("confirmed", null) }],
        ["SH-04", { title: "Late", start: new Date("2026-10-15T14:00:00Z"), end: new Date("2026-10-15T22:00:00Z"), crew: "c1", state: variant("confirmed", null) }],
        ["SH-05", { title: "Early", start: new Date("2026-10-19T06:00:00Z"), end: new Date("2026-10-19T14:00:00Z"), crew: "c1", state: variant("proposed", variant("recommended", null)) }],
        ["SH-06", { title: "Early", start: new Date("2026-10-26T06:00:00Z"), end: new Date("2026-10-26T14:00:00Z"), crew: "c1", state: variant("proposed", variant("recommended", null)) }],
        ["SH-07", { title: "Late", start: new Date("2026-10-05T14:00:00Z"), end: new Date("2026-10-05T22:00:00Z"), crew: "c2", state: variant("confirmed", null) }],
        ["SH-08", { title: "Late", start: new Date("2026-10-07T14:00:00Z"), end: new Date("2026-10-07T22:00:00Z"), crew: "c2", state: variant("confirmed", null) }],
        ["SH-09", { title: "Early", start: new Date("2026-10-13T06:00:00Z"), end: new Date("2026-10-13T14:00:00Z"), crew: "c2", state: variant("confirmed", null) }],
        ["SH-10", { title: "Early", start: new Date("2026-10-15T06:00:00Z"), end: new Date("2026-10-15T14:00:00Z"), crew: "c2", state: variant("confirmed", null) }],
        ["SH-11", { title: "Late", start: new Date("2026-10-19T14:00:00Z"), end: new Date("2026-10-19T22:00:00Z"), crew: "c2", state: variant("proposed", variant("recommended", null)) }],
        ["SH-12", { title: "Late", start: new Date("2026-10-26T14:00:00Z"), end: new Date("2026-10-26T22:00:00Z"), crew: "c2", state: variant("proposed", variant("recommended", null)) }],
        ["SH-13", { title: "Early", start: new Date("2026-10-06T06:00:00Z"), end: new Date("2026-10-06T14:00:00Z"), crew: "c3", state: variant("confirmed", null) }],
        ["SH-14", { title: "Early", start: new Date("2026-10-08T06:00:00Z"), end: new Date("2026-10-08T14:00:00Z"), crew: "c3", state: variant("confirmed", null) }],
        ["SH-15", { title: "Late", start: new Date("2026-10-12T14:00:00Z"), end: new Date("2026-10-12T22:00:00Z"), crew: "c3", state: variant("confirmed", null) }],
        ["SH-16", { title: "Late", start: new Date("2026-10-14T14:00:00Z"), end: new Date("2026-10-14T22:00:00Z"), crew: "c3", state: variant("confirmed", null) }],
        ["SH-17", { title: "Early", start: new Date("2026-10-20T06:00:00Z"), end: new Date("2026-10-20T14:00:00Z"), crew: "c3", state: variant("proposed", variant("recommended", null)) }],
        ["SH-18", { title: "Early", start: new Date("2026-10-27T06:00:00Z"), end: new Date("2026-10-27T14:00:00Z"), crew: "c3", state: variant("proposed", variant("added", null)) }],
        ["SH-19", { title: "Late", start: new Date("2026-10-06T14:00:00Z"), end: new Date("2026-10-06T22:00:00Z"), crew: "c4", state: variant("confirmed", null) }],
        ["SH-20", { title: "Late", start: new Date("2026-10-08T14:00:00Z"), end: new Date("2026-10-08T22:00:00Z"), crew: "c4", state: variant("confirmed", null) }],
        ["SH-21", { title: "Early", start: new Date("2026-10-12T06:00:00Z"), end: new Date("2026-10-12T14:00:00Z"), crew: "c4", state: variant("confirmed", null) }],
        ["SH-22", { title: "Early", start: new Date("2026-10-14T06:00:00Z"), end: new Date("2026-10-14T14:00:00Z"), crew: "c4", state: variant("confirmed", null) }],
        ["SH-23", { title: "Late", start: new Date("2026-10-20T14:00:00Z"), end: new Date("2026-10-20T22:00:00Z"), crew: "c4", state: variant("proposed", variant("recommended", null)) }],
        ["SH-24", { title: "Late", start: new Date("2026-10-27T14:00:00Z"), end: new Date("2026-10-27T22:00:00Z"), crew: "c4", state: variant("proposed", variant("added", null)) }],
    ]),
    indexes: (index) => ({
        plan_print_shifts_by_time: index.interval({ from: "start", to: "end" }),
        // The shifts' totals a day, a week, a month, a quarter and a year (#1732): what the horizon's bars read.
        plan_print_shifts_day_totals: index.totals({ from: "start", to: "end", tile: "day" }),
        plan_print_shifts_week_totals: index.totals({ from: "start", to: "end", tile: "week" }),
        plan_print_shifts_month_totals: index.totals({ from: "start", to: "end", tile: "month" }),
        plan_print_shifts_quarter_totals: index.totals({ from: "start", to: "end", tile: "quarter" }),
        plan_print_shifts_year_totals: index.totals({ from: "start", to: "end", tile: "year" }),
    }),
    mutations: (mutation) => ({
        // The shifts' patch door.
        patch: mutation.patch(),
    }),
});


/** A crew roster the works has locked for the week: Crew 1's two early shifts. */
export const planLockedShifts = e3.record("plan_locked_shifts", DictType(StringType, PrintShift), {
    initial: new Map([
        ["SH-01", { title: "Early", start: new Date("2026-10-05T06:00:00Z"), end: new Date("2026-10-05T14:00:00Z"), crew: "c1", state: variant("confirmed", null) }],
        ["SH-02", { title: "Early", start: new Date("2026-10-07T06:00:00Z"), end: new Date("2026-10-07T14:00:00Z"), crew: "c1", state: variant("confirmed", null) }],
    ]),
    mutations: (mutation) => ({
        // The locked roster's patch door, a checked one: it takes any change to a
        // shift, and refuses one that takes a shift off the roster, naming why — what
        // a Save that deletes one is answered.
        patch: mutation.reduce(East.function([DictType(StringType, PrintShift), PatchType(DictType(StringType, PrintShift))], DictType(StringType, PrintShift), ($, roster, patch) => {
            const next = $.let(East.applyPatch(roster, patch));
            $.for(roster, ($2, _shift, key) => {
                $2.if(next.has(key).not(), ($3) => { $3.error("the crew roster is locked for the week"); });
            });
            return next;
        })),
    }),
});


/** The customers the jobs are printed for, by account, in three districts: what the print works' library lists. A Plan never writes them. */
export const planPrintCustomers = e3.record("plan_print_customers", DictType(StringType, PrintCustomer), {
    initial: new Map([
        ["alder-finch", { name: "Alder & Finch", district: "Old Town", trade: "Retail" }],
        ["bluewater-tours", { name: "Bluewater Tours", district: "North Quay", trade: "Travel" }],
        ["copperleaf-cafe", { name: "Copperleaf Cafe", district: "Old Town", trade: "Hospitality" }],
        ["driftwood-museum", { name: "Driftwood Museum", district: "North Quay", trade: "Arts" }],
        ["elmway-college", { name: "Elmway College", district: "Riverside", trade: "Education" }],
        ["foxglove-gardens", { name: "Foxglove Gardens", district: "Riverside", trade: "Retail" }],
        ["granite-hall", { name: "Granite Hall", district: "Old Town", trade: "Events" }],
        ["harbour-arts", { name: "Harbour Arts Society", district: "North Quay", trade: "Arts" }],
        ["heathfield", { name: "Heathfield Theatre", district: "Old Town", trade: "Arts" }],
        ["ivy-lane", { name: "Ivy Lane Studio", district: "Riverside", trade: "Design" }],
        ["juniper-toys", { name: "Juniper Toys", district: "Riverside", trade: "Retail" }],
        ["kestrel-cycling", { name: "Kestrel Cycling Club", district: "Riverside", trade: "Sport" }],
        ["larkspur-home", { name: "Larkspur Home", district: "Old Town", trade: "Retail" }],
        ["meridian-monthly", { name: "Meridian Monthly", district: "North Quay", trade: "Publishing" }],
        ["northwind", { name: "Northwind Outfitters", district: "North Quay", trade: "Retail" }],
        ["orchard-market", { name: "Orchard Street Market", district: "Old Town", trade: "Markets" }],
    ]),
    indexes: (index) => ({
        plan_print_customers_by_district: index.on(["district"]),
    }),
    mutations: (mutation) => ({
        // The customers' patch door: the works edits its customers elsewhere, and a Plan reads them live.
        patch: mutation.patch(),
    }),
});


/**
 * Each press's utilisation (%): a reading a day from 5 October, as the
 * dataflow measures it, idle at the weekends. Press B2's 97 on the 20th is
 * the day its two jobs overlap.
 */
export const planPrintUtilisation = e3.input("plan_print_utilisation", DictType(StringType, ArrayType(FloatType)), variant("value", new Map([
    ["a1", [50.0, 12.0, 38.0, 20.0, 15.0, 0.0, 0.0, 22.0, 18.0, 31.0, 25.0, 20.0, 0.0, 0.0, 75.0, 40.0, 30.0, 28.0, 20.0, 0.0, 0.0, 18.0, 13.0, 10.0, 8.0, 6.0, 0.0, 0.0]],
    ["a2", [20.0, 50.0, 25.0, 18.0, 15.0, 0.0, 0.0, 24.0, 20.0, 38.0, 30.0, 22.0, 0.0, 0.0, 26.0, 30.0, 63.0, 35.0, 22.0, 0.0, 0.0, 20.0, 18.0, 19.0, 12.0, 10.0, 0.0, 0.0]],
    ["a3", [10.0, 12.0, 14.0, 13.0, 18.0, 0.0, 0.0, 15.0, 16.0, 20.0, 19.0, 22.0, 0.0, 0.0, 24.0, 28.0, 30.0, 38.0, 25.0, 0.0, 0.0, 14.0, 20.0, 12.0, 10.0, 8.0, 0.0, 0.0]],
    ["b1", [100.0, 45.0, 30.0, 28.0, 26.0, 0.0, 0.0, 75.0, 40.0, 63.0, 48.0, 36.0, 0.0, 0.0, 30.0, 34.0, 28.0, 26.0, 24.0, 0.0, 0.0, 38.0, 22.0, 18.0, 14.0, 12.0, 0.0, 0.0]],
    ["b2", [18.0, 20.0, 22.0, 24.0, 25.0, 0.0, 0.0, 26.0, 28.0, 30.0, 32.0, 30.0, 0.0, 0.0, 34.0, 97.0, 40.0, 36.0, 30.0, 0.0, 0.0, 26.0, 24.0, 22.0, 13.0, 10.0, 0.0, 0.0]],
    ["b3", [8.0, 10.0, 12.0, 10.0, 9.0, 0.0, 0.0, 12.0, 14.0, 16.0, 18.0, 13.0, 0.0, 0.0, 20.0, 19.0, 16.0, 14.0, 12.0, 0.0, 0.0, 10.0, 9.0, 8.0, 7.0, 6.0, 0.0, 0.0]],
])));

/** The sheets printed each day from 5 October, across every press. */
export const planPrintOutput = e3.input("plan_print_output", ArrayType(FloatType), variant("value", [
    336000.0, 80000.0, 72000.0, 16000.0, 48000.0, 0.0, 0.0,
    180000.0, 0.0, 270000.0, 24000.0, 12000.0, 0.0, 0.0,
    144000.0, 126000.0, 100000.0, 48000.0, 0.0, 0.0, 0.0,
    90000.0, 24000.0, 30000.0, 24000.0, 0.0, 0.0, 0.0,
]));

// ============================================================================
// planEvents — the smallest builder (§3.2)
// ============================================================================

/**
 * The smallest builder's orders to plan, a record of its own: three, each a
 * card of its Orders tab, which makes a job on the press it is dropped on.
 */
export const planEventOrders = e3.record("plan_event_orders", DictType(StringType, PrintOrder), {
    initial: new Map([
        ["O-501", { title: "Market flyers", customer: "Orchard Street Market", sheets: 16000.0 }],
        ["O-502", { title: "Season programme", customer: "Heathfield Theatre", sheets: 48000.0 }],
        ["O-503", { title: "Trail maps", customer: "Kestrel Cycling Club", sheets: 24000.0 }],
    ]),
    mutations: (mutation) => ({
        // The orders' patch door: the works takes its orders elsewhere, and a Plan reads them live.
        patch: mutation.patch(),
    }),
});

/**
 * The smallest builder's jobs, a record of its own: eight on the presses, two
 * of them overlapping on Press B2 on the 20th; one timed and given no press
 * yet; and three with no start waiting in the backlog, due this week, next
 * week and never.
 */
export const planEventJobs = e3.record("plan_event_jobs", DictType(StringType, PrintJob), {
    initial: new Map([
        ["J-3001", { title: "Spring catalogue", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T14:00:00Z")), press: some("a1"), state: variant("actual", null), sheets: 96000.0, customer: "Alder & Finch", stock: variant("coated", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
        ["J-3002", { title: "Course handbook", start: some(new Date("2026-10-19T06:00:00Z")), end: some(new Date("2026-10-19T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
        ["J-3003", { title: "Annual report", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T12:00:00Z")), press: some("a2"), state: variant("in-progress", null), sheets: 60000.0, customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
        ["J-3004", { title: "Club newsletter", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T08:00:00Z")), press: some("a3"), state: variant("actual", null), sheets: 16000.0, customer: "Kestrel Cycling Club", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
        ["J-3005", { title: "Store flyers", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-15T16:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 150000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
        ["J-3006", { title: "Market posters", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T12:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 72000.0, customer: "Orchard Street Market", stock: variant("coated", null), due: some(new Date("2026-10-22T00:00:00Z")) }],
        ["J-3007", { title: "Loyalty cards", start: some(new Date("2026-10-20T10:00:00Z")), end: some(new Date("2026-10-20T13:00:00Z")), press: some("b2"), state: variant("proposed", variant("added", null)), sheets: 36000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
        ["J-3008", { title: "Gift boxes", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T12:00:00Z")), press: some("b3"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
        ["J-3009", { title: "Ticket books", start: some(new Date("2026-10-22T06:00:00Z")), end: some(new Date("2026-10-22T09:00:00Z")), press: none, state: variant("proposed", variant("added", null)), sheets: 24000.0, customer: "Heathfield Theatre", stock: variant("uncoated", null), due: some(new Date("2026-10-26T00:00:00Z")) }],
        ["J-3010", { title: "Guide reprint", start: none, end: none, press: none, state: variant("estimated", null), sheets: 24000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
        ["J-3011", { title: "Wall calendars", start: none, end: none, press: none, state: variant("estimated", null), sheets: 50000.0, customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
        ["J-3012", { title: "Spare covers", start: none, end: none, press: none, state: variant("estimated", null), sheets: 8000.0, customer: "Meridian Monthly", stock: variant("board", null), due: none }],
    ]),
    indexes: (index) => ({
        // The jobs over their interval index: what the print works' optimiser reads the window's jobs and the backlog through (#1622).
        plan_event_jobs_by_time: index.interval({ from: "start", to: "end" }),
    }),
    mutations: (mutation) => ({
        // The smallest builder's jobs' patch door: its Save commits through it.
        patch: mutation.patch(),
    }),
});


/**
 * The smallest builder (`Plan Builder Spec.md` §3.2): a row per press, each
 * job a bar on its press, the jobs a record of the example's own. Jobs move
 * and resize along a press and between presses, and Save commits the drafts
 * as one patch through the jobs' patch door. Its library lists the backlog,
 * the jobs with no start by when each is due; the orders to plan, a card
 * apiece that makes a job on the press it is dropped on, as a template would
 * (a tab's `create`); and the customers, a card apiece that sets the customer
 * of the job it is dropped on (`Schedule.patch`). Its inspector shows what is selected: a job through the
 * form its customer and stock are hinted for. Press B2's two jobs on the 20th
 * overlap, and the toolbar's chip counts them; a job timed on no press draws
 * on the jobs' Unassigned row. Its `id` keeps its panes and its library's
 * cards apart from the print works' on the same surface. The two `Schedule`
 * values are exactly what a Calendar takes.
 */
export const planEvents = example({
    keywords: [
        "Plan", "Schedule", "Plan.series.resources", "Schedule.events", "Schedule.field", "event kinds", "events", "resources",
        "rows", "jobs", "presses", "bars", "state", "backlog", "duration", "due", "fields", "library", "Plan.library",
        "Plan.library.backlog", "Plan.library.tab", "customers", "drop", "Schedule.patch", "orders", "create", "inspector", "overlaps",
        "Unassigned", "id", "record", "Record.bind", "e3.record", "mutation.patch", "patch", "smallest", "builder",
        "#1191", "#1195", "#1197", "#1198",
    ],
    description: "The smallest builder — the presses as its rows (`Plan.series.resources` over their record) and the print jobs as bars on them (`Schedule.events`), a record of its own bound with its patch mutation; its library the backlog and the customers, each card setting the customer of the job it is dropped on (`Schedule.patch`); its inspector a job's customer and stock; an overlap on Press B2, and a job on no press on the Unassigned row",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(planPrintPresses, []));
            const jobs = $.let(Record.bind(planEventJobs));
            const customers = $.let(Record.bind(planPrintCustomers, []));
            const orders = $.let(Record.bind(planEventOrders, []));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                resolution: "day", now: new Date("2026-10-14T09:00:00Z"),
            }));
            return (
                <Plan
                    id="jobs"
                    axis={axis}
                    // The presses are its rows: each a landing row its jobs land on, by `press`.
                    data={presses.read()}
                    series={[Plan.series.resources(PrintPress, { key: "presses", title: "Presses", icon: "print", label: p => p.name })]}
                    events={{
                        job: Schedule.events(jobs, {
                            name: "Print job", icon: "file-lines",
                            title: "title", start: "start", end: "end",
                            resource: { field: "press", of: "presses" },
                            state: "state",
                            // A job with no start waits in the backlog: placed, it runs as long as its sheets take at
                            // 8,000 an hour.
                            backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                            fields: {
                                customer: Schedule.field.text({ label: "Customer" }),
                                stock: Schedule.field.select({ labels: { coated: "Coated", uncoated: "Uncoated", board: "Board" } }),
                            },
                        }),
                    }}
                    library={[
                        Plan.library.backlog(),
                        // The orders to plan, by customer: a card dropped on a press makes a job there, as a
                        // template would, running as long as its sheets take at 8,000 an hour.
                        Plan.library.tab(orders.read(), {
                            name: "Orders", icon: "inbox",
                            label: o => o.title, group: o => o.customer,
                            create: {
                                kind: "job",
                                duration: o => variant("hours", o.sheets.divide(8000.0)),
                                values: o => ({
                                    title: o.title, customer: o.customer, sheets: o.sheets,
                                    state: variant("proposed", variant("added", null)), stock: variant("coated", null), due: none,
                                }),
                            },
                        }),
                        // The customers, by district: a card dropped on a job sets its customer.
                        Plan.library.tab(customers.read(), {
                            name: "Customers", icon: "building",
                            label: c => c.name, meta: c => some(c.trade), group: c => c.district,
                            drop: c => Schedule.patch(PrintJob, { customer: c.name }),
                        }),
                    ]}
                    inspector
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const planWording = example({
    keywords: ["Plan", "vocabulary", "Unassigned", "backlog", "tabs", "due", "state", "words", "#1516"],
    description: "A print works' plan in its own words (#1516): `vocabulary` names the row of jobs on no press, the tabs, the waiting jobs' groups and a job's states, wherever the Plan draws them, each keeping the Plan's word where left out.",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(planPrintPresses, []));
            const jobs = $.let(Record.bind(planEventJobs));
            const customers = $.let(Record.bind(planPrintCustomers, []));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                resolution: "day", now: new Date("2026-10-14T09:00:00Z"),
            }));
            return (
                <Plan
                    id="wording"
                    vocabulary={{
                        unassigned: "Unplaced", backlog: "Waiting", series: "Layers", groups: "Hall", rows: { one: "Press", other: "Presses" }, measures: "Figure",
                        dueThisWeek: "This week's jobs", dueNextWeek: "Next week's jobs", later: "After that", noDate: "Undated",
                        estimated: "pencilled", proposed: "suggested", confirmed: "locked", inProgress: "on press", actual: "run",
                    }}
                    axis={axis}
                    // The presses are its rows: each a landing row its jobs land on, by `press`.
                    data={presses.read()}
                    series={[Plan.series.resources(PrintPress, { key: "presses", title: "Presses", icon: "print", label: p => p.name })]}
                    events={{
                        job: Schedule.events(jobs, {
                            name: "Print job", icon: "file-lines",
                            title: "title", start: "start", end: "end",
                            resource: { field: "press", of: "presses" },
                            state: "state",
                            // A job with no start waits: placed, it runs as long as its sheets take at
                            // 8,000 an hour.
                            backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                            fields: {
                                customer: Schedule.field.text({ label: "Customer" }),
                                stock: Schedule.field.select({ labels: { coated: "Coated", uncoated: "Uncoated", board: "Board" } }),
                            },
                        }),
                    }}
                    library={[
                        Plan.library.backlog(),
                        Plan.library.series(),
                        // The customers, by district: a card dropped on a job sets its customer.
                        Plan.library.tab(customers.read(), {
                            name: "Customers", icon: "building",
                            label: c => c.name, meta: c => some(c.trade), group: c => c.district,
                            drop: c => Schedule.patch(PrintJob, { customer: c.name }),
                        }),
                    ]}
                    inspector
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planEventLinks — every way a link draws, and rows over a dataset
// ============================================================================

/** A paper stock: its name, and its level in thousands of sheets, a reading a week keyed by its week (#1436). */
export const PrintStock = StructType({ name: StringType, weekly: DictType(DateTimeType, FloatType) });

/** Four jobs on the print works' presses — the covers and the sleeves on Press B3, and the handbooks and the boxes they go into on Press A1 — which the Plan's specs read as a second kind of job. */
export const planLinkJobs = e3.record("plan_link_jobs", DictType(StringType, PrintJob), {
    initial: new Map([
        ["J-2001", { title: "Handbook covers", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T08:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 12000.0, customer: "Elmway College", stock: variant("board", null), due: some(new Date("2026-10-07T00:00:00Z")) }],
        ["J-2002", { title: "Course handbook", start: some(new Date("2026-10-13T06:00:00Z")), end: some(new Date("2026-10-13T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
        ["J-2003", { title: "Box sleeves", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T09:00:00Z")), press: some("b3"), state: variant("proposed", variant("recommended", null)), sheets: 18000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-21T00:00:00Z")) }],
        ["J-2004", { title: "Gift boxes", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T12:00:00Z")), press: some("a1"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
    ]),
    mutations: (mutation) => ({
        // The linked jobs' patch door.
        patch: mutation.patch(),
    }),
});


/** The paper in stock. */
export const planLinkStock = e3.input("plan_link_stock", DictType(StringType, PrintStock), variant("value", new Map([
    ["board", { name: "Board", weekly: new SortedMap([
        [new Date("2026-10-05T00:00:00Z"), 40.0], [new Date("2026-10-12T00:00:00Z"), 22.0], [new Date("2026-10-19T00:00:00Z"), 31.0], [new Date("2026-10-26T00:00:00Z"), 18.0],
    ], compareFor(DateTimeType)) }],
    ["coated", { name: "Coated", weekly: new SortedMap([
        [new Date("2026-10-05T00:00:00Z"), 520.0], [new Date("2026-10-12T00:00:00Z"), 410.0], [new Date("2026-10-19T00:00:00Z"), 460.0], [new Date("2026-10-26T00:00:00Z"), 380.0],
    ], compareFor(DateTimeType)) }],
    ["uncoated", { name: "Uncoated", weekly: new SortedMap([
        [new Date("2026-10-05T00:00:00Z"), 300.0], [new Date("2026-10-12T00:00:00Z"), 260.0], [new Date("2026-10-19T00:00:00Z"), 280.0], [new Date("2026-10-26T00:00:00Z"), 240.0],
    ], compareFor(DateTimeType)) }],
])));

/** A set of plates the platesetter makes for a job, at the moment it makes them. */
export const PrintPlates = StructType({ title: StringType, at: DateTimeType, setter: StringType });

/** A bindery job — folding a press job's sections, or binding them — on the folder or the binder. */
export const PrintBinding = StructType({ title: StringType, start: DateTimeType, end: DateTimeType, line: StringType, state: EventStateType });

/** A delivery leaving the dispatch bay. */
export const PrintDelivery = StructType({ title: StringType, at: DateTimeType, bay: StringType });

/** A work centre of the links' works, and which kind it is: the platesetter, a press in its hall, a bindery line, the dispatch bay. */
export const PrintLinkCentre = StructType({
    name: StringType,
    what: VariantType({ setter: NullType, press: StructType({ hall: StringType }), line: NullType, bay: NullType }),
});

/**
 * The links' works as one record of rows (#1541): the platesetter, the six
 * presses, the bindery's two lines and the dispatch bay, each by the key its
 * events name it by, and which kind of centre it is.
 */
export const planLinkWorks = e3.record("plan_link_works", DictType(StringType, PrintLinkCentre), {
    initial: new Map([
        ["ps", { name: "Platesetter", what: variant("setter", null) }],
        ["a1", { name: "Press A1", what: variant("press", { hall: "Hall A" }) }],
        ["a2", { name: "Press A2", what: variant("press", { hall: "Hall A" }) }],
        ["a3", { name: "Press A3", what: variant("press", { hall: "Hall A" }) }],
        ["b1", { name: "Press B1", what: variant("press", { hall: "Hall B" }) }],
        ["b2", { name: "Press B2", what: variant("press", { hall: "Hall B" }) }],
        ["b3", { name: "Press B3", what: variant("press", { hall: "Hall B" }) }],
        ["fold", { name: "Folder", what: variant("line", null) }],
        ["bind", { name: "Binder", what: variant("line", null) }],
        ["bay", { name: "Dispatch bay", what: variant("bay", null) }],
    ]),
});

/** The plates for the catalogue covers, made on the window's first day. */
export const planLinkPlates = e3.record("plan_link_plates", DictType(StringType, PrintPlates), {
    initial: new Map([
        ["P-01", { title: "Catalogue plates", at: new Date("2026-10-05T12:00:00Z"), setter: "ps" }],
    ]),
    mutations: (mutation) => ({
        // The plates' patch door.
        patch: mutation.patch(),
    }),
});


/**
 * The jobs the links join, on the six presses. Each link's jobs sit where its
 * figure needs them: a job of two hours, which draws the narrowest bar; a job
 * running in from before the window; one that ends before it starts, and one
 * that starts after it ends; two jobs back to back on one press.
 */
export const planLinkCaseJobs = e3.record("plan_link_case_jobs", DictType(StringType, PrintJob), {
    initial: new Map([
        ["J-2001", { title: "Catalogue covers", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T08:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 12000.0, customer: "Larkspur Home", stock: variant("board", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
        ["J-2002", { title: "Shop posters", start: some(new Date("2026-10-10T06:00:00Z")), end: some(new Date("2026-10-11T06:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 24000.0, customer: "Orchard Street Market", stock: variant("uncoated", null), due: some(new Date("2026-10-20T00:00:00Z")) }],
        ["J-2003", { title: "Catalogue inserts", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-17T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 96000.0, customer: "Larkspur Home", stock: variant("coated", null), due: some(new Date("2026-10-19T00:00:00Z")) }],
        ["J-2004", { title: "Price lists", start: some(new Date("2026-10-07T12:00:00Z")), end: some(new Date("2026-10-08T18:00:00Z")), press: some("a2"), state: variant("confirmed", null), sheets: 16000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
        ["J-2005", { title: "Menu cards", start: some(new Date("2026-10-11T06:00:00Z")), end: some(new Date("2026-10-11T18:00:00Z")), press: some("a2"), state: variant("confirmed", null), sheets: 30000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-13T00:00:00Z")) }],
        ["J-2006", { title: "Gift tags", start: some(new Date("2026-10-25T06:00:00Z")), end: some(new Date("2026-10-25T18:00:00Z")), press: some("a2"), state: variant("proposed", variant("recommended", null)), sheets: 20000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-28T00:00:00Z")) }],
        ["J-2007", { title: "Gift boxes", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T14:00:00Z")), press: some("a2"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
        ["J-2008", { title: "Proof run", start: some(new Date("2026-10-02T06:00:00Z")), end: some(new Date("2026-10-05T18:00:00Z")), press: some("a3"), state: variant("actual", null), sheets: 16000.0, customer: "Meridian Monthly", stock: variant("coated", null), due: some(new Date("2026-10-06T00:00:00Z")) }],
        ["J-2009", { title: "Annual report", start: some(new Date("2026-10-19T18:00:00Z")), end: some(new Date("2026-10-21T06:00:00Z")), press: some("a3"), state: variant("confirmed", null), sheets: 48000.0, customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
        ["J-2010", { title: "Desk calendars", start: some(new Date("2026-10-28T06:00:00Z")), end: some(new Date("2026-10-29T06:00:00Z")), press: some("a3"), state: variant("proposed", variant("added", null)), sheets: 36000.0, customer: "Foxglove Gardens", stock: variant("board", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
        ["J-2011", { title: "Calendar pads", start: some(new Date("2026-10-29T06:00:00Z")), end: some(new Date("2026-10-30T18:00:00Z")), press: some("a3"), state: variant("proposed", variant("added", null)), sheets: 72000.0, customer: "Foxglove Gardens", stock: variant("uncoated", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
        ["J-2012", { title: "Proof sheets", start: some(new Date("2026-09-28T06:00:00Z")), end: some(new Date("2026-09-30T18:00:00Z")), press: some("b1"), state: variant("actual", null), sheets: 8000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-01T00:00:00Z")) }],
        ["J-2013", { title: "Catalogue", start: some(new Date("2026-10-12T06:00:00Z")), end: some(new Date("2026-10-13T18:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Larkspur Home", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
        ["J-2014", { title: "Seed catalogue", start: some(new Date("2026-10-22T06:00:00Z")), end: some(new Date("2026-10-23T12:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 100000.0, customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-26T00:00:00Z")) }],
        ["J-2015", { title: "Night run", start: some(new Date("2026-10-05T00:00:00Z")), end: some(new Date("2026-10-05T08:00:00Z")), press: some("b2"), state: variant("actual", null), sheets: 16000.0, customer: "Meridian Monthly", stock: variant("coated", null), due: some(new Date("2026-10-06T00:00:00Z")) }],
        ["J-2016", { title: "Store flyers", start: some(new Date("2026-10-16T06:00:00Z")), end: some(new Date("2026-10-16T20:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 96000.0, customer: "Larkspur Home", stock: variant("uncoated", null), due: some(new Date("2026-10-19T00:00:00Z")) }],
        ["J-2017", { title: "Seed packets", start: some(new Date("2026-10-23T06:00:00Z")), end: some(new Date("2026-10-24T06:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 72000.0, customer: "Foxglove Gardens", stock: variant("board", null), due: some(new Date("2026-10-27T00:00:00Z")) }],
        ["J-2018", { title: "Exhibition book", start: some(new Date("2026-10-26T06:00:00Z")), end: some(new Date("2026-10-27T18:00:00Z")), press: some("b2"), state: variant("proposed", variant("recommended", null)), sheets: 54000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
        ["J-2019", { title: "Ticket books", start: some(new Date("2026-10-29T06:00:00Z")), end: some(new Date("2026-10-30T06:00:00Z")), press: some("b2"), state: variant("estimated", null), sheets: 60000.0, customer: "Heathfield Theatre", stock: variant("uncoated", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
        ["J-2020", { title: "Card stock", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T14:00:00Z")), press: some("b3"), state: variant("actual", null), sheets: 30000.0, customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
        ["J-2021", { title: "Book sections", start: some(new Date("2026-10-11T06:00:00Z")), end: some(new Date("2026-10-12T12:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 84000.0, customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-14T00:00:00Z")) }],
        ["J-2022", { title: "Report covers", start: some(new Date("2026-10-19T06:00:00Z")), end: some(new Date("2026-10-20T18:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 48000.0, customer: "Harbour Arts Society", stock: variant("board", null), due: some(new Date("2026-10-21T00:00:00Z")) }],
        ["J-2023", { title: "Spring brochure", start: some(new Date("2026-11-03T06:00:00Z")), end: some(new Date("2026-11-04T18:00:00Z")), press: some("b3"), state: variant("estimated", null), sheets: 60000.0, customer: "Heathfield Theatre", stock: variant("coated", null), due: some(new Date("2026-11-09T00:00:00Z")) }],
    ]),
    mutations: (mutation) => ({
        // The jobs' patch door.
        patch: mutation.patch(),
    }),
});


/** The bindery's jobs: two foldings of the book's sections, and two bindings. */
export const planLinkBindings = e3.record("plan_link_bindings", DictType(StringType, PrintBinding), {
    initial: new Map([
        ["B-01", { title: "Fold sections", start: new Date("2026-10-15T06:00:00Z"), end: new Date("2026-10-16T06:00:00Z"), line: "fold", state: variant("confirmed", null) }],
        ["B-02", { title: "Fold sections", start: new Date("2026-10-17T06:00:00Z"), end: new Date("2026-10-18T06:00:00Z"), line: "fold", state: variant("confirmed", null) }],
        ["B-03", { title: "Bind books", start: new Date("2026-10-20T18:00:00Z"), end: new Date("2026-10-21T18:00:00Z"), line: "bind", state: variant("confirmed", null) }],
        ["B-04", { title: "Bind exhibition book", start: new Date("2026-10-25T06:00:00Z"), end: new Date("2026-10-26T06:00:00Z"), line: "bind", state: variant("proposed", variant("recommended", null)) }],
    ]),
    mutations: (mutation) => ({
        // The bindery's patch door.
        patch: mutation.patch(),
    }),
});


/** The deliveries: the shop posters in the third week, the bound books in the fourth. */
export const planLinkDeliveries = e3.record("plan_link_deliveries", DictType(StringType, PrintDelivery), {
    initial: new Map([
        ["D-01", { title: "Books", at: new Date("2026-10-28T10:00:00Z"), bay: "bay" }],
        ["D-02", { title: "Posters", at: new Date("2026-10-20T10:00:00Z"), bay: "bay" }],
    ]),
    mutations: (mutation) => ({
        // The deliveries' patch door.
        patch: mutation.patch(),
    }),
});

/**
 * One flow of work through the print works: from the plates, a print job or a
 * bindery job, into a print job, a bindery job or a delivery — each end the
 * key of the event it names — and the sheets it moves, in thousands, where it
 * moves any.
 */
export const PrintFlow = StructType({
    from: VariantType({ plate: StringType, job: StringType, binding: StringType }),
    to: VariantType({ job: StringType, binding: StringType, delivery: StringType }),
    sheets: OptionType(FloatType),
});

/** The works' flows, a record of their own: seventeen, one for each way a link draws. */
export const planLinkFlows = e3.record("plan_link_flows", DictType(StringType, PrintFlow), {
    initial: new Map([
        ["plates", { from: variant("plate", "P-01"), to: variant("job", "J-2001"), sheets: none }],
        ["covers", { from: variant("job", "J-2001"), to: variant("job", "J-2013"), sheets: some(12.0) }],
        ["card", { from: variant("job", "J-2020"), to: variant("job", "J-2005"), sheets: some(30.0) }],
        ["inserts", { from: variant("job", "J-2003"), to: variant("job", "J-2016"), sheets: some(96.0) }],
        ["report-covers", { from: variant("job", "J-2022"), to: variant("job", "J-2009"), sheets: some(48.0) }],
        ["seed-prints", { from: variant("job", "J-2014"), to: variant("job", "J-2017"), sheets: some(72.0) }],
        ["tags", { from: variant("job", "J-2006"), to: variant("job", "J-2007"), sheets: some(20.0) }],
        ["pads", { from: variant("job", "J-2010"), to: variant("job", "J-2011"), sheets: some(36.0) }],
        ["proofs", { from: variant("job", "J-2008"), to: variant("job", "J-2015"), sheets: some(16.0) }],
        ["proof-sheets", { from: variant("job", "J-2012"), to: variant("job", "J-2004"), sheets: some(8.0) }],
        ["tickets", { from: variant("job", "J-2019"), to: variant("job", "J-2023"), sheets: some(60.0) }],
        ["sections", { from: variant("job", "J-2021"), to: variant("binding", "B-01"), sheets: some(40.0) }],
        ["sections-more", { from: variant("job", "J-2021"), to: variant("binding", "B-02"), sheets: some(44.0) }],
        ["folded", { from: variant("binding", "B-02"), to: variant("binding", "B-03"), sheets: some(40.0) }],
        ["books", { from: variant("binding", "B-03"), to: variant("delivery", "D-01"), sheets: some(36.0) }],
        ["posters", { from: variant("job", "J-2002"), to: variant("delivery", "D-02"), sheets: some(24.0) }],
        ["book-blocks", { from: variant("job", "J-2018"), to: variant("binding", "B-04"), sheets: some(54.0) }],
    ]),
    mutations: (mutation) => ({
        // The flows' patch door: a flow drawn with the Connect tool, edited or removed saves through it.
        patch: mutation.patch(),
    }),
});


// ============================================================================
// Jobs of the Plan's specs' own: a kind in lanes, and a resource by its case
// ============================================================================

/** A job in a lane, with a status: one record the Plan's specs draw as tiles, as bars and as marks. */
export const PrintLaneJob = StructType({
    title: StringType,
    start: DateTimeType,
    end: DateTimeType,
    press: OptionType(StringType),
    lane: StringType,
    status: VariantType({ fine: NullType, late: NullType }),
});

/** Three lane jobs in the first week: two on Press A1 in its AM and PM lanes, one late; one late on Press A2. */
export const planRowsLaneJobs = e3.record("plan_rows_lane_jobs", DictType(StringType, PrintLaneJob), {
    initial: new Map([
        ["L-1", { title: "Proofs", start: new Date("2026-10-06T06:00:00Z"), end: new Date("2026-10-06T08:00:00Z"), press: some("a1"), lane: "pm", status: variant("fine", null) }],
        ["L-2", { title: "Plates", start: new Date("2026-10-06T09:00:00Z"), end: new Date("2026-10-06T10:00:00Z"), press: some("a1"), lane: "am", status: variant("late", null) }],
        ["L-3", { title: "Wash-up", start: new Date("2026-10-07T06:00:00Z"), end: new Date("2026-10-07T07:00:00Z"), press: some("a2"), lane: "am", status: variant("late", null) }],
    ]),
    mutations: (mutation) => ({
        // The lane jobs' patch door.
        patch: mutation.patch(),
    }),
});


/** A job on a press or in a bay — a resource field whose case names the kind. */
export const PrintOnJob = StructType({ title: StringType, start: DateTimeType, end: DateTimeType, on: VariantType({ press: StringType, bay: StringType }) });

/** One job on Press A1, and one in Bay A1: two kinds of resource with the same key. */
export const planRowsOnJobs = e3.record("plan_rows_on_jobs", DictType(StringType, PrintOnJob), {
    initial: new Map([
        ["O-1", { title: "On the press", start: new Date("2026-10-06T06:00:00Z"), end: new Date("2026-10-06T08:00:00Z"), on: variant("press", "a1") }],
        ["O-2", { title: "In the bay", start: new Date("2026-10-06T09:00:00Z"), end: new Date("2026-10-06T10:00:00Z"), on: variant("bay", "a1") }],
    ]),
    mutations: (mutation) => ({
        // The press-or-bay jobs' patch door.
        patch: mutation.patch(),
    }),
});


// ============================================================================
// The print works' finishing and dispatch records (#1200)
// ============================================================================

/** What one of the print works' resources is: a press and the sheets it prints an hour, a crew, the platesetter, a bindery line, the dispatch bay or a van. */
export const PrintResourceKind = VariantType({
    press: StructType({ sheets_per_hour: FloatType }), crew: NullType, setter: NullType, line: NullType, bay: NullType, van: NullType,
});

/** One of the print works' resources, under the key its events name it by. */
export const PrintResource = StructType({ name: StringType, what: PrintResourceKind });

/** A group of the print works' resources, its strip on the canvas: a hall's presses or crews, the plate room, the bindery, dispatch, the fleet. */
export const PrintWorksGroup = StructType({ name: StringType, resources: DictType(StringType, PrintResource) });

/**
 * The print works as one record of rows (#1541): each group of its resources,
 * in the canvas's order, with the resources in it — the presses and the crews
 * of each hall, the platesetter, the bindery's folder and binder, the dispatch
 * bay and the vans — each under the key its events name it by.
 */
export const planPrintWorksRows = e3.record("plan_print_works", DictType(StringType, PrintWorksGroup), {
    initial: new Map([
        ["1-presses-a", { name: "Hall A", resources: new Map([
            ["a1", { name: "Press A1", what: variant("press", { sheets_per_hour: 12000.0 }) }],
            ["a2", { name: "Press A2", what: variant("press", { sheets_per_hour: 10000.0 }) }],
            ["a3", { name: "Press A3", what: variant("press", { sheets_per_hour: 8000.0 }) }],
        ]) }],
        ["2-presses-b", { name: "Hall B", resources: new Map([
            ["b1", { name: "Press B1", what: variant("press", { sheets_per_hour: 15000.0 }) }],
            ["b2", { name: "Press B2", what: variant("press", { sheets_per_hour: 12000.0 }) }],
            ["b3", { name: "Press B3", what: variant("press", { sheets_per_hour: 6000.0 }) }],
        ]) }],
        ["3-crews-a", { name: "Hall A crews", resources: new Map([
            ["c1", { name: "Crew 1", what: variant("crew", null) }], ["c2", { name: "Crew 2", what: variant("crew", null) }],
        ]) }],
        ["4-crews-b", { name: "Hall B crews", resources: new Map([
            ["c3", { name: "Crew 3", what: variant("crew", null) }], ["c4", { name: "Crew 4", what: variant("crew", null) }],
        ]) }],
        ["5-plates", { name: "Plate room", resources: new Map([["ps", { name: "Platesetter", what: variant("setter", null) }]]) }],
        ["6-bindery", { name: "Bindery", resources: new Map([
            ["fold", { name: "Folder", what: variant("line", null) }], ["bind", { name: "Binder", what: variant("line", null) }],
        ]) }],
        ["7-dispatch", { name: "Dispatch", resources: new Map([["bay", { name: "Dispatch bay", what: variant("bay", null) }]]) }],
        ["8-vans", { name: "Vans", resources: new Map([
            ["van1", { name: "Van 1", what: variant("van", null) }], ["van2", { name: "Van 2", what: variant("van", null) }],
        ]) }],
    ]),
});

/** A delivery's own status, separate from the schedule's lifecycle. */
export const PrintDispatchStatus = VariantType({ queued: NullType, ready: NullType, dispatched: NullType });

/** A delivery on a bay or a van: the variant preserves the resource kind when it moves. */
export const PrintDispatch = StructType({
    title: StringType, at: DateTimeType,
    location: VariantType({ bay: StringType, van: StringType }),
    lane: StringType, status: PrintDispatchStatus, pallets: FloatType,
});

/** The print works' own plate orders, timed before its existing jobs. */
export const planPrintPlates = e3.record("plan_print_plates", DictType(StringType, PrintPlates), {
    initial: new Map([
        ["P-101", { title: "Handbook plates", at: new Date("2026-10-16T14:00:00Z"), setter: "ps" }],
        ["P-102", { title: "Poster plates", at: new Date("2026-10-13T14:00:00Z"), setter: "ps" }],
    ]),
    mutations: (mutation) => ({
        // The print works' plates commit through their own patch door.
        patch: mutation.patch(),
    }),
});


/** Two foldings run in parallel, followed by binding, after the handbook leaves Press A1. */
export const planPrintBindings = e3.record("plan_print_bindings", DictType(StringType, PrintBinding), {
    initial: new Map([
        ["B-101", { title: "Fold handbook sections", start: new Date("2026-10-20T06:00:00Z"), end: new Date("2026-10-20T14:00:00Z"), line: "fold", state: variant("confirmed", null) }],
        ["B-102", { title: "Fold handbook inserts", start: new Date("2026-10-20T10:00:00Z"), end: new Date("2026-10-20T16:00:00Z"), line: "fold", state: variant("confirmed", null) }],
        ["B-103", { title: "Bind handbooks", start: new Date("2026-10-21T06:00:00Z"), end: new Date("2026-10-21T14:00:00Z"), line: "bind", state: variant("confirmed", null) }],
    ]),
    mutations: (mutation) => ({
        // The print works' bindery jobs commit through their own patch door.
        patch: mutation.patch(),
    }),
});


/** Deliveries occupy AM/PM lanes and carry each of the dispatch statuses. */
export const planPrintDeliveries = e3.record("plan_print_deliveries", DictType(StringType, PrintDispatch), {
    initial: new Map([
        ["D-101", { title: "Handbooks", at: new Date("2026-10-22T10:00:00Z"), location: variant("bay", "bay"), lane: "AM", status: variant("queued", null), pallets: 3.0 }],
        ["D-102", { title: "Event posters", at: new Date("2026-10-15T14:00:00Z"), location: variant("van", "van1"), lane: "PM", status: variant("ready", null), pallets: 2.0 }],
        ["D-103", { title: "Museum guides", at: new Date("2026-10-09T10:00:00Z"), location: variant("van", "van2"), lane: "AM", status: variant("dispatched", null), pallets: 1.0 }],
    ]),
    mutations: (mutation) => ({
        // The print works' deliveries commit through their own patch door.
        patch: mutation.patch(),
    }),
});


// ============================================================================
// The print works' templates, each a record of its own (#1344)
// ============================================================================

/** A job template: its name and group, how long the job it creates runs, and that job's fields. */
export const PrintJobTemplate = StructType({
    name: StringType, group: StringType, hours: FloatType,
    values: StructType({ title: StringType, state: EventStateType, sheets: FloatType, customer: StringType, stock: PrintJob.fields.stock, due: OptionType(DateTimeType) }),
});

/** A stop template: a stop is one instant, so it runs no time. */
export const PrintStopTemplate = StructType({ name: StringType, group: StringType, values: StructType({ title: StringType, kind: PrintStop.fields.kind }) });

/** A shift template: the hour a shift dropped on a day starts at, eight hours long. */
export const PrintShiftTemplate = StructType({ name: StringType, group: StringType, hour: IntegerType, values: StructType({ title: StringType, state: EventStateType }) });

/** A plates template: plates are made at one instant. */
export const PrintPlatesTemplate = StructType({ name: StringType, group: StringType, values: StructType({ title: StringType }) });

/** A bindery template: how long the bindery job it creates runs. */
export const PrintBindingTemplate = StructType({ name: StringType, group: StringType, hours: FloatType, values: StructType({ title: StringType, state: EventStateType }) });

/** A delivery template: the hour a delivery dropped on a day leaves at. */
export const PrintDeliveryTemplate = StructType({
    name: StringType, group: StringType, hour: IntegerType,
    values: StructType({ title: StringType, lane: StringType, status: PrintDispatchStatus, pallets: FloatType }),
});

/** The job templates. A Plan never writes them: the library lists them, and a drop creates a job from one. */
export const planPrintJobTemplates = e3.record("plan_print_job_templates", DictType(StringType, PrintJobTemplate), {
    initial: new Map([
        ["board", { name: "Board run", group: "Jobs", hours: 8.0, values: { title: "Board run", state: variant("proposed", variant("added", null)), sheets: 24000.0, customer: "", stock: variant("board", null), due: none } }],
        ["brochure", { name: "Brochure run", group: "Jobs", hours: 6.0, values: { title: "Brochure run", state: variant("proposed", variant("added", null)), sheets: 40000.0, customer: "", stock: variant("coated", null), due: none } }],
        ["catalogue", { name: "Catalogue run", group: "Jobs", hours: 12.0, values: { title: "Catalogue run", state: variant("proposed", variant("added", null)), sheets: 96000.0, customer: "", stock: variant("coated", null), due: none } }],
        ["poster", { name: "Poster run", group: "Jobs", hours: 4.0, values: { title: "Poster run", state: variant("proposed", variant("added", null)), sheets: 20000.0, customer: "", stock: variant("uncoated", null), due: none } }],
    ]),
    indexes: (index) => ({
        plan_print_job_templates_by_group: index.on(["group"]),
    }),
});

/** The stop templates. */
export const planPrintStopTemplates = e3.record("plan_print_stop_templates", DictType(StringType, PrintStopTemplate), {
    initial: new Map([
        ["plates", { name: "Plate change", group: "Stops", values: { title: "Plate change", kind: variant("plate_change", null) } }],
        ["service", { name: "Service", group: "Stops", values: { title: "Service", kind: variant("service", null) } }],
    ]),
    indexes: (index) => ({
        plan_print_stop_templates_by_group: index.on(["group"]),
    }),
});

/** The shift templates: early, late and night. */
export const planPrintShiftTemplates = e3.record("plan_print_shift_templates", DictType(StringType, PrintShiftTemplate), {
    initial: new Map([
        ["early", { name: "Early shift", group: "Shifts", hour: 6n, values: { title: "Early", state: variant("confirmed", null) } }],
        ["late", { name: "Late shift", group: "Shifts", hour: 14n, values: { title: "Late", state: variant("confirmed", null) } }],
        ["night", { name: "Night shift", group: "Shifts", hour: 22n, values: { title: "Night", state: variant("proposed", variant("added", null)) } }],
    ]),
    indexes: (index) => ({
        plan_print_shift_templates_by_group: index.on(["group"]),
    }),
});

/** The plates templates. */
export const planPrintPlatesTemplates = e3.record("plan_print_plates_templates", DictType(StringType, PrintPlatesTemplate), {
    initial: new Map([
        ["plates", { name: "Job plates", group: "Plate room", values: { title: "Job plates" } }],
    ]),
    indexes: (index) => ({
        plan_print_plates_templates_by_group: index.on(["group"]),
    }),
});

/** The bindery templates. */
export const planPrintBindingTemplates = e3.record("plan_print_binding_templates", DictType(StringType, PrintBindingTemplate), {
    initial: new Map([
        ["fold", { name: "Fold sections", group: "Bindery", hours: 8.0, values: { title: "Fold sections", state: variant("confirmed", null) } }],
    ]),
    indexes: (index) => ({
        plan_print_binding_templates_by_group: index.on(["group"]),
    }),
});

/** The delivery templates. */
export const planPrintDeliveryTemplates = e3.record("plan_print_delivery_templates", DictType(StringType, PrintDeliveryTemplate), {
    initial: new Map([
        ["delivery", { name: "Morning delivery", group: "Dispatch", hour: 10n, values: { title: "Delivery", lane: "AM", status: variant("queued", null), pallets: 1.0 } }],
    ]),
    indexes: (index) => ({
        plan_print_delivery_templates_by_group: index.on(["group"]),
    }),
});


// ============================================================================
// planPrintWorks — the print works (§3.3)
// ============================================================================

/**
 * The print works (`Plan Builder Spec.md` §3.3, #1541): one record of rows,
 * each group of its resources a strip — each hall's presses and crews, the
 * plate room, the bindery, dispatch and the vans — its resources beneath it,
 * each drawn by its kind (`Plan.series.kinds`), the event kinds landing on them
 * by the kind's key. Jobs draw as bars, stops and plates as marks at their
 * instants, shifts and bindery jobs as chips, deliveries as tiles in AM/PM
 * lanes on a bay or a van — a utilisation heat row under each press, and a
 * pinned chart of the sheets printed each day. Its rows are read whole. One
 * rail narrows it (`Slice.bindRecords`, #1344): the jobs and the shifts each
 * through their interval index, every event overlapping the window once, the
 * jobs by their stock too, their backlog with them; the customers by
 * district, in their tab; and each templates record, in the Events tab. Each kind's templates are a record of
 * its own. Its library (#1195) lists every kind's templates, the backlog, the
 * series a viewer shows and hides, and the customers, a card apiece that sets
 * the customer of the job it is dropped on. Its inspector (#1197) shows what is
 * selected: a job through the form its customer, stock and sheets are hinted
 * for, and a stop through the stop kind's own inspector, which chooses a plate
 * change or a service on a segment. Its summary names each source a narrowing
 * hides rows of, in its own words, and folded, its Filters popover heads each
 * source's fields with its count (#1358). The window is the jobs' and the
 * shifts' range together: the toolbar's dates, the resolution and the horizon
 * brush write both.
 * Links connect the plates, printing, binding and dispatch. Delivery readiness
 * holds Save for an invalid pallet count, while the drop veto explains a press
 * in service. A job's sheets are held to the 200,000 a press run takes: the
 * holiday catalogue's 240,000, stored, is a warning beside the toolbar's
 * issues, its bar ringed, holding no Save until the job itself is changed.
 */
export const planPrintWorks = example({
    keywords: [
        "Plan", "Schedule", "Plan.series.kinds", "Plan.series.group", "Schedule.events", "Schedule.field", "event kinds", "print works",
        "presses", "crews", "jobs", "stops", "shifts", "draw", "span", "marks", "cards", "at", "instant", "group",
        "hall", "sub", "measures", "utilisation", "heat", "state", "quantity", "backlog",
        "duration", "due", "fields", "templates", "rows", "pinned", "chart", "output", "grain", "library",
        "Plan.library", "customers", "Schedule.patch", "inspector", "selection", "kind's own inspector", "update",
        "Record.bind", "Data.bind", "e3.record", "e3.input", "#1191", "#1195", "#1197", "#1200", "parent", "rollup", "collapsed", "meta", "value",
        "buckets", "lane", "status", "ready", "overlaps", "allow", "canDrop", "Plan.Types.Candidate",
        "variant resource", "bay", "van", "Slice", "Slice.bindRecords", "sources", "Data.bindPaged", "indexes", "interval",
        "window", "range", "brush", "resolution", "Schedule.templates", "templates record", "Plan.eventRef", "Plan.over", "#1344",
        "max", "bounds", "warning", "out of range", "horizon", "totals", "summary with no key", "#1732",
    ],
    description: "The print works from plates to dispatch — one record of rows, its groups' resources each drawn by its kind (Plan.series.kinds); jobs, stops and shifts on the presses and crews, bindery jobs on its lines, deliveries in AM/PM lanes on a bay or a van, status and readiness, links between event kinds, utilisation and paper stock; one Slice.bindRecords rail — the jobs and the shifts through their interval indexes, their range the one window, the customers and each kind's templates record — and the shared library, inspector and Save session; a stored job over the sheets a press run takes is a warning beside the toolbar's issues, holding no Save",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // What the Plan reads whole binds with Data.bind, which keeps it loaded beside its pages — the works' rows
            // among them, each group of its resources with them (#1541); the event records it writes bind with
            // Record.bind, and it reads the jobs' and the shifts' events through their pages alone.
            const works = $.let(Data.bind(planPrintWorksRows));
            const jobs = $.let(Record.bind(planPrintJobs));
            const stops = $.let(Record.bind(planPrintStops));
            const shifts = $.let(Record.bind(planPrintShifts));
            const customers = $.let(Data.bind(planPrintCustomers));
            const jobTemplates = $.let(Data.bind(planPrintJobTemplates));
            const stopTemplates = $.let(Data.bind(planPrintStopTemplates));
            const shiftTemplates = $.let(Data.bind(planPrintShiftTemplates));
            const platesTemplates = $.let(Data.bind(planPrintPlatesTemplates));
            const bindingTemplates = $.let(Data.bind(planPrintBindingTemplates));
            const deliveryTemplates = $.let(Data.bind(planPrintDeliveryTemplates));
            // One rail over the records, a source each (#1344): the jobs and the shifts through their interval
            // indexes, their range the one window the toolbar's dates, the resolution and the brush write; the
            // customers and each templates record by its fields. The jobs and the shifts list their totals a month, a
            // quarter and a year, which the horizon's bars read (#1732) — the jobs' by their stock too, which the rail
            // chooses.
            const slice = $.let(Slice.bindRecords("ex.planPrintWorks", {
                job: {
                    source: Data.bindPaged(planPrintJobs, {
                        indexes: ["plan_print_jobs_by_time", "plan_print_jobs_by_stock_time"],
                        totals: [
                            "plan_print_jobs_day_totals", "plan_print_jobs_week_totals", "plan_print_jobs_month_totals", "plan_print_jobs_quarter_totals", "plan_print_jobs_year_totals",
                            "plan_print_jobs_by_stock_day_totals", "plan_print_jobs_by_stock_week_totals", "plan_print_jobs_by_stock_month_totals", "plan_print_jobs_by_stock_quarter_totals", "plan_print_jobs_by_stock_year_totals",
                        ],
                    }),
                    icon: { prefix: "fas", name: "file-lines" }, fields: { stock: { label: "Stock" }, start: { label: "Dates" } }, range: "start",
                },
                shift: {
                    source: Data.bindPaged(planPrintShifts, {
                        indexes: ["plan_print_shifts_by_time"],
                        totals: ["plan_print_shifts_day_totals", "plan_print_shifts_week_totals", "plan_print_shifts_month_totals", "plan_print_shifts_quarter_totals", "plan_print_shifts_year_totals"],
                    }),
                    icon: { prefix: "fas", name: "user-clock" }, fields: { start: { label: "Dates" } }, range: "start",
                },
                customers: { source: Data.bindPaged(planPrintCustomers, { indexes: ["plan_print_customers_by_district"] }), icon: { prefix: "fas", name: "building" },
                    fields: { district: { label: "District", hints: ["North Quay", "Old Town", "Riverside"] } } },
                jobTemplates: { source: Data.bindPaged(planPrintJobTemplates, { indexes: ["plan_print_job_templates_by_group"] }), icon: { prefix: "fas", name: "layer-group" },
                    fields: { group: { label: "Job templates", hints: ["Jobs"] } } },
                stopTemplates: { source: Data.bindPaged(planPrintStopTemplates, { indexes: ["plan_print_stop_templates_by_group"] }), icon: { prefix: "fas", name: "layer-group" },
                    fields: { group: { label: "Stop templates", hints: ["Stops"] } } },
                shiftTemplates: { source: Data.bindPaged(planPrintShiftTemplates, { indexes: ["plan_print_shift_templates_by_group"] }), icon: { prefix: "fas", name: "layer-group" },
                    fields: { group: { label: "Shift templates", hints: ["Shifts"] } } },
                platesTemplates: { source: Data.bindPaged(planPrintPlatesTemplates, { indexes: ["plan_print_plates_templates_by_group"] }), icon: { prefix: "fas", name: "layer-group" },
                    fields: { group: { label: "Plates templates", hints: ["Plate room"] } } },
                bindingTemplates: { source: Data.bindPaged(planPrintBindingTemplates, { indexes: ["plan_print_binding_templates_by_group"] }), icon: { prefix: "fas", name: "layer-group" },
                    fields: { group: { label: "Bindery templates", hints: ["Bindery"] } } },
                deliveryTemplates: { source: Data.bindPaged(planPrintDeliveryTemplates, { indexes: ["plan_print_delivery_templates_by_group"] }), icon: { prefix: "fas", name: "layer-group" },
                    fields: { group: { label: "Delivery templates", hints: ["Dispatch"] } } },
            }));
            // A kind narrowed through its source reads one event by its key through the record's own entries.
            const jobEntries = $.let(Data.bindPaged(planPrintJobs));
            const shiftEntries = $.let(Data.bindPaged(planPrintShifts));
            const plates = $.let(Record.bind(planPrintPlates));
            const bindings = $.let(Record.bind(planPrintBindings));
            const deliveries = $.let(Record.bind(planPrintDeliveries));
            const stock = $.let(Data.bind(planLinkStock));
            const util = $.let(Data.bind(planPrintUtilisation));
            const output = $.let(Data.bind(planPrintOutput));
            // The window's first day: each reading runs from it, a day apiece.
            const first = $.const(new Date("2026-10-05T00:00:00Z"), DateTimeType);
            // A press's readings as heat cells, one a day.
            const daily = $.const(East.function([ArrayType(FloatType)], ArrayType(Plan.Types.HeatCell), (_$2, readings) =>
                East.Array.generate(readings.size(), Plan.Types.HeatCell, (_$3, i) => ({
                    at: Plan.at.time(first.addDays(i)), value: some(readings.get(i)), label: none,
                }))));
            // The sheets printed each day, as a chart's points.
            const PrintDay = StructType({ day: DateTimeType, sheets: FloatType });
            const printed = $.let(output.read());
            const days = $.let(East.Array.generate(printed.size(), PrintDay, (_$2, i) => ({ day: first.addDays(i), sheets: printed.get(i) })));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                resolution: "day", resolutions: ["week", "day"], now: new Date("2026-10-14T09:00:00Z"),
            }));
            // The Plan's one check of a drop, over what it would do (`Plan.Types.Candidate`): the row it would land on is
            // the resource's own, of the series its kind lands on, whichever way the kind draws there.
            const canDrop = $.const(East.function([Plan.Types.Candidate], OptionType(StringType), ($2, candidate) => {
                const reason = $2.let(none, OptionType(StringType));
                $2.match(candidate.row, { some: ($3, row) => {
                    $3.match(row, { entry: ($4, at) => {
                        // A press's row stands under its hall: its path ends in the press's key.
                        const steps = $4.let(at.path.size());
                        $4.if(at.series.equal("presses").and(() => steps.greater(0n)).and(() => at.path.get(steps.subtract(1n)).equal("b3")), $5 => {
                            $5.assign(reason, some("Press B3 is in service; choose another press"));
                        });
                    } });
                } });
                return reason;
            }));
            // A stop's own inspector: its title, and whether it is a plate change or a
            // service, chosen on a segment — the edited stop goes back through `update`.
            const StopKindType = PrintStop.fields.kind;
            const inspectStop = $.const(East.function([PrintStop, FunctionType([PrintStop], NullType)], UIComponentType, ($2, stop, update) => {
                const setKind = $2.const(East.function([StringType], NullType, ($3, picked) => {
                    const kind = $3.const(picked.equal("service").ifElse(
                        () => East.value(variant("service", null), StopKindType),
                        () => East.value(variant("plate_change", null), StopKindType)));
                    // East has no struct spread: the stop, rebuilt with its new kind.
                    $3(update({ title: stop.title, at: stop.at, press: stop.press, kind }));
                }));
                return (
                    <VStack gap="3" align="stretch">
                        <Text>{stop.title}</Text>
                        <SegmentGroup value={stop.kind.getTag()} onChange={setKind} size="sm"
                            items={[SegmentGroup.Item("plate_change", "Plate change"), SegmentGroup.Item("service", "Service")]} />
                    </VStack>
                );
            }));
            return (
                <Plan
                    id="printWorks"
                    axis={axis}
                    date={first}
                    canDrop={canDrop}
                    slice={{ slice }}
                    // The works' rows: each group a strip, its resources beneath it, each drawn by its kind — the event
                    // kinds land on them by the kind's key (#1541).
                    data={works.read()}
                    series={[Plan.series.group(PrintWorksGroup, {
                        key: "groups", title: "Works", label: g => g.name,
                        children: Plan.children("resources", [Plan.series.kinds(PrintResource, "what", {
                            press: {
                                key: "presses", title: "Presses", icon: "print", label: r => r.name,
                                sub: (_r, _key, press) => some(East.str`${East.Float.printCommaSeperated(press.sheets_per_hour, 0n)} sheets/h`),
                                // A row under each press, from the dataflow's utilisation: an ordinary heat series over the
                                // press's row, read only.
                                series: [
                                    Plan.series.heat(PrintResource, {
                                        key: "util", title: "Utilisation", label: () => "Utilisation",
                                        cells: (_r, key) => Plan.heatCells(daily(util.read().get(key)), { min: 0, max: 100, warnAt: 95 }),
                                    }),
                                ],
                            },
                            crew: { key: "crews", title: "Crews", icon: "user-group", label: r => r.name },
                            setter: { key: "setters", title: "Plate room", icon: "layer-group", label: r => r.name, sub: () => some("Plates before printing") },
                            line: { key: "lines", title: "Bindery", icon: "book", label: r => r.name, sub: () => some("Finishing") },
                            bay: { key: "bays", title: "Dispatch", icon: "warehouse", label: r => r.name, sub: () => some("Loading") },
                            van: { key: "vans", title: "Vans", icon: "truck", label: r => r.name, sub: () => some("Delivery fleet") },
                        })]),
                    })]}
                    events={{
                        job: Schedule.events(jobs, {
                            name: "Print job", icon: "file-lines", draw: "span",
                            title: "title", start: "start", end: "end",
                            resource: { field: "press", of: "presses" },
                            state: "state",
                            quantity: { field: "sheets", unit: "sheets" },
                            // A job under way is locked, by the works' own rule: it draws with a lock, and is not
                            // moved, resized, changed or removed.
                            locked: (job) => job.state.hasTag("in-progress"),
                            backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                            fields: {
                                customer: Schedule.field.text({ label: "Customer" }),
                                stock: Schedule.field.select({ labels: { coated: "Coated", uncoated: "Uncoated", board: "Board" } }),
                                // A press is loaded with at most 200,000 sheets for one run, so a longer job is split into
                                // runs: the holiday catalogue's 240,000 went on as one.
                                sheets: Schedule.field.number({ label: "Sheets", step: 1000.0, min: 0.0, max: 200000.0 }),
                            },
                            // Narrowed through its source of the slice (`job`): one job is read by its key here.
                            entries: jobEntries,
                            templates: Schedule.templates(jobTemplates.read(), {
                                name: t => t.name, group: t => some(t.group), duration: t => variant("hours", t.hours), values: t => t.values, source: "jobTemplates",
                            }),
                        }),
                        stop: Schedule.events(stops, {
                            name: "Stop", icon: "screwdriver-wrench", draw: "marks",
                            title: "title", at: "at",
                            resource: { field: "press", of: "presses" },
                            inspector: inspectStop,
                            // A stop is one instant: its templates give no duration.
                            templates: Schedule.templates(stopTemplates.read(), { name: t => t.name, group: t => some(t.group), values: t => t.values, source: "stopTemplates" }),
                        }),
                        shift: Schedule.events(shifts, {
                            name: "Crew shift", icon: "user-clock", draw: "cards",
                            title: "title", start: "start", end: "end",
                            resource: { field: "crew", of: "crews" }, state: "state",
                            entries: shiftEntries,
                            templates: Schedule.templates(shiftTemplates.read(), {
                                name: t => t.name, group: t => some(t.group), at: t => some({ hour: t.hour, minute: 0n }), duration: () => variant("hours", 8.0),
                                values: t => t.values, source: "shiftTemplates",
                            }),
                        }),
                        plate: Schedule.events(plates, {
                            name: "Plates", icon: "clone", title: "title", at: "at", resource: { field: "setter", of: "setters" },
                            templates: Schedule.templates(platesTemplates.read(), { name: t => t.name, group: t => some(t.group), values: t => t.values, source: "platesTemplates" }),
                        }),
                        binding: Schedule.events(bindings, {
                            name: "Bindery job", icon: "book-open", draw: "cards", title: "title", start: "start", end: "end",
                            resource: { field: "line", of: "lines" }, state: "state", overlaps: "allow",
                            templates: Schedule.templates(bindingTemplates.read(), {
                                name: t => t.name, group: t => some(t.group), duration: t => variant("hours", t.hours), values: t => t.values, source: "bindingTemplates",
                            }),
                        }),
                        delivery: Schedule.events(deliveries, {
                            name: "Delivery", icon: "truck", draw: "buckets", title: "title", at: "at",
                            resource: { field: "location", of: { bay: "bays", van: "vans" } }, lane: "lane",
                            status: { field: "status", cases: {
                                queued: { label: "Queued", tone: variant("warning", null), ring: true },
                                ready: { label: "Ready", tone: variant("info", null), ring: false },
                                dispatched: { label: "Dispatched", tone: variant("success", null), ring: false },
                            } },
                            ready: d => d.pallets.lessEqual(0.0).ifElse(
                                () => variant("invalid", [{ field: "pallets", message: "Pallets must be positive" }]),
                                () => variant("ready", null)),
                            // The rule says what a delivery takes: a bound beside it hinted 0 was allowed, and one of 1 said
                            // it twice (#1680's review).
                            fields: { pallets: Schedule.field.number({ label: "Pallets", step: 1.0 }) },
                            templates: Schedule.templates(deliveryTemplates.read(), {
                                name: t => t.name, group: t => some(t.group), at: t => some({ hour: t.hour, minute: 0n }), values: t => t.values, source: "deliveryTemplates",
                            }),
                        }),
                    }}
                    rows={[
                        Plan.chart({
                            key: "output", label: "SHEETS / DAY", id: true, pinned: true, height: "spark", expandable: true,
                            layers: [Chart.Column(days, { x: r => r.day, y: r => r.sheets })],
                        }),
                        Plan.over(stock, [Plan.series.table(PrintStock, {
                            key: "stock", title: "Paper stock", label: s => s.name,
                            cells: Plan.tableCells(Plan.values("weekly", (level) => ({ value: level }))), format: Format.Number({ maximumFractionDigits: 0n }),
                        })]),
                    ]}
                    links={[
                        Plan.link({ key: "plates", from: Plan.eventRef("plate", "P-101"), to: Plan.eventRef("job", "J-1004") }),
                        Plan.link({ key: "printed", from: Plan.eventRef("job", "J-1004"), to: Plan.eventRef("binding", "B-101"), quantity: Plan.quantity(144, { unit: "k sheets" }) }),
                        Plan.link({ key: "folded", from: Plan.eventRef("binding", "B-101"), to: Plan.eventRef("binding", "B-103") }),
                        Plan.link({ key: "dispatched", from: Plan.eventRef("binding", "B-103"), to: Plan.eventRef("delivery", "D-101") }),
                    ]}
                    grain="resource"
                    library={[
                        Plan.library.events(),
                        Plan.library.backlog(),
                        Plan.library.series(),
                        // The customers, by district: a card dropped on a job sets its customer. The tab follows the
                        // rail's `customers` source, by its rows' keys.
                        Plan.library.tab(customers.read(), {
                            name: "Customers", icon: "building",
                            label: c => c.name, meta: c => some(c.trade), group: c => c.district,
                            drop: c => Schedule.patch(PrintJob, { customer: c.name }), source: "customers",
                        }),
                    ]}
                    inspector
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * A lock on each way an event draws (#1541, U9): the print works' first hall
 * — its presses and its crews — with the bay and the vans, and what is done
 * or booked on them held where it is by the works' own rules — a confirmed shift, a chip; a press's service, a
 * mark; a delivery that has gone, a tile. Each draws with a lock, is not
 * moved, changed or removed, and shows its form read only; what the rules let
 * go — a proposed shift, a plate change, a delivery still queued — moves as
 * ever.
 */
export const planLocks = example({
    keywords: [
        "Plan", "locked", "lock", "Schedule.events", "cards", "chip", "marks", "mark", "buckets", "tile", "read only", "state", "status",
        "Plan.series.kinds", "Plan.series.group", "inspector", "#1541",
    ],
    description: "A lock on each way an event draws — the print works' crews, presses, bay and vans, with what is done or booked held where it is by the works' own rules (Schedule.events' `locked`): a confirmed shift, a chip; a press's service, a mark; a delivery that has gone, a tile. Each draws with a lock, is not moved, changed or removed, and shows its form read only",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const works = $.let(Data.bind(planPrintWorksRows));
            const shifts = $.let(Record.bind(planPrintShifts));
            const stops = $.let(Record.bind(planPrintStops));
            const deliveries = $.let(Record.bind(planPrintDeliveries));
            // A week a column: a delivery's tile is drawn whole in its week, never folded into a count.
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                resolution: "week", now: new Date("2026-10-14T09:00:00Z"),
            }));
            return (
                <Plan
                    id="locks"
                    axis={axis}
                    // The works' rows that hold what the rules lock — the first hall's presses and crews, the bay and
                    // the vans: each group a strip, its resources beneath it, each drawn by its kind.
                    data={works.read().filter((_$, _group, key) => key.equal("1-presses-a").or(() => key.equal("3-crews-a"))
                        .or(() => key.equal("7-dispatch")).or(() => key.equal("8-vans")))}
                    series={[Plan.series.group(PrintWorksGroup, {
                        key: "groups", title: "Works", label: g => g.name,
                        children: Plan.children("resources", [Plan.series.kinds(PrintResource, "what", {
                            press: { key: "presses", title: "Presses", icon: "print", label: r => r.name },
                            crew: { key: "crews", title: "Crews", icon: "user-group", label: r => r.name },
                            setter: false,
                            line: false,
                            bay: { key: "bays", title: "Dispatch", icon: "warehouse", label: r => r.name },
                            van: { key: "vans", title: "Vans", icon: "truck", label: r => r.name },
                        })]),
                    })]}
                    events={{
                        shift: Schedule.events(shifts, {
                            name: "Crew shift", icon: "user-clock", draw: "cards",
                            title: "title", start: "start", end: "end",
                            resource: { field: "crew", of: "crews" }, state: "state",
                            // A confirmed shift is the crew's: held where it is.
                            locked: (shift) => shift.state.hasTag("confirmed"),
                        }),
                        stop: Schedule.events(stops, {
                            name: "Stop", icon: "screwdriver-wrench", draw: "marks",
                            title: "title", at: "at",
                            resource: { field: "press", of: "presses" },
                            // A service is booked with the press's maker.
                            locked: (stop) => stop.kind.hasTag("service"),
                        }),
                        delivery: Schedule.events(deliveries, {
                            name: "Delivery", icon: "truck", draw: "buckets", title: "title", at: "at",
                            resource: { field: "location", of: { bay: "bays", van: "vans" } }, lane: "lane",
                            status: { field: "status", cases: {
                                queued: { label: "Queued", tone: variant("warning", null), ring: true },
                                ready: { label: "Ready", tone: variant("info", null), ring: false },
                                dispatched: { label: "Dispatched", tone: variant("success", null), ring: false },
                            } },
                            // A delivery that has gone is done.
                            locked: (delivery) => delivery.status.hasTag("dispatched"),
                        }),
                    }}
                    inspector
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * Every way a link draws (`Plan links.html`, `Plan Builder Spec.md` §4.3,
 * PB10, #1258): a print works' jobs from the plates that start them, across its
 * presses, through the bindery to the dispatch bay — each link a row of the
 * flows' record, a link kind (`Plan.links`, #1541), its ends holding the keys
 * of the events it joins, so it draws between the elements wherever they draw.
 * Press a row's link control to see them. Each link is one of the grammar's
 * cases, its quantity sizing it against the family's largest:
 *
 * - from the plates, a mark, into the catalogue covers: an S down, with no
 *   quantity — the thinnest weight, no caption;
 * - from the covers, a two-hour job drawn the narrowest bar, into the
 *   catalogue: an S down, out of the bar's end as drawn;
 * - from the card stock up into the menu cards: an S up;
 * - from the catalogue inserts into the store flyers, which start first: the
 *   loopback down, on the lane halfway between them;
 * - from the report covers up into the annual report: the loopback up;
 * - from the seed catalogue into the seed packets on the press below: the
 *   loopback between adjacent rows;
 * - from the gift tags into the gift boxes on one press: a straight feed;
 * - from the desk calendars into the calendar pads, back to back on one press:
 *   the runoff stubs;
 * - from the proof run, in from before the window, into the night run at its
 *   start: the loopback that drops onto the night run's start — nothing of a
 *   link crosses into the gutter;
 * - from the proof sheets, ended before the window, and into the spring
 *   brochure, after it: each end in a dashed slot on the plot's edge;
 * - from the book sections into the folder's two jobs: two S's out of one end,
 *   the second caption stepped under the first; then from the folder into the
 *   binder, chip to chip, and from the binder into the books' delivery, met at
 *   its week's cell;
 * - from the shop posters straight to their delivery: an S down the canvas,
 *   and from the exhibition book back into its binding: a loopback down.
 *
 * The canvas is bounded, so its rows scroll: a link to a row out of view meets
 * the view's edge in a stub pointing at it, and one between rows past both
 * edges crosses the view as a band. The now line and the row controls draw
 * over the links.
 *
 * Below the event kinds' rows, the paper in stock is a table over a dataset
 * (`Plan.over`), a reading a week, read only: a Plan's edits go through its
 * event kinds.
 */
export const planEventLinks = example({
    keywords: [
        "Plan", "links", "Plan.links", "link kind", "record", "event", "ends", "quantity", "weight", "ribbon", "route", "S", "loopback",
        "feed", "runoff", "drop", "slot", "stub", "band", "out of view", "bounded", "height", "caption", "mark", "chip",
        "tile", "bucket", "cards", "marks", "Schedule", "Schedule.events", "Plan.series.resources", "Record.bind", "e3.record",
        "rows", "Plan.over", "dataset", "read only", "table", "Plan.series.table", "Plan.tableCells", "stock", "Data.bind",
        "e3.input", "#1191", "#1258",
    ],
    description: "Every way a link draws — S's up and down, loopbacks, a feed and the runoff on one press, a drop onto a start at the window's edge, slots past the window, stubs and a band out of view, links into a mark, chips and a tile, weighted by quantity — each a row of one link kind over a record of its own (`Plan.links`), its ends the keys of the events it joins, on a bounded canvas, with the paper in stock as a read-only table over a dataset (`Plan.over`)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const works = $.let(Record.bind(planLinkWorks, []));
            const plates = $.let(Record.bind(planLinkPlates));
            const jobs = $.let(Record.bind(planLinkCaseJobs));
            const bindings = $.let(Record.bind(planLinkBindings));
            const deliveries = $.let(Record.bind(planLinkDeliveries));
            const flows = $.let(Record.bind(planLinkFlows));
            const stock = $.let(Data.bind(planLinkStock));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                resolution: "week", now: new Date("2026-10-14T09:00:00Z"),
            }));
            return (
                <Plan
                    axis={axis}
                    // The works' centres, one record of rows: each kind of centre a resources series of its own, in the
                    // order the links run through them — plates, printing, binding, dispatch.
                    data={works.read()}
                    series={[
                        Plan.series.resources(PrintLinkCentre, { key: "setters", title: "Plate room", icon: "layer-group", match: c => c.what.hasTag("setter"), label: c => c.name }),
                        Plan.series.resources(PrintLinkCentre, {
                            key: "presses", title: "Presses", icon: "print", match: c => c.what.hasTag("press"), label: c => c.name,
                            sub: c => some(c.what.unwrap("press").hall),
                        }),
                        Plan.series.resources(PrintLinkCentre, { key: "lines", title: "Bindery", icon: "book", match: c => c.what.hasTag("line"), label: c => c.name }),
                        Plan.series.resources(PrintLinkCentre, { key: "bays", title: "Dispatch", icon: "warehouse", match: c => c.what.hasTag("bay"), label: c => c.name }),
                    ]}
                    events={{
                        plate: Schedule.events(plates, {
                            name: "Plates", icon: "clone",
                            title: "title", at: "at",
                            resource: { field: "setter", of: "setters" },
                        }),
                        job: Schedule.events(jobs, {
                            name: "Print job", icon: "file-lines",
                            title: "title", start: "start", end: "end",
                            resource: { field: "press", of: "presses" },
                            state: "state", quantity: { field: "sheets", unit: "sheets" },
                        }),
                        binding: Schedule.events(bindings, {
                            name: "Bindery job", icon: "book-open", draw: "cards",
                            title: "title", start: "start", end: "end",
                            resource: { field: "line", of: "lines" }, state: "state",
                        }),
                        delivery: Schedule.events(deliveries, {
                            name: "Delivery", icon: "truck", draw: "buckets",
                            title: "title", at: "at",
                            resource: { field: "bay", of: "bays" },
                        }),
                    }}
                    // The paper in stock: a table over a dataset, read only.
                    rows={[
                        Plan.over(stock, [
                            Plan.series.table(PrintStock, {
                                key: "stock", title: "Paper stock", label: s => s.name,
                                cells: Plan.tableCells(Plan.values("weekly", (level) => ({ value: level }))),
                                format: Format.Number({ maximumFractionDigits: 0n }),
                            }),
                        ]),
                    ]}
                    // The works' flows, one link kind over a record of its own (#1541, U10): each row a link, its ends
                    // the keys of the events it joins — a case for each kind of event an end may name. Each quantity is
                    // in thousands of sheets, its third of the family's largest setting the link's weight; the plates'
                    // flow carries none. A flow is drawn with the Connect tool, and saved with the Plan's other drafts.
                    links={{
                        flow: Plan.links(flows, {
                            name: "Flow", icon: "arrow-right-long",
                            from: { field: "from", of: { plate: "plate", job: "job", binding: "binding" } },
                            to: { field: "to", of: { job: "job", binding: "binding", delivery: "delivery" } },
                            quantity: { field: "sheets", unit: "k sheets" },
                        }),
                    }}
                    style={{ height: "400px" }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** The jobs the conflicts example edits, in a record of their own, so no other example's edits meet them. */
export const planConflictJobs = e3.record("plan_conflict_jobs", DictType(StringType, PrintJob), {
    initial: new Map([
        ["J-3001", { title: "Spring catalogue", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T14:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 96000.0, customer: "Alder & Finch", stock: variant("coated", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
        ["J-3002", { title: "Course handbook", start: some(new Date("2026-10-12T06:00:00Z")), end: some(new Date("2026-10-12T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
        ["J-3003", { title: "Annual report", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T12:00:00Z")), press: some("a2"), state: variant("confirmed", null), sheets: 60000.0, customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-10T00:00:00Z")) }],
        ["J-3005", { title: "Store flyers", start: some(new Date("2026-10-09T06:00:00Z")), end: some(new Date("2026-10-09T16:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 150000.0, customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-12T00:00:00Z")) }],
        ["J-3006", { title: "Market posters", start: some(new Date("2026-10-13T06:00:00Z")), end: some(new Date("2026-10-13T12:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 72000.0, customer: "Orchard Street Market", stock: variant("coated", null), due: some(new Date("2026-10-15T00:00:00Z")) }],
    ]),
    mutations: (mutation) => ({
        // The jobs' patch door — every Save commits through it.
        patch: mutation.patch(),
        // Someone else's save: every job a day later, its press and its other fields as they were.
        elsewhere: mutation.reduce(East.function([DictType(StringType, PrintJob)], DictType(StringType, PrintJob), (_$, jobs) =>
            jobs.map((_$2, job) => ({
                title: job.title,
                start: job.start.match({
                    some: (_$3, at) => East.value(some(at.addDays(1n)), OptionType(DateTimeType)),
                    none: (_$3) => East.value(none, OptionType(DateTimeType)),
                }),
                end: job.end.match({
                    some: (_$3, at) => East.value(some(at.addDays(1n)), OptionType(DateTimeType)),
                    none: (_$3) => East.value(none, OptionType(DateTimeType)),
                }),
                press: job.press, state: job.state, sheets: job.sheets, customer: job.customer, stock: job.stock, due: job.due,
            })))),
    }),
});

/**
 * Your edits meeting someone else's save, in one window: edit, then press
 * Someone else saves, which saves another person's change to the same jobs —
 * every job a day later. A bar you moved or resized too is a conflict, its
 * dates one card to choose; a customer or stock you changed in the panel
 * combines with theirs. Each press saves their change again.
 */
export const planConflicts = example({
    keywords: ["Plan", "conflict", "conflicts", "combine", "someone else", "Choose", "dates", "bars", "Schedule.events", "Record.bind", "mutate", "Button", "inspector", "Save"],
    description: "Your edits meeting someone else's save, in one window — move or resize a job's bar, then press Someone else saves, which saves another person's change to the same jobs (every job a day later), so yours conflict, its dates one card to choose; a customer or stock you change in the panel combines with theirs",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(planPrintPresses, []));
            const jobs = $.let(Record.bind(planConflictJobs, ["patch"]));
            const others = $.let(Record.bind(planConflictJobs, ["elsewhere"]));
            const theirs = $.const(East.function([], NullType, ($) => { $(others.mutate.elsewhere()); }));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-19T00:00:00Z") },
                resolution: "day", now: new Date("2026-10-07T09:00:00Z"),
            }));
            return (
                <VStack gap="3" align="stretch">
                    <HStack gap="3">
                        <Button variant="outline" onClick={theirs} loading={others.mutate.pending()}>Someone else saves</Button>
                        <Text color="fg.muted">Their change: every job a day later</Text>
                    </HStack>
                    <Box height="560px">
                        <Plan
                            id="conflicts"
                            axis={axis}
                            data={presses.read()}
                            series={[Plan.series.resources(PrintPress, { key: "presses", title: "Presses", icon: "print", label: p => p.name })]}
                            events={{
                                job: Schedule.events(jobs, {
                                    name: "Print job", icon: "file-lines",
                                    title: "title", start: "start", end: "end",
                                    resource: { field: "press", of: "presses" },
                                    state: "state",
                                    fields: {
                                        customer: Schedule.field.text({ label: "Customer" }),
                                        stock: Schedule.field.select({ labels: { coated: "Coated", uncoated: "Uncoated", board: "Board" } }),
                                    },
                                }),
                            }}
                            inspector
                        />
                    </Box>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// The press tasks — a press's kinds of task as rows beneath it, each task on its kind's row in its half's lane
// ============================================================================

/** What a machine is. */
export const PressMachineKind = VariantType({ folder: NullType, press: NullType });

/** A kind of task on a press. */
export const PressTaskKind = VariantType({ blanket_wash: NullType, ink_fill: NullType, plate_check: NullType, roller_wash: NullType });

/** The half of a day a task is done in: its lane. */
export const PressHalf = VariantType({ am: NullType, pm: NullType });

/** A kind of task as the works names it: a child row of its press. */
export const PressTaskKindRow = StructType({ name: StringType });

/** A machine, keyed by its code: a press fills `temperature` and `kinds`, a folder `utilisation`. */
export const PressMachine = StructType({
    name: StringType,
    what: PressMachineKind,
    /** Its ink's temperature at each reading, in °C. */
    temperature: DictType(DateTimeType, FloatType),
    /** The share of each day it is busy, in %. */
    utilisation: DictType(DateTimeType, FloatType),
    /** The kinds of task it takes: its child rows, keyed by the kind. */
    kinds: DictType(PressTaskKind, PressTaskKindRow),
});

/** A day of the press tasks' four weeks, by its place among them. */
const pressDay = (n: number): Date => new Date(Date.UTC(2026, 9, 5 + n));
/** A reading a day over the first two weeks, from a level, by a step a day. */
const pressReadings = (from: number, step: number) =>
    new SortedMap(Array.from({ length: 14 }, (_, n) => [pressDay(n), from + step * (n % 5)] as const), compareFor(DateTimeType));
/** No reading: a folder's ink, a press's utilisation. */
const noReadings = () => new SortedMap<Date, number>([], compareFor(DateTimeType));
/** A press's kinds of task, by the kind. */
const pressKinds = (...kinds: readonly (readonly [keyof typeof PressTaskKind.cases, string])[]) =>
    new SortedMap(kinds.map(([kind, name]) => [variant(kind, null), { name }] as const), compareFor(PressTaskKind));

/** The works' machines: two presses, each with the kinds of task it takes, and a folder. */
export const planPressMachines = e3.record("plan_press_machines", DictType(StringType, PressMachine), {
    initial: new Map([
        ["F1", { name: "Folder 1", what: variant("folder", null), temperature: noReadings(), utilisation: pressReadings(62.0, 6.0), kinds: pressKinds() }],
        ["P03", {
            name: "Heidelberg 3", what: variant("press", null), temperature: pressReadings(28.0, 0.5), utilisation: noReadings(),
            kinds: pressKinds(["blanket_wash", "Blanket wash"], ["ink_fill", "Ink fill"], ["plate_check", "Plate check"]),
        }],
        ["P04", {
            name: "Heidelberg 4", what: variant("press", null), temperature: pressReadings(27.0, 0.4), utilisation: noReadings(),
            kinds: pressKinds(["blanket_wash", "Blanket wash"], ["roller_wash", "Roller wash"]),
        }],
    ]),
    indexes: (index) => ({
        // The key itself, for a page's scope: `index.key(fn)` files a key the row computes.
        plan_press_machines_by_code: index.key(East.function([StringType, PressMachine], StructType({ code: StringType }), (_$, code) => ({ code }))),
        // The machines by name: the rail's order and its search.
        plan_press_machines_by_name: index.on(["name"]),
        // Each machine's readings a day at a time, and a press's kinds of task: child rows keyed by the kind, a variant.
        plan_press_machines_in_time: index.nestedSeries({
            collections: {
                temperature: index.nestedSeries.values(),
                utilisation: index.nestedSeries.values(),
                kinds: index.nestedSeries.rows({}),
            },
            tile: "day",
            summary: "month",
        }),
    }),
});

/** The kinds of task every press of the works takes, a list of the works' own, by the kind. */
export const planPressKindList = e3.input("plan_press_kind_list", DictType(PressTaskKind, PressTaskKindRow), variant("value", pressKinds(
    ["blanket_wash", "Blanket wash"], ["ink_fill", "Ink fill"], ["plate_check", "Plate check"], ["roller_wash", "Roller wash"],
)));

/** A task on a press: its kind, the day and the half it is done in, and its lifecycle. */
export const PressTask = StructType({
    title: StringType,
    press: StringType,
    kind: PressTaskKind,
    day: DateTimeType,
    half: PressHalf,
    state: EventStateType,
});

/** A task's row, by its press, its kind, the day it is done on and its half. */
const pressTask = (title: string, press: string, kind: keyof typeof PressTaskKind.cases, day: number, half: "am" | "pm") =>
    ({ title, press, kind: variant(kind, null), day: pressDay(day), half: variant(half, null), state: variant("confirmed", null) });

/** The presses' tasks, a record of their own. */
export const planPressTaskRows = e3.record("plan_press_tasks", DictType(StringType, PressTask), {
    initial: new Map([
        ["T-01", pressTask("Wash blankets", "P03", "blanket_wash", 1, "am")],
        ["T-02", pressTask("Fill cyan", "P03", "ink_fill", 1, "pm")],
        ["T-03", pressTask("Fill black", "P03", "ink_fill", 2, "am")],
        ["T-04", pressTask("Check plates", "P03", "plate_check", 3, "am")],
        ["T-05", pressTask("Wash blankets", "P03", "blanket_wash", 4, "pm")],
        ["T-06", pressTask("Wash blankets", "P04", "blanket_wash", 1, "pm")],
        ["T-07", pressTask("Wash rollers", "P04", "roller_wash", 2, "am")],
        ["T-08", pressTask("Wash rollers", "P04", "roller_wash", 4, "am")],
    ]),
    indexes: (index) => ({
        // The works' rail: the tasks by their day, and the days a window holds — each task an instant, its end its start.
        plan_press_tasks_by_day: index.on(["day"]),
        plan_press_tasks_by_time: index.interval({ from: "day", to: "day" }),
        // A press's page: its scope's press alone, which its search reads through; then its rail's days, and a window's.
        plan_press_tasks_by_press: index.on(["press"]),
        plan_press_tasks_by_press_day: index.on(["press", "day"]),
        plan_press_tasks_by_press_time: index.interval({ on: ["press"], from: "day", to: "day" }),
        // The tasks a press at a time, a cell at a time, and their totals: each task an instant, its end its start.
        plan_press_tasks_by_press_week: index.flatSeries({ key: "press", from: "day", to: "day", tile: "week" }),
        plan_press_tasks_by_press_month: index.summary({ key: "press", from: "day", to: "day", tile: "month" }),
        // The tasks' totals a day, a week, a month, a quarter and a year (#1732): the works' horizon's bars, and a press's page's, led by
        // the press its scope holds — each task an instant.
        plan_press_tasks_day_totals: index.totals({ from: "day", to: "day", tile: "day" }),
        plan_press_tasks_week_totals: index.totals({ from: "day", to: "day", tile: "week" }),
        plan_press_tasks_month_totals: index.totals({ from: "day", to: "day", tile: "month" }),
        plan_press_tasks_quarter_totals: index.totals({ from: "day", to: "day", tile: "quarter" }),
        plan_press_tasks_year_totals: index.totals({ from: "day", to: "day", tile: "year" }),
        plan_press_tasks_by_press_day_totals: index.totals({ on: ["press"], from: "day", to: "day", tile: "day" }),
        plan_press_tasks_by_press_week_totals: index.totals({ on: ["press"], from: "day", to: "day", tile: "week" }),
        plan_press_tasks_by_press_month_totals: index.totals({ on: ["press"], from: "day", to: "day", tile: "month" }),
        plan_press_tasks_by_press_quarter_totals: index.totals({ on: ["press"], from: "day", to: "day", tile: "quarter" }),
        plan_press_tasks_by_press_year_totals: index.totals({ on: ["press"], from: "day", to: "day", tile: "year" }),
    }),
    mutations: (mutation) => ({
        // The tasks' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});

/**
 * Every machine of the works with its rows beneath it (#1541, U1, U2): a press
 * its ink's temperature and a row for each kind of task it takes, a folder its
 * utilisation. The kinds are the press's own child rows, keyed by the kind — a
 * variant — and read with the page through the machines' nested series index.
 *
 * Each task is on its press's row (`resource`), then on its kind's row beneath
 * it (`child`), in the lane of the half of the day it is done in (`lane`, a
 * variant: both lanes are drawn, task or none, in the order the rows' `lanes`
 * list them). A drop on another kind's row writes the task's kind, on another
 * press's its press, on the other lane its half; each is a draft Save writes.
 */
export const planPressTasks = example({
    keywords: [
        "Plan", "Schedule.events", "child", "child rows", "rows beneath a resource", "lane", "lanes", "variant lane", "AM", "PM",
        "Plan.series.kinds", "Plan.series.resources", "Plan.children", "keyType", "variant key", "Plan.lane", "buckets",
        "Slice.bindRecords", "Data.bindPaged", "index.nestedSeries", "index.nestedSeries.rows", "index.flatSeries", "index.summary", "Record.bind", "#1541",
    ],
    description: "Every machine of a works with its rows beneath it — a press its ink temperature and a row for each kind of task it takes (its own child rows, keyed by a variant: Plan.children under a Plan.series.kinds case), a folder its utilisation — and one event kind landing a step beneath its resource: each task on its press's row, then its kind's row (child: { field, of }), in its half's lane (a variant lane, both lanes always drawn); a drop on another kind's row, press or lane writes the field that places it",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const tasks = $.let(Record.bind(planPressTaskRows, ["patch"]));
            const taskEntries = $.let(Data.bindPaged(planPressTaskRows));
            // One rail: the machines paged by name beside their nested index, and the tasks by their day.
            const slice = $.let(Slice.bindRecords("ex.planPressTasks", {
                rows: {
                    source: Data.bindPaged(planPressMachines, { indexes: ["plan_press_machines_by_name", "plan_press_machines_in_time"] }),
                    label: "Machines", icon: { prefix: "fas", name: "print" }, search: ["name"],
                },
                task: {
                    source: Data.bindPaged(planPressTaskRows, {
                        indexes: ["plan_press_tasks_by_day", "plan_press_tasks_by_time", "plan_press_tasks_by_press_week", "plan_press_tasks_by_press_month"],
                        // The tasks' totals, which the horizon's bars read (#1732).
                        totals: ["plan_press_tasks_day_totals", "plan_press_tasks_week_totals", "plan_press_tasks_month_totals", "plan_press_tasks_quarter_totals", "plan_press_tasks_year_totals"],
                    }),
                    label: "Press tasks", icon: { prefix: "fas", name: "list-check" }, fields: { day: { label: "Days" } }, range: "day",
                },
            }));
            return <Box width="100%" height="620px"><Plan id="planPressTasks" slice={{ slice }}
                axis={Plan.axis({
                    window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                    resolution: "day", resolutions: ["day", "week", "month"],
                })}
                series={[
                    Plan.series.kinds(PressMachine, "what", {
                        press: {
                            title: "Presses", icon: "print", label: (press) => press.name,
                            // The press's ink temperature, a chart of its own readings.
                            series: [Plan.series.chart(PressMachine, {
                                key: "temperature", title: "Ink temperature", label: () => "Ink °C",
                                layers: [Plan.line(Plan.values("temperature", (t) => ({ y: t })))],
                            })],
                            // Beneath the press, after its series: a row per kind of task it takes, each day in AM and PM
                            // lanes, in this order — the rows the tasks land on.
                            children: Plan.children("kinds", [Plan.series.resources(PressTaskKindRow, {
                                key: "kinds", title: "Tasks", icon: "list-check", keyType: PressTaskKind, label: (kind) => kind.name,
                                lanes: () => [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
                            })]),
                        },
                        folder: {
                            title: "Folders", icon: "layer-group", label: (folder) => folder.name,
                            series: [Plan.series.heat(PressMachine, {
                                key: "utilisation", title: "Utilisation",
                                cells: Plan.heatCells(Plan.values("utilisation", (pct) => ({ value: some(pct) })), { min: 0, max: 100, warnAt: 95 }),
                            })],
                        },
                    }),
                ]}
                // The one event kind: on its press's row, then its kind's row beneath it, in its half's lane.
                events={{
                    task: Schedule.events(tasks, {
                        name: "Press task", icon: "list-check", draw: "buckets", title: "title", at: "day", state: "state",
                        resource: { field: "press", of: "press" },
                        child: { field: "kind", of: "kinds" },
                        lane: "half",
                        entries: taskEntries,
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

/**
 * One press's own page (#1541, U2, U11): the works' page scoped on the rail to
 * the press the page is for, its own row not drawn (`row: false`), so its ink
 * temperature and its kinds' rows stand at the root.
 *
 * The scope is a narrowing the page holds: the machines' reads carry the
 * press's code and the tasks' its press, the rail shows no control for either,
 * and nothing the viewer does clears them. A task made here takes its press
 * from the scope and its kind from the row it lands on.
 */
export const planOnePress = example({
    keywords: [
        "Plan", "row: false", "a press's page", "scope", "page parameter", "Slice.bindRecords", "Plan.series.kinds", "Plan.children",
        "Plan.series.resources", "child", "lane", "variant lane", "pinned", "Schedule.events", "index.key", "index.on", "index.nestedSeries",
        "Data.bindPaged", "Record.bind", "State", "Select", "#1541", "#1621",
    ],
    description: "One press's own page — the works' page scoped on the rail to the press the page is for (scope: { code: [press] } over an index.key of the row's key, and the tasks' scope: { press: [press] }), the press's own row not drawn (row: false on its Plan.series.kinds case, the folders' case switched off) so its pinned ink temperature and a row for each kind of task it takes stand at the root; each task on its kind's row in its half's lane",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The page's parameter: the press it is for, which an app's page takes from its route — chosen here.
            const chosen = $.let(State.bind([StringType], "ex.planOnePress.press", "P03"));
            const press = $.let(chosen.read());
            const onPress = $.const(East.function([StringType], NullType, ($2, next) => { $2(chosen.write(next)); }));
            const tasks = $.let(Record.bind(planPressTaskRows, ["patch"]));
            const taskEntries = $.let(Data.bindPaged(planPressTaskRows));
            // The machines scoped to the press by its code, and the tasks to it by their press, with the rail's days.
            // Each press's page keeps its own choices.
            const slice = $.let(Slice.bindRecords(East.str`ex.planOnePress.${press}`, {
                rows: {
                    source: Data.bindPaged(planPressMachines, { indexes: ["plan_press_machines_by_code", "plan_press_machines_in_time"] }),
                    scope: { code: [press] },
                },
                task: {
                    source: Data.bindPaged(planPressTaskRows, {
                        indexes: [
                            "plan_press_tasks_by_press", "plan_press_tasks_by_press_day", "plan_press_tasks_by_press_time",
                            "plan_press_tasks_by_press_week", "plan_press_tasks_by_press_month",
                        ],
                        // The tasks' totals led by the press the scope holds, which the horizon's bars read (#1732).
                        totals: ["plan_press_tasks_by_press_day_totals", "plan_press_tasks_by_press_week_totals", "plan_press_tasks_by_press_month_totals", "plan_press_tasks_by_press_quarter_totals", "plan_press_tasks_by_press_year_totals"],
                    }),
                    scope: { press: [press] },
                    label: "Tasks", icon: { prefix: "fas", name: "list-check" }, fields: { day: { label: "Days" } }, range: "day",
                },
            }));
            return <VStack gap="3" align="stretch" width="100%">
                <HStack gap="2" align="center"><Text>Press</Text><Select value={press} onChange={onPress}
                    items={[Select.Item("P03", "Heidelberg 3"), Select.Item("P04", "Heidelberg 4")]} /></HStack>
                <Box width="100%" height="520px"><Plan id="planOnePress" slice={{ slice }}
                    axis={Plan.axis({
                        window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                        resolution: "day", resolutions: ["day", "week", "month"],
                    })}
                    series={[
                        Plan.series.kinds(PressMachine, "what", {
                            // The press's own row is not drawn: its series and its kinds' rows stand at the root.
                            press: {
                                title: "Press", row: false,
                                // The press's ink temperature, pinned under the ruler.
                                series: [Plan.series.chart(PressMachine, {
                                    key: "temperature", title: "Ink temperature", label: () => "Ink °C", pinned: () => true,
                                    layers: [Plan.line(Plan.values("temperature", (t) => ({ y: t })))],
                                })],
                                children: Plan.children("kinds", [Plan.series.resources(PressTaskKindRow, {
                                    key: "kinds", title: "Tasks", icon: "list-check", keyType: PressTaskKind, label: (kind) => kind.name,
                                    lanes: () => [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
                                })]),
                            },
                            // Not drawn: the scope holds a press alone.
                            folder: false,
                        }),
                    ]}
                    events={{
                        task: Schedule.events(tasks, {
                            name: "Press task", icon: "list-check", draw: "buckets", title: "title", at: "day", state: "state",
                            resource: { field: "press", of: "press" },
                            child: { field: "kind", of: "kinds" },
                            lane: "half",
                            entries: taskEntries,
                        }),
                    }}
                    library={[Plan.library.series()]}
                    inspector
                    style={{ height: "fill" }} />
                </Box>
            </VStack>;
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * The same kinds of task under every press, from a list of the works' own
 * (#1541, U12): `Plan.children.of` steps down to child rows a function
 * returns, where `Plan.children` names a field of the row. The rows are read
 * with their parent and are read only; an event kind's `child` lands on them
 * as on a press's own.
 */
export const planPressKinds = example({
    keywords: [
        "Plan", "Plan.children.of", "child rows from a list", "shared rows", "read only", "Plan.series.kinds", "Plan.series.resources",
        "child", "lane", "variant lane", "keyType", "variant key", "Schedule.events", "Data.bind", "Record.bind", "#1541",
    ],
    description: "The same rows under every resource, from a list of the app's own — Plan.children.of(() => kinds.read(), [series]) steps down to child rows a function returns (Plan.children names a field of the row instead): every press draws a row for each kind of task the works lists, read only, and the tasks' event kind lands on them by its child field, in its half's lane",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const machines = $.let(Record.bind(planPressMachines, []));
            const kinds = $.let(Data.bind(planPressKindList));
            const tasks = $.let(Record.bind(planPressTaskRows, ["patch"]));
            return <Box width="100%" height="560px"><Plan id="planPressKinds"
                axis={Plan.axis({ window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-19T00:00:00Z") }, resolution: "day" })}
                data={machines.read()}
                series={[
                    Plan.series.kinds(PressMachine, "what", {
                        press: {
                            title: "Presses", icon: "print", label: (press) => press.name,
                            // Beneath every press, the works' kinds of task: the list's rows, not the press's own.
                            children: Plan.children.of(() => kinds.read(), [Plan.series.resources(PressTaskKindRow, {
                                key: "kinds", title: "Tasks", icon: "list-check", keyType: PressTaskKind, label: (kind) => kind.name,
                                lanes: () => [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
                            })]),
                        },
                        folder: { title: "Folders", icon: "layer-group", label: (folder) => folder.name },
                    }),
                ]}
                events={{
                    task: Schedule.events(tasks, {
                        name: "Press task", icon: "list-check", draw: "buckets", title: "title", at: "day", state: "state",
                        resource: { field: "press", of: "press" },
                        child: { field: "kind", of: "kinds" },
                        lane: "half",
                    }),
                }}
                inspector
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});

/**
 * A press's kinds of task under a header: `Plan.series.section` around the
 * rows `Plan.children` steps down to, so each press draws a Tasks header that
 * folds its kinds' rows.
 *
 * A section draws its own entries by its members, so it is keyed as they are —
 * by the kind here, a variant, which each row's sub line reads — and declares
 * no key type of its own. It adds no step to a row's path: each task still
 * lands on its press's row of its kind (`child`), beneath the header.
 */
export const planPressSections = example({
    keywords: [
        "Plan", "Plan.series.section", "section", "header", "section header", "rows under a header", "fold", "child rows", "keyType",
        "variant key", "Plan.children", "Plan.series.resources", "Plan.series.kinds", "child", "Schedule.events", "lane", "buckets",
        "Slice.bindRecords", "Data.bindPaged", "index.nestedSeries", "index.flatSeries", "index.summary", "Record.bind",
    ],
    description: "A header over a resource's child rows — Plan.series.section around the rows Plan.children steps down to, keyed as they are (by a variant here: a section takes its key type from its members, and declares none): each press's kinds of task beneath a Tasks header that folds them, each row's sub line read off its key, and the tasks' event kind landing on its kind's row beneath the header (child: { field, of })",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const tasks = $.let(Record.bind(planPressTaskRows, ["patch"]));
            const taskEntries = $.let(Data.bindPaged(planPressTaskRows));
            // One rail, as the works' page has: the machines paged by name beside their nested index, and the tasks by their day.
            const slice = $.let(Slice.bindRecords("ex.planPressSections", {
                rows: {
                    source: Data.bindPaged(planPressMachines, { indexes: ["plan_press_machines_by_name", "plan_press_machines_in_time"] }),
                    label: "Machines", icon: { prefix: "fas", name: "print" }, search: ["name"],
                },
                task: {
                    source: Data.bindPaged(planPressTaskRows, {
                        indexes: ["plan_press_tasks_by_day", "plan_press_tasks_by_time", "plan_press_tasks_by_press_week", "plan_press_tasks_by_press_month"],
                        // The tasks' totals, which the horizon's bars read.
                        totals: ["plan_press_tasks_day_totals", "plan_press_tasks_week_totals", "plan_press_tasks_month_totals", "plan_press_tasks_quarter_totals", "plan_press_tasks_year_totals"],
                    }),
                    label: "Press tasks", icon: { prefix: "fas", name: "list-check" }, fields: { day: { label: "Days" } }, range: "day",
                },
            }));
            return <Box width="100%" height="520px"><Plan id="planPressSections" slice={{ slice }}
                axis={Plan.axis({
                    window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-19T00:00:00Z") },
                    resolution: "day", resolutions: ["day", "week", "month"],
                })}
                series={[
                    Plan.series.kinds(PressMachine, "what", {
                        press: {
                            title: "Presses", icon: "print", label: (press) => press.name,
                            // Beneath the press, a Tasks header over a row for each kind of task it takes. The header is keyed
                            // as its rows are, by the kind, and says so nowhere: its rows' `keyType` is its own.
                            children: Plan.children("kinds", [
                                Plan.series.section(PressTaskKindRow, { key: "tasks", title: "Tasks" }, [
                                    Plan.series.resources(PressTaskKindRow, {
                                        key: "kinds", title: "Kinds of task", icon: "list-check", keyType: PressTaskKind, label: (kind) => kind.name,
                                        // What the kind is, read off the row's key.
                                        sub: (_row, kind) => some(kind.match({
                                            blanket_wash: () => "Wash", ink_fill: () => "Ink", plate_check: () => "Check", roller_wash: () => "Wash",
                                        })),
                                        lanes: () => [Plan.lane({ key: "am", label: "AM" }), Plan.lane({ key: "pm", label: "PM" })],
                                    }),
                                ]),
                            ]),
                        },
                        // Not drawn: the page is the presses'.
                        folder: false,
                    }),
                ]}
                // The one event kind: on its press's row, then its kind's row beneath the header, in its half's lane.
                events={{
                    task: Schedule.events(tasks, {
                        name: "Press task", icon: "list-check", draw: "buckets", title: "title", at: "day", state: "state",
                        resource: { field: "press", of: "press" },
                        child: { field: "kind", of: "kinds" },
                        lane: "half",
                        entries: taskEntries,
                    }),
                }}
                inspector
                style={{ height: "fill" }} />
            </Box>;
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planConnect — links drawn by hand: the Connect tool, Connect to…, a link kind's templates and the veto
// ============================================================================

/** The jobs the connect example joins, in a record of their own, so no other example's edits meet them. */
export const planConnectJobs = e3.record("plan_connect_jobs", DictType(StringType, PrintJob), {
    initial: new Map([
        ["J-5001", { title: "Guide covers", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 8000.0, customer: "", stock: variant("board", null), due: none }],
        ["J-5002", { title: "Guide pages", start: some(new Date("2026-10-07T06:00:00Z")), end: some(new Date("2026-10-08T06:00:00Z")), press: some("a2"), state: variant("confirmed", null), sheets: 64000.0, customer: "", stock: variant("uncoated", null), due: none }],
        ["J-5003", { title: "Guide inserts", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T18:00:00Z")), press: some("b1"), state: variant("confirmed", null), sheets: 16000.0, customer: "", stock: variant("coated", null), due: none }],
        ["J-5004", { title: "Guide wraps", start: some(new Date("2026-10-09T06:00:00Z")), end: some(new Date("2026-10-09T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 8000.0, customer: "", stock: variant("coated", null), due: none }],
    ]),
    mutations: (mutation) => ({
        // The jobs' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});

/** A handover between two print jobs: the job whose sheets leave, the job they go into, how many, and what carries them. */
export const PrintHandover = StructType({ from: StringType, to: StringType, sheets: FloatType, carrier: StringType });

/** The works' handovers, a record of their own: one to start with, the rest drawn by hand. */
export const planConnectHandovers = e3.record("plan_connect_handovers", DictType(StringType, PrintHandover), {
    initial: new Map([
        ["H-1", { from: "J-5001", to: "J-5002", sheets: 8000.0, carrier: "Pallet" }],
    ]),
    mutations: (mutation) => ({
        // The handovers' patch door — Save writes each one drawn through it.
        patch: mutation.patch(),
    }),
});

/** A handover's preset: its name in the library, and a value for every field of a handover but its two jobs. */
export const PrintHandoverTemplate = StructType({ name: StringType, values: StructType({ sheets: FloatType, carrier: StringType }) });

/** The handovers' presets. A Plan never writes them: the library lists them, and a handover drawn takes the one held. */
export const planConnectHandoverTemplates = e3.record("plan_connect_handover_templates", DictType(StringType, PrintHandoverTemplate), {
    initial: new Map([
        ["pallet", { name: "Pallet of 5,000", values: { sheets: 5000.0, carrier: "Pallet" } }],
        ["trolley", { name: "Trolley of 1,000", values: { sheets: 1000.0, carrier: "Trolley" } }],
    ]),
});

/**
 * Links drawn by hand (#1541, U10): a handover of sheets from one print job to
 * another, a link kind over a record of its own.
 *
 * - **By pointer:** pick Connect in the toolbar, then drag from a job onto
 *   another. The line follows the pointer out of the job's end and snaps into
 *   the other's start; the drop draws the handover, a draft Save writes with
 *   the Plan's others.
 * - **By keyboard:** select a job; its inspector's Connect to lists the jobs a
 *   handover may run to, and a choice draws it.
 * - **Templates:** the library's Events tab lists the handovers' presets under
 *   the kind's name. A click holds one, and a handover drawn takes its sheets
 *   and its carrier; with none held it takes each field's default.
 * - **The veto:** `canConnect` is asked of every link before it is drawn, by
 *   the drag and by Connect to alike. Here the wraps take no handover, and
 *   the refusal is the app's own words.
 */
export const planConnect = example({
    keywords: [
        "Plan", "Connect", "connect tool", "draw a link", "links", "Plan.links", "link kind", "templates", "Schedule.templates", "preset",
        "canConnect", "Plan.Types.ConnectCandidate", "veto", "refusal", "inspector", "Connect to", "keyboard", "library",
        "Plan.library.events", "Schedule.events", "Plan.series.resources", "Record.bind", "Data.bind", "e3.record", "#1541",
    ],
    description: "Links drawn by hand — a handover of sheets from one print job to another, a link kind over a record of its own (Plan.links): the toolbar's Connect tool draws one by a drag from a job onto another, a selected job's inspector draws one by keyboard (Connect to), the library's Events tab holds the kind's templates (Schedule.templates) whose values a new handover takes, and canConnect refuses a link in the app's own words (Plan.Types.ConnectCandidate)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(planPrintPresses, []));
            const jobs = $.let(Record.bind(planConnectJobs));
            const handovers = $.let(Record.bind(planConnectHandovers));
            const presets = $.let(Data.bind(planConnectHandoverTemplates));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-12T00:00:00Z") },
                resolution: "day", now: new Date("2026-10-07T09:00:00Z"),
            }));
            // The Plan's one check of a link before it is drawn, over what it would join (`Plan.Types.ConnectCandidate`): the
            // link kind, and the two events by their kind and key. The wraps are sealed, and take no handover.
            const canConnect = $.const(East.function([Plan.Types.ConnectCandidate], OptionType(StringType), ($2, candidate) => {
                const reason = $2.let(none, OptionType(StringType));
                $2.if(candidate.kind.equal("handover").and(() => candidate.to.key.equal("J-5004")), $3 => {
                    $3.assign(reason, some("The wraps are sealed; hand over to another job"));
                });
                return reason;
            }));
            return (
                <Box height="420px">
                    <Plan
                        id="connect"
                        axis={axis}
                        data={presses.read()}
                        series={[Plan.series.resources(PrintPress, { key: "presses", title: "Presses", icon: "print", label: p => p.name })]}
                        events={{
                            job: Schedule.events(jobs, {
                                name: "Print job", icon: "file-lines",
                                title: "title", start: "start", end: "end",
                                resource: { field: "press", of: "presses" },
                                state: "state",
                            }),
                        }}
                        // The handovers, one link kind over a record of its own: each row a link, its ends the keys of the
                        // two jobs it joins. Its templates are a record's, each a value for every field but the two ends.
                        links={{
                            handover: Plan.links(handovers, {
                                name: "Handover", icon: "arrow-right-long",
                                from: { field: "from", of: "job" },
                                to: { field: "to", of: "job" },
                                quantity: { field: "sheets", unit: "sheets" },
                                templates: Schedule.templates(presets.read(), { name: t => t.name, values: t => t.values }),
                            }),
                        }}
                        canConnect={canConnect}
                        // The Events tab lists the handovers' templates; the inspector offers Connect to on a selected job.
                        library={[Plan.library.events()]}
                        inspector
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planTypedKeys — an event kind whose record is keyed by a variant
// ============================================================================

/** A job's key: an order's number, or a sample's — the works' own proofs, numbered apart from its orders. */
export const PrintJobKey = VariantType({ order: StringType, sample: IntegerType });

/** The jobs by their key, an order's or a sample's. */
export const PrintKeyedJobs = DictType(PrintJobKey, PrintJob);

/** A job of the typed keys' example, on a press over some hours of a day of its week. */
const keyedJob = (title: string, press: string, day: number, from: number, to: number, sheets: number) => ({
    title, start: some(new Date(Date.UTC(2026, 9, 5 + day, from))), end: some(new Date(Date.UTC(2026, 9, 5 + day, to))), press: some(press),
    state: variant("confirmed", null), sheets, customer: "", stock: variant("coated", null), due: none,
});

/** Two orders and two samples, a record keyed by which each is: an order by its number, a sample by its own. */
export const planKeyedJobs = e3.record("plan_keyed_jobs", PrintKeyedJobs, {
    initial: new SortedMap<ValueTypeOf<typeof PrintJobKey>, ValueTypeOf<typeof PrintJob>>([
        [variant("order", "J-8001"), keyedJob("Trade catalogue", "a1", 1, 6, 18, 96000.0)],
        [variant("order", "J-8002"), keyedJob("Trade price list", "a2", 2, 6, 14, 24000.0)],
        [variant("sample", 1n), keyedJob("Catalogue proof", "a1", 0, 9, 11, 200.0)],
        [variant("sample", 2n), keyedJob("Price list proof", "a2", 1, 13, 15, 100.0)],
    ], compareFor(PrintJobKey)),
    mutations: (mutation) => ({
        // The jobs' patch door — every Save commits through it, each job by its typed key.
        patch: mutation.patch(),
    }),
});

/** A sign-off: the proof a job waits on, each end a job's key in the jobs' own key type. */
export const PrintSignOff = StructType({ from: PrintJobKey, to: PrintJobKey, sheets: FloatType });

/** The works' sign-offs, a record of links: the catalogue's proof to its run to start with. */
export const planKeyedSignOffs = e3.record("plan_keyed_sign_offs", DictType(StringType, PrintSignOff), {
    initial: new Map([
        ["S-1", { from: variant("sample", 1n), to: variant("order", "J-8001"), sheets: 200.0 }],
    ]),
    mutations: (mutation) => ({
        // The sign-offs' patch door — Save writes each one drawn through it.
        patch: mutation.patch(),
    }),
});

/**
 * The typed keys' now: where its Plan draws the now line, and before which its optimiser places nothing (#1680's
 * review). A live app's optimiser reads its clock instead.
 */
export const TYPED_KEYS_NOW = new Date("2026-10-06T09:00:00Z");

/**
 * The typed keys' optimiser, on e3: every sample in the window runs first, at six in the morning of the window's first
 * day — or from now, where that has passed: none in the past — for its two hours. It reads the jobs with the Plan's
 * unsaved edits laid over them, and answers a patch of them, each job named by its typed key.
 */
export const proofsFirst = e3.function("plan_proofs_first", {
    inputs: [planKeyedJobs],
    drafts: [planKeyedJobs],
    args: [Plan.Types.OptimiseRequest],
    output: Plan.Types.OptimiseResult({ job: PrintKeyedJobs }),
}, ($, jobs, request) => {
    const before = $.let(new Map(), PrintKeyedJobs);
    const after = $.let(new Map(), PrintKeyedJobs);
    // Six in the morning of the window's first day, or now where that has passed: where a proof runs, for its two hours.
    const six = $.const(request.from.addHours(6n));
    const now = $.const(TYPED_KEYS_NOW);
    const first = $.const(East.less(six, now).ifElse(() => now, () => six));
    $.for(jobs, ($2, job, key) => {
        const inWindow = $2.const(job.start.match({
            some: (_$3, start) => East.greaterEqual(start, request.from).and(() => East.less(start, request.to)),
            none: () => false,
        }));
        $2.if(key.hasTag("sample").and(() => inWindow), ($3) => {
            $3(before.insert(key, job));
            $3(after.insert(key, {
                title: job.title, start: some(first), end: some(first.addHours(2n)), press: job.press,
                state: job.state, sheets: job.sheets, customer: job.customer, stock: job.stock, due: job.due,
            }));
        });
    });
    return { events: { job: East.diff(before, after) } };
});

/**
 * An event kind whose record is keyed by a variant (#1541, any key type): the
 * works' jobs, each an order by its number or a sample by its own. Nothing of
 * the Plan is written differently for it. Its events draw, are dragged, drafted
 * and saved by their typed key; a link kind's ends hold that key in its own
 * type (`PrintSignOff`'s `from` and `to`); and the optimiser's answer is a
 * patch of the record, each job named by it.
 */
export const planTypedKeys = example({
    keywords: [
        "Plan", "key type", "typed key", "variant key", "any key type", "record keyed by a variant", "Schedule.events", "Plan.links",
        "link ends", "optimise", "Func.bind", "Plan.Types.OptimiseRequest", "Plan.Types.OptimiseResult", "East.diff", "patch",
        "Record.bind", "Plan.series.resources", "#1541", "#1549",
    ],
    description: "An event kind whose record is keyed by a variant — the works' jobs, each an order by its number or a sample by its own (Dict<Variant<{ order: String, sample: Integer }>, Job>): its events draw, are dragged, drafted and saved by their typed key, a link kind's ends hold that key in its own type (Plan.links over a record whose `from` and `to` are the jobs' key), and the optimiser's answer is a patch of the record naming each job by it",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(planPrintPresses, []));
            const jobs = $.let(Record.bind(planKeyedJobs));
            const signOffs = $.let(Record.bind(planKeyedSignOffs));
            const optimise = $.let(Func.bind(proofsFirst));
            return (
                <Box height="420px">
                    <Plan
                        id="planTypedKeys"
                        axis={Plan.axis({
                            window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-10-12T00:00:00Z") },
                            resolution: "day", now: TYPED_KEYS_NOW,
                        })}
                        data={presses.read()}
                        series={[Plan.series.resources(PrintPress, { key: "presses", title: "Presses", icon: "print", label: p => p.name })]}
                        // The jobs, a record keyed by a variant: written as a kind over any record is.
                        events={{
                            job: Schedule.events(jobs, {
                                name: "Print job", icon: "file-lines",
                                title: "title", start: "start", end: "end",
                                resource: { field: "press", of: "presses" },
                                state: "state",
                            }),
                        }}
                        // The sign-offs: each end the key of a job, in the jobs' own key type.
                        links={{
                            signOff: Plan.links(signOffs, {
                                name: "Sign-off", icon: "check",
                                from: { field: "from", of: "job" },
                                to: { field: "to", of: "job" },
                                quantity: { field: "sheets", unit: "sheets" },
                            }),
                        }}
                        // The works' optimiser: the eye calls it once a run, and its patch names each job by its typed key.
                        optimise={optimise}
                        inspector
                    />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planPrintWorksRecords — the print works over plain records (#1541 §3)
// ============================================================================

/** What a resource of the works is. */
export const WorksResourceKind = VariantType({ bay: NullType, crew: NullType, line: NullType, press: NullType, van: NullType });

/** A role in a crew: the key of a crew's hours. */
export const WorksRole = VariantType({ assistant: NullType, operator: NullType });

/** A role's planned hours in its crew, a value a week. */
export const WorksRoleHours = StructType({ hours: DictType(DateTimeType, FloatType) });

/**
 * A resource and what belongs to it over time, each collection empty on the
 * kinds without it: a press fills `utilisation`, a crew `hours`.
 */
export const WorksResource = StructType({
    name: StringType,
    what: WorksResourceKind,
    /** The share of each day it is busy, in %. */
    utilisation: DictType(DateTimeType, FloatType),
    /** Its planned hours by role: child rows keyed by the role, a variant. */
    hours: DictType(WorksRole, WorksRoleHours),
});

/** A group: a hall's presses, a hall's crews, the bindery, dispatch or the vans, and its resources by their code. */
export const WorksGroup = StructType({ name: StringType, resources: DictType(StringType, WorksResource) });

/** A day of the works' four weeks, by its place among them. */
const worksDay = (n: number, hour = 0): Date => new Date(Date.UTC(2026, 9, 5 + n, hour));
/** A press's utilisation, a reading a day over the four weeks: a level, and a rise through each week. */
const worksUtilisation = (level: number) =>
    new SortedMap(Array.from({ length: 28 }, (_, n) => [worksDay(n), n % 7 >= 5 ? 0 : level + 6 * (n % 5)] as const), compareFor(DateTimeType));
/** No reading, and no hours: what a resource of another kind holds. */
const noWorksReadings = () => new SortedMap<Date, number>([], compareFor(DateTimeType));
const noWorksHours = () => new SortedMap<ValueTypeOf<typeof WorksRole>, ValueTypeOf<typeof WorksRoleHours>>([], compareFor(WorksRole));
/** A crew's planned hours: its operators' and its assistants', a value each of the four weeks. */
const worksHours = (operators: number, assistants: number) => new SortedMap<ValueTypeOf<typeof WorksRole>, ValueTypeOf<typeof WorksRoleHours>>([
    [variant("assistant", null), { hours: new SortedMap(Array.from({ length: 4 }, (_, w) => [worksDay(7 * w), assistants + 4 * w] as const), compareFor(DateTimeType)) }],
    [variant("operator", null), { hours: new SortedMap(Array.from({ length: 4 }, (_, w) => [worksDay(7 * w), operators - 2 * w] as const), compareFor(DateTimeType)) }],
], compareFor(WorksRole));
/** A resource of a kind, by its name. */
const worksResource = (name: string, what: keyof typeof WorksResourceKind.cases, level?: number, crew?: readonly [number, number]) => ({
    name, what: variant(what, null),
    utilisation: level === undefined ? noWorksReadings() : worksUtilisation(level),
    hours: crew === undefined ? noWorksHours() : worksHours(crew[0], crew[1]),
});

/**
 * The works as one record of rows (#1541 §3.1): each group with its resources,
 * and what belongs to a resource over time with it — a press's utilisation a
 * day, a crew's hours a week by role. Read a page at a time through its
 * indexes, each collection a day at a time through its nested series index.
 */
export const planWorksRows = e3.record("plan_works_rows", DictType(StringType, WorksGroup), {
    initial: new Map([
        ["1-presses-a", { name: "Hall A", resources: new Map([
            ["a1", worksResource("Press A1", "press", 62)], ["a2", worksResource("Press A2", "press", 48)], ["a3", worksResource("Press A3", "press", 71)],
        ]) }],
        ["2-presses-b", { name: "Hall B", resources: new Map([
            ["b1", worksResource("Press B1", "press", 55)], ["b2", worksResource("Press B2", "press", 73)], ["b3", worksResource("Press B3", "press", 30)],
        ]) }],
        ["3-crews-a", { name: "Hall A crews", resources: new Map([
            ["c1", worksResource("Crew 1", "crew", undefined, [152, 76])], ["c2", worksResource("Crew 2", "crew", undefined, [114, 76])],
        ]) }],
        ["4-crews-b", { name: "Hall B crews", resources: new Map([
            ["c3", worksResource("Crew 3", "crew", undefined, [152, 38])], ["c4", worksResource("Crew 4", "crew", undefined, [76, 38])],
        ]) }],
        ["5-bindery", { name: "Bindery", resources: new Map([["fold", worksResource("Folder", "line")], ["bind", worksResource("Binder", "line")]]) }],
        ["6-dispatch", { name: "Dispatch", resources: new Map([["bay", worksResource("Dispatch bay", "bay")]]) }],
        ["7-vans", { name: "Vans", resources: new Map([["van1", worksResource("Van 1", "van")], ["van2", worksResource("Van 2", "van")]]) }],
    ]),
    indexes: (index) => ({
        // The rail's order and its search.
        plan_works_rows_by_name: index.on(["name"]),
        // A group under each of its resources' codes, a field of the rail's (`code`), so the rail finds a press by its code.
        plan_works_rows_by_resource: index.keys(East.function([StringType, WorksGroup], SetType(StructType({ code: StringType })), ($, _key, group) => {
            const codes = $.let(new Set<{ code: string }>(), SetType(StructType({ code: StringType })));
            $.for(group.resources, ($2, _resource, code) => { $2(codes.insert({ code })); });
            return codes;
        })),
        // What belongs to the resources, a day at a time, its totals by the month: a press's utilisation, and a crew's
        // hours by role, the crew keeping its roles' sum from the day up — the finest the Plan's axis zooms to.
        plan_works_rows_in_time: index.nestedSeries({
            collections: {
                resources: index.nestedSeries.rows({
                    utilisation: index.nestedSeries.values(),
                    hours: index.nestedSeries.rows({ hours: index.nestedSeries.values({ rollup: "sum" }) }),
                }),
            },
            tile: "day",
            summary: "month",
        }),
    }),
    mutations: (mutation) => ({
        // The Plan's save door for the rows, by a group's key.
        patch: mutation.patch(),
    }),
});

/** A print job on a press: what it is, for whom, when it runs, its sheets and its lifecycle. */
export const WorksJob = StructType({
    title: StringType, customer: StringType, press: StringType, start: DateTimeType, end: DateTimeType, sheets: FloatType, state: EventStateType,
});

/** The jobs by key. */
export const WorksJobs = DictType(StringType, WorksJob);

/** A job of the works, on a press from an hour of a day for some hours. */
const worksJob = (title: string, customer: string, press: string, day: number, hour: number, hours: number, sheets: number, state: ValueTypeOf<typeof EventStateType> = variant("confirmed", null)) =>
    ({ title, customer, press, start: worksDay(day, hour), end: worksDay(day, hour + hours), sheets, state });

/** The works' jobs: read a window at a time, and each press's a cell at a time. One is under way, and locked. */
export const planWorksJobs = e3.record("plan_works_jobs", WorksJobs, {
    initial: new Map([
        ["J-9001", worksJob("Spring catalogue", "Alder & Finch", "a1", 1, 6, 12, 96000.0, variant("in-progress", null))],
        ["J-9002", worksJob("Course handbook", "Elmway College", "a1", 7, 6, 18, 144000.0)],
        ["J-9003", worksJob("Annual report", "Harbour Arts Society", "a2", 3, 6, 6, 48000.0)],
        ["J-9004", worksJob("Event posters", "Heathfield Theatre", "a2", 8, 8, 4, 20000.0)],
        ["J-9005", worksJob("Museum guides", "Harbour Arts Society", "a3", 2, 6, 8, 40000.0)],
        ["J-9006", worksJob("Store flyers", "Northwind Outfitters", "b1", 4, 6, 10, 150000.0)],
        ["J-9007", worksJob("Market posters", "Orchard Street Market", "b2", 8, 6, 6, 72000.0)],
        ["J-9008", worksJob("Price lists", "Northwind Outfitters", "b2", 9, 6, 5, 60000.0, variant("proposed", variant("added", null)))],
        ["J-9009", worksJob("Menu cards", "Orchard Street Market", "b3", 10, 8, 4, 12000.0)],
    ]),
    indexes: (index) => ({
        // The rail's window: each job overlapping it, read once.
        plan_works_jobs_by_time: index.interval({ from: "start", to: "end" }),
        // The jobs by the press each is on and by time: the presses in view are read a cell at a time.
        plan_works_jobs_by_press_week: index.flatSeries({ key: "press", from: "start", to: "end", tile: "week" }),
        // How busy each press is, a month at a time: what the Plan shades where the jobs in view are too many to draw.
        plan_works_jobs_by_press_month: index.summary({ key: "press", from: "start", to: "end", tile: "month" }),
        // The jobs' totals a day, a week, a month, a quarter and a year (#1732): what the horizon's bars read, with every other kind's.
        plan_works_jobs_day_totals: index.totals({ from: "start", to: "end", tile: "day" }),
        plan_works_jobs_week_totals: index.totals({ from: "start", to: "end", tile: "week" }),
        plan_works_jobs_month_totals: index.totals({ from: "start", to: "end", tile: "month" }),
        plan_works_jobs_quarter_totals: index.totals({ from: "start", to: "end", tile: "quarter" }),
        plan_works_jobs_year_totals: index.totals({ from: "start", to: "end", tile: "year" }),
    }),
    mutations: (mutation) => ({
        // The Plan's save door for the jobs.
        patch: mutation.patch(),
    }),
});

/** The works' stops: an instant each, its end its start. */
export const planWorksStops = e3.record("plan_works_stops", DictType(StringType, PrintStop), {
    initial: new Map([
        ["S-9001", { title: "Plate change", at: worksDay(3, 5), press: "a2", kind: variant("plate_change", null) }],
        ["S-9002", { title: "Service", at: worksDay(5, 9), press: "b3", kind: variant("service", null) }],
        ["S-9003", { title: "Plate change", at: worksDay(8, 5), press: "b2", kind: variant("plate_change", null) }],
    ]),
    indexes: (index) => ({
        plan_works_stops_by_time: index.interval({ from: "at", to: "at" }),
        plan_works_stops_by_press_week: index.flatSeries({ key: "press", from: "at", to: "at", tile: "week" }),
        plan_works_stops_by_press_month: index.summary({ key: "press", from: "at", to: "at", tile: "month" }),
        plan_works_stops_day_totals: index.totals({ from: "at", to: "at", tile: "day" }),
        plan_works_stops_week_totals: index.totals({ from: "at", to: "at", tile: "week" }),
        plan_works_stops_month_totals: index.totals({ from: "at", to: "at", tile: "month" }),
        plan_works_stops_quarter_totals: index.totals({ from: "at", to: "at", tile: "quarter" }),
        plan_works_stops_year_totals: index.totals({ from: "at", to: "at", tile: "year" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The works' bindery jobs. */
export const planWorksBindings = e3.record("plan_works_bindings", DictType(StringType, PrintBinding), {
    initial: new Map([
        ["B-9001", { title: "Fold handbook sections", start: worksDay(9, 6), end: worksDay(9, 14), line: "fold", state: variant("confirmed", null) }],
        ["B-9002", { title: "Fold handbook inserts", start: worksDay(9, 10), end: worksDay(9, 16), line: "fold", state: variant("confirmed", null) }],
        ["B-9003", { title: "Bind handbooks", start: worksDay(10, 6), end: worksDay(10, 14), line: "bind", state: variant("confirmed", null) }],
    ]),
    indexes: (index) => ({
        plan_works_bindings_by_time: index.interval({ from: "start", to: "end" }),
        plan_works_bindings_by_line_week: index.flatSeries({ key: "line", from: "start", to: "end", tile: "week" }),
        plan_works_bindings_by_line_month: index.summary({ key: "line", from: "start", to: "end", tile: "month" }),
        plan_works_bindings_day_totals: index.totals({ from: "start", to: "end", tile: "day" }),
        plan_works_bindings_week_totals: index.totals({ from: "start", to: "end", tile: "week" }),
        plan_works_bindings_month_totals: index.totals({ from: "start", to: "end", tile: "month" }),
        plan_works_bindings_quarter_totals: index.totals({ from: "start", to: "end", tile: "quarter" }),
        plan_works_bindings_year_totals: index.totals({ from: "start", to: "end", tile: "year" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The crews' shifts: early and late, the first week. */
export const planWorksShifts = e3.record("plan_works_shifts", DictType(StringType, PrintShift), {
    initial: new Map([
        ["H-9001", { title: "Early", start: worksDay(0, 6), end: worksDay(0, 14), crew: "c1", state: variant("confirmed", null) }],
        ["H-9002", { title: "Late", start: worksDay(0, 14), end: worksDay(0, 22), crew: "c2", state: variant("confirmed", null) }],
        ["H-9003", { title: "Early", start: worksDay(1, 6), end: worksDay(1, 14), crew: "c1", state: variant("confirmed", null) }],
        ["H-9004", { title: "Early", start: worksDay(1, 6), end: worksDay(1, 14), crew: "c3", state: variant("confirmed", null) }],
        ["H-9005", { title: "Late", start: worksDay(2, 14), end: worksDay(2, 22), crew: "c4", state: variant("proposed", variant("added", null)) }],
    ]),
    indexes: (index) => ({
        plan_works_shifts_by_time: index.interval({ from: "start", to: "end" }),
        plan_works_shifts_by_crew_week: index.flatSeries({ key: "crew", from: "start", to: "end", tile: "week" }),
        plan_works_shifts_by_crew_month: index.summary({ key: "crew", from: "start", to: "end", tile: "month" }),
        plan_works_shifts_day_totals: index.totals({ from: "start", to: "end", tile: "day" }),
        plan_works_shifts_week_totals: index.totals({ from: "start", to: "end", tile: "week" }),
        plan_works_shifts_month_totals: index.totals({ from: "start", to: "end", tile: "month" }),
        plan_works_shifts_quarter_totals: index.totals({ from: "start", to: "end", tile: "quarter" }),
        plan_works_shifts_year_totals: index.totals({ from: "start", to: "end", tile: "year" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** The works' deliveries, from the bay or a van: filed by the bay or the van itself, a variant. */
export const planWorksDeliveries = e3.record("plan_works_deliveries", DictType(StringType, PrintDispatch), {
    initial: new Map([
        ["D-9001", { title: "Handbooks", at: worksDay(11, 10), location: variant("bay", "bay"), lane: "AM", status: variant("queued", null), pallets: 3.0 }],
        ["D-9002", { title: "Event posters", at: worksDay(9, 14), location: variant("van", "van1"), lane: "PM", status: variant("ready", null), pallets: 2.0 }],
        ["D-9003", { title: "Museum guides", at: worksDay(4, 10), location: variant("van", "van2"), lane: "AM", status: variant("dispatched", null), pallets: 1.0 }],
    ]),
    indexes: (index) => ({
        plan_works_deliveries_by_time: index.interval({ from: "at", to: "at" }),
        // The key field is the variant, so a row's cells are asked by its key in its case.
        plan_works_deliveries_by_location_week: index.flatSeries({ key: "location", from: "at", to: "at", tile: "week" }),
        plan_works_deliveries_by_location_month: index.summary({ key: "location", from: "at", to: "at", tile: "month" }),
        plan_works_deliveries_day_totals: index.totals({ from: "at", to: "at", tile: "day" }),
        plan_works_deliveries_week_totals: index.totals({ from: "at", to: "at", tile: "week" }),
        plan_works_deliveries_month_totals: index.totals({ from: "at", to: "at", tile: "month" }),
        plan_works_deliveries_quarter_totals: index.totals({ from: "at", to: "at", tile: "quarter" }),
        plan_works_deliveries_year_totals: index.totals({ from: "at", to: "at", tile: "year" }),
    }),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/**
 * A feed: the sheets a job or a bindery job passes on to a bindery job or a
 * delivery. Each end holds the key of the event it joins, under its kind.
 */
export const WorksFeed = StructType({
    from: VariantType({ binding: StringType, job: StringType }),
    to: VariantType({ binding: StringType, delivery: StringType }),
    sheets: FloatType,
});

/** The planner's feeds, a record of links: the handbook from its press through the bindery to the bay. */
export const planWorksFeeds = e3.record("plan_works_feeds", DictType(StringType, WorksFeed), {
    initial: new Map([
        ["F-1", { from: variant("job", "J-9002"), to: variant("binding", "B-9001"), sheets: 144000.0 }],
        ["F-2", { from: variant("binding", "B-9001"), to: variant("binding", "B-9003"), sheets: 144000.0 }],
        ["F-3", { from: variant("binding", "B-9003"), to: variant("delivery", "D-9001"), sheets: 144000.0 }],
    ]),
    mutations: (mutation) => ({ patch: mutation.patch() }),
});

/** An order not yet planned, for the library's Orders tab. */
export const WorksOrder = StructType({ title: StringType, customer: StringType, sheets: FloatType, due: DateTimeType });

/** The works' orders to plan: the solution's own list, kept as it chooses. */
export const planWorksOrders = e3.record("plan_works_orders", DictType(StringType, WorksOrder), {
    initial: new Map([
        ["O-701", { title: "Season programme", customer: "Heathfield Theatre", sheets: 48000.0, due: worksDay(16) }],
        ["O-702", { title: "Autumn catalogue", customer: "Alder & Finch", sheets: 80000.0, due: worksDay(20) }],
        ["O-703", { title: "Members' newsletter", customer: "Harbour Arts Society", sheets: 16000.0, due: worksDay(12) }],
    ]),
});

/**
 * A preset: its name in the library, how long its event runs where it runs
 * any time, and what it gives the event it makes — a case for each event kind.
 * One record holds every kind's.
 */
export const WorksPreset = StructType({
    name: StringType,
    hours: FloatType,
    values: VariantType({
        job: StructType({ title: StringType, customer: StringType, sheets: FloatType, state: EventStateType }),
        stop: StructType({ title: StringType, kind: PrintStop.fields.kind }),
        binding: StructType({ title: StringType, state: EventStateType }),
        shift: StructType({ title: StringType, state: EventStateType }),
        delivery: StructType({ title: StringType, lane: StringType, status: PrintDispatchStatus, pallets: FloatType }),
    }),
});

/** The works' presets, every kind's in one record. A Plan never writes them: the library lists each kind's under its name. */
export const planWorksPresets = e3.record("plan_works_presets", DictType(StringType, WorksPreset), {
    initial: new Map([
        ["brochure", { name: "Brochure run", hours: 6.0, values: variant("job", { title: "Brochure run", customer: "", sheets: 40000.0, state: variant("proposed", variant("added", null)) }) }],
        ["poster", { name: "Poster run", hours: 4.0, values: variant("job", { title: "Poster run", customer: "", sheets: 20000.0, state: variant("proposed", variant("added", null)) }) }],
        ["plates", { name: "Plate change", hours: 0.0, values: variant("stop", { title: "Plate change", kind: variant("plate_change", null) }) }],
        ["service", { name: "Service", hours: 0.0, values: variant("stop", { title: "Service", kind: variant("service", null) }) }],
        ["fold", { name: "Fold sections", hours: 8.0, values: variant("binding", { title: "Fold sections", state: variant("confirmed", null) }) }],
        ["early", { name: "Early shift", hours: 8.0, values: variant("shift", { title: "Early", state: variant("confirmed", null) }) }],
        ["delivery", { name: "Morning delivery", hours: 0.0, values: variant("delivery", { title: "Delivery", lane: "AM", status: variant("queued", null), pallets: 1.0 }) }],
    ]),
    indexes: (index) => ({
        // The presets by name: what the rail's one templates source narrows them by.
        plan_works_presets_by_name: index.on(["name"]),
    }),
});

/** The works' stops, bindery jobs, shifts and deliveries, each by key. */
export const WorksStops = DictType(StringType, PrintStop);
export const WorksBindings = DictType(StringType, PrintBinding);
export const WorksShifts = DictType(StringType, PrintShift);
export const WorksDeliveries = DictType(StringType, PrintDispatch);

/** The works' optimiser's answer: a patch of each record the Plan edits, by its event kind's slot. */
export const WorksOptimiseResult = Plan.Types.OptimiseResult({
    binding: WorksBindings, delivery: WorksDeliveries, job: WorksJobs, shift: WorksShifts, stop: WorksStops,
});

/**
 * The works' now, over plain records: Tuesday 6 October at nine, while the spring catalogue is under way — where its
 * Plan draws the now line, and before which its optimiser places nothing (#1680's review). A live app's optimiser reads
 * its clock instead.
 */
export const WORKS_NOW = new Date("2026-10-06T09:00:00Z");

/**
 * The works' optimiser, on e3, by the builders' one contract (#1622): its
 * request is the dates in view, the run's number and the rail's narrowing,
 * and no row. Each order no job stands under yet is placed on the press free
 * soonest, from when that press is free — the window's start or the works'
 * now, whichever is later, or the end of its last job in the window — for as
 * long as its sheets take at 8,000 an hour, so none in the past. It reads each
 * press's jobs through their series index, the Plan's
 * unsaved jobs laid over them, the presses from the works' rows and the
 * orders from their record. Its answer is a patch of each record the Plan
 * edits: of the jobs an insert for each order placed, under the order's key,
 * and of every other kind no change.
 */
export const placeWorksOrders = e3.function("plan_works_place_orders", {
    inputs: [e3.index(planWorksJobs.indexes.plan_works_jobs_by_press_week), planWorksJobs, planWorksOrders, planWorksRows],
    // The Plan's unsaved edits of the jobs are laid over them, and over their index.
    drafts: [planWorksJobs],
    args: [Plan.Types.OptimiseRequest],
    output: WorksOptimiseResult,
}, ($, jobsByPress, jobs, orders, works, request) => {
    // Nothing is placed before now: from the window's start, or now where the window starts before it.
    const now = $.const(WORKS_NOW);
    const from = $.const(East.less(request.from, now).ifElse(() => now, () => request.from));
    // When each press is next free: from then, or past its last job in the window.
    const free = $.let(new Map(), DictType(StringType, DateTimeType));
    $.for(works, ($2, group) => {
        $2.for(group.resources, ($3, resource, code) => {
            $3.if(resource.what.hasTag("press"), ($4) => {
                const last = $4.let(from);
                jobsByPress.events({ key: code, from: request.from, to: request.to }).each($4, ($5, job) => {
                    $5.if(East.less(last, job.end), ($6) => { $6.assign(last, job.end); });
                });
                $4(free.insert(code, last));
            });
        });
    });
    const before = $.let(new Map(), WorksJobs);
    const after = $.let(new Map(), WorksJobs);
    $.for(orders, ($2, order, key) => {
        // An order a job stands under is planned already.
        $2.if(jobs.has(key).not().and(() => free.size().greater(0n)), ($3) => {
            const press = $3.const(free.toArray((_$4, at, code) => ({ code, at })).sort((_$4, slot) => slot.at).get(0n).code);
            const start = $3.const(free.get(press));
            // A job's hours on a press are its sheets at 8,000 an hour: its minutes, whole.
            const end = $3.const(start.addMinutes(East.Float.roundHalf(order.sheets.divide(8000.0).multiply(60.0))));
            // Within the window it was asked of: an order that would end past it stays an order.
            $3.if(East.lessEqual(end, request.to), ($4) => {
                $4(after.insert(key, {
                    title: order.title, customer: order.customer, press, start, end, sheets: order.sheets,
                    state: variant("proposed", variant("added", null)),
                }));
                $4(free.insertOrUpdate(press, end, (_$5, _held, later) => later));
            });
        });
    });
    return {
        events: {
            job: East.diff(before, after),
            binding: East.value(variant("unchanged", null), PatchType(WorksBindings)),
            delivery: East.value(variant("unchanged", null), PatchType(WorksDeliveries)),
            shift: East.value(variant("unchanged", null), PatchType(WorksShifts)),
            stop: East.value(variant("unchanged", null), PatchType(WorksStops)),
        },
    };
});

/**
 * The print works over plain records (#1541 §3): one record of rows — each
 * group with its resources, a press its utilisation and a crew its hours by
 * role — read a page at a time, what belongs to a resource a day at a time
 * through the rows' nested series index. The rows save through `record`.
 *
 * Five event kinds land on the rows by the kind of resource each is on
 * (`of`): jobs and stops on a press, bindery jobs on a line, shifts on a crew,
 * deliveries on a bay or a van. Every kind is read a cell at a time through
 * its own source of the one rail, by its series and summary indexes: over
 * paged rows no kind is read whole. The rail has a source for the rows, one
 * for each kind, one for the Customers tab and one for every kind's templates.
 *
 * - **Feeds** are a link kind over a record of their own: each joins a job or
 *   a bindery job to a bindery job or a delivery, its ends the events' keys.
 *   The Connect tool draws one.
 * - **Orders** are the solution's own list: a card dropped on a press makes a
 *   job there, as a template does.
 * - **Templates** are one record for every kind, and one source of the rail:
 *   each kind reads its own case of a preset's `values`.
 * - **The optimiser** places each order no job stands under yet on the press
 *   free soonest, by the builders' one contract: the dates in view in, a
 *   patch of the jobs out.
 * - A job under way is locked, by the works' own rule.
 */
export const planPrintWorksRecords = example({
    keywords: [
        "Plan", "print works", "one record of rows", "Plan.series.group", "Plan.series.kinds", "Plan.children", "Plan.series.table", "Plan.series.heat",
        "keyType", "variant key", "record", "Record.bind", "save door", "Slice.bindRecords", "rows", "Data.bindPaged", "index.nestedSeries", "index.keys",
        "index.interval", "index.flatSeries", "index.summary", "Schedule.events", "resource", "of", "cell at a time", "locked", "status", "ready", "lane",
        "overlaps", "Plan.links", "feeds", "link kind", "Connect", "Plan.library.tab", "create", "orders", "drop", "Schedule.patch", "customers",
        "Schedule.templates", "case", "one templates record", "Plan.library.events", "Plan.library.series", "hidden", "optimise", "Func.bind",
        "e3.function", "Plan.Types.OptimiseRequest", "Plan.Types.OptimiseResult", "inspector", "horizon", "totals", "#1541", "#1544", "#1732",
    ],
    description: "The print works over plain records — one record of rows, each group with its resources (Plan.series.group, its children drawn by their kind with Plan.series.kinds), read a page at a time and what belongs to a resource a day at a time through the rows' nested series index (a press's utilisation, a crew's hours by role, typed in and saved through `record`); five event kinds on the rows by `of`, each read a cell at a time through its own source of the one rail; feeds as a link kind over a record (Plan.links, drawn with the Connect tool); an Orders tab whose cards make jobs (create); one templates record for every kind (Schedule.templates' case); a locked job; and the works' optimiser by the builders' one contract",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            // The rows' save door: the groups and the resources, their own fields and values, by a group's key.
            const record = $.let(Record.bind(planWorksRows, ["patch"]));
            // Each event kind's record and save door, and its entries, which read one event by its key: every kind here
            // is read a cell at a time.
            const jobRecord = $.let(Record.bind(planWorksJobs, ["patch"]));
            const jobEntries = $.let(Data.bindPaged(planWorksJobs));
            const stopRecord = $.let(Record.bind(planWorksStops, ["patch"]));
            const stopEntries = $.let(Data.bindPaged(planWorksStops));
            const bindingRecord = $.let(Record.bind(planWorksBindings, ["patch"]));
            const bindingEntries = $.let(Data.bindPaged(planWorksBindings));
            const shiftRecord = $.let(Record.bind(planWorksShifts, ["patch"]));
            const shiftEntries = $.let(Data.bindPaged(planWorksShifts));
            const deliveryRecord = $.let(Record.bind(planWorksDeliveries, ["patch"]));
            const deliveryEntries = $.let(Data.bindPaged(planWorksDeliveries));
            // The link kind's record and save door, read whole.
            const feedRecord = $.let(Record.bind(planWorksFeeds, ["patch"]));
            // What the library lists: the orders to plan, the customers, and every kind's presets in one record.
            const orderRows = $.let(Data.bind(planWorksOrders));
            const customerRows = $.let(Data.bind(planPrintCustomers));
            const presets = $.let(Data.bind(planWorksPresets));
            // The works' optimiser: the Elara eye in the toolbar calls it once a run.
            const optimise = $.let(Func.bind(placeWorksOrders));
            // One rail: the rows, each event kind, the Customers tab, and one source for every kind's templates.
            const slice = $.let(Slice.bindRecords("ex.planPrintWorksRecords", {
                rows: {
                    // The groups a page at a time, by name, beside their nested series index: read without their
                    // collections, each collection a day at a time.
                    source: Data.bindPaged(planWorksRows, { indexes: ["plan_works_rows_by_name", "plan_works_rows_by_resource", "plan_works_rows_in_time"] }),
                    label: "Works", icon: { prefix: "fas", name: "industry" },
                    // The rail narrows the groups by name, and to the group holding a resource by the resource's code.
                    fields: { name: { label: "Group" }, code: { label: "Resource" } },
                    search: ["name", "code"],
                },
                // The jobs on the rows in view, a cell at a time: the presses in view by the weeks in view, and each
                // press's months where the jobs are too many to draw. Its range is the window the rows share. Each kind
                // lists its totals a day, a week, a month, a quarter and a year, which the horizon's bars read, summed (#1732).
                job: {
                    source: Data.bindPaged(planWorksJobs, {
                        indexes: ["plan_works_jobs_by_time", "plan_works_jobs_by_press_week", "plan_works_jobs_by_press_month"],
                        totals: ["plan_works_jobs_day_totals", "plan_works_jobs_week_totals", "plan_works_jobs_month_totals", "plan_works_jobs_quarter_totals", "plan_works_jobs_year_totals"],
                    }),
                    label: "Print jobs", icon: { prefix: "fas", name: "file-lines" },
                    fields: { start: { label: "Dates" } }, range: "start",
                },
                shift: {
                    source: Data.bindPaged(planWorksShifts, {
                        indexes: ["plan_works_shifts_by_time", "plan_works_shifts_by_crew_week", "plan_works_shifts_by_crew_month"],
                        totals: ["plan_works_shifts_day_totals", "plan_works_shifts_week_totals", "plan_works_shifts_month_totals", "plan_works_shifts_quarter_totals", "plan_works_shifts_year_totals"],
                    }),
                    label: "Shifts", icon: { prefix: "fas", name: "user-clock" },
                    fields: { start: { label: "Dates" } }, range: "start",
                },
                stop: {
                    source: Data.bindPaged(planWorksStops, {
                        indexes: ["plan_works_stops_by_time", "plan_works_stops_by_press_week", "plan_works_stops_by_press_month"],
                        totals: ["plan_works_stops_day_totals", "plan_works_stops_week_totals", "plan_works_stops_month_totals", "plan_works_stops_quarter_totals", "plan_works_stops_year_totals"],
                    }),
                    label: "Stops", icon: { prefix: "fas", name: "screwdriver-wrench" },
                    fields: { at: { label: "Dates" } }, range: "at",
                },
                binding: {
                    source: Data.bindPaged(planWorksBindings, {
                        indexes: ["plan_works_bindings_by_time", "plan_works_bindings_by_line_week", "plan_works_bindings_by_line_month"],
                        totals: ["plan_works_bindings_day_totals", "plan_works_bindings_week_totals", "plan_works_bindings_month_totals", "plan_works_bindings_quarter_totals", "plan_works_bindings_year_totals"],
                    }),
                    label: "Bindery jobs", icon: { prefix: "fas", name: "book-open" },
                    fields: { start: { label: "Dates" } }, range: "start",
                },
                delivery: {
                    source: Data.bindPaged(planWorksDeliveries, {
                        indexes: ["plan_works_deliveries_by_time", "plan_works_deliveries_by_location_week", "plan_works_deliveries_by_location_month"],
                        totals: ["plan_works_deliveries_day_totals", "plan_works_deliveries_week_totals", "plan_works_deliveries_month_totals", "plan_works_deliveries_quarter_totals", "plan_works_deliveries_year_totals"],
                    }),
                    label: "Deliveries", icon: { prefix: "fas", name: "truck" },
                    fields: { at: { label: "Dates" } }, range: "at",
                },
                // A library tab's source: it narrows the Customers tab by district.
                customers: {
                    source: Data.bindPaged(planPrintCustomers, { indexes: ["plan_print_customers_by_district"] }),
                    icon: { prefix: "fas", name: "building" },
                    fields: { district: { label: "District", hints: ["North Quay", "Old Town", "Riverside"] } },
                },
                // Every kind's templates, one record and one source: each kind's cards are its case of them.
                templates: {
                    source: Data.bindPaged(planWorksPresets, { indexes: ["plan_works_presets_by_name"] }),
                    icon: { prefix: "fas", name: "layer-group" },
                    fields: { name: { label: "Template" } },
                },
            }));
            return (
                <Box width="100%" height="720px"><Plan
                    id="planPrintWorksRecords"
                    slice={{ slice }}
                    record={record}
                    axis={Plan.axis({
                        window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                        resolution: "day", resolutions: ["day", "week", "month", "quarter"], now: WORKS_NOW,
                    })}
                    // The rows: the groups, each resource drawn by its kind with what belongs to it.
                    series={[
                        Plan.series.group(WorksGroup, {
                            key: "groups", title: "Works", label: (group) => group.name,
                            children: Plan.children("resources", [
                                // Each resource by its kind: a case of `what` per entry, each case the rows its event
                                // kinds land on, its `series` rows beneath it.
                                Plan.series.kinds(WorksResource, "what", {
                                    press: {
                                        title: "Presses", icon: "print", label: (press) => press.name,
                                        series: [
                                            Plan.series.heat(WorksResource, {
                                                key: "utilisation", title: "Utilisation",
                                                cells: Plan.heatCells(Plan.values("utilisation", (pct) => ({ value: some(pct) })), { min: 0, max: 100, warnAt: 95 }),
                                            }),
                                        ],
                                    },
                                    line: { title: "Bindery lines", icon: "book-open", label: (line) => line.name },
                                    crew: {
                                        title: "Crews", icon: "users", label: (crew) => crew.name,
                                        series: [
                                            // The crew's planned hours each week, the sum e3 keeps of its roles', each
                                            // role beneath it, typed into a week at a time.
                                            Plan.series.table(WorksResource, {
                                                key: "hours", title: "Hours", aggregate: "sum", collapsed: true,
                                                children: Plan.children("hours", [Plan.series.table(WorksRoleHours, {
                                                    key: "role", title: "Role", keyType: WorksRole, edit: true,
                                                    label: (_hours, role) => role.match({ assistant: () => "Assistant", operator: () => "Operator" }),
                                                    cells: Plan.tableCells(Plan.values("hours", (h) => ({ value: some(h) }))),
                                                })]),
                                            }),
                                        ],
                                    },
                                    bay: { title: "Bays", icon: "warehouse", label: (bay) => bay.name },
                                    van: { title: "Vans", icon: "truck", label: (van) => van.name },
                                }),
                            ]),
                        }),
                    ]}
                    // The events: a kind per record, each on the rows its `of` names. Each kind's templates are its case
                    // of the one presets record.
                    events={{
                        job: Schedule.events(jobRecord, {
                            name: "Print job", icon: "file-lines", draw: "span",
                            title: "title", start: "start", end: "end",
                            resource: { field: "press", of: "press" },
                            state: "state", quantity: { field: "sheets", unit: "sheets" },
                            // A job under way is locked, by the works' own rule.
                            locked: (job) => job.state.hasTag("in-progress"),
                            fields: {
                                customer: Schedule.field.text({ label: "Customer" }),
                                sheets: Schedule.field.number({ label: "Sheets", step: 1000.0, min: 0.0 }),
                            },
                            entries: jobEntries,
                            templates: Schedule.templates(presets.read(), {
                                case: ["values", "job"], name: (preset) => preset.name,
                                duration: (preset) => variant("hours", preset.hours), values: (_preset, _key, job) => job, source: "templates",
                            }),
                        }),
                        stop: Schedule.events(stopRecord, {
                            name: "Stop", icon: "screwdriver-wrench", draw: "marks",
                            title: "title", at: "at", resource: { field: "press", of: "press" },
                            entries: stopEntries,
                            // A stop is one instant: its templates give no duration.
                            templates: Schedule.templates(presets.read(), { case: ["values", "stop"], name: (preset) => preset.name, values: (_preset, _key, stop) => stop, source: "templates" }),
                        }),
                        binding: Schedule.events(bindingRecord, {
                            name: "Bindery job", icon: "book-open", draw: "cards",
                            title: "title", start: "start", end: "end", resource: { field: "line", of: "line" },
                            state: "state", overlaps: "allow", entries: bindingEntries,
                            templates: Schedule.templates(presets.read(), {
                                case: ["values", "binding"], name: (preset) => preset.name,
                                duration: (preset) => variant("hours", preset.hours), values: (_preset, _key, binding) => binding, source: "templates",
                            }),
                        }),
                        shift: Schedule.events(shiftRecord, {
                            name: "Crew shift", icon: "user-clock", draw: "cards",
                            title: "title", start: "start", end: "end", resource: { field: "crew", of: "crew" },
                            state: "state", entries: shiftEntries,
                            templates: Schedule.templates(presets.read(), {
                                case: ["values", "shift"], name: (preset) => preset.name,
                                duration: (preset) => variant("hours", preset.hours), values: (_preset, _key, shift) => shift, source: "templates",
                            }),
                        }),
                        // A bay's and a van's deliveries, drawn alike: tiles at their slot in AM and PM lanes, a queued one ringed.
                        delivery: Schedule.events(deliveryRecord, {
                            name: "Delivery", icon: "truck", draw: "buckets", title: "title", at: "at",
                            resource: { field: "location", of: { bay: "bay", van: "van" } }, lane: "lane",
                            status: { field: "status", cases: {
                                queued: { label: "Queued", tone: variant("warning", null), ring: true },
                                ready: { label: "Ready", tone: variant("info", null), ring: false },
                                dispatched: { label: "Dispatched", tone: variant("success", null), ring: false },
                            } },
                            ready: (d) => d.pallets.lessEqual(0.0).ifElse(
                                () => variant("invalid", [{ field: "pallets", message: "Pallets must be positive" }]),
                                () => variant("ready", null)),
                            // The rule says what a delivery takes: a bound beside it hinted 0 was allowed, and one of 1 said
                            // it twice (#1680's review).
                            fields: { pallets: Schedule.field.number({ label: "Pallets", step: 1.0 }) },
                            entries: deliveryEntries,
                            templates: Schedule.templates(presets.read(), { case: ["values", "delivery"], name: (preset) => preset.name, values: (_preset, _key, delivery) => delivery, source: "templates" }),
                        }),
                    }}
                    // The links: a kind per record, each link joining two events, each end a case per event kind it may name.
                    links={{
                        feed: Plan.links(feedRecord, {
                            name: "Feed", icon: "arrow-right-long",
                            from: { field: "from", of: { binding: "binding", job: "job" } },
                            to: { field: "to", of: { binding: "binding", delivery: "delivery" } },
                            quantity: { field: "sheets", unit: "sheets" },
                            fields: { sheets: Schedule.field.number({ label: "Sheets", step: 1000.0, min: 0.0 }) },
                        }),
                    }}
                    hidden={["utilisation"]}
                    optimise={optimise}
                    library={[
                        Plan.library.events(),
                        Plan.library.series(),
                        // A card dropped on a press makes a job there, as a template does: as long as its sheets take at
                        // 8,000 an hour.
                        Plan.library.tab(orderRows.read(), {
                            name: "Orders", icon: "inbox", label: (o) => o.title, group: (o) => o.customer,
                            create: {
                                kind: "job",
                                duration: (o) => variant("hours", o.sheets.divide(8000.0)),
                                values: (o) => ({ title: o.title, customer: o.customer, sheets: o.sheets, state: variant("proposed", variant("added", null)) }),
                            },
                        }),
                        // A customer dropped on a job sets its customer. The tab follows the rail's `customers` source.
                        Plan.library.tab(customerRows.read(), {
                            name: "Customers", icon: "building", label: (c) => c.name, group: (c) => c.district,
                            drop: (c) => Schedule.patch(WorksJob, { customer: c.name }),
                            source: "customers",
                        }),
                    ]}
                    inspector
                    style={{ height: "fill" }}
                /></Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

