/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
    East,
    StringType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { DensityType, SizeType, ColorSchemeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    KbdType,
    KbdStyleType,
    KbdVariantType,
    type KbdStyle,
} from "./types.js";

export {
    KbdType,
    KbdStyleType,
    KbdVariantType,
    type KbdStyle,
    type KbdVariantLiteral,
} from "./types.js";

// ============================================================================
// Helpers
// ============================================================================

function buildKbdStyle(style: KbdStyle | undefined): ExprType<KbdStyleType> | undefined {
    if (style === undefined) return undefined;
    const hasAny = style.variant !== undefined
        || style.size !== undefined
        || style.colorPalette !== undefined
        || style.color !== undefined
        || style.background !== undefined
        || style.borderColor !== undefined
        || style.shadowColor !== undefined;
    if (!hasAny) return undefined;

    const variantValue = style.variant !== undefined
        ? (typeof style.variant === "string"
            ? East.value(variant(style.variant, null), KbdVariantType)
            : style.variant)
        : undefined;
    const sizeValue = style.size !== undefined
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;
    const colorPaletteValue = style.colorPalette !== undefined
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    return East.value({
        variant: variantValue ? some(variantValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        color: style.color !== undefined ? some(style.color) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        shadowColor: style.shadowColor !== undefined ? some(style.shadowColor) : none,
    }, KbdStyleType);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a Kbd component value — a keyboard-key pill (or chord of
 * multiple keys separated by `+`).
 *
 * @param keys - Array of key strings (e.g. `["⌘", "K"]`)
 * @param style - Optional visual style fields (see {@link KbdStyle})
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * Multi-key chords are rendered with `+` separators between each key.
 * The default visual preset is `subtle`; override via `style.variant`.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Kbd, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Kbd.Root(["⌘", "K"]);
 * });
 * ```
 */
function createKbd(
    keys: SubtypeExprOrValue<ArrayType<StringType>>,
    style?: KbdStyle,
): ExprType<UIComponentType> {
    const styleValue = buildKbdStyle(style);
    const densityValue = style?.density !== undefined
        ? (typeof style.density === "string"
            ? East.value(variant(style.density, null), DensityType)
            : style.density)
        : undefined;
    return East.value(variant("Kbd", {
        keys,
        density: densityValue ? some(densityValue) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface KbdNamespace {
    Root: typeof createKbd;
    Types: {
        Kbd: typeof KbdType;
        Style: typeof KbdStyleType;
        Variant: typeof KbdVariantType;
    };
}

/**
 * Kbd — keyboard-key pill primitive.
 *
 * @remarks
 * Use `Kbd.Root(keys, style?)`. Multi-key chords are rendered with `+`
 * separators.
 */
export const Kbd: KbdNamespace = {
    /**
     * Creates a Kbd component value.
     *
     * @param keys - Array of key strings
     * @param style - Optional visual style fields
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Kbd, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Kbd.Root(["Ctrl", "Shift", "P"], { variant: "solid", size: "md" });
     * });
     * ```
     */
    Root: createKbd,
    Types: {
        /**
         * East StructType for a Kbd value — the serialisable IR shape.
         *
         * @remarks
         * Exposed on the namespace so consumers can reference the IR type
         * via `Kbd.Types.Kbd` without reaching into module internals.
         *
         * @property keys - Array of key strings (e.g. `["⌘", "K"]`)
         * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
         * @property style - Optional visual style sub-struct (see `Style`)
         */
        Kbd: KbdType,
        /**
         * East StructType holding every visual field for a Kbd.
         *
         * @remarks
         * Mirror of `KbdStyleType` from `./types.js`. Includes variant /
         * size / palette presets and explicit colour slots (text,
         * background, border, shadow).
         *
         * @property variant - Visual preset (solid / subtle / outline)
         * @property size - Size preset
         * @property colorPalette - Chakra colour palette token
         * @property color - Explicit text colour override
         * @property background - Explicit background override
         * @property borderColor - Explicit border colour override
         * @property shadowColor - Explicit drop-shadow colour override
         */
        Style: KbdStyleType,
        /**
         * Visual preset variant for Kbd.
         *
         * @property solid - Solid filled background
         * @property subtle - Tinted background (default)
         * @property outline - Outline only, transparent background
         */
        Variant: KbdVariantType,
    },
};
