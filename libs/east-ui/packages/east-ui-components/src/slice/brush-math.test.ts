/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Unit tests for the pure brush-gesture geometry (#192): hit-testing the
 * applied window, the slide/resize/draw window math, and the release
 * decision (click-vs-drag, clear-vs-commit-vs-noop).
 */

import { describe, test, expect } from "vitest";
import {
    BRUSH_HANDLE_COARSE_PX, brushBars, brushBucketAt, brushCursor, brushDragWindow, brushHitTest, brushKey, brushRelease, brushZoneSides, type BrushDrag,
} from "./brush-math.js";

const WIDTH = 400;
const WIN = { lo: 100, hi: 200 };

const drag = (partial: Partial<BrushDrag>): BrushDrag => ({
    mode: "draw", start: 0, current: 0, width: WIDTH, win: undefined, ...partial,
});

describe("brushHitTest — resolves the gesture at pointer-down (#192)", () => {
    test("no applied window: everywhere is a draw", () => {
        expect(brushHitTest(150, undefined, WIDTH)).toBe("draw");
        expect(brushHitTest(0, undefined, WIDTH)).toBe("draw");
    });

    test("inside the window is a move; outside is a draw", () => {
        expect(brushHitTest(150, WIN, WIDTH)).toBe("move");
        expect(brushHitTest(50, WIN, WIDTH)).toBe("draw");
        expect(brushHitTest(300, WIN, WIDTH)).toBe("draw");
    });

    test("edge hot zones win over the interior: 12px, centred on each edge, a press within 6 of it (#1438)", () => {
        expect(brushHitTest(100, WIN, WIDTH)).toBe("resize-lo");
        expect(brushHitTest(94, WIN, WIDTH)).toBe("resize-lo");   // outside edge
        expect(brushHitTest(106, WIN, WIDTH)).toBe("resize-lo");  // inside edge
        expect(brushHitTest(200, WIN, WIDTH)).toBe("resize-hi");
        expect(brushHitTest(206, WIN, WIDTH)).toBe("resize-hi");
        expect(brushHitTest(194, WIN, WIDTH)).toBe("resize-hi");
        expect(brushHitTest(107, WIN, WIDTH)).toBe("move");
        expect(brushHitTest(93, WIN, WIDTH)).toBe("draw");
    });

    test("a coarse pointer's zones are 24px: a press within 12 of an edge (#1438)", () => {
        expect(brushHitTest(88, WIN, WIDTH, BRUSH_HANDLE_COARSE_PX)).toBe("resize-lo");
        expect(brushHitTest(112, WIN, WIDTH, BRUSH_HANDLE_COARSE_PX)).toBe("resize-lo");
        expect(brushHitTest(113, WIN, WIDTH, BRUSH_HANDLE_COARSE_PX)).toBe("move");
        expect(brushHitTest(212, WIN, WIDTH, BRUSH_HANDLE_COARSE_PX)).toBe("resize-hi");
        expect(brushHitTest(213, WIN, WIDTH, BRUSH_HANDLE_COARSE_PX)).toBe("draw");
    });

    test("a window under 24px wide sets each zone outside its edge, and a press inside it moves it (#1438)", () => {
        const narrow = { lo: 100, hi: 110 };
        expect(brushHitTest(100, narrow, WIDTH)).toBe("resize-lo");
        expect(brushHitTest(88, narrow, WIDTH)).toBe("resize-lo");
        expect(brushHitTest(87, narrow, WIDTH)).toBe("draw");
        expect(brushHitTest(101, narrow, WIDTH)).toBe("move");
        expect(brushHitTest(109, narrow, WIDTH)).toBe("move");
        expect(brushHitTest(110, narrow, WIDTH)).toBe("resize-hi");
        expect(brushHitTest(122, narrow, WIDTH)).toBe("resize-hi");
        expect(brushHitTest(123, narrow, WIDTH)).toBe("draw");
        // A coarse pointer's, under 48px wide, the same with its 24px zones.
        const touch = { lo: 100, hi: 140 };
        expect(brushHitTest(76, touch, WIDTH, BRUSH_HANDLE_COARSE_PX)).toBe("resize-lo");
        expect(brushHitTest(120, touch, WIDTH, BRUSH_HANDLE_COARSE_PX)).toBe("move");
        expect(brushHitTest(164, touch, WIDTH, BRUSH_HANDLE_COARSE_PX)).toBe("resize-hi");
        expect(brushHitTest(165, touch, WIDTH, BRUSH_HANDLE_COARSE_PX)).toBe("draw");
    });

    test("a narrow window against the track's end sets that edge's zone just inside it, no further than the other edge: nothing past the track (#1438)", () => {
        // 10px wide, 4px from the start: no room for its start's zone outside.
        const start = { lo: 4, hi: 14 };
        expect(brushZoneSides(start, WIDTH)).toEqual({ lo: "in", hi: "out" });
        expect(brushHitTest(4, start, WIDTH)).toBe("resize-lo");
        expect(brushHitTest(13, start, WIDTH)).toBe("resize-lo");
        expect(brushHitTest(20, start, WIDTH)).toBe("resize-hi");
        expect(brushHitTest(2, start, WIDTH)).toBe("draw");
        expect(brushHitTest(27, start, WIDTH)).toBe("draw");
        // 10px wide, 4px from the end: its end's zone inside, its start's outside.
        const end = { lo: 386, hi: 396 };
        expect(brushZoneSides(end, WIDTH)).toEqual({ lo: "out", hi: "in" });
        expect(brushHitTest(380, end, WIDTH)).toBe("resize-lo");
        expect(brushHitTest(387, end, WIDTH)).toBe("resize-hi");
        expect(brushHitTest(396, end, WIDTH)).toBe("resize-hi");
        expect(brushHitTest(398, end, WIDTH)).toBe("draw");
        // With room on both sides, both outside.
        expect(brushZoneSides({ lo: 100, hi: 110 }, WIDTH)).toEqual({ lo: "out", hi: "out" });
    });
});

describe("brushKey — the window's arrows at the track's end (#1440)", () => {
    test("the window stops at the track's end, its width kept, where the host's step clamps there", () => {
        // A step as the Plan's: a period a press, never past the track.
        const clamped = (f: number, n: number) => Math.max(0, Math.min(1, f + n / 10));
        const right = brushKey("ArrowRight", false, "window", { from: 0.8, to: 0.95 }, clamped);
        expect(right?.kind).toBe("commit");
        if (right?.kind !== "commit") return;
        expect(right.from).toBeCloseTo(0.85);
        expect(right.to).toBe(1);
        const left = brushKey("ArrowLeft", false, "window", { from: 0.05, to: 0.2 }, clamped);
        expect(left?.kind).toBe("commit");
        if (left?.kind !== "commit") return;
        expect(left.from).toBe(0);
        expect(left.to).toBeCloseTo(0.15);
    });
});

describe("brushDragWindow — the in-flight window (#192)", () => {
    test("draw spans start→current in either direction, clamped to the track", () => {
        expect(brushDragWindow(drag({ start: 50, current: 120 }))).toEqual({ lo: 50, hi: 120 });
        expect(brushDragWindow(drag({ start: 120, current: 50 }))).toEqual({ lo: 50, hi: 120 });
        expect(brushDragWindow(drag({ start: 380, current: 500 }))).toEqual({ lo: 380, hi: 400 });
        expect(brushDragWindow(drag({ start: 30, current: -40 }))).toEqual({ lo: 0, hi: 30 });
    });

    test("move slides the window with width exactly preserved", () => {
        const w = brushDragWindow(drag({ mode: "move", win: WIN, start: 150, current: 190 }));
        expect(w).toEqual({ lo: 140, hi: 240 });
        expect(w.hi - w.lo).toBe(WIN.hi - WIN.lo);
    });

    test("move clamps at BOTH domain ends without squashing the width", () => {
        // Push far left: window pins at 0, width preserved.
        expect(brushDragWindow(drag({ mode: "move", win: WIN, start: 150, current: -500 })))
            .toEqual({ lo: 0, hi: 100 });
        // Push far right: window pins at the track end, width preserved.
        expect(brushDragWindow(drag({ mode: "move", win: WIN, start: 150, current: 900 })))
            .toEqual({ lo: 300, hi: 400 });
    });

    test("resize-lo drags only the low bound; crossing the high bound swaps", () => {
        expect(brushDragWindow(drag({ mode: "resize-lo", win: WIN, start: 100, current: 130 })))
            .toEqual({ lo: 130, hi: 200 });
        // Dragged past the other edge: bounds swap, d3 style.
        expect(brushDragWindow(drag({ mode: "resize-lo", win: WIN, start: 100, current: 250 })))
            .toEqual({ lo: 200, hi: 250 });
        // Clamped at the track start.
        expect(brushDragWindow(drag({ mode: "resize-lo", win: WIN, start: 100, current: -50 })))
            .toEqual({ lo: 0, hi: 200 });
    });

    test("resize-hi drags only the high bound; crossing the low bound swaps", () => {
        expect(brushDragWindow(drag({ mode: "resize-hi", win: WIN, start: 200, current: 320 })))
            .toEqual({ lo: 100, hi: 320 });
        expect(brushDragWindow(drag({ mode: "resize-hi", win: WIN, start: 200, current: 40 })))
            .toEqual({ lo: 40, hi: 100 });
        expect(brushDragWindow(drag({ mode: "resize-hi", win: WIN, start: 200, current: 999 })))
            .toEqual({ lo: 100, hi: 400 });
    });
});

describe("brushRelease — click vs drag, clear vs commit vs noop (#192)", () => {
    test("a real draw commits its window", () => {
        expect(brushRelease(drag({ start: 50, current: 120 })))
            .toEqual({ kind: "commit", lo: 50, hi: 120 });
    });

    test("sub-threshold click on empty track clears (the established gesture)", () => {
        expect(brushRelease(drag({ start: 50, current: 53 }))).toEqual({ kind: "clear" });
    });

    test("sub-threshold click on the window or a handle is a noop — never nukes the selection", () => {
        expect(brushRelease(drag({ mode: "move", win: WIN, start: 150, current: 152 })))
            .toEqual({ kind: "noop" });
        expect(brushRelease(drag({ mode: "resize-lo", win: WIN, start: 100, current: 101 })))
            .toEqual({ kind: "noop" });
    });

    test("a slide commits the shifted window with the width preserved", () => {
        expect(brushRelease(drag({ mode: "move", win: WIN, start: 150, current: 210 })))
            .toEqual({ kind: "commit", lo: 160, hi: 260 });
    });

    test("a resize collapsing the window below the threshold clears", () => {
        expect(brushRelease(drag({ mode: "resize-lo", win: WIN, start: 100, current: 198 })))
            .toEqual({ kind: "clear" });
    });
});

describe("brushCursor — the track cursor while dragging (#192)", () => {
    test("move shows grabbing; resize shows ew-resize; draw shows crosshair", () => {
        expect(brushCursor("move")).toBe("grabbing");
        expect(brushCursor("resize-lo")).toBe("ew-resize");
        expect(brushCursor("resize-hi")).toBe("ew-resize");
        expect(brushCursor("draw")).toBe("crosshair");
    });
});

/** A period a sixty-fourth of the track: fractions on it are exact. */
const step = (f: number, periods: number): number => f + periods / 64;
const at = (n: number): number => n / 64;

describe("brushKey — what a key does from a focused handle or the window (#1438)", () => {
    const win = { from: at(16), to: at(32) };

    test("Escape clears the range from any of the three; a key it does not take does nothing", () => {
        expect(brushKey("Escape", false, "lo", win, step)).toEqual({ kind: "clear" });
        expect(brushKey("Escape", false, "window", win, step)).toEqual({ kind: "clear" });
        expect(brushKey("a", false, "hi", win, step)).toBeUndefined();
        expect(brushKey("ArrowUp", false, "hi", win, step)).toBeUndefined();
    });

    test("an arrow moves a handle one period, ten under Shift, never past a period from the other, nor off the track", () => {
        expect(brushKey("ArrowRight", false, "lo", win, step)).toEqual({ kind: "commit", from: at(17), to: at(32) });
        expect(brushKey("ArrowLeft", true, "lo", win, step)).toEqual({ kind: "commit", from: at(6), to: at(32) });
        expect(brushKey("ArrowRight", true, "lo", { from: at(28), to: at(32) }, step)).toEqual({ kind: "commit", from: at(31), to: at(32) });
        expect(brushKey("ArrowLeft", true, "lo", { from: at(4), to: at(32) }, step)).toEqual({ kind: "commit", from: 0, to: at(32) });
        expect(brushKey("ArrowLeft", false, "hi", win, step)).toEqual({ kind: "commit", from: at(16), to: at(31) });
        expect(brushKey("ArrowLeft", true, "hi", { from: at(16), to: at(20) }, step)).toEqual({ kind: "commit", from: at(16), to: at(17) });
        expect(brushKey("ArrowRight", true, "hi", { from: at(16), to: at(60) }, step)).toEqual({ kind: "commit", from: at(16), to: 1 });
    });

    test("an arrow on the window moves both edges, its width kept, and stops at the track's ends", () => {
        expect(brushKey("ArrowRight", false, "window", win, step)).toEqual({ kind: "commit", from: at(17), to: at(33) });
        expect(brushKey("ArrowLeft", true, "window", win, step)).toEqual({ kind: "commit", from: at(6), to: at(22) });
        expect(brushKey("ArrowLeft", true, "window", { from: at(4), to: at(20) }, step)).toEqual({ kind: "commit", from: 0, to: at(16) });
        expect(brushKey("ArrowRight", true, "window", { from: at(40), to: at(60) }, step)).toEqual({ kind: "commit", from: at(44), to: 1 });
    });

    test("Home and End take a handle to its end of the track, short of the other by a period, and the window to the track's ends", () => {
        expect(brushKey("Home", false, "lo", win, step)).toEqual({ kind: "commit", from: 0, to: at(32) });
        expect(brushKey("End", false, "lo", win, step)).toEqual({ kind: "commit", from: at(31), to: at(32) });
        expect(brushKey("Home", false, "hi", win, step)).toEqual({ kind: "commit", from: at(16), to: at(17) });
        expect(brushKey("End", false, "hi", win, step)).toEqual({ kind: "commit", from: at(16), to: 1 });
        expect(brushKey("Home", false, "window", win, step)).toEqual({ kind: "commit", from: 0, to: at(16) });
        expect(brushKey("End", false, "window", win, step)).toEqual({ kind: "commit", from: at(48), to: 1 });
    });
});

describe("brushBars — the histogram's bars on whole pixels (#1438)", () => {
    /** `n` equal buckets across the track, their counts given. */
    const equal = (counts: readonly number[]) => counts.map((count, i) => ({ from: i / counts.length, to: (i + 1) / counts.length, count }));

    test("every bar one width, floor(pitch) − gap, at its slot's start; 2px apart from 8px a bucket, else 1px", () => {
        const wide = brushBars(equal([4, 8, 2, 8, 6, 8, 8, 8, 8, 8, 8, 8]), 120, 28);
        expect(wide.map((b) => [b.x, b.width])).toEqual(Array.from({ length: 12 }, (_, i) => [i * 10, 8]));
        const close = brushBars(equal(Array.from({ length: 24 }, () => 1)), 120, 28);
        expect(close.map((b) => [b.x, b.width])).toEqual(Array.from({ length: 24 }, (_, i) => [i * 5, 4]));
    });

    test("a bar's height is linear to the largest bucket, up to the most, a non-zero one at least 2; a zero draws none", () => {
        const bars = brushBars(equal([100, 50, 1, 0, 25]), 100, 28);
        expect(bars.map((b) => [b.index, b.height])).toEqual([[0, 28], [1, 14], [2, 2], [4, 7]]);
    });

    test("its tone is a step on the heat ramp: ceil(count ÷ max × 5)", () => {
        const bars = brushBars(equal([100, 81, 80, 41, 40, 1]), 120, 28);
        expect(bars.map((b) => b.step)).toEqual([5, 5, 4, 3, 2, 1]);
    });

    test("bars of unequal slots are one width, the narrowest's, and an end bucket the horizon clips draws inside its slot", () => {
        // Calendar months, 30 to 31 days each across 120px: slots of 9 to 11 whole pixels, every bar 7 wide.
        const year = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let day = 0;
        const days365 = year.reduce((a, d) => a + d, 0);
        const twelve = year.map((d) => { const b = { from: day / days365, to: (day + d) / days365, count: 1 }; day += d; return b; });
        expect(new Set(brushBars(twelve, 120, 28).map((b) => b.width))).toEqual(new Set([7]));
        // Calendar months: 31, 28 and 31 days across 45px, a February narrower than the others.
        const days = [31, 28, 31];
        const total = days.reduce((a, d) => a + d, 0);
        let from = 0;
        const months = days.map((d) => { const b = { from: from / total, to: (from + d) / total, count: 1 }; from += d; return b; });
        const bars = brushBars(months, 45, 28);
        for (let i = 0; i + 1 < bars.length; i++) expect(bars[i]!.x + bars[i]!.width).toBeLessThanOrEqual(bars[i + 1]!.x - 1);
        // A first bucket the horizon clips to 5px of its slot: its slot less the 2px gap, at the track's start.
        const clipped = brushBars([{ from: 0, to: 0.05, count: 5 }, { from: 0.05, to: 0.55, count: 5 }, { from: 0.55, to: 1, count: 5 }], 100, 28);
        expect(clipped.map((b) => [b.x, b.width])).toEqual([[0, 3], [5, 48], [55, 43]]);
    });

    test("no bars on a track with no width, or with nothing counted", () => {
        expect(brushBars(equal([1, 2]), 0, 28)).toEqual([]);
        expect(brushBars(equal([0, 0]), 100, 28)).toEqual([]);
    });
});

describe("brushBucketAt — the bucket under the pointer (#1438)", () => {
    const buckets = [{ from: 0, to: 0.25, count: 1 }, { from: 0.25, to: 0.75, count: 0 }, { from: 0.75, to: 1, count: 3 }];

    test("the bucket whose slot holds the pointer, its start in it and its end not; none off the track", () => {
        expect(brushBucketAt(0, 200, buckets)).toBe(0);
        expect(brushBucketAt(49, 200, buckets)).toBe(0);
        expect(brushBucketAt(50, 200, buckets)).toBe(1);
        expect(brushBucketAt(199, 200, buckets)).toBe(2);
        expect(brushBucketAt(200, 200, buckets)).toBeUndefined();
        expect(brushBucketAt(-1, 200, buckets)).toBeUndefined();
    });
});
