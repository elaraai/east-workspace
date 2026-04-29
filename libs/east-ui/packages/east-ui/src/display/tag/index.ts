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

import { BorderStyleType, BorderWidthType, ColorSchemeType, StyleVariantType, OverflowType } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import { UIComponentType } from "../../component.js";
import { TagType, TagStyleType, TagSizeType, type TagStyle } from "./types.js";

export {
    TagType,
    TagStyleType,
    TagSizeType,
    type TagStyle,
    type TagSizeLiteral,
} from "./types.js";

/**
 * Internal — wraps a flat `TagStyle` into a `TagStyleType` struct expression.
 *
 * @remarks
 * Emits `undefined` when no style field is set so the caller can pick `none`
 * for the outer `style: OptionType(TagStyleType)`.
 */
function buildTagStyle(style: TagStyle | undefined): ExprType<TagStyleType> | undefined {
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
            ? East.value(variant(style.size, null), TagSizeType)
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
        opacity: style.opacity !== undefined ? some(style.opacity) : none,
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderRadius: style.borderRadius !== undefined ? some(style.borderRadius) : none,
        borderWidth: borderWidthValue ? some(borderWidthValue) : none,
        borderStyle: borderStyleValue ? some(borderStyleValue) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        overflow: overflowValue ? some(overflowValue) : none,
        overflowX: overflowXValue ? some(overflowXValue) : none,
        overflowY: overflowYValue ? some(overflowYValue) : none,
        width: style.width !== undefined ? some(style.width) : none,
        height: style.height !== undefined ? some(style.height) : none,
        minWidth: style.minWidth !== undefined ? some(style.minWidth) : none,
        minHeight: style.minHeight !== undefined ? some(style.minHeight) : none,
        maxWidth: style.maxWidth !== undefined ? some(style.maxWidth) : none,
        maxHeight: style.maxHeight !== undefined ? some(style.maxHeight) : none,
        padding: paddingValue ? some(paddingValue) : none,
        margin: marginValue ? some(marginValue) : none,
    }, TagStyleType);
}

/**
 * Creates a Tag component value — a closable pill used for categorisation,
 * filtering, and labelling.
 *
 * @param label - The tag text content
 * @param style - Optional behaviour + style fields (see {@link TagStyle})
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * `closable` + `onClose` sit on the main struct (state + behaviour); every
 * visual field nests inside `style: OptionType(TagStyleType)`.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Tag, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Tag.Root("Featured", {
 *         colorPalette: "blue",
 *         variant: "solid",
 *     });
 * });
 * ```
 */
function createTag(
    label: SubtypeExprOrValue<StringType>,
    style?: TagStyle,
): ExprType<UIComponentType> {
    const styleValue = buildTagStyle(style);
    return East.value(variant("Tag", {
        label,
        closable: style?.closable !== undefined ? some(style.closable) : none,
        onClose: style?.onClose !== undefined ? some(style.onClose) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Tag — closable pill primitive for categorisation / filtering / labelling.
 *
 * @remarks
 * Use `Tag.Root(label, { closable, onClose, ...style })`. `Tag.Types.Tag`
 * exposes the East type.
 */
export const Tag = {
    /**
     * Creates a Tag component value.
     *
     * @param label - Tag text
     * @param style - Optional behaviour + visual style fields
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East, NullType } from "@elaraai/east";
     * import { Tag, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     const onClose = $.const(East.function([], NullType, _ => {}));
     *     return Tag.Root("Beta", { closable: true, onClose, variant: "subtle" });
     * });
     * ```
     */
    Root: createTag,
    Types: {
        /**
         * East StructType for a Tag component value — the serialisable IR
         * shape used by renderers and assertion tooling.
         *
         * @remarks
         * Main struct holds the tag text (`label`), the closable state
         * (`closable`), the close-button callback (`onClose`), and a single
         * `style` sub-struct holding every visual field. Exposed on the namespace so consumers can reference
         * the IR type directly via `Tag.Types.Tag` without reaching into
         * module internals.
         *
         * @property label - The tag text content
         * @property closable - Whether the tag shows a close button
         * @property onClose - Callback invoked when the close button fires
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Tag: TagType,
        /**
         * East StructType holding every visual field for a Tag.
         *
         * @remarks
         * Mirror of `TagStyleType` from `./types.js`. Exposed on the
         * namespace so renderer code can deconstruct a tag value's style
         * sub-struct without re-importing the raw type.
         *
         * @property variant - Visual preset — `solid` / `subtle` / `outline`
         * @property colorPalette - Colour palette token
         * @property size - Tag size (sm / md / lg / xl)
         * @property opacity - CSS opacity (0–1)
         * @property color - Explicit text colour override
         * @property background - Explicit background colour override
         * @property borderRadius - Corner radius
         * @property borderWidth - Border width token
         * @property borderStyle - Border style token
         * @property borderColor - Border colour
         * @property overflow - Overflow behaviour
         * @property overflowX - Horizontal overflow
         * @property overflowY - Vertical overflow
         * @property width - CSS width
         * @property height - CSS height
         * @property minWidth - CSS min-width
         * @property minHeight - CSS min-height
         * @property maxWidth - CSS max-width
         * @property maxHeight - CSS max-height
         * @property padding - Padding struct
         * @property margin - Margin struct
         */
        Style: TagStyleType,
        /**
         * Size variant type for Tag.
         *
         * @remarks
         * Tag supports `sm` / `md` / `lg` / `xl` — a distinct set from the
         * global `SizeType` (xs→2xl) because Chakra v3's Tag compound only
         * accepts these four.
         *
         * @property sm - Small size
         * @property md - Medium size (default)
         * @property lg - Large size
         * @property xl - Extra large size
         */
        Size: TagSizeType,
    },
} as const;
