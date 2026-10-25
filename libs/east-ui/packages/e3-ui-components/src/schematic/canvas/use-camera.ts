/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic canvas's camera (#57, #1393): its live ref, which the input
 * handlers move and one frame applies to every surface (`requestRender`, the
 * coalesced frame), and a throttled snapshot of it for what the render
 * derives; the canvas's size and its pixel ratio; Fit's camera — home — and the
 * zoom's limit (invariants 23, 24); the interaction-mode machine a gesture
 * supersedes a fly by; the fly, on one clock (invariant 25); a zoom about a
 * point — the toolbar's, about the middle, and the wheel's, about the cursor;
 * Fit; the minimap's jump; the fly to the narrowing's matches (invariant 22);
 * and what the camera tells as it moves — the zone the viewport is in, where
 * the viewport rests, for the reader, and where the zoom stands, for the
 * toolbar. Its maths is `camera.ts`'.
 *
 * The commit-phase snapshot reads the camera (`use-paint.ts`, invariant 1), and
 * what moves it reads the snapshot and calls the painter's apply:
 * {@link useCamera} holds the camera, and is made before the snapshot;
 * {@link useCameraMoves} holds what moves it, and is made after it.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { StringType, compareFor, equalFor } from "@elaraai/east";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import type { SchematicViewportStore } from "../area.js";
import { zoneInView } from "../index-tree.js";
import type { SchematicNarrowedLook } from "../narrowing.js";
import {
    type CameraEvent, type CameraMode, type RafCoalescer, type ViewTold, type Viewport,
    FLY_DURATION_MS, IDENTITY, cancelsFly, fitView, flyStep, makeRafCoalescer, nextMode, tellsAsItMoves, zoomAbout,
} from "./camera";
import type { DrawnItem, DrawnZone } from "./drawn";
import { cardContentWidth, type LodTier } from "./model";
import type { Paint } from "./use-paint";
import type { SchematicZoomRange } from "./view";

const stringEqual = equalFor(StringType);
const compareString = compareFor(StringType);

/** The zoom's least limit, from Fit: further only where the drawing's smallest item needs it to draw as a whole card. */
const MAX_ZOOM = 40;
/** The most px per world unit any zoom reaches, whatever an item's size asks: a bound on a degenerate item's width. */
const MAX_PPU = 4000;
/** How long the camera rests before the canvas tells the reader where its viewport is (#1393, CL6), in ms. */
const REST_READ_MS = 100;

/** How much room a fly leaves about the box it frames: the box at 1 / 1.18 of the canvas's width or height, whichever binds. */
const FLY_PAD = 1.18;

/** The world box a fly to a point frames: 8 × 6 units about it. */
export function pointFrame(p: { x: number; y: number }): { x: number; y: number; w: number; h: number } {
    return { x: p.x - 4, y: p.y - 3, w: 8, h: 6 };
}

/**
 * The world box a fly to an item frames (#1393): 8 × 6 units about its centre — or, for an item held to its own width
 * whose card that box shows too narrow for its words, the box about it at whose zoom its card draws whole
 * (`cardWhole`), so a step, Find's pick or the Index's lands on its card, as far as the zoom's limit reaches.
 *
 * @param item - The item
 * @param size - The canvas's size, in CSS px
 * @returns The world box
 */
export function itemFrame(item: DrawnItem, size: { readonly w: number; readonly h: number }): { x: number; y: number; w: number; h: number } {
    const width = getSomeorUndefined(item.width);
    if (width === undefined || !(width > 0)) return pointFrame(item);
    const needed = cardContentWidth(item) / width;
    const w = Math.min(8, size.w / (FLY_PAD * needed)), h = Math.min(6, size.h / (FLY_PAD * needed));
    return { x: item.x - w / 2, y: item.y - h / 2, w, h };
}

/** What {@link useCamera} reads. */
export interface CameraProps {
    /** The canvas's element: what its size is measured by. */
    readonly canvasRef: RefObject<HTMLDivElement | null>;
    /** The drawing's extent's width, in world units. */
    readonly W: number;
    /** The drawing's extent's height, in world units. */
    readonly H: number;
    /** The items drawn, a hidden layer's left out: the zoom's limit follows the smallest of them held to its own width. */
    readonly items: readonly DrawnItem[];
}

/**
 * The camera, as the canvas renders by it (see the module docs).
 *
 * @param props - The canvas's element, the drawing's extent and its items
 * @returns The canvas's size and its pixel ratio, the camera's live ref and its snapshot, the fit and Fit's camera, the
 *   zoom's px a world unit and its limit
 */
