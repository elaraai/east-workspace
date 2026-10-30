/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The DecisionQueue's list (`Decision Queue Spec.md` §7, §8, R1–R5, R7–R13,
 * R24–R27): main's one column — every case of the source, in its order, as it
 * stands: a waiting case its card, a decided one its receipt, and a case not
 * read yet a pending card, a closed card's height — through the shared
 * `VirtualRows`, each row keyed by what it shows, so a card keeps its
 * instance, its height and its place however the rows around it change, and
 * each placed by its top, so an open card's head sticks to the list's top over
 * its body (R10). A pending card's row is keyed by its place, and a view
 * resting on it rests on the case that lands there. A gesture's hold keeps the
 * head it acts on where it was on screen (R8), and goes on to show the body it
 * opened (R11); a row's height moving — a body growing open, a card shrinking
 * to its receipt — moves the rows below it in that frame. Once a read finds no
 * case, the shared empty state stands at the list's top instead.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowsRotate, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor } from "@elaraai/east";
import { EmptyStateView, type Formatters } from "@elaraai/east-ui-components";
import {
    PAGED_RETAINED, PlaceholderCard, VirtualRows, type RowRuns, type RowsHold, type RowsHoldPart, type SlotStyles,
} from "@elaraai/east-ui-components/internal";
import type { ScheduleEditing } from "../shared/schedule/editing.js";
import { DecisionCard, DecisionReceipt, flag, type DecisionRoles } from "./card.js";
import { verdictTitle, type DecisionCase } from "./cases.js";
import type { CaseChoice } from "./choices.js";
import type { DecisionRead } from "./data.js";
import { CASES, caseNow, type Decided, type DecisionQueueValue, type DecisionRecord, type DecisionTarget } from "./editing.js";
import type { DecisionQueueWords } from "./messages.js";

const stringEqual = equalFor(StringType);

/** A verdict given here: the card's height its receipt arrives from, and the history's steps done once it was recorded. */
export interface DecisionArrival {
    /** The card's height, which the receipt arrives from; `undefined` once it has. */
    readonly from: number | undefined;
    /** The cases' steps done once its step was recorded: its Undo shows while that is still the history's last step (R27). */
    readonly mark: number | undefined;
}

/**
 * A case's row's key among the list's rows: what a hold names the row by.
 *
 * @param caseKey - The case's key
 * @returns The row's key
 */
export function caseRowKey(caseKey: string): string {
    return `case:${caseKey}`;
}

/** What a pending card's row's key starts with, before its place. */
const PENDING = "pending:";

/** A case not read yet's row's key: its place, which the case that lands there takes over. */
function pendingRowKey(index: number): string {
    return `${PENDING}${index}`;
}

/** A card's head, held still as its card opens, closes or becomes its receipt: the row's 8px above the card and the card's 1px border into the row. */
export const HEAD_PART: RowsHoldPart = { find: row => row.querySelector("[data-decision-head]"), offset: 9 };
/** A receipt, held still as its Undo brings the card back: the row's 8px above it into the row. */
export const RECEIPT_PART: RowsHoldPart = { find: row => row.querySelector("[data-decision-receipt]"), offset: 8 };
/** How much of an opened card's body must show before the list glides on to reveal it (R11). */
export const REVEAL_PX = 64;

/**
 * The rows' estimates before they are measured: a card closed — a pending card's too — and open, and a receipt. Where
 * nothing lays the list out — a DOM test's jsdom — a test lays its rows out at them.
 *
 * @internal
 */
export const ROW_PX = { card: 252, openCard: 600, receipt: 48 } as const;
/** A pending card's own height: a closed card's, its row's 8px above it left out. */
const PENDING_PX = ROW_PX.card - 8;
/** The list's scroll element, named for the queue's tests and its own code. */
const LIST_PROPS: HTMLAttributes<HTMLDivElement> = { "data-decision-list": "" } as HTMLAttributes<HTMLDivElement>;
/** The list while the cases shown stand in, retained (R5): aria-disabled in a busy region. */
const RETAINED_LIST: HTMLAttributes<HTMLDivElement> = { ...LIST_PROPS, ...PAGED_RETAINED };
/** The box the rows stand in, named for the recipe, which sets it into the list rather than pad the list above it (R10). */
const ROWS_PROPS: HTMLAttributes<HTMLDivElement> = { "data-decision-rows": "" } as HTMLAttributes<HTMLDivElement>;
/** The empty state's mark: Font Awesome's inbox. */
const INBOX = { prefix: "fas", name: "inbox" };
/** Every row may anchor the view: a pending card's by the case that lands in its place. */
const ANCHORABLE = () => true;

