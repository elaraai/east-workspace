/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { findIconDefinition, library } from "@fortawesome/fontawesome-svg-core";
import { fas, faAnglesLeft, faAnglesRight, faCaretRight, faChevronLeft, faChevronRight, faExpand, faHand, faMinus, faObjectGroup, faPlus } from "@fortawesome/free-solid-svg-icons";
import RBush from "rbush";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Schematic, Slice as SliceInternal } from "@elaraai/east-ui/internal";
import type { IconName } from "@fortawesome/fontawesome-common-types";
import { getSomeorUndefined } from "../../utils";
import { SliceRailCluster } from "../../slice/rail";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import { usePersistedState } from "../../hooks/usePersistedState";
import { MARKER_LABEL_FONT, markerHit, markerHitbox, paintSchematic, type SchematicPalette } from "./paint";
import {
    type CameraEvent, type CameraMode, type RafCoalescer, type Viewport,
    IDENTITY, cancelsFly, cardTranslateCss, cardWidthCss, makeRafCoalescer, nextMode, zoomAbout,
} from "./camera";
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
export const EastChakraSchematic = memo(function EastChakraSchematic({ value, storageKey }: EastChakraSchematicProps) {
    const styles = useSlotRecipe({ key: "schematic" })() as SlotStyles;
    const { width: W, height: H } = value.extent;

    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    const scaleUnit = getSomeorUndefined(value.scaleUnit);
    const showGrid = getSomeorUndefined(value.grid) ?? true;
    const showNavigator = getSomeorUndefined(value.navigator) ?? value.zones.length > 0;
    const showMinimap = getSomeorUndefined(value.minimap) ?? value.items.length >= MINIMAP_AUTO;
    // Optional Slice chrome — a full-width top-edge rail (replaces the built-in
    // navigator search; #128). The narrowing itself is fed upstream via
    // `Slice.rows` into `items`, the same "chrome only" model Table/Chart use.
    const sliceChrome = getSomeorUndefined(value.slice) as
        { slice: unknown; affordances: ReadonlyArray<{ type: string }> } | undefined;
    const sliceHandle = sliceChrome?.slice as ValueTypeOf<typeof SliceInternal.Types.Bind> | undefined;
    useSliceReactivity(sliceHandle?.key);
    const sliceFrameStyles = useSlotRecipe({ key: "sliceFrame" })();
    const hasSliceChrome = sliceChrome !== undefined && sliceHandle !== undefined;
    // A fixed height pins the panel instead of the extent's aspect ratio.
    const fixedHeight = getSomeorUndefined(value.height);

    const [selected, setSelected] = useState<string | null>(null);
    const [openZone, setOpenZone] = useState<string | null>(null);
    // Index-rail collapse is a durable layout preference — persist it under
    // `storageKey` (issue #57, P8). The camera and selection are transient
    // interaction state (per the renderer conventions) and stay ephemeral.
    const { state: persisted, setState: setPersisted } = usePersistedState(storageKey, { navCollapsed: false });
    const navCollapsed = persisted.navCollapsed;
    const setNavCollapsed = useCallback((next: boolean) => setPersisted(prev => ({ ...prev, navCollapsed: next })), [setPersisted]);
    const [palette, setPalette] = useState<SchematicPalette | null>(null);
    const navTreeRef = useRef<HTMLDivElement | null>(null);

    const canvasRef = useRef<HTMLDivElement | null>(null);
    const drawRef = useRef<HTMLCanvasElement | null>(null);
    const cardLayerRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<HTMLDivElement | null>(null);

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

    // Track devicePixelRatio so moving the window across monitors / changing OS
    // scale / browser zoom repaints the canvas at the correct backing-store
    // resolution instead of leaving it stale and blurry (issue #57, P5). One
    // live `matchMedia` listener, re-subscribed on each change.
    const [dpr, setDpr] = useState(() => (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1));
    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
        let cleanup = () => {};
        const subscribe = () => {
            const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            const onChange = () => { cleanup(); setDpr(window.devicePixelRatio || 1); subscribe(); };
            mql.addEventListener("change", onChange);
            cleanup = () => mql.removeEventListener("change", onChange);
        };
        subscribe();
        return () => cleanup();
    }, []);

    // The live camera lives in a ref, mutated synchronously by input handlers,
    // which then call `requestRender()` (coalesced to one rAF). React state
    // holds only a throttled snapshot for derived UI — minimap, viewport spy,
    // the LOD/culling recompute — never updated per pointer event (issue #57,
    // Phase 2 invariants 1–2).
    const cameraRef = useRef<Viewport>(IDENTITY);
    const modeRef = useRef<CameraMode>("idle");
    const animRef = useRef<number | null>(null);
    const [cameraSnapshot, setCameraSnapshot] = useState<Viewport>(IDENTITY);

    // Interaction tool (#153): `grab` drag-pans (default), `select` drags a box
    // that the view then flies into. Momentary keyboard overrides — hold Space
    // (grab) / Ctrl (select) while hovering — set `tempTool`; `effectiveTool` is
    // what the cursor + drag obey. The button highlight tracks the persistent tool.
    const [tool, setTool] = useState<"grab" | "select">("grab");
    const [tempTool, setTempTool] = useState<"grab" | "select" | null>(null);
    const effectiveTool = tempTool ?? tool;
    const effectiveToolRef = useRef(effectiveTool); effectiveToolRef.current = effectiveTool;
    const hoveredRef = useRef(false);
    // Live screen-space selection box (px, relative to the canvas host) while a
    // select-drag is in flight; drives the dashed overlay and the fly-to on release.
    const selStartRef = useRef<{ sx: number; sy: number } | null>(null);
    const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

    const fit = size !== null ? Math.min(size.w / W, size.h / H) : 0;
    const ppu = fit * cameraSnapshot.zoom;

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
            minX: -cameraSnapshot.tx / ppu, minY: -cameraSnapshot.ty / ppu,
            maxX: (size.w - cameraSnapshot.tx) / ppu, maxY: (size.h - cameraSnapshot.ty) / ppu,
        }).map(b => b.item);
    }, [index, size, ppu, cameraSnapshot]);

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

    // Viewport spy: the zone dominating the view — scored by how much of
    // the smaller of (zone, viewport) the overlap covers, so it tracks both
    // "zoomed into a corner of a big hall" and "hall fills the view".
    // Hysteresis keeps it stable on score boundaries: the incumbent holds
    // until it clearly loses, a challenger must clearly win — otherwise a
    // view sitting on the threshold flaps the accordion every frame.
    const [currentZone, setCurrentZone] = useState<string | undefined>(undefined);
    useEffect(() => {
        const SPY_ENTER = 0.3, SPY_STAY = 0.18, SPY_MARGIN = 0.15;
        if (size === null || ppu === 0 || cameraSnapshot.zoom <= 1.05) {
            setCurrentZone(undefined);
            return;
        }
        const vx0 = -cameraSnapshot.tx / ppu, vy0 = -cameraSnapshot.ty / ppu;
        const vx1 = (size.w - cameraSnapshot.tx) / ppu, vy1 = (size.h - cameraSnapshot.ty) / ppu;
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
    }, [size, ppu, cameraSnapshot, value.zones]);

    const lod: LodTier = ppu >= LOD_CARD_PPU ? "card" : ppu >= LOD_LABEL_PPU ? "label" : "dot";
    const centerTree = useMemo(() => buildCenterTree(visibleItems), [visibleItems]);
    const tiers = useMemo(() => declutterTiers(visibleItems, centerTree, lod, ppu, selected), [visibleItems, centerTree, lod, ppu, selected]);

    const scaleLen = ppu > 0 ? niceScaleLength(ppu, 100) : 0;

    // --- Single synchronized camera apply (Phase 2). ------------------------
    // Mirror render-derived values into refs so `applyCamera` — a raw rAF
    // closure — can read the live size / palette / fit / LOD snapshot without
    // depending on React state (Phase 2 invariant 3).
    const valueRef = useRef(value); valueRef.current = value;
    const sizeRef = useRef(size); sizeRef.current = size;
    const fitRef = useRef(fit); fitRef.current = fit;
    const dprRef = useRef(dpr); dprRef.current = dpr;
    const paletteRef = useRef(palette); paletteRef.current = palette;
    const visibleItemsRef = useRef(visibleItems); visibleItemsRef.current = visibleItems;
    const tiersRef = useRef(tiers); tiersRef.current = tiers;
    const selectedRef = useRef(selected); selectedRef.current = selected;
    const centersRef = useRef(centers); centersRef.current = centers;
    const openZoneRef = useRef(openZone); openZoneRef.current = openZone;

    // Skip an apply whose inputs are referentially identical to the last —
    // covers redundant idle re-renders / repeated requestRender with no change.
    // (During an active pan the layout-effect apply still repaints, because
    // visibleItems is rebuilt fresh each snapshot; that second paint is accepted
    // — bounded by viewport culling — and keeps canvas LOD lock-step with cards.)
    const lastPaintRef = useRef<{
        zoom: number; tx: number; ty: number; vis: unknown; tiers: unknown;
        sel: string | null; pal: SchematicPalette | null; w: number; h: number; dpr: number; val: unknown;
    } | null>(null);

    // Apply the LIVE camera to ALL surfaces in one step: card-layer CSS vars +
    // grid first (cheap, palette-independent), then the canvas paint (issue
    // #57, Phase 2 invariant 1). Positions therefore never desync — every
    // surface reads the same `cameraRef` (P1).
    const applyCamera = useCallback(() => {
        const sz = sizeRef.current;
        if (sz === null) return;
        const cam = cameraRef.current;
        const ppuLive = fitRef.current * cam.zoom;
        const dprLive = dprRef.current;

        // DOM card layer: move every card with three custom-property writes on
        // the parent (compositor only — no per-card layout) — invariant 6.
        const layer = cardLayerRef.current;
        if (layer !== null) {
            layer.style.setProperty("--cam-ppu", String(ppuLive));
            layer.style.setProperty("--cam-tx", `${cam.tx}px`);
            layer.style.setProperty("--cam-ty", `${cam.ty}px`);
        }
        // Background grid: position locked to the same camera as the canvas.
        const grid = gridRef.current;
        if (grid !== null) {
            const len = ppuLive > 0 ? niceScaleLength(ppuLive, 100) : 0;
            if (len > 0) {
                const major = len * ppuLive, minor = major / 5;
                grid.style.backgroundSize = `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`;
                grid.style.backgroundPosition = `${cam.tx}px 0, 0 ${cam.ty}px, ${cam.tx}px 0, 0 ${cam.ty}px`;
            }
        }

        const canvas = drawRef.current, pal = paletteRef.current;
        if (canvas === null || pal === null) return;
        const last = lastPaintRef.current;
        if (last !== null
            && last.zoom === cam.zoom && last.tx === cam.tx && last.ty === cam.ty
            && last.vis === visibleItemsRef.current && last.tiers === tiersRef.current
            && last.sel === selectedRef.current && last.pal === pal
            && last.w === sz.w && last.h === sz.h && last.dpr === dprLive && last.val === valueRef.current) return;
        lastPaintRef.current = {
            zoom: cam.zoom, tx: cam.tx, ty: cam.ty, vis: visibleItemsRef.current, tiers: tiersRef.current,
            sel: selectedRef.current, pal, w: sz.w, h: sz.h, dpr: dprLive, val: valueRef.current,
        };
        const bw = Math.round(sz.w * dprLive), bh = Math.round(sz.h * dprLive);
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
        const ctx = canvas.getContext("2d");
        if (ctx === null) return;
        ctx.setTransform(dprLive, 0, 0, dprLive, 0, 0);
        paintSchematic({
            ctx, value: valueRef.current, cam: { ppu: ppuLive, tx: cam.tx, ty: cam.ty },
            width: sz.w, height: sz.h,
            visibleItems: visibleItemsRef.current, tiers: tiersRef.current,
            selected: selectedRef.current, centers: centersRef.current, palette: pal,
        });
    }, []);

    // Coalesce many camera mutations within a frame into one paint + one
    // throttled snapshot — keeps the hot pan path off React (invariant 2).
    const coalescerRef = useRef<RafCoalescer | null>(null);
    if (coalescerRef.current === null && typeof requestAnimationFrame !== "undefined") {
        coalescerRef.current = makeRafCoalescer(requestAnimationFrame, cancelAnimationFrame);
    }
    const requestRender = useCallback(() => {
        const run = () => {
            applyCamera();
            const cam = cameraRef.current;
            setCameraSnapshot(prev => (prev.zoom === cam.zoom && prev.tx === cam.tx && prev.ty === cam.ty)
                ? prev : { zoom: cam.zoom, tx: cam.tx, ty: cam.ty });
        };
        const cz = coalescerRef.current;
        if (cz !== null) cz.request(run); else run();
    }, [applyCamera]);

    // Interaction-mode machine: an input mode supersedes a running fly as a
    // transition, not a hand-added cancel at each call site (P4 / invariant 5).
    const cancelFlyRaf = useCallback(() => {
        if (animRef.current !== null) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    }, []);
    const transition = useCallback((event: CameraEvent) => {
        if (cancelsFly(modeRef.current, event)) cancelFlyRaf();
        modeRef.current = nextMode(modeRef.current, event);
    }, [cancelFlyRaf]);

    // Animated fly-to: frame a world rect with padding, writing the live camera
    // each frame (cancellable by any user input via the mode machine).
    const flyTo = useCallback((rect: { x: number; y: number; w: number; h: number }) => {
        if (sizeRef.current === null || fitRef.current === 0) return;
        const pad = 1.18;
        // Re-derive the destination from the LIVE viewport every frame, so a
        // resize mid-fly (nav-rail toggle, splitter drag, window resize) re-aims
        // the landing instead of framing against the stale start-time size/fit.
        const frame = (): Viewport | null => {
            const sz = sizeRef.current, ft = fitRef.current;
            if (sz === null || ft === 0) return null;
            const zoom = Math.min(MAX_ZOOM, Math.min(sz.w / (rect.w * pad * ft), sz.h / (rect.h * pad * ft)));
            return {
                zoom,
                tx: sz.w / 2 - (rect.x + rect.w / 2) * ft * zoom,
                ty: sz.h / 2 - (rect.y + rect.h / 2) * ft * zoom,
            };
        };
        const from = { ...cameraRef.current };
        const start = performance.now();
        if (animRef.current !== null) cancelAnimationFrame(animRef.current);
        transition("flyStart");
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / 350);
            const e = 1 - Math.pow(1 - t, 3);
            const target = frame();
            if (target !== null) {
                cameraRef.current = {
                    zoom: from.zoom + (target.zoom - from.zoom) * e,
                    tx: from.tx + (target.tx - from.tx) * e,
                    ty: from.ty + (target.ty - from.ty) * e,
                };
                applyCamera();
                const cam = cameraRef.current;
                setCameraSnapshot({ zoom: cam.zoom, tx: cam.tx, ty: cam.ty });
            }
            if (t < 1) { animRef.current = requestAnimationFrame(step); }
            else { animRef.current = null; transition("flyEnd"); }
        };
        animRef.current = requestAnimationFrame(step);
    }, [applyCamera, transition]);

    // A user gesture (collapse/fly) takes the accordion away from the viewport
    // spy until the viewport leaves that zone (issue #57, Phase 2 openZone fix).
    const zoneOverrideRef = useRef<string | null>(null);

    const flyToItem = useCallback((item: SchematicItemValue) => {
        flyTo({ x: item.x - 4, y: item.y - 3, w: 8, h: 6 });
        setSelected(item.key);
        // Open the item's zone immediately rather than waiting for the
        // viewport spy to catch up after the fly animation.
        zoneOverrideRef.current = null;
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
        zoneOverrideRef.current = null;
        setOpenZone(zone.key);
    }, [flyTo]);

    // Wheel zooms about the cursor (no modifier — a dedicated canvas owns the
    // wheel, like any map); attached non-passively so preventDefault stops the
    // page scrolling. Mutates the live camera, then requests one frame.
    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const px = e.clientX - rect.left, py = e.clientY - rect.top;
            transition("wheel");
            cameraRef.current = zoomAbout(cameraRef.current, Math.exp(-e.deltaY * 0.0015), px, py, 1, MAX_ZOOM);
            requestRender();
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [transition, requestRender]);

    // Drag-pan + tap-to-pick on the canvas. The pick runs on POINTERUP, not the
    // `click` event: onCanvasPointerDown captures the pointer for the drag, and
    // a captured pointer's click is delivered to the capturing box — not the
    // inner <canvas> — so a click handler there never fires for a marker /
    // footprint tap (issue #57, P11). `moved` distinguishes a pan from a tap.
    const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
    const movedRef = useRef(false);

    // Pick the item under a tap. Card-tier hits take precedence over markers
    // (rich cards / footprints are the primary affordance): (1) the footprint
    // shape's exact painted geometry, then (2) the real DOM card under the
    // pointer, then (3) the nearest dot/label marker against its FULL rendered
    // extent (P11). Reads the LIVE camera so a tap maps to what was painted
    // (invariant 4). Returns whether anything was selected.
    const pickAt = useCallback((host: HTMLElement, clientX: number, clientY: number): boolean => {
        const sz = sizeRef.current;
        if (sz === null) return false;
        const cam = cameraRef.current;
        const ppuLive = fitRef.current * cam.zoom;
        if (ppuLive === 0) return false;
        const rect = host.getBoundingClientRect();
        const sx = clientX - rect.left, sy = clientY - rect.top;
        const wxp = (sx - cam.tx) / ppuLive, wyp = (sy - cam.ty) / ppuLive;
        const select = (key: string) => {
            setSelected(key);
            if (onSelectFn) queueMicrotask(() => onSelectFn(key));
        };
        // 1) footprint shape (the exact world-space geometry the painter drew).
        for (const it of visibleItems) {
            if ((tiers.get(it.key) ?? lod) !== "card") continue;
            const fp = getSomeorUndefined(it.footprint);
            if (fp === undefined || fp.type === "rect") continue;
            const hit = fp.type === "circle"
                ? Math.hypot(wxp - it.x, wyp - it.y) <= fp.value.radius
                : pointInPolygon(wxp, wyp, fp.value.vertices);
            if (hit) { select(it.key); return true; }
        }
        // 2) the real DOM card under the pointer — hit-test the actual rendered
        // element (pixel-accurate), not an estimate of its box.
        if (typeof document !== "undefined") {
            const cardKey = document.elementFromPoint(clientX, clientY)
                ?.closest("[data-card-key]")?.getAttribute("data-card-key");
            if (cardKey !== null && cardKey !== undefined) { select(cardKey); return true; }
        }
        // 3) dot / label markers: nearest hit against the full rendered extent (P11).
        const ctx = drawRef.current?.getContext("2d") ?? null;
        // Measure label widths with the painter's font so the hitbox matches the
        // drawn pill; save/restore so the pick never leaks font state.
        if (ctx !== null) { ctx.save(); ctx.font = MARKER_LABEL_FONT; }
        const camScreen = { ppu: ppuLive, tx: cam.tx, ty: cam.ty };
        let best: SchematicItemValue | null = null, bestD = Infinity;
        for (const it of visibleItems) {
            const tier = tiers.get(it.key) ?? lod;
            if (tier === "card") continue;
            const box = markerHitbox(it, tier, camScreen, t => ctx !== null ? ctx.measureText(t).width : t.length * 6);
            if (!markerHit(box, sx, sy)) continue;
            const d = Math.hypot(it.x * ppuLive + cam.tx - sx, it.y * ppuLive + cam.ty - sy);
            if (d < bestD) { best = it; bestD = d; }
        }
        if (ctx !== null) ctx.restore();
        if (best !== null) { flyToItem(best); return true; }
        return false;
    }, [tiers, lod, visibleItems, onSelectFn, flyToItem]);

    const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        // Presses on the controls / nav buttons are theirs. Cards are NOT
        // excluded — a drag-pan can start anywhere, including over a card; a
        // tap (no drag) over the card is resolved by pickAt on pointerup.
        if ((e.target as HTMLElement).closest("button") !== null) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        movedRef.current = false;
        // Select tool (#153): start a screen-space selection box instead of a pan.
        if (effectiveToolRef.current === "select") {
            // Cancel any in-flight fly-to so the camera stops moving under the
            // marquee (the grab branch gets this for free via "pointerDown").
            transition("cancel");
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const sx = e.clientX - r.left, sy = e.clientY - r.top;
            selStartRef.current = { sx, sy };
            setSelRect({ x: sx, y: sy, w: 0, h: 0 });
            return;
        }
        transition("pointerDown");
        panRef.current = { x: e.clientX, y: e.clientY, tx: cameraRef.current.tx, ty: cameraRef.current.ty };
    }, [transition]);
    const onCanvasPointerMove = useCallback((e: React.PointerEvent) => {
        // Select-drag: grow the screen-space box from its start corner.
        const sel = selStartRef.current;
        if (sel !== null) {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const cx = e.clientX - r.left, cy = e.clientY - r.top;
            if (Math.abs(cx - sel.sx) > 4 || Math.abs(cy - sel.sy) > 4) movedRef.current = true;
            setSelRect({ x: Math.min(sel.sx, cx), y: Math.min(sel.sy, cy), w: Math.abs(cx - sel.sx), h: Math.abs(cy - sel.sy) });
            return;
        }
        const pan = panRef.current;
        if (!pan) return;
        if (Math.abs(e.clientX - pan.x) > 4 || Math.abs(e.clientY - pan.y) > 4) movedRef.current = true;
        cameraRef.current = { ...cameraRef.current, tx: pan.tx + e.clientX - pan.x, ty: pan.ty + e.clientY - pan.y };
        requestRender();
    }, [requestRender]);
    // End an in-progress canvas drag-pan (panning → idle). Returns whether a pan
    // was active; never disturbs a running fly.
    const endPan = useCallback(() => {
        if (panRef.current === null) return false;
        panRef.current = null;
        transition("pointerUp");
        return true;
    }, [transition]);
    const onCanvasPointerUp = useCallback((e: React.PointerEvent) => {
        // Select-drag release: fly the view into the boxed world region (#153).
        const sel = selStartRef.current;
        if (sel !== null) {
            selStartRef.current = null;
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const cx = e.clientX - r.left, cy = e.clientY - r.top;
            const x0 = Math.min(sel.sx, cx), y0 = Math.min(sel.sy, cy);
            const sw = Math.abs(cx - sel.sx), sh = Math.abs(cy - sel.sy);
            setSelRect(null);
            const cam = cameraRef.current;
            const ppuLive = fitRef.current * cam.zoom;
            // Only a real box zooms; a tap / sliver is ignored (no accidental warp).
            if (sw > 6 && sh > 6 && ppuLive > 0) {
                flyTo({ x: (x0 - cam.tx) / ppuLive, y: (y0 - cam.ty) / ppuLive, w: sw / ppuLive, h: sh / ppuLive });
            }
            return;
        }
        const wasPress = endPan();
        if (!wasPress || movedRef.current) return;   // not a canvas tap, or it was a drag
        // A tap selects the item under it; a tap on empty background clears the
        // selection ring (no zoom change — double-click handles Fit/reset). It
        // does NOT call onSelect: that channel is item-key-only, and a deselect
        // event would need a first-class API rather than an out-of-band sentinel.
        if (!pickAt(e.currentTarget as HTMLElement, e.clientX, e.clientY)) setSelected(null);
    }, [endPan, pickAt, flyTo]);
    // pointercancel / lost capture: a pan OR select-drag that loses its grip
    // mid-gesture must still end (issue #57, P10). After a normal release the
    // pan is already ended (panRef null) so this is a no-op then, and it never
    // cancels a fly the tap may have just started.
    const onCanvasPointerCancel = useCallback(() => {
        movedRef.current = false;
        selStartRef.current = null;
        setSelRect(null);
        endPan();
    }, [endPan]);
    const resetView = useCallback(() => {
        transition("cancel");           // cancels a running fly via the mode machine
        cameraRef.current = IDENTITY;
        requestRender();
    }, [transition, requestRender]);
    const zoomBy = useCallback((factor: number) => {
        const sz = sizeRef.current;
        if (sz === null) return;
        transition("zoom");
        cameraRef.current = zoomAbout(cameraRef.current, factor, sz.w / 2, sz.h / 2, 1, MAX_ZOOM);
        requestRender();
    }, [transition, requestRender]);

    // Momentary tool overrides (#153): while the schematic is hovered, holding
    // Space → grab, Ctrl → select, reverting on release. Gated on hover so the
    // page's Space-scroll / Ctrl-modifier is untouched elsewhere; window blur and
    // pointer-leave clear a stuck override.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!hoveredRef.current) return;
            // preventDefault on EVERY Space (incl. auto-repeat) so the page never
            // scrolls while panning; only the first sets the tool.
            if (e.code === "Space") { e.preventDefault(); if (!e.repeat) setTempTool("grab"); }
            else if (e.key === "Control" && !e.repeat) setTempTool("select");
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.code === "Space" || e.key === "Control") setTempTool(null);
        };
        const clear = () => setTempTool(null);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", clear);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", clear);
        };
    }, []);
    // Minimap is a camera writer (jump on press, follow on drag — invariant 8).
    const minimapDragRef = useRef(false);
    const minimapJump = useCallback((el: HTMLElement, clientX: number, clientY: number) => {
        const sz = sizeRef.current;
        if (sz === null) return;
        const rect = el.getBoundingClientRect();
        const cx = ((clientX - rect.left) / rect.width) * W;
        const cy = ((clientY - rect.top) / rect.height) * H;
        const cam = cameraRef.current;
        cameraRef.current = { ...cam, tx: sz.w / 2 - cx * fitRef.current * cam.zoom, ty: sz.h / 2 - cy * fitRef.current * cam.zoom };
        requestRender();
    }, [W, H, requestRender]);

    // Tear down any pending frame / fly on unmount.
    useEffect(() => () => {
        coalescerRef.current?.cancel();
        if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    }, [animRef]);

    // Repaint synchronously after any commit that changes a paint input OTHER
    // than the live camera (theme load, data, resize, dpr, selection, the
    // throttled LOD snapshot) — `applyCamera` reads the live `cameraRef`, so
    // canvas and cards stay aligned even on a snapshot-cadence re-render.
    useLayoutEffect(() => {
        applyCamera();
    }, [applyCamera, value, visibleItems, tiers, selected, palette, size, dpr, fit, cameraSnapshot]);

    // Accordion: one open zone; its ancestors stay open so the path is visible.
    const toggleZone = useCallback((key: string) => {
        const collapsing = openZoneRef.current === key;
        // Remember a user collapse so the spy won't immediately re-open it.
        zoneOverrideRef.current = collapsing ? key : null;
        setOpenZone(collapsing ? (nav.parentOf.get(key) ?? null) : key);
    }, [nav.parentOf]);
    // The spy hands the viewport's dominant zone to the SAME accordion state
    // manual interaction uses — one open chain, never two — but yields to a
    // user collapse until the viewport leaves that zone.
    useEffect(() => {
        if (currentZone === undefined) return;
        if (zoneOverrideRef.current !== null) {
            if (zoneOverrideRef.current === currentZone) return; // user collapsed this; respect it
            zoneOverrideRef.current = null;                      // viewport moved on; clear the override
        }
        setOpenZone(currentZone);
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
                    style={{
                        paddingLeft: `${8 + depth * 14}px`,
                        // Pin this header below its ancestors' pinned headers
                        // (each level offset by one row) so the whole path stays
                        // visible while scrolling the zone's items; shallower
                        // levels stack above deeper ones.
                        top: `calc(var(--nav-row-h) * ${depth})`,
                        zIndex: 30 - depth,
                    }}
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

    const schematicBody = (
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
                    {/* Search lives in the optional top-edge Slice rail now (#128) —
                        the navigator is a pure zones→items TOC. */}
                    <Box ref={navTreeRef} css={styles.navTree}>
                        {nav.roots.map(node => renderNavZone(node, 0))}
                        {nav.floor.map(item => (
                            <Box key={item.key} as="button" css={styles.navItem} data-nav-key={item.key} style={{ paddingLeft: "8px" }} onClick={() => flyToItem(item)}>
                                <Box as="span" css={styles.statusDot} data-tone={statusTone(item.status) ?? "neutral"} />
                                {item.label}
                            </Box>
                        ))}
                    </Box>
                </Box>
            )}
            <Box
                ref={canvasRef}
                css={styles.canvas}
                data-schematic-canvas=""
                style={{
                    ...(fixedHeight !== undefined ? { minHeight: 0 } : { aspectRatio: `${W} / ${H}` }),
                    // Select shows a crosshair; for grab we leave the cursor to the
                    // recipe (grab → grabbing on :active) — an inline value would
                    // outrank the recipe and freeze the cursor on 'grab' mid-pan (#153).
                    ...(effectiveTool === "select" ? { cursor: "crosshair" } : {}),
                }}
                onPointerEnter={() => { hoveredRef.current = true; }}
                onPointerLeave={() => { hoveredRef.current = false; setTempTool(null); }}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onPointerCancel={onCanvasPointerCancel}
                onLostPointerCapture={onCanvasPointerCancel}
                onDoubleClick={resetView}
            >
                {/* Grid size/position are driven imperatively by applyCamera so
                    they stay locked to the same camera frame as the canvas. */}
                {showGrid && size !== null && <Box ref={gridRef} css={styles.grid} />}
                {size !== null && (
                    <>
                        <canvas
                            ref={drawRef}
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                        />
                        {/* Card layer holds the live `--cam-*` vars (set by
                            applyCamera); each card translates off them, so a
                            camera change is 3 var writes on this parent, never a
                            per-card React re-layout (issue #57, invariant 6). */}
                        <Box ref={cardLayerRef} css={styles.cardLayer}>
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
                                        data-card-key={item.key}
                                        {...(isSelected ? { "data-selected": "" } : {})}
                                        style={{
                                            left: 0, top: 0,
                                            transform: `${cardTranslateCss(item.x, item.y)} translate(-50%, -50%)`,
                                            ...(typeof width === "number" ? { width: cardWidthCss(width) } : {}),
                                        }}
                                    >{/* No onClick / stopPropagation: a drag-pan can start on a
                                        card, and a tap is resolved by the canvas pickAt (pointerup). */}
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
                        </Box>
                        {/* Drag-select marquee (#153) — screen-space, host-relative. */}
                        {selRect !== null && (
                            <Box css={styles.selectBox} style={{ left: selRect.x, top: selRect.y, width: selRect.w, height: selRect.h }} aria-hidden="true" />
                        )}
                        <Box css={styles.controls}>
                            {/* Tool group: grab (pan, default) + select (zoom-to-box). */}
                            <Box css={styles.controlGroup}>
                                <Box as="button" css={styles.controlButton} {...(tool === "grab" ? { "data-active": "" } : {})} aria-label="Grab / pan tool" aria-pressed={tool === "grab"} title="Grab — drag to pan (hold Space)" onClick={() => setTool("grab")}><FontAwesomeIcon icon={faHand} /></Box>
                                <Box as="button" css={styles.controlButton} {...(tool === "select" ? { "data-active": "" } : {})} aria-label="Select-region tool" aria-pressed={tool === "select"} title="Select — drag a box to zoom in (hold Ctrl)" onClick={() => setTool("select")}><FontAwesomeIcon icon={faObjectGroup} /></Box>
                            </Box>
                            <Box as="button" css={styles.controlButton} aria-label="Zoom in" title="Zoom in (scroll)" onClick={() => zoomBy(1.5)}><FontAwesomeIcon icon={faPlus} /></Box>
                            <Box as="button" css={styles.controlButton} aria-label="Zoom out" title="Zoom out (scroll)" onClick={() => zoomBy(1 / 1.5)}><FontAwesomeIcon icon={faMinus} /></Box>
                            <Box as="button" css={styles.controlButton} aria-label="Fit view" title="Fit view (double-click)" onClick={resetView}><FontAwesomeIcon icon={faExpand} /></Box>
                            {/* Back / forward through items — its own vertical group. */}
                            {selected !== null && (
                                <Box css={styles.controlGroup}>
                                    <Box as="button" css={styles.controlButton} aria-label="Previous item" title="Previous item" onClick={() => stepSelection(-1)}><FontAwesomeIcon icon={faChevronLeft} /></Box>
                                    <Box as="button" css={styles.controlButton} aria-label="Next item" title="Next item" onClick={() => stepSelection(1)}><FontAwesomeIcon icon={faChevronRight} /></Box>
                                </Box>
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
                                    const el = e.currentTarget as HTMLElement;
                                    el.setPointerCapture(e.pointerId);
                                    transition("cancel");   // cancels a running fly via the mode machine
                                    minimapDragRef.current = true;
                                    minimapJump(el, e.clientX, e.clientY);
                                }}
                                onPointerMove={e => {
                                    if (!minimapDragRef.current) return;
                                    e.stopPropagation();
                                    minimapJump(e.currentTarget as HTMLElement, e.clientX, e.clientY);
                                }}
                                onPointerUp={e => {
                                    minimapDragRef.current = false;
                                    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
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
                                            left: `${Math.max(0, (-cameraSnapshot.tx / ppu / W) * 100)}%`,
                                            top: `${Math.max(0, (-cameraSnapshot.ty / ppu / H) * 100)}%`,
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

    // No slice chrome → render the schematic bare (built-in navigator search stays).
    if (!hasSliceChrome) return schematicBody;
    // Slice chrome → a full-width top-edge rail above the schematic frame (#128).
    return (
        <Box css={{ ...sliceFrameStyles.root, display: "flex", flexDirection: "column", minHeight: 0, ...(fixedHeight !== undefined ? { height: fixedHeight, maxHeight: fixedHeight } : {}) }}>
            <Box css={{ ...sliceFrameStyles.frameEyebrow, flexShrink: 0 }}>
                <SliceRailCluster slice={sliceHandle!} affordanceKinds={sliceChrome!.affordances.map(a => a.type)} />
            </Box>
            <Box css={{ ...sliceFrameStyles.frameBody, flex: "1 1 0%", minHeight: 0, position: "relative" }}>
                {schematicBody}
            </Box>
        </Box>
    );
}, (prev, next) => schematicEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
