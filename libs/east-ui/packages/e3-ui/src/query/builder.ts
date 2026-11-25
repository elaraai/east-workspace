/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Query.Builder>` (#935) — the query builder as one component: the open
 * query's steps, or its jq, in a pane beside its results, under one toolbar.
 *
 * The builder is an interface — the saved queries record bound with its
 * patch, the data sources it may read, the query it shows, and its name —
 * which the `QueryBuilder` renderer draws. Its only data sources are the
 * bindings it is handed: a query over the page reads exactly those, by the
 * page's names. Its host says which query it shows (`query`) and is told when
 * its own tabs ask for another (`onOpen`): nothing opens a query in it
 * through a store entry shared by `id` (#1668).
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    FunctionType,
    OptionType,
    StringType,
    NullType,
    StructType,
    VariantType,
    none,
    some,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    EastUI,
    optionsTag,
    type JsxTag,
    type OptionsProps,
    type UIComponentType,
} from "@elaraai/east-ui/internal";
import { DataSourceType, dataSources, type BoundSource } from "../bind/sources.js";
import { viewsProp, type ViewsProp } from "../utils/views.js";
import { QueryOpenType, openOf } from "./open.js";
import { QueriesHandleType, type QueriesHandle } from "./queries.js";

// ============================================================================
// The builder's keys
// ============================================================================

/**
 * The names a query builder and a query library keep their own state under,
 * by their `id`: the browser key of this viewer's recent runs, the builder's,
 * and the key of the query library's frame and its cards.
 *
 * @remarks
 * The query open in a builder is not among them: its host gives it as `query`
 * and hears of another in `onOpen` (#1668).
 *
 * @param id - The builder's name, when a surface holds more than one; omitted, the one builder
 * @returns The key and the id
 */
export function queryKeys(id: string | undefined): {
    /** This viewer's recent runs' storage key. */
    recent: string;
    /** The query library's key: its frame's, and its cards' list's. */
    library: string;
} {
    const suffix = id === undefined ? "" : `.${id}`;
    return {
        recent: `query.builder${suffix}.recent`,
        library: `query.library${suffix}`,
    };
}

// ============================================================================
// The renderer's payload
// ============================================================================

/** A view of the open query: its steps in plain words, or its jq. */
export const QueryViewType = VariantType({ visual: NullType, jq: NullType });

/** Type representing {@link QueryViewType}. */
export type QueryViewType = typeof QueryViewType;

/** A view of the result: a Table of its rows, or a tree of its value. */
export const QueryResultViewType = VariantType({ table: NullType, tree: NullType });

/** Type representing {@link QueryResultViewType}. */
export type QueryResultViewType = typeof QueryResultViewType;

/**
 * The `QueryBuilder` renderer's payload — the builder's interface.
 *
 * @property queries - The saved queries record, bound with its patch — what the builder reads, and saves through
 * @property datasets - The data sources a query may read, by the names it reads them
 * @property query - The query it shows; `none`, the builder holds its own open query, a new one on the first data source to begin with
 * @property onOpen - Told when its own tabs open or start another query, with that query
 * @property id - Names the builder, when a surface holds two
 * @property views - The query's views the builder offers; empty, both
 * @property resultViews - The result's views the builder offers; empty, both
 */
export const QueryBuilderPayloadType = StructType({
    queries: QueriesHandleType,
    datasets: ArrayType(DataSourceType),
    query: OptionType(QueryOpenType),
    onOpen: OptionType(FunctionType([QueryOpenType], NullType)),
    id: OptionType(StringType),
    views: ArrayType(QueryViewType),
    resultViews: ArrayType(QueryResultViewType),
});

/** Type representing the `QueryBuilder` renderer's payload. */
export type QueryBuilderPayloadType = typeof QueryBuilderPayloadType;

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const QueryBuilderComponent = EastUI.component("QueryBuilder", QueryBuilderPayloadType, { optional: true });

// ============================================================================
// <Query.Builder>
// ============================================================================

/**
 * `<Query.Builder>` options.
 *
 * @property queries - The saved queries record, bound with its patch mutation — `Record.bind(queries)`
 * @property datasets - The data sources a query may read: each name, as a query reads it, to its binding
 * @property query - The query it shows: a saved query's name, or a `Query.Types.Open`
 * @property onOpen - Told when its own tabs open or start another query, with that query
 * @property id - Names the builder, when a surface holds two
 * @property views - The query's views this builder offers
 * @property resultViews - The result's views this builder offers
 */
export interface QueryBuilderOptions {
    /** The saved queries record, bound with its patch mutation — `Record.bind(queries)`. */
    queries: QueriesHandle;
    /**
     * The data sources a query may read: each name, as a query reads it
     * (`orders` for `.orders`), to its `Data.bind`, `Data.bindPaged` or
     * `Record.bind` handle.
     */
    datasets: Readonly<Record<string, BoundSource>>;
    /**
     * The query it shows: a route's params, or the surface's own state. A
     * name is a saved query (`Query.open.saved(name)`), which the builder
     * runs as it opens; a `Query.Types.Open` may be a new query on a data
     * source too (`Query.open.on(source)`). Given, the builder shows this
     * query until its host changes it, so `onOpen` is given with it. Omitted,
     * the builder holds its own open query — a new one on the first data
     * source to begin with — and its own tabs open another in it.
     */
    query?: SubtypeExprOrValue<StringType | QueryOpenType>;
    /**
     * Told when the builder's own tabs open or start another query — a data
     * source of its Datasets tab, a query of its Library tab, a new query once
     * it is saved — with that query. A
     * host that gives `query` changes it here, to navigate or to write its own
     * state; one that gives none hears of the query the builder opened.
     */
    onOpen?: SubtypeExprOrValue<FunctionType<[QueryOpenType], NullType>>;
    /** Names the builder — needed only when one surface holds two builders: each then keeps its own recent runs. */
    id?: string;
    /**
     * The query's views this builder offers: literal tags (`["visual"]`), `Query.Types.View` values, or an
     * expression of an array of them, which a page's state can choose as it runs. Omitted, or empty as the page
     * runs, both. One left, Visual · jq does not show. A saved query that is not steps opens as jq whatever this
     * says, since it can show no other way.
     */
    views?: ViewsProp<QueryViewType, "visual" | "jq">;
    /**
     * The result's views this builder offers: literal tags (`["table"]`), `Query.Types.ResultView` values, or an
     * expression of an array of them. Omitted, or empty as the page runs, both. One left, Table · Tree does not show.
     */
    resultViews?: ViewsProp<QueryResultViewType, "table" | "tree">;
}

/**
 * The query builder: the open query's steps in plain words, or its jq, checked
 * as they are edited, and run to read the result.
 *
 * @remarks
 * - **The data sources** are the bindings it is handed, by their names: a
 *   query over `datasets={{ orders, customers }}` reads `.orders` and
 *   `.customers`, and nothing else. They are in the surface's manifest
 *   already, so the builder declares nothing of its own. A large dataset bound
 *   with `Data.bindPaged` is never downloaded whole: a query runs on e3.
 * - **The pane**, before the results, has the tabs Query — the steps or the
 *   jq — Datasets and Library.
 * - **Every edit is a draft** of the shared editing session, one per open
 *   query, which the history item in the one toolbar undoes, redoes and
 *   discards; Apply saves the open query as one patch commit on the record. A
 *   query saves only once it checks.
 *
 * The builder fills its parent's height and draws no border around itself.
 * It shows `query` when one is given, else a new query on the first data
 * source. Its host says which query it shows and is told when its own tabs
 * ask for another, so a `<Query.Library>` opens a query in it through the
 * host: the library's `onOpen` and the builder's `query` are the host's to
 * join — across its pages, since the library is a surface of its own.
 *
 * @param options - The bound record, the data sources, the query it shows, who to tell and the builder's name ({@link QueryBuilderOptions})
 * @returns An East expression of type `UIComponentType`
 * @throws {Error} When `datasets` is empty, or a name is not a jq identifier; or when `query` is given without `onOpen`: its own tabs could open nothing
 *
 * @example
 * ```tsx
 * import { East, NullType } from "@elaraai/east";
 * import { Reactive, State, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Query, Record, ui } from "@elaraai/e3-ui";
 *
 * // The builder, for operators: it queries the data sources it is handed, and saves through the record.
 * // The surface holds the open query, which a query library — a surface of its own — asks it to change.
 * export const builder = ui("query_builder", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const orders    = $.let(Data.bindPaged(d.orders));
 *         const customers = $.let(Data.bind(d.customers));
 *         const saved     = $.let(Record.bind(d.queries));
 *         const open      = $.let(State.bind([Query.Types.Open], "queries.open", Query.open.saved("Top shipped orders, 2026")));
 *         const go        = $.const(East.function([Query.Types.Open], NullType, ($2, next) => { $2(open.write(next)); }));
 *         return <Query.Builder queries={saved} datasets={{ orders, customers }} query={open.read()} onOpen={go} />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createBuilder(options: QueryBuilderOptions): ExprType<UIComponentType> {
    if (options.query !== undefined && options.onOpen === undefined) {
        throw new Error("Query.Builder: `query` is given, so its host holds the open query — give `onOpen` too, which is told the query its Datasets and Library tabs ask for; or omit `query`, and the builder holds its own");
    }
    return QueryBuilderComponent.Root({
        queries: { read: options.queries.read, history: options.queries.history, commit: { patch: options.queries.commit.patch } },
        datasets: dataSources("Query.Builder", options.datasets),
        query: options.query === undefined ? none : some(openOf(options.query)),
        onOpen: options.onOpen === undefined ? none : some(options.onOpen),
        id: options.id === undefined ? none : some(options.id),
        views: viewsProp("Query.Builder", QueryViewType, options.views) as never,
        resultViews: viewsProp("Query.Builder", QueryResultViewType, options.resultViews) as never,
    });
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Query.Builder>` — the query builder: the open query's steps or its jq,
 * checked as they are edited, beside its results. See {@link createBuilder}.
 */
export const QueryBuilder: JsxTag<OptionsProps<typeof createBuilder>> = optionsTag(createBuilder);
