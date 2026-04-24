/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    FloatType,
    StringType,
    IntegerType,
    DateTimeType,
    BooleanType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    ProgressType,
    ProgressVariantType,
    ProgressVariant,
    ProgressStyleType,
    type ProgressStyle,
} from "./types.js";

// Re-export types
export {
    ProgressType,
    ProgressVariantType,
    ProgressVariant,
    ProgressStyleType,
    type ProgressStyle,
    type ProgressVariantLiteral,
} from "./types.js";

// ============================================================================
// Progress Factory
// ============================================================================

/**
 * TypeScript options bag for `Progress.Root`.
 *
 * @property min - Minimum value (defaults to 0)
 * @property max - Maximum value (defaults to 100)
 * @property label - Optional label text
 * @property valueText - Optional text showing current value
 * @property indeterminate - Indeterminate mode (no known % complete)
 * @property showValue - Whether to render the computed value text
 * @property estimatedDuration - Expected duration in seconds (drives ETA display)
 * @property startedAt - Start timestamp (drives ETA display)
 * @property style - Optional visual-only style
 */
export interface ProgressOptions {
    /** Minimum value (defaults to 0) */
    min?: SubtypeExprOrValue<FloatType>;
    /** Maximum value (defaults to 100) */
    max?: SubtypeExprOrValue<FloatType>;
    /** Optional label text */
    label?: SubtypeExprOrValue<StringType>;
    /** Optional text showing current value */
    valueText?: SubtypeExprOrValue<StringType>;
    /** Indeterminate mode (no known % complete) */
    indeterminate?: SubtypeExprOrValue<BooleanType>;
    /** Whether to render the computed value text */
    showValue?: SubtypeExprOrValue<BooleanType>;
    /** Expected duration in seconds (drives ETA display) */
    estimatedDuration?: SubtypeExprOrValue<IntegerType>;
    /** Start timestamp (drives ETA display) */
    startedAt?: SubtypeExprOrValue<DateTimeType>;
    /** Optional visual-only style */
    style?: ProgressStyle;
}

/**
 * Creates a Progress component with value + optional content + state + style.
 *
 * @param value - Current progress value (between min and max)
 * @param options - Optional min/max/label/valueText/indeterminate/showValue/
 *   estimatedDuration/startedAt/style
 * @returns An East expression representing the progress component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Progress, UIComponentType } from "@elaraai/east-ui";
 *
 * const p = East.function([], UIComponentType, _$ =>
 *     Progress.Root(60.0, {
 *         style: { colorPalette: "green", size: "md", striped: true },
 *     }),
 * );
 * ```
 */
function createProgress(
    value: SubtypeExprOrValue<FloatType>,
    options?: ProgressOptions,
): ExprType<UIComponentType> {
    const styleValue = options?.style ? buildProgressStyle(options.style) : undefined;

    return East.value(variant("Progress", {
        value: value,
        min: options?.min !== undefined ? some(options.min) : none,
        max: options?.max !== undefined ? some(options.max) : none,
        label: options?.label !== undefined ? some(options.label) : none,
        valueText: options?.valueText !== undefined ? some(options.valueText) : none,
        indeterminate: options?.indeterminate !== undefined ? some(options.indeterminate) : none,
        showValue: options?.showValue !== undefined ? some(options.showValue) : none,
        estimatedDuration: options?.estimatedDuration !== undefined ? some(options.estimatedDuration) : none,
        startedAt: options?.startedAt !== undefined ? some(options.startedAt) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildProgressStyle(style: ProgressStyle): ExprType<ProgressStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), ProgressVariantType)
            : style.variant)
        : undefined;
    const colorPaletteValue = style.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;
    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        striped: style.striped !== undefined ? some(style.striped) : none,
        animated: style.animated !== undefined ? some(style.animated) : none,
        trackColor: style.trackColor !== undefined ? some(style.trackColor) : none,
        fillColor: style.fillColor !== undefined ? some(style.fillColor) : none,
        labelColor: style.labelColor !== undefined ? some(style.labelColor) : none,
    }, ProgressStyleType);
}

/**
 * Progress component for displaying task completion status.
 */
export const Progress = {
    /**
     * Creates a Progress bar.
     *
     * @param value - Current progress value (0–100 by default)
     * @param options - Optional content + state + style
     *
     * @example
     * ```ts
     * Progress.Root(60.0, { style: { colorPalette: "green" } });
     * ```
     */
    Root: createProgress,
    Variant: ProgressVariant,
    Types: {
        /** The concrete East type for Progress. */
        Progress: ProgressType,
        /** Visual preset variant (outline / subtle). */
        Variant: ProgressVariantType,
        /** Visual-only style struct. */
        Style: ProgressStyleType,
    },
} as const;
