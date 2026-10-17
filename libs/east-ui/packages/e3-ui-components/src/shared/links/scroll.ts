/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How far a scroll element has scrolled, followed through its scroll events:
 * what a links layer routes its ends by when the rows it joins scroll inside
 * their pane (Plan's bounded frame, the Allocation's lane grid and resource
 * rows).
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
    const subscribe = useCallback((notify: () => void) => {
        const el = ref.current;
        if (!active || el === null) return () => undefined;
        el.addEventListener("scroll", notify, { passive: true });
        return () => el.removeEventListener("scroll", notify);
    }, [ref, active]);
    return useSyncExternalStore(subscribe, () => (active ? ref.current?.scrollTop ?? 0 : 0), () => 0);
}
