/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * `<Studio.Page>` and `<Studio.Site>` (#993) — a page as operators see it, and
 * a project's published site, both read from the pages record.
 */

import {
    ArrayType, East, FloatType, NullType, SortedMap, StringType, StructType, compareFor, example, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { Button, Chart, Format, HStack, Reactive, Stat, UIComponentType, VStack } from "@elaraai/east-ui";
import { Record, Studio } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

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

export const studioSite = example({
    keywords: [
        "Studio", "Studio.Site", "site", "App", "rail", "published", "live pages", "navigation", "project",
    ],
    description: "A project's published site: an app whose rail lists the project's live pages in key order — a page never published, a template and another project's pages are not in it",
    fn: East.function([], UIComponentType, ($) => {
        const components = $.let([
            Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none" },
                East.function([], UIComponentType, (_$) => (
                    <HStack gap="3" align="stretch">
                        <Stat label="Revenue" value={1280000.0} format={Format.Currency({ currency: "USD", compact: "short" })} />
                        <Stat label="Orders" value={8412.0} format={Format.Number()} />
                        <Stat label="Fill rate" value={0.94} format={Format.Percent()} />
                    </HStack>
                ))),
            Studio.component("orders_by_week", { name: "Orders by week", category: "Charts", icon: "chart-column", span: 12n },
                East.function([], UIComponentType, ($2) => {
                    const weeks = $2.const([
                        { week: "W9", orders: 96.0 }, { week: "W10", orders: 158.0 }, { week: "W11", orders: 214.0 },
                        { week: "W12", orders: 271.0 }, { week: "W13", orders: 248.0 }, { week: "W14", orders: 196.0 },
                    ], ArrayType(StructType({ week: StringType, orders: FloatType })));
                    return <Chart height="fill" grid layers={Chart.Column(weeks, { x: r => r.week, y: r => r.orders })} />;
                })),
        ]);
        const pages = $.let(new Map<Key, Entry>([
            [{ project: "ops", page: "overview" }, variant("page", {
                draft: { title: "Overview", cells: [] },
                live: some({
                    version: 2n,
                    page: {
                        title: "Overview",
                        cells: [
                            { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                            { key: "c-orders", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
                        ],
                    },
                }),
            })],
            [{ project: "ops", page: "weekly" }, variant("page", {
                draft: { title: "Weekly", cells: [] },
                live: some({
                    version: 1n,
                    page: {
                        title: "Weekly",
                        cells: [
                            { key: "w-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: some("Orders this quarter"), component: "orders_by_week", fingerprint: "" },
                        ],
                    },
                }),
            })],
            [{ project: "ops", page: "detail" }, variant("page", {
                draft: {
                    title: "Detail",
                    cells: [
                        { key: "d-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                    ],
                },
                live: none,
            })],
            [{ project: "ops", page: "tpl-kpis" }, variant("template", {
                title: "KPIs",
                cells: [
                    { key: "t-kpi", row: "t1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                ],
            })],
            [{ project: "retail", page: "home" }, variant("page", {
                draft: { title: "Home", cells: [] },
                live: some({ version: 1n, page: { title: "Home", cells: [] } }),
            })],
        ]), Studio.Types.Pages);
        return <Studio.Site pages={pages} components={components} project="ops" title="Ops console" id="example" />;
    }),
    inputs: [],
});

/** The pages record the site example serves — the Overview live, the Detail a draft. */
export const studioSitePages = e3.record("studio_site_pages", Studio.Types.Pages, new SortedMap<Key, Entry>([
    [{ project: "ops", page: "detail" }, variant("page", {
        draft: {
            title: "Detail",
            cells: [
                { key: "d-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
            ],
        },
        live: none,
    })],
    [{ project: "ops", page: "overview" }, variant("page", {
        draft: { title: "Overview", cells: [] },
        live: some({
            version: 1n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                ],
            },
        }),
    })],
], compareFor(Studio.Types.Key)));

/** The record's one write. */
export const studioSitePagesPatch = e3.mutation.patch(studioSitePages);

export const studioSiteRecord = example({
    keywords: [
        "Studio", "Studio.Site", "Studio.publish", "publish", "record", "Record.bind", "patch", "e3.record", "e3.mutation.patch",
        "site", "live pages",
    ],
    description: "A site served from the pages record: the Detail page is a draft and not in the rail until Publish commits Studio.publish's patch through the record's one write",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([
                Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none" },
                    East.function([], UIComponentType, (_$2) => (
                        <HStack gap="3" align="stretch">
                            <Stat label="Revenue" value={1280000.0} format={Format.Currency({ currency: "USD", compact: "short" })} />
                            <Stat label="Orders" value={8412.0} format={Format.Number()} />
                        </HStack>
                    ))),
                Studio.component("orders_by_week", { name: "Orders by week", category: "Charts", icon: "chart-column", span: 12n },
                    East.function([], UIComponentType, ($2) => {
                        const weeks = $2.const([
                            { week: "W9", orders: 96.0 }, { week: "W10", orders: 158.0 }, { week: "W11", orders: 214.0 },
                            { week: "W12", orders: 271.0 },
                        ], ArrayType(StructType({ week: StringType, orders: FloatType })));
                        return <Chart height="fill" grid layers={Chart.Column(weeks, { x: r => r.week, y: r => r.orders })} />;
                    })),
            ]);
            const record = $.let(Record.bind(studioSitePages, [studioSitePagesPatch]));
            const publish = $.const(East.function([], NullType, ($2) => {
                $2(record.mutate.patch(Studio.publish(record.read(), { project: "ops", page: "detail" })));
            }));
            return (
                <VStack gap="3" align="stretch">
                    <HStack gap="2">
                        <Button size="xs" onClick={publish} loading={record.mutate.pending()}>Publish Detail</Button>
                    </HStack>
                    <Studio.Site pages={record.read()} components={components} project="ops" title="Ops console" id="record" />
                </VStack>
            );
        }}</Reactive>
    )),
    inputs: [],
});
