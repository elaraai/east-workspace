/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    OptionType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { IconType } from "../icon/types.js";
import {
    StatIndicatorType,
    StatDirectionType,
    StatSentimentType,
    StatStyleType,
    StatIndicator,
    type StatStyle,
    type StatDirectionLiteral,
    type StatSentimentLiteral,
} from "./types.js";

export {
    type StatStyle,
    type StatIndicatorLiteral,
    type StatDirectionLiteral,
    type StatSentimentLiteral,
} from "./types.js";

// ============================================================================
// Stat main-struct mirror — standalone alias for the inline variant in
// `component.ts` (the latter uses `node` for `value` / `baseline` / `delta` /
// `info`; this alias uses `UIComponentType` directly).
// ============================================================================

/**
 * East StructType mirroring the inline `Stat` variant in `component.ts`.
 *
 * @remarks
 * Used for `equalFor` memoization + `ValueTypeOf` in renderers. The inline
 * variant's `node` slots resolve to `UIComponentType` in the recursive
 * `UIComponentType` tree — this alias captures the same shape as a
 * standalone type so tooling can reach it without re-entering the
 * recursive graph.
 *
 * @property label - Label text for the metric
 * @property value - Primary value (any UIComponent)
 * @property helpText - Optional caption beneath the value
 * @property baseline - Optional secondary baseline line (UIComponent)
 * @property delta - Optional delta / change pill (UIComponent)
 * @property info - Optional ⓘ trigger beside the label (UIComponent)
 * @property indicator - Optional composite direction + sentiment + icon struct
 * @property style - Optional visual style sub-struct
 */
const StatType: StructType<{
    label: StringType,
    value: UIComponentType,
    helpText: OptionType<StringType>,
    baseline: OptionType<UIComponentType>,
    delta: OptionType<UIComponentType>,
    info: OptionType<UIComponentType>,
    indicator: OptionType<StatIndicatorType>,
    style: OptionType<StatStyleType>,
}> = StructType({
    label: StringType,
    value: UIComponentType,
    helpText: OptionType(StringType),
    baseline: OptionType(UIComponentType),
    delta: OptionType(UIComponentType),
    info: OptionType(UIComponentType),
    indicator: OptionType(StatIndicatorType),
    style: OptionType(StatStyleType),
});
type StatType = typeof StatType;

// ============================================================================
// §0.3 paired-icon mapping (sentiment → default icon)
// ============================================================================

const SENTIMENT_ICON: Record<StatSentimentLiteral, { prefix: "fas"; name: string }> = {
    positive: { prefix: "fas", name: "circle-check" },
    negative: { prefix: "fas", name: "triangle-exclamation" },
    neutral: { prefix: "fas", name: "circle-info" },
};

// ============================================================================
// Helpers
// ============================================================================

function buildStatStyle(style: StatStyle | undefined): ExprType<StatStyleType> | undefined {
    if (style === undefined) return undefined;
    const hasAny = style.size !== undefined
        || style.valueColor !== undefined
        || style.labelColor !== undefined
        || style.helpTextColor !== undefined
        || style.indicatorColor !== undefined;
    if (!hasAny) return undefined;

    const sizeValue = style.size !== undefined
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    return East.value({
        size: sizeValue ? some(sizeValue) : none,
        valueColor: style.valueColor !== undefined ? some(style.valueColor) : none,
        labelColor: style.labelColor !== undefined ? some(style.labelColor) : none,
        helpTextColor: style.helpTextColor !== undefined ? some(style.helpTextColor) : none,
        indicatorColor: style.indicatorColor !== undefined ? some(style.indicatorColor) : none,
    }, StatStyleType);
}

function isPlainIndicatorStruct(
    v: unknown,
): v is { direction: StatDirectionLiteral; sentiment?: StatSentimentLiteral; icon?: SubtypeExprOrValue<IconType> } {
    return typeof v === "object"
        && v !== null
        && typeof (v as { direction?: unknown }).direction === "string";
}

