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
 * - One fixed handle per side: in = left (cross-lane) / top (same-lane);
 *   out = right / bottom. Links converge at the handle; paths start and
 *   end at the 7px handle RING's edge so the fixed 6.5px arrowhead tip
 *   butts the ring, never past or before it. TD swaps the axes via a
 *   logical-space transpose (cards stay 116×40 upright).
 * - The decision diamond anchors to the midpoint of the longest straight
 *   run; evidence badges place collision-aware (longest fitting run,
 *   never over a node, a diamond, or another badge).
 */

import type { FlowchartModel, ModelLink, ModelNode } from "./model.js";

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
/** Evidence badge box height. */
export const BADGE_H = 18;

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
    /** Collision-resolved evidence badge centre (absent ⇒ no badge). */
    badge?: Pt;
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
    /** The dashed "+ LANE" affordance rect at the tail (full lane height,
     * 14px insets) — rendered only when the host provides onAddLane. */
    laneTail: { x: number; y: number; w: number; h: number };
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
export function longestRunMid(segs: RouteSeg[]): Pt {
    let best: RouteSeg | undefined;
    let bestLen = -1;
    for (const s of segs) {
        const len = Math.abs(s.b.x - s.a.x) + Math.abs(s.b.y - s.a.y);
        if (len > bestLen) { bestLen = len; best = s; }
    }
    if (!best) return { x: 0, y: 0 };
    return { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
}

interface ChannelPlan {
    order: Map<number, Map<string, number>>;
    count: Map<number, number>;
}

/** Assigns each cross-lane link a distinct channel slot in the lane gap
 * its vertical run occupies, so parallel runs sit ≥ 16px apart. */
function planChannels(links: readonly ModelLink[], nodeOf: (k: string) => ModelNode | undefined): ChannelPlan {
    const order = new Map<number, Map<string, number>>();
    const count = new Map<number, number>();
    for (const l of links) {
        const a = nodeOf(l.from), b = nodeOf(l.to);
        if (!a || !b || a.laneIndex === b.laneIndex) continue;
        const gap = a.laneIndex < b.laneIndex ? b.laneIndex : b.laneIndex + 1;
        let m = order.get(gap);
        if (m === undefined) { m = new Map(); order.set(gap, m); }
        m.set(l.key, m.size);
        count.set(gap, m.size);
    }
    return { order, count };
}

interface Rect { x: number; y: number; w: number; h: number }

const intersects = (a: Rect, b: Rect, pad: number): boolean =>
    a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;

export interface LayoutOptions {
    /** Available width in px (the canvas grows beyond it if lanes need more). */
    width: number;
    orientation: "LR" | "TD";
    /** Extra bottom padding reserving space for the legend overlay. */
    legendPad?: number | undefined;
    /** Minimum canvas height — lanes stretch to fill a pinned frame body. */
    minHeight?: number | undefined;
}

/**
 * Computes the full layout. The algorithm runs in LOGICAL space (lanes
 * along X, stacking along Y); for TD the finished geometry transposes
 * (the spec: "TD orientation swaps the axes") — logical right/bottom
 * out-handles become real bottom/right, cards stay 116×40 upright.
 */
export function computeLayout(model: FlowchartModel, opts: LayoutOptions): FlowchartLayout {
    const td = opts.orientation === "TD";
    // Logical node extents: main = along the lane axis, cross = stacking.
    const nodeMain = td ? NODE_H : NODE_W;
    const nodeCross = td ? NODE_W : NODE_H;
    const laneMin = td ? 112 : LANE_MIN_W;
    const tp = (p: Pt): Pt => (td ? { x: p.y, y: p.x } : p);

    const laneCount = Math.max(model.lanes.length, 1);
    const rows = Math.max(1, ...model.nodes.map(n => n.laneOrder + 1));

    // TD fills the available REAL width by spreading the stacking pitch;
    // LR fills the available REAL width by widening lanes.
    let pitch = td ? 168 : ROW_PITCH;
    if (td) {
        const avail = opts.width - LANE_HEADER_H - 16 - CANVAS_PAD_BOTTOM;
        if (avail > rows * pitch) pitch = Math.min(260, Math.floor(avail / rows));
    }
    const laneSpan = td ? Number.POSITIVE_INFINITY : opts.width - LANE_TAIL_W;
    const laneW = Math.max(laneMin, Number.isFinite(laneSpan) ? Math.floor(laneSpan / laneCount) : laneMin);
    // Logical cross extent (LR: canvas height; TD: canvas width).
    let crossExtent = LANE_HEADER_H + 16 + rows * pitch + CANVAS_PAD_BOTTOM;
    if (!td && opts.minHeight !== undefined) crossExtent = Math.max(crossExtent, opts.minHeight - (opts.legendPad ?? 0));
    if (td) crossExtent = Math.max(crossExtent, opts.width);
    const mainExtent = laneCount * laneW + LANE_TAIL_W;

    const lanes: LaneBand[] = model.lanes.map((l, i) => {
        const a = tp({ x: i * laneW, y: 0 });
        const b = tp({ x: (i + 1) * laneW, y: crossExtent });
        return {
            key: l.key,
            label: l.label,
            x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
            w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
            tinted: i % 2 === 1,
            cx: i * laneW + laneW / 2,
        };
    });

    // Real node rects (cards stay NODE_W × NODE_H in both orientations).
    const nodes = new Map<string, NodeRect>();
    // Logical rects drive the router.
    const logicalNodes = new Map<string, NodeRect>();
    for (const n of model.nodes) {
        const laneCentre = Math.min(n.laneIndex, laneCount - 1) * laneW + laneW / 2;
        const main = laneCentre - nodeMain / 2;
        const cross = LANE_HEADER_H + 16 + n.laneOrder * pitch;
        logicalNodes.set(n.key, nodeRect(main, cross, nodeMain, nodeCross, n.key));
        const p = tp({ x: main, y: cross });
        nodes.set(n.key, nodeRect(p.x, p.y, NODE_W, NODE_H, n.key));
    }

    const realHeightHint = td ? mainExtent : crossExtent;
    const chan = planChannels(model.links, k => model.nodesByKey.get(k));
    const channelX = (gap: number, slot: number): number => {
        const gapLeft = (gap - 1) * laneW + laneW / 2 + nodeMain / 2;
        const gapRight = gap * laneW + laneW / 2 - nodeMain / 2;
        const n = chan.count.get(gap) ?? 1;
        const spread = (n - 1) * CHANNEL_GAP;
        const centre = (gapLeft + gapRight) / 2;
        return centre - spread / 2 + slot * CHANNEL_GAP;
    };

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

    // Corridor rows for backward links — below all content, staggered.
    let backSlot = 0;

    const routes: LinkRoute[] = [];
    for (const l of model.links) {
        const a = logicalNodes.get(l.from), b = logicalNodes.get(l.to);
        if (!a || !b) continue;
        const na = model.nodesByKey.get(l.from)!, nb = model.nodesByKey.get(l.to)!;
        let pts: Pt[];
        let outP: Pt, inP: Pt;
        let outSide: HandleSide, inSide: HandleSide;
        if (na.laneIndex === nb.laneIndex) {
            if (a.bottom.y < b.top.y) {
                // Same-lane downward: out = bottom, in = top.
                outP = a.bottom; inP = b.top;
                outSide = "bottom"; inSide = "top";
                pts = outP.x === inP.x
                    ? [outP, inP]
                    : [outP,
                        { x: outP.x, y: (outP.y + inP.y) / 2 },
                        { x: inP.x, y: (outP.y + inP.y) / 2 },
                        inP];
            } else {
                // Same-lane upward: side channel, straight entry down.
                outP = a.bottom; inP = b.top;
                outSide = "bottom"; inSide = "top";
                const side = Math.min(a.x, b.x) - CHANNEL_GAP;
                pts = [
                    outP,
                    { x: outP.x, y: outP.y + MIN_STRAIGHT },
                    { x: side, y: outP.y + MIN_STRAIGHT },
                    { x: side, y: inP.y - MIN_STRAIGHT },
                    { x: inP.x, y: inP.y - MIN_STRAIGHT },
                    inP,
                ];
            }
        } else if (na.laneIndex < nb.laneIndex) {
            // Forward cross-lane: out = right, channel drop, in = left.
            outP = a.right; inP = b.left;
            outSide = "right"; inSide = "left";
            const slot = chan.order.get(nb.laneIndex)?.get(l.key) ?? 0;
            const mx = channelX(nb.laneIndex, slot);
            pts = outP.y === inP.y
                ? [outP, inP]
                : [outP, { x: mx, y: outP.y }, { x: mx, y: inP.y }, inP];
        } else {
            // Backward cross-lane: out = bottom, corridor below content,
            // rise in the gap before the target lane, in = left.
            outP = a.bottom; inP = b.left;
            outSide = "bottom"; inSide = "left";
            const corridorY = crossExtent - CANVAS_PAD_BOTTOM + 14 + (backSlot++ % 2) * CHANNEL_GAP;
            const slot = chan.order.get(nb.laneIndex + 1)?.get(l.key) ?? 0;
            const mx = channelX(nb.laneIndex + 1, slot);
            pts = [
                outP,
                { x: outP.x, y: corridorY },
                { x: mx, y: corridorY },
                { x: mx, y: inP.y },
                inP,
            ];
        }
        occupy(l.from, outSide, l.key);
        occupy(l.to, inSide, l.key);
        const realPts = trimToRings(pts.map(tp));
        const { d } = roundedPath(realPts);
        // Anchor segs use the UNtrimmed run for stable midpoints.
        const segs: RouteSeg[] = [];
        const anchorPts = pts.map(tp);
        for (let i = 0; i < anchorPts.length - 1; i++) segs.push({ a: anchorPts[i]!, b: anchorPts[i + 1]! });
        routes.push({
            key: l.key,
            d,
            end: tp(inP),
            segs,
            mid: longestRunMid(segs),
            ports: [tp(outP), tp(inP)],
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

    // ── Collision-aware evidence badges ───────────────────────────────────
    const badgeW = (text: string): number => text.length * 5.8 + 14;
    const obstacles: Rect[] = [...nodes.values()].map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
    // The lane-header strip is a keep-out (badges never overlap the labels).
    if (td) obstacles.push({ x: 0, y: 0, w: 108, h: realHeightHint });
    else obstacles.push({ x: 0, y: 0, w: mainExtent, h: LANE_HEADER_H });
    // Handle rings are keep-outs too.
    for (const infos of handleInfos.values()) {
        for (const h of infos) obstacles.push({ x: h.pt.x - 6, y: h.pt.y - 6, w: 12, h: 12 });
    }
    // Diamond keep-outs at every triggered link's longest-run midpoint.
    for (const l of model.links) {
        if (l.trigger === undefined) continue;
        const r = routes.find(x => x.key === l.key);
        if (r) obstacles.push({ x: r.mid.x - 14, y: r.mid.y - 14, w: 28, h: 28 });
    }
    for (const l of model.links) {
        if (l.badgeText === undefined) continue;
        const r = routes.find(x => x.key === l.key);
        if (!r) continue;
        const w = badgeW(l.badgeText);
        const bySize = [...r.segs].sort((s1, s2) =>
            (Math.abs(s2.b.x - s2.a.x) + Math.abs(s2.b.y - s2.a.y)) - (Math.abs(s1.b.x - s1.a.x) + Math.abs(s1.b.y - s1.a.y)));
        let placed: Pt | undefined;
        outer: for (const seg of bySize) {
            const vertical = Math.abs(seg.b.x - seg.a.x) < Math.abs(seg.b.y - seg.a.y);
            for (const t of [0.5, 0.32, 0.68]) {
                const cx = seg.a.x + (seg.b.x - seg.a.x) * t;
                const cy = seg.a.y + (seg.b.y - seg.a.y) * t;
                // Vertical runs carry the badge ON the line; horizontal runs
                // sit it just above so it doesn't sever the stroke visually.
                const c = vertical ? { x: cx, y: cy } : { x: cx, y: cy - BADGE_H / 2 - 4 };
                const rect: Rect = { x: c.x - w / 2, y: c.y - BADGE_H / 2, w, h: BADGE_H };
                if (obstacles.some(o => intersects(rect, o, 4))) continue;
                placed = c;
                break outer;
            }
        }
        if (placed === undefined) {
            // Fallback: push perpendicular from the longest-run midpoint
            // (both directions) until clear — never under a node or ring.
            const seg = bySize[0]!;
            const vertical = Math.abs(seg.b.x - seg.a.x) < Math.abs(seg.b.y - seg.a.y);
            fallback: for (const off of [22, -22, 40, -40, 58, -58, 76, -76, 94, -94, 112, -112]) {
                const c = vertical ? { x: r.mid.x + off, y: r.mid.y } : { x: r.mid.x, y: r.mid.y + off };
                const rect: Rect = { x: c.x - w / 2, y: c.y - BADGE_H / 2, w, h: BADGE_H };
                if (!obstacles.some(o => intersects(rect, o, 4))) { placed = c; break fallback; }
            }
            placed ??= { x: r.mid.x, y: r.mid.y + 26 };
        }
        r.badge = placed;
        obstacles.push({ x: placed.x - w / 2, y: placed.y - BADGE_H / 2, w, h: BADGE_H });
    }

    // ── Tail affordance: full lane height, 14px insets (spec markup) ──────
    const tailA = tp({ x: laneCount * laneW + 8, y: 14 });
    const tailB = tp({ x: laneCount * laneW + LANE_TAIL_W - 8, y: crossExtent - 14 });

    const realW = (td ? crossExtent : mainExtent);
    const realH = (td ? mainExtent : crossExtent) + (opts.legendPad ?? 0);

    return {
        width: realW,
        height: realH,
        orientation: opts.orientation,
        lanes,
        nodes,
        routes,
        handles: handleInfos,
        laneTail: {
            x: Math.min(tailA.x, tailB.x),
            y: Math.min(tailA.y, tailB.y),
            w: Math.abs(tailB.x - tailA.x),
            h: Math.abs(tailB.y - tailA.y),
        },
    };
}
