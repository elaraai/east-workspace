/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A face's capitals at the middle of a room: a bar's words, each at its own
 * size, as many rows of the room over their capitals as under them
 * (east-workspace#1748).
 *
 * A line of words centred in a room (`centredLine`, #1638) stands its line's
 * box at the room's middle, a whole number of pixels under its edge. Where a
 * face's capitals stand inside that box is the face's own: a browser lays the
 * line out by the face's ascent and descent, each rounded to the pixel, and
 * the capitals stand on the baseline, under the ascent. Inter Tight at 12.5px
 * rises 12 rows over its baseline and falls 3 under it, and its capitals take
 * 9: centred in its line, they are centred in the room. Chivo Mono at 10px
 * rises 9 and falls 3, but its capitals take 7. Its line's middle stands 1.5
 * rows under its capitals' middle, which a whole line can only leave a row
 * high: the strip's label stood 11 rows under the rule and 13 over the foot,
 * beside words standing 11 and 11.
 *
 * {@link centredCapitals} stands a face's capitals at the middle of the rooms
 * a part is centred in: its line is the face's own ascent and descent, with
 * the rows the capitals lack over or under them as padding, and it is refused
 * as the theme is built where no whole number of rows centres them — an even
 * number of rows of capitals in an odd room, or an odd number in an even one.
 * {@link capitalsBox} does the same for a box of a height of its own, a chip.
 * The rows come from the faces' own units (`FACE_METRICS`), which the font
 * files hold; `face-capitals.test.ts` reads the files to hold them to it.
 *
 * @packageDocumentation
 */

import { tokens } from "./tokens.js";

/** A face of the theme: its token in `fonts`. */
export type FaceName = "heading" | "body" | "mono";

/** A size of the theme's scale a face is set at: its token in `fontSizes`. */
export type FaceSize = "label.xs" | "label.sm" | "label.md" | "label.lg" | "body.sm" | "body" | "body.lg";

/**
 * A face's vertical metrics, in the units of its em: its typographic ascender and descender (its OS/2 table's,
 * which the face says to use, and its `hhea` table's the same), and the height of its capitals.
 */
export interface FaceMetrics {
    /** The units in its em. */
    readonly unitsPerEm: number;
    /** How far over the baseline its line reaches. */
    readonly ascender: number;
    /** How far under the baseline its line reaches. */
    readonly descender: number;
    /** How tall its capitals stand. */
    readonly capHeight: number;
}

/**
 * The theme's faces, as their font files hold them (the `@fontsource-variable` packages' latin `wght` files): DM Sans
 * for headings, Inter Tight for running text, Chivo Mono for labels.
 */
export const FACE_METRICS: Readonly<Record<FaceName, FaceMetrics>> = {
    heading: { unitsPerEm: 1000, ascender: 992, descender: 310, capHeight: 700 },
    body: { unitsPerEm: 2048, ascender: 1984, descender: 494, capHeight: 1490 },
    mono: { unitsPerEm: 1000, ascender: 940, descender: 250, capHeight: 686 },
};

/** The rows a face takes at a size: as a browser lays out a line of it, and as it paints its capitals. */
export interface FaceRows {
    /** The rows over the baseline: its ascender at the size, rounded to the pixel. */
    readonly ascent: number;
    /** The rows under the baseline: its descender at the size, rounded to the pixel. */
    readonly descent: number;
    /** The rows its capitals paint: their height at the size, rounded to the pixel. */
    readonly capitals: number;
}

/** The pixels of a size of the theme's scale, as its token holds them. */
export function facePx(size: FaceSize): number {
    const [group, step = "DEFAULT"] = size.split(".") as [string, string?];
    // The scale's groups hold their steps; `num` and `control` hold one value of their own, and no step is named in them.
    const scale = (tokens.fontSizes as unknown as Readonly<Record<string, Readonly<Record<string, { readonly value: string } | undefined>> | undefined>>)[group];
    const value = scale?.[step]?.value;
    if (value === undefined || !/^[\d.]+px$/.test(value)) throw new RangeError(`the theme has no size ${size} in pixels`);
    return Number.parseFloat(value);
}

/**
 * The rows a face takes at a size: its ascent and its descent as a browser rounds them to lay out a line of it, and
 * the rows its capitals paint.
 *
 * @param face - The face
 * @param size - Its size, of the theme's scale
 * @returns Its ascent, its descent and its capitals, in whole rows
 *
 * @example
 * ```ts
 * faceRows("mono", "label.sm"); // { ascent: 9, descent: 3, capitals: 7 }
 * ```
 */
export function faceRows(face: FaceName, size: FaceSize): FaceRows {
    const metrics = FACE_METRICS[face];
    const px = facePx(size);
    const rows = (units: number) => Math.round((units * px) / metrics.unitsPerEm);
    return { ascent: rows(metrics.ascender), descent: rows(metrics.descender), capitals: rows(metrics.capHeight) };
}

/** What a part spreads to set its words with their capitals at a room's middle. */
export interface CentredCapitals {
    /** The face. */
    readonly fontFamily: FaceName;
    /** Its size. */
    readonly fontSize: FaceSize;
    /** The face's own line: its ascent and its descent. */
    readonly lineHeight: string;
    /** The rows the capitals lack under them, over the line. */
    readonly paddingTop: string;
    /** The rows the capitals lack over them, under the line. */
    readonly paddingBottom: string;
}

/** The line and the padding that make the face's box hold its capitals at its middle, and the box's height. */
function capitalsLine(face: FaceName, size: FaceSize): { rows: FaceRows; top: number; bottom: number; height: number } {
    const rows = faceRows(face, size);
    // Over the capitals the line leaves its ascent less them, and under them its descent: the difference, padded on
    // the side short of it, leaves as many rows over the capitals as under them.
    const lean = rows.capitals - (rows.ascent - rows.descent);
    const top = Math.max(lean, 0);
    const bottom = Math.max(-lean, 0);
    return { rows, top, bottom, height: rows.ascent + rows.descent + top + bottom };
}

/**
 * The line and the padding that stand a face's capitals at the middle of the rooms a part is centred in
 * (east-workspace#1748): a bar's label, its words and its keys, each in the room under the bar's rule. The part's box
 * is the face's own line, its ascent and its descent, padded by the rows its capitals lack over or under them, so
 * centring the box centres them.
 *
 * @param face - The face
 * @param size - Its size, of the theme's scale
 * @param room - The height the part is centred in, in px — a bar's height less its rule — or every height it is
 *   centred in, where it stands in more than one: a density's, a touch screen's
 * @returns The face, the size, the line and the padding a slot spreads
 * @throws {RangeError} When a room is not a whole number of pixels, or no whole number of rows centres the capitals in
 *   it: their rows and the room's of different parity
 *
 * @example
 * ```ts
 * // The Record's strip, 32 tall under a 1px rule: its label's 7 rows of capitals stand 12 under the rule and 12 over the foot.
 * const stripLabel = { ...centredCapitals("mono", "label.sm", 31), fontWeight: 600, textTransform: "uppercase" };
 * // { fontFamily: "mono", fontSize: "label.sm", lineHeight: "12px", paddingTop: "1px", paddingBottom: "0px" }
 * ```
 */
export function centredCapitals(face: FaceName, size: FaceSize, room: number | readonly number[]): CentredCapitals {
    const line = capitalsLine(face, size);
    for (const at of typeof room === "number" ? [room] : room) {
        if (!Number.isInteger(at) || (at - line.height) % 2 !== 0) {
            throw new RangeError(`${face} at ${size} paints ${line.rows.capitals} rows of capitals, which no whole number of rows centres in ${at}px of room: a room and its capitals of one parity`);
        }
    }
    return { fontFamily: face, fontSize: size, lineHeight: `${line.rows.ascent + line.rows.descent}px`, paddingTop: `${line.top}px`, paddingBottom: `${line.bottom}px` };
}

/**
 * The line and the padding that stand a face's capitals at the middle of a box of a height of its own: a chip, its
 * padding the rows its capitals leave over and under them.
 *
 * @param face - The face
 * @param size - Its size, of the theme's scale
 * @param height - The box's height inside its edge, in px
 * @returns The face, the size, the line and the padding the box spreads
 * @throws {RangeError} When the height is not a whole number of pixels, is less than the face's line, or no whole
 *   number of rows centres the capitals in it
 *
 * @example
 * ```ts
 * // The Sheet strip's chip, 23 tall: mono at 13px, its 9 rows of capitals 7 under its top and 7 over its foot.
 * const stripChip = { ...capitalsBox("mono", "body", 23), paddingX: "8px" };
 * // { fontFamily: "mono", fontSize: "body", lineHeight: "15px", paddingTop: "4px", paddingBottom: "4px" }
 * ```
 */
export function capitalsBox(face: FaceName, size: FaceSize, height: number): CentredCapitals {
    const line = capitalsLine(face, size);
    const over = height - line.height;
    if (!Number.isInteger(height) || over < 0 || over % 2 !== 0) {
        throw new RangeError(`${face} at ${size} paints ${line.rows.capitals} rows of capitals, which no whole number of rows centres in a box ${height}px tall`);
    }
    return {
        fontFamily: face, fontSize: size, lineHeight: `${line.rows.ascent + line.rows.descent}px`,
        paddingTop: `${line.top + over / 2}px`, paddingBottom: `${line.bottom + over / 2}px`,
    };
}
