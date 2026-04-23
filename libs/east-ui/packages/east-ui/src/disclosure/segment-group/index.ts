/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    OptionType,
    StructType,
    StringType,
    BooleanType,
    FunctionType,
    NullType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import {
    SizeType,
    ColorSchemeType,
    OrientationType,
    type ColorSchemeLiteral,
    type OrientationLiteral,
} from "../../style.js";
import { Text } from "../../typography/text/index.js";
import {
    SegmentGroupStyleType,
    type SegmentGroupStyle,
    type SegmentGroupItemOptions,
} from "./types.js";

// Re-export types
export {
    SegmentGroupStyleType,
    type SegmentGroupStyle,
    type SegmentGroupItemOptions,
} from "./types.js";

// ============================================================================
// SegmentGroupItemType — standalone mirror of the inline item sub-struct
// ============================================================================

/**
 * Concrete struct mirroring the inline item sub-struct used by the
 * `SegmentGroup` variant in `component.ts`.
 *
 * @property value - Unique identifier for the segment
 * @property label - Rich label (UIComp — strings coerced to `Text.Root` at the factory)
 * @property disabled - Whether this segment is disabled
 */
export const SegmentGroupItemType: StructType<{
    value: StringType,
    label: UIComponentType,
    disabled: OptionType<BooleanType>,
}> = StructType({
    value: StringType,
    label: UIComponentType,
    disabled: OptionType(BooleanType),
});

export type SegmentGroupItemType = typeof SegmentGroupItemType;

// ============================================================================
// SegmentGroupType — standalone mirror of the inline `SegmentGroup` variant
// ============================================================================

/**
 * Concrete struct mirroring the inline `SegmentGroup` variant in
 * `component.ts`. Renderers reference this for `equalFor` / `ValueTypeOf`.
 *
 * @property value - Currently selected segment value
 * @property items - Array of segment items
 * @property onChange - Callback invoked with the new selected value
 * @property style - Visual-presentation sub-struct
 */
export const SegmentGroupType: StructType<{
    value: StringType,
    items: ArrayType<SegmentGroupItemType>,
    onChange: OptionType<FunctionType<[StringType], NullType>>,
    style: OptionType<SegmentGroupStyleType>,
}> = StructType({
    value: StringType,
    items: ArrayType(SegmentGroupItemType),
    onChange: OptionType(FunctionType([StringType], NullType)),
    style: OptionType(SegmentGroupStyleType),
});

export type SegmentGroupType = typeof SegmentGroupType;

// ============================================================================
// SegmentGroup Item Factory
// ============================================================================

type SegmentLabelInput =
    | string
    | ExprType<UIComponentType>
    | SubtypeExprOrValue<UIComponentType>;

/**
 * Creates a SegmentGroup item.
 *
 * @param value - Unique identifier for this segment
 * @param label - String (coerced to `Text.Root(s)`) or any UIComponentType
 * @param options - Optional per-item configuration (`disabled`)
 * @returns An East expression representing the segment item
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { SegmentGroup, Stack, Text, Badge, UIComponentType } from "@elaraai/east-ui";
 *
 * const item = SegmentGroup.Item(
 *     "unmet",
 *     Stack.HStack([Text.Root("Unmet"), Badge.Root("2")], { gap: "2" }),
 * );
 * ```
 */
function createSegmentGroupItem(
    value: SubtypeExprOrValue<StringType>,
    label: SegmentLabelInput,
    options?: SegmentGroupItemOptions,
): ExprType<SegmentGroupItemType> {
    const labelExpr: ExprType<UIComponentType> = typeof label === "string"
        ? Text.Root(label)
        : label as ExprType<UIComponentType>;

    return East.value({
        value,
        label: labelExpr,
        disabled: options?.disabled !== undefined ? some(options.disabled) : none,
    }, SegmentGroupItemType);
}

// ============================================================================
// SegmentGroup Root Factory
// ============================================================================

/**
 * TypeScript options bag for `SegmentGroup.Root`.
 *
 * @property onChange - Callback invoked with the new selected value
 * @property style - Visual-presentation sub-struct
 */
export interface SegmentGroupOptions {
    /** Callback invoked with the new selected value */
    onChange?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Visual-presentation sub-struct */
    style?: SegmentGroupStyle;
}

/**
 * Creates a SegmentGroup component.
 *
 * @param value - Currently selected segment value
 * @param items - Array of segment items (created with `SegmentGroup.Item`)
 * @param options - Behaviour + optional `style`
 * @returns An East expression representing the SegmentGroup component
 *
 * @remarks
 * Per the Type-shape convention: `value` (state) and `onChange` (behaviour)
 * are top-level; `size` / `colorPalette` / `orientation` + colour slots
 * live inside `options.style`.
 *
 * @example
 * ```ts
 * import { East, NullType, StringType } from "@elaraai/east";
 * import { Reactive, SegmentGroup, State, UIComponentType } from "@elaraai/east-ui";
 *
 * const viewToggle = East.function([], UIComponentType, _$ =>
 *     Reactive.Root(East.function([], UIComponentType, $ => {
 *         const bind = $.let(State.bind([StringType], "seg_view", "summary"));
 *         const view = $.let(bind.read());
 *         const onChange = $.const(East.function([StringType], NullType, ($, next) => {
 *             $(bind.write(next));
 *         }));
 *         return SegmentGroup.Root(view, [
 *             SegmentGroup.Item("summary", "Summary"),
 *             SegmentGroup.Item("demand", "Demand"),
 *             SegmentGroup.Item("coverage", "Coverage"),
 *             SegmentGroup.Item("rotation", "Rotation plan"),
 *             SegmentGroup.Item("unmet", "Unmet · 2"),
 *         ], { onChange, style: { size: "sm" } });
 *     })),
 * );
 * ```
 */
