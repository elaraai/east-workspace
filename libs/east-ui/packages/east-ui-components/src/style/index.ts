/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Renderer-side pure lookup helpers for the east-ui semantic-token layer.
 *
 * @remarks
 * Each helper takes a token literal and returns CSS / Chakra prop values the
 * renderer can splat into a component. The values are token-path references
 * ({@link toElevationProps}) or CSS variable references ({@link toTransition})
 * where the actual resolution happens in the consumer Chakra theme, so
 * theming changes do not require re-releasing east-ui-components.
 *
 * React-aware contract helpers (paired-icon map, density context, reduced-
 * motion hook, hover-intent delay resolver) live under
 * `east-ui-components/src/contracts/` and are provided by the 0-conventions
 * plan.
 *
 * @packageDocumentation
 */

export {
    type TextStyleToken,
    TEXT_STYLE_ORDER,
    toChakraTextStyle,
} from "./text-style.js";

export {
    type ElevationToken,
    type ElevationProps,
    toElevationProps,
} from "./elevation.js";

export {
    type MotionDurationToken,
    type MotionEasingToken,
    type TransitionToken,
    toMotionDuration,
    toMotionEasing,
    toTransition,
} from "./motion.js";

export {
    type FocusStyleToken,
    type FocusRingProps,
    toFocusRingProps,
} from "./focus.js";

export {
    type AnimationPresetToken,
    type AnimationProps,
    toAnimationProps,
} from "./animation.js";
