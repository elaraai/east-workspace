/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Group strips (`Plan Spec.md` §5) — the canvas-level heterogeneous
 * container's band: caret + mono uppercase name + meta counts in the gutter;
 * collapsed with a `summary`, the plot renders the factory-computed heat
 * strip (delegating the cell painting to {@link HeatCells}); expanded (or
 * summary-less) the plot stays a plain band.
 *
 * A band with no `summary` of its own, over rows read a page at a time,
 * counts the events landing beneath it instead (#1716, `root/band-counts.ts`),
 * open or collapsed: a cell a column with events, its number on the heat
 * ramp against the largest of its level's bands, inside the band's own
 * height, so nothing moves as the counts land. Its words — the column, each
 * record's share, what is not counted — are its hover's and a reader's. It
 * draws only the counts read at the period its columns take: after a zoom it
 * keeps the cells it drew, hidden and as they were, until the new period's
 * land and replace them — so a zoom neither lays them out again on the new
 * columns nor takes them off the band.
 *
 * A treegrid row (#819) at its level, expanded or not, its name the
 * `rowheader`.
 */

import { memo, useState, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { PlaceholderShape } from "@elaraai/east-ui-components/internal";
import { NowLine } from "../../shared/time/now-line.js";
import { usePlanDispatch, usePlanScale } from "../context.js";
import { timeInstant } from "../instant.js";
import type { PlanScale } from "../scale.js";
import { usePlanBandCounts, type PlanBandCounts } from "../root/band-counts.js";
import { HeatCells, heatLevel } from "./HeatRow.js";
import { GridSeparators, INDENT_PX } from "./RowShell.js";
import { PlanPartBoundary } from "./PartBoundary.js";
import { RowDiagnostic } from "./RowDiagnostic.js";
import { PlanStatusIcon } from "./StatusIcon.js";
import { usePlanWords } from "../words.js";
import { rowItemKey, type PlanRowDiagnostic, type PlanRowValue } from "../model.js";
import type { PlanGridRow } from "../root/grid.js";

type HeatCellsValue = ValueTypeOf<typeof Plan.Types.HeatCells>;
type Styles = Record<string, Record<string, unknown>>;
type GroupKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "group" }>["value"];

/**
 * The strip a group band draws collapsed (#824) — its derived strip (the
 * declared aggregate over its members' drawn heat cells, on the scale they
 * share, or its declared cells folded to the period), else its declared cells
 * as they are. `undefined` for a plain band, and for an aggregate with no
 * member cells to show. Shared with the narrow layout's group cards, so both
 * strips read the same way.
 *
 * @param kind - The group's kind
 * @param derived - Its derived strip (`PlanDerived.groupStrips`), if any
 * @returns The heat arm to draw, if any
 */
export function groupStrip(kind: GroupKindValue, derived: HeatCellsValue | undefined): HeatCellsValue | undefined {
    const arm = derived ?? (kind.summary.type === "cells" ? kind.summary.value : undefined);
    if (arm === undefined) return undefined;
    if (kind.summary.type === "aggregate" && arm.type === "heat" && arm.value.cells.length === 0) return undefined;
    return arm;
}

/**
 * A band's plot cell: what the band draws over the plot, then the now line
 * across it. A group's band and a links focus's band (#1680's review) draw
 * their plots through it.
 *
 * @param props.styles - The Plan's slot styles
 * @param props.children - What the band draws in its plot, if anything
 */
export function BandPlot({ styles, children }: { styles: Styles; children?: ReactNode }) {
    const scale = usePlanScale();
    return (
        <Box css={styles.plot} role="gridcell" data-plan-band-plot>
            {children}
            {scale.nowFrac !== undefined && <NowLine styles={styles} at={scale.nowFrac} data-plan-now />}
        </Box>
    );
}

/**
 * A band's counts of the events beneath it (#1716): a cell a column with events, its number on the heat ramp against
 * the largest of its level's bands. Each cell's words — the column, its events, each record's share, the hidden kinds
 * among them and the records not counted — are its name, which the canvas's one tooltip says on a hover. The cells are
 * part of the band: a click on one toggles it, as on the rest of it. They are drawn on the columns given — those their
 * counts were read for — and drawn again only as the counts or those columns move: a zoom draws none of them again.
 * They are plain elements, whose looks the element round them gives them by their data attributes (`bandCounts`): a
 * screen of folded groups mounts a thousand of them, and none works a style out as it mounts (#1792).
 *
 * @param props.counts - The band's counts
 * @param props.scale - The columns they were read for
 */
const BandCounts = memo(function BandCounts({ counts, scale }: { counts: PlanBandCounts; scale: PlanScale }) {
    const words = usePlanWords();
    const notCounted = counts.uncounted.map((one) => words.m.bandNotCounted({ names: one.names, why: one.why, fields: one.fields }));
    return (
        <>
            {counts.columns.map((column, i) => {
                const box = scale.renderBucketOf(timeInstant(column.at));
                if (box === undefined) return null;
                const level = heatLevel(counts.top > 0 ? column.total / counts.top : 0);
                const said = words.m.bandCount({
                    bucket: scale.bucketText(box), n: column.total, count: words.number(column.total),
                    shares: column.shares.map((share) => ({ names: share.names, count: words.number(share.count) })), hidden: counts.hidden,
                });
                return (
                    <div key={column.at.getTime()} data-plan-bucket={box.index} data-plan-band-count={i} data-level={level}
                        role="img" aria-label={[said, ...notCounted].join(". ")}
                        style={{ left: `calc(${box.x0 * 100}% + 1.5px)`, width: `calc(${(box.x1 - box.x0) * 100}% - 3px)` }}>
                        <span data-level={level} data-plan-label="" aria-hidden="true">{words.number(column.total)}</span>
                    </div>
                );
            })}
        </>
    );
});

export interface GroupRowProps {
    row: PlanRowValue;
    kind: GroupKindValue;
    styles: Styles;
    gridTemplate: string;
    height: number;
    depth: number;
    collapsed: boolean;
    /** The renderer-derived strip (`PlanDerived.groupStrips`) — see {@link groupStrip}. */
    strip?: HeatCellsValue | undefined;
    /** Renderer-derived direct-member count — printed as the `"8 rows"` meta
     *  (the `groupMeta` message, #820) when the IR declares none (#568: the
     *  count is an aggregate like any other, so it is derived here rather than
     *  baked into the row). */
    memberCount?: number | undefined;
    /** Whether the derived numbers cover only the windows that have landed —
     *  a top-level section band on a paged canvas still loading, the one
     *  parent whose members span windows (`spansWindows`, #822). The count is
     *  a short bar until its members land (#1398, CL13) and the band carries
     *  `data-plan-partial` (#567 D9). The author's own `meta` is never
     *  rewritten: it is their text, not a derivation. */
    partial?: boolean | undefined;
    /** Set when the band's own declared strip rides another arm than the axis
     *  (#811): the band keeps its toggle and its members, and its plot says
     *  why it shows no strip. */
    diagnostic?: PlanRowDiagnostic | undefined;
    /** The band's grid plumbing (#819) — `usePlanGridRow`. */
    grid: PlanGridRow;
    /** The band is the last visible member of the open group around it — it
     *  carries that group's closing rule (#949). */
    groupEnd?: boolean | undefined;
}

/** One group band — full-width strip on the shared template. */
export function GroupRow({ row, kind, styles, gridTemplate, height, depth, collapsed, strip, memberCount, partial, diagnostic, grid, groupEnd }: GroupRowProps) {
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    // A declared meta line wins; otherwise the derived member count stands in — a short bar while it covers only the
    // windows that have landed, never a count the read has not finished (#1398, CL13).
    const meta = row.gutter.meta.type === "some"
        ? row.gutter.meta.value
        : (memberCount !== undefined && memberCount > 0
            ? (partial === true
                ? <PlaceholderShape kind="aggregate" index={memberCount} />
                : words.m.groupMeta({ n: memberCount, count: words.number(memberCount) }))
            : undefined);
    const value = row.gutter.value.type === "some" ? row.gutter.value.value : undefined;
    const statusTone = row.status.type === "some" ? row.status.value.type : undefined;
    const summary = collapsed && diagnostic === undefined ? groupStrip(kind, strip) : undefined;
    // The events beneath it, counted where it declares no summary of its own (#1716), open or collapsed — those read at the
    // period its columns take. Counts of another period, a zoom's until the new period's land, are not drawn: the band
    // keeps the cells it drew, hidden, on the columns they were drawn on, so the zoom neither lays them out again on the
    // new columns nor takes them off, and the new period's replace them as they land.
    const counts = usePlanBandCounts(row.key);
    const scale = usePlanScale();
    const counting = kind.summary.type === "none" && diagnostic === undefined && counts !== undefined && counts.columns.length > 0 ? counts : undefined;
    const fresh = counting !== undefined && counting.period === scale.resolution;
    const [drawn, setDrawn] = useState<{ readonly counts: PlanBandCounts; readonly scale: PlanScale } | undefined>(undefined);
    // What it draws follows the counts read for its columns, and goes with them; another period's leave it standing.
    if (counting === undefined ? drawn !== undefined : fresh && (drawn === undefined || drawn.counts !== counting || drawn.scale !== scale)) {
        setDrawn(counting === undefined ? undefined : { counts: counting, scale });
    }

    return (
        <Box
            ref={grid.ref}
            css={styles.groupBand}
            style={{ gridTemplateColumns: gridTemplate, height: `${height}px` }}
            role="row"
            aria-level={depth + 1}
            aria-expanded={!collapsed}
            tabIndex={grid.tabIndex}
            onFocus={grid.onFocus}
            data-plan-item={rowItemKey(row.key)}
            data-plan-group={row.key}
            // The height the model laid the band out at (#817).
            data-plan-h={height}
            data-collapsed={collapsed ? "" : undefined}
            data-group-end={groupEnd === true ? "" : undefined}
            data-plan-partial={partial === true ? "" : undefined}
            onClick={() => dispatch({ t: "group.toggle", key: row.key })}
        >
            {/* The band's name is the rows' gutter grid, open or collapsed (#1749): its caret, its caption and meta in the
                name's cell, its status and value in the value slot — where a row's stand at its level. */}
            <Box css={styles.groupName} role="rowheader" style={{ paddingLeft: `${12 + depth * INDENT_PX}px` }}>
                <Box as="span" css={styles.caret} data-collapsed={collapsed ? "" : undefined}>
                    <FontAwesomeIcon icon={faCaretDown} />
                </Box>
                <Box as="span" data-plan-gutter="title">
                    <Box as="span" css={styles.gutterLabel} data-plan-gutter="label">{row.gutter.label}</Box>
                    {meta !== undefined && <Box as="span" css={styles.groupMeta} data-plan-gutter="meta">{meta}</Box>}
                </Box>
                <Box as="span" css={styles.gutterSlot} data-plan-gutter="slot">
                    <PlanStatusIcon tone={statusTone} styles={styles} />
                    {value !== undefined && <Box as="span" css={styles.gutterValue} data-plan-gutter="value">{value}</Box>}
                </Box>
            </Box>
            <BandPlot styles={styles}>
                {diagnostic !== undefined && <RowDiagnostic diagnostic={diagnostic} styles={styles} />}
                {summary !== undefined && (
                    <PlanPartBoundary part={{ kind: "group", label: row.gutter.label }} resetKey={summary} styles={styles}>
                        <GridSeparators styles={styles} />
                        {/* The strip's cells are part of the BAND: clicking
                            them toggles the group like the rest of it, rather
                            than selecting a group key nothing displays (#615). */}
                        <HeatCells rowKey={row.key} cells={summary} styles={styles}
                            onCellClick={() => dispatch({ t: "group.toggle", key: row.key })} />
                    </PlanPartBoundary>
                )}
                {drawn !== undefined && (
                    <PlanPartBoundary part={{ kind: "group", label: row.gutter.label }} resetKey={drawn.counts} styles={styles}>
                        <GridSeparators styles={styles} />
                        {/* Hidden while they are another period's than the columns take: no hover and no reader hears them.
                            Their looks are this element's, by their data attributes: one style a band (#1792). */}
                        <Box css={styles.bandCounts} hidden={!fresh} data-plan-band-counts="">
                            <BandCounts counts={drawn.counts} scale={drawn.scale} />
                        </Box>
                    </PlanPartBoundary>
                )}
            </BandPlot>
        </Box>
    );
}
