/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { Box, VisuallyHidden } from "@chakra-ui/react";
import { DECISIONS_SOURCE } from "@elaraai/e3-ui/internal";
import { FLOOR_RANK, historyToolbarItem, type EditHistory, type EditIssue, type HistoryAction, type ToolbarItem } from "@elaraai/east-ui-components";
import { useRecordSlicesToolbarItems, type SlotStyles } from "@elaraai/east-ui-components/internal";
import type { ScheduleEntryRef } from "../shared/schedule/editing.js";
import type { DecisionQueueValue } from "./editing.js";
import { CountChip } from "./list.js";
import type { DecisionQueueWords } from "./messages.js";

/**
 * The queue's own rung of the row's floor, after the rail's icon drops its caret (`FLOOR_RANK`): `Decisions` leaves
 * its count chip, its name said and on hover, so the history and Save stay in the row at a phone's width (R30).
 */
const TITLE_FLOOR = FLOOR_RANK + 1;

/** What the toolbar shows. */
export interface DecisionToolbarArgs {
    /** The payload: its slice's chrome. */
    readonly value: DecisionQueueValue;
    /** The `decisionQueue` recipe's styles. */
    readonly styles: SlotStyles;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** e3's count of the narrowing's cases, or the record's size read whole (R3); `undefined` while it is read — `…`. */
    readonly count: number | undefined;
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
 * at the row's floor; and the history item last, folding to its buttons.
 * Where the whole ladder still leaves the row too wide, the queue's own rung
 * of the floor: `Decisions` leaves its count chip, its name said and on hover.
 *
 * @param args - What it shows ({@link DecisionToolbarArgs})
 * @returns The toolbar's items
 */
export function useDecisionToolbar(args: DecisionToolbarArgs): ReadonlyArray<ToolbarItem | false | undefined> {
    const { value, styles, words, count, history } = args;
    const { m } = words;
    const chrome = value.slice.type === "some" ? value.slice.value : undefined;
    const rail = useRecordSlicesToolbarItems(chrome?.slice, {
        nouns: { [DECISIONS_SOURCE]: m.noun() },
        ...(chrome === undefined ? {} : { affordances: chrome.affordances.map(a => a.type) }),
        ...(chrome?.persist.type === "some" ? { persist: chrome.persist.value.type } : {}),
    });
    return [
        {
            key: "decision.title", side: "start", rank: TITLE_FLOOR, version: count, forms: [
                <Box as="span" css={styles.heading} data-decision-title="">
                    <Box as="span" css={styles.title}>{m.title()}</Box>
                    <CountChip count={count} words={words} styles={styles} />
                </Box>,
                // At the floor: the chip alone, the title said and on hover.
                <Box as="span" css={styles.heading} data-decision-title="" title={m.title()}>
                    <VisuallyHidden>{m.title()}</VisuallyHidden>
                    <CountChip count={count} words={words} styles={styles} />
                </Box>,
            ],
        },
        ...rail,
        history !== undefined && historyToolbarItem({ session: history, words, editing: false, showError: false, onIssue: args.onIssue, onAction: args.onAction }),
    ];
}
