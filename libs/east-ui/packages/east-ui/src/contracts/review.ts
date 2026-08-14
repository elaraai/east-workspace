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
    NullType,
    OptionType,
    StringType,
    variant,
    none,
    some,
} from "@elaraai/east";
import { UIComponentType } from "../component.js";
import {
    ApprovalStateType,
    RowRefType,
    reviewType,
    type ReviewStructType,
} from "./approval.js";

// ============================================================================
// Approval vocabulary + type builder — canonical definitions in
// `contracts/approval.ts` (the `UIComponentType`-free leaf, importable from
// inside the `component.ts` module graph); re-exported here so this module
// stays the canonical import path for host code.
// ============================================================================

export {
    ApprovalStateType, type ApprovalStateLiteral,
    RowRefType,
    reviewType, type ReviewStructType,
} from "./approval.js";

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
