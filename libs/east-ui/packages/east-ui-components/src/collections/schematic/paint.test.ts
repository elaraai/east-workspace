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
import {
    netGeometry,
    MARKER_DOT_HIT_RADIUS, MARKER_DOT_RADIUS,
    arcFromBulge, hatchLineCount, hatchSpacing, hatchSweepBounds, markerHit, markerHitbox, type BulgeArc,
    parallelLanes, polylineMidpoint,
} from "./paint";

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

    it("an extreme bulge yields a finite arc or null — never NaN / Infinity (P9)", () => {
        // A large finite bulge drives theta → ±2π, giving a huge-but-finite
        // radius (a near-straight arc). The guard's job is to never emit a
        // non-finite centre/radius that ctx.arc would choke on.
        for (const bulge of [1e6, -1e6, 1e9, 1e12, 1e300]) {
            const arc = arcFromBulge({ x: 0, y: 0 }, { x: 10, y: 0 }, bulge);
            if (arc !== null) {
                for (const v of [arc.cx, arc.cy, arc.radius, arc.startAngle, arc.endAngle]) {
                    expect(Number.isFinite(v)).toBe(true);
                }
            }
        }
        // A genuinely non-finite input falls back to straight (null).
        expect(arcFromBulge({ x: 0, y: 0 }, { x: 10, y: 0 }, NaN)).toBeNull();
        expect(arcFromBulge({ x: 0, y: 0 }, { x: 10, y: 0 }, Infinity)).not.toBeNull();
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

describe("hatch sweep bound (P3)", () => {
    it("clamps spacing to a positive minimum so the sweep terminates", () => {
        expect(hatchSpacing(0)).toBe(1);
        expect(hatchSpacing(-5)).toBe(1);
        expect(hatchSpacing(0.4)).toBe(1);
        expect(hatchSpacing(8)).toBe(8);        // a valid spacing is untouched
    });

    it("yields a bounded, finite line count for a zero / negative / NaN spacing", () => {
        const count0 = hatchLineCount(1000, 1000, 0);
        const countNeg = hatchLineCount(1000, 1000, -5);
        expect(Number.isFinite(count0)).toBe(true);
        expect(count0).toBe(countNeg);          // both clamp to spacing 1
        expect(Number.isFinite(hatchLineCount(1000, 1000, NaN))).toBe(true); // NaN clamps to 1 too
        // bounded by the (clamped) diagonal, not infinite as `spacing: 0` was
        expect(count0).toBeLessThanOrEqual(Math.ceil(2 * Math.hypot(1000, 1000)) + 1);
        expect(hatchLineCount(100, 100, 8)).toBeLessThan(40);
    });

    // The full -diag..diag sweep draws a line for every offset, but only those
    // whose normal-coordinate falls within the visible rect's span actually
    // paint (the rest are clipped away). `hatchSweepBounds` must reproduce that
    // VISIBLE set exactly — never under-drawing, never phase-shifting it.
    const visibleOffsets = (
        x: number, y: number, w: number, h: number, width: number, height: number,
        dx: number, dy: number, diag: number, spacing: number, oLo: number, oHi: number,
    ): number[] => {
        const nx = -dy, ny = dx;
        const cx0 = Math.max(x, 0), cy0 = Math.max(y, 0), cx1 = Math.min(x + w, width), cy1 = Math.min(y + h, height);
        const cs = [cx0 * nx + cy0 * ny, cx1 * nx + cy0 * ny, cx0 * nx + cy1 * ny, cx1 * nx + cy1 * ny];
        const cmin = Math.min(...cs), cmax = Math.max(...cs);
        const cOf = (o: number) => (x + o) * nx + (y - diag * dy) * ny;
        const out: number[] = [];
        for (let o = oLo; o < oHi; o += spacing) {
            const c = cOf(o);
            if (c >= cmin - 1e-9 && c <= cmax + 1e-9) out.push(Math.round(o * 1e6) / 1e6);
        }
        return out;
    };

    it("draws exactly the visible lines of the full sweep, phase-locked to the same grid (1e)", () => {
        const W = 1000, H = 800, spacing = 8;
        const zones = [
            { x: 10, y: 10, w: 200, h: 200, label: "fully on screen" },
            { x: -400, y: -300, w: 1800, h: 1500, label: "much larger than viewport" },
            { x: 600, y: 400, w: 900, h: 700, label: "clipped at right/bottom" },
        ];
        for (const z of zones) {
            for (const deg of [15, 30, 45, 60, 90, 120, 135, 160]) {
                const angle = (deg * Math.PI) / 180;
                const dx = Math.cos(angle), dy = Math.sin(angle), diag = Math.hypot(z.w, z.h);
                const { oStart, oEnd } = hatchSweepBounds(z.x, z.y, z.w, z.h, W, H, dx, dy, diag, spacing);
                // bounded sweep never exceeds the full sweep
                expect(oStart).toBeGreaterThanOrEqual(-diag);
                expect(oEnd).toBeLessThanOrEqual(diag);
                // phase-locked to the full sweep's { -diag + k·spacing } grid
                const k = (oStart + diag) / spacing;
                expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
                // and it paints exactly the lines the full sweep would (no under-draw, no shift)
                const full = visibleOffsets(z.x, z.y, z.w, z.h, W, H, dx, dy, diag, spacing, -diag, diag);
                const bounded = visibleOffsets(z.x, z.y, z.w, z.h, W, H, dx, dy, diag, spacing, oStart, oEnd);
                expect(bounded).toEqual(full);
            }
        }
    });
});

describe("markerHitbox / markerHit (P11)", () => {
    const cam = { ppu: 10, tx: 0, ty: 0 };
    const item = { x: 5, y: 5, label: "TANK-04" };   // anchor → screen (50, 50)

    it("a dot is clickable across its full drawn extent plus touch slop", () => {
        const box = markerHitbox(item, "dot", cam, () => 0);
        expect(box.kind).toBe("circle");
        expect(markerHit(box, 50, 50)).toBe(true);                       // centre
        expect(markerHit(box, 50 + MARKER_DOT_RADIUS + 1, 50)).toBe(true); // past the drawn dot, within slop
        expect(MARKER_DOT_HIT_RADIUS).toBeGreaterThan(MARKER_DOT_RADIUS);
        expect(markerHit(box, 50 + MARKER_DOT_HIT_RADIUS + 1, 50)).toBe(false); // just outside the hit radius
    });

    it("a label is clickable anywhere on its rendered pill, not just near its centre", () => {
        const measure = (t: string) => t.length * 6;          // stub the painter's measureText
        const box = markerHitbox(item, "label", cam, measure);
        expect(box.kind).toBe("rect");
        if (box.kind !== "rect") return;
        const tw = measure(item.label);
        const w = 6 + 7 + 4 + tw + 6;                         // pad + dot + gap + text + pad
        expect(box.w).toBeCloseTo(w);
        expect(box.left).toBeCloseTo(50 - w / 2);
        expect(markerHit(box, 50, 50)).toBe(true);            // centre
        // A point 25px right of centre — beyond the old 18px center-radius reach
        // — now correctly hits the wide pill (regression fix).
        expect(w / 2).toBeGreaterThan(25);
        expect(markerHit(box, 50 + 25, 50)).toBe(true);
        // Just inside / just outside the right edge.
        expect(markerHit(box, 50 + w / 2 - 1, 50)).toBe(true);
        expect(markerHit(box, 50 + w / 2 + 1, 50)).toBe(false);
    });
});

describe("polylineMidpoint (#180 link labels)", () => {
    it("is the arc-length midpoint, not the chord midpoint", () => {
        // L-shaped path 0,0 → 10,0 → 10,10 (length 20 ⇒ midpoint at the elbow-adjacent 10,0…10,10 start).
        const mid = polylineMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
        expect(mid).toEqual({ x: 10, y: 0 });
    });

    it("lands mid-segment when the half-length falls inside one", () => {
        const mid = polylineMidpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
        expect(mid).toEqual({ x: 5, y: 0 });
    });

    it("degenerate inputs are safe", () => {
        expect(polylineMidpoint([])).toEqual({ x: 0, y: 0 });
        expect(polylineMidpoint([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
        expect(polylineMidpoint([{ x: 3, y: 4 }, { x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
    });
});

describe("parallelLanes (#180 fan-out)", () => {
    const L = (key: string, from: string, to: string) => ({ key, from, to });

    it("assigns deterministic lanes to same-pair links (either direction), none to singles", () => {
        const lanes = parallelLanes([L("b", "A", "B"), L("a", "B", "A"), L("solo", "A", "C")], () => true);
        expect(lanes.get("a")).toEqual({ i: 0, n: 2 });   // key-sorted
        expect(lanes.get("b")).toEqual({ i: 1, n: 2 });
        expect(lanes.has("solo")).toBe(false);            // a lone edge keeps its true path
    });

    it("ineligible links (hidden / waypointed / unresolved) never join a group", () => {
        const lanes = parallelLanes([L("a", "A", "B"), L("b", "A", "B")], l => l.key !== "b");
        expect(lanes.size).toBe(0);                       // group collapsed to 1 ⇒ no fanning
    });

    it("three-way groups centre around the true path", () => {
        const lanes = parallelLanes([L("a", "A", "B"), L("b", "A", "B"), L("c", "A", "B")], () => true);
        expect(lanes.get("b")).toEqual({ i: 1, n: 3 });   // middle lane = zero offset
    });
});

describe("netGeometry (bus-bar manifolds)", () => {
    it("1→N column: vertical header bar offset toward the trunk, stubs per unit, interior taps only", () => {
        // The schematicNets CIP fixture: one source at (2,6), four units at x=9.
        const geo = netGeometry(
            [{ x: 2, y: 6 }],
            [{ x: 9, y: 2 }, { x: 9, y: 4.5 }, { x: 9, y: 7 }, { x: 9, y: 9.5 }],
            [],
        );
        // Bar clearance = clamp(gap(7) * 0.3, 0.9, 3) = 2.1 toward the source.
        expect(geo.bars).toEqual([[{ x: 6.9, y: 2 }, { x: 6.9, y: 9.5 }]]);
        // Trunk runs source → mid-bar tap; no waypoints.
        expect(geo.trunk).toEqual([{ x: 2, y: 6 }, { x: 6.9, y: 6 }]);
        // One horizontal stub per unit, landing on the bar.
        expect(geo.stubs).toHaveLength(4);
        expect(geo.stubs.map(st => st[1])).toEqual([
            { x: 6.9, y: 2 }, { x: 6.9, y: 4.5 }, { x: 6.9, y: 7 }, { x: 6.9, y: 9.5 },
        ]);
        // Dots ONLY at 3-way joins: the two interior stubs + the trunk tap —
        // the span-end stubs are plain elbows.
        expect(geo.taps).toEqual([{ x: 6.9, y: 4.5 }, { x: 6.9, y: 7 }, { x: 6.9, y: 6 }]);
    });

    it("2→1 with a via waypoint: bar offset clamps to the 0.9 minimum and the trunk threads the via", () => {
        // The schematicNets header fixture: PK-A/PK-B → DOCK via (20,6).
        const geo = netGeometry(
            [{ x: 17, y: 3.5 }, { x: 17, y: 8 }],
            [{ x: 23, y: 6 }],
            [{ x: 20, y: 6 }],
        );
        expect(geo.bars).toEqual([[{ x: 17.9, y: 3.5 }, { x: 17.9, y: 8 }]]);
        expect(geo.trunk).toEqual([{ x: 17.9, y: 6 }, { x: 20, y: 6 }, { x: 23, y: 6 }]);
        // Both stubs land at the bar ENDS → elbows; the only dot is the trunk tap.
        expect(geo.taps).toEqual([{ x: 17.9, y: 6 }]);
    });

    it("1→1 with no waypoints degrades to a plain link — no bars, stubs, or dots", () => {
        const geo = netGeometry([{ x: 1, y: 1 }], [{ x: 5, y: 1 }], []);
        expect(geo.trunk).toEqual([{ x: 1, y: 1 }, { x: 5, y: 1 }]);
        expect(geo.bars).toEqual([]);
        expect(geo.stubs).toEqual([]);
        expect(geo.taps).toEqual([]);
    });

    it("a horizontally-spread side gets a HORIZONTAL bar below/above toward the trunk", () => {
        // Three sources in a row at y=2 feeding one sink below at (5,8):
        // spread axis = x, so the bar is horizontal, offset DOWN toward the sink.
        const geo = netGeometry(
            [{ x: 2, y: 2 }, { x: 5, y: 2 }, { x: 8, y: 2 }],
            [{ x: 5, y: 8 }],
            [],
        );
        expect(geo.bars).toHaveLength(1);
        const [a, b] = geo.bars[0]!;
        expect(a.y).toBeCloseTo(3.8);          // clamp(6 * 0.3, 0.9, 3) = 1.8 below y=2
        expect(b.y).toBeCloseTo(3.8);
        expect([a.x, b.x]).toEqual([2, 8]);    // spans the sources
        // Trunk drops from the bar tap under the sink's x.
        expect(geo.trunk[0]).toEqual({ x: 5, y: 3.8 });
        expect(geo.taps).toEqual([{ x: 5, y: 3.8 }]);   // mid stub + trunk tap coincide → ONE dot
    });
});
