/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { type ExprType, type SubtypeExprOrValue, East, variant } from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType } from "../../platform/slice/index.js";
import { SliceSummaryType } from "./types.js";

export { SliceSummaryType } from "./types.js";

/**
 * Creates a `Slice.Summary` — a one-line `N results · M filters · clear all`
 * status bar bound to a slice. The result count comes from `slice.resultCount()`
 * (over the rows bound at `Slice.bind`); nothing else to wire.
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
 *         return Slice.Summary.Root(slice);
 *     })),
 * );
 * ```
 */
function createSliceSummary(
    slice: SubtypeExprOrValue<SliceBindType>,
): ExprType<UIComponentType> {
    return East.value(variant("SliceSummary", { slice }), UIComponentType);
}

/** `Slice.Summary` — result/filter-count status bar. */
export const SliceSummary = {
    Root: createSliceSummary,
    Types: {
        Summary: SliceSummaryType,
    },
} as const;
