/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Cross-cutting contract types — the semantic-layer subset of `style.ts`
 * plus the `StateValueType` seven-state vocabulary.
 *
 * @remarks
 * Downstream components that encode §0 contracts (states, paired-icon status,
 * density cascade, hover intent, focus ring, elevation) import from here so
 * the dependency graph is explicit. The full `Style` namespace (with raw
 * layout tokens) remains the public surface; `contracts/` is an internal
 * sibling used by component IR factories and renderer helpers.
 *
 * @packageDocumentation
 */

export {
    StatusTokenType, type StatusTokenLiteral,
    HoverIntentType, type HoverIntentLiteral,
    DensityType, type DensityLiteral,
    VerbosityType, type VerbosityLiteral,
    ElevationType, type ElevationLiteral,
    FocusStyleType, type FocusStyleLiteral,
    TextStyleType, type TextStyleLiteral,
    MotionDurationType, type MotionDurationLiteral,
    MotionEasingType, type MotionEasingLiteral,
    TransitionType, type TransitionLiteral,
} from "../style.js";

export {
    StateValueType, type StateValueLiteral, StateValue,
} from "./states.js";
