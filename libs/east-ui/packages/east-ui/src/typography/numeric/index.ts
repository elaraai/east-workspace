/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    type ExprType,
    East,
    FloatType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { TextStyleType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { TickFormatType } from "../../charts/types.js";
import {
    NumericType,
    NumericSentimentType,
    NumericVisualStyleType,
    type NumericStyle,
    type NumericSentimentLiteral,
} from "./types.js";

// Re-export types
export {
    NumericType,
    NumericSentimentType,
    NumericVisualStyleType,
    type NumericStyle,
} from "./types.js";

// ============================================================================
// Numeric Component
// ============================================================================

/**
 * Creates a Numeric component for displaying a formatted numeric value.
 *
 * @param value - The numeric value (Float). The factory accepts a raw
 *                `number` literal; the IR stores a FloatType expression.
 * @param style - Optional configuration. `format`, `sentiment`, and
 *                `showSign` land on the main struct (content / state);
 *                visual fields (`textStyle`, colour slots, opacity) wrap
 *                into the `style` sub-struct.
 * @returns An East expression representing the Numeric component
 */
function createNumeric(
    value: SubtypeExprOrValue<FloatType> | number,
    style?: NumericStyle,
): ExprType<UIComponentType> {
    const valueExpr = typeof value === "number"
        ? East.value(value, FloatType)
        : value;

    const sentimentValue = style?.sentiment
        ? (typeof style.sentiment === "string"
            ? East.value(variant(style.sentiment as NumericSentimentLiteral, null), NumericSentimentType)
            : style.sentiment)
        : undefined;

    const showSignValue = style?.showSign !== undefined ? style.showSign : undefined;

    const styleValue = style ? buildNumericVisualStyle(style) : undefined;

    return East.value(variant("Numeric", {
        value: valueExpr,
        format: style?.format ? variant("some", style.format) : variant("none", null),
        sentiment: sentimentValue ? variant("some", sentimentValue) : variant("none", null),
        showSign: showSignValue !== undefined ? variant("some", showSignValue) : variant("none", null),
        style: styleValue ? variant("some", styleValue) : variant("none", null),
    }), UIComponentType);
}

function buildNumericVisualStyle(
    style: NumericStyle,
): ExprType<NumericVisualStyleType> {
    const textStyleValue = style.textStyle
        ? (typeof style.textStyle === "string"
            ? East.value(variant(style.textStyle, null), TextStyleType)
            : style.textStyle)
        : undefined;

    return East.value({
        textStyle: textStyleValue ? some(textStyleValue) : none,
        color: style.color ? some(style.color) : none,
        background: style.background ? some(style.background) : none,
        signColor: style.signColor ? some(style.signColor) : none,
        opacity: style.opacity !== undefined ? some(style.opacity) : none,
    }, NumericVisualStyleType);
}

/**
 * Numeric component for displaying formatted numeric values (KPIs,
 * percentages, currencies, compact notation, unit-carrying values).
 *
 * @remarks
 * Bundles mono + tabular-nums + locale-aware `Intl.NumberFormat` + optional
 * colour-by-sentiment. Default `textStyle` is an inline 14px tabular mono run
 * that sits in body text; opt into a hero size with `textStyle: "mono-kpi"`.
 * `sentiment` drives the default colour; override via `style.color` for
 * branded tints.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Numeric, Format, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Numeric.Root(1842500, {
 *         format: Format.Currency({ currency: "AUD", compact: "short" }),
 *         sentiment: "positive",
 *         showSign: true,
 *     });
 * });
 * ```
 */
export const Numeric = {
    Root: createNumeric,
    Types: {
        Numeric: NumericType,
        Format: TickFormatType,
        Sentiment: NumericSentimentType,
        Style: NumericVisualStyleType,
    },
} as const;
