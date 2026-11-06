/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Flowchart layout — pure geometry. No React imports.
 *
 * Implements the spec's link-geometry contract:
 * - H/V segments only — never diagonal, never bezier.
 * - Corners are quarter-arcs r 8; in tight channels r may shrink to 4,
 *   never to a sharp corner.
 * - ≥ 12px straight leaving a handle before the first corner, ≥ 12px
 *   between consecutive corners, ≥ 12px straight entry before the
 *   arrowhead.
 * - Parallel runs sit ≥ 16px apart (per-gap channel assignment).
 * - One fixed handle per side (centre of each edge). A link joins the
 *   CLOSEST FACING pair of handles on its two nodes — the router picks
 *   the nearest pair and routes H/V between them. Links converge at the
 *   handle; paths start and end at the 7px handle RING's edge so the
 *   fixed 12px arrowhead tip butts the ring, never past or before it.
 *   TD swaps the axes via a logical-space transpose (cards stay upright).
 * - Cards are as big as what they show (R22): 116 × 40, or — where the
 *   details draw on them — the card's width and each its own height. Left
 *   to right each row is as tall as its tallest card, its cards centred in
 *   it; top down the lanes are as tall as the tallest card. Two cards side
 *   by side keep room for the widest label between them (R24).
 * - A link's sides are chosen over a box of the card's width and 40,
 *   centred on its card, so they are today's whatever the card's height,
 *   and its route meets the card's own sides (R23). A route keeps its
 *   sides and never crosses a card: where its straight line would, it
 *   turns into the gutter between rows, or the gap beside a lane, and back.
 * - The decision diamond anchors to the midpoint of the longest straight
 *   segment; labels place collision-aware over their boxes (R32): today's
 *   places, then steps off each segment, and where none is clear, the
 *   place tried that covers least of the cards, then of the labels.
 */

import type { FlowchartModel, ModelLink } from "./model.js";

// ── Spec dimensional constants ─────────────────────────────────────────────
export const NODE_W = 116;
export const NODE_H = 40;
export const CORNER_R = 8;
export const CORNER_R_MIN = 4;
export const MIN_STRAIGHT = 12;
export const CHANNEL_GAP = 16;
export const LANE_MIN_W = 166;
export const LANE_HEADER_H = 40;
export const ROW_PITCH = 96;
export const CANVAS_PAD_BOTTOM = 48;
export const LANE_TAIL_W = 78;
/** Handle ring radius — paths stop at the ring edge. */
export const RING_R = 3.5;
/** A label's box height with one line: its evidence. */
export const BADGE_H = 18;

/** Between two rows, left to right: today's pitch past a card (§4). */
const ROW_GAP = ROW_PITCH - NODE_H;
/** Left to right, the least room between two lanes' cards: today's lane past its card (R24). */
const LANE_GAP = LANE_MIN_W - NODE_W;
/** Top down, the least room between two rows' cards: today's 168 pitch past the card (R24). */
const TD_ROW_GAP = 52;
/** Top down, the most that room widens to where the width allows: today's 260 pitch past the card (§4). */
const TD_ROW_GAP_MOST = 144;
/** Top down, a lane past its tallest card: today's 112 past the 40 (§4). */
const TD_LANE_GAP = 72;
/** Where the details draw on the cards, the room beside the widest label between two cards (R24). */
const LABEL_ROOM = 24;
/** A label's line past its first (§4). */
export const LABEL_LINE_H = 13;
/** A label's width a character, mono 10 (§4). */
const LABEL_CHAR_W = 5.8;
/** A label's padding across. */
const LABEL_PAD_W = 14;
/** The steps a label takes across a segment, off its middle, each way (§4): 22 to 112px, 18 apart. */
const LABEL_STEPS: readonly number[] = [22, -22, 40, -40, 58, -58, 76, -76, 94, -94, 112, -112];

export interface Pt { x: number; y: number }

export interface NodeRect {
    key: string;
    x: number; y: number; w: number; h: number;
    cx: number; cy: number;
    /** Fixed handle points (centre of each edge). */
    left: Pt; right: Pt; top: Pt; bottom: Pt;
}

export type HandleSide = "left" | "right" | "top" | "bottom";

/** One occupied connection point on a node border. */
export interface HandleInfo {
    side: HandleSide;
    pt: Pt;
    /** Keys of the links converging at this handle. */
    links: string[];
}

export interface RouteSeg { a: Pt; b: Pt }

export interface LinkRoute {
    key: string;
    /** SVG path data (H/V runs joined by quarter-arc corners), trimmed to
     * the handle-ring edges at both ends. */
    d: string;
    /** The in-handle the arrow terminates on (ring centre). */
    end: Pt;
    /** Straight segments (untrimmed; for anchors + hit testing). */
    segs: RouteSeg[];
    /** Midpoint of the longest straight run — diamond anchor. */
    mid: Pt;
    /** Handle-ring centres this route touches (out + in). */
    ports: [Pt, Pt];
    /** Its label's box, collision-resolved (R32); absent, it draws none. */
    label?: LabelPlace;
}

/** A transition label's size (§4): its evidence line and its details' lines. */
export interface LabelBox { readonly w: number; readonly h: number }

/** Where a transition's label stands: its box. */
export interface LabelPlace { x: number; y: number; w: number; h: number }

/** One row states stand in, along the stacking axis — LR's y, TD's x. */
export interface LayoutRow {
    /** Where it starts. */
    readonly start: number;
    /** How far it reaches: left to right, as tall as its tallest card; top down, the card's width. */
    readonly size: number;
}

