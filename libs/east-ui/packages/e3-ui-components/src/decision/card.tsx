/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A case's card in the DecisionQueue (`Decision Queue Spec.md` §8, R14–R24),
 * and the receipt a verdict leaves where it stood (R25–R28).
 *
 * The head is the card's toggle: the target's icon, its name and the case's
 * scope, the due words in their section's tone, the recommended option's
 * title, its preview's frame, `Proposed` or `Modified` beside the summary, and
 * the value line with the status at its end. Open, the body holds the options
 * — a listbox, one tab stop, the arrows moving along it — the change's
 * sentence, the figures, Your call over the chosen option's question, the
 * warnings, Why and the note; the foot holds the actions and their panels:
 * Modify's edits of each row the change touches, through the shared form over
 * its record's fields, and Override's reason and note. Every input is a shared
 * renderer mounted with a payload built from East's `defaultValue` of its
 * type, as `FieldForm`'s are; the `decisionQueue` recipe draws the rest from
 * the attributes the card sets.
 *
 * The rows the chosen option's change leaves are read for every card the list
 * draws, closed or open, tracked, so a row's read landing reads them again:
 * what its preview draws (`preview/`), what Apply writes, what Modify edits,
 * and whether the change still applies (Stale).
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { Box, Field as ChakraField, VisuallyHidden, chakra, useRecipe } from "@chakra-ui/react";
import { findIconDefinition, library, type IconDefinition, type IconName } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBan, faCheck, faChevronRight, faCircleExclamation, faTriangleExclamation, fas } from "@fortawesome/free-solid-svg-icons";
import { StringType, defaultValue, equalFor, fromEastTypeValue, none, some, variant, type EastType } from "@elaraai/east";
import { Checkbox, Input, RadioGroup, Textarea } from "@elaraai/east-ui/internal";
import {
    EastChakraCheckbox, EastChakraRadioGroup, EastChakraStringInput, EastChakraTextarea, FieldForm, fieldFormMessages, getSomeorUndefined, takeKey,
    useTrackedEvaluation, type FieldFormWords, type TickFormatOpt,
} from "@elaraai/east-ui-components";
import { LoadingFailedLine, useReceiptHold, type SlotStyles } from "@elaraai/east-ui-components/internal";
import type { ScheduleEditing } from "../shared/schedule/editing.js";
import { rowCodec, type RowCodec } from "../shared/schedule/records.js";
import { bytesOf, keptBytes, optionId, type CaseChoice, type RowEdit } from "./choices.js";
import { appliedRows, targetOf, type AppliedRows, type Decided, type DecisionQueueValue, type DecisionRecord, type DecisionTarget } from "./editing.js";
import { figureRuns } from "./figures.js";
import { DecisionPreview, flag, type SharedRows } from "./preview/index.js";
import { dueWords, sectionOf, type DecisionCase } from "./layout.js";
import type { DecisionAnswerWord, DecisionQueueWords, DecisionReasonWord, DecisionVerdictWord } from "./messages.js";
import {
    applyOff, cardStatus, cardView, changedRows, fieldAt, overrideRows, sameRow, valueSub, withField, writtenRows,
    type CallState, type CardView, type ChangedRow, type RowsState,
} from "./state.js";

// A target names its icon by its Font Awesome solid name.
library.add(fas);

/** Which of a verdict's parts the app's rows hold: without one the card asks for none of it (§5.2). */
export type DecisionRoles = DecisionQueueValue["verdicts"]["roles"];

const stringEqual = equalFor(StringType);

// Each shared input's payload with nothing set: East's default for its type, as `FieldForm`'s are.
const RADIO = defaultValue<typeof RadioGroup.Types.Root>(RadioGroup.Types.Root);
const RADIO_STYLE = defaultValue<typeof RadioGroup.Types.Style>(RadioGroup.Types.Style);
const TEXTAREA = defaultValue<typeof Textarea.Types.Textarea>(Textarea.Types.Textarea);
const STRING_INPUT = defaultValue<typeof Input.Types.String>(Input.Types.String);
const CHECKBOX = defaultValue<typeof Checkbox.Types.Checkbox>(Checkbox.Types.Checkbox);
/** The inputs' size in a card: the design system's small input. */
const SIZE = some(variant("sm", null));
/** Your call's answers: one row, wrapping where the card is narrow. */
const ANSWERS_STYLE = some({ ...RADIO_STYLE, orientation: some(variant("horizontal", null)), size: SIZE });
/** Override's reasons: the recipe lays them in two columns. */
const REASONS_STYLE = some({ ...RADIO_STYLE, size: SIZE });
const NOTE_STYLE = some({ ...defaultValue<typeof Textarea.Types.Style>(Textarea.Types.Style), size: SIZE, resize: some(variant("vertical", null)) });
const INPUT_STYLE = some({ ...defaultValue<typeof Input.Types.Style>(Input.Types.Style), size: SIZE });
/** The note's two lines. */
const NOTE_ROWS = some(2n);
/** A confidence, at two places — `0.82`. */
const TWO_PLACES: TickFormatOpt = variant("number", { minimumFractionDigits: some(2n), maximumFractionDigits: some(2n), signDisplay: none });

