/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    FloatType,
    OptionType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { StatusTokenType } from "../../style/interaction.js";
import { DensityType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    MeterThicknessType,
    MeterStyleType,
    type MeterOptions,
} from "./types.js";

export {
    MeterThicknessType,
    MeterStyleType,
    type MeterThicknessLiteral,
    type MeterOptions,
} from "./types.js";

// ============================================================================
// MeterType — standalone mirror of the inline `Meter` variant
// ============================================================================

/**
 * East StructType for a Meter value — mirrors the inline `Meter`
 * variant in `component.ts`.
 *
 * @remarks
 * Main struct holds `value` (FloatType), optional `max`, optional
 * `label` UIComponent, optional semantic `tone`, and a `style`
 * sub-struct.
 *
 * @property value - Current meter value
 * @property max - Maximum value (defaults to 100)
 * @property label - Optional label UIComponent
 * @property tone - Semantic status tone (drives default fill palette)
 * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
 * @property style - Optional visual style sub-struct
 */
export const MeterType: StructType<{
    value: FloatType,
    max: OptionType<FloatType>,
    label: OptionType<UIComponentType>,
    tone: OptionType<StatusTokenType>,
    density: OptionType<DensityType>,
    style: OptionType<MeterStyleType>,
}> = StructType({
    value: FloatType,
    max: OptionType(FloatType),
    label: OptionType(UIComponentType),
    tone: OptionType(StatusTokenType),
    density: OptionType(DensityType),
    style: OptionType(MeterStyleType),
});

/** Type alias for MeterType. */
export type MeterType = typeof MeterType;

// ============================================================================
// Helpers
// ============================================================================

function buildMeterStyle(options: MeterOptions | undefined): ExprType<MeterStyleType> | undefined {
    if (options === undefined) return undefined;
    const hasAny = options.thickness !== undefined
        || options.borderRadius !== undefined
        || options.fillColor !== undefined
        || options.trackColor !== undefined
        || options.labelColor !== undefined
        || options.showValue !== undefined;
    if (!hasAny) return undefined;

    const thicknessValue = options.thickness !== undefined
        ? (typeof options.thickness === "string"
            ? East.value(variant(options.thickness, null), MeterThicknessType)
            : options.thickness)
        : undefined;

    return East.value({
        thickness: thicknessValue ? some(thicknessValue) : none,
        borderRadius: options.borderRadius !== undefined ? some(options.borderRadius) : none,
        fillColor: options.fillColor !== undefined ? some(options.fillColor) : none,
        trackColor: options.trackColor !== undefined ? some(options.trackColor) : none,
        labelColor: options.labelColor !== undefined ? some(options.labelColor) : none,
        showValue: options.showValue !== undefined ? some(options.showValue) : none,
    }, MeterStyleType);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a Meter component value — a single-bar proportional meter
 * (fill = value / max) rendered with pure Box composition (no chart
 * framework, safe in table cells at any width).
 *
 * @param value - Current meter value (FloatType)
 * @param options - Optional `max` / `label` / `tone` + visual style fields
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * Default `max` is 100. When `tone` is set, the renderer picks a default
 * fill colour from the Chakra status palette (`success` → green,
 * `warning` → orange, `danger` → red, `info` → blue, `neutral` → gray).
 * Apps override with `fillColor`.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Meter, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return Meter.Root(72.0, { tone: "success", label: Text.Root("Service level") });
 * });
 * ```
 */
function createMeter(
    value: SubtypeExprOrValue<FloatType>,
    options?: MeterOptions,
): ExprType<UIComponentType> {
    const toneValue = options?.tone !== undefined
        ? (typeof options.tone === "string"
            ? East.value(variant(options.tone, null), StatusTokenType)
            : options.tone)
        : undefined;
    const densityValue = options?.density !== undefined
        ? (typeof options.density === "string"
            ? East.value(variant(options.density, null), DensityType)
            : options.density)
        : undefined;
    const styleValue = buildMeterStyle(options);

    return East.value(variant("Meter", {
        value,
        max: options?.max !== undefined ? some(options.max) : none,
        label: options?.label !== undefined ? some(options.label as SubtypeExprOrValue<UIComponentType>) : none,
        tone: toneValue ? some(toneValue) : none,
        density: densityValue ? some(densityValue) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface MeterNamespace {
    Root: typeof createMeter;
    Types: {
        Meter: typeof MeterType;
        Thickness: typeof MeterThicknessType;
        Style: typeof MeterStyleType;
    };
}

/**
 * Meter — single-bar proportional meter primitive.
 *
 * @remarks
 * Pure Box composition — no chart framework, no virtualisation. Safe to
 * drop into a table cell at any width.
 */
export const Meter: MeterNamespace = {
    /**
     * Creates a Meter component value.
     *
     * @param value - Current value
     * @param options - Optional `max` / `label` / `tone` + visual style
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Meter, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return Meter.Root(42.0, { max: 100, tone: "warning", thickness: "sm" });
     * });
     * ```
     */
    Root: createMeter,
    Types: {
        /**
         * East StructType for a Meter value — the serialisable IR shape.
         *
         * @remarks
         * Mirror of `MeterType`. Exposed on the namespace so consumers can
         * reference the IR type via `Meter.Types.Meter`.
         *
         * @property value - Current meter value
         * @property max - Maximum value (defaults to 100)
         * @property label - Optional label UIComponent
         * @property tone - Semantic status tone
         * @property density - Density override; shares the cascade with `ChipRail` / `Trace` so mixed display cells align
         * @property style - Optional visual style sub-struct
         */
        Meter: MeterType,
        /**
         * Visual thickness preset for Meter.
         *
         * @remarks
         * Drives the track height: xs=2px, sm=4px, md=6px, lg=8px.
         *
         * @property xs - Extra thin (2px)
         * @property sm - Thin (4px, default)
         * @property md - Medium (6px)
         * @property lg - Thick (8px)
         */
        Thickness: MeterThicknessType,
        /**
         * East StructType holding every visual field for a Meter.
         *
         * @remarks
         * Mirror of `MeterStyleType` from `./types.js`. Thickness preset
         * plus three colour slots (fill, track, label).
         *
         * @property thickness - Visual thickness preset
         * @property fillColor - Explicit fill colour override
         * @property trackColor - Explicit track colour override
         * @property labelColor - Explicit label text colour override
         */
        Style: MeterStyleType,
    },
};
