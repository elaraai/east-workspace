/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's inspector (#996): what it shows of the selected placement —
 * its name and its component's key (B16), the datasets it reads (B17), its
 * description (B18) and its layout (B20) — computed in East over the listed
 * components, the listed sources' names and the placements as the canvas
 * draws them; and of a placement that holds a visual or a text block (#1669).
 */

import { ArrayType, East, FloatType, none, some, variant } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Studio } from "@elaraai/e3-ui";
import { inspectorSelection } from "@elaraai/e3-ui/internal";

/** A dataset a component reads. */
const salesDaily = e3.input("inspector_sales_daily", ArrayType(FloatType), variant("value", []));

/** The trend's code. */
const trendFn = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const sales = $.let(Data.bind(salesDaily));
    return Text.Root(East.print(sales.read().size()));
})));

/** A component that reads the dataset, with its description. */
const revenueTrend = Studio.component("revenue_trend", {
    name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n, description: "Weekly revenue, as an area.",
}, trendFn);

/** A component that reads nothing and says nothing. */
const kpiRail = Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high" },
    East.function([], UIComponentType, (_$) => Text.Root("KPIs")));

/** The listed sources' names, by key. */
const SOURCES = new Map([["orders", "Orders"]]);

/** Revenue by month as columns, over the orders. */
const revenueByMonth = Studio.visual.of("orders", Studio.visual.column({
    x: Studio.visual.group("ordered_at", { bucket: "month" }),
    values: [Studio.visual.sum("revenue")],
}));
/** Stock on hand as a KPI, over a source the surface does not list. */
const stockOnHand = Studio.visual.of("stock", Studio.visual.kpi({ value: Studio.visual.sum("units") }));
/** A note. */
const aboutNote = Studio.visual.text("Figures are to last night.", "About");

describeEast("The builder's inspector — what it shows of the selected placement (#996)", (test) => {
    test("B16–B18: the placement's name, its component's key, the data its code reads in words — never a keypath — and its description", $ => {
        const cells = $.const([
            { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
            { key: "c-trend", row: "r2", span: 8n, height: some(240n), align: variant("stretch", null), title: none, content: variant("component", "revenue_trend") },
            { key: "c-regions", row: "r2", span: 3n, height: none, align: variant("top", null), title: some("Regions"), content: variant("component", "kpi_rail") },
        ], ArrayType(Studio.Types.Cell));
        const listed = $.let([revenueTrend, kpiRail]);
        const trend = $.let(inspectorSelection(listed, SOURCES, cells, some("c-trend")).unwrap("some"));
        $(Assert.equal(trend.key, "c-trend"));
        $(Assert.equal(trend.name, "Revenue trend"));
        $(Assert.equal(trend.content, variant("component", {
            key: "revenue_trend", reads: ["Inspector sales daily"], description: some("Weekly revenue, as an area."),
        })));
        // B20: row 2 of 2; the 3 columns the row's other placement spans leave it 9 at most.
        $(Assert.equal(trend.layout, { span: 8n, most: 9n, row: 2n, rows: 2n, height: some(240n), align: variant("stretch", null) }));
        // A placement's own title names it; a component that reads nothing lists nothing, and has no description.
        const regions = $.let(inspectorSelection(listed, SOURCES, cells, some("c-regions")).unwrap("some"));
        $(Assert.equal(regions.name, "Regions"));
        $(Assert.equal(regions.content, variant("component", { key: "kpi_rail", reads: [], description: none })));
        $(Assert.equal(regions.layout.most, 4n));
    });

    test("a placement whose component the surface does not list is named by its component's key, and reads nothing", $ => {
        const cells = $.const([
            { key: "c-gone", row: "r1", span: 6n, height: none, align: variant("center", null), title: none, content: variant("component", "retired_chart") },
        ], ArrayType(Studio.Types.Cell));
        const gone = $.let(inspectorSelection([revenueTrend], SOURCES, cells, some("c-gone")).unwrap("some"));
        $(Assert.equal(gone.name, "retired_chart"));
        $(Assert.equal(gone.content, variant("component", { key: "retired_chart", reads: [], description: none })));
        $(Assert.equal(gone.layout, { span: 6n, most: 12n, row: 1n, rows: 1n, height: none, align: variant("center", null) }));
    });

    test("#1669: a visual is named by its view and its source, and shows its view, its icon and its source's name — its key where the surface lists none of it; a text block is named Text; a title names either", $ => {
        const cells = $.const([
            { key: "c-revenue", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: revenueByMonth },
            { key: "c-stock", row: "r1", span: 6n, height: none, align: variant("top", null), title: some("Stock on hand"), content: stockOnHand },
            { key: "c-note", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, content: aboutNote },
        ], ArrayType(Studio.Types.Cell));
        const listed = $.let([kpiRail]);
        const revenue = $.let(inspectorSelection(listed, SOURCES, cells, some("c-revenue")).unwrap("some"));
        $(Assert.equal(revenue.name, "Column chart · Orders"));
        $(Assert.equal(revenue.content, variant("visual", { view: "Column chart", icon: "chart-column", source: "Orders" })));
        $(Assert.equal(revenue.layout.most, 6n));
        const stock = $.let(inspectorSelection(listed, SOURCES, cells, some("c-stock")).unwrap("some"));
        $(Assert.equal(stock.name, "Stock on hand"));
        $(Assert.equal(stock.content, variant("visual", { view: "KPI", icon: "gauge-high", source: "stock" })));
        const note = $.let(inspectorSelection(listed, SOURCES, cells, some("c-note")).unwrap("some"));
        $(Assert.equal(note.name, "Text"));
        $(Assert.equal(note.content, variant("text", null)));
    });

    test("nothing selected, or a key the page does not hold, shows nothing", $ => {
        const cells = $.const([
            { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
        ], ArrayType(Studio.Types.Cell));
        const listed = $.let([kpiRail]);
        $(Assert.equal(inspectorSelection(listed, SOURCES, cells, none).hasTag("none"), true));
        $(Assert.equal(inspectorSelection(listed, SOURCES, cells, some("c-elsewhere")).hasTag("none"), true));
    });
}, { platformFns: TestImpl });
