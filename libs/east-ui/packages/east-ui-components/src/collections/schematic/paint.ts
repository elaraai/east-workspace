/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure Canvas2D paint layer for the Schematic. Given a 2D context, the East
 * value, a camera, the (already culled / LOD-decided) visible set, and a
 * theme-resolved colour palette, it draws the **bulk shapes** — zones (rect
 * outline / hatch + circle / polyline / polygon geometry, arcs included), links,
 * item footprints, and the dot / pin LOD markers. Rich item *cards* stay DOM
 * (the React layer draws
 * those at close zoom); this module never touches React, Chakra, or the DOM, so
 * it is unit-testable under any Canvas2D implementation (browser or node-skia).
 *
 * @packageDocumentation
 */

import { type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";

type SchematicValue = ValueTypeOf<typeof Schematic.Types.Schematic>;
type SchematicItemValue = ValueTypeOf<typeof Schematic.Types.Item>;
type Pt = { x: number; y: number };
/** A screen-space shape vertex carrying its DXF bulge (0 = straight to next). */
type Vert = { x: number; y: number; bulge: number };

/** Per-item LOD tier (mirrors the React layer). */
export type LodTier = "card" | "label" | "dot";

/** An `[r, g, b]` triple in 0–255. */
export type RGB = [number, number, number];

/**
 * Theme-resolved colours the paint layer needs. The React layer resolves these
 * from Chakra semantic tokens (CSS custom properties) once per theme; the paint
 * layer is colour-system-agnostic and just consumes RGB.
 */
export interface SchematicPalette {
    /** Brand teal (links, `info` status). */
    brand600: RGB;
    brand500: RGB;
    /** Foreground ink (`ink` tone). */
    fg: RGB;
    fgMuted: RGB;
    fgSubtle: RGB;
    /** Zone `muted` stroke. */
    borderStrong: RGB;
    borderSubtle: RGB;
    /** Card / pin background, and the eyebrow-label halo. */
    bgSurface: RGB;
    bgPanel: RGB;
    /** Status tones. */
    statusOk: RGB;
    statusWarn: RGB;
    statusBad: RGB;
    /** Dot ring. */
    white: RGB;
}

/** The pan/zoom transform in CSS pixels: `screen = world × ppu + t`. */
export interface PaintCamera {
    ppu: number;
    tx: number;
    ty: number;
}

/** Everything {@link paintSchematic} needs for one frame. */
export interface PaintInput {
    ctx: CanvasRenderingContext2D;
    value: SchematicValue;
    cam: PaintCamera;
    /** Canvas size in CSS px (the ctx is pre-scaled by devicePixelRatio). */
    width: number;
    height: number;
    /** Viewport-culled items (the React layer's `visibleItems`). */
    visibleItems: readonly SchematicItemValue[];
    /** Per-item LOD tier after declutter. */
    tiers: ReadonlyMap<string, LodTier>;
    selected: string | null;
    /** Item key → world centre, for link endpoints. */
    centers: ReadonlyMap<string, Pt>;
    palette: SchematicPalette;
}

const css = (c: RGB, a = 1): string =>
    a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Zone / link tone → palette colour. `muted` differs by surface (zones use the
 * heavier border, links the muted foreground), matching the slot recipe. */
function toneRGB(p: SchematicPalette, tone: string, kind: "zone" | "link"): RGB {
    switch (tone) {
        case "brand": return p.brand600;
        case "ink": return p.fg;
        case "muted": return kind === "zone" ? p.borderStrong : p.fgMuted;
        case "success": return p.statusOk;
        case "warning": return p.statusWarn;
        case "danger": return p.statusBad;
        default: return p.fgMuted;
    }
}

/** Item status tone → dot / footprint colour. */
function statusRGB(p: SchematicPalette, status: string | undefined): RGB {
    switch (status) {
        case "success": return p.statusOk;
        case "warning": return p.statusWarn;
        case "danger": return p.statusBad;
        case "info": return p.brand500;
        default: return p.fgMuted;
    }
}

function statusTone(status: SchematicItemValue["status"]): string | undefined {
    return status.type === "some" ? status.value.type : undefined;
}

/**
 * Resolve an entity's stroke / tint colour to a CSS string, applying the
 * override precedence: a raw `color` string wins, then a semantic `tone`
 * (mapped through the theme palette), then the status / pattern fallback RGB.
 */
function resolveTint(p: SchematicPalette, color: string | undefined, tone: string | undefined, fallback: RGB): string {
    if (color !== undefined) return color;
    if (tone !== undefined) return css(toneRGB(p, tone, "link"));
    return css(fallback);
}

/** Expand anchors into an axis-aligned point list (one elbow per diagonal). */
function orthogonalize(points: Pt[]): Pt[] {
    const out: Pt[] = [];
    for (const next of points) {
        const prev = out[out.length - 1];
        if (prev !== undefined && prev.x !== next.x && prev.y !== next.y) {
            out.push(Math.abs(next.y - prev.y) >= Math.abs(next.x - prev.x)
                ? { x: prev.x, y: next.y }
                : { x: next.x, y: prev.y });
        }
        if (prev === undefined || prev.x !== next.x || prev.y !== next.y) out.push(next);
    }
    return out;
}

/** Trace `pts` into `ctx`, rounding corners by up to `radius` (rounded pipe look). */
function traceRounded(ctx: CanvasRenderingContext2D, pts: Pt[], radius: number): void {
    if (pts.length === 0) return;
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i]!, a = pts[i - 1]!, b = pts[i + 1]!;
        const inLen = Math.hypot(p.x - a.x, p.y - a.y);
        const outLen = Math.hypot(b.x - p.x, b.y - p.y);
        const r = Math.min(radius, inLen / 2, outLen / 2);
        if (r < 0.5) { ctx.lineTo(p.x, p.y); continue; }
        const inU = { x: (p.x - a.x) / inLen, y: (p.y - a.y) / inLen };
        ctx.lineTo(p.x - inU.x * r, p.y - inU.y * r);
        ctx.quadraticCurveTo(p.x, p.y, p.x + (b.x - p.x) / outLen * r, p.y + (b.y - p.y) / outLen * r);
    }
    const last = pts[pts.length - 1]!;
    if (pts.length > 1) ctx.lineTo(last.x, last.y);
}

