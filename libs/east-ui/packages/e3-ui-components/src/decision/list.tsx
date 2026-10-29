/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The DecisionQueue's list (`Decision Queue Spec.md` §7, §8, R2–R4, R7–R13,
 * R24–R28): main's one column — each section's head and its cases, a card or
 * the receipt a verdict left where it stood, and the Routine band last —
 * through the shared `VirtualRows`, each row keyed by what it shows, so a card
 * keeps its instance, its height and its place however the rows around it
 * change. A gesture's hold keeps the head it acts on where it was on screen
 * (R8), and goes on to show the body it opened (R11); a row's height moving —
 * a body growing open, a card shrinking to its receipt, a receipt leaving —
 * moves the rows below it in that frame. Once a read finds nothing waiting,
 * the shared empty state stands at the list's top instead.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { Box, chakra, useRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowsRotate, faChevronRight, faRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor } from "@elaraai/east";
import { EmptyStateView, getSomeorUndefined, useTrackedEvaluation, type Formatters } from "@elaraai/east-ui-components";
import { VirtualRows, type RowsHold, type RowsHoldPart, type SlotStyles } from "@elaraai/east-ui-components/internal";
import type { ScheduleEditing } from "../shared/schedule/editing.js";
import { DecisionCard, DecisionReceipt, Figured, flag, iconOf, type DecisionRoles } from "./card.js";
import type { CaseChoice } from "./choices.js";
import { appliedInTurn, targetOf, type AppliedItem, type AppliedRows, type Decided, type DecisionRecord, type DecisionTarget } from "./editing.js";
import { totalOf, type DecisionCase, type DecisionLayout, type DecisionSectionLayout } from "./layout.js";
import type { DecisionQueueWords, DecisionVerdictWord } from "./messages.js";
import { applyOff, cardView } from "./state.js";

const stringEqual = equalFor(StringType);

/** The receipt a verdict leaves where its card stood (R24–R27). */
export interface DecisionReceiptState {
    /** What was decided. */
    readonly verdict: DecisionVerdictWord;
    /** The option's title, as the card showed it. */
    readonly title: string;
    /** The card's height, which the receipt arrives from. */
    readonly from: number;
    /** The verdicts' steps done once its step was recorded: its Undo shows while that is still the history's last step (R27). */
    readonly mark: number | undefined;
}

/** A row of the list: a section's head, a case — its card, or its receipt — or the Routine band. */
export type DecisionRow =
    | { readonly kind: "section"; readonly key: string; readonly section: DecisionSectionLayout; readonly first: boolean }
    | { readonly kind: "case"; readonly key: string; readonly c: DecisionCase }
    | { readonly kind: "routine"; readonly key: string; readonly first: boolean };

/**
 * A case's row's key among the list's rows: what a hold names the row by.
 *
 * @param caseKey - The case's key
 * @returns The row's key
 */
export function caseRowKey(caseKey: string): string {
    return `case:${caseKey}`;
}

/**
 * The list's rows, in the queue's order (R2): each section's head and its cases, the Routine band last.
 *
 * @param layout - The cases as the queue lays them out
 * @returns The rows
 */
export function listRows(layout: DecisionLayout): DecisionRow[] {
    const rows: DecisionRow[] = [];
    layout.sections.forEach((section, i) => {
        rows.push({ kind: "section", key: `section:${section.section}`, section, first: i === 0 });
        for (const c of section.cases) rows.push({ kind: "case", key: caseRowKey(c.key), c });
    });
    if (layout.routine.length > 0) rows.push({ kind: "routine", key: "routine", first: layout.sections.length === 0 });
    return rows;
}

/** A card's head, held still as its card opens, closes or becomes its receipt: the card's 8px margin and its 1px border into the row. */
export const HEAD_PART: RowsHoldPart = { find: row => row.querySelector("[data-decision-head]"), offset: 9 };
/** A receipt, held still as its Undo brings the card back: its 8px margin into the row. */
export const RECEIPT_PART: RowsHoldPart = { find: row => row.querySelector("[data-decision-receipt]"), offset: 8 };
/** How much of an opened card's body must show before the list glides on to reveal it (R11). */
export const REVEAL_PX = 64;

/** The rows' estimates before they are measured: a section's head, a card closed and open, a receipt, the band and a row of it. */
const SECTION_PX = 36, FIRST_SECTION_PX = 32, CARD_PX = 252, OPEN_CARD_PX = 600, RECEIPT_PX = 48, ROUTINE_PX = 52, ROUTINE_ROW_PX = 40;
/** The list's scroll element, named for the queue's tests and its own code. */
const LIST_PROPS = { "data-decision-list": "" } as Record<string, string>;
/** The empty state's mark: Font Awesome's inbox. */
const INBOX = { prefix: "fas", name: "inbox" };
/** A routine case's choices: none — the band applies each one's recommended option. */
const NONE_CHOSEN: CaseChoice = {};
const NO_APPLIED: readonly AppliedRows[] = [];

