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
 * A link's end meets its element where the element DRAWS (#1258): a run's bar
 * from its start, never narrower than the canvas's narrowest bar; a chip in
 * from its ends by the cell inset, never narrower than the narrowest chip; a
 * tile's cell, its bucket's room in its lanes' on the plot's whole pixels, as
 * its row places it (#1735); a mark across its glyph, centred on its instant —
 * each clipped to the plot as the plot clips it. The widths are the geometry
 * table's, the numbers the recipe draws them at, so a tiny run's link leaves
 * the end its bar shows, not the end its time says.
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

import { rowKeyOf, type PlanBodyItem, type PlanLinkValue, type PlanRowValue } from "../model.js";
import type { PlanBucket, PlanScale } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import { PLAN_CELL_INSET, type PlanGeometry } from "../geometry.js";
import { laneRooms, laneSpan } from "../rows/lanes.js";
import { dayRoom } from "../rows/bucket-slots.js";
import type { RowKey } from "../plan-state.js";
import { quantityText } from "../quantity.js";
import type { PlanWords } from "../words.js";
import { ribbonForward, type RibbonEdgeSlot, type RibbonEnd, type RibbonOff, type RibbonPath, type RibbonRouteOptions } from "../../shared/links/geometry.js";
import { ribbonWeight } from "../../shared/links/captions.js";
import { planLanes, sCaptionAt, type LaidBand, type LanePlan, type LaneTrack, type PlannedLink } from "../../shared/links/lanes.js";
import { routeLinks } from "../../shared/links/route.js";
import type { LinkBox } from "../../shared/links/layer.js";

// The weight, the caption measures and the off-window slot are the shared
// link parts' (#1321).
export { RIBBON_CAPTION_CHAR, RIBBON_CAPTION_PAD, ribbonWeight } from "../../shared/links/captions.js";
export { RIBBON_SLOT_W, type RibbonEdgeSlot } from "../../shared/links/geometry.js";

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
    /** The canvas's geometry: the rule under every row, inside its height — a
     *  row's plot cell, where its elements centre, is the row less it — the
     *  bar a row outside the body is drawn at, and every width an element
     *  draws at (#1258). */
    geometry: Readonly<PlanGeometry>;
    /** The body's full height — the sum of every item's. */
    height: number;
    /**
     * Where a links focus draws a row it has folded with the others while their band is folded (#1680's review): a bar
     * centred in that band's plot cell, its top here — what a row of a paged source's evicted window is placed at, its
     * own band not in the body. `undefined` while no such band is folded.
     */
    folded?: number | undefined;
    /** Where each rule a links focus opens for its lanes holds its tracks (#1680's review), by the rule: a lane band, or
     *  the middle of the role band's plot cell where the tracks stand in it. Empty with no focus. */
    lanes: ReadonlyMap<number, RibbonLaneBox>;
    /** The bands between a links focus's rows, as laid out — each role band's plot cell and each lane band: where an S's
     *  caption sits off the rows' bars (#1680's review). Empty with no focus. */
    gaps: readonly LaidBand[];
}

/** Where a rule's lane tracks lie down the rows: the first track's top, and their height. */
export interface RibbonLaneBox {
    top: number;
    height: number;
}

/** Where a row the body does not hold is drawn: past an edge of the rows (a
 *  pinned row is above them), or AT a place in them — a row in an evicted
 *  paged window, at its window's offset in its block's band (#823). */
export type RibbonBeyond = { off: RibbonOff } | { y: number };

type BucketsKind = Extract<PlanRowValue["kind"], { type: "buckets" }>["value"];
type TileValue = BucketsKind["events"][number];
type MarkValue = Extract<PlanRowValue["kind"], { type: "events" }>["value"]["marks"][number];

/** A mark's glyph: its kind's shape, or the box its icon fits in. */
export type LinkedGlyph = "dot" | "diamond" | "triangle" | "icon";

/** How the element a link's end names draws — what the end meets (#1258). */
export type LinkedDraw =
    /** A run's bar: from its start, at least the canvas's narrowest bar wide, at its row's bar height. */
    | { kind: "bar" }
    /** A chip: in by the cell inset from its ends, at least the narrowest chip wide, at the chip height. */
    | { kind: "chip" }
    /** The cell a tile sits in (#1735): its bucket's room — from its start's whole pixel of the plot to the pixel before
     *  its rule — and down, `span` of the row's `lanes` from lane `lane`, each lane's room as the row lays it out. */
    | { kind: "cell"; lane: number; span: number; lanes: number }
    /** A mark: its glyph, centred on its instant. */
    | { kind: "mark"; glyph: LinkedGlyph };

