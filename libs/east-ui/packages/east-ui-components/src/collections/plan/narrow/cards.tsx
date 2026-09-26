/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One data row as a narrow card — the gutter identity as its head, the kind
 * plot as its body (split out of `narrow/index.tsx`, #815).
 *
 * @packageDocumentation
 */

import { memo, useMemo, type ComponentProps } from "react";
import { Box } from "@chakra-ui/react";
import { EastChakraComponent } from "../../../component.js";
import { usePlanDispatch, usePlanScale } from "../context.js";
import { GridSeparators } from "../rows/RowShell.js";
import { KindPlot } from "../rows/KindPlot.js";
import { ChartLeftTicks } from "../rows/ChartRow.js";
import { PlanPartBoundary } from "../rows/PartBoundary.js";
import { RowDiagnostic } from "../rows/RowDiagnostic.js";
import { PlanDecisionCell, hasDecision, tagOf, type PlanReview } from "../shell/Review.js";
import { statusText } from "../a11y.js";
import { usePlanWords } from "../words.js";
import { pxOf, type PlanDerived, type PlanRowValue } from "../model.js";
import type { PlanDraftMark } from "../use-plan-editing.js";

type Styles = Record<string, Record<string, unknown>>;
type UIValue = ComponentProps<typeof EastChakraComponent>["value"];

/** §10: a drilled row expands to ~148pt in place, unless it declares a height. */
const NARROW_RENDER_PX = 148;

export interface NarrowRowCardProps {
    row: PlanRowValue;
    /** The card body's height — the row's kind height (Measures force a
     *  chart's expanded branch). */
    h: number;
    /** A chart row draws at expanded density. */
    chartExpanded: boolean;
    selected: boolean;
    /** Whether a second tap drills the row (it declares `expand` and the root
     *  can render it). */
    canDrill: boolean;
    /** The drilled row's developer render and gutter body — on the drilled
     *  card only. */
    drill: { body: UIValue; gutter: UIValue | null } | undefined;
    /** Whether the row nests children (a collapsed parent draws slimmer bars). */
    hasChildren: boolean;
    styles: Styles;
    derived: PlanDerived;
    storageKey: string;
    review: PlanReview | undefined;
    /** Enrols the card in the list's viewport observer (a paged canvas, #812). */
    watch: ((el: HTMLElement | null) => (() => void) | undefined) | undefined;
    /** The row's draft mark (#880) — the canvas row's, where the draft was made. */
    draft: PlanDraftMark | undefined;
}

/**
 * Whether a card's facts are unchanged. The derivations are rebuilt whole on
 * every data change and every paged window landing, but a card reads only
 * its own row's entries from them — the ones `KindPlot` draws (bands, the
 * heat arm, table series and chart it draws, #824) and the diagnostic that
 * replaces it. So a
 * reveal that adds cards below, or a window landing elsewhere, re-renders none
 * of the cards already shown (#812): a tap costs the cards it adds.
 */
function sameCard(a: NarrowRowCardProps, b: NarrowRowCardProps): boolean {
    const keys = Object.keys(a) as (keyof NarrowRowCardProps)[];
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
        if (key !== "derived" && a[key] !== b[key]) return false;
    }
    const k = a.row.key;
    return a.derived.bands.get(k) === b.derived.bands.get(k)
        && a.derived.heatArms.get(k) === b.derived.heatArms.get(k)
        && a.derived.tableSeries.get(k) === b.derived.tableSeries.get(k)
        && a.derived.charts.get(k) === b.derived.charts.get(k)
        && a.derived.diagnostics.get(k) === b.derived.diagnostics.get(k);
}

