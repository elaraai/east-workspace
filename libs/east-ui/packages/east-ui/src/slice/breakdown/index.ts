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
import { SliceBreakdownPickerType } from "./types.js";

export { SliceBreakdownPickerType } from "./types.js";

/** Options for `Slice.Breakdown`. */
export interface SliceBreakdownOptions {
    /** The bound slice (from `Slice.bind`). */
    slice: SubtypeExprOrValue<SliceBindType>;
    /** Render density — defaults to the surrounding `Slice.Frame`, else `focused`. */
    density?: "compact" | "focused";
}

/**
 * Creates a `Slice.Breakdown` — a split-by-dimension picker. Dimension chips
 * (from `slice.dimensions()`) set `state.breakdown` (the active one is
 * brand-tinted with a remove `×`); the resulting-series preview is rendered
 * from the platform-computed groups.
 *
 * Dimensions are config-derived (read from the slice); only `groups` is
 * data-derived — `Slice.apply.breakdown(state, config, data)`.
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
 *         return Slice.Breakdown.Root({ slice });
 *     })),
 * );
 * ```
 */
function createSliceBreakdown(
    options: SliceBreakdownOptions,
): ExprType<UIComponentType> {
    return East.value(variant("SliceBreakdown", {
        slice: options.slice,
        density: options.density !== undefined ? some(variant(options.density, null)) : none,
    }), UIComponentType);
}

/** `Slice.Breakdown` — split-by-dimension picker. */
export const SliceBreakdown = {
    Root: createSliceBreakdown,
    Types: {
        Breakdown: SliceBreakdownPickerType,
    },
} as const;
