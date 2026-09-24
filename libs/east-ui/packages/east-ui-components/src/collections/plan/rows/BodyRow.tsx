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
 * identity-stable object, and the row reads its OWN slice of the UI state —
 * selection, chart toggle, active focus control — from the canvas controller
 * (`usePlanRowState`, #815). A selection click therefore renders exactly the
 * two rows it moved and never the canvas; a chart toggle, the one row whose
 * height it changes.
 *
 * The derivations are rebuilt whole on every data change and every paged
 * window landing, but a row reads only its own entries from them, and the
 * canvas keeps an entry's identity while its content holds
 * (`stableDerived`). So the memo compares those entries, not the maps: a
 * window landing renders the rows it added and the rows whose numbers it
 * moved, and none of the rows already on screen (#815).
 *
 * Scale changes still repaint every row — correctly: the row CONTENT consumes
 * `PlanScaleContext`, and context pierces the memo by design. What the memo
 * removes is the store-change tax, not the geometry-change work.
 */

import { memo, useEffect, type ReactNode } from "react";
import { Box, VisuallyHidden } from "@chakra-ui/react";
import { RowShell, type PlanRowDrop } from "./RowShell.js";
import { GroupRow } from "./GroupRow.js";
import { ChartLeftTicks } from "./ChartRow.js";
import { KindPlot } from "./KindPlot.js";
import { PlanPartBoundary } from "./PartBoundary.js";
import { RowDiagnostic } from "./RowDiagnostic.js";
import { rowToggle } from "./row-facts.js";
import { PlanDecisionCell, tagOf, type PlanReview } from "../shell/Review.js";
import { usePlanRowState } from "../controller/react.js";
import { usePlanGridRow } from "../root/grid.js";
import { statusText } from "../a11y.js";
import { usePlanWords } from "../words.js";
import type { PlanFocusTagWord } from "../messages.js";
import { rowItemKey, type PlanDerived, type VisibleRow } from "../model.js";
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
    /** Whether the row nests children (its caret, and a collapsed parent's
     *  slimmer bars). */
    hasChildren: boolean;
    /** The renderer-side derivations — compared by THIS row's entries. */
    derived: PlanDerived;
    dispatch: (e: PlanEvent) => void;
    /**
     * This row's presentation under the canvas's row focus:
     * `none` (no focus, or full-height family), `rail` (R1 unrelated — 11px),
     * `ctx` (R2 context strip — 16px), `focal` (the R2 focused row).
     */
    focusRole: "none" | "rail" | "ctx" | "focal";
    /** The links-focus family tag (R1). */
    focusTag: PlanFocusTagWord | undefined;
    /** The expand render's axis treatment (R2, focal row only). */
    axisMode: "dim" | "off" | undefined;
    /** Whether the row grows the links / expand focus controls. */
    showLinksControl: boolean;
    showExpandControl: boolean;
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

/**
 * Test-only mount probe — lets "a row keeps its component instance" be
 * asserted as mounts and unmounts per row (#812). An index-keyed body hands an
 * instance whichever row now sits at its index, which shows up here as a row
 * that is still on screen UNMOUNTING (the instance it mounted as went away)
 * — deterministic, where a render count cannot tell the two apart.
 * `undefined` outside tests.
 */
let bodyRowMountProbe: ((key: string, phase: "mount" | "unmount") => void) | undefined;
/** Install (or clear) the test mount probe. Test use only. */
export function setBodyRowMountProbe(fn: ((key: string, phase: "mount" | "unmount") => void) | undefined): void {
    bodyRowMountProbe = fn;
}

/**
 * Whether a row's facts are unchanged — every prop by identity, the
 * derivations by this row's own entries.
 */
function sameBodyRow(a: PlanBodyRowProps, b: PlanBodyRowProps): boolean {
    const keys = Object.keys(a) as (keyof PlanBodyRowProps)[];
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
        if (key !== "derived" && a[key] !== b[key]) return false;
    }
    const k = a.v.row.key;
    const da = a.derived;
    const db = b.derived;
    return da === db || (da.bands.get(k) === db.bands.get(k)
        && da.heatCells.get(k) === db.heatCells.get(k)
        && da.tableSeries.get(k) === db.tableSeries.get(k)
        && da.groupSummary.get(k) === db.groupSummary.get(k)
        && da.groupSummaryScale.get(k) === db.groupSummaryScale.get(k)
        && da.groupMembers.get(k) === db.groupMembers.get(k)
        && da.diagnostics.get(k) === db.diagnostics.get(k));
}

/** One body row — a group band, an R1 rail, or a kind row in its shell. */
export const PlanBodyRow = memo(function PlanBodyRow({
    v, h, styles, gridTemplate, hasChildren, derived,
    dispatch, focusRole, focusTag, axisMode,
    showLinksControl, showExpandControl, partial, review, rowDrop,
    expandBody, expandGutter, bandHeight,
}: PlanBodyRowProps) {
    bodyRowRenderProbe?.(v.row.key);
    // The row's own slice of the UI state — it re-renders when THIS moves.
    const { selected, chartExpanded, activeControl, active, focusSeq } = usePlanRowState(v.row.key);
    // Its place in the treegrid and its share of the tab stop (#819).
    const grid = usePlanGridRow(rowItemKey(v.row.key), active, focusSeq);
    const words = usePlanWords();
    const mountedAs = v.row.key;
    useEffect(() => {
        bodyRowMountProbe?.(mountedAs, "mount");
        return () => bodyRowMountProbe?.(mountedAs, "unmount");
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once per INSTANCE, under the row it mounted as
    }, []);
    const kind = v.row.kind;
    // A row that cannot be placed on the axis renders in place as its
    // diagnostic (#811) — gutter kept, marks replaced by the reason.
    const diagnostic = derived.diagnostics.get(v.row.key);

    // R1 rails — unrelated rows collapse to 11px, never removed: order,
    // scroll and the status dot survive, and the rail itself returns.
    if (focusRole === "rail") {
        const railTone = v.row.status.type === "some" ? v.row.status.value.type : undefined;
        return (
            <Box ref={grid.ref} css={styles.rail} gridTemplateColumns={gridTemplate} data-plan-rail={v.row.key}
                role="row" aria-level={v.depth + 1} aria-selected={selected}
                tabIndex={grid.tabIndex} onFocus={grid.onFocus} data-plan-item={rowItemKey(v.row.key)}
                // The recipe sizes the rail from the geometry variable; this
                // is the height the model laid it out at (#817).
                data-plan-h={h}
                onClick={() => dispatch({ t: "focus.clear" })}>
                {/* 11px carries no name — a reader still hears which row it is. */}
                <Box position="relative" role="rowheader">
                    <VisuallyHidden>{v.row.gutter.label}</VisuallyHidden>
                    {railTone !== undefined && (
                        <Box as="span" css={styles.statusDot} data-tone={railTone}
                            role="img" aria-label={statusText(railTone, words)}
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
                summaryScale={derived.groupSummaryScale.get(v.row.key)}
                memberCount={derived.groupMembers.get(v.row.key)}
                partial={partial} diagnostic={diagnostic} grid={grid} />
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
            ? <PlanDecisionCell rowKey={v.row.key} tag={tagOf(v.row)} review={review} grid />
            : undefined,
        // Only the kinds that hold droppable objects register a cell —
        // a chart / heat / table row is inert to a drag by construction,
        // not by predicate (see `DROPPABLE_KINDS`). A diagnostic row places
        // nothing, so nothing can land on it either.
        drop: DROPPABLE_KINDS.has(kind.type) && diagnostic === undefined ? rowDrop : undefined,
        grid,
    } as const;
    // The per-kind SHELL differences — caret, toggle, emphasis, the chart's
    // gutter ticks. The plot content itself is one switch shared with the
    // narrow layout's cards (`KindPlot`). What the caret toggles is the one
    // answer the keyboard reads too (`rowToggle`, #819).
    const toggle = rowToggle(v, hasChildren, chartExpanded);
    const caret = toggle !== undefined ? { collapsed: !toggle.open } : undefined;
    const onCaretClick = toggle !== undefined ? () => dispatch(toggle.event) : undefined;
    // `aria-expanded`: its section or chart — or, for a row with neither, its
    // expand render. A strip opens nothing: its one action is the way back.
    const expandedState = isCtx ? undefined
        : toggle !== undefined ? toggle.open
            : showExpandControl ? isFocal : undefined;
    let shellExtras: {
        caret?: { collapsed: boolean } | undefined;
        onCaretClick?: (() => void) | undefined;
        emphasis?: "header" | "footer" | undefined;
        noGrid?: boolean;
        gutterOverlay?: ReactNode;
    } = {};
    // The plot height a chart row scales against (see the chart case).
    let plotH = h;
    let chartExpanded_ = false;
    switch (kind.type) {
        case "span":
        case "heat":
        case "buckets":
            shellExtras = { caret, onCaretClick };
            break;
        case "chart": {
            const declaredExpanded = kind.value.height.type === "expanded";
            chartExpanded_ = declaredExpanded || chartExpanded;
            // The FOCAL row is tall (natural + render), but its marks live in
            // the band at the top — `RowShell` mounts `children` inside
            // `expandRowBand` at `bandHeight` — so the plot's y-scale, its
            // ref-label gate and the gutter ticks take the BAND height, never
            // the grown row's. Passing the grown `h` built a ~272px y-scale
            // that squashed into a ~32px band, opened the ≥48px ref-label
            // gate on a spark row, and pushed labels + ticks past the band
            // into the render (#591).
            plotH = isFocal ? (bandHeight ?? h) : h;
            shellExtras = {
                noGrid: false,
                caret,
                onCaretClick,
                // A STRIP carries no value axis — its plot re-encodes as a
                // tone strip (`ToneStrip`), so the gutter ticks would label a
                // scale that is not there, stacked in 16px. A diagnostic row
                // draws no marks, so it has no value axis either.
                gutterOverlay: isCtx || diagnostic !== undefined
                    ? undefined
                    : <ChartLeftTicks kind={kind.value} styles={styles} height={plotH} />,
            };
            break;
        }
        case "table":
            shellExtras = {
                caret, onCaretClick,
                emphasis: kind.value.emphasis.type === "body" ? undefined : kind.value.emphasis.type,
            };
            break;
        case "cards":
        case "events":
            break;
    }
    return (
        <RowShell {...shellBase} height={h} expandedState={expandedState} {...shellExtras}>
            {diagnostic !== undefined ? (
                <RowDiagnostic diagnostic={diagnostic} styles={styles} ctx={isCtx} />
            ) : (
                // One row's render failure stays in that row (#811).
                <PlanPartBoundary part={{ kind: "row", key: v.row.key }} resetKey={v.row} styles={styles}>
                    <KindPlot v={v} styles={styles} derived={derived}
                        hasChildren={hasChildren} ctx={isCtx}
                        plotHeight={plotH} chartExpanded={chartExpanded_} partial={partial} />
                </PlanPartBoundary>
            )}
        </RowShell>
    );
}, sameBodyRow);
