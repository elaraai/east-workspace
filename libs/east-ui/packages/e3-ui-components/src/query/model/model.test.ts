/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The query builder's model (#934), over #875's shared fixture
 * (`libs/east/test/fixtures/query-fixture.beast2`): P1 cards and words, P2
 * slot offers, P3 picking, P4 the generated description and the outline, P5
 * summaries. Summaries and counts are the real ones: #933's and #875's
 * programs evaluated over the fixture.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
    ArrayType, IntegerType, SortedMap, StringType, StructType, SummaryType, checkJq, compareFor, decodeBeast2, evaluateJq, fromEastTypeValue,
    isValueOf, none, some, variant, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { QueryStepsType } from "@elaraai/e3-ui/internal";
import { checkSteps } from "../steps/check.js";
import { countingProgram, readCounts, SOURCE_COUNT } from "../steps/count.js";
import { newStep } from "../steps/edit.js";
import { layOutSteps } from "../steps/print.js";
import { parseSteps } from "../steps/parse.js";
import type { Aggregate, ComparisonKind, Condition, PickField, Step, StepQuery, StepValue } from "../steps/values.js";
import { cardsFor, firstEmptySlot, outlineOf, sourceCard, type Card, type CardLine, type CardPart } from "./cards.js";
import type { SlotRef } from "./refs.js";
import { activeItem, applyAction, applyInput, applyRemove, applySlot, quickAddOptions, slotItems, stepOptions, type SlotItem } from "./slots.js";
import { SummaryCache, summaryAt, summaryNeeded, type Summary, type SummaryRequest } from "./summaries.js";
import { DESCRIPTION_MAX, describeQuery, parseErrorWords, plural, problemWords, queryWords, shapeWords } from "./words.js";

/** The shared fixture: its root type and its value. */
const fixture = decodeBeast2(readFileSync(join(import.meta.dirname, "../../../../../../east/test/fixtures/query-fixture.beast2")));
const ROOT: EastType = fromEastTypeValue(fixture.type);
const W = queryWords(formatters("en-AU"));

// ─── Building steps as East values ───────────────────────────────────────────

let ids = 0;
const id = (prefix: string): string => `${prefix}${++ids}`;
const text = (value: string): StepValue => variant("text", value);
const num = (value: number): StepValue => variant("number", value);
function cond(field: string, cmp: ComparisonKind, value?: StepValue, inner?: Condition): Condition {
    return variant("test", { id: id("c"), field: some(field), cmp: some(variant(cmp, null)), value: value === undefined ? none : some(value), inner: inner === undefined ? none : some(inner), whole: false }) as Condition;
}
const wholeCond = (field: string, value: StepValue): Condition =>
    variant("test", { id: id("c"), field: some(field), cmp: some(variant("eq", null)), value: some(value), inner: none, whole: true }) as Condition;
const blank = (): Condition => variant("test", { id: id("c"), field: none, cmp: none, value: none, inner: none, whole: false }) as Condition;
const group = (match: "all" | "any", conds: Condition[]): Condition => variant("group", { id: id("c"), match: variant(match, null), conds }) as Condition;
const filter = (match: "all" | "any", conds: Condition[]): Step => variant("filter", { id: id("s"), match: variant(match, null), conds });
const lookup = (dataset: string, key: string, fields: string[]): Step => variant("lookup", { id: id("s"), dataset: some(dataset), key: some(key), fields });
const agg = (fn: "count" | "sum" | "mean" | "min" | "max" | "distinct", field: string | undefined, as: string): Aggregate =>
    ({ id: id("a"), fn: variant(fn, null), field: field === undefined ? none : some(field), as });
const groupBy = (by: string | undefined, aggs: Aggregate[]): Step =>
    variant("group", { id: id("s"), by: some(by === undefined ? variant("all", null) : variant("field", by)), aggs });
const sort = (field: string, dir: "asc" | "desc"): Step => variant("sort", { id: id("s"), field: some(field), dir: variant(dir, null) });
const limit = (n: number): Step => variant("limit", { id: id("s"), n: variant("number", n) });
const count = (): Step => variant("count", { id: id("s") });
const pf = (field: string, as: string): PickField => ({ id: id("p"), field: some(field), as });
const pick = (fields: PickField[]): Step => variant("pick", { id: id("s"), fields });
const fill = (field: string, value: StepValue): Step => variant("fill", { id: id("s"), field: some(field), value: some(value) });
const drill = (field: string): Step => variant("drill", { id: id("s"), field: some(field) });
const datepart = (field: string, part: "year" | "month" | "weekday", as: string): Step =>
    variant("datepart", { id: id("s"), field: some(field), part: variant(part, null), as });
const walk = (via: string): Step => variant("walk", { id: id("s"), via: some(via) });
const tabulate = (over: string, from: number, to: number, by: number, fixed: [string, StepValue][], as: string): Step =>
    variant("tabulate", { id: id("s"), over, from: variant("number", from), to: variant("number", to), step: variant("number", by), fixed: new SortedMap(fixed, compareFor(StringType)), as });
const jq = (code: string): Step => variant("jq", { id: id("s"), text: code });
const query = (source: string, steps: Step[]): StepQuery => ({ source, steps });

/** The query editor mock's default query (`Query Editor Spec.md` §4.7). */
const topShippedOrders = (): StepQuery => query("orders", [
    filter("all", [cond("status", "eq", text("shipped")), cond("total", "ge", num(100)), cond("status.shipped.date", "inYear", num(2026))]),
    lookup("customers", "customer_id", ["name", "region"]),
    pick([pf("id", "order"), pf("name", "customer"), pf("region", "region"), pf("total", "total"), pf("status.shipped.date", "shipped")]),
    sort("total", "desc"),
    limit(10),
]);

/** The mock's saved and recent queries (`Query Editor Spec.md` §6), with the descriptions the mock's authors wrote. */
const MOCK: readonly { name: string; build: () => StepQuery; author?: string }[] = [
    { name: "Top shipped orders, 2026", build: topShippedOrders },
    {
        name: "Revenue by region", author: "Top 3 regions by shipped revenue in 2026, from orders of $100 or more.",
        build: () => query("orders", [
            filter("all", [cond("status", "eq", text("shipped")), cond("total", "ge", num(100)), cond("status.shipped.date", "inYear", num(2026))]),
            lookup("customers", "customer_id", ["region"]),
            groupBy("region", [agg("sum", "total", "revenue"), agg("count", undefined, "orders")]),
            sort("revenue", "desc"),
            limit(3),
        ]),
    },
    {
        name: "Shipped revenue by month",
        build: () => query("orders", [
            filter("all", [cond("status", "eq", text("shipped"))]),
            datepart("status.shipped.date", "month", "ship_month"),
            groupBy("ship_month", [agg("sum", "total", "revenue"), agg("count", undefined, "orders")]),
            sort("ship_month", "asc"),
        ]),
    },
    {
        name: "Large orders with no discount",
        build: () => query("orders", [
            filter("all", [cond("total", "ge", num(1000)), cond("discount", "missing")]),
            pick([pf("id", "id"), pf("customer_id", "customer_id"), pf("total", "total"), pf("status", "status")]),
            sort("total", "desc"),
        ]),
    },
    {
        name: "Units by SKU",
        build: () => query("orders", [drill("lines"), groupBy("sku", [agg("sum", "qty", "units"), agg("distinct", "order_id", "orders")]), sort("units", "desc")]),
    },
    {
        name: "Pump parts cost", author: "Total cost, part count and dearest part in the PUMP-A bill of materials.",
        build: () => query("bom", [walk("children"), groupBy(undefined, [agg("sum", "cost", "total_cost"), agg("count", undefined, "parts"), agg("max", "cost", "dearest")])]),
    },
    {
        name: "Demand at $10–$12, NSW", author: "Modelled demand in NSW at prices from $10 to $12, in $0.50 steps.",
        build: () => query("model", [tabulate("price", 10, 12, 0.5, [["region", text("NSW")]], "demand")]),
    },
    { name: "Cancelled orders", build: () => query("orders", [filter("all", [cond("status", "eq", text("cancelled"))]), count()]) },
    {
        name: "Orders shipped in 2026 (draft)",
        build: () => query("orders", [filter("all", [cond("total", "ge", num(100)), cond("status.shipped.date", "inYear", num(2026))]), sort("total", "desc")]),
    },
    {
        name: "Gold customers or big orders",
        build: () => query("orders", [
            lookup("customers", "customer_id", ["name", "tier"]),
            filter("all", [cond("status", "ne", text("cancelled")), group("any", [cond("tier", "eq", text("gold")), cond("total", "ge", num(1500))])]),
            pick([pf("id", "id"), pf("name", "customer"), pf("tier", "tier"), pf("total", "total")]),
        ]),
    },
];

