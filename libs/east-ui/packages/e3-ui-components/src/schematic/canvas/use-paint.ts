/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic canvas's paint path (#57, #172, #1387): ONE commit-phase
 * snapshot of every render-derived value the async closures read — the frame's
 * apply, a fly's re-aim, the pointer handlers — written by one dep-less layout
 * effect, never in a render, the palette and each entity's colour read from the
 * theme bridge's probe in the same effect (invariant 1); the apply, which moves
 * every surface with the live camera and calls the painter behind the paint's
 * identity short-circuit (invariant 2); the minimap's paint, from the same
 * snapshot (#1393); the builder's reveal, heard through `RevealTell` for the
 * painted placeholders (#1398, invariant 30), and a pulse's breath (#1392,
 * invariant 22) — neither rendering the canvas. The painter is `paint.ts`, pure.
 *
 * The snapshot reads every part's state and every part's behaviour reads the
 * snapshot: {@link usePaint} is made after the camera's, the selection's, the
 * gestures' and the drop's state, and before what moves the camera, keeps the
 * selection, handles the gestures and takes the drop.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useRevealed } from "@elaraai/east-ui-components/internal";
import type { SchematicDensity } from "../area.js";
import type { SchematicValue } from "../data.js";
import type { SchematicDropMark } from "../drop.js";
import type { SchematicNarrowedLook } from "../narrowing.js";
import type { Viewport } from "./camera";
import type { DrawnItem, DrawnZone, SchematicDrawn } from "./drawn";
import { paintMinimap } from "./minimap";
import type { LodTier, WorldBox } from "./model";
import { paintSchematic, type RGB, type SchematicPaintEffect, type SchematicPalette } from "./paint";
import { readPalette, useThemeVersion } from "./theme";
import { entityTints, tintsOf, type SchematicTints } from "./tints";
import type { Camera } from "./use-camera";
import type { CanvasSelection } from "./use-canvas-selection";
import type { GestureState } from "./use-gestures";

type Pt = { x: number; y: number };

/** One breath of a pulse's ring, in ms. */
const PULSE_PERIOD_MS = 1600;
/** No entity's colour resolved: what the canvas paints by before the probe is first read. */
const NO_TINTS: ReadonlyMap<string, RGB> = new Map();

/**
 * Tells the canvas whether its builder's reveal shows a read in flight (#1398, CL4), as its clock flips: what its
 * painted placeholders — a marker whose status is unread — show by. It draws nothing, and its flip renders it alone,
 * never the canvas. Outside a builder's reveal a placeholder shows, as the shared shapes do.
 */
export const RevealTell = memo(function RevealTell({ onReveal }: { onReveal: (shown: boolean) => void }) {
    const shown = useRevealed() !== false;
    useLayoutEffect(() => { onReveal(shown); }, [shown, onReveal]);
    return null;
});

/** A round scale-bar length (1/2/5 × 10^k) rendering near `targetPx`. */
export function niceScaleLength(ppu: number, targetPx: number): number {
    const target = targetPx / ppu;
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    for (const m of [5, 2, 1]) {
        if (m * pow <= target) return m * pow;
    }
    return pow;
}

