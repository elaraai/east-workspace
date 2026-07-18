/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Deck types — the declarative grouped card collection (#359).
 *
 * A Deck renders `data` rows as presentation cards: a structured card face
 * (title / sublabel / icon / status pill / facts) or a fully custom face,
 * grouped by named GROUP BY options with the Library toolbar UX, filtered
 * by slice chrome, laid out as a wrapping card grid (desktop rows → one
 * phone column) or a single-column list.
 *
 * The card face reuses the Library card grammar deliberately — status
 * pills ({@link LibraryStatusType}) and fact values
 * ({@link LibraryDimValueType}: meter / chips / text) — so Library
 * palettes and Decks read as one family.
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StringType,
    StructType,
    VariantType,
    NullType,
} from "@elaraai/east";

import { LibraryStatusType, LibraryDimValueType, LibraryGroupMetaType } from "../library/types.js";

// ============================================================================
// Layout
// ============================================================================

/**
 * Deck layout mode.
 *
 * @remarks
 * `grid` flows cards as wrapping rows (`repeat(auto-fill, minmax(minCardWidth, 1fr))`
 * — one column on phones); `list` renders full-width card rows.
 */
export const DeckLayoutType = VariantType({
    grid: NullType,
    list: NullType,
});

/**
 * Type representing the Deck layout mode.
 */
export type DeckLayoutType = typeof DeckLayoutType;

/** Literal shorthand for {@link DeckLayoutType}. */
export type DeckLayoutLiteral = "grid" | "list";

// ============================================================================
// Facts
// ============================================================================

/**
 * A labelled fact on a Deck card — the always-visible sibling of Library's
 * toggleable dimensions.
 *
 * @property label - Caption for the fact
 * @property value - The fact's rendered value ({@link LibraryDimValueType}:
 *   meter / chips / text)
 */
export const DeckFactType = StructType({
    /** Caption for the fact */
    label: StringType,
    /** The fact's rendered value (meter / chips / text) */
    value: LibraryDimValueType,
});

/**
 * Type representing a Deck card fact.
 */
export type DeckFactType = typeof DeckFactType;

// ============================================================================
// Style
// ============================================================================

/**
 * Style configuration for the Deck container.
 *
 * @property height - Pinned height (CSS length; body scrolls within)
 * @property maxHeight - Height cap (content-sized up to it, then scrolls)
 * @property minCardWidth - Grid card floor (CSS length, default `"240"`);
 *   the wrap grid uses `minmax(minCardWidth, 1fr)`
 */
export const DeckStyleType = StructType({
    height: OptionType(StringType),
    maxHeight: OptionType(StringType),
    minCardWidth: OptionType(StringType),
});

/**
 * Type representing the Deck style structure.
 */
export type DeckStyleType = typeof DeckStyleType;

/**
 * TypeScript interface for Deck style options.
 *
 * @property height - Pinned height (CSS length; body scrolls within)
 * @property maxHeight - Height cap (content-sized up to it, then scrolls)
 * @property minCardWidth - Grid card floor (CSS length, default `"240"`)
 */
export interface DeckStyle {
    /** Pinned height (CSS length; body scrolls within) */
    height?: SubtypeExprOrValue<StringType>;
    /** Height cap (content-sized up to it, then scrolls) */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Grid card floor (CSS length, default `"240"`) */
    minCardWidth?: SubtypeExprOrValue<StringType>;
}

export { LibraryStatusType, LibraryDimValueType, LibraryGroupMetaType };
