/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An automatic Save: what sends an editing session's changes without a press
 * of Save, where a person has turned it on for the builder. It decides when;
 * the session decides what ({@link AutosaveTarget.autosave}), and never sends
 * an optimiser's result no person's Save has taken, nor what Undo or Redo
 * stepped to: only where the last change left the steps is an automatic
 * Save's to send (ruled 11 Nov 2026, `EditSession.stepped`).
 *
 * - **After a pause.** A Save is sent once the person has done nothing for
 *   {@link AUTOSAVE_PAUSE_MS}: no gesture recorded, no key pressed, no pointer
 *   let go ({@link Autosave.touch}). Each one starts the pause again, so a
 *   run of edits is one Save, and nothing is sent under a hand still at work.
 * - **Never under a gesture.** While a host says so ({@link Autosave.hold}) —
 *   a pointer held, a drag in flight, an editor open, a run of the optimiser
 *   out — nothing is sent, and a Save due meanwhile goes as the last hold
 *   lifts.
 * - **One request at a time.** While a Save is on its way or read back, the
 *   session has nothing an automatic Save may send; what was drafted meanwhile
 *   goes once it resolves, the pause counted from the person's last act.
 * - **What fails waits longer each time.** A Save that could not be sent, one
 *   the source refused, a write left with no answer and a read back that
 *   failed are tried again by themselves ({@link AutosaveTarget.retry}), each
 *   wait twice the last up to {@link AUTOSAVE_RETRY_MAX_MS}, until one goes
 *   through or the person changes something. A read back that has not moved
 *   for {@link AUTOSAVE_STALLED_MS} is asked for again the same way.
 * - **Before the page goes.** A tab hidden, or a page left, sends at once
 *   what is due ({@link Autosave.flush}).
 *
 * No React and no DOM: its clock, its timer and what it hears of the person
 * are handed in, so it runs under a test's clock as it does in a page
 * (`use-autosave.ts` binds it to one).
 *
 * @packageDocumentation
 */

/** How long the person does nothing before an automatic Save is sent. */
export const AUTOSAVE_PAUSE_MS = 2_000;
/** The longest an automatic Save waits before it tries again what failed. */
export const AUTOSAVE_RETRY_MAX_MS = 60_000;
/** How long a read back may not move before an automatic Save asks for it again. */
export const AUTOSAVE_STALLED_MS = 10_000;

/**
 * Where a target's requests stand, as an automatic Save reads them: none
 * unresolved (`idle`); one on its way (`sending`); a write left with no answer
 * (`unanswered`); a Save's saved state being read back (`readingBack`), or its
 * read back failed (`readBackFailed`).
 */
export type AutosaveState = "idle" | "sending" | "unanswered" | "readingBack" | "readBackFailed";

/**
 * What an automatic Save drives: an editing session, or one history over
 * several, each of which reads as this.
 */
export interface AutosaveTarget {
    /** Hear every change of it. */
    readonly subscribe: (listener: () => void) => () => void;
    /** How many gestures, Undos, Redos and conflict choices it has taken: it moves with each. */
    readonly edits: number;
    /** Whether an automatic Save has a change it may send now. */
    readonly canAutosave: boolean;
    /**
     * Send what an automatic Save may. Settles once the source has answered,
     * or could not be asked: whether the source took it — `false` where it
     * refused it, gave no answer, or was never asked.
     */
    readonly autosave: () => Promise<boolean>;
    /** Where its requests stand. */
    readonly saving: AutosaveState;
    /** Ask again: a write left with no answer is sent again, its id unchanged; a read back is asked for again. */
    readonly retry: () => void;
}

/** The clock and the timer an automatic Save runs on. */
export interface AutosaveClock {
    /** The time now, in milliseconds. */
    readonly now: () => number;
    /** Run something once, after a wait: what cancels it. */
    readonly after: (ms: number, run: () => void) => () => void;
}

/** The page's own clock. */
export const pageClock: AutosaveClock = {
    now: () => Date.now(),
    after: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
    },
};

/**
 * Something under way that no automatic Save is sent under: a pointer held, a
 * drag in flight, an editor open, or a run of the app's optimiser out.
 */
export type AutosaveHold = "pointer" | "drag" | "editor" | "run";

