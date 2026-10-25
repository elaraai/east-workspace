/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Numerical tests for the DXF bulge-arc geometry in {@link arcFromBulge}. The
 * paint layer can't be pixel-snapshotted here, so these assert the maths an arc
 * renders from: centre, radius, endpoints-on-circle, and — the bit a data test
 * can't catch — that the arc bulges to the side the bulge sign dictates. A
 * drop's marks (#1390), the narrowing's context, emphasis and frame (#1392),
 * a marker whose status is unread and the words of what stands in while a new
 * narrowing is read (#1398), and the links' look (#1403) are
 * asserted over a 2D context that records what
 * each stroke and fill draws — its style, width, dash and alpha, and its path's
 * arcs — and each text; the links' routes, each end on an item's edge where it
 * draws at the zoom, over the routes themselves.
 */

import { describe, it, expect } from "vitest";
import { defaultValue, none, some, variant } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import type { SchematicDensity } from "../area.js";
import { drawnItem, drawnLink, drawnNet, drawnZone, type DrawnItem, type SchematicDrawn } from "./drawn";
import { PIN_LEAD_PX, SCHEMATIC_CARD_MAX_PX } from "./model";
import { MARKER_DOT_HIT_RADIUS, MARKER_DOT_RADIUS, markerHit, markerHitbox } from "./markers";
import {
    arcFromBulge, densityStep, hatchLineCount, hatchSpacing, hatchSweepBounds, type BulgeArc,
    paintSchematic, type LodTier, type PaintInput, type RGB, type SchematicPalette,
} from "./paint";
import { linkRoutes, netGeometry, netRoutes, parallelLanes, polylineMidpoint, routeEnv } from "./routes";

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

    it("a label is clickable anywhere on its rendered pill: its dot on its item's point, its words after it (#1393)", () => {
        const measure = (t: string) => t.length * 6;          // stub the painter's measureText
        const box = markerHitbox(item, "label", cam, measure);
        expect(box.kind).toBe("rect");
        if (box.kind !== "rect") return;
        const tw = measure(item.label);
        const w = 6 + 7 + 4 + tw + 6;                         // pad + dot + gap + text + pad
        expect(box.w).toBeCloseTo(w);
        // Its dot's centre stands on the item's point: the pad and half the dot before it.
        expect(PIN_LEAD_PX).toBe(6 + 7 / 2);
        expect(box.left).toBeCloseTo(50 - PIN_LEAD_PX);
        expect(markerHit(box, 50, 50)).toBe(true);            // the dot
        // A point 25px right of the item — beyond the old 18px center-radius reach — hits the wide pill (regression fix).
        expect(markerHit(box, 50 + 25, 50)).toBe(true);
        // Just inside / just outside each edge.
        expect(markerHit(box, box.left + 1, 50)).toBe(true);
        expect(markerHit(box, box.left - 1, 50)).toBe(false);
        expect(markerHit(box, box.left + w - 1, 50)).toBe(true);
        expect(markerHit(box, box.left + w + 1, 50)).toBe(false);
        expect(box.text).toBe(item.label);
    });

    it("a long label's pill is no wider than the widest card: its words cut before an ellipsis, between graphemes, a space before the cut dropped (#1393)", () => {
        const measure = (t: string) => t.length * 6;          // 6px a UTF-16 unit
        const pill = (label: string) => {
            const box = markerHitbox({ ...item, label }, "label", cam, measure);
            if (box.kind !== "rect") throw new Error("a label's marker is a pill");
            return box;
        };
        // The widest pill's words are 200 − (6 + 7 + 4 + 6) = 177px: 29 letters, the ellipsis one of them.
        const long = pill("A".repeat(80));
        expect(long.text).toBe(`${"A".repeat(28)}…`);
        expect(long.w).toBeCloseTo(6 + 7 + 4 + 29 * 6 + 6);
        expect(long.w).toBeLessThanOrEqual(SCHEMATIC_CARD_MAX_PX);
        // Hit as it draws: across its whole width, and no further.
        expect(markerHit(long, long.left + long.w - 1, 50)).toBe(true);
        expect(markerHit(long, long.left + long.w + 1, 50)).toBe(false);
        // A flag where the cut falls goes whole — half of one would fit.
        expect(pill(`${"A".repeat(26)}🇦🇺${"B".repeat(10)}`).text).toBe(`${"A".repeat(26)}…`);
        // A space before the cut goes too.
        expect(pill(`${"A".repeat(27)} ${"B".repeat(20)}`).text).toBe(`${"A".repeat(27)}…`);
    });
});

