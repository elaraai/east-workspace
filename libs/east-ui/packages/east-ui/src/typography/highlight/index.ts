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
    HighlightType,
    HighlightVisualStyleType,
    type HighlightStyle,
} from "./types.js";

// Re-export types
export {
    HighlightType,
    HighlightVisualStyleType,
    type HighlightStyle,
} from "./types.js";

// ============================================================================
// Highlight Component
// ============================================================================

/**
 * Creates a Highlight component for highlighting text portions.
 *
 * @param value - The text containing content to highlight
 * @param style - Style configuration. `query` is required (the terms to
 *                highlight); every other field is visual and wrapped into
 *                `style` in the IR.
 * @returns An East expression representing the highlight component
 */
function createHighlight(
    value: SubtypeExprOrValue<StringType>,
    style: HighlightStyle,
): ExprType<UIComponentType> {
    const { query, ...visual } = style;
    const hasVisual = Object.values(visual).some(field => field !== undefined);
    const styleValue = hasVisual ? buildHighlightVisualStyle(style) : undefined;

    return East.value(variant("Highlight", {
        value: value,
        query: query,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildHighlightVisualStyle(
    style: HighlightStyle,
): ExprType<HighlightVisualStyleType> {
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
    }, HighlightVisualStyleType);
}

/**
 * Highlight component for highlighting portions of text.
 *
 * @remarks
 * Use `Highlight.Root(value, style)` to highlight matching text. `query` is
 * required (the terms to highlight); all visual fields live inside the `style`
 * sub-struct.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Highlight, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Highlight.Root("Search results for: react components", {
 *         query: ["react", "components"],
 *         background: "yellow.200",
 *     });
 * });
 * ```
 */
export const Highlight = {
    Root: createHighlight,
    Types: {
        Highlight: HighlightType,
        Style: HighlightVisualStyleType,
    },
} as const;
