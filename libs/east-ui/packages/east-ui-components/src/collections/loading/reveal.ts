/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The reveal of what a read in flight shows (#1398, CL4): a collection's
 * geometry draws at once, and its placeholder fill and the footer's loading
 * line appear only once a wait passes {@link REVEAL_DELAY_MS}, then stay at
 * least {@link REVEAL_HOLD_MS} once shown — so a quick read never flashes, and
 * a slow one never blinks. The fill and the line share one clock: a builder
 * runs one {@link LoadingReveal} around its frame, and both read it.
 *
 * - A wait shorter than the delay shows nothing.
 * - A wait longer than the delay shows from the delay on, until the later of
 *   its end and the hold's.
 * - A wait that starts while the last is still shown — held, or in flight —
 *   keeps it shown: the slot never empties between two reads.
 *
 * Cold load is not a wait: a builder's first read keeps its skeleton, with no
 * delay and no timeout (BuilderFrame's `loading`).
 *
 * {@link revealStep} is the rule as pure arithmetic over a clock the caller
 * reads; {@link useLoadingReveal} runs it on the page's timers; and
 * {@link LoadingReveal} runs it for a whole builder, its parts reading it
 * where they show ({@link useRevealed}) — so the clock's flips re-render those
 * parts alone, never the builder around them.
 *
 * @packageDocumentation
 */

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";

/** How long a wait runs before its fill and the footer's loading line show (CL4). */
export const REVEAL_DELAY_MS = 150;

/** How long the fill and the line stay once shown, however soon the wait ends (CL4). */
export const REVEAL_HOLD_MS = 300;

/** Where the reveal is: when the current wait began, and when what it shows was first shown. */
export interface RevealState {
    /** When the wait in progress began; `undefined` while nothing is waited on. */
    readonly since: number | undefined;
    /** When what the wait shows appeared; `undefined` while nothing shows. */
    readonly shownAt: number | undefined;
}

/** Nothing waited on, and nothing shown. */
export const REVEAL_IDLE: RevealState = { since: undefined, shownAt: undefined };

/** One step of the reveal: where it is now, whether it shows, and when it next needs asking. */
export interface RevealStep {
    /** The state to carry into the next step. */
    readonly state: RevealState;
    /** Whether the fill and the line show now. */
    readonly shown: boolean;
    /** When the answer can next change by time alone — the delay running out, or the hold — or `undefined` when only a new input can change it. */
    readonly wakeAt: number | undefined;
}

/** The reveal's timings: the delay before it shows, and the least it then stays. */
export interface RevealTimings {
    readonly delay: number;
    readonly hold: number;
}

const TIMINGS: RevealTimings = { delay: REVEAL_DELAY_MS, hold: REVEAL_HOLD_MS };

/**
 * One step of the reveal (see the module docs).
 *
 * @param state - Where the reveal was
 * @param waiting - Whether a read is in flight now
 * @param now - The clock's time now, in ms
 * @param timings - The delay and the hold; CL4's unless given
 * @returns Where it is now, whether it shows, and when to ask again
 */
export function revealStep(state: RevealState, waiting: boolean, now: number, timings: RevealTimings = TIMINGS): RevealStep {
    const { delay, hold } = timings;
    // Shown: it stays while the wait goes on, and for the hold after it shows, whatever starts or ends meanwhile.
    if (state.shownAt !== undefined) {
        const held = state.shownAt + hold;
        if (waiting) return { state: { since: state.since ?? now, shownAt: state.shownAt }, shown: true, wakeAt: undefined };
        if (now < held) return { state: { since: undefined, shownAt: state.shownAt }, shown: true, wakeAt: held };
        return { state: REVEAL_IDLE, shown: false, wakeAt: undefined };
    }
    if (!waiting) return { state: REVEAL_IDLE, shown: false, wakeAt: undefined };
    const since = state.since ?? now;
    const due = since + delay;
    if (now >= due) return { state: { since, shownAt: due }, shown: true, wakeAt: undefined };
    return { state: { since, shownAt: undefined }, shown: false, wakeAt: due };
}

/** The page's clock: what the reveal reads the time by. */
function now(): number {
    return Date.now();
}

/** What the hook holds: where the reveal is, and whether it shows. */
interface Revealed {
    readonly state: RevealState;
    readonly shown: boolean;
}

/** Nothing waited on, and nothing shown. */
const HIDDEN: Revealed = { state: REVEAL_IDLE, shown: false };

/**
 * Whether a read in flight shows its fill and the footer's loading line yet
 * (CL4) — after {@link REVEAL_DELAY_MS} of waiting, and for at least
 * {@link REVEAL_HOLD_MS} once shown. One clock per builder: hand the answer to
 * the placeholder fill and to the footer's loading line alike.
 *
 * Where the reveal is is state, which a render adjusts as it renders — React's
 * adjusting state while rendering, taken again before the render commits —
 * never a ref written as it renders: a render React throws away keeps no step
 * of its own, and a read landing is still one commit, the reveal's step in it.
 * A wake time — the delay running out, the hold — is a timer's re-render.
 *
 * @param waiting - Whether a read the view needs is in flight
 * @param timings - The delay and the hold; CL4's unless given
 * @returns Whether its fill and its line show
 */
export function useLoadingReveal(waiting: boolean, timings: RevealTimings = TIMINGS): boolean {
    const [revealed, setRevealed] = useState<Revealed>(HIDDEN);
    // Bumped when the clock passes a wake time, so the step is taken again.
    const [tick, setTick] = useState(0);
    const step = revealStep(revealed.state, waiting, now(), timings);
    const moved = step.shown !== revealed.shown
        || step.state.since !== revealed.state.since || step.state.shownAt !== revealed.state.shownAt;
    if (moved) setRevealed({ state: step.state, shown: step.shown });
    const { wakeAt } = step;
    useEffect(() => {
        if (wakeAt === undefined) return undefined;
        const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, wakeAt - now()));
        return () => clearTimeout(timer);
    }, [wakeAt, tick]);
    return step.shown;
}

