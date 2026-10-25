/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Schematic's canvas has selected (#172, #177, #1391, #1401): its
 * items and the anchor its steps walk from, its zones, and its link or its
 * net — a net's leg with it — each part committed through its one funnel, and
 * the whole selection heard once by the host after a gesture's last funnel
 * (`onSelect`, each entity by its reference) and by the frame (invariant 7).
 * What keeps the selection to the drawing — the hygiene effects, letting go of
 * what leaves it, what a layer locks or hides and what the narrowing takes out
 * (invariants 7a, 7b), and an item a drop adds or places, selected once it
 * draws (invariant 19) — and the steps through the items, each flying to the
 * item it selects (invariant 8).
 *
 * The commit-phase snapshot reads the selection (`use-paint.ts`, invariant 1),
 * and what keeps it reads the snapshot: {@link useCanvasSelection} holds the
 * selection, its funnels and its report, and is made before the snapshot;
 * {@link useSelectionSteps} holds the hygiene effects, a dropped item's
 * selection and the steps, and is made after it.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrayType, StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import type { SchematicValue } from "../data.js";
import type { NetLeg } from "../edits.js";
import type { DrawnItem, DrawnZone, SchematicDrawn, SchematicRef } from "./drawn";
import type { SchematicLayerState } from "./layers";
import { buildNavTree, byLabel, type NavZone } from "./model";
import { EMPTY_STRING_SET } from "./selection";
import { itemFrame, pointFrame, type CameraMoves } from "./use-camera";
import type { Paint } from "./use-paint";

/** What `onSelect` hears: the whole selection, each entity by its kind and key. */
const SelectedType = ArrayType(Schematic.Types.Ref);
const selectedEqual = equalFor(SelectedType);
const stringEqual = equalFor(StringType);

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

/** What {@link useCanvasSelection} reads. */
export interface CanvasSelectionProps {
    /** The payload, decoded: its `onSelect`, which hears the whole selection. */
    readonly value: SchematicValue;
    /** Each entity's reference by its id on the canvas: what the host hears an entity named by (#1401, D34). */
    readonly refById: ReadonlyMap<string, SchematicRef>;
    /** Told what is selected — the items, the zones, and the link or the net — by their ids, and the net's leg (#1391). */
    readonly onSelection: (ids: ReadonlySet<string>, leg: NetLeg | null) => void;
}

/**
 * What the canvas has selected, its funnels and its one report (see the module docs).
 *
 * @param props - The payload, each entity's reference, and what the frame is told
 * @returns The selection — the items and their anchor, the zones, the link or the net — the report's context, which
 *   the commit-phase snapshot writes, and the funnels
 */
export function useCanvasSelection({ value, refById, onSelection }: CanvasSelectionProps) {
    // The host hears the whole selection after each change, each entity by its kind and key (#1401, D34, SC29).
    const onSelectFn = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);
    // Zone (area) selection (#177) — a separate set from item selection, committed
    // through its own funnel below (declared here so early callbacks can reference it).
    const [zoneSelection, setZoneSelection] = useState<ReadonlySet<string>>(EMPTY_STRING_SET);
    // The selected link (single, #176) — selection works even when read-only
    // (inspection, and the host's `onSelect`); the connector handles / delete do not. A net
    // STUB click selects one LEG (`leg` non-null): the halo narrows to that stub
    // and Del removes just that endpoint (#189 follow-up).
    const [selectedLink, setSelectedLink] = useState<{ key: string; leg: NetLeg | null } | null>(null);

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
    // The frame hears what is selected: its toolbar's steps show while something is, the Index marks its rows, and the
    // inspector shows it — a net's leg with it (#1391).
    useEffect(() => {
        onSelection(new Set([...selected, ...zoneSelection, ...(selectedLink === null ? [] : [selectedLink.key])]), selectedLink?.leg ?? null);
    }, [selected, zoneSelection, selectedLink, onSelection]);

    // --- Zone (area) selection (#177). ---------------------------------------
    // The zone-selection commit funnel — mirrors commitSelection: a fresh set,
    // the state set, then one report of the whole selection.
    const commitZoneSelection = useCallback((next: ReadonlySet<string>) => {
        setZoneSelection(next);
        selectedNowRef.current = { ...selectedNowRef.current, zones: next };
        reportSelection();
    }, [reportSelection]);
    return {
        zoneSelection, selectedLink, selection, setSelection, selected, commitCtx, commitCtxRef,
        commitSelection, clearSelection, commitLinkSelection, commitZoneSelection,
    };
}

