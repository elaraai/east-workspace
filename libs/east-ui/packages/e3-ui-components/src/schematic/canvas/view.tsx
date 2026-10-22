/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's canvas (#1387): the 2D world-coordinate drawing in its
 * frame's main — a Canvas2D paint layer and a DOM card layer under one camera,
 * the minimap and the scale bar at its foot. It holds no control of its own:
 * the frame's toolbar holds the tools, the zoom, Fit, Find and the steps, and
 * drives the camera through this canvas's handle ({@link SchematicCanvasHandle});
 * the tool held and the link kind Connect draws are the frame's. What it draws
 * is its reader's (`data.ts`), each kind's rows as their roles give them, the
 * editing session's drafts in place (`drafted.ts`, #1388); what its layers
 * hide, lock and dim is the frame's (`layers.ts`). Every colour and font it
 * draws is the design system's, read through the theme bridge (`theme.tsx`).
 * Every gesture that writes — Move, Connect and its Shift session, Retarget,
 * Extend and Del — is one step of the editing's history: the gesture's edits
 * (`edits.ts`) recorded through the frame's editing, nothing held here but a
 * Move's preview while its drag is under way.
 *
 * Its gestures, its selection funnels, its camera and its paint path are the
 * ones `CLAUDE.md` holds to its invariants: no render-phase ref write, one
 * commit-phase snapshot, the paint's identity short-circuit, the fly before
 * the commit, and hit-testing that is the drawing.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { findIconDefinition, library, type IconName } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
import RBush from "rbush";
import { ArrayType, StringType, equalFor, none, type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, typedInto, type Origin } from "@elaraai/east-ui-components";
import { LINK_HIT_SLOP, distanceToPolyline, markerHit, markerHitbox, netGeometry, orthogonalize, paintSchematic, parallelLanes as paintParallelLanes, placedVertices, zoneAnchor, LINK_LANE_GAP, type RGB, type SchematicPalette } from "./paint";
import { EMPTY_STRING_SET, type ItemBox, marqueeHits } from "./selection";
import { type LodTier, type NavZone, buildCenterTree, buildNavTree, declutterTiers } from "./model";
import { entityId, refOfId, type DrawnItem, type DrawnZone, type SchematicDrawn, type SchematicRef } from "./drawn";
import {
    type CameraEvent, type CameraMode, type RafCoalescer, type Viewport,
    IDENTITY, cancelsFly, cardTranslateCss, cardWidthCss, makeRafCoalescer, nextMode, zoomAbout,
} from "./camera";
import { SchematicProbe, readPalette, useThemeVersion } from "./theme";
import { entityTints, itemTint, tintAttributes, tintsOf } from "./tints";
import type { SchematicLayerState } from "./layers";
import type { SchematicValue } from "../data.js";
import {
    clampDelta, connectCandidate, connectStep, deleteEdits, editKinds, extendEdits, linkRefusal, moveEdits, retargetEdits,
    type ConnectDragArgs, type ConnectSession, type EditRefusal, type Mover, type NetLeg, type SchematicEdit, type SessionDrawn,
} from "../edits.js";
import type { SchematicStep, SchematicWords } from "../messages.js";
import type { SchematicTool } from "../tools.js";

library.add(fas);

/** What `onSelect` hears: the whole selection, each entity by its kind and key. */
const SelectedType = ArrayType(Schematic.Types.Ref);
const selectedEqual = equalFor(SelectedType);
const stringEqual = equalFor(StringType);

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

const MAX_ZOOM = 40;
/** LOD thresholds in px per world unit: card ⇢ labelled dot ⇢ dot. */
const LOD_CARD_PPU = 30;
const LOD_LABEL_PPU = 16;
/** Item-count threshold for the minimap default. */
const MINIMAP_AUTO = 25;
/** No entity's colour resolved: what the canvas paints by before the probe is first read. */
const NO_TINTS: ReadonlyMap<string, RGB> = new Map();

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

/** Whether an item's status shows as an open ring, as a tentative one does. */
function statusRing(status: DrawnItem["status"]): boolean {
    return status.type === "some" && status.value.ring;
}

