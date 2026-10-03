/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's canonical steps (#933), over #875's shared fixture
 * (`libs/east/test/fixtures/query-fixture.beast2`, which every runtime reads):
 * S1 print ↔ parse, S2 diagnostics on steps and their fixes, S3 shapes, S4
 * the counting program, S5 every step a value of its East type.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
    ArrayType, BooleanType, DateTimeType, IntegerType, OptionType, SortedMap, StringType, StructType,
    checkJq, compareFor, decodeBeast2, equalFor, evaluateJq, fromEastTypeValue, isTypeEqual, isValueOf, none, printFor, some, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { QueryStepType, QueryStepValueType, QueryStepsType } from "@elaraai/e3-ui/internal";
import { checkSteps, type StepFix } from "../../src/query/steps/check.js";
import { SOURCE_COUNT, countingProgram, readCounts } from "../../src/query/steps/count.js";
import {
    addCondition, addGroup, applyFix, emptyCondition, insertStep, moveStep, newStep, removeCondition, removeStep, setConditionField, setMatch,
} from "../../src/query/steps/edit.js";
import { fieldByRef, fieldsOf } from "../../src/query/steps/fields.js";
import { parseSteps } from "../../src/query/steps/parse.js";
import { layOutSteps, printSteps } from "../../src/query/steps/print.js";
import type { Shape } from "../../src/query/steps/shape.js";
import type { Aggregate, ComparisonKind, Condition, PickField, Step, StepKind, StepQuery, StepValue } from "../../src/query/steps/values.js";

/** The shared fixture: its root type and its value. */
const fixture = decodeBeast2(readFileSync(new URL("../../../../../east/test/fixtures/query-fixture.beast2", import.meta.url)));
const ROOT: EastType = fromEastTypeValue(fixture.type);

/** A root of items with the kinds the fixture lacks: yes or no. */
const Item = StructType({ name: StringType, active: BooleanType, at: DateTimeType, tags: ArrayType(StringType), score: OptionType(IntegerType) });
const ITEMS = StructType({ items: ArrayType(Item) });

// ─── Building steps as East values ───────────────────────────────────────────

let ids = 0;
const id = (prefix: string): string => `${prefix}${++ids}`;
const text = (value: string): StepValue => variant("text", value);
const num = (value: number): StepValue => variant("number", value);

/** A test of a field. */
function cond(field: string, cmp: ComparisonKind, value?: StepValue, inner?: Condition): Condition {
    return variant("test", {
        id: id("c"),
        field: some(field),
        cmp: some(variant(cmp, null)),
        value: value === undefined ? none : some(value),
        inner: inner === undefined ? none : some(inner),
        whole: false,
    }) as Condition;
}

/** A variant compared as a whole value, which the check refuses. */
function wholeCond(field: string, value: StepValue): Condition {
    return variant("test", { id: id("c"), field: some(field), cmp: some(variant("eq", null)), value: some(value), inner: none, whole: true }) as Condition;
}

/** A group of conditions. */
function group(match: "all" | "any", conds: Condition[]): Condition {
    return variant("group", { id: id("c"), match: variant(match, null), conds }) as Condition;
}

const filter = (match: "all" | "any", conds: Condition[]): Step => variant("filter", { id: id("s"), match: variant(match, null), conds });
const lookup = (dataset: string, key: string, fields: string[]): Step => variant("lookup", { id: id("s"), dataset: some(dataset), key: some(key), fields });
const agg = (fn: "count" | "sum" | "mean" | "min" | "max" | "distinct", field: string | undefined, as: string): Aggregate =>
    ({ id: id("a"), fn: variant(fn, null), field: field === undefined ? none : some(field), as });
const groupBy = (by: string | undefined, aggs: Aggregate[]): Step =>
    variant("group", { id: id("s"), by: some(by === undefined ? variant("all", null) : variant("field", by)), aggs });
const sort = (field: string, dir: "asc" | "desc"): Step => variant("sort", { id: id("s"), field: some(field), dir: variant(dir, null) });
const limit = (n: number): Step => variant("limit", { id: id("s"), n: variant("number", n) });
const count = (): Step => variant("count", { id: id("s") });
const pickField = (field: string, as: string): PickField => ({ id: id("p"), field: some(field), as });
const pick = (fields: PickField[]): Step => variant("pick", { id: id("s"), fields });
const fill = (field: string, value: StepValue): Step => variant("fill", { id: id("s"), field: some(field), value: some(value) });
const drill = (field: string): Step => variant("drill", { id: id("s"), field: some(field) });
const datepart = (field: string, part: "year" | "month" | "weekday", as: string): Step =>
    variant("datepart", { id: id("s"), field: some(field), part: variant(part, null), as });
const walk = (via: string): Step => variant("walk", { id: id("s"), via: some(via) });
const tabulate = (over: string, from: number, to: number, by: number, fixed: [string, StepValue][], as: string): Step =>
    variant("tabulate", {
        id: id("s"), over, from: variant("number", from), to: variant("number", to), step: variant("number", by),
        fixed: new SortedMap(fixed, compareFor(StringType)), as,
    });
const jq = (code: string): Step => variant("jq", { id: id("s"), text: code });
const query = (source: string, steps: Step[]): StepQuery => ({ source, steps });

/** The query editor mock's default query (`Query Editor Spec.md` §4.7). */
const topShippedOrders = (): StepQuery => query("orders", [
    filter("all", [cond("status", "eq", text("shipped")), cond("total", "ge", num(100)), cond("status.shipped.date", "inYear", num(2026))]),
    lookup("customers", "customer_id", ["name", "region"]),
    pick([pickField("id", "order"), pickField("name", "customer"), pickField("region", "region"), pickField("total", "total"), pickField("status.shipped.date", "shipped")]),
    sort("total", "desc"),
    limit(10),
]);

const DEFAULT_TEXT = `.customers as $customers
| .orders
| map(select(.status.type == "shipped") | select(.total >= 100 and (.status.value.date | year) == 2026))
| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})
| map({order: .id, customer: .name, region, total, shipped: .status.value.date})
| sort_by(-.total)
| .[:10]`;