/** One of the mock's queries by name. */
function mock(name: string): StepQuery {
    const found = MOCK.find(m => m.name === name);
    if (found === undefined) throw new Error(`no mock query ${name}`);
    return found.build();
}

// ─── Reading cards ───────────────────────────────────────────────────────────

/** A part as a compact token: `[field:status]`, `[value:_value]` while empty, `#` for data in mono, `!` for a problem. */
function partText(p: CardPart): string {
    switch (p.t) {
        case "word": return p.joiner === true ? `<${p.text}>` : p.text;
        case "slot": return `[${p.slot.kind}:${p.empty ? `_${p.placeholder}` : p.text}${p.mono ? "#" : ""}${p.error ? "!" : ""}]`;
        case "input": return `{${p.input.kind}:${p.value}${p.error ? "!" : ""}}`;
        case "chip": return `(${p.text})`;
        case "add": return `+${p.text}`;
        case "remove": return "×";
        case "code": return `\`${p.text}\``;
    }
}

/** A card's lines as text, a group's lines indented under it. */
function linesText(lines: readonly CardLine[], indent = ""): string[] {
    return lines.flatMap(line => [
        `${indent}${line.kind}: ${[...(line.head === undefined ? [] : [...line.head.map(partText), "|"]), ...line.parts.map(partText)].join(" ")}`,
        ...line.problems.map(p => `${indent}  ! ${p.text}${p.fixes.length === 0 ? "" : ` [${p.fixes.map(f => f.label).join(" | ")}]`}`),
        ...linesText(line.lines ?? [], `${indent}  `),
    ]);
}

/** A card as text: its title, head and lines. */
function cardText(card: Card): string[] {
    return [`${card.title}${card.head.length === 0 ? "" : ` | ${card.head.map(partText).join(" ")}`}`, ...linesText(card.lines)];
}

/** A query's cards, checked. */
function cardsOf(q: StepQuery, counts?: ReadonlyMap<string, number>): Card[] {
    return cardsFor(q, ROOT, checkSteps(q, ROOT), W, counts);
}

/** The rows a run counts at each stage: the counting program evaluated over the fixture. */
function countsOf(q: StepQuery): ReadonlyMap<string, number> {
    const plain = layOutSteps(q, ROOT).printed.text;
    const resultType = checkJq(plain, ROOT, { root: true }).elementType!;
    const OutputType = StructType({ counts: ArrayType(IntegerType), result: resultType });
    const { text: program, counted } = countingProgram(q, ROOT);
    const output = evaluateJq(program, fixture.value, { inputType: ROOT, root: true });
    if (!isValueOf(output, OutputType)) throw new Error("the counting program gives {counts, result}");
    return readCounts(output as ValueTypeOf<typeof OutputType>, counted).counts;
}

/** The summary of the rows a step takes: the summary program evaluated over the fixture. */
function summaryOf(q: StepQuery, stepIndex: number): Summary {
    const request = summaryAt(q, stepIndex, ROOT);
    if (request === undefined) throw new Error("no summary there");
    const output = evaluateJq(request.program, fixture.value, { inputType: ROOT, root: true });
    if (!isValueOf(output, SummaryType)) throw new Error("the summary program gives a Summary");
    return output as Summary;
}

/** The plain words of every problem of a query, unfinished slots included. */
function problems(q: StepQuery): { text: string; fixes: string[] }[] {
    const checked = checkSteps(q, ROOT);
    return checked.diagnostics.filter(d => d.severity !== "note" || d.code === "custom").map(d => {
        const w = problemWords(d, q, ROOT, checked, W);
        return { text: w.text, fixes: w.fixes.map(f => f.label) };
    });
}

// ─── P1: cards and words ─────────────────────────────────────────────────────