const ANSWERS: readonly DecisionAnswerWord[] = ["yes", "no", "unsure"];
const REASONS: readonly DecisionReasonWord[] = ["context", "data", "priorities", "other"];
/** Other's reason is given in the note: without the note's role it is no reason the card offers. */
const REASONS_NO_NOTE: readonly DecisionReasonWord[] = ["context", "data", "priorities"];

/** Your call's tone and icon in each state (§8). */
const CALL_TONES: Readonly<Record<CallState, "warn" | "neg" | "pos">> = { needs: "warn", blocked: "neg", handoff: "warn", answered: "pos" };
const CALL_ICONS: Readonly<Record<CallState, IconDefinition>> = {
    needs: faTriangleExclamation, blocked: faCircleExclamation, handoff: faTriangleExclamation, answered: faCheck,
};
/** A status's tone at the value line's end (P21). */
const STATUS_TONES = { needsAnswer: "warn", blocked: "neg", handoff: "warn", stale: "warn" } as const;

/** A case with no option reads no rows. */
const NO_OPTION: AppliedRows = { state: "none" };
const NO_ROWS: readonly ChangedRow[] = [];
const KEEP: RowEdit = { keep: true };
const NO_CHANGE = (): void => {};

export { flag };

/**
 * Running text with its figures marked for the recipe to set in mono (`data-figure`, §8).
 *
 * @param props - The app's text
 * @returns The text, its figures marked
 */
export function Figured({ text }: { readonly text: string }) {
    return <>{figureRuns(text).map((run, i) => (run.figure ? <span key={i} data-figure="">{run.text}</span> : run.text))}</>;
}

/**
 * A target's icon, by its Font Awesome solid name.
 *
 * @param name - The icon's name
 * @returns Its definition; `undefined` for a name Font Awesome has none of
 */
export function iconOf(name: string): IconDefinition | undefined {
    return findIconDefinition({ prefix: "fas", iconName: name as IconName }) as IconDefinition | undefined;
}

/** Props of {@link DecisionCard}. */
export interface DecisionCardProps {
    /** The case. */
    readonly c: DecisionCase;
    /** The payload's targets. */
    readonly targets: readonly DecisionTarget[];
    /** Each target's record, in the targets' order: `undefined` for one the queue writes none of. */
    readonly records: readonly (DecisionRecord | undefined)[];
    /** The viewer's choices on the case. */
    readonly choice: CaseChoice;
    /** Whether the card is open. */
    readonly open: boolean;
    /** Which of a verdict's parts the app's rows hold. */
    readonly roles: DecisionRoles;
    /** Takes no choice and no verdict: the card is read, its foot left out. */
    readonly readOnly: boolean;
    /** The time the due words count from. */
    readonly now: Date;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** The `decisionQueue` recipe's styles. */
    readonly styles: SlotStyles;
    /** The queue's editing: the rows the chosen option's change touches, as they stand, are read through it. */
    readonly schedule: ScheduleEditing;
    /** The rows every waiting case's chosen option changes: an entry's `+N` (P18). */
    readonly shared: SharedRows;
    /** Opens the card, or closes it. */
    readonly onToggle: (key: string) => void;
    /** Changes some of the card's choices, from its choices as they stand. */
    readonly onChoice: (key: string, next: (was: CaseChoice) => Partial<CaseChoice>) => void;
    /** Takes a decision: the decision, and the card's height, which its receipt arrives from. */
    readonly onDecide: (d: Decided, from: number) => void;
}

/**
 * A case's card (see the module docs).
 *
 * @param props - The case, the targets and their records, the viewer's choices, and where a choice and a verdict go ({@link DecisionCardProps})
 * @returns The card
 */
