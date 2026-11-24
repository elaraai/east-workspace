/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A page's clicks (#1673, LNK-1 to LNK-5): what a click on one of its visuals
 * does, and what a visual that follows another reads.
 *
 * A surface that draws a page stands this over its tiles
 * ({@link PageClicksProvider}), beside the page's filters: the reader's
 * selections of the page — the groups clicked on each placement whose click
 * selects, kept in the UI store under the page's key — whether a click runs
 * (a page's and the preview's do; on the builder's canvas a click edits), and
 * who is told a click opens another page. A tile reads what its own clicks do
 * ({@link useTileClicks}) and what it follows ({@link useFollowing}); the
 * rules are `query/visual/clicks.ts`'s. A visual whose click filters marks
 * what the filter its click made holds, and is never narrowed by it
 * ({@link useTileState}).
 *
 * @packageDocumentation
 */

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { JqType, equalFor, type JqNode, type ValueTypeOf } from "@elaraai/east";
import {
    StudioFiltersType, StudioSelectionsType, studioFiltersKey, studioSelectionsKey, type StudioCellType, type StudioContentType,
} from "@elaraai/e3-ui/internal";
import {
    clickDone, clickedOf, followingOf, isMarked, isSelected, openedFilters, withCondition, type Clicked, type ClickedGroup, type Following,
} from "../query/visual/clicks.js";
import { markedBy, readerFilters, type PageFilter } from "../query/visual/filters.js";
import type { PrintSource, PrintState } from "../query/visual/print.js";
import { changeStoredValue, storedCodec, useStoredValue } from "../shared/stored-value.js";
import { usePageFilters, usePageState, type PageKey } from "./page-filters.js";
import type { VisualClicks } from "./visual/clicks.js";

/** One placement, decoded. */
type Cell = ValueTypeOf<typeof StudioCellType>;
/** A visual, decoded. */
type Visual = Extract<ValueTypeOf<typeof StudioContentType>, { type: "visual" }>["value"];

/** A page's selections, as the UI store holds them. */
const SELECTIONS = storedCodec(StudioSelectionsType);
/** A page's filters, as the UI store holds them: another page's, which a click that opens it writes. */
const FILTERS = storedCodec(StudioFiltersType);

const sameCondition = equalFor(JqType);

/** What an Escape pressed in it is its own: an overlay's, or a field being typed in. */
const OWN_ESCAPE = "[role=dialog], [role=menu], [role=listbox], input, textarea, select, [contenteditable]";

/** No selections: what a page with none holds. */
const NO_SELECTIONS: ReadonlyMap<string, readonly Clicked[]> = new Map();
/** No selection: what a placement with none holds. */
const NO_SELECTION: readonly Clicked[] = [];
/** No groups marked: what a visual whose click made no filter holds. */
const NO_MARKS: readonly JqNode[] = [];

/**
 * A page's clicks.
 *
 * @property cells - The page's placements: what a follower finds its leader among
 * @property selections - Each placement's selection, by its key
 * @property select - Sets a placement's selection
 * @property live - Whether a click on a visual runs: on a page and in the preview; on the builder's canvas a click edits
 * @property open - Opens the page a click names, narrowed to the clicked group; `undefined` where no one is told
 */
export interface PageClicks {
    /** The page's placements: what a follower finds its leader among. */
    readonly cells: readonly Cell[];
    /** Each placement's selection, by its key. */
    readonly selections: ReadonlyMap<string, readonly Clicked[]>;
    /** Sets a placement's selection: every visual that follows it narrows to it. */
    readonly select: (placement: string, selection: readonly Clicked[]) => void;
    /** Whether a click on a visual runs: on a page and in the preview; on the builder's canvas a click edits. */
    readonly live: boolean;
    /** Opens the page a click names, narrowed to the clicked group; `undefined` where no one is told. */
    readonly open: ((target: PageKey, filter: PageFilter) => void) | undefined;
}

const PageClicksContext = createContext<PageClicks | null>(null);

/** Props of {@link PageClicksProvider}. */
export interface PageClicksProviderProps {
    /** The page whose clicks these are. */
    readonly page: PageKey;
    /** The page's placements. */
    readonly cells: readonly Cell[];
    /** Whether a click on a visual runs. */
    readonly live: boolean;
    /** Told the key of the page a click opens, once its filters hold the clicked group; `undefined` where a click opens nothing. */
    readonly onOpen?: ((page: PageKey) => void) | undefined;
    /** The filters a reader of a page starts with — its starting filters — which a click that opens it narrows from; none when omitted. */
    readonly startsWith?: ((page: PageKey) => readonly PageFilter[]) | undefined;
    /** The page. */
    readonly children?: ReactNode;
}

/**
 * Holds a page's clicks for its tiles: its selections, read from the UI store
 * under the page's key and written there, and what a click that opens a page
 * does — the clicked group written to that page's filters, from those its
 * reader holds or else starts with, then its host told. While a placement has
 * a selection, Esc clears it: the selection of the tile the key is pressed
 * in, else every selection of the page — never an Esc an open popover, a menu
 * or a field takes for itself.
 *
 * @param props - The page's key, its placements, whether clicks run, who is told a page opens, and what a page's reader starts with
 * @returns The page, its visuals' clicks run
 */
export function PageClicksProvider({ page, cells, live, onOpen, startsWith, children }: PageClicksProviderProps) {
    const [held, write] = useStoredValue(SELECTIONS, studioSelectionsKey(page));
    const selections: ReadonlyMap<string, readonly Clicked[]> = held ?? NO_SELECTIONS;
    const select = useCallback((placement: string, selection: readonly Clicked[]) => {
        const next = new Map(held);
        if (selection.length === 0) next.delete(placement);
        else next.set(placement, [...selection]);
        write(next);
    }, [held, write]);
    const open = useMemo(() => (onOpen === undefined ? undefined : (target: PageKey, filter: PageFilter) => {
        // The target page's filters first — its reader's, else the page's starting filters: it shows the clicked group as
        // a chip, in place of what it held on that source, when its host shows it (LNK-9).
        changeStoredValue(FILTERS, studioFiltersKey(target), (filters) => openedFilters(readerFilters(filters, startsWith?.(target) ?? []), filter));
        onOpen(target);
    }), [onOpen, startsWith]);
    // Esc clears a selection (LNK-2): the tile's the key is pressed in, where it holds one; else every one of the page.
    const some = live && selections.size > 0;
    useEffect(() => {
        if (!some) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            const target = event.target instanceof Element ? event.target : null;
            if (target !== null && target.closest(OWN_ESCAPE) !== null) return;
            const placement = target?.closest<HTMLElement>("[data-studio-placement]")?.dataset["studioPlacement"];
            if (placement !== undefined && (held?.get(placement)?.length ?? 0) > 0) select(placement, []);
            else write(new Map());
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [some, held, select, write]);
    const value = useMemo((): PageClicks => ({ cells, selections, select, live, open }), [cells, selections, select, live, open]);
    return createElement(PageClicksContext.Provider, { value }, children);
}

/**
 * The page's clicks.
 *
 * @returns The clicks; `undefined` outside a page
 */
export function usePageClicks(): PageClicks | undefined {
    return useContext(PageClicksContext) ?? undefined;
}

/**
 * What a tile's clicks do (LNK-1), as its body's parts raise them: by its
 * visual's click, the clicked group becomes its placement's selection, is the
 * filter its click made on the page's filters (#1673), or opens a page; and
 * which groups its parts mark — its selection, or what that filter holds.
 *
 * @param placement - The tile's placement's key; `undefined` for a tile outside a layout
 * @param visual - The visual
 * @returns The clicks: none where clicks do not run, the visual's click is `none`, or it opens a page no one is told of
 */
export function useTileClicks(placement: string | undefined, visual: Visual): VisualClicks {
    const clicks = usePageClicks();
    const filters = usePageFilters();
    const selection = (placement === undefined ? undefined : clicks?.selections.get(placement)) ?? NO_SELECTION;
    // The groups the filter its click made holds: what a visual whose click filters marks, never narrowing to them (#1673).
    const marks = useMemo(() => (visual.click.type !== "filter" || placement === undefined || filters === undefined ? NO_MARKS
        : markedBy(filters.filters, visual.source, placement)), [visual.click.type, visual.source, placement, filters]);
    return useMemo((): VisualClicks => {
        const selected = (groups: readonly ClickedGroup[]) => {
            const clicked = clickedOf(groups);
            if (clicked === undefined) return false;
            return visual.click.type === "select" ? isSelected(selection, clicked) : isMarked(marks, clicked);
        };
        const runs = clicks !== undefined && filters !== undefined && placement !== undefined && clicks.live
            && visual.click.type !== "none" && (visual.click.type !== "open" || clicks.open !== undefined);
        if (!runs) return { onClick: undefined, selected };
        return {
            selected,
            onClick: (groups, add) => {
                const clicked = clickedOf(groups);
                if (clicked === undefined) return;
                const done = clickDone(visual.click, visual.source, clicked, { placement, selection, filters: filters.filters }, add);
                if (done === undefined) return;
                switch (done.type) {
                    case "select": clicks.select(placement, done.selection); break;
                    case "filter": filters.set(done.filters); break;
                    case "open": clicks.open?.(done.page, done.filter); break;
                }
            },
        };
    }, [clicks, filters, placement, visual.click, visual.source, selection, marks]);
}

/**
 * What a tile's visual reads of the visual it follows (LNK-4, LNK-5).
 *
 * @param visual - The visual
 * @returns What it reads of its leader ({@link Following}); `undefined` for a visual that follows none, or outside a page
 */
export function useFollowing(visual: Visual): Following | undefined {
    const clicks = usePageClicks();
    const follow = visual.follow.type === "some" ? visual.follow.value : undefined;
    return useMemo(() => (follow === undefined || clicks === undefined ? undefined : followingOf(follow, clicks.cells, clicks.selections)),
        [follow, clicks]);
}

/**
 * The page's state as a tile's visual reads it: the page's filters on its
 * source (`usePageState`) — all but the one its own click made, whose groups
 * it marks (#1673) — and, for a visual that follows another, its field
 * against what its leader has selected, one more condition every program of
 * it carries (LNK-4).
 *
 * @param visual - The visual
 * @param read - Its source, as the printer reads it; `undefined` for one the surface does not list
 * @param placement - Its placement's key; `undefined` outside a layout, where every filter on its source narrows it
 * @returns The state
 */
export function useTileState(visual: Visual, read: PrintSource | undefined, placement: string | undefined): PrintState {
    const state = usePageState(visual.source, read, placement);
    const following = useFollowing(visual);
    // The condition by its value: a selection made elsewhere on the page leaves this visual's programs as they are.
    const held = useRef<JqNode | undefined>(undefined);
    const next = following?.kind === "selected" ? following.condition : undefined;
    if (next === undefined || held.current === undefined || !sameCondition(held.current, next)) held.current = next;
    const condition = held.current;
    return useMemo(() => withCondition(state, condition), [state, condition]);
}
