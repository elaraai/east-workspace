/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Numerical tests for the DXF bulge-arc geometry in {@link arcFromBulge}. The
 * paint layer can't be pixel-snapshotted here, so these assert the maths an arc
 * renders from: centre, radius, endpoints-on-circle, and — the bit a data test
 * can't catch — that the arc bulges to the side the bulge sign dictates.
 */

import { describe, it, expect } from "vitest";
import { arcFromBulge, type BulgeArc } from "./paint";

type Pt = { x: number; y: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** The point at the middle of the arc as `CanvasRenderingContext2D.arc` would
 * sweep it (start→end, respecting `anticlockwise`). */
function apex(a: BulgeArc): Pt {
    const TAU = Math.PI * 2;
    const norm = (x: number) => ((x % TAU) + TAU) % TAU;
    const sweep = a.anticlockwise ? -norm(a.startAngle - a.endAngle) : norm(a.endAngle - a.startAngle);
    const mid = a.startAngle + sweep / 2;
    return { x: a.cx + a.radius * Math.cos(mid), y: a.cy + a.radius * Math.sin(mid) };
}

describe("arcFromBulge", () => {
    it("returns null for straight / degenerate edges", () => {
        expect(arcFromBulge({ x: 0, y: 0 }, { x: 5, y: 0 }, 0)).toBeNull();
        expect(arcFromBulge({ x: 0, y: 0 }, { x: 5, y: 0 }, 0.00001)).toBeNull();
        expect(arcFromBulge({ x: 2, y: 2 }, { x: 2, y: 2 }, 1)).toBeNull(); // zero chord
    });

    it("bulge = 1 is a semicircle: centre on the chord, radius = half-chord", () => {
        const arc = arcFromBulge({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)!;
        expect(arc).not.toBeNull();
        expect(arc.cx).toBeCloseTo(1, 6);
        expect(arc.cy).toBeCloseTo(0, 6);
        expect(arc.radius).toBeCloseTo(1, 6);
    });

    it("bulge sign flips which side the arc bulges (and the sweep direction)", () => {
        const pos = arcFromBulge({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)!;
        const neg = arcFromBulge({ x: 0, y: 0 }, { x: 2, y: 0 }, -1)!;
        // Same circle, opposite apex and opposite sweep flag.
        expect(apex(pos).y).toBeCloseTo(-1, 6);
        expect(apex(neg).y).toBeCloseTo(1, 6);
        expect(pos.anticlockwise).toBe(false);
        expect(neg.anticlockwise).toBe(true);
    });

    it("quarter circle (bulge = tan(pi/8)) has unit radius and the expected centre", () => {
        const arc = arcFromBulge({ x: 0, y: 0 }, { x: 1, y: 1 }, Math.tan(Math.PI / 8))!;
        expect(arc.radius).toBeCloseTo(1, 6);
        expect(arc.cx).toBeCloseTo(0, 6);
        expect(arc.cy).toBeCloseTo(1, 6);
    });

    it("both endpoints always lie on the derived circle", () => {
        const cases: Array<[Pt, Pt, number]> = [
            [{ x: 0, y: 0 }, { x: 2, y: 0 }, 1],
            [{ x: 0, y: 0 }, { x: 1, y: 1 }, Math.tan(Math.PI / 8)],
            [{ x: -3, y: 4 }, { x: 5, y: -2 }, 0.3],
            [{ x: 10, y: 10 }, { x: 7, y: 13 }, -0.7],
            [{ x: 0, y: 0 }, { x: 6, y: 0 }, 0.15],
        ];
        for (const [p1, p2, b] of cases) {
            const arc = arcFromBulge(p1, p2, b)!;
            expect(arc).not.toBeNull();
            const c = { x: arc.cx, y: arc.cy };
            expect(dist(c, p1)).toBeCloseTo(arc.radius, 6);
            expect(dist(c, p2)).toBeCloseTo(arc.radius, 6);
            // The apex is exactly `radius` from the centre too (it's on the arc).
            expect(dist(c, apex(arc))).toBeCloseTo(arc.radius, 6);
        }
    });

    it("a gentle bulge yields a large radius and a shallow apex on the correct side", () => {
        const arc = arcFromBulge({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.1)!;
        expect(arc.radius).toBeGreaterThan(10); // shallow arc → big circle
        const a = apex(arc);
        expect(a.x).toBeCloseTo(5, 6);          // apex over the chord midpoint
        expect(a.y).toBeLessThan(0);            // positive bulge → bulges to -y
        expect(a.y).toBeGreaterThan(-1);        // but only slightly
    });
});