/**
 * A count chip — the toolbar's (R3, R4): `…` while the count is not known, and each time a known count changes it
 * settles from the tint to its paper, drawn again under a new key so its animation runs.
 *
 * @param props - The count, the queue's formatters and the recipe's styles
 * @returns The chip
 */
export function CountChip({ count, words, styles }: { readonly count: number | undefined; readonly words: Formatters; readonly styles: SlotStyles }) {
    const [seen, setSeen] = useState(count);
    const [settles, setSettles] = useState(0);
    // A count that moved: React's adjust-state-while-rendering, so the chip it draws already settles.
    if (count !== seen) {
        setSeen(count);
        if (seen !== undefined && count !== undefined) setSettles(settles + 1);
    }
    return (
        <Box as="span" key={settles} css={styles.count} data-settle={flag(settles > 0)} data-decision-count="">
            {count === undefined ? "…" : words.number(count)}
        </Box>
    );
}

/** Where the list's view rests, as `VirtualRows` reports it: the rows mounted, whether a scroll is under way, and those shown. */
export type DecisionRangeChange = (
    range: { startIndex: number; endIndex: number },
    scrolling: boolean,
    center?: { index: number; withinPx: number },
    shown?: { startIndex: number; endIndex: number },
) => void;

/** Props of {@link DecisionList}. */
export interface DecisionListProps {
    /** The cases to draw, by their place in the source; `undefined` before a read lands. */
    readonly read: DecisionRead | undefined;
    /** The narrowing the cases drawn are of: the view is its own, so a new narrowing's starts at its start (R5). */
    readonly identity: string;
    /** The retained content's attributes while the cases shown stand in (R5); `undefined` while they are live. */
    readonly retained: typeof PAGED_RETAINED | undefined;
    /** Hears where the view rests: the cases around it are read as it comes to rest. */
    readonly onRangeChange: DecisionRangeChange;
    /** The payload: a case is read as its row stands through it. */
    readonly value: DecisionQueueValue;
    /** The verdicts given here, by their case's key: each receipt's arrival and its Undo's step. */
    readonly arrivals: ReadonlyMap<string, DecisionArrival>;
    /** The cases' steps done while the history can undo its last: a receipt whose mark it is takes Undo (R27). */
    readonly undoMark: number | undefined;
    /** The open case's key. */
    readonly open: string | undefined;
    /** A card's choices. */
    readonly choiceOf: (key: string) => CaseChoice;
    /** The payload's targets. */
    readonly targets: readonly DecisionTarget[];
    /** Each target's record, in the targets' order. */
    readonly records: readonly (DecisionRecord | undefined)[];
    /** Which of a verdict's parts the app's rows hold. */
    readonly roles: DecisionRoles;
    /** Takes no choice and no verdict. */
    readonly readOnly: boolean;
    /** The time the due words count from. */
    readonly now: Date;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** The `decisionQueue` recipe's styles. */
    readonly styles: SlotStyles;
    /** The queue's key: what a card's Edit panel keeps a row's own form's state under. */
    readonly storageKey: string;
    /** The queue's editing: each case is read as its row stands through it, and each card reads the rows its change touches. */
    readonly schedule: ScheduleEditing;
    /** A gesture's hold on a row (R8). */
    readonly hold: RowsHold | undefined;
    /** A row to bring into view — a key's step to a case not mounted, or not read yet: each new nonce asks again. */
    readonly scrollTo: { readonly index: number; readonly nonce: number } | undefined;
    /** Opens a card, or closes it. */
    readonly onToggle: (key: string) => void;
    /** Changes some of a card's choices. */
    readonly onChoice: (key: string, next: (was: CaseChoice) => Partial<CaseChoice>) => void;
    /** Takes a card's decision. */
    readonly onDecide: (d: Decided, from: number) => void;
    /** Takes a receipt's verdict back. */
    readonly onUndo: (key: string) => void;
    /** A receipt has arrived. */
    readonly onArrived: (key: string) => void;
}

/**
 * The list (see the module docs).
 *
 * @param props - What it lays out, and where its gestures go ({@link DecisionListProps})
 * @returns The list, the empty state, or nothing before a read lands
 */
