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
 * stays (#1581). A row written back under a key its record holds a row under,
 * which the drafts removed — a removed row restored — is that row, never a new
 * one: it moves only as what its key reads changed from the row the record
 * holds there. Each leaves its key before any arrives, so a row may take the
 * key another leaves in the same gesture. A key another row stands under, and
 * one that fails as it is built, refuse the whole gesture. Each row moved says
 * where it came from as the gesture is recorded, so what a builder keeps of
 * it by its key follows it there (ruling 16 of east-workspace#1709).
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
     * The row the collection's record holds under a key, as last read: what a row written back under a key the drafts
     * removed is — a removed row restored — so it stands where the record keeps it, as the row it was. None unless given:
     * every row written where the drafts hold none is then one the gesture makes.
     *
     * @param id - The key
     * @returns Its version; `undefined` for a key the record holds no row under
     */
    readonly stored?: ((id: string) => EntryVersion<W> | undefined) | undefined;
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
 * Where an edit of a row puts it (see the module docs): under the key its row
 * builds as the gesture leaves it, where that is another than the key it
 * stands under and another than the key its row built as the gesture found
 * it. What every builder asks of a row a gesture changes: {@link settleBuiltKeys}
 * of a gesture's entries, and a builder that asks before it records
 * (`schedule/row-moves.ts`).
 *
 * @typeParam V - A row, as the builder holds one
 * @param build - The key a row builds, as its text
 * @param id - The key the row stands under
 * @param found - The row as the gesture found it; `undefined` for one it found none of — a row it makes
 * @param after - The row as the gesture leaves it
 * @returns The key it moves under; what building its key threw, which refuses the gesture; `undefined` for a row that
 *   stays where it stands
 */
export function builtKeyOf<V>(build: (row: V) => string, id: string, found: V | undefined, after: V): { readonly to: string } | { readonly failed: unknown } | undefined {
    let to: string;
    try {
        to = build(after);
    } catch (error) {
        return { failed: error };
    }
    if (stringEqual(to, id)) return undefined;
    if (found !== undefined) {
        // The key its row built before the gesture. One its `key` failed on built none: the edit that gives it a key
        // moves it, and is never refused for what the row held before.
        let was: string | undefined;
        try { was = build(found); } catch { was = undefined; }
        if (was !== undefined && stringEqual(was, to)) return undefined;
    }
    return { to };
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
    // A row the gesture made stood under the key it was made under for the gesture alone — never one written back under a
    // key its record holds a row under.
    const made = (id: string, before: EntryVersion<W>): boolean => before.draft === undefined && rule.stored?.(id) === undefined;
    const going: { readonly from: string; readonly to: string; readonly before: EntryVersion<W>; readonly after: EntryVersion<W> }[] = [];
    for (const [id, { before, after }] of entries) {
        if (!rule.holds(after)) continue;
        // The row as the gesture found it: drafted, else — the drafts removed it — as its record holds it.
        const found = rule.holds(before) ? before : rule.stored?.(id);
        const moved = builtKeyOf((version) => rule.build(id, version), id, found !== undefined && rule.holds(found) ? found : undefined, after);
        if (moved === undefined) continue;
        if ("failed" in moved) return { refused: { id: made(id, before) ? "" : id, why: { failed: moved.failed } } };
        going.push({ from: id, to: moved.to, before, after });
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
        if (stands) return { refused: { id: made(from, before) ? "" : from, why: { taken: to } } };
        arriving.add(to);
    }
    // Each leaves the key it stood under before any arrives.
    for (const { from, before } of going) {
        if (made(from, before)) entries.delete(from);
        else entries.set(from, { before, after: gone });
    }
    const all = new Map<string, string>();
    const held = new Map<string, string>();
    for (const { from, to, before, after } of going) {
        entries.set(to, { before: entries.get(to)?.before ?? rule.original(to) ?? gone, after: rule.underKey(to, after) });
        all.set(from, to);
        if (!made(from, before)) held.set(from, to);
    }
    return { all, held };
}

/**
 * Where each entry a gesture moved under the key its row builds came from (ruling 16 of east-workspace#1709), by the
 * key it went to: the key it stood under before the gesture, which the session follows it by (`EntryUpdate.from`) —
 * never for a row the gesture made, which stood nowhere: {@link settleBuiltKeys} leaves no entry under the key one was
 * made under.
 *
 * @typeParam W - The collection's projection of an entry
 * @param moves - The entries moved, each by the key it had before the gesture ({@link BuiltKeyMoves.all})
 * @param entries - The gesture's entries, as {@link settleBuiltKeys} left them
 * @returns The key each moved entry stood under, by the key it went to
 */
export function builtKeyOrigins<W>(moves: ReadonlyMap<string, string>, entries: ReadonlyMap<string, TouchedEntry<W>>): Map<string, string> {
    const came = new Map<string, string>();
    for (const [from, to] of moves) if (entries.has(from)) came.set(to, from);
    return came;
}
