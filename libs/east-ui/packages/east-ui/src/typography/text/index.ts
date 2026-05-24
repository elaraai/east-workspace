/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    type ExprType,
    East,
    StringType,
    variant,
    some,
    none,
} from "@elaraai/east";

import {
    BorderStyleType,
    BorderWidthType,
    FontFamilyType,
    FontStyleType,
    FontVariantNumericType,
    FontWeightType,
    OverflowType,
    TextAlignType,
    TextDecorationType,
    TextOverflowType,
    TextStyleType as TypographyTextStyleType,
    TextTransformType,
    WhiteSpaceType,
} from "../../style.js";
import { UIComponentType } from "../../component.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import {
    TextType,
    TextVisualStyleType,
    type TextStyle,
} from "./types.js";

// Re-export types
export {
    TextType,
    TextVisualStyleType,
    type TextStyle,
} from "./types.js";

// ============================================================================
// Text Component
// ============================================================================

/**
 * Creates a Text component with a value and optional styling.
 *
 * @param value - The text value as a string or East expression
 * @param style - Optional visual-style configuration for the text
 * @returns An East expression representing the styled text component
 */
function createText(
    value: SubtypeExprOrValue<StringType>,
    style?: TextStyle
): ExprType<UIComponentType> {
    const styleValue = style ? buildTextVisualStyle(style) : undefined;

    return East.value(variant("Text", {
        value: value,
        style: styleValue ? variant("some", styleValue) : variant("none", null),
    }), UIComponentType);
}

