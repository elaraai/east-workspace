/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's publish preview (#998): what it shows of the open page — where
 * it stands, the changes from its live version to the layout that publishes,
 * each placement named (E3) — a visual by its view and its source, its
 * configuring said in words (#1669), the page's starting filters first
 * (#1673) — and whether the builder holds unsaved drafts — computed in East;
 * and what refused a publish (E6).
 */

import { ArrayType, East, FloatType, OptionType, none, parseJq, some, variant, type JqNode } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Studio } from "@elaraai/e3-ui";
import { publishRefusal, publishSummary } from "@elaraai/e3-ui/internal";

/** A dataset a component reads. */
const salesDaily = e3.input("publish_sales_daily", ArrayType(FloatType), variant("value", []));

/** The components' code. */
const kpiFn = East.function([], UIComponentType, (_$) => Text.Root("KPIs"));
const trendFn = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const sales = $.let(Data.bind(salesDaily));
    return Text.Root(East.print(sales.read().size()));
})));
const barsFn = East.function([], UIComponentType, (_$) => Text.Root("Bars"));

/** The components the surface lists. */
const kpiRail = Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none" }, kpiFn);
const revenueTrend = Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n }, trendFn);
const breakdownBars = Studio.component("breakdown_bars", { name: "Breakdown bars", category: "Display", icon: "chart-bar", span: 4n }, barsFn);

/** The listed sources' names, by key. */
const SOURCES = new Map([["orders", "Orders"]]);

/** Revenue by month as a column, the same as a line with a second value, a note, and the top regions as a list. */
const byMonth = Studio.visual.group("ordered_at", { bucket: "month" });
const revenueColumn = Studio.visual.of("orders", Studio.visual.column({ x: byMonth, values: [Studio.visual.sum("revenue")] }));
const revenueLine = Studio.visual.of("orders", Studio.visual.line({ x: byMonth, values: [Studio.visual.sum("revenue"), Studio.visual.count()] }));
const lastNight = Studio.visual.text("Figures are to last night.");
const topRegions = Studio.visual.of("orders", Studio.visual.list({ item: Studio.visual.group("region"), values: [Studio.visual.sum("revenue")] }));

/** A jq condition over one row, parsed. */
function jq(text: string): JqNode {
    const parsed = parseJq(text);
    if (parsed.program.type === "none") throw new Error(`does not parse: ${text}`);
    return parsed.program.value;
}

/** Two of a page's starting filters on the orders (#1673). */
const NSW = { key: "f-nsw", source: "orders", where: jq(`.region == "NSW"`) };
const SA = { key: "f-sa", source: "orders", where: jq(`.region == "SA"`) };

