/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** @jsxImportSource @elaraai/east-ui */

/**
 * The Record's display cells (east-workspace#1726): read-only cells that draw
 * a row's numbers with east-ui's own parts, over one record of machines. A
 * trace column (east-workspace#1728) draws a row's series as a Trace's one
 * track — its steps coloured by value, a now-line between the weeks worked and
 * the weeks forecast; a sparkline column (east-workspace#1729) as a line or an
 * area across the cell; a meter column (east-workspace#1730) a value against
 * the row's max as a Meter's bar, in the tone the app gives the row. Each sits
 * on its numbers' field, on numbers a `value` derives from other fields, or on
 * an Option of them, whose none shows the column's words.
 */

import { ArrayType, DictType, East, FloatType, NullType, OptionType, StringType, StructType, example, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Box, Configurator, Reactive, SegmentGroup, State, Style, Text, UIComponentType } from "@elaraai/east-ui";
import { Record } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

// ============================================================================
// The machines
// ============================================================================

/** One week of a machine's plan, as the planner lists it: the week, and the hours booked on it. */
export const PlannedWeek = StructType({ week: StringType, hours: FloatType });

/**
 * A machine of the shop: its name; the hours booked on it a week — eight weeks worked, then four forecast; its weeks as
 * the planner lists them; the pieces it made and the pieces it scrapped, a week each; last year's hours, a week each,
 * where it has them; and this week: the hours booked on it and the hours it can run, how much of its time it is
 * running, as a percent, and the good pieces among the pieces it made.
 */
export const Machine = StructType({
    name: StringType,
    load: ArrayType(FloatType),
    weeks: ArrayType(PlannedWeek),
    output: ArrayType(FloatType),
    scrap: ArrayType(FloatType),
    history: OptionType(ArrayType(FloatType)),
    booked: FloatType,
    capacity: FloatType,
    used: FloatType,
    good: FloatType,
    made: FloatType,
});

/** The twelve weeks a machine's load spans: eight worked, then four forecast. */
export const LOAD_WEEKS = ["W41", "W42", "W43", "W44", "W45", "W46", "W47", "W48", "W49", "W50", "W51", "W52"];

/** How last year went for a machine: its mean, its swing and the week it peaked in — or no year, or a year of no weeks. */
type Year = readonly [mean: number, swing: number, peak: number] | "none" | "empty";

/** A machine's week: the hours booked on it and the hours it can run, the percent of its time running, and its good pieces among those it made. */
type Week = readonly [booked: number, capacity: number, used: number, good: number, made: number];

