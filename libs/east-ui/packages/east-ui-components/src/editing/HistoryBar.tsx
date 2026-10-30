/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The editing session's history bar (#879) — Undo, Redo, Discard and Apply
 * over the current checked batch, its status line and issues — shared by every
 * editable collection, in its collection's words, on the `editHistory` slot
 * recipe. While a part of a draft another write changed differently waits to
 * be chosen, the conflicts button leads its buttons, and Apply waits for it
 * (`conflicts.tsx`).
 *
 * @packageDocumentation
 */
import { useMemo } from "react";
import { Box, chakra, Portal, Text, Tooltip, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRotateLeft, faArrowRotateRight, faCheck, faRotate, faTriangleExclamation, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { EditHistory } from "./history.js";
import type { EditIssue, EditSession } from "./session.js";
import { ConflictsControl } from "./conflicts.js";
import { useDraftsKeeping } from "./keep.js";
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
    /** The editing session — or one history over several (`EditHistory`, #1194), which reads as one session does. */
    session: EditSession<W> | EditHistory<W>;
    /** The collection's words. */
    words: EditingWords;
    /** An open editor is committed before the requested history action. */
    editing: boolean;
    /** Go to an issue — the collection shows where it is: an issue's, or a conflict's (`EditSession.conflictIssue`) where it gives no `onConflict`. */
    onIssue: (issue: EditIssue) => void;
    /**
     * Go to a conflict's item — a conflict's Go to: what shows the item and
     * selects it, where the collection's issue click opens a list of its
     * issues instead. `onIssue` by default.
     */
    onConflict?: ((issue: EditIssue) => void) | undefined;
    /**
     * Where an issue is, in the collection's words — its row (`J-0002`,
     * `row 4`), as its banners name it ({@link SessionBanners}): what the
     * conflicts popover names a conflict's item by. Its entry's key in words
     * by default.
     */
    where?: ((issue: EditIssue) => string) | undefined;
    /**
     * An issue's text as the collection shows it — its own issues read back
     * in its words, as its banners read them ({@link SessionBanners}): what
     * the conflicts popover shows the source's words for a conflict's entry
     * in. As written by default.
     */
    issueText?: ((message: string) => string) | undefined;
    /** Run an action — the collection first commits what it has open. */
    onAction: (action: HistoryAction) => void;
    /**
     * Undo, Redo, Discard and Apply alone — the form a toolbar short of room
     * folds the bar to ({@link historyToolbarItem}). The status line and the
     * issues button go; an error still shows, and the conflicts button stays:
     * it is what turns Apply back on.
     */
    buttonsOnly?: boolean | undefined;
    /**
     * Whether the bar shows the session's error under its buttons: `true` by
     * default. A host that shows the error itself — a builder's banners
     * ({@link SessionBanners}) — passes `false`, so its toolbar keeps one row.
     */
    showError?: boolean | undefined;
    /**
     * Locked while a run of the app's optimiser is out (#1409, R2): Undo,
     * Redo, Discard and Save are `aria-disabled` and run nothing, their size,
     * their place and the focus kept — never `disabled`, which would drop the
     * focus; the conflicts popover opens, its choices off. `false` by default.
     */
    locked?: boolean | undefined;
}

