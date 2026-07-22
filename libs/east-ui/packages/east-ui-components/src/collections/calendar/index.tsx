/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Calendar } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { parseCssSize } from "../../style/parse-size.js";
import { VirtualRows } from "../virtual-rows.js";
import { useDensity } from "../../contracts/density";
import { usePlotGutter } from "../../contracts/plot-gutter.js";

const calendarEqual = equalFor(Calendar.Types.Calendar);

/** East Calendar value type. */
export type CalendarValue = ValueTypeOf<typeof Calendar.Types.Calendar>;

/** East Calendar cell value type. */
export type CalendarCellValue = ValueTypeOf<typeof Calendar.Types.Cell>;

export interface EastChakraCalendarProps {
    value: CalendarValue;
    storageKey: string;
}

type SlotStyles = Record<string, SystemStyleObject>;

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Steps in the default ramp (matches the eight `--cal-r*` recipe vars). */
const RAMP_LEN = 8;

/** Per-density structural sizing — the pixel values the VirtualRows contract
 *  (#320) and the plot-gutter template (#147) need. Mapped by size rank to the
 *  designer's three panels (comfortable = "large", compact = "comfortable",
 *  condensed = "compact"). Font sizes + cell radius live in the recipe. */
const DENS = {
    comfortable: { H: 46, gap: 3, colLabel: 54, colDay: "minmax(62px,1fr)", colTot: 82, padX: 18, padTop: 18, padBottom: 20 },
    compact:     { H: 30, gap: 2, colLabel: 54, colDay: "minmax(46px,1fr)", colTot: 78, padX: 16, padTop: 14, padBottom: 16 },
    condensed:   { H: 20, gap: 2, colLabel: 40, colDay: "34px",             colTot: 60, padX: 16, padTop: 12, padBottom: 12 },
} as const;
type DensityKey = keyof typeof DENS;

/** Reduce a set of present cell values by the aggregate tag (Table vocabulary). */
function reduce(values: number[], agg: string): number | null {
    if (values.length === 0) return null;
    switch (agg) {
        case "sum": return values.reduce((a, b) => a + b, 0);
        case "mean": return values.reduce((a, b) => a + b, 0) / values.length;
        case "min": return Math.min(...values);
        case "max": return Math.max(...values);
        case "count": return values.length;
        default: return null;
    }
}

/** Thousands-separated integer print (matches the design's `toLocaleString`). */
function printAgg(n: number): string {
    return Math.round(n).toLocaleString("en-US");
}

/**
 * Renders an East UI Calendar value — the day-of-week × week heatmap per the
 * `Calendar Heatmap` design: an eight-step teal ramp, hover cross-highlight,
 * the Σ-wk totals rail, the per-weekday aggregate row, and the selection
 * footer with the predicted / compare / delta chip and the gradient legend.
 * Visualisation only — selection is local state surfaced through the footer
 * and the `onSelect` / `onAction` callbacks.
 */
