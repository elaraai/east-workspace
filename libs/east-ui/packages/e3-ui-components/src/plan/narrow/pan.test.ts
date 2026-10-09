/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, expect } from "vitest";
import { feedTwoFingerPan, newTwoFingerPan } from "./pan";

describe("two-finger pan (§10 / #570)", () => {
    it("one finger never pans — page scroll stays vertical", () => {
        const g = newTwoFingerPan();
        expect(feedTwoFingerPan(g, "down", 1, 100, 30)).toBe(0);
        expect(feedTwoFingerPan(g, "move", 1, 0, 30)).toBe(0);
        expect(feedTwoFingerPan(g, "move", 1, -500, 30)).toBe(0);
    });

    it("two fingers dragged left pan one period per period width — later in time", () => {
        const g = newTwoFingerPan();
        feedTwoFingerPan(g, "down", 1, 100, 30);
        feedTwoFingerPan(g, "down", 2, 140, 30);           // centroid 120
        // One finger moves 30px: the centroid moves 15 — under a period.
        expect(feedTwoFingerPan(g, "move", 1, 70, 30)).toBe(0);
        // The other catches up: 30px of centroid travel — one period, later.
        expect(feedTwoFingerPan(g, "move", 2, 110, 30)).toBe(1);
        // A big jump of one finger (60px → centroid 30px) crosses one edge…
        expect(feedTwoFingerPan(g, "move", 1, 10, 30)).toBe(1);
        // …and a 120px jump of the other (centroid 60px) crosses two.
        expect(feedTwoFingerPan(g, "move", 2, -10, 30)).toBe(2);
        // Back the other way: earlier.
        expect(feedTwoFingerPan(g, "move", 1, 70, 30)).toBe(-1);
    });

    it("lifting a finger ends the gesture and forgets the partial travel", () => {
        const g = newTwoFingerPan();
        feedTwoFingerPan(g, "down", 1, 100, 30);
        feedTwoFingerPan(g, "down", 2, 140, 30);
        feedTwoFingerPan(g, "move", 1, 80, 30);              // 10px of travel banked
        expect(feedTwoFingerPan(g, "up", 2, 140, 30)).toBe(0);
        feedTwoFingerPan(g, "down", 3, 200, 30);             // a new second finger
        // The first sample re-anchors; the banked 10px is gone.
        expect(feedTwoFingerPan(g, "move", 3, 175, 30)).toBe(0);
        expect(feedTwoFingerPan(g, "move", 1, 30, 30)).toBe(1);
    });
});
