/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The links-focus ribbon overlay (R1) — the K8 ribbon vocabulary at the
 * current row set: one CONSTANT-THICKNESS band per family edge (a stroked
 * centerline S-curve at the span-rect height, ending in a plain triangle
 * head), attached to span SIDES only, drawn once the rails settle (the 300ms
 * choreography). Geometry is measured from the live DOM (`[data-plan-row]` /
 * `[data-run]` rects relative to the overlay), so it holds under both
 * VirtualRows modes; scroll and resize re-measure.
 *
 * A linked run OUTSIDE the time window has no bar to anchor to: the ribbon
 * lands on that row's plot edge instead, marked by a full-row-height band
 * fading out at the window edge — the runoff treatment (§4·K1) applied to a
 * link, so "continues beyond the window" reads the same everywhere. Edges
 * whose rows sit railed have nothing to attach to and simply don't draw.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { Box } from "@chakra-ui/react";
import { routeRibbon } from "./ribbon-geometry.js";
import type { PlanLinkValue } from "../model.js";
import type { PlanScale } from "../scale.js";

const BRAND = "var(--chakra-colors-brand-600)";
/** Ribbon fill opacity bounds — share of the largest family quantity. */
const OPACITY_MIN = 0.16;
const OPACITY_MAX = 0.38;
/** The settle delay before first draw (heights animate .38s; overlays wait). */
const SETTLE_MS = 320;
/** Width of the off-window fade band (px). */
const FADE_W = 42;

interface Ribbon {
    /** The centerline path — STROKED at `width`, so the band keeps one fixed
     *  thickness along its whole run (never two drifting edge curves). */
    stroke: string;
    /** The head path — a plain triangle from band thickness to the tip. */
    head: string;
    /** Band thickness (the source span rect's height). */
    width: number;
    opacity: number;
    label: string;
    lx: number;
    ly: number;
    anchor: "start" | "middle" | "end";
}

/** A full-row fade band at a window edge (an off-window link landing). */
interface FadeBand {
    x: number;
    y: number;
    h: number;
    side: "left" | "right";
}

export interface LinksOverlayProps {
    /** The overlay's positioning parent (the canvas body wrapper). */
    container: HTMLElement | null;
    /** The decoded link graph. */
    links: readonly PlanLinkValue[];
    /** The full-height row set (focused row + family) — edges outside it skip. */
    visibleKeys: ReadonlySet<string>;
    /** The shared time scale (off-window detection). */
    scale: PlanScale;
    /** A run's instants by `(rowKey, runKey)` — off-window side resolution. */
    runDates: (rowKey: string, runKey: string) => { start: Date; end: Date } | undefined;
}

interface Endpoint {
    /** The attachment edge's candidate x positions (span left/right edges);
     *  equal when the side is forced (an off-window landing). */
    leftX: number;
    rightX: number;
    /** The attachment edge's vertical extent — the SPAN RECT's, exactly. */
    top: number;
    bottom: number;
    /** Set when the run sits outside the window — the fade-band side. */
    off?: FadeBand;
}

/** Measure one edge endpoint relative to `base` — the run bar's FULL edge
 *  (ribbons register exactly to the span rects), or the row's plot edge at
 *  full row height (+ fade band) when the run sits outside the window. */
function endpointFor(
    base: DOMRect,
    container: HTMLElement,
    scale: PlanScale,
    runDates: LinksOverlayProps["runDates"],
    rowKey: string,
    runKey: string,
): Endpoint | null {
    const row = container.querySelector(`[data-plan-row="${CSS.escape(rowKey)}"]`);
    if (row === null) return null;
    const rowRect = row.getBoundingClientRect();
    if (rowRect.width === 0 && rowRect.height === 0) return null;
    const run = row.querySelector(`[data-run="${CSS.escape(runKey)}"]`);
    if (run !== null) {
        const r = run.getBoundingClientRect();
        return {
            leftX: r.left - base.left,
            rightX: r.right - base.left,
            top: r.top - base.top,
            bottom: r.bottom - base.top,
        };
    }
    // No bar — is the run outside the window? Anchor at the plot edge with
    // the runoff-style fade band, at exactly the SPAN-RECT height and
    // vertical position (a rendered sibling bar's extent, else the default
    // 20px bar band centred in the row); otherwise fall back to the row.
    const plot = row.children[1] ?? row;
    const p = plot.getBoundingClientRect();
    const sibling = row.querySelector("[data-run]");
    let top: number;
    let bottom: number;
    if (sibling !== null) {
        const sr = sibling.getBoundingClientRect();
        top = sr.top - base.top;
        bottom = sr.bottom - base.top;
    } else {
        const midY = rowRect.top + rowRect.height / 2 - base.top;
        top = midY - 10;
        bottom = midY + 10;
    }
    const dates = runDates(rowKey, runKey);
    if (dates !== undefined) {
        const offLeft = scale.fracOf(dates.end) <= 0;
        const offRight = scale.fracOf(dates.start) >= 1;
        if (offLeft || offRight) {
            const x = (offLeft ? p.left : p.right) - base.left;
            return {
                leftX: x,
                rightX: x,
                top,
                bottom,
                off: { x: offLeft ? x : x - FADE_W, y: top, h: bottom - top, side: offLeft ? "left" : "right" },
            };
        }
    }
    return { leftX: rowRect.left - base.left, rightX: rowRect.right - base.left, top, bottom };
}

