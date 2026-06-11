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

import { ColorSchemeType, DensityType, StyleVariantType, SizeType, OverflowType } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import { UIComponentType } from "../../component.js";
import { AvatarType, AvatarStyleType, type AvatarStyle } from "./types.js";

export { AvatarType, AvatarStyleType, type AvatarStyle } from "./types.js";

/**
 * Internal — wraps a flat `AvatarStyle` into a `AvatarStyleType` struct
 * expression. Returns `undefined` when no visual field is set.
 */
function buildAvatarStyle(style: AvatarStyle | undefined): ExprType<AvatarStyleType> | undefined {
    if (style === undefined) return undefined;

    const hasAny = style.variant !== undefined
        || style.colorPalette !== undefined
        || style.size !== undefined
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
        || style.margin !== undefined
        || style.color !== undefined
        || style.background !== undefined
        || style.borderColor !== undefined;
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
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
    }, AvatarStyleType);
}

/**
 * Creates an Avatar component value — a user's profile image with an
 * initials fallback.
 *
 * @param options - Combined content (src/name) + visual style fields
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * `src` and `name` are main-struct content; every visual field nests inside
 * `style: OptionType(AvatarStyleType)`.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Avatar, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Avatar.Root({ name: "Jane Smith", colorPalette: "blue", size: "lg" });
 * });
 * ```
 */
function createAvatar(options?: AvatarStyle): ExprType<UIComponentType> {
    const styleValue = buildAvatarStyle(options);
    const densityValue = options?.density !== undefined
        ? (typeof options.density === "string"
            ? East.value(variant(options.density, null), DensityType)
            : options.density)
        : undefined;
    return East.value(variant("Avatar", {
        src: options?.src !== undefined ? some(options.src) : none,
        name: options?.name !== undefined ? some(options.name) : none,
        density: densityValue ? some(densityValue) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

/**
 * Avatar — user-profile image primitive with initials fallback.
 *
 * @remarks
 * Use `Avatar.Root({ src?, name?, ...style })`.
 */
export const Avatar = {
    /**
     * Creates an Avatar component value.
     *
     * @param options - Content (src, name) + visual style fields
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Avatar, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Avatar.Root({ src: "https://example.com/a.jpg", name: "Alex" });
     * });
     * ```
     */
    Root: createAvatar,
    Types: {
        /**
         * East StructType for an Avatar component value — the serialisable
         * IR shape used by renderers and assertion tooling.
         *
         * @remarks
         * Main struct holds image source (`src`) and display name (`name`)
         * plus a single `style` sub-struct holding every visual field per
         * the type-shape convention. Exposed on the namespace so consumers
         * can reference the IR type directly via `Avatar.Types.Avatar`.
         *
         * @property src - Image URL (main-struct content)
         * @property name - User name for initials fallback (main-struct content)
         * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Avatar: AvatarType,
        /**
         * East StructType holding every visual field for an Avatar.
         *
         * @remarks
         * Mirror of `AvatarStyleType` from `./types.js`. Exposed on the
         * namespace so renderer code can deconstruct an avatar value's
         * style sub-struct without re-importing the raw type.
         *
         * @property variant - Visual preset — `solid` / `subtle` / `outline`
         * @property colorPalette - Colour palette for the fallback tile
         * @property size - Avatar size token
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
         * @property color - Initials text colour override
         * @property background - Fallback tile background override
         * @property borderColor - Ring / border colour
         */
        Style: AvatarStyleType,
    },
} as const;