/** The query editor mock's saved and recent queries (`Query Editor Spec.md` §6), by name. */
const MOCK_QUERIES: readonly (readonly [name: string, build: () => StepQuery])[] = [
    ["Top shipped orders, 2026", topShippedOrders],
    ["Revenue by region", () => query("orders", [
        filter("all", [cond("status", "eq", text("shipped")), cond("total", "ge", num(100)), cond("status.shipped.date", "inYear", num(2026))]),
        lookup("customers", "customer_id", ["region"]),
        groupBy("region", [agg("sum", "total", "revenue"), agg("count", undefined, "orders")]),
        sort("revenue", "desc"),
        limit(3),
    ])],
    ["Shipped revenue by month", () => query("orders", [
        filter("all", [cond("status", "eq", text("shipped"))]),
        datepart("status.shipped.date", "month", "ship_month"),
        groupBy("ship_month", [agg("sum", "total", "revenue"), agg("count", undefined, "orders")]),
        sort("ship_month", "asc"),
    ])],
    ["Large orders with no discount", () => query("orders", [
        filter("all", [cond("total", "ge", num(1000)), cond("discount", "missing")]),
        pick([pickField("id", "id"), pickField("customer_id", "customer_id"), pickField("total", "total"), pickField("status", "status")]),
        sort("total", "desc"),
    ])],
    ["Units by SKU", () => query("orders", [
        drill("lines"),
        groupBy("sku", [agg("sum", "qty", "units"), agg("distinct", "order_id", "orders")]),
        sort("units", "desc"),
    ])],
    ["Pump parts cost", () => query("bom", [
        walk("children"),
        groupBy(undefined, [agg("sum", "cost", "total_cost"), agg("count", undefined, "parts"), agg("max", "cost", "dearest")]),
    ])],
    ["Demand at $10–$12, NSW", () => query("model", [
        tabulate("price", 10, 12, 0.5, [["region", text("NSW")]], "demand"),
    ])],
    ["Cancelled orders", () => query("orders", [
        filter("all", [cond("status", "eq", text("cancelled"))]),
        count(),
    ])],
    ["Orders shipped in 2026 (draft)", () => query("orders", [
        filter("all", [cond("total", "ge", num(100)), cond("status.shipped.date", "inYear", num(2026))]),
        sort("total", "desc"),
    ])],
    ["Gold customers or big orders", () => query("orders", [
        lookup("customers", "customer_id", ["name", "tier"]),
        filter("all", [cond("status", "ne", text("cancelled")), group("any", [cond("tier", "eq", text("gold")), cond("total", "ge", num(1500))])]),
        pick([pickField("id", "id"), pickField("name", "customer"), pickField("tier", "tier"), pickField("total", "total")]),
    ])],
];

/**
 * Every step kind and comparison in its canonical form: a query, its root,
 * and the text it prints. Each checks clean.
 */
const CATALOGUE: readonly (readonly [name: string, root: EastType, build: () => StepQuery, text: string])[] = [
    ["text: is, is not, contains, starts with", ROOT, () => query("orders", [
        filter("any", [cond("customer_id", "eq", text("C01")), cond("customer_id", "ne", text("C02")), cond("customer_id", "contains", text("0")), cond("customer_id", "startsWith", text("C0"))]),
    ]), `.orders
| map(select(.customer_id == "C01" or .customer_id != "C02" or (.customer_id | contains("0")) or (.customer_id | startswith("C0"))))`],
    ["numbers: every comparison, a whole number and a fraction", ROOT, () => query("orders", [
        filter("all", [cond("total", "ge", num(100)), cond("total", "le", num(2000.5)), cond("total", "gt", num(1)), cond("total", "lt", num(5000)), cond("id", "eq", num(1001)), cond("id", "ne", num(1002))]),
    ]), `.orders
| map(select(.total >= 100 and .total <= 2000.5 and .total > 1 and .total < 5000 and .id == 1001 and .id != 1002))`],
    ["optional: is missing, has a value", ROOT, () => query("orders", [
        filter("any", [cond("discount", "missing"), cond("discount", "present")]),
    ]), `.orders
| map(select(.discount == null or .discount != null))`],
    ["dates: in month, on or after, before, narrowed first", ROOT, () => query("orders", [
        filter("all", [
            cond("status", "eq", text("shipped")),
            cond("status.shipped.date", "inMonth", text("2026-03")),
            cond("status.shipped.date", "onOrAfter", text("2026-03-01")),
            cond("status.shipped.date", "before", text("2026-04-01")),
        ]),
    ]), `.orders
| map(select(.status.type == "shipped") | select((.status.value.date | strftime("%Y-%m")) == "2026-03" and .status.value.date >= "2026-03-01" and .status.value.date < "2026-04-01"))`],
    ["lists: has at least, has any where", ROOT, () => query("orders", [
        filter("all", [cond("lines", "lengthAtLeast", num(2)), cond("lines", "anyWhere", undefined, cond("sku", "eq", text("BRK-100")))]),
    ]), `.orders
| map(select((.lines | length) >= 2 and any(.lines[]; .sku == "BRK-100")))`],
    ["groups: any inside all, all inside any", ROOT, () => query("orders", [
        filter("all", [cond("status", "ne", text("cancelled")), group("any", [cond("total", "ge", num(1000)), cond("customer_id", "eq", text("C01"))])]),
        filter("any", [cond("customer_id", "eq", text("C01")), group("all", [cond("total", "ge", num(1000)), cond("discount", "missing")])]),
    ]), `.orders
| map(select(.status.type != "cancelled" and (.total >= 1000 or .customer_id == "C01")))
| map(select(.customer_id == "C01" or .total >= 1000 and .discount == null))`],
    ["yes or no", ITEMS, () => query("items", [
        filter("any", [cond("active", "yes"), cond("active", "no")]),
    ]), `.items
| map(select(.active == true or .active == false))`],
    ["sort: text both ways, a case, an optional number", ROOT, () => query("orders", [
        sort("customer_id", "asc"), sort("customer_id", "desc"), sort("status", "asc"), sort("discount", "desc"),
    ]), `.orders
| sort_by(.customer_id)
| sort_by(.customer_id)
| reverse
| sort_by(.status.type)
| sort_by(.discount)
| reverse`],
    ["keep the first, count", ROOT, () => query("orders", [limit(5), count()]), `.orders
| .[:5]
| length`],
    ["group and total: every total, by a case, all rows together", ROOT, () => query("orders", [
        groupBy("customer_id", [agg("count", undefined, "n"), agg("sum", "total", "total"), agg("mean", "total", "mean_total"), agg("min", "total", "min_total"), agg("max", "total", "max_total"), agg("distinct", "status", "kinds")]),
    ]), `.orders
| group_by(.customer_id)
| map({customer_id: .[0].customer_id, n: length, total: map(.total) | add, mean_total: map(.total) | add / length, min_total: map(.total) | min, max_total: map(.total) | max, kinds: map(.status.type) | unique | length})`],
    ["group by a case", ROOT, () => query("orders", [groupBy("status", [agg("count", undefined, "count")])]), `.orders
| group_by(.status.type)
| map({status: .[0].status.type, count: length})`],
    ["all rows together", ROOT, () => query("orders", [groupBy(undefined, [agg("count", undefined, "n"), agg("sum", "total", "revenue")])]), `.orders
| {n: length, revenue: map(.total) | add}`],
    ["show only fields: a case whole, a payload's field, a rename", ROOT, () => query("orders", [
        filter("all", [cond("status", "eq", text("shipped"))]),
        pick([pickField("status", "status"), pickField("status.shipped.date", "shipped"), pickField("total", "amount")]),
    ]), `.orders
| map(select(.status.type == "shipped"))
| map({status, shipped: .status.value.date, amount: .total})`],
    ["fill in missing values", ROOT, () => query("orders", [fill("discount", num(0))]), `.orders
| map(.discount //= 0)`],
    ["open each list, keeping the row's id", ROOT, () => query("orders", [drill("lines")]), `.orders
| [.[] | . as $order | .lines[] | . + {order_id: $order.id}]`],
    ["open each list of rows with no id", ROOT, () => query("orders", [pick([pickField("customer_id", "customer_id"), pickField("lines", "lines")]), drill("lines")]), `.orders
| map({customer_id, lines})
| [.[] | .lines[]]`],
    ["take part of a date: year, weekday", ROOT, () => query("orders", [
        filter("all", [cond("status", "eq", text("shipped"))]),
        datepart("status.shipped.date", "year", "ship_year"),
        datepart("status.shipped.date", "weekday", "ship_day"),
    ]), `.orders
| map(select(.status.type == "shipped"))
| map(. + {ship_year: .status.value.date | year})
| map(. + {ship_day: .status.value.date | strftime("%A")})`],
    ["list every part, then total it", ROOT, () => query("bom", [walk("children"), groupBy(undefined, [agg("count", undefined, "parts")])]), `.bom
| [recurse(.children[]) | {cost, sku}]
| {parts: length}`],
    ["try the model over a range", ROOT, () => query("model", [tabulate("price", 10, 12, 0.5, [["region", text("NSW")]], "demand")]), `.model
| [range(10.0; 12.0 + 0.5 / 2; 0.5) as $price | {price: $price, demand: call(.; {price: $price, region: "NSW"})}]`],
    ["a jq step, as written", ROOT, () => query("orders", [jq("map(.id)")]), `.orders
| map(.id)`],
];

