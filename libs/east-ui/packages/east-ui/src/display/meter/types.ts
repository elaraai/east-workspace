/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type SubtypeExprOrValue,
    BooleanType,
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
// Meter Thickness
// ============================================================================

/**
 * Visual thickness preset for a Meter.
 *
 * @remarks
 * Drives the meter's track height in the renderer (xs=2px, sm=4px,
 * md=6px, lg=8px).
 *
 * @property xs - Extra thin (2px)
 * @property sm - Thin (4px, default)
 * @property md - Medium (6px)
 * @property lg - Thick (8px)
 */
export const MeterThicknessType = VariantType({
    xs: NullType,
    sm: NullType,
    md: NullType,
    lg: NullType,
});

/** Type alias for the Meter thickness variant. */
export type MeterThicknessType = typeof MeterThicknessType;

/** String-literal shorthand for Meter thickness. */
export type MeterThicknessLiteral = "xs" | "sm" | "md" | "lg";

// ============================================================================
// Meter Style
// ============================================================================

/**
 * East StructType for the Meter style sub-struct.
 *
 * @remarks
 * Visual-only. Content (`value` / `max` / `label`) and
 * semantic `tone` live on the main `MeterType` struct.
 *
 * @property thickness - Visual thickness preset (xs / sm / md / lg)
 * @property fillColor - Explicit fill colour override
 * @property trackColor - Explicit track (background) colour override
 * @property labelColor - Explicit label text colour override
 */
export const MeterStyleType = StructType({
    thickness: OptionType(MeterThicknessType),
    borderRadius: OptionType(StringType),
    fillColor: OptionType(StringType),
    trackColor: OptionType(StringType),
    labelColor: OptionType(StringType),
    showValue: OptionType(BooleanType),
});

/** Type alias for the Meter style struct. */
export type MeterStyleType = typeof MeterStyleType;

// ============================================================================
// Meter TS options bag
// ============================================================================

/**
 * TypeScript options bag for `Meter.Root`.
 *
 * @remarks
 * Combines optional content slots (`max` / `label` / `tone`) with
 * visual style fields. The factory splits them into the nested IR
 * shape internally.
 *
 * @property max - Maximum value (defaults to 100)
 * @property label - Optional label UIComponent rendered alongside the bar
 * @property tone - Semantic status tone (drives default fill colour)
 * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
 * @property thickness - Visual thickness preset
 * @property fillColor - Explicit fill colour override
 * @property trackColor - Explicit track colour override
 * @property labelColor - Explicit label text colour override
 */
export interface MeterOptions {
    /** Maximum value (defaults to 100). */
    max?: SubtypeExprOrValue<FloatType>;
    /** Optional label UIComponent rendered alongside the bar. */
    label?: unknown;
    /** Semantic status tone (drives default fill colour when set). */
    tone?: SubtypeExprOrValue<StatusTokenType> | StatusTokenLiteral;
    /**
     * Density override (main-struct). Inherited from the enclosing surface
     * (Table, ChipRail, …) when omitted; an explicit value wins over both the
     * cascade and `thickness`, sizing the meter to match rails and traces at
     * the same density.
     */
    density?: SubtypeExprOrValue<DensityType> | DensityLiteral;
    /** Visual thickness preset (xs / sm / md / lg). */
    thickness?: SubtypeExprOrValue<MeterThicknessType> | MeterThicknessLiteral;
    /** Corner radius (Chakra token or explicit px). Default `"sm"`. */
    borderRadius?: SubtypeExprOrValue<StringType>;
    /** Explicit fill colour override. */
    fillColor?: SubtypeExprOrValue<StringType>;
    /** Explicit track colour override. */
    trackColor?: SubtypeExprOrValue<StringType>;
    /** Explicit label text colour override. */
    labelColor?: SubtypeExprOrValue<StringType>;
    /** Whether to render the trailing mono percent. Default `true` (spec: never a bar alone). */
    showValue?: SubtypeExprOrValue<BooleanType>;
}
