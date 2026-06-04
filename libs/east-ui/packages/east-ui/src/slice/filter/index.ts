/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    StringType,
    BooleanType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType } from "../../platform/slice/index.js";
import { SliceFilterType } from "./types.js";

export { SliceFilterType } from "./types.js";

/** Options for `Slice.Filter`. */
export interface SliceFilterOptions {
    /** The bound slice (from `Slice.bind`). */
    slice: SubtypeExprOrValue<SliceBindType>;
    /** Unit noun for the focused `SHOWING N {unit}` footer (count from `slice.resultCount()`). */
    unit?: SubtypeExprOrValue<StringType>;
    /** Render density — defaults to the surrounding `Slice.Frame`, else `focused`. */
    density?: "compact" | "focused";
    /** Render the add-filter `Slice.Edit` popover open on mount (for static snapshots). */
    editOpen?: SubtypeExprOrValue<BooleanType>;
}

/**
 * Creates a `Slice.Filter` — faceted predicate chips bound to a slice. Chips
 * render straight from `state.filters` (field id, operator, value), each with
 * a remove `×`; `+ add filter` toggles a built-in inline predicate builder
 * (driven by `slice.fields()`) that appends via `slice.addFilter` — no host
 * wiring.
 *
 * @param slice   - The bound slice (from `Slice.bind`)
 * @param options - Optional `resultCount` / `unit` / `builderOpen`
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
 *         return Slice.Filter.Root({ slice, unit: "events" });
 *     })),
 * );
 * ```
 */
function createSliceFilter(
    options: SliceFilterOptions,
): ExprType<UIComponentType> {
    return East.value(variant("SliceFilter", {
        slice:    options.slice,
        unit:     options.unit !== undefined ? some(options.unit) : none,
        density:  options.density !== undefined ? some(variant(options.density, null)) : none,
        editOpen: options.editOpen !== undefined ? some(options.editOpen) : none,
    }), UIComponentType);
}

/** `Slice.Filter` — faceted predicate chips. */
export const SliceFilter = {
    Root: createSliceFilter,
    Types: {
        Filter: SliceFilterType,
    },
} as const;
