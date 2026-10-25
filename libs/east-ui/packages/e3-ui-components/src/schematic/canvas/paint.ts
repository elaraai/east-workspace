/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure Canvas2D paint layer for the Schematic. Given a 2D context, the East
 * value, a camera, the (already culled / LOD-decided) visible set, and a
 * theme-resolved palette, it draws the **bulk shapes** — zones (rect
 * outline / hatch + circle / polyline / polygon geometry, arcs included), links,
 * item footprints, and the dot / pin LOD markers. Rich item *cards* stay DOM
 * (the React layer draws
 * those at close zoom); this module never touches React, Chakra, or the DOM, so
 * it is unit-testable under any Canvas2D implementation (browser or node-skia).
 *
 * Every colour it draws is a design-system token the theme bridge resolved
 * (`theme.tsx`, #1387): its own marks' roles, and each entity's colour by its
 * id — its colour token, its tone, or its status's, resolved as the cards
 * resolve theirs (D14). Its labels draw in the font the bridge read from the
 * recipe: the design system's mono face. A marker whose colour is its status's
 * while its status is unread — its details row read — draws in the
 * placeholders' fill once the builder's reveal says so, and is unseen before
 * (#1398): never a status it has not read. While what it draws stands in for a
 * new narrowing, its words — a labelled pin's and a link's caption — draw in
 * the third ink, as a zone's eyebrow always does; every mark and edge is as it
 * was (the loading design's retained card).
 *
 * Its links and nets draw in the shared links look (#1403), through the shared
 * Canvas2D painter (`shared/links/canvas.ts`) the Plan's and the Allocation's
 * look is drawn by on SVG: each routed between the items it joins — orthogonal
 * or direct, through its bends, two of one pair fanned into lanes, a net as its
 * bus — its ends on the items' edges where they draw at the zoom (a card's
 * side, a labelled pin's edge, a dot's rim), its head where it arrives, a net's
 * on each of its destination legs; cased in the paper, in the muted ink or its
 * style's tone, a caption on its knockout at its route's middle, and the lit
 * and the selected ones in the strong ink, their ends ringed. Its colours and
 * its caption's font are the shared part's (`linkRibbons`), as the bridge
 * reads them. Its routes are pure too, in `routes.ts` (`linkRoutes`,
 * `netRoutes`), and its markers' geometry in `markers.ts` (`markerHitbox`), so
 * the hit-tests and a selected link's handles take the routes and the markers
 * the painter draws.
 *
 * @packageDocumentation
 */

import { match, type option, type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { arrive, paintLinks, traceHead, traceRoute, type CanvasLink, type CanvasLinkLook } from "../../shared/links/canvas.js";
import { placeCaptions, type RibbonCaption } from "../../shared/links/captions.js";
import { LINK_CAPTION_DROP, LINK_CORNER } from "../../shared/links/look.js";
import type { SchematicDensity } from "../area.js";
import { type Bbox, bboxOverlaps, pointsBbox, viewportWorldBbox } from "./camera";
import { statusUnread, type DrawnItem, type DrawnLink, type DrawnNet, type DrawnZone, type SchematicDrawn } from "./drawn";
import { MARKER_DOT_RADIUS, markerHitbox } from "./markers";
import { PIN_DOT_W, PIN_GAP, PIN_PAD_X } from "./model";
import {
    edgeWeight, leaveShape, linkRoutes, meetShape, netGeometry, netRoutes, orthogonalize, parallelLanes, routeEnv, type EdgeGeometry, type EdgeRun,
} from "./routes";

/** An Option's value, or `undefined` — East's `match`, as east-ui-components'
 *  `getSomeorUndefined` reads one, without loading that package's renderers:
 *  this module stays free of React, Chakra and the DOM (#1384). */
const getSomeorUndefined = <T,>(opt: option<T>): T | undefined => match(opt, { some: (value) => value }, undefined);

type SchematicGeometryValue = ValueTypeOf<typeof Schematic.Types.Geometry>;
type Pt = { x: number; y: number };
/** A screen-space shape vertex carrying its DXF bulge (0 = straight to next). */
type Vert = { x: number; y: number; bulge: number };

/** Per-item LOD tier (mirrors the React layer). */
export type LodTier = "card" | "label" | "dot";

/** An `[r, g, b]` triple in 0–255. */
export type RGB = [number, number, number];

/**
 * What the paint layer draws with, resolved by the theme bridge
 * (`theme.tsx`) from the design system's tokens through the recipe, once per
 * theme: its own marks' colours, each a role named after its token, and its
 * fonts. The paint layer is colour-system-agnostic and consumes RGB and font
 * strings.
 */
export interface SchematicPalette {
    /** `brandMark`: marks and dots — a match's ring, a connection's flash. */
    brandMark: RGB;
    /** `brand.solid`: the brand's line — a selected zone's and link's edge, a draft, a frame. */
    brandSolid: RGB;
    /** `brandTint`: the brand's area fill — a selected zone's wash. */
    brandTint: RGB;
    /** `fg`: ink — a selected marker's ring, a label. */
    fg: RGB;
    /** `fg.strong`: strong secondary ink. */
    fgStrong: RGB;
    /** `fg.muted`: secondary ink — a metric, an eyebrow, a context mark. */
    fgMuted: RGB;
    /** `fg.subtle`: labels and captions. */
    fgSubtle: RGB;
    /** `fg.faint`: muted marks. */
    fgFaint: RGB;
    /** `bg.surface`: paper — a pill's and a handle's fill, a dot's ring. */
    bgSurface: RGB;
    /** `bg.canvas`: the canvas's paper — an eyebrow's halo. */
    bgCanvas: RGB;
    /** `border.subtle`: a pill's rule. */
    borderSubtle: RGB;
    /** `border.strong`: a pin's rule. */
    borderStrong: RGB;
    /** `status.pos`. */
    statusPos: RGB;
    /** `status.neg`: a refused connection. */
    statusNeg: RGB;
    /** `status.warn`. */
    statusWarn: RGB;
    /** `status.info`. */
    statusInfo: RGB;
    /** `bg.subtle`: the placeholders' fill — a marker whose status is unread (#1398). */
    bgSubtle: RGB;
    /** `heat.1` … `heat.5`, lightest first: a density cell's steps (#1393). */
    heat1: RGB;
    heat2: RGB;
    heat3: RGB;
    heat4: RGB;
    heat5: RGB;
    /** The labels' font — a labelled pin's and a link's pill — in the design system's mono face, as `ctx.font` takes it. */
    labelFont: string;
    /** A zone's eyebrow's font, in the mono face. */
    eyebrowFont: string;
    /**
     * What links and nets draw in (#1403): the colours and the caption's font the page computes for the shared links
     * part's elements (`linkRibbons`), which the Plan's and the Allocation's links draw with too.
     */
    links: SchematicLinkLook;
}

/**
 * What the Schematic's links draw in (#1403): the shared look's colours and caption font, and a link drag's new line
 * and a moved link's `was` line, each with its width — every one the page computes for the shared links part's
 * elements.
 */
export interface SchematicLinkLook extends CanvasLinkLook {
    /** A link drag's new line: Connect's draft. */
    readonly preview: string;
    /** Its width (px). */
    readonly previewWidth: number;
    /** A moved link's line while a retarget drags its end. */
    readonly was: string;
    /** Its width (px). */
    readonly wasWidth: number;
}

/** The pan/zoom transform in CSS pixels: `screen = world × ppu + t`. */
export interface PaintCamera {
    ppu: number;
    tx: number;
    ty: number;
}

/**
 * What the rail's narrowing paints (#1392, §10.3): the rows it leaves out drawn
 * as context, and its matches emphasised and framed. Absent from
 * {@link PaintInput} ⇒ nothing narrows. A narrowed-out row that is hidden is
 * never drawn, so `excluded` holds only what draws as context.
 */
export interface SchematicPaintEffect {
    /** What draws as context, by id — items, zones, links and nets — faded, and greyed when `excludedDesaturate`; a net's leg to a context item too. */
    excluded: ReadonlySet<string>;
    /** Context's alpha (0–1); `1` ⇒ no fade. */
    excludedOpacity: number;
    /** Drain context's colour to the muted ink. */
    excludedDesaturate: boolean;
    /** The matches, by id: what `emphasis` rings — an item's marker, a zone's edge, a link's or a net's line. */
    matches: ReadonlySet<string>;
    /** The matches' emphasis — a ring, or one that breathes; `undefined` ⇒ none. */
    emphasis: "halo" | "pulse" | undefined;
    /** Animated pulse phase in `[0, 1)`; only read when `emphasis === "pulse"`. */
    pulsePhase: number;
    /** World-coordinate bbox framing the matches; `undefined` ⇒ no frame. */
    frame: Bbox | undefined;
}

/** Everything {@link paintSchematic} needs for one frame. */
export interface PaintInput {
    ctx: CanvasRenderingContext2D;
    /** What the canvas draws: each kind's entities, the local edits in place. */
    value: SchematicDrawn;
    cam: PaintCamera;
    /** Canvas size in CSS px (the ctx is pre-scaled by devicePixelRatio). */
    width: number;
    height: number;
    /** Viewport-culled items (the React layer's `visibleItems`). */
    visibleItems: readonly DrawnItem[];
    /** Per-item LOD tier after declutter. */
    tiers: ReadonlyMap<string, LodTier>;
    /** The set of selected item keys (single/multiple/range all share it). */
    selected: ReadonlySet<string>;
    /** The set of selected ZONE keys (#177); absent/empty ⇒ no zone highlight. */
    selectedZones?: ReadonlySet<string>;
    /** Item key → world centre, for link endpoints. */
    centers: ReadonlyMap<string, Pt>;
    palette: SchematicPalette;
    /**
     * Each entity's colour, by its id: an item's (its markers' and its
     * footprint's), a zone's, a link's and a net's — its colour token, else
     * its tone, else its status's or its pattern's, as the bridge resolved it
     * (`theme.tsx`). An entity it lacks draws in its kind's ground colour.
     */
    tints: ReadonlyMap<string, RGB>;
    /** What the rail's narrowing paints: context, emphasis and a frame (#1392). */
    effect?: SchematicPaintEffect;
    /** Entity keys in a hidden layer — zones / links with a hidden-layer key are
     * skipped (items are already pre-filtered out of `visibleItems`). Empty ⇒ no
     * layer filtering. */
    layerHiddenKeys?: ReadonlySet<string>;
    /** Item key → layer opacity (0–1), for items in a dimmed layer. Multiplies
     * the item marker / footprint alpha. Absent / missing key ⇒ full. */
    layerAlpha?: ReadonlyMap<string, number>;
    /**
     * The in-flight connect draft (#176): the shared drag preview from the item it runs from — `from` its centre, in
     * world coords, `fromKey` its id — to the pointer (`to`), or once `snapped`, to the item `toKey` names, ending on
     * each one's edge, with a head (#1403); `forbiddenKey` the target the veto refuses, the draft in the danger ink and
     * its marker ringed.
     */
    draftLink?: { from: Pt; to: Pt; fromKey: string; toKey?: string; snapped: boolean; forbiddenKey?: string };
    /** Open connect-session edges (#176, `connect` mode), world coords. */
    /** The open connect-session proposal: one pair is a dashed edge; a grown
     *  session previews as a dashed BUS (same geometry a committed net gets). */
    session?: { kind: "edge"; from: Pt; to: Pt } | { kind: "net"; sources: readonly Pt[]; destinations: readonly Pt[] };
    /** One-shot connect commit flash (#176); `phase` 0..1. Endpoints may be
     * undefined when an item vanished mid-flash — the painter skips then. */
    connectFlash?: { from: Pt | undefined; to: Pt | undefined; phase: number };
    /** The selected link (#176): halo stroke; `editable` also draws the
     * endpoint connector handles for re-targeting. A net LEG selection
     * narrows the halo to that one stub (#189 follow-up). */
    selectedLink?: { key: string; editable: boolean; leg?: { end: "source" | "destination"; item: string } };
    /**
     * Where a library card's drop lands while its drag rests there (#1390):
     * the point a template's item or a backlog row lands at, in world units —
     * a ring there — or the entity a card lands on, by its id: a zone's
     * dashed brand edge, a link's or a net's brand wash, a marker's brand
     * ring. A card-tier item's mark is its DOM card's (`data-drop-target`).
     */
    dropMark?: { kind: "point"; x: number; y: number } | { kind: "entity"; id: string };
    /**
     * Each card's size as the page lays it out, by its item's id (#1403): what a link's end meets at card zoom. A card
     * it lacks is reckoned as the declutter reckons it (`tierSize`).
     */
    cardSizes?: ReadonlyMap<string, { readonly w: number; readonly h: number }>;
    /** The link or the net under the pointer, by its id (#1403): drawn last, in the strong ink, its ends ringed. */
    lit?: string;
    /** The link whose end a retarget drags, by its id (#1403): drawn as its `was` line until the drag lets go. */
    was?: string;
    /**
     * Each kind read by area drawing its density in place of its items (#1393, D25), by its slot: its raster's cells,
     * each in its heat step by how many rows it holds, under the zones and every link and item.
     */
    density?: ReadonlyMap<string, SchematicDensity>;
    /**
     * Whether the placeholders show (#1398, CL4): a marker — or a footprint — whose colour is its status's while its status
     * is unread draws in the placeholders' fill once the builder's reveal says so, and is unseen before, its place kept.
     * Absent, they show.
     */
    placeholders?: boolean;
    /**
     * Whether what it draws stands in for a new narrowing while that is read (#1398, the loading design's retained card):
     * its words — a labelled pin's and a link's caption — in the third ink (`fg.muted`), every mark and edge as it is.
     * Absent, it draws as itself.
     */
    stale?: boolean;
}

/**
 * A density raster's cell's heat step (#1393, ruled 23 Oct 2026): one of the
 * theme's five, by its share of the fullest cell on halving steps — over half
 * the fullest the fifth, over a quarter the fourth, over an eighth the third,
 * over a sixteenth the second, the first below — so cells that differ by a
 * row or two of a uniform block read alike, and a cell the rows fill in part
 * reads a step or two lighter.
 *
 * @param count - The rows the cell holds
 * @param most - The rows the fullest cell holds
 * @returns Its step, 1 to 5; `0` for an empty cell
 */
export function densityStep(count: number, most: number): 0 | 1 | 2 | 3 | 4 | 5 {
    if (count <= 0 || most <= 0) return 0;
    const halvings = Math.floor(Math.log2(most / Math.min(count, most)));
    return Math.max(1, 5 - halvings) as 1 | 2 | 3 | 4 | 5;
}

const css = (c: RGB, a = 1): string =>
    a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Whether an item's status draws as an open ring, as a tentative one does. */
function statusRing(status: DrawnItem["status"]): boolean {
    return status.type === "some" && status.value.ring;
}

/**
 * Geometry's vertices in world units: each an offset from its entity's anchor
 * — an item's centre, a zone's box centre (D22) — placed about it.
 *
 * @param anchor - The entity's anchor, in world units
 * @param vertices - The geometry's vertices, offsets from the anchor
 * @returns The vertices placed in the world
 */
export function placedVertices<V extends { x: number; y: number; bulge: number }>(anchor: Pt, vertices: readonly V[]): Vert[] {
    return vertices.map(v => ({ x: anchor.x + v.x, y: anchor.y + v.y, bulge: v.bulge }));
}

/** A zone's anchor: its box's centre, what its geometry is drawn about. */
export function zoneAnchor(zone: { x: number; y: number; width: number; height: number }): Pt {
    return { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
}

/** Trace `pts` into `ctx`, rounding corners by up to `radius` (rounded cable-tray look). */
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

/**
 * Dots drawn alike, by their look (#1393): their style, then their line's
 * width (a fill's is 0), then their alpha, each look's centres in screen px as
 * `x, y, x, y, …`.
 */
type DotBatch = Map<string, Map<number, Map<number, number[]>>>;

/** Adds a dot's centre to the look it draws in. */
function batchDot(batch: DotBatch, style: string, width: number, alpha: number, x: number, y: number): void {
    let widths = batch.get(style);
    if (widths === undefined) batch.set(style, widths = new Map());
    let alphas = widths.get(width);
    if (alphas === undefined) widths.set(width, alphas = new Map());
    const centres = alphas.get(alpha);
    if (centres === undefined) alphas.set(alpha, [x, y]);
    else centres.push(x, y);
}

/**
 * Fills or strokes each look's dots as one path, every dot a circle of
 * {@link MARKER_DOT_RADIUS} about its centre: a draw a look, whatever the
 * number of dots. The caller saves and restores the context about it.
 */
function paintDots(ctx: CanvasRenderingContext2D, batch: DotBatch, op: "fill" | "stroke"): void {
    for (const [style, widths] of batch) {
        for (const [width, alphas] of widths) {
            for (const [alpha, centres] of alphas) {
                ctx.globalAlpha = alpha;
                if (op === "fill") ctx.fillStyle = style;
                else { ctx.strokeStyle = style; ctx.lineWidth = width; }
                ctx.beginPath();
                for (let i = 0; i < centres.length; i += 2) {
                    const x = centres[i]!, y = centres[i + 1]!;
                    ctx.moveTo(x + MARKER_DOT_RADIUS, y);
                    ctx.arc(x, y, MARKER_DOT_RADIUS, 0, Math.PI * 2);
                }
                if (op === "fill") ctx.fill();
                else ctx.stroke();
            }
        }
    }
}

/** Links hide their mid-path label below this zoom (px per world unit) —
 *  aligned with the item labelled-pin band. */
export const LINK_LABEL_MIN_PPU = 16;

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
 * polyline vertex bounds, each vertex about the box's centre), mirroring the
 * item-footprint union — so a shape that bows outside its declared rect is
 * never wrongly culled (issue #57, 1e). */
function zoneWorldBbox(zone: DrawnZone, geom: SchematicGeometryValue | undefined): Bbox {
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
        const g = pointsBbox(placedVertices(zoneAnchor(zone), geom.value.vertices));
        if (g !== null) {
            bb.minX = Math.min(bb.minX, g.minX); bb.minY = Math.min(bb.minY, g.minY);
            bb.maxX = Math.max(bb.maxX, g.maxX); bb.maxY = Math.max(bb.maxY, g.maxY);
        }
    }
    return bb;
}

/** A caption's text: a link's label and its metric (`uplink · 100G`), either alone, or none. */
export function captionText(label: string | undefined, metric: string | undefined): string | undefined {
    return label !== undefined && metric !== undefined ? `${label} · ${metric}` : label ?? metric;
}

/** Draw the schematic's bulk-shape layer for one frame. Clears first. */
export function paintSchematic(input: PaintInput): void {
    const { ctx, value, cam, width, height, visibleItems, tiers, selected, selectedZones, centers, palette: p, tints, effect, layerHiddenKeys, layerAlpha, draftLink, session, connectFlash, selectedLink, dropMark } = input;
    // An entity's colour by its id, as the bridge resolved it; else its kind's ground.
    const tintOf = (key: string, ground: RGB): string => css(tints.get(key) ?? ground);
    // Whether a status unread draws its placeholder now: once the builder's reveal says so (#1398, CL4).
    const placeholders = input.placeholders ?? true;
    // The ink its words draw in: the third while what it draws stands in for a new narrowing (#1398), else the ink.
    const wordsInk = css(input.stale === true ? p.fgMuted : p.fg);
    // The entity a library card's drop lands on, by its id (#1390).
    const dropOn = dropMark?.kind === "entity" ? dropMark.id : undefined;
    const wx = (x: number) => x * cam.ppu + cam.tx;
    const wy = (y: number) => y * cam.ppu + cam.ty;
    const ppu = cam.ppu;
    // Render alpha / tint. `contextAlpha` is the narrowing's fade of what draws as context (#1392); `alphaOf` folds an
    // item's layer dim into it (multiplicative) — a layer dims its items alone; `desatOf` drains context to the muted ink.
    const isExcluded = (key: string): boolean => effect?.excluded.has(key) ?? false;
    const layerHidden = (key: string): boolean => layerHiddenKeys?.has(key) ?? false;
    const contextAlpha = (key: string): number => ((effect !== undefined && isExcluded(key)) ? effect.excludedOpacity : 1);
    const alphaOf = (key: string): number => contextAlpha(key) * (layerAlpha?.get(key) ?? 1);
    const desatOf = (key: string): boolean => (effect !== undefined && isExcluded(key) && effect.excludedDesaturate);
    // The matches' emphasis (§10.3): a ring of the brand's mark about a match — steady for `halo`, breathing for
    // `pulse` (0..1 sinusoid) — on an item's marker, a zone's edge, or under a link's or a net's line.
    const pulse = effect?.emphasis === "pulse";
    const breath = pulse ? Math.sin(effect!.pulsePhase * Math.PI * 2) * 0.5 + 0.5 : 1;
    const emphasised = (key: string): boolean => effect !== undefined && effect.emphasis !== undefined && effect.matches.has(key);
    const ringAlpha = pulse ? 0.14 + 0.30 * (1 - breath) : 0.34;
    const ringGrow = pulse ? breath * 7 : 4;
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

    // ---- the density at overview (#1393, D25): each kind's raster, under the zones -------
    // Each cell holding rows a square in its heat step (`densityStep`); a cell off screen is culled. The zones draw over
    // it, so a hall's outline and its eyebrow stand over the racks' shading.
    if (input.density !== undefined && input.density.size > 0) {
        const steps = [p.heat1, p.heat2, p.heat3, p.heat4, p.heat5].map((c) => css(c));
        ctx.save();
        for (const raster of input.density.values()) {
            const side = raster.side * ppu;
            for (const cell of raster.cells) {
                const step = densityStep(cell.count, raster.most);
                if (step === 0) continue;
                const x = wx(cell.minX), y = wy(cell.minY);
                if (x > width || y > height || x + side < 0 || y + side < 0) continue;
                ctx.fillStyle = steps[step - 1]!;
                ctx.fillRect(x, y, side, side);
            }
        }
        ctx.restore();
    }

    // ---- zones: rect outline / hatch + polyline / polygon geometry ----------
    for (const zone of value.zones) {
        if (layerHidden(zone.key)) continue;   // zone in a hidden layer
        const geom = getSomeorUndefined(zone.geometry);
        if (!bboxOverlaps(zoneWorldBbox(zone, geom), viewBbox)) continue;
        const pattern = zone.pattern;
        // Its colour token, else its tone, else its pattern's (§4.2); as context, drained to its ground (#1392).
        const tint = desatOf(zone.key) ? css(p.borderStrong) : tintOf(zone.key, p.borderStrong);
        // A zone is unfilled unless its `fillOpacity` says how much: then it is filled in its tint.
        const zFillAlpha = getSomeorUndefined(zone.fillOpacity);
        const zWeight = getSomeorUndefined(zone.weight);
        const x = wx(zone.x), y = wy(zone.y), w = zone.width * ppu, h = zone.height * ppu;
        const anchor = zoneAnchor(zone);
        // Its whole drawing faded as context, each alpha of its own times it.
        const za = contextAlpha(zone.key);
        ctx.save();
        ctx.globalAlpha = za;
        // Its shape's path, in screen space: its circle, its polygon, or its box.
        const traceShape = () => {
            ctx.beginPath();
            if (geom !== undefined && geom.type === "circle") {
                ctx.arc(x + w / 2, y + h / 2, geom.value.radius * ppu, 0, Math.PI * 2);
            } else if (geom !== undefined && geom.type === "polygon") {
                traceVertices(ctx, placedVertices(anchor, geom.value.vertices).map(q => ({ x: wx(q.x), y: wy(q.y), bulge: q.bulge })), true);
            } else {
                ctx.rect(x, y, w, h);
            }
        };
        const fillShape = () => {
            if (zFillAlpha === undefined) return;
            ctx.save();
            ctx.globalAlpha = zFillAlpha * za;
            ctx.fillStyle = tint;
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
                const pts = placedVertices(anchor, geom.value.vertices).map(q => ({ x: wx(q.x), y: wy(q.y), bulge: q.bulge }));
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
                        ctx.globalAlpha = 0.55 * za;
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
            if (zFillAlpha !== undefined) {
                ctx.save();
                ctx.globalAlpha = zFillAlpha * za;
                ctx.fillStyle = tint;
                ctx.fillRect(x, y, w, h);
                ctx.restore();
            }
            ctx.globalAlpha = 0.3 * za;
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
            if (zFillAlpha !== undefined) {
                ctx.save();
                ctx.globalAlpha = zFillAlpha * za;
                ctx.fillStyle = tint;
                ctx.fillRect(x, y, w, h);
                ctx.restore();
            }
            ctx.setLineDash([5, 4]);
            ctx.lineWidth = zWeight ?? 1;
            ctx.strokeStyle = tint;
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
        }

        // Selected-zone highlight (#177): the brand's area fill — the design
        // system's `brandTint` at 0.7 — and a solid 2px `brand.solid` stroke
        // over the zone's actual shape, drawn above its pattern.
        if (selectedZones?.has(zone.key) ?? false) {
            ctx.save();
            traceShape();
            ctx.globalAlpha = 0.7 * za;
            ctx.fillStyle = css(p.brandTint);
            ctx.fill();
            ctx.globalAlpha = za;
            ctx.setLineDash([]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = css(p.brandSolid);
            ctx.stroke();
            ctx.restore();
        }

        // The zone a card's drop lands on (#1390): the brand's wash, under a dashed brand edge — a selection's is solid.
        if (dropOn === zone.key) {
            ctx.save();
            traceShape();
            ctx.globalAlpha = 0.5 * za;
            ctx.fillStyle = css(p.brandTint);
            ctx.fill();
            ctx.globalAlpha = za;
            ctx.setLineDash([6, 4]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = css(p.brandSolid);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        // A matched zone's emphasis (#1392): the brand's mark rings its edge.
        if (emphasised(zone.key)) {
            ctx.save();
            traceShape();
            ctx.setLineDash([]);
            ctx.lineWidth = 2 + ringGrow;
            ctx.strokeStyle = css(p.brandMark, ringAlpha);
            ctx.stroke();
            ctx.restore();
        }

        // eyebrow label at the bbox top-left (the minimap's anchor), in the mono face
        if (w >= zone.label.length * 6.2 + 24) {
            ctx.font = p.eyebrowFont;
            const label = zone.label.toUpperCase();
            const tw = ctx.measureText(label).width;
            ctx.fillStyle = css(p.bgCanvas);
            ctx.fillRect(x + 6, y - 7, tw + 6, 12);
            ctx.fillStyle = css(p.fgMuted);
            ctx.textBaseline = "middle";
            ctx.fillText(label, x + 9, y);
        }
        ctx.restore();
    }

    // ---- links and nets, in the shared links look (#1403) ------------------------
    // Each routed between the items it joins, its ends on their edges where they
    // draw at the zoom; culled by the box over every item it joins and its bends,
    // so one whose ends sit off screen but which crosses it draws (issue #57, 1e).
    // Parallel links (#180) fan into lanes, so N runs of one pair read as N.
    const lanes = parallelLanes(value.links, l =>
        !layerHidden(l.key) && centers.has(l.from) && centers.has(l.to) && l.via.length === 0);
    const itemsById = new Map(value.items.map((item) => [item.key, item] as const));
    // A pin's label, measured in the pins' font, as the marker pass and a tap measure it.
    const measure = (text: string): number => {
        ctx.save();
        ctx.font = p.labelFont;
        const w = ctx.measureText(text).width;
        ctx.restore();
        return w;
    };
    const env = routeEnv({ cam, centers, items: itemsById, tiers, cardSizes: input.cardSizes, lanes, measure });
    const edges: { readonly drawn: DrawnLink | DrawnNet; readonly net: boolean; readonly geometry: EdgeGeometry }[] = [];
    for (const link of value.links) {
        if (layerHidden(link.key)) continue;   // a link in a hidden layer
        const from = centers.get(link.from), to = centers.get(link.to);
        if (!from || !to) continue;   // an end hidden (a layer, or the narrowing): no centre
        const box = pointsBbox([from, ...link.via, to]);
        if (box !== null && !bboxOverlaps(box, viewBbox)) continue;
        const geometry = linkRoutes(link, env);
        if (geometry !== undefined) edges.push({ drawn: link, net: false, geometry });
    }
    // A net (#189): one entity, many members — a hidden member drops its leg, and the whole net goes while a side has
    // none drawn or its layer is hidden.
    for (const net of value.nets) {
        if (layerHidden(net.key)) continue;
        const members = [...net.sources, ...net.destinations].flatMap((k) => { const c = centers.get(k); return c === undefined ? [] : [c]; });
        const box = pointsBbox([...members, ...net.via]);
        if (box !== null && !bboxOverlaps(box, viewBbox)) continue;
        const geometry = netRoutes(net, env);
        if (geometry !== undefined) edges.push({ drawn: net, net: true, geometry });
    }
    // Under every line: a match's emphasis — the brand's mark, wide (#1392) — and where a card's drop lands, the
    // brand's wash (#1390), along each run to its head's tip.
    const underline = (geometry: EdgeGeometry, width: number, style: string, alpha: number) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.setLineDash([]);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = width;
        ctx.strokeStyle = style;
        for (const run of geometry.runs) {
            ctx.beginPath();
            traceRoute(ctx, run.route, run.corner);
            ctx.stroke();
        }
        ctx.restore();
    };
    for (const edge of edges) {
        const key = edge.drawn.key, weight = edgeWeight(edge.drawn.style);
        if (emphasised(key)) underline(edge.geometry, weight + (edge.net ? 5 : 4) + ringGrow, css(p.brandMark, ringAlpha), contextAlpha(key));
        if (dropOn === key) underline(edge.geometry, weight + 10, css(p.brandSolid, 0.3), contextAlpha(key));
    }
    // Each caption — a link's label and its metric — at its route's middle, from the label zoom, kept inside the
    // canvas and stepped clear of an earlier one (`placeCaptions`).
    const captions = new Map<string, RibbonCaption>();
    if (ppu >= LINK_LABEL_MIN_PPU) {
        for (const edge of edges) {
            const text = captionText(getSomeorUndefined(edge.drawn.label), getSomeorUndefined(edge.drawn.metric));
            const middle = edge.geometry.middle;
            if (text !== undefined && middle !== undefined) captions.set(edge.drawn.key, { label: text, lx: middle.x, ly: middle.y + LINK_CAPTION_DROP });
        }
        placeCaptions([...captions.values()], 0, width);
    }
    // The links as the shared painter draws them: the muted ink — or its style's tone, drained as context — cased in
    // the paper; the selected one, then the lit one, in the strong ink, their ends ringed; a net's selected leg in the
    // strong ink; a retarget's link its `was` line while its end is dragged. Standing in for a new narrowing, each
    // caption's words draw in the third ink, its line as it is (#1398).
    const look = input.stale === true ? { ...p.links, caption: css(p.fgMuted) } : p.links;
    const selectedLeg = selectedLink?.leg;
    paintLinks(ctx, edges.map(({ drawn, geometry }): CanvasLink => {
        const key = drawn.key;
        const moved = input.was === key;
        const selected = !moved && selectedLink !== undefined && selectedLink.key === key && selectedLeg === undefined;
        const lit = !moved && input.lit === key;
        const tint = tints.get(key);
        // A leg to an item drawn as context fades with it, the net itself drawing as itself (#1392); the net's selected leg is strong.
        const own = (leg: EdgeRun["leg"]) => {
            const faded = leg !== undefined && isExcluded(leg.item) && !isExcluded(key);
            const strong = selectedLeg !== undefined && selectedLink?.key === key && leg !== undefined && leg.end === selectedLeg.end && leg.item === selectedLeg.item;
            return {
                ...(faded ? { alpha: effect!.excludedOpacity, ...(effect!.excludedDesaturate ? { ink: look.ink } : {}) } : {}),
                ...(strong ? { strong: true } : {}),
            };
        };
        const caption = captions.get(key);
        return {
            id: key,
            strokes: geometry.runs.map((run) => ({ points: run.line, width: moved ? look.wasWidth : run.width, corner: run.corner, ...own(run.leg) })),
            heads: geometry.runs.flatMap((run) => (run.head === undefined ? [] : [{ ...run.head, ...own(run.leg) }])),
            dots: geometry.dots,
            dash: drawn.style.type === "dashed" ? [6, 5] : [],
            ink: moved ? look.was : desatOf(key) || tint === undefined ? undefined : css(tint),
            alpha: contextAlpha(key),
            lit, selected,
            ends: lit || selected ? geometry.ends : [],
            caption: caption === undefined || caption.label === undefined ? undefined : { text: caption.label, x: caption.lx, y: caption.ly },
        };
    }), look);
    // A selected link's handles (#176, SC10), over it at its ends' edges, while it writes: a press there that moves
    // retargets that end.
    if (selectedLink?.editable === true) {
        const handles = edges.find((edge) => edge.drawn.key === selectedLink.key)?.geometry.handles;
        if (handles !== undefined) {
            ctx.save();
            for (const q of [handles.from, handles.to]) {
                ctx.beginPath();
                ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
                ctx.fillStyle = css(p.bgSurface);
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = css(p.brandSolid);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    // ---- connect-tool overlays (#176): session edges, draft edge, flash ------
    // Drawn above real links, below the narrowing's frame and rings and the
    // markers. All routed through the SAME orthogonal painter as real links
    // (shape constraints).
    const routeScreen = (a: Pt, b: Pt): Pt[] =>
        orthogonalize([{ x: wx(a.x), y: wy(a.y) }, { x: wx(b.x), y: wy(b.y) }]);
    if (session !== undefined) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = css(p.brandMark, 0.75);
        if (session.kind === "edge") {
            ctx.beginPath();
            traceRounded(ctx, routeScreen(session.from, session.to), 8);
            ctx.stroke();
        } else {
            // The proposal previews with the SAME bus geometry a committed net
            // would get — dashed, and without junction dots (it is not real yet).
            const geo = netGeometry(session.sources, session.destinations, []);
            const toS = (q: Pt): Pt => ({ x: wx(q.x), y: wy(q.y) });
            ctx.beginPath();
            traceRounded(ctx, orthogonalize(geo.trunk.map(toS)), 8);
            ctx.stroke();
            for (const bar of geo.bars) {
                ctx.beginPath();
                traceRounded(ctx, bar.map(toS), 0);
                ctx.stroke();
            }
            for (const stub of geo.stubs) {
                ctx.beginPath();
                traceRounded(ctx, orthogonalize(stub.map(toS)), 8);
                ctx.stroke();
            }
        }
        ctx.restore();
    }
    if (draftLink !== undefined) {
        // The shared drag preview (#1403): the brand's line from the item the draft runs from — off its edge — to the
        // pointer, or to the item it snaps to, onto its edge, with a head. A canConnect veto turns it DANGER, and rings
        // the forbidden marker (a card's ring is the recipe's `data-forbidden`; here the dot and label tiers').
        const vetoed = draftLink.forbiddenKey !== undefined;
        const ink = vetoed ? css(p.statusNeg) : look.preview;
        const fromShape = env.shapeOf(draftLink.fromKey);
        const toShape = draftLink.snapped && draftLink.toKey !== undefined ? env.shapeOf(draftLink.toKey) : undefined;
        let route = routeScreen(draftLink.from, draftLink.to);
        if (fromShape !== undefined) route = leaveShape(route, fromShape);
        if (toShape !== undefined) route = meetShape(route, toShape);
        const arrived = arrive(route, look.previewWidth);
        ctx.save();
        if (arrived !== undefined) {
            ctx.setLineDash([]);
            ctx.lineJoin = "round";
            ctx.lineCap = "butt";
            ctx.lineWidth = look.previewWidth;
            ctx.strokeStyle = ink;
            ctx.beginPath();
            traceRoute(ctx, arrived.line, LINK_CORNER);
            ctx.stroke();
            ctx.fillStyle = ink;
            ctx.beginPath();
            traceHead(ctx, arrived.head);
            ctx.fill();
        }
        if (vetoed) {
            const fc = centers.get(draftLink.forbiddenKey!);
            const tier = tiers.get(draftLink.forbiddenKey!) ?? "dot";
            if (fc !== undefined && tier !== "card") {
                const r = (tier === "label" ? 18 : 11) + 4;
                ctx.beginPath();
                ctx.arc(wx(fc.x), wy(fc.y), r, 0, Math.PI * 2);
                ctx.lineWidth = 2;
                ctx.strokeStyle = css(p.statusNeg, 0.75);
                ctx.stroke();
            }
        }
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
        ctx.strokeStyle = css(p.brandSolid, 0.9 * (1 - t));
        ctx.beginPath();
        traceRounded(ctx, pts, 8);
        ctx.stroke();
        // Endpoint pulse rings expand + fade on BOTH items.
        ctx.setLineDash([]);
        for (const q of [pts[0]!, pts[pts.length - 1]!]) {
            ctx.beginPath();
            ctx.arc(q.x, q.y, 6 + t * 12, 0, Math.PI * 2);
            ctx.lineWidth = 2;
            ctx.strokeStyle = css(p.brandMark, 0.8 * (1 - t));
            ctx.stroke();
        }
        ctx.restore();
    }

    // ---- the narrowing (#1392): frame the matches, then ring the matched items ---
    // Drawn between links and items so the frame sits under the markers and the
    // emphasis rings glow behind them. Card-tier emphasis is a DOM concern (the
    // React layer styles the card element); here we ring only dot / label markers.
    // A zone's, a link's and a net's are drawn with them, above.
    if (effect !== undefined) {
        if (effect.frame !== undefined) {
            const pad = 10;
            const fx = wx(effect.frame.minX) - pad, fy = wy(effect.frame.minY) - pad;
            const fw = (effect.frame.maxX - effect.frame.minX) * ppu + pad * 2;
            const fh = (effect.frame.maxY - effect.frame.minY) * ppu + pad * 2;
            ctx.save();
            ctx.beginPath();
            ctx.rect(fx, fy, fw, fh);
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = css(p.brandTint);
            ctx.fill();
            ctx.restore();
            ctx.save();
            ctx.setLineDash([7, 5]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = css(p.brandSolid);
            ctx.strokeRect(fx, fy, fw, fh);
            ctx.setLineDash([]);
            ctx.restore();
        }
        if (effect.emphasis !== undefined) {
            for (const item of visibleItems) {
                if (!effect.matches.has(item.key)) continue;           // matched only
                const tier = tiers.get(item.key) ?? "dot";
                if (tier === "card") continue;                         // card ring is CSS
                const baseR = tier === "label" ? 18 : 11;
                ctx.save();
                ctx.beginPath();
                ctx.arc(wx(item.x), wy(item.y), baseR + ringGrow, 0, Math.PI * 2);
                ctx.lineWidth = 2;
                ctx.strokeStyle = css(p.brandMark, ringAlpha);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    // ---- item footprints (close zoom only — semantic zoom) ------------------
    // Wrapped in save/restore per item so a footprint drawn as context can fade
    // (globalAlpha) / desaturate (grey tint) without leaking state to the next.
    for (const item of visibleItems) {
        const footprint = getSomeorUndefined(item.footprint);
        if (footprint === undefined || footprint.type === "rect") continue;
        if ((tiers.get(item.key) ?? "dot") !== "card") continue;
        const isSel = selected.has(item.key);
        // Its status unread, its colour is the placeholders' fill, once revealed; unseen before (#1398).
        const unread = statusUnread(item);
        if (unread && !placeholders) continue;
        // Its colour token, else its tone, else its status's — the colour its card's dot is.
        let tint = unread ? css(p.bgSubtle) : tintOf(item.key, p.fgMuted);
        if (desatOf(item.key)) tint = css(p.fgMuted);
        const a = alphaOf(item.key);
        const fillAlpha = getSomeorUndefined(item.fillOpacity) ?? (isSel ? 0.24 : 0.12);
        const stroke = getSomeorUndefined(item.weight) ?? (isSel ? 2.5 : 1.5);
        const fillShape = () => {
            ctx.save();
            ctx.globalAlpha = fillAlpha * a;
            ctx.fillStyle = tint;
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
            const pts = placedVertices(item, footprint.value.vertices).map(q => ({ x: wx(q.x), y: wy(q.y), bulge: q.bulge }));
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
    // The dots draw in batches (#1393): the fills of every dot not selected, one path a look — its style and its alpha —
    // then their rings so, never a save, a fill and a stroke a dot, as thousands land at the dots' zoom. A dot's ring is
    // the paper it stands on, so every ring draws over every fill, a neighbour's among them. A pin draws on its own, its
    // save and restore keeping its fade and its font from the next; and what is selected draws last, over its
    // neighbours, each on its own: the declutter keeps every other pin clear of every mark, but a selected item takes
    // its form whatever it covers. The marker a card's drop lands on draws on its own too, its ring about it.
    // Its tint — its status unread (#1398), the placeholders' fill; drained as context, the muted ink — each colour's
    // words made once a frame.
    const surface = css(p.bgSurface), placeholder = css(p.bgSubtle), muted = css(p.fgMuted);
    const colours = new Map<RGB, string>();
    const markerTint = (item: DrawnItem, unread: boolean): string => {
        if (desatOf(item.key)) return muted;
        if (unread) return placeholder;
        const own = tints.get(item.key);
        if (own === undefined) return muted;
        let words = colours.get(own);
        if (words === undefined) colours.set(own, words = css(own));
        return words;
    };
    const dotFills: DotBatch = new Map(), dotRings: DotBatch = new Map();
    const alone: DrawnItem[] = [];
    for (const item of visibleItems) {
        const tier = tiers.get(item.key) ?? "dot";
        if (tier === "card") continue; // rich card rendered by the React layer
        if (tier !== "dot" || selected.has(item.key) || dropOn === item.key) { alone.push(item); continue; }
        // Its status unread (#1398): its dot in the placeholders' fill once revealed, unseen before — never a status.
        const unread = statusUnread(item);
        if (unread && !placeholders) continue;
        const tint = markerTint(item, unread);
        // A ring status — a tentative one — is an open ring in its tone; any other a filled dot.
        const ring = statusRing(item.status);
        const alpha = alphaOf(item.key);
        const x = wx(item.x), y = wy(item.y);
        batchDot(dotFills, ring ? surface : tint, 0, alpha, x, y);
        batchDot(dotRings, ring ? tint : surface, ring ? 2 : 1.5, alpha, x, y);
    }
    ctx.save();
    paintDots(ctx, dotFills, "fill");
    paintDots(ctx, dotRings, "stroke");
    ctx.restore();
    const marked = selected.size === 0 ? alone
        : [...alone.filter((item) => !selected.has(item.key)), ...alone.filter((item) => selected.has(item.key))];
    for (const item of marked) {
        const tier = tiers.get(item.key) ?? "dot";
        // Its status unread (#1398): its dot in the placeholders' fill once revealed, unseen before — never a status.
        const unread = statusUnread(item);
        const tint = markerTint(item, unread);
        const isSel = selected.has(item.key);
        const x = wx(item.x), y = wy(item.y);

        ctx.save();
        ctx.globalAlpha = alphaOf(item.key);
        const ring = statusRing(item.status);
        if (tier === "dot") {
            if (!unread || placeholders) {
                ctx.beginPath();
                ctx.arc(x, y, MARKER_DOT_RADIUS, 0, Math.PI * 2);
                // A ring status — a tentative one — is an open ring in its tone; any other a filled dot.
                ctx.fillStyle = ring ? surface : tint;
                ctx.fill();
                ctx.lineWidth = ring ? 2 : 1.5;
                ctx.strokeStyle = ring ? tint : surface;
                ctx.stroke();
            }
            if (isSel) {
                ctx.beginPath();
                ctx.arc(x, y, 7.5, 0, Math.PI * 2);
                ctx.lineWidth = 2;
                ctx.strokeStyle = css(p.fg);
                ctx.stroke();
            }
        } else {
            // labelled pin — bounds and words come from the SHARED markerHitbox so the
            // drawn pill and the click target are identical (issue #57, P11), a long
            // label cut before an ellipsis (#1393).
            ctx.font = p.labelFont;
            const box = markerHitbox(item, "label", cam, t => ctx.measureText(t).width);
            if (box.kind === "rect") {
                const { left, top, w, h, text } = box;
                ctx.beginPath();
                ctx.roundRect?.(left, top, w, h, h / 2);
                if (!ctx.roundRect) ctx.rect(left, top, w, h);
                ctx.fillStyle = surface;
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = isSel ? css(p.fg) : css(p.borderStrong);
                ctx.stroke();
                // Its dot on its item's point — its status unread, the placeholders' fill once revealed, unseen before.
                if (!unread || placeholders) {
                    ctx.beginPath();
                    ctx.arc(x, y, ring ? PIN_DOT_W / 2 - 0.75 : PIN_DOT_W / 2, 0, Math.PI * 2);
                    if (ring) {
                        ctx.lineWidth = 1.5;
                        ctx.strokeStyle = tint;
                        ctx.stroke();
                    } else {
                        ctx.fillStyle = tint;
                        ctx.fill();
                    }
                }
                ctx.fillStyle = wordsInk;
                ctx.textBaseline = "middle";
                ctx.fillText(text, left + PIN_PAD_X + PIN_DOT_W + PIN_GAP, y);
            }
        }
        ctx.restore();
        // The marker a card's drop lands on (#1390): a brand ring about it, wider than a selection's.
        if (dropOn === item.key) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(x, y, (tier === "label" ? 18 : 11) + 4, 0, Math.PI * 2);
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = css(p.brandSolid);
            ctx.stroke();
            ctx.restore();
        }
    }

    // ---- where a template's item or a backlog row lands (#1390) --------------
    // A ring at the drop point, over every marker: the item's centre once it lands.
    if (dropMark?.kind === "point") {
        const x = wx(dropMark.x), y = wy(dropMark.y);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = css(p.brandSolid);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = css(p.brandSolid);
        ctx.fill();
        ctx.restore();
    }
}
