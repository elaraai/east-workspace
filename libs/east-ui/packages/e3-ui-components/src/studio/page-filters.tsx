/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page's filters, held for React (#1673): a reader's filters of a page live
 * in the UI store under the page's own key (e3-ui's `studioFiltersKey`), as
 * a builder's own view is (`shared/stored-value.ts`), so the builder's
 * canvas, the preview beside it and the published page narrow alike, and a
 * surface's East may read and write them. One
 * {@link PageFiltersProvider} a page; each tile reads its state through
 * {@link usePageState}.
 *
 * The rules are `query/visual/filters.ts`'s; these hooks hold them.
 *
 * @packageDocumentation
 */

import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from "react";
import { type ValueTypeOf } from "@elaraai/east";
import { StudioFiltersType, studioFiltersKey, type StudioKeyType } from "@elaraai/e3-ui/internal";
import { useVisualMinute } from "../query/visual/answers.js";
import { printStateOf, type PageFilter } from "../query/visual/filters.js";
import type { PrintSource, PrintState } from "../query/visual/print.js";
import { storedCodec, useStoredValue } from "../shared/stored-value.js";

/** A page's key, decoded. */
export type PageKey = ValueTypeOf<typeof StudioKeyType>;

/** A page's filters, as the UI store holds them. */
const FILTERS = storedCodec(StudioFiltersType);

/** No filters: what a page with none holds. */
const NO_FILTERS: readonly PageFilter[] = [];

/** The state of a page with no filters: what a tile outside a page reads. */
const NO_STATE: PrintState = { filters: [] };

/**
 * A page's filters, and how they are set.
 *
 * @property filters - The reader's filters of the page, in the order they were added
 * @property set - Sets them: every surface that draws the page narrows by them
 */
export interface PageFilters {
    /** The reader's filters of the page, in the order they were added. */
    readonly filters: readonly PageFilter[];
    /** Sets them: every surface that draws the page narrows by them. */
    readonly set: (filters: readonly PageFilter[]) => void;
}

const PageFiltersContext = createContext<PageFilters | null>(null);

/** Props of {@link PageFiltersProvider}. */
export interface PageFiltersProviderProps {
    /** The page whose filters these are. */
    readonly page: PageKey;
    /** The page. */
    readonly children?: ReactNode;
}

/**
 * A page's filters, read from the UI store under the page's key and written
 * there: what a surface that draws the page holds them by — its rail, which
 * stands over the page's provider, and the provider itself.
 *
 * @param page - The page's key
 * @returns The filters and their setter
 */
export function usePageFiltersOf(page: PageKey): PageFilters {
    const [held, write] = useStoredValue(FILTERS, studioFiltersKey(page));
    const filters = held ?? NO_FILTERS;
    const set = useCallback((next: readonly PageFilter[]) => write([...next]), [write]);
    return useMemo((): PageFilters => ({ filters, set }), [filters, set]);
}

/**
 * Holds a page's filters for its tiles: read from the UI store under the
 * page's key, and written there.
 *
 * @param props - The page's key, and the page
 * @returns The page, its tiles narrowed by its filters
 */
export function PageFiltersProvider({ page, children }: PageFiltersProviderProps) {
    const value = usePageFiltersOf(page);
    return createElement(PageFiltersContext.Provider, { value }, children);
}

/**
 * The page's filters, and how they are set.
 *
 * @returns The filters and their setter; `undefined` outside a page
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