describe("P1: cards and words", () => {
    test("the default query's cards: titles, rows, data in mono, and its shape lines", () => {
        const q = topShippedOrders();
        const cards = cardsOf(q);
        expect(cards.map(c => [c.title, c.icon])).toEqual([
            ["Keep rows where", "filter"], ["Look up from another dataset", "arrow-right-arrow-left"], ["Show only these fields", "table-columns"],
            ["Sort", "arrow-down-wide-short"], ["Keep the first", "list-ol"],
        ]);
        expect(cards.map(cardText)).toEqual([
            [
                "Keep rows where | [match:all] of these are true",
                "row: <> [field:status] [cmp:is] [value:shipped] ×",
                "row: <and> [field:total] [cmp:is at least] [value:100#] ×",
                "row: <and> [field:shipped date] [cmp:is in year] [value:2026#] ×",
                "foot: +Add condition +Add group",
            ],
            [
                "Look up from another dataset",
                "row: find [key:customer ID] in [dataset:customers]",
                "row: bring in (name) (region) +Add field",
                "note: Left empty when a customer isn't found.",
            ],
            [
                "Show only these fields",
                "row: [pick-field:ID] as {pick-as:order} ×",
                "row: [pick-field:name] as {pick-as:customer} ×",
                "row: [pick-field:region] as {pick-as:region} ×",
                "row: [pick-field:total] as {pick-as:total} ×",
                "row: [pick-field:shipped date] as {pick-as:shipped} ×",
                "foot: +Add field",
            ],
            ["Sort", "row: by [sort-field:total] [dir:highest first]"],
            ["Keep the first", "row: {limit-n:10} orders"],
        ]);
        expect(cards.map(c => [c.shape.text, c.shape.extra, c.shape.counted])).toEqual([
            ["Many shipped orders", "", false],
            ["Many shipped orders", "+ name, region", false],
            ["Many orders", "order, customer, region, total, shipped", false],
            ["Many orders", "", false],
            ["Up to 10 orders", "", false],
        ]);
        expect(cards.every(c => c.complete && c.errors === 0 && c.warnings === 0)).toBe(true);
        const source = sourceCard(q, ROOT, checkSteps(q, ROOT), W);
        expect([source.title, source.kind, source.shape.text]).toEqual(["Start with orders", "list of orders", "Many orders"]);
        expect(source.shape.type.split("\n").slice(0, 3)).toEqual([".  Array<Struct{…}>", "  []  Struct{customer_id, discount, id, lines, status, total}", "    [].customer_id  String"]);
    });

    test("after a fresh run each shape line counts its rows: 40, 16, 16, 16, 16, 10", () => {
        const q = topShippedOrders();
        const counts = countsOf(q);
        const cards = cardsOf(q, counts);
        expect(sourceCard(q, ROOT, checkSteps(q, ROOT), W, counts).shape.text).toBe("40 orders");
        expect(counts.get(SOURCE_COUNT)).toBe(40);
        expect(cards.map(c => [c.shape.text, c.shape.counted])).toEqual([
            ["16 shipped orders", true], ["16 shipped orders", true], ["16 orders", true], ["16 orders", true], ["10 orders", true],
        ]);
    });

    test("every saved and recent query of §6: its titles and shape lines", () => {
        const shapes = MOCK.map(m => [m.name, cardsOf(m.build()).map(c => `${c.title} → ${c.shape.text}${c.shape.extra === "" ? "" : ` · ${c.shape.extra}`}`)]);
        expect(shapes).toEqual([
            ["Top shipped orders, 2026", [
                "Keep rows where → Many shipped orders", "Look up from another dataset → Many shipped orders · + name, region",
                "Show only these fields → Many orders · order, customer, region, total, shipped", "Sort → Many orders", "Keep the first → Up to 10 orders",
            ]],
            ["Revenue by region", [
                "Keep rows where → Many shipped orders", "Look up from another dataset → Many shipped orders · + region",
                "Group and total → Many regions · region, revenue, orders", "Sort → Many regions", "Keep the first → Up to 3 regions",
            ]],
            ["Shipped revenue by month", [
                "Keep rows where → Many shipped orders", "Take part of a date → Many shipped orders · + ship month",
                "Group and total → Many ship months · ship month, revenue, orders", "Sort → Many ship months",
            ]],
            ["Large orders with no discount", [
                "Keep rows where → Many orders", "Show only these fields → Many orders · ID, customer ID, total, status", "Sort → Many orders",
            ]],
            ["Units by SKU", [
                "Open each order's list → Many lines · price, qty, SKU, order ID", "Group and total → Many SKUs · SKU, units, orders", "Sort → Many SKUs",
            ]],
            ["Pump parts cost", ["List every part in the tree → Many boms · cost, SKU", "Group and total → One record"]],
            ["Demand at $10–$12, NSW", ["Try the model over a range → Many prices · price, demand"]],
            ["Cancelled orders", ["Keep rows where → Many cancelled orders", "Count the rows → One whole number"]],
            ["Orders shipped in 2026 (draft)", ["Keep rows where → Many orders", "Sort → Many orders"]],
            ["Gold customers or big orders", [
                "Look up from another dataset → Many orders · + name, tier", "Keep rows where → Many orders",
                "Show only these fields → Many orders · ID, customer, tier, total",
            ]],
        ]);
    });

    test("the other step kinds' rows", () => {
        expect(cardsOf(mock("Gold customers or big orders")).map(cardText)[1]).toEqual([
            "Keep rows where | [match:all] of these are true",
            "row: <> [field:status] [cmp:is not] [value:cancelled] ×",
            "group: [group-match:any] of these is true × | <and>",
            "  row: <> [field:tier] [cmp:is] [value:gold] ×",
            "  row: <or> [field:total] [cmp:is at least] [value:1500#] ×",
            "  foot: +Add condition",
            "foot: +Add condition +Add group",
        ]);
        expect(cardsOf(mock("Revenue by region")).map(cardText)[2]).toEqual([
            "Group and total",
            "row: by [by:region]",
            "row: then [agg-fn:add up] [agg-field:total] as {agg-as:revenue} ×",
            "row: and [agg-fn:count] as {agg-as:orders} ×",
            "foot: +Add a total",
        ]);
        expect(cardsOf(mock("Shipped revenue by month")).map(cardText)[1]).toEqual([
            "Take part of a date", "row: take the [part:month] of [date-field:shipped date] as {datepart-as:ship_month}",
        ]);
        expect(cardsOf(mock("Units by SKU")).map(cardText)[0]).toEqual(["Open each order's list", "row: open [drill-field:lines] one row per line, keeping the order ID"]);
        expect(cardsOf(mock("Pump parts cost")).map(cardText)[0]).toEqual(["List every part in the tree", "row: every level, keeping cost and SKU"]);
        expect(cardsOf(mock("Demand at $10–$12, NSW")).map(cardText)[0]).toEqual([
            "Try the model over a range",
            "row: price from {tab-from:10} to {tab-to:12} every {tab-step:0.5}",
            "row: region [fixed:NSW]",
            "row: call the result {tab-as:demand}",
        ]);
        expect(cardsOf(mock("Cancelled orders")).map(cardText)[1]).toEqual(["Count the rows", "row: gives one whole number"]);
        expect(cardsOf(query("orders", [fill("discount", num(0))])).map(cardText)[0]).toEqual(["Fill in missing values", "row: where [fill-field:discount] is missing, use {fill-value:0}"]);
        expect(cardsOf(query("orders", [jq("map(.id)")])).map(cardText)[0]).toEqual(["jq step", "code: `map(.id)`", "  ! Custom jq step."]);
    });

    test("an unfinished step: empty slots with their placeholders, dashed, and no problem lines for what is unfinished", () => {
        const before = layOutSteps(query("orders", []), ROOT).source;
        const q = query("orders", [newStep("filter", before, ROOT), newStep("sort", before, ROOT), newStep("group", before, ROOT)]);
        const cards = cardsOf(q);
        expect(cards.map(cardText)).toEqual([
            ["Keep rows where", "row: <> [field:_field] ×", "foot: +Add condition +Add group"],
            ["Sort", "row: by [sort-field:_field] [dir:highest first]"],
            ["Group and total", "row: by [by:_field]", "row: then [agg-fn:count] as {agg-as:count} ×", "foot: +Add a total"],
        ]);
        expect(cards.map(c => [c.complete, c.errors, c.warnings])).toEqual([[false, 0, 0], [false, 0, 0], [false, 0, 0]]);
        expect(cards.map(c => firstEmptySlot(c)?.kind)).toEqual(["field", "sort-field", "by"]);
    });

    test("a problem sits under the row that caused it, its slot marked, with its fixes in plain words", () => {
        const [card] = cardsOf(mock("Orders shipped in 2026 (draft)"));
        expect(cardText(card!)).toEqual([
            "Keep rows where | [match:all] of these are true",
            "row: <> [field:total] [cmp:is at least] [value:100#] ×",
            "row: <and> [field:shipped date!] [cmp:is in year] [value:2026#] ×",
            "  ! Only shipped orders have a shipped date. [Keep only shipped orders first]",
            "foot: +Add condition +Add group",
        ]);
        expect([card!.errors, card!.warnings]).toEqual([1, 0]);
    });

    test("every row of §4.6's table, in plain words, with its fixes", () => {
        const say = (q: StepQuery): string[] => problems(q).map(p => (p.fixes.length === 0 ? p.text : `${p.text} [${p.fixes.join(" | ")}]`));
        expect(say(query("orders", [count(), sort("total", "asc")]))).toEqual(["One whole number — there are no rows to sort here. [Remove this step]"]);
        expect(say(query("orders", [filter("all", [blank()])]))).toEqual(["Choose a field."]);
        expect(say(query("orders", [sort("lines", "asc")]))).toEqual(["Lines is list of lines — pick a field to sort by."]);
        expect(say(query("orders", [filter("all", [cond("totl", "ge", num(1))])]))).toEqual(["There's no “totl” here. The rows have customer ID, discount, ID, lines, status, total. [Use total]"]);
        expect(say(mock("Orders shipped in 2026 (draft)"))).toEqual(["Only shipped orders have a shipped date. [Keep only shipped orders first]"]);
        expect(say(query("orders", [filter("all", [cond("status", "eq", text("shiped"))])]))).toEqual(["Status can be cancelled, pending and shipped — not “shiped”. [Use shipped]"]);
        expect(say(query("orders", [filter("all", [wholeCond("status", text("shipped"))])]))).toEqual(["Compare the status case, not the whole value. [Use .status.type]"]);
        expect(say(query("orders", [filter("all", [cond("total", "ge")])]))).toEqual(["Enter a value."]);
        expect(say(query("orders", [filter("all", [variant("test", { id: id("c"), field: some("total"), cmp: none, value: none, inner: none, whole: false }) as Condition])]))).toEqual(["Choose how to compare."]);
        expect(say(query("orders", [filter("all", [cond("total", "contains", text("1"))])]))).toEqual(["“contains” doesn't work on number."]);
        expect(say(query("orders", [filter("all", [cond("lines", "lengthAtLeast", num(1.5))])]))).toEqual(["Enter a whole number of items."]);
        const shipped = (c: Condition): StepQuery => query("orders", [filter("all", [cond("status", "eq", text("shipped")), c])]);
        expect(say(shipped(cond("status.shipped.date", "inYear", text("next year"))))).toEqual(["Enter a year, like 2026."]);
        expect(say(shipped(cond("status.shipped.date", "inMonth", text("2026-13"))))).toEqual(["Enter a month, like 2026-03."]);
        expect(say(shipped(cond("status.shipped.date", "onOrAfter", text("2026-13-01"))))).toEqual(["Enter a date, like 2026-03-01."]);
        expect(say(query("orders", [filter("all", [cond("total", "ge", text("abc"))])]))).toEqual(["Total is a number — “abc” isn't one."]);
        expect(say(query("orders", [filter("all", [cond("id", "eq", num(1.5))])]))).toEqual(["ID is a whole number, so it can never equal 1.5."]);
        expect(say(query("orders", [filter("any", [cond("lines", "anyWhere"), group("all", [])]), filter("all", [])]))).toEqual([
            "Finish the inner condition.", "This group is empty.", "Add a condition, or remove this step.",
        ]);
        expect(say(query("orders", [lookup("orders", "customer_id", ["total"])]))).toEqual(["Orders can't be looked up by key."]);
        expect(say(query("orders", [lookup("customers", "id", ["name"])]))).toEqual(["Customers are found by text ids, but ID is a whole number."]);
        expect(say(query("orders", [lookup("customers", "customer_id", ["nme"])]))).toEqual(["Customer records have no “nme”. [Use name]"]);
        expect(say(query("orders", [variant("group", { id: id("s"), by: none, aggs: [] })]))).toEqual(["Choose what to group by."]);
        expect(say(query("orders", [groupBy("status", [agg("sum", "customer_id", "sum")])]))).toEqual(["Can't add up customer ID — it's text. Pick a number, or count instead. [Use discount | Use ID]"]);
        expect(say(query("orders", [groupBy("customer_id", [agg("max", "lines", "most")])]))).toEqual(["Lines has no lowest or highest."]);
        expect(say(query("orders", [groupBy("customer_id", [agg("count", undefined, "customer_id")])]))).toEqual(["Two fields are called customer_id; the last one wins."]);
        expect(say(query("orders", [limit(0)]))).toEqual(["Keep the first needs a whole number, 1 or more."]);
        expect(say(query("orders", [fill("total", num(0))]))).toEqual(["Total is never missing, so this changes nothing."]);
        expect(say(query("orders", [walk("lines")]))).toEqual(["There is no tree to walk here."]);
        expect(say(query("orders", [tabulate("price", 10, 12, 0.5, [], "demand")]))).toEqual(["There is no calculation to try here."]);
        expect(say(query("model", [tabulate("price", 12, 10, 0.5, [["region", text("NSW")]], "demand")]))).toEqual(["The range needs a start below the end and a step above 0."]);
        expect(say(query("model", [tabulate("price", 0, 2000, 1, [["region", text("NSW")]], "demand")]))).toEqual(["That range gives more than 1,000 rows; results will be cut off."]);
        expect(say(query("orders", [jq("map(.id)")]))).toEqual(["Custom jq step."]);
        expect(say(query("orders", [jq("map(debug)")]))).toEqual(["debug isn't available in queries.", "Custom jq step."]);
        expect(say(query("orders", [jq("map(select(.lines[] | .qty > 1))")]))).toEqual(["Rows can appear more than once. [Use any(.lines[]; …)]", "Custom jq step."]);
    });

    test("the program's problems, from the parser's own sentences (QUERY.md §12)", () => {
        const words = (program: string): string => {
            const parsed = parseSteps(program, ROOT);
            if (!("error" in parsed)) throw new Error(`parsed: ${program}`);
            return parseErrorWords(parsed.error, W);
        };
        expect(words(".orders | map(.id))")).toBe("The jq has a stray bracket.");
        expect(words(".orders | map(\"x)")).toBe("A text value is missing its closing quote.");
        expect(words(".orders | map(")).toBe("A bracket is never closed.");
        expect(words(".orders |")).toBe("The query ends with a pipe.");
        expect(words("")).toBe("The query is empty.");
        expect(words(".ordrs")).toBe("There's no data source called “ordrs”.");
        expect(words(". | length")).toBe("Start the query from a data source.");
    });

    test("shape words and plurals", () => {
        expect(["order", "category", "status", "box", "sku", "lines"].map(plural)).toEqual(["orders", "categories", "statuses", "boxes", "skus", "lines"]);
        const shapes = layOutSteps(query("bom", []), ROOT);
        expect(shapeWords(shapes.source, W)).toBe("One bom tree");
        expect(shapeWords(layOutSteps(query("model", []), ROOT).source, W)).toBe("One calculation");
        expect(shapeWords(layOutSteps(query("customers", []), ROOT).source, W)).toBe("One lookup table");
    });
});