/** Keep an accessible name and a hover/focus tooltip when the control has no text. */
function HistoryButton({ label, tip = label, icon, disabled, locked, styles, onClick }: {
    label: string; tip?: string | undefined; icon: IconDefinition; disabled: boolean; locked: boolean;
    styles: Styles; onClick: () => void;
}) {
    const iconRecipe = useRecipe({ key: "iconButton" });
    const iconStyles = iconRecipe({ size: "sm", variant: "outline" });
    return <Tooltip.Root openDelay={250}>
        <Tooltip.Trigger asChild>
            <span>
                <chakra.button type="button" css={[iconStyles, styles.button]} aria-label={label}
                    disabled={disabled} aria-disabled={locked ? true : undefined}
                    onMouseDown={event => event.preventDefault()} onClick={locked ? undefined : onClick}>
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
export function HistoryBar<W>({ session, words, editing, onAction, onIssue, onConflict, where, issueText, buttonsOnly = false, showError = true, locked = false }: HistoryBarProps<W>) {
    const recipe = useSlotRecipe({ key: "editHistory" });
    const styles = useMemo(() => recipe({}) as unknown as Styles, [recipe]);
    const { m } = words;
    const readiness = session.readiness;
    const status = session.status;
    const issues = readiness.type === "ready" ? session.issues : readiness.value;
    const pending = session.pending;
    const commitEditor = editing && session.writable;
    const message = session.stale ? m.historyStatus({ status: "stale" })
        : session.carrying ? m.historyStatus({ status: "carrying" })
        : status !== "idle" ? m.historyStatus({ status })
        : undefined;
    const n = issues.length;
    const unsettled = session.unsettled;
    // Drafts a reload would lose, or that a reload could not restore: said under the buttons where the bar says its error.
    const keeping = useDraftsKeeping(session);
    const keepingText = keeping.state === "unkept" ? m.bannerUnkept({ reason: keeping.reason })
        : keeping.state === "lost" ? m.bannerLost({ reason: keeping.reason }) : undefined;
    return <Box data-slot="history" data-history-form={buttonsOnly ? "buttons" : "full"} data-history-locked={locked ? "" : undefined} css={styles.root}>
        <Box css={styles.actions}>
            {!buttonsOnly && message !== undefined && <Text role="status" aria-live="polite" css={styles.status}>{message}</Text>}
            {!buttonsOnly && <Box data-slot="historyIssues" data-empty={n === 0 ? "" : undefined} css={styles.issues}>
                <HistoryButton styles={styles} label={m.issues({ n, count: words.number(n) })}
                    tip={m.issuesTip({ n, count: words.number(n) })} locked={false}
                    icon={faTriangleExclamation} disabled={n === 0} onClick={() => { if (issues[0]) onIssue(issues[0]); }} />
            </Box>}
            <ConflictsControl session={session} words={words} onIssue={onConflict ?? onIssue} where={where} issueText={issueText} locked={locked} />
            <HistoryButton styles={styles} label={m.undo()} tip={m.undoTip()} icon={faArrowRotateLeft} disabled={!session.canUndo && !commitEditor} locked={locked} onClick={() => onAction("undo")} />
            <HistoryButton styles={styles} label={m.redo()} tip={m.redoTip()} icon={faArrowRotateRight} disabled={!session.canRedo} locked={locked} onClick={() => onAction("redo")} />
            <HistoryButton styles={styles} label={m.discard()} tip={m.discardTip()} icon={faXmark} disabled={!session.canDiscard || (pending === 0 && !commitEditor)} locked={locked} onClick={() => onAction("discard")} />
            {status === "reconciling" ? <HistoryButton styles={styles} label={m.retryRefresh()} icon={faRotate} disabled={false} locked={locked} onClick={() => onAction("refresh")} />
                : <HistoryButton styles={styles} label={status === "unknown" ? m.retryRequest() : m.apply()}
                    tip={status !== "unknown" && unsettled > 0 ? m.applySettleFirst({ n: unsettled, count: words.number(unsettled) }) : undefined}
                    icon={status === "unknown" ? faRotate : faCheck} disabled={status !== "unknown" && !session.canApply && !commitEditor} locked={locked} onClick={() => onAction("apply")} />}
        </Box>
        {showError && session.error !== undefined && <Text css={styles.error} role="alert">{sessionErrorText(session.error, words)}</Text>}
        {showError && session.error === undefined && keepingText !== undefined && <Text css={styles.notice} data-history-keeping="">{keepingText}</Text>}
    </Box>;
}
