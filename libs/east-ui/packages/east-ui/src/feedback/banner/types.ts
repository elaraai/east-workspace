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

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";
import { AlertVariantType } from "../alert/types.js";
import type { AlertVariantLiteral } from "../alert/types.js";

// ============================================================================
// Banner Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for Banner.
 *
 * @property variant - Visual preset (reuses Alert's variant set)
 * @property size - Size preset (sm / md / lg)
 * @property color - Text colour
 * @property background - Background colour
 * @property borderColor - Border colour
 * @property iconColor - Colour of the leading paired icon
 * @property accentColor - Prominent left / top accent stripe
 */
export const BannerStyleType = StructType({
    variant: OptionType(AlertVariantType),
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
    /** Visual preset (reuses Alert's variant set) */
    variant?: SubtypeExprOrValue<AlertVariantType> | AlertVariantLiteral;
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
