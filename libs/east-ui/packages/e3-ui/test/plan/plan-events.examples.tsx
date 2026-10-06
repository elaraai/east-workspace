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
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    example,
    none,
    some,
    variant,
} from "@elaraai/east";
import { ApprovalStateType, Chart, EventStateType, Format, Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Plan, Record, Schedule } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// A Plan of event kinds (#1191, `Plan Builder Spec.md` §3): the resources are
// the canvas's rows, read from a record (`Schedule.resources`), and each event
// kind is a record of its own, bound with its patch mutation
// (`Schedule.events`) — the very values a Calendar takes. The print works'
// records are seeded so that every part of the Plan has something in it from
// the first example: six presses in two halls and four crews; thirty print
// jobs over four weeks from Monday 5 October 2026, eight of them waiting in the
// backlog; plate changes and services; early and late shifts; each press's
// utilisation and the sheets printed each day; and templates for every kind. A
// measure is stored as its readings from the window's first day, which the
// series turn into cells and points, as the Plan's other examples store theirs.
// The customers are made up.

// ============================================================================
// The print works' records (§3.1)
// ============================================================================

/** A press: its name, its hall and the sheets it prints an hour. */
export const PrintPress = StructType({ name: StringType, hall: StringType, sheets_per_hour: FloatType });

/** A crew: its name and its hall. */
export const PrintCrew = StructType({ name: StringType, hall: StringType });

/**
 * A print job: when it runs and on which press — none of the three while it
 * waits in the backlog — the lifecycle it wears, its sheets, the verdict a
 * review writes, and the customer's details.
 */
