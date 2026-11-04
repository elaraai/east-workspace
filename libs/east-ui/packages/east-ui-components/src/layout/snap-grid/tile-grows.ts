/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A fixed height set for a wide row, where the tile stacks on a phone: the
 * content takes more lines there, and the height would cut it (`Studio Mobile
 * Spec.md` ST39, words whole). Measured before paint and as the content moves:
 * while what it holds is taller than the height, the tile takes its content's.
 * A tile whose content fills the height it is given, a chart's, never does.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * A stacked tile's height, given way to what it holds.
 *
 * @param fixed - The tile's height, when it has one
 * @param stacked - Whether the tile is stacked: asked of its element as it measures
 * @returns The ref its element takes, and the height to draw it at
 */
export function useTileGrows<E extends HTMLElement>(fixed: number | undefined, stacked: (el: E) => boolean): { ref: RefObject<E | null>; height: number | undefined } {
    const ref = useRef<E | null>(null);
    const [grown, setGrown] = useState(false);
    const asks = useRef(stacked);
    asks.current = stacked;
    useLayoutEffect(() => {
        setGrown(false);
        const el = ref.current;
        if (fixed === undefined || el === null) return undefined;
        const check = () => {
            // Past the rounding of the box: never for a part of a pixel.
            if (el.scrollHeight > el.clientHeight + 1 && asks.current(el)) setGrown(true);
        };
        check();
        if (typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(check);
        ro.observe(el);
        for (const child of el.children) ro.observe(child);
        return () => ro.disconnect();
    }, [fixed]);
    return { ref, height: grown ? undefined : fixed };
}
