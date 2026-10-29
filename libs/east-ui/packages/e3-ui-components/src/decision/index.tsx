/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3-ui's DecisionQueue renderer (`Decision Queue Spec.md` §6, §7, §9): the
 * app's cases, read through the payload's `decisions` — the record whole, or
 * the slice's `decisions` source's narrowing — and their verdicts by key, in a
 * component of their own (`data.ts`); laid out by when each is due
 * (`layout.ts`) in the list (`list.tsx`), inside its `BuilderFrame`: the
 * toolbar's count, rail, past-due count and history item (`toolbar.tsx`); the
 * banners — the batch's, each session's, a read that failed, past the cap — and
 * the footer's loading line (`footer.tsx`).
 *
 * One card is open at a time, kept under the queue's `id` with each card's
 * choices (`choices.ts`) — the first case waiting until the viewer opens or
 * closes one — and the host hears it through `onSelect` (R7). A gesture holds
 * the head it acts on where it was on screen (R8, R11). A verdict is one step
 * of one history over the verdicts and each record a change lands in
 * (`editing.ts`, R23); its card becomes a receipt in its place, whose Undo is
 * the history's while its step is the last (R24–R27), and the keyboard goes to
 * the next card's head; Apply all is one step over the routine cases (R28).
 * The keys (R12): `j` and `k` step through the cards, Escape closes the open
 * one, and the history's own. While a new narrowing's cases are read, the last
 * narrowing's stand in, retained (R5): readable, openable, and taking no
 * verdict.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box, Button } from "@chakra-ui/react";
import { DateTimeType, OptionType, StringType, equalFor, equivalentFor, none, some, type option } from "@elaraai/east";
import { DecisionQueueComponent, DecisionQueuePayloadType } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, getSomeorUndefined, historyShortcut, implementUIComponent, takeKey, typedInto, useDataStable, useFormatters,
    type EditIssue, type HistoryAction,
} from "@elaraai/east-ui-components";
import { LoadingReveal, useSlotStyles, type RowsHold, type RowsHoldPart } from "@elaraai/east-ui-components/internal";
import { pagedLoadingLine } from "../shared/loading.js";
import { flag } from "./card.js";
import { useDecisionChoices } from "./choices.js";
import { DecisionDataReader, INITIAL_DATA, type DecisionData } from "./data.js";
import {
    VERDICTS, decisionChanges, useDecisionEditing, verdictDraft, verdictSteps, type Decided, type DecisionQueueValue,
} from "./editing.js";
import { DecisionFooter } from "./footer.js";
import { layoutCases, recommendedIndex, type DecisionCase } from "./layout.js";
import { DecisionList, HEAD_PART, RECEIPT_PART, REVEAL_PX, caseRowKey, listRows, type DecisionReceiptState, type DecisionRow } from "./list.js";
import { decisionQueueMessages, type DecisionQueueWords } from "./messages.js";
import { useDecisionToolbar } from "./toolbar.js";

export type { DecisionQueueValue } from "./editing.js";

/** Props of the DecisionQueue's renderer. */
export interface EastChakraDecisionQueueProps {
    /** The payload. */
    readonly value: DecisionQueueValue;
    /** Where the queue keeps its state: under it, by the queue's `id`. */
    readonly storageKey: string;
}

const queueEqual = equivalentFor(DecisionQueuePayloadType);
const nowEqual = equalFor(OptionType(DateTimeType));
const stringEqual = equalFor(StringType);
/** The clock's step, where the payload gives no time: the due words count in minutes. */
const MINUTE_MS = 60_000;
/** How many commits a card's head is waited for, as a key's step brings a card the list had not mounted into view. */
const FOCUS_TRIES = 4;
/**
 * The frame's root takes the focus a click on a part of it holding nothing focusable gives — the toolbar's gaps, the
 * footer — so the keyboard stays in the queue, never the page's body: not a tab stop.
 */
const CLICK_FOCUS: Readonly<Record<string, string>> = { tabIndex: "-1" };
const NO_CASES: readonly DecisionCase[] = [];
const NO_RECEIPTS: ReadonlyMap<string, DecisionReceiptState> = new Map();

/** Two keys the same: both none, or the same text. */
function sameKey(a: string | undefined, b: string | undefined): boolean {
    return a === undefined || b === undefined ? a === b : stringEqual(a, b);
}

/**
 * The card after a case's row in the list — the next one waiting, past receipts and section heads (R26).
 *
 * @param rows - The list's rows
 * @param receipts - The receipts standing
 * @param key - The case's key
 * @returns The next waiting card's case's key; `undefined` for none after it
 */