/** Centre / radius / sweep of a DXF bulge arc, ready for `CanvasRenderingContext2D.arc`. */
export interface BulgeArc {
    cx: number;
    cy: number;
    radius: number;
    startAngle: number;
    endAngle: number;
    anticlockwise: boolean;
}

/**
 * Pure geometry of the circular arc a DXF `bulge` encodes for the edge
 * `p1`→`p2` (`bulge = tan(includedAngle / 4)`; sign = turn direction). Returns
 * `null` for a straight or degenerate edge (`|bulge|` ~ 0, or a zero-length
 * chord). Screen space: the caller has already transformed the vertices, and
 * the uniform camera scale preserves the bulge (it is the tangent of an angle).
 * Exported so the arc maths is unit-testable without a Canvas2D context.
 */
export function arcFromBulge(p1: Pt, p2: Pt, bulge: number): BulgeArc | null {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const chord = Math.hypot(dx, dy);
    if (Math.abs(bulge) < 1e-4 || chord < 1e-9) return null;
    const theta = 4 * Math.atan(bulge);            // signed swept angle
    const radius = Math.abs(chord / (2 * Math.sin(theta / 2)));
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const d = (chord / 2) / Math.tan(theta / 2);   // signed midpoint→centre distance
    const cx = mx - (dy / chord) * d, cy = my + (dx / chord) * d;
    return {
        cx, cy, radius,
        startAngle: Math.atan2(p1.y - cy, p1.x - cx),
        endAngle: Math.atan2(p2.y - cy, p2.x - cx),
        anticlockwise: theta < 0,
    };
}