/** Each machine: its name, its load, its output and its scrap, its year, and this week. */
const MACHINES: readonly { key: string; name: string; load: readonly number[]; output: readonly number[]; scrap: readonly number[]; year: Year; week: Week }[] = [
    // Running at 92% of its time: past the 90% a planner is warned at.
    { key: "M-01", name: "Lathe 1", load: [32, 34, 36, 38, 40, 38, 36, 34, 30, 28, 26, 24],
        output: [420, 440, 460, 480, 500, 480, 460, 440, 400, 380, 360, 340], scrap: [12, 10, 14, 18, 22, 20, 16, 12, 10, 8, 6, 4], year: [30, 6, 10], week: [36, 40, 92, 432, 440] },
    { key: "M-02", name: "Lathe 2", load: [12, 14.5, 13, 16, 18, 20, 22, 24, 26, 28, 30, 32],
        output: [160, 190, 170, 210, 240, 260, 290, 320, 340, 370, 390, 420], scrap: [30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8], year: [18, 8, 30], week: [31.5, 40, 64, 401, 420] },
    // Booked past its capacity, and running past its time: danger, both.
    { key: "M-03", name: "Mill 1", load: [40, 42, 44, 40, 38, 36, 40, 42, 44, 40, 38, 36],
        output: [520, 540, 560, 520, 500, 480, 520, 540, 560, 520, 500, 480], scrap: [40, 44, 48, 52, 56, 60, 58, 54, 50, 46, 42, 38], year: [38, 4, 20], week: [44, 40, 104, 498, 560] },
    { key: "M-04", name: "Mill 2", load: [8, 6, 4, 2, 0, 2, 4, 6, 8, 10, 12, 14],
        output: [100, 80, 60, 40, 20, 40, 60, 80, 100, 120, 140, 160], scrap: [2, 2, 3, 3, 2, 1, 1, 2, 2, 3, 3, 2], year: "none", week: [6, 40, 12, 158, 160] },
    // One week's output so far: its line runs flat across the cell. Down for maintenance this week: no hours it can run.
    { key: "M-05", name: "Press 1", load: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20], output: [260], scrap: [20], year: "none", week: [20, 0, 0, 251, 260] },
    { key: "M-06", name: "Press 2", load: [24, 30, 18, 36, 12, 28, 22, 34, 16, 26, 20, 32],
        output: [300, 380, 220, 460, 160, 360, 280, 420, 200, 340, 260, 400], scrap: [10, 30, 5, 40, 2, 25, 15, 35, 8, 20, 12, 28], year: [24, 10, 5], week: [28, 32, 88, 380, 400] },
    // Nothing booked, made or scrapped yet: the columns' words.
    { key: "M-07", name: "Saw 1", load: [], output: [], scrap: [], year: "empty", week: [0, 40, 0, 0, 0] },
    // Running at 90% of its time exactly: warned, at it.
    { key: "M-08", name: "Grinder 1", load: [36.5, 35, 33.5, 31, 29.5, 27, 25.5, 23, 21.5, 19, 17.5, 15],
        output: [480, 460, 440, 410, 390, 360, 340, 310, 290, 260, 240, 210], scrap: [5, 6, 7, 9, 11, 13, 16, 19, 22, 26, 30, 35], year: [26, 9, 40], week: [15, 24, 90, 205, 210] },
    { key: "M-09", name: "Drill 1", load: [16, 18, 16, 18, 16, 18, 16, 18, 16, 18, 16, 18],
        output: [210, 240, 210, 240, 210, 240, 210, 240, 210, 240, 210, 240], scrap: [18, 24, 18, 24, 18, 24, 18, 24, 18, 24, 18, 24], year: "none", week: [18, 40, 45, 236, 240] },
    // Booked to its capacity and running all its time: full, and past neither.
    { key: "M-10", name: "Router 1", load: [28, 26, 30, 32, 34, 30, 28, 26, 24, 22, 20, 18],
        output: [360, 340, 390, 410, 440, 390, 360, 340, 310, 290, 260, 230], scrap: [31, 18, 42, 25, 36, 22, 28, 33, 26, 30, 24, 31], year: [27, 7, 45], week: [40, 40, 100, 220, 230] },
];

/** A machine's year, a week each: its mean, swinging over the year to peak in the week given, to the half hour. */
function yearOf(mean: number, swing: number, peak: number): number[] {
    return Array.from({ length: 52 }, (_, w) => Math.round((mean + swing * Math.cos(((w - peak) / 52) * 2 * Math.PI)) * 2) / 2);
}

/** The machines, as the record holds them: a planned week's hours three quarters of its booked load, to the half hour. */
function machines(): [string, ValueTypeOf<typeof Machine>][] {
    return MACHINES.map(({ key, name, load, output, scrap, year, week: [booked, capacity, used, good, made] }) => [key, {
        name,
        load: [...load],
        weeks: load.map((hours, w) => ({ week: LOAD_WEEKS[w]!, hours: Math.round(hours * 0.75 * 2) / 2 })),
        output: [...output],
        scrap: [...scrap],
        history: year === "none" ? none : year === "empty" ? some([]) : some(yearOf(...year)),
        booked, capacity, used, good, made,
    }]);
}

export const recordDisplayMachines = e3.record("record_display_machines", DictType(StringType, Machine), {
    initial: new Map(machines()),
    mutations: (mutation) => ({
        // The machines' patch door — every Save commits through it.
        patch: mutation.patch(),
    }),
});