describe("a labelled pin (#1393)", () => {
    const T = Schematic.Types;
    const at = (key: string, label: string, x: number) => drawnItem({ kind: "racks", key }, {
        ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y: 2 }), label,
    }, undefined)!;

    it("draws its label whole, and a long one cut before an ellipsis: the words its hitbox gives", () => {
        const short = at("S", "RACK-07", 2), long = at("L", "A".repeat(80), 20);
        const { ctx, texts } = recorder();
        paintSchematic({
            ctx, value: { items: [short, long], zones: [], links: [], nets: [] }, cam: { ppu: 10, tx: 0, ty: 0 }, width: 300, height: 200,
            visibleItems: [short, long], tiers: new Map([[short.key, "label"], [long.key, "label"]]), selected: new Set(), selectedZones: new Set(),
            centers: new Map([[short.key, { x: 2, y: 2 }], [long.key, { x: 20, y: 2 }]]), palette: PALETTE, tints: new Map(),
        });
        expect(texts.map((text) => text.text)).toEqual(["RACK-07", `${"A".repeat(28)}…`]);
    });

    it("stands its dot on its item's point and its words after it, so the status it shows stands where its item does", () => {
        const pin = at("S", "RACK-07", 2);
        const { ctx, drawn, texts } = recorder();
        paintSchematic({
            ctx, value: { items: [pin], zones: [], links: [], nets: [] }, cam: { ppu: 10, tx: 0, ty: 0 }, width: 300, height: 200,
            visibleItems: [pin], tiers: new Map([[pin.key, "label"]]), selected: new Set(), selectedZones: new Set(),
            centers: new Map([[pin.key, { x: 2, y: 2 }]]), palette: PALETTE, tints: new Map(),
        });
        // Its dot about the rack's point (20, 20); its words after the pad, the dot and the gap, from 9.5 before the point.
        expect(drawn.filter((d) => d.op === "fill" && d.arcs.length > 0).map((d) => d.arcs)).toEqual([[{ x: 20, y: 20, r: 3.5 }]]);
        expect(texts.map((text) => text.x)).toEqual([20 - PIN_LEAD_PX + 6 + 7 + 4]);
    });
});

describe("what stands in while a new narrowing is read (#1398)", () => {
    const T = Schematic.Types;
    const at = (key: string, x: number) => drawnItem({ kind: "racks", key }, {
        ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y: 2 }), label: key,
    }, undefined)!;
    const a = at("A", 2), b = at("B", 12);
    const uplink = drawnLink({ kind: "fibre", key: "u1" }, {
        ...defaultValue<typeof T.Link>(T.Link), from: { kind: "racks", key: "A" }, to: { kind: "racks", key: "B" },
        route: variant("direct", null), style: variant("solid", { tone: none, weight: none }), label: some("uplink"),
    });
    /** The palette's ink (`fg`), and its third (`fgMuted`). */
    const INK = "rgb(3,3,3)", MUTED = "rgb(5,5,5)";

    /** What a frame paints at 20 px a unit, the racks as labelled pins, kept or not: each text in its style, and each stroke. */
    function paint(stale: boolean) {
        const { ctx, drawn, texts } = recorder();
        paintSchematic({
            ctx, value: { items: [a, b], zones: [], links: [uplink], nets: [] }, cam: { ppu: 20, tx: 0, ty: 0 }, width: 300, height: 200,
            visibleItems: [a, b], tiers: new Map([[a.key, "label"], [b.key, "label"]]), selected: new Set(), selectedZones: new Set(),
            centers: new Map([[a.key, { x: 2, y: 2 }], [b.key, { x: 12, y: 2 }]]), palette: PALETTE, tints: new Map(), stale,
        });
        return { texts: texts.map((text) => [text.text, text.style]), strokes: drawn.filter((d) => d.op === "stroke").map((d) => [d.style, d.width]) };
    }

    it("draws its words — the caption's and each pin's — in the third ink, every line and edge as it was", () => {
        const itself = paint(false), kept = paint(true);
        expect(itself.texts).toEqual([["uplink", LINKS.caption], ["A", INK], ["B", INK]]);
        expect(kept.texts).toEqual([["uplink", MUTED], ["A", MUTED], ["B", MUTED]]);
        expect(kept.strokes).toEqual(itself.strokes);
    });
});

