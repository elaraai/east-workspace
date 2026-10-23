/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The minimap (#1393): the whole drawing in the canvas's corner, a press on
 * it a jump there. It shows the drawing, never only what the view is near:
 * each zone's floor and outline, each kind read by area as its whole
 * drawing's density — the area index's counts over the extent, read once a
 * revision (`../area.ts`' `overview`), in the theme's five heat steps as the
 * canvas's density draws — and each item of a kind read whole as a dot. The
 * viewport's box over it is the canvas's DOM, which moves with the camera;
 * this module only sizes the minimap and paints it, pure.
 *
 * @packageDocumentation
 */

import type { SchematicDensity } from "../area.js";
import { densityStep, type RGB, type SchematicPalette } from "./paint";

/** The minimap's widest, in CSS px: a desktop's canvas. */
export const MINIMAP_MAX_PX = 150;

/** The most of the canvas's width the minimap takes: on a phone, a corner, never half the floor. */
const MINIMAP_WIDTH_SHARE = 1 / 4;

/** The most of the canvas's height it takes: a drawing far taller than it is wide stays in its corner. */
const MINIMAP_HEIGHT_SHARE = 1 / 3;

/** An item's dot on the minimap, in CSS px a side. */
const MINIMAP_DOT_PX = 2;

/**
 * The minimap's size (#1393): the drawing's extent at its own aspect,
 * {@link MINIMAP_MAX_PX} wide at most, and no more than a quarter of the
 * canvas's width or a third of its height.
 *
 * @param canvas - The canvas's size, in CSS px
 * @param extent - The drawing's extent, in world units
 * @returns The minimap's size, in CSS px
 */
export function minimapSize(canvas: { readonly w: number; readonly h: number }, extent: { readonly width: number; readonly height: number }): { w: number; h: number } {
    const aspect = extent.width > 0 ? extent.height / extent.width : 1;
    let w = Math.min(MINIMAP_MAX_PX, canvas.w * MINIMAP_WIDTH_SHARE);
    let h = w * aspect;
    const most = canvas.h * MINIMAP_HEIGHT_SHARE;
    if (h > most) {
        h = most;
        w = aspect > 0 ? h / aspect : w;
    }
    return { w, h };
}

/** A zone as the minimap draws it: its box, in world units. */
export interface MinimapZone {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** Everything {@link paintMinimap} needs. */
export interface MinimapPaintInput {
    readonly ctx: CanvasRenderingContext2D;
    /** The minimap's size, in CSS px; the context is scaled by the device's pixel ratio already. */
    readonly width: number;
    readonly height: number;
    /** The drawing's extent, in world units: what the minimap shows, edge to edge. */
    readonly extent: { readonly width: number; readonly height: number };
    /** The zones drawn: each its floor, under everything, and its outline, over the density. */
    readonly zones: readonly MinimapZone[];
    /** Each kind read by area's density over the whole drawing. */
    readonly densities: readonly SchematicDensity[];
    /** Each item of a kind read whole, by its centre, in world units. */
    readonly items: readonly { readonly x: number; readonly y: number }[];
    readonly palette: SchematicPalette;
}

const css = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;

/**
 * Paints the minimap (#1393): clears it, then each zone's floor in the
 * canvas's paper, each density's cells in their heat steps (`densityStep`),
 * each item's dot in the muted ink, and each zone's outline in the subtle
 * rule over them.
 *
 * @param input - The minimap's context and size, the extent and what it draws
 */
export function paintMinimap(input: MinimapPaintInput): void {
    const { ctx, width, height, extent, zones, densities, items, palette: p } = input;
    const sx = extent.width > 0 ? width / extent.width : 0;
    const sy = extent.height > 0 ? height / extent.height : 0;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    ctx.fillStyle = css(p.bgCanvas);
    for (const zone of zones) ctx.fillRect(zone.x * sx, zone.y * sy, zone.width * sx, zone.height * sy);
    const steps = [p.heat1, p.heat2, p.heat3, p.heat4, p.heat5].map(css);
    for (const density of densities) {
        const w = density.side * sx, h = density.side * sy;
        for (const cell of density.cells) {
            const step = densityStep(cell.count, density.most);
            if (step === 0) continue;
            ctx.fillStyle = steps[step - 1]!;
            ctx.fillRect(cell.minX * sx, cell.minY * sy, w, h);
        }
    }
    ctx.fillStyle = css(p.fgMuted);
    for (const item of items) ctx.fillRect(item.x * sx - MINIMAP_DOT_PX / 2, item.y * sy - MINIMAP_DOT_PX / 2, MINIMAP_DOT_PX, MINIMAP_DOT_PX);
    ctx.strokeStyle = css(p.borderSubtle);
    ctx.lineWidth = 1;
    for (const zone of zones) ctx.strokeRect(zone.x * sx + 0.5, zone.y * sy + 0.5, Math.max(0, zone.width * sx - 1), Math.max(0, zone.height * sy - 1));
}
