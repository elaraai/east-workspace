/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a frame gathers from the nodes under it before it draws: the series
 * its tooltip reads, the layers a click is read against, the x keys of its
 * domain, its legend's entries, a scatter's bubble sizes and each axis
 * side's y extent, stacking and annotations counted.
 *
 * @packageDocumentation
 */

import { match } from "@elaraai/east";
import { getSomeorUndefined } from "../../utils";
import { numberOfKey, sideOf, xKeyOf, type Series, type SeriesMark, type Spec } from "./context.js";

/** Gather every coloured `series` under a node, for the hover tooltip. A layer
 *  whose per-layer `tooltip` flag is explicitly `false` contributes no rows, so a
 *  `by`-split decorative fan stays out of the tooltip (mirrors {@link collectLegend}). */
export function collectSeries(node: Spec, out: Series[]): void {
    match(node, {
        frame: f => { for (const c of f.children) collectSeries(c, out); },
        group: g => { for (const c of g.children) collectSeries(c, out); },
        series: s => { if (getSomeorUndefined(s.tooltip) === false) return; out.push(...s.data); },
    }, undefined);
}

/** Gather every `series` layer under a node, in draw order, for the mark a click
 *  falls on (`hit.ts`). A layer out of the tooltip is decoration, which a click
 *  passes through, as the hover does (mirrors {@link collectSeries}). */
export function collectLayers(node: Spec, out: SeriesMark[]): void {
    match(node, {
        frame: f => { for (const c of f.children) collectLayers(c, out); },
        group: g => { for (const c of g.children) collectLayers(c, out); },
        series: s => { if (getSomeorUndefined(s.tooltip) !== false) out.push(s); },
    }, undefined);
}

/** Gather x keys across every data-bearing node, for the x domain (data order). */
export function collectXKeys(node: Spec, out: string[]): void {
    match(node, {
        frame: f => { for (const c of f.children) collectXKeys(c, out); },
        group: g => { for (const c of g.children) collectXKeys(c, out); },
        series: s => { for (const ser of s.data) for (const p of ser.points) out.push(xKeyOf(p.x)); },
        bandArea: b => { for (const ser of b.data) for (const p of ser.points) out.push(xKeyOf(p.x)); },
        linePath: v => { for (const p of v.points) out.push(xKeyOf(p.x)); },
        area: v => { for (const p of v.points) out.push(xKeyOf(p.x)); },
        bars: v => { for (const p of v.points) out.push(xKeyOf(p.x)); },
        points: v => { for (const p of v.points) out.push(xKeyOf(p.x)); },
    }, undefined);
}

/** Gather `{ key, colour }` legend entries from coloured series + bands. */
export function collectLegend(node: Spec, out: Array<{ key: string; color: string }>): void {
    match(node, {
        frame: f => { for (const c of f.children) collectLegend(c, out); },
        group: g => { for (const c of g.children) collectLegend(c, out); },
        series: s => { if (getSomeorUndefined(s.legend) === false) return; for (const ser of s.data) if (ser.key) out.push({ key: ser.key, color: ser.color }); },
        bandArea: b => { for (const ser of b.data) if (ser.key) out.push({ key: ser.key, color: ser.color }); },
    }, undefined);
}

/** Gather per-point scatter `size` magnitudes, for the bubble size scale. */
export function collectScatterSizes(node: Spec, out: number[]): void {
    match(node, {
        frame: f => { for (const c of f.children) collectScatterSizes(c, out); },
        group: g => { for (const c of g.children) collectScatterSizes(c, out); },
        series: s => match(s.mark, {
            scatter: () => { for (const ser of s.data) for (const p of ser.points) { const v = getSomeorUndefined(p.size); if (v !== undefined) out.push(v); } },
            line: () => undefined, bar: () => undefined, area: () => undefined,
        }),
    }, undefined);
}

/** Accumulate the y extent for one axis side, accounting for stacking + annotations. */
export function walkY(node: Spec, side: "left" | "right", consider: (v: number) => void): void {
    match(node, {
        frame: f => { for (const c of f.children) walkY(c, side, consider); },
        group: g => { for (const c of g.children) walkY(c, side, consider); },
        series: sm => {
            if (sideOf(sm) !== side) return;
            const stacked = getSomeorUndefined(sm.stackId) !== undefined;
            const off = getSomeorUndefined(sm.stackOffset);
            const expand = off ? match(off, { none: () => false, expand: () => true }) : false;
            if (stacked && expand) { consider(0); consider(1); return; }
            if (stacked) {
                const totals = new Map<string, number>();
                for (const s of sm.data) for (const p of s.points) { const k = xKeyOf(p.x); totals.set(k, (totals.get(k) ?? 0) + p.value); }
                consider(0); for (const t of totals.values()) consider(t);
                return;
            }
            for (const s of sm.data) for (const p of s.points) consider(p.value);
        },
        bandArea: b => { if (side === "left") for (const s of b.data) for (const p of s.points) { consider(p.low); consider(p.high); } },
        area: v => { if (side === "left") for (const p of v.points) consider(p.value); },
        bars: v => { if (side === "left") for (const p of v.points) consider(p.value); },
        points: v => { if (side === "left") for (const p of v.points) consider(p.value); },
        linePath: v => { if (side === "left") for (const p of v.points) consider(p.value); },
        referenceDot: d => { if (side === "left") consider(d.y); },
        referenceArea: a => {
            if (side !== "left") return;
            const y1 = getSomeorUndefined(a.y1); const y2 = getSomeorUndefined(a.y2);
            if (y1 !== undefined) consider(y1); if (y2 !== undefined) consider(y2);
        },
        rule: r => { if (side === "left") match(r.axis, { y: () => consider(numberOfKey(r.at)), x: () => undefined }); },
    }, undefined);
}
