/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The markers' geometry (#57, #1393): where an item drawn as a dot or a
 * labelled pin stands on the screen, and the words a pin draws — what the
 * painter draws a marker by (`paint.ts`), what a tap meets it in, and the edge
 * a link's end meets (`routes.ts`' `endShape`), so the clickable area is the
 * drawn one (invariant 27). Pure: no React, no DOM.
 *
 * @packageDocumentation
 */

import { type ScreenCamera, project } from "./camera";
import { PIN_DOT_W, PIN_GAP, PIN_H, PIN_LEAD_PX, PIN_PAD_X, SCHEMATIC_CARD_MAX_PX } from "./model";

/** Drawn radius of a `dot`-tier marker, in screen px. */
export const MARKER_DOT_RADIUS = 5;
/** Hit radius of a `dot`-tier marker, in screen px — comfortably over the
 * drawn dot (5) and its selected ring (7.5) for touch slop (issue #57, P11). */
export const MARKER_DOT_HIT_RADIUS = 10;

/** The widest a labelled pin's words draw, in screen px: the pin at its widest ({@link SCHEMATIC_CARD_MAX_PX}), less its padding, its dot and the gap after it. */
const MARKER_PIN_TEXT_MAX = SCHEMATIC_CARD_MAX_PX - (PIN_PAD_X + PIN_DOT_W + PIN_GAP + PIN_PAD_X);

/** What a label is cut between: its graphemes, where the page segments them. */
const GRAPHEMES = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;

/** A label's graphemes — so a cut never splits an accented letter or a flag — or its code points where the page has no segmenter. */
const graphemesOf = (text: string): string[] => (GRAPHEMES === undefined ? Array.from(text) : Array.from(GRAPHEMES.segment(text), (part) => part.segment));

/**
 * The words a labelled pin draws, and their width (#1393): its item's whole
 * label, or — one wider than a pin's words draw at its widest — as much of it
 * as fits before an ellipsis, cut between graphemes, a space before the cut
 * dropped. A longer cut is never narrower, so the longest that fits is found
 * by halving.
 *
 * @param label - The item's label
 * @param measure - A string's width in px, in the pins' font
 * @returns The words, and their width in px
 */
function pinWords(label: string, measure: (text: string) => number): { readonly text: string; readonly width: number } {
    const whole = measure(label);
    if (whole <= MARKER_PIN_TEXT_MAX) return { text: label, width: whole };
    const parts = graphemesOf(label);
    const cut = (n: number): string => `${parts.slice(0, n).join("").trimEnd()}…`;
    let lo = 0, hi = parts.length - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measure(cut(mid)) <= MARKER_PIN_TEXT_MAX) lo = mid;
        else hi = mid - 1;
    }
    const text = cut(lo);
    return { text, width: measure(text) };
}

/** The screen-space hitbox of a non-card LOD marker — a circle for a `dot`, the
 * rounded-pill rect for a `label`, with the words it draws. */
export type MarkerHitbox =
    | { kind: "circle"; cx: number; cy: number; r: number }
    | { kind: "rect"; left: number; top: number; w: number; h: number; text: string };

/**
 * The screen-space hitbox of an item's LOD marker at `tier`. The single source
 * of truth used by **both** {@link paintSchematic} (to draw the pill) and the
 * React layer's pick (to hit-test), so the clickable area always equals the
 * drawn area and the two cannot silently drift (issue #57, P11). A `dot` is a
 * circle of {@link MARKER_DOT_HIT_RADIUS}; a `label` is the rounded pill whose
 * width is `pad + dot + gap + textWidth + pad`, no wider than
 * {@link SCHEMATIC_CARD_MAX_PX} — its words the label, or as much of it as fits
 * before an ellipsis (#1393), each measured by `measure` (the caller sets the
 * context font to the palette's `labelFont` first) — its dot on its item's
 * point and its words after it ({@link PIN_LEAD_PX}), so the status it shows
 * stands where its item does, never on a neighbour's.
 *
 * @param item - the item's world anchor and label
 * @param tier - the LOD tier (`dot` or `label`; `card` markers are DOM)
 * @param cam - the screen camera
 * @param measure - measures a string's width in px under the pin font
 * @returns the marker's screen-space hitbox, and a pill's words
 */
export function markerHitbox(
    item: { x: number; y: number; label: string },
    tier: "dot" | "label",
    cam: ScreenCamera,
    measure: (text: string) => number,
): MarkerHitbox {
    const { sx, sy } = project(item.x, item.y, cam);
    if (tier === "dot") return { kind: "circle", cx: sx, cy: sy, r: MARKER_DOT_HIT_RADIUS };
    const words = pinWords(item.label, measure);
    const w = PIN_PAD_X + PIN_DOT_W + PIN_GAP + words.width + PIN_PAD_X;
    return { kind: "rect", left: sx - PIN_LEAD_PX, top: sy - PIN_H / 2, w, h: PIN_H, text: words.text };
}

/**
 * Whether the screen point `(sx, sy)` falls inside `box` (see
 * {@link markerHitbox}).
 *
 * @param box - a marker hitbox
 * @param sx - screen x
 * @param sy - screen y
 * @returns `true` when the point is inside the hitbox
 */
export function markerHit(box: MarkerHitbox, sx: number, sy: number): boolean {
    return box.kind === "circle"
        ? Math.hypot(sx - box.cx, sy - box.cy) <= box.r
        : sx >= box.left && sx <= box.left + box.w && sy >= box.top && sy <= box.top + box.h;
}