/** A query with every id renumbered by position: two queries equal ids aside are then equal. */
function renumbered(q: StepQuery): StepQuery {
    let n = 0;
    const next = (): string => `#${++n}`;
    const conds = (cs: readonly Condition[]): Condition[] => cs.map(c => c.type === "group"
        ? variant("group", { ...c.value, id: next(), conds: conds(c.value.conds) }) as Condition
        : variant("test", { ...c.value, id: next(), inner: c.value.inner.type === "some" ? some(conds([c.value.inner.value])[0]!) : none }) as Condition);
    return {
        source: q.source,
        steps: q.steps.map(s => {
            switch (s.type) {
                case "filter": return variant("filter", { ...s.value, id: next(), conds: conds(s.value.conds) });
                case "group": return variant("group", { ...s.value, id: next(), aggs: s.value.aggs.map(a => ({ ...a, id: next() })) });
                case "pick": return variant("pick", { ...s.value, id: next(), fields: s.value.fields.map(p => ({ ...p, id: next() })) });
                default: return variant(s.type, { ...s.value, id: next() }) as Step;
            }
        }),
    };
}

const equalSteps = equalFor(QueryStepsType);
const printSteps_ = printFor(QueryStepsType);

/** Parses a program into steps, failing the test when it does not parse. */
function parsed(program: string, root: EastType = ROOT): StepQuery {
    const result = parseSteps(program, root);
    if ("error" in result) assert.fail(`did not parse: ${result.error.message}\n${program}`);
    return result.query;
}

/** Asserts two queries equal, ids aside. */
function assertSameSteps(actual: StepQuery, expected: StepQuery, message: string): void {
    assert.ok(equalSteps(renumbered(actual), renumbered(expected)), `${message}\n${printSteps_(renumbered(actual))}\n${printSteps_(renumbered(expected))}`);
}

/** The errors east's checker finds in a program. */
function errorsOf(program: string, root: EastType = ROOT): string[] {
    return checkJq(program, root, { root: true }).diagnostics.filter(d => d.severity.type === "error").map(d => d.message);
}

