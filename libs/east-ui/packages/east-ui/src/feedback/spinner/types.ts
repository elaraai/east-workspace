/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
} from "@elaraai/east";

import { SizeType, ColorSchemeType } from "../../style.js";
import type { SizeLiteral, ColorSchemeLiteral } from "../../style.js";

// ============================================================================
// Spinner Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for Spinner. Spinner has no content / behaviour —
 * the whole main variant is effectively a `style` wrapper per §0.10.
 *
 * @property size - Size preset (sm / md / lg)
 * @property colorPalette - Chakra color palette token
 * @property thickness - Stroke width
 * @property speed - Rotation period (e.g. "0.65s")
 * @property color - Active stroke colour
 * @property trackColor - Faint background ring colour
 */
export const SpinnerStyleType = StructType({
    size: OptionType(SizeType),
    colorPalette: OptionType(ColorSchemeType),
    thickness: OptionType(StringType),
    speed: OptionType(StringType),
    color: OptionType(StringType),
    trackColor: OptionType(StringType),
});

export type SpinnerStyleType = typeof SpinnerStyleType;

/**
 * Spinner IR type — main struct is effectively just the `style` wrapper.
 *
 * @property style - Optional visual-only style
 */
export const SpinnerType = StructType({
    style: OptionType(SpinnerStyleType),
});

export type SpinnerType = typeof SpinnerType;

/**
 * TypeScript options bag for Spinner's `style` sub-struct — visual props only.
 */
export interface SpinnerStyle {
    /** Size preset (sm / md / lg) */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Chakra color palette token */
    colorPalette?: SubtypeExprOrValue<ColorSchemeType> | ColorSchemeLiteral;
    /** Stroke width */
    thickness?: SubtypeExprOrValue<StringType>;
    /** Rotation period (e.g. `"0.65s"`) */
    speed?: SubtypeExprOrValue<StringType>;
    /** Active stroke colour */
    color?: SubtypeExprOrValue<StringType>;
    /** Faint background ring colour */
    trackColor?: SubtypeExprOrValue<StringType>;
}
