/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query open in a builder (#1668) — a value its host holds: a route's
 * params, or the surface's own state. A `<Query.Builder>` shows the one it is
 * given as `query`, and it and a `<Query.Library>` tell the host which is
 * asked for next in `onOpen`.
 *
 * @packageDocumentation
 */

import {
    East,
    Expr,
    OptionType,
    StringType,
    StructType,
    VariantType,
    none,
    variant,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { SavedQueryType } from "./types.js";

/**
 * The query open in a builder.
 *
 * @property new - A query not yet saved: `id` tells it from every other new
 *   query, so each keeps its own drafts; `source` is the data source it starts
 *   from; `from`, when it begins as a run of this viewer's that was never
 *   saved, is that run — its name, its description and its checked query
 * @property saved - A saved query, by its name
 */
export const QueryOpenType = VariantType({
    new: StructType({ id: StringType, source: StringType, from: OptionType(SavedQueryType) }),
    saved: StringType,
});

/** Type representing the query open in a builder. */
export type QueryOpenType = typeof QueryOpenType;

/**
 * A saved query, as the query open in a builder.
 *
 * @param name - The saved query's name
 * @returns The open query: `saved(name)`
 *
 * @example
 * ```tsx
 * const open = $.let(State.bind([Query.Types.Open], "queries.open", Query.open.saved("Top shipped orders, 2026")));
 * ```
 */
function openSaved(name: SubtypeExprOrValue<StringType>): ExprType<QueryOpenType> {
    return East.value(variant("saved", name), QueryOpenType);
}

/**
 * The new query on a data source: one a data source, its `id` made from the
 * source's name — `on:orders` — so it is the same query each time, the drafts
 * made in it are found again, and it is no other new query: neither one a
 * page started itself, nor the one on a data source of another name.
 *
 * @remarks
 * `Query.open.on(source)` is this, and so is the query a builder that holds
 * its own open query begins with, on its first data source — its renderer
 * compiles this — so the two are one query.
 */
export const openOnSource = East.function([StringType], QueryOpenType, (_$, source) => East.value(variant("new", {
    id: East.str`on:${source}`,
    source,
    from: none,
}), QueryOpenType));

/**
 * A new query on a data source, as the query open in a builder. It is the
 * same new query each time for one data source, so the drafts made in it are
 * found again ({@link openOnSource}).
 *
 * @param source - The data source's name, as a query reads it (`orders` for `.orders`)
 * @returns The open query: a new one on the data source
 *
 * @example
 * ```tsx
 * // The surface holds the open query: a new one on customers to begin with.
 * const open = $.let(State.bind([Query.Types.Open], "queries.open", Query.open.on("customers")));
 * const go   = $.const(East.function([Query.Types.Open], NullType, ($2, next) => { $2(open.write(next)); }));
 * return <Query.Builder queries={saved} datasets={{ orders, customers }} query={open.read()} onOpen={go} />;
 * ```
 */
function openOn(source: SubtypeExprOrValue<StringType>): ExprType<QueryOpenType> {
    return openOnSource(source);
}

/**
 * The query a host gives a builder or a query library, as the open query it
 * is: a name — text, or an expression of it — is the saved query of that
 * name; anything else is the open query as given.
 *
 * @param query - A saved query's name, or the open query
 * @returns The open query
 */
export function openOf(query: SubtypeExprOrValue<StringType | QueryOpenType>): ExprType<QueryOpenType> {
    if (typeof query === "string") return openSaved(query);
    if (query instanceof Expr) {
        return (Expr.type(query as unknown as Expr) as EastType).type === "String"
            ? openSaved(query as unknown as ExprType<StringType>)
            : query as unknown as ExprType<QueryOpenType>;
    }
    return East.value(query, QueryOpenType);
}

/**
 * Builds the query open in a builder: a saved query by its name
 * ({@link openSaved}), or a new query on a data source ({@link openOn}).
 */
export const queryOpen: {
    /** A saved query, by its name. */
    saved: typeof openSaved;
    /** A new query on a data source. */
    on: typeof openOn;
} = { saved: openSaved, on: openOn };
