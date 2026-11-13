/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** The `Iterator` built-in's `from`, as an engine that has the built-in gives it. */
interface IteratorBuiltin {
    from<T>(source: Iterator<T> | Iterable<T>): IteratorObject<T, undefined, unknown>;
}

/**
 * Returns an iterator as one of the engine's own, where the engine has the `Iterator` built-in.
 *
 * @typeParam T - The type of the values the iterator yields
 * @param source - An iterator that is its own iterable: a generator, or one of sorted-btree's
 * @returns `Iterator.from(source)` where the engine has `Iterator`, else `source` itself
 *
 * @remarks
 * A container's `keys()`, `values()` and `entries()` return the built-in iterators' types, which hold the
 * iterator helpers (`map`, `filter`, `toArray`, …), and `Iterator.from` is what gives a source those
 * methods. It is newer than the engines East runs on: an iPhone's browsers, each on the system's own
 * engine, gained `Iterator` in iOS 18.4, and before it a container that named the built-in threw
 * `Can't find variable: Iterator` the moment it was iterated — every Dict and Set a page held.
 *
 * So the built-in is read where the engine has it, never named. With it, the iterator is what it always
 * was. Without it, the source is handed on as it is: it iterates — `for…of`, a spread, `Array.from`,
 * `new Map(…)` — and has no helper, as no iterator on such an engine has. It is read at each call, never
 * once as the module loads, so an engine given the built-in later is served by it from then on.
 *
 * @internal
 */
export function builtinIterator<T>(source: IterableIterator<T>): IteratorObject<T, undefined, unknown> {
    const builtin = (globalThis as { Iterator?: IteratorBuiltin }).Iterator;
    if (builtin === undefined || typeof builtin.from !== "function") {
        return source as unknown as IteratorObject<T, undefined, unknown>;
    }
    return builtin.from(source);
}
