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
import { type Bbox, type ScreenCamera, bboxOverlaps, pointsBbox, project, viewportWorldBbox } from "./camera";

type SchematicValue = ValueTypeOf<typeof Schematic.Types.Schematic>;
type SchematicItemValue = ValueTypeOf<typeof Schematic.Types.Item>;
type SchematicZoneValue = ValueTypeOf<typeof Schematic.Types.Zone>;
type SchematicGeometryValue = ValueTypeOf<typeof Schematic.Types.Geometry>;
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

/**
 * Slice-effect paint parameters — how filtered-out items are de-emphasized and
 * the remainder emphasized. Absent from {@link PaintInput} ⇒ no effect (today's
 * behaviour). `hide`-mode excluded items are already dropped from `visibleItems`
 * upstream, so `excluded` here only ever holds *kept* (shown, de-emphasized)
 * item keys.
 */
export interface SchematicPaintEffect {
    /** Keys of kept-but-excluded items among `visibleItems` (dimmed / greyed). */
    excluded: ReadonlySet<string>;
    /** Fade alpha (0–1) applied to kept-excluded items; `1` ⇒ no fade. */
    excludedOpacity: number;
    /** Drain kept-excluded items' colour to grey. */
    excludedDesaturate: boolean;
    /** Positive emphasis on matched items; `undefined` ⇒ none. */
    emphasis: "halo" | "pulse" | undefined;
    /** Animated pulse phase in `[0, 1)`; only read when `emphasis === "pulse"`. */
    pulsePhase: number;
    /** World-coordinate bbox to frame the matched set; `undefined` ⇒ no frame. */
    frame: Bbox | undefined;
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
    /** The set of selected item keys (single/multiple/range all share it). */
    selected: ReadonlySet<string>;
    /** The set of selected ZONE keys (#177); absent/empty ⇒ no zone highlight. */
    selectedZones?: ReadonlySet<string>;
    /** Item key → world centre, for link endpoints. */
    centers: ReadonlyMap<string, Pt>;
    palette: SchematicPalette;
    /** Optional slice-effect paint parameters (ghost / emphasis / frame). */
    effect?: SchematicPaintEffect;
    /** Entity keys in a hidden layer — zones / links with a hidden-layer key are
     * skipped (items are already pre-filtered out of `visibleItems`). Empty ⇒ no
     * layer filtering. */
    layerHiddenKeys?: ReadonlySet<string>;
    /** Item key → layer opacity (0–1), for items in a dimmed layer. Multiplies
     * the item marker / footprint alpha. Absent / missing key ⇒ full. */
    layerAlpha?: ReadonlyMap<string, number>;
    /** Connect-tool draft edge (#176), world coords — routed like a real link. */
    draftLink?: { from: Pt; to: Pt; snapped: boolean };
    /** Open connect-session edges (#176, `connect` mode), world coords. */
    sessionLinks?: readonly { from: Pt; to: Pt }[];
    /** One-shot connect commit flash (#176); `phase` 0..1. Endpoints may be
     * undefined when an item vanished mid-flash — the painter skips then. */
    connectFlash?: { from: Pt | undefined; to: Pt | undefined; phase: number };
    /** The selected link (#176): halo stroke; `editable` also draws the
     * endpoint connector handles for re-targeting. */
    selectedLink?: { key: string; editable: boolean };
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
 * (mapped through the theme palette for the entity's `kind` — `muted`
 * resolves differently for zones vs links/items), then the status / pattern
 * fallback RGB.
 */
function resolveTint(p: SchematicPalette, color: string | undefined, tone: string | undefined, fallback: RGB, kind: "zone" | "link"): string {
    if (color !== undefined) return color;
    if (tone !== undefined) return css(toneRGB(p, tone, kind));
    return css(fallback);
}

/** Expand anchors into an axis-aligned point list (one elbow per diagonal).
 *  Exported so link hit-testing routes exactly like the painter (P11 spirit). */
export function orthogonalize(points: Pt[]): Pt[] {
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
    // A large-magnitude bulge drives `theta → ±2π`, so `sin(theta/2)` and
    // `tan(theta/2) → 0` and both `radius` and `d` diverge — treat the
    // resulting non-finite centre/radius as a straight edge (issue #57, P9).
    if (!Number.isFinite(radius) || !Number.isFinite(d) || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
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

/** Font the labelled-pin marker is drawn with; the pick must measure label
 * widths with the SAME font so its hitbox matches the drawn pill. */
export const MARKER_LABEL_FONT = '600 10px ui-monospace, "SF Mono", Menlo, monospace';
/** Drawn radius of a `dot`-tier marker, in screen px. */
export const MARKER_DOT_RADIUS = 5;
/** Hit radius of a `dot`-tier marker, in screen px — comfortably over the
 * drawn dot (5) and its selected ring (7.5) for touch slop (issue #57, P11). */
export const MARKER_DOT_HIT_RADIUS = 10;
const MARKER_PIN_PAD_X = 6, MARKER_PIN_DOT_W = 7, MARKER_PIN_GAP = 4, MARKER_PIN_H = 16;

/** The screen-space hitbox of a non-card LOD marker — a circle for a `dot`, the
 * rounded-pill rect for a `label`. */
export type MarkerHitbox =
    | { kind: "circle"; cx: number; cy: number; r: number }
    | { kind: "rect"; left: number; top: number; w: number; h: number };

/**
 * The screen-space hitbox of an item's LOD marker at `tier`. The single source
 * of truth used by **both** {@link paintSchematic} (to draw the pill) and the
 * React layer's pick (to hit-test), so the clickable area always equals the
 * drawn area and the two cannot silently drift (issue #57, P11). A `dot` is a
 * circle of {@link MARKER_DOT_HIT_RADIUS}; a `label` is the rounded pill whose
 * width is `pad + dot + gap + textWidth + pad` — the text measured by `measure`
 * (the caller sets the context font to {@link MARKER_LABEL_FONT} first).
 *
 * @param item - the item's world anchor and label
 * @param tier - the LOD tier (`dot` or `label`; `card` markers are DOM)
 * @param cam - the screen camera
 * @param measure - measures a string's width in px under the pin font
 * @returns the marker's screen-space hitbox
 */
export function markerHitbox(
    item: { x: number; y: number; label: string },
    tier: "dot" | "label",
    cam: ScreenCamera,
    measure: (text: string) => number,
): MarkerHitbox {
    const { sx, sy } = project(item.x, item.y, cam);
    if (tier === "dot") return { kind: "circle", cx: sx, cy: sy, r: MARKER_DOT_HIT_RADIUS };
    const tw = measure(item.label);
    const w = MARKER_PIN_PAD_X + MARKER_PIN_DOT_W + MARKER_PIN_GAP + tw + MARKER_PIN_PAD_X;
    return { kind: "rect", left: sx - w / 2, top: sy - MARKER_PIN_H / 2, w, h: MARKER_PIN_H };
}

/**
 * Whether the screen point `(sx, sy)` falls inside `box` (see
 * {@link markerHitbox}).
 *
 * @param box - a marker hitbox
 * @param sx - screen x
 * @param sy - screen y
 * @returns `true` when the point is inside the hitbox
 */
export function markerHit(box: MarkerHitbox, sx: number, sy: number): boolean {
    return box.kind === "circle"
        ? Math.hypot(sx - box.cx, sy - box.cy) <= box.r
        : sx >= box.left && sx <= box.left + box.w && sy >= box.top && sy <= box.top + box.h;
}

/** Screen-px hit slop around a link stroke (over its drawn weight). */
export const LINK_HIT_SLOP = 5;

/**
 * Segment-wise distance from a screen point to a polyline — the link
 * hit-test's core (routed points, so the clickable path equals the drawn
 * path, including fan lanes). Exported for unit testing.
 *
 * @param pts - the routed points, in order
 * @param sx - screen x
 * @param sy - screen y
 * @returns the minimum distance (Infinity for fewer than 2 points)
 */
export function distanceToPolyline(pts: readonly Pt[], sx: number, sy: number): number {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!, b = pts[i]!;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / len2)) : 0;
        const d = Math.hypot(sx - (a.x + t * dx), sy - (a.y + t * dy));
        if (d < best) best = d;
    }
    return best;
}

