/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Library>` (#997): what it shows, computed in East over the
 * record — the projects (D2), a layout's summary — a visual by its view, a
 * text block as Text (#1669) — and the project's templates (D3), the
 * project's pages (D4) — what a refused name write says (D5, D7),
 * the surface's manifest (R4), and the interface the browser draws: the open
 * page its host gives it, and who it tells of another (#1668).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, East, FloatType, NullType, OptionType, PatchType, StringType, decodeBeast2For, equalFor, none,
    some, variant, type ValueTypeOf,
} from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { RecordCommitInfoType, TreePathType } from "@elaraai/e3-types";
import { Slice } from "@elaraai/east-ui";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Record, RecordOutcomeType, Studio, StudioPagesType, ui } from "@elaraai/e3-ui";
import {
    StudioLibraryPayloadType, StudioPagesHandleType, layoutSummary, libraryPages, libraryProjects, libraryTemplates, nameWriteRefusal,
} from "@elaraai/e3-ui/internal";


const pathKey = (p: ValueTypeOf<typeof TreePathType>) => p.map((s) => `${s.type}:${s.value}`).join("/");

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
    test("D2: the projects are the record's and the surface's own, in name order, each once", $ => {
        const pages = $.let(East.value(PAGES, StudioPagesType));
        $(Assert.equal(libraryProjects(pages, "ops"), ["ops", "retail"]));
        $(Assert.equal(libraryProjects(pages, "finance"), ["finance", "ops", "retail"]));
    });

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

    test("D3: the project's templates in name order, each with its title, summary and placements; its pages and other projects' entries are not listed", $ => {
        const templates = $.let(libraryTemplates(East.value(PAGES, StudioPagesType), "ops", [kpiRail, revenueTrend]));
        $(Assert.equal(templates.map((_$2, t) => t.name), ["t-empty", "t-summary"]));
        $(Assert.equal(templates.get(1n).title, "Summary"));
        $(Assert.equal(templates.get(1n).summary, "KPI rail ×2 · Revenue trend"));
        $(Assert.equal(templates.get(1n).cells.size(), 3n));
        $(Assert.equal(templates.get(0n).summary, ""));
    });

    test("D4: the project's pages in name order, each with its title, whether it is live, and its draft's placements", $ => {
        const pages = $.let(libraryPages(East.value(PAGES, StudioPagesType), "ops"));
        $(Assert.equal(pages.map((_$2, p) => p.page), ["a-detail", "b-overview", "c-weekly"]));
        $(Assert.equal(pages.map((_$2, p) => p.title), ["Detail", "Overview", "Weekly"]));
        // Live only while its draft is its live layout.
        $(Assert.equal(pages.map((_$2, p) => p.live), [false, true, false]));
        $(Assert.equal(pages.map((_$2, p) => p.cells.size()), [1n, 3n, 0n]));
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

describe("<Studio.Library> — the surface (#997)", () => {
    test("R4: its manifest holds the record it writes, and what its components read", () => {
        const pages = e3.record("library_pages", StudioPagesType, {
            initial: Studio.value([]),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
        });
        const surface = ui("library_surface", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const components = $.let([revenueTrend, kpiRail]);
            const record = $.let(Record.bind(pages));
            const go = $.const(East.function([Studio.Types.Key], NullType, (_$2, _key) => null));
            return Studio.Library({ pages: record, components, project: "ops", onOpen: go });
        }))));
        const manifest = surface.role.value!;
        assert.deepEqual(manifest.records, ["library_pages"]);
        assert.deepEqual(manifest.paths.map(pathKey).sort(), [
            "field:inputs/field:library_sales_daily",
            "field:records/field:library_pages",
        ]);
    });

    test("#1759: the pages and the templates narrow apart through the record's indexes, each led by what an entry is — the pages by project and by tag, searched by the start of a title, a project or a tag; the templates by the start of a title", () => {
        const INDEXES = ["pages_by_kind", "pages_by_kind_project", "pages_by_kind_tag", "pages_by_kind_title"] as const;
        const pages = e3.record("library_rail_pages", StudioPagesType, {
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
        assert.deepEqual(Object.keys(pages.indexes).sort(), [...INDEXES]);
        const surface = ui("library_rail_surface", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const components = $.let([revenueTrend, kpiRail]);
            const record = $.let(Record.bind(pages));
            const slice = $.let(Slice.bindRecords("library.rail", {
                rows: {
                    source: Data.bindPaged(pages, { indexes: [...INDEXES] }), label: "Pages", scope: { kind: ["page"] }, search: ["title", "project", "tags"],
                    fields: { title: { label: "Name" }, project: { label: "Project" }, tags: { label: "Tag" } },
                },
                templates: {
                    source: Data.bindPaged(pages, { indexes: [...INDEXES] }), label: "Templates", scope: { kind: ["template"] }, search: ["title"],
                    fields: { title: { label: "Name" } },
                },
            }));
            // What the rail narrows by is checked where the page is built, against the entry's fields and the record's indexes.
            $(slice.key);
            const go = $.const(East.function([Studio.Types.Key], NullType, (_$2, _key) => null));
            return Studio.Library({ pages: record, components, project: "ops", onOpen: go });
        }))));
        assert.deepEqual(surface.role.value!.records, ["library_rail_pages"]);
    });

    test("it is an interface the browser draws — the StudioLibrary carrier, holding the bound record, the components, the project, the open page its host gives it and who it tells of another; no page given marks none", () => {
        const keyEqual = equalFor(Studio.Types.Key);
        const build = (given: boolean) => East.compile(East.function([], UIComponentType, ($) => {
            const components = $.let([revenueTrend, kpiRail]);
            const record = $.let({
                read: East.function([], StudioPagesType, (_$2) => PAGES),
                history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
                commit: {
                    patch: East.asyncFunction([StringType, PatchType(StudioPagesType)], RecordOutcomeType,
                        (_$2) => variant("committed", { commitHash: "c", stateHash: "s" })),
                },
            }, StudioPagesHandleType);
            const go = $.const(East.function([Studio.Types.Key], NullType, (_$2, _key) => null));
            return given
                ? Studio.Library({ pages: record, components, project: "ops", page: { project: "ops", page: "b-overview" }, onOpen: go })
                : Studio.Library({ pages: record, components, project: "ops", onOpen: go });
        }), [])();
        const value = build(true);
        if (value.type !== "Extension") assert.fail(`expected the StudioLibrary carrier, got ${value.type}`);
        assert.equal(value.value.kind, "StudioLibrary");
        const payload = decodeBeast2For(StudioLibraryPayloadType)(value.value.payload);
        assert.equal(payload.project, "ops");
        if (payload.page.type !== "some") assert.fail("expected the open page the host gave");
        assert.ok(keyEqual(payload.page.value, { project: "ops", page: "b-overview" }));
        // Its host is told through the function it gave.
        assert.equal(payload.onOpen({ project: "ops", page: "a-detail" }), null);
        assert.deepEqual(payload.components.map((component) => component.key), ["revenue_trend", "kpi_rail"]);
        // It reads no source: its payload holds none, and its surface binds none for it.
        assert.deepEqual(Object.keys(StudioLibraryPayloadType.fields), ["pages", "components", "project", "page", "onOpen"]);
        assert.equal(payload.pages.read().size, PAGES.size);

        const bare = build(false);
        if (bare.type !== "Extension") assert.fail(`expected the StudioLibrary carrier, got ${bare.type}`);
        assert.deepEqual(decodeBeast2For(StudioLibraryPayloadType)(bare.value.payload).page, none);
    });
});
