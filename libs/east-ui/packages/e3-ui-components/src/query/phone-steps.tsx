/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Query view on a phone (`Query Builder Phone Spec.md` QP20–QP29), #934's
 * cards as sentences: each row of a step is one sentence in a 44 row, a tap opens
 * its slots under it as full-width rows, and one clause is open at a time across
 * the query. A step's actions open inline under ⋯. Over them the band (Visual ·
 * jq and Copy jq) and the query's head; under them the foot, its check and what
 * the query gives, Save… and Run. A slot's choices are the builder's
 * `SlotAutocomplete`, a full-height view here. Nothing floats.
 *
 * @packageDocumentation
 */

import { Fragment, memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Box, Button, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { faArrowDown, faArrowUp, faCaretDown, faCheck, faChevronDown, faCircleExclamation, faCode, faDatabase, faDiagramProject, faEllipsis, faPlay, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import { BannerView } from "@elaraai/east-ui-components";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { JqEditor } from "./jq-editor.js";
import type { Card, CardLine, CardPart, ProblemLine } from "./model/cards.js";
import type { SlotRef } from "./model/refs.js";
import { slotLabel } from "./model/slots.js";
import { InputPart, slotKey, type PartActions, type PartStyles } from "./parts.js";
import type { QueryNotice } from "./use-query-editor.js";
import type { QueryEditor } from "./use-query-editor.js";
import { useCopy } from "./toolbar.js";
import type { QuerySaveLine } from "./status-line.js";

type Styles = ReturnType<typeof useSlotStyles>;

/** What a sentence reads of a part; none for what only its editor holds. */
function sentencePart(part: CardPart, i: number, styles: Styles): ReactNode {
    switch (part.t) {
        case "word":
            return part.joiner === true ? null : <Box as="span" key={i} css={styles.clauseWord}>{part.text} </Box>;
        case "slot":
            // The field and the value 500 in ink; what compares them in the words' ink (QP24).
            return part.empty
                ? <Box as="span" key={i} css={styles.clauseEmpty}>{part.placeholder} </Box>
                : part.slot.kind === "cmp" ? <Box as="span" key={i} css={styles.clauseWord}>{part.text} </Box>
                : <Box as="span" key={i} css={styles.clauseValue} data-mono={part.mono ? "" : undefined}>{part.text} </Box>;
        case "input":
            return part.value === "" ? null : <Box as="span" key={i} css={styles.clauseValue} data-mono={part.mono ? "" : undefined}>{part.value} </Box>;
        case "chip":
            return <Box as="span" key={i} css={styles.clauseValue}>{part.text} </Box>;
        default:
            return null;
    }
}

/** A problem under its clause: the checker's words and its fix (QP26). */
function PhoneProblems({ problems, styles, actions }: { problems: readonly ProblemLine[]; styles: Styles; actions: PartActions }): ReactNode {
    return problems.map((problem, i) => (
        <Box key={i} css={styles.problem} data-severity={problem.severity} data-query-problem={problem.code}>
            <Box css={styles.problemLine}>
                <Box as="span" css={styles.problemIcon} aria-hidden><FontAwesomeIcon icon={faCircleExclamation} /></Box>
                <span>{problem.text}</span>
            </Box>
            {problem.fixes.map((fix, j) => (
                <Button key={j} size="md" variant="outline" css={styles.problemFix} data-query-fix="" onClick={() => actions.onFix(fix.fix, fix.label)}>{fix.label}</Button>
            ))}
        </Box>
    ));
}

/** A slot's row in an open clause: its label, then its trigger (QP25). */
function SlotRow({ part, ps, actions, styles, dirty }: { part: Extract<CardPart, { t: "slot" }>; ps: PartStyles; actions: PartActions; styles: Styles; dirty: boolean }) {
    const key = slotKey(part.slot);
    return (
        <Box css={styles.slotRow}>
            <Box as="span" css={styles.slotLabel}>{slotLabel(part.slot, ps.words)}</Box>
            <chakra.button type="button" css={styles.slotTrigger} data-slot-key={key} data-empty={part.empty ? "" : undefined} data-error={part.error ? "" : undefined} data-dirty={dirty ? "" : undefined}
                data-mono={part.mono ? "" : undefined} aria-haspopup="dialog" aria-expanded={actions.openSlot === key}
                onClick={(event) => actions.onSlot(part.slot, event.currentTarget)}>
                <span>{part.empty ? part.placeholder : part.text}</span>
                <FontAwesomeIcon icon={faCaretDown} aria-hidden />
            </chakra.button>
        </Box>
    );
}

/** Whether a row has anything to open. */
function editable(parts: readonly CardPart[]): boolean {
    return parts.some((p) => p.t === "slot" || p.t === "input" || p.t === "chip" || p.t === "remove");
}

/** Props of {@link Clause}. */
interface ClauseProps {
    readonly id: string;
    readonly parts: readonly CardPart[];
    readonly problems: readonly ProblemLine[];
    readonly open: string | undefined;
    readonly onOpen: (id: string | undefined) => void;
    readonly ps: PartStyles;
    readonly actions: PartActions;
    /** Whether a slot's value differs from what the query saved holds (QP25). */
    readonly isDirty: (key: string, text: string) => boolean;
}

/** One clause: its sentence in a 44 row, and, open, its slots under it (QP24, QP25). */
function Clause({ id, parts, problems, open, onOpen, ps, actions, isDirty }: ClauseProps) {
    const styles = useSlotStyles("queryPhone");
    const joiner = parts.find((p): p is Extract<CardPart, { t: "word" }> => p.t === "word" && p.joiner === true);
    const isOpen = open === id;
    const adds = parts.filter((p): p is Extract<CardPart, { t: "add" }> => p.t === "add");
    if (!editable(parts)) {
        return (
            <Box css={styles.clauseStatic} data-query-clause="">
                <Box css={styles.clauseRead}>{joiner !== undefined && <Box as="span" css={styles.clauseJoiner}>{joiner.text}</Box>}<Box as="span" css={styles.clauseText}>{parts.map((p, i) => sentencePart(p, i, styles))}</Box></Box>
                {adds.map((add, i) => (
                    <chakra.button key={i} type="button" css={styles.addLink} onClick={(event) => actions.onAction(add.action, event.currentTarget)}>
                        <FontAwesomeIcon icon={faPlus} />{add.text}
                    </chakra.button>
                ))}
                <PhoneProblems problems={problems} styles={styles} actions={actions} />
            </Box>
        );
    }
    return (
        <Box data-query-clause="" data-open={isOpen ? "" : undefined}>
            <chakra.button type="button" css={styles.clause} aria-expanded={isOpen} onClick={() => onOpen(isOpen ? undefined : id)}>
                <Box css={styles.clauseRead}>
                    <Box as="span" css={styles.clauseJoiner}>{joiner?.text}</Box>
                    <Box as="span" css={styles.clauseText}>{parts.map((p, i) => sentencePart(p, i, styles))}</Box>
                </Box>
                <Box as="span" css={styles.clauseChevron} data-open={isOpen ? "" : undefined} aria-hidden><FontAwesomeIcon icon={faChevronDown} /></Box>
            </chakra.button>
            {isOpen && (
                <Box css={styles.clauseEditor} data-query-clause-editor="">
                    {parts.map((part, i) => {
                        switch (part.t) {
                            case "slot": return <SlotRow key={i} part={part} ps={ps} actions={actions} styles={styles} dirty={isDirty(slotKey(part.slot), part.text)} />;
                            case "input": return (
                                <Box key={i} css={styles.slotRow}>
                                    <Box as="span" css={styles.slotLabel}>{ps.words.messages.inputLabel({ input: part.input.kind })}</Box>
                                    <Box css={styles.slotField}><InputPart part={part} ps={ps} actions={actions} /></Box>
                                </Box>
                            );
                            case "chip": return (
                                <chakra.button key={i} type="button" css={styles.removeLink} onClick={() => actions.onRemove(part.remove)}>
                                    <FontAwesomeIcon icon={faXmark} />{ps.words.messages.remove()} {part.text}
                                </chakra.button>
                            );
                            case "add": return (
                                <chakra.button key={i} type="button" css={styles.addLink} onClick={(event) => actions.onAction(part.action, event.currentTarget)}>
                                    <FontAwesomeIcon icon={faPlus} />{part.text}
                                </chakra.button>
                            );
                            case "remove": return (
                                <chakra.button key={i} type="button" css={styles.removeLink} onClick={() => actions.onRemove(part.target)}>
                                    <FontAwesomeIcon icon={faXmark} />{part.target.kind === "condition" ? ps.words.messages.removeCondition() : part.label}
                                </chakra.button>
                            );
                            default: return null;
                        }
                    })}
                </Box>
            )}
            <PhoneProblems problems={problems} styles={styles} actions={actions} />
        </Box>
    );
}

/** A card's lines as clauses: a group's head a clause, its lines under it; a foot's adds as links. */
function PhoneLines({ lines, at, open, onOpen, ps, actions, isDirty }: { lines: readonly CardLine[]; at: string; open: string | undefined; onOpen: (id: string | undefined) => void; ps: PartStyles; actions: PartActions; isDirty: ClauseProps["isDirty"] }): ReactNode {
    const styles = useSlotStyles("queryPhone");
    return lines.map((line, i) => {
        const id = `${at}.${i}`;
        switch (line.kind) {
            case "row":
                return <Clause key={i} id={id} parts={line.parts} problems={line.problems} open={open} onOpen={onOpen} ps={ps} actions={actions} isDirty={isDirty} />;
            case "group":
                return (
                    <Box key={i} css={styles.group} data-query-line="group">
                        <Clause id={id} parts={[...line.parts, ...(line.head ?? [])]} problems={line.problems} open={open} onOpen={onOpen} ps={ps} actions={actions} isDirty={isDirty} />
                        <Box css={styles.groupLines}><PhoneLines lines={line.lines ?? []} at={id} open={open} onOpen={onOpen} ps={ps} actions={actions} isDirty={isDirty} /></Box>
                    </Box>
                );
            case "foot":
                return (
                    <Fragment key={i}>
                        <Box css={styles.feet}>
                            {line.parts.map((part, j) => part.t === "add" ? (
                                <chakra.button key={j} type="button" css={styles.addLink} data-slot-key={part.action.kind === "open" && part.action.slot !== undefined ? slotKey(part.action.slot) : undefined}
                                    onClick={(event) => actions.onAction(part.action, event.currentTarget)}>
                                    <FontAwesomeIcon icon={faPlus} />{part.text}
                                </chakra.button>
                            ) : null)}
                        </Box>
                        <PhoneProblems problems={line.problems} styles={styles} actions={actions} />
                    </Fragment>
                );
            case "note":
                return <Box key={i} css={styles.note}>{line.parts.map((p) => (p.t === "word" ? p.text : "")).join(" ")}</Box>;
            case "code":
                return (
                    <Fragment key={i}>
                        <Box as="pre" css={styles.code}>{line.parts.map((p) => (p.t === "code" ? p.text : "")).join("")}</Box>
                        <PhoneProblems problems={line.problems} styles={styles} actions={actions} />
                    </Fragment>
                );
        }
    });
}

/** A step's card (QP23, QP27). */
const PhoneStepCard = memo(function PhoneStepCard({ card, count, focused, open, onOpen, ps, actions, isDirty }: {
    card: Card; count: number; focused: boolean; open: string | undefined; onOpen: (id: string | undefined) => void; ps: PartStyles; actions: QueryEditor["actions"]; isDirty: ClauseProps["isDirty"];
}) {
    const styles = useSlotStyles("queryPhone");
    const { words } = ps;
    const m = words.messages;
    const [more, setMore] = useState(false);
    return (
        <Box css={styles.card} role="group" aria-label={card.title} data-step-id={card.stepId} data-step-kind={card.kind}
            data-unfinished={card.complete ? undefined : ""} data-error={card.errors > 0 ? "" : undefined} data-focus={focused ? "" : undefined}>
            <Box css={styles.cardHead}>
                <Box as="span" css={styles.cardNumber}>{words.formatters.bare(card.index + 1)}</Box>
                <Box as="span" css={styles.cardIcon} aria-hidden><FontAwesomeIcon icon={["fas", card.icon as IconName]} /></Box>
                <Box as="span" css={styles.cardTitle}>{card.title}</Box>
                <chakra.button type="button" css={styles.cardMore} aria-label={m.stepActions()} aria-expanded={more} data-query-step-more="" onClick={() => setMore(!more)}>
                    <FontAwesomeIcon icon={faEllipsis} />
                </chakra.button>
            </Box>
            {more && (
                <Box css={styles.cardActions} data-query-step-actions="">
                    <Button size="md" variant="outline" css={styles.cardAction} disabled={card.index === 0} onClick={() => actions.onMove(card.stepId, -1)}><FontAwesomeIcon icon={faArrowUp} />{m.moveUp()}</Button>
                    <Button size="md" variant="outline" css={styles.cardAction} disabled={card.index === count - 1} onClick={() => actions.onMove(card.stepId, 1)}><FontAwesomeIcon icon={faArrowDown} />{m.moveDown()}</Button>
                    <Button size="md" variant="outline" css={styles.cardAction} onClick={() => actions.onRemoveStep(card.stepId)}><FontAwesomeIcon icon={faXmark} />{m.removeStep()}</Button>
                </Box>
            )}
            {card.head.length > 0 && <Clause id={`${card.stepId}.head`} parts={card.head} problems={[]} open={open} onOpen={onOpen} ps={ps} actions={actions} isDirty={isDirty} />}
            <PhoneLines lines={card.lines} at={card.stepId} open={open} onOpen={onOpen} ps={ps} actions={actions} isDirty={isDirty} />
            {!card.complete && <Box css={styles.note}>{m.notFinished()}</Box>}
        </Box>
    );
});

/** Props of {@link QueryPhoneView}. */
export interface QueryPhoneViewProps {
    readonly editor: QueryEditor;
    readonly ps: PartStyles;
    readonly workspace: string | undefined;
    /** The step an issue went to; the clause it opens. */
    readonly focus: string | undefined;
    /** The notice a phone says over the strip instead. */
    readonly elsewhere: QueryNotice | undefined;
    /** Where the query stands, its name's eyebrow. */
    readonly save: QuerySaveLine;
    /** Its description: the author's, else the generated one. */
    readonly description: string;
    /** Save…, whose popover is a view here. */
    readonly saveButton: ReactNode;
    readonly onRun: () => void;
    readonly running: boolean;
    /** Whether the session holds drafts: a slot's value is dirty against what it held before any. */
    readonly drafted: boolean;
    /** Opens the Library tab: a query with no steps' way on (5a). */
    readonly onOpenLibrary: () => void;
}

const AT_END: SlotRef = { kind: "add-step", stepId: "" };

/**
 * The Query view — see the module docs.
 *
 * @param props - The editor, its parts and the query's standing ({@link QueryPhoneViewProps})
 * @returns The view's body
 */
export const QueryPhoneView = memo(function QueryPhoneView({ editor, ps, workspace, focus, elsewhere, save, description, saveButton, onRun, running, drafted, onOpenLibrary }: QueryPhoneViewProps) {
    const styles = useSlotStyles("queryPhone");
    const { words } = ps;
    const m = words.messages;
    const { view, setView, source, cards, actions } = editor;
    const [open, setOpen] = useState<string | undefined>(undefined);
    const { copied, copy } = useCopy(() => editor.program);
    const n = words.formatters.number(cards.length);
    // An issue gone to opens its clause: the first of its step with a problem, else the step's first.
    useEffect(() => {
        if (focus === undefined) return;
        const card = cards.find((c) => c.stepId === focus);
        if (card === undefined) return;
        const at = card.lines.findIndex((l) => l.problems.length > 0);
        setOpen(`${card.stepId}.${at < 0 ? 0 : at}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- going to an issue is what opens it, not the cards moving after.
    }, [focus]);
    const notices = editor.notices.filter((notice) => notice.id !== elsewhere?.id);
    // A changed value is dirty (QP25): against each slot's text while the session held no drafts.
    const clean = useRef(new Map<string, string>());
    const seen: [string, string][] = [];
    const walk = (parts: readonly CardPart[]) => { for (const part of parts) if (part.t === "slot") seen.push([slotKey(part.slot), part.text]); };
    const walkLines = (lines: readonly CardLine[]) => { for (const line of lines) { walk(line.parts); walk(line.head ?? []); walkLines(line.lines ?? []); } };
    for (const card of cards) { walk(card.head); walkLines(card.lines); }
    if (!drafted) clean.current = new Map(seen);
    const isDirty = (key: string, text: string) => drafted && clean.current.has(key) && clean.current.get(key) !== text;
    return (
        <Box css={styles.queryView} data-query-tab="query" data-mode={view} data-query-phone-view="">
            <Box css={styles.queryBand}>
                <Box css={styles.seg} role="group" aria-label={m.viewLabel()} data-query-view={view}>
                    {(["visual", "jq"] as const).map((v) => (
                        <chakra.button key={v} type="button" css={styles.segItem} data-state={v === view ? "on" : "off"} aria-pressed={v === view} onClick={() => setView(v)}>
                            <Box as="span" css={styles.segIcon} aria-hidden><FontAwesomeIcon icon={v === "visual" ? faDiagramProject : faCode} /></Box>
                            <span>{m.view({ view: v })}</span>
                        </chakra.button>
                    ))}
                </Box>
                <chakra.button type="button" css={styles.copy} data-copied={copied ? "" : undefined} data-query-copy="" onClick={copy}>
                    {copied && <FontAwesomeIcon icon={faCheck} />}{copied ? m.copied() : m.copyJq()}
                </chakra.button>
            </Box>
            {notices.map((notice) => (
                <Box key={notice.id} css={styles.queryNotice} role="status">
                    <Box as="span" css={styles.liveDot} aria-hidden />
                    <Box as="span" css={styles.liveText}>{notice.text}</Box>
                    <chakra.button type="button" css={styles.liveClose} aria-label={m.dismissNotice()} onClick={() => editor.dismiss(notice.id)}><FontAwesomeIcon icon={faXmark} /></chakra.button>
                </Box>
            ))}
            <Box css={styles.queryScroll} data-mode={view}>
                {view !== "jq" && <Box css={styles.queryHead} data-query-head="">
                    <Box css={styles.queryEyebrow}>{m.queryEyebrow({ state: save.word, n: cards.length, count: n })}</Box>
                    <Box css={styles.queryName} data-query-name="">{editor.header.name}</Box>
                    {description !== "" && <Box css={styles.queryDescription}>{description}</Box>}
                </Box>}
                {view === "jq" && editor.jqChecked !== undefined ? (
                    <Box css={styles.queryJq} data-query-jq-phone="">
                        {editor.jqNote !== undefined && <BannerView status="warning" title={editor.jqNote} />}
                        <JqEditor text={editor.jqText} checked={editor.jqChecked} root={editor.root} summaries={editor.summaries} ps={ps}
                            onText={editor.onJqText} onLeave={editor.leaveJq} onFix={editor.onJqFix} phone />
                    </Box>
                ) : (
                    <Box css={styles.querySteps} role="group" aria-label={m.stepsLabel()} data-query-steps="">
                        {source !== undefined && <>
                            <Box css={styles.source} data-query-source={editor.query.source}>
                                <Box as="span" css={styles.sourceTile} aria-hidden><FontAwesomeIcon icon={faDatabase} /></Box>
                                <Box css={styles.sourceText}>
                                    <Box as="span" css={styles.sourceTitle}>{source.title}</Box>
                                    <Box as="span" css={styles.sourceKind}>{m.sourceLine({ path: workspace === undefined ? editor.query.source : `${workspace}.${editor.query.source}`, kind: source.kind })}</Box>
                                </Box>
                            </Box>
                            <ShapeRow text={source.shape.text} extra={source.shape.extra} counted={source.shape.counted} at={0} insert={cards.length > 0} ps={ps} onSlot={actions.onSlot} />
                        </>}
                        {cards.map((card) => (
                            <Fragment key={card.stepId}>
                                <PhoneStepCard card={card} count={cards.length} focused={focus === card.stepId} open={open} onOpen={setOpen} ps={ps} actions={actions} isDirty={isDirty} />
                                <ShapeRow text={card.shape.text} extra={card.shape.extra} counted={card.shape.counted} at={card.index + 1} insert ps={ps} onSlot={actions.onSlot} />
                            </Fragment>
                        ))}
                        {cards.length === 0 && (
                            <Box css={styles.emptySteps} data-query-empty="">
                                <Box as="span" css={styles.emptyGlyph} aria-hidden />
                                <Box css={styles.emptyTitle}>{m.noStepsYet()}</Box>
                                <Box as="ul" css={styles.emptyList}><li>{m.noStepsAdd()}</li><li>{m.noStepsSaved()}</li></Box>
                                <chakra.button type="button" css={styles.emptyLink} onClick={onOpenLibrary}>{m.openLibrary()} →</chakra.button>
                            </Box>
                        )}
                        <chakra.button type="button" css={styles.addEnd} data-slot-key={slotKey(AT_END)} data-query-add-end="" onClick={(event) => actions.onSlot(AT_END, event.currentTarget)}>
                            <FontAwesomeIcon icon={faPlus} />{m.addStepAtEnd()}
                        </chakra.button>
                    </Box>
                )}
            </Box>
            <Box css={styles.queryFoot} data-query-foot="">
                <Box css={styles.footStatus} data-query-check={editor.check.tone}>
                    <Box as="span" css={styles.footDot} data-tone={editor.check.tone} aria-hidden />
                    <Box as="span" css={styles.footWord} data-tone={editor.check.tone}>{editor.check.word}</Box>
                    {editor.gives !== undefined && <Box as="span" css={styles.footGives} data-query-gives="">{editor.gives.text}</Box>}
                </Box>
                <Box css={styles.footButtons}>
                    {saveButton}
                    <Button size="md" variant="solid" css={styles.footButton} aria-busy={running ? true : undefined} data-query-run="" onClick={onRun}>
                        <FontAwesomeIcon icon={faPlay} />{m.run()}
                    </Button>
                </Box>
            </Box>
        </Box>
    );
});

/** The line between steps (QP22): the shape's words, and Insert as a 44 ghost. */
function ShapeRow({ text, extra, counted, at, insert, ps, onSlot }: { text: string; extra: string; counted: boolean; at: number; insert: boolean; ps: PartStyles; onSlot: PartActions["onSlot"] }) {
    const styles = useSlotStyles("queryPhone");
    const m = ps.words.messages;
    const slot: SlotRef = { kind: "add-step", stepId: "", at };
    // After a fresh run, the count in 600 ink, then the words (QP22).
    const space = text.indexOf(" ");
    const shown = counted && space > 0 ? <><b>{text.slice(0, space)}</b>{text.slice(space)}</> : text;
    return (
        <Box css={styles.shape} data-query-shape={at}>
            <Box as="span" css={styles.shapeText} data-query-shape-text=""><span>{shown}</span>{extra !== "" && <span> {extra}</span>}</Box>
            {insert && <chakra.button type="button" css={styles.shapeInsert} data-slot-key={slotKey(slot)} aria-label={m.insertHere()} onClick={(event) => onSlot(slot, event.currentTarget)}>
                <FontAwesomeIcon icon={faPlus} />{m.insert()}
            </chakra.button>}
        </Box>
    );
}
