/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    BooleanType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StructType,
    StringType,
    VariantType,
} from "@elaraai/east";

import { StatusTokenType, OrientationType } from "../../style.js";
import type { StatusTokenLiteral, OrientationLiteral } from "../../style.js";

// ============================================================================
// BarStrip Sort
// ============================================================================

/**
 * Sort direction for a BarStrip.
 *
 * @property asc - Ascending by value
 * @property desc - Descending by value
 * @property none - Preserve input order (default)
 */
export const BarStripSortType = VariantType({
    asc: NullType,
    desc: NullType,
    none: NullType,
});

/** Type alias for BarStrip sort variant. */
export type BarStripSortType = typeof BarStripSortType;

/** String-literal shorthand for BarStrip sort direction. */
export type BarStripSortLiteral = "asc" | "desc" | "none";

// ============================================================================
// BarStrip Thickness
// ============================================================================

/**
 * Visual thickness preset for a BarStrip row.
 *
 * @property xs - Extra thin rows
 * @property sm - Thin rows (default)
 * @property md - Medium rows
 */
export const BarStripThicknessType = VariantType({
    xs: NullType,
    sm: NullType,
    md: NullType,
});

/** Type alias for BarStrip thickness variant. */
export type BarStripThicknessType = typeof BarStripThicknessType;

/** String-literal shorthand for BarStrip thickness. */
export type BarStripThicknessLiteral = "xs" | "sm" | "md";

// ============================================================================
// BarStrip Style
// ============================================================================

/**
 * East StructType for the BarStrip style sub-struct.
 *
 * @remarks
 * Visual-only per §0.10. Content (`items`), config (`showValues`, `sort`,
 * `maxItems`) live on the main `BarStripType` struct.
 *
 * @property orientation - Geometric orientation (horizontal default)
 * @property thickness - Row thickness preset
 * @property trackColor - Explicit track colour override
 * @property labelColor - Explicit label text colour override
 * @property valueColor - Explicit value text colour override
 */
export const BarStripStyleType = StructType({
    orientation: OptionType(OrientationType),
    thickness: OptionType(BarStripThicknessType),
    trackColor: OptionType(StringType),
    labelColor: OptionType(StringType),
    valueColor: OptionType(StringType),
});

/** Type alias for the BarStrip style struct. */
export type BarStripStyleType = typeof BarStripStyleType;

// ============================================================================
// BarStrip TS options bag
// ============================================================================

/**
 * TypeScript options bag for `BarStrip.Root`.
 *
 * @remarks
 * Combines main-struct config (`showValues`, `sort`, `maxItems`) and
 * visual style fields. The factory splits them into the nested IR
 * shape internally.
 *
 * @property showValues - Whether to render trailing value text (default true)
 * @property sort - Sort direction applied at factory time
 * @property maxItems - Optional row limit (clips items after sort)
 * @property orientation - Geometric orientation
 * @property thickness - Row thickness preset
 * @property trackColor - Explicit track colour override
 * @property labelColor - Explicit label text colour override
 * @property valueColor - Explicit value text colour override
 */
export interface BarStripOptions {
    /** Whether to render trailing value text (default true). */
    showValues?: SubtypeExprOrValue<BooleanType>;
    /** Sort direction applied at factory time. */
    sort?: SubtypeExprOrValue<BarStripSortType> | BarStripSortLiteral;
    /** Optional row limit (clips items after sort). */
    maxItems?: SubtypeExprOrValue<IntegerType>;
    /** Geometric orientation. */
    orientation?: SubtypeExprOrValue<OrientationType> | OrientationLiteral;
    /** Row thickness preset (xs / sm / md). */
    thickness?: SubtypeExprOrValue<BarStripThicknessType> | BarStripThicknessLiteral;
    /** Explicit track colour override. */
    trackColor?: SubtypeExprOrValue<StringType>;
    /** Explicit label text colour override. */
    labelColor?: SubtypeExprOrValue<StringType>;
    /** Explicit value text colour override. */
    valueColor?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript interface for an input item at the factory boundary.
 *
 * @property label - Row label (UIComponent)
 * @property value - Numeric value
 * @property tone - Semantic tone (drives default colour)
 * @property color - Per-item colour override
 * @property trailing - Optional trailing slot (chip / badge / etc.)
 */
export interface BarStripItem {
    /** Row label (UIComponent). */
    label: unknown;
    /** Numeric value. */
    value: SubtypeExprOrValue<FloatType>;
    /** Semantic tone (drives default colour). */
    tone?: SubtypeExprOrValue<StatusTokenType> | StatusTokenLiteral;
    /** Per-item colour override. */
    color?: SubtypeExprOrValue<StringType>;
    /** Optional trailing slot (chip / badge / etc.). */
    trailing?: unknown;
}
