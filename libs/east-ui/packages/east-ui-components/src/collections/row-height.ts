/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A mounted row's height, as a virtualizer places rows by it: the Table's, the
 * Library's and the shared rows frame's (`virtual-rows.tsx`).
 *
 * A row's place is the sum of the heights above it, in the layout's own
 * pixels. Its drawn box (`getBoundingClientRect`) is those pixels only while
 * no ancestor draws it under a transform: in a popover on its way in — drawn
 * at 95% of its size as it mounts — or on a zoomed canvas, the drawn box is
 * the row scaled, and rows placed by it stand that much short, each over the
 * next. They stay so once the popover is in: a virtualizer measures a row
 * again only when its size changes, and a transform ending changes no size.
 *
 * The layout's own height is what the virtualizer's resize observer reports
 * (`borderBoxSize`, which no transform touches). It reports as it first
 * observes a row — after the row mounts, before the page next paints — so a
 * row measured as it mounts, with no report yet, is measured by its drawn box,
 * and by its layout box from that report on.
 *
 * It imports neither React nor the renderers.
 *
 * @packageDocumentation
 */

/**
 * How far a row's drawn box may stand from its layout box and still be that
 * box: twice the 1/64 px grid a page is laid out on. Within it the drawn
 * height is the one kept, so a row no transform touches measures as it always
 * has, to the last fraction; past it the row is drawn under a transform.
 */
const LAYOUT_SLACK = 1 / 32;

/**
 * A mounted row's height, in the layout's own pixels: its drawn height — or,
 * where its virtualizer's resize observer reports a layout box that is not
 * the drawn one, an ancestor's transform scaling it, the layout's.
 *
 * @param el - The row's element
 * @param entry - What the virtualizer's resize observer reports of it; `undefined` as the row mounts, before any report
 * @returns Its height in CSS pixels
 *
 * @example
 * ```ts
 * const virtualizer = useVirtualizer({
 *     count, getScrollElement, estimateSize,
 *     measureElement: (el, entry, instance) => sizeWhileHidden(el, instance) ?? rowLayoutHeight(el, entry),
 * });
 * ```
 */
export function rowLayoutHeight(el: Element, entry: ResizeObserverEntry | undefined): number {
    const drawn = el.getBoundingClientRect().height;
    // An engine before `borderBoxSize`, or a test's stand-in for the observer, reports none.
    const laid = (entry?.borderBoxSize as readonly ResizeObserverSize[] | undefined)?.[0]?.blockSize;
    return laid !== undefined && Math.abs(drawn - laid) > LAYOUT_SLACK ? laid : drawn;
}
