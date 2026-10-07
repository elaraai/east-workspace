/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The link router's case table (#818, #1258) — `Plan links.html`'s, number
 * for number. Each case draws one link of weight 4 (40 t of a 96 t family)
 * between 20px bars centred on rows at 16, 49 and 81 of a 96px view, and
 * checks its stroke, its head and where its caption's text is centred
 * against the spec's figure. Then the weights' heads, and the corners that
 * clamp to the drop.
 */

import { describe, test, expect } from "vitest";
import { routeRibbon, type RibbonEnd, type RibbonPath } from "./ribbon-geometry.js";

/** One path command and its numbers. */
interface Cmd {
    c: string;
    n: number[];
}

/** Parse path data — this router's or the spec's — into its commands. */
function parse(d: string): Cmd[] {
    return [...d.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)].map((m) => ({
        c: m[1]!,
        n: m[2]!.trim() === "" ? [] : m[2]!.trim().split(/[\s,]+/).map(Number),
    }));
}

/** Whether two paths draw the same commands, each number within a twentieth of a pixel. */
function samePath(got: string, want: string): boolean {
    const a = parse(got);
    const b = parse(want);
    return a.length === b.length && a.every((cmd, i) => cmd.c === b[i]!.c
        && cmd.n.length === b[i]!.n.length && cmd.n.every((v, j) => Math.abs(v - b[i]!.n[j]!) <= 0.05));
}

/** Expect a routed link to draw the spec's figure. */
function expectFigure(r: RibbonPath, want: { stroke: string; head: string; tail?: string; caption: [number, number] }) {
    expect(samePath(r.stroke, want.stroke), `stroke ${r.stroke} ≠ ${want.stroke}`).toBe(true);
    expect(samePath(r.head, want.head), `head ${r.head} ≠ ${want.head}`).toBe(true);
    if (want.tail === undefined) expect(r.tail).toBe("");
    else expect(samePath(r.tail, want.tail), `tail ${r.tail} ≠ ${want.tail}`).toBe(true);
    expect([r.lx, r.ly]).toEqual(want.caption);
    expect(r.anchor).toBe("middle");
}

/** A 20px bar spanning [x0, x1], centred on y. */
const bar = (x0: number, x1: number, y: number): RibbonEnd => ({ leftX: x0, rightX: x1, top: y - 10, bottom: y + 10 });
/** An end past an edge of the 96px view: on its top edge, or on its bottom edge. */
const above = (x0: number, x1: number): RibbonEnd => ({ leftX: x0, rightX: x1, top: 0, bottom: 20, off: "above" });
const below = (x0: number, x1: number): RibbonEnd => ({ leftX: x0, rightX: x1, top: 76, bottom: 96, off: "below" });
/** The spec's rows' centres. */
const R0 = 16;
const R1 = 49;
const R2 = 81;
/** Every case's weight: 40 t of a 96 t family. */
const W = 4;

