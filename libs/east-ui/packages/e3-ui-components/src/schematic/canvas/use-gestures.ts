/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic canvas's gestures (#57, #153, #159, #176, #179, #189, #353):
 * the pointer handlers over the camera's mode machine — a pan, a pinch, the
 * zoom box and the marquee, Move and its preview (invariant 4), Connect and its
 * Shift session (invariant 11), Retarget and Extend, each held to the host's
 * veto (invariant 6), and the taps, each hit-testing what the painter draws
 * (invariant 9); the canvas's keys, and the window's while the pointer is over
 * it (invariant 16); and the link or the net lit under the pointer (#1403,
 * invariant 12). Every gesture that writes is one step of the editing's
 * history (`../edits.ts`, #1388).
 *
 * The commit-phase snapshot reads the gestures' state (`use-paint.ts`,
 * invariant 1), and the handlers read the snapshot: {@link useGestureState}
 * holds the state — the tool in force, a Move's preview, Connect's draft and
 * its flash, the box in flight and the link lit — and is made before the
 * snapshot; {@link useGestures} holds the handlers, and is made after it.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type RBush from "rbush";
import { StringType, equalFor, type option } from "@elaraai/east";
import { SCHEMATIC_WINDOW_ROWS } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, typedInto, type Origin } from "@elaraai/east-ui-components";
import { densityInView } from "../area.js";
import type { SchematicValue } from "../data.js";
import {
    clampDelta, connectCandidate, connectStep, connectVeto, deleteEdits, editKinds, extendEdits, linkRefusal, moveEdits, retargetEdits,
    type ConnectDragArgs, type ConnectSession, type EditRefusal, type Mover, type NetLeg, type SchematicEdit, type SessionDrawn,
} from "../edits.js";
import type { SchematicStep, SchematicWords } from "../messages.js";
import type { SchematicTool } from "../tools.js";
import { zoomAbout } from "./camera";
import { entityId, refOfId, type DrawnItem, type DrawnLink, type DrawnNet, type DrawnZone, type SchematicDrawn, type SchematicRef } from "./drawn";
import type { SchematicLayerState } from "./layers";
import { markerHit, markerHitbox } from "./markers";
import type { LodTier } from "./model";
import { zoneAnchor } from "./paint";
import { linkRoutes, netRoutes, routeEnv, type EdgeGeometry } from "./routes";
import { EMPTY_STRING_SET, type ItemBox, type LinkIndex, linkAt, marqueeHits } from "./selection";
import type { Camera, CameraMoves } from "./use-camera";
import type { CanvasSelection, SelectionSteps } from "./use-canvas-selection";
import type { Paint } from "./use-paint";
import type { SchematicCanvasEditing } from "./view";

const stringEqual = equalFor(StringType);

/**
 * A connect drag in flight (#176): the item it runs from, whether Shift was
 * held, the end of a selected link it re-targets, or the selected net it
 * extends.
 */
type ConnectDrag = { from: string; additive: boolean; retarget?: { key: string; movingEnd: "from" | "to" }; netExtend?: string };

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
 * What a tap on the density zooms in to: a box whose rows, by the density's own count, draw once the fly frames it —
 * its view the box grown by the fly's margin (1.18 a side, near 1.4 times its rows) still short of the rows a view
 * draws.
 */
const DENSITY_TAP_ROWS = SCHEMATIC_WINDOW_ROWS * 0.6;

/**
 * Captures a pointer for a gesture where it can be (#1393): a pointer no longer active — one the browser cancelled
 * before the handler ran, or one an automation made up — takes no capture, and its gesture runs uncaptured rather than
 * throw out of the handler (`setPointerCapture`'s `NotFoundError`, or `InvalidStateError`).
 */
export function capturePointer(el: Element, pointerId: number): void {
    try {
        el.setPointerCapture(pointerId);
    } catch (err) {
        if (!(err instanceof DOMException)) throw err;
    }
}

