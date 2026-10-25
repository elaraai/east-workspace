/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's canvas (#1387): the 2D world-coordinate drawing in its
 * frame's main — a Canvas2D paint layer and a DOM card layer under one camera,
 * the minimap and the scale bar at its foot, the minimap the whole drawing,
 * wherever the view is (`minimap.ts`, #1393). It holds no control of its own:
 * the frame's toolbar holds the tools, the zoom, Fit, Find and the steps, and
 * drives the camera through this canvas's handle ({@link SchematicCanvasHandle});
 * the tool held and the link kind Connect draws are the frame's. What it draws
 * is its reader's (`data.ts`), each kind's rows as their roles give them, the
 * editing session's drafts in place (`drafted.ts`, #1388); what its layers
 * hide, lock and dim is the frame's (`layers.ts`). Every colour and font it
 * draws is the design system's, read through the theme bridge (`theme.tsx`).
 * Each card is a component of its own (`card.tsx`), told how it stands in
 * values, so a camera move — which renders the canvas a frame at a time —
 * renders no card whose standing holds (#1393).
 * Every gesture that writes — Move, Connect and its Shift session, Retarget,
 * Extend and Del — is one step of the editing's history: the gesture's edits
 * (`edits.ts`) recorded through the frame's editing, nothing held here but a
 * Move's preview while its drag is under way. The library's Index (#1389)
 * flies to a zone or an item and selects it through the handle, and hears
 * the canvas's selection and the zone its viewport is in. The inspector
 * (#1391) selects through it what Details and Issues name — a link or a net,
 * a net's leg among them — hears the selection with the leg a stub's tap
 * selected, and is opened on Details by Enter, or a double-click on an
 * entity.
 *
 * Where a tab of the library drops (#1390), the canvas is one drop cell of the
 * shared drag layer, on the frame's drop target (`use-drop.ts`): it works out
 * where a drag rests from its own drawing (`drop.ts`' `restsAt`) — the point
 * under the pointer, at the screen's resolution, for a card that adds or
 * places an item; the entity of the card's kind under it, never a locked
 * layer's, for one that lands on an entity — and, while the drop there lands,
 * marks it: a ring at the point, or the entity's drop mark. An item a drop
 * adds or places comes back through the handle's `select`, selected where it
 * stands; a card's ⏎ asks it for the view's centre. A Connect's new link or
 * net takes its other fields from the template of its kind the library has
 * selected (§4.3).
 *
 * Its links and nets draw in the shared links look (#1403): each ends on the
 * edges of the items it joins where they draw at the zoom — a card's side, as
 * the page lays the card out, a labelled pin's edge, a dot's rim — and the one
 * under the pointer lights, named in `data-lit-link`, while no gesture is under
 * way; a tap, a hover, a drop and a selected link's handles — named in
 * `data-link-handles` while they draw — meet each one's route as the painter
 * draws it, searched through the links' R-tree.
 *
 * Below 480px of main (#1394, D15) the canvas pans, pinches and selects: the
 * frame holds no Move or Connect and gives it no drop cell, and a selected
 * link draws no handle — the inspector moves, connects, re-targets, places and
 * deletes. The frame measures main by the canvas's element, which fills it.
 *
 * While a read is in flight (#1398) it washes the area the reads have not
 * drawn yet, under its grid, with no item's shape in it (CL2); a card whose
 * details are read keeps the places of the roles they give, a placeholder in
 * each, and a marker whose status is unread draws in the placeholders' fill —
 * each on its builder's reveal clock (CL4), which the painter hears with no
 * render; and a read that failed is said once, at the top-left in view of the
 * area it failed reading, with Retry (CL11). While what it draws stands in for
 * a new narrowing (CL8) it is kept — its grid's rules dashed, its words in the
 * third ink, its items' edges and marks as they were — and retained:
 * `aria-disabled`, panning and selecting, and taking no gesture that edits.
 *
 * Its gestures, its selection funnels, its camera and its paint path are the
 * ones `CLAUDE.md` holds to its invariants: no render-phase ref write, one
 * commit-phase snapshot, the paint's identity short-circuit, the fly before
 * the commit, and hit-testing that is the drawing.
 *
 * Each is a part of its own, holding the state it owns: the camera
 * (`use-camera.ts`), the gestures (`use-gestures.ts`), the selection
 * (`use-canvas-selection.ts`), the drop's cell (`use-canvas-drop.ts`), the
 * commit-phase snapshot and the painter's call (`use-paint.ts`) and the card
 * layer (`card-layer.tsx`). The snapshot reads every part's state, and every
 * part's behaviour reads the snapshot: this component makes each part's state
 * before the snapshot and its behaviour after it, over what the parts share —
 * the items a hidden layer leaves, their culling and their tiers, the links'
 * R-tree, the narrowing's look and a failed read's box.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import RBush from "rbush";
import { StringType, equalFor, type option } from "@elaraai/east";
import { getSomeorUndefined, type Origin } from "@elaraai/east-ui-components";
import { LoadingFailedBox, LoadingWash } from "@elaraai/east-ui-components/internal";
import { placedVertices, type SchematicPaintEffect } from "./paint";
import { parallelLanes as paintParallelLanes } from "./routes";
import { EMPTY_STRING_SET, type ItemBox, linkIndex } from "./selection";
import { type LodTier, type WorldBox, buildCenterTree, declutterTiers, matchesExtent, tierSize } from "./model";
import type { SchematicDrawn, SchematicRef } from "./drawn";
import { boxCss } from "./camera";
import { SchematicCardLayer } from "./card-layer";
import { SchematicProbe } from "./theme";
import type { SchematicLayerState } from "./layers";
import { minimapSize } from "./minimap";
import { itemFrame, pointFrame, useCamera, useCameraMoves } from "./use-camera";
import { useCanvasDrop, useCanvasDropMark } from "./use-canvas-drop";
import { useCanvasSelection, useSelectionSteps } from "./use-canvas-selection";
import { capturePointer, releasePointer, useGestureState, useGestures } from "./use-gestures";
import { RevealTell, niceScaleLength, usePaint } from "./use-paint";
import type { SchematicDensity, SchematicViewportStore } from "../area.js";
import { areaSlots, type SchematicValue } from "../data.js";
import { dropPoint, type SchematicCanvasDrop, type SchematicDropPoint } from "../drop.js";
import type { NetLeg, SchematicEdit } from "../edits.js";
import type { SchematicWords } from "../messages.js";
import type { SchematicNarrowedLook } from "../narrowing.js";
import type { SchematicTool } from "../tools.js";

const stringEqual = equalFor(StringType);

/** What the rail's narrowing does on the canvas (#1392, §10.3), each entity by its id. */
export interface SchematicCanvasNarrowing {
    /** What draws as context: faded, drained of colour or a bare marker. */
    readonly context: ReadonlySet<string>;
    /** What never selects, by any path: the context, and a link or a net whose ends the narrowing hides. */
    readonly out: ReadonlySet<string>;
    /** The matches: what emphasis rings, the frame boxes and fit flies to. */
    readonly matches: ReadonlySet<string>;
    /** How context draws, and what the matches take. */
    readonly look: SchematicNarrowedLook;
}

/** A dot's half-extent the frame wraps, in screen px: its marker and its touch slop. */
const DOT_FRAME_PX = 10;

type SlotStyles = Record<string, SystemStyleObject>;
type Pt = { x: number; y: number };

/**
 * How the canvas records its gestures (#1388): the Schematic's editing, which
 * writes each gesture's edits as one step of its history.
 */
export interface SchematicCanvasEditing {
    /**
     * Records one gesture's edits as one step.
     *
     * @param edits - The rows it changes, and how
     * @param origin - The gesture
     * @param label - Its label in the history
     * @returns Whether anything was recorded
     */
    readonly record: (edits: readonly SchematicEdit[], origin: Origin, label: string) => boolean;
    /**
     * A new row's key: unique among every key the Schematic has read and drafted of the kind, and those given.
     *
     * @param slot - The kind's slot
     * @param minted - The keys the gesture has minted already
     * @returns The key
     */
    readonly mint: (slot: string, minted: ReadonlySet<string>) => string;
}

/** LOD thresholds in px per world unit: card ⇢ labelled dot ⇢ dot. */
const LOD_CARD_PPU = 30;
const LOD_LABEL_PPU = 16;
/** Item-count threshold for the minimap default. */
const MINIMAP_AUTO = 25;
/** No kind drawing its density. */
const NO_DENSITY: ReadonlyMap<string, SchematicDensity> = new Map();
/** No item's centre: what the declutter is given at the dots' zoom, where it reads none. */
const NO_CENTERS = buildCenterTree([]);
/** Nothing unread. */
const NO_UNREAD: readonly WorldBox[] = [];
/** How far inside the area it failed reading a failure's message box sits, from its top-left in view (CL11), in px — and its least room from the canvas's right. */
const FAILED_INSET_PX = 16;

/** What the frame drives the camera and the selection by: its toolbar's zoom, Fit, Find and steps, and the library's Index. */
export interface SchematicCanvasHandle {
    /** Zooms about the canvas's middle by a factor. */
    zoomBy(factor: number): void;
    /** Fits the drawing in view. */
    fit(): void;
    /** Steps the selection to the previous item, or the next, flying to it. */
    step(delta: 1 | -1): void;
    /**
     * Flies to an entity, by its id, and selects it alone: Find's pick and the Index's (#1389) — an item or a zone —
     * and the inspector's (#1391), which also names a link or a net, and a net's leg with it. `undefined` selects
     * nothing, the camera where it is.
     */
    reveal(id: string | undefined, leg?: NetLeg): void;
    /**
     * Selects an item, by its id, once the drawing draws it — the item a drop added or placed (#1390): selected where it
     * stands, the camera where it is. One the next drawing doesn't draw — its layer hidden, the rail narrowing it out —
     * selects nothing.
     */
    select(id: string): void;
    /** The view's centre, at the screen's resolution: where a card's ⏎ adds or places an item (#1390); `undefined` while the canvas has no size. */
    centre(): SchematicDropPoint | undefined;
    /**
     * Flies to a world point, framing the 8 × 6 units a fly to an item frames about it, and selects nothing: where Find's
     * pick lands on an item the canvas doesn't draw as itself — the rail's filters hide it, or its layer does (#1404).
     */
    look(x: number, y: number): void;
}

/** Props of {@link SchematicCanvas}. */
export interface SchematicCanvasProps {
    /** The payload, decoded. */
    readonly value: SchematicValue;
    /** What the canvas draws: its reader's stored rows, the editing session's drafts in place (#1388). */
    readonly data: SchematicDrawn;
    /** What the layers hide, lock and dim. */
    readonly layers: SchematicLayerState;
    /** What the rail's narrowing does (#1392): what draws as context, what never selects, and the matches. */
    readonly narrowing: SchematicCanvasNarrowing;
    /** The tool held. */
    readonly tool: SchematicTool;
    /** The link kind Connect draws; `undefined` where no link kind is editable. */
    readonly linkKind: string | undefined;
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /** How the canvas records its gestures; `undefined` where no record is edited. */
    readonly editing: SchematicCanvasEditing | undefined;
    /** Told why a gesture was refused — a Delete a read-only link or net blocks — or, `undefined`, that one has been recorded since. */
    readonly onRefused: (words: string | undefined) => void;
    /**
     * Told what is selected — the items, the zones, and the link or the net — by their ids, and the net's leg when a
     * stub is selected (#1391), as that changes.
     */
    readonly onSelection: (ids: ReadonlySet<string>, leg: NetLeg | null) => void;
    /** Told when Enter, or a double-click on an entity, opens the selection in the inspector's Details (#1391, D34); `undefined` with no inspector. */
    readonly onOpen?: (() => void) | undefined;
    /** Told the zone the viewport is in, by its id — `undefined` for none — as that changes (#1389): the Index marks it. */
    readonly onZoneInView?: ((zone: string | undefined) => void) | undefined;
    /** The canvas's drop cell, where a tab of the library drops (#1390); `undefined`, it takes no drop. */
    readonly drop?: SchematicCanvasDrop | undefined;
    /**
     * What a Connect's new link or net takes its other fields from, by its kind's slot (§4.3, #1390): the values of the
     * template of that kind the library has selected; `none`, their types' defaults.
     */
    readonly connectValues: (slot: string) => option<Uint8Array>;
    /**
     * Where the canvas writes its viewport as its camera comes to rest (#1393): what a kind read by area reads its window
     * around; `undefined`, it writes nowhere.
     */
    readonly viewport?: SchematicViewportStore | undefined;
    /** Each kind read by area drawing its density in place of its items (D25), by its slot: the raster painted under them. */
    readonly density?: ReadonlyMap<string, SchematicDensity> | undefined;
    /** Each kind read by area's whole drawing's density, by its slot: what the minimap draws of it, wherever the view is (#1393). */
    readonly overview?: ReadonlyMap<string, SchematicDensity> | undefined;
    /** Whether a read the drawing needs is in flight: an item a drop or a pick asks to select is waited for until it lands. */
    readonly reading?: boolean | undefined;
    /** What the reads in flight have not drawn yet, in world units, as disjoint boxes (#1398, CL2): washed, under the grid, until they land. */
    readonly unread?: readonly WorldBox[] | undefined;
    /** A read that failed, said once where it happened (CL11), with Retry; `undefined` while none has. */
    readonly failure?: SchematicCanvasFailure | undefined;
    /**
     * Whether what it draws stands in for a new narrowing while that is read (#1398, the loading design's retained card):
     * kept — its grid's rules dashed and its words, a card's, a pin's and a caption's, in the third ink — its items' edges
     * and marks as they were.
     */
    readonly stale?: boolean | undefined;
    /**
     * Whether what it draws is retained (#1398, CL8): readable, focusable and selectable — a press pans and a tap selects
     * — and taking no gesture that edits: no Move, Connect, re-target or Del, a selected link's handles gone, and no drop
     * on its cell. It is `aria-disabled` but while a read's failure is said on it, its Retry in it.
     */
    readonly retained?: boolean | undefined;
    /** Told whether the zoom stands at Fit and at its limit, as either changes (#1393): the toolbar's Zoom out and Zoom in take no press there. */
    readonly onZoomRange?: ((range: SchematicZoomRange) => void) | undefined;
    /**
     * Whether main is below 480px (#1394, D15): the canvas pans, pinches and selects, and a selected link draws no handle
     * and takes no re-target's drag — the inspector's ends re-target it. The frame offers no Move or Connect there, and
     * gives the canvas no drop cell.
     */
    readonly narrow?: boolean | undefined;
    /** Hears the canvas's element as it mounts, and `null` as it goes (#1394): the canvas fills main, whose width the frame measures by it. */
    readonly onElement?: ((element: HTMLDivElement | null) => void) | undefined;
    /** The canvas's handle, the frame's. */
    readonly ref?: Ref<SchematicCanvasHandle> | undefined;
}

/**
 * A read that failed, as the canvas says it once where it happened (#1398, CL11): in the message box, at the top-left in
 * view of the area it failed reading, with Retry.
 */
export interface SchematicCanvasFailure {
    /** Its words: `Couldn't read this area`, or the kind's or the drawing's, `Couldn't read racks`. */
    readonly message: string;
    /** Asks it again. */
    readonly retry: () => void;
    /** The area it failed reading, in world units; `undefined` for a kind read whole, or the drawing's read — said at the canvas's top-left. */
    readonly area: readonly WorldBox[] | undefined;
}

/** Where the zoom stands (#1393): at Fit, where Zoom out does nothing, and at its limit, where Zoom in does nothing. */
export interface SchematicZoomRange {
    /** Whether it stands at Fit. */
    readonly atFit: boolean;
    /** Whether it stands at its limit. */
    readonly atLimit: boolean;
}

/**
 * The Schematic's canvas (see the module docs): map-grade navigation — wheel
 * zoom about the cursor, drag pan, animated fly-to, semantic zoom (status dots
 * ⇢ labelled dots ⇢ full cards), rbush viewport culling, an adaptive scale bar
 * and a minimap with a draggable viewport — and its gestures, each one step of
 * the editing's history.
 */
export const SchematicCanvas = memo(function SchematicCanvas({
    value, data, layers, narrowing, tool, linkKind, words, editing, onRefused, onSelection, onOpen, onZoneInView, drop, connectValues,
    viewport, density = NO_DENSITY, overview = NO_DENSITY, reading = false, unread = NO_UNREAD, failure, stale = false, retained = false, onZoomRange,
    narrow = false, onElement, ref,
}: SchematicCanvasProps) {
    // The recipe's styles, resolved once a recipe: the canvas renders at every frame its camera moves.
    const recipe = useSlotRecipe({ key: "schematic" });
    const styles = useMemo(() => recipe() as SlotStyles, [recipe]);
    const { width: W, height: H } = value.extent;
    // What never selects, by any path — a tap, the marquee, the steps, a drop, a reveal — and lets go of what is
    // selected: a locked layer's entities (SC27), and what the narrowing takes out, its context among them (#1392).
    const { context, out: narrowedOut, matches, look } = narrowing;
    const inertKeys = useMemo(() => (narrowedOut.size === 0 ? layers.locked : new Set([...layers.locked, ...narrowedOut])), [layers.locked, narrowedOut]);

    const scaleUnit = getSomeorUndefined(value.scaleUnit);
    const showGrid = getSomeorUndefined(value.grid) ?? true;
    // Shown by default from 25 items — and for a kind read by area, whose drawing is past any count of items its window
    // holds, its whole drawing's density the minimap's (D25, #1393).
    const showMinimap = getSomeorUndefined(value.minimap) ?? (data.items.length >= MINIMAP_AUTO || density.size > 0 || overview.size > 0);

    // Each entity's reference by its id on the canvas: what the host hears an
    // entity named by — the links and nets drafted among them, each under its
    // kind's slot and its minted key (#1401, D34).
    const refById = useMemo(() => {
        const refs = new Map<string, SchematicRef>();
        for (const entity of [...data.items, ...data.zones, ...data.links, ...data.nets]) refs.set(entity.key, entity.ref);
        return refs;
    }, [data.items, data.zones, data.links, data.nets]);
    // Each item's label by its id: what a refusal's words name it by.
    const labelById = useMemo(() => new Map(data.items.map((item) => [item.key, item.label] as const)), [data.items]);

    // What is selected — its items, its zones, and its link or net — through its funnels, heard once after each gesture
    // (`use-canvas-selection.ts`).
    const canvasSelection = useCanvasSelection({ value, refById, onSelection });
    const { selectedLink, selected, commitSelection, commitLinkSelection, commitZoneSelection } = canvasSelection;
    // The gestures' state (`use-gestures.ts`): the tool in force, a Move's preview, Connect's draft and its flash, the box
    // in flight and the link lit.
    const gestureState = useGestureState({ value, tool, narrow, retained, refById, selectedLink, selected });
    const { lit, setLit, selectedLinkEditable, dragMoves, setTempTool, effectiveTool, connectDraft, selRect, marqueeCount } = gestureState;
    // Where a library card's drag rests over the canvas, marked (`use-canvas-drop.ts`).
    const { dragging, dropMark, setDropMark } = useCanvasDropMark();
    // A Move's preview (`use-gestures.ts`' `dragMoves`), applied UPSTREAM of the working set (invariant 4).
    const movedItems = useMemo(() => {
        if (dragMoves.size === 0) return data.items;
        return data.items.map(it => {
            const m = dragMoves.get(it.key);
            return m !== undefined ? { ...it, x: m.x, y: m.y } : it;
        });
    }, [data.items, dragMoves]);
    // The ONE seam into the painter: what the canvas draws, its items where a
    // Move's preview has them. Built over the drawing's identity, so a
    // closure-only change never repaints.
    const paintValue = useMemo(() => (dragMoves.size > 0 ? { ...data, items: movedItems } : data), [data, movedItems, dragMoves]);

    // --- Layers: what the frame's layer state hides, locks and dims. ----------
    const layerHiddenKeys = layers.hidden;
    const lockedKeys = layers.locked;
    const layerAlpha = layers.alpha;

    // The item working set: layer-hidden is a HARD pre-filter (an off layer means
    // "not at all"). Propagates for free to centers / rbush index / visibleItems /
    // LOD / the stepping order.
    const items = useMemo(() => {
        if (layerHiddenKeys.size === 0) return movedItems;
        return movedItems.filter(it => !layerHiddenKeys.has(it.key));
    }, [movedItems, layerHiddenKeys]);

    // Zones are read at several surfaces (minimap, labels, the stepping order);
    // drop hidden-layer zones once here. Links are filtered inside paint.
    const shownZones = useMemo(
        () => layerHiddenKeys.size === 0 ? data.zones : data.zones.filter(z => !layerHiddenKeys.has(z.key)),
        [data.zones, layerHiddenKeys],
    );
    // What the minimap draws (#1393): the whole drawing — each kind read by area as its whole drawing's density, never only
    // the items its window holds, and each item of a kind read whole as a dot (`minimap.ts`).
    const areaKinds = useMemo(() => areaSlots(value), [value]);
    const minimapItems = useMemo(() => items.filter((item) => !areaKinds.has(item.ref.kind)), [items, areaKinds]);
    const minimapDensities = useMemo(() => [...overview.values()], [overview]);
    const minimapCells = useMemo(() => minimapDensities.reduce((n, raster) => n + raster.cells.length, 0), [minimapDensities]);

    const canvasRef = useRef<HTMLDivElement | null>(null);
    // The camera: its live ref and its snapshot, the canvas's size and its pixel ratio, Fit's camera and the zoom's limit
    // (`use-camera.ts`).
    const camera = useCamera({ canvasRef, W, H, items });
    const { size, cameraRef, cameraSnapshot, ppu } = camera;

    // The minimap's size: the drawing at its aspect, 150px wide at most, and no more than a quarter of the canvas's width
    // or a third of its height, so a phone's keeps to its corner (#1393).
    const minimapBox = useMemo(() => (size === null ? undefined : minimapSize(size, { width: W, height: H })), [size, W, H]);

    const centers = useMemo(() => {
        const out = new Map<string, Pt>();
        for (const item of items) out.set(item.key, { x: item.x, y: item.y });
        return out;
    }, [items]);
    // Each item drawn, by its id: what a link's end is worked out over (#1403).
    const itemById = useMemo(() => new Map(items.map((item) => [item.key, item] as const)), [items]);

    // The links' lanes (#180), as the painter fans them, and the links' R-tree (#1403): what a hover, a tap and a drop
    // search for the link or the net under a point, so a pointer's move costs what is near it, never every link.
    const lanes = useMemo(() => paintParallelLanes(data.links, l =>
        !layerHiddenKeys.has(l.key) && centers.has(l.from) && centers.has(l.to) && l.via.length === 0), [data.links, layerHiddenKeys, centers]);
    const linkTree = useMemo(() => linkIndex(data.links, data.nets, centers, layerHiddenKeys, lanes), [data.links, data.nets, centers, layerHiddenKeys, lanes]);
    const linkById = useMemo(() => new Map(data.links.map((link) => [link.key, link] as const)), [data.links]);
    const netById = useMemo(() => new Map(data.nets.map((net) => [net.key, net] as const)), [data.nets]);
    // The link lit, while it still draws and takes the pointer: one gone, hidden, locked or out of the narrowing lights nothing.
    const litShown = lit !== undefined && (linkById.has(lit) || netById.has(lit)) && !layerHiddenKeys.has(lit) && !inertKeys.has(lit) ? lit : undefined;

    // World-resolved connect visuals (#176): the draft edge (from the item it
    // runs from to the cursor or the target it snaps to, each named, so the
    // painter ends it on their edges, #1403) and the open session's edges.
    const connectDraftWorld = useMemo(() => {
        if (connectDraft === null) return undefined;
        const from = centers.get(connectDraft.from);
        if (from === undefined) return undefined;
        const to = connectDraft.target !== undefined ? (centers.get(connectDraft.target) ?? connectDraft.toWorld) : connectDraft.toWorld;
        return {
            from, to, fromKey: connectDraft.from, snapped: connectDraft.target !== undefined,
            ...(connectDraft.target !== undefined ? { toKey: connectDraft.target } : {}),
            ...(connectDraft.forbidden !== undefined ? { forbiddenKey: connectDraft.forbidden } : {}),
        };
    }, [connectDraft, centers]);
    // The link a retarget moves, drawn as its `was` line while its end is dragged (#1403).
    const wasLink = connectDraft?.retarget;
    // Spatial index for viewport culling (item half-extent ~2.4 world units
    // covers the widest constant-size marker at the card threshold).
    const index = useMemo(() => {
        const tree = new RBush<ItemBox>();
        tree.load(items.map(item => {
            const hw = (getSomeorUndefined(item.width) ?? 0) / 2 + 2.4;
            const hh = (getSomeorUndefined(item.height) ?? 0) / 2 + 2;
            let minX = item.x - hw, minY = item.y - hh, maxX = item.x + hw, maxY = item.y + hh;
            // A footprint can reach past the marker box — union its world
            // bbox in so the shape isn't culled when the anchor leaves view.
            const fp = getSomeorUndefined(item.footprint);
            if (fp !== undefined && fp.type === "circle") {
                const r = fp.value.radius;
                minX = Math.min(minX, item.x - r); minY = Math.min(minY, item.y - r);
                maxX = Math.max(maxX, item.x + r); maxY = Math.max(maxY, item.y + r);
            } else if (fp !== undefined && fp.type !== "rect") {
                // Its vertices are offsets from the item's centre (D22).
                for (const v of placedVertices(item, fp.value.vertices)) {
                    minX = Math.min(minX, v.x); minY = Math.min(minY, v.y);
                    maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y);
                }
            }
            return { minX, minY, maxX, maxY, item };
        }));
        return tree;
    }, [items]);

    const visibleItems = useMemo(() => {
        if (size === null || ppu === 0) return [];
        return index.search({
            minX: -cameraSnapshot.tx / ppu, minY: -cameraSnapshot.ty / ppu,
            maxX: (size.w - cameraSnapshot.tx) / ppu, maxY: (size.h - cameraSnapshot.ty) / ppu,
        }).map(b => b.item);
    }, [index, size, ppu, cameraSnapshot]);

    const lod: LodTier = ppu >= LOD_CARD_PPU ? "card" : ppu >= LOD_LABEL_PPU ? "label" : "dot";

    // --- A read that failed (#1398, CL11): said once, at the top-left in view of the area it failed reading. ---
    // The area's first box in view, topmost then leftmost, at its top-left — the canvas's own for a read with no area —
    // inset; none while the area is out of view, the footer's line saying it still. Its box measured as it lays out, so
    // it stays inside the canvas however near its right edge the area begins.
    const [failedWidth, setFailedWidth] = useState(0);
    const failedAt = useMemo(() => {
        if (failure === undefined || size === null || ppu === 0) return undefined;
        let at: { x: number; y: number } | undefined;
        if (failure.area === undefined) at = { x: 0, y: 0 };
        else {
            const view = {
                minX: -cameraSnapshot.tx / ppu, minY: -cameraSnapshot.ty / ppu,
                maxX: (size.w - cameraSnapshot.tx) / ppu, maxY: (size.h - cameraSnapshot.ty) / ppu,
            };
            for (const box of failure.area) {
                const minX = Math.max(box.minX, view.minX), minY = Math.max(box.minY, view.minY);
                if (minX >= Math.min(box.maxX, view.maxX) || minY >= Math.min(box.maxY, view.maxY)) continue;
                const sx = minX * ppu + cameraSnapshot.tx, sy = minY * ppu + cameraSnapshot.ty;
                if (at === undefined || sy < at.y || (sy === at.y && sx < at.x)) at = { x: sx, y: sy };
            }
        }
        if (at === undefined) return undefined;
        const left = Math.max(FAILED_INSET_PX, Math.min(at.x + FAILED_INSET_PX, size.w - FAILED_INSET_PX - failedWidth));
        return { top: at.y + FAILED_INSET_PX, left };
    }, [failure, size, ppu, cameraSnapshot, failedWidth]);
    useLayoutEffect(() => {
        const box = failedAt === undefined ? null : canvasRef.current?.querySelector<HTMLElement>("[data-loading-failed-box]") ?? null;
        const width = box === null ? 0 : box.offsetWidth;
        if (width !== failedWidth) setFailedWidth(width);
    }, [failedAt, failedWidth]);

    // Every item drawn by its centre — never only the viewport's: what an item keeps clear of, so a pan never changes
    // what it draws as (#1393). Built only where the declutter reads it: at the dots' zoom every item is a dot, and a
    // window of thousands of rows lands there.
    const dotZoom = lod === "dot";
    const centerTree = useMemo(() => (dotZoom ? NO_CENTERS : buildCenterTree(items)), [items, dotZoom]);
    const tiers = useMemo(() => {
        const base = declutterTiers(visibleItems, centerTree, lod, ppu, selected);
        // `dot` (§10.3): what draws as context is a bare marker, so the matches stand out.
        if (look.dot) for (const key of context) if (base.has(key)) base.set(key, "dot");
        return base;
    }, [visibleItems, centerTree, lod, ppu, selected, look.dot, context]);

    // --- The narrowing (#1392, §10.3): context faded, the matches ringed, framed and flown to. ---
    // The matches the canvas draws: what the frame boxes, at the zoom — each item by what it draws as, a card, a pin or
    // a dot — a frame wrapping two at least, as a lone match needs no box.
    const frameRect = useMemo(() => {
        if (!look.frame || ppu === 0) return undefined;
        const spanned = matchesExtent({ ...paintValue, items }, matches, layerHiddenKeys, centers, (item) => {
            const px = lod === "dot" ? { w: DOT_FRAME_PX, h: DOT_FRAME_PX } : { w: tierSize(item, lod, ppu).w / 2 + 2, h: tierSize(item, lod, ppu).h / 2 + 2 };
            return { w: px.w / ppu, h: px.h / ppu };
        });
        return spanned !== undefined && spanned.count >= 2 ? spanned.box : undefined;
    }, [look.frame, paintValue, items, matches, layerHiddenKeys, centers, lod, ppu]);
    // What fit flies to: the matches' world box, each item by its own box — a lone item's at least the 8 × 6 a fly to
    // an item frames.
    const fitBox = useMemo(() => {
        if (!look.fit) return undefined;
        const spanned = matchesExtent({ ...paintValue, items }, matches, layerHiddenKeys, centers, (item) => ({
            w: Math.max((getSomeorUndefined(item.width) ?? 0) / 2, 4), h: Math.max((getSomeorUndefined(item.height) ?? 0) / 2, 3),
        }));
        return spanned?.box;
    }, [look.fit, paintValue, items, matches, layerHiddenKeys, centers]);
    // What the painter draws of it, but the pulse's phase, which its ticker moves without a render: engaged while it
    // draws anything — context, or a match to ring or frame.
    const ringed = look.emphasis !== undefined && matches.size > 0;
    const paintEffect = useMemo((): Omit<SchematicPaintEffect, "pulsePhase"> | undefined => {
        if (context.size === 0 && !ringed && frameRect === undefined) return undefined;
        return {
            excluded: context, excludedOpacity: look.opacity, excludedDesaturate: look.desaturate,
            matches, emphasis: ringed ? look.emphasis : undefined, frame: frameRect,
        };
    }, [context, ringed, frameRect, look.opacity, look.desaturate, look.emphasis, matches]);

    const scaleLen = ppu > 0 ? niceScaleLength(ppu, 100) : 0;

    // The commit-phase snapshot, the paint's identity short-circuit and the painter's call (`use-paint.ts`).
    const paint = usePaint({
        value, data, paintValue, visibleItems, tiers, centers, layerHiddenKeys, layerAlpha, connectDraftWorld, litShown, wasLink, dropMark, paintEffect, fitBox,
        density, stale, retained, showMinimap, minimapBox, shownZones, minimapDensities, minimapItems, look, matches, camera, canvasSelection, gestureState,
    });
    const {
        drawRef, cardSizesRef, cardLayerRef, gridRef, washLayerRef, tintIndex, probeRef, renderSelected, renderSnapRef, applyCamera, onReveal, minimapPaintRef,
    } = paint;
    // What moves the camera, and what the camera tells as it moves (`use-camera.ts`).
    const cameraMoves = useCameraMoves({ canvasRef, W, H, lod, shownZones, narrowedOut, onZoneInView, viewport, onZoomRange, look, matches, camera, paint });
    const { transition, flyTo, resetView, zoomBy, minimapDragRef, minimapJump } = cameraMoves;
    // What keeps the selection to the drawing, and the steps through its items (`use-canvas-selection.ts`).
    const selectionSteps = useSelectionSteps({ data, layers, inertKeys, narrowedOut, items, shownZones, reading, canvasSelection, renderSnapRef, flyTo });
    const { clearZoneSelection, flyToItem, stepSelection, pendingSelectRef, setSelectAsked } = selectionSteps;
    // The gestures' handlers (`use-gestures.ts`): the pointer's over the mode machine, the keys and the taps.
    const {
        hoveredRef, onCanvasKeyDown, itemKeyAt, zoneKeyAt, linkKeyAt, onCanvasPointerDown, onCanvasPointerMove, onCanvasPointerUp, onCanvasPointerCancel,
        onCanvasDoubleClick,
    } = useGestures({
        value, data, layers, tool, linkKind, words, editing, onRefused, onOpen, connectValues, W, H, canvasRef, refById, labelById, inertKeys, narrowedOut,
        shownZones, visibleItems, tiers, lod, index, itemById, lanes, linkTree, linkById, netById, dragging, canvasSelection, selectionSteps, camera,
        cameraMoves, paint, gestureState,
    });
    // The canvas's drop cell: where a library card's drag rests over it, marked (`use-canvas-drop.ts`).
    const dropCell = useCanvasDrop({ value, drop, canvasRef, refById, inertKeys, size, cameraRef, renderSnapRef, itemKeyAt, zoneKeyAt, linkKeyAt, setDropMark });
    const setCanvasElement = useCallback((el: HTMLDivElement | null) => {
        canvasRef.current = el;
        dropCell(el);
        onElement?.(el);
    }, [dropCell, onElement]);

    // The frame's toolbar drives the camera and the selection through the handle:
    // its zoom, Fit, its steps and Find's pick, which flies to an item and selects it.
    useImperativeHandle(ref, () => ({
        zoomBy,
        fit: resetView,
        step: (delta) => stepSelection(delta),
        reveal: (id, leg) => {
            // Nothing: the selection let go, the camera where it is (#1391).
            if (id === undefined) {
                commitSelection(EMPTY_STRING_SET);
                clearZoneSelection();
                commitLinkSelection(null);
                return;
            }
            // An entity on a locked layer, or the narrowing takes out, is flown to and never selected (SC27, #1392).
            const item = items.find(it => stringEqual(it.key, id));
            if (item !== undefined) {
                const size = renderSnapRef.current.size;
                if (inertKeys.has(item.key)) flyTo(size === null ? pointFrame(item) : itemFrame(item, size));
                else flyToItem(item);
                return;
            }
            // A zone: the camera flies to its box, and the zone alone is selected (#1389).
            const zone = shownZones.find(z => stringEqual(z.key, id));
            if (zone !== undefined) {
                flyTo({ x: zone.x, y: zone.y, w: zone.width, h: zone.height });
                if (inertKeys.has(zone.key)) return;
                commitSelection(EMPTY_STRING_SET);
                commitLinkSelection(null);
                commitZoneSelection(new Set([zone.key]));
                return;
            }
            // A link or a net (#1391): the camera flies to the box its items and its waypoints span, and it alone is
            // selected — a net's leg with it. One on a hidden layer is drawn nowhere, and goes unselected.
            const link = data.links.find(l => stringEqual(l.key, id));
            const net = link === undefined ? data.nets.find(n => stringEqual(n.key, id)) : undefined;
            if ((link === undefined && net === undefined) || layerHiddenKeys.has(id)) return;
            const members = link !== undefined ? [link.from, link.to] : [...net!.sources, ...net!.destinations];
            const points = [...members.flatMap(m => { const c = centers.get(m); return c === undefined ? [] : [c]; }), ...(link ?? net!).via];
            if (points.length > 0) {
                const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
                const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
                const w = Math.max(maxX - minX, 8), h = Math.max(maxY - minY, 6);
                flyTo({ x: (minX + maxX - w) / 2, y: (minY + maxY - h) / 2, w, h });
            }
            if (inertKeys.has(id)) return;
            commitSelection(EMPTY_STRING_SET);
            clearZoneSelection();
            commitLinkSelection({ key: id, leg: leg ?? null });
        },
        select: (id) => {
            // Asked as the drop records itself: its item draws in the drawing that holds its draft.
            pendingSelectRef.current = { id, seen: renderSnapRef.current.drawn };
            setSelectAsked((n) => n + 1);
        },
        centre: () => {
            const snap = renderSnapRef.current;
            if (snap.size === null || snap.fit === 0) return undefined;
            const cam = cameraRef.current;
            const ppuLive = snap.fit * cam.zoom;
            return dropPoint({ x: (snap.size.w / 2 - cam.tx) / ppuLive, y: (snap.size.h / 2 - cam.ty) / ppuLive }, ppuLive);
        },
        look: (x, y) => flyTo(pointFrame({ x, y })),
    }), [zoomBy, resetView, stepSelection, items, inertKeys, flyToItem, shownZones, flyTo, commitSelection, commitLinkSelection, commitZoneSelection,
        clearZoneSelection, data.links, data.nets, centers, layerHiddenKeys, renderSnapRef, cameraRef, pendingSelectRef, setSelectAsked]);

    return (
        <Box
            ref={setCanvasElement}
            css={styles.canvas}
            data-schematic-canvas=""
            data-tool={effectiveTool}
            data-lod={lod}
            // What stands in for a new narrowing (#1398): kept, as the recipe draws it, and retained — readable, focusable
            // and selectable, taking no edit — but while a failure is said on it, its Retry in it.
            {...(stale ? { "data-schematic-stale": "" } : {})}
            {...(retained && failure === undefined ? { "aria-disabled": true } : {})}
            {...(litShown !== undefined ? { "data-lit-link": litShown } : {})}
            {...(selectedLinkEditable && selectedLink !== null ? { "data-link-handles": selectedLink.key } : {})}
            {...(connectDraft?.forbidden !== undefined ? { "data-forbidden": "" } : {})}
            tabIndex={0}
            role="application"
            aria-label={words.m.canvasLabel()}
            onKeyDown={onCanvasKeyDown}
            onPointerEnter={() => { hoveredRef.current = true; }}
            onPointerLeave={() => { hoveredRef.current = false; setTempTool(null); setLit(undefined); }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerCancel}
            onLostPointerCapture={onCanvasPointerCancel}
            onDoubleClick={onCanvasDoubleClick}
        >
            {/* The theme bridge's probe: what the canvas reads its colours and fonts from (#1387). */}
            <SchematicProbe tints={tintIndex.specs} signature={tintIndex.signature} probeRef={probeRef} />
            {/* The builder's reveal, which the painted placeholders show by (#1398, CL4). */}
            <RevealTell onReveal={onReveal} />
            {/* The area the reads in flight have not drawn yet (#1398, CL2): the shared wash, under the grid, each box placed
                by the camera's custom properties as a card is, so a pan moves it with no render. */}
            {size !== null && (
                <Box ref={washLayerRef} css={styles.washLayer} data-schematic-unread={unread.length} aria-hidden="true">
                    {unread.map((box, i) => <LoadingWash key={i} geometry={boxCss(box)} />)}
                </Box>
            )}
            {/* Grid size/position are driven imperatively by applyCamera so
                they stay locked to the same camera frame as the canvas. */}
            {showGrid && size !== null && <Box ref={gridRef} css={styles.grid} data-schematic-grid="" />}
            {size !== null && (
                <>
                    <chakra.canvas ref={drawRef} css={styles.paint} />
                    {/* Card layer holds the live `--cam-*` vars (set by
                        applyCamera); each card translates off them, so a
                        camera change is 3 var writes on this parent, never a
                        per-card React re-layout (issue #57, invariant 6). It
                        holds the widest card too, which the recipe reads. */}
                    <SchematicCardLayer cardLayerRef={cardLayerRef} styles={styles} visibleItems={visibleItems} tiers={tiers} lod={lod} context={context}
                        look={look} matches={matches} renderSelected={renderSelected} lockedKeys={lockedKeys} layerAlpha={layerAlpha}
                        connectDraft={connectDraft} dropMark={dropMark} centers={centers} cardSizesRef={cardSizesRef} applyCamera={applyCamera} />
                    {/* Drag box overlay — zoom (#153) or marquee (#159). The marquee
                        carries a live hit-count badge. Screen-space, host-relative. */}
                    {selRect !== null && (
                        <Box css={styles.selectBox} data-mode={effectiveTool === "marquee" ? "marquee" : "zoom"} style={{ left: selRect.x, top: selRect.y, width: selRect.w, height: selRect.h }} aria-hidden="true">
                            {effectiveTool === "marquee" && marqueeCount > 0 && (
                                <Box as="span" css={styles.selectBoxCount}>{marqueeCount}</Box>
                            )}
                        </Box>
                    )}
                    {scaleUnit !== undefined && scaleLen > 0 && (() => {
                        const len = scaleLen * ppu;
                        const quarter = (k: number, h: number) => `M ${(len * k) / 4} 6.5 V ${h}`;
                        return (
                            <Box css={styles.scaleBar} data-schematic-scale="">
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
                    {/* A read that failed, said once (#1398, CL11): the message box at the top-left in view of the area it
                        failed reading, with Retry. */}
                    {failure !== undefined && failedAt !== undefined && (
                        <LoadingFailedBox message={failure.message} retry={{ onRetry: failure.retry }} at={failedAt} />
                    )}
                    {showMinimap && minimapBox !== undefined && (
                        <Box
                            css={styles.minimap}
                            data-schematic-minimap=""
                            // What it draws, for a reader of the page: the cells of each kind's whole drawing's density, and the items' dots.
                            data-minimap-cells={minimapCells}
                            data-minimap-items={minimapItems.length}
                            title={words.m.minimapHint()}
                            style={{ width: minimapBox.w, height: minimapBox.h }}
                            onPointerDown={e => {
                                e.stopPropagation();
                                const el = e.currentTarget as HTMLElement;
                                capturePointer(el, e.pointerId);
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
                                releasePointer(e.currentTarget as HTMLElement, e.pointerId);
                            }}
                        >
                            {/* The zones, each kind read by area's whole drawing's density and the items' dots, painted (`minimap.ts`). */}
                            <chakra.canvas ref={minimapPaintRef} css={styles.minimapPaint} />
                            <Box
                                css={styles.minimapViewport}
                                style={{
                                    left: `${Math.max(0, (-cameraSnapshot.tx / ppu / W) * 100)}%`,
                                    top: `${Math.max(0, (-cameraSnapshot.ty / ppu / H) * 100)}%`,
                                    width: `${Math.min(100, (size.w / ppu / W) * 100)}%`,
                                    height: `${Math.min(100, (size.h / ppu / H) * 100)}%`,
                                }}
                            />
                        </Box>
                    )}
                </>
            )}
        </Box>
    );
});
