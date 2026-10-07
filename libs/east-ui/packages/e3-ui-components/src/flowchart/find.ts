/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Find state (#1245, `Flowchart Builder Spec.md` §7.1): the toolbar's search
 * over the open flow's states, by key and by label — the shared key search's
 * item (`useKeySearchToolbarItem`), its box folding to its icon, over a
 * source of the flowchart's own. A pick selects the state on the canvas and
 * scrolls it into view.
 *
 * The shared search asks its source for a run of rows, labels a window of
 * them for its list and jumps to one; here the rows are the states a query
 * finds, in East's order of their keys. Bare text finds a state whose key
 * starts with it or whose label holds it, either in any case; a quoted key
 * (`"CH*"`) finds the state of that key; a range (`ARV..LDD`) the keys in it.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { StringType, compareFor, equalFor, parseFor, toEastTypeValue, type EastTypeValue } from "@elaraai/east";
import { keyRangePredicates, type DatasetKeyMatchRange, type DatasetKeyQuery, type KeySearchSource } from "@elaraai/east-ui-components";

/** A state's key is a String: the search's text parses against that. */
const KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);

const keyOrder = compareFor(StringType);
const keyEqual = equalFor(StringType);
const readKey = parseFor(StringType);

/** One state, as find state lists it: its key and its label. */
export interface FindableState {
    /** Its key: its identity in the flow. */
    readonly key: string;
    /** The name under its key, when it has one. */
    readonly label: string | undefined;
}

/**
 * The states a query finds, in East's order of their keys (see the module
 * docs).
 *
 * @param states - The open flow's states
 * @param query - The query the search's box parsed
 * @returns The states found, in key order
 */
export function findStates(states: readonly FindableState[], query: DatasetKeyQuery): FindableState[] {
    const byKey = [...states].sort((a, b) => keyOrder(a.key, b.key));
    if ("key" in query) {
        const read = readKey(query.key);
        return read.success ? byKey.filter((s) => keyEqual(s.key, read.value)) : [];
    }
    if ("prefix" in query && !("fields" in query)) {
        const text = query.prefix.toLowerCase();
        return byKey.filter((s) => s.key.toLowerCase().startsWith(text) || (s.label?.toLowerCase().includes(text) ?? false));
    }
    const range = keyRangePredicates(KEY_TYPE, query);
    return range === null ? [] : byKey.filter((s) => range.lower(s.key) && !range.upper(s.key));
}

/**
 * How a state reads in find state's list: its key, and its label after it.
 *
 * @param state - The state
 * @returns Its line
 */
export function stateLine(state: FindableState): string {
    return state.label === undefined ? state.key : `${state.key} · ${state.label}`;
}

/**
 * Find state's source, for the shared key search's toolbar item.
 *
 * @param states - The open flow's states; none, and there is no search
 * @param resetKey - The open flow's identity: another flow's opening starts the box again, empty
 * @param onPick - Told the key of the state a pick lands on
 * @returns The source, or `undefined` over a flow with no state
 */
export function useFindState(states: readonly FindableState[], resetKey: string, onPick: (key: string) => void): KeySearchSource | undefined {
    // What the last find found, by row: the box asks for the rows' lines, and
    // jumps to one, with what it captured before the find answered.
    const found = useRef<readonly FindableState[]>([]);
    // What a find reads, and whom a pick tells: the latest.
    const latest = useRef({ states, onPick });
    useLayoutEffect(() => { latest.current = { states, onPick }; });
    const find = useCallback(async (query: DatasetKeyQuery): Promise<DatasetKeyMatchRange> => {
        const matches = findStates(latest.current.states, query);
        found.current = matches;
        return { found: matches.length > 0, row: 0, count: matches.length };
    }, []);
    const listRange = useCallback(async (row: number, limit: number): Promise<string[]> => found.current.slice(row, row + limit).map(stateLine), []);
    const jump = useCallback((row: number) => {
        const state = found.current[row];
        if (state !== undefined) latest.current.onPick(state.key);
    }, []);
    const clear = useCallback(() => { found.current = []; }, []);
    const any = states.length > 0;
    return useMemo(() => (any ? { resetKey, keyType: KEY_TYPE, find, listRange, jump, clear } : undefined),
        [any, resetKey, find, listRange, jump, clear]);
}
