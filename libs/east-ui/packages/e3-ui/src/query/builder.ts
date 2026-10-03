/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Query.Builder>` (#935) — the query builder as one component: the open
 * query's steps, or its jq, in a pane beside its results, under one toolbar.
 *
 * The builder is an interface — the saved queries record bound with its
 * patch, the data sources it may read, and its name — which the
 * `QueryBuilder` renderer draws. Its only data sources are the bindings it is
 * handed: a query over the page reads exactly those, by the page's names.
 * `<Query.Library>` opens queries in it, shared by `id`.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    OptionType,
    StringType,
    StructType,
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
import { QueriesHandleType, type QueriesHandle } from "./queries.js";

// ============================================================================
// The builder's shared keys
// ============================================================================

/**
 * The names a query builder shares, by its `id`: the UI store key of the
 * query open in it — which the query library writes when it opens a query —
 * the key of this viewer's recent runs, and the drag-source id of the query
 * library's cards.
 *
 * @remarks
 * A builder and a query library with the same `id` open one query together,
 * as Studio's builder and page library open one page (`builderKeys`).
 *
 * @param id - The builder's name, when a surface holds more than one; omitted, the one builder
 * @returns The keys and the id
 */
export function queryKeys(id: string | undefined): {
    /** The open query's UI store key. */
    query: string;
    /** This viewer's recent runs' storage key. */
    recent: string;
    /** The query library's drag-source id — what the builder takes cards from. */
    library: string;
} {
    const suffix = id === undefined ? "" : `.${id}`;
    return {
        query: `query.builder${suffix}.query`,
        recent: `query.builder${suffix}.recent`,
        library: `query.library${suffix}`,
    };
}

// ============================================================================
// The renderer's payload
// ============================================================================

/**
 * The `QueryBuilder` renderer's payload — the builder's interface.
 *
 * @property queries - The saved queries record, bound with its patch — what the builder reads, and saves through
 * @property datasets - The data sources a query may read, by the names it reads them
 * @property query - The saved query the builder opens first, by name; none, a new query on the first data source
 * @property id - Names the builder, when a surface holds two — and the query library that opens queries in it
 */
export const QueryBuilderPayloadType = StructType({
    queries: QueriesHandleType,
    datasets: ArrayType(DataSourceType),
    query: OptionType(StringType),
    id: OptionType(StringType),
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
 * @property queries - The saved queries record, bound with its patch mutation — `Record.bind(queries, [queriesPatch])`
 * @property datasets - The data sources a query may read: each name, as a query reads it, to its binding
 * @property query - The saved query the builder opens first, by name
 * @property id - Names the builder, when a surface holds two — and the query library that opens queries in it
 */
export interface QueryBuilderOptions {
    /** The saved queries record, bound with its patch mutation — `Record.bind(queries, [queriesPatch])`. */
    queries: QueriesHandle;
    /**
     * The data sources a query may read: each name, as a query reads it
     * (`orders` for `.orders`), to its `Data.bind`, `Data.bindPaged` or
     * `Record.bind` handle.
     */
    datasets: Readonly<Record<string, BoundSource>>;
    /**
     * The saved query the builder opens first, by name — and runs, as opening a
     * saved query does. Omitted, the builder opens a new query on the first data
     * source. A query opened later, from the query library or the builder's
     * own tabs, takes its place.
     */
    query?: SubtypeExprOrValue<StringType>;
    /** Names the builder — needed only when one surface holds two builders, and then given to the query library that opens queries in it. */
    id?: string;
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
 * It opens `query`, a saved query, when one is named, else a new query on the
 * first data source. The query open in it is shared by `id` with a
 * `<Query.Library>`, which opens queries in it.
 *
 * @param options - The bound record, the data sources, the query it opens first and the builder's name ({@link QueryBuilderOptions})
 * @returns An East expression of type `UIComponentType`
 * @throws {Error} When `datasets` is empty, or a name is not a jq identifier
 *
 * @example
 * ```tsx
 * import { East } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Query, Record, ui } from "@elaraai/e3-ui";
 *
 * // The builder, for operators: it queries the data sources it is handed, and saves through the record.
 * export const builder = ui("query_builder", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const orders    = $.let(Data.bindPaged(d.orders));
 *         const customers = $.let(Data.bind(d.customers));
 *         const saved     = $.let(Record.bind(d.queries, [d.queriesPatch]));
 *         return <Query.Builder queries={saved} datasets={{ orders, customers }} query="Top shipped orders, 2026" />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createBuilder(options: QueryBuilderOptions): ExprType<UIComponentType> {
    return QueryBuilderComponent.Root({
        queries: { read: options.queries.read, history: options.queries.history, commit: { patch: options.queries.commit.patch } },
        datasets: dataSources("Query.Builder", options.datasets),
        query: options.query === undefined ? none : some(options.query),
        id: options.id === undefined ? none : some(options.id),
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