function cardAfter(rows: readonly DecisionRow[], receipts: ReadonlyMap<string, DecisionReceiptState>, key: string): string | undefined {
    const at = rows.findIndex(row => stringEqual(row.key, caseRowKey(key)));
    for (let i = at + 1; at >= 0 && i < rows.length; i++) {
        const row = rows[i]!;
        if (row.kind === "case" && !receipts.has(row.c.key)) return row.c.key;
    }
    return undefined;
}

/**
 * The time the queue counts from: the payload's `now`, else the clock, a minute at a time.
 *
 * @param pinned - The payload's `now`
 * @returns The time
 */
function useNow(pinned: option<Date>): Date {
    const stable = useDataStable(pinned, nowEqual);
    const [clock, setClock] = useState(() => new Date());
    useEffect(() => {
        if (stable.type === "some") return undefined;
        const timer = setInterval(() => setClock(new Date()), MINUTE_MS);
        return () => clearInterval(timer);
    }, [stable]);
    return stable.type === "some" ? stable.value : clock;
}

/** What the frame takes: the payload, and its key. */
interface FrameProps {
    readonly value: DecisionQueueValue;
    readonly storageKey: string;
}

/**
 * The frame (see the module docs). Its sessions are made read only too (R22): it takes no verdict and shows no history
 * item, and its previews read the rows each change touches as they stand through them.
 */
