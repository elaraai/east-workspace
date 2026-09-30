/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's inspector (#996): what it shows of the selected placement —
 * its name and its component's key, whether its code changed since the page
 * went live (B16), the datasets it reads (B17), its description (B18) and its
 * layout (B20) — computed in East over the listed components and the
 * placements as the canvas draws them.
 */

import { ArrayType, East, FloatType, OptionType, none, some, variant } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Studio } from "@elaraai/e3-ui";
import { fingerprintOf, inspectorSelection } from "@elaraai/e3-ui/internal";

/** A dataset a component reads. */
const salesDaily = e3.input("inspector_sales_daily", ArrayType(FloatType), variant("value", []));

/** The trend's code — its fingerprint is what a saved cell stores. */
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

describeEast("The builder's inspector — what it shows of the selected placement (#996)", (test) => {
    test("B16–B18: the placement's name, its component's key, the paths its code reads, and its description", $ => {
        const cells = $.const([
            { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
            { key: "c-trend", row: "r2", span: 8n, height: some(240n), align: variant("stretch", null), title: none, component: "revenue_trend", fingerprint: "" },
            { key: "c-regions", row: "r2", span: 3n, height: none, align: variant("top", null), title: some("Regions"), component: "kpi_rail", fingerprint: "" },
        ], ArrayType(Studio.Types.Cell));
        const listed = $.let([revenueTrend, kpiRail]);
        const trend = $.let(inspectorSelection(listed, cells, none, some("c-trend")).unwrap("some"));
        $(Assert.equal(trend.key, "c-trend"));
        $(Assert.equal(trend.name, "Revenue trend"));
        $(Assert.equal(trend.component, "revenue_trend"));
        $(Assert.equal(trend.reads, [[variant("field", "inputs"), variant("field", "inspector_sales_daily")]]));
        $(Assert.equal(trend.description, some("Weekly revenue, as an area.")));
        $(Assert.equal(trend.changed, false));
        // B20: row 2 of 2; the 3 columns the row's other placement spans leave it 9 at most.
        $(Assert.equal(trend.layout, { span: 8n, most: 9n, row: 2n, rows: 2n, height: some(240n), align: variant("stretch", null) }));
        // A placement's own title names it; a component that reads nothing lists nothing, and has no description.
        const regions = $.let(inspectorSelection(listed, cells, none, some("c-regions")).unwrap("some"));
        $(Assert.equal(regions.name, "Regions"));
        $(Assert.equal(regions.reads, []));
        $(Assert.equal(regions.description, none));
        $(Assert.equal(regions.layout.most, 4n));
    });

    test("B16: its code changed since the page went live when the live version's cell stored another fingerprint", $ => {
        const cells = $.const([
            { key: "c-trend", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            { key: "c-new", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
        ], ArrayType(Studio.Types.Cell));
        const older = $.const(some([
            { key: "c-trend", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "an older fingerprint" },
        ]), OptionType(ArrayType(Studio.Types.Cell)));
        const current = $.const(some([
            { key: "c-trend", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: fingerprintOf(trendFn) },
        ]), OptionType(ArrayType(Studio.Types.Cell)));
        const listed = $.let([revenueTrend]);
        const changed = $.let(inspectorSelection(listed, cells, older, some("c-trend")).unwrap("some"));
        $(Assert.equal(changed.changed, true));
        const same = $.let(inspectorSelection(listed, cells, current, some("c-trend")).unwrap("some"));
        $(Assert.equal(same.changed, false));
        // A placement the live version does not hold has not gone live, and has not changed; nor has a page never published.
        const fresh = $.let(inspectorSelection(listed, cells, older, some("c-new")).unwrap("some"));
        $(Assert.equal(fresh.changed, false));
        const unpublished = $.let(inspectorSelection(listed, cells, none, some("c-trend")).unwrap("some"));
        $(Assert.equal(unpublished.changed, false));
    });

    test("a placement whose component the surface does not list is named by its component's key, and reads nothing", $ => {
        const cells = $.const([
            { key: "c-gone", row: "r1", span: 6n, height: none, align: variant("center", null), title: none, component: "retired_chart", fingerprint: "" },
        ], ArrayType(Studio.Types.Cell));
        const gone = $.let(inspectorSelection([revenueTrend], cells, none, some("c-gone")).unwrap("some"));
        $(Assert.equal(gone.name, "retired_chart"));
        $(Assert.equal(gone.reads, []));
        $(Assert.equal(gone.description, none));
        $(Assert.equal(gone.layout, { span: 6n, most: 12n, row: 1n, rows: 1n, height: none, align: variant("center", null) }));
    });

    test("nothing selected, or a key the page does not hold, shows nothing", $ => {
        const cells = $.const([
            { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
        ], ArrayType(Studio.Types.Cell));
        const listed = $.let([kpiRail]);
        $(Assert.equal(inspectorSelection(listed, cells, none, none).hasTag("none"), true));
        $(Assert.equal(inspectorSelection(listed, cells, none, some("c-elsewhere")).hasTag("none"), true));
    });
}, { platformFns: TestImpl });