/** The element a link's end names: its instants, and how it draws. */
export interface LinkedElement {
    start: PlanInstantValue;
    end: PlanInstantValue;
    draw: LinkedDraw;
}

/**
 * Where a tile's cell draws in its row, as `BucketsRow` places it: a row with
 * no lanes, a tile in no lane the row names, and every tile in a bucket such a
 * tile takes, fill the whole cell; any other tile's cell is its lane's.
 */
function cellOf(kind: BucketsKind, tile: TileValue, bucket: PlanBucket | undefined, scale: PlanScale): LinkedDraw {
    const lanes = kind.lanes.length;
    if (lanes === 0) return { kind: "cell", lane: 0, span: 1, lanes: 1 };
    const laneOf = (lane: TileValue["lane"]): number | undefined => {
        if (lane.type === "none") return undefined;
        const i = kind.lanes.findIndex((l) => l.key === lane.value);
        return i >= 0 ? i : undefined;
    };
    const lane = laneOf(tile.lane);
    const whole: LinkedDraw = { kind: "cell", lane: 0, span: lanes, lanes };
    if (lane === undefined) return whole;
    // A lane-less tile in its bucket takes the whole cell, and this tile with it.
    const shared = bucket !== undefined && kind.events.some((e) =>
        laneOf(e.lane) === undefined && scale.renderBucketOf(e.at)?.index === bucket.index);
    return shared ? whole : { kind: "cell", lane, span: 1, lanes };
}

/** A mark's glyph as `EventsRow` draws it outside a strip: its icon's box, else its kind's shape. */
function glyphOf(mark: MarkValue): LinkedGlyph {
    if (mark.icon.type === "some") return "icon";
    return mark.kind.type === "decision" ? "diamond" : mark.kind.type === "exception" ? "triangle" : "dot";
}

/** A mark's glyph across and down, as the recipe draws it — a diamond turned 45° reaches √2 times its side. */
function glyphSize(glyph: LinkedGlyph, g: Readonly<PlanGeometry>): { w: number; h: number } {
    switch (glyph) {
        case "dot": return { w: g.markDotWidth, h: g.markDotWidth };
        case "diamond": return { w: g.markDiamondWidth * Math.SQRT2, h: g.markDiamondWidth * Math.SQRT2 };
        case "triangle": return { w: g.markTriangleWidth, h: g.markTriangle };
        case "icon": return { w: g.markIconWidth, h: g.markIconWidth };
    }
}

/**
 * The element a link's end meets on its row: the one its run key names — a
 * run, a chip, a tile (met at the cell it sits in) or a mark — and how it
 * draws. A link's end that names an event meets it however the event draws
 * (#1192).
 *
 * @param row - The end's row
 * @param key - The element's key
 * @param scale - The shared scale (a tile's bucket)
 * @returns The element, or `undefined` when the row has no element of that key
 */
export function linkedElement(row: PlanRowValue, key: string, scale: PlanScale): LinkedElement | undefined {
    const k = row.kind;
    switch (k.type) {
        case "span": {
            const run = k.value.runs.find((r) => r.key === key);
            return run !== undefined ? { start: run.start, end: run.end, draw: { kind: "bar" } } : undefined;
        }
        case "cards": {
            const chip = k.value.chips.find((c) => c.key === key);
            return chip !== undefined ? { start: chip.from, end: chip.to, draw: { kind: "chip" } } : undefined;
        }
        case "buckets": {
            const tile = k.value.events.find((e) => e.key === key);
            if (tile === undefined) return undefined;
            const bucket = scale.renderBucketOf(tile.at);
            const draw = cellOf(k.value, tile, bucket, scale);
            return bucket !== undefined ? { start: bucket.start, end: bucket.end, draw } : { start: tile.at, end: tile.at, draw };
        }
        case "events": {
            const mark = k.value.marks.find((m) => m.key === key);
            return mark !== undefined ? { start: mark.at, end: mark.at, draw: { kind: "mark", glyph: glyphOf(mark) } } : undefined;
        }
        default:
            return undefined;
    }
}

/**
 * The body's rows as slots, and a links focus's bands as the ribbons see them.
 *
 * @param items - The body items, in order
 * @param heights - Each item's exact height (`usePlanBody`)
 * @param geometry - The canvas's geometry table
 * @returns The slots, the bands, and the body's height
 */