describe("S1: printSteps ↔ parseSteps", () => {
    test("the default query prints the text of Query Editor Spec.md §4.7 exactly", () => {
        assert.equal(printSteps(topShippedOrders(), ROOT).text, DEFAULT_TEXT);
    });

    for (const [name, build] of MOCK_QUERIES) {
        test(`${name} prints and parses back to itself`, () => {
            const q = build();
            assertSameSteps(parsed(printSteps(q, ROOT).text), q, name);
        });
    }

    test("the mock's queries check clean, but the draft that reads a payload unnarrowed", () => {
        for (const [name, build] of MOCK_QUERIES) {
            const errors = errorsOf(printSteps(build(), ROOT).text);
            assert.deepEqual(errors.length > 0, name.endsWith("(draft)"), `${name}: ${errors.join(" / ")}`);
        }
    });

    for (const [name, root, build, expected] of CATALOGUE) {
        test(`${name}: prints its canonical form, checks clean, and parses back`, () => {
            const q = build();
            const printed = printSteps(q, root).text;
            assert.equal(printed, expected);
            assert.deepEqual(errorsOf(printed, root), []);
            assertSameSteps(parsed(printed, root), q, name);
        });
    }

    test("layout and comments do not matter: a program is read, not its text", () => {
        const written = ".customers as $customers\n|   .orders # the orders\n| map(select(.status.type==\"shipped\")|select(.total>=100 and (.status.value.date|year)==2026))\n| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region}) | map({order: .id, customer: .name, region, total, shipped: .status.value.date}) | sort_by(-.total) | .[:10]";
        assertSameSteps(parsed(written), topShippedOrders(), "the default query, written another way");
    });

    test("a segment no form takes is a jq step, and so is every one after it", () => {
        const q = parsed(".orders\n| map(.total)\n| map(select(. > 100))\n| length");
        assert.deepEqual(q.steps.map(s => s.type), ["jq", "jq", "jq"]);
        assert.deepEqual(q.steps.map(s => s.type === "jq" ? s.value.text : ""), ["map(.total)", "map(select(. > 100))", "length"]);
        assert.equal(printSteps(q, ROOT).text, ".orders\n| map(.total)\n| map(select(. > 100))\n| length");
    });

    test("a jq step after canonical ones keeps them steps", () => {
        const q = parsed(".orders\n| map(select(.total >= 100))\n| map(.id)\n| length");
        assert.deepEqual(q.steps.map(s => s.type), ["filter", "jq", "jq"]);
    });

    test("each step is placed where it was read from: a form of two segments over both, a jq step over its own", () => {
        const program = ".orders\n| group_by(.customer_id)\n| map({customer_id: .[0].customer_id, n: length})\n| map(.n)";
        const result = parseSteps(program, ROOT);
        if ("error" in result) assert.fail(result.error.message);
        assert.deepEqual(result.query.steps.map(s => s.type), ["group", "jq"]);
        assert.deepEqual(result.spans.map(s => [s.stepId, program.slice(s.from, s.to)]), [
            [result.query.steps[0]!.value.id, "group_by(.customer_id)\n| map({customer_id: .[0].customer_id, n: length})"],
            [result.query.steps[1]!.value.id, "map(.n)"],
        ]);
    });

    test("an all filter's case condition prints first, so it parses back first", () => {
        const q = query("orders", [filter("all", [cond("total", "ge", num(100)), cond("status", "eq", text("shipped"))])]);
        const printed = printSteps(q, ROOT).text;
        assert.equal(printed, ".orders\n| map(select(.status.type == \"shipped\") | select(.total >= 100))");
        const back = parsed(printed);
        const conds = back.steps[0]!.type === "filter" ? back.steps[0]!.value.conds : [];
        assert.deepEqual(conds.map(c => c.type === "test" && c.value.field.type === "some" ? c.value.field.value : ""), ["status", "total"]);
    });

    test("a program that does not parse, or does not start from a data source, is not steps", () => {
        const syntax = parseSteps(".orders | map(", ROOT);
        assert.ok("error" in syntax && syntax.error.code === "syntax");
        const start = parseSteps(". | length", ROOT);
        assert.ok("error" in start && start.error.code === "unsupported" && /starts from a dataset/.test(start.error.message));
        const unknown = parseSteps(".ordrs\n| length", ROOT);
        if (!("error" in unknown)) assert.fail("an unknown dataset parsed");
        assert.equal(unknown.error.code, "unknown_field");
        assert.deepEqual(unknown.error.suggestions, [".orders"]);
        assert.equal(unknown.error.span.type === "some" ? unknown.error.span.value.offset : -1n, 0n);
        assert.deepEqual(unknown.error.fixes.map(f => f.edits.map(e => [e.offset, e.length, e.insert])), [[[0n, 6n, ".orders"]]]);
    });

    test("a dataset bound that no Look up reads is kept in jq", () => {
        const result = parseSteps(".customers as $customers\n| .orders\n| length", ROOT);
        assert.ok("error" in result && result.error.code === "unsupported" && /\$customers is bound/.test(result.error.message));
    });

    test("unfinished steps are left out of the program", () => {
        const q = query("orders", [newStep("filter", layOutSteps(query("orders", []), ROOT).source, ROOT), limit(3)]);
        assert.equal(printSteps(q, ROOT).text, ".orders\n| .[:3]");
    });
});

/** The checked steps' diagnostics, without notes. */
function problems(q: StepQuery, root: EastType = ROOT) {
    return checkSteps(q, root).diagnostics.filter(d => d.severity !== "note");
}

/** Applies each fix a diagnostic offers, and asserts the program then checks clean. */
function assertFixed(q: StepQuery, fix: StepFix, root: EastType = ROOT): StepQuery {
    const fixed = applyFix(q, fix, root);
    const after = checkSteps(fixed, root);
    assert.deepEqual(after.diagnostics.filter(d => d.severity === "error").map(d => d.message), [], `after ${fix.kind}:\n${after.program}`);
    assert.ok(isValueOf(fixed, QueryStepsType));
    return fixed;
}

