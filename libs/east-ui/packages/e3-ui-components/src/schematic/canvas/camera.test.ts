/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure-maths tests for the Schematic camera ({@link ./camera}): the
 * interaction-mode machine (a user gesture supersedes a fly), the rAF
 * coalescer (many requests → one frame), the shared world→screen projector
 * (card transform and canvas footprint resolve to the same screen point —
 * issue #57 P1), the viewport-cull geometry (a cross-viewport link / a shape
 * bowing outside its rect must NOT be culled — P6/1e), `zoomAbout`, a pinch's
 * step (`pinchAbout`: the drawing kept under the fingers), and when a moving
 * camera tells its reader where its view stands (#1398, CL6).
 */

import { describe, it, expect } from "vitest";
import {
    FIT_MARGIN_PX, FLY_DURATION_MS, IDENTITY, SLOW_READ_MS,
    bboxOverlaps, cancelsFly, cardTranslateCss, fitView, flyStep, makeRafCoalescer, nextMode,
    pinchAbout, pointsBbox, project, tellsAsItMoves, viewportWorldBbox, zoomAbout,
} from "./camera";

describe("nextMode / cancelsFly (interaction-mode machine)", () => {
    it("every event that leaves `flying` cancels the fly so mode and the rAF can't disagree", () => {
        expect(nextMode("flying", "pointerDown")).toBe("panning");
        expect(nextMode("flying", "wheel")).toBe("wheeling");
        expect(nextMode("flying", "zoom")).toBe("wheeling");
        expect(cancelsFly("flying", "pointerDown")).toBe(true);
        expect(cancelsFly("flying", "wheel")).toBe(true);
        expect(cancelsFly("flying", "zoom")).toBe(true);
        // an explicit cancel/reset (pointercancel, lost-capture, fit, minimap)
        // must cancel the fly too — else the mode goes idle while the rAF runs
        expect(nextMode("flying", "cancel")).toBe("idle");
        expect(cancelsFly("flying", "cancel")).toBe(true);
    });

    it("does not cancel a fly when no fly is running, and never on flyEnd", () => {
        expect(cancelsFly("idle", "pointerDown")).toBe(false);
        expect(cancelsFly("panning", "wheel")).toBe(false);
        expect(cancelsFly("idle", "cancel")).toBe(false);
        expect(cancelsFly("flying", "flyEnd")).toBe(false); // the rAF already ended
    });

    it("returns to idle on the matching release / completion", () => {
        expect(nextMode("idle", "flyStart")).toBe("flying");
        expect(nextMode("panning", "pointerUp")).toBe("idle");
        expect(nextMode("flying", "flyEnd")).toBe("idle");
        expect(nextMode("wheeling", "cancel")).toBe("idle");
        // a pointerUp while not panning is a no-op
        expect(nextMode("flying", "pointerUp")).toBe("flying");
    });
});

describe("makeRafCoalescer", () => {
    it("coalesces many requests in a frame into one schedule, then re-arms after the frame", () => {
        const scheduled: Array<() => void> = [];
        let handle = 0;
        const coalescer = makeRafCoalescer(cb => { scheduled.push(cb); return ++handle; }, () => {});

        let runs = 0;
        const run = () => { runs++; };
        coalescer.request(run);
        coalescer.request(run);
        coalescer.request(run);
        expect(scheduled.length).toBe(1);   // three requests, one frame

        scheduled[0]!();                     // the frame fires
        expect(runs).toBe(1);

        coalescer.request(run);              // a request after the frame re-arms
        expect(scheduled.length).toBe(2);
    });

    it("cancel clears a pending frame", () => {
        let cancelled = 0;
        const coalescer = makeRafCoalescer(() => 7, () => { cancelled++; });
        coalescer.request(() => {});
        coalescer.cancel();
        expect(cancelled).toBe(1);
    });
});

describe("project (shared world→screen projector)", () => {
    it("the card transform and the canvas footprint resolve to the same screen point", () => {
        const cam = { ppu: 12.5, tx: 30, ty: -7 };
        const x = 4, y = 9;
        // The painter projects the footprint anchor through `project`.
        expect(project(x, y, cam).sx).toBeCloseTo(x * cam.ppu + cam.tx);
        expect(project(x, y, cam).sy).toBeCloseTo(y * cam.ppu + cam.ty);
        // The DOM card translates via cardTranslateCss, which embeds the SAME
        // arithmetic against the `--cam-*` vars.
        expect(cardTranslateCss(x, y)).toBe(
            `translate(calc(var(--cam-ppu) * ${x} * 1px + var(--cam-tx)), calc(var(--cam-ppu) * ${y} * 1px + var(--cam-ty)))`,
        );
        // Resolving that calc with this camera's --cam-ppu / --cam-tx yields the
        // exact footprint anchor — card and footprint cannot desync (P1).
        const resolvedX = cam.ppu * x + cam.tx;   // var(--cam-ppu) * x + var(--cam-tx)
        const resolvedY = cam.ppu * y + cam.ty;
        expect(resolvedX).toBeCloseTo(project(x, y, cam).sx);
        expect(resolvedY).toBeCloseTo(project(x, y, cam).sy);
    });
});

describe("viewport culling (bboxOverlaps / pointsBbox)", () => {
    const view = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

    it("does NOT cull a link whose endpoints are off-screen but whose segment crosses the viewport", () => {
        const from = { x: 5, y: -10 }, to = { x: 5, y: 20 };
        // Each endpoint alone misses the viewport — a point test would cull it.
        expect(bboxOverlaps(view, { minX: from.x, minY: from.y, maxX: from.x, maxY: from.y })).toBe(false);
        expect(bboxOverlaps(view, { minX: to.x, minY: to.y, maxX: to.x, maxY: to.y })).toBe(false);
        // The AABB over all anchors overlaps the viewport — so it is kept.
        const linkBbox = pointsBbox([from, to])!;
        expect(bboxOverlaps(view, linkBbox)).toBe(true);
    });

    it("does NOT cull a non-rect zone whose geometry bows outside its declared rect", () => {
        const declared = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
        const viewFar = { minX: 8, minY: 8, maxX: 12, maxY: 12 };
        // The declared rect alone misses — culling by it would be wrong.
        expect(bboxOverlaps(viewFar, declared)).toBe(false);
        // Union the declared rect with the actual geometry's vertex bounds.
        const vertexOutside = { x: 9, y: 9 };
        const union = pointsBbox([
            { x: declared.minX, y: declared.minY }, { x: declared.maxX, y: declared.maxY }, vertexOutside,
        ])!;
        expect(bboxOverlaps(viewFar, union)).toBe(true);
    });

    it("pointsBbox is null for an empty list", () => {
        expect(pointsBbox([])).toBeNull();
    });
});

describe("viewportWorldBbox", () => {
    it("inverse-projects the canvas corners to world space", () => {
        const bb = viewportWorldBbox({ ppu: 2, tx: 10, ty: 20 }, 100, 60);
        expect(bb.minX).toBeCloseTo(-5);
        expect(bb.minY).toBeCloseTo(-10);
        expect(bb.maxX).toBeCloseTo(45);
        expect(bb.maxY).toBeCloseTo(20);
    });
});

describe("zoomAbout", () => {
    it("keeps the focal screen point fixed", () => {
        const next = zoomAbout(IDENTITY, 2, 100, 50, 1, 40);
        expect(next.zoom).toBe(2);
        // The same screen point maps to the same world point before and after.
        expect((100 - next.tx) / next.zoom).toBeCloseTo(100);
        expect((50 - next.ty) / next.zoom).toBeCloseTo(50);
    });

    it("snaps to IDENTITY at minimum zoom and clamps at maximum", () => {
        expect(zoomAbout({ zoom: 2, tx: 50, ty: 50 }, 0.1, 0, 0, 1, 40)).toEqual(IDENTITY);
        expect(zoomAbout({ zoom: 40, tx: 0, ty: 0 }, 2, 0, 0, 1, 40).zoom).toBe(40);
    });

    it("snaps to the camera Fit takes at minimum zoom, so a full zoom-out recentres (#1393)", () => {
        const home = { zoom: 1, tx: 24, ty: 71 };
        expect(zoomAbout({ zoom: 3, tx: -400, ty: -90 }, 0.2, 10, 10, 1, 40, home)).toBe(home);
    });
});

describe("pinchAbout (a pinch's step)", () => {
    /** The point of the drawing a camera shows at a screen point, in px at zoom 1. */
    const under = (cam: { zoom: number; tx: number; ty: number }, p: { x: number; y: number }) => ({ x: (p.x - cam.tx) / cam.zoom, y: (p.y - cam.ty) / cam.zoom });
    const mid = (p: { x: number; y: number }, q: { x: number; y: number }) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

    it("keeps each finger on the point of the drawing it touched: the fingers drawn apart, carried, and both at once", () => {
        const cam = { zoom: 2, tx: -40, ty: 25 };
        // Two fingers, and where each goes: apart to twice their distance while their midpoint moves 30 right and 12 down.
        const a = { x: 100, y: 200 }, b = { x: 200, y: 200 };
        const a2 = { x: 80, y: 212 }, b2 = { x: 280, y: 212 };
        const next = pinchAbout(cam, 2, mid(a, b), mid(a2, b2), 1, 40);
        expect([next.camera.zoom, next.over]).toEqual([4, 1]);
        for (const [was, now] of [[a, a2], [b, b2]] as const) {
            expect(under(next.camera, now).x).toBeCloseTo(under(cam, was).x, 9);
            expect(under(next.camera, now).y).toBeCloseTo(under(cam, was).y, 9);
        }
    });

    it("two fingers carried together, their distance kept, pan: the zoom as it was, the drawing moved as they moved", () => {
        const cam = { zoom: 3, tx: 10, ty: -5 };
        expect(pinchAbout(cam, 1, { x: 150, y: 90 }, { x: 110, y: 140 }, 1, 40)).toEqual({ camera: { zoom: 3, tx: -30, ty: 45 }, over: 1 });
        // At the least zoom too, where Fit's camera stands: a pinch never jumps to it.
        expect(pinchAbout({ zoom: 1, tx: 24, ty: 71 }, 1, { x: 150, y: 90 }, { x: 110, y: 140 }, 1, 40)).toEqual({ camera: { zoom: 1, tx: -16, ty: 121 }, over: 1 });
    });

    it("the steps of a pinch compose: by one finger's moves then the other's, or both at once, the camera ends the same", () => {
        const cam = { zoom: 1.5, tx: 12, ty: 34 };
        // One finger moves, then the other: two steps, each of what the pair did in it.
        const first = pinchAbout(cam, 150 / 100, { x: 150, y: 200 }, { x: 175, y: 200 }, 1, 40);
        const both = pinchAbout(first.camera, 240 / 150, { x: 175, y: 200 }, { x: 130, y: 200 }, 1, 40, first.over).camera;
        // The same fingers, from where they began to where they end, in one step.
        const once = pinchAbout(cam, 240 / 100, { x: 150, y: 200 }, { x: 130, y: 200 }, 1, 40).camera;
        expect(both.zoom).toBeCloseTo(once.zoom, 12);
        expect(both.tx).toBeCloseTo(once.tx, 9);
        expect(both.ty).toBeCloseTo(once.ty, 9);
    });

    it("at either limit the zoom holds, what the fingers ask past it is kept, and the drawing is carried by the midpoint's move alone", () => {
        // Pinched in at the least zoom: no closer to Fit than Fit, and no jump to its camera.
        expect(pinchAbout({ zoom: 1, tx: 30, ty: 40 }, 0.5, { x: 100, y: 100 }, { x: 108, y: 97 }, 1, 40)).toEqual({ camera: { zoom: 1, tx: 38, ty: 37 }, over: 0.5 });
        // Drawn apart at the limit.
        expect(pinchAbout({ zoom: 40, tx: -900, ty: 40 }, 3, { x: 100, y: 100 }, { x: 108, y: 97 }, 1, 40)).toEqual({ camera: { zoom: 40, tx: -892, ty: 37 }, over: 3 });
        // Reaching the least zoom part way through a step: the zoom stops there, about where the midpoint stood.
        const reached = pinchAbout({ zoom: 1.2, tx: 0, ty: 0 }, 0.5, { x: 60, y: 60 }, { x: 60, y: 60 }, 1, 40);
        expect(reached.camera.zoom).toBe(1);
        expect(reached.camera.tx).toBeCloseTo(60 - (1 / 1.2) * 60, 9);
        expect(reached.over).toBeCloseTo(0.6, 12);
    });

    it("a limit is no ratchet: two fingers carried together at the least zoom, one move at a time, pan and zoom by nothing", () => {
        // Two fingers 100 right and 40 down of one another, each carried 70 right and 25 up: the first's move draws them
        // closer, the second's puts their distance back. Dropped at the limit, the first would leave the second to zoom in.
        const a = { x: 200, y: 300 }, b = { x: 300, y: 340 };
        const a2 = { x: 270, y: 275 }, b2 = { x: 370, y: 315 };
        const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
        const home = { zoom: 1, tx: 24, ty: 71 };
        const first = pinchAbout(home, dist(a2, b) / dist(a, b), mid(a, b), mid(a2, b), 1, 40);
        expect([first.camera.zoom, first.over < 1]).toEqual([1, true]);
        const second = pinchAbout(first.camera, dist(a2, b2) / dist(a2, b), mid(a2, b), mid(a2, b2), 1, 40, first.over);
        expect(second.camera.zoom).toBe(1);
        expect(second.over).toBeCloseTo(1, 12);
        expect(second.camera.tx).toBeCloseTo(home.tx + 70, 9);
        expect(second.camera.ty).toBeCloseTo(home.ty - 25, 9);
        // And past the limit and back: drawn together to a quarter, then apart to where they began — the drawing as it was.
        const in4 = pinchAbout({ zoom: 1.5, tx: 0, ty: 0 }, 0.25, { x: 50, y: 50 }, { x: 50, y: 50 }, 1, 40);
        const out4 = pinchAbout(in4.camera, 4, { x: 50, y: 50 }, { x: 50, y: 50 }, 1, 40, in4.over);
        expect(out4.camera.zoom).toBeCloseTo(1.5, 12);
        expect(out4.over).toBeCloseTo(1, 12);
    });
});

describe("fitView (#1393)", () => {
    it("fits the drawing inside the canvas less its margin, and centres it on both axes", () => {
        // A floor 382 × 254 in a canvas 980 × 568: the height binds.
        const { fit, home } = fitView(980, 568, 382, 254);
        expect(fit).toBeCloseTo((568 - 2 * FIT_MARGIN_PX) / 254);
        expect(home.zoom).toBe(1);
        // Centred: as much room left of the floor as right of it, and above as below.
        expect(home.tx).toBeCloseTo(980 - (home.tx + 382 * fit));
        expect(home.ty).toBeCloseTo(FIT_MARGIN_PX);
        // On a phone's canvas the width binds, and the floor sits in the middle of the height.
        const phone = fitView(386, 553, 382, 254);
        expect(phone.fit).toBeCloseTo((386 - 2 * FIT_MARGIN_PX) / 382);
        expect(phone.home.ty).toBeCloseTo((553 - 254 * phone.fit) / 2);
    });

    it("a canvas too small for the margin keeps an eighth of itself each side; nothing to fit fits nothing", () => {
        expect(fitView(80, 80, 10, 10).fit).toBeCloseTo((80 - 2 * 10) / 10);
        expect(fitView(0, 300, 10, 10)).toEqual({ fit: 0, home: IDENTITY });
    });
});

describe("tellsAsItMoves (#1398, CL6)", () => {
    // Where the canvas last told its reader the view stood: 50, 30 in world units, at 20 px a unit, a 40-unit view.
    const told = { at: 1000, x: 50, y: 30, ppu: 20 };
    /** A wheel's notch, as the canvas zooms by it: e^(0.0015 × 100). */
    const notch = Math.exp(0.15);

    it("a slow pan tells it as it goes: less than the view's span since the last tell, 200 ms on", () => {
        expect(tellsAsItMoves(told, { at: told.at + SLOW_READ_MS, x: 60, y: 30, ppu: 20, span: 40 })).toBe(true);
    });

    it("tells it nothing before 200 ms have passed, nor at a time stamped before the last tell", () => {
        expect(tellsAsItMoves(told, { at: told.at + SLOW_READ_MS - 1, x: 50, y: 30, ppu: 20, span: 40 })).toBe(false);
        expect(tellsAsItMoves(told, { at: told.at - 600, x: 50, y: 30, ppu: 20, span: 40 })).toBe(false);
    });

    it("a fast pan waits for its rest: a span or more since the last tell", () => {
        expect(tellsAsItMoves(told, { at: told.at + 300, x: 90, y: 30, ppu: 20, span: 40 })).toBe(false);
    });

    it("a fast zoom about a point waits for its rest, out or in, though its centre stays put: three notches in 204 ms", () => {
        const three = notch ** 3;
        expect(tellsAsItMoves(told, { at: told.at + 204, x: 50, y: 30, ppu: 20 / three, span: 40 * three })).toBe(false);
        expect(tellsAsItMoves(told, { at: told.at + 204, x: 50, y: 30, ppu: 20 * three, span: 40 / three })).toBe(false);
    });

    it("a slow zoom tells it as it goes: one notch in 255 ms, out or in", () => {
        expect(tellsAsItMoves(told, { at: told.at + 255, x: 50, y: 30, ppu: 20 / notch, span: 40 * notch })).toBe(true);
        expect(tellsAsItMoves(told, { at: told.at + 255, x: 50, y: 30, ppu: 20 * notch, span: 40 / notch })).toBe(true);
    });
});

describe("flyStep (#1393)", () => {
    const from = { zoom: 1, tx: 24, ty: 71 }, to = { zoom: 4, tx: -300, ty: -120 };

    it("stands where it began at its start, and at a time stamped before it — never thrown back past it", () => {
        expect(flyStep(from, to, 0)).toEqual(from);
        // A frame stamped 363 ms before the fly began, as jsdom's frame clock stands behind its `performance`.
        expect(flyStep(from, to, -363)).toEqual(from);
    });

    it("eases out towards where it lands — past halfway at half its time — and lands there, never past it", () => {
        const half = flyStep(from, to, FLY_DURATION_MS / 2);
        expect(half.zoom).toBeGreaterThan((from.zoom + to.zoom) / 2);
        expect(half.zoom).toBeLessThan(to.zoom);
        expect(flyStep(from, to, FLY_DURATION_MS)).toEqual(to);
        expect(flyStep(from, to, 10 * FLY_DURATION_MS)).toEqual(to);
    });
});
