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
 * recipe: the design system's mono face.
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
 * reads them. The routes are pure here too (`linkRoutes`, `netRoutes`), so the
 * hit-tests and a selected link's handles take the routes the painter draws.
 *
 * @packageDocumentation
 */

import { match, type option, type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { arrive, paintLinks, traceHead, traceRoute, type CanvasEnd, type CanvasHead, type CanvasLink, type CanvasLinkLook } from "../../shared/links/canvas.js";
import { placeCaptions, type RibbonCaption } from "../../shared/links/captions.js";
import { LINK_CAPTION_DROP, LINK_CORNER } from "../../shared/links/look.js";
import type { SchematicDensity } from "../area.js";
import { type Bbox, type ScreenCamera, bboxOverlaps, pointsBbox, project, viewportWorldBbox } from "./camera";
import { type DrawnItem, type DrawnLink, type DrawnNet, type DrawnZone, type SchematicDrawn } from "./drawn";
import { SCHEMATIC_CARD_MAX_PX, tierSize } from "./model";

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
     * shaded in the brand's mark by how many rows each holds, over the zones and under every link and item.
     */
    density?: ReadonlyMap<string, SchematicDensity>;
}

/**
 * How strongly a density raster's cell shades (D25): by the square root of its
 * share of the fullest cell, so a sparse cell still shows, from a faint wash to
 * most of the mark's ink.
 *
 * @param count - The rows the cell holds
 * @param most - The rows the fullest cell holds
 * @returns Its fill's alpha, `0` for an empty cell
 */
export function densityAlpha(count: number, most: number): number {
    if (count <= 0 || most <= 0) return 0;
    return 0.12 + 0.6 * Math.sqrt(Math.min(1, count / most));
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

/** Drawn radius of a `dot`-tier marker, in screen px. */
export const MARKER_DOT_RADIUS = 5;
/** Hit radius of a `dot`-tier marker, in screen px — comfortably over the
 * drawn dot (5) and its selected ring (7.5) for touch slop (issue #57, P11). */
export const MARKER_DOT_HIT_RADIUS = 10;
const MARKER_PIN_PAD_X = 6, MARKER_PIN_DOT_W = 7, MARKER_PIN_GAP = 4, MARKER_PIN_H = 16;

/** The widest a labelled pin's words draw, in screen px: the pin at its widest ({@link SCHEMATIC_CARD_MAX_PX}), less its padding, its dot and the gap after it. */
const MARKER_PIN_TEXT_MAX = SCHEMATIC_CARD_MAX_PX - (MARKER_PIN_PAD_X + MARKER_PIN_DOT_W + MARKER_PIN_GAP + MARKER_PIN_PAD_X);

/** What a label is cut between: its graphemes, where the page segments them. */
const GRAPHEMES = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;

/** A label's graphemes — so a cut never splits an accented letter or a flag — or its code points where the page has no segmenter. */
const graphemesOf = (text: string): string[] => (GRAPHEMES === undefined ? Array.from(text) : Array.from(GRAPHEMES.segment(text), (part) => part.segment));

/**
 * The words a labelled pin draws, and their width (#1393): its item's whole
 * label, or — one wider than a pin's words draw at its widest — as much of it
 * as fits before an ellipsis, cut between graphemes, a space before the cut
 * dropped. A longer cut is never narrower, so the longest that fits is found
 * by halving.
 *
 * @param label - The item's label
 * @param measure - A string's width in px, in the pins' font
 * @returns The words, and their width in px
 */
function pinWords(label: string, measure: (text: string) => number): { readonly text: string; readonly width: number } {
    const whole = measure(label);
    if (whole <= MARKER_PIN_TEXT_MAX) return { text: label, width: whole };
    const parts = graphemesOf(label);
    const cut = (n: number): string => `${parts.slice(0, n).join("").trimEnd()}…`;
    let lo = 0, hi = parts.length - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measure(cut(mid)) <= MARKER_PIN_TEXT_MAX) lo = mid;
        else hi = mid - 1;
    }
    const text = cut(lo);
    return { text, width: measure(text) };
}

/** The screen-space hitbox of a non-card LOD marker — a circle for a `dot`, the
 * rounded-pill rect for a `label`, with the words it draws. */
