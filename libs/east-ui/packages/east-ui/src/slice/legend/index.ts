/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType } from "../../platform/slice/index.js";
import { SliceLegendModeType, SliceLegendType } from "./types.js";

export { SliceLegendModeType, SliceLegendType } from "./types.js";

/**
 * Creates a `Slice.Legend` — an inline rail of `swatch · label · count` items
 * for the active breakdown's series.
 *
 * In `filter` mode (the default, #188) the legend is a **facet bar**: items
 * come from the self-excluding `slice.facetGroups()` (options never disappear
 * while selected) and clicking an item toggles it in the field's `in`-set
 * filter — OR within the field, AND across fields — narrowing every view
 * bound to the same slice key. In `visibility` mode a click flips the series'
 * membership in `state.visible` (chart-decluttering; rows untouched).
 *
 * @param options - The legend configuration ({@link SliceLegendOptions})
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
 *         return Slice.Legend.Root({ slice });               // facet bar
 *         // Slice.Legend.Root({ slice, mode: "visibility" }) — eye rail
 *     })),
 * );
 * ```
 */
function createSliceLegend(
    options: SliceLegendOptions,
): ExprType<UIComponentType> {
    return East.value(variant("SliceLegend", {
        slice: options.slice,
        mode:  options.mode !== undefined ? some(variant(options.mode, null)) : none,
    }), UIComponentType);
}

/**
 * Options for `Slice.Legend`.
 *
 * @property slice - The bound slice (from `Slice.bind`)
 * @property mode  - `filter` (facet bar, default) or `visibility` (eye rail)
 */
export interface SliceLegendOptions {
    /** The bound slice (from `Slice.bind`). */
    slice: SubtypeExprOrValue<SliceBindType>;
    /** Interaction mode — `filter` (facet bar, default) or `visibility`. */
    mode?: "filter" | "visibility";
}

/** `Slice.Legend` — facet bar over the breakdown series (or the visibility eye rail). */
export const SliceLegend = {
    Root: createSliceLegend,
    Types: {
        Legend: SliceLegendType,
        Mode: SliceLegendModeType,
    },
} as const;
