/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    FloatType,
    NullType,
    OptionType,
    StructType,
    StringType,
    VariantType,
} from "@elaraai/east";

import { StatusTokenType } from "../../style/interaction.js";
import type { StatusTokenLiteral } from "../../style/interaction.js";
import { DensityType } from "../../style.js";
import type { DensityLiteral } from "../../style.js";

// ============================================================================
// SegmentedMeter Segment (per-segment data)
// ============================================================================

/**
 * Per-segment data for a SegmentedMeter.
 *
 * @remarks
 * Each segment carries its own value (weight in the flex layout),
 * optional tone (status-driven default colour), optional explicit
 * colour override (per-segment data, not style), and optional label.
 *
 * @property value - Segment value (weight in the layout)
 * @property tone - Semantic status tone
 * @property color - Per-segment colour override (data, not style)
 * @property label - Optional short label rendered inside / beneath
 */
export const SegmentedMeterSegmentType = StructType({
    value: FloatType,
    tone: OptionType(StatusTokenType),
    color: OptionType(StringType),
    label: OptionType(StringType),
});

/** Type alias for the segment struct. */
export type SegmentedMeterSegmentType = typeof SegmentedMeterSegmentType;

// ============================================================================
// SegmentedMeter Thickness
// ============================================================================

/**
 * Visual thickness preset for a SegmentedMeter.
 *
 * @remarks
 * Drives bar height: xs=4px, sm=6px, md=10px, lg=14px.
 *
 * @property xs - Extra thin
 * @property sm - Thin (default)
 * @property md - Medium
 * @property lg - Thick
 */
export const SegmentedMeterThicknessType = VariantType({
    xs: NullType,
    sm: NullType,
    md: NullType,
    lg: NullType,
});

/** Type alias for SegmentedMeter thickness. */
export type SegmentedMeterThicknessType = typeof SegmentedMeterThicknessType;

/** String-literal shorthand for SegmentedMeter thickness. */
export type SegmentedMeterThicknessLiteral = "xs" | "sm" | "md" | "lg";

// ============================================================================
// SegmentedMeter Labels position
// ============================================================================

/**
 * Label position preset for a SegmentedMeter.
 *
 * @remarks
 * `inside` draws labels inside each segment (if it fits); `outside`
 * draws chip-style labels below the bar; `none` hides labels even if
 * the segment carries a `label` string.
 *
 * @property inside - Labels rendered inside each segment
 * @property outside - Labels rendered below the bar
 * @property none - Labels hidden
 */
export const SegmentedMeterLabelsType = VariantType({
    inside: NullType,
    outside: NullType,
    none: NullType,
});

/** Type alias for SegmentedMeter labels variant. */
export type SegmentedMeterLabelsType = typeof SegmentedMeterLabelsType;

/** String-literal shorthand for SegmentedMeter labels position. */
export type SegmentedMeterLabelsLiteral = "inside" | "outside" | "none";

// ============================================================================
// SegmentedMeter Style
// ============================================================================

/**
 * East StructType for the SegmentedMeter style sub-struct.
 *
 * @remarks
 * Visual-only. Content (`segments` / `caption`) and config
 * (`max`) live on the main `SegmentedMeterType` struct.
 *
 * @property thickness - Visual thickness preset
 * @property labels - Label position preset
 * @property trackColor - Explicit track colour (shown when segments don't cover the full max)
 * @property captionColor - Explicit caption text colour override
 * @property labelColor - Explicit default segment label colour override
 */
export const SegmentedMeterStyleType = StructType({
    thickness: OptionType(SegmentedMeterThicknessType),
    labels: OptionType(SegmentedMeterLabelsType),
    borderRadius: OptionType(StringType),
    trackColor: OptionType(StringType),
    captionColor: OptionType(StringType),
    labelColor: OptionType(StringType),
});

/** Type alias for the SegmentedMeter style struct. */
export type SegmentedMeterStyleType = typeof SegmentedMeterStyleType;

// ============================================================================
// SegmentedMeter TS options bag
// ============================================================================

/**
 * TypeScript options bag for `SegmentedMeter.Root`.
 *
 * @remarks
 * Combines config (`max`), optional caption UIComponent, and visual
 * style fields.
 *
 * @property caption - Optional caption UIComponent rendered alongside the bar
 * @property max - Optional total reference (defaults to `sum(segments.value)`)
 * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
 * @property thickness - Visual thickness preset
 * @property labels - Label position preset
 * @property trackColor - Explicit track colour override
 * @property captionColor - Explicit caption colour override
 * @property labelColor - Explicit default segment label colour override
 */
export interface SegmentedMeterOptions {
    /** Optional caption UIComponent rendered alongside the bar. */
    caption?: unknown;
    /** Optional total reference (defaults to sum of segment values). */
    max?: SubtypeExprOrValue<FloatType>;
    /**
     * Density override (main-struct). Inherited from the enclosing surface
     * (Table, ChipRail, …) when omitted; an explicit value wins over both the
     * cascade and `thickness`, sizing the bar to match rails and traces at
     * the same density.
     */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Visual thickness preset (xs / sm / md / lg). */
    thickness?: SubtypeExprOrValue<SegmentedMeterThicknessType> | SegmentedMeterThicknessLiteral;
    /** Label position preset (inside / outside / none). */
    labels?: SubtypeExprOrValue<SegmentedMeterLabelsType> | SegmentedMeterLabelsLiteral;
    /** Corner radius (Chakra token or explicit px). Default `"sm"`. */
    borderRadius?: SubtypeExprOrValue<StringType>;
    /** Explicit track colour override. */
    trackColor?: SubtypeExprOrValue<StringType>;
    /** Explicit caption text colour override. */
    captionColor?: SubtypeExprOrValue<StringType>;
    /** Explicit default segment label colour override. */
    labelColor?: SubtypeExprOrValue<StringType>;
}

/**
 * TypeScript interface for an input segment — used at the factory
 * boundary. The factory wraps each plain object into
 * `SegmentedMeterSegmentType` expressions.
 *
 * @property value - Segment value (weight)
 * @property tone - Semantic tone
 * @property color - Per-segment colour override
 * @property label - Optional segment label
 */
export interface SegmentedMeterSegment {
    /** Segment value (weight). */
    value: SubtypeExprOrValue<FloatType>;
    /** Semantic tone (drives default colour). */
    tone?: SubtypeExprOrValue<StatusTokenType> | StatusTokenLiteral;
    /** Per-segment colour override. */
    color?: SubtypeExprOrValue<StringType>;
    /** Optional segment label. */
    label?: SubtypeExprOrValue<StringType>;
}
