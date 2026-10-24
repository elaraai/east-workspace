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
 * area it failed reading, with Retry (CL11).
 *
 * Its gestures, its selection funnels, its camera and its paint path are the
 * ones `CLAUDE.md` holds to its invariants: no render-phase ref write, one
 * commit-phase snapshot, the paint's identity short-circuit, the fly before
 * the commit, and hit-testing that is the drawing.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from "react";
import { flushSync } from "react-dom";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import RBush from "rbush";
import { ArrayType, StringType, compareFor, equalFor, type ValueTypeOf, type option } from "@elaraai/east";
import { SCHEMATIC_WINDOW_ROWS, Schematic } from "@elaraai/e3-ui/internal";
import {
    getSomeorUndefined, typedInto, useDragLayerOptional, useDropCell, type CellCoord, type DragPayload, type DropCellOptions, type Origin,
} from "@elaraai/east-ui-components";
import { LoadingFailedBox, LoadingWash, useRevealed } from "@elaraai/east-ui-components/internal";
import {
    linkRoutes, markerHit, markerHitbox, netRoutes, paintSchematic, parallelLanes as paintParallelLanes, placedVertices, routeEnv,
    zoneAnchor, type EdgeGeometry, type RGB, type SchematicPaintEffect, type SchematicPalette,
} from "./paint";
import { EMPTY_STRING_SET, type ItemBox, linkAt, linkIndex, marqueeHits } from "./selection";
import {
    type LodTier, type NavZone, type WorldBox, SCHEMATIC_CARD_MAX_PX, buildCenterTree, buildNavTree, byLabel, cardContentWidth, declutterTiers, matchesExtent, tierSize,
} from "./model";
import { entityId, refOfId, type DrawnItem, type DrawnZone, type SchematicDrawn, type SchematicRef } from "./drawn";
import {
    type CameraEvent, type CameraMode, type RafCoalescer, type Viewport,
    FLY_DURATION_MS, IDENTITY, boxCss, cancelsFly, cardTranslateCss, fitView, flyStep, makeRafCoalescer, nextMode, zoomAbout,
} from "./camera";
import { SchematicCard } from "./card";
import { SchematicProbe, readPalette, useThemeVersion } from "./theme";
import { entityTints, tintsOf } from "./tints";
import type { SchematicLayerState } from "./layers";
import { minimapSize, paintMinimap } from "./minimap";
import { densityInView, type SchematicDensity, type SchematicViewportStore } from "../area.js";
import { areaSlots, type SchematicValue } from "../data.js";
import {
    NOWHERE, dropPoint, markEqual, markOf, printDropAt, readDropAt, restsAt, type SchematicCanvasDrop, type SchematicDropMark, type SchematicDropPoint,
} from "../drop.js";
import { zoneInView } from "../index-tree.js";
import {
    clampDelta, connectCandidate, connectStep, connectVeto, deleteEdits, editKinds, extendEdits, linkRefusal, moveEdits, retargetEdits,
    type ConnectDragArgs, type ConnectSession, type EditRefusal, type Mover, type NetLeg, type SchematicEdit, type SessionDrawn,
} from "../edits.js";
import type { SchematicStep, SchematicWords } from "../messages.js";
import type { SchematicNarrowedLook } from "../narrowing.js";
import type { SchematicTool } from "../tools.js";

/** What `onSelect` hears: the whole selection, each entity by its kind and key. */
const SelectedType = ArrayType(Schematic.Types.Ref);
const selectedEqual = equalFor(SelectedType);
const stringEqual = equalFor(StringType);
const compareString = compareFor(StringType);

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

/** One breath of a pulse's ring, in ms. */
const PULSE_PERIOD_MS = 1600;
/** A dot's half-extent the frame wraps, in screen px: its marker and its touch slop. */
const DOT_FRAME_PX = 10;

/**
 * A connect drag in flight (#176): the item it runs from, whether Shift was
 * held, the end of a selected link it re-targets, or the selected net it
 * extends.
 */
type ConnectDrag = { from: string; additive: boolean; retarget?: { key: string; movingEnd: "from" | "to" }; netExtend?: string };

type SlotStyles = Record<string, SystemStyleObject>;
type Pt = { x: number; y: number };

/** No drag moves anything. */
const NO_MOVES: ReadonlyMap<string, Pt> = new Map();

/** How far a press moves, each way, before it is a drag: within it, its release is a tap (px). */
const DRAG_THRESHOLD_PX = 4;

/**
 * Whether a key the window hears is the canvas's to take while the pointer is over it: one from nowhere in particular
 * — the page, its body — or from inside the canvas's own frame. A key from a layer portaled out of the frame — a
 * popover, a menu, a Chooser's list — is that layer's, as the frame leaves such a layer its Esc (`BuilderFrame`); so
 * is one from another frame on the page.
 *
 * @param canvas - The canvas's element
 * @param target - The key's target
 * @returns Whether the key is the canvas's
 */
function keyIsCanvas(canvas: Element | null, target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return true;
    const doc = target.ownerDocument;
    if (target === doc.body || target === doc.documentElement) return true;
    const frame = canvas?.closest("[data-builder-frame]") ?? canvas;
    return frame !== null && frame !== undefined && frame.contains(target);
}

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

/** The zoom's least limit, from Fit: further only where the drawing's smallest item needs it to draw as a whole card. */
const MAX_ZOOM = 40;
/** The most px per world unit any zoom reaches, whatever an item's size asks: a bound on a degenerate item's width. */
const MAX_PPU = 4000;
/**
 * What a tap on the density zooms in to: a box whose rows, by the density's own count, draw once the fly frames it —
 * its view the box grown by the fly's margin (1.18 a side, near 1.4 times its rows) still short of the rows a view
 * draws.
 */
const DENSITY_TAP_ROWS = SCHEMATIC_WINDOW_ROWS * 0.6;
/** LOD thresholds in px per world unit: card ⇢ labelled dot ⇢ dot. */
const LOD_CARD_PPU = 30;
const LOD_LABEL_PPU = 16;
/** Item-count threshold for the minimap default. */
const MINIMAP_AUTO = 25;
/** No entity's colour resolved: what the canvas paints by before the probe is first read. */
const NO_TINTS: ReadonlyMap<string, RGB> = new Map();
/** No kind drawing its density. */
const NO_DENSITY: ReadonlyMap<string, SchematicDensity> = new Map();
/** No item's centre: what the declutter is given at the dots' zoom, where it reads none. */
const NO_CENTERS = buildCenterTree([]);
/** How long the camera rests before the canvas tells the reader where its viewport is (#1393, CL6), in ms. */
const REST_READ_MS = 100;
/** Moving slower than a viewport each this many ms, the canvas tells the reader as it moves (CL6). */
const SLOW_READ_MS = 200;
/** Where a drag rests over the canvas before it says otherwise: on nothing of its card's kind (#1390). */
const NOWHERE_AT = printDropAt(NOWHERE);
/** The card layer's widest card (#1393): what the recipe holds a card to, but one at its item's own width — the figure `tierSize` and the area read reckon with. */
const CARD_LAYER_STYLE = { "--schematic-card-max": `${SCHEMATIC_CARD_MAX_PX}px` } as CSSProperties;
/** Nothing unread. */
const NO_UNREAD: readonly WorldBox[] = [];
/** How far inside the area it failed reading a failure's message box sits, from its top-left in view (CL11), in px — and its least room from the canvas's right. */
const FAILED_INSET_PX = 16;

/** Runs an author's East callback off the event turn (queueMicrotask, per
 *  the interactive-state pattern) with error isolation — a throwing callback
 *  logs with context instead of surfacing as an unhandled rejection or taking
 *  interaction state down with it. */
function dispatchEast(name: string, run: () => unknown): void {
    queueMicrotask(() => {
        try {
            const out = run();
            // Async East callbacks reject later — attach the same isolation.
            if (out instanceof Promise) out.catch(err => console.error(`[Schematic] ${name} callback failed:`, err));
        } catch (err) {
            console.error(`[Schematic] ${name} callback failed:`, err);
        }
    });
}

/**
 * Captures a pointer for a gesture where it can be (#1393): a pointer no longer active — one the browser cancelled
 * before the handler ran, or one an automation made up — takes no capture, and its gesture runs uncaptured rather than
 * throw out of the handler (`setPointerCapture`'s `NotFoundError`, or `InvalidStateError`).
 */
function capturePointer(el: Element, pointerId: number): void {
    try {
        el.setPointerCapture(pointerId);
    } catch (err) {
        if (!(err instanceof DOMException)) throw err;
    }
}

/** Lets go of a pointer the element holds: one it never captured, or no longer active, it lets be. */
function releasePointer(el: Element, pointerId: number): void {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
}

/**
 * Tells the canvas whether its builder's reveal shows a read in flight (#1398, CL4), as its clock flips: what its
 * painted placeholders — a marker whose status is unread — show by. It draws nothing, and its flip renders it alone,
 * never the canvas. Outside a builder's reveal a placeholder shows, as the shared shapes do.
 */
const RevealTell = memo(function RevealTell({ onReveal }: { onReveal: (shown: boolean) => void }) {
    const shown = useRevealed() !== false;
    useLayoutEffect(() => { onReveal(shown); }, [shown, onReveal]);
    return null;
});

/** How much room a fly leaves about the box it frames: the box at 1 / 1.18 of the canvas's width or height, whichever binds. */
const FLY_PAD = 1.18;