/**
 * A count chip — the toolbar's, a section's, the Routine band's (R4): `…` while the count is not known, and each time
 * a known count changes it settles from the tint to its paper, drawn again under a new key so its animation runs.
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

/** Props of {@link DecisionList}. */
export interface DecisionListProps {
    /** The list's rows ({@link listRows}). */
    readonly rows: readonly DecisionRow[];
    /** The cases as the queue lays them out: the Routine band's cases and counts. */
    readonly layout: DecisionLayout;
    /** Whether the list is empty for good — read, and nothing shows — so the empty state stands instead. */
    readonly empty: boolean;
    /** The receipts standing, by their case's key. */
    readonly receipts: ReadonlyMap<string, DecisionReceiptState>;
    /** The verdicts' steps done while the history can undo its last: a receipt whose mark it is takes Undo (R27). */
    readonly undoMark: number | undefined;
    /** The open case's key. */
    readonly open: string | undefined;
    /** Whether the Routine band is open. */
    readonly routineOpen: boolean;
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
    /** The time the sections and the due words count from. */
    readonly now: Date;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** The `decisionQueue` recipe's styles. */
    readonly styles: SlotStyles;
    /** The queue's editing: the open card reads the rows its change touches through it, and the band its batch's; none read only. */
    readonly schedule: ScheduleEditing | undefined;
    /** A gesture's hold on a row (R8). */
    readonly hold: RowsHold | undefined;
    /** A case to bring into view, a key's step to a card the list has not mounted: each new nonce asks again. */
    readonly scrollTo: { readonly key: string; readonly nonce: number } | undefined;
    /** Opens a card, or closes it. */
    readonly onToggle: (key: string) => void;
    /** Changes some of a card's choices. */
    readonly onChoice: (key: string, next: (was: CaseChoice) => Partial<CaseChoice>) => void;
    /** Takes a card's decision. */
    readonly onDecide: (d: Decided, from: number) => void;
    /** Takes a receipt's verdict back. */
    readonly onUndo: (key: string) => void;
    /** A receipt has left. */
    readonly onGone: (key: string) => void;
    /** Opens or folds the Routine band. */
    readonly onRoutineToggle: () => void;
    /** Applies the routine cases given, as one step (R28). */
    readonly onApplyAll: (decided: readonly Decided[]) => void;
}

/**
 * The list (see the module docs).
 *
 * @param props - What it lays out, and where its gestures go ({@link DecisionListProps})
 * @returns The list, or the empty state
 */