describe("routeRibbon — Plan links.html's case table (#818, #1258)", () => {
    test("1 · forward, down: the metro-S — straight out of the end, one riser late, straight into the start; the caption on the riser", () => {
        expectFigure(routeRibbon(bar(16, 110, R0), bar(224, 300, R2), W), {
            stroke: "M110 16L189 16A8 8 0 0 1 197 24L197 73A8 8 0 0 0 205 81L216 81",
            head: "M216 77L224 81L216 85Z",
            caption: [197, 51.5],
        });
    });

    test("2 · forward, up: the same S, climbing", () => {
        expectFigure(routeRibbon(bar(16, 110, R2), bar(224, 300, R0), W), {
            stroke: "M110 81L189 81A8 8 0 0 0 197 73L197 24A8 8 0 0 1 205 16L216 16",
            head: "M216 12L224 16L216 20Z",
            caption: [197, 51.5],
        });
    });

    test("3 · backward: the loopback — out past the end, a U-turn onto the lane halfway between the bars, back left, a U-turn into the start; the caption on the lane", () => {
        expectFigure(routeRibbon(bar(60, 250, R0), bar(90, 200, R2), W), {
            stroke: "M250 16L261 16A8 8 0 0 1 269 24L269 40.5A8 8 0 0 1 261 48.5L71 48.5A8 8 0 0 0 63 56.5L63 73A8 8 0 0 0 71 81L82 81",
            head: "M82 77L90 81L82 85Z",
            caption: [166, 51.5],
        });
    });

    test("4 · one row, forward: a straight feed between the runs; the caption 6 above the source bar", () => {
        expectFigure(routeRibbon(bar(16, 110, R1), bar(180, 290, R1), W), {
            stroke: "M110 49L172 49",
            head: "M172 45L180 49L172 53Z",
            caption: [141, 33],
        });
    });

    test("5 · one row, overlapping: the runoff — an exit stub out of the end and a separate arrival into the start, never through the bars", () => {
        expectFigure(routeRibbon(bar(16, 190, R1), bar(150, 290, R1), W), {
            stroke: "M190 49L201 49M131 49L142 49",
            head: "M142 45L150 49L142 53Z",
            caption: [170, 33],
        });
    });

    test("6 · adjacent rows: each U-turn drops 16.5, so its corners are 8 with no straight between them", () => {
        expectFigure(routeRibbon(bar(60, 250, R0), bar(90, 200, R1), W), {
            stroke: "M250 16L261 16A8 8 0 0 1 269 24A8 8 0 0 1 261 32.5L71 32.5A8 8 0 0 0 63 40.5A8 8 0 0 0 71 49L82 49",
            head: "M82 45L90 49L82 53Z",
            caption: [166, 35.5],
        });
    });

    test("7 · destination below the view, forward: it turns where its riser will stand and meets the edge in a stub, tip on the edge; the caption at the run's mid-height", () => {
        expectFigure(routeRibbon(bar(16, 110, R0), below(224, 300), W), {
            stroke: "M110 16L189 16A8 8 0 0 1 197 24L197 88",
            head: "M193 88L197 96L201 88Z",
            caption: [197, 59],
        });
    });

    test("8 · destination below the view, backward: it turns where the loopback's first turn stands", () => {
        expectFigure(routeRibbon(bar(60, 250, R0), below(90, 200), W), {
            stroke: "M250 16L261 16A8 8 0 0 1 269 24L269 88",
            head: "M265 88L269 96L273 88Z",
            caption: [269, 59],
        });
    });

    test("9 · destination above the view: the stub points up, its tip on the top edge", () => {
        expectFigure(routeRibbon(bar(16, 110, R2), above(224, 300), W), {
            stroke: "M110 81L189 81A8 8 0 0 0 197 73L197 8",
            head: "M193 8L197 0L201 8Z",
            caption: [197, 43.5],
        });
    });

    test("10 · source above the view: the link enters down the destination's riser; a stub at the edge points back toward the source", () => {
        expectFigure(routeRibbon(above(16, 110), bar(224, 300, R2), W), {
            stroke: "M197 8L197 73A8 8 0 0 0 205 81L216 81",
            head: "M216 77L224 81L216 85Z",
            tail: "M193 8L197 0L201 8Z",
            caption: [197, 43.5],
        });
    });

    test("11 · both out of view, opposite edges: one vertical band where the riser stands, a stub at each edge", () => {
        expectFigure(routeRibbon(above(16, 110), below(224, 300), W), {
            stroke: "M197 8L197 88",
            head: "M193 88L197 96L201 88Z",
            tail: "M193 8L197 0L201 8Z",
            caption: [197, 51],
        });
    });

    test("12 · the tightest forward gap, out of view: 34 after the end, the least an S takes; the corner shrinks to 2 so the exit keeps its full run-out of 11", () => {
        expectFigure(routeRibbon(bar(16, 110, R0), below(144, 220), W), {
            stroke: "M110 16L121 16A2 2 0 0 1 123 18L123 88",
            head: "M119 88L123 96L127 88Z",
            caption: [123, 56],
        });
        // One px tighter is no S: it turns where the loopback's first turn
        // stands, clear of the approach (124 + 2) and a corner past it.
        const tighter = routeRibbon(bar(16, 110, R0), below(143, 220), W);
        expect(parse(tighter.stroke)[1]!.n).toEqual([126, 16]);
        expect(samePath(tighter.head, "M130 88L134 96L138 88Z")).toBe(true);
    });

    test("13 · bar sizes: the weight is the quantity's, not the bar's — each end centres on its own bar", () => {
        const S = { stroke: "M110 16L145 16A8 8 0 0 1 153 24L153 41A8 8 0 0 0 161 49L172 49", head: "M172 45L180 49L172 53Z", caption: [153, 35.5] as [number, number] };
        // Default: a 20px bar.
        const plain = routeRibbon(bar(16, 110, R0), bar(180, 290, R1), W);
        expectFigure(plain, S);
        expect(plain.width).toBe(W);
        // Compact: 16px bars on 24px rows.
        const compact = routeRibbon({ leftX: 16, rightX: 110, top: 4, bottom: 20 }, { leftX: 180, rightX: 290, top: 29, bottom: 45 }, W);
        expectFigure(compact, {
            stroke: "M110 12L145 12A8 8 0 0 1 153 20L153 29A8 8 0 0 0 161 37L172 37",
            head: "M172 33L180 37L172 41Z",
            caption: [153, 27.5],
        });
        expect(compact.width).toBe(W);
        // A 12px rollup bar, centred where the 20px bar was.
        const rollup = routeRibbon({ leftX: 16, rightX: 110, top: 10, bottom: 22 }, bar(180, 290, R1), W);
        expectFigure(rollup, S);
        expect(rollup.width).toBe(W);
    });

    test("14 · off the window: an end past it lands on the plot's edge — the S into the right edge, and out of the left", () => {
        // The middle row's run starting after the window: its end is the plot's right edge.
        expectFigure(routeRibbon(bar(30, 130, R0), { leftX: 315, rightX: 315, top: 39, bottom: 59 }, W), {
            stroke: "M130 16L280 16A8 8 0 0 1 288 24L288 41A8 8 0 0 0 296 49L307 49",
            head: "M307 45L315 49L307 53Z",
            caption: [288, 35.5],
        });
        // Its run ending before the window: its start is the plot's left edge.
        expectFigure(routeRibbon({ leftX: 0, rightX: 0, top: 39, bottom: 59 }, bar(150, 250, R2), W), {
            stroke: "M0 49L115 49A8 8 0 0 1 123 57L123 73A8 8 0 0 0 131 81L142 81",
            head: "M142 77L150 81L142 85Z",
            caption: [123, 68],
        });
    });
});

