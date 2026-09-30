/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.PageLibrary>` (#997): what it shows, computed in East over the
 * record — the projects (D2), a layout's summary and the project's templates
 * (D3), the project's pages (D4) — what a refused name write says (D5, D7),
 * and the surface's manifest.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ArrayType, East, FloatType, SortedMap, compareFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import e3 from "@elaraai/e3";
import { TreePathType } from "@elaraai/e3-types";
import { Reactive, Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Record, RecordOutcomeType, Studio, StudioKeyType, StudioPagesType, ui } from "@elaraai/e3-ui";
import { layoutSummary, libraryPages, libraryProjects, libraryTemplates, nameWriteRefusal } from "@elaraai/e3-ui/internal";

type Key = ValueTypeOf<typeof Studio.Types.Key>;
type Entry = ValueTypeOf<typeof Studio.Types.Entry>;

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

/** The record: in ops, the Overview live, the Detail never published, the Weekly drafted past its live version, and two templates; a retail page. */
const PAGES = new SortedMap<Key, Entry>([
    [{ project: "ops", page: "b-overview" }, variant("page", {
        draft: {
            title: "Overview",
            cells: [
                { key: "c-kpi-1", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                { key: "c-kpi-2", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            ],
        },
        live: some({
            version: 2n,
            page: {
                title: "Overview",
                cells: [
                    { key: "c-kpi-1", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                    { key: "c-kpi-2", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
                    { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
                ],
            },
        }),
    })],
    [{ project: "ops", page: "a-detail" }, variant("page", {
        draft: {
            title: "Detail",
            cells: [
                { key: "c-trend", row: "r1", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            ],
        },
        live: none,
    })],
    [{ project: "ops", page: "c-weekly" }, variant("page", {
        draft: { title: "Weekly", cells: [] },
        live: some({ version: 1n, page: { title: "Weekly (old)", cells: [] } }),
    })],
    [{ project: "ops", page: "t-summary" }, variant("template", {
        title: "Summary",
        cells: [
            { key: "c-kpi-1", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
            { key: "c-kpi-2", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
            { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
        ],
    })],
    [{ project: "ops", page: "t-empty" }, variant("template", { title: "Empty", cells: [] })],
    [{ project: "retail", page: "home" }, variant("page", {
        draft: { title: "Home", cells: [] },
        live: some({ version: 1n, page: { title: "Home", cells: [] } }),
    })],
], compareFor(StudioKeyType));

describeEast("<Studio.PageLibrary> — what it shows (#997)", (test) => {
    test("D2: the projects are the record's and the surface's own, in name order, each once", $ => {
        const pages = $.let(East.value(PAGES, StudioPagesType));
        $(Assert.equal(libraryProjects(pages, "ops"), ["ops", "retail"]));
        $(Assert.equal(libraryProjects(pages, "finance"), ["finance", "ops", "retail"]));
    });

    test("D3: a layout's summary names each component it places, in the order they first appear, counted when placed more than once; an unlisted one by its key", $ => {
        const listed = $.let([kpiRail, revenueTrend]);
        const cells = $.let([
            { key: "c-kpi-1", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
            { key: "c-trend", row: "r2", span: 8n, height: none, align: variant("top", null), title: none, component: "revenue_trend", fingerprint: "" },
            { key: "c-kpi-2", row: "r1", span: 6n, height: some(96n), align: variant("top", null), title: none, component: "kpi_rail", fingerprint: "" },
            { key: "c-old", row: "r3", span: 4n, height: none, align: variant("top", null), title: none, component: "orders_v0", fingerprint: "" },
        ], ArrayType(Studio.Types.Cell));
        $(Assert.equal(layoutSummary(listed, cells), "KPI rail ×2 · Revenue trend · orders_v0"));
        $(Assert.equal(layoutSummary(listed, []), ""));
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

describe("<Studio.PageLibrary> — the surface (#997)", () => {
    test("its manifest holds the record it writes, and what its components read", () => {
        const pages = e3.record("library_pages", StudioPagesType, new SortedMap<Key, Entry>([], compareFor(StudioKeyType)));
        const pagesPatch = e3.mutation.patch(pages);
        const surface = ui("library_surface", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const components = $.let([revenueTrend, kpiRail]);
            const record = $.let(Record.bind(pages, [pagesPatch]));
            return Studio.PageLibrary({ pages: record, components, project: "ops" });
        }))));
        const manifest = surface.role.value!;
        assert.deepEqual(manifest.records, ["library_pages"]);
        assert.deepEqual(manifest.paths.map(pathKey).sort(), [
            "field:inputs/field:library_sales_daily",
            "field:records/field:library_pages",
        ]);
    });
});