export const DecisionCard = memo(function DecisionCard({
    c, targets, records, choice, open, roles, readOnly, now, words, styles, schedule, shared, onToggle, onChoice, onDecide,
}: DecisionCardProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const ids = useId();
    const cardRef = useRef<HTMLDivElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const overrideRef = useRef<HTMLButtonElement | null>(null);
    const view = useMemo(() => cardView(c, choice, roles.answer), [c, choice, roles.answer]);
    const option = view.option;
    const id = view.id;
    const format = getSomeorUndefined(c.format);
    const at = option === undefined ? -1 : targetOf(targets, option.change.tag);
    const target = at < 0 ? undefined : targets[at];
    const record = at < 0 ? undefined : records[at];

    // The rows the chosen option's change leaves — tracked, so a row's read landing reads them again; Retry asks the
    // record again.
    const [attempt, setAttempt] = useState(0);
    const readRows = useCallback((): AppliedRows => {
        void attempt;
        return option === undefined ? NO_OPTION : appliedRows(schedule, target, record, option);
    }, [schedule, target, record, option, attempt]);
    const { result } = useTrackedEvaluation(readRows);
    useEffect(() => {
        if (!result.ok) console.error(`[DecisionQueue] the rows case ${c.key}'s change touches could not be read:`, result.error);
    }, [result, c.key]);
    const rows: RowsState = result.ok ? result.value.state : "failed";
    const changed = useMemo(() => (result.ok && result.value.state === "ready" ? changedRows(result.value.rows, result.value.standing, view.edits) : NO_ROWS),
        [result, view.edits]);
    const retry = useCallback(() => {
        if (record !== undefined && record.entries.type === "some") record.entries.value.refresh(none);
        setAttempt(n => n + 1);
    }, [record]);

    const status = cardStatus(view, rows === "stale");
    const off = applyOff(view, rows, false);
    const due = dueWords(c.due, now);
    const section = sectionOf(c.due, now);
    const dueText = due === undefined ? undefined
        : due.kind === "late" ? m.late({ amount: words.number(due.amount), unit: due.unit })
            : due.kind === "time" ? m.by({ when: words.time(due.at) })
                : m.by({ when: `${words.weekday(due.at)} ${words.number(due.at.getUTCDate())}` });
    const icon = target === undefined ? undefined : iconOf(target.icon);
    const title = c.options[view.recommended]?.title ?? "";
    // The chosen option's label once the viewer has chosen another, else its summary (R15).
    const summary = option === undefined ? "" : view.chosen !== view.recommended ? option.label : option.summary;
    const value = option === undefined ? undefined : words.value(option.value, format, true);

    const toggle = useCallback(() => onToggle(c.key), [onToggle, c.key]);
    const onHeadKey = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        takeKey(e);
        toggle();
    }, [toggle]);
    const choose = useCallback((next: (was: CaseChoice) => Partial<CaseChoice>) => onChoice(c.key, next), [onChoice, c.key]);

    // ── The verdicts ──────────────────────────────────────────────────────────
    const decide = (verdict: DecisionVerdictWord, written: ReadonlyMap<string, Uint8Array | undefined> | undefined,
        reason?: DecisionReasonWord, note?: string) => {
        onDecide({
            c, option, verdict, answer: view.answer, reason, note: note ?? choice.note,
            rows: record !== undefined && written !== undefined && written.size > 0 ? { record, rows: written } : undefined,
        }, cardRef.current?.offsetHeight ?? 0);
    };
    const apply = () => {
        if (off !== undefined) return;
        decide("applied", rows === "ready" ? writtenRows(changed) : undefined);
    };
    const defer = () => decide(view.call === "handoff" ? "handedOff" : "deferred", undefined);
    const overrideText = choice.overrideNote ?? "";
    const overrideOk = !roles.reason || (choice.reason !== undefined && (choice.reason !== "other" || overrideText.trim().length > 0));
    const override = () => {
        if (!overrideOk) return;
        decide("overridden", rows === "ready" ? overrideRows(changed) : undefined, choice.reason,
            overrideText.trim().length > 0 ? overrideText : choice.note);
    };
    const cancelOverride = () => {
        choose(() => ({ panel: undefined, reason: undefined, overrideNote: undefined }));
        overrideRef.current?.focus();
    };

    // ── Modify ────────────────────────────────────────────────────────────────
    // Its form edits each row the change touches, by its record's fields; with none to edit, Modify goes to the options.
    const canEdit = record !== undefined && record.fields.length > 0 && rows === "ready" && changed.length > 0;
    const modifyOff = !canEdit && c.options.length <= 1;
    const modify = () => {
        if (canEdit) {
            choose(was => ({ panel: was.panel === "edit" ? undefined : "edit" }));
            return;
        }
        listRef.current?.querySelector<HTMLElement>("[role=option][tabindex='0']")?.focus();
    };
    const setEdit = useCallback((key: string, edit: RowEdit | undefined) => {
        if (id === undefined) return;
        choose(was => {
            const edits: Record<string, RowEdit> = { ...was.edits?.[id] };
            if (edit === undefined) delete edits[key];
            else edits[key] = edit;
            return { edits: { ...was.edits, [id]: edits } };
        });
    }, [choose, id]);
    const resetAll = useCallback(() => {
        if (id === undefined) return;
        choose(was => ({ edits: { ...was.edits, [id]: {} } }));
    }, [choose, id]);

    // Esc takes back the override's form, unless a field of the Edit panel's form puts its own typing back.
    const onCardKey = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== "Escape" || choice.panel !== "override") return;
        if (e.target instanceof Element && e.target.closest("[data-field-form]") !== null) return;
        takeKey(e);
        cancelOverride();
    };

    const sub = option === undefined ? undefined : valueSub(c, view);
    const subText = sub === undefined ? undefined
        : sub.kind === "edited" ? m.valueSub({ kind: "edited" })
            : sub.kind === "proposal" ? m.valueSub({ kind: "proposal", value: words.value(sub.value, format, true) })
                : sub.kind === "only" ? m.valueSub({ kind: "only" })
                    : m.valueSub({ kind: "next", difference: words.value(sub.difference, format, true) });
    const ifWrong = getSomeorUndefined(c.ifWrong);
    const confidence = option === undefined ? undefined : getSomeorUndefined(option.confidence);
    const question = option === undefined ? undefined : getSomeorUndefined(option.question);
    const warn = option === undefined ? undefined : getSomeorUndefined(option.warn);
    const panel = choice.panel;

    return (
        <Box ref={cardRef} css={styles.card} data-decision-card={c.key} data-open={flag(open)} onKeyDown={onCardKey}>
            <Box css={styles.head} role="button" tabIndex={0} aria-expanded={open} data-decision-head={c.key}
                data-open={flag(open)} data-modified={flag(view.modified)} onClick={toggle} onKeyDown={onHeadKey}>
                <Box css={styles.eyebrow}>
                    <Box as="span" css={styles.eyebrowIcon} aria-hidden="true">{icon !== undefined && <FontAwesomeIcon icon={icon} />}</Box>
                    <Box as="span" css={styles.eyebrowText}>{target === undefined ? c.scope : `${target.name} · ${c.scope}`}</Box>
                    {dueText !== undefined && (
                        <Box as="span" css={styles.due} data-tone={section === "overdue" || section === "today" ? section : undefined}>{dueText}</Box>
                    )}
                </Box>
                <Box css={styles.headTitle}><Figured text={title} /></Box>
                {target !== undefined && option !== undefined && (
                    <DecisionPreview c={c} view={view} target={target} record={record} rows={rows} changed={changed} schedule={schedule} shared={shared}
                        words={words} />
                )}
                <Box css={styles.chipLine}>
                    <Box as="span" css={styles.proposal}>{m.chip({ modified: view.modified })}</Box>
                    <Box as="span" css={styles.summary}>{summary}</Box>
                </Box>
                <Box css={styles.valueLine}>
                    {value !== undefined && <Box as="span" css={styles.value} data-modified={flag(view.modified)}>{value}</Box>}
                    <Box as="span" css={styles.unit}>{c.unit}</Box>
                    {status !== undefined && (
                        <Box as="span" css={styles.status} data-tone={STATUS_TONES[status]}>
                            <Box as="span" css={styles.statusDot} data-tone={STATUS_TONES[status]} aria-hidden="true" />
                            {m.status({ status })}
                        </Box>
                    )}
                </Box>
            </Box>
            {open && (
                <Box css={styles.body}>
                    <Box css={styles.bodyClip}>
                        <Box css={styles.bodyInner}>
                            {c.options.length > 1 && (
                                <OptionsPart c={c} view={view} format={format} readOnly={readOnly} words={words} styles={styles}
                                    labelId={`${ids}-options`} listRef={listRef} onChoose={i => choose(() => ({ option: i === view.recommended ? undefined : optionId(c.options[i]!) }))} />
                            )}
                            {option !== undefined && (
                                <Box css={styles.part}>
                                    <Box css={styles.partHead}><Box as="span" css={styles.partLabel}>{m.change()}</Box></Box>
                                    <Box css={styles.change}><Figured text={option.detail} /></Box>
                                    {rows === "failed" && <LoadingFailedLine message={m.applyOff({ why: "failed" })} retry={{ onRetry: retry }} />}
                                </Box>
                            )}
                            <Box css={styles.figures}>
                                <Box css={styles.figure}>
                                    <Box as="span" css={styles.figureLabel}>{c.unit}</Box>
                                    {value !== undefined && <Box as="span" css={styles.figureValue} data-modified={flag(view.modified)}>{value}</Box>}
                                    {subText !== undefined && <Box as="span" css={styles.figureSub}>{subText}</Box>}
                                </Box>
                                <Box css={styles.figure}>
                                    <Box as="span" css={styles.figureLabel}>{m.figure({ figure: "ifWrong" })}</Box>
                                    {ifWrong !== undefined
                                        ? <Box as="span" css={styles.figureValue} data-tone="neg">{words.value(ifWrong, format, true)}</Box>
                                        : <Box as="span" css={styles.figureValue} data-empty="">{m.noData()}</Box>}
                                </Box>
                                <Box css={styles.figure}>
                                    <Box as="span" css={styles.figureLabel}>{m.figure({ figure: "confidence" })}</Box>
                                    {confidence !== undefined
                                        ? <Box as="span" css={styles.figureValue}>{words.value(confidence, TWO_PLACES)}</Box>
                                        : <Box as="span" css={styles.figureValue} data-empty="">{m.noData()}</Box>}
                                </Box>
                            </Box>
                            {view.call !== undefined && question !== undefined && (
                                <CallPart state={view.call} question={question} answer={view.answer} readOnly={readOnly} words={words} styles={styles}
                                    questionId={`${ids}-question`} onAnswer={answer => {
                                        if (id !== undefined) choose(was => ({ answers: { ...was.answers, [id]: answer } }));
                                    }} />
                            )}
                            {view.malformed && <WarnPart text={m.malformed()} words={words} styles={styles} />}
                            {warn !== undefined && <WarnPart text={warn} words={words} styles={styles} />}
                            <Box css={styles.part}>
                                <WhyPart c={c} words={words} styles={styles} />
                                {roles.note && (
                                    <NotePart note={choice.note ?? ""} readOnly={readOnly} words={words} styles={styles} onNote={note => choose(() => ({ note }))} />
                                )}
                            </Box>
                        </Box>
                        {!readOnly && (
                            <Box css={styles.actions}>
                                <Box css={styles.actionRow} role="group" aria-label={m.actions()}>
                                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} onClick={defer}>
                                        {m.action({ action: view.call === "handoff" ? "handOff" : "defer" })}
                                    </chakra.button>
                                    <chakra.button ref={overrideRef} type="button" css={button({ variant: "outline", size: "xs" })} aria-pressed={panel === "override"}
                                        onClick={() => choose(was => ({ panel: was.panel === "override" ? undefined : "override" }))}>
                                        {m.action({ action: "override" })}
                                    </chakra.button>
                                    <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} aria-pressed={panel === "edit" && canEdit}
                                        aria-disabled={modifyOff || undefined} onClick={modifyOff ? undefined : modify}>
                                        {m.action({ action: "modify" })}
                                    </chakra.button>
                                    <chakra.button type="button" css={button({ variant: "solid", size: "xs" })} aria-disabled={off !== undefined || undefined}
                                        title={off === undefined ? undefined : m.applyOff({ why: off })} onClick={apply}>
                                        {m.action({ action: view.edited ? "applyEdits" : "apply" })}
                                    </chakra.button>
                                </Box>
                                {(panel === "edit" || panel === "override") && canEdit && record !== undefined && (
                                    <EditPanel changed={changed} record={record} override={panel === "override"} words={words} styles={styles}
                                        onEdit={setEdit} onResetAll={resetAll} />
                                )}
                                {panel === "override" && (
                                    <OverridePanel choice={choice} roles={roles} ok={overrideOk} words={words} styles={styles}
                                        onChoice={choose} onCancel={cancelOverride} onOverride={override} />
                                )}
                            </Box>
                        )}
                    </Box>
                </Box>
            )}
        </Box>
    );
});

