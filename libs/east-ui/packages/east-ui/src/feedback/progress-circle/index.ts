/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    FloatType,
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
    ProgressCircleType,
    ProgressCircleStyleType,
    type ProgressCircleStyle,
} from "./types.js";

// Re-export types
export {
    ProgressCircleType,
    ProgressCircleStyleType,
    type ProgressCircleStyle,
} from "./types.js";

// ============================================================================
// ProgressCircle Factory
// ============================================================================

/**
 * TypeScript options bag for `ProgressCircle.Root`.
 */
export interface ProgressCircleOptions {
    /** Minimum value (defaults to 0) */
    min?: SubtypeExprOrValue<FloatType>;
    /** Maximum value (defaults to 100) */
    max?: SubtypeExprOrValue<FloatType>;
    /** Whether to render the value in the ring centre */
    showValueText?: SubtypeExprOrValue<BooleanType>;
    /** Indeterminate mode */
    indeterminate?: SubtypeExprOrValue<BooleanType>;
    /** Expected duration in seconds (drives ETA label) */
    estimatedDuration?: SubtypeExprOrValue<IntegerType>;
    /** Start timestamp (drives ETA label) */
    startedAt?: SubtypeExprOrValue<DateTimeType>;
    /** Optional visual-only style */
    style?: ProgressCircleStyle;
}

/**
 * Creates a circular progress indicator.
 *
 * @param value - Current progress value
 * @param options - Optional content + state + style
 * @returns An East expression representing the ProgressCircle component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { ProgressCircle, UIComponentType } from "@elaraai/east-ui";
 *
 * const ring = East.function([], UIComponentType, _$ =>
 *     ProgressCircle.Root(60.0, { showValueText: true, style: { size: "md" } }),
 * );
 * ```
 */
function createProgressCircle(
    value: SubtypeExprOrValue<FloatType>,
    options?: ProgressCircleOptions,
): ExprType<UIComponentType> {
    const styleValue = options?.style ? buildProgressCircleStyle(options.style) : undefined;

    return East.value(variant("ProgressCircle", {
        value: value,
        min: options?.min !== undefined ? some(options.min) : none,
        max: options?.max !== undefined ? some(options.max) : none,
        showValueText: options?.showValueText !== undefined ? some(options.showValueText) : none,
        indeterminate: options?.indeterminate !== undefined ? some(options.indeterminate) : none,
        estimatedDuration: options?.estimatedDuration !== undefined ? some(options.estimatedDuration) : none,
        startedAt: options?.startedAt !== undefined ? some(options.startedAt) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildProgressCircleStyle(style: ProgressCircleStyle): ExprType<ProgressCircleStyleType> {
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
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        thickness: style.thickness !== undefined ? some(style.thickness) : none,
        trackColor: style.trackColor !== undefined ? some(style.trackColor) : none,
        fillColor: style.fillColor !== undefined ? some(style.fillColor) : none,
        labelColor: style.labelColor !== undefined ? some(style.labelColor) : none,
    }, ProgressCircleStyleType);
}

/**
 * ProgressCircle primitive — circular progress indicator.
 */
export const ProgressCircle = {
    /**
     * Creates a ProgressCircle.
     *
     * @param value - Current progress value
     * @param options - Optional content + state + style
     *
     * @example
     * ```ts
     * ProgressCircle.Root(60.0, { showValueText: true });
     * ```
     */
    Root: createProgressCircle,
    Types: {
        /** The concrete East type for ProgressCircle. */
        ProgressCircle: ProgressCircleType,
        /** Visual-only style struct for ProgressCircle. */
        Style: ProgressCircleStyleType,
    },
} as const;
