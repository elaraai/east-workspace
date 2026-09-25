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
 * A treegrid row (#819) at its level, expanded or not, its name the
 * `rowheader`.
 */

import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanScale } from "../context.js";
import { HeatCells } from "./HeatRow.js";
import { GridSeparators, INDENT_PX } from "./RowShell.js";
import { PlanPartBoundary } from "./PartBoundary.js";
import { RowDiagnostic } from "./RowDiagnostic.js";
import { statusText } from "../a11y.js";
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
    /** Renderer-derived direct-member count — printed as the `"8 rs"` meta
     *  (the `groupMeta` message, #820) when the IR declares none (#568: the
     *  count is an aggregate like any other, so it is derived here rather than
     *  baked into the row). */
    memberCount?: number | undefined;
    /** Whether the derived numbers cover only the windows that have landed —
     *  a top-level section band on a paged canvas still loading, the one
     *  parent whose members span windows (`spansWindows`, #822). The count
     *  prints `~8 rs` and the band carries `data-plan-partial` (#567 D9). The
     *  author's own `meta` is never rewritten: it is their text, not a
     *  derivation. */
    partial?: boolean | undefined;
    /** Set when the band's own declared strip rides another arm than the axis
     *  (#811): the band keeps its toggle and its members, and its plot says
     *  why it shows no strip. */
    diagnostic?: PlanRowDiagnostic | undefined;
    /** The band's grid plumbing (#819) — `usePlanGridRow`. */
    grid: PlanGridRow;
}

/** One group band — full-width strip on the shared template. */
export function GroupRow({ row, kind, styles, gridTemplate, height, depth, collapsed, strip, memberCount, partial, diagnostic, grid }: GroupRowProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    // A declared meta line wins; otherwise the derived member count stands in.
    const meta = row.gutter.meta.type === "some"
        ? row.gutter.meta.value
        : (memberCount !== undefined && memberCount > 0
            ? words.m.groupMeta({ n: memberCount, count: words.number(memberCount), partial: partial === true })
            : undefined);
    const value = row.gutter.value.type === "some" ? row.gutter.value.value : undefined;
    const statusTone = row.status.type === "some" ? row.status.value.type : undefined;
    const summary = collapsed && diagnostic === undefined ? groupStrip(kind, strip) : undefined;

    return (
        <Box
            ref={grid.ref}
            css={styles.groupBand}
            gridTemplateColumns={gridTemplate}
            height={`${height}px`}
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
            data-plan-partial={partial === true ? "" : undefined}
            onClick={() => dispatch({ t: "group.toggle", key: row.key })}
        >
            <Box css={styles.groupName} role="rowheader" paddingLeft={`${12 + depth * INDENT_PX}px`}>
                <Box as="span" css={styles.caret} data-collapsed={collapsed ? "" : undefined}>
                    <FontAwesomeIcon icon={faCaretDown} />
                </Box>
                <Box as="span" overflow="hidden" textOverflow="ellipsis" minWidth={0}>{row.gutter.label}</Box>
                {/* The mock's `.grow` anatomy: meta / dot / value cluster
                    pushed to the gutter's RIGHT edge by the flex spacer —
                    never inline beside the name. */}
                {(meta !== undefined || value !== undefined || statusTone !== undefined) && (
                    <Box css={styles.gutterRight}>
                        {meta !== undefined && <Box as="span" css={styles.groupMeta}>{meta}</Box>}
                        {statusTone !== undefined && <Box as="span" css={styles.statusDot} data-tone={statusTone}
                            role="img" aria-label={statusText(statusTone, words)} />}
                        {value !== undefined && <Box as="span" css={styles.gutterValue}>{value}</Box>}
                    </Box>
                )}
            </Box>
            <Box css={styles.plot} role="gridcell">
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
                {scale.nowFrac !== undefined && <Box css={styles.nowLine} left={`${scale.nowFrac * 100}%`} />}
            </Box>
        </Box>
    );
}
