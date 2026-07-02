/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, variant, VariantType, type ExprType } from "@elaraai/east";

// ============================================================================
// Slice affordance — the eyebrow affordance vocabulary
// ============================================================================

/**
 * Slice affordance variant type — the affordances a `Slice.Frame` can mount in
 * its eyebrow.
 *
 * @remarks
 * The developer lists which affordances appear (and in what order) via
 * `Slice.Frame.Root(body, { slice, affordances: [...] })`. The renderer mounts
 * the matching `Slice.*` component in compact density and places it by kind:
 *
 * | Affordance | Zone | Compact form |
 * |---|---|---|
 * | `filter` | left (flexes, compress ladder) | brand-tint clause pills + `+ filter` |
 * | `breakdown` | left | `Split by` + active dimension chips + `+ dimension` |
 * | `cohort` | left | toggleable saved-segment pills + authoring |
 * | `presets` | left | curated toggle-only preset pills (`Slice.Cohort` in `toggle` mode) |
 * | `search` | right (fixed) | closed `.search` pill that opens the dropdown |
 * | `range` | right | single date-window pill |
 *
 * A cross-cutting *contract*, not a style token — it lives in `src/contracts/`
 * alongside `StateValueType`.
 *
 * @property filter - Faceted predicate chips (left zone)
 * @property search - Typeahead pill (right zone)
 * @property breakdown - Split-by-dimension chips (left zone)
 * @property range - Time-range pill (right zone)
 * @property cohort - Toggleable saved-segment pills with authoring (left zone)
 * @property presets - Curated toggle-only preset pills — no authoring (#163; left zone)
 * @property brush - Drag-a-window gesture writing the slice's range. Hosts
 *   render it natively: a Chart brushes the plot's continuous x, a Gantt the
 *   timeline, a standalone `Slice.Rail` the mini brush strip. Hosts with no
 *   continuous axis reject it at the factory.
 */
export const SliceAffordanceType = VariantType({
    filter: NullType,
    search: NullType,
    breakdown: NullType,
    range: NullType,
    cohort: NullType,
    brush: NullType,
    presets: NullType,
});

/** Type representing slice affordance variant values. */
export type SliceAffordanceType = typeof SliceAffordanceType;

/** String literal type for slice affordances. */
export type SliceAffordanceLiteral = "filter" | "search" | "breakdown" | "range" | "cohort" | "brush" | "presets";

/**
 * Creates a slice affordance variant expression.
 *
 * @param affordance - The affordance kind
 * @returns An East expression representing the affordance
 *
 * @example
 * ```ts
 * import { SliceAffordance } from "@elaraai/east-ui/contracts";
 *
 * Slice.Frame.Root(body, { slice, affordances: [SliceAffordance("filter"), SliceAffordance("search")] });
 * // or, equivalently, the string shorthand:
 * Slice.Frame.Root(body, { slice, affordances: ["filter", "search"] });
 * ```
 */
export function SliceAffordance(affordance: SliceAffordanceLiteral): ExprType<SliceAffordanceType> {
    return East.value(variant(affordance, null), SliceAffordanceType);
}
