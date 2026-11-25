/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan's geometry — every row and slot height, and the widths its
 * elements draw at, per density, in ONE table (#817).
 *
 * The model computes row heights from it (`rowHeight`, the virtualizer's sizes
 * and the paging ledger's window heights), and the canvas writes it once, on
 * its body, as CSS variables (`--plan-row-h`, `--plan-strip-h`, …) that the
 * recipe reads wherever it draws one of these heights. The ledger's "band px
 * == rendered px" invariant rests on the two agreeing; before this they were
 * three hand-kept copies (model constants, recipe pixels, inline heights).
 *
 * The widths are the narrowest a bar and a chip draw, and each mark's glyph
 * across (`--plan-bar-min-w`, …): a link's end meets an element where it draws
 * (#1258), so the ribbons lay out from the same numbers the recipe draws the
 * elements at. A bucket cell has no floor: it is its day's room, on whole
 * pixels (#1735).
 *
 * @packageDocumentation
 */

/**
 * How far a bucket tile stands inside its day's rules (#1735), and a cards chip
 * in from its own ends, each side (px). The renderers place both by it, and a
 * link meets a chip where it draws (#1258).
 */
export const PLAN_CELL_INSET = 2;

/**
 * The one CSS variable the canvas writes on its body beside the table: the
 * gutter's width (#1680's review), which the rows' template and the gutter's
 * rule read. It is the viewer's to drag, so no density's table holds it.
 */
export const PLAN_GUTTER_VAR = "--plan-gutter-w";

/** Every row and slot height the canvas lays out from, and the widths its elements draw at, in px. */
export interface PlanGeometry {
    /** Span / buckets / cards / table rows — the shared default row. */
    row: number;
    /** The rule under a row, INSIDE its height: its plot cell is the row less
     *  this, and a bar centres in the plot cell (the link ribbons register to
     *  it, #818). */
    rule: number;
    /** The floor of a row with a two-line gutter (a sub line, or `stacked`). */
    rowStacked: number;
    /** A group band. */
    group: number;
    /** A collapsed group's summary heat strip. */
    groupStrip: number;
    /** A chart row at rest (spark). */
    chartSpark: number;
    /** A chart row expanded (the default when no `expandedHeight` is declared). */
    chartExpanded: number;
    /** A heat row — its cells plus {@link PlanGeometry.heatInset} above and below. */
    heatRow: number;
    /** The inset above and below a heat cell. */
    heatInset: number;
    /** A heat cell's minimum height. */
    heatCellMin: number;
    /** A context strip — an expand focus's unfocused row, compressed (R2), and a pinned row a links focus does not
     *  gather (R1, #1680's review). A links focus's own bands are a group band's height. */
    strip: number;
    /** A mark inside a context strip. */
    stripMark: number;
    /** A vertical multi-series table row: {@link PlanGeometry.tablePad} + one line per series. */
    tableLine: number;
    tablePad: number;
    /** A buckets row's lane (#1735): the room its tiles stand in, a {@link PlanGeometry.rule} under each — the last
     *  lane's the row's own — so a row is `(lane + rule) ×` its lanes, one where it declares none. */
    lane: number;
    /** A span run bar. */
    bar: number;
    /** A collapsed parent's rollup band. */
    rollBar: number;
    /** A bucket tile (#1735): 2px inside its lane's room above and below. */
    tile: number;
    /** A cards chip. */
    chip: number;
    /** A weight bar. */
    weight: number;
    /** A segment track. */
    segment: number;
    /** The chrome bands: horizon brush (its strip and its lens), ruler,
     *  footer. The toolbar band is the frame's (#1193). */
    brush: number;
    ruler: number;
    footer: number;
    /** The horizon's lens under its strip (#949) — the connectors from the
     *  window it selected down to the plot's edges. The strip is the band
     *  less this. */
    lens: number;
    /** The horizon brush's tallest histogram bar: the strip less the 4px over it (#1438). */
    brushBar: number;
    /** A narrow group card's strip body. */
    narrowStrip: number;
    /** The shortest a failed window's band renders (#811) — its reason and its
     *  Retry stay legible even in a short last window. */
    failedBandMin: number;
    /** An exception mark's triangle, its point to its base. */
    markTriangle: number;
    // ── Widths (#1258) — a key ending `Width` is written `--plan-…-w` ──
    /** The narrowest a span bar draws, its padding and its look's ring
     *  inside it: a run shorter than this draws this wide from its start. */
    barMinWidth: number;
    /** The narrowest a cards chip draws, its padding and ring inside it. */
    chipMinWidth: number;
    /** A tile's floor (#1266): the narrowest slot a cell cuts its day into —
     *  a day whose slots would fall under it cuts fewer, its `+n` taking what
     *  has none (#1267, #1735). */
    tileMinWidth: number;
    /** The narrowest a tile draws at all, its padding given way: a proposal's
     *  two 1.5px rings (#1276). A day that leaves a tile less room draws its
     *  lone tile as a mark across it, several as their `+n` alone. */
    tileLeastWidth: number;
    /** A milestone's dot, across and down. */
    markDotWidth: number;
    /** A decision's diamond, each side before it turns 45° — its corners then
     *  reach √2 times this across and down. */
    markDiamondWidth: number;
    /** An exception's triangle, across its base. */
    markTriangleWidth: number;
    /** The box an event mark's icon fits in, across and down. */
    markIconWidth: number;
    // ── A bar's label (#1680's review): the links stand back from it and the room its bar pads it with ──
    /** A bar's padding either side, which its label starts in from. */
    barPadWidth: number;
    /** A locked bar's padding either side. */
    barPadLockedWidth: number;
    /** The gap between a bar's lock, its label and its quantity. */
    barGapWidth: number;
    /** A bar's lock, across. */
    lockWidth: number;
    /** One glyph of a bar's label — its mono face at the bar's size draws every glyph this wide (`1ch`). */
    barGlyphWidth: number;
    /** The right axis's rail (#1750): the column after every row's plot where the Plan declares one, which a chart row's
     *  right axis reads its numbers in. */
    railWidth: number;
    // ── A time axis's columns (#1740): the period is the finest offered whose column holds the floor ──
    /** The column floor: the narrowest column a period is picked at — a tile at its floor
     *  ({@link PlanGeometry.tileMinWidth}) inside its day's rules, so a day picked always has room for one tile. */
    columnMinWidth: number;
    /** The squeeze floor: the narrowest a change of the plot's width alone leaves a column before its period is picked
     *  again. */
    columnSqueezeWidth: number;
    /** The width a period's preset fills its columns at. */
    columnPresetWidth: number;
}

const DEFAULT: PlanGeometry = {
    row: 32, rule: 1, rowStacked: 42,
    group: 26, groupStrip: 28,
    chartSpark: 32, chartExpanded: 88,
    // A heat row is a single-line row like any other (#949).
    heatRow: 32, heatInset: 3, heatCellMin: 16,
    strip: 16, stripMark: 7,
    tableLine: 11, tablePad: 6,
    lane: 24,
    bar: 20, rollBar: 12,
    tile: 20, chip: 18, weight: 20, segment: 20,
    brush: 38, ruler: 28, footer: 28, lens: 6, brushBar: 28,
    narrowStrip: 24,
    failedBandMin: 64,
    markTriangle: 9,
    // A bar's padding is 7 each side and its look's dashed ring 1.5 (17); a
    // chip's 9 and 1.5 (21). A tile's padding gives way to its slot, down to
    // its two 1.5px rings (3).
    barMinWidth: 18, chipMinWidth: 22, tileMinWidth: 20, tileLeastWidth: 3,
    markDotWidth: 10, markDiamondWidth: 11, markTriangleWidth: 10, markIconWidth: 12,
    // A bar's label: Chivo Mono at the bar's 11px draws every glyph 7 across (measured in the showcase, #1680's review).
    barPadWidth: 7, barPadLockedWidth: 4, barGapWidth: 4, lockWidth: 8, barGlyphWidth: 7,
    // The rail, ruled 25 Nov 2026: room for a right axis's three or four figures beside the plot.
    railWidth: 40,
    // A time axis's columns, agreed 24 Nov 2026: the floor is a tile's floor, its inset each side and its day's rule.
    columnMinWidth: 25, columnSqueezeWidth: 10, columnPresetWidth: 50,
};

/** The two densities' tables. Dense tightens the shared row — the heat row
 *  with it — and the bars that sit in it; everything else keeps its size. */
export const PLAN_GEOMETRY: Readonly<Record<"default" | "dense", Readonly<PlanGeometry>>> = {
    default: DEFAULT,
    dense: { ...DEFAULT, row: 24, heatRow: 24, bar: 16 },
};

/** A coarse pointer's horizon band (#1438): a 44px strip under its lens, its bars up to 40. */
const COARSE_BRUSH: Pick<PlanGeometry, "brush" | "brushBar"> = { brush: 50, brushBar: 40 };

/** Each density's table on a coarse pointer, made once. */
const COARSE_GEOMETRY: Readonly<Record<"default" | "dense", Readonly<PlanGeometry>>> = {
    default: { ...PLAN_GEOMETRY.default, ...COARSE_BRUSH },
    dense: { ...PLAN_GEOMETRY.dense, ...COARSE_BRUSH },
};

/**
 * A density's geometry, on the pointer the canvas has.
 *
 * @param dense - Whether the canvas is dense (`density: compact`)
 * @param coarse - Whether the pointer is coarse: the horizon band is taller (#1438)
 * @returns The table
 */
export function planGeometry(dense: boolean, coarse = false): Readonly<PlanGeometry> {
    const tables = coarse ? COARSE_GEOMETRY : PLAN_GEOMETRY;
    return dense ? tables.dense : tables.default;
}

/**
 * The CSS variable a geometry entry is written as — a height `row` →
 * `--plan-row-h`, `heatInset` → `--plan-heat-inset-h`; a width, its key ending
 * `Width`, `barMinWidth` → `--plan-bar-min-w`.
 *
 * @param key - The entry
 * @returns The variable's name
 */
export function planGeometryVar(key: keyof PlanGeometry): `--plan-${string}-${"h" | "w"}` {
    const width = key.endsWith("Width");
    const name = (width ? key.slice(0, -"Width".length) : key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    return `--plan-${name}-${width ? "w" : "h"}`;
}

/**
 * The geometry as the CSS variables the recipe reads — written once, on the
 * canvas body.
 *
 * @param geometry - The canvas's table
 * @returns Variable name → px value
 */
export function planGeometryStyle(geometry: Readonly<PlanGeometry>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of Object.keys(geometry) as (keyof PlanGeometry)[]) {
        out[planGeometryVar(key)] = `${geometry[key]}px`;
    }
    return out;
}
