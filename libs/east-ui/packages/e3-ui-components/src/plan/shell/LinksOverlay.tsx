/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The links-focus layer (R1) — `Plan links.html` (#1258): one ARROW per family
 * edge, out of its source run's end and into its destination run's start
 * (`shared/links/geometry.ts`), stroked at its WEIGHT — its quantity's third of the
 * family's largest, 2, 4 or 8, and 1.5 with none — in the muted ink over a
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
 * dashed slot as tall as it draws, open toward the edge. Edges whose rows the
 * focus rails are not drawn. Each link names the figure it draws
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
 * The drawing is the shared links layer's (`shared/links/layer.tsx`, #1321),
 * which the Allocation's links draw through too; this overlay lays Plan's
 * links out from its rows and names what a hit on each is.
 */

import { useCallback, useMemo, useSyncExternalStore, useRef, type RefObject } from "react";
import { Box } from "@chakra-ui/react";
import { variant } from "@elaraai/east";
import { layoutRibbons, type LinkedElement, type RibbonBeyond, type RibbonBody } from "./ribbon-layout.js";
import { LinksLayer, type LinkRibbon } from "../../shared/links/layer.js";
import { rowKeyOf, type PlanLinkValue } from "../model.js";
import type { PlanScale } from "../scale.js";
import { usePlanResolvers, type PlanElementRefValue } from "../context.js";
import { usePlanWords } from "../words.js";
import { useElementHeight, useElementWidth } from "../use-element-height.js";

type Styles = Record<string, Record<string, unknown>>;

const NO_REF: RefObject<HTMLElement | null> = { current: null };
const NO_LAYOUT: ReturnType<typeof layoutRibbons> = { ribbons: [], edgeSlots: [] };

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
    /** A bounded frame's scroll element and the sticky chrome above its rows —
     *  what the view is read from. Absent for an unbounded frame, which shows
     *  every row. */
    frame?: { scrollElRef: RefObject<HTMLElement | null>; headerRef: RefObject<HTMLElement | null> } | undefined;
}

/**
 * How far an element has scrolled, followed through its scroll events.
 *
 * @param ref - The scroll element
 * @param active - Whether to follow it at all
 * @returns Its `scrollTop` (0 while inactive)
 */
function useScrollTop(ref: RefObject<HTMLElement | null>, active: boolean): number {
    const subscribe = useCallback((notify: () => void) => {
        const el = ref.current;
        if (!active || el === null) return () => undefined;
        el.addEventListener("scroll", notify, { passive: true });
        return () => el.removeEventListener("scroll", notify);
    }, [ref, active]);
    return useSyncExternalStore(subscribe, () => (active ? ref.current?.scrollTop ?? 0 : 0), () => 0);
}

/** The links-focus ribbon layer — `VirtualRows`' overlay, in the rows' coordinates. */
export function LinksOverlay({
    styles, links, visibleKeys, body, beyond, scale, element, gutterPx, frame,
}: LinksOverlayProps) {
    const words = usePlanWords();
    const { onElementClick } = usePlanResolvers();
    const layerRef = useRef<HTMLDivElement | null>(null);
    // The plot's px are the layer's width less the gutter's.
    const width = useElementWidth(layerRef, true);
    const plotWidth = width !== undefined ? width - gutterPx : 0;
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
            words,
        })
        : NO_LAYOUT), [links, visibleKeys, body, beyond, element, scale, gutterPx, plotWidth, viewTop, viewBottom, words]);
    const ribbons = useMemo((): LinkRibbon[] => layout.ribbons.map((r) => ({ ...r, id: r.link })), [layout]);
    // A hit on a link names its ref — the canvas's tooltip reads its caption,
    // and a click opens the root's popover for it (`refOfElement`) and reports it.
    const hit = useCallback((r: LinkRibbon) => {
        const l = links[r.id]!;
        return {
            "data-link-key": l.key,
            "data-link-from": rowKeyOf(l.from.row), "data-link-from-run": l.from.run,
            "data-link-to": rowKeyOf(l.to.row), "data-link-to-run": l.to.run,
            onClick: () => onElementClick?.(variant("link", { key: l.key, from: l.from, to: l.to }) as PlanElementRefValue),
        };
    }, [links, onElementClick]);
    // Drawn inside the treegrid, over its rows, and pointer-only: a reader
    // hears the family from the rows' own Upstream / Downstream / Linked Tags
    // and the focus announcement instead (#819). A ribbon's `aria-label`
    // stays — it is the tooltip's text.
    return (
        <Box ref={layerRef} css={styles.ribbons} data-plan-ribbons aria-hidden="true">
            <LinksLayer ribbons={ribbons} edgeSlots={layout.edgeSlots} width={width} height={body.height}
                clip={{ left: gutterPx, width: plotWidth }} hit={hit} />
        </Box>
    );
}
