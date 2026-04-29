/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    IntegerType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { InputVariantType } from "../input/types.js";
import {
    TimeRangeInputType,
    TimeRangeInputStyleType,
    TimeRangePresetType,
    type TimeRangeInputStyle,
} from "./types.js";

export {
    TimeRangeInputType,
    TimeRangeInputStyleType,
    TimeRangePresetType,
    type TimeRangeInputStyle,
    type TimeRangePresetInput,
} from "./types.js";

/**
 * Creates a `TimeRangeInput` — paired start / end time-of-day fields
 * with optional presets.
 *
 * @param startValue - Start of range, **minutes since midnight** (0–1439)
 * @param endValue - End of range, **minutes since midnight** (0–1439)
 * @param style - Optional styling + behaviour configuration
 * @returns An East expression representing the TimeRangeInput
 *
 * @remarks
 * The native `<input type="time">` underlying the renderer uses
 * `HH:MM` strings; this factory keeps minutes-since-midnight as the
 * canonical East type so apps can do straightforward integer maths
 * (e.g. `endValue.subtract(startValue)` → minutes-of-shift). Use
 * `step: 15n` for quarter-hour snapping (the default).
 *
 * `endValue < startValue` is *not* normalised — the renderer accepts
 * overnight ranges (22:00 → 06:00) as-is. App-side validation owns
 * the business rule.
 *
 * @example
 * ```ts
 * import { East, IntegerType } from "@elaraai/east";
 * import { TimeRangeInput, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     const start = $.let(360n, IntegerType);  // 06:00
 *     const end = $.let(840n, IntegerType);    // 14:00
 *     return TimeRangeInput.Root(start, end, { step: 15n });
 * });
 * ```
 */
function createTimeRangeInput(
    startValue: SubtypeExprOrValue<IntegerType>,
    endValue: SubtypeExprOrValue<IntegerType>,
    style?: TimeRangeInputStyle,
): ExprType<UIComponentType> {
    const variantValue = style?.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), InputVariantType)
            : style.variant)
        : undefined;
    const sizeValue = style?.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    const hasStyle = !!style && (
        variantValue !== undefined ||
        sizeValue !== undefined ||
        style.color !== undefined ||
        style.background !== undefined ||
        style.borderColor !== undefined ||
        style.focusBorderColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        color: style!.color !== undefined ? some(style!.color) : none,
        background: style!.background !== undefined ? some(style!.background) : none,
        borderColor: style!.borderColor !== undefined ? some(style!.borderColor) : none,
        focusBorderColor: style!.focusBorderColor !== undefined ? some(style!.focusBorderColor) : none,
    }, TimeRangeInputStyleType) : undefined;

    const presetsExpr = style?.presets
        ? East.value(
            style.presets.map(p => East.value({
                label: p.label,
                start: p.start,
                end: p.end,
            }, TimeRangePresetType)),
        )
        : undefined;

    return East.value(variant("TimeRangeInput", {
        startValue,
        endValue,
        min: style?.min !== undefined ? some(style.min) : none,
        max: style?.max !== undefined ? some(style.max) : none,
        step: style?.step !== undefined ? some(style.step) : none,
        presets: presetsExpr ? some(presetsExpr) : none,
        disabled: style?.disabled !== undefined ? some(style.disabled) : none,
        onChange: style?.onChange ? some(style.onChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface TimeRangeInputNamespace {
    Root: typeof createTimeRangeInput;
    Types: {
        Root: typeof TimeRangeInputType;
        Style: typeof TimeRangeInputStyleType;
        Preset: typeof TimeRangePresetType;
    };
}

/**
 * `TimeRangeInput` namespace — paired start / end time-of-day inputs.
 *
 * @remarks
 * Use `TimeRangeInput.Root(startValue, endValue, options?)` to
 * construct. Values are **minutes since midnight** (0–1439). Access
 * IR types via `TimeRangeInput.Types.Root`,
 * `TimeRangeInput.Types.Style`, `TimeRangeInput.Types.Preset`.
 */
export const TimeRangeInput: TimeRangeInputNamespace = {
    Root: createTimeRangeInput,
    Types: {
        /**
         * East StructType for the `TimeRangeInput` value.
         *
         * @property startValue - Start of range (minutes since midnight)
         * @property endValue - End of range (minutes since midnight)
         * @property min - Optional lower bound (minutes)
         * @property max - Optional upper bound (minutes)
         * @property step - Step granularity in minutes (default 15)
         * @property presets - Optional named-preset row
         * @property disabled - Optional disabled flag
         * @property onChange - Callback fired with new `(start, end)` tuple
         * @property style - Optional visual style sub-struct
         */
        Root: TimeRangeInputType,
        /**
         * East StructType holding visual fields for `TimeRangeInput`.
         *
         * @property variant - Input visual variant (`outline` / `subtle` / `flushed`)
         * @property size - Input size (`xs` / `sm` / `md` / `lg`)
         * @property color - Explicit text colour
         * @property background - Explicit background colour
         * @property borderColor - Explicit border colour
         * @property focusBorderColor - Explicit border colour while focused
         */
        Style: TimeRangeInputStyleType,
        /**
         * East StructType for an individual preset.
         *
         * @property label - Display label (e.g. `"Morning shift"`)
         * @property start - Start of range (minutes since midnight)
         * @property end - End of range (minutes since midnight)
         */
        Preset: TimeRangePresetType,
    },
};
