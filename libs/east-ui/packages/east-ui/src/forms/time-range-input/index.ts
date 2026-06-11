/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    East,
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
 * @param options - Required `startValue` + `endValue` (**minutes since
 *   midnight**, 0–1439), optional styling + behaviour configuration
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
 *     return TimeRangeInput.Root({ startValue: start, endValue: end, step: 15n });
 * });
 * ```
 */
function createTimeRangeInput(
    options: TimeRangeInputStyle,
): ExprType<UIComponentType> {
    const { startValue, endValue } = options;

    const variantValue = options.variant
        ? (typeof options.variant === "string"
            ? East.value(variant(options.variant, null), InputVariantType)
            : options.variant)
        : undefined;
    const sizeValue = options.size
        ? (typeof options.size === "string"
            ? East.value(variant(options.size, null), SizeType)
            : options.size)
        : undefined;

    const hasStyle = (
        variantValue !== undefined ||
        sizeValue !== undefined ||
        options.color !== undefined ||
        options.background !== undefined ||
        options.borderColor !== undefined ||
        options.focusBorderColor !== undefined
    );

    const styleValue = hasStyle ? East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        color: options.color !== undefined ? some(options.color) : none,
        background: options.background !== undefined ? some(options.background) : none,
        borderColor: options.borderColor !== undefined ? some(options.borderColor) : none,
        focusBorderColor: options.focusBorderColor !== undefined ? some(options.focusBorderColor) : none,
    }, TimeRangeInputStyleType) : undefined;

    const presetsExpr = options.presets
        ? East.value(
            options.presets.map(p => East.value({
                label: p.label,
                start: p.start,
                end: p.end,
            }, TimeRangePresetType)),
        )
        : undefined;

    return East.value(variant("TimeRangeInput", {
        startValue,
        endValue,
        min: options.min !== undefined ? some(options.min) : none,
        max: options.max !== undefined ? some(options.max) : none,
        step: options.step !== undefined ? some(options.step) : none,
        presets: presetsExpr ? some(presetsExpr) : none,
        disabled: options.disabled !== undefined ? some(options.disabled) : none,
        onChange: options.onChange ? some(options.onChange) : none,
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
 * Use `TimeRangeInput.Root({ startValue, endValue, ... })` to
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
