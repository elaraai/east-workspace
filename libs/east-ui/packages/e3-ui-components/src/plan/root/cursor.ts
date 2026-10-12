/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The hover cursor (#609) — DIRECT DOM writes, zero renders.
 *
 * The hairline + ruler chip are display-only chrome, driven the way the landing
 * band is driven: `move` sets ONE CSS variable on the body — every row's
 * hairline positions from `--plan-cursor-x` and shows only under
 * `[data-plan-cursor]` — and writes the chip's label and position directly.
 * Routing this through state committed the ENTIRE canvas once per pointermove;
 * now a pointermove renders nothing at all.
 *
 * The hovered BUCKET is published to subscribers (#743) — each chart row's
 * crosshair readout — only when it changes, so a pointer gliding across one
 * bucket costs them nothing, and they too write the DOM directly.
 *
 * @packageDocumentation
 */

import { useMemo, type RefObject } from "react";
import type { PlanCursor } from "../context.js";
import type { PlanScale } from "../scale.js";
import { chipAnchor } from "../shell/Ruler.js";

/**
 * The canvas's cursor controller.
 *
 * @param bodyRef - The canvas body (carries the CSS variable)
 * @param chipRef - The ruler's cursor chip
 * @param scale - The shared scale (the chip names the hovered bucket)
 * @returns The controller rows report pointer moves to
 */
export function usePlanCursorController(
    bodyRef: RefObject<HTMLDivElement | null>,
    chipRef: RefObject<HTMLDivElement | null>,
    scale: PlanScale | undefined,
): PlanCursor {
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
                body.style.setProperty("--plan-cursor-x", String(frac));
                body.setAttribute("data-plan-cursor", "");
                const bi = scale.bucketAtFrac(frac);
                const chip = chipRef.current;
                if (chip !== null) {
                    if (bi >= 0) {
                        chip.textContent = scale.buckets[bi]!.label;
                        chip.style.left = `${frac * 100}%`;
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
                bodyRef.current?.removeAttribute("data-plan-cursor");
                const chip = chipRef.current;
                if (chip !== null) chip.style.display = "none";
                hover(-1);
            },
            subscribe: (listener) => {
                listeners.add(listener);
                if (hovered >= 0) listener(hovered);
                return () => { listeners.delete(listener); };
            },
        };
    }, [bodyRef, chipRef, scale]);
}