export interface LaneBand {
    key: string;
    label: string;
    x: number; y: number; w: number; h: number;
    /** Alternating paper-2 tint per the spec. */
    tinted: boolean;
    /** Header anchor along the lane axis (LR: band centre x; TD: band top y). */
    cx: number;
}

export interface FlowchartLayout {
    width: number;
    height: number;
    orientation: "LR" | "TD";
    lanes: LaneBand[];
    nodes: Map<string, NodeRect>;
    routes: LinkRoute[];
    /** Occupied connection points per node (idle handles are hidden). */
    handles: Map<string, HandleInfo[]>;
    /** "+ STATE" ghost cell per lane — the exact grid cell one row below
     * that lane's last node (nothing shifts on commit). */
    laneGhosts: Map<string, { x: number; y: number; w: number; h: number }>;
    /** The dashed "+ LANE" affordance rect at the tail (full lane height,
     * 14px insets) — drawn where the flowchart edits (#1247). */
    laneTail: { x: number; y: number; w: number; h: number };
    /** The rows states stand in along the stacking axis — LR's y, TD's x —
     * then the row past the last, where a lane's "+ STATE" ghost stands after
     * its last state: each row's start and size. A dropped state lands in one
     * (#1249). */
    rows: readonly LayoutRow[];
    /** How far a row's cell reaches across its lane — left to right the card's
     * width, top down the tallest card's height: what a state standing there
     * takes. */
    cellAcross: number;
}

/** A row of the layout's, its index kept to the rows it holds. */
function rowOf(layout: FlowchartLayout, row: number): LayoutRow {
    return layout.rows[Math.min(Math.max(row, 0), layout.rows.length - 1)]!;
}

/**
 * The cell a state stands in, at a row of a lane's band: the row's span,
 * across the lane's cards — what a state drawn there, or dropped there
 * (#1249), takes.
 *
 * @param layout - The laid-out flow
 * @param lane - The lane's band
 * @param row - The row, from the band's first
 * @returns The cell, in the canvas's px
 */
export function rowCell(layout: FlowchartLayout, lane: LaneBand, row: number): { x: number; y: number; w: number; h: number } {
    const at = rowOf(layout, row);
    const across = layout.cellAcross;
    return layout.orientation === "TD"
        ? { x: at.start, y: lane.y + lane.h / 2 - across / 2, w: at.size, h: across }
        : { x: lane.x + lane.w / 2 - across / 2, y: at.start, w: across, h: at.size };
}

/**
 * Where the landing line runs for a state dropped at a row of a lane's band
 * (#1249): across the node's footprint, in the middle of the gap before that
 * row — the 16px under the lane's header before the first row, half the gap
 * between two rows before any other — between the state above it and the one
 * it lands before. Its thickness is the recipe's.
 *
 * @param layout - The laid-out flow
 * @param lane - The lane's band
 * @param row - The row the state lands in
 * @returns The line's start, and its length across the band — `w` in LR, `h` in TD; the other is 0
 */
export function landingSeam(layout: FlowchartLayout, lane: LaneBand, row: number): { x: number; y: number; w: number; h: number } {
    const cell = rowCell(layout, lane, row);
    const td = layout.orientation === "TD";
    // The gap before the row, along the stacking axis: under the header, or between two rows.
    const at = Math.min(Math.max(row, 0), layout.rows.length - 1);
    const before = at === 0 ? LANE_HEADER_H : layout.rows[at - 1]!.start + layout.rows[at - 1]!.size;
    const gap = layout.rows[at]!.start - before;
    return td ? { x: cell.x - gap / 2, y: cell.y, w: 0, h: cell.h } : { x: cell.x, y: cell.y - gap / 2, w: cell.w, h: 0 };
}

/** Rounds to half-pixels for crisp 1px strokes. */
const px = (v: number): number => Math.round(v * 2) / 2;

function nodeRect(x: number, y: number, w: number, h: number, key: string): NodeRect {
    const cx = x + w / 2, cy = y + h / 2;
    return {
        key, x, y, w, h, cx, cy,
        left: { x, y: cy }, right: { x: x + w, y: cy },
        top: { x: cx, y }, bottom: { x: cx, y: y + h },
    };
}

/**
 * Builds an H/V path with quarter-arc corners from an orthogonal point
 * run. Consecutive points must differ in exactly one axis. The corner
 * radius shrinks (to ≥ CORNER_R_MIN) when adjacent runs are short —
 * never to a sharp corner.
 */
export function roundedPath(points: Pt[]): { d: string; segs: RouteSeg[] } {
    if (points.length < 2) return { d: "", segs: [] };
    const segs: RouteSeg[] = [];
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!, b = points[i + 1]!;
        segs.push({ a, b });
    }
    const first = points[0]!;
    let d = `M${px(first.x)} ${px(first.y)}`;
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1]!, cur = points[i]!;
        const next = points[i + 1];
        if (next === undefined) {
            d += `L${px(cur.x)} ${px(cur.y)}`;
            break;
        }
        // Corner at `cur`: shrink r to fit both adjacent runs.
        const inLen = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
        const outLen = Math.abs(next.x - cur.x) + Math.abs(next.y - cur.y);
        const r = Math.max(CORNER_R_MIN, Math.min(CORNER_R, inLen / 2, outLen / 2));
        const inDx = Math.sign(cur.x - prev.x), inDy = Math.sign(cur.y - prev.y);
        const outDx = Math.sign(next.x - cur.x), outDy = Math.sign(next.y - cur.y);
        d += `L${px(cur.x - inDx * r)} ${px(cur.y - inDy * r)}`;
        d += `Q${px(cur.x)} ${px(cur.y)} ${px(cur.x + outDx * r)} ${px(cur.y + outDy * r)}`;
    }
    return { d, segs };
}

