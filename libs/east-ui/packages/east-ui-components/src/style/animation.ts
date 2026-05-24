/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure lookup — `AnimationPresetLiteral` → `{ animationName, animationDuration,
 * animationTimingFunction }`, name-only resolution.
 *
 * Keyframe definitions live in the consumer's Chakra theme (not shipped from
 * this package — resolved by 0-conventions §7 open question #2). The
 * consumer defines `@keyframes east-pulse`, `east-spin`, `east-bounce`,
 * `east-fade-in`, `east-shimmer` globally; this helper returns the names
 * pointing at them.
 *
 * Reduced-motion handling is **deferred** to `contracts/reduced-motion.ts`
 * (0-conventions plan). This function does not consult `prefers-reduced-motion`
 * — the calling renderer pairs it with the hook and returns `null` when the
 * user requests reduced motion.
 *
 * Enforcement:
 *   - Token set: IR (`east-ui/src/style/motion.ts`)
 *   - Keyframes + durations / easings: consumer theme (see `docs/THEME-CONTRACT.md`)
 *   - Reduced motion: renderer (0-conventions `usePrefersReducedMotion`)
 */

export type AnimationPresetToken = "none" | "pulse" | "spin" | "bounce" | "fade-in" | "shimmer";

export interface AnimationProps {
    /** CSS `animation-name` — points at a keyframe defined in the consumer theme. */
    readonly animationName: string;
    /** CSS `animation-duration` — CSS-var reference so the theme owns the value. */
    readonly animationDuration: string;
    /** CSS `animation-timing-function` — CSS-var reference. */
    readonly animationTimingFunction: string;
    /** CSS `animation-iteration-count` — `"infinite"` for pulse/spin/shimmer, `"1"` for bounce/fade-in. */
    readonly animationIterationCount: string;
}

/**
 * Resolve an `AnimationPresetType` token to its CSS animation props.
 *
 * @remarks
 * Returns `null` for `"none"` — the caller should not emit any animation-*
 * CSS in that case.
 *
 * @param token - An `AnimationPresetLiteral` value
 * @returns A `{ animationName, animationDuration, animationTimingFunction,
 *   animationIterationCount }` bundle, or `null` when the token is `"none"`
 */
export function toAnimationProps(token: AnimationPresetToken): AnimationProps | null {
    switch (token) {
        case "none":
            return null;
        case "pulse":
            return {
                animationName: "east-pulse",
                animationDuration: "var(--motion-duration-slow)",
                animationTimingFunction: "var(--motion-easing-standard)",
                animationIterationCount: "infinite",
            };
        case "spin":
            return {
                animationName: "east-spin",
                animationDuration: "var(--motion-duration-slow)",
                animationTimingFunction: "linear",
                animationIterationCount: "infinite",
            };
        case "bounce":
            return {
                animationName: "east-bounce",
                animationDuration: "var(--motion-duration-normal)",
                animationTimingFunction: "var(--motion-easing-emphasized)",
                animationIterationCount: "1",
            };
        case "fade-in":
            return {
                animationName: "east-fade-in",
                animationDuration: "var(--motion-duration-fast)",
                animationTimingFunction: "var(--motion-easing-decelerated)",
                animationIterationCount: "1",
            };
        case "shimmer":
            return {
                animationName: "east-shimmer",
                animationDuration: "var(--motion-duration-slow)",
                animationTimingFunction: "linear",
                animationIterationCount: "infinite",
            };
    }
}
