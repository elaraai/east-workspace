/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * The Studio (#787) as a solution writes it — the design of record: the data
 * its components read, the components it offers, the one pages record its
 * operators build, and the three surfaces it mounts: the builder, the page
 * library and a published page. The record holds the mock of record's resting
 * state: the Ops console's Overview, live as v3 and drafted since, and the page
 * library's projects, pages and templates. A second record holds a page whose
 * placements hold content (#1669) — a text block and visuals over a source the
 * surface lists — and declares the one step that carries a workspace's pages
 * stored before a placement held content. A third holds a page of every form
 * a visual draws (#1671), over the quarter's orders.
 */

import {
    ArrayType, DateTimeType, East, FloatType, IntegerType, NullType, OptionType, SortedMap, StringType, StructType, VariantType, compareFor,
    example, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import {
    BarStrip, Box, Button, Chart, Format, Grid, HStack, MetricChip, Reactive, Table, Sparkline, Stat, State, Text, UIComponentType, VStack,
} from "@elaraai/east-ui";
import { Data, Record, Studio } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

// ============================================================================
// The data — what the components read
// ============================================================================

/** What a KPI measures: an amount of money, a count, a price or a ratio. */
const KpiUnit = VariantType({ money: NullType, count: NullType, price: NullType, ratio: NullType });

/** The week's figures, each with its change on last week in percent — what a KPI task writes. */
export const studioKpis = e3.input("studio_kpis", ArrayType(StructType({
    label: StringType, value: FloatType, unit: KpiUnit, change: FloatType,
})), variant("value", [
    { label: "Revenue", value: 1284000.0, unit: variant("money", null), change: 6.4 },
    { label: "Orders", value: 8412.0, unit: variant("count", null), change: 2.1 },
    { label: "Avg ticket", value: 152.0, unit: variant("price", null), change: -1.3 },
    { label: "Fill rate", value: 0.94, unit: variant("ratio", null), change: 0.0 },
]));

/** Revenue by day. */
export const studioRevenueDaily = e3.input("studio_revenue_daily", ArrayType(StructType({ day: DateTimeType, revenue: FloatType })), variant("value", [
    { day: new Date("2026-02-12T00:00:00Z"), revenue: 2640000.0 },
    { day: new Date("2026-02-19T00:00:00Z"), revenue: 2710000.0 },
    { day: new Date("2026-02-26T00:00:00Z"), revenue: 2900000.0 },
    { day: new Date("2026-03-05T00:00:00Z"), revenue: 3180000.0 },
    { day: new Date("2026-03-12T00:00:00Z"), revenue: 3300000.0 },
    { day: new Date("2026-03-19T00:00:00Z"), revenue: 3430000.0 },
]));

/** This week's sales, one row per region per channel. */
export const studioSales = e3.input("studio_sales", ArrayType(StructType({ region: StringType, channel: StringType, revenue: FloatType })), variant("value", [
    { region: "North", channel: "Store", revenue: 331200.0 },
    { region: "North", channel: "Online", revenue: 208080.0 },
    { region: "South", channel: "Store", revenue: 238824.0 },
    { region: "South", channel: "Online", revenue: 159216.0 },
    { region: "West", channel: "Store", revenue: 197604.0 },
    { region: "West", channel: "Online", revenue: 149076.0 },
]));

/** Orders by week. */
export const studioOrdersWeekly = e3.input("studio_orders_weekly", ArrayType(StructType({ week: StringType, orders: FloatType })), variant("value", [
    { week: "W9", orders: 96.0 }, { week: "W10", orders: 158.0 }, { week: "W11", orders: 214.0 },
    { week: "W12", orders: 271.0 }, { week: "W13", orders: 248.0 }, { week: "W14", orders: 196.0 },
]));

/** Visits by day, the last two weeks. */
export const studioVisitsDaily = e3.input("studio_visits_daily", ArrayType(StructType({ day: DateTimeType, visits: FloatType })), variant("value", [
    { day: new Date("2026-03-06T00:00:00Z"), visits: 412.0 }, { day: new Date("2026-03-07T00:00:00Z"), visits: 388.0 },
    { day: new Date("2026-03-08T00:00:00Z"), visits: 301.0 }, { day: new Date("2026-03-09T00:00:00Z"), visits: 296.0 },
    { day: new Date("2026-03-10T00:00:00Z"), visits: 455.0 }, { day: new Date("2026-03-11T00:00:00Z"), visits: 471.0 },
    { day: new Date("2026-03-12T00:00:00Z"), visits: 468.0 }, { day: new Date("2026-03-13T00:00:00Z"), visits: 502.0 },
    { day: new Date("2026-03-14T00:00:00Z"), visits: 479.0 }, { day: new Date("2026-03-15T00:00:00Z"), visits: 344.0 },
    { day: new Date("2026-03-16T00:00:00Z"), visits: 327.0 }, { day: new Date("2026-03-17T00:00:00Z"), visits: 518.0 },
    { day: new Date("2026-03-18T00:00:00Z"), visits: 546.0 }, { day: new Date("2026-03-19T00:00:00Z"), visits: 561.0 },
]));

/** The floor's areas, its shifts and its people. */
export const studioAreas = e3.input("studio_areas", ArrayType(StructType({ id: StringType, name: StringType })), variant("value", [
    { id: "north", name: "North" }, { id: "south", name: "South" },
]));
export const studioShifts = e3.input("studio_shifts", ArrayType(StructType({ id: StringType, name: StringType, window: StringType })), variant("value", [
    { id: "am", name: "AM", window: "06–14" }, { id: "pm", name: "PM", window: "14–22" }, { id: "night", name: "Night", window: "22–06" },
]));
export const studioPeople = e3.input("studio_people", ArrayType(StructType({ id: StringType, name: StringType })), variant("value", [
    { id: "p1", name: "Ana Ruiz" }, { id: "p2", name: "Ben Cole" }, { id: "p3", name: "Cai Lin" }, { id: "p4", name: "Dev Rao" },
    { id: "p5", name: "Eli Moss" }, { id: "p6", name: "Fay Ong" }, { id: "p7", name: "Gus Hart" }, { id: "p8", name: "Hana Ito" },
]));

/** Who works where today. */
export const studioAssignmentsToday = e3.input("studio_assignments_today", ArrayType(StructType({
    id: StringType, person: StringType, area: StringType, shift: StringType,
})), variant("value", [
    { id: "a1", person: "p1", area: "north", shift: "am" }, { id: "a2", person: "p2", area: "north", shift: "am" },
    { id: "a3", person: "p3", area: "north", shift: "pm" }, { id: "a4", person: "p4", area: "north", shift: "night" },
    { id: "a5", person: "p5", area: "south", shift: "am" }, { id: "a6", person: "p6", area: "south", shift: "pm" },
    { id: "a7", person: "p7", area: "south", shift: "pm" }, { id: "a8", person: "p8", area: "south", shift: "night" },
]));

/** This week's rota. */
export const studioRotaWeek = e3.input("studio_rota_week", ArrayType(StructType({
    id: StringType, person: StringType, day: StringType, hours: IntegerType,
})), variant("value", [
    { id: "r1", person: "p1", day: "Mon", hours: 8n }, { id: "r2", person: "p1", day: "Tue", hours: 8n }, { id: "r3", person: "p1", day: "Wed", hours: 8n },
    { id: "r4", person: "p2", day: "Mon", hours: 8n }, { id: "r5", person: "p2", day: "Thu", hours: 8n }, { id: "r6", person: "p2", day: "Fri", hours: 6n },
    { id: "r7", person: "p3", day: "Tue", hours: 8n }, { id: "r8", person: "p3", day: "Wed", hours: 8n }, { id: "r9", person: "p3", day: "Thu", hours: 8n },
    { id: "r10", person: "p4", day: "Mon", hours: 10n }, { id: "r11", person: "p4", day: "Fri", hours: 10n },
]));

// ============================================================================
// The components — what the surfaces offer, each a self-contained East UI function
// ============================================================================

/** The KPI rail's code: the week's four figures, each with its change on last week. */
const kpiRailUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const kpis = $.let(Data.bind(studioKpis).read());
        return (
            <Box background="border.subtle"><Grid gap="1px" templateColumns="repeat(auto-fit, minmax(min(calc(50% - 1px), 170px), 1fr))" items={kpis.map(($2, k) => Grid.Item(
                    <Box background="bg.surface"
                        padding={{ top: some("3"), right: some("4"), bottom: some("3"), left: some("4") }}>
                        <Stat label={k.label} value={k.value}
                            format={k.unit.match({
                                money: (_$3) => Format.Currency({ currency: "USD", compact: "short", maximumFractionDigits: 2n }),
                                count: (_$3) => Format.Number(),
                                price: (_$3) => Format.Currency({ currency: "USD", maximumFractionDigits: 0n }),
                                ratio: (_$3) => Format.Percent({ maximumFractionDigits: 0n }),
                            })}
                            baseline={
                                <MetricChip tone={k.change.greater(0.0).ifElse(
                                    _$3 => variant("positive", null),
                                    _$3 => k.change.less(0.0).ifElse(_$4 => variant("negative", null), _$4 => variant("neutral", null)),
                                )}>
                                    <Text>{k.change.greater(0.0).ifElse(
                                        _$3 => East.str`▲ ${East.print(k.change)}%`,
                                        _$3 => k.change.less(0.0).ifElse(
                                            _$4 => East.str`▼ ${East.print(k.change.negate())}%`,
                                            _$4 => "— flat",
                                        ),
                                    )}</Text>
                                </MetricChip>
                            } />
                    </Box>,
            ))} /></Box>
        );
    }}</Reactive>
));

