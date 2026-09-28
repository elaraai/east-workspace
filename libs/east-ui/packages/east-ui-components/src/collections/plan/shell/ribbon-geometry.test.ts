/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The ribbon router's case table (#818) — every arrangement `routeRibbon`
 * distinguishes: forward (the metro-S, down and up), backward (the loopback),
 * the same row (a straight feed, or the runoff stubs), adjacent rows (the
 * corners clamp to the drop), and out of view (a stub toward the row, from
 * either end or both).
 */

import { describe, test, expect } from "vitest";
import { routeRibbon, type RibbonEnd } from "./ribbon-geometry.js";

/** One path command and its numbers. */
interface Cmd {
    c: string;
    n: number[];
}

/** Parse path data into its commands. */
function parse(d: string): Cmd[] {
    return [...d.matchAll(/([MLAZ])([^MLAZ]*)/g)].map((m) => ({
        c: m[1]!,
        n: m[2]!.trim() === "" ? [] : m[2]!.trim().split(/\s+/).map(Number),
    }));
}

/** Where a command leaves the pen. */
function endOf(cmd: Cmd): [number, number] {
    return cmd.c === "A" ? [cmd.n[5]!, cmd.n[6]!] : [cmd.n[0]!, cmd.n[1]!];
}

/** The first point of a path, and its last. */
function span(d: string): { start: [number, number]; end: [number, number]; arcs: number; moves: number } {
    const cmds = parse(d).filter((c) => c.c !== "Z");
    return {
        start: [cmds[0]!.n[0]!, cmds[0]!.n[1]!],
        end: endOf(cmds[cmds.length - 1]!),
        arcs: cmds.filter((c) => c.c === "A").length,
        moves: cmds.filter((c) => c.c === "M").length,
    };
}

/** A triangle's tip — the vertex off its base line. */
function tipOf(d: string): [number, number] {
    const pts = parse(d).filter((c) => c.c !== "Z").map(endOf);
    return pts[1]!;
}

/** A triangle's base midpoint. */
function baseOf(d: string): [number, number] {
    const pts = parse(d).filter((c) => c.c !== "Z").map(endOf);
    return [(pts[0]![0] + pts[2]![0]) / 2, (pts[0]![1] + pts[2]![1]) / 2];
}

/** The x of every vertical straight segment. */
function risers(d: string): number[] {
    const cmds = parse(d).filter((c) => c.c !== "Z");
    const out: number[] = [];
    let at: [number, number] = [NaN, NaN];
    for (const cmd of cmds) {
        const next = endOf(cmd);
        if (cmd.c === "L" && next[0] === at[0] && next[1] !== at[1]) out.push(next[0]);
        at = next;
    }
    return out;
}

/** A 20px bar spanning [x0, x1] centred on row-centre y. */
const bar = (x0: number, x1: number, y: number, off?: "above" | "below"): RibbonEnd =>
    ({ leftX: x0, rightX: x1, top: y - 10, bottom: y + 10, ...(off !== undefined ? { off } : {}) });

// A 20px bar rides a 10px band (half its height): head 7px long, 5px either
// side of the flow; a 10px run-out before the approach.
const HEAD = 7;
const HALF = 5;
const RUN_OUT = 10;

