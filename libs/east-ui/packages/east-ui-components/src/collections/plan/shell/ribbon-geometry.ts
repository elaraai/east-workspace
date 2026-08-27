/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure links-ribbon routing (R1) — no DOM, no React, so every geometric
 * permutation is testable offline (`scripts`/vitest) and the rendered cases
 * can be reviewed as a contact sheet.
 *
 * The routing rule is SEMANTIC, not geometric: a ribbon always EXITS the
 * source run's END (right edge, heading right) and ENTERS the destination
 * run's BEGINNING (left edge, heading right) — flow direction is the same in
 * every case, whatever the interval arrangement. Paths are built from
 * straight lines and circular arcs ONLY, stroked at the span-rect thickness
 * with a plain triangle head:
 *
 * - Destination starts AFTER the source ends (causal, a real gap): the
 *   metro-S — straight, corner, riser, corner.
 * - Anything else (abutting, overlapping, containing, backward): the
 *   LOOPBACK — exit right, turn toward the destination row, travel back
 *   left along the midpoint lane, turn into the destination's start.
 * - Same-row links never loop: a forward feed is a straight centered band;
 *   an overlapping/backward one renders as an exit stub out of A's end plus
 *   a separate arrival head into B's start (the runoff grammar — the
 *   connection is implied, never drawn through impossible space).
 *
 * Direction changes turn at a small FIXED corner radius (CORNER_R, clamped
 * to the available drop); straight segments carry the remaining distance —
 * rounded-orthogonal routing, so far-apart rows get straight risers with
 * tight corners rather than giant sweeping lobes. Both ends keep a
 * HORIZONTAL RUN-OUT longer than the head: the band always leaves A
 * straight before its first turn, and every head arrives along a straight
 * approach — never directly off a corner.
 */

/** One ribbon endpoint — the run bar's rect (overlay-relative px). */
export interface RibbonEnd {
    leftX: number;
    rightX: number;
    top: number;
    bottom: number;
}

/** A routed ribbon: centerline `stroke` (stroked at `width`), triangle
 *  `head`, and the caption anchor. */
export interface RibbonPath {
    stroke: string;
    head: string;
    width: number;
    lx: number;
    ly: number;
    anchor: "start" | "middle" | "end";
}

/** Corner radius at every direction change (clamped to the available drop). */
const CORNER_R = 10;
/** Below this forward gap the metro-S degenerates — route the loopback. */
const MIN_S_GAP = 4;

const f = (n: number) => n.toFixed(1);

/**
 * Route one ribbon from the source run's END to the destination run's
 * BEGINNING — see the module doc for the case grammar.
 */
export function routeRibbon(from: RibbonEnd, to: RibbonEnd): RibbonPath {
    // The band rides at HALF the span-rect height — registered to the bar's
    // centerline but with room to turn (a full-height band leaves adjacent-row
    // loop radii below its own half-width, which degenerates the arcs).
    const width = (from.bottom - from.top) / 2;
    const halfH = width / 2;
    // Head length rides the band width (base = band, length ≈ 0.7×) — a
    // fixed-length head reads spiky once the band thinned.
    const headLen = Math.max(5, width * 0.7);
    // Both ends keep a horizontal run-out LONGER than the head: the exit
    // straight out of A, and the approach straight into the head.
    const runOut = headLen + 3;
    const sameRowLink = Math.abs((from.top + from.bottom) / 2 - (to.top + to.bottom) / 2) < 0.5;
    const ySrc = (from.top + from.bottom) / 2;
    const y2 = (to.top + to.bottom) / 2;
    const x1 = from.rightX;
    const x2 = to.leftX;
    const neckX = x2 - headLen;
    // Corners must complete left of the approach — the head never sits
    // directly on a turn.
    const approachX = neckX - runOut;
    const dy = y2 - ySrc;
    const head = `M ${f(neckX)} ${f(y2 - halfH)} L ${f(x2)} ${f(y2)} L ${f(neckX)} ${f(y2 + halfH)} Z`;

    if (sameRowLink) {
        // ── Same-row: never a loop ──
        if (x2 - x1 >= headLen + 2) {
            // A straight centered feed — the run's output flows directly
            // into the next run.
            return {
                stroke: `M ${f(x1)} ${f(ySrc)} L ${f(neckX)} ${f(y2)}`,
                head, width,
                lx: (x1 + neckX) / 2, ly: from.top - 6, anchor: "middle",
            };
        }
        // Overlapping/backward on one row: the runoff grammar — a squared
        // stub exits A's end; the arrival (approach + head) marks B's start.
        // The connection is implied, never drawn over the bars.
        return {
            stroke: `M ${f(x1)} ${f(ySrc)} L ${f(x1 + runOut)} ${f(ySrc)}`
                + ` M ${f(x2 - headLen - runOut)} ${f(y2)} L ${f(neckX)} ${f(y2)}`,
            head, width,
            lx: (x1 + x2) / 2, ly: from.top - 6, anchor: "middle",
        };
    }

    if (approachX - x1 >= runOut + MIN_S_GAP) {
        // ── The metro-S (causal, destination starts after the source ends) ──
        if (Math.abs(dy) < 0.5) {
            return {
                stroke: `M ${f(x1)} ${f(ySrc)} L ${f(neckX)} ${f(y2)}`,
                head, width,
                lx: (x1 + neckX) / 2, ly: ySrc - halfH - 5, anchor: "middle",
            };
        }
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
            head, width,
            lx: (x1 + neckX) / 2, ly: (ySrc + y2) / 2 - halfH - 5, anchor: "middle",
        };
    }

    // ── The loopback (abutting / overlapping / containing / backward) ──
    // Exit right, turn toward the destination row, travel LEFT along the
    // midpoint lane, turn into the destination's start. Each U-turn is
    // corner → vertical straight → corner at CORNER_R, degenerating to a
    // semicircle when the rows are adjacent. Same-row loops OVER the row.
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
    const xR = Math.max(x1 + runOut, xC + 2);
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
        head, width,
        lx: (xR + xC) / 2,
        // The caption rides ON the lane (halo-legible over the band) — an
        // above-lane offset lands on the source bar when the lane is the
        // narrow between-rows seam.
        ly: yLane + 3,
        anchor: "middle",
    };
}
