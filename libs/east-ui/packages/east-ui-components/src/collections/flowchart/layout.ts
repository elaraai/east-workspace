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
 *   out = right / bottom. Links converge at the handle; arrowheads always
 *   terminate on a handle. TD orientation swaps the axes via transpose.
 * - The decision diamond and volume badge anchor to the midpoint of the
 *   longest straight run, never within 12px of a corner.
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

export interface Pt { x: number; y: number }

export interface NodeRect {
    key: string;
    x: number; y: number; w: number; h: number;
    cx: number; cy: number;
    /** Fixed handle points (centre of each edge). */
    left: Pt; right: Pt; top: Pt; bottom: Pt;
}

export interface RouteSeg { a: Pt; b: Pt }

export interface LinkRoute {
    key: string;
    /** SVG path data (H/V runs joined by quarter-arc corners). */
    d: string;
    /** The in-handle the arrow terminates on. */
    end: Pt;
    /** Straight segments (for midpoint anchors + hit testing). */
    segs: RouteSeg[];
    /** Midpoint of the longest straight run — diamond / badge anchor. */
    mid: Pt;
    /** Handle points this route touches (out + in). */
    ports: [Pt, Pt];
}

export interface LaneBand {
    key: string;
    label: string;
    x: number; y: number; w: number; h: number;
    /** Alternating paper-2 tint per the spec. */
    tinted: boolean;
    cx: number;
}

export interface FlowchartLayout {
    width: number;
    height: number;
    orientation: "LR" | "TD";
    lanes: LaneBand[];
    nodes: Map<string, NodeRect>;
    routes: LinkRoute[];
    /** The dashed "+ LANE" affordance rect at the tail. */
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

/** Midpoint of the longest straight run (its centre is always ≥ 12px from
 * both corners when the run honours the min-straight rule). */
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
    /** lane-gap index → link key → slot (for the ≥16px x-stagger). */
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
        // Forward: the drop lives in the gap before the target lane.
        // Backward: the rise lives in the gap before the target lane too.
        const gap = Math.max(a.laneIndex, b.laneIndex) === b.laneIndex ? b.laneIndex : b.laneIndex + 1;
        let m = order.get(gap);
        if (m === undefined) { m = new Map(); order.set(gap, m); }
        m.set(l.key, m.size);
        count.set(gap, m.size);
    }
    return { order, count };
}

export interface LayoutOptions {
    /** Available width in px (the canvas grows beyond it if lanes need more). */
    width: number;
    orientation: "LR" | "TD";
    /** Extra bottom padding reserving space for the legend overlay. */
    legendPad?: number;
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
    const pitch = td ? 168 : ROW_PITCH;
    const tp = (p: Pt): Pt => (td ? { x: p.y, y: p.x } : p);

    const laneCount = Math.max(model.lanes.length, 1);
    const laneSpan = td ? Number.POSITIVE_INFINITY : opts.width - LANE_TAIL_W;
    const laneW = Math.max(laneMin, Number.isFinite(laneSpan) ? Math.floor(laneSpan / laneCount) : laneMin);
    const rows = Math.max(1, ...model.nodes.map(n => n.laneOrder + 1));
    const height = LANE_HEADER_H + 16 + rows * pitch + CANVAS_PAD_BOTTOM;
    const width = laneCount * laneW + LANE_TAIL_W;

    const lanes: LaneBand[] = model.lanes.map((l, i) => {
        const a = tp({ x: i * laneW, y: 0 });
        const b = tp({ x: (i + 1) * laneW, y: height });
        return {
            key: l.key,
            label: l.label,
            x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
            w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
            tinted: i % 2 === 1,
            cx: td ? 0 : i * laneW + laneW / 2,
        };
    });
    // In TD the header anchor is the band's vertical centre (label sits
    // left-aligned inside the band).
    if (td) {
        for (let i = 0; i < lanes.length; i++) lanes[i]!.cx = i * laneW + laneW / 2;
    }

    const nodes = new Map<string, NodeRect>();
    for (const n of model.nodes) {
        const laneCentre = Math.min(n.laneIndex, laneCount - 1) * laneW + laneW / 2;
        const main = laneCentre - nodeMain / 2;
        const cross = LANE_HEADER_H + 16 + n.laneOrder * pitch;
        const p = tp({ x: main, y: cross });
        nodes.set(n.key, nodeRect(p.x, p.y, NODE_W, NODE_H, n.key));
    }