export type MarkerHitbox =
    | { kind: "circle"; cx: number; cy: number; r: number }
    | { kind: "rect"; left: number; top: number; w: number; h: number; text: string };

/**
 * The screen-space hitbox of an item's LOD marker at `tier`. The single source
 * of truth used by **both** {@link paintSchematic} (to draw the pill) and the
 * React layer's pick (to hit-test), so the clickable area always equals the
 * drawn area and the two cannot silently drift (issue #57, P11). A `dot` is a
 * circle of {@link MARKER_DOT_HIT_RADIUS}; a `label` is the rounded pill whose
 * width is `pad + dot + gap + textWidth + pad`, no wider than
 * {@link SCHEMATIC_CARD_MAX_PX} — its words the label, or as much of it as fits
 * before an ellipsis (#1393), each measured by `measure` (the caller sets the
 * context font to the palette's `labelFont` first).
 *
 * @param item - the item's world anchor and label
 * @param tier - the LOD tier (`dot` or `label`; `card` markers are DOM)
 * @param cam - the screen camera
 * @param measure - measures a string's width in px under the pin font
 * @returns the marker's screen-space hitbox, and a pill's words
 */
export function markerHitbox(
    item: { x: number; y: number; label: string },
    tier: "dot" | "label",
    cam: ScreenCamera,
    measure: (text: string) => number,
): MarkerHitbox {
    const { sx, sy } = project(item.x, item.y, cam);
    if (tier === "dot") return { kind: "circle", cx: sx, cy: sy, r: MARKER_DOT_HIT_RADIUS };
    const words = pinWords(item.label, measure);
    const w = MARKER_PIN_PAD_X + MARKER_PIN_DOT_W + MARKER_PIN_GAP + words.width + MARKER_PIN_PAD_X;
    return { kind: "rect", left: sx - w / 2, top: sy - MARKER_PIN_H / 2, w, h: MARKER_PIN_H, text: words.text };
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

/** Net (bus / trunk) geometry, world space — shared verbatim by the
 *  painter and the hit-test so the clickable shape equals the drawn one. */
/** The leg a net's stub draws: the side it is on, and its member's place in that side. */
export interface NetStubLeg {
    end: "source" | "destination";
    index: number;
}

export interface NetGeometry {
    /** Trunk polyline: source anchor → via… → destination anchor. */
    trunk: Pt[];
    bars: Array<[Pt, Pt]>;
    stubs: Pt[][];
    /**
     * Each stub's leg, in the stubs' order (#1388): a side with one member —
     * or its members at one point — draws no stub, so a stub's place among the
     * stubs alone doesn't name its leg.
     */
    legs: NetStubLeg[];
    taps: Pt[];
}

/** Resolve one endpoint group to a header BAR + stubs (the bus-bar
 *  convention of a one-line diagram), or a bare anchor when the group is a
 *  single point.
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
        legs: [
            ...src.stubs.map((_, index): NetStubLeg => ({ end: "source", index })),
            ...dst.stubs.map((_, index): NetStubLeg => ({ end: "destination", index })),
        ],
        taps: [...src.taps, ...dst.taps],
    };
}

// ---- The links' routes on the screen (#1403) ----------------------------------------------------------------

/** Where an item draws at the zoom, in the canvas's px — a card's box, a labelled pin's, a dot's circle: what a link's end meets. */
export type EndShape = CanvasEnd;

/**
 * Where an item draws at the zoom, in the canvas's px (#1403): its card's box,
 * its labelled pin's — the box a tap meets it in ({@link markerHitbox}) — or
 * its dot's circle. A card's box is its card's size as the page lays it out,
 * or, unmeasured, the size the declutter reckons it at (`tierSize`).
 *
 * @param item - The item, where it draws
 * @param tier - What it draws as at the zoom
 * @param cam - The screen camera
 * @param measure - A label's width in px, in the pins' font
 * @param card - Its card's size as the page lays it out; `undefined`, unmeasured
 * @returns Its shape
 */
export function endShape(item: DrawnItem, tier: LodTier, cam: ScreenCamera, measure: (text: string) => number, card: { readonly w: number; readonly h: number } | undefined): EndShape {
    const { sx, sy } = project(item.x, item.y, cam);
    if (tier === "dot") return { kind: "circle", x: sx, y: sy, r: MARKER_DOT_RADIUS };
    if (tier === "label") {
        const pin = markerHitbox(item, "label", cam, measure);
        if (pin.kind === "rect") return { kind: "box", left: pin.left, top: pin.top, right: pin.left + pin.w, bottom: pin.top + pin.h };
    }
    const size = card ?? tierSize(item, "card", cam.ppu);
    return { kind: "box", left: sx - size.w / 2, top: sy - size.h / 2, right: sx + size.w / 2, bottom: sy + size.h / 2 };
}

/** Whether a point lies in a shape, its edge among it. */
function inShape(shape: EndShape, p: Pt): boolean {
    return shape.kind === "circle"
        ? Math.hypot(p.x - shape.x, p.y - shape.y) <= shape.r
        : p.x >= shape.left && p.x <= shape.right && p.y >= shape.top && p.y <= shape.bottom;
}

/** Where a segment from a point in a shape to one out of it leaves the shape: the last of it the shape holds. */
function leavesAt(shape: EndShape, a: Pt, b: Pt): Pt {
    const dx = b.x - a.x, dy = b.y - a.y;
    let t: number;
    if (shape.kind === "circle") {
        const fx = a.x - shape.x, fy = a.y - shape.y;
        const qa = dx * dx + dy * dy, qb = 2 * (fx * dx + fy * dy), qc = fx * fx + fy * fy - shape.r * shape.r;
        t = qa > 0 ? (-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa) : 0;
    } else {
        const tx = dx > 0 ? (shape.right - a.x) / dx : dx < 0 ? (shape.left - a.x) / dx : Infinity;
        const ty = dy > 0 ? (shape.bottom - a.y) / dy : dy < 0 ? (shape.top - a.y) / dy : Infinity;
        t = Math.min(tx, ty);
    }
    const at = Math.max(0, Math.min(1, t));
    return { x: a.x + dx * at, y: a.y + dy * at };
}

/**
 * A route leaving its source where the source draws (#1403): from the point
 * its line first leaves the source's shape, every point before it dropped. A
 * route that starts outside the shape stands as it is; one the shape holds
 * whole is no route.
 *
 * @param points - The route, from inside the source
 * @param shape - The source's shape
 * @returns The route from the shape's edge
 */
export function leaveShape(points: readonly Pt[], shape: EndShape): Pt[] {
    const first = points[0];
    if (first === undefined || !inShape(shape, first)) return [...points];
    for (let i = 0; i < points.length - 1; i++) {
        if (inShape(shape, points[i + 1]!)) continue;
        return [leavesAt(shape, points[i]!, points[i + 1]!), ...points.slice(i + 1)];
    }
    return [];
}

/**
 * A route meeting its destination where the destination draws (#1403): to the
 * point its line first meets the destination's shape, every point after it
 * dropped — {@link leaveShape} walked from the far end.
 *
 * @param points - The route, into the destination
 * @param shape - The destination's shape
 * @returns The route to the shape's edge
 */
export function meetShape(points: readonly Pt[], shape: EndShape): Pt[] {
    return leaveShape([...points].reverse(), shape).reverse();
}

/** A link's or a net's weight: its style's, else a solid run's 2.5 and a dashed one's 1.5. */
export function edgeWeight(style: DrawnLink["style"]): number {
    return getSomeorUndefined(style.value.weight) ?? (style.type === "solid" ? 2.5 : 1.5);
}

/** A caption's text: a link's label and its metric (`uplink · 100G`), either alone, or none. */
export function captionText(label: string | undefined, metric: string | undefined): string | undefined {
    return label !== undefined && metric !== undefined ? `${label} · ${metric}` : label ?? metric;
}

/** One run of a link's or a net's drawing, in the canvas's px. */
export interface EdgeRun {
    /** Its route, from where it leaves to where it arrives — its head's tip, where it has one: what the pointer meets. */
    readonly route: readonly Pt[];
    /** What its line draws: its route, to its head's base where it has one. */
    readonly line: readonly Pt[];
    /** Its head, where it arrives at an item. */
    readonly head: CanvasHead | undefined;
    /** Its weight (px). */
    readonly width: number;
    /** The radius its corners turn at, before their clamp. */
    readonly corner: number;
    /** The net's leg it is — its side and its member — or `undefined`: a link's line, a trunk, a bar. */
    readonly leg: { readonly end: "source" | "destination"; readonly item: string } | undefined;
}

/** What a link or a net draws, in the canvas's px, before its look (#1403). */
export interface EdgeGeometry {
    /** Its runs: a link's line; a net's trunk, its bars and its legs. */
    readonly runs: readonly EdgeRun[];
    /** Where a net's legs join its bars: its junction dots. */
    readonly dots: readonly { readonly x: number; readonly y: number; readonly r: number }[];
    /** The shapes of the items it joins: what its rings go round while it is lit or selected. */
    readonly ends: readonly EndShape[];
    /** A link's ends where its line leaves its source and meets its destination — where its handles stand; none for a net. */
    readonly handles: { readonly from: Pt; readonly to: Pt } | undefined;
    /** Its route's middle — a net's trunk's — where its caption centres; `undefined` with no route to draw. */
    readonly middle: Pt | undefined;
}

/** What a link's or a net's routes are worked out over: the camera, the items' centres and shapes, and the links' lanes. */
export interface RouteEnv {
    /** The screen camera. */
    readonly cam: ScreenCamera;
    /** Each item's centre drawn, in world units, by its id. */
    readonly centers: ReadonlyMap<string, Pt>;
    /** Each item's shape on the screen, by its id; `undefined` for one not drawn. */
    readonly shapeOf: (id: string) => EndShape | undefined;
    /** The links' lanes, by their ids (`parallelLanes`). */
    readonly lanes: ReadonlyMap<string, { i: number; n: number }>;
}

/**
 * What a link's or a net's routes are worked out over, each item's shape
 * worked out once, as it is asked.
 *
 * @param input - The camera, each item drawn and its centre, what each draws as, its card's size, the lanes and a label's width
 * @returns The routes' environment
 */
export function routeEnv(input: {
    readonly cam: ScreenCamera;
    readonly centers: ReadonlyMap<string, Pt>;
    readonly items: ReadonlyMap<string, DrawnItem>;
    readonly tiers: ReadonlyMap<string, LodTier>;
    readonly cardSizes: ReadonlyMap<string, { readonly w: number; readonly h: number }> | undefined;
    readonly lanes: ReadonlyMap<string, { i: number; n: number }>;
    readonly measure: (text: string) => number;
}): RouteEnv {
    const shapes = new Map<string, EndShape | undefined>();
    return {
        cam: input.cam, centers: input.centers, lanes: input.lanes,
        shapeOf: (id) => {
            if (shapes.has(id)) return shapes.get(id);
            const item = input.items.get(id);
            const shape = item === undefined || !input.centers.has(id) ? undefined
                : endShape(item, input.tiers.get(id) ?? "dot", input.cam, input.measure, input.cardSizes?.get(id));
            shapes.set(id, shape);
            return shape;
        },
    };
}

/**
 * A link's drawing on the screen (#1403): routed from its source's centre to
 * its destination's — orthogonal or direct, through its bends, translated
 * rigidly onto its lane — then from where its line leaves its source's shape to
 * where it meets its destination's, its head there.
 *
 * @param link - The link
 * @param env - What its routes are worked out over
 * @returns Its drawing; `undefined` while an item it joins is drawn nowhere
 */
export function linkRoutes(link: DrawnLink, env: RouteEnv): EdgeGeometry | undefined {
    const from = env.centers.get(link.from), to = env.centers.get(link.to);
    if (from === undefined || to === undefined) return undefined;
    const { cam } = env;
    const anchors = [from, ...link.via, to].map((q) => ({ x: q.x * cam.ppu + cam.tx, y: q.y * cam.ppu + cam.ty }));
    // Its fan lane (#180): the whole routed line translated along the pair's perpendicular, so its lanes stay parallel
    // through its elbows and fan at its ends.
    const lane = env.lanes.get(link.key);
    if (lane !== undefined) {
        const a0 = anchors[0]!, a1 = anchors[anchors.length - 1]!;
        const len = Math.hypot(a1.x - a0.x, a1.y - a0.y);
        if (len > 1e-6) {
            const d = (lane.i - (lane.n - 1) / 2) * LINK_LANE_GAP;
            const ox = -(a1.y - a0.y) / len * d, oy = (a1.x - a0.x) / len * d;
            for (const q of anchors) { q.x += ox; q.y += oy; }
        }
    }
    const orthogonal = link.route.type === "orthogonal";
    const corner = link.route.type === "orthogonal" ? getSomeorUndefined(link.route.value.corner) ?? LINK_CORNER : 0;
    const width = edgeWeight(link.style);
    const fromShape = env.shapeOf(link.from), toShape = env.shapeOf(link.to);
    const routed = orthogonal ? orthogonalize(anchors) : anchors;
    const left = fromShape === undefined ? routed : leaveShape(routed, fromShape);
    const route = toShape === undefined ? left : meetShape(left, toShape);
    const ends = [fromShape, toShape].filter((shape): shape is EndShape => shape !== undefined);
    const arrived = arrive(route, width);
    if (arrived === undefined) return { runs: [], dots: [], ends, handles: undefined, middle: undefined };
    return {
        runs: [{ route, line: arrived.line, head: arrived.head, width, corner, leg: undefined }],
        dots: [], ends,
        handles: { from: route[0]!, to: route[route.length - 1]! },
        middle: polylineMidpoint(route),
    };
}

/**
 * A net's drawing on the screen (#1403): its bus (`netGeometry`) — its trunk,
 * a bar across each side of several members, a leg from each of them — its
 * trunk leaving a lone source where it draws and meeting a lone destination so,
 * its head there; each source's leg leaving its member's shape, and each
 * destination's meeting it, its head there. Its trunk and its bars carry no
 * head; its junctions are dots.
 *
 * @param net - The net
 * @param env - What its routes are worked out over
 * @returns Its drawing; `undefined` while a side has no member drawn
 */
export function netRoutes(net: DrawnNet, env: RouteEnv): EdgeGeometry | undefined {
    const sources = net.sources.filter((k) => env.centers.has(k));
    const destinations = net.destinations.filter((k) => env.centers.has(k));
    if (sources.length === 0 || destinations.length === 0) return undefined;
    const geo = netGeometry(sources.map((k) => env.centers.get(k)!), destinations.map((k) => env.centers.get(k)!), net.via);
    const { cam } = env;
    const toScreen = (q: Pt): Pt => ({ x: q.x * cam.ppu + cam.tx, y: q.y * cam.ppu + cam.ty });
    const orthogonal = net.route.type === "orthogonal";
    const routed = (world: readonly Pt[]): Pt[] => { const screen = world.map(toScreen); return orthogonal ? orthogonalize(screen) : screen; };
    const corner = net.route.type === "orthogonal" ? getSomeorUndefined(net.route.value.corner) ?? LINK_CORNER : 0;
    const weight = edgeWeight(net.style);
    const runs: EdgeRun[] = [];
    // A side whose members draw no leg is a lone member — or members at one point — which the trunk itself joins.
    const loneSource = !geo.legs.some((leg) => leg.end === "source");
    const loneDestination = !geo.legs.some((leg) => leg.end === "destination");
    const sourceShape = loneSource ? env.shapeOf(sources[0]!) : undefined;
    const destinationShape = loneDestination ? env.shapeOf(destinations[0]!) : undefined;
    let trunk = routed(geo.trunk);
    if (sourceShape !== undefined) trunk = leaveShape(trunk, sourceShape);
    if (destinationShape !== undefined) trunk = meetShape(trunk, destinationShape);
    // The trunk and the bars carry the trunk's weight; the legs are a step lighter.
    const arrivedTrunk = loneDestination ? arrive(trunk, weight + 1) : undefined;
    if (trunk.length >= 2) runs.push({ route: trunk, line: arrivedTrunk?.line ?? trunk, head: arrivedTrunk?.head, width: weight + 1, corner, leg: undefined });
    for (const bar of geo.bars) {
        const line = bar.map(toScreen);
        runs.push({ route: line, line, head: undefined, width: weight + 1, corner: 0, leg: undefined });
    }
    for (const [i, stub] of geo.stubs.entries()) {
        const leg = geo.legs[i]!;
        const member = leg.end === "source" ? sources[leg.index]! : destinations[leg.index]!;
        const shape = env.shapeOf(member);
        if (leg.end === "source") {
            const route = shape === undefined ? routed(stub) : leaveShape(routed(stub), shape);
            if (route.length >= 2) runs.push({ route, line: route, head: undefined, width: weight, corner, leg: { end: "source", item: member } });
            continue;
        }
        // A destination's leg runs from its bar to its member, and arrives there.
        const toward = routed([stub[stub.length - 1]!, stub[0]!]);
        const route = shape === undefined ? toward : meetShape(toward, shape);
        const arrived = arrive(route, weight);
        if (arrived !== undefined) runs.push({ route, line: arrived.line, head: arrived.head, width: weight, corner, leg: { end: "destination", item: member } });
    }
    return {
        runs,
        dots: geo.taps.map((q) => ({ ...toScreen(q), r: weight + 1.5 })),
        ends: [...sources, ...destinations].flatMap((k) => { const shape = env.shapeOf(k); return shape === undefined ? [] : [shape]; }),
        handles: undefined,
        middle: trunk.length >= 2 ? polylineMidpoint(trunk) : undefined,
    };
}

/** Draw the schematic's bulk-shape layer for one frame. Clears first. */
export function paintSchematic(input: PaintInput): void {
    const { ctx, value, cam, width, height, visibleItems, tiers, selected, selectedZones, centers, palette: p, tints, effect, layerHiddenKeys, layerAlpha, draftLink, session, connectFlash, selectedLink, dropMark } = input;
    // An entity's colour by its id, as the bridge resolved it; else its kind's ground.
    const tintOf = (key: string, ground: RGB): string => css(tints.get(key) ?? ground);
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

    // ---- the density at overview (#1393, D25): each kind's raster, over the zones -------
    // Each cell holding rows a square of the brand's mark, shaded by how many it holds; a cell off screen is culled.
    for (const raster of input.density?.values() ?? []) {
        const side = raster.side * ppu;
        ctx.save();
        ctx.fillStyle = css(p.brandMark);
        for (const cell of raster.cells) {
            const x = wx(cell.minX), y = wy(cell.minY);
            if (x > width || y > height || x + side < 0 || y + side < 0) continue;
            ctx.globalAlpha = densityAlpha(cell.count, raster.most);
            ctx.fillRect(x, y, side, side);
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
    // strong ink; a retarget's link its `was` line while its end is dragged.
    const look = p.links;
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
        // Its colour token, else its tone, else its status's — the colour its card's dot is.
        let tint = tintOf(item.key, p.fgMuted);
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
    // Save/restore per item so a marker drawn as context fades / desaturates
    // without leaking alpha or font state into the next marker.
    for (const item of visibleItems) {
        const tier = tiers.get(item.key) ?? "dot";
        if (tier === "card") continue; // rich card rendered by the React layer
        let tint = tintOf(item.key, p.fgMuted);
        if (desatOf(item.key)) tint = css(p.fgMuted);
        const isSel = selected.has(item.key);
        const x = wx(item.x), y = wy(item.y);

        ctx.save();
        ctx.globalAlpha = alphaOf(item.key);
        const ring = statusRing(item.status);
        if (tier === "dot") {
            ctx.beginPath();
            ctx.arc(x, y, MARKER_DOT_RADIUS, 0, Math.PI * 2);
            // A ring status — a tentative one — is an open ring in its tone; any other a filled dot.
            ctx.fillStyle = ring ? css(p.bgSurface) : tint;
            ctx.fill();
            ctx.lineWidth = ring ? 2 : 1.5;
            ctx.strokeStyle = ring ? tint : css(p.bgSurface);
            ctx.stroke();
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
                ctx.fillStyle = css(p.bgSurface);
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = isSel ? css(p.fg) : css(p.borderStrong);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(left + MARKER_PIN_PAD_X + MARKER_PIN_DOT_W / 2, y, ring ? MARKER_PIN_DOT_W / 2 - 0.75 : MARKER_PIN_DOT_W / 2, 0, Math.PI * 2);
                if (ring) {
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = tint;
                    ctx.stroke();
                } else {
                    ctx.fillStyle = tint;
                    ctx.fill();
                }
                ctx.fillStyle = css(p.fg);
                ctx.textBaseline = "middle";
                ctx.fillText(text, left + MARKER_PIN_PAD_X + MARKER_PIN_DOT_W + MARKER_PIN_GAP, y);
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
