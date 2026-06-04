/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    BooleanType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType } from "../../platform/slice/index.js";
import { SliceRangePickerType } from "./types.js";

export { SliceRangePickerType } from "./types.js";

/** Options for `Slice.Range`. */
export interface SliceRangeOptions {
    /** The bound slice (from `Slice.bind`). */
    slice: SubtypeExprOrValue<SliceBindType>;
    /** Render the picker popover open on mount (for static snapshots). */
    editOpen?: SubtypeExprOrValue<BooleanType>;
}

/**
 * Creates a `Slice.Range` — a single time-range pill bound to a slice. Clicking
 * it opens the `Slice.Edit` picker (presets `Today / 7d / 30d / 90d / YTD /
 * Custom…` · compare · resolved window). One pill at every size.
 *
 * @param slice   - The bound slice (from `Slice.bind`)
 * @param options - Optional `editOpen` to pre-open the picker for snapshots
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
 *
 * const view = East.function([], UIComponentType, _$ =>
 *     Reactive.Root(East.function([], UIComponentType, $ => {
 *         const slice = $.let(Slice.bind([EventType], "demo.events", cfg, Slice.state()));
 *         return Slice.Range.Root({ slice });
 *     })),
 * );
 * ```
 */
function createSliceRange(
    options: SliceRangeOptions,
): ExprType<UIComponentType> {
    return East.value(variant("SliceRange", {
        slice: options.slice,
        editOpen: options.editOpen !== undefined ? some(options.editOpen) : none,
    }), UIComponentType);
}

/** `Slice.Range` — preset time-range picker. */
export const SliceRange = {
    Root: createSliceRange,
    Types: {
        Range: SliceRangePickerType,
    },
} as const;
