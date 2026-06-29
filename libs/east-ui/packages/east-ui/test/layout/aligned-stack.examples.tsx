/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, FloatType, StringType, StructType, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { AlignedStack, Box, Calendar, Chart, Matrix, Trace } from "@elaraai/east-ui";

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
