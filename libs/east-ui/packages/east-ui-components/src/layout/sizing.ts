/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Sizing-shorthand resolution shared by the layout primitives (Box / Flex /
 * Stack). Turns the `fill` / `scroll` / `scrollX` / `scrollY` booleans — and a
 * definite `height` / `width` — into the flex-item + overflow + min-size props
 * that make a child bound and scroll correctly inside a flex parent, so an
 * author never hand-writes the `flex:1 + min-height:0 + overflow` incantation
 * every scroll region in an app repeats (#320).
 *
 * Rules:
 * - `fill` → `flex: 1 1 0%` and `min-width/height: 0` (occupy the remaining
 *   main-axis space; the zero min-size lets it actually shrink to the line).
 * - `scroll` / `scrollX` / `scrollY` → the matching `overflow` = `auto` plus
 *   the `min-*: 0` a scroll container needs to bound inside a flex parent.
 * - A definite `height` or `width` defaults `flex-shrink: 0` (a pinned box
 *   otherwise collapses under space pressure via the default `flex-shrink: 1`).
 *
 * Author-set explicit values always win over any shorthand-derived value.
 */
export interface SizingShorthandInput {
    /** `fill` — occupy remaining main-axis space (`flex: 1 1 0%` + min-size 0). */
    fill?: boolean | undefined;
    /** `scroll` — scroll both axes (`overflow: auto` + min-size 0). */
    scroll?: boolean | undefined;
    /** `scrollX` — scroll horizontally (`overflow-x: auto` + min-width 0). */
    scrollX?: boolean | undefined;
    /** `scrollY` — scroll vertically (`overflow-y: auto` + min-height 0). */
    scrollY?: boolean | undefined;
    /** Whether an explicit `height` was set — drives the definite-size shrink guard. */
    hasHeight?: boolean | undefined;
    /** Whether an explicit `width` was set — drives the definite-size shrink guard. */
    hasWidth?: boolean | undefined;
    /** Author-set explicit values; each wins over the matching shorthand default. */
    explicit?: {
        flex?: string | undefined;
        flexGrow?: string | undefined;
        flexShrink?: string | undefined;
        overflow?: string | undefined;
        overflowX?: string | undefined;
        overflowY?: string | undefined;
        minWidth?: string | undefined;
        minHeight?: string | undefined;
    } | undefined;
}

/** The flex-item / overflow / min-size subset the shorthands resolve to. */
export interface SizingShorthandOutput {
    flex?: string;
    flexGrow?: string;
    flexShrink?: string;
    overflow?: string;
    overflowX?: string;
    overflowY?: string;
    minWidth?: string;
    minHeight?: string;
}

/**
 * Resolves the sizing shorthands into concrete flex / overflow / min-size
 * props. Spread the result over a Chakra props object AFTER the base props so
 * it wins for the fields it manages — it already folds the explicit values in,
 * so explicit author intent is preserved.
 *
 * @param input - shorthand booleans, definite-size flags, and explicit values
 * @returns the managed flex-item / overflow / min-size props
 */
export function resolveSizingShorthands(input: SizingShorthandInput): SizingShorthandOutput {
    const e = input.explicit ?? {};
    let flex = e.flex;
    let flexShrink = e.flexShrink;
    let overflow = e.overflow;
    let overflowX = e.overflowX;
    let overflowY = e.overflowY;
    let minWidth = e.minWidth;
    let minHeight = e.minHeight;

    if (input.fill === true) {
        flex ??= "1 1 0%";
        minWidth ??= "0";
        minHeight ??= "0";
    }
    if (input.scroll === true) {
        overflow ??= "auto";
        minWidth ??= "0";
        minHeight ??= "0";
    }
    if (input.scrollY === true) {
        overflowY ??= "auto";
        minHeight ??= "0";
    }
    if (input.scrollX === true) {
        overflowX ??= "auto";
        minWidth ??= "0";
    }
    // Definite size ⇒ don't shrink. A height/width-pinned box inside a flex
    // parent silently collapses under space pressure (default flex-shrink:1);
    // pin shrink to 0 unless the author set it, or asked to fill.
    if ((input.hasHeight === true || input.hasWidth === true) && flexShrink === undefined && input.fill !== true) {
        flexShrink = "0";
    }

    const out: SizingShorthandOutput = {};
    if (flex !== undefined) out.flex = flex;
    if (e.flexGrow !== undefined) out.flexGrow = e.flexGrow;
    if (flexShrink !== undefined) out.flexShrink = flexShrink;
    if (overflow !== undefined) out.overflow = overflow;
    if (overflowX !== undefined) out.overflowX = overflowX;
    if (overflowY !== undefined) out.overflowY = overflowY;
    if (minWidth !== undefined) out.minWidth = minWidth;
    if (minHeight !== undefined) out.minHeight = minHeight;
    return out;
}
