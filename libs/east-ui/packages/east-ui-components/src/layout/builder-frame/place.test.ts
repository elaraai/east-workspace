/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Where `auto` places a builder frame's panes (#1125 F2): a pure function of
 * the frame's width, the panes' widths and states, and `minMain`, over the
 * deciding cases — room for both panes, for the start pane only, for neither,
 * and 560px and narrower — at the widths where each case begins and ends.
 * And how wide each pane is open: an overlay pane never so wide that less
 * than `MIN_SCRIM` of main shows beside it; a pinned pane its own width.
 */

import { describe, test, expect } from "vitest";
import { MIN_MAIN, MIN_SCRIM, NARROW_FRAME, paneWidths, placePanes, type PaneWeight } from "./place.js";

/** An `auto` pane, open, with the design system's 44px rail. */
const pane = (open: number, weight: Partial<PaneWeight> = {}): PaneWeight => ({ mode: "auto", open, rail: 44, collapsed: false, ...weight });

/** Studio's panes: the palette 264px wide, the inspector 300px. */
const palette = pane(264);
const inspector = pane(300);

describe("placePanes — where auto puts a frame's panes (#1125 F2)", () => {
    test("main keeps 480px beside pinned panes, by default", () => {
        expect([MIN_MAIN, NARROW_FRAME]).toEqual([480, 560]);
    });

    test("room for both panes: main keeps its 480px beside both, and both are pinned — down to 264 + 300 + 480", () => {
        expect(placePanes(1440, palette, inspector)).toEqual({ start: "pinned", end: "pinned" });
        expect(placePanes(1044, palette, inspector)).toEqual({ start: "pinned", end: "pinned" });
    });

    test("room for the start pane only: it is placed first, and pinned while main keeps 480px beside it and the end pane's rail; the end pane overlays", () => {
        expect(placePanes(1043, palette, inspector)).toEqual({ start: "pinned", end: "overlay" });
        expect(placePanes(788, palette, inspector)).toEqual({ start: "pinned", end: "overlay" });
    });

    test("room for neither: both overlay, each keeping its rail in the flow", () => {
        expect(placePanes(787, palette, inspector)).toEqual({ start: "overlay", end: "overlay" });
        expect(placePanes(600, palette, inspector)).toEqual({ start: "overlay", end: "overlay" });
    });

    test("560px and narrower: every auto pane overlays, whatever room main would keep", () => {
        const slim = pane(40);
        expect(placePanes(NARROW_FRAME, slim, slim, 100)).toEqual({ start: "overlay", end: "overlay" });
        expect(placePanes(390, slim, undefined, 100)).toEqual({ start: "overlay", end: undefined });
        // One px wider, the room decides again.
        expect(placePanes(NARROW_FRAME + 1, slim, slim, 100)).toEqual({ start: "pinned", end: "pinned" });
    });

    test("the panes' states: a collapsed start pane takes only its rail, so the end pane has the room; each pane is weighed open, whatever its own state", () => {
        expect(placePanes(900, palette, inspector)).toEqual({ start: "pinned", end: "overlay" });
        expect(placePanes(900, pane(264, { collapsed: true }), inspector)).toEqual({ start: "pinned", end: "pinned" });
        // Collapsed, the start pane still overlays where it would not fit open; it keeps only its rail beside main.
        expect(placePanes(700, pane(264, { collapsed: true }), inspector)).toEqual({ start: "overlay", end: "overlay" });
        // A collapsed end pane is weighed open too.
        expect(placePanes(900, palette, pane(300, { collapsed: true }))).toEqual({ start: "pinned", end: "overlay" });
    });

    test("minMain is the room main keeps", () => {
        expect(placePanes(900, palette, inspector, 300)).toEqual({ start: "pinned", end: "pinned" });
        expect(placePanes(900, palette, inspector, 600)).toEqual({ start: "overlay", end: "overlay" });
    });

    test("a pane its host sets pinned or overlay stays so; a pinned end pane takes its own width from the start pane's room", () => {
        expect(placePanes(390, pane(264, { mode: "pinned" }), pane(300, { mode: "overlay" }))).toEqual({ start: "pinned", end: "overlay" });
        expect(placePanes(2000, pane(264, { mode: "overlay" }), undefined)).toEqual({ start: "overlay", end: undefined });
        // The end pane pinned at 300: the start pane pins only where main keeps 480px beside both.
        expect(placePanes(1043, palette, pane(300, { mode: "pinned" }))).toEqual({ start: "overlay", end: "pinned" });
        expect(placePanes(1044, palette, pane(300, { mode: "pinned" }))).toEqual({ start: "pinned", end: "pinned" });
        // Collapsed, the pinned end pane takes its rail.
        expect(placePanes(788, palette, pane(300, { mode: "pinned", collapsed: true }))).toEqual({ start: "pinned", end: "pinned" });
    });

    test("a pane its content draws is pinned at its own width, which the other pane's room leaves out", () => {
        const own: PaneWeight = { mode: "pinned", open: 200, rail: 200, collapsed: false };
        expect(placePanes(1000, own, inspector)).toEqual({ start: "pinned", end: "pinned" });
        expect(placePanes(979, own, inspector)).toEqual({ start: "pinned", end: "overlay" });
    });

    test("one pane: pinned while main keeps its room beside it, and none at the other side", () => {
        expect(placePanes(744, palette, undefined)).toEqual({ start: "pinned", end: undefined });
        expect(placePanes(743, palette, undefined)).toEqual({ start: "overlay", end: undefined });
        expect(placePanes(780, undefined, inspector)).toEqual({ start: undefined, end: "pinned" });
        expect(placePanes(779, undefined, inspector)).toEqual({ start: undefined, end: "overlay" });
    });
});

