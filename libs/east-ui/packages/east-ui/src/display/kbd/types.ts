/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    ArrayType,
    NullType,
    OptionType,
    StructType,
    StringType,
    VariantType,
} from "@elaraai/east";

import { DensityType, SizeType, ColorSchemeType } from "../../style.js";
import type { DensityLiteral, SizeLiteral, ColorSchemeLiteral } from "../../style.js";

// ============================================================================
// Kbd Variant
// ============================================================================

/**
 * Visual preset variant for Kbd.
 *
 * @remarks
 * Maps to Chakra v3's `Kbd` variant prop.
 *
 * @property solid - Solid filled background
 * @property subtle - Tinted background (default)
 * @property outline - Outline only, transparent background
 */
export const KbdVariantType = VariantType({
    solid: NullType,
    subtle: NullType,
    outline: NullType,
});

/** Type alias for Kbd variant. */
export type KbdVariantType = typeof KbdVariantType;

/** String-literal shorthand for Kbd variant. */
export type KbdVariantLiteral = "solid" | "subtle" | "outline";

// ============================================================================
// Kbd Style
// ============================================================================

/**
 * East StructType for the Kbd style sub-struct.
 *
 * @remarks
 * Visual-only. The keys themselves (`keys` array of strings)
 * live on the main `KbdType` struct.
 *
 * @property variant - Visual preset (solid / subtle / outline)
 * @property size - Size preset
 * @property colorPalette - Chakra colour palette token
 * @property color - Explicit text colour override
 * @property background - Explicit background override
 * @property borderColor - Explicit border colour override
 * @property shadowColor - Explicit drop-shadow colour override
 */
export const KbdStyleType = StructType({
    variant: OptionType(KbdVariantType),
    size: OptionType(SizeType),
    colorPalette: OptionType(ColorSchemeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    shadowColor: OptionType(StringType),
});

/** Type alias for the Kbd style struct. */
export type KbdStyleType = typeof KbdStyleType;

// ============================================================================
// Kbd Type
// ============================================================================

/**
 * East StructType for a Kbd component value — the serialisable IR shape.
 *
 * @remarks
 * Main struct holds just `keys` (array of key strings). Multi-key chords
 * are rendered with `+` separators between each key.
 *
 * @property keys - Array of key strings (e.g. `["⌘", "K"]`)
 * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
 * @property style - Optional visual style sub-struct (see `KbdStyleType`)
 */
export const KbdType = StructType({
    keys: ArrayType(StringType),
    density: OptionType(DensityType),
    style: OptionType(KbdStyleType),
});

/** Type alias for the Kbd struct. */
export type KbdType = typeof KbdType;

// ============================================================================
// Kbd TS options bag
// ============================================================================

/**
 * TypeScript options bag for `Kbd.Root`.
 *
 * @remarks
 * Flat mirror of `KbdStyleType` — all visual style fields. `keys` is a
 * required main-struct field and sits on the factory signature
 * directly.
 *
 * @property variant - Visual preset (solid / subtle / outline)
 * @property size - Size preset
 * @property density - Density override shared with the `ChipRail` / `Trace` cascade
 * @property colorPalette - Chakra colour palette token
 * @property color - Explicit text colour override
 * @property background - Explicit background override
 * @property borderColor - Explicit border colour override
 * @property shadowColor - Explicit drop-shadow colour override
 */
export interface KbdStyle {
    /** Visual preset (solid / subtle / outline). */
    variant?: SubtypeExprOrValue<KbdVariantType> | KbdVariantLiteral;
    /** Size preset. */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /**
     * Density override (main-struct). Inherited from the enclosing surface
     * (Table, ChipRail, …) when omitted; an explicit value wins over both the
     * cascade and `size`, sizing the key caps to match rails and traces at
     * the same density.
     */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Chakra colour palette token. */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Explicit text colour override. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit background override. */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour override. */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit drop-shadow colour override. */
    shadowColor?: SubtypeExprOrValue<StringType>;
}
