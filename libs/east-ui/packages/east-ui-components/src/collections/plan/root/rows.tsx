/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The thin per-row adapter (#616): compute one row's PRIMITIVE facts under
 * the canvas's focus and hand them to the memoized `PlanBodyRow` — plus the
 * R1 gap band that stands in for a run of unrelated rows.
 *
 * The row reads its own selection, chart toggle and active control from the
 * controller (#815), so none of those pass through here: a selection click
 * renders the two rows it moved, and the canvas not at all.
 *
 * @packageDocumentation
 */

import type { ComponentProps, ReactNode } from "react";
import { Box, VisuallyHidden } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";
import { EastChakraComponent } from "../../../component.js";
import { PlanBodyRow } from "../rows/BodyRow.js";
import { PlanPartBoundary } from "../rows/PartBoundary.js";
import { planRowRole } from "../rows/row-facts.js";
import type { PlanRowDrop } from "../rows/RowShell.js";
import type { PlanReview } from "../shell/Review.js";
import { usePlanItemNav } from "../controller/react.js";
import { statusText } from "../a11y.js";
import { usePlanGridRow } from "./grid.js";
import {
    bodyItemKey, rowHeight,
    type FocusGap, type LinkFamily, type PlanDerived, type PlanFocusCtx, type PlanRowIndex, type VisibleRow,
} from "../model.js";
import type { PlanEvent, RowKey } from "../plan-state.js";

type Styles = Record<string, Record<string, unknown>>;
type UIValue = ComponentProps<typeof EastChakraComponent>["value"];

/** What every body row of one render shares. */
export interface PlanRowContext {
    styles: Styles;
    gridTemplate: string;
    dense: boolean;
    storageKey: string;
    index: PlanRowIndex;
    derived: PlanDerived;
    dispatch: (e: PlanEvent) => void;
    /** The chart rows the user expanded (heights read it). */
    chartsExpanded: ReadonlySet<RowKey>;
    /** Which row is focused — all the row roles need. */
    focusCtx: PlanFocusCtx | undefined;
    /** The same, with the expand clamp — what the heights need. */
    heightCtx: PlanFocusCtx | undefined;
    /** The links focus's family. */
    linkFamily: LinkFamily | undefined;
    /** The rows any link edge touches — they grow the links control. */
    linkedKeys: ReadonlySet<RowKey>;
    /** Whether the root declares `expandRender`. */
    canExpand: boolean;
    /** The focused row's developer render / gutter body, or `null`. */
    expandBody: UIValue | null;
    expandGutterBody: UIValue | null;
    /** Whether derived numbers cover an incomplete paged prefix. */
    partial: boolean | undefined;
    review: PlanReview | undefined;
    rowDrop: PlanRowDrop | undefined;
}

/**
 * One visible row, as the memoized body row.
 *
 * @param v - The visible row
 * @param ctx - What the render's rows share
 * @returns The row element
 */
export function renderPlanRow(v: VisibleRow, ctx: PlanRowContext): ReactNode {
    const { focusCtx, linkFamily, expandBody, expandGutterBody, styles, storageKey } = ctx;
    const h = rowHeight(v, ctx.dense, ctx.chartsExpanded, ctx.heightCtx, ctx.derived);
    // R1 rails (unrelated data rows under a links focus, 11px), R2 context
    // strips (every data row but the focused one under an expand focus,
    // 16px) and the FOCUSED row, which carries the render inside itself —
    // what makes it (and its gutter) tall, see `PlanFocusCtx.renderPx`. Group
    // bands are exempt: they are wayfinding, and a wall of strips with no
    // structure between them is unreadable (`planRowRole`).
    const role = planRowRole(v, focusCtx, expandBody !== null);
    const isFocal = role === "focal";
    const up = linkFamily?.upstream.has(v.row.key) ?? false;
    const down = linkFamily?.downstream.has(v.row.key) ?? false;
    const focusTag = up && down ? "LINKED" as const : up ? "UPSTREAM" as const : down ? "DOWNSTREAM" as const : undefined;
    // R2 — the focused row keeps its NORMAL anatomy; `axis` washes /
    // suppresses the shared lines inside its plot.
    const rowExpand = v.row.expand.type === "some" ? v.row.expand.value : undefined;
    const axisMode = isFocal && rowExpand !== undefined && rowExpand.axis.type !== "keep"
        ? rowExpand.axis.type
        : undefined;
    return (
        <PlanBodyRow
            v={v}
            h={h}
            styles={styles}
            gridTemplate={ctx.gridTemplate}
            hasChildren={(ctx.index.children.get(v.row.key)?.length ?? 0) > 0}
            derived={ctx.derived}
            dispatch={ctx.dispatch}
            focusRole={role}
            focusTag={focusTag}
            axisMode={axisMode}
            showLinksControl={ctx.linkedKeys.has(v.row.key)}
            showExpandControl={v.row.expand.type === "some" && ctx.canExpand}
            partial={ctx.partial}
            review={ctx.review}
            rowDrop={ctx.rowDrop}
            {...(isFocal && expandBody !== null ? {
                // The author's render is its own part (#811): a throw while
                // rendering it stays inside the focused row.
                expandBody: (
                    <PlanPartBoundary part="expand render" resetKey={expandBody} styles={styles}>
                        <EastChakraComponent value={expandBody} storageKey={`${storageKey}.${v.row.key}.expand`} />
                    </PlanPartBoundary>
                ),
                bandHeight: rowHeight(v, ctx.dense, ctx.chartsExpanded, undefined, ctx.derived),
                ...(expandGutterBody !== null ? {
                    expandGutter: (
                        <PlanPartBoundary part="expand gutter" resetKey={expandGutterBody} styles={styles}>
                            <EastChakraComponent value={expandGutterBody}
                                storageKey={`${storageKey}.${v.row.key}.expandgutter`} />
                        </PlanPartBoundary>
                    ),
                } : {}),
            } : {})}
        />
    );
}

/**
 * The words a gap band stands for (#819) — how many rows (or group bands) the
 * links focus folded into it.
 *
 * @param gap - The gap
 * @returns `12 hidden rows`
 */
export function gapText(gap: FocusGap): string {
    const n = gap.rows > 0 ? gap.rows : gap.groups;
    const what = gap.rows > 0 ? "row" : "group";
    return `${n} hidden ${what}${n === 1 ? "" : "s"}`;
}

/**
 * The R1 gap band — ONE double-height ⋯ band replacing a run of unrelated
 * rows (their count rides beside the icon, the worst hidden tone at right);
 * a click returns to all rows, like a rail. A grid row of its own (#819):
 * Enter returns, as the click does.
 */
export function PlanGapBand({ gap, h, styles, gridTemplate, dispatch }: {
    gap: FocusGap;
    /** The height the model laid the band out at — the recipe sizes it from
     *  the same geometry variable (#817). */
    h: number;
    styles: Styles;
    gridTemplate: string;
    dispatch: (e: PlanEvent) => void;
}) {
    const itemKey = bodyItemKey({ kind: "gap", gap });
    const { active, focusSeq } = usePlanItemNav(itemKey);
    const grid = usePlanGridRow(itemKey, active, focusSeq);
    return (
        <Box ref={grid.ref} css={styles.focusGap} gridTemplateColumns={gridTemplate}
            role="row" aria-level={1} tabIndex={grid.tabIndex} onFocus={grid.onFocus}
            data-plan-item={itemKey}
            data-plan-gap={gap.rows + gap.groups}
            data-plan-h={h}
            onClick={() => dispatch({ t: "focus.clear" })}>
            <Box css={styles.focusGapInner} role="gridcell">
                <FontAwesomeIcon icon={faEllipsis} />
                <Box as="span" aria-hidden="true">{gap.rows > 0 ? gap.rows : gap.groups}</Box>
                <VisuallyHidden>{gapText(gap)}</VisuallyHidden>
            </Box>
            <Box position="relative" role="gridcell">
                {gap.tone !== undefined && (
                    <Box as="span" css={styles.statusDot} data-tone={gap.tone}
                        role="img" aria-label={statusText(gap.tone)}
                        position="absolute" right="12px" top="50%" transform="translateY(-50%)" />
                )}
            </Box>
        </Box>
    );
}
