/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */
import { East, ArrayType, DateTimeType, FloatType, StringType, StructType, example } from "@elaraai/east";
import { UIComponentType, DragEventType } from "@elaraai/east-ui";
import { NullType } from "@elaraai/east";
import { AlignedStack, Box, Calendar, Chart, Gantt, HStack, Library, Matrix, Planner, Separator, Table, Trace, VStack } from "@elaraai/east-ui";

// ============================================================================
// Module-scope fixtures — one per merged example (consolidation epic #455).
// ============================================================================

const ALIGNED_STACK_CHARTS_DATA = [
    { day: 0.0, v: 22.0 }, { day: 2.0, v: 20.5 }, { day: 4.0, v: 18.0 }, { day: 6.0, v: 16.5 },
];
const ALIGNED_STACK_CHARTS_RATE_DATA = [
    { day: 0.0, v: 1.2 }, { day: 2.0, v: 0.9 }, { day: 4.0, v: 0.6 }, { day: 6.0, v: 0.3 },
];
const ALIGNED_STACK_CHART_TRACE_DATA = [
    { day: 0.0, v: 22.0 }, { day: 2.0, v: 20.0 }, { day: 4.0, v: 18.0 }, { day: 6.0, v: 16.0 },
];
const ALIGNED_STACK_CHART_CALENDAR_DATA = [
    { day: 0.0, v: 0.4 }, { day: 1.0, v: 0.7 }, { day: 2.0, v: 0.9 },
    { day: 3.0, v: 0.6 }, { day: 4.0, v: 0.8 }, { day: 5.0, v: 0.3 }, { day: 6.0, v: 0.2 },
];
const ALIGNED_STACK_CHART_CALENDAR_GRID_DATA = [
    { week: "W37", day: "Mon", demand: 0.4 }, { week: "W37", day: "Tue", demand: 0.7 },
    { week: "W37", day: "Wed", demand: 0.9 }, { week: "W37", day: "Thu", demand: 0.6 },
    { week: "W37", day: "Fri", demand: 0.8 }, { week: "W37", day: "Sat", demand: 0.3 },
    { week: "W37", day: "Sun", demand: 0.2 },
    { week: "W38", day: "Mon", demand: 0.5 }, { week: "W38", day: "Tue", demand: 0.6 },
    { week: "W38", day: "Wed", demand: 0.7 }, { week: "W38", day: "Thu", demand: 0.9 },
    { week: "W38", day: "Fri", demand: 0.4 }, { week: "W38", day: "Sat", demand: 0.2 },
    { week: "W38", day: "Sun", demand: 0.1 },
];
const ALIGNED_STACK_CHART_MATRIX_DATA = [
    { day: 0.0, v: 0.45 }, { day: 1.0, v: 0.70 }, { day: 2.0, v: 0.85 },
    { day: 3.0, v: 0.60 }, { day: 4.0, v: 0.30 },
];
const ALIGNED_STACK_CHART_TABLE_DATA = [
    { day: 0.0, v: 0.45 }, { day: 1.0, v: 0.70 }, { day: 2.0, v: 0.85 },
    { day: 3.0, v: 0.60 }, { day: 4.0, v: 0.30 },
];
const ALIGNED_STACK_CHART_PLANNER_DATA = [
    { day: 0.0, v: 12.0 }, { day: 1.0, v: 14.0 }, { day: 2.0, v: 18.0 },
    { day: 3.0, v: 20.0 }, { day: 4.0, v: 19.0 }, { day: 5.0, v: 16.0 }, { day: 6.0, v: 13.0 },
];
const ALIGNED_STACK_CHART_GANTT_DATA = [
    { d: 0.0, v: 0.3 }, { d: 1.0, v: 0.6 }, { d: 2.0, v: 0.8 }, { d: 3.0, v: 0.5 },
];
const ALIGNED_STACK_ALL_COMPACT_DATA = [
    { day: 0.0, v: 12.0 }, { day: 1.0, v: 14.0 }, { day: 2.0, v: 18.0 },
    { day: 3.0, v: 20.0 }, { day: 4.0, v: 19.0 }, { day: 5.0, v: 16.0 }, { day: 6.0, v: 13.0 },
];
const ALIGNED_STACK_ALL_CONDENSED_DATA = [
    { day: 0.0, v: 12.0 }, { day: 1.0, v: 14.0 }, { day: 2.0, v: 18.0 },
    { day: 3.0, v: 20.0 }, { day: 4.0, v: 19.0 }, { day: 5.0, v: 16.0 }, { day: 6.0, v: 13.0 },
];
const ALIGNED_STACK_CHART_TITLES_DATA = [
    { day: 0.0, v: 12.0 }, { day: 1.0, v: 14.0 }, { day: 2.0, v: 18.0 },
    { day: 3.0, v: 20.0 }, { day: 4.0, v: 19.0 }, { day: 5.0, v: 16.0 }, { day: 6.0, v: 13.0 },
];
const ALIGNED_STACK_DATE_AXIS_DATA = [
    { at: new Date("2026-03-30T12:00:00Z"), kl: 8.0 },
    { at: new Date("2026-03-31T12:00:00Z"), kl: 10.0 },
    { at: new Date("2026-04-01T12:00:00Z"), kl: 14.0 },
    { at: new Date("2026-04-02T12:00:00Z"), kl: 12.0 },
    { at: new Date("2026-04-03T12:00:00Z"), kl: 9.0 },
    { at: new Date("2026-04-04T12:00:00Z"), kl: 5.0 },
    { at: new Date("2026-04-05T12:00:00Z"), kl: 3.0 },
];
const ALIGNED_STACK_AUTO_DATA = [
    { day: 0.0, v: 10.0 }, { day: 3.0, v: 14.0 }, { day: 6.0, v: 9.0 },
];

