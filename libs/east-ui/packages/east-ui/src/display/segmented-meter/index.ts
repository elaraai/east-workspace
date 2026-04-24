/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
    East,
    FloatType,
    OptionType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { StatusTokenType } from "../../style/interaction.js";
import { UIComponentType } from "../../component.js";
import {
    SegmentedMeterSegmentType,
    SegmentedMeterStyleType,
    SegmentedMeterThicknessType,
    SegmentedMeterLabelsType,
    type SegmentedMeterOptions,
    type SegmentedMeterSegment,
} from "./types.js";

export {
    SegmentedMeterSegmentType,
    SegmentedMeterStyleType,
    SegmentedMeterThicknessType,
    SegmentedMeterLabelsType,
    type SegmentedMeterThicknessLiteral,
    type SegmentedMeterLabelsLiteral,
    type SegmentedMeterOptions,
    type SegmentedMeterSegment,
} from "./types.js";

// ============================================================================
// SegmentedMeterType — standalone mirror of the inline variant
// ============================================================================

/**
 * East StructType for a SegmentedMeter value — mirrors the inline
 * `SegmentedMeter` variant in `component.ts`.
 *
 * @remarks
 * Main struct holds the array of segments, an optional caption
 * UIComponent, an optional `max` override (defaults to sum of segment
 * values), and a `style` sub-struct.
 *
 * @property segments - Array of segment data
 * @property caption - Optional caption UIComponent
 * @property max - Optional total reference
 * @property style - Optional visual style sub-struct
 */
export const SegmentedMeterType: StructType<{
    segments: ArrayType<SegmentedMeterSegmentType>,
    caption: OptionType<UIComponentType>,
    max: OptionType<FloatType>,
    style: OptionType<SegmentedMeterStyleType>,
}> = StructType({
    segments: ArrayType(SegmentedMeterSegmentType),
    caption: OptionType(UIComponentType),
    max: OptionType(FloatType),
    style: OptionType(SegmentedMeterStyleType),
});

/** Type alias for SegmentedMeterType. */
export type SegmentedMeterType = typeof SegmentedMeterType;

// ============================================================================
// Helpers
// ============================================================================

function buildSegment(seg: SegmentedMeterSegment): ExprType<SegmentedMeterSegmentType> {
    const toneValue = seg.tone !== undefined
        ? (typeof seg.tone === "string"
            ? East.value(variant(seg.tone, null), StatusTokenType)
            : seg.tone)
        : undefined;
    return East.value({
        value: seg.value,
        tone: toneValue ? some(toneValue) : none,
        color: seg.color !== undefined ? some(seg.color) : none,
        label: seg.label !== undefined ? some(seg.label) : none,
    }, SegmentedMeterSegmentType);
}

