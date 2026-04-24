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

// ============================================================================
// EmptyState Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for EmptyState. Content (`title` / `description` /
 * `icon` / `actions`) lives on the main `EmptyState` variant (inline in
 * `component.ts`) per the Type-shape convention (§0.10).
 *
 * @property size - Size preset (sm / md / lg)
 * @property color - Default text colour
 * @property background - Background colour
 * @property borderColor - Border colour
 * @property iconColor - Colour of the leading indicator icon
 */
export const EmptyStateStyleType = StructType({
    size: OptionType(SizeType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    iconColor: OptionType(StringType),
});

export type EmptyStateStyleType = typeof EmptyStateStyleType;

/**
 * TypeScript options bag for EmptyState's `style` sub-struct — visual props only.
 *
 * @property size - Size preset (sm / md / lg)
 * @property color - Default text colour
 * @property background - Background colour
 * @property borderColor - Border colour
 * @property iconColor - Colour of the leading indicator icon
 */
export interface EmptyStateStyle {
    /** Size preset (sm / md / lg) */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Default text colour */
    color?: SubtypeExprOrValue<StringType>;
    /** Background colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Border colour */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Colour of the leading indicator icon */
    iconColor?: SubtypeExprOrValue<StringType>;
}
