/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a chart frame shares with its marks: the spec's decoded types, the
 * key a typed x coordinate is matched by, the chrome resolved from the
 * theme, and the scales and inner size a `frame` derives from its data and
 * provides to its descendants (`ScaleContext`). The renderer's marks, axes
 * and frame read these; nothing here draws.
 *
 * @packageDocumentation
 */

import { createContext, useContext } from "react";
import { DateTimeType, FloatType, match, parseFor, printFor, type ValueTypeOf } from "@elaraai/east";
import { Chart } from "@elaraai/east-ui/internal";
import type { scaleLinear } from "@visx/scale";
import type { AxisScale } from "@visx/axis";
import { getSomeorUndefined } from "../../utils";

export const T = Chart.Spec.Types;
export type Spec = ValueTypeOf<typeof T.Spec>;
export type Curve = ValueTypeOf<typeof T.Curve>;
export type Anchor = ValueTypeOf<typeof T.Anchor>;
export type Point = ValueTypeOf<typeof T.Point>;
export type Series = ValueTypeOf<typeof T.Series>;
export type BandSeries = ValueTypeOf<typeof T.BandSeries>;
export type XCoord = ValueTypeOf<typeof T.XCoord>;
export type TickFormat = ValueTypeOf<typeof T.TickFormat>;
export type Domain = ValueTypeOf<typeof T.Domain>;
export type Axis = ValueTypeOf<typeof T.Axis>;
export type SeriesMark = ValueTypeOf<typeof T.SeriesMark>;
export type Margin = { top: number; right: number; bottom: number; left: number };
export type ScaleKind = "band" | "linear" | "time";

/**
 * A mark of a chart that was clicked (#1671, CHT-8): what the click stands for.
 *
 * @remarks
 * - A bar, a point, an area's band or a line's point: its series and its x.
 * - Elsewhere in the plot at an x: that x, and no series — every series there.
 * - A legend row: its series, and no x.
 * - A pie's slice or its legend row: the slice's key as a category x, and no
 *   series; Other's says `other`, and has no x.
 */
export interface ChartMark {
    /** The series the mark is of, by its key; `undefined` for an x of every series, and for a pie's slice. */
    readonly series: string | undefined;
    /** The x the mark is at, as the chart holds it; `undefined` for a legend row's series and for a pie's Other. */
    readonly x: XCoord | undefined;
    /** Whether it is a pie's Other: every slice past the first ones. */
    readonly other: boolean;
}

/** What a chart tells its host when a mark is clicked. */
export type ChartMarkHandler = (mark: ChartMark) => void;

/**
 * Whether a chart's host marks one of its marks (#1673): a click's selection,
 * or the groups a filter its click made holds.
 *
 * @param mark - The mark: a bar, a point or a line's point, a legend row, a pie's slice or its legend row
 * @returns `true` for a mark the host marks; `false` for one it leaves
 *   unmarked; `undefined` for one that stands for no group — a legend row that
 *   names a value — which is drawn as it is whatever is marked
 */
export type ChartMarkedTest = (mark: ChartMark) => boolean | undefined;

/** How a chart draws a mark by what its host marks (`marking.ts`): `marked`, `dimmed` — in the muted mark — or as it is. */
export type ChartMarkState = "marked" | "dimmed" | undefined;

/** A chart's marking while its host marks any of its marks (`marking.ts`): how each mark is drawn. */
export type ChartMarking = (mark: ChartMark) => ChartMarkState;

/**
 * How a host prints a number a chart shows where room is short (#1671): a
 * measure axis's tick, a pie's values and its total. A chart given none
 * prints through its axis's declared format (`tick-format.ts`).
 *
 * @param n - The number
 * @param format - The format its axis or its pie declares, when it declares one
 * @param of - The largest number it is read beside — its axis's domain end, its pie's largest slice — so the host can keep them on one scale
 * @returns The text
 */
export type ChartNumberText = (n: number, format: TickFormat | undefined, of: number) => string;

const printNumberKey = printFor(FloatType);
const printInstantKey = printFor(DateTimeType);
const readNumberKey = parseFor(FloatType);
const readInstantKey = parseFor(DateTimeType);

/**
 * A stable string key for a typed x coordinate — the band category as-is, a
 * number or an instant as East prints it: the spelling the Chart factory
 * gives a `rule`'s `at` (`East.print`), so a rule lands on its coordinate.
 * Used for the band domain and hover matching, and read back with East's
 * parser for the `time` / `linear` scales ({@link numberOfKey},
 * {@link instantOfKey}).
 */
export const xKeyOf = (x: XCoord): string => match(x, {
    category: s => s,
    number: n => printNumberKey(n),
    time: d => printInstantKey(d),
});

/** The number a `linear` key names, as East reads a printed Float — `NaN`
 *  for a key that is no Float. */
export function numberOfKey(key: string): number {
    const read = readNumberKey(key);
    return read.success ? read.value : NaN;
}

/** The instant a `time` key names, as East reads a printed DateTime — an
 *  invalid Date for a key that is no DateTime. */
export function instantOfKey(key: string): Date {
    const read = readInstantKey(key);
    return read.success ? read.value : new Date(NaN);
}

/** A whole-layer style read off a `series` node and threaded to its marks. */
export interface LayerStyle {
    curve: Curve | undefined;
    strokeWidth: number | undefined;
    dashArray: string | undefined;
    dots: boolean | undefined;
    fillOpacity: number | undefined;
    radius: number | undefined;
    opacity: number | undefined;
}

/**
 * Resolved chart chrome, drawn from the design tokens via Chakra's own resolver
 * (`system.token`) so the chart re-themes. `color` resolves a data-driven series
 * token the same way. Threaded to every mark via {@link ScaleContext}.
 */