describe("what is selected draws last (#1393)", () => {
    const T = Schematic.Types;
    const at = (key: string, x: number) => drawnItem({ kind: "racks", key }, {
        ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y: 2 }), label: key,
    }, undefined)!;
    const a = at("A", 2), b = at("B", 2.5);

    /** The points the pins' dots draw at, in the order they draw. */
    function order(selected: ReadonlySet<string>): number[] {
        const { ctx, drawn } = recorder();
        paintSchematic({
            ctx, value: { items: [a, b], zones: [], links: [], nets: [] }, cam: { ppu: 10, tx: 0, ty: 0 }, width: 300, height: 200,
            visibleItems: [a, b], tiers: new Map([[a.key, "label"], [b.key, "label"]]), selected, selectedZones: new Set(),
            centers: new Map([[a.key, { x: 2, y: 2 }], [b.key, { x: 2.5, y: 2 }]]), palette: PALETTE, tints: new Map(),
        });
        return drawn.filter((d) => d.op === "fill" && d.arcs.length > 0).map((d) => d.arcs[0]!.x);
    }

    it("a selected item's marker draws over its neighbours': it takes its form whatever it covers", () => {
        expect(order(new Set())).toEqual([20, 25]);
        expect(order(new Set([a.key]))).toEqual([25, 20]);
    });
});

describe("the dots draw in batches (#1393)", () => {
    const T = Schematic.Types;
    /** A rack at a point, `ring` naming a status drawn as an open ring. */
    const at = (key: string, x: number, y: number, ring: boolean) => drawnItem({ kind: "racks", key }, {
        ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y }), label: key,
        ...(ring ? { status: some({ label: "Held", tone: variant("danger", null), ring: true }) } : {}),
    }, undefined)!;
    // A thousand racks a metre apart, 20px at the zoom: none overlap. The even ones red, the odd ones green.
    const racks = Array.from({ length: 1000 }, (_, i) => at(`R${i}`, i % 40, Math.floor(i / 40), i === 7));
    const RED: RGB = [200, 0, 0], GREEN: RGB = [0, 200, 0];
    const tints = new Map(racks.map((rack, i): [string, RGB] => [rack.key, i % 2 === 0 ? RED : GREEN]));
    const PAPER = "rgb(8,8,8)", INK = "rgb(3,3,3)", RED_CSS = "rgb(200,0,0)", GREEN_CSS = "rgb(0,200,0)";

    it("draws every dot not selected in a fill and a ring a look — its style, its width and its alpha — every ring over every fill, and the selected one last, on its own", () => {
        const { ctx, drawn } = recorder();
        paintSchematic({
            ctx, value: { items: racks, zones: [], links: [], nets: [] }, cam: { ppu: 20, tx: 10, ty: 10 }, width: 800, height: 500,
            visibleItems: racks, tiers: new Map(racks.map((r) => [r.key, "dot" as const])), selected: new Set([racks[500]!.key]), selectedZones: new Set(),
            centers: new Map(racks.map((r) => [r.key, { x: r.x, y: r.y }])), palette: PALETTE, tints,
            // R1 drawn as context, in its own colour: faded alone.
            effect: { excluded: new Set([racks[1]!.key]), excludedOpacity: 0.35, excludedDesaturate: false, matches: new Set(), emphasis: undefined, pulsePhase: 0, frame: undefined },
        });
        const dots = drawn.filter((d) => d.arcs.length > 0 && d.arcs.every((r) => r.r === 5));
        const fills = dots.filter((d) => d.op === "fill"), rings = dots.filter((d) => d.op === "stroke");
        expect(fills.map((d) => [d.style, d.alpha, d.arcs.length])).toEqual([
            [RED_CSS, 1, 499], [GREEN_CSS, 0.35, 1], [GREEN_CSS, 1, 498],
            // R7's status is an open ring: the paper inside it.
            [PAPER, 1, 1],
            // R500, selected, after them all.
            [RED_CSS, 1, 1],
        ]);
        expect(rings.map((d) => [d.style, d.width, d.alpha, d.arcs.length])).toEqual([
            [PAPER, 1.5, 1, 997], [PAPER, 1.5, 0.35, 1], [GREEN_CSS, 2, 1, 1],
            [PAPER, 1.5, 1, 1],
        ]);
        // Every ring of the batches over every fill of them; the selected dot's own, then its ring, after both.
        expect(drawn.indexOf(rings[0]!)).toBeGreaterThan(drawn.indexOf(fills[3]!));
        expect(drawn.indexOf(fills[4]!)).toBeGreaterThan(drawn.indexOf(rings[2]!));
        const selection = drawn.filter((d) => d.op === "stroke" && d.arcs.some((r) => r.r === 7.5));
        expect(selection.map((d) => [d.style, d.arcs])).toEqual([[INK, [{ x: (500 % 40) * 20 + 10, y: Math.floor(500 / 40) * 20 + 10, r: 7.5 }]]]);
        expect(drawn.indexOf(selection[0]!)).toBeGreaterThan(drawn.indexOf(rings[3]!));
        // Each dot of the batches drawn once, at its rack.
        const centres = [...fills.slice(0, 4), ...rings.slice(0, 3)].flatMap((d) => d.arcs.map((r) => `${r.x},${r.y}`));
        expect(new Set(centres).size).toBe(999);
        expect(centres.length).toBe(999 * 2);
    });
});

