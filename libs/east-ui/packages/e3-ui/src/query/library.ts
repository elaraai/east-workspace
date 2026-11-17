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
 * a query may read, the query open in the builder, and who to tell when
 * another is asked for — which
 * the `QueryLibrary` renderer draws, headerless with one toolbar: the search,
 * Sort, Grid · List and the primary "+ New query on <data source>"; beside it
 * the data sources with their counts of saved queries, and this viewer's
 * recent runs; under it the saved queries, each card a wireframe of its steps.
 * It reads no dataset: a card draws a query, never its data.
 *
 * "Open in builder →" tells the host (`onOpen`), which shows the query in its
 * builder: the query library opens nothing itself, and shares no store entry
 * with a builder (#1668).
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
import { QueryOpenType } from "./open.js";
import { QueriesHandleType, type QueriesHandle } from "./queries.js";

// ============================================================================
// Types
// ============================================================================

/**
 * The `QueryLibrary` renderer's payload — the query library's interface.
 *
 * @property queries - The saved queries record, bound with its patch — what it reads
 * @property datasets - The data sources a query may read, by the names it reads them
 * @property query - The query open in the builder, whose card is marked; `none`, no card is marked
 * @property onOpen - Told when a query is asked for, with that query — the host shows it in its builder
 * @property id - Names the builder that takes its cards and shares its recent runs; `none` for the one builder
 */
export const QueryLibraryPayloadType = StructType({
    queries: QueriesHandleType,
    datasets: ArrayType(DataSourceType),
    query: OptionType(QueryOpenType),
    onOpen: FunctionType([QueryOpenType], NullType),
    id: OptionType(StringType),
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
 * @property queries - The saved queries record, bound with its patch mutation — `Record.bind(queries)`
 * @property datasets - The data sources a query may read: each name, as a query reads it, to its binding
 * @property query - The query open in the builder, whose card is marked
 * @property onOpen - Told when a query is asked for, with that query — the host shows it in its builder
 * @property id - Names the builder that takes its cards and shares its recent runs, when a surface holds two
 */
export interface QueryLibraryOptions {
    /** The saved queries record, bound with its patch mutation — `Record.bind(queries)`. */
    queries: QueriesHandle;
    /**
     * The data sources a query may read: each name, as a query reads it
     * (`orders` for `.orders`), to its `Data.bind`, `Data.bindPaged` or
     * `Record.bind` handle — the builder's own, so a query opens where its data
     * sources are bound.
     */
    datasets: Readonly<Record<string, BoundSource>>;
    /** The query open in the builder, whose card is marked — the value the host gives its builder's `query`. Omitted, no card is marked. */
    query?: SubtypeExprOrValue<QueryOpenType>;
    /**
     * Told when a card or "+ New query on …" is pressed, with the query asked
     * for: a saved query as itself, a recent run of one as the saved query, a
     * run never saved as a new query begun as it, and a new query on the data
     * source shown. The host shows it in its builder: it navigates, or writes
     * the state its builder's `query` reads. The query library opens nothing
     * itself.
     */
    onOpen: SubtypeExprOrValue<FunctionType<[QueryOpenType], NullType>>;
    /** Names the builder that takes its cards and shares its recent runs — needed only when one surface holds two builders. */
    id?: string;
}

/**
 * Every saved query, and where new queries start.
 *
 * @remarks
 * - **The toolbar**, one row: the search "Search N queries…", over names,
 *   descriptions and data sources; Sort · Recent or Name; Grid · List; and
 *   "+ New query on <data source>" — the data source the pane shows, else the
 *   first bound — which asks the host for a new query on it.
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
 * library's own; the open query is the host's, which gives it to the query
 * library and to its `<Query.Builder>` as `query` and changes it in `onOpen`.
 * The query library reads no dataset, and draws no border
 * around itself. Its data sources are the surface's bindings, which the host
 * loads with the surface as it loads any: bind a large one with
 * `Data.bindPaged`, which is declared and never loaded whole.
 *
 * @param options - The bound record, the data sources, the open query, who to tell and the builder's name ({@link QueryLibraryOptions})
 * @returns An East expression of type `UIComponentType`
 * @throws {Error} When `datasets` is empty, or a name is not a jq identifier
 *
 * @example
 * ```tsx
 * import { East, NullType } from "@elaraai/east";
 * import { Reactive, State, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Query, Record, ui } from "@elaraai/e3-ui";
 *
 * // The query library: every saved query, and where new queries start — over the builder's data sources.
 * // The surface holds the open query, which its builder shows.
 * export const library = ui("query_library", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const orders    = $.let(Data.bindPaged(d.orders));
 *         const customers = $.let(Data.bind(d.customers));
 *         const saved     = $.let(Record.bind(d.queries));
 *         const open      = $.let(State.bind([Query.Types.Open], "queries.open", Query.open.saved("Top shipped orders, 2026")));
 *         const go        = $.const(East.function([Query.Types.Open], NullType, ($2, next) => { $2(open.write(next)); }));
 *         return <Query.Library queries={saved} datasets={{ orders, customers }} query={open.read()} onOpen={go} />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createLibrary(options: QueryLibraryOptions): ExprType<UIComponentType> {
    return QueryLibraryComponent.Root({
        queries: { read: options.queries.read, history: options.queries.history, commit: { patch: options.queries.commit.patch } },
        datasets: dataSources("Query.Library", options.datasets),
        query: options.query === undefined ? none : some(options.query),
        onOpen: options.onOpen,
        id: options.id === undefined ? none : some(options.id),
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
