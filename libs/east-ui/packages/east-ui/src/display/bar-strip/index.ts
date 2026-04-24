/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
    BooleanType,
    East,
    FloatType,
    IntegerType,
    OptionType,
    StructType,
    StringType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { StatusTokenType, OrientationType } from "../../style.js";
import { UIComponentType } from "../../component.js";
import {
    BarStripStyleType,
    BarStripSortType,
    BarStripThicknessType,
    type BarStripOptions,
    type BarStripItem,
} from "./types.js";

export {
    BarStripStyleType,
    BarStripSortType,
    BarStripThicknessType,
    type BarStripSortLiteral,
    type BarStripThicknessLiteral,
    type BarStripOptions,
    type BarStripItem,
} from "./types.js";

// ============================================================================
// BarStripItemType — per-row data
// ============================================================================

/**
 * East StructType for a single BarStrip row.
 *
 * @property label - Row label (UIComponent)
 * @property value - Numeric value (drives bar width relative to peer max)
 * @property tone - Semantic tone (drives default bar colour)
 * @property color - Per-row colour override
 * @property trailing - Optional trailing UIComponent (chip / badge / etc.)
 */
export const BarStripItemType: StructType<{
    label: UIComponentType,
    value: FloatType,
    tone: OptionType<StatusTokenType>,
    color: OptionType<StringType>,
    trailing: OptionType<UIComponentType>,
}> = StructType({
    label: UIComponentType,
    value: FloatType,
    tone: OptionType(StatusTokenType),
    color: OptionType(StringType),
    trailing: OptionType(UIComponentType),
});

/** Type alias for BarStripItemType. */
export type BarStripItemType = typeof BarStripItemType;

// ============================================================================
// BarStripType — standalone mirror of the inline variant
// ============================================================================

/**
 * East StructType for a BarStrip value — mirrors the inline `BarStrip`
 * variant in `component.ts`.
 *
 * @property items - Array of row data
 * @property showValues - Whether to render trailing value text
 * @property sort - Sort direction (applied at factory time for the IR)
 * @property maxItems - Optional row limit
 * @property style - Optional visual style sub-struct
 */
export const BarStripType: StructType<{
    items: ArrayType<BarStripItemType>,
    showValues: OptionType<BooleanType>,
    sort: OptionType<BarStripSortType>,
    maxItems: OptionType<IntegerType>,
    style: OptionType<BarStripStyleType>,
}> = StructType({
    items: ArrayType(BarStripItemType),
    showValues: OptionType(BooleanType),
    sort: OptionType(BarStripSortType),
    maxItems: OptionType(IntegerType),
    style: OptionType(BarStripStyleType),
});

/** Type alias for BarStripType. */
export type BarStripType = typeof BarStripType;

// ============================================================================
// Helpers
// ============================================================================

function buildItem(item: BarStripItem): ExprType<BarStripItemType> {
    const toneValue = item.tone !== undefined
        ? (typeof item.tone === "string"
            ? East.value(variant(item.tone, null), StatusTokenType)
            : item.tone)
        : undefined;
    return East.value({
        label: item.label as SubtypeExprOrValue<UIComponentType>,
        value: item.value,
        tone: toneValue ? some(toneValue) : none,
        color: item.color !== undefined ? some(item.color) : none,
        trailing: item.trailing !== undefined ? some(item.trailing as SubtypeExprOrValue<UIComponentType>) : none,
    }, BarStripItemType);
}

