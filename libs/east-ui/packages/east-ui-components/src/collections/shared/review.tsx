/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared review chrome — the renderer half of the review contract
 * (`contracts/review.ts` in `@elaraai/east-ui`), extracted from the Planner's
 * review rendering (PR #76) so every adopter (Table, Roster, Board) composes
 * the same pieces:
 *
 * - {@link useReviewController} — the optimistic per-row decisions state
 *   (the mandatory interactive-state pattern: local `useState`, re-synced on
 *   a data change, `queueMicrotask` for the East callbacks).
 * - {@link DecisionButtons} — the per-row Approve / Reject pair (shared
 *   `button` recipe, so it matches the DecisionQueue).
 * - {@link ReviewFoot} — the batch foot on the shared `commitBar` recipe
 *   (Reject all / Rerun / Approve all + the host-composed summary).
 * - {@link reviewToolbarItem} — the same summary and buttons as one item of a
 *   builder's one toolbar, which leaves the builder no foot (#1193); a row
 *   short of room folds the buttons into one menu.
 *
 * The decision-column / status-dot geometry lives on the `reviewChrome` slot
 * recipe; adopters resolve it themselves (their layouts differ) and apply
 * their own sticky pinning.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, chakra, Menu as ChakraMenu, Portal, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faListCheck } from "@fortawesome/free-solid-svg-icons";
import { type OptionType, type ValueTypeOf } from "@elaraai/east";
import { type RowReviewType, type ApprovalStateType, type UIComponentType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { DEFAULT_RANK, type ToolbarItem } from "../../toolbar/index.js";
import { coarseHitArea } from "../../style/hit-area.js";

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
/**
 * What the batch foot needs — deliberately narrower than {@link ReviewController}.
 *
 * The foot's verbs are batch-level: none of them names a row. Splitting this
 * out lets a surface whose per-row verdicts are NOT index-keyed — its rows
 * addressed by key — reuse the foot without inventing an index-keyed
 * controller it has no use for.
 */
export interface ReviewFootModel {
    /** Whether the batch foot has anything to show. */
    showFoot: boolean;
    /** The host-composed foot summary, when set. */
    summary: UIComponentValue | undefined;
    /** The Rerun button's label. */
    rerunLabel: string;
    /** Whether the batch verbs are wired. */
    hasApproveAll: boolean;
    hasRejectAll: boolean;
    hasRerun: boolean;
    /** Whether Approve all / Reject all cannot act now — a surface whose
     *  verdicts are drafts of an editing session while the session takes no
     *  gesture. Absent ⇒ they can. */
    batchDisabled?: boolean | undefined;
    /** Approve every subject. */
    approveAll(): void;
    /** Reject every subject. */
    rejectAll(): void;
    /** Fire the host's re-run hook. */
    rerun(): void;
}

export interface ReviewController extends ReviewFootModel {
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
 * whenever `approvals` changes identity — memoise it from the component
 * value's DATA (`const data = useDataStable(value, dataEqual)`, then
 * `useMemo(() => data.rows.map(r => r.approval), [data])`) so the reset
 * tracks data changes, not re-renders or closure-only changes (#809).
 * Callbacks fire through `queueMicrotask` per the interactive-state pattern.
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
            rerunLabel: review.rerunLabel,
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

/** The batch foot's button words — a surface that speaks its own message
 *  table passes them; English otherwise. The Rerun button's label is the
 *  author's (`review.rerunLabel`). */
export interface ReviewFootLabels {
    /** The approve-all button. */
    approveAll: string;
    /** The reject-all button. */
    rejectAll: string;
}

const FOOT_LABELS: ReviewFootLabels = { approveAll: "Approve all", rejectAll: "Reject all" };

/**
 * The batch review foot on the shared `commitBar` recipe (the same block the
 * Diff + DecisionQueue commit bars use), mounted outside any scrolling grid
 * so it stays full-width under the surface. The summary is the host-composed
 * `review.summary` component; the buttons are Reject all / Rerun / Approve
 * all (left→right). Renders `null` when the foot has nothing to show.
 */
export function ReviewFoot({ controller, storageKey, labels = FOOT_LABELS }: {
    /** The surface's batch-review model — a full {@link ReviewController}
     *  satisfies this, as does a surface with non-index-keyed verdicts. */
    controller: ReviewFootModel;
    /** Storage key prefix for the summary component subtree. */
    storageKey: string;
    /** The buttons' words — English when omitted. */
    labels?: ReviewFootLabels | undefined;
}) {
    const commitRecipe = useSlotRecipe({ key: "commitBar" });
    const cs = useMemo(() => commitRecipe({}) as unknown as Record<string, Record<string, unknown>>, [commitRecipe]);
    // The BUTTONS come from the shared button recipe, not from `commitBar` —
    // the bar owns its layout, the button recipe owns what a button looks
    // like. `md` here, `xs` in a row's decision cell: one vocabulary, two
    // points on its own size scale.
    const btn = useRecipe({ key: "button" });
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
                    <chakra.button type="button" css={btn({ variant: "danger", size: "md" })}
                        disabled={controller.batchDisabled === true} data-review-batch="reject"
                        onClick={controller.rejectAll}>{labels.rejectAll}</chakra.button>
                )}
                {controller.hasRerun && (
                    <chakra.button type="button" css={btn({ variant: "outline", size: "md" })}
                        data-review-batch="rerun"
                        onClick={controller.rerun}>{controller.rerunLabel}</chakra.button>
                )}
                {controller.hasApproveAll && (
                    <chakra.button type="button" css={btn({ variant: "solid", size: "md" })}
                        disabled={controller.batchDisabled === true} data-review-batch="approve"
                        onClick={controller.approveAll}>{labels.approveAll}</chakra.button>
                )}
            </Box>
        </Box>
    );
}