export function ribbonBody(
    items: readonly PlanBodyItem[],
    heights: readonly number[],
    geometry: Readonly<PlanGeometry>,
): RibbonBody {
    const slots = new Map<RowKey, RibbonSlot>();
    const bands = new Map<string, number>();
    const lanes = new Map<number, RibbonLaneBox>();
    const gaps: LaidBand[] = [];
    let folded: number | undefined;
    let y = 0;
    items.forEach((item, i) => {
        const h = heights[i] ?? 0;
        if (item.kind === "row") {
            // A row's runs ride the bar, a parent's folded or open — the rule `KindPlot` renders by.
            slots.set(item.row.row.key, { top: y, height: h, bar: geometry.bar });
        } else if (item.kind === "band") {
            bands.set(`${item.band.block}:${item.band.at}`, y);
        } else if (item.kind === "focus") {
            // Its plot cell: the band less the rule under it.
            const cell = h - geometry.rule;
            gaps.push({ top: y, bottom: y + cell });
            // Lane tracks standing in it lie in the middle of its plot cell.
            const tracks = item.band.lanes;
            if (tracks !== undefined) lanes.set(tracks.rule, { top: y + (cell - tracks.px) / 2, height: tracks.px });
            // The others' band, folded: a bar centred in its plot cell.
            if (item.band.role === "others" && !item.band.open) folded = y + (cell - geometry.bar) / 2;
        } else if (item.kind === "lanes") {
            gaps.push({ top: y, bottom: y + h });
            lanes.set(item.lanes.rule, { top: y, height: h });
        }
        y += h;
    });
    return { slots, bands, geometry, height: y, folded, lanes, gaps };
}

/**
 * Where a row of a paged source's evicted window is drawn (#823): at its
 * window's offset in its block's band — or, that band folded with a links
 * focus's other rows, at the band they fold into (#1680's review).
 *
 * @param place - The row's place: its block's band, which end, and its window's offset in it (the paging driver's)
 * @param body - The canvas body as the ribbons see it
 * @returns Where it is drawn; `undefined` where the body holds neither — its edges are not drawn
 */
export function placedBeyond(place: { readonly block: number; readonly at: string; readonly px: number }, body: RibbonBody): RibbonBeyond | undefined {
    const top = body.bands.get(`${place.block}:${place.at}`);
    if (top !== undefined) return { y: top + place.px };
    return body.folded !== undefined ? { y: body.folded } : undefined;
}

/** The part of the rows a bounded frame shows, in the rows' own px. */
export interface RibbonViewport {
    top: number;
    bottom: number;
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
    /** The element a link's end names, by row and run key ({@link linkedElement}). */
    element: (rowKey: string, runKey: string) => LinkedElement | undefined;
    scale: PlanScale;
    /** The plot column, in the rows' own px. */
    plot: { left: number; width: number };
    /** What a bounded frame shows; `undefined` — the frame shows every row. */
    viewport: RibbonViewport | undefined;
    /** The canvas's words — a caption prints the link's quantity in them (#824). */
    words: PlanWords;
    /** A links focus's lane plan ({@link planFocusLanes}), whose rules the body opened into bands; left out, none. */
    lanes?: RibbonLanes | undefined;
}

/** One endpoint, and the slot its off-window run lands in. */
interface Endpoint {
    end: RibbonEnd;
    edgeSlot: RibbonEdgeSlot | undefined;
}

/**
 * An element's extent across the plot as it draws (#1258), from its extent on
 * the window, `f0` to `f1` of the plot.
 */
function drawnX(draw: LinkedDraw, f0: number, f1: number, g: Readonly<PlanGeometry>, plot: { left: number; width: number }): [number, number] {
    const x0 = plot.left + f0 * plot.width;
    const x1 = plot.left + f1 * plot.width;
    switch (draw.kind) {
        case "bar":
            return [x0, Math.max(x1, x0 + g.barMinWidth)];
        case "chip": {
            const left = x0 + PLAN_CELL_INSET;
            return [left, left + Math.max(x1 - x0 - 2 * PLAN_CELL_INSET, g.chipMinWidth)];
        }
        case "cell": {
            // Its bucket's room on the plot's whole pixels, as its row places its cell (#1735).
            const room = dayRoom(f0, f1, plot.width);
            return [plot.left + room.left, plot.left + room.left + room.width];
        }
        case "mark": {
            const half = glyphSize(draw.glyph, g).w / 2;
            return [x0 - half, x0 + half];
        }
    }
}