/** The Revenue trend's code: revenue by day, as an area. */
const revenueTrendUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const days = $.let(Data.bind(studioRevenueDaily).read());
        return (
            <Box height="168px" padding={{ top: some("4"), right: some("4"), bottom: some("3"), left: some("3") }}>
                <Chart height="fill" grid
                    layers={Chart.Area(days, { x: r => r.day, y: r => r.revenue }, { color: "brand.solid", fillOpacity: 0.08, curve: "linear" })}
                    x={{ format: Chart.format.date("MMM D") }}
                    y={{ format: Chart.format.compact() }} />
            </Box>
        );
    }}</Reactive>
));

/** The Breakdown bars' code: each region's share of this week's revenue, largest first. */
const breakdownBarsUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const sales = $.let(Data.bind(studioSales).read());
        const total = $.let(sales.map(($2, r) => r.revenue).sum());
        const regions = $.let(sales
            .groupSum(($2, r) => r.region, ($2, r) => r.revenue)
            .toArray(($2, revenue, region) => ({ region, revenue })));
        return (
            <Box padding="4">
                <BarStrip data={regions} sort="desc" showValues={false}
                    item={r => ({
                        label: <Text>{r.region}</Text>,
                        value: r.revenue,
                        trailing: <Text>{East.str`${East.print(East.Float.roundHalf(r.revenue.divide(total).multiply(100.0)))}%`}</Text>,
                    })} />
            </Box>
        );
    }}</Reactive>
));

