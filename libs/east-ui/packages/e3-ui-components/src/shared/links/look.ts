/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The links' look's measures (`Plan links.html`, #1258), one set for both of
 * the surfaces that draw links: the SVG layer (`layer.tsx`) the Plan's and the
 * Allocation's links draw on, and the Canvas2D painter (`canvas.ts`) the
 * Schematic's links and nets draw through (#1403) — so the three builders'
 * links draw alike. The routing (`geometry.ts`) turns its corners and lays its
 * heads by them too. Their colours and their caption's font are the theme's
 * `linkRibbons` part's, never these. Pure: no React, no DOM.
 *
 * @packageDocumentation
 */

/** The paper either side of a link's ink: its casing (px). */
export const LINK_CASING = 1;

/** How far beyond a link's stroke its hit area reaches, each side (px). */
export const LINK_HIT_REACH = 5;

/** A head's length along the flow (px). */
export const LINK_HEAD_LEN = 8;

/**
 * How far a head reaches either side of the flow: it is max(8, 2 × weight)
 * wide.
 *
 * @param weight - The link's weight: its stroke's width
 * @returns Half the head's width, in px
 */
export function linkHeadHalf(weight: number): number {
    return Math.max(LINK_HEAD_LEN, 2 * weight) / 2;
}

/** The radius every link turns its corners at, before its clamp to half of each run beside it (px). */
export const LINK_CORNER = 8;

/** A caption's knockout: its height (px). */
export const LINK_KNOCKOUT_H = 12;

/** The paper either side of a caption's text on its knockout (px). */
export const LINK_KNOCKOUT_PAD = 4;

/** How far above a caption's baseline its knockout starts (px). */
export const LINK_KNOCKOUT_RISE = 9.5;

/** How far below the point a caption is centred on its baseline sits: a 10px label's middle (px). */
export const LINK_CAPTION_DROP = 3;

/** How far outside an end a lit link joins its ring is drawn: the middle of its 1px line (px). */
export const LINK_HALO_OUT = 4.5;

/** A ring's corner round an end with corners: an end's own, four out (px). */
export const LINK_HALO_R = 7.5;
