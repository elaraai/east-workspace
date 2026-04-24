/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    NullType,
    VariantType,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";

// ============================================================================
// Status Value Type
// ============================================================================

/**
 * Semantic classification for a Status chip. Drives the default paired icon
 * (§0.3) and colour palette.
 *
 * @property success - Success / up-to-date classification
 * @property warning - Warning classification
 * @property danger - Danger / error classification
 * @property info - Informational classification
 * @property neutral - Neutral / idle classification
 */
export const StatusValueType = VariantType({
    success: NullType,
    warning: NullType,
    danger: NullType,
    info: NullType,
    neutral: NullType,
});

export type StatusValueType = typeof StatusValueType;

/** String literal type for status values. */
export type StatusValueLiteral = "success" | "warning" | "danger" | "info" | "neutral";

// ============================================================================
// Status Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for Status.
 *
 * @property size - Size preset (sm / md / lg)
 * @property color - Default text colour
 * @property background - Background colour
 * @property borderColor - Border colour
 * @property dotColor - Colour of the leading indicator dot
 */
export const StatusStyleType = StructType({
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    dotColor: OptionType(StringType),
});

export type StatusStyleType = typeof StatusStyleType;

/**
 * TypeScript options bag for Status's `style` sub-struct — visual props only.
 */
export interface StatusStyle {
    /** Size preset (sm / md / lg) */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Default text colour */
    color?: SubtypeExprOrValue<StringType>;
    /** Background colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Border colour */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Colour of the leading indicator dot */
    dotColor?: SubtypeExprOrValue<StringType>;
}

