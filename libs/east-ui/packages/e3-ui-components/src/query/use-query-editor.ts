/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Editing the open query (#936) — what the Query tab's parts, the toolbar and
 * the status line do to the open query, each one gesture of its editing
 * session (#935), with its label in the history:
 *
 * - **the parts** (`Query Editor Spec.md` §4.3, §4.5): a slot opens the
 *   autocomplete, and picking its offer sets it (#934's `applySlot`); an
 *   input typed in and left; a ×; an add; a fix; a step moved or taken out;
 *   Quick add. A pick opens the slot it names next, by its key, once the
 *   query has rendered again, and a step added scrolls into view;
 * - **Visual · jq** (§4.8): to jq prints the program, a note counting the
 *   unfinished steps left out; the jq typed in and left is one gesture —
 *   steps where it parses into them, else the program as jq — and a fix taken
 *   in the jq view (#937) one more, after the jq typed before it; back to
 *   visual keeps jq while the jq does not parse, and says which parts stay jq
 *   steps;
 * - **the check** (§4.12): the steps' check in the visual view, the jq's in
 *   the jq view, and the shape the query gives.
 *
 * Nothing here reads data but a slot's summary, fetched when a slot that
 * needs one opens (#934, #935).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkJq, describeJqType, none, some, type CheckJqResult } from "@elaraai/east";
import type { Origin } from "@elaraai/east-ui-components";
import { cardsFor, sourceCard, type Card, type SourceCard } from "./model/cards.js";
import type { ActionRef, InputRef, RemoveRef, SlotRef } from "./model/refs.js";
import {
    activeItem, applyAction, applyInput, applyRemove, applySlot, quickAddOptions, slotEmpty, slotHint, slotItems, slotLabel, slotPlaceholder,
    type SavedOffer, type SlotItem, type StepOption,
} from "./model/slots.js";
import { summaryAt, summaryNeeded, type SummaryCache } from "./model/summaries.js";
import { fieldLabels, parseErrorWords, shapeWords, type QueryWords } from "./model/words.js";
import type { QueryRoot } from "./one-shot.js";
import { slotKey } from "./parts.js";
import { entriesQuery, queryEntries, queryProgram, type QueryEntry, type QueryHeader } from "./session.js";
import type { CardActions } from "./step-card.js";
import type { QueryCheckLine, QueryGivesLine } from "./status-line.js";
import { checkSteps, type CheckedSteps, type StepFix } from "./steps/check.js";
import { applyFix, moveStep, removeStep } from "./steps/edit.js";
import { parseSteps } from "./steps/parse.js";
import { printSteps } from "./steps/print.js";
import { shapeOf, type Shape } from "./steps/shape.js";
import { isComplete, type StepKind, type StepQuery } from "./steps/values.js";
import type { QueryView } from "./toolbar.js";

/** A notice at the top of the Query tab: what just happened. */
export interface QueryNotice {
    /** Its identity among the notices. */
    readonly id: number;
    /** What it says. */
    readonly text: string;
}

/** A slot's autocomplete, open. */
export interface OpenSlot {
    /** The slot. */
    readonly ref: SlotRef;
    /** Its key. */
    readonly key: string;
    /** The element it hangs from. */
    readonly anchor: HTMLElement;
}

/** What the autocomplete of the open slot shows, and what it is told. */
export interface SlotPopover {
    /** The slot. */
    readonly slot: OpenSlot;
    /** Changes when the offers' source does — a summary arriving — so the list opens afresh on its current value. */
    readonly generation: string;
    /** Its label, filter placeholder, footer, empty words and keys. */
    readonly label: string;
    readonly placeholder: string;
    readonly hint: string;
    readonly empty: string;
    readonly keys: string;
    /** The offers for the text typed. */
    readonly items: readonly SlotItem[];
    /** The text typed. */
    readonly text: string;
    /** The offer active as it opens. */
    readonly initialActive: number;
    /** Told each change of the text. */
    readonly onText: (text: string) => void;
    /** Told the offer picked. */
    readonly onPick: (item: SlotItem) => void;
    /** Told it closes. */
    readonly onClose: () => void;
}

/** What editing the open query needs. */
export interface QueryEditorOptions {
    /** The query's entries as its drafts stand. */
    readonly entries: readonly QueryEntry[];
    /** The query's entries as the drafts stand this moment — after a gesture in the same event, too. */
    readonly current: () => readonly QueryEntry[] | undefined;
    /** Records a gesture: the entries it leaves, as one transaction. */
    readonly gesture: (next: readonly QueryEntry[], origin: Origin, label: string) => boolean;
    /** Moves with every change of the session. */
    readonly version: number;
    /** The root. */
    readonly root: QueryRoot;
    /** The words. */
    readonly words: QueryWords;
    /** The builder's summaries, and the latest hash of each data source a run has read. */
    readonly summaries: { readonly cache: SummaryCache; readonly hashes: ReadonlyMap<string, string> };
    /** The saved queries the add-step list of a query with no steps offers. */
    readonly saved: readonly SavedOffer[];
    /** Opens a saved query picked from the add-step list. */
    readonly onOpenSaved: (name: string) => void;
    /** Shows the Query tab, the pane expanded: Visual · jq picked. */
    readonly onShowQuery: () => void;
    /** The builder's element: the autocomplete hangs inside it, and the slots are found in it. */
    readonly bounds: () => HTMLElement | null;
    /** Its session's source id: another query opened starts afresh. */
    readonly sourceId: string;
    /** The rows a fresh run of the steps counted at each stage, by step id (#938): the shape lines count them. */
    readonly counts?: ReadonlyMap<string, number> | undefined;
    /**
     * The notice a query arrives with when it opens (#939) — "Opened “Big
     * orders” from the library.", "Started a new query on customers." — by its
     * session's source id: shown when that query opens, in place of the last
     * query's notices.
     */
    readonly arrival?: { readonly sourceId: string; readonly text: string } | undefined;
}

/** Editing the open query: what the surfaces draw, and what they do. */
export interface QueryEditor {
    /** The header. */
    readonly header: QueryHeader;
    /** The steps, as a query on the header's data source. */
    readonly query: StepQuery;
    /** The steps' check; `undefined` while the program is jq. */
    readonly checked: CheckedSteps | undefined;
    /** The source's card, and each step's; empty while the program is jq. */
    readonly source: SourceCard | undefined;
    readonly cards: readonly Card[];
    /** The Quick add buttons at the end of the query. */
    readonly quick: readonly StepOption[];
    /** The view shown. */
    readonly view: QueryView;
    /** Shows a view: to jq prints the program; back to visual parses it. */
    readonly setView: (view: QueryView) => void;
    /** The jq as typed, in the jq view. */
    readonly jqText: string;
    /** Told each change of the jq typed. */
    readonly onJqText: (text: string) => void;
    /** The jq typed in and left: one gesture. */
    readonly leaveJq: () => void;
    /** A fix taken in the jq view: the jq typed so far left, then the text the fix makes, a gesture of its own, under its label. */
    readonly onJqFix: (text: string, label: string) => void;
    /** The jq view's check of the jq as typed; `undefined` in the visual view. */
    readonly jqChecked: CheckJqResult | undefined;
    /** The jq view's note: unfinished steps left out, or the jq kept for its syntax. */
    readonly jqNote: string | undefined;
    /** The root, which the jq view completes and reads steps over. */
    readonly root: QueryRoot;
    /** The builder's summaries, whose values the jq view's completions offer. */
    readonly summaries: QueryEditorOptions["summaries"];
    /** The program as it stands: what Run runs and Copy jq copies — in the jq view, the jq as typed. */
    readonly program: string;
    /** The status line's check, and the shape the query gives. */
    readonly check: QueryCheckLine;
    readonly gives: QueryGivesLine | undefined;
    /** The notices, newest last; a notice dismissed. */
    readonly notices: readonly QueryNotice[];
    readonly dismiss: (id: number) => void;
    /** The parts' and the cards' asks. */
    readonly actions: CardActions;
    /** A Quick add button pressed. */
    readonly onQuick: (kind: StepKind) => void;
    /** The open slot's autocomplete. */
    readonly popover: SlotPopover | undefined;
}

/** The shape a query gives, in the status line's words. */
function givesLine(shape: Shape, words: QueryWords): QueryGivesLine | undefined {
    if (shape.kind === "unknown") return undefined;
    const m = words.messages;
    return {
        text: m.gives({ shape: shapeWords(shape, words) }),
        hover: m.typeHover({ type: describeJqType(shape.type, { maxDepth: 2 }), multiplicity: shape.multiplicity ?? "" }),
        fields: m.givesFields({ fields: shape.kind === "rows" ? fieldLabels(shape) : [] }),
    };
}

/** The element in the builder that carries a slot's key. */
function slotElement(bounds: HTMLElement | null, key: string): HTMLElement | undefined {
    if (bounds === null) return undefined;
    for (const el of bounds.querySelectorAll<HTMLElement>("[data-slot-key]")) {
        if (el.getAttribute("data-slot-key") === key) return el;
    }
    return undefined;
}

/**
 * Editing the open query — see the module docs.
 *
 * @param options - The session's entries and gesture, the root, the words and the builder's element
 * @returns What the surfaces draw, and what they do
 */
export function useQueryEditor(options: QueryEditorOptions): QueryEditor {
    const { entries, current, gesture, version, root, words, summaries, saved, onOpenSaved, onShowQuery, bounds, sourceId, counts, arrival } = options;
    const m = words.messages;
    const { header, query } = useMemo(() => entriesQuery(entries), [entries]);
    const isJq = header.jq.type === "some";
    const checked = useMemo(() => (isJq ? undefined : checkSteps(query, root.type)), [isJq, query, root]);
    const source = useMemo(() => (checked === undefined ? undefined : sourceCard(query, root.type, checked, words, counts)), [checked, query, root, words, counts]);
    const cards = useMemo(() => (checked === undefined ? [] : cardsFor(query, root.type, checked, words, counts)), [checked, query, root, words, counts]);
    const quick = useMemo(() => (checked === undefined ? [] : quickAddOptions(checked.final, root.type, words)), [checked, root, words]);
    const held = useMemo(() => queryProgram(header, query, root.type), [header, query, root]);

    // ── Notices ─────────────────────────────────────────────────────────
    const [notices, setNotices] = useState<readonly QueryNotice[]>([]);
    const noticeId = useRef(0);
    const notify = useCallback((text: string) => {
        noticeId.current += 1;
        const id = noticeId.current;
        setNotices((was) => [...was, { id, text }]);
    }, []);
    const dismiss = useCallback((id: number) => setNotices((was) => was.filter((n) => n.id !== id)), []);

    // ── The view, and the jq as typed: the open query's own ─────────────
    // Each is held with the session it is of, so a query opened shows its own
    // from its first render: the visual view, its program as jq, no note.
    // Never, for a render, the last query's view and jq — which the run opening
    // it would run, and leave on it as a draft (#1132).
    const [viewState, setViewState] = useState<{ readonly sourceId: string; readonly view: QueryView }>({ sourceId, view: "visual" });
    const [typed, setTyped] = useState<{ readonly sourceId: string; readonly text: string }>(() => ({ sourceId, text: held }));
    const [noteState, setNoteState] = useState<{ readonly sourceId: string; readonly note: string | undefined }>({ sourceId, note: undefined });
    const jqText = typed.sourceId === sourceId ? typed.text : held;
    const setJqText = useCallback((text: string) => setTyped({ sourceId, text }), [sourceId]);
    const setJqNote = useCallback((note: string | undefined) => setNoteState({ sourceId, note }), [sourceId]);
    // A program that is not steps shows as jq, and says why.
    const view: QueryView = isJq ? "jq" : viewState.sourceId === sourceId ? viewState.view : "visual";
    const whyJq = useMemo(() => {
        if (!isJq) return undefined;
        const parsed = parseSteps(held, root.type);
        return "error" in parsed ? (parsed.error.code === "syntax" ? m.fixSyntaxFirst() : parseErrorWords(parsed.error, words)) : undefined;
    }, [isJq, held, root, m, words]);
    const jqNote = (noteState.sourceId === sourceId ? noteState.note : undefined) ?? whyJq;
    // The program the jq typed and left made: the session's change that is not
    // the jq's own — an undo — puts the program back in the jq view.
    const flushed = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (flushed.current !== undefined && flushed.current === held) {
            flushed.current = undefined;
            return;
        }
        flushed.current = undefined;
        setJqText(held);
    }, [held, setJqText]);
    // Another query opened: its own notices — the notice it arrives with, if any.
    const arriving = useRef(arrival);
    useEffect(() => { arriving.current = arrival; }, [arrival]);
    const shown = useRef(sourceId);
    useEffect(() => {
        if (shown.current === sourceId) return;
        shown.current = sourceId;
        const notice = arriving.current;
        if (notice !== undefined && notice.sourceId === sourceId) {
            noticeId.current += 1;
            setNotices([{ id: noticeId.current, text: notice.text }]);
        } else {
            setNotices([]);
        }
    }, [sourceId]);

    /**
     * The jq typed in and left, under a label: steps where it parses into them,
     * else the program as jq. It is taken against the drafts as they stand,
     * so a gesture before it in the same event composes. Whether it parses.
     */
    const flushJq = useCallback((text: string, label: string = m.editJqGesture()): boolean => {
        const now = entriesQuery(current() ?? entries);
        const program = queryProgram(now.header, now.query, root.type);
        const parsed = parseSteps(text, root.type);
        if ("error" in parsed) {
            if (text !== program) {
                flushed.current = text;
                gesture(queryEntries({ ...now.header, jq: some(text) }, []), "typed", label);
            }
            return false;
        }
        const printed = printSteps(parsed.query, root.type).text;
        if (printed !== program || now.header.jq.type === "some") {
            flushed.current = printed;
            gesture(queryEntries({ ...now.header, jq: none, source: parsed.query.source }, parsed.query.steps), "typed", label);
        }
        return true;
    }, [current, entries, root, gesture, m]);

    const leaveJq = useCallback(() => {
        if (view !== "jq" || jqText === held) return;
        flushJq(jqText);
    }, [view, jqText, held, flushJq]);

    const onJqFix = useCallback((text: string, label: string) => {
        leaveJq();
        setJqText(text);
        flushJq(text, label);
    }, [leaveJq, setJqText, flushJq]);

    const setView = useCallback((next: QueryView) => {
        onShowQuery();
        if (next === view) return;
        if (next === "jq") {
            const unfinished = query.steps.filter((s) => !isComplete(s)).length;
            setJqText(held);
            setJqNote(unfinished === 0 ? undefined : m.unfinishedLeftOut({ count: words.formatters.number(unfinished), n: unfinished }));
            setViewState({ sourceId, view: "jq" });
            return;
        }
        // Back to visual: the jq parsed into steps, or kept while it does not parse.
        const parsed = parseSteps(jqText, root.type);
        if ("error" in parsed) {
            if (jqText !== held) flushJq(jqText);
            setJqNote(parsed.error.code === "syntax" ? m.fixSyntaxFirst() : parseErrorWords(parsed.error, words));
            return;
        }
        flushJq(jqText);
        setJqNote(undefined);
        setViewState({ sourceId, view: "visual" });
        const raw = parsed.query.steps.filter((s) => s.type === "jq").length;
        if (raw > 0) notify(m.jqPartsStay({ count: words.formatters.number(raw), n: raw }));
    }, [onShowQuery, view, query, held, jqText, setJqText, setJqNote, sourceId, root, flushJq, notify, m, words]);

    // ── The check, and the shape the query gives ────────────────────────
    const jqCheck = useMemo(() => (view === "jq" || isJq ? checkJq(view === "jq" ? jqText : held, root.type, { root: true }) : undefined), [view, isJq, jqText, held, root]);
    const { check, gives } = useMemo((): { check: QueryCheckLine; gives: QueryGivesLine | undefined } => {
        const f = words.formatters;
        if (jqCheck !== undefined) {
            const errors = jqCheck.diagnostics.filter((d) => d.severity.type === "error").length;
            const warnings = jqCheck.diagnostics.filter((d) => d.severity.type === "warning").length;
            const shape = jqCheck.elementType === null ? undefined : shapeOf(jqCheck.elementType, jqCheck.multiplicity, { noun: "row" });
            return {
                check: errors > 0 ? { tone: "danger", word: m.problemCount({ count: f.number(errors), n: errors }) }
                    : warnings > 0 ? { tone: "warning", word: m.warningCount({ count: f.number(warnings), n: warnings }) }
                        : { tone: "success", word: m.checksClean() },
                gives: errors > 0 || shape === undefined ? undefined : givesLine(shape, words),
            };
        }
        const errors = checked?.errors ?? 0;
        const unfinished = query.steps.filter((s) => !isComplete(s)).length;
        return {
            check: errors > 0 ? { tone: "danger", word: m.problemCount({ count: f.number(errors), n: errors }) }
                : unfinished > 0 ? { tone: "warning", word: m.toFinish({ count: f.number(unfinished), n: unfinished }) }
                    : { tone: "success", word: m.checksClean() },
            gives: checked === undefined ? undefined : givesLine(checked.final, words),
        };
    }, [jqCheck, checked, query, words, m]);

    // ── Gestures ────────────────────────────────────────────────────────
    const commit = useCallback((next: StepQuery, origin: Origin, label: string): boolean =>
        gesture(queryEntries({ ...header, source: next.source }, next.steps), origin, label), [gesture, header]);
    // The slot a gesture opens next, and the step it added: found once the query renders again.
    const chained = useRef<{ open: SlotRef | undefined; added: string | undefined } | undefined>(undefined);
    const [open, setOpen] = useState<OpenSlot | undefined>(undefined);
    const [text, setText] = useState("");
    useEffect(() => {
        const next = chained.current;
        if (next === undefined) return;
        chained.current = undefined;
        const el = bounds();
        if (next.added !== undefined) {
            const card = el?.querySelector<HTMLElement>(`[data-step-id="${next.added}"]`);
            card?.scrollIntoView?.({ block: "nearest" });
        }
        if (next.open === undefined) return;
        const key = slotKey(next.open);
        const anchor = slotElement(el, key);
        if (anchor !== undefined) {
            setOpen({ ref: next.open, key, anchor });
            setText("");
        }
    }, [version, bounds]);
    const chain = (openNext: SlotRef | undefined, added: string | undefined) => {
        chained.current = { open: openNext, added };
    };

    const stepNumber = useCallback((stepId: string) => words.formatters.bare(query.steps.findIndex((s) => s.value.id === stepId) + 1), [query, words]);

    const onSlot = useCallback((ref: SlotRef, anchor: HTMLElement) => {
        const key = slotKey(ref);
        if (open?.key === key) {
            setOpen(undefined);
            return;
        }
        setOpen({ ref, key, anchor });
        setText("");
    }, [open]);
    const onInput = useCallback((input: InputRef, raw: string) => {
        commit(applyInput(query, input, raw, root.type, words), "typed", m.setGesture({ what: m.inputLabel({ input: input.kind }) }));
    }, [commit, query, root, words, m]);
    const onRemove = useCallback((ref: RemoveRef) => {
        commit(applyRemove(query, ref), "remove", m.remove());
    }, [commit, query, m]);
    const onAction = useCallback((ref: ActionRef, anchor: HTMLElement) => {
        if (ref.kind === "open") {
            if (ref.slot !== undefined) onSlot(ref.slot, anchor);
            return;
        }
        const result = applyAction(query, ref, root.type);
        const label = ref.kind === "add-condition" ? m.addCondition() : ref.kind === "add-group" ? m.addGroup() : m.addTotal();
        if (commit(result.query, "insert", label)) chain(result.open, undefined);
    }, [query, root, commit, onSlot, m]);
    const onFix = useCallback((fix: StepFix, label: string) => {
        commit(applyFix(query, fix, root.type), fix.kind === "removeStep" ? "remove" : "typed", label);
    }, [commit, query, root]);
    const onMove = useCallback((stepId: string, by: -1 | 1) => {
        commit(moveStep(query, stepId, by), "move", m.moveStepGesture({ n: stepNumber(stepId), up: by < 0 }));
    }, [commit, query, stepNumber, m]);
    const onRemoveStep = useCallback((stepId: string) => {
        commit(removeStep(query, stepId), "remove", m.removeStepGesture({ n: stepNumber(stepId) }));
    }, [commit, query, stepNumber, m]);

    /** A step picked from the add-step list, or pressed in Quick add: added with its defaults, its first empty slot opened. */
    const addStep = useCallback((slot: SlotRef, item: SlotItem): void => {
        const result = applySlot(query, slot, item, root.type, words);
        if (result.opened !== undefined) {
            onOpenSaved(result.opened);
            return;
        }
        const added = result.added === undefined ? undefined : result.query.steps.find((s) => s.value.id === result.added);
        const label = added === undefined ? m.setGesture({ what: item.label }) : m.addStepGesture({ step: m.stepTitle({ kind: added.type, noun: query.source }) });
        if (commit(result.query, "insert", label)) chain(result.open, result.added);
    }, [query, root, words, onOpenSaved, commit, m]);
    const onQuick = useCallback((kind: StepKind) => {
        addStep({ kind: "add-step", stepId: "" }, { value: { kind: "step", step: kind }, label: m.quickAddLabel({ kind }), group: m.addStepGroup() });
    }, [addStep, m]);

    const actions = useMemo((): CardActions => ({
        openSlot: open?.key, onSlot, onInput, onRemove, onAction, onFix, onMove, onRemoveStep,
    }), [open, onSlot, onInput, onRemove, onAction, onFix, onMove, onRemoveStep]);

    // ── The open slot's autocomplete ────────────────────────────────────
    // A slot whose step is gone — undone, removed — closes.
    const openRef = open?.ref;
    const openStep = openRef === undefined || openRef.kind === "add-step" ? -1 : query.steps.findIndex((s) => s.value.id === openRef.stepId);
    const gone = openRef !== undefined && openRef.kind !== "add-step" && openStep < 0;
    useEffect(() => { if (gone) setOpen(undefined); }, [gone]);
    const request = useMemo(() => (openRef === undefined || openStep < 0 || !summaryNeeded(openRef.kind) || isJq ? undefined
        : summaryAt(query, openStep, root.type)), [openRef, openStep, query, root, isJq]);
    const { cache, hashes } = summaries;
    const [arrived, setArrived] = useState(0);
    useEffect(() => {
        if (request === undefined || cache.get(request, hashes) !== undefined) return;
        let live = true;
        void cache.ensure(request, hashes).then((summary) => { if (live && summary !== undefined) setArrived((n) => n + 1); });
        return () => { live = false; };
    }, [request, cache, hashes]);
    const summary = request === undefined ? undefined : cache.get(request, hashes);
    const items = useMemo(() => (openRef === undefined || gone ? []
        : slotItems(query, root.type, openRef, text, { words, ...(summary === undefined ? {} : { summary }), saved })),
    // `arrived` moves when a summary lands in the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openRef, gone, query, root, text, words, summary, saved, arrived]);
    const initialActive = useMemo(() => (openRef === undefined ? -1 : activeItem(items, query, root.type, openRef)),
    // It opens on the slot's current value: the offers as they were when they arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openRef, summary === undefined, query]);

    const onPick = useCallback((item: SlotItem) => {
        if (open === undefined) return;
        const slot = open.ref;
        setOpen(undefined);
        setText("");
        if (slot.kind === "add-step") {
            addStep(slot, item);
            return;
        }
        const result = applySlot(query, slot, item, root.type, words);
        if (commit(result.query, "typed", m.setGesture({ what: item.label }))) chain(result.open, result.added);
    }, [open, addStep, query, root, words, commit, m]);
    const onClose = useCallback(() => {
        setOpen(undefined);
        setText("");
    }, []);

    const popover = useMemo((): SlotPopover | undefined => (open === undefined || gone ? undefined : {
        slot: open,
        generation: `${open.key}|${summary === undefined ? "" : "summary"}`,
        label: slotLabel(open.ref, words),
        placeholder: slotPlaceholder(open.ref, words),
        hint: slotHint(open.ref, words),
        empty: slotEmpty(open.ref, words),
        keys: m.slotKeys(),
        items,
        text,
        initialActive,
        onText: setText,
        onPick,
        onClose,
    }), [open, gone, summary, words, m, items, text, initialActive, onPick, onClose]);

    return {
        header, query, checked, source, cards, quick,
        view, setView, jqText, onJqText: setJqText, leaveJq, onJqFix, jqChecked: view === "jq" ? jqCheck : undefined, jqNote, root, summaries,
        program: view === "jq" ? jqText : held,
        check, gives, notices, dismiss, actions, onQuick, popover,
    };
}