/** An automatic Save over one target — see the module docs. */
export interface Autosave {
    /** Turn it on or off: off, nothing is sent and nothing waits. */
    readonly enable: (on: boolean) => void;
    /** Whether it is on. */
    readonly enabled: () => boolean;
    /** The person acted — a key pressed, a pointer let go: the pause starts again. */
    readonly touch: () => void;
    /** Something no Save is sent under begins (`on`), or ends. */
    readonly hold: (reason: AutosaveHold, on: boolean) => void;
    /**
     * The page is going, or its tab hidden: send now what is due, whatever
     * the pause and whatever the person holds — but never while a run of the
     * optimiser is out, whose result is drafted over what the page holds.
     */
    readonly flush: () => void;
    /** Stop: nothing more is sent, and the target is heard no more. */
    readonly dispose: () => void;
}

/**
 * How long to wait before trying again what failed, by how many times in a
 * row it has: twice the pause, then twice that, up to
 * {@link AUTOSAVE_RETRY_MAX_MS}.
 *
 * @param failures - How many times in a row it has failed
 * @param pause - The pause
 * @returns The wait, in milliseconds
 */
export function autosaveBackoff(failures: number, pause: number = AUTOSAVE_PAUSE_MS): number {
    return Math.min(AUTOSAVE_RETRY_MAX_MS, pause * 2 ** Math.min(Math.max(failures, 0), 16));
}

/**
 * How long a read back may not move before it is asked for again, by how many
 * times it has been: {@link AUTOSAVE_STALLED_MS}, then twice that, up to
 * {@link AUTOSAVE_RETRY_MAX_MS}.
 *
 * @param asked - How many times it has been asked for again
 * @returns The wait, in milliseconds
 */
export function autosaveStalled(asked: number): number {
    return Math.min(AUTOSAVE_RETRY_MAX_MS, AUTOSAVE_STALLED_MS * 2 ** Math.min(Math.max(asked, 0), 16));
}

/** What an automatic Save does next, and when. */
interface Due {
    readonly at: number;
    readonly act: "send" | "retry" | "nudge";
}

/**
 * Makes an automatic Save over a target, off until it is turned on.
 *
 * @param target - The session, or the history, it saves
 * @param clock - The clock and timer it runs on; the page's by default
 * @param pause - How long the person does nothing before a Save is sent
 * @returns The automatic Save
 */
