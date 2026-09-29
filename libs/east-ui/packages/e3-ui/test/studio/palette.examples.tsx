/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * `<Studio.Palette>` (#994) — the builder's palette: the components a surface
 * lists, grouped by category, and the project's pages.
 */

import {
    ArrayType, DateTimeType, East, FloatType, IntegerType, StringType, StructType, example, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Box, Chart, Format, HStack, Reactive, Stat, UIComponentType } from "@elaraai/east-ui";
import { Data, Studio } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

/** Sales by day and by week, visits by day, and the week's rota — what the palette's components read. */
const PaletteSalesRow = StructType({ day: DateTimeType, revenue: FloatType, orders: IntegerType });
export const paletteSalesDaily = e3.input("palette_sales_daily", ArrayType(PaletteSalesRow), variant("value", []));
export const paletteSalesWeekly = e3.input("palette_sales_weekly", ArrayType(PaletteSalesRow), variant("value", []));
export const paletteVisitsDaily = e3.input("palette_visits_daily", ArrayType(StructType({ day: DateTimeType, visits: FloatType })), variant("value", []));
export const paletteRotaWeek = e3.input("palette_rota_week", ArrayType(StructType({ person: StringType, shift: StringType })), variant("value", []));

export const studioPalette = example({
    keywords: [
        "Studio", "Studio.Palette", "palette", "builder", "components", "category", "Filter", "search", "pages", "status",
        "Dock", "Library", "collapse", "rail",
    ],
    description: "The builder's palette: the listed components grouped by category, each card naming what it reads under a lock — the deprecated one is not offered — and the project's pages with their status",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([
                Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none", tags: ["kpi", "sales"] },
                    East.function([], UIComponentType, (_$2) => (
                        <Reactive>{$2 => {
                            const sales = $2.let(Data.bind(paletteSalesDaily));
                            return <Stat label="Orders" value={sales.read().size()} format={Format.Number()} />;
                        }}</Reactive>
                    ))),
                Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n, tags: ["sales"] },
                    East.function([], UIComponentType, (_$2) => (
                        <Reactive>{$2 => {
                            const sales = $2.let(Data.bind(paletteSalesDaily));
                            return <Chart height="fill" grid layers={Chart.Area(sales.read(), { x: r => r.day, y: r => r.revenue })} />;
                        }}</Reactive>
                    ))),
                Studio.component("orders_by_week", { name: "Orders by week", category: "Charts", icon: "chart-column", tags: ["orders"] },
                    East.function([], UIComponentType, (_$2) => (
                        <Reactive>{$2 => {
                            const weeks = $2.let(Data.bind(paletteSalesWeekly));
                            return <Chart height="fill" grid layers={Chart.Column(weeks.read(), { x: r => r.day, y: r => r.orders })} />;
                        }}</Reactive>
                    ))),
                Studio.component("visits_sparkline", { name: "Visits", category: "Charts", icon: "chart-line", span: 4n, tags: ["traffic"] },
                    East.function([], UIComponentType, (_$2) => (
                        <Reactive>{$2 => {
                            const visits = $2.let(Data.bind(paletteVisitsDaily));
                            return <Chart height="fill" layers={Chart.Line(visits.read(), { x: r => r.day, y: r => r.visits })} />;
                        }}</Reactive>
                    ))),
                Studio.component("shift_roster", { name: "Shift roster", category: "Operations", icon: "calendar-week", collections: ["People"] },
                    East.function([], UIComponentType, (_$2) => (
                        <Reactive>{$2 => {
                            const rota = $2.let(Data.bind(paletteRotaWeek));
                            return <Stat label="Shifts" value={rota.read().size()} />;
                        }}</Reactive>
                    ))),
                Studio.component("orders_table_v1", { name: "Orders table", category: "Operations", icon: "table", deprecated: true },
                    East.function([], UIComponentType, (_$2) => (
                        <Reactive>{$2 => {
                            const sales = $2.let(Data.bind(paletteSalesDaily));
                            return <Stat label="Rows" value={sales.read().size()} />;
                        }}</Reactive>
                    ))),
            ]);
            const pages = $.let(new Map<Key, Entry>([
                [{ project: "ops", page: "overview" }, variant("page", {
                    draft: {
                        title: "Overview",
                        cells: [
                            { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                            { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                            { key: "c-visits", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, component: "visits_sparkline", fingerprint: "" },
                        ],
                    },
                    live: some({
                        version: 2n,
                        page: {
                            title: "Overview",
                            cells: [
                                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                                { key: "c-visits", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, component: "visits_sparkline", fingerprint: "" },
                            ],
                        },
                    }),
                })],
                [{ project: "ops", page: "weekly" }, variant("page", {
                    draft: {
                        title: "Weekly",
                        cells: [
                            { key: "w-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
                        ],
                    },
                    live: some({ version: 1n, page: { title: "Weekly", cells: [] } }),
                })],
                [{ project: "ops", page: "roster" }, variant("page", {
                    draft: {
                        title: "Roster",
                        cells: [
                            { key: "r-roster", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "shift_roster", fingerprint: "" },
                        ],
                    },
                    live: none,
                })],
                [{ project: "ops", page: "starter" }, variant("template", { title: "Starter", cells: [] })],
                [{ project: "retail", page: "home" }, variant("page", {
                    draft: { title: "Home", cells: [] },
                    live: some({ version: 1n, page: { title: "Home", cells: [] } }),
                })],
            ]), Studio.Types.Pages);
            return (
                <Box height="560px" width="100%" borderWidth="1px" borderColor="border.strong" borderRadius="md" overflow="hidden">
                    <HStack gap="0" height="100%">
                        <Studio.Palette pages={pages} components={components} project="ops" id="example" />
                    </HStack>
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
