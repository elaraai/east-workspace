/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { findIconDefinition, library } from "@fortawesome/fontawesome-svg-core";
import { fas, faAnglesLeft, faAnglesRight, faBullseye, faCaretRight, faChevronLeft, faChevronRight, faExpand, faEye, faEyeSlash, faHand, faLayerGroup, faLink, faLock, faLockOpen, faMinus, faUpDownLeftRight, faObjectGroup, faObjectUngroup, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import RBush from "rbush";
import { equalFor, some, none, variant, type ValueTypeOf } from "@elaraai/east";
import { Schematic, Slice as SliceInternal, type UIComponentType } from "@elaraai/east-ui/internal";
import type { IconName } from "@fortawesome/fontawesome-common-types";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { SliceRailCluster } from "../../slice/rail";
import { useSliceReactivity } from "../../slice/use-slice-reactivity";
import { usePersistedState } from "../../hooks/usePersistedState";
import { LINK_HIT_SLOP, MARKER_LABEL_FONT, distanceToPolyline, markerHit, markerHitbox, orthogonalize, paintSchematic, parallelLanes as paintParallelLanes, LINK_LANE_GAP, type SchematicPalette, type SchematicPaintEffect } from "./paint";
import { EMPTY_STRING_SET, type ItemBox, managedSelectionSet, marqueeHits, sameStringSet, sliceWithSelection } from "./selection";
import { type LodTier, type NavZone, buildCenterTree, buildNavTree, declutterTiers, tierSize } from "./model";
import {
    type CameraEvent, type CameraMode, type RafCoalescer, type Viewport,
    IDENTITY, cancelsFly, cardTranslateCss, cardWidthCss, makeRafCoalescer, nextMode, viewportWorldBbox, zoomAbout,
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

/** East Schematic link value type. */
export type SchematicLinkValue = ValueTypeOf<typeof Schematic.Types.Link>;

/** East Schematic net (manifold / bus) value type. */
export type SchematicNetValue = ValueTypeOf<typeof Schematic.Types.Net>;

/** East Schematic layer value type. */
export type SchematicLayerValue = ValueTypeOf<typeof Schematic.Types.Layer>;

/** Decoded hover-content builder (#178) — hovered entity key → UI value. */
type HoverContentFn = (key: string) => ValueTypeOf<UIComponentType>;

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
/** Pulse animation period in ms (the matched-item breathing ring). */
const PULSE_PERIOD_MS = 1600;
/** Hover-card dwell before opening and leave-grace before closing (#178). */
const HOVER_OPEN_MS = 300;
const HOVER_CLOSE_GRACE_MS = 250;
/** Screen-px half-extent used to frame a dot-tier item (its marker + touch slop). */
const DOT_FRAME_ALLOW_PX = 10;

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

/** A draw-mode session grown past one pair becomes a NET (#189): default
 *  solid style, orthogonal trunk, no label / waypoints / layer. */
function mkCreatedNet(key: string, sources: readonly string[], destinations: readonly string[]): SchematicNetValue {
    return {
        key,
        sources: [...sources],
        destinations: [...destinations],
        label: none, metric: none,
        style: variant("solid", { tone: none, weight: none }),
        route: variant("orthogonal", { corner: none }),
        via: [],
        layer: none,
    } as SchematicNetValue;
}

/** A freshly-drawn link (draw-mode connect gesture): default solid style,
 *  orthogonal route, no label / waypoints / layer — constructed with
 *  variant()/none per the interop rules. */
function mkCreatedLink(key: string, from: string, to: string): SchematicLinkValue {
    return {
        key, from, to,
        label: none, metric: none,
        style: variant("solid", { tone: none, weight: none }),
        route: variant("orthogonal", { corner: none }),
        via: [],
        layer: none,
    } as SchematicLinkValue;
}

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
    const onSelectionChangeFn = useMemo(() => getSomeorUndefined(value.onSelectionChange), [value.onSelectionChange]);
    // Selection cardinality (absent ⇒ single). `multiple` reveals the marquee
    // tool + selection control group; `single` keeps today's behaviour.
    const selectionMode = getSomeorUndefined(value.selectionMode)?.type ?? "single";
    const selectionEnabled = selectionMode === "multiple";
    // When true, a canvas selection also moves the camera (tap flies, marquee fits).
    const selectZoomFocus = getSomeorUndefined(value.selectZoomFocus) ?? false;
    const onViewportChangeFn = useMemo(() => getSomeorUndefined(value.onViewportChange), [value.onViewportChange]);
    const onItemOpenFn = useMemo(() => getSomeorUndefined(value.onItemOpen), [value.onItemOpen]);
    const onSelectZoneFn = useMemo(() => getSomeorUndefined(value.onSelectZone), [value.onSelectZone]);
    const onZoneSelectionChangeFn = useMemo(() => getSomeorUndefined(value.onZoneSelectionChange), [value.onZoneSelectionChange]);
    // Zone (area) selection (#177) — a separate set from item selection, committed
    // through its own funnel below (declared here so early callbacks can reference it).
    const [zoneSelection, setZoneSelection] = useState<ReadonlySet<string>>(EMPTY_STRING_SET);
    // Link editing (#176): gesture mode + creation callback + flattened read-only.
    const onCreateLinkFn = useMemo(() => getSomeorUndefined(value.onCreateLink), [value.onCreateLink]);
    const linkMode = getSomeorUndefined(value.linkMode)?.type ?? "draw";
    const readOnly = getSomeorUndefined(value.readOnly) ?? false;
    // Effective per-domain editability = !readOnly && !readOnly<Domain> — so an
    // author can forbid item dragging while still allowing link creation.
    const linkEditEnabled = !readOnly && !(getSomeorUndefined(value.readOnlyLinks) ?? false);
    const onMoveItemFn = useMemo(() => getSomeorUndefined(value.onMoveItem), [value.onMoveItem]);
    // --- Hover cards (#178) — the read-only inspection channel. --------------
    // Content builders are East functions receiving the hovered entity's KEY,
    // evaluated lazily at open (no per-entity IR for large schematics). A card
    // opens after a short dwell, closes on any camera / edit gesture, and
    // survives the pointer travelling ONTO it (leave-grace) so charts inside
    // stay inspectable. Hover ignores readOnly — it inspects, never edits.
    const itemHoverFn = useMemo(() => getSomeorUndefined(value.itemHover) as HoverContentFn | undefined, [value.itemHover]);
    const zoneHoverFn = useMemo(() => getSomeorUndefined(value.zoneHover) as HoverContentFn | undefined, [value.zoneHover]);
    const linkHoverFn = useMemo(() => getSomeorUndefined(value.linkHover) as HoverContentFn | undefined, [value.linkHover]);
    const hoverEnabled = itemHoverFn !== undefined || zoneHoverFn !== undefined || linkHoverFn !== undefined;
    const [hoverCard, setHoverCard] = useState<{ kind: "item" | "zone" | "link"; key: string; ax: number; ay: number } | null>(null);
    // Mirror + timer refs keep every helper below DEP-FREE (stable identities),
    // so the camera / keyboard seams that call closeHover never re-bind.
    const hoverCardRef = useRef<typeof hoverCard>(null);
    useEffect(() => { hoverCardRef.current = hoverCard; }, [hoverCard]);
    const hoverOpenRef = useRef<{ timer: number; target: string } | null>(null);
    const hoverCloseRef = useRef<number | null>(null);
    const cancelHoverOpen = useCallback(() => {
        if (hoverOpenRef.current !== null) { window.clearTimeout(hoverOpenRef.current.timer); hoverOpenRef.current = null; }
    }, []);
    const cancelHoverClose = useCallback(() => {
        if (hoverCloseRef.current !== null) { window.clearTimeout(hoverCloseRef.current); hoverCloseRef.current = null; }
    }, []);
    const closeHover = useCallback(() => {
        cancelHoverOpen();
        cancelHoverClose();
        setHoverCard(prev => prev === null ? prev : null);
    }, [cancelHoverOpen, cancelHoverClose]);
    // Grace-close: pending until the pointer re-enters the entity or the card.
    const scheduleHoverClose = useCallback(() => {
        cancelHoverOpen();
        if (hoverCardRef.current === null || hoverCloseRef.current !== null) return;
        hoverCloseRef.current = window.setTimeout(() => {
            hoverCloseRef.current = null;
            setHoverCard(null);
        }, HOVER_CLOSE_GRACE_MS);
    }, [cancelHoverOpen]);
    useEffect(() => () => {
        if (hoverOpenRef.current !== null) window.clearTimeout(hoverOpenRef.current.timer);
        if (hoverCloseRef.current !== null) window.clearTimeout(hoverCloseRef.current);
    }, []);
    // Evaluate the builder ONCE per open card; a throwing builder logs and
    // renders nothing rather than unmounting the schematic.
    const hoverContent = useMemo(() => {
        if (hoverCard === null) return null;
        const fn = hoverCard.kind === "item" ? itemHoverFn : hoverCard.kind === "zone" ? zoneHoverFn : linkHoverFn;
        if (fn === undefined) return null;
        try {
            return fn(hoverCard.key);
        } catch (err) {
            console.error("[Schematic] hover content builder failed:", err);
            return null;
        }
    }, [hoverCard, itemHoverFn, zoneHoverFn, linkHoverFn]);
    const itemEditEnabled = !readOnly && !(getSomeorUndefined(value.readOnlyItems) ?? false);
    const onSelectLinkFn = useMemo(() => getSomeorUndefined(value.onSelectLink), [value.onSelectLink]);
    const onEditLinkFn = useMemo(() => getSomeorUndefined(value.onEditLink), [value.onEditLink]);
    const onDeleteLinkFn = useMemo(() => getSomeorUndefined(value.onDeleteLink), [value.onDeleteLink]);
    // The selected link (single, #176) — selection works even when read-only
    // (inspection + onSelectLink); the connector handles / delete do not.
    const [selectedLink, setSelectedLink] = useState<string | null>(null);
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

    // --- Slice effect: how filtered-out items render instead of vanishing. ---
    // Feed the FULL item set with each item's `excluded` flag set; the flat effect
    // struct (mirrors the `slice*` props) decides the treatment. Absent ⇒ no
    // effect. Types inferred from the East `Schematic.Types` — no hand-rolled shapes.
    const sliceEffect = getSomeorUndefined(value.sliceEffect);
    const hasEffect = sliceEffect !== undefined;
    // `hidden` some(true) ⇒ remove filtered-out; else keep (with opacity/desaturate/dot).
    const excludedMode: "hide" | "keep" =
        (sliceEffect !== undefined && (getSomeorUndefined(sliceEffect.hidden) ?? false)) ? "hide" : "keep";
    const excludedOpacity = sliceEffect !== undefined ? (getSomeorUndefined(sliceEffect.opacity) ?? 1) : 1;
    const excludedDesaturate = sliceEffect !== undefined ? (getSomeorUndefined(sliceEffect.desaturate) ?? false) : false;
    const excludedDot = sliceEffect !== undefined ? (getSomeorUndefined(sliceEffect.dot) ?? false) : false;
    const emphasis: "halo" | "pulse" | undefined = sliceEffect !== undefined
        ? getSomeorUndefined(sliceEffect.emphasis)?.type
        : undefined;
    const frameEnabled = sliceEffect !== undefined ? (getSomeorUndefined(sliceEffect.frame) ?? false) : false;
    const frameFit = sliceEffect !== undefined ? (getSomeorUndefined(sliceEffect.frameFit) ?? false) : false;

    // Which items are slice-excluded (only meaningful when an effect is set).
    const excludedKeys = useMemo(() => {
        const s = new Set<string>();
        if (hasEffect) for (const it of value.items) if (getSomeorUndefined(it.excluded) === true) s.add(it.key);
        return s;
    }, [value.items, hasEffect]);
    // The effect only "engages" once something is actually excluded — otherwise
    // emphasis / frame would decorate every item (no narrowing active).
    const effectActive = hasEffect && excludedKeys.size > 0;

    // --- Local link state (#176, draw mode) — the form-input model. ----------
    // Created / re-targeted / deleted deltas over `value.links`, so link editing
    // works with zero callbacks wired; a reactive `value.links` change REPLACES
    // the local edits (prop is source of truth on change, like form inputs).
    const [linkEdits, setLinkEdits] = useState<{
        created: readonly SchematicLinkValue[];
        createdNets: readonly SchematicNetValue[];
        retarget: ReadonlyMap<string, { from: string; to: string }>;
        deleted: ReadonlySet<string>;
    }>({ created: [], createdNets: [], retarget: new Map(), deleted: new Set() });
    useEffect(() => {
        setLinkEdits({ created: [], createdNets: [], retarget: new Map(), deleted: new Set() });
    }, [value.links, value.nets]);
    const hasLinkEdits = linkEdits.created.length > 0 || linkEdits.createdNets.length > 0
        || linkEdits.retarget.size > 0 || linkEdits.deleted.size > 0;
    const effectiveLinks = useMemo<SchematicLinkValue[]>(() => {
        if (!hasLinkEdits) return value.links;
        const base = value.links
            .filter(l => !linkEdits.deleted.has(l.key))
            .map(l => {
                const rt = linkEdits.retarget.get(l.key);
                return rt !== undefined ? { ...l, from: rt.from, to: rt.to } : l;
            });
        return [...base, ...linkEdits.created];
    }, [value.links, linkEdits, hasLinkEdits]);
    const effectiveNets = useMemo<SchematicNetValue[]>(() => {
        if (!hasLinkEdits) return value.nets;
        return [...value.nets.filter(n => !linkEdits.deleted.has(n.key)), ...linkEdits.createdNets];
    }, [value.nets, linkEdits, hasLinkEdits]);
    // --- Local item positions (#179, move tool) — the form-input model. -------
    // A position overlay over `value.items`, applied UPSTREAM of the working set
    // so centers / rbush / LOD / nav / link endpoints all follow a move for free;
    // a reactive `value.items` change REPLACES the local moves.
    const [itemMoves, setItemMoves] = useState<ReadonlyMap<string, Pt>>(new Map());
    useEffect(() => { setItemMoves(new Map()); }, [value.items]);
    const movedItems = useMemo(() => {
        if (itemMoves.size === 0) return value.items;
        return value.items.map(it => {
            const m = itemMoves.get(it.key);
            return m !== undefined ? { ...it, x: m.x, y: m.y } : it;
        });
    }, [value.items, itemMoves]);
    // The ONE seam feeding local link/net edits to the canvas painter: paint sees
    // a value whose links + nets are the effective sets; everything else untouched.
    const paintValue = useMemo(() => (hasLinkEdits || itemMoves.size > 0)
        ? { ...value, items: movedItems, links: effectiveLinks, nets: effectiveNets }
        : value,
    [value, movedItems, itemMoves, effectiveLinks, effectiveNets, hasLinkEdits]);
    // Selected-link hygiene: clear when the link leaves the effective set
    // (deleted locally or dropped by a prop change).
    useEffect(() => {
        setSelectedLink(prev => (prev !== null
            && !effectiveLinks.some(l => l.key === prev)
            && !effectiveNets.some(n => n.key === prev)) ? null : prev);
    }, [effectiveLinks, effectiveNets]);

    // Selection state, consolidated (#172): the selected SET and the anchor (the
    // last-touched key driving prev/next stepping, scroll-into-view, and
    // zone-open) commit ATOMICALLY as one object — they can never disagree.
    // Every mutation allocates a FRESH Set so the paint identity short-circuit
    // (lastPaintRef.sel) stays correct.
    const [selection, setSelection] = useState<{ selected: ReadonlySet<string>; anchor: string | null }>(
        { selected: EMPTY_STRING_SET, anchor: null });
    const selected = selection.selected;
    // Commit context for the stable (empty-deps) commitSelection funnel: the
    // decoded callback + slice wiring + focus flag it must read FRESH at event
    // time. ONE object, written in the commit-phase snapshot effect below (#172)
    // — never in the render body, so a discarded render can't leak into it.
    const sliceSelectField = getSomeorUndefined(value.sliceSelectField);
    const commitCtx = { onSelectionChange: onSelectionChangeFn, sliceSelectField, sliceHandle, selectZoomFocus };
    const commitCtxRef = useRef(commitCtx);
    // #173: a selection-driven slice write is about to change `frameSig`; the
    // frameFit auto-fit must NOT fire a competing flyTo over the selection fly.
    // Set here, consumed (cleared) by the fit effect on its next run.
    const selectionDrivenFitRef = useRef(false);
    // Single funnel for every selection mutation (tap / marquee / clear). Per the
    // MANDATORY interactive-state pattern: compute `next` OUTSIDE the updater,
    // then setSelected and queueMicrotask as two separate statements.
    const commitSelection = useCallback((
        next: ReadonlySet<string>,
        opts: { additive: boolean; key?: string; anchor?: string; region?: { minX: number; minY: number; maxX: number; maxY: number } },
    ) => {
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
        const ctx = commitCtxRef.current;
        const fn = ctx.onSelectionChange;
        if (fn) dispatchEast("onSelectionChange", () => fn({
            key: opts.key !== undefined ? some(opts.key) : none,
            selected: opts.key !== undefined ? next.has(opts.key) : next.size > 0,
            selectedKeys: [...next],
            additive: opts.additive,
            region: opts.region !== undefined ? some(opts.region) : none,
        }));
        // Drive the bound slice with an `in` filter of the selected keys. ONE-
        // directional (selection → slice, never the reverse) so there is no loop;
        // the fresh-read guard makes re-committing the same set a no-op. Runs from
        // gesture handlers only (never a render / effect), so a synchronous write
        // that re-renders slice consumers is safe.
        if (ctx.sliceSelectField !== undefined && ctx.sliceHandle !== undefined) {
            const cur = ctx.sliceHandle.read();
            if (!sameStringSet(managedSelectionSet(cur.filters, ctx.sliceSelectField), next)) {
                // A selectZoomFocus fly for this commit is already armed (fly-first);
                // flag the write so the frameFit effect doesn't fire a competing
                // flyTo when the resulting frameSig change lands (#173).
                if (ctx.selectZoomFocus) selectionDrivenFitRef.current = true;
                ctx.sliceHandle.write(sliceWithSelection(cur, ctx.sliceSelectField, [...next].sort()));
            }
        }
    }, []);
    const clearSelection = useCallback(() => commitSelection(EMPTY_STRING_SET, { additive: false }), [commitSelection]);
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
    // East `layers` carry only the author defaults. Absent ⇒ no layer chrome.
    const layers = useMemo(() => getSomeorUndefined(value.layers) ?? [], [value.layers]);
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
        for (const it of value.items) scan(it.key, getSomeorUndefined(it.layer));
        for (const z of value.zones) scan(z.key, getSomeorUndefined(z.layer));
        for (const l of value.links) scan(l.key, getSomeorUndefined(l.layer));
        return { layerHiddenKeys: hiddenKeys, lockedKeys: locked, layerAlpha: alpha, layerHiddenLayers: hiddenLayers };
    }, [layers, value.items, value.zones, value.links, layerLocks, layerHidden, authorLockedOf, authorOpacityOf]);
    // The view is "filtered" (drives the button's active state) whenever a layer
    // is hidden or a solo is active.
    const layersFiltered = layerHiddenLayers.size > 0 || soloLayer !== null;

    const layerCounts = useMemo(() => {
        const m = new Map<string, number>();
        const add = (k: string | undefined) => { if (k !== undefined) m.set(k, (m.get(k) ?? 0) + 1); };
        for (const it of value.items) add(getSomeorUndefined(it.layer));
        for (const z of value.zones) add(getSomeorUndefined(z.layer));
        for (const l of value.links) add(getSomeorUndefined(l.layer));
        return m;
    }, [value.items, value.zones, value.links]);
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

    // The item working set: layer-hidden is a HARD pre-filter that wins over the
    // slice-effect keep (an off layer means "not at all"); union with slice-hide.
    // Propagates for free to centers / rbush index / visibleItems / LOD / nav.
    const items = useMemo(() => {
        const sliceHide = effectActive && excludedMode === "hide";
        if (!sliceHide && layerHiddenKeys.size === 0) return movedItems;
        return movedItems.filter(it => !layerHiddenKeys.has(it.key) && !(sliceHide && excludedKeys.has(it.key)));
    }, [movedItems, effectActive, excludedMode, excludedKeys, layerHiddenKeys]);

    // Zones are read at several surfaces (nav TOC, minimap, viewport spy, labels);
    // drop hidden-layer zones once here. Links are filtered inside paint.
    const shownZones = useMemo(
        () => layerHiddenKeys.size === 0 ? value.zones : value.zones.filter(z => !layerHiddenKeys.has(z.key)),
        [value.zones, layerHiddenKeys],
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
        // Route the prune through the funnel (not a raw set) so onSelectionChange
        // fires and the slice `in` clause drops the pruned keys. Shrank-only ⇒ no loop.
        if (changed) commitSelection(next, { additive: false });
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
    // Shift-added connections — `sessionEdges` is the transient visual for
    // `connect` mode (draw mode shows the real created links instead).
    const connectDragRef = useRef<{ from: string; additive: boolean; retarget?: { key: string; movingEnd: "from" | "to" } } | null>(null);
    // Move-tool drag (#179): the pressed key, every key moving (group move rides
    // the selection), each mover's ORIGINAL position (for Esc/cancel revert), and
    // the world start point of the gesture.
    const moveDragRef = useRef<{ key: string; keys: readonly string[]; orig: ReadonlyMap<string, Pt>; startWorld: Pt } | null>(null);
    const [connectDraft, setConnectDraft] = useState<{ from: string; toWorld: Pt; target: string | undefined } | null>(null);
    const linkSessionRef = useRef<{ key: string; links: readonly { key: string; from: string; to: string }[]; drawn: "link" | "net" | "none" } | null>(null);
    const [sessionEdges, setSessionEdges] = useState<readonly { key: string; from: string; to: string }[]>([]);
    const linkKeyCounter = useRef(0);
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
        return { from, to, snapped: connectDraft.target !== undefined };
    }, [connectDraft, centers]);
    const sessionWorld = useMemo(() => sessionEdges
        .map(ep => {
            const f = centers.get(ep.from), t = centers.get(ep.to);
            return f !== undefined && t !== undefined ? { from: f, to: t } : undefined;
        })
        .filter((x): x is { from: Pt; to: Pt } => x !== undefined),
    [sessionEdges, centers]);

    // Spatial index for viewport culling (item half-extent ~2.4 world units
    // covers the widest constant-size marker at the card threshold).
    const index = useMemo(() => {
        const tree = new RBush<ItemBox>();
        tree.load(items.map(item => {
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
    // The items inside a selected-zone set: an item counts when its innermost
    // containing zone or ANY of that zone's ancestors is selected (selecting a
    // hall includes items in its nested cells). Inverts the nav's zoneOf/parentOf.
    const zoneChildItems = useCallback((zones: ReadonlySet<string>): string[] => {
        if (zones.size === 0) return [];
        const out: string[] = [];
        for (const [itemKey, hostZone] of nav.zoneOf) {
            let z: string | undefined = hostZone;
            while (z !== undefined) {
                if (zones.has(z)) { out.push(itemKey); break; }
                z = nav.parentOf.get(z);
            }
        }
        return out;
    }, [nav]);
    // The zone-selection commit funnel — mirrors commitSelection (fresh set,
    // setState then the error-isolated dispatch; the event carries the zones AND
    // their child items).
    const commitZoneSelection = useCallback((next: ReadonlySet<string>, opts: { additive: boolean; key?: string }) => {
        setZoneSelection(next);
        const fn = onZoneSelectionChangeFn;
        if (fn) dispatchEast("onZoneSelectionChange", () => fn({
            key: opts.key !== undefined ? some(opts.key) : none,
            selected: opts.key !== undefined ? next.has(opts.key) : next.size > 0,
            selectedKeys: [...next],
            childItemKeys: zoneChildItems(next),
            additive: opts.additive,
        }));
    }, [onZoneSelectionChangeFn, zoneChildItems]);
    const clearZoneSelection = useCallback(() => {
        // Only a real clear commits (and fires callbacks) — Esc on an already-empty
        // zone selection is silent.
        if (renderSnapRef.current.zoneSelection.size > 0) commitZoneSelection(EMPTY_STRING_SET, { additive: false });
    }, [commitZoneSelection]);
    // The innermost selectable zone under a screen point: OUTLINE zones only
    // (hatch bands are annotations, mirroring the nav's host contract), honouring
    // explicit circle / polygon geometry, skipping locked-layer zones; smallest
    // containing zone wins so nested cells select before their hall.
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
            let hit: boolean;
            if (geom !== undefined && geom.type === "circle") {
                hit = Math.hypot(wxp - (z.x + z.width / 2), wyp - (z.y + z.height / 2)) <= geom.value.radius;
            } else if (geom !== undefined && geom.type === "polygon") {
                hit = pointInPolygon(wxp, wyp, geom.value.vertices);
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
    const linkKeyAt = useCallback((host: HTMLElement, clientX: number, clientY: number): string | undefined => {
        const snap = renderSnapRef.current;
        if (snap.size === null) return undefined;
        const cam = cameraRef.current;
        const ppuLive = snap.fit * cam.zoom;
        if (ppuLive === 0) return undefined;
        const rect = host.getBoundingClientRect();
        const sx = clientX - rect.left, sy = clientY - rect.top;
        const lanes = paintParallelLanes(effectiveLinks, l =>
            !layerHiddenKeys.has(l.key) && centers.has(l.from) && centers.has(l.to) && l.via.length === 0);
        let best: string | undefined;
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
            if (d <= weight / 2 + LINK_HIT_SLOP && d < bestD) { best = link.key; bestD = d; }
        }
        // Nets (#189): the trunk AND every branch are clickable — routed with the
        // painter's exact math so the target equals the drawing.
        for (const net of effectiveNets) {
            if (layerHiddenKeys.has(net.key) || lockedKeys.has(net.key)) continue;
            const srcPts = net.sources.map(k => centers.get(k)).filter((q): q is Pt => q !== undefined);
            const dstPts = net.destinations.map(k => centers.get(k)).filter((q): q is Pt => q !== undefined);
            if (srcPts.length === 0 || dstPts.length === 0) continue;
            const centroid = (qs: readonly Pt[]): Pt => ({
                x: qs.reduce((a, q) => a + q.x, 0) / qs.length,
                y: qs.reduce((a, q) => a + q.y, 0) / qs.length,
            });
            const head = net.via.length > 0 ? net.via[0]! : centroid(srcPts);
            const tail = net.via.length > 0 ? net.via[net.via.length - 1]! : centroid(dstPts);
            const toScreen = (q: Pt): Pt => ({ x: q.x * ppuLive + cam.tx, y: q.y * ppuLive + cam.ty });
            const orth = net.route.type === "orthogonal";
            const routePts = (anchors: Pt[]): Pt[] => orth ? orthogonalize(anchors) : anchors;
            const weight = net.style.value.weight.type === "some" ? net.style.value.weight.value
                : (net.style.type === "solid" ? 2.5 : 1.5);
            const trunkPts = routePts([head, ...net.via.slice(net.via.length > 0 ? 1 : 0, net.via.length > 0 ? net.via.length - 1 : 0), tail].map(toScreen));
            const headS = trunkPts[0]!, tailS = trunkPts[trunkPts.length - 1]!;
            const polylines: Pt[][] = [trunkPts];
            for (const q of srcPts) polylines.push(routePts([toScreen(q), headS]));
            for (const q of dstPts) polylines.push(routePts([tailS, toScreen(q)]));
            for (const pl of polylines) {
                const d = distanceToPolyline(pl, sx, sy);
                if (d <= (weight + 1) / 2 + LINK_HIT_SLOP && d < bestD) { best = net.key; bestD = d; }
            }
        }
        return best;
    }, [effectiveLinks, effectiveNets, centers, layerHiddenKeys, lockedKeys]);
    // Click-select a link — selection works read-only (inspection channel).
    const selectLink = useCallback((key: string) => {
        setSelectedLink(key);
        if (onSelectLinkFn) { const fn = onSelectLinkFn; dispatchEast("onSelectLink", () => fn(key)); }
    }, [onSelectLinkFn]);

    // Duplicate zone labels are real (tank farms repeat a code) — the
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

    // Viewport-settled reporting (#182): a trailing debounce over the throttled
    // camera snapshot — `cameraSnapshot` updates at coalesced-frame cadence during
    // a gesture / fly, so the timer keeps resetting and the event fires once,
    // ~150 ms after the LAST change (never per-frame). Deduped against the last
    // report so idle re-renders are silent.
    const lastViewportRef = useRef<{ zoom: number; minX: number; minY: number; maxX: number; maxY: number } | null>(null);
    useEffect(() => {
        if (onViewportChangeFn === undefined || size === null || fit === 0) return;
        const t = setTimeout(() => {
            const ppuLive = fit * cameraSnapshot.zoom;
            if (ppuLive <= 0) return;
            const bb = viewportWorldBbox({ ppu: ppuLive, tx: cameraSnapshot.tx, ty: cameraSnapshot.ty }, size.w, size.h);
            const ev = { zoom: cameraSnapshot.zoom, minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY };
            const last = lastViewportRef.current;
            if (last !== null && last.zoom === ev.zoom && last.minX === ev.minX && last.minY === ev.minY
                && last.maxX === ev.maxX && last.maxY === ev.maxY) return;
            lastViewportRef.current = ev;
            const fn = onViewportChangeFn;
            dispatchEast("onViewportChange", () => fn(ev));
        }, 150);
        return () => clearTimeout(t);
    }, [onViewportChangeFn, size, fit, cameraSnapshot]);

    const lod: LodTier = ppu >= LOD_CARD_PPU ? "card" : ppu >= LOD_LABEL_PPU ? "label" : "dot";
    const centerTree = useMemo(() => buildCenterTree(visibleItems), [visibleItems]);
    const tiers = useMemo(() => {
        const base = declutterTiers(visibleItems, centerTree, lod, ppu, selected);
        // `keep` + `dot`: collapse excluded items to a bare marker (drop them out
        // of the card / label tiers) so the matched survivors dominate.
        if (effectActive && excludedMode === "keep" && excludedDot) {
            for (const key of excludedKeys) if (base.has(key)) base.set(key, "dot");
        }
        return base;
    }, [visibleItems, centerTree, lod, ppu, selected, effectActive, excludedMode, excludedDot, excludedKeys]);

    const scaleLen = ppu > 0 ? niceScaleLength(ppu, 100) : 0;

    // World bbox ENCLOSING all matched items (not just the visible ones): each
    // item expanded by its rendered card / pin / dot half-extent (via `tierSize`,
    // which accounts for label length / explicit width) AND its footprint extent,
    // converted to world units at the current zoom. This is why it's `ppu` / `lod`
    // dependent — the card is screen-sized, so enclosing it needs the live zoom;
    // the `fit`-fly is keyed on the matched SET (not the rect) so this doesn't
    // re-fly on a wheel tick.
    const frameRect = useMemo(() => {
        if (!(effectActive && frameEnabled)) return undefined;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let matched = 0;
        for (const it of movedItems) {
            if (excludedKeys.has(it.key) || layerHiddenKeys.has(it.key)) continue;
            matched++;
            const hw = lod === "dot" ? DOT_FRAME_ALLOW_PX : tierSize(it, lod, ppu).w / 2 + 2;
            const hh = lod === "dot" ? DOT_FRAME_ALLOW_PX : tierSize(it, lod, ppu).h / 2 + 2;
            const aw = ppu > 0 ? hw / ppu : 0, ah = ppu > 0 ? hh / ppu : 0;
            let x0 = it.x - aw, y0 = it.y - ah, x1 = it.x + aw, y1 = it.y + ah;
            const fp = getSomeorUndefined(it.footprint);
            if (fp !== undefined && fp.type === "circle") {
                const r = fp.value.radius;
                x0 = Math.min(x0, it.x - r); y0 = Math.min(y0, it.y - r);
                x1 = Math.max(x1, it.x + r); y1 = Math.max(y1, it.y + r);
            } else if (fp !== undefined && fp.type !== "rect") {
                for (const v of fp.value.vertices) {
                    x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y);
                    x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y);
                }
            }
            if (x0 < minX) minX = x0;
            if (y0 < minY) minY = y0;
            if (x1 > maxX) maxX = x1;
            if (y1 > maxY) maxY = y1;
        }
        // A frame only reads as a grouping when it wraps 2+ items — a lone match
        // needs no box (it's already emphasised).
        return (matched >= 2 && Number.isFinite(minX)) ? { minX, minY, maxX, maxY } : undefined;
    }, [movedItems, excludedKeys, layerHiddenKeys, effectActive, frameEnabled, lod, ppu]);

    // Paint-layer effect params, minus the live pulse phase (injected at paint
    // time from a ref so the animation loop need not re-render React). `hide`
    // mode already dropped the excluded items upstream, so its dim-set is empty.
    const paintEffect = useMemo<Omit<SchematicPaintEffect, "pulsePhase"> | undefined>(() => {
        if (!effectActive) return undefined;
        return {
            excluded: excludedMode === "keep" ? excludedKeys : EMPTY_STRING_SET,
            excludedOpacity,
            excludedDesaturate,
            emphasis: emphasis as "halo" | "pulse" | undefined,
            frame: frameRect,
        };
    }, [effectActive, excludedMode, excludedKeys, excludedOpacity, excludedDesaturate, emphasis, frameRect]);

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
        paintEffect, frameRect, layerHiddenKeys, layerAlpha,
        effectiveTool, isBoxTool,
        connectDraftWorld, sessionWorld,
        selectedLink, linkEditEnabled,
    };
    const renderSnapRef = useRef(renderSnap);
    // The live pulse phase (mutated by the rAF ticker, read at paint time
    // without a React re-render) — animation-local, not a render mirror.
    const pulsePhaseRef = useRef(0);

    // Skip an apply whose inputs are referentially identical to the last —
    // covers redundant idle re-renders / repeated requestRender with no change.
    // (During an active pan the layout-effect apply still repaints, because
    // visibleItems is rebuilt fresh each snapshot; that second paint is accepted
    // — bounded by viewport culling — and keeps canvas LOD lock-step with cards.)
    const lastPaintRef = useRef<{
        zoom: number; tx: number; ty: number; vis: unknown; tiers: unknown;
        sel: ReadonlySet<string>; zsel: ReadonlySet<string>; pal: SchematicPalette | null; w: number; h: number; dpr: number; val: unknown;
        eff: unknown; phase: number; lay: unknown; alp: unknown;
        dl: unknown; sw: unknown; cf: number; slk: string | null; sle: boolean;
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
            && last.w === sz.w && last.h === sz.h && last.dpr === dprLive && last.val === snap.value
            && last.eff === snap.paintEffect && last.phase === pulsePhaseRef.current
            && last.lay === snap.layerHiddenKeys && last.alp === snap.layerAlpha
            && last.dl === snap.connectDraftWorld && last.sw === snap.sessionWorld && last.cf === cfPhase
            && last.slk === snap.selectedLink && last.sle === snap.linkEditEnabled) return;
        lastPaintRef.current = {
            zoom: cam.zoom, tx: cam.tx, ty: cam.ty, vis: snap.visibleItems, tiers: snap.tiers,
            sel: snap.renderSelected, zsel: snap.zoneSelection, pal, w: sz.w, h: sz.h, dpr: dprLive, val: snap.value,
            eff: snap.paintEffect, phase: pulsePhaseRef.current,
            lay: snap.layerHiddenKeys, alp: snap.layerAlpha,
            dl: snap.connectDraftWorld, sw: snap.sessionWorld, cf: cfPhase,
            slk: snap.selectedLink, sle: snap.linkEditEnabled,
        };
        const bw = Math.round(sz.w * dprLive), bh = Math.round(sz.h * dprLive);
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
        const ctx = canvas.getContext("2d");
        if (ctx === null) return;
        ctx.setTransform(dprLive, 0, 0, dprLive, 0, 0);
        const eff = snap.paintEffect;
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
                // Connect-tool overlays (#176): the draft edge, the open session's
                // transient edges, and the one-shot commit flash.
                ...(snap.connectDraftWorld !== undefined ? { draftLink: snap.connectDraftWorld } : {}),
                ...(snap.sessionWorld.length > 0 ? { sessionLinks: snap.sessionWorld } : {}),
                ...(cf !== null ? { connectFlash: { from: snap.centers.get(cf.from), to: snap.centers.get(cf.to), phase: cfPhase } } : {}),
                ...(snap.selectedLink !== null ? { selectedLink: { key: snap.selectedLink, editable: snap.linkEditEnabled } } : {}),
                // Spread `effect` only when set — `exactOptionalPropertyTypes` forbids
                // passing an explicit `undefined` to the optional `effect?` field.
                ...(eff !== undefined ? { effect: { ...eff, pulsePhase: pulsePhaseRef.current } } : {}),
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
        closeHover();   // a fly is a camera gesture — close, don't re-anchor
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
    }, [applyCamera, transition, closeHover]);

    // Fit the camera to a SET of selected items — the bounding box over all of them
    // (not just the last), padded so a single item lands in a comfortable window and a
    // spread set gets margin. Used by every selectZoomFocus fly so tap and marquee agree.
    const flyToSelection = useCallback((keys: ReadonlySet<string>) => {
        if (keys.size === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const k of keys) {
            const c = renderSnapRef.current.centers.get(k);
            if (c === undefined) continue;
            minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
            maxX = Math.max(maxX, c.x); maxY = Math.max(maxY, c.y);
        }
        if (minX > maxX) return;
        const padX = Math.max(4, (maxX - minX) * 0.15);
        const padY = Math.max(3, (maxY - minY) * 0.15);
        flyTo({ x: minX - padX, y: minY - padY, w: (maxX - minX) + 2 * padX, h: (maxY - minY) + 2 * padY });
    }, [flyTo]);
    // Fit the camera to a SET of selected zones (their combined bounds) — the
    // zone analogue of flyToSelection, used by selectZoomFocus zone taps.
    const flyToZones = useCallback((keys: ReadonlySet<string>) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const z of shownZones) {
            if (!keys.has(z.key)) continue;
            minX = Math.min(minX, z.x); minY = Math.min(minY, z.y);
            maxX = Math.max(maxX, z.x + z.width); maxY = Math.max(maxY, z.y + z.height);
        }
        if (minX <= maxX) flyTo({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
    }, [shownZones, flyTo]);
    // A canvas tap on a zone body (items always take precedence): `single`
    // replaces the zone set; `multiple` + Shift toggles/extends — mirroring the
    // item tap semantics. selectZoomFocus fits BEFORE the commit (fly-first).
    const zoneTap = useCallback((key: string, additive: boolean) => {
        const shiftAdd = additive && selectionMode === "multiple";
        let next: Set<string>;
        if (shiftAdd) {
            next = new Set(renderSnapRef.current.zoneSelection);
            if (next.has(key)) next.delete(key); else next.add(key);
        } else {
            next = new Set([key]);
        }
        if (selectZoomFocus) flyToZones(next);
        commitZoneSelection(next, { additive: shiftAdd, key });
        if (onSelectZoneFn) { const fn = onSelectZoneFn; dispatchEast("onSelectZone", () => fn(key)); }
    }, [selectionMode, selectZoomFocus, flyToZones, commitZoneSelection, onSelectZoneFn]);
    // End the open connect session (Esc, tool switch, or a plain new drag).
    const endLinkSession = useCallback(() => {
        linkSessionRef.current = null;
        setSessionEdges(prev => (prev.length === 0 ? prev : []));
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
    // Commit a connect gesture: extend / start the session, add a physical link
    // (draw mode) or the transient session edge (connect mode), play the flash,
    // and fire onCreateLink with the newest link + the FULL session + the pair's
    // existing links (either direction).
    const commitConnect = useCallback((from: string, to: string, shift: boolean) => {
        const key = `connect-${from}-${to}-${++linkKeyCounter.current}`;
        const ep = { key, from, to };
        const open = shift ? linkSessionRef.current : null;
        const links = open !== null ? [...open.links, ep] : [ep];
        // The session key is STABLE across the session's commits — the event's
        // `net.key`, so handlers can upsert ONE net per session (#189).
        const sessionKey = open !== null ? open.key : `net-${++linkKeyCounter.current}`;
        const additive = open !== null;
        // The session collapsed to net endpoints: distinct froms → distinct tos.
        const netSources = [...new Set(links.map(l => l.from))];
        const netDestinations = [...new Set(links.map(l => l.to))];
        const existing = effectiveLinks
            .filter(l => (l.from === from && l.to === to) || (l.from === to && l.to === from))
            .map(l => l.key);
        let drawn: "link" | "net" | "none" = "none";
        if (linkMode === "draw") {
            if (!additive) {
                // A plain drag draws a pairwise link.
                drawn = "link";
                setLinkEdits({ ...linkEdits, created: [...linkEdits.created, mkCreatedLink(key, from, to)] });
            } else {
                // The first Shift-extension CONVERTS the session's pairwise link
                // into a growing NET (same session key, #189); later extensions
                // update that net in place.
                drawn = "net";
                const net = mkCreatedNet(sessionKey, netSources, netDestinations);
                const priorLinkKey = open !== null && open.drawn === "link" ? open.links[0]?.key : undefined;
                setLinkEdits({
                    ...linkEdits,
                    created: priorLinkKey !== undefined
                        ? linkEdits.created.filter(l => l.key !== priorLinkKey)
                        : linkEdits.created,
                    createdNets: [
                        ...linkEdits.createdNets.filter(n => n.key !== sessionKey),
                        net,
                    ],
                });
            }
        } else {
            setSessionEdges(links);
        }
        linkSessionRef.current = { key: sessionKey, links, drawn };
        connectFlashRef.current = { from, to, t0: performance.now() };
        startConnectFlash();
        if (onCreateLinkFn) {
            const fn = onCreateLinkFn;
            dispatchEast("onCreateLink", () => fn({
                link: ep, links: [...links],
                net: { key: sessionKey, sources: netSources, destinations: netDestinations },
                additive, existing,
            }));
        }
    }, [effectiveLinks, linkMode, linkEdits, onCreateLinkFn, startConnectFlash]);
    // Re-target a selected link's endpoint (connector-handle drag): local-first
    // (created links edit in place; prop links via the retarget overlay), then
    // onEditLink fires with the endpoints AFTER the edit.
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
        if (onEditLinkFn) { const fn = onEditLinkFn; dispatchEast("onEditLink", () => fn({ key, from, to })); }
    }, [effectiveLinks, linkEdits, onEditLinkFn, startConnectFlash]);
    // Delete the selected link (Del / Backspace while editable): created links
    // drop locally; prop links join the deleted overlay; onDeleteLink fires.
    const deleteSelectedLink = useCallback(() => {
        const key = renderSnapRef.current.selectedLink;
        if (key === null || !renderSnapRef.current.linkEditEnabled) return;
        if (linkEdits.created.some(l => l.key === key)) {
            setLinkEdits({ ...linkEdits, created: linkEdits.created.filter(l => l.key !== key) });
        } else if (linkEdits.createdNets.some(n => n.key === key)) {
            setLinkEdits({ ...linkEdits, createdNets: linkEdits.createdNets.filter(n => n.key !== key) });
        } else {
            // Prop-supplied links AND nets share the deleted overlay.
            const deleted = new Set(linkEdits.deleted);
            deleted.add(key);
            setLinkEdits({ ...linkEdits, deleted });
        }
        setSelectedLink(null);
        if (onDeleteLinkFn) { const fn = onDeleteLinkFn; dispatchEast("onDeleteLink", () => fn(key)); }
    }, [linkEdits, onDeleteLinkFn]);
    // Finish a move gesture: fire onMoveItem ONCE with the pressed item's final
    // (clamped) position, every moved key, and the shared raw world delta.
    const commitMove = useCallback((md: { key: string; keys: readonly string[]; orig: ReadonlyMap<string, Pt>; startWorld: Pt }, dx: number, dy: number) => {
        if (onMoveItemFn === undefined) return;
        const o = md.orig.get(md.key);
        if (o === undefined) return;
        const fn = onMoveItemFn;
        const ev = {
            key: md.key,
            x: Math.min(Math.max(o.x + dx, 0), W),
            y: Math.min(Math.max(o.y + dy, 0), H),
            keys: [...md.keys],
            dx, dy,
        };
        dispatchEast("onMoveItem", () => fn(ev));
    }, [onMoveItemFn, W, H]);

    // A user gesture (collapse/fly) takes the accordion away from the viewport
    // spy until the viewport leaves that zone (issue #57, Phase 2 openZone fix).
    const zoneOverrideRef = useRef<string | null>(null);

    const flyToItem = useCallback((item: SchematicItemValue) => {
        flyTo({ x: item.x - 4, y: item.y - 3, w: 8, h: 6 });
        // A fly-to focus (nav click / step / marker tap) is always single-focus
        // REPLACE — its purpose is the camera move; Shift-add is marquee-only.
        commitSelection(new Set([item.key]), { additive: false, key: item.key, anchor: item.key });
        // Open the item's zone immediately rather than waiting for the
        // viewport spy to catch up after the fly animation.
        zoneOverrideRef.current = null;
        setOpenZone(nav.zoneOf.get(item.key) ?? null);
        // onSelect (single-key channel) still fires alongside onSelectionChange.
        if (onSelectFn) { const fn = onSelectFn; dispatchEast("onSelect", () => fn(item.key)); }
    }, [flyTo, nav.zoneOf, onSelectFn, commitSelection]);
    const stepSelection = useCallback((delta: number) => {
        const { ordered, indexOf } = itemOrder;
        if (ordered.length === 0) return;
        const anchor = selection.anchor;
        const idx = anchor !== null ? (indexOf.get(anchor) ?? -1) : -1;
        flyToItem(ordered[(idx + delta + ordered.length) % ordered.length]!);
    }, [itemOrder, flyToItem, selection.anchor]);
    // Keyboard traversal (#183 WS7): with the canvas focused, arrows step the
    // selection through the deterministic item order (the prev/next controls'
    // exact path — fly + select), Enter opens the anchored item (the dblclick
    // affordance). Esc / Space / Ctrl / Del stay on the window handler. The
    // pointer-only gestures (marquee / connect / move) keep their nav-rail and
    // callback equivalents; this covers traverse + inspect + open.
    const onCanvasKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); stepSelection(1); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); stepSelection(-1); }
        else if (e.key === "Enter") {
            const anchor = renderSnapRef.current.selection.anchor;
            if (anchor !== null && onItemOpenFn) { const fn = onItemOpenFn; dispatchEast("onItemOpen", () => fn(anchor)); }
        }
    }, [stepSelection, onItemOpenFn]);
    const flyToZone = useCallback((zone: SchematicZoneValue) => {
        flyTo({ x: zone.x, y: zone.y, w: zone.width, h: zone.height });
        zoneOverrideRef.current = null;
        setOpenZone(zone.key);
        // A nav-rail zone click also SELECTS the zone (single replace), mirroring
        // how nav item clicks commit item selection (#177).
        commitZoneSelection(new Set([zone.key]), { additive: false, key: zone.key });
        if (onSelectZoneFn) { const fn = onSelectZoneFn; dispatchEast("onSelectZone", () => fn(zone.key)); }
    }, [flyTo, commitZoneSelection, onSelectZoneFn]);

    // Wheel zooms about the cursor (no modifier — a dedicated canvas owns the
    // wheel, like any map); attached non-passively so preventDefault stops the
    // page scrolling. Mutates the live camera, then requests one frame.
    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            closeHover();
            const rect = el.getBoundingClientRect();
            const px = e.clientX - rect.left, py = e.clientY - rect.top;
            transition("wheel");
            cameraRef.current = zoomAbout(cameraRef.current, Math.exp(-e.deltaY * 0.0015), px, py, 1, MAX_ZOOM);
            requestRender();
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [transition, requestRender, closeHover]);

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
            const hit = fp.type === "circle"
                ? Math.hypot(wxp - it.x, wyp - it.y) <= fp.value.radius
                : pointInPolygon(wxp, wyp, fp.value.vertices);
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
        // A tap resolves per mode: `single` always replaces; `multiple` replaces on
        // a plain tap and toggles the item on a Shift+tap (extend the set).
        const shiftAdd = additive && selectionMode === "multiple";
        let next: Set<string>;
        if (shiftAdd) {
            next = new Set(renderSnapRef.current.selection.selected);
            if (next.has(key)) next.delete(key); else next.add(key);
        } else {
            next = new Set([key]);
        }
        // selectZoomFocus: fit the camera to the WHOLE resulting selection (bbox of
        // `next`, not just the tapped item) so multi-select always frames every
        // selected item. Fly BEFORE committing — the working paths (flyToItem:
        // nav-click, prev/next) are fly-first; commit-first leaves the fly dead.
        if (selectZoomFocus) flyToSelection(next);
        commitSelection(next, { additive: shiftAdd, key, anchor: key });
        if (onSelectFn) { const fn = onSelectFn; dispatchEast("onSelect", () => fn(key)); }
        return true;
    }, [itemKeyAt, onSelectFn, flyToSelection, selectionMode, commitSelection, selectZoomFocus]);

    // Collect the items a marquee region encloses — the pure rule lives in
    // `selection.ts` (`marqueeHits`: R-tree sweep + CENTER-in-region test,
    // skipping locked / slice-excluded; layer-hidden items are already absent
    // from `index`, built over the post-filter working set).
    const collectMarquee = useCallback((region: { minX: number; minY: number; maxX: number; maxY: number }): Set<string> =>
        marqueeHits(index, region, lockedKeys, excludedKeys),
    [index, lockedKeys, excludedKeys]);

    const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
        if (e.button !== 0) return;
        closeHover();
        // Presses on the controls / nav buttons are theirs. Cards are NOT
        // excluded — a drag-pan can start anywhere, including over a card; a
        // tap (no drag) over the card is resolved by pickAt on pointerup.
        if ((e.target as HTMLElement).closest("button") !== null) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        movedRef.current = false;
        // Move tool (#179): a press ON AN ITEM starts a reposition drag; when the
        // pressed item is part of the selection the WHOLE selection moves rigidly.
        // An empty press falls through to a pan.
        if (renderSnapRef.current.effectiveTool === "move") {
            const k = itemKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
            if (k !== undefined) {
                transition("cancel");
                const snap = renderSnapRef.current;
                const cam = cameraRef.current;
                const ppuLive = snap.fit * cam.zoom;
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const wxp = ppuLive > 0 ? (e.clientX - r.left - cam.tx) / ppuLive : 0;
                const wyp = ppuLive > 0 ? (e.clientY - r.top - cam.ty) / ppuLive : 0;
                const keys = snap.selection.selected.has(k) ? [...snap.selection.selected] : [k];
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
        // anchors at the FIXED end and follows the cursor.
        if (renderSnapRef.current.linkEditEnabled && renderSnapRef.current.selectedLink !== null) {
            const snap = renderSnapRef.current;
            const lk2 = effectiveLinks.find(l => l.key === snap.selectedLink);
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
                transition("cancel");
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const cam = cameraRef.current;
                const ppuLive = renderSnapRef.current.fit * cam.zoom;
                const wxp = ppuLive > 0 ? (e.clientX - r.left - cam.tx) / ppuLive : 0;
                const wyp = ppuLive > 0 ? (e.clientY - r.top - cam.ty) / ppuLive : 0;
                connectDragRef.current = { from, additive: e.shiftKey };
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
        transition("pointerDown");
        panRef.current = { x: e.clientX, y: e.clientY, tx: cameraRef.current.tx, ty: cameraRef.current.ty };
    }, [transition, itemKeyAt, effectiveLinks, closeHover]);
    // Drive the hover state machine from an IDLE pointermove (#178): hit-test
    // item → zone → link/net (interaction precedence), dwell before opening,
    // retarget on a new entity, grace-close over empty canvas. Read-only reuse
    // of the selection hit-testers.
    const hoverProbe = useCallback((e: React.PointerEvent) => {
        const host = e.currentTarget as HTMLElement;
        let kind: "item" | "zone" | "link" | null = null;
        let key: string | undefined;
        if (itemHoverFn !== undefined) {
            key = itemKeyAt(host, e.clientX, e.clientY);
            if (key !== undefined) kind = "item";
        }
        if (kind === null && zoneHoverFn !== undefined) {
            key = zoneKeyAt(host, e.clientX, e.clientY);
            if (key !== undefined) kind = "zone";
        }
        if (kind === null && linkHoverFn !== undefined) {
            key = linkKeyAt(host, e.clientX, e.clientY);
            if (key !== undefined) kind = "link";
        }
        if (kind === null || key === undefined) {
            scheduleHoverClose();
            return;
        }
        const open = hoverCardRef.current;
        if (open !== null && open.kind === kind && open.key === key) {
            cancelHoverClose();   // moving within the entity keeps the card
            return;
        }
        const target = `${kind}:${key}`;
        if (hoverOpenRef.current !== null && hoverOpenRef.current.target === target) return;
        cancelHoverOpen();
        // Items anchor at the marker centre (stable, matches the drawing);
        // zones / links anchor at the dwell point on their body.
        const rect = host.getBoundingClientRect();
        let ax = e.clientX - rect.left, ay = e.clientY - rect.top;
        if (kind === "item") {
            const cam = cameraRef.current;
            const ppuLive = renderSnapRef.current.fit * cam.zoom;
            const c = centers.get(key);
            if (c !== undefined && ppuLive > 0) { ax = c.x * ppuLive + cam.tx; ay = c.y * ppuLive + cam.ty; }
        }
        const kd = kind, kk = key, fx = ax, fy = ay;
        const timer = window.setTimeout(() => {
            hoverOpenRef.current = null;
            cancelHoverClose();   // the open supersedes any pending grace-close
            setHoverCard({ kind: kd, key: kk, ax: fx, ay: fy });
        }, HOVER_OPEN_MS);
        hoverOpenRef.current = { timer, target };
    }, [itemHoverFn, zoneHoverFn, linkHoverFn, itemKeyAt, zoneKeyAt, linkKeyAt, centers, scheduleHoverClose, cancelHoverOpen, cancelHoverClose]);
    const onCanvasPointerMove = useCallback((e: React.PointerEvent) => {
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
                const target = tk !== undefined && tk !== cd.from ? tk : undefined;
                setConnectDraft({ from: cd.from, toWorld: { x: wxp, y: wyp }, target });
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
        if (!pan) {
            if (hoverEnabled) hoverProbe(e);
            return;
        }
        if (Math.abs(e.clientX - pan.x) > 4 || Math.abs(e.clientY - pan.y) > 4) movedRef.current = true;
        cameraRef.current = { ...cameraRef.current, tx: pan.tx + e.clientX - pan.x, ty: pan.ty + e.clientY - pan.y };
        requestRender();
    }, [requestRender, collectMarquee, itemKeyAt, hoverEnabled, hoverProbe, W, H]);
    // End an in-progress canvas drag-pan (panning → idle). Returns whether a pan
    // was active; never disturbs a running fly.
    const endPan = useCallback(() => {
        if (panRef.current === null) return false;
        panRef.current = null;
        transition("pointerUp");
        return true;
    }, [transition]);
    const onCanvasPointerUp = useCallback((e: React.PointerEvent) => {
        // Move release (#179): fire onMoveItem once with the final delta.
        const mdUp = moveDragRef.current;
        if (mdUp !== null) {
            moveDragRef.current = null;
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const cam = cameraRef.current;
            const ppuLive = renderSnapRef.current.fit * cam.zoom;
            if (ppuLive > 0) {
                const dx = (e.clientX - r.left - cam.tx) / ppuLive - mdUp.startWorld.x;
                const dy = (e.clientY - r.top - cam.ty) / ppuLive - mdUp.startWorld.y;
                commitMove(mdUp, dx, dy);
            }
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
                if (cd.retarget !== undefined) commitRetarget(cd.retarget.key, cd.retarget.movingEnd, tk);
                else commitConnect(cd.from, tk, cd.additive);
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
                const additive = sel.additive;
                const next = additive ? new Set([...renderSnapRef.current.selection.selected, ...hits]) : hits;
                // selectZoomFocus: fit the camera to the whole selected set — fly BEFORE
                // the commit (fly-first, like flyToItem; commit-first leaves the fly dead).
                if (selectZoomFocus) flyToSelection(next);
                commitSelection(next, {
                    additive, region,
                    ...(hits.size > 0 ? { anchor: [...hits][hits.size - 1]! } : {}),
                });
            } else if (!pickAt(e.currentTarget as HTMLElement, e.clientX, e.clientY, sel.additive)) {
                // A bare tap in marquee mode: link stroke selects the link, zone
                // body selects the zone; true background clears all (unless Shift).
                const lk = linkKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
                if (lk !== undefined) selectLink(lk);
                else {
                    const zk = zoneKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
                    if (zk !== undefined) zoneTap(zk, sel.additive);
                    else if (!sel.additive) { clearSelection(); clearZoneSelection(); setSelectedLink(null); }
                }
            }
            return;
        }
        const wasPress = endPan();
        if (!wasPress || movedRef.current) return;   // not a canvas tap, or it was a drag
        // Grab-tool tap: select the item under it (per selectionMode; Shift extends
        // in multiple mode); a tap on empty background clears (unless Shift). onSelect
        // (single-key) still fires from pickAt; onSelectionChange fires from every commit.
        if (!pickAt(e.currentTarget as HTMLElement, e.clientX, e.clientY, e.shiftKey)) {
            // No item under the tap: a LINK stroke selects the link (#176), an
            // OUTLINE zone body selects the zone (#177), and a true-background
            // tap clears ALL selections (unless Shift).
            const lk = linkKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
            if (lk !== undefined) selectLink(lk);
            else {
                const zk = zoneKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
                if (zk !== undefined) zoneTap(zk, e.shiftKey);
                else if (!e.shiftKey) { clearSelection(); clearZoneSelection(); setSelectedLink(null); }
            }
        }
    }, [endPan, pickAt, flyTo, flyToSelection, collectMarquee, commitSelection, clearSelection, selectZoomFocus, zoneKeyAt, zoneTap, clearZoneSelection, itemKeyAt, commitConnect, commitRetarget, linkKeyAt, selectLink, commitMove]);
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
    // Double-click: an item under the pointer OPENS (the drill-in affordance,
    // #181) when `onItemOpen` is wired — the first click of the pair has already
    // tap-selected it (standard platform behaviour). Background double-click (or
    // no handler) keeps today's Fit / reset. Locked items never resolve.
    const onCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
        if (onItemOpenFn !== undefined) {
            const key = itemKeyAt(e.currentTarget as HTMLElement, e.clientX, e.clientY);
            if (key !== undefined) {
                const fn = onItemOpenFn;
                dispatchEast("onItemOpen", () => fn(key));
                return;
            }
        }
        resetView();
    }, [onItemOpenFn, itemKeyAt, resetView]);
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
                if (hoverCardRef.current !== null) { closeHover(); }
                else if (moveDragRef.current !== null) {
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
                    || renderSnapRef.current.selectedLink !== null) { clearSelection(); clearZoneSelection(); setSelectedLink(null); }
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
    }, [clearSelection, clearZoneSelection, endLinkSession, deleteSelectedLink, closeHover]);
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

    // Pulse emphasis: a self-contained rAF loop that advances the pulse phase and
    // repaints, only while `emphasis === "pulse"` and the effect is engaged (some
    // items excluded). `halo` / no-emphasis never spins this up; on teardown the
    // phase resets and one final repaint clears the last ring frame.
    useEffect(() => {
        if (!(effectActive && emphasis === "pulse")) return;
        let raf = 0;
        const start = performance.now();
        const tick = (now: number) => {
            const phase = ((now - start) % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
            pulsePhaseRef.current = phase;
            // Drive the DOM cards' pulse ring off the same clock (canvas markers
            // read `pulsePhaseRef` in paint; matched CARDS breathe via this var).
            cardLayerRef.current?.style.setProperty("--pulse", String(Math.sin(phase * Math.PI * 2) * 0.5 + 0.5));
            applyCamera();
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf);
            pulsePhaseRef.current = 0;
            cardLayerRef.current?.style.setProperty("--pulse", "0");
            applyCamera();
        };
    }, [effectActive, emphasis, applyCamera]);

    // Frame + `fit`: fly the camera to the matched extent whenever that SET
    // changes. Keyed on the matched item KEYS (not the rect coords) — the rect is
    // now zoom-dependent (it hugs item extents), so a coord key would re-fly on
    // every zoom; the key set only changes when the filtering does. A gesture can
    // still pan away afterwards.
    const frameSig = useMemo(() => {
        if (!(effectActive && frameFit)) return null;
        const keys: string[] = [];
        for (const it of value.items) if (!excludedKeys.has(it.key) && !layerHiddenKeys.has(it.key)) keys.push(it.key);
        keys.sort();
        return keys.join("|");
    }, [value.items, excludedKeys, layerHiddenKeys, effectActive, frameFit]);
    // `sizeReady` gates the initial fit: on mount `size` is null and `flyTo` bails,
    // so without it a State-seeded slice (filter already applied on load) would
    // never fit. It flips false→true once (resizes don't retrigger).
    const sizeReady = size !== null;
    useEffect(() => {
        // Fires on matched-set change and once the viewport is measured; the live
        // rect comes from a ref (its zoom updates are irrelevant to when we re-fly).
        // Consume the selection-driven flag FIRST (before any guard) so it can
        // never linger past this run: when the frameSig change was caused by a
        // selectZoomFocus selection commit, the selection fly already owns the
        // camera — skip the competing auto-fit (#173). A user-driven filter
        // change (chips / search) leaves the flag unset and still fits.
        const selectionDriven = selectionDrivenFitRef.current;
        selectionDrivenFitRef.current = false;
        const rect = renderSnapRef.current.frameRect;
        if (!(effectActive && frameFit) || rect === undefined || !sizeReady) return;
        if (selectionDriven) return;
        flyTo({
            x: rect.minX, y: rect.minY,
            w: Math.max(1e-3, rect.maxX - rect.minX),
            h: Math.max(1e-3, rect.maxY - rect.minY),
        });
    }, [frameSig, effectActive, frameFit, flyTo, sizeReady]);

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
                            <Box key={item.key} as="button" css={styles.navItem} data-nav-key={item.key} style={{ paddingLeft: "8px" }} {...(selected.has(item.key) ? { "data-selected": "" } : {})} onClick={() => flyToItem(item)}>
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
                tabIndex={0}
                role="application"
                aria-label="Schematic canvas — arrow keys traverse items, Enter opens the selected item"
                onKeyDown={onCanvasKeyDown}
                style={{
                    ...(fixedHeight !== undefined ? { minHeight: 0 } : { aspectRatio: `${W} / ${H}` }),
                    // Box tools (zoom / marquee) show a crosshair; for grab we leave
                    // the cursor to the recipe (grab → grabbing on :active) — an inline
                    // value would outrank the recipe and freeze it mid-pan (#153).
                    ...(isBoxTool || effectiveTool === "connect" ? { cursor: "crosshair" } : effectiveTool === "move" ? { cursor: "move" } : {}),
                }}
                onPointerEnter={() => { hoveredRef.current = true; }}
                onPointerLeave={() => { hoveredRef.current = false; setTempTool(null); scheduleHoverClose(); }}
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
                                // Slice-effect card treatment: a kept-excluded card fades /
                                // desaturates (dynamic data binding); a matched card carries the
                                // emphasis hook the recipe styles. `hide` / `dot` cards never reach
                                // here (filtered out / demoted to a canvas dot).
                                const isExcludedCard = effectActive && excludedMode === "keep" && excludedKeys.has(item.key);
                                const isEmphasized = effectActive && emphasis !== undefined && !excludedKeys.has(item.key);
                                // Layer treatment: dim (opacity × slice-keep opacity) + lock (non-selectable
                                // — clicks fall through to entities beneath, matching the pickAt lock skip).
                                const isLockedCard = lockedKeys.has(item.key);
                                const cardOpacity = (isExcludedCard ? excludedOpacity : 1) * (layerAlpha.get(item.key) ?? 1);
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
                                        {...(isEmphasized ? { "data-emphasis": emphasis } : {})}
                                        {...(isExcludedCard ? { "data-excluded": "" } : {})}
                                        style={{
                                            left: 0, top: 0,
                                            transform: `${cardTranslateCss(item.x, item.y)} translate(-50%, -50%)`,
                                            ...(typeof width === "number" ? { width: cardWidthCss(width) } : {}),
                                            ...(cardOpacity < 1 ? { opacity: cardOpacity } : {}),
                                            ...(isExcludedCard && excludedDesaturate ? { filter: "grayscale(1)" } : {}),
                                            ...(isLockedCard ? { pointerEvents: "none" as const } : {}),
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
                        {/* Drag box overlay — zoom (#153) or marquee (#159). The marquee
                            carries a live hit-count badge. Screen-space, host-relative. */}
                        {selRect !== null && (
                            <Box css={styles.selectBox} data-mode={effectiveTool === "marquee" ? "marquee" : "zoom"} style={{ left: selRect.x, top: selRect.y, width: selRect.w, height: selRect.h }} aria-hidden="true">
                                {effectiveTool === "marquee" && marqueeCount > 0 && (
                                    <Box as="span" css={styles.selectBoxCount}>{marqueeCount}</Box>
                                )}
                            </Box>
                        )}
                        {hoverCard !== null && hoverContent !== null && (
                            <Box
                                css={styles.hoverCard}
                                style={{
                                    left: Math.round(hoverCard.ax), top: Math.round(hoverCard.ay),
                                    // Flip away from the near edges without measuring the card.
                                    transform: `translate(${hoverCard.ax > size.w * 0.6 ? "calc(-100% - 12px)" : "12px"}, ${hoverCard.ay > size.h * 0.6 ? "calc(-100% - 12px)" : "12px"})`,
                                }}
                                onPointerEnter={cancelHoverClose}
                                onPointerLeave={scheduleHoverClose}
                                onPointerMove={e => e.stopPropagation()}
                                onPointerDown={e => e.stopPropagation()}
                            >
                                <EastChakraComponent value={hoverContent} storageKey={`${storageKey}.hover.${hoverCard.kind}`} />
                            </Box>
                        )}
                        <Box css={styles.controls}>
                            {/* Nav tool group: grab (pan, default) + zoom-to-box. Icons unchanged. */}
                            <Box css={styles.controlGroup}>
                                <Box as="button" css={styles.controlButton} {...(tool === "grab" ? { "data-active": "" } : {})} aria-label="Grab / pan tool" aria-pressed={tool === "grab"} title="Grab — drag to pan (hold Space)" onClick={() => setTool("grab")}><FontAwesomeIcon icon={faHand} /></Box>
                                <Box as="button" css={styles.controlButton} {...(tool === "zoom" ? { "data-active": "" } : {})} aria-label="Zoom-region tool" aria-pressed={tool === "zoom"} title="Zoom — drag a box to zoom in (hold Ctrl)" onClick={() => setTool("zoom")}><FontAwesomeIcon icon={faObjectGroup} /></Box>
                            </Box>
                            {/* Selection tool group (#159) — only when selectionMode is
                                multiple/range. Single-select folds into grab; this adds a
                                marquee (drag a box → select the enclosed items) + a clear. */}
                            {selectionEnabled && (
                                <Box css={styles.controlGroup}>
                                    <Box as="button" css={styles.controlButton} {...(tool === "marquee" ? { "data-active": "" } : {})} aria-label="Select-region tool" aria-pressed={tool === "marquee"} title="Select region — drag a box (Shift adds)" onClick={() => setTool("marquee")}><FontAwesomeIcon icon={faObjectUngroup} /></Box>
                                    {selected.size > 0 && (
                                        <Box as="button" css={styles.controlButton} aria-label="Clear selection" title="Clear selection (Esc)" onClick={clearSelection}><FontAwesomeIcon icon={faXmark} /></Box>
                                    )}
                                </Box>
                            )}
                            {/* Edit tool group (#176/#179) — per-domain buttons, hidden
                                when their domain is read-only. */}
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
