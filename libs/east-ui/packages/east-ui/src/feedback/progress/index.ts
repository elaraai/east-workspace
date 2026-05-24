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

import { SizeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    ProgressType,
    ProgressVariantType,
    ProgressVariant,
    ProgressToneType,
    ProgressTone,
    ProgressStyleType,
    type ProgressStyle,
} from "./types.js";

// Re-export types
export {
    ProgressType,
    ProgressVariantType,
    ProgressVariant,
    ProgressToneType,
    ProgressTone,
    ProgressStyleType,
    type ProgressStyle,
    type ProgressVariantLiteral,
    type ProgressToneLiteral,
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
 *         style: { tone: "pos", size: "md", striped: true },
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
    const toneValue = style.tone
        ? (typeof style.tone === "string"
            ? East.value(variant(style.tone, null), ProgressToneType)
            : style.tone)
        : undefined;
    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        tone: toneValue ? some(toneValue) : none,
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
     * Progress.Root(60.0, { style: { tone: "pos" } });
     * ```
     */
    Root: createProgress,
    Variant: ProgressVariant,
    Tone: ProgressTone,
    Types: {
        /**
         * East StructType for a Progress value — the serialisable IR shape.
         *
         * @remarks
         * Mirror of `ProgressType` from `./types.js`. Exposed on the
         * namespace so consumers can reference the IR type via
         * `Progress.Types.Progress` without reaching into module internals.
         *
         * @property value - Current progress value (between min and max)
         * @property min - Minimum value (defaults to 0)
         * @property max - Maximum value (defaults to 100)
         * @property label - Optional label text
         * @property valueText - Optional text showing current value
         * @property indeterminate - Indeterminate mode (no known % complete)
         * @property showValue - Whether to render the computed value text
         * @property estimatedDuration - Expected duration in seconds (drives ETA display)
         * @property startedAt - Start timestamp (drives ETA display)
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Progress: ProgressType,
        /**
         * Visual preset variant for Progress.
         *
         * @remarks
         * Mirror of `ProgressVariantType` from `./types.js`. Progress does
         * not support `solid` — use `outline` for a bordered track or
         * `subtle` for a tinted track.
         *
         * @property outline - Bordered track + filled progress
         * @property subtle - Tinted track + filled progress (default)
         */
        Variant: ProgressVariantType,
        /**
         * East StructType holding every visual field for Progress.
         *
         * @remarks
         * Mirror of `ProgressStyleType` from `./types.js`. Includes preset
         * (`variant`, `colorPalette`, `size`), animation toggles
         * (`striped`, `animated`), and explicit colour slots for the track,
         * fill, and label.
         *
         * @property variant - Visual preset (outline / subtle)
         * @property tone - Fill tone (brand / pos / neg) — bsys-restricted
         * @property size - Size preset (xs / sm / md)
         * @property striped - Cosmetic stripes on the fill
         * @property animated - Animate the stripes
         * @property trackColor - Background track colour
         * @property fillColor - Fill colour
         * @property labelColor - Label text colour
         */
        Style: ProgressStyleType,
    },
} as const;