/** Trims the first and last runs by the handle-ring radius so the stroke
 * leaves from / the arrow tip butts into the ring edge. */
function trimToRings(points: Pt[]): Pt[] {
    if (points.length < 2) return points;
    const out = points.map(p => ({ ...p }));
    const a0 = out[0]!, a1 = out[1]!;
    a0.x += Math.sign(a1.x - a0.x) * RING_R;
    a0.y += Math.sign(a1.y - a0.y) * RING_R;
    const z0 = out[out.length - 1]!, z1 = out[out.length - 2]!;
    z0.x += Math.sign(z1.x - z0.x) * RING_R;
    z0.y += Math.sign(z1.y - z0.y) * RING_R;
    return out;
}

/** Midpoint of the longest straight run. */
export function longestRunMid(segs: readonly RouteSeg[]): Pt {
    let best: RouteSeg | undefined;
    let bestLen = -1;
    for (const s of segs) {
        const len = Math.abs(s.b.x - s.a.x) + Math.abs(s.b.y - s.a.y);
        if (len > bestLen) { bestLen = len; best = s; }
    }
    if (!best) return { x: 0, y: 0 };
    return { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
}


/** Outward normal per handle side. */
const NORMALS: Record<HandleSide, Pt> = {
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 },
};
const ALL_SIDES: readonly HandleSide[] = ["left", "right", "top", "bottom"];

/** Drops duplicate / colinear intermediate points from an orthogonal run. */
function collapsePts(pts: Pt[]): Pt[] {
    const out: Pt[] = [];
    for (const p of pts) {
        const n = out.length;
        if (n > 0 && out[n - 1]!.x === p.x && out[n - 1]!.y === p.y) continue;
        if (n > 1) {
            const q = out[n - 2]!, r = out[n - 1]!;
            if ((q.x === r.x && r.x === p.x) || (q.y === r.y && r.y === p.y)) { out[n - 1] = p; continue; }
        }
        out.push(p);
    }
    return out;
}

/** The CLOSEST FACING pair of handles between two node rects. */
export function selectPair(a: NodeRect, b: NodeRect): { sa: HandleSide; sb: HandleSide } {
    let best: { sa: HandleSide; sb: HandleSide; d: number } | undefined;
    for (const sa of ALL_SIDES) {
        for (const sb of ALL_SIDES) {
            const pa = a[sa], pb = b[sb];
            const nA = NORMALS[sa], nB = NORMALS[sb];
            const facesA = nA.x * (b.cx - pa.x) + nA.y * (b.cy - pa.y) > 0;
            const facesB = nB.x * (a.cx - pb.x) + nB.y * (a.cy - pb.y) > 0;
            if (!facesA || !facesB) continue;
            const d = Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
            if (best === undefined || d < best.d) best = { sa, sb, d };
        }
    }
    return best ?? { sa: "right", sb: "left" };
}

/** The orthogonal point run between a chosen handle pair (no channel
 * staggering — computeLayout overrides the mid run for that). */
export function pairPoints(a: NodeRect, b: NodeRect, sa: HandleSide, sb: HandleSide, mx?: number): Pt[] {
    const outP = a[sa], inP = b[sb];
    const n1 = NORMALS[sa], n2 = NORMALS[sb];
    let pts: Pt[];
    if (n1.x !== 0 && n2.x !== 0) {
        const m = mx ?? (outP.x + inP.x) / 2;
        pts = outP.y === inP.y ? [outP, inP] : [outP, { x: m, y: outP.y }, { x: m, y: inP.y }, inP];
    } else if (n1.y !== 0 && n2.y !== 0) {
        const my = (outP.y + inP.y) / 2;
        pts = outP.x === inP.x ? [outP, inP] : [outP, { x: outP.x, y: my }, { x: inP.x, y: my }, inP];
    } else if (n1.x !== 0) {
        pts = [outP, { x: inP.x, y: outP.y }, inP];
    } else {
        pts = [outP, { x: outP.x, y: inP.y }, inP];
    }
    return collapsePts(pts);
}

/** The box a link's sides are chosen over (R23): the card's width and today's
 * 40, centred on the card — so a tall card's sides are a short one's. */
function sideBox(r: NodeRect): NodeRect {
    return nodeRect(r.x, r.cy - NODE_H / 2, r.w, NODE_H, r.key);
}

/** Spec-compliant DRAG PREVIEW between two nodes — the exact H/V route
 * (r 8 corners, ring-trimmed) the committed link would take. */
export function previewLinkPath(a: NodeRect, b: NodeRect): string {
    const { sa, sb } = selectPair(sideBox(a), sideBox(b));
    return roundedPath(trimToRings(pairPoints(a, b, sa, sb))).d;
}

/**
 * A transition label's box (§4): 18 high, and 13 for each line past its
 * first; as wide as its longest line, 5.8 a character and 14.
 *
 * @param lines - Its lines: its evidence line, then its details' (R32)
 * @returns Its size
 */
export function labelBox(lines: readonly string[]): LabelBox {
    const longest = lines.reduce((n, line) => Math.max(n, line.length), 0);
    return { w: longest * LABEL_CHAR_W + LABEL_PAD_W, h: BADGE_H + LABEL_LINE_H * Math.max(0, lines.length - 1) };
}

/** Spec-compliant DRAG PREVIEW from a handle to a free cursor point —
 * an orthogonal Z/L run instead of a diagonal rubber band. */
