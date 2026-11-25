/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * The Record's day (`<Record day>`, east-workspace#1746): the page sets the
 * day the Record's columns from data read and write their cells at, and its
 * ages in days count to — a plan made as at a day that is not the viewer's
 * today. Here a crew's planned hours, a column for each machine under its
 * line, at a day the page keeps in its own state and shows in a field over
 * the Record.
 */

import { ArrayType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType, example, none, some } from "@elaraai/east";
import { Box, Field, Reactive, State, UIComponentType, VStack } from "@elaraai/east-ui";
import { Data, Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

/** A line of the works. */
export const Line = StructType({ name: StringType });
/** A machine, on a line by the line's code. */
export const Machine = StructType({ name: StringType, line: StringType });
/** A crew member's hours on one machine on one day. */
export const Planned = StructType({ day: DateTimeType, machine: StringType, hours: FloatType });
/** A crew member: their name, their planned hours, and when they were last briefed on safety. */
export const Crew = StructType({ name: StringType, planned: ArrayType(Planned), briefed: DateTimeType });

export const recordDayLines = e3.record("record_day_lines", DictType(StringType, Line), {
    initial: new Map([
        ["L-1", { name: "Assembly" }],
        ["L-2", { name: "Packing" }],
    ]),
});
export const recordDayMachines = e3.record("record_day_machines", DictType(StringType, Machine), {
    initial: new Map([
        ["M-10", { name: "Press A", line: "L-1" }],
        ["M-11", { name: "Press B", line: "L-1" }],
        ["M-20", { name: "Wrapper", line: "L-2" }],
        ["M-21", { name: "Labeller", line: "L-2" }],
    ]),
});
export const recordDayCrew = e3.record("record_day_crew", DictType(StringType, Crew), {
    initial: new Map([
        ["C-001", { name: "A. Morgan", briefed: new Date("2026-11-02T00:00:00Z"), planned: [
            { day: new Date("2026-11-30T00:00:00Z"), machine: "M-10", hours: 6.0 },
            { day: new Date("2026-11-30T00:00:00Z"), machine: "M-11", hours: 2.0 },
            { day: new Date("2026-12-01T00:00:00Z"), machine: "M-10", hours: 8.0 },
        ] }],
        ["C-002", { name: "B. Ellis", briefed: new Date("2026-11-20T00:00:00Z"), planned: [
            { day: new Date("2026-11-30T00:00:00Z"), machine: "M-20", hours: 7.5 },
        ] }],
        ["C-003", { name: "C. Patel", briefed: new Date("2026-10-01T00:00:00Z"), planned: [
            { day: new Date("2026-12-01T00:00:00Z"), machine: "M-21", hours: 4.0 },
        ] }],
    ]),
    mutations: (mutation) => ({
        // Every Save commits through it.
        patch: mutation.patch(),
    }),
});

/** A crew member's hours on a machine on a day: the entry for the machine on that date, where their plan holds one. */
export const hoursOn = East.function([ArrayType(Planned), StringType, DateTimeType], OptionType(FloatType), ($, planned, machine, day) => {
    const date = $.const(East.DateTime.roundDownDay(day, 1n));
    const found = $.let(none, OptionType(FloatType));
    $.for(planned, ($2, entry) => {
        $2.if(entry.machine.equal(machine).and(() => East.equal(East.DateTime.roundDownDay(entry.day, 1n), date)), ($3) => {
            $3.assign(found, some(entry.hours));
        });
    });
    return found;
});

/**
 * A crew member's plan with their hours on a machine on a day set: the entry for the machine on that date given the
 * hours in its place, or one added after the rest — or, cleared, that entry taken out. No other day's entry changes, and
 * hours set back to what the plan held write the plan as it was.
 */
export const withHours = East.function([ArrayType(Planned), StringType, OptionType(FloatType), DateTimeType], ArrayType(Planned), ($, planned, machine, hours, day) => {
    const date = $.const(East.DateTime.roundDownDay(day, 1n));
    // Where the plan holds the machine's entry on that date, where it holds one.
    const at = $.let(none, OptionType(IntegerType));
    $.for(planned, ($2, entry, index) => {
        $2.if(entry.machine.equal(machine).and(() => East.equal(East.DateTime.roundDownDay(entry.day, 1n), date)), ($3) => {
            $3.assign(at, some(index));
        });
    });
    return at.match({
        none: () => hours.match({
            none: () => planned,
            some: ($2, value) => {
                const added = $2.const({ day: date, machine, hours: value }, Planned);
                return planned.concat([added]);
            },
        }),
        some: (_$2, index) => hours.match({
            none: () => planned.slice(0n, index).concat(planned.slice(index.add(1n), planned.size())),
            some: (_$3, value) => planned.map(($4, entry, i) => {
                const set = $4.const({ day: entry.day, machine: entry.machine, hours: value }, Planned);
                return i.equal(index).ifElse(() => set, () => entry);
            }),
        }),
    });
});

export const recordPlannedHours = example({
    keywords: ["Record", "day", "the Record's day", "plan as at a day", "columns from data", "each", "groups", "read", "write", "dated history", "Record.column.quantity", "Record.column.age", "State", "Field.DateTimeInput"],
    description: "The page sets the Record's day: a crew's planned hours, a column for each machine under its line, each cell the member's hours on that machine on the day the page keeps in its own state and shows in a field over the Record. The cells are read and written at that day through the solution's functions, and the days since each member's safety briefing count to it. Changing the day reads every row's cells again and keeps the drafts. A new day's cells start empty, an edit sets or adds that day's entry, and earlier days' entries stay",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const crew = $.let(Record.bind(recordDayCrew));
            const lineRows = $.let(Data.bind(recordDayLines));
            const machineRows = $.let(Data.bind(recordDayMachines));
            // The day the plan is made for: the page's own, shown in a field over the Record.
            const dayBind = $.let(State.bind([DateTimeType], "record_day_plan_day", new Date("2026-11-30T00:00:00Z")));
            const day = $.let(dayBind.read());
            const onDay = $.const(East.function([DateTimeType], NullType, ($, next) => { $(dayBind.write(next)); }));
            return (
                <VStack gap="3" align="stretch">
                    <Box width="200px">
                        <Field.DateTimeInput label="Planning for" value={day} precision="date" onChange={onDay} />
                    </Box>
                    <Box height="400px">
                        <Record
                            record={crew}
                            title="Planned hours"
                            noun={{ singular: "crew member", plural: "crew members" }}
                            day={day}
                            // The crew come from the staff list: this page plans their hours, and adds no one.
                            edits={{ insertRows: false }}
                            registers={{
                                lines: Record.register.members(lineRows.read(), { kind: "line", key: (_l, code) => code, label: (l) => l.name }),
                                machines: Record.register.members(machineRows.read(), {
                                    kind: "machine", key: (_m, code) => code, label: (m) => m.name, parent: (m) => some(m.line),
                                }),
                            }}
                            columns={{
                                name: Record.column.title(Crew, { header: "Name", width: "176px" }),
                                // A column for each machine, under its line: the member's hours on it, at the Record's day.
                                planned: Record.column.quantity(Crew, {
                                    each: "machines", groups: "lines", unit: "hrs", width: "112px",
                                    read: hoursOn,
                                    write: withHours,
                                }),
                                // The days since their safety briefing, to the Record's day: stale from four weeks.
                                since_briefing: Record.column.age(Crew, { header: "Since briefing", width: "128px", since: (c) => c.briefed, stale: 28n }),
                            }}
                            inspector
                            name="plannedHours"
                        />
                    </Box>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
