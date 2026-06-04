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
import {
    InputVariantType,
    DateTimePrecisionType,
} from "../input/types.js";
import {
    DateRangeInputType,
    DateRangeInputStyleType,
    DateRangePresetType,
    type DateRangeInputStyle,
} from "./types.js";

export {
    DateRangeInputType,
    DateRangeInputStyleType,
    DateRangePresetType,
    type DateRangeInputStyle,
    type DateRangePresetInput,
} from "./types.js";

/**
 * Creates a `DateRangeInput` — paired start / end date fields with
 * optional named presets.
 *
 * @param options - Required `startValue` + `endValue`, optional styling +
 *   behaviour configuration
 * @returns An East expression representing the DateRangeInput
 *
 * @remarks
 * `precision` defaults to `"date"` (date-only fields). Set
 * `precision: "datetime"` to expose hour / minute alongside the date,
 * or `"time"` to render time-only segments. The renderer uses the
 * same react-aria date primitives as `DateTimeInput`.
 *
 * `presets` is the canonical way to express relative ranges
 * (`"Last 7 days"`, `"MTD"`, `"YTD"`) — there is intentionally **no**
 * separate `RelativeDateInput` primitive. A preset is a named
 * (start, end) tuple; clicking applies it through the same `onChange`
 * pipeline as manual edits.
 *
 * @example
 * ```ts
 * import { East, DateTimeType } from "@elaraai/east";
 * import { DateRangeInput, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     const start = $.let(new Date("2026-04-01T00:00:00Z"), DateTimeType);
 *     const end = $.let(new Date("2026-04-30T00:00:00Z"), DateTimeType);
 *     return DateRangeInput.Root({ startValue: start, endValue: end, precision: "date" });
 * });
 * ```
 */
function createDateRangeInput(
    options: DateRangeInputStyle,
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
    const precisionValue = options.precision
        ? (typeof options.precision === "string"
            ? East.value(variant(options.precision, null), DateTimePrecisionType)
            : options.precision)
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
    }, DateRangeInputStyleType) : undefined;

    const presetsExpr = options.presets
        ? East.value(
            options.presets.map(p => East.value({
                label: p.label,
                start: p.start,
                end: p.end,
            }, DateRangePresetType)),
        )
        : undefined;

    return East.value(variant("DateRangeInput", {
        startValue,
        endValue,
        min: options.min !== undefined ? some(options.min) : none,
        max: options.max !== undefined ? some(options.max) : none,
        precision: precisionValue ? some(precisionValue) : none,
        presets: presetsExpr ? some(presetsExpr) : none,
        disabled: options.disabled !== undefined ? some(options.disabled) : none,
        onChange: options.onChange ? some(options.onChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface DateRangeInputNamespace {
    Root: typeof createDateRangeInput;
    Types: {
        Root: typeof DateRangeInputType;
        Style: typeof DateRangeInputStyleType;
        Preset: typeof DateRangePresetType;
    };
}

/**
 * `DateRangeInput` namespace — paired start / end date inputs with
 * optional named presets.
 *
 * @remarks
 * Use `DateRangeInput.Root({ startValue, endValue, ... })` to
 * construct. Access IR types via `DateRangeInput.Types.Root`,
 * `DateRangeInput.Types.Style`, `DateRangeInput.Types.Preset`.
 */
export const DateRangeInput: DateRangeInputNamespace = {
    Root: createDateRangeInput,
    Types: {
        /**
         * East StructType for the `DateRangeInput` value.
         *
         * @property startValue - Start of range (UTC `DateTime`)
         * @property endValue - End of range (UTC `DateTime`)
         * @property min - Optional lower bound
         * @property max - Optional upper bound
         * @property precision - Picker precision (`date` / `time` / `datetime`)
         * @property presets - Optional named-preset row
         * @property disabled - Optional disabled flag
         * @property onChange - Callback fired with new `(start, end)` tuple
         * @property style - Optional visual style sub-struct
         */
        Root: DateRangeInputType,
        /**
         * East StructType holding visual fields for `DateRangeInput`.
         *
         * @property variant - Input visual variant (`outline` / `subtle` / `flushed`)
         * @property size - Input size (`xs` / `sm` / `md` / `lg`)
         * @property color - Explicit text colour
         * @property background - Explicit background colour
         * @property borderColor - Explicit border colour
         * @property focusBorderColor - Explicit border colour while focused
         */
        Style: DateRangeInputStyleType,
        /**
         * East StructType for an individual preset.
         *
         * @property label - Display label (e.g. `"Last 7 days"`)
         * @property start - Start of range (UTC `DateTime`)
         * @property end - End of range (UTC `DateTime`)
         */
        Preset: DateRangePresetType,
    },
};
