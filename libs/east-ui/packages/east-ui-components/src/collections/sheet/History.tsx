/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Review and history controls for the current checked batch. @packageDocumentation */
import { Box, chakra, Portal, Text, Tooltip, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRotateLeft, faArrowRotateRight, faCheck, faRotate, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { SheetTransactions } from "./transactions.js";
import { sessionErrorText, useSheetWords } from "./words.js";

export type HistoryAction = "undo" | "redo" | "discard" | "apply" | "refresh";
export interface SheetHistoryProps {
    session: SheetTransactions;
    styles: Record<string, Record<string, unknown>>;
    /** An open editor is committed before the requested history action. */
    editing: boolean;
    onIssue: (issue: SheetTransactions["issues"][number]) => void;
    onAction: (action: HistoryAction) => void;
}

/** Keep an accessible name and a hover/focus tooltip when the control has no text. */
function HistoryButton({ label, tip = label, icon, disabled, styles, onClick }: {
    label: string; tip?: string; icon: IconDefinition; disabled: boolean;
    styles: SheetHistoryProps["styles"]; onClick: () => void;
}) {
    const iconRecipe = useRecipe({ key: "iconButton" });
    const iconStyles = iconRecipe({ size: "sm", variant: "outline" });
    return <Tooltip.Root openDelay={250}>
        <Tooltip.Trigger asChild>
            <span>
                <chakra.button type="button" css={[iconStyles, styles.historyButton]} aria-label={label}
                    disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onClick}>
                    <FontAwesomeIcon icon={icon} />
                </chakra.button>
            </span>
        </Tooltip.Trigger>
        <Portal><Tooltip.Positioner><Tooltip.Content>{tip}</Tooltip.Content></Tooltip.Positioner></Portal>
    </Tooltip.Root>;
}

/** A visible serial apply state; failed refresh and unknown write have distinct retries. In the sheet's words (#861). */
export function SheetHistory({ session, styles, editing, onAction, onIssue }: SheetHistoryProps) {
    const words = useSheetWords();
    const { m } = words;
    const readiness = session.readiness;
    const status = session.status;
    const issues = readiness.type === "ready" ? session.issues : readiness.value;
    const pending = session.pending;
    const commitEditor = editing && session.writable;
    const message = session.stale ? m.historyStatus({ status: "stale" })
        : status !== "idle" ? m.historyStatus({ status })
        : undefined;
    const n = issues.length;
    return <Box data-slot="history" css={styles.history}>
        <Box css={styles.historyActions}>
            {message !== undefined && <Text role="status" aria-live="polite" css={styles.historyStatus}>{message}</Text>}
            <Box data-slot="historyIssues" data-empty={n === 0 ? "" : undefined} css={styles.historyIssues}>
                <HistoryButton styles={styles} label={m.issues({ n, count: words.number(n) })}
                    tip={m.issuesTip({ n, count: words.number(n) })}
                    icon={faTriangleExclamation} disabled={n === 0} onClick={() => { if (issues[0]) onIssue(issues[0]); }} />
            </Box>
            <HistoryButton styles={styles} label={m.undo()} tip={m.undoTip()} icon={faArrowRotateLeft} disabled={!session.canUndo && !commitEditor} onClick={() => onAction("undo")} />
            <HistoryButton styles={styles} label={m.redo()} tip={m.redoTip()} icon={faArrowRotateRight} disabled={!session.canRedo} onClick={() => onAction("redo")} />
            <HistoryButton styles={styles} label={m.discard()} tip={m.discardTip()} icon={faXmark} disabled={!session.canDiscard || (pending === 0 && !commitEditor)} onClick={() => onAction("discard")} />
            {status === "reconciling" ? <HistoryButton styles={styles} label={m.retryRefresh()} icon={faRotate} disabled={false} onClick={() => onAction("refresh")} />
                : <HistoryButton styles={styles} label={status === "unknown" ? m.retryRequest() : m.apply()}
                    icon={status === "unknown" ? faRotate : faCheck} disabled={status !== "unknown" && !session.canApply && !commitEditor} onClick={() => onAction("apply")} />}
        </Box>
        {session.error !== undefined && <Text css={styles.historyError} role="alert">{sessionErrorText(session.error, words)}</Text>}
    </Box>;
}
