/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * `<Studio.Publish>` (#998) — the publish preview over the pages record: the
 * open page as it will publish, what changed since its live version, and the
 * actions that publish it.
 */

import {
    ArrayType, DateTimeType, East, FloatType, SortedMap, StringType, StructType, compareFor, example, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import { BarStrip, Box, Chart, Format, HStack, MetricChip, Reactive, Stat, Text, UIComponentType } from "@elaraai/east-ui";
import { Record, Studio, fingerprintOf } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

/** The KPI rail's code: four figures, each with its change since last week. */
const kpiRail = East.function([], UIComponentType, ($) => {
    const Kpi = StructType({ label: StringType, value: FloatType, format: Format.Types.Tick, change: StringType, tone: MetricChip.Types.Tone });
    const kpis = $.const([
        { label: "Revenue", value: 1284000.0, format: Format.Currency({ currency: "USD", compact: "short", maximumFractionDigits: 2n }), change: "▲ 6.4%", tone: variant("positive", null) },
        { label: "Orders", value: 8412.0, format: Format.Number(), change: "▲ 2.1%", tone: variant("positive", null) },
        { label: "Avg ticket", value: 152.0, format: Format.Currency({ currency: "USD", maximumFractionDigits: 0n }), change: "▼ 1.3%", tone: variant("negative", null) },
        { label: "Fill rate", value: 0.94, format: Format.Percent({ maximumFractionDigits: 0n }), change: "— flat", tone: variant("neutral", null) },
    ], ArrayType(Kpi));
    return (
        <HStack gap="0" align="stretch">
            {kpis.map(($2, k, i) => (
                <Box flex="1" borderColor="border.subtle"
                    borderWidth={i.equal(kpis.size().subtract(1n)).ifElse(_$3 => "0", _$3 => "0 1px 0 0")}
                    padding={{ top: some("3"), right: some("4"), bottom: some("3"), left: some("4") }}>
                    <Stat label={k.label} value={k.value} format={k.format}
                        baseline={<MetricChip tone={k.tone}><Text>{k.change}</Text></MetricChip>} />
                </Box>
            ))}
        </HStack>
    );
});

/** The Revenue trend's code: weekly revenue, as an area. */
const revenueTrend = East.function([], UIComponentType, ($) => {
    const days = $.const([
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
});

/** The Breakdown bars' code: each region's share of revenue. */
const breakdownBars = East.function([], UIComponentType, (_$) => (
    <Box padding="4">
        <BarStrip showValues={false} items={[
            { label: <Text>North</Text>, value: 42.0, trailing: <Text>42%</Text> },
            { label: <Text>South</Text>, value: 31.0, trailing: <Text>31%</Text> },
            { label: <Text>West</Text>, value: 27.0, trailing: <Text>27%</Text> },
        ]} />
    </Box>
));

/**
 * The pages record: the Ops console's Overview, live as v3, its draft resizing
 * the trend and adding the bars beside it; and the Finance portal's Ledger,
 * live as v2 as it stands, but the trend's code changed since.
 */
export const studioPublishPages = e3.record("studio_publish_pages", Studio.Types.Pages, new SortedMap<Key, Entry>([
    [{ project: "Ops console", page: "overview" }, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "o-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: fingerprintOf(kpiRail) },
                { key: "o-trend", row: "r2", span: 8n, height: none, align: variant("stretch", null), title: none, component: "revenue_trend", fingerprint: fingerprintOf(revenueTrend) },
                { key: "o-bars", row: "r2", span: 4n, height: none, align: variant("stretch", null), title: none, component: "breakdown_bars", fingerprint: fingerprintOf(breakdownBars) },
            ],
        },
        live: some({
            version: 3n,
            page: {
                title: "Overview",
                cells: [
                    { key: "o-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: fingerprintOf(kpiRail) },
                    { key: "o-trend", row: "r2", span: 12n, height: none, align: variant("stretch", null), title: none, component: "revenue_trend", fingerprint: fingerprintOf(revenueTrend) },
                ],
            },
        }),
    })],
    [{ project: "Finance portal", page: "ledger" }, variant("page", {
        draft: {
            title: "Ledger",
            cells: [
                { key: "l-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: fingerprintOf(kpiRail) },
                { key: "l-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "an older fingerprint" },
            ],
        },
        live: some({
            version: 2n,
            page: {
                title: "Ledger",
                cells: [
                    { key: "l-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: fingerprintOf(kpiRail) },
                    { key: "l-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "an older fingerprint" },
                ],
            },
        }),
    })],
], compareFor(Studio.Types.Key)));

/** The record's one write. */
export const studioPublishPagesPatch = e3.mutation.patch(studioPublishPages);

export const studioPublishPreview = example({
    keywords: [
        "Studio", "Studio.Publish", "publish", "preview", "publish preview", "Studio.publish", "Studio.changes", "changes", "version",
        "live", "draft", "Desktop", "Tablet", "Mobile", "device", "env", "environment", "audience", "rollout", "Save as draft",
        "fingerprint", "logic unchanged", "Record.bind", "patch",
    ],
    description: "The publish preview over the pages record: a bar with ● Preview, Desktop · Tablet · Mobile, the Env pill and Exit; the Overview as it will publish, on the quiet panel; and the aside — Ready to publish, v3 → v4, the two changes since v3, the banner saying the components' logic is unchanged, the Audience and Rollout rows, and Save as draft and Publish v4 to Staging",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([
                Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none" }, kpiRail),
                Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n }, revenueTrend),
                Studio.component("breakdown_bars", { name: "Breakdown bars", category: "Display", icon: "chart-bar", span: 4n }, breakdownBars),
            ]);
            const record = $.let(Record.bind(studioPublishPages, [studioPublishPagesPatch]));
            return (
                <Box height="720px">
                    <Studio.Publish pages={record} components={components} project="Ops console" id="publish"
                        env="Staging" audience="Field ops · 24 users" rollout="Immediate" />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});

export const studioPublishLogicChanged = example({
    keywords: [
        "Studio", "Studio.Publish", "publish preview", "fingerprint", "logic changed", "component code", "warning", "banner", "version",
    ],
    description: "A page whose layout is as it went live, but a component's code has changed since: the banner warns that its placements publish with its new code, and publishing records the code it goes live with. With no environment, audience or rollout, the pill and the rows are not drawn",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([
                Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none" }, kpiRail),
                Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n }, revenueTrend),
            ]);
            const record = $.let(Record.bind(studioPublishPages, [studioPublishPagesPatch]));
            return (
                <Box height="640px">
                    <Studio.Publish pages={record} components={components} project="Finance portal" id="publish-changed" />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
