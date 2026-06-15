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
import { paintSchematic, type SchematicPalette } from "./paint";
import { SchematicPaletteProbe } from "./theme";

library.add(fas);

const schematicEqual = equalFor(Schematic.Types.Schematic);

/** East Schematic value type. */
export type SchematicValue = ValueTypeOf<typeof Schematic.Types.Schematic>;

/** East Schematic item value type. */
export type SchematicItemValue = ValueTypeOf<typeof Schematic.Types.Item>;

/** East Schematic zone value type. */
export type SchematicZoneValue = ValueTypeOf<typeof Schematic.Types.Zone>;

/** East Schematic shape-geometry value type (`rect` / `circle` / `polyline` / `polygon`). */
export type SchematicGeometryValue = ValueTypeOf<typeof Schematic.Types.Geometry>;

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

/** Even–odd point-in-polygon test in world coords (footprint hit-testing). */
function pointInPolygon(x: number, y: number, pts: readonly Pt[]): boolean {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i]!.x, yi = pts[i]!.y, xj = pts[j]!.x, yj = pts[j]!.y;
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

interface NavZone {
    zone: SchematicZoneValue;
    children: NavZone[];
    items: SchematicItemValue[];
}

/** Nest zones by smallest-containing-rect and place items into their
 * smallest containing zone — the drawing IS the hierarchy. Hatch zones
 * are annotations (walkways, exclusion strips), not containers: they
 * never host items. */
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
    const hosts = sorted.filter(z => z.pattern.type === "outline");
    const floor: SchematicItemValue[] = [];
    const zoneOf = new Map<string, string>();
    for (const item of items) {
        const host = hosts.find(z => contains(z, item.x, item.y));
        if (host !== undefined) {
            nodes.get(host.key)!.items.push(item);
            zoneOf.set(item.key, host.key);
        } else floor.push(item);
    }
    return { roots, floor, zoneOf, parentOf };
}

type LodTier = "card" | "label" | "dot";

/** Screen-px footprint of an item rendered at `tier`, centred on the
 * item. Translation-invariant, so collisions depend on ppu alone. */
function tierSize(item: SchematicItemValue, tier: LodTier, ppu: number): { w: number; h: number } {
    if (tier === "label") return { w: item.label.length * 6 + 28, h: 22 };
    const sublabel = item.sublabel.type === "some" ? item.sublabel.value : undefined;
    const explicit = item.width.type === "some" ? item.width.value * ppu : undefined;
    const w = explicit ?? Math.max(
        88,
        item.label.length * 6.6 + (item.icon.type === "some" ? 16 : 0) + (item.status.type === "some" ? 13 : 0) + 20,
        (sublabel?.length ?? 0) * 5.4 + 20,
    );
    const h = 24
        + (sublabel !== undefined ? 13 : 0)
        + (item.meter.type === "some" ? 8 : 0)
        + (item.metric.type === "some" ? 15 : 0);
    return { w, h };
}

/** Per-item semantic-zoom tier. The global ppu band picks the richest
 * candidate form; a symmetric nearest-neighbour test then demotes items
 * (card ⇢ labelled dot ⇢ dot). Symmetry is the point: an item only
 * keeps a form if it AND its neighbours would fit at that form, so a
 * uniformly dense row degrades as one block instead of checkerboarding
 * into random survivors, while isolated items keep full cards at the
 * same zoom. Neighbourhoods come from per-item R-tree queries. */
type CenterBox = { minX: number; minY: number; maxX: number; maxY: number; item: SchematicItemValue };

/** World-coordinate R-tree over item centres — built once per visible
 * set; zooming only changes the (1/ppu-scaled) query boxes. */
function buildCenterTree(items: readonly SchematicItemValue[]): RBush<CenterBox> {
    const tree = new RBush<CenterBox>();
    tree.load(items.map(item => ({ minX: item.x, minY: item.y, maxX: item.x, maxY: item.y, item })));
    return tree;
}

