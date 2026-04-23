/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, variant, VariantType, type ExprType } from "@elaraai/east";

// ============================================================================
// Animation Preset
// ============================================================================

/**
 * Animation preset variant type for named keyframe animations.
 *
 * @remarks
 * Create instances using the {@link AnimationPreset} function. The renderer
 * consults the `prefers-reduced-motion` media query: every preset degrades to
 * `none` when the user requests reduced motion (IR-level default, enforced by
 * the renderer — see §0.2 contract).
 *
 * @property none - No animation (used as the reduced-motion fallback)
 * @property pulse - Opacity / scale pulse (e.g. "recomputing" status dot)
 * @property spin - Continuous rotation (e.g. spinners)
 * @property bounce - Vertical bounce
 * @property fade-in - One-shot opacity fade-in
 * @property shimmer - Moving highlight band (e.g. skeleton loading)
 */
export const AnimationPresetType = VariantType({
    none: NullType,
    pulse: NullType,
    spin: NullType,
    bounce: NullType,
    "fade-in": NullType,
    shimmer: NullType,
});

/**
 * Type representing animation preset variant values.
 */
export type AnimationPresetType = typeof AnimationPresetType;

/**
 * String literal type for animation preset values.
 */
export type AnimationPresetLiteral = "none" | "pulse" | "spin" | "bounce" | "fade-in" | "shimmer";

/**
 * Creates an animation preset variant expression.
 *
 * @param preset - The named animation preset
 * @returns An East expression representing the animation preset
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.AnimationPreset("pulse");
 * ```
 */
export function AnimationPreset(preset: AnimationPresetLiteral): ExprType<AnimationPresetType> {
    return East.value(variant(preset, null), AnimationPresetType);
}

// ============================================================================
// Motion Duration (semantic)
// ============================================================================

/**
 * Motion duration variant type for named animation durations.
 *
 * @remarks
 * Create instances using the {@link MotionDuration} function. Used by
 * `TransitionType` presets and any `Box.transition`. The theme resolves each
 * token to a concrete millisecond value so the feel is consistent.
 *
 * @property instant - No perceivable delay (0ms typical)
 * @property fast - Snappy (~120ms)
 * @property normal - Default (~200ms)
 * @property slow - Deliberate (~320ms)
 */
export const MotionDurationType = VariantType({
    instant: NullType,
    fast: NullType,
    normal: NullType,
    slow: NullType,
});

/**
 * Type representing motion duration values.
 */
export type MotionDurationType = typeof MotionDurationType;

/**
 * String literal type for motion duration values.
 */
export type MotionDurationLiteral = "instant" | "fast" | "normal" | "slow";

/**
 * Creates a motion duration variant expression.
 *
 * @param duration - The motion duration token
 * @returns An East expression representing the motion duration
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.MotionDuration("fast");
 * ```
 */
export function MotionDuration(duration: MotionDurationLiteral): ExprType<MotionDurationType> {
    return East.value(variant(duration, null), MotionDurationType);
}

// ============================================================================
// Motion Easing (semantic)
// ============================================================================

/**
 * Motion easing variant type for named easing curves.
 *
 * @remarks
 * Create instances using the {@link MotionEasing} function. Pairs with
 * `MotionDurationType` to compose `TransitionType`.
 *
 * @property standard - Neutral ease (default)
 * @property emphasized - Expressive ease — draws attention
 * @property decelerated - Entering from off-screen (ease-out)
 * @property accelerated - Exiting off-screen (ease-in)
 */
export const MotionEasingType = VariantType({
    standard: NullType,
    emphasized: NullType,
    decelerated: NullType,
    accelerated: NullType,
});

/**
 * Type representing motion easing values.
 */
export type MotionEasingType = typeof MotionEasingType;

/**
 * String literal type for motion easing values.
 */
export type MotionEasingLiteral = "standard" | "emphasized" | "decelerated" | "accelerated";

/**
 * Creates a motion easing variant expression.
 *
 * @param easing - The motion easing token
 * @returns An East expression representing the motion easing
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.MotionEasing("emphasized");
 * ```
 */
export function MotionEasing(easing: MotionEasingLiteral): ExprType<MotionEasingType> {
    return East.value(variant(easing, null), MotionEasingType);
}

// ============================================================================
// Transition (semantic)
// ============================================================================

/**
 * Transition variant type for named CSS transition presets.
 *
 * @remarks
 * Create instances using the {@link Transition} function. `Box.transition`
 * accepts this token (or a raw CSS string as escape hatch). Each preset pairs
 * with `MotionDurationType` and `MotionEasingType` to produce the final
 * `transition-*` shorthand.
 *
 * @property none - No transition
 * @property colors - Transitions colour / background / border
 * @property shadows - Transitions box-shadow
 * @property transform - Transitions transform (translate / scale / rotate)
 * @property layout - Transitions layout-relevant props (width / height)
 * @property all - Transitions everything (use sparingly)
 */
export const TransitionType = VariantType({
    none: NullType,
    colors: NullType,
    shadows: NullType,
    transform: NullType,
    layout: NullType,
    all: NullType,
});

/**
 * Type representing transition values.
 */
export type TransitionType = typeof TransitionType;

/**
 * String literal type for transition values.
 */
export type TransitionLiteral = "none" | "colors" | "shadows" | "transform" | "layout" | "all";

/**
 * Creates a transition variant expression.
 *
 * @param transition - The transition token
 * @returns An East expression representing the transition
 *
 * @example
 * ```ts
 * import { Style } from "@elaraai/east-ui";
 *
 * Style.Transition("colors");
 * ```
 */
export function Transition(transition: TransitionLiteral): ExprType<TransitionType> {
    return East.value(variant(transition, null), TransitionType);
}