/** The links-focus ribbon overlay — mounts over the canvas body. */
export function LinksOverlay({ container, links, visibleKeys, scale, runDates }: LinksOverlayProps) {
    const uid = useId();
    const [ribbons, setRibbons] = useState<Ribbon[]>([]);
    const [bands, setBands] = useState<FadeBand[]>([]);
    const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

    const edges = useMemo(
        () => links.filter((l) => visibleKeys.has(l.fromRow) && visibleKeys.has(l.toRow)),
        [links, visibleKeys],
    );

    useEffect(() => {
        if (container === null || edges.length === 0) {
            setRibbons([]);
            setBands([]);
            return;
        }
        const measure = () => {
            const base = container.getBoundingClientRect();
            setSize({ w: base.width, h: base.height });
            const maxQty = edges.reduce((m, l) => Math.max(m, Math.abs(l.quantity)), 0);
            const outR: Ribbon[] = [];
            const outB: FadeBand[] = [];
            for (const l of edges) {
                const from = endpointFor(base, container, scale, runDates, l.fromRow, l.fromRun);
                const to = endpointFor(base, container, scale, runDates, l.toRow, l.toRun);
                if (from === null || to === null) continue;
                if (from.off !== undefined) outB.push(from.off);
                if (to.off !== undefined) outB.push(to.off);
                const opacity = maxQty > 0
                    ? OPACITY_MIN + (Math.abs(l.quantity) / maxQty) * (OPACITY_MAX - OPACITY_MIN)
                    : OPACITY_MIN;
                // Semantic routing (pure, offline-testable): the ribbon exits
                // the source run's END and enters the destination's BEGINNING
                // in every arrangement — `routeRibbon` picks metro-S vs
                // loopback from the interval geometry.
                outR.push({ ...routeRibbon(from, to), opacity, label: l.label });
            }
            // Greedy caption de-overlap — full-width bands sharing a source
            // edge can land their labels on one another; nudge later ones
            // down a line at a time until clear.
            const placed: { x: number; y: number }[] = [];
            for (const r of outR) {
                while (placed.some((p) => Math.abs(p.x - r.lx) < 60 && Math.abs(p.y - r.ly) < 12)) r.ly += 12;
                placed.push({ x: r.lx, y: r.ly });
            }
            setRibbons(outR);
            setBands(outB);
        };
        // First draw waits for the gather choreography to settle; scroll /
        // resize re-measure immediately (capture — scroll doesn't bubble).
        const timer = setTimeout(measure, SETTLE_MS);
        container.addEventListener("scroll", measure, true);
        window.addEventListener("resize", measure);
        return () => {
            clearTimeout(timer);
            container.removeEventListener("scroll", measure, true);
            window.removeEventListener("resize", measure);
        };
    }, [container, edges, scale, runDates]);

    if (ribbons.length === 0 && bands.length === 0) return null;
    return (
        <Box
            position="absolute"
            inset={0}
            zIndex={4}
            pointerEvents="none"
            data-plan-ribbons
            animation="plan-settle-in 0.22s ease-out"
        >
            <svg width={size.w} height={size.h} style={{ display: "block", overflow: "visible" }}>
                <defs>
                    {/* The off-window landing — strongest AT the window edge,
                        fading inward (the runoff grammar, reversed for an
                        arrival from beyond the window). */}
                    <linearGradient id={`${uid}-fade-right`} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0" stopColor={BRAND} stopOpacity={0} />
                        <stop offset="1" stopColor={BRAND} stopOpacity={0.3} />
                    </linearGradient>
                    <linearGradient id={`${uid}-fade-left`} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0" stopColor={BRAND} stopOpacity={0.3} />
                        <stop offset="1" stopColor={BRAND} stopOpacity={0} />
                    </linearGradient>
                </defs>
                {bands.map((b, i) => (
                    <rect key={`band-${i}`} data-plan-linkfade={b.side}
                        x={b.x} y={b.y} width={FADE_W} height={b.h}
                        fill={`url(#${uid}-fade-${b.side})`} />
                ))}
                {ribbons.map((r, i) => (
                    <g key={i}>
                        <g opacity={r.opacity}>
                            <path d={r.stroke} stroke={BRAND} strokeWidth={r.width} fill="none" />
                            <path d={r.head} fill={BRAND} stroke="none" />
                        </g>
                        {/* Paint-order halo keeps the caption legible over
                            bars and grid — dynamic SVG text, like the chart
                            marks. */}
                        <text
                            x={r.lx} y={r.ly} textAnchor={r.anchor}
                            style={{
                                font: "600 8.5px var(--chakra-fonts-mono)",
                                fill: "var(--chakra-colors-fg-muted)",
                                paintOrder: "stroke",
                                stroke: "var(--chakra-colors-bg-surface)",
                                strokeWidth: 3,
                            }}
                        >
                            {r.label}
                        </text>
                    </g>
                ))}
            </svg>
        </Box>
    );
}
