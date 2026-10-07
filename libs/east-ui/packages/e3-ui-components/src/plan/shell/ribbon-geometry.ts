/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure links-ribbon routing (R1) — no DOM, no React, so every geometric
 * permutation is testable offline (`ribbon-geometry.test.ts` holds the case
 * table) and the rendered cases can be reviewed as a contact sheet.
 *
 * The grammar is `Plan links.html`'s (#1258), its case table this module's
 * test table. The routing rule is SEMANTIC, not geometric: a link always
 * EXITS the source run's END (right edge, heading right) and ENTERS the
 * destination run's BEGINNING (left edge, heading right) — flow direction is
 * the same in every case, whatever the interval arrangement. Paths are built
 * from straight lines and circular arcs ONLY, stroked at the link's WEIGHT —
 * the quantity's, never the bar's, each end centred on its own bar — with a
 * plain triangle head 8 long and max(8, 2 × weight) wide:
 *
 * - Destination starts at least head + 2 run-outs + 4 (34px) after the
 *   source ends (causal, a real gap): the metro-S — straight, corner, riser,
 *   corner.
 * - Anything else (abutting, overlapping, containing, backward): the
 *   LOOPBACK — exit right, turn toward the destination row, travel back
 *   left along the lane halfway between the bars, turn into the
 *   destination's start. A destination at the window's start turns in the
 *   gutter, under the row controls.
 * - Same-row links never loop: a forward feed is a straight centered band;
 *   an overlapping/backward one renders as an exit stub out of A's end plus
 *   a separate arrival into B's start (the runoff grammar — the connection is
 *   implied, never drawn through the bars).
 * - A link may cross a bar on its way. It is drawn over it, cased in the
 *   paper (the renderer draws the casing).
 * - An endpoint OUT OF VIEW (#818) sits at the viewport edge its row lies
 *   beyond, and the ribbon meets that edge vertically with a STUB — an
 *   arrowhead pointing out of view, toward the row. A destination out of view
 *   turns off the source toward it where the riser would stand (the metro-S's
 *   riser for a forward link, the loopback's first turn otherwise), so the
 *   ribbon does not jump sideways as the row scrolls into view; a source out
 *   of view enters down (or up) the destination's riser. Both out of view, on
 *   opposite sides, is one vertical band across the view with a stub at each
 *   end. Both out of view on the SAME side draws nothing — the caller never
 *   routes it.
 *
 * Direction changes turn at a small FIXED corner radius (8, clamped to half
 * the drop); straight segments carry the remaining distance —
 * rounded-orthogonal routing, so far-apart rows get straight risers with
 * tight corners rather than giant sweeping lobes. Both ends keep a
 * HORIZONTAL RUN-OUT of 11, longer than the head: the link always leaves A
 * straight before its first turn, and every head arrives along a straight
 * approach — never directly off a corner.
 *
 * Its caption sits on the riser at mid-height (an S, an out-of-view stub, the
 * band across the view), on the lane (a loopback), or 6 above the source bar
 * (one row).
 */

/** The viewport edge an out-of-view endpoint lies beyond. */
export type RibbonOff = "above" | "below";

/** One ribbon endpoint — the run bar's rect, in the rows' own px. */
export interface RibbonEnd {
    leftX: number;
    rightX: number;
    top: number;
    bottom: number;
    /**
     * Set when the endpoint's row is out of view: the rect sits at that
     * viewport edge (its `top` ON the top edge, or its `bottom` ON the bottom
     * edge) and the ribbon meets the edge with a stub pointing toward the row.
     */
    off?: RibbonOff | undefined;
}

/** A routed link: centerline `stroke` (stroked at `width`, its weight), the
 *  arrowheads, and where its caption's text is centred. */
export interface RibbonPath {
    stroke: string;
    /** The arrowhead at the ribbon's end: into the destination's start, or —
     *  the destination out of view — the stub pointing toward it. */
    head: string;
    /** The stub where the ribbon enters the view — an arrowhead pointing
     *  toward the out-of-view source; empty while the source is in view. */
    tail: string;
    width: number;
    lx: number;
    ly: number;
    anchor: "start" | "middle" | "end";
}

/** A head's length along the flow (px). */
const HEAD_LEN = 8;
/** The straight every link keeps out of its source's end and into its
 *  destination's start (px). */
const RUN_OUT = 11;
/** Corner radius at every direction change (clamped to the available drop). */
const CORNER_R = 8;
/** Below this gap past the head and two run-outs the metro-S degenerates —
 *  route the loopback. */
const MIN_S_GAP = 4;
/** A caption's text sits this far below the point it is centred on (px) — a
 *  10px label's middle. */
const CAPTION_DROP = 3;

const f = (n: number) => n.toFixed(1);

/** A triangle arrowhead: its base centred on `(bx, by)` across the flow, its
 *  tip at `(tx, ty)`, `half` px either side of the flow line. */
function arrow(bx: number, by: number, tx: number, ty: number, half: number): string {
    // The base runs perpendicular to the flow — vertical flow, a horizontal base.
    return bx === tx
        ? `M ${f(bx - half)} ${f(by)} L ${f(tx)} ${f(ty)} L ${f(bx + half)} ${f(by)} Z`
        : `M ${f(bx)} ${f(by - half)} L ${f(tx)} ${f(ty)} L ${f(bx)} ${f(by + half)} Z`;
}

/**
 * Route one link from the source run's END to the destination run's
 * BEGINNING — see the module doc for the case grammar.
 *
 * @param from - The source run's rect (out of view: at the edge it lies beyond)
 * @param to - The destination run's rect (the same)
 * @param weight - The link's weight: its stroke's width (`ribbonWeight`)
 * @returns The link's paths and caption anchor
 */
export function routeRibbon(from: RibbonEnd, to: RibbonEnd, weight: number): RibbonPath {
    // The weight is the quantity's, never the bar's: the same link draws as
    // wide out of a 20px bar, a compact 16px one and a 12px rollup.
    const width = weight;
    // The head is 8 long and max(8, 2 × weight) wide.
    const halfH = Math.max(HEAD_LEN, 2 * weight) / 2;
    const headLen = HEAD_LEN;
    // Both ends keep a horizontal run-out LONGER than the head: the exit
    // straight out of A, and the approach straight into the head.
    const runOut = RUN_OUT;
    const ySrc = (from.top + from.bottom) / 2;
    const y2 = (to.top + to.bottom) / 2;
    const x1 = from.rightX;
    const x2 = to.leftX;
    const neckX = x2 - headLen;
    // Corners must complete left of the approach — the head never sits
    // directly on a turn.
    const approachX = neckX - runOut;
    const forward = approachX - x1 >= runOut + MIN_S_GAP;
    const arrival = arrow(neckX, y2, x2, y2, halfH);

    if (from.off !== undefined || to.off !== undefined) {
        return routeOutOfView(from, to, { width, halfH, headLen, runOut, ySrc, y2, x1, neckX, approachX, forward, arrival });
    }

    const sameRowLink = Math.abs(ySrc - y2) < 0.5;
    const dy = y2 - ySrc;
    const head = arrival;

    if (sameRowLink) {
        // ── Same-row: never a loop ──
        if (x2 - x1 >= headLen + 2) {
            // A straight centered feed — the run's output flows directly
            // into the next run.
            return {
                stroke: `M ${f(x1)} ${f(ySrc)} L ${f(neckX)} ${f(y2)}`,
                head, tail: "", width,
                lx: (x1 + neckX) / 2, ly: from.top - 6, anchor: "middle",
            };
        }
        // Overlapping/backward on one row: the runoff grammar — a squared
        // stub exits A's end; the arrival (approach + head) marks B's start.
        // The connection is implied, never drawn through the bars; the stubs
        // are cased where they sit on one.
        return {
            stroke: `M ${f(x1)} ${f(ySrc)} L ${f(x1 + runOut)} ${f(ySrc)}`
                + ` M ${f(x2 - headLen - runOut)} ${f(y2)} L ${f(neckX)} ${f(y2)}`,
            head, tail: "", width,
            lx: (x1 + x2) / 2, ly: from.top - 6, anchor: "middle",
        };
    }

    if (forward) {
        // ── The metro-S (causal, destination starts after the source ends) ──
        const rad = Math.min(CORNER_R, (approachX - x1 - runOut) / 2, Math.abs(dy) / 2);
        const sgn = dy > 0 ? 1 : -1;
        const xs = approachX - 2 * rad;
        const sweep1 = sgn === 1 ? 1 : 0;
        return {
            stroke: `M ${f(x1)} ${f(ySrc)}`
                + ` L ${f(xs)} ${f(ySrc)}`
                + ` A ${f(rad)} ${f(rad)} 0 0 ${sweep1} ${f(xs + rad)} ${f(ySrc + sgn * rad)}`
                + (Math.abs(dy) - 2 * rad > 0.5 ? ` L ${f(xs + rad)} ${f(y2 - sgn * rad)}` : "")
                + ` A ${f(rad)} ${f(rad)} 0 0 ${1 - sweep1} ${f(approachX)} ${f(y2)}`
                + ` L ${f(neckX)} ${f(y2)}`,
            head, tail: "", width,
            // The caption on the riser, at mid-height.
            lx: xs + rad, ly: (ySrc + y2) / 2 + CAPTION_DROP, anchor: "middle",
        };
    }

    // ── The loopback (abutting / overlapping / containing / backward) ──
    // Exit right, turn toward the destination row, travel LEFT along the
    // midpoint lane, turn into the destination's start. Each U-turn is
    // corner → vertical straight → corner at CORNER_R, degenerating to a
    // semicircle when the rows are adjacent.
    const yLane = (ySrc + y2) / 2;
    // The exit-side turn (toward the lane) and the entry-side turn (lane
    // into B) — each clamps its corner to half its own drop.
    const sgnA = yLane > ySrc ? 1 : -1;
    const sgnB = y2 >= yLane ? 1 : -1;
    const dropA = Math.abs(yLane - ySrc);
    const dropB = Math.abs(y2 - yLane);
    const rA = Math.min(CORNER_R, dropA / 2);
    const rB = Math.min(CORNER_R, dropB / 2);
    const xC = approachX;
    const xR = exitTurnX(x1, runOut, approachX);
    const s1 = sgnA > 0 ? 1 : 0;
    const s2 = sgnB > 0 ? 0 : 1;
    return {
        stroke: `M ${f(x1)} ${f(ySrc)}`
            + ` L ${f(xR)} ${f(ySrc)}`
            + ` A ${f(rA)} ${f(rA)} 0 0 ${s1} ${f(xR + rA)} ${f(ySrc + sgnA * rA)}`
            + (dropA - 2 * rA > 0.5 ? ` L ${f(xR + rA)} ${f(yLane - sgnA * rA)}` : "")
            + ` A ${f(rA)} ${f(rA)} 0 0 ${s1} ${f(xR)} ${f(yLane)}`
            + ` L ${f(xC)} ${f(yLane)}`
            + ` A ${f(rB)} ${f(rB)} 0 0 ${s2} ${f(xC - rB)} ${f(yLane + sgnB * rB)}`
            + (dropB - 2 * rB > 0.5 ? ` L ${f(xC - rB)} ${f(y2 - sgnB * rB)}` : "")
            + ` A ${f(rB)} ${f(rB)} 0 0 ${s2} ${f(xC)} ${f(y2)}`
            + ` L ${f(neckX)} ${f(y2)}`,
        head, tail: "", width,
        // The caption on the lane, at its middle — on its paper knockout.
        lx: (xR + xC) / 2,
        ly: yLane + CAPTION_DROP,
        anchor: "middle",
    };
}

/** Where the loopback's exit-side turn begins — past the run-out, and clear
 *  of the approach it runs back to. */
function exitTurnX(x1: number, runOut: number, approachX: number): number {
    return Math.max(x1 + runOut, approachX + 2);
}

/** The shared measures {@link routeRibbon} hands its out-of-view cases. */
interface RouteMeasures {
    width: number;
    halfH: number;
    headLen: number;
    runOut: number;
    ySrc: number;
    y2: number;
    x1: number;
    neckX: number;
    approachX: number;
    forward: boolean;
    arrival: string;
}

/** The out-of-view cases — see the module doc. */
function routeOutOfView(from: RibbonEnd, to: RibbonEnd, m: RouteMeasures): RibbonPath {
    const { width, halfH, headLen, runOut, ySrc, y2, x1, neckX, approachX, forward, arrival } = m;
    // The edge an out-of-view end sits on, and which way is "toward its row".
    const edgeOf = (end: RibbonEnd): number => (end.off === "above" ? end.top : end.bottom);
    const outward = (end: RibbonEnd): number => (end.off === "above" ? -1 : 1);

    if (from.off !== undefined && to.off !== undefined) {
        // ── Both out of view, on opposite sides: ONE vertical band across the
        // view, a stub at each edge. It stands where the destination's riser
        // would (forward) or the loopback's first turn would (otherwise).
        const xV = forward ? approachX - CORNER_R : exitTurnX(x1, runOut, approachX) + CORNER_R;
        const yA = edgeOf(from);
        const yB = edgeOf(to);
        const sgn = yB > yA ? 1 : -1;
        const yStart = yA + sgn * headLen;
        const yEnd = yB - sgn * headLen;
        return {
            stroke: `M ${f(xV)} ${f(yStart)} L ${f(xV)} ${f(yEnd)}`,
            head: arrow(xV, yEnd, xV, yB, halfH),
            tail: arrow(xV, yStart, xV, yA, halfH),
            width,
            // The caption on the band, at mid-height.
            lx: xV, ly: (yStart + yEnd) / 2 + CAPTION_DROP, anchor: "middle",
        };
    }

    if (to.off !== undefined) {
        // ── The destination out of view: exit the source's end, turn toward
        // the edge where the riser would stand, and run out of view.
        const sgn = outward(to);
        const edge = edgeOf(to);
        const drop = Math.abs(edge - ySrc);
        // A forward turn must still leave the source its full run-out (the
        // metro-S's own clamp); every turn fits the drop before the stub.
        const room = forward ? (approachX - x1 - runOut) / 2 : CORNER_R;
        const rad = Math.min(CORNER_R, room, Math.max(0, (drop - headLen) / 2));
        const xV = forward ? approachX - rad : exitTurnX(x1, runOut, approachX) + rad;
        // The vertical run stops where the stub's base begins — never past
        // the source's own centerline, however close the row is to the edge.
        const yNeck = sgn * (edge - sgn * headLen - ySrc) > rad ? edge - sgn * headLen : ySrc + sgn * rad;
        return {
            stroke: `M ${f(x1)} ${f(ySrc)}`
                + ` L ${f(xV - rad)} ${f(ySrc)}`
                + ` A ${f(rad)} ${f(rad)} 0 0 ${sgn === 1 ? 1 : 0} ${f(xV)} ${f(ySrc + sgn * rad)}`
                + ` L ${f(xV)} ${f(yNeck)}`,
            head: arrow(xV, yNeck, xV, edge, halfH),
            tail: "",
            width,
            // The caption on the stub's riser, at mid-height.
            lx: xV, ly: (ySrc + sgn * rad + yNeck) / 2 + CAPTION_DROP, anchor: "middle",
        };
    }

    // ── The source out of view: enter from its edge down (or up) the
    // destination's riser, turn into the approach, and arrive as usual.
    const sgnIn = -outward(from);
    const edge = edgeOf(from);
    const drop = Math.abs(y2 - edge);
    const rad = Math.min(CORNER_R, Math.max(0, (drop - headLen) / 2));
    const xV = approachX - rad;
    const yStart = sgnIn * (y2 - sgnIn * rad - (edge + sgnIn * headLen)) >= 0 ? edge + sgnIn * headLen : y2 - sgnIn * rad;
    return {
        stroke: `M ${f(xV)} ${f(yStart)}`
            + ` L ${f(xV)} ${f(y2 - sgnIn * rad)}`
            + ` A ${f(rad)} ${f(rad)} 0 0 ${sgnIn === 1 ? 0 : 1} ${f(xV + rad)} ${f(y2)}`
            + ` L ${f(neckX)} ${f(y2)}`,
        head: arrival,
        tail: arrow(xV, yStart, xV, edge, halfH),
        width,
        // The caption on the riser it enters down, at mid-height.
        lx: xV, ly: (yStart + y2 - sgnIn * rad) / 2 + CAPTION_DROP, anchor: "middle",
    };
}
