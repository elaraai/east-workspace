/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas as a treegrid (#819) — the plumbing every grid row shares: where
 * the row sits in the grid (`aria-rowindex`), the canvas's ONE tab stop, and
 * the keyboard's moves of DOM focus.
 *
 * # A row's position is written, not rendered
 *
 * `aria-rowindex` is a row's place among ALL the grid's rows — the ones the
 * virtualizer has not mounted, and the bands standing for a paged source's
 * unloaded runs, included. Rendered as a prop, every row below a collapse or
 * a window landing at the head would re-render only to renumber itself, which
 * is exactly the store-change tax the row memo removed (#616, #815). So the
 * canvas publishes every item's position to a small store, and each row
 * writes its own attribute straight to the DOM when its number moves — the
 * `#609` cursor's discipline: direct DOM writes, zero renders.
 *
 * # One tab stop
 *
 * The row holding the tab stop (`nav.active`) is `tabIndex=0`, every other row
 * `-1`. A row that holds it takes the grid element OUT of the tab order while
 * it is mounted, and puts it back when it unmounts — so when the active row is
 * scrolled out of the virtualizer's window, or has not been chosen yet, the
 * grid itself is the stop, and focusing it hands focus on to a row.
 *
 * @packageDocumentation
 */

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { PlanControllerContext } from "../controller/react.js";

/** Every grid item's 1-based `aria-rowindex`, by item key — read by the rows. */
export interface PlanRowPositions {
    /** The position of an item (`bodyItemKey`), when it is in the grid. */
    of(key: string): number | undefined;
    /** Listen for the positions moving. */
    subscribe(listener: () => void): () => void;
}

/** The canvas's side of {@link PlanRowPositions} — it publishes them. */
export interface PlanRowPositionStore extends PlanRowPositions {
    /** Publish the positions — every mounted row rewrites its own. */
    set(next: ReadonlyMap<string, number>): void;
}

/**
 * A position store — created once per canvas.
 *
 * @returns An empty store
 */
export function createRowPositions(): PlanRowPositionStore {
    let map: ReadonlyMap<string, number> = new Map();
    const listeners = new Set<() => void>();
    return {
        of: (key) => map.get(key),
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        set(next) {
            if (next === map) return;
            map = next;
            for (const listener of [...listeners]) listener();
        },
    };
}

/** What every grid row of a canvas shares. */
export interface PlanGridContextValue {
    /** Where each item sits in the grid. */
    positions: PlanRowPositions;
    /** The treegrid element — the tab stop while no mounted row holds it. */
    gridRef: RefObject<HTMLElement | null>;
}

/** The canvas's grid, provided once by the canvas root. */
export const PlanGridContext = createContext<PlanGridContextValue | null>(null);

/** What a grid row puts on its element. */
export interface PlanGridRow {
    /** The row element's ref — its position is written onto it. */
    ref: (el: HTMLElement | null) => void;
    /** Focus inside the row: it holds the tab stop now. */
    onFocus: () => void;
    /** `0` on the row holding the tab stop, `-1` on every other. */
    tabIndex: 0 | -1;
}

/**
 * A grid row's plumbing — its written `aria-rowindex`, its share of the tab
 * stop, and its answer to a keyboard move onto it.
 *
 * @param itemKey - The row's `bodyItemKey`
 * @param active - Whether it holds the tab stop
 * @param focusSeq - A pending keyboard move onto it (its request's number), or 0
 * @returns What to put on the row element
 */
export function usePlanGridRow(itemKey: string, active: boolean, focusSeq: number): PlanGridRow {
    const grid = useContext(PlanGridContext);
    const controller = useContext(PlanControllerContext);
    const elRef = useRef<HTMLElement | null>(null);
    const activeRef = useRef(active);
    // The row's position onto its element, and — while it holds the tab stop
    // — the grid out of the tab order. Both are re-applied whenever the canvas
    // publishes, which is after every change to the body: the frame may have
    // swapped its rows' container for a new element (crossing its
    // virtualization threshold), and a new container starts as a tab stop.
    const sync = useCallback(() => {
        const el = elRef.current;
        if (el === null || grid === null) return;
        const at = grid.positions.of(itemKey);
        const want = at !== undefined ? String(at) : null;
        if (el.getAttribute("aria-rowindex") !== want) {
            if (want === null) el.removeAttribute("aria-rowindex");
            else el.setAttribute("aria-rowindex", want);
        }
        const gridEl = grid.gridRef.current;
        if (activeRef.current && gridEl !== null && gridEl.tabIndex !== -1) gridEl.tabIndex = -1;
    }, [grid, itemKey]);
    const ref = useCallback((el: HTMLElement | null) => {
        elRef.current = el;
        if (el !== null) sync();
    }, [sync]);
    // Before paint — and again whenever the canvas publishes.
    useLayoutEffect(() => {
        sync();
        return grid?.positions.subscribe(sync);
    }, [grid, sync]);
    // Taking the tab stop, and handing it back to the grid when this row
    // gives it up — or unmounts, scrolled out of the virtualizer's window.
    useLayoutEffect(() => {
        activeRef.current = active;
        if (!active) return undefined;
        sync();
        return () => {
            const gridEl = grid?.gridRef.current;
            if (gridEl !== null && gridEl !== undefined) gridEl.tabIndex = 0;
        };
    }, [active, grid, sync]);
    // A keyboard move onto this row: take focus once mounted, and say so —
    // so a later remount does not take it again.
    useEffect(() => {
        if (focusSeq === 0) return;
        elRef.current?.focus({ preventScroll: true });
        controller?.focusDone(focusSeq);
    }, [focusSeq, controller]);
    const onFocus = useCallback(() => controller?.itemFocused(itemKey), [controller, itemKey]);
    return { ref, onFocus, tabIndex: active ? 0 : -1 };
}
