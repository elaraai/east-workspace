/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of a ruler's labels draw, measured as the page lays them out (#1269) —
 * the desktop ruler's (`Ruler.tsx`) and the narrow layout's
 * (`narrow/chrome.tsx`). While it measures, every label draws whole, centred
 * on its column; `thinTicks` then decides from the labels as they drew which
 * draw and where. It measures before the browser paints — when the ruler
 * mounts, when its buckets change, when its track's width changes (in the
 * ResizeObserver's delivery) and when fonts arrive (`useMeasureAgain`)
 * — so no frame shows a label it does not rest on. A track with no width yet
 * (a ruler not laid out) draws every label.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useState, type RefObject } from "react";
import { useMeasureAgain } from "@elaraai/east-ui-components/internal";
import type { Scale, ScaleBucket } from "./scale.js";

/** The geometry and vocabulary a ruler needs, independent of its host. */
export type RulerScale<I> = Pick<Scale<I, string>, "kind" | "resolution" | "buckets" | "toNumber">;
import { rulerLabels, thinTicks, type RulerFit } from "./ruler-thin.js";

/** The room between two drawn labels, in px: with a bucket line between them, two labels read apart (#1269). */
export const RULER_GAP = 4;

/**
 * Whether a bucket starts a period one up from the scale's resolution (#1269):
 * a Monday under days, a month's first week under weeks, January under months
 * or quarters, midnight under hours. A number or ordinal axis, or years, has
 * none.
 *
 * @param scale - The scale
 * @param b - The bucket
 * @returns Whether its column's label always draws
 */
export function startsPeriod<I>(scale: RulerScale<I>, b: ScaleBucket<I>): boolean {
    if (scale.kind !== "time") return false;
    const d = new Date(scale.toNumber(b.start));
    switch (scale.resolution) {
        case "hour": return d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
        case "day": return d.getUTCDay() === 1;
        case "week": return d.getUTCDate() <= 7;
        case "month": case "quarter": return d.getUTCMonth() === 0;
        default: return false;
    }
}

/** A box's inside edges, in px: its border box less its borders and padding. */
function insideOf(el: HTMLElement): { left: number; right: number } {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const px = (v: string) => Number.parseFloat(v) || 0;
    return {
        left: r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft),
        right: r.right - px(cs.borderRightWidth) - px(cs.paddingRight),
    };
}

/**
 * What a ruler draws of its labels — see the module docs.
 *
 * @param trackRef - The ruler's track: one tick per bucket, in order, each holding its label as a `[data-tick-label]`
 * @param scale - The scale the ticks are the buckets of
 * @param prefer - The bucket (its `index`) whose label draws wherever it clears every period's first column drawn: the
 *   narrow ruler's now bucket
 * @returns Which labels draw and where each sits; `undefined` while the ruler measures, or while its track has no
 *   width, when every label draws, centred
 */
export function useRulerFit<I>(trackRef: RefObject<HTMLElement | null>, scale: RulerScale<I>, prefer?: number, enabled = true): RulerFit | undefined {
    // What the labels' places depend on: each one's words and its column, and the bucket preferred.
    const signature = `${prefer ?? ""}\u0002${scale.buckets.map((b) => `${b.label}\u0000${b.x0}\u0000${b.x1}`).join("\u0001")}`;
    const { measuring, measured } = useMeasureAgain(trackRef, signature, enabled);
    const [fit, setFit] = useState<RulerFit | undefined>(undefined);
    useLayoutEffect(() => {
        const track = trackRef.current;
        if (!enabled || !measuring || track === null) return;
        measured();
        const spans = [...track.querySelectorAll<HTMLElement>("[data-tick-label]")];
        if (spans.length === 0 || spans.length !== scale.buckets.length) { setFit(undefined); return; }
        // Each label's box as drawn, and its column's inside edges, where a label that would run past the track's start
        // or end sits; the knockout's padding, the recipe's on every label, is what its text stands in from its box by.
        const knockout = getComputedStyle(spans[0]!);
        const pad = { left: Number.parseFloat(knockout.paddingLeft) || 0, right: Number.parseFloat(knockout.paddingRight) || 0 };
        const input = rulerLabels(spans.map((span, i) => {
            const r = span.getBoundingClientRect();
            const b = scale.buckets[i]!;
            return { box: { left: r.left, right: r.right }, column: insideOf(span.parentElement!), anchor: startsPeriod(scale, b), prefer: b.index === prefer };
        }), pad, RULER_GAP);
        setFit(input === undefined ? undefined : thinTicks(input.labels, input.track, input.gap));
    }, [measuring, measured, signature, scale, prefer, trackRef, enabled]);
    // While it measures, every label draws whole: never painted, as the measure lands first.
    return enabled && !measuring && fit !== undefined && fit.shown.length === scale.buckets.length ? fit : undefined;
}
