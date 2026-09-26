/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paged canvas's KEY SEARCH vocabulary — `search` stops being a row filter
 * and becomes a seek (#567 D9, the affordance table). The search itself is
 * framework-free since #815 (`controller/seek.ts`); what stays here is shared
 * with the Sheet's key search (`sheet/use-seek.ts`).
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

import { StringType, none, parseFor, some, variant, type EastTypeValue, type ValueTypeOf } from "@elaraai/east";
import type { SeekQueryType } from "@elaraai/east-ui";
import type { DatasetKeyMatchRange, DatasetKeyQuery } from "../key-search/index.js";

/** A decoded key query — what a source's `seek` is asked. */
export type SeekQueryValue = ValueTypeOf<SeekQueryType>;

/** What the toolbar needs to mount `<DatasetKeySearch>`. */
export interface PlanSearch {
    /** Keys the control: it changes when the source moves to another revision,
     *  whose rows the control's cached match positions no longer index (#821). */
    resetKey: string;
    /** The key type the control parses typed input against. */
    keyType: EastTypeValue;
    /** Locate a query — resolves when the tracked search lands. */
    find: (query: DatasetKeyQuery) => Promise<DatasetKeyMatchRange>;
    /** Label the popup from the LOADED head of the match run (anchored by the
     *  sought key; empty until the target's windows land). */
    listRange: (row: number, limit: number) => Promise<string[]>;
    /** Jump to match at global element `row`. */
    jump: (row: number) => void;
    /** Drop the query and its jump target. */
    clear: () => void;
}

/** The `.east` literal of a String key is its quoted text; every other query
 *  shape carries its prefix plainly. `undefined` ⇒ nothing to position on.
 *  Shared with the Sheet's key search (`sheet/use-seek.ts`). */
export function soughtKeyOf(query: DatasetKeyQuery): string | undefined {
    if ("prefix" in query) return query.prefix;
    if ("key" in query) {
        const parsed = parseFor(StringType)(query.key);
        return parsed.success ? (parsed.value as string) : query.key;
    }
    return query.prefix;
}

/** The East `SeekQueryType` value for a control query — the inverse of the
 *  runtime's `toFindQuery`, so one vocabulary crosses the whole path, typed by
 *  the East type the source's `seek` declares (#743 item 7).
 *  Shared with the Sheet's key search (`sheet/use-seek.ts`). */
export function toSeekQuery(query: DatasetKeyQuery): SeekQueryValue {
    if ("key" in query) return variant("key", query.key);
    if ("prefix" in query) return variant("prefix", query.prefix);
    return variant("fields", {
        values: [...query.fields],
        prefix: query.prefix !== undefined ? some(query.prefix) : none,
    });
}
