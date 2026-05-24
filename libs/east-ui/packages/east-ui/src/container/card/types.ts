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

import { OverflowType } from "../../style.js";
import type { OverflowLiteral } from "../../style.js";

// ============================================================================
// Card Style Type
// ============================================================================

/**
 * Type for Card style properties.
 *
 * @remarks
 * The card is the one container shape (bsys Frame): 1px rule, 10px radius,
 * paper fill, no shadow. Style fields are layout / dimension only plus colour
 * escape hatches — there are no shape or shadow variants.
 *
 * @property height - Height (Chakra UI size token or CSS value)
 * @property minHeight - Min height (Chakra UI size token or CSS value)
 * @property maxHeight - Max height (Chakra UI size token or CSS value)
 * @property width - Width (Chakra UI size token or CSS value)
 * @property minWidth - Min width (Chakra UI size token or CSS value)
 * @property maxWidth - Max width (Chakra UI size token or CSS value)
 * @property flex - Flex property for grow/shrink behavior
 * @property overflow - Overflow behavior (visible, hidden, scroll, auto)
 * @property background - Card background colour escape hatch
 * @property borderColor - Border colour escape hatch
 * @property headerBackground - Background applied to the header strip
 * @property footerBackground - Background applied to the footer strip
 * @property accentColor - Left-edge accent stripe colour
 */
export const CardStyleType = StructType({
    height: OptionType(StringType),
    minHeight: OptionType(StringType),
    maxHeight: OptionType(StringType),
    width: OptionType(StringType),
    minWidth: OptionType(StringType),
    maxWidth: OptionType(StringType),
    flex: OptionType(StringType),
    overflow: OptionType(OverflowType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    headerBackground: OptionType(StringType),
    footerBackground: OptionType(StringType),
    accentColor: OptionType(StringType),
});

/**
 * Type representing the CardStyle structure.
 */
export type CardStyleType = typeof CardStyleType;

// ============================================================================
// Card Style Interface
// ============================================================================

/**
 * TypeScript interface for Card style options.
 *
 * @property height - Height (Chakra UI size token or CSS value)
 * @property minHeight - Min height (Chakra UI size token or CSS value)
 * @property maxHeight - Max height (Chakra UI size token or CSS value)
 * @property width - Width (Chakra UI size token or CSS value)
 * @property minWidth - Min width (Chakra UI size token or CSS value)
 * @property maxWidth - Max width (Chakra UI size token or CSS value)
 * @property flex - Flex property for grow/shrink behavior
 * @property overflow - Overflow behavior (visible, hidden, scroll, auto)
 * @property background - Card background colour escape hatch
 * @property borderColor - Border colour escape hatch
 * @property headerBackground - Background applied to the header strip
 * @property footerBackground - Background applied to the footer strip
 * @property accentColor - Left / top accent stripe colour
 */
export interface CardStyle {
    /** Height (Chakra UI size token or CSS value) */
    height?: SubtypeExprOrValue<StringType>;
    /** Min height (Chakra UI size token or CSS value) */
    minHeight?: SubtypeExprOrValue<StringType>;
    /** Max height (Chakra UI size token or CSS value) */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Width (Chakra UI size token or CSS value) */
    width?: SubtypeExprOrValue<StringType>;
    /** Min width (Chakra UI size token or CSS value) */
    minWidth?: SubtypeExprOrValue<StringType>;
    /** Max width (Chakra UI size token or CSS value) */
    maxWidth?: SubtypeExprOrValue<StringType>;
    /** Flex property for grow/shrink behavior (e.g., "1", "1 1 auto") */
    flex?: SubtypeExprOrValue<StringType>;
    /** Overflow behavior (visible, hidden, scroll, auto) */
    overflow?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Card background colour escape hatch */
    background?: SubtypeExprOrValue<StringType>;
    /** Border colour escape hatch */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Background applied to the header strip */
    headerBackground?: SubtypeExprOrValue<StringType>;
    /** Background applied to the footer strip */
    footerBackground?: SubtypeExprOrValue<StringType>;
    /** Left / top accent stripe colour */
    accentColor?: SubtypeExprOrValue<StringType>;
}
