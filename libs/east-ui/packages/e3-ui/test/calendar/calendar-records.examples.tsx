/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */
import { DateTimeType, DictType, East, OptionType, StringType, StructType, example, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Calendar, Data, Record } from "@elaraai/e3-ui";
import * as e3 from "@elaraai/e3";

/** An event's row and original key are independent of every index entry. */
export const IndexedCalendarEvent = StructType({
    title: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType),
    machine: StringType, status: StringType, customer: StringType,
});
/** A year of jobs beside the small, identifiable overlap/editing examples. */
function calendarSeed(): Map<string, ValueTypeOf<typeof IndexedCalendarEvent>> {
    const rows = new Map<string, ValueTypeOf<typeof IndexedCalendarEvent>>([
    ["carry", { title: "Overnight print run", start: some(new Date("2026-10-01T22:00:00Z")), end: some(new Date("2026-10-02T08:00:00Z")), machine: "press-a", status: "Ready", customer: "Northern Press" }],
    ["long", { title: "Annual maintenance reservation", start: some(new Date("2026-01-01T00:00:00Z")), end: some(new Date("2027-01-01T00:00:00Z")), machine: "press-b", status: "Ready", customer: "Operations" }],
    ["job", { title: "October brochures", start: some(new Date("2026-10-02T09:00:00Z")), end: some(new Date("2026-10-02T12:00:00Z")), machine: "press-a", status: "Ready", customer: "City Arts" }],
    ["done", { title: "Completed proof", start: some(new Date("2026-10-02T08:00:00Z")), end: some(new Date("2026-10-02T09:00:00Z")), machine: "press-a", status: "Done", customer: "City Arts" }],
    ["next", { title: "Weekend catalogue", start: some(new Date("2026-10-03T09:00:00Z")), end: some(new Date("2026-10-03T12:00:00Z")), machine: "press-a", status: "Ready", customer: "North Market" }],
    ["backlog", { title: "Unscheduled posters", start: none, end: none, machine: "press-b", status: "Ready", customer: "Festival" }],
    ]);
    for (let i = 0; i < 11994; i++) {
        const ordinal = (i * 37) % 363;
        // Keep the opening two days legible; navigate to any other day to
        // inspect the larger schedule. The record and all its indexes are real.
        const day = ordinal < 274 ? ordinal : ordinal + 2;
        const start = new Date(Date.UTC(2026, 0, 1 + day, 6 + i % 10));
        rows.set(`production-${10000 + i}`, {
            title: `Production job ${10000 + i}`, start: some(start),
            end: some(new Date(start.getTime() + (1 + i % 4) * 3600000)),
            machine: i % 2 === 0 ? "press-a" : "press-b", status: i % 3 === 0 ? "Done" : "Ready",
            customer: ["Northern Press", "City Arts", "North Market", "Festival"][i % 4]!,
        });
    }
    return rows;
}
export const indexedCalendarEvents = e3.record("indexed_calendar_events", DictType(StringType, IndexedCalendarEvent), calendarSeed());
export const indexedCalendarPatch = e3.mutation.patch(indexedCalendarEvents);
export const indexedCalendarByTime = e3.recordIndex("calendar_by_time", indexedCalendarEvents, { interval: { from: "start", to: "end" } });
export const indexedCalendarByStatus = e3.recordIndex("calendar_by_status_time", indexedCalendarEvents, { on: ["status"], interval: { from: "start", to: "end" } });
export const indexedCalendarByMachine = e3.recordIndex("calendar_by_machine_time", indexedCalendarEvents, { on: ["machine"], interval: { from: "start", to: "end" } });
export const indexedCalendarMachines = e3.record("indexed_calendar_machines", DictType(StringType, StructType({ name: StringType })), new Map([
    ["press-a", { name: "Press A" }], ["press-b", { name: "Press B" }],
]));