/** Lets go of a pointer the element holds: one it never captured, or no longer active, it lets be. */
export function releasePointer(el: Element, pointerId: number): void {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
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

/** What {@link useGestureState} reads. */
export interface GestureStateProps {
    /** The payload, decoded: its kinds, which write and which draw only (`../edits.ts`' `editKinds`). */
    readonly value: SchematicValue;
    /** The tool held, the frame's. */
    readonly tool: SchematicTool;
    /** Whether main is below 480px (#1394, D15): a selected link draws no handle, and takes no re-target's drag. */
    readonly narrow: boolean;
    /** Whether what the canvas draws is retained (#1398, CL8): no gesture edits it. */
    readonly retained: boolean;
    /** Each entity's reference by its id on the canvas. */
    readonly refById: ReadonlyMap<string, SchematicRef>;
    /** The link or the net selected, and a net's leg (`use-canvas-selection.ts`). */
    readonly selectedLink: CanvasSelection["selectedLink"];
    /** The items selected (`use-canvas-selection.ts`): what a Shift marquee unions into. */
    readonly selected: ReadonlySet<string>;
}

/**
 * The gestures' state (see the module docs).
 *
 * @param props - The payload, the tool held, the layout and what stands in, each entity's reference, and what is
 *   selected
 * @returns The kinds as the edits read them, the link lit, whether the selected link writes, a Move's preview — each
 *   item its drag moves, where it has it — the tool in force, Connect's draft and its flash, and the box in flight and
 *   its preview
 */
export function useGestureState({ value, tool, narrow, retained, refById, selectedLink, selected }: GestureStateProps) {
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
    // The link or the net under the pointer (#1403), lit: drawn last in the strong ink, its ends ringed, and named in
    // `data-lit-link`. It lights while no gesture is under way, and nothing opens on it (invariant 12).
    const [lit, setLit] = useState<string | undefined>(undefined);
    // Whether the selected link writes: its connector handles show, and a re-target writes it — never below 480px of main,
    // where the inspector's ends re-target it (#1394, D15), nor while what the canvas draws is retained (#1398, CL8).
    const selectedLinkEditable = !narrow && !retained && selectedLink !== null && kinds.links.get(refById.get(selectedLink.key)?.kind ?? "")?.editable === true;
    // --- A Move's preview (#179, #1388) — while its drag is under way. ----------
    // Each item the drag moves, where it has it: applied UPSTREAM of the working set
    // so centers / rbush / LOD / nav / link endpoints all follow it. The release
    // records the move as one step, its preview going as its drafts draw; Esc or a
    // lost pointer drops the preview and records nothing (SC8).
    const [dragMoves, setDragMoves] = useState<ReadonlyMap<string, Pt>>(NO_MOVES);

    // Interaction tool, the frame's (§6.1): Select drag-pans and tap-selects
    // (#153); Zoom box drags a box the view flies into (#153); Marquee drags a
    // box that selects the enclosed items (#159); Connect (#176) and Move (#179)
    // edit. Both box tools share the drag machinery — `isBoxTool` gates it.
    // Momentary keyboard overrides — hold Space (Select) / Ctrl (Zoom box) while
    // hovering — set `tempTool`; `effectiveTool` is what the cursor + drag obey.
    const [tempTool, setTempTool] = useState<"select" | "zoom" | null>(null);
    const effectiveTool = tempTool ?? tool;
    const isBoxTool = effectiveTool === "zoom" || effectiveTool === "marquee";
    // A refused draft keeps the refusal's words (`reason`) — its kind's, or the veto's — which it shows (SC9). A
    // retarget's names the link it moves (`retarget`), drawn as its `was` line while its end is dragged (#1403).
    const [connectDraft, setConnectDraft] = useState<{
        from: string; toWorld: Pt; target: string | undefined; retarget?: string; forbidden?: string; reason?: string | undefined;
    } | null>(null);
    // One-shot connect flash (the draw-in + endpoint rings), driven by a short
    // rAF loop like the pulse ticker — phase read at paint time from the ref.
    const connectFlashRef = useRef<{ from: string; to: string; t0: number } | null>(null);
    const flashRafRef = useRef<number | null>(null);
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
    return {
        kinds, movableKinds, lit, setLit, selectedLinkEditable, dragMoves, setDragMoves, setTempTool, effectiveTool, isBoxTool,
        connectDraft, setConnectDraft, connectFlashRef, flashRafRef, setBoxDrag, selRect, marqueeCount, marqueePreview,
    };
}

/** The gestures' state: {@link useGestureState}'s. */
export type GestureState = ReturnType<typeof useGestureState>;

/** What {@link useGestures} reads. */
export interface GesturesProps {
    /** The payload, decoded: its kinds' veto, `canConnect`. */
    readonly value: SchematicValue;
    /** What the canvas draws: its reader's stored rows, the editing session's drafts in place (#1388). */
    readonly data: SchematicDrawn;
    /** What the layers hide, lock and dim. */
    readonly layers: SchematicLayerState;
    /** The tool held, the frame's. */
    readonly tool: SchematicTool;
    /** The link kind Connect draws; `undefined` where no link kind is editable. */
    readonly linkKind: string | undefined;
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /** How the canvas records its gestures; `undefined` where no record is edited. */
    readonly editing: SchematicCanvasEditing | undefined;
    /** Told why a gesture was refused, or — `undefined` — that one has been recorded since. */
    readonly onRefused: (words: string | undefined) => void;
    /** Told when Enter, or a double-click on an entity, opens the selection in the inspector's Details; `undefined` with no inspector. */
    readonly onOpen: (() => void) | undefined;
    /** What a Connect's new link or net takes its other fields from, by its kind's slot (§4.3, #1390). */
    readonly connectValues: (slot: string) => option<Uint8Array>;
    /** The drawing's extent's width, in world units: what a Move is held inside. */
    readonly W: number;
    /** The drawing's extent's height, in world units. */
    readonly H: number;
    /** The canvas's element: what a key the window hears is the canvas's by. */
    readonly canvasRef: RefObject<HTMLDivElement | null>;
    /** Each entity's reference by its id on the canvas. */
    readonly refById: ReadonlyMap<string, SchematicRef>;
    /** Each item's label by its id: what a refusal's words name it by. */
    readonly labelById: ReadonlyMap<string, string>;
    /** What never selects, by any path: a locked layer's entities, and what the narrowing takes out (SC27, #1392). */
    readonly inertKeys: ReadonlySet<string>;
    /** What the narrowing takes out of every list and of the selection, its context among it (#1392). */
    readonly narrowedOut: ReadonlySet<string>;
    /** The zones drawn, a hidden layer's left out: what a tap selects a zone among. */
    readonly shownZones: readonly DrawnZone[];
    /** The items in view: what a tap finds an item among. */
    readonly visibleItems: readonly DrawnItem[];
    /** What each item in view draws as at the zoom. */
    readonly tiers: ReadonlyMap<string, LodTier>;
    /** The tier the zoom's band draws its items at. */
    readonly lod: LodTier;
    /** The items drawn, by their boxes: what the marquee sweeps. */
    readonly index: RBush<ItemBox>;
    /** Each item drawn, by its id: what a link's end is worked out over (#1403). */
    readonly itemById: ReadonlyMap<string, DrawnItem>;
    /** The links' lanes, as the painter fans them (#180). */
    readonly lanes: ReadonlyMap<string, { i: number; n: number }>;
    /** The links' R-tree: what a hover, a tap and a drop search for the link or the net under a point (#1403). */
    readonly linkTree: LinkIndex;
    /** Each link drawn, by its id. */
    readonly linkById: ReadonlyMap<string, DrawnLink>;
    /** Each net drawn, by its id. */
    readonly netById: ReadonlyMap<string, DrawnNet>;
    /** Whether a library card is dragged: nothing lights under the pointer meanwhile. */
    readonly dragging: boolean;
    /** What is selected, and its funnels (`use-canvas-selection.ts`). */
    readonly canvasSelection: CanvasSelection;
    /** The zones' clear and the steps (`use-canvas-selection.ts`). */
    readonly selectionSteps: SelectionSteps;
    /** The camera (`use-camera.ts`). */
    readonly camera: Camera;
    /** What moves the camera (`use-camera.ts`). */
    readonly cameraMoves: CameraMoves;
    /** The commit-phase snapshot and the painter's apply (`use-paint.ts`). */
    readonly paint: Paint;
    /** The gestures' state ({@link useGestureState}'s). */
    readonly gestureState: GestureState;
}

/**
 * The gestures' handlers (see the module docs).
 *
 * @param props - The payload and what the canvas draws, the tool and how the canvas records and tells, the drawing's
 *   extent and what the hit-tests search, what is selected and its funnels, the camera and what moves it, the snapshot,
 *   and the gestures' state
 * @returns Whether the pointer is over the canvas, the canvas's keys, the hit-tests of an item, a zone and a link or a
 *   net under a point, and the pointer's handlers
 */
export function useGestures({
    value, data, layers, tool, linkKind, words, editing, onRefused, onOpen, connectValues, W, H, canvasRef, refById, labelById, inertKeys, narrowedOut,
    shownZones, visibleItems, tiers, lod, index, itemById, lanes, linkTree, linkById, netById, dragging, canvasSelection, selectionSteps, camera,
    cameraMoves, paint, gestureState,
}: GesturesProps) {
    const { commitSelection, clearSelection, commitLinkSelection, commitZoneSelection } = canvasSelection;
    const { clearZoneSelection, stepSelection } = selectionSteps;
    const { cameraRef } = camera;
    const { drawPending, transition, requestRender, flyTo, resetView } = cameraMoves;
    const { renderSnapRef, applyCamera, drawRef, cardSizesRef } = paint;
    const { kinds, movableKinds, setLit, setDragMoves, setTempTool, setConnectDraft, connectFlashRef, flashRafRef, setBoxDrag } = gestureState;
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
    }, [shownZones, inertKeys, renderSnapRef, cameraRef]);
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
    }, [itemById, lanes, linkById, netById, renderSnapRef, drawRef, cardSizesRef]);
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
    }, [linkTree, routesAt, inertKeys, narrowedOut, renderSnapRef, cameraRef]);
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
    }, [commitZoneSelection, commitSelection, commitLinkSelection, renderSnapRef]);
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
    }, [applyCamera, flashRafRef, connectFlashRef]);
    useEffect(() => () => { if (flashRafRef.current !== null) cancelAnimationFrame(flashRafRef.current); }, [flashRafRef]);
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
    }, [editing, dragArgs, kinds, recordStep, startConnectFlash, connectValues, connectFlashRef]);
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
    }, [data.links, refById, kinds, recordStep, endLinkSession, startConnectFlash, connectFlashRef]);
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
    }, [data.nets, refById, sessionDrawn, kinds, recordStep, endLinkSession, startConnectFlash, connectFlashRef]);
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
    }, [editing, kinds, data, onRefused, refusalWords, recordStep, endLinkSession, renderSnapRef]);

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
    }, [stepSelection, deleteSelection, onOpen, renderSnapRef]);

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
    }, [tiers, lod, visibleItems, inertKeys, renderSnapRef, cameraRef, drawRef]);
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
    }, [itemKeyAt, commitSelection, clearZoneSelection, commitLinkSelection, renderSnapRef]);
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
    }, [W, H, renderSnapRef, cameraRef]);
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
        // through to a pan — as every press does while what is drawn is retained
        // (#1398, CL8): no gesture edits it.
        if (renderSnapRef.current.effectiveTool === "move" && !renderSnapRef.current.retained) {
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
        // edge to the cursor); an empty press falls through to a pan, as every
        // press does while what is drawn is retained (#1398, CL8).
        if (renderSnapRef.current.effectiveTool === "connect" && !renderSnapRef.current.retained) {
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
    }, [drawPending, transition, itemKeyAt, data.links, data.nets, endLinkSession, refById, movableKinds, kinds, routesAt, setLit, renderSnapRef, cameraRef,
        setConnectDraft, setBoxDrag]);
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
    }, [requestRender, collectMarquee, itemKeyAt, W, H, candidateRefusal, transition, linkKeyAt, dragging, renderSnapRef, cameraRef, setDragMoves,
        setConnectDraft, setBoxDrag, setLit]);
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
    }, [endPan, pickAt, tapAt, flyTo, collectMarquee, commitSelection, clearSelection, itemKeyAt, commitConnect, commitRetarget, candidateRefusal, commitNetExtend, recordStep, endLinkSession,
        setDragMoves, setConnectDraft, setBoxDrag, cameraRef, renderSnapRef]);
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
    }, [endPan, setDragMoves, setConnectDraft, setBoxDrag]);
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

    // Leaving the Connect tool cancels any in-flight draft and ends the session.
    useEffect(() => {
        if (tool !== "connect") {
            connectDragRef.current = null;
            setConnectDraft(null);
            endLinkSession();
        }
    }, [tool, endLinkSession, setConnectDraft]);

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
    }, [clearSelection, clearZoneSelection, endLinkSession, deleteSelection, commitLinkSelection, onRefused, canvasRef, setTempTool, setDragMoves,
        setConnectDraft, setBoxDrag, renderSnapRef]);
    return {
        hoveredRef, onCanvasKeyDown, itemKeyAt, zoneKeyAt, linkKeyAt, onCanvasPointerDown, onCanvasPointerMove, onCanvasPointerUp, onCanvasPointerCancel,
        onCanvasDoubleClick,
    };
}

/** The gestures' handlers: {@link useGestures}'. */
export type Gestures = ReturnType<typeof useGestures>;
