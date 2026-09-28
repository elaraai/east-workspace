/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's review chrome — the decision column and the batch foot, whose
 * verdicts are DRAFTS of the canvas's editing session (#880).
 *
 * **Subjects are row KEYS, not indices.** A row's key is its typed id's
 * canonical text (#822) — what every map on the canvas keys by, and the only
 * thing that survives paging: a window landing above a decided row shifts
 * every index beneath it (#577), so an index-keyed verdict would quietly
 * reattach to a different job.
 *
 * **A verdict is a gesture.** The series whose rows are reviewed names the
 * entry field a verdict writes (`review: { verdict: "approval" }`), so its
 * rows arrive flagged `edits.verdict`: Approve / Reject on one drafts its
 * entry with the field changed, and Approve all / Reject all drafts every
 * row the canvas holds that takes one — on a paged canvas, the loaded rows,
 * and the foot's buttons say how many. The canvas derives the drafted rows
 * again, so the pressed button, the bar and the dot all show the draft where
 * it was made; Undo takes it back and Apply sends it with the rest of the
 * batch. The buttons act only while the session can take a gesture.
 *
 * A row whose series only SHOWS a verdict (`approval`) draws its pressed
 * state with both buttons disabled: nothing could hold a change.
 */

import { useMemo } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../../utils.js";
import type { ReviewFootModel } from "../../shared/review.js";
import type { PlanRowValue } from "../model.js";
import { usePlanWords } from "../words.js";

type Styles = Record<string, Record<string, unknown>>;

/** The decoded `review` config a Plan carries. */
export type PlanReviewValue = ValueTypeOf<typeof Plan.Types.Review>;

/** The fixed width of the trailing decision column — the shared review
 *  module's one constant, re-exported rather than re-declared (#617). */
export { DECISION_WIDTH } from "../../shared/review.js";

/** A row's resolved verdict. `pending` when the data says nothing. */
export type ApprovalTag = "approved" | "pending" | "rejected";

/** A verdict a gesture drafts. */
export type PlanVerdict = "approved" | "rejected";

/** The per-row half of the Plan's review chrome. */
export interface PlanReview extends ReviewFootModel {
    /** The decision-column header label. */
    columnLabel: string;
    /** Whether a verdict can be drafted now — the session takes a gesture. */
    writable: boolean;
    /** Approve one row, BY KEY. */
    approveRow(key: string): void;
    /** Reject one row, BY KEY. */
    rejectRow(key: string): void;
}

/** A row's verdict, read from the data — the draft's, where one was made. */
export function tagOf(row: PlanRowValue): ApprovalTag {
    const a = getSomeorUndefined(row.approval);
    return a === undefined ? "pending" : (a.type as ApprovalTag);
}

/** Whether a row draws a decision cell: it takes verdicts, or shows one. */
export function hasDecision(row: PlanRowValue): boolean {
    return row.edits.verdict || row.approval.type === "some";
}

/** The review gestures — the canvas's editing session's (#880). */
export interface PlanReviewVerbs {
    /** Draft a verdict on one row, by key. */
    verdict(key: string, verdict: PlanVerdict): void;
    /** Draft a verdict on every row the canvas holds that takes one. */
    verdictAll(verdict: PlanVerdict): void;
    /** Rerun — the root's callback: it changes no data. */
    rerun(): void;
}

/** What the review chrome's state depends on besides the config. */
export interface PlanReviewFacts {
    /** Whether the session takes a gesture now. */
    writable: boolean;
    /** Whether any row the canvas holds takes a verdict — the foot's batch
     *  buttons need one to act on. */
    verdictRows: boolean;
}

/**
 * The review chrome's model — the root's `review` config, its verbs drafting
 * verdicts through the canvas's editing session.
 *
 * @param review - The decoded `review` option (`undefined` ⇒ chrome off)
 * @param verbs - The gestures (the editing session's) and Rerun (the controller's)
 * @param facts - Whether the session takes a gesture, and whether any row takes a verdict
 * @returns The review model, or `undefined` when `review` is absent
 */
export function planReviewModel(review: PlanReviewValue | undefined, verbs: PlanReviewVerbs, facts: PlanReviewFacts): PlanReview | undefined {
    if (review === undefined) return undefined;
    const summary = getSomeorUndefined(review.summary);
    const hasRerun = review.onRerun.type === "some";
    return {
        columnLabel: review.columnLabel,
        writable: facts.writable,
        approveRow: (key) => verbs.verdict(key, "approved"),
        rejectRow: (key) => verbs.verdict(key, "rejected"),
        summary,
        rerunLabel: review.rerunLabel,
        showFoot: summary !== undefined || facts.verdictRows || hasRerun,
        hasApproveAll: facts.verdictRows,
        hasRejectAll: facts.verdictRows,
        hasRerun,
        batchDisabled: !facts.writable,
        approveAll: () => verbs.verdictAll("approved"),
        rejectAll: () => verbs.verdictAll("rejected"),
        rerun: verbs.rerun,
    };
}

/**
 * One row's Approve / Reject pair, in the trailing decision cell.
 *
 * The pressed look comes from `tag` — i.e. from the row's data, drafted or
 * not — so the buttons and the rest of the canvas cannot disagree about a
 * verdict.
 *
 * Both buttons resolve from the shared **`button`** recipe, the same one
 * `ReviewFoot` uses for Approve all / Reject all / Rerun: the spec gives a
 * row's Approve and the foot's Approve all the SAME class (`.abtn`). The only
 * difference is the recipe's own size scale — `xs` (26px) in a row, `md`
 * (32px) in the foot.
 *
 * Approve is solid at rest, not outline-until-approved: it is the row's
 * committing action whatever the row's current verdict is, exactly as
 * Approve all is the canvas's.
 *
 * On the canvas it is a `gridcell` of the row (#819), its buttons out of the
 * tab order — the row's Tab walk reaches them, so the grid stays ONE tab
 * stop. In a narrow card it is plain content with ordinary buttons.
 */
export function PlanDecisionCell({ rowKey, tag, enabled, review, grid }: {
    rowKey: string;
    tag: ApprovalTag;
    /** Whether a verdict can be drafted on this row now — it takes verdicts and the session a gesture. */
    enabled: boolean;
    review: PlanReview;
    /** The cell sits in the canvas's treegrid. */
    grid?: boolean | undefined;
}) {
    const recipe = useSlotRecipe({ key: "reviewChrome" });
    const styles = useMemo(() => recipe({}) as unknown as Styles, [recipe]);
    const btn = useRecipe({ key: "button" });
    const words = usePlanWords();
    const inGrid = grid === true;
    return (
        <Box css={styles.decisionCol} data-slot="decisionCell" data-verdict={tag} role={inGrid ? "gridcell" : undefined}>
            <chakra.button type="button" css={btn({ variant: "solid", size: "xs" })} tabIndex={inGrid ? -1 : undefined}
                disabled={!enabled} aria-pressed={tag === "approved"} data-plan-approve={rowKey}
                onClick={(e) => { e.stopPropagation(); review.approveRow(rowKey); }}>
                {words.m.approve()}
            </chakra.button>
            <chakra.button type="button" css={btn({ variant: tag === "rejected" ? "danger" : "ghost", size: "xs" })} tabIndex={inGrid ? -1 : undefined}
                disabled={!enabled} aria-pressed={tag === "rejected"} data-plan-reject={rowKey}
                onClick={(e) => { e.stopPropagation(); review.rejectRow(rowKey); }}>
                {words.m.reject()}
            </chakra.button>
        </Box>
    );
}

/** The decision column's header cell, sitting in the ruler's trailing track. */
export function PlanDecisionHeader({ label }: { label: string }) {
    const recipe = useSlotRecipe({ key: "reviewChrome" });
    const rs = useMemo(() => recipe({}) as unknown as Styles, [recipe]);
    return <Box css={rs.decisionHeader} data-slot="decisionHeader">{label}</Box>;
}