describe("S2: checkSteps places each diagnostic on its step, condition and slot", () => {
    test("an unknown field in a condition: its field, and Use the right one", () => {
        const c = cond("totl", "ge", num(100));
        const q = query("orders", [filter("all", [c])]);
        const [d, ...rest] = problems(q);
        assert.equal(rest.length, 0);
        assert.equal(d!.code, "unknown_field");
        assert.deepEqual([d!.stepId, d!.condId, d!.slot], [q.steps[0]!.value.id, c.value.id, "field"]);
        assert.equal(d!.context["suggestion"], ".total");
        assert.deepEqual(d!.fixes.map(f => f.kind), ["setField"]);
        const fixed = assertFixed(q, d!.fixes[0]!);
        const field = fixed.steps[0]!.type === "filter" && fixed.steps[0]!.value.conds[0]!.type === "test" ? fixed.steps[0]!.value.conds[0]!.value.field : none;
        assert.ok(equalFor(OptionType(StringType))(field, some("total")));
    });

    test("an unknown case: its value, and Use the case", () => {
        const c = cond("status", "eq", text("shiped"));
        const q = query("orders", [filter("all", [c])]);
        const [d] = problems(q);
        assert.equal(d!.code, "unknown_case");
        assert.deepEqual([d!.condId, d!.slot], [c.value.id, "value"]);
        assert.equal(d!.context["value"], "shiped");
        assert.equal(d!.fixes[0]?.kind, "setValue");
        assertFixed(q, d!.fixes[0]!);
    });

    test("a variant compared whole: Use .type compares its case", () => {
        const c = wholeCond("status", text("shipped"));
        const q = query("orders", [filter("all", [c])]);
        const [d] = problems(q);
        assert.equal(d!.code, "type_mismatch");
        assert.equal(d!.condId, c.value.id);
        assert.equal(d!.fixes[0]?.kind, "unwhole");
        assertFixed(q, d!.fixes[0]!);
    });

    test("a payload's field read before narrowing: keep only its case's rows first", () => {
        const c = cond("status.shipped.date", "inYear", num(2026));
        const q = query("orders", [filter("all", [cond("total", "ge", num(100)), c])]);
        const [d] = problems(q);
        assert.equal(d!.code, "type_mismatch");
        assert.deepEqual([d!.condId, d!.slot], [c.value.id, "field"]);
        assert.deepEqual([d!.context["case"], d!.context["parent"]], ["shipped", "status"]);
        const fix = d!.fixes[0]!;
        assert.deepEqual(fix.kind === "addCaseCondition" ? [fix.field, fix.case] : [], ["status", "shipped"]);
        const fixed = assertFixed(q, fix);
        const first = fixed.steps[0]!.type === "filter" ? fixed.steps[0]!.value.conds[0] : undefined;
        assert.equal(first?.type === "test" && first.value.field.type === "some" ? first.value.field.value : "", "status");
    });

    test("narrowing an any filter makes it all of the case and the old conditions as a group", () => {
        const q = query("orders", [filter("any", [cond("status.shipped.date", "inYear", num(2026)), cond("total", "ge", num(5000))])]);
        const fix = problems(q).flatMap(d => d.fixes).find(f => f.kind === "addCaseCondition")!;
        const fixed = assertFixed(q, fix);
        const step = fixed.steps[0]!;
        assert.equal(step.type === "filter" ? step.value.match.type : "", "all");
        assert.deepEqual(step.type === "filter" ? step.value.conds.map(c => c.type) : [], ["test", "group"]);
    });

    test("narrowing for a step of another kind puts a filter before it", () => {
        const q = query("orders", [datepart("status.shipped.date", "month", "month")]);
        const [d] = problems(q);
        assert.equal(d!.slot, "field");
        const fixed = assertFixed(q, d!.fixes.find(f => f.kind === "addCaseCondition")!);
        assert.deepEqual(fixed.steps.map(s => s.type), ["filter", "datepart"]);
    });

    test("an unknown field in a step's slot: the slot, and Use the right one", () => {
        for (const [step, slot] of [[sort("totl", "asc"), "field"], [groupBy("customr_id", [agg("count", undefined, "n")]), "by"]] as const) {
            const q = query("orders", [step]);
            const d = problems(q).find(x => x.code === "unknown_field")!;
            assert.deepEqual([d.stepId, d.slot], [step.value.id, slot]);
            assertFixed(q, d.fixes[0]!);
        }
        const total = agg("sum", "totl", "sum");
        const q = query("orders", [groupBy("customer_id", [total])]);
        const d = problems(q).find(x => x.code === "unknown_field")!;
        assert.deepEqual([d.slot, d.id], ["agg-field", total.id]);
        assertFixed(q, d.fixes[0]!);
    });

    test("a payload's field misspelt: Use names the case's field", () => {
        const q = query("orders", [filter("all", [cond("status", "eq", text("shipped")), cond("status.shipped.dat", "inYear", num(2026))])]);
        const d = problems(q).find(x => x.code === "unknown_field")!;
        const fix = d.fixes[0]!;
        assert.equal(fix.kind === "setField" ? fix.field : "", "status.shipped.date");
        assertFixed(q, fix);
    });

    test("adding up text is no total: the steps say so, and offer the numbers", () => {
        const total = agg("sum", "customer_id", "sum");
        const q = query("orders", [groupBy("status", [total])]);
        const d = problems(q).find(x => x.slot === "agg-field")!;
        assert.deepEqual([d.code, d.id], ["type_mismatch", total.id]);
        assert.deepEqual(d.fixes.map(f => f.kind === "setField" ? f.field : ""), ["discount", "id"]);
        assertFixed(q, d.fixes[1]!);
    });

    test("values the checker cannot judge: a month, a count of items, how many to keep", () => {
        const month = cond("status.shipped.date", "inMonth", text("2026-13"));
        const items = cond("lines", "lengthAtLeast", num(1.5));
        const q = query("orders", [filter("all", [cond("status", "eq", text("shipped")), month, items]), limit(0)]);
        const found = problems(q).map(d => [d.code, d.condId ?? d.slot]);
        assert.deepEqual(found, [["type_mismatch", month.value.id], ["type_mismatch", items.value.id], ["type_mismatch", "n"]]);
    });

    test("an unfinished slot is incomplete, on the slot it needs", () => {
        const blank = emptyCondition();
        const noValue = cond("total", "ge");
        const q = query("orders", [
            filter("all", [blank, noValue]),
            variant("lookup", { id: id("s"), dataset: some("customers"), key: none, fields: [] }),
            variant("group", { id: id("s"), by: none, aggs: [] }),
        ]);
        assert.deepEqual(problems(q).map(d => [d.code, d.condId ?? "", d.slot ?? ""]), [
            ["incomplete", blank.value.id, "field"],
            ["incomplete", noValue.value.id, "value"],
            ["incomplete", "", "key"],
            ["incomplete", "", "fields"],
            ["incomplete", "", "by"],
        ]);
    });

    test("a step that needs rows, on one value: the checker's error, and remove it", () => {
        // Each in the checker's own code: map and sort_by need an array, a slice something to index, .[] something to iterate.
        const steps: readonly (readonly [Step, string])[] = [
            [sort("total", "asc"), "type_mismatch"],
            [filter("all", [cond("total", "ge", num(1))]), "type_mismatch"],
            [limit(5), "not_indexable"],
            [drill("lines"), "not_iterable"],
        ];
        for (const [step, code] of steps) {
            const q = query("orders", [count(), step]);
            const d = problems(q).find(x => x.stepId === step.value.id)!;
            assert.deepEqual([d.severity, d.code], ["error", code], d.message);
            const remove = d.fixes.find(f => f.kind === "removeStep");
            assert.ok(remove !== undefined, `${d.code}: ${d.message}`);
            assertFixed(q, remove);
        }
    });

    test("an unknown data source is the source's", () => {
        const [d] = problems(query("ordrs", []));
        assert.deepEqual([d!.stepId, d!.slot, d!.code], ["", "source", "unknown_field"]);
    });

    test("a jq step: a note, and the checker's own words and fixes on its text", () => {
        const step = jq("map(.totl)");
        const q = query("orders", [step]);
        const all = checkSteps(q, ROOT).diagnostics;
        assert.ok(all.some(d => d.severity === "note" && d.code === "custom" && d.stepId === step.value.id));
        const d = all.find(x => x.code === "unknown_field")!;
        assert.deepEqual([d.stepId, d.slot], [step.value.id, "text"]);
        const fixed = assertFixed(q, d.fixes[0]!);
        assert.equal(fixed.steps[0]!.type === "jq" ? fixed.steps[0]!.value.text : "", "map(.total)");
    });

    test("lints are warnings on their step", () => {
        const q = query("orders", [pick([pickField("id", "x"), pickField("total", "x")]), fill("x", num(0))]);
        const found = problems(q).map(d => [d.severity, d.code, d.stepId]);
        assert.deepEqual(found, [["warning", "duplicate_key", q.steps[0]!.value.id], ["warning", "never_missing", q.steps[1]!.value.id]]);
        const grouped = groupBy("customer_id", [agg("count", undefined, "customer_id")]);
        assert.deepEqual(problems(query("orders", [grouped])).map(d => [d.severity, d.code, d.stepId]), [["warning", "duplicate_key", grouped.value.id]],
            "a total named as the field grouped by");
    });

    test("an inner condition, a group and a filter left empty are incomplete", () => {
        const noInner = cond("lines", "anyWhere");
        const emptyGroup = group("all", []);
        const q = query("orders", [filter("any", [noInner, emptyGroup]), filter("all", [])]);
        assert.deepEqual(problems(q).map(d => [d.code, d.stepId, d.condId ?? "", d.slot ?? ""]), [
            ["incomplete", q.steps[0]!.value.id, noInner.value.id, "inner"],
            ["incomplete", q.steps[0]!.value.id, emptyGroup.value.id, ""],
            ["incomplete", q.steps[1]!.value.id, "", ""],
        ]);
    });

    test("a field of the wrong kind for its step: one problem, on the slot that holds it", () => {
        const steps: readonly (readonly [Step, string])[] = [
            [sort("lines", "asc"), "field"],
            [groupBy("lines", [agg("count", undefined, "n")]), "by"],
            [drill("total"), "field"],
            [datepart("customer_id", "year", "year"), "field"],
        ];
        for (const [step, slot] of steps) {
            assert.deepEqual(problems(query("orders", [step])).map(d => [d.code, d.stepId, d.slot]), [["type_mismatch", step.value.id, slot]], step.type);
        }
        const most = agg("max", "lines", "most");
        assert.deepEqual(problems(query("orders", [groupBy("customer_id", [most])])).map(d => [d.code, d.slot, d.id]), [["type_mismatch", "agg-field", most.id]]);
    });

    test("a comparison its field's kind does not take: one problem, on the comparison", () => {
        const c = cond("total", "contains", text("1"));
        assert.deepEqual(problems(query("orders", [filter("all", [c])])).map(d => [d.code, d.condId, d.slot]), [["type_mismatch", c.value.id, "cmp"]]);
    });

    test("a value its comparison cannot use: on the value", () => {
        const values: readonly (readonly [string, Condition])[] = [
            ["a number that is not one", cond("total", "ge", text("abc"))],
            ["a whole number against a fraction", cond("id", "eq", num(1.5))],
            ["a year that is not a number", cond("status.shipped.date", "inYear", text("next year"))],
            ["a date that is not one", cond("status.shipped.date", "onOrAfter", text("2026-13-01"))],
        ];
        for (const [name, c] of values) {
            const q = query("orders", [filter("all", [cond("status", "eq", text("shipped")), c])]);
            assert.deepEqual(problems(q).map(d => [d.code, d.condId, d.slot]), [["type_mismatch", c.value.id, "value"]], name);
        }
    });

    test("Look up: a data source that is not a Dict, a key of another kind, a field its rows lack, a data source not bound", () => {
        for (const dataset of ["orders", "forecast", "model"]) {
            const step = lookup(dataset, "customer_id", ["total"]);
            assert.deepEqual(problems(query("orders", [step])).map(d => [d.code, d.stepId, d.slot]), [["not_indexable", step.value.id, "dataset"]], dataset);
        }
        const byId = lookup("customers", "id", ["name"]);
        assert.deepEqual(problems(query("orders", [byId])).map(d => [d.code, d.slot]), [["type_mismatch", "key"]]);
        const misspelt = lookup("customers", "customer_id", ["nme"]);
        const q = query("orders", [misspelt]);
        const [d, ...rest] = problems(q);
        assert.deepEqual([d?.code, d?.slot, d?.id, rest.length], ["unknown_field", "fields", "nme", 0]);
        const fixed = assertFixed(q, d!.fixes[0]!);
        assert.deepEqual(fixed.steps[0]!.type === "lookup" ? fixed.steps[0]!.value.fields : [], ["name"]);
        const unbound = lookup("custs", "customer_id", ["name"]);
        assert.deepEqual(problems(query("orders", [unbound])).map(x => [x.code, x.stepId, x.slot]), [["unknown_field", unbound.value.id, "dataset"]]);
    });

    test("List every part with no tree, Try the model with no calculation, and the model's range", () => {
        const noTree = walk("lines");
        assert.deepEqual(problems(query("orders", [noTree])).map(d => [d.code, d.stepId, d.slot]), [["type_mismatch", noTree.value.id, "via"]]);
        const noModel = tabulate("price", 10, 12, 0.5, [], "demand");
        assert.deepEqual(problems(query("orders", [noModel])).map(d => [d.code, d.stepId, d.slot ?? ""]), [["type_mismatch", noModel.value.id, ""]]);
        const empty = tabulate("price", 12, 10, 0.5, [["region", text("NSW")]], "demand");
        assert.deepEqual(problems(query("model", [empty])).map(d => [d.severity, d.code, d.slot]), [["error", "type_mismatch", "range"]]);
        const long = tabulate("price", 0, 2000, 1, [["region", text("NSW")]], "demand");
        assert.deepEqual(problems(query("model", [long])).map(d => [d.severity, d.code, d.slot, d.context["rows"]]), [["warning", "too_many_rows", "range", "2001"]]);
        assert.deepEqual(problems(query("model", [tabulate("price", 1, 1000, 1, [["region", text("NSW")]], "demand")])), [], "a thousand rows are returned whole");
    });

    test("a jq step keeps the checker's words on its text: a syntax error, an excluded builtin, rows given more than once", () => {
        const broken = jq("map(");
        const [syntax] = problems(query("orders", [broken]));
        assert.deepEqual([syntax?.code, syntax?.stepId, syntax?.slot, syntax?.fixes.map(f => f.kind)], ["syntax", broken.value.id, "text", ["editJq"]]);
        // The checker's fix closes the bracket; what is left to write is the author's.
        const closed = applyFix(query("orders", [broken]), syntax!.fixes[0]!, ROOT);
        assert.equal(closed.steps[0]!.type === "jq" ? closed.steps[0]!.value.text : "", "map()");
        const excluded = jq("map(debug)");
        assert.deepEqual(problems(query("orders", [excluded])).map(d => [d.code, d.stepId, d.slot]), [["unsupported", excluded.value.id, "text"]]);
        const twice = jq("map(select(.lines[] | .qty > 1))");
        const q = query("orders", [twice]);
        const [d] = problems(q);
        assert.deepEqual([d?.severity, d?.code, d?.slot], ["warning", "duplicate_outputs", "text"]);
        const fixed = assertFixed(q, d!.fixes[0]!);
        assert.equal(fixed.steps[0]!.type === "jq" ? fixed.steps[0]!.value.text : "", "map(select(any(.lines[]; .qty > 1)))");
        assert.deepEqual(problems(fixed), []);
    });
});

