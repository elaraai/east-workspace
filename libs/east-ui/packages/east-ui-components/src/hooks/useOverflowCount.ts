/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useState, useRef, useLayoutEffect, type RefObject } from "react";

/**
 * Priority+ overflow collapse for a single-row container — the pattern behind
 * "+N more" toolbars (GitHub's nav, Blueprint's `OverflowList`).
 *
 * Render every item in one `nowrap` row (ref returned), each tagged
 * `data-overflow-item`, plus a trailing `data-overflow-rest` cluster (the
 * `+N more` + any always-on actions). The hook measures **once per
 * resize / item-count change**, inside a layout effect before paint:
 *
 *   1. `measuring` flips true and the caller renders *all* items (nothing
 *      collapsed) so every item is in flow.
 *   2. The effect reads each item's right edge against the row width minus the
 *      trailing cluster, finds how many fit, and commits `visibleCount`.
 *
 * No `scrollWidth` shrink-loop, no observer fighting itself, no hidden
 * measuring clone — one read, then collapse. A `ResizeObserver` re-triggers the
 * measure so it re-fits (and re-grows) on container resize.
 *
 * @param count - Number of `data-overflow-item` children.
 * @returns `rowRef` for the row, `visibleCount` (leading items that fit), and
 *          `measuring` (true during the all-items measure pass — render every
 *          item, no collapse, while it's set).
 */
export function useOverflowCount(count: number): {
    rowRef: RefObject<HTMLDivElement | null>;
    visibleCount: number;
    measuring: boolean;
} {
    const rowRef = useRef<HTMLDivElement | null>(null);
    const [visibleCount, setVisibleCount] = useState(count);
    const [measuring, setMeasuring] = useState(true);

    // Re-enter the measure pass whenever the item count changes…
    useLayoutEffect(() => { setMeasuring(true); }, [count]);
    // …or the available space changes. Observe the *parent* (a layout-sized
    // container), never the row itself — the row is shrink-to-fit, so collapsing
    // resizes it and observing it would re-trigger the measure in a loop.
    useLayoutEffect(() => {
        const bound = rowRef.current?.parentElement;
        if (!bound) return;
        const ro = new ResizeObserver(() => setMeasuring(true));
        ro.observe(bound);
        return () => ro.disconnect();
    }, []);

    // While measuring, all items are in flow: read edges, then collapse.
    useLayoutEffect(() => {
        if (!measuring) return;
        const row = rowRef.current;
        if (!row) return;
        const items = Array.from(row.querySelectorAll<HTMLElement>("[data-overflow-item]"));
        // `offsetLeft` is row-relative only when the row is a positioned ancestor.
        const gap = parseFloat(getComputedStyle(row).columnGap || "0") || 0;
        const rest = row.querySelector<HTMLElement>("[data-overflow-rest]");   // +N more + always-on actions
        const keep = row.querySelector<HTMLElement>("[data-overflow-keep]");   // always-on actions only
        const restW = rest ? rest.offsetWidth + gap : 0;
        const keepW = keep ? keep.offsetWidth + gap : 0;
        const last = items[items.length - 1];
        const right = (el: HTMLElement) => el.offsetLeft + el.offsetWidth;
        let n: number;
        if (!last) {
            n = 0;
        } else if (right(last) <= row.clientWidth - keepW + 0.5) {
            // Everything fits beside just the always-on actions — no `+N more`.
            n = items.length;
        } else {
            // Something overflows — reserve the `+N more` chip too, then fit.
            const budget = row.clientWidth - restW;
            n = 0;
            for (const el of items) { if (right(el) <= budget + 0.5) n++; else break; }
        }
        setMeasuring(false);
        setVisibleCount(n);
    });

    return { rowRef, visibleCount, measuring };
}
