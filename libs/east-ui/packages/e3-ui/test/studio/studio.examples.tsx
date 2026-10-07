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
 * library's projects, pages and templates.
 */

import {
    ArrayType, DateTimeType, East, FloatType, IntegerType, NullType, SortedMap, StringType, StructType, VariantType, compareFor,
    example, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import {
    BarStrip, Board, Box, Chart, Format, HStack, MetricChip, Reactive, Roster, Sparkline, Stat, Text, UIComponentType,
} from "@elaraai/east-ui";
import { Data, Record, Studio, fingerprintOf } from "@elaraai/e3-ui";
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
            <HStack gap="0" align="stretch">
                {kpis.map(($2, k, i) => (
                    <Box flex="1" borderColor="border.subtle"
                        borderWidth={i.equal(kpis.size().subtract(1n)).ifElse(_$3 => "0", _$3 => "0 1px 0 0")}
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
                    </Box>
                ))}
            </HStack>
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

/** The Assignment board's code: today, who works where, by shift. */
const assignmentBoardUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const areas = $.let(Data.bind(studioAreas).read());
        const shifts = $.let(Data.bind(studioShifts).read());
        const people = $.let(Data.bind(studioPeople).read());
        const today = $.let(Data.bind(studioAssignmentsToday).read());
        return (
            <Board id="studio-assignment-board" mode="published"
                areas={areas} area={a => ({ key: a.id, label: a.name })}
                shifts={shifts} shift={s => ({ key: s.id, label: s.name, sublabel: s.window })}
                people={people} person={p => ({ key: p.id, label: p.name })}
                assignments={today}
                assignment={x => ({ key: x.id, person: x.person, area: x.area, shift: x.shift, state: variant("committed", null) })} />
        );
    }}</Reactive>
));

