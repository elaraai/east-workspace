/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** @jsxImportSource @elaraai/e3-ui */

/**
 * Studio tiles at every size (#1692): published pages that place each tile
 * the Studio draws in its configurations at a narrow, a small and a wide
 * span, over the quarter's orders. A page gives a tile any width — a span of
 * its grid, half of it or all of it as the grid narrows — and the showcase's
 * responsive spec reads these pages at page widths from a desktop's to a
 * phone's, measuring every part of every tile. And the renderer's tile tests'
 * own data, which they read on e3 itself (#1673).
 */

import { ArrayType, DateTimeType, East, FloatType, IntegerType, OptionType, SortedMap, StringType, StructType, compareFor, example, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Reactive, UIComponentType } from "@elaraai/east-ui";
import { Data, Studio } from "@elaraai/e3-ui";
import e3 from "@elaraai/e3";
import { orderFields, studioOrders } from "./studio.examples.js";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

const vis = Studio.visual;

/**
 * Each KPI the page places, on a row of its own: its value alone — a count,
 * an amount, a percentage, a ratio; its change against what it compares to,
 * up, down, flat and long; lower is better; its goal; its trend; and every
 * part at once under a long name.
 */
const KPIS = {
    count: vis.kpi({ value: vis.count() }),
    amount: vis.kpi({ value: vis.sum("revenue") }),
    percent: vis.kpi({ value: vis.mean("margin") }),
    ratio: vis.kpi({ value: vis.ratio("revenue", "units") }),
    up: vis.kpi({ value: vis.sum("revenue"), compare: vis.mean("revenue") }),
    down: vis.kpi({ value: vis.mean("revenue"), compare: vis.sum("revenue") }),
    flat: vis.kpi({ value: vis.sum("revenue"), compare: vis.sum("revenue") }),
    long: vis.kpi({ value: vis.count(), compare: vis.sum("revenue") }),
    lower: vis.kpi({ value: vis.sum("units", { better: "lower" }), compare: vis.mean("units") }),
    goal: vis.kpi({ value: vis.sum("revenue", { goal: 24000 }) }),
    trend: vis.kpi({ value: vis.count(), trend: "ordered_at" }),
    every: vis.kpi({
        value: vis.sum("revenue", { goal: 24000, label: "Revenue across every region this quarter" }),
        compare: vis.mean("revenue"), trend: "ordered_at",
    }),
};

/** The spans each KPI is placed at, on its row: narrow, small and wide. */
const SPANS = [2n, 3n, 7n];

/** The KPI sizes page's placements: each KPI at each span, keyed by both. */
const kpiCells = Object.entries(KPIS).flatMap(([name, kpi]) => SPANS.map((span) => ({
    key: `kpi-${name}-${span}`, row: `r-${name}`, span, height: none, align: variant("stretch", null), title: none,
    content: vis.of("orders", kpi),
})));

/** The pages of the tiles' project: KPI sizes, live as it was drafted. */
export const studioTilePages = e3.record("studio_tile_pages", Studio.Types.Pages, {
    initial: new SortedMap<Key, Entry>([
        [{ project: "Sales desk", page: "KPI sizes" }, variant("page", {
            draft: { title: "KPI sizes", cells: kpiCells },
            live: some({ version: 1n, page: { title: "KPI sizes", cells: kpiCells } }),
        })],
    ], compareFor(Studio.Types.Key)),
    mutations: (mutation) => ({
        // The record's one write.
        patch: mutation.patch(),
    }),
});