/**
 * Append the edge `p1`→`p2` to the current path: a straight `lineTo` when the
 * edge is straight, else the circular arc its DXF bulge encodes (see
 * {@link arcFromBulge}).
 */
function traceBulge(ctx: CanvasRenderingContext2D, p1: Pt, p2: Pt, bulge: number): void {
    const arc = arcFromBulge(p1, p2, bulge);
    if (arc === null) { ctx.lineTo(p2.x, p2.y); return; }
    ctx.arc(arc.cx, arc.cy, arc.radius, arc.startAngle, arc.endAngle, arc.anticlockwise);
}

/**
 * Trace an arc-aware vertex list (screen space, each `{x,y,bulge}`) into the
 * current path. When `closed`, the last vertex's bulge curves the edge back to
 * the first and the subpath is closed (polygon); otherwise it is left open
 * (polyline). The caller sets stroke / fill and calls `beginPath` first.
 */
function traceVertices(ctx: CanvasRenderingContext2D, pts: Vert[], closed: boolean): void {
    if (pts.length === 0) return;
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) traceBulge(ctx, pts[i - 1]!, pts[i]!, pts[i - 1]!.bulge);
    if (closed) {
        const last = pts[pts.length - 1]!;
        traceBulge(ctx, last, pts[0]!, last.bulge);
        ctx.closePath();
    }
}