export const DecisionList = memo(function DecisionList(props: DecisionListProps) {
    const {
        rows, layout, empty, receipts, undoMark, open, routineOpen, choiceOf, targets, records, roles, readOnly, now, words, styles, schedule, hold, scrollTo,
        onToggle, onChoice, onDecide, onUndo, onGone, onRoutineToggle, onApplyAll,
    } = props;
    // Each section's total (R3): the sum of its waiting cases' shown values, the chosen option's of each, where they share
    // one format.
    const totals = useMemo(() => {
        const out = new Map<string, string>();
        for (const row of rows) {
            if (row.kind !== "section") continue;
            const waiting = row.section.cases.filter(c => !receipts.has(c.key));
            const total = totalOf(waiting, c => cardView(c, choiceOf(c.key), roles.answer).option?.value ?? 0);
            if (total !== undefined) out.set(row.key, words.value(total.value, getSomeorUndefined(total.format), true));
        }
        return out;
    }, [rows, receipts, choiceOf, roles.answer, words]);
    const getItemKey = useCallback((index: number) => rows[index]?.key ?? index, [rows]);
    const anchorable = useCallback(() => true, []);
    const estimateSize = useCallback((index: number) => {
        const row = rows[index];
        if (row === undefined) return 0;
        switch (row.kind) {
            case "section": return row.first ? FIRST_SECTION_PX : SECTION_PX;
            case "case": return receipts.has(row.c.key) ? RECEIPT_PX : open !== undefined && stringEqual(open, row.c.key) ? OPEN_CARD_PX : CARD_PX;
            case "routine": return ROUTINE_PX + (routineOpen ? layout.routine.length * ROUTINE_ROW_PX : 0);
        }
    }, [rows, receipts, open, routineOpen, layout.routine.length]);
    // A row is drawn again only as this moves (#1398, CL9): what the rows show.
    const renderRow = useCallback((index: number): ReactNode => {
        const row = rows[index];
        if (row === undefined) return null;
        switch (row.kind) {
            case "section":
                return <SectionHead section={row.section} first={row.first} total={totals.get(row.key)} words={words} styles={styles} />;
            case "case": {
                const c = row.c;
                const receipt = receipts.get(c.key);
                if (receipt !== undefined) {
                    return (
                        <Box css={styles.cardRow}>
                            <DecisionReceipt caseKey={c.key} verdict={receipt.verdict} title={receipt.title} from={receipt.from}
                                undo={undoMark !== undefined && receipt.mark === undoMark} words={words} styles={styles} onUndo={onUndo} onGone={onGone} />
                        </Box>
                    );
                }
                const isOpen = open !== undefined && stringEqual(open, c.key);
                return (
                    <Box css={styles.cardRow}>
                        <DecisionCard c={c} targets={targets} records={records} choice={choiceOf(c.key)} open={isOpen} roles={roles} readOnly={readOnly}
                            now={now} words={words} styles={styles} schedule={isOpen ? schedule : undefined}
                            onToggle={onToggle} onChoice={onChoice} onDecide={onDecide} />
                    </Box>
                );
            }
            case "routine":
                return (
                    <RoutineBand cases={layout.routine} waiting={layout.routineWaiting} first={row.first} open={routineOpen} targets={targets} records={records}
                        roles={roles} readOnly={readOnly} words={words} styles={styles} schedule={schedule} onToggle={onRoutineToggle} onApplyAll={onApplyAll} />
                );
        }
    }, [rows, totals, receipts, undoMark, open, routineOpen, layout.routine, layout.routineWaiting, choiceOf, targets, records, roles, readOnly, now, words,
        styles, schedule, onToggle, onChoice, onDecide, onUndo, onGone, onRoutineToggle, onApplyAll]);
    const scrollIndex = scrollTo === undefined ? undefined : rows.findIndex(row => row.kind === "case" && stringEqual(row.c.key, scrollTo.key));
    if (empty) return <EmptyList words={words} styles={styles} />;
    return (
        <VirtualRows fillParent height={undefined} maxHeight={undefined} rootCss={styles.list as Record<string, unknown> | undefined} rootProps={LIST_PROPS}
            count={rows.length} getItemKey={getItemKey} anchorable={anchorable} hold={hold} liveHeights estimateSize={estimateSize} renderRow={renderRow}
            scrollToIndex={scrollIndex === undefined || scrollIndex < 0 ? undefined : scrollIndex} scrollNonce={scrollTo?.nonce} scrollAlign="start" />
    );
});

/** A section's head (§8): its label in its tone, its count chip, the rule filling the row, and its total. */
function SectionHead({ section, first, total, words, styles }: {
    readonly section: DecisionSectionLayout; readonly first: boolean; readonly total: string | undefined;
    readonly words: DecisionQueueWords; readonly styles: SlotStyles;
}) {
    return (
        <Box css={styles.section} role="heading" aria-level={3} data-first={flag(first)} data-decision-section={section.section}>
            <Box as="span" css={styles.sectionLabel} data-tone={section.section === "overdue" ? "overdue" : undefined}>{words.m.section({ section: section.section })}</Box>
            <CountChip count={section.waiting} words={words} styles={styles} />
            <Box as="span" css={styles.sectionRule} aria-hidden="true" />
            {total !== undefined && <Box as="span" css={styles.sectionTotal}>{total}</Box>}
        </Box>
    );
}

/** Props of {@link RoutineBand}. */
interface RoutineBandProps {
    readonly cases: readonly DecisionCase[];
    readonly waiting: number;
    readonly first: boolean;
    readonly open: boolean;
    readonly targets: readonly DecisionTarget[];
    readonly records: readonly (DecisionRecord | undefined)[];
    readonly roles: DecisionRoles;
    readonly readOnly: boolean;
    readonly words: DecisionQueueWords;
    readonly styles: SlotStyles;
    readonly schedule: ScheduleEditing | undefined;
    readonly onToggle: () => void;
    readonly onApplyAll: (decided: readonly Decided[]) => void;
}

/**
 * The Routine band (R28, §8): its toggle — the chevron, `Routine` and its count — the cases' total together, and
 * `Apply all {n}`; open, a row a case. Apply all applies the recommended option of each case whose Apply is on, as its
 * card's would be, as one step: what each leaves read here, tracked, each over the rows the ones before it leave.
 */