export function createAutosave(target: AutosaveTarget, clock: AutosaveClock = pageClock, pause: number = AUTOSAVE_PAUSE_MS): Autosave {
    let on = false;
    let disposed = false;
    /** When the person last acted: a gesture, a key, a pointer let go. */
    let actedAt = clock.now();
    /** The target's count of gestures as last seen: a move is the person acting. */
    let edits = target.edits;
    /** Where the target's requests stood, as last seen. */
    let state = target.saving;
    /** How many Saves in a row could not be sent, were refused, or were left with no answer. */
    let unsent = 0;
    /** How many read backs in a row have failed. */
    let unread = 0;
    /** When the last of either was seen to fail: what the wait before the next try is counted from. */
    let failedAt = clock.now();
    /** The read back in hand: when it was last seen to move, and how often it has been asked for again since. */
    let readBack: { readonly at: number; readonly asked: number } | undefined;
    /** A try of its own is under way: a Save on its way to the source. */
    let sending = false;
    /** Inside its own ask of the target: what the target says meanwhile is no move of its read back. */
    let asking = false;
    const holds = new Set<AutosaveHold>();
    let cancel: (() => void) | undefined;

    const stop = (): void => {
        cancel?.();
        cancel = undefined;
    };

    /** Takes in what the target says now; `heard` when the target itself said it moved. */
    const look = (heard: boolean): void => {
        // A gesture since it last looked: the person acted, and a Save that could not be sent may go now.
        if (target.edits !== edits) {
            edits = target.edits;
            actedAt = clock.now();
            unsent = 0;
        }
        const now = target.saving;
        if (now !== state) {
            if (now === "unanswered") { unsent += 1; failedAt = clock.now(); }
            // A request the source answered, its saved state read back now: what could not be sent has gone.
            else if (now === "readingBack" && state === "sending") unsent = 0;
            if (now === "readBackFailed") { unread += 1; failedAt = clock.now(); }
            // Read back, or nothing to read back: only a read back asked for again keeps its count.
            else if (now !== "readingBack") unread = 0;
            state = now;
        }
        if (state !== "readingBack") readBack = undefined;
        else if (readBack === undefined || (heard && !asking)) readBack = { at: clock.now(), asked: 0 };
    };

    /** What is due, and when: what failed asked again, a read back asked for again, or a Save. */
    const due = (): Due | undefined => {
        switch (state) {
            case "sending": return undefined;
            case "unanswered": return { at: failedAt + autosaveBackoff(unsent, pause), act: "retry" };
            case "readBackFailed": return { at: failedAt + autosaveBackoff(unread, pause), act: "retry" };
            case "readingBack": return readBack === undefined ? undefined : { at: readBack.at + autosaveStalled(readBack.asked), act: "nudge" };
            case "idle": {
                if (!target.canAutosave) return undefined;
                const paused = actedAt + pause;
                return { at: unsent === 0 ? paused : Math.max(paused, failedAt + autosaveBackoff(unsent, pause)), act: "send" };
            }
        }
    };

    /** Looks at the target again, and waits for what is due. */
    const plan = (heard = false): void => {
        stop();
        if (disposed) return;
        look(heard);
        if (!on || sending || holds.size > 0) return;
        const next = due();
        if (next === undefined) return;
        cancel = clock.after(Math.max(0, next.at - clock.now()), () => {
            cancel = undefined;
            fire();
        });
    };

    /** A wait is over: what is due now is done, or waited for again where the person has acted since. */
    const fire = (): void => {
        if (disposed || !on || sending || holds.size > 0) return;
        look(false);
        const next = due();
        if (next === undefined) return;
        if (next.at > clock.now()) { plan(); return; }
        if (next.act === "send") send();
        else ask(next.act);
    };

    /** Sends what the target may: its own try, until the source has answered or could not be asked. */
    const send = (): void => {
        const at = target.edits;
        sending = true;
        const done = (took: boolean): void => {
            sending = false;
            if (disposed) return;
            look(false);
            // The source did not take it — never asked, or it refused — and the person has done nothing since: the next
            // try waits longer. A write left with no answer is counted as it is seen.
            if (!took && state !== "unanswered" && target.edits === at) { unsent += 1; failedAt = clock.now(); }
            plan();
        };
        let going: Promise<boolean>;
        try { going = target.autosave(); } catch (error) { going = Promise.reject(error instanceof Error ? error : new Error(String(error))); }
        going.then(done, () => done(false));
    };

    /** Asks the target again: what failed, or a read back that has not moved. */
    const ask = (act: "retry" | "nudge"): void => {
        const was = state;
        if (act === "nudge" && readBack !== undefined) readBack = { at: clock.now(), asked: readBack.asked + 1 };
        asking = true;
        try { target.retry(); } finally { asking = false; }
        look(false);
        // Asked, and it stands as it stood: it failed again, at once.
        if (act === "retry" && state === was) {
            if (was === "unanswered") unsent += 1;
            else unread += 1;
            failedAt = clock.now();
        }
        plan();
    };

    const unsubscribe = target.subscribe(() => plan(true));

    return {
        enable: (next) => {
            if (on === next) return;
            on = next;
            // Turned on over changes made before: they go after a pause from now, never at once.
            if (on) { actedAt = clock.now(); unsent = 0; }
            plan();
        },
        enabled: () => on,
        // The wait in hand looks at the time again as it ends: nothing is asked of the target for a key.
        touch: () => { actedAt = clock.now(); },
        hold: (reason, held) => {
            if (held === holds.has(reason)) return;
            if (held) holds.add(reason);
            else holds.delete(reason);
            plan();
        },
        flush: () => {
            if (disposed || !on || sending || holds.has("run")) return;
            look(false);
            if (state === "unanswered" || state === "readBackFailed") { stop(); ask("retry"); return; }
            if (state !== "idle" || !target.canAutosave) return;
            stop();
            send();
        },
        dispose: () => {
            disposed = true;
            stop();
            unsubscribe();
        },
    };
}
