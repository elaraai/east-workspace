/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A run of the app's optimiser, as a builder asks it (#1409, #1414,
 * east-workspace#1622; `Optimise Spec.md` §6, §9.1, R1–R6, R10; O3, O4, D2,
 * D5): the app's `e3.function`, bound as `fit` is and called by name through
 * the shared `Func` runtime (`useFuncCall`). One run per builder instance:
 * {@link OptimiseRun.start} sends one call with the request the builder makes
 * for the run's number — the period in view and the page's narrowing, no row
 * — and, after it, the pending Save of each of the builder's sessions over a
 * record the function lists in `drafts`, as a draft
 * ({@link OptimiseSessions.drafts}): e3 lays them over the records, the
 * function reads what it needs so, and nothing is saved. While the run is
 * out it counts its seconds and the builder holds its lock.
 * {@link OptimiseRun.stop} cancels the call: a response arriving after it is
 * ignored, and `stopped` holds for 2.5s while the footer says so. A change of
 * scope — the period in view — stops the run as Stop does (O4); a layout,
 * view or filter change does not, and the result lands in the period it was
 * asked of. Unmount aborts. No timeout of the client's: the e3 call's own
 * deadline is the limit (D2).
 *
 * The answer is a patch of each record the builder edits, against the record
 * as the call read it with the drafts laid over it. Before it lands:
 *
 * - **The same base** (rule 9). The call read each record at the commit it
 *   stood at, which may be newer than the page holds. The page reads each
 *   record the function lists in `drafts` once more, from the answer on —
 *   whether or not the run had an edit of it to hand over: the answer is
 *   against the record as the function read it either way — and the
 *   builder's sessions take in whatever newer saves that read brings, as they
 *   take any save by another page ({@link OptimiseSessions.settled}); then
 *   the answer lands.
 * - **Rows the page does not hold** (rule 8). The builder names the rows the
 *   answer touches that it does not hold, reads them by their keys, and is
 *   asked again as its reads move ({@link OptimiseWaiting}).
 *
 * Then the builder lands it as one step ({@link OptimiseArgs.onLanded}),
 * answering what it counted — changes, the `done` outcome; none, the `none`
 * outcome and one blink of the eye; a refusal, a failure saying why — an
 * answer that would change what the builder takes no edit of (#1553, rule 11);
 * or no answer for an invalid response, a failure. A rejected call, a
 * transport error and a timed-out call are failures too (R10).
 *
 * **A record that changed under the edits** (rule 12). A call the source
 * refused because another write got there first lands nothing, and takes the
 * path a Save refused for the same reason takes: the page reads the records
 * again, the sessions carry their edits over the newer saves, and with
 * nothing to choose the call goes again by itself with the new drafts — as
 * many times in a row as a session sends a refused Save again
 * (`SAVE_RESENDS`) — the run out meanwhile. With a conflict to choose, the
 * run ends saying so in the refused Save's words
 * ({@link OptimiseSessions.conflicts}), and the person chooses before running
 * again.
 *
 * Runs are numbered per builder per browser, from 1, under the builder's key
 * (D5).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EastType } from "@elaraai/east";
import { usePersistedState } from "@elaraai/east-ui-components";
import { SAVE_RESENDS, keptRead } from "@elaraai/east-ui-components/internal";
import { defaultRecordRuntime } from "../../platform/index.js";
import { useFuncCall, type FuncCallBinding, type FuncCallDraft } from "./use-func-call.js";

/** How long the footer says `Stopped · nothing changed` after Stop (§8): 2.5s. */
export const OPTIMISE_STOPPED_MS = 2500;

/** What a builder counted of a result it landed as one step (R7, R8). */
export interface OptimiseCounts {
    readonly added: number;
    readonly changed: number;
    readonly removed: number;
}

/**
 * A result the builder would not land (#1553): why, in its words — the
 * banner's line — such as an answer changing a duty of a published week.
 */
export interface OptimiseRefused {
    readonly refused: string;
}

/**
 * An answer that cannot land yet (rule 8): it touches rows the builder does
 * not hold, which the builder is reading by their keys. The run stays out,
 * and asks again as the builder's reads move ({@link OptimiseArgs.settleKey}).
 */
export interface OptimiseWaiting {
    readonly waiting: true;
}

/**
 * The builder's sessions over the records it edits, as a run asks them
 * (east-workspace#1622): its unsaved edits as drafts, whether they stand on
 * what the page has read, and whether a conflict waits to be chosen. Read as
 * the run asks, never kept: each answer is of the sessions as they stand.
 */