describe("routeRibbon — weight (#1258)", () => {
    test("the stroke is the weight, and the head 8 long and max(8, 2 × weight) wide", () => {
        for (const [weight, half] of [[1.5, 4], [2, 4], [4, 4], [8, 8]] as const) {
            const r = routeRibbon(bar(16, 110, R0), bar(224, 300, R2), weight);
            expect(r.width).toBe(weight);
            const [m, tip, end] = parse(r.head).filter((c) => c.c !== "Z").map((c) => c.n);
            expect(tip).toEqual([224, 81]);
            expect([m, end]).toEqual([[216, 81 - half], [216, 81 + half]]);
        }
    });

    test("the route is the weight's own: a heavier link takes the same path", () => {
        const light = routeRibbon(bar(60, 250, R0), bar(90, 200, R2), 2);
        const heavy = routeRibbon(bar(60, 250, R0), bar(90, 200, R2), 8);
        expect(heavy.stroke).toBe(light.stroke);
        expect([heavy.lx, heavy.ly]).toEqual([light.lx, light.ly]);
    });

    test("a destination at the window's start is entered from the gutter: the loopback turns there", () => {
        // The plot starts at 0; the run before the window's start begins it.
        const r = routeRibbon(bar(0, 120, R0), bar(0, 160, R1), 2);
        expect(samePath(r.stroke, "M120 16L131 16A8 8 0 0 1 139 24A8 8 0 0 1 131 32.5L-19 32.5A8 8 0 0 0 -27 40.5A8 8 0 0 0 -19 49L-8 49")).toBe(true);
        expect(samePath(r.head, "M-8 45L0 49L-8 53Z")).toBe(true);
        expect([r.lx, r.ly]).toEqual([56, 35.5]);
    });

    test("a row at the very edge still routes: every number is finite", () => {
        // The source's centre sits 3px above the bottom edge its destination
        // lies past — less than a head's length.
        for (const r of [
            routeRibbon(bar(100, 200, 197), { leftX: 400, rightX: 500, top: 180, bottom: 200, off: "below" }, W),
            routeRibbon({ leftX: 100, rightX: 200, top: 0, bottom: 20, off: "above" }, bar(400, 500, 3), W),
        ]) {
            for (const d of [r.stroke, r.head, r.tail]) {
                for (const cmd of parse(d)) expect(cmd.n.every(Number.isFinite)).toBe(true);
            }
        }
    });
});