    const chan = planChannels(model.links, k => model.nodesByKey.get(k));
    /** x of a link's vertical run in lane gap `gap` (the space between
     * lane gap-1's node column and lane gap's node column). */
    const channelX = (gap: number, slot: number): number => {
        const gapLeft = (gap - 1) * laneW + laneW / 2 + nodeMain / 2;   // main-axis edge of source column
        const gapRight = gap * laneW + laneW / 2 - nodeMain / 2;        // main-axis edge of target column
        const n = chan.count.get(gap) ?? 1;
        const spread = (n - 1) * CHANNEL_GAP;
        const centre = (gapLeft + gapRight) / 2;
        return centre - spread / 2 + slot * CHANNEL_GAP;
    };

    // Routing runs in LOGICAL space over logical rects; runs transpose to
    // real coordinates before path building.
    const logicalNodes = new Map<string, NodeRect>();
    for (const n of model.nodes) {
        const laneCentre = Math.min(n.laneIndex, laneCount - 1) * laneW + laneW / 2;
        logicalNodes.set(n.key, nodeRect(laneCentre - nodeMain / 2, LANE_HEADER_H + 16 + n.laneOrder * pitch, nodeMain, nodeCross, n.key));
    }

    // Corridor rows for backward links — below all content, staggered.
    let backSlot = 0;

    const routes: LinkRoute[] = [];
    for (const l of model.links) {
        const a = logicalNodes.get(l.from), b = logicalNodes.get(l.to);
        if (!a || !b) continue;
        const na = model.nodesByKey.get(l.from)!, nb = model.nodesByKey.get(l.to)!;
        let pts: Pt[];
        let outP: Pt, inP: Pt;
        if (na.laneIndex === nb.laneIndex) {
            if (a.bottom.y < b.top.y) {
                // Same-lane downward: out = bottom, in = top.
                outP = a.bottom; inP = b.top;
                pts = outP.x === inP.x
                    ? [outP, inP]
                    : [outP,
                        { x: outP.x, y: (outP.y + inP.y) / 2 },
                        { x: inP.x, y: (outP.y + inP.y) / 2 },
                        inP];
            } else {
                // Same-lane upward: drop ≥12, out to the lane-local side
                // channel, rise above the target, back over its top
                // handle, straight entry down into it.
                outP = a.bottom; inP = b.top;
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
            const slot = chan.order.get(nb.laneIndex)?.get(l.key) ?? 0;
            const mx = channelX(nb.laneIndex, slot);
            pts = outP.y === inP.y
                ? [outP, inP]
                : [outP, { x: mx, y: outP.y }, { x: mx, y: inP.y }, inP];
        } else {
            // Backward cross-lane: out = bottom, corridor below content,
            // rise in the gap before the target lane, in = left.
            outP = a.bottom; inP = b.left;
            const corridorY = height - CANVAS_PAD_BOTTOM + 14 + (backSlot++ % 2) * CHANNEL_GAP;
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
        const realPts = pts.map(tp);
        const { d, segs } = roundedPath(realPts);
        routes.push({
            key: l.key,
            d,
            end: tp(inP),
            segs,
            mid: longestRunMid(segs),
            ports: [tp(outP), tp(inP)],
        });
    }

    const tailA = tp({ x: laneCount * laneW + 8, y: 14 });
    const tailB = tp({ x: laneCount * laneW + LANE_TAIL_W - 8, y: height - CANVAS_PAD_BOTTOM + 14 });
    const realW = (td ? height : width) + 0;
    const realH = (td ? width : height) + (opts.legendPad ?? 0);

    return {
        width: realW,
        height: realH,
        orientation: opts.orientation,
        lanes,
        nodes,
        routes,
        laneTail: {
            x: Math.min(tailA.x, tailB.x),
            y: Math.min(tailA.y, tailB.y),
            w: Math.abs(tailB.x - tailA.x),
            h: Math.abs(tailB.y - tailA.y),
        },
    };
}