/** One data row as a card: head = the gutter identity, body = the plot. */
export const NarrowRowCard = memo(function NarrowRowCard({
    row, h, chartExpanded, selected, canDrill, drill, hasChildren,
    styles, derived, storageKey, review, watch, draft,
}: NarrowRowCardProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const words = usePlanWords();
    const v = useMemo(() => ({ row, depth: 0, collapsed: false }), [row]);
    const isChart = row.kind.type === "chart";
    const declaredPx = row.expand.type === "some" && row.expand.value.height.type === "some"
        ? pxOf(row.expand.value.height.value)
        : undefined;
    const renderPx = declaredPx ?? NARROW_RENDER_PX;
    const gutter = row.gutter;
    const isId = gutter.id;
    const sub = gutter.sub.type === "some" ? gutter.sub.value : undefined;
    const value = gutter.value.type === "some" ? gutter.value.value : undefined;
    const meta = gutter.meta.type === "some" ? gutter.meta.value : undefined;
    const statusTone = row.status.type === "some" ? row.status.value.type : undefined;
    // A row that cannot be placed shows its diagnostic in the card body
    // (#811) — no marks, and no value ticks for marks that are not there.
    const diagnostic = derived.diagnostics.get(row.key);
    return (
        <Box ref={watch} css={styles.narrowCard} data-plan-card={row.key}
            data-selected={selected ? "" : undefined}
            data-expanded={drill !== undefined ? "" : undefined}
            // A drafted row (#880) — the canvas row's marks.
            data-draft={draft !== undefined ? "" : undefined}
            data-incomplete={draft === "incomplete" ? "" : undefined}
            data-invalid={draft === "invalid" ? "" : undefined}
            // Tap selects; a second tap on a selected row that declares
            // `expand` drills it in place (and again returns) — §10.
            onClick={() => dispatch(selected && canDrill
                ? { t: "focus.expand", key: row.key }
                : { t: "row.select", key: row.key })}
        >
            <Box css={styles.narrowCardHead}>
                <Box css={styles.narrowCardTitle} data-id={isId ? "" : undefined}>{gutter.label}</Box>
                {meta !== undefined && <Box as="span" css={styles.gutterMeta}>{meta}</Box>}
                <Box display="flex" alignItems="center" gap="6px" marginLeft="auto" flexShrink={0}>
                    {value !== undefined && <Box as="span" css={styles.gutterValue}>{value}</Box>}
                    {/* The dot's colour IS the status — its name says it, as the canvas row's does (#819). */}
                    {statusTone !== undefined && <Box as="span" css={styles.statusDot} data-tone={statusTone}
                        role="img" aria-label={statusText(statusTone, words)} />}
                </Box>
            </Box>
            {sub !== undefined && <Box css={styles.narrowCardSub}>{sub}</Box>}
            {drill !== undefined && drill.gutter !== null && (
                <Box css={styles.expandGutterBody} data-plan-expandgutter marginX="12px" marginBottom="8px">
                    <PlanPartBoundary part={{ kind: "expandGutter" }} resetKey={drill.gutter} styles={styles}>
                        <EastChakraComponent value={drill.gutter} storageKey={`${storageKey}.${row.key}.expandgutter`} />
                    </PlanPartBoundary>
                </Box>
            )}
            <Box css={styles.narrowCardBody} height={`${h}px`} data-plan-cardbody={row.kind.type}>
                {!isChart && <GridSeparators styles={styles} />}
                {diagnostic !== undefined ? (
                    <RowDiagnostic diagnostic={diagnostic} styles={styles} />
                ) : (
                    <PlanPartBoundary part={{ kind: "row", key: row.key, label: row.gutter.label }} resetKey={row} styles={styles}>
                        <KindPlot v={v} styles={styles} derived={derived}
                            hasChildren={hasChildren}
                            ctx={false} plotHeight={h} chartExpanded={chartExpanded} />
                        {row.kind.type === "chart" && (
                            <Box css={styles.narrowTicks}>
                                <ChartLeftTicks kind={derived.charts.get(row.key) ?? row.kind.value} styles={styles} height={h} />
                            </Box>
                        )}
                    </PlanPartBoundary>
                )}
                {scale.nowFrac !== undefined && (
                    <Box css={styles.nowLine} data-plan-axisline left={`${scale.nowFrac * 100}%`} />
                )}
            </Box>
            {drill !== undefined && (
                <Box css={styles.narrowRender} data-plan-expandrender height={`${renderPx}px`}>
                    <PlanPartBoundary part={{ kind: "expandRender" }} resetKey={drill.body} styles={styles}>
                        <EastChakraComponent value={drill.body} storageKey={`${storageKey}.${row.key}.expand`} />
                    </PlanPartBoundary>
                </Box>
            )}
            {review !== undefined && hasDecision(row) && (
                <Box css={styles.narrowCardFoot}>
                    <PlanDecisionCell rowKey={row.key} tag={tagOf(row)} enabled={review.writable && row.edits.verdict} review={review} />
                </Box>
            )}
        </Box>
    );
}, sameCard);