function buildIndicator(
    input: StatStyle["indicator"],
): ExprType<StatIndicatorType> | undefined {
    if (input === undefined) return undefined;

    // Bare direction literal ("up" / "down" / "flat")
    if (typeof input === "string") {
        return East.value({
            direction: East.value(variant(input, null), StatDirectionType),
            sentiment: none,
            icon: none,
        }, StatIndicatorType);
    }

    // Plain struct `{ direction, sentiment?, icon? }` — auto-inject paired icon
    if (isPlainIndicatorStruct(input)) {
        const directionExpr = East.value(variant(input.direction, null), StatDirectionType);
        const sentimentOpt = input.sentiment !== undefined
            ? some(East.value(variant(input.sentiment, null), StatSentimentType))
            : none;
        let iconOpt;
        if (input.icon !== undefined) {
            iconOpt = some(input.icon as ExprType<IconType>);
        } else if (input.sentiment !== undefined) {
            // §0.3 paired-icon injection
            const paired = SENTIMENT_ICON[input.sentiment];
            iconOpt = some(East.value({
                prefix: paired.prefix,
                name: paired.name,
                label: none,
                style: none,
            }, IconType));
        } else {
            iconOpt = none;
        }
        return East.value({
            direction: directionExpr,
            sentiment: sentimentOpt,
            icon: iconOpt,
        }, StatIndicatorType);
    }

    // East expression of StatIndicatorType — pass through
    return input as ExprType<StatIndicatorType>;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a Stat component value — a key metric tile with label, value,
 * and optional trend / baseline / delta / info slots.
 *
 * @param label - Metric label
 * @param value - Primary value (UIComponent — strings auto-wrap via caller)
 * @param style - Optional content slots (`helpText` / `baseline` / `delta` /
 *   `info` / `indicator`) + visual style fields (see {@link StatStyle})
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * **Indicator shorthand (§0.3):**
 * - Pass a direction literal (`"up"` / `"down"` / `"flat"`) for a simple
 *   arrow with no semantic valence.
 * - Pass a struct `{ direction, sentiment?, icon? }` to express whether
 *   the direction is favourable. When `sentiment` is set and `icon` is
 *   absent, the factory injects the paired icon (`positive` →
 *   `circle-check`, `negative` → `triangle-exclamation`, `neutral` →
 *   `circle-info`). Apps override by passing explicit `icon`.
 *
 * This lets cost-is-better-when-down metrics render
 * `indicator: { direction: "down", sentiment: "positive" }` — arrow
 * points down, palette is green.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Stat, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Stat.Root("Revenue", "$45,231", {
 *         helpText: "+20.1% vs last month",
 *         indicator: { direction: "up", sentiment: "positive" },
 *     });
 * });
 * ```
 */
function createStat(
    label: SubtypeExprOrValue<StringType>,
    value: SubtypeExprOrValue<UIComponentType>,
    style?: StatStyle,
): ExprType<UIComponentType> {
    const indicatorValue = buildIndicator(style?.indicator);
    const styleValue = buildStatStyle(style);

    return East.value(variant("Stat", {
        label,
        value,
        helpText: style?.helpText !== undefined ? some(style.helpText) : none,
        baseline: style?.baseline !== undefined ? some(style.baseline as SubtypeExprOrValue<UIComponentType>) : none,
        delta: style?.delta !== undefined ? some(style.delta as SubtypeExprOrValue<UIComponentType>) : none,
        info: style?.info !== undefined ? some(style.info as SubtypeExprOrValue<UIComponentType>) : none,
        indicator: indicatorValue ? some(indicatorValue) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Stat — key-metric tile primitive.
 *
 * @remarks
 * Use `Stat.Root(label, value, options?)`. For indicator semantics, pass
 * either a direction literal or a `{ direction, sentiment?, icon? }`
 * struct — the factory handles §0.3 paired-icon injection when
 * `sentiment` is set without an explicit `icon`.
 */
interface StatNamespace {
    Root: typeof createStat;
    Indicator: typeof StatIndicator;
    Types: {
        Stat: typeof StatType;
        Indicator: typeof StatIndicatorType;
        Direction: typeof StatDirectionType;
        Sentiment: typeof StatSentimentType;
        Style: typeof StatStyleType;
    };
}

export const Stat: StatNamespace = {
    /**
     * Creates a Stat component value.
     *
     * @param label - Metric label
     * @param value - Primary value (UIComponent)
     * @param style - Optional content + visual style fields
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Stat, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Stat.Root("Error rate", Text.Root("0.42%"), {
     *         helpText: "−0.08 pp vs last week",
     *         indicator: { direction: "down", sentiment: "positive" },
     *     });
     * });
     * ```
     */
    Root: createStat,
    /**
     * Helper to construct a `StatIndicatorType` expression from a
     * direction literal + optional sentiment / icon.
     *
     * @param direction - Direction literal (`"up"` / `"down"` / `"flat"`)
     * @param options - Optional `sentiment` literal + explicit `icon`
     * @returns An East expression of type `StatIndicatorType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Stat, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Stat.Root("Latency p99", "42 ms", {
     *         indicator: Stat.Indicator("down", { sentiment: "positive" }),
     *     });
     * });
     * ```
     */
    Indicator: StatIndicator,
    Types: {
        /**
         * East StructType for a Stat value — the serialisable IR shape
         * mirroring the inline `Stat` variant in `component.ts`.
         *
         * @remarks
         * Exposed on the namespace so consumers can reference the IR type
         * via `Stat.Types.Stat` without reaching into module internals.
         *
         * @property label - Metric label
         * @property value - Primary value (UIComponent)
         * @property helpText - Optional caption beneath the value
         * @property baseline - Optional secondary baseline line (UIComponent)
         * @property delta - Optional delta / change pill (UIComponent)
         * @property info - Optional ⓘ trigger beside the label (UIComponent)
         * @property indicator - Optional composite direction + sentiment + icon struct
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Stat: StatType,
        /**
         * East StructType for a Stat indicator — composite direction +
         * sentiment + icon.
         *
         * @remarks
         * Mirror of `StatIndicatorType` from `./types.js`.
         *
         * @property direction - Mathematical sign of the delta (up / down / flat)
         * @property sentiment - Semantic valence (positive / negative / neutral)
         * @property icon - Optional explicit icon (overrides default paired)
         */
        Indicator: StatIndicatorType,
        /**
         * Direction axis for a Stat indicator — mathematical sign only.
         *
         * @remarks
         * Mirror of `StatDirectionType` from `./types.js`. Orthogonal to
         * `sentiment`: an "up" direction can be either positive
         * (revenue) or negative (error count) depending on the metric.
         *
         * @property up - Value is higher than the baseline
         * @property down - Value is lower than the baseline
         * @property flat - Value is unchanged
         */
        Direction: StatDirectionType,
        /**
         * Sentiment axis for a Stat indicator — semantic valence only.
         *
         * @remarks
         * Mirror of `StatSentimentType` from `./types.js`. Drives default
         * palette + paired-icon injection per §0.3.
         *
         * @property positive - Change is favourable (green palette)
         * @property negative - Change is unfavourable (red palette)
         * @property neutral - Change is informational (grey palette)
         */
        Sentiment: StatSentimentType,
        /**
         * East StructType holding every visual field for a Stat.
         *
         * @remarks
         * Mirror of `StatStyleType` from `./types.js`. Content slots
         * (`label` / `value` / `helpText` / `baseline` / `delta` /
         * `info`) and runtime `indicator` live on the main variant; this
         * struct carries the size preset and four colour slots the
         * renderer layers on top of the default sentiment-driven palette.
         *
         * @property size - Size preset (sm / md / lg)
         * @property valueColor - Explicit colour for the primary value line
         * @property labelColor - Explicit colour for the label
         * @property helpTextColor - Explicit colour for the help-text caption
         * @property indicatorColor - Explicit colour for the indicator arrow / icon
         */
        Style: StatStyleType,
    },
};
