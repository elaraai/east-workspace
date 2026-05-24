/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { StringType, StructType, ArrayType, OptionType, BooleanType } from "@elaraai/east";
import { SliceBindType, SliceDensityType } from "../../platform/slice/index.js";

export { SliceSearchMatchType, SliceSearchMatchArrayType } from "../../platform/slice/index.js";

/**
 * `Slice.Search` data — typeahead over a slice dimension.
 *
 * Suggestions come from `slice.matches()` (the bind projects matching rows via
 * the `toMatch` supplied at `Slice.bind`); typing drives `state.search` and
 * selecting a match commits it via `slice.setSearch(some(id))` — all built-in.
 *
 * @property slice  - Bound slice; the input drives `state.search`, `matches()`
 *                    supplies suggestions, and committing sets the query to the id.
 * @property recent - Recent queries shown in the footer.
 */
export const SliceSearchType = StructType({
    slice:   SliceBindType,
    recent:  ArrayType(StringType),
    density: OptionType(SliceDensityType),
    editOpen: OptionType(BooleanType),
});
export type SliceSearchType = typeof SliceSearchType;
