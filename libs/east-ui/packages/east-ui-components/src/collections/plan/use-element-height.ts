/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The measured client height of an element, tracked through resizes.
 *
 * Exists for the R2 height clamp (#591). v2 sizes the expand-in-place render
 * as `min(renderHeight, canvas − strips − ruler)` — the render takes what the
 * row's declaration asks for, but never so much that the context strips it
 * exists to preserve are pushed out of view.
 *
 * That subtraction needs a real pixel canvas, and the Plan's own `height` /
 * `maxHeight` cannot supply one: they are CSS strings (`"fill"` → `"100%"`,
 * `calc(...)`, a token) resolved by layout, not by us. So the viewport is
 * measured rather than parsed — the scroll element `VirtualRows` hands back
 * through `scrollElRef`.
 *
 * `undefined` until first measure, and while the frame is unbounded (there is
 * no scroll element, the body grows to content, and nothing needs clamping).
 *
 * @packageDocumentation
 */

import { useEffect, useState, type RefObject } from "react";

/**
 * Track an element's `clientHeight`.
 *
 * @param ref - The element to measure (`null` while unmounted / unbounded)
 * @param active - Skip observing entirely when false (no focus, nothing to clamp)
 * @returns The measured height in px, or `undefined` when there is nothing to measure
 */
export function useElementHeight(
    ref: RefObject<HTMLElement | null>,
    active: boolean,
): number | undefined {
    const [px, setPx] = useState<number | undefined>(undefined);
    useEffect(() => {
        if (!active) {
            // Drop the stale reading rather than keep it: a clamp computed
            // against the height the canvas had during the LAST focus would
            // silently mis-size the next one after a resize in between.
            setPx(undefined);
            return;
        }
        const el = ref.current;
        if (el === null) {
            setPx(undefined);
            return;
        }
        // Seed synchronously — the observer's first callback is async, and a
        // frame rendered with `undefined` would size the render unclamped and
        // then jump.
        setPx(el.clientHeight);
        if (typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => setPx(el.clientHeight));
        ro.observe(el);
        return () => ro.disconnect();
        // `ref` is stable; `active` gates the whole effect.
    }, [ref, active]);
    return px;
}
