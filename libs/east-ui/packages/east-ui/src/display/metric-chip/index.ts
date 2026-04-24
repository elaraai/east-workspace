/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    OptionType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { SizeType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import { IconType } from "../icon/types.js";
import {
    MetricChipToneType,
    MetricChipEmphasisType,
    MetricChipStyleType,
    type MetricChipOptions,
    type MetricChipToneLiteral,
} from "./types.js";

export {
    MetricChipToneType,
    MetricChipEmphasisType,
    MetricChipStyleType,
    type MetricChipToneLiteral,
    type MetricChipEmphasisLiteral,
    type MetricChipOptions,
} from "./types.js";

// ============================================================================
// MetricChipType — standalone mirror of the inline `MetricChip` variant
// ============================================================================

/**
 * East StructType for a MetricChip value — mirrors the inline variant in
 * `component.ts`.
 *
 * @remarks
 * Main struct holds content (`value` UIComponent, `unit` text, optional
 * `icon`), the required semantic `tone` classification, and a `style`
 * sub-struct holding visual fields per §0.10.
 *
 * @property value - Primary metric value (UIComponent)
 * @property unit - Optional unit suffix (e.g. `"%"`, `"ms"`)
 * @property icon - Optional leading icon
 * @property tone - Semantic classification (positive / negative / neutral / info)
 * @property style - Optional visual style sub-struct
 */
export const MetricChipType: StructType<{
    value: UIComponentType,
    unit: OptionType<StringType>,
    icon: OptionType<IconType>,
    tone: MetricChipToneType,
    style: OptionType<MetricChipStyleType>,
}> = StructType({
    value: UIComponentType,
    unit: OptionType(StringType),
    icon: OptionType(IconType),
    tone: MetricChipToneType,
    style: OptionType(MetricChipStyleType),
});

/** Type alias for MetricChipType. */
export type MetricChipType = typeof MetricChipType;

// ============================================================================
// Helpers
// ============================================================================

function buildMetricChipStyle(options: MetricChipOptions | undefined): ExprType<MetricChipStyleType> | undefined {
    if (options === undefined) return undefined;
    const hasAny = options.emphasis !== undefined
        || options.size !== undefined
        || options.borderRadius !== undefined
        || options.color !== undefined
        || options.background !== undefined
        || options.borderColor !== undefined
        || options.iconColor !== undefined;
    if (!hasAny) return undefined;

    const emphasisValue = options.emphasis !== undefined
        ? (typeof options.emphasis === "string"
            ? East.value(variant(options.emphasis, null), MetricChipEmphasisType)
            : options.emphasis)
        : undefined;
    const sizeValue = options.size !== undefined
        ? (typeof options.size === "string"
            ? East.value(variant(options.size, null), SizeType)
            : options.size)
        : undefined;

    return East.value({
        emphasis: emphasisValue ? some(emphasisValue) : none,
        size: sizeValue ? some(sizeValue) : none,
        borderRadius: options.borderRadius !== undefined ? some(options.borderRadius) : none,
        color: options.color !== undefined ? some(options.color) : none,
        background: options.background !== undefined ? some(options.background) : none,
        borderColor: options.borderColor !== undefined ? some(options.borderColor) : none,
        iconColor: options.iconColor !== undefined ? some(options.iconColor) : none,
    }, MetricChipStyleType);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a MetricChip component value — a labelled metric pill driven by
 * a required semantic `tone`.
 *
 * @param value - Primary metric value (UIComponent)
 * @param tone - Semantic tone literal (`"positive"` / `"negative"` /
 *   `"neutral"` / `"info"`) or East expression
 * @param options - Optional `unit` / `icon` content + visual style fields
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * The default palette is driven by `tone`; overrides can be applied via
 * `style.color` / `style.background` / `style.borderColor` /
 * `style.iconColor`. `emphasis` toggles between subtle (default) / solid
 * (high-contrast) / outline (border-only) visual presets.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { MetricChip, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return MetricChip.Root(Text.Root("+12.5%"), "positive", {
 *         unit: "%",
 *         emphasis: "subtle",
 *     });
 * });
 * ```
 */
function createMetricChip(
    value: SubtypeExprOrValue<UIComponentType>,
    tone: MetricChipToneLiteral | SubtypeExprOrValue<MetricChipToneType>,
    options?: MetricChipOptions,
): ExprType<UIComponentType> {
    const toneValue = typeof tone === "string"
        ? East.value(variant(tone, null), MetricChipToneType)
        : tone;
    const styleValue = buildMetricChipStyle(options);

    return East.value(variant("MetricChip", {
        value,
        unit: options?.unit !== undefined ? some(options.unit) : none,
        icon: options?.icon !== undefined ? some(options.icon as SubtypeExprOrValue<IconType>) : none,
        tone: toneValue,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface MetricChipNamespace {
    Root: typeof createMetricChip;
    Types: {
        MetricChip: typeof MetricChipType;
        Tone: typeof MetricChipToneType;
        Emphasis: typeof MetricChipEmphasisType;
        Style: typeof MetricChipStyleType;
    };
}

/**
 * MetricChip — labelled metric pill with semantic tone.
 *
 * @remarks
 * Consumed by DeltaPill / UncertaintyBadge / SumCheckBadge patterns (§2).
 * Use `MetricChip.Root(value, tone, options?)`.
 */
export const MetricChip: MetricChipNamespace = {
    /**
     * Creates a MetricChip component value.
     *
     * @param value - Primary metric value (UIComponent)
     * @param tone - Semantic tone classification
     * @param options - Optional `unit` / `icon` + visual style fields
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { MetricChip, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return MetricChip.Root(Text.Root("Error rate 0.42%"), "negative", {
     *         emphasis: "solid",
     *     });
     * });
     * ```
     */
    Root: createMetricChip,
    Types: {
        /**
         * East StructType for a MetricChip value — the serialisable IR
         * shape.
         *
         * @remarks
         * Mirror of `MetricChipType`. Exposed on the namespace so
         * consumers can reference the IR type via
         * `MetricChip.Types.MetricChip`.
         *
         * @property value - Primary metric value (UIComponent)
         * @property unit - Optional unit suffix
         * @property icon - Optional leading icon
         * @property tone - Semantic classification
         * @property style - Optional visual style sub-struct
         */
        MetricChip: MetricChipType,
        /**
         * Semantic tone classification for MetricChip.
         *
         * @property positive - Favourable delta (green palette)
         * @property negative - Unfavourable delta (red palette)
         * @property neutral - Informational / no change (grey)
         * @property info - Advisory / annotation (blue)
         */
        Tone: MetricChipToneType,
        /**
         * Visual emphasis preset for MetricChip.
         *
         * @property subtle - Tinted background (default)
         * @property solid - High-contrast filled background
         * @property outline - Border-only with transparent background
         */
        Emphasis: MetricChipEmphasisType,
        /**
         * East StructType holding every visual field for a MetricChip.
         *
         * @property emphasis - Visual preset
         * @property size - Size preset
         * @property color - Explicit text colour override
         * @property background - Explicit background override
         * @property borderColor - Explicit border colour override
         * @property iconColor - Explicit icon colour override
         */
        Style: MetricChipStyleType,
    },
};