/** The Orders by week's code: orders placed each week. */
const ordersByWeekUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const weeks = $.let(Data.bind(studioOrdersWeekly).read());
        return (
            <Box height="168px" padding={{ top: some("4"), right: some("4"), bottom: some("3"), left: some("3") }}>
                <Chart height="fill" grid layers={Chart.Column(weeks, { x: r => r.week, y: r => r.orders }, { color: "brand.solid" })} />
            </Box>
        );
    }}</Reactive>
));

/** The Visits sparkline's code: visits by day. */
const visitsSparklineUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const visits = $.let(Data.bind(studioVisitsDaily).read());
        return (
            <Box padding="4">
                <Sparkline data={visits.map(($2, r) => r.visits)} type="area" width="100%" height="48px" />
            </Box>
        );
    }}</Reactive>
));

/** Today's assignments as a read-only table using the shared collection. */
const assignmentBoardUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const areas = $.let(Data.bind(studioAreas).read().toDict((_$2, area) => area.id, (_$2, area) => area.name));
        const shifts = $.let(Data.bind(studioShifts).read().toDict((_$2, shift) => shift.id, (_$2, shift) => shift.name));
        const people = $.let(Data.bind(studioPeople).read().toDict((_$2, person) => person.id, (_$2, person) => person.name));
        const today = $.let(Data.bind(studioAssignmentsToday).read());
        return <Table data={today.map((_$2, row) => ({ person: people.get(row.person), area: areas.get(row.area), shift: shifts.get(row.shift) }))} columns={["person", "area", "shift"]} />;
    }}</Reactive>
));

/** The week's shifts as a read-only table; editable rostering belongs to e3-ui. */
const shiftRosterUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const people = $.let(Data.bind(studioPeople).read().toDict((_$2, person) => person.id, (_$2, person) => person.name));
        const rota = $.let(Data.bind(studioRotaWeek).read());
        return <Table data={rota.map((_$2, row) => ({ person: people.get(row.person), day: row.day, hours: row.hours }))} columns={["person", "day", "hours"]} />;
    }}</Reactive>
));

export const kpiRail = Studio.component("kpi_rail", {
    name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none",
    description: "Revenue, orders, average ticket and fill rate this week, each with its change on last week.",
    tags: ["kpi", "sales"],
}, kpiRailUi);

export const breakdownBars = Studio.component("breakdown_bars", {
    name: "Breakdown bars", category: "Display", icon: "chart-bar", span: 4n,
    description: "Each region's share of this week's revenue, largest first.",
    tags: ["sales"],
}, breakdownBarsUi);

export const revenueTrend = Studio.component("revenue_trend", {
    name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n,
    description: "Revenue by day, as an area.",
    tags: ["sales"],
}, revenueTrendUi);

export const ordersByWeek = Studio.component("orders_by_week", {
    name: "Orders by week", category: "Charts", icon: "chart-column", span: 6n,
    description: "Orders placed each week.",
    tags: ["orders"],
}, ordersByWeekUi);

export const visitsSparkline = Studio.component("visits_sparkline", {
    name: "Visits sparkline", category: "Charts", icon: "chart-line", span: 4n,
    description: "Visits by day, the last two weeks.",
    tags: ["traffic"],
}, visitsSparklineUi);

export const assignmentBoard = Studio.component("assignment_board", {
    name: "Assignment board", category: "Collections", icon: "border-all", span: 12n,
    description: "Today: who works where, by shift.",
    collections: ["People"],
}, assignmentBoardUi);

