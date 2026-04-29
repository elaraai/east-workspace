/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    NullType,
    OptionType,
    StructType,
    StringType,
    VariantType,
    variant,
} from "@elaraai/east";

import { SizeType, OrientationType } from "../../style.js";
import type { SizeLiteral, OrientationLiteral } from "../../style.js";

// ============================================================================
// StepStatusType — shared with Timeline
// ============================================================================

/**
 * Shared per-step / per-timeline-item status variant.
 *
 * @remarks
 * Used by both `Steps` and `Timeline` — the same five states drive the
 * colour / icon affordance in each.
 *
 * @property pending - Not yet started
 * @property active - Currently in progress
 * @property completed - Finished successfully
 * @property error - Failed
 * @property skipped - Intentionally bypassed
 */
export const StepStatusType = VariantType({
    pending: NullType,
    active: NullType,
    completed: NullType,
    error: NullType,
    skipped: NullType,
});

export type StepStatusType = typeof StepStatusType;

/**
 * String literal union for Step / Timeline statuses.
 */
export type StepStatusLiteral = "pending" | "active" | "completed" | "error" | "skipped";

/**
 * Helper — create a StepStatusType value from a string literal.
 */
export function StepStatus(v: StepStatusLiteral): ExprType<StepStatusType> {
    return East.value(variant(v, null), StepStatusType);
}

// ============================================================================
// Steps Style Type
// ============================================================================

/**
 * Visual-only style struct for Steps. Content (`items`) and state
 * (`activeIndex`) live on the main `Steps` variant (inline in
 * `component.ts`).
 *
 * @property orientation - Layout direction (horizontal / vertical)
 * @property size - Size token (sm / md / lg)
 * @property pendingColor - Colour for pending steps
 * @property activeColor - Colour for the active step
 * @property completedColor - Colour for completed steps
 * @property errorColor - Colour for error steps
 * @property skippedColor - Colour for skipped steps
 * @property connectorColor - Connector line colour between steps
 */
export const StepsStyleType = StructType({
    orientation: OptionType(OrientationType),
    size: OptionType(SizeType),
    pendingColor: OptionType(StringType),
    activeColor: OptionType(StringType),
    completedColor: OptionType(StringType),
    errorColor: OptionType(StringType),
    skippedColor: OptionType(StringType),
    connectorColor: OptionType(StringType),
});

export type StepsStyleType = typeof StepsStyleType;

/**
 * TypeScript options bag for Steps' `style` sub-struct — visual props only.
 */
export interface StepsStyle {
    orientation?: SubtypeExprOrValue<OrientationType> | OrientationLiteral;
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    pendingColor?: SubtypeExprOrValue<StringType>;
    activeColor?: SubtypeExprOrValue<StringType>;
    completedColor?: SubtypeExprOrValue<StringType>;
    errorColor?: SubtypeExprOrValue<StringType>;
    skippedColor?: SubtypeExprOrValue<StringType>;
    connectorColor?: SubtypeExprOrValue<StringType>;
}
