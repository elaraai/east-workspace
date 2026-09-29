/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Canvas>` (#995): what a placement's tile shows — framed or bare,
 * its name, its icon, and its meta line of its key and what it reads (B9) —
 * computed in East over the listed components; and the builder surface's
 * manifest, which holds the record it writes and what its components read.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ArrayType, East, FloatType, SortedMap, compareFor, variant, type ValueTypeOf } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { TreePathType } from "@elaraai/e3-types";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Record, Studio, StudioKeyType, StudioPagesType, ui } from "@elaraai/e3-ui";
import { canvasTiles } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

const pathKey = (p: ValueTypeOf<typeof TreePathType>) => p.map((s) => `${s.type}:${s.value}`).join("/");

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

describeEast("<Studio.Canvas> — what a placement's tile shows (#995)", (test) => {
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

describe("<Studio.Canvas> — the builder surface (#995)", () => {
    test("its manifest holds the record it writes, and what its components read", () => {
        const pages = e3.record("canvas_pages", StudioPagesType, new SortedMap<Key, Entry>([], compareFor(StudioKeyType)));
        const pagesPatch = e3.mutation.patch(pages);
        const surface = ui("canvas_surface", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const components = $.let([revenueTrend, kpiRail]);
            const record = $.let(Record.bind(pages, [pagesPatch]));
            return Studio.Canvas({
                pages: record, components, project: "ops",
                panes: { start: Studio.Palette({ pages: record.read(), components, project: "ops" }) },
            });
        }))));
        const manifest = surface.role.value!;
        assert.deepEqual(manifest.records, ["canvas_pages"]);
        assert.deepEqual(manifest.paths.map(pathKey).sort(), [
            "field:inputs/field:canvas_sales_daily",
            "field:records/field:canvas_pages",
        ]);
    });
});
