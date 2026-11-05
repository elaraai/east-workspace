/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's canvas (#1502, #1503, `Flowchart Records Spec.md` R6–R10,
 * R13, D4, D12) — the records drawn, with the canvas's options, in its frame's
 * main: lane bands, state cards, H/V-routed transitions, decision diamonds,
 * evidence badges, the legend and the minimap, with the dim ladder, the
 * selection, ⌥-click tracing and, where a kind edits, its gestures. The
 * dimensional contract (node 116×40 r6, 7px handle rings, fixed 6.5px
 * arrowheads butting the rings, dim ladder 1.0 / 0.45 / 0.15) lives in
 * `layout.ts` and the `flowchart` slot recipe, which stays in
 * east-ui-components' theme. Colours resolve through the recipe's `--fc-*`
 * variables (theme-aware, dark-mode overrides), which the Flowchart's root
 * sets. It draws no hover card: the inspector shows what is selected.
 *
 * - **The bands** are the model's: each lane of the app's, in its order; *No
 *   lane*, last, holding the states naming no lane the Flowchart holds (D12);
 *   or, given no lanes, one band holding every state. Only a lane of the
 *   app's takes a gesture of its own — a click on its header selects it, a
 *   double-click renames it, its × deletes it, its "+ STATE" adds a state to
 *   it — and the one band of a Flowchart given no lanes takes "+ STATE". *No
 *   lane* takes none: a state there is moved out of it.
 * - **A row the narrowing leaves out**, under `"dim"`, draws faded at the dim
 *   ladder's last step, marked `data-context`: no click, hover, drag or key
 *   reaches it, and no card lands on it (R6).
 * - **The selection** is the frame's (`selection.ts`): the canvas marks it and
 *   tells the frame each click — a state's card, a transition, a decision's
 *   diamond, or a lane's header; a shift-, ⌘- or Ctrl-click on a state puts it
 *   into a selection of several, or takes it out; a click on the canvas where
 *   nothing is, and Esc, select nothing. Esc is the canvas's from inside its
 *   frame — heard as it leaves the frame (the handle's `key`), never in a
 *   field being typed into nor from a layer portaled out of the frame — and
 *   from the page itself, nothing focused, while the pointer is over the
 *   canvas, at the window (`../shared/frame-keys.ts`). Every key the canvas
 *   acts on goes no further than the Flowchart (`takeKey`, #1398).
 * - **The gestures** are the frame's `edit`, one member per gesture, each
 *   there while its kind edits (R13); each is one step of the history: "+
 *   LANE" at the band row's tail; a lane's header double-clicked into its
 *   rename in place, and its × — off while the lane holds states, its tooltip
 *   saying why; the "+ STATE" ghost a hovered band parks under its last state,
 *   which opens the inline editor — its key and its label, a key the Flowchart
 *   holds already refused as it is typed; a state double-clicked into its
 *   rename, its key shown fixed (R9); a state dragged to another lane, or —
 *   where the states carry an `order` — between two cards, a line marking
 *   where it lands (D4); a handle dragged to a state, which `canConnect` may
 *   veto, a drop on the source its in-place transition, a drop that would
 *   repeat a transition pulsing it instead; and Del — in the canvas, never in
 *   a field being typed into — deleting the selected state or states with
 *   their transitions, the transition, the decision, or the lane while it
 *   holds no state.
 * - **Drops**: where a tab of the library drops, the canvas is one drop cell
 *   of the shared drag layer, on the frame's drop target (`use-drop.ts`): it
 *   works out where a drag rests from its own drawing (`drop.ts`'
 *   `dropAtPoint`) — a band and the row a state takes there, a state, a
 *   transition, a lane's header, the gap a lane lands in, a decision's diamond
 *   — and, while the drop there lands, marks it: the band takes a wash and a
 *   line marks where the state lands; a line marks the gap a lane lands in;
 *   the state, the transition — the brand wash — or the diamond takes the
 *   brand. The marks show only while the drag rests over the canvas and the
 *   drop lands (the recipe's); a drag over the canvas raises no dimming and no
 *   "+ STATE" ghost.
 * - **The details** (#1510, R22–R34, R39): where the app puts a state's reads
 *   on the canvas, its card is 272 wide — its head, a rule, then the reads in
 *   their order (`details-card.tsx`), its tag lists' words measured out of
 *   sight as a card draws them, before the layout places it; a transition's
 *   label draws its lines under its evidence, a placeholder bar each while its
 *   row lands; and the legend adds a row for each figure, histogram and list
 *   the cards and labels draw, and beside them, one over another, a group for
 *   each tag list it lists (`details-draw.ts`), the layout keeping its height
 *   under the drawing.
 *
 * A read that failed is said once on the canvas (R5): the shared failure box
 * (`LoadingFailedBox`) at its box's top-left, in view however the drawing
 * scrolls — its words and its Retry the footer's loading line's — over what the
 * canvas drew, which stays as it was read; and over nothing, where nothing was.
 *
 * The canvas fills main and scrolls both ways inside it: its lanes run the
 * whole of main's height, and a Flowchart larger than main scrolls in its own
 * box, the frame's toolbar and footer staying put — and the minimap with
 * them, in main's corner over the canvas. Its toolbar's items and its footer
 * are the frame's (`toolbar.tsx`, `footer.tsx`): the model and the
 * orientation come from the frame, and what the frame selects — Find's pick, a
 * drop, an issue's row — comes as a `reveal`, which selects it and scrolls it
 * into view.
 *
 * **The zoom** (#1519, R42): the canvas opens at the cards' own size, and the
 * frame zooms it through its handle (`zoomBy`, `fit`) — about the view's
 * middle, held as a share of the drawing's width and height — between Fit and
 * that size, hearing where it stands (`onZoomRange`). Fit is the whole
 * flowchart in view, taken from the layout's own size (`layoutExtent`), the
 * size it draws at with no room to fill; a zoom Fit or Zoom out puts there
 * follows Fit as the flowchart and main change, and a zoom below a new Fit
 * comes up to it. The layout is computed for main's size over the zoom, so the
 * lanes fill main at any zoom, and the drawing is scaled from its corner
 * inside a box of the size it is drawn at, which main scrolls. The pointer,
 * the drops and a reveal's scroll read the canvas through the zoom; the
 * minimap, the lane pager and a failed read's box keep their size. A phone's
 * window holds as many whole lanes as the zoom fits, each lane keeping its
 * width. The zoom is the viewer's while the canvas is drawn, never
 * remembered, as its scroll is not.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Box, Portal, Tooltip, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBan, faPlus, faRotateRight, faXmark } from "@fortawesome/free-solid-svg-icons";
import { StringType, equalFor } from "@elaraai/east";
import {
    getSomeorUndefined, takeKey, typedInto, useDragLayerOptional, useDropCell, type CellCoord, type DragPayload,
} from "@elaraai/east-ui-components";
import { LoadingFailedBox } from "@elaraai/east-ui-components/internal";
import { keyFromPage, keyInFrame } from "../shared/frame-keys.js";
import type { FlowchartWords } from "./messages.js";
import type { FlowchartCanvasValue, FlowchartModel, ModelBand, ModelLink, ModelNode } from "./model.js";
import {
    DETAILS_CARD_W, DETAILS_HEAD_H, detailsCardOf, detailsLabelOf, type FlowchartCard, type FlowchartDetailsModel, type FlowchartLabelLine,
} from "./details.js";
import { FlowchartCardContent, FlowchartLegendMarkView, FlowchartTag, useFlowchartTextMeasure } from "./details-card.js";
import { legendHeight, legendOf, probeTextsOf } from "./details-draw.js";
import { shareText } from "./details-words.js";
import {
    computeLayout, labelBox, landingSeam, layoutExtent, previewCursorPath, previewLinkPath,
    type FlowchartLayout, type LabelBox, type LinkRoute, type Pt,
    BADGE_H, LABEL_LINE_H, LANE_HEADER_H, NODE_W, RING_R,
} from "./layout.js";
import { FlowchartLanePager } from "./lane-pager.js";
import { dropTargetAt, existingLink, laneAt } from "./connect.js";
import {
    ON_CANVAS, dropAtPoint, gapLine, landsOf, markEqual, markOf, printDropAt, readDropAt, rowAt,
    type FlowchartCanvasDrop, type FlowchartDropMark,
} from "./drop.js";
import { selectedStates, toggleState, type FlowchartSelection } from "./selection.js";
import type { FlowchartOrientation } from "./toolbar.js";
import type { ZoomRange } from "../shared/schedule/zoom.js";

type SelectFn = ((key: string) => unknown) | undefined;

/**
 * What the frame asks the canvas to select and bring into view: a state Find
 * picked or a drop added, or what a click in the inspector names — a
 * transition in a state's Details, an issue's row — once per ask.
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

/** How far inside the canvas's box a failed read's box sits, from its top-left (R5), in px: the Schematic's. */
const FAILED_INSET_PX = 16;

/** A read that failed, as the canvas says it (R5): the footer's loading line's words, and its Retry. */
export interface FlowchartCanvasFailure {
    /** Its words: `Couldn't read states`. */
    readonly message: string;
    /** Asks again. */
    readonly retry: () => void;
}

const keyEqual = equalFor(StringType);

/**
 * The canvas's gestures, each one step of the history, made by the frame —
 * each there while the kind it writes edits (R13), and left out otherwise. The
 * canvas hands each what it gathered — keys, labels, bands — and the frame
 * records what it changes.
 */
export interface FlowchartCanvasEdit {
    /** "+ LANE": a lane at the band row's tail. */
    readonly addLane?: (() => void) | undefined;
    /** A lane's header renamed. */
    readonly renameLane?: ((key: string, label: string) => void) | undefined;
    /** A lane's ×: deleted, while it holds no state. */
    readonly deleteLane?: ((key: string) => void) | undefined;
    /** The "+ STATE" ghost's editor committed: a state at the end of its band, its key and its label as typed; whether it was recorded. */
    readonly addState?: ((band: string, key: string, label: string) => boolean) | undefined;
    /** Whether the Flowchart holds a state of a key already: the "+ STATE" editor refuses it as it is typed. */
    readonly stateKeyTaken?: ((key: string) => boolean) | undefined;
    /** A state's editor committed: its label. */
    readonly renameState?: ((key: string, label: string) => void) | undefined;
    /** States dragged to a band — and, where the states carry an `order`, to a place among its other states. */
    readonly moveStates?: ((keys: readonly string[], band: string, at?: number) => void) | undefined;
    /** Del on the selected state or states: each deleted with its transitions. */
    readonly deleteStates?: ((keys: readonly string[]) => void) | undefined;
    /** A handle dragged to a state; the state itself for an in-place transition. */
    readonly connect?: ((from: string, to: string) => void) | undefined;
    /** Del on a selected transition. */
    readonly deleteLink?: ((key: string) => void) | undefined;
    /** Del on a selected decision: cleared from the transitions it governs. */
    readonly deleteDecision?: ((key: string) => void) | undefined;
}

/** What the frame hears the canvas's keys through (#1398), and zooms it through (R42). */
export interface FlowchartCanvasHandle {
    /**
     * Hears a key from inside the frame as it leaves it — after every part of it that takes keys of its own: Esc, the
     * canvas's, taken there where it acts, going no further.
     */
    key(event: React.KeyboardEvent<HTMLElement>): void;
    /**
     * Zooms by a factor, never past Fit nor the cards' own size, bringing what is selected to the view's middle, and
     * about the view's middle when nothing is: Zoom out and Zoom in (R42).
     */
    zoomBy(factor: number): void;
    /** Puts the whole flowchart in view, and keeps it there as the flowchart and main change: Fit (R42). */
    fit(): void;
}

/** Props of {@link FlowchartCanvasView}. */
export interface FlowchartCanvasViewProps {
    /** What the canvas draws the records with. */
    readonly canvas: FlowchartCanvasValue;
    /** The keys of the states holding a conflict not yet chosen: their nodes wear the warn ring. None by default. */
    readonly conflicted?: ReadonlySet<string> | undefined;
    /** The view model: the records, the drafts in place. */
    readonly model: FlowchartModel;
    /** The details model: each card's size where the details draw on the cards, and each label's lines (R22, R32). */
    readonly details: FlowchartDetailsModel;
    /** Left to right, or top down. */
    readonly orientation: FlowchartOrientation;
    /** What the frame asked the canvas to select and bring into view last, or `null`. */
    readonly reveal: FlowchartReveal | null;
    /** The gestures, where a kind edits; `undefined`, no kind edits, and the selection and the dim ladder stay. */
    readonly edit: FlowchartCanvasEdit | undefined;
    /** The canvas's drop cell, where a tab of the library drops; `undefined`, it takes no drop. */
    readonly drop?: FlowchartCanvasDrop | undefined;
    /** What is selected: the frame's, as the canvas draws the records. */
    readonly selection: FlowchartSelection | null;
    /** Selects something, or nothing — a click, a shift-click, Esc, a click where nothing is: the frame's selection moves. */
    readonly onSelect: (selection: FlowchartSelection | null) => void;
    /** The Flowchart's words: the gestures' names, and its counts in the app's locale. */
    readonly words: FlowchartWords;
    /** The structural storage key. */
    readonly storageKey: string;
    /** Hands the frame the canvas's element, which fills main: what the frame measures main's width by. */
    readonly onElement?: ((element: HTMLDivElement | null) => void) | undefined;
    /** A read that failed, said once at the canvas's top-left with Retry; `undefined` while none has. */
    readonly failure?: FlowchartCanvasFailure | undefined;
    /** The canvas's handle, the frame's: what a key from inside the frame reaches the canvas through, and what zooms it. */
    readonly ref?: Ref<FlowchartCanvasHandle> | undefined;
    /** Told whether the zoom stands at Fit and at the cards' own size, as either changes (R42): the toolbar's Zoom out and Zoom in are off there. */
    readonly onZoomRange?: ((range: ZoomRange) => void) | undefined;
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

/** Dim ladder per the spec — three steps only, opacity only. A row the narrowing leaves out stands at its last. */
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
            if (keyEqual(l.from, hover.key) || keyEqual(l.to, hover.key)) {
                links.add(l.key);
                nodes.add(l.from);
                nodes.add(l.to);
            }
        }
        return { active: true, restLevel: CONTEXT, nodes, links };
    }
    if (hover.kind === "link") {
        const l = model.links.find(x => keyEqual(x.key, hover.key));
        if (l) { links.add(l.key); nodes.add(l.from); nodes.add(l.to); }
        return { active: true, restLevel: CONTEXT, nodes, links };
    }
    const t = model.triggers.get(hover.key);
    if (t) {
        for (const key of t.governs) {
            links.add(key);
            const l = model.links.find(x => keyEqual(x.key, key));
            if (l) { nodes.add(l.from); nodes.add(l.to); }
        }
        for (const q of t.queue) nodes.add(q);
    }
    return { active: true, restLevel: FADED, nodes, links };
}

/** Ring colour per the spec connector anatomy: brand if any attached link
 * is selected, info if only observed links attach, otherwise ink. */
function portColor(attached: ModelLink[], selectedLink: string | null): string {
    if (attached.some(l => selectedLink !== null && keyEqual(l.key, selectedLink))) return BRAND_D;
    if (attached.length > 0 && attached.every(l => l.cls === "observed")) return INFO;
    if (attached.length > 0 && attached.every(l => l.cls === "unresolved")) return NEG;
    return INK;
}

/** How many lanes a phone's window shows at once, unless the canvas's `narrow.lanes` says. */
const PHONE_LANES = 2;
/** A phone's main: 560 wide or narrower, as the frame's phone is. */
const PHONE_MAIN = 560;
/** Beside a phone's lane's card, however many lanes it is told to show: room for its handles. A lane is counted at its card's width and this (R40). */
const PHONE_LANE_ROOM = 16;

/**
 * A label line's words (R32): a figure's label, its value in the app's locale
 * and its unit — *no data* where the row lacks it (R25); an item's name and
 * its share (R29); *none*; a placeholder's, none.
 *
 * @param line - The line
 * @param words - The flowchart's words
 * @returns Its words
 */
function labelLineText(line: FlowchartLabelLine, words: FlowchartWords): string {
    switch (line.kind) {
        case "placeholder": return "";
        case "figure": return line.value === undefined ? `${line.label} ${words.m.detailsNoData()}` : `${line.label} ${words.number(line.value)}${line.unit === undefined ? "" : ` ${line.unit}`}`;
        case "item": return `${line.name} ${shareText(line.share, words)}`;
        case "none": return words.m.detailsNone();
    }
}

/** What a placeholder line counts as across a label's box, while its row lands (R34): ten characters. */
const PLACEHOLDER_LINE = "0".repeat(10);
/** A placeholder line's bar on a label: 6 high, centred on its line, as wide as its ten characters. */
const PLACEHOLDER_BAR = { w: 58, h: 6, above: 6.5 } as const;
/** A label's first line's baseline under its box's top: the evidence's (BADGE_H / 2 + 3.5, mono 10). */
const LABEL_BASELINE = BADGE_H / 2 + 3.5;

/** A lane's ×: its box's side, centred on its glyph. */
const CLOSE_BOX = 14;
/** A lane header's middle above its baseline: half the height of its caps, mono 12px. */
const HEAD_MIDDLE = 4.5;

/**
 * Where a lane's header stands: its anchor — the band's middle across the top
 * in LR, its start down the side in TD — its baseline, and the middle of its
 * ×, past the label's end (mono 12 / ls 2.6 ⇒ ~9.8px a glyph).
 *
 * @param layout - The laid-out records
 * @param lane - The lane's band
 * @returns The header's anchor and baseline, whether it runs down the side, and its ×'s middle
 */
function laneHead(layout: FlowchartLayout, lane: FlowchartLayout["lanes"][number]): { x: number; y: number; td: boolean; close: number } {
    const td = layout.orientation === "TD";
    const x = td ? 12 : lane.cx;
    const y = td ? lane.y + 24 : 26;
    const labelW = lane.label.length * 9.8;
    return { x, y, td, close: (td ? x + labelW + 12 : x + labelW / 2 + 14) + 3.5 };
}

/**
 * Where a click on a lane's header lands: the band's strip before its first
 * row — across the band's top in LR; in TD, down to the header's × along the
 * band's side — so nobody has to hit the label's letters.
 *
 * @param layout - The laid-out records
 * @param lane - The lane's band
 * @returns The strip, in the canvas's px
 */
function laneHeadBox(layout: FlowchartLayout, lane: FlowchartLayout["lanes"][number]): { x: number; y: number; w: number; h: number } {
    if (layout.orientation !== "TD") return { x: lane.x, y: lane.y, w: lane.w, h: LANE_HEADER_H };
    return { x: lane.x, y: lane.y, w: Math.max(0, laneHead(layout, lane).close - CLOSE_BOX / 2 - lane.x), h: LANE_HEADER_H };
}

/**
 * The point of the canvas a selection is brought to the middle of the view
 * at: a state's card, a transition's longest stretch — an in-place one's state —
 * a decision's first diamond, a lane's header, or several states' first.
 *
 * @param layout - The laid-out records
 * @param model - The view model
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

/**
 * Whether the card a selection is brought to still waits on its details: a
 * state's card — the first of several — drawn with reads whose row no read
 * has brought yet, and no read failed. Until its row lands the card draws a
 * placeholder, and it takes its own height as it lands (R22, R34); a failed
 * read leaves the placeholder standing.
 *
 * @param selection - What is selected
 * @param cards - Each state's card, where the details draw on the cards
 * @param states - The states' details
 * @returns Whether its card is still to land
 */
function awaitsRow(selection: FlowchartSelection, cards: ReadonlyMap<string, FlowchartCard> | undefined, states: FlowchartDetailsModel["states"]): boolean {
    const key = selection.kind === "state" ? selection.key : selection.kind === "states" ? selection.keys[0] : undefined;
    return key !== undefined && states !== undefined && states.error === undefined && cards?.has(key) === true && !states.rows.has(key);
}

/** Badge chrome inherits the link class (spec markup: observed = dashed
 * info; selected = solid brand-d border, brand-dd numerals). */
function badgeStyle(cls: ModelLink["cls"], selected: boolean): { stroke: string; dash: string | undefined; text: string } {
    if (selected) return { stroke: BRAND_D, dash: undefined, text: BRAND_DD };
    if (cls === "observed") return { stroke: INFO, dash: "4 3", text: INFO };
    if (cls === "unresolved") return { stroke: NEG, dash: "4 3", text: NEG };
    return { stroke: RULE_STRONG, dash: undefined, text: INK };
}

/** The states a band draws, in its order — its ghosts left out: the rows a moved or dropped state lands among. */
function bandStates(model: FlowchartModel, band: number): ModelNode[] {
    return model.nodes.filter((node) => node.laneIndex === band && !node.ghost).sort((a, b) => a.laneOrder - b.laneOrder);
}

/** A state moved by its card: where the pointer is, the band under it, and — where the states carry an order — the row of that band it lands at. */
interface MoveDrag {
    readonly key: string;
    readonly x: number;
    readonly y: number;
    /** The band under the pointer, by its key; `null` for none, or one taking no state. */
    readonly overLane: string | null;
    /** The row of that band it lands at, among the band's states as drawn — the line's place; `null` where the band's order is not the states'. */
    readonly row: number | null;
}

/**
 * The canvas: the records, drawn with the canvas's options, filling its
 * frame's main — see the module docs.
 *
 * @param props - The canvas's options, the view model, the orientation, what to reveal, the gestures, the drop cell, the selection and what selects, the words, the storage key, the frame's handle and what hears the zoom
 * @returns The canvas's box, which scrolls the records inside it
 */
export function FlowchartCanvasView({
    canvas, model, details, orientation, reveal, edit, drop, selection, onSelect, words, storageKey, onElement, failure, ref, conflicted, onZoomRange,
}: FlowchartCanvasViewProps) {
    const styles = useSlotRecipe({ key: "flowchart" })();

    // ── decode ────────────────────────────────────────────────────────────
    const legendOn = getSomeorUndefined(canvas.legend) ?? true;
    const minimapOpt = getSomeorUndefined(canvas.minimap);

    const onSelectStateFn = useMemo(() => getSomeorUndefined(canvas.onSelectState) as SelectFn, [canvas.onSelectState]);
    const onSelectLinkFn = useMemo(() => getSomeorUndefined(canvas.onSelectLink) as SelectFn, [canvas.onSelectLink]);
    const onSelectTriggerFn = useMemo(() => getSomeorUndefined(canvas.onSelectTrigger) as SelectFn, [canvas.onSelectTrigger]);
    const onTracePathFn = useMemo(() => getSomeorUndefined(canvas.onTracePath) as SelectFn, [canvas.onTracePath]);
    const canConnectFn = useMemo(
        () => getSomeorUndefined(canvas.canConnect) as ((from: string, to: string) => boolean) | undefined,
        [canvas.canConnect]);

    // What each band is: only a lane of the app's takes a gesture of its own; No lane takes none.
    const bands = useMemo(() => new Map<string, ModelBand>(model.lanes.map((lane) => [lane.key, lane.band])), [model]);
    const isLane = useCallback((key: string) => bands.get(key) === "lane", [bands]);
    /** Whether a band takes a state — "+ STATE", a move, a drop: a lane of the app's, or the one band of a Flowchart given no lanes. */
    const takesStates = useCallback((key: string) => { const band = bands.get(key); return band === "lane" || band === "all"; }, [bands]);

    // ── view state ────────────────────────────────────────────────────────
    // The selection is the frame's: its latest, for the keys, and what moves it.
    const selectionRef = useRef<Selection>(selection);
    selectionRef.current = selection;
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const pickedStates = selectedStates(selection);
    const [hover, setHover] = useState<Hover>(null);
    // The dimming, for Esc: what it puts back.
    const hoverRef = useRef<Hover>(hover);
    hoverRef.current = hover;
    // A drag in flight: it raises no dimming and no "+ STATE" ghost.
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
    // Inline lane-header rename (one object; commit → the rename).
    const [laneEdit, setLaneEdit] = useState<{ key: string; label: string } | null>(null);
    // "+ STATE" ghost reveal (spec Flowchart.Lane): one hovered band at a time.
    const [laneHover, setLaneHover] = useState<string | null>(null);
    // One inline node editor for BOTH the ghost's commit — a new state's key and label — and a double-click's rename.
    const [stateEditor, setStateEditor] = useState<
        | { mode: "add"; lane: string; code: string; label: string }
        | { mode: "edit"; key: string; label: string; was: string }
        | null
    >(null);
    // A state dragged by its card (one object; the candidate band and the line where it lands live).
    const [moveDrag, setMoveDrag] = useState<MoveDrag | null>(null);
    const moveDragRef = useRef<MoveDrag | null>(null);
    moveDragRef.current = moveDrag;
    const movedRef = useRef(false);
    useEffect(() => {
        if (pulse === null) return;
        const t = setTimeout(() => setPulse(null), 1100);
        return () => clearTimeout(t);
    }, [pulse]);
    // A drag picked up: the state or transition the pointer rested on lets go of its dimming.
    useEffect(() => {
        if (!dragging) return;
        setHover(null);
    }, [dragging]);

    // ── measure ───────────────────────────────────────────────────────────
    const bodyRef = useRef<HTMLDivElement | null>(null);
    // The body's element, the frame's too: what it measures main's width by.
    const onBody = useCallback((element: HTMLDivElement | null) => {
        bodyRef.current = element;
        onElement?.(element);
    }, [onElement]);
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

    // ── sizes: each card's where the details draw on the cards, measured as it draws, and each label's (R22, R32) ──
    // The tag lists' words, measured out of sight in the slots a card draws them with, before the layout places it.
    const probeTexts = useMemo(() => probeTextsOf(details.states, words), [details.states, words]);
    const { measure, probe } = useFlowchartTextMeasure(styles, probeTexts);
    const cardsByKey = useMemo(() => {
        const kind = details.states;
        if (kind === undefined || !kind.onCanvas) return undefined;
        // A ghost stands for no row, so it has no reads: the card's width and 40.
        const out = new Map<string, FlowchartCard>();
        for (const node of model.nodes) {
            const card = node.ghost ? undefined : detailsCardOf(kind, node.key, measure);
            if (card !== undefined) out.set(node.key, card);
        }
        return out;
    }, [model, details.states, measure]);
    const cards = useMemo(() => (cardsByKey === undefined ? undefined : {
        width: DETAILS_CARD_W,
        heights: new Map([...cardsByKey].map(([key, card]) => [key, card.height] as const)),
    }), [cardsByKey]);
    const labels = useMemo(() => {
        const kind = details.transitions;
        if (kind === undefined || !kind.onCanvas) return undefined;
        // Its evidence line, then its details' lines: a label with neither draws none.
        const sizes = new Map<string, LabelBox>();
        const lines = new Map<string, readonly FlowchartLabelLine[]>();
        for (const link of model.links) {
            const detail = detailsLabelOf(kind, link.key);
            const texts = [
                ...(link.badgeText === undefined ? [] : [link.badgeText]),
                ...detail.map((line) => (line.kind === "placeholder" ? PLACEHOLDER_LINE : labelLineText(line, words))),
            ];
            if (texts.length === 0) continue;
            sizes.set(link.key, labelBox(texts));
            lines.set(link.key, detail);
        }
        return { sizes, lines };
    }, [model, details.transitions, words]);
    // What the legend adds of the details: its rows and its groups of tags, and the room the layout keeps for it (§4).
    const legend = useMemo(() => legendOf(details, words), [details, words]);
    const legendPad = legendOn ? legendHeight(legend, measure) : 0;

    // A phone's window of lanes, left to right: as many across main's width as the canvas's `narrow.lanes` says, which
    // its pager steps through — as many whole lanes as main holds, each counted at its card's width and 16, so none is
    // cut however many it is told to show, and the readout says what shows. The lanes fill the window; where the
    // details draw on the cards a phone holds one, keeping its width — at least the window's — and each step brings
    // its card to the window's middle (R40, D24). Top down, the lanes stack and the view scrolls down them.
    const narrow = getSomeorUndefined(canvas.narrow);
    const narrowLanes = narrow === undefined ? undefined : getSomeorUndefined(narrow.lanes);
    const lanesAsked = narrowLanes === undefined ? PHONE_LANES : Number(narrowLanes);
    const laneLeast = (cards?.width ?? NODE_W) + PHONE_LANE_ROOM;
    const windowed = size !== null && size.w > 0 && size.w <= PHONE_MAIN && orientation === "LR";
    const lanesInView = windowed ? Math.max(1, Math.min(lanesAsked, Math.floor(size.w / laneLeast))) : lanesAsked;
    const laneWidth = windowed && cards === undefined ? Math.max(laneLeast, Math.floor(size.w / lanesInView)) : undefined;
    // The one lane the window holds where the details draw on the cards: at least the window's width, so no other lane shows beside it.
    const laneWindow = windowed && cards !== undefined ? size.w : undefined;

    // ── zoom (R42) ────────────────────────────────────────────────────────
    // The viewer's zoom: a scale — 1, the cards' own size, where the canvas opens — or Fit, which follows the flowchart's
    // size. Fit is taken from the layout's own size, the size it draws at with no room to fill, so it never waits on the
    // layout it sets.
    const [chosen, setChosen] = useState<number | "fit">(1);
    const fit = useMemo(() => {
        if (size === null || size.w <= 0 || size.h <= 0) return 1;
        const own = layoutExtent(model, { orientation, legendPad, laneWidth, laneWindow, cards, labels: labels?.sizes });
        return Math.min(1, size.w / own.width, size.h / own.height);
    }, [model, size, orientation, legendPad, laneWidth, laneWindow, cards, labels]);
    // Never past either end: a zoom below a new Fit comes up to it.
    const zoom = chosen === "fit" ? fit : Math.min(1, Math.max(fit, chosen));
    const zoomRef = useRef(zoom);
    zoomRef.current = zoom;
    const fitRef = useRef(fit);
    fitRef.current = fit;
    const layout: FlowchartLayout | null = useMemo(
        () => (size === null ? null : computeLayout(model, {
            // The lanes fill main at any zoom: laid out for main's size over it.
            width: size.w / zoom,
            orientation,
            legendPad,
            // The lanes run the whole of main's height.
            minHeight: size.h > 0 ? size.h / zoom : undefined,
            laneWidth,
            laneWindow,
            cards,
            labels: labels?.sizes,
        })),
        [model, size, zoom, orientation, legendPad, laneWidth, laneWindow, cards, labels],
    );
    // The window's lane: where the details draw on the cards, wider than the window, which rests with its card in the middle.
    const laneSlot = layout?.lanes[0]?.w ?? 0;
    // The whole lanes a phone's window holds: each lane as wide as the zoom draws it, so more of them zoomed out (R42).
    const lanesShown = windowed && laneSlot > 0 ? Math.max(lanesInView, Math.floor(size.w / (laneSlot * zoom) + 1e-6)) : lanesInView;
    // The toolbar hears where the zoom stands: at Fit, Zoom out is off; at the cards' own size, Zoom in.
    const atFit = zoom <= fit + 1e-9;
    const atLimit = zoom >= 1 - 1e-9;
    useEffect(() => { onZoomRange?.({ atFit, atLimit }); }, [onZoomRange, atFit, atLimit]);

    // ── drops ─────────────────────────────────────────────────────────────
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
        // The pointer over the drawing, in its own px: the drawing is scaled from its corner at the zoom (R42).
        const box = wrap.getBoundingClientRect();
        const z = zoomRef.current;
        return { surface, row: printDropAt(dropAtPoint(landsOf(card), drawn, modelRef.current, { x: (clientX - box.left) / z, y: (clientY - box.top) / z })), slot: "" };
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
    const nodeOpacity = (node: ModelNode): number =>
        (node.dimmed ? FADED : !dim.active ? FOCUS : dim.nodes.has(node.key) ? FOCUS : dim.restLevel);
    const linkOpacity = (link: ModelLink): number =>
        (link.dimmed ? FADED : !dim.active ? FOCUS : dim.links.has(link.key) ? FOCUS : dim.restLevel);
    const selectedLink = selection?.kind === "link" ? selection.key : null;
    const isSelectedLink = (key: string): boolean => selectedLink !== null && keyEqual(key, selectedLink);
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

    // What the frame asks for — a state Find picked, a drop added, what a
    // click in the inspector names: selected, as a click selects it, and —
    // but for a state dropped where the pointer is, or a key edited where it
    // stands — scrolled to the middle of the canvas's box at the zoom it
    // stands at, which it leaves as it is: once per ask. A state whose card
    // still waits on its details — one ⏎ just added, say — is scrolled to once
    // they land, at the height its card then takes.
    const scrollRef = useRef<HTMLDivElement | null>(null);
    // The element itself, for the lane pager, which hears it scroll.
    const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
    const setScroll = useCallback((el: HTMLDivElement | null) => {
        scrollRef.current = el;
        setScrollEl(el);
    }, []);
    /**
     * Scrolls a point of the drawing to the middle of the canvas's box at the
     * zoom it stands at, the scroll stopping at its ends: what a selection
     * asked for, and a zoom towards what is selected, bring it there.
     */
    const centre = useCallback((box: HTMLDivElement, at: Pt): void => {
        if (layout === null) return;
        const left = Math.max(0, at.x * zoom - box.clientWidth / 2);
        // A phone's window of lanes opens on whole lanes, the nearest that hold it, and never past the last lane's start: a
        // state in the last lane, centred, would stop at the canvas's end, with the lane before it cut (hand test row 14).
        // A lane wider than the window, where the details draw on the cards, opens with its card in the middle. A lane is
        // as wide as the zoom draws it (R42).
        const step = laneSlot * zoom;
        box.scrollLeft = !windowed || step <= 0 || (cards !== undefined && step > box.clientWidth) ? left
            : Math.min(Math.round(left / step), Math.max(0, layout.lanes.length - lanesShown)) * step;
        box.scrollTop = Math.max(0, at.y * zoom - box.clientHeight / 2);
    }, [layout, zoom, laneSlot, windowed, cards, lanesShown]);
    // The ask last selected, and the last one done: scrolled to, or with nothing to scroll.
    const asked = useRef(0);
    const revealed = useRef(0);
    useEffect(() => {
        if (reveal === null || reveal.seq === revealed.current) return;
        if (reveal.seq !== asked.current) {
            asked.current = reveal.seq;
            select(reveal.selection);
        }
        if (reveal.scroll !== false && awaitsRow(reveal.selection, cardsByKey, details.states)) return;
        revealed.current = reveal.seq;
        if (reveal.scroll === false || layout === null) return;
        const at = revealPoint(layout, model, reveal.selection);
        const box = scrollRef.current;
        if (at !== undefined && box !== null) centre(box, at);
    }, [reveal, layout, model, select, cardsByKey, details.states, centre]);

    // A zoom asked for (R42): Zoom out and Zoom in bring what is selected to the middle of the view at the new zoom, where
    // finding it would. With nothing selected, or what is selected drawn nowhere, and at Fit, the view's middle stays: a
    // share of the drawing's width and height, which the layout keeps as it fills main at the new zoom, brought back to
    // the middle once the canvas is drawn there.
    const middle = useRef<{ x: number; y: number; towards: Selection } | undefined>(undefined);
    const zoomTo = useCallback((next: number | "fit", towards: Selection) => {
        const box = scrollRef.current;
        const drawn = layoutRef.current;
        const was = zoomRef.current;
        const to = next === "fit" ? fitRef.current : next;
        if (box !== null && drawn !== null && drawn.width > 0 && drawn.height > 0 && Math.abs(to - was) > 1e-9) {
            middle.current = {
                x: (box.scrollLeft + box.clientWidth / 2) / (drawn.width * was),
                y: (box.scrollTop + box.clientHeight / 2) / (drawn.height * was),
                towards,
            };
        }
        setChosen(next);
    }, []);
    useLayoutEffect(() => {
        const at = middle.current;
        const box = scrollRef.current;
        if (at === undefined || box === null || layout === null) return;
        middle.current = undefined;
        const selected = at.towards === null ? undefined : revealPoint(layout, model, at.towards);
        if (selected !== undefined) {
            centre(box, selected);
            return;
        }
        box.scrollLeft = Math.max(0, at.x * layout.width * zoom - box.clientWidth / 2);
        box.scrollTop = Math.max(0, at.y * layout.height * zoom - box.clientHeight / 2);
    }, [layout, zoom, model, centre]);
    // Zoom out and Zoom in: ×1.5 or ÷1.5, never past Fit, where the zoom follows Fit, nor past the cards' own size;
    // towards what is selected.
    const zoomBy = useCallback((factor: number) => {
        const was = zoomRef.current;
        const least = fitRef.current;
        const next = Math.min(1, Math.max(least, was * factor));
        if (Math.abs(next - was) <= 1e-9) return;
        zoomTo(next <= least + 1e-9 ? "fit" : next >= 1 - 1e-9 ? 1 : next, selectionRef.current);
    }, [zoomTo]);
    const fitView = useCallback(() => zoomTo("fit", null), [zoomTo]);

    // Esc restores everything at once (the spec): nothing selected, nothing dimmed, no transition being drawn — and says
    // whether it had any of them to put back: an Esc with nothing to put back does nothing, and goes on as it came.
    const escape = useCallback((): boolean => {
        if (selectionRef.current === null && hoverRef.current === null && draftRef.current === null) return false;
        onSelectRef.current(null);
        setHover(null);
        setDraft(null);
        return true;
    }, []);
    // Whether the pointer is over the canvas: a key from the page itself, nothing focused, is the canvas's only then.
    const hoveredRef = useRef(false);
    // A key from inside the frame, heard as it leaves it (the handle's `key`), after every part of it that takes keys of
    // its own: Esc is the canvas's from the frame's own regions — never from a field being typed into, which keeps its
    // own Esc, what it holds put back and the selection kept, nor from a layer portaled out of the frame, a popover or a
    // menu, which is that layer's — and is taken where it acts (#1398).
    const onFrameKey = useCallback((e: React.KeyboardEvent<HTMLElement>): void => {
        if (e.key !== "Escape" || e.defaultPrevented || typedInto(e.target) || !keyInFrame(bodyRef.current, e.target)) return;
        if (escape()) takeKey(e);
    }, [escape]);
    useImperativeHandle(ref, () => ({ key: onFrameKey, zoomBy, fit: fitView }), [onFrameKey, zoomBy, fitView]);
    // A key from the page itself, which no part of the frame hears: the window's, while the pointer is over the canvas.
    // A key typed anywhere else on the page — another builder's, a field's, a menu's — never acts on the canvas.
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key !== "Escape" || e.defaultPrevented || !hoveredRef.current || !keyFromPage(e.target)) return;
            if (escape()) e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [escape]);

    // Del deletes the selection — heard in the canvas, never in a field being
    // typed into, which keeps its own Del: a state or several with their
    // transitions, a transition, a decision cleared from the transitions it
    // governs, a lane holding no state — each while its kind edits, the key
    // going no further than the Flowchart (#1398).
    const onCanvasKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>): void => {
        if ((e.key !== "Delete" && e.key !== "Backspace") || edit === undefined || typedInto(e.target)) return;
        const sel = selectionRef.current;
        if (sel === null) return;
        const run = ((): (() => void) | undefined => {
            switch (sel.kind) {
                case "state": return edit.deleteStates === undefined ? undefined : () => edit.deleteStates!([sel.key]);
                case "states": return edit.deleteStates === undefined ? undefined : () => edit.deleteStates!(sel.keys);
                case "link": return edit.deleteLink === undefined ? undefined : () => edit.deleteLink!(sel.key);
                case "trigger": return edit.deleteDecision === undefined ? undefined : () => edit.deleteDecision!(sel.key);
                // A lane holding states is never deleted: Del leaves it, selected.
                case "lane": return edit.deleteLane === undefined || (modelRef.current.laneStates.get(sel.key) ?? 0) > 0
                    ? undefined : () => edit.deleteLane!(sel.key);
            }
        })();
        if (run === undefined) return;
        takeKey(e);
        onSelectRef.current(null);
        setHover(null);
        run();
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

    // The pointer over the drawing, in its own px: the drawing is scaled from its corner at the zoom (R42).
    const svgPoint = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } => {
        const el = bodyRef.current?.querySelector("[data-flowchart-canvas]");
        const r = el?.getBoundingClientRect();
        const z = zoomRef.current;
        return r ? { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z } : { x: 0, y: 0 };
    }, []);

    /** The state a connect drag rests on: its card, or as near as the drop pad — never one drawn as context. */
    const connectTarget = useCallback((p: Pt): string | null => {
        if (layout === null) return null;
        const key = dropTargetAt(layout, p);
        const node = key === null ? undefined : model.nodesByKey.get(key);
        return node === undefined || node.dimmed ? null : key;
    }, [layout, model]);

    const connectEdit = edit?.connect;
    const beginDraft = useCallback((from: string, side: "left" | "right" | "top" | "bottom", e: React.PointerEvent) => {
        if (connectEdit === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        const p = svgPoint(e);
        setDraft({ from, side, x: p.x, y: p.y, over: null, allowed: false, dup: undefined });
        const move = (ev: PointerEvent): void => {
            const q = svgPoint(ev);
            const fromKey = draftRef.current?.from ?? from;
            // The WHOLE node (plus DROP_PAD) is the target — nobody has to
            // land a 7px ring.
            const over = connectTarget(q);
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
                connectEdit(d.from, d.over);
                setPulse(p => ({ from: d.from, to: d.over!, seq: (p?.seq ?? 0) + 1 }));
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [connectEdit, svgPoint, connectTarget, model, canConnect]);

    /**
     * Where a moved state lands at a point: the band under it, where the band
     * takes a state, and — where the states carry an `order` — the row of the
     * band's states, as drawn, that the line marks.
     */
    const moveLanding = useCallback((p: Pt): { overLane: string | null; row: number | null } => {
        const drawn = layoutRef.current;
        const key = drawn === null ? null : laneAt(drawn, p);
        if (drawn === null || key === null || !takesStates(key)) return { overLane: null, row: null };
        const index = model.lanes.findIndex((lane) => keyEqual(lane.key, key));
        return { overLane: key, row: model.ordered ? rowAt(drawn, bandStates(model, index).length, p) : null };
    }, [model, takesStates]);

    /** Node move gesture — begins after a 5px threshold so plain clicks
     * stay selection; the candidate band, and where it lands, highlight while dragging. */
    const moveEdit = edit?.moveStates;
    const beginMove = useCallback((key: string, e: React.PointerEvent) => {
        if (moveEdit === undefined) return;
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
            setMoveDrag({ key, x: q.x, y: q.y, ...moveLanding(q) });
        };
        const up = (): void => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            const d = moveDragRef.current;
            setMoveDrag(null);
            if (!started || d === null || d.overLane === null) return;
            const node = model.nodesByKey.get(key);
            const index = model.lanes.findIndex((lane) => keyEqual(lane.key, d.overLane!));
            if (node === undefined || index < 0) return;
            const same = node.laneIndex === index;
            // States carrying no order stand by key: a move writes their lane alone, and one within its own lane does nothing.
            if (d.row === null) {
                if (!same) moveEdit([key], d.overLane);
                return;
            }
            // Among the band's other states: past the moved state's own row, one fewer; its own row, nothing moves.
            let at = d.row;
            if (same) {
                const own = bandStates(model, index).findIndex((state) => keyEqual(state.key, key));
                if (at > own) at -= 1;
                if (at === own) return;
            }
            moveEdit([key], d.overLane, at);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }, [moveEdit, svgPoint, moveLanding, model]);

    // ── render helpers ────────────────────────────────────────────────────
    const linksByKey = useMemo(() => new Map(model.links.map(l => [l.key, l])), [model]);
    const showMinimap = minimapOpt ?? model.nodes.length >= 25;

    // dashed renders over solid; context under both; selected on top.
    const orderedRoutes = useMemo(() => {
        if (!layout) return [];
        const context: LinkRoute[] = [], solid: LinkRoute[] = [], dashed: LinkRoute[] = [], selected: LinkRoute[] = [];
        for (const r of layout.routes) {
            const l = linksByKey.get(r.key);
            if (!l) continue;
            if (selectedLink !== null && keyEqual(r.key, selectedLink)) selected.push(r);
            else if (l.dimmed) context.push(r);
            else if (l.cls === "planned") solid.push(r);
            else dashed.push(r);
        }
        return [...context, ...solid, ...dashed, ...selected];
    }, [layout, linksByKey, selectedLink]);

    // Records with nothing in them — no lane, no state, no transition — draw
    // nothing; the box stays, measured, for what comes. Where a lane or a
    // state can be added, the band row draws, so "+ LANE" or "+ STATE" can
    // give it its first.
    const empty = model.blank && edit?.addLane === undefined && edit?.addState === undefined;
    const addStateEdit = edit?.addState;
    const renameLaneEdit = edit?.renameLane;
    const deleteLaneEdit = edit?.deleteLane;
    const addLaneEdit = edit?.addLane;
    const body = (
        <Box ref={onBody} css={styles.body} data-flowchart-body=""
            onPointerEnter={() => { hoveredRef.current = true; }} onPointerLeave={() => { hoveredRef.current = false; }}>
            {probe}
            {layout !== null && !empty && (
                // Focusable, so a press inside it — a state, a transition — lands its keys here: Del's.
                <Box ref={setScroll} css={styles.scroll} data-flowchart-scroll="" tabIndex={-1} onKeyDown={onCanvasKey}>
                    {/* What main scrolls: the canvas at the size the zoom draws it (R42). */}
                    <Box css={styles.canvasZoom} data-flowchart-zoom-box="" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
                        {/* The canvas's one drop cell, where a tab of the library drops — scaled from its corner at the zoom. */}
                        <Box ref={setWrap} css={styles.canvasWrap}
                            style={{ width: layout.width, height: layout.height, transform: zoom === 1 ? undefined : `scale(${zoom})` }}>
                            <svg
                                data-flowchart-canvas
                                width={layout.width}
                                height={layout.height}
                                viewBox={`0 0 ${layout.width} ${layout.height}`}
                                style={{ position: "absolute", inset: 0, display: "block" }}
                                onClick={(e) => {
                                    // A click where nothing is — no transition, diamond or lane's header — selects nothing.
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
                                {/* band hover targets — reveal the "+ STATE" ghost, in a band that takes a state */}
                                {addStateEdit !== undefined && layout.lanes.map(lane => takesStates(lane.key) && (
                                    <rect
                                        key={`bandhit-${lane.key}`}
                                        data-flowchart-band={lane.key}
                                        x={lane.x} y={lane.y} width={lane.w} height={lane.h}
                                        fill="transparent"
                                        onPointerEnter={() => setLaneHover(lane.key)}
                                        onPointerLeave={() => setLaneHover(h => (h !== null && keyEqual(h, lane.key) ? null : h))}
                                    />
                                ))}
                                {/* move-drag candidate band highlight */}
                                {moveDrag !== null && moveDrag.overLane !== null && (() => {
                                    const lane = layout.lanes.find(l => keyEqual(l.key, moveDrag.overLane!));
                                    if (!lane) return null;
                                    return (
                                        <g style={{ pointerEvents: "none" }}>
                                            <rect x={lane.x} y={lane.y} width={lane.w} height={lane.h} fill={BRAND} opacity={0.07} />
                                            <rect x={lane.x + 2} y={lane.y + 2} width={lane.w - 4} height={lane.h - 4}
                                                fill="none" stroke={BRAND_D} strokeDasharray="6 4" strokeWidth={1.5} />
                                        </g>
                                    );
                                })()}
                                {/* lane headers — their look the recipe's (#1520): mono 12/600,
                                    caps spaced 2.6px, ink-4. A click on the header's strip
                                    selects its lane, and a double-click renames it in
                                    place where the lanes edit; No lane, and the one band
                                    of a Flowchart given no lanes, are neither. Each lane's
                                    × and "+ LANE" are the HTML layer's, below. */}
                                {layout.lanes.map(lane => {
                                    const head = laneHead(layout, lane);
                                    const text = (
                                        <text x={head.x} y={head.y} textAnchor={head.td ? "start" : "middle"}
                                            data-flowchart-lane={lane.key}>
                                            {lane.label.toUpperCase()}
                                        </text>
                                    );
                                    if (!isLane(lane.key)) return <g key={lane.key} data-flowchart-band-kind={bands.get(lane.key)}>{text}</g>;
                                    const box = laneHeadBox(layout, lane);
                                    return (
                                        <g key={lane.key} data-flowchart-lane-head={lane.key} style={{ cursor: "pointer" }}
                                            onClick={() => select({ kind: "lane", key: lane.key })}
                                            onDoubleClick={renameLaneEdit !== undefined ? () => setLaneEdit({ key: lane.key, label: lane.label }) : undefined}>
                                            <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="transparent" />
                                            {text}
                                        </g>
                                    );
                                })}

                                {/* the brand wash on the transition a card sets where it
                                    rests — under every line, the recipe's */}
                                {dropMark?.kind === "transition" && (() => {
                                    const route = layout.routes.find((r) => keyEqual(r.key, dropMark.key));
                                    return route === undefined ? null : <path data-flowchart-dropwash={route.key} d={route.d} />;
                                })()}

                                {/* links — context first, then solid, then dashed (dashed renders over solid), selected last;
                                    a transition drawn as context takes no pointer */}
                                <g data-flowchart-links>
                                    {orderedRoutes.map(r => {
                                        const l = linksByKey.get(r.key)!;
                                        const isSel = isSelectedLink(r.key);
                                        return (
                                            <g key={r.key} data-context={l.dimmed ? "" : undefined} style={{ opacity: linkOpacity(l), transition: fade(dim.active) }}>
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
                                                {!l.dimmed && (
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
                                                )}
                                            </g>
                                        );
                                    })}
                                </g>

                                {/* decision diamonds, each at the middle of its line's longest straight stretch — one on a transition drawn as context takes no pointer */}
                                {orderedRoutes.map(r => {
                                    const l = linksByKey.get(r.key)!;
                                    const trigger = l.trigger !== undefined ? model.triggers.get(l.trigger) : undefined;
                                    if (trigger === undefined) return null;
                                    const live = !l.dimmed;
                                    return (
                                        <g key={`dia-${r.key}`} data-context={live ? undefined : ""} style={{ opacity: linkOpacity(l), transition: fade(dim.active) }}>
                                            <g
                                                data-flowchart-trigger={live ? trigger.key : undefined}
                                                data-drop-target={live && dropMark?.kind === "decision" && keyEqual(dropMark.key, trigger.key) ? "" : undefined}
                                                data-selected={live && selection?.kind === "trigger" && keyEqual(selection.key, trigger.key) ? "" : undefined}
                                                transform={`translate(${r.mid.x},${r.mid.y}) rotate(45)`}
                                                style={{ cursor: live ? "pointer" : undefined }}
                                                onPointerEnter={live ? () => hoverOn({ kind: "trigger", key: trigger.key }) : undefined}
                                                onPointerLeave={live ? () => setHover(null) : undefined}
                                                onClick={live ? () => select({ kind: "trigger", key: trigger.key }) : undefined}
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

                                {/* labels — collision-resolved in layout over their boxes, each
                                    as big as its lines (R32); chrome inherits the link class; its
                                    evidence line's numerals mono tabular ink */}
                                {orderedRoutes.map(r => {
                                    const l = linksByKey.get(r.key)!;
                                    const box = r.label;
                                    if (box === undefined) return null;
                                    const selectedHere = isSelectedLink(r.key);
                                    const bs = badgeStyle(l.cls, selectedHere);
                                    // Its details' lines under its evidence, 13 apart — the first line's place where it has none (R32).
                                    const detail = labels?.lines.get(r.key) ?? [];
                                    const first = -box.h / 2 + LABEL_BASELINE + (l.badgeText === undefined ? 0 : LABEL_LINE_H);
                                    return (
                                        // Ornament, not a control — pointer-transparent so the
                                        // link's hit path beneath stays hoverable.
                                        <g key={`bdg-${r.key}`} data-flowchart-label={r.key} data-selected={selectedHere || undefined}
                                            style={{ opacity: linkOpacity(l), transition: fade(dim.active), pointerEvents: "none" }}
                                            transform={`translate(${box.x + box.w / 2},${box.y + box.h / 2})`}>
                                            <rect x={-box.w / 2} y={-box.h / 2} width={box.w} height={box.h} rx={4}
                                                fill={PAPER} stroke={bs.stroke} strokeWidth={1} strokeDasharray={bs.dash} />
                                            {l.badgeText !== undefined && (
                                                <text y={-box.h / 2 + LABEL_BASELINE} textAnchor="middle"
                                                    style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600, fill: bs.text, fontVariantNumeric: "tabular-nums" }}>
                                                    {l.badgeText}
                                                </text>
                                            )}
                                            {detail.map((line, i) => {
                                                const y = first + i * LABEL_LINE_H;
                                                if (line.kind === "placeholder") {
                                                    const w = Math.min(PLACEHOLDER_BAR.w, box.w - 14);
                                                    return <rect key={i} data-line="placeholder" x={-w / 2} y={y - PLACEHOLDER_BAR.above} width={w} height={PLACEHOLDER_BAR.h} rx={2} />;
                                                }
                                                return <text key={i} data-line="detail" y={y} textAnchor="middle">{labelLineText(line, words)}</text>;
                                            })}
                                        </g>
                                    );
                                })}

                            </svg>

                            {/* the band a dropped state lands in, or whose header a card
                                sets: its wash, under the states, the recipe's */}
                            {(dropMark?.kind === "lane" || dropMark?.kind === "header") && (() => {
                                const band = layout.lanes.find((l) => keyEqual(l.key, dropMark.lane));
                                return band === undefined ? null : (
                                    <Box css={styles.dropLane} data-flowchart-droplane={band.key}
                                        style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />
                                );
                            })()}

                            {/* the selected lane: its band ringed, under the states, the recipe's */}
                            {selection?.kind === "lane" && (() => {
                                const band = layout.lanes.find((l) => keyEqual(l.key, selection.key));
                                return band === undefined ? null : (
                                    <Box css={styles.laneSelected} data-flowchart-lane-selected={band.key}
                                        style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />
                                );
                            })()}

                            {/* node cards — HTML above the SVG; one drawn as context takes no pointer, the recipe's */}
                            {[...layout.nodes.values()].map(rect => {
                                const nm = model.nodesByKey.get(rect.key);
                                if (!nm) return null;
                                const isSel = pickedStates.some((key) => keyEqual(key, rect.key));
                                const live = !nm.dimmed;
                                // A ghost is an end no state is keyed by: selected, never moved or renamed.
                                const movable = live && !nm.ghost && moveEdit !== undefined;
                                // Where the details draw on the cards: its head over its reads (R22).
                                const card = cardsByKey?.get(rect.key);
                                const members = nm.members === undefined ? null : (
                                    <Box as="span" css={card === undefined ? styles.nodeBadge : styles.cardChip} data-flowchart-members="">×{words.number(nm.members)}</Box>
                                );
                                const inPlace = live && nm.inPlaceKeys.length > 0 ? (() => {
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
                                })() : null;
                                return (
                                    <Box
                                        key={rect.key}
                                        data-flowchart-node={rect.key}
                                        css={nm.ghost ? styles.ghostNode : styles.node}
                                        data-details={card === undefined ? undefined : ""}
                                        data-selected={isSel || undefined}
                                        data-context={live ? undefined : ""}
                                        data-conflict={conflicted?.has(rect.key) === true ? "" : undefined}
                                        data-drop-target={dropMark?.kind === "state" && keyEqual(dropMark.key, rect.key) ? "" : undefined}
                                        style={{
                                            left: rect.x, top: rect.y, width: rect.w, height: rect.h,
                                            opacity: moveDrag !== null && keyEqual(moveDrag.key, rect.key) ? 0.3 : nodeOpacity(nm),
                                            transition: fade(dim.active),
                                        }}
                                        onPointerEnter={live ? () => hoverOn({ kind: "state", key: rect.key }) : undefined}
                                        onPointerLeave={live ? () => setHover(null) : undefined}
                                        onPointerDown={movable ? (e) => beginMove(rect.key, e) : undefined}
                                        onClick={live ? (e) => {
                                            if (movedRef.current) { movedRef.current = false; return; }
                                            // Shift, ⌘ or Ctrl: into a selection of several, or out of it.
                                            if (e.shiftKey || e.metaKey || e.ctrlKey) select(toggleState(selectionRef.current, rect.key));
                                            else select({ kind: "state", key: rect.key });
                                        } : undefined}
                                        onDoubleClick={live && !nm.ghost && edit?.renameState !== undefined ? () => {
                                            setStateEditor({ mode: "edit", key: rect.key, label: nm.label ?? "", was: nm.label ?? "" });
                                        } : undefined}
                                    >
                                        {card !== undefined && details.states !== undefined ? (
                                            <FlowchartCardContent styles={styles} kind={details.states} card={card} words={words}
                                                name={nm.label ?? rect.key} code={nm.label === undefined ? undefined : rect.key}
                                                badges={<>{members}{inPlace}</>} />
                                        ) : (
                                            <>
                                                <Box css={styles.nodeCode}>
                                                    {rect.key}
                                                    {members}
                                                    {inPlace}
                                                </Box>
                                                {nm.label !== undefined && <Box css={styles.nodeLabel}>{nm.label}</Box>}
                                            </>
                                        )}
                                    </Box>
                                );
                            })}

                            {/* connector overlay — ABOVE the node borders per the spec's
                                z-order; rings on occupied handles, all four revealed on
                                hover/selection, 16×16 hit targets on the out-handles where
                                the transitions edit — never on a state drawn as context */}
                            <svg
                                width={layout.width}
                                height={layout.height}
                                viewBox={`0 0 ${layout.width} ${layout.height}`}
                                style={{ position: "absolute", inset: 0, display: "block", pointerEvents: "none" }}
                            >
                                {[...layout.nodes.values()].map(rect => {
                                    const nm = model.nodesByKey.get(rect.key);
                                    if (!nm) return null;
                                    const nodeActive = (hover?.kind === "state" && keyEqual(hover.key, rect.key))
                                        || pickedStates.some((key) => keyEqual(key, rect.key))
                                        || draft !== null;
                                    const occupied = layout.handles.get(rect.key) ?? [];
                                    const occupiedSides = new Set(occupied.map(h => h.side));
                                    // Unoccupied handles are the EDIT affordance — they only
                                    // reveal on hover/selection where the transitions edit;
                                    // occupied rings are anatomy and always render.
                                    const authoring = connectEdit !== undefined && !nm.dimmed;
                                    const extra = nodeActive && authoring
                                        ? (["left", "right", "top", "bottom"] as const).filter(s => !occupiedSides.has(s))
                                        : [];

                                    return (
                                        <g key={`ports-${rect.key}`} data-flowchart-ports={rect.key} style={{ opacity: nodeOpacity(nm), transition: fade(dim.active) }}>
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
                                    const selfDrop = draft.over !== null && keyEqual(draft.over, draft.from) && landable;
                                    // Spec-compliant preview: the exact H/V route (r 8
                                    // corners, ring-trimmed) the link would take when a
                                    // target is snapped; an orthogonal path to the cursor
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
                                    if (!l || !keyEqual(l.from, pulse.from) || !keyEqual(l.to, pulse.to)) return null;
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

                            {/* the landing line where a dropped state lands: across the
                                node's footprint, between the state above it and the one it
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

                            {/* the line down the gap a dropped lane lands in — between two
                                lanes, or at the band row's tail — the recipe's */}
                            {dropMark?.kind === "gap" && (() => {
                                const at = gapLine(layout, dropMark.at);
                                const td = layout.orientation === "TD";
                                return (
                                    <Box css={styles.dropSeam} data-flowchart-gap={dropMark.at} data-orientation={layout.orientation}
                                        style={td ? { left: 0, top: at, width: layout.width } : { left: at, top: 0, height: layout.height }} />
                                );
                            })()}

                            {/* the line where a moved state lands, between two cards, where the states carry an order */}
                            {moveDrag !== null && moveDrag.overLane !== null && moveDrag.row !== null && (() => {
                                const band = layout.lanes.find((l) => keyEqual(l.key, moveDrag.overLane!));
                                if (band === undefined) return null;
                                const seam = landingSeam(layout, band, moveDrag.row);
                                const td = layout.orientation === "TD";
                                return (
                                    <Box css={styles.dropSeam} data-flowchart-move={moveDrag.row} data-orientation={layout.orientation}
                                        style={td ? { left: seam.x, top: seam.y, height: seam.h } : { left: seam.x, top: seam.y, width: seam.w }} />
                                );
                            })()}

                            {/* each lane's × — Font Awesome's xmark beside its header; off
                                while the lane holds states, its tooltip saying why */}
                            {deleteLaneEdit !== undefined && layout.lanes.map(lane => {
                                if (!isLane(lane.key)) return null;
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
                                                onClick={holds > 0 ? undefined : () => deleteLaneEdit(lane.key)}
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
                            {addLaneEdit !== undefined && (
                                <chakra.button
                                    type="button"
                                    css={styles.addLane}
                                    data-flowchart-addlane=""
                                    data-orientation={layout.orientation}
                                    aria-label={words.m.addLane()}
                                    style={{ left: layout.laneTail.x, top: layout.laneTail.y, width: layout.laneTail.w, height: layout.laneTail.h }}
                                    onClick={() => addLaneEdit()}
                                >
                                    <FontAwesomeIcon icon={faPlus} />
                                    <span>{words.m.laneWord()}</span>
                                </chakra.button>
                            )}

                            {/* "+ STATE" ghost — dashed, exact node footprint, one per
                                hovered band that takes a state, Font Awesome's plus beside
                                its word; click turns it into the inline editor */}
                            {addStateEdit !== undefined && stateEditor === null && laneHover !== null && takesStates(laneHover) && moveDrag === null && !dragging && (() => {
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

                            {/* inline node editor — the ghost's commit surface, a new
                                state's key auto-focused and its label below; and the
                                double-click rename, its key shown fixed and its label
                                auto-focused. ⏎ commits — a key the Flowchart holds already
                                refused, the editor left open — Esc dismisses, and a blur
                                commits what it can */}
                            {stateEditor !== null && (() => {
                                const cell = stateEditor.mode === "add"
                                    ? layout.laneGhosts.get(stateEditor.lane)
                                    : layout.nodes.get(stateEditor.key);
                                if (!cell) return null;
                                const code = stateEditor.mode === "add" ? stateEditor.code.trim() : "";
                                const taken = stateEditor.mode === "add" && code.length > 0 && edit?.stateKeyTaken?.(code) === true;
                                /** Commits the editor; whether it closes — a key taken leaves it open on ⏎. */
                                const commit = (blur: boolean): void => {
                                    const ed = stateEditor;
                                    if (ed.mode === "add") {
                                        const key = ed.code.trim();
                                        if (key.length === 0 || addStateEdit === undefined) { setStateEditor(null); return; }
                                        const added = !taken && addStateEdit(ed.lane, key, ed.label.trim());
                                        if (added || blur) setStateEditor(null);
                                        return;
                                    }
                                    setStateEditor(null);
                                    const label = ed.label.trim();
                                    if (label !== ed.was) edit?.renameState?.(ed.key, label);
                                };
                                // ⏎ commits and Esc dismisses, each key going no further than the Flowchart (#1398).
                                const keys = (e: React.KeyboardEvent): void => {
                                    if (e.key === "Enter") { takeKey(e); commit(false); }
                                    else if (e.key === "Escape") { takeKey(e); setStateEditor(null); }
                                };
                                return (
                                    <Box
                                        data-flowchart-stateeditor
                                        css={styles.stateEditor}
                                        // Over a card with details, over its head alone: its reads stay in view.
                                        style={{ left: cell.x, top: cell.y, width: cell.w, minHeight: stateEditor.mode === "edit" && cardsByKey?.has(stateEditor.key) === true ? Math.min(cell.h, DETAILS_HEAD_H) : cell.h }}
                                        onBlur={e => {
                                            // blur-empty dismisses; blur with content commits
                                            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                                            commit(true);
                                        }}
                                    >
                                        {stateEditor.mode === "add" ? (
                                            <input
                                                autoFocus
                                                data-flowchart-key=""
                                                aria-label={words.m.stateKeyField()}
                                                aria-invalid={taken || undefined}
                                                title={taken ? words.m.stateKeyTaken({ key: code }) : undefined}
                                                placeholder={words.m.stateKeyPlaceholder()}
                                                value={stateEditor.code}
                                                onChange={e => setStateEditor(ed => (ed === null || ed.mode !== "add" ? ed : { ...ed, code: e.target.value }))}
                                                onKeyDown={keys}
                                            />
                                        ) : (
                                            <Box css={styles.nodeCode} data-flowchart-key="">{stateEditor.key}</Box>
                                        )}
                                        <input
                                            autoFocus={stateEditor.mode === "edit"}
                                            data-flowchart-label=""
                                            aria-label={words.m.stateLabelField()}
                                            placeholder={words.m.stateLabelPlaceholder()}
                                            value={stateEditor.label}
                                            onChange={e => setStateEditor(ed => (ed === null ? ed : { ...ed, label: e.target.value }))}
                                            onKeyDown={keys}
                                        />
                                    </Box>
                                );
                            })()}

                            {/* floating clone while a node drags */}
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
                                const selfDrop = keyEqual(draft.over, draft.from) && landable;
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
                            {pulse !== null && keyEqual(pulse.from, pulse.to) && (() => {
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
                                const lane = layout.lanes.find(l => keyEqual(l.key, laneEdit.key));
                                if (!lane) return null;
                                const td = layout.orientation === "TD";
                                const style: React.CSSProperties = td
                                    ? { left: 8, top: lane.y + 8, width: 148 }
                                    : { left: lane.cx - 74, top: 8, width: 148 };
                                const commit = (): void => {
                                    const next = laneEdit;
                                    setLaneEdit(null);
                                    if (next !== null && next.label.trim() !== "" && renameLaneEdit !== undefined) renameLaneEdit(next.key, next.label.trim());
                                };
                                return (
                                    <input
                                        data-flowchart-lane-edit
                                        autoFocus
                                        aria-label={words.m.laneLabelField()}
                                        value={laneEdit.label}
                                        onChange={e => setLaneEdit(le => (le === null ? le : { ...le, label: e.target.value }))}
                                        onBlur={commit}
                                        onKeyDown={e => {
                                            // ⏎ commits and Esc puts the label back, each key going no further than the Flowchart (#1398).
                                            if (e.key === "Enter") { takeKey(e); commit(); }
                                            else if (e.key === "Escape") { takeKey(e); setLaneEdit(null); }
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

                            {/* legend — planned / observed / trigger / in-place, then a row for each read the cards and
                                labels draw, and beside them, one over another, a group for each tag list it lists (R31) */}
                            {legendOn && (
                                <Box css={styles.legend} data-flowchart-legend>
                                    <Box css={styles.legendRows} data-legend-rows="">
                                        <Box css={styles.legendTitle}>{words.m.legendTitle()}</Box>
                                        <Box css={styles.legendRow} data-legend-line="planned">
                                            <svg width={28} height={8}><line x1={1} y1={4} x2={27} y2={4} stroke={INK} strokeWidth={2} /></svg>
                                            <span>{words.m.legendLine({ line: "planned" })}</span>
                                        </Box>
                                        <Box css={styles.legendRow} data-legend-line="observed">
                                            <svg width={28} height={8}><line x1={1} y1={4} x2={27} y2={4} stroke={INFO} strokeWidth={1.6} strokeDasharray="5 4" /></svg>
                                            <span>{words.m.legendLine({ line: "observed" })}</span>
                                        </Box>
                                        <Box css={styles.legendRow} data-legend-line="decision">
                                            <svg width={28} height={16}>
                                                <rect x={9} y={3} width={10} height={10} rx={2} transform="rotate(45 14 8)" fill={PAPER} stroke={BRAND_D} strokeWidth={1.2} />
                                            </svg>
                                            <span>{words.m.legendLine({ line: "decision" })}</span>
                                        </Box>
                                        <Box css={styles.legendRow} data-legend-line="inPlace">
                                            {/* The ↻ badge in a mark's 28 × 16 box, as a read's mark is: its words start where every row's do. */}
                                            <Box as="span" css={styles.legendMark}>
                                                <Box as="span" css={styles.nodeBadge}><FontAwesomeIcon icon={faRotateRight} style={{ fontSize: "8px" }} /> n</Box>
                                            </Box>
                                            <span>{words.m.legendLine({ line: "inPlace" })}</span>
                                        </Box>
                                        {legend.reads.map((row) => (
                                            <Box key={row.key} css={styles.legendRow} data-legend-read={row.key}>
                                                <FlowchartLegendMarkView styles={styles} mark={row.mark} />
                                                <span>{row.text}</span>
                                            </Box>
                                        ))}
                                    </Box>
                                    {legend.groups.length > 0 && (
                                        <Box css={styles.legendGroups} data-legend-groups="">
                                            {legend.groups.map((group) => (
                                                <Box key={group.key} css={styles.legendTags} data-legend-group={group.key}>
                                                    <Box css={styles.legendTitle}>{group.label}</Box>
                                                    {group.tags.length > 0 && (
                                                        <Box css={styles.legendTagList}>
                                                            {group.tags.map((tag) => <FlowchartTag key={tag.tag} css={styles.tag} text={tag.tag} look={tag.look} />)}
                                                        </Box>
                                                    )}
                                                </Box>
                                            ))}
                                        </Box>
                                    )}
                                </Box>
                            )}
                        </Box>
                    </Box>
                </Box>
            )}
            {/* The minimap: over the canvas in main's corner, where it stays
                while the canvas scrolls under it — never in the drawing, whose
                far corner a wide or a tall Flowchart scrolls out of view. */}
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
            {/* A read that failed: said once, at the top-left of the canvas's box, which the drawing scrolls under. */}
            {failure !== undefined && (
                <LoadingFailedBox message={failure.message} retry={{ onRetry: failure.retry }} at={{ top: FAILED_INSET_PX, left: FAILED_INSET_PX }} />
            )}
        </Box>
    );

    // A phone's lane pager over the canvas, while the window holds fewer lanes than the flow has: each lane as wide as the zoom draws it.
    return (
        <>
            {layout !== null && !empty && windowed && layout.lanes.length > lanesShown && (
                <FlowchartLanePager frame={scrollEl} total={layout.lanes.length} inView={lanesShown} slotPx={laneSlot * zoom} centred={cards !== undefined} words={words} />
            )}
            {body}
        </>
    );
}
