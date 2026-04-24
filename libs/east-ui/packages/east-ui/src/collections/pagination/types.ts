/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

// ============================================================================
// PaginationVariantType
// ============================================================================

/**
 * East VariantType for the Pagination visual variant.
 *
 * @remarks
 * Controls how each page trigger is rendered. `outline` shows a
 * rectangular button outline around each page number; `subtle` uses a
 * low-contrast background only on hover / active.
 *
 * @property outline - Outlined button treatment
 * @property subtle - Subtle-background treatment (default)
 */
export const PaginationVariantType = VariantType({
    outline: NullType,
    subtle: NullType,
});

/** Type alias for PaginationVariantType. */
export type PaginationVariantType = typeof PaginationVariantType;

/** String literal type for PaginationVariantType values. */
export type PaginationVariantLiteral = "outline" | "subtle";

// ============================================================================
// PaginationSizeType
// ============================================================================

/**
 * East VariantType for the Pagination size preset.
 *
 * @remarks
 * Controls the size of page-number triggers and prev/next buttons.
 *
 * @property sm - Small (28px tall triggers)
 * @property md - Medium (36px tall triggers — default)
 * @property lg - Large (44px tall triggers)
 */
export const PaginationSizeType = VariantType({
    sm: NullType,
    md: NullType,
    lg: NullType,
});

/** Type alias for PaginationSizeType. */
export type PaginationSizeType = typeof PaginationSizeType;

/** String literal type for PaginationSizeType values. */
export type PaginationSizeLiteral = "sm" | "md" | "lg";

// ============================================================================
// PaginationStyleType
// ============================================================================

/**
 * East StructType holding every visual field for a Pagination
 * component.
 *
 * @remarks
 * Visual-only per §0.10. Content (`page` / `pageSize` / `count`) and
 * behaviour (`onPageChange`) live on the main `Pagination` variant.
 *
 * @property size - Size preset (sm / md / lg)
 * @property variant - Visual variant (outline / subtle)
 * @property color - Explicit text-colour override for inactive page triggers
 * @property background - Explicit background override for inactive page triggers
 * @property activeBackground - Background override for the active page trigger
 * @property activeColor - Text-colour override for the active page trigger
 * @property siblings - Number of sibling page triggers shown around the current page
 * @property boundaries - Number of boundary page triggers shown at the start/end
 */
export const PaginationStyleType = StructType({
    size: OptionType(PaginationSizeType),
    variant: OptionType(PaginationVariantType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    activeBackground: OptionType(StringType),
    activeColor: OptionType(StringType),
    siblings: OptionType(IntegerType),
    boundaries: OptionType(IntegerType),
});

/** Type alias for PaginationStyleType. */
export type PaginationStyleType = typeof PaginationStyleType;

// ============================================================================
// Pagination TS options bag
// ============================================================================

/**
 * TypeScript options bag for `Pagination.Root`.
 *
 * @remarks
 * Pure visual options — the main-struct fields (`page` / `pageSize` /
 * `count` / `onPageChange`) are explicit positional arguments to the
 * factory.
 *
 * @property size - Size preset (sm / md / lg)
 * @property variant - Visual variant (outline / subtle)
 * @property color - Explicit text colour for inactive page triggers
 * @property background - Explicit background for inactive page triggers
 * @property activeBackground - Background for the active page trigger
 * @property activeColor - Text colour for the active page trigger
 * @property siblings - Number of sibling page triggers shown around current page
 * @property boundaries - Number of boundary page triggers shown at the start/end
 */
export interface PaginationOptions {
    /** Size preset. Default `"md"`. */
    size?: SubtypeExprOrValue<PaginationSizeType> | PaginationSizeLiteral;
    /** Visual variant. Default `"subtle"`. */
    variant?: SubtypeExprOrValue<PaginationVariantType> | PaginationVariantLiteral;
    /** Explicit text-colour override for inactive page triggers. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit background override for inactive page triggers. */
    background?: SubtypeExprOrValue<StringType>;
    /** Background override for the active page trigger. */
    activeBackground?: SubtypeExprOrValue<StringType>;
    /** Text-colour override for the active page trigger. */
    activeColor?: SubtypeExprOrValue<StringType>;
    /** Number of sibling page triggers shown around the current page. */
    siblings?: SubtypeExprOrValue<IntegerType>;
    /** Number of boundary page triggers shown at the start/end. */
    boundaries?: SubtypeExprOrValue<IntegerType>;
}
