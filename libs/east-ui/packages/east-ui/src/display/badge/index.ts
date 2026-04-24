/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { BorderStyleType, BorderWidthType, SizeType, ColorSchemeType, StyleVariantType, OverflowType, JustifyContentType, AlignItemsType } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import { UIComponentType } from "../../component.js";
import { BadgeType, BadgeStyleType, type BadgeStyle } from "./types.js";

export { BadgeType, BadgeStyleType, type BadgeStyle } from "./types.js";

/**
 * Internal — wraps a flat `BadgeStyle` options bag into the nested
 * `BadgeStyleType` struct expected by the IR.
 *
 * @remarks
 * Returns `undefined` when every style field is absent so the caller can emit
 * `none` for the outer `style: OptionType(BadgeStyleType)` field.
 */
function buildBadgeStyle(style: BadgeStyle | undefined): ExprType<BadgeStyleType> | undefined {
    if (style === undefined) return undefined;

    const hasAny = style.variant !== undefined
        || style.colorPalette !== undefined
        || style.size !== undefined
        || style.opacity !== undefined
        || style.color !== undefined
        || style.background !== undefined
        || style.borderRadius !== undefined
        || style.borderWidth !== undefined
        || style.borderStyle !== undefined
        || style.borderColor !== undefined
        || style.overflow !== undefined
        || style.overflowX !== undefined
        || style.overflowY !== undefined
        || style.justifyContent !== undefined
        || style.alignItems !== undefined
        || style.width !== undefined
        || style.height !== undefined
        || style.minWidth !== undefined
        || style.minHeight !== undefined
        || style.maxWidth !== undefined
        || style.maxHeight !== undefined
        || style.padding !== undefined
        || style.margin !== undefined;
    if (!hasAny) return undefined;

    const variantValue = style.variant !== undefined
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), StyleVariantType)
            : style.variant)
        : undefined;
    const colorPaletteValue = style.colorPalette !== undefined
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;
    const sizeValue = style.size !== undefined
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;
    const borderWidthValue = style.borderWidth !== undefined
        ? (typeof style.borderWidth === "string"
            ? East.value(variant(style.borderWidth, null), BorderWidthType)
            : style.borderWidth)
        : undefined;
    const borderStyleValue = style.borderStyle !== undefined
        ? (typeof style.borderStyle === "string"
            ? East.value(variant(style.borderStyle, null), BorderStyleType)
            : style.borderStyle)
        : undefined;
    const overflowValue = style.overflow !== undefined
        ? (typeof style.overflow === "string"
            ? East.value(variant(style.overflow, null), OverflowType)
            : style.overflow)
        : undefined;
    const overflowXValue = style.overflowX !== undefined
        ? (typeof style.overflowX === "string"
            ? East.value(variant(style.overflowX, null), OverflowType)
            : style.overflowX)
        : undefined;
    const overflowYValue = style.overflowY !== undefined
        ? (typeof style.overflowY === "string"
            ? East.value(variant(style.overflowY, null), OverflowType)
            : style.overflowY)
        : undefined;
    const justifyContentValue = style.justifyContent !== undefined
        ? (typeof style.justifyContent === "string"
            ? East.value(variant(style.justifyContent, null), JustifyContentType)
            : style.justifyContent)
        : undefined;
    const alignItemsValue = style.alignItems !== undefined
        ? (typeof style.alignItems === "string"
            ? East.value(variant(style.alignItems, null), AlignItemsType)
            : style.alignItems)
        : undefined;
    const paddingValue = style.padding !== undefined
        ? (typeof style.padding === "string"
            ? East.value({
                top: some(style.padding),
                right: some(style.padding),
                bottom: some(style.padding),
                left: some(style.padding),
            }, PaddingType)
            : style.padding)
        : undefined;
    const marginValue = style.margin !== undefined
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
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        borderRadius: style.borderRadius !== undefined ? some(style.borderRadius) : none,
        borderWidth: borderWidthValue ? some(borderWidthValue) : none,
        borderStyle: borderStyleValue ? some(borderStyleValue) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        overflow: overflowValue ? some(overflowValue) : none,
        overflowX: overflowXValue ? some(overflowXValue) : none,
        overflowY: overflowYValue ? some(overflowYValue) : none,
        justifyContent: justifyContentValue ? some(justifyContentValue) : none,
        alignItems: alignItemsValue ? some(alignItemsValue) : none,
        width: style.width !== undefined ? some(style.width) : none,
        height: style.height !== undefined ? some(style.height) : none,
        minWidth: style.minWidth !== undefined ? some(style.minWidth) : none,
        minHeight: style.minHeight !== undefined ? some(style.minHeight) : none,
        maxWidth: style.maxWidth !== undefined ? some(style.maxWidth) : none,
        maxHeight: style.maxHeight !== undefined ? some(style.maxHeight) : none,
        padding: paddingValue ? some(paddingValue) : none,
        margin: marginValue ? some(marginValue) : none,
        opacity: style.opacity !== undefined ? some(style.opacity) : none,
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
    }, BadgeStyleType);
}