export function useCamera({ canvasRef, W, H, items }: CameraProps) {
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    useLayoutEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [canvasRef]);

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
    // holds only a throttled snapshot for derived UI — minimap, the LOD/culling
    // recompute — never updated per pointer event (issue #57, Phase 2
    // invariants 1–2).
    const cameraRef = useRef<Viewport>(IDENTITY);
    const [cameraSnapshot, setCameraSnapshot] = useState<Viewport>(IDENTITY);

    // The fit, and the camera Fit takes (#1393): the drawing inside the canvas less its margin, centred on both axes.
    const { fit, home } = useMemo(() => (size === null ? { fit: 0, home: IDENTITY } : fitView(size.w, size.h, W, H)), [size, W, H]);
    const ppu = fit * cameraSnapshot.zoom;
    // The zoom's limit (#1393, ruled 23 Oct 2026): 40× Fit, or further — until the drawing's smallest item held to its own
    // width draws as a whole card (`cardWhole`), however dense the floor.
    const maxZoom = useMemo(() => {
        if (fit === 0) return MAX_ZOOM;
        let needed = 0;
        for (const item of items) {
            const width = getSomeorUndefined(item.width);
            if (width !== undefined && width > 0) needed = Math.max(needed, cardContentWidth(item) / width);
        }
        return Math.max(MAX_ZOOM, Math.min(MAX_PPU, needed) / fit);
    }, [items, fit]);
    return { size, dpr, cameraRef, cameraSnapshot, setCameraSnapshot, fit, home, ppu, maxZoom };
}

/** The camera, as the canvas renders by it: {@link useCamera}'s. */
export type Camera = ReturnType<typeof useCamera>;

/** What {@link useCameraMoves} reads. */
export interface CameraMovesProps {
    /** The canvas's element: what the wheel is heard on. */
    readonly canvasRef: RefObject<HTMLDivElement | null>;
    /** The drawing's extent's width, in world units. */
    readonly W: number;
    /** The drawing's extent's height, in world units. */
    readonly H: number;
    /** The tier the zoom's band draws its items at: what the reader is told the viewport rests at. */
    readonly lod: LodTier;
    /** The zones drawn, a hidden layer's left out. */
    readonly shownZones: readonly DrawnZone[];
    /** What the narrowing takes out of every list and of the selection (#1392): the Index lists none of it. */
    readonly narrowedOut: ReadonlySet<string>;
    /** Told the zone the viewport is in, by its id — `undefined` for none — as that changes (#1389). */
    readonly onZoneInView: ((zone: string | undefined) => void) | undefined;
    /** Where the canvas writes its viewport as its camera comes to rest (#1393); `undefined`, it writes nowhere. */
    readonly viewport: SchematicViewportStore | undefined;
    /** Told whether the zoom stands at Fit and at its limit, as either changes (#1393). */
    readonly onZoomRange: ((range: SchematicZoomRange) => void) | undefined;
    /** How a narrowed-out row draws, and what the matches take: whether the camera flies to them. */
    readonly look: SchematicNarrowedLook;
    /** The narrowing's matches, by id (#1392). */
    readonly matches: ReadonlySet<string>;
    /** The camera ({@link useCamera}'s). */
    readonly camera: Camera;
    /** The commit-phase snapshot and the painter's apply (`use-paint.ts`). */
    readonly paint: Paint;
}

/**
 * What moves the camera, and what the camera tells as it moves (see the module docs).
 *
 * @param props - The canvas's element and the drawing's extent, what the camera tells and whom, the narrowing's look and
 *   its matches, the camera, and the snapshot and the painter's apply
 * @returns The frame applier, a press's draw of a frame still waiting, the mode machine's transition, the fly, Fit, a
 *   zoom about the middle, and the minimap's jump and whether it is dragged
 */