export const calendarRecordIndexes = example({
    description: "12,000 events across a year, narrowed through interval indexes. The opening days demonstrate carry-in and year-long events; navigate to other dates for the larger production schedule. Filters and navigation share Slice, and drafts save by original key.",
    keywords: ["Calendar", "Slice", "Slice.bindRecords", "interval", "overlap", "records", "paging"],
    inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const events = $.let(Record.bind(indexedCalendarEvents, [indexedCalendarPatch]));
        const entries = $.let(Data.bindPaged(indexedCalendarEvents));
        const indexed = $.let(Data.bindPaged(indexedCalendarEvents, { indexes: [indexedCalendarByTime, indexedCalendarByStatus, indexedCalendarByMachine] }));
        // The rail's one source, named after the kind it narrows (#1343): its interval indexes keep every overlapping event.
        const slice = $.let(Slice.bindRecords("ex.calendarRecordIndexes", {
            job: { source: indexed, icon: { prefix: "fas", name: "print" },
                fields: { status: { label: "Status", hints: ["Ready", "Done"] }, machine: { label: "Machine" }, start: { label: "Dates" } },
                range: "start", search: ["machine"],
                initial: { status: ["Ready"], start: { from: new Date("2026-10-02T00:00:00Z"), to: new Date("2026-10-03T00:00:00Z") } } },
        }));
        const machines = $.let(Record.bind(indexedCalendarMachines, []));
        return <Box height="720px" width="100%"><Calendar id="calendarRecordIndexes" inspector
            events={{ job: Calendar.events(events, {
                name: "Job", icon: "print", title: "title", start: "start", end: "end",
                resource: { field: "machine", of: "machines" }, entries,
                backlog: { duration: () => variant("hours", 3) },
            }) }}
            resources={{ machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) }}
            library={[Calendar.library.backlog()]} slice={{ slice, affordances: ["fields", "summary"] }}
            view={{ layout: "calendar", period: "day", date: new Date("2026-10-02T00:00:00Z") }}
            now={new Date("2026-10-02T09:00:00Z")} />
        </Box>;
    }}</Reactive>),
});

export const calendarRecordIndexesMobile = example({
    description: "Indexed Calendar at phone width: the same Slice fields, overlap queries and original-key editing, shown as agenda cards with explicit actions",
    keywords: ["Calendar", "Slice", "Slice.bindRecords", "interval", "mobile", "agenda"],
    inputs: [],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const events = $.let(Record.bind(indexedCalendarEvents, [indexedCalendarPatch]));
        const entries = $.let(Data.bindPaged(indexedCalendarEvents));
        const indexed = $.let(Data.bindPaged(indexedCalendarEvents, { indexes: [indexedCalendarByTime, indexedCalendarByStatus, indexedCalendarByMachine] }));
        // The rail's one source, named after the kind it narrows (#1343): its interval indexes keep every overlapping event.
        const slice = $.let(Slice.bindRecords("ex.calendarRecordIndexesMobile", {
            job: { source: indexed, icon: { prefix: "fas", name: "print" },
                fields: { status: { label: "Status", hints: ["Ready", "Done"] }, machine: { label: "Machine" }, start: { label: "Dates" } },
                range: "start", search: ["machine"],
                initial: { status: ["Ready"], start: { from: new Date("2026-10-02T00:00:00Z"), to: new Date("2026-10-03T00:00:00Z") } } },
        }));
        const machines = $.let(Record.bind(indexedCalendarMachines, []));
        return <Box height="760px" width="390px" maxWidth="100%"><Calendar id="calendarRecordIndexesMobile" inspector
            events={{ job: Calendar.events(events, {
                name: "Job", icon: "print", title: "title", start: "start", end: "end",
                resource: { field: "machine", of: "machines" }, entries,
                backlog: { duration: () => variant("hours", 3) },
            }) }}
            resources={{ machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) }}
            library={[Calendar.library.backlog()]} slice={{ slice, affordances: ["fields", "summary"] }}
            view={{ layout: "calendar", period: "day", date: new Date("2026-10-02T00:00:00Z") }}
            now={new Date("2026-10-02T09:00:00Z")} />
        </Box>;
    }}</Reactive>),
});