describe("a marker whose status is unread (#1398)", () => {
    const T = Schematic.Types;
    /** Its details, which give its status, read: the card roles they give. */
    const UNREAD = { status: true, meter: false, metric: false, sublabel: false };
    const at = (key: string, x: number, roles: Partial<ReturnType<typeof defaultValue<typeof T.Item>>> = {}) => drawnItem({ kind: "racks", key }, {
        ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y: 2 }), label: key, ...roles,
    }, undefined, UNREAD)!;
    /** The placeholders' fill (`bgSubtle`), and the paper (`bgSurface`). */
    const FILL = "rgb(21,21,21)", PAPER = "rgb(8,8,8)";

    /** The fills about a point, in screen px, as a frame paints the items at a tier, the placeholders shown or not. */
    function fillsAt(items: readonly DrawnItem[], tier: LodTier, placeholders: boolean, x: number, selected: ReadonlySet<string> = new Set()) {
        const { ctx, drawn } = recorder();
        paintSchematic({
            ctx, value: { items: [...items], zones: [], links: [], nets: [] }, cam: { ppu: 10, tx: 0, ty: 0 }, width: 300, height: 200,
            visibleItems: items, tiers: new Map(items.map((i) => [i.key, tier])), selected, selectedZones: new Set(),
            centers: new Map(items.map((i) => [i.key, { x: i.x, y: i.y }])), palette: PALETTE, tints: new Map(), placeholders,
        });
        return { fills: drawn.filter((d) => d.op === "fill" && d.arcs.some((r) => r.x === x && r.y === 20)).map((d) => d.style), drawn };
    }

    it("a dot draws nothing until the reveal says so, then the placeholders' fill — never a status", () => {
        const rack = at("A", 2);
        expect(fillsAt([rack], "dot", false, 20).fills).toEqual([]);
        expect(fillsAt([rack], "dot", true, 20).fills).toEqual([FILL]);
    });

    it("a pin draws its words and its pill at once, its dot the placeholders' fill once revealed", () => {
        const rack = at("A", 2);
        const unseen = fillsAt([rack], "label", false, 20);
        expect(unseen.fills).toEqual([]);
        expect(unseen.drawn.filter((d) => d.op === "fill").map((d) => d.style)).toEqual([PAPER]);
        expect(fillsAt([rack], "label", true, 20).fills).toEqual([FILL]);
    });

    it("an item with a colour of its own draws it, whatever its status: its colour is read", () => {
        const toned = at("A", 2, { tone: some(variant("danger", null)) });
        expect(fillsAt([toned], "dot", false, 20).fills).toEqual(["rgb(5,5,5)"]);
    });

    it("selected, its ring draws though its dot waits on the reveal", () => {
        const rack = at("A", 2);
        const { drawn } = fillsAt([rack], "dot", false, 20, new Set([rack.key]));
        expect(drawn.filter((d) => d.op === "stroke" && d.arcs.some((r) => r.x === 20 && r.r === 7.5)).length).toBe(1);
    });
});

