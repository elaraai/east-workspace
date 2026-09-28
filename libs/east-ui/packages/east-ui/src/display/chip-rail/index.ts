/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    ArrayType,
    East,
    OptionType,
    StringType,
    StructType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { DensityType } from "../../style.js";
import {
    ChipRailSeparatorType,
    ChipRailOverflowType,
    ChipRailStyleType,
    type ChipRailOptions,
} from "./types.js";

/**
 * The East struct that mirrors the `ChipRail` variant's payload registered
 * inline in `src/component.ts`. Exposed for renderer equality + typing.
 */
export const ChipRailType = StructType({
    chips: ArrayType(UIComponentType),
    labels: OptionType(ArrayType(StringType)),
    density: OptionType(DensityType),
    separator: OptionType(ChipRailSeparatorType),
    style: OptionType(ChipRailStyleType),
});
export type ChipRailType = typeof ChipRailType;

// Re-export types
export {
    ChipRailSeparatorType,
    ChipRailOverflowType,
    ChipRailStyleType,
    type ChipRailSeparatorLiteral,
    type ChipRailOverflowLiteral,
    type ChipRailStyle,
    type ChipRailOptions,
} from "./types.js";

/**
 * ChipRail — horizontal chip row with density + separator + overflow control.
 *
 * @remarks
 * The rail hosts any mix of chip-shaped children — Tag, Badge, MetricChip,
 * EditableChip, Avatar, Kbd — and provides its `density` to them, so every
 * chip sizes to the same rhythm without per-chip props (a child's own
 * `density` wins over the rail's). Renders its `chips` left-to-right with
 * the chosen `separator` between them.
 *
 * @example
 * ```ts
 * import { ChipRail, Tag } from "@elaraai/east-ui";
 *
 * ChipRail.Root([
 *     Tag.Root("Week 12"),
 *     Tag.Root("Cycle"),
 *     Tag.Root("17–23 Mar"),
 * ], { density: "compact", separator: "dot" });
 * ```
 */
function createChipRail(
    chips: SubtypeExprOrValue<ArrayType<UIComponentType>>,
    options?: ChipRailOptions,
): ExprType<UIComponentType> {
    const densityValue = options?.density
        ? (typeof options.density === "string"
            ? East.value(variant(options.density, null), DensityType)
            : options.density)
        : undefined;

    const separatorValue = options?.separator
        ? (typeof options.separator === "string"
            ? East.value(variant(options.separator, null), ChipRailSeparatorType)
            : options.separator)
        : undefined;

    const overflowValue = options?.overflow
        ? (typeof options.overflow === "string"
            ? East.value(variant(options.overflow, null), ChipRailOverflowType)
            : options.overflow)
        : undefined;

    const hasStyle = !!options && (
        overflowValue !== undefined ||
        options.background !== undefined ||
        options.separatorColor !== undefined ||
        options.overflowTriggerColor !== undefined
    );

    return East.value(variant("ChipRail", {
        chips,
        labels: options?.labels !== undefined ? some(options.labels) : none,
        density: densityValue ? some(densityValue) : none,
        separator: separatorValue ? some(separatorValue) : none,
        style: hasStyle
            ? some(East.value({
                overflow: overflowValue ? some(overflowValue) : none,
                background: options!.background ? some(options!.background) : none,
                separatorColor: options!.separatorColor ? some(options!.separatorColor) : none,
                overflowTriggerColor: options!.overflowTriggerColor ? some(options!.overflowTriggerColor) : none,
            }, ChipRailStyleType))
            : none,
    }), UIComponentType);
}

/**
 * ChipRail namespace.
 */
export const ChipRail = {
    Root: createChipRail,
    Types: {
        /** The East struct for the `ChipRail` variant payload — used by the renderer's memoisation. */
        ChipRail: ChipRailType,
        Separator: ChipRailSeparatorType,
        Overflow: ChipRailOverflowType,
        Style: ChipRailStyleType,
    },
} as const;
