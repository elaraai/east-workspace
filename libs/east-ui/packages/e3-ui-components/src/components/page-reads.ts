/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A collection read a page at a time, as a paged view reads it: the page
 * cache `<PagedDatasetPreview>` and the query builder's result too large for
 * one answer (`query/paged-result.ts`, #1113) share.
 *
 * - Each page is read once while it is wanted. Those far from what the view
 *   shows are let go past a cap — a page's rows become the view's nodes, so
 *   the pages held are bounded — and read again when they are wanted again.
 * - A page that lands for a collection the view no longer shows, or after the
 *   pages started afresh, lands nothing.
 * - A page that cannot be read says why, once; it is read again when it is
 *   wanted again.
 * - Its `need` and `keep` are new whenever the pages start afresh — another
 *   collection, or a reset — and only then, so a view that asks from an effect
 *   keyed on them asks for the new pages, and never again for the same ones.
 *
 * How a page is fetched, and what it holds, is its reader's.
 *
 * @packageDocumentation
 */

import { useCallback, useReducer, useRef } from 'react';
import { pruneRetainedPages } from '@elaraai/east-ui/internal';

/** What a view reads its pages from ({@link usePageReads}). */
export interface PageReader<V> {
    /** The collection the pages are of: when it changes the pages start afresh, and a page read for an earlier one lands nothing. */
    readonly identity: string;
    /**
     * Reads a page.
     *
     * @param page - The page's index
     * @param live - Whether the read still lands: what a reader checks before it does anything beside answering the page
     * @returns What the page holds; or `undefined` for a page that lands nothing — its reader started the pages afresh,
     *   say — which is read again when it is wanted
     */
    read(page: number, live: () => boolean): Promise<V | undefined>;
    /** The most pages held: those far from what the view shows go past it. */
    readonly retain: number;
}

/** A collection's pages, as a view reads them ({@link usePageReads}). */
export interface PageReads<V> {
    /** The pages that landed, by index. */
    readonly pages: ReadonlyMap<number, V>;
    /** How many pages are being read. */
    readonly loading: number;
    /** Why the first page that could not be read could not be; `undefined` while every one could. */
    readonly failure: Error | undefined;
    /**
     * Reads the pages `[first, last]` that have not landed and are not being
     * read. It sets nothing as it is asked, so a renderer may ask in its render.
     * It is new whenever the pages start afresh, and asks only for those.
     */
    need(first: number, last: number): void;
    /**
     * Lets go of the pages far from `[first, last]`, past the most held; under
     * it, the same pages stay. It is new whenever the pages start afresh.
     */
    keep(first: number, last: number): void;
    /** Starts the pages afresh, holding `pages`: what a reader does that learns its pages are addressed otherwise. */
    reset(pages?: ReadonlyMap<number, V>): void;
}

/** What the pages of one collection hold, until they start afresh. */
interface Held<V> {
    readonly identity: string;
    pages: ReadonlyMap<number, V>;
    readonly reading: Set<number>;
    failure: Error | undefined;
}

/** The pages of a collection, started afresh. */
function heldOf<V>(identity: string, pages: ReadonlyMap<number, V> = new Map()): Held<V> {
    return { identity, pages, reading: new Set(), failure: undefined };
}

/**
 * Reads a collection a page at a time: see the module docs.
 *
 * @param reader - What the pages are of, how one is read, and the most held
 * @returns The pages, and how to ask for more and let go of some
 */
export function usePageReads<V>(reader: PageReader<V>): PageReads<V> {
    const { identity, retain } = reader;
    // The latest render's read: a page asked for after it reads as it does — with its token, say.
    const read = useRef(reader.read);
    read.current = reader.read;
    const held = useRef<Held<V>>(heldOf(identity));
    if (held.current.identity !== identity) held.current = heldOf(identity);
    // The pages this render shows, which its need and keep act on: each is new
    // once the pages start afresh, so an effect keyed on it asks for the new ones.
    const at = held.current;
    const [, rendered] = useReducer((n: number) => n + 1, 0);
    // Shows what changed in a render after the one that asked: never an update while one renders.
    const show = useCallback(() => queueMicrotask(rendered), []);

    const need = useCallback((first: number, last: number) => {
        let asked = false;
        for (let page = Math.max(0, first); page <= last; page++) {
            if (at.pages.has(page) || at.reading.has(page)) continue;
            at.reading.add(page);
            asked = true;
            const live = (): boolean => held.current === at;
            new Promise<V | undefined>((resolve) => resolve(read.current(page, live))).then((value) => {
                if (live() && value !== undefined) at.pages = new Map(at.pages).set(page, value);
            }, (err: unknown) => {
                if (live()) at.failure ??= err instanceof Error ? err : new Error(String(err));
            }).finally(() => {
                if (!live()) return;
                at.reading.delete(page);
                rendered();
            });
        }
        if (asked) show();
    }, [at, show]);
    const keep = useCallback((first: number, last: number) => {
        const kept = pruneRetainedPages(at.pages, first, last, retain);
        if (kept === at.pages) return;
        at.pages = kept;
        show();
    }, [at, retain, show]);
    const reset = useCallback((pages?: ReadonlyMap<number, V>) => {
        held.current = heldOf(held.current.identity, pages);
        rendered();
    }, []);
    return { pages: at.pages, loading: at.reading.size, failure: at.failure, need, keep, reset };
}