const RoutineBand = memo(function RoutineBand({
    cases, waiting, first, open, targets, records, roles, readOnly, words, styles, schedule, onToggle, onApplyAll,
}: RoutineBandProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const listId = useId();
    // The cases Apply all can apply: the recommended option of each whose Apply is on, its question none.
    const candidates = useMemo(() => cases.flatMap((c): (AppliedItem & { readonly c: DecisionCase })[] => {
        const view = cardView(c, NONE_CHOSEN, roles.answer);
        if (view.option === undefined || applyOff(view, "ready", false) !== undefined) return [];
        const at = targetOf(targets, view.option.change.tag);
        return [{ c, option: view.option, target: at < 0 ? undefined : targets[at], record: at < 0 ? undefined : records[at] }];
    }), [cases, roles.answer, targets, records]);
    const readBatch = useCallback(() => (schedule === undefined || readOnly ? NO_APPLIED : appliedInTurn(schedule, candidates)), [schedule, readOnly, candidates]);
    const { result } = useTrackedEvaluation(readBatch);
    const applied = result.ok ? result.value : NO_APPLIED;
    const reading = applied.some(a => a.state === "reading");
    // What the batch decides: each case whose change applies, with what it leaves.
    const decided = useMemo(() => candidates.flatMap((item, i): Decided[] => {
        const got = applied[i];
        if (got === undefined || (got.state !== "ready" && got.state !== "none")) return [];
        const rows = got.state === "ready" && item.record !== undefined && got.rows.size > 0 ? { record: item.record, rows: got.rows } : undefined;
        return [{ c: item.c, option: item.option, verdict: "applied", rows }];
    }), [candidates, applied]);
    const n = reading ? candidates.length : decided.length;
    const off = !result.ok ? m.applyOff({ why: "failed" }) : reading ? m.applyOff({ why: "reading" }) : undefined;
    const total = totalOf(cases, c => cardView(c, NONE_CHOSEN, roles.answer).option?.value ?? 0);
    return (
        <Box css={styles.routine} data-first={flag(first)} data-decision-routine="">
            <Box css={styles.routineHead}>
                <chakra.button type="button" css={styles.routineToggle} aria-expanded={open} aria-controls={open ? listId : undefined} onClick={onToggle}>
                    <Box as="span" css={styles.chevron} data-open={flag(open)} aria-hidden="true"><FontAwesomeIcon icon={faChevronRight} /></Box>
                    <Box as="span" css={styles.toggleLabel}>{m.routine()}</Box>
                    <CountChip count={waiting} words={words} styles={styles} />
                </chakra.button>
                <Box as="span" css={styles.routineTotal}>
                    {total !== undefined && m.together({ total: words.value(total.value, getSomeorUndefined(total.format), true) })}
                </Box>
                {!readOnly && schedule !== undefined && n > 0 && (
                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} aria-disabled={off !== undefined || undefined} title={off}
                        onClick={() => { if (off === undefined && decided.length > 0) onApplyAll(decided); }}>
                        {m.applyAll({ n: words.number(n) })}
                    </chakra.button>
                )}
            </Box>
            {open && (
                <Box id={listId} css={styles.routineList} role="list" aria-label={m.routine()}>
                    {cases.map(c => <RoutineRow key={c.key} c={c} targets={targets} roles={roles} words={words} styles={styles} />)}
                </Box>
            )}
        </Box>
    );
});

/** A routine case's row (§8): its target's icon, its recommended option's title with `Name · scope` under it, and its value. */
function RoutineRow({ c, targets, roles, words, styles }: {
    readonly c: DecisionCase; readonly targets: readonly DecisionTarget[]; readonly roles: DecisionRoles;
    readonly words: DecisionQueueWords; readonly styles: SlotStyles;
}) {
    const view = cardView(c, NONE_CHOSEN, roles.answer);
    const option = view.option;
    const at = option === undefined ? -1 : targetOf(targets, option.change.tag);
    const target = at < 0 ? undefined : targets[at];
    const icon = target === undefined ? undefined : iconOf(target.icon);
    return (
        <Box css={styles.routineRow} role="listitem" data-decision-routine-case={c.key}>
            <Box as="span" css={styles.routineIcon} aria-hidden="true">{icon !== undefined && <FontAwesomeIcon icon={icon} />}</Box>
            <Box css={styles.routineText}>
                <Box as="span" css={styles.routineTitle}><Figured text={option?.title ?? ""} /></Box>
                <Box as="span" css={styles.routineMeta}>{target === undefined ? c.scope : `${target.name} · ${c.scope}`}</Box>
            </Box>
            {option !== undefined && <Box as="span" css={styles.routineValue}>{words.value(option.value, getSomeorUndefined(c.format), true)}</Box>}
        </Box>
    );
}

/** Nothing waiting (§8): the shared empty state, and its two lines, each led by its icon. */
function EmptyList({ words, styles }: { readonly words: DecisionQueueWords; readonly styles: SlotStyles }) {
    const empty = words.m.empty();
    return (
        <Box css={styles.empty} data-decision-empty="">
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
