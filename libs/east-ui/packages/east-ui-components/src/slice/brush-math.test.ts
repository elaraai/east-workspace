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
import { brushHitTest, brushDragWindow, brushRelease, brushCursor, type BrushDrag } from "./brush-math.js";

const WIDTH = 400;
const WIN = { lo: 100, hi: 200 };

const drag = (partial: Partial<BrushDrag>): BrushDrag => ({
    mode: "draw", start: 0, current: 0, width: WIDTH, win: undefined, ...partial,
});

describe("brushHitTest — resolves the gesture at pointer-down (#192)", () => {
    test("no applied window: everywhere is a draw", () => {
        expect(brushHitTest(150, undefined)).toBe("draw");
        expect(brushHitTest(0, undefined)).toBe("draw");
    });

    test("inside the window is a move; outside is a draw", () => {
        expect(brushHitTest(150, WIN)).toBe("move");
        expect(brushHitTest(50, WIN)).toBe("draw");
        expect(brushHitTest(300, WIN)).toBe("draw");
    });

    test("edge hot zones win over the interior, ±5px either side", () => {
        expect(brushHitTest(100, WIN)).toBe("resize-lo");
        expect(brushHitTest(95, WIN)).toBe("resize-lo");   // outside edge
        expect(brushHitTest(105, WIN)).toBe("resize-lo");  // inside edge
        expect(brushHitTest(200, WIN)).toBe("resize-hi");
        expect(brushHitTest(205, WIN)).toBe("resize-hi");
        expect(brushHitTest(195, WIN)).toBe("resize-hi");
        expect(brushHitTest(106, WIN)).toBe("move");
        expect(brushHitTest(94, WIN)).toBe("draw");
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
