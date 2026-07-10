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
    VariantType,
} from "@elaraai/east";

import { IconType } from "../../display/icon/types.js";

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
// NavList Surface
// ============================================================================

/**
 * East VariantType for the `NavList` panel surface treatment.
 *
 * @property card - Standalone card chrome: fill, 1 px rule, radius, vertical padding
 * @property shell - No chrome; the host rail owns fill + rule (app-shell sidebar)
 */
export const NavListSurfaceType = VariantType({
    card: NullType,
    shell: NullType,
});

export type NavListSurfaceType = typeof NavListSurfaceType;

/** String shorthands accepted for {@link NavListStyle.surface}. */
export type NavListSurfaceLiteral = "card" | "shell";

// ============================================================================
// NavList Options
// ============================================================================

/**
 * TypeScript interface for `NavList` options.
 *
 * @property onSelect - Callback fired with the selected item's `key` when an item is clicked
 * @property surface - Panel surface treatment (`card` card chrome, `shell` chrome-less)
 * @property background - Panel background colour token or CSS colour
 */
export interface NavListStyle {
    /** Callback fired with the selected item's `key` when an item is clicked. */
    onSelect?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /**
     * Panel surface treatment. `card` (default) keeps the standalone card
     * chrome — fill, 1 px rule, radius, vertical padding. `shell` drops all of
     * it so the list reads as one surface with a host app-shell rail that
     * brings its own panel chrome.
     */
    surface?: SubtypeExprOrValue<NavListSurfaceType> | NavListSurfaceLiteral;
    /**
     * Panel background — a Chakra colour token (`bg.subtle`, …) or CSS colour —
     * so the list can inherit or blend with the host rail. Overrides the
     * surface fill when set.
     */
    background?: SubtypeExprOrValue<StringType>;
}

// ============================================================================
// NavList Type
// ============================================================================

/**
 * East StructType for `NavList` — grouped top-level navigation rendered
 * as the bsys Sidebar recipe (mono uppercase rows, brand-tint active
 * with a 3 px brand-d left rule, paper-2 card chrome).
 *
 * @remarks
 * Pure callback primitive: emits `onSelect(key)` when an item is
 * clicked. The active item is driven by the `active: true` flag on
 * each item — apps wire this via `Reactive.Root` + `State.bind` in
 * the standard pattern.
 *
 * @property sections - Array of sections, each containing items
 * @property onSelect - Callback fired with the selected item's `key`
 * @property surface - Panel surface treatment (`card` card chrome, `shell` chrome-less)
 * @property background - Panel background colour token or CSS colour
 */
export const NavListType = StructType({
    sections: ArrayType(NavSectionType),
    onSelect: OptionType(FunctionType([StringType], NullType)),
    surface: OptionType(NavListSurfaceType),
    background: OptionType(StringType),
});

/**
 * Type alias for the NavList struct.
 */
export type NavListType = typeof NavListType;