export const shiftRoster = Studio.component("shift_roster", {
    name: "Shift roster", category: "Collections", icon: "calendar-week", span: 12n,
    description: "This week: people, days and their assigned hours.",
    collections: ["People"],
}, shiftRosterUi);

// ============================================================================
// The pages — the one record the operators build
// ============================================================================

/**
 * The pages record: the Ops console's pages — the Overview live as v3, its
 * draft resizing the trend and adding the bars beside it — and its templates,
 * and the other projects' pages.
 */
export const studioPages = e3.record("studio_pages", Studio.Types.Pages, {
    initial: new SortedMap<Key, Entry>([
        [{ project: "Ops console", page: "Account detail" }, variant("page", {
            draft: {
                title: "Account detail",
                cells: [
                    { key: "a-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "a-orders", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "orders_by_week") },
                    { key: "a-bars", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: variant("component", "breakdown_bars") },
                    { key: "a-trend", row: "r3", span: 12n, height: some(200n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                ],
            },
            live: none,
        })],
        [{ project: "Ops console", page: "Overview" }, variant("page", {
            draft: {
                title: "Overview",
                cells: [
                    { key: "o-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "o-trend", row: "r2", span: 8n, height: none, align: variant("stretch", null), title: none, content: variant("component", "revenue_trend") },
                    { key: "o-bars", row: "r2", span: 4n, height: none, align: variant("stretch", null), title: none, content: variant("component", "breakdown_bars") },
                    { key: "o-board", row: "r3", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "assignment_board") },
                ],
            },
            live: some({
                version: 3n,
                page: {
                    title: "Overview",
                    cells: [
                        { key: "o-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                        { key: "o-trend", row: "r2", span: 12n, height: none, align: variant("stretch", null), title: none, content: variant("component", "revenue_trend") },
                        { key: "o-board", row: "r3", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "assignment_board") },
                    ],
                },
            }),
        })],
        [{ project: "Ops console", page: "Regional rollup" }, variant("page", {
            draft: {
                title: "Regional rollup",
                cells: [
                    { key: "r-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                    { key: "r-bars", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: some("By region"), content: variant("component", "breakdown_bars") },
                    { key: "r-visits", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, content: variant("component", "visits_sparkline") },
                ],
            },
            live: some({
                version: 1n,
                page: {
                    title: "Regional rollup",
                    cells: [
                        { key: "r-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                        { key: "r-bars", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: some("By region"), content: variant("component", "breakdown_bars") },
                        { key: "r-visits", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, content: variant("component", "visits_sparkline") },
                    ],
                },
            }),
        })],
        [{ project: "Ops console", page: "Weekly export" }, variant("page", {
            draft: {
                title: "Weekly export",
                cells: [
                    { key: "w-orders", row: "r1", span: 12n, height: some(320n), align: variant("top", null), title: none, content: variant("component", "orders_by_week") },
                    { key: "w-roster", row: "r2", span: 12n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "shift_roster") },
                ],
            },
            live: some({ version: 2n, page: { title: "Weekly export", cells: [] } }),
        })],
        [{ project: "Ops console", page: "Ops board" }, variant("template", {
            title: "Ops board",
            cells: [
                { key: "t-orders", row: "r1", span: 8n, height: some(320n), align: variant("top", null), title: none, content: variant("component", "orders_by_week") },
                { key: "t-bars", row: "r1", span: 4n, height: some(320n), align: variant("stretch", null), title: none, content: variant("component", "breakdown_bars") },
            ],
        })],
        [{ project: "Ops console", page: "Report brief" }, variant("template", {
            title: "Report brief",
            cells: [
                { key: "t-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                { key: "t-orders", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, content: variant("component", "orders_by_week") },
                { key: "t-visits", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, content: variant("component", "visits_sparkline") },
            ],
        })],
        [{ project: "Ops console", page: "Summary" }, variant("template", {
            title: "Summary",
            cells: [
                { key: "t-kpi", row: "r1", span: 12n, height: some(96n), align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "t-trend", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                { key: "t-bars", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: variant("component", "breakdown_bars") },
            ],
        })],
        [{ project: "Finance portal", page: "Ledger" }, variant("page", {
            draft: {
                title: "Ledger",
                cells: [
                    { key: "l-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                ],
            },
            live: none,
        })],
        [{ project: "HR roster", page: "Rota" }, variant("page", {
            draft: {
                title: "Rota",
                cells: [
                    { key: "h-roster", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "shift_roster") },
                ],
            },
            live: some({
                version: 1n,
                page: {
                    title: "Rota",
                    cells: [
                        { key: "h-roster", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "shift_roster") },
                    ],
                },
            }),
        })],
    ], compareFor(Studio.Types.Key)),
    mutations: (mutation) => ({
        // The record's one write.
        patch: mutation.patch(),
    }),
});


// ============================================================================
// The surfaces
// ============================================================================

export const studioBuilder = example({
    keywords: [
        "Studio", "Studio.Builder", "builder", "canvas", "palette", "inspector", "publish preview", "Preview", "Publish",
        "SnapGrid", "toolbar", "history", "Undo", "Save", "Save as template", "Record.bind", "patch", "e3.record",
        "mutation.patch", "Studio.component", "components", "pages", "Desktop", "Tablet", "env", "audience", "rollout",
    ],
    description: "The builder over the pages record: the Ops console's Overview on the canvas under one toolbar — its status, the zoom, the history item, Desktop · Tablet, Save as template, Preview and Publish — the palette of the seven components before it and the inspector after it; Preview and Publish open the publish preview in the canvas's place, its two changes since v3, and Exit returns; the page it shows is the surface's own state, given as `page` and changed in `onOpen` when the palette's Pages tab asks for another",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            const pages = $.let(Record.bind(studioPages));
            // The open page is the surface's — the project's first to begin with: the builder shows it, and the page library below opens another.
            const open = $.let(State.bind([Studio.Types.Key], "ex.studio.open", { project: "Ops console", page: "Account detail" }));
            const go = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(open.write(key)); }));
            return (
                <Box height="760px">
                    <Studio.Builder pages={pages} components={components} project="Ops console" id="studio"
                        page={open.read()} onOpen={go}
                        env="Staging" audience="Field ops · 24 users" rollout="Immediate" />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const studioBuilderMobile = example({
    keywords: ["Studio", "Studio.Builder", "builder", "mobile", "phone", "pane strip", "drawer", "palette", "inspector", "second row", "history"],
    description: "The same builder over the pages record in a phone's 390-wide frame: the toolbar over its second row — the history at 44px — the canvas the frame's whole width, and the palette and the inspector a strip of drawers along the bottom edge; given no `page`, it holds its own open page, the project's first to begin with",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            const pages = $.let(Record.bind(studioPages));
            return (
                <Box width="390px" maxWidth="100%" height="760px">
                    <Studio.Builder pages={pages} components={components} project="Ops console" id="studioMobile"
                        env="Staging" audience="Field ops · 24 users" rollout="Immediate" />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

/** A page's tiles each a column narrower, one three columns wide or less as it was: what someone else's save changes. */
const tilesNarrower = East.function([Studio.Types.Page], Studio.Types.Page, (_$, page) => ({
    title: page.title,
    cells: page.cells.map((_$2, cell) => ({
        key: cell.key, row: cell.row,
        span: cell.span.greater(3n).ifElse(() => cell.span.subtract(1n), () => cell.span),
        height: cell.height, align: cell.align, title: cell.title, content: cell.content,
    })),
}));

/** The pages the conflicts example edits, as the builder's start, in a record of their own so no other example's edits meet them. */
export const studioConflictPages = e3.record("studio_conflict_pages", Studio.Types.Pages, {
    initial: studioPages.default!,
    mutations: (mutation) => ({
        // The record's one write.
        patch: mutation.patch(),
        // Someone else's save: every page's tiles a column narrower in its draft, its templates as they were.
        elsewhere: mutation.reduce(East.function([Studio.Types.Pages], Studio.Types.Pages, ($, pages) => {
            const narrower = $.const(tilesNarrower);
            return pages.map((_$2, entry) => entry.match({
                page: (_$3, held) => East.value(variant("page", { draft: narrower(held.draft), live: held.live }), Studio.Types.Entry),
                template: (_$3, page) => East.value(variant("template", page), Studio.Types.Entry),
            }));
        })),
    }),
});

/**
 * Your edits meeting someone else's save, in one window: edit, then press
 * Someone else saves, which saves another person's change to the same pages —
 * every tile a column narrower. A tile you made wider or narrower too is a
 * conflict, waiting for you to choose; a tile you moved, aligned or made
 * taller combines with theirs. Each press saves their change again.
 */
export const studioConflicts = example({
    keywords: ["Studio", "Studio.Builder", "conflict", "conflicts", "combine", "someone else", "Choose", "tile", "span", "Record.bind", "mutate", "Button", "Save"],
    description: "Your edits meeting someone else's save, in one window — make a tile wider or narrower, then press Someone else saves, which saves another person's change to the same pages (every tile a column narrower), so yours conflict and wait to be chosen; a tile you move, align or make taller combines with theirs",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            const pages = $.let(Record.bind(studioConflictPages, ["patch"]));
            const others = $.let(Record.bind(studioConflictPages, ["elsewhere"]));
            const theirs = $.const(East.function([], NullType, ($) => { $(others.mutate.elsewhere()); }));
            return (
                <VStack gap="3" align="stretch">
                    <HStack gap="3">
                        <Button variant="outline" onClick={theirs} loading={others.mutate.pending()}>Someone else saves</Button>
                        <Text color="fg.muted">Their change: every tile a column narrower</Text>
                    </HStack>
                    <Box height="760px">
                        <Studio.Builder pages={pages} components={components} project="Ops console" id="conflicts"
                            env="Staging" audience="Field ops · 24 users" rollout="Immediate" />
                    </Box>
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const studioLibrary = example({
    keywords: [
        "Studio", "Studio.Library", "page library", "pages", "templates", "Blank grid", "new page", "project", "Library",
        "gallery", "wireframe", "search", "sort", "grid", "list", "Open in builder", "status", "Live", "Draft",
        "Record.bind", "patch", "e3.record", "onOpen", "page", "State.bind", "navigate",
    ],
    description: "The page library over the same record: one toolbar — the search over templates and pages, Sort · Name, Grid · List and \"+ New page in Ops console\" — beside the projects and the project's pages with their status; the Templates row starts with Blank grid, each card a wireframe of its layout; the Pages row shows each page's wireframe, status and component count with \"Open in builder →\", which tells the surface in `onOpen`: the surface writes the open page it holds, which the builder above shows and the pane marks; a new page takes a name and a template and is one patch commit",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            const pages = $.let(Record.bind(studioPages));
            // The open page is the surface's: the builder above shows it. A host with routes navigates here instead.
            const open = $.let(State.bind([Studio.Types.Key], "ex.studio.open", { project: "Ops console", page: "Account detail" }));
            const go = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(open.write(key)); }));
            return (
                <Box height="764px">
                    <Studio.Library pages={pages} components={components} project="Ops console" page={open.read()} onOpen={go} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Content — a text block, and visuals over a source the surface lists (#1669)
// ============================================================================

/** This week's revenue by region, as columns split by channel. */
const revenueByRegion = Studio.visual.of("sales", Studio.visual.column({
    x: Studio.visual.group("region"),
    values: [Studio.visual.sum("revenue", { label: "Revenue" })],
    split: "channel",
    stack: "stacked",
}));

/** The regions by revenue, largest first, each with a bar. */
const topRegions = Studio.visual.of("sales", Studio.visual.list({
    item: Studio.visual.group("region", { sort: "high", top: 5n }),
    values: [Studio.visual.sum("revenue")],
    bar: true,
}));

/**
 * The pages of a project whose placements hold content: a text block, two
 * visuals over the sales and a developer's component. Its one migration step
 * carries a workspace whose pages were stored before a placement held content
 * — each component key becomes `component(key)` — and a workspace deployed
 * fresh counts it applied.
 */
export const studioContentPages = e3.record("studio_content_pages", Studio.Types.Pages, {
    initial: new SortedMap<Key, Entry>([
        [{ project: "Sales desk", page: "This week" }, variant("page", {
            draft: {
                title: "This week",
                cells: [
                    { key: "s-note", row: "r1", span: 12n, height: none, align: variant("top", null), title: none,
                        content: Studio.visual.text("Figures are to last night's close.\n\nRevenue is in US dollars, before returns.", "About these numbers") },
                    { key: "s-revenue", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: some("Revenue by region"), content: revenueByRegion },
                    { key: "s-top", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, content: topRegions },
                    { key: "s-kpi", row: "r3", span: 12n, height: none, align: variant("top", null), title: none, content: Studio.visual.component("kpi_rail") },
                ],
            },
            live: none,
        })],
    ], compareFor(Studio.Types.Key)),
    mutations: (mutation) => ({
        // The record's one write.
        patch: mutation.patch(),
    }),
    // Pages stored before a placement held content are carried by this one step.
    migrations: (migration) => [migration.rows("cell_content", Studio.migrations.cellContent)],
});

export const studioContent = example({
    keywords: [
        "Studio", "Studio.source", "sources", "source", "fields", "Studio.visual", "visual", "KPI", "chart", "column", "list", "table", "slicer",
        "text block", "text", "content", "Studio.Types.Content", "Studio.migrations", "cellContent", "migration.rows", "migrations",
        "Data.bind", "Studio.Builder", "e3.record",
    ],
    description: "A page whose placements hold content: a text block, visuals over a source the surface lists — revenue by region as stacked columns, the top regions as a list — and a developer's component. The surface lists its sources with Studio.source — a bound handle, a name, an icon and its fields' labels and formats — the page's seeds are built with Studio.visual, and its pages record declares Studio.migrations.cellContent, the one step that carries pages stored before a placement held content",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail]);
            const pages = $.let(Record.bind(studioContentPages));
            const sales = $.let(Data.bind(studioSales));
            return (
                <Box height="760px">
                    <Studio.Builder pages={pages} components={components} project="Sales desk" id="studioContent"
                        sources={{
                            sales: Studio.source(sales, {
                                name: "Sales", icon: "receipt", description: "One row per region per channel",
                                fields: {
                                    region: { label: "Region" },
                                    channel: { label: "Channel" },
                                    revenue: { label: "Revenue", format: { currency: { code: "USD" } } },
                                },
                                search: ["region", "channel"], split: ["channel"],
                            }),
                        }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// Visuals — every form a visual draws, from its answer (#1671)
// ============================================================================

/** The quarter's orders: each one's date, region, category, customer, revenue, units and margin — one with no margin recorded. */
export const studioOrders = e3.input("studio_orders", ArrayType(StructType({
    ordered_at: DateTimeType, region: StringType, category: StringType, customer: StringType, revenue: FloatType, units: IntegerType, margin: OptionType(FloatType),
})), variant("value", [
    { ordered_at: new Date("2026-07-02T00:00:00Z"), region: "SA", category: "Tools", customer: "Northwind", revenue: 1840.0, units: 156n, margin: some(0.21) },
    { ordered_at: new Date("2026-07-05T00:00:00Z"), region: "NSW", category: "Electrical", customer: "Harbour", revenue: 987.5, units: 89n, margin: none },
    { ordered_at: new Date("2026-07-09T00:00:00Z"), region: "VIC", category: "Tools", customer: "Summit", revenue: 1230.0, units: 102n, margin: some(0.24) },
    { ordered_at: new Date("2026-07-14T00:00:00Z"), region: "SA", category: "Electrical", customer: "Acme", revenue: 614.0, units: 58n, margin: some(0.12) },
    { ordered_at: new Date("2026-07-21T00:00:00Z"), region: "WA", category: "Garden", customer: "Coastline", revenue: 2196.0, units: 201n, margin: some(0.27) },
    { ordered_at: new Date("2026-07-28T00:00:00Z"), region: "QLD", category: "Tools", customer: "Northwind", revenue: 438.0, units: 36n, margin: some(0.15) },
    { ordered_at: new Date("2026-08-03T00:00:00Z"), region: "NSW", category: "Tools", customer: "Harbour", revenue: 1520.0, units: 131n, margin: some(0.22) },
    { ordered_at: new Date("2026-08-08T00:00:00Z"), region: "SA", category: "Garden", customer: "Summit", revenue: 742.0, units: 70n, margin: some(0.19) },
    { ordered_at: new Date("2026-08-12T00:00:00Z"), region: "VIC", category: "Electrical", customer: "Acme", revenue: 1105.0, units: 97n, margin: some(0.16) },
    { ordered_at: new Date("2026-08-19T00:00:00Z"), region: "WA", category: "Tools", customer: "Coastline", revenue: 1688.0, units: 140n, margin: some(0.25) },
    { ordered_at: new Date("2026-08-26T00:00:00Z"), region: "SA", category: "Tools", customer: "Northwind", revenue: 2010.0, units: 172n, margin: some(0.23) },
    { ordered_at: new Date("2026-09-01T00:00:00Z"), region: "QLD", category: "Garden", customer: "Harbour", revenue: 529.0, units: 48n, margin: some(0.11) },
    { ordered_at: new Date("2026-09-07T00:00:00Z"), region: "NSW", category: "Electrical", customer: "Summit", revenue: 1394.0, units: 118n, margin: some(0.2) },
    { ordered_at: new Date("2026-09-15T00:00:00Z"), region: "VIC", category: "Garden", customer: "Coastline", revenue: 866.0, units: 79n, margin: some(0.17) },
    { ordered_at: new Date("2026-09-22T00:00:00Z"), region: "SA", category: "Electrical", customer: "Acme", revenue: 1278.0, units: 109n, margin: some(0.18) },
    { ordered_at: new Date("2026-09-29T00:00:00Z"), region: "WA", category: "Tools", customer: "Northwind", revenue: 1960.0, units: 168n, margin: some(0.26) },
]));

const vis = Studio.visual;

/** A placement of a visual: in a row, so many columns wide, so tall unless its content sizes it. */
function visualCell(key: string, row: string, span: bigint, height: bigint | undefined, content: ReturnType<typeof vis.of>) {
    return { key, row, span, height: height === undefined ? none : some(height), align: variant("stretch", null), title: none, content };
}

/** The Visuals page's placements: two KPIs and a donut; the series charts, the combo and the scatter; the list; the summary and the pivot; the records; and two that cannot draw yet — a chart with no value, and a KPI of a field its source lacks. */
const visualCells = [
    visualCell("v-revenue", "r1", 4n, undefined, vis.of("orders", vis.kpi({ value: vis.sum("revenue", { goal: 24000 }), compare: vis.mean("revenue"), trend: "ordered_at" }))),
    visualCell("v-orders", "r1", 4n, undefined, vis.of("orders", vis.kpi({ value: vis.count(), trend: "ordered_at" }))),
    visualCell("v-share", "r1", 4n, 240n, vis.of("orders", vis.pie({ slice: vis.group("category"), value: vis.sum("revenue"), donut: true }))),
    visualCell("v-months", "r2", 6n, 240n, vis.of("orders", vis.column({ x: vis.group("ordered_at", { bucket: "month" }), values: [vis.sum("revenue")], split: "region", stack: "stacked" }))),
    visualCell("v-customers", "r2", 6n, 240n, vis.of("orders", vis.bar({ x: vis.group("customer", { sort: "high", top: 4n }), values: [vis.sum("revenue")] }))),
    visualCell("v-units", "r3", 4n, 220n, vis.of("orders", vis.line({ x: vis.group("ordered_at", { bucket: "week" }), values: [vis.sum("units")] }))),
    visualCell("v-trend", "r3", 4n, 220n, vis.of("orders", vis.area({ x: vis.group("ordered_at", { bucket: "month" }), values: [vis.sum("revenue", { goal: 8000 })] }))),
    visualCell("v-scatter", "r3", 4n, 220n, vis.of("orders", vis.scatter({ point: "customer", x: vis.sum("units"), y: vis.sum("revenue"), split: "region" }))),
    visualCell("v-combo", "r4", 6n, 240n, vis.of("orders", vis.combo({
        x: vis.group("region"), columns: [vis.left(vis.sum("revenue"))], lines: [vis.right(vis.mean("margin"))],
    }))),
    visualCell("v-list", "r4", 6n, 240n, vis.of("orders", vis.list({ item: vis.group("customer", { sort: "high" }), caption: "region", values: [vis.sum("revenue"), vis.count()], bar: true }))),
    visualCell("v-summary", "r5", 6n, 300n, vis.of("orders", vis.summary({
        rows: [vis.group("region", { sort: "high" }), vis.group("category")],
        values: [vis.sum("revenue"), vis.ratio("revenue", "units", { goal: 11.5 })], total: true,
    }))),
    visualCell("v-pivot", "r5", 6n, 300n, vis.of("orders", vis.pivot({
        rows: vis.group("region"), columns: vis.group("ordered_at", { bucket: "month" }), value: vis.count(), heat: true,
    }))),
    visualCell("v-records", "r6", 12n, 320n, vis.of("orders", vis.records({ columns: ["ordered_at", "customer", "region", "revenue", "units", "margin"], sort: "ordered_at", descending: true }))),
    visualCell("v-empty", "r7", 6n, undefined, vis.of("orders", vis.column({ x: vis.group("region"), values: [] }))),
    visualCell("v-missing", "r7", 6n, undefined, vis.of("orders", vis.kpi({ value: vis.sum("net_revenue") }))),
];

/** The pages of the visuals' project: one page, Visuals, live as it was drafted. */
export const studioVisualPages = e3.record("studio_visual_pages", Studio.Types.Pages, {
    initial: new SortedMap<Key, Entry>([
        [{ project: "Sales desk", page: "Visuals" }, variant("page", {
            draft: { title: "Visuals", cells: visualCells },
            live: some({ version: 1n, page: { title: "Visuals", cells: visualCells } }),
        })],
    ], compareFor(Studio.Types.Key)),
    mutations: (mutation) => ({
        // The record's one write.
        patch: mutation.patch(),
    }),
});

export const studioVisuals = example({
    keywords: [
        "Studio", "Studio.Page", "Studio.visual", "visual", "KPI", "goal", "trend", "chart", "column", "bar", "line", "area", "combo", "scatter",
        "pie", "donut", "list", "ranking bar", "table", "records", "summary", "total", "pivot", "heat", "Studio.source", "Data.bind",
    ],
    description: "Every form a visual draws, on a published page over the quarter's orders: a KPI with its goal, its change and its trend, and a count; a donut of revenue by category; columns stacked by region, the top customers' bars, a line, an area and a scatter; a combo of revenue against margin on its right axis; the customers as a list with ranking bars; a summary of regions over categories with its total row and a goal its cells are marked against; a pivot of orders by region and month on the heat ramp; the latest orders, a page at a time; and two tiles that say why they cannot draw — a chart with no value yet, and a KPI of a field its source lacks",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pages = $.let(Data.bind(studioVisualPages));
            const orders = $.let(Data.bind(studioOrders));
            return (
                <Studio.Page pages={pages.read()} components={[]} page={{ project: "Sales desk", page: "Visuals" }}
                    sources={{
                        orders: Studio.source(orders, {
                            name: "Orders", icon: "receipt", description: "One row per order",
                            fields: {
                                ordered_at: { label: "Ordered" },
                                region: { label: "Region" },
                                category: { label: "Category" },
                                customer: { label: "Customer" },
                                revenue: { label: "Revenue", format: { currency: { code: "AUD" } } },
                                units: { label: "Units" },
                                margin: { label: "Margin", format: "percent" },
                            },
                            range: "ordered_at", search: ["customer", "region"], split: ["region", "category"],
                        }),
                    }} />
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const studioOpsConsole = example({
    keywords: [
        "Studio", "Studio.Page", "published page", "live", "Data.bind", "e3.record", "components", "SnapGrid",
    ],
    description: "A published page, for everyone else: the Overview's live version, v3, each placement its component's own UI — the page reads the record and writes nothing",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            const pages = $.let(Data.bind(studioPages));
            return <Studio.Page pages={pages.read()} components={components} page={{ project: "Ops console", page: "Overview" }} />;
        }}</Reactive>
    )),
    inputs: [],
});