// ============================================================================
// The flagship — golden-coupled, name and body frozen
// ============================================================================

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

// ============================================================================
// AlignedStack — Chart-over-lane pairs (variant panel)
// ============================================================================

export const alignedStackPairs = example({
    keywords: ["AlignedStack", "plotGutter", "gutter", "align", "Chart", "stack", "axis", "shared", "Trace", "lane", "day", "Calendar", "week", "Matrix", "grid", "Table", "frozen", "categories", "Planner", "timeline", "Gantt", "splitter", "time"],
    description: "Pair panel — stack charts (two stacked charts share one plot gutter on a common day axis), stack chart trace (the Trace's step lane lines up under the chart's day axis), stack chart calendar (the Calendar's day band lines up under the chart's day axis), stack chart matrix (the Matrix value-grid lines up column-for-column under the chart's day axis), stack chart table (the frozen column fills left and the data columns line up under the chart's day axis), stack chart planner (the frozen channel fills left and the day-slot timeline lines up under the chart's day axis), stack chart gantt (the frozen table panel fills left and the timeline lines up under the chart's plot)",
    fn: East.function([], UIComponentType, ($) => {
        const chartsTemp = $.const(ALIGNED_STACK_CHARTS_DATA, ArrayType(StructType({ day: FloatType, v: FloatType })));
        const chartsRate = $.const(ALIGNED_STACK_CHARTS_RATE_DATA, ArrayType(StructType({ day: FloatType, v: FloatType })));
        const traceTemp = $.const(ALIGNED_STACK_CHART_TRACE_DATA, ArrayType(StructType({ day: FloatType, v: FloatType })));
        const calendarLoad = $.const(ALIGNED_STACK_CHART_CALENDAR_DATA, ArrayType(StructType({ day: FloatType, v: FloatType })));
        const calendarGrid = $.const(ALIGNED_STACK_CHART_CALENDAR_GRID_DATA, ArrayType(StructType({ week: StringType, day: StringType, demand: FloatType })));
        const matrixLoad = $.const(ALIGNED_STACK_CHART_MATRIX_DATA, ArrayType(StructType({ day: FloatType, v: FloatType })));
        const tableLoad = $.const(ALIGNED_STACK_CHART_TABLE_DATA, ArrayType(StructType({ day: FloatType, v: FloatType })));
        const plannerTemp = $.const(ALIGNED_STACK_CHART_PLANNER_DATA, ArrayType(StructType({ day: FloatType, v: FloatType })));
        const ganttLoad = $.const(ALIGNED_STACK_CHART_GANTT_DATA, ArrayType(StructType({ d: FloatType, v: FloatType })));
        return (
            <VStack gap="4" align="stretch">
                <Separator label="STACK CHARTS" align="start" />
                <AlignedStack gutter={{ left: "48px", right: "16px" }} gap="8px">
                    <Box height="180px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Line(chartsTemp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                            x={{ scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                            y={{ label: "°C" }}
                            grid
                        />
                    </Box>
                    <Box height="180px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Line(chartsRate, { x: r => r.day, y: r => r.v }, { color: "purple.solid" })}
                            x={{ scale: "linear", domain: [0, 6], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                            y={{ label: "rate" }}
                            grid
                        />
                    </Box>
                </AlignedStack>
                <Separator label="STACK CHART TRACE" align="start" />
                <AlignedStack gutter={{ left: "48px", right: "16px" }} gap="8px">
                    <Box height="160px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Line(traceTemp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
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
                <Separator label="STACK CHART CALENDAR" align="start" />
                <AlignedStack gutter={{ left: "56px", right: "12px" }} gap="8px">
                    <Box height="150px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Line(calendarLoad, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                            x={{ scale: "linear", domain: [-0.5, 6.5], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                            y={{ label: "load" }}
                            grid
                        />
                    </Box>
                    <Calendar
                        data={calendarGrid}
                        cell={d => ({ week: d.week, day: d.day, value: d.demand })}                />
                </AlignedStack>
                <Separator label="STACK CHART MATRIX" align="start" />
                <AlignedStack gutter={{ left: "120px", right: "12px" }} gap="8px">
                    <Box height="150px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Line(matrixLoad, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
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
                <Separator label="STACK CHART TABLE" align="start" />
                <AlignedStack gutter={{ left: "120px", right: "12px" }} gap="8px">
                    <Box height="150px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Line(tableLoad, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
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
                <Separator label="STACK CHART PLANNER" align="start" />
                <AlignedStack gutter={{ left: "140px", right: "12px" }} gap="8px">
                    <Box height="150px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Line(plannerTemp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
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
                <Separator label="STACK CHART GANTT" align="start" />
                <AlignedStack gutter={{ left: "180px", right: "14px" }} gap="8px">
                    <Box height="150px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Line(ganttLoad, { x: r => r.d, y: r => r.v }, { color: "teal.solid" })}
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
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// AlignedStack — density presets over the all-seven stack (variant panel)
// ============================================================================

export const alignedStackDensity = example({
    keywords: ["AlignedStack", "plotGutter", "density", "compact", "Chart", "Trace", "Matrix", "Planner", "Calendar", "Table", "Gantt", "stack", "all", "condensed"],
    description: "Density pair — stack all compact (the all-seven AlignedStack at density='compact', one density prop tightens every lane child) and stack all condensed (the tightest preset, cascaded from one prop)",
    fn: East.function([], UIComponentType, ($) => {
        const compactTrend = $.const(ALIGNED_STACK_ALL_COMPACT_DATA, ArrayType(StructType({ day: FloatType, v: FloatType })));
        const condensedTrend = $.const(ALIGNED_STACK_ALL_CONDENSED_DATA, ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <VStack gap="4" align="stretch">
                <Separator label="STACK ALL COMPACT" align="start" />
                <AlignedStack gutter={{ left: "150px", right: "14px" }} gap="8px" density="compact">
                    <Box height="130px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Line(compactTrend, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
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
                <Separator label="STACK ALL CONDENSED" align="start" />
                <AlignedStack gutter={{ left: "150px", right: "14px" }} gap="6px" density="condensed">
                    <Box height="120px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Line(condensedTrend, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
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
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// AlignedStack — axis titles, formatted date axis, auto gutter (variant panel)
// ============================================================================

export const alignedStackAxis = example({
    keywords: ["AlignedStack", "Chart", "Planner", "axis", "title", "label", "titleGap", "margin", "align", "gutter", "plotGutter", "time", "date", "resolution", "day", "format", "ddd", "tick", "instants", "auto", "measure"],
    description: "Axis panel — stack chart titles (#327: x + y axis titles nudged out with titleGap push into their own bands while the day ticks stay aligned with the Planner columns), stack date axis (a Chart and a day-resolution Planner share one gutter and one formatted date axis, the same half-open window and 'ddd DD' tokens on both lanes), stack auto (gutter='auto' measure-the-max mode)",
    fn: East.function([], UIComponentType, ($) => {
        const titlesTemp = $.const(ALIGNED_STACK_CHART_TITLES_DATA, ArrayType(StructType({ day: FloatType, v: FloatType })));
        const dateRuns = $.const(ALIGNED_STACK_DATE_AXIS_DATA, ArrayType(StructType({ at: DateTimeType, kl: FloatType })));
        const autoRows = $.const(ALIGNED_STACK_AUTO_DATA, ArrayType(StructType({ day: FloatType, v: FloatType })));
        return (
            <VStack gap="4" align="stretch">
                <Separator label="STACK CHART TITLES" align="start" />
                <AlignedStack gutter={{ left: "140px", right: "12px" }} gap="8px">
                    <Box height="170px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Line(titlesTemp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
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
                <Separator label="STACK DATE AXIS" align="start" />
                <AlignedStack gutter={{ left: "150px", right: "14px" }} gap="8px">
                    <Box height="150px" width="100%">
                        <Chart
                            height="fill"
                            layers={Chart.Column(dateRuns, { x: r => r.at, y: r => r.kl }, { color: "teal.solid" })}
                            x={{ scale: "time", domain: [new Date("2026-03-30"), new Date("2026-04-06")], format: Chart.format.date("ddd DD") }}
                            y={{ label: "kL" }}
                            grid
                        />
                    </Box>
                    <Planner.Point
                        data={[{ name: "Press A", role: "Stamp" }, { name: "Press B", role: "Stamp" }]}
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
                <Separator label="STACK AUTO" align="start" />
                <AlignedStack gutter="auto" gap="6px">
                    <Box height="160px" width="100%">
                        <Chart height="fill" layers={Chart.Line(autoRows, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })} grid />
                    </Box>
                </AlignedStack>
            </VStack>
        );
    }),
    inputs: [],
});

// ============================================================================
// Behavioral isolates
// ============================================================================

/**
 * DnD across an `<AlignedStack>` (#330) — a `<Library>` (drag SOURCE) beside a
 * Chart-over-`<Planner>` stack whose Planner is the drop TARGET (`sources` +
 * `onDrag`). The natural planning-board layout: drag an incoming delivery from
 * the library onto the planner while the chart stays aligned above it. The
 * Library cards must keep their grab handles even though the target is nested
 * in the AlignedStack (a sibling of the source).
 */
export const alignedStackLibraryDnd = example({
    keywords: ["AlignedStack", "Library", "Planner", "DnD", "drag", "drop", "target", "source", "sources", "onDrag", "grab", "handle", "board", "gutter"],
    description: "DnD across an AlignedStack (#330) — a Library drag-source beside a Chart-over-Planner stack whose Planner is the drop target; the library cards should keep their grab handles",
    fn: East.function([], UIComponentType, ($) => {
        const temp = $.const([
            { day: 0.0, v: 12.0 }, { day: 2.0, v: 18.0 }, { day: 4.0, v: 16.0 }, { day: 6.0, v: 13.0 },
        ], ArrayType(StructType({ day: FloatType, v: FloatType })));
        const tanks = $.const([
            { name: "Tank A", role: "Mix" }, { name: "Tank B", role: "Fill" },
        ], ArrayType(StructType({ name: StringType, role: StringType })));
        return (
            <HStack gap="4" width="100%" align="stretch">
                <Box width="200px">
                    <Library
                        id="incoming"
                        data={[
                            { id: "d1", name: "Grade A — Bin 3" },
                            { id: "d2", name: "Grade B — Bin 7" },
                        ]}
                        item={r => ({ key: r.id, label: r.name, icon: "box" })}
                    />
                </Box>
                <Box flex="1" minWidth="0">
                    <AlignedStack gutter={{ left: "120px", right: "12px" }} gap="8px">
                        <Box height="140px" width="100%">
                            <Chart
                                height="fill"
                                layers={Chart.Line(temp, { x: r => r.day, y: r => r.v }, { color: "teal.solid" })}
                                x={{ label: "Day", scale: "linear", domain: [-0.5, 6.5], tickValues: [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0] }}
                                y={{ label: "°C" }}
                                grid
                            />
                        </Box>
                        <Planner.Point
                            id="board"
                            sources={["incoming"]}
                            data={tanks}
                            axis={Planner.axis.number({ range: { min: 0, max: 6 } })}
                            columns={[{ key: "name", frozen: true, value: r => r.name, sublabel: r => r.role }]}
                            events={_r => [Planner.event({ slot: Planner.at.number(3), label: "plan", state: "added" })]}
                            onDrag={East.function([DragEventType], NullType, (_$, _event) => {})}
                            now={Planner.at.number(3)}
                        />
                    </AlignedStack>
                </Box>
            </HStack>
        );
    }),
    inputs: [],
});
