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
 * phone's, measuring every part of every tile.
 */

import { East, SortedMap, compareFor, example, none, some, variant, type ValueTypeOf } from "@elaraai/east";
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
