/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's examples (#940): each runs, and the data they read is
 * #875's shared fixture (`libs/east/test/fixtures/query-fixture.beast2`, which
 * every runtime reads), value for value — so the showcase shows the mock's
 * numbers.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ArrayType, DateTimeType, East, FloatType, IntegerType, compareFor, decodeBeast2, equalFor, fromEastTypeValue, isTypeEqual, type EastType } from "@elaraai/east";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { Query } from "@elaraai/e3-ui";
import * as ex from "./query.examples.js";

describeEast("Query examples (#940)", (test) => {
    Assert.examples(test, {
        queryBuilder: ex.queryBuilder,
        queryBuilderBom: ex.queryBuilderBom,
        queryBuilderModel: ex.queryBuilderModel,
        queryBuilderEmpty: ex.queryBuilderEmpty,
        queryBuilderHistory: ex.queryBuilderHistory,
        queryLibrary: ex.queryLibrary,
    });
}, { platformFns: TestImpl });

/** The shared fixture: its root type, and every dataset's value by name. */
const fixture = decodeBeast2(readFileSync(new URL("../../../../../../east/test/fixtures/query-fixture.beast2", import.meta.url)));
const FixtureRoot = fromEastTypeValue(fixture.type);
const fixtureValue = fixture.value as Readonly<Record<string, unknown>>;

/** A dataset's own value, as its example seeds it. */
function seedOf(def: { readonly name: string; readonly source?: { readonly type: string; readonly value?: unknown } }): unknown {
    if (def.source?.type !== "value") assert.fail(`${def.name} is seeded with a value`);
    return def.source.value;
}

describe("the query examples' data (#940)", () => {
    test("each dataset is the shared fixture's, its type and its value", () => {
        if (FixtureRoot.type !== "Struct") assert.fail("the fixture's root is a struct");
        for (const def of [ex.orders, ex.customers, ex.forecast, ex.bom]) {
            const type = (FixtureRoot.fields as Readonly<Record<string, EastType>>)[def.name];
            if (type === undefined) assert.fail(`the fixture has no ${def.name}`);
            assert.ok(isTypeEqual(def.type, type), `${def.name}'s type`);
            assert.ok(equalFor(type)(seedOf(def) as never, fixtureValue[def.name] as never), `${def.name}'s value`);
        }
    });

    test("the demand model is the shared fixture's: the same type, and the same demand at every price and region it is asked", () => {
        if (FixtureRoot.type !== "Struct") assert.fail("the fixture's root is a struct");
        assert.ok(isTypeEqual(ex.model.type, (FixtureRoot.fields as Readonly<Record<string, EastType>>)["model"]!));
        const mine = seedOf(ex.model) as (input: { price: number; region: string }) => number;
        const theirs = fixtureValue["model"] as (input: { price: number; region: string }) => number;
        const same = equalFor(FloatType);
        for (const region of ["NSW", "VIC", "QLD", "WA", "SA", "TAS"]) {
            for (const price of [8.0, 10.0, 10.5, 11.25, 12.0]) {
                assert.ok(same(mine({ price, region }), theirs({ price, region })), `demand at ${price} in ${region}`);
            }
        }
    });

    test("the saved queries record holds the mock's seven, each reading the data sources the builders bind, by name and path", () => {
        const record = ex.queries.default!;
        assert.deepEqual([...record.keys()], [
            "Demand at $10–$12, NSW", "Large orders with no discount", "Pump parts cost", "Revenue by region",
            "Shipped revenue by month", "Top shipped orders, 2026", "Units by SKU",
        ]);
        const paths = new Map([ex.orders, ex.customers, ex.forecast, ex.model, ex.bom].map(def => [def.name, def.path]));
        const sameEntry = equalFor(Query.Types.RootEntry);
        for (const [name, saved] of record) {
            assert.ok(saved.root.length > 0, `${name} reads a data source`);
            for (const entry of saved.root) {
                const path = paths.get(entry.name);
                if (path === undefined) assert.fail(`${name} reads ${entry.name}, which no builder binds`);
                assert.ok(sameEntry(entry, { name: entry.name, path }), `${name} reads ${entry.name} at its path`);
            }
        }
    });
});

describe("the order history's data and saved queries (#1132)", () => {
    const accounts = East.compile(ex.generateAccounts, [])(20_000n);
    const credit = East.compile(ex.generateCredit, [])(20_000n);
    const history = East.compile(ex.generateHistory, [])(36_000n, 20_000n);

    test("the generated orders: 36,000, ids 100,001 on, seven in ten shipped 22 minutes apart from 6 January 2025, each placed by an account", () => {
        assert.equal(history.length, 36_000);
        assert.ok(equalFor(IntegerType)(history[0]!.id, 100_001n) && equalFor(IntegerType)(history.at(-1)!.id, 136_000n), "the ids");
        const count = (tag: string) => history.filter(order => order.status.type === tag).length;
        assert.deepEqual([count("shipped"), count("pending"), count("cancelled")], [25_200, 7_200, 3_600]);
        const first = history[0]!.status;
        if (first.type !== "shipped") assert.fail("the first order shipped");
        assert.ok(equalFor(DateTimeType)(first.value.date, new Date("2025-01-06T08:00:00.000Z")), "the first order shipped as the history opens");
        const unplaced = history.filter(order => !accounts.has(order.customer_id)).length;
        assert.equal(unplaced, 0, "every order's account is one of the generated accounts");
    });

    test("the generated accounts and their credit limits: 20,000 accounts, every fifth with no limit, each limit $5,000 to $49,950", () => {
        assert.equal(accounts.size, 20_000);
        assert.equal(credit.size, 16_000);
        const compare = compareFor(FloatType);
        assert.ok([...credit.values()].every(limit => compare(limit, 5_000) >= 0 && compare(limit, 49_950) <= 0), "every limit is in its range");
        assert.ok([...credit.keys()].every(key => accounts.has(key)), "every limit is an account's");
    });

    test("the history's three saved queries read the datasets its tasks generate, each at its task's output, in the order they are given", () => {
        const record = ex.historyQueries.default!;
        assert.deepEqual([...record.keys()], ["Credit by region", "History revenue by month", "History revenue by region"]);
        const roots = equalFor(ArrayType(Query.Types.RootEntry));
        const orderHistory = { name: "order_history", path: ex.historyTask.output.path };
        const accountsEntry = { name: "accounts", path: ex.accountsTask.output.path };
        const creditEntry = { name: "credit", path: ex.creditTask.output.path };
        assert.ok(roots(record.get("History revenue by month")!.root, [orderHistory]));
        assert.ok(roots(record.get("History revenue by region")!.root, [orderHistory, accountsEntry]));
        assert.ok(roots(record.get("Credit by region")!.root, [accountsEntry, creditEntry]));
    });
});
