/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    type ExprType,
    FloatType,
    IntegerType,
    StringType,
    NullType,
    OptionType,
    StructType,
    VariantType,
    East,
    variant,
    some,
    none,
} from "@elaraai/east";

import { DensityType, SizeType } from "../../style.js";
import type { DensityLiteral, SizeLiteral } from "../../style.js";
import { IconType } from "../icon/types.js";
import { TickFormatType } from "../../format/types.js";

// ============================================================================
// Stat Direction (axis)
// ============================================================================

/**
 * Axis direction for a Stat indicator — the raw mathematical sign of the
 * delta, orthogonal to whether that sign is semantically "good" or "bad".
 *
 * @remarks
 * Paired with {@link StatSentimentType} in `StatIndicatorType`. This split
 * allows cost-is-better-when-down metrics to render `direction: "down"` +
 * `sentiment: "positive"` (arrow points down, palette is green).
 *
 * @property up - Value is higher than the baseline
 * @property down - Value is lower than the baseline
 * @property flat - Value is unchanged
 */
export const StatDirectionType = VariantType({
    up: NullType,
    down: NullType,
    flat: NullType,
});

/** Type alias for the Stat direction variant. */
export type StatDirectionType = typeof StatDirectionType;

/** String-literal shorthand for Stat direction tags. */
export type StatDirectionLiteral = "up" | "down" | "flat";

// ============================================================================
// Stat Sentiment (valence)
// ============================================================================

/**
 * Semantic valence for a Stat indicator — whether the change is "good" or
 * "bad" for the metric in question, orthogonal to the mathematical sign.
 *
 * @remarks
 * Paired with {@link StatDirectionType} in `StatIndicatorType`. When
 * `sentiment` is set and the indicator has no explicit `icon`, the IR
 * factory auto-injects a paired icon.
 *
 * @property positive - Change is favourable (green palette)
 * @property negative - Change is unfavourable (red palette)
 * @property neutral - Change is informational (grey palette)
 */
export const StatSentimentType = VariantType({
    positive: NullType,
    negative: NullType,
    neutral: NullType,
});

/** Type alias for the Stat sentiment variant. */
export type StatSentimentType = typeof StatSentimentType;

/** String-literal shorthand for Stat sentiment tags. */
export type StatSentimentLiteral = "positive" | "negative" | "neutral";

// ============================================================================
// Stat Indicator (composite — direction + sentiment + icon)
// ============================================================================

/**
 * Composite indicator for a Stat — pairs the mathematical direction with
 * the semantic sentiment and an optional explicit icon.
 *
 * @remarks
 * The `direction` axis mirrors the Stat's delta sign (up / down / flat).
 * The `sentiment` axis expresses whether that direction is favourable —
 * orthogonal, because metrics like cost, error count, or latency are
 * "good when down". When `sentiment` is set and `icon` is absent, the
 * factory auto-injects the paired icon; callers override by
 * passing explicit `icon`.
 *
 * @property direction - Mathematical direction of the delta (up / down / flat)
 * @property sentiment - Semantic valence of the change (positive / negative / neutral)
 * @property icon - Optional explicit icon (overrides the default paired icon)
 */
export const StatIndicatorType = StructType({
    direction: StatDirectionType,
    sentiment: OptionType(StatSentimentType),
    icon: OptionType(IconType),
});

/** Type alias for the Stat indicator struct. */
export type StatIndicatorType = typeof StatIndicatorType;

/**
 * Backwards-compatible string literal shorthand for direction-only
 * indicators. Callers passing `"up"` / `"down"` / `"flat"` get a struct
 * with `direction: <literal>` and `sentiment`/`icon` unset.
 */
export type StatIndicatorLiteral = StatDirectionLiteral;

/**
 * Helper — constructs a Stat indicator value from a direction literal plus
 * optional sentiment + icon. Exposed on the namespace as `Stat.Indicator`.
 *
 * @param direction - Direction literal (`"up"` / `"down"` / `"flat"`)
 * @param options - Optional `sentiment` literal + explicit `icon`
 * @returns An East expression of type `StatIndicatorType`
 *
 * @remarks
 * Prefer the string-shorthand form on `Stat.Root`'s `indicator` option
 * for simple direction-only cases; use this helper when constructing
 * indicator values outside of a `Stat.Root` call (e.g. when building
 * programmatic indicators in table rows).
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Stat, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Stat.Root("Revenue", "$45,231", {
 *         helpText: "+20.1%",
 *         indicator: Stat.Indicator("up", { sentiment: "positive" }),
 *     });
 * });
 * ```
 */