/** The reveal a builder's parts show by: `undefined` outside a {@link LoadingReveal}. */
const RevealContext = createContext<boolean | undefined>(undefined);

/** Props of {@link LoadingReveal}. */
export interface LoadingRevealProps {
    /** Whether a read the view needs is in flight: what the builder's footer line says while it is. */
    readonly waiting: boolean;
    /** The builder's frame, which the clock's flips never render again. */
    readonly children?: ReactNode;
    /** The delay and the hold; CL4's unless given. */
    readonly timings?: RevealTimings | undefined;
}

/**
 * A builder's one reveal clock (CL4), for every part of its frame that shows
 * a read in flight: the footer's loading line, the placeholder shapes and
 * washes, an unloaded run's fill. Each reads it where it shows
 * ({@link useRevealed}), so the clock flipping — at the delay, at the hold's
 * end — renders the clock and those parts again, never the builder: its
 * frame is `children`, made by the builder's own render, which a flip does
 * not repeat. It draws nothing of its own, so the frame's box is the
 * builder's still.
 *
 * @param props - Whether a read is in flight, and the builder's frame
 * @returns The frame, under the clock
 */
export function LoadingReveal({ waiting, children, timings }: LoadingRevealProps): ReactNode {
    const shown = useLoadingReveal(waiting, timings);
    return createElement(RevealContext.Provider, { value: shown }, children);
}

/**
 * Whether the builder's reveal shows a read in flight now — its fill and its
 * footer line — from the {@link LoadingReveal} around; `undefined` outside
 * one, where a part shows as its caller says.
 *
 * @returns The reveal, or `undefined` with none around
 */
export function useRevealed(): boolean | undefined {
    return useContext(RevealContext);
}
