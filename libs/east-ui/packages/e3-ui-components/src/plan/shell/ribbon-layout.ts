/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where the links-focus ribbons go (R1, #818) — computed from the MODEL, never
 * measured from the DOM.
 *
 * A row's place is the body's own arithmetic: its top is the sum of the exact
 * heights of the body items above it (`usePlanBody`'s `heights`, the same
 * numbers the frame lays the rows out at), and its bar sits centred in its
 * plot cell — the row less the rule under it — at the geometry table's bar
 * height. A run's x is its window fraction across the plot. So the ribbons
 * follow the rows in the same render — a collapse, a chart toggle or a landing
 * window moves both at once — and they reach rows the virtualizer has not
 * mounted.
 *
 * A bounded frame shows only part of its rows. An endpoint beyond that view
 * clamps to the edge it lies past and ends in a stub pointing toward its row
 * (`routeRibbon`); a ribbon with both ends past the same edge is not drawn. An
 * unbounded frame shows every row, so nothing clamps there. A row the body
 * does not hold is placed by the caller (`beyond`): a pinned row sits past the
 * rows' top, and a row in an evicted paged window sits at that window's offset
 * in its block's band (#823) — then clamps and stubs like any row out of view.
 *
 * Pure: no React, no DOM.
 *
 * @packageDocumentation
 */

import { rowKeyOf, type PlanBodyItem, type PlanLinkValue, type PlanRowIndex, type PlanRowValue } from "../model.js";
import type { PlanScale } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import type { PlanGeometry } from "../geometry.js";
import type { RowKey } from "../plan-state.js";
import { quantityText } from "../quantity.js";
import type { PlanWords } from "../words.js";
import { routeRibbon, type RibbonEnd, type RibbonOff, type RibbonPath } from "./ribbon-geometry.js";

/** Width of the dashed slot an end past the window lands in (px). */
export const RIBBON_SLOT_W = 40;

/**
 * A link's weight — its stroke's width (`Plan links.html` §15): its
 * quantity's third of the family's largest — above two thirds 8, above one
 * third 4, else 2 — and 1.5 for a link with no quantity.
 *
 * @param quantity - The link's quantity's size, or `undefined` when it has none
 * @param largest - The largest quantity among the family's links
 * @returns The weight, in px
 */
export function ribbonWeight(quantity: number | undefined, largest: number): number {
    if (quantity === undefined) return 1.5;
    const share = largest > 0 ? quantity / largest : 0;
    return share > 2 / 3 ? 8 : share > 1 / 3 ? 4 : 2;
}

/** Where one body row sits, in the rows' own px. */
export interface RibbonSlot {
    /** The row's top — the heights of every body item above it. */
    top: number;
    /** The row's height. */
    height: number;
    /** The height of the bar its runs draw (a collapsed parent's are slimmer). */
    bar: number;
}

/** The canvas body as the ribbons see it. */
export interface RibbonBody {
    /** Each body row's slot, by key. */
    slots: ReadonlyMap<RowKey, RibbonSlot>;
    /** Each unloaded band's top, by `block:at` (`"0:tail"`) — where a row in
     *  an evicted window is placed from (#823). */
    bands: ReadonlyMap<string, number>;
    /** The rule under every row, inside its height — a row's plot cell (where
     *  its bars centre) is the row less it. */
    rule: number;
    /** The bar height a row outside the body is drawn at. */
    bar: number;
    /** The body's full height — the sum of every item's. */
    height: number;
}

/** Where a row the body does not hold is drawn: past an edge of the rows (a
 *  pinned row is above them), or AT a place in them — a row in an evicted
 *  paged window, at its window's offset in its block's band (#823). */
export type RibbonBeyond = { off: RibbonOff } | { y: number };

/**
 * Where a link's end meets its row: the element its run key names — a run's
 * or a chip's two ends, the bucket a tile sits in, or a mark's instant. A
 * link's end that names an event meets it however the event draws (#1192).
 *
 * @param row - The end's row
 * @param key - The element's key
 * @param scale - The shared scale (a tile's bucket)
 * @returns The element's instants, or `undefined` when the row has no element of that key
 */
export function elementInstants(
    row: PlanRowValue, key: string, scale: PlanScale,
): { start: PlanInstantValue; end: PlanInstantValue } | undefined {
    const k = row.kind;
    switch (k.type) {
        case "span": {
            const run = k.value.runs.find((r) => r.key === key);
            return run !== undefined ? { start: run.start, end: run.end } : undefined;
        }
        case "cards": {
            const chip = k.value.chips.find((c) => c.key === key);
            return chip !== undefined ? { start: chip.from, end: chip.to } : undefined;
        }
        case "buckets": {
            const tile = k.value.events.find((e) => e.key === key);
            if (tile === undefined) return undefined;
            const bucket = scale.renderBucketOf(tile.at);
            return bucket !== undefined ? { start: bucket.start, end: bucket.end } : { start: tile.at, end: tile.at };
        }
        case "events": {
            const mark = k.value.marks.find((m) => m.key === key);
            return mark !== undefined ? { start: mark.at, end: mark.at } : undefined;
        }
        default:
            return undefined;
    }
}

/**
 * The body's rows as slots.
 *
 * @param items - The body items, in order
 * @param heights - Each item's exact height (`usePlanBody`)
 * @param index - The row index (which rows nest children)
 * @param geometry - The canvas's geometry table
 * @returns The slots and the body's height
 */
export function ribbonBody(
    items: readonly PlanBodyItem[],
    heights: readonly number[],
    index: PlanRowIndex,
    geometry: Readonly<PlanGeometry>,
): RibbonBody {
    const slots = new Map<RowKey, RibbonSlot>();
    const bands = new Map<string, number>();
    let y = 0;
    items.forEach((item, i) => {
        const h = heights[i] ?? 0;
        if (item.kind === "row") {
            const v = item.row;
            // A collapsed span parent draws its rollup band, not full bars —
            // the rule `KindPlot` renders by.
            const rolled = v.row.kind.type === "span" && v.collapsed
                && (index.children.get(v.row.key)?.length ?? 0) > 0;
            slots.set(v.row.key, { top: y, height: h, bar: rolled ? geometry.rollBar : geometry.bar });
        } else if (item.kind === "band") {
            bands.set(`${item.band.block}:${item.band.at}`, y);
        }
        y += h;
    });
    return { slots, bands, rule: geometry.rule, bar: geometry.bar, height: y };
}

/** The part of the rows a bounded frame shows, in the rows' own px. */
export interface RibbonViewport {
    top: number;
    bottom: number;
}

/** The dashed slot at a window edge an off-window end lands in — as tall as
 *  its bar, {@link RIBBON_SLOT_W} wide, open toward the edge. */
export interface RibbonEdgeSlot {
    /** The plot edge it opens onto. */
    x: number;
    y: number;
    h: number;
    side: "left" | "right";
}

/** One laid-out ribbon. */
export interface LaidRibbon extends RibbonPath {
    /** The link's index in the root's `links` — its identity on the canvas. */
    link: number;
    from: RibbonEnd;
    to: RibbonEnd;
    /** Its stroke's width, by its quantity ({@link ribbonWeight}). */
    weight: number;
    /** The link's quantity caption (#824) — `undefined` for a link with no
     *  quantity, which then shows no caption and no tooltip. */
    label: string | undefined;
}

/** What {@link layoutRibbons} lays out from. */
export interface RibbonLayoutInput {
    /** The root's link graph. */
    links: readonly PlanLinkValue[];
    /** The rows a links focus keeps at full height (the focus and its family) —
     *  an edge with an end outside it is not drawn. */
    visibleKeys: ReadonlySet<RowKey>;
    body: RibbonBody;
    /** Where a row the body does not hold is drawn ({@link RibbonBeyond});
     *  `undefined` when it has no place — its edges are not drawn. */
    beyond: (key: RowKey) => RibbonBeyond | undefined;
    /** A run's instants, by row and run key. */
    runDates: (rowKey: string, runKey: string) => { start: PlanInstantValue; end: PlanInstantValue } | undefined;
    scale: PlanScale;
    /** The plot column, in the rows' own px. */
    plot: { left: number; width: number };
    /** What a bounded frame shows; `undefined` — the frame shows every row. */
    viewport: RibbonViewport | undefined;
    /** The canvas's words — a caption prints the link's quantity in them (#824). */
    words: PlanWords;
}

/** One endpoint, and the slot its off-window run lands in. */
interface Endpoint {
    end: RibbonEnd;
    edgeSlot: RibbonEdgeSlot | undefined;
}

/**
 * One endpoint from the model: the run's x across the plot, the row's bar in
 * y, clamped to the view.
 */
function endpointOf(input: RibbonLayoutInput, rowKey: RowKey, runKey: string): Endpoint | undefined {
    const { body, plot, scale, viewport } = input;
    // ── x: the run's extent on the window, as its bar draws it ──
    // A run touching the window keeps its window-clamped extent (its bar's);
    // one wholly outside it lands at the plot edge it lies past, in a dashed
    // slot. A row with no such run is met across its whole plot.
    let leftX = plot.left;
    let rightX = plot.left + plot.width;
    let offWindow: "left" | "right" | undefined;
    const dates = input.runDates(rowKey, runKey);
    if (dates !== undefined) {
        const f0 = scale.fracOf(dates.start);
        const f1 = scale.endFracOf(dates.end);
        if (Number.isFinite(f0) && Number.isFinite(f1)) {
            if (f1 <= 0) {
                offWindow = "left";
                rightX = leftX;
            } else if (f0 >= 1) {
                offWindow = "right";
                leftX = rightX;
            } else {
                leftX = plot.left + Math.max(0, f0) * plot.width;
                rightX = plot.left + Math.min(1, f1) * plot.width;
            }
        }
    }
    // ── y: the bar, centred in its row's plot cell (the row less its rule) ──
    let top: number;
    let bottom: number;
    let off: RibbonOff | undefined;
    const slot = body.slots.get(rowKey);
    if (slot !== undefined) {
        const mid = slot.top + (slot.height - body.rule) / 2;
        top = mid - slot.bar / 2;
        bottom = mid + slot.bar / 2;
    } else {
        const place = input.beyond(rowKey);
        if (place === undefined) return undefined;
        if ("off" in place) {
            // Past the rows' top (or end), meeting them there.
            off = place.off;
            top = off === "above" ? 0 : body.height - body.bar;
        } else {
            // In an evicted window (#823): at its window's offset in its
            // block's band — the view clamps it below like any row.
            top = Math.max(0, Math.min(body.height - body.bar, place.y));
        }
        bottom = top + body.bar;
    }
    // ── The view: an endpoint past one of its edges sits ON that edge ──
    if (viewport !== undefined) {
        const bar = bottom - top;
        const mid = (top + bottom) / 2;
        if (mid < viewport.top) {
            off = "above";
            top = viewport.top;
            bottom = top + bar;
        } else if (mid > viewport.bottom) {
            off = "below";
            bottom = viewport.bottom;
            top = bottom - bar;
        }
    }
    const end: RibbonEnd = off !== undefined ? { leftX, rightX, top, bottom, off } : { leftX, rightX, top, bottom };
    // The slot draws only while its row is in view.
    const edgeSlot = offWindow !== undefined && off === undefined
        ? { x: leftX, y: top, h: bottom - top, side: offWindow }
        : undefined;
    return { end, edgeSlot };
}

/**
 * Lay out every drawable edge of the family.
 *
 * @param input - The model the ribbons follow
 * @returns The routed ribbons (in `links` order) and the off-window slots
 */
export function layoutRibbons(input: RibbonLayoutInput): { ribbons: LaidRibbon[]; edgeSlots: RibbonEdgeSlot[] } {
    const { links, visibleKeys, words } = input;
    // A link names its ends by run ref — a row id (#822) and a run key (#824);
    // the body keys its rows by the ids' text.
    const edges: { link: number; l: PlanLinkValue; fromKey: RowKey; toKey: RowKey }[] = [];
    links.forEach((l, link) => {
        const fromKey = rowKeyOf(l.from.row);
        const toKey = rowKeyOf(l.to.row);
        if (visibleKeys.has(fromKey) && visibleKeys.has(toKey)) edges.push({ link, l, fromKey, toKey });
    });
    // The weight is a third of the FAMILY's largest quantity — over every
    // edge the focus gathers, so a link holds its weight as others scroll
    // away. A link's size is its quantity's value (#824).
    const size = (l: PlanLinkValue): number | undefined => (l.quantity.type === "some" ? Math.abs(l.quantity.value.value) : undefined);
    const largest = edges.reduce((m, { l }) => Math.max(m, size(l) ?? 0), 0);
    const ribbons: LaidRibbon[] = [];
    const edgeSlots: RibbonEdgeSlot[] = [];
    for (const { link, l, fromKey, toKey } of edges) {
        const from = endpointOf(input, fromKey, l.from.run);
        const to = endpointOf(input, toKey, l.to.run);
        if (from === undefined || to === undefined) continue;
        // Both ends past the same edge: nothing of it is in view.
        if (from.end.off !== undefined && from.end.off === to.end.off) continue;
        if (from.edgeSlot !== undefined) edgeSlots.push(from.edgeSlot);
        if (to.edgeSlot !== undefined) edgeSlots.push(to.edgeSlot);
        const weight = ribbonWeight(size(l), largest);
        const label = l.quantity.type === "some" ? quantityText(l.quantity.value, words) : undefined;
        // Semantic routing (`routeRibbon`): the link exits the source run's
        // END and enters the destination's BEGINNING in every arrangement.
        ribbons.push({ ...routeRibbon(from.end, to.end, weight), link, from: from.end, to: to.end, weight, label });
    }
    // Greedy caption de-overlap — links sharing a source edge can land their
    // captions on one another: a caption within 60 × 12 of an earlier one
    // steps down 12 until clear. A link with no caption takes no line.
    const placed: { x: number; y: number }[] = [];
    for (const r of ribbons) {
        if (r.label === undefined) continue;
        while (placed.some((p) => Math.abs(p.x - r.lx) < 60 && Math.abs(p.y - r.ly) < 12)) r.ly += 12;
        placed.push({ x: r.lx, y: r.ly });
    }
    return { ribbons, edgeSlots };
}
