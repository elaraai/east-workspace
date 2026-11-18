/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A tile's height on the canvas: how its frame takes the height it is given,
 * and how its content's own height is read.
 *
 * A tile given a height stands at it — except one that stretches, which is as
 * tall as its row: its height is then the least it takes, so a taller tile
 * beside it carries it along, frame and content ({@link frameHeight}).
 *
 * A tile's content's own height is where a height drag stops, and returns the
 * tile to its content's as it nears it (`heightAt`, L9). It is read from the
 * frame with its height let go for the read ({@link contentHeight}): a frame
 * with a height stands at that height, and one its row stretches stands at
 * the row's, so neither says what the content alone takes. Read as it stands,
 * a tile that has had a height since it was drawn would hold every shorter
 * height off — its own height its floor — and could only fall back to its
 * content's.
 *
 * @packageDocumentation
 */

import type { CSSProperties } from "react";

/**
 * Marks a frame held to a least height — a stretched tile's. The recipe gives
 * its content no height of its own there, so the tile adds its least height
 * to its row's, never what it holds, and its content fills whatever height the
 * row leaves it.
 */
export const LEAST_HEIGHT = "data-least-height";

/** How a tile's frame takes its height: the inline style, and whether it is a least height. */
export interface FrameHeight {
    /** The frame's inline style; `undefined` for a tile with no height of its own. */
    readonly style: CSSProperties | undefined;
    /** Whether the height is the least it takes — the frame is marked {@link LEAST_HEIGHT}. */
    readonly least: boolean;
}

const AUTO: FrameHeight = { style: undefined, least: false };

/**
 * How a tile's frame takes the height it is given.
 *
 * @param height - The tile's height in px; `undefined` or `null` for its content's own
 * @param stretched - Whether the tile stretches to its row
 * @returns The frame's inline style, and whether the height is a least height
 */
export function frameHeight(height: number | null | undefined, stretched: boolean): FrameHeight {
    if (height === null || height === undefined) return AUTO;
    return stretched ? { style: { minHeight: `${height}px` }, least: true } : { style: { height: `${height}px` }, least: false };
}

/**
 * The height a tile's frame takes from its content alone.
 *
 * @param frame - The tile's frame: the element that takes the tile's height
 * @returns Its content's own height, in layout px
 *
 * @remarks
 * The frame's height, its least height and its {@link LEAST_HEIGHT} mark are
 * let go for one read and put back before the page paints: nothing is drawn
 * at the height read.
 */
export function contentHeight(frame: HTMLElement): number {
    const { height, minHeight } = frame.style;
    const least = frame.hasAttribute(LEAST_HEIGHT);
    frame.style.height = "auto";
    frame.style.minHeight = "0";
    frame.removeAttribute(LEAST_HEIGHT);
    const own = frame.offsetHeight;
    frame.style.height = height;
    frame.style.minHeight = minHeight;
    if (least) frame.setAttribute(LEAST_HEIGHT, "");
    return own;
}
