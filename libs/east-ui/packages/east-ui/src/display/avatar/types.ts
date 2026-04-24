/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    FloatType,
    StringType,
    OptionType,
    StructType,
} from "@elaraai/east";

import { ColorSchemeType, OverflowType, StyleVariantType, SizeType } from "../../style.js";
import type { ColorSchemeLiteral, OverflowLiteral, StyleVariantLiteral, SizeLiteral } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Avatar Style
// ============================================================================

/**
 * East StructType for the Avatar style sub-struct.
 *
 * @remarks
 * Visual-only per the type-shape convention. `src` and `name` stay on the
 * main struct; every visual field (presets, colour slots, sizing, overflow,
 * padding, margin) is here.
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
export const AvatarStyleType = StructType({
    variant: OptionType(StyleVariantType),
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    opacity: OptionType(FloatType),
    borderRadius: OptionType(StringType),
    overflow: OptionType(OverflowType),
    overflowX: OptionType(OverflowType),
    overflowY: OptionType(OverflowType),
    width: OptionType(StringType),
    height: OptionType(StringType),
    minWidth: OptionType(StringType),
    minHeight: OptionType(StringType),
    maxWidth: OptionType(StringType),
    maxHeight: OptionType(StringType),
    padding: OptionType(PaddingType),
    margin: OptionType(MarginType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
});

/** Type alias for the Avatar style struct. */
export type AvatarStyleType = typeof AvatarStyleType;

// ============================================================================
// Avatar Type
// ============================================================================

/**
 * East StructType for an Avatar component value.
 *
 * @remarks
 * Main struct carries `src` + `name` (content); every visual field lives
 * under `style: OptionType(AvatarStyleType)`.
 *
 * @property src - Image URL for the avatar (main-struct content)
 * @property name - User name for initials fallback (main-struct content)
 * @property style - Optional visual style sub-struct
 */
export const AvatarType = StructType({
    src: OptionType(StringType),
    name: OptionType(StringType),
    style: OptionType(AvatarStyleType),
});

/** Type alias for the Avatar struct. */
export type AvatarType = typeof AvatarType;

// ============================================================================
// Avatar TS options bag
// ============================================================================

/**
 * TypeScript options bag for `Avatar.Root`.
 *
 * @remarks
 * Combines main-struct content (`src`, `name`) with flat style fields. The
 * factory splits them into the nested IR shape internally.
 */
export interface AvatarStyle {
    /** Image URL (main-struct content) */
    src?: SubtypeExprOrValue<StringType>;
    /** User name (main-struct content, used for initials fallback) */
    name?: SubtypeExprOrValue<StringType>;
    /** Visual preset — `solid` / `subtle` / `outline` */
    variant?: SubtypeExprOrValue<StyleVariantType> | StyleVariantLiteral;
    /** Colour palette for the fallback tile */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Avatar size token */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** CSS opacity (0–1) */
    opacity?: SubtypeExprOrValue<FloatType>;
    /** Corner radius */
    borderRadius?: SubtypeExprOrValue<StringType>;
    /** Overflow behaviour */
    overflow?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Horizontal overflow */
    overflowX?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Vertical overflow */
    overflowY?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** CSS width */
    width?: SubtypeExprOrValue<StringType>;
    /** CSS height */
    height?: SubtypeExprOrValue<StringType>;
    /** CSS min-width */
    minWidth?: SubtypeExprOrValue<StringType>;
    /** CSS min-height */
    minHeight?: SubtypeExprOrValue<StringType>;
    /** CSS max-width */
    maxWidth?: SubtypeExprOrValue<StringType>;
    /** CSS max-height */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Padding (struct or shorthand for all 4 sides) */
    padding?: SubtypeExprOrValue<PaddingType> | string;
    /** Margin (struct or shorthand for all 4 sides) */
    margin?: SubtypeExprOrValue<MarginType> | string;
    /** Initials text colour override */
    color?: SubtypeExprOrValue<StringType>;
    /** Fallback tile background override */
    background?: SubtypeExprOrValue<StringType>;
    /** Ring / border colour */
    borderColor?: SubtypeExprOrValue<StringType>;
}
