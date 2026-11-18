/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a placement holds (#1669): `Studio.visual`'s builders, each with its
 * defaults, so a visual is valid as soon as its view and its source are set;
 * a view, a placement's content and its tile, in words, and a text block's
 * paragraphs, computed in East; and the types a solution seeds its pages
 * record with.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ArrayType, East, FloatType, StringType, StructType, checkJq, isTypeEqual, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Text, UIComponentType } from "@elaraai/east-ui/internal";

import { Studio } from "@elaraai/e3-ui";
import {
    StudioContentType, StudioStackType, StudioViewType, StudioVisualType, canvasTiles, componentFrames, componentNames, contentFramed, contentTile,
    contentWords, textParagraphs, viewIcon, viewWords, visualWords,
} from "@elaraai/e3-ui/internal";

const v = Studio.visual;
const month = v.group("ordered_at", { bucket: "month" });
const revenue = v.sum("revenue");
/** A chart's series side by side: the stack's own `none` case, typed as the stack's so it is not read as an Option's. */
const BESIDE: ValueTypeOf<typeof StudioStackType> = variant("none", null);

/** Every form a visual takes, with the words and the icon it is known by. */
const FORMS = [
    { view: v.kpi({ value: revenue }), words: "KPI", icon: "gauge-high" },
    { view: v.column({ x: month, values: [revenue] }), words: "Column chart", icon: "chart-column" },
    { view: v.bar({ x: month, values: [revenue] }), words: "Bar chart", icon: "chart-bar" },
    { view: v.line({ x: month, values: [revenue] }), words: "Line chart", icon: "chart-line" },
    { view: v.area({ x: month, values: [revenue] }), words: "Area chart", icon: "chart-area" },
    { view: v.combo({ x: month, columns: [v.left(revenue)], lines: [v.right(v.count())] }), words: "Combo chart", icon: "chart-simple" },
    { view: v.scatter({ point: "customer", x: revenue, y: v.sum("units") }), words: "Scatter chart", icon: "braille" },
    { view: v.pie({ slice: v.group("region"), value: revenue }), words: "Pie chart", icon: "chart-pie" },
    { view: v.pie({ slice: v.group("region"), value: revenue, donut: true }), words: "Donut chart", icon: "chart-pie" },
    { view: v.records({ columns: ["ordered_at", "region", "revenue"] }), words: "Records table", icon: "table-list" },
    { view: v.summary({ rows: [v.group("region")], values: [revenue] }), words: "Summary table", icon: "table" },
    { view: v.pivot({ rows: v.group("region"), columns: month, value: revenue }), words: "Pivot table", icon: "table-cells" },
    { view: v.list({ item: v.group("customer"), values: [revenue] }), words: "List", icon: "list" },
] as const;