export const DecisionList = memo(function DecisionList(props: DecisionListProps) {
    const {
        read, identity, retained, onRangeChange, value, arrivals, undoMark, open, choiceOf, targets, records, roles, readOnly, now, words, styles,
        storageKey, schedule, hold, scrollTo, onToggle, onChoice, onDecide, onUndo, onArrived,
    } = props;
    const count = read?.count ?? 0;
    // A case as its row stands now: drafted, else as read (D1). Read again only as the history moves.
    const stands = useCallback((c: DecisionCase) => caseNow(value, schedule, c), [value, schedule]);
    const getItemKey = useCallback((index: number) => {
        const c = read?.rows.get(index);
        return c === undefined ? pendingRowKey(index) : caseRowKey(c.key);
    }, [read]);
    // A pending card's row is found again at its place once its case has landed: a view resting on it rests on the case.
    const runs = useMemo((): RowRuns => ({
        rowAt: () => undefined,
        find: ({ key, offset }) => {
            if (!key.startsWith(PENDING)) return undefined;
            const index = Number(key.slice(PENDING.length));
            return Number.isInteger(index) && index < count ? { index, offset } : undefined;
        },
    }), [count]);
    const estimateSize = useCallback((index: number) => {
        const c = read?.rows.get(index);
        if (c === undefined) return ROW_PX.card;
        if (stands(c).verdict.type === "some") return ROW_PX.receipt;
        return open !== undefined && stringEqual(open, c.key) ? ROW_PX.openCard : ROW_PX.card;
    }, [read, stands, open]);
    // A row is drawn again only as this moves (#1398, CL9): what the rows show.
    const renderRow = useCallback((index: number): ReactNode => {
        const c = read?.rows.get(index);
        if (c === undefined) {
            return <Box css={styles.cardRow} data-decision-pending={index}><PlaceholderCard height={PENDING_PX} index={index} /></Box>;
        }
        const standing = stands(c);
        if (standing.verdict.type === "some") {
            // Its verdict's receipt (R24): one given here arrives from its card and takes Undo while its step is the
            // history's last (R27); one read decided — saved, or decided in another session — stands with none.
            const arrival = arrivals.get(c.key);
            const undo = !readOnly && undoMark !== undefined && arrival?.mark === undoMark && schedule.draftsOf(CASES).has(c.key);
            return (
                <Box css={styles.cardRow}>
                    <DecisionReceipt caseKey={c.key} verdict={standing.verdict.value.type} title={verdictTitle(standing)} from={arrival?.from}
                        undo={undo} words={words} styles={styles} onUndo={onUndo} onArrived={onArrived} />
                </Box>
            );
        }
        const isOpen = open !== undefined && stringEqual(open, c.key);
        return (
            <Box css={styles.cardRow}>
                <DecisionCard c={c} targets={targets} records={records} choice={choiceOf(c.key)} open={isOpen} roles={roles} readOnly={readOnly}
                    now={now} words={words} styles={styles} storageKey={storageKey} schedule={schedule}
                    onToggle={onToggle} onChoice={onChoice} onDecide={onDecide} />
            </Box>
        );
    }, [read, stands, arrivals, undoMark, open, choiceOf, targets, records, roles, readOnly, now, words, styles, storageKey, schedule,
        onToggle, onChoice, onDecide, onUndo, onArrived]);
    if (read === undefined) return null;
    if (count === 0) return <EmptyList words={words} styles={styles} retained={retained} />;
    return (
        <VirtualRows key={identity} fillParent height={undefined} maxHeight={undefined} rootCss={styles.list as Record<string, unknown> | undefined}
            rootProps={retained === undefined ? LIST_PROPS : RETAINED_LIST} rowsProps={ROWS_PROPS} count={count} getItemKey={getItemKey} anchorable={ANCHORABLE} runs={runs}
            hold={hold} liveHeights stickyParts estimateSize={estimateSize} renderRow={renderRow} onRangeChange={onRangeChange}
            scrollToIndex={scrollTo?.index} scrollNonce={scrollTo?.nonce} scrollAlign="start" />
    );
});

/** No case (§8): the shared empty state, and its two lines, each led by its icon; retained while a new read stands behind it. */
function EmptyList({ words, styles, retained }: {
    readonly words: DecisionQueueWords; readonly styles: SlotStyles; readonly retained: typeof PAGED_RETAINED | undefined;
}) {
    const empty = words.m.empty();
    return (
        <Box css={styles.empty} data-decision-empty="" {...retained}>
            <EmptyStateView icon={INBOX} title={empty.title} description={
                <Box as="ul" css={styles.emptyLines}>
                    <Box as="li" css={styles.emptyLine}>
                        <Box as="span" css={styles.emptyIcon} aria-hidden="true"><FontAwesomeIcon icon={faRotateLeft} /></Box>{empty.undo}
                    </Box>
                    <Box as="li" css={styles.emptyLine}>
                        <Box as="span" css={styles.emptyIcon} aria-hidden="true"><FontAwesomeIcon icon={faArrowsRotate} /></Box>{empty.next}
                    </Box>
                </Box>
            } />
        </Box>
    );
}
