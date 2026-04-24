/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    East,
    variant,
} from "@elaraai/east";

import { OrientationType } from "../../style.js";
import type { OrientationLiteral } from "../../style.js";

// ============================================================================
// DataList Variant Type
// ============================================================================

/**
 * Variant types for DataList visual style.
 *
 * @property subtle - Light/subtle styling
 * @property bold - Bold/emphasized styling
 */
export const DataListVariantType = VariantType({
    /** Light/subtle styling */
    subtle: NullType,
    /** Bold/emphasized styling */
    bold: NullType,
});

/**
 * Type representing the DataListVariant structure.
 */
export type DataListVariantType = typeof DataListVariantType;

/**
 * String literal type for data list variant values.
 */
export type DataListVariantLiteral = "subtle" | "bold";

/**
 * Helper function to create data list variant values.
 *
 * @param v - The variant string ("subtle" or "bold")
 * @returns An East expression representing the data list variant
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { DataList, DataListVariant, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return DataList.Root([
 *         { label: "Status", value: Text.Root("Active") },
 *     ], {
 *         variant: DataListVariant("bold"),
 *     });
 * });
 * ```
 */
export function DataListVariant(v: "subtle" | "bold"): ExprType<DataListVariantType> {
    return East.value(variant(v, null), DataListVariantType);
}

// ============================================================================
// DataList Size Type
// ============================================================================

/**
 * Size options for DataList component.
 *
 * @remarks
 * Chakra UI DataList only supports sm, md, lg sizes (not xs).
 *
 * @property sm - Small data list
 * @property md - Medium data list (default)
 * @property lg - Large data list
 */
export const DataListSizeType = VariantType({
    /** Small data list */
    sm: NullType,
    /** Medium data list (default) */
    md: NullType,
    /** Large data list */
    lg: NullType,
});

/**
 * Type representing the DataListSize structure.
 */
export type DataListSizeType = typeof DataListSizeType;

/**
 * String literal type for data list size values.
 */
export type DataListSizeLiteral = "sm" | "md" | "lg";

// ============================================================================
// DataList Style Type (visual-only per §0.10)
// ============================================================================

/**
 * East StructType for the DataList style sub-struct.
 *
 * @remarks
 * Visual-only per the east-ui main/style type-shape convention. Content
 * (`items`) lives on the main `DataList` variant; every visual field —
 * the layout-preset `orientation`, the size / variant presets, and four
 * colour slots — lives here.
 *
 * @property orientation - Layout direction (horizontal / vertical)
 * @property size - Size of the data list (sm / md / lg)
 * @property variant - Visual variant (subtle / bold)
 * @property background - Explicit container background colour override
 * @property borderColor - Explicit container border colour override
 * @property labelColor - Explicit label colour override
 * @property valueColor - Explicit value colour override
 */
export const DataListStyleType = StructType({
    orientation: OptionType(OrientationType),
    size: OptionType(DataListSizeType),
    variant: OptionType(DataListVariantType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    labelColor: OptionType(StringType),
    valueColor: OptionType(StringType),
});

/** Type alias for `DataListStyleType`. */
export type DataListStyleType = typeof DataListStyleType;

/**
 * TypeScript interface for DataList style options.
 *
 * @remarks
 * Flat mirror of `DataListStyleType`. The factory wraps this into the
 * nested `style` sub-struct; callers write `{ orientation: "horizontal",
 * variant: "bold", labelColor: "fg.muted" }` without manually building
 * the IR struct.
 *
 * @property orientation - Layout direction (horizontal / vertical)
 * @property size - Size of the data list (sm / md / lg)
 * @property variant - Visual variant (subtle / bold)
 * @property background - Explicit container background colour override
 * @property borderColor - Explicit container border colour override
 * @property labelColor - Explicit label colour override
 * @property valueColor - Explicit value colour override
 */
export interface DataListStyle {
    /** Layout direction (horizontal or vertical) */
    orientation?: SubtypeExprOrValue<OrientationType> | OrientationLiteral;
    /** Size of the data list (sm, md, lg) */
    size?: SubtypeExprOrValue<DataListSizeType> | DataListSizeLiteral;
    /** Visual variant (subtle or bold) */
    variant?: SubtypeExprOrValue<DataListVariantType> | DataListVariantLiteral;
    /** Explicit container background colour override */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit container border colour override */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit label colour override */
    labelColor?: SubtypeExprOrValue<StringType>;
    /** Explicit value colour override */
    valueColor?: SubtypeExprOrValue<StringType>;
}
