/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    NullType,
    OptionType,
    StructType,
    StringType,
    VariantType,
    variant,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";

// ============================================================================
// Banner Variant Type (visual preset — lives under style)
// ============================================================================

/**
 * Visual preset for Banner.
 *
 * @property solid - Solid background banner (escape hatch — high-emphasis only)
 * @property subtle - Subtle/light background banner (default, paper-2 + status border)
 * @property outline - Bordered banner with paper background
 */
export const BannerVariantType = VariantType({
    solid: NullType,
    subtle: NullType,
    outline: NullType,
});

export type BannerVariantType = typeof BannerVariantType;

/** String literal type for banner variant values. */
export type BannerVariantLiteral = "solid" | "subtle" | "outline";

/**
 * Helper function to create banner variant values.
 *
 * @param v - The variant string
 * @returns An East expression representing the banner variant
 */
export function BannerVariant(v: BannerVariantLiteral): ExprType<BannerVariantType> {
    return East.value(variant(v, null), BannerVariantType);
}

// ============================================================================
// Banner Style Type
// ============================================================================

/**
 * Visual-only style struct for Banner.
 *
 * @property variant - Visual preset (subtle / solid / outline)
 * @property size - Size preset (sm / md / lg)
 * @property color - Text colour
 * @property background - Background colour
 * @property borderColor - Border colour
 * @property iconColor - Colour of the leading paired icon
 * @property accentColor - Prominent left / top accent stripe
 */
export const BannerStyleType = StructType({
    variant: OptionType(BannerVariantType),
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    iconColor: OptionType(StringType),
    accentColor: OptionType(StringType),
});

export type BannerStyleType = typeof BannerStyleType;

/**
 * TypeScript options bag for Banner's `style` sub-struct — visual props only.
 */
export interface BannerStyle {
    /** Visual preset (subtle / solid / outline) */
    variant?: SubtypeExprOrValue<BannerVariantType> | BannerVariantLiteral;
    /** Size preset (sm / md / lg) */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Text colour */
    color?: SubtypeExprOrValue<StringType>;
    /** Background colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Border colour */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Colour of the leading paired icon */
    iconColor?: SubtypeExprOrValue<StringType>;
    /** Prominent left / top accent stripe */
    accentColor?: SubtypeExprOrValue<StringType>;
}