function buildTextVisualStyle(style: TextStyle): ExprType<TextVisualStyleType> {
    const textStyleValue = style.textStyle
        ? (typeof style.textStyle === "string"
            ? East.value(variant(style.textStyle, null), TypographyTextStyleType)
            : style.textStyle)
        : undefined;

    const fontWeightValue = style.fontWeight
        ? (typeof style.fontWeight === "string"
            ? East.value(variant(style.fontWeight, null), FontWeightType)
            : style.fontWeight)
        : undefined;

    const fontStyleValue = style.fontStyle
        ? (typeof style.fontStyle === "string"
            ? East.value(variant(style.fontStyle, null), FontStyleType)
            : style.fontStyle)
        : undefined;

    const fontFamilyValue = style.fontFamily
        ? (typeof style.fontFamily === "string"
            ? East.value(variant(style.fontFamily, null), FontFamilyType)
            : style.fontFamily)
        : undefined;

    const fontVariantNumericValue = style.fontVariantNumeric
        ? (typeof style.fontVariantNumeric === "string"
            ? East.value(variant(style.fontVariantNumeric, null), FontVariantNumericType)
            : style.fontVariantNumeric)
        : undefined;

    const textAlignValue = style.textAlign
        ? (typeof style.textAlign === "string"
            ? East.value(variant(style.textAlign, null), TextAlignType)
            : style.textAlign)
        : undefined;

    const textDecorationValue = style.textDecoration
        ? (typeof style.textDecoration === "string"
            ? East.value(variant(style.textDecoration, null), TextDecorationType)
            : style.textDecoration)
        : undefined;

    const textTransformValue = style.textTransform
        ? (typeof style.textTransform === "string"
            ? East.value(variant(style.textTransform, null), TextTransformType)
            : style.textTransform)
        : undefined;

    const textOverflowValue = style.textOverflow
        ? (typeof style.textOverflow === "string"
            ? East.value(variant(style.textOverflow, null), TextOverflowType)
            : style.textOverflow)
        : undefined;

    const whiteSpaceValue = style.whiteSpace
        ? (typeof style.whiteSpace === "string"
            ? East.value(variant(style.whiteSpace, null), WhiteSpaceType)
            : style.whiteSpace)
        : undefined;

    const borderWidthValue = style.borderWidth
        ? (typeof style.borderWidth === "string"
            ? East.value(variant(style.borderWidth, null), BorderWidthType)
            : style.borderWidth)
        : undefined;

    const borderStyleValue = style.borderStyle
        ? (typeof style.borderStyle === "string"
            ? East.value(variant(style.borderStyle, null), BorderStyleType)
            : style.borderStyle)
        : undefined;

    const overflowValue = style.overflow
        ? (typeof style.overflow === "string"
            ? East.value(variant(style.overflow, null), OverflowType)
            : style.overflow)
        : undefined;

    const overflowXValue = style.overflowX
        ? (typeof style.overflowX === "string"
            ? East.value(variant(style.overflowX, null), OverflowType)
            : style.overflowX)
        : undefined;

    const overflowYValue = style.overflowY
        ? (typeof style.overflowY === "string"
            ? East.value(variant(style.overflowY, null), OverflowType)
            : style.overflowY)
        : undefined;

    const paddingValue = style.padding
        ? (typeof style.padding === "string"
            ? East.value({
                top: some(style.padding),
                right: some(style.padding),
                bottom: some(style.padding),
                left: some(style.padding),
            }, PaddingType)
            : style.padding)
        : undefined;

    const marginValue = style.margin
        ? (typeof style.margin === "string"
            ? East.value({
                top: some(style.margin),
                right: some(style.margin),
                bottom: some(style.margin),
                left: some(style.margin),
            }, MarginType)
            : style.margin)
        : undefined;

    return East.value({
        textStyle: textStyleValue ? some(textStyleValue) : none,
        fontWeight: fontWeightValue ? some(fontWeightValue) : none,
        fontStyle: fontStyleValue ? some(fontStyleValue) : none,
        fontFamily: fontFamilyValue ? some(fontFamilyValue) : none,
        fontVariantNumeric: fontVariantNumericValue ? some(fontVariantNumericValue) : none,
        textAlign: textAlignValue ? some(textAlignValue) : none,
        textDecoration: textDecorationValue ? some(textDecorationValue) : none,
        textTransform: textTransformValue ? some(textTransformValue) : none,
        textOverflow: textOverflowValue ? some(textOverflowValue) : none,
        whiteSpace: whiteSpaceValue ? some(whiteSpaceValue) : none,
        lineHeight: style.lineHeight ? some(style.lineHeight) : none,
        letterSpacing: style.letterSpacing ? some(style.letterSpacing) : none,
        color: style.color ? some(style.color) : none,
        background: style.background ? some(style.background) : none,
        borderWidth: borderWidthValue ? some(borderWidthValue) : none,
        borderStyle: borderStyleValue ? some(borderStyleValue) : none,
        borderColor: style.borderColor ? some(style.borderColor) : none,
        overflow: overflowValue ? some(overflowValue) : none,
        overflowX: overflowXValue ? some(overflowXValue) : none,
        overflowY: overflowYValue ? some(overflowYValue) : none,
        width: style.width ? some(style.width) : none,
        height: style.height ? some(style.height) : none,
        minWidth: style.minWidth ? some(style.minWidth) : none,
        minHeight: style.minHeight ? some(style.minHeight) : none,
        maxWidth: style.maxWidth ? some(style.maxWidth) : none,
        maxHeight: style.maxHeight ? some(style.maxHeight) : none,
        padding: paddingValue ? some(paddingValue) : none,
        margin: marginValue ? some(marginValue) : none,
        opacity: style.opacity !== undefined ? some(style.opacity) : none,
    }, TextVisualStyleType);
}

// ============================================================================
// Style Presets — recurring typographic patterns from the design spec
// ============================================================================

const EYEBROW_STYLE: TextStyle = {
    textStyle: "code-sm",
    fontFamily: "mono",
    fontWeight: "semibold",
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "fg.muted",
};

const EYEBROW_SM_STYLE: TextStyle = {
    textStyle: "code-sm",
    fontFamily: "mono",
    fontWeight: "semibold",
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: "fg.muted",
};

const MONO_SM_STYLE: TextStyle = {
    textStyle: "code-sm",
    fontFamily: "mono",
    fontVariantNumeric: "tabular-nums",
    color: "fg.muted",
};

const MONO_LABEL_STYLE: TextStyle = {
    textStyle: "code-md",
    fontFamily: "mono",
    fontWeight: "semibold",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
};

const META_SM_STYLE: TextStyle = {
    textStyle: "label-sm",
    fontFamily: "mono",
    fontWeight: "medium",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "fg.muted",
};

const LEAD_STYLE: TextStyle = {
    textStyle: "body-lg",
    lineHeight: "1.625",
    color: "fg.subtle",
};

const MONO_KPI_STYLE: TextStyle = {
    textStyle: "mono-kpi",
};

/**
 * Mono uppercase eyebrow — section labels, status words, frame eyebrows.
 * 11 px / 600 / 0.14 em uppercase / `fg.muted`. Override any field via the
 * `style` arg (e.g. pass `{ color: "fg" }` for the strong-ink variant).
 */
