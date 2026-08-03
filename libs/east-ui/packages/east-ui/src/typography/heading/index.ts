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
    FontFamilyType,
    FontStyleType,
    FontWeightType,
    OverflowType,
    TextAlignType,
    TextDecorationType,
    TextStyleType as TypographyTextStyleType,
} from "../../style.js";
import { UIComponentType } from "../../component.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import {
    HeadingType,
    HeadingAsType,
    HeadingVisualStyleType,
    type HeadingStyle,
} from "./types.js";

// Re-export types
export {
    HeadingType,
    HeadingAsType,
    HeadingVisualStyleType,
    type HeadingStyle,
} from "./types.js";

// ============================================================================
// Heading Component
// ============================================================================

/**
 * Creates a Heading component for semantic headings.
 *
 * @param value - The heading text
 * @param style - Optional styling configuration (`as` is semantic and lands
 *                on the main struct; all visual fields land in `style`).
 * @returns An East expression representing the heading component
 */
function createHeading(
    value: SubtypeExprOrValue<StringType>,
    style?: HeadingStyle
): ExprType<UIComponentType> {
    const asValue = style?.as
        ? (typeof style.as === "string"
            ? East.value(variant(style.as, null), HeadingAsType)
            : style.as)
        : undefined;

    const styleValue = style ? buildHeadingVisualStyle(style) : undefined;

    return East.value(variant("Heading", {
        value: value,
        as: asValue ? variant("some", asValue) : variant("none", null),
        style: styleValue ? variant("some", styleValue) : variant("none", null),
    }), UIComponentType);
}

function buildHeadingVisualStyle(
    style: HeadingStyle,
): ExprType<HeadingVisualStyleType> {
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
        textAlign: textAlignValue ? some(textAlignValue) : none,
        textDecoration: textDecorationValue ? some(textDecorationValue) : none,
        lineHeight: style.lineHeight ? some(style.lineHeight) : none,
        letterSpacing: style.letterSpacing ? some(style.letterSpacing) : none,
        color: style.color ? some(style.color) : none,
        background: style.background ? some(style.background) : none,
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
    }, HeadingVisualStyleType);
}

/**
 * Heading component for semantic HTML headings.
 *
 * @remarks
 * Use `Heading.Root(value, style)` to create headings with semantic HTML
 * elements. `as` (h1–h6) stays on the main struct; every visual field lives
 * inside `style` per the `{ content, style }` type-shape convention.
 *
 * Raw `size` has been removed — use `textStyle: "heading-lg"` / `"display-md"`
 * etc. instead. Migration table lives on `HeadingStyle`'s JSDoc.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Heading, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Heading.Root("Welcome", {
 *         as: "h1",
 *         textStyle: "display-md",
 *         color: "link",
 *     });
 * });
 * ```
 */
export const Heading = {
    Root: createHeading,
    Types: {
        Heading: HeadingType,
        As: HeadingAsType,
        Style: HeadingVisualStyleType,
    },
} as const;
