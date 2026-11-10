/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Window arithmetic for the paging runtime, pure: where a read starts in a
 * landed window that covers it (#1217, #1351), a cut of a decoded window, the
 * parts of a window read in turn joined, and the runs left once an answer's
 * entries are in hand.
 *
 * @packageDocumentation
 */

import { SortedMap, SortedSet, compareFor, fromEastTypeValue, type EastTypeValue } from "@elaraai/east";

import type { PagedRun } from "./api.js";
import type { PageEntry } from "./state.js";

/**
 * Where a read of `[offset, offset + limit)` of a family starts in a landed
 * window that holds all of it: by the window's span, or inside one of a runs
 * read's runs (#1217, #1351).
 *
 * @param entry - A landed window's channel
 * @param family - The read's family
 * @param offset - The read's first element
 * @param limit - How many elements it asks for
 * @returns The element of the window it starts at, or `undefined` when the window holds none of it whole
 */
export function coveringAt(entry: PageEntry, family: string, offset: number, limit: number): number | undefined {
    const span = entry.span;
    if (span !== undefined) {
        return span.family === family && span.offset <= offset && offset + limit <= span.offset + span.count ? offset - span.offset : undefined;
    }
    const spans = entry.runSpans;
    if (spans === undefined || spans.family !== family) return undefined;
    // The last run starting at or before the read's offset.
    let lo = 0;
    let hi = spans.runs.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (spans.runs[mid]!.row <= offset) lo = mid + 1;
        else hi = mid;
    }
    const run = spans.runs[lo - 1];
    return run !== undefined && offset + limit <= run.row + run.count ? run.at + (offset - run.row) : undefined;
}

/**
 * How many elements a decoded window holds, by the source's collection type;
 * `undefined` for a type a window is not cut from.
 *
 * @param sourceType - The source's type: an Array, Dict or Set
 * @param window - A decoded window of it
 * @returns The element count
 */
export function elementCount(sourceType: EastTypeValue, window: unknown): number | undefined {
    switch (sourceType.type) {
        case "Array": return (window as readonly unknown[]).length;
        case "Dict": return (window as ReadonlyMap<unknown, unknown>).size;
        case "Set": return (window as ReadonlySet<unknown>).size;
        default: return undefined;
    }
}

/**
 * Elements `[from, from + count)` of a decoded window, as a value of the
 * source's own type: an Array's slice, or a Dict's or a Set's entries in
 * their key order, under the key type's own comparator (#1217).
 *
 * @param sourceType - The source's type: an Array, Dict or Set
 * @param window - A decoded window of it
 * @param from - The first element, counted from the window's start
 * @param count - How many elements
 * @returns The cut, or `undefined` for a type a window is not cut from
 */
export function cutWindow(sourceType: EastTypeValue, window: unknown, from: number, count: number): unknown {
    switch (sourceType.type) {
        case "Array": return (window as readonly unknown[]).slice(from, from + count);
        case "Dict": {
            const keyType = fromEastTypeValue((sourceType.value as { key: EastTypeValue }).key);
            return new SortedMap([...(window as ReadonlyMap<unknown, unknown>)].slice(from, from + count), compareFor(keyType));
        }
        case "Set": {
            const elementType = fromEastTypeValue(sourceType.value as EastTypeValue);
            return new SortedSet([...(window as ReadonlySet<unknown>)].slice(from, from + count), compareFor(elementType));
        }
        default: return undefined;
    }
}

/**
 * The runs left of `runs` once their first `taken` entries are in hand.
 *
 * @param runs - The runs asked
 * @param taken - How many of their entries an answer held
 * @returns The rest, the first one cut where the answer ended
 */
export function runsAfter(runs: readonly PagedRun[], taken: number): PagedRun[] {
    const rest: PagedRun[] = [];
    let skip = taken;
    for (const [row, count] of runs) {
        if (skip >= count) { skip -= count; continue; }
        rest.push([row + skip, count - skip]);
        skip = 0;
    }
    return rest;
}

/**
 * The parts of one window read in turn, as one value of the source's type: an
 * Array's items one after another, a Set's or a Dict's in their key order.
 *
 * @param sourceType - The source's type: an Array, a Set or a Dict
 * @param parts - The decoded parts, in order
 * @returns The window
 */
export function joinWindows(sourceType: EastTypeValue, parts: readonly unknown[]): unknown {
    if (parts.length === 1) return parts[0];
    switch (sourceType.type) {
        case "Dict": {
            const keyType = fromEastTypeValue((sourceType.value as { key: EastTypeValue }).key);
            return new SortedMap(parts.flatMap((part) => [...(part as ReadonlyMap<unknown, unknown>)]), compareFor(keyType));
        }
        case "Set": {
            const elementType = fromEastTypeValue(sourceType.value as EastTypeValue);
            return new SortedSet(parts.flatMap((part) => [...(part as ReadonlySet<unknown>)]), compareFor(elementType));
        }
        default: return parts.flatMap((part) => [...(part as readonly unknown[])]);
    }
}
