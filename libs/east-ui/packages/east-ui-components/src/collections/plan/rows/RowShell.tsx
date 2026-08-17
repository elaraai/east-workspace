/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The alignment contract, mechanically (`Plan Spec.md` §3): every body row is
 * one two-column grid — the fixed gutter cell and a plot of `n` buckets — so
 * every kind aligns by construction. The shell renders the gutter identity
 * vocabulary (name / id / sub / value / meta / swatches / status dot / caret,
 * 30px-per-level indent), the plot's bucket grid lines, and the shared
 * now / cursor hairlines; the kind renderer supplies the plot content.
 */

import { useMemo, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faLink, faUpRightAndDownLeftFromCenter } from "@fortawesome/free-solid-svg-icons";
import { usePlanDispatch, usePlanScale } from "../context.js";
import type { PlanRowValue } from "../model.js";

type Styles = Record<string, Record<string, unknown>>;

/** Indent per nesting level (px) — the §4 nested figures. */
export const INDENT_PX = 30;

export interface RowShellProps {
    row: PlanRowValue;
    styles: Styles;
    /** Grid template (`"168px 1fr"`) — one source for every band. */
    gridTemplate: string;
    /** Row height (px) — fixed per kind (`model.rowHeight`). */
    height: number;
    /** Nesting depth (gutter indent). */
    depth: number;
    selected: boolean;
    /** Cursor fraction to draw the shared hairline at (undefined ⇒ none). */
    cursorFrac: number | undefined;
    /** The caret state for nesting parents (undefined ⇒ no caret). */
    caret?: { collapsed: boolean } | undefined;
    /** Caret click (subtree collapse / chart spark↔expanded toggle). The
     *  WHOLE gutter cell is the click target (the group-strip convention —
     *  a 14px caret is not a tree affordance); the plot keeps selection. */
    onCaretClick?: (() => void) | undefined;
    /** Table-row emphasis (K5: header wash / footer 2px top rule). */
    emphasis?: "header" | "footer" | undefined;
    /** Extra content overlaid on the gutter cell (chart left-axis ticks). */
    gutterOverlay?: ReactNode;
    /** Suppress the bucket grid lines (rows drawing their own canvas). */
    noGrid?: boolean;
    /** Row-scoped focus controls (R1 links / R2 expand) — 20px, hover-revealed
     *  at the gutter's right edge, pinned while active. */
    controls?: ReadonlyArray<{ kind: "links" | "expand"; active: boolean; onClick: () => void }> | undefined;
    /** The links-focus family tag (R1). */
    focusTag?: "UPSTREAM" | "DOWNSTREAM" | "LINKED" | undefined;
    /** The expand render's axis treatment inside this row (R2; default keep). */
    axisMode?: "dim" | "off" | undefined;
    /** R2 (#591) — the focused row's developer render, mounted INSIDE this
     *  row's plot cell beneath the row's own marks. Its presence is what makes
     *  the row (and so its gutter) tall. */
    expandBody?: ReactNode;
    /** R2 — content for the space the grown gutter cell opens up. */
    expandGutter?: ReactNode;
    /** R2 — the row's NATURAL kind height: the band its own marks keep at the
     *  top while the render fills the remainder. */
    bandHeight?: number | undefined;
    /** R2 context strip (#591) — this row is not the focus, so it compresses
     *  to 16px and its marks to 7px on the same axis. Never removed: order,
     *  scroll position and the status dot survive, and the strip itself is
     *  the return click target. */
    ctx?: boolean | undefined;
    /** The trailing review cell, when the canvas carries review chrome — the
     *  third track `gridTemplate` grows by (#569). */
    decision?: ReactNode;
    children: ReactNode;
}

