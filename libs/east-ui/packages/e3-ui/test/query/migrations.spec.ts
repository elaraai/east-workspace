/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The saved queries record's migrations (#1758):
 * `Query.migrations.sourcesAndTags` carries a saved query to the type that
 * holds the names of the data sources it reads and its tags — its sources the
 * names of its root, no tags, nothing else changed — and a solution's record
 * declares it as a rows step. The types it takes and leaves are frozen copies,
 * and what it computes is written out in it: the type it leaves is the saved
 * queries' own today and its sources what `querySources` gives, each of which
 * a test holds it to, and both stay as they are when the query builder's type
 * moves on — so a later field is another type, which the record is refused at
 * without a step of its own. A deploy that runs the step on a runner is
 * e3-ui-cli's `query-migration.spec.ts`.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    DictType, East, Expr, IntegerType, SetType, SortedMap, SortedSet, StringType, StructType, checkJq, compareFor, equalFor, isTypeEqual, none, printType, some,
    variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { TreePathType } from "@elaraai/e3-types";

import { Query } from "@elaraai/e3-ui";
import { Query as QueryInternal } from "@elaraai/e3-ui/internal";

type SavedQuery = ValueTypeOf<typeof Query.Types.SavedQuery>;
type TreePath = ValueTypeOf<typeof TreePathType>;

const carry = East.compile(Query.migrations.sourcesAndTags, []);
const sourcesOf = East.compile(QueryInternal.sources, []);
const sameQuery = equalFor(Query.Types.SavedQuery);
const sameNames = equalFor(SetType(StringType));

const ORDERS: TreePath = [variant("field", "inputs"), variant("field", "orders")];
const CUSTOMERS: TreePath = [variant("field", "inputs"), variant("field", "customers")];
const AT = new Date(Date.UTC(2026, 8, 30, 9, 0));

/** The root a page binds: orders and customers. */
const ROOT = StructType({ orders: DictType(StringType, IntegerType), customers: DictType(StringType, StringType) });

/** A program as a saved query keeps it. */
function programOf(jq: string): SavedQuery["program"] {
    const checked = checkJq(jq, ROOT, { root: true });
    if (checked.program === null) assert.fail(`${jq} does not check: ${checked.diagnostics.map((d) => d.message).join("; ")}`);
    return checked.program;
}

/** A set of text, in East's order. */
const texts = (...values: string[]) => new SortedSet(values, compareFor(StringType));

describe("Query.migrations.sourcesAndTags (#1758)", () => {
    test("a saved query is carried: its sources are the names of its root, it has no tags, and its name, description, program, root and time are as they were", () => {
        const before = {
            name: "Named orders",
            description: some("Each order, with its customer's name."),
            program: programOf(".customers as $c | .orders | length"),
            root: [{ name: "orders", path: ORDERS }, { name: "customers", path: CUSTOMERS }],
            saved_at: AT,
        };
        assert.ok(sameQuery(carry("Named orders", before), { ...before, tags: texts(), sources: texts("customers", "orders") }));
    });

    test("a query that reads no data source has none, and one with no description keeps none", () => {
        const before = { name: "Asked", description: none, program: programOf(".orders | length"), root: [], saved_at: AT };
        assert.ok(sameQuery(carry("Asked", before), { ...before, tags: texts(), sources: texts() }));
    });

    test("its sources are what a save gives: the step's own words and `querySources` agree on every root", () => {
        const roots: SavedQuery["root"][] = [
            [],
            [{ name: "orders", path: ORDERS }],
            [{ name: "orders", path: ORDERS }, { name: "customers", path: CUSTOMERS }],
            [{ name: "customers", path: CUSTOMERS }, { name: "orders", path: ORDERS }],
        ];
        for (const root of roots) {
            const carried = carry("Q", { name: "Q", description: none, program: programOf(".orders | length"), root, saved_at: AT });
            assert.ok(sameNames(carried.sources, sourcesOf(root)), `the root ${root.map((entry) => entry.name).join(", ")}`);
        }
    });

    test("it leaves the record as the type the query builder reads, so a solution lists it as its saved queries record's rows step", () => {
        const queries = e3.record("queries", Query.Types.Saved, {
            initial: new SortedMap<string, SavedQuery>([], compareFor(StringType)),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
            migrations: (migration) => [migration.rows("sources_and_tags", Query.migrations.sourcesAndTags)],
        });
        assert.ok(isTypeEqual(queries.type, Query.Types.Saved));
    });

    test("the types it takes and leaves, spelled out in migrations.ts, are the saved queries' today — when the query builder's type moves on this fails: before the step ships, bring the copies up to it; after, leave them and ship the step after", () => {
        const step: EastType = Expr.type(Query.migrations.sourcesAndTags);
        if (step.type !== "Function") assert.fail(`expected a function, got ${printType(step)}`);
        const [key, before] = step.inputs as EastType[];
        assert.ok(isTypeEqual(key!, StringType), "the key it takes is a saved query's name");
        assert.ok(isTypeEqual(step.output as EastType, Query.Types.SavedQuery), "the saved query it leaves is the saved queries' own");
        if (before!.type !== "Struct") assert.fail(`expected a struct, got ${printType(before!)}`);
        assert.deepEqual(Object.keys(before.fields), ["name", "description", "program", "root", "saved_at"], "the saved query it takes is the one stored before #1758");
    });

    test("a later field is another type: a record declared with it and this step alone is refused where it is declared, so its release ships a step of its own", () => {
        // The saved queries' type as a release that adds a field would declare it: this step still leaves the type it
        // shipped with, which is that type no longer.
        const Wider = StructType({ ...Query.Types.SavedQuery.fields, owner: StringType });
        assert.throws(() => e3.record("queries_wider", DictType(StringType, Wider), {
            initial: new SortedMap<string, ValueTypeOf<typeof Wider>>([], compareFor(StringType)),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
            migrations: (migration) => [migration.rows("sources_and_tags", Query.migrations.sourcesAndTags)],
        }), /^Error: e3\.record 'queries_wider' is declared as .+, but its last migration, 'sources_and_tags', leaves it as /);
    });
});
