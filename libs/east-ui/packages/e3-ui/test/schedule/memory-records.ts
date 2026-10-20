/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Record.bind`, `Data.bind` and `Data.bindPaged`, in memory, for the
 * `Schedule` and Plan specs: each record's handle reads a fixed state, and its
 * patch door commits at `state-1`; each dataset's handle reads a fixed value;
 * each paged read serves an index's entries or a record's own, by window and
 * by key search — the handles the runtimes build, their methods plain
 * functions.
 */

import { SortedMap, compareFor, none, parseFor, some, variant, type EastType, type EastTypeValue, type ValueTypeOf, type option } from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";
import type { SeekQueryType } from "@elaraai/east-ui";
import { bindPagedPinnedPlatformFn, bindPlatformFn, recordBindPlatformFn } from "@elaraai/e3-ui/internal";

/**
 * The platform a compiled function binds records through, each record's state by its name.
 *
 * @param states - Each record's state, by the record's name
 * @param wholeReads - Counts each record's whole reads, by its name, when given: what a read bounded to a window never makes
 * @returns The `Record.bind` implementation, for `East.compile`'s platform
 */
export function memoryRecords(states: ReadonlyMap<string, unknown>, wholeReads?: Map<string, number>): PlatformFunction[] {
    return [recordBindPlatformFn.implement((_handleType: EastTypeValue) => (nameArg: unknown) => {
        const name = nameArg as string;
        return {
            read: () => {
                wholeReads?.set(name, (wholeReads.get(name) ?? 0) + 1);
                return states.get(name);
            },
            status: () => variant("up-to-date", null),
            history: () => none,
            mutate: { pending: () => false, status: () => variant("idle", null), error: () => none, cancel: () => null, patch: () => null },
            commit: { patch: async () => variant("committed", { commitHash: "commit-1", stateHash: "state-1" }) },
            start: () => null,
            binding: { name, mutations: ["patch"] },
        };
    })];
}

/** What a paged read was asked: each key search, and each page by its offset and limit. */
export interface PagedAsked {
    /** Each key search, in order. */
    seeks: ValueTypeOf<typeof SeekQueryType>[];
    /** Each page, as its offset and limit, in order. */
    pages: [bigint, bigint][];
}

/** One entry of an index's window: its index key, the record's key, no projection, and the row when the read joins it. */
export interface MemoryIndexEntry {
    /** The index's key. */
    ik: unknown;
    /** The record's key. */
    key: unknown;
    /** The entry's projection: none. */
    value: null;
    /** The record's row. */
    row: option<unknown>;
}

/** A paged read in memory: what it serves, the type a search seeks by, what it was asked, and what holds a read in flight. */
export interface MemoryPagedSource {
    /** An index's entries, in its order — by its key, then the record's — or a record's own entries, by key. */
    entries: readonly MemoryIndexEntry[] | SortedMap<unknown, unknown>;
    /** What a search seeks: the index's key type, or the record's. */
    keyType: EastType;
    /** What it was asked. */
    asked: PagedAsked;
    /** Holds the search, or the page at an offset, in flight while it says so. */
    held?: (what: "seek" | bigint) => boolean;
}

/**
 * `Data.bindPaged`, in memory: each paged read by its dataset's path, and the
 * index it reads through (`<path>@<index>`) — its pages, its key search (an
 * exact key, or a half-open range of keys, either end open), its total and
 * its revision — each search and page counted, and held in flight while the
 * source says so.
 *
 * @param sources - Each paged read, by its path's text, and `@index` for one through an index
 * @returns The `Data.bindPaged` implementation, for `East.compile`'s platform
 */
export function memoryPages(sources: ReadonlyMap<string, MemoryPagedSource>): PlatformFunction[] {
    return [bindPagedPinnedPlatformFn.implement((_type: EastTypeValue) => (pathArg: unknown, indexArg: unknown, joinArg: unknown) => {
        const index = indexArg as option<string>;
        const name = (pathArg as readonly { value: string }[]).map((step) => step.value).join(".");
        const id = index.type === "some" ? `${name}@${index.value}` : name;
        const source = sources.get(id);
        if (source === undefined) throw new Error(`no paged source ${id} in memory`);
        const join = joinArg === true;
        const all = source.entries;
        const compareKey = compareFor(source.keyType);
        const parseKey = parseFor(source.keyType);
        const keys: readonly unknown[] = Array.isArray(all) ? (all as readonly MemoryIndexEntry[]).map((e) => e.ik) : [...(all as SortedMap<unknown, unknown>).keys()];
        // A search's literal, read at the key type; and where a key falls among the keys, in their order.
        const keyOf = (text: string): unknown => {
            const read = parseKey(text);
            if (!read.success) throw new Error(`not a key literal: ${text}`);
            return read.value;
        };
        const firstFrom = (key: unknown): number => {
            const at = keys.findIndex((k) => compareKey(k, key) >= 0);
            return at < 0 ? keys.length : at;
        };
        return {
            id,
            page: (offset: bigint, limit: bigint) => {
                source.asked.pages.push([offset, limit]);
                if (source.held?.(offset) === true) return none;
                const from = Number(offset);
                const to = Math.min(keys.length, from + Number(limit));
                if (Array.isArray(all)) return some((all as readonly MemoryIndexEntry[]).slice(from, to).map((e) => (join ? e : { ...e, row: none })));
                return some(new SortedMap([...(all as SortedMap<unknown, unknown>)].slice(from, to), compareKey));
            },
            total: () => some(BigInt(keys.length)),
            seek: some((query: ValueTypeOf<typeof SeekQueryType>) => {
                source.asked.seeks.push(query);
                if (source.held?.("seek") === true) return none;
                if (query.type === "key") {
                    const key = keyOf(query.value);
                    const at = firstFrom(key);
                    const found = at < keys.length && compareKey(keys[at], key) === 0;
                    return some({ found, row: BigInt(at), count: found ? 1n : 0n });
                }
                if (query.type === "range") {
                    const from = query.value.from.length === 0 ? 0 : firstFrom(keyOf(query.value.from[0]!));
                    const to = query.value.to.length === 0 ? keys.length : firstFrom(keyOf(query.value.to[0]!));
                    return some({ found: to > from, row: BigInt(from), count: BigInt(Math.max(0, to - from)) });
                }
                throw new Error(`a ${query.type} search is not served in memory`);
            }),
            revision: () => some(`${id}-state-0`),
            refresh: () => null,
        };
    })];
}

/**
 * The platform a compiled function binds datasets through, each dataset's value by its name — the last field of its path.
 *
 * @param values - Each dataset's value, by the dataset's name
 * @returns The `Data.bind` implementation, for `East.compile`'s platform
 */
export function memoryData(values: ReadonlyMap<string, unknown>): PlatformFunction[] {
    return [bindPlatformFn.implement((_type: EastTypeValue) => (sourceArg: unknown, patch: unknown, mode: unknown) => {
        const source = sourceArg as readonly { type: string; value: string }[];
        const value = values.get(source[source.length - 1]!.value);
        return {
            read: () => value,
            write: () => null,
            writeAndStart: () => null,
            start: () => null,
            source: () => value,
            pending: () => false,
            commit: () => null,
            discard: () => null,
            has: () => true,
            status: () => variant("up-to-date", null),
            binding: { source, patch, mode },
        };
    })];
}
