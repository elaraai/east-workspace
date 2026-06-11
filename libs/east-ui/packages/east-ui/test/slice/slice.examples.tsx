/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/east-ui */

/**
 * Slice examples — use-case documents for the composition model:
 *
 * - **Data flows explicitly.** Consumers read `Slice.rows([RowType], slice)`
 *   (or aggregate from it); nothing narrows data behind your back.
 * - **Chrome attaches declaratively.** A component's `slice` option mounts
 *   the affordance rail (and footer / legend / brush, per component) in its
 *   own chassis; the standalone `Slice.Rail` strip serves multi-consumer
 *   compositions. There are no per-consumer wrappers.
 *
 * Across these examples every affordance is exercised: filter, search,
 * cohort, breakdown, range, brush — plus the count footer, the legend, the
 * `Chart.Series` layer, the compress ladder, and `Slice.Summary`.
 */

import { East, DateTimeType, StringType, IntegerType, NullType, ArrayType, StructType, variant, some, none, example } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { Box, Chart, Gantt, Reactive, Slice, State, Table, VStack } from "@elaraai/east-ui";

// ============================================================================
// 1. Events table — Table with the `slice` chrome option.
//    Exercises: filter chips, add-filter builder, search, save-as-cohort,
//    active cohorts, the derived-count footer.
// ============================================================================