/** Each step's shapes, as the check gives them. */
function stagesOf(q: StepQuery, root: EastType = ROOT): { before: Shape; after: Shape }[] {
    return checkSteps(q, root).stages.map(s => ({ before: s.before, after: s.after }));
}

describe("S3: shapes come from the checker's stages", () => {
    test("each step of the default query has the checker's type, and the steps' own knowledge", () => {
        const q = topShippedOrders();
        const checked = checkSteps(q, ROOT);
        assert.equal(checked.source.kind, "rows");
        assert.equal(checked.source.noun, "order");
        const stages = checked.layout.check.stages;
        // The checker's stages: the source, then each step's (one segment each here).
        checked.stages.forEach((s, i) => assert.ok(isTypeEqual(s.after.type, stages[i + 1]!.type), `step ${i}`));
        assert.deepEqual(checked.stages.map(s => s.after.kind), ["rows", "rows", "rows", "rows", "rows"]);
        assert.equal(checked.stages[4]!.after.limit, 10);
        assert.deepEqual([...checked.stages[0]!.after.narrowed], [["status", "shipped"]]);
        assert.deepEqual(fieldsOf(checked.final).map(f => f.ref), ["order", "customer", "region", "total", "shipped"]);
    });

    test("narrowing by a case makes the payload's fields exact downstream", () => {
        const [before] = stagesOf(query("orders", [filter("all", [cond("status", "eq", text("shipped"))])]));
        const open = fieldByRef(before!.before, "status.shipped.date")!;
        const narrowed = fieldByRef(before!.after, "status.shipped.date")!;
        assert.ok(open.optional && isTypeEqual(open.type, OptionType(DateTimeType)));
        assert.ok(!narrowed.optional && isTypeEqual(narrowed.type, DateTimeType));
        assert.ok(narrowed.payload?.narrowed === true);
    });

    test("the steps keep narrowing exactly where the checker does", () => {
        const narrow = filter("all", [cond("status", "eq", text("shipped"))]);
        const read = datepart("status.shipped.date", "month", "month");
        const between: [string, Step][] = [
            ["lookup", lookup("customers", "customer_id", ["region"])],
            ["sort", sort("total", "desc")],
            ["limit", limit(5)],
            ["datepart", datepart("status.shipped.date", "year", "year")],
            ["pick", pick([pickField("status", "status"), pickField("total", "total")])],
            ["fill", fill("discount", num(0))],
        ];
        for (const [name, step] of between) {
            const q = query("orders", [narrow, step, read]);
            const checked = checkSteps(q, ROOT);
            const modelNarrowed = checked.stages[1]!.after.narrowed.get("status") === "shipped";
            const checkerAccepts = !checked.diagnostics.some(d => d.severity === "error");
            assert.equal(modelNarrowed, checkerAccepts, `${name}: the steps say ${modelNarrowed ? "" : "not "}narrowed; the checker ${checkerAccepts ? "accepts" : "refuses"} the read`);
        }
    });

    test("an unfinished step's shape is its input's; a reshaping step's is its own", () => {
        const q = query("orders", [newStep("sort", layOutSteps(query("orders", []), ROOT).source, ROOT), count(), groupBy(undefined, [agg("count", undefined, "n")])]);
        const [sorting, counting] = stagesOf(q);
        assert.ok(isTypeEqual(sorting!.after.type, sorting!.before.type));
        assert.equal(counting!.after.kind, "one");
        assert.ok(isTypeEqual(counting!.after.type, IntegerType));
    });

    test("a step that does not check leaves the shape as it was, and later steps still print", () => {
        const q = query("orders", [filter("all", [cond("totl", "ge", num(1))]), limit(2)]);
        const checked = checkSteps(q, ROOT);
        assert.ok(isTypeEqual(checked.stages[0]!.after.type, checked.stages[0]!.before.type));
        assert.equal(checked.program, ".orders\n| map(select(.totl >= 1))\n| .[:2]");
    });
});

