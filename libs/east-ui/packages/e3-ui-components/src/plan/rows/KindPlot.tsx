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

import { Box } from "@chakra-ui/react";
import { optimiseMessages } from "@elaraai/east-ui-components";
import { SpanRow } from "./SpanRow.js";
import { ChartRowPlot } from "./ChartRow.js";
import { HeatCells } from "./HeatRow.js";
import { BucketsRow } from "./BucketsRow.js";
import { CardsRow } from "./CardsRow.js";
import { EventsRow } from "./EventsRow.js";
import { TableRowCells } from "./TableRow.js";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { usePlanEdit } from "../edit/store.js";
import { usePlanScale } from "../context.js";
import { usePlanRowGhosts } from "./element-optimise.js";
import { PLAN_CELL_INSET } from "../geometry.js";
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

/**
 * The ghosts a run of the optimiser left on a row (#1409, R15), while its
 * highlight is on: where an event it removed stood, struck through, and
 * where one it moved stood, dashed — each at its extent on the shared scale,
 * decorative, named for what the run did. Drawn in the row's own bar or tile
 * style, which the `optimise` recipe dashes and tints from `data-op`.
 */
function PlanGhosts({ rowKey, styles, ctx }: { rowKey: string; styles: Styles; ctx: boolean }) {
    const ghosts = usePlanRowGhosts(rowKey);
    const scale = usePlanScale();
    if (ghosts.length === 0 || ctx) return null;
    return (
        <>
            {ghosts.map((ghost) => {
                const f0 = scale.fracOf(ghost.start);
                const f1 = ghost.shape === "span" ? scale.endFracOf(ghost.end) : f0;
                if (!Number.isFinite(f0) || !Number.isFinite(f1) || f1 < scale.renderMin || f0 > scale.renderMax) return null;
                const title = ghost.op === "del" ? optimiseMessages.ghostRemoved({ run: ghost.run }) : optimiseMessages.ghostMoved({ run: ghost.run });
                return ghost.shape === "span" ? (
                    <Box key={`ghost:${ghost.key}`} css={styles.bar} data-plan-ghost={ghost.key} data-op={ghost.op} aria-hidden="true" title={title}
                        left={`calc(${Math.max(0, f0) * 100}% + ${PLAN_CELL_INSET}px)`} width={`calc(${Math.max(0, Math.min(1, f1) - Math.max(0, f0)) * 100}% - ${2 * PLAN_CELL_INSET}px)`}>
                        {ghost.label}
                    </Box>
                ) : (
                    <Box key={`ghost:${ghost.key}`} css={styles.tile} data-plan-ghost={ghost.key} data-op={ghost.op} aria-hidden="true" title={title}
                        position="absolute" left={`${f0 * 100}%`}>
                        {ghost.label}
                    </Box>
                );
            })}
        </>
    );
}

/** The plot content for a data row kind (`null` for a group band). */
export function KindPlot(props: KindPlotProps) {
    const { v, ctx, styles } = props;
    if (v.row.kind.type === "group") return null;
    return (
        <>
            <KindPlotContent {...props} />
            <PlanGhosts rowKey={v.row.key} styles={styles} ctx={ctx} />
        </>
    );
}

/** The kind switch: one row kind's own plot content. */
function KindPlotContent({ v, styles, derived, hasChildren, ctx, plotHeight, chartExpanded }: KindPlotProps) {
    const kind = v.row.kind;
    const rowKey = v.row.key;
    const rowId = v.row.id;
    // How the row's elements move (#825) — never inside a context strip,
    // whose one action is the way back: a row of `data`'s while its session
    // takes a move, an event kind's by its events (#1196).
    const edit = usePlanEdit();
    const move = ctx ? undefined
        : v.row.edits.move.type === "some" ? (edit?.dataMoves === true ? v.row.edits.move.value : undefined)
            : edit?.eventMove?.(v.row);
    switch (kind.type) {
        case "span":
            return (
                // Bar heights are the canvas's geometry (#817), drawn by the
                // recipe: the density's bar, or the rollup band's height for a
                // collapsed parent.
                <SpanRow rowKey={rowKey} rowId={rowId} kind={kind.value} styles={styles} ctx={ctx} move={move}
                    bands={derived.bands.get(rowKey) ?? []}
                    rolled={v.collapsed && hasChildren} />
            );
        case "chart":
            // What the row DRAWS (#824) — its layers folded to the period
            // where a bucket holds several of their points.
            return (
                <ChartRowPlot kind={derived.charts.get(rowKey) ?? kind.value} styles={styles} height={plotHeight}
                    expanded={chartExpanded} rowKey={rowKey} ctx={ctx} />
            );
        case "heat":
            // A declared-aggregate parent draws its derived cells, and any row
            // its cells folded to the period (#824); else its own arm.
            return (
                <HeatCells rowKey={rowKey} rowId={rowId} cells={derived.heatArms.get(rowKey) ?? kind.value.cells}
                    styles={styles} ctx={ctx} />
            );
        case "buckets":
            return (
                <BucketsRow rowKey={rowKey} rowId={rowId} kind={kind.value} styles={styles} ctx={ctx} move={move} />
            );
        case "table":
            // A declared-aggregate parent draws its derived subtotal
            // positions, and any row its series folded to the period (#824);
            // else its declared series (per-position style, raw cells).
            return (
                <TableRowCells rowKey={rowKey} rowId={rowId}
                    series={derived.tableSeries.get(rowKey) ?? kind.value.series}
                    split={kind.value.split.type} ctx={ctx}
                    format={getSomeorUndefined(kind.value.format)} styles={styles} />
            );
        case "cards":
            return (
                <CardsRow rowKey={rowKey} rowId={rowId} kind={kind.value} styles={styles} ctx={ctx} move={move} />
            );
        case "events":
            return (
                <EventsRow rowKey={rowKey} rowId={rowId} kind={kind.value} styles={styles} ctx={ctx} move={move} />
            );
        case "group":
            return null;
    }
}
