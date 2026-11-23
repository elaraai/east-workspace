/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The one of several values that changed last: what a builder follows once
 * where several things may each say news of the same kind — the entries a
 * carry-over, a gesture, or an Undo last put under another key
 * (east-workspace#1709), each said by a new object.
 *
 * @packageDocumentation
 */

import { useRef } from "react";

/**
 * What a source says, where it is news to whoever keeps `heard`: said since the
 * source was first heard there. What it had said before then is none — a
 * session kept through its builder mounting again says still what its last
 * Undo put under another key, and the builder that mounts follows only what
 * moves from then on.
 *
 * @typeParam S - The sources' type
 * @typeParam T - What a source says: a new object each time it says something new
 * @param heard - What each source last said, as last heard: kept by the caller, for as long as it listens
 * @param source - The source
 * @param said - What it says now
 * @returns What it says, where that is news; `undefined` where it was heard already, or the source is heard for the first time
 */
export function newsOf<S extends object, T>(heard: WeakMap<S, T>, source: S, said: T): T | undefined {
    const first = !heard.has(source);
    if (!first && Object.is(heard.get(source), said)) return undefined;
    heard.set(source, said);
    return first ? undefined : said;
}

/**
 * The one of several values that changed last, each change a new object. None
 * of them until one changes: what stood as the component mounted is no news,
 * so a builder that mounts again follows only what changes from then on. Where
 * several change in one render, the first of them is the one.
 *
 * @typeParam T - The values' type
 * @param values - The values, as they stand at this render: as many, in the same order, at every render
 * @param none - What stands for no news
 * @returns The value that changed last; `none` while none has
 */
export function useLatestOf<T>(values: readonly T[], none: T): T {
    const held = useRef({ values, last: none });
    const changed = values.findIndex((value, i) => !Object.is(value, held.current.values[i]));
    if (changed >= 0) held.current = { values, last: values[changed]! };
    return held.current.last;
}
