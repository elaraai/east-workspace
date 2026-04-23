/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure lookups — `MotionDurationLiteral` / `MotionEasingLiteral` /
 * `TransitionLiteral` → CSS values for the resulting `transition-*` shorthand.
 *
 * Duration and easing are returned as CSS variable references so the
 * consumer's Chakra theme can publish the concrete values. The `transition`
 * property is returned as a valid CSS shorthand combining the three.
 *
 * Enforcement:
 *   - Token sets: IR (`east-ui/src/style/motion.ts`)
 *   - Duration / easing values: consumer theme (see `docs/THEME-CONTRACT.md`)
 */

export type MotionDurationToken = "instant" | "fast" | "normal" | "slow";
export type MotionEasingToken = "standard" | "emphasized" | "decelerated" | "accelerated";
export type TransitionToken = "none" | "colors" | "shadows" | "transform" | "layout" | "all";

/**
 * Resolve a motion-duration token to a CSS variable reference.
 *
 * @remarks
 * Consumers define `--motion-duration-{instant|fast|normal|slow}` on `:root`
 * (or a Chakra theme equivalent) — see `docs/THEME-CONTRACT.md`.
 */
export function toMotionDuration(token: MotionDurationToken): string {
    return `var(--motion-duration-${token})`;
}

/**
 * Resolve a motion-easing token to a CSS variable reference.
 *
 * @remarks
 * Consumers define `--motion-easing-{standard|emphasized|decelerated|accelerated}`.
 */
export function toMotionEasing(token: MotionEasingToken): string {
    return `var(--motion-easing-${token})`;
}

/**
 * Map a `TransitionType` token to the CSS `transition-property` portion.
 *
 * @remarks
 * - `none` → `"none"` (no transition; the other args are ignored).
 * - `colors` → `color, background-color, border-color, fill, stroke`.
 * - `shadows` → `box-shadow`.
 * - `transform` → `transform`.
 * - `layout` → `width, height, padding, margin`.
 * - `all` → `all`.
 */
function toTransitionProperty(token: TransitionToken): string {
    switch (token) {
        case "none":
            return "none";
        case "colors":
            return "color, background-color, border-color, fill, stroke";
        case "shadows":
            return "box-shadow";
        case "transform":
            return "transform";
        case "layout":
            return "width, height, padding, margin";
        case "all":
            return "all";
    }
}

/**
 * Build a full CSS `transition` shorthand from a transition preset +
 * duration + easing.
 *
 * @remarks
 * Example:
 * ```ts
 * toTransition("colors", "fast", "standard")
 * // → "color, background-color, ... var(--motion-duration-fast) var(--motion-easing-standard)"
 * ```
 *
 * @param token - The `TransitionType` preset
 * @param duration - The `MotionDurationType` token
 * @param easing - The `MotionEasingType` token
 * @returns A CSS `transition` shorthand string (or `"none"` if `token === "none"`)
 */
export function toTransition(
    token: TransitionToken,
    duration: MotionDurationToken,
    easing: MotionEasingToken,
): string {
    if (token === "none") return "none";
    return `${toTransitionProperty(token)} ${toMotionDuration(duration)} ${toMotionEasing(easing)}`;
}
