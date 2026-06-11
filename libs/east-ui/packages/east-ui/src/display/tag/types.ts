/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    StringType,
    BooleanType,
    NullType,
    OptionType,
    StructType,
    VariantType,
    FunctionType,
    FloatType,
} from "@elaraai/east";

import { BorderStyleType, BorderWidthType, ColorSchemeType, DensityType, OverflowType, StyleVariantType } from "../../style.js";
import type { BorderStyleLiteral, BorderWidthLiteral, ColorSchemeLiteral, DensityLiteral, OverflowLiteral, StyleVariantLiteral } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Tag Size Type
// ============================================================================

/**
 * Size variant type for Tag component.
 *
 * @remarks
 * Tag supports sm, md, lg, and xl sizes (no xs).
 *
 * @property sm - Small size
 * @property md - Medium size (default)
 * @property lg - Large size
 * @property xl - Extra large size
 */
export const TagSizeType = VariantType({
    sm: NullType,
    md: NullType,
    lg: NullType,
    xl: NullType,
});

/** Type alias for Tag size variant. */
export type TagSizeType = typeof TagSizeType;

/** String-literal shorthand for Tag sizes. */
export type TagSizeLiteral = "sm" | "md" | "lg" | "xl";

// ============================================================================
// Tag Style
// ============================================================================

/**
 * East StructType holding every visual field for a Tag.
 *
 * @remarks
 * Per the east-ui type-shape convention, visual fields live in `style` and
 * are decoupled from the content (`label`) / state (`closable`) / behaviour
 * (`onClose`) on the main struct.
 *
 * @property variant - Visual preset — `solid` / `subtle` / `outline`
 * @property colorPalette - Colour palette token
 * @property size - Tag size (sm/md/lg/xl)
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
export const TagStyleType = StructType({
    variant: OptionType(StyleVariantType),
    colorPalette: OptionType(ColorSchemeType),
    size: OptionType(TagSizeType),
    opacity: OptionType(FloatType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderRadius: OptionType(StringType),
    borderWidth: OptionType(BorderWidthType),
    borderStyle: OptionType(BorderStyleType),
    borderColor: OptionType(StringType),
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

/** Type alias for the Tag style struct. */
export type TagStyleType = typeof TagStyleType;

// ============================================================================
// Tag Type
// ============================================================================

/**
 * East StructType for a Tag component value.
 *
 * @remarks
 * Main struct carries content (`label`), state (`closable`), behaviour
 * (`onClose`), and a single `style` sub-struct. Tags differ from Badges in
 * that they can be closable/removable.
 *
 * @property label - Tag text
 * @property closable - Whether a close button is rendered
 * @property onClose - Click callback on the close button
 * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
 * @property style - Optional visual style sub-struct
 */
export const TagType = StructType({
    label: StringType,
    closable: OptionType(BooleanType),
    onClose: OptionType(FunctionType([], NullType)),
    density: OptionType(DensityType),
    style: OptionType(TagStyleType),
});

/** Type alias for the Tag struct. */
export type TagType = typeof TagType;

// ============================================================================
// Tag TS options bag
// ============================================================================

/**
 * TypeScript options bag for `Tag.Root`.
 *
 * @remarks
 * Combines the two main-struct behaviour fields (`closable`, `onClose`) with
 * all style fields. The factory splits them internally.
 */
export interface TagStyle {
    /** Visual preset — `solid` / `subtle` / `outline` */
    variant?: SubtypeExprOrValue<StyleVariantType> | StyleVariantLiteral;
    /** Colour palette token */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Tag size (sm/md/lg/xl) */
    size?: SubtypeExprOrValue<TagSizeType> | TagSizeLiteral;
    /** Whether the tag shows a close button (main-struct state) */
    closable?: SubtypeExprOrValue<BooleanType>;
    /** Callback triggered when close button is clicked (main-struct behaviour) */
    onClose?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /**
     * Density override (main-struct). Inherited from the enclosing surface
     * (Table, ChipRail, …) when omitted; an explicit value wins over both the
     * cascade and `size`, sizing the tag to match rails and traces at the
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
