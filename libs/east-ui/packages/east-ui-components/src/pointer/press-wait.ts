/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Waits out a press (#1673): runs a step once no press is in progress and the
 * click the last one made has landed — at once, where no press is in progress.
 * A part held still under a popover waits for it before it lets go: a popover
 * shuts at the press outside it, before that press clicks, so a part that let
 * go then would move under the pointer, and the press would click what moved
 * there — not the chip it was on.
 *
 * Or runs it as the press lets go (east-workspace#1779): as its last pointer is
 * released, heard ahead of the click the release makes, which lands on what was
 * pressed whatever the step moves — so what that click does hears the step's
 * work. A tags input makes what is typed in it a tag then, as a press outside it
 * lets go: made as the press began, the tag moved the Save under its field down
 * from under the pointer, and the press clicked nothing; made once the click had
 * landed, the Save would not have had it.
 *
 * A press is in progress from its pointer's `pointerdown` until it ends, the
 * ways a drag a part follows ends (`follow-pointer.ts`): its pointer released
 * or taken back by the browser, a mouse moving with no button held — released
 * where the window could not hear it — or the window losing the page, when no
 * release may ever be heard. A release clicks in the task it is heard in, so a
 * step that waits out the press waits one task past it.
 *
 * The presses are heard at the window in its capture phase, from the moment
 * the wait is made ({@link usePressWait}, {@link usePressRelease}: as its part
 * mounts) — ahead of the listeners a popover adds as it opens, so a press that
 * shuts one is in progress by the time the popover says it has shut, and ahead
 * of the page's own, so a step run as a press lets go runs before anything on
 * the page hears the release.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useRef } from "react";

/** A wait for the presses in progress at one window. */
export interface PressWait {
    /**
     * Runs a step once no press is in progress and the click the last made has landed — at once where none is.
     *
     * @param run - The step
     * @returns What cancels it, while it waits
     */
    readonly after: (run: () => void) => () => void;
    /**
     * Runs a step as the press in progress lets go — its last pointer released, ahead of the click the release makes —
     * or ends any other way; at once where none is.
     *
     * @param run - The step
     * @returns What cancels it, while it waits
     */
    readonly atRelease: (run: () => void) => () => void;
    /** Stops hearing the window: a step still waiting never runs. */
    readonly stop: () => void;
}

/**
 * A wait for the presses in progress at a window (see the module docs).
 *
 * @param win - The window whose presses it hears
 * @returns The wait
 */
export function pressWait(win: Window): PressWait {
    const pressed = new Set<number>();
    const waiting = new Set<() => void>();
    const releasing = new Set<() => void>();
    let timer: number | undefined;
    // The steps waiting run once no press is in progress: in the task after the last release, which clicks in its own.
    const settle = (): void => {
        if (pressed.size > 0 || waiting.size === 0 || timer !== undefined) return;
        timer = win.setTimeout(() => {
            timer = undefined;
            if (pressed.size > 0) return;
            const steps = [...waiting];
            waiting.clear();
            for (const run of steps) run();
        }, 0);
    };
    // The steps waiting for the press to let go run as it does: in the release's own hearing, ahead of its click.
    const letGo = (): void => {
        if (pressed.size > 0 || releasing.size === 0) return;
        const steps = [...releasing];
        releasing.clear();
        for (const run of steps) run();
    };
    const ended = (pointerId: number): void => {
        if (!pressed.delete(pointerId)) return;
        letGo();
        settle();
    };
    const lost = (): void => {
        pressed.clear();
        letGo();
        settle();
    };
    const down = (event: PointerEvent): void => { pressed.add(event.pointerId); };
    const up = (event: PointerEvent): void => { ended(event.pointerId); };
    // A mouse moving with no button held was released where the window could not hear it.
    const move = (event: PointerEvent): void => { if (event.buttons === 0 && event.pointerType === "mouse") ended(event.pointerId); };
    const hidden = (): void => { if (win.document.visibilityState === "hidden") lost(); };
    const listeners: readonly (readonly [EventTarget, string, EventListener, boolean])[] = [
        [win, "pointerdown", down as EventListener, true],
        [win, "pointerup", up as EventListener, true],
        [win, "pointercancel", up as EventListener, true],
        [win, "pointermove", move as EventListener, true],
        [win, "blur", lost, false],
        [win.document, "visibilitychange", hidden, false],
    ];
    for (const [target, type, listener, capture] of listeners) target.addEventListener(type, listener, capture);
    // A step held in one of the sets until the press it waits on lets it run — at once where none is in progress.
    const hold = (steps: Set<() => void>, run: () => void): (() => void) => {
        if (pressed.size === 0) {
            run();
            return () => undefined;
        }
        // One step, waiting once: a function given twice waits as two.
        const step = (): void => run();
        steps.add(step);
        return () => { steps.delete(step); };
    };
    return {
        after: (run) => hold(waiting, run),
        atRelease: (run) => hold(releasing, run),
        stop: () => {
            for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture);
            if (timer !== undefined) win.clearTimeout(timer);
            timer = undefined;
            waiting.clear();
            releasing.clear();
            pressed.clear();
        },
    };
}

/**
 * A part's wait (see the module docs), heard from its mount to its unmount — a step still waiting as it unmounts never
 * runs — and the step of it the part takes.
 *
 * @param step - Which of the wait's steps: once the press has ended and clicked, or as it lets go
 * @returns Runs a step as that one says — at once where no press is in progress — and returns what cancels it
 */
function usePartWait(step: "after" | "atRelease"): (run: () => void) => () => void {
    const wait = useRef<PressWait | null>(null);
    useLayoutEffect(() => {
        const made = pressWait(window);
        wait.current = made;
        return () => {
            made.stop();
            wait.current = null;
        };
    }, []);
    return useCallback((run: () => void) => {
        const held = wait.current;
        if (held !== null) return held[step](run);
        run();
        return () => undefined;
    }, [step]);
}

/**
 * A part's wait for the press in progress (see the module docs), heard from
 * its mount to its unmount: a step still waiting as it unmounts never runs.
 *
 * @returns Runs a step once no press is in progress — at once where none is — and returns what cancels it
 */
export function usePressWait(): (run: () => void) => () => void {
    return usePartWait("after");
}

/**
 * A part's wait for the press in progress to let go (see the module docs), heard from its mount to its unmount: a step
 * still waiting as it unmounts never runs.
 *
 * @returns Runs a step as the press in progress lets go, ahead of its click — at once where none is — and returns what
 * cancels it
 */
export function usePressRelease(): (run: () => void) => () => void {
    return usePartWait("atRelease");
}
