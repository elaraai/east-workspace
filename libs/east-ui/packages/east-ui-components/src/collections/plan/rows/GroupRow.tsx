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
 */

import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown } from "@fortawesome/free-solid-svg-icons";
import { none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { usePlanDispatch, usePlanScale } from "../context.js";
import { HeatCells } from "./HeatRow.js";
import { GridSeparators, INDENT_PX } from "./RowShell.js";
import type { HeatScale, PlanRowValue } from "../model.js";

type HeatCellsValue = ValueTypeOf<typeof Plan.Types.HeatCells>;
type HeatCellValue = ValueTypeOf<typeof Plan.Types.HeatCell>;

/** Wrap derived strip cells in a heat arm for {@link HeatCells} — built with
 *  `variant`/`some`/`none` so it is a REAL East value like the arm it stands
 *  in for, never a hand-rolled `{ type, value }` literal (#617). The scale is
 *  the one the strip INHERITS from its members (`derived.groupSummaryScale`);
 *  without one the arm paints on its own extent. Shared with the narrow
 *  layout's group cards, so both strips read the same way. */
export function derivedSummaryArm(cells: readonly HeatCellValue[], scale: HeatScale | undefined): HeatCellsValue {
    return variant("heat", {
        cells: [...cells],
        min: scale?.min !== undefined ? some(scale.min) : none,
        max: scale?.max !== undefined ? some(scale.max) : none,
        warnAt: scale?.warnAt !== undefined ? some(scale.warnAt) : none,
    });
}

type Styles = Record<string, Record<string, unknown>>;
type GroupKindValue = Extract<ValueTypeOf<typeof Plan.Types.Row>["kind"], { type: "group" }>["value"];

export interface GroupRowProps {
    row: PlanRowValue;
    kind: GroupKindValue;
    styles: Styles;
    gridTemplate: string;
    height: number;
    depth: number;
    collapsed: boolean;
    /** Renderer-derived strip cells (`summaryAggregate` declared in the IR). */
    summaryCells?: readonly HeatCellValue[] | undefined;
    /** The scale those cells inherit from the members (see `model.ts`). */
    summaryScale?: HeatScale | undefined;
    /** Renderer-derived direct-member count — printed as the `"8 rs"` meta
     *  when the IR declares none (#568: the count is an aggregate like any
     *  other, so it is derived here rather than baked into the row). */
    memberCount?: number | undefined;
    /** Whether the derived numbers cover an INCOMPLETE prefix (a paged canvas
     *  still loading) — the count prints `~8 rs` and the band carries
     *  `data-plan-partial` (#567 D9). The author's own `meta` is never
     *  rewritten: it is their text, not a derivation. */
    partial?: boolean | undefined;
}

/** One group band — full-width strip on the shared template. */
export function GroupRow({ row, kind, styles, gridTemplate, height, depth, collapsed, summaryCells, summaryScale, memberCount, partial }: GroupRowProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    // A declared meta line wins; otherwise the derived member count stands in.
    const meta = row.gutter.meta.type === "some"
        ? row.gutter.meta.value
        : (memberCount !== undefined && memberCount > 0
            ? `${partial === true ? "~" : ""}${memberCount} rs`
            : undefined);
    const value = row.gutter.value.type === "some" ? row.gutter.value.value : undefined;
    const statusTone = row.status.type === "some" ? row.status.value.type : undefined;
    const summary = collapsed
        ? (kind.summary.type === "some"
            ? kind.summary.value
            : (summaryCells !== undefined && summaryCells.length > 0 ? derivedSummaryArm(summaryCells, summaryScale) : undefined))
        : undefined;

    return (
        <Box
            css={styles.groupBand}
            gridTemplateColumns={gridTemplate}
            height={`${height}px`}
            data-plan-group={row.key}
            data-collapsed={collapsed ? "" : undefined}
            data-plan-partial={partial === true ? "" : undefined}
            onClick={() => dispatch({ t: "group.toggle", key: row.key })}
        >
            <Box css={styles.groupName} paddingLeft={`${12 + depth * INDENT_PX}px`}>
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
                        {statusTone !== undefined && <Box as="span" css={styles.statusDot} data-tone={statusTone} />}
                        {value !== undefined && <Box as="span" css={styles.gutterValue}>{value}</Box>}
                    </Box>
                )}
            </Box>
            <Box css={styles.plot}>
                {summary !== undefined && (
                    <>
                        <GridSeparators styles={styles} />
                        {/* The strip's cells are part of the BAND: clicking
                            them toggles the group like the rest of it, rather
                            than selecting a group key nothing displays (#615). */}
                        <HeatCells rowKey={row.key} cells={summary} styles={styles}
                            onCellClick={() => dispatch({ t: "group.toggle", key: row.key })} />
                    </>
                )}
                {scale.nowFrac !== undefined && <Box css={styles.nowLine} left={`${scale.nowFrac * 100}%`} />}
            </Box>
        </Box>
    );
}
