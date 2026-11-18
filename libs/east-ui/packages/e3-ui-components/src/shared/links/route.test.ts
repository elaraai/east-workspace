/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A family laid out together (#1680's review): the ports its shared ends
 * take, each link routed from them, and its captions placed.
 */

import { describe, test, expect } from "vitest";
import { routeLinks, type LinkToRoute } from "./route.js";
import { routeRibbon, type RibbonEnd } from "./geometry.js";

/** A 20px bar spanning [x0, x1], centred on y. */
const bar = (x0: number, x1: number, y: number): RibbonEnd => ({ leftX: x0, rightX: x1, top: y - 10, bottom: y + 10 });
const BOUNDS = { left: 0, right: 600 };

/** A link from `from` into `to`, named by the elements they meet. */
const link = (from: RibbonEnd, fromAt: string, to: RibbonEnd, toAt: string, weight = 6, label: string | undefined = "40 k sheets"): LinkToRoute =>
    ({ from, to, fromAt, toAt, weight, label });

/** Where a routed stroke starts: its source's port. */
const startY = (d: string): number => Number(/^M\s*[\d.-]+\s+([\d.-]+)/.exec(d)![1]);

describe("routeLinks — a family laid out together (#1680's review)", () => {
    // J-4693 on the middle row; a row above and a row below it.
    const j4693 = bar(100, 200, 100);
    const above = bar(300, 400, 40);
    const below = bar(300, 400, 160);

    test("l3 and l6 out of one end: each leaves its own port, the one to the higher row on top, 2 apart; neither is drawn through the other", () => {
        const [down, up] = routeLinks([link(j4693, "J-4693", below, "dlv"), link(j4693, "J-4693", above, "H2-P11")], BOUNDS);
        expect(startY(up!.stroke)).toBe(96);
        expect(startY(down!.stroke)).toBe(104);
        expect([up!.from.port, down!.from.port]).toEqual([96, 104]);
        // Each still enters its own destination on its centre line: a lone entry takes no port.
        expect([up!.to.port, down!.to.port]).toEqual([undefined, undefined]);
    });

    test("l2 and l5 into one start: their heads stack, each 12 wide for weight 6, 2 apart", () => {
        const [fromAbove, fromBelow] = routeLinks([link(above, "H1-P09", j4693, "J-4693"), link(below, "H2-P11", j4693, "J-4693")], BOUNDS);
        expect([fromAbove!.to.port, fromBelow!.to.port]).toEqual([93, 107]);
        expect(fromAbove!.head).toContain("93.0");
        expect(fromBelow!.head).toContain("107.0");
    });

    test("a lone link is routed as the grammar routes it alone", () => {
        const [only] = routeLinks([link(j4693, "J-4693", below, "dlv")], BOUNDS);
        const alone = routeRibbon(j4693, below, 6, BOUNDS);
        expect(only!.stroke).toBe(alone.stroke);
        expect(only!.head).toBe(alone.head);
    });

    test("an end out of view meets the view's edge and takes no port; the other end still spreads", () => {
        const offBelow: RibbonEnd = { leftX: 300, rightX: 400, top: 190, bottom: 210, off: "below" };
        const [inView, out] = routeLinks([link(j4693, "J-4693", above, "a"), link(j4693, "J-4693", offBelow, "b")], BOUNDS);
        expect(out!.to.port).toBeUndefined();
        expect([inView!.from.port, out!.from.port]).toEqual([96, 104]);
    });

    test("a planned lane reaches its route", () => {
        const back = bar(20, 80, 160);
        const [planned] = routeLinks([{ ...link(j4693, "J-4693", back, "back"), plan: { lane: 140 } }], BOUNDS);
        expect(planned!.route).toBe("loop");
        expect(planned!.ly).toBe(143);
    });

    test("captions are placed: one near the edge moves in, and two within 60 × 12 step apart", () => {
        const [a, b] = routeLinks([link(bar(0, 40, 40), "x", bar(500, 590, 160), "y"), link(bar(0, 40, 40), "x", bar(500, 590, 160), "z")], BOUNDS);
        // Two links out of one end into one row: ports 8 apart, so their S captions sit 4 apart, and the second steps 12 down.
        expect(Math.abs(b!.ly - a!.ly)).toBeGreaterThanOrEqual(12);
    });
});
