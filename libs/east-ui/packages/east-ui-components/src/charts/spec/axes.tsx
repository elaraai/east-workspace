/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A chart's axes and gridlines, each derived from the frame's matching
 * scale: the bottom, left and right axes, whose labels never overlap or
 * cross the chart's edge (the chart rules; #1671), and the grid's rows and
 * columns.
 *
 * @packageDocumentation
 */

import type { ReactNode } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import { AxisBottom, AxisLeft, AxisRight } from "@visx/axis";
import { GridRows, GridColumns } from "@visx/grid";
import { useFormatters } from "../../format/index.js";
import { getSomeorUndefined } from "../../utils";
import { T, useScales, type Axis } from "./context.js";
import { LINE_GAP, cutLabel, labelLine, labelWidth, tickPx, tickTextCss, ticksThatFit, titleTextCss } from "./labels.js";
import { domainReach, measureFormatter, tickFormatter } from "./tick-format.js";

/** An axis's scale, as its ticks read it: a position for a value, its domain, and a linear's or a time's ticks or a band's width. */
type TickScale = { (v: unknown): number; domain: () => unknown[]; ticks?: (count: number) => unknown[]; bandwidth?: () => number };

/**
 * A count's ticks over a scale: a continuous scale's own; a band's categories sampled to the count, as visx samples them.
 *
 * @param scale - The axis's scale
 * @param count - How many ticks it asks for
 * @returns The ticks
 */
function ticksOf(scale: TickScale, count: number): unknown[] {
    if (scale.ticks !== undefined) return scale.ticks(count);
    const all = scale.domain();
    const stride = Math.max(1, Math.round((all.length - 1) / count));
    return all.length <= count ? all : all.filter((_, i) => i % stride === 0);
}

/**
 * The ticks an axis beside the plot labels (the chart rules; #1671, #1692): its own tick values, else its scale's for
 * its count — every category of a band given none — and of them, those whose labels clear one another, each a line of
 * its size centred on its tick, its own line's leading and 2 between it and the next (`LINE_GAP`): as many as fit keep
 * theirs, a steady step apart from the first (`ticksThatFit`). A bar chart's bands 16 apart or more each keep their name.
 *
 * @param scale - The axis's scale
 * @param own - The author's own tick values; `undefined` for none
 * @param count - The tick count it asks for; `undefined` for its default
 * @param line - A label's line, px
 * @returns The ticks that keep their labels
 */
function sideTicks(scale: TickScale, own: readonly unknown[] | undefined, count: number | undefined, line: number): unknown[] {
    const wanted = own !== undefined ? [...own] : count === undefined && scale.ticks === undefined ? scale.domain() : ticksOf(scale, count ?? 4);
    const placed = wanted.map((v) => {
        const at = Number(scale(v)) + (scale.bandwidth?.() ?? 0) / 2;
        return { value: v, at, from: at - line / 2, to: at + line / 2 };
    });
    // Read down the axis, as they stand; kept in the order they were asked for.
    const kept = ticksThatFit(placed.sort((a, b) => a.at - b.at), LINE_GAP);
    return wanted.filter(v => kept.includes(v));
}