export function previewCursorPath(a: NodeRect, side: HandleSide, c: Pt): string {
    const P1 = a[side];
    const n = NORMALS[side];
    let pts: Pt[];
    if (n.x !== 0) {
        const m = (P1.x + c.x) / 2;
        pts = Math.abs(c.y - P1.y) < 2 ? [P1, c] : [P1, { x: m, y: P1.y }, { x: m, y: c.y }, c];
    } else {
        const m = (P1.y + c.y) / 2;
        pts = Math.abs(c.x - P1.x) < 2 ? [P1, c] : [P1, { x: P1.x, y: m }, { x: c.x, y: m }, c];
    }
    pts = collapsePts(pts);
    // trim only the start to the ring edge; the free end rides the cursor
    if (pts.length >= 2) {
        const p0 = pts[0]!, p1 = pts[1]!;
        pts[0] = { x: p0.x + Math.sign(p1.x - p0.x) * RING_R, y: p0.y + Math.sign(p1.y - p0.y) * RING_R };
    }
    return roundedPath(pts).d;
}

/** A slot a link holds in the gap between two lanes, where a segment of it
 * goes along the gap. */
interface ChannelClaim {
    /** The gap: gap g lies between lanes g − 1 and g. */
    readonly gap: number;
    /** Its slot in the gap, from the first claim's. */
    slot: number;
}

/**
 * Gives each claim a slot of its own in its gap, in the order claimed, so
 * parallel segments sit ≥ 16px apart.
 *
 * @param claims - The claims, in order
 * @returns How many claims each gap holds
 */
function planChannels(claims: readonly ChannelClaim[]): Map<number, number> {
    const count = new Map<number, number>();
    for (const claim of claims) {
        claim.slot = count.get(claim.gap) ?? 0;
        count.set(claim.gap, claim.slot + 1);
    }
    return count;
}

/** A box on the canvas: a card's, a label's, or one a label keeps off. */
export interface Rect { x: number; y: number; w: number; h: number }

const intersects = (a: Rect, b: Rect, pad: number): boolean =>
    a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;

/** How much of one box another covers, in px². */
const overlapArea = (a: Rect, b: Rect): number =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Whether an H/V segment passes through a card's inside: along its edge is outside it. */
const runCrosses = (a: Pt, b: Pt, r: Rect): boolean =>
    Math.min(a.x, b.x) < r.x + r.w && Math.max(a.x, b.x) > r.x && Math.min(a.y, b.y) < r.y + r.h && Math.max(a.y, b.y) > r.y;

/** A straight segment's length. */
const runLength = (s: RouteSeg): number => Math.abs(s.b.x - s.a.x) + Math.abs(s.b.y - s.a.y);

/** Whether one tally is less than another, its first count first. */
function tallyLess(a: readonly number[], b: readonly number[]): boolean {
    for (let i = 0; i < a.length; i++) {
        if (a[i]! < b[i]!) return true;
        if (a[i]! > b[i]!) return false;
    }
    return false;
}

/**
 * Where a transition's label stands (R32): today's places — each segment,
 * longest first, at its middle, a third and two thirds, on a vertical segment
 * on the line and on a horizontal one above it — then the steps across each
 * segment off its middle, the longest first: the first clear of the cards,
 * the keep-outs and the labels placed. Where none is, the place tried that
 * covers least of the cards, then of the labels, then of the keep-outs.
 *
 * @param segs - The route's straight segments
 * @param size - The label's size
 * @param cards - The cards
 * @param keepOut - What else a label stays off: the lanes' headers, the handle rings and the diamonds
 * @param labels - The labels placed
 * @returns Its box
 */
export function placeLabel(segs: readonly RouteSeg[], size: LabelBox, cards: readonly Rect[], keepOut: readonly Rect[], labels: readonly Rect[]): LabelPlace {
    const boxAt = (c: Pt): LabelPlace => ({ x: c.x - size.w / 2, y: c.y - size.h / 2, w: size.w, h: size.h });
    const clear = (box: Rect): boolean => ![cards, keepOut, labels].some((of) => of.some((o) => intersects(box, o, 4)));
    const vertical = (s: RouteSeg): boolean => Math.abs(s.b.x - s.a.x) < Math.abs(s.b.y - s.a.y);
    const bySize = [...segs].sort((s1, s2) => runLength(s2) - runLength(s1));
    const tried: LabelPlace[] = [];
    for (const seg of bySize) {
        for (const t of [0.5, 0.32, 0.68]) {
            const cx = seg.a.x + (seg.b.x - seg.a.x) * t;
            const cy = seg.a.y + (seg.b.y - seg.a.y) * t;
            // Vertical segments carry the label ON the line; horizontal ones sit
            // it just above, so it doesn't sever the stroke.
            const box = boxAt(vertical(seg) ? { x: cx, y: cy } : { x: cx, y: cy - size.h / 2 - 4 });
            if (clear(box)) return box;
            tried.push(box);
        }
    }
    for (const seg of bySize) {
        const mid = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
        for (const off of LABEL_STEPS) {
            const box = boxAt(vertical(seg) ? { x: mid.x + off, y: mid.y } : { x: mid.x, y: mid.y + off });
            if (clear(box)) return box;
            tried.push(box);
        }
    }
    const cover = (box: Rect, of: readonly Rect[]): number => of.reduce((sum, o) => sum + overlapArea(box, o), 0);
    let best: LabelPlace | undefined;
    let least: readonly number[] = [];
    for (const box of tried) {
        const tally = [cover(box, cards), cover(box, labels), cover(box, keepOut)];
        if (best === undefined || tallyLess(tally, least)) {
            best = box;
            least = tally;
        }
    }
    return best ?? boxAt(longestRunMid(segs));
}