export interface OptimiseSessions {
    /**
     * The pending Save of each session over a record the function lists in
     * `drafts`, as a draft (#1620): every unsaved edit that is complete, the
     * ones a narrowing hides and the ones off screen among them, whether or
     * not a check holds Save. A session with nothing unsaved hands over none.
     *
     * @param listed - The records the function lists in `drafts`, by name
     * @returns The drafts; or why none can be made now — a Save of a session's own still on its way, in its words
     */
    drafts(listed: readonly string[]): readonly FuncCallDraft[] | OptimiseRefused;
    /**
     * Whether the sessions over the records named stand on what the page has
     * read of them: none is carrying its drafts over to a record that moved,
     * or has yet to be told its record did.
     *
     * @param records - The records, by name
     */
    settled(records: readonly string[]): boolean;
    /**
     * The conflicts the sessions over the records named hold for the person to
     * choose, in the refused Save's words — `2 of your changes conflict with
     * newer changes`; `undefined` with none.
     *
     * @param records - The records, by name
     */
    conflicts(records: readonly string[]): string | undefined;
}

/**
 * What a run asks, and what the builder does with its answer.
 *
 * @typeParam Req - The request: the builder's `OptimiseRequest`
 * @typeParam Res - The result: its `OptimiseResult`
 */
export interface OptimiseArgs<Req, Res> {
    /** The bound optimiser's name; `null` without one, and there is no eye. */
    readonly name: string | null;
    /** What the function lists in `drafts` and reads, as its binding names them: one that lists none is called with its request alone. */
    readonly binding: FuncCallBinding;
    /** The builder's sessions over the records it edits. */
    readonly sessions: OptimiseSessions;
    /**
     * What moves as the builder's sessions and its reads do — their versions, by identity: a landing that waits for the
     * sessions to take newer saves in, or for rows read by their keys, is tried again as it moves.
     */
    readonly settleKey: unknown;
    /** What the function takes. */
    readonly requestType: EastType;
    /** What it answers. */
    readonly resultType: EastType;
    /** The scope in view, by its key — the period: a change stops a run out (O4). */
    readonly scope: string;
    /** The builder's key: the run counter is kept under it (D5). */
    readonly storageKey: string;
    /**
     * The result landed, for the run it was asked of: the builder lands each
     * record's patch key by key on the rows it holds and records one step
     * (rules 7 and 10), answering what it counted; a refusal, recording
     * nothing, for an answer it would not take, naming why (#1553, rule 11);
     * {@link OptimiseWaiting} where the answer touches rows it does not hold,
     * which it reads by their keys (rule 8) — it is asked again as its reads
     * move; `undefined` for an invalid response — a patch that does not fit
     * the rows, a row of another type — which is a failure (R10, §12).
     */
    readonly onLanded: (result: Res, request: Req, run: number) => OptimiseCounts | OptimiseRefused | OptimiseWaiting | undefined;
}

/** What a run came to (R10): its number, the period it was asked of, and what changed — or why not, `refused` the builder's words where it refused the answer (#1553). */
export type OptimiseRunOutcome =
    | { readonly kind: "done"; readonly run: number; readonly period: string; readonly counts: OptimiseCounts }
    | { readonly kind: "none"; readonly run: number; readonly period: string }
    | { readonly kind: "fail"; readonly run: number; readonly period: string; readonly message: string; readonly refused?: string };

/**
 * A run of the app's optimiser (see the module docs).
 *
 * @typeParam Req - The request
 */
export interface OptimiseRun<Req> {
    /** Whether the app bound an optimiser: the eye shows only then. */
    readonly offered: boolean;
    /** Whether a call is out: the eye runs, the footer counts, the builder holds its lock (R2). */
    readonly running: boolean;
    /** The seconds since the call left, from 1, while a call is out. */
    readonly seconds: number;
    /** The latest run's number: the call out, or the last that landed or stopped; 0 before any. */
    readonly run: number;
    /**
     * Starts a run (R1): one call with the request the builder makes for the
     * run's number, over the period named. Nothing while one is out, or with
     * no optimiser.
     *
     * @param request - The request for the run's number
     * @param period - The period's label — `W11` — which the outcome names
     */
    start(request: (run: number) => Req, period: string): void;
    /** Stops the run out (R3): the call cancelled, a late response ignored, nothing recorded. */
    stop(): void;
    /** Whether the footer says `Stopped · nothing changed`: for 2.5s after Stop. */
    readonly stopped: boolean;
    /** What the last run came to; `undefined` until one lands, after `dismiss`, and from the next `start`. */
    readonly outcome: OptimiseRunOutcome | undefined;
    /** Moves at each run that landed with nothing to change: the eye blinks once each time. */
    readonly blinks: number;
    /** Clears the outcome: the banner dismissed. */
    dismiss(): void;
}

