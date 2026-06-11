/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    ArrayType,
    East,
    variant,
    some,
    none,
} from "@elaraai/east";

import { SizeType, ColorSchemeType, DensityType, OverflowType, StyleVariantType } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import { UIComponentType } from "../../component.js";
import { AvatarType, AvatarStyleType, type AvatarStyle } from "../avatar/types.js";
import {
    AvatarGroupType,
    AvatarGroupStyleType,
    type AvatarGroupOptions,
} from "./types.js";

export {
    AvatarGroupType,
    AvatarGroupStyleType,
    type AvatarGroupOptions,
} from "./types.js";

// ============================================================================
// Helpers
// ============================================================================

function buildAvatarGroupStyle(options: AvatarGroupOptions | undefined): ExprType<AvatarGroupStyleType> | undefined {
    if (options === undefined) return undefined;
    const hasAny = options.size !== undefined || options.borderColor !== undefined;
    if (!hasAny) return undefined;

    const sizeValue = options.size !== undefined
        ? (typeof options.size === "string"
            ? East.value(variant(options.size, null), SizeType)
            : options.size)
        : undefined;

    return East.value({
        size: sizeValue ? some(sizeValue) : none,
        borderColor: options.borderColor !== undefined ? some(options.borderColor) : none,
    }, AvatarGroupStyleType);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates an AvatarGroup component value — a cluster of overlapping
 * avatars with an optional `+N` overflow button after the `max`th
 * avatar.
 *
 * @param avatars - Array of `AvatarType` expressions
 * @param options - Optional `max` overflow threshold + visual style fields
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * Uses Chakra v3's `<AvatarGroup>` compound so the overlap ring +
 * `+N` button are picked up automatically. Shared `style.size` is
 * applied to every avatar in the group.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Avatar, AvatarGroup, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return AvatarGroup.Root([
 *         $.const(Avatar.Root({ name: "Alice" })),
 *         $.const(Avatar.Root({ name: "Bob" })),
 *         $.const(Avatar.Root({ name: "Carol" })),
 *         $.const(Avatar.Root({ name: "Dan" })),
 *         $.const(Avatar.Root({ name: "Eve" })),
 *     ], { max: 3n, size: "sm" });
 * });
 * ```
 */
function buildAvatar(style: AvatarStyle): ExprType<AvatarType> {
    const sizeValue = style.size !== undefined
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;
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

    const hasAnyStyle = sizeValue !== undefined
        || variantValue !== undefined
        || colorPaletteValue !== undefined
        || overflowValue !== undefined
        || overflowXValue !== undefined
        || overflowYValue !== undefined
        || paddingValue !== undefined
        || marginValue !== undefined
        || style.opacity !== undefined
        || style.borderRadius !== undefined
        || style.width !== undefined
        || style.height !== undefined
        || style.minWidth !== undefined
        || style.minHeight !== undefined
        || style.maxWidth !== undefined
        || style.maxHeight !== undefined
        || style.color !== undefined
        || style.background !== undefined
        || style.borderColor !== undefined;

    const styleExpr = hasAnyStyle
        ? East.value({
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
        }, AvatarStyleType)
        : undefined;

    const densityValue = style.density !== undefined
        ? (typeof style.density === "string"
            ? East.value(variant(style.density, null), DensityType)
            : style.density)
        : undefined;

    return East.value({
        src: style.src !== undefined ? some(style.src) : none,
        name: style.name !== undefined ? some(style.name) : none,
        density: densityValue ? some(densityValue) : none,
        style: styleExpr ? some(styleExpr) : none,
    }, AvatarType);
}

function createAvatarGroup(
    avatars: AvatarStyle[],
    options?: AvatarGroupOptions,
): ExprType<UIComponentType> {
    const avatarValues = avatars.map(buildAvatar);
    const styleValue = buildAvatarGroupStyle(options);
    const densityValue = options?.density !== undefined
        ? (typeof options.density === "string"
            ? East.value(variant(options.density, null), DensityType)
            : options.density)
        : undefined;

    return East.value(variant("AvatarGroup", {
        avatars: East.value(avatarValues, ArrayType(AvatarType)),
        max: options?.max !== undefined ? some(options.max) : none,
        density: densityValue ? some(densityValue) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface AvatarGroupNamespace {
    Root: typeof createAvatarGroup;
    Types: {
        AvatarGroup: typeof AvatarGroupType;
        Style: typeof AvatarGroupStyleType;
    };
}

/**
 * AvatarGroup — cluster of overlapping avatars with optional `+N`
 * overflow.
 */
export const AvatarGroup: AvatarGroupNamespace = {
    /**
     * Creates an AvatarGroup component value.
     *
     * @param avatars - Array of `AvatarType` expressions
     * @param options - Optional `max` + visual style fields
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Avatar, AvatarGroup, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return AvatarGroup.Root([
     *         Avatar.Root({ name: "Alice" }),
     *         Avatar.Root({ name: "Bob" }),
     *     ]);
     * });
     * ```
     */
    Root: createAvatarGroup,
    Types: {
        /**
         * East StructType for an AvatarGroup value.
         *
         * @property avatars - Array of Avatar values
         * @property max - Optional overflow threshold
         * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
         * @property style - Optional visual style sub-struct
         */
        AvatarGroup: AvatarGroupType,
        /**
         * East StructType holding every visual field for an AvatarGroup.
         *
         * @property size - Shared avatar size preset
         * @property borderColor - Overlap ring colour override
         */
        Style: AvatarGroupStyleType,
    },
};