/** The Shift roster's code: this week, people down the side, days across. */
const shiftRosterUi = East.function([], UIComponentType, (_$) => (
    <Reactive>{$ => {
        const people = $.let(Data.bind(studioPeople).read());
        const rota = $.let(Data.bind(studioRotaWeek).read());
        return (
            <Roster id="studio-shift-roster" mode="published" days={["Mon", "Tue", "Wed", "Thu", "Fri"]}
                people={people} person={p => ({ key: p.id, label: p.name })}
                shifts={rota}
                shift={s => ({ key: s.id, person: s.person, day: s.day, hours: s.hours, state: variant("committed", null) })} />
        );
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
    description: "This week: people down the side, days across.",
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
export const studioPages = e3.record("studio_pages", Studio.Types.Pages, new SortedMap<Key, Entry>([
    [{ project: "Ops console", page: "Account detail" }, variant("page", {
        draft: {
            title: "Account detail",
            cells: [
                { key: "a-kpi", row: "r1", span: 12n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: fingerprintOf(kpiRailUi) },
                { key: "a-orders", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: none, component: "orders_by_week", fingerprint: fingerprintOf(ordersByWeekUi) },
                { key: "a-bars", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, component: "breakdown_bars", fingerprint: fingerprintOf(breakdownBarsUi) },
                { key: "a-trend", row: "r3", span: 12n, height: some(200n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: fingerprintOf(revenueTrendUi) },
            ],
        },
        live: none,
    })],
    [{ project: "Ops console", page: "Overview" }, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "o-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: fingerprintOf(kpiRailUi) },
                { key: "o-trend", row: "r2", span: 8n, height: none, align: variant("stretch", null), title: none, component: "revenue_trend", fingerprint: fingerprintOf(revenueTrendUi) },
                { key: "o-bars", row: "r2", span: 4n, height: none, align: variant("stretch", null), title: none, component: "breakdown_bars", fingerprint: fingerprintOf(breakdownBarsUi) },
                { key: "o-board", row: "r3", span: 12n, height: none, align: variant("top", null), title: none, component: "assignment_board", fingerprint: fingerprintOf(assignmentBoardUi) },
            ],
        },
        live: some({
            version: 3n,
            page: {
                title: "Overview",
                cells: [
                    { key: "o-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: fingerprintOf(kpiRailUi) },
                    { key: "o-trend", row: "r2", span: 12n, height: none, align: variant("stretch", null), title: none, component: "revenue_trend", fingerprint: fingerprintOf(revenueTrendUi) },
                    { key: "o-board", row: "r3", span: 12n, height: none, align: variant("top", null), title: none, component: "assignment_board", fingerprint: fingerprintOf(assignmentBoardUi) },
                ],
            },
        }),
    })],
    [{ project: "Ops console", page: "Regional rollup" }, variant("page", {
        draft: {
            title: "Regional rollup",
            cells: [
                { key: "r-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: fingerprintOf(revenueTrendUi) },
                { key: "r-bars", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: some("By region"), component: "breakdown_bars", fingerprint: fingerprintOf(breakdownBarsUi) },
                { key: "r-visits", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, component: "visits_sparkline", fingerprint: fingerprintOf(visitsSparklineUi) },
            ],
        },
        live: some({
            version: 1n,
            page: {
                title: "Regional rollup",
                cells: [
                    { key: "r-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: fingerprintOf(revenueTrendUi) },
                    { key: "r-bars", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: some("By region"), component: "breakdown_bars", fingerprint: fingerprintOf(breakdownBarsUi) },
                    { key: "r-visits", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, component: "visits_sparkline", fingerprint: fingerprintOf(visitsSparklineUi) },
                ],
            },
        }),
    })],
    [{ project: "Ops console", page: "Weekly export" }, variant("page", {
        draft: {
            title: "Weekly export",
            cells: [
                { key: "w-orders", row: "r1", span: 12n, height: some(320n), align: variant("top", null), title: none, component: "orders_by_week", fingerprint: fingerprintOf(ordersByWeekUi) },
                { key: "w-roster", row: "r2", span: 12n, height: some(240n), align: variant("top", null), title: none, component: "shift_roster", fingerprint: fingerprintOf(shiftRosterUi) },
            ],
        },
        live: some({ version: 2n, page: { title: "Weekly export", cells: [] } }),
    })],
    [{ project: "Ops console", page: "Ops board" }, variant("template", {
        title: "Ops board",
        cells: [
            { key: "t-orders", row: "r1", span: 8n, height: some(320n), align: variant("top", null), title: none, component: "orders_by_week", fingerprint: fingerprintOf(ordersByWeekUi) },
            { key: "t-bars", row: "r1", span: 4n, height: some(320n), align: variant("stretch", null), title: none, component: "breakdown_bars", fingerprint: fingerprintOf(breakdownBarsUi) },
        ],
    })],
    [{ project: "Ops console", page: "Report brief" }, variant("template", {
        title: "Report brief",
        cells: [
            { key: "t-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: fingerprintOf(revenueTrendUi) },
            { key: "t-orders", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, component: "orders_by_week", fingerprint: fingerprintOf(ordersByWeekUi) },
            { key: "t-visits", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, component: "visits_sparkline", fingerprint: fingerprintOf(visitsSparklineUi) },
        ],
    })],
    [{ project: "Ops console", page: "Summary" }, variant("template", {
        title: "Summary",
        cells: [
            { key: "t-kpi", row: "r1", span: 12n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: fingerprintOf(kpiRailUi) },
            { key: "t-trend", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: fingerprintOf(revenueTrendUi) },
            { key: "t-bars", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, component: "breakdown_bars", fingerprint: fingerprintOf(breakdownBarsUi) },
        ],
    })],
    [{ project: "Finance portal", page: "Ledger" }, variant("page", {
        draft: {
            title: "Ledger",
            cells: [
                { key: "l-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: fingerprintOf(revenueTrendUi) },
            ],
        },
        live: none,
    })],
    [{ project: "HR roster", page: "Rota" }, variant("page", {
        draft: {
            title: "Rota",
            cells: [
                { key: "h-roster", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "shift_roster", fingerprint: fingerprintOf(shiftRosterUi) },
            ],
        },
        live: some({
            version: 1n,
            page: {
                title: "Rota",
                cells: [
                    { key: "h-roster", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "shift_roster", fingerprint: fingerprintOf(shiftRosterUi) },
                ],
            },
        }),
    })],
], compareFor(Studio.Types.Key)));

/** The record's one write. */
export const studioPagesPatch = e3.mutation.patch(studioPages);

// ============================================================================
// The surfaces
// ============================================================================

export const studioBuilder = example({
    keywords: [
        "Studio", "Studio.Builder", "builder", "canvas", "palette", "inspector", "publish preview", "Preview", "Publish",
        "SnapGrid", "toolbar", "history", "Undo", "Save", "Save as template", "Record.bind", "patch", "e3.record",
        "e3.mutation.patch", "Studio.component", "components", "pages", "Desktop", "Tablet", "env", "audience", "rollout",
    ],
    description: "The builder over the pages record: the Ops console's Overview on the canvas under one toolbar — its status, the zoom, the history item, Desktop · Tablet, Save as template, Preview and Publish — the palette of the seven components before it and the inspector after it; Preview and Publish open the publish preview in the canvas's place, its two changes since v3 and the logic banner, and Exit returns",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            const pages = $.let(Record.bind(studioPages, [studioPagesPatch]));
            return (
                <Box height="760px">
                    <Studio.Builder pages={pages} components={components} project="Ops console" id="studio"
                        env="Staging" audience="Field ops · 24 users" rollout="Immediate" />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const studioLibrary = example({
    keywords: [
        "Studio", "Studio.Library", "page library", "pages", "templates", "Blank grid", "new page", "project", "Library",
        "gallery", "wireframe", "search", "sort", "grid", "list", "Open in builder", "status", "Live", "Draft",
        "Record.bind", "patch", "e3.record",
    ],
    description: "The page library over the same record: one toolbar — the search over templates and pages, Sort · Name, Grid · List and \"+ New page in Ops console\" — beside the projects and the project's pages with their status; the Templates row starts with Blank grid, each card a wireframe of its layout; the Pages row shows each page's wireframe, status and component count with \"Open in builder →\", which opens the page in the builder above; a new page takes a name and a template and is one patch commit",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([kpiRail, breakdownBars, revenueTrend, ordersByWeek, visitsSparkline, assignmentBoard, shiftRoster]);
            const pages = $.let(Record.bind(studioPages, [studioPagesPatch]));
            return (
                <Box height="764px">
                    <Studio.Library pages={pages} components={components} project="Ops console" id="studio" />
                </Box>
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
