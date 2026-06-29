/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, FloatType, StringType, StructType, example } from "@elaraai/east";
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
                        layers={Chart.Line(temp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "°C" }}
                        grid
                    />
                </Box>
                <Box height="180px" width="100%">
                    <Chart
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
                        layers={Chart.Line(temp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "°C" }}
                        grid
                    />
                </Box>
                <Trace
                    tracks={[
                        { name: "Bé", values: [12.0, 13.0, 14.0, 16.0, 18.0, 20.0, 22.0] },
                        { name: "Alc", values: [1.0, 2.0, 3.0, 5.0, 7.0, 9.0, 11.0] },
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
                        layers={Chart.Line(load, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "load" }}
                        grid
                    />
                </Box>
                <Calendar
                    data={grid}
                    cell={d => ({ week: d.week, day: d.day, value: d.demand })}
                    legend="low → high"
                />
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
                        layers={Chart.Line(load, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [0, 4], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0] }}
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
                        layers={Chart.Line(load, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [0, 4], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0] }}
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
                        layers={Chart.Line(temp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                        x={{ scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                        y={{ label: "°C" }}
                        grid
                    />
                </Box>
                <Planner.Point
                    data={[{ name: "Tank A", role: "Ferment" }, { name: "Tank B", role: "Ferment" }]}
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
                    <Chart layers={Chart.Line(rows, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })} grid />
                </Box>
            </AlignedStack>
        );
    }),
    inputs: [],
});
