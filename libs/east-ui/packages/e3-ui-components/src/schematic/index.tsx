/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's renderer — the 2D world-coordinate canvas: a Canvas2D paint
 * layer and a DOM card layer under one camera (`canvas/`), the navigator, the
 * minimap and the controls. The `schematic` slot recipe stays in
 * east-ui-components' theme.
 *
 * The Schematic is e3-ui's (#1384): the renderer registers itself against the
 * `Schematic` extension (`Schematic.Component`) as the module loads. It draws
 * the app's own records (#1386): its reader (`data.ts`) reads each kind's
 * rows and hands the canvas what it draws (`canvas/drawn.ts`), each entity
 * named by its kind's slot and its key. The host hears the whole selection
 * through `onSelect`, and vets a connection through `canConnect`, as the
 * Calendar's host does (#1401, D34).
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { findIconDefinition, library, type IconName } from "@fortawesome/fontawesome-svg-core";
import { fas, faAnglesLeft, faAnglesRight, faBullseye, faCaretRight, faChevronLeft, faChevronRight, faExpand, faEye, faEyeSlash, faHand, faLayerGroup, faLink, faLock, faLockOpen, faMinus, faUpDownLeftRight, faObjectGroup, faObjectUngroup, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import RBush from "rbush";
import { ArrayType, equalFor, equivalentFor, none, variant, type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import {
    getSomeorUndefined,
    implementUIComponent,
    useDataStable,
    usePersistedState,
} from "@elaraai/east-ui-components";
import { LINK_HIT_SLOP, MARKER_LABEL_FONT, distanceToPolyline, markerHit, markerHitbox, netGeometry, orthogonalize, paintSchematic, parallelLanes as paintParallelLanes, placedVertices, zoneAnchor, LINK_LANE_GAP, type SchematicPalette } from "./canvas/paint";
import { EMPTY_STRING_SET, type ItemBox, marqueeHits } from "./canvas/selection";
import { type LodTier, type NavZone, buildCenterTree, buildNavTree, declutterTiers } from "./canvas/model";
import { entityId, type DrawnItem, type DrawnLink, type DrawnNet, type DrawnZone, type SchematicDrawn, type SchematicRef } from "./canvas/drawn";
import { INITIAL_SCHEMATIC_DATA, SchematicDataReader, type SchematicData, type SchematicValue } from "./data";
import {
    type CameraEvent, type CameraMode, type RafCoalescer, type Viewport,
    IDENTITY, cancelsFly, cardTranslateCss, cardWidthCss, makeRafCoalescer, nextMode, zoomAbout,
} from "./canvas/camera";
import { SchematicPaletteProbe } from "./canvas/theme";

library.add(fas);

// The memo compares closures too (#809): a payload whose functions captured new
// data is a new payload, which the reader reads again; what it draws keeps its
// identity while nothing it shows moves, so an in-progress edit or the camera
// is never replaced by a closure-only change.
const schematicEqual = equivalentFor(Schematic.Types.Payload);
const layersEqual = equalFor(ArrayType(Schematic.Types.Layer));
/** What `onSelect` hears: the whole selection, each entity by its kind and key. */
const SelectedType = ArrayType(Schematic.Types.Ref);
const selectedEqual = equalFor(SelectedType);

export type { SchematicValue } from "./data";

/** An item as the canvas draws it. */
export type SchematicItemValue = DrawnItem;

/** A zone as the canvas draws it. */
export type SchematicZoneValue = DrawnZone;

/** A link as the canvas draws it. */
export type SchematicLinkValue = DrawnLink;

/** A net (bus / trunk) as the canvas draws it. */
export type SchematicNetValue = DrawnNet;

/** Fold connect-session gesture pairs into net endpoints with MEMBERSHIP
 *  semantics: the first drag fixes the upstream side; a drag FROM an existing
 *  member adds the NEW item downstream; a drag from a new item INTO the net
 *  joins upstream; a member never flips sides. Shared by the session commit
 *  and the dashed bus preview so the proposal IS what gets reported. */
function foldSessionNet(links: readonly { from: string; to: string }[]): { sources: string[]; destinations: string[] } {
    let sources: string[] = [];
    let destinations: string[] = [];
    for (const l of links) {
        const isMember = (k: string): boolean => sources.includes(k) || destinations.includes(k);
        if (sources.length === 0 && destinations.length === 0) {
            sources = [l.from]; destinations = [l.to];
        } else if (isMember(l.from) && !isMember(l.to)) {
            destinations = [...destinations, l.to];
        } else if (!isMember(l.from) && isMember(l.to)) {
            sources = [...sources, l.from];
        } else if (!isMember(l.from) && !isMember(l.to)) {
            sources = [...sources, l.from];
            destinations = [...destinations, l.to];
        }
        // both ends already members → membership unchanged
    }
    return { sources, destinations };
}

/** One selected net LEG — a stub identified by its side + endpoint item. */
type NetLeg = { end: "source" | "destination"; item: string };

/**
 * A connect drag in flight (#176): the item it runs from, whether Shift was
 * held, the end of a selected link it re-targets, or the selected net it
 * extends.
 */
type ConnectDrag = { from: string; additive: boolean; retarget?: { key: string; movingEnd: "from" | "to" }; netExtend?: string };

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
/** Shared empty layer-override map — the default before any user toggle (stable
 *  identity so it never churns the layer-resolution memo). */
const EMPTY_LAYER_OVERRIDES: Record<string, boolean> = {};

/** Dispatch an author's East callback off the event turn (queueMicrotask, per
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

/** A connect session grown past one pair becomes a NET (#189) of the net kind
 *  the canvas draws in: default solid style, orthogonal trunk, no label /
 *  waypoints / layer. */
function mkCreatedNet(ref: SchematicRef, sources: readonly string[], destinations: readonly string[]): SchematicNetValue {
    return {
        key: entityId(ref),
        ref,
        sources: [...sources],
        destinations: [...destinations],
        label: none, metric: none,
        style: variant("solid", { tone: none, weight: none }),
        route: variant("orthogonal", { corner: none }),
        via: [],
        layer: none,
    } as SchematicNetValue;
}

/** A freshly-drawn link (a connect gesture) of the link kind the Connect tool
 *  draws: default solid style, orthogonal route, no label / waypoints / layer
 *  — constructed with variant()/none per the interop rules. */
function mkCreatedLink(ref: SchematicRef, from: string, to: string): SchematicLinkValue {
    return {
        key: entityId(ref), ref, from, to,
        label: none, metric: none,
        style: variant("solid", { tone: none, weight: none }),
        route: variant("orthogonal", { corner: none }),
        via: [],
        layer: none,
    } as SchematicLinkValue;
}

/** The tone an item's status shows in, if it has one. */
function statusTone(status: SchematicItemValue["status"]): string | undefined {
    return status.type === "some" ? status.value.tone.type : undefined;
}

/** Whether an item's status shows as an open ring, as a tentative one does. */
function statusRing(status: SchematicItemValue["status"]): boolean {
    return status.type === "some" && status.value.ring;
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

/**
 * Draws the Schematic's kinds (e3-ui's `<Schematic>`) — the 2D
 * world-coordinate canvas with map-grade navigation: wheel-zoom about the
 * cursor, drag-pan, animated fly-to, semantic zoom (status dots ⇢ labelled
 * dots ⇢ full cards), rbush viewport culling, an adaptive scale bar, a
 * zones→items navigator and a minimap with a draggable viewport. What it draws
 * is its reader's (`data.ts`): each kind's rows, as their roles give them.
 */
const SchematicCanvas = memo(function SchematicCanvas({ value, data, storageKey }: { value: SchematicValue; data: SchematicDrawn; storageKey: string }) {
    const styles = useSlotRecipe({ key: "schematic" })() as SlotStyles;
    const { width: W, height: H } = value.extent;

    // The host hears the whole selection after each change, each entity by its kind and key (#1401, D34, SC29).
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    // Zone (area) selection (#177) — a separate set from item selection, committed
    // through its own funnel below (declared here so early callbacks can reference it).
    const [zoneSelection, setZoneSelection] = useState<ReadonlySet<string>>(EMPTY_STRING_SET);
    // Editing (#176, #179) follows the kinds' bindings (§1, rule 4): the Connect
    // tool draws the first link kind bound with its patch door, a Shift session
    // grows a net of the first such net kind, and the Move tool moves the items
    // of the item kinds so bound. `readOnly` makes every kind read only.
    const readOnly = value.readOnly;
    const linkKind = readOnly ? undefined : value.links.find(kind => kind.editable)?.key;
    const netKind = readOnly ? undefined : value.nets.find(kind => kind.editable)?.key;
    const linkEditEnabled = linkKind !== undefined;
    const movableKinds = useMemo(() => new Set(readOnly ? [] : value.items.filter(kind => kind.editable).map(kind => kind.key)), [readOnly, value.items]);
    const itemEditEnabled = movableKinds.size > 0;
    // The selected link (single, #176) — selection works even when read-only
    // (inspection, and the host's `onSelect`); the connector handles / delete do not. A net
    // STUB click selects one LEG (`leg` non-null): the halo narrows to that stub
    // and Del removes just that endpoint (#189 follow-up).
    const [selectedLink, setSelectedLink] = useState<{ key: string; leg: NetLeg | null } | null>(null);
    const scaleUnit = getSomeorUndefined(value.scaleUnit);
    const showGrid = getSomeorUndefined(value.grid) ?? true;
    // The navigator lists the zones and the items inside them, while the drawing has zones.
    const showNavigator = data.zones.length > 0;
    const showMinimap = getSomeorUndefined(value.minimap) ?? data.items.length >= MINIMAP_AUTO;

    // --- Local link state (#176, draw mode) — the form-input model. ----------
    // Created / re-targeted / deleted deltas over the links read; a change to
    // the links' DATA REPLACES the local edits (the records are the source of
    // truth on change, like form inputs) — a closure-only change keeps them
    // (#809).
    const [linkEdits, setLinkEdits] = useState<{
        created: readonly SchematicLinkValue[];
        createdNets: readonly SchematicNetValue[];
        retarget: ReadonlyMap<string, { from: string; to: string }>;
        deleted: ReadonlySet<string>;
        /** Leg deletions (#189): full replacement endpoints per edited net. */
        netEdits: ReadonlyMap<string, { sources: readonly string[]; destinations: readonly string[] }>;
    }>({ created: [], createdNets: [], retarget: new Map(), deleted: new Set(), netEdits: new Map() });
    useEffect(() => {
        setLinkEdits({ created: [], createdNets: [], retarget: new Map(), deleted: new Set(), netEdits: new Map() });
    }, [data.links, data.nets]);
    const hasLinkEdits = linkEdits.created.length > 0 || linkEdits.createdNets.length > 0
        || linkEdits.retarget.size > 0 || linkEdits.deleted.size > 0 || linkEdits.netEdits.size > 0;
    const effectiveLinks = useMemo<SchematicLinkValue[]>(() => {
        if (!hasLinkEdits) return data.links;
        const base = data.links
            .filter(l => !linkEdits.deleted.has(l.key))
            .map(l => {
                const rt = linkEdits.retarget.get(l.key);
                return rt !== undefined ? { ...l, from: rt.from, to: rt.to } : l;
            });
        return [...base, ...linkEdits.created];
    }, [data.links, linkEdits, hasLinkEdits]);
    const effectiveNets = useMemo<SchematicNetValue[]>(() => {
        if (!hasLinkEdits) return data.nets;
        // Membership edits apply AFTER the concat so leg-deletes also cover nets
        // created locally this session.
        return [...data.nets.filter(n => !linkEdits.deleted.has(n.key)), ...linkEdits.createdNets].map(n => {
            const e = linkEdits.netEdits.get(n.key);
            return e !== undefined ? { ...n, sources: [...e.sources], destinations: [...e.destinations] } : n;
        });
    }, [data.nets, linkEdits, hasLinkEdits]);
    // Each entity's reference by its id on the canvas: what the host hears an
    // entity named by — the links and nets the canvas drafted among them, each
    // under its kind's slot and the key the canvas gave it (#1401, D34).
    const refById = useMemo(() => {
        const refs = new Map<string, SchematicRef>();
        for (const entity of [...data.items, ...data.zones, ...effectiveLinks, ...effectiveNets]) refs.set(entity.key, entity.ref);
        return refs;
    }, [data.items, data.zones, effectiveLinks, effectiveNets]);
    // Connection veto (#176, #1401 D34): gates the connect GESTURE itself — the
    // one channel behind pairwise links, every Shift-session extension (nets),
    // and endpoint re-targets — so all three obey the same rule. It hears the
    // gesture's candidate: the link or net kind it writes and its two items;
    // `none` allows it, and words refuse it (the draft shows them, #1388).
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
        let words: string | null = null;
        const fromRef = refById.get(from), toRef = refById.get(to);
        if (fromRef !== undefined && toRef !== undefined) {
            try {
                words = getSomeorUndefined(canConnectFn({ kind, from: fromRef, to: toRef })) ?? null;
            } catch (err) {
                console.error("[Schematic] canConnect veto failed (allowing):", err);
            }
        }
        connectVerdictRef.current.set(cacheKey, words);
        return words ?? undefined;
    }, [canConnectFn, refById]);
    // --- Local item positions (#179, move tool) — the form-input model. -------
    // A position overlay over the items read, applied UPSTREAM of the working set
    // so centers / rbush / LOD / nav / link endpoints all follow a move for free;
    // a reactive change to the items' DATA REPLACES the local moves.
    const [itemMoves, setItemMoves] = useState<ReadonlyMap<string, Pt>>(new Map());
    useEffect(() => { setItemMoves(new Map()); }, [data.items]);
    const movedItems = useMemo(() => {
        if (itemMoves.size === 0) return data.items;
        return data.items.map(it => {
            const m = itemMoves.get(it.key);
            return m !== undefined ? { ...it, x: m.x, y: m.y } : it;
        });
    }, [data.items, itemMoves]);
    // The ONE seam feeding local link/net edits to the canvas painter: paint sees
    // a value whose links + nets are the effective sets; everything else untouched.
    // Built over the DATA identity, so a closure-only change never repaints.
    const paintValue = useMemo(() => (hasLinkEdits || itemMoves.size > 0)
        ? { ...data, items: movedItems, links: effectiveLinks, nets: effectiveNets }
        : data,
    [data, movedItems, itemMoves, effectiveLinks, effectiveNets, hasLinkEdits]);

    // Selection state, consolidated (#172): the selected SET and the anchor (the
    // last-touched key driving prev/next stepping, scroll-into-view, and
    // zone-open) commit ATOMICALLY as one object — they can never disagree.
    // Every mutation allocates a FRESH Set so the paint identity short-circuit
    // (lastPaintRef.sel) stays correct.
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
            const selected = ids.flatMap(id => { const ref = refs.get(id); return ref === undefined ? [] : [ref]; });
            if (selectedEqual(heardRef.current, selected)) return undefined;
            heardRef.current = selected;
            return onSelect(selected);
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
    // Selected-link hygiene: clear when the link leaves the effective set
    // (deleted locally or dropped by a prop change), through the link's funnel,
    // so the host hears it.
    useEffect(() => {
        const prev = renderSnapRef.current.selectedLink;
        if (prev === null) return;
        const net = effectiveNets.find(n => n.key === prev.key);
        if (net === undefined && !effectiveLinks.some(l => l.key === prev.key)) {
            commitLinkSelection(null);
            return;
        }
        // A selected LEG whose endpoint left the net demotes to the whole net.
        if (prev.leg !== null && net !== undefined) {
            const side = prev.leg.end === "source" ? net.sources : net.destinations;
            if (!side.includes(prev.leg.item)) commitLinkSelection({ key: prev.key, leg: null });
        }
    }, [effectiveLinks, effectiveNets, commitLinkSelection]);
    const [openZone, setOpenZone] = useState<string | null>(null);
    // Index-rail collapse is a durable layout preference — persist it under
    // `storageKey` (issue #57, P8). The camera and selection are transient
    // interaction state (per the renderer conventions) and stay ephemeral.
    // Consolidated durable prefs: the nav-rail collapse plus the layer-panel
    // visibility / lock overrides (sparse maps: layerKey → user's explicit bool).
    const { state: persisted, setState: setPersisted } = usePersistedState(storageKey,
        { navCollapsed: false, layerVis: {} as Record<string, boolean>, layerLocks: {} as Record<string, boolean> });
    const navCollapsed = persisted.navCollapsed;
    const setNavCollapsed = useCallback((next: boolean) => setPersisted(prev => ({ ...prev, navCollapsed: next })), [setPersisted]);

    // --- Layers: named groups toggled from the layer button. -----------------
    // Visibility / lock are VIEW state (persisted above; solo is transient); the
    // East `layers` carry only the author defaults. None ⇒ no layer chrome.
    const layers = useDataStable(value.layers, layersEqual);
    const hasLayers = layers.length > 0;
    const layerVis = persisted.layerVis ?? EMPTY_LAYER_OVERRIDES;
    const layerLocks = persisted.layerLocks ?? EMPTY_LAYER_OVERRIDES;
    const [soloLayer, setSoloLayer] = useState<string | null>(null);
    const [layersOpen, setLayersOpen] = useState(false);

    // One layer index + author-default accessors, shared by the resolution pass,
    // the panel, and the toggles (no duplicate maps / scans).
    const layerByKey = useMemo(() => new Map(layers.map(l => [l.key, l] as const)), [layers]);
    const authorVisibleOf = useCallback((k: string) => getSomeorUndefined(layerByKey.get(k)?.visible) ?? true, [layerByKey]);
    const authorLockedOf = useCallback((k: string) => getSomeorUndefined(layerByKey.get(k)?.locked) ?? false, [layerByKey]);
    const authorOpacityOf = useCallback((k: string) => getSomeorUndefined(layerByKey.get(k)?.opacity) ?? 1, [layerByKey]);
    // Effective visibility: solo isolates one layer; else a per-layer override,
    // else the author default. Under solo an UNKNOWN layer key stays visible
    // (never soloed away), honouring the "unknown key ⇒ always-visible" contract.
    const layerHidden = useCallback((k: string) =>
        soloLayer !== null ? (layerByKey.has(k) && k !== soloLayer) : ((layerVis[k] ?? authorVisibleOf(k)) === false),
        [soloLayer, layerByKey, layerVis, authorVisibleOf]);

    // Resolve effective visibility / lock / dim per layer, then project onto the
    // entities in one pass. `layerHiddenKeys`/`lockedKeys` are ENTITY keys;
    // `layerHiddenLayers` is the LAYER keys hidden (drives the panel eye state).
    const { layerHiddenKeys, lockedKeys, layerAlpha, layerHiddenLayers } = useMemo(() => {
        const isLocked = (k: string) => layerLocks[k] ?? authorLockedOf(k);
        const hiddenLayers = new Set<string>();
        for (const l of layers) if (layerHidden(l.key)) hiddenLayers.add(l.key);
        const hiddenKeys = new Set<string>();
        const locked = new Set<string>();
        const alpha = new Map<string, number>();
        const scan = (key: string, lk: string | undefined) => {
            if (lk === undefined) return;                 // unlayered ⇒ always visible
            if (layerHidden(lk)) { hiddenKeys.add(key); return; }
            if (isLocked(lk)) locked.add(key);
            const a = authorOpacityOf(lk);
            if (a < 1) alpha.set(key, a);
        };
        for (const it of data.items) scan(it.key, getSomeorUndefined(it.layer));
        for (const z of data.zones) scan(z.key, getSomeorUndefined(z.layer));
        for (const l of data.links) scan(l.key, getSomeorUndefined(l.layer));
        for (const n of data.nets) scan(n.key, getSomeorUndefined(n.layer));
        return { layerHiddenKeys: hiddenKeys, lockedKeys: locked, layerAlpha: alpha, layerHiddenLayers: hiddenLayers };
    }, [layers, data.items, data.zones, data.links, data.nets, layerLocks, layerHidden, authorLockedOf, authorOpacityOf]);
    // The view is "filtered" (drives the button's active state) whenever a layer
    // is hidden or a solo is active.
    const layersFiltered = layerHiddenLayers.size > 0 || soloLayer !== null;

    const layerCounts = useMemo(() => {
        const m = new Map<string, number>();
        const add = (k: string | undefined) => { if (k !== undefined) m.set(k, (m.get(k) ?? 0) + 1); };
        for (const it of data.items) add(getSomeorUndefined(it.layer));
        for (const z of data.zones) add(getSomeorUndefined(z.layer));
        for (const l of data.links) add(getSomeorUndefined(l.layer));
        for (const n of data.nets) add(getSomeorUndefined(n.layer));
        return m;
    }, [data.items, data.zones, data.links, data.nets]);
    // Eye toggle: flip the layer's override off its EFFECTIVE visibility (so it
    // reverses correctly even under a solo, which it clears); lock toggles the
    // non-selectable override; solo isolates one layer; reset clears all.
    const toggleLayerVis = useCallback((key: string) => {
        const nowVisible = !layerHiddenLayers.has(key);
        setSoloLayer(null);
        setPersisted(prev => ({ ...prev, layerVis: { ...(prev.layerVis ?? {}), [key]: !nowVisible } }));
    }, [setPersisted, layerHiddenLayers]);
    const toggleLayerLock = useCallback((key: string) => {
        setPersisted(prev => {
            const lk = prev.layerLocks ?? {};
            const cur = lk[key] ?? authorLockedOf(key);
            return { ...prev, layerLocks: { ...lk, [key]: !cur } };
        });
    }, [setPersisted, authorLockedOf]);
    const toggleSolo = useCallback((key: string) => setSoloLayer(prev => prev === key ? null : key), []);
    const resetLayers = useCallback(() => {
        setSoloLayer(null);
        setPersisted(prev => ({ ...prev, layerVis: {}, layerLocks: {} }));
    }, [setPersisted]);

    // The item working set: layer-hidden is a HARD pre-filter (an off layer means
    // "not at all"). Propagates for free to centers / rbush index / visibleItems /
    // LOD / nav.
    const items = useMemo(() => {
        if (layerHiddenKeys.size === 0) return movedItems;
        return movedItems.filter(it => !layerHiddenKeys.has(it.key));
    }, [movedItems, layerHiddenKeys]);

    // Zones are read at several surfaces (nav TOC, minimap, viewport spy, labels);
    // drop hidden-layer zones once here. Links are filtered inside paint.
    const shownZones = useMemo(
        () => layerHiddenKeys.size === 0 ? data.zones : data.zones.filter(z => !layerHiddenKeys.has(z.key)),
        [data.zones, layerHiddenKeys],
    );

    const [palette, setPalette] = useState<SchematicPalette | null>(null);

    // Selection hygiene: prune any selected keys that left the working set (their
    // layer was hidden), and null a dead anchor, so prev/next stepping stays
    // consistent and the controls' back/forward group hides. Only set state when
    // the set actually shrank (fresh Set), so this can't loop.
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

    // Interaction tool: `grab` drag-pans (default) + tap-selects (#153); `zoom`
    // drags a box the view flies into (#153, was "select"); `marquee` drags a box
    // that selects the enclosed items (#159, only when selectionMode is
    // multiple/range). Both box tools share the drag machinery — `isBoxTool` gates
    // it. Momentary keyboard overrides — hold Space (grab) / Ctrl (zoom) while
    // hovering — set `tempTool`; `effectiveTool` is what the cursor + drag obey.
    const [tool, setTool] = useState<"grab" | "zoom" | "marquee" | "connect" | "move">("grab");
    const [tempTool, setTempTool] = useState<"grab" | "zoom" | null>(null);
    const effectiveTool = tempTool ?? tool;
    const isBoxTool = effectiveTool === "zoom" || effectiveTool === "marquee";
    const hoveredRef = useRef(false);
    // Live screen-space selection box (px, relative to the canvas host) while a
    // box-drag is in flight; drives the dashed overlay and the release action.
    // `mode` distinguishes a zoom-box from a marquee; `additive` latches Shift at
    // pointer-down (marquee unions rather than replaces).
    // Connect-tool gesture (#176): the live drag (pointer-capture scoped) and its
    // render state (the draft edge painted on the canvas). A SESSION accumulates
    // Shift-added connections, the links and the net it draws shown as they are.
    const connectDragRef = useRef<ConnectDrag | null>(null);
    // Move-tool drag (#179): the pressed key, every key moving (group move rides
    // the selection), each mover's ORIGINAL position (for Esc/cancel revert), and
    // the world start point of the gesture.
    const moveDragRef = useRef<{ key: string; keys: readonly string[]; orig: ReadonlyMap<string, Pt>; startWorld: Pt } | null>(null);
    // A vetoed draft keeps the veto's words (`reason`), which the draft shows with the editing session (#1388).
    const [connectDraft, setConnectDraft] = useState<{ from: string; toWorld: Pt; target: string | undefined; forbidden?: string; reason?: string | undefined } | null>(null);
    const linkSessionRef = useRef<{ key: string; links: readonly { key: string; from: string; to: string }[]; drawn: "link" | "net" | "none"; seeded: readonly string[] } | null>(null);
    const linkKeyCounter = useRef(0);
    // The candidate a connect drag would write, vetted (#1401, D34): a re-target
    // writes its link, an Extend its net, a Shift session the net it grows (when
    // there is a net kind to grow), and any other drag a link of the Connect
    // tool's kind. Re-targets vet in the link's REAL direction — the fixed end may
    // be either side. The veto's words, or `undefined` when it allows it.
    const candidateRefusal = useCallback((cd: ConnectDrag, target: string): string | undefined => {
        if (cd.retarget !== undefined) {
            const kind = refById.get(cd.retarget.key)?.kind ?? linkKind;
            if (kind === undefined) return undefined;
            return cd.retarget.movingEnd === "from" ? connectRefusal(kind, target, cd.from) : connectRefusal(kind, cd.from, target);
        }
        const kind = cd.netExtend !== undefined ? refById.get(cd.netExtend)?.kind
            : cd.additive && linkSessionRef.current !== null && netKind !== undefined ? netKind : linkKind;
        return kind === undefined ? undefined : connectRefusal(kind, cd.from, target);
    }, [connectRefusal, refById, linkKind, netKind]);
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
    // (hatch bands are annotations, mirroring the nav's host contract), honouring
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
        let best: SchematicZoneValue | undefined;
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
        const lanes = paintParallelLanes(effectiveLinks, l =>
            !layerHiddenKeys.has(l.key) && centers.has(l.from) && centers.has(l.to) && l.via.length === 0);
        let best: { key: string; leg: NetLeg | null } | undefined;
        let bestD = Infinity;
        for (const link of effectiveLinks) {
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
        for (const net of effectiveNets) {
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
            // Trunk + bars hit the WHOLE net; a stub hits its LEG (stubs are in
            // netGeometry input order: sources then destinations).
            const legOf = (stubIdx: number): NetLeg => stubIdx < srcK.length
                ? { end: "source", item: srcK[stubIdx]! }
                : { end: "destination", item: dstK[stubIdx - srcK.length]! };
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
    }, [effectiveLinks, effectiveNets, centers, layerHiddenKeys, lockedKeys]);
    // Click-select a link or a net — selection works read-only (inspection
    // channel); the host hears it in the whole selection, named by its kind and key.
    const selectLink = useCallback((key: string, leg: NetLeg | null = null) => {
        commitLinkSelection({ key, leg });
    }, [commitLinkSelection]);

    // Duplicate zone labels are real (each floor's halls repeat names) — the
    // navigator needs a unique handle per row, so repeats get an ordinal.
    const zoneDisplay = useMemo(() => {
        const counts = new Map<string, number>();
        const out = new Map<string, string>();
        for (const zone of shownZones) {
            const n = (counts.get(zone.label) ?? 0) + 1;
            counts.set(zone.label, n);
            out.set(zone.key, n > 1 ? `${zone.label} · ${n}` : zone.label);
        }
        return out;
    }, [shownZones]);

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
        for (const z of shownZones) {
            const score = scoreOf(z);
            if (score > bestScore) { best = z.key; bestScore = score; }
        }
        setCurrentZone(prev => {
            if (prev !== undefined) {
                const holder = shownZones.find(z => z.key === prev);
                const holderScore = holder !== undefined ? scoreOf(holder) : 0;
                if (holderScore >= SPY_STAY && (best === prev || bestScore < holderScore + SPY_MARGIN)) return prev;
            }
            return bestScore >= SPY_ENTER ? best : undefined;
        });
    }, [size, ppu, cameraSnapshot, shownZones]);

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
    // dependency list) to drift.
    const renderSnap = {
        value: paintValue, size, fit, dpr, palette, visibleItems, tiers,
        selection, zoneSelection, renderSelected, centers, openZone,
        layerHiddenKeys, layerAlpha,
        effectiveTool, isBoxTool,
        connectDraftWorld,
        selectedLink, linkEditEnabled,
    };
    const renderSnapRef = useRef(renderSnap);

    // Skip an apply whose inputs are referentially identical to the last —
    // covers redundant idle re-renders / repeated requestRender with no change.
    // (During an active pan the layout-effect apply still repaints, because
    // visibleItems is rebuilt fresh each snapshot; that second paint is accepted
    // — bounded by viewport culling — and keeps canvas LOD lock-step with cards.)
    const lastPaintRef = useRef<{
        zoom: number; tx: number; ty: number; vis: unknown; tiers: unknown;
        sel: ReadonlySet<string>; zsel: ReadonlySet<string>; pal: SchematicPalette | null; w: number; h: number; dpr: number; val: unknown;
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
            && last.sel === snap.renderSelected && last.zsel === snap.zoneSelection && last.pal === pal
            && last.w === sz.w && last.h === sz.h && last.dpr === dprLive && Object.is(last.val, snap.value)
            && last.lay === snap.layerHiddenKeys && last.alp === snap.layerAlpha
            && last.dl === snap.connectDraftWorld && last.cf === cfPhase
            && last.slk === snap.selectedLink && last.sle === snap.linkEditEnabled) return;
        lastPaintRef.current = {
            zoom: cam.zoom, tx: cam.tx, ty: cam.ty, vis: snap.visibleItems, tiers: snap.tiers,
            sel: snap.renderSelected, zsel: snap.zoneSelection, pal, w: sz.w, h: sz.h, dpr: dprLive, val: snap.value,
            lay: snap.layerHiddenKeys, alp: snap.layerAlpha,
            dl: snap.connectDraftWorld, cf: cfPhase,
            slk: snap.selectedLink, sle: snap.linkEditEnabled,
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
                selected: snap.renderSelected, selectedZones: snap.zoneSelection, centers: snap.centers, palette: pal,
                // Layer masks for the zone / link paint passes (items are already
                // pre-filtered out of visibleItems); `layerAlpha` dims item markers.
                layerHiddenKeys: snap.layerHiddenKeys, layerAlpha: snap.layerAlpha,
                // Connect-tool overlays (#176): the draft edge and the one-shot commit flash.
                ...(snap.connectDraftWorld !== undefined ? { draftLink: snap.connectDraftWorld } : {}),
                ...(cf !== null ? { connectFlash: { from: snap.centers.get(cf.from), to: snap.centers.get(cf.to), phase: cfPhase } } : {}),
                ...(snap.selectedLink !== null ? {
                    selectedLink: {
                        key: snap.selectedLink.key, editable: snap.linkEditEnabled,
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
    // is no dependency list to drift. `applyCamera`'s identity short-circuit
    // makes the trailing repaint free when nothing paint-relevant changed.
    useLayoutEffect(() => {
        renderSnapRef.current = renderSnap;
        commitCtxRef.current = commitCtx;
        applyCamera();
    });

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
        if (renderSnapRef.current.size === null || renderSnapRef.current.fit === 0) return;
        const pad = 1.18;
        // Re-derive the destination from the LIVE viewport every frame, so a
        // resize mid-fly (nav-rail toggle, splitter drag, window resize) re-aims
        // the landing instead of framing against the stale start-time size/fit.
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
    // End the open connect session (Esc, tool switch, or a plain new drag).
    const endLinkSession = useCallback(() => {
        linkSessionRef.current = null;
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
    // Commit a connect gesture: extend / start the session, draw a link of the
    // Connect tool's kind and play the flash. With a net kind to draw in, a
    // Shift session grows into a net of it.
    const commitConnect = useCallback((from: string, to: string, shift: boolean) => {
        if (linkKind === undefined) return;
        const linkRef = { kind: linkKind, key: `connect-${++linkKeyCounter.current}` };
        const created = mkCreatedLink(linkRef, from, to);
        const ep = { key: created.key, from, to };
        const open = shift ? linkSessionRef.current : null;
        const links = open !== null ? [...open.links, ep] : [ep];
        const seeded = open !== null ? open.seeded : [];
        // The session's net keeps one key across the session's commits (#189).
        const netRef = netKind === undefined ? undefined
            : { kind: netKind, key: open !== null ? open.key : `net-${++linkKeyCounter.current}` };
        const sessionKey = netRef !== undefined ? netRef.key : linkRef.key;
        let drawn: "link" | "net" | "none" = "none";
        if (open === null || netRef === undefined) {
            // A plain drag — or any drag with no net kind to grow — draws a pairwise link.
            drawn = "link";
            setLinkEdits({ ...linkEdits, created: [...linkEdits.created, created] });
        } else {
            // The first Shift-extension CONVERTS the session's pairwise link
            // into a growing NET (same session key, #189); later extensions
            // update that net in place.
            drawn = "net";
            const { sources: netSources, destinations: netDestinations } = foldSessionNet(links);
            const net = mkCreatedNet(netRef, netSources, netDestinations);
            const priorLinkKey = open.drawn === "link" ? open.links[0]?.key : undefined;
            // Seeded (absorbed) links leave the picture with the net's
            // arrival — from BOTH pools: locally-created links are filtered
            // out of `created` (the deleted overlay only guards read links),
            // read links join the deleted overlay.
            const seededSet = new Set(seeded);
            const deleted = seeded.length > 0
                ? new Set([...linkEdits.deleted, ...seeded])
                : linkEdits.deleted;
            setLinkEdits({
                ...linkEdits,
                created: linkEdits.created.filter(l => l.key !== priorLinkKey && !seededSet.has(l.key)),
                createdNets: [
                    ...linkEdits.createdNets.filter(n => n.key !== net.key),
                    net,
                ],
                deleted,
            });
        }
        linkSessionRef.current = { key: sessionKey, links, drawn, seeded };
        connectFlashRef.current = { from, to, t0: performance.now() };
        startConnectFlash();
    }, [linkKind, netKind, linkEdits, startConnectFlash]);
    // Re-target a selected link's endpoint (connector-handle drag): local-first
    // (created links edit in place; read links via the retarget overlay).
    const commitRetarget = useCallback((key: string, movingEnd: "from" | "to", target: string) => {
        const lk = effectiveLinks.find(l => l.key === key);
        if (lk === undefined) return;
        const from = movingEnd === "from" ? target : lk.from;
        const to = movingEnd === "to" ? target : lk.to;
        if (from === to) return;   // a self-link never commits
        const createdIdx = linkEdits.created.findIndex(l => l.key === key);
        if (createdIdx >= 0) {
            const created = [...linkEdits.created];
            created[createdIdx] = { ...created[createdIdx]!, from, to };
            setLinkEdits({ ...linkEdits, created });
        } else {
            const retarget = new Map(linkEdits.retarget);
            retarget.set(key, { from, to });
            setLinkEdits({ ...linkEdits, retarget });
        }
        connectFlashRef.current = { from, to, t0: performance.now() };
        startConnectFlash();
    }, [effectiveLinks, linkEdits, startConnectFlash]);
    // Extend a selected NET by one member (Shift-drag out of a member): the
    // dragged-to item joins DOWNSTREAM, a local netEdits overlay — the exact
    // mirror of leg-delete.
    const commitNetExtend = useCallback((netKey: string, from: string, to: string) => {
        const net = effectiveNets.find(n => n.key === netKey);
        if (net === undefined) return;
        if (net.sources.includes(to) || net.destinations.includes(to)) return;   // already a member
        const fromIsMember = net.sources.includes(from) || net.destinations.includes(from);
        if (!fromIsMember) return;
        const sources = [...net.sources];
        const destinations = [...net.destinations, to];
        const netEdits = new Map(linkEdits.netEdits);
        netEdits.set(netKey, { sources, destinations });
        setLinkEdits({ ...linkEdits, netEdits });
        connectFlashRef.current = { from, to, t0: performance.now() };
        startConnectFlash();
    }, [effectiveNets, linkEdits, startConnectFlash]);
    // Delete the selected link (Del / Backspace while editable): created links
    // drop locally; read links join the deleted overlay.
    const deleteSelectedLink = useCallback(() => {
        const selL = renderSnapRef.current.selectedLink;
        if (selL === null || !renderSnapRef.current.linkEditEnabled) return;
        const key = selL.key;
        // A selected LEG deletes just that endpoint (#189): the membership
        // overlay replaces the net's endpoint sets locally; emptying a side falls
        // through to whole-net delete.
        if (selL.leg !== null) {
            const net = effectiveNets.find(n => n.key === key);
            if (net !== undefined) {
                const leg = selL.leg;
                const sources = leg.end === "source" ? net.sources.filter(k => k !== leg.item) : [...net.sources];
                const destinations = leg.end === "destination" ? net.destinations.filter(k => k !== leg.item) : [...net.destinations];
                if (sources.length > 0 && destinations.length > 0) {
                    const netEdits = new Map(linkEdits.netEdits);
                    netEdits.set(key, { sources, destinations });
                    setLinkEdits({ ...linkEdits, netEdits });
                    commitLinkSelection({ key, leg: null });
                    return;
                }
            }
        }
        if (linkEdits.created.some(l => l.key === key)) {
            setLinkEdits({ ...linkEdits, created: linkEdits.created.filter(l => l.key !== key) });
        } else if (linkEdits.createdNets.some(n => n.key === key)) {
            setLinkEdits({ ...linkEdits, createdNets: linkEdits.createdNets.filter(n => n.key !== key) });
        } else {
            // Read links AND nets share the deleted overlay.
            const deleted = new Set(linkEdits.deleted);
            deleted.add(key);
            setLinkEdits({ ...linkEdits, deleted });
        }
        commitLinkSelection(null);
    }, [linkEdits, effectiveNets, commitLinkSelection]);

    // A user gesture (collapse/fly) takes the accordion away from the viewport
    // spy until the viewport leaves that zone (issue #57, Phase 2 openZone fix).
    const zoneOverrideRef = useRef<string | null>(null);

    const flyToItem = useCallback((item: SchematicItemValue) => {
        flyTo({ x: item.x - 4, y: item.y - 3, w: 8, h: 6 });
        // A fly-to focus (nav click / step / marker tap) is always single-focus
        // REPLACE — its purpose is the camera move; Shift-add is marquee-only.
        commitSelection(new Set([item.key]), { anchor: item.key });
        // Open the item's zone immediately rather than waiting for the
        // viewport spy to catch up after the fly animation.
        zoneOverrideRef.current = null;
        setOpenZone(nav.zoneOf.get(item.key) ?? null);
    }, [flyTo, nav.zoneOf, commitSelection]);
    const stepSelection = useCallback((delta: number) => {
        const { ordered, indexOf } = itemOrder;
        if (ordered.length === 0) return;
        const anchor = selection.anchor;
        const idx = anchor !== null ? (indexOf.get(anchor) ?? -1) : -1;
        flyToItem(ordered[(idx + delta + ordered.length) % ordered.length]!);
    }, [itemOrder, flyToItem, selection.anchor]);
    // Keyboard traversal (#183 WS7): with the canvas focused, arrows step the
    // selection through the deterministic item order (the prev/next controls'
    // exact path — fly + select). Enter opens the selection in the inspector's
    // Details, with the inspector (#1391). Esc / Space / Ctrl / Del stay on the
    // window handler.
    const onCanvasKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); stepSelection(1); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); stepSelection(-1); }
    }, [stepSelection]);
    const flyToZone = useCallback((zone: SchematicZoneValue) => {
        flyTo({ x: zone.x, y: zone.y, w: zone.width, h: zone.height });
        zoneOverrideRef.current = null;
        setOpenZone(zone.key);
        // A nav-rail zone click also SELECTS the zone (single replace), mirroring
        // how nav item clicks commit item selection (#177).
        commitZoneSelection(new Set([zone.key]));
    }, [flyTo, commitZoneSelection]);

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
        // carry pointerEvents:none, so elementFromPoint already skips them; the
        // guard is belt-and-suspenders.)
        if (typeof document !== "undefined") {
            const cardKey = document.elementFromPoint(clientX, clientY)
                ?.closest("[data-card-key]")?.getAttribute("data-card-key");
            if (cardKey !== null && cardKey !== undefined && !lockedKeys.has(cardKey)) return cardKey;
        }
        // 3) dot / label markers: nearest hit against the full rendered extent (P11).
        const ctx = drawRef.current?.getContext("2d") ?? null;
        // Measure label widths with the painter's font so the hitbox matches the
        // drawn pill; save/restore so the pick never leaks font state.
        if (ctx !== null) { ctx.save(); ctx.font = MARKER_LABEL_FONT; }
        const camScreen = { ppu: ppuLive, tx: cam.tx, ty: cam.ty };
        let best: SchematicItemValue | null = null, bestD = Infinity;
        for (const it of visibleItems) {
            if (lockedKeys.has(it.key)) continue;
            const tier = tiers.get(it.key) ?? lod;
            if (tier === "card") continue;
            const box = markerHitbox(it, tier, camScreen, t => ctx !== null ? ctx.measureText(t).width : t.length * 6);
            if (!markerHit(box, sx, sy)) continue;
            const d = Math.hypot(it.x * ppuLive + cam.tx - sx, it.y * ppuLive + cam.ty - sy);
            if (d < bestD) { best = it; bestD = d; }
        }
        if (ctx !== null) ctx.restore();
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
        // Presses on the controls / nav buttons are theirs. Cards are NOT
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
                const orig = new Map<string, Pt>();
                for (const kk of keys) {
                    const c = snap.centers.get(kk);
                    if (c !== undefined) orig.set(kk, { x: c.x, y: c.y });
                }
                moveDragRef.current = { key: k, keys: [...orig.keys()], orig, startWorld: { x: wxp, y: wyp } };
                return;
            }
        }
        // Connector-handle grab (#176): with an editable selected link, pressing
        // within a handle's reach starts a RE-TARGET drag (any tool) — the draft
        // anchors at the FIXED end and follows the cursor. SHIFT skips the
        // handle: Shift-drag from a selected link's endpoint SEEDS a net
        // session instead (plain = retarget, Shift = extend).
        if (!e.shiftKey && renderSnapRef.current.linkEditEnabled && renderSnapRef.current.selectedLink !== null) {
            const snap = renderSnapRef.current;
            const lk2 = effectiveLinks.find(l => l.key === snap.selectedLink?.key);
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
                if (!e.shiftKey && linkSessionRef.current !== null) endLinkSession();
                transition("cancel");
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const cam = cameraRef.current;
                const ppuLive = renderSnapRef.current.fit * cam.zoom;
                const wxp = ppuLive > 0 ? (e.clientX - r.left - cam.tx) / ppuLive : 0;
                const wyp = ppuLive > 0 ? (e.clientY - r.top - cam.ty) / ppuLive : 0;
                connectDragRef.current = { from, additive: e.shiftKey };
                // Shift-drag FROM the SELECTED thing extends it (#189 UX):
                // a selected NET member drags a membership ADD; a selected
                // pairwise link's endpoint SEEDS the session with that link
                // (it gets absorbed into the new net on commit).
                if (e.shiftKey && linkSessionRef.current === null) {
                    const selL = renderSnapRef.current.selectedLink;
                    if (selL !== null && selL.leg === null) {
                        const selNet = effectiveNets.find(n => n.key === selL.key);
                        if (selNet !== undefined && (selNet.sources.includes(from) || selNet.destinations.includes(from))) {
                            connectDragRef.current = { from, additive: true, netExtend: selNet.key };
                        } else {
                            const selLink = effectiveLinks.find(l => l.key === selL.key);
                            if (selLink !== undefined && (selLink.from === from || selLink.to === from)) {
                                linkSessionRef.current = {
                                    key: `net-${++linkKeyCounter.current}`,
                                    links: [{ key: selLink.key, from: selLink.from, to: selLink.to }],
                                    drawn: "none",
                                    seeded: [selLink.key],
                                };
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
            // box (the grab branch gets this for free via "pointerDown").
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
    }, [transition, itemKeyAt, effectiveLinks, effectiveNets, endLinkSession, refById, movableKinds]);
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
        // Move drag (#179): every mover follows the shared world delta, clamped
        // to the extent; a PURE functional merge preserves other items' moves.
        const md = moveDragRef.current;
        if (md !== null) {
            const host = e.currentTarget as HTMLElement;
            const r = host.getBoundingClientRect();
            const cam = cameraRef.current;
            const ppuLive = renderSnapRef.current.fit * cam.zoom;
            if (ppuLive > 0) {
                const dx = (e.clientX - r.left - cam.tx) / ppuLive - md.startWorld.x;
                const dy = (e.clientY - r.top - cam.ty) / ppuLive - md.startWorld.y;
                setItemMoves(prev => {
                    const next = new Map(prev);
                    for (const [kk, o] of md.orig) {
                        next.set(kk, { x: Math.min(Math.max(o.x + dx, 0), W), y: Math.min(Math.max(o.y + dy, 0), H) });
                    }
                    return next;
                });
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
                const words = tk !== undefined && tk !== cd.from ? candidateRefusal(cd, tk) : undefined;
                const ok = tk !== undefined && tk !== cd.from && words === undefined;
                const target = ok ? tk : undefined;
                // A vetoed candidate is surfaced, not silent: the draft goes
                // DANGER (red edge + ring on the target, not-allowed cursor), its
                // words kept for the draft to show (#1388).
                const forbidden = tk !== undefined && tk !== cd.from && !ok ? tk : undefined;
                setConnectDraft({ from: cd.from, toWorld: { x: wxp, y: wyp }, target, ...(forbidden !== undefined ? { forbidden, reason: words } : {}) });
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
        // Move release (#179): the moved items stay where the drag left them.
        if (moveDragRef.current !== null) {
            moveDragRef.current = null;
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
        // Grab-tool tap: select the item under it (Shift extends); a tap on empty
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
    }, [endPan, pickAt, flyTo, collectMarquee, commitSelection, clearSelection, zoneKeyAt, zoneTap, clearZoneSelection, itemKeyAt, commitConnect, commitRetarget, linkKeyAt, selectLink, candidateRefusal, commitNetExtend, commitLinkSelection]);
    // pointercancel / lost capture: a pan OR select-drag that loses its grip
    // mid-gesture must still end (issue #57, P10). After a normal release the
    // pan is already ended (panRef null) so this is a no-op then, and it never
    // cancels a fly the tap may have just started.
    const onCanvasPointerCancel = useCallback(() => {
        movedRef.current = false;
        // Revert an in-flight move to its drag-start positions.
        const md = moveDragRef.current;
        if (md !== null) {
            moveDragRef.current = null;
            setItemMoves(prev => {
                const next = new Map(prev);
                for (const [kk, o] of md.orig) next.set(kk, o);
                return next;
            });
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

    // Leaving the connect tool cancels any in-flight draft and ends the session;
    // a tool whose domain turns read-only reverts to grab.
    useEffect(() => {
        if (tool !== "connect") {
            connectDragRef.current = null;
            setConnectDraft(null);
            endLinkSession();
        }
        if ((tool === "connect" && !linkEditEnabled) || (tool === "move" && !itemEditEnabled)) setTool("grab");
    }, [tool, endLinkSession, linkEditEnabled, itemEditEnabled]);

    // Momentary tool overrides (#153): while the schematic is hovered, holding
    // Space → grab, Ctrl → zoom, reverting on release. Escape (#159) cancels an
    // in-flight box or, failing that, clears the selection. Gated on hover so the
    // page's Space-scroll / Ctrl-modifier is untouched elsewhere; window blur and
    // pointer-leave clear a stuck override.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!hoveredRef.current) return;
            // preventDefault on EVERY Space (incl. auto-repeat) so the page never
            // scrolls while panning; only the first sets the tool.
            if (e.code === "Space") { e.preventDefault(); if (!e.repeat) setTempTool("grab"); }
            else if (e.key === "Control" && !e.repeat) setTempTool("zoom");
            else if ((e.key === "Delete" || e.key === "Backspace") && renderSnapRef.current.selectedLink !== null) {
                e.preventDefault();
                deleteSelectedLink();
            }
            else if (e.key === "Escape") {
                if (moveDragRef.current !== null) {
                    const md = moveDragRef.current;
                    moveDragRef.current = null;
                    setItemMoves(prev => {
                        const next = new Map(prev);
                        for (const [kk, o] of md.orig) next.set(kk, o);
                        return next;
                    });
                }
                else if (connectDragRef.current !== null) { connectDragRef.current = null; setConnectDraft(null); }
                else if (selStartRef.current !== null) { selStartRef.current = null; setBoxDrag(null); }
                else if (linkSessionRef.current !== null) endLinkSession();
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
    }, [clearSelection, clearZoneSelection, endLinkSession, deleteSelectedLink, commitLinkSelection]);
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

    // (The per-commit repaint now rides the dep-less snapshot-write effect above —
    // a zone/link-only layer toggle, theme load, or data change repaints because
    // EVERY commit re-snapshots then applies, and the identity short-circuit
    // makes the no-change case free.)

    // Accordion: one open zone; its ancestors stay open so the path is visible.
    const toggleZone = useCallback((key: string) => {
        const collapsing = renderSnapRef.current.openZone === key;
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
        // Scroll the nav to the anchor (the last-touched item), not the whole set.
        const anchor = selection.anchor;
        if (anchor === null) return;
        navTreeRef.current
            ?.querySelector(`[data-nav-key="${CSS.escape(anchor)}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [selection, openPath]);

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
                        {...(selected.has(item.key) ? { "data-selected": "" } : {})}
                        onClick={() => flyToItem(item)}
                    >
                        <Box as="span" css={styles.statusDot} data-tone={statusTone(item.status) ?? "neutral"} {...(statusRing(item.status) ? { "data-ring": "" } : {})} />
                        {item.label}
                        {item.metric.type === "some" && <Box as="span" css={styles.navMetric}>{item.metric.value}</Box>}
                    </Box>
                ))}
            </Box>
        );
    };

    const schematicBody = (
        <Box css={styles.root}>
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
                    <Box ref={navTreeRef} css={styles.navTree}>
                        {nav.roots.map(node => renderNavZone(node, 0))}
                        {nav.floor.map(item => (
                            <Box key={item.key} as="button" css={styles.navItem} data-nav-key={item.key} style={{ paddingLeft: "8px" }} {...(selected.has(item.key) ? { "data-selected": "" } : {})} onClick={() => flyToItem(item)}>
                                <Box as="span" css={styles.statusDot} data-tone={statusTone(item.status) ?? "neutral"} {...(statusRing(item.status) ? { "data-ring": "" } : {})} />
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
                tabIndex={0}
                role="application"
                aria-label="Schematic canvas — arrow keys step through the items"
                onKeyDown={onCanvasKeyDown}
                style={{
                    aspectRatio: `${W} / ${H}`,
                    // Box tools (zoom / marquee) show a crosshair; for grab we leave
                    // the cursor to the recipe (grab → grabbing on :active) — an inline
                    // value would outrank the recipe and freeze it mid-pan (#153).
                    ...(connectDraft?.forbidden !== undefined ? { cursor: "not-allowed" }
                        : isBoxTool || effectiveTool === "connect" ? { cursor: "crosshair" }
                            : effectiveTool === "move" ? { cursor: "move" } : {}),
                }}
                onPointerEnter={() => { hoveredRef.current = true; }}
                onPointerLeave={() => { hoveredRef.current = false; setTempTool(null); }}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onPointerCancel={onCanvasPointerCancel}
                onLostPointerCapture={onCanvasPointerCancel}
                onDoubleClick={onCanvasDoubleClick}
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
                                const isSelected = renderSelected.has(item.key);
                                // Layer treatment: dim + lock (non-selectable — clicks fall
                                // through to entities beneath, matching the pickAt lock skip).
                                const isLockedCard = lockedKeys.has(item.key);
                                const cardOpacity = layerAlpha.get(item.key) ?? 1;
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
                                        {...(connectDraft?.forbidden === item.key ? { "data-forbidden": "" } : {})}
                                        style={{
                                            left: 0, top: 0,
                                            transform: `${cardTranslateCss(item.x, item.y)} translate(-50%, -50%)`,
                                            ...(width !== undefined ? { width: cardWidthCss(width) } : {}),
                                            ...(cardOpacity < 1 ? { opacity: cardOpacity } : {}),
                                            ...(isLockedCard ? { pointerEvents: "none" as const } : {}),
                                        }}
                                    >{/* No onClick / stopPropagation: a drag-pan can start on a
                                        card, and a tap is resolved by the canvas pickAt (pointerup). */}
                                        <Box css={styles.itemHead}>
                                            {iconDef !== undefined && (
                                                <Box as="span" css={styles.itemIcon}><FontAwesomeIcon icon={iconDef} /></Box>
                                            )}
                                            <Box as="span" css={styles.itemLabel}>{item.label}</Box>
                                            {tone !== undefined && <Box as="span" css={styles.statusDot} data-tone={tone} {...(statusRing(item.status) ? { "data-ring": "" } : {})} />}
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
                        <Box css={styles.controls}>
                            {/* Nav tool group: grab (pan, default) + zoom-to-box. Icons unchanged. */}
                            <Box css={styles.controlGroup}>
                                <Box as="button" css={styles.controlButton} {...(tool === "grab" ? { "data-active": "" } : {})} aria-label="Grab / pan tool" aria-pressed={tool === "grab"} title="Grab — drag to pan (hold Space)" onClick={() => setTool("grab")}><FontAwesomeIcon icon={faHand} /></Box>
                                <Box as="button" css={styles.controlButton} {...(tool === "zoom" ? { "data-active": "" } : {})} aria-label="Zoom-region tool" aria-pressed={tool === "zoom"} title="Zoom — drag a box to zoom in (hold Ctrl)" onClick={() => setTool("zoom")}><FontAwesomeIcon icon={faObjectGroup} /></Box>
                            </Box>
                            {/* Selection tool group (#159): the marquee (drag a box → select
                                the enclosed items) + a clear. A tap selects; Shift extends. */}
                            <Box css={styles.controlGroup}>
                                <Box as="button" css={styles.controlButton} {...(tool === "marquee" ? { "data-active": "" } : {})} aria-label="Select-region tool" aria-pressed={tool === "marquee"} title="Select region — drag a box (Shift adds)" onClick={() => setTool("marquee")}><FontAwesomeIcon icon={faObjectUngroup} /></Box>
                                {selected.size > 0 && (
                                    <Box as="button" css={styles.controlButton} aria-label="Clear selection" title="Clear selection (Esc)" onClick={clearSelection}><FontAwesomeIcon icon={faXmark} /></Box>
                                )}
                            </Box>
                            {/* Edit tool group (#176/#179) — Connect while a link kind is
                                bound with its patch door, Move while an item kind is. */}
                            {(linkEditEnabled || itemEditEnabled) && (
                                <Box css={styles.controlGroup}>
                                    {linkEditEnabled && (
                                        <Box as="button" css={styles.controlButton} {...(tool === "connect" ? { "data-active": "" } : {})} aria-label="Connect tool" aria-pressed={tool === "connect"} title="Connect — drag from item to item (Shift adds to the session)" onClick={() => setTool("connect")}><FontAwesomeIcon icon={faLink} /></Box>
                                    )}
                                    {itemEditEnabled && (
                                        <Box as="button" css={styles.controlButton} {...(tool === "move" ? { "data-active": "" } : {})} aria-label="Move tool" aria-pressed={tool === "move"} title="Move — drag an item (a selected item moves the whole selection)" onClick={() => setTool("move")}><FontAwesomeIcon icon={faUpDownLeftRight} /></Box>
                                    )}
                                </Box>
                            )}
                            <Box as="button" css={styles.controlButton} aria-label="Zoom in" title="Zoom in (scroll)" onClick={() => zoomBy(1.5)}><FontAwesomeIcon icon={faPlus} /></Box>
                            <Box as="button" css={styles.controlButton} aria-label="Zoom out" title="Zoom out (scroll)" onClick={() => zoomBy(1 / 1.5)}><FontAwesomeIcon icon={faMinus} /></Box>
                            <Box as="button" css={styles.controlButton} aria-label="Fit view" title="Fit view (double-click)" onClick={resetView}><FontAwesomeIcon icon={faExpand} /></Box>
                            {/* Layer selector — visible only when the schematic declares layers.
                                Active when the view is filtered (a layer hidden / a solo). */}
                            {hasLayers && (
                                <Box as="button" css={styles.controlButton} {...(layersFiltered ? { "data-active": "" } : {})} aria-label="Layers" aria-expanded={layersOpen} title="Layers" onClick={() => setLayersOpen(o => !o)}><FontAwesomeIcon icon={faLayerGroup} /></Box>
                            )}
                            {/* Back / forward through items — its own vertical group. */}
                            {selected.size > 0 && (
                                <Box css={styles.controlGroup}>
                                    <Box as="button" css={styles.controlButton} aria-label="Previous item" title="Previous item" onClick={() => stepSelection(-1)}><FontAwesomeIcon icon={faChevronLeft} /></Box>
                                    <Box as="button" css={styles.controlButton} aria-label="Next item" title="Next item" onClick={() => stepSelection(1)}><FontAwesomeIcon icon={faChevronRight} /></Box>
                                </Box>
                            )}
                        </Box>
                        {/* Layer panel — a small dropdown under the layer button. Its own
                            pointer-down stops the canvas pan (the canvas only exempts
                            <button>s); each row toggles eye / solo / lock. */}
                        {hasLayers && layersOpen && (
                            <Box css={styles.layerPanel} onPointerDown={e => e.stopPropagation()}>
                                <Box css={styles.layerHeader}>
                                    <Box as="span" css={styles.layerTitle}>Layers</Box>
                                    <Box as="button" css={styles.layerReset} onClick={resetLayers}>Show all</Box>
                                </Box>
                                {layers.map(l => {
                                    const hidden = layerHiddenLayers.has(l.key);
                                    const solo = soloLayer === l.key;
                                    const locked = layerLocks[l.key] ?? authorLockedOf(l.key);
                                    const toneName = getSomeorUndefined(l.tone)?.type ?? "muted";
                                    return (
                                        <Box key={l.key} css={styles.layerRow} {...(hidden ? { "data-hidden": "" } : {})}>
                                            <Box as="span" css={styles.layerSwatch} data-tone={toneName} />
                                            <Box as="span" css={styles.layerLabel}>{l.label}</Box>
                                            <Box as="span" css={styles.layerCount}>{layerCounts.get(l.key) ?? 0}</Box>
                                            <Box as="button" css={styles.layerToggle} {...(solo ? { "data-active": "" } : {})} aria-label="Isolate layer" title="Isolate" onClick={() => toggleSolo(l.key)}><FontAwesomeIcon icon={faBullseye} /></Box>
                                            <Box as="button" css={styles.layerToggle} {...(locked ? { "data-active": "" } : {})} aria-label={locked ? "Unlock layer" : "Lock layer"} title={locked ? "Locked (click to unlock)" : "Lock (non-selectable on canvas)"} onClick={() => toggleLayerLock(l.key)}><FontAwesomeIcon icon={locked ? faLock : faLockOpen} /></Box>
                                            <Box as="button" css={styles.layerToggle} aria-label={hidden ? "Show layer" : "Hide layer"} title={hidden ? "Show" : "Hide"} onClick={() => toggleLayerVis(l.key)}><FontAwesomeIcon icon={hidden ? faEyeSlash : faEye} /></Box>
                                        </Box>
                                    );
                                })}
                            </Box>
                        )}
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
        </Box>
    );

    return schematicBody;
});

/** The props `EastChakraSchematic` takes: the payload and where its view state is kept. */
export interface EastChakraSchematicProps {
    value: SchematicValue;
    storageKey: string;
}

/**
 * Renders the Schematic (e3-ui's `<Schematic>`): its reader, which reads each
 * kind's rows (`data.ts`), and the canvas, which draws what it read.
 */
export const EastChakraSchematic = memo(function EastChakraSchematic({ value, storageKey }: EastChakraSchematicProps) {
    const [data, setData] = useState<SchematicData>(INITIAL_SCHEMATIC_DATA);
    return (
        <>
            <SchematicDataReader value={value} onData={setData} />
            <Box data-schematic="" {...(data.loading ? { "aria-busy": "true" } : {})} {...(data.error !== undefined ? { "data-error": data.error } : {})}>
                <SchematicCanvas value={value} data={data.drawn} storageKey={storageKey} />
            </Box>
        </>
    );
}, (prev, next) => schematicEqual(prev.value, next.value) && prev.storageKey === next.storageKey);

// =============================================================================
// Side-effect — register the renderer for the Schematic extension on module load.
// =============================================================================

implementUIComponent(Schematic.Component, EastChakraSchematic);
