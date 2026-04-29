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
    BooleanType,
    NullType,
    FunctionType,
    VariantType,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import type { SizeLiteral, ColorSchemeLiteral } from "../../style.js";

// ============================================================================
// TimeScale variant
// ============================================================================

/**
 * East variant for the supported time-scale values.
 *
 * @remarks
 * Shared by `TimeScaleControl`, Gantt, Planner and ForecastView. The
 * tags map to the calendar units used to compute axis ticks and event
 * snapping. `quarter` and `year` are coarse buckets typical of
 * forecast-style views.
 *
 * @property minute - Minute resolution
 * @property hour - Hour resolution
 * @property day - Day resolution (default for Gantt-style views)
 * @property week - Week resolution
 * @property month - Month resolution
 * @property quarter - Quarter resolution (3 months)
 * @property year - Year resolution
 */
export const TimeScaleType = VariantType({
    minute: NullType,
    hour: NullType,
    day: NullType,
    week: NullType,
    month: NullType,
    quarter: NullType,
    year: NullType,
});

export type TimeScaleType = typeof TimeScaleType;
export type TimeScaleLiteral = "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";

// ============================================================================
// TimeScaleControl Style
// ============================================================================

/**
 * Visual variant tag for the segment control.
 *
 * @property solid - Filled segments (default)
 * @property outline - Outlined segments
 * @property subtle - Low-emphasis segments
 */
export const TimeScaleControlVariantType = VariantType({
    solid: NullType,
    outline: NullType,
    subtle: NullType,
});

export type TimeScaleControlVariantType = typeof TimeScaleControlVariantType;
export type TimeScaleControlVariantLiteral = "solid" | "outline" | "subtle";

/**
 * East StructType for visual style on a `TimeScaleControl`.
 *
 * @property variant - Segment visual variant (`solid` / `outline` / `subtle`)
 * @property size - Control size (`sm` / `md` / `lg`)
 * @property colorPalette - Chakra colour palette for the active segment
 * @property color - Explicit text colour for inactive segments
 * @property activeColor - Explicit text colour for the active segment
 * @property activeBackground - Explicit background for the active segment
 */
export const TimeScaleControlStyleType = StructType({
    variant: OptionType(TimeScaleControlVariantType),
    size: OptionType(SizeType),
    colorPalette: OptionType(ColorSchemeType),
    color: OptionType(StringType),
    activeColor: OptionType(StringType),
    activeBackground: OptionType(StringType),
});

export type TimeScaleControlStyleType = typeof TimeScaleControlStyleType;

/**
 * TypeScript interface for `TimeScaleControl` style options.
 *
 * @property variant - Segment visual variant
 * @property size - Control size
 * @property colorPalette - Chakra colour palette for the active segment
 * @property color - Explicit text colour for inactive segments
 * @property activeColor - Explicit text colour for the active segment
 * @property activeBackground - Explicit background for the active segment
 */
export interface TimeScaleControlStyle {
    /** Optional whitelist of available scales (others are hidden). */
    availableScales?: TimeScaleLiteral[];
    /** Whether the control is disabled. */
    disabled?: SubtypeExprOrValue<BooleanType>;
    /** Callback fired with the new selected scale. */
    onChange?: SubtypeExprOrValue<FunctionType<[TimeScaleType], NullType>>;
    /** Segment visual variant. */
    variant?: SubtypeExprOrValue<TimeScaleControlVariantType> | TimeScaleControlVariantLiteral;
    /** Control size. */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Chakra colour palette for the active segment. */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Explicit text colour for inactive segments. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit text colour for the active segment. */
    activeColor?: SubtypeExprOrValue<StringType>;
    /** Explicit background for the active segment. */
    activeBackground?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// TimeScaleControl Root
// ============================================================================

/**
 * East StructType for a `TimeScaleControl` — segment control selecting
 * a time-scale (`minute` / `hour` / `day` / `week` / `month` /
 * `quarter` / `year`).
 *
 * @remarks
 * Shared by Gantt / Planner / ForecastView for choosing the timeline
 * resolution. `value` is the current scale; `availableScales` (when
 * defined) restricts which scales are shown — e.g. a view that only
 * supports day/week/month would set
 * `availableScales: [day, week, month]`.
 *
 * @property value - Currently selected time scale ({@link TimeScaleType})
 * @property availableScales - Optional ordered subset of scales to show (defaults to all 7)
 * @property disabled - Optional disabled flag
 * @property onChange - Callback fired with the newly-selected scale
 * @property style - Optional visual style sub-struct
 */
export const TimeScaleControlType = StructType({
    value: TimeScaleType,
    availableScales: OptionType(ArrayType(TimeScaleType)),
    disabled: OptionType(BooleanType),
    onChange: OptionType(FunctionType([TimeScaleType], NullType)),
    style: OptionType(TimeScaleControlStyleType),
});

export type TimeScaleControlType = typeof TimeScaleControlType;