describe("the density (#1393, ruled 23 Oct 2026)", () => {
    const rgb = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;
    const HEAT = [PALETTE.heat1, PALETTE.heat2, PALETTE.heat3, PALETTE.heat4, PALETTE.heat5].map(rgb);

    it("steps a cell by its share of the fullest, on halving steps: over half the fifth, a sixteenth or less the first", () => {
        expect([100, 51, 50, 26, 25, 13, 12, 7, 6, 1].map((n) => densityStep(n, 100))).toEqual([5, 5, 4, 4, 3, 3, 2, 2, 1, 1]);
        // A uniform block reads alike: cells a row or two apart.
        expect([98, 99, 100].map((n) => densityStep(n, 100))).toEqual([5, 5, 5]);
        // An empty cell, or a raster of none, draws nothing.
        expect([densityStep(0, 100), densityStep(3, 0)]).toEqual([0, 0]);
    });

    it("draws each cell in its heat step under the zones, and none off the screen", () => {
        const T = Schematic.Types;
        const hall = drawnZone({ kind: "areas", key: "hall" }, {
            ...defaultValue<typeof T.Zone>(T.Zone), x: 0, y: 0, width: 20, height: 10, label: "Hall", pattern: variant("outline", { tone: none }),
        });
        // Three 5 m cells along the hall, and one 100 m off, past the screen's 300 px.
        const density: SchematicDensity = {
            side: 5,
            cells: [{ minX: 0, minY: 0, count: 100 }, { minX: 5, minY: 0, count: 40 }, { minX: 10, minY: 0, count: 3 }, { minX: 100, minY: 0, count: 100 }],
            most: 100, box: { minX: 0, minY: 0, maxX: 105, maxY: 10 }, spread: false, unnarrowed: false,
        };
        const { ctx, drawn } = recorder();
        paintSchematic({
            ctx, value: { items: [], zones: [hall], links: [], nets: [] }, cam: { ppu: 10, tx: 0, ty: 0 }, width: 300, height: 200,
            visibleItems: [], tiers: new Map(), selected: new Set(), selectedZones: new Set(), centers: new Map(), palette: PALETTE, tints: new Map(),
            density: new Map([["racks", density]]),
        });
        // The fifth step, the fourth and the first; the cell off the screen not drawn.
        const cells = drawn.filter((d) => d.op === "fill" && HEAT.includes(d.style));
        expect(cells.map((d) => d.style)).toEqual([HEAT[4], HEAT[3], HEAT[0]]);
        // The hall's dashed edge over them.
        expect(drawn.findIndex((d) => d.op === "stroke" && d.dash[0] === 5)).toBeGreaterThan(drawn.indexOf(cells.at(-1)!));
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

/** A text as a context drew it: its words, where, and its style. */
interface Text {
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly style: string;
}

/** A Canvas2D context that records each stroke and fill, and each text: what the paint layer drew, without pixels. */
function recorder(): { ctx: CanvasRenderingContext2D; drawn: Drawn[]; texts: Text[] } {
    const drawn: Drawn[] = [];
    const texts: Text[] = [];
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
        lineJoin: "miter", lineCap: "butt", font: "", textAlign: "start", textBaseline: "alphabetic", lineDashOffset: 0,
        save() { saved.push({ ...state, dash: [...state.dash] }); },
        restore() { state = saved.pop() ?? state; },
        setLineDash(dash: number[]) { state.dash = [...dash]; },
        setTransform() {}, clearRect() {}, clip() {}, closePath() {},
        beginPath() { arcs = []; },
        moveTo() {}, lineTo() {}, arcTo() {}, quadraticCurveTo() {}, rect() {}, roundRect() {},
        arc(x: number, y: number, r: number) { arcs.push({ x, y, r }); },
        stroke() { record("stroke"); },
        fill() { record("fill"); },
        strokeRect() { record("stroke"); },
        fillRect() { record("fill"); },
        fillText(text: string, x: number, y: number) { texts.push({ text, x, y, style: state.fillStyle }); },
        measureText(text: string) { return { width: text.length * 6 }; },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn, texts };
}

/** The links' look, each part a colour of its own (#1403). */
const LINKS: SchematicPalette["links"] = {
    casing: "link-paper", ink: "link-ink", strong: "link-strong", ring: "link-ring", ringWidth: 1, knockout: "link-knockout", outline: "link-outline",
    caption: "link-caption", captionFont: "500 10px mono", preview: "link-preview", previewWidth: 3, was: "link-was", wasWidth: 1.5,
};

/** A palette whose every role is its own colour: the brand's line `rgb(10,20,30)`, its wash `rgb(40,50,60)`; the links' look each part's own. */
const PALETTE: SchematicPalette = (() => {
    const roles = ["brandMark", "brandSolid", "brandTint", "fg", "fgStrong", "fgMuted", "fgSubtle", "fgFaint", "bgSurface", "bgCanvas",
        "borderSubtle", "borderStrong", "statusPos", "statusNeg", "statusWarn", "statusInfo", "heat1", "heat2", "heat3", "heat4", "heat5", "bgSubtle"] as const;
    const palette = Object.fromEntries(roles.map((role, i): [string, RGB] => [role, [i, i, i]])) as unknown as SchematicPalette;
    return { ...palette, brandSolid: [10, 20, 30], brandTint: [40, 50, 60], labelFont: "10px mono", eyebrowFont: "9px mono", links: LINKS };
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

    it("with no drag resting, nothing of the brand's is drawn: the run is the links' ink (#1403)", () => {
        expect(paint().filter((d) => d.style === BRAND_WASH || d.style === BRAND)).toEqual([]);
        expect(paint().filter((d) => d.style === LINKS.ink && d.op === "stroke").map((d) => d.width)).toEqual([2.5]);
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
        // The zone's dashed edge: the run draws in the links' ink.
        expect(marks.filter((d) => d.style === BRAND && d.op === "stroke").map((d) => [d.width, d.dash])).toEqual([[2, [6, 4]]]);
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
        // The runs: u1 as itself, u2 faded in the links' muted ink — their lines, 2.5 wide.
        expect(drawn.filter((d) => d.op === "stroke" && d.width === 2.5 && d.arcs.length === 0).map((d) => [d.style, d.alpha])).toEqual([
            [GREEN_CSS, 1], [LINKS.ink, 0.35],
            // The feed's legs, its weight: A's as itself, C's faded with C.
            [GREEN_CSS, 1], [LINKS.ink, 0.35],
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

// ============================================================================
// The links' look (#1403)
// ============================================================================

describe("the links' routes: each end on an item's edge where it draws at the zoom (#1403)", () => {
    const T = Schematic.Types;
    const at = (key: string, x: number, y: number) => drawnItem({ kind: "racks", key }, {
        ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y }), label: key,
    }, undefined)!;
    const run = (key: string, from: string, to: string, route: ReturnType<typeof defaultValue<typeof T.Link>>["route"] = variant("direct", null)) =>
        drawnLink({ kind: "fibre", key }, {
            ...defaultValue<typeof T.Link>(T.Link), from: { kind: "racks", key: from }, to: { kind: "racks", key: to },
            route, style: variant("solid", { tone: none, weight: none }),
        });
    /** What the routes are worked out over: the items as `tier`, the camera at `ppu` from the corner, each pin's label 6px a letter. */
    const envOf = (items: readonly DrawnItem[], tier: LodTier, ppu: number, cardSizes?: ReadonlyMap<string, { w: number; h: number }>) => routeEnv({
        cam: { ppu, tx: 0, ty: 0 }, centers: new Map(items.map((i) => [i.key, { x: i.x, y: i.y }])), items: new Map(items.map((i) => [i.key, i])),
        tiers: new Map(items.map((i) => [i.key, tier])), cardSizes, lanes: new Map(), measure: (text) => text.length * 6,
    });
    const a = at("A", 2, 2), b = at("B", 8, 2);

    it("between two dots it leaves the one's rim and meets the other's, its head's tip there, its line to the head's base", () => {
        const drawn = linkRoutes(run("u1", "A", "B"), envOf([a, b], "dot", 10))!;
        expect(drawn.handles).toEqual({ from: { x: 25, y: 20 }, to: { x: 75, y: 20 } });
        expect(drawn.runs.map((r) => [r.line, r.head])).toEqual([[[{ x: 25, y: 20 }, { x: 67, y: 20 }], { tip: { x: 75, y: 20 }, base: { x: 67, y: 20 }, half: 4 }]]);
    });

    it("between two labelled pins it leaves the one's edge and meets the other's: a pin 6 + 7 + 4 + its label + 6 wide, its dot on its rack", () => {
        // "A" is 6px: each pin 29 wide, from 9.5 before its rack's point — its dot's centre there — to 19.5 after it.
        expect(linkRoutes(run("u1", "A", "B"), envOf([a, b], "label", 10))!.handles).toEqual({ from: { x: 39.5, y: 20 }, to: { x: 70.5, y: 20 } });
    });

    it("between two cards it leaves the one's side and meets the other's — as the page lays the cards out, else as the declutter reckons them", () => {
        const measured = new Map([[a.key, { w: 100, h: 40 }], [b.key, { w: 60, h: 40 }]]);
        expect(linkRoutes(run("u1", "A", "B"), envOf([a, b], "card", 40, measured))!.handles).toEqual({ from: { x: 130, y: 80 }, to: { x: 290, y: 80 } });
        // Unmeasured, a card is 88 wide at least.
        expect(linkRoutes(run("u1", "A", "B"), envOf([a, b], "card", 40))!.handles).toEqual({ from: { x: 124, y: 80 }, to: { x: 276, y: 80 } });
    });

    it("an orthogonal run turns at its elbow and meets its destination's edge along its last leg: from above, the head pointing down", () => {
        const low = at("B", 8, 6);
        const drawn = linkRoutes(run("u1", "A", "B", variant("orthogonal", { corner: none })), envOf([a, low], "dot", 10))!;
        expect(drawn.runs[0]!.route).toEqual([{ x: 25, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 55 }]);
        expect(drawn.runs[0]!.head).toEqual({ tip: { x: 80, y: 55 }, base: { x: 80, y: 47 }, half: 4 });
        expect(drawn.runs[0]!.corner).toBe(8);
    });

    it("a feed's head sits on each of its destination legs, at its rack's rim, and its trunk and its bar carry none", () => {
        const p = at("P", 8, 12), c = at("C", 14, 2);
        const feed = drawnNet({ kind: "feeds", key: "f" }, {
            ...defaultValue<typeof T.Net>(T.Net), sources: [{ kind: "racks", key: "P" }], destinations: [{ kind: "racks", key: "A" }, { kind: "racks", key: "C" }],
            route: variant("direct", null), style: variant("solid", { tone: none, weight: none }),
        });
        const drawn = netRoutes(feed, envOf([a, c, p], "dot", 10))!;
        // The trunk leaves P's rim up to the bar under the racks; each leg runs from the bar up to its rack, arriving there.
        expect(drawn.runs.map((r) => [r.route, r.head?.tip, r.leg?.item])).toEqual([
            [[{ x: 80, y: 115 }, { x: 80, y: 50 }], undefined, undefined],
            [[{ x: 20, y: 50 }, { x: 140, y: 50 }], undefined, undefined],
            [[{ x: 20, y: 50 }, { x: 20, y: 25 }], { x: 20, y: 25 }, a.key],
            [[{ x: 140, y: 50 }, { x: 140, y: 25 }], { x: 140, y: 25 }, c.key],
        ]);
        // The trunk's tap on the bar is its junction: a dot.
        expect(drawn.dots).toEqual([{ x: 80, y: 50, r: 4 }]);
        expect(drawn.handles).toBeUndefined();
    });
});

describe("the links' look (#1403)", () => {
    const T = Schematic.Types;
    const at = (key: string, x: number, y: number) => drawnItem({ kind: "racks", key }, {
        ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y }), label: key,
    }, undefined)!;
    const a = at("A", 2, 2), b = at("B", 8, 2), c = at("C", 14, 2);
    const run = (key: string, from: string, to: string, over: Partial<ReturnType<typeof defaultValue<typeof T.Link>>> = {}) =>
        drawnLink({ kind: "fibre", key }, {
            ...defaultValue<typeof T.Link>(T.Link), from: { kind: "racks", key: from }, to: { kind: "racks", key: to },
            route: variant("direct", null), style: variant("solid", { tone: none, weight: none }), ...over,
        });
    const u1 = run("u1", "A", "B", { label: some("uplink"), metric: some("100G") }), u2 = run("u2", "B", "C");
    const DRAWN: SchematicDrawn = { items: [a, b, c], zones: [], links: [u1, u2], nets: [] };

    /** What a frame paints at `ppu` px a unit, the items as dots, with what `over` gives. */
    function paint(over: Partial<PaintInput> = {}, ppu = 10) {
        const { ctx, drawn, texts } = recorder();
        paintSchematic({
            ctx, value: DRAWN, cam: { ppu, tx: 0, ty: 0 }, width: 300, height: 200,
            visibleItems: DRAWN.items, tiers: new Map(DRAWN.items.map((i) => [i.key, "dot" as const])), selected: new Set(), selectedZones: new Set(),
            centers: new Map(DRAWN.items.map((i) => [i.key, { x: i.x, y: i.y }])), palette: PALETTE, tints: new Map(), ...over,
        });
        return { drawn, texts };
    }
    const BRAND = "rgb(10,20,30)";
    const strokes = (drawn: readonly Drawn[]) => drawn.filter((d) => d.op === "stroke").map((d) => [d.style, d.width]);

    it("every run is cased in the paper under every run's ink, in the links' muted ink, with no brand of its own", () => {
        const { drawn } = paint();
        // u1's casing and its head's, u2's, then u1's ink and u2's.
        expect(strokes(drawn).filter(([style]) => String(style).startsWith("link-"))).toEqual([
            [LINKS.casing, 4.5], [LINKS.casing, 2], [LINKS.casing, 4.5], [LINKS.casing, 2], [LINKS.ink, 2.5], [LINKS.ink, 2.5],
        ]);
        expect(drawn.some((d) => d.style === BRAND)).toBe(false);
    });

    it("a tone recolours its run's ink and its head", () => {
        const { drawn } = paint({ tints: new Map([[u1.key, [200, 100, 0] as RGB]]) });
        expect(drawn.filter((d) => d.style === "rgb(200,100,0)").map((d) => d.op)).toEqual(["stroke", "fill"]);
    });

    it("the lit run is drawn last, in the strong ink, the dots it joins ringed 1px four outside their rims", () => {
        const { drawn } = paint({ lit: u1.key });
        const inks = strokes(drawn).filter(([style]) => style === LINKS.ink || style === LINKS.strong || style === LINKS.ring);
        expect(inks).toEqual([[LINKS.ink, 2.5], [LINKS.strong, 2.5], [LINKS.ring, 1], [LINKS.ring, 1]]);
        expect(drawn.filter((d) => d.style === LINKS.ring).map((d) => d.arcs)).toEqual([[{ x: 20, y: 20, r: 9.5 }], [{ x: 80, y: 20, r: 9.5 }]]);
    });

    it("a selected run is in the strong ink, its ends ringed and its caption outlined; while it writes, its handles stand at its ends' edges", () => {
        const { drawn } = paint({ selectedLink: { key: u1.key, editable: true } }, 20);
        expect(strokes(drawn).filter(([style]) => style === LINKS.strong).length).toBe(1);
        expect(drawn.filter((d) => d.style === LINKS.outline).map((d) => d.op)).toEqual(["stroke"]);
        // Its handles: on the dots' rims, where its line leaves A and meets B.
        expect(drawn.filter((d) => d.style === BRAND && d.op === "stroke").map((d) => d.arcs)).toEqual([[{ x: 45, y: 40, r: 5 }], [{ x: 155, y: 40, r: 5 }]]);
    });

    it("a caption — its label and its metric — sits on its knockout at its route's middle, from the label zoom", () => {
        expect(paint({}, 10).texts).toEqual([]);
        const { drawn, texts } = paint({}, 20);
        // u1 runs from A's rim (45, 40) to B's (155, 40): its middle at x 100, the text's baseline 3 below.
        expect(texts).toEqual([{ text: "uplink · 100G", x: 100, y: 43, style: LINKS.caption }]);
        expect(drawn.filter((d) => d.style === LINKS.knockout).map((d) => d.op)).toEqual(["fill"]);
    });

    it("Connect's draft is the brand's preview from the source's edge to the pointer, with a head — snapped, to the target's edge; refused, the danger ink", () => {
        const loose = paint({ draftLink: { from: { x: 2, y: 2 }, to: { x: 5, y: 2 }, fromKey: a.key, snapped: false } }).drawn;
        expect(loose.filter((d) => d.style === LINKS.preview).map((d) => [d.op, d.width])).toEqual([["stroke", 3], ["fill", 3]]);
        const refused = paint({ draftLink: { from: { x: 2, y: 2 }, to: { x: 8, y: 2 }, fromKey: a.key, snapped: false, forbiddenKey: b.key } }).drawn;
        expect(refused.some((d) => d.style === LINKS.preview)).toBe(false);
        // The danger ink: the palette's `statusNeg`, the line and its head.
        expect(refused.filter((d) => d.style === "rgb(13,13,13)").map((d) => d.op)).toEqual(["stroke", "fill"]);
    });

    it("the run a retarget moves draws as its `was` line while its end is dragged — never lit, nor selected", () => {
        const { drawn } = paint({ was: u1.key, lit: u1.key, selectedLink: { key: u1.key, editable: true } });
        expect(strokes(drawn).filter(([style]) => style === LINKS.was)).toEqual([[LINKS.was, 1.5]]);
        expect(drawn.some((d) => d.style === LINKS.strong || d.style === LINKS.ring)).toBe(false);
    });
});
