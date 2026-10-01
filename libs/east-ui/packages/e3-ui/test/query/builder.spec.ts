/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Query.Builder>` (#935): an interface the browser draws — the
 * `QueryBuilder` carrier, holding the saved queries record bound for its
 * patch, the data sources read off their bindings, and its name — and its
 * surface's manifest (M1–M4); a save's patch (E3, E5); and whether a saved
 * query's data sources are bound where it would open.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, AsyncFunctionType, BooleanType, DictType, East, FloatType, FunctionType, IntegerType, NullType, OptionType, PatchType, SortedMap,
    StringType, StructType, ConflictError, applyFor, checkJq, compareFor, decodeBeast2For, equalFor, isTypeEqual, none, printType, some, toEastTypeValue, variant,
    type ValueTypeOf,
} from "@elaraai/east";
import e3 from "@elaraai/e3";
import { DatasetStatusType, RecordCommitInfoType, TreePathType } from "@elaraai/e3-types";
import { Reactive, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Query, Record, RecordOutcomeType, ui } from "@elaraai/e3-ui";
import {
    DataBindHandleType, DataPagedHandleType, DataSourceType, Query as QueryInternal, QueryBuilderPayloadType, QueriesHandleType,
    RecordBindingType, RecordErrorType, RecordMutateStatusType, SavedQueriesType,
} from "@elaraai/e3-ui/internal";

type SavedQuery = ValueTypeOf<typeof Query.Types.SavedQuery>;
type Saved = ValueTypeOf<typeof Query.Types.Saved>;
type TreePath = ValueTypeOf<typeof TreePathType>;

const OrderType = StructType({ id: IntegerType, total: FloatType });
const OrdersType = ArrayType(OrderType);
const CustomerType = StructType({ name: StringType, region: StringType });
const CustomersType = DictType(StringType, CustomerType);
const RegionsType = DictType(StringType, StringType);

const ORDERS: TreePath = [variant("field", "inputs"), variant("field", "orders")];
const CUSTOMERS: TreePath = [variant("field", "inputs"), variant("field", "customers")];

const sources = equalFor(ArrayType(DataSourceType));
const records = equalFor(SavedQueriesType);
const paths = equalFor(ArrayType(TreePathType));
const applySaved = applyFor(SavedQueriesType);

/** A record of saved queries, as a test holds one: by name. */
function saved(...queries: SavedQuery[]): Saved {
    return new SortedMap(queries.map((q): [string, SavedQuery] => [q.name, q]), compareFor(StringType));
}

/** The root a page binds: orders and customers. */
const ROOT = StructType({ orders: OrdersType, customers: CustomersType });

/** A saved query over the root, checked, reading what it reads. */
function savedQuery(name: string, program: string, root: { name: string; path: TreePath }[], description = none as ValueTypeOf<OptionType<typeof StringType>>): SavedQuery {
    const checked = checkJq(program, ROOT, { root: true });
    if (checked.query === null) assert.fail(`${program} does not check: ${checked.diagnostics.map((d) => d.message).join("; ")}`);
    return { name, description, query: checked.query, root, saved_at: new Date(Date.UTC(2026, 8, 30, 9, 0)) };
}

const BIG_ORDERS = savedQuery("Big orders", ".orders | map(select(.total >= 1000))", [{ name: "orders", path: ORDERS }]);
const ORDER_COUNT = savedQuery("Order count", ".orders | length", [{ name: "orders", path: ORDERS }]);

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
    binding: { source: CUSTOMERS, patch: none, mode: variant("direct", null) },
}));

/**
 * A Record.bind handle over a record of regions, bound with its patch — what
 * the record runtime gives. Spelled out, as `Record.bind` types it, since
 * `RecordBindHandleType` builds its mutations' fields in a loop.
 */
const RegionsHandleType = StructType({
    read: FunctionType([], RegionsType),
    status: FunctionType([], DatasetStatusType),
    history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
    mutate: StructType({
        pending: FunctionType([], BooleanType),
        status: FunctionType([], RecordMutateStatusType),
        error: FunctionType([], OptionType(RecordErrorType)),
        cancel: FunctionType([], NullType),
        patch: FunctionType([PatchType(RegionsType)], NullType),
    }),
    commit: StructType({ patch: AsyncFunctionType([StringType, PatchType(RegionsType)], RecordOutcomeType) }),
    start: FunctionType([], NullType),
    binding: RecordBindingType,
});
const boundRegions = East.function([], RegionsHandleType, (_$) => ({
    read: East.function([], RegionsType, (_$2) => new Map()),
    status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
    history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
    mutate: {
        pending: East.function([], BooleanType, (_$2) => false),
        status: East.function([], RecordMutateStatusType, (_$2) => variant("idle", null)),
        error: East.function([], OptionType(RecordErrorType), (_$2) => none),
        cancel: East.function([], NullType, (_$2) => null),
        patch: East.function([PatchType(RegionsType)], NullType, (_$2) => null),
    },
    commit: {
        patch: East.asyncFunction([StringType, PatchType(RegionsType)], RecordOutcomeType, (_$2) => variant("committed", { commitHash: "c", stateHash: "s" })),
    },
    start: East.function([], NullType, (_$2) => null),
    binding: { name: "regions", mutations: ["patch"] },
}));

/** The saved queries record, bound, as a value. */
const boundQueries = East.function([], QueriesHandleType, (_$) => ({
    read: East.function([], SavedQueriesType, (_$2) => saved(BIG_ORDERS)),
    history: East.function([], OptionType(ArrayType(RecordCommitInfoType)), (_$2) => none),
    commit: {
        patch: East.asyncFunction([StringType, PatchType(SavedQueriesType)], RecordOutcomeType, (_$2) => variant("committed", { commitHash: "c", stateHash: "s" })),
    },
}));

/** The builder's payload, as the renderer decodes it, over the handles above. */
function payloadOf(build: (handles: { queries: ReturnType<typeof boundQueries.call>; orders: ReturnType<typeof pagedOrders.call>; customers: ReturnType<typeof boundCustomers.call>; regions: ReturnType<typeof boundRegions.call> }) => ReturnType<typeof Query.Builder>): ValueTypeOf<typeof QueryBuilderPayloadType> {
    const value = East.compile(East.function([], UIComponentType, ($) => {
        const queries = $.let(boundQueries());
        const orders = $.let(pagedOrders());
        const customers = $.let(boundCustomers());
        const regions = $.let(boundRegions());
        return build({ queries, orders, customers, regions });
    }), [])();
    if (value.type !== "Extension") assert.fail(`expected the QueryBuilder carrier, got ${value.type}`);
    assert.equal(value.value.kind, "QueryBuilder");
    return decodeBeast2For(QueryBuilderPayloadType)(value.value.payload);
}

describe("<Query.Builder> (#935)", () => {
    test("the tag builds the QueryBuilder carrier, holding the bound record, the data sources in the order given and its name", () => {
        const payload = payloadOf(({ queries, orders, customers, regions }) =>
            Query.Builder({ queries, datasets: { orders, customers, regions }, id: "ops" }));
        assert.ok(sources(payload.datasets, [
            { name: "orders", source: variant("paged", ".inputs.orders"), type: toEastTypeValue(OrdersType) },
            { name: "customers", source: variant("value", CUSTOMERS), type: toEastTypeValue(CustomersType) },
            { name: "regions", source: variant("record", "regions"), type: toEastTypeValue(RegionsType) },
        ]), "each binding's descriptor, read off the handle, and its value's type");
        assert.deepEqual(payload.id, some("ops"));
        assert.ok(records(payload.queries.read(), saved(BIG_ORDERS)), "the bound record's read");

        const unnamed = payloadOf(({ queries, customers }) => Query.Builder({ queries, datasets: { customers } }));
        assert.deepEqual(unnamed.id, none, "an id not given is none");
    });

    test("M2, M3: only bound sources can be queried — a name a query can't read as a root field, and a builder handed none, are refused when the surface is built", () => {
        const build = (datasets: (h: { orders: ReturnType<typeof pagedOrders.call> }) => Parameters<typeof Query.Builder>[0]["datasets"]) => () =>
            East.function([], UIComponentType, ($) => {
                const queries = $.let(boundQueries());
                const orders = $.let(pagedOrders());
                return Query.Builder({ queries, datasets: datasets({ orders }) });
            });
        assert.throws(build(() => ({})), /Query\.Builder: datasets is empty/);
        assert.throws(build(({ orders }) => ({ "open-orders": orders })), /Query\.Builder: the data source "open-orders" can't be read as a root field/);
        assert.throws(build(({ orders }) => ({ "2026": orders })), /the data source "2026"/);
        assert.doesNotThrow(build(({ orders }) => ({ _orders2026: orders })));
    });

    test("M1: its surface's manifest is the record, its patch and each bound source — orders under pages, customers under paths — and nothing new", () => {
        const orders = e3.input("orders", OrdersType, variant("value", []));
        const customers = e3.input("customers", CustomersType, variant("value", new Map()));
        const queries = e3.record("queries", Query.Types.Saved, saved());
        const queriesPatch = e3.mutation.patch(queries);
        const surface = ui("query_builder", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const pagedOrders = $.let(Data.bindPaged(orders));
            const boundCustomers = $.let(Data.bind(customers));
            const record = $.let(Record.bind(queries, [queriesPatch]));
            return Query.Builder({ queries: record, datasets: { orders: pagedOrders, customers: boundCustomers } });
        }))));
        const manifest = surface.role.value!;
        assert.deepEqual(manifest.records, ["queries"]);
        assert.deepEqual(manifest.functions, []);
        assert.ok(paths(manifest.pages, [ORDERS]), "the paged source is declared, never preloaded");
        assert.ok(paths(manifest.paths, [CUSTOMERS, [variant("field", "records"), variant("field", "queries")]]), "the value source, and the record");
    });

    test("M4: Query.Types never depends on the data sources — a saved query is its name, description, checked query, root and time", () => {
        assert.ok(isTypeEqual(Query.Types.Saved, DictType(StringType, Query.Types.SavedQuery)));
        assert.deepEqual(Object.keys(Query.Types.SavedQuery.fields), ["name", "description", "query", "root", "saved_at"]);
        assert.equal(printType(Query.Types.RootEntry), printType(StructType({ name: StringType, path: TreePathType })));
        assert.ok(isTypeEqual(QueryInternal.Types.Handle, QueriesHandleType));
    });
});

describe("QueryInternal.save (#935)", () => {
    const save = East.compile(QueryInternal.save, []);

    test("E3: a query never saved inserts its entry, and only it", () => {
        const record = saved(BIG_ORDERS);
        const patch = save(record, none, ORDER_COUNT);
        if (patch.type !== "patch") assert.fail(`expected a patch by key, got ${patch.type}`);
        assert.deepEqual([...patch.value.entries()].map(([key, op]) => [key, op.type]), [["Order count", "insert"]]);
        assert.ok(records(applySaved(record, patch), saved(BIG_ORDERS, ORDER_COUNT)));
    });

    test("E3: a save under the open query's own name replaces its entry", () => {
        const record = saved(BIG_ORDERS, ORDER_COUNT);
        const described = { ...BIG_ORDERS, description: some("Orders of 1,000 or more.") };
        const patch = save(record, some("Big orders"), described);
        if (patch.type !== "patch") assert.fail(`expected a patch by key, got ${patch.type}`);
        assert.deepEqual([...patch.value.entries()].map(([key, op]) => [key, op.type]), [["Big orders", "update"]]);
        assert.ok(records(applySaved(record, patch), saved(described, ORDER_COUNT)));
    });

    test("E3: a save of the open query under a new name renames it — the new entry in, the open one out, in one patch", () => {
        const record = saved(BIG_ORDERS, ORDER_COUNT);
        const renamed = { ...BIG_ORDERS, name: "Large orders" };
        const patch = save(record, some("Big orders"), renamed);
        if (patch.type !== "patch") assert.fail(`expected a patch by key, got ${patch.type}`);
        assert.deepEqual([...patch.value.entries()].map(([key, op]) => [key, op.type]), [["Big orders", "delete"], ["Large orders", "insert"]]);
        assert.ok(records(applySaved(record, patch), saved(renamed, ORDER_COUNT)));
    });

    test("E5: a save drafted on an entry another write changed or removed since no longer applies, and neither does a name another write took first", () => {
        const began = saved(BIG_ORDERS);
        const described = { ...BIG_ORDERS, description: some("Orders of 1,000 or more.") };
        const changed = applySaved(began, save(began, some("Big orders"), described));
        const later = { ...BIG_ORDERS, description: some("Big ones."), saved_at: new Date(Date.UTC(2026, 8, 30, 10, 0)) };
        assert.throws(() => applySaved(changed, save(began, some("Big orders"), later)), ConflictError, "changed since");
        assert.throws(() => applySaved(saved(), save(began, some("Big orders"), later)), ConflictError, "removed since");
        const taken = saved(BIG_ORDERS, ORDER_COUNT);
        assert.throws(() => applySaved(taken, save(saved(BIG_ORDERS), none, ORDER_COUNT)), ConflictError, "a name another write took first");
        assert.throws(() => applySaved(taken, save(began, some("Big orders"), { ...later, name: "Order count" })), ConflictError, "a rename onto it");
    });
});

describe("QueryInternal.rootBound (#935)", () => {
    const rootBound = East.compile(QueryInternal.rootBound, []);
    const both = savedQuery("Orders with names", ".customers as $c | .orders | map({id, name: $c[\"C01\"].name})", [
        { name: "customers", path: CUSTOMERS }, { name: "orders", path: ORDERS },
    ]);

    test("a saved query opens where each data source it reads is bound by the same name, at the same path", () => {
        assert.deepEqual(rootBound(both, [{ name: "orders", path: ORDERS }, { name: "customers", path: CUSTOMERS }]), variant("bound", null));
    });

    test("one whose name isn't bound here is missing, the first in its root", () => {
        assert.deepEqual(rootBound(both, [{ name: "orders", path: ORDERS }]), variant("missing", "customers"));
        assert.deepEqual(rootBound(both, []), variant("missing", "customers"));
    });

    test("one whose name is bound here at another path is elsewhere, with the path it reads", () => {
        const other: TreePath = [variant("field", "inputs"), variant("field", "archive"), variant("field", "orders")];
        assert.deepEqual(rootBound(both, [{ name: "orders", path: other }, { name: "customers", path: CUSTOMERS }]),
            variant("elsewhere", { name: "orders", path: ORDERS }));
    });
});
