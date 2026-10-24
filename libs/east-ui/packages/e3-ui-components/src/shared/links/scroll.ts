/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How far a scroll element has scrolled, followed through its scroll events:
 * what a links layer routes its ends by when the rows it joins scroll inside
 * their pane (Plan's bounded frame, the Allocation's lane grid and resource
 * rows), and what a failure said once in a grid's view sits by (#1398: the
 * Allocation's first row in view, the Calendar's grids' top-left).
 *
 * @packageDocumentation
 */

import { useCallback, useSyncExternalStore, type RefObject } from "react";

/**
 * How far an element has scrolled (see the module docs).
 *
 * @param ref - The scroll element
 * @param active - Whether to follow it at all
 * @returns Its `scrollTop` (0 while inactive)
 */
export function useScrollTop(ref: RefObject<HTMLElement | null>, active: boolean): number {
    return useScrolled(ref, active, "scrollTop");
}

/**
 * How far an element has scrolled sideways: what a failure said at a grid's
 * top-left in view sits by as the grid scrolls (#1398, CL11).
 *
 * @param ref - The scroll element
 * @param active - Whether to follow it at all
 * @returns Its `scrollLeft` (0 while inactive)
 */
export function useScrollLeft(ref: RefObject<HTMLElement | null>, active: boolean): number {
    return useScrolled(ref, active, "scrollLeft");
}

/** One of an element's scroll offsets, followed through its scroll events while active. */
function useScrolled(ref: RefObject<HTMLElement | null>, active: boolean, offset: "scrollTop" | "scrollLeft"): number {
    const subscribe = useCallback((notify: () => void) => {
        const el = ref.current;
        if (!active || el === null) return () => undefined;
        el.addEventListener("scroll", notify, { passive: true });
        return () => el.removeEventListener("scroll", notify);
    }, [ref, active]);
    return useSyncExternalStore(subscribe, () => (active ? ref.current?.[offset] ?? 0 : 0), () => 0);
}
