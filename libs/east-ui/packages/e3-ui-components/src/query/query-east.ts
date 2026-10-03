/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The query builder's East, compiled for its renderers (#935) — what a save
 * writes, what refused a write under a new name, and whether a saved query's
 * data sources are bound here are computed by the functions `@elaraai/e3-ui`
 * declares, compiled once, on first use; nothing here restates them.
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
    /** What refused a write under a new name, or `none` when it committed. */
    nameWriteRefusal: Compiled<typeof Query.nameWriteRefusal>;
    /** Whether a saved query's data sources are bound here, and if not, why not. */
    rootBound: Compiled<typeof Query.rootBound>;
}

/** Compiles every function the renderers call. */
function compileQuery(): QueryEast {
    return {
        save: East.compile(Query.save, []),
        nameWriteRefusal: East.compile(Query.nameWriteRefusal, []),
        rootBound: East.compile(Query.rootBound, []),
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