export function useCameraMoves({ canvasRef, W, H, lod, shownZones, narrowedOut, onZoneInView, viewport, onZoomRange, look, matches, camera, paint }: CameraMovesProps) {
    const { size, cameraRef, cameraSnapshot, setCameraSnapshot, fit, home, ppu, maxZoom } = camera;
    const { renderSnapRef, applyCamera } = paint;
    const modeRef = useRef<CameraMode>("idle");
    const animRef = useRef<number | null>(null);

    // The zone the viewport is in (#1389): the one covering most of it, kept until it clearly loses, none at the fit —
    // told the frame only as it changes, never at every frame of a pan — among the zones the Index lists, what the
    // narrowing takes out left out (#1392).
    const listedZones = useMemo(() => (narrowedOut.size === 0 ? shownZones : shownZones.filter(z => !narrowedOut.has(z.key))), [shownZones, narrowedOut]);
    const inViewRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (onZoneInView === undefined || size === null || ppu === 0) return;
        const view = {
            box: {
                minX: -cameraSnapshot.tx / ppu, minY: -cameraSnapshot.ty / ppu,
                maxX: (size.w - cameraSnapshot.tx) / ppu, maxY: (size.h - cameraSnapshot.ty) / ppu,
            },
            fitted: cameraSnapshot.zoom <= 1.05,
        };
        const next = zoneInView(listedZones, view, inViewRef.current);
        const was = inViewRef.current;
        if (next === undefined ? was === undefined : was !== undefined && stringEqual(next, was)) return;
        inViewRef.current = next;
        onZoneInView(next);
    }, [onZoneInView, size, ppu, cameraSnapshot, listedZones]);

    // --- Where the viewport rests (#1393): what a kind read by area reads its window around. ---
    // Told to the reader's store as the camera comes to rest — 100 ms without a move, or while it moves slower than a
    // viewport and zooms by less than a quarter each 200 ms, a fly never, as it lands where it flies (CL6) — rendering
    // nothing for it; the first at once, so the first window is read as the canvas opens.
    const toldRef = useRef<ViewTold | undefined>(undefined);
    useEffect(() => {
        if (viewport === undefined || size === null || ppu === 0) return undefined;
        const box = {
            minX: -cameraSnapshot.tx / ppu, minY: -cameraSnapshot.ty / ppu,
            maxX: (size.w - cameraSnapshot.tx) / ppu, maxY: (size.h - cameraSnapshot.ty) / ppu,
        };
        const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
        const tell = () => {
            viewport.set({ box, ppu, lod });
            toldRef.current = { at: performance.now(), ...centre, ppu };
        };
        const told = toldRef.current;
        if (told === undefined || viewport.get() === undefined) { tell(); return undefined; }
        const span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
        if (modeRef.current !== "flying" && tellsAsItMoves(told, { at: performance.now(), ...centre, ppu, span })) {
            tell();
            return undefined;
        }
        const timer = setTimeout(tell, REST_READ_MS);
        return () => clearTimeout(timer);
    }, [viewport, size, ppu, cameraSnapshot, lod]);

    // Coalesce many camera mutations within a frame into one paint + one
    // throttled snapshot — keeps the hot pan path off React (invariant 2). Each
    // frame is asked of the page's frame clock as it is then, as a fly's are, so
    // one clock runs every camera move: a test's own, when it runs one.
    const coalescerRef = useRef<RafCoalescer | null>(null);
    if (coalescerRef.current === null && typeof requestAnimationFrame !== "undefined") {
        coalescerRef.current = makeRafCoalescer((run) => requestAnimationFrame(run), (handle) => cancelAnimationFrame(handle));
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
    }, [applyCamera, cameraRef, setCameraSnapshot]);

    // The camera at Fit once the canvas takes its size (#1393), and again as its size moves while it stands there — a
    // pane opening beside it — so the drawing stays framed at Fit; a camera moved from Fit stays where it was moved.
    const homeRef = useRef<Viewport>(IDENTITY);
    useLayoutEffect(() => {
        if (fit === 0) return;
        const was = homeRef.current, cam = cameraRef.current;
        homeRef.current = home;
        if (cam.zoom !== was.zoom || cam.tx !== was.tx || cam.ty !== was.ty) return;
        cameraRef.current = home;
        requestRender();
    }, [fit, home, requestRender, cameraRef]);

    // The toolbar hears where the zoom stands (#1393): at Fit its Zoom out takes no press, at the limit its Zoom in.
    const zoomRangeRef = useRef<SchematicZoomRange | undefined>(undefined);
    useEffect(() => {
        if (onZoomRange === undefined || fit === 0) return;
        const range = { atFit: cameraSnapshot.zoom <= 1 + 1e-9, atLimit: cameraSnapshot.zoom >= maxZoom - 1e-9 };
        const was = zoomRangeRef.current;
        if (was !== undefined && was.atFit === range.atFit && was.atLimit === range.atLimit) return;
        zoomRangeRef.current = range;
        onZoomRange(range);
    }, [onZoomRange, fit, cameraSnapshot.zoom, maxZoom]);

    // A press meets what the canvas has drawn (invariant 9): a camera move still waiting on its frame — Fit, a zoom, the
    // wheel, a fly's last step — is drawn and committed first, so the culling, the tiers and the routes a press, a tap or
    // a double-click hit-tests are those of the camera it lands on, never the frame's before. Asked only as a press
    // lands: a move, a hover or a drag over the canvas waits for the frame as the drawing does.
    const drawPending = useCallback(() => {
        const snap = renderSnapRef.current;
        const cam = cameraRef.current;
        if (snap.size === null || (snap.camera.zoom === cam.zoom && snap.camera.tx === cam.tx && snap.camera.ty === cam.ty)) return;
        flushSync(() => { setCameraSnapshot({ zoom: cam.zoom, tx: cam.tx, ty: cam.ty }); });
    }, [renderSnapRef, cameraRef, setCameraSnapshot]);

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
        if (renderSnapRef.current.size === null || renderSnapRef.current.fit === 0) return;
        // Re-derive the destination from the LIVE viewport every frame, so a
        // resize mid-fly (a pane opening, a window resize) re-aims the landing
        // instead of framing against the stale start-time size/fit.
        const frame = (): Viewport | null => {
            const sz = renderSnapRef.current.size, ft = renderSnapRef.current.fit;
            if (sz === null || ft === 0) return null;
            const zoom = Math.min(renderSnapRef.current.maxZoom, Math.min(sz.w / (rect.w * FLY_PAD * ft), sz.h / (rect.h * FLY_PAD * ft)));
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
        // Each frame reads the clock the fly began on, never the frame's own stamp: a page stamps its frames on its frame
        // clock, which can stand before the gesture that began the fly, or — off a browser — on another origin (#1393).
        const step = () => {
            const elapsed = performance.now() - start;
            const target = frame();
            if (target !== null) {
                cameraRef.current = flyStep(from, target, elapsed);
                applyCamera();
                const cam = cameraRef.current;
                setCameraSnapshot({ zoom: cam.zoom, tx: cam.tx, ty: cam.ty });
            }
            if (elapsed < FLY_DURATION_MS) { animRef.current = requestAnimationFrame(step); }
            else { animRef.current = null; transition("flyEnd"); }
        };
        animRef.current = requestAnimationFrame(step);
    }, [applyCamera, transition, renderSnapRef, cameraRef, setCameraSnapshot]);

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
            const snap = renderSnapRef.current;
            cameraRef.current = zoomAbout(cameraRef.current, Math.exp(-e.deltaY * 0.0015), px, py, 1, snap.maxZoom, snap.home);
            requestRender();
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [transition, requestRender, canvasRef, renderSnapRef, cameraRef]);

    const resetView = useCallback(() => {
        transition("cancel");           // cancels a running fly via the mode machine
        cameraRef.current = renderSnapRef.current.home;
        requestRender();
    }, [transition, requestRender, cameraRef, renderSnapRef]);
    const zoomBy = useCallback((factor: number) => {
        const snap = renderSnapRef.current;
        const sz = snap.size;
        if (sz === null) return;
        transition("zoom");
        cameraRef.current = zoomAbout(cameraRef.current, factor, sz.w / 2, sz.h / 2, 1, snap.maxZoom, snap.home);
        requestRender();
    }, [transition, requestRender, renderSnapRef, cameraRef]);

    // Minimap is a camera writer (jump on press, follow on drag — invariant 8).
    const minimapDragRef = useRef(false);
    const minimapJump = useCallback((el: HTMLElement, clientX: number, clientY: number) => {
        const sz = renderSnapRef.current.size;
        if (sz === null) return;
        const rect = el.getBoundingClientRect();
        const cx = ((clientX - rect.left) / rect.width) * W;
        const cy = ((clientY - rect.top) / rect.height) * H;
        const cam = cameraRef.current;
        cameraRef.current = { ...cam, tx: sz.w / 2 - cx * renderSnapRef.current.fit * cam.zoom, ty: sz.h / 2 - cy * renderSnapRef.current.fit * cam.zoom };
        requestRender();
    }, [W, H, requestRender, renderSnapRef, cameraRef]);

    // Tear down any pending frame / fly on unmount.
    useEffect(() => () => {
        coalescerRef.current?.cancel();
        if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    }, [animRef]);

    // `fit` (§10.3): the camera flies to the matches whenever which they are changes — keyed on them, never on where
    // they are, so a zoom or a Move never flies it — and once the canvas has its size, so a narrowing a reload restores
    // is flown to too. A fly over nothing — the narrowing cleared — leaves the camera where it is.
    const fitSignature = useMemo(() => (look.fit && matches.size > 0 ? [...matches].sort(compareString).join("\u0000") : undefined), [look.fit, matches]);
    const sized = size !== null;
    useEffect(() => {
        if (fitSignature === undefined || !sized) return;
        const box = renderSnapRef.current.fitBox;
        if (box !== undefined) flyTo({ x: box.minX, y: box.minY, w: Math.max(box.maxX - box.minX, 1e-3), h: Math.max(box.maxY - box.minY, 1e-3) });
    }, [fitSignature, sized, flyTo, renderSnapRef]);
    return { requestRender, drawPending, transition, flyTo, resetView, zoomBy, minimapDragRef, minimapJump };
}

/** What moves the camera: {@link useCameraMoves}'s. */
export type CameraMoves = ReturnType<typeof useCameraMoves>;
