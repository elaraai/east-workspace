/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    IntegerType,
    NullType,
    VariantType,
} from "@elaraai/east";

// ============================================================================
// Skeleton Shape Type
// ============================================================================

/**
 * Skeleton shape variant — determines which underlying Chakra primitive
 * is used.
 *
 * @property text - Horizontal lines, typically for paragraphs of text
 * @property rect - Rectangle, typically for images / banner blocks / buttons
 * @property circle - Circle, typically for avatars
 */
export const SkeletonShapeType = VariantType({
    text: NullType,
    rect: NullType,
    circle: NullType,
});

export type SkeletonShapeType = typeof SkeletonShapeType;

/** String literal type for skeleton shape. */
export type SkeletonShapeLiteral = "text" | "rect" | "circle";

// ============================================================================
// Skeleton Style Type — visual presentation only (§0.10)
// ============================================================================

/**
 * Visual-only style struct for Skeleton.
 *
 * @property width - Skeleton width (CSS length)
 * @property height - Skeleton height (CSS length)
 * @property background - Base colour
 * @property shimmerColor - Shimmer animation highlight colour
 */
export const SkeletonStyleType = StructType({
    width: OptionType(StringType),
    height: OptionType(StringType),
    background: OptionType(StringType),
    shimmerColor: OptionType(StringType),
});

export type SkeletonStyleType = typeof SkeletonStyleType;

// ============================================================================
// Skeleton IR type
// ============================================================================

/**
 * Skeleton IR — `shape` determines identity; dimensions and colours live
 * in `style` per the Type-shape convention (§0.10).
 *
 * @property shape - Visual shape (text / rect / circle)
 * @property lines - Number of text lines (only meaningful when `shape === "text"`)
 * @property fontSize - Text line font-size (only meaningful when `shape === "text"`)
 * @property count - Repeat the skeleton `count` times (wrapped in a VStack)
 * @property style - Optional visual-only style
 */
export const SkeletonType = StructType({
    shape: SkeletonShapeType,
    lines: OptionType(IntegerType),
    fontSize: OptionType(StringType),
    count: OptionType(IntegerType),
    style: OptionType(SkeletonStyleType),
});

export type SkeletonType = typeof SkeletonType;

/**
 * TypeScript options bag for Skeleton's `style` sub-struct — visual props only.
 */
export interface SkeletonStyle {
    /** Skeleton width (CSS length) */
    width?: SubtypeExprOrValue<StringType>;
    /** Skeleton height (CSS length) */
    height?: SubtypeExprOrValue<StringType>;
    /** Base colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Shimmer animation highlight colour */
    shimmerColor?: SubtypeExprOrValue<StringType>;
}