/** The words of {@link reviewToolbarItem}: the buttons', and the menu's they fold into. */
export interface ReviewToolbarLabels extends ReviewFootLabels {
    /** The menu's accessible name. */
    menu: string;
}

const TOOLBAR_LABELS: ReviewToolbarLabels = { ...FOOT_LABELS, menu: "Review" };

/** Props of {@link reviewToolbarItem}'s forms. */
interface ReviewBatchProps {
    /** The surface's batch-review model. */
    controller: ReviewFootModel;
    /** Storage key prefix for the summary component subtree. */
    storageKey: string;
    /** The buttons' words. */
    labels: ReviewFootLabels;
    /** Whether the form shows the summary before the buttons. */
    summary: boolean;
}

/**
 * The batch verbs on one row of a toolbar: the host-composed summary, in the
 * wide form, then Reject all, Rerun and Approve all — the foot's buttons, at
 * the toolbar's size.
 */
function ReviewBatch({ controller, storageKey, labels, summary }: ReviewBatchProps) {
    const recipe = useSlotRecipe({ key: "reviewChrome" });
    const styles = useMemo(() => recipe({}) as unknown as Record<string, Record<string, unknown>>, [recipe]);
    const btn = useRecipe({ key: "button" });
    return (
        <Box css={styles.batch} data-slot="reviewBatch" data-review-form={summary ? "full" : "buttons"}>
            {summary && controller.summary !== undefined && (
                <Box css={styles.batchSummary} data-slot="reviewSummary">
                    <EastChakraComponent value={controller.summary} storageKey={`${storageKey}.review.summary`} />
                </Box>
            )}
            {controller.hasRejectAll && (
                <chakra.button type="button" css={btn({ variant: "danger", size: "sm" })}
                    disabled={controller.batchDisabled === true} data-review-batch="reject"
                    onClick={controller.rejectAll}>{labels.rejectAll}</chakra.button>
            )}
            {controller.hasRerun && (
                <chakra.button type="button" css={btn({ variant: "outline", size: "sm" })}
                    data-review-batch="rerun"
                    onClick={controller.rerun}>{controller.rerunLabel}</chakra.button>
            )}
            {controller.hasApproveAll && (
                <chakra.button type="button" css={btn({ variant: "solid", size: "sm" })}
                    disabled={controller.batchDisabled === true} data-review-batch="approve"
                    onClick={controller.approveAll}>{labels.approveAll}</chakra.button>
            )}
        </Box>
    );
}

/**
 * The batch verbs folded into one menu, for a row short of room: its trigger
 * a chip with the review's icon and a caret — a 44px touch target on a coarse
 * pointer (#346) — its items Reject all, Rerun and Approve all, each doing
 * what its button does, and disabled when the button is.
 */
