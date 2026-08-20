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

import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faLink, faUpRightAndDownLeftFromCenter } from "@fortawesome/free-solid-svg-icons";
import { useDropCell, useDragLayerOptional, type CellCoord, type DragPayload } from "../../../dnd/drag-layer";
import { canDropAllows, candidateEvent, type CanDropFn } from "../../../dnd/ir-can-drop";
import { toEastDateTimeSlot } from "../../../dnd/slot-key";
import { usePlanCursor, usePlanDispatch, usePlanScale } from "../context.js";
import type { PlanRowValue } from "../model.js";

type Styles = Record<string, Record<string, unknown>>;

/** Indent per nesting level (px) — the §4 nested figures. */
export const INDENT_PX = 30;

/**
 * The plot's bucket-column separators, O(1) DOM per row (#616).
 *
 * Equal-width buckets (hour / day / week — every high-count resolution) paint
 * ALL interior separators as one repeating gradient on a single element: it
 * starts at the FIRST interior edge and tiles at one bucket width, so no line
 * lands on the plot's own boundaries. A 100-row × 500-bucket canvas used to
 * mount ~50k separator divs; this is 100. Unequal buckets (month / quarter —
 * clipped edge buckets, low counts by construction) keep the per-edge divs.
 *
 * FLANKS (#620): the #619 overscan periods carry separators too — a constant
 * handful of per-edge divs per side, clipped at rest, so the region a brush
 * pan reveals shows the same grid the window does. The lines AT the window
 * boundaries (frac 0 / 1) nudge outward so the at-rest render is unchanged:
 * at 0 the gutter's own border already draws that line, at 1 the plot ends.
 * A truncated axis skips right-flank edges inside the window — the uncovered
 * remainder is visibly dead space at rest and must stay bare.
 */
export function GridSeparators({ styles }: { styles: Styles }) {
    const scale = usePlanScale();
    const n = scale.buckets.length;
    if (n < 2) return null;
    const w0 = scale.buckets[0]!.x1 - scale.buckets[0]!.x0;
    const uniform = scale.buckets.every((b) => Math.abs((b.x1 - b.x0) - w0) < 1e-9);
    const flankEdges: number[] = [];
    for (const b of scale.overscan) {
        for (const e of [b.x0, b.x1]) {
            if (e > 1e-9 && e < 1 - 1e-9) continue;       // inside the window: never
            if (!flankEdges.some((x) => Math.abs(x - e) < 1e-9)) flankEdges.push(e);
        }
    }
    const flanks = flankEdges.map((e, i) => (
        <Box key={`f${i}`} css={styles.gridCol} data-plan-axisline data-plan-gridflank
            style={{ left: e <= 1e-9 ? `calc(${(e * 100).toFixed(4)}% - 1px)` : `${(e * 100).toFixed(4)}%` }} />
    ));
    if (uniform) {
        return (
            <>
                <Box css={styles.gridSep} data-plan-axisline data-plan-gridsep
                    left={`${scale.buckets[0]!.x1 * 100}%`}
                    style={{
                        // One bucket width, in THIS element's own space: it spans
                        // n−1 buckets, so a tile is 1/(n−1) of it.
                        backgroundImage: `repeating-linear-gradient(to right, var(--chakra-colors-border-subtle) 0 1px, transparent 1px calc(100% / ${n - 1}))`,
                    }} />
                {flanks}
            </>
        );
    }
    return (
        <>
            {scale.buckets.slice(0, -1).map((b, i) => (
                <Box key={i} css={styles.gridCol} data-plan-axisline left={`${b.x1 * 100}%`} />
            ))}
            {flanks}
        </>
    );
}

/**
 * A row's DnD drop registration — present only when the canvas is a drag
 * target AND this row's KIND accepts drops (see `DROPPABLE_KINDS`).
 */
