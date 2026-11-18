/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A pie's frame (#1671, CHT-7): the pie beside its legend, as `pie.ts` gives
 * its slices.
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
import type { ChartMark, ChartMarkHandler, ChartStyle } from "./context.js";
import { measuredFrame } from "./measured.js";
import { pieSlicesOf, type PieSlice, type PieValue } from "./pie.js";
import { tickFormatter } from "./tick-format.js";

/** The narrowest a pie sits beside its legend; narrower, the legend goes under it. */
const PIE_SIDE_MIN = 320;

/** A legend row's height under a pie, as the recipe sets an entry. */
const PIE_LEGEND_ROW = 20;

/** A donut's ring, in px (CHT-7). */
const DONUT_RING = 26;

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
 * a 26 px ring with the total in its centre. Each legend row carries the
 * slice's value and share. A slice and its legend row tell the host when
 * clicked.
 */
export function PieFrame({ pie, height, width, style, onMark }: { pie: PieValue; height: number; width: number | undefined; style: ChartStyle; onMark: ChartMarkHandler | undefined }): ReactNode {
    const words = useFormatters();
    const recipe = useSlotRecipe({ key: "chartPie" });
    const shown = useMemo(() => pieSlicesOf(pie, "Other"), [pie]);
    const fmt = tickFormatter(getSomeorUndefined(pie.format), "linear", words.locale);
    const draw = (w: number, h: number) => {
        const layout = w >= PIE_SIDE_MIN ? "side" : "below";
        const styles = recipe({ layout });
        const legendH = layout === "below" ? shown.slices.length * PIE_LEGEND_ROW : 0;
        const diameter = Math.max(0, Math.floor(Math.min(layout === "side" ? w * 0.45 : w, h - legendH)));
        const outer = diameter / 2;
        const inner = pie.donut ? Math.max(0, outer - DONUT_RING) : 0;
        return (
            <Box css={styles.root} data-chart-pie="" data-layout={layout} style={{ height: `${h}px` }}>
                <Box as="svg" css={styles.plot} style={{ width: `${diameter}px`, height: `${diameter}px` }}>
                    <Group top={outer} left={outer}>
                        <Pie<PieSlice> data={[...shown.slices]} pieValue={s => s.value} pieSort={null} pieSortValues={null}
                            outerRadius={outer} innerRadius={inner} startAngle={0} endAngle={Math.PI * 2}>
                            {p => p.arcs.map(arc => (
                                <path key={arc.data.key} d={p.path(arc) ?? ""} fill={style.color(arc.data.color)} stroke={style.pointFill} strokeWidth={1.5}
                                    data-chart-slice={arc.data.key} {...(arc.data.other ? { "data-other": "" } : {})}
                                    {...(onMark !== undefined ? { cursor: "pointer", onClick: () => onMark(sliceMark(arc.data)) } : {})} />
                            ))}
                        </Pie>
                        {pie.donut && <SvgText css={styles.total} textAnchor="middle" dominantBaseline="central">{fmt(shown.total)}</SvgText>}
                    </Group>
                </Box>
                <Box css={styles.legend} data-chart-pie-legend="">
                    {shown.slices.map(s => (
                        <Box key={s.key} css={styles.entry} data-chart-slice-entry={s.key} {...(s.other ? { "data-other": "" } : {})}
                            {...(onMark !== undefined ? { as: "button" as const, type: "button" as const, "data-clickable": "", onClick: () => onMark(sliceMark(s)) } : {})}>
                            <Box as="span" css={styles.swatch} background={style.color(s.color)} />
                            <Box as="span" css={styles.label}>{s.key}</Box>
                            <Box as="span" css={styles.value}>{fmt(s.value)}</Box>
                            <Box as="span" css={styles.share}>{words.percent(s.share)}</Box>
                        </Box>
                    ))}
                </Box>
            </Box>
        );
    };
    return measuredFrame(height, width, (w, h) => draw(w, h ?? height));
}
