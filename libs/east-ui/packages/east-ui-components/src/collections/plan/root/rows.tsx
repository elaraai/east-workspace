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
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEllipsis } from "@fortawesome/free-solid-svg-icons";
import { EastChakraComponent } from "../../../component.js";
import { PlanBodyRow } from "../rows/BodyRow.js";
import { PlanPartBoundary } from "../rows/PartBoundary.js";
import type { PlanRowDrop } from "../rows/RowShell.js";
import type { PlanReview } from "../shell/Review.js";
import {
    rowHeight,
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
    const kind = v.row.kind;
    const h = rowHeight(v, ctx.dense, ctx.chartsExpanded, ctx.heightCtx, ctx.derived);
    // R1 rails — unrelated data rows under a links focus collapse to 11px.
    const isRail = focusCtx?.kind === "links" && kind.type !== "group"
        && v.row.key !== focusCtx.key && !(focusCtx.family?.has(v.row.key) ?? false);
    // ── R2 context strip (#591) ── Under an expand focus every DATA row but
    // the focused one compresses to 16px. Group bands are exempt: they are
    // wayfinding, and a wall of strips with no structure between them is
    // unreadable.
    const isCtx = focusCtx?.kind === "expand" && v.row.key !== focusCtx.key && kind.type !== "group";
    // The FOCUSED row carries the render inside itself, which is what makes
    // it (and its gutter) tall — see `PlanFocusCtx.renderPx`.
    const isFocal = focusCtx?.kind === "expand" && v.row.key === focusCtx.key
        && kind.type !== "group" && expandBody !== null;
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
            focusRole={isRail ? "rail" : isFocal ? "focal" : isCtx ? "ctx" : "none"}
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
 * The R1 gap band — ONE double-height ⋯ band replacing a run of unrelated
 * rows (their count rides beside the icon, the worst hidden tone at right);
 * a click returns to all rows, like a rail.
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
    return (
        <Box css={styles.focusGap} gridTemplateColumns={gridTemplate}
            data-plan-gap={gap.rows + gap.groups}
            data-plan-h={h}
            onClick={() => dispatch({ t: "focus.clear" })}>
            <Box css={styles.focusGapInner}>
                <FontAwesomeIcon icon={faEllipsis} />
                <Box as="span">{gap.rows > 0 ? gap.rows : gap.groups}</Box>
            </Box>
            <Box position="relative">
                {gap.tone !== undefined && (
                    <Box as="span" css={styles.statusDot} data-tone={gap.tone}
                        position="absolute" right="12px" top="50%" transform="translateY(-50%)" />
                )}
            </Box>
        </Box>
    );
}
