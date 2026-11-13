/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The narrow layout's two-finger pan (§10 / #570), over the shared pointer
 * core it runs on (east-ui-components' `src/pointer/`): what the list's
 * gestures do (`twoFingerPan`), fed fingers as a surface feeds them.
 */

import { describe, it, expect } from "vitest";
import { makeGestures, type PointerState } from "@elaraai/east-ui-components/internal";
import { newTwoFingerPan, panPeriods, twoFingerPan } from "./pan";

/** A finger at a place: the page's first — no other down — is the browser's primary pointer. */
const finger = (id: number, x: number, primary = false): PointerState => ({ id, kind: "touch", at: { x, y: 0 }, primary, buttons: 1 });

/** A list 30px a period, its gestures and each pan it was told. */
function list(periodPx = 30) {
    const pans: number[] = [];
    const gestures = makeGestures<null>(twoFingerPan(newTwoFingerPan(), () => periodPx, (periods) => { pans.push(periods); }));
    return { pans, down: (p: PointerState) => gestures.down(p, null), move: (p: PointerState) => gestures.move(p, null), up: (p: PointerState) => gestures.up(p, null), gestures };
}

describe("two-finger pan (§10 / #570)", () => {
    it("one finger never pans — page scroll stays vertical", () => {
        const { pans, down, move } = list();
        down(finger(1, 100, true));
        move(finger(1, 0));
        move(finger(1, -500));
        expect(pans).toEqual([]);
    });

    it("two fingers dragged left pan one period per period width — later in time", () => {
        const { pans, down, move } = list();
        down(finger(1, 100, true));
        down(finger(2, 140));                 // centroid 120
        // One finger moves 30px: the centroid moves 15 — under a period.
        move(finger(1, 70));
        expect(pans).toEqual([]);
        // The other catches up: 30px of centroid travel — one period, later.
        move(finger(2, 110));
        // A big jump of one finger (60px → centroid 30px) crosses one edge…
        move(finger(1, 10));
        // …and a 120px jump of the other (centroid 60px) crosses two.
        move(finger(2, -10));
        // Back the other way: earlier.
        move(finger(1, 70));
        expect(pans).toEqual([1, 1, 2, -1]);
    });

    it("lifting a finger ends the pan and forgets the partial travel", () => {
        const { pans, down, move, up } = list();
        down(finger(1, 100, true));
        down(finger(2, 140));
        move(finger(1, 80));                  // 10px of travel banked
        up(finger(2, 140));
        down(finger(3, 200));                 // a new second finger
        // The pan begins afresh; the banked 10px is gone.
        move(finger(3, 175));
        expect(pans).toEqual([]);
        move(finger(1, 30));
        expect(pans).toEqual([1]);
    });

    it("a finger whose lift is never heard is no finger of a later pan: the page's next first finger alone pans nothing, and two pan as two", () => {
        const { pans, down, move } = list();
        down(finger(1, 100, true));
        // Its lift is never heard. The next touch's finger is the page's first.
        down(finger(3, 100, true));
        move(finger(3, 0));
        expect(pans).toEqual([]);
        down(finger(4, 140));
        move(finger(3, -30));
        move(finger(4, 110));
        expect(pans).toEqual([1]);
    });

    it("a third finger pans nothing, and the two held longest pan on", () => {
        const { pans, down, move } = list();
        down(finger(1, 100, true));
        down(finger(2, 140));
        down(finger(3, 400));
        move(finger(3, 0));
        expect(pans).toEqual([]);
        move(finger(1, 70));
        move(finger(2, 110));
        expect(pans).toEqual([1]);
    });
});

describe("the periods a pan's travel crosses", () => {
    it("takes whole periods out of the travel, either way, and keeps what is left", () => {
        expect(panPeriods(0, -15, 30)).toEqual({ travel: -15, periods: 0 });
        expect(panPeriods(-15, -15, 30)).toEqual({ travel: 0, periods: 1 });
        expect(panPeriods(-10, -65, 30)).toEqual({ travel: -15, periods: 2 });
        expect(panPeriods(10, 25, 30)).toEqual({ travel: 5, periods: -1 });
    });

    it("crosses none where a period has no width", () => {
        expect(panPeriods(0, -500, 0)).toEqual({ travel: -500, periods: 0 });
    });
});