function createEyebrow(
    value: SubtypeExprOrValue<StringType>,
    style?: TextStyle,
): ExprType<UIComponentType> {
    return createText(value, { ...EYEBROW_STYLE, ...style });
}

/**
 * Small eyebrow — sidebar group headers, dense section markers.
 * 9.5 px / 600 / 0.18 em uppercase / `fg.muted`.
 */
function createEyebrowSm(
    value: SubtypeExprOrValue<StringType>,
    style?: TextStyle,
): ExprType<UIComponentType> {
    return createText(value, { ...EYEBROW_SM_STYLE, ...style });
}

/**
 * Inline mono — counts, IDs, schema keys, freshness meta.
 * 11 px mono tabular / `fg.muted`. Override `color` for tone variants.
 */
function createMonoSm(
    value: SubtypeExprOrValue<StringType>,
    style?: TextStyle,
): ExprType<UIComponentType> {
    return createText(value, { ...MONO_SM_STYLE, ...style });
}

/**
 * Mono label — sidebar items, active toggle labels, dense frame headers.
 * 12 px / 600 / 0.12 em uppercase. No default colour — caller picks per
 * state (active vs. resting).
 */
function createMonoLabel(
    value: SubtypeExprOrValue<StringType>,
    style?: TextStyle,
): ExprType<UIComponentType> {
    return createText(value, { ...MONO_LABEL_STYLE, ...style });
}

/**
 * Small meta — trailing meta inside eyebrow rows, dense table headers.
 * 10.5 px / 500 / 0.12 em uppercase / `fg.muted`. Lighter and smaller
 * than `Eyebrow` so it recedes alongside it.
 */
function createMetaSm(
    value: SubtypeExprOrValue<StringType>,
    style?: TextStyle,
): ExprType<UIComponentType> {
    return createText(value, { ...META_SM_STYLE, ...style });
}

/**
 * Lead — section / page-introduction prose. Larger body text in
 * `fg.subtle` with relaxed line-height — the `mode-lede` pattern.
 */
function createLead(
    value: SubtypeExprOrValue<StringType>,
    style?: TextStyle,
): ExprType<UIComponentType> {
    return createText(value, { ...LEAD_STYLE, ...style });
}

/**
 * Mono KPI — the big-number numeric display. 24 px mono tabular-nums
 * with semibold weight and tight letter-spacing.
 */
function createMonoKpi(
    value: SubtypeExprOrValue<StringType>,
    style?: TextStyle,
): ExprType<UIComponentType> {
    return createText(value, { ...MONO_KPI_STYLE, ...style });
}

/**
 * Text component for displaying styled text content.
 *
 * @remarks
 * Use `Text.Root(value, style)` to create text, or access `Text.Types.Text`
 * for the East type. All visual fields live inside the `style` sub-struct
 * (see the `{ content, style }` type-shape convention).
 *
 * Raw `fontSize` is **not** a public prop on Text — use the semantic
 * `textStyle` token (e.g. `"body-md"`, `"mono-kpi"`) instead. Migration
 * table lives on `TextStyle`'s JSDoc.
 *
 * `Text.Presets.*` provides opinionated style presets for the recurring
 * typographic patterns from the design spec (eyebrows, mono runs, labels).
 * Each preset accepts the same `style` arg as `Text.Root` and merges over
 * the preset values — caller wins.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Text.Root("Hello World", {
 *         textStyle: "body-md",
 *         color: "blue.500",
 *         fontWeight: "bold",
 *     });
 * });
 *
 * // Eyebrow preset — mono uppercase 11 px / 0.14 em / fg.muted
 * Text.Presets.Eyebrow("SELECTED · TAB1");
 * // Override the colour while keeping the preset shape
 * Text.Presets.Eyebrow("OPEN", { color: "fg" });
 * ```
 */
export const Text = {
    Root: createText,
    Presets: {
        Eyebrow: createEyebrow,
        EyebrowSm: createEyebrowSm,
        MonoSm: createMonoSm,
        MonoLabel: createMonoLabel,
        MetaSm: createMetaSm,
        Lead: createLead,
        MonoKpi: createMonoKpi,
    },
    Types: {
        Text: TextType,
        Style: TextVisualStyleType,
    },
} as const;
