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

import { OverflowType, SizeType, TextDecorationType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import {
    CodeType,
    CodeVariantType,
    CodeVisualStyleType,
    type CodeStyle,
} from "./types.js";

// Re-export types
export {
    CodeType,
    CodeVariantType,
    CodeVisualStyleType,
    type CodeStyle,
} from "./types.js";

// ============================================================================
// Code Component
// ============================================================================

/**
 * Creates a Code component for displaying inline code.
 *
 * @param value - The code text to display
 * @param style - Optional visual-style configuration
 * @returns An East expression representing the code component
 */
function createCode(
    value: SubtypeExprOrValue<StringType>,
    style?: CodeStyle
): ExprType<UIComponentType> {
    const styleValue = style ? buildCodeVisualStyle(style) : undefined;

    return East.value(variant("Code", {
        value: value,
        style: styleValue ? variant("some", styleValue) : variant("none", null),
    }), UIComponentType);
}

function buildCodeVisualStyle(style: CodeStyle): ExprType<CodeVisualStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), CodeVariantType)
            : style.variant)
        : undefined;

    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
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
        variant: variantValue ? some(variantValue) : none,
        colorPalette: style.colorPalette ? some(style.colorPalette) : none,
        size: sizeValue ? some(sizeValue) : none,
        color: style.color ? some(style.color) : none,
        background: style.background ? some(style.background) : none,
        borderColor: style.borderColor ? some(style.borderColor) : none,
        textDecoration: textDecorationValue ? some(textDecorationValue) : none,
        lineHeight: style.lineHeight ? some(style.lineHeight) : none,
        letterSpacing: style.letterSpacing ? some(style.letterSpacing) : none,
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
    }, CodeVisualStyleType);
}

/**
 * Code component for displaying inline code snippets.
 *
 * @remarks
 * Use `Code.Root(value, style)` to create inline code display.
 * All visual fields live inside the `style` sub-struct (see the
 * `{ content, style }` type-shape convention).
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Code, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Code.Root("const x = 42", {
 *         colorPalette: "purple",
 *         variant: "surface",
 *     });
 * });
 * ```
 */
export const Code = {
    Root: createCode,
    Types: {
        Code: CodeType,
        Variant: CodeVariantType,
        Style: CodeVisualStyleType,
    },
} as const;
