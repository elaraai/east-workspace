/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page's filters, held for React (#1673). A reader's filters of a page live
 * in the UI store under the page's own key (e3-ui's `studioFiltersKey`), as a
 * builder's own view is (`shared/stored-value.ts`), so the builder's preview
 * and the published page narrow alike, and a surface's East may read and
 * write them. A reader the store holds none for starts with the page's
 * starting filters, which its layout holds; one who cleared them holds none.
 * The builder's canvas stands under the page's starting filters as the
 * builder drafts them (`./starting-filters.ts`) — never a reader's. One
 * {@link PageFiltersProvider} a page, given its filters; each tile reads its
 * state through {@link usePageState}.
 *
 * The filters are edited as the rail's gestures are made — added, changed,
 * removed, cleared — so the starting filters, which the builder drafts, take
 * each as one step of its history. The rules are `query/visual/filters.ts`'s;
 * these hooks hold them.
 *
 * @packageDocumentation
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { type ValueTypeOf } from "@elaraai/east";
import { StudioFiltersType, studioFiltersKey, type StudioKeyType } from "@elaraai/e3-ui/internal";
import { useVisualMinute } from "../query/visual/answers.js";
import { addFilter, changeFilter, printStateOf, readerFilters, removeFilter, type PageFilter } from "../query/visual/filters.js";
import type { PrintSource, PrintState } from "../query/visual/print.js";
import { forgetStoredValue, storedCodec, useStoredValue } from "../shared/stored-value.js";

/** A page's key, decoded. */
export type PageKey = ValueTypeOf<typeof StudioKeyType>;

/** A page's filters, as the UI store holds them. */
const FILTERS = storedCodec(StudioFiltersType);

/** No filters: what a page with none holds. */
const NO_FILTERS: readonly PageFilter[] = [];

/** The state of a page with no filters: what a tile outside a page reads. */
const NO_STATE: PrintState = { filters: [] };

/**
 * A page's filters, and how they are edited — one rail's gesture each.
 *
 * @property filters - The filters, in their order: a reader's, or the page's starting filters as the builder drafts them
 * @property add - Adds a filter after the rest
 * @property change - Changes the filter at a place
 * @property remove - Removes the filter at a place
 * @property clear - Removes every filter
 * @property set - Sets the filters whole: what a click that filters leaves them
 */
export interface PageFilters {
    /** The filters, in their order: a reader's, or the page's starting filters as the builder drafts them. */
    readonly filters: readonly PageFilter[];
    /** Adds a filter after the rest. */
    readonly add: (filter: PageFilter) => void;
    /** Changes the filter at a place, from 0. */
    readonly change: (index: number, filter: PageFilter) => void;
    /** Removes the filter at a place, from 0. */
    readonly remove: (index: number) => void;
    /** Removes every filter. */
    readonly clear: () => void;
    /** Sets the filters whole: what a click that filters leaves them. */
    readonly set: (filters: readonly PageFilter[]) => void;
}

const PageFiltersContext = createContext<PageFilters | null>(null);

/**
 * A page's filters, read from the UI store under the page's key and written
 * there: a reader's — or, while the store holds none, the page's starting
 * filters, which the reader's first edit makes their own.
 *
 * @param page - The page's key
 * @param starting - What a reader the store holds no filters for starts with: the page's starting filters
 *   (`query/visual/filters.ts`' `startingOf`), the same object while they hold
 * @returns The filters and their edits
 */
export function usePageFiltersOf(page: PageKey, starting: readonly PageFilter[] = NO_FILTERS): PageFilters {
    const [held, write] = useStoredValue(FILTERS, studioFiltersKey(page));
    const filters = readerFilters(held, starting);
    return useMemo((): PageFilters => {
        const set = (next: readonly PageFilter[]) => write([...next]);
        return {
            filters,
            add: (filter) => set(addFilter(filters, filter)),
            change: (index, filter) => set(changeFilter(filters, index, filter)),
            remove: (index) => set(removeFilter(filters, index)),
            clear: () => set([]),
            set,
        };
    }, [filters, write]);
}

/**
 * Forgets a reader's filters of a page: its readers here start afresh, with its
 * starting filters — what the builder's Preview opens on.
 *
 * @param page - The page's key
 */
export function forgetPageFilters(page: PageKey): void {
    forgetStoredValue(studioFiltersKey(page));
}

/** Props of {@link PageFiltersProvider}. */
export interface PageFiltersProviderProps {
    /** The page's filters, and their edits: a reader's ({@link usePageFiltersOf}), or the starting filters the builder drafts. */
    readonly value: PageFilters;
    /** The page. */
    readonly children?: ReactNode;
}

/**
 * Holds a page's filters for its tiles, which narrow by them.
 *
 * @param props - The filters, and the page
 * @returns The page, its tiles narrowed by its filters
 */
export function PageFiltersProvider({ value, children }: PageFiltersProviderProps) {
    return createElement(PageFiltersContext.Provider, { value }, children);
}

/**
 * The page's filters, and how they are edited.
 *
 * @returns The filters and their edits; `undefined` outside a page
 */
export function usePageFilters(): PageFilters | undefined {
    return useContext(PageFiltersContext) ?? undefined;
}

/**
 * The page's state as a visual's printer reads it (`printStateOf`): the
 * page's filters on the visual's source — all but the one its own click made
 * (#1673) — and the range they hold its date to, counted from the page's
 * minute.
 *
 * @param source - The visual's source's key
 * @param read - The source, as the printer reads it; `undefined` for one the surface does not list
 * @param placement - The visual's placement's key; every filter on the source when omitted
 * @returns The state; no filters outside a page, or for a source not listed
 */
export function usePageState(source: string, read: PrintSource | undefined, placement?: string): PrintState {
    const filters = useContext(PageFiltersContext)?.filters ?? NO_FILTERS;
    const minute = useVisualMinute();
    return useMemo(
        () => (read === undefined || minute === undefined || filters.length === 0 ? NO_STATE : printStateOf(filters, source, read, minute, placement)),
        [filters, source, read, minute, placement],
    );
}
