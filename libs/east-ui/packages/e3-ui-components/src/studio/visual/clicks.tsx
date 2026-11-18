/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A visual's clicks, as its body's parts raise them (#1673, CHT-8, TBL-6,
 * LST-3): its tile gives them what a click on a group does and whether a
 * group is selected ({@link VisualClicksProvider}); a chart's mark, a table's
 * row or cell and a list's row tell it the groups they stand for. What the
 * click does — select, filter, open — is the tile's, by the rules in
 * `query/visual/clicks.ts`; a part only says what was clicked.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import type { ClickedGroup } from "../../query/visual/clicks.js";

/**
 * What a visual's parts raise their clicks through.
 *
 * @property onClick - Tells a click on the groups a mark, a row or a cell stands for; `undefined` where a click does nothing
 * @property selected - Whether the groups are in the placement's selection
 */
export interface VisualClicks {
    /** Tells a click on the groups a mark, a row or a cell stands for, and whether it adds to a selection (⌘-click); `undefined` where a click does nothing. */
    readonly onClick: ((groups: readonly ClickedGroup[], add: boolean) => void) | undefined;
    /** Whether the groups are in the placement's selection. */
    readonly selected: (groups: readonly ClickedGroup[]) => boolean;
}

/** No clicks: a visual outside a page, and one whose click does nothing. */
const NO_CLICKS: VisualClicks = { onClick: undefined, selected: () => false };

const VisualClicksContext = createContext<VisualClicks>(NO_CLICKS);

/** Gives a visual's body what its clicks do. */
export const VisualClicksProvider = VisualClicksContext.Provider;

/**
 * What a click on the visual's groups does.
 *
 * @returns The clicks; none outside a tile that gives them
 */
export function useVisualClicks(): VisualClicks {
    return useContext(VisualClicksContext);
}

/**
 * Whether a row of a part's — by what the part knows it by — is in the
 * placement's selection: what a Table marks its rows by.
 *
 * @typeParam K - What the part knows a row by: its index
 * @param clicked - The groups a row stands for; `undefined` for a row of none
 * @returns Whether the row is selected; stable while the selection and the rows are
 */
export function useMarked<K>(clicked: ((row: K) => readonly ClickedGroup[] | undefined) | undefined): (row: K) => boolean {
    const selected = useVisualClicks().selected;
    return useMemo(() => (row: K) => {
        const groups = clicked?.(row);
        return groups !== undefined && selected(groups);
    }, [clicked, selected]);
}

/** Whether a click adds to a selection: ⌘ on a Mac, Ctrl elsewhere. */
function adds(event: { readonly metaKey: boolean; readonly ctrlKey: boolean }): boolean {
    return event.metaKey || event.ctrlKey;
}

/**
 * What makes a row of a visual's own a button that raises its click: its
 * role, its place in the tab order, its click and its Enter or Space, and
 * whether it is selected. Nothing where a click does nothing, or the row
 * stands for no group.
 *
 * @param clicks - The visual's clicks
 * @param groups - The groups the row stands for; `undefined` for a row of none
 * @returns The row's props
 */
export function rowClickProps(clicks: VisualClicks, groups: readonly ClickedGroup[] | undefined) {
    const onClick = clicks.onClick;
    if (onClick === undefined || groups === undefined) return {};
    const selected = clicks.selected(groups);
    return {
        role: "button",
        tabIndex: 0,
        "data-clickable": "",
        "aria-pressed": selected,
        ...(selected ? { "data-selected": "" } : {}),
        onClick: (event: MouseEvent) => { onClick(groups, adds(event)); },
        onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onClick(groups, adds(event));
        },
    } as const;
}

/**
 * A visual's clicks, for a part whose renderer tells a click with no event —
 * a chart's mark, a Table's row, a Matrix's cell: the part's box notes each
 * click's modifier as it passes down ({@link GroupClicks.onClickCapture}),
 * and the renderer's callback, told in the same turn, raises the groups it
 * stands for with it.
 */
export interface GroupClicks {
    /** Tells a click on the groups a mark, a row or a cell stands for — nothing for one of no group; `undefined` where a click does nothing. */
    readonly raise: ((groups: readonly ClickedGroup[] | undefined) => void) | undefined;
    /** The part's box's capture handler: it notes whether the click adds to a selection. */
    readonly onClickCapture: (event: MouseEvent) => void;
}

/**
 * A visual's clicks, for a part whose renderer tells a click with no event.
 *
 * @returns What raises a click's groups, and the box's capture handler
 */
export function useGroupClicks(): GroupClicks {
    const onClick = useVisualClicks().onClick;
    const held = useRef(false);
    return useMemo((): GroupClicks => ({
        raise: onClick === undefined ? undefined : (groups) => {
            if (groups !== undefined) onClick(groups, held.current);
        },
        onClickCapture: (event) => { held.current = adds(event); },
    }), [onClick]);
}
