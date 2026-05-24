/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    FloatType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    NullType,
} from "@elaraai/east";

import { OverflowType } from "../../style.js";
import type { OverflowLiteral } from "../../style.js";
import { PaddingType, MarginType } from "../../layout/style.js";
import { IconType } from "../../display/icon/types.js";

// ============================================================================
// List Variant Type
// ============================================================================

/**
 * List variant type for ordered vs unordered lists.
 *
 * @property ordered - Numbered list (ol)
 * @property unordered - Bulleted list (ul)
 */
export const ListVariantType = VariantType({
    ordered: NullType,
    unordered: NullType,
});

export type ListVariantType = typeof ListVariantType;
export type ListVariantLiteral = "ordered" | "unordered";

// ============================================================================
// List Marker Type
// ============================================================================

/**
 * Marker glyph applied to each list item.
 *
 * `check` / `dash` / `icon` render real `<svg role="img" aria-label="…">`
 * markers (not CSS `::before` characters) per the a11y contract —
 * screen readers announce them alongside the item content.
 *
 * @property disc - Filled disc marker (default for unordered)
 * @property circle - Open-circle marker
 * @property square - Square marker
 * @property decimal - Numeric marker (default for ordered)
 * @property none - No marker
 * @property check - Checkmark glyph (semantic-success)
 * @property dash - Em-dash glyph (semantic-danger)
 * @property icon - Custom Font Awesome icon (carries the `IconType`)
 */
export const ListMarkerType = VariantType({
    disc: NullType,
    circle: NullType,
    square: NullType,
    decimal: NullType,
    none: NullType,
    check: NullType,
    dash: NullType,
    icon: IconType,
});

export type ListMarkerType = typeof ListMarkerType;
export type ListMarkerLiteral =
    | "disc"
    | "circle"
    | "square"
    | "decimal"
    | "none"
    | "check"
    | "dash";

// ============================================================================
// List Visual Style Struct
// ============================================================================

/**
 * Visual-presentation struct for the List component.
 *
 * Consumed via `List.style` (inline in `component.ts`).
 */
export const ListVisualStyleType = StructType({
    // Visual presets
    variant: OptionType(ListVariantType),
    marker: OptionType(ListMarkerType),
    colorPalette: OptionType(StringType),
    // Layout
    gap: OptionType(StringType),
    overflow: OptionType(OverflowType),
    overflowX: OptionType(OverflowType),
    overflowY: OptionType(OverflowType),
    width: OptionType(StringType),
    height: OptionType(StringType),
    minWidth: OptionType(StringType),
    minHeight: OptionType(StringType),
    maxWidth: OptionType(StringType),
    maxHeight: OptionType(StringType),
    padding: OptionType(PaddingType),
    margin: OptionType(MarginType),
    opacity: OptionType(FloatType),
    // Colour slots
    color: OptionType(StringType),
    markerColor: OptionType(StringType),
});

export type ListVisualStyleType = typeof ListVisualStyleType;

// ============================================================================
// List Type — re-exported for renderer `equalFor`
// ============================================================================

// The main `List` variant lives inline in `component.ts` (items recurse through
// `UIComponentType`). Renderers that need `equalFor(List.Types.List)` import
// this re-export, which mirrors the inline shape exactly.
//
// Imported at function-boundary inside the renderer via `Type` indirection —
// the actual recursive type comes from `component.ts`. This file only exposes
// the Variant, Marker, and Style pieces that are shared with the renderer.

// ============================================================================
// List Style (TS interface)
// ============================================================================

/**
 * Style configuration for List components.
 *
 * Flat at the factory boundary for ergonomics; the IR wraps every visual
 * field inside `List.style` (see `ListVisualStyleType`). `marker: "icon"`
 * is represented in the TS interface as the dedicated `markerIcon` field
 * because variant payloads (the icon's `IconType`) can't share a single
 * union slot with the plain literals.
 */
export type ListStyle = {
    /** Visual variant — ordered (ol) vs unordered (ul). */
    variant?: SubtypeExprOrValue<ListVariantType> | ListVariantLiteral;
    /** Marker glyph. Use `markerIcon` to supply a Font Awesome icon marker. */
    marker?: SubtypeExprOrValue<ListMarkerType> | ListMarkerLiteral;
    /** Icon marker payload (required when the caller wants per-item glyph control). */
    markerIcon?: SubtypeExprOrValue<IconType>;
    /** Color palette for the list */
    colorPalette?: SubtypeExprOrValue<StringType>;
    /** Item-level foreground colour (inherits to text children). */
    color?: SubtypeExprOrValue<StringType>;
    /** Marker glyph colour (check / dash / icon / bullet). */
    markerColor?: SubtypeExprOrValue<StringType>;
    /** Spacing between items */
    gap?: SubtypeExprOrValue<StringType>;
    /** Overflow behavior */
    overflow?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Horizontal overflow */
    overflowX?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Vertical overflow */
    overflowY?: SubtypeExprOrValue<OverflowType> | OverflowLiteral;
    /** Width */
    width?: SubtypeExprOrValue<StringType>;
    /** Height */
    height?: SubtypeExprOrValue<StringType>;
    /** Min width */
    minWidth?: SubtypeExprOrValue<StringType>;
    /** Min height */
    minHeight?: SubtypeExprOrValue<StringType>;
    /** Max width */
    maxWidth?: SubtypeExprOrValue<StringType>;
    /** Max height */
    maxHeight?: SubtypeExprOrValue<StringType>;
    /** Padding configuration */
    padding?: SubtypeExprOrValue<PaddingType> | string;
    /** Margin configuration */
    margin?: SubtypeExprOrValue<MarginType> | string;
    /** CSS opacity (0-1) */
    opacity?: SubtypeExprOrValue<FloatType>;
};