/** The world box a fly to a point frames: 8 × 6 units about it. */
function pointFrame(p: { x: number; y: number }): { x: number; y: number; w: number; h: number } {
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
function itemFrame(item: DrawnItem, size: { readonly w: number; readonly h: number }): { x: number; y: number; w: number; h: number } {
    const width = getSomeorUndefined(item.width);
    if (width === undefined || !(width > 0)) return pointFrame(item);
    const needed = cardContentWidth(item) / width;
    const w = Math.min(8, size.w / (FLY_PAD * needed)), h = Math.min(6, size.h / (FLY_PAD * needed));
    return { x: item.x - w / 2, y: item.y - h / 2, w, h };
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
    viewport, density = NO_DENSITY, overview = NO_DENSITY, reading = false, unread = NO_UNREAD, failure, onZoomRange, narrow = false, onElement, ref,
}: SchematicCanvasProps) {
    // The recipe's styles, resolved once a recipe: the canvas renders at every frame its camera moves.
    const recipe = useSlotRecipe({ key: "schematic" });
    const styles = useMemo(() => recipe() as SlotStyles, [recipe]);
    const { width: W, height: H } = value.extent;
    // What never selects, by any path — a tap, the marquee, the steps, a drop, a reveal — and lets go of what is
    // selected: a locked layer's entities (SC27), and what the narrowing takes out, its context among them (#1392).
    const { context, out: narrowedOut, matches, look } = narrowing;
    const inertKeys = useMemo(() => (narrowedOut.size === 0 ? layers.locked : new Set([...layers.locked, ...narrowedOut])), [layers.locked, narrowedOut]);

    // The host hears the whole selection after each change, each entity by its kind and key (#1401, D34, SC29).
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    // Zone (area) selection (#177) — a separate set from item selection, committed
    // through its own funnel below (declared here so early callbacks can reference it).
    const [zoneSelection, setZoneSelection] = useState<ReadonlySet<string>>(EMPTY_STRING_SET);
    // Editing (#1388) follows the kinds' bindings (§1, rule 4): a kind bound with
    // its patch door writes, and none does while the Schematic is read only
    // (`edits.ts`' `editKinds`, SC14). The Connect tool draws the link kind the
    // frame's Connect menu chose; a Shift session grows into the first net kind
    // whose sides hold its items; the Move tool moves the items of the item kinds
    // that write; Del deletes what is selected of them. Each gesture is one step
    // of the editing's history.
    const kinds = useMemo(() => editKinds({ items: value.items, links: value.links, nets: value.nets, readOnly: value.readOnly }),
        [value.items, value.links, value.nets, value.readOnly]);
    const movableKinds = kinds.items;
    // The selected link (single, #176) — selection works even when read-only
    // (inspection, and the host's `onSelect`); the connector handles / delete do not. A net
    // STUB click selects one LEG (`leg` non-null): the halo narrows to that stub
    // and Del removes just that endpoint (#189 follow-up).
    const [selectedLink, setSelectedLink] = useState<{ key: string; leg: NetLeg | null } | null>(null);
    // The link or the net under the pointer (#1403), lit: drawn last in the strong ink, its ends ringed, and named in
    // `data-lit-link`. It lights while no gesture is under way, and nothing opens on it (invariant 12).
    const [lit, setLit] = useState<string | undefined>(undefined);
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
    // Whether the selected link writes: its connector handles show, and a re-target writes it — never below 480px of main,
    // where the inspector's ends re-target it (#1394, D15).
    const selectedLinkEditable = !narrow && selectedLink !== null && kinds.links.get(refById.get(selectedLink.key)?.kind ?? "")?.editable === true;
    // Each item's label by its id: what a refusal's words name it by.
    const labelById = useMemo(() => new Map(data.items.map((item) => [item.key, item.label] as const)), [data.items]);
    // Connection veto (#176, #1401 D34): gates the connect GESTURE itself — the
    // one channel behind pairwise links, every Shift-session extension (nets),
    // and endpoint re-targets — so all three obey the same rule, as the
    // inspector's Connect to…, ends and sides do (#1394). It hears the
    // gesture's candidate: the link or net kind it writes and its two items;
    // `none` allows it, and words refuse it, which the draft shows (#1388).
    // Verdicts cache per (kind, from, to) (`edits.ts`' `connectVeto`), afresh
    // when the fn or the drawing's entities change, so the pointermove probe
    // never re-runs the East function for the same candidate; a THROWING veto
    // logs and ALLOWS (fail-open) so a broken function cannot brick editing.
    const canConnectFn = useMemo(() => getSomeorUndefined(value.canConnect), [value.canConnect]);
    /** The veto's words for a candidate, or `undefined` when it allows it. */
    const connectRefusal = useMemo(() => connectVeto(canConnectFn, (id) => refById.get(id)), [canConnectFn, refById]);
    // --- A Move's preview (#179, #1388) — while its drag is under way. ----------
    // Each item the drag moves, where it has it: applied UPSTREAM of the working set
    // so centers / rbush / LOD / nav / link endpoints all follow it. The release
    // records the move as one step, its preview going as its drafts draw; Esc or a
    // lost pointer drops the preview and records nothing (SC8).
    const [dragMoves, setDragMoves] = useState<ReadonlyMap<string, Pt>>(NO_MOVES);
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

    // Selection state, consolidated (#172): the selected SET and the anchor (the
    // last-touched key driving prev/next stepping) commit ATOMICALLY as one
    // object — they can never disagree. Every mutation allocates a FRESH Set so
    // the paint identity short-circuit (lastPaintRef.sel) stays correct.
    const [selection, setSelection] = useState<{ selected: ReadonlySet<string>; anchor: string | null }>(
        { selected: EMPTY_STRING_SET, anchor: null });
    const selected = selection.selected;
    // Commit context for the stable (empty-deps) selection funnels: the decoded
    // callback and each entity's reference it must read FRESH at event time. ONE
    // object, written in the commit-phase snapshot effect below (#172) — never in
    // the render body, so a discarded render can't leak into it.
    const commitCtx = { onSelect: onSelectFn, refById };
    const commitCtxRef = useRef(commitCtx);
    // The whole selection as the funnels leave it — items, zones and the link or
    // net — and what the host last heard (#1401, D34). Each funnel writes its
    // part here as it commits, and asks for one report: a gesture that changes
    // several parts (a background tap clears all three) is heard once, after its
    // last funnel, and a change the host has heard already is not heard again.
    const selectedNowRef = useRef<{ items: ReadonlySet<string>; zones: ReadonlySet<string>; link: string | null }>(
        { items: EMPTY_STRING_SET, zones: EMPTY_STRING_SET, link: null });
    const heardRef = useRef<ValueTypeOf<typeof SelectedType>>([]);
    const reportPendingRef = useRef(false);
    const reportSelection = useCallback(() => {
        if (reportPendingRef.current) return;
        reportPendingRef.current = true;
        dispatchEast("onSelect", () => {
            reportPendingRef.current = false;
            const { onSelect, refById: refs } = commitCtxRef.current;
            if (onSelect === undefined) return undefined;
            const now = selectedNowRef.current;
            const ids = [...now.items, ...now.zones, ...(now.link === null ? [] : [now.link])];
            const heard = ids.flatMap(id => { const ref = refs.get(id); return ref === undefined ? [] : [ref]; });
            if (selectedEqual(heardRef.current, heard)) return undefined;
            heardRef.current = heard;
            return onSelect(heard);
        });
    }, []);
    // Single funnel for every item-selection mutation (tap / marquee / clear). Per
    // the MANDATORY interactive-state pattern: compute `next` OUTSIDE the updater,
    // then set the state and report as separate statements.
    const commitSelection = useCallback((next: ReadonlySet<string>, opts: { anchor?: string } = {}) => {
        // Selected set + anchor commit atomically: a cleared selection has no
        // anchor; an explicit `anchor` (the touched key / last marquee hit) wins;
        // otherwise the prior last-touched anchor is preserved (it need not be
        // selected — a Shift-toggle OFF still anchors stepping there). Dead
        // anchors (item left the working set) are pruned by the hygiene effect.
        // The updater is PURE (side effects stay below, per the interactive-state
        // pattern) — it only merges the prior anchor.
        setSelection(prev => ({
            selected: next,
            anchor: next.size === 0 ? null : opts.anchor !== undefined ? opts.anchor : prev.anchor,
        }));
        selectedNowRef.current = { ...selectedNowRef.current, items: next };
        reportSelection();
    }, [reportSelection]);
    const clearSelection = useCallback(() => commitSelection(EMPTY_STRING_SET), [commitSelection]);
    // The link or net selected — `leg` a net's one stub — through its funnel, as the items' are.
    const commitLinkSelection = useCallback((next: { key: string; leg: NetLeg | null } | null) => {
        setSelectedLink(next);
        selectedNowRef.current = { ...selectedNowRef.current, link: next === null ? null : next.key };
        reportSelection();
    }, [reportSelection]);
    // Selected-link hygiene: clear when the link leaves the drawing (deleted —
    // a draft, or another session's commit — or taken back by Undo), or its
    // layer is hidden or locked (SC27), or the narrowing takes it out (#1392),
    // through the link's funnel, so the host hears it.
    useEffect(() => {
        const prev = renderSnapRef.current.selectedLink;
        if (prev === null) return;
        const net = data.nets.find(n => n.key === prev.key);
        if ((net === undefined && !data.links.some(l => l.key === prev.key)) || layers.hidden.has(prev.key) || inertKeys.has(prev.key)) {
            commitLinkSelection(null);
            return;
        }
        // A selected LEG whose endpoint left the net — or its item went to context (#1392) — demotes to the whole net.
        if (prev.leg !== null && net !== undefined) {
            const side = prev.leg.end === "source" ? net.sources : net.destinations;
            if (!side.includes(prev.leg.item) || narrowedOut.has(prev.leg.item)) commitLinkSelection({ key: prev.key, leg: null });
        }
    }, [data.links, data.nets, layers.hidden, inertKeys, narrowedOut, commitLinkSelection]);

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

    // Selection hygiene: prune any selected keys that left the working set (their
    // layer was hidden) or whose layer was locked — a locked layer's entities
    // never select (SC27) — and null a dead anchor, so prev/next stepping stays
    // consistent. Only set state when the set actually shrank (fresh Set), so
    // this can't loop.
    useEffect(() => {
        if (selected.size === 0) return;
        const live = new Set(items.flatMap(it => (inertKeys.has(it.key) ? [] : [it.key])));
        let changed = false;
        const next = new Set<string>();
        for (const k of selected) { if (live.has(k)) next.add(k); else changed = true; }
        // Route the prune through the funnel (not a raw set) so the host hears it.
        // Shrank-only ⇒ no loop.
        if (changed) commitSelection(next);
        // A dead anchor (its item left the working set) is pruned with a PURE,
        // identity-stable updater — no set change, so no callbacks fire.
        setSelection(prev => (prev.anchor !== null && !live.has(prev.anchor)) ? { ...prev, anchor: null } : prev);
    }, [items, selected, inertKeys, commitSelection]);
    // The frame hears what is selected: its toolbar's steps show while something is, the Index marks its rows, and the
    // inspector shows it — a net's leg with it (#1391).
    useEffect(() => {
        onSelection(new Set([...selected, ...zoneSelection, ...(selectedLink === null ? [] : [selectedLink.key])]), selectedLink?.leg ?? null);
    }, [selected, zoneSelection, selectedLink, onSelection]);

    const canvasRef = useRef<HTMLDivElement | null>(null);
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
    // holds only a throttled snapshot for derived UI — minimap, the LOD/culling
    // recompute — never updated per pointer event (issue #57, Phase 2
    // invariants 1–2).
    const cameraRef = useRef<Viewport>(IDENTITY);
    const modeRef = useRef<CameraMode>("idle");
    const animRef = useRef<number | null>(null);
    const [cameraSnapshot, setCameraSnapshot] = useState<Viewport>(IDENTITY);

    // Interaction tool, the frame's (§6.1): Select drag-pans and tap-selects
    // (#153); Zoom box drags a box the view flies into (#153); Marquee drags a
    // box that selects the enclosed items (#159); Connect (#176) and Move (#179)
    // edit. Both box tools share the drag machinery — `isBoxTool` gates it.
    // Momentary keyboard overrides — hold Space (Select) / Ctrl (Zoom box) while
    // hovering — set `tempTool`; `effectiveTool` is what the cursor + drag obey.
    const [tempTool, setTempTool] = useState<"select" | "zoom" | null>(null);
    const effectiveTool = tempTool ?? tool;
    const isBoxTool = effectiveTool === "zoom" || effectiveTool === "marquee";
    const hoveredRef = useRef(false);
    // Live screen-space selection box (px, relative to the canvas host) while a
    // box-drag is in flight; drives the dashed overlay and the release action.
    // `mode` distinguishes a zoom-box from a marquee; `additive` latches Shift at
    // pointer-down (marquee unions rather than replaces).
    // Connect-tool gesture (#176): the live drag (pointer-capture scoped) and its
    // render state (the draft edge painted on the canvas). A SESSION (Shift) keeps
    // the links its drags drew — or the selected link it was seeded with — and
    // the net they grew into (`edits.ts`' `ConnectSession`), each read from the
    // drawing as it stands when the next drag lands.
    const connectDragRef = useRef<ConnectDrag | null>(null);
    // A press on an editable selected link's end handle (SC10): a tap until it moves past the drag threshold, when it
    // becomes the re-target drag — so a tap there selects what is under it, as any tap does. Its link, the end it would
    // move, the end that stays, and where it was pressed.
    const handlePressRef = useRef<{ key: string; movingEnd: "from" | "to"; fixed: string; x: number; y: number } | null>(null);
    // Move-tool drag (#179): the pressed key, the items moving (a group move rides
    // the selection) where the drag found them, the world start point of the
    // gesture, and the delta it has them at, clamped to the extent (SC8).
    const moveDragRef = useRef<{ key: string; movers: readonly (Mover & { readonly id: string })[]; startWorld: Pt; delta: { dx: number; dy: number } } | null>(null);
    // A refused draft keeps the refusal's words (`reason`) — its kind's, or the veto's — which it shows (SC9). A
    // retarget's names the link it moves (`retarget`), drawn as its `was` line while its end is dragged (#1403).
    const [connectDraft, setConnectDraft] = useState<{
        from: string; toWorld: Pt; target: string | undefined; retarget?: string; forbidden?: string; reason?: string | undefined;
    } | null>(null);
    // Where a library card's drag rests while its drop lands there (#1390): the point it lands at, or the entity it
    // lands on — what the canvas marks. A drag over, nothing stays marked.
    const dragging = useDragLayerOptional()?.active ?? false;
    const [dropMark, setDropMark] = useState<SchematicDropMark | undefined>(undefined);
    useEffect(() => { if (!dragging) setDropMark(undefined); }, [dragging]);
    const linkSessionRef = useRef<ConnectSession | undefined>(undefined);
    // The session's links' ends and its net's sides, as the drawing holds them now: Undo, Redo or another gesture
    // between two of its drags is the session's too.
    const sessionDrawn = useMemo((): SessionDrawn => {
        const links = new Map(data.links.map((link) => [link.key, link] as const));
        const nets = new Map(data.nets.map((net) => [net.key, net] as const));
        const refs = (ids: readonly string[]) => ids.flatMap((id) => { const ref = refOfId(id); return ref === undefined ? [] : [ref]; });
        return {
            ends: (ref) => {
                const link = links.get(entityId(ref));
                const from = link === undefined ? undefined : refOfId(link.from);
                const to = link === undefined ? undefined : refOfId(link.to);
                return from === undefined || to === undefined ? undefined : { from, to };
            },
            sides: (ref) => {
                const net = nets.get(entityId(ref));
                return net === undefined ? undefined : { sources: refs(net.sources), destinations: refs(net.destinations) };
            },
        };
    }, [data.links, data.nets]);
    // An item a gesture names: its reference, and its label for a refusal's words.
    const itemOf = useCallback((id: string) => {
        const ref = refById.get(id);
        return ref === undefined ? undefined : { ref, label: labelById.get(id) ?? ref.key };
    }, [refById, labelById]);
    /** A refusal's words. */
    const refusalWords = useCallback((refusal: EditRefusal): string => (refusal.why === "end"
        ? words.m.endRefused({ kind: refusal.kind, end: refusal.end, item: refusal.item })
        : words.m.deleteRefused({ item: refusal.item, kind: refusal.kind, key: refusal.key })), [words]);
    /** A connect drag onto a target, as the edits read it: the open session, Shift, the Connect tool's kind and its items. */
    const dragArgs = useCallback((cd: Pick<ConnectDrag, "from" | "additive">, target: string): ConnectDragArgs | undefined => {
        const from = itemOf(cd.from), to = itemOf(target);
        if (from === undefined || to === undefined) return undefined;
        return {
            session: linkSessionRef.current, shift: cd.additive, linkKind, from, to, drawn: sessionDrawn,
            labelOf: (ref) => labelById.get(entityId(ref)) ?? ref.key,
        };
    }, [itemOf, linkKind, sessionDrawn, labelById]);
    // Why a connect drag can't land on a target (SC9, #1401 D34): the end of its
    // kind that holds no item of the target's slot, else the veto's words. A
    // re-target writes its link, vetted in the link's REAL direction — the fixed
    // end may be either side; an Extend its net; a Shift session the net it grows
    // into, when a net kind holds its items; any other drag a link of the Connect
    // tool's kind. `undefined` when it may land.
    const candidateRefusal = useCallback((cd: ConnectDrag, target: string): string | undefined => {
        const fixed = itemOf(cd.from), moving = itemOf(target);
        if (fixed === undefined || moving === undefined) return undefined;
        if (cd.retarget !== undefined) {
            const slot = refById.get(cd.retarget.key)?.kind;
            const link = slot === undefined ? undefined : kinds.links.get(slot);
            if (slot === undefined || link === undefined) return undefined;
            const toFrom = cd.retarget.movingEnd === "from";
            const refusal = toFrom ? linkRefusal(link, moving, fixed) : linkRefusal(link, fixed, moving);
            if (refusal !== undefined) return refusalWords(refusal);
            return toFrom ? connectRefusal(slot, target, cd.from) : connectRefusal(slot, cd.from, target);
        }
        if (cd.netExtend !== undefined) {
            const slot = refById.get(cd.netExtend)?.kind;
            const net = slot === undefined ? undefined : kinds.nets.get(slot);
            if (slot === undefined || net === undefined) return undefined;
            if (!stringEqual(moving.ref.kind, net.destinations)) return refusalWords({ why: "end", kind: net.name, end: "end", item: moving.label });
            return connectRefusal(slot, cd.from, target);
        }
        const args = dragArgs(cd, target);
        if (args === undefined) return undefined;
        const candidate = connectCandidate(kinds, args);
        if (candidate.refusal !== undefined) return refusalWords(candidate.refusal);
        return candidate.kind === undefined ? undefined : connectRefusal(candidate.kind, cd.from, target);
    }, [itemOf, refById, kinds, refusalWords, connectRefusal, dragArgs]);
    // One-shot connect flash (the draw-in + endpoint rings), driven by a short
    // rAF loop like the pulse ticker — phase read at paint time from the ref.
    const connectFlashRef = useRef<{ from: string; to: string; t0: number } | null>(null);
    const flashRafRef = useRef<number | null>(null);
    const selStartRef = useRef<{ sx: number; sy: number; mode: "zoom" | "marquee"; additive: boolean } | null>(null);
    // Marquee-hit recompute coalescing (#183 WS6): the box rect tracks every
    // pointermove; the HITS (r-tree + footprint tests) recompute at most once
    // per animation frame from the latest rect. Display-only — pointerup
    // recomputes at commit, so a pending frame can never skew the selection.
    const marqueeRafRef = useRef<number | null>(null);
    const marqueeRegionRef = useRef<{ x0: number; y0: number; sw: number; sh: number } | null>(null);
    useEffect(() => () => {
        if (marqueeRafRef.current !== null) cancelAnimationFrame(marqueeRafRef.current);
    }, []);
    // Box-gesture render state, consolidated (#172): ONE object per in-flight
    // box drag — the overlay rect, which tool owns it, Shift-additivity, and the
    // live marquee hits. `null` ⇒ no box in flight. The badge count and the
    // canvas selection PREVIEW derive from it (they can never disagree).
    const [boxDrag, setBoxDrag] = useState<{
        rect: { x: number; y: number; w: number; h: number };
        mode: "zoom" | "marquee";
        additive: boolean;
        hits: ReadonlySet<string>;
    } | null>(null);
    const selRect = boxDrag?.rect ?? null;
    const marqueeCount = boxDrag !== null && boxDrag.mode === "marquee" ? boxDrag.hits.size : 0;
    // The would-be selection while a marquee drag is in flight (null = not
    // dragging ⇒ render the committed selection). Memoised so the paint
    // identity short-circuit sees a stable set per commit. Canvas-only.
    const marqueePreview = useMemo<ReadonlySet<string> | null>(() => {
        if (boxDrag === null || boxDrag.mode !== "marquee") return null;
        return boxDrag.additive ? new Set([...selected, ...boxDrag.hits]) : boxDrag.hits;
    }, [boxDrag, selected]);

    // The fit, and the camera Fit takes (#1393): the drawing inside the canvas less its margin, centred on both axes.
    const { fit, home } = useMemo(() => (size === null ? { fit: 0, home: IDENTITY } : fitView(size.w, size.h, W, H)), [size, W, H]);
    const ppu = fit * cameraSnapshot.zoom;
    // The minimap's size: the drawing at its aspect, 150px wide at most, and no more than a quarter of the canvas's width
    // or a third of its height, so a phone's keeps to its corner (#1393).
    const minimapBox = useMemo(() => (size === null ? undefined : minimapSize(size, { width: W, height: H })), [size, W, H]);
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

    // --- Zone (area) selection (#177). ---------------------------------------
    // The zone-selection commit funnel — mirrors commitSelection: a fresh set,
    // the state set, then one report of the whole selection.
    const commitZoneSelection = useCallback((next: ReadonlySet<string>) => {
        setZoneSelection(next);
        selectedNowRef.current = { ...selectedNowRef.current, zones: next };
        reportSelection();
    }, [reportSelection]);
    const clearZoneSelection = useCallback(() => {
        // Only a real clear commits — Esc on an already-empty zone selection is silent.
        if (renderSnapRef.current.zoneSelection.size > 0) commitZoneSelection(EMPTY_STRING_SET);
    }, [commitZoneSelection]);
    // Zone-selection hygiene, as the items': a zone whose layer is hidden or locked, or the narrowing takes out, leaves
    // the selection (SC27, #1392).
    useEffect(() => {
        if (zoneSelection.size === 0) return;
        const live = new Set(shownZones.flatMap(z => (inertKeys.has(z.key) ? [] : [z.key])));
        if ([...zoneSelection].every(key => live.has(key))) return;
        commitZoneSelection(new Set([...zoneSelection].filter(key => live.has(key))));
    }, [zoneSelection, shownZones, inertKeys, commitZoneSelection]);
    // The innermost selectable zone under a screen point: OUTLINE zones only
    // (hatch bands are annotations, mirroring the Index's host contract), honouring
    // explicit circle / polygon geometry, skipping locked-layer zones; smallest
    // containing zone wins so nested cages select before their hall. `accept`
    // narrows it to the zones a drop's card lands on (#1390).
    const zoneKeyAt = useCallback((host: HTMLElement, clientX: number, clientY: number, accept?: (id: string) => boolean): string | undefined => {
        const snap = renderSnapRef.current;
        if (snap.size === null) return undefined;
        const cam = cameraRef.current;
        const ppuLive = snap.fit * cam.zoom;
        if (ppuLive === 0) return undefined;
        const rect = host.getBoundingClientRect();
        const wxp = (clientX - rect.left - cam.tx) / ppuLive, wyp = (clientY - rect.top - cam.ty) / ppuLive;
        let best: DrawnZone | undefined;
        let bestArea = Infinity;
        for (const z of shownZones) {
            if (z.pattern.type !== "outline") continue;
            if (inertKeys.has(z.key)) continue;
            if (accept !== undefined && !accept(z.key)) continue;
            const geom = getSomeorUndefined(z.geometry);
            // Its geometry is drawn about its box's centre (D22).
            const anchor = zoneAnchor(z);
            let hit: boolean;
            if (geom !== undefined && geom.type === "circle") {
                hit = Math.hypot(wxp - anchor.x, wyp - anchor.y) <= geom.value.radius;
            } else if (geom !== undefined && geom.type === "polygon") {
                hit = pointInPolygon(wxp - anchor.x, wyp - anchor.y, geom.value.vertices);
            } else if (geom !== undefined && geom.type === "polyline") {
                continue;   // an open band is not a container
            } else {
                hit = wxp >= z.x && wxp <= z.x + z.width && wyp >= z.y && wyp <= z.y + z.height;
            }
            if (!hit) continue;
            const area = z.width * z.height;
            if (area < bestArea) { best = z; bestArea = area; }
        }
        return best?.key;
    }, [shownZones, inertKeys]);
    // A link's or a net's drawing as the painter draws it, worked out over a camera (#1403): its runs from the edges of
    // the items it joins where they draw at the zoom — a card's side as the page lays it out, a pin's edge, a dot's rim
    // — its heads, and a link's handles. What a tap, a hover, a drop and a selected link's handles meet: hit-testing is
    // the drawing (invariant 9). A pin's label is measured in the painter's font, else reckoned at 6px a letter.
    const routesAt = useCallback((cam: { ppu: number; tx: number; ty: number }) => {
        const snap = renderSnapRef.current;
        const ctx = drawRef.current?.getContext("2d") ?? null;
        const labelFont = snap.palette?.labelFont;
        const measure = (text: string): number => {
            if (ctx === null || labelFont === undefined) return text.length * 6;
            ctx.save();
            ctx.font = labelFont;
            const w = ctx.measureText(text).width;
            ctx.restore();
            return w;
        };
        const env = routeEnv({ cam, centers: snap.centers, items: itemById, tiers: snap.tiers, cardSizes: cardSizesRef.current, lanes, measure });
        return (id: string): EdgeGeometry | undefined => {
            const link = linkById.get(id);
            if (link !== undefined) return linkRoutes(link, env);
            const net = netById.get(id);
            return net === undefined ? undefined : netRoutes(net, env);
        };
    }, [itemById, lanes, linkById, netById]);
    // The link or the net under a screen point (#176, #1403), and a net's leg: of those the links' R-tree holds near it,
    // the nearest whose drawn route it lies within the weight and the hit reach of — a net's trunk and bars the whole
    // net, a stub its leg. `accept` narrows it to the links and nets a drop's card lands on (#1390).
    const linkKeyAt = useCallback((host: HTMLElement, clientX: number, clientY: number, accept?: (id: string) => boolean): { key: string; leg: NetLeg | null } | undefined => {
        const snap = renderSnapRef.current;
        if (snap.size === null) return undefined;
        const cam = cameraRef.current;
        const ppuLive = snap.fit * cam.zoom;
        if (ppuLive === 0) return undefined;
        const rect = host.getBoundingClientRect();
        const sx = clientX - rect.left, sy = clientY - rect.top;
        return linkAt(linkTree, routesAt({ ppu: ppuLive, tx: cam.tx, ty: cam.ty }), { x: (sx - cam.tx) / ppuLive, y: (sy - cam.ty) / ppuLive }, { x: sx, y: sy }, ppuLive,
            // A locked layer's, and what the narrowing takes out, take no point; nor a net's leg to an item drawn as context (#1392).
            (id, leg) => !inertKeys.has(id) && (accept === undefined || accept(id)) && (leg === null || !narrowedOut.has(leg.item)));
    }, [linkTree, routesAt, inertKeys, narrowedOut]);
    // Click-select a link or a net — selection works read-only (inspection
    // channel); the host hears it in the whole selection, named by its kind and key.
    // A plain tap selects it alone, letting go of the items and the zones (D16, #1391); Shift adds it to them.
    const selectLink = useCallback((key: string, leg: NetLeg | null = null, additive = false) => {
        if (!additive) {
            commitSelection(EMPTY_STRING_SET);
            clearZoneSelection();
        }
        commitLinkSelection({ key, leg });
    }, [commitLinkSelection, commitSelection, clearZoneSelection]);

    // Selection stepping order: the zones nested by containment (`buildNavTree`, as the Index tab's tree is, #1389),
    // in natural label order, each zone's items in it, nested zones after their parent's own items, floor items last — a
    // locked layer's and the narrowing's context left out, as they never select (SC27, #1392). Worked out as a step asks
    // for it, and kept while the zones, the items and what never selects are as they were — never as a window lands,
    // whose thousands of rows a step may never walk (#1393); the key→index map makes each step O(1).
    const orderRef = useRef<{ zones: unknown; items: unknown; inert: unknown; ordered: DrawnItem[]; indexOf: ReadonlyMap<string, number> } | undefined>(undefined);
    const itemOrder = useCallback((): { ordered: readonly DrawnItem[]; indexOf: ReadonlyMap<string, number> } => {
        const was = orderRef.current;
        if (was !== undefined && Object.is(was.zones, shownZones) && Object.is(was.items, items) && Object.is(was.inert, inertKeys)) return was;
        const nav = buildNavTree(shownZones, items);
        const unlocked = (item: DrawnItem) => !inertKeys.has(item.key);
        const ordered: DrawnItem[] = [];
        const walk = (nodes: NavZone[]) => {
            for (const node of [...nodes].sort((a, b) => byLabel(a.zone, b.zone))) {
                ordered.push(...node.items.filter(unlocked).sort(byLabel));
                walk(node.children);
            }
        };
        walk(nav.roots);
        ordered.push(...nav.floor.filter(unlocked).sort(byLabel));
        const order = { zones: shownZones, items, inert: inertKeys, ordered, indexOf: new Map(ordered.map((item, i) => [item.key, i])) };
        orderRef.current = order;
        return order;
    }, [shownZones, items, inertKeys]);

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

    // --- Where the viewport rests (#1393): what a kind read by area reads its window around. ---
    // Told to the reader's store as the camera comes to rest — 100 ms without a move, or while it moves slower than a
    // viewport each 200 ms, a fly never, as it lands where it flies (CL6) — rendering nothing for it; the first at once,
    // so the first window is read as the canvas opens.
    const toldRef = useRef<{ at: number; x: number; y: number } | undefined>(undefined);
    useEffect(() => {
        if (viewport === undefined || size === null || ppu === 0) return undefined;
        const box = {
            minX: -cameraSnapshot.tx / ppu, minY: -cameraSnapshot.ty / ppu,
            maxX: (size.w - cameraSnapshot.tx) / ppu, maxY: (size.h - cameraSnapshot.ty) / ppu,
        };
        const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
        const tell = () => {
            viewport.set({ box, ppu, lod });
            toldRef.current = { at: performance.now(), ...centre };
        };
        const told = toldRef.current;
        if (told === undefined || viewport.get() === undefined) { tell(); return undefined; }
        const span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
        if (modeRef.current !== "flying" && performance.now() - told.at >= SLOW_READ_MS && Math.hypot(centre.x - told.x, centre.y - told.y) < span) {
            tell();
            return undefined;
        }
        const timer = setTimeout(tell, REST_READ_MS);
        return () => clearTimeout(timer);
    }, [viewport, size, ppu, cameraSnapshot, lod]);

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
        lit: string | undefined; was: string | undefined; cs: unknown; den: unknown; ph: boolean;
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
        // the parent (compositor only — no per-card layout) — invariant 6.
        for (const layer of [cardLayerRef.current, washLayerRef.current]) {
            if (layer === null) continue;
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
            && last.ph === placeholdersRef.current) return;
        lastPaintRef.current = {
            zoom: cam.zoom, tx: cam.tx, ty: cam.ty, vis: snap.visibleItems, tiers: snap.tiers,
            sel: snap.renderSelected, zsel: snap.zoneSelection, pal, tints: snap.tints, w: sz.w, h: sz.h, dpr: dprLive, val: snap.value,
            lay: snap.layerHiddenKeys, alp: snap.layerAlpha,
            dl: snap.connectDraftWorld, cf: cfPhase,
            slk: snap.selectedLink, sle: snap.selectedLinkEditable, dm: snap.dropMark,
            eff: snap.paintEffect, phase: pulsePhaseRef.current,
            lit: snap.lit, was: snap.wasLink, cs: cardSizes, den: snap.density, ph: placeholdersRef.current,
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
            });
        } catch (err) {
            console.error("[Schematic] paint failed (frame skipped):", err);
        }
    }, []);

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

    // Each card's size as the page lays it out (#1403): a ResizeObserver hears each card as it is laid out and as its box
    // changes — a card with an explicit width grows with the zoom — and the paint draws again over a fresh map. Made as
    // the first card is laid out, and let go with the canvas.
    const cardObserverRef = useRef<ResizeObserver | null>(null);
    const observeCard = useCallback((el: HTMLElement | null) => {
        if (el === null || typeof ResizeObserver === "undefined") return undefined;
        cardObserverRef.current ??= new ResizeObserver((entries) => {
            let next: Map<string, { w: number; h: number }> | undefined;
            for (const entry of entries) {
                const key = entry.target.getAttribute("data-card-key");
                const box = entry.borderBoxSize[0];
                if (key === null || box === undefined || !(box.inlineSize > 0 && box.blockSize > 0)) continue;
                const was = (next ?? cardSizesRef.current).get(key);
                if (was !== undefined && was.w === box.inlineSize && was.h === box.blockSize) continue;
                next ??= new Map(cardSizesRef.current);
                next.set(key, { w: box.inlineSize, h: box.blockSize });
            }
            if (next === undefined) return;
            cardSizesRef.current = next;
            applyCamera();
        });
        const observer = cardObserverRef.current;
        observer.observe(el);
        return () => observer.unobserve(el);
    }, [applyCamera]);
    useEffect(() => () => { cardObserverRef.current?.disconnect(); cardObserverRef.current = null; }, []);

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
    }, [applyCamera]);

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
    }, [fit, home, requestRender]);

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
    }, []);

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
    }, [applyCamera, transition]);

    // A canvas tap on a zone body (items always take precedence): a plain tap
    // selects the zone alone, letting go of the items and the link or net (D16,
    // #1391); Shift toggles/extends — mirroring the item tap semantics. A tap
    // selects in place: Find, the Index and the arrow keys fly.
    const zoneTap = useCallback((key: string, additive: boolean) => {
        let next: Set<string>;
        if (additive) {
            next = new Set(renderSnapRef.current.zoneSelection);
            if (next.has(key)) next.delete(key); else next.add(key);
        } else {
            next = new Set([key]);
            commitSelection(EMPTY_STRING_SET);
            commitLinkSelection(null);
        }
        commitZoneSelection(next);
    }, [commitZoneSelection, commitSelection, commitLinkSelection]);
    // End the open connect session (Esc, tool switch, a plain new drag, or any other gesture).
    const endLinkSession = useCallback(() => {
        linkSessionRef.current = undefined;
    }, []);
    // ~450ms one-shot flash driving repaints via the same identity-checked apply.
    const startConnectFlash = useCallback(() => {
        if (flashRafRef.current !== null) cancelAnimationFrame(flashRafRef.current);
        const tick = () => {
            const cf = connectFlashRef.current;
            if (cf === null) { flashRafRef.current = null; return; }
            applyCamera();
            if (performance.now() - cf.t0 >= 450) {
                connectFlashRef.current = null;
                flashRafRef.current = null;
                applyCamera();
                return;
            }
            flashRafRef.current = requestAnimationFrame(tick);
        };
        flashRafRef.current = requestAnimationFrame(tick);
    }, [applyCamera]);
    useEffect(() => () => { if (flashRafRef.current !== null) cancelAnimationFrame(flashRafRef.current); }, []);
    /**
     * Records one gesture's edits as one step of the editing's history (#1388),
     * labelled for it; one recorded says no refusal any more.
     *
     * @returns Whether anything was recorded
     */
    const recordStep = useCallback((edits: readonly SchematicEdit[], origin: Origin, step: SchematicStep, name: string, n: number): boolean => {
        if (editing === undefined || edits.length === 0) return false;
        const recorded = editing.record(edits, origin, words.m.step({ step, name: name.toLocaleLowerCase(words.locale), n }));
        if (recorded) onRefused(undefined);
        return recorded;
    }, [editing, words, onRefused]);
    // Commit a connect gesture (SC9): a link of the Connect tool's kind — or,
    // Shift held in an open session, the net the session grows into, absorbing
    // its links — each new row's key minted, its other fields the template of
    // its kind the library has selected (§4.3), one step; then the flash.
    const commitConnect = useCallback((from: string, to: string, shift: boolean) => {
        if (editing === undefined) return;
        const args = dragArgs({ from, additive: shift }, to);
        if (args === undefined) return;
        const minted = new Set<string>();
        const step = connectStep(kinds, args, (slot) => {
            const key = editing.mint(slot, minted);
            minted.add(key);
            return key;
        }, connectValues);
        if (step === undefined) return;
        const grown = step.edits.find((edit) => edit.op === "net" || edit.op === "sides");
        const slot = (grown ?? step.edits.find((edit) => edit.op === "link"))?.ref.kind;
        if (slot === undefined) return;
        const name = (grown !== undefined ? kinds.nets.get(slot)?.name : kinds.links.get(slot)?.name) ?? slot;
        if (!recordStep(step.edits, "insert", grown !== undefined ? "net" : "connect", name, 1)) return;
        linkSessionRef.current = step.session;
        connectFlashRef.current = { from, to, t0: performance.now() };
        startConnectFlash();
    }, [editing, dragArgs, kinds, recordStep, startConnectFlash, connectValues]);
    // Re-target a selected link's end (connector-handle drag, SC10): the end it
    // moves written, one step.
    const commitRetarget = useCallback((key: string, movingEnd: "from" | "to", target: string) => {
        const link = data.links.find(l => stringEqual(l.key, key));
        const from = link === undefined ? undefined : refOfId(link.from);
        const to = link === undefined ? undefined : refOfId(link.to);
        const onto = refById.get(target);
        if (link === undefined || from === undefined || to === undefined || onto === undefined) return;
        const edits = retargetEdits({ ref: link.ref, ends: { from, to } }, movingEnd, onto);
        if (!recordStep(edits, "move", "retarget", kinds.links.get(link.ref.kind)?.name ?? link.ref.kind, 1)) return;
        endLinkSession();
        connectFlashRef.current = { from: movingEnd === "from" ? target : link.from, to: movingEnd === "to" ? target : link.to, t0: performance.now() };
        startConnectFlash();
    }, [data.links, refById, kinds, recordStep, endLinkSession, startConnectFlash]);
    // Extend a selected NET by one member (Shift-drag out of a member, SC10):
    // the dragged-to item joins its destinations, one step.
    const commitNetExtend = useCallback((netKey: string, from: string, to: string) => {
        const net = data.nets.find(n => stringEqual(n.key, netKey));
        const onto = refById.get(to);
        if (net === undefined || onto === undefined) return;
        if (!net.sources.some((id) => stringEqual(id, from)) && !net.destinations.some((id) => stringEqual(id, from))) return;
        const sides = sessionDrawn.sides(net.ref);
        if (sides === undefined) return;
        const edits = extendEdits({ ref: net.ref, sides }, onto);
        if (!recordStep(edits, "insert", "extend", kinds.nets.get(net.ref.kind)?.name ?? net.ref.kind, 1)) return;
        endLinkSession();
        connectFlashRef.current = { from, to, t0: performance.now() };
        startConnectFlash();
    }, [data.nets, refById, sessionDrawn, kinds, recordStep, endLinkSession, startConnectFlash]);
    // Delete what is selected (Del / Backspace, SC5, SC10, D7): the selected link
    // or net, or a net leg's item off its side, and the selected items with every
    // link and net leg naming one — one step; refused, in its words, where a link
    // or a net bound read only names an item it would delete.
    const deleteSelection = useCallback((): boolean => {
        if (editing === undefined) return false;
        const snap = renderSnapRef.current;
        const selection = { items: snap.selection.selected, link: snap.selectedLink };
        if (selection.items.size === 0 && selection.link === null) return false;
        const result = deleteEdits(kinds, data, selection);
        if ("refusal" in result) {
            onRefused(refusalWords(result.refusal));
            return true;
        }
        if (!recordStep(result.edits, "remove", "delete", "", result.edits.length)) return false;
        endLinkSession();
        return true;
    }, [editing, kinds, data, onRefused, refusalWords, recordStep, endLinkSession]);

    const flyToItem = useCallback((item: DrawnItem) => {
        const size = renderSnapRef.current.size;
        flyTo(size === null ? pointFrame(item) : itemFrame(item, size));
        // A fly-to focus (Find's pick, a step, the Index's) is always
        // single-focus REPLACE — the item alone, no zone or link beside it;
        // its purpose is the camera move; Shift-add is marquee-only.
        commitSelection(new Set([item.key]), { anchor: item.key });
        clearZoneSelection();
        commitLinkSelection(null);
    }, [flyTo, commitSelection, clearZoneSelection, commitLinkSelection]);
    const stepSelection = useCallback((delta: number) => {
        const { ordered, indexOf } = itemOrder();
        if (ordered.length === 0) return;
        const anchor = selection.anchor;
        const idx = anchor !== null ? (indexOf.get(anchor) ?? -1) : -1;
        flyToItem(ordered[(idx + delta + ordered.length) % ordered.length]!);
    }, [itemOrder, flyToItem, selection.anchor]);
    // Keyboard traversal (#183 WS7): with the canvas focused, arrows step the
    // selection through the deterministic item order (the toolbar's steps'
    // exact path — fly + select), and Del deletes it (#1388). Enter opens the
    // selection in the inspector's Details, with the inspector (#1391). Esc /
    // Space / Ctrl stay on the window handler, which hears Del too while the
    // pointer is over the canvas.
    const onCanvasKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); stepSelection(1); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); stepSelection(-1); }
        // Del deletes what is selected, as one step (#1388, SC5).
        else if ((e.key === "Delete" || e.key === "Backspace") && deleteSelection()) e.preventDefault();
        // Enter opens what is selected in Details (#1391, D34): something must be.
        else if (e.key === "Enter" && onOpen !== undefined) {
            const snap = renderSnapRef.current;
            if (snap.selection.selected.size > 0 || snap.zoneSelection.size > 0 || snap.selectedLink !== null) {
                e.preventDefault();
                onOpen();
            }
        }
    }, [stepSelection, deleteSelection, onOpen]);

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
    }, [transition, requestRender]);

    // Drag-pan + tap-to-pick on the canvas. The pick runs on POINTERUP, not the
    // `click` event: onCanvasPointerDown captures the pointer for the drag, and
    // a captured pointer's click is delivered to the capturing box — not the
    // inner <canvas> — so a click handler there never fires for a marker /
    // footprint tap (issue #57, P11). `moved` distinguishes a pan from a tap.
    const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
    // Pinch-zoom (#353): live touch points on the canvas; two concurrent
    // touches zoom about their midpoint (the wheel-zoom math reused).
    const touchesRef = useRef(new Map<number, { x: number; y: number }>());
    const pinchRef = useRef<{ dist: number } | null>(null);
    const movedRef = useRef(false);

    // Pick the item under a tap. Card-tier hits take precedence over markers
    // (rich cards / footprints are the primary affordance): (1) the footprint
    // shape's exact painted geometry, then (2) the real DOM card under the
    // pointer, then (3) the nearest dot/label marker against its FULL rendered
    // extent (P11). Reads the LIVE camera so a tap maps to what was painted
    // (invariant 4). Returns whether anything was selected. `accept` narrows it
    // to the items a drop's card lands on (#1390).
    const itemKeyAt = useCallback((host: HTMLElement, clientX: number, clientY: number, accept?: (id: string) => boolean): string | undefined => {
        const sz = renderSnapRef.current.size;
        if (sz === null) return undefined;
        const cam = cameraRef.current;
        const ppuLive = renderSnapRef.current.fit * cam.zoom;
        if (ppuLive === 0) return undefined;
        const rect = host.getBoundingClientRect();
        const sx = clientX - rect.left, sy = clientY - rect.top;
        const wxp = (sx - cam.tx) / ppuLive, wyp = (sy - cam.ty) / ppuLive;
        // 1) footprint shape (the exact world-space geometry the painter drew).
        // Items in a locked layer, and the narrowing's context, are non-interactive — the pick falls through them.
        for (const it of visibleItems) {
            if (inertKeys.has(it.key)) continue;
            if (accept !== undefined && !accept(it.key)) continue;
            if ((tiers.get(it.key) ?? lod) !== "card") continue;
            const fp = getSomeorUndefined(it.footprint);
            if (fp === undefined || fp.type === "rect") continue;
            // Its footprint is drawn about its centre (D22).
            const hit = fp.type === "circle"
                ? Math.hypot(wxp - it.x, wyp - it.y) <= fp.value.radius
                : pointInPolygon(wxp - it.x, wyp - it.y, fp.value.vertices);
            if (hit) return it.key;
        }
        // 2) the real DOM card under the pointer — hit-test the actual rendered
        // element (pixel-accurate), not an estimate of its box. (Locked cards
        // take no pointer, so elementFromPoint already skips them; the
        // guard is belt-and-suspenders.)
        if (typeof document !== "undefined") {
            const cardKey = document.elementFromPoint(clientX, clientY)
                ?.closest("[data-card-key]")?.getAttribute("data-card-key");
            if (cardKey !== null && cardKey !== undefined && !inertKeys.has(cardKey) && (accept === undefined || accept(cardKey))) return cardKey;
        }
        // 3) dot / label markers: nearest hit against the full rendered extent (P11).
        const ctx = drawRef.current?.getContext("2d") ?? null;
        const labelFont = renderSnapRef.current.palette?.labelFont;
        // Measure label widths with the painter's font so the hitbox matches the
        // drawn pill; save/restore so the pick never leaks font state.
        const measuring = ctx !== null && labelFont !== undefined;
        if (measuring) { ctx.save(); ctx.font = labelFont; }
        const camScreen = { ppu: ppuLive, tx: cam.tx, ty: cam.ty };
        let best: DrawnItem | null = null, bestD = Infinity;
        for (const it of visibleItems) {
            if (inertKeys.has(it.key)) continue;
            if (accept !== undefined && !accept(it.key)) continue;
            const tier = tiers.get(it.key) ?? lod;
            if (tier === "card") continue;
            const box = markerHitbox(it, tier, camScreen, t => measuring ? ctx.measureText(t).width : t.length * 6);
            if (!markerHit(box, sx, sy)) continue;
            const d = Math.hypot(it.x * ppuLive + cam.tx - sx, it.y * ppuLive + cam.ty - sy);
            if (d < bestD) { best = it; bestD = d; }
        }
        if (measuring) ctx.restore();
        return best?.key;
    }, [tiers, lod, visibleItems, inertKeys]);
    const pickAt = useCallback((host: HTMLElement, clientX: number, clientY: number, additive: boolean): boolean => {
        const key = itemKeyAt(host, clientX, clientY);
        if (key === undefined) return false;
        // A plain tap replaces the selection; a Shift+tap toggles the item (extends the set).
        const shiftAdd = additive;
        let next: Set<string>;
        if (shiftAdd) {
            next = new Set(renderSnapRef.current.selection.selected);
            if (next.has(key)) next.delete(key); else next.add(key);
        } else {
            next = new Set([key]);
        }
        // A tap selects in place: Find, the Index and the arrow keys fly (D34). A plain tap selects the item alone,
        // letting go of the zones and the link or net (D16, #1391).
        commitSelection(next, { anchor: key });
        if (!shiftAdd) {
            clearZoneSelection();
            commitLinkSelection(null);
        }
        return true;
    }, [itemKeyAt, commitSelection, clearZoneSelection, commitLinkSelection]);
    // A tap on a density raster's cell that holds rows (#1393, D25, SC36): the view it zooms into — about the tap, shaped
    // as the canvas is, halved until the density counts no more rows in it than draw, with room for the fly's own margin
    // — so the rows draw there, from whatever zoom the tap was made at; never past the zoom's limit. `undefined` off the
    // density.
    const densityTap = useCallback((host: HTMLElement, clientX: number, clientY: number): { x: number; y: number; w: number; h: number } | undefined => {
        const snap = renderSnapRef.current;
        if (snap.density.size === 0 || snap.size === null) return undefined;
        const cam = cameraRef.current;
        const ppuLive = snap.fit * cam.zoom;
        if (ppuLive === 0) return undefined;
        const rect = host.getBoundingClientRect();
        const x = (clientX - rect.left - cam.tx) / ppuLive, y = (clientY - rect.top - cam.ty) / ppuLive;
        const rasters = [...snap.density.values()];
        const onCell = rasters.some((raster) => raster.cells.some((cell) =>
            cell.count > 0 && x >= cell.minX && x < cell.minX + raster.side && y >= cell.minY && y < cell.minY + raster.side));
        if (!onCell) return undefined;
        const extent = { minX: 0, minY: 0, maxX: W, maxY: H };
        // The narrowest view the zoom reaches, in world units.
        const least = snap.size.w / (snap.fit * snap.maxZoom);
        let w = snap.size.w / ppuLive, h = snap.size.h / ppuLive;
        for (;;) {
            w /= 2;
            h /= 2;
            const box = { minX: x - w / 2, minY: y - h / 2, maxX: x + w / 2, maxY: y + h / 2 };
            const rows = rasters.reduce((n, raster) => n + densityInView(raster, box, extent).rows, 0);
            if (rows <= DENSITY_TAP_ROWS || w <= least) return { x: box.minX, y: box.minY, w, h };
        }
    }, [W, H]);
    // A tap selects what is under it (D16): an item, else a link's or a net's line (#176), else an outline zone's body
    // (#177); a tap on nothing lets go of everything. Shift extends, and keeps what is selected on nothing. A tap on the
    // density zooms in until its rows draw there (D25, SC36).
    const tapAt = useCallback((host: HTMLElement, clientX: number, clientY: number, additive: boolean) => {
        drawPending();
        if (pickAt(host, clientX, clientY, additive)) return;
        const dense = densityTap(host, clientX, clientY);
        if (dense !== undefined) {
            flyTo(dense);
            return;
        }
        const lk = linkKeyAt(host, clientX, clientY);
        if (lk !== undefined) { selectLink(lk.key, lk.leg, additive); return; }
        const zk = zoneKeyAt(host, clientX, clientY);
        if (zk !== undefined) zoneTap(zk, additive);
        else if (!additive) { clearSelection(); clearZoneSelection(); commitLinkSelection(null); }
    }, [drawPending, pickAt, densityTap, flyTo, linkKeyAt, selectLink, zoneKeyAt, zoneTap, clearSelection, clearZoneSelection, commitLinkSelection]);

    // Collect the items a marquee region encloses — the pure rule lives in
    // `selection.ts` (`marqueeHits`: R-tree sweep + CENTER-in-region test,
    // skipping locked items and the narrowing's context; layer-hidden items are
    // already absent from `index`, built over the post-filter working set).
    const collectMarquee = useCallback((region: { minX: number; minY: number; maxX: number; maxY: number }): Set<string> =>
        marqueeHits(index, region, layers.locked, narrowedOut),
    [index, layers.locked, narrowedOut]);

    // --- Drops (#1390): the canvas is one drop cell of the shared drag layer. ----
    // Where a drag rests is worked out from the drawing as it stands: the point
    // under the pointer, for a card that adds or places an item; the entity of
    // the card's kind under it — never a locked layer's — for one that lands on
    // an entity; and marked while the drop there lands.
    const sortOf = useMemo(() => new Map<string, "items" | "zones" | "links">([
        ...value.items.map((kind) => [kind.key, "items"] as const),
        ...value.zones.map((kind) => [kind.key, "zones"] as const),
        ...[...value.links, ...value.nets].map((kind) => [kind.key, "links"] as const),
    ]), [value.items, value.zones, value.links, value.nets]);
    /**
     * The entity of a kind under a client point, by the kind's slot: what a card of that kind lands on. An item's card
     * covers what is drawn under it, as it does from a tap: a zone or a link it covers takes no drop there.
     */
    const entityAt = useCallback((kind: string, clientX: number, clientY: number): SchematicRef | undefined => {
        const host = canvasRef.current;
        if (host === null) return undefined;
        const accept = (id: string): boolean => { const ref = refById.get(id); return ref !== undefined && stringEqual(ref.kind, kind); };
        const sort = sortOf.get(kind);
        if (sort !== "items" && typeof document !== "undefined") {
            const covering = document.elementFromPoint(clientX, clientY)?.closest("[data-card-key]")?.getAttribute("data-card-key");
            if (covering !== null && covering !== undefined && !inertKeys.has(covering)) return undefined;
        }
        const id = sort === "items" ? itemKeyAt(host, clientX, clientY, accept)
            : sort === "zones" ? zoneKeyAt(host, clientX, clientY, accept)
                : sort === "links" ? linkKeyAt(host, clientX, clientY, accept)?.key : undefined;
        return id === undefined ? undefined : refById.get(id);
    }, [refById, sortOf, itemKeyAt, zoneKeyAt, linkKeyAt, inertKeys]);
    /** Where a drag rests at a client point, for what it carries: the coordinate its drop's `CellRef` names. */
    const resolveDrop = useCallback((clientX: number, clientY: number, payload: DragPayload): CellCoord => {
        const surface = drop?.surface ?? "";
        const card = drop?.cardOf(payload);
        const host = canvasRef.current;
        const snap = renderSnapRef.current;
        if (card === undefined || host === null || snap.size === null || snap.fit === 0) return { surface, row: NOWHERE_AT, slot: "" };
        const rect = host.getBoundingClientRect();
        const cam = cameraRef.current;
        const ppuLive = snap.fit * cam.zoom;
        const point = dropPoint({ x: (clientX - rect.left - cam.tx) / ppuLive, y: (clientY - rect.top - cam.ty) / ppuLive }, ppuLive);
        return { surface, row: printDropAt(restsAt(card, point, (kind) => entityAt(kind, clientX, clientY))), slot: "" };
    }, [drop, entityAt]);
    /**
     * The drop cell's behaviour: the frame's words for where a drag rests, the canvas marking it. The caption is asked
     * each time the drag rests over the canvas, whether its drop lands there or not: the mark follows it — where the
     * drop lands, or nothing where it is refused — and goes when the drag rests elsewhere.
     */
    const dropOptions = useMemo((): DropCellOptions | undefined => {
        if (drop === undefined) return undefined;
        return {
            ...drop.options,
            caption: (coord, payload, allowed) => {
                const card = drop.cardOf(payload);
                const at = readDropAt(coord.row);
                const mark = card === undefined || at === undefined ? undefined : markOf(drop.plan(card, at));
                setDropMark((was) => (markEqual(was, mark) ? was : mark));
                return drop.options.caption(coord, payload, allowed);
            },
            onLeave: () => setDropMark(undefined),
        };
    }, [drop]);
    const dropCell = useDropCell(drop === undefined || size === null ? null : { surface: drop.surface, row: NOWHERE_AT, slot: "" },
        false, drop?.canDrop, resolveDrop, dropOptions);
    const setCanvasElement = useCallback((el: HTMLDivElement | null) => {
        canvasRef.current = el;
        dropCell(el);
        onElement?.(el);
    }, [dropCell, onElement]);
    // An item a drop added or placed (#1390), selected once the drawing draws it — or, a drawing that doesn't, nothing.
    const pendingSelectRef = useRef<{ readonly id: string; readonly seen: unknown } | undefined>(undefined);
    const [selectAsked, setSelectAsked] = useState(0);
    useEffect(() => {
        const pending = pendingSelectRef.current;
        if (pending === undefined) return;
        if (items.some((it) => stringEqual(it.key, pending.id))) {
            pendingSelectRef.current = undefined;
            if (inertKeys.has(pending.id)) return;
            commitSelection(new Set([pending.id]), { anchor: pending.id });
            clearZoneSelection();
            commitLinkSelection(null);
            return;
        }
        // A new drawing that doesn't draw it — its layer hidden, the rail narrowing it out — selects nothing; while a read
        // is in flight, a window that will hold it among them (#1393), it is waited for.
        if (!Object.is(data, pending.seen) && !reading) pendingSelectRef.current = undefined;
    }, [items, data, selectAsked, inertKeys, commitSelection, clearZoneSelection, commitLinkSelection, reading]);

    const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        // What the press hit-tests is what the canvas draws: a camera move waiting on its frame is drawn first.
        drawPending();
        // A press is a gesture: the link lit goes out until no button is held again (#1403).
        setLit(undefined);
        // Pinch-zoom (#353): the second touch starts a pinch — cancel any
        // pan/press in flight; moves are consumed by the pinch until a
        // finger lifts.
        if (e.pointerType === "touch") {
            touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touchesRef.current.size === 2) {
                const [a, b] = [...touchesRef.current.values()];
                pinchRef.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
                panRef.current = null;
                moveDragRef.current = null;
                handlePressRef.current = null;
                movedRef.current = true;
                return;
            }
        }
        // Presses on the canvas's own buttons are theirs. Cards are NOT
        // excluded — a drag-pan can start anywhere, including over a card; a
        // tap (no drag) over the card is resolved by pickAt on pointerup.
        if ((e.target as HTMLElement).closest("button") !== null) return;
        capturePointer(e.currentTarget as HTMLElement, e.pointerId);
        movedRef.current = false;
        // Move tool (#179): a press ON AN ITEM of a kind bound with its patch door
        // starts a reposition drag; when the pressed item is part of the selection
        // the WHOLE selection's movable items move rigidly. An empty press falls
        // through to a pan.
        if (renderSnapRef.current.effectiveTool === "move") {
            const k = itemKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
            const movable = (key: string) => { const ref = refById.get(key); return ref !== undefined && movableKinds.has(ref.kind); };
            if (k !== undefined && movable(k)) {
                transition("cancel");
                const snap = renderSnapRef.current;
                const cam = cameraRef.current;
                const ppuLive = snap.fit * cam.zoom;
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const wxp = ppuLive > 0 ? (e.clientX - r.left - cam.tx) / ppuLive : 0;
                const wyp = ppuLive > 0 ? (e.clientY - r.top - cam.ty) / ppuLive : 0;
                const keys = snap.selection.selected.has(k) ? [...snap.selection.selected].filter(movable) : [k];
                // Each item moving, where the drag found it: drafted, the read's, as the canvas draws it.
                const movers = keys.flatMap((id) => {
                    const c = snap.centers.get(id), ref = refById.get(id);
                    return c === undefined || ref === undefined ? [] : [{ id, ref, x: c.x, y: c.y }];
                });
                moveDragRef.current = { key: k, movers, startWorld: { x: wxp, y: wyp }, delta: { dx: 0, dy: 0 } };
                return;
            }
        }
        // Connector-handle grab (#176): with an editable selected link, a press
        // within a handle's reach that moves past the drag threshold is a
        // RE-TARGET drag (any tool) — the draft anchors at the FIXED end and
        // follows the cursor; let go where it began, it is a tap (SC10). SHIFT
        // skips the handle: Shift-drag from a selected link's endpoint SEEDS a
        // net session instead (plain = retarget, Shift = extend).
        if (!e.shiftKey && renderSnapRef.current.selectedLinkEditable && renderSnapRef.current.selectedLink !== null) {
            const snap = renderSnapRef.current;
            const lk2 = data.links.find(l => l.key === snap.selectedLink?.key);
            const cam2 = cameraRef.current;
            const ppu2 = snap.fit * cam2.zoom;
            if (lk2 !== undefined && ppu2 > 0) {
                const r2 = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const sx2 = e.clientX - r2.left, sy2 = e.clientY - r2.top;
                // Its handles stand at its ends' edges, as the painter draws them (#1403).
                const handles = routesAt({ ppu: ppu2, tx: cam2.tx, ty: cam2.ty })(lk2.key)?.handles;
                const near = (q: Pt | undefined) => q !== undefined && Math.hypot(q.x - sx2, q.y - sy2) <= 10;
                const movingEnd = near(handles?.from) ? "from" as const : near(handles?.to) ? "to" as const : undefined;
                if (movingEnd !== undefined) {
                    transition("cancel");
                    // A tap until it moves: its first move past the threshold starts the drag (onCanvasPointerMove).
                    handlePressRef.current = { key: lk2.key, movingEnd, fixed: movingEnd === "from" ? lk2.to : lk2.from, x: e.clientX, y: e.clientY };
                    return;
                }
            }
        }
        // Connect tool (#176): a press ON AN ITEM starts a connect drag (draft
        // edge to the cursor); an empty press falls through to a pan.
        if (renderSnapRef.current.effectiveTool === "connect") {
            const from = itemKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
            if (from !== undefined) {
                // A non-Shift press starts a NEW proposal — the open session
                // (and its dashed preview) ends now, not at commit.
                if (!e.shiftKey && linkSessionRef.current !== undefined) endLinkSession();
                transition("cancel");
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const cam = cameraRef.current;
                const ppuLive = renderSnapRef.current.fit * cam.zoom;
                const wxp = ppuLive > 0 ? (e.clientX - r.left - cam.tx) / ppuLive : 0;
                const wyp = ppuLive > 0 ? (e.clientY - r.top - cam.ty) / ppuLive : 0;
                connectDragRef.current = { from, additive: e.shiftKey };
                // Shift-drag FROM the SELECTED thing extends it (#189 UX):
                // a selected NET member drags a membership ADD (Extend); a
                // selected link's endpoint SEEDS the session with that link,
                // which the net it grows into absorbs — each only of a kind
                // that writes.
                if (e.shiftKey && linkSessionRef.current === undefined) {
                    const selL = renderSnapRef.current.selectedLink;
                    if (selL !== null && selL.leg === null) {
                        const selNet = data.nets.find(n => stringEqual(n.key, selL.key));
                        const member = selNet !== undefined && (selNet.sources.some((id) => stringEqual(id, from)) || selNet.destinations.some((id) => stringEqual(id, from)));
                        if (selNet !== undefined && member && kinds.nets.get(selNet.ref.kind)?.editable === true) {
                            connectDragRef.current = { from, additive: true, netExtend: selNet.key };
                        } else {
                            const selLink = data.links.find(l => stringEqual(l.key, selL.key));
                            if (selLink !== undefined && (stringEqual(selLink.from, from) || stringEqual(selLink.to, from)) && kinds.links.get(selLink.ref.kind)?.editable === true) {
                                linkSessionRef.current = { links: [selLink.ref], net: undefined };
                            }
                        }
                    }
                }
                setConnectDraft({ from, toWorld: { x: wxp, y: wyp }, target: undefined });
                return;
            }
        }
        // Box tools (#153 zoom, #159 marquee): start a screen-space selection box
        // instead of a pan. `mode` decides the release action; `additive` latches
        // Shift now so a marquee unions rather than replaces.
        if (renderSnapRef.current.isBoxTool) {
            // Cancel any in-flight fly-to so the camera stops moving under the
            // box (the select branch gets this for free via "pointerDown").
            transition("cancel");
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const sx = e.clientX - r.left, sy = e.clientY - r.top;
            const mode = renderSnapRef.current.effectiveTool === "marquee" ? "marquee" as const : "zoom" as const;
            selStartRef.current = { sx, sy, mode, additive: e.shiftKey };
            setBoxDrag({ rect: { x: sx, y: sy, w: 0, h: 0 }, mode, additive: e.shiftKey, hits: EMPTY_STRING_SET });
            return;
        }
        // A background press is "click away" — an open connect session (and its
        // dashed proposal) dismisses, like any pending-selection pattern.
        if (linkSessionRef.current !== null) endLinkSession();
        transition("pointerDown");
        panRef.current = { x: e.clientX, y: e.clientY, tx: cameraRef.current.tx, ty: cameraRef.current.ty };
    }, [drawPending, transition, itemKeyAt, data.links, data.nets, endLinkSession, refById, movableKinds, kinds, routesAt]);
    const onCanvasPointerMove = useCallback((e: React.PointerEvent) => {
        // Pinch-zoom (#353): with two live touches the gesture owns the
        // canvas — zoom about the midpoint, ratio of successive distances.
        if (e.pointerType === "touch" && touchesRef.current.has(e.pointerId)) {
            touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const pinch = pinchRef.current;
            if (pinch && touchesRef.current.size >= 2) {
                const [a, b] = [...touchesRef.current.values()];
                const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
                if (dist > 0 && pinch.dist > 0) {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const mx = (a!.x + b!.x) / 2 - rect.left;
                    const my = (a!.y + b!.y) / 2 - rect.top;
                    transition("wheel");
                    const snap = renderSnapRef.current;
                    cameraRef.current = zoomAbout(cameraRef.current, dist / pinch.dist, mx, my, 1, snap.maxZoom, snap.home);
                    requestRender();
                }
                pinch.dist = dist;
                return;
            }
        }
        // Move drag (#179, SC8): every mover follows the shared world delta,
        // clamped so each stays within the extent — rigidly, the movers keeping
        // their places to one another — previewed until the release records it.
        const md = moveDragRef.current;
        if (md !== null) {
            const host = e.currentTarget as HTMLElement;
            const r = host.getBoundingClientRect();
            const cam = cameraRef.current;
            const ppuLive = renderSnapRef.current.fit * cam.zoom;
            if (ppuLive > 0) {
                const delta = clampDelta(md.movers, (e.clientX - r.left - cam.tx) / ppuLive - md.startWorld.x,
                    (e.clientY - r.top - cam.ty) / ppuLive - md.startWorld.y, { width: W, height: H });
                md.delta = delta;
                setDragMoves(new Map(md.movers.map((m) => [m.id, { x: m.x + delta.dx, y: m.y + delta.dy }] as const)));
            }
            return;
        }
        // A press on a handle that moves past the drag threshold is the re-target drag (SC10), its draft following the
        // pointer from this move on.
        const hp = handlePressRef.current;
        if (hp !== null) {
            if (Math.abs(e.clientX - hp.x) <= DRAG_THRESHOLD_PX && Math.abs(e.clientY - hp.y) <= DRAG_THRESHOLD_PX) return;
            handlePressRef.current = null;
            connectDragRef.current = { from: hp.fixed, additive: false, retarget: { key: hp.key, movingEnd: hp.movingEnd } };
        }
        // Connect drag (#176): track the cursor in world coords and snap to a
        // valid target item (anything but the source; locked items never resolve).
        const cd = connectDragRef.current;
        if (cd !== null) {
            const host = e.currentTarget as HTMLElement;
            const r = host.getBoundingClientRect();
            const cam = cameraRef.current;
            const ppuLive = renderSnapRef.current.fit * cam.zoom;
            if (ppuLive > 0) {
                const wxp = (e.clientX - r.left - cam.tx) / ppuLive, wyp = (e.clientY - r.top - cam.ty) / ppuLive;
                const tk = itemKeyAt(host, e.clientX, e.clientY);
                // canConnect veto: the draft never snaps to a forbidden pair.
                // Re-targets validate in the link's REAL direction (the fixed
                // end may be either side).
                const refusal = tk !== undefined && tk !== cd.from ? candidateRefusal(cd, tk) : undefined;
                const ok = tk !== undefined && tk !== cd.from && refusal === undefined;
                const target = ok ? tk : undefined;
                // A vetoed candidate is surfaced, not silent: the draft goes
                // DANGER (red edge + ring on the target, not-allowed cursor), its
                // words kept for the draft to show (#1388).
                const forbidden = tk !== undefined && tk !== cd.from && !ok ? tk : undefined;
                setConnectDraft({
                    from: cd.from, toWorld: { x: wxp, y: wyp }, target,
                    ...(cd.retarget !== undefined ? { retarget: cd.retarget.key } : {}),
                    ...(forbidden !== undefined ? { forbidden, reason: refusal } : {}),
                });
            }
            return;
        }
        // Box-drag: grow the screen-space box from its start corner.
        const sel = selStartRef.current;
        if (sel !== null) {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const cx = e.clientX - r.left, cy = e.clientY - r.top;
            if (Math.abs(cx - sel.sx) > DRAG_THRESHOLD_PX || Math.abs(cy - sel.sy) > DRAG_THRESHOLD_PX) movedRef.current = true;
            const x0 = Math.min(sel.sx, cx), y0 = Math.min(sel.sy, cy), sw = Math.abs(cx - sel.sx), sh = Math.abs(cy - sel.sy);
            // One state write per move keeps the overlay rect on the cursor;
            // the marquee HITS (badge + preview) coalesce to one r-tree pass
            // per FRAME (#183 WS6), so per-move cost stays bounded at
            // thousands of items. Hits here are display-only — pointerup
            // recomputes at commit.
            setBoxDrag(prev => ({ rect: { x: x0, y: y0, w: sw, h: sh }, mode: sel.mode, additive: sel.additive, hits: prev !== null ? prev.hits : EMPTY_STRING_SET }));
            if (sel.mode === "marquee") {
                marqueeRegionRef.current = { x0, y0, sw, sh };
                if (marqueeRafRef.current === null) {
                    marqueeRafRef.current = requestAnimationFrame(() => {
                        marqueeRafRef.current = null;
                        const region = marqueeRegionRef.current;
                        if (region === null || selStartRef.current === null) return;   // drag ended — pointerup owns the commit
                        const camF = cameraRef.current;
                        const ppuF = renderSnapRef.current.fit * camF.zoom;
                        const hits = region.sw > 6 && region.sh > 6 && ppuF > 0
                            ? collectMarquee({
                                minX: (region.x0 - camF.tx) / ppuF, minY: (region.y0 - camF.ty) / ppuF,
                                maxX: (region.x0 + region.sw - camF.tx) / ppuF, maxY: (region.y0 + region.sh - camF.ty) / ppuF,
                            })
                            : EMPTY_STRING_SET;
                        setBoxDrag(prev => prev === null ? prev : { ...prev, hits });
                    });
                }
            }
            return;
        }
        const pan = panRef.current;
        if (!pan) {
            // No gesture under way, no button held and no card dragged over the canvas: the link or the net under the
            // pointer lights (#1403), found through the links' R-tree — as a tap would find it, an item over it first, so
            // nothing lights under a card, a pin or a dot; and nothing under the minimap.
            if (e.buttons === 0 && !dragging) {
                const host = e.currentTarget as HTMLElement;
                const overMinimap = e.target instanceof Element && e.target.closest("[data-schematic-minimap]") !== null;
                setLit(overMinimap || itemKeyAt(host, e.clientX, e.clientY) !== undefined ? undefined : linkKeyAt(host, e.clientX, e.clientY)?.key);
            }
            return;
        }
        if (Math.abs(e.clientX - pan.x) > DRAG_THRESHOLD_PX || Math.abs(e.clientY - pan.y) > DRAG_THRESHOLD_PX) movedRef.current = true;
        cameraRef.current = { ...cameraRef.current, tx: pan.tx + e.clientX - pan.x, ty: pan.ty + e.clientY - pan.y };
        requestRender();
    }, [requestRender, collectMarquee, itemKeyAt, W, H, candidateRefusal, transition, linkKeyAt, dragging]);
    // End an in-progress canvas drag-pan (panning → idle). Returns whether a pan
    // was active; never disturbs a running fly.
    const endPan = useCallback(() => {
        if (panRef.current === null) return false;
        panRef.current = null;
        transition("pointerUp");
        return true;
    }, [transition]);
    const onCanvasPointerUp = useCallback((e: React.PointerEvent) => {
        // Pinch-zoom (#353): a lifted finger ends the pinch; the remaining
        // touch resumes ordinary pan/tap handling.
        if (e.pointerType === "touch") {
            touchesRef.current.delete(e.pointerId);
            if (touchesRef.current.size < 2) pinchRef.current = null;
        }
        // A press on a handle let go where it began (SC10): a tap, which selects what is under it.
        if (handlePressRef.current !== null) {
            handlePressRef.current = null;
            tapAt(e.currentTarget as HTMLElement, e.clientX, e.clientY, e.shiftKey);
            return;
        }
        // Move release (#179, SC8): the move recorded as one step, its preview
        // giving way to its drafts; a release where it began records nothing.
        const md = moveDragRef.current;
        if (md !== null) {
            moveDragRef.current = null;
            if (recordStep(moveEdits(md.movers, md.delta), "move", "move", "", md.movers.length)) endLinkSession();
            setDragMoves(NO_MOVES);
            return;
        }
        // Connect release (#176): over a valid target commits the gesture
        // (session-aware); anywhere else cancels the draft.
        const cd = connectDragRef.current;
        if (cd !== null) {
            connectDragRef.current = null;
            setConnectDraft(null);
            const tk = itemKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
            if (tk !== undefined && tk !== cd.from) {
                const allowed = candidateRefusal(cd, tk) === undefined;
                if (allowed) {
                    if (cd.retarget !== undefined) commitRetarget(cd.retarget.key, cd.retarget.movingEnd, tk);
                    else if (cd.netExtend !== undefined) commitNetExtend(cd.netExtend, cd.from, tk);
                    else commitConnect(cd.from, tk, cd.additive);
                }
            }
            return;
        }
        // Box-drag release: a zoom box flies the view in (#153); a marquee selects
        // the enclosed items (#159).
        const sel = selStartRef.current;
        if (sel !== null) {
            selStartRef.current = null;
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const cx = e.clientX - r.left, cy = e.clientY - r.top;
            const x0 = Math.min(sel.sx, cx), y0 = Math.min(sel.sy, cy);
            const sw = Math.abs(cx - sel.sx), sh = Math.abs(cy - sel.sy);
            setBoxDrag(null);
            const cam = cameraRef.current;
            const ppuLive = renderSnapRef.current.fit * cam.zoom;
            const isBox = sw > 6 && sh > 6 && ppuLive > 0;   // a real box, not a tap / sliver
            if (sel.mode === "zoom") {
                // A real box zooms; a bare tap / sliver instead SELECTS the item under
                // it (empty tap clears) — so you can drag-zoom then click to select.
                if (isBox) flyTo({ x: (x0 - cam.tx) / ppuLive, y: (y0 - cam.ty) / ppuLive, w: sw / ppuLive, h: sh / ppuLive });
                else if (!pickAt(e.currentTarget as HTMLElement, e.clientX, e.clientY, e.shiftKey) && !e.shiftKey) clearSelection();
                return;
            }
            // marquee
            if (isBox) {
                const region = {
                    minX: (x0 - cam.tx) / ppuLive, minY: (y0 - cam.ty) / ppuLive,
                    maxX: (x0 + sw - cam.tx) / ppuLive, maxY: (y0 + sh - cam.ty) / ppuLive,
                };
                const hits = collectMarquee(region);
                // Plain box replaces the selection; Shift+box unions into it.
                const next = sel.additive ? new Set([...renderSnapRef.current.selection.selected, ...hits]) : hits;
                commitSelection(next, hits.size > 0 ? { anchor: [...hits][hits.size - 1]! } : {});
            } else {
                // A bare tap in marquee mode is a tap: an item, a link's line or a zone's body selects; the background
                // clears all (unless Shift).
                tapAt(e.currentTarget as HTMLElement, e.clientX, e.clientY, sel.additive);
            }
            return;
        }
        const wasPress = endPan();
        if (!wasPress || movedRef.current) return;   // not a canvas tap, or it was a drag
        // Select-tool tap: what is under it selects (Shift extends); a tap on empty background clears (unless Shift).
        // The host hears the whole selection after each change, through the funnels' one report.
        tapAt(e.currentTarget as HTMLElement, e.clientX, e.clientY, e.shiftKey);
    }, [endPan, pickAt, tapAt, flyTo, collectMarquee, commitSelection, clearSelection, itemKeyAt, commitConnect, commitRetarget, candidateRefusal, commitNetExtend, recordStep, endLinkSession]);
    // pointercancel / lost capture: a pan OR select-drag that loses its grip
    // mid-gesture must still end (issue #57, P10). After a normal release the
    // pan is already ended (panRef null) so this is a no-op then, and it never
    // cancels a fly the tap may have just started.
    const onCanvasPointerCancel = useCallback(() => {
        movedRef.current = false;
        // A move that loses its pointer records nothing: its items stay where they were (SC8).
        if (moveDragRef.current !== null) {
            moveDragRef.current = null;
            setDragMoves(NO_MOVES);
        }
        connectDragRef.current = null;
        handlePressRef.current = null;
        setConnectDraft(null);
        selStartRef.current = null;
        setBoxDrag(null);
        endPan();
    }, [endPan]);
    const resetView = useCallback(() => {
        transition("cancel");           // cancels a running fly via the mode machine
        cameraRef.current = renderSnapRef.current.home;
        requestRender();
    }, [transition, requestRender]);
    // Double-click: on an entity it opens the selection in the inspector's
    // Details (#1391) — the first click of the pair has already selected it; on
    // the background it fits the view. Locked entities never resolve.
    const onCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
        const host = e.currentTarget as HTMLElement;
        drawPending();
        if (itemKeyAt(host, e.clientX, e.clientY) !== undefined || linkKeyAt(host, e.clientX, e.clientY) !== undefined
            || zoneKeyAt(host, e.clientX, e.clientY) !== undefined) {
            onOpen?.();
            return;
        }
        resetView();
    }, [drawPending, itemKeyAt, linkKeyAt, zoneKeyAt, resetView, onOpen]);
    const zoomBy = useCallback((factor: number) => {
        const snap = renderSnapRef.current;
        const sz = snap.size;
        if (sz === null) return;
        transition("zoom");
        cameraRef.current = zoomAbout(cameraRef.current, factor, sz.w / 2, sz.h / 2, 1, snap.maxZoom, snap.home);
        requestRender();
    }, [transition, requestRender]);

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
        clearZoneSelection, data.links, data.nets, centers, layerHiddenKeys]);

    // Leaving the Connect tool cancels any in-flight draft and ends the session.
    useEffect(() => {
        if (tool !== "connect") {
            connectDragRef.current = null;
            setConnectDraft(null);
            endLinkSession();
        }
    }, [tool, endLinkSession]);

    // Momentary tool overrides (#153): while the schematic is hovered, holding
    // Space → Select, Ctrl → Zoom box, reverting on release. Del deletes what is
    // selected (#1388). Escape (#159) cancels an in-flight gesture or, failing
    // that, clears the selection, and drops a refusal's words. Gated on hover so
    // the page's Space-scroll / Ctrl-modifier is untouched elsewhere — and never
    // on a key typed into a field, Find's box among them, which is the field's,
    // nor one the canvas has heard itself, nor one from a layer portaled out of
    // the frame — a popover, a menu, a Chooser's list — which is the layer's
    // (`keyIsCanvas`); window blur and pointer-leave clear a stuck override.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!hoveredRef.current || e.defaultPrevented || typedInto(e.target) || !keyIsCanvas(canvasRef.current, e.target)) return;
            // preventDefault on EVERY Space (incl. auto-repeat) so the page never
            // scrolls while panning; only the first sets the tool.
            if (e.code === "Space") { e.preventDefault(); if (!e.repeat) setTempTool("select"); }
            else if (e.key === "Control" && !e.repeat) setTempTool("zoom");
            else if (e.key === "Delete" || e.key === "Backspace") { if (deleteSelection()) e.preventDefault(); }
            else if (e.key === "Escape") {
                onRefused(undefined);
                if (moveDragRef.current !== null) { moveDragRef.current = null; setDragMoves(NO_MOVES); }
                else if (connectDragRef.current !== null || handlePressRef.current !== null) { connectDragRef.current = null; handlePressRef.current = null; setConnectDraft(null); }
                else if (selStartRef.current !== null) { selStartRef.current = null; setBoxDrag(null); }
                else if (linkSessionRef.current !== undefined) endLinkSession();
                else if (renderSnapRef.current.selection.selected.size > 0
                    || renderSnapRef.current.zoneSelection.size > 0
                    || renderSnapRef.current.selectedLink !== null) { clearSelection(); clearZoneSelection(); commitLinkSelection(null); }
            }
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
    }, [clearSelection, clearZoneSelection, endLinkSession, deleteSelection, commitLinkSelection, onRefused]);
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
    }, [W, H, requestRender]);

    // Tear down any pending frame / fly on unmount.
    useEffect(() => () => {
        coalescerRef.current?.cancel();
        if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    }, [animRef]);

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

    // `fit` (§10.3): the camera flies to the matches whenever which they are changes — keyed on them, never on where
    // they are, so a zoom or a Move never flies it — and once the canvas has its size, so a narrowing a reload restores
    // is flown to too. A fly over nothing — the narrowing cleared — leaves the camera where it is.
    const fitSignature = useMemo(() => (look.fit && matches.size > 0 ? [...matches].sort(compareString).join("\u0000") : undefined), [look.fit, matches]);
    const sized = size !== null;
    useEffect(() => {
        if (fitSignature === undefined || !sized) return;
        const box = renderSnapRef.current.fitBox;
        if (box !== undefined) flyTo({ x: box.minX, y: box.minY, w: Math.max(box.maxX - box.minX, 1e-3), h: Math.max(box.maxY - box.minY, 1e-3) });
    }, [fitSignature, sized, flyTo]);

    // (The per-commit repaint rides the dep-less snapshot-write effect above —
    // a zone/link-only layer change, a theme switch, or a data change repaints
    // because EVERY commit re-snapshots then applies, and the identity
    // short-circuit makes the no-change case free.)

    return (
        <Box
            ref={setCanvasElement}
            css={styles.canvas}
            data-schematic-canvas=""
            data-tool={effectiveTool}
            data-lod={lod}
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
            {showGrid && size !== null && <Box ref={gridRef} css={styles.grid} />}
            {size !== null && (
                <>
                    <chakra.canvas ref={drawRef} css={styles.paint} />
                    {/* Card layer holds the live `--cam-*` vars (set by
                        applyCamera); each card translates off them, so a
                        camera change is 3 var writes on this parent, never a
                        per-card React re-layout (issue #57, invariant 6). It
                        holds the widest card too, which the recipe reads. */}
                    <Box ref={cardLayerRef} css={styles.cardLayer} data-schematic-cards="" style={CARD_LAYER_STYLE}>
                        {visibleItems.map(item => {
                            // Rich cards are DOM; dots / pins / footprints / zones /
                            // links are painted on the canvas above.
                            if ((tiers.get(item.key) ?? lod) !== "card") return null;
                            // The narrowing's (#1392): context fades — greyed, as the look says — and takes no pointer, as
                            // a locked card; a match wears its emphasis's ring. Each card a component of its own, told how it
                            // stands in values, so a frame the camera moves renders none whose standing holds (#1393).
                            const isContextCard = context.has(item.key);
                            return (
                                <SchematicCard
                                    key={item.key}
                                    item={item}
                                    styles={styles}
                                    observe={observeCard}
                                    selected={renderSelected.has(item.key)}
                                    // Layer treatment: dim + lock (non-selectable — clicks fall
                                    // through to entities beneath, matching the pickAt lock skip).
                                    locked={lockedKeys.has(item.key)}
                                    layerOpacity={layerAlpha.get(item.key)}
                                    contextOpacity={isContextCard ? look.opacity : undefined}
                                    desaturate={isContextCard && look.desaturate}
                                    emphasis={look.emphasis !== undefined && matches.has(item.key) ? look.emphasis : undefined}
                                    forbidden={connectDraft?.forbidden === item.key}
                                    dropTarget={dropMark?.kind === "entity" && stringEqual(dropMark.id, item.key)}
                                />
                            );
                        })}
                        {/* A refused connection's words under the item its draft would end at (SC9), in the shared
                            drag caption, moving with the camera as the cards do. */}
                        {connectDraft?.forbidden !== undefined && connectDraft.reason !== undefined && centers.has(connectDraft.forbidden) && (
                            <Box css={styles.draftCaption} data-schematic-refusal=""
                                style={{ transform: cardTranslateCss(centers.get(connectDraft.forbidden)!.x, centers.get(connectDraft.forbidden)!.y) }}>
                                <div data-drag-caption="" data-refused="">{connectDraft.reason}</div>
                            </Box>
                        )}
                    </Box>
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