/** Links hide their mid-path label below this zoom (px per world unit) —
 *  aligned with the item labelled-pin band. */
export const LINK_LABEL_MIN_PPU = 16;
/** Screen-px gap between parallel link lanes (#180 fan-out). */
export const LINK_LANE_GAP = 7;

/**
 * The arc-length midpoint of a polyline (screen space) — where a link's label
 * pill anchors, so it sits centred along the routed path (not the chord).
 * Exported for unit testing.
 *
 * @param pts - the routed points, in order
 * @returns the midpoint (the sole point / origin for degenerate inputs)
 */
export function polylineMidpoint(pts: readonly Pt[]): Pt {
    if (pts.length === 0) return { x: 0, y: 0 };
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    if (total <= 1e-9) return pts[0]!;
    let acc = 0;
    const half = total / 2;
    for (let i = 1; i < pts.length; i++) {
        const seg = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
        if (acc + seg >= half) {
            const t = seg > 0 ? (half - acc) / seg : 0;
            return { x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * t, y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * t };
        }
        acc += seg;
    }
    return pts[pts.length - 1]!;
}

/**
 * Per-link parallel-fan lanes (#180): links sharing an endpoint pair (either
 * direction, no explicit waypoints, both endpoints resolved) would overdraw
 * into one edge — assign each a lane index so the painter can translate the
 * whole routed polyline rigidly along the pair's perpendicular. Deterministic
 * (lanes ordered by link key). Exported for unit testing.
 *
 * @param links - the links about to paint (pre-filtered upstream is fine)
 * @param eligible - whether a link participates (endpoints resolved, no `via`, not hidden)
 * @returns link key → `{ i, n }` lane position, only for groups of 2+
 */
export function parallelLanes<L extends { key: string; from: string; to: string }>(
    links: readonly L[],
    eligible: (link: L) => boolean,
): Map<string, { i: number; n: number }> {
    const groups = new Map<string, string[]>();
    for (const link of links) {
        if (!eligible(link)) continue;
        const pair = link.from < link.to ? `${link.from}\x00${link.to}` : `${link.to}\x00${link.from}`;
        const g = groups.get(pair);
        if (g !== undefined) g.push(link.key); else groups.set(pair, [link.key]);
    }
    const lanes = new Map<string, { i: number; n: number }>();
    for (const keys of groups.values()) {
        if (keys.length < 2) continue;
        keys.sort();
        keys.forEach((k, i) => lanes.set(k, { i, n: keys.length }));
    }
    return lanes;
}

