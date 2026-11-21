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

/** The side of what it hangs from a popover opens on: under it, or over it. */
export type PopoverSide = "bottom" | "top";

/** The room the page leaves a popover under and over what it hangs from. */
export interface PopoverRoom {
    /** Under it. */
    readonly below: number;
    /** Over it. */
    readonly above: number;
}

/**
 * Where a popover opened inside a builder's frame keeps to (#1393): across the
 * page, the frame's sides while the popover fits between them,
 * {@link POPOVER_OVERFLOW} in from each, and the page's otherwise; down the
 * page, the page's, so it flips above its trigger exactly where it did —
 * unless it holds a side (#1701): then the page on that side of what it hangs
 * from alone, so the flip keeps it there, however its content grows or
 * shrinks while it is open. Outside a frame it is the page's across.
 *
 * Floating UI reads a rect boundary's sides at every placement, so these are
 * read as it asks: the frame's place as the page scrolls, and whether the
 * popover still fits as the frame narrows while it is open. Its first
 * placement can come before the popover shows — its content mounted, still
 * closed — and land after a later one: so whether it fits is weighed by the
 * width its styles give it until it is laid out ({@link popoverWidth}), the same
 * answer every placement gives. Zag copies the positioning a popover is given
 * each time the popover draws, reading these then: a popover passes them as a
 * function it calls as it places, `boundary: () => frameBounds(…)`.
 *
 * @param origin - What the popover hangs from: its trigger or its anchor
 * @param floating - The popover's content, whose width decides whether it fits
 * @param side - The side it holds, read as it places; `undefined`, or not given, for none
 * @returns The bounds, read live
 */
export function frameBounds(origin: () => Element | null, floating: () => HTMLElement | null, side?: () => PopoverSide | undefined): PopoverBounds {
    const across = (): readonly [number, number] => {
        const frame = origin()?.closest("[data-builder-frame]")?.getBoundingClientRect();
        const content = floating();
        const width = content === null ? undefined : popoverWidth(content);
        return frame !== undefined && width !== undefined && width + 2 * POPOVER_OVERFLOW <= frame.width
            ? [frame.left, frame.width]
            : [0, document.documentElement.clientWidth];
    };
    const down = (): readonly [number, number] => {
        const page = document.documentElement.clientHeight;
        const held = side?.();
        const box = held === undefined ? undefined : origin()?.getBoundingClientRect();
        if (held === undefined || box === undefined) return [0, page];
        return held === "top" ? [0, box.bottom] : [box.top, page - box.top];
    };
    return {
        get x() { return across()[0]; },
        get width() { return across()[1]; },
        get y() { return down()[0]; },
        get height() { return down()[1]; },
    };
}

/**
 * The room the page leaves a popover under and over what it hangs from (#1701): from its edges, past the gap the popover
 * keeps from it, to the page's, {@link POPOVER_OVERFLOW} in.
 *
 * @param origin - What it hangs from
 * @param gutter - The gap it keeps from it
 * @returns The room under it and over it, in CSS px
 */
export function roomAround(origin: Element, gutter: number): PopoverRoom {
    const box = origin.getBoundingClientRect();
    return {
        below: document.documentElement.clientHeight - box.bottom - gutter - POPOVER_OVERFLOW,
        above: box.top - gutter - POPOVER_OVERFLOW,
    };
}

/**
 * The side a popover opens on (#1701): under what it hangs from where its own height fits there; else over it, where
 * there is more room; else under it, its body scrolling in the room it has.
 *
 * @param own - Its own height ({@link ownHeight})
 * @param room - The room under it and over it ({@link roomAround})
 * @returns The side
 */
export function sideThatFits(own: number, room: PopoverRoom): PopoverSide {
    return own <= room.below || room.above <= room.below ? "bottom" : "top";
}

/**
 * A popover's own height (#1701): its content's, with no room around what it hangs from to hold it — its own most
 * still its most. Read with its `data-own-height` set, by which its recipe lifts the room's limit, and set back at
 * once, so nothing draws it so.
 *
 * @param content - The popover's content
 * @returns Its height, in CSS px
 */
export function ownHeight(content: HTMLElement): number {
    content.setAttribute("data-own-height", "");
    const height = content.getBoundingClientRect().height;
    content.removeAttribute("data-own-height");
    return height;
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
