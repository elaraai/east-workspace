/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StructType,
    StringType,
    BooleanType,
    ArrayType,
    NullType,
    FunctionType,
} from "@elaraai/east";

// ============================================================================
// Breadcrumb Item Type
// ============================================================================

/**
 * Type for a single breadcrumb item.
 *
 * @property label - The display text for this breadcrumb item
 * @property current - Whether this item represents the current page (non-link, ink, weight 600)
 * @property onClick - Optional click handler for navigation
 */
export const BreadcrumbItemType = StructType({
    label: StringType,
    current: OptionType(BooleanType),
    onClick: OptionType(FunctionType([], NullType)),
});

/**
 * Type representing the BreadcrumbItem structure.
 */
export type BreadcrumbItemType = typeof BreadcrumbItemType;

// ============================================================================
// Breadcrumb Style Type
// ============================================================================

/**
 * Visual-only style struct for Breadcrumb.
 *
 * @property runAnchor - Optional trailing run anchor text (e.g. `run #42`),
 *   rendered after a vertical rule to pin the crumb to a specific run
 * @property leadingSeparator - Render a separator before the first item too, so
 *   the trail reads as a path (`/ workspace / page`) — the e3-cloud / bsys style
 */
export const BreadcrumbStyleType = StructType({
    runAnchor: OptionType(StringType),
    leadingSeparator: OptionType(BooleanType),
});

/** Type alias for the Breadcrumb style struct. */
export type BreadcrumbStyleType = typeof BreadcrumbStyleType;

/**
 * Type for the Breadcrumb component.
 *
 * @property items - Array of breadcrumb items
 * @property style - Optional visual-only style sub-struct
 */
export const BreadcrumbRootType = StructType({
    items: ArrayType(BreadcrumbItemType),
    style: OptionType(BreadcrumbStyleType),
});

/**
 * Type representing the Breadcrumb structure.
 */
export type BreadcrumbRootType = typeof BreadcrumbRootType;

// ============================================================================
// Breadcrumb Style
// ============================================================================

/**
 * TypeScript interface for Breadcrumb style options.
 *
 * @property runAnchor - Optional trailing run anchor text (e.g. `run #42`)
 * @property leadingSeparator - Render a separator before the first item (path style)
 */
export interface BreadcrumbStyle {
    /** Optional trailing run anchor text (e.g. `run #42`), pinned after a vertical rule. */
    runAnchor?: SubtypeExprOrValue<StringType>;
    /** Render a separator before the first item too, so the trail reads as a path (`/ workspace / page`). */
    leadingSeparator?: SubtypeExprOrValue<BooleanType>;
}