// ─── P2: slot offers ─────────────────────────────────────────────────────────

/** An offer as a line: its group, label, detail, note, meta and whether it is disabled — the locale's thin spaces as spaces. */
function itemText(item: SlotItem): string {
    const line = `${item.group} | ${item.label}${item.detail === undefined ? "" : ` — ${item.detail}`}${item.note === undefined ? "" : ` (${item.note})`}${item.meta === undefined ? "" : ` · ${item.meta}`}${item.disabled === true ? " DISABLED" : ""}`;
    return line.replace(/[   ]/g, " ");
}

describe("P2: slot offers", () => {
    const q = topShippedOrders();
    const [f0, f1, f2, f3, f4] = q.steps as [Step, Step, Step, Step, Step];
    const conds = f0.type === "filter" ? f0.value.conds : [];
    const at = (slot: SlotRef, typed = "", stepIndex = q.steps.findIndex(s => s.value.id === slot.stepId)): string[] =>
        slotItems(q, ROOT, slot, typed, { words: W, summary: summaryOf(q, Math.max(0, stepIndex)), sizes: new Map([["customers", 8]]) }).map(itemText);

    test("a condition's fields: plain kinds, summaries, and a payload's case", () => {
        expect(at({ kind: "field", stepId: f0.value.id, condId: conds[1]!.value.id })).toEqual([
            "Fields | customer ID — text · 8 values",
            "Fields | discount — number, sometimes missing · 0.05 – 0.15 · 27 missing",
            "Fields | ID — whole number · 1001 – 1040",
            "Fields | lines — list of lines · 1–4 each",
            "Fields | status — one of cancelled, pending, shipped · 3 cases",
            "Inside status | cancelled reason — text, sometimes missing (cancelled orders only) · 3 values",
            // Narrowed by the filter's own case condition, as its jq prints it first.
            "Inside status | shipped date — date · 14 Oct 2025 – 26 June 2026",
            "Fields | total — number · 36.26 – 3,646.84",
        ]);
    });

    test("comparisons by the field's kind", () => {
        expect(at({ kind: "cmp", stepId: f0.value.id, condId: conds[0]!.value.id })).toEqual(["Compare | is", "Compare | is not"]);
        expect(at({ kind: "cmp", stepId: f0.value.id, condId: conds[2]!.value.id })).toEqual([
            "Compare | is in year", "Compare | is in month", "Compare | is on or after", "Compare | is before",
        ]);
    });

    test("values from the summary: cases, numbers, years; and a value typed, first", () => {
        expect(at({ kind: "value", stepId: f0.value.id, condId: conds[0]!.value.id })).toEqual(["Cases | cancelled · 3 orders", "Cases | pending · 14 orders", "Cases | shipped · 23 orders"]);
        expect(at({ kind: "value", stepId: f0.value.id, condId: conds[1]!.value.id })).toEqual([
            "From the data | 36.26 · lowest", "From the data | 1,027.40 · median", "From the data | 1,056.26 · average", "From the data | 3,646.84 · highest",
        ]);
        expect(at({ kind: "value", stepId: f0.value.id, condId: conds[2]!.value.id })).toEqual(["Years in the data | 2025 · 4 orders", "Years in the data | 2026 · 19 orders"]);
        const typed = slotItems(q, ROOT, { kind: "value", stepId: f0.value.id, condId: conds[1]!.value.id }, "1,500", { words: W, summary: summaryOf(q, 0) });
        expect(typed.map(itemText)).toEqual(["Typed | Use “1,500”"]);
        expect(typed[0]!.value).toEqual({ kind: "value", value: variant("number", 1500) });
    });

    test("Look up, Group and total, Sort, Show only fields, Fill, Open each list, Take part of a date", () => {
        // The summary is of the rows the Look up takes: the 16 shipped orders of 2026, from 7 customers.
        expect(at({ kind: "key", stepId: f1.value.id })).toEqual(["Fields | customer ID — text · 7 values"]);
        // Every lookup table of the root: the fixture's root holds two more beside customers.
        expect(at({ kind: "dataset", stepId: f1.value.id })).toEqual(["Lookup tables | byId", "Lookup tables | cells", "Lookup tables | customers · 8 customers"]);
        expect(at({ kind: "lookup-add", stepId: f1.value.id })).toEqual(["From customers | tier — one of gold, standard"]);
        // The sort takes the 16 shipped orders of 2026, shown by their own names.
        expect(at({ kind: "sort-field", stepId: f3.value.id }).slice(0, 2)).toEqual(["Fields | order — whole number · 1002 – 1039", "Fields | customer — text, sometimes missing · 7 values"]);
        expect(at({ kind: "dir", stepId: f3.value.id })).toEqual(["Order | highest first", "Order | lowest first"]);
        // The fields not yet shown, summarised over the 16 shipped orders the step takes.
        expect(at({ kind: "pick-add", stepId: f2.value.id })).toEqual([
            "Fields | customer ID — text · 7 values", "Fields | discount — number, sometimes missing · 0.05 – 0.10 · 11 missing",
            "Fields | lines — list of lines · 1–4 each", "Fields | status — one of cancelled, pending, shipped · 1 case",
            "Inside status | cancelled reason — text, sometimes missing (cancelled orders only) · 0 values",
        ]);
        const rev = mock("Revenue by region");
        const g = rev.steps[2]!;
        const revAt = (slot: SlotRef): string[] => slotItems(rev, ROOT, slot, "", { words: W, summary: summaryOf(rev, 2) }).map(itemText);
        expect(revAt({ kind: "by", stepId: g.value.id }).slice(0, 2)).toEqual(["Group | all rows together — one row of totals", "Fields | customer ID — text · 7 values"]);
        const [sum, cnt] = g.type === "group" ? g.value.aggs : [];
        expect(revAt({ kind: "agg-fn", stepId: g.value.id, id: sum!.id })).toEqual([
            "Total | add up", "Total | count", "Total | average", "Total | lowest", "Total | highest", "Total | count different",
        ]);
        expect(revAt({ kind: "agg-field", stepId: g.value.id, id: sum!.id })).toEqual([
            "Fields | discount — number, sometimes missing · 0.05 – 0.10 · 11 missing", "Fields | ID — whole number · 1002 – 1039",
            "Fields | total — number · 210.80 – 2,381.61",
        ]);
        expect(cnt!.fn.type).toBe("count");
        const fills = query("orders", [fill("discount", num(0))]);
        expect(slotItems(fills, ROOT, { kind: "fill-field", stepId: fills.steps[0]!.value.id }, "", { words: W }).map(itemText)).toEqual(["Fields | discount — number, sometimes missing"]);
        const drills = query("orders", [drill("lines")]);
        expect(slotItems(drills, ROOT, { kind: "drill-field", stepId: drills.steps[0]!.value.id }, "", { words: W }).map(itemText)).toEqual(["Fields | lines — list of lines"]);
        const parts = mock("Shipped revenue by month");
        const dp = parts.steps[1]!;
        expect(slotItems(parts, ROOT, { kind: "part", stepId: dp.value.id }, "", { words: W }).map(itemText)).toEqual(["Part | year · 2026", "Part | month · 2026-03", "Part | weekday · Tuesday"]);
        expect(slotItems(parts, ROOT, { kind: "date-field", stepId: dp.value.id }, "", { words: W }).map(itemText)).toEqual(["Inside status | shipped date — date"]);
    });

    test("the tree's list, the model's other inputs, and a match", () => {
        const bom = query("bom", [walk("children")]);
        expect(slotItems(bom, ROOT, { kind: "via", stepId: bom.steps[0]!.value.id }, "", { words: W }).map(itemText)).toEqual(["Fields | children — list of children"]);
        const model = mock("Demand at $10–$12, NSW");
        const tab = model.steps[0]!;
        expect(slotItems(model, ROOT, { kind: "fixed", stepId: tab.value.id, id: "region" }, "VIC", { words: W }).map(itemText)).toEqual(["Typed | Use “VIC”"]);
        expect(at({ kind: "match", stepId: f0.value.id })).toEqual(["Match | all — every condition holds", "Match | any — at least one holds"]);
    });

    test("the steps that fit, and why the others don't", () => {
        const fits = (source: string): string[] => stepOptions(layOutSteps(query(source, []), ROOT).source, ROOT, W).map(o => `${o.label}${o.fits ? "" : ` (${o.reason})`}`);
        expect(fits("orders")).toEqual([
            "Keep rows where…", "Look up from another dataset…", "Group and total…", "Sort by…", "Keep the first…", "Count the rows", "Show only some fields…",
            "Fill in missing values…", "Open each order's list…", "Take part of a date…", "List every part in the tree (Needs a tree of parts)",
            "Try the model over a range… (Needs a calculation)",
        ]);
        expect(fits("bom").slice(0, 2)).toEqual(["Keep rows where… (Needs rows — the query gives one bom tree here)", "Look up from another dataset… (Needs rows — the query gives one bom tree here)"]);
        expect(fits("bom").slice(10)).toEqual(["List every part in the tree", "Try the model over a range… (Needs a calculation)"]);
        expect(quickAddOptions(layOutSteps(query("model", []), ROOT).source, ROOT, W).map(o => `${o.label}${o.fits ? "" : " ×"}`)).toEqual([
            "Keep rows ×", "Group and total ×", "Sort by ×", "Keep the first ×", "Show only fields ×", "Try the model over a range",
        ]);
    });

    test("a query with no steps offers up to five saved queries on its source", () => {
        const empty = query("orders", []);
        const saved = [
            ...["a", "b", "c", "d", "e", "f"].map(n => ({ name: `orders ${n}`, source: "orders", when: "Saved · today" })),
            { name: "Pump parts cost", source: "bom" },
        ];
        const items = slotItems(empty, ROOT, { kind: "add-step", stepId: "" }, "", { words: W, saved });
        expect(items.filter(i => i.value.kind === "saved").map(itemText)).toEqual([
            "Start from a saved query | orders a — Saved · today", "Start from a saved query | orders b — Saved · today", "Start from a saved query | orders c — Saved · today",
            "Start from a saved query | orders d — Saved · today", "Start from a saved query | orders e — Saved · today",
        ]);
        expect(slotItems(q, ROOT, { kind: "add-step", stepId: "", at: 5 }, "", { words: W, saved }).some(i => i.value.kind === "saved")).toBe(false);
    });

    test("the active offer is the slot's own value, else the first that can be picked", () => {
        const slot: SlotRef = { kind: "field", stepId: f0.value.id, condId: conds[1]!.value.id };
        const items = slotItems(q, ROOT, slot, "", { words: W });
        expect(items[activeItem(items, q, ROOT, slot)]!.label).toBe("total");
        const add: SlotRef = { kind: "add-step", stepId: "", at: 0 };
        const steps = slotItems(query("bom", []), ROOT, add, "", { words: W });
        expect(steps[activeItem(steps, query("bom", []), ROOT, add)]!.label).toBe("List every part in the tree");
    });

    test("opening a slot fetches a summary only where its offers need one", () => {
        expect((["field", "value", "by", "agg-field", "sort-field", "pick-add"] as const).every(summaryNeeded)).toBe(true);
        expect((["cmp", "match", "dataset", "dir", "part", "add-step"] as const).some(summaryNeeded)).toBe(false);
        void f4;
    });
});

