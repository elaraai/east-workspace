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
    ArrayType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { SliceBindType, SliceSearchMatchType, SliceSearchMatchArrayType } from "../../platform/slice/index.js";
import { SliceSearchType } from "./types.js";

export { SliceSearchType } from "./types.js";
export { SliceSearchMatchType, SliceSearchMatchArrayType } from "../../platform/slice/index.js";

/** Options for `Slice.Search`. */
export interface SliceSearchOptions {
    /** The bound slice (from `Slice.bind`, with a `toMatch` projection). */
    slice: SubtypeExprOrValue<SliceBindType>;
    /** Recent queries rendered in the focused footer. */
    recent?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Render density — defaults to the surrounding `Slice.Frame`, else `focused`. */
    density?: "compact" | "focused";
    /** Render the dropdown open on mount (for static snapshots). */
    editOpen?: SubtypeExprOrValue<BooleanType>;
}

/**
 * Creates a `Slice.Search` — a typeahead over a slice dimension. Typing drives
 * `state.search`; suggestions come from `slice.matches()` (the bind projects
 * matching rows via the `toMatch` given at `Slice.bind`); selecting one commits
 * it via `slice.setSearch(some(id))`. All built-in.
 *
 * @param slice   - The bound slice (from `Slice.bind`, with a `toMatch` projection)
 * @param options - Optional `recent`
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```ts
 * import { East, some } from "@elaraai/east";
 * import { Reactive, Slice, UIComponentType } from "@elaraai/east-ui";
 *
 * const view = East.function([], UIComponentType, _$ =>
 *     Reactive.Root(East.function([], UIComponentType, $ => {
 *         const slice = $.let(Slice.bind([EventType], "demo.events", cfg, Slice.state(), events, {
 *             toMatch: East.function([EventType], Slice.Types.SearchMatch, ($, r) =>
 *                 East.value({ id: r.sku, label: r.name, meta: some(r.note) }, Slice.Types.SearchMatch)),
 *         }));
 *         return Slice.Search.Root({ slice });
 *     })),
 * );
 * ```
 */
function createSliceSearch(
    options: SliceSearchOptions,
): ExprType<UIComponentType> {
    return East.value(variant("SliceSearch", {
        slice: options.slice,
        recent: options.recent ?? [],
        density: options.density !== undefined ? some(variant(options.density, null)) : none,
        editOpen: options.editOpen !== undefined ? some(options.editOpen) : none,
    }), UIComponentType);
}

/** `Slice.Search` — typeahead over a slice dimension. */
export const SliceSearch = {
    Root: createSliceSearch,
    Types: {
        Search:  SliceSearchType,
        Match:   SliceSearchMatchType,
        Matches: SliceSearchMatchArrayType,
    },
} as const;