/**
 * Creates a Badge component value — a small pill used for short labels, status
 * indicators, or counts.
 *
 * @param value - The badge text content
 * @param style - Optional style fields (see {@link BadgeStyle})
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * Style fields are flattened at the call-site for ergonomics but internally
 * nest into a `style: OptionType(BadgeStyleType)` sub-struct on the IR (per
 * the east-ui type-shape convention).
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Badge, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Badge.Root("Active", { variant: "solid", colorPalette: "green" });
 * });
 * ```
 */
function createBadge(
    value: SubtypeExprOrValue<StringType>,
    style?: BadgeStyle,
): ExprType<UIComponentType> {
    const styleValue = buildBadgeStyle(style);
    return East.value(variant("Badge", {
        value,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Badge — small pill primitive for short labels, status, or counts.
 *
 * @remarks
 * `Badge.Root(value, style?)` creates the IR value. All visual options (see
 * `BadgeStyle`) are flattened at the call-site and the factory wraps them
 * into the nested `style` sub-struct.
 */
export const Badge = {
    /**
     * Creates a Badge component value.
     *
     * @param value - The badge text
     * @param style - Optional visual style fields
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Badge, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Badge.Root("New", { variant: "subtle", colorPalette: "blue" });
     * });
     * ```
     */
    Root: createBadge,
    Types: {
        /**
         * East StructType for a Badge component value — the serialisable IR
         * shape used by renderers and assertion tooling.
         *
         * @remarks
         * Main struct holds the badge text (`value`) and a single `style`
         * sub-struct per the east-ui type-shape convention. This is the same
         * type exported as `BadgeType` from `./types.js`; it is exposed here
         * so consumers can write `ValueTypeOf<typeof Badge.Types.Badge>` or
         * build `equalFor(Badge.Types.Badge)` comparisons without reaching
         * into the module's internal paths.
         *
         * @property value - The badge text content
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Badge: BadgeType,
        /**
         * East StructType holding every visual field for a Badge.
         *
         * @remarks
         * Mirror of `BadgeStyleType` from `./types.js`. Exposed on the
         * namespace so renderer code can deconstruct a badge value's style
         * sub-struct without re-importing the raw type.
         *
         * @property variant - Visual preset — `solid` / `subtle` / `outline`
         * @property colorPalette - Colour palette token
         * @property size - Badge size token
         * @property borderRadius - Corner radius
         * @property borderWidth - Border width token
         * @property borderStyle - Border style token
         * @property borderColor - Border colour
         * @property overflow - Overflow behaviour
         * @property overflowX - Horizontal overflow
         * @property overflowY - Vertical overflow
         * @property justifyContent - Flex justify-content
         * @property alignItems - Flex align-items
         * @property width - CSS width
         * @property height - CSS height
         * @property minWidth - CSS min-width
         * @property minHeight - CSS min-height
         * @property maxWidth - CSS max-width
         * @property maxHeight - CSS max-height
         * @property padding - Padding struct
         * @property margin - Margin struct
         * @property opacity - CSS opacity (0–1)
         * @property color - Explicit text colour override
         * @property background - Explicit background colour override
         */
        Style: BadgeStyleType,
    },
} as const;