/** Props of {@link OptionsPart}. */
interface OptionsPartProps {
    readonly c: DecisionCase;
    readonly view: CardView;
    readonly format: TickFormatOpt;
    readonly readOnly: boolean;
    readonly words: DecisionQueueWords;
    readonly styles: SlotStyles;
    readonly labelId: string;
    readonly listRef: RefObject<HTMLDivElement | null>;
    readonly onChoose: (index: number) => void;
}

/**
 * The options (R14): a listbox, one tab stop — the chosen option, until the arrows move along it — each option its
 * mark, its label and line, and its value; the recommended one's line says so before its note, and a refused one is
 * off, its reason on its line.
 */
function OptionsPart({ c, view, format, readOnly, words, styles, labelId, listRef, onChoose }: OptionsPartProps) {
    const { m } = words;
    const [at, setAt] = useState<number | undefined>(undefined);
    const stop = at !== undefined && at < c.options.length ? at : view.chosen;
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const last = c.options.length - 1;
        const next = e.key === "ArrowDown" ? Math.min(last, stop + 1) : e.key === "ArrowUp" ? Math.max(0, stop - 1)
            : e.key === "Home" ? 0 : e.key === "End" ? last : undefined;
        if (next === undefined) return;
        takeKey(e);
        setAt(next);
        listRef.current?.querySelectorAll<HTMLElement>("[role=option]")[next]?.focus();
    };
    return (
        <Box css={styles.part}>
            <Box css={styles.partHead}>
                <Box as="span" css={styles.partLabel} id={labelId}>{m.options({ n: words.number(c.options.length) })}</Box>
            </Box>
            <Box ref={listRef} css={styles.options} role="listbox" aria-labelledby={labelId} aria-readonly={readOnly || undefined} onKeyDown={onKeyDown}>
                {c.options.map((o, i) => {
                    const refused = getSomeorUndefined(o.refused);
                    const note = getSomeorUndefined(o.note);
                    const line = refused !== undefined ? m.refused({ reason: refused }) : i === view.recommended ? m.recommendedLine({ note }) : note;
                    const chosen = i === view.chosen;
                    return (
                        <chakra.button key={optionId(o)} type="button" css={styles.option} role="option" aria-selected={chosen}
                            aria-disabled={refused !== undefined || undefined} tabIndex={i === stop ? 0 : -1} onFocus={() => setAt(i)}
                            onClick={() => { if (refused === undefined && !readOnly && !chosen) onChoose(i); }}>
                            <Box as="span" css={styles.optionMark} data-refused={flag(refused !== undefined)} aria-hidden="true">
                                {refused !== undefined ? <FontAwesomeIcon icon={faBan} /> : chosen ? <FontAwesomeIcon icon={faCheck} /> : null}
                            </Box>
                            <Box as="span" css={styles.optionText}>
                                <Box as="span" css={styles.optionLabel} data-refused={flag(refused !== undefined)}>{o.label}</Box>
                                {line !== undefined && (
                                    <Box as="span" css={styles.optionLine} data-tone={refused !== undefined || o.warn.type === "some" ? "warn" : undefined}>{line}</Box>
                                )}
                            </Box>
                            {refused === undefined && <Box as="span" css={styles.optionValue}>{words.value(o.value, format, true)}</Box>}
                        </chakra.button>
                    );
                })}
            </Box>
        </Box>
    );
}