export interface ChartStyle {
    /** Mono font stack for axis ticks + text labels. */
    font: string;
    /** Tick / text label size (CSS length). */
    labelSize: string;
    /** Tick / text label colour. */
    labelColor: string;
    /** Axis baseline + tick stroke. */
    axisStroke: string;
    /** Gridline stroke. */
    gridStroke: string;
    /** Default line / area stroke width. */
    lineWidth: number;
    /** Default filled-area opacity. */
    areaOpacity: number;
    /** Point-marker fill (the surface, so the line reads through). */
    pointFill: string;
    /** Point-marker stroke width. */
    pointStrokeWidth: number;
    /** Radius of the dot markers on a line series. */
    dotRadius: number;
    /** Radius of a scatter-series marker (slightly larger, filled). */
    scatterRadius: number;
    /** Bar corner radius. */
    barRadius: number;
    /** Emphasis colour for annotation marks (reference dot / labels). */
    accent: string;
    /** The muted mark (`--ink-5`): a mark its host leaves unmarked while it marks another (#1673). */
    muted: string;
    /** Stacking tier for the hover tooltip's portal — the design system's `zIndex.tooltip`
     *  token (top of the overlay stack), so the tooltip sits above sticky chart-chrome
     *  (Plan / Table sticky headers), drawers, dialogs and popovers rather than under them. */
    tooltipZIndex: number;
    /** Resolve a data-driven token (e.g. a series colour) to a CSS value. */
    color: (token: string) => string;
    /** Resolve a theme font-family tag (`sans` / `serif` / `mono`) to its stack (#315). */
    fontFor: (tag: string) => string;
    /** Default axis-TITLE font stack — the sans/UI font (titles read better than the mono tick chrome; #327). */
    titleFont: string;
    /** Default axis-TITLE colour — full-contrast `fg.default` (not the muted tick colour). */
    titleColor: string;
}

/** A numeric `[min, max]` from a {@link Domain} (time arm via epoch ms). */
export function domainBounds(d: Domain): [number, number] {
    return match(d, {
        number: ({ min, max }) => [min, max] as [number, number],
        time: ({ min, max }) => [min.getTime(), max.getTime()] as [number, number],
    });
}

/** Which y-axis a layer binds to (default left). */
export function sideOf(sm: SeriesMark): "left" | "right" {
    const s = getSomeorUndefined(sm.axis);
    return s ? match(s, { left: () => "left" as const, right: () => "right" as const }) : "left";
}

/** A measure scale: values to screen y, or to screen x in a horizontal frame. */
export type YScale = ReturnType<typeof scaleLinear<number>>;

// Shared scales + inner dims + resolved chrome, provided by the `frame` to its
// descendants. The x-scale is band / time / linear (per the frame's `xScale`);
// marks stay scale-agnostic via `cx` (centre-x for a point); `y2` is the optional
// right scale for dual-axis layers. A horizontal frame (#249) swaps the roles:
// the band domain runs along y and the numeric measure along x.
interface ScaleCtx {
    cx: (p: Point) => number;
    /** Position of a domain key along its axis — screen x normally, screen **y**
     *  in a horizontal frame (used by bars / rules / bands / hover). */
    cxKey: (key: string) => number;
    bandWidth: number;
    xAxisScale: AxisScale;
    /** The left-axis scale — the measure `y` scale normally; the band domain
     *  scale in a horizontal frame (#249). */
    yAxisScale: AxisScale;
    /** Tick values to pin a continuous x axis to the data points (band: undefined). */
    xTickValues: Array<number | Date> | undefined;
    xKind: ScaleKind;
    /** Horizontal frame (#249): the frame's `yScale` is `band` — bars grow
     *  along x, `cxKey` gives a domain key's centre y, and `y` is the measure
     *  scale mapping values to screen **x**. */
    horizontal: boolean;
    y: ReturnType<typeof scaleLinear<number>>;
    y2: ReturnType<typeof scaleLinear<number>> | undefined;
    /** Map a per-point scatter `size` value to a marker radius (area-proportional). */
    sizeR: ((v: number) => number) | undefined;
    innerW: number;
    innerH: number;
    margin: Margin;
    /** x of the rotated y-axis title — pinned to its NATURAL margin (just past the
     *  tick labels), not the gutter-widened `margin.left`, so a shared plotGutter
     *  doesn't fling the title to the far left away from the axis (#147). */
    yTitleX: number;
    /** x of the rotated y2-axis title — natural right margin (mirror of yTitleX). */
    y2TitleX: number;
    /** The host's printer for a measure's numbers; the axis's own format without it. */
    numberText: ChartNumberText | undefined;
    /** The left axis's own tick values, which the grid's rows are drawn at; `undefined` leaves the rows to the scale. */
    leftTicks: number[] | undefined;
    /** A horizontal frame's bottom axis's own tick values, which the grid's columns are drawn at; `undefined` leaves them to the scale. */
    bottomTicks: number[] | undefined;
    /** How each mark is drawn by what the host marks (#1673); `undefined` while it marks none. */
    marking: ChartMarking | undefined;
    style: ChartStyle;
    /** The room a horizontal frame's band names have beside a plot too narrow for them, px (#1692): past it a name is cut, its whole in the tooltip; `undefined` for as much as they need. */
    nameRoom: number | undefined;
}
export const ScaleContext = createContext<ScaleCtx | null>(null);
export const useScales = (): ScaleCtx => {
    const c = useContext(ScaleContext);
    if (!c) throw new Error("ChartSpec mark rendered outside a frame");
    return c;
};
/** Centre-x accessor for a point (band centre / time / linear position). */
export const useCx = () => useScales().cx;
