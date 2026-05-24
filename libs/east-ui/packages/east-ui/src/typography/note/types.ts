/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    FloatType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { PaddingType, MarginType } from "../../layout/style.js";

// ============================================================================
// Note Variant Type
// ============================================================================

/**
 * Semantic content preset for Note — it changes the meaning of the block.
 *
 * @property narrative - Dashed border-left accent, muted body — prose explainers
 * @property callout - Solid border-left accent in semantic-info palette — an important note
 * @property quote - Indented, italic — a direct quotation
 */
export const NoteVariantType = VariantType({
    narrative: NullType,
    callout: NullType,
    quote: NullType,
});

export type NoteVariantType = typeof NoteVariantType;
export type NoteVariantLiteral = "narrative" | "callout" | "quote";

// ============================================================================
// Note Emphasis Variant Type
// ============================================================================

/**
 * Emphasis dial — visual preset that lives inside `style`.
 */
export const NoteEmphasisType = VariantType({
    subtle: NullType,
    strong: NullType,
});

export type NoteEmphasisType = typeof NoteEmphasisType;
export type NoteEmphasisLiteral = "subtle" | "strong";

// ============================================================================
// Note Visual Style Struct
// ============================================================================

/**
 * Visual-presentation struct for the Note component.
 *
 * Consumed via the inline `Note` variant's `style` field.
 */
export const NoteVisualStyleType = StructType({
    emphasis: OptionType(NoteEmphasisType),
    // Colour slots
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    accentColor: OptionType(StringType),
    // Layout / sizing
    width: OptionType(StringType),
    maxWidth: OptionType(StringType),
    padding: OptionType(PaddingType),
    margin: OptionType(MarginType),
    // Opacity
    opacity: OptionType(FloatType),
});

export type NoteVisualStyleType = typeof NoteVisualStyleType;

// ============================================================================
// Note Style (TS interface)
// ============================================================================

/**
 * Style configuration for Note components.
 *
 * Flat at the factory boundary; `variant` lives on the main struct
 * (semantic classification), everything else lives inside `style`.
 */
export type NoteStyle = {
    /** Semantic Note variant — narrative / callout / quote. On main, not in style. */
    variant?: SubtypeExprOrValue<NoteVariantType> | NoteVariantLiteral;
    /** Emphasis dial (subtle / strong) */
    emphasis?: SubtypeExprOrValue<NoteEmphasisType> | NoteEmphasisLiteral;
    /** Foreground / body colour */
    color?: SubtypeExprOrValue<StringType>;
    /** Background colour */
    background?: SubtypeExprOrValue<StringType>;
    /** Border colour */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Accent-stripe colour (left / top edge) */
    accentColor?: SubtypeExprOrValue<StringType>;
    /** Width */
    width?: SubtypeExprOrValue<StringType>;
    /** Max width */
    maxWidth?: SubtypeExprOrValue<StringType>;
    /** Padding configuration */
    padding?: SubtypeExprOrValue<PaddingType> | string;
    /** Margin configuration */
    margin?: SubtypeExprOrValue<MarginType> | string;
    /** CSS opacity (0-1) */
    opacity?: SubtypeExprOrValue<FloatType>;
};
