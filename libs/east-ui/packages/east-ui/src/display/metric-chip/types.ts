/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    NullType,
    OptionType,
    StructType,
    StringType,
    VariantType,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import type { SizeLiteral } from "../../style.js";

// ============================================================================
// MetricChip Tone — semantic classification (drives default colour)
// ============================================================================

/**
 * Semantic tone classification for a MetricChip.
 *
 * @remarks
 * Drives the default colour palette. Consumers wanting a custom colour
 * should override via `style.color` / `style.background` / `style.borderColor`.
 *
 * @property positive - Favourable delta (green)
 * @property negative - Unfavourable delta (red)
 * @property neutral - Informational / no change (grey)
 * @property info - Advisory / annotation (blue)
 */
export const MetricChipToneType = VariantType({
    positive: NullType,
    negative: NullType,
    neutral: NullType,
    info: NullType,
});

/** Type alias for MetricChip tone variant. */
export type MetricChipToneType = typeof MetricChipToneType;

/** String-literal shorthand for MetricChip tones. */
export type MetricChipToneLiteral = "positive" | "negative" | "neutral" | "info";

// ============================================================================
// MetricChip Emphasis — visual preset
// ============================================================================

/**
 * Visual emphasis preset for a MetricChip.
 *
 * @remarks
 * Controls whether the chip is rendered with a tinted background
 * (`subtle`), a solid fill (`solid`), or an outline only (`outline`).
 *
 * @property subtle - Tinted background (default)
 * @property solid - High-contrast filled background
 * @property outline - Border-only with transparent background
 */
export const MetricChipEmphasisType = VariantType({
    subtle: NullType,
    solid: NullType,
    outline: NullType,
});

/** Type alias for MetricChip emphasis variant. */
export type MetricChipEmphasisType = typeof MetricChipEmphasisType;

/** String-literal shorthand for MetricChip emphasis. */
export type MetricChipEmphasisLiteral = "subtle" | "solid" | "outline";

// ============================================================================
// MetricChip Style
// ============================================================================

/**
 * East StructType for the MetricChip style sub-struct.
 *
 * @remarks
 * Visual-only. Content (`value` / `unit` / `icon`) and the
 * semantic `tone` classification live on the main `MetricChipType`
 * struct.
 *
 * @property emphasis - Visual preset (subtle / solid / outline)
 * @property size - Size preset token
 * @property color - Explicit text colour override
 * @property background - Explicit background colour override
 * @property borderColor - Explicit border colour override
 * @property iconColor - Explicit icon colour override
 */
export const MetricChipStyleType = StructType({
    emphasis: OptionType(MetricChipEmphasisType),
    size: OptionType(SizeType),
    borderRadius: OptionType(StringType),
    color: OptionType(StringType),
    background: OptionType(StringType),
    borderColor: OptionType(StringType),
    iconColor: OptionType(StringType),
});

/** Type alias for the MetricChip style struct. */
export type MetricChipStyleType = typeof MetricChipStyleType;

// ============================================================================
// MetricChip TS options bag
// ============================================================================

/**
 * TypeScript options bag for `MetricChip.Root`.
 *
 * @remarks
 * `tone` is required (it drives the default palette and lands on the main
 * `MetricChipType` struct). This interface also carries optional `unit` +
 * `icon` content slots plus every visual style field.
 *
 * @property tone - Required semantic tone classification (drives the default palette)
 * @property unit - Optional unit suffix rendered after the value (e.g. "%", "ms")
 * @property icon - Optional leading icon (IconType value)
 * @property emphasis - Visual preset (subtle / solid / outline)
 * @property size - Size preset
 * @property color - Explicit text colour override
 * @property background - Explicit background override
 * @property borderColor - Explicit border colour override
 * @property iconColor - Explicit icon colour override
 */
export interface MetricChipOptions {
    /** Semantic tone classification (required) — drives the default palette. */
    tone: SubtypeExprOrValue<MetricChipToneType> | MetricChipToneLiteral;
    /** Optional unit suffix rendered after the value (e.g. `"%"`, `"ms"`). */
    unit?: SubtypeExprOrValue<StringType>;
    /** Optional leading icon (IconType expression). */
    icon?: unknown;
    /** Visual emphasis preset (subtle / solid / outline). */
    emphasis?: SubtypeExprOrValue<MetricChipEmphasisType> | MetricChipEmphasisLiteral;
    /** Size preset. */
    size?: SubtypeExprOrValue<SizeType> | SizeLiteral;
    /** Corner radius (Chakra token or explicit px). Default `"md"`. */
    borderRadius?: SubtypeExprOrValue<StringType>;
    /** Explicit text colour override. */
    color?: SubtypeExprOrValue<StringType>;
    /** Explicit background colour override. */
    background?: SubtypeExprOrValue<StringType>;
    /** Explicit border colour override. */
    borderColor?: SubtypeExprOrValue<StringType>;
    /** Explicit icon colour override. */
    iconColor?: SubtypeExprOrValue<StringType>;
}
