/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas controller's React face (#815): the context every part of the
 * canvas reaches it through, and the selectors that subscribe a component to
 * exactly the slice of state it reads — so a row re-renders when ITS state
 * moves, and a selection click renders two rows, not the canvas.
 *
 * @packageDocumentation
 */

import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from "react";
import type { RowKey } from "../plan-state.js";
import { rowItemKey } from "../body-items.js";
import type { PlanController, PlanSnapshot } from "./index.js";

/** The canvas's controller, provided once by the canvas root. */
export const PlanControllerContext = createContext<PlanController | null>(null);

/**
 * The canvas's controller — throws outside a Plan (its parts are
 * canvas-internal; there is no standalone mounting).
 *
 * @returns The controller
 */
export function usePlanController(): PlanController {
    const controller = useContext(PlanControllerContext);
    if (controller === null) throw new Error("[Plan] rendered outside its controller");
    return controller;
}

/**
 * Subscribe to one slice of a controller's state.
 *
 * @remarks
 * The selection is cached per snapshot, and kept by IDENTITY while `isEqual`
 * says it did not change — so a component re-renders only when its own slice
 * moved, whatever else the notification carried. `select` may be a fresh
 * closure each render; it is re-applied, and an equal result keeps the old
 * identity.
 *
 * The canvas root, which provides the controller, selects through this;
 * everything beneath it uses {@link usePlanSelector}.
 *
 * @typeParam T - The selected slice
 * @param controller - The controller
 * @param select - Reads the slice from a snapshot
 * @param isEqual - Whether two selections are the same (default `Object.is`)
 * @returns The selected slice
 */
export function useControllerSelector<T>(
    controller: PlanController,
    select: (s: PlanSnapshot) => T,
    isEqual: (a: T, b: T) => boolean = Object.is,
): T {
    const cache = useRef<{ snap: PlanSnapshot; select: (s: PlanSnapshot) => T; value: T } | null>(null);
    const getSelection = (): T => {
        const snap = controller.getSnapshot();
        const prev = cache.current;
        if (prev !== null && prev.snap === snap && prev.select === select) return prev.value;
        const next = select(snap);
        const value = prev !== null && isEqual(prev.value, next) ? prev.value : next;
        cache.current = { snap, select, value };
        return value;
    };
    return useSyncExternalStore(controller.subscribe, getSelection, getSelection);
}

/**
 * Subscribe to one slice of the canvas controller's state — see
 * {@link useControllerSelector}.
 *
 * @typeParam T - The selected slice
 * @param select - Reads the slice from a snapshot
 * @param isEqual - Whether two selections are the same (default `Object.is`)
 * @returns The selected slice
 */
export function usePlanSelector<T>(select: (s: PlanSnapshot) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
    return useControllerSelector(usePlanController(), select, isEqual);
}

/** One grid item's keyboard facts (#819). */
export interface PlanItemNav {
    /** The item holds the canvas's one tab stop. */
    active: boolean;
    /** A pending keyboard move onto the item (its request's number), or 0. */
    focusSeq: number;
}

const sameItemNav = (a: PlanItemNav, b: PlanItemNav): boolean =>
    a.active === b.active && a.focusSeq === b.focusSeq;

/** An item's keyboard facts in a snapshot. */
function itemNavOf(s: PlanSnapshot, itemKey: string): PlanItemNav {
    return {
        active: s.nav.active === itemKey,
        focusSeq: s.nav.request !== null && s.nav.request.key === itemKey ? s.nav.request.seq : 0,
    };
}

/** One body row's own slice of the UI state. */
export interface PlanRowState extends PlanItemNav {
    /** The row is the selection. */
    selected: boolean;
    /** The user toggled this chart row to expanded. */
    chartExpanded: boolean;
    /** Which of the row's focus controls is the active focus, if any. */
    activeControl: "links" | "expand" | undefined;
}

const sameRowState = (a: PlanRowState, b: PlanRowState): boolean =>
    a.selected === b.selected && a.chartExpanded === b.chartExpanded && a.activeControl === b.activeControl
    && sameItemNav(a, b);

/**
 * A body row's own UI facts — the row re-renders when THESE change, never on
 * another row's selection, toggle or tab stop.
 *
 * @param key - The row key
 * @returns The row's state
 */
export function usePlanRowState(key: RowKey): PlanRowState {
    const select = useCallback((s: PlanSnapshot): PlanRowState => {
        const ui = s.store.ui;
        return {
            selected: ui.selected === key,
            chartExpanded: ui.chartsExpanded.has(key),
            activeControl: ui.focus !== null && ui.focus.key === key ? ui.focus.kind : undefined,
            ...itemNavOf(s, rowItemKey(key)),
        };
    }, [key]);
    return usePlanSelector(select, sameRowState);
}

/**
 * A non-row grid item's keyboard facts (#819) — a gap band, a window band, a
 * failed window: whether it holds the tab stop, and a keyboard move onto it.
 *
 * @param itemKey - The item's `bodyItemKey`
 * @returns Its keyboard facts
 */
export function usePlanItemNav(itemKey: string): PlanItemNav {
    const select = useCallback((s: PlanSnapshot): PlanItemNav => itemNavOf(s, itemKey), [itemKey]);
    return usePlanSelector(select, sameItemNav);
}