describe("routeRibbon — the case table (#818)", () => {
    test("forward, downward: the metro-S — exit straight, one riser, arrive straight", () => {
        const r = routeRibbon(bar(100, 200, 20), bar(400, 500, 84));
        const s = span(r.stroke);
        expect(s.start).toEqual([200, 20]);
        expect(s.end).toEqual([400 - HEAD, 84]);
        expect(s.arcs).toBe(2);
        // The riser stands a corner left of the approach.
        expect(risers(r.stroke)).toEqual([400 - HEAD - RUN_OUT - 10]);
        expect(tipOf(r.head)).toEqual([400, 84]);
        expect(r.tail).toBe("");
        expect(r.width).toBe(10);
    });

    test("forward, upward: the same S, climbing", () => {
        const r = routeRibbon(bar(100, 200, 84), bar(400, 500, 20));
        const s = span(r.stroke);
        expect(s.start).toEqual([200, 84]);
        expect(s.end).toEqual([400 - HEAD, 20]);
        expect(s.arcs).toBe(2);
        expect(tipOf(r.head)).toEqual([400, 20]);
    });

    test("backward: the loopback — out past the source, back along the lane, into the start", () => {
        // The destination starts BEFORE the source ends.
        const r = routeRibbon(bar(100, 300, 20), bar(150, 250, 116));
        const s = span(r.stroke);
        expect(s.start).toEqual([300, 20]);
        expect(s.end).toEqual([150 - HEAD, 116]);
        // Two U-turns of two corners each.
        expect(s.arcs).toBe(4);
        // The lane runs between the rows, at their midpoint.
        const lane = parse(r.stroke).filter((c) => c.c === "L").map(endOf).filter(([, y]) => y === 68);
        expect(lane.length).toBeGreaterThan(0);
        // The caption rides the lane.
        expect(r.ly).toBe(68 + 3);
        expect(tipOf(r.head)).toEqual([150, 116]);
    });

    test("the same row, forward: a straight feed between the runs", () => {
        const r = routeRibbon(bar(100, 200, 20), bar(300, 400, 20));
        const s = span(r.stroke);
        expect(s.start).toEqual([200, 20]);
        expect(s.end).toEqual([300 - HEAD, 20]);
        expect(s.arcs).toBe(0);
        expect(s.moves).toBe(1);
    });

    test("the same row, overlapping: the runoff stubs — never drawn through the bars", () => {
        const r = routeRibbon(bar(100, 300, 20), bar(250, 400, 20));
        const cmds = parse(r.stroke);
        // Two separate pieces: the exit out of A's end, the approach into B.
        expect(span(r.stroke).moves).toBe(2);
        expect(endOf(cmds[0]!)).toEqual([300, 20]);
        expect(endOf(cmds[1]!)).toEqual([300 + RUN_OUT, 20]);
        expect(endOf(cmds[3]!)).toEqual([250 - HEAD, 20]);
        expect(tipOf(r.head)).toEqual([250, 20]);
    });

    test("adjacent rows: every corner clamps to half the drop, and no straight is left between them", () => {
        // Rows 32px apart, a backward link: each U-turn drops 16px, so its
        // corners clamp to 8px and meet with no straight between.
        const r = routeRibbon(bar(100, 300, 16), bar(150, 250, 48));
        const radii = parse(r.stroke).filter((c) => c.c === "A").map((c) => c.n[0]);
        expect(radii).toEqual([8, 8, 8, 8]);
        expect(risers(r.stroke)).toEqual([]);
        // A forward link 12px apart: its corners clamp to 6px.
        const tight = routeRibbon(bar(100, 200, 16), bar(400, 500, 28));
        expect(parse(tight.stroke).filter((c) => c.c === "A").map((c) => c.n[0])).toEqual([6, 6]);
    });

    test("out of view below, forward: the ribbon turns where its riser stands and meets the edge with a stub", () => {
        const inView = routeRibbon(bar(100, 200, 20), bar(400, 500, 84));
        // The same link, the destination past the bottom edge at y 200.
        const r = routeRibbon(bar(100, 200, 20), { ...bar(400, 500, 190), off: "below" });
        const s = span(r.stroke);
        expect(s.start).toEqual([200, 20]);
        expect(s.arcs).toBe(1);
        // The riser is where the in-view S stands it — no sideways jump as
        // the row scrolls in.
        expect(risers(r.stroke)).toEqual(risers(inView.stroke));
        // The stub points DOWN, its tip on the edge.
        expect(tipOf(r.head)).toEqual([risers(inView.stroke)[0], 200]);
        expect(baseOf(r.head)).toEqual([risers(inView.stroke)[0], 200 - HEAD]);
        expect(r.tail).toBe("");
    });

    test("out of view below, backward: it turns where the loopback's first turn stands", () => {
        const inView = routeRibbon(bar(100, 300, 20), bar(150, 250, 116));
        const r = routeRibbon(bar(100, 300, 20), { ...bar(150, 250, 190), off: "below" });
        // The loopback's exit-side riser is the first vertical of its path.
        expect(risers(r.stroke)).toEqual([risers(inView.stroke)[0]]);
        expect(tipOf(r.head)[1]).toBe(200);
    });

    test("out of view above: the stub points UP, its tip on the top edge", () => {
        const r = routeRibbon(bar(100, 200, 120), { ...bar(400, 500, 10), off: "above" });
        const [x, y] = tipOf(r.head);
        expect(y).toBe(0);
        expect(baseOf(r.head)).toEqual([x, HEAD]);
    });

    test("the source out of view: the ribbon enters from the edge down the destination's riser, a stub pointing back toward the source", () => {
        const inView = routeRibbon(bar(100, 200, 20), bar(400, 500, 84));
        const r = routeRibbon({ ...bar(100, 200, 10), off: "above" }, bar(400, 500, 84));
        const s = span(r.stroke);
        // Down the riser the in-view S climbs, then into the approach.
        expect(risers(r.stroke)).toEqual(risers(inView.stroke));
        expect(s.end).toEqual([400 - HEAD, 84]);
        expect(tipOf(r.head)).toEqual([400, 84]);
        // The tail stub sits on the top edge, pointing up.
        expect(tipOf(r.tail)).toEqual([risers(inView.stroke)[0], 0]);
        expect(baseOf(r.tail)).toEqual([risers(inView.stroke)[0], HEAD]);
        expect(s.start).toEqual([risers(inView.stroke)[0], HEAD]);
    });

    test("both out of view, on opposite sides: one vertical band across the view, a stub at each edge", () => {
        const r = routeRibbon({ ...bar(100, 200, 10), off: "above" }, { ...bar(400, 500, 190), off: "below" });
        const s = span(r.stroke);
        expect(s.arcs).toBe(0);
        expect(s.start[0]).toBe(s.end[0]);
        expect(tipOf(r.tail)).toEqual([s.start[0], 0]);
        expect(tipOf(r.head)).toEqual([s.end[0], 200]);
        expect(s.start[1]).toBe(HEAD);
        expect(s.end[1]).toBe(200 - HEAD);
    });

    test("a tight forward gap out of view still leaves the source its full run-out", () => {
        // Just room for the S: the corner clamps to the horizontal room, so
        // the exit never runs backwards.
        const r = routeRibbon(bar(100, 200, 20), { ...bar(200 + HEAD + 2 * RUN_OUT + 4, 300, 190), off: "below" });
        const first = parse(r.stroke)[1]!;
        expect(first.c).toBe("L");
        expect(first.n[0]!).toBeGreaterThanOrEqual(200 + RUN_OUT);
    });

    test("a row at the very edge still routes: every number is finite", () => {
        // The source's centre sits 3px above the bottom edge its destination
        // lies past — less than a head's length.
        for (const r of [
            routeRibbon(bar(100, 200, 197), { ...bar(400, 500, 190), off: "below" }),
            routeRibbon({ ...bar(100, 200, 10), off: "above" }, bar(400, 500, 3)),
        ]) {
            for (const d of [r.stroke, r.head, r.tail]) {
                for (const cmd of parse(d)) expect(cmd.n.every(Number.isFinite)).toBe(true);
            }
        }
    });

    test("the band is half the bar's height, and the head grows with it", () => {
        const thin = routeRibbon({ leftX: 0, rightX: 100, top: 14, bottom: 26 }, { leftX: 300, rightX: 400, top: 78, bottom: 90 });
        expect(thin.width).toBe(6);
        // A 6px band keeps the 5px minimum head; its half-width is 3px.
        expect(tipOf(thin.head)).toEqual([300, 84]);
        expect(baseOf(thin.head)).toEqual([295, 84]);
        const half = parse(thin.head).filter((c) => c.c !== "Z").map(endOf);
        expect(Math.abs(half[0]![1] - half[2]![1])).toBe(6);
    });

    test("constants match the fixtures above (a 20px bar)", () => {
        const r = routeRibbon(bar(0, 100, 20), bar(300, 400, 84));
        expect(r.width).toBe(2 * HALF);
        expect(tipOf(r.head)[0] - baseOf(r.head)[0]).toBe(HEAD);
    });
});
