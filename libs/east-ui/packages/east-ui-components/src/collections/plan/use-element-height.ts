/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The measured client size of an element, tracked through resizes.
 *
 * The HEIGHT exists for the R2 height clamp (#591). v2 sizes the
 * expand-in-place render as `min(renderHeight, canvas − strips − ruler)` — the
 * render takes what the row's declaration asks for, but never so much that the
 * context strips it exists to preserve are pushed out of view. That
 * subtraction needs a real pixel canvas, and the Plan's own `height` /
 * `maxHeight` cannot supply one: they are CSS strings (`"fill"` → `"100%"`,
 * `calc(...)`, a token) resolved by layout, not by us. So the viewport is
 * measured rather than parsed — the scroll element `VirtualRows` hands back
 * through `scrollElRef`. The links layer reads the same view to clamp its
 * ribbons (#818).
 *
 * The WIDTH is the links layer's (#818): a ribbon's x is a run's window
 * fraction across the plot, and the plot's px are the layer's width less the
 * grid's fixed tracks.
 *
 * `undefined` until first measure, and while the element is absent (an
 * unbounded frame has no scroll element — the body grows to content, and
 * nothing needs clamping).
 *
 * @packageDocumentation
 */

import { useEffect, useState, type RefObject } from "react";

const heightOf = (el: HTMLElement): number => el.clientHeight;
const widthOf = (el: HTMLElement): number => el.clientWidth;

/**
 * Track one client dimension of an element.
 *
 * @param ref - The element to measure
 * @param active - Skip observing entirely when false
 * @param read - The dimension
 * @returns The measured px, or `undefined` when there is nothing to measure
 */
function useClientSize(
    ref: RefObject<HTMLElement | null>,
    active: boolean,
    read: (el: HTMLElement) => number,
): number | undefined {
    const [px, setPx] = useState<number | undefined>(undefined);
    // A PASSIVE effect, deliberately: a layout effect's `setPx` schedules a
    // nested commit even when the value is unchanged (the #815 lesson), and
    // the reading's consumers — a focus, the links layer — open on a click,
    // whose effects React flushes before the frame paints anyway.
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
        // Seed synchronously — the observer's first callback is async.
        setPx(read(el));
        if (typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => setPx(read(el)));
        ro.observe(el);
        return () => ro.disconnect();
        // `ref` is stable and `read` a module constant; `active` gates the whole effect.
    }, [ref, active, read]);
    return px;
}

/**
 * Track an element's `clientHeight`.
 *
 * @param ref - The element to measure (`null` while unmounted / unbounded)
 * @param active - Skip observing entirely when false (no focus, nothing to clamp)
 * @returns The measured height in px, or `undefined` when there is nothing to measure
 */
export function useElementHeight(ref: RefObject<HTMLElement | null>, active: boolean): number | undefined {
    return useClientSize(ref, active, heightOf);
}

/**
 * Track an element's `clientWidth`.
 *
 * @param ref - The element to measure
 * @param active - Skip observing entirely when false
 * @returns The measured width in px, or `undefined` when there is nothing to measure
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>, active: boolean): number | undefined {
    return useClientSize(ref, active, widthOf);
}
