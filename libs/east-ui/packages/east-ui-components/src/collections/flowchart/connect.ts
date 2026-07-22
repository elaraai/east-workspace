/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Flowchart connect-gesture helpers — pure, React-free, unit-tested
 * (the Schematic pattern: geometry/derivation split out of the
 * composition root so the interactive seams stay small and reliable).
 */

import type { FlowchartModel } from "./model.js";
import type { FlowchartLayout, HandleSide, NodeRect, Pt } from "./layout.js";

/** Drop tolerance around a node's rect — releasing anywhere over the
 * node (or this close to it) lands the connection; nobody should have
 * to hit a 7px ring. */
export const DROP_PAD = 14;

/** The node whose padded rect contains `p` (last match wins — matches
 * paint order), excluding the drag source. */
export function dropTargetAt(layout: FlowchartLayout, p: Pt, exclude?: string): string | null {
    let hit: string | null = null;
    for (const [key, r] of layout.nodes) {
        if (key === exclude) continue;
        if (p.x >= r.x - DROP_PAD && p.x <= r.x + r.w + DROP_PAD
            && p.y >= r.y - DROP_PAD && p.y <= r.y + r.h + DROP_PAD) hit = key;
    }
    return hit;
}

/** The existing same-direction link between two nodes, if any — a drop
 * that would duplicate it is absorbed (the existing link pulses instead).
 * The reverse direction stays legal: back-links are semantically distinct. */
export function existingLink(model: FlowchartModel, from: string, to: string): string | undefined {
    return model.links.find(l => l.from === from && l.to === to)?.key;
}

/** The handle point of `rect` nearest to `p` — the draft line's snap
 * target while hovering a valid drop. */
export function nearestHandle(rect: NodeRect, p: Pt): Pt {
    const sides: readonly HandleSide[] = ["left", "right", "top", "bottom"];
    let best: Pt = rect.left;
    let bd = Number.POSITIVE_INFINITY;
    for (const s of sides) {
        const h = rect[s];
        const d = Math.abs(h.x - p.x) + Math.abs(h.y - p.y);
        if (d < bd) { bd = d; best = h; }
    }
    return best;
}