export interface LayoutOptions {
    /** Available width in px (the canvas grows beyond it if lanes need more). */
    width: number;
    orientation: "LR" | "TD";
    /** Extra bottom padding reserving space for the legend overlay. */
    legendPad?: number | undefined;
    /** Minimum canvas height — lanes stretch to fill a pinned frame body. */
    minHeight?: number | undefined;
    /** Each lane's width in px, where a phone's window of lanes sets it; left out, the lanes fill `width`. Left to right only. */
    laneWidth?: number | undefined;
    /**
     * The width of a phone's window that holds one lane, px, where the details
     * draw on the cards (R40, D24): each lane at least that wide, so no other
     * lane's card shows beside its own; a lane wider keeps its width, the
     * card's and the room for labels. Left to right only.
     */
    laneWindow?: number | undefined;
    /**
     * The cards, where the details draw on them (R22): their width, and each
     * one's height by its state's key — a key left out, a ghost's, is 40. Two
     * cards side by side then keep the widest label's width and 24 between
     * them (R24). Left out, every card is today's 116 × 40.
     */
    cards?: { readonly width: number; readonly heights: ReadonlyMap<string, number> } | undefined;
    /** Each label's size, by its transition's key (R32): a transition left out draws none. Left out, each transition with evidence draws its evidence line. */
    labels?: ReadonlyMap<string, LabelBox> | undefined;
}

/** How a route leaves its straight line where that line would cross a card, its sides kept. */
type Detour =
    /** Sides facing across lanes: out to the gap past its own lane, along the gutter between rows, down the gap before the far lane. */
    | { readonly kind: "gutter"; readonly claim: ChannelClaim; readonly at: number }
    /** Ends facing in one lane: into the gutter past its card, along the gap beside the lane, back in the gutter before the far card. */
    | { readonly kind: "side"; readonly claim: ChannelClaim; readonly from: number; readonly to: number }
    /** Ends facing across lanes: the segment between them along a gutter. */
    | { readonly kind: "across"; readonly at: number };

/** A link as routed: its cards, its sides, the slot it holds in the gap before its far lane, and its detour. */
interface Routed {
    readonly link: ModelLink;
    readonly a: NodeRect;
    readonly b: NodeRect;
    readonly sa: HandleSide;
    readonly sb: HandleSide;
    /** Its slot in the gap before its far lane, where it goes between lanes; there its sides facing across turn. */
    readonly far: ChannelClaim | undefined;
    /** Whether its sides face across lanes, and turn in that gap. */
    readonly turns: boolean;
    readonly detour: Detour | undefined;
}

/**
 * The layout's sizes, worked out before anything is placed: what
 * {@link computeLayout} draws at, and what {@link layoutExtent} says of it —
 * from one place, so the two never drift.
 */
interface Sizing {
    /** The card's width. */
    readonly cardW: number;
    /** A card's height, by its state's key. */
    readonly cardH: (key: string) => number;
    /** A card's logical extent along the lane axis, from its height. */
    readonly mainOf: (h: number) => number;
    /** A card's logical extent along the stacking axis, from its height. */
    readonly crossOf: (h: number) => number;
    /** Each label's size, by its transition's key: a transition left out draws none. */
    readonly labelSizes: ReadonlyMap<string, LabelBox>;
    /** The tallest card's height. */
    readonly tallestCard: number;
    readonly laneCount: number;
    readonly rowCount: number;
    /** The gap between two rows. */
    readonly rowGap: number;
    /** The rows, then the row past the last. */
    readonly rows: readonly LayoutRow[];
    /** A lane's width along the lane axis. */
    readonly laneW: number;
    /** The logical cross extent: LR's canvas height, TD's canvas width. */
    readonly crossExtent: number;
    /** The logical main extent: the lanes and the band row's tail. */
    readonly mainExtent: number;
    /** How far the bands reach along the stacking axis: left to right, under the legend too. */
    readonly bandExtent: number;
    /** The canvas's width. */
    readonly width: number;
    /** The canvas's height, the legend's room in it. */
    readonly height: number;
}

/**
 * The layout's sizes (see {@link Sizing}).
 *
 * @param model - The view model
 * @param opts - What the layout is computed for
 * @returns Its sizes
 */