// ============================================================================
// Example 1 — a trace per row: a series, a derived one and an Option of one
// ============================================================================

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
            // A machine as it is added: nothing booked on it, planned, made or scrapped yet — its name left to type.
            const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(Machine), (_$) => Record.patch(Machine, {
                load: East.value([], ArrayType(FloatType)), weeks: East.value([], ArrayType(PlannedWeek)),
                output: East.value([], ArrayType(FloatType)), scrap: East.value([], ArrayType(FloatType)),
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
                                // The output and the scrap are the sparklines' page's: they would show here as raw numbers.
                                fields={{ output: Record.field.hidden(), scrap: Record.field.hidden() }}
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

// ============================================================================
// Example 2 — a sparkline per row: an area, a line on one scale, a derived one
// ============================================================================

export const recordSparkline = example({
    keywords: ["Record", "Record.column.sparkline", "sparkline", "Sparkline", "series", "Array<Float>", "trend", "line", "area", "domain", "one scale",
        "compare", "absent", "value", "derived", "read only", "density", "display cell", "#1729"],
    description: "A Record's sparkline columns: each row's series drawn with east-ui's Sparkline across the cell, read only, in the Record's colour. Output is the last twelve weeks' pieces as an area, each row over its own range, a machine with one week drawn flat; Scrap is a line on one scale for every row (`domain: [0, 50]`), so a machine scrapping more stands higher, and weeks past 50 are drawn at the top; Hours derives a series from the planner's weeks through `value`. Each cell's hover says its last value and its range, a machine with nothing yet shows a dash, the density control steps the rows through comfortable, compact and condensed, and Details shows each machine's sparklines read only",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const fleet = $.let(Record.bind(recordDisplayMachines));
            // The density control: each segment a density, and the Record takes the one chosen.
            const densities = $.const([variant("comfortable", null), variant("compact", null), variant("condensed", null)], ArrayType(Style.Types.Density));
            const densityBind = $.let(State.bind([StringType], "record_display_sparkline_density", "comfortable"));
            const densityKey = $.let(densityBind.read());
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const density = $.let(densities.filter((_$, d) => d.getTag().equal(densityKey)).get(0n));
            // A machine as it is added: nothing booked on it, planned, made or scrapped yet — its name left to type.
            const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(Machine), (_$) => Record.patch(Machine, {
                load: East.value([], ArrayType(FloatType)), weeks: East.value([], ArrayType(PlannedWeek)),
                output: East.value([], ArrayType(FloatType)), scrap: East.value([], ArrayType(FloatType)),
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
                                    name:   Record.column.title(Machine, { header: "Machine", width: "160px" }),
                                    // On an Array<Float> field: the last twelve weeks' pieces, as an area.
                                    output: Record.column.sparkline(Machine, { header: "Output", sub: "12 wk", width: "120px", type: "area" }),
                                    // Every row on one scale, so a machine scrapping more stands higher than one scrapping less.
                                    scrap:  Record.column.sparkline(Machine, { header: "Scrap", width: "120px", domain: [0, 50] }),
                                    // On a field of another shape, through `value`.
                                    weeks:  Record.column.sparkline(Machine, { header: "Hours", value: (m) => m.weeks.map((_$, w) => w.hours) }),
                                }}
                                // The load and last year are the traces' page's: they would show here as raw numbers.
                                fields={{ load: Record.field.hidden(), history: Record.field.hidden() }}
                                newRow={newRow}
                                inspector
                                name="recordSparkline"
                            />
                        </Box>
                    }
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Example 3 — a meter per row: a max the row holds, a threshold, a share
// ============================================================================

export const recordMeter = example({
    keywords: ["Record", "Record.column.meter", "meter", "Meter", "bar", "percent", "share", "capacity", "utilisation", "max", "tone", "threshold",
        "warning", "danger", "status", "absent", "value", "derived", "yield", "read only", "density", "display cell", "#1730"],
    description: "A Record's meter columns: each row's value against its max as east-ui's Meter, a filled bar and its percent, read only, in the tone the app's own function gives the row. Booked is a machine's hours this week against the hours it can run — the max the row holds (`max: (m) => m.capacity`) — danger once booked past it; a machine down for the week, its capacity 0, draws an empty bar and says why on hover. Used is a threshold written as a tone, over one max for every row (100, the default): warning at or past 90%, danger past 100. Yield derives a share from two fields through `value`, none for a machine that has made nothing yet, which shows the column's words. Each cell's hover says the value, the max and the percent; editing a machine's capacity in Details redraws its booked bar before it is saved; the density control steps the rows through comfortable, compact and condensed",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const fleet = $.let(Record.bind(recordDisplayMachines));
            // The density control: each segment a density, and the Record takes the one chosen.
            const densities = $.const([variant("comfortable", null), variant("compact", null), variant("condensed", null)], ArrayType(Style.Types.Density));
            const densityBind = $.let(State.bind([StringType], "record_display_meter_density", "comfortable"));
            const densityKey = $.let(densityBind.read());
            const onDensity = $.const(East.function([StringType], NullType, ($, next) => { $(densityBind.write(next)); }));
            const density = $.let(densities.filter((_$, d) => d.getTag().equal(densityKey)).get(0n));
            // A machine as it is added: nothing booked, planned, made or scrapped yet, and none of its time running.
            const newRow = $.const(East.function([Record.Types.NewRow], Record.Types.Patch(Machine), (_$) => Record.patch(Machine, {
                load: East.value([], ArrayType(FloatType)), weeks: East.value([], ArrayType(PlannedWeek)),
                output: East.value([], ArrayType(FloatType)), scrap: East.value([], ArrayType(FloatType)),
                booked: 0.0, used: 0.0, good: 0.0,
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
                                    name:   Record.column.title(Machine, { header: "Machine", width: "160px" }),
                                    // On a Float field, against a max the row holds: booked past its capacity, danger.
                                    booked: Record.column.meter(Machine, {
                                        header: "Booked", sub: "hours of capacity", width: "160px",
                                        max: (m) => m.capacity,
                                        tone: (m) => m.booked.greater(m.capacity).ifElse((_$) => variant("danger", null), (_$) => variant("neutral", null)),
                                    }),
                                    // A threshold, written as a tone over one max for every row (100): warn at or past 90, danger past 100.
                                    used:   Record.column.meter(Machine, {
                                        header: "Used", sub: "% of its time", width: "160px",
                                        tone: (m) => m.used.greater(100.0).ifElse(
                                            (_$) => variant("danger", null),
                                            (_$) => m.used.greaterEqual(90.0).ifElse((_$2) => variant("warning", null), (_$2) => variant("neutral", null))),
                                    }),
                                    // A share two fields make, through `value`, of one max for every row — none for a machine that has made nothing.
                                    good:   Record.column.meter(Machine, {
                                        header: "Yield", sub: "good of made", width: "160px", max: 1, absent: "nothing made",
                                        value: (m) => m.made.greater(0.0).ifElse(
                                            (_$) => East.value(some(m.good.divide(m.made)), OptionType(FloatType)),
                                            (_$) => East.value(none, OptionType(FloatType))),
                                    }),
                                }}
                                // The series are the traces' and the sparklines' pages': they would show here as raw numbers.
                                fields={{ load: Record.field.hidden(), weeks: Record.field.hidden(), output: Record.field.hidden(), scrap: Record.field.hidden(), history: Record.field.hidden() }}
                                newRow={newRow}
                                inspector
                                name="recordMeter"
                            />
                        </Box>
                    }
                />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// The floor the renderer's meter tests read
// ============================================================================

/** A bay of the floor: its kind, this week's hours booked, the hours it can run, and the hours it ran. */
export const NoShareBay = StructType({ name: StringType, kind: StringType, booked: FloatType, capacity: FloatType, used: FloatType });

/**
 * The floor the renderer's tests read where a Record's meters draw no share (east-workspace#1730): two bays with a
 * share to draw, three whose figures make none, and two of a kind the app's limits don't hold. No example reads it:
 * e3-ui-components declares no e3 SDK, and its tests mount this module for it.
 */
export const recordDisplayNoShareBays = e3.record("record_display_no_share_bays", DictType(StringType, NoShareBay), {
    initial: new Map([
        ["B-1", { name: "Bay 1", kind: "small", booked: 30, capacity: 40, used: 20 }],
        // A capacity no reading gave a number: NaN.
        ["B-2", { name: "Bay 2", kind: "small", booked: 30, capacity: NaN, used: 20 }],
        // Hours booked no reading gave a number.
        ["B-3", { name: "Bay 3", kind: "small", booked: NaN, capacity: 40, used: 20 }],
        // A capacity without end.
        ["B-4", { name: "Bay 4", kind: "small", booked: 30, capacity: Infinity, used: 20 }],
        ["B-5", { name: "Bay 5", kind: "large", booked: 30, capacity: 40, used: 20 }],
        ["B-6", { name: "Bay 6", kind: "large", booked: 10, capacity: 40, used: 5 }],
    ]),
    mutations: (mutation) => ({
        // The floor's patch door: a Save commits through it.
        patch: mutation.patch(),
    }),
});
