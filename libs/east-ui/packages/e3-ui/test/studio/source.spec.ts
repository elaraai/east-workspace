/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Studio sources (#1669): `Studio.source(handle, meta)` over a `Data.bind`
 * and a `Data.bindPaged` handle, and the sources a surface lists as its
 * Studio components take them — each one's key, what operators see of it, its
 * binding and its fields, their kinds read from the row's type; the refusals,
 * where the surface is built, of a key a query can't read, of rows that are
 * not Structs, and of a field its rows lack; and each source's name by key.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, BooleanType, DateTimeType, DictType, East, FloatType, IntegerType, NullType, OptionType, StringType, StructType,
    equalFor, isTypeEqual, none, some, toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { DatasetStatusType, TreePathType } from "@elaraai/e3-types";

import { Query, Studio, type StudioSourceDeclaration } from "@elaraai/e3-ui";
import { DataBindHandleType, DataPagedHandleType, StudioSourceType, sourceNames, studioSources } from "@elaraai/e3-ui/internal";

type Source = ValueTypeOf<typeof Studio.Types.Source>;
type TreePath = ValueTypeOf<typeof TreePathType>;

/** One row per order line. */
const OrderType = StructType({
    ordered_at: DateTimeType,
    region: StringType,
    revenue: FloatType,
    units: IntegerType,
    shipped: BooleanType,
    promisedOn: OptionType(DateTimeType),
    lines: ArrayType(StringType),
});
const OrdersType = ArrayType(OrderType);
/** One row per machine, by its tag. */
const AssetsType = DictType(StringType, StructType({ site: StringType, run_hours: FloatType }));
/** A region's name, by its code: its rows are no Structs. */
const RegionsType = DictType(StringType, StringType);

const ASSETS: TreePath = [variant("field", "inputs"), variant("field", "assets")];
const REGIONS: TreePath = [variant("field", "inputs"), variant("field", "regions")];

/** A Data.bindPaged handle over the orders, as a value — what the paged runtime gives. */
const pagedOrders = East.function([], DataPagedHandleType(OrdersType), (_$) => ({
    id: ".inputs.orders",
    page: East.function([IntegerType, IntegerType], OptionType(OrdersType), (_$2) => none),
    total: East.function([], OptionType(IntegerType), (_$2) => none),
    seek: none,
    revision: East.function([], OptionType(StringType), (_$2) => none),
    refresh: East.function([OptionType(StringType)], NullType, (_$2) => null),
}));

/** A Data.bind handle over the assets, as a value — what the bind runtime gives. */
const boundAssets = East.function([], DataBindHandleType(AssetsType), (_$) => ({
    read: East.function([], AssetsType, (_$2) => new Map()),
    write: East.function([AssetsType], NullType, (_$2) => null),
    writeAndStart: East.function([AssetsType], NullType, (_$2) => null),
    start: East.function([], NullType, (_$2) => null),
    source: East.function([], AssetsType, (_$2) => new Map()),
    pending: East.function([], BooleanType, (_$2) => false),
    commit: East.function([], NullType, (_$2) => null),
    discard: East.function([], NullType, (_$2) => null),
    has: East.function([], BooleanType, (_$2) => true),
    status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
    binding: { source: ASSETS, patch: none, mode: variant("direct", null) },
}));

/** A Data.bind handle over the regions' names. */
const boundRegions = East.function([], DataBindHandleType(RegionsType), (_$) => ({
    read: East.function([], RegionsType, (_$2) => new Map()),
    write: East.function([RegionsType], NullType, (_$2) => null),
    writeAndStart: East.function([RegionsType], NullType, (_$2) => null),
    start: East.function([], NullType, (_$2) => null),
    source: East.function([], RegionsType, (_$2) => new Map()),
    pending: East.function([], BooleanType, (_$2) => false),
    commit: East.function([], NullType, (_$2) => null),
    discard: East.function([], NullType, (_$2) => null),
    has: East.function([], BooleanType, (_$2) => true),
    status: East.function([], DatasetStatusType, (_$2) => variant("up-to-date", null)),
    binding: { source: REGIONS, patch: none, mode: variant("direct", null) },
}));

interface Handles {
    orders: ReturnType<typeof pagedOrders.call>;
    assets: ReturnType<typeof boundAssets.call>;
    regions: ReturnType<typeof boundRegions.call>;
}

/** The sources a surface lists, as its Studio components take them, over the handles above. */
function listed(sources: (handles: Handles) => Record<string, StudioSourceDeclaration>): Source[] {
    return East.compile(East.function([], ArrayType(StudioSourceType), ($) => {
        const orders = $.let(pagedOrders());
        const assets = $.let(boundAssets());
        const regions = $.let(boundRegions());
        return studioSources("Studio.Builder", sources({ orders, assets, regions }));
    }), [])();
}

const sameSources = equalFor(ArrayType(StudioSourceType));
const field = (id: string, label: string, kind: Source["fields"][number]["kind"]["type"]): Source["fields"][number] => ({ id, label, kind: variant(kind, null), format: none });

describe("Studio.source — the sources a surface lists (#1669)", () => {
    test("a source is its key, what operators see of it, its binding and its value's type, and the fields given, in order, each with its label, its kind and its format", () => {
        const [orders, ...rest] = listed(({ orders }) => ({
            orders: Studio.source(orders, {
                name: "Orders", icon: "receipt", description: "One row per order line",
                fields: {
                    revenue: { label: "Revenue", format: { currency: { code: "AUD" } } },
                    ordered_at: { label: "Ordered" },
                    units: { format: "compact" },
                    region: {},
                },
                range: "ordered_at", search: ["region"], split: ["region"],
            }),
        }));
        assert.deepEqual(rest, [], "one source listed");
        if (orders === undefined) assert.fail("the source is listed");
        assert.deepEqual([orders.key, orders.name, orders.icon, orders.description], ["orders", "Orders", "receipt", some("One row per order line")]);
        assert.ok(equalFor(Query.Types.DataSource)(orders.binding, { name: "orders", source: variant("paged", ".inputs.orders"), type: toEastTypeValue(OrdersType) }),
            "the binding's descriptor, read off the handle under the source's key, and its value's type");
        assert.deepEqual(orders.fields.map((f) => [f.id, f.label, f.kind.type]), [
            ["revenue", "Revenue", "number"], ["ordered_at", "Ordered", "date"], ["units", "Units", "number"], ["region", "Region", "text"],
        ], "a label not given is made from the field's name");
        assert.deepEqual(orders.fields.map((f) => f.format.type === "some" ? f.format.value.type : "none"), ["currency", "none", "compact", "none"]);
        assert.deepEqual([orders.range, orders.search, orders.split], [some("ordered_at"), ["region"], ["region"]]);
    });

    test("fields omitted, every field of the row is offered under a label made from its name, its kind read from its type — an optional field's is its value's", () => {
        const sources = listed(({ orders, assets }) => ({
            orders: Studio.source(orders, { name: "Orders", icon: "receipt" }),
            assets: Studio.source(assets, { name: "Assets", icon: "gears" }),
        }));
        assert.ok(sameSources(sources, [
            {
                key: "orders", name: "Orders", icon: "receipt", description: none,
                binding: { name: "orders", source: variant("paged", ".inputs.orders"), type: toEastTypeValue(OrdersType) },
                fields: [
                    field("ordered_at", "Ordered at", "date"), field("region", "Region", "text"), field("revenue", "Revenue", "number"),
                    field("units", "Units", "number"), field("shipped", "Shipped", "boolean"), field("promisedOn", "Promised on", "date"),
                    field("lines", "Lines", "other"),
                ],
                range: none, search: [], split: [],
            },
            {
                key: "assets", name: "Assets", icon: "gears", description: none,
                binding: { name: "assets", source: variant("value", ASSETS), type: toEastTypeValue(AssetsType) },
                fields: [field("site", "Site", "text"), field("run_hours", "Run hours", "number")],
                range: none, search: [], split: [],
            },
        ]), "in the order listed: a paged source's rows are its page's, a Dict's its values'");
    });

    test("no sources listed is none: a surface without any still builds", () => {
        assert.deepEqual(listed(() => ({})), []);
        assert.deepEqual(East.compile(East.function([], ArrayType(StudioSourceType), (_$) => studioSources("Studio.Page", undefined)), [])(), []);
    });

    test("a field, a range, a search or a split field the row lacks is refused where the surface is built, naming the source and what its rows have — and held by TypeScript", () => {
        const has = /which its rows do not have — they have site, run_hours$/;
        // @ts-expect-error `hours` is no field of an asset
        assert.throws(() => listed(({ assets }) => ({ assets: Studio.source(assets, { name: "Assets", icon: "gears", fields: { hours: {} } }) })),
            (err: Error) => /^Studio\.Builder: the source "assets" names the field "hours", /.test(err.message) && has.test(err.message));
        // @ts-expect-error `ordered_at` is no field of an asset
        assert.throws(() => listed(({ assets }) => ({ assets: Studio.source(assets, { name: "Assets", icon: "gears", range: "ordered_at" }) })),
            /the source "assets" names the range field "ordered_at"/);
        // @ts-expect-error `customer` is no field of an asset
        assert.throws(() => listed(({ assets }) => ({ assets: Studio.source(assets, { name: "Assets", icon: "gears", search: ["site", "customer"] }) })),
            /the source "assets" names the search field "customer"/);
        // @ts-expect-error `category` is no field of an asset
        assert.throws(() => listed(({ assets }) => ({ assets: Studio.source(assets, { name: "Assets", icon: "gears", split: ["category"] }) })),
            /the source "assets" names the split field "category"/);
    });

    test("a range is over a date field: any other is refused", () => {
        assert.throws(() => listed(({ orders }) => ({ orders: Studio.source(orders, { name: "Orders", icon: "receipt", range: "region" }) })),
            /^Error: Studio\.Builder: the source "orders" names the range field "region", which is no date — a page's range is over a date field$/);
        assert.doesNotThrow(() => listed(({ orders }) => ({ orders: Studio.source(orders, { name: "Orders", icon: "receipt", range: "promisedOn" }) })),
            "an optional date is a date");
    });

    test("rows that are not Structs are refused, naming the source and what it reads; and a key a query can't read as a root field", () => {
        assert.throws(() => listed(({ regions }) => ({ regions: Studio.source(regions, { name: "Regions", icon: "map" }) })),
            /^Error: Studio\.Builder: the source "regions" reads \.Dict .+ — a source's rows are an Array of Structs, or a Dict of Structs$/);
        assert.throws(() => listed(({ orders }) => ({ "open-orders": Studio.source(orders, { name: "Orders", icon: "receipt" }) })),
            /Studio\.Builder: the data source "open-orders" can't be read as a root field/);
    });

    test("each listed source's name by its key; a key two share keeps the first one's", () => {
        const names = East.compile(sourceNames, []);
        const sources = listed(({ orders, assets }) => ({
            orders: Studio.source(orders, { name: "Orders", icon: "receipt" }),
            assets: Studio.source(assets, { name: "Assets", icon: "gears" }),
        }));
        assert.deepEqual([...names(sources)], [["assets", "Assets"], ["orders", "Orders"]]);
        assert.deepEqual([...names([sources[0]!, { ...sources[1]!, key: "orders" }])], [["orders", "Orders"]]);
    });

    test("Studio.Types.Source is data only: its binding is the query builder's data source, and it holds no function", () => {
        assert.ok(isTypeEqual(Studio.Types.Source, StudioSourceType));
        assert.ok(isTypeEqual(Studio.Types.Source.fields.binding, Query.Types.DataSource));
        assert.deepEqual(Object.keys(Studio.Types.Source.fields), ["key", "name", "icon", "description", "binding", "fields", "range", "search", "split"]);
        assert.deepEqual(Object.keys(Studio.Types.Field.fields), ["id", "label", "kind", "format"]);
    });
});