// Axis labels carry their font via inline `style` (visx forwards it) so the mono
// size wins over the CSS cascade; tick text is formatted per the axis node.
export function AxisBMark({ value }: { value: Axis }): ReactNode {
    const { xAxisScale, xTickValues, xKind, horizontal, innerW, innerH, margin, numberText, style } = useScales();
    const locale = useFormatters().locale;
    // A numeric x is a measure — a horizontal frame's values, a scatter's x — which the host's printer prints.
    const fmt = xKind === "linear"
        ? measureFormatter(numberText, getSomeorUndefined(value.tickFormat), domainReach(xAxisScale as unknown as { domain: () => unknown[] }), locale)
        : tickFormatter(getSomeorUndefined(value.tickFormat), xKind, locale);
    const label = getSomeorUndefined(value.label);
    // #149 — explicit tick control (numTicks / tickValues / hideTicks / hideLine).
    // Explicit `tickValues` win over the band scale's category positions; defaults
    // preserve today's look (ticks hidden, baseline shown on the x-axis).
    // Horizontal frames (#249): the bottom axis is the numeric measure, so it
    // takes the measure-axis defaults instead — ~4 nice ticks, no baseline
    // rule (the baseline follows the band axis, on the left).
    const numTicks = getSomeorUndefined(value.numTicks) ?? (horizontal ? 4 : undefined);
    // Pin to the data-point positions by default — UNLESS the caller asked for an
    // explicit `numTicks` (#149); otherwise the default would shadow numTicks on x
    // (visx prefers tickValues over numTicks), unlike the y / y2 axes.
    // #318 — tickValues is a scale-kind variant (number | time); both arms
    // decode to arrays visx maps directly onto the linear / time scale.
    const explicitTicks = getSomeorUndefined(value.tickValues);
    const tickStyle = getSomeorUndefined(value.tickStyle);
    const px = tickPx(style, tickStyle);
    // The ticks the axis would label: the author's as given; a tick count's
    // from the scale (a band's categories sampled to it, as visx samples
    // them); else every data point of a continuous x, or every category.
    const scale = xAxisScale as unknown as TickScale;
    const wanted: unknown[] = explicitTicks !== undefined ? [...explicitTicks.value]
        : numTicks !== undefined ? ticksOf(scale, Number(numTicks))
            : xTickValues ?? scale.domain();
    // The chart rules (#1671): no two labels overlap — as many as fit side by
    // side keep theirs, a steady step apart from the first, the last among
    // them where a step that lands on it keeps as many (`ticksThatFit`),
    // whatever their length and the plot's width (#354 thinned only compact
    // plots, by a fixed 64px a label) — the author's own tick values too,
    // where the plot is too narrow for every one of them (#1692).
    // A label that would cross the chart's edge is drawn from that edge in:
    // the first from its tick on, the last up to its tick. So is a date at
    // the plot's own edge — a time axis that runs edge to edge — whose label
    // would otherwise hang half outside the plot.
    const placed = (v: unknown) => {
        const at = Number(scale(v)) + (scale.bandwidth?.() ?? 0) / 2;
        const width = labelWidth(fmt(v), px);
        const atEdge = xKind !== "time" ? undefined : at <= 0.5 ? "start" as const : at >= innerW - 0.5 ? "end" as const : undefined;
        const anchor = atEdge ?? (at - width / 2 < -margin.left ? "start" as const : at + width / 2 > innerW + margin.right ? "end" as const : "middle" as const);
        const from = anchor === "start" ? at : anchor === "end" ? at - width : at - width / 2;
        return { value: v, at, from, to: from + width, anchor };
    };
    const tickValues = ticksThatFit(wanted.map(placed));
    const anchorOf = (v: unknown): "start" | "middle" | "end" => placed(v).anchor;
    const hideTicks = getSomeorUndefined(value.hideTicks) ?? true;
    const hideLine = getSomeorUndefined(value.hideLine) ?? horizontal;
    const tickCss = tickTextCss(style, tickStyle);
    const titleCss = titleTextCss(style, getSomeorUndefined(value.titleStyle));
    return (
        <>
            <AxisBottom
                top={innerH}
                scale={xAxisScale}
                stroke={style.axisStroke}
                hideTicks={hideTicks}
                hideAxisLine={hideLine}
                tickValues={tickValues as never[]}
                tickFormat={v => fmt(v)}
                tickLabelProps={v => ({ textAnchor: anchorOf(v), dy: "0.25em", style: tickCss })}
            />
            {label && <text x={innerW / 2} y={innerH + margin.bottom - 2} textAnchor="middle" style={titleCss}>{label}</text>}
        </>
    );
}
export function AxisLMark({ value }: { value: Axis }): ReactNode {
    const { y, yAxisScale, horizontal, innerH, yTitleX, numberText, style, nameRoom } = useScales();
    const locale = useFormatters().locale;
    // Horizontal frames (#249): the left axis is the category band — format
    // as band labels, as many of its categories as fit (#1692), and keep the
    // baseline rule (the categorical baseline the bars sit on).
    const fmt = horizontal
        ? tickFormatter(getSomeorUndefined(value.tickFormat), "band", locale)
        : measureFormatter(numberText, getSomeorUndefined(value.tickFormat), domainReach(y), locale);
    const label = getSomeorUndefined(value.label);
    const explicitTicks = getSomeorUndefined(value.tickValues);
    const numTicks = getSomeorUndefined(value.numTicks);
    const tickStyle = getSomeorUndefined(value.tickStyle);
    const px = tickPx(style, tickStyle);
    // Its labels never overlap: a band's categories and the author's own ticks thinned as a measure's are (#1692).
    const tickValues = sideTicks((horizontal ? yAxisScale : y) as unknown as TickScale, explicitTicks?.value,
        numTicks === undefined ? (horizontal ? undefined : 4) : Number(numTicks), labelLine(px));
    // A band's names beside a plot too narrow for them are cut, their whole in the plot's tooltip (#1692).
    const tickText = (v: unknown): string => (horizontal ? cutLabel(fmt(v), nameRoom, px) : fmt(v));
    const tickCss = tickTextCss(style, tickStyle);
    const titleCss = titleTextCss(style, getSomeorUndefined(value.titleStyle));
    return (
        <>
            <AxisLeft
                scale={horizontal ? yAxisScale : y}
                hideAxisLine={getSomeorUndefined(value.hideLine) ?? !horizontal}
                hideTicks={getSomeorUndefined(value.hideTicks) ?? true}
                {...(horizontal ? { stroke: style.axisStroke } : {})}
                tickValues={tickValues as never[]}
                tickFormat={v => tickText(v)}
                tickLabelProps={() => ({ textAnchor: "end", dx: "-0.25em", dy: "0.25em", style: tickCss })}
            />
            {label && <text transform={`translate(${yTitleX}, ${innerH / 2}) rotate(-90)`} textAnchor="middle" style={titleCss}>{label}</text>}
        </>
    );
}
export function AxisRMark({ value }: { value: Axis }): ReactNode {
    const { y, y2, innerW, innerH, y2TitleX, numberText, style } = useScales();
    const scale = y2 ?? y;
    const fmt = measureFormatter(numberText, getSomeorUndefined(value.tickFormat), domainReach(scale), useFormatters().locale);
    const label = getSomeorUndefined(value.label);
    const explicitTicks = getSomeorUndefined(value.tickValues);
    const tickStyle = getSomeorUndefined(value.tickStyle);
    // Its labels never overlap, as the left axis's (#1692).
    const tickValues = sideTicks(scale as unknown as TickScale, explicitTicks?.value, Number(getSomeorUndefined(value.numTicks) ?? 4), labelLine(tickPx(style, tickStyle)));
    const tickCss = tickTextCss(style, tickStyle);
    const titleCss = titleTextCss(style, getSomeorUndefined(value.titleStyle));
    return (
        <>
            <AxisRight
                left={innerW}
                scale={scale}
                hideAxisLine={getSomeorUndefined(value.hideLine) ?? true}
                hideTicks={getSomeorUndefined(value.hideTicks) ?? true}
                tickValues={tickValues as never[]}
                tickFormat={v => fmt(v)}
                tickLabelProps={() => ({ textAnchor: "start", dx: "0.25em", dy: "0.25em", style: tickCss })}
            />
            {label && <text transform={`translate(${y2TitleX}, ${innerH / 2}) rotate(90)`} textAnchor="middle" style={titleCss}>{label}</text>}
        </>
    );
}
export function GridRowsMark({ value }: { value: ValueTypeOf<typeof T.Grid> }): ReactNode {
    const { y, yAxisScale, horizontal, innerW, leftTicks, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    const numTicks = getSomeorUndefined(value.numTicks);
    // Horizontal frames (#249): rows follow the band y — one centred line per
    // category (mirroring the vertical band x-columns), so no tick-count
    // default; the measure gridlines are the columns.
    if (horizontal) {
        return <GridRows scale={yAxisScale} width={innerW} {...(numTicks !== undefined ? { numTicks } : {})} stroke={style.gridStroke} {...(dash ? { strokeDasharray: dash } : {})} />;
    }
    // A row at each tick the left axis labels: its own tick values where it gives them, else the scale's.
    return <GridRows scale={y} width={innerW} {...(leftTicks !== undefined ? { tickValues: leftTicks } : { numTicks: numTicks ?? 4 })} stroke={style.gridStroke} {...(dash ? { strokeDasharray: dash } : {})} />;
}
export function GridColsMark({ value }: { value: ValueTypeOf<typeof T.Grid> }): ReactNode {
    const { xAxisScale, horizontal, innerH, bottomTicks, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    // Horizontal frames (#249): the columns follow the measure x — at the
    // bottom axis's own tick values where it gives them, else the
    // measure-axis tick count, so gridlines land on the axis ticks.
    const ticks = !horizontal ? {} : bottomTicks !== undefined ? { tickValues: bottomTicks } : { numTicks: getSomeorUndefined(value.numTicks) ?? 4 };
    return <GridColumns scale={xAxisScale} height={innerH} {...ticks} stroke={style.gridStroke} {...(dash ? { strokeDasharray: dash } : {})} />;
}