describe("Studio.visual — a visual's parts, each with its defaults (#1669)", () => {
    test("a value is its measure, measured over the page's range, higher the better, with no label, no goal and its field's format unless given", () => {
        assert.deepEqual(v.sum("revenue"), { measure: variant("sum", "revenue"), label: none, period: variant("current", null), goal: none, better: variant("higher", null), format: none });
        assert.deepEqual(v.count().measure, variant("count", null));
        assert.deepEqual([v.mean("revenue").measure, v.min("revenue").measure, v.max("revenue").measure, v.distinct("customer").measure],
            [variant("mean", "revenue"), variant("min", "revenue"), variant("max", "revenue"), variant("distinct", "customer")]);
        assert.deepEqual(v.ratio("revenue", "units").measure, variant("ratio", { of: "revenue", per: "units" }));
        assert.deepEqual(v.sum("cost", { label: "Cost", period: "year_ago", goal: 5000, better: "lower" }),
            { measure: variant("sum", "cost"), label: some("Cost"), period: variant("year_ago", null), goal: some(5000), better: variant("lower", null), format: none });
        // A format of its own, written as a source's field writes one.
        assert.deepEqual(v.sum("cost", { format: "compact" }).format, some(variant("compact", null)));
        assert.deepEqual(v.sum("cost", { format: { currency: { code: "AUD" } } }).format, some(variant("currency", { code: "AUD", compact: false })));
    });

    test("a group is its field in its own order, every group kept, bucketed only when asked", () => {
        assert.deepEqual(v.group("region"), { field: "region", bucket: none, sort: variant("natural", null), top: none });
        assert.deepEqual(v.group("ordered_at", { bucket: "week", sort: "high", top: 5n }),
            { field: "ordered_at", bucket: some(variant("week", null)), sort: variant("high", null), top: some(5n) });
    });

    test("each view fills what it is not given: no split, side by side, its legend drawn, no compare or trend, a pie not a donut with its values in its legend, no total, no heat, no bar, ascending", () => {
        assert.deepEqual(v.column({ x: month, values: [revenue] }),
            variant("chart", variant("column", { x: month, values: [revenue], split: none, stack: BESIDE, legend: variant("auto", null) })));
        assert.deepEqual(v.area({ x: month, values: [revenue], split: "region", stack: "percent", legend: "hidden" }),
            variant("chart", variant("area", { x: month, values: [revenue], split: some("region"), stack: variant("percent", null), legend: variant("hidden", null) })));
        assert.deepEqual(v.kpi({ value: revenue }), variant("kpi", { value: revenue, compare: none, trend: none }));
        assert.deepEqual(v.combo({ x: month, columns: [v.left(revenue)], lines: [v.right(v.count())] }), variant("chart", variant("combo", {
            x: month, columns: [{ value: revenue, right: false }], lines: [{ value: v.count(), right: true }], stack: BESIDE, legend: variant("auto", null),
        })));
        assert.deepEqual(v.scatter({ point: "customer", x: revenue, y: v.sum("units") }),
            variant("chart", variant("scatter", { point: "customer", x: revenue, y: v.sum("units"), split: none, legend: variant("auto", null) })));
        assert.deepEqual(v.pie({ slice: v.group("region"), value: revenue }),
            variant("chart", variant("pie", { slice: v.group("region"), value: revenue, donut: false, legend: variant("values", null) })));
        assert.deepEqual(v.pie({ slice: v.group("region"), value: revenue, legend: "names" }),
            variant("chart", variant("pie", { slice: v.group("region"), value: revenue, donut: false, legend: variant("names", null) })));
        assert.deepEqual(v.records({ columns: ["region"] }), variant("table", variant("records", { columns: ["region"], sort: none, descending: false })));
        assert.deepEqual(v.summary({ rows: [v.group("region")], values: [revenue] }),
            variant("table", variant("summary", { rows: [v.group("region")], values: [revenue], total: false })));
        assert.deepEqual(v.pivot({ rows: v.group("region"), columns: month, value: revenue }),
            variant("table", variant("pivot", { rows: v.group("region"), columns: month, value: revenue, heat: false })));
        assert.deepEqual(v.list({ item: v.group("customer"), values: [revenue] }),
            variant("list", { item: v.group("customer"), caption: none, values: [revenue], bar: false }));
    });

    test("a visual over a source keeps every row, follows none, and takes its view's click: a chart and a KPI filter, a table and a list select", () => {
        const click = (view: (typeof FORMS)[number]["view"]) => {
            const content = v.of("orders", view);
            if (content.type !== "visual") assert.fail("expected a visual");
            assert.deepEqual([content.value.source, content.value.where, content.value.follow], ["orders", none, none]);
            return content.value.click.type;
        };
        assert.deepEqual(FORMS.map(({ view, words }) => [words, click(view)]), [
            ["KPI", "filter"], ["Column chart", "filter"], ["Bar chart", "filter"], ["Line chart", "filter"], ["Area chart", "filter"],
            ["Combo chart", "filter"], ["Scatter chart", "filter"], ["Pie chart", "filter"], ["Donut chart", "filter"],
            ["Records table", "select"], ["Summary table", "select"], ["Pivot table", "select"], ["List", "select"],
        ]);
    });

    test("a visual's own filter is a checked jq condition, its click and the visual it follows as given", () => {
        const Row = StructType({ export: FloatType, region: StringType });
        const where = checkJq(".export > 0", Row).program;
        if (where === null) assert.fail("the condition checks");
        const follow = { leader: "c-list", from: "region", to: "region", empty: variant("prompt", null) };
        const content = v.of("orders", v.kpi({ value: revenue }), { where, click: variant("open", { project: "ops", page: "detail" }), follow });
        if (content.type !== "visual") assert.fail("expected a visual");
        assert.deepEqual([content.value.where, content.value.click, content.value.follow],
            [some(where), variant("open", { project: "ops", page: "detail" }), some(follow)]);
    });

    test("a component and a text block are a placement's content too", () => {
        assert.deepEqual(v.component("kpi_rail"), variant("component", "kpi_rail"));
        assert.deepEqual(v.text("Figures are to last night."), variant("text", { heading: none, body: "Figures are to last night." }));
        assert.deepEqual(v.text("Figures are to last night.", "About"), variant("text", { heading: some("About"), body: "Figures are to last night." }));
    });

    test("the types a solution seeds its pages with are on Studio.Types", () => {
        assert.ok(isTypeEqual(Studio.Types.Content, StudioContentType));
        assert.ok(isTypeEqual(Studio.Types.Visual, StudioVisualType));
        assert.ok(isTypeEqual(Studio.Types.View, StudioViewType));
        // A variant's cases are held in name order.
        assert.deepEqual(Object.keys(Studio.Types.Content.cases), ["component", "text", "visual"]);
        assert.deepEqual(Object.keys(Studio.Types.View.cases), ["chart", "kpi", "list", "table"]);
        // A page's filter: a jq condition on one source's rows.
        assert.deepEqual(Object.keys(Studio.Types.Filter.fields), ["source", "where"]);
        assert.deepEqual(Object.keys(Studio.Types.Chart.cases), ["area", "bar", "column", "combo", "line", "pie", "scatter"]);
        assert.deepEqual(Object.keys(Studio.Types.Table.cases), ["pivot", "records", "summary"]);
        assert.deepEqual(Object.keys(Studio.Types.Cell.fields), ["key", "row", "span", "height", "align", "title", "content"]);
    });
});