function sizingOf(model: FlowchartModel, opts: LayoutOptions): Sizing {
    const td = opts.orientation === "TD";

    // ── Sizes: the cards' (R22) and the labels' (R32) ─────────────────────
    const cardW = opts.cards?.width ?? NODE_W;
    const cardH = (key: string): number => opts.cards?.heights.get(key) ?? NODE_H;
    // Logical extents: main along the lane axis, cross along the stacking one.
    const mainOf = (h: number): number => (td ? h : cardW);
    const crossOf = (h: number): number => (td ? cardW : h);
    const labelSizes = new Map<string, LabelBox>();
    for (const l of model.links) {
        const size = opts.labels !== undefined ? opts.labels.get(l.key) : l.badgeText === undefined ? undefined : labelBox([l.badgeText]);
        if (size !== undefined) labelSizes.set(l.key, size);
    }
    const widest = [...labelSizes.values()].reduce((n, s) => Math.max(n, s.w), 0);
    const tallestLabel = [...labelSizes.values()].reduce((n, s) => Math.max(n, s.h), BADGE_H);
    const tallestCard = model.nodes.reduce((n, node) => Math.max(n, cardH(node.key)), NODE_H);
    // Between two cards side by side: today's least, or — where the details draw on the cards — the widest label and 24 (R24).
    const room = (least: number): number => (opts.cards === undefined ? least : Math.max(least, Math.round(widest) + LABEL_ROOM));

    const laneCount = Math.max(model.lanes.length, 1);
    const rowCount = Math.max(1, ...model.nodes.map(n => n.laneOrder + 1));

    // ── Rows: left to right each as tall as its tallest card, 56 between them;
    // top down the card's width, the room R24 keeps between them, which — as
    // today — widens where the width allows ─────────────────────────────────
    let rowGap = td ? room(TD_ROW_GAP) : ROW_GAP;
    if (td) {
        const avail = opts.width - LANE_HEADER_H - 16 - CANVAS_PAD_BOTTOM;
        if (avail > rowCount * (cardW + rowGap)) rowGap = Math.min(Math.max(rowGap, TD_ROW_GAP_MOST), Math.floor(avail / rowCount) - cardW);
    }
    const rowSizes = Array.from({ length: rowCount + 1 }, () => crossOf(NODE_H));
    for (const n of model.nodes) rowSizes[n.laneOrder] = Math.max(rowSizes[n.laneOrder]!, crossOf(cardH(n.key)));
    const rows: LayoutRow[] = [];
    for (let i = 0, start = LANE_HEADER_H + 16; i <= rowCount; i++) {
        rows.push({ start, size: rowSizes[i]! });
        start += rowSizes[i]! + rowGap;
    }

    // ── Lanes: left to right the card's width and the room beside it, at
    // least today's 166, filling the width; top down the tallest card and 72,
    // and 26 for each line a label adds (§4) ───────────────────────────────
    // On a phone holding one lane, where the details draw on the cards, each lane at least the window's width (R40).
    const laneMin = td ? tallestCard + TD_LANE_GAP + 2 * (tallestLabel - BADGE_H) : Math.max(cardW + room(LANE_GAP), opts.laneWindow ?? 0);
    const laneSpan = td ? Number.POSITIVE_INFINITY : opts.width - LANE_TAIL_W;
    const laneW = opts.laneWidth ?? Math.max(laneMin, Number.isFinite(laneSpan) ? Math.floor(laneSpan / laneCount) : laneMin);
    // Logical cross extent (LR: canvas height; TD: canvas width).
    let crossExtent = rows[rowCount]!.start + CANVAS_PAD_BOTTOM;
    if (!td && opts.minHeight !== undefined) crossExtent = Math.max(crossExtent, opts.minHeight - (opts.legendPad ?? 0));
    if (td) crossExtent = Math.max(crossExtent, opts.width);
    const mainExtent = laneCount * laneW + LANE_TAIL_W;
    // Bands span the FULL component (in LR that includes the legend strip —
    // the legend floats over them, exactly as the spec sheet draws it).
    const bandExtent = crossExtent + (td ? 0 : (opts.legendPad ?? 0));
    return {
        cardW, cardH, mainOf, crossOf, labelSizes, tallestCard, laneCount, rowCount, rowGap, rows, laneW, crossExtent, mainExtent, bandExtent,
        width: td ? crossExtent : mainExtent,
        height: (td ? mainExtent : crossExtent) + (opts.legendPad ?? 0),
    };
}

/**
 * The layout's own size (R42): what {@link computeLayout} draws at with no
 * room to fill — no width for its lanes to stretch across or its rows to
 * widen into, and no height for its lanes to fill. A zoom's Fit scales it
 * into main.
 *
 * @param model - The view model
 * @param opts - What the layout is computed for, but the room it fills
 * @returns Its width and its height
 */
export function layoutExtent(model: FlowchartModel, opts: Omit<LayoutOptions, "width" | "minHeight">): { readonly width: number; readonly height: number } {
    const { width, height } = sizingOf(model, { ...opts, width: 0, minHeight: undefined });
    return { width, height };
}

/**
 * Computes the full layout. The algorithm works in LOGICAL space (lanes
 * along X, stacking along Y); for TD the finished geometry transposes
 * (the spec: "TD orientation swaps the axes") — logical right/bottom
 * out-handles become real bottom/right, cards stay upright.
 */
