/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Review and history controls for the current checked batch. @packageDocumentation */
import { Box, Button, chakra, Portal, Text, Tooltip, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRotateLeft, faArrowRotateRight, faCheck, faRotate, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { SheetTransactions } from "./transactions.js";

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

/** A visible serial apply state; failed refresh and unknown write have distinct retries. */
export function SheetHistory({ session, styles, editing, onAction, onIssue }: SheetHistoryProps) {
    const readiness = session.readiness;
    const status = session.status;
    const issues = readiness.type === "ready" ? session.issues : readiness.value;
    const pending = session.pending;
    const commitEditor = editing && session.writable;
    const message = session.stale ? "Source changed — review or discard these drafts"
        : status === "applying" ? "Applying changes…"
        : status === "unknown" ? "Awaiting confirmation — retry the same request"
        : status === "reconciling" ? "Applied — loading the confirmed revision…"
        : status === "rejected" ? "Changes rejected — revise the draft before applying"
        : status === "conflict" ? "Source conflict — review or discard these drafts"
        : undefined;
    return <Box data-slot="history" css={styles.history}>
        <Box css={styles.historyActions}>
            <HistoryButton styles={styles} label="Undo" tip="Undo · Ctrl+Z / ⌘Z" icon={faArrowRotateLeft} disabled={!session.canUndo && !commitEditor} onClick={() => onAction("undo")} />
            <HistoryButton styles={styles} label="Redo" tip="Redo · Ctrl+Shift+Z / ⌘⇧Z" icon={faArrowRotateRight} disabled={!session.canRedo} onClick={() => onAction("redo")} />
            {issues.length > 0 && <Button css={styles.historyButton} size="xs" variant="outline" onMouseDown={e => e.preventDefault()} onClick={() => onIssue(issues[0]!)}>{issues.length} issue{issues.length === 1 ? "" : "s"}</Button>}
            {message !== undefined && <Text role="status" aria-live="polite" css={styles.historyStatus}>{message}</Text>}
            <HistoryButton styles={styles} label="Discard" tip="Discard changes" icon={faXmark} disabled={!session.canDiscard || (pending === 0 && !commitEditor)} onClick={() => onAction("discard")} />
            {status === "reconciling" ? <HistoryButton styles={styles} label="Retry refresh" icon={faRotate} disabled={false} onClick={() => onAction("refresh")} />
                : <HistoryButton styles={styles} label={status === "unknown" ? "Retry request" : "Apply changes"}
                    icon={status === "unknown" ? faRotate : faCheck} disabled={status !== "unknown" && !session.canApply && !commitEditor} onClick={() => onAction("apply")} />}
        </Box>
        {session.error !== undefined && <Text css={styles.historyError} role="alert">{session.error}</Text>}
    </Box>;
}