export const EastChakraCalendar = memo(function EastChakraCalendar({ value }: EastChakraCalendarProps) {
    const inheritedDensity = useDensity();
    const density = (getSomeorUndefined(value.density)?.type ?? inheritedDensity ?? "comfortable") as DensityKey;
    const D = DENS[density] ?? DENS.comfortable;
    const styles = useSlotRecipe({ key: "calendar" })({ density }) as SlotStyles;

    // Shared plot gutter (#147) — pins the 7 day columns to [left, W−right] so
    // a Calendar stacked under a Chart lines up. Under a gutter the totals rail
    // / mean row / footer are dropped (they'd break the day-axis alignment).
    const ctxGutter = usePlotGutter();
    const ownGutter = useMemo(() => getSomeorUndefined(value.plotGutter), [value.plotGutter]);
    const gLeft = (ownGutter ? getSomeorUndefined(ownGutter.left) : undefined) ?? ctxGutter?.left;
    const gRight = (ownGutter ? getSomeorUndefined(ownGutter.right) : undefined) ?? ctxGutter?.right;
    const gutterActive = gLeft !== undefined || gRight !== undefined;

    const showValues = value.values;
    const totals = gutterActive ? undefined : getSomeorUndefined(value.totals);
    const aggRow = gutterActive ? undefined : getSomeorUndefined(value.aggregateRow);
    const footer = gutterActive ? undefined : getSomeorUndefined(value.footer);
    const scale = getSomeorUndefined(value.scale);
    const customRamp = scale ? getSomeorUndefined(scale.ramp) : undefined;
    const steps = scale ? Math.max(1, Number(scale.steps)) : RAMP_LEN;
    const rampLen = customRamp ? customRamp.length : RAMP_LEN;
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const onActionFn = useMemo(() => getSomeorUndefined(value.onAction), [value.onAction]);
    const actionLabel = gutterActive ? undefined : getSomeorUndefined(value.actionLabel);
    const domain = getSomeorUndefined(value.domain);

    const [selected, setSelected] = useState<{ week: string; day: string } | null>(null);
    const [hovered, setHovered] = useState<{ week: string; day: string } | null>(null);

    // Weeks in first-appearance order; cells keyed week|day; observed domain.
    const { weeks, cells, min, max } = useMemo(() => {
        const weeks: string[] = [];
        const cells = new Map<string, CalendarCellValue>();
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const cell of value.cells) {
            if (!weeks.includes(cell.week)) weeks.push(cell.week);
            cells.set(`${cell.week} ${cell.day}`, cell);
            if (cell.value < min) min = cell.value;
            if (cell.value > max) max = cell.value;
        }
        if (domain !== undefined) { min = domain.min; max = domain.max; }
        return { weeks, cells, min, max };
    }, [value.cells, domain]);

    // Fill + on-ramp ink for a value — bucket into `steps` levels, map to the
    // ramp (default CSS vars, or the custom ramp), pick the on-ramp ink at the
    // upper half. The fill is a data-driven binding → applied inline.
    const fillOf = useCallback((v: number): { bg: string; fg: string } => {
        const t = max <= min ? 0 : Math.max(0, Math.min(1, (v - min) / (max - min)));
        const lvl = steps <= 1 ? 0 : Math.max(0, Math.min(steps - 1, Math.round(t * (steps - 1))));
        const idx = steps <= 1 ? 0 : Math.max(0, Math.min(rampLen - 1, Math.round((lvl / (steps - 1)) * (rampLen - 1))));
        const bg = customRamp ? customRamp[idx]! : `var(--cal-r${idx})`;
        const fg = idx >= Math.ceil(rampLen / 2) ? "var(--cal-ink-hi)" : "var(--cal-ink-lo)";
        return { bg, fg };
    }, [min, max, steps, rampLen, customRamp]);

    const interactive = footer !== undefined || onSelectFn !== undefined;
    const handleSelect = useCallback((week: string, day: string) => {
        setSelected({ week, day });
        if (onSelectFn) queueMicrotask(() => onSelectFn({ week, day }));
    }, [onSelectFn]);
    const handleAction = useCallback(() => {
        if (selected && onActionFn) queueMicrotask(() => onActionFn(selected));
    }, [selected, onActionFn]);

    const active = hovered ?? selected;
    const colActive = (day: string) => active?.day === day;
    const rowActive = (week: string) => active?.week === week;

    // Per-week totals (row aggregate) + per-weekday aggregate (column).
    const totalsAgg = totals ? totals.aggregate.type : undefined;
    const rowTotals = useMemo(() => {
        if (totalsAgg === undefined) return { map: new Map<string, number | null>(), max: 0 };
        const map = new Map<string, number | null>();
        let mx = 0;
        for (const week of weeks) {
            const vals: number[] = [];
            for (const day of WEEK) { const c = cells.get(`${week} ${day}`); if (c) vals.push(c.value); }
            const agg = reduce(vals, totalsAgg);
            map.set(week, agg);
            if (agg !== null && agg > mx) mx = agg;
        }
        return { map, max: mx };
    }, [totalsAgg, weeks, cells]);

    const aggRowAgg = aggRow ? aggRow.aggregate.type : undefined;
    const colAggs = useMemo(() => {
        if (aggRowAgg === undefined) return new Map<string, number | null>();
        const map = new Map<string, number | null>();
        for (const day of WEEK) {
            const vals: number[] = [];
            for (const week of weeks) { const c = cells.get(`${week} ${day}`); if (c) vals.push(c.value); }
            map.set(day, reduce(vals, aggRowAgg));
        }
        return map;
    }, [aggRowAgg, weeks, cells]);

    // Grid template. Gutter mode pins the day band to [left, W−right]; standard
    // mode uses the density's label / day / totals tracks.
    const leftCol = gLeft ?? `${D.colLabel}px`;
    const rightGutter = gRight ?? "0px";
    const gridColumns = gutterActive
        ? `${leftCol} repeat(${WEEK.length}, minmax(0, 1fr)) ${rightGutter}`
        : `${D.colLabel}px repeat(${WEEK.length}, ${D.colDay})${totals ? ` ${D.colTot}px` : ""}`;

    // VirtualRows redistribution (#320): the single grid's gap/padding spread
    // onto the frame + per-row grids — horizontal padding + column gap per row,
    // the inter-row gap as each data row's leading paddingTop.
    const gapPx = `${D.gap}px`;
    const rowGridCss: SystemStyleObject = {
        display: "grid",
        // Under a plot gutter the day columns must tile EDGE-TO-EDGE so their
        // centres land on the chart's band centres (#147). A column `gap`
        // redistributes into the tracks and pulls the outer columns inward by
        // a sub-pixel — enough to drift the day-0 / day-6 cells off the axis
        // ticks that the other (border-separated) lanes hit. Vertical row
        // spacing is preserved via each data row's leading `paddingTop`.
        gap: gutterActive ? "0px" : gapPx,
        ...(gutterActive ? { paddingLeft: "0", paddingRight: "0" } : { paddingLeft: `${D.padX}px`, paddingRight: `${D.padX}px` }),
    };
    const dataRowCss: SystemStyleObject = { ...rowGridCss, paddingTop: gapPx };
    // Under the gutter the tracks tile edge-to-edge (gap:0) so cell centres land
    // on the chart's band centres — but bare tracks make the heat tiles touch,
    // which reads as a solid block (reported regression). Restore the inter-cell
    // gap as a SYMMETRIC per-cell `marginInline` (half the density gap): a
    // stretched grid item insets equally on both sides, so its centre stays
    // exactly on the track centre (alignment preserved) while `D.gap` of visual
    // space returns between tiles.
    const dayCellCss: SystemStyleObject = gutterActive
        ? { ...styles.cell, marginInline: `${D.gap / 2}px` }
        : { ...styles.cell };

    const headerNode = (
        <Box css={{ ...rowGridCss, paddingTop: `${D.padTop}px` }} style={{ gridTemplateColumns: gridColumns }}>
            <Box />
            {WEEK.map(day => (
                <Box key={day} css={styles.dayHeader} {...(colActive(day) ? { "data-active": "" } : {})}>{day.toUpperCase()}</Box>
            ))}
            {totals && <Box css={styles.totalsHeader}>{totals.label}</Box>}
            {gutterActive && <Box key="hdr-rpad" aria-hidden="true" />}
        </Box>
    );

    const renderRow = (weekIndex: number): ReactNode => {
        const week = weeks[weekIndex];
        if (week === undefined) return null;
        const total = totals ? rowTotals.map.get(week) ?? null : null;
        const barPct = totals && total !== null && rowTotals.max > 0
            ? `${Math.max(10, Math.round(total / rowTotals.max * 100))}%` : "0%";
        return (
            <Box css={dataRowCss} style={{ gridTemplateColumns: gridColumns }}>
                <Box css={styles.weekLabel} {...(rowActive(week) ? { "data-active": "" } : {})}>{week}</Box>
                {WEEK.map(day => {
                    const cell = cells.get(`${week} ${day}`);
                    const isSelected = interactive && selected?.week === week && selected.day === day;
                    const isHover = interactive && hovered?.week === week && hovered.day === day;
                    const fill = cell !== undefined ? fillOf(cell.value) : undefined;
                    return (
                        <Box
                            key={`${week}-${day}`}
                            css={dayCellCss}
                            height={`${D.H}px`}
                            {...(cell === undefined ? { "data-empty": "" } : {})}
                            {...(!interactive && cell !== undefined ? { "data-static": "" } : {})}
                            {...(isSelected ? { "data-selected": "" } : {})}
                            {...(isHover ? { "data-hover": "" } : {})}
                            {...(fill ? { style: { background: fill.bg, color: fill.fg } } : {})}
                            onClick={interactive && cell !== undefined ? () => handleSelect(week, day) : undefined}
                            onMouseEnter={interactive && cell !== undefined ? () => setHovered({ week, day }) : undefined}
                            onMouseLeave={interactive && cell !== undefined ? () => setHovered(null) : undefined}
                        >
                            {showValues ? (cell !== undefined ? cell.text : "–") : ""}
                        </Box>
                    );
                })}
                {totals && (
                    <Box css={styles.totalsCell}>
                        <Box as="span" css={styles.totalsValue}>{total !== null ? printAgg(total) : "·"}</Box>
                        {totals.bar && (
                            <Box as="span" css={styles.totalsBar}>
                                <Box as="span" css={styles.totalsBarFill} style={{ width: barPct }} />
                            </Box>
                        )}
                    </Box>
                )}
                {gutterActive && <Box key={`${week}-rpad`} aria-hidden="true" />}
            </Box>
        );
    };

    // The mean row + footer live outside the virtual scroll (derived, once).
    const meanRowNode = aggRow ? (
        <Box css={dataRowCss} style={{ gridTemplateColumns: gridColumns }}>
            <Box css={styles.meanLabel}>{aggRow.label}</Box>
            {WEEK.map(day => {
                const agg = colAggs.get(day) ?? null;
                return (
                    <Box key={`mean-${day}`} css={styles.meanCell} {...(colActive(day) ? { "data-active": "" } : {})}>
                        {agg !== null ? printAgg(agg) : "·"}
                    </Box>
                );
            })}
            {totals && <Box css={styles.meanPad} />}
        </Box>
    ) : null;

    const selectedCell = selected ? cells.get(`${selected.week} ${selected.day}`) : undefined;
    const selectedCompare = selectedCell ? getSomeorUndefined(selectedCell.compare) : undefined;
    const selectedSummary = selectedCell ? getSomeorUndefined(selectedCell.summary) : undefined;
    const delta = selectedCell !== undefined && selectedCompare !== undefined && selectedCompare !== 0
        ? Math.round((selectedCell.value / selectedCompare - 1) * 100) : undefined;
    const deltaDir = delta === undefined ? "flat" : (delta > 0 ? "up" : (delta < 0 ? "down" : "flat"));
    const deltaText = delta === undefined ? "" : `${delta > 0 ? "▲ +" : delta < 0 ? "▼ " : "– "}${Math.abs(delta)}%`;

    const showFooter = footer !== undefined || actionLabel !== undefined;
    const legend = footer ? getSomeorUndefined(footer.legend) : undefined;
    const footerNode = showFooter ? (
        <Box css={styles.footer} paddingTop="13px" paddingX="2px" paddingBottom="2px">
            {selectedCell !== undefined && footer !== undefined ? (
                <>
                    <Box as="span" css={styles.footerLead}>Selected ·</Box>
                    <Box as="span" css={styles.footerSel}>{selected!.day} {selected!.week}</Box>
                    <Box as="span" color="border.strong">·</Box>
                    <Box as="span">{footer.valueLabel} <Box as="span" css={styles.footerValue}>{selectedCell.text}</Box></Box>
                    {selectedCompare !== undefined && (
                        <>
                            <Box as="span" color="border.strong">·</Box>
                            <Box as="span">{footer.compareLabel} <Box as="span" css={styles.footerValue}>{printAgg(selectedCompare)}</Box></Box>
                        </>
                    )}
                    {selectedSummary !== undefined && (
                        <>
                            <Box as="span" color="border.strong">·</Box>
                            <Box as="span">{selectedSummary}</Box>
                        </>
                    )}
                    {delta !== undefined && (
                        <Box as="span" css={styles.deltaChip} data-dir={deltaDir}>{deltaText}</Box>
                    )}
                </>
            ) : (
                <Box as="span" css={styles.footerLead}>Selected · none — pick a day</Box>
            )}
            {actionLabel !== undefined && (
                <Box as="button" css={styles.action} marginLeft={legend !== undefined ? undefined : "auto"} onClick={handleAction} {...(selected === null ? { "data-disabled": "" } : {})}>
                    {actionLabel} →
                </Box>
            )}
            {legend !== undefined && (
                <Box as="span" css={styles.legend}>
                    <Box as="span" css={styles.legendCap}>{legend.low}</Box>
                    <Box as="span" css={styles.legendGradient} />
                    <Box as="span" css={styles.legendCap}>{legend.high}</Box>
                </Box>
            )}
        </Box>
    ) : undefined;

    const footerSlot = (meanRowNode !== null || footerNode !== undefined) ? (
        <>
            {meanRowNode}
            {footerNode}
        </>
    ) : undefined;

    return (
        <VirtualRows
            height={parseCssSize(getSomeorUndefined(value.height))}
            maxHeight={parseCssSize(getSomeorUndefined(value.maxHeight))}
            header={headerNode}
            footer={footerSlot}
            count={weeks.length}
            estimateSize={() => D.H + D.gap}
            renderRow={renderRow}
            rootCss={{ ...styles.root, paddingBottom: `${D.padBottom}px`, ...(gutterActive ? { display: "block", width: "100%" } : {}) }}
        />
    );
}, (prev, next) => calendarEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