// ─── P3: picking ─────────────────────────────────────────────────────────────

/** The one filter's test conditions' slots, as text. */
function filterRows(q: StepQuery, index = 0): string[] {
    return cardText(cardsOf(q)[index]!).slice(1);
}

describe("P3: picking, typing, removing and adding", () => {
    const pickOf = (q: StepQuery, slot: SlotRef, label: string, typed = ""): ReturnType<typeof applySlot> => {
        const item = slotItems(q, ROOT, slot, typed, { words: W }).find(i => i.label === label);
        if (item === undefined) throw new Error(`no offer ${label}`);
        return applySlot(q, slot, item, ROOT, W);
    };

    test("a field keeps the comparison and value of its kind; another starts from its own and opens its value", () => {
        const c = cond("total", "ge", num(100));
        const q = query("orders", [filter("all", [c])]);
        const sameKind = pickOf(q, { kind: "field", stepId: q.steps[0]!.value.id, condId: c.value.id }, "ID");
        expect(filterRows(sameKind.query)[0]).toBe("row: <> [field:ID] [cmp:is at least] [value:100#] ×");
        expect(sameKind.open).toBeUndefined();
        const narrowed = query("orders", [filter("all", [cond("status", "eq", text("shipped")), c])]);
        const date = pickOf(narrowed, { kind: "field", stepId: narrowed.steps[0]!.value.id, condId: c.value.id }, "shipped date");
        expect(filterRows(date.query)[1]).toBe("row: <and> [field:shipped date] [cmp:is in year] [value:_value] ×");
        expect(date.open).toEqual({ kind: "value", stepId: narrowed.steps[0]!.value.id, condId: c.value.id });
    });

    test("a list starts with has at least 1; has any where opens its inner condition, and the inner field its value", () => {
        const c = blank();
        const q = query("orders", [filter("all", [c])]);
        const stepId = q.steps[0]!.value.id;
        const list = pickOf(q, { kind: "field", stepId, condId: c.value.id }, "lines");
        expect(filterRows(list.query)[0]).toBe("row: <> [field:lines] [cmp:has at least] [value:1#] ×");
        const any = pickOf(list.query, { kind: "cmp", stepId, condId: c.value.id }, "has any where");
        expect(filterRows(any.query)[0]).toBe("row: <> [field:lines] [cmp:has any where] [field:_field] ×");
        expect(any.open?.kind).toBe("field");
        const inner = pickOf(any.query, any.open!, "SKU");
        expect(filterRows(inner.query)[0]).toBe("row: <> [field:lines] [cmp:has any where] [field:SKU] [cmp:is] [value:_value] ×");
        expect(inner.open?.kind).toBe("value");
        const value = applySlot(inner.query, inner.open!, { value: { kind: "value", value: text("BRK-100") }, label: "BRK-100", group: "Typed" }, ROOT, W);
        expect(describeQuery(value.query, checkSteps(value.query, ROOT), W)).toBe("Orders where lines has any where SKU is BRK-100.");
    });

    test("a comparison keeps the value unless either side is a year, a month or a count", () => {
        const c = cond("total", "ge", num(100));
        const q = query("orders", [filter("all", [c])]);
        const stepId = q.steps[0]!.value.id;
        expect(filterRows(pickOf(q, { kind: "cmp", stepId, condId: c.value.id }, "is less than").query)[0]).toBe("row: <> [field:total] [cmp:is less than] [value:100#] ×");
        const shipped = query("orders", [filter("all", [cond("status", "eq", text("shipped")), cond("status.shipped.date", "inYear", num(2026))])]);
        const year = shipped.steps[0]!.type === "filter" ? shipped.steps[0]!.value.conds[1]! : c;
        const month = pickOf(shipped, { kind: "cmp", stepId: shipped.steps[0]!.value.id, condId: year.value.id }, "is in month");
        expect(filterRows(month.query)[1]).toBe("row: <and> [field:shipped date] [cmp:is in month] [value:_value] ×");
        expect(month.open?.kind).toBe("value");
    });

    test("a total renames itself while its name is its own; a name typed stays", () => {
        const q = mock("Revenue by region");
        const g = q.steps[2]!;
        const [sum] = g.type === "group" ? g.value.aggs : [];
        const auto = query("orders", [groupBy("customer_id", [agg("sum", "total", "total")])]);
        const autoAgg = auto.steps[0]!.type === "group" ? auto.steps[0]!.value.aggs[0]! : sum!;
        const max = pickOf(auto, { kind: "agg-fn", stepId: auto.steps[0]!.value.id, id: autoAgg.id }, "highest");
        expect(filterRows(max.query)[1]).toBe("row: then [agg-fn:highest] [agg-field:total] as {agg-as:max_total} ×");
        const named = pickOf(q, { kind: "agg-fn", stepId: g.value.id, id: sum!.id }, "highest");
        expect(filterRows(named.query, 2)[1]).toBe("row: then [agg-fn:highest] [agg-field:total] as {agg-as:revenue} ×");
        const counted = pickOf(auto, { kind: "agg-fn", stepId: auto.steps[0]!.value.id, id: autoAgg.id }, "count");
        expect(filterRows(counted.query)[1]).toBe("row: then [agg-fn:count] as {agg-as:count} ×");
    });

    test("a field shown is named by its own name; a date part rewrites its name's ending", () => {
        const q = query("orders", [filter("all", [cond("status", "eq", text("shipped"))]), pick([pf("id", "id")])]);
        const p = q.steps[1]!.type === "pick" ? q.steps[1]!.value.fields[0]! : pf("", "");
        const shown = pickOf(q, { kind: "pick-field", stepId: q.steps[1]!.value.id, id: p.id }, "shipped date");
        expect(filterRows(shown.query, 1)[0]).toBe("row: [pick-field:shipped date] as {pick-as:shipped_date} ×");
        const added = pickOf(q, { kind: "pick-add", stepId: q.steps[1]!.value.id }, "total");
        expect(filterRows(added.query, 1)).toEqual(["row: [pick-field:ID] as {pick-as:id} ×", "row: [pick-field:total] as {pick-as:total} ×", "foot: +Add field"]);
        const dates = mock("Shipped revenue by month");
        const year = pickOf(dates, { kind: "part", stepId: dates.steps[1]!.value.id }, "year");
        expect(filterRows(year.query, 1)[0]).toBe("row: take the [part:year] of [date-field:shipped date] as {datepart-as:ship_year}");
    });

    test("an added step takes its defaults and opens its first empty slot", () => {
        const q = query("orders", []);
        const filtered = pickOf(q, { kind: "add-step", stepId: "" }, "Keep rows where…");
        expect(filtered.added).toBe(filtered.query.steps[0]!.value.id);
        expect(filtered.open).toEqual({ kind: "field", stepId: filtered.added, condId: filtered.query.steps[0]!.type === "filter" ? filtered.query.steps[0]!.value.conds[0]!.value.id : "" });
        const looked = pickOf(q, { kind: "add-step", stepId: "" }, "Look up from another dataset…");
        expect(filterRows(looked.query)[0]).toBe("row: find [key:customer ID] in [dataset:customers]");
        expect(looked.open).toBeUndefined();
        const sorted = pickOf(q, { kind: "add-step", stepId: "" }, "Sort by…");
        expect(sorted.open?.kind).toBe("sort-field");
        const saved = applySlot(q, { kind: "add-step", stepId: "" }, { value: { kind: "saved", name: "Revenue by region" }, label: "Revenue by region", group: "" }, ROOT, W);
        expect([saved.opened, saved.query]).toEqual(["Revenue by region", q]);
    });

    test("typing: counts and numbers read as numbers, group separators dropped; names become identifiers", () => {
        const q = query("orders", [limit(10), groupBy("customer_id", [agg("count", undefined, "count")])]);
        const [lim, grp] = q.steps as [Step, Step];
        const n = applyInput(q, { kind: "limit-n", stepId: lim.value.id }, "1,500", ROOT, W);
        expect(n.steps[0]).toEqual(variant("limit", { id: lim.value.id, n: variant("number", 1500) }));
        const notN = applyInput(q, { kind: "limit-n", stepId: lim.value.id }, "ten", ROOT, W);
        expect(notN.steps[0]).toEqual(variant("limit", { id: lim.value.id, n: variant("text", "ten") }));
        const aggId = grp.type === "group" ? grp.value.aggs[0]!.id : "";
        const named = applyInput(q, { kind: "agg-as", stepId: grp.value.id, id: aggId }, "Total revenue!", ROOT, W);
        expect(named.steps[1]!.type === "group" ? named.steps[1]!.value.aggs[0]!.as : "").toBe("Total_revenue");
        expect(applyInput(q, { kind: "agg-as", stepId: grp.value.id, id: aggId }, "!!", ROOT, W).steps[1]!.type === "group" ? "value" : "").toBe("value");
        const fills = query("orders", [fill("discount", num(0)), fill("customer_id", text("none"))]);
        const [fil, fillText] = fills.steps as [Step, Step];
        const filled = applyInput(fills, { kind: "fill-value", stepId: fil.value.id }, "0.25", ROOT, W);
        expect(filled.steps[0]).toEqual(variant("fill", { id: fil.value.id, field: some("discount"), value: some(variant("number", 0.25)) }));
        // A text field takes what is typed as text, a number or not.
        expect(applyInput(fills, { kind: "fill-value", stepId: fillText.value.id }, "12", ROOT, W).steps[1]).toEqual(
            variant("fill", { id: fillText.value.id, field: some("customer_id"), value: some(variant("text", "12")) }));
        expect(isValueOf(n, QueryStepsType) && isValueOf(named, QueryStepsType) && isValueOf(filled, QueryStepsType)).toBe(true);
    });

    test("removing, and adding a condition, a group or a total, each opening its first slot", () => {
        const q = mock("Gold customers or big orders");
        const f = q.steps[1]!;
        const [first, grp] = f.type === "filter" ? f.value.conds : [];
        const removed = applyRemove(q, { kind: "condition", stepId: f.value.id, id: grp!.value.id });
        expect(filterRows(removed, 1)).toEqual(["row: <> [field:status] [cmp:is not] [value:cancelled] ×", "foot: +Add condition +Add group"]);
        const added = applyAction(q, { kind: "add-condition", stepId: f.value.id }, ROOT);
        expect(added.open?.kind).toBe("field");
        expect(filterRows(added.query, 1).at(-2)).toBe("row: <and> [field:_field] ×");
        const grouped = applyAction(q, { kind: "add-group", stepId: f.value.id, groupId: grp!.value.id }, ROOT);
        expect(grouped.open?.kind).toBe("field");
        const total = applyAction(mock("Revenue by region"), { kind: "add-total", stepId: mock("Revenue by region").steps[2]!.value.id }, ROOT);
        expect(total.open?.kind).toBe("agg-field");
        const lookupChip = applyRemove(q, { kind: "lookup-field", stepId: q.steps[0]!.value.id, id: "tier" });
        expect(filterRows(lookupChip, 0)[1]).toBe("row: bring in (name) +Add field");
        void first;
    });
});

