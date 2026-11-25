/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Query.Library>` (#1063, #1761) — every saved query as a card, in a grid
 * its rail narrows, and where new queries start.
 *
 * The query library is an interface: the rail's chrome over the `rows` source
 * of its `slice` — the saved queries, paged through the record's indexes — the
 * data sources a query may read, the query open in the builder, and who to
 * tell when another is asked for. The `QueryLibrary` renderer draws it in a
 * `BuilderFrame`: one toolbar holding the rail and New query, over the cards.
 * It has no pane: a card says what its query is, and a query is edited — its
 * tags too — in the builder.
 *
 * Its cards are read a window at a time through the record's indexes, and the
 * rail narrows them: the library reads no dataset, and never the record whole.
 * A card, and New query, tell the host (`onOpen`), which shows the query in
 * its builder: the query library opens nothing itself, writes nothing, and
 * shares no store entry with a builder (#1668).
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
    RecordSlicesChromeType,
    optionsTag,
    type JsxTag,
    type OptionsProps,
    type RecordSlicesChromeOptions,
    type UIComponentType,
} from "@elaraai/east-ui/internal";
import { DataSourceType, dataSources, type BoundSource } from "../bind/sources.js";
import { libraryRows, librarySlice } from "../utils/record-sources.js";
import { QueryOpenType, openOf } from "./open.js";
import { SavedQueryType } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * The `QueryLibrary` renderer's payload — the query library's interface.
 *
 * @property slice - The rail's chrome: the narrowing of the saved queries, whose `rows` source the renderer pages its cards through
 * @property datasets - The data sources a query may read, by the names it reads them
 * @property query - The query open in the builder, whose card is marked; `none`, no card is marked
 * @property onOpen - Told when a query is asked for, with that query — the host shows it in its builder
 * @property id - Keeps the library's frame apart from another's on its surface; `none` for the one library
 */
export const QueryLibraryPayloadType = StructType({
    slice: RecordSlicesChromeType,
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
 * @property datasets - The data sources a query may read: each name, as a query reads it, to its binding
 * @property slice - The narrowing: `{ slice: Slice.bindRecords(key, { rows: { source: Data.bindPaged(queries, { indexes }), … } }) }`
 * @property query - The query open in the builder, whose card is marked: a saved query's name, or a `Query.Types.Open`
 * @property onOpen - Told when a query is asked for, with that query — the host shows it in its builder
 * @property id - Keeps the library's frame apart from another's, when a surface holds two
 */
export interface QueryLibraryOptions {
    /**
     * The data sources a query may read: each name, as a query reads it
     * (`orders` for `.orders`), to its `Data.bind`, `Data.bindPaged` or
     * `Record.bind` handle — the builder's own, so a query opens where its data
     * sources are bound.
     */
    datasets: Readonly<Record<string, BoundSource>>;
    /**
     * The narrowing, and where the cards come from: `slice={{ slice }}` over
     * `Slice.bindRecords(key, { rows: { source: Data.bindPaged(queries, {
     * indexes: [...] }), … } })`. Its `rows` source is the saved queries, paged
     * from their record through its indexes, and its rail — one, in the
     * toolbar — narrows them: by data source, by tag, by when a query was
     * saved, and by the start of a name. It has that one source. `Slice.bind`
     * and `Slice.bindRecord` are refused.
     */
    slice: RecordSlicesChromeOptions;
    /**
     * The query open in the builder, whose card is marked — the value the
     * host gives its builder's `query`, in either form the builder takes it: a
     * saved query's name, or a `Query.Types.Open`. Omitted, no card is marked.
     */
    query?: SubtypeExprOrValue<StringType | QueryOpenType>;
    /**
     * Told when a card or New query is pressed, with the query asked for: a
     * saved query as itself, or a new query on a data source. The host shows it
     * in its builder: it navigates, or writes the state its builder's `query`
     * reads. The query library opens nothing itself.
     */
    onOpen: SubtypeExprOrValue<FunctionType<[QueryOpenType], NullType>>;
    /** Keeps the library's frame apart from another's — needed only when one surface holds two. */
    id?: string;
}

/** How a refusal writes the slice a query library takes. */
const SLICE_CALL = "slice={{ slice: Slice.bindRecords(key, { rows: { source: Data.bindPaged(queries, { indexes: [...] }), … } }) }}";

/**
 * Every saved query, as a card in a grid, and where new queries start.
 *
 * @remarks
 * - **The toolbar**, one row: the rail — the fields its `rows` source lists,
 *   its range and its search, its presets and `N of M queries` — then New
 *   query, which follows the rail: with one data source chosen it reads "New
 *   query on orders" and starts on it; with none or several it opens a menu
 *   of the bound data sources.
 * - **The cards**, a grid as many across as fit: a card a saved query, read a
 *   window at a time in the order e3 returns them — a wireframe of its query,
 *   its source and a bar a step; its name; its description (the author's,
 *   else the sentence generated from its steps); its tags; and what it reads
 *   and gives and when it was saved. A press on a card asks the host for its
 *   query. A query whose data sources aren't bound here says why on its card,
 *   and doesn't open. The query the host says is open is marked.
 *
 * The open query is the host's, which gives it to the query library and to its
 * `<Query.Builder>` as `query` and changes it in `onOpen`. The two are surfaces
 * of their own — a `ui()` each: the library pages the saved queries, and a
 * surface that pages a record never loads it whole, which the builder does.
 * The query library reads no dataset, writes nothing, and draws no border
 * around itself. Its data sources are the surface's bindings: bind a large one
 * with `Data.bindPaged`, which is declared and never loaded whole.
 *
 * @param options - The data sources, the slice, the open query, who to tell and the library's name ({@link QueryLibraryOptions})
 * @returns An East expression of type `UIComponentType`
 * @throws {Error} When `datasets` is empty, or a name is not a jq identifier; and when `slice` is left out, is not `{ slice: Slice.bindRecords(…) }`, has no `rows` source or a source beside it, or its `rows` source does not page saved queries
 *
 * @example
 * ```tsx
 * import { East, NullType } from "@elaraai/east";
 * import { Reactive, Slice, State, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Query, ui } from "@elaraai/e3-ui";
 *
 * // The query library: every saved query as a card, narrowed by its rail, over the builder's data sources.
 * // The surface holds the open query, which its builder — a surface of its own — shows.
 * export const library = ui("query_library", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const orders    = $.let(Data.bindPaged(d.orders));
 *         const customers = $.let(Data.bind(d.customers));
 *         const rows      = $.let(Data.bindPaged(d.queries, { indexes: ["queries_by_source", "queries_by_tag", "queries_by_name", "queries_by_saved_at"] }));
 *         const slice     = $.let(Slice.bindRecords("analysis.library", {
 *             rows: {
 *                 source: rows, label: "Queries", range: "saved_at", search: ["name", "sources", "tags"],
 *                 fields: { name: { label: "Name" }, sources: { label: "Data source" }, tags: { label: "Tag" }, saved_at: { label: "Saved" } },
 *             },
 *         }));
 *         const open      = $.let(State.bind([Query.Types.Open], "queries.open", Query.open.saved("Top shipped orders, 2026")));
 *         const go        = $.const(East.function([Query.Types.Open], NullType, ($2, next) => { $2(open.write(next)); }));
 *         return <Query.Library datasets={{ orders, customers }} slice={{ slice }} query={open.read()} onOpen={go} />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createLibrary(options: QueryLibraryOptions): ExprType<UIComponentType> {
    // The slice has the one source, the saved queries': a source beside it is refused, naming it.
    const { slice, chrome } = librarySlice(options.slice as RecordSlicesChromeOptions | undefined, {
        builder: "Query.Library", names: ["rows"], what: "the saved queries", call: SLICE_CALL, cards: "the saved queries",
    });
    libraryRows(slice, "rows", {
        builder: "Query.Library", call: SLICE_CALL, row: SavedQueryType, rows: "saved queries", record: "the saved queries record, of Query.Types.Saved",
    });
    return QueryLibraryComponent.Root({
        slice: chrome,
        datasets: dataSources("Query.Library", options.datasets),
        query: options.query === undefined ? none : some(openOf(options.query)),
        onOpen: options.onOpen,
        id: options.id === undefined ? none : some(options.id),
    });
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Query.Library>` — every saved query, as a card in a grid, and where new
 * queries start. See {@link createLibrary}.
 */
export const QueryLibrary: JsxTag<OptionsProps<typeof createLibrary>> = optionsTag(createLibrary);
