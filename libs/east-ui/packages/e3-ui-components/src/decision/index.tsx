/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3-ui's DecisionQueue renderer (`Decision Queue Spec.md` §6, §7, §9): the
 * app's cases, read through the payload's `decisions` — the record whole, or
 * the slice's `decisions` source a window at a time around the view, in its
 * index's order — in a component of their own (`data.ts`), each case's row
 * holding its verdict; drawn in the source's order in the list (`list.tsx`) —
 * a waiting case its card, a decided one its receipt, a case not read yet a
 * pending card — inside its `BuilderFrame`: the toolbar's count, e3's, its
 * rail and its history item (`toolbar.tsx`); the banners, each session's and a
 * read that failed; and the footer's Save notice and loading line
 * (`footer.tsx`).
 *
 * One card is open at a time, kept under the queue's `id` with each card's
 * choices (`choices.ts`) — the first case waiting until the viewer opens or
 * closes one — and the host hears it through `onSelect` (R7); a case the
 * viewer opened that leaves the list closes with it (R6). A gesture holds the
 * head it acts on where it was on screen (R8, R11). A verdict is one step of
 * one history over the cases' record and each record a change lands in
 * (`editing.ts`, R23); its card becomes its receipt in its place, whose Undo is
 * the history's while its step is the last (R24, R27), and the keyboard goes to
 * the next card's head (R25). The keys (R12): `j` and `k` step to the next and
 * the previous waiting case — one not read yet brought into view and opened as
 * it lands — Escape closes the open card, and the history's own. While a new
 * narrowing's, revision's or count's cases are read, those shown stand in,
 * retained (R5): readable, openable, and taking no verdict.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box, Button } from "@chakra-ui/react";
import { DateTimeType, OptionType, StringType, equalFor, equivalentFor, none, some, type option } from "@elaraai/east";
import { DECISIONS_SOURCE, DecisionQueueComponent, DecisionQueuePayloadType } from "@elaraai/e3-ui/internal";
import {
    BannerView, BuilderFrame, SessionBanners, getSomeorUndefined, historyShortcut, implementUIComponent, takeKey, typedInto, useDataStable, useFormatters,
    type EditIssue, type HistoryAction,
} from "@elaraai/east-ui-components";
import { LoadingReveal, useSlotStyles, type RowsHold, type RowsHoldPart } from "@elaraai/east-ui-components/internal";
import { pagedLoadingLine } from "../shared/loading.js";
import { sourcePart } from "../shared/schedule/visibility.js";
import { flag } from "./card.js";
import { verdictTitle, type DecisionCase } from "./cases.js";
import { useDecisionChoices } from "./choices.js";
import { DecisionDataReader, DecisionOpenReader, INITIAL_DATA, type DecisionData, type DecisionRead } from "./data.js";
import { CASES, caseNow, casesSteps, decisionChanges, useDecisionEditing, type Decided, type DecisionQueueValue } from "./editing.js";
import { DecisionFooter } from "./footer.js";
import { DecisionList, HEAD_PART, RECEIPT_PART, REVEAL_PX, caseRowKey, type DecisionArrival, type DecisionRangeChange } from "./list.js";
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
const NO_ARRIVALS: ReadonlyMap<string, DecisionArrival> = new Map();

/** Two keys the same: both none, or the same text. */
function sameKey(a: string | undefined, b: string | undefined): boolean {
    return a === undefined || b === undefined ? a === b : stringEqual(a, b);
}

/**
 * A case's place among the cases read.
 *
 * @param read - The cases read
 * @param key - The case's key
 * @returns Its place in the source; `undefined` for a case the read does not hold
 */
function placeOf(read: DecisionRead, key: string): number | undefined {
    for (const [at, c] of read.rows) if (stringEqual(c.key, key)) return at;
    return undefined;
}

/** What a step through the cases finds: a waiting case, by its place and key, or the place of a case not read yet. */
interface Found {
    readonly index: number;
    /** The waiting case's key; `undefined` for a case not read yet, whose key is not known. */
    readonly key: string | undefined;
}

/**
 * The first waiting case from a place, one way (R12, R25): a case not read yet stops the search there.
 *
 * @param read - The cases read
 * @param from - The place to start at, itself searched
 * @param dir - Which way
 * @param waits - Whether a case read waits
 * @returns The waiting case, or the place not read yet; `undefined` for none that way
 */
function waitingFrom(read: DecisionRead, from: number, dir: 1 | -1, waits: (c: DecisionCase) => boolean): Found | undefined {
    const count = read.count ?? 0;
    for (let i = from; i >= 0 && i < count; i += dir) {
        const c = read.rows.get(i);
        if (c === undefined) return { index: i, key: undefined };
        if (waits(c)) return { index: i, key: c.key };
    }
    return undefined;
}

