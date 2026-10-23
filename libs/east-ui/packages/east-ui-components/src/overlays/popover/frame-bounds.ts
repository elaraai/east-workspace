/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How far Zag keeps a popover from the side of what bounds it (its
 * positioning's `overflowPadding`, which every popover here leaves at Zag's
 * default).
 */
export const POPOVER_OVERFLOW = 8;

/** A box in the page's client coordinates: what Floating UI takes as a rect boundary. */
export interface PopoverBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/**
 * Where a popover opened inside a builder's frame keeps to (#1393): across the
 * page, the frame's sides while the popover fits between them,
 * {@link POPOVER_OVERFLOW} in from each, and the page's otherwise; down the
 * page, always the page's, so it flips above its trigger exactly where it
 * did. Outside a frame it is the page's both ways.
 *
 * Floating UI reads a rect boundary's sides at every placement, so these are
 * read as it asks: the frame's place as the page scrolls, and whether the
 * popover still fits as the frame narrows while it is open. Its first
 * placement can come before the popover shows — its content mounted, still
 * closed — and land after a later one: so whether it fits is weighed by the
 * width its styles give it until it is laid out ({@link popoverWidth}), the same
 * answer every placement gives.
 *
 * @param origin - What the popover hangs from: its trigger or its anchor
 * @param floating - The popover's content, whose width decides whether it fits
 * @returns The bounds, read live
 */
export function frameBounds(origin: () => Element | null, floating: () => HTMLElement | null): PopoverBounds {
    const across = (): readonly [number, number] => {
        const frame = origin()?.closest("[data-builder-frame]")?.getBoundingClientRect();
        const content = floating();
        const width = content === null ? undefined : popoverWidth(content);
        return frame !== undefined && width !== undefined && width + 2 * POPOVER_OVERFLOW <= frame.width
            ? [frame.left, frame.width]
            : [0, document.documentElement.clientWidth];
    };
    return {
        get x() { return across()[0]; },
        get width() { return across()[1]; },
        get y() { return 0; },
        get height() { return document.documentElement.clientHeight; },
    };
}

/**
 * A popover's width: as it is laid out, or — not shown yet, as when it is first
 * placed — the width its styles give it, no wider than their most; `undefined`
 * for one whose styles give it none, which fits nowhere but the page.
 *
 * @param content - The popover's content
 * @returns Its width, in CSS px
 */
export function popoverWidth(content: HTMLElement): number | undefined {
    if (content.offsetWidth > 0) return content.offsetWidth;
    const style = getComputedStyle(content);
    const width = Number.parseFloat(style.width);
    const most = Number.parseFloat(style.maxWidth);
    if (!Number.isFinite(width)) return undefined;
    return Number.isFinite(most) ? Math.min(width, most) : width;
}