function createSegmentGroupRoot(
    value: SubtypeExprOrValue<StringType>,
    items: SubtypeExprOrValue<ArrayType<SegmentGroupItemType>>,
    options?: SegmentGroupOptions,
): ExprType<UIComponentType> {
    const styleValue = options?.style ? buildSegmentGroupStyle(options.style) : undefined;

    return East.value(variant("SegmentGroup", {
        value,
        items: items as never,
        onChange: options?.onChange ? some(options.onChange) : none,
        style: styleValue ? some(styleValue) : none,
    }), UIComponentType);
}

function buildSegmentGroupStyle(style: SegmentGroupStyle): ExprType<SegmentGroupStyleType> {
    const sizeValue = style.size
        ? (typeof style.size === "string"
            ? East.value(variant(style.size, null), SizeType)
            : style.size)
        : undefined;

    const colorPaletteValue = style.colorPalette
        ? (typeof style.colorPalette === "string"
            ? East.value(variant(style.colorPalette as ColorSchemeLiteral, null), ColorSchemeType)
            : style.colorPalette)
        : undefined;

    const orientationValue = style.orientation
        ? (typeof style.orientation === "string"
            ? East.value(variant(style.orientation as OrientationLiteral, null), OrientationType)
            : style.orientation)
        : undefined;

    return East.value({
        size: sizeValue ? some(sizeValue) : none,
        colorPalette: colorPaletteValue ? some(colorPaletteValue) : none,
        orientation: orientationValue ? some(orientationValue) : none,
        background: style.background !== undefined ? some(style.background) : none,
        borderColor: style.borderColor !== undefined ? some(style.borderColor) : none,
        activeBackground: style.activeBackground !== undefined ? some(style.activeBackground) : none,
        activeColor: style.activeColor !== undefined ? some(style.activeColor) : none,
        inactiveColor: style.inactiveColor !== undefined ? some(style.inactiveColor) : none,
    }, SegmentGroupStyleType);
}

// ============================================================================
// SegmentGroup Namespace
// ============================================================================

/**
 * SegmentGroup primitive — two-or-more-state toolbar toggle (distinct from
 * `Tabs`, which owns full content panels).
 *
 * @remarks
 * Use `SegmentGroup.Root(value, items, options)` for the container and
 * `SegmentGroup.Item(value, label, options)` for each segment. The
 * `label` accepts any UIComponentType — strings coerce to `Text.Root(s)`.
 */
export const SegmentGroup = {
    /**
     * Creates a SegmentGroup container.
     *
     * @param value - Currently selected segment value
     * @param items - Array of segment items
     * @param options - Behaviour + optional `style`
     * @returns An East expression representing the SegmentGroup component
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { SegmentGroup, UIComponentType } from "@elaraai/east-ui";
     *
     * const ex = East.function([], UIComponentType, _$ =>
     *     SegmentGroup.Root("summary", [
     *         SegmentGroup.Item("summary", "Summary"),
     *         SegmentGroup.Item("demand", "Demand"),
     *     ], { style: { size: "sm" } }),
     * );
     * ```
     */
    Root: createSegmentGroupRoot,
    /**
     * Creates a SegmentGroup item.
     *
     * @param value - Unique identifier for the segment
     * @param label - String (coerced to `Text.Root(s)`) or UIComponentType
     * @param options - Per-item options (`disabled`)
     *
     * @example
     * ```ts
     * import { SegmentGroup, Stack, Text, Badge } from "@elaraai/east-ui";
     *
     * const item = SegmentGroup.Item(
     *     "unmet",
     *     Stack.HStack([Text.Root("Unmet"), Badge.Root("2")]),
     * );
     * ```
     */
    Item: createSegmentGroupItem,
    Types: {
        /**
         * The concrete East type for the SegmentGroup — mirrors the inline
         * `SegmentGroup` variant in `component.ts`.
         *
         * @property value - Currently selected segment value
         * @property items - Array of segment items
         * @property onChange - Selection callback
         * @property style - Visual-presentation sub-struct
         */
        SegmentGroup: SegmentGroupType,
        /**
         * The concrete East type for a SegmentGroup item.
         *
         * @property value - Unique identifier
         * @property label - Rich label (UIComp)
         * @property disabled - Whether the segment is disabled
         */
        Item: SegmentGroupItemType,
        /**
         * Visual-only style struct for SegmentGroup. See {@link SegmentGroupStyleType}.
         */
        Style: SegmentGroupStyleType,
    },
} as const;
