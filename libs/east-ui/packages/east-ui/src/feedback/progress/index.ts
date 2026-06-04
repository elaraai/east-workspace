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
 * @property variant - Visual preset (solid / subtle / outline)
 * @property tone - Semantic tone (pos / neg / warn / info / neutral)
 * @property size - Size preset (sm / md / lg)
 * @property striped - Diagonal stripe overlay
 * @property animated - Animate the stripe overlay
 * @property trackColor - Explicit track (unfilled) colour
 * @property fillColor - Explicit fill colour
 * @property labelColor - Explicit label colour
 */
export interface ProgressOptions extends ProgressStyle {
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
}

/**
 * Creates a Progress component with value + optional content + state + style.
 *
 * @param value - Current progress value (between min and max)
 * @param options - Optional min/max/label/valueText/indeterminate/showValue/
 *   estimatedDuration/startedAt + visual style fields
 * @returns An East expression representing the progress component
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Progress, UIComponentType } from "@elaraai/east-ui";
 *
 * const p = East.function([], UIComponentType, _$ =>
 *     Progress.Root(60.0, { tone: "pos", size: "md", striped: true }),
 * );
 * ```
 */
function createProgress(
    value: SubtypeExprOrValue<FloatType>,
    options?: ProgressOptions,
): ExprType<UIComponentType> {
    const { min, max, label, valueText, indeterminate, showValue, estimatedDuration, startedAt, ...visual } = options ?? {};

    const hasVisual = Object.values(visual).some(field => field !== undefined);
    const styleValue = hasVisual ? buildProgressStyle(visual) : undefined;

    return East.value(variant("Progress", {
        value: value,
        min: min !== undefined ? some(min) : none,
        max: max !== undefined ? some(max) : none,
        label: label !== undefined ? some(label) : none,
        valueText: valueText !== undefined ? some(valueText) : none,
        indeterminate: indeterminate !== undefined ? some(indeterminate) : none,
        showValue: showValue !== undefined ? some(showValue) : none,
        estimatedDuration: estimatedDuration !== undefined ? some(estimatedDuration) : none,
        startedAt: startedAt !== undefined ? some(startedAt) : none,
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
     * @param options - Optional content + state + visual style fields
     *
     * @example
     * ```ts
     * Progress.Root(60.0, { tone: "pos" });
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
