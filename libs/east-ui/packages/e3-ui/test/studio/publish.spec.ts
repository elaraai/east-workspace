/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Publish>` (#998): what the preview shows of the open page — where
 * it stands, the changes from its live version to the layout that publishes,
 * each placement named (E3), the components whose code changed since it went
 * live (E4), and whether the canvas holds unsaved drafts — computed in East;
 * what refused a publish (E6); and the builder surface it completes.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ArrayType, East, FloatType, OptionType, SortedMap, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { TreePathType } from "@elaraai/e3-types";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Record, Studio, StudioKeyType, StudioPagesType, ui } from "@elaraai/e3-ui";
import { fingerprintOf, publishRefusal, publishSummary } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

const pathKey = (p: ValueTypeOf<typeof TreePathType>) => p.map((s) => `${s.type}:${s.value}`).join("/");

/** A dataset a component reads. */
const salesDaily = e3.input("publish_sales_daily", ArrayType(FloatType), variant("value", []));

/** The components' code — the fingerprints a live version's cells store. */
const kpiFn = East.function([], UIComponentType, (_$) => Text.Root("KPIs"));
const trendFn = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const sales = $.let(Data.bind(salesDaily));
    return Text.Root(East.print(sales.read().size()));
})));
const barsFn = East.function([], UIComponentType, (_$) => Text.Root("Bars"));
const kpiPrint = fingerprintOf(kpiFn);
const trendPrint = fingerprintOf(trendFn);
const barsPrint = fingerprintOf(barsFn);

/** The components the surface lists. */
const kpiRail = Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none" }, kpiFn);
const revenueTrend = Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n }, trendFn);
const breakdownBars = Studio.component("breakdown_bars", { name: "Breakdown bars", category: "Display", icon: "chart-bar", span: 4n }, barsFn);

describeEast("<Studio.Publish> — what the preview shows (#998)", (test) => {
    test("E3: the changes from the live version to the layout that publishes, each named by its component — ready to publish as the next version", $ => {
        const live = $.const(some({
            version: 3n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: kpiPrint },
                    { key: "c-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: trendPrint },
                ],
            },
        }), OptionType(Studio.Types.Live));
        const layout = $.const({
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: kpiPrint },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: trendPrint },
                { key: "c-bars", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, component: "breakdown_bars", fingerprint: barsPrint },
            ],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([kpiRail, revenueTrend, breakdownBars], live, layout, layout.cells, false));
        $(Assert.equal(summary.standing, variant("ready", null)));
        $(Assert.equal(summary.live, some(3n)));
        $(Assert.equal(summary.changes, [
            { change: variant("resized", { cell: "c-trend", component: "revenue_trend", detail: "span 12 → 8" }), name: "Revenue trend" },
            { change: variant("added", { cell: "c-bars", component: "breakdown_bars", detail: "row 2 · span 4" }), name: "Breakdown bars" },
        ]));
        $(Assert.equal(summary.changed, []));
        $(Assert.equal(summary.unsaved, false));
    });

    test("E3: a placement is named by its title, else its component's name, else its component's key — one taken off as the live version had it", $ => {
        const live = $.const(some({
            version: 1n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: kpiPrint },
                    { key: "c-old", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "retired_widget", fingerprint: "fp-retired" },
                ],
            },
        }), OptionType(Studio.Types.Live));
        const layout = $.const({
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: some("Headline numbers"), component: "kpi_rail", fingerprint: kpiPrint },
            ],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([kpiRail], live, layout, layout.cells, false));
        $(Assert.equal(summary.changes.map((_$2, row) => row.name), ["Headline numbers", "retired_widget"]));
        $(Assert.equal(summary.changes.map((_$2, row) => row.change.hasTag("retitled")), [true, false]));
        $(Assert.equal(summary.changes.map((_$2, row) => row.change.hasTag("removed")), [false, true]));
    });

    test("E3: a page never published is its first version — every placement added, no version it replaces", $ => {
        const layout = $.const({
            title: "Detail",
            cells: [
                { key: "d-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                { key: "d-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            ],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([kpiRail, revenueTrend], none, layout, layout.cells, false));
        $(Assert.equal(summary.standing, variant("ready", null)));
        $(Assert.equal(summary.live, none));
        $(Assert.equal(summary.changes, [
            { change: variant("added", { cell: "d-kpi", component: "kpi_rail", detail: "row 1 · span 12" }), name: "KPI rail" },
            { change: variant("added", { cell: "d-trend", component: "revenue_trend", detail: "row 2 · span 8" }), name: "Revenue trend" },
        ]));
        $(Assert.equal(summary.changed, []));
    });

    test("E4: the components whose code changed since the live version, once each, in the order they are placed — a layout unchanged is still ready; a component not listed never counts", $ => {
        const cells = $.const([
            { key: "c-trend", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "an older fingerprint" },
            { key: "c-bars", row: "r1", span: 4n, height: none, align: variant("top", null), title: none, component: "breakdown_bars", fingerprint: "an older fingerprint" },
            { key: "c-trend-2", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "an older fingerprint" },
            { key: "c-kpi", row: "r3", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: kpiPrint },
            { key: "c-old", row: "r4", span: 12n, height: none, align: variant("top", null), title: none, component: "retired_widget", fingerprint: "an older fingerprint" },
        ], ArrayType(Studio.Types.Cell));
        const live = $.const(some({ version: 2n, page: { title: "Overview", cells } }), OptionType(Studio.Types.Live));
        const layout = $.const({ title: "Overview", cells }, Studio.Types.Page);
        const summary = $.let(publishSummary([kpiRail, revenueTrend, breakdownBars], live, layout, cells, false));
        $(Assert.equal(summary.changes, []));
        $(Assert.equal(summary.changed, ["Revenue trend", "Breakdown bars"]));
        $(Assert.equal(summary.standing, variant("ready", null)));
    });

    test("E4: a component placed anew beside a live placement of it whose code changed counts; one the live version does not place does not", $ => {
        const live = $.const(some({
            version: 1n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-trend", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "an older fingerprint" },
                ],
            },
        }), OptionType(Studio.Types.Live));
        const layout = $.const({
            title: "Overview",
            cells: [
                { key: "c-trend", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "an older fingerprint" },
                { key: "c-bars", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, component: "breakdown_bars", fingerprint: "an older fingerprint" },
            ],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([revenueTrend, breakdownBars], live, layout, layout.cells, false));
        $(Assert.equal(summary.changed, ["Revenue trend"]));
    });

    test("up to date: a live page whose layout and code are as they went live has nothing to publish", $ => {
        const cells = $.const([
            { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: kpiPrint },
            { key: "c-trend", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: trendPrint },
        ], ArrayType(Studio.Types.Cell));
        const summary = $.let(publishSummary([kpiRail, revenueTrend], some({ version: 4n, page: { title: "Overview", cells } }), { title: "Overview", cells }, cells, false));
        $(Assert.equal(summary.standing, variant("current", null)));
        $(Assert.equal(summary.live, some(4n)));
        $(Assert.equal(summary.changes, []));
        $(Assert.equal(summary.changed, []));
    });

    test("unsaved: the layout that publishes holds drafts the page has not saved", $ => {
        const saved = $.const([
            { key: "c-trend", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: trendPrint },
        ], ArrayType(Studio.Types.Cell));
        const drawn = $.const({
            title: "Overview",
            cells: [
                { key: "c-trend", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: trendPrint },
            ],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([revenueTrend], some({ version: 1n, page: { title: "Overview", cells: saved } }), drawn, saved, false));
        $(Assert.equal(summary.unsaved, true));
        $(Assert.equal(summary.changes.size(), 1n));
    });

    test("a template is not published: no change list, and nothing changed", $ => {
        const layout = $.const({
            title: "Ops board",
            cells: [
                { key: "t-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "an older fingerprint" },
            ],
        }, Studio.Types.Page);
        const summary = $.let(publishSummary([kpiRail], none, layout, layout.cells, true));
        $(Assert.equal(summary.standing, variant("template", null)));
        $(Assert.equal(summary.live, none));
        $(Assert.equal(summary.changes, []));
        $(Assert.equal(summary.changed, []));
    });
}, { platformFns: TestImpl });

describeEast("<Studio.Publish> — what refused a publish (#998)", (test) => {
    test("E6: a publish another write overtook says so; a committed one says nothing", $ => {
        $(Assert.equal(publishRefusal(variant("conflict", { attempts: 1n, detail: none })), some("Another write changed this page first — review it and publish again")));
        $(Assert.equal(publishRefusal(variant("committed", { commitHash: "c", stateHash: "s" })), none));
        $(Assert.equal(publishRefusal(variant("timed_out", { ms: 5000n, stderr: "" })), some("The write ran out of time and wrote nothing")));
    });
}, { platformFns: TestImpl });

describe("<Studio.Publish> — the builder surface (#998)", () => {
    test("with the builder's screens, its manifest holds the record it writes, and what its components read", () => {
        const pages = e3.record("publish_pages", StudioPagesType, new SortedMap<Key, Entry>([], compareFor(StudioKeyType)));
        const pagesPatch = e3.mutation.patch(pages);
        const surface = ui("publish_surface", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const components = $.let([kpiRail, revenueTrend]);
            const record = $.let(Record.bind(pages, [pagesPatch]));
            return Studio.Publish({ pages: record, components, project: "ops", env: "Staging", audience: "Field ops · 24 users", rollout: "Immediate" });
        }))));
        const manifest = surface.role.value!;
        assert.deepEqual(manifest.records, ["publish_pages"]);
        assert.deepEqual(manifest.paths.map(pathKey).sort(), [
            "field:inputs/field:publish_sales_daily",
            "field:records/field:publish_pages",
        ]);
    });
});
