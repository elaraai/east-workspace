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

// ============================================================================
// OptionList Style Type
// ============================================================================

/**
 * Visual-only style struct for OptionList. Content (`options` / `selectedId`)
 * and behaviour (`onSelect`) live on the main `OptionList` variant (inline
 * in `component.ts`).
 *
 * @property itemColor - Default text colour for option rows
 * @property itemHoverBackground - Row background on hover
 * @property selectedBackground - Background of the currently-selected row
 * @property borderColor - Border colour around the list and between rows
 * @property impactColor - Accent colour for the trailing impact/meta column
 */
export const OptionListStyleType = StructType({
    itemColor: OptionType(StringType),
    itemHoverBackground: OptionType(StringType),
    selectedBackground: OptionType(StringType),
    borderColor: OptionType(StringType),
    impactColor: OptionType(StringType),
});

export type OptionListStyleType = typeof OptionListStyleType;

/**
 * TypeScript options bag for OptionList's `style` sub-struct — visual props only.
 */
export interface OptionListStyle {
    /** Default text colour for option rows */
    itemColor?: SubtypeExprOrValue<StringType>;
    /** Row background on hover */
    itemHoverBackground?: SubtypeExprOrValue<StringType>;
    /** Background of the currently-selected row */
    selectedBackground?: SubtypeExprOrValue<StringType>;
    /** Border colour around the list and between rows */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Accent colour for the trailing impact/meta column */
    impactColor?: SubtypeExprOrValue<StringType>;
}
