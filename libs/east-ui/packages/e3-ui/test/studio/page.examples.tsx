/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * `<Studio.Page>` (#993) — a page as operators see it, read from the pages
 * record's value.
 */

import {
    ArrayType, East, FloatType, StringType, StructType, example, none, some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { Chart, Format, HStack, Stat, UIComponentType } from "@elaraai/east-ui";
import { Studio } from "@elaraai/e3-ui";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

export const studioPage = example({
    keywords: [
        "Studio", "Studio.Page", "page", "live", "draft", "published", "SnapGrid", "tiles", "component", "frame",
        "Chart", "fill", "natural height",
    ],
    description: "One page's published layout with no chrome: each placement its component's own UI on the snap grid — a frameless KPI rail, and charts that take a tile's natural height",
    fn: East.function([], UIComponentType, ($) => {
        const components = $.let([
            Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none" },
                East.function([], UIComponentType, (_$) => (
                    <HStack gap="3" align="stretch">
                        <Stat label="Revenue" value={1280000.0} format={Format.Currency({ currency: "USD", compact: "short" })} />
                        <Stat label="Orders" value={8412.0} format={Format.Number()} />
                        <Stat label="Avg ticket" value={152.0} format={Format.Currency({ currency: "USD", maximumFractionDigits: 0n })} />
                        <Stat label="Fill rate" value={0.94} format={Format.Percent()} />
                    </HStack>
                ))),
            Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n },
                East.function([], UIComponentType, ($2) => {
                    const days = $2.const([
                        { day: "Mar 1", revenue: 2.61 }, { day: "Mar 8", revenue: 2.84 }, { day: "Mar 15", revenue: 3.02 },
                        { day: "Mar 22", revenue: 2.95 }, { day: "Mar 29", revenue: 3.31 }, { day: "Apr 5", revenue: 3.48 },
                    ], ArrayType(StructType({ day: StringType, revenue: FloatType })));
                    return <Chart height="fill" grid layers={Chart.Area(days, { x: r => r.day, y: r => r.revenue })} />;
                })),
            Studio.component("breakdown_bars", { name: "Breakdown bars", category: "Display", icon: "chart-bar", span: 4n },
                East.function([], UIComponentType, ($2) => {
                    const regions = $2.const([
                        { region: "North", share: 42.0 }, { region: "South", share: 31.0 }, { region: "West", share: 27.0 },
                    ], ArrayType(StructType({ region: StringType, share: FloatType })));
                    return <Chart height="fill" grid={false} layers={Chart.Bar(regions, { x: r => r.share, y: r => r.region })} />;
                })),
        ]);
        const pages = $.let(new Map<Key, Entry>([
            [{ project: "ops", page: "overview" }, variant("page", {
                draft: {
                    title: "Overview",
                    cells: [
                        { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                        { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                        { key: "c-bars", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, component: "breakdown_bars", fingerprint: "" },
                    ],
                },
                live: some({
                    version: 1n,
                    page: {
                        title: "Overview",
                        cells: [
                            { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                            { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                            { key: "c-bars", row: "r2", span: 4n, height: none, align: variant("top", null), title: some("Revenue by region"), component: "breakdown_bars", fingerprint: "" },
                        ],
                    },
                }),
            })],
        ]), Studio.Types.Pages);
        return <Studio.Page pages={pages} components={components} page={{ project: "ops", page: "overview" }} />;
    }),
    inputs: [],
});
