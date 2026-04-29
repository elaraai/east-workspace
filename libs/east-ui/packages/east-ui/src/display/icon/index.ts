/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    East,
    variant,
    some,
    none,
} from "@elaraai/east";

import type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";

import { ColorSchemeType, OverflowType } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import { UIComponentType } from "../../component.js";
import {
    IconSizeType,
    IconVariantType,
    IconStyleType,
    IconType,
    type IconStyle,
} from "./types.js";

export {
    IconSizeType,
    IconVariantType,
    IconStyleType,
    IconType,
    type IconSizeLiteral,
    type IconVariantLiteral,
    type IconStyle,
    type IconName,
} from "./types.js";

/**
 * Internal — wraps a flat `IconStyle`'s visual fields into an `IconStyleType`
 * struct expression. Returns `undefined` when no visual field is set so the
 * caller can emit `none` for the outer `style: OptionType(IconStyleType)`.
 *
 * @remarks
 * Does NOT read `style.label` — that field belongs on the main struct and
 * is consumed directly by `createIcon`.
 */
function buildIconStyle(style: IconStyle | undefined): ExprType<IconStyleType> | undefined {
    if (style === undefined) return undefined;

    const hasAny = style.size !== undefined
        || style.variant !== undefined
        || style.color !== undefined
        || style.background !== undefined
        || style.colorPalette !== undefined
        || style.opacity !== undefined
        || style.borderRadius !== undefined
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

    const sizeValue = style.size !== undefined
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), IconSizeType)
            : style.size)
        : undefined;
    const variantValue = style.variant !== undefined
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), IconVariantType)
            : style.variant)
        : undefined;
    const colorPaletteValue = style.colorPalette !== undefined
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
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
        size: sizeValue ? some(sizeValue) : none,
        variant: variantValue ? some(variantValue) : none,
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        opacity: style.opacity !== undefined ? some(style.opacity) : none,
        borderRadius: style.borderRadius !== undefined ? some(style.borderRadius) : none,
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
    }, IconStyleType);
}

/**
 * Creates an Icon component value — a Font Awesome icon with optional
 * styling and accessible labelling.
 *
 * @param prefix - The Font Awesome icon prefix (`"fas"`, `"far"`, `"fab"`, …)
 * @param name - The Font Awesome icon name (`"user"`, `"home"`, `"chevron-right"`, …)
 * @param style - Optional `label` (a11y) + visual style fields (see {@link IconStyle})
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * **Accessibility contract:** the renderer reads `label` from the
 * main IR struct. When `label` is absent, the rendered SVG carries
 * `aria-hidden="true"` (purely decorative); when present, it carries
 * `aria-label={label}`. Apps pairing Icon with adjacent text that already
 * describes the glyph should leave `label` unset.
 *
 * Both `prefix` and `name` are type-safe via Font Awesome's TypeScript
 * types. Common prefixes: `fas` (solid), `far` (regular / outlined),
 * `fab` (brand).
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Icon, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Icon.Root("fas", "user", { label: "User profile", size: "lg" });
 * });
 * ```
 */
function createIcon(
    prefix: IconPrefix,
    name: IconName,
    style?: IconStyle,
): ExprType<UIComponentType> {
    const styleValue = buildIconStyle(style);
    return East.value(variant("Icon", {
        prefix,
        name,
        label: style?.label !== undefined ? some(style.label) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Icon — Font Awesome icon primitive.
 *
 * @remarks
 * Use `Icon.Root(prefix, name, { label?, ...style })` to create an icon, or
 * access `Icon.Types.Icon` for the East IR type.
 */
export const Icon = {
    /**
     * Creates an Icon component value.
     *
     * @param prefix - Font Awesome prefix (`"fas"`, `"far"`, `"fab"`, …)
     * @param name - Font Awesome icon name
     * @param style - Optional `label` (a11y) + visual style fields
     * @returns An East expression of type `UIComponentType`
     *
     * @remarks
     * Pass `label` for meaningful icons (rendered with `aria-label`); omit
     * it for decorative icons (rendered with `aria-hidden="true"`).
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Icon, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Icon.Root("fas", "heart", { label: "Favourite", color: "red.500", size: "xl" });
     * });
     * ```
     */
    Root: createIcon,
    Types: {
        /**
         * East StructType for an Icon component value — the serialisable IR
         * shape.
         *
         * @remarks
         * Main struct carries the Font Awesome identity (`prefix` / `name`),
         * the a11y `label` (decorative-vs-meaningful contract), and a
         * `style` sub-struct for visual presentation per the main/style
         * type-shape convention.
         *
         * @property prefix - Font Awesome prefix (`"fas"`, `"far"`, `"fab"`, …)
         * @property name - Font Awesome icon name
         * @property label - Accessible label — absent ⇒ decorative (aria-hidden), present ⇒ aria-label
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Icon: IconType,
        /**
         * East StructType holding every visual field for an Icon.
         *
         * @remarks
         * Mirror of `IconStyleType` from `./types.js`. Covers size /
         * variant / colour-palette presets plus two explicit colour slots
         * (tint + tile background), opacity, border-radius, overflow,
         * dimensions, and padding / margin.
         *
         * @property size - Icon size (xs / sm / md / lg / xl / 2xl)
         * @property variant - Font Awesome style / weight (solid / regular / light / thin / brands)
         * @property color - Icon tint
         * @property background - Icon tile background
         * @property colorPalette - Colour palette token
         * @property opacity - CSS opacity (0–1)
         * @property borderRadius - Corner radius
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
        Style: IconStyleType,
        /**
         * Icon size variant — maps to Font Awesome size classes.
         *
         * @remarks
         * Mirror of `IconSizeType` from `./types.js`.
         *
         * @property xs - Extra small icon
         * @property sm - Small icon
         * @property md - Medium icon (default)
         * @property lg - Large icon
         * @property xl - Extra large icon
         * @property 2xl - 2× large icon
         */
        Size: IconSizeType,
        /**
         * Font Awesome icon style / weight variant.
         *
         * @remarks
         * Mirror of `IconVariantType` from `./types.js`. `light` and
         * `thin` require FA Pro; `solid` / `regular` / `brands` ship in
         * the free tier.
         *
         * @property solid - Solid filled icons (`fas`)
         * @property regular - Regular outlined icons (`far`)
         * @property light - Light weight icons (`fal`) — requires FA Pro
         * @property thin - Thin weight icons (`fat`) — requires FA Pro
         * @property brands - Brand logos (`fab`)
         */
        Variant: IconVariantType,
    },
} as const;