/** Props of {@link CallPart}. */
interface CallPartProps {
    readonly state: CallState;
    readonly question: string;
    readonly answer: DecisionAnswerWord | undefined;
    readonly readOnly: boolean;
    readonly words: DecisionQueueWords;
    readonly styles: SlotStyles;
    readonly questionId: string;
    readonly onAnswer: (answer: DecisionAnswerWord) => void;
}

/** Your call (R16): the chosen option's question, its answers — the shared radio group, named by the question — and what the answer does. */
function CallPart({ state, question, answer, readOnly, words, styles, questionId, onAnswer }: CallPartProps) {
    const { m } = words;
    const tone = CALL_TONES[state];
    return (
        <Box css={styles.call} data-tone={tone}>
            <Box as="span" css={styles.callIcon} data-tone={tone} aria-hidden="true"><FontAwesomeIcon icon={CALL_ICONS[state]} /></Box>
            <Box css={styles.callBody}>
                <Box as="span" css={styles.callWord} data-tone={tone}>{m.call({ state })}</Box>
                <Box css={styles.callQuestion} id={questionId}>{question}</Box>
                <EastChakraRadioGroup labelledBy={questionId} value={{
                    ...RADIO,
                    value: answer ?? "",
                    items: ANSWERS.map(a => ({ value: a, label: some(m.answer({ answer: a })), disabled: none })),
                    disabled: readOnly ? some(true) : none,
                    onChange: some((next: string) => {
                        const word = ANSWERS.find(a => stringEqual(a, next));
                        if (word !== undefined) onAnswer(word);
                        return null;
                    }),
                    style: ANSWERS_STYLE,
                }} />
                <Box css={styles.callHelp}>{m.callHelp({ state })}</Box>
            </Box>
        </Box>
    );
}