/** What {@link usePaint} reads: what the snapshot holds, and the pulse's narrowing. */
export interface PaintProps {
    /** The payload, decoded: the drawing's extent. */
    readonly value: SchematicValue;
    /** What the canvas draws: its reader's stored rows, the editing session's drafts in place — what the colours are read for. */
    readonly data: SchematicDrawn;
    /** What the painter draws: the drawing, its items where a Move's preview has them — the ONE seam into the painter (invariant 4). */
    readonly paintValue: SchematicDrawn;
    /** The items in view. */
    readonly visibleItems: readonly DrawnItem[];
    /** What each item in view draws as at the zoom. */
    readonly tiers: ReadonlyMap<string, LodTier>;
    /** Each item drawn's centre, by its id. */
    readonly centers: ReadonlyMap<string, Pt>;
    /** What a hidden layer holds, by id. */
    readonly layerHiddenKeys: ReadonlySet<string>;
    /** Each dimmed entity's opacity, by id. */
    readonly layerAlpha: ReadonlyMap<string, number>;
    /** Connect's draft in world units (#176): from the item it runs from to the pointer, or the target it snaps to. */
    readonly connectDraftWorld: { from: Pt; to: Pt; fromKey: string; snapped: boolean; toKey?: string; forbiddenKey?: string } | undefined;
    /** The link or the net lit under the pointer, while it draws and takes the pointer (#1403). */
    readonly litShown: string | undefined;
    /** The link a retarget moves, drawn as its `was` line (#1403). */
    readonly wasLink: string | undefined;
    /** Where a library card's drop lands while its drag rests there (#1390). */
    readonly dropMark: SchematicDropMark | undefined;
    /** What the painter draws of the narrowing, but the pulse's phase (#1392). */
    readonly paintEffect: Omit<SchematicPaintEffect, "pulsePhase"> | undefined;
    /** The box the narrowing's fit flies to (#1392). */
    readonly fitBox: WorldBox | undefined;
    /** Each kind read by area drawing its density in place of its items (D25), by its slot. */
    readonly density: ReadonlyMap<string, SchematicDensity>;
    /** Whether what it draws stands in for a new narrowing (#1398): its words painted in the third ink. */
    readonly stale: boolean;
    /** Whether what it draws is retained (#1398, CL8): no gesture edits it. */
    readonly retained: boolean;
    /** Whether the minimap shows. */
    readonly showMinimap: boolean;
    /** The minimap's size, in CSS px; `undefined` while the canvas has no size. */
    readonly minimapBox: { w: number; h: number } | undefined;
    /** The zones drawn, a hidden layer's left out: the minimap's. */
    readonly shownZones: readonly DrawnZone[];
    /** Each kind read by area's whole drawing's density: the minimap's (#1393). */
    readonly minimapDensities: readonly SchematicDensity[];
    /** Each item of a kind read whole: the minimap's dots (#1393). */
    readonly minimapItems: readonly DrawnItem[];
    /** How a narrowed-out row draws, and what the matches take: whether a pulse breathes. */
    readonly look: SchematicNarrowedLook;
    /** The narrowing's matches, by id (#1392). */
    readonly matches: ReadonlySet<string>;
    /** The camera (`use-camera.ts`). */
    readonly camera: Camera;
    /** What is selected, and the report's context the snapshot writes (`use-canvas-selection.ts`). */
    readonly canvasSelection: CanvasSelection;
    /** The gestures' state (`use-gestures.ts`). */
    readonly gestureState: GestureState;
}

/**
 * The commit-phase snapshot (invariant 1): every render-derived value the async closures read — the apply, a fly's
 * re-aim, the pointer handlers — as the last commit left it, the palette and each entity's colour read from the probe
 * with it.
 */
