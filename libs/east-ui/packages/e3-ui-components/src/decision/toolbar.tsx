/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { Box, VisuallyHidden } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClock } from "@fortawesome/free-solid-svg-icons";
import { DECISIONS_SOURCE } from "@elaraai/e3-ui/internal";
import { FLOOR_RANK, historyToolbarItem, type EditHistory, type EditIssue, type HistoryAction, type ToolbarItem } from "@elaraai/east-ui-components";
import { HOST_RANK, useRecordSlicesToolbarItems, type SlotStyles } from "@elaraai/east-ui-components/internal";
import type { ScheduleEntryRef } from "../shared/schedule/editing.js";
import type { DecisionQueueValue } from "./editing.js";
import { CountChip } from "./list.js";
import type { DecisionQueueWords } from "./messages.js";

/**
 * The queue's own rungs of the row's floor, after the rail's icon drops its caret (`FLOOR_RANK`): `Decisions` leaves
 * its count chip, then the past-due count is its clock and its number, then it leaves the row — its section's head
 * says it still — so the history and Save stay in the row at a phone's width (R30).
 */
const TITLE_FLOOR = FLOOR_RANK + 1;
const LATE_ICON_FLOOR = FLOOR_RANK + 2;
const LATE_GONE_FLOOR = FLOOR_RANK + 3;

/** What the toolbar shows. */
export interface DecisionToolbarArgs {
    /** The payload: its slice's chrome. */
    readonly value: DecisionQueueValue;
    /** The `decisionQueue` recipe's styles. */
    readonly styles: SlotStyles;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** The waiting cases that are not routine (R3); `undefined` while it is not known — `…`. */
    readonly waiting: number | undefined;
    /** The waiting cases overdue (R3): none, no item; `undefined` while a new narrowing's are read — `… past due`. */
    readonly overdue: number | undefined;
    /** Whether the cases standing hold one overdue: the past-due item keeps its place while a new narrowing is read. */
    readonly late: boolean;
    /** The one history; `undefined` read only — no history item (R22). */
    readonly history: EditHistory<ScheduleEntryRef> | undefined;
    /** Shows where an issue of the history is. */
    readonly onIssue: (issue: EditIssue) => void;
    /** Runs a history action. */
    readonly onAction: (action: HistoryAction) => void;
}

/**
 * The DecisionQueue's toolbar (`Decision Queue Spec.md` §7, R3, R30): one row
 * of the shared toolbar — `Decisions` and its count chip first; the rail over
 * the slice's `decisions` source, its chips folding first, to its filter icon
 * at the row's floor; the past-due count, `2 past due`, folding to `2 late`;
 * and the history item last, folding to its buttons. Where the whole ladder
 * still leaves the row too wide, the queue's own rungs of the floor, the fewest
 * that fit: `Decisions` leaves its count chip, the past-due count is its clock
 * and its number, then it leaves the row.
 *
 * @param args - What it shows ({@link DecisionToolbarArgs})
 * @returns The toolbar's items
 */
export function useDecisionToolbar(args: DecisionToolbarArgs): ReadonlyArray<ToolbarItem | false | undefined> {
    const { value, styles, words, waiting, overdue, late, history } = args;
    const { m } = words;
    const chrome = value.slice.type === "some" ? value.slice.value : undefined;
    const rail = useRecordSlicesToolbarItems(chrome?.slice, {
        nouns: { [DECISIONS_SOURCE]: m.noun() },
        ...(chrome === undefined ? {} : { affordances: chrome.affordances.map(a => a.type) }),
        ...(chrome?.persist.type === "some" ? { persist: chrome.persist.value.type } : {}),
    });
    const n = overdue === undefined ? "…" : words.number(overdue);
    const lateText = (narrow: boolean) => m.pastDue({ n, narrow });
    return [
        {
            key: "decision.title", side: "start", rank: TITLE_FLOOR, version: waiting, forms: [
                <Box as="span" css={styles.heading} data-decision-title="">
                    <Box as="span" css={styles.title}>{m.title()}</Box>
                    <CountChip count={waiting} words={words} styles={styles} />
                </Box>,
                // At the floor: the chip alone, the title said and on hover.
                <Box as="span" css={styles.heading} data-decision-title="" title={m.title()}>
                    <VisuallyHidden>{m.title()}</VisuallyHidden>
                    <CountChip count={waiting} words={words} styles={styles} />
                </Box>,
            ],
        },
        ...rail,
        late && {
            key: "decision.late", side: "end", rank: [HOST_RANK, LATE_ICON_FLOOR, LATE_GONE_FLOOR], version: overdue, forms: [
                <Box as="span" css={styles.late} data-decision-late="">{lateText(false)}</Box>,
                <Box as="span" css={styles.late} data-decision-late="">{lateText(true)}</Box>,
                // At the floor: its clock and its number, its words said and on hover.
                <Box as="span" css={styles.late} data-decision-late="" title={lateText(false)}>
                    <Box as="span" css={styles.lateIcon} aria-hidden="true"><FontAwesomeIcon icon={faClock} /></Box>
                    <Box as="span" aria-hidden="true">{n}</Box>
                    <VisuallyHidden>{lateText(false)}</VisuallyHidden>
                </Box>,
                null,
            ],
        },
        history !== undefined && historyToolbarItem({ session: history, words, editing: false, showError: false, onIssue: args.onIssue, onAction: args.onAction }),
    ];
}
