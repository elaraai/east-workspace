/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useState, useRef, useLayoutEffect, type RefObject } from "react";

/**
 * Reflow a single-row layout to a stacked one when it no longer fits — the
 * "toolbar → wrap to rows" decision, done as a clean measure pass rather than a
 * shrink loop.
 *
 * Spread `rowRef` on the row. While `stacked` is `false` the caller lays its
 * children out in one `nowrap` row that clips (`overflow: hidden`); the hook
 * measures that row once per resize / content change — if it overflows, it
 * flips `stacked` to `true` and the caller switches to a column. Because the
 * measure always happens in the one-row arrangement, it re-evaluates cleanly on
 * resize (and re-collapses back to a row when the container grows again).
 *
 * The `ResizeObserver` watches the row's *parent* (a layout-sized container),
 * never the row itself — the row's width changes when it stacks, so observing it
 * would loop.
 *
 * @param signature - Changes whenever the children change (re-triggers measure).
 * @returns `rowRef` for the row, and `stacked` — `true` when the row overflowed.
 */
export function useReflow(signature: string): {
    rowRef: RefObject<HTMLDivElement | null>;
    stacked: boolean;
} {
    const rowRef = useRef<HTMLDivElement | null>(null);
    const [stacked, setStacked] = useState(false);
    const [measuring, setMeasuring] = useState(true);

    useLayoutEffect(() => { setMeasuring(true); }, [signature]);
    useLayoutEffect(() => {
        const bound = rowRef.current?.parentElement;
        if (!bound) return;
        const ro = new ResizeObserver(() => setMeasuring(true));
        ro.observe(bound);
        return () => ro.disconnect();
    }, []);
    useLayoutEffect(() => {
        if (!measuring) return;
        const row = rowRef.current;
        if (!row) return;
        const overflow = row.scrollWidth > row.clientWidth + 0.5;
        setMeasuring(false);
        setStacked(overflow);
    });

    // While measuring we render in one row (to test the fit), so the caller
    // should lay out inline whenever `measuring || !stacked`.
    return { rowRef, stacked: stacked && !measuring };
}
