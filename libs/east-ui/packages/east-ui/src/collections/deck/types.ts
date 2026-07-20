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
    ArrayType,
    BooleanType,
    DictType,
    FloatType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    NullType,
} from "@elaraai/east";

import { LibraryStatusType, LibraryDimValueType, LibraryGroupMetaType } from "../library/types.js";
import { StatusTokenType } from "../../style/interaction.js";
import { ValueFormatType } from "../../contracts/format.js";

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

// ============================================================================
// Status registry
// ============================================================================

/**
 * A status colour — a standard status token or a custom CSS colour.
 *
 * @property token - One of the standard status tones
 * @property custom - Any CSS colour (the face tint is derived from it)
 */
export const DeckStatusColorType = VariantType({
    /** Standard status tone */
    token: StatusTokenType,
    /** Custom CSS colour */
    custom: StringType,
});

/**
 * Type representing a Deck status colour.
 */
export type DeckStatusColorType = typeof DeckStatusColorType;

/**
 * One entry of the Deck status registry — the single definition that
 * drives the card's solid status tag (+ dot, optional pulse), the faint
 * face wash, the fill-bar colour, group-head swatches, the legend and
 * the popover head wash.
 *
 * @property label - The tag / legend label
 * @property color - Status colour (standard token or custom CSS colour)
 * @property pulse - Pulse the tag dot (active states)
 * @property hint - Optional legend / group-head description
 */
export const DeckStatusType = StructType({
    /** The tag / legend label */
    label: StringType,
    /** Status colour (token or custom) */
    color: DeckStatusColorType,
    /** Pulse the tag dot */
    pulse: BooleanType,
    /** Optional legend / group-head description */
    hint: OptionType(StringType),
});

/**
 * Type representing one Deck status registry entry.
 */
export type DeckStatusType = typeof DeckStatusType;

/**
 * The Deck status registry — status key → definition.
 */
export const DeckStatusesType = DictType(StringType, DeckStatusType);

/**
 * Type representing the Deck status registry.
 */
export type DeckStatusesType = typeof DeckStatusesType;

// ============================================================================
// Metrics + fill
// ============================================================================

/**
 * One metric on a Deck card face — a label-over-value pair in the mono
 * tabular voice. Carries the RAW value plus a shared display format
 * ({@link ValueFormatType} — the chart-tick vocabulary) or pre-rendered
 * text from an accessor formatter; a `none` value renders muted "—".
 *
 * @property label - Metric caption (mono uppercase)
 * @property value - The raw value (`none` renders "—")
 * @property format - Optional shared display format (chart-tick vocabulary)
 * @property text - Optional pre-rendered text (accessor formatters)
 * @property warn - Render the value in the danger tone
 */
export const DeckMetricType = StructType({
    /** Metric caption */
    label: StringType,
    /** The raw value (`none` renders "—") */
    value: OptionType(FloatType),
    /** Optional shared display format */
    format: OptionType(ValueFormatType),
    /** Optional pre-rendered text */
    text: OptionType(StringType),
    /** Render the value in the danger tone */
    warn: BooleanType,
});

/**
 * Type representing a Deck card metric.
 */
export type DeckMetricType = typeof DeckMetricType;

/**
 * The card fill bar — a status-coloured utilisation bar with a
 * right-aligned reading.
 *
 * @property value - Current value
 * @property max - Full-bar value
 * @property format - Optional shared display format for the reading
 * @property text - Optional pre-rendered reading
 */
export const DeckFillType = StructType({
    /** Current value */
    value: FloatType,
    /** Full-bar value */
    max: FloatType,
    /** Optional shared display format for the reading */
    format: OptionType(ValueFormatType),
    /** Optional pre-rendered reading */
    text: OptionType(StringType),
});

/**
 * Type representing the Deck card fill bar.
 */
export type DeckFillType = typeof DeckFillType;

// ============================================================================
// Popover building blocks (Deck.Readout / Deck.Rows / Deck.Note)
// ============================================================================

/**
 * The readout rail — a bordered grid of big mono values with units, the
 * popover body's headline numbers.
 *
 * @property cells - The readout cells
 */
export const DeckReadoutType = StructType({
    /** The readout cells */
    cells: ArrayType(StructType({
        /** Cell caption (mono uppercase) */
        label: StringType,
        /** The raw value (`none` renders "—") */
        value: OptionType(FloatType),
        /** Optional shared display format */
        format: OptionType(ValueFormatType),
        /** Optional pre-rendered text */
        text: OptionType(StringType),
        /** Optional unit suffix (small, muted) */
        unit: OptionType(StringType),
        /** Render the value in the danger tone */
        warn: BooleanType,
    })),
});

/**
 * Type representing the Deck readout rail.
 */
export type DeckReadoutType = typeof DeckReadoutType;

/**
 * Key–value detail rows — the popover body's labelled facts.
 *
 * @property rows - The rows (mono uppercase key, body-voice value)
 */
export const DeckRowsType = StructType({
    /** The rows */
    rows: ArrayType(StructType({
        /** Row key (mono uppercase) */
        label: StringType,
        /** Row value */
        value: StringType,
    })),
});

/**
 * Type representing Deck detail rows.
 */
export type DeckRowsType = typeof DeckRowsType;

/**
 * A dashed-top mono footnote — the popover body's trailing note.
 *
 * @property text - The note text
 */
export const DeckNoteType = StructType({
    /** The note text */
    text: StringType,
});

/**
 * Type representing a Deck note.
 */
export type DeckNoteType = typeof DeckNoteType;

export { LibraryStatusType, LibraryDimValueType, LibraryGroupMetaType, StatusTokenType, ValueFormatType };
