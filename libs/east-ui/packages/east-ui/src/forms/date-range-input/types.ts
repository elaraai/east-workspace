/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    ArrayType,
    OptionType,
    StructType,
    StringType,
    DateTimeType,
    BooleanType,
    NullType,
    FunctionType,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";
import {
    InputVariantType,
    DateTimePrecisionType,
    type InputVariantLiteral,
    type DateTimePrecisionLiteral,
} from "../input/types.js";

// ============================================================================
// DateRangePreset
// ============================================================================

/**
 * East StructType for a `DateRangeInput` preset — a named start / end pair.
 *
 * @remarks
 * Presets render as a chip row beneath the inputs. Clicking applies the
 * preset's range via the same `onChange` callback as manual edits.
 * Canonical use cases: `"Last 7 days"`, `"MTD"`, `"QTD"`, `"YTD"`,
 * fixed quarter-and-year labels (`"Q2 2026"`).
 *
 * @property label - Display label
 * @property start - Start of range (UTC `DateTime`)
 * @property end - End of range (UTC `DateTime`)
 */
export const DateRangePresetType = StructType({
    label: StringType,
    start: DateTimeType,
    end: DateTimeType,
});

export type DateRangePresetType = typeof DateRangePresetType;

/**
 * TypeScript-side input shape for declaring a preset on the factory.
 *
 * @property label - Display label
 * @property start - Start of range
 * @property end - End of range
 */
export interface DateRangePresetInput {
    /** Display label (e.g. `"Last 7 days"`). */
    label: SubtypeExprOrValue<StringType>;
    /** Start of range (UTC `DateTime`). */
    start: SubtypeExprOrValue<DateTimeType>;
    /** End of range (UTC `DateTime`). */
    end: SubtypeExprOrValue<DateTimeType>;
}

// ============================================================================
// DateRangeInput Style
// ============================================================================

/**
 * East StructType for visual style on a `DateRangeInput`.
 *
 * @remarks
 * Mirrors the rest of the Input family: visual presets (`variant` /
 * `size`) plus colour escape hatches that map onto the underlying
 * date-segment fields. Both inputs share the same style — the
 * component does not expose per-input visual overrides.
 *
 * @property variant - Input visual variant (`outline` / `subtle` / `flushed`)
 * @property size - Input size (`xs` / `sm` / `md` / `lg`)
 * @property color - Explicit text colour
 * @property background - Explicit background colour
 * @property borderColor - Explicit border colour
 * @property focusBorderColor - Explicit border colour while focused
 */
export const DateRangeInputStyleType = StructType({
    variant: OptionType(InputVariantType),
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    focusBorderColor: OptionType(StringType),
});

export type DateRangeInputStyleType = typeof DateRangeInputStyleType;

/**
 * TypeScript interface for `DateRangeInput` style options.
 *
 * @property variant - Input visual variant
 * @property size - Input size
 * @property color - Explicit text colour
 * @property background - Explicit background colour
 * @property borderColor - Explicit border colour
 * @property focusBorderColor - Explicit border colour while focused
 */
export interface DateRangeInputStyle {
    /** Start of range (UTC `DateTime`) — required. */
    startValue: SubtypeExprOrValue<DateTimeType>;
    /** End of range (UTC `DateTime`) — required. */
    endValue: SubtypeExprOrValue<DateTimeType>;
    /** Lower-bound DateTime. */
    min?: SubtypeExprOrValue<DateTimeType>;
    /** Upper-bound DateTime. */
    max?: SubtypeExprOrValue<DateTimeType>;
    /** Picker / format precision (date / minute / second). */
    precision?: SubtypeExprOrValue<DateTimePrecisionType> | DateTimePrecisionLiteral;
    /** Optional preset rows displayed above the inputs. */
    presets?: DateRangePresetInput[];
    /** Whether both inputs are disabled. */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired with the new (start, end) DateTime pair. */
    onChange?: SubtypeExprOrValue<FunctionType<[DateTimeType, DateTimeType], NullType>>;
    /** Input visual variant (outline / subtle / flushed). */
    variant?: SubtypeExprOrValue<InputVariantType> | InputVariantLiteral;
    /** Input size (xs / sm / md / lg). */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Explicit text colour. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit background colour. */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour. */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour while focused. */
    focusBorderColor?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// DateRangeInput Root
// ============================================================================

/**
 * East StructType for a `DateRangeInput` — paired start / end date
 * fields with optional presets.
 *
 * @remarks
 * `startValue` / `endValue` are East UTC `DateTime` values. The
 * `precision` field controls whether the renderer shows a date-only
 * picker (`"date"`), time-only picker (`"time"`), or both
 * (`"datetime"`); defaults to `"date"` when omitted.
 *
 * Presets cover the common `"Last 7 days"` / `"MTD"` / `"YTD"` /
 * `"Q2 2026"` cases without a separate `RelativeDateInput` primitive
 * (per the gaps doc: "absorbs the relative-date use case").
 *
 * @property startValue - Start of range (UTC `DateTime`)
 * @property endValue - End of range (UTC `DateTime`)
 * @property min - Optional lower bound on selectable dates
 * @property max - Optional upper bound on selectable dates
 * @property precision - Picker precision (`date` / `time` / `datetime`)
 * @property presets - Optional named-preset row
 * @property disabled - Optional disabled flag (covers both inputs)
 * @property onChange - Callback fired with new `(start, end)` tuple
 * @property style - Optional visual style sub-struct
 */
export const DateRangeInputType = StructType({
    startValue: DateTimeType,
    endValue: DateTimeType,
    min: OptionType(DateTimeType),
    max: OptionType(DateTimeType),
    precision: OptionType(DateTimePrecisionType),
    presets: OptionType(ArrayType(DateRangePresetType)),
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([DateTimeType, DateTimeType], NullType)),
    style: OptionType(DateRangeInputStyleType),
});

export type DateRangeInputType = typeof DateRangeInputType;

export type { DateTimePrecisionLiteral };
