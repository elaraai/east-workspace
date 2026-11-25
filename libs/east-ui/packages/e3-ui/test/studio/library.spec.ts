/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Library>` (#997, #1762): what it shows, computed in East — a
 * layout's summary, a visual by its view and a text block as Text (#1669) —
 * and what a refused name write says (D5, D7); the interface the browser
 * draws: the rail's chrome over its `slice`, the record's patch write and
 * nothing else of it, the open page its host gives it and who it tells of
 * another (#1668); the surface's manifest, which binds the record to write and
 * pages it, never loading it whole (R4); and what it refuses where the page is
 * built: no `slice`, a slice that narrows no record's rows, one with no `rows`
 * source or a source beside its `templates`, a source of another record, and
 * a source not scoped by what an entry is.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, East, FloatType, NullType, OptionType, StringType, equalFor, isTypeEqual, none, some, variant,
    type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { TreePathType } from "@elaraai/e3-types";
import { Slice } from "@elaraai/east-ui";
import { Reactive, RecordSlicesChromeType, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Record, RecordOutcomeType, Studio, StudioPagesType, ui } from "@elaraai/e3-ui";
import { StudioLibraryPayloadType, StudioPagesWriteType, layoutSummary, nameWriteRefusal } from "@elaraai/e3-ui/internal";
import * as sheetEx from "../sheet/sheet.examples.js";


type TreePath = ValueTypeOf<typeof TreePathType>;
const paths = equalFor(ArrayType(TreePathType));

/** A dataset a component reads. */
const salesDaily = e3.input("library_sales_daily", ArrayType(FloatType), variant("value", []));

/** A component that reads the dataset. */
const revenueTrend = Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area", span: 8n },
    East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
        const sales = $.let(Data.bind(salesDaily));
        return Text.Root(East.print(sales.read().size()));
    }))));

/** A component that reads nothing. */
const kpiRail = Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high" },
    East.function([], UIComponentType, (_$) => Text.Root("KPIs")));
/** Components whose names are another's: a second KPI rail, and ones named as a text block and as a view are. */
const namedAsRail = Studio.component("kpi_rail_b", { name: "KPI rail", category: "Display", icon: "gauge-high" },
    East.function([], UIComponentType, (_$) => Text.Root("More KPIs")));
const namedText = Studio.component("words", { name: "Text", category: "Display", icon: "font" },
    East.function([], UIComponentType, (_$) => Text.Root("Words")));
const namedList = Studio.component("ranks", { name: "List", category: "Display", icon: "list" },
    East.function([], UIComponentType, (_$) => Text.Root("Ranks")));

/** Two visuals of one view over two sources, a list, and a text block. */
const byRegion = Studio.visual.group("region");
const salesColumns = Studio.visual.of("sales", Studio.visual.column({ x: byRegion, values: [Studio.visual.sum("revenue")] }));
const stockColumns = Studio.visual.of("stock", Studio.visual.column({ x: byRegion, values: [Studio.visual.sum("units")] }));
const topRegions = Studio.visual.of("sales", Studio.visual.list({ item: byRegion, values: [Studio.visual.sum("revenue")] }));
const aNote = Studio.visual.text("Figures are to last night.");

/** The record: in ops, the Overview live, the Detail never published, the Weekly drafted past its live version, and two templates; a retail page. */
const PAGES = Studio.value([
    {
        key: { project: "ops", page: "b-overview" },
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi-1", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "c-kpi-2", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            ],
            filters: [],
        },
        live: {
            version: 2n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi-1", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "c-kpi-2", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                    { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
                ],
                filters: [],
            },
        },
    },
    {
        key: { project: "ops", page: "a-detail" },
        draft: {
            title: "Detail",
            cells: [
                { key: "c-trend", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            ],
            filters: [],
        },
    },
    {
        key: { project: "ops", page: "c-weekly" },
        draft: { title: "Weekly", cells: [], filters: [] },
        live: { version: 1n, page: { title: "Weekly (old)", cells: [], filters: [] } },
    },
    {
        key: { project: "ops", page: "t-summary" },
        template: {
            title: "Summary",
            cells: [
                { key: "c-kpi-1", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "c-kpi-2", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            ],
            filters: [],
        },
    },
    { key: { project: "ops", page: "t-empty" }, template: { title: "Empty", cells: [], filters: [] } },
    {
        key: { project: "retail", page: "home" },
        draft: { title: "Home", cells: [], filters: [] },
        live: { version: 1n, page: { title: "Home", cells: [], filters: [] } },
    },
]);

describeEast("<Studio.Library> — what it shows (#997)", (test) => {
    test("D3: a layout's summary names each component it places, in the order they first appear, counted when placed more than once; an unlisted one by its key", $ => {
        const listed = $.let([kpiRail, revenueTrend]);
        const cells = $.let([
            { key: "c-kpi-1", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
            { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, content: variant("component", "revenue_trend") },
            { key: "c-kpi-2", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
            { key: "c-old", row: "r3", span: 4n, height: none, align: variant("top", null), title: none, content: variant("component", "orders_v0") },
        ], ArrayType(Studio.Types.Cell));
        $(Assert.equal(layoutSummary(listed, cells), "KPI rail ×2 · Revenue trend · orders_v0"));
        $(Assert.equal(layoutSummary(listed, []), ""));
    });

    test("#1669: a layout's summary names a visual by its view and a text block as Text, counted like any other", $ => {
        const listed = $.let([kpiRail]);
        const cells = $.let([
            { key: "c-note", row: "r1", span: 12n, height: none, align: variant("top", null), title: none, content: aNote },
            { key: "c-sales", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, content: salesColumns },
            { key: "c-kpi", row: "r2", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
            { key: "c-stock", row: "r3", span: 6n, height: none, align: variant("top", null), title: some("Stock"), content: stockColumns },
            { key: "c-top", row: "r3", span: 6n, height: none, align: variant("top", null), title: none, content: topRegions },
        ], ArrayType(Studio.Types.Cell));
        $(Assert.equal(layoutSummary(listed, cells), "Text · Column chart ×2 · KPI rail · List"));
    });

    test("#1669: a layout's summary counts placements by what they are, never by the words they are shown in: two components of one name are two, and a component named as a text block or a view is none of them", $ => {
        const listed = $.let([kpiRail, namedAsRail, namedText, namedList]);
        const cells = $.let([
            { key: "c-rail", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail") },
            { key: "c-rail-b", row: "r1", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "kpi_rail_b") },
            { key: "c-note", row: "r2", span: 12n, height: none, align: variant("top", null), title: none, content: aNote },
            { key: "c-words", row: "r3", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "words") },
            { key: "c-note-2", row: "r3", span: 6n, height: none, align: variant("top", null), title: none, content: aNote },
            { key: "c-top", row: "r4", span: 6n, height: none, align: variant("top", null), title: none, content: topRegions },
            { key: "c-ranks", row: "r4", span: 6n, height: none, align: variant("top", null), title: none, content: variant("component", "ranks") },
        ], ArrayType(Studio.Types.Cell));
        $(Assert.equal(layoutSummary(listed, cells), "KPI rail · KPI rail · Text ×2 · Text · List · List"));
    });

    test("D5, D7: a write under a new name says what refused it — another write taking the name first, an invalid write, a failed or timed-out program, or no answer — and nothing once it committed", $ => {
        $(Assert.equal(nameWriteRefusal(East.value(variant("committed", { commitHash: "c1", stateHash: "s1" }), RecordOutcomeType), "Q3 review"), none));
        $(Assert.equal(nameWriteRefusal(East.value(variant("conflict", { attempts: 1n, detail: none }), RecordOutcomeType), "Q3 review"),
            some("Another write took the name Q3 review first — choose another")));
        $(Assert.equal(nameWriteRefusal(East.value(variant("invalid", { message: "no mutation patch" }), RecordOutcomeType), "Q3 review"),
            some("no mutation patch")));
        $(Assert.equal(nameWriteRefusal(East.value(variant("failed", { exitCode: 1n, stderr: "boom" }), RecordOutcomeType), "Q3 review"),
            some("The write failed: boom")));
        $(Assert.equal(nameWriteRefusal(East.value(variant("timed_out", { ms: 30000n, stderr: "" }), RecordOutcomeType), "Q3 review"),
            some("The write ran out of time and wrote nothing")));
        $(Assert.equal(nameWriteRefusal(East.value(variant("transport", { message: "offline" }), RecordOutcomeType), "Q3 review"),
            some("The write got no answer, so it may have been made — offline")));
    });
}, { platformFns: TestImpl });

/** The indexes a pages record lists its entries by, each led by what an entry is. */
const INDEXES = ["pages_by_kind", "pages_by_kind_project", "pages_by_kind_tag", "pages_by_kind_title"] as const;

/** The pages record, as a solution declares it: its one write, and the indexes a page lists its entries by. */
const pagesRecord = e3.record("library_rail_pages", StudioPagesType, {
    initial: PAGES,
    mutations: (mutation) => ({
        patch: mutation.patch(),
    }),
    indexes: (index) => ({
        // A page or a template is found among its kind's by its key through the index on the kind alone.
        pages_by_kind: index.on(["kind"]),
        pages_by_kind_project: index.on(["kind", "project"]),
        pages_by_kind_tag: index.on(["kind", "tags"]),
        pages_by_kind_title: index.on(["kind", "title"]),
    }),
});

/** A host's `onOpen`: told the page asked for. */
const heard = East.function([Studio.Types.Key], NullType, (_$, _key) => null);

/** The surface's bindings, as a page writes them: the record to write, its rows paged, and the rail over the pages and the templates. */
function bind($: BlockBuilder<UIComponentType>) {
    const components = $.let([revenueTrend, kpiRail]);
    const record = $.let(Record.bind(pagesRecord));
    const rows = $.let(Data.bindPaged(pagesRecord, { indexes: [...INDEXES] }));
    const slice = $.let(Slice.bindRecords("spec.library", {
        rows: {
            source: rows, label: "Pages", scope: { kind: ["page"] }, search: ["title", "project", "tags"],
            fields: { title: { label: "Name" }, project: { label: "Project" }, tags: { label: "Tag" } },
        },
        templates: { source: rows, label: "Templates", scope: { kind: ["template"] }, search: ["title"], fields: { title: { label: "Name" } } },
    }));
    return { components, record, rows, slice };
}

/** The handles a library is handed. */
type Handles = ReturnType<typeof bind>;
type Options = Parameters<typeof Studio.Library>[0];

/**
 * A page that mounts the library, built — and never run: what the tag takes, and refuses, is decided where the page is
 * built. Its payload is never decoded here: it carries the rail's chrome, whose functions are a binding's, which only a
 * page on e3 runs — what the payload carries, its name among it, is the renderer's tests', on e3-web
 * (`studio/library.test.tsx`).
 */
const page = (make: (handles: Handles) => ReturnType<typeof Studio.Library>) => () => East.function([], UIComponentType, ($) => make(bind($)));
/** The library over the handles, with the slice given. */
const libraryOver = ({ components, record }: Handles, slice: Options["slice"], more: Partial<Options> = {}) =>
    Studio.Library({ pages: record, components, project: "ops", slice, onOpen: heard, ...more });

describe("<Studio.Library> — the surface (#997, #1762)", () => {
    test("#1762: its payload is the record's patch write and nothing else of it, the rail's chrome, the components, the project a new page starts in, the open page, who to tell and the library's name", () => {
        assert.deepEqual(Object.keys(StudioLibraryPayloadType.fields), ["pages", "slice", "components", "project", "page", "onOpen", "id"]);
        assert.ok(isTypeEqual(StudioLibraryPayloadType.fields.slice, RecordSlicesChromeType), "the rail's chrome, as every builder narrowed over records carries it");
        // Of the bound record it takes its patch write alone: it never reads the record whole.
        assert.deepEqual(Object.keys(StudioPagesWriteType.fields), ["commit"]);
        assert.deepEqual(Object.keys(StudioPagesWriteType.fields.commit.fields), ["patch"]);
        assert.ok(isTypeEqual(StudioLibraryPayloadType.fields.page, OptionType(Studio.Types.Key)));
    });

    test("#1762: the tag builds over a slice whose `rows` source pages the pages and whose `templates` source the templates — or the pages alone — bare, and named with the open page", () => {
        assert.doesNotThrow(page((handles) => libraryOver(handles, { slice: handles.slice })));
        assert.doesNotThrow(page((handles) => libraryOver(handles, { slice: handles.slice }, { id: "ops", page: { project: "ops", page: "b-overview" } })));
        assert.doesNotThrow(page((handles) => libraryOver(handles, {
            slice: Slice.bindRecords("spec.pages", { rows: { source: handles.rows, scope: { kind: ["page"] }, search: ["title"], fields: { title: { label: "Name" } } } }),
        })));
    });

    test("#1762: it is refused without a `slice`, with one that narrows no record's rows, with no `rows` source or a source beside it and its templates, with a source of another record, and with a source not scoped by what an entry is — each saying the slice to write", () => {
        const call = /slice=\{\{ slice: Slice\.bindRecords\(key, \{ rows: \{ source: Data\.bindPaged\(pages, \{ indexes: \[\.\.\.\] \}\), scope: \{ kind: \["page"\] \}/;
        const without = page(({ components, record }) => Studio.Library({ pages: record, components, project: "ops", onOpen: heard } as unknown as Options));
        assert.throws(without, /Studio\.Library: needs `slice` — /);
        assert.throws(without, call);
        // The bare handle, and a slice over values: neither narrows a record's rows.
        assert.throws(page((handles) => libraryOver(handles, handles.slice as unknown as Options["slice"])), /Studio\.Library: `slice` takes \{ slice \} over Slice\.bindRecords/);
        assert.throws(page((handles) => libraryOver(handles, { slice: Slice.bind("spec.values", [{ status: "open" }], { fields: { status: {} } }) } as unknown as Options["slice"])),
            /Studio\.Library: `slice` takes \{ slice \} over Slice\.bindRecords/);
        const scoped = (handles: Handles) => ({ source: handles.rows, scope: { kind: ["page" as const] }, search: ["title" as const], fields: { title: { label: "Name" } } });
        assert.throws(page((handles) => libraryOver(handles, { slice: Slice.bindRecords("spec.unnamed", { pages: scoped(handles) }) })),
            /Studio\.Library: `slice` narrows the pages and the templates — its source 'pages' is none of them; name the sources `rows` and `templates`/);
        assert.throws(page((handles) => libraryOver(handles, { slice: Slice.bindRecords("spec.beside", { rows: scoped(handles), others: scoped(handles) }) })),
            /its source 'others' is none of them/);
        assert.throws(page((handles) => libraryOver(handles, { slice: Slice.bindRecords("spec.templates", { templates: scoped(handles) }) })),
            /Studio\.Library: `slice` has no `rows` source/);
        // A record of another type: the cards are the pages record's entries.
        assert.throws(page((handles) => libraryOver(handles, {
            slice: Slice.bindRecords("spec.other", { rows: { source: Data.bindPaged(sheetEx.sheetStressJobs, { indexes: ["sheet_stress_by_activity"] }) } }),
        })), /Studio\.Library: `slice`'s `rows` source pages .*, not the pages record's entries — its source is the pages record, of Studio\.Types\.Pages/);
        // A source that lists every entry: the pages and the templates are each one kind.
        assert.throws(page((handles) => libraryOver(handles, { slice: Slice.bindRecords("spec.unscoped", { rows: { source: handles.rows } }) })),
            /Studio\.Library: `slice`'s `rows` source lists the pages alone — scope it by what an entry is, scope: \{ kind: \["page"\] \}/);
        assert.throws(page((handles) => libraryOver(handles, {
            slice: Slice.bindRecords("spec.unscoped_templates", { rows: scoped(handles), templates: { source: handles.rows } }),
        })), /`templates` source lists the templates alone — scope it by what an entry is, scope: \{ kind: \["template"\] \}/);
    });

    test("R4, #1762: its manifest holds the record it writes, the record paged — never loaded whole — and what its components read", () => {
        const surface = ui("library_surface", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const handles = bind($);
            return libraryOver(handles, { slice: handles.slice });
        }))));
        const manifest = surface.role.value!;
        assert.deepEqual([manifest.records, manifest.functions], [["library_rail_pages"], []]);
        const recordPath: TreePath = [variant("field", "records"), variant("field", "library_rail_pages")];
        assert.ok(paths(manifest.pages, [recordPath]), "the record's rows are read a window at a time");
        assert.ok(paths(manifest.paths, [[variant("field", "inputs"), variant("field", "library_sales_daily")]]),
            "what its components read is loaded whole, and the record never is");
    });

    test("#1759: the pages and the templates narrow apart through the record's indexes, each led by what an entry is — the pages by project and by tag, searched by the start of a title, a project or a tag; the templates by the start of a title", () => {
        const pages = pagesRecord;
        assert.deepEqual(Object.keys(pages.indexes).sort(), [...INDEXES]);
        // What the rail narrows by is checked where it is built, against the entry's fields and the record's indexes —
        // over the paged source alone: the record is read through its indexes, never whole beside them.
        const rail = (search: readonly string[]) => () => East.function([], StringType, ($) => {
            const slice = $.let(Slice.bindRecords("library.rail", {
                rows: {
                    source: Data.bindPaged(pages, { indexes: [...INDEXES] }), label: "Pages", scope: { kind: ["page"] }, search: [...search] as ("title" | "project" | "tags")[],
                    fields: { title: { label: "Name" }, project: { label: "Project" }, tags: { label: "Tag" } },
                },
                templates: {
                    source: Data.bindPaged(pages, { indexes: [...INDEXES] }), label: "Templates", scope: { kind: ["template"] }, search: ["title"],
                    fields: { title: { label: "Name" } },
                },
            }));
            return slice.key;
        });
        assert.doesNotThrow(rail(["title", "project", "tags"]));
        // A field no index is led by under the scope is refused there, naming it.
        assert.throws(rail(["kind"]), /kind/);
    });
});