/** A warning (R17, §12): the box in the warning's tone, its word and its text. */
function WarnPart({ text, words, styles }: { readonly text: string; readonly words: DecisionQueueWords; readonly styles: SlotStyles }) {
    return (
        <Box css={styles.call} data-tone="warn">
            <Box as="span" css={styles.callIcon} data-tone="warn" aria-hidden="true"><FontAwesomeIcon icon={faTriangleExclamation} /></Box>
            <Box css={styles.callBody}>
                <Box as="span" css={styles.callWord} data-tone="warn">{words.m.warning()}</Box>
                <Box css={styles.callText}>{text}</Box>
            </Box>
        </Box>
    );
}

/** Why (R18): a toggle over the model's line, and its paragraph while open. */
function WhyPart({ c, words, styles }: { readonly c: DecisionCase; readonly words: DecisionQueueWords; readonly styles: SlotStyles }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    return (
        <>
            <chakra.button type="button" css={styles.why} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
                <Box as="span" css={styles.chevron} data-open={flag(open)} aria-hidden="true"><FontAwesomeIcon icon={faChevronRight} /></Box>
                <Box as="span" css={styles.toggleLabel}>{words.m.why()}</Box>
                <Box as="span" css={styles.whyModel}>{c.model}</Box>
            </chakra.button>
            {open && <Box as="p" id={id} css={styles.whyText}><Figured text={c.why} /></Box>}
        </>
    );
}

/** Props of {@link NotePart}. */
interface NotePartProps {
    readonly note: string;
    readonly readOnly: boolean;
    readonly words: DecisionQueueWords;
    readonly styles: SlotStyles;
    readonly onNote: (note: string) => void;
}

/**
 * The note (R18): `Add a note`, which opens the shared textarea and puts the keyboard in it; open while it holds text.
 * Read only, it shows only a note that holds text.
 */
function NotePart({ note, readOnly, words, styles, onNote }: NotePartProps) {
    const { m } = words;
    const [opened, setOpened] = useState(false);
    const box = useRef<HTMLDivElement | null>(null);
    const focus = useRef(false);
    useEffect(() => {
        if (!focus.current) return;
        focus.current = false;
        box.current?.querySelector("textarea")?.focus();
    });
    const filled = note.length > 0;
    if (!opened && !filled) {
        if (readOnly) return null;
        return (
            <chakra.button type="button" css={styles.link} onClick={() => { focus.current = true; setOpened(true); }}>{m.addNote()}</chakra.button>
        );
    }
    return (
        <Box ref={box} css={styles.note} data-filled={flag(filled)}>
            <ChakraField.Root readOnly={readOnly}>
                <VisuallyHidden><ChakraField.Label>{m.note()}</ChakraField.Label></VisuallyHidden>
                <EastChakraTextarea value={{
                    ...TEXTAREA,
                    value: note,
                    rows: NOTE_ROWS,
                    placeholder: some(m.notePlaceholder()),
                    readOnly: readOnly ? some(true) : none,
                    onChange: some((next: string) => { onNote(next); return null; }),
                    style: NOTE_STYLE,
                }} />
            </ChakraField.Root>
        </Box>
    );
}

