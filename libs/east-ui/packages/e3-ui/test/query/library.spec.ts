/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Query.Library>` (#1063, #1761): an interface the browser draws — the
 * `QueryLibrary` carrier, holding the rail's chrome over the `rows` source of
 * its `slice`, the data sources read off their bindings, the open query its
 * host gives it and who it tells of another (#1668) — and its surface's
 * manifest, which is the record it pages and each bound source, and nothing of
 * its own (L7); `Query.open`, which builds the open query a host holds; and
 * what it refuses where the page is built: no `slice`, a slice that narrows no
 * record's rows, one with no `rows` source or a source beside it, and a `rows`
 * source that pages another record's rows.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType, East, NullType, OptionType, StringType, equalFor, isTypeEqual, none, variant, type BlockBuilder, type ValueTypeOf,
} from "@elaraai/east";
import { TreePathType } from "@elaraai/e3-types";
import { Slice } from "@elaraai/east-ui";
import { Reactive, RecordSlicesChromeType, UIComponentType } from "@elaraai/east-ui/internal";

import { Data, Query, ui } from "@elaraai/e3-ui";
import { DataSourceType, Query as QueryInternal, QueryLibraryComponent, QueryLibraryPayloadType, QueryOpenType } from "@elaraai/e3-ui/internal";
import * as sheetEx from "../sheet/sheet.examples.js";
import * as ex from "./query.examples.js";

type TreePath = ValueTypeOf<typeof TreePathType>;


const paths = equalFor(ArrayType(TreePathType));

/** A host's `onOpen`: told the query asked for. */
const heard = East.function([Query.Types.Open], NullType, (_$, _next) => null);


/** The indexes the examples' saved queries record declares: what its `rows` source pages through. */
const INDEXES = ["queries_by_source", "queries_by_tag", "queries_by_name", "queries_by_saved_at"] as const;

/** The surface's bindings, as a page writes them. */
function bind($: BlockBuilder<UIComponentType>) {
    const orders = $.let(Data.bindPaged(ex.orders));
    const customers = $.let(Data.bind(ex.customers));
    const rows = $.let(Data.bindPaged(ex.queries, { indexes: [...INDEXES] }));
    const slice = $.let(Slice.bindRecords("spec.library", {
        rows: {
            source: rows, label: "Queries", range: "saved_at", search: ["name", "sources", "tags"],
            fields: { name: { label: "Name" }, sources: { label: "Data source" }, tags: { label: "Tag" }, saved_at: { label: "Saved" } },
        },
    }));
    return { orders, customers, rows, slice };
}

/** The handles a library is handed. */
type Handles = ReturnType<typeof bind>;

/**
 * A page that mounts the library, built — and never run: what the tag takes, and refuses, is decided where the page is
 * built. Its payload is never decoded here: it carries the rail's chrome, whose functions are a binding's, which only a
 * page on e3 runs — what the payload carries is the renderer's tests', on e3-web (`query/library.test.tsx`).
 */
const page = (make: (handles: Handles) => ReturnType<typeof Query.Library>) => () => East.function([], UIComponentType, ($) => make(bind($)));

describe("<Query.Library> (#1063)", () => {
    test("#1761: its payload is the rail's chrome, the data sources, the open query, who to tell and the library's name — and nothing a pane or an edit would need", () => {
        assert.deepEqual(Object.keys(QueryLibraryPayloadType.fields), ["slice", "datasets", "query", "onOpen", "id"]);
        assert.ok(isTypeEqual(QueryLibraryPayloadType.fields.slice, RecordSlicesChromeType), "the rail's chrome, as every builder narrowed over records carries it");
        assert.ok(isTypeEqual(QueryLibraryPayloadType.fields.datasets, ArrayType(DataSourceType)));
        assert.ok(isTypeEqual(QueryLibraryPayloadType.fields.query, OptionType(QueryOpenType)));
    });

    test("#1761: the tag builds over the data sources and a slice whose `rows` source pages the saved queries — bare, and named with the open query", () => {
        assert.doesNotThrow(page(({ orders, customers, slice }) => Query.Library({ datasets: { orders, customers }, slice: { slice }, onOpen: heard })));
        assert.doesNotThrow(page(({ orders, customers, slice }) => Query.Library({
            datasets: { orders, customers }, slice: { slice }, id: "top", query: Query.open.saved("Revenue by region"), onOpen: heard,
        })));
    });

    test("#1761, L4: it is refused without a `slice`, with one that narrows no record's rows, with no `rows` source or a source beside it, and with a `rows` source of another record — each saying the slice to write", () => {
        type Options = Parameters<typeof Query.Library>[0];
        const without = page(({ orders }) => Query.Library({ datasets: { orders }, onOpen: heard } as unknown as Options));
        assert.throws(without, /Query\.Library: needs `slice` — slice=\{\{ slice: Slice\.bindRecords\(key, \{ rows: \{ source: Data\.bindPaged\(queries, \{ indexes: \[\.\.\.\] \}\), … \} \}\) \}\}/);
        // The bare handle, and a slice over values: neither narrows a record's rows.
        const bare = page(({ orders, slice }) => Query.Library({ datasets: { orders }, slice: slice as unknown as Options["slice"], onOpen: heard }));
        assert.throws(bare, /Query\.Library: `slice` takes \{ slice \} over Slice\.bindRecords/);
        const values = page(({ orders }) => Query.Library({
            datasets: { orders }, onOpen: heard,
            slice: { slice: Slice.bind("spec.values", [{ status: "open" }], { fields: { status: {} } }) } as unknown as Options["slice"],
        }));
        assert.throws(values, /Query\.Library: `slice` takes \{ slice \} over Slice\.bindRecords/);
        const unnamed = page(({ orders, rows }) => Query.Library({ datasets: { orders }, onOpen: heard, slice: { slice: Slice.bindRecords("spec.unnamed", { queries: { source: rows } }) } }));
        assert.throws(unnamed, /Query\.Library: `slice` narrows the saved queries — its source 'queries' is none of them; name the sources `rows`/);
        const two = page(({ orders, rows }) => Query.Library({
            datasets: { orders }, onOpen: heard, slice: { slice: Slice.bindRecords("spec.two", { rows: { source: rows }, others: { source: rows } }) },
        }));
        assert.throws(two, /Query\.Library: `slice` narrows the saved queries — its source 'others' is none of them/);
        // A record of another type: the cards are saved queries.
        const other = page(({ orders }) => Query.Library({
            datasets: { orders }, onOpen: heard,
            slice: { slice: Slice.bindRecords("spec.other", { rows: { source: Data.bindPaged(sheetEx.sheetStressJobs, { indexes: ["sheet_stress_by_activity"] }) } }) },
        }));
        assert.throws(other, /Query\.Library: `slice`'s `rows` source pages .*, not saved queries — its source is the saved queries record, of Query\.Types\.Saved/);
    });

    test("#1668: the tag takes the open query as its host gives its builder — a saved query's name, an expression of one, or the open query itself — each read as a builder reads it (`openOf`, which `builder.spec.ts` decodes)", () => {
        const given = (query: NonNullable<Parameters<typeof Query.Library>[0]["query"]>) =>
            page(({ customers, slice }) => Query.Library({ datasets: { customers }, slice: { slice }, query, onOpen: heard }));
        for (const query of ["Revenue by region", East.value("Revenue by region", StringType), Query.open.on("customers"), variant("saved", "Revenue by region")] as const) {
            assert.doesNotThrow(given(query));
        }
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
        const build = (datasets: (h: Handles) => Parameters<typeof Query.Library>[0]["datasets"]) =>
            page((handles) => Query.Library({ datasets: datasets(handles), slice: { slice: handles.slice }, onOpen: heard }));
        assert.throws(build(() => ({})), /Query\.Library: datasets is empty/);
        assert.throws(build(({ orders }) => ({ "open-orders": orders })), /Query\.Library: the data source "open-orders" can't be read as a root field/);
        assert.doesNotThrow(build(({ orders }) => ({ orders })));
    });

    test("L7: its surface's manifest is each bound source and the record it pages — the saved queries and the orders under pages, the customers under paths — and no record bound to write, nor a function", () => {
        const surface = ui("query_library", [], East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
            const { orders, customers, slice } = bind($);
            return Query.Library({ datasets: { orders, customers }, slice: { slice }, onOpen: heard });
        }))));
        const manifest = surface.role.value!;
        // It writes nothing: it binds no record, and pages the saved queries as it pages a dataset.
        assert.deepEqual([manifest.records, manifest.functions], [[], []]);
        const recordPath: TreePath = [variant("field", "records"), variant("field", "queries")];
        assert.ok(paths(manifest.pages, [ex.orders.path, recordPath]), "the paged sources are declared, never loaded whole: the orders, and the saved queries the cards are read from a window at a time");
        assert.ok(paths(manifest.paths, [ex.customers.path]), "the value source alone is loaded whole: the library never reads the record whole");
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