describe("S4: countingProgram", () => {
    test("the default query counts 40, 16, 16, 16, 16, 10, and gives its own result", () => {
        const q = topShippedOrders();
        const plain = printSteps(q, ROOT).text;
        const resultType = checkJq(plain, ROOT, { root: true }).elementType!;
        const OutputType = StructType({ counts: ArrayType(IntegerType), result: resultType });
        const { text: program, counted } = countingProgram(q, ROOT);
        const output = evaluateJq(program, fixture.value, { inputType: ROOT, root: true });
        assert.ok(isValueOf(output, OutputType), "the counting program gives {counts, result}");
        const { counts, value } = readCounts(output as ValueTypeOf<typeof OutputType>, counted);
        assert.deepEqual(counted.map(c => counts.get(c)), [40, 16, 16, 16, 16, 10]);
        assert.equal(counted[0], SOURCE_COUNT);
        assert.deepEqual(counted.slice(1), q.steps.map(s => s.value.id));
        assert.ok(equalFor(resultType)(value, evaluateJq(plain, fixture.value, { inputType: ROOT, root: true })), "the result is the query's own");
    });

    test("a query that gives one value counts its rows stages and returns the value", () => {
        const q = query("orders", [filter("all", [cond("status", "eq", text("cancelled"))]), count()]);
        const { text: program, counted } = countingProgram(q, ROOT);
        assert.equal(program.split("\n").at(-1), "| {counts: [$n0, $n1], result: .}");
        assert.equal(counted.length, 2);
    });
});