export const studioKpiSizes = example({
    keywords: [
        "Studio", "Studio.Page", "Studio.visual", "visual", "KPI", "sizes", "span", "narrow", "responsive", "unit", "change", "compare",
        "lower is better", "goal", "trend", "Studio.source", "Data.bind",
    ],
    description: "Every KPI the Studio draws, each at a narrow, a small and a wide span, on a published page over the quarter's orders: its value alone — a count, an amount, a percentage and a ratio, each with its unit; its change against what it compares to, up, down, flat and long; lower is better; its goal; its trend; and every part at once under a long name. A page gives a tile any width — its span of the grid, half the grid or all of it as the grid narrows — and each tile stands whole at every one (#1692)",
    fn: East.function([], UIComponentType, (_$) => (
        <Reactive>{$ => {
            const pages = $.let(Data.bind(studioTilePages));
            const orders = $.let(Data.bind(studioOrders));
            return (
                <Studio.Page pages={pages.read()} components={[]} page={{ project: "Sales desk", page: "KPI sizes" }}
                    sources={{
                        orders: Studio.source(orders, {
                            name: "Orders", icon: "receipt", description: "One row per order",
                            fields: orderFields,
                            range: "ordered_at",
                        }),
                    }} />
            );
        }}</Reactive>
    )),
    inputs: [],
});

// ============================================================================
// The renderer's tile tests' own data (#1673): small enough to total by eye
// ============================================================================

/** Three orders: South Australia's two and New South Wales' one, over July and August — 210 of revenue, 7 units. */
export const tileTestOrders = e3.input("tile_test_orders", ArrayType(StructType({
    ordered_at: DateTimeType, region: StringType, revenue: FloatType, units: IntegerType,
})), variant("value", [
    { ordered_at: new Date("2026-07-03T10:00:00Z"), region: "SA", revenue: 100.0, units: 4n },
    { ordered_at: new Date("2026-07-20T10:00:00Z"), region: "NSW", revenue: 50.0, units: 1n },
    { ordered_at: new Date("2026-08-02T10:00:00Z"), region: "SA", revenue: 60.0, units: 2n },
]));

/** Who manages each region of those orders: a source a list on it leads the orders by. */
export const tileTestManagers = e3.input("tile_test_managers", ArrayType(StructType({ region: StringType, manager: StringType })), variant("value", [
    { region: "SA", manager: "Avery" },
    { region: "NSW", manager: "Blake" },
]));

/** An order of {@link tileTestQuarter}: when, where, for whom, for how much, how many units, and its margin where it is known. */
export const TileTestQuarterRow = StructType({
    ordered_at: DateTimeType, region: StringType, customer: StringType, revenue: FloatType, units: IntegerType, margin: OptionType(FloatType),
});

/**
 * Five orders in the quarter from July 2026 and two a year before —
 * Victoria's, and Queensland's, which the quarter has none of: the rows the
 * renderer's visual tests total, and a page filter's values are read from.
 */
export const tileTestQuarterRows: ValueTypeOf<typeof TileTestQuarterRow>[] = [
    { ordered_at: new Date("2026-07-03T10:00:00Z"), region: "SA", customer: "Northwind", revenue: 100.0, units: 3n, margin: some(0.2) },
    { ordered_at: new Date("2026-07-20T10:00:00Z"), region: "NSW", customer: "Harbour", revenue: 50.0, units: 1n, margin: none },
    { ordered_at: new Date("2026-08-02T10:00:00Z"), region: "SA", customer: "Summit", revenue: 70.0, units: 2n, margin: some(0.1) },
    { ordered_at: new Date("2026-08-15T10:00:00Z"), region: "VIC", customer: "Northwind", revenue: 30.0, units: 5n, margin: some(0.3) },
    { ordered_at: new Date("2026-09-01T10:00:00Z"), region: "WA", customer: "Summit", revenue: 20.0, units: 1n, margin: some(0.4) },
    { ordered_at: new Date("2025-07-10T10:00:00Z"), region: "VIC", customer: "Northwind", revenue: 40.0, units: 4n, margin: some(0.3) },
    { ordered_at: new Date("2025-08-10T10:00:00Z"), region: "QLD", customer: "Harbour", revenue: 10.0, units: 1n, margin: none },
];

/** The quarter's orders, as e3 holds them (#1673): what a renderer test reads them from on e3 itself. */
export const tileTestQuarter = e3.input("tile_test_quarter", ArrayType(TileTestQuarterRow), variant("value", tileTestQuarterRows));
