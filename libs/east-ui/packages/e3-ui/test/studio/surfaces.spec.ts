/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Page>` and `<Studio.Site>` (#993): a page draws its live or draft
 * layout on the SnapGrid — a frameless component bare, a tile named by its
 * title or its component (F5) — and says so when it has no such layout; a
 * site's surface reads the record and writes nothing, and holds exactly what
 * its components read.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, East, FloatType, SortedMap, compareFor, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { TreePathType } from "@elaraai/e3-types";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Studio, StudioKeyType, StudioPagesType, ui } from "@elaraai/e3-ui";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type UI = ValueTypeOf<typeof UIComponentType>;
type Cell = { key: string; frame: boolean; label: { type: string; value?: string }; content: UI };

const keys = compareFor(StudioKeyType);
const pathKey = (p: ValueTypeOf<typeof TreePathType>) => p.map((s) => `${s.type}:${s.value}`).join("/");

/** The record: the Overview live and drafted, the Detail a draft, and a template. */
const PAGES = new SortedMap<Key, Entry>([
    [{ project: "ops", page: "overview" }, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                { key: "c-note", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, component: "note", fingerprint: "" },
            ],
        },
        live: some({
            version: 1n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                    { key: "c-note", row: "r2", span: 6n, height: some(240n), align: variant("stretch", null), title: some("A note"), component: "note", fingerprint: "" },
                    { key: "c-gone", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, component: "retired", fingerprint: "" },
                ],
            },
        }),
    })],
    [{ project: "ops", page: "detail" }, variant("page", {
        draft: { title: "Detail", cells: [] },
        live: none,
    })],
    [{ project: "ops", page: "tpl" }, variant("template", {
        title: "Template",
        cells: [
            { key: "t-note", row: "t1", span: 12n, height: none, align: variant("top", null), title: none, component: "note", fingerprint: "" },
        ],
    })],
], keys);

/** A page drawn from {@link PAGES}, with a frameless KPI rail and a framed note listed. */
const drawn = East.compile(East.function([StudioKeyType, Studio.Types.Version], UIComponentType, ($, page, version) => {
    const components = $.let([
        Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none" },
            East.function([], UIComponentType, (_$) => Text.Root("KPIs"))),
        Studio.component("note", { name: "Note", category: "Display", icon: "note-sticky" },
            East.function([], UIComponentType, (_$) => Text.Root("A note's text"))),
    ]);
    return Studio.Page({ pages: East.value(PAGES, StudioPagesType), components, page, version });
}), []) as (page: Key, version: ValueTypeOf<typeof Studio.Types.Version>) => UI;

describe("<Studio.Page> (#993)", () => {
    test("draws the live layout on the SnapGrid: its cells in order, where they sit", () => {
        const ui = drawn({ project: "ops", page: "overview" }, variant("live", null));
        assert.equal(ui.type, "SnapGrid");
        const grid = ui.value as { cells: (Cell & { row: string; span: bigint; height: unknown; align: { type: string } })[] };
        assert.deepEqual(grid.cells.map((c) => [c.key, c.row, c.span, c.align.type]), [
            ["c-kpi", "r1", 12n, "top"], ["c-note", "r2", 6n, "stretch"], ["c-gone", "r2", 6n, "top"],
        ]);
        assert.deepEqual(grid.cells[1]!.height, some(240n));
    });

    test("F5: a frameless component is bare; a tile is named by its title, else its component", () => {
        const grid = drawn({ project: "ops", page: "overview" }, variant("live", null)).value as { cells: Cell[] };
        assert.deepEqual(grid.cells.map((c) => c.frame), [false, true, true]);
        assert.deepEqual(grid.cells.map((c) => c.label), [some("KPI rail"), some("A note"), none]);
        // A component the surface does not list is its placeholder, in a tile.
        assert.equal(grid.cells[2]!.content.type, "EmptyState");
    });

    test("draws the draft when asked, and a template either way", () => {
        const draft = drawn({ project: "ops", page: "overview" }, variant("draft", null)).value as { cells: Cell[] };
        assert.deepEqual(draft.cells.map((c) => [c.key, c.label]), [["c-kpi", some("KPI rail")], ["c-note", some("Note")]]);
        const template = drawn({ project: "ops", page: "tpl" }, variant("live", null)).value as { cells: Cell[] };
        assert.deepEqual(template.cells.map((c) => c.key), ["t-note"]);
    });

    test("says a page is not published, and names a page the record does not hold", () => {
        const unpublished = drawn({ project: "ops", page: "detail" }, variant("live", null));
        assert.equal(unpublished.type, "EmptyState");
        const title = (unpublished.value as { title: UI }).title;
        assert.equal((title.value as { value: string }).value, "detail is not published yet");
        const missing = drawn({ project: "ops", page: "gone" }, variant("live", null));
        assert.equal(missing.type, "EmptyState");
        assert.equal(((missing.value as { title: UI }).title.value as { value: string }).value, "No page gone");
    });
});

describe("<Studio.Site> (#993)", () => {
    test("its surface's manifest holds the record's path and no write, and exactly what its components read", () => {
        const visits = e3.input("studio_site_visits", ArrayType(FloatType), variant("value", []));
        const pages = e3.record("studio_site_record", StudioPagesType, new SortedMap<Key, Entry>([], keys));
        const site = ui("studio_site_surface", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const components = $.let([
                Studio.component("traffic", { name: "Traffic", category: "Charts", icon: "chart-line" },
                    East.function([], UIComponentType, (_$2) => Reactive.Root(East.function([], UIComponentType, ($2) => {
                        const days = $2.let(Data.bind(visits));
                        return Text.Root(East.print(days.read().size()));
                    })))),
            ]);
            const all = $.let(Data.bind(pages));
            return Studio.Site({ pages: all.read(), components, project: "ops" });
        }))));
        const manifest = site.role.value!;
        assert.deepEqual(manifest.records, []);
        assert.deepEqual(manifest.paths.map(pathKey).sort(), ["field:inputs/field:studio_site_visits", "field:records/field:studio_site_record"]);
    });

    test("it is a Reactive over an App", () => {
        const value = East.compile(East.function([], UIComponentType, ($) => {
            const components = $.let([
                Studio.component("note", { name: "Note", category: "Display", icon: "note-sticky" },
                    East.function([], UIComponentType, (_$) => Text.Root("A note's text"))),
            ]);
            return Studio.Site({ pages: East.value(PAGES, StudioPagesType), components, project: "ops" });
        }), [])();
        assert.equal(value.type, "ReactiveComponent");
    });
});
