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
    LinkType,
    LinkVariantType,
    LinkVisualStyleType,
    type LinkStyle,
} from "./types.js";

// Re-export types
export {
    LinkType,
    LinkVariantType,
    LinkVisualStyleType,
    type LinkStyle,
} from "./types.js";

// ============================================================================
// Link Component
// ============================================================================

/**
 * Creates a Link component for navigation.
 *
 * @param value - The link text to display
 * @param href - URL the link points to
 * @param style - Optional configuration: `external` is state (new-tab),
 *                everything else is visual and wrapped into `style` in the IR.
 * @returns An East expression representing the link component
 */
function createLink(
    value: SubtypeExprOrValue<StringType>,
    href: SubtypeExprOrValue<StringType>,
    style?: LinkStyle
): ExprType<UIComponentType> {
    const externalValue = style?.external !== undefined ? style.external : undefined;

    const styleValue = style ? buildLinkVisualStyle(style) : undefined;

    return East.value(variant("Link", {
        value: value,
        href: href,
        external: externalValue !== undefined ? variant("some", externalValue) : variant("none", null),
        style: styleValue ? variant("some", styleValue) : variant("none", null),
    }), UIComponentType);
}

function buildLinkVisualStyle(style: LinkStyle): ExprType<LinkVisualStyleType> {
    const variantValue = style.variant
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), LinkVariantType)
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
        hoverColor: style.hoverColor ? some(style.hoverColor) : none,
        visitedColor: style.visitedColor ? some(style.visitedColor) : none,
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
    }, LinkVisualStyleType);
}

/**
 * Link component for accessible navigation.
 *
 * @remarks
 * Use `Link.Root(value, href, style)` to create navigation links.
 * `external` is state (opens in a new tab); every visual field lives inside
 * the `style` sub-struct (see the `{ content, style }` type-shape convention).
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Link, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Link.Root("Visit our site", "https://example.com", {
 *         external: true,
 *         colorPalette: "blue",
 *     });
 * });
 * ```
 */
export const Link = {
    Root: createLink,
    Types: {
        Link: LinkType,
        Variant: LinkVariantType,
        Style: LinkVisualStyleType,
    },
} as const;
