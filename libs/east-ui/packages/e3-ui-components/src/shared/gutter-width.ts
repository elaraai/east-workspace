/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A builder's gutter width, as its right rule's drag and keys move it (#1680's
 * review): held between its bounds in whole pixels, its bounds widened to take
 * the width its author declares, and the width each key takes it to. The
 * separator that moves it is `gutter-handle.tsx`.
 *
 * @packageDocumentation
 */

/** The widths a gutter is held between (px). */
export interface GutterBounds {
    /** The narrowest. */
    readonly min: number;
    /** The widest. */
    readonly max: number;
}

/** How far ← and → step the gutter (px). */
export const GUTTER_STEP = 8;

/** How far they step it with Shift (px). */
export const GUTTER_STEP_FAR = 40;

/**
 * A width held between its bounds, in whole pixels.
 *
 * @param width - The width asked for
 * @param bounds - Its bounds
 * @returns The width the gutter takes
 */
export function clampGutter(width: number, bounds: GutterBounds): number {
    return Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
}

/**
 * The bounds a gutter is held between: the builder's own, widened to take the
 * width its author declares, so a declared width is never out of reach.
 *
 * @param declared - The width the author declares, or the builder's default
 * @param min - The builder's narrowest
 * @param max - The builder's widest
 * @returns The bounds
 */
export function gutterBounds(declared: number, min: number, max: number): GutterBounds {
    return { min: Math.min(min, declared), max: Math.max(max, declared) };
}

/**
 * The width a key takes the gutter to: ← and → a step, Shift with them a far
 * step, Home and End its bounds.
 *
 * @param width - Its width now
 * @param key - The key, as a keyboard event names it
 * @param far - Whether Shift is held
 * @param bounds - Its bounds
 * @returns The width; `undefined` for a key that is not the handle's
 */
export function gutterWidthByKey(width: number, key: string, far: boolean, bounds: GutterBounds): number | undefined {
    const step = far ? GUTTER_STEP_FAR : GUTTER_STEP;
    switch (key) {
        case "ArrowLeft": return clampGutter(width - step, bounds);
        case "ArrowRight": return clampGutter(width + step, bounds);
        case "Home": return bounds.min;
        case "End": return bounds.max;
        default: return undefined;
    }
}
