/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Review / approval grammar — the shared contract for decision surfaces.
 *
 * Lifted from the Planner's review chrome (PR #76) so every grid surface
 * (Planner, Gantt, Table, Roster, Board) speaks one approval vocabulary and
 * wears identical chrome: a per-subject Approve / Reject **decision column**
 * plus a batch **`commitBar` foot** (Approve all / Reject all / Rerun).
 *
 * The vocabulary is deliberately two-axis:
 *
 * - **Event lifecycle** (`PlannerStateType`: committed / proposed / rejected)
 *   is what happened to a scheduled event — the audit trail.
 * - **Approval state** ({@link ApprovalStateType}: approved / pending /
 *   rejected) is the *reviewer's* verdict on a subject (usually a row) — the
 *   sign-off.
 *
 * A model writes `proposed(model)` events; the affected row rests `pending`;
 * an operator's Approve resolves the row to `approved`. Related, coarser /
 * finer granularities stay distinct on purpose: per-tile ghost-accept
 * (`onAccept(CellRef)` on the drag contract) resolves ONE proposed event,
 * and e3-ui's DecisionQueue `Verdict` resolves a *case*; this contract is the
 * row/batch granularity between them.
 *
 * @packageDocumentation
 */

import {
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    BooleanType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    none,
    some,
    variant,
} from "@elaraai/east";
import { UIComponentType } from "../component.js";

// ============================================================================
// Approval vocabulary
// ============================================================================

/**
 * A review subject's approval state — the reviewer's verdict, distinct from
 * the event-level audit lifecycle (`PlannerStateType`).
 *
 * @remarks
 * `approved` rests pre-approved (a clean line's resting state — its Approve
 * button renders as the active state); `pending` awaits an explicit call (a
 * flagged line); `rejected` is an explicit decline. Authors usually derive it
 * in East — see {@link deriveApproval} for the canonical "clean ⇒ approved,
 * flagged ⇒ pending" rule.
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
 * @param componentType - The UI component type for the `summary` field — pass `UIComponentType` (or the recursion `node` when spelling a root inline in `component.ts`)
 * @returns The review-config `StructType` for that subject
 *
 * @remarks
 * Every adopter's `review` field is `OptionType(reviewType(...))` with the
 * same fixed fields — only the subject varies: Planner / Gantt / Table /
 * Roster review rows (`{ rowIndex }`), while per-tile ghost-accept stays on
 * the drag contract's `CellRefType`. `componentType` is injected (rather than
 * imported) so `component.ts` can spell the same shape inside its
 * `RecursiveType` using the recursion `node`; every other caller passes the
 * resolved `UIComponentType`.
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

/**
 * The resolved row-granularity review-config type — `reviewType(RowRefType,
 * UIComponentType)`. The concrete type Planner / Gantt / Table / Roster carry
 * (and the one renderers decode).
 */
export const RowReviewType: ReviewStructType<RowRefType, UIComponentType> = reviewType(RowRefType, UIComponentType);

/**
 * Type representing row-granularity review-config values.
 */
export type RowReviewType = typeof RowReviewType;

// ============================================================================
// TS authoring surface — ReviewConfig + buildReview + deriveApproval
// ============================================================================

/**
 * Flat TS input for a surface's `review` option — opt-in per-subject approval
 * plus the batch foot.
 *
 * @typeParam S - The subject-ref East type the per-subject callbacks receive
 * @property columnLabel - The decision-column header (default `"Decision"`)
 * @property summary - Optional foot eyebrow (host-composed UI component)
 * @property onApprove - Optional per-subject Approve callback (receives the subject ref)
 * @property onReject - Optional per-subject Reject callback (receives the subject ref)
 * @property onApproveAll - Optional batch Approve-all callback
 * @property onRejectAll - Optional batch Reject-all callback
 * @property onRerun - Optional Rerun callback (absent ⇒ no Rerun button)
 * @property rerunLabel - The Rerun button label (default `"Rerun"`)
 */
export interface ReviewConfig<S extends EastType = RowRefType> {
    /** The decision-column header (default `"Decision"`). */
    columnLabel?: SubtypeExprOrValue<StringType> | string;
    /** Optional foot eyebrow (host-composed UI component). */
    summary?: SubtypeExprOrValue<UIComponentType>;
    /** Optional per-subject Approve callback (receives the subject ref). */
    onApprove?: SubtypeExprOrValue<FunctionType<[S], NullType>>;
    /** Optional per-subject Reject callback (receives the subject ref). */
    onReject?: SubtypeExprOrValue<FunctionType<[S], NullType>>;
    /** Optional batch Approve-all callback. */
    onApproveAll?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Optional batch Reject-all callback. */
    onRejectAll?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Optional Rerun callback (absent ⇒ no Rerun button). */
    onRerun?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** The Rerun button label (default `"Rerun"`). */
    rerunLabel?: SubtypeExprOrValue<StringType> | string;
}

/**
 * Resolves a {@link ReviewConfig} into a review-config value, defaulting the
 * column / rerun labels (`"Decision"` / `"Rerun"`).
 *
 * @param config - The flat review configuration
 * @param type - The adopter's resolved review-config type (e.g. {@link RowReviewType})
 * @returns An East expression of `type`
 *
 * @remarks
 * The shared factory every adopter's root builder delegates to, so the
 * normalisation (and its defaults) is defined once. Pass the surface's own
 * review type — `reviewType(subject, UIComponentType)` — so the callbacks are
 * checked against the right subject ref.
 */
export function buildReview<S extends EastType>(
    config: ReviewConfig<S>,
    type: ReviewStructType<S, UIComponentType>,
): ExprType<ReviewStructType<S, UIComponentType>> {
    return East.value({
        columnLabel:  config.columnLabel ?? "Decision",
        summary:      config.summary !== undefined ? some(config.summary) : none,
        onApprove:    config.onApprove !== undefined ? some(config.onApprove) : none,
        onReject:     config.onReject !== undefined ? some(config.onReject) : none,
        onApproveAll: config.onApproveAll !== undefined ? some(config.onApproveAll) : none,
        onRejectAll:  config.onRejectAll !== undefined ? some(config.onRejectAll) : none,
        onRerun:      config.onRerun !== undefined ? some(config.onRerun) : none,
        rerunLabel:   config.rerunLabel ?? "Rerun",
    }, type);
}

/**
 * The canonical "clean ⇒ approved, flagged ⇒ pending" approval derivation.
 *
 * @param flagged - Whether the subject is flagged for an explicit call
 * @returns `some(pending)` when flagged, `some(approved)` otherwise
 *
 * @remarks
 * The resting-state rule every review surface documents: clean subjects rest
 * pre-approved (no dot, Approve active), flagged subjects await an explicit
 * Approve / Reject. Use as the `approval` accessor —
 * `approval: r => deriveApproval(r.flagged)` — and pair it with a `status`
 * dot on the flagged rows.
 */
export function deriveApproval(
    flagged: SubtypeExprOrValue<BooleanType>,
): ExprType<OptionType<ApprovalStateType>> {
    return East.value(flagged, BooleanType).ifElse(
        () => East.value(some(variant("pending", null)), OptionType(ApprovalStateType)),
        () => East.value(some(variant("approved", null)), OptionType(ApprovalStateType)),
    );
}
