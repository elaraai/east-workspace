/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared **plot gutter** primitive (#147).
 *
 * A horizontal inset `{ left, right }` for axis/lane components (Chart, Trace,
 * Calendar, Matrix, Table, Planner, Gantt) so their data lanes occupy exactly
 * `[left, W − right]` and line up on a common x when stacked. All chrome (axes,
 * frozen label columns, week/row headers) renders **within** the gutter.
 *
 * `<AlignedStack>` imposes one gutter on its children via the
 * `PlotGutterProvider` context (renderer side); a per-component `plotGutter`
 * prop overrides the inherited value (own-prop-over-context, like density).
 *
 * **px-only for cross-component alignment.** `StringType` admits any CSS length,
 * but pixel-exact alignment only holds if all gutters resolve to the same px
 * (Chart margins are numeric px). Use px values for `fixed`; `auto` is measured
 * and therefore inherently px.
 *
 * @packageDocumentation
 */

import {
    type SubtypeExprOrValue,
    OptionType,
    StringType,
    StructType,
    VariantType,
    NullType,
} from "@elaraai/east";

/**
 * The per-component plot-gutter value — a `{ left, right }` horizontal inset.
 * Both sides optional so a caller can pin just one edge.
 *
 * @property left  - Left inset (CSS length, px recommended); the lane starts here
 * @property right - Right inset (CSS length, px recommended); the lane ends at `W − right`
 */
export const PlotGutterType = StructType({
    left:  OptionType(StringType),
    right: OptionType(StringType),
});
export type PlotGutterType = typeof PlotGutterType;

/**
 * TS input for {@link PlotGutterType} — `{ left?, right? }` CSS lengths.
 *
 * @property left  - Left inset (px recommended for cross-component alignment)
 * @property right - Right inset (px recommended for cross-component alignment)
 */
export interface PlotGutter {
    /** Left inset (CSS length, px recommended); the data lane starts here. */
    left?: SubtypeExprOrValue<StringType>;
    /** Right inset (CSS length, px recommended); the data lane ends at `W − right`. */
    right?: SubtypeExprOrValue<StringType>;
}

/**
 * The `<AlignedStack>` gutter mode — either an explicit `fixed` {@link PlotGutterType}
 * imposed on every child, or `auto` (measure the max gutter the children need and
 * impose that).
 *
 * @property auto  - Measure each child's natural gutter, impose the max on all
 * @property fixed - Impose this explicit `{ left, right }` on every child
 */
export const AlignedGutterType = VariantType({
    auto:  NullType,
    fixed: PlotGutterType,
});
export type AlignedGutterType = typeof AlignedGutterType;