function buildSegmentedMeterStyle(options: SegmentedMeterOptions | undefined): ExprType<SegmentedMeterStyleType> | undefined {
    if (options === undefined) return undefined;
    const hasAny = options.thickness !== undefined
        || options.labels !== undefined
        || options.trackColor !== undefined
        || options.captionColor !== undefined
        || options.labelColor !== undefined;
    if (!hasAny) return undefined;

    const thicknessValue = options.thickness !== undefined
        ? (typeof options.thickness === "string"
            ? East.value(variant(options.thickness, null), SegmentedMeterThicknessType)
            : options.thickness)
        : undefined;
    const labelsValue = options.labels !== undefined
        ? (typeof options.labels === "string"
            ? East.value(variant(options.labels, null), SegmentedMeterLabelsType)
            : options.labels)
        : undefined;

    return East.value({
        thickness: thicknessValue ? some(thicknessValue) : none,
        labels: labelsValue ? some(labelsValue) : none,
        trackColor: options.trackColor !== undefined ? some(options.trackColor) : none,
        captionColor: options.captionColor !== undefined ? some(options.captionColor) : none,
        labelColor: options.labelColor !== undefined ? some(options.labelColor) : none,
    }, SegmentedMeterStyleType);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a SegmentedMeter component value — a multi-segment horizontal
 * bar rendered with pure Flex composition.
 *
 * @param segments - Array of segment data (value + optional tone / color / label)
 * @param options - Optional caption / max + visual style fields
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * Segments are laid out as a `<Flex>` with each segment at `flex=value`.
 * `max` is optional; when absent the renderer uses `sum(segments.value)`
 * so segments always fill the track. When `max > sum(segments.value)`,
 * remaining space shows the `trackColor` (the "empty" track).
 *
 * Per-segment `color` overrides the tone-default palette; `tone` alone
 * picks from the Chakra status palette.
 *
 * Retires `Chart.BarSegment` in Phase C of Plan 1.7.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { SegmentedMeter, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return SegmentedMeter.Root([
 *         { value: 40, tone: "success", label: "Fresh" },
 *         { value: 35, tone: "warning", label: "Stale" },
 *         { value: 25, tone: "danger", label: "Broken" },
 *     ], { thickness: "md", labels: "outside" });
 * });
 * ```
 */
function createSegmentedMeter(
    segments: SegmentedMeterSegment[],
    options?: SegmentedMeterOptions,
): ExprType<UIComponentType> {
    const segmentValues = segments.map(buildSegment);
    const styleValue = buildSegmentedMeterStyle(options);

    return East.value(variant("SegmentedMeter", {
        segments: East.value(segmentValues, ArrayType(SegmentedMeterSegmentType)),
        caption: options?.caption !== undefined ? some(options.caption as SubtypeExprOrValue<UIComponentType>) : none,
        max: options?.max !== undefined ? some(options.max) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface SegmentedMeterNamespace {
    Root: typeof createSegmentedMeter;
    Types: {
        SegmentedMeter: typeof SegmentedMeterType;
        Segment: typeof SegmentedMeterSegmentType;
        Thickness: typeof SegmentedMeterThicknessType;
        Labels: typeof SegmentedMeterLabelsType;
        Style: typeof SegmentedMeterStyleType;
    };
}

/**
 * SegmentedMeter — multi-segment horizontal bar primitive.
 *
 * @remarks
 * Pure Flex composition — no chart framework. Retires the legacy
 * `Chart.BarSegment` primitive.
 */
export const SegmentedMeter: SegmentedMeterNamespace = {
    /**
     * Creates a SegmentedMeter component value.
     *
     * @param segments - Array of segment data
     * @param options - Optional caption / max + visual style
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { SegmentedMeter, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return SegmentedMeter.Root(
     *         [{ value: 70, color: "#3d5cff" }, { value: 30, color: "#e5e7eb" }],
     *         { caption: Text.Root("Capacity utilisation"), thickness: "md" },
     *     );
     * });
     * ```
     */
    Root: createSegmentedMeter,
    Types: {
        /**
         * East StructType for a SegmentedMeter value — the serialisable IR
         * shape.
         *
         * @property segments - Array of segment data
         * @property caption - Optional caption UIComponent
         * @property max - Optional total reference
         * @property style - Optional visual style sub-struct
         */
        SegmentedMeter: SegmentedMeterType,
        /**
         * East StructType for a single segment.
         *
         * @property value - Segment value (weight)
         * @property tone - Semantic tone
         * @property color - Per-segment colour override
         * @property label - Optional segment label
         */
        Segment: SegmentedMeterSegmentType,
        /**
         * Visual thickness preset for SegmentedMeter.
         *
         * @property xs - Extra thin
         * @property sm - Thin (default)
         * @property md - Medium
         * @property lg - Thick
         */
        Thickness: SegmentedMeterThicknessType,
        /**
         * Label position preset for SegmentedMeter.
         *
         * @property inside - Labels rendered inside each segment
         * @property outside - Labels rendered below the bar
         * @property none - Labels hidden
         */
        Labels: SegmentedMeterLabelsType,
        /**
         * East StructType holding every visual field for a SegmentedMeter.
         *
         * @property thickness - Visual thickness preset
         * @property labels - Label position preset
         * @property trackColor - Explicit track colour override
         * @property captionColor - Explicit caption colour override
         * @property labelColor - Explicit default segment label colour override
         */
        Style: SegmentedMeterStyleType,
    },
};
