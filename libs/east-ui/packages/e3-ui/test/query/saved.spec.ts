/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Query.value` (#1138): the saved queries a solution ships in its record,
 * each checked against the data sources it may read when the package is
 * built — keeping its program as written, the data sources it reads, by name
 * and path, their names as its `sources` and its tags (#1758) — and refused
 * when it does not check, when two have one name, when a data source can't be
 * read as a root field, when a description holds more than 140 characters and
 * when a tag is empty.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ArrayType, DictType, East, FloatType, IntegerType, SetType, SortedSet, StringType, StructType, compareFor, equalFor, none, parseJq, some, variant, type JqNode } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { Query } from "@elaraai/e3-ui";

const OrdersType = ArrayType(StructType({ customer_id: StringType, id: IntegerType, total: FloatType }));
const CustomersType = DictType(StringType, StructType({ name: StringType, region: StringType }));

const orders = e3.input("orders", OrdersType, variant("value", []));
const customers = e3.input("customers", CustomersType, variant("value", new Map()));

/** A task, whose data is its output: each order's total. */
const totals = e3.task("totals", [orders], East.function([OrdersType], ArrayType(FloatType), (_$, rows) => rows.map((_$2, order) => order.total)));

const AT = new Date(Date.UTC(2026, 9, 1, 9, 0));
const sameQuery = equalFor(Query.Types.SavedQuery);
const sameNames = equalFor(SetType(StringType));

/** A set of text, in East's order: a saved query's tags, or its sources' names. */
const texts = (...values: string[]) => new SortedSet(values, compareFor(StringType));

/** A program as the parser gives it: what a saved query keeps. */
function programOf(jq: string): JqNode {
    const parsed = parseJq(jq).program;
    if (parsed.type !== "some") assert.fail(`${jq} does not parse`);
    return parsed.value;
}

describe("Query.value (#1138)", () => {
    test("each query keeps its program as written and the data sources it reads, in the order given, by name and path, and the record is by name", () => {
        const named = ".customers as $c | .orders | map({id, name: $c[.customer_id].name})";
        const saved = Query.value({ orders, customers, totals }, [
            { name: "Revenue", jq: ".totals | add", description: "Every order's total, added up.", savedAt: AT },
            { name: "Named orders", jq: named, savedAt: AT },
        ]);
        assert.deepEqual([...saved.keys()], ["Named orders", "Revenue"]);
        assert.ok(sameQuery(saved.get("Revenue")!, {
            name: "Revenue",
            description: some("Every order's total, added up."),
            tags: texts(),
            program: programOf(".totals | add"),
            root: [{ name: "totals", path: totals.output.path }],
            sources: texts("totals"),
            saved_at: AT,
        }), "a task's data source is its output dataset");
        assert.ok(sameQuery(saved.get("Named orders")!, {
            name: "Named orders",
            description: none,
            tags: texts(),
            program: programOf(named),
            root: [{ name: "orders", path: orders.path }, { name: "customers", path: customers.path }],
            sources: texts("customers", "orders"),
            saved_at: AT,
        }), "the data sources it reads, in the order they are given, not the order it reads them");
    });

    test("a query reads a data source by the name it is given, whatever its dataset is called", () => {
        const saved = Query.value({ sales: orders }, [{ name: "Sales", jq: ".sales | length", savedAt: AT }]);
        assert.ok(equalFor(ArrayType(Query.Types.RootEntry))(saved.get("Sales")!.root, [{ name: "sales", path: orders.path }]));
    });

    test("a query may read .now, the minute it is asked (#1670), which is no data source of its root; a data source named now is what .now reads", () => {
        const entries = equalFor(ArrayType(Query.Types.RootEntry));
        const saved = Query.value({ orders }, [{ name: "Asked", jq: ".now as $now | {asked: $now, week_ago: ($now | datetime_add(-7; \"day\")), orders: (.orders | length)}", savedAt: AT }]);
        assert.ok(entries(saved.get("Asked")!.root, [{ name: "orders", path: orders.path }]), "the minute is no data source");
        const named = Query.value({ now: orders }, [{ name: "Named", jq: ".now | length", savedAt: AT }]);
        assert.ok(entries(named.get("Named")!.root, [{ name: "now", path: orders.path }]));
        assert.throws(
            () => Query.value({ now: orders }, [{ name: "Clock", jq: ".now | datetime_add(1; \"day\")", savedAt: AT }]),
            /Query\.value: "Clock" does not check/,
            "a data source named now is no DateTime",
        );
    });

    test("#1758: its sources are the names of the data sources it reads, and its tags the ones given, each once and without the spaces around it", () => {
        const saved = Query.value({ sales: orders, customers }, [
            { name: "Sales", jq: ".sales | length", tags: [" weekly", "sales", "weekly "], savedAt: AT },
            { name: "Asked", jq: ".now", savedAt: AT },
        ]);
        assert.ok(sameNames(saved.get("Sales")!.sources, texts("sales")), "the name it is read by, never its dataset's, and not a data source it does not read");
        assert.ok(sameNames(saved.get("Sales")!.tags, texts("sales", "weekly")));
        assert.ok(sameNames(saved.get("Asked")!.sources, texts()), "a query over the minute alone reads no data source");
        assert.ok(sameNames(saved.get("Asked")!.tags, texts()), "tags not given are none");
    });

    test("#1758: an empty tag is refused, naming the query", () => {
        assert.throws(
            () => Query.value({ orders }, [{ name: "Count", jq: ".orders | length", tags: ["sales", "  "], savedAt: AT }]),
            /Query\.value: "Count" has an empty tag — a tag is a word or two to find the query by/,
        );
    });

    test("a lint is no bar: a query whose only problems are warnings saves, as the builder saves it", () => {
        const saved = Query.value({ orders }, [{ name: "Totals", jq: ".orders | map(.total //= 0.0)", savedAt: AT }]);
        assert.ok(equalFor(Query.Types.SavedQuery.fields.program)(saved.get("Totals")!.program, programOf(".orders | map(.total //= 0.0)")));
    });

    test("a query that does not check fails the build, naming it and saying why", () => {
        assert.throws(
            () => Query.value({ orders }, [{ name: "Typo", jq: ".orders | map(.totl)", savedAt: AT }]),
            /^Error: Query\.value: "Typo" does not check — unknown_field: \.totl is not a field of .*Did you mean \.total\?$/,
        );
        assert.throws(
            () => Query.value({ orders }, [{ name: "Elsewhere", jq: ".customers | length", savedAt: AT }]),
            /Query\.value: "Elsewhere" does not check — unknown_field: \.customers is not a dataset in this workspace\./,
            "a data source it was not given is not one it can read",
        );
    });

    test("two queries of one name are refused: a saved query's name is its key in the record", () => {
        assert.throws(
            () => Query.value({ orders }, [
                { name: "Count", jq: ".orders | length", savedAt: AT },
                { name: "Count", jq: ".orders | map(.id)", savedAt: AT },
            ]),
            /Query\.value: "Count" is saved twice — a saved query's name is its key in the record/,
        );
    });

    test("a data source a query can't read as a root field is refused, naming it", () => {
        assert.throws(() => Query.value({ "open-orders": orders }, []), /Query\.value: the data source "open-orders" can't be read as a root field/);
    });

    test("a description holds at most 140 characters, as the builder's Save… popover takes it", () => {
        const at = (description: string) => () => Query.value({ orders }, [{ name: "Count", jq: ".orders | length", description, savedAt: AT }]);
        assert.doesNotThrow(at("x".repeat(140)));
        assert.throws(at("x".repeat(141)), /Query\.value: "Count"'s description is 141 characters — a description holds at most 140/);
    });

    test("the queries declare a record of the saved queries' type", () => {
        const queries = e3.record("queries", Query.Types.Saved, { initial: Query.value({ orders }, [{ name: "Count", jq: ".orders | length", savedAt: AT }]) });
        assert.deepEqual([...queries.default!.keys()], ["Count"]);
    });

    test("#1758: the record takes an index led by its sources, its tags, its name and when it was saved", () => {
        const queries = e3.record("queries", Query.Types.Saved, {
            initial: Query.value({ orders }, [{ name: "Count", jq: ".orders | length", tags: ["sales"], savedAt: AT }]),
            mutations: (mutation) => ({ patch: mutation.patch() }),
            indexes: (index) => ({
                queries_by_source: index.on(["sources"]),
                queries_by_tag: index.on(["tags"]),
                queries_by_name: index.on(["name"]),
                queries_by_saved_at: index.on(["saved_at"]),
            }),
        });
        assert.deepEqual(Object.keys(queries.indexes).sort(), ["queries_by_name", "queries_by_saved_at", "queries_by_source", "queries_by_tag"]);
    });
});
