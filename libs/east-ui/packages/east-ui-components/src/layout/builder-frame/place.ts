/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a builder frame's panes sit (#1125): the rule the frame's `auto`
 * mode keeps, as a pure function of the frame's width, the panes' widths and
 * states, and the room main must keep.
 *
 * A pane is pinned (in the flow, beside main) or overlaid (its rail in the
 * flow, the pane floating over main when open). A pane its host sets
 * `pinned` or `overlay` stays so. An `auto` pane is pinned while main keeps
 * at least `minMain` beside the pinned panes, and overlays otherwise; at
 * {@link NARROW_FRAME} and narrower every `auto` pane overlays, as the design
 * system's app layout overlays its sidebar on a phone.
 *
 * The start pane is placed first. It pins when main would keep its room
 * beside it open, with the end pane as narrow as it can be: the end pane's
 * rail, or its own width when its host pins it. The end pane then pins when
 * main would keep its room beside it open and the start pane as placed —
 * its rail when it overlays or is collapsed, else its width. Each pane is
 * weighed open, whatever its own state, so opening a collapsed pane never
 * moves it between the flow and the overlay; the start pane's state decides
 * how much room the end pane has.
 *
 * Open, a pinned pane is its own width. An overlay pane floats over main from
 * its edge and leaves a strip of main beside it: it is never wider than the
 * frame's width less what the other side keeps in the flow — the other
 * pane's rail, or a pinned pane — less {@link MIN_SCRIM}, so the scrim a tap
 * closes it on always shows, as a phone's drawer leaves one
 * ({@link paneWidths}).
 *
 * @packageDocumentation
 */

/** Where a pane sits: in the flow beside main, or over main. */
export type PanePlacement = "pinned" | "overlay";

/** How a host sets a pane: yielding to main (`auto`), or fixed in the flow or over main. */
export type PaneMode = "auto" | "pinned" | "overlay";

/** A pane, as the frame weighs it. */
export interface PaneWeight {
    /** How its host set it. A pane the frame cannot collapse is `pinned`. */
    readonly mode: PaneMode;
    /** Its width open, in px. */
    readonly open: number;
    /** Its width as a rail, in px: what it keeps in the flow while it overlays, or while it is collapsed. */
    readonly rail: number;
    /** Whether it is collapsed now. */
    readonly collapsed: boolean;
}

/** Where each of a frame's panes sits; a side without a pane has none. */
export interface PanePlacements {
    /** The start pane's place. */
    readonly start: PanePlacement | undefined;
    /** The end pane's place. */
    readonly end: PanePlacement | undefined;
}

/** How wide each of a frame's panes is open, in px; a side without a pane has none. */
export interface PaneWidths {
    /** The start pane's width open. */
    readonly start: number | undefined;
    /** The end pane's width open. */
    readonly end: number | undefined;
}

/** At this width, in px, and narrower, every `auto` pane overlays: the design system's phone. */
export const NARROW_FRAME = 560;

/** The narrowest main may get beside pinned panes before an `auto` pane overlays it, in px, unless the host names another. */
export const MIN_MAIN = 480;

/**
 * The narrowest strip of main an open overlay pane leaves beside it, in px:
 * the scrim a tap closes the pane on, while there is one, as a phone's drawer
 * leaves one (#1125).
 */
export const MIN_SCRIM = 48;

/**
 * The width a pane takes in the flow where it is placed.
 *
 * @param pane - The pane
 * @param placement - Where it sits
 * @returns Its rail's width while it overlays or is collapsed, else its width open
 */
function inFlow(pane: PaneWeight, placement: PanePlacement): number {
    return placement === "overlay" || pane.collapsed ? pane.rail : pane.open;
}

/**
 * Where a frame's panes sit — see the module docs.
 *
 * @param width - The frame's width, in px
 * @param start - The start pane, if the frame has one
 * @param end - The end pane, if the frame has one
 * @param minMain - The narrowest main may get beside pinned panes, in px
 * @returns Each pane's place
 */
export function placePanes(width: number, start: PaneWeight | undefined, end: PaneWeight | undefined, minMain: number = MIN_MAIN): PanePlacements {
    const narrow = width <= NARROW_FRAME;
    let atStart: PanePlacement | undefined;
    if (start !== undefined) {
        if (start.mode !== "auto") atStart = start.mode;
        else if (narrow) atStart = "overlay";
        else {
            const endLeast = end === undefined ? 0 : end.mode === "pinned" ? inFlow(end, "pinned") : end.rail;
            atStart = width - start.open - endLeast >= minMain ? "pinned" : "overlay";
        }
    }
    let atEnd: PanePlacement | undefined;
    if (end !== undefined) {
        if (end.mode !== "auto") atEnd = end.mode;
        else if (narrow) atEnd = "overlay";
        else {
            const startTakes = start === undefined || atStart === undefined ? 0 : inFlow(start, atStart);
            atEnd = width - startTakes - end.open >= minMain ? "pinned" : "overlay";
        }
    }
    return { start: atStart, end: atEnd };
}

/**
 * A pane's width open, where it is placed.
 *
 * @param width - The frame's width, in px
 * @param pane - The pane
 * @param placement - Where it sits
 * @param other - The pane at the other side, if there is one
 * @param otherPlacement - Where that pane sits
 * @returns Its own width when pinned; when it overlays, its own width but at most the frame's width less what the other side keeps in the flow, less {@link MIN_SCRIM}
 */
function openWidth(width: number, pane: PaneWeight, placement: PanePlacement | undefined, other: PaneWeight | undefined, otherPlacement: PanePlacement | undefined): number {
    if (placement !== "overlay") return pane.open;
    const beside = other === undefined ? 0 : inFlow(other, otherPlacement ?? "pinned");
    return Math.max(0, Math.min(pane.open, width - beside - MIN_SCRIM));
}

/**
 * How wide each of a frame's panes is open — see the module docs: a pinned
 * pane its own width; an overlay pane its own width, but never so wide that
 * less than {@link MIN_SCRIM} of main shows beside it.
 *
 * @param width - The frame's width, in px
 * @param start - The start pane, if the frame has one
 * @param end - The end pane, if the frame has one
 * @param placements - Where each pane sits ({@link placePanes})
 * @returns Each pane's width open, in px
 */
export function paneWidths(width: number, start: PaneWeight | undefined, end: PaneWeight | undefined, placements: PanePlacements): PaneWidths {
    return {
        start: start === undefined ? undefined : openWidth(width, start, placements.start, end, placements.end),
        end: end === undefined ? undefined : openWidth(width, end, placements.end, start, placements.start),
    };
}