/**
 * An element's extent down its row as it draws (#1258) — centred in the row's
 * plot cell (the row less its rule), or a tile's cell: its lanes' rooms, in
 * whole pixels (#1735). A row with no such element is met at its bar.
 */
function drawnY(draw: LinkedDraw | undefined, slot: RibbonSlot, g: Readonly<PlanGeometry>): [number, number] {
    const plotH = slot.height - g.rule;
    const mid = slot.top + plotH / 2;
    const around = (h: number): [number, number] => [mid - h / 2, mid + h / 2];
    switch (draw?.kind) {
        case undefined:
        case "bar":
            return around(slot.bar);
        case "chip":
            return around(g.chip);
        case "cell": {
            // Its lanes' rooms, as its row lays them out.
            const band = laneSpan(laneRooms(slot.height, draw.lanes), draw.lane, draw.span);
            return band === undefined ? around(slot.bar) : [slot.top + band.top, slot.top + band.top + band.height];
        }
        case "mark":
            return around(glyphSize(draw.glyph, g).h);
    }
}

/**
 * One endpoint from the model: the element across the plot and down its row,
 * as it draws, clamped to the view.
 */
function endpointOf(input: RibbonLayoutInput, rowKey: RowKey, runKey: string): Endpoint | undefined {
    const { body, plot, scale, viewport } = input;
    const g = body.geometry;
    const el = input.element(rowKey, runKey);
    const { leftX, rightX, offWindow } = elementAcross(el, plot, scale, g);
    // ── y: the element down its row's plot cell, as it draws ──
    let top: number;
    let bottom: number;
    let off: RibbonOff | undefined;
    // The row the element is on, its rule included: where a loopback into it runs its lane.
    let row: RibbonEnd["row"];
    const slot = body.slots.get(rowKey);
    if (slot !== undefined) {
        [top, bottom] = drawnY(el?.draw, slot, g);
        row = { top: slot.top, bottom: slot.top + slot.height };
    } else {
        const place = input.beyond(rowKey);
        if (place === undefined) return undefined;
        if ("off" in place) {
            // Past the rows' top (or end), meeting them there.
            off = place.off;
            top = off === "above" ? 0 : body.height - g.bar;
        } else {
            // In an evicted window (#823): at its window's offset in its
            // block's band — the view clamps it below like any row.
            top = Math.max(0, Math.min(body.height - g.bar, place.y));
        }
        bottom = top + g.bar;
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
    const end: RibbonEnd = off !== undefined ? { leftX, rightX, top, bottom, off }
        : row !== undefined ? { leftX, rightX, top, bottom, row } : { leftX, rightX, top, bottom };
    // The slot draws only while its row is in view.
    const edgeSlot = offWindow !== undefined && off === undefined
        ? { x: leftX, y: top, h: bottom - top, side: offWindow }
        : undefined;
    return { end, edgeSlot };
}

/**
 * Where an element draws across the plot (#1258): an element touching the
 * window keeps its window-clamped extent, drawn at least as wide as the canvas
 * draws it and clipped where the plot clips it; one wholly outside the window
 * lands at the plot edge it lies past, in a dashed slot. A row with no such
 * element is met across its whole plot.
 */
function elementAcross(
    el: LinkedElement | undefined,
    plot: { left: number; width: number },
    scale: PlanScale,
    g: Readonly<PlanGeometry>,
): { leftX: number; rightX: number; offWindow: "left" | "right" | undefined } {
    const plotRight = plot.left + plot.width;
    let leftX = plot.left;
    let rightX = plotRight;
    let offWindow: "left" | "right" | undefined;
    if (el !== undefined) {
        const mark = el.draw.kind === "mark";
        const f0 = scale.fracOf(el.start);
        // A mark has one instant; anything else ends at its end's far edge.
        const f1 = mark ? f0 : scale.endFracOf(el.end);
        if (Number.isFinite(f0) && Number.isFinite(f1)) {
            if (mark ? f0 < 0 : f1 <= 0) {
                offWindow = "left";
                rightX = leftX;
            } else if (mark ? f0 > 1 : f0 >= 1) {
                offWindow = "right";
                leftX = rightX;
            } else {
                const [x0, x1] = drawnX(el.draw, Math.max(0, f0), Math.min(1, f1), g, plot);
                leftX = Math.min(plotRight, Math.max(plot.left, x0));
                rightX = Math.min(plotRight, Math.max(plot.left, x1));
            }
        }
    }
    return { leftX, rightX, offWindow };
}

/**
 * The boxes the links stand back from (#1680's review): each bar's label in
 * the rows the body holds, with the room its bar pads it with — laid out from
 * the model as the recipe draws it (the table's widths, which a guard ties to
 * the recipe), never read from the page (#818): the run across the plot, its
 * bar down its row, its label's glyphs after its lock, cut short at the bar's
 * end; none where the bar is too short to show its label, or lies off the
 * window.
 *
 * @param body - The body as the ribbons see it
 * @param rowOf - A row, by its key
 * @param scale - The shared scale
 * @param plot - The plot column, in the rows' own px
 * @returns The boxes, in the rows' own px
 */
export function labelBoxes(
    body: RibbonBody,
    rowOf: (key: RowKey) => PlanRowValue | undefined,
    scale: PlanScale,
    plot: { left: number; width: number },
): LinkBox[] {
    const g = body.geometry;
    const boxes: LinkBox[] = [];
    for (const [key, slot] of body.slots) {
        const kind = rowOf(key)?.kind;
        if (kind?.type !== "span") continue;
        for (const run of kind.value.runs) {
            if (run.label === "") continue;
            const { leftX, rightX, offWindow } = elementAcross({ start: run.start, end: run.end, draw: { kind: "bar" } }, plot, scale, g);
            if (offWindow !== undefined) continue;
            const pad = run.locked ? g.barPadLockedWidth : g.barPadWidth;
            const lead = run.locked ? g.lockWidth + g.barGapWidth : 0;
            // The label shows from two glyphs, after the lock and its gap.
            if (rightX - leftX - 2 * pad < lead + 2 * g.barGlyphWidth) continue;
            const [top, bottom] = drawnY(undefined, slot, g);
            const right = Math.min(rightX, leftX + 2 * pad + lead + [...run.label].length * g.barGlyphWidth);
            boxes.push({ x: leftX, y: top, width: right - leftX, height: bottom - top });
        }
    }
    return boxes;
}

/** A link's size: its quantity's value, or `undefined` for a link with none (#824). */
const linkSize = (l: PlanLinkValue): number | undefined => (l.quantity.type === "some" ? Math.abs(l.quantity.value.value) : undefined);

/**
 * The largest quantity among the links a focus gathers both ends of — what a
 * link's weight is a third of, over the whole family, so a link holds its
 * weight as others scroll away.
 */
function familyLargest(links: readonly PlanLinkValue[], visibleKeys: ReadonlySet<RowKey>): number {
    let largest = 0;
    for (const l of links) {
        if (visibleKeys.has(rowKeyOf(l.from.row)) && visibleKeys.has(rowKeyOf(l.to.row))) largest = Math.max(largest, linkSize(l) ?? 0);
    }
    return largest;
}

/** A links focus's lane plan, and each planned link's place in it by its index in the root's `links`. */
export interface RibbonLanes {
    readonly plan: LanePlan;
    readonly planned: ReadonlyMap<number, number>;
}

/**
 * A links focus's lane plan (#1680's review, `shared/links/lanes.ts`): the
 * rules between its gathered rows that its family's loopbacks run along and its
 * one-row links caption on, each opened into a band of tracks — planned from
 * where each link's elements draw across the plot, at the weights its ribbons
 * draw at. A link with an end the body does not gather — a pinned row's, a row
 * folded with the others — is not planned: its route keeps its own.
 *
 * @param input - The links, the gathered rows top to bottom (`focusGatheredKeys`), the rows the focus keeps, and how an element draws across the plot
 * @returns The plan, and each planned link's place in it
 */
export function planFocusLanes(input: Pick<RibbonLayoutInput, "links" | "visibleKeys" | "element" | "scale" | "plot"> & {
    /** The gathered rows, top to bottom. */
    order: readonly RowKey[];
    geometry: Readonly<PlanGeometry>;
}): RibbonLanes {
    const at = new Map(input.order.map((key, i) => [key, i]));
    const largest = familyLargest(input.links, input.visibleKeys);
    const planned = new Map<number, number>();
    const list: PlannedLink[] = [];
    input.links.forEach((l, link) => {
        const fromKey = rowKeyOf(l.from.row);
        const toKey = rowKeyOf(l.to.row);
        const from = at.get(fromKey);
        const to = at.get(toKey);
        if (from === undefined || to === undefined) return;
        const source = elementAcross(input.element(fromKey, l.from.run), input.plot, input.scale, input.geometry);
        const destination = elementAcross(input.element(toKey, l.to.run), input.plot, input.scale, input.geometry);
        planned.set(link, list.length);
        list.push({
            from, to, sourceEnd: source.rightX, destinationStart: destination.leftX,
            weight: ribbonWeight(linkSize(l), largest), captioned: l.quantity.type === "some",
        });
    });
    return { plan: planLanes(input.order.length, list), planned };
}

/**
 * What a link's route takes of its focus's lanes (#1680's review): a
 * loopback's lane on its track, a one-row link's caption on its track — each
 * where the rule it was planned on lies down the rows — and an S's caption where
 * its riser crosses the band nearest its mid-height, off the rows' bars.
 */
function routeOptionsOf(input: RibbonLayoutInput, link: number, from: RibbonEnd, to: RibbonEnd): RibbonRouteOptions | undefined {
    const { body, lanes } = input;
    const at = (track: LaneTrack | undefined): number | undefined => {
        const box = track !== undefined ? body.lanes.get(track.rule) : undefined;
        return box !== undefined && track !== undefined ? box.top + track.centre : undefined;
    };
    const p = lanes?.planned.get(link);
    const lane = p !== undefined ? at(lanes!.plan.lanes[p]) : undefined;
    let caption = p !== undefined ? at(lanes!.plan.captions[p]) : undefined;
    const ySrc = (from.top + from.bottom) / 2;
    const yDst = (to.top + to.bottom) / 2;
    if (caption === undefined && from.off === undefined && to.off === undefined && Math.abs(ySrc - yDst) >= 0.5
        && ribbonForward(from.rightX, to.leftX)) {
        const lo = Math.min(ySrc, yDst);
        const hi = Math.max(ySrc, yDst);
        caption = sCaptionAt(body.gaps.filter((b) => b.top >= lo && b.bottom <= hi), (ySrc + yDst) / 2);
    }
    if (lane === undefined && caption === undefined) return undefined;
    return { lane, caption };
}

/** The element an end meets, as the shared layout names it: its row and its key, apart. */
const elementAt = (rowKey: RowKey, key: string): string => `${rowKey}\u0000${key}`;

/**
 * Lay out every drawable edge of the family: each end resolved from the
 * model, and the family laid out by the shared links layer (`routeLinks`) —
 * links sharing an element's end spread there, each routed, its caption
 * placed.
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
    const largest = familyLargest(links, visibleKeys);
    const kept: { link: number; from: RibbonEnd; to: RibbonEnd; fromAt: string; toAt: string; weight: number; label: string | undefined }[] = [];
    const edgeSlots: RibbonEdgeSlot[] = [];
    for (const { link, l, fromKey, toKey } of edges) {
        const from = endpointOf(input, fromKey, l.from.run);
        const to = endpointOf(input, toKey, l.to.run);
        if (from === undefined || to === undefined) continue;
        // Both ends past the same edge: nothing of it is in view.
        if (from.end.off !== undefined && from.end.off === to.end.off) continue;
        if (from.edgeSlot !== undefined) edgeSlots.push(from.edgeSlot);
        if (to.edgeSlot !== undefined) edgeSlots.push(to.edgeSlot);
        kept.push({
            link, from: from.end, to: to.end, fromAt: elementAt(fromKey, l.from.run), toAt: elementAt(toKey, l.to.run),
            weight: ribbonWeight(linkSize(l), largest),
            label: l.quantity.type === "some" ? quantityText(l.quantity.value, words) : undefined,
        });
    }
    // Semantic routing (`routeRibbon`, through the shared layout): the link
    // exits the source's END and enters the destination's BEGINNING in every
    // arrangement, nothing of it leaving the plot, each caption kept inside
    // it and stepped clear of any earlier one within 60 × 12 — a loopback on
    // the track its focus opened for it, a caption on its own or where its
    // riser crosses a band.
    const routed = routeLinks(kept.map((k) => ({ ...k, plan: routeOptionsOf(input, k.link, k.from, k.to) })),
        { left: input.plot.left, right: input.plot.left + input.plot.width });
    const ribbons = routed.map((r, i): LaidRibbon => ({ ...r, link: kept[i]!.link, weight: kept[i]!.weight }));
    return { ribbons, edgeSlots };
}