describe("S5: every step is a value of its East type", () => {
    const before = (source: string): Shape => layOutSteps(query(source, []), ROOT).source;
    const KINDS: readonly [StepKind, string][] = [
        ["filter", "orders"], ["lookup", "orders"], ["group", "orders"], ["sort", "orders"], ["limit", "orders"], ["count", "orders"],
        ["pick", "orders"], ["fill", "orders"], ["drill", "orders"], ["datepart", "orders"], ["walk", "bom"], ["tabulate", "model"], ["jq", "orders"],
    ];

    test("each new step, with its defaults", () => {
        for (const [kind, source] of KINDS) {
            const step = newStep(kind, before(source), ROOT);
            assert.ok(isValueOf(step, QueryStepType), kind);
        }
        const orders = before("orders");
        const at = <K extends StepKind>(kind: K): Extract<Step, { type: K }> => newStep(kind, orders, ROOT) as Extract<Step, { type: K }>;
        const lookupStep = at("lookup").value;
        assert.deepEqual([lookupStep.dataset, lookupStep.key, lookupStep.fields], [some("customers"), some("customer_id"), ["name"]]);
        assert.deepEqual(at("pick").value.fields.map(p => p.as), ["customer_id", "discount", "id"]);
        const fillStep = at("fill").value;
        assert.ok(equalFor(OptionType(StringType))(fillStep.field, some("discount")) && equalFor(OptionType(QueryStepValueType))(fillStep.value, some(num(0))));
        assert.deepEqual([at("datepart").value.field, at("datepart").value.as], [some("status.shipped.date"), "shipped_month"]);
        const walkStep = newStep("walk", before("bom"), ROOT);
        assert.ok(walkStep.type === "walk" && equalFor(OptionType(StringType))(walkStep.value.via, some("children")));
        const model = newStep("tabulate", before("model"), ROOT);
        assert.ok(model.type === "tabulate" && model.value.over === "price" && equalFor(QueryStepType)(model, variant("tabulate", {
            ...model.value, from: variant("number", 10), to: variant("number", 12), step: variant("number", 0.5),
        })));
    });

    test("every step parseSteps makes, and every query in the catalogue", () => {
        for (const [, root, build] of CATALOGUE) {
            const q = build();
            assert.ok(isValueOf(q, QueryStepsType));
            assert.ok(isValueOf(parsed(printSteps(q, root).text, root), QueryStepsType));
        }
    });

    test("each edit gives a value, equal to the one built by hand", () => {
        const a = cond("total", "ge", num(100));
        const b = cond("status", "eq", text("shipped"));
        const q = query("orders", [filter("all", [a]), limit(5)]);
        const step = q.steps[0]!;

        const withCond = addCondition(q, step.value.id, undefined, "added");
        assert.ok(equalSteps(withCond, query("orders", [variant("filter", { ...(step as Extract<Step, { type: "filter" }>).value, conds: [a, emptyCondition("added")] }), q.steps[1]!])), "addCondition appends an empty test");

        const grouped = addGroup(q, step.value.id);
        const added = grouped.steps[0]!.type === "filter" ? grouped.steps[0]!.value.conds[1]! : undefined;
        assert.ok(added?.type === "group" && added.value.match.type === "any" && added.value.conds.length === 2, "addGroup appends the opposite match, with two empty tests");

        assert.ok(equalSteps(removeCondition(withCond, step.value.id, "added"), q), "removeCondition takes it out");
        assert.ok(equalSteps(moveStep(q, q.steps[1]!.value.id, -1), query("orders", [q.steps[1]!, step])), "moveStep");
        assert.ok(equalSteps(removeStep(q, q.steps[1]!.value.id), query("orders", [step])), "removeStep");
        const counting = count();
        assert.ok(equalSteps(insertStep(q, counting, 1), query("orders", [step, counting, q.steps[1]!])), "insertStep");

        // A field of the same kind keeps the comparison and value; another starts from its own.
        const sameKind = setConditionField(q, step.value.id, a.value.id, "id", ROOT);
        assert.ok(equalFor(QueryStepType)(sameKind.steps[0]!, variant("filter", { ...(step as Extract<Step, { type: "filter" }>).value, conds: [variant("test", { ...(a as Extract<Condition, { type: "test" }>).value, field: some("id") }) as Condition] })), "a number for a number keeps the comparison and the value");
        const toList = setConditionField(q, step.value.id, a.value.id, "lines", ROOT);
        const list = toList.steps[0]!.type === "filter" ? toList.steps[0]!.value.conds[0]! : a;
        assert.ok(list.type === "test" && list.value.cmp.type === "some" && list.value.cmp.value.type === "lengthAtLeast", "a list starts with has at least");
        assert.ok(list.type === "test" && equalFor(OptionType(QueryStepValueType))(list.value.value, some(num(1))), "has at least 1");

        // A match that equals a group's takes the group apart.
        const nested = query("orders", [filter("all", [b, group("any", [a, cond("id", "eq", num(1))])])]);
        const flat = setMatch(nested, nested.steps[0]!.value.id, undefined, variant("any", null));
        assert.deepEqual(flat.steps[0]!.type === "filter" ? flat.steps[0]!.value.conds.map(c => c.type) : [], ["test", "test", "test"]);
        for (const edited of [withCond, grouped, sameKind, toList, flat]) assert.ok(isValueOf(edited, QueryStepsType), "each edit gives a value of the type");
    });
});

