/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * The Record's display cells (east-workspace#1726): read-only cells that draw
 * a row's numbers with east-ui's own parts. A trace column
 * (east-workspace#1728) draws a row's series as a Trace's one track — its
 * steps coloured by value, a now-line between the weeks worked and the weeks
 * forecast — on the series' field, on a series a `value` derives from another
 * field, and on an Option of one, whose none shows the column's words.
 */

import { ArrayType, DictType, East, FloatType, NullType, OptionType, StringType, StructType, example, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Box, Configurator, Reactive, SegmentGroup, State, Style, Text, UIComponentType } from "@elaraai/east-ui";
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// Example 1 — a trace per row: a series, a derived one and an Option of one
// ============================================================================

/** One week of a machine's plan, as the planner lists it: the week, and the hours booked on it. */
export const PlannedWeek = StructType({ week: StringType, hours: FloatType });

/**
 * A machine of the shop: its name; the hours booked on it a week — eight weeks worked, then four forecast; its weeks as
 * the planner lists them; and last year's hours, a week each, where it has them.
 */
export const Machine = StructType({
    name: StringType,
    load: ArrayType(FloatType),
    weeks: ArrayType(PlannedWeek),
    history: OptionType(ArrayType(FloatType)),
});

/** The twelve weeks a machine's load spans: eight worked, then four forecast. */
export const LOAD_WEEKS = ["W41", "W42", "W43", "W44", "W45", "W46", "W47", "W48", "W49", "W50", "W51", "W52"];

/** Each machine's name, its load, and how last year went for it: its mean, its swing and where in the year it peaked — or none, or no weeks. */
const MACHINES: readonly (readonly [key: string, name: string, load: readonly number[], history: readonly [mean: number, swing: number, peak: number] | "none" | "empty"])[] = [
    ["M-01", "Lathe 1", [32, 34, 36, 38, 40, 38, 36, 34, 30, 28, 26, 24], [30, 6, 10]],
    ["M-02", "Lathe 2", [12, 14.5, 13, 16, 18, 20, 22, 24, 26, 28, 30, 32], [18, 8, 30]],
    ["M-03", "Mill 1", [40, 42, 44, 40, 38, 36, 40, 42, 44, 40, 38, 36], [38, 4, 20]],
    ["M-04", "Mill 2", [8, 6, 4, 2, 0, 2, 4, 6, 8, 10, 12, 14], "none"],
    ["M-05", "Press 1", [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20], "none"],
    ["M-06", "Press 2", [24, 30, 18, 36, 12, 28, 22, 34, 16, 26, 20, 32], [24, 10, 5]],
    ["M-07", "Saw 1", [], "empty"],
    ["M-08", "Grinder 1", [36.5, 35, 33.5, 31, 29.5, 27, 25.5, 23, 21.5, 19, 17.5, 15], [26, 9, 40]],
    ["M-09", "Drill 1", [16, 18, 16, 18, 16, 18, 16, 18, 16, 18, 16, 18], "none"],
    ["M-10", "Router 1", [28, 26, 30, 32, 34, 30, 28, 26, 24, 22, 20, 18], [27, 7, 45]],
];

/** A machine's year, a week each: its mean, swinging over the year to peak in the week given, to the half hour. */
function yearOf(mean: number, swing: number, peak: number): number[] {
    return Array.from({ length: 52 }, (_, w) => Math.round((mean + swing * Math.cos(((w - peak) / 52) * 2 * Math.PI)) * 2) / 2);
}

/** The machines, as the record holds them: a planned week's hours three quarters of its booked load, to the half hour. */
function machines(): [string, ValueTypeOf<typeof Machine>][] {
    return MACHINES.map(([key, name, load, history]) => [key, {
        name,
        load: [...load],
        weeks: load.map((hours, w) => ({ week: LOAD_WEEKS[w]!, hours: Math.round(hours * 0.75 * 2) / 2 })),
        history: history === "none" ? none : history === "empty" ? some([]) : some(yearOf(...history)),
    }]);
}

export const recordDisplayMachines = e3.record("record_display_machines", DictType(StringType, Machine), {
    initial: new Map(machines()),
    mutations: (mutation) => ({
        // The machines' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});

export const recordTrace = example({
    keywords: ["Record", "Record.column.trace", "trace", "Trace", "series", "Array<Float>", "heat strip", "now", "now-line", "forecast", "predicted", "measured",
        "domain", "one scale", "scale", "diverge", "future", "ghost", "axis", "absent", "value", "derived", "read only", "density", "display cell", "#1728"],
    description: "A Record's trace columns: each row's series drawn with east-ui's Trace, one track across the cell, read only. Load is a machine's hours booked a week — eight worked, then four forecast past the now-line, ghosted — on one scale for every row (`domain: [0, 40]`), diverging about its middle, each step saying its week, its hours and whether it was worked or forecast on hover; a machine booked past 40 takes the top's colour. Hours derives a series from the planner's weeks through `value`; Last year is an Option, a machine with none showing the column's words. The density control steps the rows through comfortable, compact and condensed, the trace's steps standing as tall as each fits, and Details shows each machine's traces read only",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const fleet = $.let(Record.bind(recordDisplayMachines));
            // The density control: each segment a density, and the Record takes the one chosen.
            const densities = $.const([variant("comfortable", null), variant("compact", null), variant("condensed", null)], ArrayType(Style.Types.Density));
            const densityBind = $.let(State.bind([StringType], "record_display_density", "comfortable"));
            const densityKey = $.let(densityBind.read());
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const density = $.let(densities.filter((_$, d) => d.getTag().equal(densityKey)).get(0n));
            // Each load step's week, said on hover.
            const weeks = $.let(LOAD_WEEKS, ArrayType(StringType));
            // A machine as it is added: nothing booked on it yet, and no weeks planned — its name left to type.
            const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(Machine), (_$) => Record.patch(Machine, {
                load: East.value([], ArrayType(FloatType)), weeks: East.value([], ArrayType(PlannedWeek)),
            })));
            return (
                <Configurator
                    controls={[
                        Configurator.Control("Density", densityKey,
                            <SegmentGroup value={densityKey} onChange={onDensity} size="sm"
                                items={densities.map((_$, d) => SegmentGroup.Item(d.getTag(), <Text>{d.getTag().upperCase()}</Text>))} />),
                    ]}
                    preview={
                        <Box height="520px" width="100%">
                            <Record
                                record={fleet}
                                title="Machines"
                                noun={{ singular: "machine", plural: "machines" }}
                                density={density}
                                columns={{
                                    name:    Record.column.title(Machine, { header: "Machine", width: "160px" }),
                                    // On the series' field: eight weeks worked, from the ninth forecast, every row on one scale.
                                    load:    Record.column.trace(Machine, {
                                        header: "Load", sub: "8 wk · 4 forecast", width: "240px",
                                        now: 8n, axis: weeks, scale: "diverge", future: "ghost", domain: [0, 40],
                                    }),
                                    // On a field of another shape: `value` derives the series.
                                    weeks:   Record.column.trace(Machine, { header: "Hours", width: "160px", value: (m) => m.weeks.map((_$, w) => w.hours) }),
                                    // On an Option field: none shows the column's words.
                                    history: Record.column.trace(Machine, { header: "Last year", width: "240px", absent: "no history" }),
                                }}
                                newRow={newRow}
                                inspector
                                name="recordTrace"
                            />
                        </Box>
                    }
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});
