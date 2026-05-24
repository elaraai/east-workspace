/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    variant,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType } from "../../platform/slice/index.js";
import { SliceLegendType } from "./types.js";

export { SliceLegendType } from "./types.js";

/**
 * Creates a `Slice.Legend` — an inline rail of `swatch · label · count ·
 * visibility-toggle` chips for the active breakdown's series (`slice.groups()`).
 * Toggling a chip flips the group's membership in `state.visible` (none = all
 * visible).
 *
 * @param slice - The bound slice (from `Slice.bind`)
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
 *
 * const view = East.function([], UIComponentType, _$ =>
 *     Reactive.Root(East.function([], UIComponentType, $ => {
 *         const slice = $.let(Slice.bind([EventType], "demo.events", cfg, Slice.state(), events));
 *         return Slice.Legend.Root(slice);
 *     })),
 * );
 * ```
 */
function createSliceLegend(
    slice: SubtypeExprOrValue<SliceBindType>,
): ExprType<UIComponentType> {
    return East.value(variant("SliceLegend", { slice }), UIComponentType);
}

/** `Slice.Legend` — series swatch / visibility rail. */
export const SliceLegend = {
    Root: createSliceLegend,
    Types: {
        Legend: SliceLegendType,
    },
} as const;
