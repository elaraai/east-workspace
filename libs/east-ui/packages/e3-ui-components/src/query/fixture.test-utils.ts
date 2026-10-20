/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query tests' shared fixture (#875): the orders and the customers of
 * `east/test/fixtures/query-fixture.beast2` — the mock's data, which the e3-ui
 * query examples' `orders` and `customers` hold — their types, the root a page
 * binding them gives, and saved queries over it, checked as a save checks
 * them. What a test evaluates or checks itself, with no e3: a result's Table,
 * a run's words, a summary's values, the saved queries a test commits.
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    OptionType, SortedMap, StringType, checkJq, compareFor, decodeBeast2, fromEastTypeValue, none, toEastTypeValue, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { Query } from "@elaraai/e3-ui/internal";
import { TreePathType } from "@elaraai/e3-types";
import { queryRoot, type QueryRoot } from "./one-shot.js";
import type { SavedQuery } from "./session.js";

/** The saved queries record. */
export type Saved = ValueTypeOf<typeof Query.Types.Saved>;
type TreePath = ValueTypeOf<typeof TreePathType>;

/** Where e3 keeps the orders: the query examples' `orders` input. */
export const ORDERS: TreePath = [variant("field", "inputs"), variant("field", "orders")];
/** Where e3 keeps the customers: the query examples' `customers` input. */
export const CUSTOMERS: TreePath = [variant("field", "inputs"), variant("field", "customers")];

/** The shared fixture's types: the orders and the customers. */
const fixture = decodeBeast2(readFileSync(join(import.meta.dirname, "../../../../../east/test/fixtures/query-fixture.beast2")));
const FIXTURE = fromEastTypeValue(fixture.type);
if (FIXTURE.type !== "Struct") throw new Error("the fixture's root is a struct");
export const OrdersType = FIXTURE.fields["orders"] as EastType;
export const CustomersType = FIXTURE.fields["customers"] as EastType;
/** The shared fixture's root type, and its value: every dataset, by name. */
export const FixtureType: EastType = FIXTURE;
export const FIXTURE_VALUE: unknown = fixture.value;

/** The root a page binding orders and customers gives. */
export const ROOT: QueryRoot = queryRoot([
    { name: "orders", path: ORDERS, type: toEastTypeValue(OrdersType) },
    { name: "customers", path: CUSTOMERS, type: toEastTypeValue(CustomersType) },
]);

/** A saved query over a root — the orders' and the customers' unless given — checked as a save there checks it. */
export function savedQuery(name: string, program: string, description = none as ValueTypeOf<OptionType<typeof StringType>>, root: QueryRoot = ROOT): SavedQuery {
    const checked = checkJq(program, root.type, { root: true });
    if (checked.program === null) throw new Error(`${program}: ${checked.diagnostics.map(d => d.message).join("; ")}`);
    return {
        name, description, program: checked.program, saved_at: new Date(Date.UTC(2026, 8, 30, 9, 0)),
        root: root.entries.filter(e => checked.reads.includes(e.name)).map(e => ({ name: e.name, path: e.path })),
    };
}

/** Saved queries' names, in the record's order. */
export const keys = compareFor(StringType);

/** The saved queries record, keyed by name. */
export function savedRecord(queries: readonly SavedQuery[]): Saved {
    return new SortedMap(queries.map((q): [string, SavedQuery] => [q.name, q]), keys);
}
