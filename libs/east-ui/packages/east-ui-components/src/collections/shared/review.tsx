/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared review chrome — the renderer half of the review contract
 * (`contracts/review.ts` in `@elaraai/east-ui`), extracted from the Planner's
 * review rendering (PR #76) so every adopter (Planner, Gantt, Table, Roster,
 * Board) composes the same pieces:
 *
 * - {@link useReviewController} — the optimistic per-row decisions state
 *   (the mandatory interactive-state pattern: local `useState`, `useEffect`
 *   re-sync on value change, `queueMicrotask` for the East callbacks).
 * - {@link DecisionButtons} — the per-row Approve / Reject pair (shared
 *   `button` recipe, so it matches the DecisionQueue).
 * - {@link ReviewFoot} — the batch foot on the shared `commitBar` recipe
 *   (Reject all / Rerun / Approve all + the host-composed summary).
 *
 * The decision-column / status-dot geometry lives on the `reviewChrome` slot
 * recipe; adopters resolve it themselves (their layouts differ) and apply
 * their own sticky pinning.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { type OptionType, type ValueTypeOf } from "@elaraai/east";
import { type RowReviewType, type ApprovalStateType, type UIComponentType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";

/** The row-granularity review-config value every adopter's `review` decodes to. */
export type RowReviewValue = ValueTypeOf<RowReviewType>;

/** A rendered UI component value (the decoded `summary`). */
type UIComponentValue = ValueTypeOf<UIComponentType>;

/** A row's optional approval value (the row's `approval` field). */
export type ApprovalOptionValue = ValueTypeOf<OptionType<ApprovalStateType>>;

/** A row's resolved review verdict — drives the Approve/Reject button states. */
export type ApprovalTag = "approved" | "pending" | "rejected";

/** The fixed width of the trailing review decision column. Shared by the
 *  header cell and every per-row cell so the right edge stays aligned. */
export const DECISION_WIDTH = "168px";

/** Seed the local decision map from each row's `approval` (some ⇒ its tag). */
function initialDecisions(approvals: readonly (ApprovalOptionValue | undefined)[]): Record<number, ApprovalTag> {
    const out: Record<number, ApprovalTag> = {};
    approvals.forEach((approval, index) => {
        if (approval === undefined) return;
        const a = getSomeorUndefined(approval);
        if (a !== undefined) out[index] = a.type as ApprovalTag;
    });
    return out;
}

/**
 * Everything an adopter needs to render the review chrome: the optimistic
 * decision map, the per-row / batch handlers, and the extracted config parts.
 */
export interface ReviewController {
    /** The decoded review config. */
    review: RowReviewValue;
    /** The optimistic per-row decisions (row index → verdict tag). */
    decisions: Record<number, ApprovalTag>;
    /** The row's effective verdict (`pending` when undecided). */
    tagFor(rowIndex: number): ApprovalTag;
    /** Approve one row (optimistic + host callback). */
    approveRow(rowIndex: number): void;
    /** Reject one row (optimistic + host callback). */
    rejectRow(rowIndex: number): void;
    /** Approve every row (optimistic sweep + host callback). */
    approveAll(): void;
    /** Reject every row (optimistic sweep + host callback). */
    rejectAll(): void;
    /** Fire the host's re-run hook. */
    rerun(): void;
    /** The host-composed foot summary, when set. */
    summary: UIComponentValue | undefined;
    /** Whether the batch foot has anything to show. */
    showFoot: boolean;
    /** Whether the per-row callbacks / foot verbs are wired. */
    hasApproveAll: boolean;
    hasRejectAll: boolean;
    hasRerun: boolean;
}

/**
 * The optimistic review-decisions state shared by every review adopter.
 *
 * @param review - The decoded `review` config (undefined ⇒ chrome disabled)
 * @param approvals - Per-row `approval` options, in row order (memoise at the call site)
 * @returns The controller, or `undefined` when `review` is absent
 *
 * @remarks
 * Seeds the local decision map from the rows' `approval` fields and re-syncs
 * whenever `approvals` changes identity — memoise it from the component's
 * value (`useMemo(() => value.rows.map(r => r.approval), [value])`) so the
 * reset tracks data changes, not re-renders. Callbacks fire through
 * `queueMicrotask` per the interactive-state pattern.
 */
export function useReviewController(
    review: RowReviewValue | undefined,
    approvals: readonly (ApprovalOptionValue | undefined)[],
): ReviewController | undefined {
    const onApprove = useMemo(() => review && getSomeorUndefined(review.onApprove), [review]);
    const onReject = useMemo(() => review && getSomeorUndefined(review.onReject), [review]);
    const onApproveAll = useMemo(() => review && getSomeorUndefined(review.onApproveAll), [review]);
    const onRejectAll = useMemo(() => review && getSomeorUndefined(review.onRejectAll), [review]);
    const onRerun = useMemo(() => review && getSomeorUndefined(review.onRerun), [review]);
    const summary = useMemo(() => review && getSomeorUndefined(review.summary), [review]);

    // Local decision state — optimistic per-row verdict, seeded from the data and
    // re-synced when the value changes (the mandatory interactive-state pattern).
    const [decisions, setDecisions] = useState<Record<number, ApprovalTag>>(() => initialDecisions(approvals));
    useEffect(() => { setDecisions(initialDecisions(approvals)); }, [approvals]);

    const approveRow = useCallback((rowIndex: number) => {
        setDecisions((prev) => ({ ...prev, [rowIndex]: "approved" }));
        if (onApprove) queueMicrotask(() => onApprove({ rowIndex: BigInt(rowIndex) }));
    }, [onApprove]);
    const rejectRow = useCallback((rowIndex: number) => {
        setDecisions((prev) => ({ ...prev, [rowIndex]: "rejected" }));
        if (onReject) queueMicrotask(() => onReject({ rowIndex: BigInt(rowIndex) }));
    }, [onReject]);
    // Batch verdicts sweep every reviewable row to one tag for instant feedback,
    // then fire the host hook once.
    const approveAll = useCallback(() => {
        setDecisions(() => { const out: Record<number, ApprovalTag> = {}; approvals.forEach((_a, i) => { out[i] = "approved"; }); return out; });
        if (onApproveAll) queueMicrotask(() => onApproveAll());
    }, [onApproveAll, approvals]);
    const rejectAll = useCallback(() => {
        setDecisions(() => { const out: Record<number, ApprovalTag> = {}; approvals.forEach((_a, i) => { out[i] = "rejected"; }); return out; });
        if (onRejectAll) queueMicrotask(() => onRejectAll());
    }, [onRejectAll, approvals]);
    const rerun = useCallback(() => {
        if (onRerun) queueMicrotask(() => onRerun());
    }, [onRerun]);

    const tagFor = useCallback((rowIndex: number): ApprovalTag => decisions[rowIndex] ?? "pending", [decisions]);

    return useMemo(() => {
        if (review === undefined) return undefined;
        return {
            review,
            decisions,
            tagFor,
            approveRow,
            rejectRow,
            approveAll,
            rejectAll,
            rerun,
            summary,
            showFoot: summary !== undefined || onApproveAll !== undefined || onRejectAll !== undefined || onRerun !== undefined,
            hasApproveAll: onApproveAll !== undefined,
            hasRejectAll: onRejectAll !== undefined,
            hasRerun: onRerun !== undefined,
        };
    }, [review, decisions, tagFor, approveRow, rejectRow, approveAll, rejectAll, rerun, summary, onApproveAll, onRejectAll, onRerun]);
}

/**
 * The per-row Approve / Reject pair (styled by the shared `button` recipe so
 * it matches the DecisionQueue). The active side tracks the verdict:
 * approved ⇒ Approve fills (solid brand); rejected ⇒ Reject becomes the
 * danger call; pending ⇒ neither is pre-selected (Approve is a plain outline).
 */
export function DecisionButtons({ rowIndex, controller }: {
    /** The row the pair acts on. */
    rowIndex: number;
    /** The surface's review controller. */
    controller: ReviewController;
}) {
    const buttonRecipe = useRecipe({ key: "button" });
    const tag = controller.tagFor(rowIndex);
    const approveVariant = tag === "approved" ? "solid" : tag === "rejected" ? "ghost" : "outline";
    const rejectVariant = tag === "rejected" ? "danger" : "ghost";
    return (
        <>
            <Box as="button" css={buttonRecipe({ variant: approveVariant, size: "xs" })}
                aria-pressed={tag === "approved"}
                onClick={(e) => { e.stopPropagation(); controller.approveRow(rowIndex); }}>
                Approve
            </Box>
            <Box as="button" css={buttonRecipe({ variant: rejectVariant, size: "xs" })}
                aria-pressed={tag === "rejected"}
                onClick={(e) => { e.stopPropagation(); controller.rejectRow(rowIndex); }}>
                Reject
            </Box>
        </>
    );
}

/**
 * The batch review foot on the shared `commitBar` recipe (the same block the
 * Diff + DecisionQueue commit bars use), mounted outside any scrolling grid
 * so it stays full-width under the surface. The summary is the host-composed
 * `review.summary` component; the buttons are Reject all / Rerun / Approve
 * all (left→right). Renders `null` when the foot has nothing to show.
 */
export function ReviewFoot({ controller, storageKey }: {
    /** The surface's review controller. */
    controller: ReviewController;
    /** Storage key prefix for the summary component subtree. */
    storageKey: string;
}) {
    const commitRecipe = useSlotRecipe({ key: "commitBar" });
    const cs = useMemo(() => commitRecipe({}) as unknown as Record<string, Record<string, unknown>>, [commitRecipe]);
    if (!controller.showFoot) return null;
    return (
        <Box css={cs.root} data-slot="reviewFoot">
            <Box css={cs.draft}>
                {controller.summary !== undefined && (
                    <EastChakraComponent value={controller.summary} storageKey={`${storageKey}.review.summary`} />
                )}
            </Box>
            <Box css={cs.btnRow}>
                {controller.hasRejectAll && (
                    <Box as="button" css={cs.btnDanger} onClick={controller.rejectAll}>Reject all</Box>
                )}
                {controller.hasRerun && (
                    <Box as="button" css={cs.btn} onClick={controller.rerun}>{controller.review.rerunLabel}</Box>
                )}
                {controller.hasApproveAll && (
                    <Box as="button" css={cs.btnPrimary} onClick={controller.approveAll}>Approve all</Box>
                )}
            </Box>
        </Box>
    );
}