function DecisionFrame({ value, storageKey: key }: FrameProps) {
    const editing = useDecisionEditing(value, key);
    const [data, setData] = useState<DecisionData>(INITIAL_DATA);
    const { choices, choiceOf, setChoice, setOpen, setRoutineOpen, forget } = useDecisionChoices(key);
    const styles = useSlotStyles("decisionQueue");
    const formatters = useFormatters();
    const words = useMemo((): DecisionQueueWords => ({ ...formatters, m: decisionQueueMessages }), [formatters]);
    const { m } = words;
    const now = useNow(value.now);
    const readOnly = value.readOnly;
    const schedule = editing.schedule;
    const history = editing.history;
    const main = useRef<HTMLDivElement>(null);

    // ── What shows ────────────────────────────────────────────────────────────
    // A case waits while no verdict holds its key (R3, D1): drafted, it is decided; a draft removing a saved one — an
    // Undo past its Save — brings it back; else its verdict as read.
    const waits = useCallback((c: DecisionCase): boolean => {
        const drafted = verdictDraft(schedule, c.key);
        return drafted === undefined ? !data.saved.has(c.key) : drafted === "removed";
    }, [schedule, data.saved]);
    const cases = data.cases ?? NO_CASES;
    const [receipts, setReceipts] = useState<ReadonlyMap<string, DecisionReceiptState>>(NO_RECEIPTS);
    // The receipts standing (R24): each over a case read that no longer waits — one whose step an Undo took back is its
    // card again.
    const standing = useMemo(() => {
        if (receipts.size === 0) return receipts;
        const out = new Map<string, DecisionReceiptState>();
        for (const c of cases) {
            const receipt = receipts.get(c.key);
            if (receipt !== undefined && !waits(c)) out.set(c.key, receipt);
        }
        return out.size === receipts.size ? receipts : out;
    }, [receipts, cases, waits]);
    // A receipt whose case a complete read no longer holds goes with it (R6).
    useEffect(() => {
        if (data.cases === undefined || data.filtering || receipts.size === 0) return;
        const read = new Set(data.cases.map(c => c.key));
        if ([...receipts.keys()].every(caseKey => read.has(caseKey))) return;
        setReceipts(was => new Map([...was].filter(([caseKey]) => read.has(caseKey))));
    }, [data.cases, data.filtering, receipts]);
    const layout = useMemo(() => layoutCases(cases, c => standing.has(c.key) || waits(c), waits, now), [cases, standing, waits, now]);
    const rows = useMemo(() => listRows(layout), [layout]);
    // The cards waiting, in the list's order: what `j` and `k` step through, the first of which opens by default.
    const cards = useMemo(() => layout.sections.flatMap(s => s.cases.filter(c => !standing.has(c.key))), [layout, standing]);
    const chosen = choices.open;
    // The open card (R7): the viewer's, while its case waits; the first waiting until they open or close one.
    const open = chosen === undefined ? cards[0]?.key : chosen === null ? undefined : cards.some(c => stringEqual(c.key, chosen)) ? chosen : undefined;
    // A saved verdict's case never shows again: its choices go (D12).
    useEffect(() => { forget(data.saved); }, [data.saved, forget]);
    // While a new narrowing's cases are read, the last one's stand in, retained (R5): no verdict is taken.
    const retained = data.filtering;
    const empty = data.landed && data.tooMany === undefined && rows.length === 0;

    // ── The host hears the open case (R7) ────────────────────────────────────
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const reported = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (!data.landed || sameKey(reported.current, open)) return;
        reported.current = open;
        if (onSelectFn !== undefined) queueMicrotask(() => onSelectFn(open === undefined ? none : some(open)));
    }, [data.landed, open, onSelectFn]);

    // ── Holds, scrolls and the keyboard ───────────────────────────────────────
    const [hold, setHold] = useState<RowsHold | undefined>(undefined);
    const holds = useRef(0);
    const holdRow = useCallback((caseKey: string, part: RowsHoldPart, reveal?: number) => {
        holds.current += 1;
        setHold({ key: caseRowKey(caseKey), nonce: holds.current, part, reveal });
    }, []);
    const [scrollTo, setScrollTo] = useState<{ readonly key: string; readonly nonce: number } | undefined>(undefined);
    // Where the keyboard goes once the commit a gesture asked for has drawn it, without scrolling (R12, R26): a card's
    // head — waited for a few commits where the list brings it into view first — else main, never the page's body.
    const focusNext = useRef<{ readonly key: string | undefined; tries: number } | undefined>(undefined);
    const focusAfter = (caseKey: string | undefined) => { focusNext.current = { key: caseKey, tries: FOCUS_TRIES }; };
    useLayoutEffect(() => {
        const want = focusNext.current;
        const board = main.current;
        if (want === undefined || board === null) return;
        const head = want.key === undefined ? undefined
            : [...board.querySelectorAll<HTMLElement>("[data-decision-head]")].find(el => stringEqual(el.getAttribute("data-decision-head") ?? "", want.key!));
        if (head !== undefined || want.key === undefined || want.tries <= 1) focusNext.current = undefined;
        else want.tries -= 1;
        (head ?? board).focus({ preventScroll: true });
    });
    const mounted = (caseKey: string): boolean =>
        [...(main.current?.querySelectorAll("[data-decision-head]") ?? [])].some(el => stringEqual(el.getAttribute("data-decision-head") ?? "", caseKey));
    // Opens a card from a key or an issue: held where it shows, its body revealed, brought into view where it is not.
    const openCard = (caseKey: string) => {
        holdRow(caseKey, HEAD_PART, REVEAL_PX);
        setOpen(caseKey);
        focusAfter(caseKey);
        if (!mounted(caseKey)) setScrollTo(was => ({ key: caseKey, nonce: (was?.nonce ?? 0) + 1 }));
    };

    // ── The gestures, the same functions while the frame draws again ─────────
    const latest = useRef({ value, m, words, open, rows, standing, retained, routineOpen: choices.routineOpen });
    latest.current = { value, m, words, open, rows, standing, retained, routineOpen: choices.routineOpen };
    const onToggle = useCallback((caseKey: string) => {
        const opening = !sameKey(latest.current.open, caseKey);
        holdRow(caseKey, HEAD_PART, opening ? REVEAL_PX : undefined);
        setOpen(opening ? caseKey : null);
    }, [holdRow, setOpen]);
    const [unrecorded, setUnrecorded] = useState(false);
    // A verdict (R23, R24): one step of the history; its card becomes its receipt where it stood, held there, and the
    // keyboard goes to the next card's head.
    const onDecide = useCallback((d: Decided, from: number) => {
        const now = latest.current;
        if (readOnly || now.retained) return;
        const title = d.c.options[recommendedIndex(d.c).index]?.title ?? "";
        const recorded = editing.schedule.record(decisionChanges(now.value, d, new Date()), "verdict", now.m.verdictStep({ verdict: d.verdict, title }));
        if (!recorded) {
            setUnrecorded(true);
            return;
        }
        setUnrecorded(false);
        const mark = verdictSteps(editing.schedule);
        setReceipts(was => new Map(was).set(d.c.key, { verdict: d.verdict, title, from, mark }));
        holdRow(d.c.key, HEAD_PART);
        setOpen(null);
        focusAfter(cardAfter(now.rows, now.standing, d.c.key));
    }, [editing, readOnly, holdRow, setOpen]);
    // A receipt's Undo (R27): the history's; the case comes back open where the receipt was.
    const onUndo = useCallback((caseKey: string) => {
        if (readOnly) return;
        editing.history.act("undo");
        setReceipts(was => {
            const next = new Map(was);
            next.delete(caseKey);
            return next;
        });
        holdRow(caseKey, RECEIPT_PART, REVEAL_PX);
        setOpen(caseKey);
        focusAfter(caseKey);
    }, [editing, readOnly, holdRow, setOpen]);
    // A receipt that has left (R26): the keyboard on it goes to the next card's head.
    const onGone = useCallback((caseKey: string) => {
        const board = main.current;
        const active = board?.ownerDocument.activeElement;
        if (board !== null && active instanceof HTMLElement && board.contains(active) && active.closest("[data-decision-receipt]") !== null) {
            focusAfter(cardAfter(latest.current.rows, latest.current.standing, caseKey));
        }
        setReceipts(was => {
            if (!was.has(caseKey)) return was;
            const next = new Map(was);
            next.delete(caseKey);
            return next;
        });
    }, []);
    const onRoutineToggle = useCallback(() => setRoutineOpen(!latest.current.routineOpen), [setRoutineOpen]);
    // Apply all (R28): one step over the routine cases, its banner's Undo the history's while the step is the last.
    const [batch, setBatch] = useState<{ readonly mark: number | undefined; readonly n: number } | undefined>(undefined);
    const onApplyAll = useCallback((decided: readonly Decided[]) => {
        const now = latest.current;
        if (readOnly || now.retained || decided.length === 0) return;
        const at = new Date();
        const recorded = editing.schedule.record(decided.flatMap(d => decisionChanges(now.value, d, at)), "verdict",
            now.m.batchStep({ n: now.words.number(decided.length) }));
        if (!recorded) {
            setUnrecorded(true);
            return;
        }
        setUnrecorded(false);
        setBatch({ mark: verdictSteps(editing.schedule), n: decided.length });
    }, [editing, readOnly]);
    // The history's step a receipt's or the batch's Undo takes back: the verdicts' steps done, while it can undo.
    const undoMark = !readOnly && history.canUndo ? verdictSteps(schedule) : undefined;
    const batchShown = batch !== undefined && undoMark !== undefined && batch.mark === undoMark;

    // ── The history ───────────────────────────────────────────────────────────
    const onAction = useCallback((action: HistoryAction) => {
        // A field typed into hands the keyboard to main first, so what it holds is taken as the step runs.
        const active = main.current?.ownerDocument.activeElement ?? null;
        if (active instanceof HTMLElement && typedInto(active)) main.current?.focus({ preventScroll: true });
        history.act(action);
    }, [history]);
    // An issue of the history: a verdict's opens its case where it waits.
    const onIssue = (issue: EditIssue) => {
        const source = editing.history.sourceOf(issue);
        const verdicts = editing.schedule.sessions.find(held => stringEqual(held.kind, VERDICTS));
        if (source === undefined || verdicts === undefined || !stringEqual(source, verdicts.key)) return;
        if (cards.some(c => stringEqual(c.key, issue.entry))) openCard(issue.entry);
    };
    // A session's banners name it, and an issue's place: a verdict by its case's title, a row by its key.
    const sessionName = (kind: string) => (stringEqual(kind, VERDICTS) ? m.verdictsSession()
        : editing.records.find(record => record !== undefined && stringEqual(record.key, kind))?.name ?? kind);
    const where = (kind: string) => (issue: EditIssue) => {
        if (!stringEqual(kind, VERDICTS)) return issue.entry;
        const c = cases.find(held => stringEqual(held.key, issue.entry));
        return c?.options[recommendedIndex(c).index]?.title ?? issue.entry;
    };

    // ── Keys (R12) ────────────────────────────────────────────────────────────
    // `j` and `k` step through the cards, opening each as a click does; Escape closes the open card; the history's own.
    // A key typed in a field is the field's, but Escape; a key from a layer portaled out of the frame is the layer's.
    const step = (dir: 1 | -1) => {
        const at = open === undefined ? -1 : cards.findIndex(c => stringEqual(c.key, open));
        const next = cards[at < 0 ? (dir > 0 ? 0 : cards.length - 1) : at + dir];
        if (next !== undefined) openCard(next.key);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        if (event.key === "Escape" && open !== undefined) {
            takeKey(event);
            holdRow(open, HEAD_PART);
            setOpen(null);
            focusAfter(open);
            return;
        }
        if (typedInto(event.target)) return;
        const action = historyShortcut(event);
        if (action !== undefined && !readOnly) {
            takeKey(event);
            onAction(action);
        } else if ((event.key === "j" || event.key === "k") && !event.metaKey && !event.ctrlKey && !event.altKey) {
            takeKey(event);
            step(event.key === "j" ? 1 : -1);
        }
    };

    // ── Toolbar, banners, footer ──────────────────────────────────────────────
    const counted = data.landed && !data.filtering && data.tooMany === undefined;
    const toolbar = useDecisionToolbar({
        value, styles, words, waiting: counted ? layout.waiting : undefined, overdue: data.filtering ? undefined : layout.overdue,
        late: data.landed && layout.overdue > 0, history: readOnly ? undefined : history, onIssue, onAction,
    });
    // What the footer's line says (#1398, CL3): the cases being read, a new narrowing's, or why they could not be.
    const line = useMemo(() => pagedLoadingLine(
        data.error !== undefined ? { kind: "failed", from: undefined, to: undefined, reason: data.error }
            : data.filtering ? { kind: "filtering" } : data.loading ? { kind: "loading", from: undefined, to: undefined } : undefined,
        m.noun(), m, words.number, data.retry), [data.error, data.filtering, data.loading, data.retry, m, words.number]);
    // Cold load (#1398, CL5): no read landed yet — the frame's skeleton covers it. After it nothing covers: a read in
    // flight leaves the frame live, main busy.
    const cold = !data.landed && data.error === undefined;
    const busy = data.loading && data.landed;
    const batchWords = batch === undefined ? undefined : m.batch({ n: words.number(batch.n) });
    const unrecordedWords = m.unrecorded();
    return (
        <Box css={styles.root} data-decision-queue="" data-decision-readonly={flag(readOnly)}>
            <DecisionDataReader value={value} onData={setData} />
            <LoadingReveal waiting={line?.kind === "loading"}>
                <BuilderFrame storageKey={`${key}.frame`} label={m.title()} loading={cold} busy={busy} liveFooter toolbar={toolbar} onKeyDown={onKeyDown}
                    rootProps={CLICK_FOCUS} banners={<>
                        {batchShown && batchWords !== undefined && (
                            <BannerView status="info" title={batchWords.title} description={batchWords.description}
                                actions={<Button size="xs" variant="outline" onClick={() => { history.act("undo"); setBatch(undefined); }}>{m.undo()}</Button>} />
                        )}
                        {!readOnly && editing.schedule.sessions.map(held => (
                            <SessionBanners key={held.key} session={held.session} words={words} name={sessionName(held.kind)} where={where(held.kind)}
                                onAction={action => editing.history.actOn(held.key, action)} />
                        ))}
                        {data.error !== undefined && (
                            <BannerView status="error" title={m.readFailed()} description={data.error}
                                actions={<Button size="xs" variant="outline" onClick={data.retry}>{m.retry()}</Button>} />
                        )}
                        {data.tooMany !== undefined && <BannerView status="info" title={m.tooMany({ n: words.number(data.tooMany) })} />}
                        {unrecorded && (
                            <BannerView status="warning" title={unrecordedWords.title} description={unrecordedWords.description} dismissible
                                onDismiss={() => setUnrecorded(false)} />
                        )}
                    </>} footer={<DecisionFooter styles={styles} line={line} />}>
                    {/* Main is the keyboard's surface and its anchor, never a tab stop: what a verdict or Escape takes away
                        leaves the keyboard here. Retained while a new narrowing is read (R5). */}
                    <Box ref={main} css={styles.main} data-decision-main="" tabIndex={-1} aria-disabled={retained ? true : undefined}
                        data-decision-stale={flag(retained)}>
                        <DecisionList rows={rows} layout={layout} empty={empty} receipts={standing} undoMark={undoMark} open={open}
                            routineOpen={choices.routineOpen} choiceOf={choiceOf} targets={value.targets} records={editing.records}
                            roles={value.verdicts.roles} readOnly={readOnly} now={now} words={words} styles={styles} storageKey={key} schedule={schedule} hold={hold}
                            scrollTo={scrollTo} onToggle={onToggle} onChoice={setChoice} onDecide={onDecide} onUndo={onUndo} onGone={onGone}
                            onRoutineToggle={onRoutineToggle} onApplyAll={onApplyAll} />
                    </Box>
                </BuilderFrame>
            </LoadingReveal>
        </Box>
    );
}

/**
 * Renders e3-ui's `<DecisionQueue>` (see the module docs): its state kept under
 * `storageKey` by the queue's `id`; read only, it takes no verdict and its
 * toolbar has no history item (R22).
 *
 * @param props - The payload and its storage key
 * @returns The queue, in its frame
 */
export const EastChakraDecisionQueue = memo(function EastChakraDecisionQueue({ value, storageKey }: EastChakraDecisionQueueProps) {
    const key = `${storageKey}.${value.id}`;
    return <DecisionFrame value={value} storageKey={key} />;
}, (prev, next) => queueEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

implementUIComponent(DecisionQueueComponent, EastChakraDecisionQueue);