/** One canvas body row — gutter + plot on the shared template. */
export function RowShell({
    row, styles, gridTemplate, height, depth, selected,
    cursorFrac, caret, onCaretClick, emphasis, gutterOverlay, noGrid,
    controls, focusTag, axisMode, ctx, decision, children,
    expandBody, expandGutter, bandHeight,
}: RowShellProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const gutter = row.gutter;
    // One flag, spread onto every slot that has a collapsed state. The slots
    // own the styling (`&[data-ctx]` in the recipe) — this only says which
    // elements are in a strip.
    const ctxAttr = ctx === true ? "" : undefined;
    // The row is EXPANDED when it carries a render. Everything the expanded
    // state changes — the tint, the top-aligned tall gutter, the banded plot —
    // keys off this one flag.
    const expanded = expandBody !== undefined;
    const expandedAttr = expanded ? "" : undefined;
    const sub = gutter.sub.type === "some" ? gutter.sub.value : undefined;
    const meta = gutter.meta.type === "some" ? gutter.meta.value : undefined;
    const value = gutter.value.type === "some" ? gutter.value.value : undefined;
    const isId = gutter.id.type === "some" && gutter.id.value;
    const statusTone = row.status.type === "some" ? row.status.value.type : undefined;

    // Interior bucket edges (skip the window edges) — the column separators.
    const edges = useMemo(
        () => scale.buckets.slice(0, -1).map((b) => b.x1),
        [scale],
    );

    return (
        <Box
            css={styles.row}
            gridTemplateColumns={gridTemplate}
            height={`${height}px`}
            data-plan-row={row.key}
            data-selected={selected ? "" : undefined}
            data-emphasis={emphasis}
            data-ctx={ctxAttr}
            data-expanded={expandedAttr}
            // A strip's whole job is to be the way back — clicking one returns
            // to all rows rather than selecting the row underneath.
            onClick={() => dispatch(ctx === true
                ? { t: "focus.clear" }
                : { t: "row.select", key: row.key })}
            cursor="pointer"
        >
            <Box
                css={styles.gutterCell}
                data-expanded={expandedAttr}
                paddingLeft={`${12 + depth * INDENT_PX}px`}
                onClick={onCaretClick !== undefined && ctx !== true
                    ? (e: React.MouseEvent) => { e.stopPropagation(); onCaretClick(); }
                    : undefined}
            >
                <Box css={styles.gutterName} data-id={isId ? "" : undefined} data-ctx={ctxAttr}>
                    {caret !== undefined && (
                        <Box as="span" css={styles.caret} data-collapsed={caret.collapsed ? "" : undefined}>
                            <FontAwesomeIcon icon={faCaretDown} />
                        </Box>
                    )}
                    <Box as="span" overflow="hidden" textOverflow="ellipsis" minWidth={0}>{gutter.label}</Box>
                    {/* The links-focus family tag (R1) — settles in after the
                        gather choreography. */}
                    {focusTag !== undefined && (
                        <Box as="span" css={styles.focusTag} data-plan-focustag={focusTag}>{focusTag}</Box>
                    )}
                    {/* §3 gutter anatomy: meta (an `.of` parent's aggregate
                        tag), then value right-aligned, status dot rightmost —
                        inline after the flex spacer so the label truncates. */}
                    {(meta !== undefined || value !== undefined || statusTone !== undefined) && (
                        <Box css={styles.gutterRight}>
                            {meta !== undefined && <Box as="span" css={styles.gutterMeta} data-ctx={ctxAttr}>{meta}</Box>}
                            {value !== undefined && <Box as="span" css={styles.gutterValue} data-ctx={ctxAttr}>{value}</Box>}
                            {statusTone !== undefined && <Box as="span" css={styles.statusDot} data-tone={statusTone} data-ctx={ctxAttr} />}
                        </Box>
                    )}
                    {/* Row controls (R1/R2) — rightmost; a control click never
                        selects or toggles the row. */}
                    {controls !== undefined && controls.length > 0 && (
                        <Box css={styles.rowControls} data-ctx={ctxAttr} data-expanded={expandedAttr}>
                            {controls.map((c) => (
                                <Box
                                    key={c.kind}
                                    as="button"
                                    css={styles.rowControl}
                                    data-plan-control={c.kind}
                                    data-active={c.active ? "" : undefined}
                                    aria-label={c.kind === "links" ? "Focus linked rows" : "Expand row"}
                                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); c.onClick(); }}
                                >
                                    <FontAwesomeIcon icon={c.kind === "links" ? faLink : faUpRightAndDownLeftFromCenter} />
                                </Box>
                            ))}
                        </Box>
                    )}
                </Box>
                {sub !== undefined && <Box css={styles.gutterSub} data-ctx={ctxAttr}>{sub}</Box>}
                {gutter.swatches.length > 0 && (
                    <Box display="flex" gap="7px" marginTop="1px">
                        {gutter.swatches.map((s, i) => (
                            <Box key={i} as="span" css={styles.gutterSwatch} data-ctx={ctxAttr}>
                                <Box as="i" background={s.color.includes(".") ? undefined : s.color}
                                    backgroundColor={s.color.includes(".") ? s.color : undefined} />
                                {s.label}
                            </Box>
                        ))}
                    </Box>
                )}
                {/* R2 — the space the grown gutter opens up is the author's
                    (`expandGutter`), below the row's own identity lines. */}
                {expandGutter !== undefined && (
                    <Box css={styles.expandGutterBody} data-plan-expandgutter>{expandGutter}</Box>
                )}
                {gutterOverlay}
            </Box>
            <Box
                css={styles.plot}
                data-axis={axisMode}
                onPointerMove={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    if (rect.width <= 0) return;
                    dispatch({ t: "cursor.move", frac: (e.clientX - rect.left) / rect.width });
                }}
                onPointerLeave={() => dispatch({ t: "cursor.leave" })}
            >
                {noGrid !== true && edges.map((x, i) => (
                    <Box key={i} css={styles.gridCol} data-plan-axisline left={`${x * 100}%`} />
                ))}
                {/* Expanded: the row's own marks hold a band at the top (they
                    position against it, so a 20px bar in a 200px row does not
                    drift to the middle), and the render takes the rest. */}
                {expanded ? (
                    <>
                        <Box css={styles.expandRowBand} height={`${bandHeight ?? 32}px`}>{children}</Box>
                        <Box css={styles.expandRenderBody} data-plan-expandrender
                            top={`${(bandHeight ?? 32) + 2}px`}>
                            {expandBody}
                        </Box>
                    </>
                ) : children}
                {cursorFrac !== undefined && <Box css={styles.cursorLine} left={`${cursorFrac * 100}%`} />}
                {scale.nowFrac !== undefined && <Box css={styles.nowLine} data-plan-axisline left={`${scale.nowFrac * 100}%`} />}
            </Box>
            {decision}
        </Box>
    );
}