/** Whether an item's card draws its dot: it has a status, or a colour of its own (D14). */
function hasDot(item: DrawnItem): boolean {
    return item.status.type === "some" || item.color.type === "some" || item.tone.type === "some";
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

/** What the frame drives the camera and the selection by: its toolbar's zoom, Fit, Find and steps. */
export interface SchematicCanvasHandle {
    /** Zooms about the canvas's middle by a factor. */
    zoomBy(factor: number): void;
    /** Fits the drawing in view. */
    fit(): void;
    /** Steps the selection to the previous item, or the next, flying to it. */
    step(delta: 1 | -1): void;
    /** Flies to an item and selects it: Find's pick. */
    reveal(id: string): void;
}

/** Props of {@link SchematicCanvas}. */
export interface SchematicCanvasProps {
    /** The payload, decoded. */
    readonly value: SchematicValue;
    /** What the canvas draws: its reader's stored rows, the editing session's drafts in place (#1388). */
    readonly data: SchematicDrawn;
    /** What the layers hide, lock and dim. */
    readonly layers: SchematicLayerState;
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
    /** Told whether anything is selected — an item, a zone, a link or a net — as that changes. */
    readonly onSelected: (selected: boolean) => void;
    /** The canvas's handle, the frame's. */
    readonly ref?: Ref<SchematicCanvasHandle> | undefined;
}

/**
 * The Schematic's canvas (see the module docs): map-grade navigation — wheel
 * zoom about the cursor, drag pan, animated fly-to, semantic zoom (status dots
 * ⇢ labelled dots ⇢ full cards), rbush viewport culling, an adaptive scale bar
 * and a minimap with a draggable viewport — and its gestures, each one step of
 * the editing's history.
 */
export const SchematicCanvas = memo(function SchematicCanvas({ value, data, layers, tool, linkKind, words, editing, onRefused, onSelected, ref }: SchematicCanvasProps) {
    const styles = useSlotRecipe({ key: "schematic" })() as SlotStyles;
    const { width: W, height: H } = value.extent;

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
    const scaleUnit = getSomeorUndefined(value.scaleUnit);
    const showGrid = getSomeorUndefined(value.grid) ?? true;
    const showMinimap = getSomeorUndefined(value.minimap) ?? data.items.length >= MINIMAP_AUTO;

    // Each entity's reference by its id on the canvas: what the host hears an
    // entity named by — the links and nets drafted among them, each under its
    // kind's slot and its minted key (#1401, D34).
    const refById = useMemo(() => {
        const refs = new Map<string, SchematicRef>();
        for (const entity of [...data.items, ...data.zones, ...data.links, ...data.nets]) refs.set(entity.key, entity.ref);
        return refs;
    }, [data.items, data.zones, data.links, data.nets]);
    // Whether the selected link writes: its connector handles show, and a re-target writes it.
    const selectedLinkEditable = selectedLink !== null && kinds.links.get(refById.get(selectedLink.key)?.kind ?? "")?.editable === true;
    // Each item's label by its id: what a refusal's words name it by.
    const labelById = useMemo(() => new Map(data.items.map((item) => [item.key, item.label] as const)), [data.items]);
    // Connection veto (#176, #1401 D34): gates the connect GESTURE itself — the
    // one channel behind pairwise links, every Shift-session extension (nets),
    // and endpoint re-targets — so all three obey the same rule. It hears the
    // gesture's candidate: the link or net kind it writes and its two items;
    // `none` allows it, and words refuse it, which the draft shows (#1388).
    // Verdicts cache per (kind, from, to) (reset when the fn changes) so the
    // pointermove probe never re-runs the East function for the same
    // candidate; a THROWING veto logs and ALLOWS (fail-open) so a broken
    // function cannot brick editing.
    const canConnectFn = useMemo(() => getSomeorUndefined(value.canConnect), [value.canConnect]);
    const connectVerdictRef = useRef(new Map<string, string | null>());
    useEffect(() => { connectVerdictRef.current = new Map(); }, [canConnectFn, refById]);
    /** The veto's words for a candidate, or `undefined` when it allows it. */
    const connectRefusal = useCallback((kind: string, from: string, to: string): string | undefined => {
        if (canConnectFn === undefined) return undefined;
        const cacheKey = `${kind}\u0000${from}\u0000${to}`;
        const hit = connectVerdictRef.current.get(cacheKey);
        if (hit !== undefined) return hit ?? undefined;
        let refusal: string | null = null;
        const fromRef = refById.get(from), toRef = refById.get(to);
        if (fromRef !== undefined && toRef !== undefined) {
            try {
                refusal = getSomeorUndefined(canConnectFn({ kind, from: fromRef, to: toRef })) ?? null;
            } catch (err) {
                console.error("[Schematic] canConnect veto failed (allowing):", err);
            }
        }
        connectVerdictRef.current.set(cacheKey, refusal);
        return refusal ?? undefined;
    }, [canConnectFn, refById]);
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
    // a draft, or another session's commit — or taken back by Undo), through the
    // link's funnel, so the host hears it.
    useEffect(() => {
        const prev = renderSnapRef.current.selectedLink;
        if (prev === null) return;
        const net = data.nets.find(n => n.key === prev.key);
        if (net === undefined && !data.links.some(l => l.key === prev.key)) {
            commitLinkSelection(null);
            return;
        }
        // A selected LEG whose endpoint left the net demotes to the whole net.
        if (prev.leg !== null && net !== undefined) {
            const side = prev.leg.end === "source" ? net.sources : net.destinations;
            if (!side.includes(prev.leg.item)) commitLinkSelection({ key: prev.key, leg: null });
        }
    }, [data.links, data.nets, commitLinkSelection]);

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

    // Selection hygiene: prune any selected keys that left the working set (their
    // layer was hidden), and null a dead anchor, so prev/next stepping stays
    // consistent. Only set state when the set actually shrank (fresh Set), so
    // this can't loop.
    useEffect(() => {
        if (selected.size === 0) return;
        const live = new Set(items.map(it => it.key));
        let changed = false;
        const next = new Set<string>();
        for (const k of selected) { if (live.has(k)) next.add(k); else changed = true; }
        // Route the prune through the funnel (not a raw set) so the host hears it.
        // Shrank-only ⇒ no loop.
        if (changed) commitSelection(next);
        // A dead anchor (its item left the working set) is pruned with a PURE,
        // identity-stable updater — no set change, so no callbacks fire.
        setSelection(prev => (prev.anchor !== null && !live.has(prev.anchor)) ? { ...prev, anchor: null } : prev);
    }, [items, selected, commitSelection]);
    // The frame hears whether anything is selected: its toolbar's steps show while something is.
    const anySelected = selected.size > 0 || zoneSelection.size > 0 || selectedLink !== null;
    useEffect(() => { onSelected(anySelected); }, [anySelected, onSelected]);

    const canvasRef = useRef<HTMLDivElement | null>(null);
    const drawRef = useRef<HTMLCanvasElement | null>(null);
    const cardLayerRef = useRef<HTMLDivElement | null>(null);
    const gridRef = useRef<HTMLDivElement | null>(null);

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
    // Move-tool drag (#179): the pressed key, the items moving (a group move rides
    // the selection) where the drag found them, the world start point of the
    // gesture, and the delta it has them at, clamped to the extent (SC8).
    const moveDragRef = useRef<{ key: string; movers: readonly (Mover & { readonly id: string })[]; startWorld: Pt; delta: { dx: number; dy: number } } | null>(null);
    // A refused draft keeps the refusal's words (`reason`) — its kind's, or the veto's — which it shows (SC9).
    const [connectDraft, setConnectDraft] = useState<{ from: string; toWorld: Pt; target: string | undefined; forbidden?: string; reason?: string | undefined } | null>(null);
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

    const fit = size !== null ? Math.min(size.w / W, size.h / H) : 0;
    const ppu = fit * cameraSnapshot.zoom;

    const centers = useMemo(() => {
        const out = new Map<string, Pt>();
        for (const item of items) out.set(item.key, { x: item.x, y: item.y });
        return out;
    }, [items]);

    // World-resolved connect visuals (#176): the draft edge (from item centre to
    // the cursor / snapped target centre) and the open session's edges.
    const connectDraftWorld = useMemo(() => {
        if (connectDraft === null) return undefined;
        const from = centers.get(connectDraft.from);
        if (from === undefined) return undefined;
        const to = connectDraft.target !== undefined ? (centers.get(connectDraft.target) ?? connectDraft.toWorld) : connectDraft.toWorld;
        return {
            from, to, snapped: connectDraft.target !== undefined,
            ...(connectDraft.forbidden !== undefined ? { forbiddenKey: connectDraft.forbidden } : {}),
        };
    }, [connectDraft, centers]);
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

    // The zones nested by containment, and the items in each: what the steps
    // through the items walk (the Index tab's tree, #1389, is built the same way).
    const nav = useMemo(() => buildNavTree(shownZones, items), [shownZones, items]);

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
    // The innermost selectable zone under a screen point: OUTLINE zones only
    // (hatch bands are annotations, mirroring the Index's host contract), honouring
    // explicit circle / polygon geometry, skipping locked-layer zones; smallest
    // containing zone wins so nested cages select before their hall.
    const zoneKeyAt = useCallback((host: HTMLElement, clientX: number, clientY: number): string | undefined => {
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
            if (lockedKeys.has(z.key)) continue;
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
    }, [shownZones, lockedKeys]);
    // The link under a screen point (#176): every visible link's ROUTED screen
    // polyline — fan lanes included, so the clickable path equals the drawn one
    // — tested segment-wise within the stroke weight + slop; nearest wins.
    const linkKeyAt = useCallback((host: HTMLElement, clientX: number, clientY: number): { key: string; leg: NetLeg | null } | undefined => {
        const snap = renderSnapRef.current;
        if (snap.size === null) return undefined;
        const cam = cameraRef.current;
        const ppuLive = snap.fit * cam.zoom;
        if (ppuLive === 0) return undefined;
        const rect = host.getBoundingClientRect();
        const sx = clientX - rect.left, sy = clientY - rect.top;
        const lanes = paintParallelLanes(data.links, l =>
            !layerHiddenKeys.has(l.key) && centers.has(l.from) && centers.has(l.to) && l.via.length === 0);
        let best: { key: string; leg: NetLeg | null } | undefined;
        let bestD = Infinity;
        for (const link of data.links) {
            if (layerHiddenKeys.has(link.key) || lockedKeys.has(link.key)) continue;
            const from = centers.get(link.from), to = centers.get(link.to);
            if (from === undefined || to === undefined) continue;
            const anchors = [from, ...link.via, to].map(q => ({ x: q.x * ppuLive + cam.tx, y: q.y * ppuLive + cam.ty }));
            const lane = lanes.get(link.key);
            if (lane !== undefined) {
                const a0 = anchors[0]!, a1 = anchors[anchors.length - 1]!;
                const len = Math.hypot(a1.x - a0.x, a1.y - a0.y);
                if (len > 1e-6) {
                    const d = (lane.i - (lane.n - 1) / 2) * LINK_LANE_GAP;
                    const ox = -(a1.y - a0.y) / len * d, oy = (a1.x - a0.x) / len * d;
                    for (const q of anchors) { q.x += ox; q.y += oy; }
                }
            }
            const pts = link.route.type === "orthogonal" ? orthogonalize(anchors) : anchors;
            const weight = link.style.value.weight.type === "some" ? link.style.value.weight.value
                : (link.style.type === "solid" ? 2.5 : 1.5);
            const d = distanceToPolyline(pts, sx, sy);
            if (d <= weight / 2 + LINK_HIT_SLOP && d < bestD) { best = { key: link.key, leg: null }; bestD = d; }
        }
        // Nets (#189): trunk, header bars, and every stub are clickable — the
        // SAME netGeometry the painter draws, so the target equals the drawing.
        for (const net of data.nets) {
            if (layerHiddenKeys.has(net.key) || lockedKeys.has(net.key)) continue;
            const srcK = net.sources.filter(k => centers.has(k));
            const dstK = net.destinations.filter(k => centers.has(k));
            const srcPts = srcK.map(k => centers.get(k)!);
            const dstPts = dstK.map(k => centers.get(k)!);
            if (srcPts.length === 0 || dstPts.length === 0) continue;
            const geo = netGeometry(srcPts, dstPts, net.via);
            const toScreen = (q: Pt): Pt => ({ x: q.x * ppuLive + cam.tx, y: q.y * ppuLive + cam.ty });
            const orth = net.route.type === "orthogonal";
            const routePts = (anchors: readonly Pt[]): Pt[] => orth ? orthogonalize(anchors.map(toScreen)) : anchors.map(toScreen);
            const weight = net.style.value.weight.type === "some" ? net.style.value.weight.value
                : (net.style.type === "solid" ? 2.5 : 1.5);
            // Trunk + bars hit the WHOLE net; a stub hits its LEG, as the geometry
            // names each stub's: a side with one member draws no stub (#1388).
            const legOf = (stubIdx: number): NetLeg => {
                const leg = geo.legs[stubIdx]!;
                return leg.end === "source" ? { end: "source", item: srcK[leg.index]! } : { end: "destination", item: dstK[leg.index]! };
            };
            const whole: Pt[][] = [routePts(geo.trunk), ...geo.bars.map(bar => bar.map(toScreen))];
            for (const pl of whole) {
                const d = distanceToPolyline(pl, sx, sy);
                if (d <= (weight + 1) / 2 + LINK_HIT_SLOP && d < bestD) { best = { key: net.key, leg: null }; bestD = d; }
            }
            for (const [i, stub] of geo.stubs.entries()) {
                const d = distanceToPolyline(routePts(stub), sx, sy);
                if (d <= (weight + 1) / 2 + LINK_HIT_SLOP && d < bestD) { best = { key: net.key, leg: legOf(i) }; bestD = d; }
            }
        }
        return best;
    }, [data.links, data.nets, centers, layerHiddenKeys, lockedKeys]);
    // Click-select a link or a net — selection works read-only (inspection
    // channel); the host hears it in the whole selection, named by its kind and key.
    const selectLink = useCallback((key: string, leg: NetLeg | null = null) => {
        commitLinkSelection({ key, leg });
    }, [commitLinkSelection]);

    // Selection stepping order: zones alphabetical (natural-numeric), each
    // zone's items alphabetical within it, nested zones after their
    // parent's own items, floor items last. Computed once per data change;
    // the key→index map makes each step O(1).
    const itemOrder = useMemo(() => {
        const byLabel = (a: { label: string }, b: { label: string }) =>
            a.label.localeCompare(b.label, undefined, { numeric: true });
        const ordered: DrawnItem[] = [];
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

    const lod: LodTier = ppu >= LOD_CARD_PPU ? "card" : ppu >= LOD_LABEL_PPU ? "label" : "dot";
    const centerTree = useMemo(() => buildCenterTree(visibleItems), [visibleItems]);
    const tiers = useMemo(() => declutterTiers(visibleItems, centerTree, lod, ppu, selected), [visibleItems, centerTree, lod, ppu, selected]);

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
        value: paintValue, size, fit, dpr, visibleItems, tiers,
        selection, zoneSelection, renderSelected, centers,
        layerHiddenKeys, layerAlpha,
        effectiveTool, isBoxTool,
        connectDraftWorld,
        selectedLink, selectedLinkEditable,
        palette: null as SchematicPalette | null,
        tints: NO_TINTS,
    };
    const renderSnapRef = useRef(renderSnap);

    // Skip an apply whose inputs are referentially identical to the last —
    // covers redundant idle re-renders / repeated requestRender with no change.
    // (During an active pan the layout-effect apply still repaints, because
    // visibleItems is rebuilt fresh each snapshot; that second paint is accepted
    // — bounded by viewport culling — and keeps canvas LOD lock-step with cards.)
    const lastPaintRef = useRef<{
        zoom: number; tx: number; ty: number; vis: unknown; tiers: unknown;
        sel: ReadonlySet<string>; zsel: ReadonlySet<string>; pal: SchematicPalette | null; tints: unknown; w: number; h: number; dpr: number; val: unknown;
        lay: unknown; alp: unknown;
        dl: unknown; cf: number; slk: unknown; sle: boolean;
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

        const canvas = drawRef.current, pal = snap.palette;
        if (canvas === null || pal === null) return;
        // Connect-flash phase (0..1; -1 = no flash) — animates via the flash rAF.
        const cf = connectFlashRef.current;
        const cfPhase = cf !== null ? Math.min(1, (performance.now() - cf.t0) / 450) : -1;
        const last = lastPaintRef.current;
        if (last !== null
            && last.zoom === cam.zoom && last.tx === cam.tx && last.ty === cam.ty
            && last.vis === snap.visibleItems && last.tiers === snap.tiers
            && last.sel === snap.renderSelected && last.zsel === snap.zoneSelection && last.pal === pal && last.tints === snap.tints
            && last.w === sz.w && last.h === sz.h && last.dpr === dprLive && Object.is(last.val, snap.value)
            && last.lay === snap.layerHiddenKeys && last.alp === snap.layerAlpha
            && last.dl === snap.connectDraftWorld && last.cf === cfPhase
            && last.slk === snap.selectedLink && last.sle === snap.selectedLinkEditable) return;
        lastPaintRef.current = {
            zoom: cam.zoom, tx: cam.tx, ty: cam.ty, vis: snap.visibleItems, tiers: snap.tiers,
            sel: snap.renderSelected, zsel: snap.zoneSelection, pal, tints: snap.tints, w: sz.w, h: sz.h, dpr: dprLive, val: snap.value,
            lay: snap.layerHiddenKeys, alp: snap.layerAlpha,
            dl: snap.connectDraftWorld, cf: cfPhase,
            slk: snap.selectedLink, sle: snap.selectedLinkEditable,
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
            });
        } catch (err) {
            console.error("[Schematic] paint failed (frame skipped):", err);
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
    });

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
        const pad = 1.18;
        // Re-derive the destination from the LIVE viewport every frame, so a
        // resize mid-fly (a pane opening, a window resize) re-aims the landing
        // instead of framing against the stale start-time size/fit.
        const frame = (): Viewport | null => {
            const sz = renderSnapRef.current.size, ft = renderSnapRef.current.fit;
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

    // A canvas tap on a zone body (items always take precedence): a plain tap
    // replaces the zone set; Shift toggles/extends — mirroring the item tap
    // semantics. A tap selects in place: Find, the Index and the arrow keys fly.
    const zoneTap = useCallback((key: string, additive: boolean) => {
        let next: Set<string>;
        if (additive) {
            next = new Set(renderSnapRef.current.zoneSelection);
            if (next.has(key)) next.delete(key); else next.add(key);
        } else {
            next = new Set([key]);
        }
        commitZoneSelection(next);
    }, [commitZoneSelection]);
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
    // its links — each new row's key minted, one step; then the flash.
    const commitConnect = useCallback((from: string, to: string, shift: boolean) => {
        if (editing === undefined) return;
        const args = dragArgs({ from, additive: shift }, to);
        if (args === undefined) return;
        const minted = new Set<string>();
        const step = connectStep(kinds, args, (slot) => {
            const key = editing.mint(slot, minted);
            minted.add(key);
            return key;
        }, none);
        if (step === undefined) return;
        const grown = step.edits.find((edit) => edit.op === "net" || edit.op === "sides");
        const slot = (grown ?? step.edits.find((edit) => edit.op === "link"))?.ref.kind;
        if (slot === undefined) return;
        const name = (grown !== undefined ? kinds.nets.get(slot)?.name : kinds.links.get(slot)?.name) ?? slot;
        if (!recordStep(step.edits, "insert", grown !== undefined ? "net" : "connect", name, 1)) return;
        linkSessionRef.current = step.session;
        connectFlashRef.current = { from, to, t0: performance.now() };
        startConnectFlash();
    }, [editing, dragArgs, kinds, recordStep, startConnectFlash]);
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
        flyTo({ x: item.x - 4, y: item.y - 3, w: 8, h: 6 });
        // A fly-to focus (Find's pick / a step) is always single-focus
        // REPLACE — its purpose is the camera move; Shift-add is marquee-only.
        commitSelection(new Set([item.key]), { anchor: item.key });
    }, [flyTo, commitSelection]);
    const stepSelection = useCallback((delta: number) => {
        const { ordered, indexOf } = itemOrder;
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
    }, [stepSelection, deleteSelection]);

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
    // (invariant 4). Returns whether anything was selected.
    const itemKeyAt = useCallback((host: HTMLElement, clientX: number, clientY: number): string | undefined => {
        const sz = renderSnapRef.current.size;
        if (sz === null) return undefined;
        const cam = cameraRef.current;
        const ppuLive = renderSnapRef.current.fit * cam.zoom;
        if (ppuLive === 0) return undefined;
        const rect = host.getBoundingClientRect();
        const sx = clientX - rect.left, sy = clientY - rect.top;
        const wxp = (sx - cam.tx) / ppuLive, wyp = (sy - cam.ty) / ppuLive;
        // 1) footprint shape (the exact world-space geometry the painter drew).
        // Items in a locked layer are non-interactive — the pick falls through them.
        for (const it of visibleItems) {
            if (lockedKeys.has(it.key)) continue;
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
            if (cardKey !== null && cardKey !== undefined && !lockedKeys.has(cardKey)) return cardKey;
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
            if (lockedKeys.has(it.key)) continue;
            const tier = tiers.get(it.key) ?? lod;
            if (tier === "card") continue;
            const box = markerHitbox(it, tier, camScreen, t => measuring ? ctx.measureText(t).width : t.length * 6);
            if (!markerHit(box, sx, sy)) continue;
            const d = Math.hypot(it.x * ppuLive + cam.tx - sx, it.y * ppuLive + cam.ty - sy);
            if (d < bestD) { best = it; bestD = d; }
        }
        if (measuring) ctx.restore();
        return best?.key;
    }, [tiers, lod, visibleItems, lockedKeys]);
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
        // A tap selects in place: Find, the Index and the arrow keys fly (D34).
        commitSelection(next, { anchor: key });
        return true;
    }, [itemKeyAt, commitSelection]);

    // Collect the items a marquee region encloses — the pure rule lives in
    // `selection.ts` (`marqueeHits`: R-tree sweep + CENTER-in-region test,
    // skipping locked items; layer-hidden items are already absent from
    // `index`, built over the post-filter working set).
    const collectMarquee = useCallback((region: { minX: number; minY: number; maxX: number; maxY: number }): Set<string> =>
        marqueeHits(index, region, lockedKeys, EMPTY_STRING_SET),
    [index, lockedKeys]);

    const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
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
                movedRef.current = true;
                return;
            }
        }
        // Presses on the canvas's own buttons are theirs. Cards are NOT
        // excluded — a drag-pan can start anywhere, including over a card; a
        // tap (no drag) over the card is resolved by pickAt on pointerup.
        if ((e.target as HTMLElement).closest("button") !== null) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
        // Connector-handle grab (#176): with an editable selected link, pressing
        // within a handle's reach starts a RE-TARGET drag (any tool) — the draft
        // anchors at the FIXED end and follows the cursor. SHIFT skips the
        // handle: Shift-drag from a selected link's endpoint SEEDS a net
        // session instead (plain = retarget, Shift = extend).
        if (!e.shiftKey && renderSnapRef.current.selectedLinkEditable && renderSnapRef.current.selectedLink !== null) {
            const snap = renderSnapRef.current;
            const lk2 = data.links.find(l => l.key === snap.selectedLink?.key);
            const cam2 = cameraRef.current;
            const ppu2 = snap.fit * cam2.zoom;
            if (lk2 !== undefined && ppu2 > 0) {
                const r2 = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const sx2 = e.clientX - r2.left, sy2 = e.clientY - r2.top;
                const fC = snap.centers.get(lk2.from), tC = snap.centers.get(lk2.to);
                const near = (c: { x: number; y: number } | undefined) =>
                    c !== undefined && Math.hypot(c.x * ppu2 + cam2.tx - sx2, c.y * ppu2 + cam2.ty - sy2) <= 10;
                const movingEnd = near(fC) ? "from" as const : near(tC) ? "to" as const : undefined;
                if (movingEnd !== undefined) {
                    transition("cancel");
                    const fixed = movingEnd === "from" ? lk2.to : lk2.from;
                    connectDragRef.current = { from: fixed, additive: false, retarget: { key: lk2.key, movingEnd } };
                    setConnectDraft({ from: fixed, toWorld: { x: (sx2 - cam2.tx) / ppu2, y: (sy2 - cam2.ty) / ppu2 }, target: undefined });
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
    }, [transition, itemKeyAt, data.links, data.nets, endLinkSession, refById, movableKinds, kinds]);
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
                    cameraRef.current = zoomAbout(cameraRef.current, dist / pinch.dist, mx, my, 1, MAX_ZOOM);
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
                setConnectDraft({ from: cd.from, toWorld: { x: wxp, y: wyp }, target, ...(forbidden !== undefined ? { forbidden, reason: refusal } : {}) });
            }
            return;
        }
        // Box-drag: grow the screen-space box from its start corner.
        const sel = selStartRef.current;
        if (sel !== null) {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const cx = e.clientX - r.left, cy = e.clientY - r.top;
            if (Math.abs(cx - sel.sx) > 4 || Math.abs(cy - sel.sy) > 4) movedRef.current = true;
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
        if (!pan) return;
        if (Math.abs(e.clientX - pan.x) > 4 || Math.abs(e.clientY - pan.y) > 4) movedRef.current = true;
        cameraRef.current = { ...cameraRef.current, tx: pan.tx + e.clientX - pan.x, ty: pan.ty + e.clientY - pan.y };
        requestRender();
    }, [requestRender, collectMarquee, itemKeyAt, W, H, candidateRefusal, transition]);
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
            } else if (!pickAt(e.currentTarget as HTMLElement, e.clientX, e.clientY, sel.additive)) {
                // A bare tap in marquee mode: link stroke selects the link, zone
                // body selects the zone; true background clears all (unless Shift).
                const lk = linkKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
                if (lk !== undefined) selectLink(lk.key, lk.leg);
                else {
                    const zk = zoneKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
                    if (zk !== undefined) zoneTap(zk, sel.additive);
                    else if (!sel.additive) { clearSelection(); clearZoneSelection(); commitLinkSelection(null); }
                }
            }
            return;
        }
        const wasPress = endPan();
        if (!wasPress || movedRef.current) return;   // not a canvas tap, or it was a drag
        // Select-tool tap: select the item under it (Shift extends); a tap on empty
        // background clears (unless Shift). The host hears the whole selection
        // after each change, through the funnels' one report.
        if (!pickAt(e.currentTarget as HTMLElement, e.clientX, e.clientY, e.shiftKey)) {
            // No item under the tap: a LINK stroke selects the link (#176), an
            // OUTLINE zone body selects the zone (#177), and a true-background
            // tap clears ALL selections (unless Shift).
            const lk = linkKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
            if (lk !== undefined) selectLink(lk.key, lk.leg);
            else {
                const zk = zoneKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
                if (zk !== undefined) zoneTap(zk, e.shiftKey);
                else if (!e.shiftKey) { clearSelection(); clearZoneSelection(); commitLinkSelection(null); }
            }
        }
    }, [endPan, pickAt, flyTo, collectMarquee, commitSelection, clearSelection, zoneKeyAt, zoneTap, clearZoneSelection, itemKeyAt, commitConnect, commitRetarget, linkKeyAt, selectLink, candidateRefusal, commitNetExtend, commitLinkSelection, recordStep, endLinkSession]);
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
        setConnectDraft(null);
        selStartRef.current = null;
        setBoxDrag(null);
        endPan();
    }, [endPan]);
    const resetView = useCallback(() => {
        transition("cancel");           // cancels a running fly via the mode machine
        cameraRef.current = IDENTITY;
        requestRender();
    }, [transition, requestRender]);
    // Double-click: on an entity it opens the selection in the inspector's
    // Details (#1391) — the first click of the pair has already selected it; on
    // the background it fits the view. Locked entities never resolve.
    const onCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
        const host = e.currentTarget as HTMLElement;
        if (itemKeyAt(host, e.clientX, e.clientY) !== undefined || linkKeyAt(host, e.clientX, e.clientY) !== undefined
            || zoneKeyAt(host, e.clientX, e.clientY) !== undefined) return;
        resetView();
    }, [itemKeyAt, linkKeyAt, zoneKeyAt, resetView]);
    const zoomBy = useCallback((factor: number) => {
        const sz = renderSnapRef.current.size;
        if (sz === null) return;
        transition("zoom");
        cameraRef.current = zoomAbout(cameraRef.current, factor, sz.w / 2, sz.h / 2, 1, MAX_ZOOM);
        requestRender();
    }, [transition, requestRender]);

    // The frame's toolbar drives the camera and the selection through the handle:
    // its zoom, Fit, its steps and Find's pick, which flies to an item and selects it.
    useImperativeHandle(ref, () => ({
        zoomBy,
        fit: resetView,
        step: (delta) => stepSelection(delta),
        reveal: (id) => {
            const item = items.find(it => it.key === id);
            if (item !== undefined) flyToItem(item);
        },
    }), [zoomBy, resetView, stepSelection, items, flyToItem]);

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
    // nor one the canvas has heard itself; window blur and pointer-leave clear a
    // stuck override.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!hoveredRef.current || e.defaultPrevented || typedInto(e.target)) return;
            // preventDefault on EVERY Space (incl. auto-repeat) so the page never
            // scrolls while panning; only the first sets the tool.
            if (e.code === "Space") { e.preventDefault(); if (!e.repeat) setTempTool("select"); }
            else if (e.key === "Control" && !e.repeat) setTempTool("zoom");
            else if (e.key === "Delete" || e.key === "Backspace") { if (deleteSelection()) e.preventDefault(); }
            else if (e.key === "Escape") {
                onRefused(undefined);
                if (moveDragRef.current !== null) { moveDragRef.current = null; setDragMoves(NO_MOVES); }
                else if (connectDragRef.current !== null) { connectDragRef.current = null; setConnectDraft(null); }
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

    // (The per-commit repaint rides the dep-less snapshot-write effect above —
    // a zone/link-only layer change, a theme switch, or a data change repaints
    // because EVERY commit re-snapshots then applies, and the identity
    // short-circuit makes the no-change case free.)

    return (
        <Box
            ref={canvasRef}
            css={styles.canvas}
            data-schematic-canvas=""
            data-tool={effectiveTool}
            {...(connectDraft?.forbidden !== undefined ? { "data-forbidden": "" } : {})}
            tabIndex={0}
            role="application"
            aria-label={words.m.canvasLabel()}
            onKeyDown={onCanvasKeyDown}
            onPointerEnter={() => { hoveredRef.current = true; }}
            onPointerLeave={() => { hoveredRef.current = false; setTempTool(null); }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerCancel}
            onLostPointerCapture={onCanvasPointerCancel}
            onDoubleClick={onCanvasDoubleClick}
        >
            {/* The theme bridge's probe: what the canvas reads its colours and fonts from (#1387). */}
            <SchematicProbe tints={tintIndex.specs} signature={tintIndex.signature} probeRef={probeRef} />
            {/* Grid size/position are driven imperatively by applyCamera so
                they stay locked to the same camera frame as the canvas. */}
            {showGrid && size !== null && <Box ref={gridRef} css={styles.grid} />}
            {size !== null && (
                <>
                    <chakra.canvas ref={drawRef} css={styles.paint} />
                    {/* Card layer holds the live `--cam-*` vars (set by
                        applyCamera); each card translates off them, so a
                        camera change is 3 var writes on this parent, never a
                        per-card React re-layout (issue #57, invariant 6). */}
                    <Box ref={cardLayerRef} css={styles.cardLayer}>
                        {visibleItems.map(item => {
                            // Rich cards are DOM; dots / pins / footprints / zones /
                            // links are painted on the canvas above.
                            if ((tiers.get(item.key) ?? lod) !== "card") return null;
                            const isSelected = renderSelected.has(item.key);
                            // Layer treatment: dim + lock (non-selectable — clicks fall
                            // through to entities beneath, matching the pickAt lock skip).
                            const isLockedCard = lockedKeys.has(item.key);
                            const cardOpacity = layerAlpha.get(item.key);
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
                                    {...(isLockedCard ? { "data-locked": "" } : {})}
                                    {...(connectDraft?.forbidden === item.key ? { "data-forbidden": "" } : {})}
                                    style={{
                                        left: 0, top: 0,
                                        transform: `${cardTranslateCss(item.x, item.y)} translate(-50%, -50%)`,
                                        ...(width !== undefined ? { width: cardWidthCss(width) } : {}),
                                        ...(cardOpacity !== undefined ? { "--schematic-layer-opacity": String(cardOpacity) } : {}),
                                    }}
                                >{/* No onClick / stopPropagation: a drag-pan can start on a
                                    card, and a tap is resolved by the canvas pickAt (pointerup). */}
                                    <Box css={styles.itemHead}>
                                        {iconDef !== undefined && (
                                            <Box as="span" css={styles.itemIcon}><FontAwesomeIcon icon={iconDef} /></Box>
                                        )}
                                        <Box as="span" css={styles.itemLabel}>{item.label}</Box>
                                        {/* Its colour: its colour token, else its tone, else its status's — its markers' on the canvas (D14, SC26). */}
                                        {hasDot(item) && <Box as="span" css={styles.statusDot} {...tintAttributes(itemTint(item))} {...(statusRing(item.status) ? { "data-ring": "" } : {})} />}
                                    </Box>
                                    {sublabel !== undefined && <Box css={styles.itemSublabel}>{sublabel}</Box>}
                                    {meter !== undefined && (
                                        <Box css={styles.meterTrack} data-meter="">
                                            <Box css={styles.meterFill} style={{ width: `${meter.max > 0 ? Math.min(100, (meter.value / meter.max) * 100) : 0}%` }} />
                                        </Box>
                                    )}
                                    {metric !== undefined && <Box css={styles.itemMetric}>{metric}</Box>}
                                </Box>
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
                    {showMinimap && (
                        <Box
                            css={styles.minimap}
                            data-schematic-minimap=""
                            title={words.m.minimapHint()}
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
                            {shownZones.map(zone => (
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
    );
});
