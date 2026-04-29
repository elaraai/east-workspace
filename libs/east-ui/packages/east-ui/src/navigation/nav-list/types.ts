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
    VariantType,
    NullType,
    FunctionType,
} from "@elaraai/east";

import { IconType } from "../../display/icon/types.js";

// ============================================================================
// NavList Orientation
// ============================================================================

/**
 * Variant type for `NavList` layout orientation.
 *
 * @property horizontal - Items laid out in a row (toolbar / segmented sub-nav)
 * @property vertical - Items laid out in a column (default sub-panel nav)
 */
export const NavListOrientationType = VariantType({
    horizontal: NullType,
    vertical: NullType,
});

/**
 * Type alias for the NavListOrientation variant.
 */
export type NavListOrientationType = typeof NavListOrientationType;

/**
 * String literal type for orientation values.
 */
export type NavListOrientationLiteral = "horizontal" | "vertical";

// ============================================================================
// NavItem
// ============================================================================

/**
 * East StructType for an individual nav item.
 *
 * @property key - Stable identifier emitted by `onSelect` when the item is clicked
 * @property label - Display text
 * @property icon - Optional leading Font Awesome icon
 * @property badge - Optional trailing badge text (count, "New", etc.)
 * @property active - Whether this item is currently active (renderer applies active styling)
 */
export const NavItemType = StructType({
    key: StringType,
    label: StringType,
    icon: OptionType(IconType),
    badge: OptionType(StringType),
    active: OptionType(BooleanType),
});

export type NavItemType = typeof NavItemType;

/**
 * TypeScript-side input shape for declaring a nav item on the factory.
 *
 * @property key - Stable identifier
 * @property label - Display text
 * @property icon - Optional leading icon
 * @property badge - Optional trailing badge text
 * @property active - Whether this item is currently active
 */
export interface NavItemInput {
    /** Stable identifier emitted by `onSelect` when the item is clicked. */
    key: SubtypeExprOrValue<StringType>;
    /** Display text. */
    label: SubtypeExprOrValue<StringType>;
    /** Optional leading icon (Font Awesome prefix + name). */
    icon?: { prefix: string; name: string };
    /** Optional trailing badge text. */
    badge?: SubtypeExprOrValue<StringType>;
    /** Whether this item is currently active. */
    active?: SubtypeExprOrValue<BooleanType>;
}

// ============================================================================
// NavSection
// ============================================================================

/**
 * East StructType for a section grouping nav items under an optional heading.
 *
 * @property label - Optional section heading
 * @property items - Items belonging to this section
 */
export const NavSectionType = StructType({
    label: OptionType(StringType),
    items: ArrayType(NavItemType),
});

export type NavSectionType = typeof NavSectionType;

/**
 * TypeScript-side input shape for declaring a section on the factory.
 *
 * @property label - Optional section heading
 * @property items - Items belonging to this section
 */
export interface NavSectionInput {
    /** Optional section heading. */
    label?: SubtypeExprOrValue<StringType>;
    /** Items belonging to this section. */
    items: NavItemInput[];
}

// ============================================================================
// NavList Style
// ============================================================================

/**
 * East StructType holding visual fields for `NavList`.
 *
 * @property orientation - Layout direction (`vertical` default, `horizontal` for toolbar-style sub-nav)
 * @property sectionLabelColor - Explicit colour for section heading text
 * @property itemColor - Explicit text colour for inactive items
 * @property itemHoverBackground - Explicit background colour on hover
 * @property activeColor - Explicit text colour for the active item
 * @property activeBackground - Explicit background colour for the active item
 * @property activeIndicatorColor - Explicit colour of the left-edge stripe on the active item
 * @property badgeBackground - Explicit badge fill colour
 * @property badgeColor - Explicit badge text colour
 */
export const NavListStyleType = StructType({
    orientation: OptionType(NavListOrientationType),
    sectionLabelColor: OptionType(StringType),
    itemColor: OptionType(StringType),
    itemHoverBackground: OptionType(StringType),
    activeColor: OptionType(StringType),
    activeBackground: OptionType(StringType),
    activeIndicatorColor: OptionType(StringType),
    badgeBackground: OptionType(StringType),
    badgeColor: OptionType(StringType),
});

/**
 * Type alias for the NavList style struct.
 */
export type NavListStyleType = typeof NavListStyleType;

/**
 * TypeScript interface for `NavList` style options.
 *
 * @property orientation - Layout direction
 * @property sectionLabelColor - Section heading text colour
 * @property itemColor - Inactive item text colour
 * @property itemHoverBackground - Hover background colour
 * @property activeColor - Active item text colour
 * @property activeBackground - Active item background colour
 * @property activeIndicatorColor - Active-item left-stripe colour
 * @property badgeBackground - Badge fill colour
 * @property badgeColor - Badge text colour
 */
export interface NavListStyle {
    /** Layout direction (`vertical` / `horizontal`). */
    orientation?: SubtypeExprOrValue<NavListOrientationType> | NavListOrientationLiteral;
    /** Explicit colour for section heading text. */
    sectionLabelColor?: SubtypeExprOrValue<StringType>;
    /** Explicit text colour for inactive items. */
    itemColor?: SubtypeExprOrValue<StringType>;
    /** Explicit background colour on hover. */
    itemHoverBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit text colour for the active item. */
    activeColor?: SubtypeExprOrValue<StringType>;
    /** Explicit background colour for the active item. */
    activeBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit colour of the left-edge stripe on the active item. */
    activeIndicatorColor?: SubtypeExprOrValue<StringType>;
    /** Explicit badge fill colour. */
    badgeBackground?: SubtypeExprOrValue<StringType>;
    /** Explicit badge text colour. */
    badgeColor?: SubtypeExprOrValue<StringType>;
    /** Callback fired with the selected item's `key` when an item is clicked. */
    onSelect?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
}

// ============================================================================
// NavList Type
// ============================================================================

/**
 * East StructType for `NavList` — grouped section navigation list for
 * use inside panels (settings sub-nav, in-drawer navigation, in-card
 * section tabs).
 *
 * @remarks
 * Pure callback primitive: emits `onSelect(key)` when an item is
 * clicked. The active item is driven by the `active: true` flag on
 * each item — apps wire this via `Reactive.Root` + `State.bind` in
 * the standard pattern.
 *
 * Distinct from app-level sidebars (host owns the viewport chrome —
 * east-ui doesn't ship a shell). NavList is for sub-navigation
 * inside the host's content area.
 *
 * @property sections - Array of sections, each containing items
 * @property onSelect - Callback fired with the selected item's `key`
 * @property style - Optional visual style sub-struct
 */
export const NavListType = StructType({
    sections: ArrayType(NavSectionType),
    onSelect: OptionType(FunctionType([StringType], NullType)),
    style: OptionType(NavListStyleType),
});

/**
 * Type alias for the NavList struct.
 */
export type NavListType = typeof NavListType;
