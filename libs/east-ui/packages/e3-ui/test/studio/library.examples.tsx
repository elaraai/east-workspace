/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * `<Studio.PageLibrary>` (#997) — a project's templates and pages over the
 * pages record, and where new pages start.
 */

import {
    ArrayType, DateTimeType, East, FloatType, SortedMap, StringType, StructType, compareFor, example, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { BarStrip, Box, Chart, Format, HStack, MetricChip, Reactive, Stat, Text, UIComponentType } from "@elaraai/east-ui";
import { Record, Studio } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

/** The pages record: three projects; in the Ops console two pages live and two drafts, and three templates. */
export const studioLibraryPages = e3.record("studio_library_pages", Studio.Types.Pages, new SortedMap<Key, Entry>([
    [{ project: "Ops console", page: "account-detail" }, variant("page", {
        draft: {
            title: "Account detail",
            cells: [
                { key: "a-kpi", row: "r1", span: 12n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                { key: "a-orders", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
                { key: "a-bars", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, component: "breakdown_bars", fingerprint: "" },
                { key: "a-trend", row: "r3", span: 12n, height: some(200n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            ],
        },
        live: none,
    })],
    [{ project: "Ops console", page: "overview" }, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "o-kpi", row: "r1", span: 12n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                { key: "o-trend", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                { key: "o-bars", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, component: "breakdown_bars", fingerprint: "" },
                { key: "o-orders", row: "r3", span: 6n, height: some(200n), align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
                { key: "o-weekly", row: "r3", span: 6n, height: some(200n), align: variant("top", null), title: some("Weekly orders"), component: "orders_by_week", fingerprint: "" },
                { key: "o-regions", row: "r4", span: 12n, height: some(120n), align: variant("top", null), title: some("Regions"), component: "breakdown_bars", fingerprint: "" },
            ],
        },
        live: some({
            version: 3n,
            page: {
                title: "Overview",
                cells: [
                    { key: "o-kpi", row: "r1", span: 12n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                    { key: "o-trend", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                    { key: "o-bars", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, component: "breakdown_bars", fingerprint: "" },
                    { key: "o-orders", row: "r3", span: 6n, height: some(200n), align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
                    { key: "o-weekly", row: "r3", span: 6n, height: some(200n), align: variant("top", null), title: some("Weekly orders"), component: "orders_by_week", fingerprint: "" },
                    { key: "o-regions", row: "r4", span: 12n, height: some(120n), align: variant("top", null), title: some("Regions"), component: "breakdown_bars", fingerprint: "" },
                ],
            },
        }),
    })],
    [{ project: "Ops console", page: "regional-rollup" }, variant("page", {
        draft: {
            title: "Regional rollup",
            cells: [
                { key: "r-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                { key: "r-north", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: some("North"), component: "breakdown_bars", fingerprint: "" },
                { key: "r-south", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: some("South"), component: "breakdown_bars", fingerprint: "" },
            ],
        },
        live: some({
            version: 1n,
            page: {
                title: "Regional rollup",
                cells: [
                    { key: "r-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                    { key: "r-north", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: some("North"), component: "breakdown_bars", fingerprint: "" },
                    { key: "r-south", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: some("South"), component: "breakdown_bars", fingerprint: "" },
                ],
            },
        }),
    })],
    [{ project: "Ops console", page: "weekly-export" }, variant("page", {
        draft: {
            title: "Weekly export",
            cells: [
                { key: "w-orders", row: "r1", span: 12n, height: some(320n), align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
            ],
        },
        live: some({ version: 2n, page: { title: "Weekly export", cells: [] } }),
    })],
    [{ project: "Ops console", page: "ops-board" }, variant("template", {
        title: "Ops board",
        cells: [
            { key: "t-orders", row: "r1", span: 8n, height: some(320n), align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
            { key: "t-bars", row: "r1", span: 4n, height: some(320n), align: variant("stretch", null), title: none, component: "breakdown_bars", fingerprint: "" },
        ],
    })],
    [{ project: "Ops console", page: "report-brief" }, variant("template", {
        title: "Report brief",
        cells: [
            { key: "t-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            { key: "t-orders-1", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
            { key: "t-orders-2", row: "r2", span: 6n, height: some(200n), align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
        ],
    })],
    [{ project: "Ops console", page: "summary" }, variant("template", {
        title: "Summary",
        cells: [
            { key: "t-kpi", row: "r1", span: 12n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
            { key: "t-trend", row: "r2", span: 8n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            { key: "t-bars", row: "r2", span: 4n, height: some(240n), align: variant("stretch", null), title: none, component: "breakdown_bars", fingerprint: "" },
        ],
    })],
    [{ project: "Finance portal", page: "ledger" }, variant("page", {
        draft: {
            title: "Ledger",
            cells: [
                { key: "l-trend", row: "r1", span: 12n, height: some(240n), align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            ],
        },
        live: none,
    })],
    [{ project: "HR roster", page: "rota" }, variant("page", {
        draft: { title: "Rota", cells: [] },
        live: some({ version: 1n, page: { title: "Rota", cells: [] } }),
    })],
], compareFor(Studio.Types.Key)));

/** The record's one write. */
export const studioLibraryPagesPatch = e3.mutation.patch(studioLibraryPages);

export const studioPageLibrary = example({
    keywords: [
        "Studio", "Studio.PageLibrary", "page library", "pages", "templates", "Blank grid", "new page", "Studio.newPage", "project",
        "Library", "gallery", "wireframe", "SnapGrid", "search", "sort", "grid", "list", "Record.bind", "patch", "e3.record",
        "Open in builder", "status", "Live", "Draft",
    ],
    description: "The page library over the pages record: one toolbar — the search over templates and pages, Sort · Name, Grid · List and \"+ New page in Ops console\" — beside the projects and the project's pages with their status; the Templates row starts with Blank grid, each card a wireframe of its layout and what it places; the Pages row shows each page's wireframe, status and component count with \"Open in builder →\"; a new page takes a name and a template and is one patch commit",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([
                Studio.component("kpi_rail", {
                    name: "KPI rail", category: "Display", icon: "gauge-high",
                    description: "Revenue, orders, average ticket and fill rate, each with its change since last week.",
                },
                    East.function([], UIComponentType, ($2) => {
                        const Kpi = StructType({ label: StringType, value: FloatType, format: Format.Types.Tick, change: StringType, tone: MetricChip.Types.Tone });
                        const kpis = $2.const([
                            { label: "Revenue", value: 1284000.0, format: Format.Currency({ currency: "USD", compact: "short", maximumFractionDigits: 2n }), change: "▲ 6.4%", tone: variant("positive", null) },
                            { label: "Orders", value: 8412.0, format: Format.Number(), change: "▲ 2.1%", tone: variant("positive", null) },
                            { label: "Avg ticket", value: 152.0, format: Format.Currency({ currency: "USD", maximumFractionDigits: 0n }), change: "▼ 1.3%", tone: variant("negative", null) },
                            { label: "Fill rate", value: 0.94, format: Format.Percent({ maximumFractionDigits: 0n }), change: "— flat", tone: variant("neutral", null) },
                        ], ArrayType(Kpi));
                        return (
                            <HStack gap="0" align="stretch">
                                {kpis.map(($3, k, i) => (
                                    <Box flex="1" borderColor="border.subtle"
                                        borderWidth={i.equal(kpis.size().subtract(1n)).ifElse(_$4 => "0", _$4 => "0 1px 0 0")}
                                        padding={{ top: some("3"), right: some("4"), bottom: some("3"), left: some("4") }}>
                                        <Stat label={k.label} value={k.value} format={k.format}
                                            baseline={<MetricChip tone={k.tone}><Text>{k.change}</Text></MetricChip>} />
                                    </Box>
                                ))}
                            </HStack>
                        );
                    })),
                Studio.component("revenue_trend", {
                    name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n,
                    description: "Weekly revenue over the last six weeks, as an area.",
                },
                    East.function([], UIComponentType, ($2) => {
                        const days = $2.const([
                            { day: new Date("2026-02-12T00:00:00Z"), revenue: 2640000.0 },
                            { day: new Date("2026-02-19T00:00:00Z"), revenue: 2710000.0 },
                            { day: new Date("2026-02-26T00:00:00Z"), revenue: 2900000.0 },
                            { day: new Date("2026-03-05T00:00:00Z"), revenue: 3180000.0 },
                            { day: new Date("2026-03-12T00:00:00Z"), revenue: 3300000.0 },
                            { day: new Date("2026-03-19T00:00:00Z"), revenue: 3430000.0 },
                        ], ArrayType(StructType({ day: DateTimeType, revenue: FloatType })));
                        return (
                            <Box height="168px" padding={{ top: some("4"), right: some("4"), bottom: some("3"), left: some("3") }}>
                                <Chart height="fill" grid
                                    layers={Chart.Area(days, { x: r => r.day, y: r => r.revenue }, { color: "brand.solid", fillOpacity: 0.08, curve: "linear" })}
                                    x={{ format: Chart.format.date("MMM D") }}
                                    y={{ format: Chart.format.compact() }} />
                            </Box>
                        );
                    })),
                Studio.component("breakdown_bars", {
                    name: "Breakdown bars", category: "Display", icon: "chart-bar", span: 4n,
                    description: "Each region's share of revenue.",
                },
                    East.function([], UIComponentType, (_$2) => (
                        <Box padding="4">
                            <BarStrip showValues={false} items={[
                                { label: <Text>North</Text>, value: 42.0, trailing: <Text>42%</Text> },
                                { label: <Text>South</Text>, value: 31.0, trailing: <Text>31%</Text> },
                                { label: <Text>West</Text>, value: 27.0, trailing: <Text>27%</Text> },
                            ]} />
                        </Box>
                    ))),
                Studio.component("orders_by_week", {
                    name: "Orders by week", category: "Charts", icon: "chart-column", span: 6n,
                    description: "Orders placed each week.",
                },
                    East.function([], UIComponentType, ($2) => {
                        const weeks = $2.const([
                            { week: "W9", orders: 96.0 }, { week: "W10", orders: 158.0 }, { week: "W11", orders: 214.0 },
                            { week: "W12", orders: 271.0 }, { week: "W13", orders: 248.0 }, { week: "W14", orders: 196.0 },
                        ], ArrayType(StructType({ week: StringType, orders: FloatType })));
                        return (
                            <Box height="168px" padding={{ top: some("4"), right: some("4"), bottom: some("3"), left: some("3") }}>
                                <Chart height="fill" grid layers={Chart.Column(weeks, { x: r => r.week, y: r => r.orders }, { color: "brand.solid" })} />
                            </Box>
                        );
                    })),
            ]);
            const record = $.let(Record.bind(studioLibraryPages, [studioLibraryPagesPatch]));
            return (
                <Box height="764px">
                    <Studio.PageLibrary pages={record} components={components} project="Ops console" id="library" />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
