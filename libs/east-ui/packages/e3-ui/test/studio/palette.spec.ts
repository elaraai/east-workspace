/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's palette (#994): what its cards and its page list say, computed
 * in East over the listed components and the record — a card's reads, the
 * placed component and its count (B3, B4), a visual or a text block placing
 * none (#1669); the project's pages with their status (B6) — and the names a
 * builder's palette takes from its id.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ArrayType, East, FloatType, SortedMap, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Studio, StudioKeyType, StudioPagesType } from "@elaraai/e3-ui";
import { builderKeys, paletteCards, palettePages } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

/** Two datasets a component reads. */
const salesDaily = e3.input("palette_sales_daily", ArrayType(FloatType), variant("value", []));
const visitsDaily = e3.input("palette_visits_daily", ArrayType(FloatType), variant("value", []));

/** A component that reads both datasets. */
const revenueTrend = Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area" },
    East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const sales = $.let(Data.bind(salesDaily));
        const visits = $.let(Data.bind(visitsDaily));
        return Text.Root(East.print(sales.read().size().add(visits.read().size())));
    }))));

/** A component that reads nothing. */
const note = Studio.component("note", { name: "Note", category: "Display", icon: "note-sticky" },
    East.function([], UIComponentType, (_$) => Text.Root("A note")));

/** A visual over a source, and a text block: neither places a component. */
const salesByRegion = Studio.visual.of("sales", Studio.visual.column({ x: Studio.visual.group("region"), values: [Studio.visual.sum("revenue")] }));
const aNote = Studio.visual.text("Figures are to last night.");

/** The record: the Overview live, the Weekly drafted past its live version, the Detail never published, a template, and another project's page. */
const PAGES = new SortedMap<Key, Entry>([
    [{ project: "ops", page: "a-overview" }, variant("page", {
        draft: { title: "Overview", cells: [], filters: [] },
        live: some({ version: 2n, page: { title: "Overview", cells: [], filters: [] } }),
    })],
    [{ project: "ops", page: "b-weekly" }, variant("page", {
        draft: { title: "Weekly figures", cells: [], filters: [] },
        live: some({ version: 1n, page: { title: "Weekly", cells: [], filters: [] } }),
    })],
    [{ project: "ops", page: "c-detail" }, variant("page", {
        draft: { title: "Detail", cells: [], filters: [] },
        live: none,
    })],
    [{ project: "ops", page: "d-starter" }, variant("template", { title: "Starter", cells: [], filters: [] })],
    [{ project: "retail", page: "home" }, variant("page", {
        draft: { title: "Home", cells: [], filters: [] },
        live: some({ version: 1n, page: { title: "Home", cells: [], filters: [] } }),
    })],
], compareFor(StudioKeyType));

describeEast("The builder's palette — its cards and its pages (#994)", (test) => {
    test("B3: a card's meta names the data its component reads, in words — never their keys; one that reads nothing says so", $ => {
        const cards = $.let(paletteCards([revenueTrend, note], [], none));
        $(Assert.equal(cards.get("revenue_trend").meta, "Palette sales daily · Palette visits daily"));
        $(Assert.equal(cards.get("note").meta, "no data"));
        $(Assert.equal(cards.get("revenue_trend").placed, false));
    });

    test("B4: the selected placement's component is placed, and counts the page's placements of it", $ => {
        const cells = $.let([
            { key: "c-trend-1", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            { key: "c-note", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "note") },
            { key: "c-trend-2", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
        ], ArrayType(Studio.Types.Cell));
        const listed = $.let([revenueTrend, note]);
        const cards = $.let(paletteCards(listed, cells, some("c-trend-2")));
        $(Assert.equal(cards.get("revenue_trend").placed, true));
        $(Assert.equal(cards.get("revenue_trend").meta, "ON CANVAS · ×2"));
        $(Assert.equal(cards.get("note").placed, false));
        $(Assert.equal(cards.get("note").meta, "no data"));
        // A selection no placement holds places nothing.
        const stale = $.let(paletteCards(listed, cells, some("c-gone")));
        $(Assert.equal(stale.get("revenue_trend").placed, false));
    });

    test("#1669: a placement that holds a visual or a text block places no component — it counts for none, and selected, marks no card", $ => {
        const cells = $.let([
            { key: "c-trend", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            { key: "c-chart", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: salesByRegion },
            { key: "c-text", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, content: aNote },
        ], ArrayType(Studio.Types.Cell));
        const listed = $.let([revenueTrend, note]);
        const onChart = $.let(paletteCards(listed, cells, some("c-chart")));
        $(Assert.equal(onChart.get("revenue_trend").placed, false));
        $(Assert.equal(onChart.get("note").placed, false));
        const onText = $.let(paletteCards(listed, cells, some("c-text")));
        $(Assert.equal(onText.get("revenue_trend").placed, false));
        // The component beside them counts its own placement alone.
        const onTrend = $.let(paletteCards(listed, cells, some("c-trend")));
        $(Assert.equal(onTrend.get("revenue_trend").placed, true));
        $(Assert.equal(onTrend.get("revenue_trend").meta, "ON CANVAS · ×1"));
    });

    test("a key two listed components share keeps the first one's card", $ => {
        const cards = $.let(paletteCards([note, Studio.component("note", { name: "Other note", category: "Display", icon: "note-sticky" },
            East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($2) => {
                const sales = $2.let(Data.bind(salesDaily));
                return Text.Root(East.print(sales.read().size()));
            }))))], [], none));
        $(Assert.equal(cards.size(), 1n));
        $(Assert.equal(cards.get("note").meta, "no data"));
    });

    test("B6: the project's pages in key order, with their status; templates and other projects' pages are not listed", $ => {
        const pages = $.let(palettePages(East.value(PAGES, StudioPagesType), "ops"));
        $(Assert.equal(pages.size(), 3n));
        $(Assert.equal(pages.get(0n).page, "a-overview"));
        $(Assert.equal(pages.get(0n).meta, "LIVE · V2"));
        $(Assert.equal(pages.get(0n).live, true));
        $(Assert.equal(pages.get(1n).title, "Weekly figures"));
        $(Assert.equal(pages.get(1n).meta, "DRAFT · V1 LIVE"));
        $(Assert.equal(pages.get(1n).live, false));
        $(Assert.equal(pages.get(2n).meta, "DRAFT"));
        $(Assert.equal(pages.get(2n).live, false));
    });
}, { platformFns: TestImpl });

describe("The builder's names (#994)", () => {
    test("a builder's id names its palette's libraries — its drag sources — and no entry for its open page, which is its host's (#1668)", () => {
        assert.deepEqual(builderKeys(undefined), { components: "studio.components", pages: "studio.pages" });
        assert.deepEqual(builderKeys("north"), { components: "studio.components.north", pages: "studio.pages.north" });
    });
});
