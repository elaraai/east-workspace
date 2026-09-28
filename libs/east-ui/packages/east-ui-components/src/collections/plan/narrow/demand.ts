/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The narrow list's side of paged demand (#812) — the list has no virtualizer
 * to report a mounted range, so its cards report themselves (split out of
 * `narrow/index.tsx`, #815).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useRef } from "react";
import type { PlanBand } from "../model.js";
import type { RowKey } from "../plan-state.js";

/** How the narrow list drives a paged source (#812). */
export interface PlanNarrowPaging {
    /** The unloaded run after the resident rows, when there is one. */
    tail: PlanBand | undefined;
    /** Whether a window is in flight. */
    loading: boolean;
    /** Where the list is — the last row card on screen. */
    onViewport: (key: RowKey) => void;
    /** Demand the window after the resident run. */
    onLoadMore: () => void;
}

/** The latest of a set of elements in document order. */
function lastInOrder(elements: ReadonlySet<Element>): Element | undefined {
    let last: Element | undefined;
    for (const el of elements) {
        if (last === undefined || (last.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) last = el;
    }
    return last;
}

/**
 * The list's side of paged demand (#812): one `IntersectionObserver` for the
 * whole list, which every row card and the load-more card enrol in through
 * the returned ref. Whenever what is on screen changes, the LAST row card
 * visible is reported as the viewport; the load-more card coming into view
 * demands the next window. (A report that names the window the driver is
 * already on changes no state, so scrolling within a window re-renders
 * nothing.)
 *
 * @param paging - The paged demand, or `undefined` on an inline canvas
 * @returns The ref an observed element takes — `undefined` when there is
 *   nothing to demand, or no `IntersectionObserver` to demand it with
 */
export function useListDemand(paging: PlanNarrowPaging | undefined): ((el: HTMLElement | null) => (() => void) | undefined) | undefined {
    const latest = useRef(paging);
    latest.current = paging;
    const observer = useRef<{ io: IntersectionObserver; visible: Set<Element> } | null>(null);
    useEffect(() => () => {
        observer.current?.io.disconnect();
        observer.current = null;
    }, []);
    const watch = useCallback((el: HTMLElement | null): (() => void) | undefined => {
        if (el === null) return undefined;
        let o = observer.current;
        if (o === null) {
            const visible = new Set<Element>();
            const io = new IntersectionObserver((entries) => {
                let reachedEnd = false;
                for (const entry of entries) {
                    if (entry.target.hasAttribute("data-plan-more")) {
                        reachedEnd ||= entry.isIntersecting;
                        continue;
                    }
                    if (entry.isIntersecting) visible.add(entry.target);
                    else visible.delete(entry.target);
                }
                const demand = latest.current;
                if (demand === undefined) return;
                const key = lastInOrder(visible)?.getAttribute("data-plan-card");
                if (key !== null && key !== undefined) demand.onViewport(key);
                if (reachedEnd) demand.onLoadMore();
            });
            o = { io, visible };
            observer.current = o;
        }
        const { io, visible } = o;
        io.observe(el);
        return () => {
            io.unobserve(el);
            visible.delete(el);
        };
    }, []);
    return paging !== undefined && typeof IntersectionObserver !== "undefined" ? watch : undefined;
}