export const PrintJob = StructType({
    title: StringType,
    start: OptionType(DateTimeType),
    end: OptionType(DateTimeType),
    press: OptionType(StringType),
    state: EventStateType,
    sheets: FloatType,
    verdict: ApprovalStateType,
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

/** The presses: three in each hall. A Plan never writes its resources. */
export const planPrintPresses = e3.record("plan_print_presses", DictType(StringType, PrintPress), new Map([
    ["a1", { name: "Press A1", hall: "Hall A", sheets_per_hour: 12000.0 }],
    ["a2", { name: "Press A2", hall: "Hall A", sheets_per_hour: 10000.0 }],
    ["a3", { name: "Press A3", hall: "Hall A", sheets_per_hour: 8000.0 }],
    ["b1", { name: "Press B1", hall: "Hall B", sheets_per_hour: 15000.0 }],
    ["b2", { name: "Press B2", hall: "Hall B", sheets_per_hour: 12000.0 }],
    ["b3", { name: "Press B3", hall: "Hall B", sheets_per_hour: 6000.0 }],
]));

/** The crews: two in each hall. */
export const planPrintCrews = e3.record("plan_print_crews", DictType(StringType, PrintCrew), new Map([
    ["c1", { name: "Crew 1", hall: "Hall A" }],
    ["c2", { name: "Crew 2", hall: "Hall A" }],
    ["c3", { name: "Crew 3", hall: "Hall B" }],
    ["c4", { name: "Crew 4", hall: "Hall B" }],
]));

/**
 * The print jobs: actual before 14 October, in progress on it, confirmed,
 * proposed and estimated after it; the proposed and estimated ones awaiting
 * review; two overlapping on Press B2 on the 20th; and eight with no start
 * waiting in the backlog, two due this week, two next week, two later and two
 * with no due date.
 */
export const planPrintJobs = e3.record("plan_print_jobs", DictType(StringType, PrintJob), new Map([
    ["J-1001", { title: "Spring catalogue", start: some(new Date("2026-10-05T06:00:00Z")), end: some(new Date("2026-10-05T14:00:00Z")), press: some("a1"), state: variant("actual", null), sheets: 96000.0, verdict: variant("approved", null), customer: "Alder & Finch", stock: variant("coated", null), due: some(new Date("2026-10-07T00:00:00Z")) }],
    ["J-1002", { title: "Museum guide", start: some(new Date("2026-10-07T06:00:00Z")), end: some(new Date("2026-10-07T12:00:00Z")), press: some("a1"), state: variant("actual", null), sheets: 72000.0, verdict: variant("approved", null), customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
    ["J-1003", { title: "Event posters", start: some(new Date("2026-10-14T07:00:00Z")), end: some(new Date("2026-10-14T12:00:00Z")), press: some("a1"), state: variant("in-progress", null), sheets: 60000.0, verdict: variant("approved", null), customer: "Granite Hall", stock: variant("uncoated", null), due: some(new Date("2026-10-15T00:00:00Z")) }],
    ["J-1004", { title: "Course handbook", start: some(new Date("2026-10-19T06:00:00Z")), end: some(new Date("2026-10-19T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, verdict: variant("approved", null), customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
    ["J-1005", { title: "Menu cards", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T08:00:00Z")), press: some("a1"), state: variant("proposed", variant("recommended", null)), sheets: 24000.0, verdict: variant("pending", null), customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
    ["J-1006", { title: "Tour brochure", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T14:00:00Z")), press: some("a2"), state: variant("actual", null), sheets: 80000.0, verdict: variant("approved", null), customer: "Bluewater Tours", stock: variant("coated", null), due: some(new Date("2026-10-08T00:00:00Z")) }],
    ["J-1007", { title: "Annual report", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T12:00:00Z")), press: some("a2"), state: variant("in-progress", null), sheets: 60000.0, verdict: variant("approved", null), customer: "Harbour Arts Society", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
    ["J-1008", { title: "Seed catalogue", start: some(new Date("2026-10-21T06:00:00Z")), end: some(new Date("2026-10-21T16:00:00Z")), press: some("a2"), state: variant("proposed", variant("added", null)), sheets: 100000.0, verdict: variant("pending", null), customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-24T00:00:00Z")) }],
    ["J-1009", { title: "Season flyers", start: some(new Date("2026-10-28T06:00:00Z")), end: some(new Date("2026-10-28T09:00:00Z")), press: some("a2"), state: variant("estimated", null), sheets: 30000.0, verdict: variant("pending", null), customer: "Hollow Oak Theatre", stock: variant("uncoated", null), due: some(new Date("2026-10-31T00:00:00Z")) }],
    ["J-1010", { title: "Club newsletter", start: some(new Date("2026-10-08T06:00:00Z")), end: some(new Date("2026-10-08T08:00:00Z")), press: some("a3"), state: variant("actual", null), sheets: 16000.0, verdict: variant("approved", null), customer: "Kestrel Cycling Club", stock: variant("uncoated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
    ["J-1011", { title: "Stationery set", start: some(new Date("2026-10-15T06:00:00Z")), end: some(new Date("2026-10-15T09:00:00Z")), press: some("a3"), state: variant("confirmed", null), sheets: 24000.0, verdict: variant("approved", null), customer: "Ivy Lane Studio", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
    ["J-1012", { title: "Gift boxes", start: some(new Date("2026-10-22T06:00:00Z")), end: some(new Date("2026-10-22T12:00:00Z")), press: some("a3"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, verdict: variant("pending", null), customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-26T00:00:00Z")) }],
    ["J-1013", { title: "Holiday catalogue", start: some(new Date("2026-10-05T06:00:00Z")), end: some(new Date("2026-10-05T22:00:00Z")), press: some("b1"), state: variant("actual", null), sheets: 240000.0, verdict: variant("approved", null), customer: "Larkspur Home", stock: variant("coated", null), due: some(new Date("2026-10-09T00:00:00Z")) }],
    ["J-1014", { title: "Magazine run", start: some(new Date("2026-10-12T06:00:00Z")), end: some(new Date("2026-10-12T18:00:00Z")), press: some("b1"), state: variant("actual", null), sheets: 180000.0, verdict: variant("approved", null), customer: "Meridian Monthly", stock: variant("coated", null), due: some(new Date("2026-10-13T00:00:00Z")) }],
    ["J-1015", { title: "Store flyers", start: some(new Date("2026-10-14T06:00:00Z")), end: some(new Date("2026-10-14T16:00:00Z")), press: some("b1"), state: variant("in-progress", null), sheets: 150000.0, verdict: variant("approved", null), customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
    ["J-1016", { title: "Exhibition book", start: some(new Date("2026-10-26T06:00:00Z")), end: some(new Date("2026-10-26T12:00:00Z")), press: some("b1"), state: variant("estimated", null), sheets: 90000.0, verdict: variant("pending", null), customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
    ["J-1017", { title: "Timetables", start: some(new Date("2026-10-09T06:00:00Z")), end: some(new Date("2026-10-09T10:00:00Z")), press: some("b2"), state: variant("actual", null), sheets: 48000.0, verdict: variant("approved", null), customer: "Bluewater Tours", stock: variant("uncoated", null), due: some(new Date("2026-10-12T00:00:00Z")) }],
    ["J-1018", { title: "Market posters", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T12:00:00Z")), press: some("b2"), state: variant("confirmed", null), sheets: 72000.0, verdict: variant("approved", null), customer: "Orchard Street Market", stock: variant("coated", null), due: some(new Date("2026-10-22T00:00:00Z")) }],
    ["J-1019", { title: "Loyalty cards", start: some(new Date("2026-10-20T10:00:00Z")), end: some(new Date("2026-10-20T13:00:00Z")), press: some("b2"), state: variant("proposed", variant("added", null)), sheets: 36000.0, verdict: variant("pending", null), customer: "Copperleaf Cafe", stock: variant("board", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
    ["J-1020", { title: "Ticket books", start: some(new Date("2026-10-29T06:00:00Z")), end: some(new Date("2026-10-29T08:00:00Z")), press: some("b2"), state: variant("estimated", null), sheets: 24000.0, verdict: variant("pending", null), customer: "Hollow Oak Theatre", stock: variant("uncoated", null), due: some(new Date("2026-11-02T00:00:00Z")) }],
    ["J-1021", { title: "Handbook covers", start: some(new Date("2026-10-16T06:00:00Z")), end: some(new Date("2026-10-16T08:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 12000.0, verdict: variant("approved", null), customer: "Elmway College", stock: variant("board", null), due: some(new Date("2026-10-19T00:00:00Z")) }],
    ["J-1022", { title: "Box sleeves", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T09:00:00Z")), press: some("b3"), state: variant("proposed", variant("recommended", null)), sheets: 18000.0, verdict: variant("pending", null), customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-22T00:00:00Z")) }],
    ["J-1023", { title: "Guide reprint", start: none, end: none, press: none, state: variant("estimated", null), sheets: 24000.0, verdict: variant("pending", null), customer: "Driftwood Museum", stock: variant("coated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
    ["J-1024", { title: "Order forms", start: none, end: none, press: none, state: variant("proposed", variant("added", null)), sheets: 40000.0, verdict: variant("pending", null), customer: "Larkspur Home", stock: variant("uncoated", null), due: some(new Date("2026-10-17T00:00:00Z")) }],
    ["J-1025", { title: "Winter brochure", start: none, end: none, press: none, state: variant("estimated", null), sheets: 64000.0, verdict: variant("pending", null), customer: "Bluewater Tours", stock: variant("coated", null), due: some(new Date("2026-10-21T00:00:00Z")) }],
    ["J-1026", { title: "Wall calendars", start: none, end: none, press: none, state: variant("estimated", null), sheets: 50000.0, verdict: variant("pending", null), customer: "Foxglove Gardens", stock: variant("coated", null), due: some(new Date("2026-10-23T00:00:00Z")) }],
    ["J-1027", { title: "Prospectus", start: none, end: none, press: none, state: variant("estimated", null), sheets: 100000.0, verdict: variant("pending", null), customer: "Elmway College", stock: variant("coated", null), due: some(new Date("2026-11-06T00:00:00Z")) }],
    ["J-1028", { title: "Price lists", start: none, end: none, press: none, state: variant("estimated", null), sheets: 16000.0, verdict: variant("pending", null), customer: "Northwind Outfitters", stock: variant("uncoated", null), due: some(new Date("2026-11-13T00:00:00Z")) }],
    ["J-1029", { title: "Spare covers", start: none, end: none, press: none, state: variant("estimated", null), sheets: 8000.0, verdict: variant("pending", null), customer: "Meridian Monthly", stock: variant("board", null), due: none }],
    ["J-1030", { title: "Proof sheets", start: none, end: none, press: none, state: variant("estimated", null), sheets: 2000.0, verdict: variant("pending", null), customer: "Alder & Finch", stock: variant("uncoated", null), due: none }],
]));

/** The jobs' patch door: every Apply commits through it. */
export const planPrintJobsPatch = e3.mutation.patch(planPrintJobs);

/** The stops: plate changes and services across the presses. */
export const planPrintStops = e3.record("plan_print_stops", DictType(StringType, PrintStop), new Map([
    ["S-01", { title: "Plate change", at: new Date("2026-10-07T12:00:00Z"), press: "a1", kind: variant("plate_change", null) }],
    ["S-02", { title: "Service", at: new Date("2026-10-12T04:00:00Z"), press: "b1", kind: variant("service", null) }],
    ["S-03", { title: "Plate change", at: new Date("2026-10-14T12:00:00Z"), press: "a2", kind: variant("plate_change", null) }],
    ["S-04", { title: "Plate change", at: new Date("2026-10-19T18:00:00Z"), press: "a1", kind: variant("plate_change", null) }],
    ["S-05", { title: "Service", at: new Date("2026-10-26T14:00:00Z"), press: "a3", kind: variant("service", null) }],
    ["S-06", { title: "Plate change", at: new Date("2026-10-28T10:00:00Z"), press: "b2", kind: variant("plate_change", null) }],
]));

/** The stops' patch door. */
export const planPrintStopsPatch = e3.mutation.patch(planPrintStops);

/** The shifts: each crew's early and late shifts, confirmed for the first two weeks and proposed for the last two. */
export const planPrintShifts = e3.record("plan_print_shifts", DictType(StringType, PrintShift), new Map([
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
]));

/** The shifts' patch door. */
export const planPrintShiftsPatch = e3.mutation.patch(planPrintShifts);

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
// planEvents — the smallest Plan of event kinds (§3.2)
// ============================================================================

/**
 * The smallest Plan of event kinds (`Plan Builder Spec.md` §3.2): a row per
 * press, each job a bar on its press. Jobs move and resize along a press and
 * between presses, and Apply commits the drafts as one patch through the
 * jobs' patch door. It lists no `library` and is given no `inspector`, so it
 * draws neither pane. The two `Schedule` values are exactly what a Calendar
 * takes.
 */
export const planEvents = example({
    keywords: [
        "Plan", "Schedule", "Schedule.resources", "Schedule.events", "event kinds", "events", "resources", "rows",
        "jobs", "presses", "bars", "record", "Record.bind", "e3.record", "e3.mutation.patch", "patch",
        "smallest", "#1191",
    ],
    description: "The smallest Plan of event kinds — the presses as its rows (`Schedule.resources`) and the print jobs as bars on them (`Schedule.events`), each kind a record bound with its patch mutation",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(planPrintPresses, []));
            const jobs = $.let(Record.bind(planPrintJobs, [planPrintJobsPatch]));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                resolution: "day",
            }));
            return (
                <Plan
                    axis={axis}
                    resources={{
                        presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name }),
                    }}
                    events={{
                        job: Schedule.events(jobs, {
                            name: "Print job", icon: "file-lines",
                            title: "title", start: "start", end: "end",
                            resource: { field: "press", of: "presses" },
                        }),
                    }}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planPrintWorks — the print works (§3.3)
// ============================================================================

/**
 * The print works (`Plan Builder Spec.md` §3.3): two resource kinds grouped
 * by hall, three event kinds drawn three ways — jobs as bars, stops as marks
 * at their instants, shifts as chips — review on jobs, a utilisation heat row
 * under each press, and a pinned chart of the sheets printed each day. Each
 * kind declares its templates, the cards a library lists, and a job's
 * customer, stock and sheets are hinted for an inspector's form; this Plan is
 * given neither pane.
 */
export const planPrintWorks = example({
    keywords: [
        "Plan", "Schedule", "Schedule.resources", "Schedule.events", "Schedule.field", "event kinds", "print works",
        "presses", "crews", "jobs", "stops", "shifts", "draw", "span", "marks", "cards", "at", "instant", "group",
        "hall", "sub", "measures", "utilisation", "heat", "state", "review", "verdict", "quantity", "backlog",
        "duration", "due", "fields", "templates", "rows", "pinned", "chart", "output", "grain", "Record.bind",
        "Data.bind", "e3.record", "e3.input", "#1191",
    ],
    description: "The print works — presses and crews grouped by hall, print jobs as bars with their lifecycle, sheets and verdict, stops as marks, shifts as chips, each kind's templates, a utilisation row under each press, and a pinned chart of the sheets printed each day",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(planPrintPresses, []));
            const crews = $.let(Record.bind(planPrintCrews, []));
            const jobs = $.let(Record.bind(planPrintJobs, [planPrintJobsPatch]));
            const stops = $.let(Record.bind(planPrintStops, [planPrintStopsPatch]));
            const shifts = $.let(Record.bind(planPrintShifts, [planPrintShiftsPatch]));
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
            return (
                <Plan
                    axis={axis}
                    resources={{
                        presses: Schedule.resources(presses.read(), {
                            name: "Presses", icon: "print",
                            label: p => p.name, group: p => p.hall,
                            sub: p => some(East.str`${East.Float.printCommaSeperated(p.sheets_per_hour, 0n)} sheets/h`),
                            // A row under each press, from the dataflow's utilisation: an ordinary
                            // heat series over the press rows, read only.
                            measures: [
                                Plan.series.heat(PrintPress, {
                                    key: "util", title: "Utilisation", label: () => "Utilisation",
                                    cells: (_p, key) => Plan.heatCells(daily(util.read().get(key)), { min: 0, max: 100, warnAt: 95 }),
                                }),
                            ],
                        }),
                        crews: Schedule.resources(crews.read(), { name: "Crews", icon: "user-group", label: c => c.name, group: c => c.hall }),
                    }}
                    events={{
                        job: Schedule.events(jobs, {
                            name: "Print job", icon: "file-lines", draw: "span",
                            title: "title", start: "start", end: "end",
                            resource: { field: "press", of: "presses" },
                            state: "state", review: "verdict",
                            quantity: { field: "sheets", unit: "sheets" },
                            backlog: { duration: j => variant("hours", j.sheets.divide(8000.0)), due: j => j.due },
                            fields: {
                                customer: Schedule.field.text({ label: "Customer" }),
                                stock: Schedule.field.select({ labels: { coated: "Coated", uncoated: "Uncoated", board: "Board" } }),
                                sheets: Schedule.field.number({ label: "Sheets", step: 1000.0, min: 0.0 }),
                            },
                            templates: [
                                { key: "brochure", name: "Brochure run", group: "Jobs", duration: variant("hours", 6.0),
                                  values: { title: "Brochure run", state: variant("proposed", variant("added", null)), sheets: 40000.0,
                                            verdict: variant("pending", null), customer: "", stock: variant("coated", null), due: none } },
                                { key: "catalogue", name: "Catalogue run", group: "Jobs", duration: variant("hours", 12.0),
                                  values: { title: "Catalogue run", state: variant("proposed", variant("added", null)), sheets: 96000.0,
                                            verdict: variant("pending", null), customer: "", stock: variant("coated", null), due: none } },
                                { key: "poster", name: "Poster run", group: "Jobs", duration: variant("hours", 4.0),
                                  values: { title: "Poster run", state: variant("proposed", variant("added", null)), sheets: 20000.0,
                                            verdict: variant("pending", null), customer: "", stock: variant("uncoated", null), due: none } },
                                { key: "board", name: "Board run", group: "Jobs", duration: variant("hours", 8.0),
                                  values: { title: "Board run", state: variant("proposed", variant("added", null)), sheets: 24000.0,
                                            verdict: variant("pending", null), customer: "", stock: variant("board", null), due: none } },
                            ],
                        }),
                        stop: Schedule.events(stops, {
                            name: "Stop", icon: "screwdriver-wrench", draw: "marks",
                            title: "title", at: "at",
                            resource: { field: "press", of: "presses" },
                            templates: [
                                { key: "plates", name: "Plate change", group: "Stops",
                                  values: { title: "Plate change", kind: variant("plate_change", null) } },
                                { key: "service", name: "Service", group: "Stops",
                                  values: { title: "Service", kind: variant("service", null) } },
                            ],
                        }),
                        shift: Schedule.events(shifts, {
                            name: "Crew shift", icon: "user-clock", draw: "cards",
                            title: "title", start: "start", end: "end",
                            resource: { field: "crew", of: "crews" }, state: "state",
                            templates: [
                                { key: "early", name: "Early shift", group: "Shifts", at: { hour: 6n, minute: 0n }, duration: variant("hours", 8.0),
                                  values: { title: "Early", state: variant("confirmed", null) } },
                                { key: "late", name: "Late shift", group: "Shifts", at: { hour: 14n, minute: 0n }, duration: variant("hours", 8.0),
                                  values: { title: "Late", state: variant("confirmed", null) } },
                                { key: "night", name: "Night shift", group: "Shifts", at: { hour: 22n, minute: 0n }, duration: variant("hours", 8.0),
                                  values: { title: "Night", state: variant("proposed", variant("added", null)) } },
                            ],
                        }),
                    }}
                    rows={[
                        Plan.chart({
                            key: "output", label: "SHEETS / DAY", id: true, pinned: true, height: "spark", expandable: true,
                            layers: [Chart.Column(days, { x: r => r.day, y: r => r.sheets })],
                        }),
                    ]}
                    review={{ columnLabel: "Decision" }}
                    grain="resource"
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// planEventLinks — links between events, and rows over a dataset
// ============================================================================

/** A paper stock: its name, and its level in thousands of sheets, a reading a week from 5 October. */
export const PrintStock = StructType({ name: StringType, weekly: ArrayType(FloatType) });

/** Four jobs: the covers and the sleeves on Press B3, and the handbooks and the boxes they go into on Press A1. */
export const planLinkJobs = e3.record("plan_link_jobs", DictType(StringType, PrintJob), new Map([
    ["J-2001", { title: "Handbook covers", start: some(new Date("2026-10-06T06:00:00Z")), end: some(new Date("2026-10-06T08:00:00Z")), press: some("b3"), state: variant("confirmed", null), sheets: 12000.0, verdict: variant("approved", null), customer: "Elmway College", stock: variant("board", null), due: some(new Date("2026-10-07T00:00:00Z")) }],
    ["J-2002", { title: "Course handbook", start: some(new Date("2026-10-13T06:00:00Z")), end: some(new Date("2026-10-13T18:00:00Z")), press: some("a1"), state: variant("confirmed", null), sheets: 144000.0, verdict: variant("approved", null), customer: "Elmway College", stock: variant("uncoated", null), due: some(new Date("2026-10-16T00:00:00Z")) }],
    ["J-2003", { title: "Box sleeves", start: some(new Date("2026-10-20T06:00:00Z")), end: some(new Date("2026-10-20T09:00:00Z")), press: some("b3"), state: variant("proposed", variant("recommended", null)), sheets: 18000.0, verdict: variant("pending", null), customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-21T00:00:00Z")) }],
    ["J-2004", { title: "Gift boxes", start: some(new Date("2026-10-27T06:00:00Z")), end: some(new Date("2026-10-27T12:00:00Z")), press: some("a1"), state: variant("proposed", variant("recommended", null)), sheets: 48000.0, verdict: variant("pending", null), customer: "Juniper Toys", stock: variant("board", null), due: some(new Date("2026-10-30T00:00:00Z")) }],
]));

/** The linked jobs' patch door. */
export const planLinkJobsPatch = e3.mutation.patch(planLinkJobs);

/** The paper in stock. */
export const planLinkStock = e3.input("plan_link_stock", DictType(StringType, PrintStock), variant("value", new Map([
    ["board", { name: "Board", weekly: [40.0, 22.0, 31.0, 18.0] }],
    ["coated", { name: "Coated", weekly: [520.0, 410.0, 460.0, 380.0] }],
    ["uncoated", { name: "Uncoated", weekly: [300.0, 260.0, 280.0, 240.0] }],
])));

/**
 * Links between events, and rows over a dataset (`Plan Builder Spec.md` §4.3,
 * PB9, PB10): the covers go into the handbooks and the sleeves onto the boxes,
 * each link's ends named by event (`Plan.eventRef`) — a link draws between
 * bars wherever they are drawn, so it names the event, never its row. Beside
 * the presses, the paper in stock is a table over a dataset (`Plan.over`),
 * read only: a Plan's edits go through its event kinds.
 */
export const planEventLinks = example({
    keywords: [
        "Plan", "links", "Plan.link", "Plan.eventRef", "event", "ends", "quantity", "ribbon", "rows", "Plan.over",
        "dataset", "read only", "table", "Plan.series.table", "Plan.tableCells", "stock", "Schedule", "Data.bind",
        "Record.bind", "e3.record", "e3.input", "#1191",
    ],
    description: "Links between events and rows over a dataset — the covers and the sleeves linked to the jobs they go into (`Plan.eventRef`), and the paper in stock as a read-only table beside the presses (`Plan.over`)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const presses = $.let(Record.bind(planPrintPresses, []));
            const jobs = $.let(Record.bind(planLinkJobs, [planLinkJobsPatch]));
            const stock = $.let(Data.bind(planLinkStock));
            // The window's first Monday: each stock reading runs from it, a week apiece.
            const first = $.const(new Date("2026-10-05T00:00:00Z"), DateTimeType);
            const StockWeek = StructType({ at: DateTimeType, value: OptionType(FloatType) });
            const weekly = $.const(East.function([ArrayType(FloatType)], ArrayType(StockWeek), (_$2, readings) =>
                East.Array.generate(readings.size(), StockWeek, (_$3, i) => ({ at: first.addWeeks(i), value: some(readings.get(i)) }))));
            const axis = $.let(Plan.axis({
                window: { min: new Date("2026-10-05T00:00:00Z"), max: new Date("2026-11-02T00:00:00Z") },
                resolution: "week",
            }));
            return (
                <Plan
                    axis={axis}
                    resources={{
                        presses: Schedule.resources(presses.read(), { name: "Presses", icon: "print", label: p => p.name, group: p => p.hall }),
                    }}
                    events={{
                        job: Schedule.events(jobs, {
                            name: "Print job", icon: "file-lines",
                            title: "title", start: "start", end: "end",
                            resource: { field: "press", of: "presses" },
                            state: "state", quantity: { field: "sheets", unit: "sheets" },
                        }),
                    }}
                    rows={[
                        Plan.over(stock, [
                            Plan.series.table(PrintStock, {
                                key: "stock", title: "Paper stock", label: s => s.name,
                                cells: s => Plan.tableCells(weekly(s.weekly)),
                                format: Format.Number({ maximumFractionDigits: 0n }),
                            }),
                        ]),
                    ]}
                    links={[
                        Plan.link({
                            key: "covers", from: Plan.eventRef("job", "J-2001"), to: Plan.eventRef("job", "J-2002"),
                            quantity: Plan.quantity(12000.0, { unit: "covers" }),
                        }),
                        Plan.link({
                            key: "sleeves", from: Plan.eventRef("job", "J-2003"), to: Plan.eventRef("job", "J-2004"),
                            quantity: Plan.quantity(18000.0, { unit: "sleeves" }),
                        }),
                    ]}
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
