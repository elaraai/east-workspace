/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Palette>` (#994): what its cards and its page list say, computed in
 * East over the listed components and the record — a card's reads, the placed
 * component and its count (B3, B4); the project's pages with their status
 * (B6) — the keys the builder's screens share, and the surface's manifest.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ArrayType, East, FloatType, SortedMap, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { TreePathType } from "@elaraai/e3-types";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Studio, StudioKeyType, StudioPagesType, ui } from "@elaraai/e3-ui";
import { builderKeys, paletteCards, palettePages } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

const pathKey = (p: ValueTypeOf<typeof TreePathType>) => p.map((s) => `${s.type}:${s.value}`).join("/");

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

/** The record: the Overview live, the Weekly drafted past its live version, the Detail never published, a template, and another project's page. */
const PAGES = new SortedMap<Key, Entry>([
    [{ project: "ops", page: "a-overview" }, variant("page", {
        draft: { title: "Overview", cells: [] },
        live: some({ version: 2n, page: { title: "Overview", cells: [] } }),
    })],
    [{ project: "ops", page: "b-weekly" }, variant("page", {
        draft: { title: "Weekly figures", cells: [] },
        live: some({ version: 1n, page: { title: "Weekly", cells: [] } }),
    })],
    [{ project: "ops", page: "c-detail" }, variant("page", {
        draft: { title: "Detail", cells: [] },
        live: none,
    })],
    [{ project: "ops", page: "d-starter" }, variant("template", { title: "Starter", cells: [] })],
    [{ project: "retail", page: "home" }, variant("page", {
        draft: { title: "Home", cells: [] },
        live: some({ version: 1n, page: { title: "Home", cells: [] } }),
    })],
], compareFor(StudioKeyType));

describeEast("<Studio.Palette> — its cards and its pages (#994)", (test) => {
    test("B3: a card's meta names the datasets its component reads; one that reads nothing says so", $ => {
        const cards = $.let(paletteCards([revenueTrend, note], [], none));
        $(Assert.equal(cards.get("revenue_trend").meta, "palette_sales_daily · palette_visits_daily"));
        $(Assert.equal(cards.get("note").meta, "no data"));
        $(Assert.equal(cards.get("revenue_trend").placed, false));
    });

    test("B4: the selected placement's component is placed, and counts the page's placements of it", $ => {
        const cells = $.let([
            { key: "c-trend-1", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            { key: "c-note", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, component: "note", fingerprint: "" },
            { key: "c-trend-2", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
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

describe("<Studio.Palette> — the builder's keys and the surface (#994)", () => {
    test("the builder's screens share their keys by the builder's id", () => {
        assert.deepEqual(builderKeys(undefined), {
            page: "studio.builder.page", ui: "studio.builder.ui", view: "studio.builder.view",
            components: "studio.components", pages: "studio.pages",
        });
        assert.deepEqual(builderKeys("north"), {
            page: "studio.builder.north.page", ui: "studio.builder.north.ui", view: "studio.builder.north.view",
            components: "studio.components.north", pages: "studio.pages.north",
        });
    });

    test("its surface's manifest holds the record's path, no write, and what its components read", () => {
        const pages = e3.record("palette_pages", StudioPagesType, new SortedMap<Key, Entry>([], compareFor(StudioKeyType)));
        const surface = ui("palette_surface", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const components = $.let([revenueTrend, note]);
            const all = $.let(Data.bind(pages));
            return Studio.Palette({ pages: all.read(), components, project: "ops" });
        }))));
        const manifest = surface.role.value!;
        assert.deepEqual(manifest.records, []);
        assert.deepEqual(manifest.paths.map(pathKey).sort(), [
            "field:inputs/field:palette_sales_daily",
            "field:inputs/field:palette_visits_daily",
            "field:records/field:palette_pages",
        ]);
    });

    test("it is a Reactive", () => {
        const value = East.compile(East.function([], UIComponentType, ($) => {
            const components = $.let([note]);
            return Studio.Palette({ pages: East.value(PAGES, StudioPagesType), components, project: "ops" });
        }), [])();
        assert.equal(value.type, "ReactiveComponent");
    });
});