/** Contents the East tests read: a column and a line over the listed source, a KPI over one not listed, a listed and an unlisted component, a text block. */
const COLUMN = v.of("orders", v.column({ x: month, values: [revenue] }));
const LINE = v.of("orders", v.line({ x: month, values: [revenue] }));
const UNLISTED_KPI = v.of("stock", v.kpi({ value: revenue }));
const RAIL = v.component("kpi_rail");
const RETIRED = v.component("retired");
const NOTE = v.text("A note");
/** Each form's view, words and icon, in order. */
const VIEWS = FORMS.map((form) => form.view);
const WORDS = FORMS.map((form) => form.words);
const ICONS = FORMS.map((form) => form.icon);

/** A listed component, and its tile. */
const kpiRail = Studio.component("kpi_rail", { name: "KPI rail", category: "Display", icon: "gauge-high", frame: "none" },
    East.function([], UIComponentType, (_$) => Text.Root("KPIs")));
/** A listed component drawn in a tile frame, as a component is unless it says otherwise. */
const trend = Studio.component("revenue_trend", { name: "Revenue trend", category: "Charts", icon: "chart-area" },
    East.function([], UIComponentType, (_$) => Text.Root("Trend")));
/** The visuals of the contents above, as the words of a visual alone take them. */
const COLUMN_VISUAL = COLUMN.type === "visual" ? COLUMN.value : undefined;
const UNLISTED_VISUAL = UNLISTED_KPI.type === "visual" ? UNLISTED_KPI.value : undefined;
if (COLUMN_VISUAL === undefined || UNLISTED_VISUAL === undefined) throw new Error("expected visuals");