export interface CanvasSnapshot {
    /** What the painter draws: the drawing, its items where a Move's preview has them — the ONE seam into the painter (invariant 4). */
    readonly value: SchematicDrawn;
    /** What the canvas draws, as its reader and the drafts give it: the drawing an item a drop asks to select waits on. */
    readonly drawn: SchematicDrawn;
    /** The canvas's size, in CSS px; `null` before it is measured. */
    readonly size: Camera["size"];
    /** Px per world unit at Fit's zoom; `0` before the canvas is measured. */
    readonly fit: number;
    /** Fit's camera: home. */
    readonly home: Viewport;
    /** The zoom's limit, as a factor of Fit's (invariant 24). */
    readonly maxZoom: number;
    /** The device's pixel ratio. */
    readonly dpr: number;
    /** The camera as the render last took it: its throttled snapshot, which the culling and the tiers follow. */
    readonly camera: Viewport;
    /** The items in view. */
    readonly visibleItems: readonly DrawnItem[];
    /** What each item in view draws as at the zoom. */
    readonly tiers: ReadonlyMap<string, LodTier>;
    /** The items selected, and the anchor the steps walk from. */
    readonly selection: CanvasSelection["selection"];
    /** The zones selected. */
    readonly zoneSelection: ReadonlySet<string>;
    /** What draws selected: the selection, or what a marquee in flight would select. */
    readonly renderSelected: ReadonlySet<string>;
    /** Each item drawn's centre, by its id. */
    readonly centers: ReadonlyMap<string, Pt>;
    /** What a hidden layer holds, by id. */
    readonly layerHiddenKeys: ReadonlySet<string>;
    /** Each dimmed entity's opacity, by id. */
    readonly layerAlpha: ReadonlyMap<string, number>;
    /** The tool in force. */
    readonly effectiveTool: GestureState["effectiveTool"];
    /** Whether the tool in force drags a box: Zoom box, or Marquee. */
    readonly isBoxTool: boolean;
    /** Connect's draft in world units (#176). */
    readonly connectDraftWorld: PaintProps["connectDraftWorld"];
    /** The link or the net selected, and a net's leg. */
    readonly selectedLink: CanvasSelection["selectedLink"];
    /** Whether the selected link writes: its handles draw, and a press on one re-targets it. */
    readonly selectedLinkEditable: boolean;
    /** Where a library card's drop lands while its drag rests there (#1390). */
    readonly dropMark: SchematicDropMark | undefined;
    /** What the painter draws of the narrowing, but the pulse's phase (#1392). */
    readonly paintEffect: PaintProps["paintEffect"];
    /** The box the narrowing's fit flies to (#1392). */
    readonly fitBox: WorldBox | undefined;
    /** The link or the net lit under the pointer (#1403). */
    readonly lit: string | undefined;
    /** The link a retarget moves, drawn as its `was` line (#1403). */
    readonly wasLink: string | undefined;
    /** Each kind read by area drawing its density in place of its items, by its slot (D25). */
    readonly density: ReadonlyMap<string, SchematicDensity>;
    /** Whether what it draws stands in for a new narrowing (#1398). */
    readonly stale: boolean;
    /** Whether what it draws is retained (#1398, CL8). */
    readonly retained: boolean;
    /** The drawing's extent, in world units. */
    readonly extent: SchematicValue["extent"];
    /** What the minimap draws, while it shows and the canvas has a size (#1393). */
    readonly minimap: {
        readonly box: { readonly w: number; readonly h: number };
        readonly zones: readonly DrawnZone[];
        readonly densities: readonly SchematicDensity[];
        readonly items: readonly DrawnItem[];
    } | undefined;
    /** The palette the probe last read; `null` before it is first read. */
    readonly palette: SchematicPalette | null;
    /** Each entity's colour, by its id, as the probe resolved it. */
    readonly tints: ReadonlyMap<string, RGB>;
}

/** The paint path, as {@link usePaint} gives it. */
export interface Paint {
    /** The painted canvas's element. */
    readonly drawRef: RefObject<HTMLCanvasElement | null>;
    /** Each card's size as the page lays it out, by its item's id (#1403): what the card layer's observer writes, and a link's end meets. */
    readonly cardSizesRef: RefObject<ReadonlyMap<string, { w: number; h: number }>>;
    /** The card layer's element: what the apply writes the live camera's custom properties to. */
    readonly cardLayerRef: RefObject<HTMLDivElement | null>;
    /** The grid's element: its cells and its position, as the apply writes them. */
    readonly gridRef: RefObject<HTMLDivElement | null>;
    /** The unread area's layer, under the grid (#1398). */
    readonly washLayerRef: RefObject<HTMLDivElement | null>;
    /** Every colour the drawing names, and each entity's: what the probe holds (`tints.ts`). */
    readonly tintIndex: SchematicTints;
    /** The theme bridge's probe's element (`theme.tsx`). */
    readonly probeRef: RefObject<HTMLDivElement | null>;
    /** What draws selected: the selection, or what a marquee in flight would select. */
    readonly renderSelected: ReadonlySet<string>;
    /** The commit-phase snapshot (invariant 1). */
    readonly renderSnapRef: RefObject<CanvasSnapshot>;
    /** Applies the live camera to every surface, then paints behind the paint's identity short-circuit (invariant 2). */
    readonly applyCamera: () => void;
    /** Hears the builder's reveal flip (CL4): the painted placeholders show, or go unseen, with no render of the canvas. */
    readonly onReveal: (shown: boolean) => void;
    /** The minimap's painted canvas's element. */
    readonly minimapPaintRef: RefObject<HTMLCanvasElement | null>;
}

/**
 * The paint path (see the module docs).
 *
 * @param props - What the snapshot holds — the drawing and what it draws in view, the camera, what is selected, the
 *   gestures' state, the drop's mark, the narrowing's look and what stands in — and the minimap's
 * @returns The surfaces' refs, the probe's colours and its ref, what the cards draw selected, the snapshot's ref, the
 *   apply, what hears the reveal, and the minimap's paint's ref
 */