// ─── P4: the generated description and the outline ───────────────────────────

describe("P4: the generated description and the outline", () => {
    test("every §6 query's description, beside its author's where the mock wrote one", () => {
        const sentences = MOCK.map(m => {
            const q = m.build();
            return [m.name, describeQuery(q, checkSteps(q, ROOT), W), m.author ?? ""];
        });
        expect(sentences).toEqual([
            ["Top shipped orders, 2026", "Top 10 orders by total where status is shipped, total is at least 100 and shipped date is in 2026, with name and region from customers.", ""],
            ["Revenue by region", "Top 3 regions by revenue from orders where status is shipped, total is at least 100 and shipped date is in 2026.", "Top 3 regions by shipped revenue in 2026, from orders of $100 or more."],
            ["Shipped revenue by month", "Revenue and orders per ship month from orders where status is shipped, sorted by ship month.", ""],
            ["Large orders with no discount", "Orders where total is at least 1,000 and discount is missing, sorted by total, highest first.", ""],
            ["Units by SKU", "Units and orders per SKU from order lines, sorted by units, highest first.", ""],
            ["Pump parts cost", "Total cost, parts and dearest across every bom in the tree.", "Total cost, part count and dearest part in the PUMP-A bill of materials."],
            ["Demand at $10–$12, NSW", "Demand over price from 10 to 12 in steps of 0.5, region NSW.", "Modelled demand in NSW at prices from $10 to $12, in $0.50 steps."],
            ["Cancelled orders", "Count of orders where status is cancelled.", ""],
            ["Orders shipped in 2026 (draft)", "Orders where total is at least 100 and shipped date is in 2026, sorted by total, highest first.", ""],
            ["Gold customers or big orders", "Orders where status is not cancelled and (tier is gold or total is at least 1,500), with name and tier from customers.", ""],
        ]);
    });

    test("a description is cut at a word, at most 140 characters", () => {
        const many = query("orders", [filter("any", ["C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08"].map(c => cond("customer_id", "eq", text(c))))]);
        const sentence = describeQuery(many, checkSteps(many, ROOT), W);
        expect(sentence.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
        expect(sentence.endsWith("…")).toBe(true);
        expect(sentence).toBe("Orders where customer ID is C01 or customer ID is C02 or customer ID is C03 or customer ID is C04 or customer ID is C05 or customer ID is…");
        expect(describeQuery(query("orders", []), checkSteps(query("orders", []), ROOT), W)).toBe("");
    });

    test("every §6 query's outline: each finished step's icon, title and words", () => {
        const outlines = MOCK.map(m => {
            const q = m.build();
            return [m.name, outlineOf(q, checkSteps(q, ROOT), W).map(o => `${o.icon} ${o.title}: ${o.words}`)];
        });
        expect(outlines).toEqual([
            ["Top shipped orders, 2026", [
                "filter Keep rows where: status is shipped, total is at least 100 and shipped date is in 2026",
                "arrow-right-arrow-left Look up from another dataset: name and region from customers by customer ID",
                "table-columns Show only these fields: order, customer, region, total and shipped",
                "arrow-down-wide-short Sort: by total, highest first",
                "list-ol Keep the first: 10 orders",
            ]],
            ["Revenue by region", [
                "filter Keep rows where: status is shipped, total is at least 100 and shipped date is in 2026",
                "arrow-right-arrow-left Look up from another dataset: region from customers by customer ID",
                "layer-group Group and total: revenue and orders per region",
                "arrow-down-wide-short Sort: by revenue, highest first",
                "list-ol Keep the first: 3 regions",
            ]],
            ["Shipped revenue by month", [
                "filter Keep rows where: status is shipped",
                "calendar-day Take part of a date: the month of shipped date as ship month",
                "layer-group Group and total: revenue and orders per ship month",
                "arrow-down-wide-short Sort: by ship month, A to Z",
            ]],
            ["Large orders with no discount", [
                "filter Keep rows where: total is at least 1,000 and discount is missing",
                "table-columns Show only these fields: ID, customer ID, total and status",
                "arrow-down-wide-short Sort: by total, highest first",
            ]],
            ["Units by SKU", [
                "arrow-turn-down Open each order's list: one row per line",
                "layer-group Group and total: units and orders per SKU",
                "arrow-down-wide-short Sort: by units, highest first",
            ]],
            ["Pump parts cost", ["sitemap List every part in the tree: every level, keeping cost and SKU", "layer-group Group and total: total cost, parts and dearest of all rows"]],
            ["Demand at $10–$12, NSW", ["chart-line Try the model over a range: price from 10 to 12 every 0.5, region NSW"]],
            ["Cancelled orders", ["filter Keep rows where: status is cancelled", "hashtag Count the rows: gives one whole number"]],
            ["Orders shipped in 2026 (draft)", ["filter Keep rows where: total is at least 100 and shipped date is in 2026", "arrow-down-wide-short Sort: by total, highest first"]],
            ["Gold customers or big orders", [
                "arrow-right-arrow-left Look up from another dataset: name and tier from customers by customer ID",
                "filter Keep rows where: status is not cancelled and (tier is gold or total is at least 1,500)",
                "table-columns Show only these fields: ID, customer, tier and total",
            ]],
        ]);
    });
});

// ─── P5: summaries ───────────────────────────────────────────────────────────

describe("P5: summaries are fetched lazily, once per prefix and hashes", () => {
    test("a summary is the summary program after the steps before, and runs to a Summary", () => {
        const q = topShippedOrders();
        const request = summaryAt(q, 1, ROOT)!;
        expect(request.prefix).toBe(".orders\n| map(select(.status.type == \"shipped\") | select(.total >= 100 and (.status.value.date | year) == 2026))");
        expect(request.reads).toEqual(["orders"]);
        expect(summaryAt(q, 3, ROOT)!.reads).toEqual(["orders", "customers"]);
        expect(Number(summaryOf(q, 1).count)).toBe(16);
        expect(summaryAt(query("bom", []), 0, ROOT)).toBeUndefined();
    });

    test("the cache runs a prefix once for its hashes, shares a run in flight, and misses on a newer hash", async () => {
        const runs: SummaryRequest[] = [];
        const q = topShippedOrders();
        const summary = summaryOf(q, 1);
        const cache = new SummaryCache(async request => {
            runs.push(request);
            return { summary, hashes: new Map([["orders", "4f2a1c8d"]]) };
        });
        const request = summaryAt(q, 1, ROOT)!;
        const now = new Map([["orders", "4f2a1c8d"]]);
        expect(cache.get(request, now)).toBeUndefined();
        const [a, b] = await Promise.all([cache.ensure(request, now), cache.ensure(request, now)]);
        expect([a, b]).toEqual([summary, summary]);
        expect(runs.length).toBe(1);
        expect(await cache.ensure(summaryAt(q, 1, ROOT)!, now)).toEqual(summary);
        expect(runs.length).toBe(1);
        expect(cache.get(request, new Map([["orders", "0000beef"]]))).toBeUndefined();
        await cache.ensure(request, new Map([["orders", "0000beef"]]));
        expect(runs.length).toBe(2);
    });

    test("no summary is fetched by an edit, and a failed run leaves the offers without values", async () => {
        let runs = 0;
        const cache = new SummaryCache(async () => {
            runs += 1;
            return undefined;
        });
        const q = topShippedOrders();
        const c = q.steps[0]!.type === "filter" ? q.steps[0]!.value.conds[1]! : blank();
        applySlot(q, { kind: "cmp", stepId: q.steps[0]!.value.id, condId: c.value.id }, { value: { kind: "cmp", cmp: "le" }, label: "is at most", group: "" }, ROOT, W);
        applyInput(q, { kind: "limit-n", stepId: q.steps[4]!.value.id }, "5", ROOT, W);
        expect(runs).toBe(0);
        expect(await cache.ensure(summaryAt(q, 0, ROOT)!, new Map())).toBeUndefined();
        expect(runs).toBe(1);
        const values = slotItems(q, ROOT, { kind: "value", stepId: q.steps[0]!.value.id, condId: c.value.id }, "", { words: W });
        expect(values).toEqual([]);
    });
});
