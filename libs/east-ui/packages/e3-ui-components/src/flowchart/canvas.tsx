/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's canvas (#1245, #1247, #1250) — one flow, drawn with the
 * canvas's options, in its frame's main: lane bands, state cards, H/V-routed
 * transitions, decision diamonds, evidence badges, the legend and the
 * minimap, with the dim ladder, the selection, ⌥-click tracing and, where the
 * flowchart edits, its gestures. The dimensional contract (node 116×40 r6,
 * 7px handle rings, fixed 6.5px arrowheads butting the rings, dim ladder
 * 1.0 / 0.45 / 0.15) lives in `layout.ts` and the `flowchart` slot recipe,
 * which stays in east-ui-components' theme. Colours resolve through the
 * recipe's `--fc-*` variables (theme-aware, dark-mode overrides), which the
 * flowchart's root sets. It draws no hover card (#1250): the inspector shows
 * what is selected.
 *
 * The selection is the frame's (#1250, `selection.ts`): the canvas marks it
 * and tells the frame each click — a state's card, a transition, a decision's
 * diamond, or a lane's header, which selects the lane (the user's ruling,
 * 2026-10-08); a shift-, ⌘- or Ctrl-click on a state puts it into a
 * selection of several, or takes it out; a click on the canvas where nothing
 * is, and Esc — never in a field being typed into — select nothing. The
 * selected lane takes the recipe's ring, and a selected decision's diamond
 * the brand.
 *
 * The gestures (#1247, FB17–FB20) are the frame's `edit`, each one
 * transaction of the open flow's editing session; without it the canvas edits
 * nothing, and the selection and the dim ladder stay: "+ LANE" at the band
 * row's tail (Font Awesome's plus); a lane's header double-clicked into its
 * rename in place (the user's ruling, 2026-10-08), and its × (Font Awesome's
 * xmark) — off while the lane holds states, its tooltip saying why; the
 * "+ STATE" ghost (Font Awesome's plus) a hovered lane parks under its last
 * state, which opens the inline editor; a state double-clicked into that
 * editor, or dragged across lanes; a handle dragged to a state, which
 * `canConnect` may veto, a drop on the source its in-place transition, a
 * drop that would repeat a transition pulsing it instead; and Del — in the
 * canvas, never in a field being typed into — deleting the selected state
 * with its transitions, the several states, the transition, the decision, or
 * the lane while it holds no state.
 *
 * The canvas fills main and scrolls both ways inside it: its lanes run the
 * whole of main's height, and a flow larger than main scrolls in its own box,
 * the frame's toolbar and footer staying put — and the minimap with them, in
 * main's corner over the canvas (#1251). Its toolbar's items and its
 * footer are the frame's (`toolbar.tsx`, `footer.tsx`): the model and the
 * orientation come from the frame, and a state find state picks comes as a
 * `reveal`, which selects the state and scrolls it into view.
 *
 * Where a tab of the library drops (#1249, FB30–FB33), the canvas is one drop
 * cell of the shared drag layer, on the frame's drop target (`use-drop.ts`):
 * it works out where a drag rests from its own drawing (`drop.ts`'s
 * `dropAtPoint`) — a lane and the row a state takes there, a state, a
 * transition, a lane's header, a decision's diamond — and, while the drop
 * there lands, marks it: the lane takes a wash and a line runs where the state
 * lands, or the state, the transition — the brand wash — or the diamond takes
 * the brand. The marks show only while the drag rests over the canvas and the
 * drop lands (the recipe's); a drag over the canvas raises no dimming and no
 * "+ STATE" ghost. A state a drop adds comes back as a `reveal`, selected.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Portal, Tooltip, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBan, faPlus, faRotateRight, faXmark } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor } from "@elaraai/east";
import {
    getSomeorUndefined, typedInto, useDragLayerOptional, useDropCell, type CellCoord, type DragPayload,
} from "@elaraai/east-ui-components";
import type { FlowchartWords } from "./messages.js";
import type { FlowchartCanvasValue, FlowchartModel, ModelLink } from "./model.js";
import {
    computeLayout, landingSeam, previewCursorPath, previewLinkPath,
    type FlowchartLayout, type LinkRoute, type Pt,
    BADGE_H, LANE_HEADER_H, RING_R,
} from "./layout.js";
import { dropTargetAt, existingLink, laneAt } from "./connect.js";
import {
    ON_CANVAS, dropAtPoint, markEqual, markOf, printDropAt, readDropAt,
    type FlowchartCanvasDrop, type FlowchartDropMark,
} from "./drop.js";
import { selectedStates, toggleState, type FlowchartSelection } from "./selection.js";
import type { FlowchartOrientation } from "./toolbar.js";

type SelectFn = ((key: string) => unknown) | undefined;

/**
 * What the frame asks the canvas to select and bring into view (#1249,
 * #1250): a state find state picked or a drop added, or what a click in the
 * inspector names — a transition in a state's Details, an issue's row — once
 * per ask.
 */
export interface FlowchartReveal {
    /** What to select. */
    readonly selection: FlowchartSelection;
    /** The ask's number: each a new one, so a second ask of one thing reveals it again. */
    readonly seq: number;
    /** `false`: selected where it stands, never scrolled — a state dropped where the pointer is, a key edited in the inspector. */
    readonly scroll?: boolean | undefined;
}

/** Where a drag rests over the canvas before it says otherwise: the canvas itself. */
const CANVAS_AT = printDropAt(ON_CANVAS);

const keyEqual = equalFor(StringType);

/**
 * The canvas's gestures (#1247): each one transaction of the open flow's
 * editing session, made by the frame. The canvas hands each what it gathered —
 * keys, labels, lanes — and the frame records the flow it leaves.
 */
export interface FlowchartCanvasEdit {
    /** "+ LANE": a lane at the band row's tail. */
    readonly addLane: () => void;
    /** A lane's header renamed. */
    readonly renameLane: (key: string, label: string) => void;
    /** A lane's ×: deleted, while it holds no state (FB19). */
    readonly deleteLane: (key: string) => void;
    /** The "+ STATE" ghost's editor committed: a state at the end of its lane. */
    readonly addState: (lane: string, key: string, label: string) => void;
    /** A state's editor committed: its key — a new one rekeying its transitions (FB18) — and its label. */
    readonly editState: (key: string, next: string, label: string) => void;
    /** A state dropped on another lane. */
    readonly moveState: (key: string, lane: string) => void;
    /** Del on a selected state: deleted with its transitions. */
    readonly deleteState: (key: string) => void;
    /** Del on several selected states (#1250): each deleted with its transitions. */
    readonly deleteStates: (keys: readonly string[]) => void;
    /** A handle dragged to a state (FB20); the state itself for an in-place transition. */
    readonly connect: (from: string, to: string) => void;
    /** Del on a selected transition. */
    readonly deleteLink: (key: string) => void;
    /** Del on a selected decision: cleared from the transitions it governs. */
    readonly deleteDecision: (key: string) => void;
}

/** Props of {@link FlowchartCanvasView}. */
export interface FlowchartCanvasViewProps {
    /** What the canvas draws its flow with. */
    readonly canvas: FlowchartCanvasValue;
    /** The open flow's view model. */
    readonly model: FlowchartModel;
    /** Left to right, or top down. */
    readonly orientation: FlowchartOrientation;
    /** What the frame asked the canvas to select and bring into view last, or `null`. */
    readonly reveal: FlowchartReveal | null;
    /** The gestures, where the flowchart edits; `undefined`, it edits nothing, and the selection and the dim ladder stay. */
    readonly edit: FlowchartCanvasEdit | undefined;
    /** The canvas's drop cell, where a tab of the library drops (#1249); `undefined`, it takes no drop. */
    readonly drop?: FlowchartCanvasDrop | undefined;
    /** What is selected (#1250): the frame's, as the open flow holds it. */
    readonly selection: FlowchartSelection | null;
    /** Selects something, or nothing — a click, a shift-click, Esc, a click where nothing is: the frame's selection moves. */
    readonly onSelect: (selection: FlowchartSelection | null) => void;
    /** The flowchart's words: the gestures' names, and its counts in the app's locale. */
    readonly words: FlowchartWords;
    /** The structural storage key. */
    readonly storageKey: string;
}

/** All East callbacks route through one funnel: microtask + try/catch. */
function dispatchEast(name: string, run: () => unknown): void {
    queueMicrotask(() => {
        try {
            const out = run();
            if (out instanceof Promise) out.catch(err => console.error(`[Flowchart] ${name} callback failed:`, err));
        } catch (err) {
            console.error(`[Flowchart] ${name} callback failed:`, err);
        }
    });
}

// ── Palette — recipe-defined vars mirroring the spec's DS tokens ──────────
const INK = "var(--fc-ink)";            // planned stroke + badge numerals (--ink-2)
const INK_3 = "var(--fc-ink3)";         // secondary text (--ink-3)
const INK_4 = "var(--fc-ink4)";         // lane headers, legend title (--ink-4)
const PAPER = "var(--fc-paper)";        // card / badge fill (--paper)
const LANE_TINT = "var(--fc-lane)";     // alternating band fill (--paper-2)
const RULE_STRONG = "var(--fc-rule-strong)";
const INFO = "var(--fc-info)";          // observed (--info)
const BRAND = "var(--fc-brand)";        // selection halo (--brand)
const BRAND_D = "var(--fc-brand-d)";    // selection stroke, diamonds (--brand-d)
const BRAND_DD = "var(--fc-brand-dd)";  // selected badge numerals (--brand-dd)
const NEG = "var(--fc-neg)";            // unresolved (--neg)

const CLASS_STROKE = { planned: INK, observed: INFO, unresolved: NEG } as const;
const CLASS_DASH = { planned: undefined, observed: "5 4", unresolved: "4 4" } as const;
const CLASS_MARKER = { planned: "ink", observed: "info", unresolved: "neg" } as const;

const MONO = "var(--chakra-fonts-mono)";

type Hover = { kind: "state" | "link" | "trigger"; key: string } | null;
type Selection = FlowchartSelection | null;

/** Dim ladder per the spec — three steps only, opacity only. */
const FOCUS = 1.0, CONTEXT = 0.45, FADED = 0.15;

interface DimSets {
    active: boolean;
    restLevel: number;
    nodes: ReadonlySet<string>;
    links: ReadonlySet<string>;
}

const NO_DIM: DimSets = { active: false, restLevel: CONTEXT, nodes: new Set(), links: new Set() };

function computeDim(model: FlowchartModel, hover: Hover): DimSets {
    if (hover === null) return NO_DIM;
    const nodes = new Set<string>();
    const links = new Set<string>();
    if (hover.kind === "state") {
        nodes.add(hover.key);
        for (const l of model.links) {
            if (l.from === hover.key || l.to === hover.key) {
                links.add(l.key);
                nodes.add(l.from);
                nodes.add(l.to);
            }
        }
        return { active: true, restLevel: CONTEXT, nodes, links };
    }
    if (hover.kind === "link") {
        const l = model.links.find(x => x.key === hover.key);
        if (l) { links.add(l.key); nodes.add(l.from); nodes.add(l.to); }
        return { active: true, restLevel: CONTEXT, nodes, links };
    }
    const t = model.triggers.get(hover.key);
    if (t) {
        for (const key of t.governs) {
            links.add(key);
            const l = model.links.find(x => x.key === key);
            if (l) { nodes.add(l.from); nodes.add(l.to); }
        }
        for (const q of t.queue) nodes.add(q);
    }
    return { active: true, restLevel: FADED, nodes, links };
}

/** Ring colour per the spec connector anatomy: brand if any attached link
 * is selected, info if only observed links attach, otherwise ink. */
function portColor(attached: ModelLink[], selectedLink: string | null): string {
    if (attached.some(l => l.key === selectedLink)) return BRAND_D;
    if (attached.length > 0 && attached.every(l => l.cls === "observed")) return INFO;
    if (attached.length > 0 && attached.every(l => l.cls === "unresolved")) return NEG;
    return INK;
}

/** A lane's ×: its box's side, centred on its glyph. */
const CLOSE_BOX = 14;
/** A lane header's middle above its baseline: mono 10px caps. */
const HEAD_MIDDLE = 4;

/**
 * Where a lane's header stands: its anchor — the band's middle across the top
 * in LR, its start down the side in TD — its baseline, and the middle of its
 * ×, past the label's end (mono 10 / ls 2.2 ⇒ ~8.2px a glyph).
 *
 * @param layout - The laid-out flow
 * @param lane - The lane's band
 * @returns The header's anchor and baseline, whether it runs down the side, and its ×'s middle
 */
function laneHead(layout: FlowchartLayout, lane: FlowchartLayout["lanes"][number]): { x: number; y: number; td: boolean; close: number } {
    const td = layout.orientation === "TD";
    const x = td ? 12 : lane.cx;
    const y = td ? lane.y + 24 : 26;
    const labelW = lane.label.length * 8.2;
    return { x, y, td, close: (td ? x + labelW + 12 : x + labelW / 2 + 14) + 3.5 };
}

/**
 * Where a click on a lane's header lands (#1250): the band's strip before its
 * first row — across the band's top in LR; in TD, down to the header's ×
 * along the band's side — so nobody has to hit the label's letters.
 *
 * @param layout - The laid-out flow
 * @param lane - The lane's band
 * @returns The strip, in the canvas's px
 */
function laneHeadBox(layout: FlowchartLayout, lane: FlowchartLayout["lanes"][number]): { x: number; y: number; w: number; h: number } {
    if (layout.orientation !== "TD") return { x: lane.x, y: lane.y, w: lane.w, h: LANE_HEADER_H };
    return { x: lane.x, y: lane.y, w: Math.max(0, laneHead(layout, lane).close - CLOSE_BOX / 2 - lane.x), h: LANE_HEADER_H };
}

/**
 * The point of the canvas a selection is brought to the middle of the view
 * at (#1250): a state's card, a transition's longest run — an in-place one's
 * state — a decision's first diamond, a lane's header, or several states'
 * first.
 *
 * @param layout - The laid-out flow
 * @param model - The flow's view model
 * @param selection - What is selected
 * @returns The point, or `undefined` for what the canvas draws nowhere
 */
function revealPoint(layout: FlowchartLayout, model: FlowchartModel, selection: FlowchartSelection): Pt | undefined {
    const nodeAt = (key: string): Pt | undefined => {
        const rect = layout.nodes.get(key);
        return rect === undefined ? undefined : { x: rect.cx, y: rect.cy };
    };
    switch (selection.kind) {
        case "state": return nodeAt(selection.key);
        case "states": return selection.keys.length === 0 ? undefined : nodeAt(selection.keys[0]!);
        case "link": {
            const route = layout.routes.find((r) => keyEqual(r.key, selection.key));
            if (route !== undefined) return route.mid;
            const folded = model.nodes.find((n) => n.inPlaceKeys.some((k) => keyEqual(k, selection.key)));
            return folded === undefined ? undefined : nodeAt(folded.key);
        }
        case "trigger": {
            const governs = model.triggers.get(selection.key)?.governs ?? [];
            const route = layout.routes.find((r) => governs.some((k) => keyEqual(k, r.key)));
            return route?.mid;
        }
        case "lane": {
            const lane = layout.lanes.find((l) => keyEqual(l.key, selection.key));
            if (lane === undefined) return undefined;
            const head = laneHead(layout, lane);
            return { x: head.x, y: head.y };
        }
    }
}

/** Badge chrome inherits the link class (spec markup: observed = dashed
 * info; selected = solid brand-d border, brand-dd numerals). */
function badgeStyle(cls: ModelLink["cls"], selected: boolean): { stroke: string; dash: string | undefined; text: string } {
    if (selected) return { stroke: BRAND_D, dash: undefined, text: BRAND_DD };
    if (cls === "observed") return { stroke: INFO, dash: "4 3", text: INFO };
    if (cls === "unresolved") return { stroke: NEG, dash: "4 3", text: NEG };
    return { stroke: RULE_STRONG, dash: undefined, text: INK };
}

/**
 * The canvas: one flow, drawn with the canvas's options, filling its frame's
 * main — see the module docs.
 *
 * @param props - The canvas's options, the flow's model, the orientation, what to reveal, the gestures, the drop cell, the selection and what selects, the words and the storage key
 * @returns The canvas's box, which scrolls the flow inside it
 */
export function FlowchartCanvasView({ canvas, model, orientation, reveal, edit, drop, selection, onSelect, words, storageKey }: FlowchartCanvasViewProps) {
    const styles = useSlotRecipe({ key: "flowchart" })();

    // ── decode ────────────────────────────────────────────────────────────
    // The model is the frame's, keyed on the flow's DATA identity (#809): a
    // closure-only change re-renders with the new callbacks but keeps the
    // model — and the routed layout derived from it.
    const legendOn = getSomeorUndefined(canvas.legend) ?? true;
    const minimapOpt = getSomeorUndefined(canvas.minimap);

    const onSelectStateFn = useMemo(() => getSomeorUndefined(canvas.onSelectState) as SelectFn, [canvas.onSelectState]);
    const onSelectLinkFn = useMemo(() => getSomeorUndefined(canvas.onSelectLink) as SelectFn, [canvas.onSelectLink]);
    const onSelectTriggerFn = useMemo(() => getSomeorUndefined(canvas.onSelectTrigger) as SelectFn, [canvas.onSelectTrigger]);
    const onTracePathFn = useMemo(() => getSomeorUndefined(canvas.onTracePath) as SelectFn, [canvas.onTracePath]);
    const canConnectFn = useMemo(
        () => getSomeorUndefined(canvas.canConnect) as ((from: string, to: string) => boolean) | undefined,
        [canvas.canConnect]);

    // ── view state ────────────────────────────────────────────────────────
    // The selection is the frame's (#1250): its latest, for the keys, and what moves it.
    const selectionRef = useRef<Selection>(selection);
    selectionRef.current = selection;
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const pickedStates = selectedStates(selection);
    const [hover, setHover] = useState<Hover>(null);
    // A drag in flight (#1249): it raises no dimming and no "+ STATE" ghost.
    const dragging = useDragLayerOptional()?.active ?? false;
    const draggingRef = useRef(dragging);
    draggingRef.current = dragging;
    /** What the pointer is over, for the dim ladder — never while a drag is in flight. */
    const hoverOn = useCallback((next: Hover) => { if (!draggingRef.current) setHover(next); }, []);

    // Connect-drag draft (one object; pure helpers live in connect.ts).
    const [draft, setDraft] = useState<{
        from: string; side: "left" | "right" | "top" | "bottom";
        x: number; y: number; over: string | null; allowed: boolean; dup: string | undefined;
    } | null>(null);
    const draftRef = useRef<typeof draft>(null);
    draftRef.current = draft;
    // One pulse mechanism for both outcomes: a drop that would duplicate an
    // existing link pulses IT; a successful create pulses the new link once
    // its row arrives. Matched by endpoints, auto-cleared.
    const [pulse, setPulse] = useState<{ from: string; to: string; seq: number } | null>(null);
    // Inline lane-header rename (one object; commit → the session's rename).
    const [laneEdit, setLaneEdit] = useState<{ key: string; label: string } | null>(null);
    // "+ STATE" ghost reveal (spec Flowchart.Lane): one hovered lane at a time.
    const [laneHover, setLaneHover] = useState<string | null>(null);
    // One inline node editor for BOTH the ghost commit and double-click edit.
    const [stateEditor, setStateEditor] = useState<
        | { mode: "add"; lane: string; code: string; label: string }
        | { mode: "edit"; key: string; code: string; label: string }
        | null
    >(null);
    // Cross-lane node drag (one object; candidate band highlights live).
    const [moveDrag, setMoveDrag] = useState<{ key: string; x: number; y: number; overLane: string | null } | null>(null);
    const moveDragRef = useRef<typeof moveDrag>(null);
    moveDragRef.current = moveDrag;
    const movedRef = useRef(false);
    useEffect(() => {
        if (pulse === null) return;
        const t = setTimeout(() => setPulse(null), 1100);
        return () => clearTimeout(t);
    }, [pulse]);
    // A drag picked up (#1249): the state or transition the pointer rested on lets go of its dimming.
    useEffect(() => {
        if (!dragging) return;
        setHover(null);
    }, [dragging]);

    // ── measure ───────────────────────────────────────────────────────────
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    useLayoutEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const layout: FlowchartLayout | null = useMemo(
        () => (size === null ? null : computeLayout(model, {
            width: size.w,
            orientation,
            legendPad: legendOn ? 122 : 0,
            // The lanes run the whole of main's height.
            minHeight: size.h > 0 ? size.h : undefined,
        })),
        [model, size, orientation, legendOn],
    );

    // ── drops (#1249) ─────────────────────────────────────────────────────
    // The canvas is one drop cell: where a drag rests is worked out from the
    // drawing as it stands, and marked while the drop there lands.
    const layoutRef = useRef(layout);
    layoutRef.current = layout;
    const modelRef = useRef(model);
    modelRef.current = model;
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [dropMark, setDropMark] = useState<FlowchartDropMark | undefined>(undefined);
    // The drag over: nothing stays marked.
    useEffect(() => { if (!dragging) setDropMark(undefined); }, [dragging]);
    /** Where a drag rests at a client point, for what it carries: the coordinate its drop's `CellRef` names. */
    const resolveDrop = useCallback((clientX: number, clientY: number, payload: DragPayload): CellCoord => {
        const surface = drop?.surface ?? "";
        const card = drop?.cardOf(payload);
        const drawn = layoutRef.current;
        const wrap = wrapRef.current;
        if (card === undefined || drawn === null || wrap === null) return { surface, row: CANVAS_AT, slot: "" };
        const box = wrap.getBoundingClientRect();
        return { surface, row: printDropAt(dropAtPoint(card.lands, drawn, modelRef.current, { x: clientX - box.left, y: clientY - box.top })), slot: "" };
    }, [drop]);
    /** The drag rests where its drop lands: the canvas marks it. */
    const hoverDrop = useCallback((clientX: number, clientY: number, payload: DragPayload) => {
        const card = drop?.cardOf(payload);
        const at = readDropAt(resolveDrop(clientX, clientY, payload).row);
        const mark = drop === undefined || card === undefined || at === undefined ? undefined : markOf(drop.plan(card, at));
        setDropMark((was) => (markEqual(was, mark) ? was : mark));
    }, [drop, resolveDrop]);
    const dropOptions = useMemo(() => (drop === undefined ? undefined : { ...drop.options, onHover: hoverDrop }), [drop, hoverDrop]);
    const dropCell = useDropCell(drop === undefined || layout === null ? null : { surface: drop.surface, row: CANVAS_AT, slot: "" },
        false, drop?.canDrop, resolveDrop, dropOptions);
    const setWrap = useCallback((el: HTMLDivElement | null) => {
        wrapRef.current = el;
        dropCell(el);
    }, [dropCell]);

    // ── dim ladder ────────────────────────────────────────────────────────
    const dim = useMemo(() => computeDim(model, hover), [model, hover]);
    const nodeOpacity = (key: string): number => (!dim.active ? FOCUS : dim.nodes.has(key) ? FOCUS : dim.restLevel);
    const linkOpacity = (key: string): number => (!dim.active ? FOCUS : dim.links.has(key) ? FOCUS : dim.restLevel);
    const selectedLink = selection?.kind === "link" ? selection.key : null;
    const fade = (on: boolean): string | undefined => (on ? "opacity 150ms ease" : undefined);

    // ── interactions ──────────────────────────────────────────────────────
    // The frame's selection moves, and the host hears a state, a transition or a decision selected alone.
    const select = useCallback((sel: Selection) => {
        onSelectRef.current(sel);
        if (sel === null) return;
        if (sel.kind === "state" && onSelectStateFn) dispatchEast("onSelectState", () => onSelectStateFn(sel.key));
        if (sel.kind === "link" && onSelectLinkFn) dispatchEast("onSelectLink", () => onSelectLinkFn(sel.key));
        if (sel.kind === "trigger" && onSelectTriggerFn) dispatchEast("onSelectTrigger", () => onSelectTriggerFn(sel.key));
    }, [onSelectStateFn, onSelectLinkFn, onSelectTriggerFn]);

    // What the frame asks for — a state find state picked (#1245), a drop
    // added (#1249), what a click in the inspector names (#1250): selected, as
    // a click selects it, and — but for a state dropped where the pointer is,
    // or a key edited where it stands — scrolled to the middle of the canvas's
    // box: once per ask.
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const revealed = useRef(0);
    useEffect(() => {
        if (reveal === null || reveal.seq === revealed.current) return;
        revealed.current = reveal.seq;
        select(reveal.selection);
        if (reveal.scroll === false || layout === null) return;
        const at = revealPoint(layout, model, reveal.selection);
        const box = scrollRef.current;
        if (at === undefined || box === null) return;
        box.scrollLeft = Math.max(0, at.x - box.clientWidth / 2);
        box.scrollTop = Math.max(0, at.y - box.clientHeight / 2);
    }, [reveal, layout, model, select]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            // A field being typed into keeps its own Esc: what it holds is put back, the selection kept.
            if (e.key !== "Escape" || typedInto(e.target)) return;
            // Spec: esc restores everything instantly.
            onSelectRef.current(null);
            setHover(null);
            setDraft(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // Del deletes the selection (FB17) — heard in the canvas, never in a field
    // being typed into, which keeps its own Del: a state with its transitions,
    // several states (#1250), a transition, a decision cleared from the
    // transitions it governs, a lane holding no state (#1250).
    const onCanvasKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>): void => {
        if ((e.key !== "Delete" && e.key !== "Backspace") || edit === undefined || typedInto(e.target)) return;
        const sel = selectionRef.current;
        // A lane holding states is never deleted (FB19): Del leaves it, selected.
        if (sel === null || (sel.kind === "lane" && (modelRef.current.laneStates.get(sel.key) ?? 0) > 0)) return;
        e.preventDefault();
        onSelectRef.current(null);
        setHover(null);
        switch (sel.kind) {
            case "state": edit.deleteState(sel.key); return;
            case "states": edit.deleteStates(sel.keys); return;
            case "link": edit.deleteLink(sel.key); return;
            case "trigger": edit.deleteDecision(sel.key); return;
            case "lane": edit.deleteLane(sel.key); return;
        }
    }, [edit]);

    const canConnect = useCallback((from: string, to: string): boolean => {
        // from === to is LEGAL: dropping on the source commits an in-place
        // transition (rendered as the ↻ badge, never routed).
        if (!canConnectFn) return true;
        try {
            return canConnectFn(from, to) !== false;
        } catch (err) {
            console.error("[Flowchart] canConnect failed (allowing):", err);
            return true;                        // fail-open per spec
        }
    }, [canConnectFn]);

    const svgPoint = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } => {
        const el = bodyRef.current?.querySelector("[data-flowchart-canvas]");
        const r = el?.getBoundingClientRect();
        return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
    }, []);

    const beginDraft = useCallback((from: string, side: "left" | "right" | "top" | "bottom", e: React.PointerEvent) => {
        if (edit === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        const p = svgPoint(e);
        setDraft({ from, side, x: p.x, y: p.y, over: null, allowed: false, dup: undefined });
        const move = (ev: PointerEvent): void => {
            const q = svgPoint(ev);
            const fromKey = draftRef.current?.from ?? from;
            // The WHOLE node (plus DROP_PAD) is the target — nobody has to
            // land a 7px ring.
            const over = layout ? dropTargetAt(layout, q) : null;
            const dup = over !== null ? existingLink(model, fromKey, over) : undefined;
            const allowed = over !== null && dup === undefined && canConnect(fromKey, over);
            setDraft(d => (d === null ? d : { ...d, x: q.x, y: q.y, over, allowed, dup }));
        };
        const up = (): void => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            const d = draftRef.current;
            setDraft(null);
            if (!d || d.over === null) return;
            if (d.dup !== undefined) {
                // Already connected — absorb the drop and pulse the existing
                // link (or the node itself for a folded in-place loop).
                setPulse(p => ({ from: d.from, to: d.over!, seq: (p?.seq ?? 0) + 1 }));
                return;
            }
            if (d.allowed) {
                edit.connect(d.from, d.over);
                setPulse(p => ({ from: d.from, to: d.over!, seq: (p?.seq ?? 0) + 1 }));
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [edit, svgPoint, layout, model, canConnect]);

    /** Node move gesture — begins after a 5px threshold so plain clicks
     * stay selection; candidate lane bands highlight while dragging. */
    const beginMove = useCallback((key: string, e: React.PointerEvent) => {
        if (edit === undefined) return;
        const startP = svgPoint(e);
        let started = false;
        movedRef.current = false;
        const move = (ev: PointerEvent): void => {
            const q = svgPoint(ev);
            if (!started) {
                if (Math.abs(q.x - startP.x) + Math.abs(q.y - startP.y) < 5) return;
                started = true;
                movedRef.current = true;
            }
            const overLane = layout ? laneAt(layout, q) : null;
            setMoveDrag({ key, x: q.x, y: q.y, overLane });
        };
        const up = (): void => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            const d = moveDragRef.current;
            setMoveDrag(null);
            if (!started || d === null || d.overLane === null) return;
            const node = model.nodesByKey.get(key);
            const currentLane = node !== undefined ? model.lanes[node.laneIndex]?.key : undefined;
            if (d.overLane !== currentLane) edit.moveState(key, d.overLane);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [edit, svgPoint, layout, model]);

    // ── render helpers ────────────────────────────────────────────────────
    const linksByKey = useMemo(() => new Map(model.links.map(l => [l.key, l])), [model]);
    const showMinimap = minimapOpt ?? model.nodes.length >= 25;

    // dashed renders over solid; selected on top.
    const orderedRoutes = useMemo(() => {
        if (!layout) return [];
        const solid: LinkRoute[] = [], dashed: LinkRoute[] = [], selected: LinkRoute[] = [];
        for (const r of layout.routes) {
            const l = linksByKey.get(r.key);
            if (!l) continue;
            if (r.key === selectedLink) selected.push(r);
            else if (l.cls === "planned") solid.push(r);
            else dashed.push(r);
        }
        return [...solid, ...dashed, ...selected];
    }, [layout, linksByKey, selectedLink]);

    // A flow with nothing in it — no lane, no state, no transition — draws
    // nothing; its box stays, measured, for the flow that comes. A flow of
    // lanes alone, a new one among them (#1246), draws its lanes; and one the
    // flowchart edits draws its band row, so "+ LANE" can give it its first
    // lane again (#1247).
    const empty = model.blank && edit === undefined;
    // The lanes a gesture may rename, delete or add a state to: the flow's own — never the stand-in band of a flow with none.
    const laneGestures = edit !== undefined && !model.standIn ? edit : undefined;
    const body = (
        <Box ref={bodyRef} css={styles.body} data-flowchart-body="">
            {layout !== null && !empty && (
                // Focusable, so a press inside it — a state, a transition — lands its keys here: Del's.
                <Box ref={scrollRef} css={styles.scroll} data-flowchart-scroll="" tabIndex={-1} onKeyDown={onCanvasKey}>
                    {/* The canvas's one drop cell, where a tab of the library drops (#1249). */}
                    <Box ref={setWrap} css={styles.canvasWrap} style={{ width: layout.width, height: layout.height }}>
                        <svg
                            data-flowchart-canvas
                            width={layout.width}
                            height={layout.height}
                            viewBox={`0 0 ${layout.width} ${layout.height}`}
                            style={{ position: "absolute", inset: 0, display: "block" }}
                            onClick={(e) => {
                                // A click where nothing is — no transition, diamond or lane's header — selects nothing (#1250).
                                if ((e.target as Element).closest("[data-flowchart-link], [data-flowchart-trigger], [data-flowchart-lane-head]") === null) select(null);
                            }}
                        >
                            <defs>
                                {/* Fixed 12px filled arrowheads — the spec sheet's visual
                                    size — userSpaceOnUse so they never scale with stroke;
                                    refX 10 puts the TIP exactly at the path end, which is
                                    trimmed to the ring edge. */}
                                {([["ink", INK], ["info", INFO], ["neg", NEG], ["brand", BRAND_D]] as const).map(([id, color]) => (
                                    <marker key={id} id={`fc-mk-${id}-${storageKey}`} viewBox="0 0 10 10" refX={10} refY={5}
                                        markerWidth={12} markerHeight={12} markerUnits="userSpaceOnUse" orient="auto">
                                        <path d="M0 0L10 5L0 10z" fill={color} />
                                    </marker>
                                ))}
                            </defs>

                            {/* lane bands — alternating paper-2 tint */}
                            {layout.lanes.map(lane => lane.tinted && (
                                <rect key={lane.key} x={lane.x} y={lane.y} width={lane.w} height={lane.h} fill={LANE_TINT} />
                            ))}
                            {/* band hover trackers — reveal the "+ STATE" ghost */}
                            {laneGestures !== undefined && layout.lanes.map(lane => (
                                <rect
                                    key={`bandhit-${lane.key}`}
                                    data-flowchart-band={lane.key}
                                    x={lane.x} y={lane.y} width={lane.w} height={lane.h}
                                    fill="transparent"
                                    onPointerEnter={() => setLaneHover(lane.key)}
                                    onPointerLeave={() => setLaneHover(h => (h === lane.key ? null : h))}
                                />
                            ))}
                            {/* move-drag candidate band highlight */}
                            {moveDrag !== null && moveDrag.overLane !== null && (() => {
                                const lane = layout.lanes.find(l => l.key === moveDrag.overLane);
                                if (!lane) return null;
                                return (
                                    <g style={{ pointerEvents: "none" }}>
                                        <rect x={lane.x} y={lane.y} width={lane.w} height={lane.h} fill={BRAND} opacity={0.07} />
                                        <rect x={lane.x + 2} y={lane.y + 2} width={lane.w - 4} height={lane.h - 4}
                                            fill="none" stroke={BRAND_D} strokeDasharray="6 4" strokeWidth={1.5} />
                                    </g>
                                );
                            })()}
                            {/* lane headers — mono 10/600 ls 2.2 ink-4 (inline styles:
                                presentation attributes lose to the app CSS reset). A
                                click on the header's strip selects its lane, and a
                                double-click renames it in place where the flowchart
                                edits (#1250, the user's ruling, 2026-10-08); the
                                stand-in band of a flow with no lane is neither. Each
                                lane's × and "+ LANE" are the HTML layer's, below. */}
                            {layout.lanes.map(lane => {
                                const head = laneHead(layout, lane);
                                const text = (
                                    <text x={head.x} y={head.y} textAnchor={head.td ? "start" : "middle"}
                                        style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: "2.2px", fill: INK_4 }}
                                        data-flowchart-lane={lane.key}>
                                        {lane.label.toUpperCase()}
                                    </text>
                                );
                                if (model.standIn) return <g key={lane.key}>{text}</g>;
                                const box = laneHeadBox(layout, lane);
                                return (
                                    <g key={lane.key} data-flowchart-lane-head={lane.key} style={{ cursor: "pointer" }}
                                        onClick={() => select({ kind: "lane", key: lane.key })}
                                        onDoubleClick={laneGestures !== undefined ? () => setLaneEdit({ key: lane.key, label: lane.label }) : undefined}>
                                        <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="transparent" />
                                        {text}
                                    </g>
                                );
                            })}

                            {/* the brand wash on the transition a card retypes where it
                                rests (#1249, FB32) — under every line, the recipe's */}
                            {dropMark?.kind === "transition" && (() => {
                                const route = layout.routes.find((r) => keyEqual(r.key, dropMark.key));
                                return route === undefined ? null : <path data-flowchart-dropwash={route.key} d={route.d} />;
                            })()}

                            {/* links — solid, then dashed (dashed renders over solid), selected last */}
                            <g data-flowchart-links>
                                {orderedRoutes.map(r => {
                                    const l = linksByKey.get(r.key)!;
                                    const isSel = r.key === selectedLink;
                                    const op = linkOpacity(r.key);
                                    return (
                                        <g key={r.key} style={{ opacity: op, transition: fade(dim.active) }}>
                                            {isSel && (
                                                <path d={r.d} fill="none" stroke={BRAND} strokeWidth={9} opacity={0.16} strokeLinecap="round" />
                                            )}
                                            <path
                                                d={r.d}
                                                fill="none"
                                                stroke={isSel ? BRAND_D : CLASS_STROKE[l.cls]}
                                                strokeWidth={isSel ? 3 : l.weight}
                                                strokeDasharray={CLASS_DASH[l.cls]}
                                                markerEnd={`url(#fc-mk-${isSel ? "brand" : CLASS_MARKER[l.cls]}-${storageKey})`}
                                            />
                                            <path
                                                d={r.d}
                                                data-flowchart-link={r.key}
                                                fill="none"
                                                stroke="transparent"
                                                strokeWidth={12}
                                                style={{ cursor: "pointer" }}
                                                onPointerEnter={() => hoverOn({ kind: "link", key: r.key })}
                                                onPointerLeave={() => setHover(null)}
                                                onClick={e => {
                                                    if (e.altKey && onTracePathFn) {
                                                        dispatchEast("onTracePath", () => onTracePathFn(r.key));
                                                        return;
                                                    }
                                                    select({ kind: "link", key: r.key });
                                                }}
                                            />
                                        </g>
                                    );
                                })}
                            </g>

                            {/* decision diamonds at longest-run midpoints */}
                            {orderedRoutes.map(r => {
                                const l = linksByKey.get(r.key)!;
                                const trigger = l.trigger !== undefined ? model.triggers.get(l.trigger) : undefined;
                                if (trigger === undefined) return null;
                                return (
                                    <g key={`dia-${r.key}`} style={{ opacity: linkOpacity(r.key), transition: fade(dim.active) }}>
                                        <g
                                            data-flowchart-trigger={trigger.key}
                                            data-drop-target={dropMark?.kind === "decision" && keyEqual(dropMark.key, trigger.key) ? "" : undefined}
                                            data-selected={selection?.kind === "trigger" && keyEqual(selection.key, trigger.key) ? "" : undefined}
                                            transform={`translate(${r.mid.x},${r.mid.y}) rotate(45)`}
                                            style={{ cursor: "pointer" }}
                                            onPointerEnter={() => hoverOn({ kind: "trigger", key: trigger.key })}
                                            onPointerLeave={() => setHover(null)}
                                            onClick={() => select({ kind: "trigger", key: trigger.key })}
                                        >
                                            <rect x={-8} y={-8} width={16} height={16} rx={3} fill={PAPER} stroke={BRAND_D} strokeWidth={1.4} />
                                            <text transform="rotate(-45)" y={3.5} textAnchor="middle"
                                                style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, fill: BRAND_D }}>
                                                {trigger.letter}
                                            </text>
                                        </g>
                                    </g>
                                );
                            })}

                            {/* evidence badges — collision-resolved in layout; chrome
                                inherits the link class; numerals mono tabular ink */}
                            {orderedRoutes.map(r => {
                                const l = linksByKey.get(r.key)!;
                                if (l.badgeText === undefined || r.badge === undefined) return null;
                                const w = l.badgeText.length * 5.8 + 14;
                                const bs = badgeStyle(l.cls, r.key === selectedLink);
                                return (
                                    // Ornament, not a control — pointer-transparent so the
                                    // link's hit path beneath stays hoverable.
                                    <g key={`bdg-${r.key}`}
                                        style={{ opacity: linkOpacity(r.key), transition: fade(dim.active), pointerEvents: "none" }}
                                        transform={`translate(${r.badge.x},${r.badge.y})`}>
                                        <rect x={-w / 2} y={-BADGE_H / 2} width={w} height={BADGE_H} rx={4}
                                            fill={PAPER} stroke={bs.stroke} strokeWidth={1} strokeDasharray={bs.dash} />
                                        <text y={3.5} textAnchor="middle"
                                            style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, fill: bs.text, fontVariantNumeric: "tabular-nums" }}>
                                            {l.badgeText}
                                        </text>
                                    </g>
                                );
                            })}

                        </svg>

                        {/* the lane a dropped state lands in, or whose header a card
                            sets (#1249): its wash, under the states, the recipe's */}
                        {(dropMark?.kind === "lane" || dropMark?.kind === "header") && (() => {
                            const band = layout.lanes.find((l) => keyEqual(l.key, dropMark.lane));
                            return band === undefined ? null : (
                                <Box css={styles.dropLane} data-flowchart-droplane={band.key}
                                    style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />
                            );
                        })()}

                        {/* the selected lane (#1250): its band ringed, under the states, the recipe's */}
                        {selection?.kind === "lane" && (() => {
                            const band = layout.lanes.find((l) => keyEqual(l.key, selection.key));
                            return band === undefined ? null : (
                                <Box css={styles.laneSelected} data-flowchart-lane-selected={band.key}
                                    style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />
                            );
                        })()}

                        {/* node cards — HTML above the SVG */}
                        {[...layout.nodes.values()].map(rect => {
                            const nm = model.nodesByKey.get(rect.key);
                            if (!nm) return null;
                            const isSel = pickedStates.some((key) => keyEqual(key, rect.key));
                            return (
                                <Box
                                    key={rect.key}
                                    data-flowchart-node={rect.key}
                                    css={nm.ghost ? styles.ghostNode : styles.node}
                                    data-selected={isSel || undefined}
                                    data-drop-target={dropMark?.kind === "state" && keyEqual(dropMark.key, rect.key) ? "" : undefined}
                                    style={{
                                        left: rect.x, top: rect.y, width: rect.w, height: rect.h,
                                        opacity: moveDrag?.key === rect.key ? 0.3 : nodeOpacity(rect.key),
                                        transition: fade(dim.active),
                                    }}
                                    onPointerEnter={() => hoverOn({ kind: "state", key: rect.key })}
                                    onPointerLeave={() => setHover(null)}
                                    onPointerDown={edit !== undefined ? (e) => beginMove(rect.key, e) : undefined}
                                    onClick={(e) => {
                                        if (movedRef.current) { movedRef.current = false; return; }
                                        // Shift, ⌘ or Ctrl: into a selection of several, or out of it (#1250).
                                        if (e.shiftKey || e.metaKey || e.ctrlKey) select(toggleState(selectionRef.current, rect.key));
                                        else select({ kind: "state", key: rect.key });
                                    }}
                                    onDoubleClick={edit !== undefined && !nm.ghost ? () => {
                                        setStateEditor({ mode: "edit", key: rect.key, code: rect.key, label: nm.label ?? "" });
                                    } : undefined}
                                >
                                    <Box css={styles.nodeCode}>
                                        {rect.key}
                                        {nm.members !== undefined && <Box as="span" css={styles.nodeBadge}>×{words.number(nm.members)}</Box>}
                                        {nm.inPlaceKeys.length > 0 && (() => {
                                            // Folded self-loops have no route to click — the ↻
                                            // badge is their selection surface. Click selects
                                            // (cycling when several fold here) so Del deletes
                                            // it as it deletes any transition, and the
                                            // inspector shows its Details.
                                            const selIdx = selection?.kind === "link" ? nm.inPlaceKeys.findIndex((k) => keyEqual(k, selection.key)) : -1;
                                            return (
                                                <Box as="span" css={styles.nodeBadge}
                                                    data-flowchart-inplace={rect.key}
                                                    data-selected={selIdx >= 0 || undefined}
                                                    onPointerDown={e => e.stopPropagation()}
                                                    onDoubleClick={e => e.stopPropagation()}
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        select({ kind: "link", key: nm.inPlaceKeys[(selIdx + 1) % nm.inPlaceKeys.length]! });
                                                    }}
                                                >
                                                    <FontAwesomeIcon icon={faRotateRight} style={{ fontSize: "8px" }} /> {nm.inPlaceKeys.length}
                                                </Box>
                                            );
                                        })()}
                                    </Box>
                                    {nm.label !== undefined && <Box css={styles.nodeLabel}>{nm.label}</Box>}
                                </Box>
                            );
                        })}

                        {/* connector overlay — ABOVE the node borders per the spec's
                            z-order; rings on occupied handles, all four revealed on
                            hover/selection, 16×16 hit targets on the out-handles when
                            authoring is enabled */}
                        <svg
                            width={layout.width}
                            height={layout.height}
                            viewBox={`0 0 ${layout.width} ${layout.height}`}
                            style={{ position: "absolute", inset: 0, display: "block", pointerEvents: "none" }}
                        >
                            {[...layout.nodes.values()].map(rect => {
                                const nodeActive = (hover?.kind === "state" && hover.key === rect.key)
                                    || pickedStates.some((key) => keyEqual(key, rect.key))
                                    || draft !== null;
                                const occupied = layout.handles.get(rect.key) ?? [];
                                const occupiedSides = new Set(occupied.map(h => h.side));
                                // Unoccupied handles are the EDIT affordance — they only
                                // reveal on hover/selection where the flowchart edits;
                                // occupied rings are anatomy and always render.
                                const authoring = edit !== undefined;
                                const extra = nodeActive && authoring
                                    ? (["left", "right", "top", "bottom"] as const).filter(s => !occupiedSides.has(s))
                                    : [];

                                return (
                                    <g key={`ports-${rect.key}`} data-flowchart-ports={rect.key} style={{ opacity: nodeOpacity(rect.key), transition: fade(dim.active) }}>
                                        {/* invisible 16×16 hit targets — ANY handle is the
                                            drag-to-connect affordance */}
                                        {authoring && (["left", "right", "top", "bottom"] as const).map(side => (
                                            <circle
                                                key={`hit-${side}`}
                                                data-flowchart-handle={side}
                                                cx={rect[side].x} cy={rect[side].y} r={8}
                                                fill="transparent"
                                                style={{ pointerEvents: "all", cursor: "crosshair" }}
                                                onPointerEnter={() => hoverOn({ kind: "state", key: rect.key })}
                                                onPointerDown={(e) => beginDraft(rect.key, side, e)}
                                            />
                                        ))}
                                        {occupied.map(h => {
                                            const attached = h.links.map(k => linksByKey.get(k)).filter((x): x is ModelLink => x !== undefined);
                                            const r = nodeActive ? 4.5 : RING_R;
                                            return (
                                                <circle
                                                    key={h.side}
                                                    cx={h.pt.x} cy={h.pt.y} r={r}
                                                    fill={PAPER}
                                                    stroke={portColor(attached, selectedLink)}
                                                    strokeWidth={1.4}
                                                />
                                            );
                                        })}
                                        {extra.map(side => (
                                            <circle
                                                key={side}
                                                cx={rect[side].x} cy={rect[side].y} r={4.5}
                                                fill={PAPER}
                                                stroke={INK}
                                                strokeWidth={1.4}
                                            />
                                        ))}
                                    </g>
                                );
                            })}

                            {/* connect draft */}
                            {draft !== null && (() => {
                                const from = layout.nodes.get(draft.from);
                                if (!from) return null;
                                const target = draft.over !== null ? layout.nodes.get(draft.over) : undefined;
                                const landable = draft.allowed || draft.dup !== undefined;
                                const selfDrop = draft.over === draft.from && landable;
                                // Spec-compliant preview: the exact H/V route (r 8
                                // corners, ring-trimmed) the link would take when a
                                // target is snapped; an orthogonal run to the cursor
                                // otherwise. A self-drop previews as the ↻ cue.
                                const d = selfDrop
                                    ? undefined
                                    : target !== undefined && landable
                                        ? previewLinkPath(from, target)
                                        : previewCursorPath(from, draft.side, { x: draft.x, y: draft.y });
                                return (
                                    <g>
                                        {d !== undefined && (
                                            <path
                                                d={d}
                                                fill="none"
                                                stroke={draft.over !== null && !landable ? NEG : BRAND_D}
                                                strokeWidth={1.6}
                                                strokeDasharray="5 4"
                                            />
                                        )}
                                    </g>
                                );
                            })()}

                            {/* one-shot connection pulse — the existing link on a
                                duplicate drop, or the new link once its row arrives;
                                SMIL restarts per seq via the element key */}
                            {pulse !== null && orderedRoutes.map(r => {
                                const l = linksByKey.get(r.key);
                                if (!l || l.from !== pulse.from || l.to !== pulse.to) return null;
                                return (
                                    // CSS keyframe (not SMIL — whose begin is relative to
                                    // the SVG document timeline, so late-inserted animates
                                    // never play): starts on mount, restarts per seq key.
                                    <path
                                        key={`pulse-${pulse.seq}-${r.key}`}
                                        d={r.d}
                                        fill="none"
                                        stroke={BRAND}
                                        strokeWidth={11}
                                        strokeLinecap="round"
                                        opacity={0}
                                        style={{ pointerEvents: "none", animation: "fc-connect-pulse 0.9s ease-out forwards" }}
                                    />
                                );
                            })}
                        </svg>

                        {/* the landing line where a dropped state lands (#1249, FB31): across
                            the node's footprint, between the state above it and the one it
                            lands before — its thickness the recipe's */}
                        {dropMark?.kind === "lane" && (() => {
                            const band = layout.lanes.find((l) => keyEqual(l.key, dropMark.lane));
                            if (band === undefined) return null;
                            const seam = landingSeam(layout, band, dropMark.row);
                            const td = layout.orientation === "TD";
                            return (
                                <Box css={styles.dropSeam} data-flowchart-landing={dropMark.row} data-orientation={layout.orientation}
                                    style={td ? { left: seam.x, top: seam.y, height: seam.h } : { left: seam.x, top: seam.y, width: seam.w }} />
                            );
                        })()}

                        {/* each lane's × — Font Awesome's xmark beside its header; off
                            while the lane holds states, its tooltip saying why (FB19) */}
                        {laneGestures !== undefined && layout.lanes.map(lane => {
                            const head = laneHead(layout, lane);
                            const holds = model.laneStates.get(lane.key) ?? 0;
                            const name = words.m.deleteLane({ label: lane.label });
                            return (
                                <Tooltip.Root key={`lanedelete-${lane.key}`} openDelay={250} positioning={{ placement: "bottom" }}>
                                    <Tooltip.Trigger asChild>
                                        <chakra.button
                                            type="button"
                                            css={styles.laneDelete}
                                            data-flowchart-lane-delete={lane.key}
                                            data-disabled={holds > 0 ? "" : undefined}
                                            aria-disabled={holds > 0 ? true : undefined}
                                            aria-label={name}
                                            style={{ left: head.close - CLOSE_BOX / 2, top: head.y - HEAD_MIDDLE - CLOSE_BOX / 2 }}
                                            onClick={holds > 0 ? undefined : () => laneGestures.deleteLane(lane.key)}
                                        >
                                            <FontAwesomeIcon icon={faXmark} />
                                        </chakra.button>
                                    </Tooltip.Trigger>
                                    <Portal>
                                        <Tooltip.Positioner>
                                            <Tooltip.Content>{holds > 0 ? words.m.laneHoldsStates({ n: holds, count: words.number(holds) }) : name}</Tooltip.Content>
                                        </Tooltip.Positioner>
                                    </Portal>
                                </Tooltip.Root>
                            );
                        })}

                        {/* "+ LANE" — the band row's tail, full lane height: Font
                            Awesome's plus over the word, a lane added on a click */}
                        {edit !== undefined && (
                            <chakra.button
                                type="button"
                                css={styles.addLane}
                                data-flowchart-addlane=""
                                data-orientation={layout.orientation}
                                aria-label={words.m.addLane()}
                                style={{ left: layout.laneTail.x, top: layout.laneTail.y, width: layout.laneTail.w, height: layout.laneTail.h }}
                                onClick={() => edit.addLane()}
                            >
                                <FontAwesomeIcon icon={faPlus} />
                                <span>{words.m.laneWord()}</span>
                            </chakra.button>
                        )}

                        {/* "+ STATE" ghost — dashed, exact node footprint, one per
                            hovered lane, Font Awesome's plus beside its word; click
                            turns it into the inline editor */}
                        {laneGestures !== undefined && stateEditor === null && laneHover !== null && moveDrag === null && !dragging && (() => {
                            const cell = layout.laneGhosts.get(laneHover);
                            if (!cell) return null;
                            return (
                                <Box
                                    data-flowchart-ghoststate={laneHover}
                                    css={styles.stateGhost}
                                    style={{ left: cell.x, top: cell.y, width: cell.w, height: cell.h }}
                                    onPointerEnter={() => setLaneHover(laneHover)}
                                    onClick={() => setStateEditor({ mode: "add", lane: laneHover, code: "", label: "" })}
                                >
                                    <FontAwesomeIcon icon={faPlus} />
                                    <span>{words.m.stateWord()}</span>
                                </Box>
                            );
                        })()}

                        {/* inline node editor — the ghost's commit surface AND the
                            double-click edit surface (code auto-focused, label below;
                            ⏎ commits, esc / blur-empty dismisses) */}
                        {stateEditor !== null && (() => {
                            const cell = stateEditor.mode === "add"
                                ? layout.laneGhosts.get(stateEditor.lane)
                                : layout.nodes.get(stateEditor.key);
                            if (!cell) return null;
                            const commit = (): void => {
                                const ed = stateEditor;
                                setStateEditor(null);
                                if (ed === null || ed.code.trim() === "" || edit === undefined) return;
                                if (ed.mode === "add") edit.addState(ed.lane, ed.code.trim(), ed.label.trim());
                                else edit.editState(ed.key, ed.code.trim(), ed.label.trim());
                            };
                            const keys = (e: React.KeyboardEvent): void => {
                                if (e.key === "Enter") commit();
                                else if (e.key === "Escape") { e.stopPropagation(); setStateEditor(null); }
                            };
                            return (
                                <Box
                                    data-flowchart-stateeditor
                                    css={styles.stateEditor}
                                    style={{ left: cell.x, top: cell.y, width: cell.w, minHeight: cell.h }}
                                    onBlur={e => {
                                        // blur-empty dismisses; blur with content commits
                                        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                                        commit();
                                    }}
                                >
                                    <input
                                        autoFocus
                                        placeholder="CODE"
                                        value={stateEditor.code}
                                        onChange={e => setStateEditor(ed => (ed === null ? ed : { ...ed, code: e.target.value }))}
                                        onKeyDown={keys}
                                    />
                                    <input
                                        placeholder="Name state…"
                                        value={stateEditor.label}
                                        onChange={e => setStateEditor(ed => (ed === null ? ed : { ...ed, label: e.target.value }))}
                                        onKeyDown={keys}
                                    />
                                </Box>
                            );
                        })()}

                        {/* floating clone while a node drags across lanes */}
                        {moveDrag !== null && (() => {
                            const nm = model.nodesByKey.get(moveDrag.key);
                            if (!nm) return null;
                            return (
                                <Box css={styles.moveClone} style={{ left: moveDrag.x + 10, top: moveDrag.y + 10 }}>
                                    <Box css={styles.nodeCode}>{moveDrag.key}</Box>
                                    {nm.label !== undefined && <Box css={styles.nodeLabel}>{nm.label}</Box>}
                                </Box>
                            );
                        })()}

                        {/* drag cursor cues — FA icons in the HTML layer (↻ = self-drop
                            lands an in-place transition; ⊘ = vetoed target) */}
                        {draft !== null && draft.over !== null && (() => {
                            const landable = draft.allowed || draft.dup !== undefined;
                            const selfDrop = draft.over === draft.from && landable;
                            if (!selfDrop && landable) return null;
                            return (
                                <Box
                                    style={{
                                        position: "absolute", left: draft.x + 12, top: draft.y - 18,
                                        pointerEvents: "none", fontSize: 13,
                                        color: selfDrop ? "var(--fc-brand-d)" : "var(--fc-neg)",
                                    }}
                                >
                                    <FontAwesomeIcon icon={selfDrop ? faRotateRight : faBan} />
                                </Box>
                            );
                        })()}

                        {/* one-shot node pulse — an in-place (self-loop) create or
                            duplicate has no route to pulse, so the node card glows */}
                        {pulse !== null && pulse.from === pulse.to && (() => {
                            const rect = layout.nodes.get(pulse.from);
                            if (!rect) return null;
                            return (
                                <Box
                                    key={`nodepulse-${pulse.seq}`}
                                    style={{
                                        position: "absolute",
                                        left: rect.x, top: rect.y, width: rect.w, height: rect.h,
                                        borderRadius: 6,
                                        pointerEvents: "none",
                                        animation: "fc-node-pulse 0.9s ease-out forwards",
                                    }}
                                />
                            );
                        })()}

                        {/* inline lane-rename editor */}
                        {laneEdit !== null && (() => {
                            const lane = layout.lanes.find(l => l.key === laneEdit.key);
                            if (!lane) return null;
                            const td = layout.orientation === "TD";
                            const style: React.CSSProperties = td
                                ? { left: 8, top: lane.y + 8, width: 148 }
                                : { left: lane.cx - 74, top: 8, width: 148 };
                            const commit = (): void => {
                                const next = laneEdit;
                                setLaneEdit(null);
                                if (next !== null && next.label.trim() !== "" && edit !== undefined) edit.renameLane(next.key, next.label.trim());
                            };
                            return (
                                <input
                                    data-flowchart-lane-edit
                                    autoFocus
                                    value={laneEdit.label}
                                    onChange={e => setLaneEdit(le => (le === null ? le : { ...le, label: e.target.value }))}
                                    onBlur={commit}
                                    onKeyDown={e => {
                                        if (e.key === "Enter") commit();
                                        else if (e.key === "Escape") { e.stopPropagation(); setLaneEdit(null); }
                                    }}
                                    style={{
                                        position: "absolute", ...style, zIndex: 11,
                                        fontFamily: "var(--chakra-fonts-mono)", fontSize: 11, fontWeight: 600,
                                        padding: "3px 8px", borderRadius: 4,
                                        border: "1px solid var(--fc-brand-d)",
                                        background: "var(--fc-paper)", color: "inherit", outline: "none",
                                    }}
                                />
                            );
                        })()}

                        {/* legend — planned / observed / trigger / in-place */}
                        {legendOn && (
                            <Box css={styles.legend} data-flowchart-legend>
                                <Box css={styles.legendTitle}>Legend</Box>
                                <Box css={styles.legendRow}>
                                    <svg width={28} height={8}><line x1={1} y1={4} x2={27} y2={4} stroke={INK} strokeWidth={2} /></svg>
                                    <span>Planned</span>
                                </Box>
                                <Box css={styles.legendRow}>
                                    <svg width={28} height={8}><line x1={1} y1={4} x2={27} y2={4} stroke={INFO} strokeWidth={1.6} strokeDasharray="5 4" /></svg>
                                    <span>Observed</span>
                                </Box>
                                <Box css={styles.legendRow}>
                                    <svg width={28} height={16}>
                                        <rect x={9} y={3} width={10} height={10} rx={2} transform="rotate(45 14 8)" fill={PAPER} stroke={BRAND_D} strokeWidth={1.2} />
                                    </svg>
                                    <span>Decision trigger</span>
                                </Box>
                                <Box css={styles.legendRow}>
                                    <Box as="span" css={styles.nodeBadge}><FontAwesomeIcon icon={faRotateRight} style={{ fontSize: "8px" }} /> n</Box>
                                    <span>In-place transition</span>
                                </Box>
                            </Box>
                        )}
                    </Box>
                </Box>
            )}
            {/* The minimap (#1251): over the canvas in main's corner, where it
                stays while the canvas scrolls under it — never in the drawing,
                whose far corner a wide or a tall flow scrolls out of view. */}
            {layout !== null && !empty && showMinimap && (
                <Box css={styles.minimap} data-flowchart-minimap>
                    <svg width={96} height={64} viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet">
                        {[...layout.nodes.values()].map(r => (
                            <rect key={r.key} x={r.x} y={r.y} width={r.w} height={r.h} rx={8}
                                fill="none" stroke={INK_3} strokeWidth={6} />
                        ))}
                    </svg>
                </Box>
            )}
        </Box>
    );

    return body;
}

