/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paged canvas's KEY SEARCH vocabulary — `search` stops being a row filter
 * and becomes a seek (#567 D9, the affordance table). The search itself is
 * framework-free since #815 (`controller/seek.ts`); a query's East value is the
 * key search's (`toSeekQuery`, east-ui-components), shared with the Sheet.
 *
 * # Why a key search can address canvas rows at all
 *
 * `seek` answers in SOURCE ELEMENT indices, and a Plan synthesizes its rows per
 * element (a series can emit several rows for one element, or none), so an
 * element index is not a canvas row index and never will be. What makes the
 * jump well-defined is #822: a row's id starts with the key of the element it
 * came from, the source's windows land in its key order, and each series
 * places its rows in element order. So a query's matches — one CONTIGUOUS run
 * in the source's key order — begin at the first canvas row whose element
 * sorts at-or-after the sought key, and THAT row is addressable in key space
 * alone.
 *
 * The k-th match is NOT the k-th row of that run: a series emits any number of
 * canvas rows per source element, so the element delta the control steps by is
 * not a row delta (#582). A jump LOADS to the target element and the canvas
 * holds the first match.
 *
 * @packageDocumentation
 */

import { StringType, parseFor, type EastTypeValue } from "@elaraai/east";
import type { DatasetKeyMatchRange, DatasetKeyQuery } from "@elaraai/east-ui-components";

/** What the toolbar needs to mount `<DatasetKeySearch>`. */
export interface PlanSearch {
    /** Keys the control: it changes with the source itself — another
     *  collection, which a query typed for this one was never asked of. */
    resetKey: string;
    /** Moves when the source's data moved to another snapshot while a query
     *  stands (#821, #1199): the control asks the query it holds again there,
     *  its text kept. Windows read again over the same data move nothing. */
    requery: number;
    /** The key type the control parses typed input against. */
    keyType: EastTypeValue;
    /** Locate a query — resolves when the tracked search lands. `again`, the
     *  query the control holds asked again at a new snapshot: the view stays
     *  where it is. */
    find: (query: DatasetKeyQuery, again?: boolean) => Promise<DatasetKeyMatchRange>;
    /** Label the popup from the LOADED head of the match run (anchored by the
     *  sought key; empty until the target's windows land). */
    listRange: (row: number, limit: number) => Promise<string[]>;
    /** Jump to match at global element `row`. */
    jump: (row: number) => void;
    /** Drop the query and its jump target. */
    clear: () => void;
}

/** The key a query's run starts at, which the canvas anchors on. The `.east`
 *  literal of a String key is its quoted text; a prefix is carried plainly; a
 *  range starts at its lower bound, or at the first row when it is open
 *  below. `undefined` ⇒ nothing to position on. */
export function soughtKeyOf(query: DatasetKeyQuery): string | undefined {
    if ("prefix" in query) return query.prefix;
    if ("key" in query) {
        const parsed = parseFor(StringType)(query.key);
        return parsed.success ? (parsed.value as string) : query.key;
    }
    if ("from" in query || "to" in query) {
        const from = query.from?.[0];
        if (from === undefined) return "";
        const parsed = parseFor(StringType)(from);
        return parsed.success ? (parsed.value as string) : from;
    }
    return query.prefix;
}
