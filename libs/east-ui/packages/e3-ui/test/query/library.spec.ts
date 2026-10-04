/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Query.Library>` (#1063): an interface the browser draws — the
 * `QueryLibrary` carrier, holding the saved queries record bound for its
 * patch, the data sources read off their bindings, the builder it opens
 * queries in and who to tell — and its surface's manifest, which is the
 * record, its patch and each bound source, and nothing of its own (L7).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, BooleanType, East, IntegerType, NullType, OptionType, PatchType, StringType, decodeBeast2For, equalFor, isTypeEqual, none, some,
    toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { DatasetStatusType, RecordCommitInfoType, TreePathType } from "@elaraai/e3-types";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Query, Record, RecordOutcomeType, ui } from "@elaraai/e3-ui";
import {
    DataBindHandleType, DataPagedHandleType, DataSourceType, Query as QueryInternal, QueryLibraryComponent, QueryLibraryPayloadType,
    QueriesHandleType, SavedQueriesType,
} from "@elaraai/e3-ui/internal";
import * as ex from "./query.examples.js";

type TreePath = ValueTypeOf<typeof TreePathType>;

const OrdersType = ex.orders.type;
const CustomersType = ex.customers.type;

const sources = equalFor(ArrayType(DataSourceType));
const records = equalFor(SavedQueriesType);
const paths = equalFor(ArrayType(TreePathType));

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
    test("the tag builds the QueryLibrary carrier, holding the bound record, the data sources in the order given, the builder it opens queries in and who to tell", () => {
        const payload = payloadOf(({ queries, orders, customers }) =>
            Query.Library({ queries, datasets: { orders, customers }, id: "top", onOpen: East.function([StringType], NullType, (_$, _name) => null) }));
        assert.ok(sources(payload.datasets, [
            { name: "orders", source: variant("paged", ".inputs.orders"), type: toEastTypeValue(OrdersType) },
            { name: "customers", source: variant("value", ex.customers.path), type: toEastTypeValue(CustomersType) },
        ]), "each binding's descriptor, read off the handle, and its value's type");
        assert.deepEqual(payload.id, some("top"));
        if (payload.onOpen.type !== "some") assert.fail("onOpen is passed through");
        assert.equal(payload.onOpen.value("Revenue by region"), null, "the host's function, called with a query's name");
        assert.ok(records(payload.queries.read(), SAVED), "the bound record's read");

        const plain = payloadOf(({ queries, customers }) => Query.Library({ queries, datasets: { customers } }));
        assert.deepEqual([plain.id, plain.onOpen], [none, none], "an id and an onOpen not given are none");
    });

    test("only bound sources can be queried — a library handed none, or a name a query can't read as a root field, is refused when the surface is built", () => {
        const build = (datasets: (h: { orders: ReturnType<typeof pagedOrders.call> }) => Parameters<typeof Query.Library>[0]["datasets"]) => () =>
            East.function([], UIComponentType, ($) => {
                const queries = $.let(boundQueries());
                const orders = $.let(pagedOrders());
                return Query.Library({ queries, datasets: datasets({ orders }) });
            });
        assert.throws(build(() => ({})), /Query\.Library: datasets is empty/);
        assert.throws(build(({ orders }) => ({ "open-orders": orders })), /Query\.Library: the data source "open-orders" can't be read as a root field/);
        assert.doesNotThrow(build(({ orders }) => ({ orders })));
    });

    test("L7: its surface's manifest is the record, its patch and each bound source — orders under pages, customers under paths — and nothing of its own", () => {
        const surface = ui("query_library", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const orders = $.let(Data.bindPaged(ex.orders));
            const customers = $.let(Data.bind(ex.customers));
            const saved = $.let(Record.bind(ex.queries, [ex.queriesPatch]));
            return Query.Library({ queries: saved, datasets: { orders, customers } });
        }))));
        const manifest = surface.role.value!;
        assert.deepEqual(manifest.records, ["queries"]);
        assert.deepEqual(manifest.functions, []);
        const recordPath: TreePath = [variant("field", "records"), variant("field", "queries")];
        assert.ok(paths(manifest.pages, [ex.orders.path]), "the paged source is declared, never loaded whole");
        assert.ok(paths(manifest.paths, [ex.customers.path, recordPath]), "the value source, and the record");
    });

    test("the public Query namespace is the two components a solution mounts, the queries it ships and their types; the carrier and its payload are the internal one's", () => {
        assert.deepEqual(Object.keys(Query), ["Builder", "Library", "saved", "Types"]);
        assert.equal(QueryInternal.Library, Query.Library);
        assert.equal(QueryInternal.LibraryComponent, QueryLibraryComponent);
        assert.ok(isTypeEqual(QueryInternal.Types.LibraryPayload, QueryLibraryPayloadType));
    });
});
