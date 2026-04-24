/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    type ExprType,
    East,
    ArrayType,
    OptionType,
    StructType,
    StringType,
    IntegerType,
    NullType,
    FunctionType,
    variant,
    some,
    none,
} from "@elaraai/east";

import {
    AlertStatusType,
    AlertVariantType,
    type AlertStatusLiteral,
    type AlertVariantLiteral,
} from "../alert/types.js";

/** Toast status variant — reuses Alert's status enum. */
export const ToastStatusType = AlertStatusType;
export type ToastStatusType = typeof ToastStatusType;
export type ToastStatusLiteral = AlertStatusLiteral;

// ============================================================================
// Toast Action Type
// ============================================================================

/**
 * A single actionable button inside a Toast.
 *
 * @property label - Button label
 * @property onClick - Callback fired when the action button is pressed
 * @property variant - Button visual preset
 */
export const ToastActionType: StructType<{
    label: StringType,
    onClick: FunctionType<[], NullType>,
    variant: OptionType<AlertVariantType>,
}> = StructType({
    label: StringType,
    onClick: FunctionType([], NullType),
    variant: OptionType(AlertVariantType),
});

export type ToastActionType = typeof ToastActionType;

// ============================================================================
// Toast Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for Toast.
 */
export const ToastStyleType = StructType({
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    iconColor: OptionType(StringType),
});

export type ToastStyleType = typeof ToastStyleType;

// ============================================================================
// Toast IR type
// ============================================================================

/**
 * Toast IR — rich title/description are inlined directly as StringType for the
 * platform emit call so the IR can be serialized + re-hydrated easily. Hosts
 * compose rich toasts by pre-rendering to a string.
 *
 * @property status - Semantic classification (shared with Alert / Banner)
 * @property title - Toast title
 * @property description - Optional description
 * @property actions - Optional action buttons
 * @property duration - Duration in milliseconds (null/none = persistent)
 * @property style - Optional visual-only style
 */
export const ToastType: StructType<{
    status: AlertStatusType,
    title: StringType,
    description: OptionType<StringType>,
    actions: OptionType<ArrayType<ToastActionType>>,
    duration: OptionType<IntegerType>,
    style: OptionType<ToastStyleType>,
}> = StructType({
    status: AlertStatusType,
    title: StringType,
    description: OptionType(StringType),
    actions: OptionType(ArrayType(ToastActionType)),
    duration: OptionType(IntegerType),
    style: OptionType(ToastStyleType),
});

export type ToastType = typeof ToastType;

// ============================================================================
// TS options bag
// ============================================================================

/**
 * TypeScript options bag for `Toast.make`.
 */
export interface ToastOptions {
    /** Optional description */
    description?: SubtypeExprOrValue<StringType>;
    /** Optional action buttons */
    actions?: Array<{
        label: SubtypeExprOrValue<StringType>;
        onClick: SubtypeExprOrValue<FunctionType<[], NullType>>;
        variant?: AlertVariantLiteral;
    }>;
    /** Duration in milliseconds (undefined/none = persistent) */
    duration?: SubtypeExprOrValue<IntegerType>;
    /** Optional visual-only style */
    style?: ToastStyle;
}

/** Visual-only style options for Toast. */
export interface ToastStyle {
    color?: SubtypeExprOrValue<StringType>;
    background?: SubtypeExprOrValue<StringType>;
    borderColor?: SubtypeExprOrValue<StringType>;
    iconColor?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// Helpers for factory (kept in types.ts to avoid circular imports in index.ts)
// ============================================================================

export function buildToastAction(action: {
    label: SubtypeExprOrValue<StringType>;
    onClick: SubtypeExprOrValue<FunctionType<[], NullType>>;
    variant?: AlertVariantLiteral;
}): ExprType<ToastActionType> {
    const variantValue = action.variant !== undefined
        ? East.value(variant(action.variant, null), AlertVariantType)
        : undefined;
    return East.value({
        label: action.label,
        onClick: action.onClick,
        variant: variantValue ? some(variantValue) : none,
    }, ToastActionType);
}

export function buildToastStyle(style: ToastStyle): ExprType<ToastStyleType> {
    return East.value({
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        iconColor: style.iconColor !== undefined ? some(style.iconColor) : none,
    }, ToastStyleType);
}