/** Props of {@link EditPanel}. */
interface EditPanelProps {
    readonly changed: readonly ChangedRow[];
    readonly record: DecisionRecord;
    readonly override: boolean;
    readonly words: DecisionQueueWords;
    readonly styles: SlotStyles;
    readonly onEdit: (key: string, edit: RowEdit | undefined) => void;
    readonly onResetAll: () => void;
}

/**
 * Modify's Edit panel (R19) — `Your decision` under Override (R20): each row the change touches, its form over its
 * record's fields as the change leaves it, a field the viewer changed tinted with its Reset to the proposal, and Keep as
 * it is; how many changes the viewer made, and Reset all.
 */
function EditPanel({ changed, record, override, words, styles, onEdit, onResetAll }: EditPanelProps) {
    const { m } = words;
    const id = useId();
    const codec = rowCodec(record.editing.entryType);
    const equals = useMemo(() => record.fields.map(spec => equalFor(fromEastTypeValue(spec.type) as EastType) as (a: unknown, b: unknown) => boolean),
        [record.fields]);
    // The form's words: the queue's formatters, and its Reset in the queue's words.
    const formWords = useMemo((): FieldFormWords => ({ ...words, m: { ...fieldFormMessages, reset: ({ label }) => m.resetField({ field: label }) } }), [words, m]);
    // Each field the viewer changed from the proposal, and each row kept as it stands.
    let count = 0;
    for (const row of changed) {
        if (row.edit === undefined) continue;
        if ("keep" in row.edit || row.proposed === undefined) {
            count += 1;
            continue;
        }
        const edited = codec.decode(bytesOf(row.edit.row));
        const proposed = codec.decode(row.proposed);
        record.fields.forEach((spec, i) => { if (!equals[i]!(fieldAt(edited, spec.path), fieldAt(proposed, spec.path))) count += 1; });
    }
    return (
        <Box css={styles.panel} role="group" aria-labelledby={id}>
            <Box css={styles.panelHead}>
                <Box as="span" css={styles.panelTitle} id={id}>{m.editTitle({ override })}</Box>
                <Box as="span" css={styles.panelMeta}>{m.editMeta({ changed: count > 0 ? words.number(count) : undefined, override })}</Box>
                {changed.some(row => row.edit !== undefined) && (
                    <chakra.button type="button" css={styles.link} onClick={onResetAll}>{m.resetAll()}</chakra.button>
                )}
            </Box>
            {changed.map(row => (
                <EditRow key={row.key} row={row} record={record} codec={codec} words={words} formWords={formWords} styles={styles} onEdit={onEdit} />
            ))}
        </Box>
    );
}

/** Props of {@link EditRow}. */
interface EditRowProps {
    readonly row: ChangedRow;
    readonly record: DecisionRecord;
    readonly codec: RowCodec;
    readonly words: DecisionQueueWords;
    readonly formWords: FieldFormWords;
    readonly styles: SlotStyles;
    readonly onEdit: (key: string, edit: RowEdit | undefined) => void;
}

/**
 * One row the change touches (R19): its key — or, for one the change removes, that it is removed — Keep as it is, and
 * the form: the row as the viewer left it over the row as the change leaves it, or, kept, the row as it stands, read
 * only. An edit that puts the row back as the change leaves it is no edit.
 */
function EditRow({ row, record, codec, words, formWords, styles, onEdit }: EditRowProps) {
    const { m } = words;
    const kept = row.edit !== undefined && "keep" in row.edit;
    const editedBytes = row.edit !== undefined && "row" in row.edit ? row.edit.row : undefined;
    const proposed = useMemo(() => (row.proposed === undefined ? undefined : codec.decode(row.proposed)), [codec, row.proposed]);
    const standing = useMemo(() => (row.standing === undefined ? undefined : codec.decode(row.standing)), [codec, row.standing]);
    const edited = useMemo(() => (editedBytes === undefined ? undefined : codec.decode(bytesOf(editedBytes))), [codec, editedBytes]);
    const current = edited ?? proposed;
    const write = useCallback((next: unknown) => {
        const bytes = codec.encode(next);
        onEdit(row.key, sameRow(bytes, row.proposed) ? undefined : { row: keptBytes(bytes) });
    }, [codec, onEdit, row.key, row.proposed]);
    const onChange = useCallback((path: readonly string[], value: unknown) => write(withField(current, path, value)), [write, current]);
    const onReset = useCallback((path: readonly string[]) => write(withField(current, path, fieldAt(proposed, path))), [write, current, proposed]);
    return (
        <Box css={styles.part} data-decision-row={row.key}>
            <Box css={styles.panelHead}>
                <Box as="span" css={styles.panelMeta}>{row.proposed === undefined ? m.removedRow({ name: row.key }) : row.key}</Box>
                <EastChakraCheckbox value={{
                    ...CHECKBOX,
                    checked: kept,
                    label: some(m.keepAsIs()),
                    onChange: some((next: boolean) => { onEdit(row.key, next ? KEEP : undefined); return null; }),
                }} />
            </Box>
            {kept
                ? standing !== undefined && <FieldForm specs={record.fields} value={standing} readOnly words={formWords} onChange={NO_CHANGE} />
                : current !== undefined && <FieldForm specs={record.fields} value={current} baseline={proposed} words={formWords} onChange={onChange} onReset={onReset} />}
        </Box>
    );
}