describeEast("The publish preview — what it shows (#998)", (test) => {
    test("E3: the changes from the live version to the layout that publishes, each named by its component — ready to publish as the next version", $ => {
        const live = $.const(some({
            version: 3n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "c-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                ],
                filters: [],
            },
        }), OptionType(Studio.Types.Live));
        const layout = $.const({
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                { key: "c-bars", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, content: variant("component", "breakdown_bars") },
            ],
            filters: [],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([kpiRail, revenueTrend, breakdownBars], SOURCES, live, layout, layout, false));
        $(Assert.equal(summary.standing, variant("ready", null)));
        $(Assert.equal(summary.live, some(3n)));
        $(Assert.equal(summary.changes, [
            { change: variant("resized", { cell: "c-trend", content: variant("component", "revenue_trend"), detail: "span 12 → 8" }), name: "Revenue trend" },
            { change: variant("added", { cell: "c-bars", content: variant("component", "breakdown_bars"), detail: "row 2 · span 4" }), name: "Breakdown bars" },
        ]));
        $(Assert.equal(summary.unsaved, false));
    });

    test("E3: a placement is named by its title, else its component's name, else its component's key — one taken off as the live version had it", $ => {
        const live = $.const(some({
            version: 1n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "c-old", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "retired_widget") },
                ],
                filters: [],
            },
        }), OptionType(Studio.Types.Live));
        const layout = $.const({
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: some("Headline numbers"), content: variant("component", "kpi_rail") },
            ],
            filters: [],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([kpiRail], SOURCES, live, layout, layout, false));
        $(Assert.equal(summary.changes.map((_$2, row) => row.name), ["Headline numbers", "retired_widget"]));
        $(Assert.equal(summary.changes.map((_$2, row) => row.change.hasTag("retitled")), [true, false]));
        $(Assert.equal(summary.changes.map((_$2, row) => row.change.hasTag("removed")), [false, true]));
    });

    test("E3: a page never published is its first version — every placement added, no version it replaces", $ => {
        const layout = $.const({
            title: "Detail",
            cells: [
                { key: "d-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "d-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            ],
            filters: [],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([kpiRail, revenueTrend], SOURCES, none, layout, layout, false));
        $(Assert.equal(summary.standing, variant("ready", null)));
        $(Assert.equal(summary.live, none));
        $(Assert.equal(summary.changes, [
            { change: variant("added", { cell: "d-kpi", content: variant("component", "kpi_rail"), detail: "row 1 · span 12" }), name: "KPI rail" },
            { change: variant("added", { cell: "d-trend", content: variant("component", "revenue_trend"), detail: "row 2 · span 8" }), name: "Revenue trend" },
        ]));
    });

    test("#1669: a visual and a text block are named by what they are, or their title; a visual configured since the live version says what changed", $ => {
        const live = $.const(some({
            version: 2n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-revenue", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, content: revenueColumn },
                ],
                filters: [],
            },
        }), OptionType(Studio.Types.Live));
        const layout = $.const({
            title: "Overview",
            cells: [
                { key: "c-revenue", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, content: revenueLine },
                { key: "c-note", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, content: lastNight },
                { key: "c-top", row: "r3", span: 6n, height: none, align: variant("top", null), title: some("Top regions"), content: topRegions },
            ],
            filters: [],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([kpiRail], SOURCES, live, layout, layout, false));
        $(Assert.equal(summary.standing, variant("ready", null)));
        $(Assert.equal(summary.changes.map((_$2, row) => row.name), ["Line chart · Orders", "Text", "Top regions"]));
        $(Assert.equal(summary.changes.map((_$2, row) => row.change.getTag()), ["configured", "added", "added"]));
        $(Assert.equal(summary.changes.get(0n).change.unwrap("configured").detail, "view Column chart → Line chart · values 1 → 2"));
    });

    test("up to date: a live page whose layout is as it went live has nothing to publish", $ => {
        const cells = $.const([
            { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
            { key: "c-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
        ], ArrayType(Studio.Types.Cell));
        const summary = $.let(publishSummary([kpiRail, revenueTrend], SOURCES, some({ version: 4n, page: { title: "Overview", cells, filters: [] } }), { title: "Overview", cells, filters: [] }, { title: "Overview", cells, filters: [] }, false));
        $(Assert.equal(summary.standing, variant("current", null)));
        $(Assert.equal(summary.live, some(4n)));
        $(Assert.equal(summary.changes, []));
    });

    test("unsaved: the layout that publishes holds drafts the page has not saved", $ => {
        const saved = $.const([
            { key: "c-trend", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
        ], ArrayType(Studio.Types.Cell));
        const drawn = $.const({
            title: "Overview",
            cells: [
                { key: "c-trend", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            ],
            filters: [],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([revenueTrend], SOURCES, some({ version: 1n, page: { title: "Overview", cells: saved, filters: [] } }), drawn, { title: "Overview", cells: saved, filters: [] }, false));
        $(Assert.equal(summary.unsaved, true));
        $(Assert.equal(summary.changes.size(), 1n));
    });

    test("#1673: the page's starting filters changed since the live version come first — named by nothing, the preview naming them — saying how many it starts with, or that they changed", $ => {
        const cells = $.const([
            { key: "c-trend", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
        ], ArrayType(Studio.Types.Cell));
        const live = $.const(some({ version: 2n, page: { title: "Overview", cells, filters: [NSW] } }), OptionType(Studio.Types.Live));
        const two = $.const({ title: "Overview", cells, filters: [NSW, SA] }, Studio.Types.Page);
        const added = $.let(publishSummary([revenueTrend], SOURCES, live, two, two, false));
        $(Assert.equal(added.standing, variant("ready", null)));
        $(Assert.equal(added.changes, [{ change: variant("filters", { detail: "1 → 2" }), name: "" }]));
        // As many as it had, another one in place of it: changed.
        const other = $.const({ title: "Overview", cells, filters: [SA] }, Studio.Types.Page);
        const changed = $.let(publishSummary([revenueTrend], SOURCES, live, other, other, false));
        $(Assert.equal(changed.changes, [{ change: variant("filters", { detail: "changed" }), name: "" }]));
        // A page first published with starting filters lists them before its placements.
        const first = $.let(publishSummary([revenueTrend], SOURCES, none, two, two, false));
        $(Assert.equal(first.changes.map((_$2, row) => row.change.getTag()), ["filters", "added"]));
        $(Assert.equal(first.changes.get(0n).change.unwrap("filters").detail, "0 → 2"));
        // As it went live, there is nothing to publish.
        const same = $.const({ title: "Overview", cells, filters: [NSW] }, Studio.Types.Page);
        $(Assert.equal(publishSummary([revenueTrend], SOURCES, live, same, same, false).standing, variant("current", null)));
    });

    test("#1673: unsaved — starting filters the builder draws that the page has not saved, its placements as saved", $ => {
        const cells = $.const([
            { key: "c-trend", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
        ], ArrayType(Studio.Types.Cell));
        const saved = $.const({ title: "Overview", cells, filters: [] }, Studio.Types.Page);
        const drawn = $.const({ title: "Overview", cells, filters: [NSW] }, Studio.Types.Page);
        $(Assert.equal(publishSummary([revenueTrend], SOURCES, none, drawn, saved, false).unsaved, true));
        $(Assert.equal(publishSummary([revenueTrend], SOURCES, none, saved, saved, false).unsaved, false));
    });

    test("a template is not published: no change list", $ => {
        const layout = $.const({
            title: "Ops board",
            cells: [
                { key: "t-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
            ],
            filters: [],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([kpiRail], SOURCES, none, layout, layout, true));
        $(Assert.equal(summary.standing, variant("template", null)));
        $(Assert.equal(summary.live, none));
        $(Assert.equal(summary.changes, []));
    });
}, { platformFns: TestImpl });

describeEast("The publish preview — what refused a publish (#998)", (test) => {
    test("E6: a publish another write overtook says so; a committed one says nothing", $ => {
        $(Assert.equal(publishRefusal(variant("conflict", { attempts: 1n, detail: none })), some("Another write changed this page first — review it and publish again")));
        $(Assert.equal(publishRefusal(variant("committed", { commitHash: "c", stateHash: "s" })), none));
        $(Assert.equal(publishRefusal(variant("timed_out", { ms: 5000n, stderr: "" })), some("The write ran out of time and wrote nothing")));
    });
}, { platformFns: TestImpl });