/** Clamp a hatch `spacing` to a positive, finite minimum so the line sweep
 * always advances and terminates — a `0` / negative / NaN spacing would
 * otherwise hard-hang or stall the render thread (issue #57, P3). */
export function hatchSpacing(rawSpacing: number): number {
    return Number.isFinite(rawSpacing) ? Math.max(1, rawSpacing) : 1;
}

/**
 * The bounded offset range `[oStart, oEnd)` for the diagonal hatch sweep of a
 * zone whose screen rect is `(x, y, w, h)` on an `width × height` canvas, for a
 * line family of direction `(dx, dy)` spaced `spacing` apart, with `diag` the
 * sweep half-length. The full sweep is `-diag … diag`; this narrows it to the
 * offsets whose line can reach the on-screen portion of the zone, so the step
 * count is O(visible area / spacing) not O(zone area / spacing) (issue #57,
 * 1e). `oStart` is snapped onto the SAME `{ -diag + k·spacing }` phase grid the
 * full sweep uses, so the bounded sweep draws the identical lines — fewer of
 * them, never phase-shifted. A horizontal family (`dy ≈ 0`, so the line normal
 * has no x-component) can't be solved this way and falls back to the full
 * `-diag … diag` range: fully off-screen zones are already culled upstream, so
 * the only cost case is an on-screen zone far taller than the viewport, which
 * then pays the full-height sweep (it still terminates — `spacing ≥ 1`; this
 * degenerate orientation renders as collinear lines and is rarely authored).
 *
 * @returns the inclusive-exclusive offset range to sweep
 */
export function hatchSweepBounds(
    x: number, y: number, w: number, h: number, width: number, height: number,
    dx: number, dy: number, diag: number, spacing: number,
): { oStart: number; oEnd: number } {
    const nx = -dy, ny = dx;                       // unit line normal
    if (Math.abs(nx) <= 1e-6) return { oStart: -diag, oEnd: diag };
    const cx0 = Math.max(x, 0), cy0 = Math.max(y, 0);
    const cx1 = Math.min(x + w, width), cy1 = Math.min(y + h, height);
    // A line's normal-coordinate `c = X·n` is constant along it;
    // `c(o) = (x+o)·nx + (y - diag·dy)·ny`. Solve for the `o` whose `c` spans
    // the visible rect's `c` range.
    const cs = [cx0 * nx + cy0 * ny, cx1 * nx + cy0 * ny, cx0 * nx + cy1 * ny, cx1 * nx + cy1 * ny];
    const oOfC = (c: number) => (c - x * nx - (y - diag * dy) * ny) / nx;
    const oA = oOfC(Math.min(...cs)), oB = oOfC(Math.max(...cs));
    return {
        oStart: Math.max(-diag, -diag + Math.floor((Math.min(oA, oB) + diag) / spacing) * spacing - spacing),
        oEnd: Math.min(diag, Math.max(oA, oB) + spacing),
    };
}

/**
 * An upper bound on the number of hatch lines swept across an `w × h` (screen
 * px) region at `rawSpacing`. Finite for any input because {@link hatchSpacing}
 * floors the spacing at 1 (issue #57, P3); the painter further bounds the sweep
 * to the on-screen portion of the zone (1e).
 *
 * @param w - region width in screen px
 * @param h - region height in screen px
 * @param rawSpacing - the raw (possibly zero/negative) spacing
 * @returns a finite line-count upper bound
 */
export function hatchLineCount(w: number, h: number, rawSpacing: number): number {
    return Math.ceil((2 * Math.hypot(w, h)) / hatchSpacing(rawSpacing)) + 1;
}

/** World-space cull bbox for a zone: the declared `x/y/width/height` rect
 * unioned with the actual geometry's extent (circle centre±radius, polygon /
 * polyline vertex bounds), mirroring the item-footprint union — so a shape that
 * bows outside its declared rect is never wrongly culled (issue #57, 1e). */
function zoneWorldBbox(zone: SchematicZoneValue, geom: SchematicGeometryValue | undefined): Bbox {
    const bb: Bbox = { minX: zone.x, minY: zone.y, maxX: zone.x + zone.width, maxY: zone.y + zone.height };
    if (geom !== undefined && geom.type === "circle") {
        const cx = zone.x + zone.width / 2, cy = zone.y + zone.height / 2, r = geom.value.radius;
        bb.minX = Math.min(bb.minX, cx - r); bb.minY = Math.min(bb.minY, cy - r);
        bb.maxX = Math.max(bb.maxX, cx + r); bb.maxY = Math.max(bb.maxY, cy + r);
    } else if (geom !== undefined && geom.type !== "rect") {
        // Vertex bounds per issue #57 1e ("min/max over geom.value.vertices").
        // A DXF bulge arc bows past the vertex AABB by up to chord/2 for a
        // semicircle (more for a reflex bulge); that bow is intentionally NOT
        // added here, so a heavily-bulged edge whose apex is the only on-screen
        // part (its vertices, chord, and declared rect all off screen) can cull
        // a frame early — a rare, transient gap while zoomed in and panning, not
        // a persistent error, accepted to keep the cull cheap per 1e.
        const g = pointsBbox(geom.value.vertices);
        if (g !== null) {
            bb.minX = Math.min(bb.minX, g.minX); bb.minY = Math.min(bb.minY, g.minY);
            bb.maxX = Math.max(bb.maxX, g.maxX); bb.maxY = Math.max(bb.maxY, g.maxY);
        }
    }
    return bb;
}

