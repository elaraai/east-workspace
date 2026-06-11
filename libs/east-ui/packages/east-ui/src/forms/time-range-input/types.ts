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
    IntegerType,
    BooleanType,
    NullType,
    FunctionType,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";
import {
    InputVariantType,
    type InputVariantLiteral,
} from "../input/types.js";

// ============================================================================
// TimeRangePreset
// ============================================================================

/**
 * East StructType for a TimeRangeInput preset — a named start/end pair.
 *
 * @remarks
 * `start` and `end` are expressed as **minutes since midnight** (0–1439)
 * to keep the type free of an arbitrary date component. Presets render
 * as a chip row beneath the inputs; clicking one applies the preset's
 * range via the same `onChange` callback.
 *
 * @property label - Display label (e.g. `"Morning shift"`)
 * @property start - Start of range in minutes since midnight
 * @property end - End of range in minutes since midnight
 */
export const TimeRangePresetType = StructType({
    label: StringType,
    start: IntegerType,
    end: IntegerType,
});

export type TimeRangePresetType = typeof TimeRangePresetType;

/**
 * TypeScript-side input shape for declaring a preset on the factory.
 *
 * @property label - Display label
 * @property start - Start of range in minutes since midnight
 * @property end - End of range in minutes since midnight
 */
export interface TimeRangePresetInput {
    /** Display label (e.g. `"Morning shift"`). */
    label: SubtypeExprOrValue<StringType>;
    /** Start of range in minutes since midnight (0–1439). */
    start: SubtypeExprOrValue<IntegerType>;
    /** End of range in minutes since midnight (0–1439). */
    end: SubtypeExprOrValue<IntegerType>;
}

// ============================================================================
// TimeRangeInput Style
// ============================================================================

/**
 * East StructType for visual style on a `TimeRangeInput`.
 *
 * @remarks
 * Mirrors the rest of the Input family: visual presets (`variant` /
 * `size`) plus colour escape hatches that map onto the underlying
 * native `<input type="time">` shells. Both inputs share the same
 * style — the component does not expose per-input visual overrides.
 *
 * @property variant - Input visual variant (`outline` / `subtle` / `flushed`)
 * @property size - Input size (`xs` / `sm` / `md` / `lg`)
 * @property color - Explicit text colour
 * @property background - Explicit background colour
 * @property borderColor - Explicit border colour
 * @property focusBorderColor - Explicit border colour while focused
 */
export const TimeRangeInputStyleType = StructType({
    variant: OptionType(InputVariantType),
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    focusBorderColor: OptionType(StringType),
});

export type TimeRangeInputStyleType = typeof TimeRangeInputStyleType;

/**
 * TypeScript interface for `TimeRangeInput` style options.
 *
 * @property variant - Input visual variant
 * @property size - Input size
 * @property color - Explicit text colour
 * @property background - Explicit background colour
 * @property borderColor - Explicit border colour
 * @property focusBorderColor - Explicit border colour while focused
 */
export interface TimeRangeInputStyle {
    /** Start of range, minutes since midnight (0–1439) — required. */
    startValue: SubtypeExprOrValue<IntegerType>;
    /** End of range, minutes since midnight (0–1439) — required. */
    endValue: SubtypeExprOrValue<IntegerType>;
    /** Lower-bound minute value (0–1439). */
    min?: SubtypeExprOrValue<IntegerType>;
    /** Upper-bound minute value (0–1439). */
    max?: SubtypeExprOrValue<IntegerType>;
    /** Picker / keyboard step in minutes (default 15). */
    step?: SubtypeExprOrValue<IntegerType>;
    /** Optional preset rows displayed above the inputs. */
    presets?: TimeRangePresetInput[];
    /** Whether both inputs are disabled. */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired with the new (start, end) minute pair. */
    onChange?: SubtypeExprOrValue<FunctionType<[IntegerType, IntegerType], NullType>>;
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
// TimeRangeInput Root
// ============================================================================

/**
 * East StructType for a `TimeRangeInput` — paired start / end
 * time-of-day fields with optional presets.
 *
 * @remarks
 * `startValue` / `endValue` are minutes since midnight (0–1439) — no
 * date component. Used for shift windows, SLA brackets, business-hours
 * configuration. The renderer wraps two native `<input type="time">`
 * controls with HH:MM serialisation; `step` controls keyboard /
 * picker granularity (in **minutes**, defaults to 15).
 *
 * `endValue < startValue` is permitted at the type level — apps that
 * need overnight ranges (e.g. 22:00 → 06:00) can express them this
 * way. The renderer does not normalise.
 *
 * @property startValue - Start of range (minutes since midnight)
 * @property endValue - End of range (minutes since midnight)
 * @property min - Optional lower bound on selectable times (minutes)
 * @property max - Optional upper bound on selectable times (minutes)
 * @property step - Step granularity in minutes (default 15)
 * @property presets - Optional named presets row
 * @property disabled - Optional disabled flag (covers both inputs)
 * @property onChange - Callback fired with the new `(start, end)` tuple
 * @property style - Optional visual style sub-struct
 */
export const TimeRangeInputType = StructType({
    startValue: IntegerType,
    endValue: IntegerType,
    min: OptionType(IntegerType),
    max: OptionType(IntegerType),
    step: OptionType(IntegerType),
    presets: OptionType(ArrayType(TimeRangePresetType)),
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([IntegerType, IntegerType], NullType)),
    style: OptionType(TimeRangeInputStyleType),
});

export type TimeRangeInputType = typeof TimeRangeInputType;
