/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { East, NullType, variant, VariantType, type ExprType } from "@elaraai/east";

// ============================================================================
// State Value — seven-state contract
// ============================================================================

/**
 * State value variant type — the seven-state vocabulary every Card-backed
 * primitive and pattern accepts.
 *
 * @remarks
 * Create instances using the {@link StateValue} function. Consumers (Card
 * §1.8 and every Card-based pattern) switch on this value to render the
 * documented fallback surface:
 *
 * | State | Default fallback |
 * |---|---|
 * | `ready` | render the content normally |
 * | `loading` | `Skeleton` sized to the content shape |
 * | `empty` | `EmptyState` with default title / description |
 * | `stale` | content at `opacity: 0.6` + `StaleDataBanner` overlay |
 * | `error` | `ComputeError` surface |
 * | `disabled` | content with `aria-disabled="true"` + `opacity: 0.5` |
 * | `permission-denied` | `AccessDeniedState` surface |
 *
 * Deviations from the default rendering are documented per pattern (inline
 * `**States deviation:** …` notes in each pattern plan).
 *
 * This type is a cross-cutting *contract*, not a style token — it lives in
 * `src/contracts/` and is re-exported from `contracts/index.ts`. It is
 * **not** registered under the `Style` namespace.
 *
 * @property ready - Content available; render normally
 * @property loading - Data in flight; show skeleton
 * @property empty - No data to show; render `EmptyState`
 * @property stale - Data older than freshness threshold; overlay `StaleDataBanner`
 * @property error - Compute / fetch failed; render `ComputeError`
 * @property disabled - Interactive but intentionally inert
 * @property permission-denied - User cannot view this content; render `AccessDeniedState`
 */
export const StateValueType = VariantType({
    ready: NullType,
    loading: NullType,
    empty: NullType,
    stale: NullType,
    error: NullType,
    disabled: NullType,
    "permission-denied": NullType,
});

/**
 * Type representing state value variant values.
 */
export type StateValueType = typeof StateValueType;

/**
 * String literal type for state values.
 */
export type StateValueLiteral =
    | "ready" | "loading" | "empty" | "stale"
    | "error" | "disabled" | "permission-denied";

/**
 * Creates a state value variant expression.
 *
 * @param state - The state value
 * @returns An East expression representing the state value
 *
 * @example
 * ```ts
 * import { StateValue } from "@elaraai/east-ui/contracts";
 *
 * // Static state
 * const loading = StateValue("loading");
 *
 * // Conditional state
 * const state = hasError.ifElse(
 *     StateValue("error"),
 *     isLoading.ifElse(StateValue("loading"), StateValue("ready")),
 * );
 * ```
 */
export function StateValue(state: StateValueLiteral): ExprType<StateValueType> {
    return East.value(variant(state, null), StateValueType);
}