/** Props of {@link OverridePanel}. */
interface OverridePanelProps {
    readonly choice: CaseChoice;
    readonly roles: DecisionRoles;
    readonly ok: boolean;
    readonly words: DecisionQueueWords;
    readonly styles: SlotStyles;
    readonly onChoice: (next: (was: CaseChoice) => Partial<CaseChoice>) => void;
    readonly onCancel: () => void;
    readonly onOverride: () => void;
}

/**
 * Override's panel (R20): why — the reasons, where the verdicts hold one, Other only where they hold a note too — the
 * note, and Cancel and Override case, which waits for a reason, and for Other its note.
 */
function OverridePanel({ choice, roles, ok, words, styles, onChoice, onCancel, onOverride }: OverridePanelProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const id = useId();
    const text = choice.overrideNote ?? "";
    const reasons = roles.note ? REASONS : REASONS_NO_NOTE;
    return (
        <Box css={styles.panel} role="group" aria-labelledby={id}>
            <Box as="span" css={styles.panelTitle} id={id}>{m.whyOverride()}</Box>
            {roles.reason && (
                <Box css={styles.overrideKinds}>
                    <EastChakraRadioGroup labelledBy={id} value={{
                        ...RADIO,
                        value: choice.reason ?? "",
                        items: reasons.map(r => ({ value: r, label: some(m.reason({ reason: r })), disabled: none })),
                        onChange: some((next: string) => {
                            const reason = reasons.find(r => stringEqual(r, next));
                            if (reason !== undefined) onChoice(() => ({ reason }));
                            return null;
                        }),
                        style: REASONS_STYLE,
                    }} />
                </Box>
            )}
            {roles.note && (
                <Box css={styles.note} data-filled={flag(text.length > 0)}>
                    <ChakraField.Root>
                        <VisuallyHidden><ChakraField.Label>{m.overrideNote()}</ChakraField.Label></VisuallyHidden>
                        <EastChakraStringInput value={{
                            ...STRING_INPUT,
                            value: text,
                            placeholder: some(m.overridePlaceholder({ other: choice.reason === "other" })),
                            onChange: some((next: string) => { onChoice(() => ({ overrideNote: next })); return null; }),
                            style: INPUT_STYLE,
                        }} />
                    </ChakraField.Root>
                </Box>
            )}
            <Box css={styles.actionRow}>
                <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} onClick={onCancel}>{m.cancel()}</chakra.button>
                <chakra.button type="button" css={button({ variant: "solid", size: "xs" })} aria-disabled={!ok || undefined} onClick={onOverride}>
                    {m.overrideCase()}
                </chakra.button>
            </Box>
        </Box>
    );
}

/** Props of {@link DecisionReceipt}. */
export interface DecisionReceiptProps {
    /** The case's key. */
    readonly caseKey: string;
    /** What was decided. */
    readonly verdict: DecisionVerdictWord;
    /** The option's title, as the card showed it. */
    readonly title: string;
    /** The card's height, which the receipt arrives from. */
    readonly from: number;
    /** Whether its step is the history's last, so its Undo takes it back. */
    readonly undo: boolean;
    /** The queue's words. */
    readonly words: DecisionQueueWords;
    /** The `decisionQueue` recipe's styles. */
    readonly styles: SlotStyles;
    /** Takes the verdict back. */
    readonly onUndo: (key: string) => void;
    /** Called once it has left. */
    readonly onGone: (key: string) => void;
}

/**
 * The receipt a verdict leaves where its card stood (R25–R28): its dot and verdict in the verdict's tone, the option's
 * title, and Undo while its step is the history's last. It arrives from the card's height and stays its time — on
 * while pointed at or focused — then leaves (`useReceiptHold`).
 *
 * @param props - The verdict, and what Undo and its leaving do ({@link DecisionReceiptProps})
 * @returns The receipt
 */
export const DecisionReceipt = memo(function DecisionReceipt({ caseKey, verdict, title, from, undo, words, styles, onUndo, onGone }: DecisionReceiptProps) {
    const gone = useCallback(() => onGone(caseKey), [onGone, caseKey]);
    const hold = useReceiptHold(gone);
    return (
        <Box css={styles.receipt} role="status" data-decision-receipt={caseKey} data-leaving={flag(hold.leaving)}
            style={{ "--receipt-from": `${from}px` } as CSSProperties} {...hold.props}>
            <Box as="span" css={styles.receiptDot} data-verdict={verdict} aria-hidden="true" />
            <Box as="span" css={styles.receiptVerdict} data-verdict={verdict}>{words.m.verdict({ verdict })}</Box>
            <Box as="span" css={styles.receiptTitle}>{title}</Box>
            {undo && <chakra.button type="button" css={styles.receiptUndo} onClick={() => onUndo(caseKey)}>{words.m.undo()}</chakra.button>}
        </Box>
    );
});
