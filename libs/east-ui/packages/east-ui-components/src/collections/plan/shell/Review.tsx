/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's review chrome — actions only (#569).
 *
 * Two things make this different from the shared `useReviewController` the
 * other adopters use, and both follow from what a Plan is.
 *
 * **Subjects are KEYS, not indices.** `PlanReviewType = reviewType(PlanRowRefType, …)`
 * declares `{ key }`, and the shared controller fires `{ rowIndex }` — they
 * simply do not fit. Keys are also the only thing that survives paging: a
 * window landing above a decided row shifts every index beneath it (#577), so
 * an index-keyed verdict would quietly reattach to a different job.
 *
 * **The canvas holds NO copy of the verdict.** The shared controller keeps an
 * optimistic `Record<rowIndex, ApprovalTag>` in React state; this does not.
 * The reason is not tidiness — a local copy is a second source of truth that
 * can disagree with the data, and will: it keeps showing `approved` after the
 * write it triggered has failed and rolled back. It is also unnecessary, since
 * the data layer is already optimistic — a direct `Data.bind` write lands in
 * the cache synchronously and notifies before the server confirms
 * (`e3-ui-components/src/platform/dataset-store.ts`), and `mode: "staged"`
 * buffers locally when the author wants a review-then-commit flow.
 *
 * So a verdict lives wherever the author's `onApprove` puts it, comes back
 * through their own `data`, and reaches the canvas as `row.approval` — which
 * seeds these buttons and NOTHING else. How a decided row *looks* is the
 * author's business, derived through the accessors that already exist: a run's
 * `state` for bar colour, `status` for a dot, `decisions` for a diamond. The
 * diamond is one presentation among those, not the privileged one.
 *
 * Consequence worth stating plainly: with no callback wired, or one that
 * writes nowhere, clicking Approve changes nothing. That is honest — nothing
 * recorded the verdict — and it is a deliberate exception to the renderer rule
 * about widgets going inert without a bound callback, which is aimed at form
 * controls whose value IS their own state. A verdict is a fact about the row.
 */

import { useCallback, useMemo } from "react";
import { Box, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../../utils.js";
import type { ReviewFootModel } from "../../shared/review.js";
import type { PlanRowValue } from "../model.js";

type Styles = Record<string, Record<string, unknown>>;

/** The decoded `review` config a Plan carries. */
export type PlanReviewValue = ValueTypeOf<typeof Plan.Types.Review>;

/** The fixed width of the trailing decision column — the shared review
 *  module's one constant, re-exported rather than re-declared (#617). */
export { DECISION_WIDTH } from "../../shared/review.js";

/** A row's resolved verdict. `pending` when the data says nothing. */
export type ApprovalTag = "approved" | "pending" | "rejected";

/** The per-row half of the Plan's review chrome. */
export interface PlanReview extends ReviewFootModel {
    /** The decision-column header label. */
    columnLabel: string;
    /** Whether per-row Approve / Reject are wired at all. */
    hasRowVerbs: boolean;
    /** Approve one row, BY KEY. */
    approveRow(key: string): void;
    /** Reject one row, BY KEY. */
    rejectRow(key: string): void;
}

/** A row's verdict, read from the data — never from renderer state. */
export function tagOf(row: PlanRowValue): ApprovalTag {
    const a = getSomeorUndefined(row.approval);
    return a === undefined ? "pending" : (a.type as ApprovalTag);
}

/**
 * Wire the root's `review` config to key-addressed callbacks.
 *
 * @param review - The decoded `review` option (`undefined` ⇒ chrome off)
 * @returns The review model, or `undefined` when `review` is absent
 */
export function usePlanReview(review: PlanReviewValue | undefined): PlanReview | undefined {
    const onApprove = useMemo(() => review && getSomeorUndefined(review.onApprove), [review]);
    const onReject = useMemo(() => review && getSomeorUndefined(review.onReject), [review]);
    const onApproveAll = useMemo(() => review && getSomeorUndefined(review.onApproveAll), [review]);
    const onRejectAll = useMemo(() => review && getSomeorUndefined(review.onRejectAll), [review]);
    const onRerun = useMemo(() => review && getSomeorUndefined(review.onRerun), [review]);
    const summary = useMemo(() => review && getSomeorUndefined(review.summary), [review]);

    // `queueMicrotask` per the interactive-state pattern: the East callback
    // runs after commit, so a handler that writes cannot re-enter this render.
    const approveRow = useCallback((key: string) => {
        if (onApprove) queueMicrotask(() => onApprove({ key }));
    }, [onApprove]);
    const rejectRow = useCallback((key: string) => {
        if (onReject) queueMicrotask(() => onReject({ key }));
    }, [onReject]);
    const approveAll = useCallback(() => {
        if (onApproveAll) queueMicrotask(() => onApproveAll());
    }, [onApproveAll]);
    const rejectAll = useCallback(() => {
        if (onRejectAll) queueMicrotask(() => onRejectAll());
    }, [onRejectAll]);
    const rerun = useCallback(() => {
        if (onRerun) queueMicrotask(() => onRerun());
    }, [onRerun]);

    return useMemo(() => {
        if (review === undefined) return undefined;
        return {
            columnLabel: review.columnLabel,
            hasRowVerbs: onApprove !== undefined || onReject !== undefined,
            approveRow,
            rejectRow,
            summary,
            rerunLabel: review.rerunLabel,
            showFoot: summary !== undefined || onApproveAll !== undefined
                || onRejectAll !== undefined || onRerun !== undefined,
            hasApproveAll: onApproveAll !== undefined,
            hasRejectAll: onRejectAll !== undefined,
            hasRerun: onRerun !== undefined,
            approveAll,
            rejectAll,
            rerun,
        };
    }, [review, onApprove, onReject, summary, onApproveAll, onRejectAll, onRerun,
        approveRow, rejectRow, approveAll, rejectAll, rerun]);
}

/**
 * One row's Approve / Reject pair, in the trailing decision cell.
 *
 * The pressed look comes from `tag` — i.e. from the row's data — so the
 * buttons and the rest of the canvas cannot disagree about a verdict.
 *
 * Both buttons resolve from the shared **`button`** recipe, the same one
 * `ReviewFoot` now uses for Approve all / Reject all / Rerun. That is the
 * point: the spec gives a row's Approve and the foot's Approve all the SAME
 * class (`.abtn`), and they had drifted to two different greens precisely
 * because one came from the button recipe and the other from a hand-copied
 * `commitBar` slot. The only difference left is the recipe's own size scale —
 * `xs` (26px) in a row, `md` (32px) in the foot.
 *
 * Approve is solid at rest, not outline-until-approved: it is the row's
 * committing action whatever the row's current verdict is, exactly as
 * Approve all is the canvas's.
 */
export function PlanDecisionCell({ rowKey, tag, review }: {
    rowKey: string;
    tag: ApprovalTag;
    review: PlanReview;
}) {
    const recipe = useSlotRecipe({ key: "reviewChrome" });
    const styles = useMemo(() => recipe({}) as unknown as Styles, [recipe]);
    const btn = useRecipe({ key: "button" });
    return (
        <Box css={styles.decisionCol} data-slot="decisionCell" data-verdict={tag}>
            <Box as="button" css={btn({ variant: "solid", size: "xs" })}
                aria-pressed={tag === "approved"} data-plan-approve={rowKey}
                onClick={(e) => { e.stopPropagation(); review.approveRow(rowKey); }}>
                Approve
            </Box>
            <Box as="button" css={btn({ variant: tag === "rejected" ? "danger" : "ghost", size: "xs" })}
                aria-pressed={tag === "rejected"} data-plan-reject={rowKey}
                onClick={(e) => { e.stopPropagation(); review.rejectRow(rowKey); }}>
                Reject
            </Box>
        </Box>
    );
}

/** The decision column's header cell, sitting in the ruler's trailing track. */
export function PlanDecisionHeader({ label }: { label: string }) {
    const recipe = useSlotRecipe({ key: "reviewChrome" });
    const rs = useMemo(() => recipe({}) as unknown as Styles, [recipe]);
    return <Box css={rs.decisionHeader} data-slot="decisionHeader">{label}</Box>;
}