export function computeLayout(model: FlowchartModel, opts: LayoutOptions): FlowchartLayout {
    const td = opts.orientation === "TD";
    const tp = (p: Pt): Pt => (td ? { x: p.y, y: p.x } : p);
    const {
        cardW, cardH, mainOf, crossOf, labelSizes, tallestCard, laneCount, rowCount, rowGap, rows, laneW, crossExtent, mainExtent, bandExtent, width, height,
    } = sizingOf(model, opts);
    /** The middle of the gutter after a row: where a route passes between rows. */
    const gutterAfter = (row: number): number => rows[row]!.start + rows[row]!.size + rowGap / 2;

    const lanes: LaneBand[] = model.lanes.map((l, i) => {
        const a = tp({ x: i * laneW, y: 0 });
        const b = tp({ x: (i + 1) * laneW, y: bandExtent });
        return {
            key: l.key,
            label: l.label,
            x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
            w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
            tinted: i % 2 === 1,
            cx: i * laneW + laneW / 2,
        };
    });

    // Real node rects: each card its width and its own height, upright in both orientations.
    const nodes = new Map<string, NodeRect>();
    // Logical rects drive the router.
    const logicalNodes = new Map<string, NodeRect>();
    // The box each link's sides are chosen over (R23): the card's width and today's 40, centred on the card.
    const sideBoxes = new Map<string, NodeRect>();
    for (const n of model.nodes) {
        const h = cardH(n.key);
        const centre = Math.min(n.laneIndex, laneCount - 1) * laneW + laneW / 2;
        const row = rows[n.laneOrder]!;
        const middle = row.start + row.size / 2;
        logicalNodes.set(n.key, nodeRect(centre - mainOf(h) / 2, middle - crossOf(h) / 2, mainOf(h), crossOf(h), n.key));
        sideBoxes.set(n.key, nodeRect(centre - mainOf(NODE_H) / 2, middle - crossOf(NODE_H) / 2, mainOf(NODE_H), crossOf(NODE_H), n.key));
        const p = tp({ x: centre - mainOf(h) / 2, y: middle - crossOf(h) / 2 });
        nodes.set(n.key, nodeRect(p.x, p.y, cardW, h, n.key));
    }

    const realHeightHint = td ? mainExtent : crossExtent;
    // "+ STATE" ghost cells — one per lane, parked one row below the lane's
    // last node (or the first row when empty): the card's width and 40,
    // centred in that row's slot. It has no row, so no reads.
    const laneGhosts = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (let i = 0; i < model.lanes.length; i++) {
        const count = model.nodes.reduce((n, node) => (node.laneIndex === i ? Math.max(n, node.laneOrder + 1) : n), 0);
        const centre = i * laneW + laneW / 2;
        const slot = rows[Math.min(count, rowCount)]!;
        const p = tp({ x: centre - mainOf(NODE_H) / 2, y: slot.start + slot.size / 2 - crossOf(NODE_H) / 2 });
        laneGhosts.set(model.lanes[i]!.key, { x: p.x, y: p.y, w: cardW, h: NODE_H });
    }

    /** Maps a LOGICAL side to the REAL side after transpose. */
    const realSide = (side: HandleSide): HandleSide =>
        !td ? side : side === "left" ? "top" : side === "right" ? "bottom" : side === "top" ? "left" : "right";

    const handles = new Map<string, Map<HandleSide, string[]>>();
    const occupy = (nodeKey: string, logicalSide: HandleSide, linkKey: string): void => {
        let m = handles.get(nodeKey);
        if (m === undefined) { m = new Map(); handles.set(nodeKey, m); }
        const side = realSide(logicalSide);
        const arr = m.get(side) ?? [];
        arr.push(linkKey);
        m.set(side, arr);
    };

    // ── Routes ────────────────────────────────────────────────────────────
    /** Whether a path of points crosses a card other than its ends. */
    const crossesCard = (pts: readonly Pt[], a: NodeRect, b: NodeRect): boolean => {
        for (const rect of logicalNodes.values()) {
            if (rect === a || rect === b) continue;
            for (let i = 0; i < pts.length - 1; i++) if (runCrosses(pts[i]!, pts[i + 1]!, rect)) return true;
        }
        return false;
    };
    /** The gutters a detour may follow between two rows, nearest the first row first: between them, else either side of the one. */
    const guttersBetween = (from: number, to: number): number[] => {
        if (from < to) return Array.from({ length: to - from }, (_, i) => gutterAfter(from + i));
        if (from > to) return Array.from({ length: from - to }, (_, i) => gutterAfter(from - 1 - i));
        return from > 0 ? [gutterAfter(from), gutterAfter(from - 1)] : [gutterAfter(from)];
    };
    /** A gap's middle: the boundary of the lanes it lies between. */
    const gapX = (gap: number): number => gap * laneW;
    const gutterPts = (a: NodeRect, b: NodeRect, sa: HandleSide, sb: HandleSide, x1: number, x2: number, at: number): Pt[] => {
        const outP = a[sa], inP = b[sb];
        return collapsePts([outP, { x: x1, y: outP.y }, { x: x1, y: at }, { x: x2, y: at }, { x: x2, y: inP.y }, inP]);
    };
    const sidePts = (a: NodeRect, b: NodeRect, sa: HandleSide, sb: HandleSide, x: number, from: number, to: number): Pt[] => {
        const outP = a[sa], inP = b[sb];
        return collapsePts([outP, { x: outP.x, y: from }, { x, y: from }, { x, y: to }, { x: inP.x, y: to }, inP]);
    };
    const acrossPts = (a: NodeRect, b: NodeRect, sa: HandleSide, sb: HandleSide, at: number): Pt[] => {
        const outP = a[sa], inP = b[sb];
        return collapsePts([outP, { x: outP.x, y: at }, { x: inP.x, y: at }, inP]);
    };

    // Each link's sides over the boxes, and — where its straight line would cross a card — its detour.
    const routed: Routed[] = [];
    const detourClaims: ChannelClaim[] = [];
    for (const l of model.links) {
        const a = logicalNodes.get(l.from), b = logicalNodes.get(l.to);
        if (!a || !b) continue;
        const na = model.nodesByKey.get(l.from)!, nb = model.nodesByKey.get(l.to)!;
        // A link joins the CLOSEST FACING pair of handles on its two nodes
        // (spec: handles are direction-agnostic; the router picks the
        // nearest pair and routes H/V between them), chosen over the boxes.
        const { sa, sb } = selectPair(sideBoxes.get(l.from)!, sideBoxes.get(l.to)!);
        const across = (s: HandleSide): boolean => s === "left" || s === "right";
        // Every cross-lane link holds a slot in the gap before its far lane, as today.
        const farGap = na.laneIndex === nb.laneIndex ? undefined : na.laneIndex < nb.laneIndex ? nb.laneIndex : nb.laneIndex + 1;
        const far: ChannelClaim | undefined = farGap === undefined ? undefined : { gap: farGap, slot: 0 };
        // Facing-horizontal cross-lane segments turn in that slot, so parallels sit >= 16px apart.
        const turns = farGap !== undefined && sa !== sb && across(sa) && across(sb);
        const straight = pairPoints(a, b, sa, sb, turns ? gapX(farGap) : undefined);
        let detour: Detour | undefined;
        if (crossesCard(straight, a, b)) {
            if (turns) {
                const nearGap = na.laneIndex < nb.laneIndex ? na.laneIndex + 1 : na.laneIndex;
                const at = nearGap === farGap ? undefined
                    : guttersBetween(na.laneOrder, nb.laneOrder).find((g) => !crossesCard(gutterPts(a, b, sa, sb, gapX(nearGap), gapX(farGap), g), a, b));
                if (at !== undefined) detour = { kind: "gutter", claim: { gap: nearGap, slot: 0 }, at };
            } else if (!across(sa) && !across(sb) && sa !== sb && na.laneOrder !== nb.laneOrder) {
                const down = na.laneOrder < nb.laneOrder;
                if (farGap === undefined) {
                    // One lane: beside it, in the gap on its right — or on its left, the last lane's, before "+ LANE".
                    const lane = na.laneIndex;
                    const gap = lane + 1 < laneCount || lane === 0 ? lane + 1 : lane;
                    const from = down ? gutterAfter(na.laneOrder) : gutterAfter(na.laneOrder - 1);
                    const to = down ? gutterAfter(nb.laneOrder - 1) : gutterAfter(nb.laneOrder);
                    if (!crossesCard(sidePts(a, b, sa, sb, gapX(gap), from, to), a, b)) detour = { kind: "side", claim: { gap, slot: 0 }, from, to };
                } else {
                    const at = guttersBetween(na.laneOrder, nb.laneOrder).find((g) => !crossesCard(acrossPts(a, b, sa, sb, g), a, b));
                    if (at !== undefined) detour = { kind: "across", at };
                }
            }
        }
        if (detour !== undefined && detour.kind !== "across") detourClaims.push(detour.claim);
        routed.push({ link: l, a, b, sa, sb, far, turns, detour });
    }
    // The slots: each gap's cross-lane links in their order, as today, then its detours.
    const slots = planChannels([...routed.flatMap((r) => (r.far === undefined ? [] : [r.far])), ...detourClaims]);
    const channelX = (claim: ChannelClaim): number => {
        const spread = ((slots.get(claim.gap) ?? 1) - 1) * CHANNEL_GAP;
        return gapX(claim.gap) - spread / 2 + claim.slot * CHANNEL_GAP;
    };

    const routes: LinkRoute[] = [];
    for (const { link: l, a, b, sa, sb, far, turns, detour } of routed) {
        const mx = turns && far !== undefined ? channelX(far) : undefined;
        const pts = detour?.kind === "gutter" ? gutterPts(a, b, sa, sb, channelX(detour.claim), mx!, detour.at)
            : detour?.kind === "side" ? sidePts(a, b, sa, sb, channelX(detour.claim), detour.from, detour.to)
            : detour?.kind === "across" ? acrossPts(a, b, sa, sb, detour.at)
            : pairPoints(a, b, sa, sb, mx);
        occupy(l.from, sa, l.key);
        occupy(l.to, sb, l.key);
        const realPts = trimToRings(pts.map(tp));
        const { d } = roundedPath(realPts);
        // Anchor segs use the UNtrimmed run for stable midpoints.
        const segs: RouteSeg[] = [];
        const anchorPts = pts.map(tp);
        for (let i = 0; i < anchorPts.length - 1; i++) segs.push({ a: anchorPts[i]!, b: anchorPts[i + 1]! });
        routes.push({
            key: l.key,
            d,
            end: tp(b[sb]),
            segs,
            mid: longestRunMid(segs),
            ports: [tp(a[sa]), tp(b[sb])],
        });
    }

    // ── Occupied handle points (real coords, ring centres on the border) ──
    const handleInfos = new Map<string, HandleInfo[]>();
    for (const [nodeKey, sides] of handles) {
        const rect = nodes.get(nodeKey);
        if (!rect) continue;
        const infos: HandleInfo[] = [];
        for (const [side, links] of sides) {
            infos.push({ side, pt: rect[side], links });
        }
        handleInfos.set(nodeKey, infos);
    }

    // ── Collision-aware labels (R32) ──────────────────────────────────────
    const cards: Rect[] = [...nodes.values()].map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    // The lane-header strip is a keep-out (labels never overlap the lanes' names).
    const keepOut: Rect[] = [td ? { x: 0, y: 0, w: 108, h: realHeightHint } : { x: 0, y: 0, w: mainExtent, h: LANE_HEADER_H }];
    // Handle rings are keep-outs too.
    for (const infos of handleInfos.values()) {
        for (const h of infos) keepOut.push({ x: h.pt.x - 6, y: h.pt.y - 6, w: 12, h: 12 });
    }
    // Diamond keep-outs at the midpoint of every triggered link's longest segment: the diamond keeps the middle, its label beside it.
    const routeOf = new Map(routes.map((r) => [r.key, r] as const));
    for (const l of model.links) {
        const r = l.trigger === undefined ? undefined : routeOf.get(l.key);
        if (r) keepOut.push({ x: r.mid.x - 14, y: r.mid.y - 14, w: 28, h: 28 });
    }
    const placed: Rect[] = [];
    for (const l of model.links) {
        const size = labelSizes.get(l.key);
        const r = routeOf.get(l.key);
        if (size === undefined || r === undefined) continue;
        const box = placeLabel(r.segs, size, cards, keepOut, placed);
        r.label = box;
        placed.push(box);
    }

    // ── Tail affordance: full lane height, 14px insets (spec markup) ──────
    const tailA = tp({ x: laneCount * laneW + 8, y: 14 });
    const tailB = tp({ x: laneCount * laneW + LANE_TAIL_W - 8, y: bandExtent - 14 });

    return {
        width,
        height,
        orientation: opts.orientation,
        lanes,
        nodes,
        routes,
        handles: handleInfos,
        laneGhosts,
        laneTail: {
            x: Math.min(tailA.x, tailB.x),
            y: Math.min(tailA.y, tailB.y),
            w: Math.abs(tailB.x - tailA.x),
            h: Math.abs(tailB.y - tailA.y),
        },
        rows,
        cellAcross: td ? tallestCard : cardW,
    };
}