function ReviewMenu({ controller, labels }: { controller: ReviewFootModel; labels: ReviewToolbarLabels }) {
    const chip = useRecipe({ key: "chip" });
    return (
        <ChakraMenu.Root onSelect={(d) => {
            if (d.value === "reject") controller.rejectAll();
            else if (d.value === "rerun") controller.rerun();
            else if (d.value === "approve") controller.approveAll();
        }}>
            <ChakraMenu.Trigger asChild>
                <chakra.button type="button" css={[chip({ tone: "neutral", numeric: true }), coarseHitArea({ position: true })]}
                    data-slot="reviewMenu" aria-label={labels.menu}>
                    <FontAwesomeIcon icon={faListCheck} data-chip-icon="" />
                    <Box as="span" data-chip-caret="">{"▾"}</Box>
                </chakra.button>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        {controller.hasRejectAll && (
                            <ChakraMenu.Item value="reject" disabled={controller.batchDisabled === true} data-destructive=""
                                data-review-batch="reject">{labels.rejectAll}</ChakraMenu.Item>
                        )}
                        {controller.hasRerun && (
                            <ChakraMenu.Item value="rerun" data-review-batch="rerun">{controller.rerunLabel}</ChakraMenu.Item>
                        )}
                        {controller.hasApproveAll && (
                            <ChakraMenu.Item value="approve" disabled={controller.batchDisabled === true}
                                data-review-batch="approve">{labels.approveAll}</ChakraMenu.Item>
                        )}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}

/** The ranks of {@link reviewToolbarItem}'s fold steps — each {@link DEFAULT_RANK} when omitted. */
export interface ReviewToolbarRanks {
    /** The summary goes, leaving the buttons. */
    summary?: number | undefined;
    /** The buttons fold into the menu. */
    menu?: number | undefined;
}

/** Options of {@link reviewToolbarItem}. */
export interface ReviewToolbarOptions {
    /** Storage key prefix for the summary component subtree. */
    storageKey: string;
    /** The buttons' and the menu's words — English when omitted. */
    labels?: ReviewToolbarLabels | undefined;
    /** The ranks of the item's fold steps. */
    rank?: ReviewToolbarRanks | undefined;
}

/**
 * The review chrome as one item of a builder's toolbar (#1193): what the
 * batch foot holds — the host-composed summary, then Reject all, Rerun and
 * Approve all — on the row's end, so a builder's frame keeps every control in
 * its one toolbar and draws no foot. Its forms, widest first: the summary and
 * the buttons; the buttons alone; and the buttons folded into one menu. A
 * review with no summary starts at the buttons, and one with no buttons is
 * its summary alone, which never folds.
 *
 * @param controller - The surface's batch-review model
 * @param options - Where the summary keeps its state, the words, and the ranks of the item's fold steps
 * @returns The item, keyed `review`, on the end side — `undefined` when the foot would show nothing
 */
export function reviewToolbarItem(controller: ReviewFootModel, options: ReviewToolbarOptions): ToolbarItem | undefined {
    if (!controller.showFoot) return undefined;
    const labels = options.labels ?? TOOLBAR_LABELS;
    const batch = (summary: boolean) => (
        <ReviewBatch controller={controller} storageKey={options.storageKey} labels={labels} summary={summary} />
    );
    const buttons = controller.hasRejectAll || controller.hasRerun || controller.hasApproveAll;
    if (!buttons) return { key: "review", side: "end", forms: [batch(true)] };
    const menu = <ReviewMenu controller={controller} labels={labels} />;
    const rank = { summary: options.rank?.summary ?? DEFAULT_RANK, menu: options.rank?.menu ?? DEFAULT_RANK };
    // The buttons' widths move with their words and with which of them show.
    const version = [labels.rejectAll, labels.approveAll, controller.rerunLabel, controller.hasRejectAll, controller.hasRerun, controller.hasApproveAll].join("|");
    if (controller.summary === undefined) return { key: "review", side: "end", forms: [batch(false), menu], rank: rank.menu, version };
    return { key: "review", side: "end", forms: [batch(true), batch(false), menu], rank: [rank.summary, rank.menu], version };
}
