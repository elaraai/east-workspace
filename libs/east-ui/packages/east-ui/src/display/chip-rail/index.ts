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
        labels: options?.labels !== undefined ? variant("some", options.labels) : variant("none", null),
        density: densityValue ? variant("some", densityValue) : variant("none", null),
        separator: separatorValue ? variant("some", separatorValue) : variant("none", null),
        style: hasStyle
            ? variant("some", East.value({
                overflow: overflowValue ? variant("some", overflowValue) : variant("none", null),
                background: options!.background ? variant("some", options!.background) : variant("none", null),
                separatorColor: options!.separatorColor ? variant("some", options!.separatorColor) : variant("none", null),
                overflowTriggerColor: options!.overflowTriggerColor ? variant("some", options!.overflowTriggerColor) : variant("none", null),
            }, ChipRailStyleType))
            : variant("none", null),
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
