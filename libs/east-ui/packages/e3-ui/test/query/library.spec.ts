/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Query.Library>` (#1063): an interface the browser draws — the
 * `QueryLibrary` carrier, holding the saved queries record bound for its
 * patch, the data sources read off their bindings, the open query its host
 * gives it and who it tells of another (#1668) — and its surface's manifest,
 * which is the record, its patch and each bound source, and nothing of its
 * own (L7); `Query.open`, which builds the open query a host holds; and the
 * rail a page narrows the saved queries by, over the record's indexes (#1758).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, BooleanType, East, IntegerType, NullType, OptionType, PatchType, StringType, decodeBeast2For, equalFor, isTypeEqual, none, some,
    toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { DatasetStatusType, RecordCommitInfoType, TreePathType } from "@elaraai/e3-types";
import { Slice } from "@elaraai/east-ui";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Query, Record, RecordOutcomeType, ui } from "@elaraai/e3-ui";
import {
    DataBindHandleType, DataPagedHandleType, DataSourceType, Query as QueryInternal, QueryLibraryComponent, QueryLibraryPayloadType,
    QueryOpenType, QueriesHandleType, SavedQueriesType,
} from "@elaraai/e3-ui/internal";
import * as ex from "./query.examples.js";

type TreePath = ValueTypeOf<typeof TreePathType>;

const OrdersType = ex.orders.type;
const CustomersType = ex.customers.type;

const sources = equalFor(ArrayType(DataSourceType));
const records = equalFor(SavedQueriesType);
const paths = equalFor(ArrayType(TreePathType));
const opens = equalFor(OptionType(Query.Types.Open));

/** A host's `onOpen`: told the query asked for. */
const heard = East.function([Query.Types.Open], NullType, (_$, _next) => null);

/** The examples' saved queries record: the mock's seven. */
const SAVED = ex.queries.default!;

/** A Data.bindPaged handle over the orders, as a value — what the paged runtime gives. */
const pagedOrders = East.function([], DataPagedHandleType(OrdersType), (_$) => ({
    id: ".inputs.orders",
    page: East.function([IntegerType, IntegerType], OptionType(OrdersType), (_$2) => none),
    total: East.function([], OptionType(IntegerType), (_$2) => none),
    seek: none,
    revision: East.function([], OptionType(StringType), (_$2) => none),
    refresh: East.function([OptionType(StringType)], NullType, (_$2) => null),
}));

/** A Data.bind handle over the customers, as a value — what the bind runtime gives. */
const boundCustomers = East.function([], DataBindHandleType(CustomersType), (_$) => ({
    read: East.function([], CustomersType, (_$2) => new Map()),
    write: East.function([CustomersType], NullType, (_$2) => null),
    writeAndStart: East.function([CustomersType], NullType, (_$2) => null),
    start: East.function([], NullType, (_$2) => null),
    source: East.function([], CustomersType, (_$2) => new Map()),
    pending: East.function([], BooleanType, (_$2) => false),
    commit: East.function([], NullType, (_$2) => null),
    discard: East.function([], NullType, (_$2) => null),
    has: East.function([], BooleanType, (_$2) => true),
    status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
    binding: { source: ex.customers.path, patch: none, mode: variant("direct", null) },
}));

/** The saved queries record, bound, as a value. */
const boundQueries = East.function([], QueriesHandleType, (_$) => ({
    read: East.function([], SavedQueriesType, (_$2) => SAVED),
    history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
    commit: {
        patch: East.asyncFunction([StringType, PatchType(SavedQueriesType)], RecordOutcomeType, (_$2) => variant("committed", { commitHash: "c", stateHash: "s" })),
    },
}));

/** The handles a library is handed, as the surface binds them. */
interface Handles {
    queries: ReturnType<typeof boundQueries.call>;
    orders: ReturnType<typeof pagedOrders.call>;
    customers: ReturnType<typeof boundCustomers.call>;
}

/** The library's payload, as the renderer decodes it, over the handles above. */
function payloadOf(build: (handles: Handles) => ReturnType<typeof Query.Library>): ValueTypeOf<typeof QueryLibraryPayloadType> {
    const value = East.compile(East.function([], UIComponentType, ($) => {
        const queries = $.let(boundQueries());
        const orders = $.let(pagedOrders());
        const customers = $.let(boundCustomers());
        return build({ queries, orders, customers });
    }), [])();
    if (value.type !== "Extension") assert.fail(`expected the QueryLibrary carrier, got ${value.type}`);
    assert.equal(value.value.kind, "QueryLibrary");
    return decodeBeast2For(QueryLibraryPayloadType)(value.value.payload);
}

describe("<Query.Library> (#1063)", () => {
    test("the tag builds the QueryLibrary carrier, holding the bound record, the data sources in the order given, the open query its host gives it, who to tell, and the builder that takes its cards", () => {
        const payload = payloadOf(({ queries, orders, customers }) =>
            Query.Library({ queries, datasets: { orders, customers }, id: "top", query: Query.open.saved("Revenue by region"), onOpen: heard }));
        assert.ok(sources(payload.datasets, [
            { name: "orders", source: variant("paged", ".inputs.orders"), type: toEastTypeValue(OrdersType) },
            { name: "customers", source: variant("value", ex.customers.path), type: toEastTypeValue(CustomersType) },
        ]), "each binding's descriptor, read off the handle, and its value's type");
        assert.deepEqual(payload.id, some("top"));
        assert.ok(opens(payload.query, some(variant("saved", "Revenue by region"))), "the open query the host gave");
        assert.equal(payload.onOpen(variant("saved", "Revenue by region")), null, "the host's function, called with the query asked for");
        assert.ok(records(payload.queries.read(), SAVED), "the bound record's read");

        const plain = payloadOf(({ queries, customers }) => Query.Library({ queries, datasets: { customers }, onOpen: heard }));
        assert.deepEqual([plain.id, plain.query], [none, none], "an id and an open query not given are none: no card is marked");
    });

    test("#1668: the open query it is given is whatever its host gives its builder — a saved query's name, an expression of one, or the open query itself", () => {
        const given = (query: NonNullable<Parameters<typeof Query.Library>[0]["query"]>) =>
            payloadOf(({ queries, customers }) => Query.Library({ queries, datasets: { customers }, query, onOpen: heard })).query;
        assert.ok(opens(given("Revenue by region"), some(variant("saved", "Revenue by region"))), "a name is the saved query of that name");
        assert.ok(opens(given(East.value("Revenue by region", StringType)), some(variant("saved", "Revenue by region"))), "an expression of a name");
        assert.ok(opens(given(Query.open.on("customers")), some(variant("new", { id: "on:customers", source: "customers", from: none }))), "Query.open.on");
        assert.ok(opens(given(variant("saved", "Revenue by region")), some(variant("saved", "Revenue by region"))), "the open query, as a value");
    });

    test("#1668: Query.open builds the open query a host holds — a saved query by its name, a new query on a data source, the same one each time", () => {
        const open = East.compile(East.function([StringType], ArrayType(Query.Types.Open), (_$, name) =>
            [Query.open.saved("Big orders"), Query.open.saved(name), Query.open.on("customers"), Query.open.on(name)]), []);
        assert.ok(equalFor(ArrayType(Query.Types.Open))(open("orders"), [
            variant("saved", "Big orders"),
            variant("saved", "orders"),
            variant("new", { id: "on:customers", source: "customers", from: none }),
            variant("new", { id: "on:orders", source: "orders", from: none }),
        ]));
    });

    test("#1668: the new query on a data source is one a data source, told from every other by its source's name — a source named as another query's id is its own; a builder that holds its own begins with the same one", () => {
        const openOn = East.compile(QueryInternal.openOn, []);
        const one = equalFor(Query.Types.Open);
        assert.ok(one(openOn("orders"), variant("new", { id: "on:orders", source: "orders", from: none })));
        assert.ok(one(openOn("orders"), openOn("orders")), "the same query each time");
        // A data source may be named anything a query reads as a root field: `first`, or `on`.
        const ids = ["orders", "first", "on", "on_orders"].map((source) => {
            const open = openOn(source);
            if (open.type !== "new") assert.fail("a new query");
            return open.value.id;
        });
        assert.deepEqual(ids, ["on:orders", "on:first", "on:on", "on:on_orders"]);
        assert.equal(new Set(ids).size, ids.length, "no two data sources share a new query");
        // What `Query.open.on` gives is this, as a page compiles it.
        const viaOpen = East.compile(East.function([StringType], Query.Types.Open, (_$, source) => Query.open.on(source)), []);
        assert.ok(one(viaOpen("first"), openOn("first")));
    });

    test("only bound sources can be queried — a library handed none, or a name a query can't read as a root field, is refused when the surface is built", () => {
        const build = (datasets: (h: { orders: ReturnType<typeof pagedOrders.call> }) => Parameters<typeof Query.Library>[0]["datasets"]) => () =>
            East.function([], UIComponentType, ($) => {
                const queries = $.let(boundQueries());
                const orders = $.let(pagedOrders());
                return Query.Library({ queries, datasets: datasets({ orders }), onOpen: heard });
            });
        assert.throws(build(() => ({})), /Query\.Library: datasets is empty/);
        assert.throws(build(({ orders }) => ({ "open-orders": orders })), /Query\.Library: the data source "open-orders" can't be read as a root field/);
        assert.doesNotThrow(build(({ orders }) => ({ orders })));
    });

    test("L7: its surface's manifest is the record, its patch and each bound source — orders under pages, customers under paths — and nothing of its own", () => {
        const surface = ui("query_library", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const orders = $.let(Data.bindPaged(ex.orders));
            const customers = $.let(Data.bind(ex.customers));
            const saved = $.let(Record.bind(ex.queries));
            return Query.Library({ queries: saved, datasets: { orders, customers }, onOpen: heard });
        }))));
        const manifest = surface.role.value!;
        assert.deepEqual(manifest.records, ["queries"]);
        assert.deepEqual(manifest.functions, []);
        const recordPath: TreePath = [variant("field", "records"), variant("field", "queries")];
        assert.ok(paths(manifest.pages, [ex.orders.path]), "the paged source is declared, never loaded whole");
        assert.ok(paths(manifest.paths, [ex.customers.path, recordPath]), "the value source, and the record");
    });

    test("#1758: the saved queries narrow through the record's indexes — a rail over Data source and Tag, the Saved range, and a search by the start of a name, a data source or a tag", () => {
        const INDEXES = ["queries_by_source", "queries_by_tag", "queries_by_name", "queries_by_saved_at"] as const;
        assert.deepEqual(Object.keys(ex.queries.indexes).sort(), [...INDEXES].sort(), "the examples' record declares the four");
        // What the rail narrows by is checked where it is built, against the record's fields and its indexes — over the
        // paged source alone: the record is read through its indexes, never whole beside them.
        const rail = (search: readonly string[]) => () => East.function([], StringType, ($) => {
            const slice = $.let(Slice.bindRecords("queries.library", {
                rows: {
                    source: Data.bindPaged(ex.queries, { indexes: [...INDEXES] }), label: "Queries", range: "saved_at", search: [...search] as ("name" | "sources" | "tags")[],
                    fields: { name: { label: "Name" }, sources: { label: "Data source" }, tags: { label: "Tag" }, saved_at: { label: "Saved" } },
                },
            }));
            return slice.key;
        });
        assert.doesNotThrow(rail(["name", "sources", "tags"]));
        // A field no index is led by is refused there, naming it.
        assert.throws(rail(["description"]), /description/);
    });

    test("the public Query namespace is the two components a solution mounts, the queries it ships, the open query a host holds, its record's migration steps and their types; the carrier and its payload are the internal one's", () => {
        assert.deepEqual(Object.keys(Query), ["Builder", "Library", "value", "open", "migrations", "Types"]);
        assert.deepEqual(Object.keys(Query.migrations), ["sourcesAndTags"]);
        assert.ok(isTypeEqual(Query.Types.Open, QueryOpenType));
        assert.equal(QueryInternal.Library, Query.Library);
        assert.equal(QueryInternal.LibraryComponent, QueryLibraryComponent);
        assert.ok(isTypeEqual(QueryInternal.Types.LibraryPayload, QueryLibraryPayloadType));
    });
});
