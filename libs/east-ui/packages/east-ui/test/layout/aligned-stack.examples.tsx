/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, DateTimeType, FloatType, StringType, StructType, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { NullType } from "@elaraai/east";
import { AlignedStack, Box, Calendar, Chart, Gantt, Matrix, Planner, Table, Trace } from "@elaraai/east-ui";

/**
 * Two charts on the same day axis, stacked in an `<AlignedStack>` with a shared
 * `gutter`. Both plots inset their lane to `[left, W−right]` (the gutter), so
 * their x-axes line up pixel-for-pixel even though each derives different y-axis
 * widths on its own. (#147)
 */
export const alignedStackCharts = example({
    keywords: ["AlignedStack", "plotGutter", "gutter", "align", "Chart", "stack", "axis", "shared"],
    description: "Two stacked charts share one plot gutter so their x-axes line up on a common day axis",
    fn: East.function([], UIComponentType, ($) => {
        const temp = $.const([
            { day: 0.0, v: 22.0 }, { day: 2.0, v: 20.5 }, { day: 4.0, v: 18.0 }, { day: 6.0, v: 16.5 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        const rate = $.const([
            { day: 0.0, v: 1.2 }, { day: 2.0, v: 0.9 }, { day: 4.0, v: 0.6 }, { day: 6.0, v: 0.3 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter={{ left: "48px", right: "16px" }} gap="8px">
                <Box height="180px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(temp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "°C" }}
                        grid
                    />
                </Box>
                <Box height="180px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(rate, { x: r => r.day, y: r => r.v }, { color: "purple.solid" })}
                        x={{ scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "rate" }}
                        grid
                    />
                </Box>
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * A `<Chart>` stacked over a `<Trace>` in an `<AlignedStack>` — both inherit the
 * gutter from context, so the Trace's step lane fills `[left, W−right]` and lines
 * up under the chart's day axis (the canonical Chart-over-lane alignment). (#147)
 */
export const alignedStackChartTrace = example({
    keywords: ["AlignedStack", "plotGutter", "Chart", "Trace", "align", "lane", "axis", "day"],
    description: "A Chart stacked over a Trace sharing one gutter — the Trace's step lane lines up under the chart's day axis",
    fn: East.function([], UIComponentType, ($) => {
        const temp = $.const([
            { day: 0.0, v: 22.0 }, { day: 2.0, v: 20.0 }, { day: 4.0, v: 18.0 }, { day: 6.0, v: 16.0 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter={{ left: "48px", right: "16px" }} gap="8px">
                <Box height="160px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(temp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [-0.5, 6.5], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "°C" }}
                        grid
                    />
                </Box>
                <Trace
                    tracks={[
                        { name: "Series A", values: [12.0, 13.0, 14.0, 16.0, 18.0, 20.0, 22.0] },
                        { name: "Series B", values: [1.0, 2.0, 3.0, 5.0, 7.0, 9.0, 11.0] },
                    ]}
                    now={4n}
                    axis={["0", "1", "2", "3", "4", "5", "6"]}
                    density="comfortable"
                />
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * A `<Chart>` stacked over a `<Calendar>` in an `<AlignedStack>` — the Calendar
 * inherits the gutter from context, so its 7-day band fills `[left, W−right]` and
 * lines up under the chart's day axis. `left` (the week-label column) and `right`
 * come from the shared gutter, not the calendar's own density. (#147)
 */
export const alignedStackChartCalendar = example({
    keywords: ["AlignedStack", "plotGutter", "Chart", "Calendar", "align", "lane", "day", "week"],
    description: "A Chart stacked over a Calendar sharing one gutter — the Calendar's day band lines up under the chart's day axis",
    fn: East.function([], UIComponentType, ($) => {
        const load = $.const([
            { day: 0.0, v: 0.4 }, { day: 1.0, v: 0.7 }, { day: 2.0, v: 0.9 },
            { day: 3.0, v: 0.6 }, { day: 4.0, v: 0.8 }, { day: 5.0, v: 0.3 }, { day: 6.0, v: 0.2 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        const grid = $.const([
            { week: "W37", day: "Mon", demand: 0.4 }, { week: "W37", day: "Tue", demand: 0.7 },
            { week: "W37", day: "Wed", demand: 0.9 }, { week: "W37", day: "Thu", demand: 0.6 },
            { week: "W37", day: "Fri", demand: 0.8 }, { week: "W37", day: "Sat", demand: 0.3 },
            { week: "W37", day: "Sun", demand: 0.2 },
            { week: "W38", day: "Mon", demand: 0.5 }, { week: "W38", day: "Tue", demand: 0.6 },
            { week: "W38", day: "Wed", demand: 0.7 }, { week: "W38", day: "Thu", demand: 0.9 },
            { week: "W38", day: "Fri", demand: 0.4 }, { week: "W38", day: "Sat", demand: 0.2 },
            { week: "W38", day: "Sun", demand: 0.1 },
        ], ArrayType(StructType({ week: StringType, day: StringType, demand: FloatType })));
        return (
            <AlignedStack gutter={{ left: "56px", right: "12px" }} gap="8px">
                <Box height="150px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(load, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [-0.5, 6.5], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "load" }}
                        grid
                    />
                </Box>
                <Calendar
                    data={grid}
                    cell={d => ({ week: d.week, day: d.day, value: d.demand })}                />
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * A `<Chart>` stacked over a `<Matrix>` in an `<AlignedStack>` — the Matrix inherits
 * the gutter from context, so its row-header pane fills `left` and the value-grid
 * columns fill `[left, W−right]`, lining up column-for-column under the chart's day
 * axis. (#147)
 */
export const alignedStackChartMatrix = example({
    keywords: ["AlignedStack", "plotGutter", "Chart", "Matrix", "align", "lane", "grid", "day"],
    description: "A Chart stacked over a Matrix sharing one gutter — the Matrix value-grid lines up column-for-column under the chart's day axis",
    fn: East.function([], UIComponentType, ($) => {
        const load = $.const([
            { day: 0.0, v: 0.45 }, { day: 1.0, v: 0.70 }, { day: 2.0, v: 0.85 },
            { day: 3.0, v: 0.60 }, { day: 4.0, v: 0.30 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter={{ left: "120px", right: "12px" }} gap="8px">
                <Box height="150px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(load, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [-0.5, 4.5], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0] }}
                        y={{ label: "load" }}
                        grid
                    />
                </Box>
                <Matrix
                    data={[
                        { name: "Alice", booked: new Map([["mon", 0.45], ["tue", 0.70], ["wed", 0.85], ["thu", 0.60], ["fri", 0.30]]) },
                        { name: "Bob", booked: new Map([["mon", 0.35], ["tue", 0.60], ["wed", 0.30], ["thu", 0.75], ["fri", 0.50]]) },
                    ]}
                    columns={[
                        Matrix.column({ key: "mon", label: "Mon" }),
                        Matrix.column({ key: "tue", label: "Tue" }),
                        Matrix.column({ key: "wed", label: "Wed" }),
                        Matrix.column({ key: "thu", label: "Thu" }),
                        Matrix.column({ key: "fri", label: "Fri" }),
                    ]}
                    rowKey={r => r.name}
                    rowHeader="Resource"
                    cell={(r, col) => Matrix.cell({ segments: [
                        Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
                        Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                    ] })}
                />
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * A `<Chart>` stacked over a `<Table>` in an `<AlignedStack>` — the Table inherits
 * the gutter from context, so the frozen `resource` column fills `left`, the data
 * columns flex-fill `[left, W−right]`, and horizontal scroll is dropped. The data
 * lane lines up under the chart's day axis on shared categories. (#147)
 */
export const alignedStackChartTable = example({
    keywords: ["AlignedStack", "plotGutter", "Chart", "Table", "frozen", "align", "lane", "categories"],
    description: "A Chart stacked over a Table sharing one gutter — the frozen column fills `left` and the data columns line up under the chart's day axis",
    fn: East.function([], UIComponentType, ($) => {
        const load = $.const([
            { day: 0.0, v: 0.45 }, { day: 1.0, v: 0.70 }, { day: 2.0, v: 0.85 },
            { day: 3.0, v: 0.60 }, { day: 4.0, v: 0.30 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter={{ left: "120px", right: "12px" }} gap="8px">
                <Box height="150px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(load, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [-0.5, 4.5], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0] }}
                        y={{ label: "load" }}
                        grid
                    />
                </Box>
                <Table
                    data={[
                        { resource: "Alice", mon: "0.45", tue: "0.70", wed: "0.85", thu: "0.60", fri: "0.30" },
                        { resource: "Bob", mon: "0.35", tue: "0.60", wed: "0.30", thu: "0.75", fri: "0.50" },
                    ]}
                    columns={{
                        resource: { header: "Resource" },
                        mon: { header: "Mon" }, tue: { header: "Tue" }, wed: { header: "Wed" },
                        thu: { header: "Thu" }, fri: { header: "Fri" },
                    }}
                    frozen={["resource"]}
                />
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * A `<Chart>` stacked over a `<Planner>` in an `<AlignedStack>` — the canonical
 * acceptance case (#147). The Planner inherits the gutter from context, so its
 * frozen channel column fills `left`, the day-slot timeline fills `[left, W−right]`,
 * and horizontal scroll is dropped — the slot lane lines up under the chart's day
 * axis. (Match the chart's interval count to the slot count for the interior
 * day-lines to coincide; the gutter always aligns the lane edges.)
 */
export const alignedStackChartPlanner = example({
    keywords: ["AlignedStack", "plotGutter", "Chart", "Planner", "frozen", "timeline", "day", "axis", "align"],
    description: "A Chart stacked over a Planner sharing one gutter — the frozen channel fills `left` and the day-slot timeline lines up under the chart's day axis",
    fn: East.function([], UIComponentType, ($) => {
        const temp = $.const([
            { day: 0.0, v: 12.0 }, { day: 1.0, v: 14.0 }, { day: 2.0, v: 18.0 },
            { day: 3.0, v: 20.0 }, { day: 4.0, v: 19.0 }, { day: 5.0, v: 16.0 }, { day: 6.0, v: 13.0 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter={{ left: "140px", right: "12px" }} gap="8px">
                <Box height="150px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(temp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [-0.5, 6.5], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "°C" }}
                        grid
                    />
                </Box>
                <Planner.Point
                    data={[{ name: "Line A", role: "Primary" }, { name: "Line B", role: "Backup" }]}
                    axis={Planner.axis.number({ range: { min: 0, max: 6 } })}
                    columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                    events={_r => [
                        Planner.event({ slot: Planner.at.number(0), label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(2), label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(4), label: "plan", state: "added" }),
                        Planner.event({ slot: Planner.at.number(6), label: "?", state: "model" }),
                    ]}
                    now={Planner.at.number(4)}
                    onSelectRow={East.function([Planner.Types.SelectEvent], NullType, _$ => null)}
                />
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * #327 regression — a `<Chart>` carrying BOTH axis titles (`x` "Day", `y` "°C")
 * stacked over a `<Planner>`. The x-title renders in its own band below the plot
 * (growing the chart's footprint) rather than eating the bottom plot margin, so
 * the plot rect stays put and the chart's day ticks still line up with the
 * Planner's day columns — the title no longer shoves the stacked lane.
 */
export const alignedStackChartTitles = example({
    keywords: ["AlignedStack", "Chart", "Planner", "axis", "title", "label", "titleGap", "margin", "align", "gutter"],
    description: "A Chart with x + y axis titles (nudged out with titleGap) stacked over a Planner — the titles push into their own axis bands while the day ticks stay aligned with the Planner columns (#327)",
    fn: East.function([], UIComponentType, ($) => {
        const temp = $.const([
            { day: 0.0, v: 12.0 }, { day: 1.0, v: 14.0 }, { day: 2.0, v: 18.0 },
            { day: 3.0, v: 20.0 }, { day: 4.0, v: 19.0 }, { day: 5.0, v: 16.0 }, { day: 6.0, v: 13.0 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter={{ left: "140px", right: "12px" }} gap="8px">
                <Box height="170px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(temp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ label: "Day", titleGap: 8, scale: "linear", domain: [-0.5, 6.5], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "°C", titleGap: 6 }}
                        grid
                    />
                </Box>
                <Planner.Point
                    data={[{ name: "Line A", role: "Primary" }, { name: "Line B", role: "Backup" }]}
                    axis={Planner.axis.number({ range: { min: 0, max: 6 } })}
                    columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                    events={_r => [
                        Planner.event({ slot: Planner.at.number(0), label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(4), label: "plan", state: "added" }),
                    ]}
                    now={Planner.at.number(4)}
                />
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * A `<Chart>` and a `<Planner>` on one FORMATTED DATE axis (#309) — both lanes
 * speak real instants and the same date-pattern tokens. The Planner pins a
 * half-open day window `[min, max)` at `resolution: "day"` (seven columns,
 * `"ddd DD"` → `Mon 30 … Sun 05`); the Chart's time x-axis pins the SAME
 * `[min, max]` domain with `Chart.format.date("ddd DD")` ticks. Because the
 * window spans exactly seven days, each day-noon data point lands at
 * `(i + 0.5)/7` of the shared gutter lane — the centre of its Planner day
 * column — so the bars sit inside the day cells they schedule.
 */
export const alignedStackDateAxis = example({
    keywords: ["AlignedStack", "plotGutter", "Chart", "Planner", "time", "date", "resolution", "day", "format", "ddd", "tick", "align", "instants"],
    description: "A Chart and a day-resolution Planner share one gutter and one formatted date axis — the same [min, max) window and 'ddd DD' tokens on both lanes",
    fn: East.function([], UIComponentType, ($) => {
        const runs = $.const([
            { at: new Date("2026-03-30T12:00:00Z"), kl: 8.0 },
            { at: new Date("2026-03-31T12:00:00Z"), kl: 10.0 },
            { at: new Date("2026-04-01T12:00:00Z"), kl: 14.0 },
            { at: new Date("2026-04-02T12:00:00Z"), kl: 12.0 },
            { at: new Date("2026-04-03T12:00:00Z"), kl: 9.0 },
            { at: new Date("2026-04-04T12:00:00Z"), kl: 5.0 },
            { at: new Date("2026-04-05T12:00:00Z"), kl: 3.0 },
        ], ArrayType(StructType({ at: DateTimeType, kl: FloatType })));
        return (
            <AlignedStack gutter={{ left: "150px", right: "14px" }} gap="8px">
                <Box height="150px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Column(runs, { x: r => r.at, y: r => r.kl }, { color: "teal.solid" })}
                        x={{ scale: "time", domain: [new Date("2026-03-30"), new Date("2026-04-06")], format: Chart.format.date("ddd DD") }}
                        y={{ label: "kL" }}
                        grid
                    />
                </Box>
                <Planner.Point
                    data={[{ name: "Press A", role: "Crush" }, { name: "Press B", role: "Crush" }]}
                    axis={Planner.axis.time({
                        resolution: "day",
                        format: "ddd DD",
                        range: { min: new Date("2026-03-30"), max: new Date("2026-04-06") },
                    })}
                    now={Planner.at.time(new Date("2026-04-02"))}
                    columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                    events={_r => [
                        Planner.event({ slot: Planner.at.time(new Date("2026-03-30T09:00:00Z")), label: "Setup", state: "committed" }),
                        Planner.event({ slot: Planner.at.time(new Date("2026-04-01T09:00:00Z")), label: "Run", state: "committed" }),
                        Planner.event({ slot: Planner.at.time(new Date("2026-04-03T09:00:00Z")), label: "Plan", state: "added" }),
                    ]}
                />
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * A `<Chart>` stacked over a `<Gantt>` in an `<AlignedStack>` — the Gantt inherits
 * the gutter from context, so its frozen table panel is pinned to `left` (the
 * splitter no longer drags) and its time-axis timeline fills `[left, W−right]`,
 * lining up under the chart's plot. (#147)
 */
export const alignedStackChartGantt = example({
    keywords: ["AlignedStack", "plotGutter", "Chart", "Gantt", "timeline", "splitter", "frozen", "align", "time"],
    description: "A Chart stacked over a Gantt sharing one gutter — the frozen table panel fills `left` and the timeline lines up under the chart's plot",
    fn: East.function([], UIComponentType, ($) => {
        const load = $.const([
            { d: 0.0, v: 0.3 }, { d: 1.0, v: 0.6 }, { d: 2.0, v: 0.8 }, { d: 3.0, v: 0.5 },
        ], ArrayType(StructType({ d: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter={{ left: "180px", right: "14px" }} gap="8px">
                <Box height="150px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(load, { x: r => r.d, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [0, 3] }}
                        y={{ label: "load" }}
                        grid
                    />
                </Box>
                <Gantt
                    data={[
                        { task: "Planning", owner: "Alice", start: new Date("2024-01-01"), end: new Date("2024-01-20") },
                        { task: "Design", owner: "Bob", start: new Date("2024-01-15"), end: new Date("2024-02-05") },
                        { task: "Build", owner: "Carol", start: new Date("2024-01-25"), end: new Date("2024-03-01") },
                    ]}
                    columns={["task", "owner"]}
                    rowSpec={row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })}
                />
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * The kitchen-sink — ONE `<AlignedStack gutter>` lines up **seven** stacked lane
 * components on a single shared day axis: a `<Chart>` trajectory over a `<Trace>`
 * heat-strip, a `<Matrix>` utilisation grid, a `<Planner>` activity timeline, a
 * `<Calendar>` week band, a `<Table>` of per-day metrics, and a `<Gantt>` phase
 * timeline. Every component inherits the same `{ left, right }` gutter from
 * context — the frozen label columns / row headers / week labels all fill `left`,
 * and each data lane fills `[left, W−right]`, so the day columns line up top to
 * bottom without the consumer hand-matching a single number. (#147)
 */
export const alignedStackAll = example({
    keywords: ["AlignedStack", "plotGutter", "gutter", "Chart", "Trace", "Matrix", "Planner", "Calendar", "Table", "Gantt", "align", "stack", "dashboard", "all", "shared"],
    description: "One AlignedStack gutter lines up seven stacked lane components — Chart, Trace, Matrix, Planner, Calendar, Table and Gantt — on a common day axis",
    fn: East.function([], UIComponentType, ($) => {
        const trend = $.const([
            { day: 0.0, v: 12.0 }, { day: 1.0, v: 14.0 }, { day: 2.0, v: 18.0 },
            { day: 3.0, v: 20.0 }, { day: 4.0, v: 19.0 }, { day: 5.0, v: 16.0 }, { day: 6.0, v: 13.0 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter={{ left: "150px", right: "14px" }} gap="10px">
                {/* 1 — Chart: the metric trajectory, the reference axis. */}
                <Box height="140px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(trend, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [-0.5, 6.5], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "value" }}
                        grid
                    />
                </Box>
                {/* 2 — Trace: a two-series heat strip, one cell per day. (No own
                    `density` — it inherits the stack's, so the variants below cascade.) */}
                <Trace
                    tracks={[
                        { name: "Series A", values: [12.0, 13.0, 14.0, 16.0, 18.0, 20.0, 22.0] },
                        { name: "Series B", values: [1.0, 2.0, 3.0, 5.0, 7.0, 9.0, 11.0] },
                    ]}
                    now={4n}
                    axis={["0", "1", "2", "3", "4", "5", "6"]}
                />
                {/* 3 — Matrix: per-line booked/free utilisation, one column per day. */}
                <Matrix
                    data={[
                        { line: "Line A", booked: new Map([["d0", 0.4], ["d1", 0.7], ["d2", 0.85], ["d3", 0.6], ["d4", 0.8], ["d5", 0.3], ["d6", 0.2]]) },
                        { line: "Line B", booked: new Map([["d0", 0.5], ["d1", 0.6], ["d2", 0.7], ["d3", 0.9], ["d4", 0.4], ["d5", 0.2], ["d6", 0.1]]) },
                    ]}
                    columns={[
                        Matrix.column({ key: "d0", label: "0" }), Matrix.column({ key: "d1", label: "1" }),
                        Matrix.column({ key: "d2", label: "2" }), Matrix.column({ key: "d3", label: "3" }),
                        Matrix.column({ key: "d4", label: "4" }), Matrix.column({ key: "d5", label: "5" }),
                        Matrix.column({ key: "d6", label: "6" }),
                    ]}
                    rowKey={r => r.line}
                    rowHeader="Line"
                    cell={(r, col) => Matrix.cell({ segments: [
                        Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
                        Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                    ] })}
                />
                {/* 4 — Planner: per-line activity, one slot per day. */}
                <Planner.Point
                    data={[{ name: "Line A" }, { name: "Line B" }]}
                    axis={Planner.axis.number({ range: { min: 0, max: 6 } })}
                    columns={[{ key: "name", frozen: true, value: r => r.name }]}
                    events={_r => [
                        Planner.event({ slot: Planner.at.number(0), label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(2), label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(4), label: "plan", state: "added" }),
                        Planner.event({ slot: Planner.at.number(6), label: "?", state: "model" }),
                    ]}
                    now={Planner.at.number(4)}
                />
                {/* 5 — Calendar: a week band coloured by demand (week-label fills `left`). */}
                <Calendar
                    data={[
                        { week: "W37", day: "Mon", demand: 0.4 }, { week: "W37", day: "Tue", demand: 0.7 },
                        { week: "W37", day: "Wed", demand: 0.85 }, { week: "W37", day: "Thu", demand: 0.6 },
                        { week: "W37", day: "Fri", demand: 0.8 }, { week: "W37", day: "Sat", demand: 0.3 },
                        { week: "W37", day: "Sun", demand: 0.2 },
                    ]}
                    cell={d => ({ week: d.week, day: d.day, value: d.demand })}                />
                {/* 6 — Table: per-day metric row, frozen label column fills `left`. */}
                <Table
                    data={[
                        { metric: "Output", d0: "12", d1: "14", d2: "18", d3: "20", d4: "19", d5: "16", d6: "13" },
                        { metric: "Target", d0: "12", d1: "13", d2: "14", d3: "16", d4: "18", d5: "20", d6: "22" },
                    ]}
                    columns={{
                        metric: { header: "Metric" },
                        d0: { header: "0" }, d1: { header: "1" }, d2: { header: "2" }, d3: { header: "3" },
                        d4: { header: "4" }, d5: { header: "5" }, d6: { header: "6" },
                    }}
                    frozen={["metric"]}
                />
                {/* 7 — Gantt: phase timeline (its own time axis; the LANE still aligns). */}
                <Gantt
                    data={[
                        { phase: "Setup", owner: "—", start: new Date("2024-01-01"), end: new Date("2024-01-02") },
                        { phase: "Run", owner: "—", start: new Date("2024-01-02"), end: new Date("2024-01-06") },
                        { phase: "Wrap", owner: "—", start: new Date("2024-01-06"), end: new Date("2024-01-07") },
                    ]}
                    columns={["phase", "owner"]}
                    rowSpec={row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })}
                />
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * The same seven-component stack as {@link alignedStackAll}, but with
 * `density="compact"` on the `<AlignedStack>` — the stack imposes the density on
 * every lane child via context (each child still reads it through `useDensity`),
 * so the whole dashboard tightens its row rhythm in one place. (#147)
 */
export const alignedStackAllCompact = example({
    keywords: ["AlignedStack", "plotGutter", "density", "compact", "Chart", "Trace", "Matrix", "Planner", "Calendar", "Table", "Gantt", "stack", "all"],
    description: "The all-seven AlignedStack at density='compact' — one density prop tightens every lane child",
    fn: East.function([], UIComponentType, ($) => {
        const trend = $.const([
            { day: 0.0, v: 12.0 }, { day: 1.0, v: 14.0 }, { day: 2.0, v: 18.0 },
            { day: 3.0, v: 20.0 }, { day: 4.0, v: 19.0 }, { day: 5.0, v: 16.0 }, { day: 6.0, v: 13.0 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter={{ left: "150px", right: "14px" }} gap="8px" density="compact">
                <Box height="130px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(trend, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [-0.5, 6.5], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "value" }}
                        grid
                    />
                </Box>
                <Trace
                    tracks={[
                        { name: "Series A", values: [12.0, 13.0, 14.0, 16.0, 18.0, 20.0, 22.0] },
                        { name: "Series B", values: [1.0, 2.0, 3.0, 5.0, 7.0, 9.0, 11.0] },
                    ]}
                    now={4n}
                    axis={["0", "1", "2", "3", "4", "5", "6"]}
                />
                <Matrix
                    data={[
                        { line: "Line A", booked: new Map([["d0", 0.4], ["d1", 0.7], ["d2", 0.85], ["d3", 0.6], ["d4", 0.8], ["d5", 0.3], ["d6", 0.2]]) },
                        { line: "Line B", booked: new Map([["d0", 0.5], ["d1", 0.6], ["d2", 0.7], ["d3", 0.9], ["d4", 0.4], ["d5", 0.2], ["d6", 0.1]]) },
                    ]}
                    columns={[
                        Matrix.column({ key: "d0", label: "0" }), Matrix.column({ key: "d1", label: "1" }),
                        Matrix.column({ key: "d2", label: "2" }), Matrix.column({ key: "d3", label: "3" }),
                        Matrix.column({ key: "d4", label: "4" }), Matrix.column({ key: "d5", label: "5" }),
                        Matrix.column({ key: "d6", label: "6" }),
                    ]}
                    rowKey={r => r.line}
                    rowHeader="Line"
                    cell={(r, col) => Matrix.cell({ segments: [
                        Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
                        Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                    ] })}
                />
                <Planner.Point
                    data={[{ name: "Line A" }, { name: "Line B" }]}
                    axis={Planner.axis.number({ range: { min: 0, max: 6 } })}
                    columns={[{ key: "name", frozen: true, value: r => r.name }]}
                    events={_r => [
                        Planner.event({ slot: Planner.at.number(0), label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(2), label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(4), label: "plan", state: "added" }),
                        Planner.event({ slot: Planner.at.number(6), label: "?", state: "model" }),
                    ]}
                    now={Planner.at.number(4)}
                />
                <Calendar
                    data={[
                        { week: "W37", day: "Mon", demand: 0.4 }, { week: "W37", day: "Tue", demand: 0.7 },
                        { week: "W37", day: "Wed", demand: 0.85 }, { week: "W37", day: "Thu", demand: 0.6 },
                        { week: "W37", day: "Fri", demand: 0.8 }, { week: "W37", day: "Sat", demand: 0.3 },
                        { week: "W37", day: "Sun", demand: 0.2 },
                    ]}
                    cell={d => ({ week: d.week, day: d.day, value: d.demand })}                />
                <Table
                    data={[
                        { metric: "Output", d0: "12", d1: "14", d2: "18", d3: "20", d4: "19", d5: "16", d6: "13" },
                        { metric: "Target", d0: "12", d1: "13", d2: "14", d3: "16", d4: "18", d5: "20", d6: "22" },
                    ]}
                    columns={{
                        metric: { header: "Metric" },
                        d0: { header: "0" }, d1: { header: "1" }, d2: { header: "2" }, d3: { header: "3" },
                        d4: { header: "4" }, d5: { header: "5" }, d6: { header: "6" },
                    }}
                    frozen={["metric"]}
                />
                <Gantt
                    data={[
                        { phase: "Setup", owner: "—", start: new Date("2024-01-01"), end: new Date("2024-01-02") },
                        { phase: "Run", owner: "—", start: new Date("2024-01-02"), end: new Date("2024-01-06") },
                        { phase: "Wrap", owner: "—", start: new Date("2024-01-06"), end: new Date("2024-01-07") },
                    ]}
                    columns={["phase", "owner"]}
                    rowSpec={row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })}
                />
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * The all-seven stack at `density="condensed"` — the tightest preset. Same single
 * density prop on the `<AlignedStack>` cascades to every lane child. (#147)
 */
export const alignedStackAllCondensed = example({
    keywords: ["AlignedStack", "plotGutter", "density", "condensed", "Chart", "Trace", "Matrix", "Planner", "Calendar", "Table", "Gantt", "stack", "all"],
    description: "The all-seven AlignedStack at density='condensed' — the tightest preset, cascaded from one prop",
    fn: East.function([], UIComponentType, ($) => {
        const trend = $.const([
            { day: 0.0, v: 12.0 }, { day: 1.0, v: 14.0 }, { day: 2.0, v: 18.0 },
            { day: 3.0, v: 20.0 }, { day: 4.0, v: 19.0 }, { day: 5.0, v: 16.0 }, { day: 6.0, v: 13.0 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter={{ left: "150px", right: "14px" }} gap="6px" density="condensed">
                <Box height="120px" width="100%">
                    <Chart
                        height="fill"
                        layers={Chart.Line(trend, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [-0.5, 6.5], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "value" }}
                        grid
                    />
                </Box>
                <Trace
                    tracks={[
                        { name: "Series A", values: [12.0, 13.0, 14.0, 16.0, 18.0, 20.0, 22.0] },
                        { name: "Series B", values: [1.0, 2.0, 3.0, 5.0, 7.0, 9.0, 11.0] },
                    ]}
                    now={4n}
                    axis={["0", "1", "2", "3", "4", "5", "6"]}
                />
                <Matrix
                    data={[
                        { line: "Line A", booked: new Map([["d0", 0.4], ["d1", 0.7], ["d2", 0.85], ["d3", 0.6], ["d4", 0.8], ["d5", 0.3], ["d6", 0.2]]) },
                        { line: "Line B", booked: new Map([["d0", 0.5], ["d1", 0.6], ["d2", 0.7], ["d3", 0.9], ["d4", 0.4], ["d5", 0.2], ["d6", 0.1]]) },
                    ]}
                    columns={[
                        Matrix.column({ key: "d0", label: "0" }), Matrix.column({ key: "d1", label: "1" }),
                        Matrix.column({ key: "d2", label: "2" }), Matrix.column({ key: "d3", label: "3" }),
                        Matrix.column({ key: "d4", label: "4" }), Matrix.column({ key: "d5", label: "5" }),
                        Matrix.column({ key: "d6", label: "6" }),
                    ]}
                    rowKey={r => r.line}
                    rowHeader="Line"
                    cell={(r, col) => Matrix.cell({ segments: [
                        Matrix.segment({ fill: "brand", weight: r.booked.get(col.key) }),
                        Matrix.segment({ fill: "free", weight: East.value(1.0, FloatType).subtract(r.booked.get(col.key)) }),
                    ] })}
                />
                <Planner.Point
                    data={[{ name: "Line A" }, { name: "Line B" }]}
                    axis={Planner.axis.number({ range: { min: 0, max: 6 } })}
                    columns={[{ key: "name", frozen: true, value: r => r.name }]}
                    events={_r => [
                        Planner.event({ slot: Planner.at.number(0), label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(2), label: "✓", state: "committed" }),
                        Planner.event({ slot: Planner.at.number(4), label: "plan", state: "added" }),
                        Planner.event({ slot: Planner.at.number(6), label: "?", state: "model" }),
                    ]}
                    now={Planner.at.number(4)}
                />
                <Calendar
                    data={[
                        { week: "W37", day: "Mon", demand: 0.4 }, { week: "W37", day: "Tue", demand: 0.7 },
                        { week: "W37", day: "Wed", demand: 0.85 }, { week: "W37", day: "Thu", demand: 0.6 },
                        { week: "W37", day: "Fri", demand: 0.8 }, { week: "W37", day: "Sat", demand: 0.3 },
                        { week: "W37", day: "Sun", demand: 0.2 },
                    ]}
                    cell={d => ({ week: d.week, day: d.day, value: d.demand })}                />
                <Table
                    data={[
                        { metric: "Output", d0: "12", d1: "14", d2: "18", d3: "20", d4: "19", d5: "16", d6: "13" },
                        { metric: "Target", d0: "12", d1: "13", d2: "14", d3: "16", d4: "18", d5: "20", d6: "22" },
                    ]}
                    columns={{
                        metric: { header: "Metric" },
                        d0: { header: "0" }, d1: { header: "1" }, d2: { header: "2" }, d3: { header: "3" },
                        d4: { header: "4" }, d5: { header: "5" }, d6: { header: "6" },
                    }}
                    frozen={["metric"]}
                />
                <Gantt
                    data={[
                        { phase: "Setup", owner: "—", start: new Date("2024-01-01"), end: new Date("2024-01-02") },
                        { phase: "Run", owner: "—", start: new Date("2024-01-02"), end: new Date("2024-01-06") },
                        { phase: "Wrap", owner: "—", start: new Date("2024-01-06"), end: new Date("2024-01-07") },
                    ]}
                    columns={["phase", "owner"]}
                    rowSpec={row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })}
                />
            </AlignedStack>
        );
    }),
    inputs: [],
});

/**
 * `gutter="auto"` — AlignedStack measures the max gutter its children need and
 * imposes it on all (not yet wired in the renderer; imposes nothing for now).
 */
export const alignedStackAuto = example({
    keywords: ["AlignedStack", "gutter", "auto", "measure", "align"],
    description: "AlignedStack with gutter='auto' (measure-the-max mode)",
    fn: East.function([], UIComponentType, ($) => {
        const rows = $.const([
            { day: 0.0, v: 10.0 }, { day: 3.0, v: 14.0 }, { day: 6.0, v: 9.0 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <AlignedStack gutter="auto" gap="6px">
                <Box height="160px" width="100%">
                    <Chart height="fill" layers={Chart.Line(rows, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })} grid />
                </Box>
            </AlignedStack>
        );
    }),
    inputs: [],
});
