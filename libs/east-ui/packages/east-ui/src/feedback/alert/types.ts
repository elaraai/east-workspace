/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    OptionType,
    StructType,
    StringType,
    NullType,
    VariantType,
    variant,
} from "@elaraai/east";

// ============================================================================
// Alert Status Type
// ============================================================================

/**
 * Status types for Alert component.
 *
 * @remarks
 * Determines the color scheme and paired icon for the alert per §0.3.
 *
 * @property info - Informational alert (blue + info icon)
 * @property warning - Warning alert (yellow + triangle-exclamation icon)
 * @property success - Success/confirmation alert (green + check icon)
 * @property error - Error/danger alert (red + xmark icon)
 * @property neutral - Neutral/idle alert (gray + circle icon)
 */
export const AlertStatusType = VariantType({
    info: NullType,
    warning: NullType,
    success: NullType,
    error: NullType,
    neutral: NullType,
});

export type AlertStatusType = typeof AlertStatusType;

/** String literal type for alert status values. */
export type AlertStatusLiteral = "info" | "warning" | "success" | "error" | "neutral";

/**
 * Helper function to create alert status values.
 *
 * @param status - The status string
 * @returns An East expression representing the alert status
 */
export function AlertStatus(status: AlertStatusLiteral): ExprType<AlertStatusType> {
    return East.value(variant(status, null), AlertStatusType);
}

// ============================================================================
// Alert Variant Type (visual preset — lives under style)
// ============================================================================

/**
 * Visual preset for Alert.
 *
 * @property solid - Solid background alert
 * @property subtle - Subtle/light background alert
 * @property outline - Bordered alert
 */
export const AlertVariantType = VariantType({
    solid: NullType,
    subtle: NullType,
    outline: NullType,
});

export type AlertVariantType = typeof AlertVariantType;

/** String literal type for alert variant values. */
export type AlertVariantLiteral = "solid" | "subtle" | "outline";

/**
 * Helper function to create alert variant values.
 *
 * @param v - The variant string
 * @returns An East expression representing the alert variant
 */
export function AlertVariant(v: AlertVariantLiteral): ExprType<AlertVariantType> {
    return East.value(variant(v, null), AlertVariantType);
}

// ============================================================================
// Alert Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for Alert. Content (`title` / `description` /
 * `body` / `actions` / `icon`) and state (`closable` / `showIcon`) live on
 * the main `Alert` variant (inline in `component.ts`) per §0.10.
 *
 * @property variant - Visual preset (solid / subtle / outline)
 * @property color - Text colour
 * @property background - Background colour
 * @property borderColor - Border colour
 * @property iconColor - Colour of the leading paired icon
 */
export const AlertStyleType = StructType({
    variant: OptionType(AlertVariantType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    iconColor: OptionType(StringType),
});

export type AlertStyleType = typeof AlertStyleType;

/**
 * TypeScript options bag for Alert's `style` sub-struct — visual props only.
 */
export interface AlertStyle {
    /** Visual preset (solid / subtle / outline) */
    variant?: SubtypeExprOrValue<AlertVariantType> | AlertVariantLiteral;
    /** Text colour */
    color?: SubtypeExprOrValue<StringType>;
    /** Background colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Border colour */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Colour of the leading paired icon */
    iconColor?: SubtypeExprOrValue<StringType>;
}
