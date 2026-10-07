/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The links-focus layer (R1) — `Plan links.html` (#1258): one ARROW per family
 * edge, out of its source run's end and into its destination run's start
 * (`ribbon-geometry.ts`), stroked at its WEIGHT — its quantity's third of the
 * family's largest, 2, 4 or 8, and 1.5 with none — in the muted ink over a
 * paper CASING one px either side, so it reads over any bar it crosses. Every
 * link's casing lies under every link's ink; the lit link is drawn last, over
 * the others. A caption sits on a paper knockout 12 tall, 4 either side of its
 * text: on an S's riser, a loopback's lane, or above a one-row link's source.
 *
 * Every endpoint comes from the MODEL (#818, `ribbon-layout.ts`): a row's
 * place is the body's own height arithmetic — or, for a row in an evicted
 * paged window, that window's offset in its block's band (#823) — its bar the
 * geometry table's, a run's x its window fraction across the plot. The layer is drawn inside the
 * frame's rows (`VirtualRows`' `overlay`), in their coordinates, so it scrolls
 * with them natively and re-lays out in the same render as they do — a
 * collapse, a chart toggle, a window landing. Nothing is measured but the
 * layer's own width (the plot's px) and, in a bounded frame, the view: how far
 * it has scrolled and how tall it is, which is what clamps an endpoint past an
 * edge to it, with a stub pointing toward its row.
 *
 * A linked run OUTSIDE the time window lands on its row's plot edge in a
 * dashed slot as tall as its bar, open toward the edge. Edges whose rows the
 * focus rails are not drawn.
 *
 * Each link is hit-testable along its centerline (its stroke and 5 either
 * side): hovering one lights it — the strong ink, drawn over the others — and
 * haloes the two runs it joins, 1px four outside them, and the canvas's one
 * tooltip shows its quantity caption (`root/overlays.tsx`, the labelled-mark
 * path) — a link with no quantity has no caption and no tooltip.
 * A click reports the link's element ref (`{ key, from, to }`, #824) to the
 * root's `onElementClick`, and the one overlay layer opens the root's popover
 * for it, reading the ref back from the hit path's attributes like any
 * element's.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback, type RefObject } from "react";
import { Box } from "@chakra-ui/react";
import { variant } from "@elaraai/east";
import { RIBBON_SLOT_W, layoutRibbons, type LaidRibbon, type RibbonBeyond, type RibbonBody } from "./ribbon-layout.js";
import type { RibbonEnd } from "./ribbon-geometry.js";
import { rowKeyOf, type PlanLinkValue } from "../model.js";
import type { PlanScale } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import { usePlanResolvers, type PlanElementRefValue } from "../context.js";
import { usePlanWords } from "../words.js";
import { useElementHeight, useElementWidth } from "../use-element-height.js";

type Styles = Record<string, Record<string, unknown>>;

/** How far beyond the band the hit area reaches, each side (px). */
const HIT_REACH = 5;
/** The paper either side of a link's ink — its casing (px). */
const CASING = 1;
/** A caption's knockout: its height, the space either side of its text, and
 *  how far above the text's baseline it starts (px). */
const KNOCKOUT_H = 12;
const KNOCKOUT_PAD = 4;
const KNOCKOUT_RISE = 9.5;
/** A lit link's halo: how far outside a run it is drawn (the middle of its
 *  1px line), and its corner — a run's corner, 4 out (px). */
const HALO_OUT = 4.5;
const HALO_R = 7.5;

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
    /** A run's instants by `(rowKey, runKey)`. */
    runDates: (rowKey: string, runKey: string) => { start: PlanInstantValue; end: PlanInstantValue } | undefined;
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

/** The halo round a run a lit link joins — 1px, four outside it; in view only. */
function RunHalo({ end, side }: { end: RibbonEnd; side: "from" | "to" }) {
    if (end.off !== undefined) return null;
    return (
        <rect data-plan-linkend={side} x={end.leftX - HALO_OUT} y={end.top - HALO_OUT}
            width={Math.max(2, end.rightX - end.leftX) + 2 * HALO_OUT} height={end.bottom - end.top + 2 * HALO_OUT}
            rx={HALO_R} />
    );
}

/** A link's casing — the paper either side of its band and round its heads. */
function Casing({ r }: { r: LaidRibbon }) {
    return (
        <g data-plan-ribbon-casing={r.link}>
            <path data-plan-casing="band" d={r.stroke} strokeWidth={r.width + 2 * CASING} />
            <path data-plan-casing="head" d={r.head} />
            {r.tail !== "" && <path data-plan-casing="head" d={r.tail} />}
        </g>
    );
}

/** Size each caption's knockout to its text: 4 either side of it. */
function fitKnockouts(svg: SVGSVGElement | null): void {
    if (svg === null) return;
    for (const text of svg.querySelectorAll<SVGTextElement>("[data-plan-ribbon-caption]")) {
        const knockout = text.previousElementSibling;
        if (knockout === null || knockout.tagName.toLowerCase() !== "rect") continue;
        const width = typeof text.getComputedTextLength === "function" ? text.getComputedTextLength() : 0;
        knockout.setAttribute("x", String(Number(text.getAttribute("x")) - width / 2 - KNOCKOUT_PAD));
        knockout.setAttribute("width", String(width + 2 * KNOCKOUT_PAD));
    }
}

/** The links-focus ribbon layer — `VirtualRows`' overlay, in the rows' coordinates. */
export function LinksOverlay({
    styles, links, visibleKeys, body, beyond, scale, runDates, gutterPx, frame,
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
            links, visibleKeys, body, beyond, runDates, scale,
            plot: { left: gutterPx, width: plotWidth },
            viewport: viewTop !== undefined && viewBottom !== undefined ? { top: viewTop, bottom: viewBottom } : undefined,
            words,
        })
        : NO_LAYOUT), [links, visibleKeys, body, beyond, runDates, scale, gutterPx, plotWidth, viewTop, viewBottom, words]);
    // The link under the pointer — lit, drawn over the others, its runs haloed.
    const [lit, setLit] = useState<number | null>(null);
    // A lit link that is gone (the focus moved on) lights nothing.
    useLayoutEffect(() => {
        if (lit !== null && !layout.ribbons.some((r) => r.link === lit)) setLit(null);
    }, [lit, layout]);
    // Each caption's knockout is as wide as its text: measured after every
    // render, and again once the fonts have come in.
    const svgRef = useRef<SVGSVGElement | null>(null);
    useLayoutEffect(() => { fitKnockouts(svgRef.current); });
    useEffect(() => {
        const fonts = typeof document !== "undefined" ? document.fonts : undefined;
        if (fonts === undefined) return undefined;
        const refit = () => fitKnockouts(svgRef.current);
        fonts.addEventListener("loadingdone", refit);
        return () => fonts.removeEventListener("loadingdone", refit);
    }, []);

    const { ribbons, edgeSlots } = layout;
    // The lit link last: its casing and ink over every other link's.
    const ordered = lit === null ? ribbons
        : [...ribbons.filter((r) => r.link !== lit), ...ribbons.filter((r) => r.link === lit)];
    // Drawn inside the treegrid, over its rows, and pointer-only: a reader
    // hears the family from the rows' own Upstream / Downstream / Linked Tags
    // and the focus announcement instead (#819). A ribbon's `aria-label`
    // stays — it is the tooltip's text.
    return (
        <Box ref={layerRef} css={styles.ribbons} data-plan-ribbons aria-hidden="true">
            {(ribbons.length > 0 || edgeSlots.length > 0) && (
                <svg ref={svgRef} width={width} height={body.height}>
                    {/* An end past the window lands in a dashed slot as tall as
                        its bar, open toward the plot's edge. */}
                    {edgeSlots.map((s, i) => {
                        const inner = s.side === "right" ? s.x - RIBBON_SLOT_W : s.x + RIBBON_SLOT_W;
                        return (
                            <path key={`slot-${i}`} data-plan-linkslot={s.side}
                                d={`M ${s.x} ${s.y} H ${inner} V ${s.y + s.h} H ${s.x}`} />
                        );
                    })}
                    {/* Every link's casing, under every link's ink — the lit
                        link's comes with it, over the rest. */}
                    {ordered.map((r) => (r.link === lit ? null : <Casing key={`casing-${r.link}`} r={r} />))}
                    {ordered.map((r) => {
                        const l = links[r.link]!;
                        const isLit = lit === r.link;
                        return (
                            <g key={r.link} data-plan-link={r.link} data-lit={isLit ? "" : undefined}>
                                {isLit && <Casing r={r} />}
                                <path data-plan-ribbon-band d={r.stroke} strokeWidth={r.width} />
                                <path data-plan-ribbon-head d={r.head} data-plan-stub={r.to.off} />
                                {r.tail !== "" && <path data-plan-ribbon-head d={r.tail} data-plan-stub={r.from.off} />}
                                {isLit && (
                                    <>
                                        <RunHalo end={r.from} side="from" />
                                        <RunHalo end={r.to} side="to" />
                                    </>
                                )}
                                {/* The hit area — the stroke and 5 either side
                                    of it. Its caption is the canvas's tooltip;
                                    it names the link's ref, so a click opens
                                    the root's popover for it (`refOfElement`)
                                    and reports it. */}
                                <path data-link={r.link} aria-label={r.label}
                                    data-link-key={l.key}
                                    data-link-from={rowKeyOf(l.from.row)} data-link-from-run={l.from.run}
                                    data-link-to={rowKeyOf(l.to.row)} data-link-to-run={l.to.run}
                                    d={r.stroke} strokeWidth={r.width + 2 * HIT_REACH}
                                    onClick={() => onElementClick?.(
                                        variant("link", { key: l.key, from: l.from, to: l.to }) as PlanElementRefValue)}
                                    onPointerEnter={() => setLit(r.link)}
                                    onPointerLeave={() => setLit((now) => (now === r.link ? null : now))} />
                            </g>
                        );
                    })}
                    {/* The captions, over every link: each on its paper
                        knockout, sized to its text once drawn. */}
                    {ribbons.map((r) => (r.label === undefined ? null : (
                        <g key={`label-${r.link}`} data-plan-ribbon-label={r.link}>
                            <rect data-plan-ribbon-knockout x={r.lx} y={r.ly - KNOCKOUT_RISE} width={0} height={KNOCKOUT_H} />
                            <text data-plan-ribbon-caption x={r.lx} y={r.ly} textAnchor={r.anchor}>{r.label}</text>
                        </g>
                    )))}
                </svg>
            )}
        </Box>
    );
}
