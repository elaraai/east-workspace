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

// ============================================================================
// Event lifecycle — estimated → proposed → confirmed → in-progress → actual
// ============================================================================

/**
 * The sub-flavour of a `proposed` event. It rides inside the `proposed` arm of
 * {@link EventStateType}, so it is only representable while proposed — a
 * confirmed or actual event can never carry a flavour.
 *
 * @remarks
 * Consumer code passes string literals (`"added"`, `"recommended"`,
 * `"removed"`) to the owning component's event builder rather than
 * constructing this variant directly. The flavour records *provenance and
 * intent*: `added` is an operator's own proposal, `recommended` is the
 * optimiser's recommendation, and `removed` proposes deleting an existing
 * scheduled event (rendered struck through until the call is made).
 *
 * @property added - An operator proposal
 * @property recommended - The optimiser's recommendation
 * @property removed - A proposed deletion of an existing event (struck through)
 */
export const EventFlavourType = VariantType({
    added:       NullType,
    recommended: NullType,
    removed:     NullType,
});
export type EventFlavourType = typeof EventFlavourType;

/**
 * The event lifecycle — the audit vocabulary every scheduled-event surface
 * speaks: `estimated → proposed → confirmed → in-progress → actual`, with
 * `rejected` the terminal decline.
 *
 * @remarks
 * The certainty ladder, lowest first:
 *
 * | State | Meaning | Canonical rendering |
 * |---|---|---|
 * | `estimated` | a forecast — nothing has been put forward | ghost (faint dashed, muted italic) |
 * | `proposed` | awaiting a call; the flavour (see {@link EventFlavourType}) carries provenance | dashed brand outline, italic |
 * | `confirmed` | accepted into the plan | solid brand outline |
 * | `in-progress` | executing now (typically straddling the now-line) | solid observed fill |
 * | `actual` | happened — observed truth, audit-locked | solid observed fill |
 * | `rejected` | declined; kept for diff context | greyed dashed |
 *
 * Consumer code passes string literals to event builders — `"estimated"`,
 * `"added"`, `"recommended"`, `"removed"`, `"confirmed"`, `"in-progress"`,
 * `"actual"`, or `"rejected"` — and the builder maps them to the appropriate
 * (possibly nested) variant. `proposed` is never written directly; use the
 * flavour shorthands instead. `rejected` events are kept in the IR so diff
 * views can show what was declined without re-fetching history.
 * `in-progress` is declared, not derived — a confirmed run past its start is
 * *late*, not in progress; only the host knows which.
 *
 * Distinct on purpose from the *reviewer's* verdict on a subject
 * (`ApprovalStateType` in `contracts/review.ts`): the optimiser writes
 * `proposed(recommended)` events, the affected row rests `pending`, and an
 * operator's Approve resolves the row's proposals to `confirmed`.
 *
 * @property estimated - A forecast; lowest certainty
 * @property proposed - Put forward, awaiting a call; the flavour (see {@link EventFlavourType}) is nested
 * @property confirmed - Accepted into the plan
 * @property in-progress - Executing now
 * @property actual - Observed truth; audit-locked
 * @property rejected - Reviewed and declined; kept for diff
 */
export const EventStateType = VariantType({
    estimated:     NullType,
    proposed:      EventFlavourType,
    confirmed:     NullType,
    "in-progress": NullType,
    actual:        NullType,
    rejected:      NullType,
});
export type EventStateType = typeof EventStateType;

/** String-literal shorthand accepted by event builders for {@link EventStateType}. */
export type EventStateLiteral =
    | "estimated" | "added" | "recommended" | "removed"
    | "confirmed" | "in-progress" | "actual" | "rejected";
