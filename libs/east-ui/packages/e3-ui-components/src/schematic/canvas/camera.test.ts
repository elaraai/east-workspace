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
 * bowing outside its rect must NOT be culled — P6/1e), and `zoomAbout`.
 */

import { describe, it, expect } from "vitest";
import {
    IDENTITY,
    bboxOverlaps, cancelsFly, cardTranslateCss, makeRafCoalescer, nextMode,
    pointsBbox, project, viewportWorldBbox, zoomAbout,
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
});
