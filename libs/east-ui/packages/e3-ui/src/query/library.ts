/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Query.Library>` (#1063) — every saved query, and where new queries start,
 * set out as Studio's page library is.
 *
 * The query library is a component of its own, apart from the builder: an
 * interface — the saved queries record bound with its patch, the data sources
 * a query may read, the builder it opens queries in, and who to tell — which
 * the `QueryLibrary` renderer draws, headerless with one toolbar: the search,
 * Sort, Grid · List and the primary "+ New query on <data source>"; beside it
 * the data sources with their counts of saved queries, and this viewer's
 * recent runs; under it the saved queries, each card a wireframe of its steps.
 * It reads no dataset: a card draws a query, never its data.
 *
 * "Open in builder →" opens a query in the builder: it writes the builder's
 * open query ({@link queryKeys}) and tells the host.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    FunctionType,
    NullType,
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
// Types
// ============================================================================

/**
 * The `QueryLibrary` renderer's payload — the query library's interface.
 *
 * @property queries - The saved queries record, bound with its patch — what it reads
 * @property datasets - The data sources a query may read, by the names it reads them
 * @property id - Names the builder whose open query it writes; `none` for the one builder
 * @property onOpen - Told a query's name when it opens one in the builder — the host shows the builder
 */
export const QueryLibraryPayloadType = StructType({
    queries: QueriesHandleType,
    datasets: ArrayType(DataSourceType),
    id: OptionType(StringType),
    onOpen: OptionType(FunctionType([StringType], NullType)),
});

/** Type representing the `QueryLibrary` renderer's payload. */
export type QueryLibraryPayloadType = typeof QueryLibraryPayloadType;

// ============================================================================
// The renderer's carrier
// ============================================================================

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const QueryLibraryComponent = EastUI.component("QueryLibrary", QueryLibraryPayloadType, { optional: true });

// ============================================================================
// <Query.Library>
// ============================================================================

/**
 * `<Query.Library>` options.
 *
 * @property queries - The saved queries record, bound with its patch mutation — `Record.bind(queries, [queriesPatch])`
 * @property datasets - The data sources a query may read: each name, as a query reads it, to its binding
 * @property id - Names the builder whose open query it writes, when a surface holds two
 * @property onOpen - Told a query's name when it opens one in the builder — the host shows the builder
 */
export interface QueryLibraryOptions {
    /** The saved queries record, bound with its patch mutation — `Record.bind(queries, [queriesPatch])`. */
    queries: QueriesHandle;
    /**
     * The data sources a query may read: each name, as a query reads it
     * (`orders` for `.orders`), to its `Data.bind`, `Data.bindPaged` or
     * `Record.bind` handle — the builder's own, so a query opens where its data
     * sources are bound.
     */
    datasets: Readonly<Record<string, BoundSource>>;
    /** Names the builder whose open query it writes — needed only when one surface holds two builders. */
    id?: string;
    /** Told a query's name when it opens one in the builder — the host shows the builder. */
    onOpen?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
}

/**
 * Every saved query, and where new queries start.
 *
 * @remarks
 * - **The toolbar**, one row: the search "Search N queries…", over names,
 *   descriptions and data sources; Sort · Recent or Name; Grid · List; and
 *   "+ New query on <data source>" — the data source the pane shows, else the
 *   first bound — which opens a new query on it in the builder.
 * - **The pane**: All queries, then each bound data source with its count of
 *   the saved queries that start from it, the one shown in the brand; and, at
 *   its foot, Recent — this viewer's runs.
 * - **The gallery**: three across, or a row each, every card a wireframe of
 *   the query — its source and a bar per step — with its name, its
 *   description (the author's, else the sentence generated from its steps),
 *   what it starts from and gives, and "Open in builder →". A card drags onto
 *   the builder that shares `id`. A query whose data sources aren't bound
 *   here says why, and doesn't open.
 *
 * The data source shown, the search, the order and the layout are the query
 * library's own; the query it opens is the builder's, shared by `id` with a
 * `<Query.Builder>`. The query library reads no dataset, and draws no border
 * around itself. Its data sources are the surface's bindings, which the host
 * loads with the surface as it loads any: bind a large one with
 * `Data.bindPaged`, which is declared and never loaded whole.
 *
 * @param options - The bound record, the data sources, the builder's name and who to tell ({@link QueryLibraryOptions})
 * @returns An East expression of type `UIComponentType`
 * @throws {Error} When `datasets` is empty, or a name is not a jq identifier
 *
 * @example
 * ```tsx
 * import { East } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Query, Record, ui } from "@elaraai/e3-ui";
 *
 * // The query library: every saved query, and where new queries start — over the builder's data sources.
 * export const library = ui("query_library", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const orders    = $.let(Data.bindPaged(d.orders));
 *         const customers = $.let(Data.bind(d.customers));
 *         const saved     = $.let(Record.bind(d.queries, [d.queriesPatch]));
 *         return <Query.Library queries={saved} datasets={{ orders, customers }} />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createLibrary(options: QueryLibraryOptions): ExprType<UIComponentType> {
    return QueryLibraryComponent.Root({
        queries: { read: options.queries.read, history: options.queries.history, commit: { patch: options.queries.commit.patch } },
        datasets: dataSources("Query.Library", options.datasets),
        id: options.id === undefined ? none : some(options.id),
        onOpen: options.onOpen === undefined ? none : some(options.onOpen),
    });
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Query.Library>` — every saved query, and where new queries start. See
 * {@link createLibrary}.
 */
export const QueryLibrary: JsxTag<OptionsProps<typeof createLibrary>> = optionsTag(createLibrary);