export interface PlanRowDrop {
    /** The canvas's declared DnD id — the cell ref's `surface`. */
    surface: string;
    /** The root's decoded IR `canDrop`, consulted with the candidate event the
     *  pointer's CURRENT bucket would produce. */
    canDrop?: CanDropFn | undefined;
}

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
    /** DnD drop registration for this row's plot. Absent ⇒ the row registers
     *  no cell, so it is never a destination and never lights up. */
    drop?: PlanRowDrop | undefined;
    children: ReactNode;
}

/** One canvas body row — gutter + plot on the shared template. */
export function RowShell({
    row, styles, gridTemplate, height, depth, selected,
    caret, onCaretClick, emphasis, gutterOverlay, noGrid,
    controls, focusTag, axisMode, ctx, decision, drop, children,
    expandBody, expandGutter, bandHeight,
}: RowShellProps) {
    const scale = usePlanScale();
    const dispatch = usePlanDispatch();
    const cursor = usePlanCursor();
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

    // ── DnD drop cell ─────────────────────────────────────────────────────
    // The PLOT is the drop target, and its coordinate resolves from the
    // pointer at drop time (the Gantt's continuous-surface pattern). Two
    // things differ from the Gantt, both because of what a Plan row is:
    //
    //  - the ROW needs no virtualizer band math — a Plan row key IS its data
    //    key, and this component already is that row;
    //  - registration is PER ROW rather than one cell over the whole body,
    //    because a Plan's rows are heterogeneous. Which kinds accept a drop
    //    is a per-row question (`DROPPABLE_KINDS`), and the valid / active /
    //    ⊘ treatment has to land on the row the pointer is over rather than
    //    washing the entire canvas.
    //
    // The SLOT is the bucket under the pointer, named by its start instant —
    // the canvas's own vocabulary for "when" (`onCellClick` reports the same
    // bucket instant, not an index), spelled with the shared temporal
    // encoding so a host parses a Plan slot exactly like a Gantt slot.
    const plotElRef = useRef<HTMLElement | null>(null);
    const resolveCoord = useCallback((clientX: number, _clientY: number): CellCoord => {
        const rect = plotElRef.current?.getBoundingClientRect();
        const frac = rect !== undefined && rect.width > 0
            ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
            : 0;
        // The shared frac→bucket resolver (#617): the exact right edge closes
        // into the last bucket; a truncated axis's uncovered remainder is NO
        // bucket (#618) — the slot stays empty and `dropVeto` refuses it, so a
        // drop past the truncation point can never land at a wrong instant.
        const bi = scale.bucketAtFrac(frac);
        const bucket = bi >= 0 ? scale.buckets[bi] : undefined;
        return {
            surface: drop?.surface ?? "",
            row: row.key,
            slot: bucket !== undefined ? toEastDateTimeSlot(bucket.start) : "",
        };
    }, [scale, drop?.surface, row.key]);
    // The registered coord is a placeholder: every real coordinate comes back
    // through `resolveCoord`, which the layer calls at hover and at drop.
    const dropCoord = useMemo<CellCoord | null>(
        () => (drop !== undefined ? { surface: drop.surface, row: row.key, slot: "" } : null),
        [drop, row.key],
    );
    const dropVeto = useCallback((payload: DragPayload, x?: number, y?: number): boolean => {
        if (drop === undefined) return true;
        if (x !== undefined && y !== undefined) {
            const coord = resolveCoord(x, y);
            // No bucket under the pointer (past a truncated axis's coverage) —
            // structurally not a destination, before any predicate is asked.
            if (coord.slot === "") return false;
            if (drop.canDrop === undefined) return true;
            return canDropAllows(drop.canDrop, candidateEvent(payload, coord));
        }
        if (drop.canDrop === undefined) return true;
        const fn = drop.canDrop;
        // The drag-START sweep has no pointer yet — but a Plan cell's identity
        // is its ROW, and that is known right here. So the sweep answers for
        // this row at its FIRST bucket rather than blanket-allowing: a row the
        // predicate can only ever refuse never lights up as a candidate,
        // instead of promising a drop and taking it back on hover.
        //
        // This verdict is only the opening AFFORDANCE. It is never what decides
        // a drop: `onMove` re-asks at the live pointer position and `endDrag`
        // re-asks again before delivering, so a predicate that discriminates on
        // the SLOT still resolves per bucket — this row simply starts out
        // showing the answer for its first one.
        const first = scale.buckets[0];
        return canDropAllows(fn, candidateEvent(payload, {
            surface: drop.surface,
            row: row.key,
            slot: first !== undefined ? toEastDateTimeSlot(first.start) : "",
        }));
    }, [drop, resolveCoord, scale, row.key]);
    const dropRef = useDropCell(dropCoord, false, dropVeto, resolveCoord);
    // One ref doing two jobs: the layer's registration, and the rect
    // `resolveCoord` measures the pointer against.
    const plotRef = useCallback((el: HTMLDivElement | null) => {
        plotElRef.current = el;
        dropRef(el);
    }, [dropRef]);

    // ── The landing band ──────────────────────────────────────────────────
    // While a card is over this row, show WHERE it would come to rest. The
    // band spans the bucket `resolveCoord` names, so the preview and the drop
    // cannot disagree — they read the same geometry from the same rect.
    //
    // Positioned by writing the style DIRECTLY, never through React state: a
    // pointermove is a per-frame event, and routing it through state would
    // re-render this row (and, through the shared reducer, the whole canvas)
    // on every one. Whether the band is VISIBLE is not decided here at all —
    // the recipe shows it only inside `[data-drop-active]`, which the drag
    // layer sets on exactly the destination cell and never sets on a refused
    // one, so a vetoed row shows no landing band for free.
    const dragActive = useDragLayerOptional()?.active === true;
    const previewRef = useRef<HTMLDivElement | null>(null);
    const positionPreview = useCallback((clientX: number) => {
        const el = previewRef.current;
        const rect = plotElRef.current?.getBoundingClientRect();
        if (el === null || rect === undefined || rect.width <= 0) return;
        const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        // The same resolver the drop coordinate reads (#617) — the preview and
        // the drop cannot disagree. No bucket ⇒ the band stays where it was
        // (the cell is not active there anyway — `dropVeto` refused it).
        const bi = scale.bucketAtFrac(frac);
        const bucket = bi >= 0 ? scale.buckets[bi] : undefined;
        if (bucket === undefined) return;
        el.style.left = `${bucket.x0 * 100}%`;
        el.style.width = `${(bucket.x1 - bucket.x0) * 100}%`;
    }, [scale]);

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
                ref={plotRef}
                css={styles.plot}
                data-axis={axisMode}
                onPointerMove={(e) => {
                    // While a drag is in flight the landing band IS the readout,
                    // so the hairline would only add a second, competing mark.
                    if (dragActive) { positionPreview(e.clientX); return; }
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    if (rect.width <= 0) return;
                    // Display-only chrome — a direct DOM write through the
                    // cursor channel, never the reducer: dispatching here
                    // committed the whole canvas once per pointer event (#609).
                    cursor.move((e.clientX - rect.left) / rect.width);
                }}
                onPointerLeave={() => { if (!dragActive) cursor.leave(); }}
            >
                {/* The brush-pan layer (#616): the plot's window-anchored
                    content translates by the body's `--plan-pan-px` during a
                    horizon-brush slide — the plot's own clip stays put. */}
                <Box css={styles.panLayer} data-plan-panlayer>
                    {noGrid !== true && <GridSeparators styles={styles} />}
                    {drop !== undefined && (
                        <Box ref={previewRef} css={styles.dropPreview} data-plan-drop-preview />
                    )}
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
                    {/* The shared hairline — positioned by the body's ONE
                        `--plan-cursor-x` variable and shown only under
                        `[data-plan-cursor]` (#609): a pointermove writes a style,
                        renders nothing. Strips carry no hairline. */}
                    {ctx !== true && <Box css={styles.cursorLine} data-plan-cursorline />}
                    {scale.nowFrac !== undefined && <Box css={styles.nowLine} data-plan-axisline left={`${scale.nowFrac * 100}%`} />}
                </Box>
            </Box>
            {decision}
        </Box>
    );
}
