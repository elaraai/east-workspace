/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The reveal's rule (#1398, CL4), as pure arithmetic: a wait shorter than the
 * delay shows nothing; a longer one shows from the delay on, and at least the
 * hold; a wait that starts while the last is shown keeps it shown.
 */

import { describe, expect, test } from "vitest";
import { REVEAL_DELAY_MS, REVEAL_HOLD_MS, REVEAL_IDLE, revealStep, type RevealState } from "./reveal.js";

/**
 * Runs the reveal over a timeline of `[ms, waiting]` inputs, stepping it at
 * each input and at each time a step asks to be woken at — as the page's timer
 * wakes it — and says whether it showed at each sample time.
 */
function run(inputs: readonly (readonly [number, boolean])[], samples: readonly number[]): boolean[] {
    let state: RevealState = REVEAL_IDLE;
    let waiting = false;
    let wakeAt: number | undefined;
    // Each input and sample in time order, an input before a sample at the same time.
    const events = [...inputs.map(([at, w]) => ({ at, w } as { at: number; w: boolean | undefined })), ...samples.map((at) => ({ at, w: undefined }))]
        .sort((a, b) => a.at - b.at || (a.w === undefined ? 1 : -1));
    const step = (at: number) => {
        const next = revealStep(state, waiting, at);
        state = next.state;
        wakeAt = next.wakeAt;
        return next.shown;
    };
    const shown: boolean[] = [];
    for (const event of events) {
        // The timer fires first where it is due by then.
        while (wakeAt !== undefined && wakeAt <= event.at) step(wakeAt);
        if (event.w !== undefined) waiting = event.w;
        const now = step(event.at);
        if (event.w === undefined) shown.push(now);
    }
    return shown;
}

describe("the reveal (CL4)", () => {
    test("the delay is 150 ms and the hold 300 ms", () => {
        expect([REVEAL_DELAY_MS, REVEAL_HOLD_MS]).toEqual([150, 300]);
    });

    test("a 100 ms wait never shows", () => {
        expect(run([[0, true], [100, false]], [0, 50, 99, 100, 150, 400])).toEqual([false, false, false, false, false, false]);
    });

    test("a 400 ms wait shows from 150 ms, and while it lasts", () => {
        expect(run([[0, true], [400, false]], [149, 150, 300, 399])).toEqual([false, true, true, true]);
        // Ended at 400, it was shown at 150: the hold (to 450) keeps it 50 ms more.
        expect(run([[0, true], [400, false]], [449, 450])).toEqual([true, false]);
    });

    test("a 220 ms wait shows for its hold, 150 → 450 ms, though it ended at 220", () => {
        expect(run([[0, true], [220, false]], [149, 150, 221, 449, 450])).toEqual([false, true, true, true, false]);
    });

    test("a wait that starts during the hold keeps it shown, with no gap", () => {
        // Shown at 150, ended at 200, another starting at 300 (inside the hold to 450) and running to 1,000.
        expect(run([[0, true], [200, false], [300, true], [1000, false]], [250, 300, 449, 451, 999, 1000])).toEqual([true, true, true, true, true, false]);
    });

    test("a wait that starts after the hold waits out its own delay", () => {
        expect(run([[0, true], [200, false], [600, true], [1000, false]], [460, 600, 749, 750])).toEqual([false, false, false, true]);
    });

    test("a step says when to ask again: the delay's end while waiting, the hold's end once the wait is over", () => {
        const waiting = revealStep(REVEAL_IDLE, true, 1000);
        expect([waiting.shown, waiting.wakeAt]).toEqual([false, 1150]);
        const shown = revealStep(waiting.state, true, 1150);
        expect([shown.shown, shown.wakeAt]).toEqual([true, undefined]);
        const ended = revealStep(shown.state, false, 1200);
        expect([ended.shown, ended.wakeAt]).toEqual([true, 1450]);
        const over = revealStep(ended.state, false, 1450);
        expect([over.shown, over.wakeAt, over.state]).toEqual([false, undefined, REVEAL_IDLE]);
    });

    test("other timings follow what they are given", () => {
        const step = revealStep(REVEAL_IDLE, true, 0, { delay: 10, hold: 20 });
        expect(step.wakeAt).toBe(10);
        expect(revealStep(step.state, false, 15, { delay: 10, hold: 20 }).shown).toBe(false);
    });
});