function buildBarStripStyle(options: BarStripOptions | undefined): ExprType<BarStripStyleType> | undefined {
    if (options === undefined) return undefined;
    const hasAny = options.orientation !== undefined
        || options.thickness !== undefined
        || options.borderRadius !== undefined
        || options.trackColor !== undefined
        || options.labelColor !== undefined
        || options.valueColor !== undefined;
    if (!hasAny) return undefined;

    const orientationValue = options.orientation !== undefined
        ? (typeof options.orientation === "string"
            ? East.value(variant(options.orientation, null), OrientationType)
            : options.orientation)
        : undefined;
    const thicknessValue = options.thickness !== undefined
        ? (typeof options.thickness === "string"
            ? East.value(variant(options.thickness, null), BarStripThicknessType)
            : options.thickness)
        : undefined;

    return East.value({
        orientation: orientationValue ? some(orientationValue) : none,
        thickness: thicknessValue ? some(thicknessValue) : none,
        borderRadius: options.borderRadius !== undefined ? some(options.borderRadius) : none,
        trackColor: options.trackColor !== undefined ? some(options.trackColor) : none,
        labelColor: options.labelColor !== undefined ? some(options.labelColor) : none,
        valueColor: options.valueColor !== undefined ? some(options.valueColor) : none,
    }, BarStripStyleType);
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates a BarStrip component value — a list of rows, each rendered as
 * `label + horizontal bar + (optional value / trailing slot)`.
 *
 * @param items - Array of row data (label + value + optional tone / color / trailing)
 * @param options - Optional config (`showValues`, `sort`, `maxItems`) + visual style
 * @returns An East expression of type `UIComponentType`
 *
 * @remarks
 * Bars are sized proportional to the max value across visible rows
 * (after `sort` + `maxItems` clipping). Renderer uses pure Flex
 * composition — no chart framework.
 *
 * Retires `Chart.BarList` in Phase C of Plan 1.7.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { BarStrip, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, $ => {
 *     return BarStrip.Root([
 *         { label: Text.Root("Alpha"), value: 42.0, tone: "success" },
 *         { label: Text.Root("Beta"), value: 28.0, tone: "warning" },
 *         { label: Text.Root("Gamma"), value: 15.0, tone: "danger" },
 *     ], { sort: "desc", showValues: true });
 * });
 * ```
 */
function createBarStrip(
    items: BarStripItem[],
    options?: BarStripOptions,
): ExprType<UIComponentType> {
    const itemValues = items.map(buildItem);
    const sortValue = options?.sort !== undefined
        ? (typeof options.sort === "string"
            ? East.value(variant(options.sort, null), BarStripSortType)
            : options.sort)
        : undefined;
    const styleValue = buildBarStripStyle(options);

    return East.value(variant("BarStrip", {
        items: East.value(itemValues, ArrayType(BarStripItemType)),
        showValues: options?.showValues !== undefined ? some(options.showValues) : none,
        sort: sortValue ? some(sortValue) : none,
        maxItems: options?.maxItems !== undefined ? some(options.maxItems) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

interface BarStripNamespace {
    Root: typeof createBarStrip;
    Types: {
        BarStrip: typeof BarStripType;
        Item: typeof BarStripItemType;
        Sort: typeof BarStripSortType;
        Thickness: typeof BarStripThicknessType;
        Style: typeof BarStripStyleType;
    };
}

/**
 * BarStrip — list of horizontal bars with labels + values.
 *
 * @remarks
 * Pure Flex composition — retires the legacy `Chart.BarList` primitive.
 */
export const BarStrip: BarStripNamespace = {
    /**
     * Creates a BarStrip component value.
     *
     * @param items - Array of row data
     * @param options - Optional config + visual style
     * @returns An East expression of type `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { BarStrip, Text, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, $ => {
     *     return BarStrip.Root(
     *         [{ label: Text.Root("A"), value: 60 }, { label: Text.Root("B"), value: 40 }],
     *         { sort: "desc", thickness: "md" },
     *     );
     * });
     * ```
     */
    Root: createBarStrip,
    Types: {
        /**
         * East StructType for a BarStrip value — the serialisable IR shape.
         *
         * @property items - Array of row data
         * @property showValues - Whether to render trailing value text
         * @property sort - Sort direction
         * @property maxItems - Optional row limit
         * @property style - Optional visual style sub-struct
         */
        BarStrip: BarStripType,
        /**
         * East StructType for a single BarStrip row.
         *
         * @property label - Row label (UIComponent)
         * @property value - Numeric value
         * @property tone - Semantic tone
         * @property color - Per-row colour override
         * @property trailing - Optional trailing slot
         */
        Item: BarStripItemType,
        /**
         * Sort direction preset for BarStrip.
         *
         * @property asc - Ascending by value
         * @property desc - Descending by value
         * @property none - Preserve input order (default)
         */
        Sort: BarStripSortType,
        /**
         * Row-thickness preset for BarStrip.
         *
         * @property xs - Extra thin rows
         * @property sm - Thin rows (default)
         * @property md - Medium rows
         */
        Thickness: BarStripThicknessType,
        /**
         * East StructType holding every visual field for a BarStrip.
         *
         * @property orientation - Geometric orientation
         * @property thickness - Row thickness preset
         * @property trackColor - Explicit track colour override
         * @property labelColor - Explicit label text colour override
         * @property valueColor - Explicit value text colour override
         */
        Style: BarStripStyleType,
    },
};
