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

import { OverflowType, TextDecorationType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import {
    MarkType,
    MarkVariantType,
    MarkVisualStyleType,
    type MarkStyle,
} from "./types.js";

// Re-export types
export {
    MarkType,
    MarkVariantType,
    MarkVisualStyleType,
    type MarkStyle,
} from "./types.js";

// ============================================================================
// Mark Component
// ============================================================================

/**
 * Creates a Mark component for highlighted text (like HTML mark element).
 *
 * @param value - The text to mark/highlight
 * @param style - Optional visual-style configuration
 * @returns An East expression representing the mark component
 */
function createMark(
    value: SubtypeExprOrValue<StringType>,
    style?: MarkStyle
): ExprType<UIComponentType> {
    const styleValue = style ? buildMarkVisualStyle(style) : undefined;

    return East.value(variant("Mark", {
        value: value,
        style: styleValue ? variant("some", styleValue) : variant("none", null),
    }), UIComponentType);
}

function buildMarkVisualStyle(style: MarkStyle): ExprType<MarkVisualStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), MarkVariantType)
            : style.variant)
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
        color: style.color ? some(style.color) : none,
        background: style.background ? some(style.background) : none,
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
    }, MarkVisualStyleType);
}

/**
 * Mark component for highlighted/marked text.
 *
 * @remarks
 * Use `Mark.Root(value, style)` to create marked text similar to HTML `<mark>`.
 * All visual fields live inside the `style` sub-struct (see the
 * `{ content, style }` type-shape convention).
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Mark, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Mark.Root("Important text", {
 *         colorPalette: "yellow",
 *         variant: "subtle",
 *     });
 * });
 * ```
 */
export const Mark = {
    Root: createMark,
    Types: {
        Mark: MarkType,
        Variant: MarkVariantType,
        Style: MarkVisualStyleType,
    },
} as const;
