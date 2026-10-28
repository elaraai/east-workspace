/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A run of the app's optimiser, as a builder asks it (#1409, #1414; `Optimise
 * Spec.md` §6, §9.1, R1–R6, R10; O3, O4, D2, D5): the app's `e3.function`,
 * bound as `fit` is and called by name through the shared `Func` runtime
 * (`useFuncCall`). One run per builder instance: {@link OptimiseRun.start}
 * sends one call with the request the builder makes for the run's number —
 * the period in view, every row of it as the session holds it, base plus
 * every unapplied draft — and while the call is out the run counts its
 * seconds and the builder holds its lock. {@link OptimiseRun.stop} cancels
 * the call: a response arriving after it is ignored, and `stopped` holds for
 * 2.5s while the footer says so. A change of scope — the period in view —
 * stops the run as Stop does (O4); a layout, view or filter change does not,
 * and the result lands in the period it was asked of. Unmount aborts. No
 * timeout of the client's: the e3 call's own deadline is the limit (D2).
 *
 * When the result lands the builder is told, with the request it answers and
 * the run's number: it diffs the two by key and records one step
 * ({@link OptimiseArgs.onLanded}), answering what it counted — changes, the
 * `done` outcome; none, the `none` outcome and one blink of the eye; or no
 * answer for an invalid response, a failure. A rejected call, a transport
 * error and a timed-out call are failures too (R10). Runs are numbered per
 * builder per browser, from 1, under the builder's key (D5).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EastType } from "@elaraai/east";
import { usePersistedState } from "@elaraai/east-ui-components";
import { useFuncCall, type FuncCall } from "./use-func-call.js";

/** How long the footer says `Stopped · nothing changed` after Stop (§8): 2.5s. */
export const OPTIMISE_STOPPED_MS = 2500;

/** What a builder counted of a result it landed as one step (R7, R8). */
export interface OptimiseCounts {
    readonly added: number;
    readonly changed: number;
    readonly removed: number;
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
    /** What the function takes. */
    readonly requestType: EastType;
    /** What it answers. */
    readonly resultType: EastType;
    /** The scope in view, by its key — the period: a change stops a run out (O4). */
    readonly scope: string;
    /** The builder's key: the run counter is kept under it (D5). */
    readonly storageKey: string;
    /**
     * The result landed, for the run it was asked of: the builder diffs it
     * against the request by key and records one step (R7, R8), answering
     * what it counted; `undefined` for an invalid response — a key outside
     * the scope, a row of another type — which is a failure (R10, §12).
     */
    readonly onLanded: (result: Res, request: Req, run: number) => OptimiseCounts | undefined;
}

/** What a run came to (R10): its number, the period it was asked of, and what changed. */
export type OptimiseRunOutcome =
    | { readonly kind: "done"; readonly run: number; readonly period: string; readonly counts: OptimiseCounts }
    | { readonly kind: "none"; readonly run: number; readonly period: string }
    | { readonly kind: "fail"; readonly run: number; readonly period: string; readonly message: string };

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

/** A call out: what it asked, for which run, over which scope, and what the channel held before it. */
interface Flight<Req> {
    readonly run: number;
    readonly period: string;
    readonly scope: string;
    readonly request: Req;
    readonly resultBefore: unknown;
    readonly errorBefore: unknown;
    /** Whether the channel was seen running for it: a landing is told from what the channel held before. */
    seenRunning: boolean;
}

/**
 * A run of the app's optimiser (see the module docs).
 *
 * @typeParam Req - The request
 * @typeParam Res - The result
 * @param args - The function, the scope, the builder's key, and what the builder does with a result
 * @returns The run
 */
export function useOptimise<Req, Res>(args: OptimiseArgs<Req, Res>): OptimiseRun<Req> {
    const { name, requestType, resultType, scope, storageKey, onLanded } = args;
    const call = useFuncCall<Res>(name, name === null ? null : [requestType], resultType);
    // Runs are numbered per builder per browser, from 1 (D5).
    const { state: counter, setState: setCounter } = usePersistedState<number>(`${storageKey}.optimise.run`, 0);
    const [running, setRunning] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [seconds, setSeconds] = useState(1);
    const [stopped, setStopped] = useState(false);
    const [outcome, setOutcome] = useState<OptimiseRunOutcome | undefined>(undefined);
    const [blinks, setBlinks] = useState(0);
    const flight = useRef<Flight<Req> | undefined>(undefined);
    const stoppedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // The latest render's call and callback: what the run's effects and commands act through.
    const live = useRef<{ call: FuncCall<Res>; onLanded: OptimiseArgs<Req, Res>["onLanded"] }>({ call, onLanded });
    live.current = { call, onLanded };
    // The call lands (R10): for the run out, told from the channel seen running, or moved on from what it held before.
    useEffect(() => {
        const out = flight.current;
        if (out === undefined) return;
        if (call.pending) { out.seenRunning = true; return; }
        // The same objects the channel held before: nothing has landed yet (a new result is a new object, as a new error is).
        if (!out.seenRunning && Object.is(call.result, out.resultBefore) && Object.is(call.error, out.errorBefore)) return;
        flight.current = undefined;
        setRunning(false);
        if (call.status === "succeeded" && call.result !== null) {
            let counts: OptimiseCounts | undefined;
            try {
                counts = live.current.onLanded(call.result, out.request, out.run);
            } catch (err) {
                console.error("[Optimise] the result could not be landed:", err);
                counts = undefined;
            }
            if (counts === undefined) setOutcome({ kind: "fail", run: out.run, period: out.period, message: "the optimiser's answer could not be used" });
            else if (counts.added + counts.changed + counts.removed === 0) { setOutcome({ kind: "none", run: out.run, period: out.period }); setBlinks((n) => n + 1); }
            else setOutcome({ kind: "done", run: out.run, period: out.period, counts });
        } else if (call.status === "failed") {
            setOutcome({ kind: "fail", run: out.run, period: out.period, message: call.error?.message ?? "the call failed" });
        }
        // A channel cancelled elsewhere: nothing landed, nothing recorded.
    }, [call]);
    // The seconds, from 1, every second while the call is out.
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
        live.current.call.cancel();
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
        if (flight.current !== undefined) { flight.current = undefined; live.current.call.cancel(); }
        if (stoppedTimer.current !== undefined) clearTimeout(stoppedTimer.current);
    }, []);
    const start = useCallback((request: (run: number) => Req, period: string) => {
        if (name === null || flight.current !== undefined) return;
        const run = counter + 1;
        setCounter(run);
        const now = live.current.call;
        const asked = request(run);
        flight.current = { run, period, scope, request: asked, resultBefore: now.result, errorBefore: now.error, seenRunning: false };
        setOutcome(undefined);
        setStopped(false);
        if (stoppedTimer.current !== undefined) { clearTimeout(stoppedTimer.current); stoppedTimer.current = undefined; }
        setStartedAt(Date.now());
        setSeconds(1);
        setRunning(true);
        now.call(asked);
    }, [name, counter, setCounter, scope]);
    const dismiss = useCallback(() => setOutcome(undefined), []);
    return useMemo(() => ({ offered: name !== null, running, seconds, run: counter, start, stop, stopped, outcome, blinks, dismiss }),
        [name, running, seconds, counter, start, stop, stopped, outcome, blinks, dismiss]);
}
