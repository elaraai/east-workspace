/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's pages (#992): each write is one patch of the one entry it
 * writes, and publish and revert are exact (R3); a write drafted on a stale
 * page no longer applies (R2); `Studio.changes` is exact for every layout edit
 * and a retitle (R5); "used in N" counts every page that places a component
 * (R6); a page's status; and each surface's manifest (R4). A publish stamps
 * each placement with the code it goes live with (E4, #998).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";

import {
    ArrayType, East, FloatType, SortedMap, applyFor, compareFor, none, some, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { TreePathType } from "@elaraai/e3-types";
import { Reactive, Stack, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Record, Studio, StudioKeyType, StudioPagesType, ui } from "@elaraai/e3-ui";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type Page = ValueTypeOf<typeof Studio.Types.Page>;

const keys = compareFor(StudioKeyType);
const applyPages = applyFor(StudioPagesType);
const pathKey = (p: ValueTypeOf<typeof TreePathType>) => p.map((s) => `${s.type}:${s.value}`).join("/");

const publish = East.compile(Studio.publish, []);
const revert = East.compile(Studio.revert, []);
const newPage = East.compile(Studio.newPage, []);
const saveTemplate = East.compile(Studio.saveTemplate, []);
const changes = East.compile(Studio.changes, []);
const usage = East.compile(Studio.usage, []);
const status = East.compile(Studio.status, []);

/** The Overview: a KPI rail alone on row 1, a chart and bars on row 2, three tiles on row 3. */
const OVERVIEW: Page = {
    title: "Overview",
    cells: [
        { key: "c-kpi", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
        { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "fp-trend" },
        { key: "c-bars", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, component: "breakdown_bars", fingerprint: "fp-bars" },
        { key: "c-orders", row: "r3", span: 4n, height: none, align: variant("top", null), title: none, component: "orders_by_week", fingerprint: "fp-orders" },
        { key: "c-spark", row: "r3", span: 4n, height: none, align: variant("top", null), title: none, component: "visits_sparkline", fingerprint: "fp-spark" },
        { key: "c-roster", row: "r3", span: 4n, height: none, align: variant("top", null), title: none, component: "shift_roster", fingerprint: "fp-roster" },
    ],
};

/** The Overview's draft once the KPI rail is taken off. */
const EDITED: Page = { title: "Overview", cells: OVERVIEW.cells.slice(1) };

const OVERVIEW_KEY: Key = { project: "ops", page: "overview" };
const TEMPLATE_KEY: Key = { project: "ops", page: "tpl-kpis" };

/** The record: the Overview, never published, and a template. */
const PAGES = new SortedMap<Key, Entry>([
    [OVERVIEW_KEY, variant("page", { draft: OVERVIEW, live: none })],
    [TEMPLATE_KEY, variant("template", {
        title: "KPIs",
        cells: [
            { key: "t-kpi", row: "t1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
        ],
    })],
], keys);

/** The Overview published as version 1, then its draft saved without the KPI rail. */
const SAVED = new SortedMap<Key, Entry>([
    [OVERVIEW_KEY, variant("page", { draft: EDITED, live: some({ version: 1n, page: OVERVIEW }) })],
], keys);

describe("Studio writes (#992)", () => {
    test("R3: a publish is one patch of the page, and its live version is its draft, numbered from 1", () => {
        const patch = publish(PAGES, OVERVIEW_KEY, []);
        if (patch.type !== "patch") assert.fail(`expected a patch by key, got ${patch.type}`);
        assert.deepEqual([...patch.value.entries()].map(([key, op]) => [key, op.type]), [[OVERVIEW_KEY, "update"]], "it touches the page alone");

        const once = applyPages(PAGES, patch);
        assert.deepEqual(once.get(OVERVIEW_KEY), variant("page", { draft: OVERVIEW, live: some({ version: 1n, page: OVERVIEW }) }));
        assert.deepEqual(once.get(TEMPLATE_KEY), PAGES.get(TEMPLATE_KEY), "nothing else changed");

        const again = applyPages(SAVED, publish(SAVED, OVERVIEW_KEY, []));
        assert.deepEqual(again.get(OVERVIEW_KEY), variant("page", { draft: EDITED, live: some({ version: 2n, page: EDITED }) }), "the next publish is version 2");
    });

    test("R3: a revert makes the draft exactly the live version's layout, in one patch of the page", () => {
        const patch = revert(SAVED, OVERVIEW_KEY);
        if (patch.type !== "patch") assert.fail(`expected a patch by key, got ${patch.type}`);
        assert.deepEqual([...patch.value.keys()], [OVERVIEW_KEY]);
        assert.deepEqual(applyPages(SAVED, patch).get(OVERVIEW_KEY), variant("page", { draft: OVERVIEW, live: some({ version: 1n, page: OVERVIEW }) }));
    });

    test("R2: a publish drafted before another landed no longer applies", () => {
        const first = applyPages(PAGES, publish(PAGES, OVERVIEW_KEY, []));
        const stale = publish(PAGES, OVERVIEW_KEY, []);
        assert.throws(() => applyPages(first, stale), /Cannot apply/);
    });

    test("a new page starts from a template's cells, or blank, with no live version, in one inserting patch", () => {
        const key: Key = { project: "ops", page: "detail" };
        const fromTemplate = newPage(PAGES, key, "Detail", some(TEMPLATE_KEY));
        if (fromTemplate.type !== "patch") assert.fail(`expected a patch by key, got ${fromTemplate.type}`);
        assert.deepEqual([...fromTemplate.value.entries()].map(([k, op]) => [k, op.type]), [[key, "insert"]]);
        assert.deepEqual(applyPages(PAGES, fromTemplate).get(key), variant("page", {
            draft: {
                title: "Detail",
                cells: [
                    { key: "t-kpi", row: "t1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                ],
            },
            live: none,
        }));
        assert.deepEqual(applyPages(PAGES, newPage(PAGES, key, "Blank", none)).get(key), variant("page", { draft: { title: "Blank", cells: [] }, live: none }));

        assert.throws(() => newPage(PAGES, OVERVIEW_KEY, "Again", none), /already exists/);
        assert.throws(() => newPage(PAGES, key, "Detail", some(OVERVIEW_KEY)), /is a page, not a template/);
        assert.throws(() => newPage(PAGES, key, "Detail", some({ project: "ops", page: "gone" })), /No template/);
    });

    test("save as template inserts a template of a page's draft, in one patch", () => {
        const key: Key = { project: "ops", page: "tpl-overview" };
        const patch = saveTemplate(SAVED, OVERVIEW_KEY, key, "Overview layout");
        if (patch.type !== "patch") assert.fail(`expected a patch by key, got ${patch.type}`);
        assert.deepEqual([...patch.value.entries()].map(([k, op]) => [k, op.type]), [[key, "insert"]]);
        assert.deepEqual(applyPages(SAVED, patch).get(key), variant("template", { title: "Overview layout", cells: EDITED.cells }));

        assert.throws(() => saveTemplate(PAGES, OVERVIEW_KEY, TEMPLATE_KEY, "Taken"), /already exists/);
        assert.throws(() => saveTemplate(PAGES, TEMPLATE_KEY, key, "From a template"), /is a template, not a page/);
    });

    test("a write names what it cannot write", () => {
        assert.throws(() => publish(PAGES, { project: "ops", page: "gone" }, []), /No page/);
        assert.throws(() => publish(PAGES, TEMPLATE_KEY, []), /is a template, not a page/);
        assert.throws(() => revert(PAGES, OVERVIEW_KEY), /has no published version to revert to/);
    });
});

/** The components a publish stamps: two the surface lists — a third placement's component it does not. */
const stampKpi = Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high" },
    East.function([], UIComponentType, (_$) => Text.Root("KPIs")));
const stampTrend = Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n },
    East.function([], UIComponentType, (_$) => Text.Root("Revenue")));

describeEast("Studio.publish stamps the code a page goes live with (#998)", (test) => {
    test("E4: each placement takes its listed component's fingerprint, in the draft and the live version alike; one the surface does not list keeps its own", $ => {
        const components = $.let([stampKpi, stampTrend]);
        const key = $.const({ project: "ops", page: "overview" }, Studio.Types.Key);
        const pages = $.let(new Map(), Studio.Types.Pages);
        $(pages.insert(key, variant("page", {
            draft: {
                title: "Overview",
                cells: [
                    { key: "c-kpi", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "an older fingerprint" },
                    { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "an older fingerprint" },
                    { key: "c-retired", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, component: "retired_widget", fingerprint: "fp-retired" },
                ],
            },
            live: none,
        })));
        const published = $.let(East.applyPatch(pages, Studio.publish(pages, key, components)).get(key).unwrap("page"));
        $(Assert.equal(published.draft.cells.map((_$2, cell) => cell.fingerprint), [stampKpi.fingerprint, stampTrend.fingerprint, "fp-retired"]));
        $(Assert.equal(published.live.unwrap("some").page, published.draft));
        $(Assert.equal(Studio.status(published), variant("live", null)));
    });
}, { platformFns: TestImpl });

describe("Studio.changes (#992, R5)", () => {
    test("an unchanged page, or one whose components' code changed, has no changes", () => {
        assert.deepEqual(changes(OVERVIEW, OVERVIEW), []);
        assert.deepEqual(changes(OVERVIEW, { ...OVERVIEW, cells: OVERVIEW.cells.map((cell) => ({ ...cell, fingerprint: "fp-next" })) }), []);
    });

    test("a card dropped in a new row is added, with its row and span", () => {
        const after: Page = {
            ...OVERVIEW,
            cells: [
                ...OVERVIEW.cells,
                { key: "c-board", row: "r4", span: 12n, height: none, align: variant("top", null), title: none, component: "assignment_board", fingerprint: "fp-board" },
            ],
        };
        assert.deepEqual(changes(OVERVIEW, after), [variant("added", { cell: "c-board", component: "assignment_board", detail: "row 4 · span 12" })]);
    });

    test("a removed tile is removed, with the row and span it had", () => {
        const after: Page = { ...OVERVIEW, cells: OVERVIEW.cells.filter((cell) => cell.key !== "c-bars") };
        assert.deepEqual(changes(OVERVIEW, after), [variant("removed", { cell: "c-bars", component: "breakdown_bars", detail: "row 2 · span 4" })]);
    });

    test("a tile moved along its row is moved — and the tiles it passed are not", () => {
        const [kpi, trend, bars, orders, spark, roster] = OVERVIEW.cells;
        const after: Page = { ...OVERVIEW, cells: [kpi!, trend!, bars!, spark!, roster!, orders!] };
        assert.deepEqual(changes(OVERVIEW, after), [variant("moved", { cell: "c-orders", component: "orders_by_week", detail: "row 3 · position 1 → 3" })]);
    });

    test("a tile moved into another row is moved — and the row's tiles are not", () => {
        const [kpi, trend, bars, orders, spark, roster] = OVERVIEW.cells;
        const after: Page = { ...OVERVIEW, cells: [kpi!, { ...bars!, row: "r1" }, trend!, orders!, spark!, roster!] };
        assert.deepEqual(changes(OVERVIEW, after), [variant("moved", { cell: "c-bars", component: "breakdown_bars", detail: "row 2 → row 1" })]);
    });

    test("a tile moved into a new row between rows is moved into a new row", () => {
        const [kpi, trend, bars, orders, spark, roster] = OVERVIEW.cells;
        const after: Page = { ...OVERVIEW, cells: [kpi!, { ...trend!, row: "row-1" }, bars!, orders!, spark!, roster!] };
        assert.deepEqual(changes(OVERVIEW, after), [variant("moved", { cell: "c-trend", component: "revenue_trend", detail: "row 2 → new row 2" })]);
    });

    test("a tile alone in its row, moved to another gap, keeps its row and is moved", () => {
        const [kpi, trend, bars, orders, spark, roster] = OVERVIEW.cells;
        const after: Page = { ...OVERVIEW, cells: [trend!, bars!, kpi!, orders!, spark!, roster!] };
        assert.deepEqual(changes(OVERVIEW, after), [variant("moved", { cell: "c-kpi", component: "kpi_rail", detail: "row 1 → row 2" })]);
    });

    test("a span, a height, an alignment and a title each change alone", () => {
        const [kpi, trend, bars, orders, spark, roster] = OVERVIEW.cells;
        assert.deepEqual(changes(OVERVIEW, { ...OVERVIEW, cells: [kpi!, { ...trend!, span: 6n }, bars!, orders!, spark!, roster!] }),
            [variant("resized", { cell: "c-trend", component: "revenue_trend", detail: "span 8 → 6" })]);
        assert.deepEqual(changes(OVERVIEW, { ...OVERVIEW, cells: [kpi!, { ...trend!, height: some(240n) }, bars!, orders!, spark!, roster!] }),
            [variant("height", { cell: "c-trend", component: "revenue_trend", detail: "height auto → 240" })]);
        assert.deepEqual(changes(OVERVIEW, { ...OVERVIEW, cells: [kpi!, trend!, { ...bars!, align: variant("stretch", null) }, orders!, spark!, roster!] }),
            [variant("aligned", { cell: "c-bars", component: "breakdown_bars", detail: "align top → stretch" })]);
        assert.deepEqual(changes(OVERVIEW, { ...OVERVIEW, cells: [kpi!, { ...trend!, title: some("Revenue") }, bars!, orders!, spark!, roster!] }),
            [variant("retitled", { cell: "c-trend", component: "revenue_trend", detail: 'title default → "Revenue"' })]);
    });

    test("a tile moved into a row and fitted to it lists the move and the span, in reading order, then what was removed", () => {
        const [kpi, trend, , orders, spark, roster] = OVERVIEW.cells;
        const after: Page = { ...OVERVIEW, cells: [kpi!, { ...trend!, row: "r1", span: 4n }, orders!, spark!, roster!] };
        assert.deepEqual(changes(OVERVIEW, after), [
            variant("moved", { cell: "c-trend", component: "revenue_trend", detail: "row 2 → row 1" }),
            variant("resized", { cell: "c-trend", component: "revenue_trend", detail: "span 8 → 4" }),
            variant("removed", { cell: "c-bars", component: "breakdown_bars", detail: "row 2 · span 4" }),
        ]);
    });
});

describe("Studio.usage and Studio.status (#992)", () => {
    test("R6: used in N counts each page that places a component, in its draft or its live version, once", () => {
        const pages = new SortedMap<Key, Entry>([
            [OVERVIEW_KEY, variant("page", { draft: EDITED, live: some({ version: 1n, page: OVERVIEW }) })],
            [{ project: "ops", page: "detail" }, variant("page", {
                draft: {
                    title: "Detail",
                    cells: [
                        { key: "d-kpi", row: "d1", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                        { key: "d-kpi-2", row: "d2", span: 12n, height: none, align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "fp-kpi" },
                    ],
                },
                live: none,
            })],
            [TEMPLATE_KEY, variant("template", {
                title: "Board",
                cells: [
                    { key: "t-board", row: "t1", span: 12n, height: none, align: variant("top", null), title: none, component: "assignment_board", fingerprint: "fp-board" },
                ],
            })],
        ], keys);
        assert.deepEqual([...usage(pages).entries()], [
            ["breakdown_bars", 1n], ["kpi_rail", 2n], ["orders_by_week", 1n], ["revenue_trend", 1n], ["shift_roster", 1n], ["visits_sparkline", 1n],
        ]);
    });

    test("a page is live when its draft is its published layout, and a draft otherwise", () => {
        assert.equal(status({ draft: OVERVIEW, live: none }).type, "draft");
        assert.equal(status({ draft: OVERVIEW, live: some({ version: 1n, page: OVERVIEW }) }).type, "live");
        assert.equal(status({ draft: EDITED, live: some({ version: 1n, page: OVERVIEW }) }).type, "draft");
    });
});

describe("Studio surfaces' manifests (#992, R4)", () => {
    const sales = e3.input("studio_pages_sales", ArrayType(FloatType), variant("value", []));
    const visits = e3.input("studio_pages_visits", ArrayType(FloatType), variant("value", []));
    const revenue = Studio.component("revenue", { name: "Revenue", category: "Charts", icon: "chart-area" },
        East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const rows = $.let(Data.bind(sales));
            return Text.Root(East.print(rows.read().size()));
        }))));
    const traffic = Studio.component("traffic", { name: "Traffic", category: "Charts", icon: "chart-line" },
        East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const days = $.let(Data.bind(visits));
            return Text.Root(East.print(days.read().size()));
        }))));
    const pages = e3.record("studio_pages", StudioPagesType, new SortedMap<Key, Entry>([], keys));
    const pagesPatch = e3.mutation.patch(pages);

    test("the builder's holds the record, bound for its patch, and exactly what its components read", () => {
        const builder = ui("studio_builder", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const record = $.let(Record.bind(pages, [pagesPatch]));
            const components = $.let([revenue, traffic]);
            return Stack.VStack([Text.Root(East.print(record.read().size())), Studio.dispatch(components, "revenue")]);
        }))));
        const manifest = builder.role.value!;
        assert.deepEqual(manifest.records, ["studio_pages"]);
        assert.deepEqual(manifest.paths.map(pathKey).sort(), [
            "field:inputs/field:studio_pages_sales", "field:inputs/field:studio_pages_visits", "field:records/field:studio_pages",
        ]);
    });

    test("the site's holds the record and no write, and exactly what its components read", () => {
        const site = ui("studio_site", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const all = $.let(Data.bind(pages));
            const components = $.let([revenue, traffic]);
            return Stack.VStack([Text.Root(East.print(all.read().size())), Studio.dispatch(components, "traffic")]);
        }))));
        const manifest = site.role.value!;
        assert.deepEqual(manifest.records, []);
        assert.deepEqual(manifest.paths.map(pathKey).sort(), [
            "field:inputs/field:studio_pages_sales", "field:inputs/field:studio_pages_visits", "field:records/field:studio_pages",
        ]);
    });
});
