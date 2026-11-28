/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The hover cursor (#609) — DIRECT DOM writes, zero renders.
 *
 * The hairline + ruler chip are display-only chrome, driven the way the landing
 * band is driven: `move` writes each mounted row's hairline its place, shows
 * them all by ONE attribute on the body (`[data-plan-cursor]`), and writes the
 * chip's label and position directly. Routing this through state committed the
 * ENTIRE canvas once per pointermove; now a pointermove renders nothing at all.
 *
 * The place is written on the hairlines themselves, never as a variable on the
 * body for them to read: a custom property is inherited, so a change to one on
 * the body leaves the style of every element under it stale, and the browser
 * works the whole canvas's out again on every move — a move's cost then grows
 * with everything the canvas draws. A row hands the cursor its hairline as it
 * mounts (`line`), and one mounting under a resting pointer takes the place the
 * cursor holds.
 *
 * The hovered BUCKET is published to subscribers (#743) — each chart row's
 * crosshair readout — only when it changes, so a pointer gliding across one
 * bucket costs them nothing, and they too write the DOM directly.
 *
 * @packageDocumentation
 */

import { useMemo, useState, type RefObject } from "react";
import type { PlanCursor } from "../context.js";
import type { PlanScale } from "../scale.js";
import { chipAnchor } from "../shell/Ruler.js";

/** What the cursor holds across scales, which its hairlines outlive: the hairlines mounted, and where the pointer stands. */
interface Standing {
    /** The mounted rows' hairlines. */
    readonly lines: Set<HTMLElement>;
    /** The window fraction the pointer stands at; `undefined` while it is over no plot. */
    at: number | undefined;
}

/** A hairline's place, as its style says it: a fraction of its plot's width. */
function placeOf(frac: number): string {
    return `${frac * 100}%`;
}

/**
 * The canvas's cursor controller.
 *
 * @param bodyRef - The canvas body (carries the attribute the hairlines show under)
 * @param chipRef - The ruler's cursor chip
 * @param scale - The shared scale (the chip names the hovered bucket)
 * @returns The controller rows report pointer moves to
 */
export function usePlanCursorController(
    bodyRef: RefObject<HTMLDivElement | null>,
    chipRef: RefObject<HTMLDivElement | null>,
    scale: PlanScale | undefined,
): PlanCursor {
    const [standing] = useState<Standing>(() => ({ lines: new Set(), at: undefined }));
    // One callback for the canvas's life: a row's hairline is handed over once, whatever the scale becomes.
    const [line] = useState(() => (el: HTMLElement | null) => {
        if (el === null) return undefined;
        standing.lines.add(el);
        if (standing.at !== undefined) el.style.left = placeOf(standing.at);
        return () => { standing.lines.delete(el); };
    });
    return useMemo<PlanCursor>(() => {
        const listeners = new Set<(bucket: number) => void>();
        let hovered = -1;
        const hover = (bucket: number) => {
            if (bucket === hovered) return;
            hovered = bucket;
            for (const listener of listeners) listener(bucket);
        };
        return {
            move: (frac: number) => {
                const body = bodyRef.current;
                if (body === null || scale === undefined) return;
                standing.at = frac;
                const place = placeOf(frac);
                for (const el of standing.lines) el.style.left = place;
                // Written once as the pointer comes over a plot, never on each move after.
                if (!body.hasAttribute("data-plan-cursor")) body.setAttribute("data-plan-cursor", "");
                const bi = scale.bucketAtFrac(frac);
                const chip = chipRef.current;
                if (chip !== null) {
                    if (bi >= 0) {
                        chip.textContent = scale.buckets[bi]!.label;
                        chip.style.left = place;
                        chip.style.transform = `translate(${chipAnchor(frac)}, -50%)`;
                        chip.style.display = "";
                    } else {
                        // A truncated axis's uncovered remainder has no bucket
                        // to name — the hairline still tracks, the readout hides.
                        chip.style.display = "none";
                    }
                }
                hover(bi);
            },
            leave: () => {
                standing.at = undefined;
                bodyRef.current?.removeAttribute("data-plan-cursor");
                const chip = chipRef.current;
                if (chip !== null) chip.style.display = "none";
                hover(-1);
            },
            line,
            subscribe: (listener) => {
                listeners.add(listener);
                if (hovered >= 0) listener(hovered);
                return () => { listeners.delete(listener); };
            },
        };
    }, [bodyRef, chipRef, scale, standing, line]);
}