/** One side of a net resolved to bus-bar geometry (world space). */
interface NetSide {
    /** Where the trunk attaches (bar tap for a multi-endpoint side, the item centre for a single one). */
    anchor: Pt;
    /** The header-bar segment, when this side has 2+ spread endpoints. */
    bar?: [Pt, Pt];
    /** Axis-aligned stub from each endpoint to its bar tap. */
    stubs: Pt[][];
    /** Junction DOTS — taps strictly inside the bar span (3-way joins); bar-end taps are elbows, no dot. */
    taps: Pt[];
}

/** Net (manifold / bus) geometry, world space — shared verbatim by the
 *  painter and the hit-test so the clickable shape equals the drawn one. */
export interface NetGeometry {
    /** Trunk polyline: source anchor → via… → destination anchor. */
    trunk: Pt[];
    bars: Array<[Pt, Pt]>;
    stubs: Pt[][];
    taps: Pt[];
}

/** Resolve one endpoint group to a header BAR + stubs (P&ID bus-bar
 *  convention), or a bare anchor when the group is a single point.
 *
 *  The bar runs along the group's larger spread axis, offset from the
 *  cluster TOWARD the trunk (30% of the gap, clamped to [0.9, 3] world
 *  units) so stubs stay short and the bar never spears the items. */
function netSide(pts: readonly Pt[], toward: Pt): NetSide {
    const centroid: Pt = {
        x: pts.reduce((a, q) => a + q.x, 0) / pts.length,
        y: pts.reduce((a, q) => a + q.y, 0) / pts.length,
    };
    if (pts.length === 1) return { anchor: pts[0]!, stubs: [], taps: [] };
    const minX = Math.min(...pts.map(q => q.x)), maxX = Math.max(...pts.map(q => q.x));
    const minY = Math.min(...pts.map(q => q.y)), maxY = Math.max(...pts.map(q => q.y));
    const vertical = (maxY - minY) >= (maxX - minX);
    // Coordinates along the bar (axis) and across it (perp).
    const axis = (q: Pt): number => vertical ? q.y : q.x;
    const perp = (q: Pt): number => vertical ? q.x : q.y;
    const mk = (a: number, pp: number): Pt => vertical ? { x: pp, y: a } : { x: a, y: pp };
    const lo = vertical ? minY : minX, hi = vertical ? maxY : maxX;
    if (hi - lo < 1e-6) return { anchor: centroid, stubs: [], taps: [] };
    // Bar offset: from the cluster edge FACING the trunk, toward it.
    const dir = Math.sign(perp(toward) - perp(centroid)) || 1;
    const edge = dir > 0 ? Math.max(...pts.map(perp)) : Math.min(...pts.map(perp));
    const gap = Math.abs(perp(toward) - edge);
    const barPerp = edge + dir * Math.min(Math.max(gap * 0.3, 0.9), 3);
    const anchor = mk(Math.min(Math.max(axis(toward), lo), hi), barPerp);
    const stubs = pts.map(q => [q, mk(axis(q), barPerp)]);
    const isEnd = (a: number): boolean => a - lo < 1e-6 || hi - a < 1e-6;
    const taps: Pt[] = [];
    const pushTap = (q: Pt): void => {
        if (isEnd(axis(q))) return;
        if (!taps.some(t => Math.abs(t.x - q.x) < 1e-6 && Math.abs(t.y - q.y) < 1e-6)) taps.push(q);
    };
    for (const st of stubs) pushTap(st[1]!);
    pushTap(anchor);
    return { anchor, bar: [mk(lo, barPerp), mk(hi, barPerp)], stubs, taps };
}

/** Bus-bar geometry for a whole net: each side becomes a header bar (or a
 *  bare anchor), the trunk runs bar-tap → `via`… → bar-tap. With one
 *  endpoint per side and no waypoints this degrades to a plain link. */
export function netGeometry(sources: readonly Pt[], destinations: readonly Pt[], via: readonly Pt[]): NetGeometry {
    const centroid = (qs: readonly Pt[]): Pt => ({
        x: qs.reduce((a, q) => a + q.x, 0) / qs.length,
        y: qs.reduce((a, q) => a + q.y, 0) / qs.length,
    });
    const srcToward = via.length > 0 ? via[0]! : centroid(destinations);
    const dstToward = via.length > 0 ? via[via.length - 1]! : centroid(sources);
    const src = netSide(sources, srcToward);
    const dst = netSide(destinations, dstToward);
    const bars: Array<[Pt, Pt]> = [];
    if (src.bar) bars.push(src.bar);
    if (dst.bar) bars.push(dst.bar);
    return {
        trunk: [src.anchor, ...via, dst.anchor],
        bars,
        stubs: [...src.stubs, ...dst.stubs],
        taps: [...src.taps, ...dst.taps],
    };
}

/** Draw a mid-path label pill (`label` in fg + optional muted `metric`) at the
 *  routed path's arc-length midpoint — shared by links and net trunks (#180/#189). */