export const sliceTableChrome = example({
    keywords: ["Slice", "Table", "slice", "chrome", "filter", "search", "cohort", "footer", "count"],
    description: "Events table — Table with the `slice` chrome option: a header rail mounting `[\"filter\", \"search\", \"cohort\"]` (an active saved cohort applies its clauses) and one footer band — derived count left, pager right; rows fed explicitly via `Slice.rows`",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ scenario: StringType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { scenario: { label: "Scenario" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            searchFieldIds: ["scenario", "region"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { scenario: "procurement v3", region: "EU",   sessions: 42n },
                    { scenario: "procurement v3", region: "NA",   sessions: 18n },
                    { scenario: "procurement v2", region: "EU",   sessions: 31n },
                    { scenario: "logistics",      region: "NA",   sessions: 56n },
                    { scenario: "procurement v3", region: "APAC", sessions: 7n },
                    { scenario: "procurement v2", region: "APAC", sessions: 25n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.table.chrome", cfg, Slice.state({
                    filters: [variant("string", { fieldId: "scenario", op: variant("eq", "procurement v3") })],
                    cohorts: [{ id: "high-volume", name: "High volume", filters: [
                        variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                    ] }],
                    activeCohorts: new Set(["high-volume"]),
                }), data, none));
                const narrowed = $.let(Slice.rows([EventType], slice));
                const pageBind = $.let(State.bind([IntegerType], "ex.slice.table.chrome.page", 0n));
                return (
                    <Table data={narrowed} columns={{
                        scenario: { header: "Scenario" },
                        region:   { header: "Region" },
                        sessions: { header: "Sessions" },
                    }} slice={slice} affordances={["filter", "search", "cohort"]} pagination={{
                        pageSize: 2n,
                        page: pageBind.read(),
                        onPageChange: East.function([IntegerType], NullType, ($, page) => {
                            $(pageBind.write(page));
                        }),
                    }} />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 2. Sessions chart — Chart with the `slice` chrome option.
//    Exercises: breakdown (→ Chart.Series split + colour-matched legend),
//    range pill, the brush gesture on a time x-axis.
// ============================================================================

export const sliceChartChrome = example({
    keywords: ["Slice", "Chart", "slice", "chrome", "Series", "breakdown", "legend", "brush", "range"],
    description: "Sessions chart — Chart with the `slice` chrome option: its own header rail (`breakdown`, `range`, `brush`), a `Chart.Series` layer splitting the narrowed rows into one coloured series per active-breakdown value, the colour-matched legend beneath the plot, and drag-to-range brushing on the time x-axis",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ day: DateTimeType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { day: { label: "Day" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            breakdownFieldIds: ["region"],
            rangeFieldId: "day",
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { day: new Date("2025-03-03"), region: "EU", sessions: 30n },
                    { day: new Date("2025-03-03"), region: "NA", sessions: 22n },
                    { day: new Date("2025-03-10"), region: "EU", sessions: 42n },
                    { day: new Date("2025-03-10"), region: "NA", sessions: 28n },
                    { day: new Date("2025-03-17"), region: "EU", sessions: 38n },
                    { day: new Date("2025-03-17"), region: "NA", sessions: 41n },
                    { day: new Date("2025-03-24"), region: "EU", sessions: 51n },
                    { day: new Date("2025-03-24"), region: "NA", sessions: 36n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.chart.chrome", cfg, Slice.state({
                    breakdown: some({ fieldId: "region", limit: none }),
                }), data, none));
                return (
                    <Chart
                        layers={[Chart.Series(slice, { x: "day", value: "sessions" })]}
                        slice={slice}
                        affordances={["breakdown", "range", "brush"]}
                        height={180}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 3. One slice, three consumers — the standalone Slice.Rail strip.
//    Exercises: the strip placement, several consumers reading one
//    `Slice.rows` feed, `Slice.Summary` as the quiet status bar.
// ============================================================================

export const sliceRail = example({
    keywords: ["Slice", "Rail", "rows", "strip", "multi-consumer", "Table", "Summary"],
    description: "One slice, several consumers — a standalone Slice.Rail strip (with the brush mini-strip over the sessions domain) narrowing a plain Table reading `Slice.rows([RowType], slice)`, with Slice.Summary as the quiet status footer: chrome sits where the author puts it, data flows explicitly",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ scenario: StringType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { scenario: { label: "Scenario" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            searchFieldIds: ["scenario", "region"],
            rangeFieldId: "sessions",
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { scenario: "procurement v3", region: "EU",   sessions: 42n },
                    { scenario: "procurement v3", region: "NA",   sessions: 18n },
                    { scenario: "procurement v2", region: "EU",   sessions: 31n },
                    { scenario: "logistics",      region: "NA",   sessions: 56n },
                    { scenario: "procurement v3", region: "NA",   sessions: 12n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.rail", cfg, Slice.state({
                    filters: [variant("string", { fieldId: "scenario", op: variant("eq", "procurement v3") })],
                }), data, none));
                const narrowed = $.let(Slice.rows([EventType], slice));
                return (
                    <VStack gap="3" align="stretch">
                        <Slice.Rail slice={slice} affordances={["filter", "search", "brush"]} />
                        <Table data={narrowed} columns={{
                            scenario: { header: "Scenario" },
                            region:   { header: "Region" },
                            sessions: { header: "Sessions" },
                        }} />
                        <Slice.Summary slice={slice} />
                    </VStack>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 4. Narrow rail — the compress ladder under real width pressure.
//    Exercises: whole-chip folding → family count chips → the terminal
//    `N narrowed` chip, and the sectioned editor popover trigger.
// ============================================================================

export const sliceNarrow = example({
    keywords: ["Slice", "narrow", "ladder", "compress", "count chip", "editor"],
    description: "The compress ladder under width pressure — the same Table chrome in a ~360px rail: chips fold whole into `+M more`, families collapse to count chips, and the terminal chip opens the sectioned editor; nothing ever clips mid-chip",
    fn: East.function([], UIComponentType, (_$) => {
        const EventType = StructType({ scenario: StringType, region: StringType, sessions: IntegerType });
        const cfg = Slice.config(EventType, {
            fields: { scenario: { label: "Scenario" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
            searchFieldIds: ["scenario"],
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { scenario: "procurement v3", region: "EU", sessions: 42n },
                    { scenario: "procurement v3", region: "NA", sessions: 18n },
                    { scenario: "procurement v2", region: "EU", sessions: 31n },
                ], ArrayType(EventType));
                const slice = $.let(Slice.bind([EventType], "ex.slice.narrow", cfg, Slice.state({
                    filters: [
                        variant("string", { fieldId: "scenario", op: variant("eq", "procurement v3") }),
                        variant("string", { fieldId: "region", op: variant("eq", "EU") }),
                        variant("integer", { fieldId: "sessions", op: variant("gte", 10n) }),
                    ],
                }), data, none));
                const narrowed = $.let(Slice.rows([EventType], slice));
                return (
                    <Box width="360px">
                        <Table data={narrowed} columns={{
                            scenario: { header: "Scenario" },
                            sessions: { header: "Sessions" },
                        }} slice={slice} />
                    </Box>
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});

// ============================================================================
// 5. Ops Gantt — Gantt with the `slice` chrome option.
//    Exercises: the rail on a timeline component (filter · search · range
//    over the row type's datetime field) and the derived-count footer.
// ============================================================================

export const sliceGanttChrome = example({
    keywords: ["Slice", "Gantt", "slice", "chrome", "filter", "search", "range", "timeline"],
    description: "Ops Gantt — Gantt with the `slice` chrome option: a header rail (`filter`, `search`, `range`) plus the `brush` affordance — drag a window on the timeline header to set the slice's range; a derived-count footer; rows fed explicitly via `Slice.rows`",
    fn: East.function([], UIComponentType, (_$) => {
        const JobType = StructType({ task: StringType, owner: StringType, start: DateTimeType, end: DateTimeType });
        const cfg = Slice.config(JobType, {
            fields: { task: { label: "Task" }, owner: { label: "Owner" }, start: { label: "Start" } },
            searchFieldIds: ["task", "owner"],
            rangeFieldId: "start",
        });
        return (
            <Reactive>{$ => {
                const data = $.const([
                    { task: "Planning",    owner: "Alice",   start: new Date("2024-01-01"), end: new Date("2024-01-15") },
                    { task: "Design",      owner: "Bob",     start: new Date("2024-01-10"), end: new Date("2024-02-01") },
                    { task: "Development", owner: "Charlie", start: new Date("2024-01-20"), end: new Date("2024-03-15") },
                    { task: "Testing",     owner: "Alice",   start: new Date("2024-03-01"), end: new Date("2024-03-30") },
                ], ArrayType(JobType));
                const slice = $.let(Slice.bind([JobType], "ex.slice.gantt.chrome", cfg, Slice.state({
                    filters: [variant("string", { fieldId: "owner", op: variant("eq", "Alice") })],
                }), data, none));
                const narrowed = $.let(Slice.rows([JobType], slice));
                return (
                    <Gantt
                        data={narrowed}
                        columns={["task", "owner"]}
                        rowSpec={row => ({ tasks: [Gantt.Task({ start: row.start, end: row.end })] })}
                        slice={slice}
                        affordances={["filter", "search", "range", "brush"]}
                    />
                );
            }}</Reactive>
        );
    }),
    inputs: [],
});
