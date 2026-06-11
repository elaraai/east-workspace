/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    FloatType,
} from "@elaraai/east";

import { BorderStyleType, BorderWidthType, DensityType, OverflowType, SizeType, ColorSchemeType, StyleVariantType, JustifyContentType, AlignItemsType } from "../../style.js";
import type { BorderStyleLiteral, BorderWidthLiteral, DensityLiteral, OverflowLiteral, SizeLiteral, ColorSchemeLiteral, StyleVariantLiteral, JustifyContentLiteral, AlignItemsLiteral } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Badge Style
// ============================================================================

/**
 * East StructType holding every visual field for a Badge.
 *
 * @remarks
 * Per the `east-ui` type-shape convention (README §Type-shape convention), a
 * Badge splits into **content on the main struct** (just `value`) and **every
 * visual field inside `style`**. This matches the uniform main/style split
 * used by Button, Card, Alert, etc.
 *
 * @property variant - Visual preset — `solid` / `subtle` / `outline`
 * @property colorPalette - Colour palette token (blue, green, red, …)
 * @property size - Badge size token
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
 * @property justifyContent - Flex justify-content
 * @property alignItems - Flex align-items
 * @property width - CSS width
 * @property height - CSS height
 * @property minWidth - CSS min-width
 * @property minHeight - CSS min-height
 * @property maxWidth - CSS max-width
 * @property maxHeight - CSS max-height
 * @property padding - Padding struct (top/right/bottom/left)
 * @property margin - Margin struct (top/right/bottom/left)
 */
export const BadgeStyleType = StructType({
    // Visual presets
    variant: OptionType(StyleVariantType),
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(SizeType),
    // Shape / layout
    borderRadius: OptionType(StringType),
    borderWidth: OptionType(BorderWidthType),
    borderStyle: OptionType(BorderStyleType),
    borderColor: OptionType(StringType),
    overflow: OptionType(OverflowType),
    overflowX: OptionType(OverflowType),
    overflowY: OptionType(OverflowType),
    justifyContent: OptionType(JustifyContentType),
    alignItems: OptionType(AlignItemsType),
    width: OptionType(StringType),
    height: OptionType(StringType),
    minWidth: OptionType(StringType),
    minHeight: OptionType(StringType),
    maxWidth: OptionType(StringType),
    maxHeight: OptionType(StringType),
    padding: OptionType(PaddingType),
    margin: OptionType(MarginType),
    opacity: OptionType(FloatType),
    // Colour escape hatches
    color: OptionType(StringType),
    background: OptionType(StringType),
});

/** Type alias for the Badge style struct. */
export type BadgeStyleType = typeof BadgeStyleType;

// ============================================================================
// Badge Type
// ============================================================================

/**
 * East StructType for a Badge component value — the persistent IR shape.
 *
 * @remarks
 * Main struct carries the badge text (`value`) and a single `style` sub-struct
 * holding every visual field. Use `Badge.Root(value, { ...style })` in TS —
 * the factory wraps flat style fields into the nested `style` shape.
 *
 * @property value - The badge text content
 * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
 * @property style - Optional style sub-struct (see `BadgeStyleType`)
 */
export const BadgeType = StructType({
    value: StringType,
    density: OptionType(DensityType),
    style: OptionType(BadgeStyleType),
});

/** Type alias for the Badge struct. */
export type BadgeType = typeof BadgeType;

// ============================================================================
// Badge Style (TS options bag — ergonomic factory input)
// ============================================================================

/**
 * TypeScript options bag accepted by `Badge.Root` — a flat mirror of
 * `BadgeStyleType`.
 *
 * @remarks
 * All fields are optional. Variant / colour palette / size / border style /
 * border width / overflow accept their string-literal union shorthand so
 * callers write `{ variant: "solid" }` instead of constructing the variant
 * expression by hand.
 */
export interface BadgeStyle {
    /** Visual preset — `solid` / `subtle` / `outline` */
    variant?: SubtypeExprOrValue<StyleVariantType> | StyleVariantLiteral;
    /** Colour palette token */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Badge size token */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /**
     * Density override (main-struct). Inherited from the enclosing surface
     * (Table, ChipRail, …) when omitted; an explicit value wins over both the
     * cascade and `size`, sizing the badge to match rails and traces at the
     * same density.
     */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** CSS opacity (0–1) */
    opacity?: SubtypeExprOrValue<FloatType>;
    /** Explicit text colour override */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit background colour override */
    background?: SubtypeExprOrValue<StringType>;
    /** Corner radius */
    borderRadius?: SubtypeExprOrValue<StringType>;
    /** Border width token */
    borderWidth?: SubtypeExprOrValue<BorderWidthType> | BorderWidthLiteral;
    /** Border style token */
    borderStyle?: SubtypeExprOrValue<BorderStyleType> | BorderStyleLiteral;
    /** Border colour */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Overflow behaviour */
    overflow?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Horizontal overflow */
    overflowX?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Vertical overflow */
    overflowY?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Flex justify-content */
    justifyContent?: SubtypeExprOrValue<JustifyContentType> | JustifyContentLiteral;
    /** Flex align-items */
    alignItems?: SubtypeExprOrValue<AlignItemsType> | AlignItemsLiteral;
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
    /** Padding (struct or shorthand string for all four sides) */
    padding?: SubtypeExprOrValue<PaddingType> | string;
    /** Margin (struct or shorthand string for all four sides) */
    margin?: SubtypeExprOrValue<MarginType> | string;
}
