/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { findIconDefinition, library } from "@fortawesome/fontawesome-svg-core";
import { fas, faAnglesLeft, faAnglesRight, faCaretRight, faChevronLeft, faChevronRight, faExpand, faMinus, faPlus } from "@fortawesome/free-solid-svg-icons";
import RBush from "rbush";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/east-ui/internal";
import type { IconName } from "@fortawesome/fontawesome-common-types";
import { getSomeorUndefined } from "../../utils";

library.add(fas);

const schematicEqual = equalFor(Schematic.Types.Schematic);

/** East Schematic value type. */
export type SchematicValue = ValueTypeOf<typeof Schematic.Types.Schematic>;

/** East Schematic item value type. */
export type SchematicItemValue = ValueTypeOf<typeof Schematic.Types.Item>;

/** East Schematic zone value type. */
export type SchematicZoneValue = ValueTypeOf<typeof Schematic.Types.Zone>;

export interface EastChakraSchematicProps {
    value: SchematicValue;
    storageKey: string;
}

type SlotStyles = Record<string, SystemStyleObject>;
type Pt = { x: number; y: number };
/** The pan/zoom state: screen = world × fit × zoom + t. */
type Viewport = { zoom: number; tx: number; ty: number };

const IDENTITY: Viewport = { zoom: 1, tx: 0, ty: 0 };
const MAX_ZOOM = 40;
/** LOD thresholds in px per world unit: card ⇢ labelled dot ⇢ dot. */
const LOD_CARD_PPU = 30;
const LOD_LABEL_PPU = 16;
/** Item-count threshold for the minimap default. */
const MINIMAP_AUTO = 25;

function statusTone(status: SchematicItemValue["status"]): string | undefined {
    return status.type === "some" ? status.value.type : undefined;
}

/** A round scale-bar length (1/2/5 × 10^k) rendering near `targetPx`. */
function niceScaleLength(ppu: number, targetPx: number): number {
    const target = targetPx / ppu;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    for (const m of [5, 2, 1]) {
        if (m * pow <= target) return m * pow;
    }
    return pow;
}

/** Expand anchors into an axis-aligned point list (one elbow per diagonal hop). */
function orthogonalize(points: Pt[]): Pt[] {
    const out: Pt[] = [];
    for (const next of points) {
        const prev = out[out.length - 1];
        if (prev !== undefined && prev.x !== next.x && prev.y !== next.y) {
            // Longer axis first keeps runs in the open instead of hugging rows.
            out.push(Math.abs(next.y - prev.y) >= Math.abs(next.x - prev.x)
                ? { x: prev.x, y: next.y }
                : { x: next.x, y: prev.y });
        }
        if (prev === undefined || prev.x !== next.x || prev.y !== next.y) out.push(next);
    }
    return out;
}

/** An SVG path through `pts` with corners rounded by up to `radius`. */
function roundedPath(pts: Pt[], radius: number): string {
    if (pts.length === 0) return "";
    let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i]!, a = pts[i - 1]!, b = pts[i + 1]!;
        const inLen = Math.hypot(p.x - a.x, p.y - a.y);
        const outLen = Math.hypot(b.x - p.x, b.y - p.y);
        const r = Math.min(radius, inLen / 2, outLen / 2);
        if (r < 0.5) { d += ` L ${p.x} ${p.y}`; continue; }
        const inU = { x: (p.x - a.x) / inLen, y: (p.y - a.y) / inLen };
        const outU = { x: (b.x - p.x) / outLen, y: (b.y - p.y) / outLen };
        d += ` L ${p.x - inU.x * r} ${p.y - inU.y * r}`;
        d += ` Q ${p.x} ${p.y} ${p.x + outU.x * r} ${p.y + outU.y * r}`;
    }
    const last = pts[pts.length - 1]!;
    if (pts.length > 1) d += ` L ${last.x} ${last.y}`;
    return d;
}

interface NavZone {
    zone: SchematicZoneValue;
    children: NavZone[];
    items: SchematicItemValue[];
}

/** Nest zones by smallest-containing-rect and place items into their
 * smallest containing zone — the drawing IS the hierarchy. */
