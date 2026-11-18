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
import { labelWidth, tickPx, tickTextCss, ticksThatFit, titleTextCss } from "./labels.js";
import { tickFormatter } from "./tick-format.js";

// Axis labels carry their font via inline `style` (visx forwards it) so the mono
// size wins over the CSS cascade; tick text is formatted per the axis node.
export function AxisBMark({ value }: { value: Axis }): ReactNode {
    const { xAxisScale, xTickValues, xKind, horizontal, innerW, innerH, margin, style } = useScales();
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), xKind, useFormatters().locale);
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
    const scale = xAxisScale as unknown as { (v: unknown): number; domain: () => unknown[]; ticks?: (count: number) => unknown[]; bandwidth?: () => number };
    const counted = (count: number): unknown[] => {
        if (scale.ticks !== undefined) return scale.ticks(count);
        const all = scale.domain();
        const stride = Math.max(1, Math.round((all.length - 1) / count));
        return all.length <= count ? all : all.filter((_, i) => i % stride === 0);
    };
    const wanted: unknown[] = explicitTicks !== undefined ? [...explicitTicks.value]
        : numTicks !== undefined ? counted(Number(numTicks))
            : xTickValues ?? scale.domain();
    // The chart rules (#1671): no two labels overlap — as many as fit side by
    // side keep theirs, the first and the last among them, whatever their
    // length and the plot's width (#354 thinned only compact plots, by a fixed
    // 64px a label). The author's own tick values stand as given.
    // A label that would cross the chart's edge is drawn from that edge in:
    // the first from its tick on, the last up to its tick.
    const placed = (v: unknown) => {
        const at = Number(scale(v)) + (scale.bandwidth?.() ?? 0) / 2;
        const width = labelWidth(fmt(v), px);
        const anchor = at - width / 2 < -margin.left ? "start" as const : at + width / 2 > innerW + margin.right ? "end" as const : "middle" as const;
        const from = anchor === "start" ? at : anchor === "end" ? at - width : at - width / 2;
        return { value: v, at, from, to: from + width, anchor };
    };
    const tickValues = explicitTicks !== undefined ? wanted : ticksThatFit(wanted.map(placed));
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
    const { y, yAxisScale, horizontal, innerH, yTitleX, style } = useScales();
    // Horizontal frames (#249): the left axis is the category band — format
    // as band labels, show every category (visx subsamples only past its
    // default tick budget, mirroring the vertical band x-axis), and keep the
    // baseline rule (the categorical baseline the bars sit on).
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), horizontal ? "band" : "linear", useFormatters().locale);
    const label = getSomeorUndefined(value.label);
    const explicitTicks = getSomeorUndefined(value.tickValues);
    const tickValues = explicitTicks !== undefined ? [...explicitTicks.value] : undefined;
    const numTicks = getSomeorUndefined(value.numTicks);
    const tickCss = tickTextCss(style, getSomeorUndefined(value.tickStyle));
    const titleCss = titleTextCss(style, getSomeorUndefined(value.titleStyle));
    return (
        <>
            <AxisLeft
                scale={horizontal ? yAxisScale : y}
                {...(horizontal
                    ? (numTicks !== undefined ? { numTicks: Number(numTicks) } : {})
                    : { numTicks: Number(numTicks ?? 4) })}
                hideAxisLine={getSomeorUndefined(value.hideLine) ?? !horizontal}
                hideTicks={getSomeorUndefined(value.hideTicks) ?? true}
                {...(horizontal ? { stroke: style.axisStroke } : {})}
                {...(tickValues ? { tickValues } : {})}
                tickFormat={v => fmt(v)}
                tickLabelProps={() => ({ textAnchor: "end", dx: "-0.25em", dy: "0.25em", style: tickCss })}
            />
            {label && <text transform={`translate(${yTitleX}, ${innerH / 2}) rotate(-90)`} textAnchor="middle" style={titleCss}>{label}</text>}
        </>
    );
}
export function AxisRMark({ value }: { value: Axis }): ReactNode {
    const { y, y2, innerW, innerH, y2TitleX, style } = useScales();
    const scale = y2 ?? y;
    const fmt = tickFormatter(getSomeorUndefined(value.tickFormat), "linear", useFormatters().locale);
    const label = getSomeorUndefined(value.label);
    const explicitTicks = getSomeorUndefined(value.tickValues);
    const tickValues = explicitTicks !== undefined ? [...explicitTicks.value] : undefined;
    const tickCss = tickTextCss(style, getSomeorUndefined(value.tickStyle));
    const titleCss = titleTextCss(style, getSomeorUndefined(value.titleStyle));
    return (
        <>
            <AxisRight
                left={innerW}
                scale={scale}
                numTicks={Number(getSomeorUndefined(value.numTicks) ?? 4)}
                hideAxisLine={getSomeorUndefined(value.hideLine) ?? true}
                hideTicks={getSomeorUndefined(value.hideTicks) ?? true}
                {...(tickValues ? { tickValues } : {})}
                tickFormat={v => fmt(v)}
                tickLabelProps={() => ({ textAnchor: "start", dx: "0.25em", dy: "0.25em", style: tickCss })}
            />
            {label && <text transform={`translate(${y2TitleX}, ${innerH / 2}) rotate(90)`} textAnchor="middle" style={titleCss}>{label}</text>}
        </>
    );
}
export function GridRowsMark({ value }: { value: ValueTypeOf<typeof T.Grid> }): ReactNode {
    const { y, yAxisScale, horizontal, innerW, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    const numTicks = getSomeorUndefined(value.numTicks);
    // Horizontal frames (#249): rows follow the band y — one centred line per
    // category (mirroring the vertical band x-columns), so no tick-count
    // default; the measure gridlines are the columns.
    if (horizontal) {
        return <GridRows scale={yAxisScale} width={innerW} {...(numTicks !== undefined ? { numTicks } : {})} stroke={style.gridStroke} {...(dash ? { strokeDasharray: dash } : {})} />;
    }
    return <GridRows scale={y} width={innerW} numTicks={numTicks ?? 4} stroke={style.gridStroke} {...(dash ? { strokeDasharray: dash } : {})} />;
}
export function GridColsMark({ value }: { value: ValueTypeOf<typeof T.Grid> }): ReactNode {
    const { xAxisScale, horizontal, innerH, style } = useScales();
    const dash = getSomeorUndefined(value.dashArray);
    // Horizontal frames (#249): the columns follow the measure x — default to
    // the measure-axis tick count so gridlines land on the axis ticks.
    return <GridColumns scale={xAxisScale} height={innerH} {...(horizontal ? { numTicks: getSomeorUndefined(value.numTicks) ?? 4 } : {})} stroke={style.gridStroke} {...(dash ? { strokeDasharray: dash } : {})} />;
}
