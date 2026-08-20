/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One canvas body row, memoized (#616) — the row-kind switch extracted from
 * the canvas's render callback so a store change re-renders O(changed rows)
 * instead of O(mounted rows).
 *
 * The contract that makes the memo real: every prop is a PRIMITIVE or an
 * identity-stable object. The canvas passes per-row facts as booleans/strings
 * (`selected`, `chartExpanded`, `focusRole`, …) — never whole `ui` Sets — and
 * `visible` keeps its identity across store changes that do not change WHICH
 * rows show (its memo keys on `grain`/`collapsed`, not the whole `ui`). A
 * selection click therefore re-renders exactly two rows; a chart toggle one.
 *
 * Scale changes still repaint every row — correctly: the row CONTENT consumes
 * `PlanScaleContext`, and context pierces the memo by design. What the memo
 * removes is the store-change tax, not the geometry-change work.
 */

import { memo, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { variant } from "@elaraai/east";
import { RowShell, type PlanRowDrop } from "./RowShell.js";
import { SpanRow } from "./SpanRow.js";
import { GroupRow } from "./GroupRow.js";
import { ChartRowPlot, ChartLeftTicks } from "./ChartRow.js";
import { HeatCells } from "./HeatRow.js";
import { BucketsRow } from "./BucketsRow.js";
import { CardsRow } from "./CardsRow.js";
import { EventsRow } from "./EventsRow.js";
import { TableRowCells } from "./TableRow.js";
import { PlanDecisionCell, tagOf, type PlanReview } from "../shell/Review.js";
import { getSomeorUndefined } from "../../../utils.js";
import type { PlanDerived, PlanRowIndex, VisibleRow } from "../model.js";
import type { PlanEvent } from "../plan-state.js";

type Styles = Record<string, Record<string, unknown>>;

/**
 * The row kinds that accept a drop.
 *
 * @remarks
 * A Plan's rows are heterogeneous, so "can you drop here" is a per-KIND
 * question before it is a per-row one — and the line is not arbitrary. These
 * four render a **collection of discrete scheduled objects** (runs, bucket
 * events, marks, chips): things a library card can BECOME, at an instant the
 * pointer names.
 *
 * The rest are excluded on the same principle:
 *
 * - `chart` / `heat` / `table` render DERIVED values — a plotted series, an
 *   intensity field, computed cells. There is nothing for a card to become,
 *   and a number is not a destination.
 * - `group` is wayfinding chrome; its MEMBERS are the droppable things, and
 *   accepting on the strip would make a collapsed group swallow drops meant
 *   for a row inside it.
 *
 * A canvas narrows further with `canDrop` — this set is what is structurally
 * possible, the predicate is what this particular canvas permits.
 */
export const DROPPABLE_KINDS: ReadonlySet<string> = new Set(["span", "buckets", "events", "cards"]);

export interface PlanBodyRowProps {
    v: VisibleRow;
    /** The row's height (parent-computed via `rowHeight`, focus context applied). */
    h: number;
    styles: Styles;
    gridTemplate: string;
    /** Span bar height (20 default / 16 dense). */
    barHeight: number;
    storageKey: string;
    /** The row-tree index (children lookups). Stable per decoded data. */
    index: PlanRowIndex;
    /** The renderer-side derivations. Stable per decoded data. */
    derived: PlanDerived;
    dispatch: (e: PlanEvent) => void;
    selected: boolean;
    /** Whether THIS chart row is user-toggled to expanded. */
    chartExpanded: boolean;
    /**
     * This row's presentation under the canvas's row focus:
     * `none` (no focus, or full-height family), `rail` (R1 unrelated — 11px),
     * `ctx` (R2 context strip — 16px), `focal` (the R2 focused row).
     */
    focusRole: "none" | "rail" | "ctx" | "focal";
    /** The links-focus family tag (R1). */
    focusTag: "UPSTREAM" | "DOWNSTREAM" | "LINKED" | undefined;
    /** The expand render's axis treatment (R2, focal row only). */
    axisMode: "dim" | "off" | undefined;
    /** Whether the row grows the links / expand focus controls. */
    showLinksControl: boolean;
    showExpandControl: boolean;
    /** Which of this row's controls is the active focus, if any. */
    activeControl: "links" | "expand" | undefined;
    /** Whether derived numbers cover an incomplete paged prefix (#567 D9). */
    partial: boolean | undefined;
    /** The review model, when the canvas carries review chrome. */
    review: PlanReview | undefined;
    /** The shared drop registration, when the canvas is a drag target. */
    rowDrop: PlanRowDrop | undefined;
    /** Focal-row extras (only ever passed to the focal row). */
    expandBody?: ReactNode;
    expandGutter?: ReactNode;
    /** The focal row's natural kind height (its marks' band). */
    bandHeight?: number | undefined;
}

/**
 * Test-only render probe — lets the memo property be asserted as WHICH rows
 * rendered, deterministically, rather than inferred from profiler timings.
 * `undefined` outside tests; the call is a single optional invocation.
 */
let bodyRowRenderProbe: ((key: string) => void) | undefined;
/** Install (or clear) the test render probe. Test use only. */
export function setBodyRowRenderProbe(fn: ((key: string) => void) | undefined): void {
    bodyRowRenderProbe = fn;
}

/** One body row — a group band, an R1 rail, or a kind row in its shell. */
export const PlanBodyRow = memo(function PlanBodyRow({
    v, h, styles, gridTemplate, barHeight, storageKey, index, derived,
    dispatch, selected, chartExpanded, focusRole, focusTag, axisMode,
    showLinksControl, showExpandControl, activeControl, partial, review, rowDrop,
    expandBody, expandGutter, bandHeight,
}: PlanBodyRowProps) {
    bodyRowRenderProbe?.(v.row.key);
    const kind = v.row.kind;

    // R1 rails — unrelated rows collapse to 11px, never removed: order,
    // scroll and the status dot survive, and the rail itself returns.
    if (focusRole === "rail") {
        const railTone = v.row.status.type === "some" ? v.row.status.value.type : undefined;
        return (
            <Box css={styles.rail} gridTemplateColumns={gridTemplate} data-plan-rail={v.row.key}
                onClick={() => dispatch({ t: "focus.clear" })}>
                <Box position="relative">
                    {railTone !== undefined && (
                        <Box as="span" css={styles.statusDot} data-tone={railTone}
                            position="absolute" right="12px" top="2px" />
                    )}
                </Box>
            </Box>
        );
    }

    if (kind.type === "group") {
        return (
            <GroupRow row={v.row} kind={kind.value} styles={styles} gridTemplate={gridTemplate}
                height={h} depth={v.depth} collapsed={v.collapsed}
                summaryCells={derived.groupSummary.get(v.row.key)}
                memberCount={derived.groupMembers.get(v.row.key)}
                partial={partial} />
        );
    }

    const isCtx = focusRole === "ctx";
    const isFocal = focusRole === "focal" && expandBody !== undefined;
    // The row-scoped focus controls + family tags.
    const rowControls: ReadonlyArray<{ kind: "links" | "expand"; active: boolean; onClick: () => void }> = [
        ...(showLinksControl ? [{
            kind: "links" as const,
            active: activeControl === "links",
            onClick: () => dispatch({ t: "focus.links", key: v.row.key }),
        }] : []),
        ...(showExpandControl ? [{
            kind: "expand" as const,
            active: activeControl === "expand",
            onClick: () => dispatch({ t: "focus.expand", key: v.row.key }),
        }] : []),
    ];
    const hasChildren = (index.children.get(v.row.key)?.length ?? 0) > 0;
    const shellBase = {
        row: v.row, styles, gridTemplate, depth: v.depth,
        selected,
        controls: isCtx ? undefined : rowControls, focusTag, axisMode, ctx: isCtx,
        ...(isFocal ? {
            expandBody,
            bandHeight,
            ...(expandGutter !== undefined ? { expandGutter } : {}),
        } : {}),
        decision: review !== undefined && review.hasRowVerbs
            ? <PlanDecisionCell rowKey={v.row.key} tag={tagOf(v.row)} review={review} />
            : undefined,
        // Only the kinds that hold droppable objects register a cell —
        // a chart / heat / table row is inert to a drag by construction,
        // not by predicate (see `DROPPABLE_KINDS`).
        drop: DROPPABLE_KINDS.has(kind.type) ? rowDrop : undefined,
    } as const;
    switch (kind.type) {
        case "span": {
            return (
                <RowShell {...shellBase} height={h}
                    caret={hasChildren ? { collapsed: v.collapsed } : undefined}
                    onCaretClick={hasChildren ? () => dispatch({ t: "group.toggle", key: v.row.key }) : undefined}>
                    <SpanRow rowKey={v.row.key} kind={kind.value} styles={styles} ctx={isCtx}
                        bands={derived.bands.get(v.row.key) ?? []}
                        barHeight={v.collapsed && hasChildren ? 12 : barHeight}
                        storageKey={`${storageKey}.${v.row.key}`}
                        partial={partial} />
                </RowShell>
            );
        }
        case "chart": {
            const declaredExpanded = kind.value.height.type === "expanded";
            const expandable = kind.value.expandable.type === "some" && kind.value.expandable.value;
            const expanded = declaredExpanded || chartExpanded;
            return (
                <RowShell {...shellBase} height={h} noGrid={false}
                    caret={expandable ? { collapsed: !expanded } : undefined}
                    onCaretClick={expandable ? () => dispatch({ t: "chart.toggle", key: v.row.key }) : undefined}
                    gutterOverlay={<ChartLeftTicks kind={kind.value} styles={styles} height={h} />}>
                    <ChartRowPlot kind={kind.value} styles={styles} height={h}
                        expanded={expanded} rowKey={v.row.key} ctx={isCtx} />
                </RowShell>
            );
        }
        case "heat": {
            // A declared-aggregate parent renders its derived cells inside
            // the empty scale-bearing heat arm — rebuilt with `variant`, so
            // the wrap is a real East value like the arm it replaces (#617).
            const derivedCells = derived.heatCells.get(v.row.key);
            const cells = derivedCells !== undefined && kind.value.cells.type === "heat"
                ? variant("heat", { ...kind.value.cells.value, cells: derivedCells })
                : kind.value.cells;
            return (
                <RowShell {...shellBase} height={h}
                    caret={hasChildren ? { collapsed: v.collapsed } : undefined}
                    onCaretClick={hasChildren ? () => dispatch({ t: "group.toggle", key: v.row.key }) : undefined}>
                    <HeatCells rowKey={v.row.key} cells={cells} styles={styles} ctx={isCtx} />
                </RowShell>
            );
        }
        case "buckets":
            return (
                <RowShell {...shellBase} height={h}
                    caret={hasChildren ? { collapsed: v.collapsed } : undefined}
                    onCaretClick={hasChildren ? () => dispatch({ t: "group.toggle", key: v.row.key }) : undefined}>
                    <BucketsRow rowKey={v.row.key} kind={kind.value} styles={styles} ctx={isCtx}
                        storageKey={`${storageKey}.${v.row.key}`} />
                </RowShell>
            );
        case "table": {
            // A declared-aggregate parent renders its derived subtotal
            // cells as ONE plain series; leaf rows render their declared
            // series (per-position style, raw cells).
            const derivedSeries = derived.tableSeries.get(v.row.key);
            const emphasis = kind.value.emphasis.type === "body" ? undefined : kind.value.emphasis.type;
            return (
                <RowShell {...shellBase} height={h} emphasis={emphasis}
                    caret={hasChildren ? { collapsed: v.collapsed } : undefined}
                    onCaretClick={hasChildren ? () => dispatch({ t: "group.toggle", key: v.row.key }) : undefined}>
                    <TableRowCells rowKey={v.row.key}
                        series={derivedSeries ?? kind.value.series}
                        split={kind.value.split.type} ctx={isCtx}
                        format={getSomeorUndefined(kind.value.format)} styles={styles} />
                </RowShell>
            );
        }
        case "cards":
            return (
                <RowShell {...shellBase} height={h}>
                    <CardsRow rowKey={v.row.key} kind={kind.value} styles={styles} ctx={isCtx}
                        storageKey={`${storageKey}.${v.row.key}`} />
                </RowShell>
            );
        case "events":
            return (
                <RowShell {...shellBase} height={h}>
                    <EventsRow rowKey={v.row.key} kind={kind.value} styles={styles} ctx={isCtx}
                        storageKey={`${storageKey}.${v.row.key}`} />
                </RowShell>
            );
    }
});
