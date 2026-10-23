/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The minimap (#1393, `minimap.ts`): its size — a desktop's 150px at the
 * drawing's aspect, a phone's a quarter of the canvas's width, a tall
 * drawing's a third of its height — and what it paints, in order: each zone's
 * floor, each kind read by area's whole drawing's density in its heat steps at
 * the minimap's scale, each item's dot, and each zone's outline over them.
 */

import { describe, expect, test } from "vitest";
import type { SchematicDensity } from "../area.js";
import { MINIMAP_MAX_PX, minimapSize, paintMinimap } from "./minimap";
import type { RGB, SchematicPalette } from "./paint";

describe("minimapSize", () => {
    test("on a desktop's canvas, 150px wide at the drawing's aspect", () => {
        expect(minimapSize({ w: 1000, h: 600 }, { width: 382, height: 254 })).toEqual({ w: MINIMAP_MAX_PX, h: (MINIMAP_MAX_PX * 254) / 382 });
    });

    test("on a phone's, a quarter of the canvas's width: never half its floor", () => {
        expect(minimapSize({ w: 294, h: 400 }, { width: 382, height: 254 })).toEqual({ w: 73.5, h: (73.5 * 254) / 382 });
    });

    test("a drawing far taller than it is wide, a third of the canvas's height", () => {
        expect(minimapSize({ w: 1000, h: 300 }, { width: 100, height: 400 })).toEqual({ w: 25, h: 100 });
    });
});

/** A context that records each rectangle it fills and strokes, in its colour. */
function recording() {
    const ops: { op: "fill" | "stroke"; style: string; x: number; y: number; w: number; h: number }[] = [];
    let fillStyle = "", strokeStyle = "";
    const ctx = {
        canvas: { width: 400, height: 200 },
        get fillStyle() { return fillStyle; }, set fillStyle(v: string) { fillStyle = v; },
        get strokeStyle() { return strokeStyle; }, set strokeStyle(v: string) { strokeStyle = v; },
        lineWidth: 1,
        save() {}, restore() {}, setTransform() {}, clearRect() {},
        fillRect(x: number, y: number, w: number, h: number) { ops.push({ op: "fill", style: fillStyle, x, y, w, h }); },
        strokeRect(x: number, y: number, w: number, h: number) { ops.push({ op: "stroke", style: strokeStyle, x, y, w, h }); },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

/** A palette whose every role is a grey of its own: the canvas's paper `rgb(9,9,9)`, the muted ink `rgb(5,5,5)`, the subtle rule `rgb(10,10,10)`, the heat steps `rgb(16,16,16)`–`rgb(20,20,20)`. */
const PALETTE: SchematicPalette = (() => {
    const roles = ["brandMark", "brandSolid", "brandTint", "fg", "fgStrong", "fgMuted", "fgSubtle", "fgFaint", "bgSurface", "bgCanvas",
        "borderSubtle", "borderStrong", "statusPos", "statusNeg", "statusWarn", "statusInfo", "heat1", "heat2", "heat3", "heat4", "heat5"] as const;
    const palette = Object.fromEntries(roles.map((role, i): [string, RGB] => [role, [i, i, i]]));
    return { ...palette, labelFont: "10px mono", eyebrowFont: "9px mono", links: {} as SchematicPalette["links"] } as unknown as SchematicPalette;
})();

describe("paintMinimap", () => {
    /** A drawing 100 × 50 units on a minimap 200 × 100px: two px a unit. */
    const EXTENT = { width: 100, height: 50 };
    /** 10-unit cells: one full — the fifth step — and one an eighth as full — the second. */
    const DENSITY: SchematicDensity = {
        side: 10, cells: [{ minX: 0, minY: 0, count: 8 }, { minX: 10, minY: 0, count: 1 }], most: 8,
        box: { minX: 0, minY: 0, maxX: 100, maxY: 50 }, spread: true, unnarrowed: false,
    };

    test("each zone's floor, each density's cells in their heat steps, each item's dot, and each zone's outline over them, at the minimap's scale", () => {
        const { ctx, ops } = recording();
        paintMinimap({
            ctx, width: 200, height: 100, extent: EXTENT, zones: [{ x: 10, y: 10, width: 30, height: 20 }], densities: [DENSITY], items: [{ x: 50, y: 25 }],
            palette: PALETTE,
        });
        expect(ops).toEqual([
            { op: "fill", style: "rgb(9,9,9)", x: 20, y: 20, w: 60, h: 40 },
            { op: "fill", style: "rgb(20,20,20)", x: 0, y: 0, w: 20, h: 20 },
            { op: "fill", style: "rgb(17,17,17)", x: 20, y: 0, w: 20, h: 20 },
            { op: "fill", style: "rgb(5,5,5)", x: 99, y: 49, w: 2, h: 2 },
            { op: "stroke", style: "rgb(10,10,10)", x: 20.5, y: 20.5, w: 59, h: 39 },
        ]);
    });

    test("with nothing read by area and no item, only the zones", () => {
        const { ctx, ops } = recording();
        paintMinimap({ ctx, width: 200, height: 100, extent: EXTENT, zones: [{ x: 0, y: 0, width: 100, height: 50 }], densities: [], items: [], palette: PALETTE });
        expect(ops.map((op) => op.op)).toEqual(["fill", "stroke"]);
    });
});