/** A run out: what it asked, for which run, over which scope, and where its call stands. */
interface Flight<Req, Res> {
    readonly run: number;
    readonly period: string;
    readonly scope: string;
    readonly request: Req;
    /** What the channel held before the call out, a landing told from it. */
    resultBefore: unknown;
    errorBefore: unknown;
    /** Whether the channel was seen running for the call out: a landing is told from what the channel held before. */
    seenRunning: boolean;
    /** The records the call out passed drafts of, by name. */
    drafted: readonly string[];
    /** How many times in a row the call was refused because a record moved under its drafts, and sent again (rule 12). */
    resent: number;
    /**
     * The call answered, and what the run waits for before it goes on: the page's read of each record it names again,
     * from the answer on (`read` once it has), then — an answer — its landing, or — a refusal for a conflict — its
     * drafts again.
     */
    answered?: { readonly result: Res; readonly records: readonly string[]; read: boolean }
        | { readonly conflict: string; readonly records: readonly string[]; read: boolean };
}

/**
 * A run of the app's optimiser (see the module docs).
 *
 * @typeParam Req - The request
 * @typeParam Res - The result
 * @param args - The function and what it lists, the scope, the builder's key and its sessions, and what the builder does with a result
 * @returns The run
 */
export function useOptimise<Req, Res>(args: OptimiseArgs<Req, Res>): OptimiseRun<Req> {
    const { name, binding, sessions, settleKey, requestType, resultType, scope, storageKey, onLanded } = args;
    const call = useFuncCall<Res>(name, name === null ? null : [requestType], resultType, binding);
    // Runs are numbered per builder per browser, from 1 (D5).
    const { state: counter, setState: setCounter } = usePersistedState<number>(`${storageKey}.optimise.run`, 0, keptRead.number);
    const [running, setRunning] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [seconds, setSeconds] = useState(1);
    const [stopped, setStopped] = useState(false);
    const [outcome, setOutcome] = useState<OptimiseRunOutcome | undefined>(undefined);
    const [blinks, setBlinks] = useState(0);
    // Moves as a record a run waits on has been read again: the run goes on from there.
    const [readAgain, setReadAgain] = useState(0);
    const flight = useRef<Flight<Req, Res> | undefined>(undefined);
    const stoppedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // The latest render's call, sessions and callback: what the run's effects and commands act through.
    const live = useRef({ call, binding, sessions, onLanded });
    live.current = { call, binding, sessions, onLanded };
    // The run over: nothing out, and what it came to.
    const finish = useCallback((ended: OptimiseRunOutcome | undefined) => {
        flight.current = undefined;
        setRunning(false);
        if (ended === undefined) return;
        setOutcome(ended);
        if (ended.kind === "none") setBlinks((n) => n + 1);
    }, []);
    /**
     * Sends the run's call: the request, and after it the sessions' drafts of the records the function lists. A run
     * whose sessions cannot hand their edits over now ends saying why.
     */
    const send = useCallback((out: Flight<Req, Res>) => {
        const now = live.current;
        const listed = now.binding.drafts;
        const handed = listed.length === 0 ? [] : now.sessions.drafts(listed);
        if ("refused" in handed) {
            finish({ kind: "fail", run: out.run, period: out.period, message: handed.refused, refused: handed.refused });
            return;
        }
        out.resultBefore = now.call.result;
        out.errorBefore = now.call.error;
        out.seenRunning = false;
        out.drafted = [...new Set(handed.map((draft) => draft.record))];
        delete out.answered;
        // A function that lists drafts takes them after its request, none among them; one that lists none takes its request alone.
        if (listed.length === 0) now.call.call(out.request);
        else now.call.call(out.request, [...handed]);
    }, [finish]);
    /**
     * The page reads each record again, from here on (rules 9 and 12): the run goes on once it has — the same run, by
     * its answer, where neither Stop nor another run came first.
     */
    const read = useCallback((out: Flight<Req, Res>) => {
        const answered = out.answered;
        if (answered === undefined) return;
        void Promise.all(answered.records.map((record) => defaultRecordRuntime.readAgain(record))).then(() => {
            if (flight.current !== out || out.answered !== answered) return;
            answered.read = true;
            setReadAgain((n) => n + 1);
        });
    }, []);
    // The call lands (R10): for the run out, told from the channel seen running, or moved on from what it held before.
    useEffect(() => {
        const out = flight.current;
        if (out === undefined || out.answered !== undefined) return;
        if (call.pending) { out.seenRunning = true; return; }
        // The same objects the channel held before: nothing has landed yet (a new result is a new object, as a new error is).
        if (!out.seenRunning && Object.is(call.result, out.resultBefore) && Object.is(call.error, out.errorBefore)) return;
        if (call.status === "succeeded" && call.result !== null) {
            // The answer is against each record as the call read it: the page reads those the function lists in `drafts`
            // once more before it lands (rule 9), an edit of them handed over or none.
            out.answered = { result: call.result, records: live.current.binding.drafts, read: false };
            read(out);
        } else if (call.status === "failed" && call.error?.kind.type === "conflict") {
            // A record moved under the drafts: nothing lands, and the sessions take the newer saves in (rule 12).
            out.answered = { conflict: call.error.message, records: out.drafted, read: false };
            read(out);
        } else if (call.status === "failed") {
            finish({ kind: "fail", run: out.run, period: out.period, message: call.error?.message ?? "the call failed" });
        } else {
            // A channel cancelled elsewhere: nothing landed, nothing recorded.
            finish(undefined);
        }
    }, [call, read, finish]);
    // The run goes on from its answer, once the page has read the records again and the sessions stand on what it read:
    // an answer lands, and a call refused for a conflict goes again with the new drafts, or ends where one is to choose.
    useEffect(() => {
        const out = flight.current;
        const answered = out?.answered;
        if (out === undefined || answered === undefined || !answered.read) return;
        const now = live.current;
        if (!now.sessions.settled(answered.records)) return;
        if ("conflict" in answered) {
            const toChoose = now.sessions.conflicts(answered.records);
            if (toChoose !== undefined) finish({ kind: "fail", run: out.run, period: out.period, message: toChoose, refused: toChoose });
            else if (out.resent >= SAVE_RESENDS) finish({ kind: "fail", run: out.run, period: out.period, message: answered.conflict });
            else { out.resent++; send(out); }
            return;
        }
        let landed: OptimiseCounts | OptimiseRefused | OptimiseWaiting | undefined;
        try {
            landed = now.onLanded(answered.result, out.request, out.run);
        } catch (err) {
            console.error("[Optimise] the result could not be landed:", err);
            landed = undefined;
        }
        // Rows the answer touches are read by their keys: asked again as the builder's reads move (rule 8).
        if (landed !== undefined && "waiting" in landed) return;
        if (landed === undefined) finish({ kind: "fail", run: out.run, period: out.period, message: "the optimiser's answer could not be used" });
        else if ("refused" in landed) finish({ kind: "fail", run: out.run, period: out.period, message: landed.refused, refused: landed.refused });
        else if (landed.added + landed.changed + landed.removed === 0) finish({ kind: "none", run: out.run, period: out.period });
        else finish({ kind: "done", run: out.run, period: out.period, counts: landed });
    }, [readAgain, settleKey, send, finish]);
    // The seconds, from 1, every second while the run is out.
    useEffect(() => {
        if (!running) return undefined;
        // Rounded, as the mock's counter is: `2 s` from a second and a half out.
        const tick = () => setSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [running, startedAt]);
    const stop = useCallback(() => {
        const out = flight.current;
        if (out === undefined) return;
        flight.current = undefined;
        // A call still out is cancelled; one answered has nothing left to cancel, and its answer is let go.
        if (out.answered === undefined) live.current.call.cancel();
        setRunning(false);
        setStopped(true);
        if (stoppedTimer.current !== undefined) clearTimeout(stoppedTimer.current);
        stoppedTimer.current = setTimeout(() => { stoppedTimer.current = undefined; setStopped(false); }, OPTIMISE_STOPPED_MS);
    }, []);
    // A change of scope stops the run as Stop does (O4).
    useEffect(() => {
        const out = flight.current;
        if (out !== undefined && out.scope !== scope) stop();
    }, [scope, stop]);
    // Unmount aborts the call, and lets the stopped note's timer go.
    useEffect(() => () => {
        const out = flight.current;
        if (out !== undefined) { flight.current = undefined; if (out.answered === undefined) live.current.call.cancel(); }
        if (stoppedTimer.current !== undefined) clearTimeout(stoppedTimer.current);
    }, []);
    const start = useCallback((request: (run: number) => Req, period: string) => {
        if (name === null || flight.current !== undefined) return;
        const run = counter + 1;
        setCounter(run);
        const out: Flight<Req, Res> = { run, period, scope, request: request(run), resultBefore: undefined, errorBefore: undefined, seenRunning: false, drafted: [], resent: 0 };
        flight.current = out;
        setOutcome(undefined);
        setStopped(false);
        if (stoppedTimer.current !== undefined) { clearTimeout(stoppedTimer.current); stoppedTimer.current = undefined; }
        setStartedAt(Date.now());
        setSeconds(1);
        setRunning(true);
        send(out);
    }, [name, counter, setCounter, scope, send]);
    const dismiss = useCallback(() => setOutcome(undefined), []);
    return useMemo(() => ({ offered: name !== null, running, seconds, run: counter, start, stop, stopped, outcome, blinks, dismiss }),
        [name, running, seconds, counter, start, stop, stopped, outcome, blinks, dismiss]);
}
