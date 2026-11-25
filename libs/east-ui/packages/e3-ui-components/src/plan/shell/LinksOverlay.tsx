/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The links-focus layer (R1) — `Plan links.html` (#1258): one ARROW per family
 * edge, out of its source run's end and into its destination run's start
 * (`shared/links/geometry.ts`), stroked at its WEIGHT — its quantity's third of the
 * family's largest, 2, 4 or 6 (ruled 17 Nov 2026), and 1.5 with none — in the muted ink over a
 * paper CASING one px either side, so it reads over any bar it crosses. Every
 * link's casing lies under every link's ink; the lit link is drawn last, over
 * the others. A caption sits on a paper knockout 12 tall, 4 either side of its
 * text: on an S's riser, a loopback's lane, or above a one-row link's source.
 * Nothing of the layer leaves the plot (ruled by the user): no route crosses
 * into the gutter, the canvas's first column, or past the plot's end
 * (`routeRibbon`'s drop and lift), a caption near an edge moves in, and the
 * plot clips what a halo or a casing would carry over its edge.
 *
 * Every endpoint comes from the MODEL (#818, `ribbon-layout.ts`): a row's
 * place is the body's own height arithmetic — or, for a row in an evicted
 * paged window, that window's offset in its block's band (#823) — and an
 * element's extent its window fraction across the plot, drawn as the geometry
 * table draws it (a bar at least its narrowest, a chip and a cell in by their
 * inset, a mark across its glyph, #1258). The layer is drawn inside the
 * frame's rows (`VirtualRows`' `overlay`), in their coordinates and their
 * stacking context, so it scrolls with them natively, re-lays out in the same
 * render as they do — a collapse, a chart toggle, a window landing — and lies
 * under the row controls and the now line. Nothing is measured but the
 * layer's own width (the plot's px) and, in a bounded frame, the view: how far
 * it has scrolled and how tall it is, which is what clamps an endpoint past an
 * edge to it, with a stub pointing toward its row.
 *
 * A linked element OUTSIDE the time window lands on its row's plot edge in a
 * dashed slot as tall as it draws, open toward the edge. An edge with an end
 * the focus does not gather is not drawn. Each link names the figure it draws
 * (`data-plan-route`: `s`, `loop`, `feed`, `runoff`, `stub` or `band`).
 *
 * Each link is hit-testable along its centerline (its stroke and 5 either
 * side): hovering one lights it — the strong ink, drawn over the others — and
 * haloes the two elements it joins, 1px four outside them, and the canvas's one
 * tooltip shows its quantity caption (`root/overlays.tsx`, the labelled-mark
 * path) — a link with no quantity has no caption and no tooltip.
 * A click reports the link's element ref (`{ key, from, to }`, #824) to the
 * root's `onElementClick`, and the one overlay layer opens the root's popover
 * for it, reading the ref back from the hit path's attributes like any
 * element's.
 *
 * A link kind's link (#1541, U10) selects as an event's element does: its key
 * names its kind and its row, and a click selects it — Shift, ⌘ or Ctrl adding
 * it to the selection or taking it out — so the inspector shows it and Delete
 * removes it. Selected, it draws in the ink, its caption outlined — each of
 * several selected so — and one selected alone carries the layer's × where
 * its kind takes a removal (`unlink`).
 *
 * The drawing is the shared links layer's (`shared/links/layer.tsx`, #1321),
 * which the Allocation's links draw through too; this overlay lays Plan's
 * links out from its rows and names what a hit on each is.
 */

import { useCallback, useContext, useMemo, useRef, type MouseEvent, type RefObject } from "react";
import { Box } from "@chakra-ui/react";
import { variant } from "@elaraai/east";
import { layoutRibbons, type LinkedElement, type RibbonBeyond, type RibbonBody, type RibbonLanes } from "./ribbon-layout.js";
import { LinksLayer, type LinkRibbon, type LinksLayerProps } from "../../shared/links/layer.js";
import { useScrollTop } from "../../shared/links/scroll.js";
import { rowKeyOf, type PlanLinkValue } from "../model.js";
import type { PlanScale } from "../scale.js";
import { usePlanDispatch, usePlanResolvers, type PlanElementRefValue } from "../context.js";
import { usePlanSelector } from "../controller/react.js";
import { PlanSelectableContext } from "../rows/element-select.js";
import { usePlanWords } from "../words.js";
import { useElementHeight, useElementWidth } from "../use-element-height.js";

type Styles = Record<string, Record<string, unknown>>;

const NO_REF: RefObject<HTMLElement | null> = { current: null };
const NO_LAYOUT: ReturnType<typeof layoutRibbons> = { ribbons: [], edgeSlots: [] };
/** No link selected. */
const NO_SELECTED: readonly number[] = [];

export interface LinksOverlayProps {
    /** The resolved `plan` recipe styles (the `ribbons` slot). */
    styles: Styles;
    /** The decoded link graph. */
    links: readonly PlanLinkValue[];
    /** The full-height row set (focused row + family) — edges outside it skip. */
    visibleKeys: ReadonlySet<string>;
    /** The canvas body as the ribbons see it (`ribbonBody`). */
    body: RibbonBody;
    /** Where a row the body does not hold is drawn — past the rows' top (a
     *  pinned row), or at its evicted window's place in its block's band (#823). */
    beyond: (key: string) => RibbonBeyond | undefined;
    /** The shared scale. */
    scale: PlanScale;
    /** The element a link's end names, by `(rowKey, runKey)` (`linkedElement`). */
    element: (rowKey: string, runKey: string) => LinkedElement | undefined;
    /** The grid's fixed track before the plot: the gutter (px). */
    gutterPx: number;
    /** The grid's fixed track after the plot: the right axis's rail (px, #1750); 0 where the Plan declares none. */
    railPx: number;
    /** The focus's lane plan (`planFocusLanes`), whose rules the body opened into bands (#1680's review); left out, none. */
    lanes?: RibbonLanes | undefined;
    /** The boxes the links stand back from: each bar's label, with its bar's padding (`labelBoxes`, #1680's review). */
    standBack?: LinksLayerProps["standBack"];
    /** A bounded frame's scroll element and the sticky chrome above its rows —
     *  what the view is read from. Absent for an unbounded frame, which shows
     *  every row. */
    frame?: { scrollElRef: RefObject<HTMLElement | null>; headerRef: RefObject<HTMLElement | null> } | undefined;
    /**
     * Removing a link kind's link from the canvas (#1541, U10): whether a link's kind takes a removal now, what removes
     * it, and the words of its ×. Left out, no link is removed here.
     */
    unlink?: PlanLinkUnlink | undefined;
}

/** How a link kind's link is removed from the canvas: the selected link's ×. */
export interface PlanLinkUnlink {
    /** Whether the link of a key is a link kind's that takes a removal now. */
    readonly can: (key: string) => boolean;
    /** Removes it, as one step of the history. */
    readonly run: (key: string) => void;
    /** The ×'s words. */
    readonly label: (key: string) => string;
}

/** The selected elements, by their keys. */
const selectElements = (s: { store: { ui: { elements: readonly string[] } } }): readonly string[] => s.store.ui.elements;

/** The links-focus ribbon layer — `VirtualRows`' overlay, in the rows' coordinates. */
export function LinksOverlay({
    styles, links, visibleKeys, body, beyond, scale, element, gutterPx, railPx, lanes, standBack, frame, unlink,
}: LinksOverlayProps) {
    const words = usePlanWords();
    const { onElementClick } = usePlanResolvers();
    const dispatch = usePlanDispatch();
    // A link kind's link selects by its key, as an event's element does (#1541, U10).
    const selectable = useContext(PlanSelectableContext);
    const elements = usePlanSelector(selectElements);
    // The links the layer draws selected: those of the selection, by their places in the list.
    const selected = useMemo(() => {
        if (elements.length === 0) return NO_SELECTED;
        const picked = links.flatMap((link, at) => (selectable(link.key) && elements.includes(link.key) ? [at] : []));
        return picked.length === 0 ? NO_SELECTED : picked;
    }, [links, elements, selectable]);
    // One link selected alone carries its ×.
    const lone = selected.length === 1 ? selected[0] : undefined;
    const layerRef = useRef<HTMLDivElement | null>(null);
    // The plot's px are the layer's width less the gutter's and the rail's.
    const width = useElementWidth(layerRef, true);
    const plotWidth = width !== undefined ? width - gutterPx - railPx : 0;
    // ── The view (a bounded frame only) — what clamps an endpoint ──
    // The rows sit under the sticky chrome, so the view in the rows' own
    // coordinates starts at the scroll offset and is the viewport less that
    // chrome tall.
    const bounded = frame !== undefined;
    const viewportPx = useElementHeight(frame?.scrollElRef ?? NO_REF, bounded);
    const headerPx = useElementHeight(frame?.headerRef ?? NO_REF, bounded);
    const scrollTop = useScrollTop(frame?.scrollElRef ?? NO_REF, bounded);
    const viewTop = bounded && viewportPx !== undefined ? scrollTop : undefined;
    const viewBottom = bounded && viewportPx !== undefined
        ? scrollTop + Math.max(0, viewportPx - (headerPx ?? 0))
        : undefined;
    const layout = useMemo(() => (plotWidth > 0
        ? layoutRibbons({
            links, visibleKeys, body, beyond, element, scale,
            plot: { left: gutterPx, width: plotWidth },
            viewport: viewTop !== undefined && viewBottom !== undefined ? { top: viewTop, bottom: viewBottom } : undefined,
            words, lanes,
        })
        : NO_LAYOUT), [links, visibleKeys, body, beyond, element, scale, gutterPx, plotWidth, viewTop, viewBottom, words, lanes]);
    const ribbons = useMemo((): LinkRibbon[] => layout.ribbons.map((r) => ({ ...r, id: r.link })), [layout]);
    // A hit on a link names its ref — the canvas's tooltip reads its caption,
    // and a click opens the root's popover for it (`refOfElement`) and reports it.
    const hit = useCallback((r: LinkRibbon) => {
        const l = links[r.id]!;
        return {
            "data-link-key": l.key,
            "data-link-from": rowKeyOf(l.from.row), "data-link-from-run": l.from.run,
            "data-link-to": rowKeyOf(l.to.row), "data-link-to-run": l.to.run,
            onClick: (event: MouseEvent) => {
                if (selectable(l.key)) dispatch({ t: "element.select", key: l.key, row: rowKeyOf(l.from.row), additive: event.shiftKey || event.metaKey || event.ctrlKey });
                onElementClick?.(variant("link", { key: l.key, from: l.from, to: l.to }) as PlanElementRefValue);
            },
        };
    }, [links, onElementClick, selectable, dispatch]);
    // The selected link's ×, where its kind takes a removal.
    const removable = lone !== undefined && unlink !== undefined && unlink.can(links[lone]!.key);
    const onUnlink = useCallback((id: number) => { unlink?.run(links[id]!.key); }, [unlink, links]);
    const unlinkLabel = useCallback((r: LinkRibbon) => unlink?.label(links[r.id]!.key) ?? "", [unlink, links]);
    // Drawn inside the treegrid, over its rows, and pointer-only: a reader
    // hears the family from the role bands the rows stand under — Upstream,
    // Focused, Linked, Downstream (#1680's review) — and the focus
    // announcement instead (#819). A ribbon's `aria-label` stays — it is the
    // tooltip's text.
    return (
        <Box ref={layerRef} css={styles.ribbons} data-plan-ribbons aria-hidden="true">
            <LinksLayer ribbons={ribbons} edgeSlots={layout.edgeSlots} width={width} height={body.height}
                clip={{ left: gutterPx, width: plotWidth }} hit={hit} selected={selected}
                onUnlink={removable ? onUnlink : undefined} unlinkLabel={removable ? unlinkLabel : undefined} standBack={standBack} />
        </Box>
    );
}
