/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A pie's frame (#1671, CHT-7), as its mock draws it: the pie beside its
 * legend, as `pie.ts` gives its slices — a row a slice, then the legend's
 * note; a donut's total in its centre, over its caption, as much of them as
 * its hole holds at its size (#1692). Its legend shows each slice's value and
 * share, its name alone, or nothing, as the pie says. While its host marks a
 * slice (#1673), every other slice is the muted mark and its legend row off.
 *
 * @packageDocumentation
 */

import { useMemo, type ReactNode } from "react";
import { Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { variant } from "@elaraai/east";
import { Group } from "@visx/group";
import { Pie } from "@visx/shape";
import { useFormatters } from "../../format/index.js";
import { getSomeorUndefined } from "../../utils";
import type { ChartMark, ChartMarkHandler, ChartMarkedTest, ChartNumberText, ChartStyle } from "./context.js";
import { chartMarking, markAttributes } from "./marking.js";
import { measuredFrame } from "./measured.js";
import { DONUT_TOTAL_Y, donutCaptionY, donutCentre, donutRing, pieSlicesOf, type PieSlice, type PieValue } from "./pie.js";
import { tickFormatter } from "./tick-format.js";

/** The narrowest a pie sits beside its legend; narrower, the legend goes under it. */
const PIE_SIDE_MIN = 320;

/** A legend row's height, as the recipe sets an entry. */
const PIE_LEGEND_ROW = 26;

/** The legend's note under its rows: its 15px line and the 4px over it, as the recipe sets it. */
const PIE_NOTE_LINE = 19;

/** The most of its frame's height a pie beside its legend takes: 176 of the mock's 220. */
const PIE_SIDE_SHARE = 0.8;

/** SVG text a recipe styles: the donut's total. */
const SvgText = chakra("text");

/** What a click on a pie's slice, or its legend row, stands for. */
function sliceMark(slice: PieSlice): ChartMark {
    return slice.other
        ? { series: undefined, x: undefined, other: true }
        : { series: undefined, x: variant("category", slice.key), other: false };
}

/**
 * A pie's frame (#1671, CHT-7): the pie beside its legend — under it where
 * the chart is narrow — its slices as `pie.ts` gives them, largest first from
 * twelve o'clock with a 1.5 px gap of the surface between, no labels; a donut
 * a 26 px ring with the total in its centre, over its caption. Each legend row
 * carries the slice's value and share, the values on one scale where the host
 * prints them, its name cut where the row is short of room and whole on hover;
 * the legend's note says what they are. A legend of names
 * alone is the swatch and the name; with no legend the pie stands alone in
 * the middle of its frame. Where the legend does not say a slice's value, the
 * slice says it — its name, its value and its share — where the pointer
 * rests. A donut's ring narrows with a donut smaller than the mock's, and its
 * centre holds as much as its hole does: the total over its caption, the
 * total smaller, or nothing (`donutCentre`); its plot says the hole's radius
 * (`data-chart-pie-hole`), which a reader of the page measures the centre
 * against. A donut says in its caption what a pie's note says, and draws its
 * note under its legend only where its hole cannot hold the caption. A slice
 * and its legend row tell the host when clicked. While the host
 * marks a slice, every other — Other with them — is the muted mark, and its
 * legend row off: the swatch muted, the words the recipe's.
 */
export function PieFrame({ pie, height, width, style, onMark, numberText, marked }: {
    pie: PieValue; height: number; width: number | undefined; style: ChartStyle; onMark: ChartMarkHandler | undefined; numberText: ChartNumberText | undefined; marked: ChartMarkedTest | undefined;
}): ReactNode {
    const words = useFormatters();
    const recipe = useSlotRecipe({ key: "chartPie" });
    const shown = useMemo(() => pieSlicesOf(pie, "Other"), [pie]);
    // What the host marks of its slices (#1673).
    const marking = useMemo(() => chartMarking(marked, shown.slices.map(sliceMark)), [marked, shown]);
    const format = getSomeorUndefined(pie.format);
    const fmt = tickFormatter(format, "linear", words.locale);
    // A value as the host prints it beside the largest it is read with, else through the pie's own format.
    const said = (n: number, of: number) => (numberText !== undefined ? numberText(n, format, of) : fmt(n));
    const largest = shown.slices.reduce((most, slice) => Math.max(most, slice.value), 0);
    const caption = getSomeorUndefined(pie.caption);
    // What the legend shows: each slice's value and share unless the pie says its names alone, or nothing.
    const legend = getSomeorUndefined(pie.legend)?.type ?? "values";
    // The note says what the legend's values are: it goes with them.
    const note = legend === "values" ? getSomeorUndefined(pie.note) : undefined;
    const total = said(shown.total, shown.total);
    const draw = (w: number, h: number) => {
        // With no legend the pie has the frame to itself; else beside its legend where there is room, over it where not.
        const layout = legend !== "hidden" && w >= PIE_SIDE_MIN ? "side" : "below";
        const styles = recipe({ layout });
        const rows = legend === "hidden" ? 0 : shown.slices.length;
        // The pie at its size, its note under its legend or not: its width, its hole, and as much of a donut's centre as the hole holds (#1692).
        const placed = (noted: boolean) => {
            const legendH = layout === "below" ? rows * PIE_LEGEND_ROW + (noted ? PIE_NOTE_LINE : 0) : 0;
            // An even number of pixels across, a whole number from its frame's edges: its centre stands on a whole pixel.
            const across = 2 * Math.floor(Math.max(0, Math.min(layout === "side" ? Math.min(w * 0.45, h * PIE_SIDE_SHARE) : w, h - legendH)) / 2);
            const hole = pie.donut ? Math.max(0, across / 2 - donutRing(across)) : 0;
            return { across, hole, centre: pie.donut ? donutCentre(hole, total, caption) : undefined };
        };
        // A pie draws its note; a donut says in its centre what its note would, and draws the note only where its hole cannot hold the caption.
        const bare = placed(note !== undefined && !pie.donut);
        const noted = note !== undefined && (!pie.donut || bare.centre?.caption !== true);
        const { across: diameter, hole: inner, centre } = noted && pie.donut ? placed(true) : bare;
        // Beside its legend, in the middle of its frame's height; over one, of its width; alone, of both.
        const fromTop = layout === "side" || legend === "hidden" ? Math.max(0, Math.floor((h - diameter) / 2)) : 0;
        const fromStart = layout === "below" ? Math.max(0, Math.floor((w - diameter) / 2)) : 0;
        const outer = diameter / 2;
        return (
            <Box css={styles.root} data-chart-pie="" data-layout={layout} data-legend={legend} style={{ height: `${h}px` }}>
                <Box as="svg" css={styles.plot} data-chart-pie-hole={pie.donut ? inner : undefined}
                    style={{ width: `${diameter}px`, height: `${diameter}px`, marginTop: `${fromTop}px`, marginInlineStart: `${fromStart}px` }}>
                    <Group top={outer} left={outer}>
                        <Pie<PieSlice> data={[...shown.slices]} pieValue={s => s.value} pieSort={null} pieSortValues={null}
                            outerRadius={outer} innerRadius={inner} startAngle={0} endAngle={Math.PI * 2}>
                            {p => p.arcs.map(arc => {
                                const state = marking?.(sliceMark(arc.data));
                                return (
                                    <path key={arc.data.key} d={p.path(arc) ?? ""} fill={state === "dimmed" ? style.muted : style.color(arc.data.color)} stroke={style.pointFill} strokeWidth={1.5}
                                        data-chart-slice={arc.data.key} {...(arc.data.other ? { "data-other": "" } : {})} {...markAttributes(state)}
                                        {...(onMark !== undefined ? { cursor: "pointer", onClick: () => onMark(sliceMark(arc.data)) } : {})}>
                                        {legend !== "values" && <title>{`${arc.data.key} · ${said(arc.data.value, largest)} · ${words.percent(arc.data.share)}`}</title>}
                                    </path>
                                );
                            })}
                        </Pie>
                        {centre !== undefined && (
                            <SvgText css={styles.total} y={centre.caption ? DONUT_TOTAL_Y : 0} textAnchor="middle" dominantBaseline="central"
                                data-chart-pie-total="" data-total-size={centre.size}>{total}</SvgText>
                        )}
                        {centre?.caption === true && (
                            // Placed by its group: the caption's place is the hole's geometry, its type the recipe's.
                            <g transform={`translate(0 ${donutCaptionY(centre.size)})`}>
                                <SvgText css={styles.caption} textAnchor="middle" dominantBaseline="central" data-chart-pie-caption="">{caption}</SvgText>
                            </g>
                        )}
                    </Group>
                </Box>
                {legend !== "hidden" && (
                    <Box css={styles.legend} data-chart-pie-legend={legend}>
                        {shown.slices.map(s => {
                            const state = marking?.(sliceMark(s));
                            return (
                                <Box key={s.key} css={styles.entry} data-chart-slice-entry={s.key} {...(s.other ? { "data-other": "" } : {})} {...markAttributes(state)}
                                    {...(legend === "names" ? { "data-names": "" } : {})}
                                    {...(onMark !== undefined ? { as: "button" as const, type: "button" as const, "data-clickable": "", onClick: () => onMark(sliceMark(s)) } : {})}>
                                    <Box as="span" css={styles.swatch} background={state === "dimmed" ? style.muted : style.color(s.color)} />
                                    {/* Cut with an ellipsis where its row is short of room: whole on hover. */}
                                    <Box as="span" css={styles.label} title={s.key}>{s.key}</Box>
                                    {legend === "values" && <Box as="span" css={styles.value}>{said(s.value, largest)}</Box>}
                                    {legend === "values" && <Box as="span" css={styles.share}>{words.percent(s.share)}</Box>}
                                </Box>
                            );
                        })}
                        {/* On its one line, cut where it runs past: whole on hover. */}
                        {noted && <Box css={styles.note} data-chart-pie-note="" title={note}>{note}</Box>}
                    </Box>
                )}
            </Box>
        );
    };
    return measuredFrame(height, width, (w, h) => draw(w, h ?? height));
}
