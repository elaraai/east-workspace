/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Numerical tests for the DXF bulge-arc geometry in {@link arcFromBulge}. The
 * paint layer can't be pixel-snapshotted here, so these assert the maths an arc
 * renders from: centre, radius, endpoints-on-circle, and — the bit a data test
 * can't catch — that the arc bulges to the side the bulge sign dictates. A
 * drop's marks (#1390), and the narrowing's context, emphasis and frame
 * (#1392), are asserted over a 2D context that records what each stroke and
 * fill draws: its style, width, dash and alpha, and its path's arcs.
 */

import { describe, it, expect } from "vitest";
import { defaultValue, none, some, variant } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { drawnItem, drawnLink, drawnNet, drawnZone, type SchematicDrawn } from "./drawn";
import {
    netGeometry,
    MARKER_DOT_HIT_RADIUS, MARKER_DOT_RADIUS,
    arcFromBulge, hatchLineCount, hatchSpacing, hatchSweepBounds, markerHit, markerHitbox, type BulgeArc,
    paintSchematic, parallelLanes, polylineMidpoint, type PaintInput, type RGB, type SchematicPalette,
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
    const item = { x: 5, y: 5, label: "RACK-07" };   // anchor → screen (50, 50)

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

describe("netGeometry (bus-bar nets)", () => {
    it("1→N column: vertical header bar offset toward the trunk, a stub per rack, interior taps only", () => {
        // A power distribution unit's circuits: PDU-1 at (2.5,6.5), four racks at x=10.
        const geo = netGeometry(
            [{ x: 2.5, y: 6.5 }],
            [{ x: 10, y: 1.8 }, { x: 10, y: 4.6 }, { x: 10, y: 7.4 }, { x: 10, y: 10.2 }],
            [],
        );
        // Bar clearance = clamp(gap(7.5) * 0.3, 0.9, 3) = 2.25 toward the source.
        expect(geo.bars).toEqual([[{ x: 7.75, y: 1.8 }, { x: 7.75, y: 10.2 }]]);
        // Trunk runs source → the bar tap level with it; no waypoints.
        expect(geo.trunk).toEqual([{ x: 2.5, y: 6.5 }, { x: 7.75, y: 6.5 }]);
        // One horizontal stub per rack, landing on the bar.
        expect(geo.stubs).toHaveLength(4);
        expect(geo.stubs.map(st => st[1])).toEqual([
            { x: 7.75, y: 1.8 }, { x: 7.75, y: 4.6 }, { x: 7.75, y: 7.4 }, { x: 7.75, y: 10.2 },
        ]);
        // Dots ONLY at 3-way joins: the two interior stubs + the trunk tap —
        // the span-end stubs are plain elbows.
        expect(geo.taps).toEqual([{ x: 7.75, y: 4.6 }, { x: 7.75, y: 7.4 }, { x: 7.75, y: 6.5 }]);
    });

    it("2→1 with a via waypoint: bar offset clamps to the 0.9 minimum and the trunk threads the via", () => {
        // Two uplinks: TOR-A/TOR-B → SPINE via (20,6).
        const geo = netGeometry(
            [{ x: 17.5, y: 3.4 }, { x: 17.5, y: 8.2 }],
            [{ x: 24, y: 6 }],
            [{ x: 20, y: 6 }],
        );
        // gap(2.5) * 0.3 = 0.75, under the 0.9 minimum.
        expect(geo.bars).toEqual([[{ x: 18.4, y: 3.4 }, { x: 18.4, y: 8.2 }]]);
        expect(geo.trunk).toEqual([{ x: 18.4, y: 6 }, { x: 20, y: 6 }, { x: 24, y: 6 }]);
        // Both stubs land at the bar ENDS → elbows; the only dot is the trunk tap.
        expect(geo.taps).toEqual([{ x: 18.4, y: 6 }]);
    });

    it("each stub names its leg: a side with one member draws no stub, so the destinations' stubs come first (#1388)", () => {
        // One power distribution unit feeding two racks: the supply side is a bare anchor.
        const geo = netGeometry([{ x: 18.6, y: 4.2 }], [{ x: 13.2, y: 2.9 }, { x: 16.8, y: 2.9 }], []);
        expect(geo.stubs).toHaveLength(2);
        expect(geo.legs).toEqual([{ end: "destination", index: 0 }, { end: "destination", index: 1 }]);
        expect(geo.stubs.map(st => st[0])).toEqual([{ x: 13.2, y: 2.9 }, { x: 16.8, y: 2.9 }]);
        // Two each side: the sources' stubs, then the destinations'.
        const both = netGeometry([{ x: 0, y: 0 }, { x: 0, y: 4 }], [{ x: 10, y: 0 }, { x: 10, y: 4 }], []);
        expect(both.legs).toEqual([
            { end: "source", index: 0 }, { end: "source", index: 1 }, { end: "destination", index: 0 }, { end: "destination", index: 1 },
        ]);
    });

    it("1→1 with no waypoints degrades to a plain link — no bars, stubs, or dots", () => {
        const geo = netGeometry([{ x: 1, y: 1 }], [{ x: 5, y: 1 }], []);
        expect(geo.trunk).toEqual([{ x: 1, y: 1 }, { x: 5, y: 1 }]);
        expect(geo.bars).toEqual([]);
        expect(geo.stubs).toEqual([]);
        expect(geo.legs).toEqual([]);
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

// ============================================================================
// A drop's marks (#1390)
// ============================================================================

/** One stroke or fill as a context drew it: its style, its width, its dash, its alpha, and the arcs its path holds. */
interface Drawn {
    readonly op: "stroke" | "fill";
    readonly style: string;
    readonly width: number;
    readonly dash: readonly number[];
    readonly alpha: number;
    readonly arcs: readonly { readonly x: number; readonly y: number; readonly r: number }[];
}

/** A Canvas2D context that records each stroke and fill: what the paint layer drew, without pixels. */
function recorder(): { ctx: CanvasRenderingContext2D; drawn: Drawn[] } {
    const drawn: Drawn[] = [];
    let state = { strokeStyle: "", fillStyle: "", lineWidth: 1, globalAlpha: 1, dash: [] as number[] };
    const saved: (typeof state)[] = [];
    let arcs: { x: number; y: number; r: number }[] = [];
    const record = (op: "stroke" | "fill") => drawn.push({
        op, style: op === "stroke" ? state.strokeStyle : state.fillStyle, width: state.lineWidth, dash: [...state.dash], alpha: state.globalAlpha, arcs: [...arcs],
    });
    const ctx = {
        canvas: { width: 300, height: 200 },
        get strokeStyle() { return state.strokeStyle; }, set strokeStyle(v: string) { state.strokeStyle = v; },
        get fillStyle() { return state.fillStyle; }, set fillStyle(v: string) { state.fillStyle = v; },
        get lineWidth() { return state.lineWidth; }, set lineWidth(v: number) { state.lineWidth = v; },
        get globalAlpha() { return state.globalAlpha; }, set globalAlpha(v: number) { state.globalAlpha = v; },
        lineJoin: "miter", lineCap: "butt", font: "", textBaseline: "alphabetic", lineDashOffset: 0,
        save() { saved.push({ ...state, dash: [...state.dash] }); },
        restore() { state = saved.pop() ?? state; },
        setLineDash(dash: number[]) { state.dash = [...dash]; },
        setTransform() {}, clearRect() {}, clip() {}, closePath() {},
        beginPath() { arcs = []; },
        moveTo() {}, lineTo() {}, quadraticCurveTo() {}, rect() {}, roundRect() {},
        arc(x: number, y: number, r: number) { arcs.push({ x, y, r }); },
        stroke() { record("stroke"); },
        fill() { record("fill"); },
        strokeRect() { record("stroke"); },
        fillRect() { record("fill"); },
        fillText() {},
        measureText(text: string) { return { width: text.length * 6 }; },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

/** A palette whose every role is its own colour: the brand's line `rgb(10,20,30)`, its wash `rgb(40,50,60)`. */
const PALETTE: SchematicPalette = (() => {
    const roles = ["brandMark", "brandSolid", "brandTint", "fg", "fgStrong", "fgMuted", "fgSubtle", "fgFaint", "bgSurface", "bgCanvas",
        "borderSubtle", "borderStrong", "statusPos", "statusNeg", "statusWarn", "statusInfo"] as const;
    const palette = Object.fromEntries(roles.map((role, i): [string, RGB] => [role, [i, i, i]])) as unknown as SchematicPalette;
    return { ...palette, brandSolid: [10, 20, 30], brandTint: [40, 50, 60], labelFont: "10px mono", eyebrowFont: "9px mono" };
})();

describe("a drop's marks (#1390)", () => {
    const T = Schematic.Types;
    const A = { kind: "racks", key: "A" }, B = { kind: "racks", key: "B" };
    const a = drawnItem(A, { ...defaultValue<typeof T.Item>(T.Item), position: some({ x: 2, y: 2 }), label: "A" }, undefined)!;
    const b = drawnItem(B, { ...defaultValue<typeof T.Item>(T.Item), position: some({ x: 8, y: 2 }), label: "B" }, undefined)!;
    const run = drawnLink({ kind: "fibre", key: "u1" }, {
        ...defaultValue<typeof T.Link>(T.Link), from: A, to: B, route: variant("direct", null), style: variant("solid", { tone: none, weight: none }),
    });
    const cage = drawnZone({ kind: "areas", key: "cage" }, {
        ...defaultValue<typeof T.Zone>(T.Zone), x: 10, y: 10, width: 4, height: 4, label: "Cage", pattern: variant("outline", { tone: none }),
    });
    const DRAWN: SchematicDrawn = { items: [a, b], zones: [cage], links: [run], nets: [] };

    /** What a frame paints at 10 px a unit, the items as dots, with a drop's mark or none. */
    function paint(dropMark?: PaintInput["dropMark"]): Drawn[] {
        const { ctx, drawn } = recorder();
        paintSchematic({
            ctx, value: DRAWN, cam: { ppu: 10, tx: 0, ty: 0 }, width: 300, height: 200,
            visibleItems: [a, b], tiers: new Map([[a.key, "dot"], [b.key, "dot"]]), selected: new Set(), selectedZones: new Set(),
            centers: new Map([[a.key, { x: 2, y: 2 }], [b.key, { x: 8, y: 2 }]]), palette: PALETTE, tints: new Map(),
            ...(dropMark === undefined ? {} : { dropMark }),
        });
        return drawn;
    }
    const BRAND_WASH = "rgba(10,20,30,0.3)";
    const BRAND = "rgb(10,20,30)";

    it("with no drag resting, nothing of the brand's line is drawn but the run itself", () => {
        expect(paint().filter((d) => d.style === BRAND_WASH)).toEqual([]);
        expect(paint().filter((d) => d.style === BRAND && d.op === "stroke").map((d) => d.width)).toEqual([2.5]);
    });

    it("the run a card lands on takes the brand's wash, wide under its line", () => {
        expect(paint({ kind: "entity", id: run.key }).filter((d) => d.style === BRAND_WASH).map((d) => [d.op, d.width])).toEqual([["stroke", 12.5]]);
    });

    it("the marker a card lands on takes a brand ring about it, wider than a selection's", () => {
        const rings = paint({ kind: "entity", id: a.key }).filter((d) => d.style === BRAND && d.op === "stroke" && d.arcs.length > 0);
        expect(rings.map((d) => [d.width, d.arcs])).toEqual([[2.5, [{ x: 20, y: 20, r: 15 }]]]);
    });

    it("the zone a card lands on takes the brand's wash under a dashed brand edge — a selection's edge is solid", () => {
        const marks = paint({ kind: "entity", id: cage.key });
        // The zones paint under the runs: the zone's dashed edge, then the run's own line.
        expect(marks.filter((d) => d.style === BRAND && d.op === "stroke").map((d) => [d.width, d.dash])).toEqual([[2, [6, 4]], [2.5, []]]);
        expect(marks.filter((d) => d.style === "rgb(40,50,60)" && d.op === "fill").map((d) => d.alpha)).toEqual([0.5]);
    });

    it("the point a template's item or a backlog row lands at takes a ring, and a dot at its centre, over every marker", () => {
        const marks = paint({ kind: "point", x: 5, y: 7 });
        const last = marks.slice(-2);
        expect(last.map((d) => [d.op, d.style, d.arcs])).toEqual([
            ["stroke", BRAND, [{ x: 50, y: 70, r: 8 }]],
            ["fill", BRAND, [{ x: 50, y: 70, r: 2.5 }]],
        ]);
    });
});

// ============================================================================
// The narrowing (#1392)
// ============================================================================

describe("the narrowing's context, emphasis and frame (#1392)", () => {
    const T = Schematic.Types;
    const at = (key: string, x: number, y: number) => drawnItem({ kind: "racks", key }, {
        ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y }), label: key,
    }, undefined)!;
    const a = at("A", 2, 2), b = at("B", 8, 2), c = at("C", 14, 2), unit = at("P", 8, 12);
    const run = (key: string, from: string, to: string) => drawnLink({ kind: "fibre", key }, {
        ...defaultValue<typeof T.Link>(T.Link), from: { kind: "racks", key: from }, to: { kind: "racks", key: to },
        route: variant("direct", null), style: variant("solid", { tone: none, weight: none }),
    });
    const u1 = run("u1", "A", "B"), u2 = run("u2", "B", "C");
    const cage = drawnZone({ kind: "areas", key: "cage" }, {
        ...defaultValue<typeof T.Zone>(T.Zone), x: 10, y: 10, width: 4, height: 4, label: "Cage", pattern: variant("outline", { tone: none }),
    });
    // P feeds A and C: two stubs off a bar, A's then C's.
    const feed = drawnNet({ kind: "feeds", key: "f" }, {
        ...defaultValue<typeof T.Net>(T.Net), sources: [{ kind: "racks", key: "P" }], destinations: [{ kind: "racks", key: "A" }, { kind: "racks", key: "C" }],
        route: variant("direct", null), style: variant("solid", { tone: none, weight: none }),
    });
    const items = [a, b, c, unit];
    const DRAWN: SchematicDrawn = { items, zones: [cage], links: [u1, u2], nets: [feed] };
    /** Each rack in a red of its own; each run and the feed in a green: what greying takes away. */
    const RED: RGB = [200, 0, 0], GREEN: RGB = [0, 200, 0];
    const TINTS = new Map<string, RGB>([...items.map((i): [string, RGB] => [i.key, RED]), [u1.key, GREEN], [u2.key, GREEN], [feed.key, GREEN], [cage.key, RED]]);

    /** What a frame paints at 10 px a unit, the items as dots, under an effect. */
    function paint(effect: PaintInput["effect"]): Drawn[] {
        const { ctx, drawn } = recorder();
        paintSchematic({
            ctx, value: DRAWN, cam: { ppu: 10, tx: 0, ty: 0 }, width: 300, height: 200,
            visibleItems: items, tiers: new Map(items.map((i) => [i.key, "dot" as const])), selected: new Set(), selectedZones: new Set(),
            centers: new Map(items.map((i) => [i.key, { x: i.x, y: i.y }])), palette: PALETTE, tints: TINTS,
            ...(effect === undefined ? {} : { effect }),
        });
        return drawn;
    }
    const RED_CSS = "rgb(200,0,0)", GREEN_CSS = "rgb(0,200,0)";
    /** The palette's muted ink (`fgMuted`), and a zone's ground (`borderStrong`). */
    const MUTED = "rgb(5,5,5)", GROUND = "rgb(11,11,11)";
    /** The matches' ring: the brand's mark (`brandMark`) at the halo's alpha. */
    const HALO = "rgba(0,0,0,0.34)";
    /** The palette's brand line (`brand.solid`), as the frame strokes it. */
    const BRAND_LINE = "rgb(10,20,30)";
    const effect = (over: Partial<NonNullable<PaintInput["effect"]>>): NonNullable<PaintInput["effect"]> => ({
        excluded: new Set(), excludedOpacity: 0.35, excludedDesaturate: true, matches: new Set(), emphasis: undefined, pulsePhase: 0, frame: undefined, ...over,
    });
    /** A dot's fill about a centre, in screen px. */
    const dotAt = (drawn: Drawn[], x: number, y: number) => drawn.find((d) => d.op === "fill" && d.arcs.some((r) => r.x === x && r.y === y && r.r === 5))!;

    it("what draws as context is faded and greyed — a rack's dot, a run, a zone's edge, and the feed's leg to it — and the rest draws as itself", () => {
        const drawn = paint(effect({ excluded: new Set([c.key, u2.key, cage.key]) }));
        expect([dotAt(drawn, 140, 20).style, dotAt(drawn, 140, 20).alpha]).toEqual([MUTED, 0.35]);
        expect([dotAt(drawn, 20, 20).style, dotAt(drawn, 20, 20).alpha]).toEqual([RED_CSS, 1]);
        // The runs: u1 as itself, u2 faded in the muted ink — their lines, 2.5 wide.
        expect(drawn.filter((d) => d.op === "stroke" && d.width === 2.5 && d.arcs.length === 0).map((d) => [d.style, d.alpha])).toEqual([
            [GREEN_CSS, 1], [MUTED, 0.35],
            // The feed's stubs, its weight: A's as itself, C's faded with C.
            [GREEN_CSS, 1], [MUTED, 0.35],
        ]);
        // The cage's dashed edge, drained to a zone's ground.
        expect(drawn.filter((d) => d.op === "stroke" && d.dash.length === 2 && d.dash[0] === 5).map((d) => [d.style, d.alpha])).toEqual([[GROUND, 0.35]]);
        // Greying off: faded in its own colour.
        const kept = paint(effect({ excluded: new Set([c.key]), excludedDesaturate: false }));
        expect([dotAt(kept, 140, 20).style, dotAt(kept, 140, 20).alpha]).toEqual([RED_CSS, 0.35]);
    });

    it("a halo rings each match — a rack's marker, a zone's edge, a run's line and the feed's — and nothing else", () => {
        const drawn = paint(effect({ matches: new Set([a.key, cage.key, u1.key, feed.key]), emphasis: "halo" }));
        const rings = drawn.filter((d) => d.style === HALO);
        // The zone's edge (2 + 4), the run under its line (2.5 + 4 + 4), the feed under its trunk, bar and stubs (2.5 + 5 + 4), and A's marker (11 + 4).
        expect(rings.map((d) => d.width)).toEqual([6, 10.5, 11.5, 11.5, 11.5, 11.5, 2]);
        expect(rings.at(-1)!.arcs).toEqual([{ x: 20, y: 20, r: 15 }]);
        // No match, no ring: an emphasis over nothing draws nothing.
        expect(paint(effect({ emphasis: "halo" })).filter((d) => d.style === HALO)).toEqual([]);
    });

    it("a pulse breathes: its ring grows and fades with its phase", () => {
        const ringOf = (phase: number) => paint(effect({ matches: new Set([a.key]), emphasis: "pulse", pulsePhase: phase }))
            .find((d) => d.op === "stroke" && d.arcs.some((r) => r.x === 20 && r.y === 20 && r.r > 5))!;
        // At rest the breath is half drawn in; a quarter on, it is full: wider, and fainter.
        expect([ringOf(0).arcs[0]!.r, ringOf(0).style]).toEqual([11 + 3.5, `rgba(0,0,0,${0.14 + 0.3 * 0.5})`]);
        expect([ringOf(0.25).arcs[0]!.r, ringOf(0.25).style]).toEqual([11 + 7, "rgba(0,0,0,0.14)"]);
    });

    it("the frame boxes the matches in a dashed brand edge over the brand's wash", () => {
        const drawn = paint(effect({ matches: new Set([a.key, b.key]), frame: { minX: 2, minY: 2, maxX: 8, maxY: 2 } }));
        expect(drawn.filter((d) => d.dash.length === 2 && d.dash[0] === 7).map((d) => [d.op, d.style, d.width])).toEqual([["stroke", BRAND_LINE, 1.5]]);
    });
});
