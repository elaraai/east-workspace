/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's East, compiled for its renderers (#935) — what a save
 * writes, the names of the data sources a saved query reads and its tags as
 * they are kept (#1758), what refused a write under a new name, whether a
 * saved query's data sources are bound here, and the new query on a data
 * source (#1668) are computed by the functions `@elaraai/e3-ui` declares,
 * compiled once, on first use; nothing here restates them.
 *
 * @packageDocumentation
 */

import { East, type TypeOf, type ValueTypeOf } from "@elaraai/east";
import { Query } from "@elaraai/e3-ui/internal";

/** The JavaScript function an East function compiles to. */
type Compiled<F> = ValueTypeOf<TypeOf<F>>;

/** The query builder's compiled East — see the module docs. */
export interface QueryEast {
    /** The patch a save commits: the entries it writes, by name. */
    save: Compiled<typeof Query.save>;
    /** The names of the data sources a saved query reads: what its `sources` holds, from its root. */
    sources: Compiled<typeof Query.sources>;
    /** A saved query's tags as they are kept: each without the spaces around it, and none empty. */
    tags: Compiled<typeof Query.tags>;
    /** What refused a write under a new name, or `none` when it committed. */
    nameWriteRefusal: Compiled<typeof Query.nameWriteRefusal>;
    /** Whether a saved query's data sources are bound here, and if not, why not. */
    rootBound: Compiled<typeof Query.rootBound>;
    /** The new query on a data source: what `Query.open.on` gives, and a builder that holds its own begins with. */
    openOn: Compiled<typeof Query.openOn>;
}

/** Compiles every function the renderers call. */
function compileQuery(): QueryEast {
    return {
        save: East.compile(Query.save, []),
        sources: East.compile(Query.sources, []),
        tags: East.compile(Query.tags, []),
        nameWriteRefusal: East.compile(Query.nameWriteRefusal, []),
        rootBound: East.compile(Query.rootBound, []),
        openOn: East.compile(Query.openOn, []),
    };
}

let compiled: QueryEast | undefined;

/**
 * The query builder's East, compiled on first use.
 *
 * @returns The compiled functions
 */
export function queryEast(): QueryEast {
    compiled ??= compileQuery();
    return compiled;
}
