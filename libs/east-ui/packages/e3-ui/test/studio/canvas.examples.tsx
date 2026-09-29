/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * `<Studio.Canvas>` (#995) — the builder's canvas over the pages record: the
 * open page's grid in the builder's frame, with the palette beside it.
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

/** The pages record the builder edits — the Overview never published, the Weekly live. */
export const studioCanvasPages = e3.record("studio_canvas_pages", Studio.Types.Pages, new SortedMap<Key, Entry>([
    [{ project: "ops", page: "overview" }, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                { key: "c-bars", row: "r2", span: 4n, height: none, align: variant("stretch", null), title: none, component: "breakdown_bars", fingerprint: "" },
            ],
        },
        live: none,
    })],
    [{ project: "ops", page: "weekly" }, variant("page", {
        draft: {
            title: "Weekly",
            cells: [
                { key: "w-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
            ],
        },
        live: some({
            version: 1n,
            page: {
                title: "Weekly",
                cells: [
                    { key: "w-orders", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "" },
                ],
            },
        }),
    })],
], compareFor(Studio.Types.Key)));

/** The record's one write. */
export const studioCanvasPagesPatch = e3.mutation.patch(studioCanvasPages);

export const studioCanvas = example({
    keywords: [
        "Studio", "Studio.Canvas", "builder", "canvas", "SnapGrid", "edit", "toolbar", "history", "Undo", "Apply", "Studio.save",
        "Record.bind", "patch", "e3.record", "status", "Draft", "zoom", "Desktop", "Tablet", "selection bar", "palette", "panes",
    ],
    description: "The builder's canvas over the pages record: the open page's grid in the builder's frame — its status, the grid chip, the zoom, the history item, Desktop · Tablet, Preview and Publish in one toolbar, the palette beside the grid, and the selection bar naming the selected placement; a component dragged from the palette lands on the grid, and Apply saves the page as one patch commit",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const components = $.let([
                Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high" },
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
                Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n },
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
                Studio.component("breakdown_bars", { name: "Breakdown bars", category: "Display", icon: "chart-bar", span: 4n },
                    East.function([], UIComponentType, (_$2) => (
                        <Box padding="4">
                            <BarStrip showValues={false} items={[
                                { label: <Text>North</Text>, value: 42.0, trailing: <Text>42%</Text> },
                                { label: <Text>South</Text>, value: 31.0, trailing: <Text>31%</Text> },
                                { label: <Text>West</Text>, value: 27.0, trailing: <Text>27%</Text> },
                            ]} />
                        </Box>
                    ))),
                Studio.component("orders_by_week", { name: "Orders by week", category: "Charts", icon: "chart-column", span: 6n },
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
            const record = $.let(Record.bind(studioCanvasPages, [studioCanvasPagesPatch]));
            return (
                <Box height="720px">
                    <Studio.Canvas pages={record} components={components} project="ops" id="example"
                        panes={{ start: <Studio.Palette pages={record.read()} components={components} project="ops" id="example" /> }} />
                </Box>
            );
        }}</Reactive>
    )),
    inputs: [],
});
