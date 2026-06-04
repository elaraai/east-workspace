/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { DensityType } from "../../style.js";
import type { DensityLiteral } from "../../style.js";

/**
 * Separator choice between chips.
 *
 * @property line - Thin vertical hairline
 * @property dot - Middle-dot character (·)
 * @property none - No separator (bare gap)
 */
export const ChipRailSeparatorType = VariantType({
    line: NullType,
    dot: NullType,
    none: NullType,
});
export type ChipRailSeparatorType = typeof ChipRailSeparatorType;
export type ChipRailSeparatorLiteral = "line" | "dot" | "none";

/**
 * Overflow behaviour when the rail can't fit every chip.
 *
 * @property wrap - Chips wrap to a second row (default)
 * @property scroll - Rail scrolls horizontally; chips stay on one line
 */
export const ChipRailOverflowType = VariantType({
    wrap: NullType,
    scroll: NullType,
});
export type ChipRailOverflowType = typeof ChipRailOverflowType;
export type ChipRailOverflowLiteral = "wrap" | "scroll";

/**
 * Style configuration for ChipRail.
 *
 * @property overflow - Overflow behaviour when the rail can't fit every chip
 * @property background - Rail background colour
 * @property separatorColor - Colour of the separator glyph / hairline
 * @property overflowTriggerColor - Colour of the overflow menu trigger (`⋯`)
 */
export const ChipRailStyleType = StructType({
    overflow: OptionType(ChipRailOverflowType),
    background: OptionType(StringType),
    separatorColor: OptionType(StringType),
    overflowTriggerColor: OptionType(StringType),
});
export type ChipRailStyleType = typeof ChipRailStyleType;

export interface ChipRailStyle {
    /** Overflow behaviour when the rail can't fit every chip. */
    overflow?: SubtypeExprOrValue<ChipRailOverflowType> | ChipRailOverflowLiteral;
    /** Rail background colour. */
    background?: SubtypeExprOrValue<StringType>;
    /** Colour of the separator glyph / hairline. */
    separatorColor?: SubtypeExprOrValue<StringType>;
    /** Colour of the overflow menu trigger (`⋯`). */
    overflowTriggerColor?: SubtypeExprOrValue<StringType>;
}

export interface ChipRailOptions extends ChipRailStyle {
    /**
     * Density (inherited via `DensityProvider` when omitted; per-rail override
     * always wins).
     */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Separator between chips. */
    separator?: SubtypeExprOrValue<ChipRailSeparatorType> | ChipRailSeparatorLiteral;
}
