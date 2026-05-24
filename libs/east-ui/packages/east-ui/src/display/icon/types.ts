/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    FloatType,
    NullType,
    OptionType,
    StructType,
    StringType,
    VariantType,
} from "@elaraai/east";

import { ColorSchemeType, OverflowType } from "../../style.js";
import type { ColorSchemeLiteral, OverflowLiteral } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";

// Re-export Font Awesome types for convenience
export type { IconName, IconPrefix } from "@fortawesome/fontawesome-common-types";

// ============================================================================
// Icon Size Type
// ============================================================================

/**
 * Size options for Icon component.
 *
 * @remarks
 * Maps to Font Awesome size classes.
 *
 * @property xs - Extra small icon
 * @property sm - Small icon
 * @property md - Medium icon (default)
 * @property lg - Large icon
 * @property xl - Extra large icon
 * @property 2xl - 2x large icon
 */
export const IconSizeType = VariantType({
    /** Extra small icon */
    xs: NullType,
    /** Small icon */
    sm: NullType,
    /** Medium icon (default) */
    md: NullType,
    /** Large icon */
    lg: NullType,
    /** Extra large icon */
    xl: NullType,
    /** 2x large icon */
    "2xl": NullType,
});

/**
 * Type representing the IconSize structure.
 */
export type IconSizeType = typeof IconSizeType;

/**
 * String literal type for icon size values.
 */
export type IconSizeLiteral = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

// ============================================================================
// Icon Style Type (Font Awesome style/prefix)
// ============================================================================

/**
 * Font Awesome icon style/variant.
 *
 * @remarks
 * Determines which icon set to use.
 *
 * @property solid - Solid filled icons (fas)
 * @property regular - Regular outlined icons (far)
 * @property light - Light weight icons (fal) - requires FA Pro
 * @property thin - Thin weight icons (fat) - requires FA Pro
 * @property brands - Brand logos (fab)
 */
export const IconVariantType = VariantType({
    /** Solid filled icons (fas) */
    solid: NullType,
    /** Regular outlined icons (far) */
    regular: NullType,
    /** Light weight icons (fal) - requires FA Pro */
    light: NullType,
    /** Thin weight icons (fat) - requires FA Pro */
    thin: NullType,
    /** Brand logos (fab) */
    brands: NullType,
});

/**
 * Type representing the IconVariant structure.
 */
export type IconVariantType = typeof IconVariantType;

/**
 * String literal type for icon variant values.
 */
export type IconVariantLiteral = "solid" | "regular" | "light" | "thin" | "brands";

// ============================================================================
// Icon Style Type (component styling)
// ============================================================================

/**
 * Style type for the Icon component.
 *
 * @remarks
 * All properties are optional and wrapped in {@link OptionType}. Visual-only
 * per the east-ui main/style type-shape convention — content
 * (`prefix` / `name`) and the a11y `label` live on the main `IconType`
 * struct.
 *
 * @property size - Icon size (xs / sm / md / lg / xl / 2xl)
 * @property variant - Icon style / weight (solid / regular / light / thin / brands)
 * @property color - Explicit icon tint (CSS colour or Chakra colour token)
 * @property background - Explicit icon tile background override
 * @property colorPalette - Colour palette for the icon
 * @property opacity - CSS opacity (0–1)
 * @property borderRadius - Corner radius of the icon tile
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
export const IconStyleType = StructType({
    size: OptionType(IconSizeType),
    variant: OptionType(IconVariantType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    colorPalette: OptionType(ColorSchemeType),
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
});

/**
 * Type representing the IconStyle structure.
 */
export type IconStyleType = typeof IconStyleType;

/**
 * TypeScript interface for Icon style options.
 *
 * @remarks
 * Flat options bag accepted by `Icon.Root`. The factory coerces string
 * literals to variant expressions and wraps the whole bag into the nested
 * `IconStyleType` sub-struct expected by the IR.
 *
 * @property size - Icon size (xs / sm / md / lg / xl / 2xl)
 * @property variant - Icon style / weight (solid / regular / light / thin / brands)
 * @property color - Icon tint (CSS colour or Chakra colour token)
 * @property background - Icon tile background colour
 * @property colorPalette - Colour palette for the icon
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
 * @property padding - Padding (struct or shorthand for all 4 sides)
 * @property margin - Margin (struct or shorthand for all 4 sides)
 */
export interface IconStyle {
    /**
     * Accessible label. When present, the renderer emits
     * `aria-label={label}`; when absent, the renderer emits
     * `aria-hidden="true"` (decorative).
     *
     * @remarks
     * Main-struct field on the IR; exposed on this options bag for
     * call-site ergonomics alongside visual style fields.
     */
    label?: SubtypeExprOrValue<StringType>;
    /** Icon size (xs / sm / md / lg / xl / 2xl) */
    size?: SubtypeExprOrValue<IconSizeType> | IconSizeLiteral;
    /** Icon style / weight (solid / regular / light / thin / brands) */
    variant?: SubtypeExprOrValue<IconVariantType> | IconVariantLiteral;
    /** Icon tint (CSS colour or Chakra colour token) */
    color?: SubtypeExprOrValue<StringType>;
    /** Icon tile background colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Colour palette for the icon */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
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
}

// ============================================================================
// Icon Type
// ============================================================================

/**
 * Type for Icon component data.
 *
 * @remarks
 * Icon displays a Font Awesome icon. Main struct holds the Font Awesome
 * prefix + name (identity), an optional `label` for accessibility, and a
 * `style` sub-struct for visual presentation.
 *
 * The `label` field follows the east-ui decorative-vs-meaningful
 * contract: when `label` is absent (`none`), the renderer emits
 * `aria-hidden="true"`; when present, the renderer emits
 * `aria-label={label}`. Apps using Icon alongside text that already
 * describes the glyph should leave `label` unset.
 *
 * @property prefix - Font Awesome prefix (e.g. "fas", "far", "fab")
 * @property name - Font Awesome icon name (e.g. "user", "home", "chevron-right")
 * @property label - Accessible label — absent ⇒ decorative (aria-hidden), present ⇒ aria-label
 * @property style - Optional visual style sub-struct (see {@link IconStyleType})
 */
export const IconType = StructType({
    name: StringType,
    prefix: StringType,
    label: OptionType(StringType),
    style: OptionType(IconStyleType),
});

/**
 * Type representing the Icon structure.
 */
export type IconType = typeof IconType;