/** What the canvas has selected, its funnels and its one report: {@link useCanvasSelection}'s. */
export type CanvasSelection = ReturnType<typeof useCanvasSelection>;

/** What {@link useSelectionSteps} reads. */
export interface SelectionStepsProps {
    /** What the canvas draws: the links and nets a selected one is kept among, and the drawing a dropped item waits on. */
    readonly data: SchematicDrawn;
    /** What the layers hide, lock and dim. */
    readonly layers: SchematicLayerState;
    /** What never selects, by any path: a locked layer's entities, and what the narrowing takes out (SC27, #1392). */
    readonly inertKeys: ReadonlySet<string>;
    /** What the narrowing takes out of every list and of the selection, its context among it (#1392). */
    readonly narrowedOut: ReadonlySet<string>;
    /** The items drawn, a hidden layer's left out: what the selected items are kept among, and what the steps walk. */
    readonly items: readonly DrawnItem[];
    /** The zones drawn, a hidden layer's left out. */
    readonly shownZones: readonly DrawnZone[];
    /** Whether a read the drawing needs is in flight: an item a drop asks to select is waited for until it lands. */
    readonly reading: boolean;
    /** What is selected, and its funnels ({@link useCanvasSelection}'s). */
    readonly canvasSelection: CanvasSelection;
    /** The commit-phase snapshot (`use-paint.ts`, invariant 1). */
    readonly renderSnapRef: Paint["renderSnapRef"];
    /** The fly (`use-camera.ts`), which a step's selection comes after (invariant 8). */
    readonly flyTo: CameraMoves["flyTo"];
}

/**
 * What keeps the selection to the drawing, and the steps through its items (see the module docs).
 *
 * @param props - The drawing and what never selects, what is selected and its funnels, the snapshot and the fly
 * @returns The zones' clear, the fly to an item that selects it, the steps, and an item a drop asks to select: where it
 *   is asked, and what asks again
 */
export function useSelectionSteps({ data, layers, inertKeys, narrowedOut, items, shownZones, reading, canvasSelection, renderSnapRef, flyTo }: SelectionStepsProps) {
    const { zoneSelection, selection, setSelection, selected, commitSelection, commitLinkSelection, commitZoneSelection } = canvasSelection;
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
    }, [data.links, data.nets, layers.hidden, inertKeys, narrowedOut, commitLinkSelection, renderSnapRef]);

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
    }, [items, selected, inertKeys, commitSelection, setSelection]);
    const clearZoneSelection = useCallback(() => {
        // Only a real clear commits — Esc on an already-empty zone selection is silent.
        if (renderSnapRef.current.zoneSelection.size > 0) commitZoneSelection(EMPTY_STRING_SET);
    }, [commitZoneSelection, renderSnapRef]);
    // Zone-selection hygiene, as the items': a zone whose layer is hidden or locked, or the narrowing takes out, leaves
    // the selection (SC27, #1392).
    useEffect(() => {
        if (zoneSelection.size === 0) return;
        const live = new Set(shownZones.flatMap(z => (inertKeys.has(z.key) ? [] : [z.key])));
        if ([...zoneSelection].every(key => live.has(key))) return;
        commitZoneSelection(new Set([...zoneSelection].filter(key => live.has(key))));
    }, [zoneSelection, shownZones, inertKeys, commitZoneSelection]);

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

    const flyToItem = useCallback((item: DrawnItem) => {
        const size = renderSnapRef.current.size;
        flyTo(size === null ? pointFrame(item) : itemFrame(item, size));
        // A fly-to focus (Find's pick, a step, the Index's) is always
        // single-focus REPLACE — the item alone, no zone or link beside it;
        // its purpose is the camera move; Shift-add is marquee-only.
        commitSelection(new Set([item.key]), { anchor: item.key });
        clearZoneSelection();
        commitLinkSelection(null);
    }, [flyTo, commitSelection, clearZoneSelection, commitLinkSelection, renderSnapRef]);
    const stepSelection = useCallback((delta: number) => {
        const { ordered, indexOf } = itemOrder();
        if (ordered.length === 0) return;
        const anchor = selection.anchor;
        const idx = anchor !== null ? (indexOf.get(anchor) ?? -1) : -1;
        flyToItem(ordered[(idx + delta + ordered.length) % ordered.length]!);
    }, [itemOrder, flyToItem, selection.anchor]);
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
    return { clearZoneSelection, flyToItem, stepSelection, pendingSelectRef, setSelectAsked };
}

/** What keeps the selection to the drawing, and the steps: {@link useSelectionSteps}'s. */
export type SelectionSteps = ReturnType<typeof useSelectionSteps>;