function drawEdgeLabel(
    ctx: CanvasRenderingContext2D,
    p: SchematicPalette,
    pts: readonly Pt[],
    label: string | undefined,
    metric: string | undefined,
): void {
    if (label === undefined && metric === undefined) return;
    const mid = polylineMidpoint(pts);
    ctx.save();
    ctx.font = MARKER_LABEL_FONT;
    const main = label ?? "";
    const tail = metric !== undefined ? (label !== undefined ? ` · ${metric}` : metric) : "";
    const mainW = main !== "" ? ctx.measureText(main).width : 0;
    const tailW = tail !== "" ? ctx.measureText(tail).width : 0;
    const w = mainW + tailW + 12, h = 16;
    const left = mid.x - w / 2, top = mid.y - h / 2;
    ctx.beginPath();
    ctx.roundRect?.(left, top, w, h, h / 2);
    if (!ctx.roundRect) ctx.rect(left, top, w, h);
    ctx.fillStyle = css(p.bgSurface);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = css(p.borderSubtle);
    ctx.stroke();
    ctx.textBaseline = "middle";
    if (main !== "") {
        ctx.fillStyle = css(p.fg);
        ctx.fillText(main, left + 6, mid.y);
    }
    if (tail !== "") {
        ctx.fillStyle = css(p.fgMuted);
        ctx.fillText(tail, left + 6 + mainW, mid.y);
    }
    ctx.restore();
}