function buildNavTree(zones: readonly SchematicZoneValue[], items: readonly SchematicItemValue[]): { roots: NavZone[]; floor: SchematicItemValue[]; zoneOf: Map<string, string>; parentOf: Map<string, string> } {
    const nodes = new Map<string, NavZone>();
    const sorted = [...zones].sort((a, b) => (a.width * a.height) - (b.width * b.height));
    const contains = (outer: SchematicZoneValue, x: number, y: number) =>
        x >= outer.x && x <= outer.x + outer.width && y >= outer.y && y <= outer.y + outer.height;
    for (const zone of zones) nodes.set(zone.key, { zone, children: [], items: [] });

    const roots: NavZone[] = [];
    const parentOf = new Map<string, string>();
    for (const zone of zones) {
        const parent = sorted.find(p => p.key !== zone.key
            && p.width * p.height > zone.width * zone.height
            && contains(p, zone.x + zone.width / 2, zone.y + zone.height / 2));
        if (parent !== undefined) {
            nodes.get(parent.key)!.children.push(nodes.get(zone.key)!);
            parentOf.set(zone.key, parent.key);
        } else roots.push(nodes.get(zone.key)!);
    }
    const floor: SchematicItemValue[] = [];
    const zoneOf = new Map<string, string>();
    for (const item of items) {
        const host = sorted.find(z => contains(z, item.x, item.y));
        if (host !== undefined) {
            nodes.get(host.key)!.items.push(item);
            zoneOf.set(item.key, host.key);
        } else floor.push(item);
    }
    return { roots, floor, zoneOf, parentOf };
}

interface ItemBox { minX: number; minY: number; maxX: number; maxY: number; item: SchematicItemValue }

/**
 * Renders an East UI Schematic value — the 2D world-coordinate canvas with
 * map-grade navigation: wheel-zoom about the cursor, drag-pan, animated
 * fly-to, semantic zoom (status dots ⇢ labelled dots ⇢ full cards), rbush
 * viewport culling, an adaptive scale bar, a zones→items navigator with
 * search and viewport spy, and a minimap with a draggable viewport.
 */
