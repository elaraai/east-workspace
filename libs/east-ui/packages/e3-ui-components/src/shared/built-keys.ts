/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A row stands under the key its row builds (`key`, east-workspace#1709): the
 * one rule every builder that records a gesture's entries follows where the
 * app builds a row's key from the row — the Sheet's and the Record's rows, and
 * every kind and record the shared Schedule editing writes — as
 * `given-keys.ts` is the one rule for the app's `newKey`.
 *
 * Each entry a gesture makes stands under the key its row builds, in place of
 * the key it was made under; each it changes moves under the key its row then
 * builds, where what its key reads changed, to another than the one it stands
 * under — a row an app stored apart from its key, edited back to build it,
 * stays (#1581). Each leaves its key before any arrives, so a row may take the
 * key another leaves in the same gesture. A key another row stands under, and
 * one that fails as it is built, refuse the whole gesture.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, none } from "@elaraai/east";
import type { EntryVersion } from "@elaraai/east-ui-components";

const stringEqual = equalFor(StringType);

/**
 * An entry a gesture touches: as the gesture found it, and as it leaves it.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface TouchedEntry<W> {
    /** Its version before the gesture. */
    readonly before: EntryVersion<W>;
    /** Its version after it. */
    readonly after: EntryVersion<W>;
}

/**
 * How a collection builds its rows' keys, and what stands under one.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface BuiltKeyRule<W> {
    /**
     * Whether a version holds a row.
     *
     * @param version - The version
     */
    readonly holds: (version: EntryVersion<W>) => boolean;
    /**
     * The key a version's row builds, as its text: asked only of a version that holds a row.
     *
     * @param id - The key the entry stands under
     * @param version - The version
     * @throws {Error} When the app's `key` fails
     */
    readonly build: (id: string, version: EntryVersion<W>) => string;
    /**
     * An entry the gesture touches none of, as it stands before the gesture: what an entry arriving under its key
     * begins from, and whether a row stands there.
     *
     * @param id - The key
     * @returns Its version; `undefined` for one the collection holds none of here
     */
    readonly original: (id: string) => EntryVersion<W> | undefined;
    /**
     * Whether a row is shown under a key `original` holds none of: a collection read a window at a time, whose builder
     * draws a row its session has not met. Never, unless given.
     *
     * @param id - The key
     */
    readonly shown?: ((id: string) => boolean) | undefined;
    /**
     * An entry's version as it stands under another key: its projection that key's, and its row's own key field, where
     * its rows hold their key in one.
     *
     * @param id - The key it moves under
     * @param version - Its version as the gesture leaves it
     */
    readonly underKey: (id: string, version: EntryVersion<W>) => EntryVersion<W>;
}

/** The entries a gesture moved under the keys their rows build, each by the key it left. */
export interface BuiltKeyMoves {
    /** Every entry moved. */
    readonly all: Map<string, string>;
    /** Those the collection held before the gesture — never one the gesture made, which nothing names yet. */
    readonly held: Map<string, string>;
}

/** Why a gesture's rows cannot stand under the keys they build. */
export interface BuiltKeyRefusal {
    /** The row refused, by the key it stood under; empty for a row the gesture would have added. */
    readonly id: string;
    /** The key taken, as its text — by the row of that key — or what building one threw. */
    readonly why: { readonly taken: string } | { readonly failed: unknown };
}

/**
 * Moves each entry a gesture touches under the key its row builds (see the
 * module docs), in the gesture's own entries: nothing is moved where any is
 * refused.
 *
 * @typeParam W - The collection's projection of an entry
 * @param entries - The gesture's entries, by the key each stands under: moved in place
 * @param rule - How the collection builds a row's key, and what stands under one
 * @returns The entries moved, by the key each left; or the refusal, the entries as they were
 */
export function settleBuiltKeys<W>(entries: Map<string, TouchedEntry<W>>, rule: BuiltKeyRule<W>): BuiltKeyMoves | { readonly refused: BuiltKeyRefusal } {
    const gone: EntryVersion<W> = { draft: undefined, wire: undefined, place: none };
    // A row the gesture made stood under the key it was made under for the gesture alone.
    const made = (before: EntryVersion<W>): boolean => before.draft === undefined;
    const going: { readonly from: string; readonly to: string; readonly before: EntryVersion<W>; readonly after: EntryVersion<W> }[] = [];
    for (const [id, { before, after }] of entries) {
        if (!rule.holds(after)) continue;
        let to: string;
        try {
            to = rule.build(id, after);
        } catch (error) {
            return { refused: { id: made(before) ? "" : id, why: { failed: error } } };
        }
        if (stringEqual(to, id)) continue;
        if (rule.holds(before)) {
            // The key its row built before the gesture. One its `key` failed on built none: the edit that gives it a key
            // moves it, and is never refused for what the row held before.
            let was: string | undefined;
            try { was = rule.build(id, before); } catch { was = undefined; }
            if (was !== undefined && stringEqual(was, to)) continue;
        }
        going.push({ from: id, to, before, after });
    }
    const leaving = new Set(going.map((move) => move.from));
    const arriving = new Set<string>();
    for (const { from, to, before } of going) {
        // Whether a row stands under the key: another the gesture moves there, one it leaves there — never one that leaves
        // it in this gesture — or one the collection holds or shows.
        const there = entries.get(to);
        const stood = there === undefined ? rule.original(to) : undefined;
        const stands = arriving.has(to) || (there !== undefined ? rule.holds(there.after) && !leaving.has(to)
            : stood !== undefined ? rule.holds(stood) : rule.shown?.(to) === true);
        if (stands) return { refused: { id: made(before) ? "" : from, why: { taken: to } } };
        arriving.add(to);
    }
    // Each leaves the key it stood under before any arrives.
    for (const { from, before } of going) {
        if (made(before)) entries.delete(from);
        else entries.set(from, { before, after: gone });
    }
    const all = new Map<string, string>();
    const held = new Map<string, string>();
    for (const { from, to, before, after } of going) {
        entries.set(to, { before: entries.get(to)?.before ?? rule.original(to) ?? gone, after: rule.underKey(to, after) });
        all.set(from, to);
        if (!made(before)) held.set(from, to);
    }
    return { all, held };
}