/** Draw the schematic's bulk-shape layer for one frame. Clears first. */
export function paintSchematic(input: PaintInput): void {
    const { ctx, value, cam, width, height, visibleItems, tiers, selected, selectedZones, centers, palette: p, effect, layerHiddenKeys, layerAlpha, draftLink, sessionLinks, connectFlash, selectedLink } = input;
    const wx = (x: number) => x * cam.ppu + cam.tx;
    const wy = (y: number) => y * cam.ppu + cam.ty;
    const ppu = cam.ppu;
    // Per-item render alpha / tint. `alphaOf` folds the slice-keep fade and the
    // layer dim (multiplicative); `desatOf` re-tints a desaturated excluded item.
    const isExcluded = (key: string): boolean => effect?.excluded.has(key) ?? false;
    const layerHidden = (key: string): boolean => layerHiddenKeys?.has(key) ?? false;
    const alphaOf = (key: string): number =>
        ((effect !== undefined && isExcluded(key)) ? effect.excludedOpacity : 1) * (layerAlpha?.get(key) ?? 1);
    const desatOf = (key: string): boolean => (effect !== undefined && isExcluded(key) && effect.excludedDesaturate);
    // The world rect currently on screen — zones / links whose geometry bbox
    // misses it are culled (issue #57, P6). Items are already viewport-culled
    // into `visibleItems` by the React layer's rbush.
    const viewBbox = viewportWorldBbox(cam, width, height);

    // Clear the FULL backing store in device space, independent of the dpr
    // transform — clearing in CSS px under a fractional-dpr transform leaves a
    // sub-pixel fringe on the right/bottom edge across pan frames (issue #57,
    // P7). The caller's transform still applies to subsequent drawing.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    ctx.lineJoin = "round";

    // ---- zones: rect outline / hatch + polyline / polygon geometry ----------
    for (const zone of value.zones) {
        if (layerHidden(zone.key)) continue;   // zone in a hidden layer
        const geom = getSomeorUndefined(zone.geometry);
        if (!bboxOverlaps(zoneWorldBbox(zone, geom), viewBbox)) continue;
        const pattern = zone.pattern;
        const patternTone = (pattern.value.tone.type === "some" ? pattern.value.tone.value.type : undefined) ?? "muted";
        const tint = resolveTint(p, getSomeorUndefined(zone.color), getSomeorUndefined(zone.tone)?.type, toneRGB(p, patternTone, "zone"), "zone");
        const zbg = getSomeorUndefined(zone.bg);
        const zFillAlpha = getSomeorUndefined(zone.fillOpacity) ?? 0.15;
        const zWeight = getSomeorUndefined(zone.weight);
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
            // `spacing` floored at 1 so the sweep always advances (no hang on
            // `spacing: 0`/negative — issue #57, P3).
            const spacing = hatchSpacing(getSomeorUndefined(pattern.value.spacing) ?? 8);
            const angle = (getSomeorUndefined(pattern.value.angle) ?? 45) * Math.PI / 180;
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
            // Bound the sweep to the offsets whose line reaches the on-screen
            // portion of the zone — phase-locked to the full sweep's grid so the
            // visible hatch is identical, just cheaper (issue #57, 1e).
            const { oStart, oEnd } = hatchSweepBounds(x, y, w, h, width, height, dx, dy, diag, spacing);
            ctx.beginPath();
            for (let o = oStart; o < oEnd; o += spacing) {
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

        // Selected-zone highlight (#177): a light brand wash + solid 2px brand
        // stroke over the zone's actual shape, drawn above its pattern.
        if (selectedZones?.has(zone.key) ?? false) {
            ctx.save();
            ctx.beginPath();
            if (geom !== undefined && geom.type === "circle") {
                ctx.arc(x + w / 2, y + h / 2, geom.value.radius * ppu, 0, Math.PI * 2);
            } else if (geom !== undefined && geom.type === "polygon") {
                traceVertices(ctx, geom.value.vertices.map(q => ({ x: wx(q.x), y: wy(q.y), bulge: q.bulge })), true);
            } else {
                ctx.rect(x, y, w, h);
            }
            ctx.globalAlpha = 0.06;
            ctx.fillStyle = css(p.brand500);
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.setLineDash([]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = css(p.brand600);
            ctx.stroke();
            ctx.restore();
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
    // Parallel-link fan-out (#180): lanes for links sharing an endpoint pair,
    // so N same-pair links (multi-operation data) read as N distinct edges.
    const lanes = parallelLanes(value.links, l =>
        !layerHidden(l.key) && centers.has(l.from) && centers.has(l.to) && l.via.length === 0);
    for (const link of value.links) {
        if (layerHidden(link.key)) continue;   // link in a hidden layer
        const from = centers.get(link.from), to = centers.get(link.to);
        if (!from || !to) continue;   // endpoint item hidden (layer or slice) ⇒ no centre
        // Cull by the AABB over ALL anchors (endpoints + waypoints), not the
        // endpoints alone — a trunk whose two ends sit off-screen but whose
        // segment crosses the viewport must NOT be culled (issue #57, 1e).
        const linkBbox = pointsBbox([from, ...link.via, to]);
        if (linkBbox !== null && !bboxOverlaps(linkBbox, viewBbox)) continue;
        const anchors = [from, ...link.via, to].map(q => ({ x: wx(q.x), y: wy(q.y) }));
        // Fan lane: translate the whole routed line rigidly along the pair's
        // perpendicular (screen px) — parallel lanes stay parallel through
        // orthogonal elbows, and edges fan at the endpoints like graph editors.
        const lane = lanes.get(link.key);
        if (lane !== undefined) {
            const a0 = anchors[0]!, a1 = anchors[anchors.length - 1]!;
            const len = Math.hypot(a1.x - a0.x, a1.y - a0.y);
            if (len > 1e-6) {
                const d = (lane.i - (lane.n - 1) / 2) * LINK_LANE_GAP;
                const ox = -(a1.y - a0.y) / len * d, oy = (a1.x - a0.x) / len * d;
                for (const q of anchors) { q.x += ox; q.y += oy; }
            }
        }
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
        // Selected-link halo (#176) — a soft brand over-stroke; when editable,
        // endpoint connector handles invite the re-target drag.
        if (selectedLink !== undefined && selectedLink.key === link.key) {
            ctx.save();
            ctx.lineWidth = weight + 4;
            ctx.strokeStyle = css(p.brand600, 0.25);
            ctx.beginPath();
            traceRounded(ctx, pts, corner);
            ctx.stroke();
            if (selectedLink.editable) {
                for (const q of [pts[0]!, pts[pts.length - 1]!]) {
                    ctx.beginPath();
                    ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
                    ctx.fillStyle = css(p.bgSurface);
                    ctx.fill();
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = css(p.brand600);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
        ctx.fillStyle = css(color);
        for (const end of [anchors[0]!, anchors[anchors.length - 1]!]) {
            ctx.beginPath();
            ctx.arc(end.x, end.y, weight + 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        // Mid-path label pill (#180) — hidden when zoomed out past the label band.
        if (ppu >= LINK_LABEL_MIN_PPU) {
            drawEdgeLabel(ctx, p, pts, getSomeorUndefined(link.label), getSomeorUndefined(link.metric));
        }
        ctx.lineCap = "butt";
    }

    // ---- nets: manifold / bus trunks with branches (#189) --------------------
    // One entity, many endpoints: the trunk spine runs head-junction → via… →
    // tail-junction (routed like a link; via = TRUNK waypoints; empty via ⇒
    // centroid heuristic); each resolved source branches into the head, each
    // destination off the tail. A hidden endpoint just drops its branch; the
    // whole net hides when either side empties or its layer is hidden.
    for (const net of value.nets) {
        if (layerHidden(net.key)) continue;
        const srcPts = net.sources.map(k => centers.get(k)).filter((q): q is Pt => q !== undefined);
        const dstPts = net.destinations.map(k => centers.get(k)).filter((q): q is Pt => q !== undefined);
        if (srcPts.length === 0 || dstPts.length === 0) continue;
        // Cull by the AABB over every endpoint + waypoint (same rule as links;
        // bar offsets stay within the endpoint↔trunk gap, so the AABB holds).
        const netBbox = pointsBbox([...srcPts, ...net.via, ...dstPts]);
        if (netBbox !== null && !bboxOverlaps(netBbox, viewBbox)) continue;
        const style = net.style;
        const tone = (style.value.tone.type === "some" ? style.value.tone.value.type : undefined)
            ?? (style.type === "solid" ? "brand" : "muted");
        const weight = style.value.weight.type === "some" ? style.value.weight.value
            : (style.type === "solid" ? 2.5 : 1.5);
        const corner = net.route.type === "orthogonal"
            ? (net.route.value.corner.type === "some" ? net.route.value.corner.value : 8) : 0;
        const color = toneRGB(p, tone, "link");
        const toScreen = (q: Pt): Pt => ({ x: wx(q.x), y: wy(q.y) });
        const routed = (worldAnchors: Pt[]): Pt[] => {
            const screen = worldAnchors.map(toScreen);
            return net.route.type === "orthogonal" ? orthogonalize(screen) : screen;
        };
        const isSel = selectedLink !== undefined && selectedLink.key === net.key;
        // Bus-bar geometry (shared with the hit-test): header bars spanning
        // each multi-endpoint side, short stubs tapping in, the trunk running
        // bar → via… → bar. Dots ONLY where a tap 3-way joins a bar.
        const geo = netGeometry(srcPts, dstPts, net.via);
        ctx.save();
        ctx.lineCap = "round";
        ctx.setLineDash(style.type === "dashed" ? [6, 5] : []);
        const trunkPts = routed(geo.trunk);
        ctx.strokeStyle = css(color);
        ctx.lineWidth = weight + 1;
        ctx.beginPath();
        traceRounded(ctx, trunkPts, corner);
        ctx.stroke();
        // Header bars carry the trunk weight; stubs are one step lighter.
        for (const bar of geo.bars) {
            ctx.beginPath();
            traceRounded(ctx, bar.map(toScreen), 0);
            ctx.stroke();
        }
        ctx.lineWidth = weight;
        for (const stub of geo.stubs) {
            ctx.beginPath();
            traceRounded(ctx, stub.map(toScreen), corner);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        // Junction dots: 3-way taps on the bars (P&ID convention — a dot
        // means lines JOIN; plain elbows and crossings stay dot-free).
        ctx.fillStyle = css(color);
        for (const j of geo.taps.map(toScreen)) {
            ctx.beginPath();
            ctx.arc(j.x, j.y, weight + 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        // Selected-net halo (#176 channel) — trunk + bars; no endpoint
        // handles (endpoints are sets).
        if (isSel) {
            ctx.lineWidth = weight + 5;
            ctx.strokeStyle = css(p.brand600, 0.25);
            ctx.beginPath();
            traceRounded(ctx, trunkPts, corner);
            ctx.stroke();
            for (const bar of geo.bars) {
                ctx.beginPath();
                traceRounded(ctx, bar.map(toScreen), 0);
                ctx.stroke();
            }
        }
        // Mid-trunk label / metric, like links (#180).
        if (ppu >= LINK_LABEL_MIN_PPU) {
            drawEdgeLabel(ctx, p, trunkPts, getSomeorUndefined(net.label), getSomeorUndefined(net.metric));
        }
        ctx.lineCap = "butt";
        ctx.restore();
    }

    // ---- connect-tool overlays (#176): session edges, draft edge, flash ------
    // Drawn above real links, below the slice-effect / markers. All routed
    // through the SAME orthogonal painter as real links (shape constraints).
    const routeScreen = (a: Pt, b: Pt): Pt[] =>
        orthogonalize([{ x: wx(a.x), y: wy(a.y) }, { x: wx(b.x), y: wy(b.y) }]);
    if (sessionLinks !== undefined) {
        for (const edge of sessionLinks) {
            ctx.save();
            ctx.lineCap = "round";
            ctx.setLineDash([6, 5]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = css(p.brand500, 0.75);
            ctx.beginPath();
            traceRounded(ctx, routeScreen(edge.from, edge.to), 8);
            ctx.stroke();
            ctx.restore();
        }
    }
    if (draftLink !== undefined) {
        const pts = routeScreen(draftLink.from, draftLink.to);
        ctx.save();
        ctx.lineCap = "round";
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = css(p.brand600, draftLink.snapped ? 1 : 0.65);
        ctx.beginPath();
        traceRounded(ctx, pts, 8);
        ctx.stroke();
        // Source dot + target affordance: a ring when snapped to a valid item,
        // a faint open circle at the cursor otherwise.
        const a = pts[0]!, b = pts[pts.length - 1]!;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = css(p.brand600);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(b.x, b.y, draftLink.snapped ? 9 : 6, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = css(p.brand600, draftLink.snapped ? 1 : 0.5);
        ctx.stroke();
        ctx.restore();
    }
    if (connectFlash !== undefined && connectFlash.from !== undefined && connectFlash.to !== undefined) {
        const t = connectFlash.phase;
        const pts = routeScreen(connectFlash.from, connectFlash.to);
        ctx.save();
        ctx.lineCap = "round";
        // Draw-in: the dash offset sweeps the edge; the whole flash fades out.
        ctx.setLineDash([10, 6]);
        ctx.lineDashOffset = -t * 32;
        ctx.lineWidth = 3;
        ctx.strokeStyle = css(p.brand600, 0.9 * (1 - t));
        ctx.beginPath();
        traceRounded(ctx, pts, 8);
        ctx.stroke();
        // Endpoint pulse rings expand + fade on BOTH items.
        ctx.setLineDash([]);
        for (const q of [pts[0]!, pts[pts.length - 1]!]) {
            ctx.beginPath();
            ctx.arc(q.x, q.y, 6 + t * 12, 0, Math.PI * 2);
            ctx.lineWidth = 2;
            ctx.strokeStyle = css(p.brand500, 0.8 * (1 - t));
            ctx.stroke();
        }
        ctx.restore();
    }

    // ---- slice-effect: frame the matched set, then emphasise the survivors ---
    // Drawn between links and items so the frame sits under the markers and the
    // emphasis rings glow behind them. Card-tier emphasis is a DOM concern (the
    // React layer styles the card element); here we ring only dot / label markers.
    if (effect !== undefined) {
        if (effect.frame !== undefined) {
            const pad = 10;
            const fx = wx(effect.frame.minX) - pad, fy = wy(effect.frame.minY) - pad;
            const fw = (effect.frame.maxX - effect.frame.minX) * ppu + pad * 2;
            const fh = (effect.frame.maxY - effect.frame.minY) * ppu + pad * 2;
            ctx.save();
            ctx.beginPath();
            ctx.rect(fx, fy, fw, fh);
            ctx.globalAlpha = 0.07;
            ctx.fillStyle = css(p.brand500);
            ctx.fill();
            ctx.restore();
            ctx.save();
            ctx.setLineDash([7, 5]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = css(p.brand600);
            ctx.strokeRect(fx, fy, fw, fh);
            ctx.setLineDash([]);
            ctx.restore();
        }
        if (effect.emphasis !== undefined) {
            const pulse = effect.emphasis === "pulse";
            // Breathing 0..1 sinusoid; `halo` is static (the ring's steady state).
            const b = pulse ? (Math.sin(effect.pulsePhase * Math.PI * 2) * 0.5 + 0.5) : 1;
            for (const item of visibleItems) {
                if (isExcluded(item.key)) continue;                    // matched only
                const tier = tiers.get(item.key) ?? "dot";
                if (tier === "card") continue;                         // card ring is CSS
                const baseR = tier === "label" ? 18 : 11;
                const r = baseR + (pulse ? b * 7 : 4);
                const alpha = pulse ? 0.14 + 0.30 * (1 - b) : 0.34;
                ctx.save();
                ctx.beginPath();
                ctx.arc(wx(item.x), wy(item.y), r, 0, Math.PI * 2);
                ctx.lineWidth = 2;
                ctx.strokeStyle = css(p.brand500, alpha);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    // ---- item footprints (close zoom only — semantic zoom) ------------------
    // Wrapped in save/restore per item so a slice-excluded footprint can fade
    // (globalAlpha) / desaturate (grey tint) without leaking state to the next.
    for (const item of visibleItems) {
        const footprint = getSomeorUndefined(item.footprint);
        if (footprint === undefined || footprint.type === "rect") continue;
        if ((tiers.get(item.key) ?? "dot") !== "card") continue;
        const isSel = selected.has(item.key);
        let tint = resolveTint(p, getSomeorUndefined(item.color), getSomeorUndefined(item.tone)?.type, statusRGB(p, statusTone(item.status)), "link");
        if (desatOf(item.key)) tint = css(p.fgMuted);
        const a = alphaOf(item.key);
        const ibg = getSomeorUndefined(item.bg);
        const fillAlpha = getSomeorUndefined(item.fillOpacity) ?? (isSel ? 0.24 : 0.12);
        const stroke = getSomeorUndefined(item.weight) ?? (isSel ? 2.5 : 1.5);
        const fillShape = () => {
            ctx.save();
            ctx.globalAlpha = fillAlpha * a;
            ctx.fillStyle = desatOf(item.key) ? tint : (ibg ?? tint);
            ctx.fill();
            ctx.restore();
        };

        ctx.save();
        ctx.globalAlpha = a;
        if (footprint.type === "circle") {
            ctx.beginPath();
            ctx.arc(wx(item.x), wy(item.y), footprint.value.radius * ppu, 0, Math.PI * 2);
            fillShape();
            ctx.lineWidth = stroke;
            ctx.strokeStyle = tint;
            ctx.stroke();
        } else {
            const pts = footprint.value.vertices.map(q => ({ x: wx(q.x), y: wy(q.y), bulge: q.bulge }));
            if (pts.length > 0) {
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
        }
        ctx.restore();
    }

    // ---- item LOD markers: dots + labelled pins (cards are DOM) --------------
    // Save/restore per item so a slice-excluded marker fades / desaturates
    // without leaking alpha or font state into the next marker.
    for (const item of visibleItems) {
        const tier = tiers.get(item.key) ?? "dot";
        if (tier === "card") continue; // rich card rendered by the React layer
        let tint = resolveTint(p, getSomeorUndefined(item.color), getSomeorUndefined(item.tone)?.type, statusRGB(p, statusTone(item.status)), "link");
        if (desatOf(item.key)) tint = css(p.fgMuted);
        const isSel = selected.has(item.key);
        const x = wx(item.x), y = wy(item.y);

        ctx.save();
        ctx.globalAlpha = alphaOf(item.key);
        if (tier === "dot") {
            ctx.beginPath();
            ctx.arc(x, y, MARKER_DOT_RADIUS, 0, Math.PI * 2);
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
        } else {
            // labelled pin — bounds come from the SHARED markerHitbox so the drawn
            // pill and the click target are identical (issue #57, P11).
            ctx.font = MARKER_LABEL_FONT;
            const box = markerHitbox(item, "label", cam, t => ctx.measureText(t).width);
            if (box.kind === "rect") {
                const { left, top, w, h } = box;
                ctx.beginPath();
                ctx.roundRect?.(left, top, w, h, h / 2);
                if (!ctx.roundRect) ctx.rect(left, top, w, h);
                ctx.fillStyle = css(p.bgSurface);
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = isSel ? css(p.fg) : css(p.borderStrong);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(left + MARKER_PIN_PAD_X + MARKER_PIN_DOT_W / 2, y, MARKER_PIN_DOT_W / 2, 0, Math.PI * 2);
                ctx.fillStyle = tint;
                ctx.fill();
                ctx.fillStyle = css(p.fg);
                ctx.textBaseline = "middle";
                ctx.fillText(item.label, left + MARKER_PIN_PAD_X + MARKER_PIN_DOT_W + MARKER_PIN_GAP, y);
            }
        }
        ctx.restore();
    }
}
