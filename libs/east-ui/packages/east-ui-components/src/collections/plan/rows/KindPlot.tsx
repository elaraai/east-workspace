/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The plot CONTENT of one data row — the kind switch, and nothing else.
 *
 * Every row kind draws its marks the same way whatever shell they sit in:
 * the desktop canvas mounts this inside a `RowShell` plot cell beside the
 * gutter, and the narrow layout (§10, #570) mounts it as a card body under
 * the card head. Keeping the switch here is what makes "every row's content
 * is its source renderer, unchanged — only the shell is new" literally true
 * rather than a second copy of eight renderers.
 *
 * Group bands are not a plot: they have their own band component.
 */

import { variant } from "@elaraai/east";
import { SpanRow } from "./SpanRow.js";
import { ChartRowPlot } from "./ChartRow.js";
import { HeatCells } from "./HeatRow.js";
import { BucketsRow } from "./BucketsRow.js";
import { CardsRow } from "./CardsRow.js";
import { EventsRow } from "./EventsRow.js";
import { TableRowCells } from "./TableRow.js";
import { getSomeorUndefined } from "../../../utils.js";
import { usePlanGeometry } from "../context.js";
import type { PlanDerived, VisibleRow } from "../model.js";

type Styles = Record<string, Record<string, unknown>>;

export interface KindPlotProps {
    v: VisibleRow;
    styles: Styles;
    /** The renderer-side derivations (rollup bands, derived cells / series). */
    derived: PlanDerived;
    /** Whether this row nests children (a collapsed parent draws rollup-height bars). */
    hasChildren: boolean;
    /** R2 context strip — marks at strip size. */
    ctx: boolean;
    /** The plot's height — what a chart row's y-scale spans. */
    plotHeight: number;
    /** Chart rows: render at expanded density (breach rectangles, ref labels). */
    chartExpanded: boolean;
}

/** The plot content for a data row kind (`null` for a group band). */
export function KindPlot({ v, styles, derived, hasChildren, ctx, plotHeight, chartExpanded }: KindPlotProps) {
    // Bar heights are the canvas's geometry (#817) — the density's bar, or
    // the rollup band's height for a collapsed parent.
    const geometry = usePlanGeometry();
    const kind = v.row.kind;
    const rowKey = v.row.key;
    const rowId = v.row.id;
    switch (kind.type) {
        case "span":
            return (
                <SpanRow rowKey={rowKey} rowId={rowId} kind={kind.value} styles={styles} ctx={ctx}
                    bands={derived.bands.get(rowKey) ?? []}
                    barHeight={v.collapsed && hasChildren ? geometry.rollBar : geometry.bar} />
            );
        case "chart":
            return (
                <ChartRowPlot kind={kind.value} styles={styles} height={plotHeight}
                    expanded={chartExpanded} rowKey={rowKey} ctx={ctx} />
            );
        case "heat": {
            // A declared-aggregate parent renders its derived cells inside
            // the empty scale-bearing heat arm — rebuilt with `variant`, so
            // the wrap is a real East value like the arm it replaces (#617).
            const derivedCells = derived.heatCells.get(rowKey);
            const cells = derivedCells !== undefined && kind.value.cells.type === "heat"
                ? variant("heat", { ...kind.value.cells.value, cells: derivedCells })
                : kind.value.cells;
            return <HeatCells rowKey={rowKey} rowId={rowId} cells={cells} styles={styles} ctx={ctx} />;
        }
        case "buckets":
            return (
                <BucketsRow rowKey={rowKey} rowId={rowId} kind={kind.value} styles={styles} ctx={ctx} />
            );
        case "table": {
            // A declared-aggregate parent renders its derived subtotal
            // cells as ONE plain series; leaf rows render their declared
            // series (per-position style, raw cells).
            const derivedSeries = derived.tableSeries.get(rowKey);
            return (
                <TableRowCells rowKey={rowKey} rowId={rowId}
                    series={derivedSeries ?? kind.value.series}
                    split={kind.value.split.type} ctx={ctx}
                    format={getSomeorUndefined(kind.value.format)} styles={styles} />
            );
        }
        case "cards":
            return (
                <CardsRow rowKey={rowKey} rowId={rowId} kind={kind.value} styles={styles} ctx={ctx} />
            );
        case "events":
            return (
                <EventsRow rowKey={rowKey} rowId={rowId} kind={kind.value} styles={styles} ctx={ctx} />
            );
        case "group":
            return null;
    }
}