export function usePaint({
    value, data, paintValue, visibleItems, tiers, centers, layerHiddenKeys, layerAlpha, connectDraftWorld, litShown, wasLink, dropMark, paintEffect, fitBox,
    density, stale, retained, showMinimap, minimapBox, shownZones, minimapDensities, minimapItems, look, matches, camera, canvasSelection, gestureState,
}: PaintProps): Paint {
    const { size, dpr, cameraRef, cameraSnapshot, fit, home, maxZoom } = camera;
    const { selection, zoneSelection, selected, selectedLink, commitCtx, commitCtxRef } = canvasSelection;
    const { effectiveTool, isBoxTool, selectedLinkEditable, marqueePreview, connectFlashRef } = gestureState;
    const drawRef = useRef<HTMLCanvasElement | null>(null);
    // Each card's size as the page lays it out, by its item's id (#1403): what a link's end meets at card zoom. Heard
    // by a ResizeObserver as each card is laid out and as its box changes — never in a render — a fresh map each time it
    // moves (invariant 2); a card it hasn't heard, or one laid out at no size, is reckoned (`tierSize`).
    const cardSizesRef = useRef<ReadonlyMap<string, { w: number; h: number }>>(new Map());
    const cardLayerRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<HTMLDivElement | null>(null);
    // The unread area's layer, under the grid (#1398): its washes follow the camera's custom properties, as the cards do.
    const washLayerRef = useRef<HTMLDivElement | null>(null);
    // Whether the painted placeholders show, as the builder's reveal says (CL4): heard by `RevealTell`, read at paint time.
    const placeholdersRef = useRef(true);

    // --- The theme bridge (#1387): every colour and font the canvas draws in ----
    // The colours the drawing names, each entity's by its id: read from what is
    // drawn — the reader's rows, the drafts in place — which keeps its identity
    // while nothing it shows moves, so a Move's preview keeps its items' colours,
    // and a drafted link draws in its style's own. The probe holds one element
    // per colour; the commit-phase snapshot below reads it when the colours named
    // or the theme change, never in the render body.
    const tintIndex = useMemo(() => tintsOf(data), [data]);
    const themeVersion = useThemeVersion();
    const probeRef = useRef<HTMLDivElement | null>(null);
    /** What the probe last read, and for which colours — by their signature — and which theme. */
    const paletteRef = useRef<{ signature: string; theme: number; palette: SchematicPalette; tints: ReadonlyMap<string, RGB> } | null>(null);
    /** Each entity's colour, and the colours and the drawing it was resolved for. */
    const entityTintsRef = useRef<{ byEntity: unknown; tints: unknown; byId: ReadonlyMap<string, RGB> } | null>(null);

    // --- Single synchronized camera apply (Phase 2). ------------------------
    // While a marquee drag is in flight, the CANVAS previews the would-be
    // selection (rings on the boxed items) without committing. Interaction
    // logic keeps using the committed `selected`; only the paint + cards read this.
    const renderSelected = marqueePreview ?? selected;
    // ONE commit-phase snapshot of every render-derived value the async closures
    // (the rAF `applyCamera`, `flyTo`'s per-frame re-aim, the pointer handlers)
    // need (#172). Written ONLY in the dep-less layout effect below — never in
    // the render body — so a discarded / StrictMode-double render can never leak
    // uncommitted values into a frame, and there is no per-field mirror (or
    // dependency list) to drift. The palette and each entity's colour are read
    // there too, from the probe the commit just laid out.
    const renderSnap = {
        value: paintValue, drawn: data, size, fit, home, maxZoom, dpr, camera: cameraSnapshot, visibleItems, tiers,
        selection, zoneSelection, renderSelected, centers,
        layerHiddenKeys, layerAlpha,
        effectiveTool, isBoxTool,
        connectDraftWorld,
        selectedLink, selectedLinkEditable,
        dropMark,
        paintEffect, fitBox,
        lit: litShown, wasLink,
        density,
        // What stands in for a new narrowing (#1398): kept, its words painted in the third ink; retained, no gesture edits.
        stale, retained,
        extent: value.extent,
        minimap: showMinimap && minimapBox !== undefined ? { box: minimapBox, zones: shownZones, densities: minimapDensities, items: minimapItems } : undefined,
        palette: null as SchematicPalette | null,
        tints: NO_TINTS,
    };
    const renderSnapRef = useRef(renderSnap);
    // The pulse's phase (0..1), moved by its ticker and read at paint time, with no render: the animation's own.
    const pulsePhaseRef = useRef(0);

    // Skip an apply whose inputs are referentially identical to the last —
    // covers redundant idle re-renders / repeated requestRender with no change.
    // (During an active pan the layout-effect apply still repaints, because
    // visibleItems is rebuilt fresh each snapshot; that second paint is accepted
    // — bounded by viewport culling — and keeps canvas LOD lock-step with cards.)
    const lastPaintRef = useRef<{
        zoom: number; tx: number; ty: number; vis: unknown; tiers: unknown;
        sel: ReadonlySet<string>; zsel: ReadonlySet<string>; pal: SchematicPalette | null; tints: unknown; w: number; h: number; dpr: number; val: unknown;
        lay: unknown; alp: unknown;
        dl: unknown; cf: number; slk: unknown; sle: boolean; dm: unknown; eff: unknown; phase: number;
        lit: string | undefined; was: string | undefined; cs: unknown; den: unknown; ph: boolean; st: boolean;
    } | null>(null);

    // Apply the LIVE camera to ALL surfaces in one step: card-layer CSS vars +
    // grid first (cheap, palette-independent), then the canvas paint (issue
    // #57, Phase 2 invariant 1). Positions therefore never desync — every
    // surface reads the same `cameraRef` (P1).
    const applyCamera = useCallback(() => {
        const snap = renderSnapRef.current;
        const sz = snap.size;
        if (sz === null) return;
        const cam = cameraRef.current;
        const ppuLive = snap.fit * cam.zoom;
        const dprLive = snap.dpr;

        // DOM card layer: move every card with three custom-property writes on
        // the parent (compositor only — no per-card layout) — invariant 6. The
        // grid's rules follow the same camera, by the same properties.
        const grid = gridRef.current;
        for (const layer of [cardLayerRef.current, washLayerRef.current, grid]) {
            if (layer === null) continue;
            layer.style.setProperty("--cam-ppu", String(ppuLive));
            layer.style.setProperty("--cam-tx", `${cam.tx}px`);
            layer.style.setProperty("--cam-ty", `${cam.ty}px`);
        }
        // Background grid: its cells, the scale bar's length a major one, five minor ones to it — the recipe drawing its
        // rules from them, solid, or dashed while what the canvas draws is kept (#1398).
        if (grid !== null) {
            const len = ppuLive > 0 ? niceScaleLength(ppuLive, 100) : 0;
            if (len > 0) {
                const major = len * ppuLive;
                grid.style.setProperty("--schematic-grid-major", `${major}px`);
                grid.style.setProperty("--schematic-grid-minor", `${major / 5}px`);
            }
        }

        const canvas = drawRef.current, pal = snap.palette;
        if (canvas === null || pal === null) return;
        // Connect-flash phase (0..1; -1 = no flash) — animates via the flash rAF.
        const cf = connectFlashRef.current;
        const cfPhase = cf !== null ? Math.min(1, (performance.now() - cf.t0) / 450) : -1;
        const cardSizes = cardSizesRef.current;
        const last = lastPaintRef.current;
        if (last !== null
            && last.zoom === cam.zoom && last.tx === cam.tx && last.ty === cam.ty
            && last.vis === snap.visibleItems && last.tiers === snap.tiers
            && last.sel === snap.renderSelected && last.zsel === snap.zoneSelection && last.pal === pal && last.tints === snap.tints
            && last.w === sz.w && last.h === sz.h && last.dpr === dprLive && Object.is(last.val, snap.value)
            && last.lay === snap.layerHiddenKeys && last.alp === snap.layerAlpha
            && last.dl === snap.connectDraftWorld && last.cf === cfPhase
            && last.slk === snap.selectedLink && last.sle === snap.selectedLinkEditable && last.dm === snap.dropMark
            && last.eff === snap.paintEffect && last.phase === pulsePhaseRef.current
            && last.lit === snap.lit && last.was === snap.wasLink && last.cs === cardSizes && last.den === snap.density
            && last.ph === placeholdersRef.current && last.st === snap.stale) return;
        lastPaintRef.current = {
            zoom: cam.zoom, tx: cam.tx, ty: cam.ty, vis: snap.visibleItems, tiers: snap.tiers,
            sel: snap.renderSelected, zsel: snap.zoneSelection, pal, tints: snap.tints, w: sz.w, h: sz.h, dpr: dprLive, val: snap.value,
            lay: snap.layerHiddenKeys, alp: snap.layerAlpha,
            dl: snap.connectDraftWorld, cf: cfPhase,
            slk: snap.selectedLink, sle: snap.selectedLinkEditable, dm: snap.dropMark,
            eff: snap.paintEffect, phase: pulsePhaseRef.current,
            lit: snap.lit, was: snap.wasLink, cs: cardSizes, den: snap.density, ph: placeholdersRef.current, st: snap.stale,
        };
        const bw = Math.round(sz.w * dprLive), bh = Math.round(sz.h * dprLive);
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
        const ctx = canvas.getContext("2d");
        if (ctx === null) return;
        ctx.setTransform(dprLive, 0, 0, dprLive, 0, 0);
        // A paint throw (bad geometry / palette edge) logs and skips the frame
        // rather than propagating out of a layout effect and unmounting the tree.
        try {
            paintSchematic({
                ctx, value: snap.value, cam: { ppu: ppuLive, tx: cam.tx, ty: cam.ty },
                width: sz.w, height: sz.h,
                visibleItems: snap.visibleItems, tiers: snap.tiers,
                selected: snap.renderSelected, selectedZones: snap.zoneSelection, centers: snap.centers, palette: pal, tints: snap.tints,
                // Layer masks for the zone / link paint passes (items are already
                // pre-filtered out of visibleItems); `layerAlpha` dims item markers.
                layerHiddenKeys: snap.layerHiddenKeys, layerAlpha: snap.layerAlpha,
                // Connect-tool overlays (#176): the draft edge and the one-shot commit flash.
                ...(snap.connectDraftWorld !== undefined ? { draftLink: snap.connectDraftWorld } : {}),
                ...(cf !== null ? { connectFlash: { from: snap.centers.get(cf.from), to: snap.centers.get(cf.to), phase: cfPhase } } : {}),
                ...(snap.selectedLink !== null ? {
                    selectedLink: {
                        key: snap.selectedLink.key, editable: snap.selectedLinkEditable,
                        ...(snap.selectedLink.leg !== null ? { leg: snap.selectedLink.leg } : {}),
                    },
                } : {}),
                // Where a library card's drop lands (#1390): the point, or the entity it lands on.
                ...(snap.dropMark !== undefined ? { dropMark: snap.dropMark } : {}),
                // What the narrowing paints (#1392): context, the matches' rings at the pulse's phase, and their frame.
                ...(snap.paintEffect !== undefined ? { effect: { ...snap.paintEffect, pulsePhase: pulsePhaseRef.current } } : {}),
                // The links' ends on the cards' sides as the page lays them out, the link lit, and a retarget's run (#1403).
                cardSizes,
                ...(snap.lit !== undefined ? { lit: snap.lit } : {}),
                ...(snap.wasLink !== undefined ? { was: snap.wasLink } : {}),
                // The density at overview, each kind read by area past the rows a window draws (#1393, D25).
                ...(snap.density.size > 0 ? { density: snap.density } : {}),
                // A marker whose status is unread draws in the placeholders' fill once the reveal says so (#1398, CL4).
                placeholders: placeholdersRef.current,
                // What stands in for a new narrowing (#1398): its words in the third ink.
                stale: snap.stale,
            });
        } catch (err) {
            console.error("[Schematic] paint failed (frame skipped):", err);
        }
    }, [cameraRef, connectFlashRef]);

    // The builder's reveal flipping (CL4): the painted placeholders show, or go unseen, with no render of the canvas.
    const onReveal = useCallback((shown: boolean) => {
        if (placeholdersRef.current === shown) return;
        placeholdersRef.current = shown;
        applyCamera();
    }, [applyCamera]);

    // The minimap's paint (#1393): from the commit-phase snapshot, as the canvas's is, and drawn again only as what it
    // shows moves — its element, its size, the zones, the overview, the items, the palette — never as the camera moves:
    // the viewport's box over it is the DOM's.
    const minimapPaintRef = useRef<HTMLCanvasElement | null>(null);
    const lastMinimapRef = useRef<{
        el: HTMLCanvasElement; w: number; h: number; dpr: number; pal: SchematicPalette; zones: unknown; densities: unknown; items: unknown;
    } | null>(null);
    const applyMinimap = useCallback(() => {
        const snap = renderSnapRef.current;
        const canvas = minimapPaintRef.current, pal = snap.palette, mini = snap.minimap;
        if (canvas === null || pal === null || mini === undefined) return;
        const { box } = mini;
        const last = lastMinimapRef.current;
        if (last !== null && last.el === canvas && last.w === box.w && last.h === box.h && last.dpr === snap.dpr && last.pal === pal
            && last.zones === mini.zones && last.densities === mini.densities && last.items === mini.items) return;
        lastMinimapRef.current = { el: canvas, w: box.w, h: box.h, dpr: snap.dpr, pal, zones: mini.zones, densities: mini.densities, items: mini.items };
        const bw = Math.round(box.w * snap.dpr), bh = Math.round(box.h * snap.dpr);
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
        const ctx = canvas.getContext("2d");
        if (ctx === null) return;
        ctx.setTransform(snap.dpr, 0, 0, snap.dpr, 0, 0);
        try {
            paintMinimap({ ctx, width: box.w, height: box.h, extent: snap.extent, zones: mini.zones, densities: mini.densities, items: mini.items, palette: pal });
        } catch (err) {
            console.error("[Schematic] minimap paint failed:", err);
        }
    }, []);

    // THE commit-phase snapshot write (#172): dep-less, so it runs on EVERY
    // commit — the snapshot + commit context can never lag a render, and there
    // is no dependency list to drift. The palette is read from the probe here,
    // when the colours the drawing names or the theme moved — the probe this
    // commit laid out — and each entity's colour resolved from it, before the
    // paint. `applyCamera`'s identity short-circuit makes the trailing repaint
    // free when nothing paint-relevant changed.
    useLayoutEffect(() => {
        const probe = probeRef.current;
        let read = paletteRef.current;
        if (probe !== null && (read === null || read.signature !== tintIndex.signature || read.theme !== themeVersion)) {
            const reading = readPalette(probe);
            read = { signature: tintIndex.signature, theme: themeVersion, palette: reading.palette, tints: reading.tints };
            paletteRef.current = read;
        }
        let resolved = entityTintsRef.current;
        if (read !== null && (resolved === null || resolved.byEntity !== tintIndex.byEntity || resolved.tints !== read.tints)) {
            resolved = { byEntity: tintIndex.byEntity, tints: read.tints, byId: entityTints(tintIndex.byEntity, read.tints) };
            entityTintsRef.current = resolved;
        }
        renderSnapRef.current = { ...renderSnap, palette: read?.palette ?? null, tints: resolved?.byId ?? NO_TINTS };
        commitCtxRef.current = commitCtx;
        applyCamera();
        applyMinimap();
    });

    // A pulse's breath (#1392, §10.3): a loop of its own that moves the phase and repaints, only while a match is
    // ringed by a pulse — a halo, or none, never starts it. Its cards breathe by the same clock, the card layer's
    // `--pulse` (0..1), which the recipe's ring reads; let go, the phase rests and one paint clears the last ring.
    const pulsing = look.emphasis === "pulse" && matches.size > 0;
    useEffect(() => {
        if (!pulsing) return;
        let raf = 0;
        // The card layer the cards breathe on: read at each frame, as it mounts only once the canvas is measured.
        let breathed: HTMLDivElement | null = null;
        const start = performance.now();
        // The clock the breath began on, as a fly reads its own: never the frame's stamp, which can stand before it.
        const tick = () => {
            const phase = ((performance.now() - start) % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
            pulsePhaseRef.current = phase;
            breathed = cardLayerRef.current;
            breathed?.style.setProperty("--pulse", String(Math.sin(phase * Math.PI * 2) * 0.5 + 0.5));
            applyCamera();
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf);
            pulsePhaseRef.current = 0;
            breathed?.style.setProperty("--pulse", "0");
            applyCamera();
        };
    }, [pulsing, applyCamera]);

    // (The per-commit repaint rides the dep-less snapshot-write effect above —
    // a zone/link-only layer change, a theme switch, or a data change repaints
    // because EVERY commit re-snapshots then applies, and the identity
    // short-circuit makes the no-change case free.)
    return {
        drawRef, cardSizesRef, cardLayerRef, gridRef, washLayerRef, tintIndex, probeRef, renderSelected, renderSnapRef, applyCamera, onReveal,
        minimapPaintRef,
    };
}
