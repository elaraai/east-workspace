/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * The Calendar over events keyed by the key their row builds
 * (east-workspace#1709), read and narrowed through their record's interval
 * indexes by the rail (east-workspace#1696) — and keyed by a struct: machine
 * reservations keyed by their machine and their start, as a struct of the two.
 */

import { DateTimeType, DictType, East, SortedMap, StringType, StructType, compareFor, example, type ValueTypeOf } from "@elaraai/east";
import { Box, Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
import { Calendar, Data, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/** A machine's reservation: the machine and the start its key is built from, what it is for, when it ends, and the crew it is for. */
export const KeyedReservation = StructType({ machine: StringType, title: StringType, start: DateTimeType, end: DateTimeType, crew: StringType });

/** A reservation's key: its machine and its start. */
export const KeyedReservationKey = StructType({ machine: StringType, start: DateTimeType });

/** The machines reserved. */
export const keyedMachines = e3.record("calendar_keyed_machines", DictType(StringType, StructType({ name: StringType })), {
    initial: new Map([["press1", { name: "Press 1" }], ["lathe1", { name: "Lathe 1" }], ["mill1", { name: "Mill 1" }]]),
});

/** What a machine is reserved for through a day, each with the hour it starts at, how many hours it takes, and its crew. */
const BOOKED = [
    ["Tool trial", 7, 2, "Day"], ["Operator training", 11, 1, "Day"], ["First-article run", 14, 3, "Day"], ["Night batch", 20, 3, "Night"],
] as const;

/** Three days of reservations on each machine, an hour later on each machine after the first: 36 in all. */
function reservations(): [ValueTypeOf<typeof KeyedReservationKey>, ValueTypeOf<typeof KeyedReservation>][] {
    return ["press1", "lathe1", "mill1"].flatMap((machine, at) => [0, 1, 2].flatMap((day) => BOOKED.map(([title, hour, hours, crew]): [ValueTypeOf<typeof KeyedReservationKey>, ValueTypeOf<typeof KeyedReservation>] => {
        const start = new Date(Date.UTC(2026, 9, 1 + day, hour + at));
        return [{ machine, start }, { machine, title, start, end: new Date(start.getTime() + hours * 3_600_000), crew }];
    })));
}

/** The reservations, each keyed by the struct its machine and its start build. A Dict over struct keys is a SortedMap, in East's order. */
export const keyedReservations = e3.record("calendar_keyed_reservations", DictType(KeyedReservationKey, KeyedReservation), {
    initial: new SortedMap<ValueTypeOf<typeof KeyedReservationKey>, ValueTypeOf<typeof KeyedReservation>>(reservations(), compareFor(KeyedReservationKey)),
    indexes: (index) => ({
        // What the rail reads a period's reservations through, and narrows them by.
        calendar_keyed_reservations_by_time: index.interval({ from: "start", to: "end" }),
        calendar_keyed_reservations_by_machine_time: index.interval({ on: ["machine"], from: "start", to: "end" }),
        calendar_keyed_reservations_by_crew_time: index.interval({ on: ["crew"], from: "start", to: "end" }),
    }),
    mutations: (mutation) => ({
        // The reservations' patch door — every Save commits through it, each reservation by its struct key.
        patch: mutation.patch(),
    }),
});

export const calendarBuiltKeysSliced = example({
    inputs: [],
    description: "calendarBuiltKeys under the rail, over a key that is no text: machine reservations keyed by a struct of their machine and their start, which `rowKey` on the event kind builds from the row, read a period at a time through their record's interval indexes and narrowed by machine, crew and dates. A record keyed by any type a Dict takes is a source of the rail. A reservation moved to another start or another machine moves under the struct it then builds and is saved there; one that would build a key another reservation holds is refused, the Calendar naming the key; and one moved out of what the rail keeps leaves the view once saved, which the footer says",
    keywords: ["Calendar", "Calendar.events", "Schedule.events", "rowKey", "built key", "key from the row", "struct key", "composite key", "keyType", "typed key", "StructType", "Slice",
        "Slice.bindRecords", "Data.bindPaged", "indexes", "interval", "index.interval", "narrowing", "double booking", "key taken", "refused", "move", "Record.bind", "#1696"],
    fn: East.function([], UIComponentType, _$ => <Reactive>{$ => {
        const machines = $.let(Record.bind(keyedMachines, []));
        const held = $.let(Record.bind(keyedReservations));
        const entries = $.let(Data.bindPaged(keyedReservations));
        const indexed = $.let(Data.bindPaged(keyedReservations, {
            indexes: ["calendar_keyed_reservations_by_time", "calendar_keyed_reservations_by_machine_time", "calendar_keyed_reservations_by_crew_time"],
        }));
        // The rail's one source, named after the kind it narrows: its interval indexes keep every reservation the period overlaps.
        const slice = $.let(Slice.bindRecords("ex.calendarBuiltKeysSliced", {
            reservation: { source: indexed, icon: { prefix: "fas", name: "calendar" },
                fields: { machine: { label: "Machine", hints: ["press1", "lathe1", "mill1"] }, crew: { label: "Crew", hints: ["Day", "Night"] }, start: { label: "Dates" } },
                range: "start", search: ["machine"],
                initial: { start: { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-02T00:00:00Z") } } },
        }));
        return <Box height="680px" width="100%"><Calendar id="builtKeysSliced" inspector
            view={{ layout: "resources", period: "day", date: new Date("2026-10-01T00:00:00Z") }} now={new Date("2026-10-01T10:15:00Z")}
            resources={{ machines: Calendar.resources(machines.read(), { name: "Machines", icon: "gears", label: row => row.name }) }}
            events={{ reservation: Calendar.events(held, { name: "Reservation", icon: "calendar", title: "title", start: "start", end: "end", resource: { field: "machine", of: "machines" }, entries,
                // A reservation's key, built from its row at the record's key type: a struct of its machine and its start.
                rowKey: row => ({ machine: row.machine, start: row.start }),
            }) }}
            slice={{ slice, affordances: ["fields", "summary"] }} />
        </Box>;
    }}</Reactive>),
});
