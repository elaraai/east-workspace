/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One gesture over a short list of entries, each drafted whole (#935, #1673):
 * what the shared editing session records of a list as the gesture leaves it —
 * each entry the gesture changed, added, removed or moved, once, and where each
 * stands. A builder whose collection is such a list records its gestures as the
 * lists they leave: the query's header and steps, a Studio page's starting
 * filters.
 *
 * Every entry a gesture places stands after the entry before it in the list the
 * gesture leaves, or at its start — so no two it places stand on each other —
 * and an entry the session placed before, whose placement no longer says where
 * the gesture leaves it, is placed again: one placed beside an entry the gesture
 * removes or moves. Apply places each entry as it is told, so an entry left
 * placed beside one gone could not be placed at all, and the drafts with it.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, none, some, variant } from "@elaraai/east";
import type { EntryUpdate, EntryVersion, Placement } from "@elaraai/east-ui-components";

const stringEqual = equalFor(StringType);
/** No version: an entry the gesture adds, before it. */
const ABSENT = { draft: undefined, wire: undefined, place: none } as const;

/**
 * How a list's entries are read.
 *
 * @typeParam E - An entry
 * @typeParam W - The collection's projection of an entry
 */
export interface ListEntries<E, W> {
    /** An entry's id. */
    readonly idOf: (entry: E) => string;
    /** Whether two entries are the same value. */
    readonly same: (a: E, b: E) => boolean;
    /** The collection's projection of an entry. */
    readonly wireOf: (entry: E) => W;
}

/** An entry's placement among the entries a gesture leaves: after the entry before it, else at the start. */
function placementIn<E>(entries: readonly E[], index: number, idOf: (entry: E) => string): Placement {
    const previous = entries[index - 1];
    return previous === undefined ? some(variant("ordered", variant("start", null))) : some(variant("ordered", variant("after", idOf(previous))));
}

/**
 * Whether a placement says where an entry stands among the entries a gesture
 * leaves: beside the entry it names, on the side it names; first for the start;
 * last for the end. A placement that orders nothing — none, or the key's — does.
 */
function standsAt<E>(place: Placement, entries: readonly E[], index: number, idOf: (entry: E) => string): boolean {
    if (place.type !== "some" || place.value.type !== "ordered") return true;
    const position = place.value.value;
    const beside = (at: number, id: string) => {
        const entry = entries[at];
        return entry !== undefined && stringEqual(idOf(entry), id);
    };
    switch (position.type) {
        case "before": return beside(index + 1, position.value);
        case "after": return beside(index - 1, position.value);
        case "start": return index === 0;
        case "end": return index === entries.length - 1;
    }
}

/**
 * The entries a gesture moved: those outside the longest run of entries that
 * kept their order, so a move places the entry moved, not its neighbours.
 */
function movedIn(before: readonly string[], after: readonly string[]): Set<string> {
    const common = after.filter(id => before.includes(id));
    const at = common.map(id => before.indexOf(id));
    const length = at.map(() => 1);
    const previous = at.map(() => -1);
    for (let i = 0; i < at.length; i++) {
        for (let j = 0; j < i; j++) {
            if (at[j]! < at[i]! && length[j]! + 1 > length[i]!) {
                length[i] = length[j]! + 1;
                previous[i] = j;
            }
        }
    }
    let best = -1;
    for (let i = 0; i < at.length; i++) if (best < 0 || length[i]! > length[best]!) best = i;
    const kept = new Set<string>();
    for (let i = best; i >= 0; i = previous[i]!) kept.add(common[i]!);
    return new Set(common.filter(id => !kept.has(id)));
}

/**
 * The updates one gesture makes of a list: the entries as they were and as the
 * gesture leaves them, as one transaction of every entry it changed, added,
 * removed or moved.
 *
 * @typeParam E - An entry
 * @typeParam W - The collection's projection of an entry
 * @param current - The entries as the drafts stand
 * @param next - The entries after the gesture
 * @param entries - How the entries are read
 * @param held - The session's own version of an entry, where it holds one: what it drafted, and where it placed it
 * @param original - An entry's version before any draft of it
 * @returns Each entry the gesture touched, once: one changed keeps its place; one added or moved — or one the session
 *   placed where its placement no longer says it stands — is placed after the entry before it, else at the start; and one
 *   removed is absent after it. None for a gesture that changes nothing
 *
 * @example
 * ```ts
 * const updates = listUpdates(drafted, [...drafted, added], ENTRIES, (id) => session.entries.get(id), original);
 * if (updates.length > 0) session.record(updates, "insert", "Add filter");
 * ```
 */
export function listUpdates<E, W>(
    current: readonly E[],
    next: readonly E[],
    entries: ListEntries<E, W>,
    held: (id: string) => EntryVersion<W> | undefined,
    original: (id: string) => EntryVersion<W>,
): EntryUpdate<W>[] {
    const { idOf, same, wireOf } = entries;
    const versionOf = (id: string): EntryVersion<W> => held(id) ?? original(id);
    const was = new Map(current.map((e, i) => [idOf(e), { entry: e, index: i }]));
    const now = new Map(next.map((e, i) => [idOf(e), { entry: e, index: i }]));
    const moved = movedIn(current.map(idOf), next.map(idOf));
    const updates: EntryUpdate<W>[] = [];
    for (const [id, { entry, index }] of now) {
        const old = was.get(id);
        const before: EntryVersion<W> = old === undefined ? ABSENT : versionOf(id);
        // A placement of the session's that no longer says where the entry stands — beside one removed or moved — is
        // made again: Apply could not place the entry beside one gone.
        const stale = old !== undefined && !standsAt(held(id)?.place ?? none, next, index, idOf);
        const placed = old === undefined || moved.has(id) || stale;
        const changed = old === undefined || !same(old.entry, entry);
        if (!changed && !placed) continue;
        updates.push({ id, before, after: { draft: variant("value", entry), wire: wireOf(entry), place: placed ? placementIn(next, index, idOf) : before.place } });
    }
    for (const [id] of was) {
        if (now.has(id)) continue;
        updates.push({ id, before: versionOf(id), after: { draft: undefined, wire: undefined, place: none } });
    }
    return updates;
}
