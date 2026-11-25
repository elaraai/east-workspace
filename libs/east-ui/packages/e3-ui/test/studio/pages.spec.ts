/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's pages (#992): each write is one patch of the one entry it
 * writes, and publish and revert are exact (R3); a write drafted on a stale
 * page no longer applies (R2); `Studio.changes` is exact for every layout edit
 * and a retitle (R5), for a placement whose content changed (#1669), and for
 * the page's starting filters (#1673), which a template and a new page from it
 * carry; and a page's status. An entry holds what it is, its project, its
 * title and its tags beside its layout (#1759): every write builds it so, and
 * `Studio.value` writes the entries a solution ships the same way. Each
 * surface's manifest (R4) is its own spec's.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    East, SortedSet, StringType, applyFor, compareFor, equalFor, none, parseJq, printFor, some, variant,
    type JqNode, type ValueTypeOf,
} from "@elaraai/east";

import { Studio, StudioPagesType } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;
type Page = ValueTypeOf<typeof Studio.Types.Page>;

const applyPages = applyFor(StudioPagesType);
const sameEntry = equalFor(Studio.Types.Entry);
const printEntry = printFor(Studio.Types.Entry);
const sameTags = equalFor(Studio.Types.Entry.fields.tags);

/** Tags, as an entry holds them. */
const tagged = (...tags: string[]): Entry["tags"] => new SortedSet(tags, compareFor(StringType));

/** A page as the record holds it, each field written out: what a write is held to. */
const pageEntry = (key: Key, draft: Page, live: Entry["live"] = none, tags: Entry["tags"] = tagged()): Entry =>
    ({ kind: variant("page", null), project: key.project, title: draft.title, tags, draft, live });

/** A template as the record holds it, each field written out. */
const templateEntry = (key: Key, layout: Page, tags: Entry["tags"] = tagged()): Entry =>
    ({ kind: variant("template", null), project: key.project, title: layout.title, tags, draft: layout, live: none });

/** Holds the entry a write left to the one expected, field for field. */
function assertEntry(actual: Entry | undefined, expected: Entry, message?: string): void {
    if (actual === undefined) assert.fail(`${message ?? "the entry"}: the record holds none`);
    assert.ok(sameEntry(actual, expected), `${message ?? "the entry"}: got ${printEntry(actual)}, expected ${printEntry(expected)}`);
}

const publish = East.compile(Studio.publish, []);
const revert = East.compile(Studio.revert, []);
const newPage = East.compile(Studio.newPage, []);
const saveTemplate = East.compile(Studio.saveTemplate, []);
const changesOf = East.compile(Studio.changes, []);
/** The listed sources' names, by key: what a visual's source is called in a change's words. */
const SOURCES = new Map([["orders", "Orders"], ["assets", "Assets"]]);
/** The listed components' names, by key: what a component is called in a change's words. */
const COMPONENTS = new Map([["kpi_rail", "KPI rail"], ["revenue_trend", "Revenue trend"]]);
/** The changes from one layout to another, over the listed sources and components. */
const changes = (before: Page, after: Page) => changesOf(before, after, SOURCES, COMPONENTS);
const status = East.compile(Studio.status, []);

/** A jq condition over one row, parsed. */
function jq(text: string): JqNode {
    const parsed = parseJq(text);
    if (parsed.program.type === "none") assert.fail(`does not parse: ${text}`);
    return parsed.program.value;
}

/** A starting filter on the orders: New South Wales's (#1673). */
const NSW = { key: "f-nsw", source: "orders", where: jq(`.region == "NSW"`) };

/** The Overview: a KPI rail alone on row 1, a chart and bars on row 2, three tiles on row 3. */
const OVERVIEW: Page = {
    title: "Overview",
    cells: [
        { key: "c-kpi", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
        { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
        { key: "c-bars", row: "r2", span: 4n, height: none, align: variant("top", null), title: none, content: variant("component", "breakdown_bars") },
        { key: "c-orders", row: "r3", span: 4n, height: none, align: variant("top", null), title: none, content: variant("component", "orders_by_week") },
        { key: "c-spark", row: "r3", span: 4n, height: none, align: variant("top", null), title: none, content: variant("component", "visits_sparkline") },
        { key: "c-roster", row: "r3", span: 4n, height: none, align: variant("top", null), title: none, content: variant("component", "shift_roster") },
    ],
    filters: [],
};

/** The Overview's draft once the KPI rail is taken off, and its readers start on New South Wales. */
const EDITED: Page = { title: "Overview", cells: OVERVIEW.cells.slice(1), filters: [NSW] };

const OVERVIEW_KEY: Key = { project: "ops", page: "overview" };
const TEMPLATE_KEY: Key = { project: "ops", page: "tpl-kpis" };

/** The template's layout: a KPI rail, its readers starting on New South Wales. */
const KPIS: Page = {
    title: "KPIs",
    cells: [
        { key: "t-kpi", row: "t1", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
    ],
    filters: [NSW],
};

/** The record: the Overview, never published and tagged, and a template. */
const PAGES = Studio.value([
    { key: OVERVIEW_KEY, draft: OVERVIEW, tags: ["weekly"] },
    { key: TEMPLATE_KEY, template: KPIS },
]);

/** The Overview published as version 1, then its draft saved without the KPI rail. */
const SAVED = Studio.value([
    { key: OVERVIEW_KEY, draft: EDITED, live: { version: 1n, page: OVERVIEW }, tags: ["weekly"] },
]);

describe("Studio writes (#992)", () => {
    test("R3: a publish is one patch of the page, and its live version is its draft, numbered from 1", () => {
        const patch = publish(PAGES, OVERVIEW_KEY);
        if (patch.type !== "patch") assert.fail(`expected a patch by key, got ${patch.type}`);
        assert.deepEqual([...patch.value.entries()].map(([key, op]) => [key, op.type]), [[OVERVIEW_KEY, "update"]], "it touches the page alone");

        const once = applyPages(PAGES, patch);
        assertEntry(once.get(OVERVIEW_KEY), pageEntry(OVERVIEW_KEY, OVERVIEW, some({ version: 1n, page: OVERVIEW }), tagged("weekly")), "its fields and its tags as they were");
        assertEntry(once.get(TEMPLATE_KEY), templateEntry(TEMPLATE_KEY, KPIS), "nothing else changed");

        const again = applyPages(SAVED, publish(SAVED, OVERVIEW_KEY));
        assertEntry(again.get(OVERVIEW_KEY), pageEntry(OVERVIEW_KEY, EDITED, some({ version: 2n, page: EDITED }), tagged("weekly")), "the next publish is version 2");
    });

    test("R3: a revert makes the draft exactly the live version's layout, in one patch of the page", () => {
        const patch = revert(SAVED, OVERVIEW_KEY);
        if (patch.type !== "patch") assert.fail(`expected a patch by key, got ${patch.type}`);
        assert.deepEqual([...patch.value.keys()], [OVERVIEW_KEY]);
        assertEntry(applyPages(SAVED, patch).get(OVERVIEW_KEY), pageEntry(OVERVIEW_KEY, OVERVIEW, some({ version: 1n, page: OVERVIEW }), tagged("weekly")));
    });

    test("#1759: a revert to a version under another title takes its title too — an entry's title is its layout's", () => {
        const renamed = Studio.value([{ key: OVERVIEW_KEY, draft: { ...EDITED, title: "Overview, drafted" }, live: { version: 1n, page: OVERVIEW } }]);
        assert.equal(renamed.get(OVERVIEW_KEY)?.title, "Overview, drafted");
        assertEntry(applyPages(renamed, revert(renamed, OVERVIEW_KEY)).get(OVERVIEW_KEY), pageEntry(OVERVIEW_KEY, OVERVIEW, some({ version: 1n, page: OVERVIEW })));
    });

    test("R2: a publish drafted before another landed no longer applies", () => {
        const first = applyPages(PAGES, publish(PAGES, OVERVIEW_KEY));
        const stale = publish(PAGES, OVERVIEW_KEY);
        assert.throws(() => applyPages(first, stale), /Cannot apply/);
    });

    test("a new page starts from a template's cells and starting filters, or blank, with no live version and no tags, under its key's project and the title given, in one inserting patch", () => {
        const key: Key = { project: "ops", page: "detail" };
        const fromTemplate = newPage(PAGES, key, "Detail", some(TEMPLATE_KEY));
        if (fromTemplate.type !== "patch") assert.fail(`expected a patch by key, got ${fromTemplate.type}`);
        assert.deepEqual([...fromTemplate.value.entries()].map(([k, op]) => [k, op.type]), [[key, "insert"]]);
        assertEntry(applyPages(PAGES, fromTemplate).get(key), pageEntry(key, { title: "Detail", cells: KPIS.cells, filters: [NSW] }));
        assertEntry(applyPages(PAGES, newPage(PAGES, key, "Blank", none)).get(key), pageEntry(key, { title: "Blank", cells: [], filters: [] }));

        assert.throws(() => newPage(PAGES, OVERVIEW_KEY, "Again", none), /already exists/);
        assert.throws(() => newPage(PAGES, key, "Detail", some(OVERVIEW_KEY)), /is a page, not a template/);
        assert.throws(() => newPage(PAGES, key, "Detail", some({ project: "ops", page: "gone" })), /No template/);
    });

    test("save as template inserts a template of a page's draft — its placements and its starting filters, with no tags of the page's — in one patch", () => {
        const key: Key = { project: "ops", page: "tpl-overview" };
        const patch = saveTemplate(SAVED, OVERVIEW_KEY, key, "Overview layout");
        if (patch.type !== "patch") assert.fail(`expected a patch by key, got ${patch.type}`);
        assert.deepEqual([...patch.value.entries()].map(([k, op]) => [k, op.type]), [[key, "insert"]]);
        assertEntry(applyPages(SAVED, patch).get(key), templateEntry(key, { title: "Overview layout", cells: EDITED.cells, filters: [NSW] }));

        assert.throws(() => saveTemplate(PAGES, OVERVIEW_KEY, TEMPLATE_KEY, "Taken"), /already exists/);
        assert.throws(() => saveTemplate(PAGES, TEMPLATE_KEY, key, "From a template"), /is a template, not a page/);
    });

    test("a write names what it cannot write", () => {
        assert.throws(() => publish(PAGES, { project: "ops", page: "gone" }), /No page/);
        assert.throws(() => publish(PAGES, TEMPLATE_KEY), /is a template, not a page/);
        assert.throws(() => revert(PAGES, OVERVIEW_KEY), /has no published version to revert to/);
    });
});

describe("Studio.changes (#992, R5)", () => {
    test("an unchanged page has no changes", () => {
        assert.deepEqual(changes(OVERVIEW, OVERVIEW), []);
    });

    test("a card dropped in a new row is added, with its row and span", () => {
        const after: Page = {
            ...OVERVIEW,
            cells: [
                ...OVERVIEW.cells,
                { key: "c-board", row: "r4", span: 12n, height: none, align: variant("top", null), title: none, content: variant("component", "assignment_board") },
            ],
        };
        assert.deepEqual(changes(OVERVIEW, after), [variant("added", { cell: "c-board", content: variant("component", "assignment_board"), detail: "row 4 · span 12" })]);
    });

    test("a removed tile is removed, with the row and span it had", () => {
        const after: Page = { ...OVERVIEW, cells: OVERVIEW.cells.filter((cell) => cell.key !== "c-bars") };
        assert.deepEqual(changes(OVERVIEW, after), [variant("removed", { cell: "c-bars", content: variant("component", "breakdown_bars"), detail: "row 2 · span 4" })]);
    });

    test("a tile moved along its row is moved — and the tiles it passed are not", () => {
        const [kpi, trend, bars, orders, spark, roster] = OVERVIEW.cells;
        const after: Page = { ...OVERVIEW, cells: [kpi!, trend!, bars!, spark!, roster!, orders!] };
        assert.deepEqual(changes(OVERVIEW, after), [variant("moved", { cell: "c-orders", content: variant("component", "orders_by_week"), detail: "row 3 · position 1 → 3" })]);
    });

    test("a tile moved into another row is moved — and the row's tiles are not", () => {
        const [kpi, trend, bars, orders, spark, roster] = OVERVIEW.cells;
        const after: Page = { ...OVERVIEW, cells: [kpi!, { ...bars!, row: "r1" }, trend!, orders!, spark!, roster!] };
        assert.deepEqual(changes(OVERVIEW, after), [variant("moved", { cell: "c-bars", content: variant("component", "breakdown_bars"), detail: "row 2 → row 1" })]);
    });

    test("a tile moved into a new row between rows is moved into a new row", () => {
        const [kpi, trend, bars, orders, spark, roster] = OVERVIEW.cells;
        const after: Page = { ...OVERVIEW, cells: [kpi!, { ...trend!, row: "row-1" }, bars!, orders!, spark!, roster!] };
        assert.deepEqual(changes(OVERVIEW, after), [variant("moved", { cell: "c-trend", content: variant("component", "revenue_trend"), detail: "row 2 → new row 2" })]);
    });

    test("a tile alone in its row, moved to another gap, keeps its row and is moved", () => {
        const [kpi, trend, bars, orders, spark, roster] = OVERVIEW.cells;
        const after: Page = { ...OVERVIEW, cells: [trend!, bars!, kpi!, orders!, spark!, roster!] };
        assert.deepEqual(changes(OVERVIEW, after), [variant("moved", { cell: "c-kpi", content: variant("component", "kpi_rail"), detail: "row 1 → row 2" })]);
    });

    test("a span, a height, an alignment and a title each change alone", () => {
        const [kpi, trend, bars, orders, spark, roster] = OVERVIEW.cells;
        assert.deepEqual(changes(OVERVIEW, { ...OVERVIEW, cells: [kpi!, { ...trend!, span: 6n }, bars!, orders!, spark!, roster!] }),
            [variant("resized", { cell: "c-trend", content: variant("component", "revenue_trend"), detail: "span 8 → 6" })]);
        assert.deepEqual(changes(OVERVIEW, { ...OVERVIEW, cells: [kpi!, { ...trend!, height: some(240n) }, bars!, orders!, spark!, roster!] }),
            [variant("height", { cell: "c-trend", content: variant("component", "revenue_trend"), detail: "height auto → 240" })]);
        assert.deepEqual(changes(OVERVIEW, { ...OVERVIEW, cells: [kpi!, trend!, { ...bars!, align: variant("stretch", null) }, orders!, spark!, roster!] }),
            [variant("aligned", { cell: "c-bars", content: variant("component", "breakdown_bars"), detail: "align top → stretch" })]);
        assert.deepEqual(changes(OVERVIEW, { ...OVERVIEW, cells: [kpi!, { ...trend!, title: some("Revenue") }, bars!, orders!, spark!, roster!] }),
            [variant("retitled", { cell: "c-trend", content: variant("component", "revenue_trend"), detail: 'title default → "Revenue"' })]);
    });

    test("a tile moved into a row and fitted to it lists the move and the span, in reading order, then what was removed", () => {
        const [kpi, trend, , orders, spark, roster] = OVERVIEW.cells;
        const after: Page = { ...OVERVIEW, cells: [kpi!, { ...trend!, row: "r1", span: 4n }, orders!, spark!, roster!] };
        assert.deepEqual(changes(OVERVIEW, after), [
            variant("moved", { cell: "c-trend", content: variant("component", "revenue_trend"), detail: "row 2 → row 1" }),
            variant("resized", { cell: "c-trend", content: variant("component", "revenue_trend"), detail: "span 8 → 4" }),
            variant("removed", { cell: "c-bars", content: variant("component", "breakdown_bars"), detail: "row 2 · span 4" }),
        ]);
    });
});

describe("Studio.changes — a page's starting filters (#1673)", () => {
    const SA = { key: "f-sa", source: "orders", where: jq(`.region == "SA"`) };

    test("starting filters added or taken off say how many the page starts with, before any placement's change", () => {
        const [kpi, trend, bars, orders, spark, roster] = OVERVIEW.cells;
        assert.deepEqual(changes(OVERVIEW, { ...OVERVIEW, filters: [NSW, SA] }), [variant("filters", { detail: "0 → 2" })]);
        assert.deepEqual(changes({ ...OVERVIEW, filters: [NSW, SA] }, { ...OVERVIEW, filters: [SA] }), [variant("filters", { detail: "2 → 1" })]);
        assert.deepEqual(changes(OVERVIEW, { ...OVERVIEW, cells: [kpi!, { ...trend!, span: 6n }, bars!, orders!, spark!, roster!], filters: [NSW] }).map((change) => change.type),
            ["filters", "resized"]);
    });

    test("as many, one in place of another — or the same condition as another filter — say they changed; the same filters, nothing", () => {
        assert.deepEqual(changes({ ...OVERVIEW, filters: [NSW] }, { ...OVERVIEW, filters: [SA] }), [variant("filters", { detail: "changed" })]);
        assert.deepEqual(changes({ ...OVERVIEW, filters: [NSW] }, { ...OVERVIEW, filters: [{ ...NSW, key: "f-nsw-2" }] }), [variant("filters", { detail: "changed" })]);
        assert.deepEqual(changes({ ...OVERVIEW, filters: [NSW, SA] }, { ...OVERVIEW, filters: [NSW, SA] }), []);
    });
});

describe("Studio.changes — a placement's content (#1669)", () => {
    const column = Studio.visual.of("orders", Studio.visual.column({
        x: Studio.visual.group("ordered_at", { bucket: "month" }), values: [Studio.visual.sum("revenue")],
    }));
    const at = (content: Page["cells"][number]["content"]): Page => ({
        title: "Board",
        cells: [{ key: "c-1", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content }],
        filters: [],
    });
    const configured = (before: Page["cells"][number]["content"], after: Page["cells"][number]["content"]) => {
        const listed = changes(at(before), at(after));
        const only = listed[0];
        if (listed.length !== 1 || only?.type !== "configured") assert.fail(`expected one configured change, got ${listed.map((change) => change.type).join(", ")}`);
        assert.equal(only.value.cell, "c-1");
        assert.deepEqual(only.value.content, after, "the change holds the content it has now");
        return only.value.detail;
    };

    test("a visual's source, its view and how many values it holds each say what changed, joined when several did", () => {
        const group = Studio.visual.group("ordered_at", { bucket: "month" });
        const sum = Studio.visual.sum("revenue");
        assert.equal(configured(column, Studio.visual.of("assets", Studio.visual.column({ x: group, values: [sum] }))), "source Orders → Assets");
        assert.equal(configured(column, Studio.visual.of("orders", Studio.visual.line({ x: group, values: [sum] }))), "view Column chart → Line chart");
        assert.equal(configured(column, Studio.visual.of("orders", Studio.visual.column({ x: group, values: [sum, Studio.visual.count()] }))), "values 1 → 2");
        assert.equal(configured(column, Studio.visual.of("stock", Studio.visual.line({ x: group, values: [sum, Studio.visual.count()] }))),
            "source Orders → stock · view Column chart → Line chart · values 1 → 2", "a source the surface does not list is named by its key");
    });

    test("what a view holds is counted under its own name — a records table's columns — and not at all across views that hold different things", () => {
        const records = (columns: string[]) => Studio.visual.of("orders", Studio.visual.records({ columns }));
        assert.equal(configured(records(["ordered_at", "region"]), records(["ordered_at", "region", "revenue"])), "columns 2 → 3");
        // A records table holds columns and a summary values: the change of view says it, and no count compares the two.
        assert.equal(configured(records(["ordered_at", "region", "revenue"]), Studio.visual.of("orders", Studio.visual.summary({
            rows: [Studio.visual.group("region")], values: [Studio.visual.sum("revenue")],
        }))), "view Records table → Summary table");
        // The same columns in another order hold as many: its options changed.
        assert.equal(configured(records(["ordered_at", "region"]), records(["region", "ordered_at"])), "options changed");
    });

    test("a visual's click and the visual it follows say they changed; any other change of it is its options", () => {
        const group = Studio.visual.group("ordered_at", { bucket: "month" });
        const sum = Studio.visual.sum("revenue");
        const view = Studio.visual.column({ x: group, values: [sum] });
        assert.equal(configured(column, Studio.visual.of("orders", view, { click: variant("select", null) })), "click filter → select");
        // A click that opens a page says which: another page is another click.
        const opens = (page: string) => Studio.visual.of("orders", view, { click: variant("open", { project: "ops", page }) });
        assert.equal(configured(column, opens("Weekly")), "click filter → open ops / Weekly");
        assert.equal(configured(opens("Weekly"), opens("Monthly")), "click open ops / Weekly → open ops / Monthly");
        assert.equal(configured(opens("Weekly"), Studio.visual.of("orders", view, { click: variant("none", null) })), "click open ops / Weekly → none");
        assert.equal(configured(column, Studio.visual.of("orders", view, {
            follow: { leader: "c-list", from: "region", to: "region", empty: variant("all", null) },
        })), "link changed");
        assert.equal(configured(column, Studio.visual.of("orders", Studio.visual.column({ x: group, values: [sum], stack: "stacked" }))), "options changed");
        assert.equal(configured(column, Studio.visual.of("orders", Studio.visual.column({ x: Studio.visual.group("ordered_at", { bucket: "week" }), values: [sum] }))), "options changed");
    });

    test("a text block's text is edited; a placement holding another kind of content, or another component, says what it held and holds", () => {
        assert.equal(configured(Studio.visual.text("Figures are to last night."), Studio.visual.text("Figures are to this morning.", "About")), "text edited");
        // A component is said by its name, as the row's own name is — its key only where the surface lists none of it.
        assert.equal(configured(Studio.visual.component("kpi_rail"), Studio.visual.component("revenue_trend")), "KPI rail → Revenue trend");
        assert.equal(configured(Studio.visual.component("kpi_rail"), column), "KPI rail → Column chart · Orders");
        assert.equal(configured(Studio.visual.component("kpi_rail"), Studio.visual.component("orders_v0")), "KPI rail → orders_v0");
        assert.equal(configured(column, Studio.visual.text("A note")), "Column chart · Orders → Text");
    });

    test("a placement whose content is as it was is not configured, whatever else of it changed", () => {
        const before = at(column);
        const after: Page = { ...before, cells: [{ ...before.cells[0]!, span: 8n }] };
        assert.deepEqual(changes(before, after).map((change) => change.type), ["resized"]);
    });
});

describe("Studio.status (#992)", () => {
    test("a page is live when its draft is its published layout, and a draft otherwise", () => {
        assert.equal(status(pageEntry(OVERVIEW_KEY, OVERVIEW)).type, "draft");
        assert.equal(status(pageEntry(OVERVIEW_KEY, OVERVIEW, some({ version: 1n, page: OVERVIEW }))).type, "live");
        assert.equal(status(pageEntry(OVERVIEW_KEY, EDITED, some({ version: 1n, page: OVERVIEW }))).type, "draft");
    });
});

describe("Studio.value (#1759)", () => {
    const build = East.compile(Studio.entry, []);

    test("an entry is built from its key and its layout: its project is its key's and its title its layout's, whatever it is", () => {
        assertEntry(build(OVERVIEW_KEY, variant("page", null), OVERVIEW, some({ version: 1n, page: OVERVIEW }), tagged("weekly")),
            pageEntry(OVERVIEW_KEY, OVERVIEW, some({ version: 1n, page: OVERVIEW }), tagged("weekly")));
        assertEntry(build(TEMPLATE_KEY, variant("template", null), KPIS, none, tagged()), templateEntry(TEMPLATE_KEY, KPIS));
    });

    test("the record a solution ships is each page and template it writes, by key: a page its draft, its published version and its tags; a template its layout", () => {
        assert.deepEqual([...PAGES.keys()], [OVERVIEW_KEY, TEMPLATE_KEY], "in key order");
        assertEntry(PAGES.get(OVERVIEW_KEY), pageEntry(OVERVIEW_KEY, OVERVIEW, none, tagged("weekly")));
        assertEntry(PAGES.get(TEMPLATE_KEY), templateEntry(TEMPLATE_KEY, KPIS));
        assertEntry(SAVED.get(OVERVIEW_KEY), pageEntry(OVERVIEW_KEY, EDITED, some({ version: 1n, page: OVERVIEW }), tagged("weekly")));
        assert.equal(Studio.value([]).size, 0, "none written, none held");
    });

    test("its tags are kept without the spaces around each, once", () => {
        const kept = Studio.value([{ key: OVERVIEW_KEY, draft: OVERVIEW, tags: [" weekly", "weekly ", "sales desk"] }]).get(OVERVIEW_KEY);
        assert.ok(kept !== undefined && sameTags(kept.tags, tagged("sales desk", "weekly")));
    });

    test("an empty tag and a key written twice are refused, each naming the entry", () => {
        assert.throws(() => Studio.value([{ key: OVERVIEW_KEY, draft: OVERVIEW, tags: ["weekly", "  "] }]),
            /Studio\.value: \(project="ops", page="overview"\) has an empty tag — a tag is a word or two to find the entry by/);
        assert.throws(() => Studio.value([{ key: OVERVIEW_KEY, draft: OVERVIEW }, { key: OVERVIEW_KEY, template: KPIS }]),
            /Studio\.value: \(project="ops", page="overview"\) is written twice/);
    });
});
