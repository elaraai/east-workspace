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
 * `Slice.Frame.Root(slice, body, { affordances: [...] })`. The renderer mounts
 * the matching `Slice.*` component in compact density and places it by kind:
 *
 * | Affordance | Zone | Compact form |
 * |---|---|---|
 * | `filter` | left (flexes, compress ladder) | brand-tint clause pills + `+ filter` |
 * | `breakdown` | left | `Split by` + active dimension chips + `+ dimension` |
 * | `cohort` | left | saved-segment pills |
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
 * @property cohort - Saved-segment pills (left zone)
 */
export const SliceAffordanceType = VariantType({
    filter: NullType,
    search: NullType,
    breakdown: NullType,
    range: NullType,
    cohort: NullType,
});

/** Type representing slice affordance variant values. */
export type SliceAffordanceType = typeof SliceAffordanceType;

/** String literal type for slice affordances. */
export type SliceAffordanceLiteral = "filter" | "search" | "breakdown" | "range" | "cohort";

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
 * Slice.Frame.Root(slice, body, { affordances: [SliceAffordance("filter"), SliceAffordance("search")] });
 * // or, equivalently, the string shorthand:
 * Slice.Frame.Root(slice, body, { affordances: ["filter", "search"] });
 * ```
 */
export function SliceAffordance(affordance: SliceAffordanceLiteral): ExprType<SliceAffordanceType> {
    return East.value(variant(affordance, null), SliceAffordanceType);
}
