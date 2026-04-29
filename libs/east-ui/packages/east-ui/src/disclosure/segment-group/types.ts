/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    BooleanType,
} from "@elaraai/east";

import {
    SizeType,
    ColorSchemeType,
    OrientationType,
    type SizeLiteral,
    type ColorSchemeLiteral,
    type OrientationLiteral,
} from "../../style.js";

// ============================================================================
// SegmentGroup Style Type
// ============================================================================

/**
 * Visual-only style struct for SegmentGroup. Content (`items`), state
 * (`value`), and behaviour (`onChange`) live on the main `SegmentGroup`
 * variant (inline in `component.ts` because of the item `label: node`
 * field).
 *
 * @remarks
 * Holds the visual preset triplet (`size` / `colorPalette` / `orientation`)
 * plus per-slot colour escape hatches for the container background /
 * border and active/inactive segment visuals.
 *
 * @property size - Size token (xs / sm / md / lg)
 * @property colorPalette - Colour scheme for theming
 * @property orientation - Segment direction (horizontal / vertical)
 * @property background - Container background colour
 * @property borderColor - Container border colour
 * @property activeBackground - Selected segment background
 * @property activeColor - Selected segment text colour
 * @property inactiveColor - Unselected segment text colour
 */
export const SegmentGroupStyleType = StructType({
    size: OptionType(SizeType),
    colorPalette: OptionType(ColorSchemeType),
    orientation: OptionType(OrientationType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    activeBackground: OptionType(StringType),
    activeColor: OptionType(StringType),
    inactiveColor: OptionType(StringType),
});

/**
 * Type representing the SegmentGroup visual-style structure.
 */
export type SegmentGroupStyleType = typeof SegmentGroupStyleType;

/**
 * TypeScript options bag for SegmentGroup's `style` sub-struct — visual props only.
 */
export interface SegmentGroupStyle {
    /** Size token (xs / sm / md / lg) */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Colour scheme for theming */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Segment direction */
    orientation?: SubtypeExprOrValue<OrientationType> | OrientationLiteral;
    /** Container background colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Container border colour */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Selected segment background */
    activeBackground?: SubtypeExprOrValue<StringType>;
    /** Selected segment text colour */
    activeColor?: SubtypeExprOrValue<StringType>;
    /** Unselected segment text colour */
    inactiveColor?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript options bag for `SegmentGroup.Item`.
 *
 * @property disabled - Whether this segment is disabled
 */
export interface SegmentGroupItemOptions {
    /** Whether this segment is disabled — renderer blocks interaction */
    disabled?: SubtypeExprOrValue<BooleanType>;
}