/** Draw the schematic's bulk-shape layer for one frame. Clears first. */
export function paintSchematic(input: PaintInput): void {
    const { ctx, value, cam, width, height, visibleItems, tiers, selected, centers, palette: p } = input;
    const wx = (x: number) => x * cam.ppu + cam.tx;
    const wy = (y: number) => y * cam.ppu + cam.ty;
    const ppu = cam.ppu;

    ctx.clearRect(0, 0, width, height);
    ctx.lineJoin = "round";

    // ---- zones: rect outline / hatch + polyline / polygon geometry ----------
    for (const zone of value.zones) {
        const pattern = zone.pattern;
        const patternTone = (pattern.value.tone.type === "some" ? pattern.value.tone.value.type : undefined) ?? "muted";
        const tint = resolveTint(p, getSomeorUndefined(zone.color), getSomeorUndefined(zone.tone)?.type, toneRGB(p, patternTone, "zone"));
        const zbg = getSomeorUndefined(zone.bg);
        const zFillAlpha = getSomeorUndefined(zone.fillOpacity) ?? 0.15;
        const zWeight = getSomeorUndefined(zone.weight);
        const geom = getSomeorUndefined(zone.geometry);
        const x = wx(zone.x), y = wy(zone.y), w = zone.width * ppu, h = zone.height * ppu;
        const fillShape = () => {
            if (zbg === undefined) return;
            ctx.save();
            ctx.globalAlpha = zFillAlpha;
            ctx.fillStyle = zbg;
            ctx.fill();
            ctx.restore();
        };

        if (geom !== undefined && geom.type !== "rect") {
            if (geom.type === "circle") {
                ctx.beginPath();
                ctx.arc(x + w / 2, y + h / 2, geom.value.radius * ppu, 0, Math.PI * 2);
                fillShape();
                ctx.setLineDash([4, 3]);
                ctx.lineWidth = zWeight ?? 1;
                ctx.strokeStyle = tint;
                ctx.stroke();
                ctx.setLineDash([]);
            } else {
                const pts = geom.value.vertices.map(q => ({ x: wx(q.x), y: wy(q.y), bulge: q.bulge }));
                if (pts.length > 0) {
                    ctx.beginPath();
                    if (geom.type === "polygon") {
                        traceVertices(ctx, pts, true);
                        fillShape();
                        ctx.setLineDash([4, 3]);
                        ctx.lineWidth = zWeight ?? 1;
                        ctx.strokeStyle = tint;
                        ctx.stroke();
                        ctx.setLineDash([]);
                    } else {
                        traceVertices(ctx, pts, false);
                        const band = geom.value.width.type === "some" ? geom.value.width.value * ppu : undefined;
                        ctx.setLineDash([]);
                        ctx.lineCap = "round";
                        ctx.lineWidth = zWeight ?? band ?? 1.5;
                        ctx.save();
                        ctx.globalAlpha = 0.55;
                        ctx.strokeStyle = tint;
                        ctx.stroke();
                        ctx.restore();
                        ctx.lineCap = "butt";
                    }
                }
            }
        } else if (pattern.type === "hatch") {
            const spacing = pattern.value.spacing.type === "some" ? pattern.value.spacing.value : 8;
            const angle = (pattern.value.angle.type === "some" ? pattern.value.angle.value : 45) * Math.PI / 180;
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            ctx.clip();
            if (zbg !== undefined) {
                ctx.save();
                ctx.globalAlpha = zFillAlpha;
                ctx.fillStyle = zbg;
                ctx.fillRect(x, y, w, h);
                ctx.restore();
            }
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = tint;
            ctx.lineWidth = zWeight ?? 1;
            const dx = Math.cos(angle), dy = Math.sin(angle);
            const diag = Math.hypot(w, h);
            ctx.beginPath();
            for (let o = -diag; o < diag; o += spacing) {
                ctx.moveTo(x + o, y - diag * dy);
                ctx.lineTo(x + o + dx * 2 * diag, y - diag * dy + dy * 2 * diag);
            }
            ctx.stroke();
            ctx.restore();
        } else {
            if (zbg !== undefined) {
                ctx.save();
                ctx.globalAlpha = zFillAlpha;
                ctx.fillStyle = zbg;
                ctx.fillRect(x, y, w, h);
                ctx.restore();
            }
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = zWeight ?? 1;
            ctx.strokeStyle = tint;
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
        }

        // eyebrow label at the bbox top-left (the nav / minimap anchor)
        if (w >= zone.label.length * 6.2 + 24) {
            ctx.font = '600 9px ui-monospace, "SF Mono", Menlo, monospace';
            const label = zone.label.toUpperCase();
            const tw = ctx.measureText(label).width;
            ctx.fillStyle = css(p.bgPanel);
            ctx.fillRect(x + 6, y - 7, tw + 6, 12);
            ctx.fillStyle = css(p.fgMuted);
            ctx.textBaseline = "middle";
            ctx.fillText(label, x + 9, y);
        }
    }

    // ---- links --------------------------------------------------------------
    for (const link of value.links) {
        const from = centers.get(link.from), to = centers.get(link.to);
        if (!from || !to) continue;
        const anchors = [from, ...link.via, to].map(q => ({ x: wx(q.x), y: wy(q.y) }));
        const corner = link.route.type === "orthogonal"
            ? (link.route.value.corner.type === "some" ? link.route.value.corner.value : 8) : 0;
        const pts = link.route.type === "orthogonal" ? orthogonalize(anchors) : anchors;
        const style = link.style;
        const tone = (style.value.tone.type === "some" ? style.value.tone.value.type : undefined)
            ?? (style.type === "solid" ? "brand" : "muted");
        const weight = style.value.weight.type === "some" ? style.value.weight.value
            : (style.type === "solid" ? 2.5 : 1.5);
        const color = toneRGB(p, tone, "link");
        ctx.lineCap = "round";
        ctx.strokeStyle = css(color);
        ctx.lineWidth = weight;
        ctx.setLineDash(style.type === "dashed" ? [6, 5] : []);
        ctx.beginPath();
        traceRounded(ctx, pts, corner);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = css(color);
        for (const end of [anchors[0]!, anchors[anchors.length - 1]!]) {
            ctx.beginPath();
            ctx.arc(end.x, end.y, weight + 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.lineCap = "butt";
    }

    // ---- item footprints (close zoom only — semantic zoom) ------------------
    for (const item of visibleItems) {
        const footprint = getSomeorUndefined(item.footprint);
        if (footprint === undefined || footprint.type === "rect") continue;
        if ((tiers.get(item.key) ?? "dot") !== "card") continue;
        const isSel = selected === item.key;
        const tint = resolveTint(p, getSomeorUndefined(item.color), getSomeorUndefined(item.tone)?.type, statusRGB(p, statusTone(item.status)));
        const ibg = getSomeorUndefined(item.bg);
        const fillAlpha = getSomeorUndefined(item.fillOpacity) ?? (isSel ? 0.24 : 0.12);
        const stroke = getSomeorUndefined(item.weight) ?? (isSel ? 2.5 : 1.5);
        const fillShape = () => {
            ctx.save();
            ctx.globalAlpha = fillAlpha;
            ctx.fillStyle = ibg ?? tint;
            ctx.fill();
            ctx.restore();
        };

        if (footprint.type === "circle") {
            ctx.beginPath();
            ctx.arc(wx(item.x), wy(item.y), footprint.value.radius * ppu, 0, Math.PI * 2);
            fillShape();
            ctx.lineWidth = stroke;
            ctx.strokeStyle = tint;
            ctx.stroke();
            continue;
        }

        const pts = footprint.value.vertices.map(q => ({ x: wx(q.x), y: wy(q.y), bulge: q.bulge }));
        if (pts.length === 0) continue;
        ctx.beginPath();
        if (footprint.type === "polygon") {
            traceVertices(ctx, pts, true);
            fillShape();
            ctx.lineWidth = stroke;
        } else {
            traceVertices(ctx, pts, false);
            const band = footprint.value.width.type === "some" ? footprint.value.width.value * ppu : undefined;
            ctx.lineCap = "round";
            ctx.lineWidth = getSomeorUndefined(item.weight) ?? band ?? (isSel ? 2.5 : 1.5);
        }
        ctx.strokeStyle = tint;
        ctx.stroke();
        ctx.lineCap = "butt";
    }

    // ---- item LOD markers: dots + labelled pins (cards are DOM) --------------
    for (const item of visibleItems) {
        const tier = tiers.get(item.key) ?? "dot";
        if (tier === "card") continue; // rich card rendered by the React layer
        const tint = resolveTint(p, getSomeorUndefined(item.color), getSomeorUndefined(item.tone)?.type, statusRGB(p, statusTone(item.status)));
        const isSel = selected === item.key;
        const x = wx(item.x), y = wy(item.y);

        if (tier === "dot") {
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = tint;
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = css(p.white);
            ctx.stroke();
            if (isSel) {
                ctx.beginPath();
                ctx.arc(x, y, 7.5, 0, Math.PI * 2);
                ctx.lineWidth = 2;
                ctx.strokeStyle = css(p.fg);
                ctx.stroke();
            }
            continue;
        }

        // labelled pin
        ctx.font = '600 10px ui-monospace, "SF Mono", Menlo, monospace';
        const tw = ctx.measureText(item.label).width;
        const padX = 6, dotW = 7, gap = 4, h = 16;
        const w = padX + dotW + gap + tw + padX;
        const left = x - w / 2, top = y - h / 2;
        ctx.beginPath();
        ctx.roundRect?.(left, top, w, h, h / 2);
        if (!ctx.roundRect) ctx.rect(left, top, w, h);
        ctx.fillStyle = css(p.bgSurface);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = isSel ? css(p.fg) : css(p.borderStrong);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(left + padX + dotW / 2, y, dotW / 2, 0, Math.PI * 2);
        ctx.fillStyle = tint;
        ctx.fill();
        ctx.fillStyle = css(p.fg);
        ctx.textBaseline = "middle";
        ctx.fillText(item.label, left + padX + dotW + gap, y);
    }
}