describeEast("A placement's content, in words (#1669)", (test) => {
    test("each of a visual's forms is known by its words and its icon", $ => {
        const views = $.const(VIEWS, ArrayType(Studio.Types.View));
        $(Assert.equal(views.map((_$2, view) => viewWords(view)), WORDS));
        $(Assert.equal(views.map((_$2, view) => viewIcon(view)), ICONS));
    });

    test("a visual is its view and its source's name — its source's key where the surface lists none of it; a component its name — its key where the surface lists none of it; a text block Text", $ => {
        const sources = $.const(new Map([["orders", "Orders"]]));
        const components = $.let(componentNames([kpiRail, trend]));
        $(Assert.equal(components, new Map([["kpi_rail", "KPI rail"], ["revenue_trend", "Revenue trend"]])));
        $(Assert.equal(contentWords(COLUMN, sources, components), "Column chart · Orders"));
        $(Assert.equal(contentWords(UNLISTED_KPI, sources, components), "KPI · stock"));
        $(Assert.equal(contentWords(RAIL, sources, components), "KPI rail"));
        $(Assert.equal(contentWords(RETIRED, sources, components), "retired"));
        $(Assert.equal(contentWords(NOTE, sources, components), "Text"));
        // A visual alone, as its tile and a page's placeholder name it.
        $(Assert.equal(visualWords(East.value(COLUMN_VISUAL, StudioVisualType), sources), "Column chart · Orders"));
        $(Assert.equal(visualWords(East.value(UNLISTED_VISUAL, StudioVisualType), sources), "KPI · stock"));
    });

    test("a text block's paragraphs: its text cut at each blank line — empty, or only spaces — each trimmed and none empty, a line break inside one kept", $ => {
        $(Assert.equal(textParagraphs("One.\nStill one.\n\nTwo.\n   \n\n\nThree.  "), ["One.\nStill one.", "Two.", "Three."]));
        $(Assert.equal(textParagraphs("One.\r\n\r\nTwo."), ["One.", "Two."]));
        $(Assert.equal(textParagraphs("Only one."), ["Only one."]));
        $(Assert.equal(textParagraphs("  \n\n ").size(), 0n));
        $(Assert.equal(textParagraphs("").size(), 0n));
    });

    test("a placement's tile: a listed component's own, none for one not listed; a visual's framed, named and iconed by its view, its source its meta; a text block's bare", $ => {
        const tiles = $.let(canvasTiles([kpiRail]));
        const sources = $.const(new Map([["orders", "Orders"]]));
        $(Assert.equal(contentTile(RAIL, tiles, sources), some({ frame: false, name: "KPI rail", icon: "gauge-high", meta: "" })));
        $(Assert.equal(contentTile(RETIRED, tiles, sources), none));
        $(Assert.equal(contentTile(LINE, tiles, sources), some({ frame: true, name: "Line chart · Orders", icon: "chart-line", meta: "Orders" })));
        $(Assert.equal(contentTile(NOTE, tiles, sources), some({ frame: false, name: "Text", icon: "align-left", meta: "" })));
    });

    test("whether a placement is framed is read by what it holds alone: a listed component as it chose, one not listed in a frame, a visual in one, a text block bare", $ => {
        const frames = $.let(componentFrames([kpiRail, trend]));
        $(Assert.equal(frames, new Map([["kpi_rail", false], ["revenue_trend", true]])));
        $(Assert.equal(contentFramed(RAIL, frames), false));
        $(Assert.equal(contentFramed(v.component("revenue_trend"), frames), true));
        $(Assert.equal(contentFramed(RETIRED, frames), true));
        $(Assert.equal(contentFramed(LINE, frames), true));
        $(Assert.equal(contentFramed(NOTE, frames), false));
    });
}, { platformFns: TestImpl });
