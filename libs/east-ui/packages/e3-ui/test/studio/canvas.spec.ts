/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's canvas (#995): what a placement's tile shows — framed or
 * bare, its name, its icon, and its meta line of its key and what it reads
 * (B9) — computed in East over the listed components.
 */

import { ArrayType, East, FloatType, variant } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Studio } from "@elaraai/e3-ui";
import { canvasTiles } from "@elaraai/e3-ui/internal";

/** A dataset a component reads. */
const salesDaily = e3.input("canvas_sales_daily", ArrayType(FloatType), variant("value", []));

/** A component that reads the dataset. */
const revenueTrend = Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n },
    East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const sales = $.let(Data.bind(salesDaily));
        return Text.Root(East.print(sales.read().size()));
    }))));

/** A frameless component that reads nothing. */
const kpiRail = Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none" },
    East.function([], UIComponentType, (_$) => Text.Root("KPIs")));

describeEast("The builder's canvas — what a placement's tile shows (#995)", (test) => {
    test("B9: a tile's meta line is its component's key and what it reads; one that reads nothing is its key alone", $ => {
        const tiles = $.let(canvasTiles([revenueTrend, kpiRail]));
        $(Assert.equal(tiles.get("revenue_trend").meta, "revenue_trend · canvas_sales_daily"));
        $(Assert.equal(tiles.get("kpi_rail").meta, "kpi_rail"));
        $(Assert.equal(tiles.get("revenue_trend").icon, "chart-area"));
        $(Assert.equal(tiles.get("revenue_trend").name, "Revenue trend"));
    });

    test("a frameless component's tiles are bare, any other's framed", $ => {
        const tiles = $.let(canvasTiles([revenueTrend, kpiRail]));
        $(Assert.equal(tiles.get("revenue_trend").frame, true));
        $(Assert.equal(tiles.get("kpi_rail").frame, false));
    });

    test("a key two listed components share keeps the first one's tile", $ => {
        const tiles = $.let(canvasTiles([kpiRail, Studio.component("kpi_rail", { name: "Other rail", category: "Display", icon: "table" },
            East.function([], UIComponentType, (_$) => Text.Root("Other")))]));
        $(Assert.equal(tiles.size(), 1n));
        $(Assert.equal(tiles.get("kpi_rail").name, "KPI rail"));
    });
}, { platformFns: TestImpl });