describe("paneWidths — an overlay pane leaves a strip of main beside it (#1125)", () => {
    /** Each pane's width open, where the frame places it. */
    const widths = (width: number, start: PaneWeight | undefined, end: PaneWeight | undefined) =>
        paneWidths(width, start, end, placePanes(width, start, end));

    test("the strip is 48px", () => {
        expect(MIN_SCRIM).toBe(48);
    });

    test("on a 324px phone each of Studio's panes takes the frame less the other's 44px rail, less the 48px strip: 232px", () => {
        expect(placePanes(324, palette, inspector)).toEqual({ start: "overlay", end: "overlay" });
        expect(widths(324, palette, inspector)).toEqual({ start: 232, end: 232 });
    });

    test("the cap is an overlay's alone: a pinned pane keeps its width, however narrow the frame", () => {
        expect(widths(1440, palette, inspector)).toEqual({ start: 264, end: 300 });
        expect(widths(300, pane(400, { mode: "pinned" }), undefined)).toEqual({ start: 400, end: undefined });
        // The pinned start pane keeps its 264px beside an overlay; the overlay alone is held to the room left.
        expect(widths(390, pane(264, { mode: "pinned" }), pane(300, { mode: "overlay" }))).toEqual({ start: 264, end: 78 });
    });

    test("an overlay narrower than the cap keeps its width, and the cap is exact at the boundary", () => {
        // Alone: the frame less the strip.
        expect(widths(390, palette, undefined)).toEqual({ start: 264, end: undefined });
        expect(widths(312, palette, undefined)).toEqual({ start: 264, end: undefined });
        expect(widths(311, palette, undefined)).toEqual({ start: 263, end: undefined });
        // Beside the other pane's rail: the frame less the rail, less the strip.
        expect(widths(356, palette, inspector)).toEqual({ start: 264, end: 264 });
        expect(widths(355, palette, inspector)).toEqual({ start: 263, end: 263 });
        expect(widths(392, palette, inspector)).toEqual({ start: 264, end: 300 });
        expect(widths(391, palette, inspector)).toEqual({ start: 264, end: 299 });
    });

    test("what the other side keeps in the flow: a pinned pane's width open, or its rail while collapsed; a pane its content draws, its own width", () => {
        const wide = pane(900, { mode: "overlay" });
        expect(widths(1000, wide, pane(300, { mode: "pinned" }))).toEqual({ start: 652, end: 300 });
        expect(widths(1000, wide, pane(300, { mode: "pinned", collapsed: true }))).toEqual({ start: 900, end: 300 });
        const own: PaneWeight = { mode: "pinned", open: 200, rail: 200, collapsed: false };
        expect(widths(1000, wide, own)).toEqual({ start: 752, end: 200 });
    });

    test("never less than nothing: a frame too narrow for the strip leaves an overlay no width", () => {
        expect(widths(80, palette, inspector)).toEqual({ start: 0, end: 0 });
    });
});