function declutterTiers(items: readonly SchematicItemValue[], tree: RBush<CenterBox>, baseLod: LodTier, ppu: number, selected: string | null): Map<string, LodTier> {
    const tiers = new Map<string, LodTier>();
    if (baseLod === "dot") {
        for (const item of items) tiers.set(item.key, "dot");
        return tiers;
    }
    const GAP = 6;
    let maxW = 0, maxH = 0;
    const sizes = new Map<string, { card: { w: number; h: number }; label: { w: number; h: number } }>();
    for (const item of items) {
        const card = tierSize(item, "card", ppu);
        const label = tierSize(item, "label", ppu);
        sizes.set(item.key, { card, label });
        maxW = Math.max(maxW, card.w);
        maxH = Math.max(maxH, card.h);
    }
    // Clear of every neighbour when self renders at `tier` and each
    // neighbour at its own already-decided tier (or `tier` while undecided).
    const clear = (item: SchematicItemValue, tier: "card" | "label"): boolean => {
        const self = sizes.get(item.key)![tier];
        const reachX = ((self.w + maxW) / 2 + GAP) / ppu, reachY = ((self.h + maxH) / 2 + GAP) / ppu;
        for (const hit of tree.search({ minX: item.x - reachX, minY: item.y - reachY, maxX: item.x + reachX, maxY: item.y + reachY })) {
            if (hit.item.key === item.key) continue;
            const neighbourTier = tiers.get(hit.item.key);
            if (neighbourTier === "dot") continue;
            const other = sizes.get(hit.item.key) ?? { card: tierSize(hit.item, "card", ppu), label: tierSize(hit.item, "label", ppu) };
            const otherSize = other[neighbourTier === "label" ? "label" : tier];
            if (Math.abs(hit.item.x - item.x) * ppu < (self.w + otherSize.w) / 2 + GAP
                && Math.abs(hit.item.y - item.y) * ppu < (self.h + otherSize.h) / 2 + GAP) return false;
        }
        return true;
    };
    if (baseLod === "card") {
        for (const item of items) if (clear(item, "card")) tiers.set(item.key, "card");
    }
    for (const item of items) {
        if (!tiers.has(item.key)) tiers.set(item.key, clear(item, "label") ? "label" : "dot");
    }
    // The selected item is an explicit pointer — it never demotes below
    // the zoom band's richest form.
    if (selected !== null && tiers.has(selected)) tiers.set(selected, baseLod);
    return tiers;
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
    const showGrid = getSomeorUndefined(value.grid) ?? true;
    const showNavigator = getSomeorUndefined(value.navigator) ?? value.zones.length > 0;
    const showMinimap = getSomeorUndefined(value.minimap) ?? value.items.length >= MINIMAP_AUTO;
    // A fixed height pins the panel instead of the extent's aspect ratio.
    const fixedHeight = getSomeorUndefined(value.height);

    const [selected, setSelected] = useState<string | null>(null);
    const [view, setView] = useState<Viewport>(IDENTITY);
    const [query, setQuery] = useState("");
    const [openZone, setOpenZone] = useState<string | null>(null);
    const [navCollapsed, setNavCollapsed] = useState(false);
    const [palette, setPalette] = useState<SchematicPalette | null>(null);
    const navTreeRef = useRef<HTMLDivElement | null>(null);

    const canvasRef = useRef<HTMLDivElement | null>(null);
    const drawRef = useRef<HTMLCanvasElement | null>(null);

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
            let minX = item.x - hw, minY = item.y - 2, maxX = item.x + hw, maxY = item.y + 2;
            // A footprint can reach past the marker box — union its world
            // bbox in so the shape isn't culled when the anchor leaves view.
            const fp = getSomeorUndefined(item.footprint);
            if (fp !== undefined && fp.type === "circle") {
                const r = fp.value.radius;
                minX = Math.min(minX, item.x - r); minY = Math.min(minY, item.y - r);
                maxX = Math.max(maxX, item.x + r); maxY = Math.max(maxY, item.y + r);
            } else if (fp !== undefined && fp.type !== "rect") {
                for (const v of fp.value.vertices) {
                    minX = Math.min(minX, v.x); minY = Math.min(minY, v.y);
                    maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y);
                }
            }
            return { minX, minY, maxX, maxY, item };
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

    // Duplicate zone labels are real (tank farms repeat a code) — the
    // navigator needs a unique handle per row, so repeats get an ordinal.
    const zoneDisplay = useMemo(() => {
        const counts = new Map<string, number>();
        const out = new Map<string, string>();
        for (const zone of value.zones) {
            const n = (counts.get(zone.label) ?? 0) + 1;
            counts.set(zone.label, n);
            out.set(zone.key, n > 1 ? `${zone.label} · ${n}` : zone.label);
        }
        return out;
    }, [value.zones]);

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

    // Drag-pan on empty canvas. `moved` distinguishes a pan from a click so
    // the canvas pick (below) doesn't fire on the click that follows a drag.
    const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
    const movedRef = useRef(false);
    const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        // Presses on controls / cards / the minimap are theirs — capturing
        // here would redirect their click to the canvas.
        if ((e.target as HTMLElement).closest("button") !== null) return;
        panRef.current = { x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
        movedRef.current = false;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }, []);
    const onCanvasPointerMove = useCallback((e: React.PointerEvent) => {
        const pan = panRef.current;
        if (!pan) return;
        if (Math.abs(e.clientX - pan.x) > 4 || Math.abs(e.clientY - pan.y) > 4) movedRef.current = true;
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
    // Hysteresis keeps it stable on score boundaries: the incumbent holds
    // until it clearly loses, a challenger must clearly win — otherwise a
    // view sitting on the threshold flaps the accordion every frame.
    const [currentZone, setCurrentZone] = useState<string | undefined>(undefined);
    useEffect(() => {
        const SPY_ENTER = 0.3, SPY_STAY = 0.18, SPY_MARGIN = 0.15;
        if (size === null || ppu === 0 || view.zoom <= 1.05) {
            setCurrentZone(undefined);
            return;
        }
        const vx0 = -view.tx / ppu, vy0 = -view.ty / ppu;
        const vx1 = (size.w - view.tx) / ppu, vy1 = (size.h - view.ty) / ppu;
        const viewArea = (vx1 - vx0) * (vy1 - vy0);
        const scoreOf = (z: SchematicZoneValue) => {
            const ix = Math.max(0, Math.min(vx1, z.x + z.width) - Math.max(vx0, z.x));
            const iy = Math.max(0, Math.min(vy1, z.y + z.height) - Math.max(vy0, z.y));
            return (ix * iy) / Math.min(viewArea, z.width * z.height);
        };
        let best: string | undefined;
        let bestScore = 0;
        for (const z of value.zones) {
            const score = scoreOf(z);
            if (score > bestScore) { best = z.key; bestScore = score; }
        }
        setCurrentZone(prev => {
            if (prev !== undefined) {
                const holder = value.zones.find(z => z.key === prev);
                const holderScore = holder !== undefined ? scoreOf(holder) : 0;
                if (holderScore >= SPY_STAY && (best === prev || bestScore < holderScore + SPY_MARGIN)) return prev;
            }
            return bestScore >= SPY_ENTER ? best : undefined;
        });
    }, [size, ppu, view, value.zones]);

    const lod: LodTier = ppu >= LOD_CARD_PPU ? "card" : ppu >= LOD_LABEL_PPU ? "label" : "dot";
    const centerTree = useMemo(() => buildCenterTree(visibleItems), [visibleItems]);
    const tiers = useMemo(() => declutterTiers(visibleItems, centerTree, lod, ppu, selected), [visibleItems, centerTree, lod, ppu, selected]);
    const lowerQuery = query.trim().toLowerCase();
    const searchHits = useMemo(() => lowerQuery === "" ? [] : value.items
        .filter(i => i.key.toLowerCase().includes(lowerQuery) || i.label.toLowerCase().includes(lowerQuery))
        .slice(0, 12), [lowerQuery, value.items]);

    const scaleLen = ppu > 0 ? niceScaleLength(ppu, 100) : 0;

    // Paint the bulk-shape layer (zones, links, footprints, dots/pins) to the
    // canvas whenever the data, camera, LOD, selection, or theme changes. Rich
    // item cards stay DOM (rendered below); the canvas is everything else.
    useEffect(() => {
        const canvas = drawRef.current;
        if (canvas === null || size === null || palette === null) return;
        const dpr = window.devicePixelRatio || 1;
        const bw = Math.round(size.w * dpr), bh = Math.round(size.h * dpr);
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
        const ctx = canvas.getContext("2d");
        if (ctx === null) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paintSchematic({
            ctx, value, cam: { ppu, tx: view.tx, ty: view.ty }, width: size.w, height: size.h,
            visibleItems, tiers, selected, centers, palette,
        });
    }, [value, view, ppu, size, visibleItems, tiers, selected, centers, palette]);

    // Canvas hit-testing: footprint polygons (close zoom) then the nearest
    // dot/pin marker; rich cards are DOM and handle their own clicks.
    const onCanvasClick = useCallback((e: React.MouseEvent) => {
        if (size === null || movedRef.current) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const wxp = (sx - view.tx) / ppu, wyp = (sy - view.ty) / ppu;
        for (const box of index.search({ minX: wxp, minY: wyp, maxX: wxp, maxY: wyp })) {
            const it = box.item;
            if ((tiers.get(it.key) ?? lod) !== "card") continue;
            const fp = getSomeorUndefined(it.footprint);
            if (fp === undefined || fp.type === "rect") continue;
            const hit = fp.type === "circle"
                ? Math.hypot(wxp - it.x, wyp - it.y) <= fp.value.radius
                : pointInPolygon(wxp, wyp, fp.value.vertices);
            if (hit) {
                setSelected(it.key);
                if (onSelectFn) queueMicrotask(() => onSelectFn(it.key));
                return;
            }
        }
        let best: SchematicItemValue | null = null, bestD = Infinity;
        for (const it of visibleItems) {
            const tier = tiers.get(it.key) ?? lod;
            if (tier === "card") continue;
            const d = Math.hypot(it.x * ppu + view.tx - sx, it.y * ppu + view.ty - sy);
            const reach = tier === "dot" ? 9 : 18;
            if (d < reach && d < bestD) { best = it; bestD = d; }
        }
        if (best !== null) flyToItem(best);
    }, [size, view, ppu, index, tiers, lod, visibleItems, onSelectFn, flyToItem]);

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
        const expandable = node.items.length > 0 || node.children.length > 0;
        return (
            <Box key={node.zone.key}>
                <Box
                    css={styles.navZone}
                    style={{ paddingLeft: `${8 + depth * 14}px` }}
                    {...(node.zone.key === currentZone ? { "data-current": "" } : {})}
                >
                    {expandable ? (
                        <Box
                            as="button"
                            css={styles.navCaret}
                            aria-label={open ? "Collapse zone" : "Expand zone"}
                            data-open={open ? "" : undefined}
                            onClick={() => toggleZone(node.zone.key)}
                        >
                            <FontAwesomeIcon icon={faCaretRight} />
                        </Box>
                    ) : (
                        <Box css={styles.navCaret} aria-hidden="true" style={{ visibility: "hidden" }}>
                            <FontAwesomeIcon icon={faCaretRight} />
                        </Box>
                    )}
                    <Box as="button" css={styles.navZoneLabel} onClick={() => flyToZone(node.zone)}>
                        {zoneDisplay.get(node.zone.key) ?? node.zone.label}
                    </Box>
                    {count > 0 && <Box as="span" css={styles.navCount}>{count}</Box>}
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
        <Box css={styles.root} {...(fixedHeight !== undefined ? { style: { height: fixedHeight, maxHeight: fixedHeight } } : {})}>
            <SchematicPaletteProbe onResolve={setPalette} />
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
                style={fixedHeight !== undefined ? { minHeight: 0 } : { aspectRatio: `${W} / ${H}` }}
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
                        <canvas
                            ref={drawRef}
                            onClick={onCanvasClick}
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                        />
                        {visibleItems.map(item => {
                            // Rich cards are DOM; dots / pins / footprints / zones /
                            // links are painted on the canvas above.
                            if ((tiers.get(item.key) ?? lod) !== "card") return null;
                            const tone = statusTone(item.status);
                            const isSelected = selected === item.key;
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
                        {scaleUnit !== undefined && scaleLen > 0 && (() => {
                            const len = scaleLen * ppu;
                            const quarter = (k: number, h: number) => `M ${(len * k) / 4} 6.5 V ${h}`;
                            return (
                                <Box css={styles.scaleBar}>
                                    <Box as="span" css={styles.scaleLabel}>{scaleLen} {scaleUnit}</Box>
                                    <Box
                                        as="svg"
                                        css={styles.scaleRuler}
                                        {...{ width: len, height: 7, viewBox: `0 0 ${len} 7` }}
                                    >
                                        <path
                                            d={`M 0.5 0 V 6.5 H ${len - 0.5} V 0 ${quarter(1, 3)} ${quarter(2, 1.5)} ${quarter(3, 3)}`}
                                            fill="none"
                                        />
                                    </Box>
                                </Box>
                            );
                        })()}
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