/**
 * The arrivals with a receipt's arrival over: drawn again — scrolled back to, or brought back by a Redo — it stands at once.
 *
 * @param was - The arrivals
 * @param key - The receipt's case's key
 * @returns The arrivals; the same while its arrival is over already
 */
function arrivalOver(was: ReadonlyMap<string, DecisionArrival>, key: string): ReadonlyMap<string, DecisionArrival> {
    const arrival = was.get(key);
    return arrival === undefined || arrival.from === undefined ? was : new Map(was).set(key, { ...arrival, from: undefined });
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
    const [data, setData] = useState<DecisionData>(INITIAL_DATA);
    const editing = useDecisionEditing(value, key, data.read);
    const { choices, choiceOf, setChoice, setOpen, forget } = useDecisionChoices(key);
    const styles = useSlotStyles("decisionQueue");
    const formatters = useFormatters();
    const words = useMemo((): DecisionQueueWords => ({ ...formatters, m: decisionQueueMessages }), [formatters]);
    const { m } = words;
    const now = useNow(value.now);
    const readOnly = value.readOnly;
    const schedule = editing.schedule;
    const history = editing.history;
    const main = useRef<HTMLDivElement>(null);
    const read = data.read;
    const identity = data.identity;

    // ── What shows ────────────────────────────────────────────────────────────
    // A case waits while neither its row nor its draft holds a verdict (R3, D1).
    const waits = useCallback((c: DecisionCase): boolean => caseNow(value, schedule, c).verdict.type === "none", [value, schedule]);
    const chosen = choices.open;
    // The open card (R7): the case the viewer opened, while it waits or is not read; the first case waiting until they
    // open or close one (§11). A case the viewer opened that reads decided — in another session, or once saved — is its
    // receipt: no card is open.
    const open = useMemo((): string | undefined => {
        if (chosen === undefined) return read === undefined ? undefined : waitingFrom(read, 0, 1, waits)?.key;
        if (chosen === null) return undefined;
        const c = read === undefined ? undefined : read.rows.get(placeOf(read, chosen) ?? -1);
        return c === undefined || waits(c) ? chosen : undefined;
    }, [chosen, read, waits]);
    // A saved verdict's case is a card no more: its choices go (D12).
    useEffect(() => {
        if (read === undefined) return;
        const drafts = schedule.draftsOf(CASES);
        const saved: string[] = [];
        for (const c of read.rows.values()) if (c.verdict.type === "some" && !drafts.has(c.key)) saved.push(c.key);
        forget(saved);
    }, [read, schedule, forget]);
    // While a new narrowing's, revision's or count's cases are read, those shown stand in, retained (R5): no verdict is taken.
    const retained = data.standing;

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
    // A row to bring into view, in the narrowing the list shows: a case a key opens that the list has not mounted, or
    // one not read yet that a key's step waits on.
    const [scroll, setScroll] = useState<{ readonly identity: string; readonly index: number; readonly nonce: number } | undefined>(undefined);
    const bring = (index: number) => setScroll(was => ({ identity, index, nonce: (was?.nonce ?? 0) + 1 }));
    const scrollTo = scroll !== undefined && stringEqual(scroll.identity, identity) ? scroll : undefined;
    // Where the keyboard goes once the commit a gesture asked for has drawn it, without scrolling (R12, R25): a card's
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
    const openCard = (caseKey: string, index: number) => {
        holdRow(caseKey, HEAD_PART, REVEAL_PX);
        setOpen(caseKey);
        focusAfter(caseKey);
        if (!mounted(caseKey)) bring(index);
    };
    // A key's step waiting on a case not read yet (R12): brought into view, and gone on from as it lands.
    const [seek, setSeek] = useState<{ readonly identity: string; readonly index: number; readonly dir: 1 | -1 } | undefined>(undefined);
    const seekFrom = (from: number, dir: 1 | -1) => {
        const found = read === undefined ? undefined : waitingFrom(read, from, dir, waits);
        if (found === undefined) {
            setSeek(undefined);
        } else if (found.key === undefined) {
            setSeek({ identity, index: found.index, dir });
            bring(found.index);
        } else {
            setSeek(undefined);
            openCard(found.key, found.index);
        }
    };
    // The step as this commit has it, gone on from once the case it waits on lands.
    const seekOn = useRef(seekFrom);
    seekOn.current = seekFrom;
    useEffect(() => {
        if (seek === undefined) return;
        // A new narrowing's cases are another list: the step goes with the old one's.
        if (!stringEqual(seek.identity, identity)) {
            setSeek(undefined);
            return;
        }
        if (read === undefined || retained || !read.rows.has(seek.index)) return;
        seekOn.current(seek.index, seek.dir);
    }, [seek, identity, read, retained]);
    // Where the view rests, in the narrowing it shows: where a key's step starts with no case open.
    const view = useRef<{ readonly identity: string; readonly start: number; readonly end: number } | undefined>(undefined);
    const dataRange = data.onRangeChange;
    const onRangeChange = useCallback<DecisionRangeChange>((range, scrolling, _center, shown) => {
        const at = shown ?? range;
        view.current = { identity, start: at.startIndex, end: at.endIndex };
        dataRange(range, scrolling);
    }, [identity, dataRange]);

    // ── The gestures, the same functions while the frame draws again ─────────
    const latest = useRef({ value, m, chosen, open, read, waits, retained });
    latest.current = { value, m, chosen, open, read, waits, retained };
    const onToggle = useCallback((caseKey: string) => {
        const opening = !sameKey(latest.current.open, caseKey);
        setSeek(undefined);
        holdRow(caseKey, HEAD_PART, opening ? REVEAL_PX : undefined);
        setOpen(opening ? caseKey : null);
    }, [holdRow, setOpen]);
    const [unrecorded, setUnrecorded] = useState(false);
    const [arrivals, setArrivals] = useState<ReadonlyMap<string, DecisionArrival>>(NO_ARRIVALS);
    // A verdict (R23, R24): one step of the history; its card becomes its receipt where it stood, held there, and the
    // keyboard goes to the next waiting case's head, which neither opens nor scrolls (R25).
    const onDecide = useCallback((d: Decided, from: number) => {
        const live = latest.current;
        if (readOnly || live.retained) return;
        const label = live.m.verdictStep({ verdict: d.verdict, title: verdictTitle(d.c, d.option?.key ?? none) });
        if (!editing.schedule.record(decisionChanges(live.value, d, new Date()), "verdict", label)) {
            setUnrecorded(true);
            return;
        }
        setUnrecorded(false);
        setSeek(undefined);
        const mark = casesSteps(editing.schedule);
        setArrivals(was => new Map(was).set(d.c.key, { from, mark }));
        holdRow(d.c.key, HEAD_PART);
        setOpen(null);
        const at = live.read === undefined ? undefined : placeOf(live.read, d.c.key);
        focusAfter(at === undefined || live.read === undefined ? undefined : waitingFrom(live.read, at + 1, 1, live.waits)?.key);
    }, [editing, readOnly, holdRow, setOpen]);
    // A receipt's Undo (R27): the history's; the case comes back open where the receipt was.
    const onUndo = useCallback((caseKey: string) => {
        if (readOnly) return;
        setSeek(undefined);
        editing.history.act("undo");
        setArrivals(was => arrivalOver(was, caseKey));
        holdRow(caseKey, RECEIPT_PART, REVEAL_PX);
        setOpen(caseKey);
        focusAfter(caseKey);
    }, [editing, readOnly, holdRow, setOpen]);
    const onArrived = useCallback((caseKey: string) => setArrivals(was => arrivalOver(was, caseKey)), []);
    // A case the viewer opened that leaves the list goes with it (R6).
    const onGone = useCallback((caseKey: string) => {
        if (sameKey(latest.current.chosen ?? undefined, caseKey)) setOpen(null);
    }, [setOpen]);
    // The step a receipt's Undo takes back: the cases' steps done, while the history can undo.
    const undoMark = !readOnly && history.canUndo ? casesSteps(schedule) : undefined;

    // ── The history ───────────────────────────────────────────────────────────
    const onAction = useCallback((action: HistoryAction) => {
        // A field typed into hands the keyboard to main first, so what it holds is taken as the step runs.
        const active = main.current?.ownerDocument.activeElement ?? null;
        if (active instanceof HTMLElement && typedInto(active)) main.current?.focus({ preventScroll: true });
        history.act(action);
    }, [history]);
    // A case's place and the case, where the read holds it.
    const caseAt = (caseKey: string): { readonly index: number; readonly c: DecisionCase } | undefined => {
        const index = read === undefined ? undefined : placeOf(read, caseKey);
        const c = index === undefined ? undefined : read?.rows.get(index);
        return index === undefined || c === undefined ? undefined : { index, c };
    };
    // An issue of the history: a verdict's opens its case where it waits.
    const onIssue = (issue: EditIssue) => {
        const source = editing.history.sourceOf(issue);
        const cases = editing.schedule.sessions.find(held => stringEqual(held.kind, CASES));
        if (source === undefined || cases === undefined || !stringEqual(source, cases.key)) return;
        const at = caseAt(issue.entry);
        if (at !== undefined && waits(at.c)) openCard(at.c.key, at.index);
    };
    // A session's banners name it, and an issue's place: a verdict by its case's title, a row by its key.
    const sessionName = (kind: string) => (stringEqual(kind, CASES) ? m.casesSession()
        : editing.records.find(record => record !== undefined && stringEqual(record.key, kind))?.name ?? kind);
    const where = (kind: string) => (issue: EditIssue) => {
        const at = stringEqual(kind, CASES) ? caseAt(issue.entry) : undefined;
        return at === undefined ? issue.entry : verdictTitle(at.c);
    };

    // ── Keys (R12) ────────────────────────────────────────────────────────────
    // `j` and `k` step to the next and the previous waiting case, opening each as a click does — from the open case, else
    // from the view's first case shown, or its last going back; Escape closes the open card; the history's own. A key
    // typed in a field is the field's, but Escape; a key from a layer portaled out of the frame is the layer's.
    const step = (dir: 1 | -1) => {
        if (read === undefined || read.count === undefined) return;
        const at = open === undefined ? undefined : placeOf(read, open);
        const shown = view.current !== undefined && stringEqual(view.current.identity, identity) ? view.current : undefined;
        const from = at !== undefined ? at + dir : shown !== undefined ? (dir > 0 ? shown.start : shown.end) : dir > 0 ? 0 : read.count - 1;
        seekFrom(from, dir);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.defaultPrevented || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        if (event.key === "Escape" && open !== undefined) {
            takeKey(event);
            setSeek(undefined);
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
    const chrome = value.slice.type === "some" ? value.slice.value : undefined;
    const slice = useMemo(() => sourcePart(chrome, DECISIONS_SOURCE), [chrome]);
    // e3's count of the narrowing, or the record's size read whole (R3): `…` while a new narrowing's is read.
    const toolbar = useDecisionToolbar({
        value, styles, words, count: data.filtering ? undefined : read?.count, history: readOnly ? undefined : history, onIssue, onAction,
    });
    // What the footer's line says (#1398, CL3): the cases being read, a new narrowing's, or why they could not be.
    const line = useMemo(() => pagedLoadingLine(
        data.error !== undefined ? { kind: "failed", from: undefined, to: undefined, reason: data.error }
            : data.filtering ? { kind: "filtering" } : data.reading ? { kind: "loading", from: undefined, to: undefined } : undefined,
        m.noun(), m, words.number, data.retry), [data.error, data.filtering, data.reading, data.retry, m, words.number]);
    // Cold load (#1398, CL5): no read landed yet — the frame's skeleton covers it. After it nothing covers: a read in
    // flight leaves the frame live, main busy.
    const cold = !data.landed && data.error === undefined;
    const busy = data.reading && data.landed;
    const unrecordedWords = m.unrecorded();
    return (
        <Box css={styles.root} data-decision-queue="" data-decision-readonly={flag(readOnly)}>
            <DecisionDataReader value={value} onData={setData} />
            <DecisionOpenReader value={value} open={chosen ?? undefined} read={read} standing={data.standing} onGone={onGone} />
            <LoadingReveal waiting={line?.kind === "loading"}>
                <BuilderFrame storageKey={`${key}.frame`} label={m.title()} loading={cold} busy={busy} liveFooter toolbar={toolbar} onKeyDown={onKeyDown}
                    rootProps={CLICK_FOCUS} banners={<>
                        {!readOnly && editing.schedule.sessions.map(held => (
                            <SessionBanners key={held.key} session={held.session} words={words} name={sessionName(held.kind)} where={where(held.kind)}
                                onAction={action => editing.history.actOn(held.key, action)} />
                        ))}
                        {data.error !== undefined && (
                            <BannerView status="error" title={m.readFailed()} description={data.error}
                                actions={<Button size="xs" variant="outline" onClick={data.retry}>{m.retry()}</Button>} />
                        )}
                        {unrecorded && (
                            <BannerView status="warning" title={unrecordedWords.title} description={unrecordedWords.description} dismissible
                                onDismiss={() => setUnrecorded(false)} />
                        )}
                    </>} footer={<DecisionFooter styles={styles} words={words} slice={slice} line={line} />}>
                    {/* Main is the keyboard's surface and its anchor, never a tab stop: what a verdict or Escape takes away
                        leaves the keyboard here. */}
                    <Box ref={main} css={styles.main} data-decision-main="" tabIndex={-1}>
                        <DecisionList read={read} identity={identity} retained={data.retained} onRangeChange={onRangeChange} value={value}
                            arrivals={arrivals} undoMark={undoMark} open={open} choiceOf={choiceOf} targets={value.targets} records={editing.records}
                            roles={value.decisions.roles} readOnly={readOnly} now={now} words={words} styles={styles} storageKey={key} schedule={schedule}
                            hold={hold} scrollTo={scrollTo} onToggle={onToggle} onChoice={setChoice} onDecide={onDecide} onUndo={onUndo} onArrived={onArrived} />
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
