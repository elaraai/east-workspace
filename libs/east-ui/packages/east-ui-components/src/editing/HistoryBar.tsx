/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing session's history bar (#879) — Undo, Redo, Discard and Apply
 * over the current checked batch, its status line and issues — shared by every
 * editable collection, in its collection's words, on the `editHistory` slot
 * recipe.
 *
 * @packageDocumentation
 */
import { useMemo } from "react";
import { Box, chakra, Portal, Text, Tooltip, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRotateLeft, faArrowRotateRight, faCheck, faRotate, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { EditIssue, EditSession } from "./session.js";
import { sessionErrorText, type EditingWords } from "./messages.js";

/** A history bar action. */
export type HistoryAction = "undo" | "redo" | "discard" | "apply" | "refresh";

type Styles = Record<string, Record<string, unknown>>;

/**
 * Props of {@link HistoryBar}.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface HistoryBarProps<W> {
    /** The editing session. */
    session: EditSession<W>;
    /** The collection's words. */
    words: EditingWords;
    /** An open editor is committed before the requested history action. */
    editing: boolean;
    /** Go to an issue — the collection shows where it is. */
    onIssue: (issue: EditIssue) => void;
    /** Run an action — the collection first commits what it has open. */
    onAction: (action: HistoryAction) => void;
}

/** Keep an accessible name and a hover/focus tooltip when the control has no text. */
function HistoryButton({ label, tip = label, icon, disabled, styles, onClick }: {
    label: string; tip?: string; icon: IconDefinition; disabled: boolean;
    styles: Styles; onClick: () => void;
}) {
    const iconRecipe = useRecipe({ key: "iconButton" });
    const iconStyles = iconRecipe({ size: "sm", variant: "outline" });
    return <Tooltip.Root openDelay={250}>
        <Tooltip.Trigger asChild>
            <span>
                <chakra.button type="button" css={[iconStyles, styles.button]} aria-label={label}
                    disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={onClick}>
                    <FontAwesomeIcon icon={icon} />
                </chakra.button>
            </span>
        </Tooltip.Trigger>
        <Portal><Tooltip.Positioner><Tooltip.Content>{tip}</Tooltip.Content></Tooltip.Positioner></Portal>
    </Tooltip.Root>;
}

/**
 * The history bar: a visible serial apply state, where a failed refresh and a
 * write of unknown outcome each have their own retry.
 *
 * @typeParam W - The collection's projection of an entry
 * @param props - The session, the collection's words, and its callbacks
 * @returns The bar
 */
export function HistoryBar<W>({ session, words, editing, onAction, onIssue }: HistoryBarProps<W>) {
    const recipe = useSlotRecipe({ key: "editHistory" });
    const styles = useMemo(() => recipe({}) as unknown as Styles, [recipe]);
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
    return <Box data-slot="history" css={styles.root}>
        <Box css={styles.actions}>
            {message !== undefined && <Text role="status" aria-live="polite" css={styles.status}>{message}</Text>}
            <Box data-slot="historyIssues" data-empty={n === 0 ? "" : undefined} css={styles.issues}>
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
        {session.error !== undefined && <Text css={styles.error} role="alert">{sessionErrorText(session.error, words)}</Text>}
    </Box>;
}
