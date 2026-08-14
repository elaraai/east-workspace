/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Approval vocabulary + review-config type builder — the `UIComponentType`-free
 * core of the shared review contract (`contracts/review.ts`).
 *
 * Split out of `review.ts` so IR type modules that `component.ts` loads (e.g.
 * `collections/plan/types.ts`) can reach {@link ApprovalStateType} /
 * {@link reviewType} without a circular import: `review.ts` itself must import
 * `component.ts` (its `RowReviewType` is resolved at `UIComponentType`), so it
 * cannot be loaded from inside the `component.ts` module graph. Everything here
 * is re-exported from `review.ts`, which remains the canonical import path for
 * host code.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

// ============================================================================
// Approval vocabulary
// ============================================================================

/**
 * A review subject's approval state — the reviewer's verdict, distinct from
 * the event-level audit lifecycle (`EventStateType` / `PlannerStateType`).
 *
 * @remarks
 * `approved` rests pre-approved (a clean line's resting state — its Approve
 * button renders as the active state); `pending` awaits an explicit call (a
 * flagged line); `rejected` is an explicit decline. Authors usually derive it
 * in East — see `deriveApproval` (`contracts/review.ts`) for the canonical
 * "clean ⇒ approved, flagged ⇒ pending" rule.
 *
 * The same three words appear in e3-ui's DecisionQueue at *case* granularity
 * (`Verdict`); this variant is the in-surface (row / batch) resolution.
 *
 * @property approved - Pre-approved / accepted (the resting state for a clean subject)
 * @property pending - Undecided — awaits an explicit Approve / Reject
 * @property rejected - Explicitly declined
 */
export const ApprovalStateType = VariantType({
    /** Pre-approved / accepted (the resting state for a clean subject). */
    approved: NullType,
    /** Undecided — awaits an explicit Approve / Reject. */
    pending: NullType,
    /** Explicitly declined. */
    rejected: NullType,
});

/**
 * Type representing approval state values.
 */
export type ApprovalStateType = typeof ApprovalStateType;

/**
 * String literal form of {@link ApprovalStateType} tags.
 */
export type ApprovalStateLiteral = "approved" | "pending" | "rejected";

/**
 * The row-subject reference — the payload of per-row review callbacks on the
 * row-granularity adopters (Planner, Gantt, Table, Roster).
 *
 * @remarks
 * `rowIndex` addresses the row in the surface's **unsliced** row order (the
 * same convention as row-selection events), so hosts map it straight back to
 * their source data. Tile-granularity acceptance keeps its own subject — the
 * drag contract's `CellRefType` — documented as the *item*-level sibling of
 * this row-level ref.
 *
 * @property rowIndex - The acted-on row's index (0-based, unsliced order)
 */
export const RowRefType = StructType({
    /** The acted-on row's index (0-based, unsliced order) */
    rowIndex: IntegerType,
});

/**
 * Type representing row-subject reference values.
 */
export type RowRefType = typeof RowRefType;

// ============================================================================
// Review-config East type builder
// ============================================================================

/**
 * The review-config struct shape for a subject-ref type `S` and a UI
 * component type `C` — see {@link reviewType}.
 */
export type ReviewStructType<S extends EastType, C extends EastType> = StructType<{
    columnLabel: StringType,
    summary: OptionType<C>,
    onApprove: OptionType<FunctionType<[S], NullType>>,
    onReject: OptionType<FunctionType<[S], NullType>>,
    onApproveAll: OptionType<FunctionType<[], NullType>>,
    onRejectAll: OptionType<FunctionType<[], NullType>>,
    onRerun: OptionType<FunctionType<[], NullType>>,
    rerunLabel: StringType,
}>;

/**
 * Builds the review-config East type for a given subject-ref type — the
 * honest per-component variability of the shared contract.
 *
 * @param subjectRefType - The per-subject callback payload type (e.g. {@link RowRefType} for row-granularity surfaces)
 * @param componentType - The UI component type for the `summary` field — always the resolved `UIComponentType`
 * @returns The review-config `StructType` for that subject
 *
 * @remarks
 * Every adopter's `review` field is `OptionType(reviewType(...))` with the
 * same fixed fields — only the subject varies: Planner / Gantt / Table /
 * Roster review rows (`{ rowIndex }`), the Plan canvas reviews keyed rows
 * (`{ key }`), while per-tile ghost-accept stays on the drag contract's
 * `CellRefType`. `componentType` is injected (rather than imported) so this
 * module stays importable from inside the `component.ts` module graph; a root
 * spelled inline in `component.ts` writes the same review struct as a literal
 * with the recursion `node` — never by calling this builder with the marker
 * (type-computing functions must not receive a `RecursiveType` node).
 *
 * Semantics of the fields (identical across adopters):
 * - `columnLabel` — the decision-column header (builders default `"Decision"`).
 * - `summary` — optional host-composed foot eyebrow (a `UIComponentType`).
 * - `onApprove` / `onReject` — per-subject calls, receiving the subject ref.
 * - `onApproveAll` / `onRejectAll` — batch foot verbs.
 * - `onRerun` — optional re-run verb (absent ⇒ no Rerun button);
 *   `rerunLabel` its label (builders default `"Rerun"`).
 */
export function reviewType<S extends EastType, C extends EastType>(
    subjectRefType: S,
    componentType: C,
): ReviewStructType<S, C> {
    return StructType({
        columnLabel:  StringType,
        summary:      OptionType(componentType),
        onApprove:    OptionType(FunctionType([subjectRefType], NullType)),
        onReject:     OptionType(FunctionType([subjectRefType], NullType)),
        onApproveAll: OptionType(FunctionType([], NullType)),
        onRejectAll:  OptionType(FunctionType([], NullType)),
        onRerun:      OptionType(FunctionType([], NullType)),
        rerunLabel:   StringType,
    });
}