export function StatIndicator(
    direction: StatDirectionLiteral,
    options?: {
        sentiment?: StatSentimentLiteral;
        icon?: SubtypeExprOrValue<IconType>;
    },
): ExprType<StatIndicatorType> {
    const directionExpr = East.value(variant(direction, null), StatDirectionType);
    const sentimentExpr = options?.sentiment !== undefined
        ? some(East.value(variant(options.sentiment, null), StatSentimentType))
        : none;
    const iconExpr = options?.icon !== undefined
        ? some(options.icon)
        : none;
    return East.value({
        direction: directionExpr,
        sentiment: sentimentExpr,
        icon: iconExpr,
    }, StatIndicatorType);
}

// ============================================================================
// Stat Style
// ============================================================================

/**
 * East StructType for the Stat style sub-struct — visual presentation
 * slots only.
 *
 * @remarks
 * Content (`label` / `value` / `helpText` / `baseline` / `delta` / `info`)
 * and the runtime `indicator` live on the main `Stat` variant (inline in
 * `component.ts`). This struct carries the size preset and the four
 * colour slots renderers apply on top of the default sentiment-driven
 * palette.
 *
 * @property size - Size preset (sm / md / lg)
 * @property valueColor - Explicit colour for the primary value line
 * @property labelColor - Explicit colour for the label
 * @property helpTextColor - Explicit colour for the help-text caption
 * @property indicatorColor - Explicit colour for the indicator arrow / icon
 */
export const StatStyleType = StructType({
    size: OptionType(SizeType),
    valueColor: OptionType(StringType),
    labelColor: OptionType(StringType),
    helpTextColor: OptionType(StringType),
    indicatorColor: OptionType(StringType),
});

/** Type alias for the Stat style struct. */
export type StatStyleType = typeof StatStyleType;

// ============================================================================
// Stat TS options bag
// ============================================================================

/**
 * TypeScript options bag for `Stat.Root`.
 *
 * @remarks
 * Combines optional content slots (`helpText` / `baseline` / `delta` /
 * `info`) with the runtime `indicator` (direction-literal shorthand or
 * struct) and visual-style fields. The factory splits them into the
 * nested IR shape internally.
 *
 * @property label - Metric label
 * @property value - Primary value — a scalar (Integer / Float / String)
 * @property helpText - Optional caption beneath the main value
 * @property baseline - Optional UIComponent rendered as a secondary baseline line
 * @property delta - Optional UIComponent rendered as a delta / change pill
 * @property info - Optional ⓘ trigger rendered next to the label (opens a ToggleTip)
 * @property indicator - Direction literal shorthand OR a struct `{ direction, sentiment?, icon? }`
 * @property density - Density override shared with the rail / trace cascade
 * @property size - Visual size preset
 * @property valueColor - Explicit colour for the primary value line
 * @property labelColor - Explicit colour for the label
 * @property helpTextColor - Explicit colour for the help-text caption
 * @property indicatorColor - Explicit colour for the indicator arrow / icon
 */
export interface StatStyle {
    /** Metric label — required. */
    label: SubtypeExprOrValue<StringType>;
    /**
     * Primary value — a scalar (number / bigint / string or an East
     * `Float` / `Integer` / `String` expression) — required. Pass `format`
     * to format a numeric value.
     */
    value: SubtypeExprOrValue<FloatType | IntegerType | StringType>;
    /** Optional `Format` / tick descriptor applied when the value is numeric
     *  (e.g. `Format.Currency({ currency: "AUD" })`). Ignored for string values. */
    format?: SubtypeExprOrValue<TickFormatType>;
    /** Optional caption beneath the main value. */
    helpText?: SubtypeExprOrValue<StringType>;
    /** Optional UIComponent rendered as a secondary baseline line. */
    baseline?: unknown;
    /** Optional UIComponent rendered as a delta / change pill. */
    delta?: unknown;
    /** Optional ⓘ trigger rendered next to the label (opens a ToggleTip). */
    info?: unknown;
    /**
     * Indicator — direction literal (`"up"` / `"down"` / `"flat"`) OR a
     * full struct `{ direction, sentiment?, icon? }` OR an East
     * expression of `StatIndicatorType`.
     */
    indicator?:
        | StatDirectionLiteral
        | {
            direction: StatDirectionLiteral;
            sentiment?: StatSentimentLiteral;
            icon?: SubtypeExprOrValue<IconType>;
        }
        | SubtypeExprOrValue<StatIndicatorType>;
    /**
     * Density override (main-struct). Inherited from the enclosing surface
     * (Table, ChipRail, …) when omitted; an explicit value wins over both the
     * cascade and `size`, sizing the tile to match rails and traces at the
     * same density.
     */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Visual size preset (sm / md / lg). */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Explicit colour for the primary value line. */
    valueColor?: SubtypeExprOrValue<StringType>;
    /** Explicit colour for the label. */
    labelColor?: SubtypeExprOrValue<StringType>;
    /** Explicit colour for the help-text caption. */
    helpTextColor?: SubtypeExprOrValue<StringType>;
    /** Explicit colour for the indicator arrow / icon. */
    indicatorColor?: SubtypeExprOrValue<StringType>;
}
