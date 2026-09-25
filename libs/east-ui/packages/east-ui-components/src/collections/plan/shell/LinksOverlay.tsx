/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The links-focus ribbon layer (R1) — the K8 ribbon vocabulary at the current
 * row set: one CONSTANT-THICKNESS band per family edge (a stroked centerline
 * at half the bar's height, ending in a plain triangle head), attached to the
 * runs' sides.
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
 * A linked run OUTSIDE the time window lands on its row's plot edge, behind a
 * full-bar-height band fading out at the window edge — the runoff treatment
 * (§4·K1) applied to a link. Edges whose rows the focus rails are not drawn.
 *
 * Each ribbon is hit-testable along its centerline (a wide transparent
 * stroke): hovering one lights it and rings the two runs it joins, and the
 * canvas's one tooltip shows its label (`root/overlays.tsx`, the labelled-mark
 * path). A click reports nothing yet — the element ref gains a `link` arm with
 * the values child (#824).
 */

import { useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback, type RefObject } from "react";
import { Box } from "@chakra-ui/react";
import { RIBBON_FADE_W, layoutRibbons, type RibbonBeyond, type RibbonBody } from "./ribbon-layout.js";
import type { RibbonEnd } from "./ribbon-geometry.js";
import type { PlanLinkValue } from "../model.js";
import type { PlanScale } from "../scale.js";
import type { PlanInstantValue } from "../instant.js";
import { useElementHeight, useElementWidth } from "../use-element-height.js";

type Styles = Record<string, Record<string, unknown>>;

/** The fade stops' ink — the band's (a gradient stop takes no class). */
const BRAND = "var(--chakra-colors-brand-600)";
/** How far beyond the band the hit area reaches, each side (px). */
const HIT_REACH = 5;

const NO_REF: RefObject<HTMLElement | null> = { current: null };
const NO_LAYOUT: ReturnType<typeof layoutRibbons> = { ribbons: [], fades: [] };

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
    /** The grid's fixed tracks either side of the plot: the gutter, and the review column (px). */
    gutterPx: number;
    trailingPx: number;
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

/** A ring around the run a lit ribbon joins — in view only. */
function RunRing({ end, side }: { end: RibbonEnd; side: "from" | "to" }) {
    if (end.off !== undefined) return null;
    return (
        <rect data-plan-linkend={side} x={end.leftX} y={end.top}
            width={Math.max(2, end.rightX - end.leftX)} height={end.bottom - end.top} rx={2} />
    );
}

/** The links-focus ribbon layer — `VirtualRows`' overlay, in the rows' coordinates. */
export function LinksOverlay({
    styles, links, visibleKeys, body, beyond, scale, runDates, gutterPx, trailingPx, frame,
}: LinksOverlayProps) {
    const uid = useId();
    const layerRef = useRef<HTMLDivElement | null>(null);
    // The plot's px are the layer's width less the grid's fixed tracks.
    const width = useElementWidth(layerRef, true);
    const plotWidth = width !== undefined ? width - gutterPx - trailingPx : 0;
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
        })
        : NO_LAYOUT), [links, visibleKeys, body, beyond, runDates, scale, gutterPx, plotWidth, viewTop, viewBottom]);
    // The ribbon under the pointer — lit, with its runs ringed.
    const [lit, setLit] = useState<number | null>(null);
    // A lit ribbon that is gone (the focus moved on) lights nothing.
    useLayoutEffect(() => {
        if (lit !== null && !layout.ribbons.some((r) => r.link === lit)) setLit(null);
    }, [lit, layout]);

    const { ribbons, fades } = layout;
    // Drawn inside the treegrid, over its rows, and pointer-only: a reader
    // hears the family from the rows' own UPSTREAM / DOWNSTREAM tags and the
    // focus announcement instead (#819). A ribbon's `aria-label` stays — it
    // is the tooltip's text.
    return (
        <Box ref={layerRef} css={styles.ribbons} data-plan-ribbons aria-hidden="true">
            {(ribbons.length > 0 || fades.length > 0) && (
                <svg width={width} height={body.height}>
                    <defs>
                        {/* The off-window landing — strongest AT the window
                            edge, fading inward (the runoff grammar, reversed
                            for an arrival from beyond the window). */}
                        <linearGradient id={`${uid}-fade-right`} x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0" stopColor={BRAND} stopOpacity={0} />
                            <stop offset="1" stopColor={BRAND} stopOpacity={0.3} />
                        </linearGradient>
                        <linearGradient id={`${uid}-fade-left`} x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0" stopColor={BRAND} stopOpacity={0.3} />
                            <stop offset="1" stopColor={BRAND} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    {fades.map((b, i) => (
                        <rect key={`fade-${i}`} data-plan-linkfade={b.side}
                            x={b.x} y={b.y} width={RIBBON_FADE_W} height={b.h}
                            fill={`url(#${uid}-fade-${b.side})`} />
                    ))}
                    {ribbons.map((r) => (
                        <g key={r.link} data-plan-link={r.link} data-lit={lit === r.link ? "" : undefined}>
                            <g data-plan-ribbon-ink opacity={r.opacity}>
                                <path data-plan-ribbon-band d={r.stroke} strokeWidth={r.width} />
                                <path data-plan-ribbon-head d={r.head} data-plan-stub={r.to.off} />
                                {r.tail !== "" && <path data-plan-ribbon-head d={r.tail} data-plan-stub={r.from.off} />}
                            </g>
                            {lit === r.link && (
                                <>
                                    <RunRing end={r.from} side="from" />
                                    <RunRing end={r.to} side="to" />
                                </>
                            )}
                            <text data-plan-ribbon-caption x={r.lx} y={r.ly} textAnchor={r.anchor}>{r.label}</text>
                            {/* The hit area — a wide transparent stroke along
                                the centerline. Its label is the canvas's
                                tooltip. */}
                            <path data-link={r.link} aria-label={r.label} d={r.stroke} strokeWidth={r.width + 2 * HIT_REACH}
                                onPointerEnter={() => setLit(r.link)}
                                onPointerLeave={() => setLit((now) => (now === r.link ? null : now))} />
                        </g>
                    ))}
                </svg>
            )}
        </Box>
    );
}