export const EastChakraSchematic = memo(function EastChakraSchematic({ value }: EastChakraSchematicProps) {
    const styles = useSlotRecipe({ key: "schematic" })() as SlotStyles;
    const { width: W, height: H } = value.extent;

    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const scaleUnit = getSomeorUndefined(value.scaleUnit);
    const showGrid = getSomeorUndefined(value.grid) ?? false;
    const showNavigator = getSomeorUndefined(value.navigator) ?? value.zones.length > 0;
    const showMinimap = getSomeorUndefined(value.minimap) ?? value.items.length >= MINIMAP_AUTO;

    const [selected, setSelected] = useState<string | null>(null);
    const [view, setView] = useState<Viewport>(IDENTITY);
    const [query, setQuery] = useState("");
    const [openZone, setOpenZone] = useState<string | null>(null);
    const [navCollapsed, setNavCollapsed] = useState(false);
    const navTreeRef = useRef<HTMLDivElement | null>(null);

    const canvasRef = useRef<HTMLDivElement | null>(null);

    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    useLayoutEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const fit = size !== null ? Math.min(size.w / W, size.h / H) : 0;
    const ppu = fit * view.zoom;
    const wx = (x: number) => x * ppu + view.tx;
    const wy = (y: number) => y * ppu + view.ty;

    const centers = useMemo(() => {
        const out = new Map<string, Pt>();
        for (const item of value.items) out.set(item.key, { x: item.x, y: item.y });
        return out;
    }, [value.items]);

    // Spatial index for viewport culling (item half-extent ~2.4 world units
    // covers the widest constant-size marker at the card threshold).
    const index = useMemo(() => {
        const tree = new RBush<ItemBox>();
        tree.load(value.items.map(item => {
            const hw = (getSomeorUndefined(item.width) ?? 0) / 2 + 2.4;
            return { minX: item.x - hw, minY: item.y - 2, maxX: item.x + hw, maxY: item.y + 2, item };
        }));
        return tree;
    }, [value.items]);

    const visibleItems = useMemo(() => {
        if (size === null || ppu === 0) return [];
        return index.search({
            minX: -view.tx / ppu, minY: -view.ty / ppu,
            maxX: (size.w - view.tx) / ppu, maxY: (size.h - view.ty) / ppu,
        }).map(b => b.item);
    }, [index, size, ppu, view]);

    const nav = useMemo(() => buildNavTree(value.zones, value.items), [value.zones, value.items]);

    // Selection stepping order: zones alphabetical (natural-numeric), each
    // zone's items alphabetical within it, nested zones after their
    // parent's own items, floor items last. Computed once per data change;
    // the key→index map makes each step O(1).
    const itemOrder = useMemo(() => {
        const byLabel = (a: { label: string }, b: { label: string }) =>
            a.label.localeCompare(b.label, undefined, { numeric: true });
        const ordered: SchematicItemValue[] = [];
        const walk = (nodes: NavZone[]) => {
            for (const node of [...nodes].sort((a, b) => byLabel(a.zone, b.zone))) {
                ordered.push(...[...node.items].sort(byLabel));
                walk(node.children);
            }
        };
        walk(nav.roots);
        ordered.push(...[...nav.floor].sort(byLabel));
        const indexOf = new Map(ordered.map((item, i) => [item.key, i]));
        return { ordered, indexOf };
    }, [nav]);

    // Animated fly-to: frame a world rect with padding.
    const animRef = useRef<number | null>(null);
    const viewRef = useRef(view);
    viewRef.current = view;
    const flyTo = useCallback((rect: { x: number; y: number; w: number; h: number }) => {
        if (size === null || fit === 0) return;
        const pad = 1.18;
        const zoom = Math.min(MAX_ZOOM, Math.min(size.w / (rect.w * pad * fit), size.h / (rect.h * pad * fit)));
        const target = {
            zoom,
            tx: size.w / 2 - (rect.x + rect.w / 2) * fit * zoom,
            ty: size.h / 2 - (rect.y + rect.h / 2) * fit * zoom,
        };
        const from = viewRef.current;
        const start = performance.now();
        if (animRef.current !== null) cancelAnimationFrame(animRef.current);
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / 350);
            const e = 1 - Math.pow(1 - t, 3);
            setView({
                zoom: from.zoom + (target.zoom - from.zoom) * e,
                tx: from.tx + (target.tx - from.tx) * e,
                ty: from.ty + (target.ty - from.ty) * e,
            });
            if (t < 1) animRef.current = requestAnimationFrame(step);
        };
        animRef.current = requestAnimationFrame(step);
    }, [size, fit]);
    useEffect(() => () => { if (animRef.current !== null) cancelAnimationFrame(animRef.current); }, []);

    const flyToItem = useCallback((item: SchematicItemValue) => {
        flyTo({ x: item.x - 4, y: item.y - 3, w: 8, h: 6 });
        setSelected(item.key);
        // Open the item's zone immediately rather than waiting for the
        // viewport spy to catch up after the fly animation.
        setOpenZone(nav.zoneOf.get(item.key) ?? null);
        if (onSelectFn) queueMicrotask(() => onSelectFn(item.key));
    }, [flyTo, nav.zoneOf, onSelectFn]);
    const stepSelection = useCallback((delta: number) => {
        const { ordered, indexOf } = itemOrder;
        if (ordered.length === 0) return;
        const idx = selected !== null ? (indexOf.get(selected) ?? -1) : -1;
        flyToItem(ordered[(idx + delta + ordered.length) % ordered.length]!);
    }, [itemOrder, selected, flyToItem]);

    const flyToZone = useCallback((zone: SchematicZoneValue) => {
        flyTo({ x: zone.x, y: zone.y, w: zone.width, h: zone.height });
        setOpenZone(zone.key);
    }, [flyTo]);

    // Wheel zooms about the cursor (no modifier — a dedicated canvas owns
    // the wheel, like any map); attached non-passively so preventDefault
    // stops the page scrolling.
    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const px = e.clientX - rect.left, py = e.clientY - rect.top;
            setView(prev => {
                const zoom = Math.max(1, Math.min(MAX_ZOOM, prev.zoom * Math.exp(-e.deltaY * 0.0015)));
                const k = zoom / prev.zoom;
                const next = { zoom, tx: px - k * (px - prev.tx), ty: py - k * (py - prev.ty) };
                return zoom === 1 ? IDENTITY : next;
            });
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    // Drag-pan on empty canvas.
    const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
    const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        // Presses on controls / cards / the minimap are theirs — capturing
        // here would redirect their click to the canvas.
        if ((e.target as HTMLElement).closest("button") !== null) return;
        panRef.current = { x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }, []);
    const onCanvasPointerMove = useCallback((e: React.PointerEvent) => {
        const pan = panRef.current;
        if (!pan) return;
        setView(prev => ({ ...prev, tx: pan.tx + e.clientX - pan.x, ty: pan.ty + e.clientY - pan.y }));
    }, []);
    const onCanvasPointerUp = useCallback(() => { panRef.current = null; }, []);
    const resetView = useCallback(() => setView(IDENTITY), []);

    const zoomBy = useCallback((factor: number) => {
        if (size === null) return;
        const px = size.w / 2, py = size.h / 2;
        setView(prev => {
            const zoom = Math.max(1, Math.min(MAX_ZOOM, prev.zoom * factor));
            const k = zoom / prev.zoom;
            return zoom === 1 ? IDENTITY : { zoom, tx: px - k * (px - prev.tx), ty: py - k * (py - prev.ty) };
        });
    }, [size]);

    // Viewport spy: the zone dominating the view — scored by how much of
    // the smaller of (zone, viewport) the overlap covers, so it tracks both
    // "zoomed into a corner of a big hall" and "hall fills the view".
    const currentZone = useMemo(() => {
        if (size === null || ppu === 0) return undefined;
        const vx0 = -view.tx / ppu, vy0 = -view.ty / ppu;
        const vx1 = (size.w - view.tx) / ppu, vy1 = (size.h - view.ty) / ppu;
        const viewArea = (vx1 - vx0) * (vy1 - vy0);
        let best: string | undefined;
        let bestScore = 0.25;
        for (const z of value.zones) {
            const ix = Math.max(0, Math.min(vx1, z.x + z.width) - Math.max(vx0, z.x));
            const iy = Math.max(0, Math.min(vy1, z.y + z.height) - Math.max(vy0, z.y));
            const score = (ix * iy) / Math.min(viewArea, z.width * z.height);
            if (score > bestScore) { best = z.key; bestScore = score; }
        }
        // At full fit every zone scores 1 — only spy once actually zoomed in.
        return view.zoom > 1.05 ? best : undefined;
    }, [size, ppu, view, value.zones]);

    const lod = ppu >= LOD_CARD_PPU ? "card" : ppu >= LOD_LABEL_PPU ? "label" : "dot";
    const lowerQuery = query.trim().toLowerCase();
    const searchHits = useMemo(() => lowerQuery === "" ? [] : value.items
        .filter(i => i.key.toLowerCase().includes(lowerQuery) || i.label.toLowerCase().includes(lowerQuery))
        .slice(0, 12), [lowerQuery, value.items]);

    const scaleLen = ppu > 0 ? niceScaleLength(ppu, 100) : 0;

    // Accordion: one open zone; its ancestors stay open so the path is visible.
    const toggleZone = useCallback((key: string) => {
        setOpenZone(prev => prev === key ? (nav.parentOf.get(key) ?? null) : key);
    }, [nav.parentOf]);
    // The spy hands the viewport's dominant zone to the SAME accordion
    // state manual interaction uses — one open chain, never two.
    useEffect(() => {
        if (currentZone !== undefined) setOpenZone(currentZone);
    }, [currentZone]);

    const openPath = useMemo(() => {
        const path = new Set<string>();
        let cursor = openZone ?? undefined;
        while (cursor !== undefined) {
            path.add(cursor);
            cursor = nav.parentOf.get(cursor);
        }
        return path;
    }, [openZone, nav.parentOf]);

    useEffect(() => {
        if (selected === null) return;
        navTreeRef.current
            ?.querySelector(`[data-nav-key="${CSS.escape(selected)}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [selected, openPath]);

    const renderNavZone = (node: NavZone, depth: number): React.ReactNode => {
        const open = openPath.has(node.zone.key);
        const count = node.items.length + node.children.reduce((n, c) => n + c.items.length, 0);
        return (
            <Box key={node.zone.key}>
                <Box
                    css={styles.navZone}
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                    {...(node.zone.key === currentZone ? { "data-current": "" } : {})}
                >
                    <Box
                        as="button"
                        css={styles.navCaret}
                        aria-label={open ? "Collapse zone" : "Expand zone"}
                        data-open={open ? "" : undefined}
                        onClick={() => toggleZone(node.zone.key)}
                    >
                        <FontAwesomeIcon icon={faCaretRight} />
                    </Box>
                    <Box as="button" css={styles.navZoneLabel} onClick={() => flyToZone(node.zone)}>
                        {node.zone.label}
                    </Box>
                    <Box as="span" css={styles.navCount}>{count}</Box>
                </Box>
                {open && node.children.map(child => renderNavZone(child, depth + 1))}
                {open && node.items.map(item => (
                    <Box
                        key={item.key}
                        as="button"
                        css={styles.navItem}
                        data-nav-key={item.key}
                        style={{ paddingLeft: `${30 + depth * 14}px` }}
                        {...(selected === item.key ? { "data-selected": "" } : {})}
                        onClick={() => flyToItem(item)}
                    >
                        <Box as="span" css={styles.statusDot} data-tone={statusTone(item.status) ?? "neutral"} />
                        {item.label}
                        {item.metric.type === "some" && <Box as="span" css={styles.navMetric}>{item.metric.value}</Box>}
                    </Box>
                ))}
            </Box>
        );
    };

    return (
        <Box css={styles.root}>
            {showNavigator && navCollapsed && (
                <Box css={styles.navCollapsed}>
                    <Box as="button" css={styles.navToggle} aria-label="Expand index" title="Show index" onClick={() => setNavCollapsed(false)}><FontAwesomeIcon icon={faAnglesRight} /></Box>
                </Box>
            )}
            {showNavigator && !navCollapsed && (
                <Box css={styles.nav}>
                    <Box css={styles.navHeader}>
                        <Box as="span" css={styles.navTitle}>Index</Box>
                        <Box as="button" css={styles.navToggle} aria-label="Collapse index" title="Hide index" onClick={() => setNavCollapsed(true)}><FontAwesomeIcon icon={faAnglesLeft} /></Box>
                    </Box>
                    <Box
                        as="input"
                        css={styles.navSearch}
                        {...{
                            placeholder: "Find…",
                            value: query,
                            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
                            onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.key === "Enter" && searchHits[0] !== undefined) {
                                    flyToItem(searchHits[0]);
                                    setQuery("");
                                }
                            },
                        }}
                    />
                    <Box ref={navTreeRef} css={styles.navTree}>
                        {lowerQuery !== ""
                            ? searchHits.map(item => (
                                <Box key={item.key} as="button" css={styles.navItem} style={{ paddingLeft: "8px" }} onClick={() => { flyToItem(item); setQuery(""); }}>
                                    <Box as="span" css={styles.statusDot} data-tone={statusTone(item.status) ?? "neutral"} />
                                    {item.label}
                                </Box>
                            ))
                            : (
                                <>
                                    {nav.roots.map(node => renderNavZone(node, 0))}
                                    {nav.floor.map(item => (
                                        <Box key={item.key} as="button" css={styles.navItem} data-nav-key={item.key} style={{ paddingLeft: "8px" }} onClick={() => flyToItem(item)}>
                                            <Box as="span" css={styles.statusDot} data-tone={statusTone(item.status) ?? "neutral"} />
                                            {item.label}
                                        </Box>
                                    ))}
                                </>
                            )}
                    </Box>
                </Box>
            )}
            <Box
                ref={canvasRef}
                css={styles.canvas}
                data-schematic-canvas=""
                style={{ aspectRatio: `${W} / ${H}` }}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onDoubleClick={resetView}
            >
                {showGrid && size !== null && scaleLen > 0 && (() => {
                    const major = scaleLen * ppu;
                    const minor = major / 5;
                    return (
                        <Box
                            css={styles.grid}
                            style={{
                                backgroundSize: `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`,
                                backgroundPosition: `${view.tx}px 0, 0 ${view.ty}px, ${view.tx}px 0, 0 ${view.ty}px`,
                            }}
                        />
                    );
                })()}
                {size !== null && (
                    <>
                        {value.zones.map(zone => {
                            const pattern = zone.pattern;
                            const tone = (pattern.value.tone.type === "some" ? pattern.value.tone.value.type : undefined) ?? "muted";
                            const hatchVars = pattern.type === "hatch" ? {
                                "--hatch-spacing": `${pattern.value.spacing.type === "some" ? pattern.value.spacing.value : 8}px`,
                                "--hatch-angle": `${pattern.value.angle.type === "some" ? pattern.value.angle.value : 45}deg`,
                            } : {};
                            return (
                                <Box
                                    key={zone.key}
                                    css={styles.zone}
                                    data-pattern={pattern.type}
                                    data-tone={tone}
                                    style={{
                                        left: wx(zone.x), top: wy(zone.y),
                                        width: zone.width * ppu, height: zone.height * ppu,
                                        ...hatchVars,
                                    }}
                                >
                                    <Box as="span" css={styles.zoneLabel} data-pattern={pattern.type}>{zone.label}</Box>
                                </Box>
                            );
                        })}
                        <Box as="svg" css={styles.underlay} {...{ viewBox: `0 0 ${size.w} ${size.h}`, width: size.w, height: size.h }}>
                            {value.links.map(link => {
                                const from = centers.get(link.from);
                                const to = centers.get(link.to);
                                if (!from || !to) return null;
                                const anchors = [from, ...link.via, to].map(p => ({ x: wx(p.x), y: wy(p.y) }));
                                const corner = link.route.type === "orthogonal"
                                    ? (link.route.value.corner.type === "some" ? link.route.value.corner.value : 8)
                                    : 0;
                                const pts = link.route.type === "orthogonal" ? orthogonalize(anchors) : anchors;
                                const style = link.style;
                                const tone = (style.value.tone.type === "some" ? style.value.tone.value.type : undefined)
                                    ?? (style.type === "solid" ? "brand" : "muted");
                                const weight = style.value.weight.type === "some"
                                    ? style.value.weight.value
                                    : (style.type === "solid" ? 2.5 : 1.5);
                                return (
                                    <g key={link.key} data-tone={tone}>
                                        <path
                                            d={roundedPath(pts, corner)}
                                            fill="none"
                                            data-style={style.type}
                                            strokeWidth={weight}
                                            {...(style.type === "dashed" ? { strokeDasharray: "6 5" } : {})}
                                        />
                                        <circle cx={anchors[0]!.x} cy={anchors[0]!.y} r={weight + 1.5} />
                                        <circle cx={anchors[anchors.length - 1]!.x} cy={anchors[anchors.length - 1]!.y} r={weight + 1.5} />
                                    </g>
                                );
                            })}
                        </Box>
                        {visibleItems.map(item => {
                            const tone = statusTone(item.status);
                            const isSelected = selected === item.key;
                            if (lod === "dot") {
                                return (
                                    <Box
                                        key={item.key}
                                        css={styles.itemDot}
                                        data-tone={tone ?? "neutral"}
                                        {...(isSelected ? { "data-selected": "" } : {})}
                                        style={{ left: wx(item.x), top: wy(item.y) }}
                                        onClick={() => flyToItem(item)}
                                    />
                                );
                            }
                            if (lod === "label") {
                                return (
                                    <Box
                                        key={item.key}
                                        css={styles.itemPin}
                                        {...(isSelected ? { "data-selected": "" } : {})}
                                        style={{ left: wx(item.x), top: wy(item.y) }}
                                        onClick={() => flyToItem(item)}
                                    >
                                        <Box as="span" css={styles.statusDot} data-tone={tone ?? "neutral"} />
                                        {item.label}
                                    </Box>
                                );
                            }
                            const sublabel = getSomeorUndefined(item.sublabel);
                            const icon = getSomeorUndefined(item.icon);
                            const meter = getSomeorUndefined(item.meter);
                            const metric = getSomeorUndefined(item.metric);
                            const width = getSomeorUndefined(item.width);
                            const iconDef = icon !== undefined
                                ? findIconDefinition({ prefix: "fas", iconName: icon as IconName })
                                : undefined;
                            return (
                                <Box
                                    key={item.key}
                                    css={styles.item}
                                    {...(isSelected ? { "data-selected": "" } : {})}
                                    style={{
                                        left: wx(item.x), top: wy(item.y),
                                        ...(typeof width === "number" ? { width: width * ppu } : {}),
                                    }}
                                    onClick={() => { setSelected(item.key); if (onSelectFn) queueMicrotask(() => onSelectFn(item.key)); }}
                                    onPointerDown={e => e.stopPropagation()}
                                >
                                    <Box css={styles.itemHead}>
                                        {iconDef !== undefined && (
                                            <Box as="span" css={styles.itemIcon}><FontAwesomeIcon icon={iconDef} /></Box>
                                        )}
                                        <Box as="span" css={styles.itemLabel}>{item.label}</Box>
                                        {tone !== undefined && <Box as="span" css={styles.statusDot} data-tone={tone} />}
                                    </Box>
                                    {sublabel !== undefined && <Box css={styles.itemSublabel}>{sublabel}</Box>}
                                    {meter !== undefined && (
                                        <Box css={styles.meterTrack}>
                                            <Box css={styles.meterFill} style={{ width: `${meter.max > 0 ? Math.min(100, (meter.value / meter.max) * 100) : 0}%` }} />
                                        </Box>
                                    )}
                                    {metric !== undefined && <Box css={styles.itemMetric}>{metric}</Box>}
                                </Box>
                            );
                        })}
                        <Box css={styles.controls}>
                            <Box as="button" css={styles.controlButton} aria-label="Zoom in" title="Zoom in (scroll)" onClick={() => zoomBy(1.5)}><FontAwesomeIcon icon={faPlus} /></Box>
                            <Box as="button" css={styles.controlButton} aria-label="Zoom out" title="Zoom out (scroll)" onClick={() => zoomBy(1 / 1.5)}><FontAwesomeIcon icon={faMinus} /></Box>
                            <Box as="button" css={styles.controlButton} aria-label="Fit view" title="Fit view (double-click)" onClick={resetView}><FontAwesomeIcon icon={faExpand} /></Box>
                            {selected !== null && (
                                <>
                                    <Box as="button" css={styles.controlButton} aria-label="Previous item" title="Previous item" onClick={() => stepSelection(-1)}><FontAwesomeIcon icon={faChevronLeft} /></Box>
                                    <Box as="button" css={styles.controlButton} aria-label="Next item" title="Next item" onClick={() => stepSelection(1)}><FontAwesomeIcon icon={faChevronRight} /></Box>
                                </>
                            )}
                        </Box>
                        {scaleUnit !== undefined && scaleLen > 0 && (
                            <Box css={styles.scaleBar}>
                                <Box
                                    as="svg"
                                    css={styles.scaleRuler}
                                    {...{ width: scaleLen * ppu, height: 9, viewBox: `0 0 ${scaleLen * ppu} 9` }}
                                >
                                    <path
                                        d={`M 0.5 0 V 8.5 H ${scaleLen * ppu - 0.5} V 0 M ${(scaleLen * ppu) / 2} 8.5 V 4`}
                                        fill="none"
                                    />
                                </Box>
                                <Box as="span" css={styles.scaleLabel}>{scaleLen} {scaleUnit}</Box>
                            </Box>
                        )}
                        {showMinimap && (
                            <Box
                                css={styles.minimap}
                                title="Jump to a location"
                                style={{ width: 150, height: (150 * H) / W }}
                                onPointerDown={e => {
                                    e.stopPropagation();
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    const cx = ((e.clientX - rect.left) / rect.width) * W;
                                    const cy = ((e.clientY - rect.top) / rect.height) * H;
                                    if (size !== null) {
                                        setView(prev => ({
                                            ...prev,
                                            tx: size.w / 2 - cx * fit * prev.zoom,
                                            ty: size.h / 2 - cy * fit * prev.zoom,
                                        }));
                                    }
                                }}
                            >
                                {value.zones.map(zone => (
                                    <Box
                                        key={zone.key}
                                        css={styles.minimapZone}
                                        style={{
                                            left: `${(zone.x / W) * 100}%`, top: `${(zone.y / H) * 100}%`,
                                            width: `${(zone.width / W) * 100}%`, height: `${(zone.height / H) * 100}%`,
                                        }}
                                    />
                                ))}
                                {size !== null && (
                                    <Box
                                        css={styles.minimapViewport}
                                        style={{
                                            left: `${Math.max(0, (-view.tx / ppu / W) * 100)}%`,
                                            top: `${Math.max(0, (-view.ty / ppu / H) * 100)}%`,
                                            width: `${Math.min(100, (size.w / ppu / W) * 100)}%`,
                                            height: `${Math.min(100, (size.h / ppu / H) * 100)}%`,
                                        }}
                                    />
                                )}
                            </Box>
                        )}
                    </>
                )}
            </Box>
        </Box>
    );
}, (prev, next) => schematicEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
